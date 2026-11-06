/**
 * Phase 38 smoke probe (zero token cost): a member turn that produces NO text
 * still settles, and the leader side frames it as a delivery acknowledgement.
 *
 * P2-8b was listed as deferred for years because it "needs a live member turn
 * that produces an empty reply". Its unit half was already covered (phase16
 * asserts empty / whitespace / the host's "No result provided" placeholder all
 * yield `Delivered to X.`), but nothing drove the socket end to end — and the
 * reason it stayed deferred is that a real empty reply costs a model call. A
 * local fake model removes that: it answers with an assistant message carrying
 * no text at all, which is precisely the state a live empty reply leaves behind.
 *
 * Two things must hold, and they are different failures:
 *   1. the run still settles — an empty turn is a completed turn, not a hang;
 *   2. the leader-side framing turns the emptiness into an explicit ack, so a
 *      ring pass-along does not break quietly on a silent result.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { formatTeammateReply } from "../../extensions/member-messaging.ts";
import { configFilePath, resetConfigCache } from "../../extensions/config.ts";

function sse(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke38]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		let chatRounds = 0;
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
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
				const base = { id: "cmpl-fake", object: "chat.completion.chunk", created: 0, model: "step-5-preview" };
				// No content delta at all — the assistant message ends with nothing
				// to say. This is the state a live empty reply leaves behind, and
				// the reason rpc-client.ts only captures non-empty text.
				res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
				res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
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
			if (cfgFile) {
				fs.writeFileSync(cfgFile, JSON.stringify({ dispatch: { timeoutMs: 45_000 } }));
				resetConfigCache();
			}
			const { member } = await manager.createMember({ name: "quietone" });
			let text = "";
			let error = "";
			const t0 = Date.now();
			try {
				const res = await manager.sendMessage("quietone", "Reply with nothing at all.");
				text = res.text;
				check("empty reply: the turn still settles", true, `${Date.now() - t0}ms`);
				check("empty reply: the model really was asked", chatRounds >= 1, `rounds=${chatRounds}`);
				check("empty reply: no assistant text came back", text.trim() === "", JSON.stringify(text.slice(0, 80)));
				check("empty reply: the run is still counted (a turn happened)", res.usage.turns >= 1, `turns=${res.usage.turns}`);
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
				check("empty reply: the turn still settles", false, error);
			}
			// The leader-side consequence, which is the point of P2-8b: emptiness
			// must become an explicit acknowledgement, not a silent empty result.
			const framed = formatTeammateReply("quietone", text);
			check("empty reply: the leader side frames it as a delivery ack",
				/^Delivered to quietone\./.test(framed), framed.slice(0, 120));
			check("empty reply: the ack forbids a resend", framed.includes("do not resend"), framed.slice(0, 160));
			check("empty reply: the host placeholder is framed the same way",
				/^Delivered to quietone\./.test(formatTeammateReply("quietone", "No result provided")), "");
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
			log(`SMOKE38 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
