#!/usr/bin/env node
/**
 * Searcher live probe — REAL search and fetch, driven by the CONFIG FILE.
 *
 * This is the Layer-C probe for the searcher role: it costs money (every
 * successful call is billed by the provider), so it is deliberately NOT part of
 * the zero-token gate. The contract itself is covered hermetically by
 * test/smoke/phase28.ts against a local fake endpoint; what this probe adds is
 * the real thing — a real endpoint, a real credential, real result quality.
 *
 * The credential and the endpoints come from `[stepcodeAgentTeam.searcher]` in
 * the sandbox config (sandbox/config.toml), exactly as the plugin's config
 * loader resolves them for a team. This probe reads that table and passes the
 * values to the script through the same `STEPCODE_TOPO_*` variables the leader
 * injects into member processes — so the path under test is the path members
 * take, not a vendor-specific shortcut. Nothing here is tied to one provider:
 * point `searchUrl`/`fetchUrl` at any endpoint that speaks this script's JSON
 * contract and set the matching key.
 *
 * Cost: DeepSeek bills per SUCCESSFUL request (¥5 / 1000). This probe makes at
 * most 6 billable calls and says so before it starts; failures, empty results
 * and timeouts are not billed. Set TOPO_PROBE_MAX_CALLS=0 to dry-run the
 * configuration only.
 *
 * Usage:
 *   bash sandbox/with-test-key.sh node sandbox/probe-searcher.mjs
 *   node sandbox/probe-searcher.mjs            # key must already be configured
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const REPO = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(REPO, "bin", "topo-search.mjs");
const CONFIG_FILE = path.join(REPO, "sandbox", "config.toml");
const SECTION = "stepcodeAgentTeam.searcher";

/** Billable calls this probe can make, declared up front. */
const MAX_CALLS = 6;

// ---------------------------------------------------------------- config read

/**
 * Reads the `[stepcodeAgentTeam.searcher]` table out of the sandbox config.
 * Deliberately minimal: the table is four flat string keys, and pulling in a
 * TOML dependency for it would be absurd. Unknown shapes are reported, not
 * silently ignored.
 */
function readSearcherConfig(file) {
	if (!fs.existsSync(file)) return { found: false, values: {}, note: `no config file at ${file}` };
	const text = fs.readFileSync(file, "utf8");
	const lines = text.split("\n");
	let inSection = false;
	const values = {};
	for (const raw of lines) {
		const line = raw.trim();
		if (line.startsWith("[") && line.endsWith("]")) {
			inSection = line.slice(1, -1) === SECTION;
			continue;
		}
		if (!inSection || !line || line.startsWith("#")) continue;
		const m = /^([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (!m) continue;
		const key = m[1];
		let value = m[2].trim();
		// strip an inline comment and surrounding quotes
		value = value.replace(/\s+#.*$/, "").trim();
		if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
		values[key] = value;
	}
	const known = ["searchUrl", "searchApiKey", "fetchUrl", "fetchApiKey"];
	const unknown = Object.keys(values).filter((k) => !known.includes(k));
	return { found: known.some((k) => k in values), values, note: unknown.length ? `unknown keys ignored: ${unknown.join(", ")}` : "" };
}

/** Mirrors what the leader injects into member processes (members.ts). */
function envFromConfig(values) {
	const env = {};
	if (values.searchUrl) env.STEPCODE_TOPO_SEARCH_URL = values.searchUrl;
	if (values.searchApiKey) env.STEPCODE_TOPO_SEARCH_KEY = values.searchApiKey;
	if (values.fetchUrl) env.STEPCODE_TOPO_FETCH_URL = values.fetchUrl;
	if (values.fetchApiKey) env.STEPCODE_TOPO_FETCH_KEY = values.fetchApiKey;
	return env;
}

// ------------------------------------------------------------------ run helper

function nodeBin() {
	if (process.env.STEPCODE_NODE_BIN) return process.env.STEPCODE_NODE_BIN;
	for (const candidate of ["node", "/usr/bin/node", "/usr/local/bin/node"]) {
		const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
		if (probe.status === 0) return candidate;
	}
	return "node";
}

/** One script invocation; never throws, always resolves with the parsed JSON. */
function callScript(args, env, input) {
	return new Promise((resolve) => {
		const child = spawn(nodeBin(), [SCRIPT, ...args], {
			cwd: REPO,
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (code) => {
			const lines = stdout.trim().split("\n").filter(Boolean);
			let parsed = null;
			try {
				parsed = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
			} catch {
				parsed = { ok: false, error: `unparseable stdout: ${stdout.slice(0, 200)}` };
			}
			resolve({ code, parsed, stdout, stderr });
		});
		child.on("error", (err) => resolve({ code: -1, parsed: { ok: false, error: String(err) }, stdout, stderr }));
		child.stdin.end(input ?? "");
	});
}

// ----------------------------------------------------------------------- main

const results = [];
const check = (name, ok, detail = "") => {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
};

const cfg = readSearcherConfig(CONFIG_FILE);
const injected = envFromConfig(cfg.values);
const hasSearchKey = Boolean(injected.STEPCODE_TOPO_SEARCH_KEY || process.env.DEEPSEEK_API_KEY);
const hasFetchKey = Boolean(injected.STEPCODE_TOPO_FETCH_KEY || process.env.DEEPSEEK_API_KEY);
const searchUrl = injected.STEPCODE_TOPO_SEARCH_URL ?? "";
const fetchUrl = injected.STEPCODE_TOPO_FETCH_URL ?? "";

console.log(`# searcher live probe — config: ${CONFIG_FILE}`);
console.log(`#   [${SECTION}] ${cfg.found ? "found" : "NOT found"}${cfg.note ? ` (${cfg.note})` : ""}`);
console.log(`#   search endpoint: ${searchUrl || "(default)"}`);
console.log(`#   fetch  endpoint: ${fetchUrl || "(default)"}`);
console.log(`#   search key: ${hasSearchKey ? "configured" : "MISSING"} · fetch key: ${hasFetchKey ? "configured" : "MISSING"}`);
console.log(`#   billable calls this run may make: ${MAX_CALLS}`);

if (!hasSearchKey || !hasFetchKey) {
	console.error("");
	console.error("No searcher credential configured. Add it to the sandbox config (gitignored):");
	console.error("");
	console.error(`  # ${CONFIG_FILE}`);
	console.error("  [stepcodeAgentTeam.searcher]");
	console.error('  searchUrl = "https://api.deepseek.com"     # or any provider speaking this contract');
	console.error('  searchApiKey = "<your key>"');
	console.error('  fetchUrl = "https://api.deepseek.com"');
	console.error('  fetchApiKey = "<your key>"');
	console.error("");
	console.error("Or export DEEPSEEK_API_KEY to use the default endpoints. No calls were made (nothing is billed).");
	process.exitCode = 2;
} else if (process.env.TOPO_PROBE_MAX_CALLS === "0") {
	console.log("# dry run (TOPO_PROBE_MAX_CALLS=0): configuration only, no calls made.");
	process.exitCode = 0;
} else {
	// A stable query whose results a human can eyeball: this project's own repo.
	const SEARCH_QUERY = "site:github.com CTCingithub Step-Code-Agent-Team";
	// Two fetches: a page that is always up, and this project's own README, so
	// the content assertion means something.
	const FETCH_STABLE = "https://example.com";
	const FETCH_REPO = "https://raw.githubusercontent.com/CTCingithub/Step-Code-Agent-Team/main/README.md";

	// ---- 1. search ----
	const s1 = await callScript(["search", "--query", SEARCH_QUERY, "--count", "3"], injected);
	check("search: ok:true", s1.parsed?.ok === true, s1.parsed?.error ?? "");
	check("search: endpoint recorded as configured", s1.parsed?.meta?.endpoint === "configured");
	const r1 = s1.parsed?.data?.results ?? [];
	check("search: non-empty results", Array.isArray(r1) && r1.length > 0, `count=${r1.length}${s1.parsed?.meta?.shape ? ` · ${s1.parsed.meta.shape}` : ""}`);
	check("search: each result carries a url", r1.length > 0 && r1.every((r) => typeof r?.url === "string" && r.url.length > 0), JSON.stringify(r1[0] ?? {}).slice(0, 120));
	console.log(`  ↳ top hits: ${r1.slice(0, 3).map((r) => `${r.title ?? "(no title)"} <${r.url}>`).join(" | ") || "(none)"}`);

	// ---- 2. search with need_content ----
	const s2 = await callScript(["search", "--query", SEARCH_QUERY, "--count", "2", "--need-content"], injected);
	check("search --need-content: ok:true", s2.parsed?.ok === true, s2.parsed?.error ?? "");
	const r2 = s2.parsed?.data?.results ?? [];
	check("search --need-content: results carry a body", r2.length > 0 && r2.some((r) => typeof (r.content ?? r.snippet ?? r.text) === "string" && (r.content ?? r.snippet ?? r.text).length > 40), JSON.stringify(Object.keys(r2[0] ?? {})).slice(0, 160));

	// ---- 3. fetch a page that is always up ----
	const f1 = await callScript(["fetch", "--url", FETCH_STABLE], injected);
	check("fetch: ok:true", f1.parsed?.ok === true, f1.parsed?.error ?? "");
	check("fetch: returns a title", typeof f1.parsed?.data?.title === "string" && f1.parsed.data.title.length > 0, JSON.stringify(f1.parsed?.data?.title ?? "").slice(0, 120));
	check("fetch: returns markdown content", typeof f1.parsed?.data?.content === "string" && f1.parsed.data.content.length > 20, `len=${f1.parsed?.data?.content?.length ?? 0}`);

	// ---- 4. fetch real project content and assert on it ----
	const f2 = await callScript(["fetch", "--url", FETCH_REPO], injected);
	check("fetch (repo README): ok:true", f2.parsed?.ok === true, f2.parsed?.error ?? "");
	check("fetch (repo README): content mentions this project", typeof f2.parsed?.data?.content === "string" && /Topology Agent Team/.test(f2.parsed.data.content), `len=${f2.parsed?.data?.content?.length ?? 0}`);

	// ---- 5. batch: the fan-out path the role actually uses ----
	const batchInput = `${JSON.stringify({ kind: "search", query: "DeepSeek search fetch api", count: 2 })}\n${JSON.stringify({ kind: "search", query: "site:github.com CTCingithub", count: 2 })}\n`;
	const b1 = await callScript(["batch", "--stdin-jsonl"], injected, batchInput);
	const bLines = b1.stdout.trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { ok: false, error: "unparseable" }; } });
	check("batch: one result line per input line", bLines.length === 2, `lines=${bLines.length}`);
	check("batch: both succeed", bLines.every((r) => r?.ok === true), bLines.map((r) => r?.error ?? "ok").join(" | "));

	const failed = results.filter((r) => !r.ok).length;
	console.log(`# ${failed === 0 ? "ALL PASSED" : `${failed}/${results.length} FAILED`} — billable calls made: at most ${MAX_CALLS}`);
	process.exitCode = failed === 0 ? 0 : 1;
}
