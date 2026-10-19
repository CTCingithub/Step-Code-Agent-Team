# Architecture

> [简体中文 →](./ARCHITECTURE_ZH.md)
> This document describes Step-Code-Agent-Team's component structure, data flow, and directory layout, based on the current `extensions/` implementation.
> Protocol details (RPC / socket / registry schema / tool contracts) are in [PROTOCOL.md](PROTOCOL.md); testing methodology is in [TESTING.md](TESTING.md).

## 1. Component overview

```
Leader session (step, loads this extension)
│
├── extensions/index.ts      entry: load config → depth gate → register 6 tools →
│                            setUnavailableTools closes the gate (off by default);
│                            activation triggers: /agent-team command, input hook, before_agent_start hook,
│                            STEPCODE_TEAM_AUTOACTIVATE (sub-leader grant)
├── extensions/config.ts     config: the stepcodeAgentTeam section of settings.json (defaults < legacy files < settings.json section < environment overrides); validation and caching
├── extensions/activation.ts activation gate: keyword/command detection, tool release
├── extensions/tools.ts      6 LLM tools (create_member / send / task / set_topology / disband / status)
├── extensions/members.ts    TeamManager: member lifecycle, concurrency gate, task-board dispatch, topology methods,
│                            per-member spawn mutex, kill on failure, oneshot, idle reaping
├── extensions/rpc-client.ts JSONL RPC client (strict \n line splitting, id correlation, handshake, abort, killAndWait)
├── extensions/team-server.ts Unix socket server: topology enforcement + status(mayMessage)
├── extensions/topology.ts   five-shape topology construction/validation/parsing
├── extensions/registry.ts   team state persistence (atomic write, storage.dir, legacy compatibility)
├── extensions/presets.ts    agents/*.md preset loading, extension entry path, shim path
├── extensions/render.ts     TUI rendering (renderCall / renderResult)
│
├── bin/stepcode-team.mjs    member-side CLI shim (msg / status, carries sender identity)
└── agents/                  role presets (scout · planner · worker · reviewer)
```

Members are independent `step --mode rpc` subprocesses that do not load this extension (unless granted a sub-team, see §4),
and can only reach the socket inside the leader process via the shim — this is the natural chokepoint for topology enforcement.

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

Task board: `team_task create` (validateGraph rejects cycles/unknown dependencies → recomputeReady) →
`start` (only `ready` can be dispatched, assignee required, retries `dispatch.retries` times) →
on success `completeTask` (unlocks downstream), and on exhausted retries `failTask`.

Member-to-member messaging: member bash → `node bin/stepcode-team.mjs msg --to B --message ...` →
socket → server checks topology edge A→B → `manager.sendMessage(B, msg, {nested:true})` → the reply returns over the same connection.
The shim is invoked through a shell: when a member's tool allowlist lacks `bash` (e.g. the scout/planner/reviewer presets) it cannot send messages,
and `team_set_topology` and `team_create_member` results warn about this; the leader relays as a fallback.

## 3. Persistence layout

```
<agentDir>/teams/<teamId>/
  registry.json     team state (schemaVersion 1; atomic write: tmp + rename, mode 0600)
  sessions/         member session files (--session-dir; the carrier for context continuation)
  prompts/          member system prompts (include the coordination section; reused via --append-system-prompt on respawn)
  sock              Unix socket (mode 0600, only the owner may connect)
```

`<agentDir>` follows `STEP_CODING_AGENT_DIR` (default `~/.stepcode/agent`), so the sandbox is isolated from the real environment;
`storage.dir` can redirect it wholesale. teamId is derived from the leader session's filename (sessions with an eph- prefix cannot be re-attached).

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
| Concurrency cap | members.ts acquireSlot/releaseSlot |
| Topology enforcement | team-server.ts handle + members.ts mayMessage |
| Recursion depth | index.ts depth gate + members.ts buildSpawnArgs |
| Socket permissions | team-server.ts chmod 0600 after listen |
| Cost warning | tools.ts costWarning (config.cost.warnThreshold, 0 disables) |
| Idle reaping | members.ts reapIdleMembers (skips members with queued dispatches) |
| Member slots (live count only) | members.ts createMemberLocked (dead records are resumable but do not occupy a slot) |
| Messaging capability notice | members.ts memberCanMessage / messagingWarnings + tools.ts result text |
| Shutdown cleanup | index.ts session_shutdown → manager.shutdown (set all dead + kill) |

## 6. Related documents

- [PROTOCOL.md](PROTOCOL.md): RPC commands/events, socket protocol, registry schema, tool contracts
- [CONFIGURATION.md](CONFIGURATION.md): config reference
- [TESTING.md](TESTING.md): four-layer testing methodology
- [../README.md](../README.md): usage instructions
