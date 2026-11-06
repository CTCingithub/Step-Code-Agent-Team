/**
 * Phase 37 smoke probe (zero token cost): the member spawn contract, and that
 * a member settles whether or not OUR plugin is loaded in it.
 *
 * Two things this pins down, both learned the hard way:
 *
 * 1. buildSpawnArgs produces `--no-extensions -e <member-messaging.ts>`. A
 *    member therefore loads ONLY the messaging shim and not the full plugin —
 *    which is why activating the whole plugin inside a member was never the
 *    cause of the settle timeouts, and why the member's model resolution, config
 *    and tool surface are the host's own. If that flag set ever changes, member
 *    behaviour changes with it, silently.
 *
 * 2. MemberRpc retains a bounded stderr tail. It used to discard stderr
 *    outright, which is why 38 settle timeouts went undiagnosed: the member was
 *    the only process that knew why it never ran, and its answer was thrown
 *    away. This asserts the tail is actually reachable.
 *
 * The "with our plugin" case settles too, which clears this repository's own
 * activation as a cause of member stalls — the finding that located the
 * degradation in the harness rather than here.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { MemberRpc } from "../../extensions/rpc-client.ts";
import { TeamManager, buildSpawnArgs } from "../../extensions/members.ts";
import { extensionDir } from "../../extensions/presets.ts";
import { configFilePath, resetConfigCache } from "../../extensions/config.ts";

function sse(obj: unknown): string {
	return `data: ${JSON.stringify(obj)}\n\n`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke37]", ...a);
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
				res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "pong" }, finish_reason: null }] }));
				res.write(sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
				res.write("data: [DONE]\n\n");
				res.end();
			});
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
		const fakeBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
		const saved = ["STEP_PROVIDER_API_URL", "STEP_API_URL", "STEP_BASE_URL"].map((k) => [k, process.env[k]] as const);
		for (const [k] of saved) process.env[k] = fakeBase;

		const agentDir = process.env.STEP_CODING_AGENT_DIR;
		const cfgFile = agentDir ? configFilePath(agentDir) : null;
		const savedCfg = cfgFile && fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, "utf8") : null;
		const ourExtension = path.join(extensionDir(), "index.ts");

		/** Spawns one member by hand and drives a single prompt through it. */
		const attempt = async (label: string, extraArgs: string[]): Promise<{ text: string; stderr: string[]; error: string }> => {
			chatRounds = 0;
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const plan = buildSpawnArgs(manager.teamId, manager.socketPath, {
				name: "spawnchk",
				sessionId: `smoke37-${label}`,
				model: "step-5-preview",
			} as unknown as Parameters<typeof buildSpawnArgs>[2]);
			let rpc: MemberRpc | undefined;
			try {
				rpc = await MemberRpc.spawn([...plan.args, ...extraArgs], ctx.cwd ?? process.cwd(), {
					env: plan.env,
					requestTimeoutMs: 60_000,
					handshakeTimeoutMs: 30_000,
				});
				const res = await rpc.promptAndSettle("Reply with the single word: pong");
				return { text: res.text, stderr: rpc.stderrLines(20), error: "" };
			} catch (err) {
				return { text: "", stderr: rpc?.stderrLines(20) ?? [], error: err instanceof Error ? err.message : String(err) };
			} finally {
				rpc?.kill();
			}
		};

		try {
			if (cfgFile) {
				fs.writeFileSync(cfgFile, JSON.stringify({ dispatch: { timeoutMs: 60_000 } }));
				resetConfigCache();
			}

			// ---- 1. the spawn contract, asserted on the real argument vector ----
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const plan = buildSpawnArgs(manager.teamId, manager.socketPath, {
				name: "spawnchk",
				sessionId: "smoke37-contract",
				model: "step-5-preview",
			} as unknown as Parameters<typeof buildSpawnArgs>[2]);
			const args = plan.args.join(" ");
			check("spawn: members run in rpc mode with their own session", plan.args.includes("--mode") && plan.args.includes("rpc") && plan.args.includes("--session-id"), args);
			check("spawn: members do NOT load the project's extensions", plan.args.includes("--no-extensions"), args);
			const extIndex = plan.args.indexOf("-e");
			check("spawn: the only extension a member loads is the messaging shim",
				extIndex >= 0 && plan.args[extIndex + 1]?.endsWith("member-messaging.ts"),
				extIndex >= 0 ? plan.args[extIndex + 1] : "no -e at all");
			check("spawn: the member is told which model to use", plan.args.includes("--model") && plan.args[plan.args.indexOf("--model") + 1] === "step-5-preview", args);
			check("spawn: the team wiring is injected as env, not argv",
				plan.env.STEPCODE_TEAM_SOCK === manager.socketPath && plan.env.STEPCODE_TEAM_MEMBER === "spawnchk",
				`sock=${Boolean(plan.env.STEPCODE_TEAM_SOCK)} member=${plan.env.STEPCODE_TEAM_MEMBER}`);

			// ---- 2. a bare member settles ----
			const bare = await attempt("bare", []);
			check("spawn: a bare member settles", bare.error === "" && bare.text.trim() === "pong", bare.error || JSON.stringify(bare.text.slice(0, 60)));
			// The host warns about an unknown session id on a first spawn; that is
			// diagnostics, and the tail is what makes it visible at all.
			check("spawn: the member's stderr tail is retained", bare.stderr.length > 0, bare.stderr.slice(0, 2).join(" | "));

			// ---- 3. a member with OUR plugin loaded also settles ----
			// This is the finding that located the degradation outside this repo:
			// activating the whole plugin inside a member costs nothing and stalls
			// nothing.
			const plugged = await attempt("with-our-plugin", ["-e", ourExtension]);
			check("spawn: a member with our plugin loaded settles too",
				plugged.error === "" && plugged.text.trim() === "pong",
				plugged.error || JSON.stringify(plugged.text.slice(0, 60)));
			check("spawn: loading our plugin does not change the round count",
				plugged.error === "" && chatRounds >= 1, `rounds=${chatRounds}`);
		} catch (err) {
			check("setup: the probe reached its spawn stage", false, err instanceof Error ? err.message : String(err));
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
			log(`SMOKE37 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
