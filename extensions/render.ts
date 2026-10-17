/**
 * TUI rendering for team tools.
 *
 * API mirrors the official subagent example: renderCall(args, theme) and
 * renderResult(result, { expanded }, theme) return pi-tui components. These
 * only run in the interactive TUI; headless/RPC modes use the text content.
 */

import { Text } from "@step-harness/pi-tui";
import type { MemberUsage } from "./registry.ts";

interface Theme {
	fg: (color: string, text: string) => string;
	bold: (text: string) => string;
}

const STATUS_ICON: Record<string, string> = {
	idle: "○",
	running: "●",
	dead: "✗",
};

function preview(text: unknown, max: number): string {
	if (typeof text !== "string" || !text) return "...";
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function bodyText(text: string, expanded: boolean): string {
	if (expanded) return text;
	const lines = text.split("\n").slice(0, 3).join("\n");
	return lines.length < text.length ? `${lines}\n${"(ctrl+o to expand)"}` : lines;
}

function usageText(usage: MemberUsage | undefined): string {
	if (!usage || (!usage.turns && !usage.cost)) return "";
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	return parts.join(", ");
}

export type TeamToolName =
	| "team_create_member"
	| "team_send"
	| "team_task"
	| "team_disband"
	| "team_status";

export function renderTeamCall(tool: TeamToolName) {
	return (args: Record<string, unknown>, theme: Theme): Text => {
		const head = theme.fg("toolTitle", theme.bold("team "));
		const str = (v: unknown): string => (typeof v === "string" ? v : "");
		switch (tool) {
			case "team_create_member":
				return new Text(
					`${head}${theme.fg("success", `+${str(args.name)}`)}${theme.fg("muted", ` (${str(args.role) || str(args.name)})`)}${args.model ? theme.fg("dim", ` ${str(args.model)}`) : ""}`,
					0,
					0,
				);
			case "team_send": {
				const task = args.taskId ? theme.fg("warning", ` [${str(args.taskId)}]`) : "";
				const mode = args.mode === "oneshot" ? theme.fg("dim", " (oneshot)") : "";
				return new Text(
					`${head}${theme.fg("accent", `→${str(args.member)}`)}${task}${mode}\n  ${theme.fg("dim", preview(args.message, 70))}`,
					0,
					0,
				);
			}
			case "team_task":
				return new Text(
					`${head}${theme.fg("accent", `task ${str(args.action)}`)}${args.id ? theme.fg("muted", ` ${str(args.id)}`) : ""}${args.title ? theme.fg("dim", ` ${preview(args.title, 50)}`) : ""}`,
					0,
					0,
				);
			case "team_disband":
				return new Text(`${head}${theme.fg("error", args.member ? `−${str(args.member)}` : "−all")}`, 0, 0);
			default:
				return new Text(`${head}${theme.fg("accent", "status")}`, 0, 0);
		}
	};
}

interface TeamResultDetails {
	created?: boolean;
	member?: { name: string; role: string; status: string; model?: string; usage?: MemberUsage };
	usage?: MemberUsage;
	task?: { id: string; status: string; title?: string; assignee?: string };
	members?: Array<{ name: string; role: string; status: string; usage?: MemberUsage }>;
	tasks?: Array<{ id: string; status: string; title?: string }>;
	disbanded?: string[];
	teamId?: string;
}

export function renderTeamResult(tool: TeamToolName) {
	return (
		result: { content?: Array<{ type: string; text?: string }>; details?: unknown },
		options: { expanded?: boolean },
		theme: Theme,
	): Text => {
		const details = (result.details ?? {}) as TeamResultDetails;
		const expanded = options.expanded ?? false;
		const contentText = result.content?.find((c) => c.type === "text")?.text ?? "";

		const header: string[] = [];
		switch (tool) {
			case "team_create_member": {
				const m = details.member;
				if (m) {
					header.push(
						`${details.created ? theme.fg("success", "✓") : theme.fg("accent", "↺")} ${theme.fg("toolTitle", theme.bold(m.name))}${theme.fg("muted", ` (${m.role})`)} [${m.status}]${m.model ? theme.fg("dim", ` ${m.model}`) : ""}`,
					);
				}
				break;
			}
			case "team_send": {
				const usage = usageText(details.usage);
				if (usage) header.push(theme.fg("dim", usage));
				if (details.task) {
					header.push(theme.fg("muted", `task ${details.task.id} [${details.task.status}]`));
				}
				break;
			}
			case "team_task": {
				const t = details.task;
				if (t) {
					header.push(
						`${t.id} [${t.status}]${t.assignee ? theme.fg("muted", ` @${t.assignee}`) : ""}${t.title ? theme.fg("dim", ` ${preview(t.title, 60)}`) : ""}`,
					);
				}
				break;
			}
			case "team_disband":
				header.push(theme.fg("muted", details.disbanded?.join(", ") || "nothing to disband"));
				break;
			case "team_status": {
				for (const m of details.members ?? []) {
					const usage = usageText(m.usage);
					header.push(
						`${STATUS_ICON[m.status] ?? "?"} ${theme.fg("accent", m.name)}${theme.fg("muted", ` (${m.role})`)}${usage ? theme.fg("dim", ` ${usage}`) : ""}`,
					);
				}
				for (const t of details.tasks ?? []) {
					header.push(`${theme.fg("muted", `${t.id} [${t.status}]`)}${theme.fg("dim", ` ${preview(t.title, 50)}`)}`);
				}
				break;
			}
		}

		// team_send / team_task start carry the member's reply as the body.
		const showBody = tool === "team_send" || (tool === "team_task" && details.task?.status !== undefined);
		if (showBody && contentText) {
			const body = bodyText(contentText, expanded);
			return new Text([...header, "", theme.fg("toolOutput", body)].join("\n"), 0, 0);
		}
		if (header.length > 0) return new Text(header.join("\n"), 0, 0);
		return new Text(contentText || "(no output)", 0, 0);
	};
}
