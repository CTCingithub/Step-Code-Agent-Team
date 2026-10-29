/**
 * Plugin configuration.
 *
 * Step Code first kept settings in settings.json and later moved them to the
 * unified config.toml (global beside the agent dir, project under
 * <projectDir>/.stepcode/, agent/settings.json retired). Both locations are
 * honored; the unified config is the current convention and overrides the
 * legacy settings.json section. Precedence:
 *
 *   defaults < legacy files < settings.json < config.toml < env overrides
 *
 * (per tier: config.toml overrides settings.json; the project tier overrides
 * the global tier; env overrides win over everything.)
 *
 * Legacy dedicated files (<agentDir>/stepcode-agent-team.json and
 * <projectDir>/.stepcode/stepcode-agent-team.json) remain honored as a
 * compatibility layer, applied before the settings section at each tier
 * (debug mode logs a migration hint).
 *
 * The unified config is read through @step-harness/coding-agent's exported
 * readers (readStepConfig / CONFIG_DIR_NAME / STEP_CONFIG_FILE_NAME), looked
 * up defensively: step versions without those exports simply skip that tier.
 *
 * The project-level tiers are gated on project trust, which is only knowable
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
import * as stepCore from "@step-harness/coding-agent";
import { VALID_TOPOLOGY_SHAPES, type TopologyShape } from "./topology.ts";
import { DEFAULT_TIER_MODE, PLAN_TIER_MODES } from "./plan.ts";

/**
 * Official step-config symbols this plugin consumes from
 * `@step-harness/coding-agent` (its `step/config-toml.ts` exports). All
 * optional: an older step that predates them still works through the
 * fallbacks at each use site — a hard import would fail to link there.
 * Typing the shape here turns our own typos into compile errors.
 */
interface StepCoreConfigExports {
	CONFIG_DIR_NAME?: string;
	STEP_CONFIG_FILE_NAME?: string;
	ensureStepConfigFile?: (path: string) => string;
	readStepConfig?: (path: string) => unknown;
}

const stepConfigExports = stepCore as Partial<StepCoreConfigExports>;

export const CONFIG_FILE_NAME = "stepcode-agent-team.json";
/** Legacy settings file name (Step Code's pre-config.toml convention). */
export const SETTINGS_FILE_NAME = "settings.json";
/** Our configuration section inside settings.json. */
export const CONFIG_SECTION = "stepcodeAgentTeam";

/** Effort levels accepted by `step --thinking`. */
export const VALID_EFFORT = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof VALID_EFFORT)[number];

/**
 * Keywords retired in 0.2.0. They named the plugin in generic "agent team"
 * terms that a future official agent-teams feature would claim; keeping them
 * would let this plugin shadow the official feature. Stripped from the
 * effective keyword list on load (the user's config file is not rewritten).
 */
export const DEPRECATED_KEYWORDS = [
	"agent team",
	"agent teams",
	"team of agents",
	"multi-agent team",
	"team plugin",
	"智能体团队",
	"团队插件",
	"多智能体",
	"多智能体协作",
	"组队",
] as const;

/** Deprecated keywords stripped by the most recent load (consumed on read). */
let lastKeywordMigration: string[] = [];

/** Returns — and clears — the deprecated keywords removed by the last load. */
export function consumeKeywordMigration(): string[] {
	const out = lastKeywordMigration;
	lastKeywordMigration = [];
	return out;
}

/** Member effort level when the caller does not specify one. */
export const DEFAULT_EFFORT: EffortLevel = "high";

export interface ActivationConfig {
	enabled: boolean;
	keywords: string[];
	notifyOnActivate: boolean;
	/**
	 * L1 false-positive guard: a keyword hit that reads as negation,
	 * meta-discussion, or a code reference is not a team request. Pure
	 * string heuristics — no model calls.
	 */
	guardEnabled: boolean;
	/**
	 * L2: in the interactive TUI, confirm before activating on a keyword
	 * hit. Ignored in headless/RPC modes (nobody can answer the dialog).
	 */
	confirmBeforeActivate: boolean;
	/**
	 * L3: headless/RPC keyword hits activate without a dialog — scripted
	 * runs have nobody to answer, and auto-declining would break them.
	 */
	headlessAutoActivate: boolean;
}

/** Team-plan picker (default off): choose a team strategy on activation. */
export interface PlanConfig {
	/** Master switch; false keeps the pre-0.2.0 behavior (model self-organizes). */
	enabled: boolean;
	/**
	 * Standing tier choice: "always ask" (default) shows the picker on every
	 * /topo activation; a pinned tier (economic/fast/balanced/performance)
	 * applies directly without asking — on the command path and on keyword
	 * activations alike.
	 */
	tier: string;
}

/** Per-role effort overrides (keys are role names; built-in roles shown as defaults). */
export interface PresetsConfig {
	effort: Record<string, string>;
}

export interface ModelsConfig {
	available: string[];
	autonomousSelection: boolean;
	autonomousEffort: boolean;
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

export interface TasksConfig {
	/** Task-board capacity: ids are allocated in the T1..T<max> sequence. */
	max: number;
	/**
	 * Per-task output truncation threshold (bytes). The model-visible text is
	 * truncated to this size; the full text stays in the tool result details.
	 */
	outputCapBytes: number;
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
	tasks: TasksConfig;
	topology: TopologyConfig;
	plan: PlanConfig;
	presets: PresetsConfig;
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

/** Global settings file (<agentDir>/settings.json, legacy location). */
export function settingsFilePath(agentDirPath: string): string {
	return path.join(agentDirPath, SETTINGS_FILE_NAME);
}

/** Project settings file (<projectDir>/.stepcode/settings.json, legacy location). */
export function projectSettingsFilePath(projectDir: string): string {
	return path.join(projectDir, ".stepcode", SETTINGS_FILE_NAME);
}

/**
 * Global unified step config (<configRoot>/config.toml). The config root sits
 * beside the agent dir — the same place step's own settings manager resolves
 * it (settings-manager.ts: join(dirname(agentDir), "config.toml")).
 */
export function unifiedConfigFilePath(agentDirPath: string): string {
	return path.join(path.dirname(path.resolve(agentDirPath)), unifiedConfigFileName());
}

/** Project-level unified config (<projectDir>/.stepcode/config.toml). */
export function projectUnifiedConfigFilePath(projectDir: string): string {
	const dirName = stepConfigExports.CONFIG_DIR_NAME;
	return path.join(projectDir, typeof dirName === "string" && dirName ? dirName : ".stepcode", unifiedConfigFileName());
}

function unifiedConfigFileName(): string {
	const name = stepConfigExports.STEP_CONFIG_FILE_NAME;
	return typeof name === "string" && name ? name : "config.toml";
}

/**
 * Seeds the global unified config with a commented defaults block on first
 * activation, so a fresh install has discoverable configuration. Additive
 * only: the existing file is preserved verbatim (appended to, never
 * rewritten — a rewrite through step's own writer would drop the user's
 * comments), the block is entirely comments so defaults keep applying, and
 * the write is idempotent (skipped once the section name appears). Returns
 * true when the block was appended.
 */
export function seedGlobalConfigExample(agentDirPath: string): boolean {
	const file = unifiedConfigFilePath(agentDirPath);
	try {
		if (fs.existsSync(file)) {
			if (fs.readFileSync(file, "utf8").includes(CONFIG_SECTION)) return false;
			fs.appendFileSync(file, seedBlock(), { encoding: "utf8", mode: 0o600 });
			return true;
		}
		// No config file yet: create it with step's own header, then seed.
		const ensure = stepConfigExports.ensureStepConfigFile;
		if (typeof ensure !== "function") return false;
		ensure(file);
		fs.appendFileSync(file, seedBlock(), { encoding: "utf8", mode: 0o600 });
		return true;
	} catch (err) {
		configNote(`cannot seed ${file}: ${err instanceof Error ? err.message : String(err)}`);
		return false;
	}
}

function seedBlock(): string {
	const d = defaultConfig();
	const kw = d.activation.keywords.map((k) => `"${k}"`).join(", ");
	const models = d.models.available.map((m) => `"${m}"`).join(", ");
	const line = (kv: string, comment: string): string => `# ${kv.padEnd(36)}# ${comment}`;
	return [
		"",
		"# ---- stepcode-agent-team configuration (uncomment to override) ----",
		"# Full reference: docs/CONFIGURATION.md · delete this block to restore defaults",
		"# Every key is optional; an omitted key keeps its built-in default. Values",
		"# shown are the defaults; null-defaulted keys (members.defaultTools,",
		"# storage.dir) show an example — omit them for null.",
		"#",
		"# [stepcodeAgentTeam.activation]",
		line(`enabled = ${d.activation.enabled}`, "master switch; false disables both triggers"),
		line(`keywords = [${kw}]`, "the full default list; [] disables keyword activation"),
		line(`notifyOnActivate = ${d.activation.notifyOnActivate}`, "notify on activation"),
		line(`guardEnabled = ${d.activation.guardEnabled}`, "suppress negation / meta-discussion / code-reference keyword hits"),
		line(`confirmBeforeActivate = ${d.activation.confirmBeforeActivate}`, "TUI: confirm before a keyword activation (headless ignores it)"),
		line(`headlessAutoActivate = ${d.activation.headlessAutoActivate}`, "headless/RPC: activate on keyword hits without a dialog"),
		"#",
		"# [stepcodeAgentTeam.models]",
		line(`available = [${models}]`, "member model pool"),
		line(`autonomousSelection = ${d.models.autonomousSelection}`, "the leader picks a model per member"),
		line(`autonomousEffort = ${d.models.autonomousEffort}`, "the leader picks the effort per member"),
		"#",
		"# [stepcodeAgentTeam.members]",
		line(`max = ${d.members.max}`, "live-member cap (1-64)"),
		line(`defaultRole = "${d.members.defaultRole}"`, "default role for new members"),
		line('defaultTools = ["read", "bash"]', "member tool allowlist; omit for null (preset or all tools)"),
		line(`maxRecursionDepth = ${d.members.maxRecursionDepth}`, "team-tree depth bound (1-4)"),
		"#",
		"# [stepcodeAgentTeam.dispatch]",
		line(`maxConcurrent = ${d.dispatch.maxConcurrent}`, "parallel member cap (1-16); extra dispatches queue"),
		line(`timeoutMs = ${d.dispatch.timeoutMs}`, "per-dispatch timeout (ms) — covers the member's whole turn, nested relays included"),
		line(`handshakeTimeoutMs = ${d.dispatch.handshakeTimeoutMs}`, "member spawn handshake timeout (ms)"),
		line(`retries = ${d.dispatch.retries}`, "task retry count (0-5)"),
		"#",
		"# [stepcodeAgentTeam.oneshot]",
		line(`timeoutMs = ${d.oneshot.timeoutMs}`, "stateless oneshot dispatch timeout (ms)"),
		"#",
		"# [stepcodeAgentTeam.cost]",
		line(`warnThreshold = ${d.cost.warnThreshold}`, "cumulative spend warning (USD); 0 = off"),
		"#",
		"# [stepcodeAgentTeam.idle]",
		line(`reapAfterMs = ${d.idle.reapAfterMs}`, "idle reaping threshold (ms; 30 min)"),
		line(`reapIntervalMs = ${d.idle.reapIntervalMs}`, "reaping check interval (ms; 5 min)"),
		"#",
		"# [stepcodeAgentTeam.storage]",
		line('dir = "/path/to/teams"', "team data root; omit for null (<agentDir>/teams)"),
		"#",
		"# [stepcodeAgentTeam.tasks]",
		line(`max = ${d.tasks.max}`, "task-board capacity (ids T1..T<max>; 1-10000)"),
		line(`outputCapBytes = ${d.tasks.outputCapBytes}`, "per-task output truncation (bytes); the full text stays in details.fullText"),
		"#",
		"# [stepcodeAgentTeam.topology]",
		line(`default = "${d.topology.default}"`, "star/pipeline/mesh/ring/custom"),
		line(`requireDeclaration = ${d.topology.requireDeclaration}`, "true = no dispatch before the topology is declared"),
		line(`maxLoopCount = ${d.topology.maxLoopCount}`, "ring message-chain bound (0 = unlimited, 0-64)"),
		"#",
		"# [stepcodeAgentTeam.plan]",
		line(`enabled = ${d.plan.enabled}`, "team-plan picker: economic/fast/balanced/performance + custom on activation"),
		line(`tier = "${d.plan.tier}"`, "always ask = picker every time; a pinned tier applies directly"),
		"#",
		"# [stepcodeAgentTeam.presets.effort]",
		'# scout = "low"       # per-role effort overrides (custom roles: set effort in their own frontmatter)',
		'# planner = "medium"  # ignored while models.autonomousEffort is on (the leader picks)',
		'# worker = "medium"',
		'# reviewer = "high"',
		"#",
		"# [stepcodeAgentTeam]",
		line(`debug = ${d.debug}`, "diagnostic logging to stderr"),
		"",
	].join("\n");
}

/**
 * Reads our section out of a unified config.toml; null when the file is
 * absent/unreadable, the section is missing or malformed, or the running step
 * version does not export the reader.
 */
function readUnifiedSection(file: string): Record<string, unknown> | null {
	const read = stepConfigExports.readStepConfig;
	if (typeof read !== "function") return null;
	let doc: unknown;
	try {
		doc = read(file);
	} catch (err) {
		// Missing file is normal; a present-but-broken one is worth a trace.
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
			configNote(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
		}
		return null;
	}
	if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
	const section = (doc as Record<string, unknown>)[CONFIG_SECTION];
	if (typeof section !== "object" || section === null || Array.isArray(section)) return null;
	// Trace the successful read too. A silent success is what made "I edited the
	// config and nothing changed" undebuggable: with only failure traces there
	// was no way to confirm WHICH file was read (the sandbox's
	// `sandbox/config.toml` is the right file, but a mid-session edit never
	// takes effect because config is read once at load — the 2026-10-30 manual
	// round concluded the opposite and wrote it into a permanent log).
	configNote(`read ${file} (${CONFIG_SECTION} table)`);
	return section as Record<string, unknown>;
}

export function defaultConfig(): PluginConfig {
	return {
		activation: {
			enabled: true,
			// Plugin-specific keywords only: bare "agent team"/"智能体团队" style
			// terms are deliberately excluded so a future official agent-teams
			// feature does not collide with this plugin's activation (0.2.0).
			keywords: [
				"智能体小队",
				"多智能体小队",
				"组小队",
				"stepcode 小队",
				"topo team",
				"topo-agent",
				"stepcode topo",
				"topology team",
				"agent squad",
				"stepcode-agent-team",
				"step code agent team",
				"team_create_member",
				"team_send",
				"team_task",
			],
			notifyOnActivate: true,
			guardEnabled: true,
			confirmBeforeActivate: true,
			headlessAutoActivate: true,
		},
		models: {
			available: ["step-5-preview"],
			autonomousSelection: false,
			autonomousEffort: false,
		},
		members: { max: 8, defaultRole: "worker", defaultTools: null, maxRecursionDepth: 1 },
		dispatch: { maxConcurrent: 5, timeoutMs: 600_000, handshakeTimeoutMs: 15_000, retries: 1 },
		oneshot: { timeoutMs: 600_000 },
		cost: { warnThreshold: 1 },
		idle: { reapAfterMs: 30 * 60 * 1000, reapIntervalMs: 5 * 60 * 1000 },
		storage: { dir: null },
		tasks: { max: 999, outputCapBytes: 50 * 1024 },
		topology: { default: "star", requireDeclaration: false, maxLoopCount: 2 },
		plan: { enabled: false, tier: DEFAULT_TIER_MODE },
		presets: { effort: { scout: "low", planner: "medium", worker: "medium", reviewer: "high" } },
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
	const unified = readUnifiedSection(projectUnifiedConfigFilePath(projectDir));
	if (unified) {
		mergeSection(config as unknown as Record<string, unknown>, unified);
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

/** Global tier: legacy dedicated file, then settings.json, then the unified config. */
function applyGlobalTier(config: PluginConfig, agentDirPath: string): void {
	const legacy = configFilePath(agentDirPath);
	if (fs.existsSync(legacy)) {
		applyFile(config, legacy);
		legacyNote(legacy);
	}
	const section = readSection(settingsFilePath(agentDirPath));
	if (section) mergeSection(config as unknown as Record<string, unknown>, section);
	const unified = readUnifiedSection(unifiedConfigFilePath(agentDirPath));
	if (unified) mergeSection(config as unknown as Record<string, unknown>, unified);
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
	configNote(`legacy file ${file} still honored; prefer the "${CONFIG_SECTION}" table in the unified step config (config.toml)`);
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
	expectBoolean(asRecord(config.activation), "guardEnabled", d.activation.guardEnabled, warnings);
	expectBoolean(asRecord(config.activation), "confirmBeforeActivate", d.activation.confirmBeforeActivate, warnings);
	expectBoolean(asRecord(config.activation), "headlessAutoActivate", d.activation.headlessAutoActivate, warnings);
	if (!isStringArray(config.activation.keywords)) {
		config.activation.keywords = d.activation.keywords;
		warnings.push("activation.keywords");
	} else {
		// Forced migration (0.2.0): deprecated keywords are stripped from the
		// effective list so a future official agent-teams feature cannot be
		// shadowed by this plugin. The user's file is never rewritten; the
		// stripped terms are reported via consumeKeywordMigration().
		const kept = config.activation.keywords.filter(
			(k) => !(DEPRECATED_KEYWORDS as readonly string[]).includes(k.trim().toLowerCase()),
		);
		if (kept.length !== config.activation.keywords.length) {
			// Report the user's own terms, trimmed and deduped: the strip above
			// matches on the normalized form, so a list like
			// ["agent team", "agent team "] must not notify the same term twice.
			lastKeywordMigration = [
				...new Set(config.activation.keywords.filter((k) => !kept.includes(k)).map((k) => k.trim())),
			];
			if (kept.length > 0) {
				config.activation.keywords = kept;
				warnings.push("activation.keywords (deprecated terms removed)");
			} else {
				// Every configured term was deprecated: keyword activation stays
				// OFF instead of silently re-adding the full default list (which
				// would widen the user's activation surface, not narrow it).
				config.activation.keywords = [];
				warnings.push(
					"activation.keywords (all terms deprecated; keyword activation disabled — set plugin-specific keywords to re-enable)",
				);
			}
		}
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
	expectBoolean(asRecord(config.models), "autonomousEffort", d.models.autonomousEffort, warnings);

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
	expectIntRange(asRecord(config.tasks), "max", d.tasks.max, 1, 10_000, warnings);
	expectIntRange(asRecord(config.tasks), "outputCapBytes", d.tasks.outputCapBytes, 1_024, 10 * 1024 * 1024, warnings);

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
	expectBoolean(asRecord(config.plan), "enabled", d.plan.enabled, warnings);
	if (typeof config.plan.tier !== "string" || !(PLAN_TIER_MODES as readonly string[]).includes(config.plan.tier)) {
		config.plan.tier = d.plan.tier;
		warnings.push("plan.tier");
	}
	if (typeof config.presets.effort !== "object" || config.presets.effort === null || Array.isArray(config.presets.effort)) {
		config.presets.effort = { ...d.presets.effort };
		warnings.push("presets.effort");
	} else {
		for (const [role, level] of Object.entries(config.presets.effort)) {
			if (typeof level !== "string" || !(VALID_EFFORT as readonly string[]).includes(level)) {
				delete config.presets.effort[role];
				warnings.push(`presets.effort.${role}`);
			}
		}
	}
	expectBoolean(asRecord(config), "debug", d.debug, warnings);

	return warnings;
}
