# Testing Guide

> [简体中文 →](./TESTING_CN.md)
>
> The operational version of the four-layer testing system. Principle: **write a
> reproducible test first, then fix**; the zero-token layer comes first, and the
> LLM layer only makes minimal calls inside the sandbox with a test key. Probes
> are numbered by phase: the zero-token layer ships with the repo
> (`test/smoke/phase*.ts`), the LLM layer ships with `sandbox/` (needs your own
> key); historical execution records are in `docs/TEST-PLAN.md`.

## 0. Environment setup

Zero-token layer: `test/run-smoke.sh` builds its own throwaway temporary agentDir
(mktemp), so no preparation is needed and it is fully isolated from your real
`~/.stepcode`. The LLM layer runs inside `sandbox/` (`sandbox/` ships with the
repo and already contains the `cfg-*` fixtures; only runtime state such as the
agent dir, sessions, and teams is gitignored). `step` binary resolution order:
`$STEPCODE_STEP_BIN` > `sandbox/step-build/step` (built from the `sandbox/step`
submodule) > `step` on PATH (see `sandbox/step-bin.sh`). Headless probes must
carry `--approval-mode auto`, otherwise the spawned process's tools are blocked
by approval:

```bash
export STEP_CODING_AGENT_DIR="$PWD/sandbox/agent"
export STEP_CODING_AGENT_SESSION_DIR="$PWD/sandbox/agent/sessions"
```

Before LLM-layer tests, put the key in `sandbox/TEST-KEY.md` (gitignored, one
`STEP_API_KEY=<key>` line) or export `STEP_API_KEY` — the runner scripts read it
automatically (the environment wins; the key is never written to any file).

### Sandbox runtime state and restore

The sandbox's reusable facilities (scripts, probes, the `cfg-*` fixtures,
`project-pristine/`) ship with the repo; the following **runtime state** (all
gitignored) accumulates as tests run and should be cleaned when needed:

| State | Location | Cleanup |
|---|---|---|
| Demo project | `sandbox/project/` (modified by members, e.g. fixing a seeded bug) | `bash sandbox/restore-project.sh` restores it to the seeded state |
| Sessions / teams / plans / live-context | `sandbox/agent/{sessions,teams,plans,live-context}` | `rm -rf` then re-run (fresh sandbox) |
| Demo project runtime data | `sandbox/project/data/` | `restore-project.sh` clears it automatically |
| Session logs | `sandbox/logs/session-log-*.md` (generated on demand by verification sessions; prompt in [../sandbox/README.md](../sandbox/README.md#session-log)) | `restore-project.sh` deletes them automatically |
| Per-fixture runtime state | `sandbox/cfg-*/{sessions,teams,teams-*,live-context}` | Same as above, clean when needed |

```bash
# quick restore (required after every LLM-layer test round): seeded bug back in place, data/ cleared
bash sandbox/restore-project.sh

# full reset (optional): delete all sandbox runtime state, then restore the demo project
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

Manual verification in the interactive TUI (including copy-paste prompts) and the
full manual testing checklist (including the restore commands) are in
[MANUAL-TESTING.md](MANUAL-TESTING.md).

## 1. Layer A — unit tests (no LLM, no processes)

Pure-function layer, modules loaded directly with node/jiti (currently covered
by in-probe assertions; no separate runner):

| Target | Cases | Pass criteria |
|---|---|---|
| `registry.ts` | saveRegistry atomic write / loadRegistry robustness / agentDir resolution | After 50 concurrent writes the JSON parses and is one complete snapshot; malformed JSON, schemaVersion≠1, and a missing file all return null without throwing |
| `tasks.ts` | validateGraph / recomputeReady / nextTaskId | Self-loop, indirect cycle, and unknown dependency throw TaskGraphError; a valid DAG does not throw; the ready matrix is correct in every scenario; after deleting a middle task, numbering reuses the smallest gap |
| `rpc-client.ts` onData | framing rules | U+2028/U+2029 inside a line do not split it; partial lines join correctly; both `\r\n` and bare `\n` are handled |
| `presets.ts` | frontmatter parsing | `tools: [a, b]` arrays, quoted values, CRLF, missing name/description skipped |
| `registry.ts` usage | usageDelta/addUsage | In the cross-process reset scenario the delta is never negative and the cumulative total is correct |

## 2. Layer B — zero-token integration probes (checked in, `test/smoke/`)

The probes ship with the repo and run through `test/run-smoke.sh` with a
throwaway temporary agentDir (mktemp), so they do not pollute `~/.stepcode` or
the gitignored `sandbox/`:

```bash
npm run smoke                 # the whole zero-token layer (phase 1 2 3 5 6 7 8 9 13 14 15 16 17 18 19 20 21)
bash test/run-smoke.sh 9 13   # run only the given phases
```

phase5 makes one real model call (1 token): when `STEP_API_KEY` is unset the
runner explicitly SKIPs instead of failing. The key comes from the environment,
or from the first non-comment line of `sandbox/TEST-KEY.md` (gitignored) — with
either set, phase5 is part of the regression run.

| Probe | Coverage | Cost |
|---|---|---|
| phase1 | Member lifecycle with assertions (spawn / handshake / registry persistence / disband reset / idempotent resume — kill-path instance-identity regression) | zero token |
| phase2 | Task board state machine (DAG / cycles / ready set / persistence) | zero token |
| phase3 | Messaging service + shim status round-trip + preset loading | zero token |
| phase5 | Concurrent creation races / fail-fast kill / state machine / socket 0600 / abort / shutdown | 1 token (SKIP without a key) |
| phase6 | Default-off activation + config pure functions + model/effort resolution + forced keyword migration (strip / report / all-deprecated disables) + L1 negation guard matrix | zero token |
| phase7 | Topology truth table + out-of-bounds rejection + requireDeclaration gate | zero token |
| phase8 | Recursion depth /proc inspection + sub-team self-bootstrap + concurrent defaults | zero token |
| phase9 | Config boundaries (storage.dir / project-level / invalid fallback) + [tasks] section validation | zero token |
| phase13 | Project-level config (trust gate / deep merge / precedence / env / MAXDEPTH) | zero token |
| phase14 | Ring loop cap (config surface / immediate throw at the manager layer / rejection at the server layer via the shim / topology precedence / boundary allowed through) | zero token |
| phase15 | TUI render assertions (render.ts, the six tools' call/result, including collapse/expand / usage rows / status icons) | zero token (standalone run) |
| phase16 | Cost guardrail and output truncation unit tests (costWarning / truncateOutput) | zero token (standalone run) |
| phase17 | Orphan processes (a member must not outlive the leader) | zero token |
| phase18 | Slot counting (disband frees a slot) + resume argument ignored notice + dispatch failure context (the timeout/abort notice relays in-flight messages and the member roster) | zero token |
| phase19 | Unified config tiers (global/project config.toml, trust gating, precedence, invalid-TOML tolerance, env still wins) | zero token |
| phase20 | Config seeding (commented defaults block appended on first activation; idempotent, additive, content preserved) | zero token |
| phase21 | Team-request instruction builders + plan-tier data (language selection, tier strategy prompts, picker options, custom flow, review protocol) | zero token |

The LLM-path probes (phase4/10/11/12) need a test key and still live in the
gitignored `sandbox/` (see Layer C).

## 3. Layer C — LLM-path tests (test key, inside the sandbox, minimal cost per probe)

```bash
sleep 300 | bash sandbox/with-test-key.sh step -e "$PWD/extensions/index.ts" \
  -e "$PWD/sandbox/smoke-phase4.ts" \
  --mode rpc --session-id r4 --session-dir "$PWD/sandbox/agent/sessions"
```

| Probe | Config | Coverage |
|---|---|---|
| phase4 | default | Full LLM path (replies / context memory / resume after restart / member-to-member messaging) |
| phase10 | cfg-conc / cfg-deadlock | Concurrency cap live / nested messaging deadlock |
| phase11 | cfg-deep2 | Real chain at recursion depth 2 |
| phase12 | default | oneshot / task chains / Unicode / crash recovery / streaming progress |

Pass criteria (summary): all parallel dispatches succeed; task chains move
pending→ready→running→done; oneshot gets a reply and leaves no resident process;
after `kill -9` the next send succeeds and remembers the earlier context;
`STEPCODE_TEAM_COST_WARN=0.0001` triggers a warning and 0 disables it; no orphan
processes after abort; onUpdate is called at least once; >50KB output is
truncated and `details.fullText` holds the full text.

After a manual sandbox round, have the agent record the session into
`sandbox/logs/session-log-<date>.md` — the pasteable prompt is in the sandbox README's
[Session log](../sandbox/README.md#session-log) section.

## 4. Layer D — robustness and boundaries

Leader crash recovery (no `.tmp-*` residue in the registry, the view matches disk
after resume), Unicode/emoji round-trips, parameter validation (empty message /
invalid member name / unknown task id / unknown member all get explicit errors),
missing directories (createMember still works after the sessions directory is
deleted), and scale (8-member cap / 999-task board / 50KB per-task detail — configurable defaults, see [CONFIGURATION.md](CONFIGURATION.md)).

TUI rendering (renderCall/renderResult, the `/topo` panel, streaming
progress, activation notify) only takes effect in the interactive TUI and is not
covered by probes; verify it manually per [MANUAL-TESTING.md](MANUAL-TESTING.md)
§1 — which also holds the full manual testing checklist (real install,
project-config trust flow, LLM compliance, sandbox demo scenarios, cost
guardrails, etc.).

## 5. Fix and re-run rules

1. On failure, find the root cause first: product defect vs probe defect vs
   stale state, and record it in `docs/TEST-PLAN.md`.
2. Product defect: after the fix, re-run the corresponding probe plus the
   affected regressions.
3. Probe defect: fix the probe and re-run it.
4. Commit and push once everything is green (keep fixes and docs in separate
   commits, conventional commit).
