# Architecture

> [简体中文 →](./ARCHITECTURE_CN.md)
> This document describes Step-Code-Agent-Team's component structure, data flow, and directory layout, based on the current `extensions/` implementation.
> Protocol details (RPC / socket / registry schema / tool contracts) are in [PROTOCOL.md](PROTOCOL.md); testing methodology is in [TESTING.md](TESTING.md).

## 1. Component overview

```
Leader session (step, loads this extension)
│
├── extensions/index.ts      entry: load config → depth gate → register 6 tools →
│                            setUnavailableTools closes the gate (off by default);
│                            activation triggers: /topo command, input hook, before_agent_start hook,
│                            STEPCODE_TEAM_AUTOACTIVATE (sub-leader grant)
├── extensions/config.ts     config: the [stepcodeAgentTeam] table of the unified config.toml (defaults < global < project < environment overrides); validation, caching, first-activation seeding, and searcherSpawnEnv (the searcher config → member-spawn env mapping)
├── extensions/activation.ts activation gate: keyword/command detection, tool release
├── extensions/forward.ts    team-request instructions injected into the model's context (first-person framing, coordination protocol)
├── extensions/plan.ts       team plan tiers (tier strategy prompts, picker options, pinned tier)
├── extensions/tools.ts      6 LLM tools (create_member / send / task / set_topology / disband / status)
├── extensions/tasks.ts      task-board dependency graph (validateGraph / recomputeReady / assertDispatchable)
├── extensions/members.ts    TeamManager: member lifecycle, concurrency gate, task-board dispatch, topology methods,
│                            per-member spawn mutex, kill on failure, oneshot, idle reaping, searcher env injection
├── extensions/rpc-client.ts JSONL RPC client (strict \n line splitting, id correlation, handshake, abort, killAndWait)
├── extensions/team-server.ts Unix socket server: topology enforcement + status(mayMessage)
├── extensions/topology.ts   five-shape topology construction/validation/parsing
├── extensions/registry.ts   team state persistence (atomic write, storage.dir, legacy compatibility, at-rest encryption)
├── extensions/crypto.ts     AES-256-GCM envelope for the registry (key in .topo/team.key, 0600; plaintext still readable)
├── extensions/topo-init.ts  the .topo/ workspace, created on first activation (never at load time); symlink-safe, degrades instead of throwing
├── extensions/collab-record.ts collaboration records under .topo/records/ after every team task (idempotent per teamId, sealed or plaintext per the encryption config, never blocks a disband)
├── extensions/presets.ts    preset loading (bundled + user/project agents/ dirs), extension entry path, shim path, searcher script path
├── extensions/member-messaging.ts member-side topo_team_msg tool (direct socket, no bash)
├── extensions/team/naming.ts   member-name and session→team-id rules (MEMBER_NAME_RE, teamIdForSession)
├── extensions/team/errors.ts   dispatch error classification: what may be retried, and why
├── extensions/team/spawn.ts    member spawn as pure functions: args, env, model and effort resolution
├── extensions/members.ts       TeamManager: member/task/topology orchestration (re-exports the team/ rules)
├── extensions/render.ts     TUI rendering (renderCall / renderResult)
│
├── bin/stepcode-team.mjs    member-side CLI shim (msg / status; manual/external path — members normally use the topo_team_msg tool)
├── bin/topo-search.mjs      the searcher role's retrieval script: search / fetch / batch against the endpoint
│                            configured in [stepcodeAgentTeam.searcher] (any provider speaking its JSON contract;
│                            DeepSeek's /v1/tools endpoints are only the defaults). Billing-honest: a 4xx is never
│                            retried, because providers charge successful calls only. Exit 0 success / 1 request
│                            failed / 2 usage error (a missing key is 2, not 1).
└── agents/                  bundled role presets (scout · planner · worker · reviewer · searcher; custom roles: <agentDir>/agents/, <project>/.stepcode/agents/)
```

Members are independent `step --mode rpc` subprocesses that do not load this extension (unless granted a sub-team, see §4),
and can only reach the socket inside the leader process via the topo_team_msg tool (or the CLI shim) — this is the natural chokepoint for topology enforcement.

## 2. Data flow

```
Leader dispatch (team_send / team_task start)
  → dispatch: assertTopologyDeclared
  → acquireSlot (global concurrency gate, except nested member-to-member messages — the sender already holds a slot; taking another would deadlock)
  → ensureLive (spawning map dedup: concurrent requests for the same member start only one process; a retry after failure resumes the conversation with the same session-id)
  → runDispatch: member.status=running → promptAndSettle (wait for agent_settled)
       ├── success: usage accumulates → status=idle → save
       └── failure: status=dead → killAndWait (prevents old and new runs from interleaving on the same session-id) → throw
  → releaseSlot
```

### The prompt-to-settle path, and why it is probed with a fake model

`promptAndSettle` waits for exactly one event: `agent_settled`, which upstream
emits only when an agent run actually ends. The `prompt` command's own ack is
**not** that event — `rpc-mode.ts` answers it from `preflightResult`, long
before the run finishes. So a member that loads fine and passes preflight but
never *enters* a run produces no settle event at all, and the leader waits out
its full `dispatch.timeoutMs` while the member sits there alive and writing
files. That is the whole of the recurring `timeout waiting for member to
settle` degradation, and `dispatchWithSettleGuard` is what tells the two apart:
when the usage delta is zero it re-reads the timeout as a member that never ran
and names the setup causes (a model outside `models.available`, an unbound
extension) instead of implying the run was slow.

Because that path needs a model call, no zero-token probe used to walk it — the
failure was invisible to the gate and only showed up when it cost money.

**Where the degradation actually lives.** Probing it showed this plugin's
dispatch is sound in every configuration measured: a fake endpoint (45 ms), the
real provider with a short prompt (2.4 s), the real provider with a long prompt
that used its tools (10.2 s, five rounds), a bare member (864 ms), and a member
with this whole plugin loaded (880 ms). The 39 settle timeouts in the session
that motivated this work all came from the **harness's** team-member mechanism,
not from code here. Two facts settle it: `buildSpawnArgs` emits
`--no-extensions -e <member-messaging.ts>`, so a member loads only the messaging
shim and never the full plugin — activating it inside a member was never the
cause; and the member's stderr used to be **discarded outright**, which is why
the failure was undiagnosable for as long as it was. `MemberRpc` now keeps a
bounded stderr tail and the zero-delta timeout quotes it.

`test/smoke/phase34.ts` closes the blind spot: a local HTTP server speaking the OpenAI Chat
Completions SSE contract, which the member is pointed at through
`STEP_PROVIDER_API_URL` (the step provider's API is `openai-completions`, its
base derived as `{apiBaseUrl}/v1`) and which it inherits through
`memberSpawnEnv`. Part A proves a member really runs a turn and settles for
free; Part B reproduces the degradation itself — an endpoint that accepts the
request and never answers — and asserts the gate notices. The host's built-in
`faux` provider cannot stand in here: it is a test-harness facility and is not
registered in the runtime model table.


Task board: `team_task create` (validateGraph rejects cycles/unknown dependencies → recomputeReady) →
`start` (only `ready` can be dispatched, assignee required, retries `dispatch.retries` times) →
on success `completeTask` (unlocks downstream), and on exhausted retries `failTask`.

Member-to-member messaging: member `topo_team_msg` tool → socket → server checks topology edge A→B →
`manager.sendMessage(B, msg, {nested:true})` → the reply returns over the same connection. The tool is
registered by the member-side messaging extension (extensions/member-messaging.ts) and speaks the same
JSONL protocol as the `stepcode-team` CLI shim — without a shell, so read-only presets keep their
posture and their topology edges stay usable. The shim remains for manual/external use.

## 3. Persistence layout

```
<agentDir>/teams/<teamId>/
  registry.json     team state (schemaVersion 1; atomic write: tmp + rename, mode 0600)
                    — encrypted at rest by default (AES-256-GCM envelope); a
                      plaintext registry still loads, so teams created before
                      encryption existed keep working
  sessions/         member session files (--session-dir; the carrier for context continuation)
  prompts/          member system prompts (include the coordination section; reused via --append-system-prompt on respawn)
  sock              Unix socket (mode 0600, only the owner may connect)

<cwd>/.topo/                     created on first activation, never at load time
  team.key           the encryption key, mode 0600 (absent → plaintext degrade, never a throw)
  records/           one collaboration record per team task (idempotent per teamId)
  .gitignore         appended, never rewritten, so the workspace stays out of git
```

`<agentDir>` follows `STEP_CODING_AGENT_DIR` (default `~/.stepcode/agent`), so the sandbox is isolated from the real environment;
`storage.dir` can redirect it wholesale. teamId is derived from the leader session's filename (sessions with an eph- prefix cannot be re-attached).

The two stores are deliberately separate: `<agentDir>/teams/` is machine-local runtime state, while `.topo/` is the project-local workspace the plugin owns. `.topo/` is only ever appended to an existing `.gitignore` (a symlinked `.topo` is not followed, and every degrade path returns instead of throwing), so a repository that already ignores the right paths is left untouched.

## 4. Depth and concurrency

- **Recursion depth**: leader = 0, member = 1 (`STEPCODE_TEAM_DEPTH` increments by one per level). When a sub-member's depth
  is `< maxRecursionDepth` it is granted a sub-team: the spawn arguments add `-e extensions/index.ts` and
  `STEPCODE_TEAM_AUTOACTIVATE=1` (the sub-leader auto-activates); a member that reaches the cap is fully
  isolated with `--no-extensions` (the extension factory returns directly, zero context overhead).
- **Concurrency**: `dispatch.maxConcurrent` (default 5) is a global semaphore applied before process startup — beyond it, requests queue,
  and a member process is not started until a slot frees; each member also has a serialized queue (a member's prompts run one after another).
  Member-to-member messages (nested) bypass the global gate, avoiding a "A holds a slot waiting for B, B waits for a slot" deadlock.

## 5. Guardrail map

| Guardrail | Implementation |
|---|---|
| Default-off activation | activation.ts (setUnavailableTools gate + release on activation) |
| Spawn race mutex | members.ts `spawning` map + `memberLocks` serialization |
| Kill on failure | members.ts runDispatch catch → killAndWait |
| Dispatch failure context | members.ts augmentDispatchError (mid-run failures note in-flight relays + roster) |
| Concurrency cap | members.ts acquireSlot/releaseSlot |
| Topology enforcement | team-server.ts handle + members.ts mayMessage |
| Recursion depth | index.ts depth gate + members.ts buildSpawnArgs |
| Socket permissions | team-server.ts chmod 0600 after listen |
| Cost warning | tools.ts costWarning (config.cost.warnThreshold, 0 disables) |
| Idle reaping | members.ts reapIdleMembers (skips members with queued dispatches) |
| Member slots (live count only) | members.ts createMemberLocked (dead records are resumable but do not occupy a slot) |
| Shutdown cleanup | index.ts session_shutdown → manager.shutdown (set all dead + kill) |

## 6. Related documents

- [PROTOCOL.md](PROTOCOL.md): RPC commands/events, socket protocol, registry schema, tool contracts
- [CONFIGURATION.md](CONFIGURATION.md): config reference
- [TESTING.md](TESTING.md): four-layer testing methodology
- [../README.md](../README.md): usage instructions
