/**
 * LLM-path validation probe (requires STEP_API_KEY; spends a small amount of
 * tokens on the test key). Loaded alongside the extension via `step -e`.
 *
 * Drives real model exchanges through the full stack:
 *   1. member replies to a prompt          (spawn → prompt → settle → text)
 *   2. context memory, live process        (two turns on one member)
 *   3. resume after respawn                (disband → recreate → same session id)
 *   4. member-to-member messaging via shim (bash → shim → socket → server → member)
 *
 * All assertions are tolerant (substring/regex); failures are logged, not thrown.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../extensions/members.ts";
import { TeamServer } from "../extensions/team-server.ts";
import { shimPath } from "../extensions/presets.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke4]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			if (!process.env.STEP_API_KEY) {
				log("SMOKE4 FAILED: STEP_API_KEY is not set (export it, or put it in sandbox/TEST-KEY.md)");
				setTimeout(() => process.exit(1), 500);
				return;
			}

			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const server = new TeamServer(manager.socketPath, () => manager);
			server.start();
			await new Promise((r) => setTimeout(r, 300));

			// 1. basic reply
			await manager.createMember({ name: "t1", role: "worker" });
			const r1 = await manager.sendMessage("t1", "Reply with exactly one word: PONG");
			check("member replies to prompt", /pong/i.test(r1.text), r1.text);

			// 2. context memory within a live member
			await manager.sendMessage("t1", "Remember this number: 4242. Reply with just: OK");
			const r2 = await manager.sendMessage("t1", "What number did I ask you to remember? Reply with just the number.");
			check("context memory (live process)", r2.text.includes("4242"), r2.text);

			// 3. resume after respawn (same session id, fresh process)
			await manager.disband("t1");
			await manager.createMember({ name: "t1", role: "worker" });
			const r3 = await manager.sendMessage(
				"t1",
				"What number did I ask you to remember earlier in this conversation? Reply with just the number.",
			);
			check("resume after respawn", r3.text.includes("4242"), r3.text);

			// 4. member-to-member messaging through the shim (full chain, real LLMs)
			await manager.createMember({ name: "alpha", role: "worker" });
			await manager.createMember({ name: "beta", role: "worker" });
			// Topology gates direct messaging: allow alpha ↔ beta for this test.
			manager.setTopology("mesh");
			const shim = shimPath();
			const r4 = await manager.sendMessage(
				"alpha",
				[
					"Use your bash tool exactly once to run this command:",
					`node ${shim} msg --to beta --message "Reply with exactly: BETA-OK"`,
					"Then report the command's output verbatim.",
				].join("\n"),
			);
			check("member-to-member messaging via shim", /beta-ok/i.test(r4.text), r4.text);

			await manager.disband();
			server.stop();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE4 DONE (all passed)" : `SMOKE4 DONE (${failed}/${results.length} failed)`);
			// End the probe process so the run command returns promptly.
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE4 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
