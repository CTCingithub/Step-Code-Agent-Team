# Configuration Reference

> [简体中文 →](./CONFIGURATION_ZH.md)

Step-Code-Agent-Team controls all behavior parameters through the `stepcodeAgentTeam` config section. Step Code first kept settings in `settings.json` and later moved them to the unified `config.toml` (`agent/settings.json` is retired there); both locations are honored, and the unified config is the current convention.

## Location and Precedence

```
Global:  the [stepcodeAgentTeam] table of <stepRoot>/config.toml
        (stepRoot sits beside the agent dir: dirname(STEP_CODING_AGENT_DIR),
         default ~/.stepcode — where step's own settings live)
        Legacy fallback: the "stepcodeAgentTeam" section of <agentDir>/settings.json
Project: the [stepcodeAgentTeam] table of <cwd>/.stepcode/config.toml
        (loaded only when the project is trusted; trust info is only available
         inside event handlers, so it is merged in place into the loaded config at session_start)
        Legacy fallback: the "stepcodeAgentTeam" section of <cwd>/.stepcode/settings.json
```

Precedence (the same within each of the global and project tiers): **built-in defaults < legacy dedicated files < settings.json section < config.toml table < environment overrides** — the unified config overrides the legacy settings section, the project tier overrides the global tier, and env overrides win over everything.

- The unified config is TOML (comments with `#` are supported); the legacy locations are standard JSON. The plugin only **reads** its own section and never writes any config file (step's own commands preserve unknown keys, so the `stepcodeAgentTeam` table survives them).
- Unknown keys are ignored (a note is printed to stderr when `debug: true`).
- Invalid values fall back to defaults with a warning in the debug log.
- Config is read once and cached at extension load; project-level config is merged in place as soon as the first event context is available (takes effect within the same session); other changes take effect in a new session (`/reload` re-reads it, but the plugin also returns to its default-off state).
- Known compromise: tool description strings fixed at registration (e.g. the model list) and this process's depth gate (`maxRecursionDepth`) are not refreshed by a project-level override — the effective depth bound is propagated to sub-members via `STEPCODE_TEAM_MAXDEPTH`, and description changes take effect next session.
- **Legacy compatibility**: the dedicated files `<agentDir>/stepcode-agent-team.json` / `<cwd>/.stepcode/stepcode-agent-team.json` and the `settings.json` sections are still honored (applied before the unified table at the same tier, with a migration hint in debug mode); migrate them into the `stepcodeAgentTeam` table of `config.toml` as early as possible.

## Environment Overrides

| Variable | Purpose |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | Equivalent to `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | Overrides `cost.warnThreshold` (invalid values ignored) |
| `STEPCODE_TEAM_MAXDEPTH=<n>` | Overrides `members.maxRecursionDepth` (1–4; invalid values ignored); the leader injects the effective value into sub-member processes |
| `STEPCODE_TEAM_SOCK` | Injected automatically by the leader into member processes, pointing at the team service socket (no manual setup needed) |

## Full Configuration

Put the following in the `[stepcodeAgentTeam]` table of `<stepRoot>/config.toml` (global) or `<cwd>/.stepcode/config.toml` (project). TOML has no null: keys whose default is null (`members.defaultTools`, `storage.dir`) are simply omitted:

```toml
[stepcodeAgentTeam.activation]
enabled = true                       # master switch: no trigger activates when false
keywords = ["agent team", "智能体团队"]   # natural-language trigger keywords; [] disables keyword activation
notifyOnActivate = true              # whether to notify on activation

[stepcodeAgentTeam.models]
available = ["step-5-preview"]       # model list available to members
autonomousSelection = false          # conversation model autonomously picks models for sub-agents
autonomousThinking = false           # conversation model autonomously picks thinking effort for sub-agents

[stepcodeAgentTeam.members]
max = 8                              # live-member cap (1–64; dead members can be resumed but don't occupy a slot)
defaultRole = "worker"               # default role when role is unspecified (matches the same-named preset)
# defaultTools: omit for null (= use the preset or all tools)
maxRecursionDepth = 1                # max team-tree depth (1–4): leader=0, its members=1

[stepcodeAgentTeam.dispatch]
maxConcurrent = 5                    # cap on simultaneously running members (1–16); dispatches beyond it queue and start when their turn comes
timeoutMs = 180000                   # single dispatch/promptAndSettle timeout
handshakeTimeoutMs = 15000           # member spawn handshake timeout
retries = 1                          # task failure retry count (0–5)

[stepcodeAgentTeam.oneshot]
timeoutMs = 180000                   # oneshot process timeout

[stepcodeAgentTeam.cost]
warnThreshold = 1                    # cumulative spend warning threshold (USD); 0 = disabled

[stepcodeAgentTeam.idle]
reapAfterMs = 1800000                # idle member reaping threshold (30 minutes)
reapIntervalMs = 300000              # reaping check interval (5 minutes)

[stepcodeAgentTeam.storage]
# dir: omit for null (= <agentDir>/teams)

[stepcodeAgentTeam.topology]
default = "star"                     # default topology shape for new teams (star/pipeline/mesh/ring/custom)
requireDeclaration = false           # when true, dispatch is forbidden before the topology is explicitly declared
maxLoopCount = 2                     # max hops in a ring message chain (0 = unlimited, range 0–64)

[stepcodeAgentTeam]
debug = false                        # debug logging (model decisions, config warnings, socket errors)
```

The legacy `settings.json` locations accept the same keys as JSON (omit null-valued keys there too):

```jsonc
{
  "stepcodeAgentTeam": {
    "members": { "max": 8 },
    "debug": false
  }
}
```

## Activation Mechanism (default off)

After the plugin loads, the team tools are declared unavailable (`pi.setUnavailableTools`): the model cannot see them, they do not appear in the system prompt, and no socket, timer, or member process is created. Two trigger modes:

1. **Slash command `/agent-team`**: invoking the command activates the plugin and shows the team board.
2. **Natural language**: a prompt whose text matches `activation.keywords` (case-insensitive) activates the plugin.

Once activated: the tools are released, the message service starts, idle reaping starts, and it stays sticky until the session ends. When `activation.enabled: false`, neither trigger works, and `/agent-team` reports that it has been disabled by configuration.

## `models` Section Semantics

**Model resolution** (the leader's current model = the model the session is using):

| `autonomousSelection` | Behavior |
|---|---|
| `false` (default) | All members **are forced onto the leader's current model**; preset models and the explicit `model` parameter are ignored (recorded in the debug log) |
| `true` | Resolution chain: explicit `model` → preset role model → leader's current model. If the explicit parameter is not in `available` → **error listing the available models**; if the preset model is not in the list → fall back to `available[0]` |

**Thinking effort resolution** (valid levels: `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`):

| `autonomousThinking` | Behavior |
|---|---|
| `false` (default) | Member thinking effort **defaults to `high`**; the explicit `thinking` parameter of `team_create_member` can override it |
| `true` | The tool description tells the leader LLM it may choose per member from the valid levels; an explicit `thinking` is adopted; when unspecified it is still `high` |

Note: member processes now carry `--thinking high` by default (previously it was not passed, and step's default level was used), so a single run costs slightly more than before; use the `thinking` parameter to lower it as needed.

## `topology` Section Semantics

Member-to-member messaging defaults to a **star**: everything is relayed through the leader, and members cannot communicate directly. After the leader declares a topology matching the task structure with the `team_set_topology` tool, members may communicate directly only along the declared edges; out-of-bounds messages are rejected by the team-server, which reports the available neighbors.

| Shape | Edges | Fits |
|---|---|---|
| `star` (default) | none | Independent parallel strands that the leader merges |
| `pipeline` | m1→m2→…→mn (in member creation order) | Sequential refinement pipeline |
| `mesh` | all ordered pairs | Peers cross-checking each other |
| `ring` | mi→mi+1 (last wraps to first) | Round-robin pipeline |
| `custom` | explicit edge list `[{from, to}]` | Precise control |

- `topology.default`: the default shape for new teams before the leader declares one (default `star`).
- `topology.requireDeclaration`: when `true`, `team_send` / `team_task` / oneshot are all rejected until `team_set_topology` has explicitly declared the topology — literally enforcing "design the topology before work" (default `false`; the star is always available).
- `topology.maxLoopCount`: the max hop count for member-to-member message chains. A leader→member dispatch counts as chain length 0, and each member forward adds 1; if the next hop would push the chain length over the limit (limit ≠ 0), the message is rejected by the team-server and the sender is told to report to the leader instead — which also prevents ring-circulation deadlocks (the sender holds a running slot while waiting, and the target queues waiting for a slot). Default `2`; `0` = unlimited; valid range 0–64; the manager layer has an additional fallback check before nested dispatches.

Members learn their notifiable neighbors dynamically via `stepcode-team status` (the server returns the `mayMessage` list based on the sender's identity).

## Recursion Depth and Concurrency Limits

**`members.maxRecursionDepth` (default 1)** — the maximum team-tree depth (leader session = 0, its members = 1):

| Value | Behavior |
|---|---|
| `1` (default) | Members cannot form teams: members start with `--no-extensions`, and the extension is fully inert in their sessions (zero context overhead) |
| `2` | Members can form their own sub-teams: the member process loads this extension and activates automatically (granted by the parent via env), and its sub-members are at depth 2 |
| `3` / `4` | And so on (config cap 4, to prevent runaway costs) |

Implementation notes (all handled in code and environment variables, not consuming model context): depth is propagated level by level via `STEPCODE_TEAM_DEPTH`; in a session that has reached the depth cap, the extension factory returns directly — no tools registered, no hooks attached, no service started; a sub-leader's team is an **independent team** (independent registry and socket), and sibling messaging is still constrained by the parent topology.

**`dispatch.maxConcurrent` (default 5)** — the cap on simultaneously running members. Dispatch (`team_send` / `team_task` / oneshot) acquires a running slot **before starting the member process**: dispatches beyond the cap queue, and the member is started only when its turn comes and a slot is free — i.e., "some sub-agents wait for other sub-agents to finish before starting". `team_create_member` still starts the member process immediately (idle and standing by); the cap constrains the number of members that are "working".

## Examples

**Default (zero config needed)**: no config file needed — activation is off by default, members use the leader's model, thinking effort high, spend threshold $1.

**Multi-model autonomy (the leader picks models per task)**:

```json
{
  "models": {
    "available": ["step-5-preview"],
    "autonomousSelection": true,
    "autonomousThinking": true
  },
  "dispatch": { "maxConcurrent": 6 }
}
```

**Conservative (disable keyword activation; only `/agent-team` counts; turn off the spend warning)**:

```json
{
  "activation": { "keywords": [], "notifyOnActivate": false },
  "cost": { "warnThreshold": 0 }
}
```

**Debug**:

```json
{ "debug": true }
```

Equivalent to running `export STEPCODE_TEAM_DEBUG=1` before the run.
