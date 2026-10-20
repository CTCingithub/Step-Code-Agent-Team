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
| `run.sh` | Sandbox launcher: isolates agentDir/session/plan, cwd points at `project/` |
| `probe.sh` | Zero-token protocol probe (expects `PROBE OK`) |
| `restore-project.sh` | Restores the sandbox test environment: resets `project/` to its initial seeded state (including the off-by-one seeded bug), clears runtime data and session logs (`session-log-*.md`, `logs/`) |
| `project/` | Demo project: zero-dependency Node.js task manager (`npm test`: 12 tests, 11 pass with the seeded bug in place) |
| `project-pristine/` | Initial snapshot of the demo project (the source for restore; do not modify) |
| `smoke-phase4/10/11/12.ts` | LLM-layer regression probes (need a key; see docs/TESTING.md for how to run) |
| `cfg-*/settings.json` | Probe config fixtures (staged through the legacy settings.json tier, still honored) |
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
together with the seeded state by `restore-project.sh`). Paste this prompt
into the session (or hand it to the leader at the end of the round):

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

How to run the LLM-layer probes: [../docs/TESTING.md](../docs/TESTING.md);
how to configure them: [../docs/CONFIGURATION.md](../docs/CONFIGURATION.md)
(the `[stepcodeAgentTeam]` table of `sandbox/config.toml`).
