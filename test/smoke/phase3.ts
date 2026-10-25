/**
 * Phase 3 smoke probe (zero token cost): validates member-to-member messaging
 * plumbing without any LLM call.
 *
 * Verifies:
 *   1. TeamServer starts and answers `status` requests over its Unix socket.
 *   2. The CLI shim (bin/stepcode-team.mjs) round-trips through that socket.
 *   3. Role presets load from agents/ (resolved relative to the extension).
 *   4. createMember with a preset role persists the coordination section.
 *
 * Note: the shim must be spawned ASYNCHRONOUSLY. The TeamServer runs inside
 * this (leader) process, so a blocking spawnSync would stall the event loop and
 * deadlock the round-trip.
 *
 * The actual message dispatch (shim `msg` → sendMessage → LLM) costs tokens and
 * is validated by the user.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { TeamServer } from "../../extensions/team-server.ts";
import { loadPreset, shimPath } from "../../extensions/presets.ts";
import memberMessaging from "../../extensions/member-messaging.ts";

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
		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
		}, 30_000);
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		proc.on("error", (err: Error) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: stderr + err.message });
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...args: unknown[]) => console.error("[smoke3]", ...args);
		const fail = (msg: string) => log("SMOKE3 FAILED:", msg);
		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			const sock = manager.socketPath;
			const server = new TeamServer(sock, () => manager);
			server.start();
			await new Promise((r) => setTimeout(r, 300));

			// 1+2: shim round-trip over the socket (status only, no LLM).
			const shim = shimPath();
			log("shim path:", shim, "exists:", fs.existsSync(shim));
			const res = await runShim(shim, ["status"], { STEPCODE_TEAM_SOCK: sock, STEPCODE_TEAM_MEMBER: "rev1" });
			log("shim status exit:", res.code);
			log("shim status stdout:", res.stdout.trim().slice(0, 300));
			if (res.stderr.trim()) log("shim status stderr:", res.stderr.trim().slice(0, 300));
			if (res.code !== 0 || !res.stdout.includes("teamId")) {
				fail("shim status round-trip broken");
				server.stop();
				return;
			}

			// 3: preset loading.
			const preset = loadPreset("reviewer");
			log(
				"preset reviewer:",
				preset
					? `${preset.name} tools=${preset.tools?.join(",")} model=${preset.model} promptLen=${preset.systemPrompt.length}`
					: "NOT FOUND",
			);
			if (!preset || preset.name !== "reviewer") {
				fail("preset loading broken");
				server.stop();
				return;
			}

			// 3b: project-tier presets are trust-gated — an untrusted repo must not
			// be able to plant or shadow a role (presets carry system prompts and
			// tool allowlists into member processes).
			const projTmp = fs.mkdtempSync(path.join(os.tmpdir(), "scat-trust3-"));
			const projAgents = path.join(projTmp, ".stepcode", "agents");
			fs.mkdirSync(projAgents, { recursive: true });
			fs.writeFileSync(
				path.join(projAgents, "trustprobe.md"),
				["---", "name: trustprobe", "description: Trust-gating probe preset", "---", "", "You are a trust probe preset."].join("\n"),
			);
			const untrustedPreset = loadPreset("trustprobe", projTmp, false);
			const trustedPreset = loadPreset("trustprobe", projTmp, true);
			const untrustedAgain = loadPreset("trustprobe", projTmp, false);
			if (untrustedPreset) {
				fail("project-tier preset loaded from an UNTRUSTED project (trust gate broken)");
			} else {
				log("trust gate: untrusted project tier skipped: OK");
			}
			if (!trustedPreset || trustedPreset.name !== "trustprobe") {
				fail("project-tier preset not loaded from a TRUSTED project");
			} else {
				log("trust gate: trusted project tier loaded: OK");
			}
			if (untrustedAgain) {
				fail("preset cache leaked the trusted project tier into an untrusted load");
			} else {
				log("trust gate: preset cache keyed on trust: OK");
			}
			fs.rmSync(projTmp, { recursive: true, force: true });

			// 4: createMember with a preset role persists prompt + coordination section.
			const { member } = await manager.createMember({ name: "rev1", role: "reviewer" });
			const promptFile = member.systemPromptFile;
			const promptBody = promptFile ? fs.readFileSync(promptFile, "utf8") : "";
			log("member model:", member.model, "tools:", member.tools?.join(","));
			log(
				"prompt has coordination section:",
				promptBody.includes("Team messaging") &&
					promptBody.includes("topo_team_msg") &&
					promptBody.includes("not a messaging target"),
			);
			if (
				member.model !== preset.model ||
				!promptBody.includes("Team messaging") ||
				!promptBody.includes("topo_team_msg") ||
				!promptBody.includes("not a messaging target")
			) {
				fail("preset wiring broken");
				await manager.disband();
				server.stop();
				return;
			}

			// 5: the member-side topo_team_msg tool (0.2.x) — registered only inside a
			// member process (env-driven), speaks the socket protocol directly
			// (no bash), and surfaces topology denials.
			const savedSock = process.env.STEPCODE_TEAM_SOCK;
			const savedMember = process.env.STEPCODE_TEAM_MEMBER;
			const loadMsgTools = (): Array<{
				name: string;
				description?: string;
				parameters?: unknown;
				execute?: (...args: unknown[]) => Promise<unknown>;
			}> => {
				const tools: Array<{
					name: string;
					description?: string;
					parameters?: unknown;
					execute?: (...args: unknown[]) => Promise<unknown>;
				}> = [];
				memberMessaging({ registerTool: (t: (typeof tools)[number]) => tools.push(t) } as unknown as ExtensionAPI);
				return tools;
			};

			delete process.env.STEPCODE_TEAM_SOCK;
			delete process.env.STEPCODE_TEAM_MEMBER;
			const inertTools = loadMsgTools();
			if (inertTools.length !== 0) {
				fail(`topo_team_msg must stay inert outside a member process (got ${inertTools.length} tools)`);
			} else {
				log("topo_team_msg: inert without member env: OK");
			}

			process.env.STEPCODE_TEAM_SOCK = sock;
			process.env.STEPCODE_TEAM_MEMBER = "rev1";
			const msgTools = loadMsgTools();
			const msgTool = msgTools[0];
			if (msgTools.length !== 1 || !msgTool || msgTool.name !== "topo_team_msg") {
				fail("topo_team_msg tool not registered inside a member process");
			} else {
				log("topo_team_msg: registered inside a member process: OK");
				const params = msgTool.parameters as { type?: string; properties?: Record<string, unknown>; required?: string[] };
				if (
					params?.type !== "object" ||
					!params.properties?.to ||
					!params.properties?.message ||
					!(params.required ?? []).includes("to") ||
					!(params.required ?? []).includes("message")
				) {
					fail("topo_team_msg schema must require to + message");
				} else {
					log("topo_team_msg: schema requires to + message: OK");
				}
				if (!(msgTool.description ?? "").includes("topology")) {
					fail("topo_team_msg description must mention the topology gate");
				} else {
					log("topo_team_msg: description mentions the topology gate: OK");
				}
				// Socket round-trip: star topology (no edges) → the server denies
				// and lists the allowed teammates. Proves connect + write + parse +
				// the error path, zero-token (a denial never dispatches).
				if (msgTool.execute) {
					const res = (await msgTool.execute("probe", { to: "ghost", message: "hello" })) as {
						content?: Array<{ text?: string }>;
						isError?: boolean;
						details?: { to?: string };
					};
					const text = res.content?.map((c) => c.text ?? "").join("\n") ?? "";
					if (res.isError !== true || !/topology denies|Allowed teammates/i.test(text)) {
						fail(`topo_team_msg socket round-trip broken: ${text.slice(0, 160)}`);
					} else {
						log("topo_team_msg: topology denial surfaces with the allowed list: OK");
					}
					// details.to echoes the addressed member — the reply is attributed to
					// the target the sender named, not to whoever answered.
					if (res.details?.to !== "ghost") {
						fail(`topo_team_msg details.to must echo the addressed member (got ${JSON.stringify(res.details?.to)})`);
					} else {
						log("topo_team_msg: details.to echoes the addressed member: OK");
					}
					// The leader is not a topology node and has no inbox: a
					// member→leader attempt must be denied with the final-report
					// guidance (2026-10-20 sandbox session: ring/pipeline terminal
					// members hit this and previously got a confusing neighbor list).
					const leaderRes = (await msgTool.execute("probe", { to: "leader", message: "final list" })) as {
						content?: Array<{ text?: string }>;
						isError?: boolean;
						details?: { to?: string };
					};
					const leaderText = leaderRes.content?.map((c) => c.text ?? "").join("\n") ?? "";
					if (
						leaderRes.isError !== true ||
						!/not a messaging target/i.test(leaderText) ||
						!/final report/i.test(leaderText)
					) {
						fail(`topo_team_msg leader target must explain the final-report path: ${leaderText.slice(0, 160)}`);
					} else {
						log("topo_team_msg: leader target denied with final-report guidance: OK");
					}
					if (leaderRes.details?.to !== "leader") {
						fail(`topo_team_msg details.to must echo the addressed member (got ${JSON.stringify(leaderRes.details?.to)})`);
					} else {
						log("topo_team_msg: details.to echoes the addressed member: OK");
					}
				}
			}

			if (savedSock === undefined) delete process.env.STEPCODE_TEAM_SOCK;
			else process.env.STEPCODE_TEAM_SOCK = savedSock;
			if (savedMember === undefined) delete process.env.STEPCODE_TEAM_MEMBER;
			else process.env.STEPCODE_TEAM_MEMBER = savedMember;

			await manager.disband();
			server.stop();
			log("SMOKE3 DONE");
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
		}
	});
}
