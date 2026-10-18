/**
 * Misc coverage probe (plan-43). Costs several small LLM calls (test key).
 * Covers: oneshot mode, task chain live (T1 → T2), unicode/emoji round-trip,
 * kill -9 crash recovery (registry status honesty), and streaming progress.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../extensions/members.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke12]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			await manager.createMember({ name: "w1", role: "worker" });

			// 1. oneshot mode: stateless fresh process, reply flows back
			let oneshotText = "";
			let oneshotErr: string | undefined;
			try {
				const r = await manager.sendOneshot("w1", "Reply with exactly: ONESHOT-OK");
				oneshotText = r.text;
			} catch (e) {
				oneshotErr = e instanceof Error ? e.message : String(e);
			}
			check("oneshot: reply received", !oneshotErr && /oneshot-ok/i.test(oneshotText), oneshotErr ?? oneshotText.slice(0, 120));
			const turns = manager.snapshot().members.find((m) => m.name === "w1")?.usage.turns ?? 0;
			check("oneshot: usage recorded on member", turns > 0, `turns=${turns}`);

			// 2. task chain live: T1 → T2(blockedBy T1)
			const t1 = await manager.createTask({ title: "Say PONG-CHAIN-1", assignee: "w1" });
			const t2 = await manager.createTask({ title: "Say PONG-CHAIN-2", blockedBy: [t1.id], assignee: "w1" });
			const r1 = await manager.startTask(t1.id);
			check("task chain: T1 done with result", r1.task.status === "done" && /pong-chain-1/i.test(r1.text), r1.text.slice(0, 100));
			const r2 = await manager.startTask(t2.id);
			check("task chain: T2 done after T1", r2.task.status === "done" && /pong-chain-2/i.test(r2.text), r2.text.slice(0, 100));

			// 3. unicode round-trip
			const r3 = await manager.sendMessage("w1", "Reply with exactly: 你好🚀-OK");
			check("unicode: emoji round-trip", /你好🚀-OK/.test(r3.text), r3.text.slice(0, 100));

			// 4. crash recovery: SIGKILL the member, then dispatch again
			const pid = manager.snapshot().members.find((m) => m.name === "w1")?.pid ?? -1;
			if (pid > 0) {
				try {
					process.kill(pid, "SIGKILL");
				} catch {
					/* already gone */
				}
				await new Promise((r) => setTimeout(r, 1500));
				const statusAfter = manager.snapshot().members.find((m) => m.name === "w1")?.status;
				check("crash: status dead after SIGKILL", statusAfter === "dead", `got ${statusAfter}`);
			}
			const r4 = await manager.sendMessage("w1", "Reply with exactly: CRASH-OK");
			check("crash: respawn and reply after SIGKILL", /crash-ok/i.test(r4.text), r4.text.slice(0, 100));

			// 5. streaming: interim updates carry the member's text
			const interim: string[] = [];
			const r5 = await manager.sendMessage("w1", "First use bash to run: echo hi. Then reply with exactly: STREAM-OK", {
				onProgress: (t) => interim.push(t),
			});
			check("streaming: reply received", /stream-ok/i.test(r5.text), r5.text.slice(0, 100));
			check(
				"streaming: interim updates observed",
				interim.length >= 1 && /stream-ok/i.test(interim[interim.length - 1] ?? ""),
				`${interim.length} update(s)`,
			);

			await manager.disband();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE12 DONE (all passed)" : `SMOKE12 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE12 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
