/**
 * Phase 39 smoke probe (zero token cost): the upgrade path.
 *
 * A v0.3.0 user's config.toml meets the v0.4.x seed block. QA flagged this as
 * uncovered: nothing simulated the transition, and it is the one path every
 * existing user takes exactly once. The risk is specific — the seed block is
 * additive and comments-only by design, so a regression here would either
 * overwrite a user's real settings or fail to add the new ones, and neither
 * shows up anywhere else.
 *
 * What must hold:
 *   1. seeding an ALREADY-CONFIGURED file keeps every real value (idempotent,
 *      additive — comments only);
 *   2. a NEW section is added, and the new keys are commented out so defaults
 *      keep applying;
 *   3. a legacy keywords list still migrates (consumeKeywordMigration);
 *   4. re-seeding twice changes nothing (idempotence at the file level);
 *   5. a fresh dir still gets a full block (the v0.4.x install path).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { readStepConfig } from "@step-harness/coding-agent";
import {
	DEFAULT_MARKER,
	defaultConfig,
	loadConfig,
	resetConfigCache,
	seedGlobalConfigExample,
	consumeKeywordMigration,
	unifiedConfigFilePath,
} from "../../extensions/config.ts";

/** A v0.3.0-era agent dir: `<root>/agent`, so the unified config is `<root>/config.toml`. */
function mkAgent(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat39-"));
	const agent = path.join(root, "agent");
	fs.mkdirSync(agent, { recursive: true });
	return agent;
}
const cfgOf = (agent: string): string => path.join(path.dirname(agent), "config.toml");

/** Minimal TOML table reader for the tables the seed block writes. */
function readTable(text: string, table: string): Record<string, string> {
	const out: Record<string, string> = {};
	let inTable = false;
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (t.startsWith("[") && t.endsWith("]")) {
			inTable = t === `[${table}]`;
			continue;
		}
		if (!inTable || !t || t.startsWith("#")) continue;
		const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
		if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke39]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};
		const temps: string[] = [];

		try {
			const d = defaultConfig();

			// ---- 1. a v0.3.0 config with real values survives the v0.4.x seed ----
			const a1 = mkAgent();
			temps.push(a1);
			const f1 = cfgOf(a1);
			fs.writeFileSync(
				f1,
				[
					"# Step Code config",
					"[stepcodeAgentTeam.activation]",
					'enabled = "true"',
					'keywords = "team, squadup"',
					"[stepcodeAgentTeam.members]",
					'max = "6"',
					'defaultRole = "scout"',
					"[stepcodeAgentTeam.dispatch]",
					'timeoutMs = "120000"',
				].join("\n"),
			);
			const before = fs.readFileSync(f1, "utf8");
			const seeded = seedGlobalConfigExample(a1);
			const after = fs.readFileSync(f1, "utf8");
			check("upgrade: seeding an existing file reports a change", seeded === true, String(seeded));
			check("upgrade: every real v0.3.0 value survives", after.includes(before.trim()), "the original block is a prefix of the result");
			const t1 = readTable(after, "stepcodeAgentTeam.activation");
			const m1 = readTable(after, "stepcodeAgentTeam.members");
			const disp1 = readTable(after, "stepcodeAgentTeam.dispatch");
			check("upgrade: the user's keywords survive verbatim", t1.keywords === "team, squadup", JSON.stringify(t1.keywords));
			check("upgrade: the user's members.max survives", m1.max === "6", String(m1.max));
			check("upgrade: the user's defaultRole survives", m1.defaultRole === "scout", String(m1.defaultRole));
			check("upgrade: the user's dispatch.timeoutMs survives", disp1.timeoutMs === "120000", String(disp1.timeoutMs));

			// ---- 2. the config still LOADS to those values ----
			// This is the assertion that matters, and the one that found a real
			// defect: the file-level checks above all pass while the parsed config
			// silently reverts to defaults. Seeding must leave a file the host can
			// still parse AND whose parse still carries the user's values.
			let parsed: Record<string, unknown> | null = null;
			let parseError = "";
			try {
				const doc = readStepConfig(f1) as Record<string, unknown> | undefined;
				const sec = doc?.stepcodeAgentTeam;
				parsed = typeof sec === "object" && sec !== null && !Array.isArray(sec) ? (sec as Record<string, unknown>) : null;
			} catch (err) {
				parseError = err instanceof Error ? err.message : String(err);
			}
			check("upgrade: the seeded file still parses", parsed !== null, parseError || JSON.stringify(Object.keys(parsed ?? {})));
			// Diagnostic: the two readers must agree on WHICH file. When they do not,
			// the config silently reverts to defaults while the file looks perfect.
			const resolved = unifiedConfigFilePath(a1);
			check("diag: unifiedConfigFilePath resolves to the file we wrote",
				resolved === f1 && fs.existsSync(resolved), `resolved=${resolved} expected=${f1} exists=${fs.existsSync(resolved)}`);
			const act = (parsed?.activation ?? {}) as Record<string, unknown>;
			const mem = (parsed?.members ?? {}) as Record<string, unknown>;
			const disp = (parsed?.dispatch ?? {}) as Record<string, unknown>;
			check("upgrade: the parse keeps the user's keywords", act.keywords === "team, squadup", JSON.stringify(act.keywords));
			check("upgrade: the parse keeps the user's members.max", mem.max === "6", JSON.stringify(mem.max));
			check("upgrade: the parse keeps the user's dispatch timeout", disp.timeoutMs === "120000", JSON.stringify(disp.timeoutMs));
			resetConfigCache();
			const c1 = loadConfig({ agentDir: a1 });
			check("upgrade: the loaded config keeps the user's members.max", c1.members.max === 6, String(c1.members.max));
			check("upgrade: the loaded config keeps the user's keywords", Array.isArray(c1.activation.keywords) && c1.activation.keywords.length === 2 && c1.activation.keywords[0] === "team" && c1.activation.keywords[1] === "squadup", JSON.stringify(c1.activation.keywords));
			check("upgrade: the loaded config keeps the user's dispatch timeout", c1.dispatch.timeoutMs === 120_000, String(c1.dispatch.timeoutMs));

			// ---- 3. the v0.4.x-only sections were ADDED, commented out ----
			const added = ["stepcodeAgentTeam.searcher", "stepcodeAgentTeam.encryption", "stepcodeAgentTeam.records"];
			for (const section of added) {
				check(`upgrade: the new ${section.split(".").pop()} section was added`, after.includes(`[${section}]`), "");
			}
			const searcher = readTable(after, "stepcodeAgentTeam.searcher");
			check("upgrade: the new searcher keys are commented out (defaults keep applying)",
				Object.keys(searcher).length === 0 && after.includes(`searchApiKey = "${DEFAULT_MARKER}"`),
				`active keys: ${Object.keys(searcher).join(",") || "none"}`);
			check("upgrade: the new records section is commented out too",
				Object.keys(readTable(after, "stepcodeAgentTeam.records")).length === 0, "");

			// ---- 4. re-seeding changes nothing ----
			const seededAgain = seedGlobalConfigExample(a1);
			const afterAgain = fs.readFileSync(f1, "utf8");
			check("upgrade: a second seed is a no-op", seededAgain === false && afterAgain === after, `seeded=${seededAgain} identical=${afterAgain === after}`);

			// ---- 5. a fresh dir still gets the full block ----
			const a2 = mkAgent();
			temps.push(a2);
			const freshSeeded = seedGlobalConfigExample(a2);
			const freshText = fs.existsSync(cfgOf(a2)) ? fs.readFileSync(cfgOf(a2), "utf8") : "";
			check("upgrade: a fresh dir still gets a block", freshSeeded === true && freshText.includes("stepcodeAgentTeam"), "");
			const activeFresh = freshText.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
			check("upgrade: the fresh block is comments only (no active keys)", activeFresh.length === 0, activeFresh.slice(0, 3).join(" | "));

			// ---- 6. the legacy keyword migration still fires on an old file ----
			const a3 = mkAgent();
			temps.push(a3);
			fs.writeFileSync(cfgOf(a3), ["[stepcodeAgentTeam.activation]", 'keywords = "squad"', ""].join("\n"));
			resetConfigCache();
			const migrated = consumeKeywordMigration();
			check("upgrade: the legacy keyword migration still reports", Array.isArray(migrated), JSON.stringify(migrated));
		} catch (err) {
			check("setup: the probe reached its upgrade stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			for (const t of temps) fs.rmSync(path.dirname(t), { recursive: true, force: true });
			resetConfigCache();
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE39 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
