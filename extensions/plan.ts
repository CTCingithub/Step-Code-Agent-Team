/**
 * Team plan tiers.
 *
 * Four preset *strategies* (economic / fast / balanced / performance)
 * offered by the /topo picker when [stepcodeAgentTeam.plan] is enabled. A
 * tier is guidance, not a fixed roster: each tier carries a localized
 * instruction (built in forward.ts) whose member/topology examples are
 * explicitly non-binding — the leader model decides the actual team from
 * the task. This keeps the plugin's "leader orchestrates" philosophy and
 * avoids hardcoding rosters that stop fitting as models improve.
 *
 * Design notes:
 * - No cost multipliers are shown: they were estimates, and estimates in a
 *   picker read as promises.
 * - Labels are bilingual so the picker can match the user's language
 *   (detected from the request text; bare /topo falls back to Chinese).
 * - autonomousSelection is off by default, so tiers never depend on model
 *   choice — guidance mentions effort levels only.
 */

import type { EffortLevel } from "./config.ts";
import type { TopologyShape } from "./topology.ts";

export const PLAN_TIER_IDS = ["economic", "fast", "balanced", "performance"] as const;
export type PlanTierId = (typeof PLAN_TIER_IDS)[number];

/** Config values for plan.tier: ask every time, or pin one tier. */
export const PLAN_TIER_MODES = ["always ask", ...PLAN_TIER_IDS] as const;
export type PlanTierMode = (typeof PLAN_TIER_MODES)[number];

/** Default standing choice: the picker asks on every /topo activation. */
export const DEFAULT_TIER_MODE: PlanTierMode = "always ask";

/** Picker-timeout / no-choice fallback. */
export const FALLBACK_TIER_ID: PlanTierId = "balanced";

export type Lang = "zh" | "en";

export interface TeamTier {
	id: PlanTierId;
	label: Record<Lang, string>;
	/** One-line strategy statement, localized. */
	guidance: Record<Lang, string>;
	/** Non-binding example roster/topology, localized. */
	example: Record<Lang, string>;
	/**
	 * The tier's standard plan shape — what the tier directs the model to
	 * build. Rendered as labeled lines in the confirmation dialog so the
	 * user approves a concrete plan, not strategy prose. Member names,
	 * counts, and division of labor still adapt to the task (the model is
	 * told so in its instruction); the shape itself is the tier's.
	 */
	plan: {
		members: Record<Lang, string>;
		topology: Record<Lang, string>;
		effort: Record<Lang, string>;
	};
}

const TIERS: Record<PlanTierId, TeamTier> = {
	economic: {
		id: "economic",
		label: { zh: "经济", en: "Economic" },
		guidance: {
			zh: "以最低成本完成用户的请求：少成员、低 effort，省去不必要的规划与审查环节。",
			en: "Complete the request at the lowest cost: few members, low effort, skip unnecessary planning and review stages.",
		},
		plan: {
			members: {
				zh: "1–2 名：scout 只读调研 + worker 执行",
				en: "1–2: one scout for read-only research + one worker to execute",
			},
			topology: {
				zh: "star；省去规划与审查环节，直击执行",
				en: "star; planning and review stages skipped, straight to execution",
			},
			effort: {
				zh: "low/medium——以最低成本完成请求",
				en: "low/medium — complete the request at the lowest cost",
			},
		},
		example: {
			zh: "示例（仅供参考，非固定方案）：1 名 scout 只读调研 + 1 名 worker 执行，effort 取 low/medium，拓扑用 star，任务依赖用任务板 blockedBy 表达。",
			en: "Example (a suggestion, not a fixed plan): 1 scout for read-only research + 1 worker to execute, effort low/medium, star topology, task dependencies via the task board's blockedBy.",
		},
	},
	fast: {
		id: "fast",
		label: { zh: "快速", en: "Fast" },
		guidance: {
			zh: "以最短耗时完成用户的请求：立即并行开工，尽量减少中间环节。",
			en: "Complete the request as fast as possible: start in parallel immediately and minimize intermediate stages.",
		},
		plan: {
			members: {
				zh: "2 名 worker 并行分治",
				en: "2 workers splitting the work in parallel",
			},
			topology: {
				zh: "star；立即并行开工，无中间环节",
				en: "star; start in parallel immediately, no intermediate stages",
			},
			effort: {
				zh: "low——以最短耗时完成请求",
				en: "low — complete the request as fast as possible",
			},
		},
		example: {
			zh: "示例（仅供参考，非固定方案）：2 名 worker 并行分治，effort 取 low，拓扑用 star。",
			en: "Example (a suggestion, not a fixed plan): 2 workers splitting the work in parallel, effort low, star topology.",
		},
	},
	balanced: {
		id: "balanced",
		label: { zh: "均衡", en: "Balanced" },
		guidance: {
			zh: "在成本与质量之间平衡地完成用户的请求：覆盖勘察、规划、执行、审查各环节。",
			en: "Complete the request balancing cost and quality: cover the exploration, planning, execution, and review stages.",
		},
		plan: {
			members: {
				zh: "scout + planner + 2 worker + reviewer",
				en: "scout + planner + 2 workers + reviewer",
			},
			topology: {
				zh: "star；依赖用任务板 blockedBy 表达",
				en: "star; dependencies via the task board's blockedBy",
			},
			effort: {
				zh: "low/medium——成本与质量平衡，覆盖勘察→规划→执行→审查",
				en: "low/medium — balance cost and quality; exploration → planning → execution → review",
			},
		},
		example: {
			zh: "示例（仅供参考，非固定方案）：scout + planner + 2 名 worker + reviewer，effort 取 low/medium，拓扑用 star，任务依赖用任务板 blockedBy 表达。",
			en: "Example (a suggestion, not a fixed plan): scout + planner + 2 workers + reviewer, effort low/medium, star topology, task dependencies via the task board's blockedBy.",
		},
	},
	performance: {
		id: "performance",
		label: { zh: "性能", en: "Performance" },
		guidance: {
			zh: "以最高质量完成用户的请求，不计较成本：多成员、高 effort 深度协作，可并行竞速后择优。",
			en: "Complete the request at the highest quality regardless of cost: many members, high effort, deep collaboration — parallel racing with a final pick is fine.",
		},
		plan: {
			members: {
				zh: "scout + planner + 3 worker + 2 reviewer，可并行竞速后择优",
				en: "scout + planner + 3 workers + 2 reviewers; parallel racing with a final pick is fine",
			},
			topology: {
				zh: "star 或 custom 表达依赖方向；成员经内置 topo_team_msg 直达通信",
				en: "star or custom to express dependency direction; members message teammates via the built-in topo_team_msg",
			},
			effort: {
				zh: "high/xhigh——深度协作，不计较成本",
				en: "high/xhigh — deep collaboration, cost is no object",
			},
		},
		example: {
			zh: "示例（仅供参考，非固定方案）：scout + planner + 3 名 worker + 2 名 reviewer，effort 取 high/xhigh；可用 custom 拓扑表达依赖方向——成员经内置 topo_team_msg 工具直达通信（只读角色无需 bash 也可用），依赖请同时用任务板 blockedBy 表达。",
			en: "Example (a suggestion, not a fixed plan): scout + planner + 3 workers + 2 reviewers, effort high/xhigh; a custom topology may express dependency direction — members message teammates through the built-in topo_team_msg tool (no bash needed, read-only roles included), and dependencies should also be expressed via the task board's blockedBy.",
		},
	},
};

export function allTiers(): TeamTier[] {
	return PLAN_TIER_IDS.map((id) => TIERS[id]);
}

/** Unknown or missing ids fall back to the fallback tier. */
export function getTier(id: string | undefined | null): TeamTier {
	return (id && TIERS[id as PlanTierId]) || TIERS[FALLBACK_TIER_ID];
}

/** Localized label for the picker / summaries. */
export function tierLabel(tier: TeamTier, lang: Lang): string {
	return tier.label[lang] ?? tier.label.zh;
}

/**
 * Labeled plan lines for the confirmation dialog — the tier's standard shape
 * (members / topology / effort), labels defined once per language.
 */
export function tierPlanLines(tier: TeamTier, lang: Lang): string[] {
	const l = (zh: string, en: string): string => (lang === "zh" ? zh : en);
	return [
		`${l("成员", "Members")}${l("：", ": ")}${tier.plan.members[lang]}`,
		`${l("拓扑", "Topology")}${l("：", ": ")}${tier.plan.topology[lang]}`,
		`${l("effort", "Effort")}${l("：", ": ")}${tier.plan.effort[lang]}`,
	];
}

/** Picker option strings (localized, no cost multipliers). */
export function tierPickerOptions(lang: Lang): string[] {
	const options = allTiers().map((t) => tierLabel(t, lang));
	const custom = lang === "zh" ? "自定义需求…" : "Custom requirements…";
	const balancedIdx = PLAN_TIER_IDS.indexOf("balanced");
	return [...options.slice(0, balancedIdx), `${options[balancedIdx]}${lang === "zh" ? "（默认）" : " (default)"}`, ...options.slice(balancedIdx + 1), custom];
}

/** True when the token names a tier (id, or either localized label). */
export function matchTierToken(token: string): PlanTierId | null {
	const t = token.trim().toLowerCase();
	if (!t) return null;
	for (const tier of allTiers()) {
		if (t === tier.id || t === tier.label.zh || t === tier.label.en.toLowerCase()) return tier.id;
	}
	return null;
}

/** Optional guided picks from the custom flow (all non-binding). */
export interface CustomPicks {
	size?: number;
	shape?: TopologyShape;
	effort?: EffortLevel;
}

/**
 * Dialog options for the plan-confirmation select. The host's countdown is a
 * TUI-only component that ignores keypresses — it runs to expiry and can
 * dismiss the dialog while the user is still reading the plan — and the
 * plugin cannot hook the dialog's keys. The TUI therefore gets no timeout at
 * all: no countdown, and the dialog waits for the decision. Other modes keep
 * a deadline as a no-answer guard.
 */
export function planConfirmDialogOpts(mode: string, timeoutMs: number): { timeout: number } | undefined {
	return mode === "tui" ? undefined : { timeout: timeoutMs };
}
