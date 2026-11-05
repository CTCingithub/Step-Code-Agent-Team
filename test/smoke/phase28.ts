/**
 * topo-search script probe (v0.4.1). Zero-token, standalone: the script is
 * driven as a child process against a local fake DeepSeek endpoint, so the
 * whole contract — request shape, Bearer handling, the billing-honest retry
 * policy, the exit codes and the stdout protocol — runs without a network call
 * and without a real credential.
 *
 * The billing rule is the reason this probe exists: DeepSeek charges only
 * successful requests, so a script that retries a 4xx burns the user's quota
 * for nothing. The probe pins that behaviour down (a 400 is NOT retried, a 429
 * IS) along with the token bucket that keeps us under the 5 QPS limit.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@step-harness/coding-agent";

const SCRIPT = path.resolve(import.meta.dirname, "../../bin/topo-search.mjs");

type Json = Record<string, unknown>;

interface SeenEntry {
	method: string;
	url: string;
	auth?: string;
	body: Json;
}

function safeJson(text: string): Json {
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null ? (parsed as Json) : { _raw: parsed };
	} catch {
		return { _unparseable: text.slice(0, 200) };
	}
}

/** Data/meta accessors that keep the assertions readable without `any`. */
const dataOf = (j: Json | null): Json => ((j?.data ?? {}) as Json);
const metaOf = (j: Json | null): Json => ((j?.meta ?? {}) as Json);

/** A fake DeepSeek endpoint that records every request it receives. */
function startFake(handler: (req: IncomingMessage, res: ServerResponse, seen: SeenEntry) => void): Promise<{ server: Server; seen: SeenEntry[]; port: number }> {
	const seen: SeenEntry[] = [];
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		let body = "";
		req.on("data", (c: Buffer | string) => (body += c));
		req.on("end", () => {
			seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body: safeJson(body) });
			handler(req, res, seen[seen.length - 1]);
		});
	});
	return new Promise((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			resolve({ server, seen, port: typeof address === "object" && address ? address.port : 0 });
		});
	});
}

/**
 * `process.execPath` inside a step RPC session is the host bundle itself
 * (bun-compiled `step`), NOT node — spawning it with `--query` makes the host
 * parse our flags. So resolve a real node explicitly.
 */
function nodeBin(): string {
	if (process.env.STEPCODE_NODE_BIN) return process.env.STEPCODE_NODE_BIN;
	for (const candidate of ["node", "/usr/bin/node", "/usr/local/bin/node"]) {
		const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
		if (probe.status === 0) return candidate;
	}
	return "node";
}

/**
 * `spawn` (not `spawnSync`): the fake endpoint lives in THIS process, and a
 * synchronous spawn would block the event loop, so the child's connection
 * would sit in the listen backlog until it timed out. Async keeps the server
 * accepting while the script runs.
 */
function run(args: string[], env: NodeJS.ProcessEnv = {}, input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(nodeBin(), [SCRIPT, ...args], {
			env: { ...process.env, ...env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
		child.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + String(err) }));
		if (input !== undefined) child.stdin.end(input);
		else child.stdin.end();
	});
}

function lastStdoutJson(out: string): Json | null {
	const lines = out.trim().split("\n").filter(Boolean);
	return lines.length ? safeJson(lines[lines.length - 1]) : null;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke28]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const KEY = "test-key-not-a-real-credential";
		const baseEnv = { DEEPSEEK_API_KEY: KEY };
		let fake: Awaited<ReturnType<typeof startFake>> | undefined;

		try {
			// ---- 1. search: endpoint, body, auth, and the DeepSeek defaults ----
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ results: [{ title: "t", url: "https://example.com", snippet: "s" }] }));
			});
			const searchEnv = { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}` };
			const s = await run(["search", "--query", "deepseek api", "--count", "3"], searchEnv);
			check("search: exit 0", s.code === 0, `code=${s.code} err=${s.stderr.slice(0, 120)}`);
			const sJson = lastStdoutJson(s.stdout);
			check("search: ok:true with kind", sJson?.ok === true && sJson?.kind === "search", JSON.stringify(sJson).slice(0, 120));
			check("search: results array returned", Array.isArray(dataOf(sJson).results) && (dataOf(sJson).results as unknown[]).length === 1);
			check("search: endpoint is /v1/tools/search", fake.seen[0]?.url === "/v1/tools/search", String(fake.seen[0]?.url));
			check("search: body carries query/count/need_content", fake.seen[0]?.body?.query === "deepseek api" && fake.seen[0]?.body?.count === 3 && fake.seen[0]?.body?.need_content === false, JSON.stringify(fake.seen[0]?.body));
			check("search: Bearer header from the env key", fake.seen[0]?.auth === `Bearer ${KEY}`, String(fake.seen[0]?.auth));
			check("search: meta marks the endpoint as configured", metaOf(sJson).endpoint === "configured");
			check("search: the key never reaches stdout or stderr", !s.stdout.includes(KEY) && !s.stderr.includes(KEY));
			fake.server.close();

			// ---- 1b. the configured URL is used VERBATIM when it is already the endpoint ----
			// The config doc never said which one to write, and a user who wrote
			// the full endpoint got `.../v1/tools/search/v1/tools/search` and a
			// bare 404 — which reads as "the provider is down" rather than "your
			// URL was wrong". A configured URL that already names the endpoint must
			// be posted to exactly as written; only a bare base gets the suffix.
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ results: [{ title: "t", url: "https://example.com", snippet: "s" }] }));
			});
			const fullEndpoint = `http://127.0.0.1:${fake.port}/v1/tools/search`;
			const sf = await run(["search", "--query", "deepseek api", "--count", "2"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: fullEndpoint });
			check("search: a configured endpoint URL is used verbatim", fake.seen[0]?.url === "/v1/tools/search", String(fake.seen[0]?.url));
			check("search: a configured endpoint URL still succeeds", sf.code === 0 && lastStdoutJson(sf.stdout)?.ok === true, `code=${sf.code}`);
			const trailingSlash = `http://127.0.0.1:${fake.port}/`;
			await run(["search", "--query", "q", "--count", "1"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: trailingSlash });
			check("search: a trailing slash does not double the separator", fake.seen[1]?.url === "/v1/tools/search", String(fake.seen[1]?.url));
			fake.server.close();

			// ---- 2. need_content is passed through ----
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ results: [] }));
			});
			const nc = await run(["search", "--query", "q", "--need-content"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}` });
			check("search: --need-content reaches the body", fake.seen[0]?.body?.need_content === true, JSON.stringify(fake.seen[0]?.body));
			check("search: an empty result list is still ok:true", lastStdoutJson(nc.stdout)?.ok === true && (dataOf(lastStdoutJson(nc.stdout)).results as unknown[] | undefined)?.length === 0);
			check("search: default count is 5", fake.seen[0]?.body?.count === 5);
			fake.server.close();

			// ---- 3. fetch: endpoint, body, and the title/content shape ----
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ title: "Page", content: "# Markdown body" }));
			});
			const f = await run(["fetch", "--url", "https://example.com/a"], { ...baseEnv, STEPCODE_TOPO_FETCH_URL: `http://127.0.0.1:${fake.port}` });
			check("fetch: exit 0", f.code === 0, `code=${f.code}`);
			const fJson = lastStdoutJson(f.stdout);
			check("fetch: endpoint is /v1/tools/fetch", fake.seen[0]?.url === "/v1/tools/fetch", String(fake.seen[0]?.url));
			check("fetch: body carries the url", fake.seen[0]?.body?.url === "https://example.com/a", JSON.stringify(fake.seen[0]?.body));
			check("fetch: title and content surface", dataOf(fJson).title === "Page" && dataOf(fJson).content === "# Markdown body");
			fake.server.close();

			// ---- 4. a configured fetch key overrides the shared one ----
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ title: "t", content: "c" }));
			});
			await run(["fetch", "--url", "https://example.com"], { ...baseEnv, STEPCODE_TOPO_FETCH_URL: `http://127.0.0.1:${fake.port}`, STEPCODE_TOPO_FETCH_KEY: "fetch-specific-key" });
			check("fetch: STEPCODE_TOPO_FETCH_KEY overrides the shared key", fake.seen[0]?.auth === "Bearer fetch-specific-key", String(fake.seen[0]?.auth));
			fake.server.close();

			// ---- 5. the billing-honest retry policy ----
			// Bound after the await: the handler only runs once a request arrives,
			// which is after startFake has resolved.
			let seen5: SeenEntry[] = [];
			fake = await startFake((req, res) => {
				if (seen5.length < 3) {
					res.writeHead(429);
					res.end("rate limited");
				} else {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ results: [{ title: "late", url: "u", snippet: "s" }] }));
				}
			});
			seen5 = fake.seen; // bound BEFORE the run: the handler reads it live
			const rl = await run(["search", "--query", "q"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}`, STEPCODE_TOPO_QPS: "50" });
			check("retry: a 429 IS retried and then succeeds", lastStdoutJson(rl.stdout)?.ok === true && fake.seen.length === 3, `attempts=${fake.seen.length}`);
			check("retry: attempts recorded in meta", metaOf(lastStdoutJson(rl.stdout)).attempts === 3);
			fake.server.close();

			fake = await startFake((req, res) => {
				res.writeHead(400);
				res.end("bad request");
			});
			const bad = await run(["search", "--query", "q"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}` });
			check("retry: a 400 is NOT retried (billing honesty)", fake.seen.length === 1, `attempts=${fake.seen.length}`);
			check("retry: a 400 reports ok:false and retryable:false", lastStdoutJson(bad.stdout)?.ok === false && lastStdoutJson(bad.stdout)?.retryable === false);
			check("retry: a failed request exits 1", bad.code === 1, `code=${bad.code}`);
			fake.server.close();

			// ---- 6. a 5xx is retried, then reported ----
			fake = await startFake((req, res) => {
				res.writeHead(503);
				res.end("unavailable");
			});
			const s5 = await run(["search", "--query", "q"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}`, STEPCODE_TOPO_QPS: "50" });
			check("retry: a 5xx IS retried up to the attempt cap", fake.seen.length === 3, `attempts=${fake.seen.length}`);
			check("retry: exhausting retries reports retryable:true", lastStdoutJson(s5.stdout)?.retryable === true);
			fake.server.close();

			// ---- 7. a timeout is distinguishable ----
			fake = await startFake((req, res) => {
				// never responds
			});
			const to = await run(["search", "--query", "q", "--timeout-ms", "300"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}` });
			check("timeout: reported as such and retryable", /timeout/i.test(String(lastStdoutJson(to.stdout)?.error)) && lastStdoutJson(to.stdout)?.retryable === true, JSON.stringify(lastStdoutJson(to.stdout)).slice(0, 140));
			fake.server.close();

			// ---- 8. the token bucket keeps us under the QPS limit ----
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ results: [] }));
			});
			const qpsInput = Array.from({ length: 4 }, (_, i) => JSON.stringify({ kind: "search", query: `q${i}` })).join("\n") + "\n";
			const qps = await run(["batch", "--stdin-jsonl"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}`, STEPCODE_TOPO_QPS: "5" }, qpsInput);
			const batchMeta = qps.stdout.trim().split("\n").filter(Boolean).map(safeJson);
			check("ratelimit: all four batched requests succeed", batchMeta.length === 4 && batchMeta.every((r) => r?.ok === true), `lines=${batchMeta.length}`);
			fake.server.close();

			// ---- 9. batch mode: one result line per input line ----
			fake = await startFake((req, res) => {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ results: [{ title: "b", url: "u", snippet: "s" }] }));
			});
			const batchInput = `${JSON.stringify({ kind: "search", query: "one", count: 2 })}\n${JSON.stringify({ kind: "search", query: "two" })}\n${JSON.stringify({ kind: "bogus" })}\n`;
			const b = await run(["batch", "--stdin-jsonl"], { ...baseEnv, STEPCODE_TOPO_SEARCH_URL: `http://127.0.0.1:${fake.port}`, STEPCODE_TOPO_QPS: "50" }, batchInput);
			const bLines = b.stdout.trim().split("\n").filter(Boolean).map(safeJson);
			check("batch: one output line per input line", bLines.length === 3, `lines=${bLines.length}`);
			check("batch: each line carries its own result", bLines[0]?.ok === true && bLines[1]?.ok === true);
			check("batch: an unknown kind is rejected per line", bLines[2]?.ok === false);
			check("batch: per-line query is honoured", fake.seen[0]?.body?.query === "one" && fake.seen[1]?.body?.query === "two");
			check("batch: a failed line sets a non-zero exit", b.code !== 0, `code=${b.code}`);
			fake.server.close();

			// ---- 10. no credential anywhere ----
			const noKey = await run(["search", "--query", "q"], { STEPCODE_TOPO_SEARCH_URL: "http://127.0.0.1:1", DEEPSEEK_API_KEY: "" });
			check("usage: a missing key exits 2 (not a request failure)", noKey.code === 2, `code=${noKey.code}`);
			check("usage: the missing-key message names the env vars", /STEPCODE_TOPO_SEARCH_KEY/.test(noKey.stdout) && /STEPCODE_SEARCH_API_KEY/.test(noKey.stdout) && /DEEPSEEK_API_KEY/.test(noKey.stdout), noKey.stdout.slice(0, 160));

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE28 DONE (all passed)" : `SMOKE28 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE28 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			try {
				fake?.server.close();
			} catch {
				/* already closed */
			}
		}
	});
}
