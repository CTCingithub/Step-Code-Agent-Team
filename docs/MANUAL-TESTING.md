# Manual Testing Checklist (minimized)

> [简体中文 →](./MANUAL-TESTING_CN.md)
>
> **Automated coverage** (`npm run smoke`, zero-token; phase5 and the LLM items need a
> key): the protocol layer, three-tier config loading and legacy-file fallback, the
> topology truth table and out-of-bounds rejection, recursion depth, the task board
> state machine, message enforcement (topology / loop cap / wait cycle), project-level
> config **trust application and rejection** (`live-project-config` /
> `live-untrusted-config`), live wiring (the `/topo` command, argument
> forwarding), the **TUI rendering content layer** (phase15 asserts render.ts tool
> call/result strings, collapse/expand, usage rows, icons), the **cost guardrail and
> output truncation logic** (phase16), **orphan processes** (orphan-check: members must
> not outlive the leader), **clean-export loadability** (live-clean-export: a
> package exported via git archive can activate), and the **package install path**
> (live-package-install: a settings `packages` entry pointing at the repo loads the
> extension and activates it).
>
> What remains is only the **irreducible** manual items. Start with the **Round
> runbook** below for the full one-round sequence; each section after it is the
> per-scenario detail, with **directly copy-pasteable commands / prompts**. The TUI
> rendering checklist (look-and-feel only; the content layer is asserted by phase15)
> is §1.

## Status overview (2026-10-20)

| # | Item | Status |
|---|---|---|
| 1 | Interactive TUI look and feel | ✅ Verified 2026-10-19 (no rendering issues found) |
| 2 | Real install (`step install` from a clean export) | ➖ Mechanics covered by `live-package-install` / `live-clean-export`; the interactive residue ⬜ yours |
| 3 | Trust prompt interactive UX | ➖ Rejection path covered by `live-untrusted-config`; the popup itself ⬜ yours |
| 4 | LLM behavior adherence (ring) | ✅ 2026-10-19 (third hop avoided + reported); the third hop / `maxLoopCount` rejection itself still unobserved live ⬜ |
| 5 | Sandbox demo scripts (three acts) | ✅ Verified 2026-10-19 |
| 6 | Performance subjective items (8 full members) | ➖ Optional, subjective |
| — | English translation review | ⬜ Recommended |

## Round runbook (one complete test round)

The full sequence for one round — every other section in this document is detail
for a step here. All commands and prompts are directly copy-pasteable.

### Step 0 — preflight (before launching the session)

```bash
# Archive the PREVIOUS round's evidence first — restore deletes logs/ (where the §7 log lives)
bash sandbox/archive-round.sh <label-of-last-round>
# Reset the sandbox: seeded bug back in place, data/ and logs/ cleared
bash sandbox/restore-project.sh
```

The key: put it in `sandbox/TEST-KEY.md` (gitignored) — `./sandbox/run.sh` reads it
automatically (an exported `STEP_API_KEY` wins). From §1 step 5 onward a key is
required; without one those steps fail.

### Step 1 — automated gate (must be green before any manual work)

```bash
npm run smoke   # 18 phases + manifest + 7 live checks; stop and fix on any failure
```

### Step 2 — interactive scenarios (in order, one prompt at a time)

| # | Scenario | Do | Detail | Watch out for |
|---|---|---|---|---|
| 1 | Activation + team board | §1 steps 1–2 | §1 | — |
| 2 | Members + pipeline + task board | §1 steps 3–8 | §1 | — |
| 3 | `topo_team_msg` E2E | paste: `Have scout1 send worker1 a one-line intro through topo_team_msg and report the tool's exact return text` | §1, §4 | The reply is best-effort: a delivery acknowledgment ("Delivered to …") is not the teammate's answer — collect outputs through the leader |
| 4 | Ring tour (fast hops) | the §4 ring prompt | §4 | Keep each hop small (one file, one question) so every hop settles inside the 600s default `dispatch.timeoutMs` (it covers the member's whole turn, nested relays included) — and a timeout no longer triggers a blind retry: the task fails with harvest guidance instead. Run one loop; the leader collects the final list |
| 5 | Plan picker / pinned tier | enable in `sandbox/config.toml`, **restart the session**, then `/topo` | TEST-PLAN K2/K3 | `plan.enabled` / `plan.tier` are read once per session — edit the config BEFORE launching |
| 6 | Parallel review | `/topo review src/tasks.js` | TEST-PLAN K4 | — |

### Step 3 — wrap-up

1. `Report the team's current status`, then disband the team when finished.
2. Generate the session log: paste the §7 prompt (writes `sandbox/logs/session-log-<date>.md`).
3. Archive THIS round: `bash sandbox/archive-round.sh <label-of-this-round>`.
4. `bash sandbox/restore-project.sh`.
5. Add an execution-record row to `docs/TEST-PLAN.md` (date, what ran, result, anomalies).

## 0. General: sandbox environment and restore

All manual items run inside the sandbox (`./sandbox/run.sh`, isolated from the real
`~/.stepcode`). The sandbox has two kinds of state, and the tests modify both:

| State | Location | Restore method |
|---|---|---|
| Demo project | `sandbox/project/` (demo state with the seeded bug) | `bash sandbox/restore-project.sh` |
| Runtime data | `sandbox/agent/{sessions,teams,plans,live-context}`, `sandbox/project/data/` (all gitignored) | Optional full reset, see below |
| Session logs | `sandbox/logs/session-log-*.md` (generated on demand; the prompt is in [sandbox/README.md](../sandbox/README.md#session-log)) | `restore-project.sh` deletes them automatically — run `archive-round.sh` first to keep them |
| Project trust | `sandbox/agent/trust.json` (gitignored) | NOT reset by the quick restore — delete it to re-trigger the §3 trust popup |

**Quick restore (required after every test round)**:

```bash
bash sandbox/restore-project.sh
# Restored (seeded bug in place, data/ cleared); extra files created during the demo are kept
```

**Full reset (optional, when you want a fresh sandbox)**:

```bash
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

## 1. Interactive TUI look and feel (the only remaining rendering item)

The **text content** rendered by each tool is already auto-asserted by phase15; what
remains is only pixel-level and interaction-level look and feel: whether the
colors/layout are pleasing, toast dwell time, the actual `ctrl+o` keypress, and the
refresh rhythm of streaming progress. One pass in a sandbox interactive session is
enough; there is no need to verify specific text.

**Environment**: see [TESTING.md](TESTING.md) §0 (checkout path, the
`sandbox/TEST-KEY.md` key, `./sandbox/run.sh`); from step 5 onward a key is required.

**How to use**: each step below is **a single copy-pasteable prompt line** — once the
leader model receives it, it calls the matching team tool on its own, and all you have
to do is check that the rendering matches the "Expected render" column. Paste them in
order; between steps, wait for the previous render to finish before pasting the next
one. Step 6 is a key press, not a prompt.

| # | Copy-paste | Expected render | Result |
|---|---|---|---|
| 1 | `I'd like to use the topo team feature to get familiar with this sandbox project` | Activation notify: "Agent team plugin activated (explicit plugin mention). Team tools are now available."; the team tools are visible to the model from then on | ☐ |
| 2 | `/topo` | Team board notify: `Team "<id>"` + member rows (○/●/✗ icon + role + status + model/effort) + task rows (including blockedBy) + `spend: $x.xxxx`; when the team is empty it prompts you to use team_create_member | ☐ |
| 3 | `Create a member with the scout role, named scout1` | renderCall: `team +scout1 (scout)`; renderResult: `✓ scout1 (scout) [idle] … effort=high` | ☐ |
| 4 | `Create another member with the worker role, named worker1` | Same as step 3: `+worker1 (worker)` / `✓ worker1 (worker) [idle]` (provides the second member for step 7's pipeline topology) | ☐ |
| 5 | `Ask scout1 to introduce himself in one sentence` | renderCall: `team → scout1` + message preview (≤70 chars); during a long run onUpdate streams updates (first "(member is working...)", then interim text); renderResult: usage row (`1 turn, $x.xxxx`) + the reply body (collapsed to 3 lines by default, with "(ctrl+o to expand)") | ☐ |
| 6 | *(key press, not a prompt)* Press `ctrl+o` on step 5's result | The full body expands; press again to collapse it | ☐ |
| 7 | `Set the messaging topology to pipeline, then have scout1 say hi to worker1` | renderCall: `team topology pipeline` (a named shape passes no edges, so there is no edge count; if the model explicitly passes edges, ` N edge(s)` is appended); renderResult header: `pipeline · 1 edge(s)` (scout1→worker1); then `team → scout1` dispatches successfully (allowed in the pipeline direction) | ☐ |
| 8 | `Create a task: count the source files in this project, assign it to scout1, then start it` | renderCall: `team task create T1 count the source files in this project` → `team task start T1`; renderResult: `T1 [done] @scout1 count the source files in this project` + the reply body | ☐ |
| 9 | `Report the team's current status` | One line per member (icon + name + role + usage), tasks line by line (id [status] title, 50-char preview) | ☐ |
| 10 | `Disband worker1` | renderCall: `team −worker1`; renderResult: `worker1` | ☐ |
| 11 | *(exit)* Press `Ctrl+C` twice or `/quit` to leave the sandbox session | No orphan member processes: `pgrep -f 'team-.*-scout1'` is empty | ☐ |

**Verification record (2026-10-19, ✅ passed)**: the user completed the interactive
walkthrough per the checklist and **found no rendering issues**; this checklist only
needs a re-run when `render.ts` changes.

## 2. Real install writes settings (one-time, you run it)

`step install` writes your real settings, so you run it. Local-path installs are
**reference-only** (no copy — the path is recorded and resources load per the
manifest), so installing the checkout directly is fine:

```bash
step install ~/GitProjects/Step-Code-Agent-Team
```

**Expected**: after install, a new session can activate and members can spawn;
the package ships its extension resource only (no skills or prompt templates —
the orchestration protocol is injected request-locally and the review workflow
is the `/topo review` command); `step remove ~/GitProjects/Step-Code-Agent-Team` uninstalls.

**Verify the install works** (open a normal session after installing, paste):

```text
Use the topo team feature to introduce yourself
```

**Uninstall verification**: `step remove ~/GitProjects/Step-Code-Agent-Team`, then start
a session and confirm the team tools no longer appear.

## 3. Trust prompt interactive UX

The semantics of `-a`/`-na` are already automated; what remains is the interactive
trust popup itself: when starting step for the first time in a project that has
`.stepcode/config.toml`, glance at the prompt and the "Remember" option.

**Action** (inside the sandbox, produce a "first entry into a project with project
config"):

```bash
mkdir -p sandbox/project/.stepcode
cat > sandbox/project/.stepcode/config.toml <<'EOF'
[stepcodeAgentTeam.activation]
enabled = true
keywords = ["智能体小队", "topo team"]
notifyOnActivate = true
EOF
./sandbox/run.sh     # first start should pop the trust prompt; glance at the prompt and the "Remember" option
```

**Expected**: the project trust prompt pops up, with "Remember/Trust"-style options;
once trusted, the project-level config takes effect (the activation notify appearing
proves it was read successfully). If there is **no popup**, `sandbox/project` was
already trusted before (recorded in `sandbox/agent/trust.json`) — delete that file and
rerun to trigger it again.

**Restore** (delete the project-level config and return the sandbox to its original
state):

```bash
rm -rf sandbox/project/.stepcode
bash sandbox/restore-project.sh
```

## 4. LLM behavior adherence (needs a key; irreducible in essence)

The server's deterministic rejections (topology out-of-bounds, loop cap, wait cycle)
are already covered by probes; the irreducible part is whether member LLMs "obey" —
after receiving a rejection they state the conclusion in their final report instead of
retrying repeatedly or going off to investigate tools.

**Action** (paste in order inside a sandbox session):

```text
Use the topo team feature for a round-robin review: create three members with the reviewer role, r1, r2, r3, declare a ring topology, have r1 first review the correctness of src/tasks.js, then pass the review comments along the ring to the next member, with each member adding its own findings after receiving the previous member's comments.
```

**Expected**: `team_set_topology ring` declares 3 edges; the two hops r1→r2 and r2→r3
succeed; the third hop (r3→r1) exceeds `topology.maxLoopCount` (default 2) — the member
**does not attempt** that hop (anticipating rejection), or attempts it and is rejected
by the server with an error listing the allowed neighbors and "state it in your final report";
in either form the member should deliver its conclusion through the final report (the leader
is not a messaging target), rather than retrying the same hop repeatedly or switching to
investigating the environment/tools.

**Measured record (2026-10-19, ✅ passed)**: the ring two-hop relay succeeded (chain
length exactly used up the limit); reviewer-3 did not attempt the third hop and
directly output a summary report back along the reply chain — the "no attempt + report"
form of LLM adherence is confirmed (the server-side rejection itself is already covered
by the phase14 probe).

**Pass criteria**: team members ultimately report "the third hop was rejected / not
attempted" as their conclusion to the leader; the leader can wrap up accordingly. The
cost guardrail's **firing logic** is already covered by phase16; to see it with your
own eyes under real accumulated spend is optional (start the sandbox with
`STEPCODE_TEAM_COST_WARN=0.0001` and observe the warning line in `team_status`).

**Restore**: `bash sandbox/restore-project.sh` (+ optional full reset, see §0).

## 5. Sandbox demo script (✅ 2026-10-19: all three acts measured and passed)

Start with `./sandbox/run.sh`, and restore with `bash sandbox/restore-project.sh`
**before each act**. This is an experience validation, not a correctness validation.

**Measured record (2026-10-18)**: `/topo <request>` drove a 7-member team
through two acts end to end — the pipeline fix chain (scout locates the seeded bug →
planner produces a minimal plan → worker fixes → reviewer approves) + the star
three-way parallel review (correctness/style passed; the security item left hardening
suggestions, which are the demo project's own option). Leader double-check: `npm test`
12/12 (pre-fix baseline 11/12 — the suite grew from 8 to 12 tests in the 2026-10-20 hygiene round), a file-by-file comparison with `project-pristine` shows a
difference only in `src/tasks.js`, and `secret-sample.txt` was never read by any
member. The third act (ring round-robin) and the security hardening await the user's
decision.

**Measured record (2026-10-19 rerun)**: all three acts retested — the pipeline fix
chain passed 12/12 and the reviewer issued APPROVE (note the reviewer preset is read-only
with no shell, so it can only review statically; `npm test` is re-run by the leader
itself, by design); the star three-way parallel review produced a graded findings list
(against the demo code; M1/M2 are fixed, the rest recorded in `docs/TEST-PLAN.md`
section 8); the ring round-robin two-hop relay succeeded and the third hop was avoided
per protocol (details in §4 and the third act below).

### Act 1 · pipeline fix chain (copy-paste)

```text
/topo Use the topo team to fix the failing tests in this project: first dispatch scout to locate the failing test and root cause, then dispatch planner to give a minimal fix plan, then dispatch worker to fix it per the plan and get npm test passing, and finally dispatch reviewer to review the changes. Before fixing, first confirm the npm test baseline.
```

**Expected**: the task board T1→T4 flows per `blockedBy`; after the worker's fix `npm
test` is 12/12; a file-by-file comparison with `project-pristine` shows a difference only
in `src/tasks.js`; `secret-sample.txt` is never read by any member. (The reviewer
preset is read-only: its review conclusion is a static trace; `npm test` is re-run for
real by the leader.) **Between-act restore**: `bash sandbox/restore-project.sh`.

**Baseline pitfall (observed 2026-10-22)**: if an earlier request in the same
sandbox already fixed the seeded bug, `npm test` reads 12/12 before Act 1 starts
and the "fix the failing tests" premise no longer holds — run `bash
sandbox/restore-project.sh` first to put the bug back. If the leader instead
detects the mismatch and asks you (clarify_user) or adapts to a verify-only
pass, that is correct behavior, not a bug.

### Act 2 · star parallel review (copy-paste)

```text
/topo Use the topo team to review this project in parallel: dispatch three reviewers to review src/ and test/ from the correctness, style, and security angles respectively, and consolidate the three parties' findings into one list.
```

**Expected**: the three members work in parallel (concurrency is visible in
`team_status`); the leader consolidates the three parties' findings (the findings list
against the demo code is recorded in `docs/TEST-PLAN.md` section 8).
**Between-act restore**: `bash sandbox/restore-project.sh`.

### Act 3 · ring round-robin review (copy-paste, ✅ 2026-10-19 measured)

```text
/topo Use the topo team for a round-robin review: create three reviewer members, declare a ring topology, let the review comments pass along the ring, each member adding what the previous one missed, and mind the ring's chain-length cap.
```

**Measured (2026-10-19)**: the leader, following the tool description, proactively
equipped the members with a bash messaging channel (the fix from the previous round
took effect); the two-hop relay r1→r2→r3 succeeded (chain length exactly used up
`maxLoopCount=2`); reviewer-3 did not attempt the third hop and directly output a
summary report back along the reply chain.

**Known runtime behavior (nested chain timeout)**: the leader-side `team_send` wait
timeout (`dispatch.timeoutMs`, default 600s) covers the **entire nested relay chain** —
when a chain of reviewers exceeds it, the leader-side timeout returns while the relay
continues on the server side (the dispatched members are reaped per the
kill-on-failure semantics; the error message indicates the relay may still be
in flight and lists member status). The failed task carries harvest guidance: the
member's context may already contain the work, so re-dispatch a short harvest prompt
(e.g. "report what you have completed so far") instead of re-running the task — an
automatic retry would duplicate the work. To avoid the timeout: raise
`dispatch.timeoutMs` in `sandbox/config.toml` before the session (config is read
only once at session startup).

**Progress signals while waiting**: a long dispatch streams interim member text
into the tool result (`team_send` / `team_task start` forward `onUpdate`), and
`team_status` shows each member's live state — use them to tell a legitimate
long review from a stuck one before the timeout fires.

**Closing restore**: `bash sandbox/restore-project.sh`.

## 6. Subjective performance items

Spawn handshake latency with a full 8-member roster and TUI responsiveness —
subjective, with no pass criteria.

**Action** (optional): paste `Use the topo team to review this project in parallel,
with as many members working at once as possible`, and observe whether the handshake
time at a full 8-member roster and the TUI refresh are acceptable. **Restore**: see §0.

## 7. Session log (record each manual round)

After a manual round, paste this prompt to have the leader record the session
(it writes `sandbox/logs/session-log-<date>.md`, gitignored; the same prompt
lives in [sandbox/README.md](../sandbox/README.md#session-log)):

```text
Record this session's team collaboration into sandbox/logs/session-log-<today's date>.md with
this structure: (1) header — date, main model, working directory, team
framework, security-guardrail compliance; (2) the user prompts, verbatim;
(3) the roster table — member / role / duty / tools / effort; (4) each phase
in execution order — topology declared, dispatch method, member output
highlights; any anomaly (e.g. a topo_team_msg rejection) must quote the
tool's returned text verbatim, never paraphrase from memory; (5) net result
— baseline vs. after, changed-file list, what was left undone; (6) how to
restore the initial state.
```

## Known limitations (review-confirmed, not fixing for now)

- **Kill-on-failure semantics**: any dispatch failure kills the member process and
  restarts it on the next dispatch (prevents old and new runs from interleaving on the
  same session-id; see P0-2 in docs/TESTING-OPTIMIZATION-PLAN.md);
- **Project-level config is applied once per session**: trust is resolved at startup;
  granting trust mid-run does not back-apply it;
- **Registry version mismatch triggers rebuild**: when `schemaVersion !== 1`, the new
  team overwrites the old data;
- **Pure-logic probes must run standalone**: phase15/16 transitively import
  `@step-harness/pi-tui`, which triggers step's staged loading of the repo package and
  conflicts with the `-e` original copy — the runner's `STANDALONE_PHASES` mechanism
  does not mount index.ts (see the run-smoke.sh comments);
- **depth ≥ 3 has no real LLM chain test** (process-level self-bootstrap is verified).
