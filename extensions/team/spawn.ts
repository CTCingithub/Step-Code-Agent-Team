/**
 * Member spawn: arguments, environment, model and effort resolution.
 *
 * Split out of members.ts because this is the one place that decides what a
 * member process actually runs with, and it is pure — every input is passed in,
 * so the whole spawn contract can be asserted without starting a process.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginConfig } from "../config.ts";
import { DEFAULT_EFFORT, VALID_EFFORT, type EffortLevel, getConfig, searcherSpawnEnv } from "../config.ts";
import {
	extensionEntryPath,
	memberMessagingEntryPath,
	type AgentPreset,
	searchScriptPath,
} from "../presets.ts";
import { memberPromptsDir, memberSessionsDir, type MemberRecord } from "../registry.ts";
import { TEAM_TOOL_NAMES } from "../activation.ts";
import { currentDepth } from "./errors.ts";

export interface SpawnPlan {
	args: string[];
	env: Record<string, string>;
}

/** A member name is safe as a file name and an RPC identity (see naming.ts). */
export const MEMBER_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

function debugNote(message: string): void {
	if (getConfig().debug) console.error(`[stepcode-agent-team] ${message}`);
}

/**
 * The model a member actually spawns with when neither an explicit request
 * nor a preset pins one: the conversation model when the team can spawn it,
 * otherwise the first entry of models.available (the same degradation a
 * preset model outside the list gets). Returns undefined only when the pool
 * is empty, which lets the member fall back to its own default.
 *
 * The conversation model is a composite "provider/id" string while
 * models.available holds spawnable ids — so the fallback validates too. Without
 * that check a member with no preset model spawned with an id the team could
 * not resolve and never settled: every dispatch died on a settle timeout with
 * zero usage and no diagnostic.
 */
export function spawnableModel(
	name: string,
	leaderModel: string | undefined,
	config: PluginConfig,
): string | undefined {
	if (leaderModel && config.models.available.includes(leaderModel)) return leaderModel;
	debugNote(
		`member "${name}": conversation model "${leaderModel ?? "unknown"}" is not in models.available; using "${config.models.available[0] ?? "member default"}"`,
	);
	return config.models.available[0];
}

/** Resolves the member's model, throwing when an explicit request is unusable. */
export function resolveMemberModel(
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
		return spawnableModel(name, leaderModel, config);
	}
	const chosen = requested ?? preset?.model;
	if (!chosen) return spawnableModel(name, leaderModel, config);
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
 * models.autonomousEffort on, the leader is expected to choose per member, so
 * preset efforts (frontmatter and presets.effort config) are inert. Otherwise:
 * presets.effort[role] config override → preset frontmatter effort → the
 * default (high).
 */
export function resolveEffort(requested: string | undefined, presetEffort?: string, role?: string): EffortLevel {
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
export function writeMemberPrompt(teamId: string, member: MemberRecord, basePrompt: string): void {
	const promptsDir = memberPromptsDir(teamId);
	fs.mkdirSync(promptsDir, { recursive: true });
	const file = path.join(promptsDir, `${member.name}.md`);
	const coordination = [
		"",
		"## Team messaging",
		`You are member "${member.name}" of a Topology Agent Team coordinated by a leader.`,
		"Direct member-to-member messaging is gated by the team topology.",
		"Use the topo_team_msg tool to message an allowed teammate (to = their name).",
		"The leader is not a messaging target — it is not part of the topology and has no inbox; everything you report reaches the leader through your final report (task result / reply to its dispatch).",
		"A rejection lists the teammates you may message. If none of them fits, state the need in your final report instead — the leader will relay it.",
		// Provenance: the tool asserts DELIVERY, but a reply's text is the
		// teammate's own statement and its factual claims are unverified. In the
		// 2026-10-30 round a reply carried a fabricated "the ring already hit
		// maxLoopCount" claim; its receiver distrusted it only by luck.
		"A teammate's reply is their own statement, not verified fact — delivery is confirmed, but check any claims before repeating them to others or acting on them.",
		"If topo_team_msg fails (e.g. a connection error), do NOT investigate the tooling — proceed with your task and note the failure in your final report.",
		"Keep messages short and specific; prefer finishing your own task over chatting.",
	].join("\n");
	fs.writeFileSync(file, `${basePrompt}\n${coordination}\n`, { encoding: "utf8", mode: 0o600 });
	member.systemPromptFile = file;
}

/**
 * Spawn arguments and environment for a member process. When the member's
 * depth is below maxRecursionDepth it is granted its own sub-team: this
 * extension is loaded and auto-activated. Otherwise the member stays isolated
 * (--no-extensions, no recursive teams) except for the member-side messaging
 * extension, which only registers the topo_team_msg tool.
 */
export function buildSpawnArgs(teamId: string, socketPath: string, member: MemberRecord): SpawnPlan {
	const childDepth = currentDepth() + 1;
	const config = getConfig();
	const canOrchestrate = childDepth < config.members.maxRecursionDepth;
	const args = [
		"--mode",
		"rpc",
		"--session-id",
		member.sessionId,
		"--session-dir",
		memberSessionsDir(teamId),
	];
	const env: Record<string, string> = {
		STEPCODE_TEAM_SOCK: socketPath,
		STEPCODE_TEAM_MEMBER: member.name,
		STEPCODE_TEAM_DEPTH: String(childDepth),
		// Effective depth bound (it may come from a project-level config the
		// child cannot read at load time); the child's config loader honors it.
		STEPCODE_TEAM_MAXDEPTH: String(config.members.maxRecursionDepth),
		// Effective dispatch timeout: the member-side topo_team_msg reply wait
		// must not give up before the leader-side dispatch that contains it
		// (a nested relay outliving its outer dispatch produced the recurring
		// "timeout waiting for member to settle" loop).
		STEPCODE_TEAM_REPLY_TIMEOUT_MS: String(config.dispatch.timeoutMs),
	};
	// Searcher endpoints/credentials. Only non-empty values are injected, so
	// an unconfigured team leaves the member's environment untouched and the
	// stepfun defaults apply (the host resolves its own credential). The
	// mapping lives in config.ts so the probe can assert the real function.
	Object.assign(env, searcherSpawnEnv(config.searcher, searchScriptPath()));
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
