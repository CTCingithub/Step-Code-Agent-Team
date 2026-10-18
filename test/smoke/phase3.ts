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
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { TeamServer } from "../../extensions/team-server.ts";
import { loadPreset, shimPath } from "../../extensions/presets.ts";

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

			// 4: createMember with a preset role persists prompt + coordination section.
			const { member } = await manager.createMember({ name: "rev1", role: "reviewer" });
			const promptFile = member.systemPromptFile;
			const promptBody = promptFile ? fs.readFileSync(promptFile, "utf8") : "";
			log("member model:", member.model, "tools:", member.tools?.join(","));
			log(
				"prompt has coordination section:",
				promptBody.includes("Team messaging") && promptBody.includes(shim),
			);
			if (member.model !== preset.model || !promptBody.includes("Team messaging") || !promptBody.includes(shim)) {
				fail("preset wiring broken");
				await manager.disband();
				server.stop();
				return;
			}

			await manager.disband();
			server.stop();
			log("SMOKE3 DONE");
		} catch (err) {
			fail(err instanceof Error ? err.message : String(err));
		}
	});
}
