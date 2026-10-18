/**
 * Ring loop bound probe (plan-52). Zero-token: member spawns are handshake
 * only, and every loop-limit path rejects before a dispatch reaches a model.
 *
 * Covers: topology.maxLoopCount default (2), file override, 0 = unlimited,
 * out-of-range/invalid fallback; manager-level rejection of an over-long
 * nested chain (throws before dispatch); server-level rejection through the
 * shim while a member is mid-chain (simulated deterministically via
 * withChainLength — no timing luck); topology denial still precedes the loop
 * check; a chain at exactly the limit is allowed through.
 *
 * The probe stages a short dispatch timeout and removes STEP_API_KEY from its
 * own environment (restored on exit) so the one allowed dispatch fails fast
 * instead of spending tokens.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager, wouldCycle } from "../../extensions/members.ts";
import { TeamServer } from "../../extensions/team-server.ts";
import { agentDir, defaultConfig, getConfig, loadConfig, resetConfigCache } from "../../extensions/config.ts";
import { shimPath } from "../../extensions/presets.ts";
import { TopologyError } from "../../extensions/topology.ts";

// Stage a short request timeout before any member spawns (members.ts reads
// getConfig() at spawn time; index.ts's cached copy is irrelevant here).
const CFG_FILE = path.join(agentDir(), "settings.json");
const hadCfg = fs.existsSync(CFG_FILE);
const savedCfg = hadCfg ? fs.readFileSync(CFG_FILE, "utf8") : null;
fs.writeFileSync(CFG_FILE, JSON.stringify({ stepcodeAgentTeam: { dispatch: { timeoutMs: 5000 } } }));
resetConfigCache();

// Keep the suite zero-token even when the shell exports a key.
const savedKey = process.env.STEP_API_KEY;
delete process.env.STEP_API_KEY;

function runShim(
	shim: string,
	args: string[],
	env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawn("node", [shim, ...args], {
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});
		const timer = setTimeout(() => proc.kill("SIGTERM"), 30_000);
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		proc.on("error", (err: Error) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: `${stderr}${err.message}` });
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke14]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// ---- 1. config surface ----
			const d = defaultConfig();
			check("config: maxLoopCount default 2", getConfig().topology.maxLoopCount === 2, `got ${getConfig().topology.maxLoopCount}`);
			check("config: defaultConfig carries maxLoopCount", d.topology.maxLoopCount === 2, `got ${d.topology.maxLoopCount}`);

			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scat-loop14-"));
			const write = (obj: unknown) =>
				fs.writeFileSync(path.join(tmp, "settings.json"), JSON.stringify({ stepcodeAgentTeam: obj }));
			write({ topology: { maxLoopCount: 5 } });
			check("config: settings section override", loadConfig({ agentDir: tmp }).topology.maxLoopCount === 5);
			write({ topology: { maxLoopCount: 0 } });
			check("config: 0 (unlimited) accepted", loadConfig({ agentDir: tmp }).topology.maxLoopCount === 0);
			write({ topology: { maxLoopCount: 999 } });
			check("config: out-of-range → default", loadConfig({ agentDir: tmp }).topology.maxLoopCount === 2, `got ${loadConfig({ agentDir: tmp }).topology.maxLoopCount}`);
			write({ topology: { maxLoopCount: "two" } });
			check("config: invalid type → default", loadConfig({ agentDir: tmp }).topology.maxLoopCount === 2);
			// legacy dedicated file still honored when no settings section exists
			fs.rmSync(path.join(tmp, "settings.json"));
			fs.writeFileSync(
				path.join(tmp, "stepcode-agent-team.json"),
				JSON.stringify({ topology: { maxLoopCount: 4 } }),
			);
			check("config: legacy file fallback", loadConfig({ agentDir: tmp }).topology.maxLoopCount === 4, `got ${loadConfig({ agentDir: tmp }).topology.maxLoopCount}`);
			fs.rmSync(tmp, { recursive: true, force: true });

			// ---- 1b. wait-cycle detection (pure helper behind the server guard) ----
			const wf = new Map<string, string>([
				["a", "b"],
				["b", "c"],
			]);
			check("cycle: unrelated pair → no cycle", !wouldCycle(wf, "a", "c"), "c does not wait on a");
			check("cycle: direct wait → cycle", wouldCycle(wf, "b", "a"), "a waits on b");
			check("cycle: transitive wait → cycle", wouldCycle(wf, "c", "a"), "a → b → c");
			check("cycle: empty map → no cycle", !wouldCycle(new Map(), "x", "y"));

			// ---- 2. manager-level rejection (before any dispatch) ----
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			await manager.createMember({ name: "m1" });
			await manager.createMember({ name: "m2" });
			manager.setTopology("ring"); // m1→m2, m2→m1

			let msg = "";
			let isTopo = false;
			try {
				await manager.sendMessage("m2", "must not run", { nested: true, chainLength: 3 });
			} catch (err) {
				msg = err instanceof Error ? err.message : String(err);
				isTopo = err instanceof TopologyError;
			}
			check("manager: over-long nested chain rejected", isTopo && /loop|chain/i.test(msg), msg.slice(0, 160));
			check(
				"manager: rejection leaves member untouched",
				manager.snapshot().members.find((m) => m.name === "m2")?.status === "idle",
			);

			// ---- 3. server-level enforcement through the shim ----
			const server = new TeamServer(manager.socketPath, () => manager);
			server.start();
			await new Promise((r) => setTimeout(r, 300));
			const shim = shimPath();
			const sockEnv = { STEPCODE_TEAM_SOCK: manager.socketPath, STEPCODE_TEAM_MEMBER: "m2" };

			// m2 mid-chain at the limit (2): next hop would be 3 > 2 → rejected.
			const denied = await manager.withChainLength("m2", 2, async () => {
				check("server: m2 mid-chain at limit", manager.currentChainLength("m2") === 2);
				return runShim(shim, ["msg", "--to", "m1", "--message", "ping"], sockEnv);
			});
			check("server: shim msg beyond loop limit rejected", denied.code !== 0, `code=${denied.code} err=${denied.stderr.trim().slice(0, 120)}`);
			check("server: rejection explains loop limit", /loop|chain/i.test(denied.stderr), denied.stderr.trim().slice(0, 160));
			check("server: chain bookkeeping released", manager.currentChainLength("m2") === 0, `got ${manager.currentChainLength("m2")}`);

			// Topology denial must still take precedence over the loop check.
			manager.setTopology("star");
			const starDenied = await manager.withChainLength("m2", 2, () =>
				runShim(shim, ["msg", "--to", "m1", "--message", "ping"], sockEnv),
			);
			check("server: topology denial precedes loop check", /topology denies/.test(starDenied.stderr), starDenied.stderr.trim().slice(0, 160));

			// Boundary: chain at exactly limit-1 → next hop == limit → allowed
			// through the loop gate (it then fails on the missing model, which
			// must not be reported as a loop rejection).
			manager.setTopology("ring");
			const boundary = await manager.withChainLength("m2", 1, () =>
				runShim(shim, ["msg", "--to", "m1", "--message", "ping"], sockEnv),
			);
			const boundaryOut = `${boundary.stdout}${boundary.stderr}`;
			check("server: chain at limit boundary allowed through", !/loop limit|chain length/i.test(boundaryOut), boundaryOut.trim().slice(0, 160));

			server.stop();
			await manager.disband();

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE14 DONE (all passed)" : `SMOKE14 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE14 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			if (savedKey === undefined) delete process.env.STEP_API_KEY;
			else process.env.STEP_API_KEY = savedKey;
			if (hadCfg && savedCfg !== null) fs.writeFileSync(CFG_FILE, savedCfg);
			else try {
				fs.unlinkSync(CFG_FILE);
			} catch {
				/* not present */
			}
		}
	});
}
