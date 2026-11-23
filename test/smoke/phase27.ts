/**
 * Searcher-role probe (v0.4.0). Zero-token, standalone: preset loading plus the
 * spawn-argument/env contract, driven without a model call.
 *
 * What it locks down:
 *   1. the bundled `searcher` preset loads with all five frontmatter fields
 *      (it is the fifth built-in role, and a missing `model:` is exactly the
 *      defect that once made worker members unspawnable);
 *   2. `presets.effort` config still overrides the preset's own effort;
 *   3. the searcher config keys validate and default to empty strings, and the
 *      seed block carries them (a missing seed line is what made the first
 *      activation's commented block incomplete);
 *   4. non-empty searcher config reaches the member environment under the four
 *      documented names, and an empty config injects nothing.
 *
 * No credential value is ever logged — only presence.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { agentDir, defaultConfig, getConfig, loadConfig, resetConfigCache } from "../../extensions/config.ts";
import { loadPreset } from "../../extensions/presets.ts";
import { registerTeamTools } from "../../extensions/tools.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke27]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const temps: string[] = [];
		const mkTmp = (): string => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scat27-"));
			temps.push(dir);
			return dir;
		};

		try {
			// ---- 1. the bundled preset ----
			const searcher = loadPreset("searcher", agentDir());
			check("preset: searcher loads", searcher?.name === "searcher", String(searcher?.name));
			check("preset: has a description", Boolean(searcher?.description?.trim()), searcher?.description ?? "");
			check("preset: declares tools", Array.isArray(searcher?.tools) && searcher.tools.length > 0, (searcher?.tools ?? []).join(","));
			check("preset: includes search_web (the retrieval tool)", (searcher?.tools ?? []).includes("search_web"));
			check("preset: includes run_command (fetch: the host ships no fetch tool)", (searcher?.tools ?? []).includes("run_command"));
			check("preset: pins a model (the worker-preset footgun)", searcher?.model === "step-5-preview", String(searcher?.model));
			check("preset: declares an effort", Boolean(searcher?.effort), String(searcher?.effort));
			// The role's own guidance is part of the contract: `--need-content` is
			// the default because without it `content` is empty and a result cannot
			// be quoted. If someone rewrites the preset and drops that, every
			// citation the role makes silently loses its source text — and nothing
			// else in the gate would notice, because the flag is only exercised by
			// a live (billed) round.
			// systemPrompt IS the preset file's body (presets.ts parseFrontmatter), so no
			// path guessing: whichever tier won is what gets asserted here.
			const presetBody = searcher?.systemPrompt ?? "";
			check("preset: the body names the retrieval script", presetBody.includes("STEPCODE_TOPO_SEARCH_SCRIPT"), presetBody.slice(0, 80));
			check("preset: --need-content is the default in the guidance", /--need-content/.test(presetBody) && /by\s+default/i.test(presetBody), presetBody.slice(0, 80));
			check("preset: the guidance explains what the flag changes", /content/.test(presetBody), presetBody.slice(0, 80));
			check("preset: does not shadow the other four roles", ["scout", "planner", "worker", "reviewer"].every((r) => loadPreset(r, agentDir())?.name === r));

			// ---- 2. presets.effort override still wins ----
			const ad = agentDir();
			const settingsFile = path.join(ad, "settings.json");
			const had = fs.existsSync(settingsFile);
			const prev = had ? fs.readFileSync(settingsFile, "utf8") : "";
			fs.writeFileSync(settingsFile, JSON.stringify({ stepcodeAgentTeam: { presets: { effort: { searcher: "xhigh" } } } }));
			resetConfigCache();
			check("presets.effort: config overrides the searcher preset", getConfig().presets.effort.searcher === "xhigh", String(getConfig().presets.effort.searcher));
			if (had) fs.writeFileSync(settingsFile, prev);
			else fs.rmSync(settingsFile, { force: true });
			resetConfigCache();

			// ---- 3. the config surface ----
			const d = defaultConfig();
			check("config: searcher defaults to four empty strings", (() => { const s = d.searcher; return s.searchUrl === "" && s.searchApiKey === "" && s.fetchUrl === "" && s.fetchApiKey === ""; })());
			check("config: encryption defaults to on", d.encryption.enabled === true);
			const tmp = mkTmp();
			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({
					stepcodeAgentTeam: {
						searcher: { searchUrl: "https://s.example/search", searchApiKey: "k", fetchUrl: "https://f.example", fetchApiKey: "f" },
						encryption: { enabled: false },
					},
				}),
			);
			const c1 = loadConfig({ agentDir: tmp });
			check("config: searcher values load", c1.searcher.searchUrl === "https://s.example/search" && c1.searcher.fetchApiKey === "f", c1.searcher.searchUrl);
			check("config: encryption toggle loads", c1.encryption.enabled === false);
			const bad = mkTmp();
			fs.writeFileSync(
				path.join(bad, "settings.json"),
				JSON.stringify({ stepcodeAgentTeam: { searcher: { searchUrl: 42 }, encryption: { enabled: "yes" } } }),
			);
			const c2 = loadConfig({ agentDir: bad });
			check("config: a non-string searchUrl falls back to the default", c2.searcher.searchUrl === "", JSON.stringify(c2.searcher.searchUrl));
			check("config: a non-boolean enabled falls back to the default", c2.encryption.enabled === true, String(c2.encryption.enabled));
			// seedBlock() is module-private; assert through the file it appends to.
			// The unified config sits BESIDE the agent dir (dirname(agentDir)),
			// so the fixture needs the same nesting the real layout has.
			const seedRoot = mkTmp();
			const seedAgent = path.join(seedRoot, "agent");
			fs.mkdirSync(seedAgent, { recursive: true });
			const seedCfg = path.join(seedRoot, "config.toml");
			fs.writeFileSync(seedCfg, "# StepCode configuration\n");
			const { seedGlobalConfigExample } = await import("../../extensions/config.ts");
			seedGlobalConfigExample(seedAgent);
			const seeded = fs.readFileSync(seedCfg, "utf8");
			check("seed: appended block carries [stepcodeAgentTeam.searcher]", seeded.includes("[stepcodeAgentTeam.searcher]"));
			check("seed: appended block carries [stepcodeAgentTeam.encryption]", seeded.includes("[stepcodeAgentTeam.encryption]"));
			// The searcher defaults are the empty string, so DEFAULT and "" would
			// read the same; the block spells out what empty means for each of the
			// two consumers instead of leaving the reader to guess.
			check("seed: block documents what the empty searcher values mean", seeded.includes("the role falls back to the host search_web endpoint") && seeded.includes("no Authorization header"));
			check("seed: block is additive (the user's line survives)", seeded.startsWith("# StepCode configuration\n"));

			// ---- 4. the spawn environment ----
			const registered: Array<{ name: string; parameters?: unknown }> = [];
			registerTeamTools(
				{ registerTool: (t: { name: string; parameters?: unknown }) => registered.push(t) } as never,
				(() => null) as never,
				getConfig(),
			);
			const createTool = registered.find((t) => t.name === "team_create_member");
			check("tools: team_create_member is registered (needed to spawn a searcher)", Boolean(createTool));
			// Asserts the real mapping function, not a hand copy of it. The copy
			// this replaces mirrored buildSpawnArgs' four lines, so it inherited
			// the original's blind spot: the missing STEPCODE_TOPO_SEARCH_KEY
			// passed the gate while the script's search path had no credential.
			const { searcherSpawnEnv } = await import("../../extensions/config.ts");
			const injected = searcherSpawnEnv(c1.searcher);
			check("env: all five keys are injected when configured", Object.keys(injected).length === 5, Object.keys(injected).join(","));
			check("env: the script's own search key name is injected", injected.STEPCODE_TOPO_SEARCH_KEY === "k", String(injected.STEPCODE_TOPO_SEARCH_KEY));
			check("env: the host search key name carries the same configured key", injected.STEPCODE_SEARCH_API_KEY === "k", String(injected.STEPCODE_SEARCH_API_KEY));
			check("env: the fetch key keeps its own name", injected.STEPCODE_TOPO_FETCH_KEY === "f", String(injected.STEPCODE_TOPO_FETCH_KEY));
			check("env: both endpoints are injected", injected.STEPCODE_TOPO_SEARCH_URL === "https://s.example/search" && injected.STEPCODE_TOPO_FETCH_URL === "https://f.example", `${injected.STEPCODE_TOPO_SEARCH_URL} / ${injected.STEPCODE_TOPO_FETCH_URL}`);
			check("env: nothing is injected when unconfigured", Object.keys(searcherSpawnEnv(d.searcher)).length === 0, Object.keys(searcherSpawnEnv(d.searcher)).join(","));
			check("env: a search key alone still reaches the script", searcherSpawnEnv({ ...d.searcher, searchApiKey: "only" }).STEPCODE_TOPO_SEARCH_KEY === "only");
			check("env: empty strings never become variables", Object.keys(searcherSpawnEnv({ searchUrl: "", searchApiKey: "", fetchUrl: "", fetchApiKey: "" })).length === 0);
			check("env: the script path rides along only when configured", searcherSpawnEnv(c1.searcher, "/pkg/bin/topo-search.mjs").STEPCODE_TOPO_SEARCH_SCRIPT === "/pkg/bin/topo-search.mjs" && !("STEPCODE_TOPO_SEARCH_SCRIPT" in searcherSpawnEnv(d.searcher, "/pkg/bin/topo-search.mjs")));

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE27 DONE (all passed)" : `SMOKE27 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE27 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}
