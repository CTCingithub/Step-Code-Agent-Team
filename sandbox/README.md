# Sandbox

> [简体中文 →](./README_CN.md)

Isolated dev/test environment that ships with the repo. All development
happens here, fully isolated from your real `~/.stepcode` — **runtime state is
never committed** (the agent dir, sessions, team registries, `auth.json`, etc.
are all in .gitignore).

## Quick start

```bash
# Key (only needed when a model call is involved; never written to disk):
#   put it in sandbox/TEST-KEY.md (gitignored), or export STEP_API_KEY=<your own key>
./sandbox/run.sh                     # launch step in sandbox/project (this extension already loaded)
```

After startup, type `/topo <your request>` in the session to form an
agent team.

## Contents

| Path | Description |
|---|---|
| `run.sh` | Sandbox launcher: isolates agentDir/session/plan, cwd points at `project/` (reads the key from `TEST-KEY.md`) |
| `probe.sh` | Zero-token protocol probe (expects `PROBE OK`) |
| `archive-round.sh` | Archives a round's evidence (sessions JSONL, team registries, `logs/`, project diff) to `archive/<timestamp>-<label>/` (gitignored) — run it BEFORE `restore-project.sh` |
| `restore-project.sh` | Restores the sandbox test environment: resets `project/` to its initial seeded state (including the off-by-one seeded bug), clears runtime data and session logs (`session-log-*.md`, `logs/`) |
| `project/` | Demo project: zero-dependency Node.js task manager (`npm test`: 12 tests, 11 pass with the seeded bug in place) |
| `project-pristine/` | Initial snapshot of the demo project (the source for restore; do not modify) |
| `smoke-phase4/10/11/12.ts` | LLM-layer regression probes (need a key; see docs/TESTING.md for how to run) |
| `probe-remaining-manual.mjs` | RPC-driver live probes for the formerly-manual scenarios (needs the key): `node sandbox/probe-remaining-manual.mjs <5a\|5b\|7\|8\|9\|all>` — answers the host dialogs (select/input/confirm) to drive the plan confirmation, the L1 guard, custom roles and the migration notice; each subcommand uses an isolated temp agentDir and must run from the leader's own process (and with the six `STEPCODE_TEAM_*` variables unset — inside a member process they are inherited by the probe's own `step` child, whose extension then reads depth 1 ≥ `maxRecursionDepth` 1 and stays inert, so every probe false-fails). `all` runs every scenario in its own child process (one mktemp agentDir each) and prints a per-scenario verdict plus a summary line |
| `cfg-*/settings.json` | Probe config fixtures (staged through the legacy settings.json tier, still honored). Live: `cfg-conc` (phase10 Branch A), `cfg-deadlock` (phase10 Branch B), `cfg-deep2` (phase11); the rest are legacy with no live consumer (phase9 builds its own mktemp fixture). A local `sandbox/config.toml` shadows these — isolate the probe's agentDir (see docs/TESTING.md Layer C) |
| `TEST-KEY.md` | Test API key (gitignored — one `STEP_API_KEY=<key>` line; read by run-smoke.sh and with-test-key.sh) |
| `with-test-key.sh` | Runs a command with the key from TEST-KEY.md exported (used for the Layer C LLM probes) |
| `step/` | Step Code source submodule (pins the version this sandbox tracks) |
| `step-bin.sh` | step binary resolver (sourced by the scripts) |
| `build-step.sh` | Optional: builds step from the submodule to `sandbox/step-build/` |

The sandbox dir keeps only READMEs and scripts; the test plan and execution
history live in [../docs/TEST-PLAN.md](../docs/TEST-PLAN.md).

## Step Code source (git submodule)

`sandbox/step` is a git submodule of [Step Code](https://github.com/stepfun-ai/Step-Code)
(MIT licensed), pinning the Step Code revision this sandbox tracks — when step
upgrades you only bump the submodule pointer and re-run the regression suite,
instead of passively following changes to the global install.

- **When cloning this repo**: use `git clone --recurse-submodules`, or after
  cloning run `git submodule update --init sandbox/step`.
- **step binary resolution order** (`sandbox/step-bin.sh`, which run.sh /
  probe.sh / test/run-smoke.sh all use to locate the binary):
  1. `$STEPCODE_STEP_BIN` — explicit override;
  2. `sandbox/step-build/step` — built from the submodule by `sandbox/build-step.sh`;
  3. `step` on PATH — global install (default, i.e. the current regression baseline).
- **Build from the pinned source** (optional, heavy: pnpm install + full build
  + bun compile, a few minutes and a few GB of disk):
  ```bash
  bash sandbox/build-step.sh   # output exposed via symlink as sandbox/step-build/ (gitignored)
  ```
- **Update the submodule** (after step ships a new release):
  ```bash
  git submodule update --remote sandbox/step   # pull the latest of the upstream default branch
  npm run smoke                                # full regression
  git add sandbox/step                         # commit the new pointer
  ```
- Upstream has no tags (the product version is injected at build time), so the
  pin is by commit SHA; `.gitmodules` sets `ignore = untracked`, so build
  artifacts inside the submodule won't pollute the main repo's `git status`.

## Demo script

1. **pipeline fix chain**: scout locates the seeded bug → planner produces a
   plan → worker fixes → reviewer reviews
2. **star parallel review**: three reviewers review in parallel, the leader
   merges the findings
3. **ring round-robin review**: watch how `topology.maxLoopCount` bounds the
   review chain length

Run `bash sandbox/restore-project.sh` to restore before each demo round, and
record the round afterwards as described in [Session log](#session-log) below.
`project/secret-sample.txt` is a **fake secret**, used to verify the
path-protection guardrail (members must not read or exfiltrate it).

## Session log

After each sandbox test round, have the agent write the process to
`sandbox/logs/session-log-<date>.md` (gitignored, kept locally; cleared
together with the seeded state by `restore-project.sh` — run
`bash sandbox/archive-round.sh <label>` first to preserve the evidence).
Paste this prompt into the session (or hand it to the leader at the end of
the round):

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

## Running tests

```bash
npm run smoke            # full zero-token smoke (no key needed)
bash test/run-smoke.sh 5 # phase5 needs a key (from the environment or sandbox/TEST-KEY.md)
```

**What the gate runs**: 20 phases — the list is derived on disk from
`test/smoke/phase*.ts`; phases 15/16/23/24 run standalone (no extension loaded,
avoiding the tool-name conflict with an installed package copy); phase 5 needs a
key; after the phases: a manifest check, 7 live checks (which must run from the
leader's own clean process — inside a member process they fail wholesale, a
known false negative), and a 15s orphan-process poll. A failed phase is retried
once on a fresh session id (the first-failure line is prefixed `attempt1`, so a
passing retry leaves no bare `FAILED` line for CI to misread); `OPT_OUT_PHASES`
skips listed phases. Full reference: [../docs/TESTING.md](../docs/TESTING.md).
Before any restore, run `bash sandbox/archive-round.sh <label>` — it keeps the
session JSONL and team registry that `restore-project.sh` does not touch.

How to run the LLM-layer probes: [../docs/TESTING.md](../docs/TESTING.md);
how to configure them: [../docs/CONFIGURATION.md](../docs/CONFIGURATION.md)
(the `[stepcodeAgentTeam]` table of `sandbox/config.toml`).
