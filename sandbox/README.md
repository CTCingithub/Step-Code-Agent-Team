# 沙箱（Sandbox）

隔离的开发/测试环境，随仓库分发。所有开发活动在此进行，与真实 `~/.stepcode`
完全隔离——**运行时状态不入库**（agent 目录、sessions、团队注册表、`auth.json`
等均在 .gitignore 内）。

## 快速开始

```bash
export STEP_API_KEY=<你自己的 key>   # 仅涉及模型调用时才需要；绝不落盘
./sandbox/run.sh                     # 在 sandbox/project 中启动 step（已加载本扩展）
```

启动后在会话里输入 `/agent-team <你的请求>` 即可组建智能体团队。

## 内容

| 路径 | 说明 |
|---|---|
| `run.sh` | 沙箱启动器：隔离 agentDir/session/plan，cwd 指向 `project/` |
| `probe.sh` | 零 token 协议探针（期望输出 `PROBE OK`） |
| `restore-project.sh` | 将 `project/` 还原为初始种子态（含 off-by-one 种子 bug） |
| `project/` | 演示项目：零依赖 Node.js 任务管理器（`npm test`） |
| `project-pristine/` | 演示项目的初始快照（restore 的来源，勿改动） |
| `smoke-phase4/10/11/12.ts` | LLM 层回归探针（需 key，跑法见 docs/TESTING.md） |
| `cfg-*/settings.json` | 各探针的配置 fixture（`stepcodeAgentTeam` 节） |
| `TEST-PLAN.md` | 测试计划与历史执行记录 |

## 演示剧本

1. **pipeline 修复链**：scout 定位种子 bug → planner 出方案 → worker 修复 → reviewer 审查
2. **star 并行审查**：三名 reviewer 分头审查，队长汇总
3. **ring 巡回审查**：观察 `topology.maxLoopCount` 对巡游链长的约束

每轮演示前跑 `bash sandbox/restore-project.sh` 还原。
`project/secret-sample.txt` 是**假密钥**，用于验证路径保护护栏（成员不得读取或外传）。

## 跑测试

```bash
npm run smoke            # 零 token 全量冒烟（无需 key）
bash test/run-smoke.sh 5 # phase5 需 key
```

LLM 层探针跑法见 [../docs/TESTING.md](../docs/TESTING.md)；
配置方式见 [../docs/CONFIGURATION.md](../docs/CONFIGURATION.md)
（`sandbox/agent/settings.json` 的 `stepcodeAgentTeam` 节）。
