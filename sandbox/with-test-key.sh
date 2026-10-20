#!/usr/bin/env bash
# Runs a command with STEP_API_KEY exported from sandbox/TEST-KEY.md when the
# environment does not already provide one (the environment always wins).
# Usage: bash sandbox/with-test-key.sh <command> [args...]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="$ROOT/sandbox/TEST-KEY.md"

if [ -z "${STEP_API_KEY:-}" ] && [ -f "$KEY_FILE" ]; then
  key="$(grep -m1 '^[[:space:]]*STEP_API_KEY=' "$KEY_FILE" | cut -d= -f2- | tr -d '[:space:]' || true)"
  if [ -n "$key" ]; then
    export STEP_API_KEY="$key"
  fi
fi

exec "$@"
