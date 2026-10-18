# 交接文档（Handoff）

> 目的：让其他 session 阅读本文后即可无缝继续开发。
> 配套文档：`DEVELOPMENT-HISTORY.md`（开发历程）、`README.md` / `README_ZH.md`（使用说明）、`docs/ARCHITECTURE.md`（架构）、`docs/PROTOCOL.md`（协议）、`docs/CONFIGURATION.md`（配置参考）、`docs/TESTING.md`（测试指南）、`sandbox/TEST-PLAN.md`（测试计划与缺陷清单，仅在本地沙箱）。

## 1. 项目现状（截至 2026-10-18）

Step Code 的智能体团队插件，对标 DeepSeek Harness agent teams，**功能已完整实现并通过沙箱全量测试**：

- **默认关闭激活**：团队工具加载时即被声明不可用；`/agent-team` 命令或 prompt 关键词（`input` + `before_agent_start` 双钩子）才激活
- **成员生命周期**：长驻 `step --mode rpc` 子进程；同 session-id 重启即续聊；并发/递归/拓扑/成本全链路护栏
- **通信拓扑**：star/pipeline/mesh/ring/custom 五形状，server 层强制（含环形链长上限 `topology.maxLoopCount`，默认 2、0 无上限），`team_set_topology` 声明
- **递归深度**：`maxRecursionDepth`（默认 1），子队长经 env 授予并自动激活
- **配置文件**：`<agentDir>/settings.json` 的 `stepcodeAgentTeam` 节（项目级 `<cwd>/.stepcode/settings.json` 同节、trust 门控；旧版专用文件 `<agentDir>/stepcode-agent-team.json` 仍作只读回退）（沙箱经 `STEP_CODING_AGENT_DIR` 隔离）

## 2. 架构地图

```
队长会话（index.ts：加载配置→注册工具→setUnavailableTools 关门；
  /agent-team 命令 / input / before_agent_start 触发激活；
  激活后：释放工具 + TeamServer + idle 收割定时器）
  │
  ├── tools.ts ── 6 个 LLM 工具（create_member/send/task/set_topology/disband/status）
  ├── members.ts ── TeamManager：spawn 互斥、模型/思考解析、拓扑方法、
  │    并发门（nested 绕过）、任务调度（重试）、oneshot、reaper
  ├── rpc-client.ts ── JSONL 客户端（严格 \n 分行、id 关联、握手、abort、killAndWait）
  ├── team-server.ts ── Unix socket：拓扑强制 + 环形链长强制 + status(mayMessage)
  ├── topology.ts ── 五形状构造/校验/解析
  ├── config.ts ── 默认值/文件合并/校验/环境变量覆盖/缓存
  ├── registry.ts ── 团队状态持久化（原子写、storage.dir、旧版兼容）
  ├── presets.ts ── agents/*.md 预设、扩展入口路径
  └── render.ts ── TUI 渲染
bin/stepcode-team.mjs ── 成员侧 CLI shim（携带发送方身份）
```

数据流：队长派活 → `acquireSlot`（nested 除外）→ spawn/复用成员 → `promptAndSettle` 等 `agent_settled` → 结果回写 registry。

## 3. 关键文件索引

| 文件 | 职责 | 修改高频点 |
|---|---|---|
| `extensions/members.ts` | 成员/任务/拓扑核心逻辑 | 模型解析、并发门、prompt 生成 |
| `extensions/config.ts` | 配置 schema 与校验 | 新增配置项必改此处 + docs/CONFIGURATION.md |
| `extensions/index.ts` | 激活接线 | 触发方式、启动副作用 |
| `extensions/topology.ts` | 拓扑模型 | 新形状 |
| `extensions/team-server.ts` | 消息强制 | 协议变更 |
| `sandbox/smoke-phase4/10/11/12.ts` | LLM 层回归探针（需测试 key） | 新功能必须配套探针 |
| `test/run-smoke.sh` + `test/smoke/phase*.ts` | 入库的零 token 冒烟集（1/2/3/5/6/7/8/9/13/14，hermetic 临时 agentDir；phase5 无 key 时 SKIP；含 live 接线检查） | 新功能必须配套探针 |
| `docs/ARCHITECTURE.md` · `docs/PROTOCOL.md` | 架构与协议参考（组件/数据流/护栏、RPC/socket/registry/工具契约） | 组件或协议变更必改 |
| `docs/TESTING.md` | 四层测试操作化指南 | 新探针或测试入口变化必改 |

## 4. 已知限制

- **项目级配置有两个时序妥协**：`applyProjectConfig` 已在 session_start 就地合并（trust 门控），但注册时固化的工具描述串（模型列表等）与本进程的深度门不随项目级配置刷新；生效深度上限经 `STEPCODE_TEAM_MAXDEPTH` 向子成员传播，描述变化下一会话生效
- **LLM 行为不可完全控**：成员可能弃用工具转去排查环境（协调提示已加固，无法根除）
- **TUI 渲染未实测**：`render.ts` 只在交互 TUI 生效，headless 探针覆盖不到
- **LLM 层探针在 gitignore 内**：phase4/10/11/12 与 TEST-PLAN.md 未入库（零 token 层已随 `test/smoke/` 分发，`npm run smoke`）；换环境跑 LLM 层需按其中 JSON 模板重建配置
- **depth≥3 未做真实 LLM 链测试**（进程级已验证，构造上受深度上限约束）

## 5. 建议下一步（按优先级）

> 进度（plan-51，2026-10-18）：M4 文档三件套、项目级配置接线（smoke-phase13）、零 token 探针入库（`test/smoke/` + `test/run-smoke.sh`）、安装打包审计与 TUI 验证清单均已落地；余下均为用户侧执行项，详见 `.stepcode/plans/` 当前会话计划。

1. ~~把沙箱探针固化为 CI 冒烟集~~ ✅ 已落地：`test/smoke/` + `test/run-smoke.sh`（`npm run smoke`），phase5 无 key 时显式 SKIP；LLM 层留 sandbox/
2. ~~项目级配置接入~~ ✅ 已落地：`<cwd>/.stepcode/settings.json` 的 `stepcodeAgentTeam` 节，trust 门控（smoke-phase13；旧专用文件仅作只读回退）
3. TUI 渲染人工验证：清单见 `docs/TUI-VERIFICATION.md`（沙箱内逐项打勾并记录结果）
4. `step install ./` 端到端安装验证（由用户执行）：**从干净导出物安装**——本地路径安装整目录拷贝/硬链且不尊重 .gitignore，会把 `local/`（密钥）与 `sandbox/` 扫入发布物；用 `git archive HEAD | tar -x -C /tmp/pkg && step install /tmp/pkg`。package.json 已加 `files` 白名单作为纵深防御
5. 观察真实使用中 LLM 对拓扑/递归的遵循度，迭代工具描述与 SKILL 指南

## 6. 验证方法

```bash
# 零 token 冒烟（协议/配置/拓扑/深度/项目级配置；hermetic 临时 agentDir）
npm run smoke                    # phase 1 2 3 5 6 7 8 9 13 14；phase5 无 STEP_API_KEY 时 SKIP
bash test/run-smoke.sh 9 13      # 只跑指定 phase

# LLM 路径（先 export STEP_API_KEY，密钥位置见 local/test-api-key.md）
sleep 300 | step -e "$PWD/extensions/index.ts" -e "$PWD/sandbox/smoke-phase4.ts" \
  --mode rpc --session-id r4 --session-dir "$PWD/sandbox/agent/sessions"
```

专项配置运行：phase10 用 `sandbox/cfg-conc` / `sandbox/cfg-deadlock`，phase11 用 `sandbox/cfg-deep2`；配置若丢失，按 `sandbox/TEST-PLAN.md` 第三节矩阵中的 JSON 重建。

## 7. 开发约定

- **提交**：分批 conventional commit + push + 本地/远程 HEAD 一致性验证（用户已授权自主执行）
- **测试先行**：新功能先写失败探针再修复；零 token 探针入库 `test/smoke/`，LLM 探针留 `sandbox/`，均按 phase 编号递增
- **危险操作**（npm install / step install / git / 杀进程）由用户执行
- **密钥**：只在 `local/`（gitignore），经环境变量传递，绝不入库

