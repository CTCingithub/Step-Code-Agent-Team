#!/usr/bin/env bash
# 还原沙箱测试环境：演示项目复位（种子 bug 就位）+ 运行时数据与会话日志清除。
# 用法：bash sandbox/restore-project.sh
#
# 语义：
# 1. 用 project-pristine/ 覆盖 project/ 的已知文件（源码/测试/README/
#    package.json），并清除运行时生成的 data/；
# 2. 删除本目录下的会话日志 session-log-*.md 与 logs/ 目录（按 docs 测试
#    流程指引，在验证会话中生成，见 docs/MANUAL-TESTING.md §7）——删除前
#    自动归档到 sandbox/archive/，杜绝"未归档的还原删掉整轮证据"。
# 演示过程中新建的额外文件会保留，需要彻底清场时可手动 rm -rf sandbox/project
# 后重跑本脚本（会从快照重建）。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$DIR/project-pristine"
DST="$DIR/project"

[ -d "$SRC" ] || { echo "restore-project: 缺少初始快照 $SRC" >&2; exit 1; }

mkdir -p "$DST"
cp -a "$SRC/." "$DST/"      # 覆盖源码/测试/README/package.json
rm -rf "$DST/data"          # 清除运行时数据（tasks.json 等）
# 证据保全：会话日志即将被删除，先自动归档再删（2026-10-22 教训：一次未归档
# 的还原删掉了用户整轮测试的 §7 日志）。归档失败不阻断还原。
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$DIR/archive/${STAMP}-auto-before-restore"
if [ -d "$DIR/logs" ] || ls "$DIR"/session-log-*.md >/dev/null 2>&1; then
	if mkdir -p "$DEST" 2>/dev/null; then
		[ -d "$DIR/logs" ] && cp -a "$DIR/logs" "$DEST/logs"
		cp -a "$DIR"/session-log-*.md "$DEST/" 2>/dev/null || true
		echo "restore-project: 会话日志已自动归档到 sandbox/archive/${STAMP}-auto-before-restore/"
	fi
fi
# 清除验证会话生成的日志（rm -f 对无匹配的通配符静默通过）
rm -f "$DIR"/session-log-*.md
rm -rf "$DIR/logs"
echo "restore-project: 已还原（种子 bug 就位，data/ 与会话日志已清除）"
