/**
 * Member-to-member communication topology.
 *
 * Every member message flows through the team server, so the topology is an
 * allow-list of directed edges: member A may message member B only when edge
 * A→B exists. The default is a star (no edges) — everything routes through the
 * leader, which is the safest structure and matches the "design before work"
 * discipline: the leader declares the shape that fits the task, then dispatches.
 *
 * Shapes:
 *   star     — no direct member messaging; the leader relays everything
 *   pipeline — ordered handoffs in member creation order (m1→m2→…→mn)
 *   mesh     — every member may message every other member
 *   ring     — each member may message the next (mn wraps to m1)
 *   custom   — explicit edges
 */

export const VALID_TOPOLOGY_SHAPES = ["star", "pipeline", "mesh", "ring", "custom"] as const;
export type TopologyShape = (typeof VALID_TOPOLOGY_SHAPES)[number];

export type TopologyEdge = [string, string];

export interface TopologyData {
	shape: TopologyShape;
	edges: TopologyEdge[];
}

export class TopologyError extends Error {}

export function starTopology(): TopologyData {
	return { shape: "star", edges: [] };
}

export function pipelineTopology(members: string[]): TopologyData {
	const edges: TopologyEdge[] = [];
	for (let i = 0; i + 1 < members.length; i++) edges.push([members[i], members[i + 1]]);
	return { shape: "pipeline", edges };
}

export function meshTopology(members: string[]): TopologyData {
	const edges: TopologyEdge[] = [];
	for (const from of members) {
		for (const to of members) {
			if (from !== to) edges.push([from, to]);
		}
	}
	return { shape: "mesh", edges };
}

export function ringTopology(members: string[]): TopologyData {
	const edges: TopologyEdge[] = [];
	for (let i = 0; i < members.length; i++) {
		edges.push([members[i], members[(i + 1) % members.length]]);
	}
	return { shape: "ring", edges };
}

export function customTopology(edges: TopologyEdge[]): TopologyData {
	return { shape: "custom", edges: edges.map(([from, to]) => [from, to] as TopologyEdge) };
}

export interface BuildTopologyParams {
	shape: TopologyShape;
	/** Members in creation order (used by pipeline/ring; mesh uses the set). */
	members: string[];
	/** Explicit edges; required for shape "custom". */
	edges?: TopologyEdge[];
}

export function buildTopology(params: BuildTopologyParams): TopologyData {
	switch (params.shape) {
		case "star":
			return starTopology();
		case "pipeline":
			return pipelineTopology(params.members);
		case "mesh":
			return meshTopology(params.members);
		case "ring":
			return ringTopology(params.members);
		case "custom": {
			if (!params.edges || params.edges.length === 0) {
				throw new TopologyError('shape "custom" requires explicit edges.');
			}
			return customTopology(params.edges);
		}
	}
}

/** Deduplicates edges (first occurrence wins). */
export function normalizeTopology(data: TopologyData): TopologyData {
	const seen = new Set<string>();
	const edges: TopologyEdge[] = [];
	for (const [from, to] of data.edges) {
		const key = `${from}\u0000${to}`;
		if (seen.has(key)) continue;
		seen.add(key);
		edges.push([from, to]);
	}
	return { shape: data.shape, edges };
}

/** Throws TopologyError for unknown members, self-loops, or malformed edges. */
export function validateTopology(data: TopologyData, members: string[]): void {
	const known = new Set(members);
	for (const edge of data.edges) {
		if (!Array.isArray(edge) || edge.length !== 2 || typeof edge[0] !== "string" || typeof edge[1] !== "string") {
			throw new TopologyError("Topology edges must be [from, to] string pairs.");
		}
		const [from, to] = edge;
		if (!known.has(from)) throw new TopologyError(`Topology edge references unknown member "${from}".`);
		if (!known.has(to)) throw new TopologyError(`Topology edge references unknown member "${to}".`);
		if (from === to) throw new TopologyError(`Topology edge "${from} → ${from}" is a self-loop.`);
	}
}

export function topologyMayMessage(data: TopologyData, from: string, to: string): boolean {
	if (!from || !to || from === to) return false;
	return data.edges.some(([f, t]) => f === from && t === to);
}

export function topologyOutbound(data: TopologyData, from: string): string[] {
	const targets: string[] = [];
	for (const [f, t] of data.edges) {
		if (f === from && !targets.includes(t)) targets.push(t);
	}
	return targets;
}

export function describeTopology(data: TopologyData, members: string[]): string {
	if (data.edges.length === 0) return "star — all communication routes through the leader (no direct member messaging)";
	const lines = members.map((m) => {
		const out = topologyOutbound(data, m);
		return `${m} → ${out.length > 0 ? out.join(", ") : "(no direct peers)"}`;
	});
	return `${data.shape} (${data.edges.length} edge(s)):\n  ${lines.join("\n  ")}`;
}

/** Tolerant parser for registry files: anything unusable degrades to star. */
export function parseTopology(raw: unknown): TopologyData {
	if (typeof raw !== "object" || raw === null) return starTopology();
	const obj = raw as { shape?: unknown; edges?: unknown };
	if (!Array.isArray(obj.edges)) return starTopology();
	const edges: TopologyEdge[] = [];
	for (const edge of obj.edges) {
		if (Array.isArray(edge) && edge.length === 2 && typeof edge[0] === "string" && typeof edge[1] === "string") {
			edges.push([edge[0], edge[1]]);
		}
	}
	const shape = VALID_TOPOLOGY_SHAPES.includes(obj.shape as TopologyShape) ? (obj.shape as TopologyShape) : "custom";
	return normalizeTopology({ shape, edges });
}
