/**
 * Phase 45 smoke probe (zero token cost): the two spawn boundaries the
 * interface audit found uncovered.
 *
 * The audit of the 0.1.8 upgrade (sandbox/logs/team-t3-gap.md, C1 and C2)
 * turned up two paths with no probe at all:
 *
 * C2 — `--tools` is only passed when `member.tools` is non-empty
 *      (team/spawn.ts:196). When it is empty the member gets the host's default
 *      tool set instead, and — the part that matters — `topo_team_msg` is NOT
 *      added either, because it is folded into the allowlist that is never
 *      built. A member created without an explicit tool list therefore cannot
 *      message teammates at all. That is a real behavioural edge, not a
 *      theoretical one: any caller that omits `tools` gets a silently
 *      disconnected member.
 *
 * C1 — `session_shutdown` now fires for several reasons, not just quitting
 *      (agent-session-runtime.ts: reload / a variable reason / quit). Our
 *      handler kills members on every one of them, which is correct, but no
 *      probe asserted it — so a refactor that scoped the cleanup to `quit`
 *      only would leave orphans on `reload` and nothing would say so.
 *
 * Asserted here:
 *   1. an empty tool list omits --tools entirely (the host default applies);
 *   2. an empty tool list also omits topo_team_msg from the allowlist, i.e.
 *      the member cannot message — asserted as the documented consequence
 *      rather than as a bug to fix, so a change to either side is visible;
 *   3. a non-empty list builds the allowlist with topo_team_msg always in it;
 *   4. the sub-leader team tools join only when the member may orchestrate;
 *   5. shutdown clears the team's members regardless of the reason (C1).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager, buildSpawnArgs } from "../../extensions/members.ts";
import { resetConfigCache } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke45]", ...a);
		const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			checks.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat45-"));
		const agent = path.join(root, "agent");
		fs.mkdirSync(path.join(agent, "sessions"), { recursive: true });
		const savedAgentDir = process.env.STEP_CODING_AGENT_DIR;
		const savedDepth = process.env.STEPCODE_TEAM_DEPTH;
		process.env.STEP_CODING_AGENT_DIR = agent;
		resetConfigCache();

		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), root);
			const plan = (member: Record<string, unknown>) =>
				buildSpawnArgs(manager.teamId, manager.socketPath, member as unknown as Parameters<typeof buildSpawnArgs>[2]);
			const toolsOf = (args: string[]): string[] => {
				const i = args.indexOf("--tools");
				return i < 0 ? [] : (args[i + 1] ?? "").split(",").filter(Boolean);
			};

			// ---- C2-1: an empty tool list omits --tools entirely ----
			const bare = plan({ name: "bare", sessionId: "smoke45-bare" });
			check("tools: an empty tool list omits --tools (host default applies)",
				!bare.args.includes("--tools"), bare.args.join(" "));

			// ---- C2-1b: an explicitly empty array behaves the same way ----
			// The name above says "empty" but only an absent list was covered; a
			// caller passing [] is a different code path into the same guard, so
			// pin it separately. Without this, changing the guard to a truthiness
			// test (which [] passes) leaves this probe green.
			const emptyList = plan({ name: "emptylist", sessionId: "smoke45-emptylist", tools: [] });
			check("tools: an explicitly empty array also omits --tools",
				!emptyList.args.includes("--tools"), emptyList.args.join(" "));
			check("tools: an explicitly empty array yields no topo_team_msg either",
				toolsOf(emptyList.args).length === 0, toolsOf(emptyList.args).join(","));

			// ---- C2-2: ...which also means no topo_team_msg ----
			// Documented consequence, asserted so either side changing is visible.
			check("tools: an empty tool list yields no topo_team_msg either",
				toolsOf(bare.args).length === 0, toolsOf(bare.args).join(","));

			// ---- C2-3: a non-empty list always carries topo_team_msg ----
			const withTools = plan({ name: "withtools", sessionId: "smoke45-withtools", tools: ["read", "bash"] });
			const allow = toolsOf(withTools.args);
			check("tools: a non-empty list builds an allowlist", allow.length > 0, allow.join(","));
			check("tools: topo_team_msg is always in the allowlist", allow.includes("topo_team_msg"), allow.join(","));
			check("tools: the caller's tools survive", allow.includes("read") && allow.includes("bash"), allow.join(","));

			// ---- C2-4: sub-leader tools join only when the member may orchestrate ----
			// plan(p) describes the spawn of a child of a process at depth p, and
			// canOrchestrate = childDepth < maxRecursionDepth. With the default
			// bound of 1, even the leader's own child is isolated, so the
			// orchestrating case needs a parent at depth 1 with the bound raised.
			fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ members: { maxRecursionDepth: 4 } }));
			resetConfigCache();
			process.env.STEPCODE_TEAM_DEPTH = "1";
			const bossTools = toolsOf(plan({ name: "boss", sessionId: "smoke45-boss", tools: ["read"] }).args);
			process.env.STEPCODE_TEAM_DEPTH = "3";
			const leafTools = toolsOf(plan({ name: "leaf", sessionId: "smoke45-leaf", tools: ["read"] }).args);
			fs.rmSync(path.join(agent, "stepcode-agent-team.json"), { force: true });
			resetConfigCache();
			check("tools: an orchestrating member gets the sub-leader team tools",
				bossTools.length > leafTools.length, `boss=${bossTools.length} leaf=${leafTools.length}`);
			check("tools: a leaf member gets none of them",
				!leafTools.some((t) => t.startsWith("team_")), leafTools.join(","));

			// ---- C1: shutdown clears the team's members ----
			process.env.STEPCODE_TEAM_DEPTH = "0";
			const { member } = await manager.createMember({ name: "shutchk", tools: ["read"] });
			check("shutdown: a member exists before shutdown", manager.snapshot().members.some((m) => m.name === "shutchk"),
				manager.snapshot().members.map((m) => m.name).join(","));
			// The host now emits session_shutdown with a reason (reload / variable
			// / quit); our handler must clear members on every one of them. Drive
			// the same code path the host drives, with each reason in turn.
			for (const reason of ["reload", "quit", "new"]) {
				const before = manager.snapshot().members.length;
				manager.shutdown();
				// The sweep is what makes the registry stop lying: every entry must
				// read dead with no pid, not merely be absent after the next
				// createMember. A skipped sweep leaves stale "ready" entries pointing
				// at processes that no longer exist.
				const swept = manager.snapshot().members;
				check(`shutdown: registry entries are marked dead on reason "${reason}"`,
					swept.length > 0 && swept.every((m) => m.status === "dead" && m.pid === -1),
					swept.map((m) => `${m.name}:${m.status}:${m.pid}`).join(","));
				await manager.createMember({ name: "shutchk", tools: ["read"] });
				const after = manager.snapshot().members.length;
				check(`shutdown: members are cleared on reason "${reason}"`,
					before > 0 && after === 1, `before=${before} after=${after}`);
			}
			// Was `member.pid > 0` — always true for a spawned process, so it
			// asserted nothing about the process being stopped. Poll for the pid to
			// actually disappear instead.
			let stopped = false;
			for (let i = 0; i < 50 && !stopped; i++) {
				try {
					process.kill(member.pid, 0);
				} catch {
					stopped = true;
				}
				if (!stopped) await new Promise((r) => setTimeout(r, 100));
			}
			check("shutdown: the spawned member process is stopped", stopped,
				stopped ? "" : `pid ${member.pid} still alive 5s after shutdown`);
			await manager.disband();
		} catch (err) {
			check("setup: the probe reached its spawn-boundary stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			if (savedDepth === undefined) delete process.env.STEPCODE_TEAM_DEPTH;
			else process.env.STEPCODE_TEAM_DEPTH = savedDepth;
			if (savedAgentDir === undefined) delete process.env.STEP_CODING_AGENT_DIR;
			else process.env.STEP_CODING_AGENT_DIR = savedAgentDir;
			resetConfigCache();
			fs.rmSync(root, { recursive: true, force: true });
			const failed = checks.filter((r) => !r.ok);
			log(`SMOKE45 DONE (${checks.length - failed.length}/${checks.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
