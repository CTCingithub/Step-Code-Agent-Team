#!/usr/bin/env node
/**
 * Live probes for the manual scenarios that used to be "TUI-only": they drive
 * a real step RPC session and answer the host's extension-UI dialogs over the
 * wire (select / input / confirm are answerable dialog promises — see
 * packages/coding-agent/src/modes/rpc/rpc-mode.ts), so the confirmation chain,
 * the L1 guard, custom-role spawn and the keyword migration notice can be
 * verified end-to-end with a real LLM round-trip, without a human at a TUI.
 *
 * What remains genuinely manual is pixel/interaction feel (the TUI rendering
 * of these dialogs, the Esc key, the no-countdown behavior) — see
 * docs/MANUAL-TESTING(_CN).md §8–§11 and M3.
 *
 * Usage:  node sandbox/probe-remaining-manual.mjs <5a|7|8|9>
 * Needs:  the API key from sandbox/TEST-KEY.md (sandbox/with-test-key.sh sets it).
 * Rules:  every scenario runs in an isolated temp agentDir and from THIS
 *         process (live checks false-negative inside member processes).
 *         The global config lives at path.dirname(agentDir)/config.toml, so a
 *         config written to /tmp/config.toml would shadow EVERY mktemp-based
 *         agentDir (the smoke runner's included) — keep each scenario's config
 *         inside its own mktemp root, and never write /tmp/config.toml.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const STEP = `${REPO}/sandbox/step-build/step`;
const scenario = process.argv[2];

function makeAgent(tag, configToml, extra) {
	const root = fs.mkdtempSync(`/tmp/${tag}-`);
	const agentDir = path.join(root, "agent");
	fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
	fs.writeFileSync(path.join(root, "config.toml"), configToml); // beside the agent dir
	for (const [rel, text] of Object.entries(extra ?? {})) {
		fs.mkdirSync(path.dirname(path.join(agentDir, rel)), { recursive: true });
		fs.writeFileSync(path.join(agentDir, rel), text);
	}
	return { root, agentDir };
}

/** Runs one session over `steps`, answering dialogs via `answer`. */
async function runSession(tag, agentDir, steps, answer) {
	const child = spawn(STEP, [
		"-e", `${REPO}/extensions/index.ts`, "--mode", "rpc",
		"--session-id", tag, "--session-dir", path.join(agentDir, "sessions"), "--approval-mode", "auto",
	], { cwd: REPO, env: { ...process.env, STEP_CODING_AGENT_DIR: agentDir }, stdio: ["pipe", "pipe", "pipe"] });
	const notifies = [];
	let buf = "";
	child.stdout.on("data", (d) => {
		buf += d.toString();
		for (const line of buf.split("\n")) {
			if (!line.trim()) continue;
			let msg;
			try { msg = JSON.parse(line); } catch { continue; }
			if (msg.type !== "extension_ui_request") continue;
			if (msg.method === "notify") notifies.push(String(msg.message ?? "").replace(/\n/g, " | "));
			const a = answer?.(msg);
			if (a) child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: msg.id, ...a })}\n`);
		}
		buf = "";
	});
	child.stderr.on("data", () => {});
	for (const step of steps ?? []) {
		child.stdin.write(`${JSON.stringify({ type: "prompt", message: step.message })}\n`);
		await new Promise((r) => setTimeout(r, step.waitMs ?? 30000));
	}
	const files = fs.readdirSync(path.join(agentDir, "sessions")).filter((f) => f.endsWith(".jsonl"));
	const jsonl = files.map((f) => fs.readFileSync(path.join(agentDir, "sessions", f), "utf8")).join("\n");
	child.kill("SIGKILL");
	return { notifies, jsonl };
}

function parts(jsonl) {
	const out = [];
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue;
		let ev;
		try { ev = JSON.parse(line); } catch { continue; }
		if (Array.isArray(ev?.message?.content)) out.push(...ev.message.content);
	}
	return out;
}

const ACTIVATION_CFG = [
	"[stepcodeAgentTeam.activation]", "enabled = true",
	'keywords = ["智能体小队", "topo team"]', "guardEnabled = true", "",
].join("\n");
const PLAN_CFG = ACTIVATION_CFG + "[stepcodeAgentTeam.plan]\nenabled = true\n\n[stepcodeAgentTeam.dispatch]\ntimeoutMs = 120000\n";

let pass = false;
if (scenario === "5a") {
	// Tier picker -> spinner/plan -> three-option confirm -> custom input ->
	// the user's text rides along with the forwarded request verbatim.
	const NOTE = "只要 1 个只读成员，不要修改任何文件";
	const a = makeAgent("probe5a", PLAN_CFG);
	const r = await runSession("probe5a", a.agentDir, [{ message: "/topo 统计这个项目的源文件数量并汇报", waitMs: 90000 }], (msg) => {
		if (msg.method === "select" && msg.title === "选择团队方案") {
			const pick = (msg.options ?? []).find((o) => o.startsWith("均衡")) ?? (msg.options ?? [])[0];
			return { value: pick };
		}
		if (msg.method === "select" && msg.title === "智能体团队") {
			return { value: (msg.options ?? []).find((o) => o.includes("自定义输入")) ?? (msg.options ?? [])[1] };
		}
		if (msg.method === "input") return { value: NOTE };
		return null;
	});
	const calls = parts(r.jsonl).filter((p) => p.type === "toolCall").map((p) => p.name);
	const forwarded = parts(r.jsonl).find((p) => p.type === "text" && p.text?.includes(NOTE));
	pass = Boolean(forwarded) && calls.includes("team_create_member");
	console.log(`[5a] forwarded-request carries the note verbatim: ${Boolean(forwarded)}`);
	console.log(`[5a] team tool calls after confirmation: ${JSON.stringify(calls.filter((c) => c.startsWith("team_")))}`);
	console.log(`[5a] VERDICT: ${pass ? "PASS" : "FAIL"}`);
	fs.rmSync(a.root, { recursive: true, force: true });
} else if (scenario === "5b") {
	// Pinned tier: a standing preference means "stop asking" — neither the
	// picker nor the three-option confirmation may appear on the command path
	// (the keyword path has always applied the pin directly). Negative
	// assertions on both dialogs.
	const a = makeAgent("probe5b", PLAN_CFG.replace("[stepcodeAgentTeam.plan]\nenabled = true", '[stepcodeAgentTeam.plan]\nenabled = true\ntier = "fast"'));
	const seen = [];
	const r = await runSession("probe5b", a.agentDir, [{ message: "/topo 统计这个项目的源文件数量并汇报", waitMs: 90000 }], (msg) => {
		if (msg.method === "select") {
			seen.push(msg.title);
			if (msg.title === "智能体团队") return { value: (msg.options ?? [])[0] };
		}
		return null;
	});
	const pickerSeen = seen.includes("选择团队方案");
	const confirmSeen = seen.includes("智能体团队");
	pass = !pickerSeen && !confirmSeen;
	console.log(`[5b] picker dialog appeared: ${pickerSeen} (must be false)`);
	console.log(`[5b] confirmation dialog appeared: ${confirmSeen} (must be false — a pinned tier asks nothing)`);
	console.log(`[5b] VERDICT: ${pass ? "PASS" : "FAIL"}`);
	fs.rmSync(a.root, { recursive: true, force: true });
} else if (scenario === "7") {
	// L1 guard: a pure meta question stays suppressed; a how-to with a body
	// activates and the team tools become usable.
	const a = makeAgent("probe7a", ACTIVATION_CFG);
	const sup = await runSession("probe7a", a.agentDir, [{ message: "什么是智能体小队？", waitMs: 40000 }]);
	const supTools = parts(sup.jsonl).filter((p) => p.type === "toolCall" && p.name?.startsWith("team_"));
	const supOk = !sup.notifies.some((n) => n.includes("activated")) && supTools.length === 0;
	console.log(`[7-suppress] activated=false teamToolCalls=${supTools.length} :: ${supOk ? "PASS" : "FAIL"}`);
	const b = makeAgent("probe7b", ACTIVATION_CFG);
	const act = await runSession(
		"probe7b",
		b.agentDir,
		[
			{ message: "如何用智能体小队并行审查这个仓库？", waitMs: 30000 },
			{ message: "创建一个 scout 角色的成员，名字叫 probe7", waitMs: 60000 },
		],
		(msg) => (msg.method === "confirm" ? { confirmed: true } : null),
	);
	const actOk = act.notifies.some((n) => n.includes("activated"));
	const created = parts(act.jsonl).some((p) => p.type === "toolCall" && p.name === "team_create_member");
	console.log(`[7-activate] activated=${actOk} team_create_member called: ${created} :: ${actOk && created ? "PASS" : "FAIL"}`);
	pass = supOk && actOk && created;
	fs.rmSync(a.root, { recursive: true, force: true });
	fs.rmSync(b.root, { recursive: true, force: true });
} else if (scenario === "8") {
	// Custom role file -> frontmatter tools/effort/prompt land on a real spawn.
	const a = makeAgent("probe8", ACTIVATION_CFG + "[stepcodeAgentTeam.models]\nautonomousEffort = false\n", {
		"agents/quickfix.md": [
			"---", "name: quickfix", "description: 快速小修：最小改动、只动必要的文件、做完汇报",
			"tools: read, grep, edit, bash", "effort: low", "---",
			"你是快速修复员 quickfix：只做被明确指派的修改，保持最小改动。", "",
		].join("\n"),
	});
	const r = await runSession("probe8", a.agentDir, [
		{ message: "/topo 创建一个 quickfix 角色的成员，取名 fixer1，让它用一句话列出自己的工具白名单", waitMs: 120000 },
	]);
	const all = parts(r.jsonl).filter((p) => p.type === "text").map((p) => p.text ?? "").join("\n");
	const createOk = /Created member "fixer1" \(role: quickfix\)/.test(all) && /effort: low/.test(all) && /tools: read, grep, edit, bash/.test(all);
	const replyOk = /工具白名单/.test(all) && /topo_team_msg/.test(all);
	pass = createOk && replyOk;
	console.log(`[8] create result shows role+effort:low+frontmatter tools: ${createOk}`);
	console.log(`[8] member self-report lists the whitelist + topo_team_msg: ${replyOk}`);
	console.log(`[8] VERDICT: ${pass ? "PASS" : "FAIL"}`);
	fs.rmSync(a.root, { recursive: true, force: true });
} else if (scenario === "9") {
	// Deprecated keyword is stripped and reported exactly once per session.
	const a = makeAgent("probe9", [
		"[stepcodeAgentTeam.activation]", "enabled = true",
		'keywords = ["智能体团队", "智能体小队", "topo team"]', "guardEnabled = true", "",
	].join("\n"));
	const r = await runSession(
		"probe9",
		a.agentDir,
		[
			{ message: "我想用智能体小队熟悉一下这个项目", waitMs: 30000 },
			{ message: "我想用智能体小队熟悉一下这个项目", waitMs: 30000 },
		],
		(msg) => (msg.method === "confirm" ? { confirmed: true } : null),
	);
	const notices = r.notifies.filter((n) => n.startsWith("Migrated activation config"));
	pass = notices.length === 1;
	console.log(`[9] migration notices: ${notices.length} :: ${JSON.stringify(notices.slice(0, 1))}`);
	console.log(`[9] VERDICT: ${pass ? "PASS" : "FAIL"}`);
	fs.rmSync(a.root, { recursive: true, force: true });
} else {
	console.error("usage: node sandbox/probe-remaining-manual.mjs <5a|5b|7|8|9>");
	process.exit(2);
}
process.exit(pass ? 0 : 1);
