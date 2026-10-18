#!/usr/bin/env bash
# 沙箱启动器：隔离 agent 目录 / 会话 / 计划文件，工作区指向 sandbox/project。
# 用法：./sandbox/run.sh [step 参数...]
# 凭证：运行前自行 export STEP_API_KEY=<你的key>（仅当前 shell 有效，不写入任何文件）。
#
# step 二进制解析顺序：$STEPCODE_STEP_BIN > sandbox/step-build/step（由
# sandbox/build-step.sh 从 sandbox/step 子模块构建）> PATH 中的 step。
# 详见 sandbox/step-bin.sh 与 sandbox/README.md。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=/dev/null
source "$ROOT/sandbox/step-bin.sh"
STEP_BIN="$(resolve_step_bin)"

export STEP_CODING_AGENT_DIR="$ROOT/sandbox/agent"
export STEP_CODING_AGENT_SESSION_DIR="$ROOT/sandbox/agent/sessions"
export STEP_CODING_AGENT_PLAN_DIR="$ROOT/sandbox/agent/plans"

mkdir -p "$STEP_CODING_AGENT_DIR" "$STEP_CODING_AGENT_SESSION_DIR" "$STEP_CODING_AGENT_PLAN_DIR"

cd "$ROOT/sandbox/project"
exec "$STEP_BIN" -e "$ROOT/extensions/index.ts" "$@"
