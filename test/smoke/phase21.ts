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
	approvedPlanInstruction,
	teamActivationInstruction,
	teamPlanPrompt,
	teamReviewInstruction,
	tierInstruction,
} from "../../extensions/forward.ts";
import {
	allTiers,
	tierPlanLines,
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
				"tier: en label + topo_team_msg mechanism",
				enTier.includes("[Team plan · Performance]") && enTier.includes("topo_team_msg tool") && enTier.includes("no bash needed"),
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

			// 6b. tierPlanLines: the confirmation dialog's structured plan shape
			const planLinesZh = tierPlanLines(balanced, "zh");
			const planLinesEn = tierPlanLines(getTier("performance"), "en");
			check(
				"plan lines: three labeled rows, bilingual labels",
				planLinesZh.length === 3 &&
					planLinesZh[0].startsWith("成员：") &&
					planLinesZh[1].startsWith("拓扑：") &&
					planLinesZh[2].startsWith("effort：") &&
					planLinesEn.length === 3 &&
					planLinesEn[0].startsWith("Members: ") &&
					planLinesEn[1].startsWith("Topology: ") &&
					planLinesEn[2].startsWith("Effort: "),
			);
			check(
				"plan lines: content comes from the tier's plan data; every tier is complete",
				planLinesZh[0].includes("scout + planner + 2 worker + reviewer") &&
					planLinesEn[2].includes("high/xhigh") &&
					allTiers().every(
						(t) =>
							tierPlanLines(t, "zh").length === 3 &&
							tierPlanLines(t, "en").length === 3 &&
							t.plan.members.zh &&
							t.plan.members.en &&
							t.plan.topology.zh &&
							t.plan.topology.en &&
							t.plan.effort.zh &&
							t.plan.effort.en,
					),
			);

			// 6c. teamPlanPrompt / approvedPlanInstruction — the actual-plan confirmation flow
			const planPromptZh = teamPlanPrompt("修复 src/tasks.js 的 complete bug", balanced, "zh");
			const planPromptEn = teamPlanPrompt("fix the complete() bug", getTier("performance"), "en");
			check(
				"plan prompt: zh carries the request + tier strategy + roster/topology/task asks",
				planPromptZh.system.includes("方案") &&
					planPromptZh.user.includes("修复 src/tasks.js 的 complete bug") &&
					planPromptZh.user.includes("[团队方案 · 均衡]") &&
					planPromptZh.user.includes("成员名单") &&
					planPromptZh.user.includes("通信拓扑") &&
					planPromptZh.user.includes("任务拆解"),
			);
			check(
				"plan prompt: en carries the request + strategy + asks",
				planPromptEn.user.includes("fix the complete() bug") &&
					planPromptEn.user.includes("[Team plan · Performance]") &&
					planPromptEn.user.includes("Roster:") &&
					planPromptEn.user.includes("topology") &&
					planPromptEn.user.includes("Task breakdown"),
			);
			const approvedZh = approvedPlanInstruction(balanced, "T1: scout 定位\nT2: worker 修复", "zh");
			const approvedEn = approvedPlanInstruction(balanced, "PLAN-X", "en");
			check(
				"approved plan: zh carries the plan verbatim + precedence wording",
				approvedZh.includes("T1: scout 定位") && approvedZh.includes("T2: worker 修复") && approvedZh.includes("优先级高于"),
			);
			check(
				"approved plan: en carries the plan verbatim + precedence wording",
				approvedEn.includes("PLAN-X") && approvedEn.includes("takes precedence"),
			);


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
