/**
 * Phase 34 smoke probe (zero token cost, zero external network): the prompt to
 * settle path, end to end, against a LOCAL FAKE MODEL.
 *
 * This is the blind spot behind the recurring "timeout waiting for member to
 * settle" degradation. The chain, established from upstream source:
 *   - rpc-mode.ts acks a `prompt` from preflightResult, long before the run ends;
 *   - agent_settled is emitted only when an agent run actually finishes;
 *   - so a member that loads fine and passes preflight but never ENTERS a run
 *     produces no settle event at all, and the leader waits out its full timeout.
 * Every other probe stops at the handshake, and the live probes only send /topo
 * commands, so nothing in the gate ever walked this path — it needs a model
 * call, which used to mean paying for it.
 *
 * A local HTTP server speaking the OpenAI Chat Completions SSE contract removes
 * that cost: the member really enters an agent run, really calls "the model",
 * really finishes a turn, and really emits agent_settled — for free. The step
 * provider's API is `openai-completions` (step-provider/index.ts) and its base
 * is derived as `{apiBaseUrl}/v1`, so STEP_PROVIDER_API_URL decides where the
 * member's turns go, and members inherit the leader's environment through
 * memberSpawnEnv — no plugin change is needed to point one at a fake.
 *
 * Part A proves the happy path is covered. Part B reproduces the degradation
 * itself and proves the gate detects it: a fake endpoint that accepts the
 * request and never answers leaves the member inside a run that never ends, so
 * no settle arrives — and the diagnostic augmentation (zero usage delta) must
 * say so instead of implying the run was merely slow.
 */

import * as http from "node:http";
import * as fs from "node:fs";

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { configFilePath, resetConfigCache } from "../../extensions/config.ts";

/** One SSE chunk in the shape the openai-completions adapter parses. */
function sseChunk(content: string, finish: string | null, usage?: unknown): string {
	const chunk: Record<string, unknown> = {
		id: "cmpl-fake",
		object: "chat.completion.chunk",
		created: 0,
		model: "step-5-preview",
		choices: [{ index: 0, delta: content ? { role: "assistant", content } : {}, finish_reason: finish }],
	};
	if (usage) chunk.usage = usage;
	return `data: ${JSON.stringify(chunk)}\n\n`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke34]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		/** Requests the fake model actually received, in order. */
		const seen: Array<{ url: string; auth: boolean; body: string }> = [];
		/** When true the endpoint accepts the request and never answers it. */
		let hang = false;
		const server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (d: Buffer) => {
				body += d.toString();
			});
			req.on("end", () => {
				seen.push({ url: req.url ?? "", auth: Boolean(req.headers.authorization), body: body.slice(0, 400) });
				if ((req.url ?? "").includes("/models")) {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ object: "list", data: [{ id: "step-5-preview", object: "model", created: 0, owned_by: "step" }] }));
					return;
				}
				if (hang) {
					// Accepted, then silence: the member is inside a run that never ends.
					res.writeHead(200, { "content-type": "text/event-stream" });
					return;
				}
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				res.write(sseChunk("pong", null));
				res.write(sseChunk("", "stop", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
				res.write("data: [DONE]\n\n");
				res.end();
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
		const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		// A member that never answers holds its socket open, so close() alone
		// would wait forever on the hung connection from Part B.
		const shutdownFake = () => {
			server.close();
			(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
		};
		// The probe's own budget. The runner already reports a 240 s hang, but a
		// self-limit names the probe that blew it instead of leaving a bare
		// "timed out" with no idea which stage stalled.
		const selfBudget = setTimeout(() => {
			log("SMOKE34 FAILED: probe exceeded its own 100s budget");
			process.exit(1);
		}, 100_000);
		selfBudget.unref();

		// Members inherit the leader's environment (memberSpawnEnv spreads
		// process.env), so overriding these here routes the child's turns at the
		// fake endpoint. All three names are honoured by the step provider
		// resolver, in this priority order.
		const saved = ["STEP_PROVIDER_API_URL", "STEP_API_URL", "STEP_BASE_URL"].map((k) => [k, process.env[k]] as const);
		for (const [k] of saved) process.env[k] = base;

		const agentDir = process.env.STEP_CODING_AGENT_DIR;
		// The plugin's own JSON config, inside the runner's throwaway agentDir.
		// NOT the unified config.toml: that one lives at dirname(agentDir) —
		// /tmp/config.toml under the runner — and writing there would reach a
		// shared directory that is not ours to touch.
		const cfgFile = agentDir ? configFilePath(agentDir) : null;
		const savedCfg = cfgFile && fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : null;
		// dispatch.timeoutMs has no env override, and the leader's config is
		// cached at load time, so Part B needs a real config file plus a cache
		// reset. 1000 ms is the documented floor. Restored in the finally block
		// so no later phase in the same runner sees a shortened timeout.
		const shortenTimeout = () => {
			if (!cfgFile) return;
			// The legacy dedicated file holds the SECTION ITSELF at the top level
			// (applyFile merges `raw` straight into the config), unlike
			// settings.json whose section sits under the CONFIG_SECTION key.
			fs.writeFileSync(cfgFile, JSON.stringify({ dispatch: { timeoutMs: 1000 } }, null, 2));
			resetConfigCache();
		};
		const restoreCfg = () => {
			if (!cfgFile) return;
			if (savedCfg === null) fs.rmSync(cfgFile, { force: true });
			else fs.writeFileSync(cfgFile, savedCfg);
			resetConfigCache();
		};

		let manager: TeamManager | undefined;
		try {
			manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			// ---- Part A: a member pointed at a working fake model settles ----
			hang = false;
			seen.length = 0;
			const { member } = await manager.createMember({ name: "fauxchk" });
			const before = member.usage.turns;
			let settledText = "";
			let settleError = "";
			const t0 = Date.now();
			try {
				const res = await manager.sendMessage("fauxchk", "Reply with the single word: pong");
				settledText = res.text;
				check("dispatch: the member ran a turn and settled", true, `${Date.now() - t0}ms`);
				check("dispatch: the turn consumed usage (delta > 0)", res.usage.turns > before, `${before} -> ${res.usage.turns}`);
				check("dispatch: the member's text is the fake model's reply", res.text.trim() === "pong", JSON.stringify(res.text.slice(0, 80)));
			} catch (err) {
				settleError = err instanceof Error ? err.message : String(err);
				check("dispatch: the member ran a turn and settled", false, settleError);
			}
			const completions = seen.filter((s) => s.url.includes("/chat/completions"));
			check("dispatch: the member really called the model", completions.length >= 1, seen.map((s) => s.url).join(",") || "(none)");
			check("dispatch: the model call carried a credential", completions.length > 0 && completions[0].auth, String(completions[0]?.auth));
			check("dispatch: the request named the member's model", completions.length > 0 && completions[0].body.includes(`"model":"${member.model}"`), completions[0]?.body.slice(0, 120));

			// ---- Part B: the degradation, reproduced and detected ----
			// The fake endpoint accepts the chat request and never answers, so the
			// member sits inside a run that never ends. That is exactly the state
			// the 36 historical timeouts came from, and it must now be visible to
			// the gate rather than only to whoever pays for a live round.
			//
			// A FRESH member is required: requestTimeoutMs is baked into the RPC
			// object at spawn time, so reusing Part A's member would keep the
			// 600 s default and the probe would sit out the runner's 240 s limit.
			hang = true;
			seen.length = 0;
			shortenTimeout();
			await manager.createMember({ name: "fauxstuck" });
			let degradeError = "";
			const t1 = Date.now();
			try {
				await manager.sendMessage("fauxstuck", "Reply with the single word: pong");
				check("degradation: a member stuck inside a run never settles", false, "sendMessage resolved unexpectedly");
			} catch (err) {
				degradeError = err instanceof Error ? err.message : String(err);
				check("degradation: a member stuck inside a run never settles", true, `${Date.now() - t1}ms`);
			}
			check("degradation: it entered the run before going silent", seen.some((s) => s.url.includes("/chat/completions")), seen.map((s) => s.url).join(",") || "(none)");
			// The augmentation is the fix: a zero-delta timeout must name the
			// member's setup, not imply the run was slow. Without it the operator
			// re-dispatches into the same wall.
			check("degradation: the timeout is diagnosed as a stuck member, not a slow run",
				/usage delta 0/.test(degradeError) && /preflight/.test(degradeError) && /agent_settled/.test(degradeError),
				degradeError.slice(0, 200));
			check("degradation: the diagnosis warns that a respawn will likely repeat",
				/respawn/i.test(degradeError), degradeError.slice(0, 200));

			await manager.disband();
		} catch (err) {
			check("setup: the probe reached its dispatch stage", false, err instanceof Error ? err.message : String(err));
			try {
				await manager?.disband();
			} catch {
				/* best effort */
			}
		} finally {
			restoreCfg();
			for (const [k, v] of saved) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
			shutdownFake();
			clearTimeout(selfBudget);
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE34 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
