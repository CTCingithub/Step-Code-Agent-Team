# 架构

> 本文档描述 Step-Code-Agent-Team 的组件构成、数据流与目录布局，以 `extensions/` 当前实现为准。
> 协议细节（RPC / socket / registry schema / 工具契约）见 [PROTOCOL.md](PROTOCOL.md)；测试方法见 [TESTING.md](TESTING.md)。

## 1. 组件总览

```
队长会话（step，加载本扩展）
│
├── extensions/index.ts      入口：加载配置 → 深度门 → 注册 6 个工具 →
│                            setUnavailableTools 关门（默认关闭）；
│                            激活触发：/agent-team 命令、input 钩子、before_agent_start 钩子、
│                            STEPCODE_TEAM_AUTOACTIVATE（子队长授予）
├── extensions/config.ts     配置：settings.json 的 stepcodeAgentTeam 节（默认值 < 旧版专用文件 < settings.json 节 < 环境变量覆盖）；校验与缓存
├── extensions/activation.ts 激活门：关键词/命令检测、工具释放
├── extensions/tools.ts      6 个 LLM 工具（create_member / send / task / set_topology / disband / status）
├── extensions/members.ts    TeamManager：成员生命周期、并发门、任务板调度、拓扑方法、
│                            每成员 spawn 互斥、失败即杀、oneshot、idle 收割
├── extensions/rpc-client.ts JSONL RPC 客户端（严格 \n 分行、id 关联、握手、abort、killAndWait）
├── extensions/team-server.ts Unix socket 服务：拓扑强制 + status(mayMessage)
├── extensions/topology.ts   五形状拓扑构造/校验/解析
├── extensions/registry.ts   团队状态持久化（原子写、storage.dir、旧版兼容）
├── extensions/presets.ts    agents/*.md 预设加载、扩展入口路径、shim 路径
├── extensions/render.ts     TUI 渲染（renderCall / renderResult）
│
├── bin/stepcode-team.mjs    成员侧 CLI shim（msg / status，携带发送方身份）
└── agents/                  角色预设（scout · planner · worker · reviewer）
```

成员是独立的 `step --mode rpc` 子进程，不加载本扩展（除非被授予子团队，见 §4），
只能经 shim 到达队长进程内的 socket——这是拓扑强制的天然收口点。

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

任务板：`team_task create`（validateGraph 拒环/未知依赖 → recomputeReady）→
`start`（仅 `ready` 可派，assignee 必填，`dispatch.retries` 次重试）→
成功即 `completeTask`（解锁下游），耗尽重试则 `failTask`。

成员间消息：成员 bash → `node bin/stepcode-team.mjs msg --to B --message ...` →
socket → server 校验拓扑边 A→B → `manager.sendMessage(B, msg, {nested:true})` → 回复经同一连接返回。

## 3. 持久化布局

```
<agentDir>/teams/<teamId>/
  registry.json     团队状态（schemaVersion 1；原子写：tmp + rename，mode 0600）
  sessions/         成员 session 文件（--session-dir；上下文续聊的载体）
  prompts/          成员系统提示词（含协调段；respawn 时 --append-system-prompt 复用）
  sock              Unix socket（mode 0600，仅 owner 可连接）
```

`<agentDir>` 遵循 `STEP_CODING_AGENT_DIR`（默认 `~/.stepcode/agent`），沙箱因此与真实环境隔离；
`storage.dir` 可整体改道。teamId 派生自队长 session 文件名（eph- 前缀的会话不可重附）。

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
| 并发上限 | members.ts acquireSlot/releaseSlot |
| 拓扑强制 | team-server.ts handle + members.ts mayMessage |
| 递归深度 | index.ts 深度门 + members.ts buildSpawnArgs |
| socket 权限 | team-server.ts listen 后 chmod 0600 |
| 成本告警 | tools.ts costWarning（config.cost.warnThreshold，0 禁用） |
| idle 收割 | members.ts reapIdleMembers（跳过有排队派发的成员） |
| 退出清理 | index.ts session_shutdown → manager.shutdown（全置 dead + kill） |

## 6. 相关文档

- [PROTOCOL.md](PROTOCOL.md)：RPC 命令/事件、socket 协议、registry schema、工具契约
- [CONFIGURATION.md](CONFIGURATION.md)：配置参考
- [TESTING.md](TESTING.md)：四层测试方法
- [../README.md](../README.md)：使用说明
