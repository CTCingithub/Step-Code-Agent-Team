/**
 * Default-off activation + config file regression probe (plan v2).
 *
 * Zero-token: no LLM calls. Member spawns happen (handshake only) for the
 * model/thinking resolution checks; each member is disbanded immediately.
 *
 * Run with three configs:
 *   default (no file)         → off-paths + activation + off-mode resolution
 *   autonomous on             → on-mode model/thinking resolution
 *   activation.enabled=false  → activation refused, tools stay hidden
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { consumeKeywordMigration, defaultConfig, getConfig, loadConfig, resetConfigCache } from "../../extensions/config.ts";
import { loadPreset } from "../../extensions/presets.ts";
import { TEAM_TOOL_NAMES, activate, detectKeyword, detectSlashCommand, initActivation } from "../../extensions/activation.ts";

const LEADER_MODEL = "step-5-preview";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke6]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const cfg = getConfig();
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			// Module state is per loaded extension (not shared with index.ts), so
			// initialize this probe's own activation instance to unit-test the
			// detection/gating logic. Tool release + socket startup are index.ts
			// wiring and are covered by the LLM end-to-end run.
			initActivation(cfg, pi, () => {});

			// 1. default-off state
			const toolsBefore = pi.getAllTools().map((t) => t.name);
			check(
				"default-off: team tools hidden",
				!TEAM_TOOL_NAMES.some((n) => toolsBefore.includes(n)),
				toolsBefore.join(","),
			);
			check("default-off: socket absent", !fs.existsSync(manager.socketPath));
			const commands = pi.getCommands().map((c) => c.name);
			check("command registered: topo", commands.includes("topo"));
			check("command removed: agent-team (0.2.0 hard cut)", !commands.includes("agent-team"));

			// 2. pure config tests (synthetic dirs)
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scat-cfg-"));
			const defaults = defaultConfig();
			const d = loadConfig({ agentDir: tmp });
			check("config defaults: models.available", d.models.available.join(",") === "step-5-preview");
			check(
				"config defaults: autonomous flags off",
				d.models.autonomousSelection === false && d.models.autonomousThinking === false,
			);
			check("config defaults: dispatch.retries", d.dispatch.retries === defaults.dispatch.retries);

			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({
					stepcodeAgentTeam: {
						activation: { keywords: ["magic word"], notifyOnActivate: false },
						models: { available: ["m1", "m2"], autonomousSelection: true, autonomousThinking: true },
						members: { max: 3 },
						cost: { warnThreshold: 0 },
						bogusSection: { x: 1 },
					},
				}),
			);
			const c1 = loadConfig({ agentDir: tmp });
			check("settings section: keywords override", JSON.stringify(c1.activation.keywords) === '["magic word"]');
			check(
				"settings section: models override",
				c1.models.available.join(",") === "m1,m2" && c1.models.autonomousSelection === true,
			);
			check("settings section: members.max", c1.members.max === 3);
			check("settings section: cost disable", c1.cost.warnThreshold === 0);
			check(
				"settings section: unknown keys ignored",
				!("bogusSection" in (c1 as unknown as Record<string, unknown>)),
			);

			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({
					stepcodeAgentTeam: {
						members: { max: "eight" },
						models: { available: [] },
						dispatch: { maxConcurrent: -2, timeoutMs: 10, retries: 99 },
						cost: { warnThreshold: "abc" },
						idle: { reapAfterMs: 1 },
					},
				}),
			);
			const c2 = loadConfig({ agentDir: tmp });
			check("settings invalid: members.max fallback", c2.members.max === defaults.members.max);
			check("settings invalid: models.available fallback", c2.models.available.join(",") === "step-5-preview");
			check(
				"settings invalid: dispatch fallbacks",
				c2.dispatch.maxConcurrent === defaults.dispatch.maxConcurrent &&
					c2.dispatch.timeoutMs === defaults.dispatch.timeoutMs &&
					c2.dispatch.retries === defaults.dispatch.retries,
			);
			check("settings invalid: cost fallback", c2.cost.warnThreshold === defaults.cost.warnThreshold);
			check("settings invalid: idle fallback", c2.idle.reapAfterMs === defaults.idle.reapAfterMs);

			// legacy dedicated file: still honored; the settings section wins over it
			fs.rmSync(path.join(tmp, "settings.json"));
			fs.writeFileSync(
				path.join(tmp, "stepcode-agent-team.json"),
				JSON.stringify({ members: { max: 5 }, cost: { warnThreshold: 7 } }),
			);
			const cLegacy = loadConfig({ agentDir: tmp });
			check("legacy file: still honored", cLegacy.members.max === 5, `got ${cLegacy.members.max}`);
			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({ stepcodeAgentTeam: { members: { max: 6 } } }),
			);
			const cBoth = loadConfig({ agentDir: tmp });
			check("legacy file: settings section overrides", cBoth.members.max === 6, `got ${cBoth.members.max}`);
			check("legacy file: unoverridden keys survive", cBoth.cost.warnThreshold === 7, `got ${cBoth.cost.warnThreshold}`);

			// 2b. forced keyword migration (0.2.0): deprecated terms are stripped
			// from the effective list (the user's file is never rewritten).
			fs.writeFileSync(
				path.join(tmp, "settings.json"),
				JSON.stringify({ stepcodeAgentTeam: { activation: { keywords: ["智能体团队", "组小队", "agent team"] } } }),
			);
			const cMig = loadConfig({ agentDir: tmp });
			check(
				"migration: deprecated keywords stripped",
				JSON.stringify(cMig.activation.keywords) === '["组小队"]',
				`got ${JSON.stringify(cMig.activation.keywords)}`,
			);
			const migratedTerms = consumeKeywordMigration();
			check(
				"migration: stripped terms reported",
				migratedTerms.length === 2 && migratedTerms.includes("智能体团队") && migratedTerms.includes("agent team"),
				`got ${migratedTerms.join(",")}`,
			);
			fs.rmSync(tmp, { recursive: true, force: true });

			// 3. detection
			check("detectKeyword: zh positive", detectKeyword("请用智能体小队并行审查这个仓库"));
			check("detectKeyword: en positive", detectKeyword("let's spin up a topo team"));
			check("detectKeyword: negative", !detectKeyword("hello world, please fix the typo"));
			check(
				"detectSlashCommand",
				detectSlashCommand("/topo") &&
					detectSlashCommand("  /topo economy") &&
					!detectSlashCommand("/agent-team") &&
					!detectSlashCommand("/model x"),
			);
			// 3b. L1 false-positive guard (0.2.0): negation / meta-discussion /
			// code references must not activate; real requests still do.
			check("guard: negation suppressed", !detectKeyword("不用组小队，先跑单智能体"));
			check("guard: meta-discussion suppressed", !detectKeyword("什么是智能体小队？"));
			check("guard: code reference suppressed", !detectKeyword("把 `智能体小队` 加进 keywords"));
			check("guard: bare topo is not a keyword", !detectKeyword("topo"));
			check("guard: topology does not match topo team", !detectKeyword("阅读 topology.ts 的设计"));
			check("guard: real request still activates", detectKeyword("请用智能体小队并行审查这个仓库"));

			// 3c. custom roles (0.2.0): user-level <agentDir>/agents/ presets load
			// like built-in ones (same frontmatter format, effort included).
			const agentDir = process.env.STEP_CODING_AGENT_DIR;
			if (agentDir) {
				const userAgentsDir = path.join(agentDir, "agents");
				fs.mkdirSync(userAgentsDir, { recursive: true });
				fs.writeFileSync(
					path.join(userAgentsDir, "tester.md"),
					[
						"---",
						"name: tester",
						"description: Custom role probe fixture",
						"tools: read, grep",
						"effort: xhigh",
						"---",
						"",
						"You are a test role fixture.",
					].join("\n"),
				);
				const custom = loadPreset("tester", ctx.cwd);
				check(
					"custom role: loaded from <agentDir>/agents/ with effort",
					custom?.name === "tester" && custom.effort === "xhigh",
					`got ${custom?.name}/${custom?.effort}`,
				);
			}

			// 4. activation logic
			if (cfg.activation.enabled) {
				check("activation: fresh call true", activate("probe") === true);
				check("activation: idempotent", activate("probe again") === false);

				// 5. model / thinking resolution (spawn + disband per case)
				if (!cfg.models.autonomousSelection) {
					const r1 = await manager.createMember({ name: "res1", role: "worker", model: "some-other-model" }, LEADER_MODEL);
					check("resolution: off → conversation model", r1.member.model === LEADER_MODEL, `got ${r1.member.model}`);
					check("resolution: thinking from preset (worker=medium)", r1.member.thinking === "medium", `got ${r1.member.thinking}`);
					await manager.disband("res1");
					const r2 = await manager.createMember({ name: "res2", role: "worker", thinking: "low" }, LEADER_MODEL);
					check("resolution: explicit thinking honored", r2.member.thinking === "low", `got ${r2.member.thinking}`);
					await manager.disband("res2");
				} else {
					const r1 = await manager.createMember({ name: "res1", role: "worker", model: "step-5-preview" }, LEADER_MODEL);
					check("resolution: on → explicit available model", r1.member.model === "step-5-preview", `got ${r1.member.model}`);
					await manager.disband("res1");
					let bogusThrew = false;
					try {
						await manager.createMember({ name: "res2", role: "worker", model: "bogus-model" }, LEADER_MODEL);
					} catch (err) {
						bogusThrew = /available models/.test(err instanceof Error ? err.message : "");
					}
					check("resolution: on → invalid model throws with list", bogusThrew);
					const r3 = await manager.createMember({ name: "res3", role: "worker", thinking: "xhigh" }, LEADER_MODEL);
					check("resolution: on → explicit thinking honored", r3.member.thinking === "xhigh", `got ${r3.member.thinking}`);
					await manager.disband("res3");
					const r4 = await manager.createMember({ name: "res4", role: "worker" }, LEADER_MODEL);
					check("resolution: on + no model → conversation model", r4.member.model === LEADER_MODEL, `got ${r4.member.model}`);
					check("resolution: on + no thinking → preset medium", r4.member.thinking === "medium", `got ${r4.member.thinking}`);
					await manager.disband("res4");
				}
			} else {
				check("disabled config: activate refused", activate("probe") === false);
				const toolsAfter = pi.getAllTools().map((t) => t.name);
				check("disabled config: tools still hidden", !TEAM_TOOL_NAMES.some((n) => toolsAfter.includes(n)));
			}

			// 6. presets.effort config override (0.2.0): the config value beats the
			// preset frontmatter; explicit params still beat both.
			const agentDir6 = process.env.STEP_CODING_AGENT_DIR;
			if (agentDir6) {
				fs.writeFileSync(
					path.join(agentDir6, "settings.json"),
					JSON.stringify({ stepcodeAgentTeam: { presets: { effort: { worker: "xhigh" } } } }),
				);
				resetConfigCache();
				const r5 = await manager.createMember({ name: "res5", role: "worker" }, LEADER_MODEL);
				check("presets.effort: config overrides preset effort", r5.member.thinking === "xhigh", `got ${r5.member.thinking}`);
				await manager.disband("res5");
				fs.rmSync(path.join(agentDir6, "settings.json"));
				resetConfigCache();
			}

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE6 DONE (all passed)" : `SMOKE6 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE6 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
