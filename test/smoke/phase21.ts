/**
 * Team-request instruction + plan-tier probe (plan-62, reworked for the
 * 0.2.0 revision). Zero-token, pure-function level.
 *
 * The /topo command forwards its argument as a real user message — verbatim,
 * so the session log matches what the user typed (log fidelity). The "use the
 * team" signal is injected request-locally through the context event; this
 * probe locks the instruction builders' language selection and the plan-tier
 * data: strategy prompts with non-binding examples, localized labels, and no
 * cost multipliers.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import {
	customTierInstruction,
	detectLang,
	teamActivationInstruction,
	teamReviewInstruction,
	tierInstruction,
} from "../../extensions/forward.ts";
import {
	allTiers,
	getTier,
	matchTierToken,
	PLAN_TIER_IDS,
	PLAN_TIER_MODES,
	tierLabel,
	tierPickerOptions,
} from "../../extensions/plan.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke21]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// 1. language selection follows the request's own script
			check("detectLang: zh", detectLang("请审查这个仓库") === "zh");
			check("detectLang: en", detectLang("review this repo") === "en");

			// 2. generic activation instruction (no tier chosen)
			const zh = teamActivationInstruction("zh");
			check("instruction: zh mentions the team tools", zh.includes("智能体团队已启用") && zh.includes("team_create_member"));
			const en = teamActivationInstruction("en");
			check("instruction: en mentions the team tools", en.includes("[Agent team active]") && en.includes("team_create_member"));

			// 3. a tier instruction is a strategy prompt, not a fixed roster
			const balanced = getTier("balanced");
			const zhTier = tierInstruction(balanced, "zh");
			check("tier: zh label + guidance + example", zhTier.includes("[团队方案 · 均衡]") && zhTier.includes("成本与质量") && zhTier.includes("示例（仅供参考"));
			check("tier: model decides (not a fixed roster)", zhTier.includes("不要照搬"));
			check("tier: no cost multipliers", !zhTier.includes("×") && !zhTier.includes("~"));
			const enTier = tierInstruction(getTier("performance"), "en");
			check(
				"tier: en label + team_msg mechanism",
				enTier.includes("[Team plan · Performance]") && enTier.includes("team_msg tool") && enTier.includes("no bash needed"),
			);
			check("tier: en non-binding example", enTier.includes("a suggestion, not a fixed plan"));

			// 4. picker options: localized, multiplier-free
			const zhOptions = tierPickerOptions("zh");
			check(
				"picker: zh options",
				zhOptions.includes("经济") && zhOptions.includes("快速") && zhOptions.includes("均衡（默认）") && zhOptions.includes("性能") && zhOptions.includes("自定义需求…"),
				zhOptions.join(" | "),
			);
			check("picker: zh has no multipliers", !zhOptions.some((o) => o.includes("×")));
			const enOptions = tierPickerOptions("en");
			check(
				"picker: en options",
				enOptions.includes("Economic") && enOptions.includes("Fast") && enOptions.includes("Balanced (default)") && enOptions.includes("Performance") && enOptions.includes("Custom requirements…"),
				enOptions.join(" | "),
			);

			// 5. tier token matching accepts ids and localized labels
			check("token: economic", matchTierToken("economic") === "economic" && matchTierToken("经济") === "economic" && matchTierToken("Economic") === "economic");
			check("token: fast/balanced/performance", matchTierToken("fast") === "fast" && matchTierToken("快速") === "fast" && matchTierToken("balanced") === "balanced" && matchTierToken("均衡") === "balanced" && matchTierToken("performance") === "performance" && matchTierToken("性能") === "performance");
			check("token: unknown → null", matchTierToken("nope") === null && matchTierToken("") === null);

			// 6. tier data invariants
			check("plan: four tiers, five modes", PLAN_TIER_IDS.length === 4 && PLAN_TIER_MODES.length === 5 && PLAN_TIER_MODES.includes("always ask"));
			check("plan: unknown id falls back to balanced", getTier("nope").id === "balanced" && getTier(undefined).id === "balanced");
			check("plan: labels are bilingual", tierLabel(balanced, "zh") === "均衡" && tierLabel(balanced, "en") === "Balanced" && allTiers().length === 4);

			// 7. custom-requirements instruction carries the user's needs + picks
			const custom = customTierInstruction("重构 src/ 三个模块", { size: 5, shape: "star", effort: "high" }, "zh");
			check(
				"custom: requirements + reference picks + non-binding",
				custom.includes("用户需求：重构 src/ 三个模块") &&
					custom.includes("参考规模 5 人") &&
					custom.includes("参考拓扑 star") &&
					custom.includes("参考 effort high") &&
					custom.includes("非固定方案"),
			);
			const customEn = customTierInstruction("", {}, "en");
			check("custom: en without requirements", customEn.includes("No extra requirements provided"));

			// 8. review protocol instruction (the former team-review prompt
			// template, reimplemented as code for /topo review)
			const reviewZh = teamReviewInstruction("src/app.ts", "zh");
			check(
				"review: zh carries target + reviewers + merge + disband",
				reviewZh.includes("[团队方案 · 并行评审]") &&
					reviewZh.includes("评审对象：src/app.ts") &&
					reviewZh.includes("r1（正确性）") &&
					reviewZh.includes("合并任务 T1") &&
					reviewZh.includes("team_disband"),
			);
			const reviewEn = teamReviewInstruction("", "en");
			check(
				"review: en without focus, no multipliers",
				reviewEn.includes("[Team plan · Parallel review]") &&
					reviewEn.includes("the target named in the user's request") &&
					!reviewEn.includes("×"),
			);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE21 DONE (all passed)" : `SMOKE21 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE21 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
