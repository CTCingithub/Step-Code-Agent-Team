/**
 * Step-CLI contract probe (plan-123). Zero-token, standalone: the flags this
 * plugin passes to `step` when it spawns a member are an unwritten contract
 * with the pinned Step Code source, and nothing tested it. A silent upstream
 * removal or rename would surface as members that cannot start — during a live
 * round, not in the gate.
 *
 * What it locks down:
 *   1. every flag extensions/members.ts passes is still accepted by the pinned
 *      binary (read from `step --help`, so the check tracks the binary actually
 *      resolved by sandbox/step-bin.sh);
 *   2. `--approval-mode` still accepts the one value this plugin uses (`auto`)
 *      and still rejects a retired one (`strict`) with the documented message —
 *      the tier vocabulary was replaced in Step Code 0.1.7 (Ask / Approve for
 *      Me / Full Access), so a value we pass could silently stop being valid;
 *   3. `-e` / `--extension` is still the spelling for loading an extension,
 *      because members are spawned with `--no-extensions -e <messaging>`.
 *
 * The probe spawns the resolved binary once per assertion group; `--help` exits
 * immediately, so the whole phase costs a few process starts and no tokens.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";

const REPO = path.resolve(import.meta.dirname, "../..");

/** The flags extensions/members.ts passes when spawning a member process. */
const REQUIRED_FLAGS = [
	"--mode",
	"--session-id",
	"--session-dir",
	"--no-extensions",
	"--extension",
	"--append-system-prompt",
	"--approval-mode",
	// Passed by the sandbox scripts rather than members.ts, but part of the same
	// contract: run-smoke.sh and every live check drive the binary with these.
	"--model",
	"--thinking",
	"--tools",
	// Passed by members.ts when it builds a member: the member must not inherit
	// or resume the leader's session, so it gets a fresh one.
	"--no-session",
];

function runStep(args: string[], timeoutMs = 90_000): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		// step-bin.sh is sourced, not executed: it defines resolve_step_bin, which
		// applies the same order the runner does ($STEPCODE_STEP_BIN >
		// sandbox/step-build > PATH). Resolving it here keeps this probe pointed at
		// the binary the gate actually uses.
		const child = spawn("bash", ["-c", `source "${path.join(REPO, "sandbox", "step-bin.sh")}" && exec "$(resolve_step_bin)" "$@"`, "--", ...args], {
			cwd: REPO,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (d) => (stdout += d));
		child.stderr.on("data", (d) => (stderr += d));
		const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, stdout, stderr });
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			resolve({ code: -1, stdout, stderr: String(err) });
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke32]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${String(detail).replace(/\s+/g, " ").slice(0, 170)}` : ""}`);
		};

		try {
			// ---- 0. which binary are we actually talking to? ----
			const version = await runStep(["--version"]);
			const versionText = (version.stdout + version.stderr).trim();
			check("cli: the resolved binary reports a version", /\d+\.\d+\.\d+/.test(versionText), versionText.slice(0, 40));
			log(`resolved step version: ${versionText.slice(0, 40)}`);

			// ---- 1. every flag the plugin passes is still accepted ----
			const help = await runStep(["--help"]);
			const helpText = help.stdout + help.stderr;
			check("cli: --help succeeds", help.code === 0, `code=${help.code}`);
			const missing = REQUIRED_FLAGS.filter((f) => !helpText.includes(f));
			check("cli: every flag this plugin passes is documented", missing.length === 0, missing.join(","));

			// ---- 2. the approval-mode vocabulary this plugin relies on ----
			// Step Code 0.1.7 replaced the permission tiers (Ask / Approve for Me /
			// Full Access) and retired `strict`; the plugin spawns members with
			// `auto`, so both halves of that have to keep holding.
			const bad = await runStep(["--mode", "rpc", "--approval-mode", "strict", "--session-id", "probe", "--session-dir", fs.mkdtempSync(path.join(REPO, "sandbox", "logs", "s32-"))]);
			check("cli: a retired approval mode is still rejected", /Invalid approval mode/.test(bad.stderr + bad.stdout), (bad.stderr + bad.stdout).slice(0, 90));
			check("cli: the rejection names the valid values", /confirm/.test(bad.stderr + bad.stdout) && /auto/.test(bad.stderr + bad.stdout), (bad.stderr + bad.stdout).slice(0, 90));
			fs.rmSync(path.join(REPO, "sandbox", "logs", "s32-"), { recursive: true, force: true });

			// ---- 3. -e / --extension is still how an extension is loaded ----
			check("cli: -e and --extension are the same flag", helpText.includes("-e,") || /-e,\s*--extension/.test(helpText) || (helpText.includes("--extension") && helpText.includes("-e ")), "spelling check");

			// ---- 4. a member still inherits the leader's environment ----
			// `STEP_CODING_AGENT_DIR` decides where the global unified config lives
			// (dirname(agentDir)/config.toml). If the spawn ever stopped inheriting
			// it, members would silently read a DIFFERENT config: the searcher
			// endpoints and keys, the `[compaction]` table and the model settings
			// would all diverge from the leader's with nothing to show for it.
			const { memberSpawnEnv } = await import("../../extensions/rpc-client.ts");
			const sentinel = "stepcode-probe-agent-dir";
			const previous = process.env.STEP_CODING_AGENT_DIR;
			process.env.STEP_CODING_AGENT_DIR = sentinel;
			try {
				const merged = memberSpawnEnv({ STEPCODE_TEAM_MEMBER: "probe1" });
				check("spawn env: the leader's STEP_CODING_AGENT_DIR is inherited", merged.STEP_CODING_AGENT_DIR === sentinel, String(merged.STEP_CODING_AGENT_DIR));
				check("spawn env: the per-member override still wins", merged.STEPCODE_TEAM_MEMBER === "probe1", String(merged.STEPCODE_TEAM_MEMBER));
				check("spawn env: unrelated leader vars survive too", typeof merged.PATH === "string" && merged.PATH.length > 0, "PATH present");
			} finally {
				if (previous === undefined) delete process.env.STEP_CODING_AGENT_DIR;
				else process.env.STEP_CODING_AGENT_DIR = previous;
			}

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE32 DONE (all passed)" : `SMOKE32 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE32 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		}
	});
}
