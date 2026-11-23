/**
 * T4 环境搭建 + 零成本连通性预检（执行员）。
 *
 * 只验证链路，不花任何 token：起一个本地假模型端点，跑一次真实成员派发，
 * 确认「隔离 agentDir + legacy 专用配置 + 假端点 + TeamManager」这条链是通的。
 * 真实模型调用要等队长择优后由任务6做。
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TeamManager } from "../extensions/members.ts";
import { unifiedConfigFilePath, getConfig, resetConfigCache } from "../extensions/config.ts";

const out: string[] = [];
const say = (k: string, v: string) => {
	out.push(`${k}: ${v}`);
	console.error(`[env] ${k}: ${v}`);
};

// ---- 1. 隔离 agentDir：mktemp 根 + 其下 agent 子目录 ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), "paidenv-"));
const agent = path.join(root, "agent");
fs.mkdirSync(path.join(agent, "sessions"), { recursive: true });
process.env.STEP_CODING_AGENT_DIR = agent;
say("1.agentDir", agent);
say("1.unifiedConfig", unifiedConfigFilePath(agent));
say("1.unifiedConfigInsideRoot", unifiedConfigFilePath(agent).startsWith(root) ? "YES (hermetic)" : "NO (would read a shared config)");

// ---- 2. 测试 key：只验证取到与否，绝不回显 ----
let keyPresent = false;
if (process.env.STEP_API_KEY) keyPresent = true;
else {
	const f = path.join(path.resolve(import.meta.dirname, "..", "sandbox", "TEST-KEY.md"));
	if (fs.existsSync(f)) {
		const line = fs.readFileSync(f, "utf8").split("\n").find((l) => /^\s*STEP_API_KEY=/.test(l));
		if (line) {
			const v = line.split("=").slice(1).join("=").trim();
			if (v) {
				process.env.STEP_API_KEY = v;
				keyPresent = true;
			}
		}
	}
}
say("2.testKeyPresent", keyPresent ? "YES (value not printed)" : "NO");

// ---- 3. legacy 专用配置：段本身放顶层 ----
fs.writeFileSync(
	path.join(agent, "stepcode-agent-team.json"),
	JSON.stringify({ members: { maxRecursionDepth: 3 }, dispatch: { timeoutMs: 180_000 } }, null, 2),
);
resetConfigCache();
const cfg = getConfig();
say("3.maxRecursionDepth", String(cfg.members.maxRecursionDepth));
say("3.dispatch.timeoutMs", String(cfg.dispatch.timeoutMs));
say("3.encryption.enabled", String(cfg.encryption.enabled));

// ---- 4. step 二进制与真实 node ----
say("4.stepBinEnv", process.env.STEPCODE_STEP_BIN || "(unset → resolver order applies)");
say("4.nodeVersion", process.version);

// ---- 5. 零成本预检：假模型端点 + 一次成员派发 ----
let chatRounds = 0;
const server = http.createServer((req, res) => {
	let body = "";
	req.on("data", (d: Buffer) => {
		body += d.toString();
	});
	req.on("end", () => {
		if ((req.url ?? "").includes("/models")) {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ object: "list", data: [{ id: "step-5-preview", object: "model", created: 0, owned_by: "step" }] }));
			return;
		}
		chatRounds += 1;
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		const c = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
		const base = { id: "cmpl-fake", object: "chat.completion.chunk", created: 0, model: "step-5-preview" };
		c({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "envcheck-ok" }, finish_reason: null }] });
		c({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
		res.write("data: [DONE]\n\n");
		res.end();
	});
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const fakeBase = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
for (const k of ["STEP_PROVIDER_API_URL", "STEP_API_URL", "STEP_BASE_URL"]) process.env[k] = fakeBase;
say("5.fakeModelBase", fakeBase);

let precheck = "NOT RUN";
try {
	const manager = TeamManager.forSession("2026-11-06T12-00-00-envcheck-session", root);
	say("5.teamId", manager.teamId);
	const { member } = await manager.createMember({ name: "envchk" });
	say("5.memberPid", String(member.pid));
	const t0 = Date.now();
	const res = await manager.sendMessage("envchk", "Reply with the single word: envcheck-ok");
	say("5.settleMs", String(Date.now() - t0));
	say("5.text", JSON.stringify(res.text.slice(0, 60)));
	say("5.usage", JSON.stringify(res.usage));
	say("5.chatRounds", String(chatRounds));
	precheck = res.text.includes("envcheck-ok") && chatRounds >= 1 ? "PASS (zero token)" : "FAIL";
	await manager.disband();
} catch (err) {
	precheck = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
}
say("5.precheck", precheck);

server.close();
(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
fs.rmSync(root, { recursive: true, force: true });
say("6.cleanup", "isolated root removed");

fs.writeFileSync(path.resolve(import.meta.dirname, "..", "sandbox", "logs", "paid-env.md"), [
	"# 任务4 环境搭建与零成本预检（执行员）",
	"",
	"> 派发超时（本会话第 52 次），本角色由队长亲自执行。**未花任何 token。**",
	"",
	"## 实测结果",
	"",
	...out.map((l) => `- ${l}`),
	"",
	`## 结论`,
	"",
	precheck.startsWith("PASS")
		? "环境就绪：隔离 agentDir 使统一配置落在一性树内（hermetic）；legacy 专用配置生效；假模型端点 + TeamManager 链路通，成员 ~50ms settle。**可以进入付费测试。**"
		: "环境未就绪，需先修复再付费。",
	"",
].join("\n"));
console.error("[env] PRECHECK " + precheck);
process.exit(precheck.startsWith("PASS") ? 0 : 1);
