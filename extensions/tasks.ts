/**
 * Task board: dependency graph helpers.
 *
 * Tasks form a DAG via `blockedBy` edges. A task is `ready` when every
 * dependency is `done`; `pending` otherwise. Cycles are rejected at creation.
 */

import type { TaskRecord } from "./registry.ts";

export class TaskGraphError extends Error {}

/** Throws TaskGraphError if the blockedBy graph contains a cycle or unknown ids. */
export function validateGraph(tasks: TaskRecord[]): void {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	for (const task of tasks) {
		for (const dep of task.blockedBy) {
			if (!byId.has(dep)) {
				throw new TaskGraphError(`Task "${task.id}" blocked by unknown task "${dep}".`);
			}
		}
	}
	// Iterative DFS with colors: 0 = unvisited, 1 = in-progress, 2 = done.
	const color = new Map<string, 0 | 1 | 2>(tasks.map((t) => [t.id, 0]));
	const visit = (startId: string): void => {
		const stack: Array<{ id: string; deps: string[]; i: number }> = [
			{ id: startId, deps: byId.get(startId)?.blockedBy ?? [], i: 0 },
		];
		color.set(startId, 1);
		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			if (frame.i >= frame.deps.length) {
				color.set(frame.id, 2);
				stack.pop();
				continue;
			}
			const dep = frame.deps[frame.i++];
			const c = color.get(dep);
			if (c === 1) throw new TaskGraphError(`Dependency cycle detected at task "${dep}".`);
			if (c === 0) {
				color.set(dep, 1);
				stack.push({ id: dep, deps: byId.get(dep)?.blockedBy ?? [], i: 0 });
			}
		}
	};
	for (const task of tasks) {
		if (color.get(task.id) === 0) visit(task.id);
	}
}

/** Recompute pending/ready statuses in place. Terminal statuses are untouched. */
export function recomputeReady(tasks: TaskRecord[]): void {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	for (const task of tasks) {
		if (task.status !== "pending") continue;
		const blocked = task.blockedBy.some((dep) => {
			const d = byId.get(dep);
			return !d || d.status !== "done";
		});
		task.status = blocked ? "pending" : "ready";
	}
}

export function readyTasks(tasks: TaskRecord[]): TaskRecord[] {
	return tasks.filter((t) => t.status === "ready");
}

/** First free id in the T1..T999 sequence. */
export function nextTaskId(tasks: TaskRecord[]): string {
	const used = new Set(tasks.map((t) => t.id));
	for (let i = 1; i < 1000; i++) {
		const id = `T${i}`;
		if (!used.has(id)) return id;
	}
	throw new TaskGraphError("Task board is full (999 tasks).");
}

/** The message a member receives when a task is dispatched to it. */
export function taskPrompt(task: TaskRecord): string {
	const lines = [`Task ${task.id}: ${task.title}`];
	if (task.detail) lines.push("", task.detail);
	lines.push("", "Complete this task and report the outcome concisely.");
	return lines.join("\n");
}
