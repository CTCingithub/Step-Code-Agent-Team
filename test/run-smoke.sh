#!/usr/bin/env bash
# Zero-token smoke suite: protocol, config, topology, depth, project config.
# Phase 5 makes one real (1-token) model call and is skipped unless
# STEP_API_KEY is set. LLM-layer probes stay in sandbox/ and need a test key.
#
# Usage:
#   bash test/run-smoke.sh              # all zero-token phases
#   bash test/run-smoke.sh 1 9 13       # selected phases
#
# Each phase runs `step` with a throwaway agent dir (mktemp), so nothing leaks
# into ~/.stepcode or the gitignored sandbox/. The step binary is resolved via
# sandbox/step-bin.sh: $STEPCODE_STEP_BIN > sandbox/step-build (built from the
# pinned submodule) > PATH.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=/dev/null
source "$ROOT/sandbox/step-bin.sh"
STEP_BIN="$(resolve_step_bin)" || exit 2

AGENT_DIR="$(mktemp -d)"
SESSION_DIR="$AGENT_DIR/sessions"
mkdir -p "$SESSION_DIR"
trap 'rm -rf "$AGENT_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Phase list derives from disk so a newly added phaseN.ts runs automatically;
# OPT_OUT_PHASES (empty by default) is the only deliberate exclusion. Explicit
# arguments still override (bash test/run-smoke.sh 9 13).
OPT_OUT_PHASES=""
if [ $# -gt 0 ]; then
  PHASES="$*"
else
  PHASES="$(cd "$ROOT/test/smoke" && ls phase*.ts 2>/dev/null | sed -E 's/^phase([0-9]+)\.ts$/\1/' | sort -n | tr '\n' ' ')"
  for opt in $OPT_OUT_PHASES; do PHASES="$(echo " $PHASES " | sed "s/ $opt / /")"; done
  PHASES="${PHASES# }"; PHASES="${PHASES% }"
fi
# Pure-logic probes (render/tools helpers) run standalone — without
# extensions/index.ts. Importing them transitively pulls @step-harness/pi-tui,
# which makes step stage the repo package into the agent dir and load a second
# copy of index.ts: a fatal tool-name conflict. These probes don't need the
# team extension, so don't load it.
STANDALONE_PHASES="15 16"
# Phases that make a real (1-token) model call and need a test key; skipped
# explicitly when STEP_API_KEY is absent so the suite stays green offline.
KEY_PHASES="5"
# Test key: the environment wins; otherwise fall back to sandbox/TEST-KEY.md
# (gitignored — see that file). Keeps phase5 runnable without exporting.
if [ -z "${STEP_API_KEY:-}" ] && [ -f "$ROOT/sandbox/TEST-KEY.md" ]; then
  key="$(grep -m1 '^[[:space:]]*STEP_API_KEY=' "$ROOT/sandbox/TEST-KEY.md" | cut -d= -f2- | tr -d '[:space:]' || true)"
  if [ -n "$key" ]; then export STEP_API_KEY="$key"; fi
fi
FAILED=()
for p in $PHASES; do
  probe="$ROOT/test/smoke/phase$p.ts"
  if [ ! -f "$probe" ]; then
    echo "phase$p: MISSING ($probe)"
    FAILED+=("$p")
    continue
  fi
  if echo " $KEY_PHASES " | grep -q " $p " && [ -z "${STEP_API_KEY:-}" ]; then
    echo "phase$p: SKIPPED (STEP_API_KEY not set; put a key in sandbox/TEST-KEY.md to run it)"
    continue
  fi
  if echo " $STANDALONE_PHASES " | grep -q " $p "; then
    ext_args=(-e "$probe")
  else
    ext_args=(-e "$ROOT/extensions/index.ts" -e "$probe")
  fi
  rc=0
  out="$(printf '{"id":"1","type":"get_state"}\n' \
    | STEP_CODING_AGENT_DIR="$AGENT_DIR" \
      timeout 240 "$STEP_BIN" "${ext_args[@]}" \
      --mode rpc --session-id "smoke-$p" --session-dir "$SESSION_DIR" \
      --approval-mode auto 2>&1)" || rc=$?
  # Structural verdict on the probe's own log lines only (step's stderr can
  # contain unrelated "fail" text): a phase passes iff it logged DONE and no
  # FAIL/failed/SKIP-marker line — never rely on substring counting.
  probe_log="$(echo "$out" | grep -E '\[smoke[0-9]*\]' || true)"
  fails="$(echo "$probe_log" | grep -cE 'FAIL |FAILED' || true)"
  skips="$(echo "$probe_log" | grep -cE 'SKIP ' || true)"
  done="$(echo "$probe_log" | grep -cE 'DONE' || true)"
  if [ "$rc" -eq 124 ]; then
    # A 240s SIGTERM kill is a hang, not an assertion failure — say so instead
    # of the indistinguishable "(fails=0)".
    echo "phase$p: FAILED (timed out after 240s — the probe hung before DONE)"
    echo "$probe_log" | tail -20
    FAILED+=("$p")
  elif [ "$done" -ge 1 ] && [ "$fails" -eq 0 ]; then
    echo "phase$p: OK (fails=0, skips=$skips)"
  else
    echo "phase$p: FAILED (fails=$fails)"
    echo "$probe_log" | grep -E 'FAIL |FAILED' | head -20
    FAILED+=("$p")
  fi
done

# ---- package manifest sanity ----
# A `pi` manifest suppresses convention-directory discovery for the resource
# types it does not declare — the plugin ships its extension only (skills and
# prompt templates were replaced by code), so guard that declaration.
if node -e '
const root = process.argv[1];
const pkg = require(`${root}/package.json`);
const fs = require("node:fs");
const assert = require("node:assert/strict");
for (const t of ["extensions"]) {
	assert.ok(Array.isArray(pkg.pi?.[t]) && pkg.pi[t].length > 0, `pi.${t} not declared`);
	for (const p of pkg.pi[t]) {
		assert.ok(fs.existsSync(`${root}/${p.replace(/^\.\//, "")}`), `declared path missing: ${p}`);
	}
}
' "$ROOT" 2>&1; then
	echo "manifest-check: OK"
else
	echo "manifest-check: FAILED (the pi manifest must declare extensions with existing paths)"
	FAILED+=("manifest-check")
fi

# ---- live wiring checks (zero-token, hermetic temp cwd) ----
# index.ts applies the trusted project tier to its own config instance and the
# /topo command surfaces the result. In-probe observation is impossible
# (each -e extension gets its own config module instance), so verify it here.
live_check() {
  local name="$1" dir="$2" expect="$3" cmd="${4:-topo}"
  mkdir -p "$dir/sessions"
  local out
  out="$(cd "$dir" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/%s"}\n' "$cmd" \
    | STEP_CODING_AGENT_DIR="$dir/agent" timeout 45 "$STEP_BIN" -e "$ROOT/extensions/index.ts" \
      --mode rpc --session-id "live-$name" --session-dir "$dir/sessions" -a 2>&1)" || true
  if echo "$out" | grep -q "$expect"; then
    echo "live-$name: OK"
  else
    echo "live-$name: FAILED (expected: $expect)"
    echo "$out" | tail -5
    FAILED+=("live-$name")
  fi
  rm -rf "$dir"
}

LIVE1="$(mktemp -d)"
mkdir -p "$LIVE1/.stepcode"
echo '{"stepcodeAgentTeam":{"activation":{"enabled":false}}}' > "$LIVE1/.stepcode/settings.json"
live_check "project-config" "$LIVE1" "disabled by configuration"

LIVE2="$(mktemp -d)"
live_check "command-activate" "$LIVE2" "Agent team plugin activated (/topo command)"

# Package install path: a `packages` entry in the step config (the unified
# config.toml beside the agent dir — the form `step install <local path>`
# records; agent/settings.json is retired) must load the extension through
# the package machinery (manifest-driven), with no -e flag.
PKGDIR="$(mktemp -d)"
mkdir -p "$PKGDIR/agent/sessions"
printf 'packages = ["%s"]\n' "$ROOT" > "$PKGDIR/config.toml"
pkg_out="$(cd "$PKGDIR" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/topo"}\n' \
  | STEP_CODING_AGENT_DIR="$PKGDIR/agent" timeout 45 "$STEP_BIN" \
    --mode rpc --session-id live-pkg --session-dir "$PKGDIR/agent/sessions" -a 2>&1)" || true
if echo "$pkg_out" | grep -q 'Agent team plugin activated (/topo command)'; then
	echo "live-package-install: OK"
else
	echo "live-package-install: FAILED (extension from the step config packages entry did not activate)"
	echo "$pkg_out" | tail -5
	FAILED+=("live-package-install")
fi
rm -rf "$PKGDIR"

# Args after the command must be forwarded to the agent as a real user message
# (a slash command otherwise consumes the whole input and drops the request),
# the command must still ACTIVATE the plugin (2026-10-19 TUI report: activation
# happened but its toast was coalesced away, and the verbatim request was then
# completed solo — zero team tool calls), and since 0.2.0 the request is
# forwarded VERBATIM as a real user message — what lands in the transcript is
# exactly what the user typed (asserted on the delivered user-message event);
# the team-usage instruction is injected request-locally through the context
# event and never appears in the transcript.
LIVE3="$(mktemp -d)"
mkdir -p "$LIVE3/sessions"
fwd_out="$(cd "$LIVE3" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/topo ping-forward-check"}\n' \
  | STEP_CODING_AGENT_DIR="$LIVE3/agent" timeout 45 "$STEP_BIN" -e "$ROOT/extensions/index.ts" \
    --mode rpc --session-id live-fwd --session-dir "$LIVE3/sessions" -a 2>&1)" || true
if ! echo "$fwd_out" | grep -q 'Agent team plugin activated'; then
  echo "live-args-forward: FAILED (command with args did not activate the plugin)"
  echo "$fwd_out" | tail -5
  FAILED+=("live-args-forward")
elif ! echo "$fwd_out" | grep -q 'forwarding your request to the agent'; then
  echo "live-args-forward: FAILED (no forwarding announcement on the team board)"
  echo "$fwd_out" | tail -5
  FAILED+=("live-args-forward")
elif ! echo "$fwd_out" | grep -q '"text":"ping-forward-check"'; then
  echo "live-args-forward: FAILED (request was not forwarded verbatim as a user message)"
  echo "$fwd_out" | tail -5
  FAILED+=("live-args-forward")
else
  echo "live-args-forward: OK"
fi
rm -rf "$LIVE3"

# /topo review: the command activates and forwards the target verbatim (the
# review-protocol instruction is injected request-locally and never logged).
LIVE5="$(mktemp -d)"
mkdir -p "$LIVE5/sessions"
rev_out="$(cd "$LIVE5" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/topo review ping-review-check"}\n' \
  | STEP_CODING_AGENT_DIR="$LIVE5/agent" timeout 45 "$STEP_BIN" -e "$ROOT/extensions/index.ts" \
    --mode rpc --session-id live-review --session-dir "$LIVE5/sessions" -a 2>&1)" || true
if echo "$rev_out" | grep -q 'Agent team plugin activated' && echo "$rev_out" | grep -q '"text":"ping-review-check"'; then
  echo "live-review: OK"
else
  echo "live-review: FAILED (the /topo review command did not activate and forward verbatim)"
  echo "$rev_out" | tail -5
  FAILED+=("live-review")
fi
rm -rf "$LIVE5"

# Untrusted project config must NOT apply: staged activation.enabled=false with
# --no-approve → /topo still activates.
LIVE4="$(mktemp -d)"
mkdir -p "$LIVE4/.stepcode" "$LIVE4/sessions"
echo '{"stepcodeAgentTeam":{"activation":{"enabled":false}}}' > "$LIVE4/.stepcode/settings.json"
na_out="$(cd "$LIVE4" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/topo"}\n' \
  | STEP_CODING_AGENT_DIR="$LIVE4/agent" timeout 45 "$STEP_BIN" -e "$ROOT/extensions/index.ts" \
    --mode rpc --session-id live-untrusted --session-dir "$LIVE4/sessions" -na 2>&1)" || true
if echo "$na_out" | grep -q 'Agent team plugin activated (/topo command)'; then
  echo "live-untrusted-config: OK"
else
  echo "live-untrusted-config: FAILED (staged project config applied despite --no-approve)"
  FAILED+=("live-untrusted-config")
fi
rm -rf "$LIVE4"

# Clean-export packaging: the repo at HEAD must load from a fresh git archive
# without touching the user's real settings.
EXPORT_DIR="$(mktemp -d)"
NEUTRAL="$(mktemp -d)"
if git -C "$ROOT" archive HEAD 2>/dev/null | tar -x -C "$EXPORT_DIR" 2>/dev/null && [ -f "$EXPORT_DIR/extensions/index.ts" ]; then
  exp_out="$(cd "$NEUTRAL" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/topo"}\n' \
    | STEP_CODING_AGENT_DIR="$EXPORT_DIR/agent" timeout 45 "$STEP_BIN" -e "$EXPORT_DIR/extensions/index.ts" \
      --mode rpc --session-id live-export --session-dir "$EXPORT_DIR/sessions" --approval-mode auto 2>&1)" || true
  if echo "$exp_out" | grep -q 'Agent team plugin activated (/topo command)'; then
    echo "live-clean-export: OK"
  else
    echo "live-clean-export: FAILED (extension from git archive did not activate)"
    echo "$exp_out" | tail -5
    FAILED+=("live-clean-export")
  fi
else
  echo "live-clean-export: SKIPPED (git archive unavailable)"
fi
rm -rf "$EXPORT_DIR" "$NEUTRAL"

# Orphan processes: a member spawned by phase17 must not outlive its leader.
# A member spawned by phase17 must not outlive its leader. Always report:
# a silently-skipped check is indistinguishable from a passing one.
if [ -f "$AGENT_DIR/orphan.pid" ]; then
  orphan_pid="$(cat "$AGENT_DIR/orphan.pid")"
  # Poll up to ~15s instead of a fixed 3s: on a loaded machine a member can
  # take longer to notice stdin EOF/SIGTERM, and a too-short wait would
  # report OK for a process that is still shutting down.
  orphan_gone=""
  for _ in $(seq 1 15); do
    if ! kill -0 "$orphan_pid" 2>/dev/null; then orphan_gone=1; break; fi
    sleep 1
  done
  if [ -n "$orphan_gone" ]; then
    echo "orphan-check: OK"
  else
    echo "orphan-check: FAILED (member pid $orphan_pid still alive 15s after leader exit)"
    FAILED+=("orphan-check")
  fi
else
  echo "orphan-check: SKIPPED (phase17 did not run — no orphan.pid)"
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "run-smoke: FAILED phases: ${FAILED[*]}"
  exit 1
fi
echo "run-smoke: all phases passed"
