# Step-Code-Agent-Team

[Step Code](https://stepfun.com)（`step`）的智能体团队插件：当前会话成为**队长**，按需创建可续聊的**成员** Agent，把目标拆解为带依赖的**任务板**，并行调度成员执行，并支持成员间直达消息——对标 DeepSeek Harness 的 agent teams。

## 工作原理

```
队长会话（本扩展）
  │  team_create_member / team_send / team_task / team_status / team_disband
  ▼
TeamRegistry  <agentDir>/teams/<teamId>/registry.json
  ├── 成员 A:  step --mode rpc --session-id team-<id>-a   （独立上下文）
  ├── 成员 B:  step --mode rpc --session-id team-<id>-b
  └── ... 经 stdio JSONL 驱动；队长退出时回收，需要时按同 session-id 恢复
        ▲
        │ 成员间直达消息
  bin/stepcode-team.mjs  ──►  Unix socket  <agentDir>/teams/<teamId>/sock
```

- **成员是真实的 `step` 进程**：独立上下文窗口、可配模型与工具白名单，通过 RPC 协议（`docs/rpc.md`）驱动。成员上下文持久化在 session 文件中，用同一 session-id 重启即可续聊。
- **任务板是 DAG**：`blockedBy` 全部完成的任务才 `ready`；成环的依赖在创建时即被拒绝。
- **成员间消息**：成员不加载本扩展（防止递归组队），通过 `stepcode-team` CLI shim 连接队长进程内的 Unix socket 与队友通信。
- **护栏**：最多 8 个成员；最多 4 个并发调度；单次调度 180s 超时；累计花费超 `STEPCODE_TEAM_COST_WARN`（默认 $1）时告警；空闲 30 分钟的成员被回收（session 保留可恢复）；队长退出时全部子进程被清理。

## 环境要求

- PATH 中可用的 `step` CLI。
- Node（shim 以 `node bin/stepcode-team.mjs` 方式调用）。
- 无第三方 npm 依赖。

## 安装

```bash
# 本地目录安装（写入 step 设置）
step install /path/to/Step-Code-Agent-Team

# 开发期：直接加载，无需安装
step -e ./extensions/index.ts
```

然后在会话里直接用自然语言下达目标，例如："创建一个团队并行审查这个仓库"。

## 工具

| 工具 | 用途 |
|---|---|
| `team_create_member` | 创建/恢复成员（`name`，可选 `role` 预设、`model`、`tools`、`systemPrompt`） |
| `team_send` | 给成员发消息并等待完整回复；可带 `taskId`（按任务执行）或 `mode: "oneshot"`（无状态） |
| `team_task` | 任务板：`create` / `start` / `complete` / `fail` / `list` |
| `team_status` | 成员、任务板、累计花费 |
| `team_disband` | 停止单个成员或全队（session 保留） |
| `/team` | 命令：TUI 中查看紧凑团队板 |

## 内置角色预设（`agents/`）

| 预设 | 工具 | 用途 |
|---|---|---|
| `scout` | 只读 | 代码勘察、结构化汇报 |
| `planner` | 只读 | 制定实施计划 |
| `worker` | 全量 | 执行计划、运行检查 |
| `reviewer` | 只读 | 对抗式审查（正确性 / 风格 / 安全） |

另附 `prompts/team-review.md`（并行多审查员链）与
`skills/team-orchestration/SKILL.md`（何时以及如何组队）。

## 开发沙箱

全部开发活动在 `sandbox/` 内进行（已 gitignore），与真实 `~/.stepcode`
配置、会话、项目完全隔离：

```bash
./sandbox/run.sh       # 以沙箱环境变量启动 step（cwd 为 sandbox/project）
bash sandbox/probe.sh  # 零 token 协议探针（期望输出 PROBE OK）
```

`run.sh` 会将 `STEP_CODING_AGENT_DIR`、`STEP_CODING_AGENT_SESSION_DIR`、
`STEP_CODING_AGENT_PLAN_DIR` 指向 `sandbox/agent/...`。涉及模型调用的运行前，
请在当前 shell `export STEP_API_KEY=<你的key>`——密钥绝不落盘。

## 项目结构

```
extensions/    index.ts（接线）· rpc-client.ts · members.ts · tasks.ts ·
               registry.ts · team-server.ts · presets.ts · tools.ts · render.ts
bin/           stepcode-team.mjs（成员侧 CLI shim）
agents/        角色预设（scout · planner · worker · reviewer）
prompts/       team-review.md
skills/        team-orchestration/SKILL.md
sandbox/       隔离开发环境（gitignored）
```

## 配置

| 变量 | 默认值 | 作用 |
|---|---|---|
| `STEPCODE_TEAM_COST_WARN` | `1` | 触发成本护栏告警的团队累计花费（美元） |
| `STEP_CODING_AGENT_DIR` | `~/.stepcode/agent` | agent 目录；团队注册表位于 `<agentDir>/teams`（沙箱将其指向 `sandbox/agent`） |
| `STEPCODE_TEAM_SOCK` | — | 由队长自动注入成员进程；指向团队服务 socket |

调度上限（编译期常量）：最多 8 个成员；最多 4 个并发调度；单次调度 180s 超时；空闲 30 分钟的成员被回收。

## 开发

零 token 冒烟探针覆盖协议层行为（spawn、握手、注册表、任务图、socket 往返、预设），不调用任何模型：

```bash
bash sandbox/probe.sh   # RPC 握手探针 → 期望输出 PROBE OK

# 成员生命周期 / 任务板 / 消息链路探针（[smoke] 日志输出到 stderr）：
printf '{"id":"1","type":"get_state"}\n' \
  | STEP_CODING_AGENT_DIR="$PWD/sandbox/agent" \
    STEP_CODING_AGENT_SESSION_DIR="$PWD/sandbox/agent/sessions" \
    step -e "$PWD/extensions/index.ts" -e "$PWD/sandbox/smoke-phase1.ts" \
    --mode rpc --session-id smoke --session-dir "$PWD/sandbox/agent/sessions" 2>&1 \
  | grep '\[smoke\]'
```

（将 `smoke-phase1.ts` 换成 `smoke-phase2.ts` / `smoke-phase3.ts` 即对应任务板与消息探针。）全部在 `sandbox/` 内运行，与真实 `~/.stepcode` 状态隔离。涉及模型调用的路径按下方清单在沙箱会话中人工验证。

## 许可证

MIT — 见 [LICENSE](LICENSE)。

## 状态与验证

开发计划 Phase 0–5 已全部实现。协议层行为（spawn、握手、注册表持久化、任务图、
socket 往返）已由零 token 冒烟探针（`sandbox/smoke-phase*.ts`）验证通过。
涉及模型调用的路径请按以下步骤由你本人在沙箱中验证：

```bash
# 1. 启动沙箱会话（先设置密钥）
export STEP_API_KEY=<你的key>
./sandbox/run.sh

# 2. 在会话中依次让 LLM 执行：
#    a. "创建一个 reviewer 成员审查 sandbox/project/src/app.ts"
#       → 验证 team_create_member + team_send（真实 LLM 回复）
#    b. "用一句话向它总结你发现的问题"
#       → 验证成员上下文记忆（同一进程内多轮）
#    c. "/team"
#       → 验证团队板展示
#    d. "创建两个成员并行审查不同侧重，然后合并结论"
#       → 验证并行调度与结果合并
#    e. 退出后重新进入并恢复会话：
./sandbox/run.sh -r
#       然后 "给 reviewer 发消息：还记得你审查过什么吗？"
#       → 验证队长重启后按 session-id 恢复成员上下文

# 3. 成员间消息（双成员协作）：
#    创建 scout 与 worker，让 worker 通过 bash 调用：
#      node bin/stepcode-team.mjs msg --to scout --message "<问题>"
#    → 验证 shim → socket → server → 成员 的完整直达消息链路
```
