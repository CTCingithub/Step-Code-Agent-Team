/**
 * Plan-confirmation path end-to-end probe (plan-100). Zero-token, standalone
 * (see STANDALONE_PHASES in run-smoke.sh): drives the real extension factory
 * with a fake ExtensionAPI and a scripted ExtensionContext, so the whole
 * confirmation chain — tier picker → (planning call fails offline → fallback)
 * → Accept / custom-input / cancel → request forwarding with the note merged
 * verbatim — runs without a model call.
 *
 * Why this exists: confirmChoice is a closure inside the extension factory, so
 * no phase could import it directly, and the live checks never reach it
 * (plan.enabled defaults to false). The free-text input contract (the user's
 * words ride along with the request verbatim) had zero automated coverage.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import extension from "../../extensions/index.ts";
import { agentDir, resetConfigCache } from "../../extensions/config.ts";

type SelectScript = (options: string[]) => string | undefined;
type Ctx = Parameters<ExtensionAPI["registerCommand"]> extends never ? never : Record<string, unknown>;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke24]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const REQUEST = "修复这个项目里失败的测试";
		const NOTE = "另外请并行派三名 reviewer 从不同角度审查";

		try {
			// ---- fake pi: capture the command, the forwarded text, the context hook ----
			const sent: string[] = [];
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			let contextHandler: ((event: unknown) => { messages?: unknown[] } | void) | null = null;
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
			// The global config.toml lives BESIDE the agent dir (dirname), not inside it.
			const dir = path.dirname(agentDir());
			const cfgFile = path.join(dir, "config.toml");
			const hadCfg = fs.existsSync(cfgFile);
			const prev = hadCfg ? fs.readFileSync(cfgFile, "utf8") : "";
			fs.writeFileSync(cfgFile, "[stepcodeAgentTeam.plan]\nenabled = true\n");
			resetConfigCache();

			// ---- scripted context: the picker takes the first tier, then the confirmation ----
			const selectScript: SelectScript[] = [];
			const inputScript: Array<() => string | undefined> = [];
			const injectionTexts: string[] = [];
			const makeCtx = () => ({
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				model: undefined,
				sessionManager: { getSessionFile: () => null },
				ui: {
					notify: () => {},
					select: async (_title: string, options: string[]) => {
						const step = selectScript.shift();
						if (!step) throw new Error(`unexpected select: ${options.join(" | ")}`);
						return step(options);
					},
					input: async () => {
						const step = inputScript.shift();
						if (!step) throw new Error("unexpected input call");
						return step();
					},
					setWidget: () => {},
					confirm: async () => true,
				},
			});
			const ctx = makeCtx();
			const runFlow = async (confirmPick: SelectScript, input?: () => string | undefined): Promise<void> => {
				sent.length = 0;
				selectScript.length = 0;
				inputScript.length = 0;
				selectScript.push((options) => options[0]); // tier picker: the first tier
				selectScript.push(confirmPick);
				if (input) inputScript.push(input);
				await command!.handler(REQUEST, ctx);
				// The context hook runs on the next turn; invoke it to read the injection.
				const event = { messages: [{ role: "user", content: [{ type: "text", text: sent[0] ?? "" }] }] };
				const out = contextHandler ? contextHandler(event) : undefined;
				const texts = ((out as { messages?: Array<{ content?: Array<{ text?: string }> }> } | undefined)?.messages ?? [])
					.flatMap((m) => (m.content ?? []).map((c) => c.text ?? ""));
				injectionTexts.push(texts.join("\n"));
			};
			const customOption = (options: string[]): string =>
				options.find((o) => o.includes("自定义") || o.includes("Custom")) ?? "";

			try {
				// 1. Accept: the request goes out verbatim and the plan instruction is injected.
				await runFlow(() => "Accept");
				check(
					"confirm: Accept forwards the request verbatim",
					sent.length === 1 && sent[0] === REQUEST,
					`sent=${JSON.stringify(sent)}`,
				);
				check(
					"confirm: Accept injects the plan instruction",
					injectionTexts[0].length > 0 && injectionTexts[0] !== REQUEST,
					injectionTexts[0].slice(0, 80),
				);

				// 2. Custom input: the note rides along verbatim, blank-line separated.
				await runFlow((options) => customOption(options), () => NOTE);
				check(
					"confirm: custom input merges the note verbatim",
					sent.length === 1 && sent[0] === `${REQUEST}\n\n${NOTE}`,
					`sent=${JSON.stringify(sent)}`,
				);

				// 3. Empty input: accepts the plan as shown, nothing appended.
				await runFlow((options) => customOption(options), () => "   ");
				check(
					"confirm: empty input accepts as-is",
					sent.length === 1 && sent[0] === REQUEST,
					`sent=${JSON.stringify(sent)}`,
				);

				// 4. Cancel: the request still forwards (activation only) with a different injection.
				await runFlow(() => "Cancel");
				check(
					"confirm: Cancel still forwards the request",
					sent.length === 1 && sent[0] === REQUEST,
					`sent=${JSON.stringify(sent)}`,
				);
				check(
					"confirm: Cancel injects activation only (no plan instruction)",
					injectionTexts[3] !== injectionTexts[0] && injectionTexts[3].length > 0,
					injectionTexts[3].slice(0, 80),
				);
			} finally {
				if (hadCfg) fs.writeFileSync(cfgFile, prev);
				else fs.rmSync(cfgFile, { force: true });
				resetConfigCache();
			}

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE24 DONE (all passed)" : `SMOKE24 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE24 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
