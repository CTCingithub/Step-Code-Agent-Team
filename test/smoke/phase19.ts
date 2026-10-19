/**
 * Unified-config probe (plan-60 follow-up to the v0.1.0 release). Zero-token,
 * pure-function level: drives loadConfig() directly with hermetic temp dirs.
 *
 * Step Code moved its own settings to the unified config.toml (global beside
 * the agent dir, project under <cwd>/.stepcode/, agent/settings.json retired).
 * The plugin must read its stepcodeAgentTeam table from there, with the legacy
 * settings.json sections kept as a fallback. Precedence per tier:
 * defaults < legacy files < settings.json < config.toml < env overrides.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { defaultConfig, loadConfig } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke19]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const temps: string[] = [];
		const mkAgentRoot = (): { root: string; agentDir: string } => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat19-"));
			const agentDir = path.join(root, "agent");
			fs.mkdirSync(agentDir, { recursive: true });
			temps.push(root);
			return { root, agentDir };
		};

		try {
			// --- 1. global unified tier: <configRoot>/config.toml ----------------
			const { root, agentDir } = mkAgentRoot();
			fs.writeFileSync(
				path.join(root, "config.toml"),
				[
					"[stepcodeAgentTeam.activation]",
					"notifyOnActivate = false",
					"",
					"[stepcodeAgentTeam.members]",
					"max = 3",
					"",
					"[stepcodeAgentTeam.topology]",
					'default = "pipeline"',
					"maxLoopCount = 0",
					"",
				].join("\n"),
			);
			const c1 = loadConfig({ agentDir });
			check("unified global tier: boolean applied", c1.activation.notifyOnActivate === false, `got ${c1.activation.notifyOnActivate}`);
			check("unified global tier: number applied", c1.members.max === 3, `got ${c1.members.max}`);
			check("unified global tier: enum + zero-bound applied", c1.topology.default === "pipeline" && c1.topology.maxLoopCount === 0, `got ${c1.topology.default}/${c1.topology.maxLoopCount}`);

			// --- 2. precedence: config.toml beats the legacy settings.json -------
			fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ stepcodeAgentTeam: { members: { max: 5 } } }));
			const c2 = loadConfig({ agentDir });
			check("precedence: config.toml overrides settings.json", c2.members.max === 3, `got ${c2.members.max}`);

			// --- 3. legacy-only: settings.json still honored alone ---------------
			const legacy = mkAgentRoot();
			fs.writeFileSync(path.join(legacy.agentDir, "settings.json"), JSON.stringify({ stepcodeAgentTeam: { members: { max: 6 } } }));
			const c3 = loadConfig({ agentDir: legacy.agentDir });
			check("legacy settings.json still honored", c3.members.max === 6, `got ${c3.members.max}`);

			// --- 4. project unified tier, trust-gated ----------------------------
			const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "scat19-proj-"));
			temps.push(projectDir);
			fs.mkdirSync(path.join(projectDir, ".stepcode"), { recursive: true });
			fs.writeFileSync(path.join(projectDir, ".stepcode", "config.toml"), "[stepcodeAgentTeam.members]\nmax = 4\n");
			const c4 = loadConfig({ agentDir: legacy.agentDir, projectDir, trusted: true });
			check("project unified tier applies when trusted", c4.members.max === 4, `got ${c4.members.max}`);
			const c5 = loadConfig({ agentDir: legacy.agentDir, projectDir, trusted: false });
			check("project unified tier ignored when untrusted", c5.members.max === 6, `got ${c5.members.max}`);

			// --- 5. project unified beats project settings.json ------------------
			fs.writeFileSync(
				path.join(projectDir, ".stepcode", "settings.json"),
				JSON.stringify({ stepcodeAgentTeam: { members: { max: 7 } } }),
			);
			const c6 = loadConfig({ agentDir: legacy.agentDir, projectDir, trusted: true });
			check("project unified beats project settings.json", c6.members.max === 4, `got ${c6.members.max}`);

			// --- 6. invalid TOML tolerated (no throw; legacy value stands) -------
			fs.writeFileSync(path.join(root, "config.toml"), "this is [not valid TOML");
			const c7 = loadConfig({ agentDir });
			check("invalid config.toml tolerated", c7.members.max === 5, `got ${c7.members.max}`);

			// --- 7. env overrides still win over the unified tier ----------------
			fs.writeFileSync(path.join(root, "config.toml"), "[stepcodeAgentTeam.members]\nmax = 3\n");
			const savedDepth = process.env.STEPCODE_TEAM_MAXDEPTH;
			process.env.STEPCODE_TEAM_MAXDEPTH = "4";
			const c8 = loadConfig({ agentDir });
			check(
				"env override beats unified tier",
				c8.members.max === 3 && c8.members.maxRecursionDepth === 4,
				`got max=${c8.members.max} depth=${c8.members.maxRecursionDepth}`,
			);
			if (savedDepth === undefined) delete process.env.STEPCODE_TEAM_MAXDEPTH;
			else process.env.STEPCODE_TEAM_MAXDEPTH = savedDepth;

			// --- 8. missing config.toml → defaults stand, no error ---------------
			const bare = mkAgentRoot();
			const c9 = loadConfig({ agentDir: bare.agentDir });
			check("missing config.toml → built-in defaults", c9.members.max === defaultConfig().members.max, `got ${c9.members.max}`);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE19 DONE (all passed)" : `SMOKE19 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE19 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}
