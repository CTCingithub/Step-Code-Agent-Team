/**
 * Config-seeding probe (plan-116). Zero-token, standalone: the first-activation
 * seed block, the `DEFAULT` sentinel, and the upgrade delta — all driven against
 * hermetic mktemp agent dirs, so no model call and no real config is touched.
 *
 * What it locks down:
 *   1. the seed block is entirely comments. The searcher keys used to be the
 *      four uncommented lines in it, so they landed in the TOML root table and
 *      uncommenting the section header produced a duplicate-key error — the
 *      block invited the one edit that broke the file;
 *   2. every config table is documented. A section missing from the block is an
 *      option nobody can discover, which is how the searcher table went
 *      unnoticed for a round;
 *   3. `DEFAULT` means "use the built-in default" for every type at once — the
 *      merge skips the key, so the default stands. That is what makes a seeded
 *      config follow a new version's default instead of pinning the old one;
 *   4. an upgrade appends only what is new or changed, and never twice. This is
 *      the requirement that new options appear after installing a new version;
 *   5. a legacy block with no version markers is not duplicated wholesale, but
 *      genuinely new sections still appear;
 *   6. an explicit value still wins over the default (DEFAULT must not become a
 *      way to silently ignore configuration).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import {
	agentDir,
	DEFAULT_SENTINEL,
	defaultConfig,
	loadConfig,
	resetConfigCache,
	seedGlobalConfigExample,
	type PluginConfig,
} from "../../extensions/config.ts";

/** Minimal TOML reader for the tables the seed block writes, so the probe can assert on real parsing. */
function readTable(text: string, table: string): Record<string, unknown> {
	const lines = text.split("\n");
	let inTable = false;
	const out: Record<string, unknown> = {};
	for (const raw of lines) {
		const line = raw.trim();
		if (line.startsWith("[") && line.endsWith("]")) {
			inTable = line.slice(1, -1) === table;
			continue;
		}
		if (!inTable || !line || line.startsWith("#")) continue;
		const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (!m) continue;
		let value: unknown = m[2].replace(/\s+#.*$/, "").trim();
		if (value === "true") value = true;
		else if (value === "false") value = false;
		else if (/^-?\d+$/.test(String(value))) value = Number(value);
		else if (/^".*"$/.test(String(value))) value = String(value).slice(1, -1);
		else if (String(value).startsWith("[")) value = String(value);
		out[m[1]] = value;
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke31]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 170)}` : ""}`);
		};

		const temps: string[] = [];
		const mkAgent = (): string => {
			const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat31-"));
			temps.push(root);
			const agent = path.join(root, "agent");
			fs.mkdirSync(agent, { recursive: true });
			return agent;
		};
		const cfgOf = (agent: string): string => path.join(path.dirname(agent), "config.toml");
		// Only the table-shaped keys: `debug` is a root-level boolean, so looking
		// for a `[stepcodeAgentTeam.debug]` header would fail forever.
		const tableNames = (cfg: PluginConfig): string[] =>
			Object.keys(cfg).filter((k) => k !== "presets" && typeof (cfg as unknown as Record<string, unknown>)[k] === "object");

		try {
			const d = defaultConfig();

			// ---- 1. the block is comments only ----
			const a1 = mkAgent();
			const seeded = seedGlobalConfigExample(a1);
			const file = cfgOf(a1);
			check("seed: a fresh agent dir gets a config file", seeded && fs.existsSync(file));
			const text = fs.readFileSync(file, "utf8");
			const active = text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
			check("seed: every line is a comment (nothing is configured implicitly)", active.length === 0, active.slice(0, 3).join(" | "));
			check("seed: no root-table pollution from the searcher keys", !Object.prototype.hasOwnProperty.call(readTable(text, ""), "searchUrl"), JSON.stringify(readTable(text, "")));

			// ---- 2. every table is documented ----
			// The table list comes from the defaults themselves, so a new config
			// table fails this probe until someone documents it.
			const tables = tableNames(d);
			const missing = tables.filter((t) => !text.includes(`[stepcodeAgentTeam.${t}] (v`));
			check("seed: every config table is documented", missing.length === 0, missing.join(","));
			check("seed: the root-level debug key is documented", text.includes(`[stepcodeAgentTeam] (v`) && text.includes('debug = "DEFAULT"'));
			check("seed: presets.effort is documented too", text.includes("[stepcodeAgentTeam.presets.effort] (v"));
			for (const role of Object.keys(d.presets.effort)) {
				if (!text.includes(`${role} = "${DEFAULT_SENTINEL}"`)) check(`seed: presets.effort.${role} documented`, false);
			}
			check("seed: every role in presets.effort is documented", Object.keys(d.presets.effort).every((r) => text.includes(`${r} = "${DEFAULT_SENTINEL}"`)));
			check("seed: the searcher keys are commented like the rest", text.split("\n").filter((l) => l.includes("searchUrl =")).every((l) => l.trim().startsWith("#")));
			// The one hazard the plugin cannot detect: a bare `DEFAULT` is not a TOML
			// scalar, so step's reader drops the whole table before our code ever sees
			// it. Every DEFAULT line in the block must therefore be quoted, so that
			// uncommenting one can never produce the bare form.
			const defaultLines = text.split("\n").filter((l) => /= "DEFAULT"/.test(l));
			check("seed: every DEFAULT line is quoted", defaultLines.length > 0 && defaultLines.every((l) => new RegExp(`= "${DEFAULT_SENTINEL}"`).test(l)), defaultLines.filter((l) => !new RegExp(`= "${DEFAULT_SENTINEL}"`).test(l)).slice(0, 2).join(" | "));
			check("seed: the block warns about the bare form", text.includes("KEEP THE QUOTES"));

			// ---- 3. DEFAULT means "use the built-in default" ----
			const a3 = mkAgent();
			const f3 = cfgOf(a3);
			fs.writeFileSync(
				f3,
				[
					"[stepcodeAgentTeam.members]",
					`max = "${DEFAULT_SENTINEL}"`,
					"defaultRole = \"scout\"",
					`[stepcodeAgentTeam.activation]`,
					`enabled = "${DEFAULT_SENTINEL}"`,
					`keywords = "${DEFAULT_SENTINEL}"`,
					`[stepcodeAgentTeam.topology]`,
					`requireDeclaration = "${DEFAULT_SENTINEL}"`,
				].join("\n"),
			);
			resetConfigCache();
			const c3 = loadConfig({ agentDir: a3 });
			check("DEFAULT: a number key keeps its default", c3.members.max === d.members.max, `${c3.members.max} vs ${d.members.max}`);
			check("DEFAULT: a boolean key keeps its default", c3.activation.enabled === d.activation.enabled, String(c3.activation.enabled));
			check("DEFAULT: an array key keeps its default", c3.activation.keywords.length === d.activation.keywords.length, `${c3.activation.keywords.length} vs ${d.activation.keywords.length}`);
			check("DEFAULT: an explicit value still wins", c3.members.defaultRole === "scout", c3.members.defaultRole);
			check("DEFAULT: a neighbouring explicit value is unaffected", c3.topology.requireDeclaration === d.topology.requireDeclaration, String(c3.topology.requireDeclaration));

			// DEFAULT inside a nested table (presets.effort is the only one).
			const a3b = mkAgent();
			fs.writeFileSync(cfgOf(a3b), ["[stepcodeAgentTeam.presets.effort]", `scout = "${DEFAULT_SENTINEL}"`, 'worker = "max"'].join("\n"));
			resetConfigCache();
			const c3b = loadConfig({ agentDir: a3b });
			check("DEFAULT: works inside a nested table", c3b.presets.effort.scout === d.presets.effort.scout, String(c3b.presets.effort.scout));
			check("DEFAULT: a sibling in the same table still applies", c3b.presets.effort.worker === "max", String(c3b.presets.effort.worker));

			// ---- 3b. uncommenting every DEFAULT line still yields the defaults ----
			// The whole point of the sentinel, and the reason it must be quoted: a
			// bare `DEFAULT` is not a TOML scalar, so step's reader drops the entire
			// section and the user's real settings in it silently stop applying.
			// This is the guard against that class of bug.
			const a3c = mkAgent();
			const f3c = cfgOf(a3c);
			const uncommented = text
				.split("\n")
				.map((l) => l.replace(/^#\s?/, ""))
				.filter((l) => l.includes(`= "${DEFAULT_SENTINEL}"`))
				.join("\n");
			check("uncomment: the block has DEFAULT lines to uncomment", uncommented.split("\n").length > 20, String(uncommented.split("\n").length));
			const byTable = new Map<string, string[]>();
			let current = "";
			for (const l of uncommented.split("\n")) {
				const h = /^\[stepcodeAgentTeam\.([\w.]+)\]$/.exec(l.trim());
				if (h) {
					current = h[1];
					continue;
				}
				if (!byTable.has(current)) byTable.set(current, []);
				byTable.get(current)!.push(l);
			}
			const rebuilt = [...byTable.entries()].map(([t, ls]) => `[stepcodeAgentTeam.${t}]\n${ls.join("\n")}`).join("\n\n");
			fs.writeFileSync(f3c, rebuilt);
			resetConfigCache();
			const c3c = loadConfig({ agentDir: a3c });
			const drifted: string[] = [];
			const walk = (a: Record<string, unknown>, b: Record<string, unknown>, prefix: string): void => {
				for (const k of Object.keys(a)) {
					const av = a[k];
					const bv = b[k];
					if (av && typeof av === "object" && !Array.isArray(av)) walk(av as Record<string, unknown>, (bv ?? {}) as Record<string, unknown>, `${prefix}${k}.`);
					else if (JSON.stringify(av) !== JSON.stringify(bv)) drifted.push(`${prefix}${k}: ${JSON.stringify(bv)} != ${JSON.stringify(av)}`);
				}
			};
			walk(c3c as unknown as Record<string, unknown>, d as unknown as Record<string, unknown>, "");
			check("uncomment: every DEFAULT line resolves to the built-in default", drifted.length === 0, drifted.slice(0, 4).join(" | "));
			resetConfigCache();

			// ---- 4. idempotence and the upgrade delta ----
			const again = seedGlobalConfigExample(a1);
			check("seed: a second call appends nothing", again === false && fs.readFileSync(file, "utf8") === text);

			// Simulate an older install: rewrite every section marker to v0.2.0.
			const older = text.replace(/\(v[^)]+\)/g, "(v0.2.0)");
			fs.writeFileSync(file, older);
			const upgraded = seedGlobalConfigExample(a1);
			const afterUpgrade = fs.readFileSync(file, "utf8");
			check("seed: an older marker triggers a refresh", upgraded === true);
			check("seed: the refresh is not a duplicate of the whole block", afterUpgrade.split("stepcode-agent-team configuration").length === 2, `headers=${afterUpgrade.split("stepcode-agent-team configuration").length - 1}`);
			check("seed: the refresh re-documents every table", tableNames(d).every((t) => afterUpgrade.includes(`[stepcodeAgentTeam.${t}] (v`)));
			const third = seedGlobalConfigExample(a1);
			check("seed: after the refresh it is idempotent again", third === false);

			// A new section must appear for an install whose block predates it.
			// A legacy block: our section, but with no version markers at all (what a
			// pre-versioning install left behind). Its named sections must not be
			// duplicated; the ones it never heard of must appear.
			const a4 = mkAgent();
			fs.writeFileSync(cfgOf(a4), ["# ---- stepcode-agent-team configuration (uncomment to override) ----", "# [stepcodeAgentTeam.members]", "# max = 8"].join("\n"));
			const grew = seedGlobalConfigExample(a4);
			const grewText = fs.readFileSync(cfgOf(a4), "utf8");
			check("seed: a legacy block gains the missing sections", grew === true);
			check("seed: the legacy section is not duplicated", (grewText.match(/\[stepcodeAgentTeam\.members\]/g) ?? []).length === 1, String((grewText.match(/\[stepcodeAgentTeam\.members\]/g) ?? []).length));
			check("seed: the searcher table appears for the legacy install", grewText.includes("[stepcodeAgentTeam.searcher] (v"));
			check("seed: the legacy block's own comment survives", grewText.includes("# max = 8"));

			// A user's own active table must never be mistaken for our block.
			const a5 = mkAgent();
			fs.writeFileSync(cfgOf(a5), ["[stepcodeAgentTeam.members]", "max = 3"].join("\n"));
			const active5 = seedGlobalConfigExample(a5);
			const afterActive = fs.readFileSync(cfgOf(a5), "utf8");
			check("seed: an active table is not duplicated by a reference copy", active5 === true && (afterActive.match(/\[stepcodeAgentTeam\.members\]/g) ?? []).length === 1, String((afterActive.match(/\[stepcodeAgentTeam\.members\]/g) ?? []).length));
			check("seed: the other tables are still offered alongside it", afterActive.includes("[stepcodeAgentTeam.searcher] (v"));
			resetConfigCache();
			check("seed: the user's active value survives the seeding", loadConfig({ agentDir: a5 }).members.max === 3, String(loadConfig({ agentDir: a5 }).members.max));

			// ---- 7. an ACTIVE config carrying the v0.4.x sections loads cleanly ----
			// sandbox/config.toml is a hand-maintained active config (not the
			// commented reference block), so this is the shape a real session
			// presents. It is a fixture rather than that file because the sandbox
			// config is gitignored and absent on a fresh clone — asserting on it
			// would make the gate environment-dependent.
			const a7 = mkAgent();
			fs.writeFileSync(
				cfgOf(a7),
				[
					"theme = \"dark\"",
					"",
					"[stepcodeAgentTeam.searcher]",
					'searchUrl = ""',
					'searchApiKey = ""',
					'fetchUrl = ""',
					'fetchApiKey = ""',
					"",
					"[stepcodeAgentTeam.encryption]",
					"enabled = true",
					"",
					"[stepcodeAgentTeam.records]",
					"enabled = true",
					'dir = "records"',
				].join("\n"),
			);
			resetConfigCache();
			const c7 = loadConfig({ agentDir: a7 });
			check("active config: the searcher section parses and stays at its defaults", c7.searcher.searchUrl === "" && c7.searcher.fetchApiKey === "", JSON.stringify(c7.searcher));
			check("active config: encryption reads true", c7.encryption.enabled === true, String(c7.encryption.enabled));
			check("active config: records read enabled with the default dir", c7.records.enabled === true && c7.records.dir === "records", `${c7.records.enabled}/${c7.records.dir}`);
			check("active config: an unrelated top-level key is not mistaken for ours", c7.debug === d.debug, String(c7.debug));
			resetConfigCache();

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE31 DONE (all passed)" : `SMOKE31 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE31 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const t of temps) fs.rmSync(t, { recursive: true, force: true });
			resetConfigCache();
		}
	});
}
