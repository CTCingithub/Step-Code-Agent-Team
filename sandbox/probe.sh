#!/usr/bin/env bash
# 零 token 协议探针：验证 RPC 子进程可启动并按 id 返回响应，不调用模型。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$DIR/agent/sessions"

printf '{"id":"1","type":"get_state"}\n' \
  | timeout 30 step --mode rpc --session-id probe --session-dir "$DIR/agent/sessions" 2>/dev/null \
  | grep '"command":"get_state"' \
  && echo "PROBE OK"
