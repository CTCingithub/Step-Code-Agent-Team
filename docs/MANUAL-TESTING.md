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
> extension and activates it), and the **tool-availability self-heal** (phase22:
> `ensureToolsAvailable` restores the team tools after a host-side reset, and
> `session_start` re-activates a session whose team registry already exists), and the **tool JSON-schema contract** (phase23) asserts every team tool and every top-level parameter carries a non-empty description — the guard that would have caught the typebox two-argument Optional description drop), and the **confirmation-path merge contract** (phase24: a fake ExtensionAPI plus a scripted context drives the real factory — Accept forwards the request verbatim with the plan injected, a custom input's note merges verbatim, an empty submission accepts as shown, Cancel injects the activation-only instruction — 6 assertions), the **activation-guard sentence anchoring** (phase6: a how-to request with a body activates, a pure question about the plugin itself stays suppressed), **preset loading and the project-tier trust gate** (phase3), and the **deprecated-keyword stripping semantics** (phase6/phase9).
>
> What remains is only the **irreducible** manual items. Start with the **Round
> runbook** below for the full one-round sequence; each section after it is the
> per-scenario detail, with **directly copy-pasteable commands / prompts**. The TUI
> rendering checklist (look-and-feel only; the content layer is asserted by phase15)
> is §1.

## Status overview (2026-10-29)

> Automation baseline re-verified **2026-10-30 (R17, the manual-round-driven round)**: full gate green; tsc zero; probes 5a/5b/5c/7/8/9 all PASS. The 2026-10-29/30 manual round's two wrong conclusions are corrected in the docs (the ring chain-length semantics and the config file location), the config now traces which file it read and the effective values under `STEPCODE_TEAM_DEBUG=1`, the topology denial names its shape, and a teammate's reply carries provenance framing.
>
> Automation baseline re-verified **2026-10-29 (R16, the leftover-closure round)**: zero-token gate green again; **tsc across the whole import graph is now zero errors** (was 17); new probe scenario **5c** automates the pinned-tier KEYWORD path (the last item that still needed a manual spot-check), and a relative `storage.dir` now resolves under the agent dir instead of the launch directory.
>
> Automation baseline re-verified **2026-10-29 twice**: (R14, the v0.3.0 test-exhaustion round) zero-token smoke 20 phases + manifest + 7 live + orphan-check green; LLM layer phase4 4/4, phase10 A 2/2 + B 1/1, phase11 4/4 (zero SKIP), phase12 9/9. (R15, the UI-naming + Accept/Cancel/Other round) the same gate green again after the rename and the option reorder; phase24 now also asserts the option **order** (`Accept / Cancel / Other`) and that a **dismissed** Other input (Esc/timeout) cancels exactly like Cancel — which moves the "Esc cancels" data plane out of this manual set; live probes 5a/5b PASS on the new title and labels, 8 FAIL→PASS on re-run (mechanical assertion passed both times; only the member's LLM self-report flaked — the probe now prints that reply so a failure is diagnosable without a re-run).
| # | Item | Status |
|---|---|---|
| 1 | Interactive TUI look and feel | ✅ Verified 2026-10-22 (full walkthrough, no rendering issues) + 2026-10-25 rerun passed (no rendering issues; see the archive `sandbox/archive/20261025-194159-20261025-manual-round/`) |
| 2 | M1 real install / uninstall (`step install` from a clean export) | ➖ **Must-run manual item** — it writes your real settings, so **you run it yourself**; the mechanics are covered by `live-package-install` / `live-clean-export`, the interactive residue ⬜ yours (§2) |
| 3 | M2 trust prompt interactive UX | ➖ **Must-run manual item**; the rejection path is covered by `live-untrusted-config`, the popup itself ⬜ yours (§3) |
| 4 | LLM behavior adherence (ring) | ✅ 2026-10-22 + 2026-10-25 two rounds confirmed (two hops succeeded + the third hop rejected verbatim — the previously unobserved part is now confirmed) |
| 5 | Sandbox demo scripts (three acts) | ✅ 2026-10-22 + 2026-10-25 two reruns passed (the fix round 11/12→12/12; both parallel-review rounds changed nothing) |
| 6 | Performance subjective items (8 full members) | ➖ Optional, subjective |
| 7 | Actual-plan three-option confirmation (Accept / Cancel / Other) + generation spinner (new UI) | ➖ 2026-10-25: the three-tier Accept path measured end-to-end; **the custom-input path and the pinned tier were live-verified 2026-10-25 by RPC-driver probes** (`node sandbox/probe-remaining-manual.mjs 5a` / `5b`: the user's text rides along verbatim; a pinned tier suppresses the picker); only TUI key feel remains ⬜ (M3: no countdown / Esc / empty submit); **re-verified 2026-10-29 (R14) on the final product code** — 5a PASS (the note rides along verbatim; `team_create_member`/`team_set_topology`/`team_send` follow the confirmation) and 5b PASS (picker and confirmation both suppressed); **R16 adds probe 5c** — the pinned tier on the keyword path, verified live (neither dialog appears, and the plugin provably activated), which removes the last manual spot-check |
| 8 | Activation guard L1 (rewritten 2026-10-23) | ✅ 8 phase6 cases green + **live-verified 2026-10-25 by an RPC-driver probe** (`probe-remaining-manual.mjs 7`: zero team actions for the meta question; a how-to with a body activates and `team_create_member` really works); **re-verified 2026-10-29 (R14)** — both sub-checks PASS on the final product code |
| 9 | Custom roles (agent-dir + trusted project tier) | ➖ phase3 covers loading and the trust gate + **live-verified 2026-10-25** (`probe-remaining-manual.mjs 8`: the frontmatter's tools/effort/prompt land on a real spawn and the member self-reports the allowlist incl. topo_team_msg); **re-verified 2026-10-29 (R14)** — the create-result half passed twice, the member self-report flaked once and passed on re-run (an LLM-behavior assertion, not a mechanical one); the project tier still needs the M2 trust flow ⬜ |
| 10 | Keyword migration notice | ✅ phase6/phase9 cover the stripping semantics + **live-verified 2026-10-25** (`probe-remaining-manual.mjs 9`: the notice appears exactly once per session); **re-verified 2026-10-29 (R14)** — exactly one notice on the final product code |
| — | English translation review | ⬜ Recommended |

## Round runbook (one complete test round)

The full sequence for one round — every other section in this document is detail
for a step here. All commands and prompts are directly copy-pasteable.

### Step 0 — preflight (before launching the session)

```bash
# Archive the PREVIOUS round's evidence first — restore clears logs/ (it auto-archives them, but archive-round.sh also keeps the session JSONL and team registry that restore does not touch, under a readable label)
bash sandbox/archive-round.sh <label-of-last-round>
# Reset the sandbox: seeded bug back in place, data/ and logs/ cleared
bash sandbox/restore-project.sh
```

The key: put it in `sandbox/TEST-KEY.md` (gitignored) — `./sandbox/run.sh` reads it
automatically (an exported `STEP_API_KEY` wins). From §1 step 5 onward a key is
required; without one those steps fail.

### Step 1 — automated gate (must be green before any manual work)

```bash
npm run smoke   # 20 phases + manifest + 7 live checks (+ orphan-check); stop and fix on any failure
```

### Step 2 — interactive scenarios (in order, one prompt at a time)

**Two activation paths — one per prompt, never both**: the **`/topo` command** (the request rides as its argument) or a **keyword prompt** (natural language containing a plugin keyword). The §5 demo acts use the command path; §1 step 1 and scenarios 7/8/9 exercise the keyword path. Writing `/topo` and keyword phrasing into the same prompt tests neither path cleanly.

**Numbers need evidence**: a member's output is an LLM statement — line counts, case counts and file counts are not tool-verified. In the 2026-10-30 round `scout1` reported `src/tasks.js` at 139 lines (actually 124), `test/tasks.test.js` at 132 (actually 146) and 13 cases (actually 12); the leader only caught it by re-running `wc -l`. State it in the brief — "every number in your report must come with the command you ran and its output" — and re-verify the key numbers yourself: correcting the presentation without correcting the member leaves the wrong figure in its context for the next round.

| # | Scenario | Do | Detail | Watch out for |
|---|---|---|---|---|
| 1 | Activation + team board | §1 steps 1–2 | §1 | — |
| 2 | Members + pipeline + task board | §1 steps 3–8 | §1 | — |
| 3 | `topo_team_msg` E2E | paste: `Have scout1 send worker1 a one-line intro through topo_team_msg and report the tool's exact return text` | §1, §4 | The reply is best-effort: a delivery acknowledgment ("Delivered to …") is not the teammate's answer — collect outputs through the leader |
| 4 | Ring tour (fast hops) | the §4 ring prompt | §4 | Keep each hop small (one file, one question) so every hop settles inside the 600s default `dispatch.timeoutMs` (it covers the member's whole turn, nested relays included) — and a timeout no longer triggers a blind retry: the task fails with harvest guidance instead. Run one loop; the leader collects the final list. **Ring closure**: `maxLoopCount` (default 2) counts the **nesting depth of relays inside one leader dispatch** — the leader's dispatch starts at 0 and each member→member forward adds one. If the relays nest continuously (no leader re-dispatch in between), a 3-member ring's closing hop (r3→r1) is rejected at the default; if the leader re-dispatches every hop, each starts from 0 and all succeed. To *observe* the bound: let r1→r2→r3 nest inside one dispatch. To close in-ring regardless: route the last hop through the leader, or raise `maxLoopCount` — and remember a config edit only takes effect after you **restart the session** (config is read once per session) |
| 5 | Plan picker / pinned tier | enable in `sandbox/config.toml`, **restart the session**, then `/topo <请求>` | §8 (TEST-PLAN K2/K3) | `plan.enabled` / `plan.tier` are read once per session — edit the config BEFORE launching; the confirmation offers **Accept / Cancel / Other** with no countdown and waits for your decision — choosing Other lets you type text that is sent to the model verbatim, appended to the forwarded request (Esc cancels) |
| 6 | Parallel review | `/topo review src/tasks.js` | TEST-PLAN K4 | — |
| 7 | Activation guard (L1) | paste: `如何用智能体小队并行审查这个仓库？` | §9 | Rewritten 2026-10-23: a how-to request with a body activates the plugin (the team forms); a pure question about the plugin itself (`什么是智能体小队？`) stays suppressed — no team forms |
| 8 | Custom roles (K6) | write `sandbox/agent/agents/quickfix.md` (frontmatter: `name` / `description` / `tools` / `effort`), restart, paste: `创建一个 quickfix 角色的成员，取名 fixer1，让它用一句话列出自己的工具白名单` | §10 | The frontmatter's prompt/tools/effort apply (the tool list shows the allowlist); project-level roles under `sandbox/project/.stepcode/agents/` load only in trusted projects (delete `sandbox/agent/trust.json` to re-trigger the popup) |
| 9 | Keyword migration notice (K7) | add `"智能体团队"` (deprecated) next to a plugin-specific term in `keywords` in `sandbox/config.toml`, restart, paste: `我想用智能体小队熟悉一下这个项目` | §11 | Activation still works via the plugin-specific term; the stripped deprecated terms are reported once on activation (and never again that session) |

**Must-run manual items (M1/M2)**: the real install/uninstall (§2 — it writes your real
settings, so **you run it yourself**) and the project-config trust popup (§3) are
**required** manual items, not optional; §2/§3 keep their current content and are called
out here so a round is not considered complete without them.

**Tier confirmation content (actual-plan rework)**: when `/topo` carries a request and
a tier is picked, the plugin first asks the model (one-off, plan-only call with a
"正在生成智能体拓扑协作方案" spinner) to draft the actual team plan for that request; the three-option selection (Accept / Cancel / Other) then shows that plan,
and on approval it is injected with precedence over the tier's general guidance. Bare
`/topo` (no request) or a failed planning call falls back to the tier's standard
shape — there is nothing request-specific to show yet.
The planning call is interactive-only — headless/RPC `/topo <request>` skips it and
confirms the tier's standard shape directly. The confirmation offers three options:
**Accept** (form the team with the plan as shown), **Other**
(your own text is sent to the model verbatim — no interpretation — appended to the
forwarded request; an empty submission accepts as shown), and **Cancel** (the request
still forwards, but only the activation instruction is injected — no team forms).

**Dispatch anomalies and recovery (from the 2026-10-24 sandbox round)**:

- **Settle timeouts**: a dispatch can fail with `timeout waiting for member to settle` — the member is killed fail-fast, but its work usually continues server-side (or resumes with context on the next dispatch). A settle timeout is now retried once automatically, but only when the member's usage proves the failed attempt did nothing (zero turns — usage is persisted server-side), so a retry can never duplicate work or billing; after real work the error still surfaces and recovery is manual: check `team_status`, then re-dispatch (a short "finish and report" message works). Nothing is lost.
- **Spawn/handshake failures retry automatically**: a failed member handshake (or `aborted before start`) is retried once inside `createMember` and task dispatch — the "no blind retry" rule above applies to settle timeouts, not to spawn-path failures.
- **Failed board tasks are re-dispatchable**: a task whose member was killed mid-run stays `failed`; `team_task start` on it re-dispatches and the member resumes — no need to rebuild the `blockedBy` chain (that deadlock is what forced the equivalent-task workaround in earlier rounds). A `detail` passed at start time is appended to the dispatch prompt, so harvest guidance can ride along.
- **`topo_team_msg` self-reports are unreliable**: members have reported both "delivered" and "tool unavailable" for messages that were in fact delivered. Verify actual delivery in `sandbox/agent/teams/<teamId>/sessions/*.jsonl` (look for the tool call) before trusting a member's claim in either direction.
- **Board ids come from `create`'s return**, not from your plan's numbering — `blockedBy` an unknown id and the create is rejected with the offending ids.
- **Presets ship with the package** (`agents/<role>.md`: scout/planner/worker/reviewer) and work in the sandbox too — pass `role:` to inherit a preset's read-only tools and effort instead of hand-building system prompts; an explicit role that matches no preset is called out in the create result.

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
| Session logs | `sandbox/logs/session-log-*.md` (generated on demand; the prompt is in [sandbox/README.md](../sandbox/README.md#session-log)) | `restore-project.sh` clears them (auto-archived first); run `archive-round.sh` to also keep the session JSONL and team registry |
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

**Before forming the team**: right after activation, ask for the team status first
(`Report the team's current status` → `team_status`) and confirm no leftover live
members from an earlier round — if any show up, disband them before creating new ones.

| # | Copy-paste | Expected render | Result |
|---|---|---|---|
| 1 | `I'd like to use the topo team feature to get familiar with this sandbox project` | First the L2 confirm (title "Topology Agent Team", body "Detected a team-request keyword. Enable Topology Agent Team?" — `confirmBeforeActivate` is on by default; see CONFIGURATION.md) → yes → activation notify: "Topology Agent Team activated (explicit plugin mention). Team tools are now available."; the team tools are visible to the model from then on | ☐ |
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
/topo Fix the failing tests in this project: first dispatch scout to locate the failing test and root cause, then dispatch planner to give a minimal fix plan, then dispatch worker to fix it per the plan and get npm test passing, and finally dispatch reviewer to review the changes. Before fixing, first confirm the npm test baseline.
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
/topo Review this project in parallel: dispatch three reviewers to review src/ and test/ from the correctness, style, and security angles respectively, and consolidate the three parties' findings into one list.
```

**Expected**: the three members work in parallel (concurrency is visible in
`team_status`); the leader consolidates the three parties' findings (the findings list
against the demo code is recorded in `docs/TEST-PLAN.md` section 8).
**Between-act restore**: `bash sandbox/restore-project.sh`.

### Act 3 · ring round-robin review (copy-paste, ✅ 2026-10-19 measured)

```text
/topo Run a round-robin review: create three reviewer members, declare a ring topology, let the review comments pass along the ring, each member adding what the previous one missed, and mind the ring's chain-length cap.
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

## 8. Scenario 5 — plan picker: custom input (5a) and pinned tier (5b)

Both sub-scenarios share the same precondition chain: `[stepcodeAgentTeam.plan] enabled = true` in `sandbox/config.toml` (already on in the seeded sandbox), **restart the session** (`plan.enabled` / `plan.tier` are read once per session — edit the config BEFORE launching), and an **interactive TUI** (`./sandbox/run.sh`). The planning call is interactive-only — headless/RPC `/topo <request>` skips it and confirms the tier's standard shape directly, so a dialog-less round proves nothing about 5a.

### 5a · Other (free-text input) path (highest priority)

**What it tests**: the full dialog chain — `/topo <请求>` → tier select (four tiers + 自定义需求…) → the "正在生成智能体拓扑协作方案" spinner (the one-off, plan-only model call) → the three-option confirmation (Accept / Cancel / Other) — and specifically the **Other** branch: your free-form text must reach the model **verbatim** — trimmed, then appended to the forwarded request after a blank line, with no interpretation or restructuring.

**Preconditions**: `plan.enabled = true` in `sandbox/config.toml`; session restarted after the edit; interactive TUI; a fresh session (disband any leftover live team first — `Report the team's current status`).

**Action** (paste one line, then walk the dialogs):

```text
/topo 修复这个项目里失败的测试
```

1. In the tier select pick any tier (e.g. 均衡/balanced).
2. Wait for the spinner to finish — the drafted plan shows in the notify above the confirmation.
3. In the three-option confirmation choose **Other** (no countdown — it waits for your decision).
4. In the free-text input type one sentence, e.g.:

```text
优先保持改动最小：只修 src/tasks.js，不要动其他文件。
```

**Expected**: the plugin forwards your original request **plus your sentence, verbatim**, as one user message, and the model acts on both. Verify in the session JSONL: the text appears exactly as typed (outer whitespace trimmed only), appended after a blank line — the leader session under `sandbox/agent/sessions/*.jsonl` carries the forwarded user message; once members are dispatched, `sandbox/agent/teams/<teamId>/sessions/*.jsonl` carries the derived dispatch prompts. Then confirm the two sibling branches once each: an **empty submission** accepts the plan as shown (nothing appended), and **Esc** (on the select or the input) cancels — the request still forwards, but only the activation instruction is injected and no team forms.

**Automated coverage**: phase24 drives the whole confirmation chain with a fake ExtensionAPI plus a scripted context and asserts the merge contract (6 assertions: Accept forwards the request verbatim with the plan injected / a custom input's note merges verbatim / an empty submission accepts as shown / Cancel injects the activation-only instruction).

**Live verification (2026-10-25, RPC-driver probe)**: `node sandbox/probe-remaining-manual.mjs 5a` walks the whole chain with a scripted RPC client — answers the tier picker (balanced) → the spinner and the model-drafted plan → picks Other in the three-option confirmation → types `只要 1 个只读成员，不要修改任何文件`. The forwarded user message in the session JSONL is "the original request + a blank line + that text" (character-for-character, only outer whitespace trimmed), after which the model calls `team_create_member` normally. "The text reaches the model verbatim" now holds on a **real host dialog plus a real LLM round-trip**; what the probe cannot cover is TUI pixel and key feel (Esc / empty submit / no countdown — M3).

**Why manual**: the dialog is host-rendered TUI (phase24 only scripts it), and "the text reaches the model unchanged and is acted on" is observable only end-to-end with a real model turn.

**Restore**: `bash sandbox/restore-project.sh` (+ optional full reset, see §0).

### 5b · Pinned tier (K3)

**What it tests**: with `plan.tier` pinned, the tier picker never appears — the pinned tier applies on **both** activation paths (the `/topo` command and a keyword prompt).

**Preconditions**: set `[stepcodeAgentTeam.plan] tier = "fast"` (keep `enabled = true`) in `sandbox/config.toml`, **restart the session**, interactive TUI.

**Action** (two separate prompts — one path each, never mixed):

```text
/topo 统计这个项目的源文件数量
```

then, for the keyword path, a fresh activation (new session, or after the first settles):

```text
用智能体小队统计一下这个项目的源文件数量
```

**Expected**: neither path shows the tier select — each goes straight to the fast tier. **A pin means "stop asking": neither the picker, the spinner, nor the three-option confirmation appears on either path** (fixed 2026-10-25: the command path used to still pop the confirmation box while the keyword path applied the pin directly); the request is forwarded verbatim with the fast tier's instruction injected. No "always ask" picker at any point.

**Automated coverage**: phase21 asserts the tier table itself (four tiers, five modes, bilingual labels, unknown-id fallback); phase24 drives the confirmation with `plan.enabled` toggled through the resetConfigCache hook.

**Live verification (2026-10-25, re-run after the fix)**: `probe-remaining-manual.mjs 5b` pins `plan.tier` to `"fast"` and runs `/topo <request>` — the tier picker does **not** appear and neither does the three-option confirmation (both negative assertions pass; the request is forwarded verbatim). The command path is live-verified.

**Live verification (2026-10-29, R16)**: the new `probe-remaining-manual.mjs 5c` covers the **keyword path** — a natural-language keyword prompt under a pinned tier, asserting neither dialog appears **and that the plugin really activated** (otherwise "no dialog" could pass because nothing happened at all — the first run caught exactly that false green, where an unanswered L2 confirm meant the plugin never activated). Both activation paths are now live-verified.

**Why it is no longer manual**: the negative assertions plus the activation assertion hold on a real host dialog and a real LLM round-trip; what remains is TUI pixel and key feel (M3).

**Restore**: set `tier = "always ask"` back in `sandbox/config.toml`, then `bash sandbox/restore-project.sh`.

## 9. Scenario 7 — activation guard (L1)

**What it tests**: the sentence-anchored false-positive guard — a keyword hit that is a real usage request activates the plugin and forms a team; a pure question about the plugin itself stays suppressed.

**Preconditions**: a brand-new session in the un-activated state (restart the sandbox session; do not reuse one where the team tools are already live). Keyword path only — never mix `/topo` into these prompts.

**Action** (paste, one at a time, in a fresh session):

```text
如何用智能体小队并行审查这个仓库？
```

```text
什么是智能体小队？
```

**Expected**: the first prompt activates — first the L2 confirm (yes) → the activation notify appears, the team tools become available, and the leader forms a team and dispatches the parallel review. The second prompt stays suppressed — no confirm, no activation notify, no team tools, no team forms; the model just answers the question about the plugin itself.

**Live verification (2026-10-25)**: `probe-remaining-manual.mjs 7` runs two isolated sessions — 「什么是智能体小队？」 produces no activation notify and **zero** team tool calls (PASS); 「如何用智能体小队并行审查这个仓库？」 activates after the confirm is answered, and the follow-up "create a scout member" produces a real `team_create_member` call (PASS).

**Automated coverage**: phase6 anchors eight sentence-level cases (a how-to request with a body activates; a pure how-to question is suppressed; negation and doc/code references are suppressed; clause-separated negation still activates). Missing: the real-model end — whether an activated how-to request actually produces a team, and whether a suppressed meta-question produces no team activity at all.

**Why manual**: the guard only decides *whether* to activate; the observable outcome (notify + team tools + team formation, or none of them) exists only in a real session.

**Restore**: `bash sandbox/restore-project.sh` (+ optional full reset, see §0).

## 10. Scenario 8 — custom roles (K6)

**What it tests**: a user-tier preset under `<agentDir>/agents/` — its frontmatter (`name` / `description` / `tools` / `effort`) applies when a member is created with that role — and that the project tier loads only in a trusted project.

**Preconditions**: interactive TUI; a session restart after writing the preset file (presets are loaded at startup).

**Action**:

```bash
mkdir -p sandbox/agent/agents
cat > sandbox/agent/agents/quickfix.md <<'EOF'
---
name: quickfix
description: Fast minimal fixes — read-only diagnosis plus one targeted edit
tools: ["read", "edit", "grep"]
effort: low
---
You are the quickfix role: diagnose the smallest possible fix, apply exactly one
targeted edit, and report the change in one sentence. Never refactor beyond the fix.
EOF
# restart the sandbox session, then paste:
```

```text
创建一个 quickfix 角色的成员，取名 fixer1，让它用一句话列出自己的工具白名单
```

**Expected**: `team_create_member(role="quickfix")` applies the preset — the create result and the member's own one-sentence answer show the allowlist from the frontmatter (`read`/`edit`/`grep`) **plus the infrastructure `topo_team_msg`** (added on top of every member's tool list; no bash needed).

**Pitfall (by design)**: the sandbox's `sandbox/config.toml` sets `models.autonomousEffort = true`, under which **every** frontmatter/preset effort is inert — the leader picks the effort per member, so `effort: low` is ignored and the create result shows `effort=high`. To verify the frontmatter effort actually lands, set `autonomousEffort = false`, restart the session, and rerun — then `effort=low` shows up. This is documented behavior (see [CONFIGURATION.md](CONFIGURATION.md) `models.autonomousEffort`), not a bug.

**Project-level roles**: a preset under `sandbox/project/.stepcode/agents/` loads only while the project is trusted — delete `sandbox/agent/trust.json` and restart to re-trigger the §3 trust popup; until trust is granted, the project tier is skipped entirely.

**Automated coverage**: phase3 asserts preset loading across the three tiers (bundled `< agentDir>/agents/` < trusted project) and the trust gate (an untrusted project's presets never load).

**Live verification (2026-10-25)**: `probe-remaining-manual.mjs 8` writes quickfix.md (`tools: read, grep, edit, bash`, `effort: low`, with `models.autonomousEffort` set to `false`) in an isolated agentDir and creates the member via `/topo` — the create result reads `Created member "fixer1" (role: quickfix) … effort: low; tools: read, grep, edit, bash`, and the member self-reports "read, grep, edit, bash, topo_team_msg", exactly the frontmatter allowlist plus the infrastructure tool.

**Why manual**: preset application happens inside a spawned member process on a real model turn; the allowlist and the effort only become visible in the member's actual behavior.

**Restore**: remove `sandbox/agent/agents/quickfix.md` (and any project-tier preset), then `bash sandbox/restore-project.sh`.

## 11. Scenario 9 — keyword migration notice (K7)

**What it tests**: a deprecated keyword sitting in `activation.keywords` is stripped on load, activation still works through the plugin-specific terms, and the stripping is reported **once** per session.

**Preconditions**: interactive TUI; a session restart after editing the config (keywords are read once per session).

**Action**:

```bash
# in sandbox/config.toml, add the deprecated term next to a plugin-specific one:
#   keywords = [ "智能体团队", "智能体小队", "多智能体小队", "topo team", ... ]
# then restart the session and paste:
```

```text
我想用智能体小队熟悉一下这个项目
```

**Expected**: the migration notice appears once — "Migrated activation config: removed deprecated keywords (智能体团队). Use current keywords like 智能体小队 / topo team." (delivered on session start, so you see it right after the restart, before any prompt). The prompt then activates normally through the plugin-specific term `智能体小队`, and the team forms. Paste the same prompt a second time: the notice does not repeat (it is consumed once per session) and activation proceeds as usual.

**Automated coverage**: phase6/phase9 assert the stripping semantics (a partially-deprecated list keeps the rest; an all-deprecated list disables keyword activation — migration narrows, never widens, the activation surface). Missing: the one-time, user-visible notify in a real session.

**Live verification (2026-10-25)**: `probe-remaining-manual.mjs 9` sends the same prompt twice — the migration notice appears exactly once and not again (PASS). "Exactly once" is now verified on a real restart-plus-reprompt cycle.

**Why manual**: the notice is a host `ctx.ui.notify`; its pixel form and dwell time remain look-and-feel items (M3/M4).

**Restore**: remove `"智能体团队"` from `keywords` in `sandbox/config.toml`, then `bash sandbox/restore-project.sh`.

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
