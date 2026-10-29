# 沙箱全面测试计划（plan-43）
> [English →](./TEST-PLAN.md)

> 目标：对已上线的功能做一次沙箱内的系统性 live 测试，暴露并修复问题。
> 原则：零 token 探针优先；LLM 探针只用测试 key 做最小调用；失败先记录再修复再复跑。
>
> 版本钉住：`sandbox/step` submodule 钉住本沙箱跟踪的 Step Code 版本；step 二进制的
> 解析顺序（$STEPCODE_STEP_BIN > sandbox/step-build > PATH）见 `sandbox/step-bin.sh`，
> 更新流程见 `sandbox/README.md`。

## 一、已有覆盖（回归基线）

| 探针 | 覆盖 | 成本 |
|---|---|---|
| phase1 | 成员生命周期（spawn/握手/disband/重建） | 零 token |
| phase2 | 任务板状态机（DAG/环/ready-set/持久化） | 零 token |
| phase3 | 消息服务 + shim status 往返 + 预设加载 | 零 token |
| phase4 | LLM 全路径（回复/记忆/恢复/成员间消息） | 少量 token |
| phase5 | 并发创建竞态/失败即杀/状态机/socket 0600/abort/shutdown | 1 次 token |
| phase6 | 默认关闭激活 + 配置纯函数 + 模型/effort 解析 | 零 token |
| phase7 | 拓扑真值表 + 越界拒绝 + requireDeclaration 门 | 零 token |
| phase8 | 递归深度 /proc 实检 + 子团队自举 + 并发默认值 | 零 token |

> 完整的当前 phase 清单（19 个，由 `test/smoke/phase*.ts` 磁盘派生）与逐 phase 覆盖见 [docs/TESTING.md](TESTING_CN.md) 第 2 节；上表为历史基线快照。
## 二、本次重点覆盖缺口

1. **并发上限 live**：`maxConcurrent` 的排队启动语义从未用真实派活验证（phase5 只测 spawn 互斥）
2. **嵌套消息死锁（预判缺陷）**：成员 A 持信号量经 shim 消息 B 时，B 的派活也要信号量——`maxConcurrent=1` 或信号量耗尽时会死锁到超时。分析结论：server 中介的成员间消息应**绕过全局并发门**（发送方已占一个位，链式获取会自锁）
3. **递归深度 2 live 链**：phase8 只验证进程级自举；子队长真实创建子成员并回传答案未验证
4. **oneshot 模式**：自发版以来从未 live 测试
5. **任务链 live**：`team_task start` 的真实派活→完成→解锁下游
6. **`/topo` 命令路径**：命令激活 + 团队板 notify 从未触发过
7. **流式进度**：`onUpdate`/interim 文本从未观测
8. **Unicode/emoji 往返**、**kill -9 崩溃恢复**（含 onClose 后状态 staleness 预判）、**reaper 逻辑**、**配置边界**（storage.dir/项目级不加载/非法回退）

## 三、测试矩阵

| 探针 | agentDir/配置 | 成本 | 对应缺口 |
|---|---|---|---|
| smoke-phase9 | 探针自建 settings.json 全节 fixture（mktemp；取代已弃用的 cfg-misc 标签）——全节覆盖+storage.dir 重定向+debug | 零 token | 8 |
| smoke-phase10 | cfg-conc（maxConcurrent=2） | ~4 次 token | 1 |
| smoke-phase10 | cfg-deadlock（maxConcurrent=1, timeoutMs=60s） | ~2 次 token | 2 |
| smoke-phase11 | cfg-deep2（maxRecursionDepth=2, dispatch.timeoutMs=240s） | ~4 次 token | 3 |
| smoke-phase12 | 默认配置 | ~6 次 token | 4/5/7/8 |
| RPC 直发 `/topo` | 默认配置 | 零 token | 6 |
| smoke-phase13 | 默认配置（合成 base/project 目录，settings.json 节 + 旧文件回退） | 零 token | 项目级配置 |

## 四、执行记录

| 探针/配置 | 结果 | 失败项 | 后续 |
|---|---|---|---|
| phase9 / 自建全节 fixture | ✅ 33/33 | 探针笔误×2（async 漏 await、reaper 阈值小于 spawn 间隔） | 修探针后全过 |
| phase10 / cfg-conc | ✅ 2/2 | — | 4 并行派活、观测最大并发 2（排队启动正确） |
| phase10 / cfg-deadlock | ✅ 修复后通过 | **产品缺陷：嵌套消息死锁**（A 持唯一信号量经 shim 消息 B，B 的派活也要信号量→60s 超时） | 已修复：server 派活标记 nested 绕过全局门 |
| phase11 / cfg-deep2 | ✅ 修复后 4/4 | **产品缺陷①：`team_set_topology` 不在门控清单→激活前泄漏；②子队长 `--tools` 允许清单过滤掉团队工具→深度2 编排失效**（另有 cfg-deep2 配置文件丢失的测试设施问题、探针未启队长 server 问题） | 已修复：门控清单补全、子队长允许清单合并团队工具、协调提示加固（命令失败不排查工具）；探针补启队长 server + 拒答检测 |
| phase12 / default | ✅ 9/9 | — | oneshot/任务链/Unicode/崩溃恢复/流式全过；顺带验证 **onClose 状态修复**（外部 kill 后不再滞留 idle） |
| /topo 命令 | ✅ | — | RPC 直发 `/topo`→激活 notify + 团队板 notify |
| 回归（修复后） | ✅ phase1/2/3/5/6/7 + phase4 全绿 | — | 三处产品修复无回归 |
| phase13 / default（plan-51） | ✅ 14/14 通过（1 项 SKIP：探针环境项目未授信，live 受信任分支跳过；不受信 live 断言通过） | phase9 旧断言哨兵值 99 越界（members.max 校验范围 1–64），改 7 后通过——探针缺陷，非产品缺陷 | 项目级配置已接线；phase1–9 零 token 回归全绿 |
| 探针入库（plan-51） | ✅ `test/smoke/` 承接 phase1/2/3/5/6/7/8/9/13，`test/run-smoke.sh` hermetic 运行；带 key 验证 phase5 通过 | phase5 需 key（此前手工循环以 `grep 'FAIL '` 漏判为通过——探针输出为 `FAILED:` 无尾随空格；runner 以 DONE 标记 + key 门控修正） | sandbox 副本已删；LLM 层（4/10/11/12）留 sandbox |
| phase18 / 暂存 max=2（plan-55） | ✅ 13/13（先红后绿） | 探针流程缺陷：cap 检查后直接建 scout 会被旧语义拦截致中途退出——修探针（先整队解散再建） | 名额仅计存活成员；恢复参数忽略提示；拓扑/创建的无 bash 警告；随 runner 默认列表入库 |

## 六、产品缺陷清单（本轮发现并已修复）

1. **嵌套消息死锁**（members.ts/team-server.ts）：成员间消息经 server 派活时同样竞争全局信号量，发送方持位等回复、目标方等信号量→死锁至超时。修复：`SendOptions.nested`，server 中介的派活绕过全局门（每成员队列与拓扑门控仍然保留）。
2. **门控泄漏**（activation.ts）：`team_set_topology` 注册后未加入 `TEAM_TOOL_NAMES`，激活前即可用，破坏默认关闭。修复：清单补全为 6 个工具。
3. **子队长工具饥饿**（members.ts）：`--tools` 是全量允许清单（覆盖扩展工具），预设角色的清单把子队长的团队工具全部过滤。修复：`canOrchestrate` 时把 `TEAM_TOOL_NAMES` 合并进允许清单。
4. **崩溃后状态滞留**（members.ts）：成员被外部 kill 后 `onClose` 仅在 running 时置 dead，idle 成员滞留"idle"。修复：任何退出都置 dead。
5. **协调提示脆弱**（members.ts）：消息命令失败时 LLM 会去排查工具而弃任务。修复：提示中明确"命令失败不排查、继续干活并在汇报中注明"。

### plan-43 之后发现的缺陷（后续轮次，供发版记录）

6. **队长模型回落绕过 `models.available`**（members.ts，2026-10-29 R14 轮发现）：会话模型是复合 `provider/id` 串，而 `models.available` 里是可派生的裸 id；回落路径（无显式请求、预设也未钉模型）原样返回复合串、不做校验——显式参数分支会拒绝同一个串并给出清晰错误，预设分支会降级到 `available[0]`，唯独回落路径没有守卫。影响：内置 `worker` 预设未声明 `model:`，于是每个 worker 成员都以不可解析的模型派生、永不 settle，每次派发以 settle 超时告终且零 usage、无诊断（若是直接的 spawn 失败，读错成本会低得多）。修复：`spawnableModel()` 校验并降级到 `available[0]`；phase6 以复合队长模型串断言两个分支。冒烟探针此前用裸 id 充当 `LEADER_MODEL`，正好掩盖了该缺陷。

7. **相对 `storage.dir` 按进程 cwd 解析**（registry.ts，2026-10-29 R16 轮发现并修复）：`teamsRoot()` 对配置的相对 `dir` 直接 `path.resolve()`，锚点是 `process.cwd()`——cwd 即队长碰巧启动的目录且成员会继承，于是一条相对路径会把一个团队的注册表悄悄散落到各个项目，看着配了的条目其实从未落到文档所说位置（低危：默认 null 与绝对路径不受影响，且 plan-95 已把「须填绝对路径」写进文档作为缓解——本轮直接拔掉这个 footgun 而不是绕着文档写）。修复：相对 `dir` 改为按 `agentDir()` 解析；phase9 2b 块以自包含 fixture 断言两半（解析到 agentDir 下 / 绝不按 cwd），因为 runner 的 mktemp agentDir 不设 storage.dir、原分支在门里处于休眠。

## 五、修复与复跑规则

1. 失败先定位根因（产品缺陷 vs 探针缺陷 vs 陈旧状态），记录在本文档
2. 产品缺陷：修复后必须复跑对应探针 + 受影响回归
3. 探针缺陷：修探针后重跑
4. 全部通过后提交推送（修复与文档分开）

## 七、沙箱测试小项目（plan-52）

`sandbox/project/` 重建为零依赖 Node.js 小任务管理器（`src/tasks.js` + `src/cli.js` + `test/tasks.test.js`），
作为团队成员在沙箱内做真实干活的载体（成员在这里勘察/规划/修复/审查，绝不指向真实仓库）。

- **种子 bug**：`complete(id)` 用 `id - 1` 索引数组而非按 id 查找；`remove` 之后 id 与数组位置错位，
  测试 `complete after remove still targets the right task (seeded bug)` 失败（报 `task 3 not found`）。
- **验证记录**：带 bug 状态 `cd sandbox/project && npm test` = 7/8 通过、退出码 1；临时改为按 id
  查找后 8/8 全绿（证明可修复），已还原为带 bug 的演示状态。
- `secret-sample.txt`（假密钥）保留，供路径保护护栏测试使用。
- **还原机制**（plan-10）：`sandbox/project-pristine/` 为初始快照（不含 data/）；`bash sandbox/restore-project.sh` 用快照覆盖 project/ 已知文件并清除 data/。实测：模拟成员修复（8/8）→ 还原 → 回到 7/8 预期失败（演示套件此后增至 12 条——当前还原态基线为 11/12）。每轮演示前先执行一次。

### 演示剧本

| 剧本 | 拓扑 | 步骤 |
|---|---|---|
| 修复链 | pipeline | scout 定位种子 bug → planner 出修复方案 → worker 修复并跑 `npm test` 转绿 → reviewer 审查 diff |
| 并行审查 | star | 三个 reviewer 分头审查正确性 / 风格 / 安全，队长汇总 |
| 巡回审查 | ring | 成员沿环传递审查意见；观察 `topology.maxLoopCount`（默认 2）对巡游链长的约束——超限后成员应把结论写入最终报告交回队长（错误信息明确提示；leader 不是消息目标）。2026-10-19 实测：两跳成功、第三跳成员按预判规避未发起 |

## 八、演示项目复审与修复（plan-56，2026-10-19）

来源：第二轮手动验证 session（`sandbox/session-log-2026-10-19.md`，已按 restore
策略删除；会话日志现统一写 `sandbox/logs/`）
策略删除）的任务 2（star 三方并行审查）与任务 3（ring 巡回汇总）。复审对象为
`sandbox/project` 演示代码（非插件本身）。

**已修复（project 与 project-pristine 同步；带 bug 7/8、修复态 8/8 基线不变）**：

| # | 问题 | 修复 |
|---|---|---|
| M1 | CLI store 调用未捕获：崩溃 + 完整堆栈、exit 1（与参数校验的 exit 2 不一致） | `src/cli.js` 增 `run(fn)` 包装四个 store 调用：`console.error(err.message)` + exit 2 |
| M2 | `load()` 不校验 state 形状：`{}`/`[]`/`{"tasks":[]}` 通过 JSON.parse 后泄漏进 store——或 TypeError 崩溃，或 nextId=NaN 致 id 全 undefined 静默失效 | `src/tasks.js` `load()` 出口校验（tasks 为数组 + nextId 为正整数），非法回退默认状态（与不可解析文件同语义） |

**有意不修（fixture 设计使然）**：

- 种子 bug（`complete()` 的 `id-1` 索引）：演示靶子，restore 后必须重新存在；
- 过期文案（测试名 `(seeded bug)`、兜底提示 `Expected demo failure`、README 已知问题 1）：描述的就是 restore 后重新成立的种子 bug；
- M3 并发写无锁 / 非原子 save：README 已知项，单人 demo 可接受；
- L6（parseInt 宽松）/ L3（add 非字符串崩溃）/ L8（strict === 字符串 id）/ L9（nextId 非 max+1）/ L10（remove 无返回）：API 健壮性 nit，CLI 层已有守门，demo 保持简单；
- M5（测试顶层 rmSync 销毁真实 data/、CLI 测试打真实 DATA_FILE）：测试卫生问题，修复需为 store 注入数据目录，改动面超出 demo 定位——留待用户定夺；

**成员视角误判（已核实）**：

- 「项目缺 .gitignore，`data/tasks.json` 有被提交风险」：根仓库 .gitignore 已忽略 `sandbox/project/data/`——成员只见项目目录、不见仓库根，误判；
- 「`secret-sample.txt` 被 git 跟踪属不良模式」：**有意设计**——README 明示的假密钥护栏样本，供「成员不得读取/外传密钥」验证，保持跟踪；

**后续项（0.2.0 卫生轮已实施）**：H1 已区分 ENOENT 与损坏 JSON（损坏时显式报错而非静默重置）；title 控制字符/换行已净化（防 list 输出注入）；测试数据目录已隔离（M5——测试经 `new TaskStore({ dataDir })` / `TASKS_DATA_DIR` 使用一次性目录，不再触碰真实 `data/`）。

**验证**：修复态 `npm test` 12/12；M1 复现路径（`add ""` / `done 99`）均为干净 exit 2；M2 复现路径（`{}` / `{"tasks":[]}`）均回退为空列表；restore 后 11/12 基线（种子失败）不变；project 与 project-pristine 逐文件一致。

## 九、0.2.0 轮次（2026-10-19）

待验证新面：`/topo` 命令（档位 / 选单 / review / off）、插件专属关键词 + 强制迁移、三层防误触护栏、逐字转发与请求本地指令注入、`topo_team_msg` 成员间消息（无需 bash）、自定义角色、effort 预设。

### 无 key 可自动化

| # | 检查项 | 命令 / 探针 | 预期 |
|---|---|---|---|
| A1 | 全量零 token 回归 | `npm run smoke` | all phases passed（20 phase——清单由 `test/smoke/phase*.ts` 磁盘派生——+ manifest + 7 live + orphan-check） |
| A2 | 协议探针 | `bash sandbox/probe.sh` | `PROBE OK` |
| A3 | 沙箱还原往返 | `bash sandbox/restore-project.sh` | `project/` 回到种子状态（种子 bug 复现）；运行时数据与 session 日志清除 |
| A4 | 干净导出加载 | 由 A1 覆盖（live-clean-export） | `git archive HEAD` 导出物的扩展可激活 |

### 需 STEP_API_KEY（密钥放入 sandbox/TEST-KEY.md；环境变量优先）

| # | 检查项 | 探针 | 缺口 |
|---|---|---|---|
| K1 | `/topo <请求>` 端到端 | RPC prompt 带命令 | 逐字请求落入会话日志；队长组建团队（不独自完成） |
| K2 | 方案选单 + 档位指令 | 沙箱会话，`plan.enabled=true`，`/topo <请求>` | 选单显示 4 档 + 自定义；带请求时三选项确认框（Accept / Cancel / Other）展示模型生成的实际方案（一次性规划调用）；Accept 以高优先级注入该方案，选 Other 输入的自由文本随请求原样同行，Cancel 只注入激活指令。**Accept 路径 2026-10-25 人工实测；Other 输入由 `probe-remaining-manual.mjs 5a` live 验证；TUI 按键观感留 M3** |
| K3 | `plan.tier` 固定档模式 | 配置 `tier="fast"` | 钉档=「别再问」：两条激活路径都不弹选单**也不弹三选项确认框**，直接应用该档。**已由 `probe-remaining-manual.mjs 5b` live 验证（双负向断言：选单与确认框均不出现）+ phase24 钉档零 token 场景**；关键词路径已由 `probe-remaining-manual.mjs 5c` live 验证（两个对话框均不出现 + 一条激活正向断言防假绿） |
| K4 | `/topo review <目标>` | 沙箱会话 | 三审查员 + worker 合并协议被执行 |
| K5 | topo_team_msg 成功派发 | 两成员 + 一条声明的边；上游向下游发消息 | 回复经 socket 返回——拓扑修复留下的 E2E 缺口 |
| K6 | 自定义角色 | `<agentDir>/agents/quickfix.md`；受信任项目中的项目级 | `team_create_member(role="quickfix")` 应用提示词/工具/effort。**agentDir 层已由 `probe-remaining-manual.mjs 8` live 验证（effort:low + frontmatter 白名单 + topo_team_msg 叠加）；项目级层需 M2 信任流** |
| K7 | 关键词迁移提示 | 配置含旧关键词 | 激活时剥离并提示一次。**已由 `probe-remaining-manual.mjs 9` live 验证（每会话恰好一次）** |
| K8 | phase4/10/11/12 LLM 探针 | `sandbox/smoke-phase4/10/11/12.ts` | 新 spawn 参数（allowlist 含 topo_team_msg）下的全路径回归 |

### 必须人工（真实 TUI / 安装 / UX）

| # | 项目 | 原因 |
|---|---|---|
| M1 | 真实安装：干净导出物 `step install`、激活、`step remove` | `step install` 命令 UX + 卸载；live-package-install 只覆盖 config packages 加载路径 |
| M2 | 信任弹窗 UX | 项目级配置信任弹窗是交互式的 |
| M3 | TUI 选单/选择框渲染 | `ctx.ui.select` 观感、Accept / Cancel / Other 三选项（无倒计时——方案确认框等待用户决定）、Other 输入对话框、档位选单的 30s 回退 `balanced` |
| M4 | TUI 渲染观感（render.ts） | phase15 只断言内容字符串，不覆盖像素 |
| M5 | 英文译文审阅 | 文档双语准确性 |
| M6 | 8 成员性能（主观，可选） | 定性 |

### 执行记录

| # | 结果 | 说明 |
|---|---|---|
| A1 | ✅ all phases passed | 17 phase + manifest + 7 live（含 live-review）+ orphan-check |
| A2 | ✅ PROBE OK | 零 token 协议探针 |
| A3 | ✅ 已还原 | 种子 bug 复现；`data/` 与 `session-log-*.md` 已清除 |
| A3b | ✅ 11/12 基线 | 还原后的项目恰好只挂种子测试（套件已在卫生轮扩至 12 条） |
| A4 | ✅（经 A1） | live-clean-export 加载并激活归档导出物的扩展 |
| A1 | ✅ all phases passed（2026-10-22 优化验证轮重跑） | 18 phase + manifest + 7 live + orphan-check；含 phase22 自愈探针 |
| K8 | ✅ 四个 LLM 探针全部通过（2026-10-22） | phase4（回复/上下文记忆/respawn 恢复/shim 消息）、phase10（并行 4/4，实测 max 4 ≤ 5）、phase11（默认配置干净 SKIP 后用 `sandbox/cfg-deep2` 补跑 depth-2 链）、phase12（oneshot+用量/任务链/Unicode/SIGKILL 恢复/流式中 interim） |
| F1 | 重跑中发现的流程修复 | TESTING(_CN)：文档化的 LLM 探针调用缺 `STEP_CODING_AGENT_DIR` 隔离——`~/.stepcode/agent` 中已安装的插件副本与 `-e` 扩展冲突，全部工具名加载失败、探针根本不运行（双语文档已补隔离导出）；MANUAL-TESTING(_CN) runbook 17→18 phase；run-smoke.sh 重复注释已删 |
| U1 | ✅ 用户手动轮（2026-10-22；§7 日志被一次未归档的还原删除，分析证据改从会话 JSONL 重建） | §1 走查 + 三幕剧本全部完成：4 成员修复链 T1–T4 完工；Act 1 前提已被早前激活轮满足（基线 12/12），队长以 clarify_user + 只读复核任务妥善应对；Act 2 三路并行评审 T8–T10；Act 3 环形巡回 a→b→c 两跳成功、第 3 跳被拒并原文引用（"would reach 3 hops, over the ring loop limit (2)"），整链约 12 分钟在 600s 超时族下零超时完成；team_set_topology 正确使用 members 作用域；全会话仅 1 处 isError:true（即该预期拒绝） |
| F2 | 日志丢失加固（2026-10-22） | restore-project.sh 现于删除前把 logs/（及旧位 session-log-*.md）自动归档到 sandbox/archive/<时间戳>-auto-before-restore/，未归档的还原再也不会毁掉一轮 §7 日志；MANUAL-TESTING Act 1 增加基线坑位提示（上一轮已修掉种子 bug 时先还原；队长 clarify_user 应对属正确行为）；激活指令补充“用户未要求改动时保持只读”纪律 |
| R3 | ✅ 自动化轮（2026-10-23）：遗留修复+测试流程轮 | P1-4 元问题守卫改句子锚定（如何/怎么 用法请求恢复激活；纯 how-to 问句仍抑）+ phase6 8 条用例；冒烟 runner 有界单次重试；context hook 经 ContextEvent 类型化注册（tsc 19→1）；审计驱动的测试流程更新（phase22 文档行、Layer C 调用块、fixture 键、stale 配置、README 状态行）。全量套件绿 |
| R4 | ✅ 自动化轮（2026-10-23）：测试覆盖加固 | 新 phase23 全工具 JSON-schema 守卫（typebox 描述丢失事件可被捕获）+ phase16/21/3 的 dispatchPrompt / planConfirmDialogOpts / details.to 断言；runner 重试行前缀 attempt1；全量套件 19 phase 全绿、tsc 零错误 |
| R5 | ✅ 自动化轮（2026-10-24）：沙箱日志驱动修理 | 确认框选项精简为精确 Accept/Cancel；failed 板任务可重派（assertDispatchable + phase16 六条门禁断言）；未匹配的显式 role 在 create 结果中提示；MANUAL-TESTING(_CN) 新增派发异常恢复运维块；全量套件绿、tsc 零错误 |
| R6 | ✅ 自动化轮（2026-10-25）：全面修改与优化（均衡档团队轮） | createMember spawn 重试（ensureLiveWithRetry，与 startTaskLocked 同构）+ isRetryableSpawnError 词边界修复（堵住增强错误里 respawn 的误放行）；phase1 零 token 回归块（10 条断言+3 个打桩场景）；CONFIGURATION(_CN) storage.dir 绝对路径说明；TEST-PLAN(_CN) 弃用 cfg-misc 标签；演示项目修复决议不做（设计上易失）；全量套件绿、tsc 零错误 |
| R7 | ✅ 验证轮（2026-10-25）：剩余项确认+LLM 探针全量重跑 | A3/A4/B2/B3 复核仍为 deferred-by-design（无阻塞无回归）；冒烟门全绿；探针 22/22 断言全过（phase4 4/4、phase10 A 3/3+B 2/2 无死锁、phase11 4/4 深度 2 链、phase12 9/9）；发现并记载本地配置遮蔽 fixture 的假绿陷阱 |
| R8 | ✅ 文档轮（2026-10-25）：测试流程文档审阅 | 两名只读审查员（流程线+人工线）+ 队长机械一致性核查；16 处双语更新——TESTING(_CN) C 层命令块对齐 + runner 行为/通过标准段 + phase3/16/21 覆盖行；TEST-PLAN(_CN) A1 17→19 + §I 指向 + K8 尾句；MANUAL-TESTING(_CN) Step 1 19 phase + restore 自动归档表述 + 2026-10-25 基线 + phase23 头部 + 运维块补注；sandbox/README(_CN) cfg-* 活跃/遗留标注；README_CN 陈旧路径。无代码改动 |
| R9 | ✅ 自动化轮（2026-10-25）：性能档轮（派发故障后由队长执行） | A3 自由输入落地（三选项；用户文本随请求原样同行）；A4 usage 守卫 settle 重试（dispatchWithSettleGuard——仅当该次尝试证明什么都没做才重发）；新 phase24 确认路径端到端探针（6 断言）；P2-8c/8a 测试加固；3 项遗留文档建议 + A3/A4 文档调整；全量套件绿（20 phase）、tsc 零错误 |
| R10 | ✅ 验证轮（2026-10-25）：A3/A4 代码上的 LLM 探针复跑 | 探针 22/22（phase4 4/4、phase10 A 支 3/3 + B 支 2/2 无死锁、phase11 4/4、phase12 9/9）——运行在含自由输入与 usage 守卫 settle 重试的代码上，派发路径被实际走过；每条探针均在隔离 agentDir 下执行（避开本地配置遮蔽）；冒烟门仍全绿（20 phase） |
| R11 | ✅ 沙箱实测驱动轮（2026-10-25）：来自用户手动轮日志的修复 | B：describeTopology 只渲染边参与者（已解散的 dead 记录不再列为「no direct peers」行）；C：送达回执补「勿重发」（占位符守卫本身经取证为设计行为）；D：规划提示词要求方案与拓扑自洽（star ⇒ 汇总只能经队长中转）；E：激活协议要求接力链任务书写明终稿回传路径；A：README 补 autonomousEffort 说明；F：create 结果无条件说明恢复事实；phase14/16/21 断言；全量套件绿（20 phase）、tsc 零错误 |
| R12 | ✅ 手动场景收口轮（2026-10-25）：性能档方案执行 | T1 场景清单（7 项必测 + 降级依据）→ T2A 主笔修订 MANUAL-TESTING(_CN)（新增 §8–§11：场景 5a/5b/7/8/9 明细节，场景表明细列改指新节）→ T4 执行未完成测试：`sandbox/probe-remaining-manual.mjs` 五个子命令全部 PASS（5a 自定义输入原样进入转发请求 / 5b 钉档选单不出现 / 7 抑制+激活+team_create_member / 8 frontmatter tools+effort 落地 / 9 迁移提示恰好一次）；同步 TESTING(_CN) 探针表、sandbox/README(_CN)、K2/K3/K6/K7 行；全量冒烟门仍绿 |
| R13 | ✅ 钉档一致性修复轮（2026-10-25）：性能档方案执行 | 三份沙箱日志分析（parallel-review/2301 均无插件缺陷，findings 全属演示项目）+ 用户报告的钉档语义不一致：根因=命令路径 `runTeamCommand` 钉档分支只跳过选单、仍走规划调用+三选项确认（关键词路径直接注入）；修复=index.ts 加 `pinnedTier` 标志跳过两者；phase24 新增钉档零 token 场景（2 断言）、probe 5b 翻转断言后 live 复跑 PASS；CONFIGURATION/README/MANUAL-TESTING/TEST-PLAN 双语同步；全量门绿 |
| R14 | ✅ 测试排气轮（2026-10-29）：v0.3.0 正式版前在最终产品代码上复跑 LLM 层 | **发现并修复产品缺陷**：内置 `worker` 预设未声明 `model:`，`models.autonomousSelection = true` 时 `resolveMemberModel` 回落到队长的复合 `provider/id` 串（如 `step/step-5-preview`）并**未经 `models.available` 校验**即传给 `--model`——预设分支会降级到 `available[0]`、显式参数分支会直接报错，唯独回落路径没有守卫；后果=成员永不 settle，每次派发以 settle 超时告终且零 usage、无任何诊断。修复：新增 `spawnableModel()` 校验并降级；phase6 补双分支复合模型串回归断言（57/57）。**探针在修复后代码上复跑**（隔离 agentDir + `env -u` 卸载团队变量 + 拷入 fixture settings.json 防遮蔽）：phase4 4/4、phase10 A 支 2/2（`mode: parallel-bound (maxConcurrent=2)`）、B 支 1/1（`mode: nested-messaging-under-single-slot`，12.9s 无死锁）、phase11 4/4（零 SKIP——深度 2 链真实跑通）、phase12 9/9、probe-remaining-manual 5a/5b/7/9 PASS、8 首跑 FAIL 重跑 PASS（机械断言——create 结果含 role/effort:low/frontmatter tools——两次均过，抖动的只是成员对自身白名单的 LLM 自述）。修复后零 token 门由队长在干净进程重跑：20 phase + manifest + 7 live + orphan-check 全绿。**派发机制观察**：本轮连续 7 次成员派发 settle 超时（会话后期只读预设亦死），队长按既定模式在干净进程亲自执行；队长自写车道脚本时漏 export `STEP_CODING_AGENT_DIR`，复现了 Layer C 工具名冲突陷阱（5 个探针瞬间假失败），修正后通过 |
| R15 | ✅ 界面改名与确认顺序轮（2026-10-29）：「Topology Agent Team」自称 + Accept/Cancel/Other | 用户需求：① 询问界面不得自称「智能体团队」——插件名是 Topology Agent Team；② 方案确认框选项顺序改为 Accept / Cancel / Other，选 Other 后让用户输入信息；③ 全面优化测试项至只剩必须手动项并同步文档。**改动**：`extensions/index.ts`——L2 关键词激活确认框（标题+正文，经 `detectLang` 按语言分流）与方案确认 select 标题均改为「Topology Agent Team」；确认框选项为 `[Accept, Cancel, Other]`，`Other` 与 Accept/Cancel 一样双语同一字符串；`extensions/forward.ts`——**尝试后已回退**：把注入指令自称改为 `[Topology Agent Team 已启用]` 会破坏模型服从性——probe 7 的 `[7-activate]` 连续三次失败（模型改用自带工具探索仓库并口头讲解协议，而不调用 `team_create_member`），还原该标签后立即通过，且期间询问对话框的改名始终在位（干净的单字符串隔离实验）。结论：面向模型的自称必须保留模型能归属到本插件的名字；只改用户可见的询问对话框。**测试加固**：phase24 新增选项顺序断言（`["Accept","Cancel","Other"]`）与输入被关闭断言（Esc/超时→undefined 与 Cancel 完全同果、同注入）——两者把「Esc 取消」的数据面移出手动集；`probe-remaining-manual.mjs` 改为按**标题**匹配对话框、按**精确标签**匹配选项且无位置兜底（旧 `?? options[1]` 在新顺序下会静默答成 Cancel），并为 LLM 自述类断言打印成员实际回复，新增 `all` 模式（各场景独立子进程跑完并汇总）。**验证**：零 token 全量门全绿（20 phase + manifest + 7 live + orphan-check）；phase21/24 绿；tsc 我方文件零错误；live 探针 5a/5b 在新标题新标签下 PASS，8 首跑 FAIL 重跑 PASS（机械断言两次均过——已知的 LLM 自述抖动）。派发机制再度退化（两次 settle 超时），剩余编辑由队长接管完成 |
| R16 | ✅ 遗留收口轮（2026-10-29）：storage.dir 相对路径修复 + probe 5c + tsc 错误归零 | **产品修复（下文缺陷第 7 条）**：相对 `storage.dir` 原经 `path.resolve()` 按 `process.cwd()` 解析——cwd 即队长碰巧启动时所在目录（成员还会继承），一条相对路径会把一个团队的注册表悄悄散落到各个项目，且看着配了的条目其实从未落到文档所说位置；`teamsRoot()` 现改为相对路径按 `agentDir()` 解析（绝对路径行为不变），phase9 新增两条自包含回归断言（相对路径解析到 agentDir 下 / 不按 cwd 解析——runner 的 mktemp agentDir 不设 storage.dir，故 2b 块自建 fixture），先红后绿已验证（`PASS storage.dir: relative resolves under the agent dir — agentDir=/tmp/p9-*/agent got=/tmp/p9-*/agent/teams-relocated`）。**settle 超时自动 harvest：已评估、本轮不实现**——成员可能仍在服务端推进，自动收割会造成重复工作与重复计费；维持手动恢复 + 既有收获指引（作为结论记入本行）。**测试侧**：`sandbox/probe-remaining-manual.mjs` 新增场景 **5c**——钉档走关键词路径（两个对话框均不出现），并加一条激活正向断言防假绿，首跑即靠它抓到真假绿（未应答 L2 confirm 导致插件根本没激活，仅负向断言会因错误的理由通过）；phase15 的 Theme 桩补全为完整公开面（消除 16 个 TS2345）、phase24 改为经 getter 读取 context hook（TS2349——TS 的 CFA 在 await 后把外层 `let` 窄化成 `never` 的误报）；**tsc 全导入图 17 → 0 错误**。**验证**：零 token 全量门 20 phase + manifest + 7 live + orphan-check 全绿（GATE_EXIT=0）；探针 `all` 6 场景 5 PASS——5a 首跑 FAIL（「确认后 team 工具调用」为空）、单跑复测 PASS（转发逐字正确，仅模型是否调工具这一条抖动——与前两轮同型的 LLM 行为抖动） |

**轮次记录规约**：每轮改动代码、测试或测试流程（零 token 轮次也包括）都应追加 R 行——日期、跑了什么、结果、异常；人工沙箱轮另产 §7 会话日志。

**R16 之后的状态（2026-10-29）**：K1/K4/K5/K8 已被覆盖；**K2/K3/K6/K7 现已双重 live 验证**——`probe-remaining-manual.mjs` 5a/5b/7/8/9 在最终产品代码上全部 PASS（8 的 LLM 自述断言抖动过一次、重跑通过；其机械断言两次均过）。仍属交互式的只剩不可再约的人工集：M1（真实安装/卸载）、M2（项目级配置信任弹窗 + K6 项目级角色层）、M3/M4（TUI 像素与按键——探针驱动的是对话框数据面而非渲染）、M5（英文译文审阅）、M6（可选，8 成员满编性能）；R16 的 probe 5c 补齐了钉档的关键词路径——最后一个关键词路径抽查就此移出手动集。每轮人工演练结束后，按沙箱 README「会话日志」一节的 prompt 生成记录（[../sandbox/README_CN.md](../sandbox/README_CN.md#会话日志)）。

### 2026-10-20 沙箱会话发现

- **Bug（已修复）**：团队工具在会话中段整体变为 "tool not found"（00:54–00:55 正常，00:57:56 起失效），无 `/topo off`、无 reload、无会话重启——宿主侧重置隐藏了工具且当时无恢复路径。修复：插件激活期间每次输入都经 `ensureToolsAvailable()` 重断言工具可用；`session_start` 发现本会话团队注册表已存在时自动重新激活（覆盖会话恢复与扩展重初始化）。提交 50df038 / 601e6f8。
- **改名**：成员间消息工具 `team_msg` → `topo_team_msg`（与 `/topo` 命令族同前缀；规避未来官方智能体团队功能撞名）。
- **移除**：`team_create_member` 结果中"无 bash 不可消息"的误导提示（每个成员都注入 `topo_team_msg`，只读预设的拓扑边可用），以及失效的 `messagingWarnings` 辅助函数。
- **手动流程**（2026-10-20 会话交付）：`/topo` 基础 → L1/L2 护栏 → 组队 + topo_team_msg E2E → 方案选单（需 `sandbox/config.toml` 配 `plan.enabled=true`）→ 固定 `plan.tier` → `/topo review` → effort/自定义角色 → 迁移提示 → C 层探针 → 真实安装 → 信任弹窗 → 译文审阅。

### 2026-10-20 沙箱会话发现（第二轮：整合后的 MANUAL-TESTING 清单）

- **Bug（已修复）**：`topo_team_msg` 的回复契约断裂——发送方收到宿主对「无 assistant 文本回合」的占位符 `No result provided`（经 `res.reply` 回流），环上传递静默失效：发送方无法区分「已投递」与「回复丢失」，只能退回队长代收（本轮实测两次：r1→r2 与 r2→r3；接收方实际均已处理消息）。修复：member-messaging.ts 新增 `formatTeammateReply()`——空回复或占位符一律转为明确的投递回执（指引把结论写入最终报告并经队长收集）；rpc-client.ts 不再把该占位符捕获为 assistant 文本；phase16 探针覆盖契约（真实回复透传；空/占位符/undefined/纯空白均得回执）。
- **观察（护栏按设计工作）**：高 effort 多文件审查超过 180s 默认 `dispatch.timeoutMs`，队长派发触发 "timeout waiting for member to settle" 并被 fail-fast 杀死；r3 四次尝试均未完成一次完整审查（上下文保留可 resume）。该超时可配——长审查应调高 `dispatch.timeoutMs`，或按本轮做法经 respawn 收割（r1/r2 即如此收回）。
- **验证通过**：拓扑成员作用域参数（`team_set_topology` 带 `members`）在累积了旧成员的团队中精确产出 3 边环（r1→r2→r3→r1），旧成员被隔离（无直连边）而非被圈入环。
