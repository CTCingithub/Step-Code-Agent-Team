/**
 * Topology regression probe (plan-30). Zero-token: member spawns are handshake
 * only, and the shim denial path never dispatches to a model.
 *
 * Run A (default config): star default, shape truth tables, validation errors,
 * registry persistence, legacy-registry compatibility, shim denial + status.
 * Run B (topology.requireDeclaration=true): dispatch gate before declaration
 * (runs first, before any setTopology call in this probe).
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../../extensions/members.ts";
import { TeamServer } from "../../extensions/team-server.ts";
import { getConfig } from "../../extensions/config.ts";
import { loadRegistry, teamsRoot } from "../../extensions/registry.ts";
import { shimPath } from "../../extensions/presets.ts";
import { TopologyError } from "../../extensions/topology.ts";

function runShim(
	shim: string,
	args: string[],
	env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	// Async spawn (not spawnSync): spawnSync with env+timeout inside the step
	// runtime returns a null status with no captured output.
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
			resolve({ code: null, stdout, stderr: `${stderr}${err.message}` });
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[smoke7]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		try {
			const cfg = getConfig();
			const manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);

			// 0. requireDeclaration gate (first: before any declaration in this probe)
			if (cfg.topology.requireDeclaration) {
				await manager.createMember({ name: "a", role: "worker" });
				let gateThrew = false;
				try {
					await manager.sendMessage("a", "must not run");
				} catch (err) {
					gateThrew = /topology has not been declared/.test(err instanceof Error ? err.message : "");
				}
				check("requireDeclaration: dispatch blocked before declaration", gateThrew);
				manager.setTopology("star");
				check("requireDeclaration: declaration accepted", manager.getTopology().shape === "star");
			}

			// 1. default (or freshly declared) topology is star with no edges
			const t0 = manager.getTopology();
			check("default topology: star, no edges", t0.shape === "star" && t0.edges.length === 0, JSON.stringify(t0));

			// members for the truth tables (handshake-only spawns)
			await manager.createMember({ name: "a", role: "worker" });
			await manager.createMember({ name: "b", role: "worker" });
			await manager.createMember({ name: "c", role: "worker" });

			// 2. star denies everything
			manager.setTopology("star");
			check("star: a→b denied", !manager.mayMessage("a", "b"));
			check("star: b→a denied", !manager.mayMessage("b", "a"));
			check("star: outbound empty", manager.outboundTargets("a").length === 0);

			// 3. mesh: all ordered pairs
			manager.setTopology("mesh");
			check("mesh: a→b", manager.mayMessage("a", "b"));
			check("mesh: b→a", manager.mayMessage("b", "a"));
			check("mesh: c→a", manager.mayMessage("c", "a"));
			check("mesh: self-edge denied", !manager.mayMessage("a", "a"));
			check("mesh: outbound = b,c", manager.outboundTargets("a").join(",") === "b,c", manager.outboundTargets("a").join(","));
			check("mesh: 6 edges", manager.getTopology().edges.length === 6, `edges=${manager.getTopology().edges.length}`);

			// 4. pipeline: ordered by creation
			manager.setTopology("pipeline");
			check("pipeline: a→b", manager.mayMessage("a", "b"));
			check("pipeline: b→c", manager.mayMessage("b", "c"));
			check("pipeline: a→c denied", !manager.mayMessage("a", "c"));
			check("pipeline: b→a denied", !manager.mayMessage("b", "a"));
			check("pipeline: c→a denied", !manager.mayMessage("c", "a"));

			// 5. ring: wraps around
			manager.setTopology("ring");
			check("ring: a→b", manager.mayMessage("a", "b"));
			check("ring: b→c", manager.mayMessage("b", "c"));
			check("ring: c→a (wrap)", manager.mayMessage("c", "a"));
			check("ring: a→c denied", !manager.mayMessage("a", "c"));

			// 6. custom edges
			manager.setTopology("custom", [
				["a", "c"],
				["a", "c"], // duplicate must be deduped, not an error
			]);
			check("custom: a→c", manager.mayMessage("a", "c"));
			check("custom: a→b denied", !manager.mayMessage("a", "b"));
			check("custom: c→a denied", !manager.mayMessage("c", "a"));
			check("custom: dedup to 1 edge", manager.getTopology().edges.length === 1, `edges=${manager.getTopology().edges.length}`);
			check("custom: shape recorded", manager.getTopology().shape === "custom");

			// 7. invalid declarations throw TopologyError
			const throwsTopologyError = (fn: () => void): boolean => {
				try {
					fn();
					return false;
				} catch (err) {
					return err instanceof TopologyError;
				}
			};
			check("custom without edges throws", throwsTopologyError(() => manager.setTopology("custom")));
			check("unknown member throws", throwsTopologyError(() => manager.setTopology("custom", [["a", "ghost"]])));
			check("self-loop throws", throwsTopologyError(() => manager.setTopology("custom", [["a", "a"]])));

			// 8. registry persistence + legacy-registry compatibility
			manager.setTopology("mesh");
			const persisted = loadRegistry(manager.teamId);
			check(
				"registry persists topology (6 edges)",
				(pisted => pisted?.topology.shape === "mesh" && pisted.topology.edges.length === 6)(persisted),
				`edges=${persisted?.topology.edges.length ?? -1}`,
			);
			const legacyDir = path.join(teamsRoot(), "legacy-topo");
			fs.mkdirSync(legacyDir, { recursive: true });
			fs.writeFileSync(
				path.join(legacyDir, "registry.json"),
				JSON.stringify({ schemaVersion: 1, teamId: "legacy-topo", createdAt: 0, cwd: ".", members: [], tasks: [] }),
			);
			const legacy = loadRegistry("legacy-topo");
			check(
				"legacy registry → star",
				legacy?.topology.shape === "star" && legacy.topology.edges.length === 0,
				JSON.stringify(legacy?.topology),
			);
			fs.rmSync(legacyDir, { recursive: true, force: true });

			// 9. server enforcement through the shim (denial is zero-token)
			manager.setTopology("star");
			const server = new TeamServer(manager.socketPath, () => manager);
			server.start();
			await new Promise((r) => setTimeout(r, 300));
			const shim = shimPath();

			const denied = await runShim(shim, ["msg", "--to", "b", "--message", "ping"], {
				STEPCODE_TEAM_SOCK: manager.socketPath,
				STEPCODE_TEAM_MEMBER: "a",
			});
			check(
				"shim: star denial exits non-zero",
				denied.code !== 0,
				`code=${denied.code} err=${denied.stderr.trim().slice(0, 140)}`,
			);
			check("shim: denial explains topology", /topology denies a → b/.test(denied.stderr), denied.stderr.trim());

			manager.setTopology("mesh");
			const status = await runShim(shim, ["status"], {
				STEPCODE_TEAM_SOCK: manager.socketPath,
				STEPCODE_TEAM_MEMBER: "a",
			});
			check(
				"shim: status exits zero",
				status.code === 0,
				`code=${status.code} out=${status.stdout.trim().slice(0, 100)} err=${status.stderr.trim().slice(0, 100)}`,
			);
			check(
				"shim: status lists mayMessage neighbors",
				/mayMessage/.test(status.stdout) && /"b"/.test(status.stdout),
				status.stdout.trim().slice(0, 120),
			);
			server.stop();

			await manager.disband();
			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE7 DONE (all passed)" : `SMOKE7 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE7 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
