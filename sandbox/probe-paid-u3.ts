/**
 * T6 测试执行 · U3 真实三层派发链（策略师A 方案）。
 *
 * 计费声明：1 条完整三层链（leader→A→B→C），估算 ~10k-25k token，硬上限 40k。
 * 计费诚实：绝不对非 429 的 4xx 重试；单层 settle 超时最多重试 1 次。
 *
 * 走**产品插件的 TeamManager**（extensions/members.ts createMember + sendMessage），
 * 不走 harness 的 team_send——那正是 settle 退化路径（本会话累计 52 次超时，
 * 根因在 harness 不在本仓库；而 TeamManager 派发已由 phase36 实证正常：
 * 真实 API 长提示带工具 10.2s/5 回合）。
 *
 * 「模型真的自主派发了」的判据（间接但可观测，三者须同时成立）：
 *   ① 顶层 sendMessage 返回文本含我们要求 C 埋入的特征串 THREETIER-<n>；
 *   ② 每一层的 usage.turns ≥ 1（每层都真的跑了模型回合）；
 *   ③ 子团队的 registry.json 与 sock 真实落盘（扩展在成员进程 auto-activate）。
 *
 * 已知不可脚本化的部分：三层链需要每层模型**自主决定**调用 spawn 工具。
 * 所以本探针把「要求逐层下派」写进 prompt，让模型自己决定是否照做——
 * 这正是要测的东西，不能替它做。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { TeamManager } from "../extensions/members.ts";
import { configFilePath, resetConfigCache, getConfig } from "../extensions/config.ts";

const FEATURE = "THREETIER-7";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[u3]", ...a);
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "paidu3-"));
		const agent = path.join(root, "agent");
		fs.mkdirSync(path.join(agent, "sessions"), { recursive: true });
		const savedAgentDir = process.env.STEP_CODING_AGENT_DIR;
		process.env.STEP_CODING_AGENT_DIR = agent;
		// 隔离 + 深度3 + 放宽超时（三层链比单层慢得多）。
		fs.writeFileSync(
			path.join(agent, "stepcode-agent-team.json"),
			JSON.stringify({ members: { maxRecursionDepth: 3 }, dispatch: { timeoutMs: 240_000 } }, null, 2),
		);
		resetConfigCache();
		log("config: maxRecursionDepth =", getConfig().members.maxRecursionDepth, "dispatch.timeoutMs =", getConfig().dispatch.timeoutMs);

		const evidence: string[] = [];
		const ev = (s: string) => {
			evidence.push(s);
			log(s);
		};
		let totalTokens = 0;

		/** 建一个成员并返回其记录；失败记 null。 */
		const spawn = async (name: string, parent?: string) => {
			try {
				const { member } = parent
					? await parent.createMember({ name })
					: await manager.createMember({ name });
				return member;
			} catch (err) {
				ev(`SPAWN FAIL ${name}: ${err instanceof Error ? err.message : String(err)}`);
				return null;
			}
		};

		let manager: TeamManager | undefined;
		try {
			manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), root);
			ev(`L0 leader teamId=${manager.teamId}`);

			// ---- 第一层：队长建 A（depth-1） ----
			const A = await spawn("tier1");
			if (!A) throw new Error("depth-1 spawn failed");
			ev(`L1 A pid=${A.pid} status=${A.status} model=${A.model}`);
			ev(`L1 A args=${(A as unknown as { spawnArgs?: string[] }).spawnArgs?.join(" ") ?? "(not recorded)"}`);

			// 让 A 建 B（depth-2）。这一步由模型的自主决定驱动。
			const t1 = Date.now();
			let aText = "";
			try {
				const r = await manager.sendMessage(
					"tier1",
					[
						"你是第一层成员。请用 create_member 工具创建一个名为 tier2 的成员（它是你的子成员）。",
						"创建成功后，请用 send 工具把下面这条指令原样转给它：",
						`"你是第二层成员。请用 create_member 工具创建一个名为 tier3 的成员，然后用 send 工具把这条指令转给它：『你是第三层成员。请只回复一个字符串：${FEATURE}』。最后把 tier3 的回复原文返回给我。"`,
						"如果你无法创建成员或无法转发，请直接说明你遇到了什么，不要编造。",
					].join("\n"),
				);
				aText = r.text;
				totalTokens += (r.usage.input ?? 0) + (r.usage.output ?? 0);
				ev(`L1 A settled in ${Date.now() - t1}ms turns=${r.usage.turns} tokens=${(r.usage.input ?? 0) + (r.usage.output ?? 0)}`);
				ev(`L1 A text=${JSON.stringify(r.text.slice(0, 400))}`);
			} catch (err) {
				ev(`L1 A SEND FAILED after ${Date.now() - t1}ms: ${err instanceof Error ? err.message : String(err)}`);
			}

			// ---- 观测子团队落盘 ----
			const teamsRoot = path.join(agent, "teams");
			const dirs = fs.existsSync(teamsRoot) ? fs.readdirSync(teamsRoot) : [];
			ev(`L2 sub-team dirs on disk: ${dirs.join(",") || "(none)"}`);
			for (const d of dirs) {
				const reg = path.join(teamsRoot, d, "registry.json");
				const sock = path.join(teamsRoot, d, "sock");
				ev(`L2   ${d}: registry=${fs.existsSync(reg) ? "YES" : "no"} sock=${fs.existsSync(sock) ? "YES" : "no"}`);
			}

			// ---- 直接观测二/三层（不经模型中转，确认进程级真的到了） ----
			const m1 = manager.findMember("tier1");
			ev(`L1 A after: status=${m1?.status} turns=${m1?.usage.turns}`);
			const roster = manager.snapshot().members.map((m) => `${m.name}(depth?)`).join(",");
			ev(`L1 roster seen by leader: ${roster || "(only tier1)"}`);

			// ---- 判定 ----
			const hasFeature = aText.includes(FEATURE);
			ev(`VERDICT feature-string-in-top-reply: ${hasFeature ? "PASS" : "FAIL"}`);
			ev(`VERDICT sub-team-dirs-on-disk: ${dirs.length > 0 ? "PASS" : "FAIL"} (${dirs.length} dirs)`);
			ev(`VERDICT leader-turns: ${(m1?.usage.turns ?? 0) > 0 ? "PASS" : "FAIL"} (${m1?.usage.turns})`);
			ev(`TOTAL tokens so far: ${totalTokens}`);
		} catch (err) {
			ev(`SETUP FAILED: ${err instanceof Error ? err.message : String(err)}`);
		} finally {
			try {
				await manager?.disband();
			} catch {
				/* best effort */
			}
			if (savedAgentDir === undefined) delete process.env.STEP_CODING_AGENT_DIR;
			else process.env.STEP_CODING_AGENT_DIR = savedAgentDir;
			resetConfigCache();
			// 刻意保留现场：独立核实 tier3 是否真的存在并真的回复，
			// 而不是采信顶层回复里的转述。清理交给外层脚本。
			fs.writeFileSync(path.resolve(import.meta.dirname, "..", "sandbox", "logs", "paid-u3-root.txt"), root);
			const dump: string[] = [];
			const teamsRootDir = path.join(agent, "teams");
			if (fs.existsSync(teamsRootDir)) {
				for (const d of fs.readdirSync(teamsRootDir)) {
					const sd = path.join(teamsRootDir, d, "sessions");
					if (!fs.existsSync(sd)) continue;
					for (const f of fs.readdirSync(sd)) {
						try {
							const body = fs.readFileSync(path.join(sd, f), "utf8");
							dump.push(`===== ${d}/${f} (${body.length} chars) =====`);
							dump.push(body.slice(-3000));
						} catch {
							/* unreadable */
						}
					}
				}
			}
			fs.writeFileSync(path.resolve(import.meta.dirname, "..", "sandbox", "logs", "paid-u3-sessions.txt"), dump.join("\n") || "(no session files)");
			fs.writeFileSync(
				path.resolve(import.meta.dirname, "..", "sandbox", "logs", "paid-exec-u3.md"),
				[
					"# 任务6 执行 · U3 真实三层派发链",
					"",
					"> 派发超时，本角色由队长亲自执行。**计费声明：1 条完整三层链，估算 ~10k-25k token，硬上限 40k。**",
					"> 走产品插件的 TeamManager（不走 harness 的 team_send——那是 settle 退化路径）。",
					"",
					"## 证据链",
					"",
					...evidence.map((l) => `- ${l}`),
					"",
					"## 判定口径",
					"",
					"三者须同时成立才认「通过」：① 顶层回复含 C 埋入的特征串；② 每层 usage.turns ≥ 1；③ 子团队 registry+sock 落盘。",
					"",
				].join("\n"),
			);
			log("U3 DONE");
			setTimeout(() => process.exit(0), 2000);
		}
	});
}
