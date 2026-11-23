/**
 * Collaboration-record probe (v0.4.1). Zero-token, standalone: drives
 * writeCollabRecord()/loadCollabRecord() against hermetic mktemp workspaces, so
 * the whole contract — content, idempotence, the two at-rest forms, the config
 * surface and the degrade paths — runs without a model call and without a team.
 *
 * The encryption half is the point: the record must follow the USER's option,
 * which means three distinct behaviours (sealed / plaintext-because-disabled /
 * plaintext-because-no-key) and a reader that handles all of them.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { hasRecord, loadCollabRecord, recordsDir, writeCollabRecord } from "../../extensions/collab-record.ts";
import { agentDir, defaultConfig, getConfig, loadConfig, resetConfigCache, seedGlobalConfigExample } from "../../extensions/config.ts";
import { ensureTopoDir } from "../../extensions/topo-init.ts";
import type { TeamManager } from "../../extensions/members.ts";

/** A manager stand-in: writeCollabRecord only reads snapshot()/cwd/teamId. */
function fakeManager(cwd: string, teamId: string): TeamManager {
	const createdAt = Date.now() - 60_000;
	return {
		cwd,
		teamId,
		snapshot: () => ({
			schemaVersion: 1 as const,
			teamId,
			createdAt,
			cwd,
			members: [
				{ name: "scout1", role: "scout", model: "step-5-preview", effort: "low", tools: ["read", "grep"], sessionId: `t-${teamId}-scout1`, pid: -1, status: "dead" as const, usage: { input: 1200, output: 300, cost: 0.0021, turns: 2 } },
				{ name: "worker1", role: "worker", model: "step-5-preview", effort: "medium", tools: ["read", "bash"], sessionId: `t-${teamId}-worker1`, pid: -1, status: "idle" as const, usage: { input: 800, output: 200, cost: 0.0014, turns: 1 } },
			],
			tasks: [
				{ id: "T1", title: "勘察项目结构", detail: "", blockedBy: [], assignee: "scout1", status: "done" as const },
				{ id: "T2", title: "修复失败测试", detail: "", blockedBy: ["T1"], assignee: "worker1", status: "done" as const },
				{ id: "T3", title: "审查改动", detail: "", blockedBy: ["T2"], status: "failed" as const },
			],
			topology: { shape: "star" as const, edges: [] },
		}),
	} as unknown as TeamManager;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke30]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const temps: string[] = [];
		const mkCwd = (): string => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scat30-"));
			temps.push(dir);
			return dir;
		};
		const settingsFile = path.join(agentDir(), "settings.json");
		const had = fs.existsSync(settingsFile);
		const prev = had ? fs.readFileSync(settingsFile, "utf8") : "";
		const writeCfg = (cfg: unknown) => {
			fs.writeFileSync(settingsFile, JSON.stringify({ stepcodeAgentTeam: cfg }));
			resetConfigCache();
		};

		try {
			const d = defaultConfig();

			// ---- 1. a record is written, sealed, and readable back ----
			const cwd = mkCwd();
			ensureTopoDir(cwd);
			writeCfg({ encryption: { enabled: true }, records: { enabled: true, dir: "records" } });
			const mgr = fakeManager(cwd, "team-rec-1");
			const written = writeCollabRecord(mgr);
			check("record: two files written (json + md)", written.length === 2, written.map((f) => path.basename(f)).join(","));
			const jsonPath = written.find((f) => f.endsWith(".json")) ?? "";
			check("record: lives under .topo/records", jsonPath.startsWith(recordsDir(cwd)), jsonPath);
			const raw = fs.readFileSync(jsonPath, "utf8");
			check("record: sealed when encryption is on", raw.includes('"encrypted"'), raw.slice(0, 80));
			check("record: the task title is NOT on disk in the clear", !raw.includes("修复失败测试"));
			const back = loadCollabRecord(jsonPath);
			check("record: reads back through the envelope", back?.teamId === "team-rec-1", String(back?.teamId));
			check("record: members survive the round-trip", back?.members.length === 2 && back?.members[0]?.name === "scout1");
			check("record: tasks survive with status and deps", back?.tasks[2]?.status === "failed" && JSON.stringify(back?.tasks[1]?.blockedBy) === '["T1"]');
			check("record: cost sums member usage", Math.abs((back?.cost.usd ?? 0) - 0.0035) < 1e-9, String(back?.cost.usd));
			check("record: summary counts done/failed", back?.summary.done === 2 && back?.summary.failed === 1 && back?.summary.members === 2, JSON.stringify(back?.summary));
			check("record: the markdown names the sealed state", fs.readFileSync(jsonPath.replace(/\.json$/, ".md"), "utf8").includes("encrypted"));
			check("record: file mode is 0600", (fs.statSync(jsonPath).mode & 0o777) === 0o600, (fs.statSync(jsonPath).mode & 0o777).toString(8));

			// ---- 2. idempotence ----
			const again = writeCollabRecord(mgr);
			check("record: a second call writes nothing (idempotent)", again.length === 0 && hasRecord(cwd, "team-rec-1"));

			// ---- 3. plaintext when the option is off ----
			const cwd2 = mkCwd();
			ensureTopoDir(cwd2);
			writeCfg({ encryption: { enabled: false }, records: { enabled: true } });
			const w2 = writeCollabRecord(fakeManager(cwd2, "team-rec-2"));
			const raw2 = fs.readFileSync(w2[0], "utf8");
			check("record: plaintext when encryption is disabled", !raw2.includes('"encrypted"') && raw2.includes("修复失败测试"));
			check("record: plaintext still reads back", loadCollabRecord(w2[0])?.teamId === "team-rec-2");
			check("record: the markdown says plaintext", fs.readFileSync(w2[1], "utf8").includes("plaintext"));

			// ---- 4. no key → degrade to plaintext, never throw ----
			const cwd3 = mkCwd(); // no ensureTopoDir: no .topo, no key
			writeCfg({ encryption: { enabled: true }, records: { enabled: true } });
			let threw = false;
			let w3: string[] = [];
			try {
				w3 = writeCollabRecord(fakeManager(cwd3, "team-rec-3"));
			} catch {
				threw = true;
			}
			check("record: no key does not throw", !threw);
			check("record: no key degrades to plaintext", w3.length === 2 && !fs.readFileSync(w3[0], "utf8").includes('"encrypted"'));

			// ---- 5. records.enabled = false ----
			const cwd4 = mkCwd();
			ensureTopoDir(cwd4);
			writeCfg({ encryption: { enabled: true }, records: { enabled: false } });
			check("record: disabled writes nothing", writeCollabRecord(fakeManager(cwd4, "team-rec-4")).length === 0);

			// ---- 6. a custom records.dir ----
			const cwd5 = mkCwd();
			ensureTopoDir(cwd5);
			writeCfg({ encryption: { enabled: false }, records: { enabled: true, dir: "history" } });
			const w5 = writeCollabRecord(fakeManager(cwd5, "team-rec-5"));
			check("record: records.dir is honored", w5[0]?.includes(path.join(".topo", "history")), w5[0] ?? "");

			// ---- 7. an unwritable .topo degrades ----
			const cwd6 = mkCwd();
			fs.writeFileSync(path.join(cwd6, ".topo"), "i am a file\n");
			writeCfg({ encryption: { enabled: true }, records: { enabled: true } });
			let threw6 = false;
			try {
				writeCollabRecord(fakeManager(cwd6, "team-rec-6"));
			} catch {
				threw6 = true;
			}
			check("record: a broken .topo does not throw", !threw6);

			// ---- 8. the config surface and seed block ----
			check("config: records defaults to on with dir=records", d.records.enabled === true && d.records.dir === "records", JSON.stringify(d.records));
			const tmp = mkCwd();
			fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ stepcodeAgentTeam: { records: { dir: 7 } } }));
			const bad = loadConfig({ agentDir: tmp });
			check("config: a non-string records.dir falls back", bad.records.dir === "records", JSON.stringify(bad.records.dir));
			const seedRoot = mkCwd();
			const seedAgent = path.join(seedRoot, "agent");
			fs.mkdirSync(seedAgent, { recursive: true });
			const seedCfg = path.join(seedRoot, "config.toml");
			fs.writeFileSync(seedCfg, "# StepCode configuration\n");
			seedGlobalConfigExample(seedAgent);
			const seeded = fs.readFileSync(seedCfg, "utf8");
			check("seed: the appended block carries [stepcodeAgentTeam.records]", seeded.includes("[stepcodeAgentTeam.records]"));
			check("seed: the block documents both keys", seeded.includes("collaboration record") && seeded.includes('dir = "default"') && seeded.includes('built-in default "records"'));
			check("config: reading it back gives the defaults", getConfig().records.enabled === true);

			if (had) fs.writeFileSync(settingsFile, prev);
			else fs.rmSync(settingsFile, { force: true });
			resetConfigCache();

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE30 DONE (all passed)" : `SMOKE30 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE30 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}
