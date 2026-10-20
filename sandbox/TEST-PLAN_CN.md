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
| phase6 | 默认关闭激活 + 配置纯函数 + 模型/思考解析 | 零 token |
| phase7 | 拓扑真值表 + 越界拒绝 + requireDeclaration 门 | 零 token |
| phase8 | 递归深度 /proc 实检 + 子团队自举 + 并发默认值 | 零 token |

## 二、本次重点覆盖缺口

1. **并发上限 live**：`maxConcurrent` 的排队启动语义从未用真实派活验证（phase5 只测 spawn 互斥）
2. **嵌套消息死锁（预判缺陷）**：成员 A 持信号量经 shim 消息 B 时，B 的派活也要信号量——`maxConcurrent=1` 或信号量耗尽时会死锁到超时。分析结论：server 中介的成员间消息应**绕过全局并发门**（发送方已占一个位，链式获取会自锁）
3. **递归深度 2 live 链**：phase8 只验证进程级自举；子队长真实创建子成员并回传答案未验证
4. **oneshot 模式**：自发版以来从未 live 测试
5. **任务链 live**：`team_task start` 的真实派活→完成→解锁下游
6. **`/agent-team` 命令路径**：命令激活 + 团队板 notify 从未触发过
7. **流式进度**：`onUpdate`/interim 文本从未观测
8. **Unicode/emoji 往返**、**kill -9 崩溃恢复**（含 onClose 后状态 staleness 预判）、**reaper 逻辑**、**配置边界**（storage.dir/项目级不加载/非法回退）

## 三、测试矩阵

| 探针 | agentDir/配置 | 成本 | 对应缺口 |
|---|---|---|---|
| smoke-phase9 | cfg-misc（全节覆盖+storage.dir+debug） | 零 token | 8 |
| smoke-phase10 | cfg-conc（maxConcurrent=2） | ~4 次 token | 1 |
| smoke-phase10 | cfg-deadlock（maxConcurrent=1, timeoutMs=60s） | ~2 次 token | 2 |
| smoke-phase11 | cfg-deep2（maxRecursionDepth=2, dispatch.timeoutMs=240s） | ~4 次 token | 3 |
| smoke-phase12 | 默认配置 | ~6 次 token | 4/5/7/8 |
| RPC 直发 `/agent-team` | 默认配置 | 零 token | 6 |
| smoke-phase13 | 默认配置（合成 base/project 目录，settings.json 节 + 旧文件回退） | 零 token | 项目级配置 |

## 四、执行记录

| 探针/配置 | 结果 | 失败项 | 后续 |
|---|---|---|---|
| phase9 / cfg-misc | ✅ 33/33 | 探针笔误×2（async 漏 await、reaper 阈值小于 spawn 间隔） | 修探针后全过 |
| phase10 / cfg-conc | ✅ 2/2 | — | 4 并行派活、观测最大并发 2（排队启动正确） |
| phase10 / cfg-deadlock | ✅ 修复后通过 | **产品缺陷：嵌套消息死锁**（A 持唯一信号量经 shim 消息 B，B 的派活也要信号量→60s 超时） | 已修复：server 派活标记 nested 绕过全局门 |
| phase11 / cfg-deep2 | ✅ 修复后 4/4 | **产品缺陷①：`team_set_topology` 不在门控清单→激活前泄漏；②子队长 `--tools` 允许清单过滤掉团队工具→深度2 编排失效**（另有 cfg-deep2 配置文件丢失的测试设施问题、探针未启队长 server 问题） | 已修复：门控清单补全、子队长允许清单合并团队工具、协调提示加固（命令失败不排查工具）；探针补启队长 server + 拒答检测 |
| phase12 / default | ✅ 9/9 | — | oneshot/任务链/Unicode/崩溃恢复/流式全过；顺带验证 **onClose 状态修复**（外部 kill 后不再滞留 idle） |
| /agent-team 命令 | ✅ | — | RPC 直发 `/agent-team`→激活 notify + 团队板 notify |
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
- **还原机制**（plan-10）：`sandbox/project-pristine/` 为初始快照（不含 data/）；`bash sandbox/restore-project.sh` 用快照覆盖 project/ 已知文件并清除 data/。实测：模拟成员修复（8/8）→ 还原 → 回到 7/8 预期失败。每轮演示前先执行一次。

### 演示剧本

| 剧本 | 拓扑 | 步骤 |
|---|---|---|
| 修复链 | pipeline | scout 定位种子 bug → planner 出修复方案 → worker 修复并跑 `npm test` 转绿 → reviewer 审查 diff |
| 并行审查 | star | 三个 reviewer 分头审查正确性 / 风格 / 安全，队长汇总 |
| 巡回审查 | ring | 成员沿环传递审查意见；观察 `topology.maxLoopCount`（默认 2）对巡游链长的约束——超限后成员应转为向队长汇报（错误信息明确提示）。2026-10-19 实测：两跳成功、第三跳成员按预判规避未发起 |

## 八、演示项目复审与修复（plan-56，2026-10-19）

来源：第二轮手动验证 session（`sandbox/session-log-2026-10-19.md`，已按 restore
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

## V. 0.2.0 轮次（2026-10-19）

待验证新面：`/topo` 命令（档位 / 选单 / review / off）、插件专属关键词 + 强制迁移、三层防误触护栏、逐字转发与请求本地指令注入、`team_msg` 成员间消息（无需 bash）、自定义角色、effort 预设。

### 无 key 可自动化

| # | 检查项 | 命令 / 探针 | 预期 |
|---|---|---|---|
| A1 | 全量零 token 回归 | `npm run smoke` | all phases passed（17 phase + manifest + 6 live + orphan-check） |
| A2 | 协议探针 | `bash sandbox/probe.sh` | `PROBE OK` |
| A3 | 沙箱还原往返 | `bash sandbox/restore-project.sh` | `project/` 回到种子状态（种子 bug 复现）；运行时数据与 session 日志清除 |
| A4 | 干净导出加载 | 由 A1 覆盖（live-clean-export） | `git archive HEAD` 导出物的扩展可激活 |

### 需 STEP_API_KEY（提供 key 前仅用户可跑）

| # | 检查项 | 探针 | 缺口 |
|---|---|---|---|
| K1 | `/topo <请求>` 端到端 | RPC prompt 带命令 | 逐字请求落入会话日志；队长组建团队（不独自完成） |
| K2 | 方案选单 + 档位指令 | 沙箱会话，`plan.enabled=true`，`/topo` | 选单显示 4 档 + 自定义；所选档位指令抵达模型 |
| K3 | `plan.tier` 固定档模式 | 配置 `tier="fast"` | 不弹选单；每次激活（命令与关键词路径）直接应用该档 |
| K4 | `/topo review <目标>` | 沙箱会话 | 三审查员 + worker 合并协议被执行 |
| K5 | team_msg 成功派发 | 两成员 + 一条声明的边；上游向下游发消息 | 回复经 socket 返回——拓扑修复留下的 E2E 缺口 |
| K6 | 自定义角色 | `<agentDir>/agents/quickfix.md`；受信任项目中的项目级 | `team_create_member(role="quickfix")` 应用提示词/工具/effort |
| K7 | 关键词迁移提示 | 配置含旧关键词 | 激活时剥离并提示一次 |
| K8 | phase4/10/11/12 LLM 探针 | `sandbox/smoke-phase4/10/11/12.ts` | 新 spawn 参数（allowlist 含 team_msg）下的全路径回归 |

### 必须人工（真实 TUI / 安装 / UX）

| # | 项目 | 原因 |
|---|---|---|
| M1 | 真实安装：干净导出物 `step install`、激活、`step remove` | `step install` 命令 UX + 卸载；live-package-install 只覆盖 config packages 加载路径 |
| M2 | 信任弹窗 UX | 项目级配置信任弹窗是交互式的 |
| M3 | TUI 选单/确认框渲染 | `ctx.ui.select`/`confirm` 观感、30s 超时倒计时 |
| M4 | TUI 渲染观感（render.ts） | phase15 只断言内容字符串，不覆盖像素 |
| M5 | 英文译文审阅 | 文档双语准确性 |
| M6 | 8 成员性能（主观，可选） | 定性 |

### 执行记录

| # | 结果 | 说明 |
|---|---|---|
| A1 | ✅ all phases passed | 17 phase + manifest + 6 live（含 live-review）+ orphan-check |
| A2 | ✅ PROBE OK | 零 token 协议探针 |
| A3 | ✅ 已还原 | 种子 bug 复现；`data/` 与 `session-log-*.md` 已清除 |
| A3b | ✅ 7/8 基线 | 还原后的项目恰好只挂种子测试 |
| A4 | ✅（经 A1） | live-clean-export 加载并激活归档导出物的扩展 |

剩余：K1–K8 需 `STEP_API_KEY`；M1–M6 为人工项（见上表）。
