# Protocol reference

> [简体中文 →](./PROTOCOL_CN.md)
> This document codifies all of Step-Code-Agent-Team's wire protocols and tool contracts, based on the current `extensions/` and `bin/` implementation.
> Changing a protocol requires synchronously updating this document and the affected smoke probes.

## 1. Member RPC protocol (stdio JSONL)

A member is a long-lived `step --mode rpc` subprocess. The leader drives it over stdio (`extensions/rpc-client.ts`).

### 1.1 Framing rules

- One JSON object per line, **split only on `\n`** (Node's readline breaks lines at U+2028/U+2029,
  but those characters are legal inside JSON strings and would corrupt the protocol; both the client and the shim hand-write an `indexOf("\n")` buffer).
- Trailing `\r` is tolerated (`replace(/\r$/, "")`).
- A member's stdin must be a pipe (`["pipe","pipe","pipe"]`): `"ignore"` points stdin at /dev/null,
  so prompt writes are silently lost and the member reads EOF and exits.

### 1.2 Commands (leader → member, written to stdin)

| Command | Fields | Description |
|---|---|---|
| `prompt` | `{type:"prompt", message}` | Have the member run one turn; complete only when `agent_settled` fires |
| `abort` | `{type:"abort"}` | Cooperatively abort the current run (triggered by Esc / AbortSignal) |

Each request carries a client-incrementing `id` (`r1, r2, …`) used to correlate responses.

### 1.3 Responses and events (member → leader, stdout)

| Type | Key fields | Client handling |
|---|---|---|
| `response` | `{id, type:"response", command, success, data?}` | Fulfill/reject pending by id; `success:false` rejects |
| `entry_appended` | — | Treated as handshake completion |
| `message_end` | `{message:{role:"assistant", content:[{type:"text",text}], usage}}` | Accumulate usage; record the last assistant text; push to interim listeners (streaming progress) |
| `agent_settled` | — | Wake settleWaiter; promptAndSettle returns |
| Others | `tool_execution_*`, `extension_ui_request`, etc. | Ignored |

Handshake: after spawn, wait for the first `response`/`entry_appended` (default 15s timeout; on failure, kill without leaving orphans).
Shutdown: on process exit/error, failPending + flushWaiters + onClose (registry sets dead).

## 2. Team socket protocol (Unix socket JSONL)

The `TeamServer` inside the leader process (`extensions/team-server.ts`) listens on
`<agentDir>/teams/<teamId>/sock` (chmod 0600). Members connect via the shim;
the shim takes its identity and address from the spawn env: `STEPCODE_TEAM_SOCK`, `STEPCODE_TEAM_MEMBER`.

Requests (one JSON object per line):

```jsonc
// Send a message (from is auto-attached by the shim)
{"from": "<sender>", "to": "<member>", "message": "<text>"}
// Query status
{"from": "<sender>", "type": "status"}
```

Responses:

```jsonc
// Message success
{"ok": true, "reply": "<text>"}
// Status success
{"ok": true, "teamId": "...", "youAre": "<sender>", "mayMessage": ["<allowed>", ...],
 "members": [{"name","role","status"}], "tasks": [{"id","title","status","assignee"}]}
// Failure (topology rejection / unknown member / missing from / invalid JSON)
{"ok": false, "error": "<message>"}
```

Rules:

- **Topology enforcement**: if `mayMessage(from,to)` is false the message is rejected, and the error message includes the sender's available neighbors;
  under star (default) there is no direct member-to-member messaging — everything routes through the leader.
- **Ring chain-length enforcement**: before nested dispatch the server computes `next = currentChainLength(from) + 1`
  (leader dispatch = 0, +1 for each member relay); when `topology.maxLoopCount > 0` and `next` exceeds the cap
  the message is rejected and the sender is told to report to the leader. Nested dispatch carries `chainLength: next`, and the manager layer re-validates before dispatch
  as a backstop.
- **nested exemption**: server-brokered dispatches carry `nested:true` and bypass the global concurrency gate (the sender already holds a running slot),
  but the per-member serialized queue and topology gate still apply.
- Connection-level errors (a member hangs up mid-stream) are only recorded in the debug log and do not affect leader survival.

## 3. Registry schema (registry.json, schemaVersion 1)

```jsonc
{
  "schemaVersion": 1,
  "teamId": "<team id derived from the leader session>",
  "createdAt": 1710000000000,
  "cwd": "<leader working directory>",
  "members": [
    {
      "name": "scout1",                    // ^[a-z][a-z0-9_-]{0,31}$
      "role": "scout",
      "model": "step-5-preview",           // optional
      "thinking": "high",                  // optional
      "tools": ["read", "grep"],           // optional; default = all tools
      "sessionId": "team-<teamId>-scout1", // key for resuming the conversation on restart
      "systemPromptFile": "<teamDir>/prompts/scout1.md",
      "pid": 12345,
      "status": "idle",                    // idle | running | dead
      "usage": {"input": 0, "output": 0, "cost": 0, "turns": 0}
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "title": "...",
      "detail": "...",                     // optional
      "blockedBy": [],                     // DAG dependencies; cycles/unknown ids rejected
      "assignee": "scout1",                // optional
      "status": "ready",                   // pending | ready | running | done | failed
      "result": "..."                      // result/reason written in terminal state
    }
  ],
  "topology": {"shape": "star", "edges": [["m1", "m2"]]}
}
```

Compatibility rules: `schemaVersion !== 1` → treated as absent (returns null); a missing `topology` field → degrades to star;
atomic write (`tmp + rename`, mode 0600), so a leader crash at any moment never leaves a half-written file.

## 4. Leader-side LLM tool contracts (extensions/tools.ts)

Error convention: invalid input throws (tool result `isError`); a successful return carries no error flag.
Calling any team tool before activation throws "not active" (belt-and-suspenders: the tool is already declared invisible + a runtime assertion).

| Tool | Key parameters | Behavior |
|---|---|---|
| `team_create_member` | `name` required; `role`/`model`/`thinking`/`tools`/`systemPrompt` optional | Idempotent create/resume; a role hits the `agents/<role>.md` preset; explicit arguments take precedence over the preset; model resolution is in CONFIGURATION.md's `models` section; **config arguments passed on resume are ignored, and the result text lists them item by item**; when a member has no `bash` the result appends a message-channel-unavailable notice |
| `team_send` | `member`, `message` required; `taskId` or `mode` optional | Wait for the full reply; same member serialized, cross-member parallel; `taskId` dispatches as a task (running→done, retries `dispatch.retries` times on failure); `mode:"oneshot"` is a stateless one-off process; passing `taskId` and oneshot together throws; `dispatch.timeoutMs` covers the entire nested relay chain, and the timeout error notes that the relay may still be in flight and lists the member roster |
| `team_task` | `action` (create/start/complete/fail/list) + `id`/`title`/`blockedBy`/`assignee`/`result`/`reason` | DAG task board; terminal-state tasks can no longer be completed/failed |
| `team_set_topology` | `shape` (star/pipeline/mesh/ring/custom) + `edges` (required for custom) | Declare the topology after creating members and before dispatching; unknown members/self-loops throw; when an edge endpoint has no `bash` the result appends a warning (that edge is unusable and needs a leader relay) |
| `team_disband` | `member` optional | Omitting it disbands the whole team; sessions persist, and a rebuild resumes the conversation |
| `team_status` | none | Member status/usage + task board + cumulative spend (appends a warning above the threshold; threshold 0 disables) |

Output convention: member replies over 50KB are truncated, with the full text in the tool details' `fullText`; during a long run, interim
text is streamed to the TUI via `onUpdate`.

## 5. Member-side environment variables (injected at spawn)

| Variable | Purpose |
|---|---|
| `STEPCODE_TEAM_SOCK` | Team socket path (the shim's connection target) |
| `STEPCODE_TEAM_MEMBER` | Sender identity (the basis for topology enforcement) |
| `STEPCODE_TEAM_DEPTH` | This member's depth in the team tree (leader = 0) |
| `STEPCODE_TEAM_MAXDEPTH` | The effective depth cap (may come from project-level config, readable only when the leader loads); the member process's config loader uses it to override `members.maxRecursionDepth` |
| `STEPCODE_TEAM_AUTOACTIVATE` | `1` = grant a sub-team; the member process loads this extension and auto-activates |
