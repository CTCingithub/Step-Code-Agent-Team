# Configuration Reference

> [简体中文 →](./CONFIGURATION_CN.md)

All behavior is controlled by the `stepcodeAgentTeam` table in Step Code's unified config file. No configuration is required — built-in defaults apply. On first activation the plugin appends a commented defaults block to your global config so the options are discoverable.

## Location and Precedence

| Tier | Path | Notes |
|---|---|---|
| Global | `[stepcodeAgentTeam]` table in `<stepRoot>/config.toml` | `stepRoot` sits beside the agent dir: `dirname(STEP_CODING_AGENT_DIR)`, default `~/.stepcode` (the sandbox points the agent dir at `sandbox/agent`) |
| Project | `[stepcodeAgentTeam]` table in `<cwd>/.stepcode/config.toml` | Loaded only when the project is trusted; merged at the first event context, overriding the global tier |
| Environment | `STEPCODE_TEAM_DEBUG` · `STEPCODE_TEAM_COST_WARN` · `STEPCODE_TEAM_MAXDEPTH` | One-off overrides; highest precedence |

**Precedence: built-in defaults < global config.toml < project config.toml < environment overrides.** Config is read once at load; `/reload` re-reads it but also returns the plugin to its default-off state. Unknown keys are ignored; invalid values fall back to defaults with a debug-log warning. The plugin only reads its own table and never writes the file — except the commented seed block appended on first activation.

## Configuration

Global (`<stepRoot>/config.toml`) or project (`<cwd>/.stepcode/config.toml`). TOML has no null: keys whose default is null (`members.defaultTools`, `storage.dir`) are omitted:

```toml
[stepcodeAgentTeam.activation]
enabled = true                       # master switch; false disables both triggers
keywords = ["智能体小队", "多智能体小队", "组小队", "stepcode 小队", "topo team", "topo-agent", "stepcode topo", "topology team", "agent squad", "stepcode-agent-team", "step code agent team", "team_create_member", "team_send", "team_task"]   # plugin-specific keywords; [] disables keyword activation
notifyOnActivate = true              # notify on activation
guardEnabled = true                  # L1: ignore negation / meta-discussion / code-reference mentions
confirmBeforeActivate = true         # L2: TUI asks before a keyword hit activates (headless ignores it)
headlessAutoActivate = true          # L3: headless/RPC activates on keyword hits without a dialog

[stepcodeAgentTeam.models]
available = ["step-5-preview"]       # member model pool
autonomousSelection = false          # true = the leader picks a model per member
autonomousThinking = false           # true = the leader picks the thinking effort per member

[stepcodeAgentTeam.members]
max = 8                              # live-member cap (1–64)
defaultRole = "worker"               # default role for new members
# defaultTools omitted (null) = preset allowlist or all tools
maxRecursionDepth = 1                # team-tree depth bound (1–4)

[stepcodeAgentTeam.dispatch]
maxConcurrent = 5                    # parallel member cap (1–16); extra dispatches queue
timeoutMs = 180000                   # per-dispatch timeout
handshakeTimeoutMs = 15000           # member spawn handshake timeout
retries = 1                          # task retry count (0–5)

[stepcodeAgentTeam.oneshot]
timeoutMs = 180000                   # stateless dispatch timeout

[stepcodeAgentTeam.cost]
warnThreshold = 1                    # cumulative spend warning (USD); 0 = off

[stepcodeAgentTeam.idle]
reapAfterMs = 1800000                # idle reaping threshold (30 min)
reapIntervalMs = 300000              # reaping check interval (5 min)

[stepcodeAgentTeam.storage]
# dir omitted (null) = <agentDir>/teams

[stepcodeAgentTeam.topology]
default = "star"                     # star/pipeline/mesh/ring/custom
requireDeclaration = false           # true = no dispatch before the topology is declared
maxLoopCount = 2                     # ring message-chain bound (0 = unlimited, 0–64)

[stepcodeAgentTeam.plan]
enabled = false                      # team-plan picker: economic/fast/balanced/performance + custom on activation
tier = "always ask"                  # always ask = picker every time; a pinned tier applies directly

[stepcodeAgentTeam.presets.effort]
scout = "low"                        # per-role effort overrides (custom roles: set effort in their own frontmatter)
planner = "medium"                   # ignored while models.autonomousThinking is on (the leader picks)
worker = "medium"
reviewer = "high"

[stepcodeAgentTeam]
debug = false                        # debug logging
```

## Options at a Glance

| Section | Controls |
|---|---|
| `activation` | Default-off gate: the `/topo` command (`/topo off` deactivates and re-hides the tools) or a keyword mention (case-insensitive) activates the plugin; sticky for the session. With `enabled: false` neither trigger works and the command reports the config disable. Deprecated keywords (the old "agent team" / "智能体团队" style terms) are stripped from the effective list on load — forced migration, reported once on activation. `guardEnabled` / `confirmBeforeActivate` / `headlessAutoActivate` layer the false-trigger guard — slash commands bypass it |
| `models` | Member model pool. `autonomousSelection` off (default) pins every member to the conversation model (preset/explicit `model` ignored); on, resolution is explicit `model` → preset → conversation model (unknown explicit model errors with the available list; unknown preset model falls back to `available[0]`). `autonomousThinking` off resolves effort as: explicit param → `presets.effort` override → preset frontmatter `effort` → `high`; on lets the leader choose per member (all preset efforts inert) |
| `members` | `max` counts **live** members only (dead records stay resumable without occupying a slot). `maxRecursionDepth`: 1 = members cannot spawn sub-teams (fully inert in their sessions); 2+ grants sub-leaders their own independent team (registry + socket), bounded at 4 |
| `dispatch` | `maxConcurrent` gates **before process start** (queue-before-start); oneshot dispatches share the budget; nested member-to-member relays bypass the global gate to avoid chain deadlock |
| `oneshot` | Timeout for stateless `mode: "oneshot"` dispatches |
| `cost` | Team-level cumulative spend warning; 0 disables |
| `idle` | Idle members are reaped (sessions stay resumable); running members are never reaped |
| `storage` | Team data root (registry, sessions, prompts, socket); null = `<agentDir>/teams` |
| `topology` | Member-to-member messaging is denied unless a declared edge allows it. `requireDeclaration` enforces "design before work". `maxLoopCount` bounds chain length (leader dispatch = 0, each forward +1); a hop over the limit is rejected and the sender reports to the leader — which also prevents ring-circulation deadlocks. Edges touching read-only roles (no `bash`) are **unusable and degrade to leader relay** — express dependencies via the task board's `blockedBy` |
| `plan` | Team-plan picker (default off): on activation the leader offers economic/fast/balanced/performance *strategies* plus a custom flow (size → topology → effort). A tier is a strategy prompt with a non-binding example — the model decides members, roles, topology, and effort. `tier = "always ask"` (default) shows the picker; a pinned tier applies directly on every activation (command and keyword paths); `/topo <tier>` overrides per invocation. Picker timeout / headless falls back to `balanced`; options are localized; no cost multipliers |
| `presets.effort` | Per-role effort overrides (built-in role names shown; custom roles set `effort` in their own frontmatter). Resolution: explicit `thinking` param → this config → preset frontmatter → `high`. Inert while `models.autonomousThinking` is on. Custom roles load from `<agentDir>/agents/` and `<project>/.stepcode/agents/` — see [docs/ROLES.md](docs/ROLES.md) |
| `debug` | Diagnostic logging to stderr |

Topology shapes (declared with `team_set_topology` after creating members, before dispatching):

| Shape | Edges | Fits |
|---|---|---|
| `star` (default) | none | Independent parallel strands the leader merges |
| `pipeline` | m1→m2→…→mn (member creation order) | Sequential refinement |
| `mesh` | all ordered pairs | Peers cross-checking each other |
| `ring` | mi→mi+1 (wraps to first) | Round-robin review |
| `custom` | explicit `[{from, to}]` list | Precise control |

Members learn their notifiable neighbors dynamically via `stepcode-team status` (the server returns the `mayMessage` list for the sender's identity).

## Environment Overrides

| Variable | Purpose |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | Equivalent to `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | Overrides `cost.warnThreshold` (invalid values ignored) |
| `STEPCODE_TEAM_MAXDEPTH=<n>` | Overrides `members.maxRecursionDepth` (1–4; invalid values ignored); the leader injects the effective value into sub-member processes |
| `STEPCODE_TEAM_SOCK` | Injected automatically by the leader into member processes, pointing at the team service socket (no manual setup needed) |

## Notes

- **First-activation seed**: when the plugin is first activated in a session and your global config has no `stepcodeAgentTeam` table, a commented defaults block is appended to `config.toml`. It is comments only (defaults keep applying) — uncomment to override, or delete the block.
- **Known compromise**: tool description strings fixed at registration (e.g. the model list) and the depth gate (`maxRecursionDepth`) do not refresh when a project-level override is applied mid-session; the effective depth bound is propagated to sub-members via `STEPCODE_TEAM_MAXDEPTH`, and description changes take effect next session.
- **Sandbox isolation**: `STEP_CODING_AGENT_DIR` moves both the agent dir and the global config root, so the sandbox never touches your real configuration.
