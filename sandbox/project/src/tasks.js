"use strict";

/**
 * Task store core for the sandbox demo project.
 *
 * State persists to <dataDir>/tasks.json so CLI invocations and tests
 * share one source of truth. Zero dependencies on purpose — team members
 * must be able to run everything with plain `node`.
 *
 * The data dir is injectable: `new TaskStore({ dataDir })` per store, or the
 * TASKS_DATA_DIR environment variable (what the CLI test uses to point at a
 * throwaway directory). Without either it defaults to <project>/data, so
 * `node src/cli.js ...` keeps writing where it always did.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "data");

function resolveDataDir(options) {
	const dataDir = (options && options.dataDir) || process.env.TASKS_DATA_DIR || DEFAULT_DATA_DIR;
	return path.resolve(dataDir);
}

function sanitizeTitle(title) {
	if (typeof title !== "string") return "";
	let clean = "";
	for (const ch of title) {
		const code = ch.codePointAt(0);
		// Control characters (NUL, ESC/ANSI, TAB, CR/LF, ...) plus the Unicode
		// line and paragraph separators would forge extra `list` rows or mangle
		// terminal output, so they never reach the store.
		const hostile =
			code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
		clean += hostile ? " " : ch;
	}
	return clean.trim();
}

function load(dataFile) {
	let raw;
	try {
		raw = fs.readFileSync(dataFile, "utf8");
	} catch (err) {
		// No data file yet: a fresh install starts empty.
		if (err.code === "ENOENT") return { nextId: 1, tasks: [] };
		// The file exists but cannot be read (permissions, EISDIR, I/O ...).
		// Resetting it here would silently look like data loss, so fail loud
		// and name the file.
		throw new Error(`cannot read task data file ${dataFile}: ${err.message}`);
	}

	let state;
	try {
		state = JSON.parse(raw);
	} catch (err) {
		throw new Error(`task data file ${dataFile} is not valid JSON: ${err.message}`);
	}

	// Valid JSON of the wrong shape ({} / [] / {"tasks":[]}) must not leak
	// into the store: it would crash later or silently corrupt ids. Fall
	// back to the default state — unlike an unreadable file this is content
	// we could parse, just not a task list.
	if (
		state &&
		typeof state === "object" &&
		Array.isArray(state.tasks) &&
		Number.isInteger(state.nextId) &&
		state.nextId > 0
	) {
		return state;
	}
	return { nextId: 1, tasks: [] };
}

function save(dataFile, state) {
	fs.mkdirSync(path.dirname(dataFile), { recursive: true });
	fs.writeFileSync(dataFile, `${JSON.stringify(state, null, 2)}\n`);
}

class TaskStore {
	constructor(options) {
		this.dataDir = resolveDataDir(options);
		this.dataFile = path.join(this.dataDir, "tasks.json");
		this.state = load(this.dataFile);
	}

	add(title) {
		const cleanTitle = sanitizeTitle(title);
		if (!cleanTitle) throw new Error("title must not be empty");
		const task = { id: this.state.nextId, title: cleanTitle, done: false };
		this.state.tasks.push(task);
		this.state.nextId += 1;
		save(this.dataFile, this.state);
		return { ...task };
	}

	list() {
		return this.state.tasks.map((t) => ({ ...t }));
	}

	complete(id) {
		// SEEDED BUG (demo target): indexes the array by `id - 1` instead of
		// looking the task up by id. After a remove(), ids no longer line up
		// with array positions, so this marks the wrong task or reports
		// "not found" for a task that exists. Fix: find by id.
		const index = id - 1;
		const task = this.state.tasks[index];
		if (!task) throw new Error(`task ${id} not found`);
		task.done = true;
		save(this.dataFile, this.state);
		return { ...task };
	}

	remove(id) {
		const before = this.state.tasks.length;
		this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
		if (this.state.tasks.length === before) throw new Error(`task ${id} not found`);
		save(this.dataFile, this.state);
	}
}

module.exports = { TaskStore, DEFAULT_DATA_DIR };
