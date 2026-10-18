#!/usr/bin/env bash
# 还原沙箱测试项目到初始状态（含种子 bug、清除运行时数据）。
# 用法：bash sandbox/restore-project.sh
#
# 语义：用 project-pristine/ 覆盖 project/ 的已知文件（源码/测试/README/
# package.json），并清除运行时生成的 data/。演示过程中新建的额外文件会保留，
# 需要彻底清场时可手动 rm -rf sandbox/project 后重跑本脚本（会从快照重建）。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$DIR/project-pristine"
DST="$DIR/project"

[ -d "$SRC" ] || { echo "restore-project: 缺少初始快照 $SRC" >&2; exit 1; }

mkdir -p "$DST"
cp -a "$SRC/." "$DST/"      # 覆盖源码/测试/README/package.json
rm -rf "$DST/data"          # 清除运行时数据（tasks.json 等）
echo "restore-project: 已还原（种子 bug 就位，data/ 已清除）"
