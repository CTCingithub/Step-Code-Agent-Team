# 测试与优化计划
> [English →](./TESTING-OPTIMIZATION-PLAN.md)

> 来源：2026-10-17 对 Step-Code-Agent-Team 全量代码的走查（extensions/ 10 个模块 + bin shim + 预设 + 文档）。
> 本文档分四部分：**① 发现汇总（按严重度分级）② 测试计划（四层）③ 优化计划（里程碑）④ 执行顺序**。

---

## 1. 发现汇总

严重度定义：**P0** = 可损坏状态或产生错误结果；**P1** = 资源/鲁棒性缺陷；**P2** = UX 与细节。

### P0 — 正确性

| # | 位置 | 问题 | 影响 | 修复方向 |
|---|---|---|---|---|
| P0-1 | `members.ts` createMember（record push + save 先于 ensureLive 完成） | **spawn 竞态**：LLM 在同一工具批次并行调用 `team_create_member(t1)` 与 `team_send(t1, …)` 时，sendMessage 已能在 registry 找到记录并走 dispatch→ensureLive，与 createMember 自己的 ensureLive **各起一个进程**，共用同一 `--session-id` | 两个进程并发写同一 session 文件 → 上下文损坏、回复交错 | 每成员 spawn 互斥：`Map<string, Promise<MemberRpc>>` 记录在途 spawn，或把 ensureLive 串入每成员队列 |
| P0-2 | `members.ts` dispatch catch 分支 | **失败后复用存活 rpc**：promptAndSettle 超时失败时成员进程可能仍在运行，status 置 dead 但 rpc 留在 map；下次 dispatch 的 ensureLive 认为未 closed 而复用，向仍在跑的进程发新 prompt | 新旧 run 交错；陈旧的 `agent_settled` 可能提前 resolve 新 run，返回错误文本/用量 | dispatch 出错时 `rpc.kill()` 并移出 map，下次 dispatch 重新 spawn（session-id 保证上下文恢复） |

### P1 — 资源与鲁棒性

| # | 位置 | 问题 | 影响 | 修复方向 |
|---|---|---|---|---|
| P1-1 | `members.ts` sendOneshot | oneshot **绕过每成员队列与全局信号量** | 并发 oneshot 可超过 MAX_CONCURRENCY=4 的上限 | oneshot 执行段也 `acquireSlot/releaseSlot` |
| P1-2 | `rpc-client.ts` waitForClose | closeWaiters 的 resolver 在 promptAndSettle 的 race 结束后**从不移除** | 每次 dispatch 泄漏一个闭包（随 dispatch 次数无界增长） | race 结束后移除对应 waiter（或改为一次性消费） |
| P1-3 | `members.ts` shutdown | 杀进程但不更新 registry 状态 | 队长重启 resume 后 `team_status` 对已死进程显示陈旧 `idle`，直到下次 dispatch 才纠正 | shutdown 时全部标记 dead 并 save |
| P1-4 | `tools.ts` 全部 execute + `rpc-client.ts` abortRun | **AbortSignal 未接线**：Esc 取消时 signal 被忽略，abortRun 无调用方 | 长成员 run 无法从队长侧取消，只能等 180s 超时 | signal → sendMessage/startTask → dispatch：abort 时调 `rpc.abortRun()` 并以 AbortError 拒绝 |
| P1-5 | `team-server.ts` listen | socket 文件按默认 umask 创建（通常同用户组/其他用户可连接） | 其他本地用户可向成员发消息，消耗 key 所属者额度 | listen 后 `fs.chmodSync(socketPath, 0o600)` |
| P1-6 | `team-server.ts` server.on("error") | 静默吞掉所有错误 | listen 失败（如竞态 EADDRINUSE）时消息链路静默失效，难排查 | 至少 stderr 打点；建议加 `STEPCODE_TEAM_DEBUG` 调试开关统一管理 |

### P2 — UX 与细节

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | `tools.ts` 全部 execute | `onUpdate` 从未调用：长成员 run 期间 TUI 工具调用像卡住 | 把成员 `message_end` 的中间文本经 onProgress 回调推到 `onUpdate`（对齐官方 subagent 示例的流式行为） |
| P2-2 | `tools.ts` truncateOutput | 文案声称 "Full output preserved in tool details"，但 details 实际不含全量文本 | details 增加 `fullText` 字段（或修正文案） |
| P2-3 | `rpc-client.ts` lastAssistantText | 某次 run 未产生 assistant 文本时，返回的是**上一次 run** 的文本 | prompt 开始时重置 `lastAssistantText` |
| P2-4 | `tools.ts` team_send | 同时传 `taskId` 与 `mode:"oneshot"` 时 oneshot 被静默忽略 | 参数校验：该组合直接抛错 |
| P2-5 | `members.ts` completeTask/failTask | 无状态机校验：可把 `pending` 直接置 done 解锁下游 | 校验合法迁移（pending/ready/running → done/failed），或在文档中明确"手动覆盖"语义 |
| P2-6 | `members.ts` disband | 未知成员名静默 no-op（返回 []） | 抛 "Unknown member" |
| P2-7 | `tools.ts` costWarning | `parseFloat("0") || 1` 使 0 无法禁用告警；负值直穿 | 正确解析：非法/缺失回退默认，显式 0 视为禁用 |
| P2-8 | `presets.ts` extensionDir | `new URL(import.meta.url).pathname` 不解码百分号（路径含空格/非 ASCII 时断裂） | 改用 `fileURLToPath(new URL(import.meta.url))` |
| P2-9 | `members.ts` reapIdleMembers | 与排队中的 dispatch 竞态：可能杀掉刚要被使用的 idle 成员（respawn 正确但浪费一次 spawn） | 记录即可；如修可让 reaper 跳过"队列非空"的成员 |
| P2-10 | `tools.ts` | `emptyUsage` 导入未使用 | 删除 |

---

## 2. 测试计划

原则：**先写可复现测试，再修复**；P0 两项必须先有失败测试。测试分四层，前两层零成本，第三层用测试 key（沙箱隔离）。

### A 层 — 单元测试（无 LLM，node/jiti 直接加载模块）

| 测试 | 通过标准 |
|---|---|
| registry：saveRegistry 原子写 | 并发 50 次 save 后 JSON 可解析且为某次完整快照；无 `.tmp-*` 残留 |
| registry：loadRegistry 健壮性 | 坏 JSON / schemaVersion≠1 / 文件缺失均返回 null 不抛 |
| registry：agentDir | 设 `STEP_CODING_AGENT_DIR` 后 teamsRoot 指向其下 |
| tasks：validateGraph | 自环、间接环（T1→T2→T1）、未知依赖均抛 TaskGraphError；合法 DAG 不抛 |
| tasks：recomputeReady | 全场景矩阵：无依赖→ready；依赖 done→ready；依赖 failed/pending/running→pending；终态不被改写 |
| tasks：nextTaskId | 删除中间任务后编号复用最小空洞 |
| JSONL 框架（rpc-client onData） | 行内含 U+2028/U+2029 的 JSON 不被错误断行；半行缓冲正确拼接；`\r\n` 与裸 `\n` 均处理 |
| presets：frontmatter | `tools: [a, b]` 数组、引号值、CRLF 换行、缺 name/description 跳过 |
| usage：usageDelta/addUsage | 跨进程重置场景下 delta 不为负、累计正确 |

### B 层 — 零 token 集成测试（`step -e` + 探针扩展，沿用 smoke-phase* 模式）

| 测试 | 通过标准 |
|---|---|
| **P0-1 spawn 竞态** | 探针并发调用 `createMember(t1)` 与 `sendMessage(t1,…)`（send 用不会到达 LLM 的方式或断言在 spawn 互斥处合并）：全程只有 **1 个**成员进程（pid 唯一、`pgrep -f team-.*-t1` 计数为 1） |
| **P0-2 失败后不复用** | dispatch 进行中 `kill -9` 成员进程；下一次 send 自动 respawn，且成员记得此前对话（session-id 恢复） |
| oneshot 并发（P1-1 修复后） | 并发 6 个 oneshot，在飞 dispatch 数 ≤ 4 |
| closeWaiters（P1-2 修复后） | 连续 100 次 dispatch 后 closeWaiters 长度不增长（探针暴露内部状态或间接断言） |
| reap（P1-3 相关） | 伪造 lastActivity 为 31 分钟前：idle 成员被杀且 registry 置 dead；running 成员不动 |
| shutdown 状态（P1-3 修复后） | session_shutdown 后 registry 全部成员 status=dead |
| server 陈旧 socket | 连续 start 两次不抛且可连接；stop 后 socket 文件被删除 |
| socket 权限（P1-5 修复后） | listen 后文件 mode 为 600 |

### C 层 — LLM 路径测试（测试 key，沙箱内，每条成本极小）

| 测试 | 通过标准 |
|---|---|
| 并行调度 | 2 成员同时 `team_send`：均成功返回；TUI/日志显示并发（可选：总耗时显著小于串行） |
| 任务链 | `team_task create` T1、T2(blockedBy T1) → `start T1` → `start T2`：状态流转 pending→ready→running→done，结果回写 |
| oneshot 模式 | `team_send mode:"oneshot"`：有回复；`team_status` 不出现新的常驻进程 |
| 成员崩溃恢复 | run 中 `kill -9` 成员；下一次 send 成功且记得上文 |
| 成本护栏（P2-7 修复后） | `STEPCODE_TEAM_COST_WARN=0.0001` 时 team_status 输出含告警；设为 0 时禁用 |
| 中止（P1-4 修复后） | 长任务触发 abort：成员停止、状态合理、无孤儿进程 |
| 流式进度（P2-1 修复后） | 长成员 run 期间 onUpdate 至少被调用一次（探针层验证回调触发） |
| 截断（P2-2 修复后） | 成员产出 >50KB：正文截断，details.fullText 含全量 |

### D 层 — 鲁棒性与边界

| 测试 | 通过标准 |
|---|---|
| 队长崩溃恢复 | 任意时刻 kill 队长：registry 无 `.tmp-*` 残留；resume 后团队视图与磁盘一致 |
| Unicode 往返 | 含 emoji/中文/多字节字符的消息进出成员不变形 |
| 参数校验 | 空 message、超长/非法成员名、未知 task id、未知 member：均得到明确错误（isError）而非静默 |
| 目录不存在 | 删除 `teams/<id>/sessions` 后 createMember 仍正常（mkdir recursive） |
| 大规模 | 8 成员上限、999 任务上限、单任务 detail 50KB：行为符合文档 |

---

## 3. 优化计划（里程碑）

### M1 — 正确性修复（P0 + P1 核心）

1. P0-1 每成员 spawn 互斥（先加 B 层失败测试）
2. P0-2 dispatch 失败即杀 rpc（先加 B 层失败测试）
3. P1-1 oneshot 纳入信号量
4. P1-2 closeWaiters 泄漏修复
5. P1-3 shutdown 标记 dead

### M2 — 控制与安全

6. P1-4 AbortSignal 全链路接线（signal → abortRun → AbortError）
7. P1-5 socket chmod 600
8. P1-6 服务器错误日志 + `STEPCODE_TEAM_DEBUG` 调试开关（统一收编此前静默 swallow 的点）

### M3 — UX 与细节

9. P2-1 流式进度（message_end → onUpdate）
10. P2-2 details.fullText；P2-3 lastAssistantText 重置
11. P2-4 参数组合校验；P2-5 任务状态机；P2-6 disband 未知名抛错
12. P2-7 costWarning 解析；P2-8 fileURLToPath；P2-10 清理未用导入
13. P2-9 记录为已知限制（README 注明）

### M4 — 文档与打包

14. 将架构与协议从本地 session plan 提升为仓库文档：`docs/ARCHITECTURE.md`（组件图、数据流、目录布局）、`docs/PROTOCOL.md`（RPC 命令/事件、socket 协议、registry schema、工具契约）
15. 新增 `docs/TESTING.md`（本文档测试计划的操作化版本：如何跑各层测试）
16. README 中英增加文档链接与"已知限制"小节
17. `step install <仓库绝对路径>` 端到端验证（用户侧执行，会改真实 settings；本地路径安装为引用式，直接安装检出副本即可）

---

## 4. 建议执行顺序

```
第 1 步：按 A 层补单元测试（纯函数，零风险，立即发现 tasks/registry 回归）
第 2 步：为 P0-1/P0-2 写 B 层失败测试 → 修复 → 转绿
第 3 步：M1 其余项 + B 层对应测试
第 4 步：M2（abort 接线后用 C 层"中止"用例验证）
第 5 步：M3 + C/D 层全量回归（测试 key）
第 6 步：M4 文档与安装验证
```

每个里程碑结束跑一次回归：A+B 层全量 + C 层抽样（并行调度、任务链、崩溃恢复）。协议或进程行为发生变化时，必须重跑 B 层竞态类用例。
