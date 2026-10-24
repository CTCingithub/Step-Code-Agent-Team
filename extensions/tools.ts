/**
 * Team tools exposed to the leader session's LLM.
 *
 * Tool contracts are specified in the plan (section 4.2). Error convention per
 * docs/extensions.md: invalid input throws (sets isError); return values never
 * set the error flag.
 */

import { Type } from "typebox";
import { StringEnum } from "@step-harness/providers";
import type { ExtensionAPI, ExtensionContext } from "@step-harness/coding-agent";
import {
	resumeIgnoredParams,
	type SendOptions,
	type TeamManager,
} from "./members.ts";
import type { MemberUsage } from "./registry.ts";
import type { PluginConfig } from "./config.ts";
import { getConfig, VALID_EFFORT } from "./config.ts";
import { isActive } from "./activation.ts";
import { renderTeamCall, renderTeamResult, type TeamToolName } from "./render.ts";
import { dispatchPrompt } from "./tasks.ts";

type GetManager = (ctx: ExtensionContext) => TeamManager;

function formatUsage(usage: MemberUsage): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`in ${usage.input}`);
	if (usage.output) parts.push(`out ${usage.output}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	return parts.join(", ") || "no usage yet";
}

/**
 * Cumulative team spend warning (threshold from config; 0 disables).
 * Env override (STEPCODE_TEAM_COST_WARN) is applied by the config loader.
 */
export function costWarning(config: PluginConfig, cost: number): string {
	const threshold = config.cost.warnThreshold;
	if (threshold <= 0 || cost < threshold) return "";
	return `\n\n[cost guardrail] Team spend has reached $${cost.toFixed(4)} (threshold $${threshold.toFixed(2)}). Consider disbanding idle members or finishing up.`;
}

/**
 * Per-task output cap comes from config (tasks.outputCapBytes; default 50 KiB).
 */
export function truncateOutput(text: string, capBytes = getConfig().tasks.outputCapBytes): string {
	const byteLength = Buffer.byteLength(text, "utf8");
	if (byteLength <= capBytes) return text;
	// Drop a trailing lone high surrogate: slicing by code units can split a
	// pair and emit an invalid character into the tool result.
	const truncated = text.slice(0, capBytes).replace(/[\uD800-\uDBFF]$/, "");
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. The full text is in the tool result details (fullText).]`;
}

/** Cumulative spend across all members — the guardrail is a team-level number. */
function teamSpend(manager: TeamManager): number {
	return manager.snapshot().members.reduce((sum, m) => sum + m.usage.cost, 0);
}

/** Defense in depth: team tools are unavailable until the plugin is activated. */
function assertActive(): void {
	if (!isActive()) {
		throw new Error(
			"Agent team plugin is not active. Activate it with /topo or mention a configured keyword (e.g. 智能体小队) in your message.",
		);
	}
}

export function registerTeamTools(pi: ExtensionAPI, getManager: GetManager, config: PluginConfig): void {
	pi.registerTool({
		name: "team_create_member",
		label: "Create Team Member",
		description: [
			"Create (or resume) a member agent in the current team.",
			"Members run as isolated `step --mode rpc` processes with their own context window,",
			"model, and tool allowlist. Idempotent: an existing member name is resumed, not duplicated,",
			"and on resume the passed role/tools/model/effort/systemPrompt are ignored — disband and",
			"recreate the member to change its configuration. Members message teammates through the built-in",
			"topo_team_msg tool (no bash needed — read-only presets can use their topology edges too).",
			"After creating the members, design the communication topology with team_set_topology before dispatching work.",
			"Keep teams small (2-4 members) and give each member a distinct focus.",
			"Role presets (bundled, <agentDir>/agents/, trusted <project>/.stepcode/agents/) are this plugin's own system; the built-in subagent extension reads the same directories with the same frontmatter shape independently — one file can back both a team role and a subagent agent, but the two systems keep separate state and never share it.",
		].join(" "),
		parameters: Type.Object({
			name: Type.String({ description: "Member name: lowercase letters/digits/-/_ , max 32 chars" }),
			role: Type.Optional(
				Type.String({
					description:
						"Role label; a bundled preset (scout/planner/worker/reviewer) or a custom role from <agentDir>/agents/ or <project>/.stepcode/agents/ applies its system prompt, tools, effort, and model",
				}),
			),
			model: Type.Optional(
				Type.String({
					description: config.models.autonomousSelection
						? `Model for the member. Choose from the team's available models: ${config.models.available.join(", ")}`
						: "Ignored while autonomous model selection is disabled — members use the conversation's current model",
				}),
			),
			effort: Type.Optional(
				StringEnum(VALID_EFFORT, {
					description: config.models.autonomousEffort
						? `Effort level for the member — choose per task: ${VALID_EFFORT.join(", ")}`
						: "Effort level for the member (default: presets.effort override → preset effort → high)",
				}),
			),
			tools: Type.Optional(Type.Array(Type.String(), { description: "Tool allowlist; defaults to all tools" })),
			systemPrompt: Type.Optional(Type.String({ description: "System prompt appended to the member's default prompt" })),
		}),
		renderCall: renderTeamCall("team_create_member"),
		renderResult: renderTeamResult("team_create_member"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);
			assertActive();
			const leaderModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
			const { member, created, note } = await manager.createMember(
				{
					name: params.name,
					role: params.role,
					model: params.model,
					effort: params.effort,
					tools: params.tools,
					systemPrompt: params.systemPrompt,
				},
				leaderModel,
			);
			const lines = [
				`${created ? "Created" : "Resumed"} member "${member.name}" (role: ${member.role}).`,
				`Model: ${member.model ?? "leader default"}; effort: ${member.effort ?? "default"}; tools: ${member.tools?.join(", ") ?? "all"}.`,
				`Status: ${member.status}. Use team_send to give it work.`,
			];
			if (note) lines.push(note);
			if (!created) {
				// Resume is idempotent: the existing record wins, so say which
				// passed params were dropped instead of implying a reconfiguration.
				const ignored = resumeIgnoredParams(params, member);
				if (ignored.length > 0) {
					lines.push(
						`Note: "${member.name}" already existed and was resumed; the passed ${ignored.join(", ")} ${ignored.length > 1 ? "were" : "was"} ignored (existing configuration kept). Disband the member and recreate it to change its configuration.`,
					);
				}
			}
			return {
				content: [
					{
						type: "text",
						text: lines.join("\n"),
					},
				],
				details: { teamId: manager.teamId, member, created },
			};
		},
	});

	pi.registerTool({
		name: "team_send",
		label: "Send to Member",
		description: [
			"Send a message to a team member and wait for its full reply.",
			`Prompts to the same member are serialized; parallelism happens across members (max ${config.dispatch.maxConcurrent} in flight).`,
			"If the member process died, it is respawned with the same session id and resumes its context.",
			"Pass taskId to run the message as a task (marks it running, writes the reply back as the task result, one retry on failure).",
			"Pass mode: \"oneshot\" for stateless fire-and-forget work (fresh process, no session, no context continuity).",
			"Members may only message each other along edges of the declared team topology (default: star — no direct member messaging).",
			"Keep each message complete and self-contained — members do not see your conversation.",
		].join(" "),
		parameters: Type.Object({
			member: Type.String({ description: "Target member name" }),
			message: Type.String({ description: "Message / task for the member" }),
			taskId: Type.Optional(Type.String({ description: "Task id to run this message as" })),
			mode: Type.Optional(
				StringEnum(["persistent", "oneshot"] as const, {
					description: 'Dispatch mode: "persistent" (default, resumable member process) or "oneshot" (stateless)',
				}),
			),
		}),
		renderCall: renderTeamCall("team_send"),
		renderResult: renderTeamResult("team_send"),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const manager = getManager(ctx);
			assertActive();

			if (params.taskId && params.mode === "oneshot") {
				throw new Error('team_send: taskId and mode "oneshot" are mutually exclusive.');
			}

			const options: SendOptions = {
				signal,
				onProgress: onUpdate
					? (text) =>
							onUpdate({
								content: [{ type: "text", text: text || "(member is working...)" }],
								details: { teamId: manager.teamId, member: params.member, streaming: true },
							})
					: undefined,
			};

			if (params.taskId) {
				const { task, text } = await manager.startTask(params.taskId, params.member, params.message, options);
				return {
					content: [
						{
							type: "text",
							text: [
								`Task ${task.id} [${task.status}] via member "${params.member}":`,
								"",
								truncateOutput(text || "(no output)"),
							].join("\n"),
						},
					],
					details: { teamId: manager.teamId, task, member: params.member, fullText: text },
				};
			}

			const result =
				params.mode === "oneshot"
					? await manager.sendOneshot(params.member, params.message, options)
					: await manager.sendMessage(params.member, params.message, options);
			return {
				content: [
					{
						type: "text",
						text: [
							`Member "${result.member}" replied${result.resumed ? " (process was respawned; context resumed)" : ""}:`,
							"",
							truncateOutput(result.text || "(no output)"),
							costWarning(config, teamSpend(manager)),
						].join("\n"),
					},
				],
				details: {
					teamId: manager.teamId,
					member: result.member,
					usage: result.usage,
					resumed: result.resumed,
					fullText: result.text,
				},
			};
		},
	});

	pi.registerTool({
		name: "team_task",
		label: "Team Task",
		description: [
			"Manage the team task board.",
			"create: add a task (optionally with blockedBy dependencies and an assignee).",
			"start: dispatch a ready task — or re-dispatch a failed one (its member resumes with context) — to its assignee (or the given one) and wait for completion.",
			"complete / fail: set a task's terminal status manually (result / reason recorded).",
			"list: show the board.",
			"A task is ready when every task in blockedBy is done; cycles are rejected.",
			"Prefer blockedBy dependencies over member-to-member messages.",
			"Scope: this is the team's shared board — tasks have assignees and live with the team, not the session; for your own in-session checklist use the built-in task_* tools. The two systems are separate and do not sync.",
		].join(" "),
		parameters: Type.Object({
			action: StringEnum(["create", "start", "complete", "fail", "list"] as const, {
				description: "Task board action",
			}),
			id: Type.Optional(Type.String({ description: "Task id (required for start/complete/fail)" })),
			title: Type.Optional(Type.String({ description: "Task title (required for create)" })),
			detail: Type.Optional(
				Type.String({ description: "Task detail / acceptance criteria — on start it is appended to the dispatch prompt" }),
			),
			blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task ids this task depends on" })),
			assignee: Type.Optional(Type.String({ description: "Member name for start, or default assignee for create" })),
			result: Type.Optional(Type.String({ description: "Result text for complete" })),
			// Single-argument form: the pinned typebox (1.3.7) declares
			// Optional(schema) with one parameter — a second options argument is
			// both a TS2554 error and silently dropped at runtime, so the
			// description never reached the tool schema. Attaching it to the
			// inner String keeps it in the schema. (The entry-49 handshake
			// correlation was load-confounded: members never load this file.)
			reason: Type.Optional(Type.String({ description: "Failure reason for fail" })),
		}),
		renderCall: renderTeamCall("team_task"),
		renderResult: renderTeamResult("team_task"),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const manager = getManager(ctx);
			assertActive();

			if (params.action === "create") {
				if (!params.title) throw new Error("team_task create requires a title.");
				const task = await manager.createTask({
					title: params.title,
					detail: params.detail,
					blockedBy: params.blockedBy,
					assignee: params.assignee,
				});
				return {
					content: [
						{
							type: "text",
							text: `Created task ${task.id} [${task.status}]: ${task.title}${task.assignee ? ` (assignee: ${task.assignee})` : ""}`,
						},
					],
					details: { teamId: manager.teamId, task },
				};
			}

			if (params.action === "list") {
				const reg = manager.snapshot();
				const lines =
					reg.tasks.length > 0
						? reg.tasks.map(
								(t) =>
									`- ${t.id} [${t.status}] ${t.title}${t.assignee ? ` @${t.assignee}` : ""}${
										t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(", ")})` : ""
									}`,
							)
						: ["- (no tasks)"];
				return {
					content: [{ type: "text", text: ["Tasks:", ...lines].join("\n") }],
					details: { teamId: manager.teamId, tasks: reg.tasks },
				};
			}

			if (!params.id) throw new Error(`team_task ${params.action} requires a task id.`);

			if (params.action === "start") {
				const options: SendOptions = {
					signal,
					onProgress: onUpdate
						? (text) =>
								onUpdate({
									content: [{ type: "text", text: text || "(member is working...)" }],
									details: { teamId: manager.teamId, streaming: true },
								})
						: undefined,
				};
				let dispatchMessage: string | undefined;
				if (params.detail) {
					const board = manager.snapshot().tasks.find((t) => t.id === params.id);
					dispatchMessage = board ? dispatchPrompt(board, params.detail) : params.detail;
				}
				const { task, text } = await manager.startTask(params.id, params.assignee, dispatchMessage, options);
				return {
					content: [
						{
							type: "text",
							text: [`Task ${task.id} [${task.status}] @${task.assignee}:`, "", truncateOutput(text || "(no output)")].join("\n"),
						},
					],
					details: { teamId: manager.teamId, task, fullText: text },
				};
			}

			if (params.action === "complete") {
				const task = manager.completeTask(params.id, params.result ?? "");
				return {
					content: [{ type: "text", text: `Task ${task.id} marked done.` }],
					details: { teamId: manager.teamId, task },
				};
			}

			const task = manager.failTask(params.id, params.reason ?? "(no reason given)");
			return {
				content: [{ type: "text", text: `Task ${task.id} marked failed: ${task.result}` }],
				details: { teamId: manager.teamId, task },
			};
		},
	});

	pi.registerTool({
		name: "team_set_topology",
		label: "Set Topology",
		description: [
			"Design the member-to-member communication topology BEFORE dispatching work (create the members first).",
			"Shapes: star (default — everything routes through you, no direct member messaging),",
			"pipeline (ordered handoffs in member creation order), mesh (everyone may message everyone),",
			"ring (each member may message the next), custom (explicit edges).",
			"Pass members to scope pipeline/mesh/ring to a subset of the current members (default: all).",
			"Match the shape to the task: parallel independent work needs only star; sequential refinement fits",
			"pipeline; cross-checking peers fit mesh or a few custom edges. Members message teammates through",
			"the built-in topo_team_msg tool (no bash required — read-only presets can use their edges too); a",
			"rejection tells the sender its allowed neighbors.",
		].join(" "),
		promptGuidelines: [
			"Use team_set_topology to design the member communication topology (star/pipeline/mesh/ring/custom) after creating members and before dispatching work with team_send or team_task.",
		],
		parameters: Type.Object({
			shape: StringEnum(["star", "pipeline", "mesh", "ring", "custom"] as const, {
				description: "Topology shape",
			}),
			edges: Type.Optional(
				Type.Array(
					Type.Object({
						from: Type.String({ description: "Sender member name" }),
						to: Type.String({ description: "Receiver member name" }),
					}),
					{ description: 'Explicit edges; required for shape "custom"' },
				),
			),
			members: Type.Optional(
				Type.Array(Type.String({ description: "Member name" }), {
					description: "Scope pipeline/mesh/ring to a subset of the current members (default: all)",
				}),
			),
		}),
		renderCall: renderTeamCall("team_set_topology"),
		renderResult: renderTeamResult("team_set_topology"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);
			assertActive();
			const edges = params.edges?.map((e: { from: string; to: string }) => [e.from, e.to] as [string, string]);
			const topology = manager.setTopology(params.shape, edges, params.members);
			const lines = ["Topology set:", manager.describeTopology()];
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { teamId: manager.teamId, topology },
			};
		},
	});

	pi.registerTool({
		name: "team_disband",
		label: "Disband Member",
		description:
			"Stop a team member's process (or the whole team when member is omitted). Sessions are preserved on disk, so members can be recreated later and resume their context.",
		parameters: Type.Object({
			member: Type.Optional(Type.String({ description: "Member to stop; omit to disband the whole team" })),
		}),
		renderCall: renderTeamCall("team_disband"),
		renderResult: renderTeamResult("team_disband"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);
			assertActive();
			const killed = await manager.disband(params.member);
			if (killed.length === 0) {
				return {
					content: [{ type: "text", text: `No members to disband (team "${manager.teamId}" is empty).` }],
					details: { teamId: manager.teamId, disbanded: [] },
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Disbanded: ${killed.join(", ")}. Sessions preserved; recreate members to resume.`,
					},
				],
				details: { teamId: manager.teamId, disbanded: killed },
			};
		},
	});

	pi.registerTool({
		name: "team_status",
		label: "Team Status",
		description: "Show the current team: members (status, model, usage) and the task board.",
		parameters: Type.Object({}),
		renderCall: renderTeamCall("team_status"),
		renderResult: renderTeamResult("team_status"),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);
			assertActive();
			const reg = manager.snapshot();
			const memberLines =
				reg.members.length > 0
					? reg.members.map(
							(m) =>
								`- ${m.name} (${m.role}) [${m.status}] model=${m.model ?? "leader default"} ${formatUsage(m.usage)}`,
						)
					: ["- (no members)"];
			const taskLines =
				reg.tasks.length > 0
					? reg.tasks.map(
							(t) =>
								`- ${t.id} [${t.status}] ${t.title}${t.assignee ? ` @${t.assignee}` : ""}${
									t.blockedBy.length > 0 ? ` (blocked by: ${t.blockedBy.join(", ")})` : ""
								}`,
						)
					: ["- (no tasks)"];
			const totalCost = reg.members.reduce((sum, m) => sum + m.usage.cost, 0);
			return {
				content: [
					{
						type: "text",
						text: [
							`Team "${reg.teamId}" (registry: ${manager.registryFile})`,
							"",
							"Members:",
							...memberLines,
							"",
							"Tasks:",
							...taskLines,
							"",
							`Total cost: $${totalCost.toFixed(4)}`,
							costWarning(config, totalCost),
						].join("\n"),
					},
				],
				details: { teamId: manager.teamId, members: reg.members, tasks: reg.tasks, totalCost },
			};
		},
	});
}
