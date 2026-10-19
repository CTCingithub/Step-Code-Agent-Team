# 测试指南

> 四层测试体系的操作化版本。原则：**先写可复现测试，再修复**；零 token 层优先，
> LLM 层只在沙箱内用测试 key 做最小调用。探针按 phase 编号递增：零 token 层随仓库分发
> （`test/smoke/phase*.ts`），LLM 层随 `sandbox/` 分发（需你自己的 key）；历史执行记录见 `sandbox/TEST-PLAN.md`。

## 0. 环境准备

零 token 层：`test/run-smoke.sh` 自建一次性临时 agentDir（mktemp），无需任何准备，与真实
`~/.stepcode` 完全隔离。LLM 层在 `sandbox/` 内运行（`sandbox/` 随仓库分发，`cfg-*` fixture 已内含；仅 agent dir、sessions、teams 等运行时状态在 .gitignore 内）。step 二进制解析顺序：`$STEPCODE_STEP_BIN` > `sandbox/step-build/step`（从 `sandbox/step` submodule 构建）> PATH 中的 `step`（见 `sandbox/step-bin.sh`）。headless 探针必须带
`--approval-mode auto`，否则派生进程的工具会被审批拦截：

```bash
export STEP_CODING_AGENT_DIR="$PWD/sandbox/agent"
export STEP_CODING_AGENT_SESSION_DIR="$PWD/sandbox/agent/sessions"
```

LLM 层测试前 `export STEP_API_KEY=<你自己的 key>`（经环境变量传递，绝不写入任何文件）。

### 沙箱运行时状态与还原

沙箱的可复用设施（脚本、探针、`cfg-*` fixture、`project-pristine/`）随仓库分发；下列
**运行时状态**（均 gitignored）会随测试累积，需要时清理：

| 状态 | 位置 | 清理方式 |
|---|---|---|
| 演示项目 | `sandbox/project/`（会被成员改动，如修复种子 bug） | `bash sandbox/restore-project.sh` 还原为种子态 |
| 会话 / 团队 / 计划 / live-context | `sandbox/agent/{sessions,teams,plans,live-context}` | `rm -rf` 后重跑（全新沙箱） |
| 演示项目运行数据 | `sandbox/project/data/` | `restore-project.sh` 自动清除 |
| 会话日志 | `sandbox/session-log-*.md`（验证会话按需生成，prompt 见 [TUI-VERIFICATION.md](TUI-VERIFICATION.md) §3） | `restore-project.sh` 自动删除 |
| 各 fixture 的运行时状态 | `sandbox/cfg-*/{sessions,teams,teams-*,live-context}` | 同上，按需清理 |

```bash
# 快速还原（每轮 LLM 层测试后必做）：种子 bug 就位、data/ 清除
bash sandbox/restore-project.sh

# 彻底清场（可选）：删除全部沙箱运行时状态后还原演示项目
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

交互 TUI 的人工验证（含可复制粘贴的 prompt）见
[TUI-VERIFICATION.md](TUI-VERIFICATION.md)；完整手动测试清单（含各项还原命令）见
[MANUAL-TESTING.md](MANUAL-TESTING.md)。

## 1. A 层 — 单元测试（无 LLM，无进程）

纯函数层，用 node/jiti 直接加载模块（当前以探针内断言方式覆盖，未单列 runner）：

| 对象 | 用例 | 通过标准 |
|---|---|---|
| `registry.ts` | saveRegistry 原子写 / loadRegistry 健壮性 / agentDir 解析 | 并发 50 次写后 JSON 可解析且为某次完整快照；坏 JSON、schemaVersion≠1、文件缺失均返回 null 不抛 |
| `tasks.ts` | validateGraph / recomputeReady / nextTaskId | 自环、间接环、未知依赖抛 TaskGraphError；合法 DAG 不抛；ready 矩阵全场景正确；删除中间任务后编号复用最小空洞 |
| `rpc-client.ts` onData | 帧规则 | 行内含 U+2028/U+2029 不被断行；半行正确拼接；`\r\n` 与裸 `\n` 均处理 |
| `presets.ts` | frontmatter 解析 | `tools: [a, b]` 数组、引号值、CRLF、缺 name/description 跳过 |
| `registry.ts` usage | usageDelta/addUsage | 跨进程重置场景 delta 不为负、累计正确 |

## 2. B 层 — 零 token 集成探针（已入库，`test/smoke/`）

探针随仓库分发，经 `test/run-smoke.sh` 以一次性临时 agentDir（mktemp）运行，
不污染 `~/.stepcode` 或 gitignore 的 sandbox/：

```bash
npm run smoke                 # 全部零 token 层（phase 1 2 3 5 6 7 8 9 13 14 15 16 17）
bash test/run-smoke.sh 9 13   # 只跑指定 phase
```

phase5 会发起一次真实模型调用（1 token）：未设置 `STEP_API_KEY` 时 runner 显式 SKIP
而非失败；设置后（密钥见 `local/test-api-key.md`，只经环境变量传递）即纳入回归。

| 探针 | 覆盖 | 成本 |
|---|---|---|
| phase1 | 成员生命周期（spawn/握手/disband/重建） | 零 token |
| phase2 | 任务板状态机（DAG/环/ready-set/持久化） | 零 token |
| phase3 | 消息服务 + shim status 往返 + 预设加载 | 零 token |
| phase5 | 并发创建竞态/失败即杀/状态机/socket 0600/abort/shutdown | 1 次 token（无 key 时 SKIP） |
| phase6 | 默认关闭激活 + 配置纯函数 + 模型/思考解析 | 零 token |
| phase7 | 拓扑真值表 + 越界拒绝 + requireDeclaration 门 | 零 token |
| phase8 | 递归深度 /proc 实检 + 子团队自举 + 并发默认值 | 零 token |
| phase9 | 配置边界（storage.dir/项目级/非法回退） | 零 token |
| phase13 | 项目级配置（trust 门控/深合并/优先级/env/MAXDEPTH） | 零 token |
| phase14 | 环形 loop 上限（配置面/manager 层即抛/server 层经 shim 拒绝/拓扑优先/边界放行） | 零 token |
| phase15 | TUI 渲染断言（render.ts 六工具 call/result，含折叠/展开/用量行/状态图标） | 零 token（独立运行） |
| phase16 | 成本护栏与输出截断单测（costWarning / truncateOutput） | 零 token（独立运行） |
| phase17 | 孤儿进程（成员不得比队长长寿） | 零 token |
| phase18 | 名额计数（解散释放名额）+ 恢复参数忽略提示 + 拓扑 bash 警告/消息能力提示 + dispatch 失败上下文（超时/中止提示接力在途与成员名册） | 零 token |

LLM 路径探针（phase4/10/11/12）需要测试 key，仍留在 gitignore 的 `sandbox/` 内（见 C 层）。

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

TUI 渲染（renderCall/renderResult、`/agent-team` 面板、流式进度、激活 notify）只在交互 TUI
生效，探针覆盖不到，按 [TUI-VERIFICATION.md](TUI-VERIFICATION.md) 人工验证；完整的手动测试
清单（真实安装、项目配置信任流、LLM 遵循度、沙箱演示剧本、成本护栏等）见
[MANUAL-TESTING.md](MANUAL-TESTING.md)。

## 5. 修复与复跑规则

1. 失败先定位根因：产品缺陷 vs 探针缺陷 vs 陈旧状态，记录进 `sandbox/TEST-PLAN.md`。
2. 产品缺陷：修复后复跑对应探针 + 受影响回归。
3. 探针缺陷：修探针后重跑。
4. 全绿后提交推送（修复与文档分开，conventional commit）。
