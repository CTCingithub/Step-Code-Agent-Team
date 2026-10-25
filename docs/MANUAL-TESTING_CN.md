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
> 扩展并激活）、**工具可用性自愈**（phase22：`ensureToolsAvailable` 在宿主侧重置后恢复团队工具，
> `session_start` 重激活团队注册表已存在的会话）、**工具 JSON-schema 契约**（phase23：
> 每个团队工具与每个顶层参数都带非空 description——本可抓住 typebox 双参 Optional
> description 丢失的守卫）、**确认路径合并契约**（phase24：假 ExtensionAPI + 脚本化
> ctx 驱动真实扩展工厂——Accept 原样转发请求并注入方案指令、自定义输入 note 原样合并、
> 空提交按原样接受、Cancel 仅注入激活指令，共 6 断言）、**激活护栏的句子锚定**
> （phase6：带请求主体的 how-to 请求激活、对插件本身的纯提问仍抑制）、**预设加载与
> 项目层信任门控**（phase3）与**废弃关键词剥离语义**（phase6/phase9）。
>
> 以下仅剩**不可约**的人工项。先看下方**单轮测试 runbook** 获取一轮完整顺序；其余各节是
> 分场景明细，均含**可直接复制粘贴的命令 / prompt**。TUI 渲染清单（只剩观感；内容层已被
> phase15 断言）见第 1 节。

## 状态总览（2026-10-23）

> 自动化基线 2026-10-25 复核：冒烟 20 phase + manifest + 7 live + orphan-check 全绿；LLM 探针 22/22（K8，plan-101 于含自由输入与 settle 重试的代码上复跑）。

| # | 项目 | 状态 |
|---|---|---|
| 1 | 交互 TUI 观感 | ✅ 2026-10-22 完整走查 + 2026-10-25 复测通过（渲染无问题；见归档 `sandbox/archive/20261025-194159-20261025-manual-round/`） |
| 2 | M1 真实安装/卸载（干净导出物 `step install`） | ➖ **必做人工项**——写的是你的真实 settings，必须由你本人执行；机制部分已由 `live-package-install` / `live-clean-export` 覆盖；交互残留 ⬜ 待用户执行（§2） |
| 3 | M2 信任弹窗交互 UX | ➖ **必做人工项**；拒绝路径已由 `live-untrusted-config` 覆盖；弹窗本身 ⬜ 待用户执行（§3） |
| 4 | LLM 行为遵循度（ring） | ✅ 2026-10-22 + 2026-10-25 两轮确认（两跳成功 + 第三跳被 maxLoopCount 拦下并原文引用） |
| 5 | 沙箱演示剧本（三幕） | ✅ 2026-10-22 + 2026-10-25 两轮复测通过（修复轮 11/12→12/12、两轮并行审查零改动） |
| 6 | 性能主观项（8 成员满编） | ➖ 可选，主观无判定标准 |
| 7 | 实际方案三选项确认框（Accept / 自定义输入… / Cancel）+ 生成进度动画（新 UI） | ➖ 2026-10-25 轮次已实测走通（三档 Accept 路径）；**自定义输入路径与固定档已于 2026-10-25 由 RPC 驱动探针 live 验证**（`node sandbox/probe-remaining-manual.mjs 5a` / `5b`：用户文本原样进入转发请求、钉档后选单不出现）；剩余仅 TUI 按键观感 ⬜（M3：无倒计时/Esc/空提交） |
| 8 | 激活护栏 L1（2026-10-23 重写） | ✅ phase6 八条用例全绿 + **2026-10-25 RPC 驱动 live 验证通过**（`probe-remaining-manual.mjs 7`：元问题零团队动作、how-to 带主体激活且 team_create_member 真实可用） |
| 9 | 自定义角色（agentDir 层 + 信任项目层） | ➖ phase3 覆盖加载与信任门控 + **2026-10-25 live 验证通过**（`probe-remaining-manual.mjs 8`：frontmatter tools/effort/prompt 落到真实 spawn、成员自报白名单含 topo_team_msg）；项目级层仍需 M2 信任流 ⬜ |
| 10 | 旧关键词迁移提示 | ✅ phase6/phase9 覆盖剥离语义 + **2026-10-25 live 验证通过**（`probe-remaining-manual.mjs 9`：迁移提示每会话恰好出现一次） |
| — | 英文版文档译文审阅 | ⬜ 建议过目 |

## 单轮测试 runbook（一轮完整测试）

一轮测试的完整顺序——本文档其余章节都是其中某一步的明细。所有命令与 prompt 均可直接复制粘贴。

### 第 0 步 — 预检（启动会话前）

```bash
# 先归档上一轮的证据——restore 会清空 logs/（删前已自动归档，但 archive-round.sh 还会保存 restore 不碰的 session JSONL 与团队注册表，且标签可读）
bash sandbox/archive-round.sh <上一轮标签>
# 还原沙箱：种子 bug 复位，data/ 与 logs/ 清空
bash sandbox/restore-project.sh
```

密钥：写入 `sandbox/TEST-KEY.md`（gitignored）即可——`./sandbox/run.sh` 会自动读取
（环境里已 export 的 `STEP_API_KEY` 优先）。§1 第 5 步起需要 key；没有 key 这些步骤会失败。

### 第 1 步 — 自动化门（任何人工操作前必须全绿）

```bash
npm run smoke   # 20 phase + manifest + 7 个 live 检查（+ orphan-check）；任何失败先停下修复
```

### 第 2 步 — 交互场景（按顺序，一次粘贴一条）

**两条激活路径——每条 prompt 只用其一，勿混用**：**`/topo` 斜杠命令**（请求作为其参数）或**提示词触发**（含插件关键词的自然语言）。§5 演示三幕走命令路径；§1 步骤 1 与场景 7/8/9 测关键词路径。把 `/topo` 和关键词措辞写进同一条 prompt，两条路径都测不干净。

| # | 场景 | 操作 | 明细 | 注意 |
|---|---|---|---|---|
| 1 | 激活 + 团队板 | §1 第 1–2 步 | §1 | — |
| 2 | 建成员 + pipeline + 任务板 | §1 第 3–8 步 | §1 | — |
| 3 | `topo_team_msg` E2E | 粘贴：`让 scout1 通过 topo_team_msg 给 worker1 发一条一句话自我介绍，并原样报告工具的返回文本` | §1、§4 | 回复为尽力语义：投递回执（"Delivered to …"）不是队友的答复——产出经队长收集 |
| 4 | ring 快巡（小步快跑） | §4 的 ring prompt | §4 | 每一跳保持小工作量（一个文件一个问题），使每跳都能在 600s 默认 `dispatch.timeoutMs`（覆盖成员整回合，含嵌套中继）内 settle——且超时不再触发盲目重试：任务会带着收割指引失败。只跑一圈；最终清单由队长收集。**环内闭环**：默认 `maxLoopCount=2` 下，3 成员环的闭环跳（r3→r1）必被拦下——闭环须由队长中转；确需环内闭环再调高 `maxLoopCount` |
| 5 | 方案选单 / 固定档 | 在 `sandbox/config.toml` 开启，**重启会话**，再 `/topo <请求>` | §8（TEST-PLAN K2/K3） | `plan.enabled` / `plan.tier` 每会话只读一次——启动前改好配置；确认框提供 **Accept / 自定义输入… / Cancel** 三选项、无倒计时、等待你决定——自定义输入的文本原样发送给模型并追加到转发的请求后（Esc 取消） |
| 6 | 并行评审 | `/topo review src/tasks.js` | TEST-PLAN K4 | — |
| 7 | 激活护栏（L1） | 粘贴：`如何用智能体小队并行审查这个仓库？` | §9 | 2026-10-23 重写：带请求主体的 how-to 请求会激活插件（正常组队）；对插件本身的纯提问（`什么是智能体小队？`）仍被抑制——不组队 |
| 8 | 自定义角色（K6） | 写 `sandbox/agent/agents/quickfix.md`（frontmatter：`name`/`description`/`tools`/`effort`），重启，粘贴：`创建一个 quickfix 角色的成员，取名 fixer1，让它用一句话列出自己的工具白名单` | §10 | frontmatter 的 prompt/tools/effort 生效（工具列表即白名单）；项目级角色 `sandbox/project/.stepcode/agents/` 仅在信任的项目加载（删 `sandbox/agent/trust.json` 可重触发弹窗） |
| 9 | 旧关键词迁移提示（K7） | 在 `sandbox/config.toml` 的 `keywords` 中于插件专属词旁加 `"智能体团队"`（已废弃），重启，粘贴：`我想用智能体小队熟悉一下这个项目` | §11 | 经插件专属词照常激活；被剥离的废弃词会在激活时报告一次（本次会话内不再重复） |

**必做人工项（M1/M2）**：真实安装/卸载（§2——写的是你的真实 settings，必须由你本人
执行）与项目配置信任弹窗（§3）为**必做**人工项而非可选项；§2/§3 内容维持不变，
此处标注其必做属性——缺项不计一轮完整。

**档位方案选择框内容（实际方案改造）**：`/topo` 带请求文本并选定档位后，插件先让模型
做一次性规划调用（只出方案不执行，带“正在生成智能体拓扑协作方案”进度动画），为该请求起草实际组队方案；三选项选择框（Accept / 自定义输入… / Cancel）随后展示
该方案，批准后以高于档位一般性指导的优先级注入。裸 `/topo`（无请求）或规划调用失败时
回退为该档位的标准方案形态——此时没有可展示的请求相关内容。
规划调用仅交互式会话生效——headless/RPC 的 `/topo <请求>` 会跳过它，直接按档位标准形态确认。
确认框提供三个选项：**Accept**（按所示方案组队）、**自定义输入… / Custom input…**（你自己的文本原样发送给模型——不作解释——追加到转发的请求后；空提交=按原样接受）、
**Cancel**（请求仍会转发，但只注入激活指令——不组队）。

**派发异常与恢复（来自 2026-10-24 沙箱轮）**：

- **settle 超时**：派发可能报 `timeout waiting for member to settle`——成员被 fail-fast 杀死，但其工作通常在服务端继续（或下次派发时带上下文恢复）。settle 超时现在会自动重试一次，但仅当成员 usage 证明该次尝试什么都没做（turns 为 0——usage 服务端持久化）时才重试，绝不重复计费；有真实工作的超时仍会报错，恢复为手动：查 `team_status` 后重派（发一条"收尾并报告"的短消息即可），成果不丢。
- **spawn/handshake 类失败会自动重试一次**：成员握手失败（或 `aborted before start`）在 `createMember` 与任务派发内会自动重试——上面"不盲目重试"的规则只针对 settle 超时，不针对 spawn 路径失败。
- **failed 板任务可重派**：成员中途被杀的任务保持 `failed`；对其 `team_task start` 会重派且成员带上下文恢复——无需重建 `blockedBy` 链（此前轮次正是被此死锁逼出"建等价任务"的变通）。start 时传入的 `detail` 会追加进派发 prompt，收割提示可直接随行。
- **`topo_team_msg` 的成员自报不可靠**：成员对实际已投递的消息既报过"投递成功"也报过"工具不可用"。信任任何一侧之前，先在 `sandbox/agent/teams/<teamId>/sessions/*.jsonl` 里核实是否存在该工具调用。
- **板 id 以 `create` 的返回为准**，不按你方案里的编号——`blockedBy` 未知 id 会被拒绝并列出 offending id。
- **预设随包发布**（`agents/<role>.md`：scout/planner/worker/reviewer），沙箱内同样可用——传 `role:` 即可继承预设的只读工具与 effort，无需手搓 systemPrompt；显式传入但无匹配预设时，create 结果会给出提示。

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
| 会话日志 | `sandbox/logs/session-log-*.md`（按需生成，prompt 见 [sandbox/README_CN.md](../sandbox/README_CN.md#会话日志)） | `restore-project.sh` 会清空（删前已自动归档）；先跑 `archive-round.sh` 可另行保留 session JSONL 与团队注册表 |
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
| 1 | `我想用智能体小队功能熟悉一下这个沙箱项目` | 先弹 L2 确认框「检测到团队请求关键词，是否启用智能体团队？」（`confirmBeforeActivate` 默认开，见 CONFIGURATION_CN）→ 选是 → 激活 notify：「Agent team plugin activated (explicit plugin mention). Team tools are now available.」；团队工具从此对模型可见 | ☐ |
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
/topo 修复这个项目里失败的测试：先派 scout 定位失败的测试和根因，再派 planner 给出最小修复方案，然后派 worker 按方案修复并跑通 npm test，最后派 reviewer 审查改动。修复前先确认 npm test 的基线结果。
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
/topo 并行审查这个项目：派三名 reviewer 分别从正确性、风格、安全性三个角度审查 src/ 与 test/，把三方发现汇总成一份清单。
```

**预期**：三名成员并行工作（`team_status` 可见并发）；队长汇总三方发现
（针对演示代码的发现清单记录于 `docs/TEST-PLAN_CN.md` 第八节）。
**幕间还原**：`bash sandbox/restore-project.sh`。

### 第三幕 · ring 巡回审查（复制粘贴，✅ 2026-10-19 已实测）

```text
/topo 做一次巡回审查：创建三名 reviewer 成员，声明 ring 拓扑，让审查意见沿环传递，每人补充上家遗漏的问题，注意环的巡游长度上限。
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

## 8. 场景 5 — 方案选单：自定义输入（5a）与固定档（5b）

两个子场景共用同一条前置链：`sandbox/config.toml` 的 `[stepcodeAgentTeam.plan] enabled = true`（种子沙箱默认已开）、**重启会话**（`plan.enabled` / `plan.tier` 每会话只读一次——启动前改好配置）、**交互式 TUI**（`./sandbox/run.sh`）。规划调用仅交互式生效——headless/RPC 的 `/topo <请求>` 会跳过它、直接按档位标准形态确认，因此无对话框的一轮证明不了 5a 的任何东西。

### 5a · 自定义输入路径（最高优先）

**测什么**：完整对话框链——`/topo <请求>` → 档位选单（四档 + 自定义需求…）→「正在生成智能体拓扑协作方案」进度动画（一次性、只出方案的模型调用）→ 三选项确认框（Accept / 自定义输入… / Cancel）——重点是「自定义输入…」分支：你的自由文本必须**原样**到达模型——trim 后以空行追加到转发的请求后，不作解释、不结构化。

**前置条件**：`sandbox/config.toml` 的 `plan.enabled = true`；改完配置重启会话；交互式 TUI；全新会话（先解散遗留 live 成员——`汇报一下团队当前状态`）。

**操作**（先粘贴一行，再走对话框）：

```text
/topo 修复这个项目里失败的测试
```

1. 档位选单里任选一档（如 均衡/balanced）。
2. 等进度动画结束——起草的方案展示在确认框上方的 notify 里。
3. 三选项确认框里选 **自定义输入… / Custom input…**（无倒计时——等你决定）。
4. 自由文本输入框里输入一句话，例如：

```text
优先保持改动最小：只修 src/tasks.js，不要动其他文件。
```

**预期**：插件把原始请求**连同你那句话原样**作为一条 user 消息转发，模型两者都会顾及。核对会话 JSONL：文本与你输入的完全一致（仅去除首尾空白）、以空行追加——队长会话 `sandbox/agent/sessions/*.jsonl` 里有转发的 user 消息；成员派活后，`sandbox/agent/teams/<teamId>/sessions/*.jsonl` 里是由其派生的派发 prompt。另各验证一次两个姊妹分支：**空提交**=按所示方案接受（不追加任何内容）；**Esc**（在选单或输入框上）=取消——请求仍转发，但只注入激活指令、不组队。

**自动化覆盖**：phase24 用假 ExtensionAPI + 脚本化 ctx 驱动完整确认链，断言合并契约（6 断言：Accept 原样转发请求并注入方案 / 自定义输入 note 原样合并 / 空提交按原样接受 / Cancel 仅注入激活指令）。

**live 验证（2026-10-25，RPC 驱动探针）**：`node sandbox/probe-remaining-manual.mjs 5a` 以脚本化 RPC 客户端走完整链路——应答档位选单（均衡）→ 进度动画与模型起草的方案 → 三选项确认框选「自定义输入…」→ 输入 `只要 1 个只读成员，不要修改任何文件`。会话 JSONL 里转发的 user 消息为「原始请求 + 空行 + 该文本」（逐字一致，仅去首尾空白），随后模型正常调用 `team_create_member`。「文本原样到达模型」已在**真实宿主对话框 + 真实 LLM 往返**上成立；探针覆盖不到的只剩 TUI 像素与按键观感（Esc/空提交/无倒计时，归 M3）。

**为何必须人工**：对话框是宿主渲染的 TUI（phase24 只是脚本化），且「文本原样到达模型并被采纳」只有真实模型回合才能端到端观察。

**还原**：`bash sandbox/restore-project.sh`（+ 可选彻底清场，见 §0）。

### 5b · 固定档（K3）

**测什么**：`plan.tier` 钉档后档位选单不再出现——钉住的档位在**两条**激活路径（`/topo` 命令与提示词触发）上都生效。

**前置条件**：`sandbox/config.toml` 设 `[stepcodeAgentTeam.plan] tier = "fast"`（保留 `enabled = true`），**重启会话**，交互式 TUI。

**操作**（两条独立 prompt——一条路径一次，勿混用）：

```text
/topo 统计这个项目的源文件数量
```

然后走关键词路径，重新激活（新开会话，或等上一轮 settle 后）：

```text
用智能体小队统计一下这个项目的源文件数量
```

**预期**：两条路径都不弹档位选单——各自直接进入 fast 档。**钉档即「别再问」：选单、进度动画、三选项确认框在两条路径上一律不出现**（2026-10-25 修复：此前命令路径钉档后仍会弹确认框，与关键词路径不一致）；请求原样转发，fast 档指令注入。任何时刻都不应出现 "always ask" 选单。

**自动化覆盖**：phase21 断言档位表本身（四档、五种模式、双语标签、未知 id 回退）；phase24 经 resetConfigCache 钩子切换 `plan.enabled` 驱动确认路径。

**live 验证（2026-10-25，修复后复跑）**：`probe-remaining-manual.mjs 5b` 把 `plan.tier` 钉为 `"fast"` 后走 `/topo <请求>`——档位选单**不出现**、三选项确认框**也不出现**（双负向断言通过，请求原样转发）。命令路径已 live 验证；关键词路径的钉档注入沿用同一配置读取，留作一轮人工抽查即可。

**为何必须人工**：「选单/确认框不出现」是负向 UI 观察，只有真实会话能判定；且两条激活路径共用配置但不同代码路径——须各跑一次。

**还原**：把 `sandbox/config.toml` 的 `tier` 改回 `"always ask"`，再 `bash sandbox/restore-project.sh`。

## 9. 场景 7 — 激活护栏（L1）

**测什么**：句子锚定的误报护栏——命中关键词但属真实用法请求的，激活插件并组队；对插件本身的纯提问则被抑制。

**前置条件**：全新会话、未激活态（重启沙箱会话；勿复用团队工具已启用的会话）。只走关键词路径——这些 prompt 里切勿混入 `/topo`。

**操作**（全新会话内逐条粘贴）：

```text
如何用智能体小队并行审查这个仓库？
```

```text
什么是智能体小队？
```

**预期**：第一条激活——先弹 L2 确认框（选是）→ 出现激活 notify、团队工具可用、队长组队并派发并行审查。第二条被抑制——无确认框、无激活 notify、无团队工具、不组队；模型只回答这个关于插件本身的问题。

**live 验证（2026-10-25）**：`probe-remaining-manual.mjs 7` 跑两条隔离会话——「什么是智能体小队？」无激活 notify 且**零**团队工具调用（PASS）；「如何用智能体小队并行审查这个仓库？」应答确认框后激活，随后的「创建一个 scout 角色的成员」产出真实 `team_create_member` 调用（PASS）。

**自动化覆盖**：phase6 锚定八条句子级用例（带请求主体的 how-to 激活；纯 how-to 提问抑制；否定与文档/代码引用抑制；子句分隔的否定仍激活）。缺口：真实模型那一端——激活的 how-to 请求是否真的产出团队，被抑制的元问题是否真的毫无团队动作。

**为何必须人工**：护栏只决定*是否*激活；可观察结果（notify + 团队工具 + 组队，或全无）只存在于真实会话。

**还原**：`bash sandbox/restore-project.sh`（+ 可选彻底清场，见 §0）。

## 10. 场景 8 — 自定义角色（K6）

**测什么**：`<agentDir>/agents/` 下的用户层预设——以该角色建成员时其 frontmatter（`name`/`description`/`tools`/`effort`）生效；以及项目层预设仅在信任的项目加载。

**前置条件**：交互式 TUI；写完预设文件后重启会话（预设在启动时加载）。

**操作**：

```bash
mkdir -p sandbox/agent/agents
cat > sandbox/agent/agents/quickfix.md <<'EOF'
---
name: quickfix
description: 快速最小修复——只读诊断加一处定点修改
tools: ["read", "edit", "grep"]
effort: low
---
你是 quickfix 角色：诊断尽可能小的修法，只做一处定点修改，并用一句话汇报改动。不得为修复之外的目的重构。
EOF
# 重启沙箱会话，然后粘贴：
```

```text
创建一个 quickfix 角色的成员，取名 fixer1，让它用一句话列出自己的工具白名单
```

**预期**：`team_create_member(role="quickfix")` 应用该预设——create 结果与成员的一句话回答显示 frontmatter 里的白名单（`read`/`edit`/`grep`）**外加基础设施 `topo_team_msg`**（它叠加在每个成员的工具列表之上，无需 bash）。

**坑位（设计行为）**：沙箱 `sandbox/config.toml` 设了 `models.autonomousEffort = true`，此时**所有** frontmatter/预设 effort 一律失效——effort 由队长逐成员选择，`effort: low` 被忽略，create 结果显示 `effort=high`。要验证 frontmatter effort 真的生效，把 `autonomousEffort` 改 `false`、重启会话再跑——那时会显示 `effort=low`。这是成文行为（见 [CONFIGURATION_CN.md](CONFIGURATION_CN.md) `models.autonomousEffort`），不是缺陷。

**项目级角色**：`sandbox/project/.stepcode/agents/` 下的预设仅在项目受信任时加载——删 `sandbox/agent/trust.json` 并重启可重触发 §3 信任弹窗；信任授予前项目层整体跳过。

**自动化覆盖**：phase3 断言三层预设加载（包内 `agents/` < `<agentDir>/agents/` < 信任项目层）与信任门控（不可信项目的预设绝不加载）。

**live 验证（2026-10-25）**：`probe-remaining-manual.mjs 8` 在隔离 agentDir 写 quickfix.md（`tools: read, grep, edit, bash`、`effort: low`，并把 `models.autonomousEffort` 置 `false`）后经 `/topo` 建成员——create 结果为 `Created member "fixer1" (role: quickfix) … effort: low; tools: read, grep, edit, bash`，成员自报「read、grep、edit、bash、topo_team_msg」，与「frontmatter 白名单 + 基础设施叠加」规则完全一致。

**为何必须人工**：预设应用发生在派生成员进程内的真实模型回合上；白名单与 effort 只在成员的实际行为里可见。

**还原**：删除 `sandbox/agent/agents/quickfix.md`（及任何项目层预设），再 `bash sandbox/restore-project.sh`。

## 11. 场景 9 — 旧关键词迁移提示（K7）

**测什么**：`activation.keywords` 里的废弃词在加载时被剥离，激活经插件专属词照常进行，且剥离行为**每会话报告一次**。

**前置条件**：交互式 TUI；改完配置重启会话（keywords 每会话只读一次）。

**操作**：

```bash
# 在 sandbox/config.toml 中于插件专属词旁加上废弃词：
#   keywords = [ "智能体团队", "智能体小队", "多智能体小队", "topo team", ... ]
# 然后重启会话并粘贴：
```

```text
我想用智能体小队熟悉一下这个项目
```

**预期**：迁移提示出现一次——「Migrated activation config: removed deprecated keywords (智能体团队). Use current keywords like 智能体小队 / topo team.」（session_start 时交付，重启后、粘 prompt 前即可看到）。该 prompt 随后经插件专属词 `智能体小队` 照常激活并组队。同一条再发一次：提示不再重复（每会话只消费一次），激活照常。

**自动化覆盖**：phase6/phase9 断言剥离语义（部分废弃的列表保留其余；全废弃的列表禁用关键词激活——迁移只收窄、不扩大激活面）。缺口：真实会话里一次性、用户可见的 notify。

**live 验证（2026-10-25）**：`probe-remaining-manual.mjs 9` 连发两条相同 prompt——迁移提示恰好出现一次、第二次不再出现（PASS）。「恰好一次」已在真实重启+重发循环上验证。

**为何必须人工**：该提示是宿主 `ctx.ui.notify`；其像素形态与停留时间仍属观感项（M3/M4）。

**还原**：从 `sandbox/config.toml` 的 `keywords` 删去 `"智能体团队"`，再 `bash sandbox/restore-project.sh`。

## 已知限制（审查确认，暂不修）

- **失败即杀语义**：任何派发失败都会杀掉成员进程并在下次派发时重启（防止同一
  session-id 上新旧 run 交错，见 docs/TESTING-OPTIMIZATION-PLAN.md P0-2）；
- **项目级配置每会话只应用一次**：信任在启动时解析，运行中授予信任不会补应用；
- **registry 版本不匹配即重建**：`schemaVersion !== 1` 时按新团队覆盖旧数据；
- **纯逻辑探针须独立运行**：phase15/16 传递导入 `@step-harness/pi-tui` 会触发
  step 对仓库包的暂存加载，与 `-e` 原始副本冲突——runner 的 `STANDALONE_PHASES`
  机制不挂载 index.ts（见 run-smoke.sh 注释）；
- **depth≥3 未做真实 LLM 链测试**（进程级自举已验证）。
