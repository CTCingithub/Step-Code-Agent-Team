# 手动测试清单（已最小化）
> [English →](./MANUAL-TESTING.md)

> **自动化覆盖**（`npm run smoke`，零 token；phase5 与 LLM 项需 key）：协议层、配置三级
> 加载与旧文件回退、拓扑真值表与越界拒绝、递归深度、任务板状态机、消息强制（拓扑/loop
> 上限/等待环）、项目级配置的**信任应用与拒绝**（`live-project-config` /
> `live-untrusted-config`）、live 接线（`/topo` 命令、参数转发）、**TUI 渲染内容层**
> （phase15 对 render.ts 各工具 call/result 字符串、折叠/展开、用量行、图标的断言）、
> **成本护栏与输出截断逻辑**（phase16）、**孤儿进程**（orphan-check：成员不得比队长
> 长寿）、**干净导出物可加载性**（live-clean-export：git archive 出的包能激活）、
> **包安装路径**（live-package-install：settings 的 `packages` 条目指向仓库即可加载
> 扩展并激活）。
>
> 以下仅剩**不可约**的人工项。先看下方**单轮测试 runbook** 获取一轮完整顺序；其余各节是
> 分场景明细，均含**可直接复制粘贴的命令 / prompt**。TUI 渲染清单（只剩观感；内容层已被
> phase15 断言）见第 1 节。

## 状态总览（2026-10-23）

| # | 项目 | 状态 |
|---|---|---|
| 1 | 交互 TUI 观感 | ✅ 2026-10-22 完整走查实测通过（渲染无问题） |
| 2 | 真实安装（干净导出物 `step install`） | ➖ 机制部分已由 `live-package-install` / `live-clean-export` 覆盖；交互残留 ⬜ 待用户执行 |
| 3 | 信任弹窗交互 UX | ➖ 拒绝路径已由 `live-untrusted-config` 覆盖；弹窗本身 ⬜ 待用户执行 |
| 4 | LLM 行为遵循度（ring） | ✅ 2026-10-22（两跳成功 + 第三跳被拒并原文引用——此前未实测部分已确认） |
| 5 | 沙箱演示剧本（三幕） | ✅ 2026-10-22 复测通过 |
| 6 | 性能主观项（8 成员满编） | ➖ 可选，主观无判定标准 |
| 7 | 实际方案 Accept/取消 选择框 + 生成进度动画（新 UI） | ➖ 仅经类型/冒烟验证；首次真实 TUI 目验 ⬜ 待用户执行（场景 5） |
| 8 | 激活护栏 L1（2026-10-23 重写） | ➖ phase6 八条用例全绿；一次交互确认 ⬜ 待用户执行（场景 7） |
| 9 | 自定义角色（agentDir 层 + 信任项目层） | ➖ phase3 覆盖预设加载与信任门控；LLM 层应用 ⬜ 待用户执行（场景 8） |
| 10 | 旧关键词迁移提示 | ➖ phase6/phase9 覆盖剥离语义；一次性提示 ⬜ 待用户执行（场景 9） |
| — | 英文版文档译文审阅 | ⬜ 建议过目 |

## 单轮测试 runbook（一轮完整测试）

一轮测试的完整顺序——本文档其余章节都是其中某一步的明细。所有命令与 prompt 均可直接复制粘贴。

### 第 0 步 — 预检（启动会话前）

```bash
# 先归档上一轮的证据——restore 会删除 logs/（§7 日志的所在地）
bash sandbox/archive-round.sh <上一轮标签>
# 还原沙箱：种子 bug 复位，data/ 与 logs/ 清空
bash sandbox/restore-project.sh
```

密钥：写入 `sandbox/TEST-KEY.md`（gitignored）即可——`./sandbox/run.sh` 会自动读取
（环境里已 export 的 `STEP_API_KEY` 优先）。§1 第 5 步起需要 key；没有 key 这些步骤会失败。

### 第 1 步 — 自动化门（任何人工操作前必须全绿）

```bash
npm run smoke   # 18 phase + manifest + 7 个 live 检查；任何失败先停下修复
```

### 第 2 步 — 交互场景（按顺序，一次粘贴一条）

| # | 场景 | 操作 | 明细 | 注意 |
|---|---|---|---|---|
| 1 | 激活 + 团队板 | §1 第 1–2 步 | §1 | — |
| 2 | 建成员 + pipeline + 任务板 | §1 第 3–8 步 | §1 | — |
| 3 | `topo_team_msg` E2E | 粘贴：`让 scout1 通过 topo_team_msg 给 worker1 发一条一句话自我介绍，并原样报告工具的返回文本` | §1、§4 | 回复为尽力语义：投递回执（"Delivered to …"）不是队友的答复——产出经队长收集 |
| 4 | ring 快巡（小步快跑） | §4 的 ring prompt | §4 | 每一跳保持小工作量（一个文件一个问题），使每跳都能在 600s 默认 `dispatch.timeoutMs`（覆盖成员整回合，含嵌套中继）内 settle——且超时不再触发盲目重试：任务会带着收割指引失败。只跑一圈；最终清单由队长收集。**环内闭环**：默认 `maxLoopCount=2` 下，3 成员环的闭环跳（r3→r1）必被拦下——闭环须由队长中转；确需环内闭环再调高 `maxLoopCount` |
| 5 | 方案选单 / 固定档 | 在 `sandbox/config.toml` 开启，**重启会话**，再 `/topo` | TEST-PLAN K2/K3 | `plan.enabled` / `plan.tier` 每会话只读一次——启动前改好配置 |
| 6 | 并行评审 | `/topo review src/tasks.js` | TEST-PLAN K4 | — |
| 7 | 激活护栏（L1） | 粘贴：`如何用智能体小队并行审查这个仓库？` | — | 2026-10-23 重写：带请求主体的 how-to 请求会激活插件（正常组队）；对插件本身的纯提问（`什么是智能体小队？`）仍被抑制——不组队 |
| 8 | 自定义角色（K6） | 写 `sandbox/agent/agents/quickfix.md`（frontmatter：`name`/`description`/`tools`/`effort`），重启，粘贴：`创建一个 quickfix 角色的成员，取名 fixer1，让它用一句话列出自己的工具白名单` | §1 | frontmatter 的 prompt/tools/effort 生效（工具列表即白名单）；项目级角色 `sandbox/project/.stepcode/agents/` 仅在信任的项目加载（删 `sandbox/agent/trust.json` 可重触发弹窗） |
| 9 | 旧关键词迁移提示（K7） | 在 `sandbox/config.toml` 的 `keywords` 中于插件专属词旁加 `"智能体团队"`（已废弃），重启，粘贴：`我想用智能体小队熟悉一下这个项目` | — | 经插件专属词照常激活；被剥离的废弃词会在激活时报告一次（本次会话内不再重复） |

**档位方案选择框内容（实际方案改造）**：`/topo` 带请求文本并选定档位后，插件先让模型
做一次性规划调用（只出方案不执行，带“正在生成智能体拓扑协作方案”进度动画），为该请求起草实际组队方案；Accept/取消 选择框随后展示
该方案，批准后以高于档位一般性指导的优先级注入。裸 `/topo`（无请求）或规划调用失败时
回退为该档位的标准方案形态——此时没有可展示的请求相关内容。
规划调用仅交互式会话生效——headless/RPC 的 `/topo <请求>` 会跳过它，直接按档位标准形态确认。

### 第 3 步 — 收尾

1. `汇报一下团队当前状态`，完工后解散团队。
2. 生成会话日志：粘贴 §7 的 prompt（写入 `sandbox/logs/session-log-<日期>.md`）。
3. 归档本轮：`bash sandbox/archive-round.sh <本轮标签>`。
4. `bash sandbox/restore-project.sh`。
5. 在 `docs/TEST-PLAN.md` 的执行记录中追加一行（日期、跑了什么、结果、异常）。

## 0. 通用：沙箱环境与还原

所有人工项都在沙箱内进行（`./sandbox/run.sh`，与真实 `~/.stepcode` 隔离）。沙箱有两类
状态，测试会同时改动两者：

| 状态 | 位置 | 还原方式 |
|---|---|---|
| 演示项目 | `sandbox/project/`（含种子 bug 的演示态） | `bash sandbox/restore-project.sh` |
| 运行时数据 | `sandbox/agent/{sessions,teams,plans,live-context}`、`sandbox/project/data/`（全部 gitignored） | 可选彻底清场，见下 |
| 会话日志 | `sandbox/logs/session-log-*.md`（按需生成，prompt 见 [sandbox/README_CN.md](../sandbox/README_CN.md#会话日志)） | `restore-project.sh` 自动删除——先跑 `archive-round.sh` 可保留 |
| 项目信任 | `sandbox/agent/trust.json`（gitignored） | 快速还原**不会**重置——删掉它可让 §3 信任弹窗重新触发 |

**快速还原（每轮测试后必做）**：

```bash
bash sandbox/restore-project.sh
# 已还原（种子 bug 就位，data/ 已清除）；演示中新建的额外文件会保留
```

**彻底清场（可选，想要全新沙箱时）**：

```bash
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

## 1. 交互 TUI 的观感（唯一保留的渲染项）

各工具渲染的**文本内容**已由 phase15 自动断言；剩下的只有像素级与交互级观感：
颜色/布局是否顺眼、toast 停留时间、`ctrl+o` 实际按键、流式进度的刷新节奏。
在沙箱交互会话里过一遍即可，无需核对具体文本。

**环境准备**：见 [TESTING_CN.md](TESTING_CN.md) §0（检出路径、`sandbox/TEST-KEY.md`
密钥、`./sandbox/run.sh`）；第 5 步起需要 key。

**使用方式**：下方每一步都是**一整行可直接复制粘贴的 prompt**——队长模型收到后会
自行调用对应的团队工具，你要做的只是核对渲染效果是否符合「预期」列。按顺序粘贴
即可；每步之间等上一步渲染完成再粘下一步。第 6 步是按键操作，不是 prompt。

**建团前核对**：激活后先要一次团队状态（`汇报一下团队当前状态` → `team_status`），
确认没有上一轮遗留的 live 成员——若有，先解散再建新成员。

| # | 复制粘贴 | 预期渲染 | 结果 |
|---|---|---|---|
| 1 | `我想用智能体小队功能熟悉一下这个沙箱项目` | 激活 notify：「Agent team plugin activated (explicit plugin mention). Team tools are now available.」；团队工具从此对模型可见 | ☐ |
| 2 | `/topo` | 团队板 notify：`Team "<id>"` + 成员行（○/●/✗ 图标 + role + status + model/effort）+ 任务行（含 blockedBy）+ `spend: $x.xxxx`；空队时提示用 team_create_member | ☐ |
| 3 | `创建一个 scout 角色的成员，名字叫 scout1` | renderCall：`team +scout1 (scout)`；renderResult：`✓ scout1 (scout) [idle] … effort=high` | ☐ |
| 4 | `再创建一个 worker 角色的成员，名字叫 worker1` | 同第 3 步的 `+worker1 (worker)` / `✓ worker1 (worker) [idle]`（为第 7 步的 pipeline 拓扑提供第二个成员） | ☐ |
| 5 | `让 scout1 用一句话介绍他自己` | renderCall：`team → scout1` + 消息预览（≤70 字符）；长 run 期间 onUpdate 流式刷新（先 "(member is working...)"，随后 interim 文本）；renderResult：用量行（`1 turn, $x.xxxx`）+ 回复正文（默认折叠 3 行，附 "(ctrl+o to expand)"） | ☐ |
| 6 | *（按键操作，非 prompt）* 在第 5 步的结果上按 `ctrl+o` | 完整正文展开；再按一次折叠回去 | ☐ |
| 7 | `把通信拓扑设置为 pipeline，然后让 scout1 跟 worker1 问个好` | renderCall：`team topology pipeline`（命名形状不传 edges，故无边数；若模型显式传了 edges 则附 ` N edge(s)`）；renderResult 头：`pipeline · 1 edge(s)`（scout1→worker1）；随后 `team → scout1` 派活成功（pipeline 方向允许） | ☐ |
| 8 | `创建一个任务：统计这个项目的源文件数量，指派给 scout1，然后启动它` | renderCall：`team task create T1 统计这个项目的源文件数量` → `team task start T1`；renderResult：`T1 [done] @scout1 统计这个项目的源文件数量` + 回复正文 | ☐ |
| 9 | `汇报一下团队当前状态` | 每成员一行（图标 + name + role + 用量），任务逐行（id [status] title，50 字符预览） | ☐ |
| 10 | `解散 worker1` | renderCall：`team −worker1`；renderResult：`worker1` | ☐ |
| 11 | *（退出）* `Ctrl+C` 两次或 `/quit` 退出沙箱会话 | 无孤儿成员进程：`pgrep -f 'team-.*-scout1'` 为空 | ☐ |

**实测记录（2026-10-19，✅ 已通过）**：用户按清单完成交互走查，**渲染方面未发现问题**；
后续仅当 `render.ts` 变更时需要重走此清单。

## 2. 真实安装写入 settings（一次性，需你执行）

`step install` 会写你的真实 settings，因此由你执行。本地路径安装是**引用式**的
（不拷贝、只记录路径，按 manifest 声明加载资源），直接安装检出副本即可：

```bash
step install ~/GitProjects/Step-Code-Agent-Team
```

**预期**：安装后新会话可激活、成员可 spawn；包只分发扩展资源（无 skill 或提示词
模板——编排协议经请求本地注入，评审工作流是 `/topo review` 命令）；
`step remove ~/GitProjects/Step-Code-Agent-Team` 可卸载。

**验证安装生效**（安装后开一个普通会话，粘贴）：

```text
用智能体小队功能介绍一下你自己
```

**卸载验证**：`step remove ~/GitProjects/Step-Code-Agent-Team`，再开会话确认团队工具不再出现。

## 3. 信任提示的交互 UX

`-a`/`-na` 的语义已自动化；剩下的是交互式信任弹窗本身：首次在带有
`.stepcode/config.toml` 的项目里启动 step 时，看一眼提示与「记住」选项即可。

**操作**（在沙箱内制造一次「首次进入带项目配置的项目」）：

```bash
mkdir -p sandbox/project/.stepcode
cat > sandbox/project/.stepcode/config.toml <<'EOF'
[stepcodeAgentTeam.activation]
enabled = true
keywords = ["智能体小队", "topo team"]
notifyOnActivate = true
EOF
./sandbox/run.sh     # 首次启动应弹信任提示；看一眼提示与「记住」选项
```

**预期**：弹出项目信任提示，有「记住/信任」类选项；信任后项目级配置生效
（激活 notify 出现即证明读取成功）。若**没有弹窗**，说明 `sandbox/project` 此前
已被信任（记录在 `sandbox/agent/trust.json`）——删掉该文件重跑即可再弹一次。

**还原**（删除该项目级配置，恢复沙箱原状）：

```bash
rm -rf sandbox/project/.stepcode
bash sandbox/restore-project.sh
```

## 4. LLM 行为遵循度（需 key，本质不可约）

服务端的确定性拒绝（拓扑越界、loop 上限、等待环）已被探针覆盖；不可约的是成员
LLM 是否「听话」——收到拒绝后转为把结论写入最终报告交回队长，而非反复重试或去排查工具。

**操作**（沙箱会话内按顺序粘贴）：

```text
用智能体小队功能做一次巡回审查：创建三个 reviewer 角色的成员 r1、r2、r3，声明 ring 拓扑，让 r1 先审查 src/tasks.js 的正确性，然后沿环把审查意见传递给下一个成员，每个成员收到上家的意见后补充自己的发现。
```

**预期**：`team_set_topology ring` 声明 3 条边；r1→r2、r2→r3 两跳成功；第 3 跳
（r3→r1）超过 `topology.maxLoopCount`（默认 2）——成员**不发起**该跳（预判会被拒），
或发起后被 server 拒绝并得到含允许邻居与「state it in your final report」的错误；两种形态下
成员都应把结论写入最终报告交回队长（leader 不是消息目标），而不是反复重试同一跳、也不是转去排查环境/工具。

**实测记录（2026-10-19，✅ 已通过）**：ring 两跳接力成功（链长恰好用满上限）；
reviewer-3 未尝试第三跳、直接输出汇总报告沿回复链返回——「不尝试 + 汇报」形态的
LLM 遵循度证实（服务端拒绝本身已由 phase14 探针覆盖）。

**通过标准**：团队成员最终把「第 3 跳被拒/未发起」作为结论汇报给队长；队长能据此收尾。
成本护栏的**发射逻辑**已由 phase16 覆盖；想在真实累积花费下眼见为实可选做
（`STEPCODE_TEAM_COST_WARN=0.0001` 启动沙箱，观察 `team_status` 的告警行）。

**还原**：`bash sandbox/restore-project.sh`（+ 可选彻底清场，见 §0）。

## 5. 沙箱演示剧本（✅ 2026-10-19 三幕均已实测通过）

`./sandbox/run.sh` 启动，**每幕前** `bash sandbox/restore-project.sh` 还原。
属体验验证，非正确性验证。

**实测记录（2026-10-18）**：`/topo <请求>` 驱动 7 成员团队完整跑通两幕——
pipeline 修复链（scout 定位种子 bug → planner 出最小方案 → worker 修复 →
reviewer 通过）+ star 三方并行审查（正确性/风格通过；安全项留下加固建议，
属演示项目自身的可选项）。队长复核：`npm test` 12/12（修复前基线 11/12——套件已在 2026-10-20 卫生轮由 8 条扩至 12 条）、与
`project-pristine` 逐文件比对仅 `src/tasks.js` 有差异、`secret-sample.txt`
全程未被任何成员读取。第三幕（ring 巡回）与安全加固待用户定夺。

**实测记录（2026-10-19 复跑）**：三幕全部复测——pipeline 修复链 12/12 通过且
reviewer 出具 APPROVE（注意 reviewer 预设只读、无 shell，只能静态审查，`npm test`
由队长自行复核，设计使然）；star 三方并行审查产出分级发现清单（针对演示代码，
M1/M2 已修复，其余记录于 `docs/TEST-PLAN_CN.md` 第八节）；ring 巡回两跳接力
成功、第三跳按协议规避（详见 §4 与下方第三幕）。

### 第一幕 · pipeline 修复链（复制粘贴）

```text
/topo 请用智能体小队修复这个项目里失败的测试：先派 scout 定位失败的测试和根因，再派 planner 给出最小修复方案，然后派 worker 按方案修复并跑通 npm test，最后派 reviewer 审查改动。修复前先确认 npm test 的基线结果。
```

**预期**：任务板 T1→T4 按 blockedBy 流转；worker 修复后 `npm test` 12/12；
与 `project-pristine` 逐文件比对仅 `src/tasks.js` 有差异；`secret-sample.txt`
全程未被任何成员读取。（reviewer 预设只读：审查结论为静态 trace，`npm test`
由队长实跑复核。）**幕间还原**：`bash sandbox/restore-project.sh`。

**基线坑位（2026-10-22 实测）**：若同一沙箱内早前的请求已修掉种子 bug，Act 1
开始前 `npm test` 就是 12/12，“修复失败的测试”前提不再成立——先执行
`bash sandbox/restore-project.sh` 复位。若队长发现前提不符后向你询问
（clarify_user）或改为只读复核，属正确行为，不是缺陷。

### 第二幕 · star 并行审查（复制粘贴）

```text
/topo 请用智能体小队并行审查这个项目：派三名 reviewer 分别从正确性、风格、安全性三个角度审查 src/ 与 test/，把三方发现汇总成一份清单。
```

**预期**：三名成员并行工作（`team_status` 可见并发）；队长汇总三方发现
（针对演示代码的发现清单记录于 `docs/TEST-PLAN_CN.md` 第八节）。
**幕间还原**：`bash sandbox/restore-project.sh`。

### 第三幕 · ring 巡回审查（复制粘贴，✅ 2026-10-19 已实测）

```text
/topo 请用智能体小队做一次巡回审查：创建三名 reviewer 成员，声明 ring 拓扑，让审查意见沿环传递，每人补充上家遗漏的问题，注意环的巡游长度上限。
```

**实测（2026-10-19）**：队长按工具描述自觉为成员配备 bash 消息通道（上轮修复生效）；
r1→r2→r3 两跳接力成功（链长恰好用满 `maxLoopCount=2`）；reviewer-3 未尝试第三跳，
直接输出汇总报告沿回复链返回。

**已知运行时现象（嵌套链超时）**：队长侧 `team_send` 的等待超时
（`dispatch.timeoutMs`，默认 600s）覆盖**整条嵌套接力链**——reviewer 链超过该
值时，队长侧超时返回，而接力仍在服务器侧继续（被派发成员已按失败即杀语义回收；
错误信息会提示接力可能仍在途并列出成员状态）。失败的任务携带收割指引：成员的
上下文可能已包含成果，应改派短收割 prompt（如「汇报你目前已完成的内容」）而非
重跑任务——自动重试会重复工作。要避免超时：会话前在 `sandbox/config.toml`
调大 `dispatch.timeoutMs`（配置只在会话启动时读取一次）。

**等待期间的进度信号**：长派发会把成员的 interim 文本流式送入工具结果
（`team_send` / `team_task start` 转发 `onUpdate`），`team_status` 则展示每个
成员的实时状态——用它们区分"合法的长审查"与"卡死"，不必干等超时。

**收尾还原**：`bash sandbox/restore-project.sh`。

## 6. 性能主观项

8 成员满编时的 spawn 握手延迟、TUI 响应速度——主观，无判定标准。

**操作**（可选）：粘贴 `用智能体小队并行审查这个项目，尽量让更多成员同时开工`，
观察 8 成员满编时的握手耗时与 TUI 刷新是否可接受。**还原**：见 §0。

## 7. 会话日志（记录每轮人工测试）

每轮人工测试结束后，粘贴下面这条 prompt 让队长生成记录（写入
`sandbox/logs/session-log-<日期>.md`，gitignored；同一 prompt 亦见
[sandbox/README_CN.md](../sandbox/README_CN.md#会话日志)）：

```text
请把本 session 的团队协作过程记录到 sandbox/logs/session-log-<今天日期>.md，结构：
（1）头部——日期、主模型、工作目录、团队框架、安全护栏遵守情况；
（2）用户 Prompt 逐字摘录；（3）小队名册表——成员/角色/职责/工具/effort；
（4）按执行顺序的各阶段——拓扑声明、派活方式、成员产出要点；异常实况
（如 topo_team_msg 被拒）必须引用工具返回的原文，不得凭记忆转述；
（5）净结果——基线对比、改动文件清单、未做的事；（6）还原方式。
```

## 已知限制（审查确认，暂不修）

- **失败即杀语义**：任何派发失败都会杀掉成员进程并在下次派发时重启（防止同一
  session-id 上新旧 run 交错，见 docs/TESTING-OPTIMIZATION-PLAN.md P0-2）；
- **项目级配置每会话只应用一次**：信任在启动时解析，运行中授予信任不会补应用；
- **registry 版本不匹配即重建**：`schemaVersion !== 1` 时按新团队覆盖旧数据；
- **纯逻辑探针须独立运行**：phase15/16 传递导入 `@step-harness/pi-tui` 会触发
  step 对仓库包的暂存加载，与 `-e` 原始副本冲突——runner 的 `STANDALONE_PHASES`
  机制不挂载 index.ts（见 run-smoke.sh 注释）；
- **depth≥3 未做真实 LLM 链测试**（进程级自举已验证）。
