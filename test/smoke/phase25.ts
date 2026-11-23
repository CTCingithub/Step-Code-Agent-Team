/**
 * `.topo/` init probe (T28). Zero-token, standalone style: drives
 * ensureTopoDir() directly against hermetic mktemp cwds, so the whole init
 * contract — directory creation, 0600 key material, idempotence, the
 * read-only `.gitignore` touch and the degrade-without-throw paths — runs
 * without a model call and without ever touching the real repository.
 *
 * Why this exists: the `.topo` directory is the on-disk home of the team
 * state, so every failure mode here (a `.topo` that is already a file, a
 * symlink, an unwritable parent, an over-long path) is a failure the user
 * would otherwise discover only when the team refuses to start. The probe
 * asserts the exact bytes written to `.gitignore`, because that file belongs
 * to the user: the only allowed edit is appending one `.topo/` line, and
 * every pre-existing byte must survive verbatim.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@step-harness/coding-agent";
import { ensureTopoDir, GITIGNORE_FILE, KEY_FILE_NAME, TOPO_DIR } from "../../extensions/topo-init.ts";

type InitResult = ReturnType<typeof ensureTopoDir>;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async () => {
		const log = (...a: unknown[]) => console.error("[smoke25]", ...a);
		const results: Array<{ name: string; ok: boolean; detail: string }> = [];
		const check = (name: string, ok: boolean, detail = "") => {
			results.push({ name, ok, detail });
			log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail.replace(/\s+/g, " ").slice(0, 160)}` : ""}`);
		};

		const temps: string[] = [];
		const mkCwd = (): string => {
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scat25-"));
			temps.push(dir);
			return dir;
		};
		const giOf = (cwd: string): string => path.join(cwd, GITIGNORE_FILE);
		const readGi = (cwd: string): string => (fs.existsSync(giOf(cwd)) ? fs.readFileSync(giOf(cwd), "utf8") : "<missing>");
		// The key material is a secret: only its shape is ever logged.
		const keyShape = (p: string): string => {
			if (!fs.existsSync(p)) return "<missing>";
			const raw = fs.readFileSync(p, "utf8");
			const decoded = Buffer.from(raw, "base64");
			return `len=${raw.length} decoded=${decoded.length} canonical=${Buffer.from(decoded).toString("base64") === raw}`;
		};

		try {
			// ---- 1. a fresh cwd: directory, 0600 key, no .gitignore invented ----
			const fresh = mkCwd();
			const r = ensureTopoDir(fresh);
			check("fresh: created=true", r.created === true, String(r.created));
			check("fresh: no error", !r.error, r.error ?? "");
			check("fresh: .topo is a real directory", fs.statSync(path.join(fresh, TOPO_DIR)).isDirectory());
			check("fresh: keyPath is <cwd>/.topo/team.key", r.keyPath === path.join(fresh, TOPO_DIR, KEY_FILE_NAME), r.keyPath);
			check("fresh: key file exists", fs.existsSync(r.keyPath));
			check("fresh: key mode is 0600", (fs.statSync(r.keyPath).mode & 0o777) === 0o600, (fs.statSync(r.keyPath).mode & 0o777).toString(8));
			check("fresh: key is base64 of exactly 32 random bytes", keyShape(r.keyPath) === "len=44 decoded=32 canonical=true", keyShape(r.keyPath));
			check(
				"fresh: .gitignore absent → gitignorePath null and no file created",
				r.gitignorePath === null && r.gitignoreUpdated === false && !fs.existsSync(giOf(fresh)),
				`path=${String(r.gitignorePath)} exists=${fs.existsSync(giOf(fresh))}`,
			);

			// Two independent cwds must not share key material (randomBytes, not a constant).
			const other = mkCwd();
			ensureTopoDir(other);
			const k1 = fs.readFileSync(path.join(fresh, TOPO_DIR, KEY_FILE_NAME), "utf8");
			const k2 = fs.readFileSync(path.join(other, TOPO_DIR, KEY_FILE_NAME), "utf8");
			check("fresh: two cwds get different keys", k1 !== k2 && k1.length === 44 && k2.length === 44);

			// ---- 2. idempotence: second call changes nothing ----
			const again = ensureTopoDir(fresh);
			check("idempotent: second call created=false", again.created === false, String(again.created));
			check("idempotent: second call gitignoreUpdated=false", again.gitignoreUpdated === false, String(again.gitignoreUpdated));
			check("idempotent: second call reports the same keyPath", again.keyPath === r.keyPath, again.keyPath);
			check("idempotent: key bytes unchanged", fs.readFileSync(r.keyPath, "utf8") === k1);
			check("idempotent: .gitignore still absent", !fs.existsSync(giOf(fresh)));

			// ---- 3. a pre-existing key is reused, never regenerated ----
			const seeded = mkCwd();
			fs.mkdirSync(path.join(seeded, TOPO_DIR));
			const known = "A".repeat(43) + "="; // 44 chars of canonical base64 → 32 bytes
			fs.writeFileSync(path.join(seeded, TOPO_DIR, KEY_FILE_NAME), known, { mode: 0o600 });
			const reused = ensureTopoDir(seeded);
			check("existing key: reused verbatim (no regeneration)", fs.readFileSync(reused.keyPath, "utf8") === known);
			check("existing key: created=false", reused.created === false, String(reused.created));
			check("existing key: mode tightened to 0600", (fs.statSync(reused.keyPath).mode & 0o777) === 0o600, (fs.statSync(reused.keyPath).mode & 0o777).toString(8));

			// ---- 4. .gitignore present without an entry: append, preserve bytes ----
			const g = mkCwd();
			const original = "node_modules/\ndist/\n*.log\n";
			fs.writeFileSync(giOf(g), original);
			const appended = ensureTopoDir(g);
			check("gitignore: existing file is reported", appended.gitignorePath === giOf(g), String(appended.gitignorePath));
			check("gitignore: updated=true", appended.gitignoreUpdated === true, String(appended.gitignoreUpdated));
			const afterAppend = readGi(g);
			check("gitignore: exactly one .topo/ line appended", afterAppend === `${original}.topo/\n`, JSON.stringify(afterAppend));
			check("gitignore: original content preserved verbatim", afterAppend.startsWith(original));
			const appendedAgain = ensureTopoDir(g);
			check(
				"gitignore: second call does not re-append",
				appendedAgain.gitignoreUpdated === false && readGi(g) === afterAppend,
				JSON.stringify(readGi(g)),
			);

			// ---- 5. every accepted spelling suppresses the append ----
			for (const form of [".topo/", ".topo", "/.topo", "/.topo/"]) {
				const c = mkCwd();
				const content = `node_modules/\n# local state\n${form}\n`;
				fs.writeFileSync(giOf(c), content);
				const res = ensureTopoDir(c);
				check(`gitignore: existing "${form}" entry left untouched`, res.gitignoreUpdated === false && readGi(c) === content, JSON.stringify(readGi(c)));
				check(`gitignore: "${form}" still reports the path`, res.gitignorePath === giOf(c) && res.gitignoreUpdated === false);
			}

			// ---- 6. a missing trailing newline is added before the appended line ----
			const n = mkCwd();
			const noNewline = "node_modules/\ndist/";
			fs.writeFileSync(giOf(n), noNewline);
			const nl = ensureTopoDir(n);
			check("gitignore: updated=true when appending after a missing newline", nl.gitignoreUpdated === true);
			const afterNl = readGi(n);
			check("gitignore: newline added before the appended line", afterNl === `${noNewline}\n.topo/\n`, JSON.stringify(afterNl));
			check("gitignore: original bytes preserved verbatim (no-newline case)", afterNl.startsWith(noNewline));

			// ---- 7. CRLF line endings survive the append ----
			const c = mkCwd();
			const crlf = "node_modules/\r\ndist/\r\n";
			fs.writeFileSync(giOf(c), crlf);
			ensureTopoDir(c);
			check("gitignore: CRLF endings preserved", readGi(c) === `${crlf}.topo/\r\n`, JSON.stringify(readGi(c)));

			// ---- 8. an empty .gitignore gets one line, no leading blank ----
			const e = mkCwd();
			fs.writeFileSync(giOf(e), "");
			ensureTopoDir(e);
			check("gitignore: empty file gets exactly one line", readGi(e) === ".topo/\n", JSON.stringify(readGi(e)));

			// ---- 9. `.topo` already exists as a FILE: degrade, never throw ----
			const f = mkCwd();
			const asFile = path.join(f, TOPO_DIR);
			fs.writeFileSync(asFile, "i am not a directory\n");
			let threw = false;
			let fileRes: InitResult | undefined;
			try {
				fileRes = ensureTopoDir(f);
			} catch {
				threw = true;
			}
			check("degrade: .topo as a file does not throw", !threw);
			check("degrade: .topo as a file reports an error", Boolean(fileRes?.error), fileRes?.error ?? "<none>");
			check("degrade: .topo as a file → created=false", fileRes?.created === false, String(fileRes?.created));
			check("degrade: the pre-existing file is left untouched", fs.readFileSync(asFile, "utf8") === "i am not a directory\n");
			check("degrade: no key written beside a file .topo", !fs.existsSync(fileRes?.keyPath ?? path.join(f, TOPO_DIR, KEY_FILE_NAME)));
			check("degrade: .gitignore not touched when init fails", readGi(f) === "<missing>");

			// ---- 10. `.topo` is a SYMLINK: not followed (see extensions/topo-init.ts) ----
			// The implementation chooses lstat-and-report over following the link: a
			// symlinked `.topo` is either a deliberate redirection (the caller must
			// decide, not this helper) or a planted link, and writing 0600 key
			// material through a link we did not create would leak a secret to an
			// arbitrary path. So the probe asserts the error path: the link stays a
			// link, its target stays empty, and the caller gets `error` to decide.
			const s = mkCwd();
			const target = path.join(s, "real-topo");
			fs.mkdirSync(target);
			const link = path.join(s, TOPO_DIR);
			fs.symlinkSync(target, link);
			let linkThrew = false;
			let linkRes: InitResult | undefined;
			try {
				linkRes = ensureTopoDir(s);
			} catch {
				linkThrew = true;
			}
			check("degrade: symlinked .topo does not throw", !linkThrew);
			check("degrade: symlinked .topo reports an error", Boolean(linkRes?.error), linkRes?.error ?? "<none>");
			check("degrade: symlinked .topo → created=false", linkRes?.created === false, String(linkRes?.created));
			check("degrade: the symlink is not replaced by a real directory", fs.lstatSync(link).isSymbolicLink());
			check("degrade: nothing written through the link", fs.readdirSync(target).length === 0, fs.readdirSync(target).join(","));

			// ---- 11. an over-long path degrades instead of throwing ----
			const longRoot = mkCwd();
			const longCwd = path.join(longRoot, "x".repeat(300)); // one component over NAME_MAX
			let longThrew = false;
			let longRes: InitResult | undefined;
			try {
				longRes = ensureTopoDir(longCwd);
			} catch {
				longThrew = true;
			}
			check("degrade: over-long path does not throw", !longThrew);
			check("degrade: over-long path reports an error", Boolean(longRes?.error), longRes?.error ?? "<none>");
			check("degrade: over-long path → created=false", longRes?.created === false, String(longRes?.created));

			const failed = results.filter((r) => !r.ok).length;
			log(failed === 0 ? "SMOKE25 DONE (all passed)" : `SMOKE25 DONE (${failed}/${results.length} failed)`);
			setTimeout(() => process.exit(failed === 0 ? 0 : 1), 2000);
		} catch (err) {
			log("SMOKE25 FAILED:", err instanceof Error ? err.message : String(err));
			setTimeout(() => process.exit(1), 2000);
		} finally {
			for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
		}
	});
}
