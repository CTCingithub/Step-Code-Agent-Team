"use strict";

/**
 * Task store core for the sandbox demo project.
 *
 * State persists to <project>/data/tasks.json so CLI invocations and tests
 * share one source of truth. Zero dependencies on purpose — team members
 * must be able to run everything with plain `node`.
 */

const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = path.join(__dirname, "..", "data", "tasks.json");

function load() {
	try {
		return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
	} catch {
		// Missing or unreadable file: start empty.
		return { nextId: 1, tasks: [] };
	}
}

function save(state) {
	fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
	fs.writeFileSync(DATA_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

class TaskStore {
	constructor() {
		this.state = load();
	}

	add(title) {
		if (!title || !title.trim()) throw new Error("title must not be empty");
		const task = { id: this.state.nextId, title: title.trim(), done: false };
		this.state.tasks.push(task);
		this.state.nextId += 1;
		save(this.state);
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
		save(this.state);
		return { ...task };
	}

	remove(id) {
		const before = this.state.tasks.length;
		this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
		if (this.state.tasks.length === before) throw new Error(`task ${id} not found`);
		save(this.state);
	}
}

module.exports = { TaskStore };
