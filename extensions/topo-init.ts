/**
 * `.topo/` — the plugin's working directory inside the user's workspace.
 *
 * Created on first activation (never at load time: the plugin is default-off,
 * so an inactive session must leave no trace in the user's tree). It currently
 * holds exactly one file, `team.key` — the AES key that encrypts the team
 * registry at rest — and is registered in `.gitignore` so the key can never be
 * committed by accident.
 *
 * Every failure path degrades into `error` instead of throwing: the caller is
 * an activation hook, and a workspace that cannot host a working directory
 * (`.topo` already a file, a symlink, a read-only parent, an over-long path)
 * must still be able to run a team — just without at-rest encryption.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Directory name inside the user's workspace. */
export const TOPO_DIR = ".topo";
/** Key material file inside `.topo/` (32 random bytes, base64, mode 0600). */
export const KEY_FILE_NAME = "team.key";
/** The ignore file we append to when it already exists. */
export const GITIGNORE_FILE = ".gitignore";
/** The single line appended to `.gitignore`. */
export const GITIGNORE_ENTRY = ".topo/";

/** Key length in bytes before base64 encoding (AES-256). */
const KEY_BYTES = 32;

export interface TopoInitResult {
	/** Whether this call created the `.topo/` directory. */
	created: boolean;
	/** Whether this call appended the `.gitignore` entry. */
	gitignoreUpdated: boolean;
	/** The `.gitignore` that was found and (maybe) updated; null when absent. */
	gitignorePath: string | null;
	/** Absolute path of the key file, whether or not it could be written. */
	keyPath: string;
	/** Why the init degraded, when it did. Never thrown. */
	error?: string;
}

/**
 * Every spelling git accepts for this entry. A user who already ignores the
 * directory in any of these forms must not get a second line.
 */
const ACCEPTED_ENTRIES = new Set([".topo/", ".topo", "/.topo", "/.topo/"]);

function isAcceptedEntry(line: string): boolean {
	return ACCEPTED_ENTRIES.has(line.trim());
}

/** Detects the line ending a `.gitignore` uses so the appended line matches. */
function detectEol(text: string): string {
	return text.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Ensures `<cwd>/.topo/` exists with 0600 key material, and that an existing
 * `.gitignore` ignores it. Idempotent: repeated calls neither re-append nor
 * regenerate the key.
 */
export function ensureTopoDir(cwd: string): TopoInitResult {
	const topoPath = path.join(cwd, TOPO_DIR);
	const keyPath = path.join(topoPath, KEY_FILE_NAME);
	const base: TopoInitResult = { created: false, gitignoreUpdated: false, gitignorePath: null, keyPath };

	// ---- 1. the directory. lstat, never stat: a symlinked `.topo` is either a
	// deliberate redirection the caller must decide about, or a planted link —
	// and writing 0600 key material through a link we did not create would leak
	// a secret to an arbitrary path. So we refuse and let the caller decide.
	let stat: fs.Stats | null = null;
	try {
		stat = fs.lstatSync(topoPath);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			return { ...base, error: `cannot inspect ${TOPO_DIR}/: ${errMessage(err)}` };
		}
	}
	if (stat) {
		if (stat.isSymbolicLink()) {
			return { ...base, error: `${TOPO_DIR}/ is a symlink — refusing to write key material through it` };
		}
		if (!stat.isDirectory()) {
			return { ...base, error: `${TOPO_DIR}/ exists but is not a directory` };
		}
	} else {
		try {
			fs.mkdirSync(topoPath, { recursive: true, mode: 0o700 });
			base.created = true;
		} catch (err) {
			return { ...base, error: `cannot create ${TOPO_DIR}/: ${errMessage(err)}` };
		}
	}

	// ---- 2. key material: generate once, reuse forever, always 0600.
	try {
		if (!fs.existsSync(keyPath)) {
			// Write via a temp file so a crash can never leave half a key behind
			// (a truncated key would be worse than none: it fails to load).
			const tmp = `${keyPath}.tmp-${process.pid}`;
			// No trailing newline: the file is read back as a key, and a stray
			// byte would make the base64 non-canonical (phase25 asserts 44 chars).
			fs.writeFileSync(tmp, crypto.randomBytes(KEY_BYTES).toString("base64"), { mode: 0o600 });
			fs.renameSync(tmp, keyPath);
		}
		fs.chmodSync(keyPath, 0o600);
	} catch (err) {
		return { ...base, error: `cannot write ${KEY_FILE_NAME}: ${errMessage(err)}` };
	}

	// ---- 3. `.gitignore`: only touched when it already exists (the user's
	// phrase was "if there is one"), and only by appending one line.
	const gitignorePath = path.join(cwd, GITIGNORE_FILE);
	let text: string;
	try {
		text = fs.readFileSync(gitignorePath, "utf8");
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return base; // nothing to update — and nothing invented
		if (code === "EISDIR") return { ...base, error: `${GITIGNORE_FILE} is a directory` };
		return { ...base, gitignorePath, error: `cannot read ${GITIGNORE_FILE}: ${errMessage(err)}` };
	}
	base.gitignorePath = gitignorePath;

	if (text.split(/\r?\n/).some(isAcceptedEntry)) return base;

	const eol = detectEol(text);
	const prefix = text.length === 0 || text.endsWith("\n") ? "" : eol;
	try {
		fs.appendFileSync(gitignorePath, `${prefix}${GITIGNORE_ENTRY}${eol}`, { mode: 0o644 });
		base.gitignoreUpdated = true;
	} catch (err) {
		return { ...base, error: `cannot update ${GITIGNORE_FILE}: ${errMessage(err)}` };
	}
	return base;
}

function errMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
