#!/usr/bin/env node
"use strict";

/**
 * Tiny CLI over the task store. Usage:
 *   node src/cli.js add "<title>"   # add a task
 *   node src/cli.js list            # list tasks
 *   node src/cli.js done <id>       # mark a task done
 *   node src/cli.js remove <id>     # remove a task
 */

const { TaskStore } = require("./tasks.js");

const [, , command, ...args] = process.argv;
const store = new TaskStore();

switch (command) {
	case "add": {
		const task = store.add(args.join(" "));
		console.log(`added #${task.id}: ${task.title}`);
		break;
	}
	case "list": {
		const tasks = store.list();
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
		const task = store.complete(id);
		console.log(`done #${task.id}: ${task.title}`);
		break;
	}
	case "remove": {
		const id = Number.parseInt(args[0], 10);
		if (!Number.isInteger(id)) {
			console.error("remove requires a numeric task id");
			process.exit(2);
		}
		store.remove(id);
		console.log(`removed #${id}`);
		break;
	}
	default:
		console.error("usage: node src/cli.js <add|list|done|remove> [args]");
		process.exit(2);
}
