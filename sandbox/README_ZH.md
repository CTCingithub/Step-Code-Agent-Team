# 沙箱（Sandbox）
> [English →](./README.md)

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
| `restore-project.sh` | 还原沙箱测试环境：`project/` 复位为初始种子态（含 off-by-one 种子 bug），清除运行时数据与会话日志（`session-log-*.md`） |
| `project/` | 演示项目：零依赖 Node.js 任务管理器（`npm test`） |
| `project-pristine/` | 演示项目的初始快照（restore 的来源，勿改动） |
| `smoke-phase4/10/11/12.ts` | LLM 层回归探针（需 key，跑法见 docs/TESTING.md） |
| `cfg-*/settings.json` | 各探针的配置 fixture（经旧版 settings.json 层级暂存，仍然有效） |
| `TEST-PLAN.md` | 测试计划与历史执行记录 |
| `step/` | Step Code 源码 submodule（钉住本沙箱跟踪的版本） |
| `step-bin.sh` | step 二进制解析器（被各脚本 source） |
| `build-step.sh` | 可选：从子模块构建 step 到 `sandbox/step-build/` |

## Step Code 源码（git submodule）

`sandbox/step` 是 [Step Code](https://github.com/stepfun-ai/Step-Code)（MIT 许可）的
git submodule，钉住本沙箱跟踪的 Step Code 版本——step 升级时只需 bump 子模块指针并重跑
回归，不再被动跟随全局安装的变更。

- **克隆本仓库时**：用 `git clone --recurse-submodules`，或克隆后执行
  `git submodule update --init sandbox/step`。
- **step 二进制解析顺序**（`sandbox/step-bin.sh`，run.sh / probe.sh / test/run-smoke.sh
  均通过它取二进制）：
  1. `$STEPCODE_STEP_BIN` —— 显式指定；
  2. `sandbox/step-build/step` —— 由 `sandbox/build-step.sh` 从子模块构建产出；
  3. PATH 中的 `step` —— 全局安装（默认，即当前回归基线）。
- **从钉住的源码构建**（可选，较重：pnpm install + 全量构建 + bun 编译，数分钟与数 GB 磁盘）：
  ```bash
  bash sandbox/build-step.sh   # 产物以符号链接暴露为 sandbox/step-build/（gitignored）
  ```
- **更新子模块**（step 发布新版本后）：
  ```bash
  git submodule update --remote sandbox/step   # 拉到上游默认分支最新
  npm run smoke                                # 全量回归
  git add sandbox/step                         # 提交新指针
  ```
- 上游没有 tag（产品版本号在构建时注入），因此按 commit SHA 钉住；`.gitmodules` 设有
  `ignore = untracked`，子模块内的构建产物不会污染主仓库的 `git status`。

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

LLM 层探针跑法见 [../docs/TESTING.md](../docs/TESTING_ZH.md)；
配置方式见 [../docs/CONFIGURATION.md](../docs/CONFIGURATION_ZH.md)
（`sandbox/config.toml` 的 `[stepcodeAgentTeam]` 表）。
