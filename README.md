# Step-Code-Agent-Team

Agent team plugin for [Step Code](https://stepfun.com) (`step`): your current session becomes a **leader** that spawns resumable **member** agents, decomposes goals into a dependency-aware **task board**, dispatches work in parallel, and lets members message each other directly — inspired by DeepSeek Harness's agent teams.

## How it works

```
leader session (this extension)
  │  team_create_member / team_send / team_task / team_status / team_disband
  ▼
TeamRegistry  <agentDir>/teams/<teamId>/registry.json
  ├── Member A:  step --mode rpc --session-id team-<id>-a   (isolated context)
  ├── Member B:  step --mode rpc --session-id team-<id>-b
  └── ... driven over stdio JSONL; killed on leader shutdown, resumed on demand
        ▲
        │ member-to-member messages
  bin/stepcode-team.mjs  ──►  Unix socket  <agentDir>/teams/<teamId>/sock
```

- **Members are real `step` processes** with their own context window, model, and tool allowlist, spoken to over the RPC protocol (`docs/rpc.md`). A member's context lives in its session file, so respawning it with the same session id resumes the conversation.
- **The task board is a DAG**: a task is `ready` when every task in its `blockedBy` is `done`; cycles are rejected.
- **Messaging**: members don't load this extension (no recursive teams); they reach teammates through the `stepcode-team` CLI shim, which talks to a Unix socket served by the leader process.
- **Guardrails**: max 8 members, max 4 concurrent dispatches, 180s per-dispatch timeout, cumulative-spend warning (`STEPCODE_TEAM_COST_WARN`, default $1), idle members reaped after 30 min (sessions stay resumable), all children killed on leader shutdown.

## Requirements

- The `step` CLI on your PATH.
- Node (for the `stepcode-team` shim, invoked as `node bin/stepcode-team.mjs`).
- No third-party npm dependencies.

## Install

```bash
# from a local checkout (adds the package to your step settings)
step install /path/to/Step-Code-Agent-Team

# dev loop: load the extension directly, no install
step -e ./extensions/index.ts
```

Then start a session and just ask: *"Create a team to review this repo in parallel."*

## Tools

| Tool | Purpose |
|---|---|
| `team_create_member` | Create/resume a member (`name`, optional `role` preset, `model`, `tools`, `systemPrompt`) |
| `team_send` | Message a member and wait for the full reply; optional `taskId` (runs it as a task) or `mode: "oneshot"` (stateless) |
| `team_task` | Task board: `create` / `start` / `complete` / `fail` / `list` |
| `team_status` | Members, task board, cumulative spend |
| `team_disband` | Stop one member or the whole team (sessions persist) |
| `/team` | Command: compact team board in the TUI |

## Bundled role presets (`agents/`)

| Preset | Tools | Use |
|---|---|---|
| `scout` | read-only | Codebase exploration, structured findings |
| `planner` | read-only | Implementation plans |
| `worker` | full | Executes plans, runs checks |
| `reviewer` | read-only | Adversarial review (correctness / style / security) |

Also included: `prompts/team-review.md` (parallel multi-reviewer chain) and
`skills/team-orchestration/SKILL.md` (when and how to form a team).

## Development sandbox

All development happens in `sandbox/` (gitignored), fully isolated from your real
`~/.stepcode` config, sessions, and projects:

```bash
./sandbox/run.sh     # launches step with STEP_CODING_AGENT_DIR pointed at sandbox/agent
bash sandbox/probe.sh  # zero-token protocol probe (expects "PROBE OK")
```

`run.sh` sets `STEP_CODING_AGENT_DIR`, `STEP_CODING_AGENT_SESSION_DIR`, and
`STEP_CODING_AGENT_PLAN_DIR` to `sandbox/agent/...`, and runs `step` in
`sandbox/project/` (a throwaway workspace). Export `STEP_API_KEY` in your shell
before runs that touch a model — keys are never written to disk.

## Project layout

```
extensions/    index.ts (wiring) · rpc-client.ts · members.ts · tasks.ts ·
               registry.ts · team-server.ts · presets.ts · tools.ts · render.ts
bin/           stepcode-team.mjs (member-side CLI shim)
agents/        role presets (scout · planner · worker · reviewer)
prompts/       team-review.md
skills/        team-orchestration/SKILL.md
sandbox/       isolated dev environment (gitignored)
```

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `STEPCODE_TEAM_COST_WARN` | `1` | Cumulative team spend (USD) that triggers the cost guardrail warning |
| `STEP_CODING_AGENT_DIR` | `~/.stepcode/agent` | Agent dir; team registries live under `<agentDir>/teams` (the sandbox points this at `sandbox/agent`) |
| `STEPCODE_TEAM_SOCK` | — | Set automatically on member processes; points at the team server socket |

Dispatch limits (compiled in): max 8 members, max 4 concurrent dispatches,
180s per-dispatch timeout, idle members reaped after 30 minutes.

## Development

Zero-token smoke probes exercise the protocol layer without any model calls
(spawn, handshake, registry, task graph, socket round-trip, presets):

```bash
bash sandbox/probe.sh   # RPC handshake probe → expects "PROBE OK"

# member lifecycle / task board / messaging probes (print [smoke] logs to stderr):
printf '{"id":"1","type":"get_state"}\n' \
  | STEP_CODING_AGENT_DIR="$PWD/sandbox/agent" \
    STEP_CODING_AGENT_SESSION_DIR="$PWD/sandbox/agent/sessions" \
    step -e "$PWD/extensions/index.ts" -e "$PWD/sandbox/smoke-phase1.ts" \
    --mode rpc --session-id smoke --session-dir "$PWD/sandbox/agent/sessions" 2>&1 \
  | grep '\[smoke\]'
```

(swap `smoke-phase1.ts` for `smoke-phase2.ts` / `smoke-phase3.ts` for the task
board and messaging probes). Everything runs inside `sandbox/`, isolated from
your real `~/.stepcode` state.

> **Headless runs:** `step -p` blocks tools that spawn processes or modify the
> workspace unless a permission preset is configured. For unattended runs, add
> `--approval-mode auto` (or `--non-interactive-approval allow`).

## License

MIT — see [LICENSE](LICENSE).

## Platform constraints

This plugin targets **Step Code only** and uses exclusively standard extension
APIs: `pi.registerTool` / `pi.registerCommand` / `ctx.ui.notify` / tool
`renderCall` + `renderResult` (pi-tui `Text`) / `onUpdate` streaming.

It does **not** depend on the DeepSeek Harness "better sidebar" plugin — or any
other DSH-only plugin — because no such plugin exists in Step Code. If a
sidebar-like UI is ever added, it must be built on Step Code native APIs, or
sit behind an optional interface that degrades to a no-op when the dependency
is absent, so the core team functionality always runs.

## Status

Phases 0–5 of the development plan are implemented and validated:

- **Protocol layer** (zero-token smoke probes, `sandbox/smoke-phase*.ts`):
  spawn, handshake, registry persistence, task graph, socket round-trip,
  preset loading.
- **Model-touching paths** (validated in the sandbox with a test key): member
  replies, context memory within a live member, resume after respawn via
  session id, member-to-member messaging through the shim, and end-to-end
  leader tool-calling (`team_create_member` → `team_send` → verbatim reply).
