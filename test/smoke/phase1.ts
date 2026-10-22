/**
 * Phase 1 smoke probe (zero token cost): exercises member lifecycle without
 * prompting any LLM. Loaded alongside the extension via `step -e`.
 *
 * Verifies: extension load, member spawn + RPC handshake, registry persistence,
 * disband (process kill), and recreate (resume path via same session id) —
 * each step asserted. The lifecycle is the core contract, and these assertions
 * double as regression guards for the kill-path instance-identity fixes
 * (evicting by name instead of instance let a dying/losing process strand a
 * live one).
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { loadRegistry } from "../../extensions/registry.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...args: unknown[]) => console.error("[smoke1]", ...args);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
			log("teamId:", manager.teamId);

			const created = await manager.createMember({
				name: "smoke1",
				role: "smoke",
				systemPrompt: "You are a smoke test member.",
			});
			check("create: reports created", created.created === true, `created=${created.created}`);
			check(
				"create: idle with a live pid",
				created.member.status === "idle" && created.member.pid > 0,
				JSON.stringify({ status: created.member.status, pid: created.member.pid }),
			);

			const reg = loadRegistry(manager.teamId);
			check(
				"registry: member persisted",
				reg?.members.length === 1 && reg.members[0]?.name === "smoke1",
				JSON.stringify(reg?.members.map((m) => m.name)),
			);
			check(
				"registry: pid matches the live member",
				reg?.members[0]?.pid === created.member.pid,
				`registry=${reg?.members[0]?.pid} live=${created.member.pid}`,
			);

			const killed = await manager.disband("smoke1");
			check("disband one: kills the named member", killed.join(",") === "smoke1", killed.join(",") || "(none)");
			check(
				"disband one: registry marks dead",
				loadRegistry(manager.teamId)?.members[0]?.status === "dead",
				String(loadRegistry(manager.teamId)?.members[0]?.status),
			);

			const again = await manager.createMember({ name: "smoke1" });
			// The record survived disband (marked dead), so this is an idempotent
			// resume: created=false, same session id — never a duplicate record.
			check("recreate: resumes the existing record (not re-created)", again.created === false, `created=${again.created}`);
			check(
				"recreate: same session id (context resume)",
				again.member.sessionId === created.member.sessionId,
				`${again.member.sessionId} vs ${created.member.sessionId}`,
			);
			check(
				"recreate: process respawned (idle with a live pid)",
				again.member.pid > 0 && again.member.status === "idle",
				JSON.stringify({ pid: again.member.pid, status: again.member.status }),
			);

			await manager.disband();
			check(
				"disband all: roster cleared",
				manager.snapshot().members.length === 0,
				`members=${manager.snapshot().members.length}`,
			);
			check(
				"disband all: persisted registry cleared",
				loadRegistry(manager.teamId)?.members.length === 0,
				`registry=${loadRegistry(manager.teamId)?.members.length}`,
			);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE1 DONE (all passed)" : `SMOKE1 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE1 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
