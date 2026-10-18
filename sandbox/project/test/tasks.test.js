"use strict";

/**
 * Test suite for the sandbox demo project. Zero dependencies — plain
 * node:assert, run with `npm test` (node test/tasks.test.js).
 *
 * The store persists to <project>/data/tasks.json; every test starts from a
 * clean data dir so the suite is deterministic.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT = path.join(__dirname, "..");
const DATA_DIR = path.join(PROJECT, "data");
fs.rmSync(DATA_DIR, { recursive: true, force: true });

const { TaskStore } = require("../src/tasks.js");

const results = [];
function test(name, fn) {
	try {
		fn();
		results.push({ name, ok: true });
		console.log(`ok - ${name}`);
	} catch (err) {
		results.push({ name, ok: false });
		console.log(`not ok - ${name}: ${err.message}`);
	}
}

function fresh() {
	fs.rmSync(DATA_DIR, { recursive: true, force: true });
	return new TaskStore();
}

test("add assigns sequential ids and trims titles", () => {
	const store = fresh();
	const a = store.add("  write docs  ");
	const b = store.add("ship it");
	assert.equal(a.id, 1);
	assert.equal(b.id, 2);
	assert.equal(a.title, "write docs");
	assert.equal(store.list().length, 2);
});

test("add rejects empty titles", () => {
	const store = fresh();
	assert.throws(() => store.add("   "), /title must not be empty/);
});

test("complete marks the right task done", () => {
	const store = fresh();
	store.add("one");
	store.add("two");
	const done = store.complete(2);
	assert.equal(done.id, 2);
	assert.equal(done.done, true);
	assert.equal(store.list()[0].done, false);
});

test("complete after remove still targets the right task (seeded bug)", () => {
	const store = fresh();
	store.add("one");
	store.add("two");
	store.add("three");
	store.remove(2); // ids no longer align with array positions
	const done = store.complete(3); // must mark "three", not anything else
	assert.equal(done.title, "three");
	assert.equal(done.done, true);
	assert.equal(store.list().find((t) => t.id === 1).done, false);
});

test("complete throws for unknown ids", () => {
	const store = fresh();
	store.add("one");
	assert.throws(() => store.complete(99), /task 99 not found/);
});

test("remove throws for unknown ids", () => {
	const store = fresh();
	assert.throws(() => store.remove(1), /task 1 not found/);
});

test("state persists across store instances", () => {
	const store = fresh();
	store.add("persist me");
	const reopened = new TaskStore();
	assert.equal(reopened.list().length, 1);
	assert.equal(reopened.list()[0].title, "persist me");
});

test("cli: add then list shows the task", () => {
	fs.rmSync(DATA_DIR, { recursive: true, force: true });
	const out = execFileSync(process.execPath, [path.join(PROJECT, "src", "cli.js"), "add", "from cli"], {
		encoding: "utf8",
	});
	assert.match(out, /added #1: from cli/);
	const list = execFileSync(process.execPath, [path.join(PROJECT, "src", "cli.js"), "list"], { encoding: "utf8" });
	assert.match(list, /from cli/);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) {
	console.log("Expected demo failure: 'complete after remove' is the seeded bug — fix src/tasks.js (look up by id, not by index).");
	process.exit(1);
}
