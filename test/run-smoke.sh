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
  fails="$(echo "$out" | grep -c 'FAIL ' || true)"
  skips="$(echo "$out" | grep -c 'SKIP ' || true)"
  if echo "$out" | grep -q 'DONE' && [ "$fails" -eq 0 ]; then
    echo "phase$p: OK (fails=0, skips=$skips)"
  else
    echo "phase$p: FAILED (fails=$fails)"
    echo "$out" | grep -E 'FAIL |FAILED' | head -20
    FAILED+=("$p")
  fi
done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "run-smoke: FAILED phases: ${FAILED[*]}"
  exit 1
fi
echo "run-smoke: all phases passed"
