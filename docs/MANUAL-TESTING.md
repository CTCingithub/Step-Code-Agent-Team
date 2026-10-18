# 手动测试清单（已最小化）

> **自动化覆盖**（`npm run smoke`，零 token；phase5 与 LLM 项需 key）：协议层、配置三级
> 加载与旧文件回退、拓扑真值表与越界拒绝、递归深度、任务板状态机、消息强制（拓扑/loop
> 上限/等待环）、项目级配置的**信任应用与拒绝**（`live-project-config` /
> `live-untrusted-config`）、live 接线（`/agent-team` 命令、参数转发）、**TUI 渲染内容层**
> （phase15 对 render.ts 各工具 call/result 字符串、折叠/展开、用量行、图标的断言）、
> **成本护栏与输出截断逻辑**（phase16）、**孤儿进程**（orphan-check：成员不得比队长
> 长寿）、**干净导出物可加载性**（live-clean-export：git archive 出的包能激活）。
>
> 以下仅剩**不可约**的人工项——按优先级排列。TUI 渲染的细化清单见
> [TUI-VERIFICATION.md](TUI-VERIFICATION.md)（其内容层已被 phase15 断言，只剩观感）。

## 1. 交互 TUI 的观感（唯一保留的渲染项）

各工具渲染的**文本内容**已由 phase15 自动断言；剩下的只有像素级与交互级观感：
颜色/布局是否顺眼、toast 停留时间、`ctrl+o` 实际按键、流式进度的刷新节奏。
在沙箱交互会话里过一遍即可，无需核对具体文本。

## 2. 真实安装写入 settings（一次性，需你执行）

`step install` 会写你的真实 settings，因此由你执行；冒烟集已用导出物验证
「打包内容完整可加载」（live-clean-export），剩下的只是装入你的环境：

```bash
git archive HEAD | tar -x -C /tmp/scat-pkg
step install /tmp/scat-pkg
```

**预期**：安装后新会话可激活、成员可 spawn、可 `step remove` 卸载。
**切勿**直接 `step install ./`——本地路径安装整目录拷贝、不尊重 .gitignore，
会把 `local/`（测试密钥）与 `sandbox/` 扫入发布物。

## 3. 信任提示的交互 UX

`-a`/`-na` 的语义已自动化；剩下的是交互式信任弹窗本身：首次在带有
`.stepcode/settings.json` 的项目里启动 step 时，看一眼提示与「记住」选项即可。

## 4. LLM 行为遵循度（需 key，本质不可约）

服务端的确定性拒绝（拓扑越界、loop 上限、等待环）已被探针覆盖；不可约的是成员
LLM 是否「听话」——收到拒绝后转为向队长汇报，而非反复重试或去排查工具。
建 3 个成员声明 ring 拓扑实跑一次观察即可（第 3 跳应被拒且成员汇报）。
成本护栏的**发射逻辑**已由 phase16 覆盖；想在真实累积花费下眼见为实可选做。

## 5. 沙箱演示剧本（✅ 2026-10-18 已实测通过）

pipeline 修复链 / star 并行审查 / ring 巡回审查——`./sandbox/run.sh`，
每轮前 `bash sandbox/restore-project.sh` 还原。属体验验证，非正确性验证。

**实测记录（2026-10-18）**：`/agent-team <请求>` 驱动 7 成员团队完整跑通两幕——
pipeline 修复链（scout 定位种子 bug → planner 出最小方案 → worker 修复 →
reviewer 通过）+ star 三方并行审查（正确性/风格通过；安全项留下加固建议，
属演示项目自身的可选项）。队长复核：`npm test` 8/8（修复前基线 7/8）、与
`project-pristine` 逐文件比对仅 `src/tasks.js` 有差异、`secret-sample.txt`
全程未被任何成员读取。第三幕（ring 巡回）与安全加固待用户定夺。

## 6. 性能主观项

8 成员满编时的 spawn 握手延迟、TUI 响应速度——主观，无判定标准。

## 已知限制（审查确认，暂不修）

- **失败即杀语义**：任何派发失败都会杀掉成员进程并在下次派发时重启（防止同一
  session-id 上新旧 run 交错，见 docs/TESTING-OPTIMIZATION-PLAN.md P0-2）；
- **项目级配置每会话只应用一次**：信任在启动时解析，运行中授予信任不会补应用；
- **registry 版本不匹配即重建**：`schemaVersion !== 1` 时按新团队覆盖旧数据；
- **纯逻辑探针须独立运行**：phase15/16/17 传递导入 `@step-harness/pi-tui` 会触发
  step 对仓库包的暂存加载，与 `-e` 原始副本冲突——runner 的 `STANDALONE_PHASES`
  机制不挂载 index.ts（见 run-smoke.sh 注释）；
- **depth≥3 未做真实 LLM 链测试**（进程级自举已验证）。
