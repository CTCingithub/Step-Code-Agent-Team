#!/usr/bin/env bash
# 归档本轮沙箱测试证据（还原前运行）：会话 JSONL、团队注册表、logs/ 与演示项目
# 改动 → sandbox/archive/<时间戳>-<标签>/（gitignored，本地留存）。
# 用法：bash sandbox/archive-round.sh [标签]
#
# 背景：restore-project.sh 会清除 logs/（MANUAL-TESTING §7 会话日志的产物）与
# project/data/；会话 JSONL 与团队注册表虽不被 restore 删除，但整个 sandbox/agent/
# 在 gitignore 内——"彻底清场"或误操作都会让一轮测试的证据全部消失。本脚本在还原
# 前把证据打包到 archive/，让每轮测试可追溯、可复盘。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Sanitize the label: it becomes a path component (a "/" or ".." would escape the archive dir).
LABEL="$(printf '%s' "${1:-round}" | tr -c '[:alnum:]._-' '-')"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$DIR/archive/${STAMP}-${LABEL}"

if [ -e "$DEST" ]; then
	echo "archive-round: $DEST 已存在（同一秒同一标签重复运行）——换个标签或稍候再试" >&2
	exit 1
fi
mkdir -p "$DEST"
if [ -d "$DIR/agent/sessions" ]; then cp -a "$DIR/agent/sessions" "$DEST/sessions"; fi
if [ -d "$DIR/agent/teams" ]; then cp -a "$DIR/agent/teams" "$DEST/teams"; fi
if [ -d "$DIR/logs" ]; then cp -a "$DIR/logs" "$DEST/logs"; fi
# Legacy-location session logs (sandbox/session-log-*.md), when any remain
cp -a "$DIR"/session-log-*.md "$DEST/" 2>/dev/null || true
git -C "$DIR/project" diff -- . > "$DEST/project.diff" 2>/dev/null || true
git -C "$DIR/project" status --porcelain -- . > "$DEST/project.status.txt" 2>/dev/null || true

echo "archive-round: 已归档到 sandbox/archive/${STAMP}-${LABEL}/（$(du -sh "$DEST" | cut -f1)）"
echo "archive-round: 含 sessions/ teams/ logs/ session-log-*.md（如有）/ project.diff project.status.txt（按实际存在情况）"
