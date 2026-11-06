# 沙箱（Sandbox）
> [English →](./README.md)

隔离的开发/测试环境，随仓库分发。所有开发活动在此进行，与真实 `~/.stepcode`
完全隔离——**运行时状态不入库**（agent 目录、sessions、团队注册表、`auth.json`
等均在 .gitignore 内）。

## 快速开始

```bash
# 密钥（仅涉及模型调用时才需要；绝不落盘）：
#   写入 sandbox/TEST-KEY.md（gitignored），或 export STEP_API_KEY=<你自己的 key>
./sandbox/run.sh                     # 在 sandbox/project 中启动 step（已加载本扩展）
```

启动后在会话里输入 `/topo <你的请求>` 即可组建拓扑智能体团队。

## 内容

| 路径 | 说明 |
|---|---|
| `run.sh` | 沙箱启动器：隔离 agentDir/session/plan，cwd 指向 `project/`（自动读取 `TEST-KEY.md` 中的 key） |
| `probe.sh` | 零 token 协议探针（期望输出 `PROBE OK`） |
| `archive-round.sh` | 归档本轮测试证据（会话 JSONL、团队注册表、`logs/`、项目 diff）到 `archive/<时间戳>-<标签>/`（gitignored）——在 `restore-project.sh` 之前运行 |
| `restore-project.sh` | 还原沙箱测试环境：`project/` 复位为初始种子态（含 off-by-one 种子 bug），清除运行时数据与会话日志（`session-log-*.md`、`logs/`） |
| `project/` | 演示项目：零依赖 Node.js 任务管理器（`npm test`：12 条测试，种子 bug 在位时 11 条通过） |
| `project-pristine/` | 演示项目的初始快照（restore 的来源，勿改动） |
| `smoke-phase4/10/11/12.ts` | LLM 层回归探针（需 key，跑法见 docs/TESTING.md） |
| `bin/topo-search.mjs`（仓库根） | searcher 角色的检索脚本：`search` / `fetch` / `batch` 三个子命令。端点与密钥来自配置里的 `[stepcodeAgentTeam.searcher]`——任何遵循该脚本 JSON 契约的厂家都可用，DeepSeek 的 `/v1/tools/search` + `/v1/tools/fetch` 只是默认值（见 ../../docs/CONFIGURATION_CN.md） |
| `probe-searcher.mjs` | searcher **实测**探针：对配置的厂家发起真实 search/fetch，由配置文件驱动（见下） |
| `probe-remaining-manual.mjs` | 原人工场景的 RPC 驱动 live 探针（需 key）：`node sandbox/probe-remaining-manual.mjs <5a\|5b\|5c\|7\|8\|9\|all>`——应答宿主对话框（select/input/confirm）驱动方案确认、L1 护栏、自定义角色与迁移提示；每条子命令用隔离临时 agentDir，须由队长自身进程运行，且须卸载六个 `STEPCODE_TEAM_*` 变量——在成员进程内它们会遗传给探针自启的 `step` 子进程，该子进程的扩展读到 depth 1 ≥ `maxRecursionDepth` 1 而保持惰性，所有探针都会假失败。`all` 以各自独立的子进程（各自 mktemp agentDir）跑完所有场景，输出逐场景判定与汇总行 |
| `cfg-*/settings.json` | 各探针的配置 fixture（经旧版 settings.json 层级暂存，仍然有效）。活跃：`cfg-conc`（phase10 A 支）、`cfg-deadlock`（phase10 B 支）、`cfg-deep2`（phase11）；其余为遗留、无 live 消费方（phase9 自建 mktemp fixture）。本地 `sandbox/config.toml` 会遮蔽它们——探针须隔离 agentDir（见 docs/TESTING.md C 层） |
| `TEST-KEY.md` | 测试凭证（gitignored——`STEP_API_KEY=<key>` 供 step CLI；可选的 `DEEPSEEK_API_KEY=<key>` 行只是 searcher 脚本默认端点下的便捷回退）。searcher 自己的 key 应写在 `sandbox/config.toml` 的 `[stepcodeAgentTeam.searcher]`（同样 gitignored），这才是与厂家无关的正路 |
| `with-test-key.sh` | 以 TEST-KEY.md 中的凭证 export 后运行给定命令（用于 C 层 LLM 探针） |
| `step/` | Step Code 源码 submodule（钉住本沙箱跟踪的版本） |
| `step-bin.sh` | step 二进制解析器（被各脚本 source） |
| `build-step.sh` | 可选：从子模块构建 step 到 `sandbox/step-build/` |

沙箱目录只保留 README 与脚本；测试计划与执行历史见 [../docs/TEST-PLAN.md](../docs/TEST-PLAN_CN.md)。

## Step Code 源码（git submodule）

`sandbox/step` 是 [Step Code](https://github.com/stepfun-ai/Step-Code)（MIT 许可）的
git submodule，钉住本沙箱跟踪的 Step Code 版本——step 升级时只需 bump 子模块指针并重跑
回归，不再被动跟随全局安装的变更。

**当前锁定修订**：`29eb4607`（2026-11-03，`origin/main` 尖端），构建出 **Step Code 0.1.7**。
版本由构建时注入（`scripts/build-binaries.sh` 的 `STEPCODE_BUILD_VERSION`），而仓库自带的
`package.json` 全程只写 `0.1.0`——所以 tag 和该文件都告不出你用的是哪个版本，`step --version`
才行。每次 bump 指针时，把 commit 与该命令报告的版本记在这里，下次升级才有基线可 diff。

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

每轮演示前跑 `bash sandbox/restore-project.sh` 还原；每轮结束后按下方「会话日志」一节生成记录。
`project/secret-sample.txt` 是**假密钥**，用于验证路径保护护栏（成员不得读取或外传）。

## searcher 实测（会计费）

`bin/topo-search.mjs` 打向**你配置的**厂家——DeepSeek 的 `/v1/tools/search` 与
`/v1/tools/fetch` 只是默认值。端点与密钥一律写在**配置文件**里，不依赖任何
厂家的 key 文件：

```toml
# sandbox/config.toml（gitignored）
[stepcodeAgentTeam.searcher]
searchUrl = "https://api.deepseek.com"
searchApiKey = "<你的 key>"
fetchUrl = "https://api.deepseek.com"
fetchApiKey = "<你的 key>"
```

然后跑实测探针——它读取该表，经与队长注入成员完全相同的 `STEPCODE_TOPO_*`
变量把值传给脚本，断言真实契约（结果非空且带 url、`need_content` 返回正文、
fetch 返回标题与 Markdown、真实项目内容可匹配、批量扇出）：

```bash
node sandbox/probe-searcher.mjs                    # 使用配置
TOPO_PROBE_MAX_CALLS=0 node sandbox/probe-searcher.mjs   # 只做配置干跑
```

**会计费。** 服务方按成功请求收费（DeepSeek：每千次 5 元）。探针在开头打印
本次预算（最多 6 次计费调用）；未配置 key 时 exit 2 并打印应添加的配置，且
**零调用**。失败、空结果与超时不计费——这也是脚本绝不重试 4xx 的原因。

要端到端测**角色**（`role: searcher` 的成员亲自调用脚本），在沙箱里起会话并
要求检索即可——成员从队长环境继承 `DEEPSEEK_API_KEY`，或由上面的配置表经队长
注入拿到密钥。

## 会话日志

每轮沙箱测试结束后，让 agent 把过程写入 `sandbox/logs/session-log-<日期>.md`
（gitignored，本地留存；`restore-project.sh` 还原种子态时一并清除——先跑
`bash sandbox/archive-round.sh <标签>` 可保留证据）。
把下面这段 prompt 粘进会话（或在该轮结束时交给队长）：

```text
请把本 session 的团队协作过程记录到 sandbox/logs/session-log-<今天日期>.md，结构：
（1）头部——日期、主模型、工作目录、团队框架、安全护栏遵守情况；
（2）用户 Prompt 逐字摘录；（3）小队名册表——成员/角色/职责/工具/effort；
（4）按执行顺序的各阶段——拓扑声明、派活方式、成员产出要点；异常实况
（如 topo_team_msg 被拒）必须引用工具返回的原文，不得凭记忆转述；
（5）净结果——基线对比、改动文件清单、未做的事；（6）还原方式。
```

## 跑测试

```bash
npm run smoke            # 零 token 全量冒烟（无需 key）
bash test/run-smoke.sh 5 # phase5 需 key（来自环境变量或 sandbox/TEST-KEY.md）
```

**门禁内容**：34 个 phase——清单由 `test/smoke/phase*.ts` 磁盘派生；phase 15/16/23/24/28/30/31
独立运行（不加载扩展，避免与已安装包副本的工具名冲突）；phase5 需 key；phase 之后：
manifest 检查、7 个 live 检查（**必须由队长自身的干净进程跑**——在成员进程受限环境中会
整体假阴性）、15s 孤儿进程轮询。失败 phase 以新 session id 重试一次（首发失败行前缀
`attempt1`，重试通过不会给 CI 留裸 `FAILED` 行）；`OPT_OUT_PHASES` 可跳过指定 phase。
完整参考：[../docs/TESTING.md](../docs/TESTING_CN.md)。任何还原前先跑
`bash sandbox/archive-round.sh <标签>`——它保留 `restore-project.sh` 不碰的
session JSONL 与团队注册表。

LLM 层探针跑法见 [../docs/TESTING.md](../docs/TESTING_CN.md)；
配置方式见 [../docs/CONFIGURATION.md](../docs/CONFIGURATION_CN.md)
（`sandbox/config.toml` 的 `[stepcodeAgentTeam]` 表）。

**改这张表要注意**：`sandbox/config.toml` 就是正确的文件（它在 agentDir 旁边，插件正是从那里解析全局配置——**不存在** `sandbox/agent/config.toml`）。但配置**只在队长进程加载扩展时读一次**，会话运行中改动对该会话绝不生效——改完请重启会话。想确认读了哪个文件、生效值是多少，用 `STEPCODE_TEAM_DEBUG=1` 运行（激活时会打印 `config: unified=<路径> …`）。另注意同一文件也会遮蔽 `cfg-*` 探针 fixture，探针运行时请隔离。
