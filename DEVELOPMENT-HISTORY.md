# 开发历程（Development History）

> 按时间顺序罗列截至目前用户的每条 prompt、对应的开发思路决策、agent 实际所做工作与验证结果。
> 最近更新：2026-10-18（plan-51，后续工作规划与执行：M4 文档 / 项目级配置 / 探针入库 / 用户侧前置）。

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
