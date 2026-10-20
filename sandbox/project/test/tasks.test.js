"use strict";

/**
 * Test suite for the sandbox demo project. Zero dependencies — plain
 * node:assert, run with `npm test` (node test/tasks.test.js).
 *
 * Every test gets its own throwaway data dir (a subdir of an mkdtemp root
 * removed at the end), so the suite never touches the project's real data/
 * and stays deterministic. The store takes the dir via
 * `new TaskStore({ dataDir })`; the CLI picks it up from TASKS_DATA_DIR.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PROJECT = path.join(__dirname, "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "scat-demo-"));
let caseNo = 0;

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

/** A store backed by a fresh throwaway data dir. */
function fresh() {
	caseNo += 1;
	return new TaskStore({ dataDir: path.join(TMP, `case-${caseNo}`) });
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
	const reopened = new TaskStore({ dataDir: store.dataDir });
	assert.equal(reopened.list().length, 1);
	assert.equal(reopened.list()[0].title, "persist me");
});

// --- hygiene round (M5/H1/sanitize) ---------------------------------------

test("add sanitizes control characters and newlines in titles", () => {
	const store = fresh();
	const t = store.add("evil\ttitle\nsecond\u2028line");
	assert.equal(t.title, "evil title second line");
	assert.equal(store.list().length, 1); // no forged list rows
});

test("add rejects titles that are only control characters", () => {
	const store = fresh();
	assert.throws(() => store.add("\n\t"), /title must not be empty/);
});

test("corrupt data file fails loud instead of resetting (H1)", () => {
	const dir = path.join(TMP, "corrupt");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "tasks.json"), "{ not json");
	assert.throws(() => new TaskStore({ dataDir: dir }), /not valid JSON/);
});

test("unreadable data file names the file (H1)", () => {
	const dir = path.join(TMP, "eisdir");
	fs.mkdirSync(path.join(dir, "tasks.json"), { recursive: true }); // a directory where the file belongs → EISDIR
	assert.throws(() => new TaskStore({ dataDir: dir }), /cannot read task data file/);
});

test("cli: add then list shows the task", () => {
	const dir = path.join(TMP, "cli");
	const out = execFileSync(process.execPath, [path.join(PROJECT, "src", "cli.js"), "add", "from cli"], {
		encoding: "utf8",
		env: { ...process.env, TASKS_DATA_DIR: dir },
	});
	assert.match(out, /added #1: from cli/);
	const list = execFileSync(process.execPath, [path.join(PROJECT, "src", "cli.js"), "list"], {
		encoding: "utf8",
		env: { ...process.env, TASKS_DATA_DIR: dir },
	});
	assert.match(list, /from cli/);
});

const failed = results.filter((r) => !r.ok).length;
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed > 0) {
	console.log("Expected demo failure: 'complete after remove' is the seeded bug — fix src/tasks.js (look up by id, not by index).");
	process.exit(1);
}
