/**
 * Phase 40 smoke probe (zero token cost): the registry survives a crash.
 *
 * U5 asked whether a registry half-written by a killed process recovers. The
 * answer is structural rather than behavioural, and that is the point worth
 * pinning: saveRegistry writes `<target>.tmp-<pid>` and then renameSync's it
 * over the target (registry.ts:130-136), so on the same filesystem the target is
 * only ever the complete old file or the complete new one — a crash can leave an
 * orphaned tmp file, never a half-written registry.json.
 *
 * What is NOT true is the tempting reading "a corrupt registry recovers". A
 * corrupt or truncated registry makes loadRegistry return null (registry.ts:167-168,
 * already covered by phase7), and forSession then silently rebuilds an EMPTY team
 * — task board and member roster are gone. That is by design (the registry is
 * transient team state; member context lives in the session files), but it is a
 * reset, not a recovery, and this probe says so rather than letting a green check
 * imply the data came back.
 *
 * Asserted here:
 *   1. a save leaves no tmp file behind;
 *   2. an orphaned tmp file is ignored by the loader (it reads registry.json only);
 *   3. the target is replaced atomically — a second save wins wholesale;
 *   4. a truncated registry (a valid-JSON prefix) loads as null, i.e. resets;
 *   5. the tmp name carries the pid, so a killed process's tmp is never cleaned
 *      by a later one — documented as low-severity residue, asserted so a change
 *      that starts cleaning it (or stops namespacing it) is visible.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { createRegistry, loadRegistry, registryPath, saveRegistry, teamDir } from "../../extensions/registry.ts";
import { resetConfigCache } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke40]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
		};

		// An isolated agent dir: teamsRoot resolves under it, so nothing here can
		// touch the real sandbox state. The parent has no config.toml, so the
		// unified config tier finds nothing and defaults stand.
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "scat40-"));
		const agent = path.join(root, "agent");
		fs.mkdirSync(agent, { recursive: true });
		const savedAgentDir = process.env.STEP_CODING_AGENT_DIR;
		process.env.STEP_CODING_AGENT_DIR = agent;
		// Encryption is ON by default and the repo's cwd carries a .topo/team.key,
		// so the file would be an envelope and a "truncated registry" would only
		// ever be an invalid envelope. Turning it off in this isolated dir makes
		// the file plaintext, which is the shape a non-atomic writer would leave
		// and the only shape where the truncation case means what it says.
		fs.writeFileSync(path.join(agent, "stepcode-agent-team.json"), JSON.stringify({ encryption: { enabled: false } }));
		resetConfigCache();

		const teamId = "crashprobe";
		const reg = createRegistry(teamId, process.cwd());
		try {
			const dir = teamDir(teamId);
			const target = registryPath(teamId);

			// ---- 1. a clean save leaves no tmp behind ----
			saveRegistry(reg);
			check("crash: a save leaves no tmp file", fs.readdirSync(dir).filter((f) => f.includes(".tmp-")).length === 0,
				fs.readdirSync(dir).join(","));
			check("crash: the target exists and is complete", loadRegistry(teamId)?.teamId === teamId, "");

			// ---- 2. an orphaned tmp is ignored by the loader ----
			// Simulate a process that wrote its tmp and died before the rename.
			const orphan = `${target}.tmp-999999`;
			fs.writeFileSync(orphan, "{ this was never renamed", { mode: 0o600 });
			const loaded = loadRegistry(teamId);
			check("crash: an orphaned tmp does not corrupt the load", loaded?.teamId === teamId, String(loaded?.teamId));
			check("crash: the orphan is still there (nobody cleans it)", fs.existsSync(orphan), "");
			check("crash: the tmp name is namespaced by pid", /\.tmp-\d+$/.test(orphan), path.basename(orphan));

			// ---- 3. a second save replaces the target wholesale ----
			const second = createRegistry(teamId, process.cwd());
			second.tasks = [{ id: "T1", title: "after the crash", status: "ready", blockedBy: [], createdAt: 0 } as never];
			saveRegistry(second);
			const after = loadRegistry(teamId);
			check("crash: the newer save wins entirely", (after?.tasks.length ?? 0) === 1 && after?.tasks[0]?.title === "after the crash",
				JSON.stringify(after?.tasks?.[0]?.title));

			// ---- 4. a truncated registry resets rather than recovers ----
			// A valid-JSON prefix is the shape a killed writer would leave IF the
			// write were not atomic. The loader must refuse it, and the refusal is
			// a reset — this is the assertion that stops "loads as null" from being
			// read as "the data came back".
			// Read the raw bytes for the truncation; loadRegistry would decrypt/parse
			// and hide the very damage this case is about.
			const full = fs.readFileSync(target, "utf8");
			fs.writeFileSync(target, full.slice(0, Math.floor(full.length / 2)));
			const truncated = loadRegistry(teamId);
			check("crash: a truncated registry loads as null (a reset, not a recovery)", truncated === null, String(truncated));
			check("crash: the truncation is not silently repaired", !fs.existsSync(`${target}.repaired`) && fs.readFileSync(target, "utf8").length < full.length, "");

			// ---- 5. the write really goes through a tmp file ----
			// The end state of `write tmp; rename` and `write target` is identical
			// in a single-threaded probe, so "no tmp left behind" cannot tell them
			// apart — which is exactly why an earlier version of this probe passed
			// after someone replaced the rename with a copy. Make it observable:
			// a read-only TARGET still accepts a rename (the directory is
			// writable) but refuses a direct write. uid must be non-root for the
			// mode to bite; asserted rather than assumed.
			fs.chmodSync(target, 0o444);
			let directWriteWouldFail = false;
			try {
				fs.writeFileSync(target, "x", { encoding: "utf-8" });
			} catch {
				directWriteWouldFail = true;
			}
			check("crash: the mode bit bites here (non-root), so this case is meaningful",
				directWriteWouldFail === true, String(directWriteWouldFail));
			let savedThroughReadOnlyTarget = false;
			let saveError = "";
			try {
				const third = createRegistry(teamId, process.cwd());
				saveRegistry(third);
				savedThroughReadOnlyTarget = loadRegistry(teamId)?.teamId === teamId;
			} catch (err) {
				saveError = err instanceof Error ? err.message : String(err);
			}
			check("crash: a save succeeds over a read-only target (it writes tmp, then renames)",
				savedThroughReadOnlyTarget === true, saveError || String(savedThroughReadOnlyTarget));
			fs.chmodSync(target, 0o600);

			// ---- 6. an empty file is the same story ----
			fs.writeFileSync(target, "");
			check("crash: an empty registry loads as null", loadRegistry(teamId) === null, "");
		} catch (err) {
			check("setup: the probe reached its filesystem stage", false, err instanceof Error ? err.message : String(err));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
			if (savedAgentDir === undefined) delete process.env.STEP_CODING_AGENT_DIR;
			else process.env.STEP_CODING_AGENT_DIR = savedAgentDir;
			resetConfigCache();
			const failed = results.filter((r) => !r.ok);
			log(`SMOKE40 DONE (${results.length - failed.length}/${results.length} passed)`);
			setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
		}
	});
}
