#!/usr/bin/env node
/**
 * topo-search — the searcher role's retrieval script.
 *
 * The `searcher` preset has `run_command` in its allowlist precisely so it can
 * call this script: the host ships no dedicated fetch tool, so a real fetch
 * capability has to live somewhere, and a script keeps it auditable (one place
 * to review what is sent where) instead of scattering curl invocations through
 * member contexts.
 *
 * Endpoints are DeepSeek's own (see docs/CONFIGURATION.md):
 *   POST {base}/v1/tools/search   body {query, count, need_content}
 *   POST {base}/v1/tools/fetch     body {url}  →  {title, content}
 * Bearer auth reuses the DeepSeek API key. Only SUCCESSFUL requests are billed
 * (a non-empty result list / a 200 with body), so this script never retries a
 * 4xx other than 429 — retrying a bad request would burn the user's quota for
 * nothing. Search and Fetch each allow 5 QPS, counted independently, and Fetch
 * has a per-domain cap on top; the client-side token bucket keeps us under the
 * first limit and the backoff respects the second.
 *
 * Usage:
 *   topo-search search --query "<q>" [--count 1-5] [--need-content] [--timeout-ms N]
 *   topo-search fetch  --url "<u>"   [--timeout-ms N]
 *   topo-search batch  --stdin-jsonl          # one {"kind":...} per line in, one result per line out
 *
 * stdout: exactly one JSON object per request. stderr: human progress, never a key.
 * Exit codes: 0 ok · 1 request failed · 2 usage error / missing key.
 *
 * Environment (all optional):
 *   STEPCODE_TOPO_SEARCH_URL / _FETCH_URL   endpoint; used VERBATIM when it
 *                                           already names one, suffix appended
 *                                           to a bare base. Empty = built-in
 *                                           default.
 *   STEPCODE_TOPO_SEARCH_KEY / _FETCH_KEY   Bearer credential. The search key is
 *                                           also accepted as
 *                                           STEPCODE_SEARCH_API_KEY (the name
 *                                           the leader injects it under), then
 *                                           DEEPSEEK_API_KEY.
 *   STEPCODE_TOPO_ATTEMPTS       max attempts per request (default 3).
 *   STEPCODE_TOPO_TIMEOUT_MS     per-request timeout (default 10000).
 *   STEPCODE_TOPO_QPS            token-bucket rate per kind (default 5).
 *   STEPCODE_TOPO_MAX_BYTES      response cap before truncation (default 2 MiB).
 *   STEPCODE_TOPO_BACKOFF_CAP_MS ceiling on the retry wait, in ms. 0 means "do
 *                                not wait at all". This changes only HOW LONG a
 *                                retry waits, never WHICH requests are retried,
 *                                so it is safe to set to 0 when probing the
 *                                retry path. Unset = the natural 2s/4s ladder.
 */

import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_BASE = "https://api.deepseek.com";
const DEFAULT_QPS = 5;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_ATTEMPTS = 3;

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

function env(name, fallback = "") {
	const v = process.env[name];
	return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

/**
 * The retry backoff for one attempt, capped by STEPCODE_TOPO_BACKOFF_CAP_MS.
 *
 * The cap is configurable because the fixed 2s/4s ladder is right for a real
 * provider but makes any caller that wants to probe the retry path wait seconds
 * per attempt. Capping it does not change WHICH requests are retried — the
 * billing-honest policy (429 and 5xx yes, other 4xx no) is untouched.
 */
function backoffMs(attempt, base, ceiling) {
	const natural = Math.min(base * 2 ** (attempt - 1), ceiling);
	const cap = envIntAllowZero("STEPCODE_TOPO_BACKOFF_CAP_MS", natural);
	return Math.max(0, Math.min(natural, cap));
}

function envInt(name, fallback) {
	const parsed = Number.parseInt(env(name), 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * An integer setting where 0 is a MEANINGFUL value, not "unset".
 *
 * `envInt` rejects 0 (it treats it as absent), which is right for caps like
 * maxAttempts but wrong for a backoff cap: `STEPCODE_TOPO_BACKOFF_CAP_MS=0`
 * means "do not wait at all", and falling back to the natural ladder would
 * silently ignore the one value a caller is most likely to set to zero.
 */
function envIntAllowZero(name, fallback) {
	const parsed = Number.parseInt(env(name), 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * The credential, in the order the plugin's config makes available:
 *   1. the per-kind key the leader injects from `[stepcodeAgentTeam.searcher]`
 *      (`STEPCODE_TOPO_SEARCH_KEY` / `STEPCODE_TOPO_FETCH_KEY`) — this is the
 *      documented, vendor-neutral path and the one the config file drives;
 *   2. `STEPCODE_SEARCH_API_KEY`, the other name the leader injects the same
 *      configured key under (it is the host search tool's own variable);
 *   3. `DEEPSEEK_API_KEY`, a convenience for the DEFAULT endpoint only. It is
 *      a fallback, never a requirement: point `searchUrl`/`fetchUrl` at any
 *      provider that speaks this script's JSON contract and set the matching
 *      key in the config instead.
 * The key is never printed, never written, and never reaches stdout.
 */
function resolveKey(kind) {
	const configured = kind === "fetch" ? env("STEPCODE_TOPO_FETCH_KEY") : env("STEPCODE_TOPO_SEARCH_KEY");
	// The leader injects the configured search key under BOTH names: the
	// script's own and the host search tool's. Accept either so the search
	// path is authenticated whenever the config carries a key, then fall back
	// to DEEPSEEK_API_KEY for the default endpoint.
	const searchAlias = kind === "fetch" ? "" : env("STEPCODE_SEARCH_API_KEY");
	return configured || searchAlias || env("DEEPSEEK_API_KEY");
}

/**
 * The URL to POST to.
 *
 * The configured URL is used **verbatim** when it already names the endpoint
 * (`https://api.deepseek.com/v1/tools/search`); a bare base
 * (`https://api.deepseek.com`) gets the suffix appended. Nothing is rewritten
 * in either case — appending a suffix to a URL that already carries it is what
 * produced `.../v1/tools/search/v1/tools/search` and a bare 404, which reads as
 * "the provider is down" rather than "the URL was wrong".
 */
function resolveEndpoint(kind) {
	const raw = env(kind === "fetch" ? "STEPCODE_TOPO_FETCH_URL" : "STEPCODE_TOPO_SEARCH_URL") || DEFAULT_BASE;
	const suffix = `/v1/tools/${kind}`;
	return raw.endsWith(suffix) ? raw : `${raw.replace(/\/+$/, "")}${suffix}`;
}

/** A minimal token bucket: `qps` tokens, refilled continuously. */
class RateLimiter {
	constructor(qps) {
		this.capacity = Math.max(1, qps);
		this.tokens = this.capacity;
		this.updated = Date.now();
	}
	async take() {
		for (;;) {
			const now = Date.now();
			this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updated) / 1000) * this.capacity);
			this.updated = now;
			if (this.tokens >= 1) {
				this.tokens -= 1;
				return;
			}
			const waitMs = Math.ceil(((1 - this.tokens) / this.capacity) * 1000);
			await delay(waitMs);
		}
	}
}

// Search and Fetch are rate-limited independently, so they get independent buckets.
const buckets = new Map();
function limiterFor(kind) {
	if (!buckets.has(kind)) buckets.set(kind, new RateLimiter(envInt("STEPCODE_TOPO_QPS", DEFAULT_QPS)));
	return buckets.get(kind);
}

function parseArgs(argv) {
	const args = { kind: null, query: "", url: "", count: 5, needContent: false, timeoutMs: null, batch: false };
	const positional = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "search" || a === "fetch") args.kind = a;
		else if (a === "batch") args.batch = true;
		else if (a === "--stdin-jsonl") args.batch = true;
		else if (a === "--query") args.query = argv[++i] ?? "";
		else if (a === "--url") args.url = argv[++i] ?? "";
		else if (a === "--count") args.count = Number.parseInt(argv[++i] ?? "", 10);
		else if (a === "--need-content") args.needContent = true;
		else if (a === "--timeout-ms") args.timeoutMs = Number.parseInt(argv[++i] ?? "", 10);
		else if (a.startsWith("--")) return { error: `unknown option: ${a}` };
		else positional.push(a);
	}
	if (!args.batch && !args.kind && positional.length > 0) args.kind = positional[0];
	if (!args.batch && !args.kind) return { error: "missing subcommand: search | fetch | batch" };
	return { args };
}

function validate(args) {
	if (args.batch) return null;
	if (args.kind === "search") {
		if (!args.query.trim()) return "search requires --query";
		// DeepSeek caps the query at 128 characters.
		if (args.query.length > 128) return `query is ${args.query.length} chars; DeepSeek allows 128`;
		if (!Number.isInteger(args.count) || args.count < 1 || args.count > 5) return "--count must be 1..5";
		return null;
	}
	if (args.kind === "fetch") {
		if (!args.url.trim()) return "fetch requires --url";
		let parsed;
		try {
			parsed = new URL(args.url);
		} catch {
			return "--url is not a valid URL";
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "--url must be http(s)";
		if (args.url.length > 8192) return "--url is longer than DeepSeek's 8192-char limit";
		return null;
	}
	return `unknown subcommand: ${args.kind}`;
}

/** One request, with the billing-honest retry policy. */
async function callApi(kind, payload, opts) {
	const key = resolveKey(kind);
	const endpoint = resolveEndpoint(kind);
	const meta = { endpoint: process.env[kind === "fetch" ? "STEPCODE_TOPO_FETCH_URL" : "STEPCODE_TOPO_SEARCH_URL"] ? "configured" : "default", attempts: 0, ms: 0, truncated: false };
	if (!key) {
		// A missing credential is the caller's setup problem, not a failed
		// request — it must not be mistaken for (or retried like) an API error.
		// Lead with the lever the user actually controls. The env names below
		// are what the leader injects automatically, so naming only those sent
		// people hunting for an export that the config file already does.
		return {
			ok: false,
			kind,
			fatal: true,
			error: `no API key for ${kind}: set ${kind === "fetch" ? "fetchApiKey" : "searchApiKey"} under [stepcodeAgentTeam.searcher] in the step config (the leader injects it for you), or export STEPCODE_TOPO_${kind === "fetch" ? "FETCH" : "SEARCH"}_KEY to run this script by hand`,
			retryable: false,
			meta,
		};
	}

	const timeoutMs = opts.timeoutMs ?? envInt("STEPCODE_TOPO_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
	const maxBytes = envInt("STEPCODE_TOPO_MAX_BYTES", DEFAULT_MAX_BYTES);
	const maxAttempts = envInt("STEPCODE_TOPO_ATTEMPTS", DEFAULT_ATTEMPTS);
	const started = Date.now();

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		meta.attempts = attempt;
		await limiterFor(kind).take();
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			process.stderr.write(`topo-search: ${kind} attempt ${attempt}/${maxAttempts} → ${endpoint}\n`);
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
			const raw = await res.text();
			meta.ms = Date.now() - started;

			if (res.status === 429) {
				// Rate-limited: the one 4xx worth retrying, because nothing was billed.
				if (attempt < maxAttempts) {
					const backoff = backoffMs(attempt, 2000, 8000) + Math.floor(performance.now() % 250);
					process.stderr.write(`topo-search: 429 rate-limited; backing off ${backoff}ms\n`);
					await delay(backoff);
					continue;
				}
				return { ok: false, kind, error: `rate-limited (429) after ${maxAttempts} attempts`, retryable: true, meta };
			}
			if (res.status >= 500) {
				if (attempt < maxAttempts) {
					const backoff = backoffMs(attempt, 500, 4000);
					process.stderr.write(`topo-search: ${res.status}; backing off ${backoff}ms\n`);
					await delay(backoff);
					continue;
				}
				return { ok: false, kind, error: `server error ${res.status} after ${maxAttempts} attempts`, retryable: true, meta };
			}
			if (!res.ok) {
				// Any other 4xx is a bad request: retrying it would bill the user for nothing.
				return { ok: false, kind, error: `HTTP ${res.status}: ${raw.slice(0, 300)}`, retryable: false, meta };
			}

			let body;
			try {
				body = JSON.parse(raw);
			} catch {
				return { ok: false, kind, error: "response was not valid JSON", retryable: false, meta };
			}
			let data = body;
			if (raw.length > maxBytes) {
				meta.truncated = true;
				data = { ...body, _truncated: true, _note: `body exceeded ${maxBytes} bytes` };
			}
			if (kind === "search") {
				const results = Array.isArray(body?.results) ? body.results : [];
				// A provider that answers with a different envelope must not look
				// like "no results" — that is how a mis-pointed endpoint wastes a
				// whole round before anyone notices. Surface the shape instead.
				if (!Array.isArray(body?.results)) {
					meta.shape = `unrecognised response envelope (keys: ${Object.keys(body ?? {}).join(", ") || "none"})`;
				}
				return { ok: true, kind, data: { results, needContent: Boolean(payload.need_content) }, meta };
			}
			return { ok: true, kind, data: { title: body?.title ?? "", content: body?.content ?? "" }, meta };
		} catch (err) {
			meta.ms = Date.now() - started;
			const aborted = err instanceof Error && err.name === "AbortError";
			const message = aborted ? `timeout after ${timeoutMs}ms` : err instanceof Error ? err.message : String(err);
			if (attempt < maxAttempts && (aborted || !(err instanceof Error && err.name === "AbortError"))) {
				const backoff = backoffMs(attempt, 500, 4000);
				process.stderr.write(`topo-search: ${message}; backing off ${backoff}ms\n`);
				await delay(backoff);
				continue;
			}
			return { ok: false, kind, error: message, retryable: aborted, meta };
		} finally {
			clearTimeout(timer);
		}
	}
	return { ok: false, kind, error: "unreachable", retryable: false, meta };
}

function payloadFor(args) {
	if (args.kind === "search") return { query: args.query, count: args.count, need_content: args.needContent };
	return { url: args.url };
}

async function readStdinLines() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return chunks
		.join("")
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	if (parsed.error) {
		process.stderr.write(`topo-search: ${parsed.error}\nusage: topo-search search --query <q> | fetch --url <u> | batch --stdin-jsonl\n`);
		process.exitCode = EXIT_USAGE;
		return;
	}
	const args = parsed.args;

	if (args.batch) {
		const lines = await readStdinLines();
		for (const line of lines) {
			let item;
			try {
				item = JSON.parse(line);
			} catch {
				process.stdout.write(`${JSON.stringify({ ok: false, error: "batch line was not valid JSON", retryable: false })}\n`);
				process.exitCode = EXIT_FAILED;
				continue;
			}
			const kind = item.kind === "fetch" ? "fetch" : "search";
			const problem = validate({ kind, query: item.query ?? "", url: item.url ?? "", count: item.count ?? 5 });
			if (problem) {
				process.stdout.write(`${JSON.stringify({ ok: false, kind, error: problem, retryable: false })}\n`);
				process.exitCode = EXIT_FAILED;
				continue;
			}
			const payload = kind === "search" ? { query: item.query, count: item.count ?? 5, need_content: Boolean(item.need_content) } : { url: item.url };
			const result = await callApi(kind, payload, { timeoutMs: item.timeout_ms ?? args.timeoutMs });
			process.stdout.write(`${JSON.stringify(result)}\n`);
			if (!result.ok) process.exitCode = result.fatal ? EXIT_USAGE : EXIT_FAILED;
		}
		return;
	}

	const problem = validate(args);
	if (problem) {
		process.stderr.write(`topo-search: ${problem}\n`);
		process.exitCode = EXIT_USAGE;
		return;
	}
	const result = await callApi(args.kind, payloadFor(args), { timeoutMs: args.timeoutMs });
	process.stdout.write(`${JSON.stringify(result)}\n`);
	process.exitCode = result.ok ? EXIT_OK : result.fatal ? EXIT_USAGE : EXIT_FAILED;
}

await main();
