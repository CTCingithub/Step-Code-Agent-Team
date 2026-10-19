/**
 * Step-Code-Agent-Team extension entry point.
 *
 * Default-off: the team tools are registered but declared unavailable
 * (pi.setUnavailableTools) until the plugin is activated — by the /topo
 * command or an explicit plugin mention in the prompt. On activation the
 * tools are released, the messaging server starts, and idle reaping begins.
 *
 * Members are isolated `step --mode rpc` subprocesses; their contexts persist
 * in session files, so members can be respawned and resume where they left off.
 * Member-to-member messaging runs through a Unix socket served by this process
 * and reached by members via the `stepcode-team` CLI shim.
 *
 * 0.2.0:
 * - /topo is the only command name — it avoids the bare "agent team"/
 *   "智能体团队" terms a future official agent-teams feature would claim
 *   (the /agent-team alias was removed; deprecated keywords are migrated
 *   away on load). Activation keywords are plugin-specific and guarded
 *   against false hits.
 * - Team-plan picker ([stepcodeAgentTeam.plan], default off): on activation
 *   the leader offers economic/fast/balanced/performance strategies plus a
 *   custom flow, confirms a summary, then forwards the request. A tier is a
 *   *strategy prompt* with non-binding examples — the model decides the
 *   actual team. `plan.tier` pins one strategy (default "always ask").
 * - Log-faithful forwarding: the request is sent verbatim and the "use the
 *   team" instruction is injected request-locally through the `context` event
 *   — the session file keeps exactly what the user typed.
 */

import type { ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import { currentDepth, TeamManager } from "./members.ts";
import { registerTeamTools } from "./tools.ts";
import { TeamServer } from "./team-server.ts";
import { getConfig, applyProjectConfig, agentDir, seedGlobalConfigExample, consumeKeywordMigration } from "./config.ts";
import {
	activate,
	deactivate,
	detectKeyword,
	initActivation,
	isActive,
	regateTools,
	TEAM_TOOL_NAMES,
} from "./activation.ts";
import { customTierInstruction, detectLang, teamActivationInstruction, tierInstruction, type Lang } from "./forward.ts";
import {
	allTiers,
	FALLBACK_TIER_ID,
	getTier,
	matchTierToken,
	PLAN_TIER_IDS,
	tierLabel,
	tierPickerOptions,
	type CustomPicks,
	type TeamTier,
} from "./plan.ts";
import { VALID_THINKING } from "./config.ts";
import type { TopologyShape } from "./topology.ts";
import { VALID_TOPOLOGY_SHAPES } from "./topology.ts";

/** Timeout for every interactive dialog (select / confirm / input). */
const INTERACTIVE_TIMEOUT_MS = 30_000;

/** A resolved plan choice: a pinned tier, or the custom guided flow. */
type PlanChoice =
	| { kind: "tier"; tier: TeamTier }
	| { kind: "custom"; requirements: string; picks: CustomPicks };

export default function (pi: ExtensionAPI) {
	// Config first: tool descriptions and gating depend on it.
	const config = getConfig();

	// Depth gate: at maxRecursionDepth this session may not orchestrate a team.
	// The extension stays completely inert (no tools, hooks, or server), which
	// is also the zero-context-cost way to bound recursion.
	const depth = currentDepth();
	if (depth >= config.members.maxRecursionDepth) {
		if (config.debug) {
			console.error(
				`[stepcode-agent-team] inert at depth ${depth} (maxRecursionDepth=${config.members.maxRecursionDepth})`,
			);
		}
		return;
	}

	let manager: TeamManager | null = null;
	let server: TeamServer | null = null;
	let reapTimer: NodeJS.Timeout | null = null;
	let currentCtx: ExtensionContext | null = null;
	let shutDown = false;

	// 0.2.0: request-local instruction injection (log-faithful forwarding).
	let pendingInjection: string | null = null;
	// Plan chosen without a request: applies to the user's next message.
	let activeChoice: PlanChoice | null = null;
	// Texts whose keyword activation the user declined this session.
	const declinedActivations = new Set<string>();

	// Project-level config: cwd and project trust are only knowable inside
	// event handlers, so the override is applied in place on the cached config
	// the first time a context is available (idempotent; env overrides still
	// win). Tool descriptions built at registration are not refreshed.
	let projectConfigApplied = false;
	const applyProjectConfigFromCtx = (ctx: ExtensionContext): void => {
		if (projectConfigApplied) return;
		projectConfigApplied = true;
		const trust = ctx as { isProjectTrusted?: () => boolean };
		const trusted = typeof trust.isProjectTrusted === "function" ? trust.isProjectTrusted() : false;
		applyProjectConfig(config, ctx.cwd, trusted);
	};

	const getManager = (ctx: ExtensionContext): TeamManager => {
		if (shutDown) throw new Error("Agent team plugin has shut down for this session.");
		if (!manager) manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd);
		return manager;
	};

	/** Backend side effects of a fresh activation (server, reaper, notify). */
	const startBackend = (ctx: ExtensionContext, reason: string): void => {
		const team = getManager(ctx);
		if (!server) {
			server = new TeamServer(team.socketPath, () => team);
			server.start();
		}
		if (!reapTimer) {
			// Self-rescheduling (not setInterval) so a project-level
			// idle.reapIntervalMs applied after activation still takes effect.
			const scheduleReap = (): void => {
				reapTimer = setTimeout(() => {
					reapTimer = null;
					void team.reapIdleMembers(getConfig().idle.reapAfterMs).then(scheduleReap, scheduleReap);
				}, getConfig().idle.reapIntervalMs);
				reapTimer.unref?.();
			};
			scheduleReap();
		}
		if (config.activation.notifyOnActivate) {
			ctx.ui.notify(`Agent team plugin activated (${reason}). Team tools are now available.`, "info");
		}
	};

	// Activation may be triggered from the command handler, the input hook, or
	// programmatically; backend effects always run with the latest context.
	initActivation(config, pi, (reason) => {
		if (currentCtx) startBackend(currentCtx, reason);
	});

	/** Returns true when this call performed the activation. */
	const tryActivate = (ctx: ExtensionContext, reason: string): boolean => {
		currentCtx = ctx;
		applyProjectConfigFromCtx(ctx);
		// First activation: seed the global config with a commented defaults
		// block so a fresh install has discoverable configuration (idempotent,
		// additive — comments only, defaults keep applying).
		seedGlobalConfigExample(agentDir());
		const activated = activate(reason); // the initActivation callback runs startBackend
		if (activated) {
			// Forced keyword migration (0.2.0): report terms stripped on load so
			// the user knows why an old keyword no longer activates the plugin.
			const migrated = consumeKeywordMigration();
			if (migrated.length > 0) {
				ctx.ui.notify(
					`Migrated activation config: removed deprecated keywords (${migrated.join(", ")}). Use current keywords like 智能体小队 / topo team.`,
					"info",
				);
			}
		}
		return activated;
	};

	// Tools are registered with config-aware descriptions, then gated off
	// until activation.
	registerTeamTools(pi, getManager, config);
	pi.setUnavailableTools([...TEAM_TOOL_NAMES]);

	// ------------------------------------------------------------ 0.2.0 helpers

	const isInteractive = (ctx: ExtensionContext): boolean => (ctx as { hasUI?: boolean }).hasUI === true;

	/** Localized instruction text for a resolved plan choice. */
	const choiceInstruction = (choice: PlanChoice, lang: Lang): string =>
		choice.kind === "tier"
			? tierInstruction(choice.tier, lang)
			: customTierInstruction(choice.requirements, choice.picks, lang);

	/** Applies the standing tier (plan.tier) after an activation, if pinned. */
	const applyStandingTier = (text: string): void => {
		const cfg = getConfig();
		if (!cfg.plan.enabled || cfg.plan.tier === "always ask") return;
		if (pendingInjection) return;
		pendingInjection = tierInstruction(getTier(cfg.plan.tier), detectLang(text));
	};

	/**
	 * Keyword activation with the false-positive guard: L1 heuristics live in
	 * detectKeyword (negation / meta-discussion / code reference); L2 asks for
	 * confirmation in the interactive TUI; L3 lets headless/RPC runs activate
	 * without a dialog (scripted sessions have nobody to answer — auto-
	 * declining would break them). Slash commands bypass all of this.
	 */
	const guardedKeywordActivation = async (text: string, ctx: ExtensionContext): Promise<void> => {
		if (isActive()) return;
		currentCtx = ctx;
		if (!detectKeyword(text)) return;
		const trimmed = text.trim();
		if (declinedActivations.has(trimmed)) return;
		const cfg = getConfig();
		if (cfg.activation.confirmBeforeActivate && isInteractive(ctx)) {
			let ok = false;
			try {
				ok = await ctx.ui.confirm("智能体团队", "检测到团队请求关键词，是否启用智能体团队？", {
					timeout: INTERACTIVE_TIMEOUT_MS,
				});
			} catch {
				ok = false;
			}
			if (!ok) {
				declinedActivations.add(trimmed);
				return;
			}
		} else if (!cfg.activation.headlessAutoActivate && !isInteractive(ctx)) {
			return;
		}
		tryActivate(ctx, "explicit plugin mention");
		applyStandingTier(text);
	};

	/** Guided custom flow: requirements → team size → topology → effort. */
	const resolveCustomChoice = async (
		ctx: ExtensionContext,
		hasRequest: boolean,
		lang: Lang,
	): Promise<{ choice: PlanChoice; request: string }> => {
		const fallback: PlanChoice = { kind: "tier", tier: getTier(FALLBACK_TIER_ID) };
		if (!isInteractive(ctx)) return { choice: fallback, request: "" };
		let requirements = "";
		if (!hasRequest) {
			try {
				requirements =
					(await ctx.ui.input(
						lang === "zh" ? "描述你的需求" : "Describe your requirements",
						lang === "zh" ? "如：重构 src/ 三个模块，只读审查，预算敏感" : "e.g. refactor three modules under src/, read-only review, budget-sensitive",
						{ timeout: 60_000 },
					)) ?? "";
			} catch {
				requirements = "";
			}
		}
		const pick = async (title: string, options: string[], fallbackValue: string): Promise<string> => {
			try {
				return (await ctx.ui.select(title, options, { timeout: INTERACTIVE_TIMEOUT_MS })) ?? fallbackValue;
			} catch {
				return fallbackValue;
			}
		};
		const sizeOptions = lang === "zh" ? ["2 人", "3 人", "5 人", "7 人"] : ["2 members", "3 members", "5 members", "7 members"];
		const sizeChoice = await pick(lang === "zh" ? "团队规模" : "Team size", sizeOptions, lang === "zh" ? "5 人" : "5 members");
		const size = Number.parseInt(sizeChoice, 10) || 5;
		const shapeOptions =
			lang === "zh"
				? ["star（队长中转，默认）", "pipeline（顺序接力）", "mesh（两两互通）", "ring（环形巡游）", "custom（显式边）"]
				: ["star (leader relays, default)", "pipeline (sequential)", "mesh (all pairs)", "ring (round-robin)", "custom (explicit edges)"];
		const shapeChoice = await pick(lang === "zh" ? "拓扑形状" : "Topology shape", shapeOptions, shapeOptions[0]);
		const shapeToken = shapeChoice.split(" ")[0] ?? "star";
		const shape = (VALID_TOPOLOGY_SHAPES as readonly string[]).includes(shapeToken)
			? (shapeToken as TopologyShape)
			: "star";
		const effortOptions = [...VALID_THINKING.slice(1, 5)];
		const effortChoice = await pick(lang === "zh" ? "思考强度" : "Effort level", effortOptions, "medium");
		const effort = (VALID_THINKING as readonly string[]).includes(effortChoice)
			? (effortChoice as (typeof VALID_THINKING)[number])
			: "medium";
		return {
			choice: { kind: "custom", requirements: requirements.trim(), picks: { size, shape, effort } },
			request: requirements.trim(),
		};
	};

	/**
	 * Plan picker: four strategies + custom, localized and multiplier-free.
	 * Headless/RPC sessions cannot answer a dialog, so they apply the fallback
	 * tier directly (no select in non-UI modes).
	 */
	const pickChoice = async (
		ctx: ExtensionContext,
		hasRequest: boolean,
		lang: Lang,
	): Promise<{ choice: PlanChoice; request: string }> => {
		const fallback: PlanChoice = { kind: "tier", tier: getTier(FALLBACK_TIER_ID) };
		if (!isInteractive(ctx)) return { choice: fallback, request: "" };
		const options = tierPickerOptions(lang);
		const customLabel = lang === "zh" ? "自定义需求…" : "Custom requirements…";
		try {
			const picked = await ctx.ui.select(lang === "zh" ? "选择团队方案" : "Choose a team plan", options, {
				timeout: INTERACTIVE_TIMEOUT_MS,
			});
			if (!picked) return { choice: fallback, request: "" };
			if (picked.startsWith(customLabel)) return await resolveCustomChoice(ctx, hasRequest, lang);
			const tier = allTiers().find((t) => picked.startsWith(tierLabel(t, lang)));
			return { choice: tier ? { kind: "tier", tier } : fallback, request: "" };
		} catch {
			return { choice: fallback, request: "" };
		}
	};

	/** Shows the plan summary and asks for confirmation (headless: implicit yes). */
	const confirmChoice = async (ctx: ExtensionContext, choice: PlanChoice, lang: Lang): Promise<boolean> => {
		const lines =
			choice.kind === "tier"
				? [
						lang === "zh" ? `团队方案 · ${tierLabel(choice.tier, "zh")}` : `Team plan · ${tierLabel(choice.tier, "en")}`,
						choice.kind === "tier" ? choice.tier.guidance[lang] : "",
						choice.kind === "tier" ? choice.tier.example[lang] : "",
						lang === "zh"
							? "具体成员、角色、拓扑与 effort 由模型按任务实际需要决定。"
							: "Actual members, roles, topology, and effort are decided by the model from the task.",
					].filter(Boolean)
				: [
						lang === "zh" ? "团队方案 · 自定义" : "Team plan · Custom",
						choice.kind === "custom" && choice.requirements ? `${choice.requirements}` : "",
						lang === "zh"
							? "具体成员、角色、拓扑与 effort 由模型按任务实际需要决定。"
							: "Actual members, roles, topology, and effort are decided by the model from the task.",
					].filter(Boolean);
		ctx.ui.notify(lines.join("\n"), "info");
		if (!isInteractive(ctx)) return true;
		try {
			return await ctx.ui.confirm("智能体团队", lang === "zh" ? "按此方案组建团队？" : "Form the team with this plan?", {
				timeout: INTERACTIVE_TIMEOUT_MS,
			});
		} catch {
			return false;
		}
	};

	/** The /topo command handler. */
	const runTeamCommand = async (args: string | undefined, ctx: ExtensionContext): Promise<void> => {
		currentCtx = ctx;
		if (!config.activation.enabled) {
			ctx.ui.notify("Agent team plugin is disabled by configuration (activation.enabled = false).", "warning");
			return;
		}
		const trimmed = (args ?? "").trim();
		const [first = "", ...rest] = trimmed.split(/\s+/);
		const lang: Lang = detectLang(trimmed);

		// /topo off — deactivate and re-gate the team tools (the escape hatch
		// for a misfired activation; member sessions stay resumable).
		if (first === "off" || first === "退出") {
			if (isActive()) {
				deactivate();
				regateTools();
				activeChoice = null;
				pendingInjection = null;
				ctx.ui.notify("Agent team plugin deactivated. Team tools are hidden again (member sessions stay resumable).", "info");
			} else {
				ctx.ui.notify("Agent team plugin is not active.", "info");
			}
			return;
		}

		tryActivate(ctx, "/topo command");

		// Resolve the plan choice: explicit tier arg > custom > pinned plan.tier
		// > picker (only when plan.tier is "always ask").
		const planEnabled = getConfig().plan.enabled;
		const standingTier = getConfig().plan.tier;
		const tierArg = matchTierToken(first);
		const customArg = first === "custom" || first === "自定义";
		const request = tierArg || customArg ? rest.join(" ").trim() : trimmed;

		let choice: PlanChoice | null = null;
		let extraRequest = "";
		if (tierArg) {
			choice = { kind: "tier", tier: getTier(tierArg) };
		} else if (customArg) {
			({ choice, request: extraRequest } = await resolveCustomChoice(ctx, request.length > 0, lang));
		} else if (planEnabled && standingTier !== "always ask") {
			choice = { kind: "tier", tier: getTier(standingTier) };
		} else if (planEnabled) {
			({ choice, request: extraRequest } = await pickChoice(ctx, request.length > 0, lang));
		}
		if (choice) {
			const confirmed = await confirmChoice(ctx, choice, lang);
			if (!confirmed) choice = null;
			else if (!request && !extraRequest) activeChoice = choice; // applies to the next message
		}
		const effectiveRequest = request || extraRequest;

		const team = getManager(ctx);
		const reg = team.snapshot();
		const lines: string[] = [`Team "${team.teamId}"`];
		if (reg.members.length === 0) {
			lines.push("  no members yet — create one with team_create_member");
		} else {
			for (const m of reg.members) {
				const icon = m.status === "idle" ? "○" : m.status === "running" ? "●" : "✗";
				const model = m.model ? ` ${m.model}` : "";
				const thinking = m.thinking ? ` thinking=${m.thinking}` : "";
				lines.push(`  ${icon} ${m.name} (${m.role}) [${m.status}]${model}${thinking}`);
			}
		}
		for (const t of reg.tasks) {
			const blocked = t.blockedBy.length > 0 ? ` <- ${t.blockedBy.join(",")}` : "";
			lines.push(`  ${t.id} [${t.status}] ${t.title}${t.assignee ? ` @${t.assignee}` : ""}${blocked}`);
		}
		const totalCost = reg.members.reduce((sum, m) => sum + m.usage.cost, 0);
		lines.push(`  spend: $${totalCost.toFixed(4)}`);
		if (choice) {
			lines.push(
				`  plan: ${choice.kind === "tier" ? tierLabel(choice.tier, lang) : lang === "zh" ? "自定义" : "Custom"}`,
			);
		}
		if (effectiveRequest) lines.push("  → forwarding your request to the agent…");
		ctx.ui.notify(lines.join("\n"), "info");

		if (effectiveRequest) {
			try {
				// Log fidelity: the request goes out verbatim; the "use the team"
				// signal is injected request-locally through the context event
				// (never written to the session file). sendUserMessage throws
				// while streaming unless a delivery mode is given; queue behind
				// the current turn in that case.
				pendingInjection = choice
					? choiceInstruction(choice, lang)
					: teamActivationInstruction(lang);
				if (ctx.isIdle()) pi.sendUserMessage(effectiveRequest);
				else pi.sendUserMessage(effectiveRequest, { deliverAs: "followUp" });
			} catch (err) {
				pendingInjection = null;
				ctx.ui.notify(
					`Could not forward your request to the agent: ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
			}
		}
	};

	pi.registerCommand("topo", {
		description:
			"Activate the agent team plugin and show the team board; optionally pick a team plan (economic/fast/balanced/performance/custom) or turn the plugin off (/topo off); text after the command is forwarded to the agent verbatim",
		getArgumentCompletions: (prefix: string) => {
			const items = [...PLAN_TIER_IDS, "custom", "off"].map((value) => ({
				value,
				label: value,
				description: value === "off" ? "deactivate and re-hide the team tools" : `apply the ${value} team plan`,
			}));
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			await runTeamCommand(args, ctx);
		},
	});

	// Plan B: request-local instruction injection. The forwarded request is
	// sent verbatim (session log == user input); this hook merges the "use the
	// team" instruction into the same turn's context only. emitContext works on
	// a structuredClone of the messages, so nothing is written back to the
	// session file — subsequent turns see the user's original text alone.
	pi.on("context", (event) => {
		if (!pendingInjection) return;
		const injection = pendingInjection;
		const messages = (event.messages as unknown as Array<{ role?: string; content?: unknown }>).map((m) => ({ ...m }));
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m?.role !== "user") continue;
			const content = m.content;
			if (typeof content === "string") {
				m.content = `${injection}\n\n${content}`;
				return { messages };
			}
			if (Array.isArray(content)) {
				const parts = content.map((p) => (typeof p === "object" && p !== null ? { ...(p as object) } : p));
				const textPart = parts.find(
					(p) =>
						typeof p === "object" &&
						p !== null &&
						(p as { type?: string }).type === "text" &&
						typeof (p as { text?: unknown }).text === "string",
				) as { text?: string } | undefined;
				if (textPart) {
					textPart.text = `${injection}\n\n${textPart.text ?? ""}`;
					m.content = parts;
					return { messages };
				}
			}
			break;
		}
		const synthetic = { role: "user", content: [{ type: "text", text: injection }] };
		return { messages: [...messages, synthetic] };
	});

	// The injection is per-turn: drop it once the turn settles so the next
	// user message starts clean.
	pi.on("agent_settled", () => {
		pendingInjection = null;
	});

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		applyProjectConfigFromCtx(ctx);
		// Sub-leader members are granted their own team by their parent process
		// (STEPCODE_TEAM_AUTOACTIVATE is set only when the depth budget allows).
		if (process.env.STEPCODE_TEAM_AUTOACTIVATE === "1") {
			tryActivate(ctx, "sub-team grant");
		}
	});

	// Natural-language activation (guarded). Slash commands are handled above:
	// when a command matches, the input event is skipped entirely. A plan
	// chosen without a request applies to the message being submitted now.
	pi.on("input", async (event, ctx) => {
		if (activeChoice && !pendingInjection) {
			pendingInjection = choiceInstruction(activeChoice, detectLang(event.text));
			activeChoice = null;
		}
		await guardedKeywordActivation(event.text, ctx);
	});

	// Fallback for modes where the input event does not fire (e.g. headless
	// `step -p`): before_agent_start sees every prompt before the agent loop.
	pi.on("before_agent_start", async (event, ctx) => {
		if (activeChoice && !pendingInjection) {
			pendingInjection = choiceInstruction(activeChoice, detectLang(event.prompt));
			activeChoice = null;
		}
		await guardedKeywordActivation(event.prompt, ctx);
	});

	pi.on("session_shutdown", () => {
		shutDown = true;
		pendingInjection = null;
		activeChoice = null;
		if (reapTimer) {
			clearTimeout(reapTimer);
			reapTimer = null;
		}
		server?.stop();
		server = null;
		// Members are children of this process; stop them so no orphans survive
		// the leader. Their sessions persist on disk, so recreating a member
		// resumes its context.
		manager?.shutdown();
		manager = null;
	});
}
