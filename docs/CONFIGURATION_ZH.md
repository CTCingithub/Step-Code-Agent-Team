# 配置参考
> [English →](./CONFIGURATION.md)

Step-Code-Agent-Team 通过 `stepcodeAgentTeam` 配置节控制全部行为参数。Step Code 先将设置置于 settings.json，后迁移至统一配置 config.toml（该版本中 agent/settings.json 已退役）；两个位置都受支持，统一配置为当前惯例。

## 位置与优先级

```
全局：  <stepRoot>/config.toml 的 [stepcodeAgentTeam] 表
       （stepRoot 位于 agentDir 旁边：dirname(STEP_CODING_AGENT_DIR)，
         默认 ~/.stepcode——step 自身设置所在处）
       旧版回退：<agentDir>/settings.json 的 "stepcodeAgentTeam" 节
项目级：<cwd>/.stepcode/config.toml 的 [stepcodeAgentTeam] 表
       （仅当项目被信任时加载；信任信息只在事件处理器中可用，
         故在 session_start 时就地合并进已加载的配置）
       旧版回退：<cwd>/.stepcode/settings.json 的 "stepcodeAgentTeam" 节
```

优先级（全局与项目级两个层级各自如此）：**内置默认 < 旧版专用文件 < settings.json 节 < config.toml 表 < 环境变量覆盖**——统一配置覆盖旧版 settings 节，项目级覆盖全局，环境变量覆盖一切。

- 统一配置为 TOML（支持 `#` 注释）；旧版位置为标准 JSON。插件**只读取**自己的节，绝不写入任何配置文件（step 自身命令会保留未知键，`stepcodeAgentTeam` 表因此可幸存）。
- 未知键会被忽略（`debug: true` 时在 stderr 打印提示）。
- 非法值回退为默认值并在 debug 日志中警告。
- 配置在扩展加载时读取一次并缓存；项目级配置在首个事件上下文可用时就地合并（同一次会话内生效）；其余修改需新会话生效（`/reload` 会重新读取，但插件也会随之回到默认关闭状态）。
- 已知妥协：注册时固化的工具描述串（如模型列表）与本进程的深度门（`maxRecursionDepth`）不随项目级配置刷新——生效深度上限经 `STEPCODE_TEAM_MAXDEPTH` 向子成员传播，描述变化下一会话生效。
- **旧版兼容**：专用文件 `<agentDir>/stepcode-agent-team.json` / `<cwd>/.stepcode/stepcode-agent-team.json` 与 settings.json 节仍然有效（在同层级的统一表之前应用，debug 模式提示迁移）；建议尽早搬入 config.toml 的 `stepcodeAgentTeam` 表。

## 环境变量覆盖

| 变量 | 作用 |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | 等价 `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | 覆盖 `cost.warnThreshold`（非法值忽略） |
| `STEPCODE_TEAM_MAXDEPTH=<n>` | 覆盖 `members.maxRecursionDepth`（1–4，非法值忽略）；队长按生效值注入子成员进程 |
| `STEPCODE_TEAM_SOCK` | 由队长自动注入成员进程，指向团队服务 socket（无需手动设置） |

## 完整配置项

以下内容放入 `<stepRoot>/config.toml`（全局）或 `<cwd>/.stepcode/config.toml`（项目级）的 `[stepcodeAgentTeam]` 表内。TOML 没有 null：默认值为 null 的键（`members.defaultTools`、`storage.dir`）直接省略即可：

```toml
[stepcodeAgentTeam.activation]
enabled = true                       # 总开关：false 时任何触发都不激活
keywords = ["agent team", "智能体团队"]   # 自然语言触发词；[] = 禁用关键词激活
notifyOnActivate = true              # 激活时是否 notify 提示

[stepcodeAgentTeam.models]
available = ["step-5-preview"]       # 成员可用模型列表
autonomousSelection = false          # 对话模型自主为子代理选模型
autonomousThinking = false           # 对话模型自主为子代理选思考强度

[stepcodeAgentTeam.members]
max = 8                              # 存活成员上限（1–64；dead 成员可恢复但不占名额）
defaultRole = "worker"               # 未指定 role 时的默认角色（命中同名预设）
# defaultTools：省略即为 null（= 用预设或全量）
maxRecursionDepth = 1                # 团队树最大深度（1–4）：队长=0，其成员=1

[stepcodeAgentTeam.dispatch]
maxConcurrent = 5                    # 同时运行的成员上限（1–16）；超出的派活排队，轮到才启动
timeoutMs = 180000                   # 单次 dispatch/promptAndSettle 超时
handshakeTimeoutMs = 15000           # 成员 spawn 握手超时
retries = 1                          # 任务失败重试次数（0–5）

[stepcodeAgentTeam.oneshot]
timeoutMs = 180000                   # oneshot 进程超时

[stepcodeAgentTeam.cost]
warnThreshold = 1                    # 累计花费告警阈值（美元）；0 = 禁用

[stepcodeAgentTeam.idle]
reapAfterMs = 1800000                # 空闲成员回收阈值（30 分钟）
reapIntervalMs = 300000              # 回收检查间隔（5 分钟）

[stepcodeAgentTeam.storage]
# dir：省略即为 null（= <agentDir>/teams）

[stepcodeAgentTeam.topology]
default = "star"                     # 新团队默认拓扑形状（star/pipeline/mesh/ring/custom）
requireDeclaration = false           # true 时未显式声明拓扑前禁止派活
maxLoopCount = 2                     # 环形消息链最大跳数（0 = 无上限，范围 0–64）

[stepcodeAgentTeam]
debug = false                        # 调试日志（模型裁决、配置警告、socket 错误）
```

旧版 `settings.json` 位置接受同样的键（JSON 语法，null 值的键同样省略）：

```jsonc
{
  "stepcodeAgentTeam": {
    "members": { "max": 8 },
    "debug": false
  }
}
```

## 激活机制（默认关闭）

插件加载后团队工具即被声明为不可用（`pi.setUnavailableTools`）：模型看不到它们，
系统提示词中也不出现，不会创建 socket、定时器或成员进程。两种触发方式：

1. **斜杠命令 `/agent-team`**：命令被调用即激活，并展示团队板。
2. **自然语言**：prompt 文本命中 `activation.keywords`（大小写不敏感）即激活。

激活后：工具释放、消息服务启动、空闲收割启动，并保持粘性至会话结束。
`activation.enabled: false` 时两种触发都无效，`/agent-team` 会提示已被配置禁用。

## `models` 节语义

**模型解析**（队长当前模型 = 会话正在使用的模型）：

| `autonomousSelection` | 行为 |
|---|---|
| `false`（默认） | 所有成员**强制使用队长当前模型**；预设模型与显式 `model` 参数被忽略（debug 日志记录） |
| `true` | 解析链：显式 `model` → 预设角色模型 → 队长当前模型。显式参数不在 `available` 中 → **报错并列出可用模型**；预设模型不在列表中 → 回退到 `available[0]` |

**思考强度解析**（合法档位：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`）：

| `autonomousThinking` | 行为 |
|---|---|
| `false`（默认） | 成员思考强度**默认为 `high`**；`team_create_member` 的显式 `thinking` 参数可覆盖 |
| `true` | 工具描述告知队长 LLM 可逐成员从合法档位自主选择；显式 `thinking` 被采用；未指定时仍为 `high` |

注意：成员进程自此默认携带 `--thinking high`（此前不传，用 step 默认档），
单次成本会略高于从前；可用 `thinking` 参数按需调低。

## `topology` 节语义

成员间消息默认走**星型**：全部经队长中转，成员之间不能直接通信。队长用
`team_set_topology` 工具按任务结构声明拓扑后，成员只能沿声明的边直接通信；
越界消息会被 team-server 拒绝，并告知可用邻居。

| 形状 | 边 | 适用 |
|---|---|---|
| `star`（默认） | 无 | 并行独立 + 队长汇总 |
| `pipeline` | m1→m2→…→mn（按成员创建顺序） | 顺序精炼流水线 |
| `mesh` | 全部有序对 | 同伴互查 |
| `ring` | mi→mi+1（末位回环到首位） | 环形流水 |
| `custom` | 显式边列表 `[{from, to}]` | 精确控制 |

- `topology.default`：队长声明前新团队的默认形状（默认 `star`）。
- `topology.requireDeclaration`：`true` 时，未调用 `team_set_topology` 显式声明
  拓扑前，`team_send` / `team_task` / oneshot 一律拒绝——字面落实"先设计拓扑
  再开工"（默认 `false`，星型始终可用）。
- `topology.maxLoopCount`：成员间消息链的最大跳数。队长→成员派发记链长 0，成员
  每转发一次 +1；下一跳会使链长超过上限（上限 ≠ 0）时该消息被 team-server 拒绝，
  发送方转为向队长汇报——同时防止环形巡游死锁（发送方持运行位等待、目标方又排队
  等位）。默认 `2`，`0` = 无上限，合法范围 0–64；manager 层在嵌套派发前另有兜底校验。

成员通过 `stepcode-team status` 动态获知自己的可通知邻居（server 按发送方身份
返回 `mayMessage` 列表）。

## 递归深度与并发上限

**`members.maxRecursionDepth`（默认 1）**——团队树最大深度（队长会话 = 0，其成员 = 1）：

| 值 | 行为 |
|---|---|
| `1`（默认） | 成员不能再组建团队：成员以 `--no-extensions` 启动，扩展在其会话中完全惰性（零上下文开销） |
| `2` | 成员可组建自己的子团队：成员进程加载本扩展并自动激活（父级经 env 授予），其子成员深度为 2 |
| `3` / `4` | 依此类推（配置上限 4，防止成本失控） |

实现要点（全部走代码与环境变量，不占用模型上下文）：深度经 `STEPCODE_TEAM_DEPTH`
逐层传递；达到深度上限的会话中，扩展工厂直接返回——不注册工具、不挂钩子、不起
服务；子队长的团队是**独立的 team**（独立注册表与 socket），兄弟间消息仍受父级
拓扑约束。

**`dispatch.maxConcurrent`（默认 5）**——同时运行的成员上限。派活
（`team_send` / `team_task` / oneshot）在**启动成员进程之前**先获取运行位：
超出上限的派活排队，轮到且有空位时才启动该成员——即"部分子智能体等待其他
子智能体完成后再启动"。`team_create_member` 仍会立即启动成员进程（空闲待命），
上限约束的是"正在工作"的成员数。

## 示例

**默认（零配置即可）**：不创建配置文件——默认关闭激活、成员用队长模型、思考强度 high、花费阈值 $1。

**多模型自主（队长按任务挑模型）**：

```json
{
  "models": {
    "available": ["step-5-preview"],
    "autonomousSelection": true,
    "autonomousThinking": true
  },
  "dispatch": { "maxConcurrent": 6 }
}
```

**保守（禁用关键词激活，只认 /agent-team；关闭花费告警）**：

```json
{
  "activation": { "keywords": [], "notifyOnActivate": false },
  "cost": { "warnThreshold": 0 }
}
```

**调试**：

```json
{ "debug": true }
```

等价于运行前 `export STEPCODE_TEAM_DEBUG=1`。
