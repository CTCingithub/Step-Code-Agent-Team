/**
 * Recursion depth-2 live probe (plan-43). Costs a few small LLM calls.
 * Requires ambient maxRecursionDepth >= 2 (run with sandbox/cfg-deep2).
 *
 * Flow: the leader dispatches to member "mid" (granted its own sub-team at
 * depth 1); mid creates a sub-member "leaf" through its team tools, gets an
 * answer from it, and reports back. Verifies the full chain: sub-team
 * bootstrap, the sub-member spawn at the inert boundary (--no-extensions),
 * and the answer flowing back through two levels.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../extensions/members.ts";
import { getConfig } from "../extensions/config.ts";
import { loadRegistry, teamsRoot } from "../extensions/registry.ts";
import { TeamServer } from "../extensions/team-server.ts";

function procCmdline(pid: number): string[] {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
	} catch {
		return [];
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke11]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const cfg = getConfig();
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			if (cfg.members.maxRecursionDepth < 2) {
				log(`SKIP: ambient maxRecursionDepth=${cfg.members.maxRecursionDepth} (<2); re-run with sandbox/cfg-deep2`);
				setTimeout(() => process.exit(0), 500);
				return;
			}

			// 1. create the mid-level member (granted a sub-team at depth 1)
			await manager.createMember({ name: "mid", role: "worker" });

			// 2. wait for mid's sub-team to bootstrap (registry + socket on disk)
			const subTeamId = `team-${manager.teamId}-mid`;
			const subDir = path.join(teamsRoot(), subTeamId);
			let bootstrapped = false;
			for (let i = 0; i < 24; i++) {
				await new Promise((r) => setTimeout(r, 500));
				if (fs.existsSync(path.join(subDir, "registry.json")) && fs.existsSync(path.join(subDir, "sock"))) {
					bootstrapped = true;
					break;
				}
			}
			check("sub-team bootstrapped before dispatch", bootstrapped, subDir);

			// 2b. start the leader's own team server: members' shim env points at
			// it, and real sessions start it on activation (the probe must too).
			const leaderServer = new TeamServer(manager.socketPath, () => manager);
			leaderServer.start();
			await new Promise((r) => setTimeout(r, 300));

			// 3. ask mid to create a leaf sub-member and relay its answer
			let reply = "";
			let err: string | undefined;
			try {
				const r = await manager.sendMessage(
					"mid",
					[
						"Use your team tools to do exactly this:",
						"1) create a member named leaf with the worker role",
						"2) send leaf the message: Reply with exactly: LEAF-OK",
						"3) report leaf's reply verbatim in your final answer",
					].join("\n"),
				);
				reply = r.text;
			} catch (e) {
				err = e instanceof Error ? e.message : String(e);
			}
			const refused = /cannot be completed|do not have|did not improvise|not the leader/i.test(reply);
			check(
				"depth-2 chain: LEAF-OK relayed back",
				!err && !refused && /leaf-ok/i.test(reply),
				err ?? (refused ? `mid refused: ${reply.slice(0, 120)}` : reply.slice(0, 140)),
			);

			// 4. the sub-team registry contains the leaf member
			const sub = loadRegistry(subTeamId);
			const leaf = sub?.members.find((m) => m.name === "leaf");
			check(
				"depth-2 chain: leaf recorded in the sub-team registry",
				!!leaf,
				`members=${sub?.members.map((m) => m.name).join(",") ?? "(no sub-team)"}`,
			);

			// 5. leaf sits at the inert boundary: spawned with --no-extensions
			if (leaf && leaf.pid > 0) {
				const cmdline = procCmdline(leaf.pid);
				check(
					"depth-2 boundary: leaf is --no-extensions",
					cmdline.includes("--no-extensions"),
					cmdline.join(" ").slice(0, 160),
				);
				// leaf is a child of mid; do not let it outlive the test
				try {
					process.kill(leaf.pid, "SIGKILL");
				} catch {
					/* already gone */
				}
			} else {
				check("depth-2 boundary: leaf process alive for inspection", false, `pid=${leaf?.pid ?? "n/a"}`);
			}

			await manager.disband();
			leaderServer.stop();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE11 DONE (all passed)" : `SMOKE11 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE11 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
