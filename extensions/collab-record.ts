/**
 * Collaboration records — written to `.topo/records/` after every team task.
 *
 * A "task" is bounded by the team's life: it starts when the team activates and
 * ends when it is disbanded or the plugin is deactivated (with a shutdown
 * fallback if the session ends while the team is still live). Each boundary
 * writes one record, so a workspace accumulates an auditable history of what
 * the team did, who did it, and what it cost.
 *
 * Encryption follows the user's option: `encryption.enabled` (default true)
 * plus an available key means the record is sealed with the same AES-256-GCM
 * envelope as the registry; anything else is plaintext. `loadCollabRecord`
 * reads both. Honest scope, same as the registry: this keeps other users and
 * stray backups out, and does NOT stop a same-uid attacker who reads the key
 * file next to the ciphertext.
 *
 * Every failure degrades: a record that cannot be written is logged and
 * forgotten — it must never block a disband or a deactivation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { decryptJson, encryptJson, isEncryptedEnvelope, loadTeamKey } from "./crypto.ts";
import { getConfig } from "./config.ts";
import type { TeamManager } from "./members.ts";

const SCHEMA_VERSION = 1;

export interface CollabTaskEntry {
	id: string;
	title: string;
	status: string;
	assignee?: string;
	blockedBy: string[];
	ms?: number;
}

export interface CollabRecord {
	schemaVersion: typeof SCHEMA_VERSION;
	teamId: string;
	startedAt: number;
	endedAt: number;
	cwd: string;
	topology: Array<{ shape: string; edges: Array<{ from: string; to: string }>; at: number }>;
	members: Array<{ name: string; role?: string; model?: string; effort?: string; tools?: string[]; status: string; turns?: number; costUsd?: number }>;
	tasks: CollabTaskEntry[];
	cost: { usd: number };
	summary: { members: number; tasks: number; done: number; failed: number; durationMs: number };
}

/** Compact UTC stamp for file names: 20261030-073000. */
function stamp(ms: number): string {
	return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

/** `.topo/records` for this workspace, honoring `records.dir`. */
export function recordsDir(cwd: string): string {
	const cfg = getConfig().records;
	return path.join(cwd, ".topo", cfg.dir.trim() || "records");
}

/** Existing record paths for a team, so generation can stay idempotent. */
export function hasRecord(cwd: string, teamId: string): boolean {
	try {
		const dir = recordsDir(cwd);
		if (!fs.existsSync(dir)) return false;
		return fs.readdirSync(dir).some((f) => f.startsWith(`${teamId}-`));
	} catch {
		return false;
	}
}

/**
 * Writes one collaboration record. Returns the paths written (empty when
 * disabled or when it degraded) — never throws.
 */
export function writeCollabRecord(manager: TeamManager): string[] {
	const cfg = getConfig().records;
	if (!cfg.enabled) return [];
	const snap = manager.snapshot();
	const cwd = snap.cwd;
	const teamId = snap.teamId;
	if (hasRecord(cwd, teamId)) return [];

	const now = Date.now();
	const record: CollabRecord = {
		schemaVersion: SCHEMA_VERSION,
		teamId,
		startedAt: snap.createdAt ?? now,
		endedAt: now,
		cwd,
		// The registry holds the topology in force when the team closed. A full
		// declaration timeline would need bookkeeping on every set_topology call
		// for little audit value, so the record keeps the final shape.
		topology: [{ shape: snap.topology.shape as string, edges: snap.topology.edges.map(([from, to]) => ({ from, to })), at: now }],
		members: snap.members.map((m) => ({
			name: m.name,
			role: m.role,
			model: m.model,
			effort: m.effort,
			tools: m.tools,
			status: m.status,
			turns: m.usage?.turns,
			costUsd: m.usage?.cost,
		})),
		tasks: snap.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee, blockedBy: t.blockedBy })),
		cost: { usd: snap.members.reduce((sum, m) => sum + (m.usage?.cost ?? 0), 0) },
		summary: {
			members: snap.members.length,
			tasks: snap.tasks.length,
			done: snap.tasks.filter((t) => t.status === "done").length,
			failed: snap.tasks.filter((t) => t.status === "failed").length,
			durationMs: now - (snap.createdAt ?? now),
		},
	};

	const dir = recordsDir(cwd);
	const base = path.join(dir, `${teamId}-${stamp(now)}`);
	const key = cfg.enabled && getConfig().encryption.enabled ? loadTeamKey(cwd) : null;
	const written: string[] = [];
	try {
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		const jsonPath = `${base}.json`;
		fs.writeFileSync(jsonPath, key ? encryptJson(record, teamId, cwd, key) : `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
		written.push(jsonPath);
		const mdPath = `${base}.md`;
		fs.writeFileSync(mdPath, renderMarkdown(record, key !== null), { mode: 0o600 });
		written.push(mdPath);
	} catch (err) {
		// Degrade loudly but never block the caller.
		console.error(`[stepcode-agent-team] cannot write the collaboration record: ${err instanceof Error ? err.message : String(err)}`);
		return written;
	}
	return written;
}

/** Reads a record back, sealed or plaintext. Returns null when unreadable. */
export function loadCollabRecord(file: string): CollabRecord | null {
	try {
		const raw = fs.readFileSync(file, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (isEncryptedEnvelope(parsed)) {
			const key = loadTeamKey(parsed.cwd);
			if (!key) return null; // sealed and the key is gone
			return decryptJson(raw, key) as CollabRecord;
		}
		return parsed as CollabRecord;
	} catch {
		return null;
	}
}

function renderMarkdown(r: CollabRecord, sealed: boolean): string {
	const lines = [
		`# Collaboration record — ${r.teamId}`,
		"",
		`- **Workspace**: ${r.cwd}`,
		`- **Window**: ${new Date(r.startedAt).toISOString()} → ${new Date(r.endedAt).toISOString()} (${Math.round(r.summary.durationMs / 1000)}s)`,
		`- **At rest**: ${sealed ? "encrypted (AES-256-GCM, key in .topo/team.key)" : "plaintext (encryption disabled or no key)"}`,
		"",
		"## Members",
		"",
		"| Member | Role | Effort | Model | Status | Turns | Cost |",
		"|---|---|---|---|---|---|---|",
		...r.members.map((m) => `| ${m.name} | ${m.role ?? "-"} | ${m.effort ?? "-"} | ${m.model ?? "-"} | ${m.status} | ${m.turns ?? "-"} | $${(m.costUsd ?? 0).toFixed(4)} |`),
		"",
		"## Tasks",
		"",
		"| Id | Status | Assignee | Blocked by | Title |",
		"|---|---|---|---|---|",
		...r.tasks.map((t) => `| ${t.id} | ${t.status} | ${t.assignee ?? "-"} | ${t.blockedBy.join(", ") || "-"} | ${t.title} |`),
		"",
		"## Topology declarations",
		"",
		...r.topology.map((t) => `- ${new Date(t.at).toISOString()} — **${t.shape}** (${t.edges.map((e) => `${e.from}→${e.to}`).join(", ") || "no edges"})`),
		"",
		"## Totals",
		"",
		`- Members: ${r.summary.members} · Tasks: ${r.summary.tasks} (${r.summary.done} done, ${r.summary.failed} failed)`,
		`- Cumulative spend: $${r.cost.usd.toFixed(4)}`,
		"",
	];
	return lines.join("\n");
}
