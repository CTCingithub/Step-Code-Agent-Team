/**
 * Orphan-process probe (plan-25). Zero-token: spawns one member, records its
 * pid, and exits WITHOUT disbanding — the member must not outlive its leader
 * (stdin EOF / session_shutdown). The runner asserts the pid is gone.
 *
 * Every case goes through check() so each logs one PASS/FAIL line: this probe
 * used to log DONE unconditionally on its happy path, which meant it could be
 * gutted into a no-op and still look green — and a gutted probe takes the
 * runner's orphan-check down with it, because no orphan.pid gets written.
 */

import * as fs from "node:fs";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke17]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
		};
		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const { member } = await manager.createMember({ name: "orphanchk" });
			check("orphan probe: a member process was spawned",
				typeof member.pid === "number" && member.pid > 0,
				`pid=${member.pid}`);
			const pidFile = `${process.env.STEP_CODING_AGENT_DIR ?? "."}/orphan.pid`;
			fs.writeFileSync(pidFile, String(member.pid));
			check("orphan probe: the pid was recorded where the runner reads it",
				fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() === String(member.pid),
				pidFile);
			log("spawned orphanchk pid", member.pid);
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE17 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		} catch (err) {
			log("SMOKE17 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
