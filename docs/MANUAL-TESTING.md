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
> What remains is only the **irreducible** manual items — ordered by priority. Each one
> comes with a **directly copy-pasteable command / prompt**; the detailed TUI rendering
> checklist is in [TUI-VERIFICATION.md](TUI-VERIFICATION.md) (the content layer is
> already asserted by phase15; only look-and-feel remains).

## Status overview (2026-10-19)

| # | Item | Status |
|---|---|---|
| 1 | Interactive TUI look and feel | ✅ Verified 2026-10-19 (no rendering issues found) |
| 2 | Real install (`step install` from a clean export) | ⬜ To be run by you |
| 3 | Trust prompt interactive UX | ⬜ To be run by you |
| 4 | LLM behavior adherence (ring) | ✅ Verified 2026-10-19 (third hop avoided + reported to the leader) |
| 5 | Sandbox demo scripts (three acts) | ✅ Verified 2026-10-19 |
| 6 | Performance subjective items (8 full members) | ➖ Optional, subjective |
| — | English translation review | ⬜ Recommended (new bilingual docs this round) |

## 0. General: sandbox environment and restore

All manual items run inside the sandbox (`./sandbox/run.sh`, isolated from the real
`~/.stepcode`). The sandbox has two kinds of state, and the tests modify both:

| State | Location | Restore method |
|---|---|---|
| Demo project | `sandbox/project/` (demo state with the seeded bug) | `bash sandbox/restore-project.sh` |
| Runtime data | `sandbox/agent/{sessions,teams,plans,live-context}`, `sandbox/project/data/` (all gitignored) | Optional full reset, see below |
| Session logs | `sandbox/session-log-*.md` (generated on demand; the prompt is in [TUI-VERIFICATION.md](TUI-VERIFICATION.md) §3) | `restore-project.sh` deletes them automatically |

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

**Action**: follow the [TUI-VERIFICATION.md](TUI-VERIFICATION.md) checklist and
copy-paste the prompts step by step (environment setup, the 11-step prompts, and the
closing restore are all in that document), and tick the boxes after checking the look
and feel.

**Verification record (2026-10-19, ✅ passed)**: the user completed the interactive
walkthrough per the checklist and **found no rendering issues**; this checklist only
needs a re-run when `render.ts` changes.

## 2. Real install writes settings (one-time, you run it)

`step install` writes your real settings, so you run it. Local-path installs are
**reference-only** (no copy — the path is recorded and resources load per the
manifest), so installing the checkout directly is fine:

```bash
step install <absolute path to the repo>
```

**Expected**: after install, a new session can activate, members can spawn, and
the package's `skills/` (team-orchestration) and `prompts/` (team-review)
resources are available (declared in the manifest); `step remove <same path>`
uninstalls.

**Verify the install works** (open a normal session after installing, paste):

```text
Use the topo team feature to introduce yourself
```

**Uninstall verification**: `step remove <absolute path to the repo>`, then start
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
after receiving a rejection they report to the leader instead of retrying repeatedly or
going off to investigate tools.

**Action** (paste in order inside a sandbox session):

```text
Use the topo team feature for a round-robin review: create three members with the reviewer role, r1, r2, r3, declare a ring topology, have r1 first review the correctness of src/tasks.js, then pass the review comments along the ring to the next member, with each member adding its own findings after receiving the previous member's comments.
```

**Expected**: `team_set_topology ring` declares 3 edges; the two hops r1→r2 and r2→r3
succeed; the third hop (r3→r1) exceeds `topology.maxLoopCount` (default 2) — the member
**does not attempt** that hop (anticipating rejection), or attempts it and is rejected
by the server with an error listing the allowed neighbors and "report to the leader";
in either form the member should report its conclusion to the leader, rather than
retrying the same hop repeatedly or switching to investigating the environment/tools.

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
8/8 (pre-fix baseline 7/8), a file-by-file comparison with `project-pristine` shows a
difference only in `src/tasks.js`, and `secret-sample.txt` was never read by any
member. The third act (ring round-robin) and the security hardening await the user's
decision.

**Measured record (2026-10-19 rerun)**: all three acts retested — the pipeline fix
chain passed 8/8 and the reviewer issued APPROVE (note the reviewer preset is read-only
with no shell, so it can only review statically; `npm test` is re-run by the leader
itself, by design); the star three-way parallel review produced a graded findings list
(against the demo code; M1/M2 are fixed, the rest recorded in `sandbox/TEST-PLAN.md`
section 8); the ring round-robin two-hop relay succeeded and the third hop was avoided
per protocol (details in §4 and the third act below).

### Act 1 · pipeline fix chain (copy-paste)

```text
/topo Use the topo team to fix the failing tests in this project: first dispatch scout to locate the failing test and root cause, then dispatch planner to give a minimal fix plan, then dispatch worker to fix it per the plan and get npm test passing, and finally dispatch reviewer to review the changes. Before fixing, first confirm the npm test baseline.
```

**Expected**: the task board T1→T4 flows per `blockedBy`; after the worker's fix `npm
test` is 8/8; a file-by-file comparison with `project-pristine` shows a difference only
in `src/tasks.js`; `secret-sample.txt` is never read by any member. (The reviewer
preset is read-only: its review conclusion is a static trace; `npm test` is re-run for
real by the leader.) **Between-act restore**: `bash sandbox/restore-project.sh`.

### Act 2 · star parallel review (copy-paste)

```text
/topo Use the topo team to review this project in parallel: dispatch three reviewers to review src/ and test/ from the correctness, style, and security angles respectively, and consolidate the three parties' findings into one list.
```

**Expected**: the three members work in parallel (concurrency is visible in
`team_status`); the leader consolidates the three parties' findings (the findings list
against the demo code is recorded in `sandbox/TEST-PLAN.md` section 8).
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
timeout (`dispatch.timeoutMs`, default 180s) covers the **entire nested relay chain** —
when a chain of three high-thinking reviewers exceeds 180s, the leader-side timeout
returns while the relay continues on the server side (the dispatched members are reaped
per the kill-on-failure semantics; the error message indicates the relay may still be
in flight and lists member status). Recovery path: use `team_status` to see who is
still alive → reach the still-running members directly to collect the summary. To
avoid the timeout: raise `dispatch.timeoutMs` in `sandbox/config.toml` before
the session (config is read only once at session startup).

**Closing restore**: `bash sandbox/restore-project.sh`.

## 6. Subjective performance items

Spawn handshake latency with a full 8-member roster and TUI responsiveness —
subjective, with no pass criteria.

**Action** (optional): paste `Use the topo team to review this project in parallel,
with as many members working at once as possible`, and observe whether the handshake
time at a full 8-member roster and the TUI refresh are acceptable. **Restore**: see §0.

## Known limitations (review-confirmed, not fixing for now)

- **Kill-on-failure semantics**: any dispatch failure kills the member process and
  restarts it on the next dispatch (prevents old and new runs from interleaving on the
  same session-id; see P0-2 in docs/TESTING-OPTIMIZATION-PLAN.md);
- **Project-level config is applied once per session**: trust is resolved at startup;
  granting trust mid-run does not back-apply it;
- **Registry version mismatch triggers rebuild**: when `schemaVersion !== 1`, the new
  team overwrites the old data;
- **Pure-logic probes must run standalone**: phase15/16/17 transitively import
  `@step-harness/pi-tui`, which triggers step's staged loading of the repo package and
  conflicts with the `-e` original copy — the runner's `STANDALONE_PHASES` mechanism
  does not mount index.ts (see the run-smoke.sh comments);
- **depth ≥ 3 has no real LLM chain test** (process-level self-bootstrap is verified).
