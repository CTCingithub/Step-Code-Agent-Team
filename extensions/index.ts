/**
 * Step-Code-Agent-Team extension entry point.
 *
 * Default-off: the team tools are registered but declared unavailable
 * (pi.setUnavailableTools) until the plugin is activated — by the /agent-team
 * command or an explicit plugin mention in the prompt. On activation the tools
 * are released, the messaging server starts, and idle reaping begins.
 *
 * Members are isolated `step --mode rpc` subprocesses; their contexts persist
 * in session files, so members can be respawned and resume where they left off.
 * Member-to-member messaging runs through a Unix socket served by this process
 * and reached by members via the `stepcode-team` CLI shim.
 */

import type { ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import { currentDepth, TeamManager } from "./members.ts";
import { registerTeamTools } from "./tools.ts";
import { TeamServer } from "./team-server.ts";
import { getConfig, applyProjectConfig, agentDir, seedGlobalConfigExample } from "./config.ts";
import { activate, detectKeyword, initActivation, isActive, TEAM_TOOL_NAMES } from "./activation.ts";
import { wrapTeamRequest } from "./forward.ts";

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
		return activate(reason); // the initActivation callback runs startBackend
	};

	// Tools are registered with config-aware descriptions, then gated off
	// until activation.
	registerTeamTools(pi, getManager, config);
	pi.setUnavailableTools([...TEAM_TOOL_NAMES]);

	pi.registerCommand("agent-team", {
		description: "Activate the agent team plugin and show the team board; text after the command is forwarded to the agent as a team request",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			if (!config.activation.enabled) {
				ctx.ui.notify("Agent team plugin is disabled by configuration (activation.enabled = false).", "warning");
				return;
			}
			tryActivate(ctx, "/agent-team command");
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
			// A slash command consumes the whole input, so text after the command
			// would otherwise be dropped — forward it as a real user message now
			// that the team tools are available.
			const request = args?.trim() ?? "";
			if (request) lines.push("  → forwarding your request to the agent…");
			ctx.ui.notify(lines.join("\n"), "info");
			if (request) {
				try {
					// Wrap the request so the model knows the team is active and the
					// request is meant to be executed with it: forwarded verbatim, an
					// ordinary request ("read the project and summarize") is completed
					// solo — the tools are available but nothing says to use them
					// (observed in the 2026-10-19 TUI report: zero team tool calls).
					// sendUserMessage also throws while streaming unless a delivery
					// mode is given; queue behind the current turn in that case.
					const wrapped = wrapTeamRequest(request);
					if (ctx.isIdle()) pi.sendUserMessage(wrapped);
					else pi.sendUserMessage(wrapped, { deliverAs: "followUp" });
				} catch (err) {
					ctx.ui.notify(
						`Could not forward your request to the agent: ${err instanceof Error ? err.message : String(err)}`,
						"warning",
					);
				}
			}
		},
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

	// Natural-language activation. Slash commands are handled above: when a
	// command matches, the input event is skipped entirely.
	pi.on("input", (event, ctx) => {
		if (isActive()) return;
		currentCtx = ctx;
		if (detectKeyword(event.text)) {
			tryActivate(ctx, "explicit plugin mention");
		}
	});

	// Fallback for modes where the input event does not fire (e.g. headless
	// `step -p`): before_agent_start sees every prompt before the agent loop.
	pi.on("before_agent_start", (event, ctx) => {
		if (isActive()) return;
		currentCtx = ctx;
		if (detectKeyword(event.prompt)) {
			tryActivate(ctx, "explicit plugin mention");
		}
	});

	pi.on("session_shutdown", () => {
		shutDown = true;
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
