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
import type { TeamManager } from "./members.ts";
import { emptyUsage, type MemberUsage } from "./registry.ts";
import { renderTeamCall, renderTeamResult, type TeamToolName } from "./render.ts";

type GetManager = (ctx: ExtensionContext) => TeamManager;

function formatUsage(usage: MemberUsage): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`in ${usage.input}`);
	if (usage.output) parts.push(`out ${usage.output}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	return parts.join(", ") || "no usage yet";
}

const PER_TASK_OUTPUT_CAP = 50 * 1024;

/** Cumulative team spend threshold (USD) above which responses carry a warning. */
function costWarning(cost: number): string {
	const threshold = Number.parseFloat(process.env.STEPCODE_TEAM_COST_WARN ?? "") || 1;
	if (cost < threshold) return "";
	return `\n\n[cost guardrail] Team spend has reached $${cost.toFixed(4)} (threshold $${threshold.toFixed(2)}). Consider disbanding idle members or finishing up.`;
}

function truncateOutput(text: string): string {
	const byteLength = Buffer.byteLength(text, "utf8");
	if (byteLength <= PER_TASK_OUTPUT_CAP) return text;
	const truncated = text.slice(0, PER_TASK_OUTPUT_CAP);
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

export function registerTeamTools(pi: ExtensionAPI, getManager: GetManager): void {
	pi.registerTool({
		name: "team_create_member",
		label: "Create Team Member",
		description: [
			"Create (or resume) a member agent in the current team.",
			"Members run as isolated `step --mode rpc` processes with their own context window,",
			"model, and tool allowlist. Idempotent: an existing member name is resumed, not duplicated.",
		].join(" "),
		parameters: Type.Object({
			name: Type.String({ description: "Member name: lowercase letters/digits/-/_ , max 32 chars" }),
			role: Type.Optional(Type.String({ description: "Role label, e.g. scout, worker, reviewer" })),
			model: Type.Optional(Type.String({ description: "Model pattern or id; defaults to the leader's model" })),
			tools: Type.Optional(Type.Array(Type.String(), { description: "Tool allowlist; defaults to all tools" })),
			systemPrompt: Type.Optional(Type.String({ description: "System prompt appended to the member's default prompt" })),
		}),
		renderCall: renderTeamCall("team_create_member"),
		renderResult: renderTeamResult("team_create_member"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);
			const { member, created } = await manager.createMember({
				name: params.name,
				role: params.role,
				model: params.model,
				tools: params.tools,
				systemPrompt: params.systemPrompt,
			});
			return {
				content: [
					{
						type: "text",
						text: [
							`${created ? "Created" : "Resumed"} member "${member.name}" (role: ${member.role}).`,
							`Model: ${member.model ?? "leader default"}; tools: ${member.tools?.join(", ") ?? "all"}.`,
							`Status: ${member.status}. Use team_send to give it work.`,
						].join("\n"),
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
			"Prompts to the same member are serialized; parallelism happens across members (max 4 in flight).",
			"If the member process died, it is respawned with the same session id and resumes its context.",
			"Pass taskId to run the message as a task (marks it running, writes the reply back as the task result, one retry on failure).",
			"Pass mode: \"oneshot\" for stateless fire-and-forget work (fresh process, no session, no context continuity).",
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
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);

			if (params.taskId) {
				const { task, text } = await manager.startTask(params.taskId, params.member, params.message);
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
					details: { teamId: manager.teamId, task, member: params.member },
				};
			}

			const result =
				params.mode === "oneshot"
					? await manager.sendOneshot(params.member, params.message)
					: await manager.sendMessage(params.member, params.message);
			return {
				content: [
					{
						type: "text",
						text: [
							`Member "${result.member}" replied${result.resumed ? " (process was respawned; context resumed)" : ""}:`,
							"",
							truncateOutput(result.text || "(no output)"),
							costWarning(result.usage.cost),
						].join("\n"),
					},
				],
				details: { teamId: manager.teamId, member: result.member, usage: result.usage, resumed: result.resumed },
			};
		},
	});

	pi.registerTool({
		name: "team_task",
		label: "Team Task",
		description: [
			"Manage the team task board.",
			"create: add a task (optionally with blockedBy dependencies and an assignee).",
			"start: dispatch a ready task to its assignee (or the given one) and wait for completion.",
			"complete / fail: set a task's terminal status manually (result / reason recorded).",
			"list: show the board.",
			"A task is ready when every task in blockedBy is done; cycles are rejected.",
		].join(" "),
		parameters: Type.Object({
			action: StringEnum(["create", "start", "complete", "fail", "list"] as const, {
				description: "Task board action",
			}),
			id: Type.Optional(Type.String({ description: "Task id (required for start/complete/fail)" })),
			title: Type.Optional(Type.String({ description: "Task title (required for create)" })),
			detail: Type.Optional(Type.String({ description: "Task detail / acceptance criteria" })),
			blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task ids this task depends on" })),
			assignee: Type.Optional(Type.String({ description: "Member name for start, or default assignee for create" })),
			result: Type.Optional(Type.String({ description: "Result text for complete" })),
			reason: Type.Optional(Type.String(), { description: "Failure reason for fail" }),
		}),
		renderCall: renderTeamCall("team_task"),
		renderResult: renderTeamResult("team_task"),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const manager = getManager(ctx);

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
				const { task, text } = await manager.startTask(params.id, params.assignee);
				return {
					content: [
						{
							type: "text",
							text: [`Task ${task.id} [${task.status}] @${task.assignee}:`, "", truncateOutput(text || "(no output)")].join("\n"),
						},
					],
					details: { teamId: manager.teamId, task },
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
							costWarning(totalCost),
						].join("\n"),
					},
				],
				details: { teamId: manager.teamId, members: reg.members, tasks: reg.tasks, totalCost },
			};
		},
	});
}
