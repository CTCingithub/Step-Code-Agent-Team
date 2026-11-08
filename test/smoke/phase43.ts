/**
 * Phase 43 smoke probe (zero token cost): how deep the team tree can actually go.
 *
 * U3 asked for a depth>=3 chain test. The honest split:
 *
 *   - The PROCESS level is already covered: phase8 bootstraps a depth-2 sub-team
 *     for real, and phase37 asserts the orchestrating branch's argument vector.
 *   - What neither covers is the boundary that decides whether depth 3 is
 *     reachable at all. `canOrchestrate = childDepth < maxRecursionDepth`
 *     (team/spawn.ts:153-155), and phase37 only ever exercises it from depth 0
 *     (childDepth 1). A depth-1 member spawning a depth-2 child is the case that
 *     matters for depth 3, and it was untested.
 *
 *   - The real three-level LLM chain is NOT covered here and cannot be, cheaply.
 *     It needs the model at each level to decide to call a spawn tool at the
 *     right moment; a scripted fake model cannot do that (phase35 proves a fake
 *     model CAN emit tool_calls, but not that it can choose the right one at the
 *     right time in a nested chain). It also needs a key (~10-25k tokens per
 *     chain by estimate) and it is precisely the path the harness's settle
 *     timeouts come from. It stays deferred, and this header says so rather than
 *     letting a green check imply otherwise.
 *
 * Asserted, by driving buildSpawnArgs with the depth env the way a real child
 * would carry it:
 *   1. at maxRecursionDepth=1 even a depth-0 leader's child is isolated (default);
 *   2. at 2, a depth-1 member may orchestrate (so depth 2 is reachable);
 *   3. at 3, a depth-1 member may orchestrate AND its depth-2 child may too
 *      (so depth 3 is reachable) — the boundary phase37 never reached;
 *   4. at 4, a depth-2 child may orchestrate (depth 4 reachable);
 *   5. the bound is inclusive at every level: childDepth === maxRecursionDepth
 *      is the first isolated generation, which is what makes the tree finite.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager, buildSpawnArgs } from "../../extensions/members.ts";
import { extensionEntryPath, memberMessagingEntryPath } from "../../extensions/presets.ts";
import { resetConfigCache } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke43]", ...a);
		const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			checks.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat43-"));
		const agent = path.join(root, "agent");
		fs.mkdirSync(agent, { recursive: true });
		const savedAgentDir = process.env.STEP_CODING_AGENT_DIR;
		const savedDepth = process.env.STEPCODE_TEAM_DEPTH;
		process.env.STEP_CODING_AGENT_DIR = agent;
		resetConfigCache();

		const member = { name: "depthprobe", sessionId: "smoke43-depth", model: "step-5-preview" };
		/** Spawn args for a child of a process sitting at `parentDepth`. */
		const planAt = (parentDepth: number) => {
			process.env.STEPCODE_TEAM_DEPTH = String(parentDepth);
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			return buildSpawnArgs(manager.teamId, manager.socketPath, member as unknown as Parameters<typeof buildSpawnArgs>[2]);
		};
		const orchestrates = (plan: { args: string[] }): boolean =>
			plan.args.includes(extensionEntryPath()) && !plan.args.includes("--no-extensions");

		try {
			// ---- 1. the default bound: nobody below the leader orchestrates ----
			fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ members: { maxRecursionDepth: 1 } }));
			resetConfigCache();
			const d1 = planAt(0);
			check("depth: at maxRecursionDepth=1 the leader's child is isolated",
				!orchestrates(d1) && d1.args.includes("--no-extensions"), d1.args.join(" "));
			check("depth: the isolated child still loads the messaging shim",
				d1.args.includes("-e") && d1.args[d1.args.indexOf("-e") + 1]?.endsWith("member-messaging.ts"), d1.args.join(" "));

			// ---- 2. depth 2 is reachable at bound 2 ----
			// planAt(p) is the spawn plan for the child of a process at depth p, so
			// the child sits at depth p+1 and "a depth-N member exists" is
			// "planAt(N-2) may orchestrate". Getting this off by one is easy and
			// silently inverts the meaning, so the mapping is stated once here.
			fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ members: { maxRecursionDepth: 2 } }));
			resetConfigCache();
			check("depth: at bound 2 a depth-1 member may orchestrate (depth 2 reachable)",
				orchestrates(planAt(0)), planAt(0).args.join(" "));
			check("depth: at bound 2 a depth-2 member may NOT (the tree stops)",
				!orchestrates(planAt(1)), "");

			// ---- 3. depth 3 is reachable at bound 3 — the case phase37 never reached ----
			fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ members: { maxRecursionDepth: 3 } }));
			resetConfigCache();
			const level1 = planAt(0);
			const level2 = planAt(1);
			const level3 = planAt(2);
			check("depth: at bound 3 a depth-1 member may orchestrate", orchestrates(level1), level1.args.join(" "));
			check("depth: at bound 3 a depth-2 member may orchestrate (depth 3 REACHABLE)",
				orchestrates(level2), level2.args.join(" "));
			check("depth: at bound 3 a depth-3 member may NOT (the tree stops at 3)",
				!orchestrates(level3), level3.args.join(" "));
			check("depth: an orchestrating child is told to auto-activate",
				level2.env.STEPCODE_TEAM_AUTOACTIVATE === "1", String(level2.env.STEPCODE_TEAM_AUTOACTIVATE));

			// ---- 4. depth 4 at bound 4 ----
			fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ members: { maxRecursionDepth: 4 } }));
			resetConfigCache();
			check("depth: at bound 4 a depth-2 member may orchestrate (depth 4 reachable)",
				orchestrates(planAt(2)), "");

			// ---- 5. the bound is what makes the tree finite ----
			// childDepth === maxRecursionDepth is the first isolated generation, so
			// at bound 3 that is planAt(2) (its child would be depth 3) and the last
			// orchestrating generation is planAt(1).
			fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ members: { maxRecursionDepth: 3 } }));
			resetConfigCache();
			check("depth: childDepth === bound is the first isolated generation",
				!orchestrates(planAt(2)) && orchestrates(planAt(1)), "");

			// ---- 6. the depth env is carried, not recomputed ----
			check("depth: the child is told its own depth",
				level2.env.STEPCODE_TEAM_DEPTH === "2", String(level2.env.STEPCODE_TEAM_DEPTH));
		} catch (err) {
			check("setup: the probe reached its depth stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			if (savedDepth === undefined) delete process.env.STEPCODE_TEAM_DEPTH;
			else process.env.STEPCODE_TEAM_DEPTH = savedDepth;
			if (savedAgentDir === undefined) delete process.env.STEP_CODING_AGENT_DIR;
			else process.env.STEP_CODING_AGENT_DIR = savedAgentDir;
			resetConfigCache();
			const failed = checks.filter((r) => !r.ok);
			log(`SMOKE43 DONE (${checks.length - failed.length}/${checks.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
