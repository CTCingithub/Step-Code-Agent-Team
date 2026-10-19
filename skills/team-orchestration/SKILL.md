---
name: team-orchestration
description: When and how to orchestrate a multi-agent team with the step-code-agent-team extension. Use when a task benefits from parallel exploration, independent review passes, or work that needs isolated contexts.
---

# Team Orchestration

You are the leader. You can spawn member agents (`team_create_member`), send them
work (`team_send`), track a dependency-aware task board (`team_task`), and watch
spend and status (`team_status`, `/agent-team`).

**The plugin is dormant until activated.** The team tools only exist in your
toolset after the user runs `/agent-team` or explicitly mentions the agent team.
If the tools are missing, ask the user to run `/agent-team` — never pretend to
orchestrate a team without them.

Member models and thinking levels are policy-driven: by default every member
runs on the conversation's current model with `high` thinking. If the config
enables autonomous selection, pick each member's model from the available list
deliberately — cheap models for read-only scouting, stronger models for
implementation — and set its thinking level to match the task. Configuration
lives in the `stepcodeAgentTeam` section of settings.json (global
`<agentDir>/settings.json`; project-level `<cwd>/.stepcode/settings.json` when
the project is trusted).

## Design the communication topology first

Before dispatching work, decide how members may talk to each other and declare
it with `team_set_topology`. Direct member-to-member messaging is denied unless
an edge allows it — the default is a star (everything routes through you).

Pick the shape from the task structure:

| Task structure | Shape | Why |
|---|---|---|
| Independent parallel strands that you merge | `star` (default) | No peer chatter; you stay the only router |
| Sequential refinement (scout → planner → worker → reviewer) | `pipeline` | Each stage hands off to the next, in member creation order |
| Peers must cross-check each other | `mesh`, or a few `custom` edges | Only the pairs that truly need to talk get edges |
| Circular round-robin review | `ring` | Each member may message the next; the message chain is bounded by `topology.maxLoopCount` (default 2, 0 = unlimited) |

Start from `star` and add the minimum edges the task needs — every edge is a
potential LLM round-trip spent on coordination instead of work. Members discover
their allowed neighbors by running `stepcode-team status` inside the team.

## When to form a team

Form a team when the work has **independent parallel strands**: multi-file
exploration, several review lenses on one change, generate-then-verify loops.
Stay solo when the task is a single focused edit, a quick question, or anything
where coordination overhead exceeds the parallelism gain.

Rules of thumb:

- **2–4 members** is the sweet spot. More members multiply cost and merge effort.
- One strand of work = one member. Do not create a member per file.
- Prefer a **review/verify pair** (worker + reviewer) over a single agent when
  correctness matters.

## How to run a team

1. **Create members with roles.** Use the bundled presets: `scout` (read-only
   exploration), `planner` (read-only planning), `worker` (implements),
   `reviewer` (adversarial review). Give each member a distinct focus in its
   systemPrompt so their outputs do not overlap.
2. **Decompose into tasks with dependencies.** Use `team_task create` with
   `blockedBy` edges. Independent tasks run in parallel; dependent chains run in
   order. Dispatch with `team_task start` (or `team_send` with a `taskId`).
3. **Keep members on short leashes.** Each message should be a complete,
   self-contained instruction with the context that member needs. Members have
   isolated contexts — they do not see your conversation.
4. **Merge yourself.** Collect member outputs and synthesize. Do not ask members
   to read each other's full transcripts; use the task results and short direct
   messages (`stepcode-team msg`) for the few facts that genuinely cross
   boundaries. The shim runs through a shell, so only members with `bash` in
   their tool allowlist can message directly — read-only presets (scout/planner/
   reviewer) cannot, and the leader relays for them.
5. **Disband when done.** `team_disband` stops member processes. Sessions persist,
   so recreating a member later resumes its context.

## Cost control

- Concurrency is capped at 5 in-flight dispatches (`dispatch.maxConcurrent`); per-member prompts are serialized.
- Watch cumulative spend in `team_status`; a warning appears past
  `STEPCODE_TEAM_COST_WARN` (default $1).
- Idle members are reaped after 30 minutes; their sessions remain resumable.
- Use `team_send` with `mode: "oneshot"` for stateless fan-out where context
  continuity does not matter (cheaper: no long-lived process).

## Pitfalls

- Do not create a team for a single edit — the overhead is pure loss.
- Do not give two members the same task "for safety" — deduplicate afterwards
  with a merge task instead.
- Reviewers get read-only tool allowlists by preset; do not hand them `write`.
