/**
 * Phase 44 smoke probe (zero token cost): the /topo command forwards its
 * argument verbatim.
 *
 * Why this exists. The runner's live-args-forward check used to prove "the
 * request went out verbatim" by grepping the RPC stream for the request text —
 * the host echoed user messages there. Upstream #318 ("write a session record
 * of facts, not replayed progress") removed that echo: a plain prompt with a
 * distinctive string now produces no trace of it in RPC output at all, with no
 * plugin involved. So the check was asserting an upstream emission detail, and
 * it failed for a reason that had nothing to do with this plugin.
 *
 * The guarantee is the plugin's own, so it is asserted against the plugin's own
 * call instead: drive the real command handler through a fake ExtensionAPI and
 * read what it hands to sendUserMessage. That is stronger than the grep ever
 * was — it observes the exact string, not a substring that might have come from
 * somewhere else — and it is deterministic.
 *
 * Covered:
 *   1. a bare argument is forwarded unchanged;
 *   2. an argument with spaces keeps them (the old grep could not tell
 *      "spaces preserved" from "spaces collapsed");
 *   3. a tier token consumes the rest as the request, so `balanced fix it` sends
 *      "fix it", not "balanced fix it";
 *   4. no argument means no sendUserMessage at all (activating alone must not
 *      invent a request);
 *   5. `off` deactivates without forwarding.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import extension from "../../extensions/index.ts";
import { agentDir, resetConfigCache } from "../../extensions/config.ts";

type SelectScript = (options: string[]) => string | undefined;
type Ctx = Parameters<ExtensionAPI["registerCommand"]> extends never ? never : Record<string, unknown>;

const REQUEST = "ping-forward-check";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke44]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		// The global config.toml lives BESIDE the agent dir (dirname), not inside it.
		const dir = path.dirname(agentDir());
		const cfgFile = path.join(dir, "config.toml");
		const hadCfg = fs.existsSync(cfgFile);
		const prev = hadCfg ? fs.readFileSync(cfgFile, "utf8") : "";

		try {
			const sent: Array<{ text: string; deliverAs?: string }> = [];
			const notified: string[] = [];
			let command: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
			const selectScript: SelectScript[] = [];
			const inputScript: Array<() => string | undefined> = [];

			const fakePi = {
				registerTool: () => {},
				getActiveTools: () => [],
				setActiveTools: () => {},
				setUnavailableTools: () => {},
				on: () => {},
				registerCommand: (_name: string, cmd: { handler: (args: string, ctx: unknown) => Promise<void> }) => {
					command = cmd;
				},
				sendUserMessage: (text: string, options?: { deliverAs?: string }) => {
					sent.push({ text, deliverAs: options?.deliverAs });
				},
			};
			extension(fakePi as unknown as ExtensionAPI);
			check("harness: /topo command registered", Boolean(command));

			fs.writeFileSync(cfgFile, "[stepcodeAgentTeam.plan]\nenabled = false\n");
			resetConfigCache();

			const makeCtx = () => ({
				mode: "tui",
				hasUI: true,
				isIdle: () => true,
				model: undefined,
				sessionManager: { getSessionFile: () => null },
				ui: {
					notify: (_m: string) => {
						notified.push(_m);
					},
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

			// 1. a bare argument goes out verbatim.
			await command!.handler(REQUEST, ctx);
			check("forward: a bare argument is sent verbatim", sent.length === 1 && sent[0].text === REQUEST, JSON.stringify(sent));
			check("forward: an idle session sends it as a normal message", sent[0]?.deliverAs === undefined, String(sent[0]?.deliverAs));

			// 2. spaces survive.
			sent.length = 0;
			await command!.handler("fix the flaky smoke tests", ctx);
			check("forward: spaces are preserved, not collapsed", sent.length === 1 && sent[0].text === "fix the flaky smoke tests", JSON.stringify(sent));

			// 3. a tier token consumes the rest as the request.
			sent.length = 0;
			await command!.handler("balanced fix it", ctx);
			check("forward: a tier token is consumed, the rest is the request",
				sent.length === 1 && sent[0].text === "fix it", JSON.stringify(sent));

			// 4. no argument invents nothing.
			sent.length = 0;
			await command!.handler("", ctx);
			check("forward: no argument sends nothing", sent.length === 0, JSON.stringify(sent));

			// 5. off deactivates without forwarding.
			sent.length = 0;
			await command!.handler("off", ctx);
			check("forward: off deactivates without forwarding", sent.length === 0, JSON.stringify(sent));

			// The activation announcement is still part of the contract the live
			// check relies on; assert it here too so the two cannot drift apart.
			check("forward: the board announcement still fires", notified.some((m) => m.includes("Topology Agent Team")), notified.slice(0, 2).join(" | "));
		} catch (err) {
			check("setup: the probe reached its forward stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			if (hadCfg) fs.writeFileSync(cfgFile, prev);
			else fs.rmSync(cfgFile, { force: true });
			resetConfigCache();
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE44 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
