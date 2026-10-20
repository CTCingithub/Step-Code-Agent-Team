/**
 * Team registry persistence.
 *
 * Layout (sandbox-safe: honors STEP_CODING_AGENT_DIR):
 *   <agentDir>/teams/<teamId>/registry.json
 *   <agentDir>/teams/<teamId>/sessions/     member session files (--session-dir)
 *   <agentDir>/teams/<teamId>/prompts/      member system prompts (needed on respawn)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { agentDir, getConfig } from "./config.ts";
import { parseTopology, starTopology, type TopologyData } from "./topology.ts";

export { agentDir };

export type MemberStatus = "idle" | "running" | "dead";
export type TaskStatus = "pending" | "ready" | "running" | "done" | "failed";

export interface MemberUsage {
	input: number;
	output: number;
	cost: number;
	turns: number;
}

export interface MemberRecord {
	name: string;
	role: string;
	model?: string;
	effort?: string;
	tools?: string[];
	sessionId: string;
	systemPromptFile?: string;
	pid: number;
	status: MemberStatus;
	usage: MemberUsage;
}

export interface TaskRecord {
	id: string;
	title: string;
	detail?: string;
	blockedBy: string[];
	assignee?: string;
	status: TaskStatus;
	result?: string;
}

export interface TeamRegistry {
	schemaVersion: 1;
	teamId: string;
	createdAt: number;
	cwd: string;
	members: MemberRecord[];
	tasks: TaskRecord[];
	topology: TopologyData;
}

export function teamsRoot(): string {
	const override = getConfig().storage.dir;
	if (typeof override === "string" && override.trim()) return path.resolve(override.trim());
	return path.join(agentDir(), "teams");
}
export function teamDir(teamId: string): string {
	return path.join(teamsRoot(), teamId);
}

export function registryPath(teamId: string): string {
	return path.join(teamDir(teamId), "registry.json");
}

export function memberSessionsDir(teamId: string): string {
	return path.join(teamDir(teamId), "sessions");
}

export function memberPromptsDir(teamId: string): string {
	return path.join(teamDir(teamId), "prompts");
}

export function emptyUsage(): MemberUsage {
	return { input: 0, output: 0, cost: 0, turns: 0 };
}

export function addUsage(a: MemberUsage, b: MemberUsage): MemberUsage {
	return {
		input: a.input + b.input,
		output: a.output + b.output,
		cost: a.cost + b.cost,
		turns: a.turns + b.turns,
	};
}

/** Usage delta of one run against a baseline (clamped at 0; a respawned member restarts its own counters). */
export function usageDelta(before: MemberUsage, after: MemberUsage): MemberUsage {
	return {
		input: Math.max(0, after.input - before.input),
		output: Math.max(0, after.output - before.output),
		cost: Math.max(0, after.cost - before.cost),
		turns: Math.max(0, after.turns - before.turns),
	};
}

export function createRegistry(teamId: string, cwd: string): TeamRegistry {
	return {
		schemaVersion: 1,
		teamId,
		createdAt: Date.now(),
		cwd,
		members: [],
		tasks: [],
		topology: starTopology(),
	};
}

/** Atomic write: tmp file + rename, so a crash never leaves a half-written registry. */
export function saveRegistry(reg: TeamRegistry): void {
	const dir = teamDir(reg.teamId);
	fs.mkdirSync(dir, { recursive: true });
	const target = registryPath(reg.teamId);
	const tmp = `${target}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(tmp, target);
}

export function loadRegistry(teamId: string): TeamRegistry | null {
	const file = registryPath(teamId);
	try {
		const raw = fs.readFileSync(file, "utf-8");
		const reg = JSON.parse(raw) as TeamRegistry;
		if (reg.schemaVersion !== 1) return null;
		if (!Array.isArray(reg.members) || !Array.isArray(reg.tasks)) return null;
		// Registries written before the topology field degrade to star.
		reg.topology = parseTopology(reg.topology);
		// 0.2.0 renamed the member field thinking → effort: read the legacy
		// field so teams created by older versions keep their effort on respawn.
		for (const m of reg.members) {
			const legacy = (m as unknown as { thinking?: string }).thinking;
			if (m.effort === undefined && typeof legacy === "string") m.effort = legacy;
		}
		return reg;
	} catch {
		return null;
	}
}

/** List known teams (most recent first) for diagnostics. */
export function listTeamIds(): string[] {
	try {
		return fs
			.readdirSync(teamsRoot(), { withFileTypes: true })
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort()
			.reverse();
	} catch {
		return [];
	}
}
