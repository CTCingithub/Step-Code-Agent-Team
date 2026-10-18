/**
 * Guardrail helpers probe (plan-25). Zero-token, standalone (see
 * STANDALONE_PHASES in run-smoke.sh): asserts the cost-warning text and the
 * output truncation contract that used to need eyeballing in a live session.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { costWarning, truncateOutput } from "../../extensions/tools.ts";
import { defaultConfig } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke16]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// ---- costWarning ----
			const cfg = defaultConfig();
			cfg.cost.warnThreshold = 1;
			check("cost: below threshold → silent", costWarning(cfg, 0.5) === "");
			const at = costWarning(cfg, 1);
			check("cost: at threshold → warns", at.includes("[cost guardrail]"), at.slice(0, 80));
			check("cost: warning formats amounts", at.includes("$1.0000") && at.includes("$1.00"), at.slice(0, 120));
			cfg.cost.warnThreshold = 0;
			check("cost: threshold 0 disables", costWarning(cfg, 100) === "");
			cfg.cost.warnThreshold = 0.25;
			check("cost: fractional threshold fires", costWarning(cfg, 0.3).includes("$0.30"), "");

			// ---- truncateOutput ----
			check("truncate: short text unchanged", truncateOutput("hello") === "hello");
			const exact = "x".repeat(50 * 1024);
			check("truncate: exactly at cap unchanged", truncateOutput(exact) === exact);
			const over = "y".repeat(50 * 1024 + 100);
			const cut = truncateOutput(over);
			check("truncate: over cap gets notice", cut.includes("[Output truncated: 100 bytes omitted."), cut.slice(-80));
			check("truncate: over cap keeps the prefix", cut.startsWith("y".repeat(1024)), "");

			// A cut must not split a surrogate pair (emoji at the boundary).
			const withEmoji = "a".repeat(50 * 1024 - 1) + "😀";
			const cutEmoji = truncateOutput(withEmoji);
			check(
				"truncate: no lone trailing surrogate",
				!/[\uD800-\uDBFF]$/.test(cutEmoji.replace(/\n\n\[Output truncated[\s\S]*$/, "")),
				`tail=${JSON.stringify(cutEmoji.slice(-12))}`,
			);
			check("truncate: emoji case reports 4 bytes omitted", cutEmoji.includes("4 bytes omitted"), cutEmoji.slice(-80));

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE16 DONE (all passed)" : `SMOKE16 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE16 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
