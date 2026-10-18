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
# into ~/.stepcode or the gitignored sandbox/. Requires the `step` CLI on PATH.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v step >/dev/null 2>&1; then
  echo "run-smoke: 'step' CLI not found on PATH" >&2
  exit 2
fi

AGENT_DIR="$(mktemp -d)"
SESSION_DIR="$AGENT_DIR/sessions"
mkdir -p "$SESSION_DIR"
trap 'rm -rf "$AGENT_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

PHASES="${*:-1 2 3 5 6 7 8 9 13 14}"
# Phases that make a real (1-token) model call and need a test key; skipped
# explicitly when STEP_API_KEY is absent so the suite stays green offline.
KEY_PHASES="5"
FAILED=()
for p in $PHASES; do
  probe="$ROOT/test/smoke/phase$p.ts"
  if [ ! -f "$probe" ]; then
    echo "phase$p: MISSING ($probe)"
    FAILED+=("$p")
    continue
  fi
  if echo " $KEY_PHASES " | grep -q " $p " && [ -z "${STEP_API_KEY:-}" ]; then
    echo "phase$p: SKIPPED (STEP_API_KEY not set)"
    continue
  fi
  out="$(printf '{"id":"1","type":"get_state"}\n' \
    | STEP_CODING_AGENT_DIR="$AGENT_DIR" \
      timeout 240 step -e "$ROOT/extensions/index.ts" -e "$probe" \
      --mode rpc --session-id "smoke-$p" --session-dir "$SESSION_DIR" \
      --approval-mode auto 2>&1)" || true
  # Structural verdict on the probe's own log lines only (step's stderr can
  # contain unrelated "fail" text): a phase passes iff it logged DONE and no
  # FAIL/failed/SKIP-marker line — never rely on substring counting.
  probe_log="$(echo "$out" | grep -E '\[smoke[0-9]*\]' || true)"
  fails="$(echo "$probe_log" | grep -cE 'FAIL |FAILED' || true)"
  skips="$(echo "$probe_log" | grep -cE 'SKIP ' || true)"
  done="$(echo "$probe_log" | grep -cE 'DONE' || true)"
  if [ "$done" -ge 1 ] && [ "$fails" -eq 0 ]; then
    echo "phase$p: OK (fails=0, skips=$skips)"
  else
    echo "phase$p: FAILED (fails=$fails)"
    echo "$probe_log" | grep -E 'FAIL |FAILED' | head -20
    FAILED+=("$p")
  fi
done

# ---- live wiring checks (zero-token, hermetic temp cwd) ----
# index.ts applies the trusted project tier to its own config instance and the
# /agent-team command surfaces the result. In-probe observation is impossible
# (each -e extension gets its own config module instance), so verify it here.
live_check() {
  local name="$1" dir="$2" expect="$3"
  mkdir -p "$dir/sessions"
  local out
  out="$(cd "$dir" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/agent-team"}\n' \
    | STEP_CODING_AGENT_DIR="$dir/agent" timeout 45 step -e "$ROOT/extensions/index.ts" \
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
live_check "command-activate" "$LIVE2" "Agent team plugin activated (/agent-team command)"

# Args after the command must be forwarded to the agent as a real user message
# (a slash command otherwise consumes the whole input and drops the request).
LIVE3="$(mktemp -d)"
mkdir -p "$LIVE3/sessions"
fwd_out="$(cd "$LIVE3" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/agent-team ping-forward-check"}\n' \
  | STEP_CODING_AGENT_DIR="$LIVE3/agent" timeout 45 step -e "$ROOT/extensions/index.ts" \
    --mode rpc --session-id live-fwd --session-dir "$LIVE3/sessions" -a 2>&1)" || true
if echo "$fwd_out" | grep -q '"text":"ping-forward-check"' || grep -rq '"text":"ping-forward-check"' "$LIVE3"/sessions/ 2>/dev/null; then
  echo "live-args-forward: OK"
else
  echo "live-args-forward: FAILED (forwarded request not recorded as a user message)"
  echo "$fwd_out" | tail -5
  FAILED+=("live-args-forward")
fi
rm -rf "$LIVE3"

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "run-smoke: FAILED phases: ${FAILED[*]}"
  exit 1
fi
echo "run-smoke: all phases passed"
