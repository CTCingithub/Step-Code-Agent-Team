#!/usr/bin/env node
"use strict";

/**
 * Tiny CLI over the task store. Usage:
 *   node src/cli.js add "<title>"   # add a task
 *   node src/cli.js list            # list tasks
 *   node src/cli.js done <id>       # mark a task done
 *   node src/cli.js remove <id>     # remove a task
 *
 * Tasks live in <project>/data/tasks.json; set TASKS_DATA_DIR to point the
 * store at another directory.
 */

const { TaskStore } = require("./tasks.js");

const [, , command, ...args] = process.argv;

/**
 * Store calls throw business errors (empty title, task not found, ...).
 * Surface them as clean exit-2 messages instead of an uncaught stack
 * trace, matching the argument-validation path below.
 */
function run(fn) {
	try {
		return fn();
	} catch (err) {
		console.error(err.message);
		process.exit(2);
	}
}

// Opening the store can fail too (unreadable or corrupt data file), and that
// is a data problem worth reporting plainly rather than as a stack trace.
const store = run(() => new TaskStore());

switch (command) {
	case "add": {
		const task = run(() => store.add(args.join(" ")));
		console.log(`added #${task.id}: ${task.title}`);
		break;
	}
	case "list": {
		const tasks = run(() => store.list());
		if (tasks.length === 0) {
			console.log("(no tasks)");
			break;
		}
		for (const t of tasks) {
			console.log(`${t.done ? "[x]" : "[ ]"} #${t.id} ${t.title}`);
		}
		break;
	}
	case "done": {
		const id = Number.parseInt(args[0], 10);
		if (!Number.isInteger(id)) {
			console.error("done requires a numeric task id");
			process.exit(2);
		}
		const task = run(() => store.complete(id));
		console.log(`done #${task.id}: ${task.title}`);
		break;
	}
	case "remove": {
		const id = Number.parseInt(args[0], 10);
		if (!Number.isInteger(id)) {
			console.error("remove requires a numeric task id");
			process.exit(2);
		}
		run(() => store.remove(id));
		console.log(`removed #${id}`);
		break;
	}
	default:
		console.error("usage: node src/cli.js <add|list|done|remove> [args]");
		process.exit(2);
}
