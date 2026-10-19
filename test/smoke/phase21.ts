/**
 * Forward-wrapper probe (plan-62). Zero-token, pure-function level.
 *
 * The /agent-team command forwards its argument as a real user message; the
 * 2026-10-19 TUI report showed a verbatim-forwarded request completed with
 * ZERO team tool calls (the tools are available, but nothing says to use
 * them). wrapTeamRequest makes the intent explicit — this probe locks the
 * wrapper's language selection and content preservation.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { wrapTeamRequest } from "../../extensions/forward.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke21]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// 1. a CJK request gets the Chinese instruction...
			const zh = wrapTeamRequest("请深入阅读本项目，然后输出一段学术性介绍");
			check("wrap: CJK request → Chinese instruction", zh.startsWith("请使用智能体团队工具完成以下请求：\n"), zh.slice(0, 40));
			check("wrap: CJK request preserved verbatim", zh.endsWith("请深入阅读本项目，然后输出一段学术性介绍"));

			// 2. ...an ASCII request the English one.
			const en = wrapTeamRequest("review this repo");
			check("wrap: ASCII request → English instruction", en.startsWith("Use the agent team tools to accomplish the following request:\n"), en.slice(0, 50));
			check("wrap: ASCII request preserved verbatim", en.endsWith("review this repo"));

			// 3. mixed text follows the dominant script; content is never altered.
			const mixed = wrapTeamRequest("用 agent team 审查 src/");
			check("wrap: mixed text → Chinese instruction", mixed.startsWith("请使用智能体团队工具完成以下请求：\n"));
			check("wrap: multi-line request preserved", wrapTeamRequest("a\nb").endsWith("a\nb"));
			check("wrap: exactly one instruction line + request", wrapTeamRequest("x").split("\n").length === 2);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE21 DONE (all passed)" : `SMOKE21 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE21 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
