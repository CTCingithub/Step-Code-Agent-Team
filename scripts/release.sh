#!/usr/bin/env bash
# Release script for Step-Code-Agent-Team.
#
# Usage:
#   scripts/release.sh 0.2.0            # final release: tag + push + move latest
#   scripts/release.sh 0.3.0-preview    # preview: tag + push, latest untouched
#
# Flow: preflight (clean tree, on main, version format, tag free, smoke green)
#   → bump package.json → "chore: release vX.Y.Z" commit → annotated tag
#   → push main + tag → (final only) move the latest branch → hermetic verify
#   (install the tag into a throwaway agent dir and probe activation).
#
# The develop → main merge is a judgment step and stays manual: check out main,
# merge develop (see HANDOFF §7), sync any install examples, then run this.
# Re-running is safe until the tag is created (preflight aborts on a taken tag).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REMOTE="origin"
REPO_SPEC="git:github.com/CTCingithub/Step-Code-Agent-Team"

die() {
	echo "release: $*" >&2
	exit 1
}

# ---- args ----
VERSION="${1:-}"
[ -n "$VERSION" ] || die "usage: scripts/release.sh <version> [--preview]"
shift || true
PREVIEW=0
for arg in "$@"; do
	case "$arg" in
		--preview) PREVIEW=1 ;;
		*) die "unknown option: $arg" ;;
	esac
done
case "$VERSION" in
	*-preview) PREVIEW=1 ;;
esac
echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-preview)?$' || die "invalid version '$VERSION' (expect X.Y.Z or X.Y.Z-preview)"

# ---- preflight ----
[ -z "$(git status --porcelain)" ] || die "working tree is dirty — commit or stash first"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "not on main (on '$BRANCH') — releases happen on main only"
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && die "tag v$VERSION already exists locally"
git ls-remote --tags "$REMOTE" "v$VERSION" 2>/dev/null | grep -q "refs/tags/v$VERSION$" && die "tag v$VERSION already exists on $REMOTE"
CURRENT="$(node -e 'console.log(require("./package.json").version)')"
[ "$CURRENT" != "$VERSION" ] || die "package.json is already at $VERSION"
command -v step >/dev/null || die "step not on PATH (needed for the hermetic verify)"

echo "release: v$VERSION ($([ "$PREVIEW" = 1 ] && echo preview || echo final)) — from $CURRENT on $BRANCH"

# ---- gate: full smoke (a release without a green gate is a bug) ----
echo "release: running the smoke gate…"
npm run smoke || die "smoke gate failed — fix and re-run (nothing was mutated)"

# ---- bump + release commit ----
sed -i '0,/"version":/s/"version": "[^"]*"/"version": "'"$VERSION"'"/' package.json
node -e 'const p=require("./package.json"); if (p.version!==process.argv[1]) { console.error("bump failed: "+p.version); process.exit(1); }' "$VERSION" || die "version bump failed"
git add package.json
git commit -q -m "chore: release v$VERSION"
echo "release: committed $(git rev-parse --short HEAD) (chore: release v$VERSION)"

# ---- annotated tag ----
git tag -a "v$VERSION" -m "v$VERSION"

# ---- push main + tag ----
git push "$REMOTE" main || die "push main failed — tag v$VERSION exists locally; push it by hand or delete it and re-run"
git push "$REMOTE" "v$VERSION" || die "push tag v$VERSION failed"

# ---- latest (final releases only; previews never move it) ----
if [ "$PREVIEW" = 1 ]; then
	LATEST_NOTE="untouched (preview)"
	echo "release: preview — latest stays where it is"
else
	git push "$REMOTE" "v$VERSION:latest" || die "moving latest failed — push 'v$VERSION:latest' by hand"
	LATEST_NOTE="moved to v$VERSION"
	echo "release: latest → v$VERSION"
fi

# ---- hermetic verify: install the tag into a throwaway agent dir ----
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/agent/sessions"
echo "release: hermetic verify — installing $REPO_SPEC@v$VERSION into a throwaway agent dir…"
STEP_CODING_AGENT_DIR="$T/agent" step install "$REPO_SPEC@v$VERSION" >/dev/null 2>&1 ||
	die "hermetic install failed — the tag is already pushed; inspect manually"
out="$(cd "$T" && printf '{"id":"1","type":"get_state"}\n{"id":"2","type":"prompt","message":"/topo"}\n' \
	| STEP_CODING_AGENT_DIR="$T/agent" timeout 90 step --mode rpc \
		--session-id release-verify --session-dir "$T/agent/sessions" --approval-mode auto 2>&1)" || true
if echo "$out" | grep -q "Agent team plugin activated"; then
	echo "release: hermetic verify OK — activated from the v$VERSION tag"
else
	echo "$out" | tail -8 >&2
	die "hermetic verify FAILED — the tag is pushed; inspect manually"
fi

echo "release: ======== v$VERSION released ========"
echo "release:   commit: $(git rev-parse --short HEAD) (pushed to $REMOTE/main)"
echo "release:   tag:    v$VERSION (pushed)"
echo "release:   latest: $LATEST_NOTE"
echo "release:   hermetic: OK"
