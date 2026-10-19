/**
 * Team-request instructions injected into the model's context.
 *
 * A slash command consumes the whole input, so text after the command is
 * re-injected as a real user message. Forwarding it verbatim leaves the
 * model with no signal that a team is active and expected: for an ordinary
 * request ("read the project and summarize") it simply answers solo — the
 * team tools are available, but nothing in the message says to use them.
 * (Verified in the 2026-10-19 TUI report: verbatim forwarding produced zero
 * team tool calls.)
 *
 * Since 0.2.0 the request is forwarded verbatim (log fidelity) and these
 * instructions are injected request-locally through the `context` event
 * (see index.ts): they reach the model for that turn only and are never
 * written to the session file.
 *
 * Since the 0.2.0 revision, a plan tier is a *strategy prompt*, not a fixed
 * roster: the tier instruction states the strategy and offers a non-binding
 * example, and the leader model decides the actual members and topology.
 */

import type { CustomPicks, Lang, TeamTier } from "./plan.ts";

/** CJK presence picks the instruction language, matching the request's own. */
export function hasCjk(text: string): boolean {
	return /[\u4e00-\u9fff]/.test(text);
}

export function detectLang(text: string): Lang {
	return hasCjk(text) ? "zh" : "en";
}

/** Generic instruction used when no plan tier was chosen. */
export function teamActivationInstruction(lang: Lang): string {
	return lang === "zh"
		? "[智能体团队已启用] 请使用团队工具完成用户的请求：先用 team_create_member 按需创建成员、用 team_set_topology 声明拓扑，再用 team_task / team_send 派活；不要把请求独自做完。"
		: "[Agent team active] Use the team tools for the user's request: create members with team_create_member, declare the topology with team_set_topology, then dispatch with team_task / team_send. Do not complete the request solo.";
}

/** Tier instruction: strategy + non-binding example; the model decides the team. */
export function tierInstruction(tier: TeamTier, lang: Lang): string {
	const label = tier.label[lang] ?? tier.label.zh;
	if (lang === "zh") {
		return [
			`[团队方案 · ${label}] ${tier.guidance.zh}`,
			tier.example.zh,
			"成员名、数量、角色、拓扑与 effort 均由你按任务实际需要决定——上述示例仅供参考，不要照搬。",
		].join("\n");
	}
	return [
		`[Team plan · ${label}] ${tier.guidance.en}`,
		tier.example.en,
		"Member names, counts, roles, topology, and effort are yours to decide from the task — the example above is a suggestion only, do not copy it verbatim.",
	].join("\n");
}

/** Custom-requirements instruction: the user's needs travel with the request. */
export function customTierInstruction(requirements: string, picks: CustomPicks, lang: Lang): string {
	const pickParts: string[] = [];
	if (picks.size) pickParts.push(lang === "zh" ? `参考规模 ${picks.size} 人` : `reference size ${picks.size}`);
	if (picks.shape) pickParts.push(lang === "zh" ? `参考拓扑 ${picks.shape}` : `reference topology ${picks.shape}`);
	if (picks.effort) pickParts.push(lang === "zh" ? `参考 effort ${picks.effort}` : `reference effort ${picks.effort}`);
	const picksLine =
		pickParts.length > 0
			? lang === "zh"
				? `用户参考项：${pickParts.join("、")}。`
				: `User reference picks: ${pickParts.join(", ")}.`
			: "";
	if (lang === "zh") {
		return [
			"[团队方案 · 自定义]",
			requirements ? `用户需求：${requirements}` : "用户未提供额外需求。",
			picksLine,
			"请按上述需求自行决定成员、角色、拓扑与 effort；用户参考项仅为建议，非固定方案。",
		]
			.filter(Boolean)
			.join("\n");
	}
	return [
		"[Team plan · Custom]",
		requirements ? `User requirements: ${requirements}` : "No extra requirements provided.",
		picksLine,
		"Decide members, roles, topology, and effort from the requirements above; the user's reference picks are suggestions, not a fixed plan.",
	]
		.filter(Boolean)
		.join("\n");
}
