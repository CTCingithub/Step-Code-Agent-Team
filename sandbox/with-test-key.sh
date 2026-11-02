#!/usr/bin/env bash
# Runs a command with the sandbox test credentials exported from
# sandbox/TEST-KEY.md. The environment always wins, so an exported key is
# never overridden by the file.
#
# Two credentials live in that file (both gitignored, never committed):
#   STEP_API_KEY      — the step CLI's own model key (LLM-layer probes)
#   DEEPSEEK_API_KEY  — the searcher script's key (sandbox/probe-searcher.mjs)
#
# Usage: bash sandbox/with-test-key.sh <command> [args...]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH[0]}")/.." && pwd)"
KEY_FILE="$ROOT/sandbox/TEST-KEY.md"

# export_from_file <VARNAME>: takes the first `VARNAME=` line, strips blanks.
export_from_file() {
  local name="$1"
  if [ -z "${!name:-}" ] && [ -f "$KEY_FILE" ]; then
    local value
    value="$(grep -m1 "^[[:space:]]*${name}=" "$KEY_FILE" | cut -d= -f2- | tr -d '[:space:]' || true)"
    if [ -n "$value" ]; then
      export "${name}=${value}"
    fi
  fi
}

export_from_file STEP_API_KEY
export_from_file DEEPSEEK_API_KEY

exec "$@"
