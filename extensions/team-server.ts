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
import { getConfig } from "./config.ts";

/** Opt-in diagnostics for the messaging layer (config.debug, or STEPCODE_TEAM_DEBUG). */
function debugLog(...args: unknown[]): void {
	if (getConfig().debug) console.error("[stepcode-team]", ...args);
}

export class TeamServer {
	private server: net.Server | null = null;
	private conns = new Set<net.Socket>();

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
			this.conns.add(conn);
			conn.on("close", () => this.conns.delete(conn));
			let buffer = "";
			// Serialize handling per connection so a member that pipelines two
			// requests still gets its replies in order.
			let queue: Promise<void> = Promise.resolve();
			conn.on("data", (data: Buffer) => {
				buffer += data.toString("utf8");
				let idx: number;
				while ((idx = buffer.indexOf("\n")) >= 0) {
					const line = buffer.slice(0, idx).replace(/\r$/, "");
					buffer = buffer.slice(idx + 1);
					if (line.trim()) {
						queue = queue
							.then(() => this.handle(conn, line))
							.catch((err) => debugLog("handle error:", err instanceof Error ? err.message : String(err)));
					}
				}
			});
			conn.on("error", (err: Error) => {
				// Member hung up mid-request; nothing to clean up per-connection.
				debugLog("connection error:", err.message);
			});
		});
		this.server.on("error", (err: Error) => {
			// Keep the leader alive even if the socket misbehaves, but always
			// leave a trace: a silent listen() failure would break messaging
			// invisibly (every member msg would fail with ECONNREFUSED).
			console.error(`[stepcode-team] server error: ${err.message}`);
		});
		this.server.listen(this.socketPath, () => {
			try {
				// Only the owner may drive members (the socket spends the owner's quota).
				fs.chmodSync(this.socketPath, 0o600);
			} catch (err) {
				debugLog("chmod socket failed:", err instanceof Error ? err.message : String(err));
			}
		});
	}

	stop(): void {
		// Drop live connections first: server.close() waits for them otherwise.
		for (const conn of this.conns) conn.destroy();
		this.conns.clear();
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
				const manager = this.getManager();
				const reg = manager.snapshot();
				const from = typeof req.from === "string" ? req.from : "";
				this.reply(conn, {
					ok: true,
					teamId: reg.teamId,
					youAre: from || undefined,
					mayMessage: from ? manager.outboundTargets(from) : [],
					members: reg.members.map((m) => ({ name: m.name, role: m.role, status: m.status })),
					tasks: reg.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assignee: t.assignee })),
				});
				return;
			}
			if (typeof req.to === "string" && typeof req.message === "string") {
				const manager = this.getManager();
				const from = typeof req.from === "string" ? req.from : "";
				if (!from) {
					this.reply(conn, {
						ok: false,
						error: "missing sender identity (from); the shim sets it from STEPCODE_TEAM_MEMBER",
					});
					return;
				}
				// The leader is not a topology node and has no async inbox: a
				// member→leader message has no delivery channel, so answer it
				// precisely instead of listing topology neighbors. Everything a
				// member reports reaches the leader through its final report.
				if (req.to.trim().toLowerCase() === "leader") {
					this.reply(conn, {
						ok: false,
						error:
							"the leader is not a messaging target — it is not part of the topology and has no message inbox. " +
							"Put this in your final report instead: the leader reads task results and your replies to its dispatches.",
					});
					return;
				}
				// Topology enforcement: A may message B only when edge A→B exists.
				if (!manager.mayMessage(from, req.to)) {
					const allowed = manager.outboundTargets(from);
					this.reply(conn, {
						ok: false,
						error: `topology denies ${from} → ${req.to}. Allowed teammates: ${
							allowed.length > 0 ? allowed.join(", ") : "(none — report it in your final report)"
						}.`,
					});
					return;
				}
				// Ring loop bound: this hop extends the sender's chain by one.
				const limit = getConfig().topology.maxLoopCount;
				const nextLength = manager.currentChainLength(from) + 1;
				if (limit > 0 && nextLength > limit) {
					this.reply(conn, {
						ok: false,
						error:
							`message chain would reach ${nextLength} hops, over the ring loop limit (${limit}). ` +
							"State the need in your final report instead of forwarding further — the leader is not a messaging target.",
					});
					return;
				}
				// Wait-cycle guard: if the target is itself waiting (transitively)
				// on the sender, this dispatch can only deadlock on the per-member
				// queue — reject it instead of hanging until the RPC timeout.
				if (manager.wouldDeadlock(from, req.to)) {
					this.reply(conn, {
						ok: false,
						error:
							`messaging cycle detected: ${from} → ${req.to} would close a wait loop. ` +
							"State the need in your final report instead of forwarding further — the leader is not a messaging target.",
					});
					return;
				}
				// Nested dispatch: exempt from the global concurrency gate — the
				// sender already holds a running slot (see members.ts dispatch).
				// withWaitingOn records the edge so later hops can detect cycles.
				const result = await manager.withWaitingOn(from, req.to, () =>
					// req.to/req.message are narrowed by the guard above, but TS drops
					// narrowing inside closures — reassert at the boundary.
					manager.sendMessage(req.to as string, req.message as string, { nested: true, chainLength: nextLength }),
				);
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
