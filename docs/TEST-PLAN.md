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
| smoke-phase9 | cfg-misc (full-section coverage + storage.dir + debug) | zero-token | 8 |
| smoke-phase10 | cfg-conc (maxConcurrent=2) | ~4 tokens | 1 |
| smoke-phase10 | cfg-deadlock (maxConcurrent=1, timeoutMs=60s) | ~2 tokens | 2 |
| smoke-phase11 | cfg-deep2 (maxRecursionDepth=2, dispatch.timeoutMs=240s) | ~4 tokens | 3 |
| smoke-phase12 | default config | ~6 tokens | 4/5/7/8 |
| RPC-direct `/topo` | default config | zero-token | 6 |
| smoke-phase13 | default config (synthetic base/project dirs, settings.json section + legacy file fallback) | zero-token | project-level config |

## IV. Execution record

| Probe/config | Result | Failures | Follow-up |
|---|---|---|---|
| phase9 / cfg-misc | ✅ 33/33 | 2 probe typos (async missing await, reaper threshold shorter than the spawn interval) | All pass after fixing the probe |
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
- **Restore mechanism** (plan-10): `sandbox/project-pristine/` is the initial snapshot (without data/); `bash sandbox/restore-project.sh` overwrites project/'s known files from the snapshot and clears data/. Verified: simulated member fix (8/8) → restore → back to the 7/8 expected failure. Run it once before each demo round.

### Demo script

| Script | Topology | Steps |
|---|---|---|
| Fix chain | pipeline | scout locates the seeded bug → planner produces a fix plan → worker fixes and runs `npm test` to green → reviewer reviews the diff |
| Parallel review | star | three reviewers review correctness / style / security in parallel, the leader merges the findings |
| Round-robin review | ring | members pass review comments along the ring; watch how `topology.maxLoopCount` (default 2) bounds the review chain length — once exceeded, members should state it in their final report (the error message says so explicitly; the leader is not a messaging target). Verified 2026-10-19: two hops succeeded; on the third hop the member declined as anticipated |

## VIII. Demo project review and fixes (plan-56, 2026-10-19)

Source: task 2 (star three-way parallel review) and task 3 (ring round-robin summary) of the second manual verification session (`sandbox/session-log-2026-10-19.md`, deleted per the restore
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

## V. 0.2.0 round (2026-10-19)

New surface to verify: the `/topo` command (tiers / picker / review / off), plugin-specific keywords + forced migration, the three-layer false-trigger guard, verbatim forwarding with request-local instruction injection, `topo_team_msg` member messaging (no bash), custom roles, effort presets.

### Automatable without a key

| # | Check | Command / probe | Expected |
|---|---|---|---|
| A1 | Full zero-token regression | `npm run smoke` | all phases passed (17 phases + manifest + 6 live checks + orphan-check) |
| A2 | Protocol probe | `bash sandbox/probe.sh` | `PROBE OK` |
| A3 | Sandbox restore round-trip | `bash sandbox/restore-project.sh` | `project/` back to the seeded state (seeded bug present); runtime data and session logs cleared |
| A4 | Clean-export load | covered by A1 (live-clean-export) | the extension from `git archive HEAD` activates |

### Needs STEP_API_KEY (put the key in sandbox/TEST-KEY.md; the environment wins)

| # | Check | Probe | Gap |
|---|---|---|---|
| K1 | `/topo <request>` end-to-end | RPC prompt with the command | the verbatim request lands in the session log; the leader forms a team (no solo completion) |
| K2 | Plan picker + tier instruction | sandbox session, `plan.enabled=true`, `/topo` | the select shows 4 tiers + custom; the chosen tier's instruction reaches the model |
| K3 | `plan.tier` pinned mode | config `tier="fast"` | no picker; the tier applies on every activation (command and keyword paths) |
| K4 | `/topo review <target>` | sandbox session | three reviewers + worker merge protocol executed |
| K5 | topo_team_msg success dispatch | two members + a declared edge; the upstream messages the downstream | the reply returns over the socket — the E2E gap left by the topology fix |
| K6 | Custom roles | `<agentDir>/agents/quickfix.md`; project-level in a trusted project | `team_create_member(role="quickfix")` applies the prompt / tools / effort |
| K7 | Keyword migration notice | config carrying old keywords | activation strips them and notifies once |
| K8 | phase4/10/11/12 LLM probes | `sandbox/smoke-phase4/10/11/12.ts` | full-path regression with the new spawn args (topo_team_msg in the allowlist) |

### Must be manual (real TUI / install / UX)

| # | Item | Why |
|---|---|---|
| M1 | Real install: `step install` from a clean export, activate, `step remove` | the `step install` command UX + uninstall; live-package-install only covers the config-packages load path |
| M2 | Trust dialog UX | the project-level config trust popup is interactive |
| M3 | TUI picker / confirm rendering | `ctx.ui.select`/`confirm` visuals, the 30s timeout countdown |
| M4 | TUI rendering观感 (render.ts) | phase15 asserts content strings, not pixels |
| M5 | English translation review | docs bilingual accuracy |
| M6 | 8-member performance (subjective, optional) | qualitative |

### Execution record

| # | Result | Notes |
|---|---|---|
| A1 | ✅ all phases passed | 17 phases + manifest + 6 live checks (incl. live-review) + orphan-check |
| A2 | ✅ PROBE OK | zero-token protocol probe |
| A3 | ✅ restored | seeded bug back in place; `data/` and `session-log-*.md` cleared |
| A3b | ✅ 11/12 baseline | the restored project fails exactly the seeded test (the suite grew to 12 in the hygiene round) |
| A4 | ✅ (via A1) | live-clean-export loads and activates the archived extension |

Remaining: K1–K8 need `STEP_API_KEY` (set it in `sandbox/TEST-KEY.md`, gitignored, or export it); M1–M6 are manual (see the tables above). After each manual round, record the session with the prompt from the sandbox README's [Session log](../sandbox/README.md#session-log) section.

### Findings from the 2026-10-20 sandbox session

- **Bug (fixed)**: the team tools went "tool not found" mid-session (working 00:54–00:55, dead from 00:57:56) with no `/topo off`, no reload, and no session restart — a host-side tool reset hid them with no recovery path. Fix: `ensureToolsAvailable()` re-asserts the tools on every input while the plugin is active, and `session_start` re-activates when the session's team registry already exists (covers session resume and extension re-initialization). Commits 50df038 / 601e6f8.
- **Rename**: the member messaging tool `team_msg` → `topo_team_msg` (matches the `/topo` command family; clear of a future official agent-teams feature).
- **Removed**: the misleading "no bash → cannot message" note in `team_create_member` (every spawned member gets `topo_team_msg`, so read-only presets can use their topology edges) and the dead `messagingWarnings` helper.
- **Manual flow** (delivered in chat 2026-10-20): `/topo` basics → L1/L2 guard → team + topo_team_msg E2E → plan picker (needs `sandbox/config.toml` with `plan.enabled=true`) → pinned `plan.tier` → `/topo review` → effort/custom roles → migration notice → Layer C probes → real install → trust dialog → translation review.
