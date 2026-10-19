# TUI 人工验证清单

> `render.ts`（renderCall / renderResult）的**渲染内容**已由 phase15 探针在 headless 下
> 断言（六工具的 call/result 字符串、折叠/展开、用量行、状态图标）；本清单只剩**观感与
> 交互**（颜色/布局、toast 停留、ctrl+o、流式节奏）。全部在沙箱内进行，与真实
> `~/.stepcode` 隔离；涉及模型调用，先导出测试 key（只经环境变量传递）。
>
> **验证记录（2026-10-18）**：`/agent-team <请求>` 全链路已在真实 TUI 实测通过——
> 激活、团队板、参数转发、7 成员双拓扑（pipeline + star）团队实跑、任务板
> T1→T4 流转均正常（详见 MANUAL-TESTING.md §5 实测记录）；下方未打勾的观感项
> 仍待逐项过目。

## 0. 环境准备（复制粘贴）

```bash
cd <本仓库的检出路径>          # 例如 cd ~/GitProjects/Step-Code-Agent-Team
export STEP_API_KEY="$(grep -m1 '^STEP_API_KEY=' local/test-api-key.md | cut -d= -f2)"
./sandbox/run.sh               # 在 sandbox/project 中启动 step，已加载本扩展
```

`run.sh` 会把 agentDir/session/plan 指向 `sandbox/agent/*`、cwd 指向
`sandbox/project`，与真实 `~/.stepcode` 完全隔离。没有 key 时成员派活会失败，
本清单第 5 步起需要 key。

## 1. 使用方式

清单每一步都是**一整行可直接复制粘贴的 prompt**：队长模型收到后会自行调用对应的
团队工具，你要做的只是核对渲染效果是否符合「预期」列。按顺序粘贴即可；每步之间
等上一步渲染完成再粘下一步。第 6 步是按键操作，不是 prompt。

## 2. 清单（按顺序粘贴）

| # | 复制粘贴 | 预期渲染 | 结果 |
|---|---|---|---|
| 1 | `我想用智能体团队功能熟悉一下这个沙箱项目` | 激活 notify：「Agent team plugin activated (explicit plugin mention). Team tools are now available.」；团队工具从此对模型可见 | ☐ |
| 2 | `/agent-team` | 团队板 notify：`Team "<id>"` + 成员行（○/●/✗ 图标 + role + status + model/thinking）+ 任务行（含 blockedBy）+ `spend: $x.xxxx`；空队时提示用 team_create_member | ☐ |
| 3 | `创建一个 scout 角色的成员，名字叫 scout1` | renderCall：`team +scout1 (scout)`；renderResult：`✓ scout1 (scout) [idle] … thinking=high` | ☐ |
| 4 | `再创建一个 worker 角色的成员，名字叫 worker1` | 同第 3 步的 `+worker1 (worker)` / `✓ worker1 (worker) [idle]`（为第 7 步的 pipeline 拓扑提供第二个成员） | ☐ |
| 5 | `让 scout1 用一句话介绍他自己` | renderCall：`team →scout1` + 消息预览（≤70 字符）；长 run 期间 onUpdate 流式刷新（先 "(member is working...)"，随后 interim 文本）；renderResult：用量行（`1 turn, $x.xxxx`）+ 回复正文（默认折叠 3 行，附 "(ctrl+o to expand)"） | ☐ |
| 6 | *（按键操作，非 prompt）* 在第 5 步的结果上按 `ctrl+o` | 完整正文展开；再按一次折叠回去 | ☐ |
| 7 | `把通信拓扑设置为 pipeline，然后让 scout1 跟 worker1 问个好` | renderCall：`team topology pipeline`（命名形状不传 edges，故无边数；若模型显式传了 edges 则附 ` N edge(s)`）；renderResult 头：`pipeline · 1 edge(s)`（scout1→worker1）；随后 `team →scout1` 派活成功（pipeline 方向允许） | ☐ |
| 8 | `创建一个任务：统计这个项目的源文件数量，指派给 scout1，然后启动它` | renderCall：`team task create T1 统计这个项目的源文件数量` → `team task start T1`；renderResult：`T1 [done] @scout1 统计这个项目的源文件数量` + 回复正文 | ☐ |
| 9 | `汇报一下团队当前状态` | 每成员一行（图标 + name + role + 用量），任务逐行（id [status] title，50 字符预览） | ☐ |
| 10 | `解散 worker1` | renderCall：`team −worker1`；renderResult：`worker1` | ☐ |
| 11 | *（退出）* `Ctrl+C` 两次或 `/quit` 退出沙箱会话 | 无孤儿成员进程：`pgrep -f 'team-.*-scout1'` 为空 | ☐ |

## 3. 收尾：会话日志（可选）与沙箱还原

想留下本次验证的过程记录时，先粘贴下面这条 prompt 让队长生成日志：

```text
请在仓库的 sandbox/ 目录（不是 sandbox/project）中创建日志文件 session-log-<今天日期>.md，记录本 session 的用户 prompt、你的工作记录与各成员的回复内容
```

随后还原沙箱。演示/验证会改动 `sandbox/project/`（成员可能修复种子 bug）并产生会话、团队注册表等
运行时状态。按需选择：

**快速还原（每轮验证后必做）**——还原演示项目到种子 bug 状态、清除运行时数据：

```bash
bash sandbox/restore-project.sh
```

**彻底清场（可选，想要全新沙箱时）**——删除 gitignored 的沙箱运行时状态
（会话、团队注册表、计划、live-context、演示项目 data/；不影响仓库内任何入库文件）：

```bash
rm -rf sandbox/agent/sessions sandbox/agent/teams sandbox/agent/plans \
       sandbox/agent/live-context sandbox/project/data
bash sandbox/restore-project.sh
```

> `sandbox/agent/trust.json`（项目信任记录）会保留——它是沙箱自身的运行时状态，
> 删除只会让下次重新弹一次信任框，无其他影响。cfg-* 目录下的 sessions/teams
> 同属运行时状态，需要时可用同样方式清理。

## 4. 记录

- 验证日期 / step 版本 / 失败项与备注：＿＿＿＿
