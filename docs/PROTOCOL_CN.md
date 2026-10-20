# 协议参考
> [English →](./PROTOCOL.md)

> 本文档固化 Step-Code-Agent-Team 的全部 wire 协议与工具契约，以 `extensions/` 与 `bin/` 当前实现为准。
> 改协议必须同步更新本文档与受影响的冒烟探针。

## 1. 成员 RPC 协议（stdio JSONL）

成员 = 长驻 `step --mode rpc` 子进程。队长经 stdio 驱动（`extensions/rpc-client.ts`）。

### 1.1 帧规则

- 一行一个 JSON 对象，**只以 `\n` 分行**（Node readline 会在 U+2028/U+2029 处断行，
  而这些字符在 JSON 字符串内合法，会损坏协议；客户端与 shim 均手写 `indexOf("\n")` 缓冲）。
- 行尾 `\r` 容忍（`replace(/\r$/, "")`）。
- 成员 stdin 必须是 pipe（`["pipe","pipe","pipe"]`）：`"ignore"` 会让 stdin 指向 /dev/null，
  prompt 写入静默丢失、成员读 EOF 退出。

### 1.2 命令（队长 → 成员，写 stdin）

| 命令 | 字段 | 说明 |
|---|---|---|
| `prompt` | `{type:"prompt", message}` | 让成员跑一轮；等到 `agent_settled` 才算完成 |
| `abort` | `{type:"abort"}` | 协作式中止当前 run（Esc / AbortSignal 触发） |

每个请求带客户端自增 `id`（`r1, r2, …`）用于关联响应。

### 1.3 响应与事件（成员 → 队长，stdout）

| 类型 | 关键字段 | 客户端处理 |
|---|---|---|
| `response` | `{id, type:"response", command, success, data?}` | 按 id 兑现/拒绝 pending；`success:false` 拒绝 |
| `entry_appended` | — | 视作握手完成 |
| `message_end` | `{message:{role:"assistant", content:[{type:"text",text}], usage}}` | 累加 usage；记录最后一条 assistant 文本；推送给 interim 监听者（流式进度） |
| `agent_settled` | — | 唤醒 settleWaiter，promptAndSettle 返回 |
| 其他 | `tool_execution_*`、`extension_ui_request` 等 | 忽略 |

握手：spawn 后等待首个 `response`/`entry_appended`（默认 15s 超时，失败即 kill 不留孤儿）。
关闭：进程退出/出错时 failPending + flushWaiters + onClose（registry 置 dead）。

## 2. 团队 socket 协议（Unix socket JSONL）

队长进程内 `TeamServer`（`extensions/team-server.ts`）监听
`<agentDir>/teams/<teamId>/sock`（chmod 0600）。成员经 shim 连接；
shim 从 spawn env 取身份与地址：`STEPCODE_TEAM_SOCK`、`STEPCODE_TEAM_MEMBER`。

请求（一行一个 JSON 对象）：

```jsonc
// 发消息（from 由 shim 自动附加）
{"from": "<sender>", "to": "<member>", "message": "<text>"}
// 查状态
{"from": "<sender>", "type": "status"}
```

响应：

```jsonc
// 消息成功
{"ok": true, "reply": "<text>"}
// status 成功
{"ok": true, "teamId": "...", "youAre": "<sender>", "mayMessage": ["<allowed>", ...],
 "members": [{"name","role","status"}], "tasks": [{"id","title","status","assignee"}]}
// 失败（拓扑拒绝 / 未知成员 / 缺 from / 非法 JSON）
{"ok": false, "error": "<message>"}
```

规则：

- **拓扑强制**：`mayMessage(from,to)` 为假即拒绝，错误信息内含该发送方的可用邻居；
  star（默认）下没有任何成员间直达消息，全部经由队长中转。
- **环形链长强制**：嵌套派发前 server 计算 `next = currentChainLength(from) + 1`
  （队长派发 = 0，成员每转发一次 +1）；`topology.maxLoopCount > 0` 且 `next` 超过上限时
  拒绝并提示发送方把结论写入最终报告（leader 不是消息目标）。嵌套派发携带 `chainLength: next`，manager 层在 dispatch
  前置校验兜底。
- **nested 豁免**：server 中介的派发带 `nested:true`，绕过全局并发门（发送方已占运行位），
  但每成员串行队列与拓扑门控仍然生效。
- 连接级错误（成员中途挂断）只记 debug 日志，不影响队长存活。

## 3. Registry schema（registry.json，schemaVersion 1）

```jsonc
{
  "schemaVersion": 1,
  "teamId": "<队长 session 派生的团队 id>",
  "createdAt": 1710000000000,
  "cwd": "<队长工作目录>",
  "members": [
    {
      "name": "scout1",                    // ^[a-z][a-z0-9_-]{0,31}$
      "role": "scout",
      "model": "step-5-preview",           // 可选
      "effort": "high",                  // 可选
      "tools": ["read", "grep"],           // 可选；缺省 = 全部工具
      "sessionId": "team-<teamId>-scout1", // 重启续聊的键
      "systemPromptFile": "<teamDir>/prompts/scout1.md",
      "pid": 12345,
      "status": "idle",                    // idle | running | dead
      "usage": {"input": 0, "output": 0, "cost": 0, "turns": 0}
    }
  ],
  "tasks": [
    {
      "id": "T1",
      "title": "...",
      "detail": "...",                     // 可选
      "blockedBy": [],                     // DAG 依赖；成环/未知 id 拒绝
      "assignee": "scout1",                // 可选
      "status": "ready",                   // pending | ready | running | done | failed
      "result": "..."                      // 终态时写入结果/原因
    }
  ],
  "topology": {"shape": "star", "edges": [["m1", "m2"]]}
}
```

兼容规则：`schemaVersion !== 1` → 视作不存在（返回 null）；缺 `topology` 字段 → 退化为 star；
原子写（`tmp + rename`，mode 0600），队长任意时刻崩溃都不会留下半截文件。

## 4. 队长侧 LLM 工具契约（extensions/tools.ts）

错误约定：非法输入抛错（工具结果 `isError`）；成功返回不带错误标。
激活前调用任何团队工具都会抛「not active」（双保险：工具已被声明不可见 + 运行时断言）。

| 工具 | 关键参数 | 行为 |
|---|---|---|
| `team_create_member` | `name` 必填；`role`/`model`/`effort`/`tools`/`systemPrompt` 可选 | 幂等创建/恢复；角色命中 `agents/<role>.md` 预设；显式参数优先于预设；模型解析见 CONFIGURATION.md `models` 节；**恢复时传入的配置参数被忽略，结果文本逐项列明** |
| `team_send` | `member`、`message` 必填；`taskId` 或 `mode` 可选 | 等待完整回复；同成员串行、跨成员并行；`taskId` 以任务方式派发（running→done，失败重试 `dispatch.retries` 次）；`mode:"oneshot"` 无状态一次性进程；`taskId` 与 oneshot 同传即抛错；`dispatch.timeoutMs` 覆盖整条嵌套接力链，超时错误提示接力可能仍在途并列出成员名册 |
| `team_task` | `action`（create/start/complete/fail/list）+ `id`/`title`/`blockedBy`/`assignee`/`result`/`reason` | DAG 任务板；终态任务不可再 complete/fail |
| `team_set_topology` | `shape`（star/pipeline/mesh/ring/custom）+ `edges`（custom 必填） | 建成员后、派活前声明拓扑；未知成员/自环抛错；每个成员都内置 `topo_team_msg` 工具（无需 bash），边对所有角色可用——被拒时会列出发送方的可用队友 |
| `team_disband` | `member` 可选 | 省略即解散全队；session 保留，重建即续聊 |
| `team_status` | 无 | 成员状态/用量 + 任务板 + 累计花费（超阈值附告警，阈值 0 禁用） |

输出约定：成员回复超过 50KB 截断，全文在 tool details 的 `fullText`；长 run 期间 interim
文本经 `onUpdate` 流式推给 TUI。

## 5. 成员侧环境变量（spawn 时注入）

| 变量 | 作用 |
|---|---|
| `STEPCODE_TEAM_SOCK` | 团队 socket 路径（shim 连接目标） |
| `STEPCODE_TEAM_MEMBER` | 发送方身份（拓扑强制的依据） |
| `STEPCODE_TEAM_DEPTH` | 本成员在团队树中的深度（队长 = 0） |
| `STEPCODE_TEAM_MAXDEPTH` | 生效的深度上限（可能来自项目级配置，队长加载时才能读到）；成员进程的配置加载器据此覆盖 `members.maxRecursionDepth` |
| `STEPCODE_TEAM_AUTOACTIVATE` | `1` = 授予子团队，成员进程加载本扩展并自动激活 |
