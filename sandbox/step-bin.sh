#!/usr/bin/env bash
# Step binary resolver for the sandbox. Source this file, then:
#
#   source "$ROOT/sandbox/step-bin.sh"
#   STEP_BIN="$(resolve_step_bin)" || exit 1
#
# Resolution order:
#   1. $STEPCODE_STEP_BIN        — explicit override (power users / CI)
#   2. sandbox/step-build/step   — built from the pinned submodule by
#                                   sandbox/build-step.sh (a symlink to the
#                                   per-platform build output)
#   3. step on PATH              — the globally installed CLI (default)
#
# The submodule at sandbox/step pins the Step Code source this sandbox tracks
# (see sandbox/README.md). The binary used at runtime is resolved on demand, so
# a fresh clone without submodules — or without a local build — still works.

resolve_step_bin() {
	if [ -n "${STEPCODE_STEP_BIN:-}" ]; then
		echo "$STEPCODE_STEP_BIN"
		return 0
	fi
	local here
	here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
	local candidate="$here/step-build/step"
	if [ -x "$candidate" ]; then
		echo "$candidate"
		return 0
	fi
	if command -v step >/dev/null 2>&1; then
		echo "step"
		return 0
	fi
	echo "step-bin: no step binary found — set STEPCODE_STEP_BIN, run sandbox/build-step.sh, or install step on PATH" >&2
	return 1
}
