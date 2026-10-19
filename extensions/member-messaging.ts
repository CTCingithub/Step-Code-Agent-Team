/**
 * Member-side messaging extension (0.2.x).
 *
 * Members reach teammates through the team server's Unix socket. Before
 * this extension the only channel was the `stepcode-team` CLI shim, which
 * runs through a shell — so a member needed `bash` in its tool allowlist,
 * and the read-only presets (scout/planner/reviewer) could not use their
 * topology edges at all: every edge touching them degraded to leader
 * relay (extra leader round-trips, more leader context, more latency).
 *
 * This extension registers a single `team_msg` tool that speaks the same
 * JSONL protocol over the socket directly (node:net) — no shell, no bash.
 * Read-only postures stay intact and topology edges become usable for
 * every role. The CLI shim remains available for manual/external use.
 *
 * Identity and endpoint come from the environment injected at spawn:
 * STEPCODE_TEAM_SOCK (socket path) and STEPCODE_TEAM_MEMBER (sender name).
 * Without them this process is not a team member and the extension stays
 * inert (registers nothing).
 */

import * as net from "node:net";
import { Type } from "typebox";
import type { ExtensionAPI } from "@step-harness/coding-agent";

/** Matches the shim's timeout: a teammate reply may take a while. */
const REPLY_TIMEOUT_MS = 180_000;

interface ServerResponse {
	ok?: boolean;
	reply?: string;
	error?: string;
	/** True when the failure was infrastructure (connect/close/timeout), not policy. */
	infra?: boolean;
}

export default function (pi: ExtensionAPI) {
	const socketPath = process.env.STEPCODE_TEAM_SOCK;
	const sender = process.env.STEPCODE_TEAM_MEMBER;
	if (!socketPath || !sender) return; // not a team member — inert

	pi.registerTool({
		name: "team_msg",
		label: "Message Teammate",
		description: [
			"Send a message to a teammate and wait for their reply.",
			"Only teammates allowed by the team topology are accepted; a rejection lists the teammates you may message.",
			"If no allowed teammate fits, state the need in your final report instead — the leader will relay it.",
			"Keep messages short and specific; prefer finishing your own task over chatting.",
		].join(" "),
		parameters: Type.Object({
			to: Type.String({ description: "Teammate member name" }),
			message: Type.String({ description: "Message text for the teammate" }),
		}),
		async execute(_toolCallId, params) {
			const request = { from: sender, to: params.to, message: params.message };
			const res = await new Promise<ServerResponse>((resolve) => {
				let settled = false;
				const finish = (value: ServerResponse): void => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					conn.destroy();
					resolve(value);
				};
				const timer = setTimeout(
					() => finish({ ok: false, error: "timeout waiting for the teammate's reply", infra: true }),
					REPLY_TIMEOUT_MS,
				);
				const conn = net.connect(socketPath);
				let buffer = "";
				conn.on("connect", () => {
					conn.write(`${JSON.stringify(request)}\n`);
				});
				conn.on("data", (chunk: Buffer) => {
					buffer += chunk.toString("utf8");
					let idx: number;
					while ((idx = buffer.indexOf("\n")) >= 0) {
						const line = buffer.slice(0, idx).trim();
						buffer = buffer.slice(idx + 1);
						if (!line) continue;
						let parsed: ServerResponse;
						try {
							parsed = JSON.parse(line) as ServerResponse;
						} catch {
							continue; // tolerate non-JSON lines, like the shim
						}
						finish(parsed);
						return;
					}
				});
				conn.on("error", (err: Error) => {
					finish({ ok: false, error: `connection error: ${err.message}`, infra: true });
				});
				conn.on("close", () => {
					finish({ ok: false, error: "connection closed before a reply", infra: true });
				});
			});

			if (res.ok) {
				return { content: [{ type: "text", text: res.reply ?? "(teammate replied with no text)" }] };
			}
			// Policy rejections (topology) are actionable — the server lists the
			// allowed teammates. Infrastructure failures get the "don't
			// investigate the tooling" guidance, mirroring the shim contract.
			const guidance = res.infra
				? "\nDo NOT investigate the tooling — proceed with your task and note the failure in your final report."
				: "";
			return {
				content: [{ type: "text", text: `team_msg to "${params.to}" failed: ${res.error ?? "unknown error"}.${guidance}` }],
				isError: true,
			};
		},
	});
}
