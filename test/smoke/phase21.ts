/**
 * Team-request instruction probe (plan-62, reworked for 0.2.0). Zero-token,
 * pure-function level.
 *
 * The /topo command forwards its argument as a real user message — verbatim,
 * so the session log matches what the user typed (0.2.0 log fidelity). The
 * "use the team" signal the wrapper used to prepend is now injected
 * request-locally through the context event; this probe locks the
 * instruction builders' language selection and the plan-tier data.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { hasCjk, teamActivationInstruction, tierInstruction } from "../../extensions/forward.ts";
import {
	allTiers,
	customTier,
	getTier,
	PLAN_TIER_IDS,
	tierMemberCount,
	tierMemberNames,
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
			check("hasCjk: zh", hasCjk("请审查这个仓库"));
			check("hasCjk: en", !hasCjk("review this repo"));

			// 2. generic activation instruction (no tier chosen)
			const zh = teamActivationInstruction("请深入阅读本项目");
			check("instruction: CJK request → Chinese", zh.includes("智能体团队已启用") && zh.includes("team_create_member"));
			const en = teamActivationInstruction("review this repo");
			check("instruction: ASCII request → English", en.includes("Agent team active") && en.includes("team_create_member"));

			// 3. a tier instruction carries the full plan
			const balanced = getTier("balanced");
			const zhTier = tierInstruction(balanced, "请审查这个仓库");
			check("tier: label + multiplier", zhTier.includes("团队方案 · 均衡") && zhTier.includes("~1×"));
			check(
				"tier: member steps carry thinking",
				zhTier.includes('team_create_member(name="scout1", role="scout", thinking="low")') &&
					zhTier.includes('team_create_member(name="reviewer1", role="reviewer", thinking="medium")'),
			);
			check("tier: topology declaration", zhTier.includes('team_set_topology(shape="star")'));
			const enTier = tierInstruction(getTier("economy"), "review this repo");
			check("tier: economy → English + pipeline", enTier.includes("[Team plan") && enTier.includes("pipeline"));

			// 4. tier data
			check("plan: four tiers", PLAN_TIER_IDS.length === 4 && allTiers().length === 4);
			check("plan: unknown id falls back to balanced", getTier("nope").id === "balanced" && getTier(undefined).id === "balanced");
			check("plan: performance has 7 members", tierMemberCount(getTier("performance")) === 7);
			check(
				"plan: performance member names",
				tierMemberNames(getTier("performance"))
					.map((m) => m.name)
					.join(",") === "scout1,planner1,worker1,worker2,worker3,reviewer1,reviewer2",
			);
			check(
				"plan: balanced member names",
				tierMemberNames(balanced)
					.map((m) => m.name)
					.join(",") === "scout1,planner1,worker1,worker2,reviewer1",
			);

			// 5. custom tier from the guided flow
			const custom = customTier({ size: 3, shape: "star", thinking: "high" });
			check(
				"plan: custom size 3 → 3 members with uniform thinking",
				tierMemberCount(custom) === 3 && custom.members.every((m) => m.thinking === "high"),
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
