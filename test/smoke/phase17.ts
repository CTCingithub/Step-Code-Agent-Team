/**
 * Orphan-process probe (plan-25). Zero-token: spawns one member, records its
 * pid, and exits WITHOUT disbanding — the member must not outlive its leader
 * (stdin EOF / session_shutdown). The runner asserts the pid is gone.
 */

import * as fs from "node:fs";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke17]", ...a);
		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const { member } = await manager.createMember({ name: "orphanchk" });
			const pidFile = `${process.env.STEP_CODING_AGENT_DIR ?? "."}/orphan.pid`;
			fs.writeFileSync(pidFile, String(member.pid));
			log("spawned orphanchk pid", member.pid);
			log("SMOKE17 DONE (all passed)");
			setTimeout(() => process.exit(0), 2000);
		} catch (err) {
			log("SMOKE17 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
