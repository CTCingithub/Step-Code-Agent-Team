/**
 * Phase 2 smoke probe (zero token cost): exercises the task board logic
 * without dispatching any LLM work. Loaded alongside the extension.
 *
 * Verifies: task creation, dependency gating, cycle rejection, ready-set
 * transitions on complete/fail, and registry persistence.
 *
 * Every case goes through check(), so each one logs a PASS/FAIL line. That is
 * not cosmetic: this probe used to report through ad-hoc log() + fail() pairs,
 * which meant a case could be gutted into a tautology and the runner would
 * still see DONE with no FAIL line — the gate passed while testing less.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { loadRegistry } from "../../extensions/registry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...args: unknown[]) => console.error("[smoke2]", ...args);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};
		const fail = (msg: string) => log("SMOKE2 FAILED:", msg);

		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			const t1 = await manager.createTask({ title: "Collect API inventory" });
			const t2 = await manager.createTask({ title: "Write client code", blockedBy: [t1.id] });
			const t3 = await manager.createTask({ title: "Integration test", blockedBy: [t2.id] });
			check("board: ids are assigned in order", t2.id > t1.id && t3.id > t2.id, `${t1.id} < ${t2.id} < ${t3.id}`);
			check("board: ready/pending/pending on create",
				t1.status === "ready" && t2.status === "pending" && t3.status === "pending",
				`${t1.status}/${t2.status}/${t3.status}`);

			// Self-cycle must be rejected and leave the board untouched.
			let rejected = false;
			try {
				await manager.createTask({ title: "self cycle", blockedBy: ["T4"] });
			} catch {
				rejected = true;
			}
			const boardAfterReject = manager.snapshot().tasks.length;
			check("board: self-cycle rejected", rejected, String(rejected));
			check("board: rejection left the board untouched", boardAfterReject === 3, String(boardAfterReject));

			// startTask on a non-ready task must fail (needs no LLM: rejects before dispatch).
			let notReadyRejected = false;
			try {
				await manager.startTask(t3.id);
			} catch {
				notReadyRejected = true;
			}
			check("board: startTask rejects a non-ready task", notReadyRejected, String(notReadyRejected));
			check("board: rejected startTask left the status alone",
				manager.snapshot().tasks.find((t) => t.id === t3.id)?.status === "pending",
				String(manager.snapshot().tasks.find((t) => t.id === t3.id)?.status));

			manager.completeTask(t1.id, "done: inventory collected");
			const afterT1 = manager.snapshot().tasks;
			check("board: dependency completes make the next task ready",
				afterT1.find((t) => t.id === t2.id)?.status === "ready",
				afterT1.map((t) => `${t.id}:${t.status}`).join(","));

			manager.failTask(t2.id, "boom");
			const afterFail = manager.snapshot().tasks;
			const t3After = afterFail.find((t) => t.id === t3.id);
			check("board: a failed dependency keeps dependents pending",
				t3After?.status === "pending", String(t3After?.status));

			// Input validation must reject clearly — all paths throw before any
			// spawn or dispatch (zero token).
			const expectThrow = async (name: string, fn: () => Promise<unknown>): Promise<boolean> => {
				try {
					await fn();
					return false;
				} catch {
					log("validation ok:", name);
					return true;
				}
			};
			const validations: Array<[string, () => Promise<unknown>]> = [
				["createMember: invalid name", () => manager.createMember({ name: "Bad_Name" })],
				["sendMessage: unknown member", () => manager.sendMessage("ghost", "hi")],
				["createTask: empty title", () => manager.createTask({ title: "   " })],
				["startTask: unknown id", () => manager.startTask("T999")],
			];
			for (const [name, fn] of validations) {
				check(`validation: ${name} throws`, await expectThrow(name, fn));
			}

			const reg = loadRegistry(manager.teamId);
			check("registry: the board persisted to disk", Array.isArray(reg?.tasks), String(reg?.tasks.length));
			check("registry: statuses survived the round trip",
				reg?.tasks.find((t) => t.id === t1.id)?.status === "done"
				&& reg?.tasks.find((t) => t.id === t2.id)?.status === "failed"
				&& reg?.tasks.find((t) => t.id === t3.id)?.status === "pending",
				reg?.tasks.map((t) => `${t.id}:${t.status}`).join(","));

			const failed = results.filter((r) => !r.ok);
			log(`SMOKE2 DONE (${results.length - failed.length}/${results.length} passed)`);
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
		}
	});
}
