/**
 * Phase 41 smoke probe (zero token cost): two teams in one agent dir do not
 * collide.
 *
 * U4 asked whether several projects sharing an agentDir can run teams at the
 * same time. The isolation is structural and worth pinning as a regression
 * guard: the socket is `<teamsRoot>/<teamId>/sock` (registry.ts:74-79) and the
 * teamId is derived from the leader's session file basename (naming.ts:26-30),
 * so two different sessions get two different teamIds and therefore two
 * different sockets — with no reference to cwd at all. The at-rest key is
 * likewise per-cwd (crypto.ts:59-61), so two projects never share one.
 *
 * Asserted:
 *   1. two session files produce two different teamIds and two different sockets;
 *   2. the socket path is a pure function of the teamId (same teamId → same
 *      path), which is what makes the isolation deterministic rather than lucky;
 *   3. two TeamServers on those two sockets can listen CONCURRENTLY (no
 *      EADDRINUSE) and both sockets appear with mode 0600;
 *   4. a nested member's session id namespaces the child under the parent, so a
 *      sub-team's socket cannot collide with a sibling's;
 *   5. the guard itself: were the socket derived from something shared (cwd, or
 *      a constant), case 3 would fail — that is the regression this catches.
 *
 * The one real collision that remains needs two sessions with the SAME
 * basename, which cannot happen for distinct sessions; asserted as a note rather
 * than a case, because manufacturing it would mean lying about the inputs.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { TeamServer } from "../../extensions/team-server.ts";
import { teamIdForSession } from "../../extensions/team/naming.ts";
import { resetConfigCache } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke41]", ...a);
		const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			checks.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat41-"));
		const agent = path.join(root, "agent");
		fs.mkdirSync(agent, { recursive: true });
		const savedAgentDir = process.env.STEP_CODING_AGENT_DIR;
		process.env.STEP_CODING_AGENT_DIR = agent;
		resetConfigCache();

		// Two distinct leader sessions, as two concurrent projects would have.
		const sessionA = "2026-11-06T10-00-00-alpha-session";
		const sessionB = "2026-11-06T11-30-00-beta-session";
		const servers: TeamServer[] = [];
		try {
			const idA = teamIdForSession(sessionA);
			const idB = teamIdForSession(sessionB);
			check("isolation: two session files give two team ids", idA !== null && idB !== null && idA !== idB, `${idA} vs ${idB}`);

			const mA = TeamManager.forSession(sessionA, ctx.cwd);
			const mB = TeamManager.forSession(sessionB, ctx.cwd);
			check("isolation: the two managers hold different team ids", mA.teamId !== mB.teamId, `${mA.teamId} vs ${mB.teamId}`);
			check("isolation: the two socket paths differ", mA.socketPath !== mB.socketPath, `${mA.socketPath} vs ${mB.socketPath}`);
			check("isolation: the socket lives under its own team dir",
				mA.socketPath.includes(mA.teamId) && mB.socketPath.includes(mB.teamId), "");

			// Same teamId → same path: the isolation is a pure function, not luck.
			const mA2 = TeamManager.forSession(sessionA, ctx.cwd);
			check("isolation: the socket path is a pure function of the team id",
				mA2.socketPath === mA.socketPath && mA2.teamId === mA.teamId, "");

			// Concurrent listen on both sockets: the case that would fail if the
			// path were derived from something shared.
			const serverA = new TeamServer(mA.socketPath, () => mA);
			const serverB = new TeamServer(mB.socketPath, () => mB);
			serverA.start();
			serverB.start();
			servers.push(serverA, serverB);
			await new Promise((r) => setTimeout(r, 400));
			const bothExist = fs.existsSync(mA.socketPath) && fs.existsSync(mB.socketPath);
			check("isolation: both sockets exist after a concurrent start", bothExist, "");
			const modes = [mA.socketPath, mB.socketPath].map((p) => (fs.existsSync(p) ? fs.statSync(p).mode & 0o777 : 0));
			check("isolation: both sockets are 0600", modes[0] === 0o600 && modes[1] === 0o600, modes.map((m) => m.toString(8)).join(","));

			// A nested member's session id namespaces the child under the parent, so
			// a sub-team socket cannot collide with a sibling team's.
			const child = teamIdForSession(`team-${mA.teamId}-worker1`);
			check("isolation: a nested team id is namespaced under its parent",
				child !== null && child !== mA.teamId && child.includes(mA.teamId), `${child} (parent ${mA.teamId})`);
		} catch (err) {
			check("setup: the probe reached its isolation stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			for (const s of servers) {
				try {
					s.stop();
				} catch {
					/* best effort */
				}
			}
			fs.rmSync(root, { recursive: true, force: true });
			if (savedAgentDir === undefined) delete process.env.STEP_CODING_AGENT_DIR;
			else process.env.STEP_CODING_AGENT_DIR = savedAgentDir;
			resetConfigCache();
			const failed = checks.filter((r) => !r.ok);
			log(`SMOKE41 DONE (${checks.length - failed.length}/${checks.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
