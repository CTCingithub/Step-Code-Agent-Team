/**
 * TeamManager: member agent lifecycle.
 *
 * Members are long-lived `step --mode rpc` subprocesses. The leader (the
 * current session) creates them, sends them work, and re-attaches to them
 * after a restart: a member's context lives in its session file, keyed by a
 * deterministic session id (`team-<teamId>-<member>`), so respawning with the
 * same id resumes the conversation (verified: step creates the session if
 * missing and reuses it otherwise).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemberRpc, type MemberRpcHandlers, getStepInvocation } from "./rpc-client.ts";
import {
	addUsage,
	createRegistry,
	emptyUsage,
	loadRegistry,
	memberPromptsDir,
	memberSessionsDir,
	type MemberRecord,
	type MemberUsage,
	type TaskRecord,
	type TeamRegistry,
	registryPath,
	saveRegistry,
	teamDir,
} from "./registry.ts";
import { type AgentPreset, extensionEntryPath, loadPreset, memberMessagingEntryPath } from "./presets.ts";
import { nextTaskId, recomputeReady, taskPrompt, validateGraph } from "./tasks.ts";
import {
	DEFAULT_EFFORT,
	type PluginConfig,
	type EffortLevel,
	VALID_EFFORT,
	getConfig,
} from "./config.ts";
import {
	buildTopology,
	describeTopology,
	normalizeTopology,
	starTopology,
	TopologyError,
	topologyMayMessage,
	topologyOutbound,
	validateTopology,
	type TopologyData,
	type TopologyEdge,
	type TopologyShape,
} from "./topology.ts";
import { TEAM_TOOL_NAMES } from "./activation.ts";

export interface CreateMemberParams {
	name: string;
	role?: string;
	model?: string;
	effort?: string;
	tools?: string[];
	systemPrompt?: string;
}

export interface SendResult {
	member: string;
	text: string;
	usage: MemberUsage;
	resumed: boolean;
}

export interface SendOptions {
	/** Leader-side cancellation (Esc). */
	signal?: AbortSignal;
	/** Interim member text, for streaming tool updates. */
	onProgress?: (text: string) => void;
	/**
	 * Internal: nested (member-to-member) dispatch, exempt from the global
	 * concurrency gate. The sender already occupies a running slot, so
	 * acquiring another one here could deadlock the messaging chain.
	 */
	nested?: boolean;
	/**
	 * Internal: message-chain length of a nested dispatch. Leader dispatches
	 * are 0; the team server sets sender length + 1 when a member forwards a
	 * message, bounding ring circulation via topology.maxLoopCount.
	 */
	chainLength?: number;
}

export interface CreateTaskParams {
	title: string;
	detail?: string;
	blockedBy?: string[];
	assignee?: string;
}

const MEMBER_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function debugNote(message: string): void {
	if (getConfig().debug) console.error(`[stepcode-agent-team] ${message}`);
}

/**
 * Create params that a resume silently ignores (the existing record wins).
 * Empty when nothing conflicting was passed — used to tell the leader LLM
 * instead of letting it believe a reconfiguration happened.
 */
export function resumeIgnoredParams(params: CreateMemberParams, member: MemberRecord): string[] {
	const ignored: string[] = [];
	if (params.role && params.role !== member.role) ignored.push("role");
	if (params.tools && params.tools.length > 0 && params.tools.join(",") !== (member.tools ?? []).join(",")) {
		ignored.push("tools");
	}
	if (params.model && params.model !== member.model) ignored.push("model");
	if (params.effort && params.effort !== member.effort) ignored.push("effort");
	if (params.systemPrompt && params.systemPrompt.trim().length > 0) ignored.push("systemPrompt");
	return ignored;
}

/**
 * A leader-side dispatch that fails mid-run (timeout / member exit / abort)
 * can strand nested member-to-member relays that the team server is still
 * running — e.g. a ring tour whose chain outlives the dispatch timeout. The
 * dispatched member is killed (fail-fast), but its teammates may still be
 * working. Give the leader the recovery facts instead of a bare error: relays
 * may still be in flight (check team_status before re-dispatching — a
 * respawned member would duplicate the work) and who is alive right now.
 * Nested senders keep the terse error (it reaches them through the shim).
 */
export function augmentDispatchError(err: unknown, members: readonly MemberRecord[], nested: boolean): unknown {
	if (nested || !(err instanceof Error)) return err;
	if (!/timeout waiting for member to settle|exited during run|aborted by leader/.test(err.message)) return err;
	const roster = members.map((m) => `${m.name} ${m.status}`).join(" · ");
	const note = [
		err.message,
		"(team) this dispatch failed mid-run: nested member-to-member relays it triggered may still be running server-side — check team_status before re-dispatching (the dispatched member was killed fail-fast and will respawn with its context resumed).",
		roster ? `(team) members now: ${roster}` : "",
	]
		.filter(Boolean)
		.join("\n");
	return new Error(note, { cause: err });
}

/** Depth of this process in the team tree (the leader session is 0). */
export function currentDepth(): number {
	const raw = process.env.STEPCODE_TEAM_DEPTH;
	const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function sanitizeTeamId(sessionId: string): string {
	const cleaned = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 48);
	return cleaned || `team-${Date.now().toString(36)}`;
}

/** Team id a session file maps to (null for ephemeral sessions without a file). */
export function teamIdForSession(sessionFile: string | null): string | null {
	if (!sessionFile) return null;
	const base = path.basename(sessionFile).replace(/\.jsonl$/, "");
	// Session files are named "<timestamp>_<sessionId>.jsonl"; strip the ts prefix.
	return sanitizeTeamId(base.replace(/^\d{4}-\d{2}-\d{2}T[\d+-]+Z_/, ""));
}

/** Walks the wait-for graph; true when `to` (transitively) waits on `from`. */
export function wouldCycle(waitingOn: Map<string, string>, from: string, to: string): boolean {
	let cur: string | undefined = to;
	const seen = new Set<string>();
	while (cur && !seen.has(cur)) {
		if (cur === from) return true;
		seen.add(cur);
		cur = waitingOn.get(cur);
	}
	return false;
}

export class TeamManager {
	private inFlight = 0;
	private slotWaiters: Array<() => void> = [];
	private lastActivity = new Map<string, number>();
	/** Serializes createMember per member name (prevents duplicate records). */
	private memberLocks = new Map<string, Promise<unknown>>();
	/** Dedupes concurrent spawns of the same member (same session id). */
	private spawning = new Map<string, Promise<MemberRpc>>();
	/** Whether the topology has been explicitly declared this session. */
	private topologyDeclared = false;
	/** Message-chain length per member while a dispatch is running. */
	private chainLengths = new Map<string, number>();
	/** Serializes claim + dispatch per task id (mirrors memberLocks). */
	private taskLocks = new Map<string, Promise<unknown>>();
	/** Member → the member it is currently waiting on (nested dispatch in flight). */
	private waitingOn = new Map<string, string>();

	private constructor(
		private reg: TeamRegistry,
		private readonly cwd: string,
		private readonly rpcs = new Map<string, MemberRpc>(),
		private readonly queues = new Map<string, Promise<unknown>>(),
	) {}

	/** Load (or create) the team bound to the leader session. */
	static forSession(sessionFile: string | null, cwd: string): TeamManager {
		let teamId: string;
		if (sessionFile) {
			const base = path.basename(sessionFile).replace(/\.jsonl$/, "");
			// Session files are named "<timestamp>_<sessionId>.jsonl"; strip the ts prefix.
			teamId = sanitizeTeamId(base.replace(/^\d{4}-\d{2}-\d{2}T[\d+-]+Z_/, ""));
		} else {
			// Ephemeral leader session: team cannot be re-attached after restart.
			teamId = `eph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		}
		const existing = loadRegistry(teamId);
		const reg = existing ?? createRegistry(teamId, cwd);
		reg.cwd = cwd;
		if (!existing) saveRegistry(reg);
		return new TeamManager(reg, cwd);
	}

	get teamId(): string {
		return this.reg.teamId;
	}

	get registryFile(): string {
		return registryPath(this.reg.teamId);
	}

	/** Unix socket of this team's server (member-to-member messaging). */
	get socketPath(): string {
		return path.join(teamDir(this.reg.teamId), "sock");
	}

	snapshot(): TeamRegistry {
		return JSON.parse(JSON.stringify(this.reg)) as TeamRegistry;
	}

	/** Current message-chain length of a member (0 when not mid-dispatch). */
	currentChainLength(name: string): number {
		return this.chainLengths.get(name) ?? 0;
	}

	/**
	 * Marks a member as mid-chain at `length` for the duration of `fn`.
	 * Dispatch wraps every run with this so the bookkeeping lives in one
	 * place; it also lets probes simulate a mid-chain member without a model.
	 */
	async withChainLength<T>(name: string, length: number, fn: () => Promise<T>): Promise<T> {
		this.chainLengths.set(name, length);
		try {
			return await fn();
		} finally {
			this.chainLengths.delete(name);
		}
	}

	/**
	 * Marks `from` as waiting on `to` for the duration of `fn` (the team
	 * server wraps every nested dispatch with this). Feeds cycle detection.
	 */
	async withWaitingOn<T>(from: string, to: string, fn: () => Promise<T>): Promise<T> {
		this.waitingOn.set(from, to);
		try {
			return await fn();
		} finally {
			if (this.waitingOn.get(from) === to) this.waitingOn.delete(from);
		}
	}

	/**
	 * True when dispatching from → to would close a wait cycle: the target is
	 * itself waiting (transitively) on the sender, so the dispatch could only
	 * deadlock on the per-member queue.
	 */
	wouldDeadlock(from: string, to: string): boolean {
		return wouldCycle(this.waitingOn, from, to);
	}

	// ------------------------------------------------------------------ members

	private findMember(name: string): MemberRecord | undefined {
		return this.reg.members.find((m) => m.name === name);
	}

	private save(): void {
		saveRegistry(this.reg);
	}

	private touch(name: string): void {
		this.lastActivity.set(name, Date.now());
	}

	/**
	 * Stops member processes that have been idle past `maxIdleMs`. Sessions
	 * persist on disk, so a reaped member resumes its context when recreated.
	 */
	async reapIdleMembers(maxIdleMs: number): Promise<string[]> {
		const now = Date.now();
		const reaped: string[] = [];
		for (const member of this.reg.members) {
			if (member.status !== "idle") continue;
			// A queued dispatch is about to use this member; don't reap it.
			if (this.queues.has(member.name)) continue;
			const last = this.lastActivity.get(member.name) ?? 0;
			if (now - last < maxIdleMs) continue;
			const rpc = this.rpcs.get(member.name);
			if (rpc) {
				// Wait for the exit so the registry's "dead" is truthful and the
				// next dispatch cannot respawn a duplicate on the same session id.
				await rpc.killAndWait();
				this.rpcs.delete(member.name);
			}
			member.status = "dead";
			member.pid = -1;
			reaped.push(member.name);
		}
		if (reaped.length > 0) this.save();
		return reaped;
	}

	async createMember(params: CreateMemberParams, leaderModel?: string): Promise<{ member: MemberRecord; created: boolean }> {
		const name = params.name.trim();
		if (!MEMBER_NAME_RE.test(name)) {
			throw new Error(
				`Invalid member name "${params.name}". Use lowercase letters, digits, "-" or "_", starting with a letter (max 32 chars).`,
			);
		}
		// Serialize per name: two concurrent creates must not both append a record.
		return this.withMemberLock(name, () => this.createMemberLocked(name, params, leaderModel));
	}

	private withMemberLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.memberLocks.get(name) ?? Promise.resolve();
		const run = prev
			.catch(() => {})
			.then(() => fn())
			.finally(() => {
				if (this.memberLocks.get(name) === run) this.memberLocks.delete(name);
			});
		this.memberLocks.set(name, run);
		return run;
	}

	private async createMemberLocked(
		name: string,
		params: CreateMemberParams,
		leaderModel?: string,
	): Promise<{ member: MemberRecord; created: boolean }> {
		const existing = this.findMember(name);
		if (existing) {
			// Idempotent: ensure it is alive, but never duplicate.
			await this.ensureLive(existing);
			return { member: { ...existing }, created: false };
		}

		const config = getConfig();
		// Only live members consume slots: dead records stay resumable (same
		// session id) but must not permanently exhaust the team cap.
		const liveMembers = this.reg.members.filter((m) => m.status !== "dead").length;
		if (liveMembers >= config.members.max) {
			throw new Error(
				`Team is full (max ${config.members.max} live members). Disband one first — disbanded and reaped members no longer count against the limit.`,
			);
		}

		// A role may reference a bundled preset (agents/<role>.md); explicit params win.
		// Without an explicit role, members default to the configured role.
		const role = params.role?.trim() || config.members.defaultRole;
		const preset = loadPreset(role, this.cwd);
		const systemPrompt = params.systemPrompt?.trim() || preset?.systemPrompt;

		const record: MemberRecord = {
			name,
			role,
			model: this.resolveMemberModel(name, params.model, preset, leaderModel, config),
			effort: this.resolveEffort(params.effort, preset?.effort, role),
			tools:
				(params.tools && params.tools.length > 0 ? [...params.tools] : undefined) ??
				preset?.tools ??
				config.members.defaultTools ??
				undefined,
			sessionId: `team-${this.reg.teamId}-${name}`,
			systemPromptFile: undefined,
			pid: -1,
			status: "dead",
			usage: emptyUsage(),
		};

		if (systemPrompt) {
			this.writeMemberPrompt(record, systemPrompt);
		}

		this.reg.members.push(record);
		this.save();

		await this.ensureLive(record);
		return { member: { ...record }, created: true };
	}

	/**
	 * Member model resolution:
	 * - autonomousSelection off: every member uses the conversation's model
	 *   (preset and explicit requests are ignored).
	 * - on: explicit param → preset model → conversation model; an explicit
	 *   model outside models.available is rejected; a preset model outside the
	 *   list degrades to the first available entry.
	 */
	private resolveMemberModel(
		name: string,
		requested: string | undefined,
		preset: AgentPreset | undefined,
		leaderModel: string | undefined,
		config: PluginConfig,
	): string | undefined {
		if (!config.models.autonomousSelection) {
			if (requested && requested !== leaderModel) {
				debugNote(
					`member "${name}": ignoring model "${requested}" — autonomous model selection is off; using the conversation model`,
				);
			}
			return leaderModel ?? config.models.available[0];
		}
		const chosen = requested ?? preset?.model;
		if (!chosen) return leaderModel ?? config.models.available[0];
		if (config.models.available.includes(chosen)) return chosen;
		if (requested) {
			throw new Error(
				`Model "${requested}" is not in the team's available models (${config.models.available.join(", ")}). ` +
					"Add it to models.available in the plugin config, or omit the model parameter.",
			);
		}
		debugNote(`member "${name}": preset model "${chosen}" is not in models.available; using "${config.models.available[0]}"`);
		return config.models.available[0];
	}

	/**
	 * Member effort resolution: an explicit, valid level always wins. With
	 * models.autonomousEffort on, the leader is expected to choose per
	 * member, so preset efforts (frontmatter and presets.effort config) are
	 * inert. Otherwise: presets.effort[role] config override → preset
	 * frontmatter effort → the default (high).
	 */
	private resolveEffort(requested: string | undefined, presetEffort?: string, role?: string): EffortLevel {
		if (requested) {
			if (!(VALID_EFFORT as readonly string[]).includes(requested)) {
				throw new Error(`Invalid effort level "${requested}". Valid levels: ${VALID_EFFORT.join(", ")}.`);
			}
			return requested as EffortLevel;
		}
		const config = getConfig();
		if (config.models.autonomousEffort) return DEFAULT_EFFORT;
		const configured = role ? config.presets.effort[role] : undefined;
		if (configured && (VALID_EFFORT as readonly string[]).includes(configured)) {
			return configured as EffortLevel;
		}
		if (presetEffort && (VALID_EFFORT as readonly string[]).includes(presetEffort)) {
			return presetEffort as EffortLevel;
		}
		return DEFAULT_EFFORT;
	}

	/**
	 * Writes the member's system prompt file, appending a coordination section
	 * that tells the member how to reach teammates through the topo_team_msg tool.
	 * The file is persisted (not tmp): respawns need the same
	 * --append-system-prompt file to resume with identical configuration.
	 */
	private writeMemberPrompt(member: MemberRecord, basePrompt: string): void {
		const promptsDir = memberPromptsDir(this.reg.teamId);
		fs.mkdirSync(promptsDir, { recursive: true });
		const file = path.join(promptsDir, `${member.name}.md`);
		const coordination = [
			"",
			"## Team messaging",
			`You are member "${member.name}" of an agent team coordinated by a leader.`,
			"Direct member-to-member messaging is gated by the team topology.",
			"Use the topo_team_msg tool to message an allowed teammate (to = their name).",
			"The leader is not a messaging target — it is not part of the topology and has no inbox; everything you report reaches the leader through your final report (task result / reply to its dispatch).",
			"A rejection lists the teammates you may message. If none of them fits, state the need in your final report instead — the leader will relay it.",
			"If topo_team_msg fails (e.g. a connection error), do NOT investigate the tooling — proceed with your task and note the failure in your final report.",
			"Keep messages short and specific; prefer finishing your own task over chatting.",
		].join("\n");
		fs.writeFileSync(file, `${basePrompt}\n${coordination}\n`, { encoding: "utf-8", mode: 0o600 });
		member.systemPromptFile = file;
	}

	/**
	 * Spawn arguments and environment for a member process. When the member's
	 * depth is below maxRecursionDepth it is granted its own sub-team: this
	 * extension is loaded and auto-activated. Otherwise the member stays
	 * isolated (--no-extensions, no recursive teams) except for the member-side
	 * messaging extension, which only registers the topo_team_msg tool.
	 */
	private buildSpawnArgs(member: MemberRecord): { args: string[]; env: Record<string, string> } {
		const childDepth = currentDepth() + 1;
		const canOrchestrate = childDepth < getConfig().members.maxRecursionDepth;
		const args = [
			"--mode",
			"rpc",
			"--session-id",
			member.sessionId,
			"--session-dir",
			memberSessionsDir(this.reg.teamId),
		];
		const env: Record<string, string> = {
			STEPCODE_TEAM_SOCK: this.socketPath,
			STEPCODE_TEAM_MEMBER: member.name,
			STEPCODE_TEAM_DEPTH: String(childDepth),
			// Effective depth bound (it may come from a project-level config the
			// child cannot read at load time); the child's config loader honors it.
			STEPCODE_TEAM_MAXDEPTH: String(getConfig().members.maxRecursionDepth),
		};
		if (canOrchestrate) {
			args.push("-e", extensionEntryPath(), "-e", memberMessagingEntryPath());
			env.STEPCODE_TEAM_AUTOACTIVATE = "1";
		} else {
			// Isolation: members must not load package extensions (no recursive
			// teams). The member-side messaging extension is the single explicit
			// exception — it only registers the topo_team_msg tool (no orchestration
			// capability), so read-only roles can use their topology edges
			// without bash. `--no-extensions -e <path>` is a supported combo.
			args.push("--no-extensions", "-e", memberMessagingEntryPath());
		}
		if (member.model) args.push("--model", member.model);
		// `--thinking` is the host CLI's own flag name; our terminology is "effort".
		if (member.effort) args.push("--thinking", member.effort);
		if (member.tools && member.tools.length > 0) {
			// --tools is an allowlist over built-in AND extension tools. topo_team_msg
			// is team infrastructure (no bash needed) and the sub-leader team
			// tools are added on top of the preset/explicit allowlist.
			const allow = [...new Set([...member.tools, "topo_team_msg", ...(canOrchestrate ? TEAM_TOOL_NAMES : [])])];
			args.push("--tools", allow.join(","));
		}
		if (member.systemPromptFile) args.push("--append-system-prompt", member.systemPromptFile);
		return { args, env };
	}

	/**
	 * Returns a live member process, spawning at most one per member name.
	 * Concurrent callers (e.g. createMember and sendMessage racing inside one
	 * tool batch) join the same in-flight spawn instead of starting duplicate
	 * processes that would share one session id.
	 */
	private ensureLive(member: MemberRecord): Promise<MemberRpc> {
		const existing = this.rpcs.get(member.name);
		if (existing && !existing.isClosed()) return Promise.resolve(existing);

		const inFlight = this.spawning.get(member.name);
		if (inFlight) return inFlight;

		const run = this.doSpawn(member).finally(() => {
			if (this.spawning.get(member.name) === run) this.spawning.delete(member.name);
		});
		this.spawning.set(member.name, run);
		return run;
	}

	private async doSpawn(member: MemberRecord): Promise<MemberRpc> {
		fs.mkdirSync(memberSessionsDir(this.reg.teamId), { recursive: true });
		const handlers: MemberRpcHandlers = {
			onClose: () => {
				this.rpcs.delete(member.name);
				// Any exit (including an external kill) means the process is
				// gone; keep the registry honest instead of a stale "idle".
				if (member.status !== "dead") {
					member.status = "dead";
					this.save();
				}
			},
		};
		const config = getConfig();
		const { args, env } = this.buildSpawnArgs(member);
		const rpc = await MemberRpc.spawn(args, this.cwd, {
			handlers,
			env,
			handshakeTimeoutMs: config.dispatch.handshakeTimeoutMs,
			requestTimeoutMs: config.dispatch.timeoutMs,
		});
		// Defensive: another spawn may have won while we were awaiting.
		const existing = this.rpcs.get(member.name);
		if (existing && !existing.isClosed()) {
			rpc.kill();
			return existing;
		}
		this.rpcs.set(member.name, rpc);
		this.touch(member.name);
		member.pid = rpc.pid;
		member.status = "idle";
		this.save();
		return rpc;
	}

	async sendMessage(name: string, message: string, options: SendOptions = {}): Promise<SendResult> {
		const member = this.findMember(name);
		if (!member) {
			const available = this.reg.members.map((m) => m.name).join(", ") || "none";
			throw new Error(`Unknown member "${name}". Available members: ${available}.`);
		}

		// Per-member serialization: prompts to one member run one at a time;
		// parallelism happens across members. A failed predecessor must not
		// poison the queue, hence the catch before chaining.
		const prev = this.queues.get(name) ?? Promise.resolve();
		const run = prev
			.catch(() => {})
			.then(() => this.dispatch(member, message, options))
			.finally(() => {
				if (this.queues.get(name) === run) this.queues.delete(name);
			});
		this.queues.set(name, run);
		return run;
	}

	private async dispatch(member: MemberRecord, message: string, options: SendOptions = {}): Promise<SendResult> {
		const signal = options.signal;
		if (signal?.aborted) throw new Error("member dispatch aborted before start");
		this.assertTopologyDeclared();
		if (options.nested) {
			// Nested (member-to-member) dispatch: the sender already occupies a
			// running slot, so acquiring another one here could deadlock the
			// chain (A waits for B while holding the last slot).
			this.assertLoopBound(options.chainLength ?? 0);
			return this.runDispatch(member, message, options);
		}
		// Concurrency gate BEFORE the process starts: beyond maxConcurrent this
		// member waits for a running peer to finish before it starts at all.
		await this.acquireSlot();
		try {
			return await this.runDispatch(member, message, options);
		} finally {
			this.releaseSlot();
		}
	}

	private async runDispatch(member: MemberRecord, message: string, options: SendOptions = {}): Promise<SendResult> {
		return this.withChainLength(member.name, options.chainLength ?? 0, () =>
			this.runDispatchInner(member, message, options),
		);
	}

	private async runDispatchInner(member: MemberRecord, message: string, options: SendOptions = {}): Promise<SendResult> {
		let rpc: MemberRpc | null = null;
		let unsubscribe = (): void => {};
		try {
			const wasDead = !this.rpcs.get(member.name) || this.rpcs.get(member.name)!.isClosed();
			rpc = await this.ensureLive(member);
			this.touch(member.name);
			member.status = "running";
			this.save();
			if (options.onProgress) unsubscribe = rpc.onInterim(options.onProgress);
			const { text, usage } = await rpc.promptAndSettle(message, options.signal);
			member.usage = addUsage(member.usage, usage);
			member.status = "idle";
			this.save();
			return { member: member.name, text, usage: member.usage, resumed: wasDead };
		} catch (err) {
			member.status = "dead";
			this.save();
			// The member may still be mid-run (timeout/abort). Kill it and wait
			// for exit so the next dispatch respawns a clean process instead of
			// interleaving runs on one session id.
			if (rpc) {
				this.rpcs.delete(member.name);
				await rpc.killAndWait();
			}
			throw augmentDispatchError(err, this.reg.members, options.nested === true);
		} finally {
			unsubscribe();
			// Refresh the idle clock from completion (not run start), so a member
			// that just finished a long task is not reaped immediately.
			this.touch(member.name);
		}
	}

	// ------------------------------------------------------------------ tasks

	async createTask(params: CreateTaskParams): Promise<TaskRecord> {
		const title = params.title?.trim();
		if (!title) throw new Error("Task title must not be empty.");
		const task: TaskRecord = {
			id: nextTaskId(this.reg.tasks),
			title,
			detail: params.detail?.trim() || undefined,
			blockedBy: params.blockedBy ?? [],
			assignee: params.assignee?.trim() || undefined,
			status: "pending",
			result: undefined,
		};
		this.reg.tasks.push(task);
		try {
			validateGraph(this.reg.tasks);
		} catch (err) {
			this.reg.tasks.pop();
			throw err;
		}
		recomputeReady(this.reg.tasks);
		this.save();
		return { ...task };
	}

	private findTask(id: string): TaskRecord {
		const task = this.reg.tasks.find((t) => t.id === id);
		if (!task) {
			const available = this.reg.tasks.map((t) => t.id).join(", ") || "none";
			throw new Error(`Unknown task "${id}". Existing tasks: ${available}.`);
		}
		return task;
	}

	/** Dispatch a ready task to a member and wait for completion (one retry on failure). */
	async startTask(
		id: string,
		assignee?: string,
		message?: string,
		options: SendOptions = {},
	): Promise<{ task: TaskRecord; text: string }> {
		this.assertTopologyDeclared();
		const task = this.findTask(id);
		if (task.status !== "ready") {
			const blockers = task.blockedBy.join(", ") || "none";
			throw new Error(`Task "${id}" is "${task.status}", not "ready" (blocked by: ${blockers}).`);
		}
		const target = assignee?.trim() || task.assignee;
		if (!target) throw new Error(`Task "${id}" has no assignee. Pass assignee or set it when creating the task.`);
		if (!this.findMember(target)) {
			const available = this.reg.members.map((m) => m.name).join(", ") || "none";
			throw new Error(`Unknown member "${target}". Available members: ${available}.`);
		}
		// Serialize claim + dispatch per task id: two concurrent starts must not
		// both pass the "ready" gate and run (and bill) the work twice.
		return this.withTaskLock(id, () => this.startTaskLocked(id, target, message, options));
	}

	private async startTaskLocked(
		id: string,
		target: string,
		message: string | undefined,
		options: SendOptions,
	): Promise<{ task: TaskRecord; text: string }> {
		const task = this.findTask(id);
		if (task.status !== "ready") {
			const blockers = task.blockedBy.join(", ") || "none";
			throw new Error(`Task "${id}" is "${task.status}", not "ready" (blocked by: ${blockers}).`);
		}
		task.assignee = target;
		task.status = "running";
		this.save();

		const prompt = message?.trim() || taskPrompt(task);
		let lastError: unknown;
		for (let attempt = 0; attempt <= getConfig().dispatch.retries; attempt++) {
			if (options.signal?.aborted) break;
			try {
				const result = await this.sendMessage(target, prompt, options);
				// A concurrent manual complete may have closed the task already;
				// it IS done, so tolerate the terminal-state error.
				try {
					return { task: this.completeTask(id, result.text), text: result.text };
				} catch (closeErr) {
					if (!/already "(done|failed)"/.test(closeErr instanceof Error ? closeErr.message : "")) throw closeErr;
					return { task: this.findTask(id), text: result.text };
				}
			} catch (err) {
				lastError = err;
				if (options.signal?.aborted) break;
			}
		}
		const aborted = options.signal?.aborted === true;
		try {
			this.failTask(id, aborted ? "aborted by leader" : lastError instanceof Error ? lastError.message : String(lastError));
		} catch {
			// Already terminal via another path; the original error matters more.
		}
		if (aborted) throw new Error("Task dispatch aborted by leader.");
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	/** Serializes same-id task dispatches (mirrors withMemberLock). */
	private withTaskLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.taskLocks.get(id) ?? Promise.resolve();
		const run = prev
			.catch(() => {})
			.then(fn)
			.finally(() => {
				if (this.taskLocks.get(id) === run) this.taskLocks.delete(id);
			});
		this.taskLocks.set(id, run);
		return run;
	}

	/** Only non-terminal tasks may be closed manually. */
	private assertCloseable(task: TaskRecord, action: string): void {
		if (task.status === "done" || task.status === "failed") {
			throw new Error(`Task "${task.id}" is already "${task.status}"; cannot ${action}.`);
		}
	}

	completeTask(id: string, result: string): TaskRecord {
		const task = this.findTask(id);
		this.assertCloseable(task, "mark done");
		task.status = "done";
		task.result = result;
		recomputeReady(this.reg.tasks);
		this.save();
		return { ...task };
	}

	failTask(id: string, reason: string): TaskRecord {
		const task = this.findTask(id);
		this.assertCloseable(task, "mark failed");
		task.status = "failed";
		task.result = reason;
		recomputeReady(this.reg.tasks);
		this.save();
		return { ...task };
	}

	// ------------------------------------------------------------------ topology

	/**
	 * Declares the member-to-member communication topology. Edges are validated
	 * against the current member list; unknown members and self-loops throw.
	 */
	setTopology(shape: TopologyShape, edges?: TopologyEdge[]): TopologyData {
		const members = this.reg.members.map((m) => m.name);
		const data = normalizeTopology(buildTopology({ shape, members, edges }));
		validateTopology(data, members);
		this.reg.topology = data;
		this.topologyDeclared = true;
		this.save();
		return { shape: data.shape, edges: data.edges.map(([from, to]) => [from, to] as TopologyEdge) };
	}

	getTopology(): TopologyData {
		return this.reg.topology;
	}

	mayMessage(from: string, to: string): boolean {
		return topologyMayMessage(this.reg.topology, from, to);
	}

	outboundTargets(from: string): string[] {
		return topologyOutbound(this.reg.topology, from);
	}

	describeTopology(): string {
		return describeTopology(this.reg.topology, this.reg.members.map((m) => m.name));
	}

	/** When configured, work cannot be dispatched until the topology is declared. */
	private assertTopologyDeclared(): void {
		if (getConfig().topology.requireDeclaration && !this.topologyDeclared) {
			throw new TopologyError(
				"Communication topology has not been declared yet. Design it first with team_set_topology (star/pipeline/mesh/ring/custom), then dispatch work.",
			);
		}
	}

	/** Bounds member-to-member chain length (ring circulation); 0 = unlimited. */
	private assertLoopBound(chainLength: number): void {
		const limit = getConfig().topology.maxLoopCount;
		if (limit > 0 && chainLength > limit) {
			throw new TopologyError(
				`Message chain length ${chainLength} exceeds the ring loop limit (${limit}). ` +
					"State the need in your final report instead of forwarding further — the leader is not a messaging target.",
			);
		}
	}

	/** Drops edges that reference a removed member. */
	private pruneTopologyMember(name: string): void {
		const edges = this.reg.topology.edges.filter(([from, to]) => from !== name && to !== name);
		if (edges.length !== this.reg.topology.edges.length) {
			this.reg.topology = { shape: this.reg.topology.shape, edges };
		}
	}

	// ------------------------------------------------------------------ oneshot

	/**
	 * Stateless one-shot dispatch: a fresh `step -p --mode json` process with
	 * the member's config, no persistent process or session. For short,
	 * fire-and-forget work where context continuity does not matter.
	 */
	async sendOneshot(name: string, message: string, options: SendOptions = {}): Promise<SendResult> {
		const member = this.findMember(name);
		if (!member) {
			const available = this.reg.members.map((m) => m.name).join(", ") || "none";
			throw new Error(`Unknown member "${name}". Available members: ${available}.`);
		}
		if (options.signal?.aborted) throw new Error("oneshot dispatch aborted before start");
		this.assertTopologyDeclared();
		const args = ["-p", "--mode", "json", "--no-session", "--no-extensions"];
		if (member.model) args.push("--model", member.model);
		if (member.effort) args.push("--thinking", member.effort);
		if (member.tools && member.tools.length > 0) args.push("--tools", member.tools.join(","));
		if (member.systemPromptFile) args.push("--append-system-prompt", member.systemPromptFile);
		args.push(message);

		// Oneshots count against the same concurrency budget as persistent runs.
		await this.acquireSlot();
		member.status = "running";
		this.save();
		try {
			const { text, usage } = await this.runOneshot(args, options.signal);
			member.usage = addUsage(member.usage, usage);
			return { member: member.name, text, usage: member.usage, resumed: false };
		} finally {
			// A oneshot runs in its own throwaway process; the persistent member
			// stays usable, so return it to idle either way.
			member.status = "idle";
			this.save();
			this.releaseSlot();
		}
	}

	private runOneshot(args: string[], signal?: AbortSignal): Promise<{ text: string; usage: MemberUsage }> {
		const invocation = getStepInvocation(args);
		return new Promise((resolve, reject) => {
			const proc = spawn(invocation.command, invocation.args, {
				cwd: this.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";
			let text = "";
			let stderr = "";
			let aborted = false;
			let exited = false;
			const usage = emptyUsage();
			// `proc.killed` stays true once a signal is delivered, so escalate
			// from the real exit state instead.
			const terminate = (): void => {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!exited) proc.kill("SIGKILL");
				}, 3000).unref();
			};
			const timer = setTimeout(() => {
				terminate();
				reject(new Error("oneshot dispatch timed out"));
			}, getConfig().oneshot.timeoutMs);

			const onAbort = (): void => {
				aborted = true;
				terminate();
			};
			if (signal) {
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			}

			const consumeLine = (line: string): void => {
				if (!line.trim()) return;
				let event: Record<string, unknown>;
				try {
					event = JSON.parse(line) as Record<string, unknown>;
				} catch {
					return;
				}
				const msg = event.message as
					| { role?: string; content?: unknown[]; usage?: Record<string, number> }
					| undefined;
				if (event.type === "message_end" && msg?.role === "assistant") {
					usage.turns += 1;
					const u = msg.usage;
					if (u) {
						usage.input += u.input || 0;
						usage.output += u.output || 0;
						usage.cost += u.cost?.total || 0;
					}
					for (const part of msg.content ?? []) {
						const p = part as { type?: string; text?: string };
						if (p.type === "text" && p.text) text = p.text;
					}
				}
			};

			proc.stdout.on("data", (data: Buffer) => {
				buffer += data.toString("utf8");
				let idx: number;
				while ((idx = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, idx).replace(/\r$/, "");
					buffer = buffer.slice(idx + 1);
					consumeLine(line);
				}
			});
			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString();
			});
			proc.on("close", (code) => {
				exited = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				consumeLine(buffer); // flush trailing partial line
				if (aborted) {
					reject(new Error("oneshot dispatch aborted"));
					return;
				}
				if (code === 0) resolve({ text, usage });
				else reject(new Error(`oneshot exited with code ${code ?? "null"}: ${stderr.slice(-500)}`));
			});
			proc.on("error", (err: Error) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				reject(new Error(`oneshot spawn failed: ${err.message}`));
			});
		});
	}

	// ------------------------------------------------------------------ slots

	private async acquireSlot(): Promise<void> {
		// Never barge past queued waiters: with hand-over, a non-empty waiter
		// queue implies every slot is taken.
		if (this.slotWaiters.length === 0 && this.inFlight < getConfig().dispatch.maxConcurrent) {
			this.inFlight += 1;
			return;
		}
		await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
		// The slot was handed over by releaseSlot; inFlight already counts it.
	}

	private releaseSlot(): void {
		// Hand the slot directly to the next waiter (inFlight unchanged) so a
		// fresh caller cannot squeeze in between release and the waiter's
		// continuation — that race let in-flight dispatches exceed the cap.
		const next = this.slotWaiters.shift();
		if (next) {
			next();
			return;
		}
		this.inFlight -= 1;
	}

	private killMember(member: MemberRecord): void {
		const rpc = this.rpcs.get(member.name);
		if (rpc) {
			rpc.kill();
			this.rpcs.delete(member.name);
		}
	}

	/** Drops per-member bookkeeping so a recreated member starts clean. */
	private forgetMemberState(name?: string): void {
		if (name === undefined) {
			this.lastActivity.clear();
			this.queues.clear();
			this.chainLengths.clear();
			this.memberLocks.clear();
			this.spawning.clear();
			this.waitingOn.clear();
			this.taskLocks.clear();
			return;
		}
		this.lastActivity.delete(name);
		this.queues.delete(name);
		this.chainLengths.delete(name);
		this.memberLocks.delete(name);
		this.spawning.delete(name);
		this.waitingOn.delete(name);
	}

	async disband(name?: string): Promise<string[]> {
		if (name) {
			const member = this.findMember(name);
			if (!member) {
				const available = this.reg.members.map((m) => m.name).join(", ") || "none";
				throw new Error(`Unknown member "${name}". Available members: ${available}.`);
			}
			this.killMember(member);
			member.status = "dead";
			member.pid = -1;
			this.pruneTopologyMember(member.name);
			this.forgetMemberState(member.name);
			this.save();
			return [member.name];
		}
		const killed: string[] = [];
		for (const member of this.reg.members) {
			this.killMember(member);
			if (member.status !== "dead") {
				member.status = "dead";
				member.pid = -1;
			}
			killed.push(member.name);
		}
		this.reg.members = [];
		// A disbanded team starts fresh: star topology, declaration cleared.
		this.reg.topology = starTopology();
		this.topologyDeclared = false;
		this.forgetMemberState();
		this.save();
		return killed;
	}

	/** session_shutdown: stop children so no orphans survive the leader. */
	shutdown(): void {
		// Reflect reality in the registry: after this call no member is alive.
		for (const member of this.reg.members) {
			if (member.status !== "dead") {
				member.status = "dead";
				member.pid = -1;
			}
		}
		this.save();
		for (const rpc of this.rpcs.values()) rpc.kill();
		this.rpcs.clear();
	}
}
