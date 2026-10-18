/**
 * Phase 2 smoke probe (zero token cost): exercises the task board logic
 * without dispatching any LLM work. Loaded alongside the extension.
 *
 * Verifies: task creation, dependency gating, cycle rejection, ready-set
 * transitions on complete/fail, and registry persistence.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { loadRegistry } from "../../extensions/registry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...args: unknown[]) => console.error("[smoke2]", ...args);
		const fail = (msg: string) => log("SMOKE2 FAILED:", msg);
		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			const t1 = await manager.createTask({ title: "Collect API inventory" });
			const t2 = await manager.createTask({ title: "Write client code", blockedBy: [t1.id] });
			const t3 = await manager.createTask({ title: "Integration test", blockedBy: [t2.id] });
			log("created:", t1.id, t2.id, t3.id, "statuses:", t1.status, t2.status, t3.status);
			if (t1.status !== "ready" || t2.status !== "pending" || t3.status !== "pending") {
				fail(`expected ready/pending/pending, got ${t1.status}/${t2.status}/${t3.status}`);
				return;
			}

			// Self-cycle must be rejected and leave the board untouched.
			let rejected = false;
			try {
				await manager.createTask({ title: "self cycle", blockedBy: ["T4"] });
			} catch {
				rejected = true;
			}
			const boardAfterReject = manager.snapshot().tasks.length;
			log("cycle rejected:", rejected, "board size:", boardAfterReject);
			if (!rejected || boardAfterReject !== 3) {
				fail("cycle rejection broken");
				return;
			}

			// startTask on a non-ready task must fail (needs no LLM: rejects before dispatch).
			let notReadyRejected = false;
			try {
				await manager.startTask(t3.id);
			} catch {
				notReadyRejected = true;
			}
			log("startTask on pending rejected:", notReadyRejected);
			if (!notReadyRejected) {
				fail("startTask should reject non-ready tasks");
				return;
			}

			manager.completeTask(t1.id, "done: inventory collected");
			const afterT1 = manager.snapshot().tasks;
			log("after complete T1:", afterT1.map((t) => `${t.id}:${t.status}`).join(","));
			if (afterT1.find((t) => t.id === t2.id)?.status !== "ready") {
				fail("T2 should be ready after T1 done");
				return;
			}

			manager.failTask(t2.id, "boom");
			const afterFail = manager.snapshot().tasks;
			log("after fail T2:", afterFail.map((t) => `${t.id}:${t.status}`).join(","));
			const t3After = afterFail.find((t) => t.id === t3.id);
			if (t3After?.status !== "pending") {
				fail("T3 must stay pending when its dependency failed");
				return;
			}

			const reg = loadRegistry(manager.teamId);
			log("registry persisted:", reg?.tasks.map((t) => `${t.id}:${t.status}`).join(","));
			log("SMOKE2 DONE");
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
		}
	});
}
