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

export interface AgentPreset {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
}

/** Absolute path of the directory containing this extension's modules. */
export function extensionDir(): string {
	try {
		// ESM (jiti default for .ts entry points)
		return path.dirname(new URL(import.meta.url).pathname);
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

let cache: AgentPreset[] | null = null;

export function loadPresets(): AgentPreset[] {
	if (cache) return cache;
	const dir = presetsDir();
	const presets: AgentPreset[] = [];
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		cache = [];
		return cache;
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
		presets.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: parseToolList(frontmatter.tools),
			model: frontmatter.model,
			systemPrompt: body,
		});
	}
	cache = presets;
	return presets;
}

export function loadPreset(role: string): AgentPreset | undefined {
	return loadPresets().find((p) => p.name === role);
}
