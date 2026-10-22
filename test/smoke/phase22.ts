/**
 * Phase 22 smoke probe (zero token): self-heal regression guards for the
 * 2026-10-20 fix (team tools going "tool not found" mid-session after a
 * host-side reset hid them with no recovery path). Covers both recovery legs:
 *   1. ensureToolsAvailable() re-asserting the tools after a simulated host
 *      reset (unavailability declaration + emptied active selection) — and
 *      staying a no-op while the plugin is inactive;
 *   2. the session_start re-activation predicate: a team registry on disk for
 *      this session (teamIdForSession + registryPath) — and none for a foreign
 *      session.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import * as fs from "node:fs";
import { TeamManager, teamIdForSession } from "../../extensions/members.ts";
import { registryPath } from "../../extensions/registry.ts";
import { defaultConfig } from "../../extensions/config.ts";
import {
	TEAM_TOOL_NAMES,
	activate,
	deactivate,
	ensureToolsAvailable,
	initActivation,
	isActive,
} from "../../extensions/activation.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke22]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// ---- 1. ensureToolsAvailable after a simulated host-side reset ----
			let unavailable: string[] = [...TEAM_TOOL_NAMES];
			let activeTools: string[] = [];
			const stub = {
				setUnavailableTools: (names: string[]) => {
					unavailable = [...names];
				},
				getActiveTools: () => [...activeTools],
				setActiveTools: (names: string[]) => {
					activeTools = [...names];
				},
			};
			const cfg = defaultConfig();
			initActivation(cfg, stub as unknown as ExtensionAPI, () => {});
			check("self-heal: inactive before activation", !isActive());
			check("self-heal: activate reports the transition", activate("probe") === true);
			check("self-heal: active after activate", isActive());
			check(
				"self-heal: tools released on activate",
				TEAM_TOOL_NAMES.every((n) => activeTools.includes(n)) && unavailable.length === 0,
				`active=${activeTools.length} unavailable=${unavailable.length}`,
			);
			// The host-side reset that produced "tool not found" mid-session.
			stub.setUnavailableTools([...TEAM_TOOL_NAMES]);
			stub.setActiveTools([]);
			ensureToolsAvailable();
			check(
				"self-heal: ensureToolsAvailable restores the tools after a reset",
				TEAM_TOOL_NAMES.every((n) => activeTools.includes(n)) && unavailable.length === 0,
				`active=${activeTools.length} unavailable=${unavailable.length}`,
			);
			// Negative: while inactive the re-assert must stay a no-op.
			deactivate();
			stub.setUnavailableTools([...TEAM_TOOL_NAMES]);
			stub.setActiveTools([]);
			ensureToolsAvailable();
			check(
				"self-heal: no-op while inactive",
				activeTools.length === 0 && unavailable.length === TEAM_TOOL_NAMES.length,
				`active=${activeTools.length} unavailable=${unavailable.length}`,
			);

			// ---- 2. session_start re-activation predicate ----
			const sessionFile = ctx.sessionManager.getSessionFile();
			// forSession creates and saves the registry when none exists — the
			// on-disk state the self-heal branch keys on.
			const teamId = TeamManager.forSession(sessionFile, ctx.cwd).teamId;
			check(
				"self-heal: teamIdForSession round-trips",
				teamIdForSession(sessionFile) === teamId,
				`${teamIdForSession(sessionFile)} vs ${teamId}`,
			);
			check(
				"self-heal: registry on disk (re-activation predicate holds)",
				fs.existsSync(registryPath(teamId)),
				registryPath(teamId),
			);
			const foreign = teamIdForSession("/tmp/not-a-real-session-file.jsonl");
			check(
				"self-heal: no registry for a foreign session",
				foreign === null || !fs.existsSync(registryPath(foreign)),
				String(foreign),
			);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE22 DONE (all passed)" : `SMOKE22 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE22 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
