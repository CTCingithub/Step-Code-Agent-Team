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
`~/.stepcode`.

The agent dir is nested one level **inside** that throwaway root
(`AGENT_ROOT=$(mktemp -d); AGENT_DIR=$AGENT_ROOT/agent`), not the mktemp dir
itself. The plugin resolves its unified config at `dirname(agentDir)/config.toml`
— the host's own convention — and seeds it on every activation, so a flat agent
dir made that path `/tmp/config.toml`: the gate wrote into a shared directory and
then read it back on the next run, where it overrode the plugin's own JSON
config. Nesting keeps the whole thing inside the tree the EXIT trap removes, and
`/tmp` stays clean. The LLM layer runs inside `sandbox/` (`sandbox/` ships with the
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
npm run smoke                 # the whole zero-token layer (phase 1 2 3 5 6 7 8 9 13 14 15 16 17 18 19 20 21 22 23 24 34 35 36 37 38 39)
bash test/run-smoke.sh 9 13   # run only the given phases
```

phase5 makes one real model call (1 token): when `STEP_API_KEY` is unset the
runner explicitly SKIPs instead of failing. The key comes from the environment,
or from the first non-comment line of `sandbox/TEST-KEY.md` (gitignored) — with
either set, phase5 is part of the regression run.

Every probe reports its cases through a local `check()`, which logs one
`PASS <name>` / `FAIL <name>` line. The runner counts those lines and keeps the
result in `test/smoke/assertion-counts.txt`: a phase whose count **drops** below
the baseline fails with `assertion count dropped N -> M`, so weakening a check
into a tautology — or deleting one — cannot pass quietly. Raising the count is
always free; lowering it needs a deliberate edit to that file. (Before this
existed, the verdict was only "DONE printed, no FAIL line", and three probes
that reported through ad-hoc `log()`/`fail()` pairs emitted no PASS line at all:
a check could be removed and the suite stayed green while testing less.)

| Probe | Coverage | Cost |
|---|---|---|
| phase1 | Member lifecycle with assertions (spawn / handshake / registry persistence / disband reset / idempotent resume — kill-path instance-identity regression) | zero token |
| phase2 | Task board state machine (DAG / cycles / ready set / persistence) | zero token |
| phase3 | Messaging service + shim status round-trip + preset loading + `topo_team_msg` result `details.to` echo | zero token |
| phase5 | Concurrent creation races / fail-fast kill / state machine / socket 0600 / abort / shutdown | 1 token (SKIP without a key) |
| phase6 | Default-off activation + config pure functions + model/effort resolution + forced keyword migration (strip / report / all-deprecated disables) + L1 negation guard matrix | zero token |
| phase7 | Topology truth table + out-of-bounds rejection + requireDeclaration gate | zero token |
| phase8 | Recursion depth /proc inspection + sub-team self-bootstrap + concurrent defaults | zero token |
| phase9 | Config boundaries (storage.dir — absolute as configured, relative under the agent dir / project-level / invalid fallback) + [tasks] section validation | zero token |
| phase13 | Project-level config (trust gate / deep merge / precedence / env / MAXDEPTH) | zero token |
| phase14 | Ring loop cap (config surface / immediate throw at the manager layer / rejection at the server layer via the shim / topology precedence / boundary allowed through) | zero token |
| phase15 | TUI render assertions (render.ts, the six tools' call/result, including collapse/expand / usage rows / status icons) | zero token (standalone run) |
| phase16 | Cost guardrail and output truncation unit tests (costWarning / truncateOutput) + `dispatchPrompt` merge contract + the `assertDispatchable` gate (a failed task stays re-dispatchable) | zero token (standalone run) |
| phase17 | Orphan processes (a member must not outlive the leader) | zero token |
| phase18 | Slot counting (disband frees a slot) + resume argument ignored notice + dispatch failure context (the timeout/abort notice relays in-flight messages and the member roster) + the error classifiers that decide what may be retried (`isRetryableSpawnError` / `isSettleTimeoutError` / `augmentDispatchError`, now living in extensions/team/errors.ts and imported through members.ts's re-export) | zero token |
| phase19 | Unified config tiers (global/project config.toml, trust gating, precedence, invalid-TOML tolerance, env still wins) | zero token |
| phase20 | Config seeding (commented defaults block appended on first activation; idempotent, additive, content preserved) | zero token |
| phase21 | Team-request instruction builders + plan-tier data (language selection, tier strategy prompts, picker options, custom flow, review protocol) + `planConfirmDialogOpts` (no countdown in the TUI) | zero token |
| phase22 | Tool-availability self-heal: `ensureToolsAvailable` restores tools after a host reset, no-ops while inactive, and `session_start` re-activates a session whose team registry already exists | zero token |
| phase23 | Team-tool JSON-schema contract: every tool and every top-level parameter carries a non-empty description (guards the typebox two-argument Optional class of regression, which once dropped `reason`'s description) | zero token |
| phase25 | `.topo/` init contract: directory creation, 0600 key material, idempotence, the four accepted `.gitignore` spellings, CRLF preservation, and every degrade path (`.topo` as a file, a symlink that is not followed, an over-long path) — all against hermetic mktemp cwds | zero token (standalone) |
| phase26 | At-rest encryption: the AES-256-GCM envelope round-trip, tamper and wrong-key rejection, a **plaintext** registry still loading (backward compatibility), `enabled = false` writing plaintext, and a missing key degrading instead of throwing | zero token (standalone) |
| phase28 | `bin/topo-search.mjs` against a local fake DeepSeek endpoint: request shape and endpoint paths, the Bearer header (and that it never reaches stdout/stderr), the **billing-honest retry policy** (a 429 IS retried, a 400 is NOT), 5xx retry, timeout classification, batch mode, the exit-code contract, the missing-key path (exit 2, and the message naming the whole key chain — `STEPCODE_TOPO_SEARCH_KEY` → `STEPCODE_SEARCH_API_KEY` → `DEEPSEEK_API_KEY`), and the provider-neutral response-shape guard (an unrecognised envelope reports its keys via `meta.shape` instead of silently returning zero results) | zero token (standalone) |
| phase27 | The `searcher` role: preset frontmatter (all five fields, incl. the pinned `model:`), `presets.effort` override, the searcher/encryption config surface and seed block, and the member-spawn env — asserted against the **exported `searcherSpawnEnv`** the production code itself calls, not a copy of it. That distinction is the point: the copy this probe used to carry mirrored `buildSpawnArgs`' four lines, so it shared the original's blind spot and the missing `STEPCODE_TOPO_SEARCH_KEY` passed the gate while the script's search path had no credential at all. It now pins five env keys (`STEPCODE_TOPO_SEARCH_KEY`, `STEPCODE_SEARCH_API_KEY`, `STEPCODE_TOPO_SEARCH_URL`, `STEPCODE_TOPO_FETCH_URL`, `STEPCODE_TOPO_FETCH_KEY`) plus the on-demand `STEPCODE_TOPO_SEARCH_SCRIPT`, the both-names rule for one configured key, and the empty-string-never-becomes-a-variable rule | zero token (standalone) |
| phase31 | Config seeding: the first-activation block is comments only (the searcher keys used to be its four uncommented lines, so they landed in the TOML root and uncommenting the header was a duplicate-key error), every config table is documented, `"default"` resolves to the built-in default for every type at once (verified against all 27 keys, siblings untouched), uncommenting every DEFAULT line still yields the defaults, **every marker line is quoted** (a bare `default` is not a TOML scalar, so step's reader drops the whole table before our code can see it — undetectable and unwarnable), an older version marker triggers a refresh, a legacy unmarked block is not duplicated, an active table is not duplicated, and an explicit value still wins over `DEFAULT` | zero token (standalone) |
| phase34 | The prompt-to-settle path, end to end, against a local fake model — the blind spot behind the recurring `timeout waiting for member to settle`. Part A: a member pointed at a fake OpenAI-Chat-Completions endpoint really enters an agent run, really calls the model, really finishes a turn and really emits `agent_settled` (45 ms, usage delta 1, the request seen at `/v1/chat/completions` with a credential). Part B: an endpoint that accepts the request and never answers reproduces the degradation itself, and the assertions check the gate notices — the send fails, it entered the run before going silent, and the timeout is diagnosed as a stuck member rather than a slow one. Zero token, zero external network. |
| phase34 | The prompt-to-settle path end to end against a local fake model — the blind spot behind the recurring `timeout waiting for member to settle`. Part A: a member pointed at a fake OpenAI-Chat-Completions endpoint really enters an agent run, really calls the model, really finishes a turn and really emits `agent_settled`. Part B: an endpoint that accepts the request and never answers reproduces the degradation itself. Zero token, zero external network. |
| phase35 | A MULTI-ROUND turn settles — the fake model answers round one with a tool call and round two with the final text, forcing the agent loop through a second round, and the assertions check the tool's output reached that second round. This is the class a long turn is made of, so a regression here fails instead of surfacing as an unexplained settle timeout. |
| phase36 | Member dispatch against the REAL provider (key-gated, billed: two short prompts). A short prompt and a long prompt that has to use its tools both settle. This is the only probe that drives member dispatch against a real provider, and it exists because the 39 settle timeouts were all attributed to long turns until this showed otherwise. |
| phase38 | A member turn that produces NO text still settles, and the leader side frames the emptiness as a delivery acknowledgement — P2-8b, deferred for years because it needed a live empty reply, i.e. a model call. The fake model answers with an assistant message carrying no content at all, which is exactly the state a live empty reply leaves behind (rpc-client only captures non-empty text). Asserts the run settles, the model really was asked, no text came back, and `formatTeammateReply` yields `Delivered to X.` rather than a silent empty result. |
| phase39 | The upgrade path: a v0.3.0 config.toml meets the v0.4.x seed block — the one path every existing user takes exactly once, and previously uncovered. Asserts the user's real values survive at three levels (file text, host parse, loaded config), the new sections are added commented-out, a second seed is a no-op, and a fresh dir still gets a full block. This probe found a real defect on its first run. |
| phase37 | The member spawn contract, and that our plugin is not the cause of member stalls: `buildSpawnArgs` emits `--no-extensions -e <member-messaging.ts>` so a member loads ONLY the messaging shim, and a member with the whole plugin loaded settles just as fast as a bare one. Also asserts MemberRpc's stderr tail is reachable — it used to be discarded outright, which is why 38 timeouts went undiagnosed. |
| phase33 | Host rendering of our tool output: the content our tools return is a single line of JSON, and the host feeds it through Step Code 0.1.7's reworked streaming markdown renderer (#315/#319). This drives that renderer with the shapes we actually produce — a single-line search result, a 4000-char single line, markdown-hostile characters, and a multi-line batch stream — and asserts the payload survives: nothing thrown, the url/title/status words present, and a long body not swallowed. Whitespace is normalised first, because the renderer word-wraps and pads at the terminal width (which also means markup characters like `*` `_` `` ` `` `[` `]` are consumed — the words and URLs survive, which is what the assertions check) | zero token (standalone) |
| phase32 | The Step-CLI contract: `step --help` documents every flag `extensions/members.ts` passes when spawning a member (`--mode`/`--session-id`/`--session-dir`/`--no-extensions`/`--extension`/`--append-system-prompt`/`--approval-mode`/`--model`/`--thinking`/`--tools`), the resolved binary reports a version, `--approval-mode` still rejects a retired value (`strict`) naming `confirm, auto`, and `-e`/`--extension` is still the extension spelling. It closes the gap where an upstream flag removal would only surface in a live round | zero token (standalone) |
| phase30 | Collaboration records: content and file layout, idempotence, the three at-rest forms (sealed / plaintext-because-disabled / plaintext-because-no-key), `records.enabled=false`, a custom `records.dir`, the config surface and seed block, and the degrade path when `.topo` is broken | zero token (standalone) |
| phase24 | End-to-end confirmation path: a fake ExtensionAPI plus a scripted context drives the real extension factory — asserts the option order is exactly `Accept / Cancel / Other`, Accept forwards the request verbatim with the plan instruction injected, Other's note merges verbatim, an empty submission accepts as shown, a **dismissed** input (Esc/timeout → undefined) cancels exactly like Cancel, and Cancel injects the activation-only instruction (`plan.enabled` switched through the resetConfigCache hook and restored) | zero token (standalone) |

**Runner behavior and pass criteria**: the phase list is derived on disk from `test/smoke/phase*.ts` (run-smoke.sh:37); a failed phase is retried once on a fresh session id (the first-failure line is prefixed `attempt1`, so a passing retry leaves no bare `FAILED` line for CI to misread); a phase that logs no `DONE` within 240s is reported as a hang (rc=124), distinct from assertion failures; a verdict requires a DONE marker and zero FAIL lines. After the phases: a manifest check, the 7 live checks, and a 15s orphan-process poll (a skipped phase17 makes it report `SKIPPED` rather than silently passing). **Type gate**: `sandbox/step/node_modules/.bin/tsc -p tsconfig.typecheck.json` (paths mapping the four `@step-harness` packages to `dist/*.d.ts` + typebox) must report **zero errors** for `extensions/` and `test/smoke/` — it has been clean since R16 (2026-10-29), when the phase15 Theme stub and the phase24 contextHandler guard were completed. **The live checks must run from the leader's own clean process** — inside a member process's restricted environment they fail wholesale (a false negative observed 2026-10-25; the leader's run was green). The repo's typecheck is part of the gate as well: tsc over the full import graph is zero errors (17 until the R16 round cleared the phase15 Theme stub and the phase24 context-hook read — reproduce with `sandbox/step/node_modules/.bin/tsc -p tsconfig.typecheck.json`).

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
| probe-searcher | the sandbox config's `[stepcodeAgentTeam.searcher]` (needs a real key) | **REAL** search and fetch against the configured provider — the Layer-C counterpart to phase28, which covers the same contract hermetically. Reads the endpoints and keys from the config file (not a vendor key file), injects them through the same `STEPCODE_TOPO_*` variables the leader gives members, then asserts: non-empty results each carrying a url, `need_content` returning bodies, fetch returning a title plus markdown, real project content matching on fetch, and batch fan-out. It declares its billable-call budget up front (max 6), exits 2 with the exact config to add when no key is set (zero calls), and honours `TOPO_PROBE_MAX_CALLS=0` for a config-only dry run. **Not part of the zero-token gate** — every successful call is billed by the provider |
| probe-remaining-manual `5a` | isolated agentDir (plan.enabled) | the confirmation's Other path: a scripted RPC client answers the tier picker → picks Other → the input dialog, asserting the user's text rides along verbatim in the forwarded user message. The dialog is answered by its **title** (`Topology Agent Team`) and the option by its **exact label** (`Other`) — no positional fallback, so a renamed or reordered option fails the probe instead of silently answering Cancel. Each scenario waits for the session's **`agent_settled`** event (the prompt command's own response is only a preflight ack — rpc-mode.ts emits it from `preflightResult`), with `waitMs` as a safety cap, plus a wait for the session file to stop growing |
| probe-remaining-manual `5b` | isolated agentDir (plan.tier pinned) | negative assertion: with a pinned tier **neither** the picker **nor** the three-option confirmation appears (the plan-104 `pinnedTier` flag skips both; an explicit `/topo <tier>` still confirms) |
| probe-remaining-manual `5c` | isolated agentDir (plan.tier pinned, keyword prompt) | the pinned tier on the **keyword** path (the command path is 5b): `applyStandingTier` is a different code path from `runTeamCommand`'s pinned branch, and "no dialog appears" is a negative UI observation — so this asserts both dialogs absent **plus** a positive activation assertion against a false green (on its first run that assertion caught a real one: an unanswered L2 confirm meant the plugin never activated, and the negative assertions alone would have passed for the wrong reason) |
| probe-remaining-manual `7` | isolated agentDir ×2 | the L1 guard: zero team actions for a meta question; a how-to with a body activates and `team_create_member` really works |
| probe-remaining-manual `8` | isolated agentDir (agents/quickfix.md + autonomousEffort=false) | custom roles: the frontmatter's tools/effort land on a real spawn (the create result carries role/effort:low/tools) and the member self-reports the allowlist incl. topo_team_msg — note the self-report half is an **LLM-behavior assertion**: it flaked once in 2026-10-29 (failed, then passed on re-run) while the mechanical create-result assertion passed both times, so a single failure here is not by itself a product defect |
| probe-remaining-manual `5c` | isolated agentDir (plan.enabled + tier pinned) | the pinned tier on the KEYWORD path: neither the tier picker nor the three-option confirmation appears — plus a positive assertion that the plugin really activated, so "no dialog" can never pass because nothing happened at all |
| probe-remaining-manual `9` | isolated agentDir (keywords with a deprecated term) | the migration notice appears exactly once per session |

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

Probe caveat (recorded 2026-10-30): scenarios 7 and 8 each carry one **LLM-behaviour** assertion — "the model called `team_create_member`" and "the member's self-report names `topo_team_msg`". Both can flake without any product defect (the model may explore first, or list only its preset tools); each probe now prints the tool calls / the member's actual reply so a failure is classifiable in one run, and 7's second prompt is directive for the same reason. Re-run before treating such a failure as a defect.

Pass criteria (summary): all parallel dispatches succeed; task chains move
pending→ready→running→done; oneshot gets a reply and leaves no resident process;
after `kill -9` the next send succeeds and remembers the earlier context;
`STEPCODE_TEAM_COST_WARN=0.0001` triggers a warning and 0 disables it; no orphan
processes after abort; onUpdate is called at least once; >50KB output is
truncated and `details.fullText` holds the full text. Additionally: the cfg-deadlock branch
(phase10, `maxConcurrent=1`) must complete without deadlocking well inside the probe
window (observed ~6s); phase11 must actually run its four checks (4/4) with
`cfg-deep2` — a clean SKIP counts as a failure.

Assertion-count note (2026-10-29 re-run): the phase10 branches log one check each in
the current probe (Branch A: all 4 replies + observed max concurrency ≤ 2 — two
checks; Branch B: the nested message completes — one check), so the historical
"3/3 + 2/2" counts in older execution-record rows are probe-version notes, not
regressions. A branch passes on `SMOKE10 DONE (all passed)` **plus** the `mode:`
line matching the intended branch — a `mode:` line showing the other branch means
the fixture was shadowed (environment false green), not a pass.

Team-env note for leader-run probes: the probes must run with the six `STEPCODE_TEAM_*`
variables unset (`env -u …`). Inside a member process they are injected and inherited by
the probe's own `step` child, whose extension then reads depth 1 ≥ `maxRecursionDepth` 1
and stays inert — every probe false-fails. The smoke runner's phases are exempt (it spawns
from a clean process).

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
