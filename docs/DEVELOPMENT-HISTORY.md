# 开发历程（Development History）

> 按时间顺序罗列截至目前用户的每条 prompt、对应的开发思路决策、agent 实际所做工作与验证结果。
> 最近更新：2026-10-19（plan-63，种子配置块补全为完整默认值清单（v0.1.4）；此前为 plan-62）。

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
| 21 | 第二轮手动验证日志处理：嵌套链超时提示 + 演示项目修复 + 实测记录 + 沙箱收尾 | plan-56 | members.ts 新增 augmentDispatchError（mid-run 失败提示接力在途+成员名册，phase18 加 6 项断言先红后绿）；演示项目 M1（CLI 干净 exit 2）/M2（load 形状校验）修复并同步 pristine；MANUAL-TESTING/PROTOCOL/TESTING/TEST-PLAN 记录 ring 实测与嵌套链超时指引；沙箱 restore+清理 | 无产品缺陷回归；演示项目其余发现按 fixture 设计有意不修（TEST-PLAN 八） |
| 22 | 文档双语化 + HANDOFF 移出仓库 + 历史迁入 docs + 全面复查 | plan-57 | 10 对中英双语文档（README + 7 docs + sandbox README/TEST-PLAN，5 个并行 subagent 翻译，术语对齐 README）；HANDOFF.md 取消跟踪 + .gitignore（本地保留）；DEVELOPMENT-HISTORY 迁入 docs/（仍仅中文）；全面检查（链接 73/73、配对 10/10、导出物无 HANDOFF、smoke 全绿）；MANUAL-TESTING 两语言新增状态总览 | 无 |
| 23 | 安装方式重构（检索 step/pi 打包安装文档） | plan-58 | 检索 packages.md/extensions.md + package-manager.ts 源码 + pi 上游（earendil-works/pi）：本地路径安装实为引用式零拷贝（README 原述「整目录拷贝」有误，git-archive 变通多余）；修复真 bug——pi manifest 缺 skills/prompts 声明，按「有 manifest 时仅加载声明资源类型」规则装包后静默不加载；README 中英/MANUAL-TESTING/TESTING-OPTIMIZATION-PLAN/HANDOFF 改引用式安装 + git/npm 分发；runner 新增 manifest-check 与 live-package-install 两个零 token 检查 | 无 |
| 24 | 发布 v0.1.0（peer 依赖安装修复 + 标签 + git 安装全链路实测） | plan-59 | 用户按 README 的 git 标签方式在另一台机器安装失败（无 v0.1.0 标签）；发布前排查出隐藏阻塞——step git 安装流 clone→checkout 后跑裸 `npm install --omit=dev`，而 peerDependencies 的三个 `@step-harness/*` 未发布至公共 registry（E404），npm 自动装 peer 会失败；修复：`peerDependenciesMeta` 四 peer 标 optional + 新增 `.npmrc`（legacy-peer-deps，与 step 自身托管安装的 `--legacy-peer-deps` 一致）；附注标签 v0.1.0（cf9be95）推送；hermetic 实测全链路通过 | 无 |
| 25 | 插件配置迁移至统一 config.toml | plan-60 | 用户另一台机器装 v0.1.0 后「找不到配置文件」——安装实际成功（packages 条目在 config.toml），但插件配置只读已退役的 `<agentDir>/settings.json`；扩展无 settings API（官方示例亦为自行读盘），`@step-harness/coding-agent` 导出 readStepConfig/CONFIG_DIR_NAME/STEP_CONFIG_FILE_NAME 且 0.1.5 实测具备；config.ts 新增统一配置层（全局 `<stepRoot>/config.toml` + 项目级 `<cwd>/.stepcode/config.toml` trust 门控，防御式查找旧版无导出则跳过）；优先级：默认 < 旧版专用文件 < settings.json < config.toml < env；phase19 探针 8 组断言先红 7 项后绿；CONFIGURATION/README/ARCHITECTURE/TESTING/HANDOFF 中英同步；全量回归 14 phase + 10 检查全绿 | 无 |
| 26 | @latest 安装 + 配置种子化 + 文档清理整合（v0.1.2） | plan-61 | 新机器装 v0.1.1 后 config.toml 无默认配置信息；① 种子化：config.ts 新增 seedGlobalConfigExample——首次激活时全局 config.toml 无 stepcodeAgentTeam 表则追加注释默认值块（保序追加不重写——step 的 updateGlobalStepConfig 会整体 stringify 丢失用户注释；全注释默认值照常生效；幂等）；phase20 探针 10 项断言先红后绿；② @latest：step 的 splitRef 将 @latest 当普通 git ref，建随发布移动的 latest 分支（`git push origin <tag>:latest`）并纳入发布流程；README 中英安装示例改 @latest 优先；③ 文档清理整合：CONFIGURATION 中英重写（删去全部 settings.json/专用文件旧版表述，位置/优先级/TOML 示例/速览表/拓扑表/种子化说明），README 中英配置节大压缩（长示例+速览表→导语+精简片段+指针），ARCHITECTURE/TESTING/MANUAL-TESTING/SKILL/sandbox README/HANDOFF 同步 | 无 |
| 27 | /agent-team 带参转发包裹修复（v0.1.3） | plan-62 | 用户报告「/agent-team <请求> 不启动团队、斜杠命令消失只剩文本」；三层复现定位：RPC 证明激活/团队板/转发全正常（live-args-forward 原只断言转发、漏激活）；PTY 驱动真实 TUI 复现（首次运行主题选择器会吃输入，需先回车越过）——激活 toast 被 TUI 帧合并且未写入终端（装饰性），团队板 toast 正常；会话文件检查：模型对转发请求【零工具调用】——根因是请求原样转发、不含「使用团队」指示，模型对简单任务独自完成（自然语言路径生效是因用户原文含「使用智能体团队功能」）；修复：extensions/forward.ts wrapTeamRequest（CJK 检测选中文/英文指令行+原请求保真），index.ts 转发前包裹；phase21 单测 6 项；live-args-forward 强化为三级硬断言（激活+团队板+包裹文本）；README 中英命令表同步 | 无 |
| 28 | 种子配置块补全为完整默认值清单（v0.1.4） | plan-63 | 用户发现首次激活种子化的注释配置块与 docs/CONFIGURATION.md 可选项不符；逐节核实为**缩略非缺失**（未列键均保持内置默认），但 keywords 示例值（2 个）远少于内置默认（15 个）、取消注释会收窄激活触发面；修复：seedBlock 改为从 defaultConfig() 生成、覆盖全部 10 节/所有键；phase20 补「全节齐全」与「keywords 完整列表」断言；v0.1.4 发布 | 无 |

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

### 21. 第二轮手动验证日志处理（plan-56）

**用户 prompt**：「我又手动做了测试，日志在 @sandbox/ 中，请阅读日志，创建合理的计划，检查并优化项目」

**思路**：日志（三任务：pipeline 修复链 / star 三方并行审查 / ring 巡回）复验了既有功能（8/8、APPROVE、两跳接力成功、reviewer-3 正确规避第三跳），暴露的唯一插件级问题是嵌套链超时 UX：队长侧 `team_send` 的 180s 等待覆盖整条接力链，链未完成而队长已超时返回（fail-fast 回收被派发成员），恢复靠 `team_status` + 直达存活成员。处理分三个层面：插件错误信息优化（纯函数 + 探针先红后绿）、演示项目按日志实证修 M1/M2（其余发现按 fixture 设计有意不修，成员视角误判项核实澄清）、文档记录实测与嵌套链超时指引。

**工作**：① 插件（`extensions/members.ts`）：新增导出 `augmentDispatchError(err, members, nested)`——mid-run 失败（settle 超时 / run 中退出 / leader 中止）且非 nested 发送方时，错误追加「嵌套接力可能仍在服务器侧运行，先查 team_status 再重派（被派发成员已 fail-fast 回收，重派会以恢复的上下文重复干活）」+ 当前成员名册，原错误保留为 `cause`；接入 `runDispatchInner` catch。② 探针（`test/smoke/phase18.ts`）：新增 6 项断言（超时获提示+名册、cause 保留、nested 保持简洁、两类 mid-run 均增强、握手类 pre-run 错误原样）——先红（函数未实现）后绿。③ 演示项目：M1 `src/cli.js` 增 `run(fn)` 包装四个 store 调用（`console.error(err.message)` + exit 2，对齐既有参数校验路径）；M2 `src/tasks.js` `load()` 出口校验形状（tasks 为数组 + nextId 为正整数），非法回退默认状态；project 与 project-pristine 同步（pristine 保留种子 bug）。④ 文档：MANUAL-TESTING §4 补 ring 实测记录（「不尝试+汇报」形态的遵循度证实）、§5 三幕标记已实测 + 嵌套链超时现象/恢复路径/`dispatch.timeoutMs` 调优指引；PROTOCOL team_send 契约补超时覆盖嵌套链说明；TESTING phase18 行补 dispatch 失败上下文；TEST-PLAN 新增第八节（演示复审：已修 M1/M2、有意不修清单、成员视角误判核实——「缺 .gitignore」实为根仓库已忽略、「secret-sample.txt 被跟踪」系有意设计的假密钥护栏、建议后续项）。⑤ 沙箱收尾：restore + 清理运行时状态（agent/、config.toml、models-store.json、data/）对齐远端。

**验证**：phase18 新断言先红后绿；修复后全量 `npm run smoke` 14 phase + 6 live 检查全绿（phase5 无 key SKIP）；演示项目修复态 `npm test` 8/8、M1 复现（`add ""`/`done 99`）干净 exit 2、M2 复现（`{}`/`{"tasks":[]}`）回退空列表、restore 后 7/8 种子失败基线不变、project 与 pristine 逐文件一致；沙箱结构与远端一致（仅多 auth.json 与子模块内容）。

### 22. 文档双语化 + HANDOFF 移出仓库 + 历史迁入 docs + 全面复查（plan-57）

**用户 prompt**：「1. 所有的文档（除了开发历史和HANDOFF），也要像README一样，分中英文；2.HANDOFF文档不要出现在github仓库中，开发历史文档放到docs/中；3.创建合理的计划再次全面检查项目，然后告诉我还有什么内容需要我手动测试」

**思路**：发布就绪性整理。结构先行（HANDOFF 移出公仓、历史迁位、中文版改名 _ZH），再并行翻译英文版，最后做一次结构变迁后的全面复查；人工测试状态随两轮手动验证结果更新为总览表。

**工作**：① 结构变更：`git rm --cached HANDOFF.md` + `.gitignore` 增补（本地保留供 session 接手，不再随仓库与 git archive 导出物发布）；`DEVELOPMENT-HISTORY.md` → `docs/DEVELOPMENT-HISTORY.md`（仍仅中文，内部历程）；9 个文档 `git mv` 为 `_ZH` 中文版。② 双语化：5 个并行 subagent 翻译 9 个英文版主文件（术语表对齐 README.md 既有译法；markdown 结构/表格/代码块/UI 字符串保留；复制粘贴 prompt 译英文——插件对英文关键词 "agent team" 同样激活；文首加「简体中文 →」切换链接）；中文版补「English →」切换头 + 内部链接改写为 _ZH 目标（含 sandbox 文档的 `../docs/` 与 README_ZH 链接表）；HANDOFF 本地件 13 处路径引用同步修正。③ 全面复查：链接审计 73/73 可解析；EN/ZH 配对 10/10；`git archive HEAD` 导出物无 HANDOFF.md、含 docs/DEVELOPMENT-HISTORY.md 与全部双语文档；phase 清单/工具名/README 链接表与代码一致；package.json files 清单无需改动；ARCHITECTURE 两语言护栏表补「派发失败上下文」行（plan-56 的 augmentDispatchError 此前未入表）；全量 `npm run smoke` 14 phase + 6 live 检查全绿。④ 人工测试状态：MANUAL-TESTING 两语言新增「状态总览」表——TUI 观感、ring LLM 遵循度、三幕演示剧本 ✅ 2026-10-19 实测通过；真实安装、信任弹窗 UX、英文译文审阅 ⬜ 待用户；性能主观项 ➖ 可选；TUI-VERIFICATION 两语言记录用户走查渲染无问题。

**验证**：链接审计 73/73、配对 10/10、导出物核验通过、全量 smoke 全绿（phase5 无 key SKIP）；提交后本地/远程 HEAD 一致；`git status` 干净（HANDOFF.md 本地保留、不被跟踪）。

### 23. 安装方式重构（plan-58）

**用户 prompt**：「我对安装插件的方式不满意，请检索step code（和step code的来源pi agent）的文档，找到打包与安装插件的合适方法」

**调研**（Step Code 官方文档 + 源码 + pi 上游三路交叉）：① `packages.md`/`extensions.md`（沙箱钉住版与装机版逐字一致）+ `packages/coding-agent/src/core/package-manager.ts`、`pi-manifest.ts` 源码；② pi 上游（earendil-works/pi，Step Code 即其改名分支——`PiManifest` 类型、`pi` manifest 键、`pi-package` 关键字一脉相承）， packaging 范式完全一致。结论：
1. 安装源三种：`npm:` / `git:`（含协议 URL）/ 本地路径。**本地路径安装是引用式的**——`install()` 对 local 源只做存在性校验，随后把路径写入 step 配置即告完成，零拷贝、不触发 npm install；相对路径相对配置文件所在目录解析，故用户级安装必须用绝对路径；移动/删除检出副本会使设置失效。**版本差异（实测）**：step 0.1.5 已启用统一配置——step 自身设置（含 packages）存于 agentDir 上级目录的 `config.toml`（TOML 格式），`agent/settings.json` 已退役不再读取；本插件自己的 `stepcodeAgentTeam` 配置节仍由扩展代码自行读取 `<agentDir>/settings.json`，两套机制互不影响（探针全绿证实）。
2. `step -e <包>` 免安装试运行（临时目录、仅当次）；`-l` 项目级安装（写 `.stepcode/settings.json`，团队共享，项目信任后启动自动装）。
3. **资源发现规则**：package.json 有 `pi` manifest 时，只加载 manifest 声明的资源类型；约定目录（extensions/skills/prompts/themes）仅在**没有** manifest 时生效。
4. `files` 白名单只对 `npm pack`/publish 生效，与本地/git 安装无关；核心包（@step-harness/*、typebox）以 peerDependencies `"*"` 声明即可（本包已合规）。

**发现的两个问题**：① README「本地路径安装整目录拷贝、会把 `local/` 与 `sandbox/` 扫入发布物」的警告与实现不符（零拷贝），据此设计的 `git archive` 变通方案纯属多余；② **真 bug**：本包 `pi` manifest 只声明 `extensions`，按规则 3，`skills/`（team-orchestration 技能）与 `prompts/`（team-review 提示模板）在按包安装后**静默不加载**——这正是「安装方式不满意」的体感来源。

**工作**：① `package.json`：`pi` manifest 补声明 `skills`/`prompts`。② README 中英 Install 节重写：开发期 `-e` 直载、`-e <包>` 免安装试运行、`install <绝对路径>` 引用式安装（绝对路径与移动失效两个注意点）、`-l` 项目级、git/npm 分发（`step install git:github.com/CTCingithub/Step-Code-Agent-Team[@ref]`；发布后 `npm:step-code-agent-team`）；删除 git-archive 变通与错误警告。③ MANUAL-TESTING 中英 §2 改引用式安装说明（预期含 skills/prompts 随包可用）、自动化覆盖块补 live-package-install；TESTING-OPTIMIZATION-PLAN 中英执行项 17、HANDOFF §5 同步。④ `test/run-smoke.sh` 新增两个零 token 检查：`manifest-check`（manifest 必须声明 extensions/skills/prompts 且路径存在，防回归）与 `live-package-install`（step 配置 `packages` 条目（统一 `config.toml`）指向仓库 → 扩展经包机制加载并激活，即 `step install <本地路径>` 的记录形态；首版误写 `agent/settings.json` 被该检查当场抓获，反证配置已迁移至 config.toml）。

**验证**：`bash -n` + manifest 手动预验 + `-e <包>` / `config.toml` 条目两种加载形态实测通过；全量 `npm run smoke`（含两个新检查）全绿；文档安装语义与 package-manager.ts / config-toml.ts 行为一致。

### 24. 发布 v0.1.0（plan-59）

**用户 prompt**：「我在另一台电脑上安装失败，请发布v0.1.0版本」+ 终端输出：`step install git:github.com/CTCingithub/Step-Code-Agent-Team@v0.1.0` → clone 成功但 `error: pathspec 'v0.1.0' did not match any file(s) known to git`。

**思路**：直接原因是仓库没有 v0.1.0 标签。但打标签前先排查「标签之后还会不会失败」——读 `package-manager.ts` 的 `installGit`：clone → `git checkout <ref>` → 若存在 package.json 则跑 `npm install --omit=dev`（git 路径**不**做 peer 特殊处理，而 step 自己的 npm 安装路径显式传 `--legacy-peer-deps` 并注释说明 host-provided 的 `@step-harness/*` 不应被安装）。实证：三个 `@step-harness/*` 包在公共 registry 全部 E404（typebox 已发布），npm 11 自动安装 peer 依赖 → 即使用户有了标签也会死在 npm install 这一步。

**工作**：① `package.json`：`peerDependenciesMeta` 将四个 peer 标 `optional`（host-provided，不自动安装、缺失不报错）。② 新增 `.npmrc`（`legacy-peer-deps=true`）——随 git clone 到达安装目录，覆盖 step git 安装流的裸 `npm install`，语义与 step 托管安装的 `--legacy-peer-deps` 一致；npm 发布时 `.npmrc` 本就不入 tarball，npm 流由 step 的显式 flag 覆盖。双修复均经干净副本实证（`npm install --omit=dev` 成功、零安装）。③ 附注标签 `v0.1.0` 指向修复提交 `cf9be95`，推送 main + 标签（远程 `refs/tags/v0.1.0` 核验）。④ hermetic 实测（隔离临时 agentDir）复现用户命令：clone → checkout v0.1.0 → `npm install --omit=dev` 成功（0 安装 0 漏洞）→ `step list` 注册成功 → RPC `/agent-team` **激活成功** → clone 内 skills/prompts/extensions 三资源齐全 → `step remove` + 删临时目录清理。

**验证**：打标签前全量 `npm run smoke` 14 phase + 8 检查全绿；干净副本 `npm install --omit=dev` 成功；git 安装全链路（用户的原始命令）实测通过；标签与 main 均已在远程且本地/远程一致；`git status` 干净。

### 25. 插件配置迁移至统一 config.toml（plan-60）

**用户 prompt**：「我在另一台电脑上再次运行了安装命令，但是没有找到配置文件」+ 终端输出：`~/.stepcode/config.toml` 含 `packages = [ "git:github.com/CTCingithub/Step-Code-Agent-Team@v0.1.0" ]`（安装实际成功），目录中只有 config.toml、无插件配置文件。

**思路**：安装本身成功（v0.1.0 的 git 安装流已修）；用户找不到的是**插件自己的配置文件**——step 0.1.5 已把设置迁移至统一 `config.toml`（`agent/settings.json` 退役，上一轮发布时已发现但仅记录了版本差异），而插件彼时只读 `<agentDir>/settings.json`。先调查再动手：① ExtensionAPI/ctx 不暴露 settings（全文件仅无关字段），扩展按官方示例自行读盘；② `@step-harness/coding-agent` 公共导出含 `readStepConfig` / `resolveStepConfigPath` / `CONFIG_DIR_NAME` / `STEP_CONFIG_FILE_NAME`——用一次性探针在 **step 0.1.5（用户所装版本）实测全部为 function**，可零成本复用（无需自写 TOML 解析）；③ `readStepConfig(path)` 读任意路径 TOML，缺失/非法会抛（需 try/catch）；④ 全局配置根 = `dirname(agentDir)`（与 settings-manager.ts 的算法一致），项目级 = `<cwd>/.stepcode/config.toml`（`ctx.isProjectTrusted()` 门控，index.ts 已有接线）。

**工作**：① `extensions/config.ts`：新增统一配置层——经 `stepCore.readStepConfig` 读 `<stepRoot>/config.toml` 与（信任时）`<cwd>/.stepcode/config.toml` 的 `stepcodeAgentTeam` 表；`readStepConfig`/`CONFIG_DIR_NAME`/`STEP_CONFIG_FILE_NAME` 均防御式查找（旧版 step 无导出则该层静默跳过）；文件缺失/非法 TOML 静默回退（非 ENOENT 错误 debug 留痕）；接入 `applyGlobalTier` 与 `applyProjectConfig`（settings.json 之后、env 之前）。优先级（每层内）：**默认 < 旧版专用文件 < settings.json 节 < config.toml 表 < env 覆盖**——统一配置覆盖旧 settings、项目级覆盖全局、env 最高。② `test/smoke/phase19.ts`（零 token，纯函数级驱动 `loadConfig`，hermetic 临时目录）：8 组断言——全局层布尔/数字/枚举+零界应用、config.toml 覆盖 settings.json、旧 settings.json 单独仍生效、项目层信任门控（信任应用/不信任忽略）、项目统一表覆盖项目 settings.json、非法 TOML 容忍、env 仍胜出、缺失 config.toml 回退默认——先红 7 项后绿；runner 默认列表加 19。③ 文档：CONFIGURATION 中英重写位置/优先级（TOML 为主示例、settings.json 为旧版回退、TOML 无 null 的省略约定）；README 中英配置节同步（含清理替换残留）；ARCHITECTURE 中英 config.ts 行、TESTING 中英 phase19 行、HANDOFF §1 同步。

**验证**：phase19 先红（7 项：未实现的新层级）后绿；修复后全量 `npm run smoke` 14 phase + 10 检查全绿（config.ts 新增 `@step-harness/coding-agent` 命名空间导入未影响 standalone 探针 15/16/17——与 tools.ts 既有的 providers 值导入先例一致）；文档安装/配置语义与 step 0.1.5 行为一致。

### 26. @latest 安装 + 配置种子化 + 文档清理整合（plan-61）

**用户 prompt**：「1.我需要安装的时候可以使用@latest来安装最新版本；2.请删除之前错误的旧版本设置相关内容，全部改为正确的；3.新电脑是安装，现在config.toml中没有默认配置信息，我希望可以改进；4.现在的配置信息过杂过长，请进行整理整合。」+ 新机器终端输出（`~/.stepcode/config.toml` 只有 theme/packages/mcp_import，无插件配置）。

**思路**：四项请求分别定性——① `splitRef` 把 `@latest` 当普通 git ref（`installGit` 会 `git checkout <ref>`），因此建一个随发布移动的 `latest` 分支即可，`step update --extensions` 也会 reconcil 它；② 「旧版设置相关内容」= 文档中 settings.json/专用文件的配置指引（代码层的旧版回退保留并继续被 phase9/19 覆盖，但用户面向文档全部改为 config.toml）；③ 种子化必须**保序追加**——`updateGlobalStepConfig` 会经 smol-toml 整体 stringify，**丢失用户注释**，故用 ensure + 原文追加，且块全为注释（默认值照常生效）；④ 整合以「删冗余、并表格、指向 CONFIGURATION」为原则。

**工作**：① `extensions/config.ts`：新增导出 `seedGlobalConfigExample(agentDirPath)`——全局 config.toml 存在且无 `stepcodeAgentTeam` 字样时追加注释默认值块（约 20 行，覆盖常用项）；缺失则经 `ensureStepConfigFile` 建文件（step 头）再追加；非 ENOENT 读取错误 debug 留痕；返回是否写入。② `extensions/index.ts`：`tryActivate` 接线（激活即种子化；探测/live 检查各有独立临时目录，无 /tmp 污染）。③ `test/smoke/phase20.ts`（零 token，纯函数级驱动）：10 项断言——既有配置追加且原内容（theme/mcp_import）保序、块全注释且解析后仍为默认、二次调用幂等（字节不变）、已有 `stepcodeAgentTeam` 表则跳过、缺失文件则创建（step 头+种子块）——先红（函数未实现）后绿；runner 默认列表加 20。④ @latest：建 `latest` 分支并在每次发布时移动（`git push origin <tag>:latest`）；README 中英安装示例改 `@latest`（推荐）+ `@vX.Y.Z`（钉住）。⑤ 文档清理整合：CONFIGURATION 中英重写（位置/优先级/完整 TOML 示例含无 null 省略约定/速览表/拓扑形状表/环境变量/说明——种子化行为入「说明」）；README 中英配置节压缩（原导语+层级表+生效段+55 行 TOML+速览表 → 一段导语+6 行精简片段+指向 CONFIGURATION 的指针）；ARCHITECTURE 中英 config.ts 行、TESTING 中英（phase20 行、phase19 行去 settings.json 表述）、MANUAL-TESTING 中英 3 处（信任 UX heredoc 改 TOML、超时调参路径改 sandbox/config.toml）、SKILL.md 配置位置、sandbox/README 中英（沙箱配置位置改 sandbox/config.toml、fixture 行注明旧版层级）、HANDOFF §1 同步。

**验证**：phase20 先红后绿；全量 `npm run smoke` 16 phase + 10 检查全绿；用户面向文档旧版设置表述清零（仅存 sandbox 探针 fixture 清单的两处有意说明）；发布后 hermetic 实测 `step install git:...@latest` 全链路 + 种子化端到端（见下）。

### 27. /agent-team 带参转发包裹修复（plan-62）

**用户 prompt**：「我的测试场景是，在一个科研工作的项目中，尝试输入prompt『请不要修或新增改工作空间中的内容，我需要你使用智能体团队功能，深入阅读本项目，然后输出一段学术性的文字介绍本项目』可以启动智能体团队。但是如果输入prompt『/agent-team 请不要修或新增改工作空间中的内容，我需要你深入阅读本项目，然后输出一段学术性的文字介绍本项目』则不会启动智能体团队，且斜杠命令在发送以后会消失，我只看得到『请不要修…』。请给我排查原因」

**思路**：用户体感「不激活」与协议层事实不符，用三层复现夹逼根因——① **RPC 复现**：`/agent-team <args>` 的激活 notify、团队板（含转发行）、agent turn 全部出现（既往 live-args-forward 只断言转发、未断言激活，故此类回归漏网）；② **PTY 驱动真实 TUI 复现**用户场景（注意：首次运行的主题选择器会吃掉输入，需先回车越过 onboarding 再发命令）：激活 toast 因 TUI 差分渲染的帧合并且**从未写入终端**（装饰性问题，团队板 toast 正常出现）；③ **会话文件检查**：模型对该转发请求【零工具调用】——**根因：命令把请求原样转发，转发文本不含任何「使用团队」的指示，模型对「读项目写介绍」这类简单任务独自完成**；自然语言路径生效是因为用户原文含「使用智能体团队功能」。

**工作**：① `extensions/forward.ts`（新增）：`wrapTeamRequest(request)`——CJK 检测选择中文/英文指令行，原请求逐字保留（`请使用智能体团队工具完成以下请求：\n<request>` / `Use the agent team tools to accomplish the following request:\n<request>`）。② `extensions/index.ts`：命令处理器转发前包裹（注释记录根因）；命令描述同步为 "forwarded to the agent as a team request"。③ `test/smoke/phase21.ts`（新增，零 token 纯函数级）：6 项断言——CJK→中文指令、ASCII→英文指令、混合文本、多行保真、结构恰为「一行指令+请求」；runner 默认列表加 21。④ `test/run-smoke.sh` live-args-forward 强化为**三级硬断言**：激活 notify（必需，修既往漏检）+ 团队板转发行（必需）+ 包裹文本入流或入会话文件（必需）；原 send_user_message/会话文件积分证据被更强断言覆盖。⑤ README 中英命令表同步。

**验证**：RPC 复现（修复后）激活 1 次、包裹指令入流 2 次；phase21 绿；全量 `npm run smoke` 17 phase + 10 检查全绿；发布 v0.1.3 并移动 latest 分支后，PTY 端到端复测用户原命令——会话文件出现 `team_create_member` ×3（scout/worker/reviewer）、`team_set_topology`、`team_send` ×2（成员均回复），模型真正组建团队并派活（修复前同一场景为零工具调用、独自作答）。

### 28. 种子配置块补全为完整默认值清单（plan-63）

**用户 prompt**：「我在之前那台电脑上的 ~/.stepcode/config.toml 中看到的是（我只做了取消注释）…这和 @docs/CONFIGURATION.md 中的可配置选项不同，请问这只是缩略了，还是说确实有功能缺失了」（附其取消注释后的种子块全文）

**思路**：疑问指向 plan-61 首次激活种子化写入的注释配置块与文档可选项的范围差异。逐节对比 `defaultConfig()` 与 `seedBlock()` 的键位，区分「设计缩略」与「功能缺失」，并检查取消注释的语义影响。

**核实结果**：种子块列 5 节 12 键（activation：enabled/keywords/notifyOnActivate；members：max/defaultRole/maxRecursionDepth；dispatch：maxConcurrent/timeoutMs；topology：default/maxLoopCount；cost：warnThreshold）；`defaultConfig()` 实为 10 节——种子块**缺 models、oneshot、idle、storage、debug 整节**及 `members.defaultTools`、`dispatch.handshakeTimeoutMs`、`dispatch.retries`、`topology.requireDeclaration` 四键。**结论：缩略（plan-61「约 20 行覆盖常用项」的设计），非功能缺失——未列出的键全部保持内置默认，配置加载器完整读取。但发现一个真实陷阱：keywords 行只列 2 个示例值，内置默认实为 15 个关键词，取消注释会把激活触发面收窄到 2 个。**

**工作**：① `extensions/config.ts`：`seedBlock()` 改为从 `defaultConfig()` 生成（值不再硬写，杜绝与默认值漂移），覆盖全部 10 节/所有键；keywords 行用完整默认列表；null 默认键（`members.defaultTools`、`storage.dir`）以示例值 + "omit for null" 注释呈现。② `test/smoke/phase20.ts`：补「全节齐全」与「keywords 完整列表」断言（先红后绿）。③ 历史同步 + 全量回归 + 发布 v0.1.4（main + 附注标签 + latest 分支）。

**验证**：键位差异经源码逐节核实（defaultConfig 10 节 vs 种子块 5 节 12 键）；keywords 内置默认 15 个经 config.ts 确认；phase20 补断言先红（缺 5 个节 + keywords 仅示例）后绿；全量 `npm run smoke` 17 phase + 10 检查全绿；种子块生成结果经肉眼核验（10 节齐全、keywords 完整列表、注释对齐）；发布 v0.1.4（main + 附注标签 + latest 分支）。

### 29. 0.2.0 大版本：/topo 命令、团队方案选单、防误触护栏、逐字转发（plan-64）

**用户 prompt**：「我希望做一次大更新到0.2.0版本……1.斜杠命令和触发关键词修改，防止和后续官方的智能体团队功能重复……2.我希望添加一个默认关闭的智能体团队设计方案选择功能，我希望有经济、快速、均衡、性能四个档位……」

**思路**：两项已确认改动分别定性——改名是防撞名（官方未来大概率推「智能体团队/agent teams」，插件须让出裸词）；选单是默认关闭的成本敏感功能（成员是完整进程，N 成员≈N 倍成本）。命名候选按冲突风险/记忆度/输入成本三维评估；档位设计受 autonomousSelection 默认关闭约束（不得以模型差异为必要条件）。

**工作**：① `extensions/index.ts`：注册 `/topo`（原 agent-team 暂留 deprecated 别名，plan-65 硬切）；handler 重写（激活→团队板→档位解析→摘要→confirm→转发）。② `extensions/plan.ts`（新增）：四档数据 + getTier/allTiers/matchTierToken。③ `extensions/config.ts`：`[stepcodeAgentTeam.plan]` 节（enabled=false、defaultTier）。④ `extensions/activation.ts`：ACTIVATION_COMMANDS 加 topo；三层防护配置项（guardEnabled/confirmBeforeActivate/headlessAutoActivate）。⑤ `extensions/forward.ts`（新增）：wrapTeamRequest（CJK 检测选指令行）。⑥ 文档 _ZH→_CN 重命名（10 文件 git mv + 41 处引用 + package.json files 数组）。⑦ 测试：phase6/20/21 与 run-smoke.sh live 检查同步。

**验证**：全量 `npm run smoke` 17 phase + manifest + 6 live 全绿；提交 8fddd56/95c9f40/9729062。

### 30. 0.2.0 修订：档位提示词化、plan.tier、别名硬切、旧词强制迁移、effort 预设、自定义角色（plan-65）

**用户 prompt**：「1. 四个选项不要写倍率信息，而且要根据用户的语言表示……2. 添加一个默认 always ask 的选项……3.命令名定为/topo；4. headless自动激活，旧关键词强制迁移，别名不要保留；5. 同意预设思考强度（不要写 thinking，改为 effort）……6. 接受退化，但要在文档中说明；7. 添加人工设置新增内置角色的功能，并更新或新建文档」

**思路**：七项意见逐项评估——倍率是预估值、写入选单像承诺（去除）；语言本地化降低选择成本；always ask 作为默认常驻项；别名硬切（live 断言同版本爆炸的成本高于用户习惯成本）；旧词强制迁移采用「生效层剥离+激活提示」而非改写用户文件（守 additive-only）；档位从固定阵容改为策略提示词（示例非绑定，模型自主决定成员/拓扑）；自定义角色参照 Claude Code/Gemini CLI 的 agents 目录惯例。

**工作**：① `extensions/plan.ts` 重写：四档 = guidance+example（双语标签，示例明示非绑定）；tierPickerOptions/matchTierToken。② `extensions/config.ts`：plan.tier（always ask/四档）；DEPRECATED_KEYWORDS（10 个旧词）+ consumeKeywordMigration（加载剥离、激活提示、不改写用户文件）；presets.effort 按角色配置。③ `extensions/presets.ts`：AgentPreset.effort 字段；agents/*.md frontmatter thinking→effort；多目录加载（内置 < agentDir/agents < 项目 .stepcode/agents，按角色名覆盖）。④ `extensions/activation.ts`：ACTIVATION_COMMANDS 只留 topo（硬切，live 检查同步改 /topo）。⑤ `docs/ROLES(_CN).md` 新建（自定义角色参考）。⑥ TEST-PLAN(_CN) 增 0.2.0 轮次（A 无 key / K 需 key / M 人工三表）。

**验证**：全量 smoke 全绿；提交 9972c91。

### 31. skill/prompt 资源代码化（plan-66）

**用户 prompt**：「我希望可以尽量使用代码或者mcp等方式来实现功能，避免skill等方式占用上下文。请再次检查，并进行优化」

**思路**：审计确认占用上下文的随包资源仅 skills/team-orchestration 与 prompts/team-review 两个。MCP 评估后不采用：成员间消息 shim 改 MCP 需每个成员进程配客户端，且 shim 本就不占队长上下文，替换无收益；改走代码路径——编排协议浓缩为激活时请求本地注入，评审剧本改为 /topo review 命令。

**工作**：① `extensions/forward.ts` 重写：teamActivationInstruction（组队协议浓缩）/ tierInstruction / teamReviewInstruction（原 team-review.md 剧本代码化）。② `extensions/index.ts`：/topo review 命令 + getArgumentCompletions。③ 删除 skills/ 与 prompts/；package.json pi manifest 只留 extensions；run-smoke.sh manifest-check 改为只校验 extensions。④ 文档同步（README/ARCHITECTURE/TESTING/MANUAL-TESTING/SKILL 移除 skill/prompt 表述，补 /topo review 与「协议经请求本地注入」说明）。

**验证**：全量 smoke 17 phase + manifest + 6 live（含新增 live-review）全绿；提交 2fb43c2/9fe20e6。

### 32. 拓扑退化修复：成员侧 topo_team_msg 工具（plan-67）

**用户 prompt**：「请给我检查之前的拓扑性能下降问题，找到原因，并尝试修改优化」

**思路**：退化根因——成员间消息唯一通道是经 shell 启动的 CLI shim，只读预设（scout/planner/reviewer）无 bash，指向它们的拓扑边全部退化为队长中转。服务端对连接来源零假设（身份仅取自 JSON 的 from 字段），故可写成员侧扩展经 node:net 直连同一 socket、说相同协议。

**工作**：① `extensions/member-messaging.ts`（新增）：注册 topo_team_msg 工具，连接 STEPCODE_TEAM_SOCK、发送与 shim 相同的 JSONL、180s 超时；env 缺失时惰性不注册。② `extensions/members.ts`：spawn 时 -e 加载（非 sub-leader 用 `--no-extensions -e` 组合——step 文档确认合法）+ team_msg 加入 allowlist 作为团队基础设施；coordination 提示词改用工具。③ 移除 memberCanMessage/messagingWarnings 及 team_create_member 的误导提示（每个成员都注入工具，边对所有角色可用）。④ 测试：phase3（工具注册/schema/socket 往返被拒路径）、phase8（spawn 参数与 allowlist）、phase18（移除失效断言）；文档双语同步。

**验证**：全量 smoke 全绿；提交 95bd487/6240161。E2E 成功派发路径留待用户手动验证（零 token 只覆盖被拒路径）。

### 33. 0.2.0 定稿轮：版本、effort 破坏性改名、沙箱卫生与测试密钥（plan-68）

**用户 prompt**：「1. 本轮修改是0.2.0大版本的，修改完以后等待我同意会放版；2. 确认参数全面改用effort，允许破坏；3.确认防护默认值；4. 允许修改文档漂移；5. 同意修改沙箱孤儿，同意沙箱demo卫生的相关修改，沙箱中新增一个不会被同步到远端的文档，用于存放测试用API key，并修改相关测试脚本；6. 同意其余两项。」

**工作**：① `package.json` 0.1.4→0.2.0（**未打 tag、未发布**，等用户同意放版）；README(_CN) 安装示例 @v0.1.2→@v0.2.0、Status 节重写为 0.2.0 功能集、CN 复验脚本改用 topo_team_msg 与 TEST-KEY 约定。② effort 全面破坏性改名：team_create_member 参数 thinking→effort、VALID_THINKING→VALID_EFFORT、ThinkingLevel→EffortLevel、autonomousThinking→autonomousEffort；registry 加载保留旧 thinking 字段回退；spawn 的 `--thinking` 宿主 flag 名不变（调用点加注说明）。③ docs/TESTING(_CN) phase 清单漂移修复（内联注释补 18-21、覆盖表补 phase21 行、phase6 行旧术语）。④ 沙箱 demo 卫生：store 数据目录注入（`new TaskStore({dataDir})`/`TASKS_DATA_DIR`，测试不再 rmSync 真实 data/——M5）；load() 区分 ENOENT 与损坏 JSON（H1 显式报错并指明文件）；title 控制字符/换行净化；套件 8→12 条（修复态 12/12、种子态 11/12 均实证）；project-pristine 同步。⑤ `sandbox/TEST-KEY.md`（gitignored）+ `sandbox/with-test-key.sh` + run-smoke.sh 密钥回退（STEP_API_KEY 未设时读取；提取逻辑经两次迭代修掉"说明文字被当 key export"的 bug——改用 `STEP_API_KEY=` 标记行）。⑥ cfg-deep 孤儿 fixture 删除（被 cfg-deep2 取代）。⑦ TEST-PLAN(_CN) 执行记录与验证计数更新。

**验证**：全量 smoke 全绿；demo 修复态 12/12 实证（临时修种子 bug 后经 restore 复位）；提交 c72d426/226c219/c3878e7。

### 34. 沙箱测试问题修复：工具自愈 + topo_team_msg 改名（plan-69）

**用户 prompt**：「1. 我已经在sandbox中未修改config.toml进行了测试，请阅读测试日志，定位问题然后修改；2. team_msg请改名为topo_team_msg」

**思路**：会话 JSONL 实证团队工具在会话中段整体变为 "tool not found"（00:54–00:55 正常、00:57:56 起失效），无 /topo off、无 reload、无会话重启，且 step 源码确认不监听扩展文件变更；日志所称「disband 导致工具集注销」经 JSONL 证实为模型追忆时的臆造（会话中无任何 disband 调用记录）。定位为宿主侧重置隐藏工具且插件无恢复路径，采自愈式修复（不依赖精确根因）。

**工作**：① `extensions/activation.ts`：新增 `ensureToolsAvailable()`——插件激活期间每次用户输入都幂等重断言工具可用（输入钩子兜底）。② `extensions/members.ts`：新增导出 `teamIdForSession()`；`extensions/index.ts` session_start 发现本会话团队注册表已存在时自动重激活（覆盖会话恢复与扩展重初始化）。③ topo_team_msg 全量改名（代码/测试/文档/TEST-PLAN；gitignored 的会话日志除外）。④ 移除 team_create_member 的误导提示与 messagingWarnings 死代码；phase18 同步；TESTING/PROTOCOL 双语契约行更新。

**验证**：全量 smoke 全绿（17 phase + manifest + 6 live + orphan-check）；RPC 探针实证三条修复路径行为符合设计（/topo off、L2 确认框、固定档摘要）；提交 50df038/601e6f8。

### 35. 文档整合：TEST-PLAN 迁入 docs/、沙箱只留 README（plan-70）

**用户 prompt**：「请给我修改更新所有文档，尤其是沙箱测试相关的」+「不要在 sandox/ 里写测试计划，sandbox/ 中的文档应该只有README。测试计划改到docs/ 路径中或修改docs/中的文档。请继续」

**工作**：① TEST-PLAN(_CN).md `git mv` 至 `docs/`（沙箱目录此后只保留 README 与脚本）；全部引用更新——sandbox README(_CN)（Contents 表改条目 + 表后指引）、TESTING(_CN)（4 处路径）、MANUAL-TESTING(_CN)（4 处路径 + 计数 8/8→12/12、7/8→11/12）、demo 项目 README（project/ 与 project-pristine/ 同步）、README(_CN) 文档表格新增 TEST-PLAN 入口。② 沙箱 README(_CN)：Quick start 改 TEST-KEY.md 密钥机制、Contents 表补 TEST-KEY.md/with-test-key.sh、演示项目条目更新 12 条基线、跑测试节补密钥回退。③ TEST-PLAN(_CN) 内容：补 2026-10-20 会话发现（工具消失 bug 与自愈修复、改名、误导提示移除）与完整手动测试流程记录。④ 全文档链接一致性验证（抽取全部相对链接逐一核验存在性）。

**验证**：链接检查全部通过；`sandbox/TEST-PLAN` 路径引用在主仓库文档清零（仅存 DEVELOPMENT-HISTORY 历史档案）；project 与 pristine 的 README 经 diff 确认同步；提交 4f37337。

### 36. 沙箱会话问题修复：leader 非消息目标 + prompt 可复制粘贴（plan-71）

**用户 prompt**：「1. 我已经在sandbox中未修改config.toml进行了测试，请阅读测试日志，定位问题然后修改；2. 请整理并优化所有文档，删除过时内容，简化表达，特别是sandbox测试相关的文档，要把所有的prompt都变为可以让我直接复制粘帖的形式」

**思路**：首轮沙箱日志（pipeline/ring）显示末站成员向 leader 回传被拓扑拒绝，且错误文案自相矛盾（一边拒绝发给 leader 的消息、一边提示"report to the leader"）。架构上 leader 不是拓扑节点、扩展 API 也没有向队长会话异步投递的通道，故修法是对齐契约而非新建通道：精确拒绝 + 成员提示词 + 文档三方一致。文档侧把沙箱测试相关 prompt 全部改成可直接复制粘贴的形式。

**工作**：① `team-server.ts`：新增 `to="leader"` 精确拒绝分支（指引把结论写入最终报告）；无出边提示与 loop 上限/死循环报错文案全部对齐。② `members.ts`：协调提示词明确"leader 不是消息目标"；`assertLoopBound` 文案对齐。③ demo README（project/pristine）ring 剧本改为"把结论写入最终报告交回队长"。④ `phase3` 增加 leader 目标拒绝探针。⑤ 文档：TUI-VERIFICATION 双语环境块具体化 + TEST-KEY.md 密钥机制（弃用废弃的 local/test-api-key.md）、MANUAL-TESTING 双语 `step install/remove` 具体路径、TESTING 双语密钥说明去占位符；弱日志 prompt 改为指向沙箱 README 的规范化 prompt。⑥ `.gitignore` 与 restore 脚本纳入会话日志清理；演示项目恢复种子态。

**验证**：全量冒烟 17 phase + manifest + 7 live + orphan-check 全绿；提交 2262e42 / 4f2f6b6。

### 37. 护栏配置化审计与沙箱测试文档整合（plan-72）

**用户 prompt**：「1. README中的护栏都是写死的数字，请检查实现的时候是否是写死的，还是按照我希望的配置文件决定；2. 现在沙箱测试的相关内容在多个文档中，如 docs/MANUAL-TESTING.md、docs/TUI-VERIFICATION_CN.md、@sandbox/README.md 等，请整理并优化」

**思路**：护栏审计结论——README 广告的 9 项护栏本就全部经 config.toml 的 `[stepcodeAgentTeam]` 表配置驱动，仅 2 项内部常量写死（999 任务板容量、50KB 单任务输出截断），按用户期望配置化。文档侧按单一职责重组：sandbox README = 入口 + 日志 prompt；TESTING = 自动化各层跑法；MANUAL-TESTING = 全部人工执行项（吸收 TUI-VERIFICATION 清单）；TEST-PLAN = 覆盖矩阵与执行记录。

**工作**：① 新增 `[stepcodeAgentTeam.tasks]` 节（`max` 默认 999 范围 1–10000、`outputCapBytes` 默认 51200 范围 1KiB–10MiB，含校验与种子块）；`nextTaskId`/`truncateOutput` 改读配置；README 双语护栏行改「默认值、每项均可配置」并链接 CONFIGURATION；CONFIGURATION 双语补 tasks 节并修复既有 ROLES 断链。② `team_set_topology` 新增 `members` 作用域参数（修复 ring 圈入全部历史成员——实测 3 成员环变 10 成员环；phase7 增加 12 个作用域探针）；清除 3 处过时 no-bash 表述（`team_create_member` 描述——JSONL 曾证实队长推理被此句误导、/topo review 指令、phase18 文件头）；`findTask` 报错补"团队任务板 ID 非会话计划 ID"提示。③ TUI-VERIFICATION 双语文档删除，11 步清单并入 MANUAL-TESTING §1（双语）；全部引用改指向；环境准备以 TESTING §0 为唯一规范副本。

**验证**：全量冒烟全绿（17 phase + manifest + 7 live + orphan-check）；TUI-VERIFICATION 引用在历史档案外清零、6 个受影响文档链接全部可达；提交 8feca72 / 11e84df / a236869 / e94cf5c。

### 38. 沙箱会话二轮修复：topo_team_msg 投递回执（plan-73）

**用户 prompt**：「1. 我已经在sandbox中未修改config.toml进行了测试，请阅读测试日志 sandbox/logs/session-log-2026-10-20.md，定位问题然后修改；2. 请在 docs/MANUAL-TESTING.md 和 docs/MANUAL-TESTING_CN.md 中，也添加 README 末尾提到的日志生成prompt」

**思路**：二轮日志（跑整合后的 MANUAL-TESTING §1 清单）显示 `topo_team_msg` 回复契约断裂：发送方收到宿主对「无 assistant 文本回合」的占位符 `No result provided`（经 `res.reply` 静默回流），环上"传递+回收"静默失效。经成员会话文件证实投递正常（接收方实际已处理消息），仅是回复文本为空被宿主占位——修法是把空/占位符回复转为明确投递回执，而非新建投递通道。

**工作**：① `member-messaging.ts`：新增 `formatTeammateReply()`——空/占位符/undefined/纯空白一律转为明确投递回执（结论写入最终报告、队长经 `team_send`/`team_task` 收集）；工具描述同步为「投递保证、回复尽力」。② `rpc-client.ts`：不再把宿主占位符捕获为 assistant 文本（队长侧空回合显示 `(no output)`）。③ `phase16` 增加 6 个契约探针。④ TEST-PLAN 双语补二轮发现（含 180s 默认超时 vs 长审查的观察、拓扑作用域参数验证通过）。⑤ MANUAL-TESTING 双语新增 §7「会话日志」，内含可复制粘贴的规范化日志生成 prompt（与沙箱 README 同源互链）。

**验证**：全量冒烟全绿（17 phase + manifest + 7 live + orphan-check）；提交 eb4665d / 98bf5b4。

### 39. v0.2.0-preview 发布与 develop 分支约定（plan-74）

**用户 prompt**：「请发布为v0.2.0-preview。然后做：1.更新HANDOFF和DEVELOPMENT HISTORY文档；2.安装时latest依旧指向v0.1.14；3.在文档中约定，后续版本开发时，会先创建develop分支，在该branch上开发」

**思路**：0.2.0 功能集早已就绪但一直未发版；以预览标签发布可让用户实测而不影响稳定安装线。`latest` 分支保持 v0.1.4（稳定线最新版；无 v0.1.14 标签），预览经 `@v0.2.0-preview` 标签安装；npm 上无此包（E404），发布走 git 渠道。同时把「新版本开发先建 develop 分支」写入开发约定与发布流程。

**工作**：① `package.json` 0.2.0 → 0.2.0-preview；README 双语安装示例改 `@v0.2.0-preview` 并注明 latest 停留稳定线。② 提交 `chore: release v0.2.0-preview`，打附注标签并推送 main + 标签；latest 分支未移动（仍 698a698 = v0.1.4）。③ hermetic 验证：临时 agentDir 中 `step install git:...@v0.2.0-preview` 安装成功且 `/topo` 激活探针 OK，验证后清理。④ HANDOFF 刷新至发布后状态；README 双语 Development 节与 HANDOFF §7 增加 develop 分支约定（新版本开发在 develop 上进行，稳定后合并 main 发版；正式版才移动 latest，preview 不动）。

**验证**：发布前全量冒烟全绿；标签安装与激活验证通过；latest 指向经 `git ls-remote` 确认未变。

### 40. npm 安装表述移除与 develop 分支启用（plan-77）

**用户 prompt**：「请检查是否已经npm发布了，然后创建develop分支，我要在该分支上继续开发」+「请删除两分支中关于npm安装的相关表述，然后切换到develop分支」

**思路**：npm 检查证实两种包名（step-code-agent-team / stepcode-agent-team）均 E404——本插件从未发布 npm，安装示例中的 npm 行是无效引导，删除；develop 分支按上轮约定的分支模型从 main 切出，改动同步两分支。

**工作**：① README 双语删除 `step install npm:step-code-agent-team` 行，引言句 "From git or npm" / "从 git 或 npm 安装" 改为 "From git" / "从 git 安装"（`npm run smoke` 等无关提及保留）。② `git checkout main && git checkout -b develop` 创建开发分支（上轮 SSH 网络故障已恢复），提交 3f9b607 推送 develop；main 以 `--ff-only` 快进至同一提交并推送——两分支同值；latest 保持 v0.1.4 未动。③ 切回 develop 作为当前开发分支。

**验证**：grep 确认 npm 安装表述在主仓库文档清零（仅存 sandbox/step 上游 submodule）；两分支 `git branch -vv` 同值且均与各自远程同步。

### 41. 测试流程全面优化（plan-79）

**用户 prompt**：「请给我全面优化测试流程，并更新相关文档」（团队协议激活，按组队判据派 scout 审计 + 后续 implement/review 分工）

**思路**：先审计后动手——派只读 scout（high effort）系统审计全部测试文档与脚本，产出分级缺口清单（摩擦点/文档不一致/承诺vs现实/证据丢失/覆盖缺口/分级提案）；再按"runbook 总纲 + 明细清单"重组文档、把证据保全脚本化、补齐最后一块探针缺口。审计与实施均验证了上轮修复的机制：scout 派发撞 180s 超时后经 resume 正常回收报告（best-effort 回复语义下的标准恢复模式）。

**工作**：① **审计**（scout）：定位 7 项摩擦（头号：`sandbox/run.sh` 不读 TEST-KEY.md——文档承诺自动读取但交互沙箱实际无 key）、8 处文档不一致、4 项承诺vs现实、证据丢失点（restore 删 `logs/`——正是 §7 日志产物）、5 项特性探针覆盖核查（4 项已覆盖，tasks 配置校验为唯一缺口）、10 条分级提案。② **新增 `sandbox/archive-round.sh`**：还原前把本轮证据（sessions JSONL、teams 注册表、logs/、project diff/status）归档到 gitignored 的 `sandbox/archive/<时间戳>-<标签>/`；.gitignore 同步。③ **`sandbox/run.sh` 修复头号摩擦**：环境未提供 STEP_API_KEY 时按 with-test-key.sh 同一提取逻辑读取 TEST-KEY.md 并导出。④ **restore-project.sh 死亡引用修复**（指向已合并删除的 TUI-VERIFICATION.md → MANUAL-TESTING.md §7）。⑤ **MANUAL-TESTING 双语新增「单轮测试 runbook」**（第 0 步预检：归档上轮→还原→密钥；第 1 步自动化门；第 2 步 6 个有序交互场景表格，每场景含可复制粘贴 prompt、明细指向与已知坑——topo 回复尽力语义需队长收集、每跳小工作量以 fit 180s 默认超时、选单需启动前改配置+重启会话；第 3 步收尾五步），文件头同步指向，形成 runbook+明细结构。⑥ **探针补齐**：phase9 增加 tasks 配置面断言（有效合并 + 无效回退），phase16 增加 nextTaskId 容量契约（首空闲/跳过已用/满板抛错）与 truncateOutput 显式 cap 行为；`bash test/run-smoke.sh 9 16` 全绿。⑦ **文档修正 10 处**：phase15 死亡引用、EN §5 陈旧 8/8→12/12、TESTING 双语 Layer D 配置化表述、TEST-PLAN 双语日志路径与 0.2.0 轮执行记录计数（校正为 17 phase + 7 live）、Known limitations standalone 清单 15/16、§0 还原表补 trust.json 行（快速还原不重置信任）、sandbox README 双语日志节补归档提示。

**验证**：目标 phase 冒烟全绿；全量冒烟、链接与双语一致性、reviewer 审查并入下一验证轮统一执行。

### 42. 优化计划实施：P0/timeout/文档/行为/测试加固五批（plan-80）

**用户 prompt**：「请开始修改」（承接上一轮审计产出分级提案，团队协议激活）

**思路**：审计提案按影响×工作量分五批实施——P0 正确性批（6 项低风险小改动）→ timeout 批（T1-T4）→ 文档批 → 行为变更批（P1-1/5/7/8 + T5）→ 测试加固批（P2-6/7/8d）。每批独立全量冒烟后提交 develop；P0 批完成后加派双视角对抗审查（契约视角发现并修复 9 项，含一个批内引入的 blocker）。

**工作**：① **P0 批**（commit 1c85ca1）：members.ts kill 路径删序倒置+实例身份守卫（dispatch catch/reaper/killMember 三处——此前 delete 先于 await killAndWait，窗口内 ensureLive 以同一确定性 session-id 生成第二进程，双进程共写会话文件）；doSpawn onClose 按实例身份驱逐（输家竞争 spawn 的退出不再误删赢家条目/误标 dead）；activation.ts 否定护栏窗口从固定 6 字符改为回扫至子句边界或 40 字符（README 自己的例句 "don't use an agent squad" 此前实测会激活）；config.ts 全旧词 keywords 置空禁用激活（不再静默回退 14 个默认词扩大激活面）+ 迁移报告改走 session_start（受影响用户永远无法触发激活，原 tryActivate 内报告不可达）；member-messaging.ts finish() destroy→end（flush 待写字节）+ write 错误回调 + "team server asserts delivery" 措辞；README 双语安装注释去 skill+prompt。探针：phase1 零断言→10 条生命周期断言（兼作 P0-1/P0-2 回归）、phase6 远程否定回归、phase9 迁移语义。对抗审查修复 9 项（B1 通知路径、M1 陈旧文件头、m1/m2 探针保真、M2/M3 phase6 全旧词端到端+报告去重、M4/m5/m6 文档）。② **timeout 批**（1770ab6）：dispatch/oneshot 默认 180s→600s（覆盖含嵌套中继的整回合）；spawn 注入 STEPCODE_TEAM_REPLY_TIMEOUT_MS 使成员侧回复等待与派发超时联动（此前写死 180s，调高配置后嵌套中继仍先失败）；重试只重试证明工作未启动的错误（超时/回合中退出直接断链——此前 respawn 后重发同一 prompt 死循环，沙箱 r3 连续 4 次超时根因）；超时任务携带收割指引；超时分类 infra→"投递状态未知"+禁止重发指引。③ **文档批**（b3983e0）：T6 超时语义族（README/CONFIGURATION/MANUAL-TESTING 双语）；P2-1 members scoping 参数入 PROTOCOL/README（此前零文档）；P2-2 ARCHITECTURE 死引用；P2-3 autonomousThinking 幻影键 5 处→autonomousEffort；P2-4 打包说明；P2-5 TESTING gitignored 表述；P1-2 README_CN 成本陈述；m5 状态表刷新。④ **行为变更批**（003f134）：P1-1 安全修复——项目级预设（<cwd>/.stepcode/agents）此前无信任门控即可加载，不可信仓库仅靠打开项目即可植入/覆盖角色（systemPrompt+工具白名单注入成员进程）；现 presets 三层函数加 trusted 参数+缓存键含信任位，经 forSession 透传，phase3 三段断言。P1-5 {ok:true} 缺 reply 判协议漂移 isError；P1-7 oneshot 纳入 per-member 队列（消除 status 误置 idle 与 usage 丢失导致成本护栏少报）；P1-8 reaper 先置死+删条目再 kill（杀进程窗口内落地派发不再附到将死进程）+ ensureLive dead 守卫；T5 进度信号文档化（interim 流已在 onProgress/onUpdate 接通）。⑤ **测试加固批**（c57bd87）：PHASES 清单磁盘派生+opt-out（新探针不再静默漏跑）；runner 捕获 rc，240s 杀死明确报挂起（此前与断言失败的 (fails=0) 混同）；新增 phase22 自愈探针（ensureToolsAvailable 重置恢复/失活 no-op/session_start 重激活判据——该机制此前零回归保护）；orphan 检查轮询 15s+缺失 pid 显式 SKIPPED。按上下文预算 deferred 并记录：P2-8a/b/c/e 与 P2-9 杂项。

**验证**：每批全量冒烟（17→18 phase + manifest + 7 live + orphan-check）全绿；P0 批经双视角对抗审查；phase3/6/9/22 专项验证通过。

### 43. README 斜杠命令清单与档位确认框修复（plan-81）

**用户 prompt**：「1.请在README中，罗列斜杠命令的选项与功能；2.目前在斜杠命令选择档位后，询问yes或no时，提供的并不是模型打算实施的智能体协作方案，而是示例，请修改」

**思路**：两项独立修改——README 补命令参考表（此前 /topo 的各形式散落在 Activation/Tools 节，无统一清单）；确认框修复源于档位 example 的语义错位——example 在数据中明确标注"仅供参考，非固定方案"，却与待确认方案并列展示，用户确认的是一套模型从未受其约束的阵容，实际执行只遵循 guidance。

**工作**：① README.md/README_CN.md Activation 节新增 "The /topo command"/「/topo 命令」参考表，罗列 6 种形式（/topo 激活+团队板、/topo <请求> 逐字转发、/topo off、/topo <档位> 直通 economic/fast/balanced/performance、/topo custom 自定义流程、/topo review [目标] 并行评审）+ headless/RPC 回退行为（balanced 直应用+隐式确认）与档位名参数补全说明。② extensions/index.ts confirmChoice 档位分支移除 example 行——确认框只展示档位标签、guidance（模型将实际遵循的策略）与"具体成员、角色、拓扑与 effort 由模型按任务实际需要决定"注脚；example 仅保留在选单（tierPickerOptions）中供选择时参考，并加注释说明原因防止回退；顺带清理冗余三元表达式。自定义分支不受影响（展示用户需求原文）。

**验证**：全量冒烟全绿（18 phase + manifest + 7 live + orphan-check）；双语表格行数与结构核验；提交 84bf584。

### 44. 第三轮测试验证：流程核查 + 全量自动化门 + LLM 探针 4/4（plan-82）

**用户 prompt**：「请检查测试流程无误后，开始测试功能，完成后告诉我哪些功能需要我手动测试」

**思路**：按 MANUAL-TESTING runbook 走完整一轮——先核查测试流程自洽性（脚本与文档互证），再执行自动化门（零 token 冒烟 + LLM 层功能探针），收尾归档还原，最后汇总仍需人工的项。LLM 探针首跑即暴露流程缺陷，修复后重跑通过。

**工作**：① **流程核查发现 4 处问题**：(a) **TESTING(_CN).md 的 LLM 探针调用缺 `STEP_CODING_AGENT_DIR` 隔离**——真 bug，实测 phase4/10 全部"无探针日志行"：step 回退到 `~/.stepcode/agent`，其 packages 项已安装本插件（git 克隆副本），与 `-e extensions/index.ts` 显式加载形成 6 个工具名冲突、扩展整体加载失败、探针从未运行；双语文档补隔离导出（指向 sandbox/agent）后重跑全部通过。(b) MANUAL-TESTING(_CN).md runbook 计数陈旧 17→18 phase（phase22 加入后未同步）。(c) run-smoke.sh 重复注释行（test-hardening 批残留）。(d) 确认 cfg-deep2 fixture 的旧式 settings.json 仍按 legacy 配置层读取（config.ts 优先级链 defaults < legacy files < settings.json < config.toml < env），无需改造。② **自动化门全绿**：`npm run smoke` 18 phase（含 phase22 自愈）+ manifest + 7 live + orphan-check。③ **LLM 探针 4/4 全过**：phase4（成员回复 PONG/上下文记忆 4242/respawn 后恢复 4242/shim 消息 BETA-OK）、phase10（并行 4/4 回复、并发实测 max 4 ≤ 5）、phase11（默认配置干净 SKIP——探针检测 ambient maxRecursionDepth=1 后按设计跳过；用 sandbox/cfg-deep2 补跑：depth-2 链 LEAF-OK 回传、子团队先于派发自举、leaf 以 --no-extensions 启动的边界断言全 PASS）、phase12（oneshot+用量记录/任务链 T1→T2/Unicode 往返/SIGKILL 后重生/流式中 interim 更新）。④ **轮次收尾按 runbook**：证据归档 `sandbox/archive/20261022-222529-round3-2026-10-20/`（1.7M）、种子态还原、TEST-PLAN 双语执行记录补 A1/K8/F1 行。

**验证**：冒烟与四探针全绿（见上）；探针调用修复经"首跑失败→定位冲突→补隔离→重跑通过"闭环；提交 858d0f5 推送 develop。

**遗留人工项**（已向用户交付清单）：K1–K7 沙箱交互场景（K8 探针已由本轮覆盖）、M1–M6 纯手动项（真实安装/信任弹窗/TUI 选单与确认框——含档位确认框修复目验/渲染观感/译文/8 成员性能）、建议重跑 ring 剧本 Act 3（600s 超时族与无盲目重试改动直接作用于嵌套中继，2026-10-19 验证基于旧 180s 行为）。

### 45. 四项请求轮：档位确认框结构化方案、沙箱日志分析加固、发版审查、安装故障定位（plan-83）

**用户 prompt**：「1.目前在斜杠命令选择档位后，询问yes或no时，提供的还是类似提示词一样的文本，而不是模型给出的团队协作方案，请修改；2.请检查目前的发版方式是否合理，若不合理请给我修改建议；3.我刚刚做了沙箱测试，测试日志是 sandbox/logs/session-log-2026-10-22.md，请分析日志并优化项目；4.我在本机上 step install ~/GitProjects/Step-Code-Agent-Team 后，无法启动 step code，请定位原因」

**思路**：四项独立请求并行推进——环境故障（4）优先诊断；确认框（1）从数据层改造；日志（3）先分析后优化；发版（2）纯审查出建议不改码。指定的日志文件已被此前一次未归档的还原删除（本 session 的操作失误），证据改从会话 JSONL 完整重建，分析照常完成。

**工作**：① **档位确认框结构化方案**（`67efd02`）：plan.ts 的 TeamTier 增结构化 plan 字段（members/topology/effort 三行、双语、四档位齐全）+ tierPlanLines() 辅助函数；index.ts confirmChoice 把 guidance 散文行替换为结构化方案行；phase21 补 4 条断言（期间发现并修复探针 bug：裸 `performance` 标识符解析到 Node 全局对象，改用 getTier("performance")）。此版随后被用户第三轮反馈否决，演进终态见 entry 46。② **安装故障定位**（item 4，根因经隔离复现坐实）：用户 config.toml 原有 `git:github.com/...@v0.2.0-preview` 包项，`step install <本地路径>` 把本地路径**追加**进 packages 形成双副本——两个 index.ts 的六个团队工具名全部冲突（"Tool X conflicts with…"），扩展加载失败、step code 无法启动；单独任一副本启动均 0 冲突。用户配置现已只剩 git 一项（复测启动正常）；修复 = 两种安装方式只能留其一（`step remove` 摘除另一项）。该冲突由 step 扩展加载器判定，插件侧无法自去重，纳入 README 排障建议。③ **沙箱日志分析与优化**（`0c4f130`）：用户 2026-10-22 手动轮结论——§1 走查 + 三幕剧本全过；Act 1 前提已被早前请求修绿（基线 12/12），队长以 clarify_user + 只读复核任务妥善应对；Act 3 环形巡回 a→b→c 两跳成功、第 3 跳被拒并原文引用（"would reach 3 hops, over the ring loop limit (2)"），约 12 分钟链条在 600s 超时族下零超时零收割；team_set_topology 的 members 作用域正确使用；全会话仅 1 处 isError:true（即该预期拒绝）。四项优化：**restore-project.sh 删除日志前自动归档**到 sandbox/archive/<时间戳>-auto-before-restore/（根治"未归档的还原毁掉整轮证据"类事故，已功能验证）；激活指令补"用户未要求改动时保持只读，不要顺手修改文件"（双语——针对 22:47 未经要求修掉种子 bug 导致后续 Act 1 前提失效）；MANUAL-TESTING(_CN) Act 1 基线坑位提示（双语）；TEST-PLAN(_CN) U1/F2 执行记录。④ **发版方式审查**（item 2，纯建议待用户确认）：总体合理（develop/main 分离、latest 仅随正式版移动、annotated tag、发布后 hermetic 实测、约定成文）；三个实际问题——main 落后 develop 12 个提交（含 P1-1 预设信任门控安全修复）发布节奏断裂且 README"推荐安装"给新用户的是 v0.1.4 旧版、安装双副本冲突无排障文档、发版流程 8 步全手工易错。分级建议：P0（合并 develop→main 切 v0.2.0 正式版并移动 latest；README 补双副本冲突排障段）/ P1（scripts/release.sh 脚本化发版流程；npm 发布与否做明确决策并成文）/ P2（验证 step remove 对本地路径项的摘除；preview 不动 latest 约定延续）。

**验证**：各代码项全量冒烟全绿；安装根因经隔离复现坐实；restore 自动归档经"造固件→还原→归档+删除确认→清理"功能验证。

### 46. 档位确认框第三轮改造：展示模型生成的实际方案（plan-84）

**用户 prompt**：「目前档位确认框出现的还是预设方案，但我希望能看到的是实际方案」（对 `67efd02` 结构化档位方案的反馈——该确认框的第三轮演进：非绑定 example → 策略散文 → 档位预设形态 → 模型实际方案）

**思路**：前两轮内容均被否，核心诉求明确——yes/no 对话框必须展示模型针对**本次请求**真正会执行的实际方案，而非任何档位级预设。调研确认 ExtensionContext 持有 `model`（当前模型）与 `modelRegistry`，`ModelRegistry.complete(model, { systemPrompt, messages })` 支持一次性生成（密钥由 registry 解析）——"确认前让模型先出方案"路径成立。

**工作**（`72e93ef`）：① forward.ts 新增 `teamPlanPrompt()`（一次性规划提示：成员名单与各自 effort、通信拓扑及理由、任务拆解与 blockedBy 依赖，≤10 行，只出方案不执行）与 `approvedPlanInstruction()`（批准方案的优先级注入）；② index.ts 新增 `generateTeamPlan()`——经 `ctx.modelRegistry.complete` 做一次性规划调用（90s 超时竞速 + clearTimeout 清理；无模型/出错/超时/空文本一律返回 null）；confirmChoice 增加 planText 参数（有实际方案时展示"模型为本次请求生成的实际方案：+方案全文"，否则回退档位标准形态）；runTeamCommand 接线：tier + 有请求 + 交互式时先 notify"正在生成本次请求的实际团队方案…"再生成 → 确认框展示之 → 批准则 pendingInjection = tierInstruction + approvedPlanInstruction（已确认方案优先级高于一般性策略描述）；③ phase21 补 4 条断言覆盖两个新构建器（再次避开 performance 全局对象坑）；④ MANUAL-TESTING(_CN) runbook 新增确认框内容说明段，TEST-PLAN(_CN) K2 行同步更新。**回退路径**：裸 /topo（无请求可规划）/ 无模型 / 规划调用失败 / headless（无对话框）均回退档位标准形态并注明"没有可展示的请求相关内容"；custom 与 review 分支不受影响。

**验证**：全量冒烟全绿（18 phase + manifest + 7 live + orphan-check）；`bash test/run-smoke.sh 21` 单独通过；提交 72e93ef 推送 develop。

### 47. v0.2.0 正式版发布：合并、脚本化发版、latest 修复（plan-85）

**用户 prompt**：「我同意你做第1条的全部内容」（批准发版审查建议：P0-a 合并 develop→main 切 v0.2.0 正式版并移动 `latest`；P0-b README 补双副本冲突排障段；P1-c `scripts/release.sh` 脚本化；P1-d npm 分发决策成文）

**思路**：按批准清单顺序执行——先文档前置（排障段 + npm 决策，随 develop 合并进 main），再脚本化发版流程并以本次发布 dogfood，最后执行发布（合并 → bump → tag → push → latest → hermetic 实测）。README 安装示例同步选择在合并前提交于 develop，使 main = develop + 发布提交，避免 main 多出 develop 没有的文档提交造成长期分叉。

**工作**（提交链 `19a6570` → `74752cc` → `b862bdc` → `e1c22ac`/`06bc06c` → `f8b9a9e`）：① **P0-b/P1-d**（`19a6570`，develop）：README(_CN) 安装节新增"Tool … conflicts with …"启动失败排障段（本地路径 install 与 git 包并存→两份 index.ts→6 工具名冲突→扩展加载失败；修复=只保留一项，`step remove` 摘除另一项）与"Distribution: git only"分发决策段（不发布 npm；`latest` 只跟随正式版，预览绝不移动）。② **P1-c**（`74752cc`，develop）：新增 `scripts/release.sh <version> [--preview]`——前置检查（树干净/在 main/版本号格式/tag 本地与远程均未占用/step 在 PATH）→ 全量冒烟门 → bump → `chore: release vX.Y.Z` 提交 → 附注 tag → push main+tag → 正式版移动 latest → hermetic 实测（临时 agentDir 安装该 tag 探测激活）；develop→main 合并保留为人工步；README(_CN) Development 节补发布流程指向。③ **P0-a**（`b862bdc`/`e1c22ac`）：README(_CN) 安装示例同步 v0.2.0（稳定线 v0.1.4→v0.2.0、预览行移除）提交于 develop；main 以 `--no-ff` 合并 develop（`e1c22ac` 合并边界提交，41 个文件）。④ **发布执行**：`release.sh 0.2.0`——冒烟门全绿 → bump 0.2.0-preview→0.2.0 → `06bc06c`"chore: release v0.2.0" → 附注 tag `v0.2.0`（36a9dc8）→ push main+tag 成功（3f9b607..06bc06c）。**latest 首推被远程拒绝**——根因：分支 ref 不能指向附注 tag 对象（脚本推的是 `v0.2.0:latest`）；改用剥离后 commit（`v0.2.0^{}:latest`）推送成功（698a698..06bc06c）。⑤ **hermetic 实测**（脚本止步于 latest 后手动补跑）：临时 agentDir 安装 `git:github.com/CTCingithub/Step-Code-Agent-Team@v0.2.0` 并探测激活——"HERMETIC VERIFY: OK — activated from the v0.2.0 tag"。⑥ **脚本 bug 修复**（dogfood 的直接收获）：latest 推送改用 `v$VERSION^{}:latest` 并注释原因——develop `3fa45b8` + cherry-pick 至 main `f8b9a9e`，双分支均已推送。

**最终状态**：`origin/main` = `f8b9a9e`（发布提交 + 脚本修复）；`origin/latest` = `06bc06c`（v0.2.0 发布提交）；`origin/develop` = `3fa45b8`；tag `v0.2.0` = 36a9dc8；工作树干净。第 1 条四项内容全部交付。

### 48. 改进计划 P1 执行：分支切换与官方接口对齐三项（plan-86）

**用户 prompt**：「请切换到develop分支，按照改进计划开始优化项目，并进行测试」（承接官方接口替代性审计的改进计划）

**思路**：按审计计划的 P1 三项执行——P1-1/P1-2 工具描述边界声明（防模型混用团队系统与官方内置系统）、P1-3 config.ts 官方符号消费类型化；P2/P3 维持（P2 卡上游导出面、P3 明确不做）。分支按约定从 main 切新 develop。

**工作**：① **分支**：本地旧 develop（3fa45b8，唯一提交已 cherry-pick 在 main）删除，从 main（cdbe5c2，发布后状态）切新 develop；远程旧 develop 替换（零损失）。② **周期基线**：`.gitignore` 修复（`sandbox/step-build/`→`sandbox/step-build`，构建产物实为符号链接、尾斜杠模式漏匹配）；submodule bump `b5dbed9`→`81e79bc`（35 个上游提交；附重建+新二进制冒烟全绿+4 个 LLM 探针+11 面冲突审计的验证记录）。③ **P1-1/P1-2**（tools.ts）：team_task 描述新增 Scope 行（团队共享板 vs 官方 `task_*` 个人 checklist，两系统独立不同步）；team_create_member 描述新增边界行——**执行中修正审计误判**：官方 subagent 的 agent 发现目录与我方 preset 目录实际重合（user 层同 `<agentDir>/agents`、项目层同 `<project>/.stepcode/agents`、同 frontmatter 形状），表述改为"同一文件可同时支撑 team 角色与 subagent agent，但两系统独立解析、状态不共享"。④ **P1-3**（config.ts）：4 处 `stepCore as Record<string, unknown>` 防御性 cast → `StepCoreConfigExports` 接口（4 个可选符号）+ 单次 Partial 断言；运行时守卫与回退保留（旧版 step 缺导出仍工作），我方拼写错误今后可被编译期捕获——submodule 本地 tsc 5.9.3（strict、映射真实 dist/index.d.ts）零错误。

**验证**：全量冒烟门全绿（18 phase + manifest + 7 live + orphan-check）；tsc 对 config.ts 全导入图零错误。提交 b17c98e/92c7ab2/86ee984/81de343，推送 develop。

### 49. UI 动画/配置审计/文档更新/综合检查四项轮（plan-87）

**用户 prompt**：「1.请把'正在生成本次请求的实际团队方案'界面，改为根据用户发送 prompt 的语言的'正在生成智能体拓扑协作方案'，并尝试添加 UI 动画（尽量用 Step Code 现成的）；2.请检查现有的配置选项，是否有和官方重合，或者多余/错误/过时的内容；3.请更新优化所有文档；4.请检查并优化其他内容」

**工作**：① **item 1（index.ts）**：方案生成等待期 UI 改造——notify 文案改为按 detectLang 的"正在生成智能体拓扑协作方案…"/"Generating the agent topology collaboration plan…"；新增 `startPlanProgress`——经 `ctx.ui.setWidget`（字符串数组形式）实现 braille 帧循环动画（120ms），**刻意不 import pi-tui**（会触发扩展双加载工具名冲突，见 run-smoke.sh 的 STANDALONE_PHASES 注记）；守卫按官方文档用 `mode === "tui"`（widget 属终端专用 UI，rpc/json/print 降级为单条 notify，无 widget 槽同样降级）；调用点 try/finally 确保动画必被清除。② **item 2（配置审计，只读）**：30+ 选项逐项消费核查——全部有真实读取点，无死选项/无多余项；与官方无名称冲突（节命名空间隔离），概念邻居（官方 MAX_RUNNING_LANES=8、LANE_IDLE_TTL_MS=10min 硬编码）分属不同子系统；无错误项（区间校验一致）；发现 4 处文档漂移移交 item 3。③ **item 3（文档，15 处双语）**：CONFIGURATION(_CN)——timeoutMs 注释补"覆盖成员整个回合含嵌套中继"、retries 改"仅对尚未启动的派发重试"（timeout 批漂移）、plan 行补实际方案确认流（plan-112 漂移）、Notes 增"管辖范围"边界声明；README(_CN) 方案节补实际方案流、CN 特性行同步；MANUAL-TESTING(_CN) 确认框注补进度动画；TEST-PLAN(_CN) 还原段补当前 11/12 基线。④ **item 4（类型硬化，9 处真实缺陷跨 6 文件）**：index.ts——`type Lang` 改从 plan.ts 导入（原导入 forward.ts 未导出符号）、context handler 按官方 ContextEvent/ContextEventResult 重写+structuredClone（联合类型恒等）、sessionFile 两处随签名放宽消解；members.ts/rpc-client.ts——usage 局部结构类型修正（cost 实为 `{total}` 对象而非 number）；rpc-client.ts——timer 定值分析；team-server.ts——闭包丢失 narrowing 处边界重断言；tools.ts——edges 映射隐式 any 显式化；render.ts——本地 Theme 结构替身改用官方 `@step-harness/coding-agent` 的 Theme（12 个渲染签名不匹配消解）、renderTeamCall 形参放宽 `object`+局部窄化（空 schema 的 `{}` 满足逆变）。tsc 全图错误 19→2，剩余 2 个均为环境伪影：context 重载的 **submodule dist 构建偏移**（源码有重载、dist 无，运行时用宿主实际 API 一直正常）；`Type.Optional` 双参的 **typebox@1.3.7 映射伪影**。

**关键实证（负载匹配对照实验）**：本轮曾将 `Type.Optional` 改为单参内嵌 description 的"对齐"写法，随后满载冒烟 3 连败（phase9×2、phase18，均为"member handshake timeout"）；经 stash 基线、单项回退、**同负载复跑**（1.52 vs 失败时 1.48）三重对照，确认该写法与握手超时相关（机制未明——成员进程不加载 tools.ts，疑为宿主 typebox  schema 生成路径的隐性差异），**已回退为主机验证过的双参形式**；tsc 对该写法报的 TS2554 系映射到旧版 typebox 的伪影。教训：类型"对齐"不能脱离宿主实证，冒烟门（含满载时序）是唯一裁判。

**遗留**：P1-4（activation.ts META_RE 对普通"如何/怎么"请求的过度抑制）仍为唯一已知遗留项——需 clause 锚定匹配+phase6 回归用例，属行为变更，建议专轮处理。

**验证**：全量冒烟门全绿（18 phase + manifest + 7 live + orphan-check，回退终态）；双语文档 15 处更新经行数/锚点断言落盘。


**验证**：发布前 develop 冒烟门全绿；release.sh 内冒烟门全绿（18 phase + manifest + 7 live + orphan-check）；hermetic 安装激活实测通过；远程 refs（main/latest/develop/v0.2.0）逐一核验指向正确。

### 50. 遗留问题修复与测试流程更新（plan-88）

**用户 prompt**：「1.请不要管可疑进程问题，解决前4项代码遗留问题；2.请检查测试流程是否需要修改更新；3.请检查更新优化文档」（性能档团队方案：Fixer-A/B 竞速修代码、TestLead 查测试流程、DocLead 更文档、Chief 终审；实际由队长直接实施+explore 子代理审计）

**思路**：T1 四项代码遗留逐项修复并配回归；T2 派只读 explore 子代理系统审计测试流程（16 项发现），按严重度实施低风险项；T3 文档收尾。

**工作**：① **P1-4 修复**（activation.ts）：元问题守卫从"关键词前 12 字符窗口命中即抑"改为**句子锚定**——定义问句（什么是/是什么/what is）与文档引用（文档/readme/提到，含"关键词+的+文档"链接形态）恒判元问题；how-to 问句仅在剔除 how-to 词与填充词后无请求主体时判元问题。"如何用智能体小队修复测试"类普通用法请求自此正常激活（此前必被误抑、headless 静默单干）；"how to use the topo team" 纯用法问句仍抑。phase6 新增 8 条回归用例；中途修复 filler 正则含 \s 致英文停用词黏连（"use the"→"usethe" 越过 \b 边界）的缺陷。② **Optional 写法警示**（tools.ts）：双参 Type.Optional 处加注释——单参内嵌写法经负载匹配对照实验（3 败 vs 2 胜）证实与成员握手超时相关，防未来"清理"改回。③ **runner 抖动硬化**（test/run-smoke.sh）：per-phase run+verdict 提取为 run_phase_attempt 函数，失败后以新 session id 有界重试一次——单个负载抖动（成员握手 grazing 15s 预算）不再 fail 整个套件与 release 门。④ **tsc 伪影处置**（index.ts）：context hook 经官方 ContextEvent 类型化窄 cast 注册（消除 submodule dist 构建偏移导致的重载缺失）；synthetic 消息内联进返回字面量获得上下文类型。tsc 全图错误 19→1（剩余 1 个为 typebox@1.3.7 映射伪影）。⑤ **T2 测试流程更新**（explore 审计 16 项发现）：HIGH#1 runner 重试由③实现；HIGH#2 createMember spawn 路径与 startTask 的重试策略不一致——产品侧变更，列为建议待专轮。MEDIUM——phase 清单 17→18 并补 phase22 行（TESTING/README/TEST-PLAN 双语 6 处）；Layer C 调用块补 mkdir -p sessions 与 --approval-mode auto；补 cfg-* fixture 重指向说明（消除 phase11 假绿）；sandbox/config.toml 陈旧 180000→600000。LOW——cfg-misc/cfg-on 死键 autonomousThinking→autonomousEffort；cfg-misc 移除 cwd 相对断链的 storage 覆盖；smoke-phase4 错误文案指向 sandbox/TEST-KEY.md；archive-round.sh git 命令路径限定；TESTING restore 表补 archive-first 警告；MANUAL-TESTING coverage 摘要补 phase22 自愈、确认框注补"仅交互式"限定；README 双语 Status 行更新为已发布；TESTING §0 补 OPT_OUT_PHASES/probe.sh/archive-round.sh 指引。

**验证**：全量冒烟门全绿（18 phase + manifest + 7 live + orphan-check，runner 重构后正常路径实测）；phase6 八条新用例全过；tsc 19→1；双语编辑均经锚点断言落盘。

**遗留建议**：members.ts createMember/ensureLive 与 startTask 重试策略不一致（握手类失败可安全重试——ensureLive 对已存在记录幂等），需配套探针后专轮实施；storage.dir 相对路径按 cwd 解析的 footgun 仍在（CONFIGURATION 未承诺相对路径语义，fixture 覆盖已移除）。

### 51. 手动测试覆盖核查与文档收尾（plan-89）

**用户 prompt**：「请检查需要我手动测试的流程是否都已经在 @docs/MANUAL-TESTING.md 和 @docs/MANUAL-TESTING_CN.md 中更新，然后给我更新HANDOFF和DEVELOPMENT HISTORY文档，我即将压缩上下文」

**思路**：以"用户需要手动测试什么"为清单逐项核对双语 MANUAL-TESTING 覆盖，补齐缺口，再更新两份交接文档。

**工作**：① **覆盖核查**：M1–M6（§1–§6 各节+总览行）、K1–K7（场景表+live 覆盖）、实际方案确认框+spinner（场景 5+确认框注）、P1-4 激活守卫、会话日志（§7）逐一比对。② **补齐 4 类缺口**（双语同步，锚点断言落盘）：状态总览 2026-10-20→2026-10-23（第 1/4/5 项改记 2026-10-22 用户轮结果——推翻此前"第三跳/maxLoopCount 拒绝未实测"的记录；新增第 7 项"实际方案确认框+生成 spinner 首验"、第 8 项"L1 守卫交互确认"）；场景表新增场景 7（L1 护栏可粘贴验证：`如何用智能体小队并行审查这个仓库？` 激活 vs `什么是智能体小队？` 抑制）、场景 8（K6 自定义角色：`sandbox/agent/agents/quickfix.md` frontmatter + 信任项目层）、场景 9（K7 旧关键词迁移一次性提示）；总览新增第 9/10 项映射 K6/K7。③ **HANDOFF 刷新**：§5 手动测试项更新为 9 场景清单与优先级（M3/场景 5 优先）。

**验证**：全部编辑经锚点断言落盘；双语场景数（各 9）与总览行数（各 10 项+译文行）一致；结论——需要用户手动测试的流程已全部在双语文档中。

### 52. 确认界面 Accept 化、spinner 去省略号与沙箱日志优化（plan-90）

**用户 prompt**：「1."正在生成智能体拓扑协作方案..."的界面，删掉省略号；2.出具拓扑协作方案问yes或no的界面，改为Accept或者让用户自行输入信息；3.已经做了一次sandbox测试，请分析日志文件sandbox/logs/session-log-2026-10-23.md，并进行修改优化」+ 确认性能档实际方案（6 成员 mesh）后「刚刚出现错误，请继续」。

**思路**：按批准方案组建 6 成员团队（总指挥·林/诊断师·陈/溯源员·赵/修复师·王/验证官·孙/记录官·周，mesh）分推进：日志分析 → 根因与方案 → 实施验证。派发在负载 6+ 的机器上屡发 settle 超时（7 次派发 3 次首发失败；王在被杀前已完成绝大部分实现，余项由队长补全），验证由队长亲跑 + lin 末轮审查。

**工作**：① **溯源（赵）**：会话日志五条异常逐条实据判定——唯一真实代码缺陷是 `team_task start` 丢弃 detail（tools.ts:325 第三参硬编码 undefined，agg 未收到三方清单的铁证）；`Tool team_disband/ not found` 是模型发射带尾斜杠的畸形工具名（注册名正确，同会话 9 次成功调用反证，非插件缺陷）；R1/R2/R3 命名拒绝/8 人上限/maxLoopCount=2 限流均为既定护栏；ring 第三跳被限流暴露唯一真正误导用户的文档缺口（用户 Prompt 5 预期"巡游长度=3，在上限内"与默认值矛盾）；**"刚刚出现错误"在所有可读会话记录中无实迹**（不猜测）。② **诊断（陈）**：宿主 confirm 无自定义按钮标签（types.ts:185 选项仅 mirror/signal/timeout/overlay/examples/searchable），"Accept"只能用 select 实现；**RPC 模式 hasUI===true**（runner.ts:518 + rpc-mode.ts:337）使 select 超时→undefined 的陷阱真实可达，必须 `picked === acceptLabel` 严格相等映射；推荐方案 A（select 双选项），自由输入列为后续轮次。③ **实施**：index.ts——select 双选项 + 严格相等映射、spinner 双语去省略号；tools.ts——start 透传 detail 并与 taskPrompt 合并（team_send 路径与无 detail 默认行为不动）；forward.ts——任务编号从 1 起的提示；member-messaging.ts——三处返回补宿主必填的 details（全导入图 tsc 暴露的既存类型契约违背，纯元数据零行为变化）。④ **文档双语 10 文件**：MANUAL-TESTING(_CN)（Accept/Cancel 措辞、ring 闭环警示、建团前 team_status 核对）、README(_CN)（措辞 + ring 段）、CONFIGURATION(_CN)、TEST-PLAN(_CN)（K2/M3）、PROTOCOL(_CN)（detail 参数语义、成员命名规则）。⑤ **验证**：冒烟门全绿；全 extensions 导入图 tsc 仅剩 1 个既知 typebox 映射伪影；lin 末轮审查 6/6 PASS（2 处 LOW 措辞 nit 当轮修掉）。

**验证**：冒烟 exit 0（18 phase + manifest + 7 live + orphan-check）；tsc 1 伪影；grep 确认省略号与方案确认语境的 yes/no 措辞零残留（唯一命中为禁改的历史行）；提交 53b6944/e776f63 + 收尾提交，演示项目未提交改动未被裹挟。

**遗留**：①"允许用户自行输入信息"（input 路径 + note 注入链路）列为后续独立轮次——需先定 note 语义与专属 TUI 验证；② 派发在负载下的 settle 抖动——建议后续为 team_send/team_task start 增加与冒烟 runner 同构的有界重试；③ M3 手动 TUI 目验（Accept/取消 选择框 + spinner）仍待用户执行。

### 53. 方案确认框倒计时取消（plan-91）

**用户 prompt**：「出具拓扑协作方案的界面，在用户按下任意键后，取消倒计时」

**思路**：先查宿主机制再定插件侧可行解。宿主 select 的倒计时是 TUI 组件（apps/cli/src/ui/view/dialogs/countdown-timer.ts + extension-selector.ts:103-113）：`handleInput` 处理按键但完全不碰计时器，仅 `dispose()`（对话框关闭）才停——**宿主不支持按键取消倒计时**，插件也无法给对话框挂键盘监听（ExtensionUIDialogOptions 仅 mirror/signal/timeout/overlay/examples/searchable）。宿主侧正解是 handleInput 里 dispose 计时器，但 sandbox/step 是固定 pin 的子模块、插件须对已发布宿主工作，故不走宿主修改。

**工作**：`extensions/index.ts` confirmChoice 的 select 改**模式分流**——TUI（`ctx.mode === "tui"`，倒计时可见且扰人的场景）不传 timeout：无倒计时、对话框等待用户决定（Esc/取消仍落拒绝，`picked === acceptLabel` 严格相等映射不变）；RPC（hasUI===true 可达、无可见倒计时）保留 30s deadline 作无应答兜底。文档同步：TEST-PLAN(_CN) M3 行、MANUAL-TESTING(_CN) 场景 5 注意列去掉"30s 倒计时"表述；README(_CN) 的 30s 措辞指档位选单回退（行为未动）故保留。

**验证**：tsc 仅剩既知 typebox 伪影；冒烟门全绿（confirmChoice 交互路径冒烟零覆盖，本轮仅改 opts 传参）；待用户场景 5 目验（无倒计时 + Esc 取消 + Accept 组队）。

**遗留（宿主缺口，建议上游）**：extension-selector.ts 的 handleInput 应在任意按键时 `this.countdown?.dispose()` 并复位标题——这才是"按键取消倒计时"的完整实现；插件侧对已发布宿主只能以不设超时规避。

### 54. typebox Optional 单参化：「伪影」定性的修正（plan-92）

**用户 prompt**：「请给我解释typebox映射伪影问题，并给出一个可能的解决方案」+ 确认经济档单成员方案（Lin）+「我选择最推荐方案，请给我进行修改」。

**思路**：先实证再定性。查证：子模块 coding-agent 与 cli 的 package.json 均 pin `typebox: 1.3.7`（store 唯一版本；本仓库无 typebox 依赖，扩展的 import 在宿主进程内解析）——**paths 映射一直是对的**；1.3.7 的 d.ts 声明 `Optional(type)` 单参，运行时 `AddOptional(type)` 不读第二参；node 实测双参调用得 `{"type":"string"}`（描述丢失）、单参内嵌得 `{"type":"string","description":"..."}`（描述落地）。

**工作**：① **定性修正**——TS2554 不是"映射伪影"，而是对真实依赖版本的真实类型错误；更实质的是两参写法的第二参数被静默丢弃，`reason` 参数的描述从未进入工具 schema（tools.ts 里"宿主两种写法都接受"的注释说法不准确，JS 不报错≠参数被使用）。② **实施方案 1**（用户确认的最推荐方案）：`Type.Optional(Type.String({ description: "Failure reason for fail" }))`——类型正确且描述真正送达模型，与同文件 detail 参数现有写法一致；注释重写说明单参缘由及 entry-49 相关性的负载混淆本质（成员根本不加载 tools.ts）。③ **执行方式**：经济档单成员（Lin，low，star）；成员派发两度 settle 超时（负载抖动），改动由成员在被杀前落盘、验证与提交由队长完成。

**验证**：tsc 全导入图**归零**（此前唯一错误即本处）；冒烟门低负载（2.37）连跑两轮均 exit 0、all phases passed（复核 entry-49 握手相关性）；git diff 仅 extensions/tools.ts 一处，演示项目未提交改动未裹挟。

**遗留**：无。typebox 类型门自此全绿；entry 49/50 中"伪影/宿主两种写法都接受"的表述以本条为准（历史条目按惯例不回改）。

### 55. 测试覆盖加固：schema 契约守卫与两个可测性重构（plan-93）

**用户 prompt**：确认经济档单成员实际方案（Solo·全栈执行，custom 单节点，T1 修改优化→T2 更新文档）后「请开始修改优化，并更新文档」。

**思路**：落实三路只读审查轮结论中的全部零 token 测试优化项——补"交互路径与工具 schema 零覆盖"的三个缺口，并把两处内联决策提为纯函数使其可断言。

**工作**：① **新 phase23（standalone）**：假 pi 捕获 `registerTeamTools` 注册的六个团队工具，断言每个工具与每个顶层参数均有非空 description——早些时候 typebox 双参致 `reason` 描述被运行时静默丢弃的事件正可被这条断言捕获（整类回归守卫）；另断言各工具参数名册与 `parameters.type==="object"`。② **两个纯函数提取**：`tasks.ts` 增 `dispatchPrompt(task, startDetail?)`（验收标准+start 时 detail 合并，trim 防空白 detail），tools.ts start 分支改用它；`plan.ts` 增 `planConfirmDialogOpts(mode, timeoutMs)`（TUI→无 timeout 即无倒计时、其他模式保留 30s 兜底），index.ts confirmChoice 改用它。③ **既有 phase 补断言**：phase16 四条 dispatchPrompt、phase21 两条 planConfirmDialogOpts、phase3 两条 `details.to` 回显。④ **runner**：phase23 注册 STANDALONE；首发失败行改 "attempt1 FAILED … retrying once"（消除重试成功后残留裸 FAILED 行对 CI 的误导）。⑤ **文档**：TESTING(_CN) phase23 行+清单注释、README(_CN) 清单补 22/23、TEST-PLAN(_CN) R4 行+尾句修正（K1/K4/K5/K8 已覆盖）、HANDOFF 同步。⑥ **执行方式**：Solo 派发 settle 超时（负载 10）但全部改动在被杀前落盘且与清单逐条吻合，验证与提交由队长完成；**cfg-misc 补节建议经查证搁置**——该 fixture 全仓无 live 消费方（仅文档引用），补节无验证载体。

**验证**：`bash -n` 通过；phase23/16/21/3 单跑全过（runner verdict 要求 DONE 标记+零 FAIL，排除"没跑也算过"）；全量冒烟门 exit 0、**19 phase 全绿**（phase23: OK fails=0）；tsc 零错误；diff 逐行复核与清单一致。

**遗留**：cfg-misc 的"full-section coverage"表述待校正或接线探针；createMember 重试、storage.dir、自由输入链路、settle 抖动兜底维持 deferred（见 HANDOFF §4）。

### 56. 沙箱日志（10-24）修理：任务板 failed 重派与预设提示（plan-94）

**用户 prompt**：「1.确认页面，改为只有Accept和Cancel两个选项，不要写多余文本；2.我已经完成了一轮沙箱测试，请阅读日志 sandbox/logs/session-log-2026-10-24.md，并进行修理与优化」

**思路**：对日志（修复链 + 并行审查 + ring 巡回三轮）的异常逐条定性——演示项目审查发现（M1-M4/m1-m11）与 README 陈旧文案按既往裁定不出插件范围；settle 超时为负载性环境因；真正插件侧三件事：任务板 failed 卡死、预设可发现性、topo_team_msg 自报不可靠。分析员派发 settle 超时（负载 10），队长自读全日志接管分析。

**工作**：① **确认框精简**（请求 1）：Accept/取消 选项去掉「· 按此方案组建 / form this team」后缀，两语言均为精确 `Accept`/`Cancel`。② **任务板 failed 可重派**（日志阶段 2/3 两度卡死 + 队长多轮同症）：`assertDispatchable(task)` 提取至 tasks.ts（ready/failed 可派发；pending/running/done 抛错并带 blockers），members.ts 两处守卫改调它；team_task 工具描述注明 failed 可重派；phase16 补 6 条门禁断言。③ **未知 role 静默回退修复**（日志「四轮创建均回退 worker」的 footgun——审查员因此未获只读白名单）：显式传入但无预设匹配时 create 结果追加提示（可用预设清单 + 各层目录说明）；CONFIGURATION(_CN) 明示预设随包发布且可被 agentDir/信任项目层遮蔽。④ **topo_team_msg 自报不可靠**（三方汇报互相矛盾、R1 将已投递消息误判「无应答」）：契约与 180s 回复超时均无缺陷，属模型侧误读——MANUAL-TESTING(_CN) 新增「派发异常与恢复」运维块（settle 恢复、failed 重派、以会话 JSONL 核实投递、板 id 以 create 返回为准、沙箱预设可用）。

**验证**：tsc 零错误；phase16/2/18/1 单跑全过（含 6 条新门禁断言与 role:「smoke」提示路径）；全量冒烟门 exit 0 全绿。

**遗留**：演示项目 M1-M4/m1-m11 修复（sandbox/project，按既往裁定待用户明确要求）；settle 抖动兜底（team_send 重试的幂等/harvest 策略）维持 deferred；其余见 HANDOFF §4。

### 57. 全面修改与优化轮：spawn 重试、respawn 陷阱与文档销账（plan-95）

**用户 prompt**：确认均衡档实际方案（Scout/Planner/Executor/Reviewer 四成员，planner 中枢 custom 拓扑，T1 调研→T2 计划→T3 实施→T4 审查）后「请创建合理的计划后，开始对项目进行全面的修改与优化」。

**思路**：按批准的四阶段流水线执行——只读成员（Scout/Planner/Reviewer）不碰文件，实施归 Executor、提交与记录归队长。

**工作**：① **T1 调研（Scout）**：A1–A4/B1/B2/C/E 全部确证（附 文件:行号）；B1 实为「表述过时」（phase9 已迁 mktemp 自建 fixture，cfg-misc 无 live 消费方）；**D（演示项目修复）结论「不做」**——restore-project.sh 每轮从 project-pristine/ 复位，修复易失，保留修复须同步改快照而会摧毁种子 bug 演示前提；恢复 B3（P2-8a/b/c/e、P2-9）细节。**重要交叉验证**：Scout 报告同轮 7 个 live 检查全红，队长在干净环境复跑**全绿**——确证「live 检查在成员进程受限环境下假阴性」，教训写入 MANUAL-TESTING 运维块。② **T2 计划（Planner）**：6 处编辑（E1 HANDOFF 计数、E2 CONFIGURATION 双语 storage.dir 绝对路径、E3 TEST-PLAN 双语 cfg-misc 标签、E4 A1 代码、E5 phase1 零 token 回归、E6 restore 卫生）。③ **T3 实施（Executor）**：E2–E5 全部落盘（派发 settle 超时被杀前完成，与计划逐条吻合），队长补跑验证。④ **T4 审查（Reviewer）PASS**：范围零越界、逐项对照逐字吻合、tsc 与 phase1/2/18 复跑全绿；并发现**既有隐患**——augmentDispatchError 追加的 "will respawn with its context resumed" 命中旧内联正则 /spawn/ 的 respawn 子串，settle 超时被 startTaskLocked 判为可重试（重复计费陷阱）。⑤ **队长修复该隐患**：正则改词边界（"spawn step ENOENT" 仍命中、"respawn" 不再命中），phase1 fatal 集补增强错误断言；node 快验 + phase1 + tsc + 全量冒烟门全绿。⑥ E1/E6 由队长执行（HANDOFF §5-1 计数、restore 复位演示项目且日志自动归档）；提交 fc29a94。

**验证**：tsc 零错误；phase1 单跑 OK（10 条判定断言 + 3 个打桩场景）；phase2/18 复跑 OK；全量冒烟门 exit 0（19 phase + manifest + 7 live + orphan-check）。

**遗留（不变）**：A3 自由输入链路、A4 settle 抖动兜底设计、B2 端到端交互覆盖、B3 各项（P2-8c 低成本优先）、E 合 main 前带 key 复跑 phase4/10/11/12；D 演示项目修复（待用户明确退役种子 bug 才做）。

### 58. 剩余项确认与全量测试轮：LLM 探针 22 项全绿（plan-96）

**用户 prompt**：「请给我罗列，现在确认需要修改或优化的内容。如果没有，请开始测试，直至只剩下需要我手动测试的内容」

**思路**：先逐项取证确认剩余修改/优化清单，再进入测试阶段，驱动至「只剩手动项」。

**工作**：① **清单确认**（全部附新取证）：A3 自由输入链路（index.ts:400/448 仍返 boolean、无 note 回流）、A4 settle 兜底（members.ts:658 sendMessage 无重试环）、B2 端到端覆盖（test/ 对 confirmChoice 仅 phase21 纯函数断言）、B3（phase7 无工具层 topology scoping、phase3 无 formatTeammateReply socket E2E、tasks 配置→消费方联动断言缺位、P2-8e 需 key、P2-9 待原审计细节）——四项均为 deferred-by-design 增强，无阻塞、无回归。② **测试阶段**：全量冒烟门 exit 0（19 phase + manifest + 7 live + orphan-check）；**LLM 探针带 key 全绿**——phase4 4/4（回复/上下文/重 spawn 恢复/shim 消息）、phase10 Branch A（cfg-conc）3/3、phase10 Branch B（cfg-deadlock）2/2（maxConcurrent=1 下嵌套消息无死锁）、phase11（cfg-deep2）4/4（深度 2 链 LEAF-OK 回传）、phase12（默认）9/9（oneshot/任务链/unicode/SIGKILL 恢复/流式）。③ **测试中发现并处置一个假绿陷阱**：全局 config.toml 位于 agentDir 旁边且优先级高于 fixture 的 settings.json——本地 `sandbox/config.toml`（gitignored）静默遮蔽 cfg-* fixture，phase10 首跑因此走了 Branch A（报 maxConcurrent=5 而非 fixture 的 1）；以临时 agentDir 隔离后 Branch B 正确执行。TESTING(_CN) Layer C 补该警示与隔离手法。

**验证**：冒烟门全绿；探针合计 22 项断言全过（均在隔离 agentDir 下执行，排除本地配置干扰）。

**遗留**：A3/A4（待用户设计决策）、B2/B3（测试加固排期）；**至此自动化可测内容全部验证通过，剩余全部为用户手动测试项**（场景 5/7/8/9、M1、M2）与 develop→main 合并拍板。

### 59. 测试流程文档审阅与更新（plan-97）

**用户 prompt**：「请审阅所有文档，检查测试流程是否需要更新」。

**思路**：两名只读审查员并行（自动化流程线 / 人工测试线）+ 队长机械一致性核查（phase 计数、fixture 名、命令块跨文档比对），合并发现后统一实施。

**工作**：① **审阅发现**：流程线 7 项必须更新（TESTING_CN 的 Layer C 命令块缺 `mkdir -p` 与 `--approval-mode auto`、TEST-PLAN A1 仍写 17 phase、runner 已实现行为（attempt1 重试/240s rc=124/orphan 轮询/manifest）无文档、覆盖表 phase3/16/21 三行滞后、§I 基线表只列 phase1–8、K8 尾句轮次过时、sandbox README 的 cfg-* 表述失准）；人工线 4 项（MANUAL-TESTING Step 1 写 18 phase、Step 0 与 §0 表"restore 删 logs"表述与自动归档现状不符、README_CN 陈旧 `src/app.ts` 路径、K8 尾句同）。② **实施 16 处双语更新**：TESTING(_CN)——Layer C 命令块对齐英文版、§2 新增"runner 行为与通过标准"段（磁盘派生清单、attempt1 单次重试、rc=124 hang 判定、manifest+7 live+15s orphan 轮询、**live 检查须队长自身进程跑**的假阴性警示）、覆盖表三行补 details.to / dispatchPrompt+assertDispatchable / planConfirmDialogOpts；TEST-PLAN(_CN)——A1 改 19 phase 并注明磁盘派生、§I 表后补全清单指向、K8 尾句改为 2026-10-25 重跑 22/22；MANUAL-TESTING(_CN)——Step 1 改 19 phase、Step 0 与 §0 表修正 restore 自动归档表述（archive-round 仍应跑——保留 session JSONL 与团队注册表）、状态总览补 2026-10-25 自动化基线行、头部补 phase23 schema 守卫、运维块补"spawn/handshake 类失败自动重试"与"failed 重派时 detail 追加"两条；sandbox/README(_CN)——cfg-* 表标注活跃三名（cfg-conc/cfg-deadlock/cfg-deep2）与本地配置遮蔽陷阱；README_CN——app.ts→tasks.js。③ **机械核查确认**：DEVELOPMENT-HISTORY 中的"17 phase"均为历史记录（禁改）；README/TESTING 冒烟命令块已同步 19 phase；cfg-misc 残留仅存于有意保留的历史行。

**验证**：纯文档改动（零代码变更，无需冒烟门）；关键行抽查全部落盘、双语成对。

**遗留（低优先建议项）**：sandbox README 增加测试小节（19 phase/派生/OPT_OUT/manifest/live/orphan + archive 先于 restore）；Layer C 通过标准补 phase10 B 支 60s 无死锁与 phase11 须实跑 4/4 两项；零 token 自动化轮次的 R 行记录规约。

### 60. 手动测试 prompt 去混用：斜杠命令与提示词触发二选一（plan-98）

**用户 prompt**：「请注意，在手动测试的prompt中，斜杠命令和提示词触发二选一，不要像现在这样都使用」。

**思路**：用户指出 §5 演示三幕的 prompt 同时以 `/topo` 开头又含关键词措辞（EN 的 "Use the topo team to…"、CN 的「请用智能体小队…」）——命令路径与关键词路径混在一条 prompt 里，两条都测不干净。

**工作**：① 三幕 prompt 保留 `/topo` 命令路径（与 2026-10-18/19 实测记录一致），剥去关键词措辞，共 6 处（双语）；② runbook 第 2 步新增「两条激活路径——每条 prompt 只用其一，勿混用」说明（双语），明确 §5 走命令路径、§1 步骤 1 与场景 7/8/9 测关键词路径，防止复复发；③ grep 复检确认两份文档中无 `/topo` 与关键词同现的 prompt。

**验证**：复检零混用；纯文档改动（无代码变更，无需冒烟门）。

**遗留**：无（此项完结）。

### 61. 交接状态整理：剩余项盘点（plan-99）

**用户 prompt**：「请修改HANDOFF和DEVELOPMENT HISTORY文档，然后告诉我现在还有哪些内容等待修改优化。若没有，请告诉我还有哪些手动测试需要我做」。

**思路**：全部轮次完成后对交接文档做一次状态整理——修正滞后项、补齐缺失轮次记录、把剩余项盘点成一张确定清单。

**工作**：① **HANDOFF §1**：日期 2026-10-23→2026-10-25；总览补入缺失的 plan-96/97/98 三个轮次 bullet，轮次表述改十轮→十一轮（补「手动测试 prompt 去混用」）；提交计数按 `git rev-list --count` 实测改 30→31。② **§4**：storage.dir 条目更新（文档半已于 plan-95 完成，仅剩行为半）；补入 plan-97 审阅遗留的 3 项低优先文档建议。③ **§5**：合并项计数 25→31，探针建议更新为「plan-96 已全量重跑且其后无代码改动，合入前无需重跑；若有新代码改动则须重跑」。④ **盘点结论**：等待修改/优化的内容仅剩 **4 项 deferred-by-design 增强**（A3 自由输入链路、A4 settle 抖动兜底、B2 确认路径端到端覆盖、B3 测试加固五项）+ **3 项低优先文档建议** + **1 项上游缺口**（宿主 select 倒计时不响应按键）；无阻塞、无回归、无已知缺陷；自动化可测内容已全部验证通过（冒烟 19 phase + manifest + 7 live + orphan-check、探针 22/22、tsc 零错误）。

**验证**：纯文档整理（无代码变更，无需冒烟门）；计数以 git rev-list --count 实测为准。

**遗留**：见 HANDOFF §4/§5——A3/A4 待用户设计决策、B2/B3 排期、3 项低优先文档建议；其余全部为用户手动测试项（场景 5/7/8/9、M1、M2）与 develop→main 合并拍板。












