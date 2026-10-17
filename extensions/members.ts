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
import { loadPreset, shimPath } from "./presets.ts";
import { nextTaskId, recomputeReady, taskPrompt, validateGraph } from "./tasks.ts";

export interface CreateMemberParams {
	name: string;
	role?: string;
	model?: string;
	tools?: string[];
	systemPrompt?: string;
}

export interface SendResult {
	member: string;
	text: string;
	usage: MemberUsage;
	resumed: boolean;
}

export interface CreateTaskParams {
	title: string;
	detail?: string;
	blockedBy?: string[];
	assignee?: string;
}

const MEMBER_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_MEMBERS = 8;
const MAX_CONCURRENCY = 4;
const ONESHOT_TIMEOUT_MS = 180_000;

function sanitizeTeamId(sessionId: string): string {
	const cleaned = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 48);
	return cleaned || `team-${Date.now().toString(36)}`;
}

export class TeamManager {
	private inFlight = 0;
	private slotWaiters: Array<() => void> = [];
	private lastActivity = new Map<string, number>();

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
			const last = this.lastActivity.get(member.name) ?? 0;
			if (now - last < maxIdleMs) continue;
			const rpc = this.rpcs.get(member.name);
			if (rpc) {
				rpc.kill();
				this.rpcs.delete(member.name);
			}
			member.status = "dead";
			member.pid = -1;
			reaped.push(member.name);
		}
		if (reaped.length > 0) this.save();
		return reaped;
	}

	async createMember(params: CreateMemberParams): Promise<{ member: MemberRecord; created: boolean }> {
		const name = params.name.trim();
		if (!MEMBER_NAME_RE.test(name)) {
			throw new Error(
				`Invalid member name "${params.name}". Use lowercase letters, digits, "-" or "_", starting with a letter (max 32 chars).`,
			);
		}

		const existing = this.findMember(name);
		if (existing) {
			// Idempotent: ensure it is alive, but never duplicate.
			await this.ensureLive(existing);
			return { member: { ...existing }, created: false };
		}

		if (this.reg.members.length >= MAX_MEMBERS) {
			throw new Error(`Team is full (max ${MAX_MEMBERS} members). Disband one first.`);
		}

		// A role may reference a bundled preset (agents/<role>.md); explicit params win.
		const preset = params.role ? loadPreset(params.role) : undefined;
		const systemPrompt = params.systemPrompt?.trim() || preset?.systemPrompt;

		const record: MemberRecord = {
			name,
			role: params.role?.trim() || name,
			model: params.model ?? preset?.model,
			tools: (params.tools && params.tools.length > 0 ? [...params.tools] : undefined) ?? preset?.tools,
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
	 * Writes the member's system prompt file, appending a coordination section
	 * that tells the member how to reach teammates through the CLI shim.
	 * The file is persisted (not tmp): respawns need the same
	 * --append-system-prompt file to resume with identical configuration.
	 */
	private writeMemberPrompt(member: MemberRecord, basePrompt: string): void {
		const promptsDir = memberPromptsDir(this.reg.teamId);
		fs.mkdirSync(promptsDir, { recursive: true });
		const file = path.join(promptsDir, `${member.name}.md`);
		const shim = shimPath();
		const coordination = [
			"",
			"## Team messaging",
			`You are member "${member.name}" of an agent team coordinated by a leader.`,
			"When you need facts only a teammate has, message them directly instead of guessing:",
			`  node ${shim} msg --to <teammate> --message "<text>"`,
			`  node ${shim} status`,
			"Keep messages short and specific; prefer finishing your own task over chatting.",
		].join("\n");
		fs.writeFileSync(file, `${basePrompt}\n${coordination}\n`, { encoding: "utf-8", mode: 0o600 });
		member.systemPromptFile = file;
	}

	private buildSpawnArgs(member: MemberRecord): string[] {
		const args = [
			"--mode",
			"rpc",
			"--session-id",
			member.sessionId,
			"--session-dir",
			memberSessionsDir(this.reg.teamId),
			// Isolation: members must not load this extension (no recursive teams).
			"--no-extensions",
		];
		if (member.model) args.push("--model", member.model);
		if (member.tools && member.tools.length > 0) args.push("--tools", member.tools.join(","));
		if (member.systemPromptFile) args.push("--append-system-prompt", member.systemPromptFile);
		return args;
	}

	private async ensureLive(member: MemberRecord): Promise<MemberRpc> {
		const existing = this.rpcs.get(member.name);
		if (existing && !existing.isClosed()) return existing;

		fs.mkdirSync(memberSessionsDir(this.reg.teamId), { recursive: true });
		const handlers: MemberRpcHandlers = {
			onClose: () => {
				this.rpcs.delete(member.name);
				if (member.status === "running") {
					member.status = "dead";
					this.save();
				}
			},
		};
		const rpc = await MemberRpc.spawn(this.buildSpawnArgs(member), this.cwd, handlers, {
			STEPCODE_TEAM_SOCK: this.socketPath,
		});
		this.rpcs.set(member.name, rpc);
		this.touch(member.name);
		member.pid = rpc.pid;
		member.status = "idle";
		this.save();
		return rpc;
	}

	async sendMessage(name: string, message: string): Promise<SendResult> {
		const member = this.findMember(name);
		if (!member) {
			const available = this.reg.members.map((m) => m.name).join(", ") || "none";
			throw new Error(`Unknown member "${name}". Available members: ${available}.`);
		}

		// Per-member serialization: prompts to one member run one at a time;
		// parallelism happens across members.
		const prev = this.queues.get(name) ?? Promise.resolve();
		const run = prev.then(() => this.dispatch(member, message)).finally(() => {
			if (this.queues.get(name) === run) this.queues.delete(name);
		});
		this.queues.set(name, run);
		return run;
	}

	private async dispatch(member: MemberRecord, message: string): Promise<SendResult> {
		const wasDead = !this.rpcs.get(member.name) || this.rpcs.get(member.name)!.isClosed();
		const rpc = await this.ensureLive(member);
		this.touch(member.name);
		member.status = "running";
		this.save();
		await this.acquireSlot();
		try {
			const { text, usage } = await rpc.promptAndSettle(message);
			member.usage = addUsage(member.usage, usage);
			member.status = "idle";
			this.save();
			return { member: member.name, text, usage: member.usage, resumed: wasDead };
		} catch (err) {
			member.status = "dead";
			this.save();
			throw err;
		} finally {
			this.releaseSlot();
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
	async startTask(id: string, assignee?: string, message?: string): Promise<{ task: TaskRecord; text: string }> {
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

		task.assignee = target;
		task.status = "running";
		this.save();

		const prompt = message?.trim() || taskPrompt(task);
		let lastError: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const result = await this.sendMessage(target, prompt);
				return { task: this.completeTask(id, result.text), text: result.text };
			} catch (err) {
				lastError = err;
			}
		}
		this.failTask(id, lastError instanceof Error ? lastError.message : String(lastError));
		throw lastError instanceof Error ? lastError : new Error(String(lastError));
	}

	completeTask(id: string, result: string): TaskRecord {
		const task = this.findTask(id);
		task.status = "done";
		task.result = result;
		recomputeReady(this.reg.tasks);
		this.save();
		return { ...task };
	}

	failTask(id: string, reason: string): TaskRecord {
		const task = this.findTask(id);
		task.status = "failed";
		task.result = reason;
		recomputeReady(this.reg.tasks);
		this.save();
		return { ...task };
	}

	// ------------------------------------------------------------------ oneshot

	/**
	 * Stateless one-shot dispatch: a fresh `step -p --mode json` process with
	 * the member's config, no persistent process or session. For short,
	 * fire-and-forget work where context continuity does not matter.
	 */
	async sendOneshot(name: string, message: string): Promise<SendResult> {
		const member = this.findMember(name);
		if (!member) {
			const available = this.reg.members.map((m) => m.name).join(", ") || "none";
			throw new Error(`Unknown member "${name}". Available members: ${available}.`);
		}
		const args = ["-p", "--mode", "json", "--no-session", "--no-extensions"];
		if (member.model) args.push("--model", member.model);
		if (member.tools && member.tools.length > 0) args.push("--tools", member.tools.join(","));
		if (member.systemPromptFile) args.push("--append-system-prompt", member.systemPromptFile);
		args.push(message);

		const { text, usage } = await this.runOneshot(args);
		member.usage = addUsage(member.usage, usage);
		this.save();
		return { member: member.name, text, usage: member.usage, resumed: false };
	}

	private runOneshot(args: string[]): Promise<{ text: string; usage: MemberUsage }> {
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
			const usage = emptyUsage();
			const timer = setTimeout(() => {
				proc.kill("SIGTERM");
				reject(new Error("oneshot dispatch timed out"));
			}, ONESHOT_TIMEOUT_MS);

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
				clearTimeout(timer);
				consumeLine(buffer); // flush trailing partial line
				if (code === 0) resolve({ text, usage });
				else reject(new Error(`oneshot exited with code ${code ?? "null"}: ${stderr.slice(-500)}`));
			});
			proc.on("error", (err: Error) => {
				clearTimeout(timer);
				reject(new Error(`oneshot spawn failed: ${err.message}`));
			});
		});
	}

	// ------------------------------------------------------------------ slots

	private async acquireSlot(): Promise<void> {
		if (this.inFlight < MAX_CONCURRENCY) {
			this.inFlight += 1;
			return;
		}
		await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
		this.inFlight += 1;
	}

	private releaseSlot(): void {
		this.inFlight -= 1;
		const next = this.slotWaiters.shift();
		if (next) next();
	}

	async disband(name?: string): Promise<string[]> {
		const targets = name ? [this.findMember(name)].filter(Boolean) : this.reg.members;
		const killed: string[] = [];
		for (const member of targets as MemberRecord[]) {
			const rpc = this.rpcs.get(member.name);
			if (rpc) {
				rpc.kill();
				this.rpcs.delete(member.name);
			}
			if (member.status !== "dead") {
				member.status = "dead";
				member.pid = -1;
			}
			killed.push(member.name);
		}
		if (!name) this.reg.members = [];
		this.save();
		return killed;
	}

	/** session_shutdown: stop children so no orphans survive the leader. */
	shutdown(): void {
		for (const rpc of this.rpcs.values()) rpc.kill();
		this.rpcs.clear();
	}
}
