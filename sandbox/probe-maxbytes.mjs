/**
 * 路径 B：searcher 真实链路上的 MAX_BYTES 截断验证。
 *
 * 做法：把 STEPCODE_TOPO_MAX_BYTES 调到 4096 后跑一次**真实的** search 调用。
 * 截断判定是 `raw.length > maxBytes`（topo-search.mjs:285），与 maxBytes 取
 * 2 MiB 还是 4096 无关——所以调小 cap 是同一个代码路径的等价验证，且不需要
 * 找到一个真的超过 2 MiB 的页面。
 *
 * 计费：1 次 search 请求（与不设 cap 同价，服务方按成功请求计费）。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = "/home/ctc/GitProjects/Step-Code-Agent-Team";
const diag = "/tmp/pend-b-diag.txt";
const log = (...a) => {
	console.error("[pendB]", ...a);
	try {
		fs.appendFileSync(diag, a.map(String).join(" ") + "\n");
	} catch {
		/* ignore */
	}
};

/** 解析真实 node（step RPC 会话里 process.execPath 是 bun 编译的 step）。 */
function realNode() {
	for (const c of ["/usr/bin/node", "/usr/local/bin/node"]) {
		if (fs.existsSync(c)) return c;
	}
	return "node";
}

function run(args, env) {
	return new Promise((resolve) => {
		const proc = spawn(realNode(), [path.join(ROOT, "bin/topo-search.mjs"), ...args], {
			env: { ...process.env, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		const timer = setTimeout(() => proc.kill("SIGTERM"), 60_000);
		proc.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
		proc.on("error", (err) => {
			clearTimeout(timer);
			resolve({ code: null, stdout, stderr: stderr + err.message });
		});
	});
}

// 从 sandbox/config.toml 读 [stepcodeAgentTeam.searcher] 的四个键（只读值，绝不回显）。
function readSearcherConfig() {
	const file = path.join(ROOT, "sandbox/config.toml");
	if (!fs.existsSync(file)) return {};
	const text = fs.readFileSync(file, "utf8");
	const out = {};
	let inTable = false;
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (t.startsWith("[") && t.endsWith("]")) {
			inTable = t === "[stepcodeAgentTeam.searcher]";
			continue;
		}
		if (!inTable || !t || t.startsWith("#")) continue;
		const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"([^"]*)"/);
		if (m) out[m[1]] = m[2];
	}
	return out;
}

const cfg = readSearcherConfig();
log("config keys present:", Object.keys(cfg).join(",") || "(none)");

const baseEnv = {
	STEPCODE_TOPO_SEARCH_URL: cfg.searchUrl ?? "",
	STEPCODE_TOPO_SEARCH_KEY: cfg.searchApiKey ?? "",
	STEPCODE_TOPO_FETCH_URL: cfg.fetchUrl ?? "",
	STEPCODE_TOPO_FETCH_KEY: cfg.fetchApiKey ?? "",
};

const results = [];
const check = (name, ok, detail = "") => {
	results.push({ name, ok, detail });
	log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
};

const main = async () => {
	// 第一次：不设 cap（默认 2 MiB），确认基线链路仍然通。
	const plain = await run(["search", "--query", "site:github.com CTCingithub Step-Code-Agent-Team", "--count", "3"], baseEnv);
	let plainJson = null;
	try {
		plainJson = JSON.parse(plain.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}");
	} catch {
		/* ignore */
	}
	check("真实链路：默认 cap 下 search 成功", plain.code === 0 && plainJson?.ok === true, `code=${plain.code} ok=${plainJson?.ok}`);
	check("真实链路：默认 cap 下未标记截断", plainJson?.meta?.truncated !== true, JSON.stringify(plainJson?.meta ?? {}));

	// 第二次：cap 4096。同一次真实调用，同一个代码路径（raw.length > maxBytes）。
	const capped = await run(
		["search", "--query", "site:github.com CTCingithub Step-Code-Agent-Team", "--count", "5", "--need-content"],
		{ ...baseEnv, STEPCODE_TOPO_MAX_BYTES: "4096" },
	);
	let capJson = null;
	try {
		capJson = JSON.parse(capped.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}");
	} catch {
		/* ignore */
	}
	check("截断：cap=4096 下请求仍成功（截断不是错误）", capJson?.ok === true, `ok=${capJson?.ok}`);
	check("截断：meta.truncated 被置位", capJson?.meta?.truncated === true, JSON.stringify(capJson?.meta ?? {}));
	check("截断：data 带 _truncated 与说明", capJson?.data?._truncated === true && typeof capJson?.data?._note === "string",
		`note=${JSON.stringify(capJson?.data?._note ?? "")}`);
	check("截断：说明里带出实际生效的 cap", /4096/.test(String(capJson?.data?._note ?? "")), String(capJson?.data?._note ?? ""));

	// 第三次：cap=0 的边界。0 是"调用方最可能设成 0"的值，必须被当成有效值而非"未设置"。
	const zero = await run(["search", "--query", "test", "--count", "1"], { ...baseEnv, STEPCODE_TOPO_MAX_BYTES: "0" });
	let zeroJson = null;
	try {
		zeroJson = JSON.parse(zero.stdout.trim().split("\n").filter(Boolean).pop() ?? "{}");
	} catch {
		/* ignore */
	}
	check("边界：cap=0 被当成有效值（0 字节上限，必然截断）",
		zeroJson?.meta?.truncated === true, JSON.stringify(zeroJson?.meta ?? {}));

	const failed = results.filter((r) => !r.ok);
	log(`PENDB DONE (${results.length - failed.length}/${results.length} passed)`);
	fs.writeFileSync("/tmp/pend-b-summary.txt", `PASS=${results.length - failed.length} FAIL=${failed.length}\n`);
	process.exit(failed.length > 0 ? 1 : 0);
};

main();
