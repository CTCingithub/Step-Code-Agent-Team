/**
 * Config seeding probe (plan-61). Zero-token, pure-function level: drives
 * seedGlobalConfigExample() directly with hermetic temp dirs.
 *
 * A fresh step 0.1.5 install has no plugin configuration at all (the plugin is
 * read-only and writes nothing by default), so users cannot discover the
 * available options. On first activation the plugin now appends a commented
 * defaults block to the global config.toml — additive only: existing content
 * is preserved, the block is comments (defaults still apply), and the write is
 * idempotent.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { loadConfig, seedGlobalConfigExample } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke20]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const temps: string[] = [];
		const mkAgentRoot = (): { root: string; agentDir: string } => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat20-"));
			const agentDir = path.join(root, "agent");
			fs.mkdirSync(agentDir, { recursive: true });
			temps.push(root);
			return { root, agentDir };
		};

		try {
			// --- 1. existing config.toml (packages entry) gets the seed ----------
			const { root, agentDir } = mkAgentRoot();
			const file = path.join(root, "config.toml");
			fs.writeFileSync(file, '# StepCode configuration\ntheme = "step-blue"\n\n[mcp_import]\nreviewed = [ ".claude" ]\n');
			const seeded = seedGlobalConfigExample(agentDir);
			check("seed: appended to an existing config", seeded === true);
			const afterSeed = fs.readFileSync(file, "utf8");
			check("seed: original content preserved", afterSeed.startsWith('# StepCode configuration\ntheme = "step-blue"'));
			check("seed: mcp_import section preserved", afterSeed.includes("[mcp_import]"));
			check("seed: block is commented (defaults still apply)", /^# \[stepcodeAgentTeam/m.test(afterSeed) && loadConfig({ agentDir }).members.max === 8);
			const seedSections = [
				"# [stepcodeAgentTeam.activation]",
				"# [stepcodeAgentTeam.models]",
				"# [stepcodeAgentTeam.members]",
				"# [stepcodeAgentTeam.dispatch]",
				"# [stepcodeAgentTeam.oneshot]",
				"# [stepcodeAgentTeam.cost]",
				"# [stepcodeAgentTeam.idle]",
				"# [stepcodeAgentTeam.storage]",
				"# [stepcodeAgentTeam.topology]",
				"# [stepcodeAgentTeam]",
			];
			const missingSections = seedSections.filter((s) => !afterSeed.includes(s));
			check("seed: every config section is listed", missingSections.length === 0, `missing: ${missingSections.join(", ")}`);
			check("seed: keywords line carries the full default list", afterSeed.includes("组队") && afterSeed.includes("team plugin"), "keywords show examples only");

			// --- 2. idempotent ---------------------------------------------------
			const seededAgain = seedGlobalConfigExample(agentDir);
			check("seed: second call is a no-op", seededAgain === false && fs.readFileSync(file, "utf8") === afterSeed);

			// --- 3. an active section suppresses the seed ------------------------
			const active = mkAgentRoot();
			const activeFile = path.join(active.root, "config.toml");
			fs.writeFileSync(activeFile, 'packages = []\n\n[stepcodeAgentTeam.members]\nmax = 3\n');
			const seededActive = seedGlobalConfigExample(active.agentDir);
			check(
				"seed: skipped when a stepcodeAgentTeam table exists",
				seededActive === false && fs.readFileSync(activeFile, "utf8") === 'packages = []\n\n[stepcodeAgentTeam.members]\nmax = 3\n',
			);

			// --- 4. missing config.toml is created (step header) and seeded ------
			const bare = mkAgentRoot();
			const bareFile = path.join(bare.root, "config.toml");
			const seededBare = seedGlobalConfigExample(bare.agentDir);
			check("seed: missing config.toml is created", seededBare === true && fs.existsSync(bareFile));
			check("seed: created file keeps step's header", fs.readFileSync(bareFile, "utf8").startsWith("# StepCode configuration"));
			check("seed: created file carries the commented block", /^# \[stepcodeAgentTeam/m.test(fs.readFileSync(bareFile, "utf8")));

			// --- 5. parse sanity: a seeded config still loads defaults -----------
			check("seed: config with only a seed block loads defaults", loadConfig({ agentDir }).dispatch.maxConcurrent === 5);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE20 DONE (all passed)" : `SMOKE20 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE20 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}
