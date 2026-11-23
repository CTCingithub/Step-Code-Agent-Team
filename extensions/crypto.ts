/**
 * At-rest encryption for the team registry (AES-256-GCM).
 *
 * The registry is the only plugin-owned file that carries member output —
 * `tasks[].result` holds full reports, which routinely quote source code and
 * whatever the members read. Encrypting it keeps that off the disk in the
 * clear for other users, accidental commits and stray backups.
 *
 * Honest scope (do not oversell this in docs):
 * - it protects against OTHER USERS reading the file, and against the file
 *   being committed or backed up in the clear;
 * - it does NOT protect against a same-uid attacker, who can read the key
 *   file next to the ciphertext;
 * - it does NOT cover the session JSONL, which the host writes (0644) and the
 *   plugin cannot touch — that remains the largest real exposure.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Envelope version, so a future format change can be told apart. */
const ENVELOPE_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EncryptedEnvelope {
	schemaVersion: 1;
	teamId: string;
	/** The team's workspace, in the clear: it is not sensitive, and the reader
	 * needs it to locate `.topo/team.key` (which lives beside the workspace). */
	cwd: string;
	encrypted: typeof ENVELOPE_VERSION;
	iv: string;
	tag: string;
	data: string;
}

/** Type guard for the envelope, so `loadRegistry` can branch without try/catch. */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		v.encrypted === ENVELOPE_VERSION &&
		typeof v.cwd === "string" &&
		typeof v.iv === "string" &&
		typeof v.tag === "string" &&
		typeof v.data === "string" &&
		typeof v.teamId === "string"
	);
}

/**
 * Reads the key file `.topo/team.key` (32 random bytes, base64). Returns null
 * when it is missing or unusable — callers degrade to plaintext rather than
 * failing, because a team that cannot encrypt must still be able to run.
 */
export function loadTeamKey(cwd: string): Buffer | null {
	try {
		const raw = fs.readFileSync(path.join(cwd, ".topo", "team.key"), "utf8").trim();
		const key = Buffer.from(raw, "base64");
		if (key.length !== KEY_BYTES) return null;
		// Canonical round-trip: a hand-edited key must not silently become a
		// different (weaker) key.
		if (key.toString("base64") !== raw) return null;
		return key;
	} catch {
		return null;
	}
}

/** Encrypts a JSON-serializable payload into the versioned envelope. */
export function encryptJson(payload: unknown, teamId: string, cwd: string, key: Buffer): string {
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
	const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
	const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const envelope: EncryptedEnvelope = {
		schemaVersion: 1,
		teamId,
		cwd,
		encrypted: ENVELOPE_VERSION,
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		data: data.toString("base64"),
	};
	return JSON.stringify(envelope, null, 2);
}

/** Decrypts an envelope back into the payload. Throws on tamper or wrong key. */
export function decryptJson(text: string, key: Buffer): unknown {
	const envelope = JSON.parse(text) as EncryptedEnvelope;
	if (!isEncryptedEnvelope(envelope)) throw new Error("not an encrypted envelope");
	const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"));
	decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
	const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]);
	return JSON.parse(plaintext.toString("utf8"));
}
