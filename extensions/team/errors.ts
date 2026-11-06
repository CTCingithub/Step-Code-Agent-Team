/**
 * Error classification for the dispatch path.
 *
 * Split out of members.ts because the retry policy is a safety property, not a
 * lifecycle detail: retrying work that may already have run duplicates the
 * member's billable turn. Keeping the classifiers next to each other makes the
 * policy reviewable in one screen.
 */

import type { MemberRecord } from "../registry.ts";

/**
 * Retryable spawn-path failures: only errors proving the work never started
 * (spawn / handshake). A settle timeout or mid-run exit may mean the work is
 * done — retrying duplicates it. Shared by the task dispatch retry and
 * createMember's ensureLive retry so both stay isomorphic.
 */
export function isRetryableSpawnError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	// Word boundaries matter: augmentDispatchError appends "will respawn with
	// its context resumed" to settle-timeout / mid-run-exit errors, and a bare
	// /spawn/ matches inside "respawn" — retrying exactly the failures whose
	// work may already be done (the duplicate-billing trap this policy exists
	// to prevent). Genuine spawn failures still match ("spawn step ENOENT").
	return /\baborted before start\b|\bhandshake\b|\bspawn\b|\bfailed to start\b/i.test(msg);
}

/**
 * Settle-timeout failures: the leader's wait for the member to settle expired.
 * Unlike spawn/handshake errors they say nothing about whether the work
 * started — the member may have finished (its usage is persisted server-side
 * either way) — so they are retried only when the usage delta proves nothing
 * ran (see dispatchWithSettleGuard).
 */
export function isSettleTimeoutError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	return /timeout waiting for member to settle/i.test(msg);
}

/**
 * Create params that a resume silently ignores (the existing record wins).
 * Empty when nothing conflicting was passed — used to tell the leader LLM
 * instead of letting it believe a reconfiguration happened.
 */
export function resumeIgnoredParams(params: Record<string, unknown>, member: MemberRecord): string[] {
	const ignored: string[] = [];
	const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
	if (asString(params.role) && params.role !== member.role) ignored.push("role");
	const tools = Array.isArray(params.tools) ? (params.tools as unknown[]).map(String) : undefined;
	if (tools && tools.length > 0 && tools.join(",") !== (member.tools ?? []).join(",")) ignored.push("tools");
	if (asString(params.model) && params.model !== member.model) ignored.push("model");
	if (asString(params.effort) && params.effort !== member.effort) ignored.push("effort");
	if (asString(params.systemPrompt)?.trim()) ignored.push("systemPrompt");
	return ignored;
}

/**
 * A leader-side dispatch that fails mid-run (timeout / member exit / abort)
 * can strand nested member-to-member relays that the team server is still
 * running — e.g. a ring tour whose chain outlives the dispatch timeout. The
 * dispatched member is killed (fail-fast), but its teammates may still be
 * working. Give the leader the recovery facts instead of a bare error: relays
 * may still be in flight (check team_status before re-dispatching — a
 * respawned member would duplicate the work) and who is alive right now.
 * Nested senders keep the terse error (it reaches them through the shim).
 */
export function augmentDispatchError(err: unknown, members: readonly MemberRecord[], nested: boolean): unknown {
	if (nested || !(err instanceof Error)) return err;
	if (!/timeout waiting for member to settle|exited during run|aborted by leader/.test(err.message)) return err;
	const roster = members.map((m) => `${m.name} ${m.status}`).join(" · ");
	const note = [
		err.message,
		"(team) this dispatch failed mid-run: nested member-to-member relays it triggered may still be running server-side — check team_status before re-dispatching (the dispatched member was killed fail-fast and will respawn with its context resumed).",
		roster ? `(team) members now: ${roster}` : "",
	]
		.filter(Boolean)
		.join("\n");
	return new Error(note, { cause: err });
}

/** Depth of this process in the team tree (the leader session is 0). */
export function currentDepth(): number {
	const raw = process.env.STEPCODE_TEAM_DEPTH;
	const parsed = raw === undefined ? 0 : Number.parseInt(raw, 10);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Walks the wait-for graph; true when `to` (transitively) waits on `from`. */
export function wouldCycle(waitingOn: Map<string, string>, from: string, to: string): boolean {
	let cur: string | undefined = to;
	const seen = new Set<string>();
	while (cur && !seen.has(cur)) {
		if (cur === from) return true;
		seen.add(cur);
		cur = waitingOn.get(cur);
	}
	return false;
}
