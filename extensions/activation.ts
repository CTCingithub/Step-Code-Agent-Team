/**
 * Activation gate.
 *
 * The plugin is OFF by default: its tools are registered but declared
 * unavailable (pi.setUnavailableTools) so the model never sees them. It turns
 * on when the user invokes the /agent-team command or the prompt matches the
 * configured keywords, and stays on for the rest of the session.
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
	"team_disband",
	"team_status",
] as const;

/** Slash commands (without the leading slash) that activate the plugin. */
export const ACTIVATION_COMMANDS = ["agent-team"] as const;

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

/** True when the text explicitly mentions the plugin (case-insensitive). */
export function detectKeyword(text: string): boolean {
	if (!config || config.activation.keywords.length === 0) return false;
	const lower = text.toLowerCase();
	return config.activation.keywords.some((keyword) => {
		const k = keyword.trim().toLowerCase();
		return k.length > 0 && lower.includes(k);
	});
}

/** True when the text invokes one of the plugin's slash commands. */
export function detectSlashCommand(text: string): boolean {
	const trimmed = text.trimStart();
	if (!trimmed.startsWith("/")) return false;
	const name = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? "";
	return (ACTIVATION_COMMANDS as readonly string[]).includes(name);
}
