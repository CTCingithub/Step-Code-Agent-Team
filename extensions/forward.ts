/**
 * Forwarding wrapper for the /agent-team command.
 *
 * A slash command consumes the whole input, so text after the command is
 * re-injected as a real user message. Forwarding it verbatim leaves the model
 * with no signal that a team is active and expected: for an ordinary request
 * ("read the project and summarize") it simply answers solo — the team tools
 * are available, but nothing in the message says to use them. The wrapper
 * makes the command's intent explicit so the leader forms a team for the
 * request. (Verified in the 2026-10-19 TUI report: verbatim forwarding
 * produced zero team tool calls.)
 */

/** CJK presence picks the wrapper language, matching the request's own. */
function hasCjk(text: string): boolean {
	return /[\u4e00-\u9fff]/.test(text);
}

/** Wraps a forwarded request with an explicit "use the agent team" instruction. */
export function wrapTeamRequest(request: string): string {
	const instruction = hasCjk(request)
		? "请使用智能体团队工具完成以下请求："
		: "Use the agent team tools to accomplish the following request:";
	return `${instruction}\n${request}`;
}
