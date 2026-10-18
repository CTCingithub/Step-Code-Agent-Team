/**
 * Plugin configuration.
 *
 * Loaded once per process from <agentDir>/stepcode-agent-team.json (agentDir
 * honors STEP_CODING_AGENT_DIR, so the development sandbox gets its own
 * config), merged over built-in defaults, with env-var overrides on top:
 *
 *   defaults  <  config file  <  STEPCODE_TEAM_DEBUG / STEPCODE_TEAM_COST_WARN
 *
 * Unknown keys are ignored (logged in debug mode); invalid values fall back to
 * the default with a warning. A project-level override
 * (<cwd>/.stepcode/stepcode-agent-team.json) is reserved in the loader
 * signature but not wired yet — trust information is only available inside
 * event handlers, which would break the "config before tool registration"
 * ordering.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VALID_TOPOLOGY_SHAPES, type TopologyShape } from "./topology.ts";

export const CONFIG_FILE_NAME = "stepcode-agent-team.json";

/** Thinking levels accepted by `step --thinking`. */
export const VALID_THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevel = (typeof VALID_THINKING)[number];

/** Member thinking level when the caller does not specify one. */
export const DEFAULT_MEMBER_THINKING: ThinkingLevel = "high";

export interface ActivationConfig {
	enabled: boolean;
	keywords: string[];
	notifyOnActivate: boolean;
}

export interface ModelsConfig {
	available: string[];
	autonomousSelection: boolean;
	autonomousThinking: boolean;
}

export interface MembersConfig {
	max: number;
	defaultRole: string;
	defaultTools: string[] | null;
	/**
	 * Maximum team-tree depth (leader = 0, its members = 1). At the default of
	 * 1, members cannot spawn sub-teams. Deeper values grant members their own
	 * sub-team by loading this extension in the member process.
	 */
	maxRecursionDepth: number;
}

export interface DispatchConfig {
	maxConcurrent: number;
	timeoutMs: number;
	handshakeTimeoutMs: number;
	retries: number;
}

export interface OneshotConfig {
	timeoutMs: number;
}

export interface CostConfig {
	warnThreshold: number;
}

export interface IdleConfig {
	reapAfterMs: number;
	reapIntervalMs: number;
}

export interface StorageConfig {
	dir: string | null;
}

export interface TopologyConfig {
	/** Shape applied to new teams before the leader declares one. */
	default: TopologyShape;
	/** When true, work cannot be dispatched until the topology is declared. */
	requireDeclaration: boolean;
}

export interface PluginConfig {
	activation: ActivationConfig;
	models: ModelsConfig;
	members: MembersConfig;
	dispatch: DispatchConfig;
	oneshot: OneshotConfig;
	cost: CostConfig;
	idle: IdleConfig;
	storage: StorageConfig;
	topology: TopologyConfig;
	debug: boolean;
}

/** Agent dir resolution mirrors docs/environment-variables.md; no hardcoded ~/.stepcode. */
export function agentDir(): string {
	return process.env.STEP_CODING_AGENT_DIR || path.join(os.homedir(), ".stepcode", "agent");
}

export function configFilePath(agentDirPath: string): string {
	return path.join(agentDirPath, CONFIG_FILE_NAME);
}

export function defaultConfig(): PluginConfig {
	return {
		activation: {
			enabled: true,
			keywords: [
				"agent team",
				"agent teams",
				"team of agents",
				"multi-agent team",
				"team plugin",
				"stepcode-agent-team",
				"step code agent team",
				"team_create_member",
				"team_send",
				"team_task",
				"智能体团队",
				"团队插件",
				"多智能体",
				"多智能体协作",
				"组队",
			],
			notifyOnActivate: true,
		},
		models: {
			available: ["step-5-preview"],
			autonomousSelection: false,
			autonomousThinking: false,
		},
		members: { max: 8, defaultRole: "worker", defaultTools: null, maxRecursionDepth: 1 },
		dispatch: { maxConcurrent: 5, timeoutMs: 180_000, handshakeTimeoutMs: 15_000, retries: 1 },
		oneshot: { timeoutMs: 180_000 },
		cost: { warnThreshold: 1 },
		idle: { reapAfterMs: 30 * 60 * 1000, reapIntervalMs: 5 * 60 * 1000 },
		storage: { dir: null },
		topology: { default: "star", requireDeclaration: false },
		debug: false,
	};
}

export interface LoadConfigOptions {
	agentDir: string;
	/** Reserved: project-level config file location (not wired yet). */
	projectDir?: string | null;
	/** Reserved: whether the project is trusted (gates projectDir). */
	trusted?: boolean;
}

export function loadConfig(options: LoadConfigOptions): PluginConfig {
	const config = defaultConfig();
	applyFile(config, configFilePath(options.agentDir));
	// Reserved: project-level override would be applied here, gated on options.trusted.
	applyEnvOverrides(config);
	const warnings = validate(config);
	for (const warning of warnings) {
		if (process.env.STEPCODE_TEAM_DEBUG === "1" || process.env.STEPCODE_TEAM_DEBUG === "true") {
			console.error(`[stepcode-agent-team] config: ${warning}`);
		}
	}
	return config;
}

let cached: PluginConfig | null = null;

/** Process-wide config, loaded once on first use. */
export function getConfig(): PluginConfig {
	if (!cached) cached = loadConfig({ agentDir: agentDir() });
	return cached;
}

/** Test hook: drop the process-wide cache. */
export function resetConfigCache(): void {
	cached = null;
}

// ------------------------------------------------------------------ internals

function applyFile(config: PluginConfig, file: string): void {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return; // missing or unreadable file: defaults stand
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
	mergeSection(config as unknown as Record<string, unknown>, raw as Record<string, unknown>);
}

/** Recursive merge limited to keys present in the defaults (unknown keys ignored). */
function mergeSection(target: Record<string, unknown>, source: Record<string, unknown>): void {
	for (const key of Object.keys(source)) {
		if (!(key in target)) continue;
		const value = source[key];
		const current = target[key];
		if (
			typeof current === "object" &&
			current !== null &&
			!Array.isArray(current) &&
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			mergeSection(current as Record<string, unknown>, value as Record<string, unknown>);
		} else {
			target[key] = value; // type/shape checked in validate()
		}
	}
}

function applyEnvOverrides(config: PluginConfig): void {
	const debug = process.env.STEPCODE_TEAM_DEBUG;
	if (debug === "1" || debug === "true") config.debug = true;
	const cost = process.env.STEPCODE_TEAM_COST_WARN;
	if (cost !== undefined && cost.trim() !== "") {
		const parsed = Number.parseFloat(cost);
		if (Number.isFinite(parsed) && parsed >= 0) config.cost.warnThreshold = parsed;
	}
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function expectBoolean(obj: Record<string, unknown>, key: string, fallback: boolean, warnings: string[]): void {
	if (typeof obj[key] !== "boolean") {
		obj[key] = fallback;
		warnings.push(key);
	}
}

function expectIntRange(
	obj: Record<string, unknown>,
	key: string,
	fallback: number,
	min: number,
	max: number,
	warnings: string[],
): void {
	const value = obj[key];
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		obj[key] = fallback;
		warnings.push(key);
	}
}

function expectNumberRange(
	obj: Record<string, unknown>,
	key: string,
	fallback: number,
	min: number,
	max: number,
	warnings: string[],
): void {
	const value = obj[key];
	if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
		obj[key] = fallback;
		warnings.push(key);
	}
}

/** Clamps invalid values to defaults in place; returns the list of fixed keys. */
function validate(config: PluginConfig): string[] {
	const warnings: string[] = [];
	const d = defaultConfig();
	const asRecord = (v: object): Record<string, unknown> => v as unknown as Record<string, unknown>;

	expectBoolean(asRecord(config.activation), "enabled", d.activation.enabled, warnings);
	expectBoolean(asRecord(config.activation), "notifyOnActivate", d.activation.notifyOnActivate, warnings);
	if (!isStringArray(config.activation.keywords)) {
		config.activation.keywords = d.activation.keywords;
		warnings.push("activation.keywords");
	}

	if (!isStringArray(config.models.available)) {
		config.models.available = d.models.available;
		warnings.push("models.available");
	} else {
		config.models.available = config.models.available.map((m) => m.trim()).filter(Boolean);
		if (config.models.available.length === 0) {
			config.models.available = d.models.available;
			warnings.push("models.available");
		}
	}
	expectBoolean(asRecord(config.models), "autonomousSelection", d.models.autonomousSelection, warnings);
	expectBoolean(asRecord(config.models), "autonomousThinking", d.models.autonomousThinking, warnings);

	expectIntRange(asRecord(config.members), "max", d.members.max, 1, 64, warnings);
	expectIntRange(asRecord(config.members), "maxRecursionDepth", d.members.maxRecursionDepth, 1, 4, warnings);
	if (typeof config.members.defaultRole !== "string" || !config.members.defaultRole.trim()) {
		config.members.defaultRole = d.members.defaultRole;
		warnings.push("members.defaultRole");
	}
	if (config.members.defaultTools !== null && !isStringArray(config.members.defaultTools)) {
		config.members.defaultTools = d.members.defaultTools;
		warnings.push("members.defaultTools");
	}

	expectIntRange(asRecord(config.dispatch), "maxConcurrent", d.dispatch.maxConcurrent, 1, 16, warnings);
	expectIntRange(asRecord(config.dispatch), "timeoutMs", d.dispatch.timeoutMs, 1_000, 3_600_000, warnings);
	expectIntRange(asRecord(config.dispatch), "handshakeTimeoutMs", d.dispatch.handshakeTimeoutMs, 1_000, 120_000, warnings);
	expectIntRange(asRecord(config.dispatch), "retries", d.dispatch.retries, 0, 5, warnings);

	expectIntRange(asRecord(config.oneshot), "timeoutMs", d.oneshot.timeoutMs, 1_000, 3_600_000, warnings);
	expectNumberRange(asRecord(config.cost), "warnThreshold", d.cost.warnThreshold, 0, 100_000, warnings);
	expectIntRange(asRecord(config.idle), "reapAfterMs", d.idle.reapAfterMs, 10_000, 86_400_000, warnings);
	expectIntRange(asRecord(config.idle), "reapIntervalMs", d.idle.reapIntervalMs, 5_000, 3_600_000, warnings);

	if (config.storage.dir !== null && (typeof config.storage.dir !== "string" || !config.storage.dir.trim())) {
		config.storage.dir = d.storage.dir;
		warnings.push("storage.dir");
	}
	if (!VALID_TOPOLOGY_SHAPES.includes(config.topology.default as TopologyShape)) {
		config.topology.default = d.topology.default;
		warnings.push("topology.default");
	}
	expectBoolean(asRecord(config.topology), "requireDeclaration", d.topology.requireDeclaration, warnings);
	expectBoolean(asRecord(config), "debug", d.debug, warnings);

	return warnings;
}
