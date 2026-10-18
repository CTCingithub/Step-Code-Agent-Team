/**
 * Plugin configuration.
 *
 * Following Step Code's settings convention, our configuration lives in the
 * "stepcodeAgentTeam" section of settings.json: globally at
 * <agentDir>/settings.json (agentDir honors STEP_CODING_AGENT_DIR, so the
 * development sandbox gets its own config) and, gated on project trust, at
 * <projectDir>/.stepcode/settings.json. Precedence:
 *
 *   defaults  <  legacy files  <  settings.json sections  <  env overrides
 *
 * Legacy dedicated files (<agentDir>/stepcode-agent-team.json and
 * <projectDir>/.stepcode/stepcode-agent-team.json) remain honored as a
 * compatibility layer, applied before the settings section at each tier
 * (debug mode logs a migration hint).
 *
 * The project-level section is gated on project trust, which is only knowable
 * inside event handlers — so loadConfig accepts it as an option, and
 * applyProjectConfig re-applies it in place on the cached config from
 * session_start (see index.ts).
 *
 * Unknown keys are ignored (logged in debug mode); invalid values fall back to
 * the default with a warning.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VALID_TOPOLOGY_SHAPES, type TopologyShape } from "./topology.ts";

export const CONFIG_FILE_NAME = "stepcode-agent-team.json";
/** Settings file name (Step Code convention); our config is a section of it. */
export const SETTINGS_FILE_NAME = "settings.json";
/** Our configuration section inside settings.json. */
export const CONFIG_SECTION = "stepcodeAgentTeam";

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
	/**
	 * Maximum length of a member-to-member message chain (hops). A leader
	 * dispatch is length 0 and each member→member forward adds 1; a hop that
	 * would exceed the bound is rejected. 0 = unlimited.
	 */
	maxLoopCount: number;
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

/** Project-level override: trusted projects may carry their own config. */
export function projectConfigFilePath(projectDir: string): string {
	return path.join(projectDir, ".stepcode", CONFIG_FILE_NAME);
}

/** Global settings file (Step Code convention: <agentDir>/settings.json). */
export function settingsFilePath(agentDirPath: string): string {
	return path.join(agentDirPath, SETTINGS_FILE_NAME);
}

/** Project settings file (<projectDir>/.stepcode/settings.json). */
export function projectSettingsFilePath(projectDir: string): string {
	return path.join(projectDir, ".stepcode", SETTINGS_FILE_NAME);
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
		topology: { default: "star", requireDeclaration: false, maxLoopCount: 2 },
		debug: false,
	};
}

export interface LoadConfigOptions {
	agentDir: string;
	/** Project directory whose .stepcode/ config may override the agentDir one. */
	projectDir?: string | null;
	/** Whether the project is trusted (gates the projectDir override). */
	trusted?: boolean;
}

export function loadConfig(options: LoadConfigOptions): PluginConfig {
	const config = defaultConfig();
	applyGlobalTier(config, options.agentDir);
	applyProjectConfig(config, options.projectDir, options.trusted);
	applyEnvOverrides(config);
	logWarnings(validate(config));
	return config;
}

/**
 * Applies the project-level override (<projectDir>/.stepcode/settings.json
 * section) in place, gated on project trust, then re-applies env overrides so
 * precedence stays defaults < global < project < env. Returns true when a
 * project config was applied. Callable on the cached config from event
 * handlers, where cwd and project trust first become available (see index.ts).
 */
export function applyProjectConfig(config: PluginConfig, projectDir?: string | null, trusted?: boolean): boolean {
	if (!projectDir || !trusted) return false;
	let applied = false;
	const legacy = projectConfigFilePath(projectDir);
	if (fs.existsSync(legacy)) {
		applyFile(config, legacy);
		legacyNote(legacy);
		applied = true;
	}
	const section = readSection(projectSettingsFilePath(projectDir));
	if (section) {
		mergeSection(config as unknown as Record<string, unknown>, section);
		applied = true;
	}
	if (!applied) return false;
	applyEnvOverrides(config);
	logWarnings(validate(config));
	return true;
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
	} catch (err) {
		// Missing file is normal; a present-but-broken one is worth a trace.
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			configNote(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
		}
		return; // unreadable file: defaults stand
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
	mergeSection(config as unknown as Record<string, unknown>, raw as Record<string, unknown>);
}

/** Global tier: legacy dedicated file first, then the settings.json section. */
function applyGlobalTier(config: PluginConfig, agentDirPath: string): void {
	const legacy = configFilePath(agentDirPath);
	if (fs.existsSync(legacy)) {
		applyFile(config, legacy);
		legacyNote(legacy);
	}
	const section = readSection(settingsFilePath(agentDirPath));
	if (section) mergeSection(config as unknown as Record<string, unknown>, section);
}

/** Reads our section out of a settings.json file; null when absent/unusable. */
function readSection(file: string): Record<string, unknown> | null {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		// Missing file is normal; a present-but-broken one is worth a trace.
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			configNote(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
		}
		return null;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const section = (raw as Record<string, unknown>)[CONFIG_SECTION];
	if (typeof section !== "object" || section === null || Array.isArray(section)) return null;
	return section as Record<string, unknown>;
}

/** Debug hint when a legacy dedicated config file is honored. */
function legacyNote(file: string): void {
	configNote(`legacy file ${file} still honored; prefer the "${CONFIG_SECTION}" section in ${SETTINGS_FILE_NAME}`);
}

/** Debug-gated one-line config trace. */
function configNote(message: string): void {
	if (process.env.STEPCODE_TEAM_DEBUG !== "1" && process.env.STEPCODE_TEAM_DEBUG !== "true") return;
	console.error(`[stepcode-agent-team] config: ${message}`);
}

/** Recursive merge limited to keys present in the defaults (unknown keys ignored). */
function mergeSection(target: Record<string, unknown>, source: Record<string, unknown>): void {
	for (const key of Object.keys(source)) {
		// Own-key check: `key in target` is also true for inherited
		// Object.prototype keys ("constructor", "toString", …).
		if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
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
	const maxDepth = process.env.STEPCODE_TEAM_MAXDEPTH;
	if (maxDepth !== undefined && maxDepth.trim() !== "") {
		const parsed = Number.parseInt(maxDepth, 10);
		if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) config.members.maxRecursionDepth = parsed;
	}
}

function logWarnings(warnings: string[]): void {
	if (process.env.STEPCODE_TEAM_DEBUG !== "1" && process.env.STEPCODE_TEAM_DEBUG !== "true") return;
	for (const warning of warnings) console.error(`[stepcode-agent-team] config: ${warning}`);
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
	expectIntRange(asRecord(config.topology), "maxLoopCount", d.topology.maxLoopCount, 0, 64, warnings);
	expectBoolean(asRecord(config), "debug", d.debug, warnings);

	return warnings;
}
