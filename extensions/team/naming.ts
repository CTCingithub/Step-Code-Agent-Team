/**
 * Naming and identity rules for the team.
 *
 * Split out of members.ts so the rules that decide what a member may be called
 * and which team a session belongs to live in one place, away from the
 * lifecycle machinery that uses them.
 */

import * as path from "node:path";

/**
 * Member names become file names (`prompts/<name>.md`) and RPC identities, so
 * they are restricted to what is safe in both: lowercase ASCII, no path
 * separators, no `..`. A name that cannot traverse a path cannot escape the
 * prompts directory.
 */
export const MEMBER_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** Collapses anything unsafe in a session id into `_`, bounded to 48 chars. */
function sanitizeTeamId(sessionId: string): string {
	const cleaned = sessionId.replace(/[^\w.-]+/g, "_").slice(0, 48);
	return cleaned || `team-${Date.now().toString(36)}`;
}

/** Team id a session file maps to (null for ephemeral sessions without a file). */
export function teamIdForSession(sessionFile: string | null | undefined): string | null {
	if (!sessionFile) return null;
	const base = path.basename(sessionFile).replace(/\.jsonl$/, "");
	// Session files are named "<timestamp>_<sessionId>.jsonl"; strip the ts prefix.
	return sanitizeTeamId(base.replace(/^\d{4}-\d{2}-\d{2}T[\d+-]+Z_/, ""));
}
