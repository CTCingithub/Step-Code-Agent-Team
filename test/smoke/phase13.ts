/**
 * Project-level config probe (plan-51). Zero-token.
 * Covers: project-level config file (<cwd>/.stepcode/stepcode-agent-team.json)
 * merged over the agentDir config when the project is trusted; ignored when
 * untrusted / absent; precedence agentDir < project < env; invalid project
 * values fall back to defaults; STEPCODE_TEAM_MAXDEPTH env override (depth
 * bound propagation to sub-leader members); live wiring through session_start.
 *
 * Regression: run via `bash test/run-smoke.sh` (zero token). The live
 * trusted-project branch SKIPs when the environment has not granted project
 * trust (e.g. headless probes); the untrusted branch is asserted instead.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import { agentDir, defaultConfig, getConfig, loadConfig } from "../../extensions/config.ts";

// Live wiring: stage a project-level config before any event fires (module
// load happens before session_start; index.ts's handler applies it).
const PROJECT_CFG = path.join(process.cwd(), ".stepcode", "stepcode-agent-team.json");
const hadProjectCfg = fs.existsSync(PROJECT_CFG);
const savedProjectCfg = hadProjectCfg ? fs.readFileSync(PROJECT_CFG, "utf8") : null;
fs.mkdirSync(path.dirname(PROJECT_CFG), { recursive: true });
fs.writeFileSync(PROJECT_CFG, JSON.stringify({ members: { max: 42 } }));

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		const log = (...a: unknown[]) => console.error("[smoke13]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		let skipped = 0;
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};
		const skip = (name: string, why: string) => {
			skipped += 1;
			log(`SKIP ${name} — ${why}`);
		};

		try {
			const d = defaultConfig();

			// ---- pure loadConfig tests (synthetic base + project dirs) ----
			const base = fs.mkdtempSync(path.join(os.tmpdir(), "scat-base13-"));
			const proj = fs.mkdtempSync(path.join(os.tmpdir(), "scat-proj13-"));
			fs.writeFileSync(
				path.join(base, "stepcode-agent-team.json"),
				JSON.stringify({ members: { max: 2, defaultRole: "scout" }, cost: { warnThreshold: 1 } }),
			);
			fs.mkdirSync(path.join(proj, ".stepcode"), { recursive: true });
			fs.writeFileSync(
				path.join(proj, ".stepcode", "stepcode-agent-team.json"),
				JSON.stringify({ members: { max: 5 }, cost: { warnThreshold: 0.25 } }),
			);

			const c1 = loadConfig({ agentDir: base, projectDir: proj, trusted: true });
			check("project config: merged when trusted", c1.members.max === 5, `got ${c1.members.max}`);
			check("project config: section-deep merge keeps base keys", c1.members.defaultRole === "scout", `got ${c1.members.defaultRole}`);
			check("project config: overrides base section key", c1.cost.warnThreshold === 0.25, `got ${c1.cost.warnThreshold}`);

			const c2 = loadConfig({ agentDir: base, projectDir: proj, trusted: false });
			check("project config: ignored when untrusted", c2.members.max === 2, `got ${c2.members.max}`);
			check("project config: untrusted keeps base cost", c2.cost.warnThreshold === 1, `got ${c2.cost.warnThreshold}`);

			const c3 = loadConfig({ agentDir: base });
			check("project config: ignored when projectDir absent", c3.members.max === 2, `got ${c3.members.max}`);

			const c3b = loadConfig({ agentDir: base, projectDir: null, trusted: true });
			check("project config: ignored when projectDir null", c3b.members.max === 2, `got ${c3b.members.max}`);

			// env overrides still win over the project file
			const savedCost = process.env.STEPCODE_TEAM_COST_WARN;
			process.env.STEPCODE_TEAM_COST_WARN = "9";
			const c4 = loadConfig({ agentDir: base, projectDir: proj, trusted: true });
			check("precedence: env overrides project file", c4.cost.warnThreshold === 9, `got ${c4.cost.warnThreshold}`);
			if (savedCost === undefined) delete process.env.STEPCODE_TEAM_COST_WARN;
			else process.env.STEPCODE_TEAM_COST_WARN = savedCost;

			// invalid project values fall back to defaults (consistent with single-file semantics)
			fs.writeFileSync(
				path.join(proj, ".stepcode", "stepcode-agent-team.json"),
				JSON.stringify({ members: { max: "forty-two" } }),
			);
			const c5 = loadConfig({ agentDir: base, projectDir: proj, trusted: true });
			check("project config: invalid value → default", c5.members.max === d.members.max, `got ${c5.members.max}`);

			// missing project file: base stands
			fs.rmSync(path.join(proj, ".stepcode"), { recursive: true, force: true });
			const c6 = loadConfig({ agentDir: base, projectDir: proj, trusted: true });
			check("project config: missing file → base stands", c6.members.max === 2, `got ${c6.members.max}`);

			// STEPCODE_TEAM_MAXDEPTH: effective depth bound propagation to sub-leaders
			const savedDepth = process.env.STEPCODE_TEAM_MAXDEPTH;
			process.env.STEPCODE_TEAM_MAXDEPTH = "3";
			const c7 = loadConfig({ agentDir: base });
			check("env: STEPCODE_TEAM_MAXDEPTH override", c7.members.maxRecursionDepth === 3, `got ${c7.members.maxRecursionDepth}`);
			process.env.STEPCODE_TEAM_MAXDEPTH = "bogus";
			const c8 = loadConfig({ agentDir: base });
			check("env: STEPCODE_TEAM_MAXDEPTH invalid ignored", c8.members.maxRecursionDepth === d.members.maxRecursionDepth, `got ${c8.members.maxRecursionDepth}`);
			if (savedDepth === undefined) delete process.env.STEPCODE_TEAM_MAXDEPTH;
			else process.env.STEPCODE_TEAM_MAXDEPTH = savedDepth;

			fs.rmSync(base, { recursive: true, force: true });
			fs.rmSync(proj, { recursive: true, force: true });

			// ---- live wiring: session_start applies the staged project config ----
			await new Promise((r) => setTimeout(r, 150)); // let index.ts's session_start run first
			const canCheckTrust = typeof ctx.isProjectTrusted === "function";
			const trusted = canCheckTrust ? ctx.isProjectTrusted() : false;
			if (canCheckTrust && trusted) {
				check("live: project config applied via session_start", getConfig().members.max === 42, `got ${getConfig().members.max}`);
				check("live: agentDir config still loads (no ambient file → default role)", typeof getConfig().members.defaultRole === "string");
			} else {
				skip("live: project config applied via session_start", canCheckTrust ? "project is not trusted in this environment" : "ctx.isProjectTrusted unavailable");
				// Untrusted (or no API): the staged file must NOT leak into the live config.
				check("live: untrusted project config not applied", getConfig().members.max !== 42, `got ${getConfig().members.max}`);
			}

			const failed = results.filter((r) => !r.ok).length;
			log(
				failed === 0
					? `SMOKE13 DONE (all passed${skipped > 0 ? `, ${skipped} skipped` : ""})`
					: `SMOKE13 DONE (${failed}/${results.length} failed${skipped > 0 ? `, ${skipped} skipped` : ""})`,
			);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE13 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			if (hadProjectCfg && savedProjectCfg !== null) fs.writeFileSync(PROJECT_CFG, savedProjectCfg);
			else try {
				fs.unlinkSync(PROJECT_CFG);
			} catch {
				/* not present */
			}
		}
	});
}
