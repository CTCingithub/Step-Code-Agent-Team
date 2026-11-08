/**
 * Phase 42 smoke probe (zero token cost): the plan tier's happy path.
 *
 * P2-8e asked for a live check of the plan tiers. The mechanical half of it had
 * a hole: phase24 drives the whole confirmation chain with a scripted
 * ExtensionContext, but its scripted context has NO `modelRegistry`, so
 * `generateTeamPlan` bails at `if (!model) return null` / the offline race and
 * the extension falls back to the tier's standard shape. The consequence is that
 * "the model returns a plan → the plan is shown → Accept injects it" had **no
 * coverage at any cost**.
 *
 * This probe fills exactly that hole. It gives the scripted context a
 * `modelRegistry.complete` that answers with a fixed plan, and asserts the plan
 * travels: generateTeamPlan → the confirmation shows it → Accept injects
 * `approvedPlanInstruction` into the forwarded turn.
 *
 * What it deliberately does NOT claim: that a real model produces a plan
 * appropriate to the tier. That is the "live" half of P2-8e, it needs a key
 * (~1-2k tokens per tier), and a green check here must not be read as covering
 * it — the assertion names say "plumbing" for that reason.
 *
 * Standalone (see STANDALONE_PHASES): importing extensions/index.ts transitively
 * pulls @step-harness/pi-tui, which would stage a second copy of the extension
 * and collide on tool names — the same reason phase24 runs standalone.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import extension from "../../extensions/index.ts";
import { agentDir, resetConfigCache } from "../../extensions/config.ts";

type SelectScript = (options: string[]) => string | undefined;
type Ctx = Parameters<ExtensionAPI["registerCommand"]> extends never ? never : Record<string, unknown>;

/** The plan the fake model returns; distinctive enough to trace through the chain. */
const FAKE_PLAN = "FAKE-PLAN-MARKER: survey first, then patch, then verify.";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke42]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const REQUEST = "修复这个项目里失败的测试";
		// The global config.toml lives BESIDE the agent dir (dirname), not inside it.
		const dir = path.dirname(agentDir());
		const cfgFile = path.join(dir, "config.toml");
		const hadCfg = fs.existsSync(cfgFile);
		const prev = hadCfg ? fs.readFileSync(cfgFile, "utf8") : "";

		try {
			// ---- fake pi: capture the command, the forwarded text, the context hook ----
			const sent: string[] = [];
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			type ContextHook = (event: unknown) => { messages?: unknown[] } | undefined;
			let contextHandler: ContextHook | null = null;
			// Read through a function: TypeScript narrows the outer `let` to `never`
			// at a second call site in the same body (a false TS2349); a getter defeats it.
			const readContext = (): ContextHook | null => contextHandler;
			let completeCalls = 0;
			const fakePi = {
				registerTool: () => {},
				getActiveTools: () => [],
				setActiveTools: () => {},
				on: (event: string, fn: unknown) => {
					if (event === "context") contextHandler = fn as typeof contextHandler;
				},
				registerCommand: (_name: string, cmd: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
					command = cmd;
				},
				sendUserMessage: (text: string) => {
					sent.push(text);
				},
				setUnavailableTools: () => {},
			};
			extension(fakePi as unknown as ExtensionAPI);
			check("harness: /topo command registered", Boolean(command));

			// ---- config: plan.enabled = true (the confirm path is otherwise unreachable) ----
			fs.writeFileSync(cfgFile, "[stepcodeAgentTeam.plan]\nenabled = true\n");
			resetConfigCache();

			// ---- scripted context WITH a working modelRegistry ----
			// This is the whole difference from phase24: the planning call answers,
			// so the extension shows the model's plan instead of the tier fallback.
			const selectScript: SelectScript[] = [];
			const makeCtx = () => ({
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				model: { provider: "step", id: "step-5-preview" },
				modelRegistry: {
					complete: async () => {
						completeCalls += 1;
						return {
							role: "assistant",
							content: [{ type: "text", text: FAKE_PLAN }],
							usage: { input: 1, output: 1, cost: { total: 0 } },
						};
					},
				},
				sessionManager: { getSessionFile: () => null },
				ui: {
					notify: () => {},
					select: async (_title: string, options: string[]) => {
						const step = selectScript.shift();
						if (!step) throw new Error(`unexpected select: ${options.join(" | ")}`);
						return step(options);
					},
					input: async () => "",
					setWidget: () => {},
					confirm: async () => true,
				},
			});
			const ctx = makeCtx();

			const runFlow = async (confirmPick: SelectScript): Promise<string> => {
				sent.length = 0;
				selectScript.length = 0;
				selectScript.push((options) => options[0]); // tier picker: the first tier
				selectScript.push(confirmPick);
				await command!.handler(REQUEST, ctx);
				// The context hook runs on the next turn; invoke it to read the injection.
				const event = { messages: [{ role: "user", content: [{ type: "text", text: sent[0] ?? "" }] }] };
				const hook = readContext();
				const out = hook ? hook(event) : undefined;
				const texts = ((out as { messages?: Array<{ content?: Array<{ text?: string }> }> } | undefined)?.messages ?? [])
					.flatMap((m) => (m.content ?? []).map((c) => c.text ?? ""));
				return texts.join("\n");
			};

			// 1. Accept: the plan the model produced must be injected.
			const accepted = await runFlow(() => "Accept");
			check("plan plumbing: the planning call was actually made", completeCalls >= 1, `calls=${completeCalls}`);
			check("plan plumbing: the model's plan is injected on Accept", accepted.includes(FAKE_PLAN), accepted.slice(0, 200));
			check("plan plumbing: the request still goes out verbatim", sent[0]?.includes(REQUEST) === true, sent[0]?.slice(0, 120));

			// 2. Cancel: nothing is injected — the plan must not leak into the turn.
			const cancelled = await runFlow(() => "Cancel");
			check("plan plumbing: Cancel injects no plan", !cancelled.includes(FAKE_PLAN), cancelled.slice(0, 160));

			// 3. The plan text must reach the confirmation, which is what makes the
			//    Accept path meaningful — observed through the injected payload, since
			//    the dialog is a scripted select and its body is not otherwise visible.
			check("plan plumbing: the plan survives the dialog round trip", accepted.includes("survey first"), accepted.slice(0, 200));
		} catch (err) {
			check("setup: the probe reached its plan stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			if (hadCfg) fs.writeFileSync(cfgFile, prev);
			else fs.rmSync(cfgFile, { force: true });
			resetConfigCache();
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE42 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
