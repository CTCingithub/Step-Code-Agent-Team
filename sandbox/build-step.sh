#!/usr/bin/env bash
# OPTIONAL: build the pinned Step Code source (the sandbox/step submodule) into
# a local binary and expose it at sandbox/step-build/step, which the sandbox
# scripts then prefer over the global step.
#
# This is HEAVY: pnpm install + a full monorepo build + a bun compile. Expect
# several minutes and a few GB of disk. The sandbox works fine without it —
# every script falls back to the global `step` on PATH.
#
# Usage: bash sandbox/build-step.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUB="$ROOT/sandbox/step"

if [ ! -e "$SUB/.git" ]; then
	echo "build-step: submodule missing. Run: git submodule update --init sandbox/step" >&2
	exit 1
fi

# Map uname onto the build script's platform names.
case "$(uname -s)" in
	Darwin) OS=darwin ;;
	Linux) OS=linux ;;
	*)
		echo "build-step: unsupported OS: $(uname -s)" >&2
		exit 1
		;;
esac
case "$(uname -m)" in
	arm64 | aarch64) ARCH=arm64 ;;
	x86_64 | amd64) ARCH=x64 ;;
	*)
		echo "build-step: unsupported arch: $(uname -m)" >&2
		exit 1
		;;
esac
PLATFORM="$OS-$ARCH"

echo "==> Building step for $PLATFORM (this takes a while)..."
cd "$SUB"
bash scripts/build-binaries.sh --product step --platform "$PLATFORM" --offline-model-data

BUILT="$SUB/packages/coding-agent/binaries/$PLATFORM"
if [ ! -x "$BUILT/step" ]; then
	echo "build-step: expected a binary at $BUILT/step" >&2
	exit 1
fi

# The binary resolves sibling resources (theme, docs, node_modules) relative to
# itself, so expose the whole platform directory via a relative symlink rather
# than copying the binary alone. sandbox/step-build is gitignored.
mkdir -p "$ROOT/sandbox"
ln -sfn "step/packages/coding-agent/binaries/$PLATFORM" "$ROOT/sandbox/step-build"
echo "==> OK: $ROOT/sandbox/step-build/step ($PLATFORM)"
echo "    Sandbox scripts now prefer this binary; remove sandbox/step-build to go back to the global step."
