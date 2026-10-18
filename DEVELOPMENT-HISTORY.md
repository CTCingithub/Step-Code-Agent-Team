# 开发历程（Development History）

> 按时间顺序罗列截至目前用户的每条 prompt、对应的开发思路决策、agent 实际所做工作与验证结果。
> 最近更新：2026-10-18（plan-22，修复 /agent-team 带参 prompt 无反馈；此前为 plan-18 复查轮）。

## 总览

| # | 用户 prompt（摘要） | 计划 | 核心产出 | 关键修复 |
|---|---|---|---|---|
| 1 | 创建对标 DeepSeek Harness 智能体团队的插件 + 开发计划 | plan-1 | Phase 0–5：成员生命周期/任务板/成员消息/护栏/预设/文档 | 成员 stdin 为 /dev/null 导致 RPC prompt 静默丢失 |
| 2 | gitignore + README 更新 + 自主分批提交推送 | plan-7 | 9 个逻辑 commit 推送 origin | — |
| 3 | 保管测试 key 到 gitignore 文档 + 继续开发 | plan-10 | local/ 密钥文档；LLM 全路径冒烟（phase4） | stdio 缺陷复验修复 |
| 4 | 全面审查项目，生成测试与优化计划 | plan-14→17 | docs/TESTING-OPTIMIZATION-PLAN.md；M1–M3 修复 | 18 项发现：竞态互斥/失败即杀/abort 接线/socket 0600 等 |
| 5 | 功能默认关闭 + 配置文件 | plan-21 | config.ts / activation.ts；/agent-team；models 节 | headless -p 工具审批拦截（--approval-mode auto） |
| 6 | 启动子团队前先设计通信拓扑 | plan-30 | topology.ts 五形状 + server 强制 + team_set_topology | — |
| 7 | 递归深度/并发上限/README 致谢/上下文节约 | plan-37 | maxRecursionDepth / maxConcurrent=5 / 子队长授予 | — |
| 8 | 沙箱全面测试与问题优化 | plan-43 | phase9–12 探针 + sandbox/TEST-PLAN.md | 嵌套死锁/门控泄漏/子队长工具饥饿/崩溃状态滞留/提示加固 |
| 9 | 历程文档 + README 改版 + 交接文档 | plan-50 | 本文档 + mermaid README + HANDOFF.md | — |
| 10 | 阅读工作区、规划并执行后续工作（文档同步为贯穿要求） | plan-51 | docs/ARCHITECTURE/PROTOCOL/TESTING + README 中英已知限制；项目级配置接线（trust 门控 + phase13 探针）；零 token 探针入库 test/smoke/ + runner；安装打包审计 + TUI 验证清单 | phase9 旧断言哨兵值越界 |
| 11 | 拓扑图示化 + 环形 loop 上限 + README 配置文档 + 沙箱测试项目 | plan-52 | topology.maxLoopCount（默认 2、0 无上限；server + manager 双层强制；phase14 探针）；README 主图纵向化 + 五形状 mermaid 总图；README 配置节扩写；沙箱可运行测试小项目 | — |
| 12 | 配置文件位置迁移到 settings.json 约定 | plan-53 | 配置改存 settings.json 的 stepcodeAgentTeam 节（全局 <agentDir>/settings.json + 项目级 <cwd>/.stepcode/settings.json），旧专用文件保留为只读回退；phase6/9/13/14 先红后绿；沙箱 cfg-* fixture 全迁移 | 探针先红 16 项 |
| 13 | 全面复查与优化（三路独立审查 + 定向自查） | plan-18 | 修复 15 项缺陷（kill 升级死代码/定时器泄漏/信号量竞态/任务双派/消息环死锁/reaper/oneshot/disband/shim 截断等）；冒烟集结构化判定 + live 接线检查；新增 docs/MANUAL-TESTING.md | runner 曾误判 phase2 日志中的任务状态 failed（已收窄模式） |
| 14 | 修复 /agent-team 带参 prompt 无反馈 | plan-22 | 命令后文本经 pi.sendUserMessage 转发为真实用户消息（空闲直发/流式 followUp）；runner 新增 live-args-forward 检查 | 修复前会话文件中无任何用户消息记录 |

## 明细

### 1. 初始开发（plan-1，6 个 Phase）

**用户 prompt**：「我希望给 Step Code 创建一个插件，以实现类似于 DeepSeek Harness 的智能体团队的功能。请给我创建一个可行的开发计划」（后续修订：斜杠命令改为 /agent-team；配置增加可用模型列表与两个默认关闭的自主选择开关）

**思路**：
- 队长 = 当前会话；成员 = 长驻 `step --mode rpc` 子进程，上下文持久化于 session 文件，同 session-id 重启即续聊
- 任务板为 DAG（blockedBy）；成员间消息必经队长进程内的 Unix socket（天然强制点）
- 先研究后计划：通读官方扩展文档与 subagent 示例，RPC 探针先行验证协议假设

**工作**：`extensions/`（index/rpc-client/members/tasks/registry/team-server/presets/tools/render）、`bin/stepcode-team.mjs`、`agents/` 四预设、`prompts/`、`skills/`、README 中英、`sandbox/`（run.sh/probe.sh/phase1–3 冒烟）

**验证与修复**：零 token 冒烟 + LLM 端到端；修复关键缺陷——成员 spawn 的 stdio 首项为 `"ignore"`（stdin 指向 /dev/null），prompt 写入静默丢失、成员读 EOF 退出，改 `["pipe","pipe","pipe"]` 后全链路恢复。

### 2. 版本管理落地（plan-7）

**用户 prompt**：「请创建 .gitignore，修改 README，然后自主分批做 git commit 和 push。之后也自主提交」

**工作**：建立"分批 conventional commit + 推送 + 本地/远程 HEAD 一致性验证"的自主提交约定；此后所有变更均按此执行。

### 3. 测试 key 保管与 LLM 验证（plan-10）

**用户 prompt**：「测试用 API key 是 …，请妥善保存到一个文档中，并把这个文档写入 .gitignore…然后开始后续开发」

**工作**：`local/test-api-key.md`（权限 600，`local/` 加入 gitignore，key 只经环境变量传递）；随后完成 LLM 全路径冒烟（回复/上下文记忆/重启恢复/成员间消息）。

### 4. 全面审查与优化（plan-14 → plan-17）

**用户 prompt**：「请全面检查项目，然后思考后，生成测试与优化计划」

**工作**：通读全部模块，产出 `docs/TESTING-OPTIMIZATION-PLAN.md`（18 项发现分级 + 四层测试计划）；按 M1–M3 实施修复：spawn 互斥与 createMember 串行化、失败即杀并等待退出、oneshot 纳入信号量、closeWaiters 泄漏、shutdown 状态诚实、AbortSignal 全链路、socket 0600、流式 onUpdate、fullText、任务状态机、costWarning 解析等；新增 smoke-phase5 回归探针。

### 5. 默认关闭 + 配置文件（plan-21）

**用户 prompt**：「本插件的功能默认不启动，除非 prompt 中出现斜杠命令或指定使用本插件；需要配置文件」

**思路**：用 `pi.setUnavailableTools()` 在加载时声明团队工具不可用（从模型工具集与提示词剔除），激活时清空声明；`before_agent_start` 作为 headless 模式的第二触发点；配置集中于 `<agentDir>/stepcode-agent-team.json`，深度/并发/模型/拓扑/成本全部收敛为配置项。

**工作**：新增 `config.ts`（默认值/合并/校验/环境变量覆盖）、`activation.ts`（门控 + 关键词/命令检测）；`/team` 更名 `/agent-team`；`models` 节（available / autonomousSelection / autonomousThinking，默认关闭）；dispatch 信号量门前移至 spawn 前。

**修复**：headless `-p` 模式默认拦截派生进程的工具——文档与 smoke 均需 `--approval-mode auto`。

### 6. 通信拓扑（plan-30）

**用户 prompt**：「有必要在启动子代理团队前，根据任务需求设计子代理之间的通信拓扑，然后再开始工作」

**思路**：评估为"方向正确但避免过度设计"——默认星型（队长中转）+ 按任务 opt-in 其他形状 + 消息层强制；发送方身份经 spawn env 注入、shim 转发；`requireDeclaration` 可字面落实"先设计再开工"。

**工作**：新增 `topology.ts`（star/pipeline/mesh/ring/custom + 校验 + 兼容解析）；`team-server.ts` 越界拒绝并告知可用邻居、status 返回 mayMessage；新增 `team_set_topology` 工具与 SKILL 决策指南。

### 7. 递归深度与并发上限（plan-37）

**用户 prompt**：「添加子智能体最大递归深度选项（默认 1）；同时运行子智能体数量上限（默认 5），多于上限则等待；功能尽量通过代码实现，节约智能体上下文；README 说明参考了 DeepSeek Harness」

**思路**：深度经 `STEPCODE_TEAM_DEPTH` 逐层传递；达到上限的会话中扩展工厂直接返回（完全惰性，零上下文开销）；子队长经 `-e` 加载扩展 + `STEPCODE_TEAM_AUTOACTIVATE=1` 自动激活；并发上限复用 `dispatch.maxConcurrent`（默认 4→5）并把门移至启动前。

**工作**：`currentDepth()`、`buildSpawnArgs` 返回 {args,env}、index.ts 深度门与自动激活；README 中英增加 DeepSeek Harness 参考声明；smoke-phase8 以 /proc 实检 spawn 参数与环境变量。

### 8. 沙箱测试战役（plan-43）

**用户 prompt**：「请思考后创建在沙箱中的测试计划，然后开始测试并优化出现的问题」

**思路**：零 token 探针优先、LLM 探针最小调用；先写失败测试再修复；预判嵌套消息死锁并设计针对性用例。

**工作**：`sandbox/TEST-PLAN.md` + phase9–12 探针（配置边界/并发 live/深度2链/杂项覆盖）+ 命令路径测试；修复 4 个产品缺陷 + 1 处提示加固（详见 TEST-PLAN.md 第六节）；修复后 phase1/2/3/5/6/7 + phase4 全量回归通过。

### 9. 文档化与交接（plan-50）

**用户 prompt**：「写开发历程文档；README 改用 mermaid 图、英文版加中文版链接、添加拓扑功能介绍；写一个让其他 session 阅读后可继续开发的文档」

**工作**：本文档 + README 中英 mermaid 改版与拓扑专节 + `HANDOFF.md` 交接文档。

### 10. 后续工作规划与执行（plan-51，已完成）

**用户 prompt**：「请阅读工作空间，了解项目与当前进度，然后规划后续工作」（修订：「开始按计划执行，注意同步修改或更新各类相关文档」）

**思路**：通读仓库后确认 Phase 0–5 与 M1–M3 均已落地、phase1–12 探针全绿，剩余缺口收敛为四类：M4 文档补齐 → 项目级配置接线 → 零 token 探针固化为入库资产 → 用户侧验证（`step install` / TUI）前置检查。确定「文档同步」为贯穿要求并写入计划。

**工作（已完成）**：① `docs/ARCHITECTURE.md`（组件/数据流/护栏位置）、`docs/PROTOCOL.md`（RPC/socket/registry/工具契约，全部对齐源码）、`docs/TESTING.md`（四层测试操作化）；README 中英新增「文档」链接表与「已知限制」小节。② 项目级配置接线：`applyProjectConfig`（trust 门控、session_start 就地合并、env 仍最高优先）+ `STEPCODE_TEAM_MAXDEPTH` 向子成员传播生效深度上限；配套 smoke-phase13（先红后绿，14/14 通过、1 项因探针环境未授信而 SKIP）；phase9 相应断言更新（旧哨兵值 99 越界 1–64 校验范围，改 7）。

**收尾**：安装打包审计结论——本地路径安装整目录拷贝/硬链、不尊重 .gitignore，README 中英增加「从干净导出物安装」指引，package.json 增加 `files` 白名单（纵深防御）；`docs/TUI-VERIFICATION.md` 交付 TUI 人工验证清单。四项后续工作全部完成，余下为用户侧执行项（TUI 清单打勾、干净导出物安装、LLM 遵循度观察）。

### 11. 拓扑图示化与环形 loop 上限（plan-52）

**用户 prompt**：「README 中 mermaid 画的图改为纵向的；README 中需要提到几类子智能体的拓扑结构，并用画图表示；请添加环形拓扑的最大 loop 次数选项，默认为 2，用 0 表示无上限；请在沙箱中设计一个简单的小项目用于测试；README 中应该包含可配置项的介绍，以及如何修改这些内容」

**思路**：loop 上限约束**成员间消息链长度**（队长→成员派发记链长 0，成员每转发一次 +1），超限即拒并提示发送方向队长汇报——同时天然防止环形巡游死锁（发送方持运行位等待、目标方又排队等位）。簿记收敛为 TeamManager 的 `withChainLength` 原语（派发与探针共用），server 在嵌套派发前计算 next 并拒绝，manager 在 dispatch 前置校验兜底。

**工作**：① `topology.maxLoopCount`（config.ts 默认 2、校验 0–64、0 = 无上限）；members.ts 链长簿记（`currentChainLength` / `withChainLength`）+ `assertLoopBound`；team-server.ts 嵌套派发前拒绝。② `test/smoke/phase14.ts`（先红后绿）：配置面（默认/覆盖/0/越界/类型）、manager 层超限即抛（不到 dispatch）、server 层经 shim 拒绝（withChainLength 确定性模拟中链成员，无时序竞态）、拓扑拒绝优先于 loop 检查、边界（链长 = 上限）放行。③ README 中英：主架构图 `flowchart LR → TD`；拓扑节新增五形状 mermaid 总图（ring 子图标注 loop 上限）；配置节扩写（三级配置位置表 + 可配置项速览 + 修改生效方式 + env 清单补 MAXDEPTH）。④ CONFIGURATION/PROTOCOL/TESTING/HANDOFF 同步。⑤ 沙箱测试小项目：`sandbox/project/` 重建为零依赖 Node.js 任务管理器，埋 off-by-one 种子 bug（`complete(id)` 按 `id-1` 索引）；TEST-PLAN.md 第七节记录结构与三类演示剧本（pipeline 修复链 / ring 巡回观察 loop 上限 / star 并行审查）。

**验证**：phase14 先红（8 项按预期失败）后绿；`npm run smoke` 全回归通过（phase5 无 key SKIP）；沙箱项目 `npm test` 复现种子 bug 失败（7/8、退出码 1），临时修复验证 8/8 全绿后还原为演示状态。

### 12. 配置位置迁移到 settings.json（plan-53）

**用户 prompt**：「我不满意目前配置文件的位置，请选择更合适的路径。你可以检索其他的step code插件项目，或者step code好象是从pi改的，检索pi的插件是如何存放配置信息的」

**调研**：Step Code 官方文档（`~/.stepcode/bin/docs/settings.md`、`extensions.md`、`packages.md`）明确约定——设置存于 JSON settings 文件：全局 `~/.stepcode/agent/settings.json`、项目级 `.stepcode/settings.json`（项目覆盖全局、嵌套合并、trust 门控；`step install/config` 等命令只读写已知键、保留未知键）。示例扩展无自带配置文件先例。结论：插件配置应作为 settings.json 的命名节，而非在 agentDir 根放置专用文件。

**思路**：配置迁入 `stepcodeAgentTeam` 节（全局 `<agentDir>/settings.json`、项目级 `<cwd>/.stepcode/settings.json`），优先级 **内置默认 < 旧版专用文件 < settings.json 节 < env 覆盖**（全局与项目级两个层级各自如此）；旧专用文件保留为只读回退（debug 模式提示迁移），插件绝不写入 settings.json。

**工作**：① `extensions/config.ts`：`CONFIG_SECTION`/`SETTINGS_FILE_NAME` 常量、`settingsFilePath`/`projectSettingsFilePath`、`readSection`、`applyGlobalTier`、`legacyNote`；`loadConfig`/`applyProjectConfig` 改双层加载。② 探针先红后绿：phase6/9/13/14 改用 settings.json 节并新增旧文件回退断言（先红共 16 项，实现后全绿）；phase9 的项目级测试改用合成 projectDir，避免污染仓库真实的 `.stepcode/settings.json`。③ 沙箱 8 个 cfg-\* fixture 迁移为 settings.json。④ 文档：CONFIGURATION.md 位置/优先级/示例、README 中英配置节、HANDOFF §1 同步。

**验证**：phase6/9/13/14 全绿；phase9 + 迁移后的 cfg-misc 实测 16 项 ambient 检查全过。

### 13. 全面复查与加固（plan-18）

**用户 prompt**：「请再次全面检查并优化项目，然后告诉我有哪些内容需要我手动测试」

**思路**：三路只读审查 subagent 并行（代码正确性 / 文档一致性 / 测试与运维健全性）+ 定向自查（陈旧引用、pristine 漂移、探针暂存风险），汇总后按严重度处理；涉及探针行为的先改探针复现再修；其余记录为已知限制。

**工作**：① 修复 15 项缺陷——rpc-client：SIGKILL 升级死代码（`proc.killed` 送达信号后恒为 true，改用真实退出状态）、settle 定时器与 waiter 泄漏（race 被 close/abort 赢时 finally 清理）；members：acquireSlot/releaseSlot 移交式改造（在飞派发可超过 maxConcurrent 的竞态）、startTask 每任务锁（并发 start 双派发双计费）+ 终态错误不再掩盖真实失败、等待环检测（`wouldCycle`/`withWaitingOn`，把成员互等死锁转为明确拒绝）、reaper 完成时刷新 lastActivity 且 killAndWait、oneshot 标记 running/idle + SIGKILL 升级、disband 清理每成员簿记；team-server：死锁防护、listen 错误始终留痕、每连接请求序列化、stop 销毁存活连接；index：reaper 间隔逐 tick 活读（项目级配置可生效）、getManager 停机守卫；tools：成本告警改团队总花费、截断不拆代理对；config：读取错误与缺失区分（debug 留痕）、自有键合并（防 Object.prototype 阴影）；registry：members/tasks 形状校验；shim：exitCode+end 刷新管道输出、leader 断连即失败。② 冒烟集硬化：runner 结构化判定（DONE 存在且探针日志无 FAIL 标记，替代子串计数）、信号安全清理、新增两个零 token live 检查（受信任项目配置抵达 index.ts 自身配置实例、/agent-team 命令路径）；phase13 移除 vacuous live 块（每个 -e 扩展各自持有 config 模块实例，探针内不可观测）与仓库真实 settings.json 的暂存污染；phase2/7/14 补输入验证、畸形注册表、等待环单测。③ 文档修正 6 处（README 中英 Status 节探针路径、HANDOFF phase 列表与项目配置路径、ARCHITECTURE 配置优先级、TUI-VERIFICATION team_status 预期）+ 沙箱 pristine 同步与 TEST-PLAN fixture 描述校正。④ 新增 `docs/MANUAL-TESTING.md`（8 类人工验证项 + 已知限制）。

**验证**：全量 `npm run smoke` 全绿（10 个 phase + 2 个 live 检查）；phase5 带 key 复跑通过；期间 runner 新模式曾将 phase2 日志中的任务状态 `failed` 误判为失败，收窄失败模式（`FAIL `/`FAILED`）后转绿。

### 14. 修复 /agent-team 带参无反馈（plan-22）

**用户 prompt**：「任务1失败，我在沙箱环境中，尝试的prompt是"/agent-team 请阅读工作空间后，使用agent team功能，开始修改"，但是没有看到TUI有任何反馈内容」

**根因**：harness 把以已注册斜杠命令开头的输入**整条路由给命令处理器并旁路 agent**；本插件 `/agent-team` 的处理器忽略 `_args`，命令后的自然语言请求被整体丢弃。用户只能看到瞬时的激活/团队板 toast（易错过），表现为「无任何反馈」。证据链：沙箱会话文件中无该 prompt 的任何记录（连原始输入都没进会话）；PTY 驱动真实 TUI 复现——团队板出现但请求文本缺失；RPC 实验中命令触发、board 出现，但 prompt 从不抵达 agent。对照：官方示例 `send-user-message.ts` 证实命令上下文可用 `pi.sendUserMessage` 转发。

**修复**：`extensions/index.ts` 命令处理器——激活并展示团队板后，若 args 非空则经 `pi.sendUserMessage(request)` 将请求作为**真实用户消息**转发（空闲直发；流式时 `deliverAs: "followUp"` 排队；抛错有 warning toast）；团队板增加「→ forwarding your request to the agent…」提示行；命令描述与 README 中英命令表同步说明。

**验证**：`test/run-smoke.sh` 新增 `live-args-forward` 检查（RPC 发送 `/agent-team ping-forward-check`，断言事件流出现纯参数文本的用户消息——修复前失败、修复后通过；曾因断言指向尚未落盘的会话文件而误报，改判事件流）；全量 `npm run smoke` 全绿（10 phase + 3 live 检查）。
