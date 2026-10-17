/**
 * Step-Code-Agent-Team extension entry point.
 *
 * The leader session (this one) orchestrates a team of member agents:
 *   team_create_member / team_send / team_task / team_disband / team_status
 *   (+ /team command)
 * Members are isolated `step --mode rpc` subprocesses; their contexts persist in
 * session files, so members can be respawned and resume where they left off.
 * Member-to-member messaging runs through a Unix socket served by this process
 * and reached by members via the `stepcode-team` CLI shim.
 */

import type { ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import { TeamManager } from "./members.ts";
import { registerTeamTools } from "./tools.ts";
import { TeamServer } from "./team-server.ts";

/** Idle member processes are reaped periodically (sessions persist on disk). */
const IDLE_REAP_INTERVAL_MS = 5 * 60 * 1000;
const IDLE_REAP_AFTER_MS = 30 * 60 * 1000;

export default function (pi: ExtensionAPI) {
	let manager: TeamManager | null = null;
	let server: TeamServer | null = null;
	let reapTimer: NodeJS.Timeout | null = null;

	const getManager = (ctx: ExtensionContext): TeamManager => {
		if (!manager) {
			manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
		}
		return manager;
	};

	/** Idempotent: starts the team server once per session. */
	const ensureServer = (ctx: ExtensionContext): void => {
		if (server) return;
		const team = getManager(ctx);
		server = new TeamServer(team.socketPath, () => team);
		server.start();
	};

	registerTeamTools(pi, getManager);

	pi.registerCommand("team", {
		description: "Show agent team status (members, task board, spend)",
		handler: async (_args, ctx) => {
			const team = getManager(ctx);
			const reg = team.snapshot();
			const lines: string[] = [`Team "${team.teamId}"`];
			if (reg.members.length === 0) {
				lines.push("  no members yet — create one with team_create_member");
			} else {
				for (const m of reg.members) {
					lines.push(`  ${m.status === "idle" ? "○" : m.status === "running" ? "●" : "✗"} ${m.name} (${m.role}) [${m.status}]`);
				}
			}
			for (const t of reg.tasks) {
				const blocked = t.blockedBy.length > 0 ? ` <- ${t.blockedBy.join(",")}` : "";
				lines.push(`  ${t.id} [${t.status}] ${t.title}${t.assignee ? ` @${t.assignee}` : ""}${blocked}`);
			}
			const totalCost = reg.members.reduce((sum, m) => sum + m.usage.cost, 0);
			lines.push(`  spend: $${totalCost.toFixed(4)}`);
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		ensureServer(ctx);
		if (!reapTimer) {
			reapTimer = setInterval(() => {
				const team = getManager(ctx);
				void team.reapIdleMembers(IDLE_REAP_AFTER_MS);
			}, IDLE_REAP_INTERVAL_MS);
			reapTimer.unref?.();
		}
	});

	pi.on("session_shutdown", () => {
		if (reapTimer) {
			clearInterval(reapTimer);
			reapTimer = null;
		}
		server?.stop();
		server = null;
		// Members are children of this process; stop them so no orphans survive
		// the leader. Their sessions persist on disk, so recreating a member
		// resumes its context.
		manager?.shutdown();
		manager = null;
	});
}
