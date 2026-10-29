# Comprehensive Sandbox Test Plan (plan-43)

> [简体中文 →](./TEST-PLAN_CN.md)
> Goal: a systematic live test of the already-shipped features inside the sandbox, to expose and fix issues.
> Principles: zero-token probes first; LLM probes make only minimal calls with a test key; on failure, record first, then fix, then re-run.
>
> Version pinning: the `sandbox/step` submodule pins the Step Code revision this sandbox tracks; the step binary
> resolution order ($STEPCODE_STEP_BIN > sandbox/step-build > PATH) is in `sandbox/step-bin.sh`,
> and the update workflow is in `sandbox/README.md`.

## I. Existing coverage (regression baseline)

| Probe | Coverage | Cost |
|---|---|---|
| phase1 | Member lifecycle (spawn/handshake/disband/rebuild) | zero-token |
| phase2 | Task board state machine (DAG/cycles/ready-set/persistence) | zero-token |
| phase3 | Message service + shim status round-trip + preset loading | zero-token |
| phase4 | LLM full path (reply/memory/resume/member-to-member messaging) | a few tokens |
| phase5 | Concurrent-creation races/fail-fast/state machine/socket 0600/abort/shutdown | 1 token |
| phase6 | Default-off activation + config pure functions + model/effort parsing | zero-token |
| phase7 | Topology truth table + out-of-bounds rejection + requireDeclaration gate | zero-token |
| phase8 | Recursion depth /proc real check + sub-team self-bootstrap + concurrency defaults | zero-token |

> The full current phase list (20 phases, derived on disk from `test/smoke/phase*.ts`) with per-phase coverage is in [docs/TESTING.md](TESTING.md) §2; the table above is the historical baseline snapshot.
## II. Coverage gaps targeted this round

1. **Concurrency cap live**: the queue-before-start semantics of `maxConcurrent` have never been verified with real dispatches (phase5 only tests spawn mutual exclusion)
2. **Nested-message deadlock (anticipated defect)**: when member A holds a semaphore slot and messages B via the shim, B's dispatch also needs a slot — with `maxConcurrent=1` or when the semaphore is exhausted it deadlocks until timeout. Analysis conclusion: server-mediated member-to-member messaging should **bypass the global concurrency gate** (the sender already holds a slot; chained acquisition self-locks)
3. **Recursion depth 2 live chain**: phase8 only verifies process-level self-bootstrap; a sub-leader really creating sub-members and relaying answers back is unverified
4. **oneshot mode**: never live-tested since release
5. **Task chain live**: the real dispatch → completion → downstream unlock of `team_task start`
6. **`/topo` command path**: command activation + team board notify have never been triggered
7. **Streaming progress**: `onUpdate`/interim text has never been observed
8. **Unicode/emoji round-trip**, **kill -9 crash recovery** (including the anticipated state staleness after onClose), **reaper logic**, **config boundaries** (storage.dir/project-level not loading/invalid fallback)

## III. Test matrix

| Probe | agentDir/config | Cost | Gap |
|---|---|---|---|
| smoke-phase9 | self-built settings.json full-section fixture (mktemp; supersedes the retired cfg-misc label) — full-section + storage.dir redirection + debug | zero-token | 8 |
| smoke-phase10 | cfg-conc (maxConcurrent=2) | ~4 tokens | 1 |
| smoke-phase10 | cfg-deadlock (maxConcurrent=1, timeoutMs=60s) | ~2 tokens | 2 |
| smoke-phase11 | cfg-deep2 (maxRecursionDepth=2, dispatch.timeoutMs=240s) | ~4 tokens | 3 |
| smoke-phase12 | default config | ~6 tokens | 4/5/7/8 |
| RPC-direct `/topo` | default config | zero-token | 6 |
| smoke-phase13 | default config (synthetic base/project dirs, settings.json section + legacy file fallback) | zero-token | project-level config |

## IV. Execution record

| Probe/config | Result | Failures | Follow-up |
|---|---|---|---|
| phase9 / self-built full-section fixture | ✅ 33/33 | 2 probe typos (async missing await, reaper threshold shorter than the spawn interval) | All pass after fixing the probe |
| phase10 / cfg-conc | ✅ 2/2 | — | 4 parallel dispatches; observed max concurrency 2 (queue-before-start correct) |
| phase10 / cfg-deadlock | ✅ pass after fix | **Product defect: nested-message deadlock** (A holds the only semaphore slot, messages B via the shim, B's dispatch also needs a slot → 60s timeout) | Fixed: server dispatches marked nested bypass the global gate |
| phase11 / cfg-deep2 | ✅ 4/4 after fix | **Product defects ①: `team_set_topology` not in the gate list → leak before activation; ② sub-leader `--tools` allowlist filters out the team tools → depth-2 orchestration broken** (plus test-harness issues: cfg-deep2 config file missing, probe didn't start the leader server) | Fixed: gate list completed, sub-leader allowlist merges the team tools, coordination prompt hardened (command failure doesn't mean investigating tools); probe now starts the leader server + refusal detection |
| phase12 / default | ✅ 9/9 | — | oneshot/task chain/Unicode/crash recovery/streaming all pass; also verified the **onClose state fix** (no longer stuck idle after an external kill) |
| /topo command | ✅ | — | RPC-direct `/topo` → activation notify + team board notify |
| Regression (after fixes) | ✅ phase1/2/3/5/6/7 + phase4 all green | — | The three product fixes introduce no regressions |
| phase13 / default (plan-51) | ✅ 14/14 pass (1 SKIP: the probe's project is untrusted, so the live trusted branch is skipped; the untrusted live assertions pass) | phase9 legacy assertion sentinel value 99 out of range (members.max validation range 1–64), passes after changing to 7 — probe defect, not a product defect | Project-level config is wired up; phase1–9 zero-token regression all green |
| Probes moved into the repo (plan-51) | ✅ `test/smoke/` now hosts phase1/2/3/5/6/7/8/9/13, `test/run-smoke.sh` runs hermetically; phase5 verified with a key | phase5 needs a key (an earlier manual loop with `grep 'FAIL '` misjudged it as passing — the probe output is `FAILED:` with no trailing space; the runner was corrected with a DONE marker + key gating) | The sandbox copies were deleted; the LLM layer (4/10/11/12) stays in sandbox |
| phase18 / staged max=2 (plan-55) | ✅ 13/13 (red before, green after) | Probe flow defect: creating a scout right after the cap check was blocked by legacy semantics, aborting the run mid-way — fixed the probe (disband the whole team first, then create) | Slots count only live members; resume ignored-params hint; no-bash warnings on topology/create; checked in with the runner's default list |

## VI. Product defect list (found and fixed this round)

1. **Nested-message deadlock** (members.ts/team-server.ts): member-to-member messages dispatched through the server compete for the same global semaphore; the sender holds a slot waiting for the reply, the target waits for a slot → deadlock until timeout. Fix: `SendOptions.nested`, server-mediated dispatches bypass the global gate (per-member queues and topology gating remain).
2. **Gate leak** (activation.ts): after registration `team_set_topology` was not added to `TEAM_TOOL_NAMES`, so it was usable before activation, breaking default-off. Fix: the list was completed to 6 tools.
3. **Sub-leader tool starvation** (members.ts): `--tools` is a full allowlist (overriding extension tools), and the preset role's list filtered out all of the sub-leader's team tools. Fix: merge `TEAM_TOOL_NAMES` into the allowlist when `canOrchestrate`.
4. **State stuck after crash** (members.ts): after a member was externally killed, `onClose` only set dead when running, so idle members stayed "idle". Fix: any exit sets dead.
5. **Fragile coordination prompt** (members.ts): when a message command failed, the LLM would go investigate tools and abandon the task. Fix: the prompt now explicitly states "on command failure do not investigate — keep working and note it in the report".

### Defects found after plan-43 (later rounds, for the release record)

6. **Leader-model fallback bypassed `models.available`** (members.ts, found 2026-10-29 in the R14 round): the conversation model is a composite `provider/id` string while `models.available` holds spawnable ids, and the fallback path (no explicit request, no preset model) returned the composite string unvalidated — the explicit-request path rejects the very same string with a clear error, and the preset path degrades to `available[0]`, so only the fallback was unguarded. Impact: the bundled `worker` preset declares no `model:`, so every worker member spawned with an unresolvable model and never settled — each dispatch failed on a settle timeout with zero usage and no diagnostic (a plain spawn failure would have been far cheaper to read). Fix: `spawnableModel()` validates the fallback and degrades to `available[0]`; phase6 asserts both branches with a composite leader model. The probe had hidden it by passing a bare id as `LEADER_MODEL`.

## V. Fix and re-run rules

1. On failure, first locate the root cause (product defect vs probe defect vs stale state) and record it in this document
2. Product defect: after fixing, must re-run the corresponding probe + affected regressions
3. Probe defect: re-run after fixing the probe
4. After everything passes, commit and push (fixes and docs separate)

## VII. Sandbox test mini-project (plan-52)

`sandbox/project/` was rebuilt as a zero-dependency Node.js mini task manager (`src/tasks.js` + `src/cli.js` + `test/tasks.test.js`),
serving as the vehicle for team members doing real work inside the sandbox (members scout/plan/fix/review here; it never points at the real repo).

- **Seeded bug**: `complete(id)` indexes the array with `id - 1` instead of looking up by id; after `remove`, ids and array positions misalign,
  so the test `complete after remove still targets the right task (seeded bug)` fails (reporting `task 3 not found`).
- **Verification record**: with the bug, `cd sandbox/project && npm test` = 7/8 pass, exit code 1; after temporarily switching to lookup by id,
  8/8 all green (proving it's fixable); already restored to the buggy demo state.
- `secret-sample.txt` (fake secret) is kept for the path-protection guardrail test.
- **Restore mechanism** (plan-10): `sandbox/project-pristine/` is the initial snapshot (without data/); `bash sandbox/restore-project.sh` overwrites project/'s known files from the snapshot and clears data/. Verified: simulated member fix (8/8) → restore → back to the 7/8 expected failure (the demo suite has since grown to 12 tests — the current restored baseline is 11/12). Run it once before each demo round.

### Demo script

| Script | Topology | Steps |
|---|---|---|
| Fix chain | pipeline | scout locates the seeded bug → planner produces a fix plan → worker fixes and runs `npm test` to green → reviewer reviews the diff |
| Parallel review | star | three reviewers review correctness / style / security in parallel, the leader merges the findings |
| Round-robin review | ring | members pass review comments along the ring; watch how `topology.maxLoopCount` (default 2) bounds the review chain length — once exceeded, members should state it in their final report (the error message says so explicitly; the leader is not a messaging target). Verified 2026-10-19: two hops succeeded; on the third hop the member declined as anticipated |

## VIII. Demo project review and fixes (plan-56, 2026-10-19)

Source: task 2 (star three-way parallel review) and task 3 (ring round-robin summary) of the second manual verification session (`sandbox/session-log-2026-10-19.md`, deleted per the restore strategy; session logs now live in `sandbox/logs/`)
strategy). The review target is the `sandbox/project` demo code (not the plugin itself).

**Fixed (project and project-pristine in sync; the buggy 7/8 and fixed 8/8 baselines unchanged)**:

| # | Issue | Fix |
|---|---|---|
| M1 | CLI store calls uncaught: crash + full stack, exit 1 (inconsistent with the exit 2 of argument validation) | `src/cli.js` adds a `run(fn)` wrapper around the four store calls: `console.error(err.message)` + exit 2 |
| M2 | `load()` doesn't validate the state shape: `{}`/`[]`/`{"tasks":[]}` leak into the store after JSON.parse — either a TypeError crash, or nextId=NaN silently making all ids undefined | `src/tasks.js` `load()` validates on exit (tasks is an array + nextId is a positive integer), invalid values fall back to the default state (same semantics as an unparseable file) |

**Intentionally not fixed (by fixture design)**:

- The seeded bug (`complete()`'s `id-1` indexing): the demo target; it must reappear after restore;
- Stale copy (test name `(seeded bug)`, fallback message `Expected demo failure`, README known issue 1): they describe exactly the seeded bug that re-establishes itself after restore;
- M3 unlocked concurrent writes / non-atomic save: a known README item, acceptable for a single-person demo;
- L6 (lenient parseInt) / L3 (add crashes on non-strings) / L8 (strict === string id) / L9 (nextId not max+1) / L10 (remove returns nothing): API robustness nits, the CLI layer already guards them, the demo stays simple;
- M5 (top-level rmSync in tests destroys the real data/, CLI tests hit the real DATA_FILE): a test hygiene issue; fixing it requires injecting a data directory into the store, a change beyond the demo's scope — left for the user to decide;

**Member misjudgments (verified)**:

- "The project lacks a .gitignore, so `data/tasks.json` risks being committed": the root repo's .gitignore already ignores `sandbox/project/data/` — the member only saw the project dir, not the repo root, hence the misjudgment;
- "`secret-sample.txt` being tracked by git is a bad pattern": **intentional design** — the fake-secret guardrail sample called out in the README, kept tracked so that "members must not read/exfiltrate secrets" can be verified;

**Follow-ups (implemented in the 0.2.0 hygiene round)**: H1 now distinguishes ENOENT from corrupt JSON (explicit error on corruption instead of a silent reset); title control characters/newlines are sanitized (guards against list output injection); the test data directory is isolated (M5 — tests use throwaway dirs via `new TaskStore({ dataDir })` / `TASKS_DATA_DIR`, so the real `data/` is never touched).

**Verification**: fixed state `npm test` 12/12; M1 reproduction paths (`add ""` / `done 99`) all exit cleanly with code 2; M2 reproduction paths (`{}` / `{"tasks":[]}`) all fall back to an empty list; the post-restore 11/12 baseline (seeded failure) unchanged; project and project-pristine file-for-file identical.

## IX. 0.2.0 round (2026-10-19)

New surface to verify: the `/topo` command (tiers / picker / review / off), plugin-specific keywords + forced migration, the three-layer false-trigger guard, verbatim forwarding with request-local instruction injection, `topo_team_msg` member messaging (no bash), custom roles, effort presets.

### Automatable without a key

| # | Check | Command / probe | Expected |
|---|---|---|---|
| A1 | Full zero-token regression | `npm run smoke` | all phases passed (20 phases — the list is derived on disk from `test/smoke/phase*.ts` — + manifest + 7 live checks + orphan-check) |
| A2 | Protocol probe | `bash sandbox/probe.sh` | `PROBE OK` |
| A3 | Sandbox restore round-trip | `bash sandbox/restore-project.sh` | `project/` back to the seeded state (seeded bug present); runtime data and session logs cleared |
| A4 | Clean-export load | covered by A1 (live-clean-export) | the extension from `git archive HEAD` activates |

### Needs STEP_API_KEY (put the key in sandbox/TEST-KEY.md; the environment wins)

| # | Check | Probe | Gap |
|---|---|---|---|
| K1 | `/topo <request>` end-to-end | RPC prompt with the command | the verbatim request lands in the session log; the leader forms a team (no solo completion) |
| K2 | Plan picker + tier instruction | sandbox session, `plan.enabled=true`, `/topo <请求>` | the select shows 4 tiers + custom; with a request attached the three-option confirmation (Accept / Cancel / Other) shows the model-generated actual plan (one-off planning call); Accept injects that plan with precedence, choosing Other takes free-form text that rides along with the request verbatim, Cancel forwards the request with activation only **The Accept path was measured manually 2026-10-25; the custom input is live-verified by `probe-remaining-manual.mjs 5a`; TUI key feel stays M3** |
| K3 | `plan.tier` pinned mode | config `tier="fast"` | a pin means "stop asking": neither activation path shows the picker **or the three-option confirmation** — the tier applies directly. **Live-verified by `probe-remaining-manual.mjs 5b` (both negative assertions: neither dialog appears) + a phase24 pinned-tier zero-token scenario**; the keyword path keeps one manual spot-check |
| K4 | `/topo review <target>` | sandbox session | three reviewers + worker merge protocol executed |
| K5 | topo_team_msg success dispatch | two members + a declared edge; the upstream messages the downstream | the reply returns over the socket — the E2E gap left by the topology fix |
| K6 | Custom roles | `<agentDir>/agents/quickfix.md`; project-level in a trusted project | `team_create_member(role="quickfix")` applies the prompt / tools / effort **The agent-dir tier is live-verified by `probe-remaining-manual.mjs 8` (effort:low + the frontmatter allowlist + the topo_team_msg overlay); the project tier needs the M2 trust flow** |
| K7 | Keyword migration notice | config carrying old keywords | activation strips them and notifies once **Live-verified by `probe-remaining-manual.mjs 9` (exactly once per session)** |
| K8 | phase4/10/11/12 LLM probes | `sandbox/smoke-phase4/10/11/12.ts` | full-path regression with the new spawn args (topo_team_msg in the allowlist) |

### Must be manual (real TUI / install / UX)

| # | Item | Why |
|---|---|---|
| M1 | Real install: `step install` from a clean export, activate, `step remove` | the `step install` command UX + uninstall; live-package-install only covers the config-packages load path |
| M2 | Trust dialog UX | the project-level config trust popup is interactive |
| M3 | TUI picker / selection rendering | `ctx.ui.select` visuals, the Accept/Cancel/Other options (no countdown — the plan confirmation waits for the decision), the Other input dialog, the tier picker's 30s fallback to `balanced` |
| M4 | TUI rendering观感 (render.ts) | phase15 asserts content strings, not pixels |
| M5 | English translation review | docs bilingual accuracy |
| M6 | 8-member performance (subjective, optional) | qualitative |

### Execution record

| # | Result | Notes |
|---|---|---|
| A1 | ✅ all phases passed | 17 phases + manifest + 7 live checks (incl. live-review) + orphan-check |
| A2 | ✅ PROBE OK | zero-token protocol probe |
| A3 | ✅ restored | seeded bug back in place; `data/` and `session-log-*.md` cleared |
| A3b | ✅ 11/12 baseline | the restored project fails exactly the seeded test (the suite grew to 12 in the hygiene round) |
| A4 | ✅ (via A1) | live-clean-export loads and activates the archived extension |
| A1 | ✅ all phases passed (2026-10-22 optimization-verification re-run) | 18 phases + manifest + 7 live checks + orphan-check; includes the phase22 self-heal probe |
| K8 | ✅ all four LLM probes passed (2026-10-22) | phase4 (replies / context memory / resume after respawn / shim messaging), phase10 (parallel 4/4, observed max 4 ≤ 5), phase11 (depth-2 chain, re-run under `sandbox/cfg-deep2` after a clean SKIP on the default config), phase12 (oneshot + usage, task chain, unicode, SIGKILL recovery, streaming with interim updates) |
| F1 | Flow fixes found while re-running | TESTING(_CN): the documented LLM-probe invocation lacked `STEP_CODING_AGENT_DIR` isolation — an installed copy under `~/.stepcode/agent` conflicts with the `-e` extension, so every tool name failed to load and the probes never ran (isolation export added to both docs); MANUAL-TESTING(_CN) runbook 17→18 phases; run-smoke.sh duplicate comment removed |
| U1 | ✅ user manual round (2026-10-22; the §7 log was lost to an unarchived restore — analysis reconstructed from the session JSONL) | §1 walkthrough + demo Acts 1–3 all completed: the 4-member fix chain (T1–T4) finished; Act 1's premise had already been met (baseline 12/12 from the earlier activation run) and the leader adapted via clarify_user + verify-only tasks; Act 2 three-way parallel review (T8–T10); Act 3 ring tour a→b→c with the third hop rejected verbatim ("would reach 3 hops, over the ring loop limit (2)"), the whole chain finishing in ~12 min with zero timeouts under the 600s family; members scoping used in team_set_topology; exactly one isError:true in the session (the expected ring rejection) |
| F2 | Log-loss hardening (2026-10-22) | restore-project.sh now auto-archives logs/ (and legacy session-log-*.md) to sandbox/archive/<ts>-auto-before-restore/ before deleting them, so an unarchived restore can never destroy a round's §7 log again; MANUAL-TESTING Act 1 gained the baseline-pitfall note (restore first when a previous run already fixed the bug; the leader's clarify_user adaptation is correct behavior); the activation instruction now tells the model to stay read-only when the user did not ask for changes |
| R3 | ✅ automation round (2026-10-23): legacy-fix + test-flow round | P1-4 meta-guard rewritten sentence-anchored (usage requests with 如何/怎么 activate again; pure how-to questions still suppressed) + 8 phase6 cases; smoke runner bounded single-retry; context hook registered through a typed ContextEvent cast (tsc 19→1); audit-driven updates — phase22 rows, Layer C invocation (mkdir + --approval-mode auto + cfg-fixture repointing), fixture key renames, stale 180000→600000, README status. Full suite green |
| R4 | ✅ automation round (2026-10-23): test-coverage hardening | new phase23 all-tool JSON-schema guard (the typebox description drop would have been caught) + dispatchPrompt / planConfirmDialogOpts / details.to assertions in phase16/21/3; runner retry line prefixed attempt1; full suite green (19 phases), tsc zero |
| R5 | ✅ automation round (2026-10-24): sandbox-log-driven repairs | plan confirmation options reduced to exactly Accept/Cancel; failed board tasks re-dispatchable (assertDispatchable + 6 phase16 gate assertions); an unresolved explicit role is now reported in the create result; MANUAL-TESTING(_CN) gained the dispatch-anomaly recovery block; full suite green, tsc zero |
| R6 | ✅ automation round (2026-10-25): comprehensive optimization (balanced team round) | createMember spawn retry (ensureLiveWithRetry, isomorphic with startTaskLocked) + isRetryableSpawnError word-boundary fix closing the augmented-respawn false positive; phase1 zero-token regression block (10 assertions + 3 stubbed scenarios); CONFIGURATION(_CN) storage.dir absolute-path notes; TEST-PLAN(_CN) retired cfg-misc label; demo-project fixes declined (ephemeral by design); full suite green, tsc zero |
| R7 | ✅ verification round (2026-10-25): remaining-items confirmation + full LLM-probe re-run | A3/A4/B2/B3 re-confirmed as deferred-by-design (no blockers, no regressions); smoke gate green; probes 22/22 assertions pass (phase4 4/4, phase10 Branch A 3/3 + Branch B 2/2 no-deadlock, phase11 4/4 depth-2 chain, phase12 9/9); found and documented the local-config fixture-shadowing false green |
| R8 | ✅ docs round (2026-10-25): test-flow documentation review | two read-only auditors (automated-flow + manual lines) + leader mechanical cross-checks; 16 bilingual updates — TESTING(_CN) Layer C block aligned + runner/pass-criteria section + phase3/16/21 coverage rows; TEST-PLAN(_CN) A1 17→19 + §I pointer + K8 tail; MANUAL-TESTING(_CN) Step 1 19 phases + restore auto-archive wording + 2026-10-25 baseline + phase23 header + ops-block notes; sandbox/README(_CN) cfg-* live-vs-legacy; README_CN stale path. No code changes |
| R9 | ✅ automation round (2026-10-25): performance-tier round (leader-executed after dispatch failures) | A3 free-text input landed (three options; the user's text rides along with the request verbatim); A4 usage-guarded settle retry (dispatchWithSettleGuard — retries only when the failed attempt provably did nothing); new phase24 end-to-end confirmation probe (6 assertions); P2-8c/8a test hardening; three deferred doc suggestions + A3/A4 doc adjustments; full suite green (20 phases), tsc zero |
| R10 | ✅ verification round (2026-10-25): LLM-probe re-run on the A3/A4 code | probes 22/22 (phase4 4/4, phase10 Branch A 3/3 + Branch B 2/2 no-deadlock, phase11 4/4, phase12 9/9) on the code with free-text input and the usage-guarded settle retry — the dispatch path was exercised for real; each probe ran in an isolated agentDir (local config shadowing avoided); smoke gate still green (20 phases) |
| R11 | ✅ sandbox-round-driven round (2026-10-25): fixes from the user's manual round log | B: describeTopology renders only edge participants (disbanded dead records no longer list as "no direct peers" rows); C: the delivery ack now forbids a resend (the placeholder guard itself confirmed by-design); D: the plan prompt requires topology consistency (star ⇒ collection routes through the leader); E: the activation protocol tells the leader to state the report return path in relay task books; A: README autonomousEffort caveat; F: unconditional resume note; phase14/16/21 assertions; full suite green (20 phases), tsc zero |
| R12 | ✅ manual-scenario closure round (2026-10-25): performance-tier plan executed | T1 scenario inventory (7 must-run items + downgrade rationale) → T2A wrote the MANUAL-TESTING(_CN) revision (new §8–§11 with the scenario 5a/5b/7/8/9 details; the scenario table's detail column points at the new sections) → T4 ran the unfinished tests: all five `sandbox/probe-remaining-manual.mjs` subcommands PASS (5a custom input rides along verbatim / 5b pinned tier suppresses the picker / 7 suppress+activate+team_create_member / 8 frontmatter tools+effort land / 9 notice exactly once); TESTING(_CN) probe table, sandbox/README(_CN) and the K2/K3/K6/K7 rows synced; the smoke gate stays green |
| R13 | ✅ pinned-tier consistency fix (2026-10-25): performance-tier plan executed | three sandbox logs analyzed (parallel-review / 2301 — no plugin defects, all findings belong to the demo project) + the user-reported asymmetry: the command path's pinned branch skipped only the picker while still running the planning call and the three-option confirmation (the keyword path injects directly); fix = a `pinnedTier` flag in index.ts skips both; phase24 gains a pinned-tier zero-token scenario (2 assertions), probe 5b's assertion flipped and its live re-run PASSes; CONFIGURATION/README/MANUAL-TESTING/TEST-PLAN synced bilingually; the smoke gate stays green |
| R14 | ✅ test-exhaustion round (2026-10-29): the v0.3.0 pre-release LLM layer re-run on the final product code | **Product defect found and fixed**: the bundled `worker` preset declares no `model:`, so with `models.autonomousSelection = true` `resolveMemberModel` fell back to the leader's composite `provider/id` string (e.g. `step/step-5-preview`) and passed it to `--model` **without the `models.available` validation the preset branch has** — the member never settled, every dispatch died on a settle timeout with zero usage and no diagnostic (the explicit-request path rejects the same string with a clear error, which is what exposed the asymmetry). Fix: a `spawnableModel()` check degrades the fallback to the first `models.available` entry; phase6 gains composite-leader-model regression assertions on both branches (57/57). **Probes re-run on the fixed code, isolated agentDir + `env -u` team vars + fixture settings.json copied in**: phase4 4/4, phase10 Branch A 2/2 (`mode: parallel-bound (maxConcurrent=2)`), Branch B 1/1 (`mode: nested-messaging-under-single-slot`, 12.9s, no deadlock), phase11 4/4 (zero SKIP — the depth-2 chain really ran), phase12 9/9, probe-remaining-manual 5a/5b/7/9 PASS and 8 FAIL→PASS on re-run (the mechanical assertion — create result carries role/effort:low/frontmatter tools — passed both times; only the member's LLM self-report of its own allowlist flaked). Zero-token gate re-run by the leader after the fix: 20 phases + manifest + 7 live + orphan-check green. **Dispatch-mechanism observation**: seven consecutive member dispatches settle-timed out this round (read-only presets included, late in the session), so the leader executed the plan itself from a clean process — the established takeover pattern; a self-written lane script that forgot to export `STEP_CODING_AGENT_DIR` reproduced the Layer C tool-name-conflict trap (5 instant false failures) before being corrected |
| R15 | ✅ UI-naming and confirmation-order round (2026-10-29): the "Topology Agent Team" rename + Accept/Cancel/Other | User request: (1) the ask dialogs must not call themselves 智能体团队 — the plugin is "Topology Agent Team"; (2) the plan confirmation's option order becomes Accept / Cancel / Other, and Other opens the free-text input; (3) optimize the test items down to the must-manual set and sync the docs. **Changes**: `extensions/index.ts` — the L2 keyword-activation confirm (title + body, now language-split through `detectLang`) and the plan-confirmation select title both read "Topology Agent Team"; the confirmation's options are `[Accept, Cancel, Other]` with `Other` as the exact same string in both languages (like Accept/Cancel); `extensions/forward.ts` — **attempted and reverted**: renaming the injected instruction's self-name to `[Topology Agent Team 已启用]` broke model compliance — probe 7's `[7-activate]` failed three times in a row (the model explored the repo with its own tools and explained the protocol instead of calling `team_create_member`) and passed immediately once the label was restored, with the ask-dialog renames still in place (a clean one-string isolation). The model-facing self-name must stay the name the model can attribute to this plugin; only the user-visible ask dialogs were renamed. **Test hardening**: phase24 gains an option-order assertion (`["Accept","Cancel","Other"]`) and a dismissed-input assertion (Esc/timeout → undefined cancels exactly like Cancel, same injection) — together they move the "Esc cancels" data plane out of the manual set; `probe-remaining-manual.mjs` matches the dialog by **title** and the option by **exact label** with no positional fallback (the old `?? options[1]` would have silently answered Cancel under the new order), prints the member's actual reply for the LLM-behaviour self-report assertion, and gains an `all` mode that runs every scenario in its own child process. **Verification**: full zero-token gate green (20 phases + manifest + 7 live + orphan-check); phase21/24 green; tsc zero for our files; live probes 5a/5b PASS on the new title and labels, 8 FAIL→PASS on re-run (mechanical assertion passed both times — the known LLM self-report flake). Dispatch degraded again (two settle timeouts), so the leader finished the remaining edits itself |

**Round-record convention**: every round that changes code, tests, or the test flow (zero-token rounds included) appends an R row — date, what ran, result, anomalies; a manual sandbox round additionally produces the §7 session log.

**Status after R14 (2026-10-29)**: K1/K4/K5/K8 covered; **K2/K3/K6/K7 are now live-verified twice over** — `probe-remaining-manual.mjs` 5a/5b/7/8/9 all PASS on the final product code (8 flaked once on its LLM self-report assertion and passed on re-run; its mechanical assertion passed both times). What stays interactive is only the irreducible manual set: M1 (real install/uninstall), M2 (project-config trust popup + the K6 project-level role tier), M3/M4 (TUI pixels and keys — probes drive the dialog data plane, not the rendering), M5 (English translation review), M6 (optional 8-member performance), and one keyword-path spot-check of the pinned tier (5b). After each manual round, record the session with the prompt from the sandbox README's [Session log](../sandbox/README.md#session-log) section.
### Findings from the 2026-10-20 sandbox session

- **Bug (fixed)**: the team tools went "tool not found" mid-session (working 00:54–00:55, dead from 00:57:56) with no `/topo off`, no reload, and no session restart — a host-side tool reset hid them with no recovery path. Fix: `ensureToolsAvailable()` re-asserts the tools on every input while the plugin is active, and `session_start` re-activates when the session's team registry already exists (covers session resume and extension re-initialization). Commits 50df038 / 601e6f8.
- **Rename**: the member messaging tool `team_msg` → `topo_team_msg` (matches the `/topo` command family; clear of a future official agent-teams feature).
- **Removed**: the misleading "no bash → cannot message" note in `team_create_member` (every spawned member gets `topo_team_msg`, so read-only presets can use their topology edges) and the dead `messagingWarnings` helper.
- **Manual flow** (delivered in chat 2026-10-20): `/topo` basics → L1/L2 guard → team + topo_team_msg E2E → plan picker (needs `sandbox/config.toml` with `plan.enabled=true`) → pinned `plan.tier` → `/topo review` → effort/custom roles → migration notice → Layer C probes → real install → trust dialog → translation review.

### Findings from the 2026-10-20 sandbox session (round 2, consolidated MANUAL-TESTING checklist)

- **Bug (fixed)**: `topo_team_msg`'s reply contract was broken — the sender received the host's "No result provided" placeholder (substituted for a receiver turn that ends without assistant text) through `res.reply`, so ring pass-along flows broke silently: senders could not tell successful delivery from a lost reply and had to fall back to leader-side collection (observed twice: r1→r2 and r2→r3; the receivers had in fact processed the messages). Fix: `formatTeammateReply()` in member-messaging.ts turns an empty or placeholder reply into an explicit delivery acknowledgment that points at the final report and the leader's collection paths; rpc-client.ts no longer captures the placeholder as assistant text; phase16 probes the contract (real reply passes through; empty / placeholder / undefined / whitespace-only all yield the acknowledgment).
- **Observation (guardrail working as designed)**: high-effort multi-file reviews exceed the 180s default `dispatch.timeoutMs`, so the leader's dispatches hit "timeout waiting for member to settle" and were killed fail-fast; r3 never completed a full review across four attempts (its context stays resumable). The timeout is configurable — raise `dispatch.timeoutMs` for long reviews, or harvest via respawn as this round did for r1/r2.
- **Verified working**: the topology member-scoping parameter (`team_set_topology` with `members`) produced exactly the requested 3-edge ring (r1→r2→r3→r1) inside a team that had accumulated older members — they were isolated (no direct peers) instead of being swept into the ring.
