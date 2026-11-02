/**
 * At-rest encryption probe (v0.4.0). Zero-token, standalone: drives the
 * encrypt/decrypt round-trip and the registry's dual-read directly against
 * hermetic mktemp workspaces, so no model call and no real team are involved.
 *
 * What it locks down:
 *   1. the envelope round-trips (AES-256-GCM, iv+tag+data) and the payload
 *      survives byte-for-byte;
 *   2. a PLAINTEXT registry — every team created before encryption existed —
 *      still loads, which is the backward-compatibility contract;
 *   3. `encryption.enabled = false` writes plaintext, and a missing key
 *      degrades to plaintext instead of throwing;
 *   4. tampering is detected (GCM auth tag), and a wrong key fails closed.
 *
 * The key material is never logged — only its shape.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { decryptJson, encryptJson, isEncryptedEnvelope, loadTeamKey } from "../../extensions/crypto.ts";
import { ensureTopoDir } from "../../extensions/topo-init.ts";
import { loadRegistry, saveRegistry, type TeamRegistry } from "../../extensions/registry.ts";
import { defaultConfig, getConfig, resetConfigCache } from "../../extensions/config.ts";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke26]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const temps: string[] = [];
		const mkCwd = (): string => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scat26-"));
			temps.push(dir);
			return dir;
		};
		const keyShape = (p: string): string => {
			if (!fs.existsSync(p)) return "<missing>";
			const raw = fs.readFileSync(p, "utf8").trim();
			const decoded = Buffer.from(raw, "base64");
			return `len=${raw.length} decoded=${decoded.length} canonical=${Buffer.from(decoded).toString("base64") === raw}`;
		};

		try {
			const d = defaultConfig();
			const agentDir = process.env.STEP_CODING_AGENT_DIR ?? "";
			const settingsFile = path.join(agentDir, "settings.json");
			const hadSettings = fs.existsSync(settingsFile);
			const prevSettings = hadSettings ? fs.readFileSync(settingsFile, "utf8") : "";

			// ---- 1. round-trip through the envelope ----
			const cwd = mkCwd();
			const topo = ensureTopoDir(cwd);
			check("init: .topo created for the encryption probe", topo.created && !topo.error, topo.error ?? "");
			const key = loadTeamKey(cwd);
			check("key: loadTeamKey returns 32 bytes", key !== null && key.length === 32, key ? `${key.length}` : "null");
			check("key: shape is canonical base64", keyShape(topo.keyPath) === "len=44 decoded=32 canonical=true", keyShape(topo.keyPath));

			const payload = {
				schemaVersion: 1 as const,
				teamId: "probe-team",
				createdAt: 1,
				cwd,
				members: [],
				tasks: [{ id: "T1", title: "秘密：读取 src/tasks.js 的 complete()", detail: "", blockedBy: [], status: "done" as const, result: "报告正文：find((t) => t.id === id)" }],
				topology: { shape: "star" as const, edges: [] },
			};
			const sealed = encryptJson(payload, payload.teamId, cwd, key!);
			check("envelope: parses and is recognised", isEncryptedEnvelope(JSON.parse(sealed)));
			check("envelope: carries iv/tag/data", (() => { const e = JSON.parse(sealed); return Boolean(e.iv && e.tag && e.data); })());
			check("envelope: the plaintext task title is NOT in the ciphertext", !sealed.includes("complete()") && !sealed.includes("报告正文"), sealed.slice(0, 120));
			const opened = decryptJson(sealed, key!) as typeof payload;
			check("round-trip: payload survives", JSON.stringify(opened) === JSON.stringify(payload), opened.tasks[0]?.title ?? "");
			check("round-trip: cwd is readable from the envelope (for key lookup)", (JSON.parse(sealed) as { cwd: string }).cwd === cwd);

			// ---- 2. tamper + wrong key fail closed ----
			const tampered = JSON.parse(sealed) as Record<string, unknown>;
			tampered.data = Buffer.from("x").toString("base64");
			let tamperRejected = false;
			try { decryptJson(JSON.stringify(tampered), key!); } catch { tamperRejected = true; }
			check("tamper: modified ciphertext is rejected", tamperRejected);
			const otherKey = Buffer.alloc(32, 7);
			let wrongKeyRejected = false;
			try { decryptJson(sealed, otherKey); } catch { wrongKeyRejected = true; }
			check("tamper: a wrong key is rejected", wrongKeyRejected);

			// ---- 3. a PLAINTEXT registry still loads (backward compatibility) ----
			// Point storage.dir at a temp root so the real team state is untouched.
			const store = mkCwd();
			fs.writeFileSync(
				settingsFile,
				JSON.stringify({ stepcodeAgentTeam: { encryption: { enabled: false }, storage: { dir: store } } }),
			);
			resetConfigCache();
			const plainReg: TeamRegistry = { ...payload, teamId: "plain-team", cwd };
			saveRegistry(plainReg);
			const plainFile = path.join(store, "plain-team", "registry.json");
			check("plain write: file is plaintext (no envelope)", !fs.readFileSync(plainFile, "utf8").includes('"encrypted"'));
			check("plain write: task title readable without a key", fs.readFileSync(plainFile, "utf8").includes("complete()"));
			check("plain read: loadRegistry returns it", loadRegistry("plain-team")?.tasks[0]?.title === plainReg.tasks[0].title);

			// ---- 4. enabled + a key present → ciphertext on disk, readable back ----
			fs.writeFileSync(
				settingsFile,
				JSON.stringify({ stepcodeAgentTeam: { encryption: { enabled: true }, storage: { dir: store } } }),
			);
			resetConfigCache();
			check("config: encryption defaults to on", getConfig().encryption.enabled === true);
			check("config: searcher defaults to empty strings", (() => { const s = getConfig().searcher; return s.searchUrl === "" && s.searchApiKey === "" && s.fetchUrl === "" && s.fetchApiKey === ""; })());
			saveRegistry(plainReg);
			const sealedText = fs.readFileSync(plainFile, "utf8");
			check("encrypted write: file is an envelope", isEncryptedEnvelope(JSON.parse(sealedText)));
			check("encrypted write: task title NOT on disk", !sealedText.includes("complete()"));
			check("encrypted read: loadRegistry transparently decrypts", loadRegistry("plain-team")?.tasks[0]?.title === plainReg.tasks[0].title);
			check("encrypted read: members/tasks survive", (loadRegistry("plain-team")?.tasks.length ?? 0) === 1);

			// ---- 5. a missing key degrades instead of throwing ----
			const noKeyCwd = mkCwd();
			const noKeyReg: TeamRegistry = { ...payload, teamId: "nokey-team", cwd: noKeyCwd };
			let threw = false;
			try { saveRegistry(noKeyReg); } catch { threw = true; }
			check("degrade: saving without a key does not throw", !threw);
			check("degrade: without a key the registry is plaintext", !fs.readFileSync(path.join(store, "nokey-team", "registry.json"), "utf8").includes('"encrypted"'));
			check("degrade: loadTeamKey on a workspace without .topo returns null", loadTeamKey(noKeyCwd) === null);

			if (hadSettings) fs.writeFileSync(settingsFile, prevSettings);
			else fs.rmSync(settingsFile, { force: true });
			resetConfigCache();
			check("cleanup: default encryption restored", getConfig().encryption.enabled === d.encryption.enabled);

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE26 DONE (all passed)" : `SMOKE26 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE26 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}
