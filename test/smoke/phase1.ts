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
import { TeamManager, isRetryableSpawnError } from "../../extensions/members.ts";
import { loadRegistry } from "../../extensions/registry.ts";
import { MemberRpc } from "../../extensions/rpc-client.ts";
import { getConfig } from "../../extensions/config.ts";

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

			// Zero-token regression for the spawn-path retry policy: createMember
			// must retry only transient spawn/handshake failures (the record and
			// its deterministic session id already exist, so a retry resumes
			// instead of duplicating) and must NOT retry a settle timeout, which
			// may mean the work is already done. MemberRpc.spawn is stubbed — no
			// real process is started and no token is spent.
			{
				const realSpawn = MemberRpc.spawn.bind(MemberRpc);
				let spawnCalls = 0;
				let mode: "handshake-once" | "handshake-always" | "settle-always" | "real" = "real";
				MemberRpc.spawn = async (args, cwd, options) => {
					spawnCalls++;
					if (mode === "handshake-once" && spawnCalls === 1) throw new Error("member handshake timeout");
					if (mode === "handshake-always") throw new Error("member handshake timeout");
					if (mode === "settle-always") throw new Error("timeout waiting for member to settle");
					return realSpawn(args, cwd, options);
				};
				try {
					const retryable = [
						"member handshake timeout",
						"member process exited before handshake completed",
						"spawn step ENOENT",
						"failed to start member process",
						"member run aborted before start",
					];
					const fatal = [
						"timeout waiting for member to settle",
						// The augmented settle-timeout error carries "will respawn
						// with its context resumed" — a bare /spawn/ matches inside
						// "respawn" and would retry possibly-finished work.
						"this dispatch failed mid-run (the dispatched member was killed fail-fast and will respawn with its context resumed)",
						"member process exited during run (code 1)",
						"Team is full (max 5 live members). Disband one first",
						"RPC timeout for command dispatch",
					];
					for (const m of retryable) {
						check(`retry policy: retryable — ${m}`, isRetryableSpawnError(new Error(m)));
					}
					for (const m of fatal) {
						check(`retry policy: not retryable — ${m}`, !isRetryableSpawnError(new Error(m)));
					}

					// 1. A single failed handshake is transient: the retry respawns
					// and the member is created (2 spawn attempts, created=true).
					mode = "handshake-once";
					spawnCalls = 0;
					const r1 = await manager.createMember({
						name: "retry1",
						role: "smoke",
						systemPrompt: "You are a retry probe.",
					});
					check(
						"create: recover-after-one-handshake-failure",
						r1.created === true && spawnCalls === 2,
						`created=${r1.created} spawnCalls=${spawnCalls}`,
					);
					await manager.disband("retry1");

					// 2. A persistent handshake failure is bounded at
					// dispatch.retries + 1 attempts and surfaces the handshake error.
					mode = "handshake-always";
					spawnCalls = 0;
					let err2: unknown;
					try {
						await manager.createMember({
							name: "retry2",
							role: "smoke",
							systemPrompt: "You are a retry probe.",
						});
					} catch (e) {
						err2 = e;
					}
					check(
						"create: bounded-at-retries+1",
						err2 instanceof Error &&
							spawnCalls === getConfig().dispatch.retries + 1 &&
							/handshake timeout/.test(err2.message),
						`spawnCalls=${spawnCalls} retries=${getConfig().dispatch.retries} err=${err2 instanceof Error ? err2.message : String(err2)}`,
					);

					// 3. A settle timeout may mean the work is already done, so it is
					// never retried: exactly one spawn attempt, then the error.
					mode = "settle-always";
					spawnCalls = 0;
					let err3: unknown;
					try {
						await manager.createMember({
							name: "retry3",
							role: "smoke",
							systemPrompt: "You are a retry probe.",
						});
					} catch (e) {
						err3 = e;
					}
					check(
						"create: settle-not-retried",
						err3 instanceof Error && spawnCalls === 1,
						`spawnCalls=${spawnCalls} err=${err3 instanceof Error ? err3.message : String(err3)}`,
					);
				} finally {
					MemberRpc.spawn = realSpawn;
				}
			}

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE1 DONE (all passed)" : `SMOKE1 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE1 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
