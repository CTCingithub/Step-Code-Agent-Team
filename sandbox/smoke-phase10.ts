/**
 * Concurrency limit probe (plan-43). Costs a few small LLM calls (test key).
 *
 * Branch A (maxConcurrent >= 2): 4 parallel dispatches — all complete and at
 * most maxConcurrent members run at any moment (polled from the registry),
 * proving the queue-before-start semantics.
 * Branch B (maxConcurrent == 1): a member holding the only slot messages a
 * sibling through the shim — must not deadlock (surfaces the nested-dispatch
 * semaphore defect if present).
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { type SendResult, TeamManager } from "../extensions/members.ts";
import { getConfig } from "../extensions/config.ts";
import { shimPath } from "../extensions/presets.ts";
import { TeamServer } from "../extensions/team-server.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke10]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const cfg = getConfig();
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			log(
				"mode:",
				cfg.dispatch.maxConcurrent === 1
					? "nested-messaging-under-single-slot"
					: `parallel-bound (maxConcurrent=${cfg.dispatch.maxConcurrent})`,
			);

			if (cfg.dispatch.maxConcurrent === 1) {
				// Branch B: nested messaging while the only running slot is held.
				await manager.createMember({ name: "a", role: "worker" });
				await manager.createMember({ name: "b", role: "worker" });
				manager.setTopology("mesh");
				// The probe runs without plugin activation, so start the team
				// server here (real sessions start it on activation).
				const server = new TeamServer(manager.socketPath, () => manager);
				server.start();
				await new Promise((r) => setTimeout(r, 300));
				const shim = shimPath();
				const started = Date.now();
				let text = "";
				let err: string | undefined;
				try {
					const r = await manager.sendMessage("a", [
						"Use your bash tool exactly once to run this command:",
						`node ${shim} msg --to b --message "Reply with exactly: BETA-OK"`,
						"Then report the command's output verbatim.",
					].join("\n"));
					text = r.text;
				} catch (e) {
					err = e instanceof Error ? e.message : String(e);
				}
				const elapsed = Date.now() - started;
				check(
					"nested under maxConcurrent=1: completes with BETA-OK",
					!err && /beta-ok/i.test(text),
					err ?? `${elapsed}ms: ${text.slice(0, 120)}`,
				);
				server.stop();
			} else {
				// Branch A: 4 parallel dispatches under a bounded slot count.
				for (let i = 1; i <= 4; i++) await manager.createMember({ name: `w${i}`, role: "worker" });
				let maxRunning = 0;
				let stop = false;
				const poll = (async () => {
					while (!stop) {
						const running = manager.snapshot().members.filter((m) => m.status === "running").length;
						if (running > maxRunning) maxRunning = running;
						await new Promise((r) => setTimeout(r, 100));
					}
				})();
				const settled = await Promise.allSettled(
					[1, 2, 3, 4].map((i) => manager.sendMessage(`w${i}`, `Reply with exactly: PONG-${i}`)),
				);
				stop = true;
				await poll;
				const texts = settled.map((r) =>
					r.status === "fulfilled"
						? (r as PromiseFulfilledResult<SendResult>).value.text
						: `ERR:${String((r as PromiseRejectedResult).reason)}`,
				);
				const okCount = texts.filter((t) => /pong-\d/i.test(t)).length;
				check("parallel: all 4 replies received", okCount === 4, `${okCount}/4: ${texts.join(" | ").slice(0, 160)}`);
				check(
					`parallel: max running ≤ ${cfg.dispatch.maxConcurrent} (queued starts)`,
					maxRunning >= 1 && maxRunning <= cfg.dispatch.maxConcurrent,
					`observed max ${maxRunning}`,
				);
			}

			await manager.disband();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE10 DONE (all passed)" : `SMOKE10 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE10 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
