# 开发历程（Development History）

> 按时间顺序罗列截至目前用户的每条 prompt、对应的开发思路决策、agent 实际所做工作与验证结果。
> 最近更新：2026-10-19（plan-55，手动验证日志问题修复 + 测试流程增强 + 沙箱清理；此前为 plan-54）。

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
| 15 | 二轮全面复查 + 最小化人工验证项 | plan-25 | 新增 phase15（render 断言）/phase16（成本护栏+截断）/phase17+orphan-check（孤儿进程）/live-untrusted-config/live-clean-export；runner STANDALONE_PHASES 机制；MANUAL-TESTING 人工项 8→6 | 并行审查 subagent 因资源压力失败，改串行自查（未发现新缺陷） |
| 16 | 沙箱同步 GitHub + 配置位置确认 | plan-34 | .gitignore 粒度化（沙箱 29 个可复用文件入库，排除 agent/auth.json/运行时状态）；cfg-misc storage.dir 改可移植相对路径；新增 sandbox/README.md；确认配置位于 settings.json 的 stepcodeAgentTeam 节 | auth.json 为 OAuth 凭证（access/refresh），dry-run 核验零泄漏 |
| 17 | 沙箱引入 Step-Code submodule + 全面文档检查 | plan-38 | sandbox/step submodule 钉住 b5dbed9（上游无 tag）；step-bin.sh 解析器 + build-step.sh 可选构建；live-args-forward 分层断言（陈旧 key 不误判）；README 中英/TESTING/HANDOFF/TEST-PLAN 同步 | 用户轮换 key 后环境仍持旧 key，曾致 live-args-forward 误报，已修 |
| 18 | 罗列剩余人工测试项 + 文档收尾 | plan-42 | 答复人工测试清单（6 项不可约项：TUI 观感/真实安装/信任弹窗 UX/LLM 行为遵循度/演示剧本/性能主观）；DEVELOPMENT-HISTORY 与 HANDOFF 刷新供新 session 接手 | — |
| 19 | 测试流程文档可执行化（复制粘贴 prompt + 沙箱还原命令） | plan-54 | TUI-VERIFICATION 重写为 11 步可复制粘贴清单（预期与 render.ts 实际渲染对齐）；MANUAL-TESTING 每项补可执行步骤 + 新增 §0 沙箱还原通用节；TESTING §0 补沙箱运行时状态与清场命令 | 修正 `team_set_topology` 命名形状的 renderCall 不含边数、`step remove` 须用安装源两处文档与实现不符 |
| 20 | 修复手动验证日志发现的三个问题 + 测试流程增强 + 沙箱清理 | plan-55 | `members.max` 改计存活成员（解散释放名额）；create_member 恢复列明被忽略参数；set_topology/create_member 对无 bash 成员警告；phase18 探针先红后绿；restore-project.sh 增删 session-log；沙箱运行时状态清理对齐远端；README/PROTOCOL/ARCHITECTURE/SKILL 等同步 | phase18 探针流程一度在 cap 检查后建 scout 被旧语义拦截（修探针：先整队解散） |

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

### 15. 二轮全面复查与人工项最小化（plan-25）

**用户 prompt**：「请再次全面检查并修改，然后尽量减少需要我手动检查的内容」（执行中警告：并行子代理造成闪退，要求控制 CPU/内存）

**思路**：两路只读审查 subagent（对抗性复审我方修复 + 人工项自动化分析）因资源压力失败，改为串行定向自查；自动化按「价值/成本/抖动」排序实施。

**工作**：① PTY 复测确认 plan-22 的 `/agent-team` 修复在真实 TUI 生效（团队板 + 转发行 + 请求文本进入会话）。② 串行自查全部高危改动（信号量移交、任务锁锁序、等待环检测、kill 升级、shim TDZ、runner 判定）——未发现新缺陷。③ 新增自动化：phase15（render.ts 六工具 call/result 断言，含折叠/展开/用量行/图标）、phase16（costWarning 阈值/禁用/格式化 + truncateOutput 边界与代理对安全）、phase17 + orphan-check（成员不得比队长长寿）、live-untrusted-config（`-na` 时项目配置不得生效）、live-clean-export（git archive 导出物可加载并激活）。④ 发现并规避一个 harness 行为：纯逻辑探针传递导入 `@step-harness/pi-tui` 会触发 step 把仓库包暂存进 agentDir 并加载第二份 index.ts，与 `-e` 原始副本冲突且启动中止——runner 增加 `STANDALONE_PHASES` 机制（15/16/17 不挂载 index.ts）。⑤ `docs/MANUAL-TESTING.md` 重写：人工项从 8 项缩减为 6 项不可约项（TUI 观感、真实安装、信任弹窗 UX、LLM 行为遵循度、演示剧本、性能主观），其余全部有自动化覆盖。

**验证**：全量 `npm run smoke` 全绿（13 phase + 6 live 检查；phase5 因环境变量含 key 实际执行并通过）。

### 16. 沙箱同步 GitHub 与配置位置确认（plan-34）

**用户 prompt**：「我已经手动 bash sandbox/restore-project.sh 了。我希望 sandbox 可以被同步到 github 上供其他人测试。不管在 ~/.stepcode/agent/ 还是在 sandbox/agent/ 中，都没有看到 settings.json 文件，请确认配置信息的位置」

**配置位置答复**：插件配置位于 settings.json 的 `stepcodeAgentTeam` 节——全局 `<agentDir>/settings.json`（agentDir = `STEP_CODING_AGENT_DIR` 或 `~/.stepcode/agent`）、项目级 `<cwd>/.stepcode/settings.json`（trust 门控）。实测三处（`~/.stepcode/agent/`、`sandbox/agent/`、`sandbox/project/.stepcode/`）均不存在该文件——沙箱一直运行在内置默认值上；要配置沙箱，建 `sandbox/agent/settings.json` 即可。

**沙箱入库**：`.gitignore` 由整目录忽略改为粒度规则——保留 run.sh / probe.sh / restore-project.sh、smoke-phase4/10/11/12.ts、TEST-PLAN.md、project/、project-pristine/、cfg-*/settings.json（共 29 个文件）；排除 sandbox/agent/（11M 运行时状态）、auth.json（OAuth 凭证，含 access/refresh token）、config.toml、models-store.json、各 cfg-*/sessions|teams|live-context、project/data。cfg-misc/settings.json 的 storage.dir 由机器绝对路径改为可移植相对路径 `sandbox/cfg-misc/teams-custom`。新增 sandbox/README.md 作为他人测试入口；README 中英、HANDOFF、docs/TESTING.md 同步「沙箱随仓库分发、LLM 层探针需自带 key」。

**验证**：`git add -n` dry-run 确认暂存清单恰为 29 个可复用文件、无凭证/运行时状态；cfg-misc 改动后全量 `npm run smoke` 全绿（13 phase + 6 live 检查；phase5 用轮换后的新 key 实跑通过）。

### 17. 沙箱引入 Step-Code submodule（plan-38）

**用户 prompt**：「请修改sandbox，把step code的repository作为git module，防止每次更新都需要重新改大量内容。请同时检查所有文档」（补充确认：仓库为 https://github.com/stepfun-ai/Step-Code）

**调研**：Step-Code 为 MIT 开源 pnpm monorepo（浅克隆 27MB）；上游**无任何 tag**（产品版本号在构建时经 `STEPCODE_BUILD_VERSION` 注入），main HEAD = `b5dbed9`（2026-10-16）；已装 v0.1.5 二进制不含该 commit 特性且无可识别的 commit 内嵌；构建入口 `scripts/build-binaries.sh`（pnpm install + 全量构建 + bun 编译，产出 `packages/coding-agent/binaries/<platform>/`）。

**实现**：① `sandbox/step` submodule 钉住 `b5dbed9`，`.gitmodules` 设 `ignore = untracked`（子模块内构建产物不污染主仓库状态）。② `sandbox/step-bin.sh` 解析器：`$STEPCODE_STEP_BIN` > `sandbox/step-build/step` > PATH 中的 `step`；`run.sh` / `probe.sh` / `test/run-smoke.sh` 全部改走解析器（`bash -n` + 无裸调用双重核验）。③ `sandbox/build-step.sh` 可选构建助手（本轮未执行——构建较重），以相对符号链接把 per-platform 构建目录暴露为 `sandbox/step-build/`（gitignored）。④ 文档同步：sandbox/README 新增 submodule 专节、README 中英（沙箱节 + 项目结构 + 克隆提示）、docs/TESTING.md 解析顺序、HANDOFF 关键文件索引、sandbox/TEST-PLAN 版本钉住说明。

**顺带修复**：live-args-forward 检查在用户轮换 API key 后误报——环境中仍持有已失效的旧 key，使 key 分支进入但转发消息未落盘、`fwd_ok` 被重置清零。改为分层断言：团队板转发声明 + `send_user_message` 事件为必备证据，消息落盘为增益证据（只增不减），陈旧/缺失 key 不再造成误判。

**验证**：`bash sandbox/probe.sh` → PROBE OK；`run-smoke.sh 1 15` 全绿（含旧 key 场景）；五个脚本 `bash -n` 通过；子模块与暂存内容经 git status 核验。

### 19. 测试流程文档可执行化（plan-54）

**用户 prompt**：「请修改 docs 中的文档，把整个测试流程写得更信息，比如 TUI-VERIFICATION 中要写可直接让我复制粘帖的 prompt，以及测试修改完后恢复沙箱环境的命令」

**思路**：开发侧工作已收官（plan-42），剩余人工项的执行 friction 集中在两点——验证步骤是描述性文字而非可直接粘贴的 prompt、测试后没有成文的沙箱还原手段。本轮把 docs/ 的测试流程从「读起来合理」改为「照做即可」，且所有预期值与实现严格对齐。

**工作**：① `docs/TUI-VERIFICATION.md` 重写：环境准备复制粘贴块、11 步「每步一整行 prompt」清单（激活 → 团队板 → 建 scout1/worker1 → 派活 → ctrl+o → pipeline 拓扑 → 任务板 → status → disband → 退出孤儿检查）、收尾还原节。预期字符串逐一核对 `extensions/render.ts` 实际输出；顺带修正两处文档与实现不符——命名形状（pipeline 等）不传 `edges` 时 renderCall 只有 `team topology pipeline`（边数只在 renderResult 头 `pipeline · 1 edge(s)` 出现），旧文档写在 renderCall 上是错的；`step remove` 须用与安装相同的来源（`step remove /tmp/scat-pkg`，语法经 `sandbox/step` 的 packages.md/usage.md 核实）。② `docs/MANUAL-TESTING.md`：6 项不可约人工项全部补可执行步骤——§3 信任 UX 给了创建 `.stepcode/settings.json` 的完整命令块与还原命令；§4 LLM 遵循度给了 ring 三成员实测 prompt 与通过标准；§5 三幕演示剧本各给一整行 `/agent-team` prompt 与幕间还原；新增 §0「沙箱环境与还原」通用节（快速还原 vs 彻底清场，列出全部 gitignored 运行时状态位置）。③ `docs/TESTING.md` §0 补「沙箱运行时状态与还原」表 + 命令块，并交叉引用两份清单文档。

**验证**：`npm run smoke` 全量回归通过（13 phase + 6 live 检查，phase5 无 key SKIP——本轮纯文档改动，冒烟集为防回归的确认性运行）；文档中所有命令核验存在性（run.sh / restore-project.sh / 探针路径）；`step remove`、`/quit` 语法经 sandbox/step 文档核实。

### 20. 手动验证日志问题修复 + 测试流程增强 + 沙箱清理（plan-55）

**用户 prompt**：「我已经手动测试过tui verification，日志文件在 @sandbox/session-log-2026-10-19.md。在渲染方面没有发现问题，请检查日志排查是否有其他问题」→「请创建合理的计划后做：1.请开始修改，并删除日志文件，恢复sandbox测试环境；2.请修改测试文档，把生成日志文件命令也写进去，然后修改 restore-project.sh 使其能够恢复sandbox的时候删除日志文件；3.目前sandbox/路径中还是较乱，而且和github上的不同（比如远端就没有agent/目录），请修改相关内容。」

**思路**：日志排查出三个问题——只读预设（scout/planner/reviewer）无 bash 无法调用消息 shim 导致非星型拓扑边不可用、`team_create_member` 幂等恢复静默忽略传入参数、解散单个成员不释放 `members.max` 名额（代码核实均属实）。按项目约定先写 phase18 零 token 探针（先红）再修复；测试文档补会话日志生成 prompt 与还原命令；沙箱清理 gitignored 运行时状态对齐远端。

**工作**：① 修复（`extensions/members.ts`）：`members.max` 改计**存活**成员（dead 记录可恢复但不占名额，错误文案同步改 "live members"）；导出 `memberCanMessage` / `resumeIgnoredParams` / `messagingWarnings` 三个 helper。② 修复（`extensions/tools.ts`）：`team_create_member` 恢复分支追加「参数已忽略，需解散重建」提示，无 bash 成员追加消息通道不可用提示；`team_set_topology` 对 bash-less 边端点追加警告；两个工具描述同步。③ `test/smoke/phase18.ts`（零 token，hermetic 临时 agentDir 暂存 `members.max=2`，13 项断言：名额释放/恢复参数列明/消息能力/拓扑警告）——先红（cap 两项 + helper 未实现）后绿；runner 默认列表加 18。④ `sandbox/restore-project.sh` 增删 `session-log-*.md`（头注释与回显同步）；`.gitignore` 增补该模式；`docs/TUI-VERIFICATION.md` §3 改为「收尾：会话日志（可选）与沙箱还原」并给复制粘贴 prompt；MANUAL-TESTING §0 / TESTING §0 状态表增日志行；sandbox/README 内容表同步。⑤ 沙箱清理：删会话日志、restore 复位演示项目（种子 bug 复位 7/8 实测）、清除 gitignored 运行时状态（`sandbox/agent/` 12M、config.toml、models-store.json、各 `cfg-*/sessions|teams|live-context`；保留 auth.json 凭证）——本地 sandbox/ 结构与远端一致。⑥ 文档同步：README 中英（消息 bash 前提/护栏存活成员/配置表）、ARCHITECTURE（数据流注 + 护栏表两行）、PROTOCOL（两工具契约）、CONFIGURATION（max 注释）、TESTING（phase18 行）、SKILL（msg bash 澄清）、HANDOFF（members.ts 两处）。

**验证**：phase18 先红（cap 两项按预期失败 + helper 未实现）后绿；修复后全量 `npm run smoke` 14 phase + 6 live 检查全绿（phase5 无 key SKIP）；`restore-project.sh` `bash -n` + 实跑复位验证（种子 bug 7/8）；git status 仅剩本会话预期改动；子模块钉在 b5dbed9 干净。
