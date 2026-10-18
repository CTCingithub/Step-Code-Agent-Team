/**
 * Config boundary probe (plan-43). Zero-token.
 * Covers: full-section settings.json config (stepcodeAgentTeam section),
 * legacy dedicated-file fallback, storage.dir redirection, pure loadConfig
 * (merge / invalid fallback / unknown keys / env overrides), project-level
 * config wiring (applied when trusted, ignored otherwise), and idle reaping.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { agentDir, defaultConfig, getConfig, loadConfig } from "../../extensions/config.ts";
import { teamsRoot } from "../../extensions/registry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke9]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const cfg = getConfig();
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			// 1. ambient config reflects the settings.json stepcodeAgentTeam
			// section (or the legacy dedicated file), asserted per present section
			const settingsFile = path.join(agentDir(), "settings.json");
			const legacyFile = path.join(agentDir(), "stepcode-agent-team.json");
			const readAmbient = (): Record<string, Record<string, unknown>> | null => {
				if (fs.existsSync(settingsFile)) {
					try {
						const doc = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
						const section = doc.stepcodeAgentTeam;
						if (typeof section === "object" && section !== null && !Array.isArray(section)) {
							return section as Record<string, Record<string, unknown>>;
						}
						return null;
					} catch {
						return null;
					}
				}
				if (fs.existsSync(legacyFile)) {
					return JSON.parse(fs.readFileSync(legacyFile, "utf8")) as Record<string, Record<string, unknown>>;
				}
				return null;
			};
			const raw = readAmbient();
			if (raw) {
				const expect = (label: string, actual: unknown, wanted: unknown) =>
					check(`ambient config: ${label}`, JSON.stringify(actual) === JSON.stringify(wanted), `got ${JSON.stringify(actual)}`);
				if (raw.activation) {
					expect("activation.keywords", cfg.activation.keywords, raw.activation.keywords);
					expect("activation.notifyOnActivate", cfg.activation.notifyOnActivate, raw.activation.notifyOnActivate);
				}
				if (raw.models) {
					expect("models.available", cfg.models.available, raw.models.available);
					expect("models.autonomousSelection", cfg.models.autonomousSelection, raw.models.autonomousSelection);
					expect("models.autonomousThinking", cfg.models.autonomousThinking, raw.models.autonomousThinking);
				}
				if (raw.members) {
					expect("members.max", cfg.members.max, raw.members.max);
					expect("members.defaultRole", cfg.members.defaultRole, raw.members.defaultRole);
					expect("members.maxRecursionDepth", cfg.members.maxRecursionDepth, raw.members.maxRecursionDepth);
				}
				if (raw.dispatch) {
					expect("dispatch.maxConcurrent", cfg.dispatch.maxConcurrent, raw.dispatch.maxConcurrent);
					expect("dispatch.timeoutMs", cfg.dispatch.timeoutMs, raw.dispatch.timeoutMs);
					expect("dispatch.retries", cfg.dispatch.retries, raw.dispatch.retries);
				}
				if (raw.oneshot) expect("oneshot.timeoutMs", cfg.oneshot.timeoutMs, raw.oneshot.timeoutMs);
				if (raw.cost) expect("cost.warnThreshold", cfg.cost.warnThreshold, raw.cost.warnThreshold);
				if (raw.idle) {
					expect("idle.reapAfterMs", cfg.idle.reapAfterMs, raw.idle.reapAfterMs);
					expect("idle.reapIntervalMs", cfg.idle.reapIntervalMs, raw.idle.reapIntervalMs);
				}
				if (raw.debug !== undefined) expect("debug", cfg.debug, raw.debug);
			} else {
				check("no config file: built-in defaults", cfg.members.maxRecursionDepth === defaultConfig().members.maxRecursionDepth);
			}

			// 2. storage.dir redirection
			if (cfg.storage.dir) {
				const expected = path.resolve(cfg.storage.dir);
				check("storage.dir: teamsRoot redirected", teamsRoot() === expected, `got ${teamsRoot()}`);
				check(
					"storage.dir: team registry created there",
					fs.existsSync(path.join(expected, manager.teamId, "registry.json")),
				);
			}

			// 3. pure loadConfig tests (synthetic dirs)
			const d = defaultConfig();
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scat-cfg9-"));
			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({
					stepcodeAgentTeam: {
						activation: { keywords: ["k1"] },
						models: { available: ["m1"], autonomousSelection: true },
						members: { max: 2, maxRecursionDepth: 3 },
						dispatch: { maxConcurrent: 7 },
						cost: { warnThreshold: 0.25 },
						unknownTop: { x: 1 },
					},
				}),
			);
			const c1 = loadConfig({ agentDir: tmp });
			check(
				"loadConfig: sections merge",
				c1.activation.keywords.join(",") === "k1" &&
					c1.members.max === 2 &&
					c1.members.maxRecursionDepth === 3 &&
					c1.dispatch.maxConcurrent === 7 &&
					c1.models.autonomousSelection === true,
			);
			check("loadConfig: unknown keys ignored", !("unknownTop" in (c1 as unknown as Record<string, unknown>)));

			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({
					stepcodeAgentTeam: {
						members: { max: "eight", maxRecursionDepth: 9 },
						models: { available: [] },
						dispatch: { maxConcurrent: -2 },
						cost: { warnThreshold: "abc" },
						topology: { default: "bogus" },
					},
				}),
			);
			const c2 = loadConfig({ agentDir: tmp });
			check("loadConfig: invalid members.max → default", c2.members.max === d.members.max, `got ${c2.members.max}`);
			check(
				"loadConfig: invalid maxRecursionDepth → default",
				c2.members.maxRecursionDepth === d.members.maxRecursionDepth,
				`got ${c2.members.maxRecursionDepth}`,
			);
			check("loadConfig: empty models.available → default", c2.models.available.join(",") === d.models.available.join(","));
			check(
				"loadConfig: invalid maxConcurrent → default",
				c2.dispatch.maxConcurrent === d.dispatch.maxConcurrent,
				`got ${c2.dispatch.maxConcurrent}`,
			);
			check("loadConfig: invalid cost → default", c2.cost.warnThreshold === d.cost.warnThreshold);
			check("loadConfig: invalid topology.default → default", c2.topology.default === d.topology.default, `got ${c2.topology.default}`);

			// env overrides
			const savedCost = process.env.STEPCODE_TEAM_COST_WARN;
			const savedDebug = process.env.STEPCODE_TEAM_DEBUG;
			fs.writeFileSync(path.join(tmp, "settings.json"), "{}");
			process.env.STEPCODE_TEAM_COST_WARN = "2.5";
			process.env.STEPCODE_TEAM_DEBUG = "1";
			const c3 = loadConfig({ agentDir: tmp });
			check("loadConfig: env cost override", c3.cost.warnThreshold === 2.5, `got ${c3.cost.warnThreshold}`);
			check("loadConfig: env debug override", c3.debug === true);
			if (savedCost === undefined) delete process.env.STEPCODE_TEAM_COST_WARN;
			else process.env.STEPCODE_TEAM_COST_WARN = savedCost;
			if (savedDebug === undefined) delete process.env.STEPCODE_TEAM_DEBUG;
			else process.env.STEPCODE_TEAM_DEBUG = savedDebug;
			fs.rmSync(tmp, { recursive: true, force: true });

			// 4. project-level config is wired: applied when trusted, ignored otherwise
			const proj = fs.mkdtempSync(path.join(os.tmpdir(), "scat-proj9-"));
			fs.mkdirSync(path.join(proj, ".stepcode"), { recursive: true });
			const projectCfg = path.join(proj, ".stepcode", "settings.json");
			fs.writeFileSync(projectCfg, JSON.stringify({ stepcodeAgentTeam: { members: { max: 7 } } }));
			const c4 = loadConfig({ agentDir: agentDir(), projectDir: proj, trusted: true });
			check("project config: applied when trusted", c4.members.max === 7, `got ${c4.members.max}`);
			const c4b = loadConfig({ agentDir: agentDir(), projectDir: proj, trusted: false });
			check("project config: ignored when untrusted", c4b.members.max !== 7, `got ${c4b.members.max}`);
			check("project config: cached ambient config unaffected", getConfig().members.max !== 7, `got ${getConfig().members.max}`);
			// legacy project file still honored when no settings section exists
			fs.rmSync(projectCfg);
			fs.writeFileSync(
				path.join(proj, ".stepcode", "stepcode-agent-team.json"),
				JSON.stringify({ members: { max: 9 } }),
			);
			const c4c = loadConfig({ agentDir: agentDir(), projectDir: proj, trusted: true });
			check("project config: legacy file fallback", c4c.members.max === 9, `got ${c4c.members.max}`);
			fs.rmSync(proj, { recursive: true, force: true });

			// 5. idle reaper (the member must have been idle longer than the
			// threshold: doSpawn touches lastActivity, so wait before reaping)
			const { member } = await manager.createMember({ name: "r1" });
			const pid = member.pid;
			await new Promise((r) => setTimeout(r, 1500));
			const reaped = await manager.reapIdleMembers(1000);
			check("reaper: idle member reaped", reaped.includes("r1"), `reaped=${reaped.join(",")}`);
			check(
				"reaper: status marked dead",
				manager.snapshot().members.find((m) => m.name === "r1")?.status === "dead",
			);
			let gone = false;
			for (let i = 0; i < 10 && !gone; i++) {
				await new Promise((r) => setTimeout(r, 1000));
				try {
					process.kill(pid, 0);
				} catch {
					gone = true;
				}
			}
			check("reaper: process terminated", gone, gone ? "" : `pid ${pid} still alive after 10s`);

			await manager.disband();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE9 DONE (all passed)" : `SMOKE9 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE9 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
