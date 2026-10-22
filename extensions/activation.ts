/**
 * Activation gate.
 *
 * The plugin is OFF by default: its tools are registered but declared
 * unavailable (pi.setUnavailableTools) so the model never sees them. It turns
 * on when the user invokes the /topo command or the prompt matches the
 * configured keywords, and stays on
 * for the rest of the session.
 *
 * Tool release happens through the `pi` handle captured at init (declarations
 * belong to the extension instance that made them), so activation triggered
 * from anywhere in the process clears this extension's declaration.
 */

import type { ExtensionAPI } from "@step-harness/coding-agent";
import type { PluginConfig } from "./config.ts";

/** Team tool names, gated until activation. */
export const TEAM_TOOL_NAMES = [
	"team_create_member",
	"team_send",
	"team_task",
	"team_set_topology",
	"team_disband",
	"team_status",
] as const;

/**
 * Slash command (without the leading slash) that activates the plugin.
 * "topo" deliberately avoids the bare "agent team"/"智能体团队" terms a
 * future official agent-teams feature would claim. The 0.2.0 revision
 * removed the /agent-team alias — a hard cut, no transition period.
 */
export const ACTIVATION_COMMANDS = ["topo"] as const;

let config: PluginConfig | null = null;
let pi: ExtensionAPI | null = null;
let onActivated: ((reason: string) => void) | null = null;
let active = false;

export function initActivation(cfg: PluginConfig, api: ExtensionAPI, onActivatedCallback?: (reason: string) => void): void {
	config = cfg;
	pi = api;
	onActivated = onActivatedCallback ?? null;
	active = false;
}

export function isActive(): boolean {
	return active;
}

/**
 * Activates the plugin if the config allows it. Returns true only for the call
 * that performed the activation (side effects: team tools released, callback
 * invoked with the reason).
 */
export function activate(reason: string): boolean {
	if (active) return false;
	if (config && !config.activation.enabled) return false;
	active = true;
	releaseTools();
	onActivated?.(reason);
	return true;
}

export function deactivate(): void {
	active = false;
}

/** Releases the team tools declared unavailable at load. */
function releaseTools(): void {
	if (!pi) return;
	// Clear this extension's unavailability declaration...
	pi.setUnavailableTools([]);
	// ...and make sure the tools are in the active selection (belt and braces:
	// a restriction release only restores tools that were selected).
	const current = pi.getActiveTools();
	const missing = TEAM_TOOL_NAMES.filter((name) => !current.includes(name));
	if (missing.length > 0) {
		pi.setActiveTools([...new Set([...current, ...missing])]);
	}
}

/** Re-hides the team tools after a deactivate (used by /topo off). */
export function regateTools(): void {
	if (!pi) return;
	pi.setUnavailableTools([...TEAM_TOOL_NAMES]);
}

/**
 * Idempotent re-assert that the team tools are available while the plugin is
 * active. Self-heal for host-side resets (tool-selection changes, extension
 * re-initialization) that can hide the tools from under an active plugin —
 * without it the model sees "tool not found" with no way back except /topo.
 */
export function ensureToolsAvailable(): void {
	if (!active) return;
	releaseTools();
}

// --- L1 false-positive guard (0.2.0) --------------------------------------
// A keyword hit that reads as negation, meta-discussion, or a code reference
// is not a team request. Pure string heuristics — no model calls — applied
// only while activation.guardEnabled is on (default). L2 (TUI confirm) and
// L3 (headless policy) live in index.ts.

const NEGATION_RE = /(不要|不用|无需|没必要|先不|暂时不|禁止|别用|别提|别去|don'?t|do not|without|no need)/i;
const META_RE = /(什么是|是什么|如何|怎么|怎样|文档|readme|提到|what is|how to)|\bdocs?\b/i;
const CODEISH_RE = /(`|import |require\(|=>)/;
/** Clause boundaries: a negation before one of these does not reach the keyword. */
const CLAUSE_BOUNDARY_RE = /[\n,;:.!?。，；：！？…]/;

/** Index of the keyword in `lower`, or -1. ASCII keywords match on word boundaries. */
function keywordIndex(lower: string, keyword: string): number {
	if (/^[a-z0-9 _-]+$/.test(keyword)) {
		const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const m = new RegExp(`\\b${escaped}\\b`).exec(lower);
		return m ? m.index : -1;
	}
	return lower.indexOf(keyword);
}

/**
 * Heuristic veto for a keyword hit at `index`: negation or meta-discussion
 * shortly before it, a code-ish line (backticks / imports / calls), or the
 * keyword itself quoted as a literal — the mention is a reference, not a
 * request.
 */
export function keywordMentionSuppressed(text: string, index: number, keywordLength: number): boolean {
	// Negation may sit several words before the keyword ("don't use an agent
	// squad"): scan back to the previous clause boundary or 40 chars, whichever
	// is closer — a fixed 6-char window misses exactly the documented examples.
	let negationStart = Math.max(0, index - 40);
	for (let i = index - 1; i >= negationStart; i--) {
		if (CLAUSE_BOUNDARY_RE.test(text[i])) {
			negationStart = i + 1;
			break;
		}
	}
	if (NEGATION_RE.test(text.slice(negationStart, index))) return true;
	if (META_RE.test(text.slice(Math.max(0, index - 12), index))) return true;
	const lineStart = text.lastIndexOf("\n", index - 1) + 1;
	const lineEnd = text.indexOf("\n", index);
	if (CODEISH_RE.test(text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd))) return true;
	const around = `${text[index - 1] ?? ""}${text[index + keywordLength] ?? ""}`;
	if (/['"`]/.test(around)) return true;
	return false;
}

/** True when the text explicitly mentions the plugin (case-insensitive). */
export function detectKeyword(text: string): boolean {
	if (!config || config.activation.keywords.length === 0) return false;
	const lower = text.toLowerCase();
	const guard = config.activation.guardEnabled !== false;
	return config.activation.keywords.some((keyword) => {
		const k = keyword.trim().toLowerCase();
		if (k.length === 0) return false;
		const idx = keywordIndex(lower, k);
		if (idx < 0) return false;
		return !guard || !keywordMentionSuppressed(text, idx, k.length);
	});
}

/** True when the text invokes one of the plugin's slash commands. */
export function detectSlashCommand(text: string): boolean {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("/")) return false;
	const name = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
	return (ACTIVATION_COMMANDS as readonly string[]).includes(name);
}
