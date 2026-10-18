/**
 * Regression probe for the fixes from docs/TESTING-OPTIMIZATION-PLAN.md.
 * Mostly zero-token; one small LLM call (RACE-OK) for the spawn-race test.
 *
 * Covers:
 *   1. concurrent createMember (same name) → single record, single process  (P0-1)
 *   2. createMember + sendMessage race     → single process, reply received (P0-1)
 *   3. disband unknown member              → throws                        (P2-6)
 *   4. completeTask on a closed task       → throws (state machine)        (P2-5)
 *   5. team socket permissions             → 0600                          (P1-5)
 *   6. aborted signal                      → rejects before prompting      (P1-4)
 *   7. shutdown                            → registry statuses dead        (P1-3)
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { TeamServer } from "../../extensions/team-server.ts";
import { loadRegistry } from "../../extensions/registry.ts";

function countProcesses(pattern: string): number {
	const res = spawnSync("pgrep", ["-fc", pattern], { encoding: "utf8" });
	if (res.error) return -1;
	if (res.status === 1) return 0; // pgrep: no match
	if (res.status !== 0) return -1;
	return Number.parseInt((res.stdout ?? "").trim(), 10);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke5]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			if (!process.env.STEP_API_KEY) {
				log("SMOKE5 FAILED: STEP_API_KEY is not set (export it from local/test-api-key.md)");
				setTimeout(() => process.exit(1), 500);
				return;
			}

			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const server = new TeamServer(manager.socketPath, () => manager);
			server.start();
			await new Promise((r) => setTimeout(r, 300));

			// 1. concurrent creates of the same name → one record, one process
			const [a, b] = await Promise.all([
				manager.createMember({ name: "race1", role: "worker" }),
				manager.createMember({ name: "race1", role: "worker" }),
			]);
			const race1Count = manager.snapshot().members.filter((m) => m.name === "race1").length;
			const procs1 = countProcesses(`team-${manager.teamId}-race1`);
			check("concurrent create: single record", race1Count === 1, `records=${race1Count}`);
			check("concurrent create: single process", procs1 === 1, `processes=${procs1}`);
			check("concurrent create: one created flag", a.created !== b.created, `created=${a.created},${b.created}`);

			// 2. create + send racing → single process, reply received
			const createP = manager.createMember({ name: "race2", role: "worker" });
			await new Promise((r) => setTimeout(r, 50)); // record lands while spawn is in flight
			const sendP = manager.sendMessage("race2", "Reply with exactly: RACE-OK").catch((e) => ({
				error: e instanceof Error ? e.message : String(e),
			}));
			const [, s2] = await Promise.all([createP, sendP]);
			const procs2 = countProcesses(`team-${manager.teamId}-race2`);
			check("create+send race: single process", procs2 === 1, `processes=${procs2}`);
			const sendErr = "error" in s2 ? (s2 as { error: string }).error : undefined;
			const sendText = "text" in s2 ? (s2 as { text: string }).text : "";
			check("create+send race: reply received", !sendErr && /race-ok/i.test(sendText), sendErr ?? sendText);

			// 3. disband unknown → throws
			let disbandThrew = false;
			try {
				await manager.disband("does-not-exist");
			} catch {
				disbandThrew = true;
			}
			check("disband unknown member throws", disbandThrew);

			// 4. task state machine: closing a closed task throws
			const t = await manager.createTask({ title: "state machine probe" });
			manager.completeTask(t.id, "done once");
			let doubleCloseThrew = false;
			try {
				manager.completeTask(t.id, "done twice");
			} catch {
				doubleCloseThrew = true;
			}
			check("completeTask on closed task throws", doubleCloseThrew);

			// 5. socket permissions
			try {
				const mode = fs.statSync(manager.socketPath).mode & 0o777;
				check("team socket is 0600", mode === 0o600, `mode=${mode.toString(8)}`);
			} catch (err) {
				check("team socket is 0600", false, err instanceof Error ? err.message : String(err));
			}

			// 6. aborted signal → throws before prompting (no LLM call)
			const ac = new AbortController();
			ac.abort();
			let abortThrew = false;
			try {
				await manager.sendMessage("race1", "must not run", { signal: ac.signal });
			} catch {
				abortThrew = true;
			}
			check("aborted signal rejects dispatch", abortThrew);

			// 7. shutdown marks members dead
			manager.shutdown();
			const reg = loadRegistry(manager.teamId);
			const allDead = (reg?.members ?? []).every((m) => m.status === "dead");
			check("shutdown marks members dead", allDead && (reg?.members.length ?? 0) > 0);

			server.stop();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE5 DONE (all passed)" : `SMOKE5 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE5 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
