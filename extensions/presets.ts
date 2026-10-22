/**
 * Agent role presets.
 *
 * Presets live in the package's `agents/` directory as Markdown files with
 * frontmatter, mirroring the official subagent example format:
 *
 *   ---
 *   name: reviewer
 *   description: Reviews code for correctness and security
 *   tools: read, grep, find, ls
 *   model: step-5-preview
 *   ---
 *   <system prompt body>
 *
 * The directory is resolved relative to this module (jiti loads extensions
 * from arbitrary locations, so process.cwd() is not reliable).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { VALID_EFFORT, agentDir, type EffortLevel } from "./config.ts";

export interface AgentPreset {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	/** Default effort level for the role (invalid values are ignored). */
	effort?: EffortLevel;
	systemPrompt: string;
}

/** Absolute path of the directory containing this extension's modules. */
export function extensionDir(): string {
	try {
		// ESM (jiti default for .ts entry points). fileURLToPath (not
		// URL.pathname) so paths with spaces or non-ASCII survive.
		return path.dirname(fileURLToPath(import.meta.url));
	} catch {
		// CJS fallback
		return eval("__dirname") as string;
	}
}

/** Package root (the directory containing extensions/, bin/, agents/). */
export function packageRoot(): string {
	return path.resolve(extensionDir(), "..");
}

export function presetsDir(): string {
	return path.join(packageRoot(), "agents");
}

export function shimPath(): string {
	return path.join(packageRoot(), "bin", "stepcode-team.mjs");
}

/** Absolute path to the extension entry (loaded into sub-leader members via -e). */
export function extensionEntryPath(): string {
	return path.join(extensionDir(), "index.ts");
}

/** Absolute path to the member-side messaging extension (topo_team_msg tool, via -e). */
export function memberMessagingEntryPath(): string {
	return path.join(extensionDir(), "member-messaging.ts");
}

interface Frontmatter {
	[key: string]: string;
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { frontmatter: {}, body: content.trim() };
	const frontmatter: Frontmatter = {};
	for (const line of match[1].split(/\r?\n/)) {
		const idx = line.indexOf(":");
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim();
		const value = line.slice(idx + 1).trim();
		if (key && value) frontmatter[key] = value;
	}
	return { frontmatter, body: match[2].trim() };
}

function parseToolList(value: string | undefined): string[] | undefined {
	if (!value) return undefined;
	const tools = value
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.split(",")
		.map((t) => t.trim().replace(/^["']|["']$/g, ""))
		.filter(Boolean);
	return tools.length > 0 ? tools : undefined;
}

function parseEffort(value: string | undefined): EffortLevel | undefined {
	if (!value) return undefined;
	const v = value.trim().toLowerCase();
	return (VALID_EFFORT as readonly string[]).includes(v) ? (v as EffortLevel) : undefined;
}

/**
 * Preset directories, lowest → highest precedence: bundled agents/ (shipped
 * with the package) < user <agentDir>/agents/ < project
 * <projectDir>/.stepcode/agents/. Later tiers override earlier ones by role
 * name, so users can shadow a bundled preset or add custom roles that behave
 * exactly like built-in ones (same frontmatter format).
 */
function presetDirs(projectDir?: string | null, trusted?: boolean): string[] {
	const dirs = [presetsDir()];
	const userDir = path.join(agentDir(), "agents");
	if (!dirs.includes(userDir)) dirs.push(userDir);
	// Project-tier presets carry member spawn privileges (system prompts, tool
	// allowlists, models), so they load only for a TRUSTED project — an
	// untrusted repo must not be able to plant or shadow a role.
	if (projectDir && trusted) dirs.push(path.join(projectDir, ".stepcode", "agents"));
	return dirs;
}

const presetCaches = new Map<string, AgentPreset[]>();

/** Loads presets from every tier; later tiers win on role-name conflicts. */
export function loadPresets(projectDir?: string | null, trusted?: boolean): AgentPreset[] {
	// Trust is part of the cache key: an untrusted load (project tier skipped)
	// must not poison the cache for a later trusted load, or vice versa.
	const key = `${projectDir ?? ""}\u0000${trusted === true}`;
	const cached = presetCaches.get(key);
	if (cached) return cached;
	const byName = new Map<string, AgentPreset>();
	for (const dir of presetDirs(projectDir, trusted)) {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			continue; // a missing tier is normal
		}
		for (const entry of entries) {
			if (!entry.name.endsWith(".md")) continue;
			let content: string;
			try {
				content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
			} catch {
				continue;
			}
			const { frontmatter, body } = parseFrontmatter(content);
			if (!frontmatter.name || !frontmatter.description) continue;
			byName.set(frontmatter.name, {
				name: frontmatter.name,
				description: frontmatter.description,
				tools: parseToolList(frontmatter.tools),
				model: frontmatter.model,
				effort: parseEffort(frontmatter.effort),
				systemPrompt: body,
			});
		}
	}
	const presets = [...byName.values()];
	presetCaches.set(key, presets);
	return presets;
}

export function loadPreset(role: string, projectDir?: string | null, trusted?: boolean): AgentPreset | undefined {
	return loadPresets(projectDir, trusted).find((p) => p.name === role);
}
