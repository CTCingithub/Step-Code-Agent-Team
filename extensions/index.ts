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

import * as fs from "node:fs";
import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import { currentDepth, TeamManager, teamIdForSession } from "./members.ts";
import { registryPath } from "./registry.ts";
import { registerTeamTools } from "./tools.ts";
import { TeamServer } from "./team-server.ts";
import { getConfig, applyProjectConfig, agentDir, seedGlobalConfigExample, consumeKeywordMigration } from "./config.ts";
import {
	activate,
	deactivate,
	detectKeyword,
	ensureToolsAvailable,
	initActivation,
	isActive,
	regateTools,
	TEAM_TOOL_NAMES,
} from "./activation.ts";
import {
	customTierInstruction,
	detectLang,
	approvedPlanInstruction,
	teamActivationInstruction,
	teamPlanPrompt,
	teamReviewInstruction,
	tierInstruction,
} from "./forward.ts";
import {
	allTiers,
	FALLBACK_TIER_ID,
	getTier,
	matchTierToken,
	PLAN_TIER_IDS,
	tierLabel,
	tierPickerOptions,
	tierPlanLines,
	type CustomPicks,
	type Lang,
	type TeamTier,
} from "./plan.ts";
import { VALID_EFFORT } from "./config.ts";
import type { TopologyShape } from "./topology.ts";
import { VALID_TOPOLOGY_SHAPES } from "./topology.ts";

/** Timeout for every interactive dialog (select / confirm / input). */
const INTERACTIVE_TIMEOUT_MS = 30_000;

/** A resolved plan choice: a pinned tier, the custom guided flow, or the review protocol. */
type PlanChoice =
	| { kind: "tier"; tier: TeamTier }
	| { kind: "custom"; requirements: string; picks: CustomPicks }
	| { kind: "review"; focus: string };

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
		if (!manager) {
			// Project-tier presets load only for trusted projects (the same gate
			// as the project-level config); the trust probe lives on the context.
			const trust = ctx as { isProjectTrusted?: () => boolean };
			const trusted = typeof trust.isProjectTrusted === "function" ? trust.isProjectTrusted() : false;
			manager = TeamManager.forSession(ctx.sessionManager.getSessionFile(), ctx.cwd, trusted);
		}
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
			: choice.kind === "custom"
				? customTierInstruction(choice.requirements, choice.picks, lang)
				: teamReviewInstruction(choice.focus, lang);

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
		const effortOptions = [...VALID_EFFORT.slice(1, 5)];
		const effortChoice = await pick(lang === "zh" ? "思考强度" : "Effort level", effortOptions, "medium");
		const effort = (VALID_EFFORT as readonly string[]).includes(effortChoice)
			? (effortChoice as (typeof VALID_EFFORT)[number])
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

	/** Braille spinner frames for the plan-generation progress widget. */
	const PLAN_PROGRESS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

	/**
	 * Progress indicator for the one-off plan generation: a spinner widget
	 * above/below the editor via ctx.ui.setWidget with plain strings
	 * (importing pi-tui here would stage a second copy of the extension and
	 * clash on tool names — see the STANDALONE_PHASES note in run-smoke.sh).
	 * Falls back to a plain notify when the host exposes no widget slot.
	 * Always call the returned stop function — it clears the widget.
	 */
	const startPlanProgress = (ctx: ExtensionContext, message: string): (() => void) => {
		// The widget slot is terminal-only UI (see ExtensionContext.mode's doc):
		// rpc/json/print modes get one plain notify instead of widget traffic.
		if (ctx.mode !== "tui" || typeof ctx.ui.setWidget !== "function") {
			ctx.ui.notify(message, "info");
			return () => {};
		}
		let frame = 0;
		const draw = () => {
			ctx.ui.setWidget("team-plan-progress", [`${PLAN_PROGRESS_FRAMES[frame % PLAN_PROGRESS_FRAMES.length]} ${message}`]);
			frame += 1;
		};
		draw();
		const timer = setInterval(draw, 120);
		return () => {
			clearInterval(timer);
			ctx.ui.setWidget("team-plan-progress", undefined);
		};
	};

	/**
	 * One-off planning call: the model drafts the ACTUAL team plan for this
	 * request — what the user is about to approve in the confirmation. Plan
	 * only (no tools). Returns null on any failure (no model, error, timeout,
	 * empty text); callers then fall back to the tier's standard shape.
	 */
	const generateTeamPlan = async (ctx: ExtensionContext, tier: TeamTier, request: string, lang: Lang): Promise<string | null> => {
		const model = ctx.model;
		if (!model) return null;
		const prompt = teamPlanPrompt(request, tier, lang);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const msg = await Promise.race([
				ctx.modelRegistry.complete(model, {
					systemPrompt: prompt.system,
					messages: [{ role: "user", content: prompt.user, timestamp: Date.now() }],
				}),
				new Promise<null>((resolve) => {
					timer = setTimeout(() => resolve(null), 90_000);
				}),
			]);
			if (!msg) return null;
			const text = msg.content
				.map((c) => (c.type === "text" ? (c as { text: string }).text : ""))
				.filter(Boolean)
				.join("\n")
				.trim();
			return text || null;
		} catch {
			return null;
		} finally {
			if (timer) clearTimeout(timer);
		}
	};

	/** Shows the plan summary and asks for confirmation (headless: implicit yes). */
	const confirmChoice = async (
		ctx: ExtensionContext,
		choice: PlanChoice,
		lang: Lang,
		planText?: string | null,
	): Promise<boolean> => {
		const lines =
			choice.kind === "tier"
				? [
						lang === "zh" ? `团队方案 · ${tierLabel(choice.tier, "zh")}` : `Team plan · ${tierLabel(choice.tier, "en")}`,
						// The tier's standard plan shape (members / topology / effort) —
						// what the tier directs the model to build. Strategy prose stays
						// out of the dialog: the user approves a concrete plan, not an
						// instruction.
						planText
							? [
									lang === "zh" ? "模型为本次请求生成的实际方案：" : "The model's actual plan for this request:",
									planText,
								].join("\n")
							: [
									// Fallback (bare /topo, or the planning call failed): the tier's
									// standard shape — there is no request-specific plan to show yet.
									...tierPlanLines(choice.tier, lang),
									lang === "zh"
										? "以上为该档位的标准方案形态；具体成员名、数量与分工由模型按任务实际需要调整。"
										: "The above is this tier's standard plan shape; the model adjusts member names, counts, and division of labor to the task.",
								].join("\n"),
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
			const acceptLabel = lang === "zh" ? "Accept · 按此方案组建" : "Accept · form this team";
			const cancelLabel = lang === "zh" ? "取消" : "Cancel";
			const picked = await ctx.ui.select("智能体团队", [acceptLabel, cancelLabel], {
				timeout: INTERACTIVE_TIMEOUT_MS,
			});
			return picked === acceptLabel;
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
		const reviewArg = first === "review" || first === "评审";
		const request = tierArg || customArg || reviewArg ? rest.join(" ").trim() : trimmed;

		let choice: PlanChoice | null = null;
		let extraRequest = "";
		if (reviewArg) {
			choice = { kind: "review", focus: request };
		} else if (tierArg) {
			choice = { kind: "tier", tier: getTier(tierArg) };
		} else if (customArg) {
			({ choice, request: extraRequest } = await resolveCustomChoice(ctx, request.length > 0, lang));
		} else if (planEnabled && standingTier !== "always ask") {
			choice = { kind: "tier", tier: getTier(standingTier) };
		} else if (planEnabled) {
			({ choice, request: extraRequest } = await pickChoice(ctx, request.length > 0, lang));
		}
		const effectiveRequest = request || extraRequest;
		let approvedPlan: string | null = null;
		if (choice) {
			// The review protocol is deterministic — no summary confirm needed.
			// For a tier with a request, the model drafts the ACTUAL plan first
			// (one-off, plan only) so the confirmation shows what will really be
			// built — not the tier's preset shape.
			let planText: string | null = null;
			if (choice.kind === "tier" && effectiveRequest && isInteractive(ctx)) {
				const stopPlanProgress = startPlanProgress(
					ctx,
					lang === "zh" ? "正在生成智能体拓扑协作方案" : "Generating the agent topology collaboration plan",
				);
				try {
					planText = await generateTeamPlan(ctx, choice.tier, effectiveRequest, lang);
				} finally {
					stopPlanProgress();
				}
			}
			const confirmed = choice.kind === "review" ? true : await confirmChoice(ctx, choice, lang, planText);
			if (!confirmed) choice = null;
			else {
				approvedPlan = planText;
				if (!request && !extraRequest) activeChoice = choice; // applies to the next message
			}
		}

		const team = getManager(ctx);
		const reg = team.snapshot();
		const lines: string[] = [`Team "${team.teamId}"`];
		if (reg.members.length === 0) {
			lines.push("  no members yet — create one with team_create_member");
		} else {
			for (const m of reg.members) {
				const icon = m.status === "idle" ? "○" : m.status === "running" ? "●" : "✗";
				const model = m.model ? ` ${m.model}` : "";
				const effort = m.effort ? ` effort=${m.effort}` : "";
				lines.push(`  ${icon} ${m.name} (${m.role}) [${m.status}]${model}${effort}`);
			}
		}
		for (const t of reg.tasks) {
			const blocked = t.blockedBy.length > 0 ? ` <- ${t.blockedBy.join(",")}` : "";
			lines.push(`  ${t.id} [${t.status}] ${t.title}${t.assignee ? ` @${t.assignee}` : ""}${blocked}`);
		}
		const totalCost = reg.members.reduce((sum, m) => sum + m.usage.cost, 0);
		lines.push(`  spend: $${totalCost.toFixed(4)}`);
		if (choice) {
			const planLabel =
				choice.kind === "tier"
					? tierLabel(choice.tier, lang)
					: choice.kind === "review"
						? lang === "zh"
							? "并行评审"
							: "Parallel review"
						: lang === "zh"
							? "自定义"
							: "Custom";
			lines.push(`  plan: ${planLabel}`);
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
					? approvedPlan && choice.kind === "tier"
						? [choiceInstruction(choice, lang), approvedPlanInstruction(choice.tier, approvedPlan, lang)].join("\n\n")
						: choiceInstruction(choice, lang)
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
			"Activate the agent team plugin and show the team board; optionally pick a team plan (economic/fast/balanced/performance/custom), run the parallel review protocol (/topo review [target]), or turn the plugin off (/topo off); text after the command is forwarded to the agent verbatim",
		getArgumentCompletions: (prefix: string) => {
			const items = [...PLAN_TIER_IDS, "custom", "review", "off"].map((value) => ({
				value,
				label: value,
				description:
					value === "off"
						? "deactivate and re-hide the team tools"
						: value === "review"
							? "run the parallel multi-reviewer protocol"
							: `apply the ${value} team plan`,
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
	// The pinned submodule's built typings lag its source: dist/index.d.ts
	// lacks the "context" overload the running host implements (the smoke live
	// checks exercise this hook), so register it through a narrow cast typed
	// with the official ContextEvent.
	const onContext = pi.on as unknown as (
	  event: "context",
	  handler: (event: ContextEvent) => { messages?: ContextEvent["messages"] } | void,
	) => void;
	onContext("context", (event) => {
		if (!pendingInjection) return;
		const injection = pendingInjection;
		// structuredClone (not a spread) keeps the AgentMessage union intact for the type checker.
		const messages = event.messages.map((m) => structuredClone(m));
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i];
			if (m?.role !== "user") continue;
			if (typeof m.content === "string") {
				m.content = `${injection}\n\n${m.content}`;
				return { messages };
			}
			const parts = m.content.map((p) => structuredClone(p));
			const textPart = parts.find((p) => p.type === "text");
			if (textPart) {
				textPart.text = `${injection}\n\n${textPart.text ?? ""}`;
				m.content = parts;
				return { messages };
			}
			break;
		}
		// Inlined (not a separate const) so the object literal is contextually
		// typed as AgentMessage — a standalone const widens role/type to string.
		return {
			messages: [...messages, { role: "user", content: [{ type: "text", text: injection }], timestamp: Date.now() }],
		};
	});

	// The injection is per-turn: drop it once the turn settles so the next
	// user message starts clean.
	pi.on("agent_settled", () => {
		pendingInjection = null;
	});

	pi.on("session_start", (_event, ctx) => {
		currentCtx = ctx;
		applyProjectConfigFromCtx(ctx);
		// Forced keyword migration (0.2.0): report stripped terms on a path that
		// runs whether or not an activation follows — a user whose whole list was
		// deprecated can never trigger activation (the effective list is now
		// empty), so the report must not wait for one; the config-level warning
		// is debug-gated only.
		const migratedOnStart = consumeKeywordMigration();
		if (migratedOnStart.length > 0) {
			ctx.ui.notify(
				`Migrated activation config: removed deprecated keywords (${migratedOnStart.join(", ")}). Use current keywords like 智能体小队 / topo team.`,
				"info",
			);
		}
		// Sub-leader members are granted their own team by their parent process
		// (STEPCODE_TEAM_AUTOACTIVATE is set only when the depth budget allows).
		if (process.env.STEPCODE_TEAM_AUTOACTIVATE === "1") {
			tryActivate(ctx, "sub-team grant");
			return;
		}
		// Self-healing: a team registry for this session on disk means the
		// plugin was active before (session resume, or an extension
		// re-initialization that reset the default-off gate). Restore it
		// instead of leaving the model with "tool not found" and no way back
		// except /topo.
		const teamId = teamIdForSession(ctx.sessionManager.getSessionFile());
		if (teamId && fs.existsSync(registryPath(teamId))) {
			tryActivate(ctx, "existing team session");
		}
	});

	// Natural-language activation (guarded). Slash commands are handled above:
	// when a command matches, the input event is skipped entirely. A plan
	// chosen without a request applies to the message being submitted now.
	pi.on("input", async (event, ctx) => {
		// Self-heal: host-side resets (tool-selection changes, extension
		// re-initialization) can hide the tools from under an active plugin;
		// re-assert them so the next tool call does not fail as "not found".
		if (isActive()) ensureToolsAvailable();
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
