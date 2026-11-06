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

### Editing config (read this before you debug a "my edit did nothing")

**The global table lives at `dirname(STEP_CODING_AGENT_DIR)/config.toml`** — beside the agent dir, not inside it. In the sandbox that is `sandbox/config.toml` (the agent dir is `sandbox/agent`); on a normal install it is `~/.stepcode/config.toml`. There is no `sandbox/agent/config.toml`.

**Config is read once, when the leader process loads the extension.** An edit made while a session is running never lands in that session — not because the file is wrong, but because nothing re-reads it. Restart the session (or `/reload`, which also returns the plugin to its default-off state).

**To confirm which file was read and what the effective values are**, run with `STEPCODE_TEAM_DEBUG=1`: on activation the plugin traces `config: unified=<path> topology.maxLoopCount=… dispatch.timeoutMs=… members.max=… plan.enabled=… plan.tier=…`, and every read of that file is traced too. A successful read is traced as well as a failure, so you can tell "I read your file and it says 2" from "I never opened that path".

Sandbox gotcha: `sandbox/config.toml` also **shadows the `cfg-*` probe fixtures** for anything that resolves its global config there (see [TESTING.md](TESTING.md) Layer C) — keep probe runs isolated when you rely on a fixture.

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
autonomousEffort = false              # true = the leader picks the effort per member

[stepcodeAgentTeam.members]
max = 8                              # live-member cap (1–64)
defaultRole = "worker"               # default role for new members
# defaultTools omitted (null) = preset allowlist or all tools
maxRecursionDepth = 1                # team-tree depth bound (1–4)

[stepcodeAgentTeam.dispatch]
maxConcurrent = 5                    # parallel member cap (1–16); extra dispatches queue
timeoutMs = 600000                   # per-dispatch timeout (ms) — covers the member's whole turn, nested relays included
handshakeTimeoutMs = 15000           # member spawn handshake timeout
retries = 1                          # retries only dispatches that never started (0–5)

[stepcodeAgentTeam.oneshot]
timeoutMs = 600000                   # stateless dispatch timeout

[stepcodeAgentTeam.cost]
warnThreshold = 1                    # cumulative spend warning (USD); 0 = off

[stepcodeAgentTeam.idle]
reapAfterMs = 1800000                # idle reaping threshold (30 min)
reapIntervalMs = 300000              # reaping check interval (5 min)

[stepcodeAgentTeam.storage]
# dir omitted (null) = <agentDir>/teams
# dir must be an absolute path: a relative value resolves against the launching process's cwd (registry.ts teamsRoot), not <agentDir>

[stepcodeAgentTeam.tasks]
max = 999                           # task-board capacity (ids T1..T<max>; 1–10000)
outputCapBytes = 51200              # per-task output truncation (bytes); the full text stays in details.fullText

[stepcodeAgentTeam.topology]
default = "star"                     # star/pipeline/mesh/ring/custom
requireDeclaration = false           # true = no dispatch before the topology is declared
maxLoopCount = 2                     # ring message-chain bound (0 = unlimited, 0–64); counts the nesting depth of relays inside ONE leader dispatch

[stepcodeAgentTeam.plan]
enabled = false                      # team-plan picker: economic/fast/balanced/performance + custom on activation
tier = "always ask"                  # always ask = picker every time; a pinned tier applies directly (no picker, no confirmation)

[stepcodeAgentTeam.presets.effort]
scout = "low"                        # per-role effort overrides (custom roles: set effort in their own frontmatter)
planner = "medium"                   # ignored while models.autonomousEffort is on (the leader picks)
worker = "medium"
reviewer = "high"
searcher = "medium"                  # the searcher role (added in v0.4.0)

[stepcodeAgentTeam.searcher]           # endpoints/credentials for the searcher role (added in v0.4.0)
searchUrl = ""                        # empty = the host search_web default
searchApiKey = ""                     # empty = the login profile / STEPCODE_SEARCH_API_KEY
fetchUrl = ""                         # empty = a plain unauthenticated request to the target URL
fetchApiKey = ""                      # empty = no Authorization header
#
# What "empty" means depends on which consumer you mean, and the two differ:
# the ROLE falls back to the host tools (search_web's own credential
# resolution for search, a plain curl for fetch), while the SCRIPT
# (bin/topo-search.mjs) falls back to its built-in DeepSeek endpoints and
# DEEPSEEK_API_KEY. Setting the keys is what makes a non-default provider real
# for both.
#
# These four keys are the whole point: the searcher role is NOT tied to one
# provider. Point searchUrl/fetchUrl at any endpoint that speaks the script's
# JSON contract ({query,count,need_content} → {results}; {url} → {title,content})
# and set the matching key here. The leader injects them into member processes
# as STEPCODE_TOPO_SEARCH_URL / _SEARCH_KEY / _FETCH_URL / _FETCH_KEY, plus
# STEPCODE_SEARCH_API_KEY for the host search tool and
# STEPCODE_TOPO_SEARCH_SCRIPT pointing at the script itself.

[stepcodeAgentTeam.encryption]         # at-rest encryption of the team registry (added in v0.4.0, on by default)
enabled = true                        # AES-256-GCM; key in .topo/team.key (0600)

[stepcodeAgentTeam.records]            # collaboration records (added in v0.4.1)
enabled = true                        # write one record to .topo/records after every team task
dir = "records"                       # sub-directory of .topo/

[stepcodeAgentTeam]
debug = false                        # debug logging
```

## Options at a Glance

| Section | Controls |
|---|---|
| `activation` | Default-off gate: the `/topo` command (`/topo off` deactivates and re-hides the tools) or a keyword mention (case-insensitive) activates the plugin; sticky for the session. With `enabled: false` neither trigger works and the command reports the config disable. Deprecated keywords (the old "agent team" / "智能体团队" style terms) are stripped from the effective list on load — forced migration, reported once on activation. If every configured term is deprecated the effective list becomes empty and keyword activation stays off until you set plugin-specific keywords. `guardEnabled` / `confirmBeforeActivate` / `headlessAutoActivate` layer the false-trigger guard — slash commands bypass it |
| `models` | Member model pool. `autonomousSelection` off (default) pins every member to the conversation model (preset/explicit `model` ignored); on, resolution is explicit `model` → preset → conversation model (unknown explicit model errors with the available list; unknown preset model falls back to `available[0]`). `autonomousEffort` off resolves effort as: explicit param → `presets.effort` override → preset frontmatter `effort` → `high`; on lets the leader choose per member (all preset efforts inert) |
| `members` | `max` counts **live** members only (dead records stay resumable without occupying a slot). `maxRecursionDepth`: 1 = members cannot spawn sub-teams (fully inert in their sessions); 2+ grants sub-leaders their own independent team (registry + socket), bounded at 4 |
| `dispatch` | `maxConcurrent` gates **before process start** (queue-before-start); oneshot dispatches share the budget; nested member-to-member relays bypass the global gate to avoid chain deadlock |
| `oneshot` | Timeout for stateless `mode: "oneshot"` dispatches |
| `cost` | Team-level cumulative spend warning; 0 disables |
| `idle` | Idle members are reaped (sessions stay resumable); running members are never reaped |
| `storage` | Team data root (registry, sessions, prompts, socket); null = `<agentDir>/teams`. A **relative** `dir` resolves against the **agent dir** (not the launch directory — the leader's cwd is arbitrary and members inherit it, so anchoring there scattered one team's registries across projects); absolute paths are used as-is |
| `tasks` | `max` sizes the task board (ids T1..T<max>; creating past the cap errors with the configured limit); `outputCapBytes` truncates the model-visible per-task output — the full text stays in `details.fullText` |
| `topology` | Member-to-member messaging is denied unless a declared edge allows it. `requireDeclaration` enforces "design before work". `maxLoopCount` bounds chain length (leader dispatch = 0, each forward +1); a hop over the limit is rejected and the sender states it in their final report — which also prevents ring-circulation deadlocks. Members message teammates through the built-in `topo_team_msg` tool (no bash needed — read-only roles included), so edges are usable for every role; express dependencies via the task board's `blockedBy` |
| `plan` | Team-plan picker (default off): on activation the leader offers economic/fast/balanced/performance *strategies* plus a custom flow (size → topology → effort). With a request attached, the model first drafts the ACTUAL plan for that request (a one-off, plan-only call with a spinner progress) and the Accept/Cancel selection shows that plan — on approval it is injected with precedence over the general strategy; bare `/topo` (no request) or a failed planning call falls back to the tier's standard shape. `tier = "always ask"` (default) shows the picker; a pinned tier applies directly on every activation (command and keyword paths) — a pin means "stop asking": neither the picker nor the three-option confirmation appears (the planning call and the confirmation happen only on the picker or the explicit `/topo <tier>` path); `/topo <tier>` overrides per invocation (still goes through the actual-plan confirmation). Picker timeout / headless falls back to `balanced`; options are localized; no cost multipliers |
| `presets.effort` | Per-role effort overrides (built-in role names shown; custom roles set `effort` in their own frontmatter). Resolution: explicit `effort` param → this config → preset frontmatter → `high`. Inert while `models.autonomousEffort` is on. Presets ship with the package (`agents/<role>.md`: scout/planner/worker/reviewer) and can be shadowed or extended by `<agentDir>/agents/` and a trusted project's `<project>/.stepcode/agents/` — see [docs/ROLES.md](ROLES.md) |
| `debug` | Diagnostic logging to stderr |

Topology shapes (declared with `team_set_topology` after creating members, before dispatching):

| Shape | Edges | Fits |
|---|---|---|
| `star` (default) | none | Independent parallel strands the leader merges |
| `pipeline` | m1→m2→…→mn (member creation order) | Sequential refinement |
| `mesh` | all ordered pairs | Peers cross-checking each other |
| `ring` | mi→mi+1 (wraps to first) | Round-robin review |
| `custom` | explicit `[{from, to}]` list | Precise control |

Members learn their notifiable neighbors dynamically: a `topo_team_msg` rejection lists the allowed teammates (the server returns the `mayMessage` list for the sender's identity), and `stepcode-team status` reports the same from a shell.

## Automatic compaction (`[compaction]`, Step Code 0.1.7)

Step Code compacts a session's context automatically when it approaches the
model's window. Since 0.1.7 the trigger is a **ratio of the context window**
rather than a fixed reserve, and it is configurable in Step Code's own unified
config — **not** in this plugin's table:

```toml
[compaction]
triggerPolicy = "v2"            # or "legacy" (the old fixed-reserve behaviour)
triggerRatio = 0.9              # 0 < ratio <= 0.95; default 0.9
modelTriggerRatios = { "step/step-5-preview" = 0.8 }   # per provider/model override
tokenLimit = 120000             # absolute ceiling; can only trigger EARLIER
```

Invalid values fall back to the defaults and are reported as settings
diagnostics — they never fail the run.

**Why this matters to a team**: members are spawned with the leader's
environment (`STEP_CODING_AGENT_DIR` included), so they read the **same** global
`config.toml` as the leader. Whatever you set here applies to the leader and to
every member alike — there is no plugin-level key to set, and adding one would
only create two sources of truth for the same behaviour. A probe pins the
inheritance so a future refactor cannot quietly break it (phase32, "spawn env").

The old fixed reserve triggered at ~74% of a 64K window but ~98% of a 1M window;
the ratio default of 0.9 leaves headroom on both. Lower `triggerRatio` (or set
`tokenLimit`) to compact earlier on long team runs, where a member's report plus
the task board can fill a window quickly.

## `.topo/` and at-rest encryption (v0.4.0)

**What `.topo/` is**: the plugin's working directory inside your current
workspace. It is created on first activation (the plugin is default-off, so an
inactive session leaves nothing in your tree) and registered in an **existing**
`.gitignore` — if there is no `.gitignore`, none is invented. It currently holds
one file: `team.key` (the encryption key, 32 bytes base64, mode 0600).

**What is encrypted**: the team registry `registry.json` — its
`tasks[].title/detail/result` carries full member reports and is the most
sensitive payload the plugin owns. AES-256-GCM, with an envelope carrying
`iv/tag/data` plus a plaintext `teamId`/`cwd` header (cwd is not sensitive and
is what lets a reader locate the key). `encryption.enabled = false` writes
plaintext.

**The boundaries (do not oversell this)**:
- it protects against OTHER USERS reading the file, and against the file being
  committed or backed up in the clear;
- it does NOT protect against a same-uid attacker, who reads the key file too;
- it does NOT cover the host-written member session JSONL (mode 0644, outside
  the plugin's reach) — that remains the largest real exposure;
- losing the key means the data is unrecoverable;
- plaintext registries written by older versions still load (an envelope is
  decrypted, anything else is read as-is).

**Degrade paths**: `.topo` already exists as a file, is a symlink (not followed
— writing key material through a link we did not create would leak it to an
arbitrary path), a read-only parent, or an over-long path. All of them degrade:
the team keeps running without at-rest encryption and one line is logged.

### Collaboration records (`.topo/records/`)

After every team task ends — a whole-team `team_disband`, a `/topo off` deactivation, or a shutdown fallback when the session ends with the team still live — the plugin writes one record to `.topo/records/<teamId>-<UTC stamp>.json` plus a same-named Markdown summary. Contents: the member roster (role/model/effort/tools/status/turns/cost), the whole task board (status/assignee/dependencies), the topology in force at close, cumulative spend and summary counts. **Idempotent**: a team never gets a second record.

Whether it is encrypted follows YOUR option: `encryption.enabled` with a key available means the same AES-256-GCM envelope as the registry; anything else is plaintext. `records.enabled = false` turns records off entirely. Same degrade rule: an unwritable record is logged and forgotten — it never blocks a disband or a deactivation.

## Environment Overrides

| Variable | Purpose |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | Equivalent to `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | Overrides `cost.warnThreshold` (invalid values ignored) |
| `STEPCODE_TEAM_MAXDEPTH=<n>` | Overrides `members.maxRecursionDepth` (1–4; invalid values ignored); the leader injects the effective value into sub-member processes |
| `STEPCODE_TEAM_SOCK` | Injected automatically by the leader into member processes, pointing at the team service socket (no manual setup needed) |
| `STEPCODE_TOPO_SEARCH_URL` / `STEPCODE_TOPO_FETCH_URL` / `STEPCODE_TOPO_FETCH_KEY` / `STEPCODE_TOPO_SEARCH_KEY` / `STEPCODE_SEARCH_API_KEY` / `STEPCODE_TOPO_SEARCH_SCRIPT` | Injected automatically by the leader into member processes from `[stepcodeAgentTeam.searcher]` (the searcher role reads them by name; see `docs/ROLES.md`). The configured key arrives under both `STEPCODE_TOPO_SEARCH_KEY` (the script's own name) and `STEPCODE_SEARCH_API_KEY` (the host `search_web` tool's name), and the script's path is only injected when the searcher config is actually configured. Set them by hand only to test `bin/topo-search.mjs` directly |
| `STEPCODE_SEARCH_API_KEY` | Injected by the leader when the searcher `searchApiKey` is set; also the host `search_web` tool's own credential key |

## Notes

- **First-activation seed**: when the plugin is first activated in a session and your global config has no `stepcodeAgentTeam` table, a commented defaults block is appended to `config.toml`. It is comments only (defaults keep applying) — uncomment to override, or delete the block.
- **The `default` marker**: keys shown as `"default"` mean *use the built-in default*, and the loader resolves them to it. This is what makes a seeded config survive an upgrade: a literal would pin the value you had when you seeded, and silently outrank the new version's default forever. `DEFAULT` follows the default instead, for every type at once — a number, a boolean, an array or a string (verified against all 27 keys). Omitting the key does the same thing, so `DEFAULT` is documentation you can uncomment safely.
- **`"default"` is a reserved token — keep the quotes.** A bare `default` (no quotes) is not a TOML scalar: step's config reader then drops the **whole table**, silently taking every real setting in it with them. The plugin cannot detect this, because the table is gone before our code runs, and the config warnings are debug-only — so nothing will tell you. The quotes are what make it a string the loader can recognise. Verified against step's own reader: `max = "default"` parses and resolves to the built-in default with the rest of the table intact, while `max = default` (bare, either case) drops the table.
- **Upgrades add the new options**: every section in the block carries the plugin version that documented it. After you install a newer version, the next activation appends just the sections that are new or changed — never a second copy of the whole block, and never over anything you wrote. A section you already have counts as documented whether it is a commented reference or an active table you configured yourself, so an old install is not duplicated; a section marked at an older version is refreshed so new keys inside it appear. Everything stays comments until you uncomment it.
- **Known compromise**: tool description strings fixed at registration (e.g. the model list) and the depth gate (`maxRecursionDepth`) do not refresh when a project-level override is applied mid-session; the effective depth bound is propagated to sub-members via `STEPCODE_TEAM_MAXDEPTH`, and description changes take effect next session.
- **Scope**: these settings govern the team plugin only. The built-in subagent extension (`subagent` / `agent_send` tools) has its own settings and lifecycle; team role presets and subagent agent definitions are discovered from the same directories but parsed independently. For a personal in-session checklist use the built-in `task_*` tools — the team board is the shared, cross-member board.
- **Sandbox isolation**: `STEP_CODING_AGENT_DIR` moves both the agent dir and the global config root, so the sandbox never touches your real configuration.
