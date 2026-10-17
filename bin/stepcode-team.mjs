#!/usr/bin/env node
/**
 * stepcode-team — CLI shim for team members.
 *
 * Members are isolated agent processes that do not load the team extension.
 * They reach teammates (and check team status) through this shim, which talks
 * to the leader's team server over a Unix socket.
 *
 * The socket path is provided by the leader via the STEPCODE_TEAM_SOCK
 * environment variable (set when the member process is spawned).
 *
 * Usage (from inside a member):
 *   stepcode-team msg --to <member> --message "<text>"
 *   stepcode-team status
 *
 * Protocol: JSONL over the Unix socket; see extensions/team-server.ts.
 */

import { connect } from "node:net";

const REQUEST_TIMEOUT_MS = 180_000;

function fail(message, code = 1) {
	console.error(`stepcode-team: ${message}`);
	process.exit(code);
}

const args = process.argv.slice(2);
const command = args[0];
const socketPath = process.env.STEPCODE_TEAM_SOCK;

if (!command || !["msg", "status"].includes(command)) {
	console.error("usage: stepcode-team msg --to <member> --message <text>");
	console.error("       stepcode-team status");
	process.exit(2);
}
if (!socketPath) {
	fail("STEPCODE_TEAM_SOCK is not set. This tool only runs inside a team member.", 2);
}

function flag(name) {
	const idx = args.indexOf(name);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

let request;
if (command === "status") {
	request = { type: "status" };
} else {
	const to = flag("--to");
	const message = flag("--message");
	if (!to || !message) {
		fail('msg requires --to <member> and --message <text>', 2);
	}
	request = { to, message };
}

const conn = connect(socketPath);
let buffer = "";
let finished = false;

function finish(code) {
	if (finished) return;
	finished = true;
	process.exit(code);
}

conn.on("connect", () => {
	conn.write(`${JSON.stringify(request)}\n`);
});

conn.on("data", (data) => {
	buffer += data.toString("utf8");
	let idx;
	while ((idx = buffer.indexOf("\n")) >= 0) {
		const line = buffer.slice(0, idx).replace(/\r$/, "");
		buffer = buffer.slice(idx + 1);
		if (!line.trim()) continue;
		let res;
		try {
			res = JSON.parse(line);
		} catch {
			continue;
		}
		if (res.ok) {
			console.log(res.reply ?? JSON.stringify(res, null, 2));
			finish(0);
		} else {
			fail(res.error ?? "unknown error");
		}
	}
});

conn.on("error", (err) => {
	fail(err.message);
});

setTimeout(() => fail("timed out waiting for the team server"), REQUEST_TIMEOUT_MS).unref();
