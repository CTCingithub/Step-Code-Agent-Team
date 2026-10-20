/**
 * Recursion depth + concurrency regression probe (plan-37). Zero-token:
 * members are spawned for handshake only; /proc inspection reads the real
 * spawn arguments and environment of the member process.
 *
 * Run A (default config, maxRecursionDepth=1): members are isolated
 * (--no-extensions, no auto-activate, no sub-team directory).
 * Run B (maxRecursionDepth=2): members load the extension with auto-activate
 * and bootstrap their own sub-team (registry + socket appear on disk).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { currentDepth, TeamManager } from "../../extensions/members.ts";
import { defaultConfig, getConfig } from "../../extensions/config.ts";
import { extensionEntryPath, memberMessagingEntryPath } from "../../extensions/presets.ts";
import { teamsRoot } from "../../extensions/registry.ts";

function procCmdline(pid: number): string[] {
	try {
		return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
	} catch {
		return [];
	}
}

function procEnv(pid: number): Record<string, string> {
	try {
		const env: Record<string, string> = {};
		for (const entry of fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
			const idx = entry.indexOf("=");
			if (idx > 0) env[entry.slice(0, idx)] = entry.slice(idx + 1);
		}
		return env;
	} catch {
		return {};
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke8]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const cfg = getConfig();
			const defaults = defaultConfig();
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			// 1. built-in defaults (the requirement: depth 1, concurrency 5)
			check("built-in default: maxRecursionDepth = 1", defaults.members.maxRecursionDepth === 1, `got ${defaults.members.maxRecursionDepth}`);
			check("built-in default: maxConcurrent = 5", defaults.dispatch.maxConcurrent === 5, `got ${defaults.dispatch.maxConcurrent}`);
			check("config: maxRecursionDepth valid (1–4)", Number.isInteger(cfg.members.maxRecursionDepth) && cfg.members.maxRecursionDepth >= 1 && cfg.members.maxRecursionDepth <= 4, `got ${cfg.members.maxRecursionDepth}`);

			// 2. currentDepth parsing (env-driven, restored afterwards)
			const savedDepth = process.env.STEPCODE_TEAM_DEPTH;
			process.env.STEPCODE_TEAM_DEPTH = "2";
			check("currentDepth: reads env", currentDepth() === 2, `got ${currentDepth()}`);
			process.env.STEPCODE_TEAM_DEPTH = "bogus";
			check("currentDepth: invalid → 0", currentDepth() === 0, `got ${currentDepth()}`);
			if (savedDepth === undefined) delete process.env.STEPCODE_TEAM_DEPTH;
			else process.env.STEPCODE_TEAM_DEPTH = savedDepth;

			// 3. spawn a member and inspect its real process
			const { member } = await manager.createMember({ name: "m1", role: "worker" });
			const cmdline = procCmdline(member.pid);
			const env = procEnv(member.pid);
			const entry = extensionEntryPath();
			const canOrchestrate = 1 < cfg.members.maxRecursionDepth;

			check("spawn: session-id arg present", cmdline.includes(member.sessionId), cmdline.join(" ").slice(0, 160));
			check("spawn: depth env = 1", env.STEPCODE_TEAM_DEPTH === "1", `got ${env.STEPCODE_TEAM_DEPTH}`);
			check("spawn: member identity env", env.STEPCODE_TEAM_MEMBER === "m1", `got ${env.STEPCODE_TEAM_MEMBER}`);
			check("spawn: sock env points at the team server", (env.STEPCODE_TEAM_SOCK ?? "").endsWith("/sock"), `got ${env.STEPCODE_TEAM_SOCK}`);
			// topo_team_msg is team infrastructure: present in the --tools allowlist for
			// every member (no bash needed, so read-only presets can message too).
			const toolsIdx = cmdline.indexOf("--tools");
			const allowlist = toolsIdx >= 0 ? (cmdline[toolsIdx + 1] ?? "").split(",") : [];
			check("spawn: topo_team_msg in the tools allowlist", allowlist.includes("topo_team_msg"), `got ${allowlist.join(",")}`);

			if (canOrchestrate) {
				// Depth grant: the extension is loaded and auto-activated in the member.
				check("depth grant: extension entry arg (-e)", cmdline.includes("-e") && cmdline.includes(entry), cmdline.join(" ").slice(0, 200));
				check("depth grant: messaging extension also loads", cmdline.includes(memberMessagingEntryPath()), cmdline.join(" ").slice(0, 240));
				check("depth grant: auto-activate env", env.STEPCODE_TEAM_AUTOACTIVATE === "1", `got ${env.STEPCODE_TEAM_AUTOACTIVATE}`);
				check("depth grant: not --no-extensions", !cmdline.includes("--no-extensions"));

				// The member bootstraps its own sub-team (registry + socket on disk).
				const subDir = path.join(teamsRoot(), `team-${manager.teamId}-m1`);
				let bootstrapped = false;
				for (let i = 0; i < 24; i++) {
					await new Promise((r) => setTimeout(r, 500));
					if (fs.existsSync(path.join(subDir, "registry.json")) && fs.existsSync(path.join(subDir, "sock"))) {
						bootstrapped = true;
						break;
					}
				}
				check("sub-team bootstrapped (registry + socket)", bootstrapped, subDir);
			} else {
				// Depth 1: the member stays isolated.
				check("depth 1: member isolated (--no-extensions)", cmdline.includes("--no-extensions"), cmdline.join(" ").slice(0, 200));
				check("depth 1: no auto-activate env", env.STEPCODE_TEAM_AUTOACTIVATE === undefined, `got ${env.STEPCODE_TEAM_AUTOACTIVATE}`);
				// Depth 1: only the member-side messaging extension loads (topo_team_msg);
				// the team extension itself stays out (no recursive teams).
				check(
					"depth 1: only the messaging extension loads",
					cmdline.includes("--no-extensions") &&
						cmdline.includes("-e") &&
						cmdline.includes(memberMessagingEntryPath()) &&
						!cmdline.includes(extensionEntryPath()),
					cmdline.join(" ").slice(0, 240),
				);
				const subDir = path.join(teamsRoot(), `team-${manager.teamId}-m1`);
				await new Promise((r) => setTimeout(r, 1500));
				check("depth 1: no sub-team directory", !fs.existsSync(subDir), subDir);
			}

			await manager.disband();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE8 DONE (all passed)" : `SMOKE8 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE8 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
