/**
 * Team-tool JSON-schema contract guard. Zero-token, standalone (see
 * STANDALONE_PHASES in run-smoke.sh): registers the six team tools against a
 * fake pi and asserts the shape the leader's LLM actually receives.
 *
 * Why this exists: `reason` used to be declared as
 * `Type.Optional(Type.String(), { description: ... })`. The pinned typebox
 * (1.3.7) declares Optional(schema) with a single parameter — a second options
 * argument is both a TS error and silently dropped at runtime, so the
 * description never reached the tool schema and the model saw a bare,
 * undocumented parameter. One schema assertion catches that whole class of
 * regression, so every top-level parameter of every team tool must carry a
 * non-empty description here.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { registerTeamTools } from "../../extensions/tools.ts";
import { defaultConfig } from "../../extensions/config.ts";

type RegisteredTool = { name: string; description?: string; parameters?: unknown };
type Schema = { type?: string; properties?: Record<string, { description?: string } | undefined> };

const EXPECTED_TOOLS = ["team_create_member", "team_send", "team_task", "team_set_topology", "team_disband", "team_status"];

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke23]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// ---- registration against a fake pi (registerTool only) ----
			const registered: RegisteredTool[] = [];
			const fakePi = { registerTool: (t: RegisteredTool) => { registered.push(t); } };
			registerTeamTools(fakePi as unknown as ExtensionAPI, (() => ({})) as never, defaultConfig());
			log("registered:", registered.map((t) => t.name).join(","));

			// a. exactly the six team tools, no duplicates, none missing.
			const names = registered.map((t) => t.name);
			check(
				"tools: exactly six, no duplicates",
				names.length === EXPECTED_TOOLS.length && new Set(names).size === names.length,
				names.join(","),
			);
			const missing = EXPECTED_TOOLS.filter((n) => !names.includes(n));
			const extra = names.filter((n) => !EXPECTED_TOOLS.includes(n));
			check("tools: no missing, no extra", missing.length === 0 && extra.length === 0, `missing=${missing.join(",")} extra=${extra.join(",")}`);

			// b. every tool description is non-empty (the model picks tools by it).
			const noDesc = registered.filter((t) => !(t.description ?? "").trim()).map((t) => t.name);
			check("tools: every description is non-empty", noDesc.length === 0, noDesc.join(","));

			// c. every top-level parameter carries a non-empty description —
			// the typebox Optional two-argument regression guard.
			const paramDescMissing: string[] = [];
			for (const t of registered) {
				const props = (t.parameters as Schema | undefined)?.properties ?? {};
				for (const [pname, pdef] of Object.entries(props)) {
					if (!(pdef?.description ?? "").trim()) paramDescMissing.push(`${t.name}.${pname}`);
				}
			}
			check("schema: every top-level parameter has a description", paramDescMissing.length === 0, paramDescMissing.join(","));

			const tool = (name: string): RegisteredTool | undefined => registered.find((t) => t.name === name);
			const propsOf = (name: string): Record<string, { description?: string } | undefined> =>
				(tool(name)?.parameters as Schema | undefined)?.properties ?? {};
			const missingParams = (name: string, expected: string[]): string[] =>
				expected.filter((p) => !Object.prototype.hasOwnProperty.call(propsOf(name), p));
			const undescribedParams = (name: string, expected: string[]): string[] =>
				expected.filter((p) => !(propsOf(name)[p]?.description ?? "").trim());

			// d. team_task: the named regression — reason must survive in the schema.
			const taskParams = ["action", "id", "title", "detail", "blockedBy", "assignee", "result", "reason"];
			check(
				"schema: team_task exposes action/id/title/detail/blockedBy/assignee/result/reason",
				missingParams("team_task", taskParams).length === 0,
				missingParams("team_task", taskParams).join(","),
			);
			check(
				"schema: team_task.reason has a description",
				undescribedParams("team_task", ["reason"]).length === 0,
				JSON.stringify(propsOf("team_task").reason).slice(0, 120),
			);

			// e. per-tool parameter rosters, all described.
			const rosters: Array<[string, string[]]> = [
				["team_send", ["member", "message", "taskId", "mode"]],
				["team_set_topology", ["shape", "edges", "members"]],
				["team_create_member", ["name", "role", "effort"]],
			];
			for (const [toolName, expected] of rosters) {
				const gone = missingParams(toolName, expected);
				check(`schema: ${toolName} exposes ${expected.join("/")}`, gone.length === 0, gone.join(","));
				const blank = undescribedParams(toolName, expected);
				check(`schema: ${toolName} params all described`, blank.length === 0, blank.join(","));
			}

			// f. the parameters root is a JSON object schema.
			check("schema: team_task.parameters.type === \"object\"", (tool("team_task")?.parameters as Schema | undefined)?.type === "object", "");

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE23 DONE (all passed)" : `SMOKE23 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE23 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
