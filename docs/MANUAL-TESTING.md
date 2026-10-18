# 手动测试清单

> 自动化探针（`npm run smoke`：协议、配置、拓扑、深度、任务板、消息强制、live 接线）覆盖不到的
> 项目，按优先级排列如下，需由使用者在真实环境中验证。TUI 渲染的细化清单见
> [TUI-VERIFICATION.md](TUI-VERIFICATION.md)。

## 1. TUI 渲染（交互式 TUI，最高优先）

`render.ts` 只在交互 TUI 生效，headless 探针覆盖不到。按 `docs/TUI-VERIFICATION.md` 的
10 项逐条打勾：`/agent-team` 团队板、各工具的 renderCall/renderResult 形态、长 run 的
流式进度（onUpdate）、ctrl+o 展开、激活 notify、退出后无孤儿成员进程。

## 2. 真实安装（step install）

```bash
git archive HEAD | tar -x -C /tmp/scat-pkg
step install /tmp/scat-pkg
```

**预期**：安装成功写入 settings；新会话中提到「智能体团队」或运行 `/agent-team` 可激活；
成员可正常 spawn；`step remove` 可卸载。
**不要**直接 `step install ./`——本地路径安装整目录拷贝、不尊重 .gitignore，会把
`local/`（测试密钥）与 `sandbox/` 扫入发布物。

## 3. 真实项目配置与信任流

1. 在某项目建 `.stepcode/settings.json`：`{"stepcodeAgentTeam":{"members":{"max":2}}}`；
2. 首次在该项目启动 step：应出现**信任提示**——
   - 拒绝：配置不生效（成员上限仍为默认 8）；
   - 同意并记住：上限变为 2（尝试建第 3 个成员应报 `Team is full`）；
3. 改配置后需**新会话**生效；`/reload` 会重新读取但插件回到默认关闭状态；
4. 旧版专用文件 `<agentDir>/stepcode-agent-team.json` 仍生效（只读回退），
   `STEPCODE_TEAM_DEBUG=1` 时会打印迁移提示。

## 4. LLM 对拓扑 / 递归 / loop 上限的遵循（需测试 key）

建 3 个成员并声明 ring 拓扑，让成员沿环传递消息：

- 默认 `maxLoopCount=2`：第 3 跳被拒，成员应收到明确错误并**转为向队长汇报**
  （而非反复重试或去排查工具）；
- 改为 `0`（无上限）：链可继续（注意成本）；
- mesh 下让两成员互相等待：应收到 `messaging cycle detected` 拒绝，而非挂到 180s 超时；
- `maxRecursionDepth=2`：子队长能自建子成员并回传结果（depth≥3 见已知限制）。

## 5. 沙箱演示剧本（sandbox/project）

```bash
export STEP_API_KEY="$(grep -m1 '^STEP_API_KEY=' local/test-api-key.md | cut -d= -f2)"
./sandbox/run.sh
```

- **pipeline 修复链**：scout 定位种子 bug → planner 出修复方案 → worker 修复并让
  `npm test` 转绿 → reviewer 审查 diff；
- **star 并行审查**：三个 reviewer 分头审查正确性 / 风格 / 安全，队长汇总；
- **ring 巡回审查**：成员沿环传递审查意见，观察 `maxLoopCount` 对巡游链长的约束；
- 每轮演示前执行 `bash sandbox/restore-project.sh` 还原（种子 bug 复位、data/ 清除）；
- **路径保护护栏**：让成员尝试读取 `secret-sample.txt`（假密钥），确认被拒。

## 6. 成本护栏与用量

团队累计花费超过 `cost.warnThreshold`（默认 $1）时，`team_status` 与 `team_send` 的
结果中应出现告警；设为 `0` 禁用。需真实累积花费才能触发。

## 7. 退出与孤儿进程

交互会话退出（Ctrl+C / Ctrl+D）后执行 `pgrep -f 'team-.*-<member>'` 应为空——
session_shutdown 会 SIGTERM 全部成员（5s 后 SIGKILL 兜底）。

## 8. 性能主观项

8 成员满编时的 spawn 握手延迟、`maxConcurrent` 排队启动的吞吐、TUI 响应速度。

## 已知限制（审查确认，暂不修）

- **失败即杀语义**：任何派发失败都会杀掉成员进程并在下次派发时重启（防止同一
  session-id 上新旧 run 交错，见 docs/TESTING-OPTIMIZATION-PLAN.md P0-2）；
- **项目级配置每会话只应用一次**：信任在启动时解析，运行中授予信任不会补应用；
- **registry 版本不匹配即重建**：`schemaVersion !== 1` 时按新团队覆盖旧数据；
- **LLM 层探针不随仓库分发**：phase4/10/11/12 与 `cfg-*` fixture 仅在开发机存在，
  换环境需按 `sandbox/TEST-PLAN.md` 第三节矩阵重建；
- **depth≥3 未做真实 LLM 链测试**（进程级自举已验证）。
