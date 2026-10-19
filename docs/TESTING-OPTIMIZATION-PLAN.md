# Testing and Optimization Plan

> [简体中文 →](./TESTING-OPTIMIZATION-PLAN_ZH.md)
>
> Source: a 2026-10-17 walkthrough of the entire Step-Code-Agent-Team codebase
> (10 `extensions/` modules + the `bin` shim + presets + docs).
> This document has four parts: **① Findings summary (graded by severity)
> ② Testing plan (four layers) ③ Optimization plan (milestones) ④ Execution order**.

---

## 1. Findings summary

Severity definitions: **P0** = can corrupt state or produce wrong results;
**P1** = resource/robustness defect; **P2** = UX and details.

### P0 — Correctness

| # | Location | Issue | Impact | Fix direction |
|---|---|---|---|---|
| P0-1 | `members.ts` createMember (record push + save completes before ensureLive) | **spawn race**: when the LLM calls `team_create_member(t1)` and `team_send(t1, …)` in parallel in the same tool batch, sendMessage can already find the record in the registry and go through dispatch→ensureLive, while createMember's own ensureLive **starts a process of its own** — both sharing the same `--session-id` | Two processes concurrently write the same session file → context corruption, interleaved replies | Per-member spawn mutex: a `Map<string, Promise<MemberRpc>>` recording in-flight spawns, or serialize ensureLive into a per-member queue |
| P0-2 | `members.ts` dispatch catch branch | **reuse of a live rpc after failure**: when promptAndSettle times out and fails, the member process may still be running; status is set to dead but the rpc stays in the map; the next dispatch's ensureLive sees it as not closed and reuses it, sending a new prompt to a still-running process | Old and new runs interleave; a stale `agent_settled` may resolve the new run early, returning the wrong text/usage | On dispatch error, `rpc.kill()` and remove it from the map; the next dispatch respawns (the session-id guarantees context resume) |

### P1 — Resources and robustness

| # | Location | Issue | Impact | Fix direction |
|---|---|---|---|---|
| P1-1 | `members.ts` sendOneshot | oneshot **bypasses the per-member queue and the global semaphore** | Concurrent oneshots can exceed the MAX_CONCURRENCY=4 cap | The oneshot execution segment also calls `acquireSlot/releaseSlot` |
| P1-2 | `rpc-client.ts` waitForClose | The closeWaiters resolver is **never removed** after promptAndSettle's race ends | Each dispatch leaks a closure (grows without bound with the number of dispatches) | Remove the corresponding waiter after the race ends (or change to one-shot consumption) |
| P1-3 | `members.ts` shutdown | Kills processes but does not update registry status | After the leader restarts and resumes, `team_status` shows a stale `idle` for dead processes until the next dispatch corrects it | Mark all dead and save on shutdown |
| P1-4 | `tools.ts` all execute + `rpc-client.ts` abortRun | **AbortSignal not wired**: on Esc cancel the signal is ignored, and abortRun has no callers | Long member runs cannot be canceled from the leader side; you can only wait for the 180s timeout | signal → sendMessage/startTask → dispatch: on abort, call `rpc.abortRun()` and reject with AbortError |
| P1-5 | `team-server.ts` listen | The socket file is created with the default umask (typically connectable by the same user group / other users) | Other local users can send messages to members, spending the key owner's quota | `fs.chmodSync(socketPath, 0o600)` after listen |
| P1-6 | `team-server.ts` server.on("error") | Silently swallows all errors | On listen failure (e.g. race EADDRINUSE) the message path silently fails, hard to diagnose | At least an stderr marker; recommend adding a `STEPCODE_TEAM_DEBUG` debug switch for unified management |

### P2 — UX and details

| # | Location | Issue | Fix direction |
|---|---|---|---|
| P2-1 | `tools.ts` all execute | `onUpdate` is never called: during long member runs the TUI tool call looks stuck | Push the member `message_end` intermediate text to `onUpdate` via the onProgress callback (matching the official subagent example's streaming behavior) |
| P2-2 | `tools.ts` truncateOutput | The copy claims "Full output preserved in tool details", but details actually does not contain the full text | Add a `fullText` field to details (or fix the copy) |
| P2-3 | `rpc-client.ts` lastAssistantText | When a run produces no assistant text, what is returned is the **previous run**'s text | Reset `lastAssistantText` at prompt start |
| P2-4 | `tools.ts` team_send | When `taskId` and `mode:"oneshot"` are passed together, oneshot is silently ignored | Parameter validation: throw directly on that combination |
| P2-5 | `members.ts` completeTask/failTask | No state machine validation: `pending` can be set directly to done, unlocking downstream | Validate legal transitions (pending/ready/running → done/failed), or make the "manual override" semantics explicit in the docs |
| P2-6 | `members.ts` disband | An unknown member name is a silent no-op (returns []) | Throw "Unknown member" |
| P2-7 | `tools.ts` costWarning | `parseFloat("0") || 1` makes 0 unable to disable the warning; negative values pass straight through | Parse correctly: invalid/missing falls back to the default; an explicit 0 is treated as disabling |
| P2-8 | `presets.ts` extensionDir | `new URL(import.meta.url).pathname` does not decode percent-encoding (breaks when the path contains spaces/non-ASCII) | Switch to `fileURLToPath(new URL(import.meta.url))` |
| P2-9 | `members.ts` reapIdleMembers | Races with queued dispatches: may kill an idle member that is about to be used (respawn is correct but wastes a spawn) | Record only; if fixing, the reaper can skip members with a non-empty queue |
| P2-10 | `tools.ts` | The `emptyUsage` import is unused | Remove |

---

## 2. Testing plan

Principle: **write reproducible tests first, then fix**; both P0 items must have a
failing test first. Tests are in four layers: the first two are zero-cost, the third
uses a test key (sandbox-isolated).

### Layer A — Unit tests (no LLM; node/jiti loads the modules directly)

| Test | Pass criteria |
|---|---|
| registry: saveRegistry atomic write | After 50 concurrent saves, the JSON is parseable and is one complete snapshot; no `.tmp-*` leftovers |
| registry: loadRegistry robustness | Bad JSON / schemaVersion≠1 / missing file all return null without throwing |
| registry: agentDir | After setting `STEP_CODING_AGENT_DIR`, teamsRoot points under it |
| tasks: validateGraph | Self-loops, indirect cycles (T1→T2→T1), and unknown dependencies all throw TaskGraphError; a legal DAG does not throw |
| tasks: recomputeReady | Full-scenario matrix: no dependency→ready; dependency done→ready; dependency failed/pending/running→pending; terminal states are not overwritten |
| tasks: nextTaskId | After deleting a middle task, numbering reuses the smallest gap |
| JSONL framing (rpc-client onData) | JSON lines containing U+2028/U+2029 are not wrongly split; half-line buffers are correctly joined; both `\r\n` and bare `\n` are handled |
| presets: frontmatter | `tools: [a, b]` arrays, quoted values, CRLF line endings, missing name/description are skipped |
| usage: usageDelta/addUsage | In cross-process reset scenarios the delta is not negative and the accumulation is correct |

### Layer B — Zero-token integration tests (`step -e` + probe extension, following the smoke-phase* pattern)

| Test | Pass criteria |
|---|---|
| **P0-1 spawn race** | The probe calls `createMember(t1)` and `sendMessage(t1,…)` concurrently (send uses a path that never reaches the LLM, or asserts the merge happens at the spawn mutex): throughout there is only **1** member process (unique pid, `pgrep -f team-.*-t1` count is 1) |
| **P0-2 no reuse after failure** | `kill -9` the member process mid-dispatch; the next send respawns automatically, and the member remembers the earlier conversation (session-id resume) |
| oneshot concurrency (after the P1-1 fix) | 6 concurrent oneshots, in-flight dispatch count ≤ 4 |
| closeWaiters (after the P1-2 fix) | After 100 consecutive dispatches the closeWaiters length does not grow (the probe exposes internal state or asserts indirectly) |
| reap (related to P1-3) | Forge lastActivity to 31 minutes ago: the idle member is killed and the registry is set dead; the running member is untouched |
| shutdown status (after the P1-3 fix) | After session_shutdown, all members in the registry have status=dead |
| server stale socket | Starting twice in a row does not throw and is connectable; after stop the socket file is deleted |
| socket permissions (after the P1-5 fix) | After listen, the file mode is 600 |

### Layer C — LLM-path tests (test key, inside the sandbox, minimal cost per case)

| Test | Pass criteria |
|---|---|
| Parallel dispatch | 2 members `team_send` at the same time: both return successfully; TUI/logs show concurrency (optional: total time significantly less than serialized) |
| Task chain | `team_task create` T1, T2(blockedBy T1) → `start T1` → `start T2`: status transitions pending→ready→running→done, results written back |
| oneshot mode | `team_send mode:"oneshot"`: there is a reply; `team_status` shows no new resident process |
| Member crash recovery | `kill -9` the member mid-run; the next send succeeds and remembers the context |
| Cost guardrail (after the P2-7 fix) | With `STEPCODE_TEAM_COST_WARN=0.0001`, the team_status output contains the warning; set to 0 disables it |
| Abort (after the P1-4 fix) | A long task triggers abort: the member stops, the status is sensible, no orphan processes |
| Streaming progress (after the P2-1 fix) | During a long member run onUpdate is called at least once (probe layer verifies the callback fires) |
| Truncation (after the P2-2 fix) | Member output >50KB: the body is truncated, details.fullText contains the full text |

### Layer D — Robustness and boundaries

| Test | Pass criteria |
|---|---|
| Leader crash recovery | Kill the leader at any moment: the registry has no `.tmp-*` leftovers; after resume the team view matches the disk |
| Unicode round-trip | Messages containing emoji/Chinese/multi-byte characters pass to and from members without corruption |
| Parameter validation | Empty message, over-long/invalid member names, unknown task id, unknown member: all get a clear error (isError) rather than silence |
| Missing directory | After deleting `teams/<id>/sessions`, createMember still works (mkdir recursive) |
| Large scale | 8-member cap, 999-task cap, single-task detail 50KB: behavior matches the docs |

---

## 3. Optimization plan (milestones)

### M1 — Correctness fixes (P0 + P1 core)

1. P0-1 per-member spawn mutex (add the Layer B failing test first)
2. P0-2 dispatch failure kills the rpc (add the Layer B failing test first)
3. P1-1 oneshot folded into the semaphore
4. P1-2 closeWaiters leak fix
5. P1-3 shutdown marks dead

### M2 — Control and security

6. P1-4 AbortSignal wired across the whole chain (signal → abortRun → AbortError)
7. P1-5 socket chmod 600
8. P1-6 server error logging + `STEPCODE_TEAM_DEBUG` debug switch (unified capture of
   the previously silent swallow points)

### M3 — UX and details

9. P2-1 streaming progress (message_end → onUpdate)
10. P2-2 details.fullText; P2-3 lastAssistantText reset
11. P2-4 parameter combination validation; P2-5 task state machine; P2-6 disband
    throws on unknown name
12. P2-7 costWarning parsing; P2-8 fileURLToPath; P2-10 clean up the unused import
13. P2-9 recorded as a known limitation (noted in README)

### M4 — Docs and packaging

14. Promote architecture and protocol from the local session plan to repo docs:
    `docs/ARCHITECTURE.md` (component diagram, data flow, directory layout),
    `docs/PROTOCOL.md` (RPC commands/events, socket protocol, registry schema, tool
    contracts)
15. Add `docs/TESTING.md` (the operationalized version of this document's testing
    plan: how to run each layer of tests)
16. Add doc links and a "Known limitations" section to the English and Chinese READMEs
17. `step install ./` end-to-end verification (executed on the user side; changes real
    settings)

---

## 4. Suggested execution order

```
Step 1: add unit tests per Layer A (pure functions, zero risk, immediately surface tasks/registry regressions)
Step 2: write the Layer B failing tests for P0-1/P0-2 → fix → turn green
Step 3: the rest of M1 + the corresponding Layer B tests
Step 4: M2 (after the abort wiring, verify with the Layer C "abort" case)
Step 5: M3 + full Layer C/D regression (test key)
Step 6: M4 docs and install verification
```

Run a regression at the end of every milestone: full Layer A+B + a Layer C sample
(parallel dispatch, task chain, crash recovery). When protocol or process behavior
changes, the Layer B race cases must be rerun.
