/**
 * Phase 35 smoke probe (zero token cost): a MULTI-ROUND turn settles.
 *
 * The degradation's signature was "short turns settle, long turns never do",
 * and the suspicion fell on tool calls. It should not have: this probe drives a
 * member through a turn that calls a tool and then answers, and it settles.
 * The fake model answers the first request with a tool call and the second with
 * the final text, which forces the agent loop through a second model round.
 *
 * Keeping this as a gate probe means a regression in the tool-call or
 * multi-round path — the two things a "long turn" is made of — fails here
 * instead of surfacing as an unexplained settle timeout in a live round.
 *
 * A counter subtlety worth remembering: the fake endpoint also serves the
 * /v1/models discovery requests, so the branches must key on a counter of
 * CHAT requests only. Keying on total requests made the first (and only) chat
 * request take the "final answer" branch, and the probe silently tested
 * nothing.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { configFilePath, resetConfigCache } from "../../extensions/config.ts";

function sse(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke35]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		/** Model rounds only. /v1/models discovery is not a round. */
		let chatRounds = 0;
		/** Bodies of the chat requests, so the second round can be inspected. */
		const bodies: string[] = [];
		const server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (d: Buffer) => {
				body += d.toString();
			});
			req.on("end", () => {
				if ((req.url ?? "").includes("/models")) {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ object: "list", data: [{ id: "step-5-preview", object: "model", created: 0, owned_by: "step" }] }));
					return;
				}
				chatRounds += 1;
				bodies.push(body);
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				const base = { id: "cmpl-fake", object: "chat.completion.chunk", created: 0, model: "step-5-preview" };
				if (chatRounds === 1) {
					// Round one: ask for a tool call, which the agent must execute
					// before it can answer.
					res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_fake_1", type: "function", function: { name: "bash", arguments: "{\"command\":\"echo toolturn-ok\"}" } }] }, finish_reason: "tool_calls" }] }));
				} else {
					res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }] }));
					res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
				}
				res.write("data: [DONE]\n\n");
				res.end();
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
		const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		const saved = ["STEP_PROVIDER_API_URL", "STEP_API_URL", "STEP_BASE_URL"].map((k) => [k, process.env[k]] as const);
		for (const [k] of saved) process.env[k] = base;

		const agentDir = process.env.STEP_CODING_AGENT_DIR;
		const cfgFile = agentDir ? configFilePath(agentDir) : null;
		const savedCfg = cfgFile && fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : null;

		let manager: TeamManager | undefined;
		try {
			manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			// dispatch.timeoutMs has no env override and the config is cached at
			// load time, so a real file plus a cache reset is the only way to
			// bound this. 45s is far above a two-round turn and well below the
			// runner's 240s, so a hang reports as a settle failure, not a bare
			// timeout. The legacy file holds the section at the TOP level.
			if (cfgFile) {
				fs.writeFileSync(cfgFile, JSON.stringify({ dispatch: { timeoutMs: 45_000 } }));
				resetConfigCache();
			}
			const { member } = await manager.createMember({ name: "toolturn" });
			let text = "";
			let error = "";
			const t0 = Date.now();
			try {
				const res = await manager.sendMessage("toolturn", "Run `echo toolturn-ok` with the bash tool, then reply with the single word: done");
				text = res.text;
				check("multi-round: the turn settled", true, `${Date.now() - t0}ms`);
				check("multi-round: more than one model round ran", res.usage.turns >= 2, `turns=${res.usage.turns}`);
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
				check("multi-round: the turn settled", false, error);
			}
			check("multi-round: the fake model was asked twice", chatRounds >= 2, `rounds=${chatRounds}`);
			// The tool call is only real if its result came back to the model:
			// the second request must carry the tool output in its messages.
			check("multi-round: the tool result reached the second round",
				bodies.length >= 2 && bodies[1].includes("toolturn-ok"),
				bodies.length >= 2 ? bodies[1].slice(0, 160) : `rounds=${chatRounds}`);
			check("multi-round: the member's text is the final reply", text.trim() === "done", JSON.stringify(text.slice(0, 80)));
			await manager.disband();
		} catch (err) {
			check("setup: the probe reached its dispatch stage", false, err instanceof Error ? err.message : String(err));
			try {
				await manager?.disband();
			} catch {
				/* best effort */
			}
		} finally {
			if (cfgFile) {
				if (savedCfg === null) fs.rmSync(cfgFile, { force: true });
				else fs.writeFileSync(cfgFile, savedCfg);
				resetConfigCache();
			}
			for (const [k, v] of saved) {
				if (v === undefined) delete process.env[k];
				else process.env[k] = v;
			}
			server.close();
			(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE35 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
