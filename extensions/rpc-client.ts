/**
 * Minimal JSONL RPC client for member agent processes.
 *
 * A member is a long-lived `step --mode rpc` subprocess. The leader drives it
 * over stdio using the protocol documented in docs/rpc.md:
 *
 *   - Commands: one JSON object per line on stdin, with an `id` for correlation.
 *   - Responses: `{ id, type: "response", command, success, data? }`.
 *   - Events: streamed JSON lines (message_end, tool_execution_end,
 *     agent_settled, entry_appended, ...).
 *
 * Framing rule: split on "\n" ONLY. Node's readline also splits on U+2028 /
 * U+2029, which are valid inside JSON strings and would corrupt the protocol.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { MemberUsage } from "./registry.ts";
import { emptyUsage, usageDelta } from "./registry.ts";
const REQUEST_TIMEOUT_MS = 180_000;
const HANDSHAKE_TIMEOUT_MS = 15_000;

interface PendingRequest {
	resolve: (data: unknown) => void;
	reject: (err: Error) => void;
	timer: NodeJS.Timeout;
}

export interface MemberRpcHandlers {
	onClose?: (code: number | null) => void;
}

/** Mirrors the official subagent example's invocation resolution, for `step`. */
export function getStepInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "step", args };
}

export class MemberRpc {
	readonly pid: number;
	private readonly proc: ChildProcess;
	private readonly handlers: MemberRpcHandlers;
	private buffer = "";
	private pending = new Map<string, PendingRequest>();
	private nextId = 1;
	private closed = false;
	private handshakeDone = false;
	private handshakeWaiters: Array<() => void> = [];
	private settleWaiters: Array<() => void> = [];
	private closeWaiters: Array<(code: number | null) => void> = [];
	private lastAssistantText = "";
	private usage: MemberUsage = emptyUsage();

	private constructor(proc: ChildProcess, handlers: MemberRpcHandlers) {
		this.proc = proc;
		this.pid = proc.pid ?? -1;
		this.handlers = handlers;

		proc.stdout?.on("data", (data: Buffer) => this.onData(data));
		proc.stderr?.on("data", () => {
			// Member stderr is diagnostics only; not part of the protocol.
		});

		proc.on("error", (err: Error) => {
			this.closed = true;
			this.failPending(new Error(`member process error: ${err.message}`));
			this.flushWaiters(null);
			this.handlers.onClose?.(null);
		});

		proc.on("close", (code: number | null) => {
			this.closed = true;
			this.failPending(new Error(`member process exited (code ${code ?? "null"})`));
			this.flushWaiters(code);
			this.handlers.onClose?.(code);
		});
	}

	static async spawn(args: string[], cwd: string, handlers: MemberRpcHandlers = {}, env?: Record<string, string>): Promise<MemberRpc> {
		const invocation = getStepInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd,
			shell: false,
			// stdin MUST be a pipe: the RPC protocol drives the member over it.
			// ("ignore" points the child's stdin at /dev/null, so prompt writes
			// silently vanish and the member exits on EOF.)
			stdio: ["pipe", "pipe", "pipe"],
			...(env ? { env: { ...process.env, ...env } } : {}),
		});
		const rpc = new MemberRpc(proc, handlers);
		await rpc.waitForHandshake();
		return rpc;
	}

	isClosed(): boolean {
		return this.closed;
	}

	// ---------------------------------------------------------------- protocol

	private onData(data: Buffer): void {
		this.buffer += data.toString("utf8");
		let idx: number;
		while ((idx = this.buffer.indexOf("\n")) >= 0) {
			const line = this.buffer.slice(0, idx).replace(/\r$/, "");
			this.buffer = this.buffer.slice(idx + 1);
			if (line.trim()) this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		let event: Record<string, unknown>;
		try {
			event = JSON.parse(line) as Record<string, unknown>;
		} catch {
			return; // partial or non-JSON output; ignore
		}

		if (event.type === "response" && typeof event.id === "string") {
			const pending = this.pending.get(event.id);
			if (pending) {
				this.pending.delete(event.id);
				clearTimeout(pending.timer);
				if (event.success === false) {
					pending.reject(new Error(`RPC command failed: ${String(event.command ?? "unknown")}`));
				} else {
					pending.resolve(event.data);
				}
			}
			if (event.command === "get_state") this.markHandshake();
			return;
		}

		switch (event.type) {
			case "entry_appended":
				this.markHandshake();
				break;
			case "message_end": {
				const msg = event.message as
					| { role?: string; content?: unknown[]; usage?: Record<string, number>; model?: string }
					| undefined;
				if (msg?.role === "assistant") {
					this.usage.turns += 1;
					const usage = msg.usage;
					if (usage) {
						this.usage.input += usage.input || 0;
						this.usage.output += usage.output || 0;
						this.usage.cost += usage.cost?.total || 0;
					}
					for (const part of msg.content ?? []) {
						const p = part as { type?: string; text?: string };
						if (p.type === "text" && p.text) this.lastAssistantText = p.text;
					}
				}
				break;
			}
			case "agent_settled":
				this.flushSettleWaiters();
				break;
			default:
				break; // extension_ui_request, tool_execution_*, etc.: ignored
		}
	}

	private markHandshake(): void {
		this.handshakeDone = true;
		const waiters = this.handshakeWaiters;
		this.handshakeWaiters = [];
		for (const w of waiters) w();
	}

	private flushSettleWaiters(): void {
		const waiters = this.settleWaiters;
		this.settleWaiters = [];
		for (const w of waiters) w();
	}

	private flushWaiters(code: number | null): void {
		this.markHandshake();
		this.flushSettleWaiters();
		const closeWaiters = this.closeWaiters;
		this.closeWaiters = [];
		for (const w of closeWaiters) w(code);
	}

	/** Resolves when the member process exits; rejects never. */
	waitForClose(): Promise<number | null> {
		if (this.closed) return Promise.resolve(null);
		return new Promise((resolve) => {
			this.closeWaiters.push(resolve);
		});
	}

	private failPending(err: Error): void {
		for (const [, p] of this.pending) {
			clearTimeout(p.timer);
			p.reject(err);
		}
		this.pending.clear();
	}

	private waitForHandshake(): Promise<void> {
		if (this.handshakeDone || this.closed) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.handshakeWaiters = this.handshakeWaiters.filter((w) => w !== done);
				reject(new Error("member handshake timeout"));
			}, HANDSHAKE_TIMEOUT_MS);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			this.handshakeWaiters.push(done);
		});
	}

	// ---------------------------------------------------------------- commands

	send(command: Record<string, unknown>): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("member process is not running"));
		const id = `r${this.nextId++}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC timeout for command "${String(command.type)}"`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.proc.stdin?.write(`${JSON.stringify({ id, ...command })}\n`);
			} catch (err) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	/** Send a prompt and wait until the agent run is fully settled. Returns the text and the usage delta of this run. */
	async promptAndSettle(message: string): Promise<{ text: string; usage: MemberUsage }> {
		if (this.closed) throw new Error("member process is not running");
		const usageBefore = { ...this.usage };
		const settleWaiter = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.settleWaiters = this.settleWaiters.filter((w) => w !== done);
				reject(new Error("timeout waiting for member to settle"));
			}, REQUEST_TIMEOUT_MS);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			this.settleWaiters.push(done);
		});
		// If the member dies mid-run, the close handler rejects pending requests;
		// surface that here too by racing a close promise.
		const closeWaiter = this.waitForClose().then((code) => {
			throw new Error(`member process exited during run (code ${code ?? "null"})`);
		});
		try {
			await this.send({ type: "prompt", message });
			await Promise.race([settleWaiter, closeWaiter]);
		} finally {
			closeWaiter.catch(() => {});
		}
		return { text: this.lastAssistantText, usage: usageDelta(usageBefore, this.usage) };
	}

	// ---------------------------------------------------------------- lifecycle

	/** Cooperative abort of the current run (docs/rpc.md `abort`). */
	abortRun(): void {
		if (this.closed) return;
		try {
			this.proc.stdin?.write(`${JSON.stringify({ type: "abort" })}\n`);
		} catch {
			/* ignore */
		}
	}

	/** Hard shutdown for disband: SIGTERM, then SIGKILL after a grace period. */
	kill(): void {
		if (this.closed || this.proc.killed) return;
		this.proc.kill("SIGTERM");
		setTimeout(() => {
			if (!this.proc.killed) this.proc.kill("SIGKILL");
		}, 5000).unref();
	}
}
