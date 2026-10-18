/**
 * Phase 1 smoke probe (zero token cost): exercises member lifecycle without
 * prompting any LLM. Loaded alongside the extension via `step -e`.
 *
 * Verifies: extension load, member spawn + RPC handshake, registry persistence,
 * disband (process kill), and recreate (resume path via same session id).
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { loadRegistry } from "../../extensions/registry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...args: unknown[]) => console.error("[smoke]", ...args);
		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			log("teamId:", manager.teamId);

			const created = await manager.createMember({
				name: "smoke1",
				role: "smoke",
				systemPrompt: "You are a smoke test member.",
			});
			log("createMember:", JSON.stringify({ created: created.created, ...created.member }));

			const reg = loadRegistry(manager.teamId);
			log("registry:", JSON.stringify(reg?.members.map((m) => ({ name: m.name, status: m.status, pid: m.pid }))));

			const killed = await manager.disband("smoke1");
			log("disband:", killed.join(",") || "(none)");
			log("after disband:", loadRegistry(manager.teamId)?.members[0]?.status);

			const again = await manager.createMember({ name: "smoke1" });
			log("recreate:", JSON.stringify({ created: again.created, pid: again.member.pid, status: again.member.status }));

			await manager.disband();
			log("SMOKE DONE");
		} catch (err) {
			log("SMOKE FAILED:", err instanceof Error ? err.message : String(err));
		}
	});
}
