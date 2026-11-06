/**
 * Phase 36 smoke probe (REAL model calls — key-gated, see run-smoke.sh):
 * a member settles against the real provider, for BOTH a short prompt and a
 * long one that has to use tools.
 *
 * This is the only probe in the suite that drives member dispatch against a real
 * provider, and it exists because of a specific wrong turn. The session's 38
 * settle timeouts all came from substantive dispatches, so the suspicion was
 * that long turns — the ones that call tools — were what failed. phase34/35/37
 * then showed the plugin's path is sound against a fake model, including
 * multi-round tool-calling turns, and this probe closes the loop against the
 * real thing: the long case runs, uses its tools, and settles.
 *
 * Costs two short prompts. Declared here rather than discovered later.
 */

import * as fs from "node:fs";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { configFilePath, resetConfigCache } from "../../extensions/config.ts";

/** A genuinely multi-step task: read, list, then summarise. */
const LONG = [
	"Survey this repository and report back. Read package.json, list the",
	"directories under extensions/, then summarise what the plugin does in",
	"three sentences. Use your file tools.",
].join(" ");

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke36]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		const agentDir = process.env.STEP_CODING_AGENT_DIR;
		const cfgFile = agentDir ? configFilePath(agentDir) : null;
		const savedCfg = cfgFile && fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : null;

		let manager: TeamManager | undefined;
		try {
			manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			// dispatch.timeoutMs has no env override and the config is cached at
			// load time. 150s is generous for a real multi-tool turn and still
			// well inside the runner's 240s, so a genuine hang is reported as a
			// settle failure with diagnostics instead of a bare timeout.
			if (cfgFile) {
				fs.writeFileSync(cfgFile, JSON.stringify({ dispatch: { timeoutMs: 150_000 } }));
				resetConfigCache();
			}

			const attempt = async (name: string, prompt: string, minTurns: number) => {
				const { member } = await manager!.createMember({ name });
				const t0 = Date.now();
				try {
					const res = await manager!.sendMessage(name, prompt);
					check(`real: a member settles for ${name}`, true, `${Date.now() - t0}ms`);
					check(`real: ${name} produced a reply`, res.text.trim().length > 0, JSON.stringify(res.text.slice(0, 80)));
					check(`real: ${name} ran at least ${minTurns} model round(s)`, res.usage.turns >= minTurns, `turns=${res.usage.turns}`);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					check(`real: a member settles for ${name}`, false, msg);
				} finally {
					await manager!.disband(name);
				}
			};

			await attempt("shorty", "Reply with the single word: pong", 1);
			await attempt("longrun", LONG, 1);
		} catch (err) {
			check("setup: the probe reached its dispatch stage", false, err instanceof Error ? err.message : String(err));
			try {
				await manager?.disband();
			} catch {
				/* best effort */
			}
		} finally {
			if (cfgFile) {
				if (savedCfg === null) fs.rmSync(cfgFile, { force: true });
				else fs.writeFileSync(cfgFile, savedCfg);
				resetConfigCache();
			}
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE36 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
