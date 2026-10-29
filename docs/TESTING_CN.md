# 测试指南
> [English →](./TESTING.md)

> 四层测试体系的操作化版本。原则：**先写可复现测试，再修复**；零 token 层优先，
> LLM 层只在沙箱内用测试 key 做最小调用。探针按 phase 编号递增：零 token 层随仓库分发
> （`test/smoke/phase*.ts`），LLM 层随 `sandbox/` 分发（需你自己的 key）；历史执行记录见 `docs/TEST-PLAN_CN.md`。

## 0. 环境准备

零 token 层：`test/run-smoke.sh` 自建一次性临时 agentDir（mktemp），无需任何准备，与真实
`~/.stepcode` 完全隔离。LLM 层在 `sandbox/` 内运行（`sandbox/` 随仓库分发，`cfg-*` fixture 已内含；仅 agent dir、sessions、teams 等运行时状态在 .gitignore 内）。step 二进制解析顺序：`$STEPCODE_STEP_BIN` > `sandbox/step-build/step`（从 `sandbox/step` submodule 构建）> PATH 中的 `step`（见 `sandbox/step-bin.sh`）。headless 探针必须带
`--approval-mode auto`，否则派生进程的工具会被审批拦截：

```bash
export STEP_CODING_AGENT_DIR="$PWD/sandbox/agent"
export STEP_CODING_AGENT_SESSION_DIR="$PWD/sandbox/agent/sessions"
```

LLM 层测试前，把 key 写入 `sandbox/TEST-KEY.md`（gitignored，首行 `STEP_API_KEY=<key>`）或 export `STEP_API_KEY`——各runner 脚本会自动读取（环境变量优先；key 绝不落盘）。

### 沙箱运行时状态与还原

沙箱的可复用设施（脚本、探针、`cfg-*` fixture、`project-pristine/`）随仓库分发；下列
**运行时状态**（均 gitignored）会随测试累积，需要时清理：

| 状态 | 位置 | 清理方式 |
|---|---|---|
| 演示项目 | `sandbox/project/`（会被成员改动，如修复种子 bug） | `bash sandbox/restore-project.sh` 还原为种子态 |
| 会话 / 团队 / 计划 / live-context | `sandbox/agent/{sessions,teams,plans,live-context}` | `rm -rf` 后重跑（全新沙箱） |
| 演示项目运行数据 | `sandbox/project/data/` | `restore-project.sh` 自动清除 |
| 会话日志 | `sandbox/logs/session-log-*.md`（验证会话按需生成，prompt 见 [../sandbox/README_CN.md](../sandbox/README_CN.md#会话日志)） | `restore-project.sh` 自动删除 |
| 各 fixture 的运行时状态 | `sandbox/cfg-*/{sessions,teams,teams-*,live-context}` | 同上，按需清理 |

```bash
# 快速还原（每轮 LLM 层测试后必做）：种子 bug 就位、data/ 清除
bash sandbox/restore-project.sh

# 彻底清场（可选）：删除全部沙箱运行时状态后还原演示项目
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

`OPT_OUT_PHASES="13 14" npm run smoke` 表示跑除列表外的全部 phase（runner 唯一的
刻意排除开关；显式 phase 参数优先）。`bash sandbox/probe.sh` 是一次性 RPC 握手探针
（期望输出 `PROBE OK`）；`bash sandbox/archive-round.sh <标签>` 会把一轮测试的证据
——会话 JSONL、团队注册表、`logs/`、演示项目 diff——快照到 gitignore 的
`sandbox/archive/`，且必须在任何会删除它的还原**之前**执行。

交互 TUI 的人工验证（含可复制粘贴的 prompt）与完整手动测试清单（含各项还原命令）均见
[MANUAL-TESTING.md](MANUAL-TESTING_CN.md)。

## 1. A 层 — 单元测试（无 LLM，无进程）

纯函数层，用 node/jiti 直接加载模块（当前以探针内断言方式覆盖，未单列 runner）：

| 对象 | 用例 | 通过标准 |
|---|---|---|
| `registry.ts` | saveRegistry 原子写 / loadRegistry 健壮性 / agentDir 解析 | 并发 50 次写后 JSON 可解析且为某次完整快照；坏 JSON、schemaVersion≠1、文件缺失均返回 null 不抛 |
| `tasks.ts` | validateGraph / recomputeReady / nextTaskId | 自环、间接环、未知依赖抛 TaskGraphError；合法 DAG 不抛；ready 矩阵全场景正确；删除中间任务后编号复用最小空洞 |
| `rpc-client.ts` onData | 帧规则 | 行内含 U+2028/U+2029 不被断行；半行正确拼接；`\r\n` 与裸 `\n` 均处理 |
| `presets.ts` | frontmatter 解析 | `tools: [a, b]` 数组、引号值、CRLF、缺 name/description 跳过 |
| `registry.ts` usage | usageDelta/addUsage | 跨进程重置场景 delta 不为负、累计正确 |

## 2. B 层 — 零 token 集成探针（已入库，`test/smoke/`）

探针随仓库分发，经 `test/run-smoke.sh` 以一次性临时 agentDir（mktemp）运行，
不污染 `~/.stepcode` 或 gitignore 的 sandbox/：

```bash
npm run smoke                 # 全部零 token 层（phase 1 2 3 5 6 7 8 9 13 14 15 16 17 18 19 20 21 22 23 24）
bash test/run-smoke.sh 9 13   # 只跑指定 phase
```

phase5 会发起一次真实模型调用（1 token）：未设置 `STEP_API_KEY` 时 runner 显式 SKIP
而非失败。密钥来自环境变量，或 `sandbox/TEST-KEY.md`（gitignored）首个非注释行——
任一就绪即纳入回归。

| 探针 | 覆盖 | 成本 |
|---|---|---|
| phase1 | 成员生命周期断言（spawn/握手/注册表持久化/disband 复位/幂等恢复——kill 路径实例身份回归） | 零 token |
| phase2 | 任务板状态机（DAG/环/ready-set/持久化） | 零 token |
| phase3 | 消息服务 + shim status 往返 + 预设加载 + `topo_team_msg` 结果 `details.to` 回显 | 零 token |
| phase5 | 并发创建竞态/失败即杀/状态机/socket 0600/abort/shutdown | 1 次 token（无 key 时 SKIP） |
| phase6 | 默认关闭激活 + 配置纯函数 + 模型/effort 解析 + 强制关键词迁移（剥离/上报/全旧词禁用）+ L1 否定护栏矩阵 | 零 token |
| phase7 | 拓扑真值表 + 越界拒绝 + requireDeclaration 门 | 零 token |
| phase8 | 递归深度 /proc 实检 + 子团队自举 + 并发默认值 | 零 token |
| phase9 | 配置边界（storage.dir/项目级/非法回退）+ [tasks] 节校验 | 零 token |
| phase13 | 项目级配置（trust 门控/深合并/优先级/env/MAXDEPTH） | 零 token |
| phase14 | 环形 loop 上限（配置面/manager 层即抛/server 层经 shim 拒绝/拓扑优先/边界放行） | 零 token |
| phase15 | TUI 渲染断言（render.ts 六工具 call/result，含折叠/展开/用量行/状态图标） | 零 token（独立运行） |
| phase16 | 成本护栏与输出截断单测（costWarning / truncateOutput）+ `dispatchPrompt` 合并契约 + `assertDispatchable` 门禁（failed 任务可重派） | 零 token（独立运行） |
| phase17 | 孤儿进程（成员不得比队长长寿） | 零 token |
| phase18 | 名额计数（解散释放名额）+ 恢复参数忽略提示 + dispatch 失败上下文（超时/中止提示接力在途与成员名册） | 零 token |
| phase19 | 统一配置层级（全局/项目级 config.toml、信任门控、优先级、非法 TOML 容忍、env 仍胜出） | 零 token |
| phase20 | 配置种子化（首次激活追加注释默认值块；幂等、保序、既有内容保留） | 零 token |
| phase21 | 团队请求指令构建器 + 方案档位数据（语言选择、档位策略提示词、选单选项、自定义流程、评审协议）+ `planConfirmDialogOpts`（TUI 无倒计时） | 零 token |
| phase22 | 工具可用性自愈：`ensureToolsAvailable` 在宿主重置后恢复工具、失活时 no-op、`session_start` 对团队注册表已存在的会话重新激活 | 零 token |
| phase23 | 团队工具 JSON-schema 契约：每个工具与每个顶层参数均有非空 description（守卫 typebox 双参 Optional 类回归——曾致 reason 丢失描述） | 零 token |
| phase24 | 确认路径端到端：假 ExtensionAPI + 脚本化 ctx 驱动真实扩展工厂——断言选项顺序恰为 `Accept / Cancel / Other`、Accept 原样转发请求并注入方案指令、Other 输入 note 原样合并、空提交按原样接受、**输入被关闭**（Esc/超时→undefined）与 Cancel 完全同果、Cancel 仅注入激活指令（`plan.enabled` 经 resetConfigCache 钩子切换并还原） | 零 token（独立运行） |

**runner 行为与通过标准**：phase 清单由 `test/smoke/phase*.ts` 磁盘派生（run-smoke.sh:37）；失败 phase 以新 session id 重试一次（首发失败行前缀 `attempt1`，重试通过不会给 CI 留裸 `FAILED` 行）；240s 内无 `DONE` 输出判为 hang（rc=124），与断言失败区分；判定要求 DONE 标记 + 零 FAIL 行。phase 之后：manifest 检查、7 个 live 检查、15s 孤儿进程轮询（phase17 跳过时孤儿检查报 `SKIPPED` 而非静默通过）。**live 检查必须由队长自身的干净进程跑**——在成员进程的受限环境中会整体假阴性（2026-10-25 实测：成员侧 7 项全红、队长侧全绿）。

LLM 路径探针（phase4/10/11/12）需要测试 key，位于 `sandbox/`——探针本身已跟踪入库，仅沙箱运行时状态在 .gitignore 内（见 C 层）。

## 3. C 层 — LLM 路径测试（测试 key，沙箱内，每条成本极小）

```bash
# 先隔离 agent 目录：不设置时 step 回退到 ~/.stepcode/agent，其 packages 项里
# 安装的本插件副本会与下面的 -e 扩展冲突——全部工具名加载失败，探针根本不运行。
mkdir -p "$PWD/sandbox/agent/sessions"   # gitignored；fresh clone 上无人创建它
export STEP_CODING_AGENT_DIR="$PWD/sandbox/agent"
sleep 300 | bash sandbox/with-test-key.sh step -e "$PWD/extensions/index.ts" \
  -e "$PWD/sandbox/smoke-phase4.ts" \
  --mode rpc --session-id r4 --session-dir "$PWD/sandbox/agent/sessions" --approval-mode auto
```

| 探针 | 配置 | 覆盖 |
|---|---|---|
| phase4 | 默认 | LLM 全路径（回复/上下文记忆/重启恢复/成员间消息） |
| phase10 | cfg-conc / cfg-deadlock | 并发上限 live / 嵌套消息死锁 |
| phase11 | cfg-deep2 | 递归深度 2 真实链 |
| phase12 | 默认 | oneshot/任务链/Unicode/崩溃恢复/流式进度 |
| probe-remaining-manual `5a` | 隔离 agentDir（plan.enabled） | 确认框 Other 路径：脚本化 RPC 客户端应答档位选单→确认框选「Other」→input，断言用户文本原样进入转发的 user 消息。对话框按**标题**（`Topology Agent Team`）、选项按**精确标签**（`Other`）匹配——无位置兜底，选项改名或换序会让探针失败而非 silently 答成 Cancel。每个场景等待会话的 **`agent_settled`** 事件（prompt 命令自己的 response 只是 preflight 应答——rpc-mode.ts 在 `preflightResult` 里就发出了），`waitMs` 仅作安全上限，另等会话文件大小稳定后再读取 |
| probe-remaining-manual `5b` | 隔离 agentDir（plan.tier 钉档） | 负向断言：钉档后档位选单与三选项确认框**均不出现**（plan-104 的 `pinnedTier` 标志同时跳过两者；显式 `/topo <档位>` 仍保留确认） |
| probe-remaining-manual `7` | 隔离 agentDir ×2 | L1 护栏：元问题零团队动作；how-to 带主体激活且 team_create_member 真实可用 |
| probe-remaining-manual `8` | 隔离 agentDir（agents/quickfix.md + autonomousEffort=false） | 自定义角色：frontmatter tools/effort 落到真实 spawn（create 结果含 role/effort:low/tools），成员自报白名单含 topo_team_msg——注意自报那半是**LLM 行为断言**：2026-10-29 抖动过一次（失败、重跑通过），而机械的 create 结果断言两次均过，因此单次失败本身不构成产品缺陷 |
| probe-remaining-manual `9` | 隔离 agentDir（keywords 含废弃词） | 迁移提示每会话恰好出现一次 |

phase10/phase11 的行为来自 agentDir 的配置，因此运行时把上面的 export 指向对应 fixture
（phase11 用 `STEP_CODING_AGENT_DIR="$PWD/sandbox/cfg-deep2"`）。用默认目录跑 phase11
会得到干净的 SKIP——那是假绿。

**本地配置遮蔽**：全局 `config.toml` 位于 agentDir **旁边**（`dirname(agentDir)/config.toml`），优先级高于 fixture 的 `settings.json`。因此本地的 `sandbox/config.toml`（gitignored）会遮蔽 `sandbox/cfg-*`——其 `dispatch.maxConcurrent` 会静默取代 fixture 的值，phase10 将走 Branch A 而非 B（2026-10-25 实测假绿）。有该文件的机器上隔离探针：把 fixture 的 `settings.json` 拷进临时 agentDir 并把 `STEP_CODING_AGENT_DIR` 指过去。

通过标准（摘要）：并行调度均成功；任务链状态流转 pending→ready→running→done；
oneshot 有回复且不留常驻进程；kill -9 后下一次 send 成功且记得上文；
`STEPCODE_TEAM_COST_WARN=0.0001` 触发告警、设为 0 禁用；abort 后无孤儿进程；
onUpdate 至少被调用一次；>50KB 输出截断且 details.fullText 含全量。另：cfg-deadlock 分支
（phase10，`maxConcurrent=1`）须在探针窗口内（实测约 6s）无死锁完成；phase11 必须配
`cfg-deep2` 实跑四条检查（4/4）——干净 SKIP 算失败。

断言计数注记（2026-10-29 复跑）：现行探针中 phase10 两个分支各记一条检查（A 支：4 条回复全到
+ 观测并发 ≤ 2，共两条；B 支：嵌套消息完成，一条），因此旧执行记录行里的「3/3 + 2/2」是探针版本
注记而非回归。分支通过 = `SMOKE10 DONE (all passed)` **且** `mode:` 行与目标分支一致——`mode:`
显示另一支意味着 fixture 被遮蔽（环境假绿），不算通过。

团队环境变量注记（队长跑探针时）：探针必须在卸载六个 `STEPCODE_TEAM_*` 变量的情况下运行
（`env -u …`）。在成员进程内它们会被注入并遗传给探针自启的 `step` 子进程，该子进程里的扩展读到
depth 1 ≥ `maxRecursionDepth` 1 而保持惰性——所有探针都会假失败。冒烟 runner 的 phase 不受此影响
（它本身就从干净进程派生）。

每轮人工沙箱演练结束后，让 agent 把过程记录到 `sandbox/logs/session-log-<日期>.md`——可粘贴的
prompt 见沙箱 README 的「会话日志」一节（[../sandbox/README_CN.md](../sandbox/README_CN.md#会话日志)）。

## 4. D 层 — 鲁棒性与边界

队长崩溃恢复（registry 无 `.tmp-*` 残留、resume 后视图与磁盘一致）、Unicode/emoji 往返、
参数校验（空 message/非法成员名/未知 task id/未知 member 均得明确错误）、
目录不存在（sessions 目录删后 createMember 仍正常）、大规模（8 成员上限 / 999 任务上限 /
单任务 detail 50KB——均为可配置默认值，见 [CONFIGURATION.md](CONFIGURATION_CN.md)）。

TUI 渲染（renderCall/renderResult、`/topo` 面板、流式进度、激活 notify）只在交互 TUI
生效，探针覆盖不到，按 [MANUAL-TESTING.md](MANUAL-TESTING_CN.md) 第 1 节人工验证——该文档
同时包含完整的手动测试清单（真实安装、项目配置信任流、LLM 遵循度、沙箱演示剧本、成本护栏等）。

## 5. 修复与复跑规则

1. 失败先定位根因：产品缺陷 vs 探针缺陷 vs 陈旧状态，记录进 `docs/TEST-PLAN_CN.md`。
2. 产品缺陷：修复后复跑对应探针 + 受影响回归。
3. 探针缺陷：修探针后重跑。
4. 全绿后提交推送（修复与文档分开，conventional commit）。
