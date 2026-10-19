/**
 * Team plan tiers.
 *
 * Four preset team configurations (economy / fast / balanced / performance)
 * offered by the /topo picker when [stepcodeAgentTeam.plan] is enabled. A
 * tier is *data*: the leader model applies it through the regular team tools
 * (team_create_member / team_set_topology / team_task), so no spawn logic is
 * duplicated here.
 *
 * Design constraints baked into the data:
 * - autonomousSelection is off by default, so tiers never depend on model
 *   choice — differentiation comes from role mix, member count, thinking
 *   level, and task structure. Model intents are an opt-in layer only.
 * - Read-only presets (scout/planner/reviewer) have no bash, so topology
 *   edges touching them degrade to leader relay; dependencies belong on the
 *   task board (blockedBy) instead.
 * - dispatch.maxConcurrent / timeoutMs / retries are global config values
 *   read once per session, so the tier's guidance block is advisory only.
 */

import type { ThinkingLevel } from "./config.ts";
import type { TopologyShape } from "./topology.ts";

export const PLAN_TIER_IDS = ["economy", "fast", "balanced", "performance"] as const;
export type PlanTierId = (typeof PLAN_TIER_IDS)[number];

/** Tier applied when the picker times out or runs headless. */
export const DEFAULT_TIER_ID: PlanTierId = "balanced";

export interface TierMemberSpec {
	role: string;
	count: number;
	thinking: ThinkingLevel;
}

export interface TeamTier {
	id: PlanTierId;
	label: string;
	/** Rough relative cost vs. a single session (estimate — see docs). */
	multiplier: number;
	members: TierMemberSpec[];
	topology: { shape: TopologyShape; note?: string };
	/** Advisory dispatch tuning (global config values win). */
	guidance: { concurrency: number; timeoutMs: number; retries: number };
	bestFor: string;
}

const TIERS: Record<PlanTierId, TeamTier> = {
	economy: {
		id: "economy",
		label: "经济",
		multiplier: 0.3,
		members: [
			{ role: "scout", count: 1, thinking: "low" },
			{ role: "worker", count: 1, thinking: "medium" },
		],
		topology: {
			shape: "pipeline",
			note: "pipeline 表示 scout 探完交给 worker；只读角色没有 bash，该边实际退化为队长中转",
		},
		guidance: { concurrency: 1, timeoutMs: 120_000, retries: 0 },
		bestFor: "只读调研、小文档改动、信息查询",
	},
	fast: {
		id: "fast",
		label: "快速",
		multiplier: 0.5,
		members: [{ role: "worker", count: 2, thinking: "low" }],
		topology: { shape: "star" },
		guidance: { concurrency: 2, timeoutMs: 60_000, retries: 0 },
		bestFor: "格式化、重命名、批量小改、分钟级返回",
	},
	balanced: {
		id: "balanced",
		label: "均衡",
		multiplier: 1.0,
		members: [
			{ role: "scout", count: 1, thinking: "low" },
			{ role: "planner", count: 1, thinking: "medium" },
			{ role: "worker", count: 2, thinking: "medium" },
			{ role: "reviewer", count: 1, thinking: "medium" },
		],
		topology: { shape: "star" },
		guidance: { concurrency: 3, timeoutMs: 180_000, retries: 1 },
		bestFor: "常规功能开发、一般缺陷修复（默认档）",
	},
	performance: {
		id: "performance",
		label: "性能",
		multiplier: 2.2,
		members: [
			{ role: "scout", count: 1, thinking: "medium" },
			{ role: "planner", count: 1, thinking: "high" },
			{ role: "worker", count: 3, thinking: "high" },
			{ role: "reviewer", count: 2, thinking: "xhigh" },
		],
		topology: {
			shape: "custom",
			note: "菱形：planner 扇出至 worker、worker 汇入 reviewer；只读角色没有 bash，边退化为队长中转，依赖请同时用任务板 blockedBy 表达",
		},
		guidance: { concurrency: 5, timeoutMs: 180_000, retries: 2 },
		bestFor: "大规模重构、疑难缺陷、发布前深度审查",
	},
};

export function allTiers(): TeamTier[] {
	return PLAN_TIER_IDS.map((id) => TIERS[id]);
}

/** Unknown or missing ids fall back to the default tier. */
export function getTier(id: string | undefined | null): TeamTier {
	return (id && TIERS[id as PlanTierId]) || TIERS[DEFAULT_TIER_ID];
}

export function tierMemberCount(tier: TeamTier): number {
	return tier.members.reduce((sum, m) => sum + m.count, 0);
}

/** Deterministic member names for a tier: scout1, planner1, worker1, worker2, … */
export function tierMemberNames(tier: TeamTier): Array<{ name: string; role: string; thinking: ThinkingLevel }> {
	const out: Array<{ name: string; role: string; thinking: ThinkingLevel }> = [];
	for (const spec of tier.members) {
		for (let i = 1; i <= spec.count; i++) {
			out.push({ name: `${spec.role}${i}`, role: spec.role, thinking: spec.thinking });
		}
	}
	return out;
}

/** Role mix per team size for the guided "custom requirements" flow. */
const CUSTOM_MIX: Record<number, TierMemberSpec[]> = {
	2: [{ role: "worker", count: 2, thinking: "medium" }],
	3: [
		{ role: "scout", count: 1, thinking: "medium" },
		{ role: "worker", count: 1, thinking: "medium" },
		{ role: "reviewer", count: 1, thinking: "medium" },
	],
	5: [
		{ role: "scout", count: 1, thinking: "medium" },
		{ role: "planner", count: 1, thinking: "medium" },
		{ role: "worker", count: 2, thinking: "medium" },
		{ role: "reviewer", count: 1, thinking: "medium" },
	],
	7: [
		{ role: "scout", count: 1, thinking: "medium" },
		{ role: "planner", count: 1, thinking: "medium" },
		{ role: "worker", count: 3, thinking: "medium" },
		{ role: "reviewer", count: 2, thinking: "medium" },
	],
};

const CUSTOM_MULTIPLIER: Record<number, number> = { 2: 0.5, 3: 0.7, 5: 1.0, 7: 2.0 };

/**
 * Builds a tier from the guided custom flow (team size → topology shape →
 * thinking level). The collected free-text requirements travel with the
 * forwarded request; this tier only fixes the structural parameters.
 */
export function customTier(spec: { size: number; shape: TopologyShape; thinking: ThinkingLevel }): TeamTier {
	const mix = CUSTOM_MIX[spec.size] ?? CUSTOM_MIX[5];
	return {
		id: "balanced", // custom plans reuse the balanced id for config lookups
		label: "自定义",
		multiplier: CUSTOM_MULTIPLIER[spec.size] ?? 1.0,
		members: mix.map((m) => ({ ...m, thinking: spec.thinking })),
		topology: { shape: spec.shape },
		guidance: { concurrency: Math.min(5, Math.max(1, spec.size)), timeoutMs: 180_000, retries: 1 },
		bestFor: "自定义需求",
	};
}
