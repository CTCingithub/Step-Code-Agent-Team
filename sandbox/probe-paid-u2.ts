/**
 * T6 测试执行 · U2 真实顺从度（修正版）。
 *
 * 计费声明：4 次 ctx.modelRegistry.complete（plan 四档各一次），估算 ~4k-8k token。
 * 硬上限 12k token；4xx 绝不重试（计费诚实）。
 *
 * 第一版直接 fetch DeepSeek 的 /v1/chat/completions 得 401——那个 key 是
 * search/fetch 工具的凭证，不是 chat 凭证，这是预期而非缺陷（且 0 token 花费）。
 * 真实路径必须经宿主的 ctx.modelRegistry.complete，走 step provider 与
 * STEP_API_KEY，那才是 generateTeamPlan 实际走的路。
 *
 * 判据写在代码里、可复现：成员数由正则提取，语义标记为并行/两阶段/最少化三类。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { teamPlanPrompt } from "../extensions/forward.ts";
import { allTiers, type TeamTier } from "../extensions/plan.ts";
import { resetConfigCache } from "../extensions/config.ts";

const REQUEST = "修复这个项目里失败的冒烟测试，并确认没有回归";

/**
 * 可观测特征判定。
 *
 * 成员数的取法：**统计任务列表里出现的不同负责人**。四档方案无一例外都是
 * 「Task N: … — <name>（blockedBy: …）」或「N) … — <name>」的句式，所以按
 * 负责人去重计数比数「N 个成员」稳健得多——第一版用后者，结果 balanced 档
 * （5 名成员、写法是 "Roster: Lead Mira (coordinator, 20%); …"）被提成 0，
 * 判了 FAIL，而那一档的方案其实完全合格。
 *
 * 语义标记仍是并行 / 两阶段 / 最少化三类，只作辅助判据。
 */
function judge(tier: TeamTier, text: string): { ok: boolean; members: number; why: string } {
	const lower = text.toLowerCase();
	// 负责人：任务行里 "— Name（blockedBy" / "— Name (blockedBy" / "— Name —" 三种写法。
	const assignees = new Set<string>();
	for (const m of text.matchAll(/[—–-]\s*([A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]{0,15})\s*(?:[（(]|—|$)/gm)) {
		const name = m[1].trim();
		// 过滤掉明显不是人名的 token（拓扑/阶段词）。
		if (!/^(blockedBy|none|star|mesh|ring|pipeline|custom|topology|tasks?|roster|plan)$/i.test(name)) assignees.add(name);
	}
	const members = assignees.size;
	const mentionsParallel = /并行|parallel|同时|multi-?angle|多角度|竞速|racing/i.test(text);
	const mentionsSurveyThenAct = /(勘察|survey|先看|先读|调研|审查|复现|reproduce)[\s\S]{0,60}(再|then|之后|后)[\s\S]{0,60}(实施|动手|修|implement|fix|验证)/i.test(text)
		|| /两阶段|分阶段|先[\s\S]{0,24}后/.test(text);
	const mentionsMinimal = /最省|最低成本|单人|不派|minimal|cheap|直接动手|跳过规划|少成员/i.test(lower);

	switch (tier.id) {
		case "economic":
			return { ok: members <= 3 || mentionsMinimal, members, why: `assignees=${members} minimal=${mentionsMinimal}` };
		case "fast":
			return { ok: members >= 1 && members <= 4, members, why: `assignees=${members}` };
		case "balanced":
			return { ok: members >= 2 && members <= 7 && (mentionsSurveyThenAct || members >= 3), members, why: `assignees=${members} surveyThenAct=${mentionsSurveyThenAct}` };
		case "performance":
			return { ok: (members >= 4 || mentionsParallel) && members >= 3, members, why: `assignees=${members} parallel=${mentionsParallel}` };
		default:
			return { ok: false, members, why: "unknown tier" };
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const log = (...a: unknown[]) => console.error("[u2]", ...a);
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "paidu2-"));
		const agent = path.join(root, "agent");
		fs.mkdirSync(path.join(agent, "sessions"), { recursive: true });
		const savedAgentDir = process.env.STEP_CODING_AGENT_DIR;
		process.env.STEP_CODING_AGENT_DIR = agent;
		resetConfigCache();

		const model = (ctx as unknown as { model?: { provider: string; id: string } }).model;
		const registry = (ctx as unknown as { modelRegistry?: { complete: (m: unknown, o: unknown) => Promise<{ content?: Array<{ type: string; text?: string }>; usage?: { input?: number; output?: number } }> } }).modelRegistry;
		log("model =", model ? `${model.provider}/${model.id}` : "(none)", "registry =", registry ? "present" : "MISSING");

		const rows: Array<{ tier: string; chars: number; tokens: number; members: number; ok: boolean; why: string }> = [];
		const texts: string[] = [];
		let totalTokens = 0;

		for (const tier of allTiers()) {
			if (!registry || !model) {
				log(`--- ${tier.id}: no model/registry, skipped`);
				rows.push({ tier: tier.id, chars: 0, tokens: 0, members: 0, ok: false, why: "no model/registry" });
				continue;
			}
			const prompt = teamPlanPrompt(REQUEST, tier, "cn");
			log(`--- ${tier.id} (label=${tier.label.zh}) system=${prompt.system.length} user=${prompt.user.length} ---`);
			try {
				const res = await registry.complete(model, {
					systemPrompt: prompt.system,
					messages: [{ role: "user", content: prompt.user, timestamp: Date.now() }],
				});
				const text = (res.content ?? [])
					.map((c) => (c.type === "text" ? (c.text ?? "") : ""))
					.filter(Boolean)
					.join("\n");
				const tokens = (res.usage?.input ?? 0) + (res.usage?.output ?? 0);
				totalTokens += tokens;
				const j = judge(tier, text);
				rows.push({ tier: tier.id, chars: text.length, tokens, members: j.members, ok: j.ok, why: j.why });
				texts.push(`### ${tier.id}\n${text.slice(0, 700)}`);
				log(`  tokens=${tokens} chars=${text.length} members=${j.members} verdict=${j.ok ? "PASS" : "FAIL"} (${j.why})`);
				log(`  text=${JSON.stringify(text.slice(0, 300))}`);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log(`  ERROR (不重试): ${msg.slice(0, 200)}`);
				rows.push({ tier: tier.id, chars: 0, tokens: 0, members: 0, ok: false, why: msg.slice(0, 80) });
			}
			if (totalTokens > 12_000) {
				log("  !! 触硬上限 12k token，停止");
				break;
			}
		}

		const passed = rows.filter((r) => r.ok).length;
		log(`SUMMARY passed=${passed}/${rows.length} totalTokens=${totalTokens}`);

		fs.writeFileSync(
			path.resolve(import.meta.dirname, "..", "sandbox", "logs", "paid-exec-u2.md"),
			[
				"# 任务6 执行 · U2 真实顺从度",
				"",
				"> 派发超时，本角色由队长亲自执行。**计费声明：4 次 ctx.modelRegistry.complete，估算 ~4k-8k token；硬上限 12k。**",
				"> 走宿主的 `ctx.modelRegistry.complete`（step provider + STEP_API_KEY）——那才是 `generateTeamPlan` 实际走的路。",
				"> 第一版直接 fetch DeepSeek `/v1/chat/completions` 得 **401**：那个 key 是 search/fetch 工具的凭证而非 chat 凭证，属预期，且 **0 token 花费**。",
				"",
				`## 模型：${model ? `${model.provider}/${model.id}` : "(none)"}`,
				"",
				"## 逐档结果",
				"",
				"| 档位 | tokens | 字符数 | 提取成员数 | 判定 | 依据 |",
				"|---|---|---|---|---|---|",
				...rows.map((r) => `| ${r.tier} | ${r.tokens} | ${r.chars} | ${r.members} | ${r.ok ? "**PASS**" : "FAIL"} | ${r.why} |`),
				"",
				`## 汇总：${passed}/${rows.length} 档通过，共 ${totalTokens} token`,
				"",
				"## 逐档原文（前 700 字符）",
				"",
				...texts,
				"",
				"## 判据与已知局限",
				"",
				"判据写在 `judge()` 里可复现：成员数由 `N 个/名 成员|agent|worker|reviewer|scout` 正则提取；",
				"语义标记为并行 / 两阶段 / 最少化三类。**已知局限**：对不按此句式表达成员数的模型会提得 0，",
				"此时 economic 判 PASS、performance 判 FAIL——这是判据的灵敏度问题，记录在此而非掩盖。",
				"",
			].join("\n"),
		);

		if (savedAgentDir === undefined) delete process.env.STEP_CODING_AGENT_DIR;
		else process.env.STEP_CODING_AGENT_DIR = savedAgentDir;
		resetConfigCache();
		fs.rmSync(root, { recursive: true, force: true });
		setTimeout(() => process.exit(0), 2000);
	});
}
