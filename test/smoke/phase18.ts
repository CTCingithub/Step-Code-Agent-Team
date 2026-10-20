/**
 * Slot accounting + resume/topology messaging probe (2026-10-19 manual
 * verification follow-up). Zero-token: members are spawned for handshake
 * only — no prompts are sent, so no model calls happen.
 *
 * Covers three findings from the manual TUI verification session log:
 * 1. members.max counts LIVE members only — disbanding frees a slot
 *    (previously dead records kept consuming the limit forever).
 * 2. Resuming an existing member tells the caller which create params were
 *    ignored instead of silently keeping the old configuration.
 * 3. Members whose tool allowlist has no bash cannot run the messaging shim;
 *    team_set_topology must warn for edges touching such members.
 *
 * Config: the probe stages members.max=2 into the throwaway agent dir before
 * the first getConfig() call in this extension's module graph.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import {
	TeamManager,
	augmentDispatchError,
	resumeIgnoredParams,
	type CreateMemberParams,
} from "../../extensions/members.ts";
import { getConfig, resetConfigCache } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke18]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			// Stage a small member cap into the throwaway agent dir BEFORE the
			// first getConfig() call of this module graph (config loads lazily).
			const agentDir = process.env.STEP_CODING_AGENT_DIR;
			if (!agentDir) throw new Error("STEP_CODING_AGENT_DIR not set");
			fs.mkdirSync(agentDir, { recursive: true });
			fs.writeFileSync(
				path.join(agentDir, "settings.json"),
				JSON.stringify({ stepcodeAgentTeam: { members: { max: 2 } } }),
			);
			resetConfigCache();
			check("config: staged members.max = 2", getConfig().members.max === 2, `got ${getConfig().members.max}`);

			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			// --- 1. cap counts live members only ---------------------------------
			await manager.createMember({ name: "w1", role: "worker" });
			await manager.createMember({ name: "w2", role: "worker" });
			let fullErr = "";
			try {
				await manager.createMember({ name: "w3" });
			} catch (err) {
				fullErr = err instanceof Error ? err.message : String(err);
			}
			check("cap: third create rejected", /Team is full/.test(fullErr), fullErr);
			check("cap: rejection mentions live members", /live members/.test(fullErr), fullErr);

			await manager.disband("w1");
			let freed = true;
			let freedErr = "";
			try {
				await manager.createMember({ name: "w3", role: "worker" });
			} catch (err) {
				freed = false;
				freedErr = err instanceof Error ? err.message : String(err);
			}
			check("cap: disband frees a slot (create after disband succeeds)", freed, freedErr);

			// --- 2. resume ignores params — and says so --------------------------
			// Clear the team so the scout create is not blocked by the cap.
			await manager.disband();
			const { member: s1, created: s1Created } = await manager.createMember({ name: "s1", role: "scout" });
			check("scout preset: created with read-only tools", s1Created && (s1.tools ?? []).includes("read") && !(s1.tools ?? []).includes("bash"), `tools=${(s1.tools ?? []).join(",")}`);
			check("scout preset: effort default low", s1.effort === "low", `got ${s1.effort}`);

			const resumeDiff = resumeIgnoredParams(
				{ name: "s1", role: "worker", tools: ["read", "bash"], model: "other-model", effort: "high", systemPrompt: "x" },
				s1,
			);
			check(
				"resume: conflicting params all reported",
				["role", "tools", "model", "effort", "systemPrompt"].every((p) => resumeDiff.includes(p)),
				`got ${resumeDiff.join(",")}`,
			);
			check("resume: no params passed → nothing ignored", resumeIgnoredParams({ name: "s1" }, s1).length === 0);
			check("resume: matching role → not reported", resumeIgnoredParams({ name: "s1", role: "scout" }, s1).length === 0);

			// --- 3. pipeline topology (edges follow creation order) --------------
			// Every spawned member gets the topo_team_msg tool, so edges are
			// usable for every role — the old bash-capability warnings are gone.
			await manager.createMember({ name: "w9", role: "worker" });
			const topo = manager.setTopology("pipeline");
			check("topology: pipeline edge s1→w9", topo.edges.length === 1 && topo.edges[0][0] === "s1" && topo.edges[0][1] === "w9", JSON.stringify(topo.edges));

			const snap = manager.snapshot();

			// --- 4. dispatch failure context (mid-run failures strand relays) ----
			const roster = snap.members;
			const rosterText = roster.map((m) => `${m.name} ${m.status}`).join(" · ");
			const timeoutErr = augmentDispatchError(new Error("timeout waiting for member to settle"), roster, false) as Error;
			check(
				"dispatch error: timeout gains relay hint + roster",
				timeoutErr.message.startsWith("timeout waiting for member to settle") &&
					/team_status/.test(timeoutErr.message) &&
					roster.length > 0 &&
					timeoutErr.message.includes(rosterText),
				timeoutErr.message,
			);
			check("dispatch error: original error kept as cause", (timeoutErr as Error & { cause?: unknown }).cause instanceof Error);
			check(
				"dispatch error: nested sender keeps terse error",
				(augmentDispatchError(new Error("timeout waiting for member to settle"), roster, true) as Error).message ===
					"timeout waiting for member to settle",
			);
			for (const msg of ["member process exited during run (code null)", "member run aborted by leader"]) {
				const e = augmentDispatchError(new Error(msg), roster, false) as Error;
				check(`dispatch error: mid-run failure augmented (${msg.slice(0, 26)}…)`, /team_status/.test(e.message), e.message);
			}
			check(
				"dispatch error: pre-run failure untouched",
				(augmentDispatchError(new Error("handshake timed out"), roster, false) as Error).message === "handshake timed out",
			);

			await manager.disband();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE18 DONE (all passed)" : `SMOKE18 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE18 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
