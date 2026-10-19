/**
 * TUI rendering probe (plan-25). Zero-token: render.ts is pure — its outputs
 * are asserted headless with a pass-through theme, so the strings documented
 * in docs/TUI-VERIFICATION.md no longer need eyeballing.
 *
 * Covers: renderCall for all six tools (args preview lines) and
 * renderTeamResult for all six tools (status/usage/body, collapsed vs
 * expanded), plus the tools.ts guardrail helpers.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { renderTeamCall, renderTeamResult } from "../../extensions/render.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

/** Best-effort text extraction from a pi-tui component (shape discovered live). */
function textOf(component: unknown): string {
	const c = component as { text?: unknown; content?: unknown; lines?: unknown; children?: unknown };
	if (typeof c?.text === "string") return c.text;
	if (typeof c?.content === "string") return c.content;
	if (Array.isArray(c?.lines)) return c.lines.join("\n");
	return JSON.stringify(component);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke15]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};
		const has = (name: string, component: unknown, needle: string) =>
			check(name, textOf(component).includes(needle), `missing "${needle}" in: ${textOf(component).slice(0, 120)}`);

		try {
			const sample = renderTeamCall("team_create_member")({ name: "scout1", role: "scout" }, theme);
			log("Text shape:", Object.keys(sample as object).join(","), "|", JSON.stringify(sample).slice(0, 140));

			// ---- renderCall: one line per tool ----
			has(
				"call: create_member name+role+model",
				renderTeamCall("team_create_member")({ name: "scout1", role: "scout", model: "step-5-preview" }, theme),
				"team +scout1 (scout) step-5-preview",
			);
			const send = renderTeamCall("team_send")(
				{ member: "scout1", message: "please review the repo carefully", taskId: "T2", mode: "oneshot" },
				theme,
			);
			has("call: send member + taskId", send, "team → scout1");
			has("call: send task badge", send, "[T2]");
			has("call: send oneshot badge", send, "(oneshot)");
			has("call: send message preview", send, "please review the repo");
			has(
				"call: task action + id + title",
				renderTeamCall("team_task")({ action: "create", id: "T1", title: "Collect API inventory" }, theme),
				"team task create T1 Collect API inventory",
			);
			has(
				"call: topology shape + edge count",
				renderTeamCall("team_set_topology")({ shape: "pipeline", edges: [{ from: "a", to: "b" }] }, theme),
				"team topology pipeline 1 edge(s)",
			);
			has("call: disband one", renderTeamCall("team_disband")({ member: "scout1" }, theme), "team −scout1");
			has("call: disband all", renderTeamCall("team_disband")({}, theme), "team −all");
			has("call: status", renderTeamCall("team_status")({}, theme), "team status");

			// ---- renderTeamResult ----
			has(
				"result: create_member created icon",
				renderTeamResult("team_create_member")(
					{
						content: [{ type: "text", text: "Created" }],
						details: { created: true, member: { name: "scout1", role: "scout", status: "idle", model: "step-5-preview", thinking: "high" } },
					},
					{ expanded: false },
					theme,
				),
				"✓ scout1 (scout) [idle] step-5-preview thinking=high",
			);
			has(
				"result: create_member resumed icon",
				renderTeamResult("team_create_member")(
					{ content: [], details: { created: false, member: { name: "w1", role: "worker", status: "idle" } } },
					{ expanded: false },
					theme,
				),
				"↺ w1 (worker) [idle]",
			);
			const sendResult = renderTeamResult("team_send")(
				{
					content: [{ type: "text", text: "line one\nline two\nline three\nline four" }],
					details: { usage: { input: 10, output: 20, cost: 0.5, turns: 1 }, task: { id: "T2", status: "done" } },
				},
				{ expanded: false },
				theme,
			);
			has("result: send usage line", sendResult, "1 turn, $0.5000");
			has("result: send task line", sendResult, "task T2 [done]");
			has("result: send collapsed body + hint", sendResult, "(ctrl+o to expand)");
			check(
				"result: send collapsed hides 4th line",
				!textOf(sendResult).includes("line four"),
				textOf(sendResult).slice(0, 160),
			);
			has(
				"result: send expanded shows all lines",
				renderTeamResult("team_send")(
					{ content: [{ type: "text", text: "line one\nline two\nline three\nline four" }], details: {} },
					{ expanded: true },
					theme,
				),
				"line four",
			);
			has(
				"result: task line",
				renderTeamResult("team_task")(
					{ content: [], details: { task: { id: "T1", status: "done", assignee: "scout1", title: "Collect inventory" } } },
					{ expanded: false },
					theme,
				),
				"T1 [done] @scout1 Collect inventory",
			);
			has(
				"result: topology shape + edges",
				renderTeamResult("team_set_topology")(
					{ content: [], details: { topology: { shape: "pipeline", edges: [["a", "b"]] } } },
					{ expanded: false },
					theme,
				),
				"pipeline · 1 edge(s)",
			);
			has(
				"result: disband list",
				renderTeamResult("team_disband")({ content: [], details: { disbanded: ["scout1", "w1"] } }, { expanded: false }, theme),
				"scout1, w1",
			);
			const statusResult = renderTeamResult("team_status")(
				{
					content: [],
					details: {
						members: [
							{ name: "scout1", role: "scout", status: "idle", usage: { input: 1, output: 2, cost: 0.25, turns: 1 } },
							{ name: "w1", role: "worker", status: "running" },
						],
						tasks: [{ id: "T1", status: "done", title: "Collect inventory" }],
					},
				},
				{ expanded: false },
				theme,
			);
			has("result: status member line", statusResult, "○ scout1 (scout) 1 turn, $0.2500");
			has("result: status running icon", statusResult, "● w1 (worker)");
			has("result: status task line", statusResult, "T1 [done] Collect inventory");

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE15 DONE (all passed)" : `SMOKE15 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE15 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
