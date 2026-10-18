# TUI 人工验证清单

> `render.ts`（renderCall / renderResult）与 `/agent-team` 面板只在交互 TUI 生效，
> headless / RPC 探针覆盖不到，需按本清单人工验证。全部在沙箱内进行，与真实
> `~/.stepcode` 隔离；涉及模型调用，先导出测试 key（只经环境变量传递）。

## 环境

```bash
export STEP_API_KEY="$(grep -m1 '^STEP_API_KEY=' local/test-api-key.md | cut -d= -f2)"
./sandbox/run.sh     # cwd 为 sandbox/project，agentDir 指向 sandbox/agent
```

## 清单

| # | 操作 | 预期 | 结果 |
|---|---|---|---|
| 1 | 发送含「智能体团队」的 prompt | 激活 notify：「Agent team plugin activated (explicit plugin mention). Team tools are now available.」；团队工具对模型可见 | ☐ |
| 2 | 运行 `/agent-team` | 团队板 notify：`Team "<id>"` + 成员行（○/●/✗ 图标 + role + status + model/thinking）+ 任务行（含 blockedBy）+ `spend: $x.xxxx`；空队时提示用 team_create_member | ☐ |
| 3 | `team_create_member(scout1, role: scout)` | renderCall：`team +scout1 (scout)`；renderResult：`✓ scout1 (scout) [idle] … thinking=high` | ☐ |
| 4 | `team_send(scout1, "用一句话介绍你自己")` | renderCall：`team →scout1` + 消息预览（≤70 字符）；长 run 期间 onUpdate 流式刷新（先 "(member is working...)"，随后 interim 文本）；renderResult：用量行（`1 turn, $x.xxxx`）+ 回复正文（默认折叠 3 行，附 "(ctrl+o to expand)"） | ☐ |
| 5 | 在 team_send 结果上按 ctrl+o | 完整正文展开 | ☐ |
| 6 | `team_set_topology(pipeline)` 后再发一次消息 | renderCall：`team topology pipeline 1 edge(s)`；renderResult 头：`pipeline · 1 edge(s)` | ☐ |
| 7 | `team_task create`（title + assignee）→ `team_task start` | renderCall：`team task create T1 …` / `team task start T1`；renderResult：`T1 [done] @scout1 标题` + 回复正文 | ☐ |
| 8 | `team_status` | 每成员一行（图标 + name + role + 用量），任务逐行（id [status] title，50 字符预览） | ☐ |
| 9 | `team_disband(scout1)` | renderCall：`team −scout1`；renderResult：`scout1` | ☐ |
| 10 | 退出沙箱会话 | 无孤儿成员进程（`pgrep -f 'team-.*-scout1'` 为空） | ☐ |

## 记录

- 验证日期 / step 版本 / 失败项与备注：＿＿＿＿
