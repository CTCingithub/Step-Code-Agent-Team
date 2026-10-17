/**
 * Team server: the leader-side Unix socket service that powers member-to-member
 * messaging.
 *
 * Members are isolated processes that do not load this extension. They reach
 * their teammates through the `stepcode-team` CLI shim (bin/stepcode-team.mjs),
 * which connects to this socket. Protocol (JSONL, one object per line):
 *
 *   request:  {"to": "<member>", "message": "<text>"}   → {"ok": true, "reply": "<text>"}
 *   request:  {"type": "status"}                        → {"ok": true, "teamId", "members": [...], "tasks": [...]}
 *   error:                                            → {"ok": false, "error": "<message>"}
 */

import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import type { TeamManager } from "./members.ts";

export class TeamServer {
	private server: net.Server | null = null;

	constructor(
		private readonly socketPath: string,
		private readonly getManager: () => TeamManager,
	) {}

	start(): void {
		if (this.server) return;
		// A stale socket file from a crashed leader would make listen() fail.
		try {
			fs.unlinkSync(this.socketPath);
		} catch {
			/* not present */
		}
		fs.mkdirSync(path.dirname(this.socketPath), { recursive: true });

		this.server = net.createServer((conn) => {
			let buffer = "";
			conn.on("data", (data: Buffer) => {
				buffer += data.toString("utf8");
				let idx: number;
				while ((idx = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, idx).replace(/\r$/, "");
					buffer = buffer.slice(idx + 1);
					if (line.trim()) void this.handle(conn, line);
				}
			});
			conn.on("error", () => {
				/* member hung up; nothing to clean up per-connection */
			});
		});
		this.server.on("error", () => {
			/* keep the leader alive even if the socket misbehaves */
		});
		this.server.listen(this.socketPath);
	}

	stop(): void {
		this.server?.close();
		this.server = null;
		try {
			fs.unlinkSync(this.socketPath);
		} catch {
			/* already gone */
		}
	}

	private async handle(conn: net.Socket, line: string): Promise<void> {
		let req: Record<string, unknown>;
		try {
			req = JSON.parse(line) as Record<string, unknown>;
		} catch {
			this.reply(conn, { ok: false, error: "invalid JSON request" });
			return;
		}
		try {
			if (req.type === "status") {
				const reg = this.getManager().snapshot();
				this.reply(conn, {
					ok: true,
					teamId: reg.teamId,
					members: reg.members.map((m) => ({ name: m.name, role: m.role, status: m.status })),
					tasks: reg.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee })),
				});
				return;
			}
			if (typeof req.to === "string" && typeof req.message === "string") {
				const result = await this.getManager().sendMessage(req.to, req.message);
				this.reply(conn, { ok: true, reply: result.text });
				return;
			}
			this.reply(conn, { ok: false, error: 'expected {"to", "message"} or {"type": "status"}' });
		} catch (err) {
			this.reply(conn, { ok: false, error: err instanceof Error ? err.message : String(err) });
		}
	}

	private reply(conn: net.Socket, obj: unknown): void {
		try {
			conn.write(`${JSON.stringify(obj)}\n`);
		} catch {
			/* member gone */
		}
	}
}
