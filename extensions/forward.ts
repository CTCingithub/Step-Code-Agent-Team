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
 * Until 0.1.x the instruction was prepended to the forwarded text, which
 * made the session log differ from what the user typed. Since 0.2.0 the
 * request is forwarded verbatim (log fidelity) and this instruction is
 * injected request-locally through the `context` event (see index.ts): it
 * reaches the model for that turn only and is never written to the session
 * file.
 */

import type { TeamTier } from "./plan.ts";
import { tierMemberNames } from "./plan.ts";

/** CJK presence picks the instruction language, matching the request's own. */
export function hasCjk(text: string): boolean {
	return /[\u4e00-\u9fff]/.test(text);
}

/** Generic instruction used when no plan tier was chosen. */
export function teamActivationInstruction(request: string): string {
	return hasCjk(request)
		? "[智能体团队已启用] 请使用团队工具完成用户的请求：先用 team_create_member 按需创建成员、用 team_set_topology 声明拓扑，再用 team_task / team_send 派活；不要把请求独自做完。"
		: "[Agent team active] Use the team tools for the user's request: create members with team_create_member, declare the topology with team_set_topology, then dispatch with team_task / team_send. Do not complete the request solo.";
}

/** Structured instruction that applies a chosen plan tier. */
export function tierInstruction(tier: TeamTier, request: string): string {
	const zh = hasCjk(request);
	const steps = tierMemberNames(tier)
		.map((m, i) => `${i + 1}. team_create_member(name="${m.name}", role="${m.role}", thinking="${m.thinking}")`)
		.join("\n");
	const topology = `team_set_topology(shape="${tier.topology.shape}")`;
	if (zh) {
		return [
			`[团队方案 · ${tier.label}（预估成本 ~${tier.multiplier}×）]`,
			`适用：${tier.bestFor}`,
			"请严格按以下步骤组建并驱动团队：",
			steps,
			`然后调用 ${topology} 声明拓扑，再用 team_task / team_send 派活。`,
			`调度参考值（全局配置优先）：并发 ${tier.guidance.concurrency}、单次超时 ${tier.guidance.timeoutMs}ms、重试 ${tier.guidance.retries}。`,
			tier.topology.note ? `拓扑说明：${tier.topology.note}。` : "",
			"只读角色（scout/planner/reviewer）没有 bash 工具，指向它们的拓扑边会退化为队长中转；任务依赖请同时用任务板 blockedBy 表达。",
		]
			.filter(Boolean)
			.join("\n");
	}
	return [
		`[Team plan · ${tier.label} (est. ~${tier.multiplier}x)]`,
		`Best for: ${tier.bestFor}`,
		"Build and drive the team strictly as follows:",
		steps,
		`Then call ${topology} to declare the topology and dispatch with team_task / team_send.`,
		`Dispatch reference values (global config wins): concurrency ${tier.guidance.concurrency}, timeout ${tier.guidance.timeoutMs}ms, retries ${tier.guidance.retries}.`,
		tier.topology.note ? `Topology note: ${tier.topology.note}.` : "",
		"Read-only roles (scout/planner/reviewer) have no bash tool, so topology edges touching them degrade to leader relay; express task dependencies with the task board's blockedBy as well.",
	]
		.filter(Boolean)
		.join("\n");
}
