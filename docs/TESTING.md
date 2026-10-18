# 测试指南

> 四层测试体系的操作化版本。原则：**先写可复现测试，再修复**；零 token 层优先，
> LLM 层只在沙箱内用测试 key 做最小调用。探针按 phase 编号递增（见 `sandbox/smoke-phase*.ts`，
> 历史执行记录见 `sandbox/TEST-PLAN.md`）。

## 0. 环境准备

所有测试在 `sandbox/` 内运行，与真实 `~/.stepcode` 完全隔离（`sandbox/` 在 .gitignore 内，
换环境需按 `sandbox/TEST-PLAN.md` 第三节矩阵重建配置 fixture）。headless 探针必须带
`--approval-mode auto`，否则派生进程的工具会被审批拦截：

```bash
export STEP_CODING_AGENT_DIR="$PWD/sandbox/agent"
export STEP_CODING_AGENT_SESSION_DIR="$PWD/sandbox/agent/sessions"
```

LLM 层测试前 `export STEP_API_KEY`（密钥只存于 gitignore 的 `local/test-api-key.md`，经环境变量传递，绝不入库）。

## 1. A 层 — 单元测试（无 LLM，无进程）

纯函数层，用 node/jiti 直接加载模块（当前以探针内断言方式覆盖，未单列 runner）：

| 对象 | 用例 | 通过标准 |
|---|---|---|
| `registry.ts` | saveRegistry 原子写 / loadRegistry 健壮性 / agentDir 解析 | 并发 50 次写后 JSON 可解析且为某次完整快照；坏 JSON、schemaVersion≠1、文件缺失均返回 null 不抛 |
| `tasks.ts` | validateGraph / recomputeReady / nextTaskId | 自环、间接环、未知依赖抛 TaskGraphError；合法 DAG 不抛；ready 矩阵全场景正确；删除中间任务后编号复用最小空洞 |
| `rpc-client.ts` onData | 帧规则 | 行内含 U+2028/U+2029 不被断行；半行正确拼接；`\r\n` 与裸 `\n` 均处理 |
| `presets.ts` | frontmatter 解析 | `tools: [a, b]` 数组、引号值、CRLF、缺 name/description 跳过 |
| `registry.ts` usage | usageDelta/addUsage | 跨进程重置场景 delta 不为负、累计正确 |

## 2. B 层 — 零 token 集成探针（`step -e` + 探针扩展）

沿用 smoke-phase 模式，一条命令跑一个 phase：

```bash
for p in 1 2 3 5 6 7 8 9; do
  printf '{"id":"1","type":"get_state"}\n' \
    | STEP_CODING_AGENT_DIR="$PWD/sandbox/agent" \
      step -e "$PWD/extensions/index.ts" -e "$PWD/sandbox/smoke-phase$p.ts" \
      --mode rpc --session-id "reg$p" --session-dir "$PWD/sandbox/agent/sessions" \
      --approval-mode auto 2>&1 | grep -E 'FAIL|DONE'
done
```

| 探针 | 覆盖 | 成本 |
|---|---|---|
| phase1 | 成员生命周期（spawn/握手/disband/重建） | 零 token |
| phase2 | 任务板状态机（DAG/环/ready-set/持久化） | 零 token |
| phase3 | 消息服务 + shim status 往返 + 预设加载 | 零 token |
| phase5 | 并发创建竞态/失败即杀/状态机/socket 0600/abort/shutdown | 1 次 token |
| phase6 | 默认关闭激活 + 配置纯函数 + 模型/思考解析 | 零 token |
| phase7 | 拓扑真值表 + 越界拒绝 + requireDeclaration 门 | 零 token |
| phase8 | 递归深度 /proc 实检 + 子团队自举 + 并发默认值 | 零 token |
| phase9 | 配置边界（storage.dir/项目级/非法回退，cfg-misc） | 零 token |

## 3. C 层 — LLM 路径测试（测试 key，沙箱内，每条成本极小）

```bash
sleep 300 | step -e "$PWD/extensions/index.ts" -e "$PWD/sandbox/smoke-phase4.ts" \
  --mode rpc --session-id r4 --session-dir "$PWD/sandbox/agent/sessions"
```

| 探针 | 配置 | 覆盖 |
|---|---|---|
| phase4 | 默认 | LLM 全路径（回复/上下文记忆/重启恢复/成员间消息） |
| phase10 | cfg-conc / cfg-deadlock | 并发上限 live / 嵌套消息死锁 |
| phase11 | cfg-deep2 | 递归深度 2 真实链 |
| phase12 | 默认 | oneshot/任务链/Unicode/崩溃恢复/流式进度 |

通过标准（摘要）：并行调度均成功；任务链状态流转 pending→ready→running→done；
oneshot 有回复且不留常驻进程；kill -9 后下一次 send 成功且记得上文；
`STEPCODE_TEAM_COST_WARN=0.0001` 触发告警、设为 0 禁用；abort 后无孤儿进程；
onUpdate 至少被调用一次；>50KB 输出截断且 details.fullText 含全量。

## 4. D 层 — 鲁棒性与边界

队长崩溃恢复（registry 无 `.tmp-*` 残留、resume 后视图与磁盘一致）、Unicode/emoji 往返、
参数校验（空 message/非法成员名/未知 task id/未知 member 均得明确错误）、
目录不存在（sessions 目录删后 createMember 仍正常）、大规模（8 成员上限 / 999 任务上限 /
单任务 detail 50KB）。

## 5. 修复与复跑规则

1. 失败先定位根因：产品缺陷 vs 探针缺陷 vs 陈旧状态，记录进 `sandbox/TEST-PLAN.md`。
2. 产品缺陷：修复后复跑对应探针 + 受影响回归。
3. 探针缺陷：修探针后重跑。
4. 全绿后提交推送（修复与文档分开，conventional commit）。
