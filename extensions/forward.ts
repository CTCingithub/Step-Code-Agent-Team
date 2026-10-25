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

/**
 * Generic instruction used when no plan tier was chosen. It carries the
 * condensed orchestration protocol that used to live in the
 * skills/team-orchestration skill — delivered request-locally on the
 * activation turn instead of occupying context as a skill resource.
 */
export function teamActivationInstruction(lang: Lang): string {
	return lang === "zh"
		? [
				"[智能体团队已启用] 请用团队工具完成用户的请求，并遵守以下协议：",
				"1. 组队判据：任务有独立并行 strand 才组队；2–4 成员为宜，每人一个明确焦点；单点小改动不要过度拆分。熟悉/了解/介绍类请求 1–2 名只读成员即可；用户未要求改动时保持只读，不要顺手修改文件。",
				"2. 拓扑先行：建成员后、派活前用 team_set_topology 声明拓扑——默认 star（队长中转）；顺序精炼用 pipeline；同伴互查用 mesh/ring。成员经内置 topo_team_msg 工具直达通信（无需 bash，只读角色同样可用）；依赖请用任务板 blockedBy 表达。ring/relay 链路中，每一跳的任务书必须写明：终稿沿调用链回传——leader 不是消息目标，勿试图直发队长。",
				"3. 运行流程：team_create_member 建成员 → team_set_topology 声明拓扑 → team_task 拆解任务（blockedBy 表达依赖）→ team_send / team_task start 派活（指令短小自包含，成员看不到你的对话）→ 自己合并各成员结论 → 完工后 team_disband。",
				'4. 成本纪律：不要把同一任务分给两个成员"求保险"；无状态扇出用 mode: "oneshot"；留意 team_status 的累计花费。',
			].join("\n")
		: [
				"[Agent team active] Use the team tools for the user's request, following this protocol:",
				"1. When to form a team: only when the work has independent parallel strands; 2–4 members is the sweet spot, each with a distinct focus; do not over-split a single small edit. Familiarization/overview requests need only 1–2 read-only members; when the user did not ask for changes, stay read-only — do not modify files as a side effect.",
				"2. Topology first: after creating members and before dispatching, declare the topology with team_set_topology — star by default (leader relays); pipeline for sequential refinement; mesh/ring for cross-checking. Members message teammates through the built-in topo_team_msg tool (no bash needed — read-only roles included); express dependencies with the task board's blockedBy. In ring/relay chains, every hop's task book must state that the final report returns along the reply chain — the leader is never a message target; do not try to message it directly.",
				"3. Run loop: team_create_member → team_set_topology → team_task with blockedBy → team_send / team_task start (short, self-contained instructions; members do not see your conversation) → merge the results yourself → team_disband when done.",
				'4. Cost discipline: never give two members the same task "for safety"; use mode: "oneshot" for stateless fan-out; watch cumulative spend in team_status.',
			].join("\n");
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

/**
 * One-off planning prompt for the tier confirmation: the model drafts the
 * ACTUAL team plan for this specific request — what the user is about to
 * approve — replacing the tier's preset shape in the Accept/Cancel dialog. Plan
 * only: no tools, no execution.
 */
export function teamPlanPrompt(request: string, tier: TeamTier, lang: Lang): { system: string; user: string } {
	const label = tier.label[lang] ?? tier.label.zh;
	if (lang === "zh") {
		return {
			system: "你是智能体小队的方案规划器。根据用户请求与既定策略，输出具体的组队方案。只输出方案本身：不要执行、不要调用工具、不要解释流程。",
			user: [
				`用户请求：${request}`,
				`既定策略：[团队方案 · ${label}] ${tier.guidance.zh}`,
				"请输出实际方案，依次包含：",
				"1. 成员名单：每个成员的名字、角色与各自 effort；",
				"2. 通信拓扑（star/pipeline/mesh/ring/custom）及选择理由；",
				"3. 任务拆解：每个任务从 1 起独立编号；每个任务分配给谁、先后依赖（用任务板 blockedBy 表达）。",
				"4. 方案必须与所声明拓扑自洽：star 下成员间没有任何直连消息——汇总/协调角色只能经队长中转收集（依赖用任务板 blockedBy 表达）；只有 pipeline/mesh/ring/custom 才存在成员间直连。",
				"控制在 10 行以内，直接给出方案。",
			].join("\n"),
		};
	}
	return {
		system: "You are the team planner for an agent squad. Given the user's request and the chosen strategy, output the concrete team plan. Output the plan only: no execution, no tool calls, no process commentary.",
		user: [
			`User request: ${request}`,
			`Chosen strategy: [Team plan · ${label}] ${tier.guidance.en}`,
			"Output the actual plan, covering:",
			"1. Roster: each member's name, role, and effort;",
			"2. Communication topology (star/pipeline/mesh/ring/custom) and why;",
			"3. Task breakdown: number each task from 1; who does what, and the order dependencies (expressed as task-board blockedBy edges).",
			"4. The plan must be consistent with its declared topology: under star there is no member-to-member messaging at all — a consolidator/coordinator can only collect through the leader (dependencies via task-board blockedBy); only pipeline/mesh/ring/custom create direct member links.",
			"Keep it within 10 lines; give the plan directly.",
		].join("\n"),
	};
}

/**
 * Instruction injected after the user confirms the model-generated plan:
 * the approved plan takes precedence over the tier's general guidance.
 */
export function approvedPlanInstruction(tier: TeamTier, plan: string, lang: Lang): string {
	const label = tier.label[lang] ?? tier.label.zh;
	if (lang === "zh") {
		return [
			`[团队方案 · ${label}] 用户已确认以下实际方案——优先级高于一般性策略描述，请严格按它组建（成员、角色、拓扑、effort、任务拆解）：`,
			plan,
		].join("\n");
	}
	return [
		`[Team plan · ${label}] The user confirmed this actual plan — it takes precedence over the general strategy; build exactly this (members, roles, topology, effort, task breakdown):`,
		plan,
	].join("\n");
}

/**
 * Parallel multi-reviewer protocol — the former prompts/team-review.md
 * template, reimplemented as code for the `/topo review` command (no
 * prompt-template resource, no context cost until invoked).
 */
export function teamReviewInstruction(focus: string, lang: Lang): string {
	if (lang === "zh") {
		return [
			"[团队方案 · 并行评审]",
			focus ? `评审对象：${focus}` : "评审对象：用户请求中指定的目标。",
			"按以下流程执行：",
			"1. team_create_member 建三名 reviewer：r1（正确性）、r2（风格）、r3（安全性）——均用只读预设；",
			"2. team_send 并行派发，每人只审自己的焦点区；",
			"3. team_task 建无依赖合并任务 T1 派给一名 worker：去重、消解矛盾、逐条给出结论；",
			"4. 队长注明每条发现出自哪个审查员，输出单一报告；",
			"5. 收尾 team_disband。拓扑用 star；reviewer 没有 bash，无法互发消息，由队长中转。",
		].join("\n");
	}
	return [
		"[Team plan · Parallel review]",
		focus ? `Review target: ${focus}` : "Review target: the target named in the user's request.",
		"Run the following protocol:",
		"1. team_create_member three reviewers: r1 (correctness), r2 (style), r3 (security) — read-only presets;",
		"2. Dispatch in parallel with team_send, each reviewing only its own focus area;",
		"3. team_task create a dependency-free merge task T1 assigned to a worker: deduplicate, resolve conflicts, and give a conclusion per finding;",
		"4. The leader attributes each finding to its reviewer and emits a single report;",
		"5. Finish with team_disband. Topology: star (the leader relays; reviewers could also message each other directly via topo_team_msg if the topology declared edges).",
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
