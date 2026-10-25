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
| Session logs | `sandbox/logs/session-log-*.md` (generated on demand by verification sessions; prompt in [../sandbox/README.md](../sandbox/README.md#session-log)) | `restore-project.sh` deletes them automatically — run `bash sandbox/archive-round.sh <label>` first to keep them |
| Per-fixture runtime state | `sandbox/cfg-*/{sessions,teams,teams-*,live-context}` | Same as above, clean when needed |

```bash
# quick restore (required after every LLM-layer test round): seeded bug back in place, data/ cleared
bash sandbox/restore-project.sh

# full reset (optional): delete all sandbox runtime state, then restore the demo project
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

`OPT_OUT_PHASES="13 14" npm run smoke` runs every phase except the listed ones
(the runner's only deliberate-exclusion knob; explicit phase arguments override
it). `bash sandbox/probe.sh` is the one-shot RPC handshake probe (expects
`PROBE OK`); `bash sandbox/archive-round.sh <label>` snapshots a round's
evidence — session JSONL, team registries, `logs/`, the demo-project diff — into
the gitignored `sandbox/archive/`, and must run **before** any restore that
would delete it.

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
npm run smoke                 # the whole zero-token layer (phase 1 2 3 5 6 7 8 9 13 14 15 16 17 18 19 20 21 22 23 24)
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
| phase3 | Messaging service + shim status round-trip + preset loading + `topo_team_msg` result `details.to` echo | zero token |
| phase5 | Concurrent creation races / fail-fast kill / state machine / socket 0600 / abort / shutdown | 1 token (SKIP without a key) |
| phase6 | Default-off activation + config pure functions + model/effort resolution + forced keyword migration (strip / report / all-deprecated disables) + L1 negation guard matrix | zero token |
| phase7 | Topology truth table + out-of-bounds rejection + requireDeclaration gate | zero token |
| phase8 | Recursion depth /proc inspection + sub-team self-bootstrap + concurrent defaults | zero token |
| phase9 | Config boundaries (storage.dir / project-level / invalid fallback) + [tasks] section validation | zero token |
| phase13 | Project-level config (trust gate / deep merge / precedence / env / MAXDEPTH) | zero token |
| phase14 | Ring loop cap (config surface / immediate throw at the manager layer / rejection at the server layer via the shim / topology precedence / boundary allowed through) | zero token |
| phase15 | TUI render assertions (render.ts, the six tools' call/result, including collapse/expand / usage rows / status icons) | zero token (standalone run) |
| phase16 | Cost guardrail and output truncation unit tests (costWarning / truncateOutput) + `dispatchPrompt` merge contract + the `assertDispatchable` gate (a failed task stays re-dispatchable) | zero token (standalone run) |
| phase17 | Orphan processes (a member must not outlive the leader) | zero token |
| phase18 | Slot counting (disband frees a slot) + resume argument ignored notice + dispatch failure context (the timeout/abort notice relays in-flight messages and the member roster) | zero token |
| phase19 | Unified config tiers (global/project config.toml, trust gating, precedence, invalid-TOML tolerance, env still wins) | zero token |
| phase20 | Config seeding (commented defaults block appended on first activation; idempotent, additive, content preserved) | zero token |
| phase21 | Team-request instruction builders + plan-tier data (language selection, tier strategy prompts, picker options, custom flow, review protocol) + `planConfirmDialogOpts` (no countdown in the TUI) | zero token |
| phase22 | Tool-availability self-heal: `ensureToolsAvailable` restores tools after a host reset, no-ops while inactive, and `session_start` re-activates a session whose team registry already exists | zero token |
| phase23 | Team-tool JSON-schema contract: every tool and every top-level parameter carries a non-empty description (guards the typebox two-argument Optional class of regression, which once dropped `reason`'s description) | zero token |
| phase24 | End-to-end confirmation path: a fake ExtensionAPI plus a scripted context drives the real extension factory — asserts Accept forwards the request verbatim with the plan instruction injected, a custom input's note merges verbatim, an empty submission accepts as shown, and Cancel injects the activation-only instruction (`plan.enabled` switched through the resetConfigCache hook and restored) | zero token (standalone) |

**Runner behavior and pass criteria**: the phase list is derived on disk from `test/smoke/phase*.ts` (run-smoke.sh:37); a failed phase is retried once on a fresh session id (the first-failure line is prefixed `attempt1`, so a passing retry leaves no bare `FAILED` line for CI to misread); a phase that logs no `DONE` within 240s is reported as a hang (rc=124), distinct from assertion failures; a verdict requires a DONE marker and zero FAIL lines. After the phases: a manifest check, the 7 live checks, and a 15s orphan-process poll (a skipped phase17 makes it report `SKIPPED` rather than silently passing). **The live checks must run from the leader's own clean process** — inside a member process's restricted environment they fail wholesale (a false negative observed 2026-10-25; the leader's run was green).

The LLM-path probes (phase4/10/11/12) need a test key and live in `sandbox/` —
the probes themselves are tracked; only sandbox runtime state is gitignored (see
Layer C).

## 3. Layer C — LLM-path tests (test key, inside the sandbox, minimal cost per probe)

```bash
# Isolate the agent dir first: without this, step falls back to ~/.stepcode/agent,
# whose packages entry (an installed copy of this plugin) conflicts with the -e
# extension below — every tool name fails to load and the probe never runs.
mkdir -p "$PWD/sandbox/agent/sessions"   # gitignored; on a fresh clone nothing creates it yet
export STEP_CODING_AGENT_DIR="$PWD/sandbox/agent"
sleep 300 | bash sandbox/with-test-key.sh step -e "$PWD/extensions/index.ts" \
  -e "$PWD/sandbox/smoke-phase4.ts" \
  --mode rpc --session-id r4 --session-dir "$PWD/sandbox/agent/sessions" --approval-mode auto
```

| Probe | Config | Coverage |
|---|---|---|
| phase4 | default | Full LLM path (replies / context memory / resume after restart / member-to-member messaging) |
| phase10 | cfg-conc / cfg-deadlock | Concurrency cap live / nested messaging deadlock |
| phase11 | cfg-deep2 | Real chain at recursion depth 2 |
| phase12 | default | oneshot / task chains / Unicode / crash recovery / streaming progress |

phase10/phase11 read their behavior from the agent dir's config, so repoint the
export at the fixture (`STEP_CODING_AGENT_DIR="$PWD/sandbox/cfg-deep2"` for
phase11). With the default dir phase11 exits with a clean SKIP — a false green.

**Local-config shadowing**: the global `config.toml` lives *beside* the agent dir
(`dirname(agentDir)/config.toml`) and outranks the fixture's `settings.json`. A
local `sandbox/config.toml` (gitignored) therefore shadows `sandbox/cfg-*` — its
`dispatch.maxConcurrent` silently replaces the fixture's, and phase10 takes
Branch A instead of B (a false green observed 2026-10-25). On machines with that
file, isolate the probe: copy the fixture's `settings.json` into a temp agent dir
and point `STEP_CODING_AGENT_DIR` there.

Pass criteria (summary): all parallel dispatches succeed; task chains move
pending→ready→running→done; oneshot gets a reply and leaves no resident process;
after `kill -9` the next send succeeds and remembers the earlier context;
`STEPCODE_TEAM_COST_WARN=0.0001` triggers a warning and 0 disables it; no orphan
processes after abort; onUpdate is called at least once; >50KB output is
truncated and `details.fullText` holds the full text. Additionally: the cfg-deadlock branch
(phase10, `maxConcurrent=1`) must complete without deadlocking well inside the probe
window (observed ~6s); phase11 must actually run its four checks (4/4) with
`cfg-deep2` — a clean SKIP counts as a failure.

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
