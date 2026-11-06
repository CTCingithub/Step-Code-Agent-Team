# 架构
> [English →](./ARCHITECTURE.md)

> 本文档描述 Step-Code-Agent-Team 的组件构成、数据流与目录布局，以 `extensions/` 当前实现为准。
> 协议细节（RPC / socket / registry schema / 工具契约）见 [PROTOCOL.md](PROTOCOL_CN.md)；测试方法见 [TESTING.md](TESTING_CN.md)。

## 1. 组件总览

```
队长会话（step，加载本扩展）
│
├── extensions/index.ts      入口：加载配置 → 深度门 → 注册 6 个工具 →
│                            setUnavailableTools 关门（默认关闭）；
│                            激活触发：/topo 命令、input 钩子、before_agent_start 钩子、
│                            STEPCODE_TEAM_AUTOACTIVATE（子队长授予）
├── extensions/config.ts     配置：统一配置 config.toml 的 [stepcodeAgentTeam] 表（默认值 < 全局 < 项目级 < 环境变量覆盖）；校验、缓存、首次激活种子化，以及 searcherSpawnEnv（searcher 配置 → 成员 spawn 环境的映射）
├── extensions/activation.ts 激活门：关键词/命令检测、工具释放
├── extensions/forward.ts    注入模型上下文的团队请求指令（第一人称框架、协作协议）
├── extensions/plan.ts       团队方案档位（档位策略提示、选单选项、钉档）
├── extensions/tools.ts      6 个 LLM 工具（create_member / send / task / set_topology / disband / status）
├── extensions/tasks.ts      任务板依赖图（validateGraph / recomputeReady / assertDispatchable）
├── extensions/members.ts    TeamManager：成员生命周期、并发门、任务板调度、拓扑方法、
│                            每成员 spawn 互斥、失败即杀、oneshot、idle 收割、searcher 环境注入
├── extensions/rpc-client.ts JSONL RPC 客户端（严格 \n 分行、id 关联、握手、abort、killAndWait）
├── extensions/team-server.ts Unix socket 服务：拓扑强制 + status(mayMessage)
├── extensions/topology.ts   五形状拓扑构造/校验/解析
├── extensions/registry.ts   团队状态持久化（原子写、storage.dir、旧版兼容、落盘加密）
├── extensions/crypto.ts     registry 的 AES-256-GCM 信封（密钥在 .topo/team.key，0600；明文仍可读）
├── extensions/topo-init.ts  .topo/ 工作目录，首次激活时创建（绝非加载时）；符号链接不跟随，各降级路径返回而不抛
├── extensions/collab-record.ts 每次团队任务后写 .topo/records/ 协作记录（按 teamId 幂等，按加密配置密封或明文，绝不阻断解散）
├── extensions/presets.ts    预设加载（内置 + 用户/项目 agents/ 目录）、扩展入口路径、shim 路径、searcher 脚本路径
├── extensions/member-messaging.ts 成员侧 topo_team_msg 工具（直连 socket，无需 bash）
├── extensions/team/naming.ts   成员命名与会话→团队 ID 规则（MEMBER_NAME_RE、teamIdForSession）
├── extensions/team/errors.ts   派发错误分类：哪些可重试、为什么
├── extensions/team/spawn.ts    成员 spawn 的纯函数化：参数、环境、模型与 effort 解析
├── extensions/members.ts       TeamManager：成员/任务/拓扑编排（re-export team/ 的规则）
├── extensions/render.ts     TUI 渲染（renderCall / renderResult）
│
├── bin/stepcode-team.mjs    成员侧 CLI shim（msg / status；手动/外部路径——成员通常用 topo_team_msg 工具）
├── bin/topo-search.mjs      searcher 角色的检索脚本：对 [stepcodeAgentTeam.searcher] 配置的端点提供
│                            search / fetch / batch（任何遵循其 JSON 契约的厂家均可；DeepSeek 的
│                            /v1/tools 端点只是默认值）。计费诚实：4xx 绝不重试，因为服务方只对成功
│                            调用计费。退出码 0 成功 / 1 请求失败 / 2 用法错误（缺 key 是 2 不是 1）。
└── agents/                  内置角色预设（scout · planner · worker · reviewer · searcher；自定义角色：<agentDir>/agents/、<project>/.stepcode/agents/）
```

成员是独立的 `step --mode rpc` 子进程，不加载本扩展（除非被授予子团队，见 §4），
只能经 topo_team_msg 工具（或 CLI shim）到达队长进程内的 socket——这是拓扑强制的天然收口点。

## 2. 数据流

```
队长派活（team_send / team_task start）
  → dispatch：assertTopologyDeclared
  → acquireSlot（全局并发门，nested 成员间消息除外——发送方已占位，再取会死锁）
  → ensureLive（spawning map 去重：同成员并发只起一个进程；失败重启用同一 session-id 续聊）
  → runDispatch：member.status=running → promptAndSettle（等 agent_settled）
       ├── 成功：usage 累加 → status=idle → save
       └── 失败：status=dead → killAndWait（防止新旧 run 在同一 session-id 上交错）→ 抛出
  → releaseSlot
```

### prompt→settle 路径，以及为什么要用假模型测它

`promptAndSettle` 只等一个事件：`agent_settled`——上游**只在一agent run 真正结束时**才发射它。
`prompt` 命令自己的 ack **不是**这个事件：`rpc-mode.ts` 在 `preflightResult` 就应答它，远早于回合结束。
因此一个**加载正常、preflight 通过、却从未进入 run** 的成员，根本不会产生 settle 事件，
而队长只能等满 `dispatch.timeoutMs`——成员那边明明活着、还在写文件。这就是反复出现的
`timeout waiting for member to settle` 退化的全部机理，而 `dispatchWithSettleGuard` 负责区分两者：
usage delta 为零时，它把该超时重新解读为「成员从未运行」，并点名搭建层面的原因
（`models.available` 之外的模型、未绑定的扩展），而不是暗示"跑得慢"。

由于这条路径需要模型调用，此前**没有任何零 token 探针走过它**——失效在门禁里不可见，只在花钱时才暴露。
`test/smoke/phase34.ts` 补上这个盲区：一个讲 OpenAI Chat Completions SSE 契约的本地 HTTP 服务，
成员经 `STEP_PROVIDER_API_URL` 被指向它（step provider 的 API 是 `openai-completions`，
base 派生为 `{apiBaseUrl}/v1`），并经 `memberSpawnEnv` 继承。Part A 证明成员零成本地真实跑完一个回合并 settle；
Part B 复现退化本身（端点接收请求后永不应答）并断言门禁察觉得到。宿主内置的 `faux` provider 不能替代它：
那是测试 harness 设施，未注册进运行时模型表。


任务板：`team_task create`（validateGraph 拒环/未知依赖 → recomputeReady）→
`start`（仅 `ready` 可派，assignee 必填，`dispatch.retries` 次重试）→
成功即 `completeTask`（解锁下游），耗尽重试则 `failTask`。

成员间消息：成员 `topo_team_msg` 工具 → socket → server 校验拓扑边 A→B →
`manager.sendMessage(B, msg, {nested:true})` → 回复经同一连接返回。该工具由成员侧消息扩展
（extensions/member-messaging.ts）注册，与 `stepcode-team` CLI shim 说同一套 JSONL 协议——
但不需要 shell，因此只读预设保持原状、其拓扑边始终可用。shim 保留作手动/外部路径。

## 3. 持久化布局

```
<agentDir>/teams/<teamId>/
  registry.json     团队状态（schemaVersion 1；原子写：tmp + rename，mode 0600）
                    ——默认落盘加密（AES-256-GCM 信封）；明文 registry 仍可加载，
                      故加密上线前创建的团队照常工作
  sessions/         成员 session 文件（--session-dir；上下文续聊的载体）
  prompts/          成员系统提示词（含协调段；respawn 时 --append-system-prompt 复用）
  sock              Unix socket（mode 0600，仅 owner 可连接）

<cwd>/.topo/                     首次激活时创建，绝非加载时
  team.key          加密密钥，mode 0600（缺失 → 降级为明文，绝不抛错）
  records/          每个团队任务一条协作记录（按 teamId 幂等）
  .gitignore        只追加不改写，使工作区不进 git
```

`<agentDir>` 遵循 `STEP_CODING_AGENT_DIR`（默认 `~/.stepcode/agent`），沙箱因此与真实环境隔离；
`storage.dir` 可整体改道。teamId 派生自队长 session 文件名（eph- 前缀的会话不可重附）。

两处存储是刻意分开的：`<agentDir>/teams/` 是本机运行时状态，`.topo/` 则是插件自有的项目级工作区。`.topo/` 只往已有的 `.gitignore` 追加（符号链接的 `.topo` 不跟随，各降级路径返回而不抛），因此已经 ignore 了相关路径的仓库不会被改动。

## 4. 深度与并发

- **递归深度**：队长 = 0，成员 = 1（`STEPCODE_TEAM_DEPTH` 逐层 +1）。子成员深度
  `< maxRecursionDepth` 时授予子团队：spawn 参数加 `-e extensions/index.ts` 且
  `STEPCODE_TEAM_AUTOACTIVATE=1`（子队长自动激活）；达到上限的成员 `--no-extensions`
  完全隔离（扩展工厂直接返回，零上下文开销）。
- **并发**：`dispatch.maxConcurrent`（默认 5）是进程启动前的全局信号量——超出即排队，
  成员进程直到有空位才启动；每成员另有串行队列（同一成员的 prompt 一个接一个）。
  成员间消息（nested）绕过全局门，避免「A 持位等 B、B 等位」的死锁。

## 5. 护栏位置一览

| 护栏 | 实现位置 |
|---|---|
| 默认关闭激活 | activation.ts（setUnavailableTools 关门 + 激活释放） |
| spawn 竞态互斥 | members.ts `spawning` map + `memberLocks` 串行化 |
| 失败即杀 | members.ts runDispatch catch → killAndWait |
| 派发失败上下文 | members.ts augmentDispatchError（mid-run 失败提示接力在途 + 成员名册） |
| 并发上限 | members.ts acquireSlot/releaseSlot |
| 拓扑强制 | team-server.ts handle + members.ts mayMessage |
| 递归深度 | index.ts 深度门 + members.ts buildSpawnArgs |
| socket 权限 | team-server.ts listen 后 chmod 0600 |
| 成本告警 | tools.ts costWarning（config.cost.warnThreshold，0 禁用） |
| idle 收割 | members.ts reapIdleMembers（跳过有排队派发的成员） |
| 成员名额（仅存活计数） | members.ts createMemberLocked（dead 记录可恢复但不占名额） |
| 退出清理 | index.ts session_shutdown → manager.shutdown（全置 dead + kill） |

## 6. 相关文档

- [PROTOCOL.md](PROTOCOL_CN.md)：RPC 命令/事件、socket 协议、registry schema、工具契约
- [CONFIGURATION.md](CONFIGURATION_CN.md)：配置参考
- [TESTING.md](TESTING_CN.md)：四层测试方法
- [../README.md](../README_CN.md)：使用说明
