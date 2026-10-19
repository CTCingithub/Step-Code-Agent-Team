# TUI Manual Verification Checklist

> [简体中文 →](./TUI-VERIFICATION_CN.md)
>
> The **rendered content** of `render.ts` (renderCall / renderResult) is already
> asserted headless by the phase15 probe (the six tools' call/result strings,
> collapse/expand, usage rows, status icons); what is left in this checklist is
> only **look, feel, and interaction** (color/layout, toast dwell time, ctrl+o,
> streaming rhythm). Everything runs inside the sandbox, isolated from your real
> `~/.stepcode`; it involves model calls, so export the test key first (passed
> only through the environment).
>
> **Verification record (2026-10-18)**: the `/topo <request>` full chain
> has been manually verified in a real TUI — activation, the team board, argument
> forwarding, a real 7-member two-topology (pipeline + star) team run, and
> T1→T4 task board transitions all work (see the manual test records in
> [MANUAL-TESTING.md](MANUAL-TESTING.md) §5); on 2026-10-19 the user completed the
> interactive walkthrough per the checklist below and **found no rendering issues**.
> A re-run is only needed when render.ts changes.

## 0. Environment setup (copy-paste)

```bash
cd <path to this repo checkout>      # e.g. cd ~/GitProjects/Step-Code-Agent-Team
export STEP_API_KEY="$(grep -m1 '^STEP_API_KEY=' local/test-api-key.md | cut -d= -f2)"
./sandbox/run.sh                     # starts step inside sandbox/project, with this extension loaded
```

`run.sh` points agentDir/session/plan at `sandbox/agent/*` and cwd at
`sandbox/project`, fully isolated from your real `~/.stepcode`. Without a key,
dispatching work to members fails; from step 5 of this checklist onward a key is
required.

## 1. How to use

Each step of the checklist is **a single copy-pasteable prompt line**: once the
leader model receives it, it calls the matching team tool on its own, and all you
have to do is check that the rendering matches the "Expected render" column.
Paste them in order; between steps, wait for the previous render to finish before
pasting the next one. Step 6 is a key press, not a prompt.

## 2. Checklist (paste in order)

| # | Copy-paste | Expected render | Result |
|---|---|---|---|
| 1 | `I'd like to use the topo team feature to get familiar with this sandbox project` | Activation notify: "Agent team plugin activated (explicit plugin mention). Team tools are now available."; the team tools are visible to the model from then on | ☐ |
| 2 | `/topo` | Team board notify: `Team "<id>"` + member rows (○/●/✗ icon + role + status + model/thinking) + task rows (including blockedBy) + `spend: $x.xxxx`; when the team is empty it prompts you to use team_create_member | ☐ |
| 3 | `Create a member with the scout role, named scout1` | renderCall: `team +scout1 (scout)`; renderResult: `✓ scout1 (scout) [idle] … thinking=high` | ☐ |
| 4 | `Create another member with the worker role, named worker1` | Same as step 3: `+worker1 (worker)` / `✓ worker1 (worker) [idle]` (provides the second member for step 7's pipeline topology) | ☐ |
| 5 | `Ask scout1 to introduce himself in one sentence` | renderCall: `team → scout1` + message preview (≤70 chars); during a long run onUpdate streams updates (first "(member is working...)", then interim text); renderResult: usage row (`1 turn, $x.xxxx`) + the reply body (collapsed to 3 lines by default, with "(ctrl+o to expand)") | ☐ |
| 6 | *(key press, not a prompt)* Press `ctrl+o` on step 5's result | The full body expands; press again to collapse it | ☐ |
| 7 | `Set the messaging topology to pipeline, then have scout1 say hi to worker1` | renderCall: `team topology pipeline` (a named shape passes no edges, so there is no edge count; if the model explicitly passes edges, ` N edge(s)` is appended); renderResult header: `pipeline · 1 edge(s)` (scout1→worker1); then `team → scout1` dispatches successfully (allowed in the pipeline direction) | ☐ |
| 8 | `Create a task: count the source files in this project, assign it to scout1, then start it` | renderCall: `team task create T1 count the source files in this project` → `team task start T1`; renderResult: `T1 [done] @scout1 count the source files in this project` + the reply body | ☐ |
| 9 | `Report the team's current status` | One line per member (icon + name + role + usage), tasks line by line (id [status] title, 50-char preview) | ☐ |
| 10 | `Disband worker1` | renderCall: `team −worker1`; renderResult: `worker1` | ☐ |
| 11 | *(exit)* Press `Ctrl+C` twice or `/quit` to leave the sandbox session | No orphan member processes: `pgrep -f 'team-.*-scout1'` is empty | ☐ |

## 3. Wrap-up: session log (optional) and sandbox restore

To keep a process record of this verification run, first paste the prompt below
and let the leader generate the log:

```text
In the repo's sandbox/ directory (not sandbox/project), create a log file session-log-<today's date>.md recording this session's user prompts, your work log, and each member's replies
```

Then restore the sandbox. Demos/verification change `sandbox/project/` (a member
may fix the seeded bug) and produce runtime state such as sessions and team
registries. Pick what you need:

**Quick restore (required after every verification round)** — restore the demo
project to its seeded-bug state and clear the runtime data:

```bash
bash sandbox/restore-project.sh
```

**Full reset (optional, when you want a fresh sandbox)** — delete the gitignored
sandbox runtime state (sessions, team registries, plans, live-context, the demo
project's data/; does not touch any checked-in file in the repo):

```bash
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

> `sandbox/agent/trust.json` (the project trust record) is kept — it is the
> sandbox's own runtime state, and deleting it only makes the trust prompt pop up
> once next time, with no other effect. The sessions/teams under `cfg-*` are
> runtime state too; clean them the same way when needed.

## 4. Notes

- Verification date / step version / failed items and notes: ＿＿＿＿
