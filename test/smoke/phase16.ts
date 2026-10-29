/**
 * Guardrail helpers probe (plan-25). Zero-token, standalone (see
 * STANDALONE_PHASES in run-smoke.sh): asserts the cost-warning text, the
 * output truncation contract, and the topo_team_msg reply formatting that
 * used to need eyeballing in a live session.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { costWarning, truncateOutput } from "../../extensions/tools.ts";
import { formatTeammateReply } from "../../extensions/member-messaging.ts";
import { assertDispatchable, dispatchPrompt, nextTaskId, taskPrompt } from "../../extensions/tasks.ts";
import { truncateOutput as truncate } from "../../extensions/tools.ts";
import { defaultConfig, getConfig } from "../../extensions/config.ts";
import type { TaskRecord } from "../../extensions/registry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke16]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// ---- costWarning ----
			const cfg = defaultConfig();
			cfg.cost.warnThreshold = 1;
			check("cost: below threshold → silent", costWarning(cfg, 0.5) === "");
			const at = costWarning(cfg, 1);
			check("cost: at threshold → warns", at.includes("[cost guardrail]"), at.slice(0, 80));
			check("cost: warning formats amounts", at.includes("$1.0000") && at.includes("$1.00"), at.slice(0, 120));
			cfg.cost.warnThreshold = 0;
			check("cost: threshold 0 disables", costWarning(cfg, 100) === "");
			cfg.cost.warnThreshold = 0.25;
			check("cost: fractional threshold fires", costWarning(cfg, 0.3).includes("$0.30"), "");

			// ---- truncateOutput ----
			check("truncate: short text unchanged", truncateOutput("hello") === "hello");
			const exact = "x".repeat(50 * 1024);
			check("truncate: exactly at cap unchanged", truncateOutput(exact) === exact);
			const over = "y".repeat(50 * 1024 + 100);
			const cut = truncateOutput(over);
			check("truncate: over cap gets notice", cut.includes("[Output truncated: 100 bytes omitted."), cut.slice(-80));
			check("truncate: over cap keeps the prefix", cut.startsWith("y".repeat(1024)), "");

			// A cut must not split a surrogate pair (emoji at the boundary).
			const withEmoji = "a".repeat(50 * 1024 - 1) + "😀";
			const cutEmoji = truncateOutput(withEmoji);
			check(
				"truncate: no lone trailing surrogate",
				!/[\uD800-\uDBFF]$/.test(cutEmoji.replace(/\n\n\[Output truncated[\s\S]*$/, "")),
				`tail=${JSON.stringify(cutEmoji.slice(-12))}`,
			);
			check("truncate: emoji case reports 4 bytes omitted", cutEmoji.includes("4 bytes omitted"), cutEmoji.slice(-80));

			// ---- formatTeammateReply (topo_team_msg reply contract) ----
			// Delivery is guaranteed; the reply is best-effort. A teammate whose
			// turn ends without text (empty, or the host's "No result provided"
			// placeholder) must yield an explicit delivery acknowledgment, never a
			// silent empty result — otherwise ring pass-along flows break quietly.
			// A non-empty reply keeps the teammate's text AND carries provenance
			// framing: the server asserts delivery, but the text is the teammate's
			// own statement and its factual claims are unverified. Unframed, a
			// relayed reply reads as tool-verified fact (2026-10-30 round: a reply
			// carried a fabricated "the ring already hit maxLoopCount" claim).
			const framed = formatTeammateReply("r2", "here are my findings");
			check("msg: real reply keeps the teammate text", framed.includes("here are my findings"), framed.slice(0, 160));
			check(
				"msg: real reply carries provenance framing",
				/Reply from r2/.test(framed) && /delivered/i.test(framed) && /NOT verified/i.test(framed),
				framed.slice(0, 240),
			);
			check("msg: framing points at verify-before-relay", /verify before relaying/i.test(framed), framed.slice(0, 240));
			const ack = formatTeammateReply("r2", "");
			check("msg: empty reply → delivery ack", /^Delivered to r2\./.test(ack), ack.slice(0, 60));
			check("msg: host placeholder → delivery ack", /^Delivered to r2\./.test(formatTeammateReply("r2", "No result provided")), "");
			check("msg: undefined reply → delivery ack", /^Delivered to r3\./.test(formatTeammateReply("r3", undefined)), "");
			check("msg: whitespace-only reply → delivery ack", /^Delivered to r2\./.test(formatTeammateReply("r2", "   \n  ")), "");
			check("msg: ack forbids a resend", ack.includes("do not resend"), ack.slice(0, 120));
			check(
				"msg: ack points at the final report + leader collection",
				ack.includes("final report") && ack.includes("team_send") && ack.includes("team_task"),
				ack.slice(0, 120),
			);

			// ---- nextTaskId (task-board capacity; the cap comes from config) ----
			check("tasks: first free id is T1", nextTaskId([]) === "T1");
			check("tasks: skips used ids", nextTaskId([{ id: "T1" }, { id: "T3" }] as unknown as TaskRecord[]) === "T2");
			const fullBoard = Array.from({ length: 999 }, (_, i) => ({ id: `T${i + 1}` }) as unknown as TaskRecord);
			let fullMsg = "";
			try {
				nextTaskId(fullBoard);
			} catch (err) {
				fullMsg = err instanceof Error ? err.message : String(err);
			}
			check("tasks: full board throws with the configured cap", /Task board is full \(999 tasks\)/.test(fullMsg), fullMsg);

			// ---- truncateOutput with an explicit (config-supplied) cap ----
			check("truncate: explicit cap below length truncates", truncateOutput("x".repeat(100), 10).includes("[Output truncated: 90 bytes omitted."), "");
			check("truncate: explicit cap at length keeps text", truncateOutput("x".repeat(10), 10) === "x".repeat(10));
			check("truncate: explicit cap above length keeps text", truncateOutput("hello", 10) === "hello");

			// ---- tasks config → consumer linkage (P2-8c) ----
			// config.ts validates [tasks] max/outputCapBytes; these are the
			// consumers. A config change must move both behaviours.
			const tasksCfg = getConfig();
			const capBoard = Array.from({ length: tasksCfg.tasks.max }, (_, i) => ({ id: `T${i + 1}` }) as unknown as TaskRecord);
			let capMsg = "";
			try {
				nextTaskId(capBoard);
			} catch (err) {
				capMsg = err instanceof Error ? err.message : String(err);
			}
			check(
				"tasks: board cap comes from the config value",
				new RegExp(`Task board is full \\(${tasksCfg.tasks.max} tasks\\)`).test(capMsg),
				capMsg,
			);
			const overCap = "x".repeat(tasksCfg.tasks.outputCapBytes + 100);
			check(
				"tasks: default truncation cap comes from the config",
				truncate(overCap).includes("[Output truncated: 100 bytes omitted."),
				"",
			);

			// ---- dispatchPrompt (team_task start detail passthrough) ----
			// The dispatch prompt must carry both the frozen acceptance criteria
			// and a start-time detail — a start-time detail used to be dropped.
			const boardTask = {
				id: "T1",
				title: "Ship the fix",
				detail: "acceptance criteria",
				status: "ready",
				blockedBy: [],
				assignee: null,
			} as unknown as TaskRecord;
			check("dispatch: merges criteria + start detail", /acceptance criteria/.test(dispatchPrompt(boardTask, "extra context")) && dispatchPrompt(boardTask, "extra context").includes("extra context"), "");
			check("dispatch: no detail → criteria only", dispatchPrompt(boardTask) === taskPrompt(boardTask), "");
			check("dispatch: whitespace detail ignored", dispatchPrompt(boardTask, "   ") === taskPrompt(boardTask), "");
			check("dispatch: halves joined by a blank line", dispatchPrompt(boardTask, "extra").includes("\n\n"), "");

			// ---- assertDispatchable (a failed task stays re-dispatchable) ----
			// A member killed mid-run used to leave its task failed forever,
			// deading every task blocked on it (the 2026-10-24 sandbox round hit
			// exactly this and had to rebuild the chain). Re-dispatching resumes
			// the member with its context, so "failed" is dispatchable.
			const gateTask = (status: string, blockedBy: string[] = []) =>
				({ id: "T1", title: "t", status, blockedBy, assignee: null }) as unknown as TaskRecord;
			const gateError = (status: string): string => {
				try {
					assertDispatchable(gateTask(status, ["T0"]));
					return "";
				} catch (err) {
					return err instanceof Error ? err.message : String(err);
				}
			};
			check("dispatch gate: ready passes", gateError("ready") === "", gateError("ready"));
			check("dispatch gate: failed is re-dispatchable", gateError("failed") === "", gateError("failed"));
			for (const s of ["pending", "running", "done"]) {
				const msg = gateError(s);
				check(`dispatch gate: ${s} rejected with its blockers`, msg.includes(`"${s}"`) && msg.includes("T0"), msg.slice(0, 120));
			}

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE16 DONE (all passed)" : `SMOKE16 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE16 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
