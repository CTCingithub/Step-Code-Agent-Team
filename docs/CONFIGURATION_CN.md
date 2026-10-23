# 配置参考

> [English →](./CONFIGURATION.md)

全部行为参数由 Step Code 统一配置文件中的 `stepcodeAgentTeam` 表控制。无需任何配置——内置默认值即可工作。插件首次激活时会向你的全局配置追加一段注释掉的默认值块，便于发现可配置项。

## 位置与优先级

| 层级 | 路径 | 说明 |
|---|---|---|
| 全局 | `<stepRoot>/config.toml` 的 `[stepcodeAgentTeam]` 表 | `stepRoot` 位于 agentDir 旁边：`dirname(STEP_CODING_AGENT_DIR)`，默认 `~/.stepcode`（沙箱经 `STEP_CODING_AGENT_DIR` 指向 `sandbox/agent`） |
| 项目级 | `<cwd>/.stepcode/config.toml` 的 `[stepcodeAgentTeam]` 表 | 仅项目被信任时加载；在首个事件上下文可用时就地合并，覆盖全局层 |
| 环境变量 | `STEPCODE_TEAM_DEBUG` · `STEPCODE_TEAM_COST_WARN` · `STEPCODE_TEAM_MAXDEPTH` | 一次性覆盖，优先级最高 |

**优先级：内置默认 < 全局 config.toml < 项目级 config.toml < 环境变量覆盖。** 配置在加载时只读一次；`/reload` 会重新读取，但插件也会随之回到默认关闭状态。未知键忽略；非法值回退默认并在 debug 日志警告。插件只读取自己的表，绝不写入文件——首次激活时追加的注释种子块除外。

## 完整配置

全局（`<stepRoot>/config.toml`）或项目级（`<cwd>/.stepcode/config.toml`）。TOML 没有 null：默认值为 null 的键（`members.defaultTools`、`storage.dir`）直接省略：

```toml
[stepcodeAgentTeam.activation]
enabled = true                       # 总开关；false 时两种触发都无效
keywords = ["智能体小队", "多智能体小队", "组小队", "stepcode 小队", "topo team", "topo-agent", "stepcode topo", "topology team", "agent squad", "stepcode-agent-team", "step code agent team", "team_create_member", "team_send", "team_task"]   # 插件专属关键词；[] = 禁用关键词激活
notifyOnActivate = true              # 激活时是否 notify 提示
guardEnabled = true                  # L1：忽略否定句/元讨论/代码引用式提及
confirmBeforeActivate = true         # L2：TUI 中关键词命中先弹确认框（headless 忽略）
headlessAutoActivate = true          # L3：headless/RPC 关键词命中直接激活，不弹框

[stepcodeAgentTeam.models]
available = ["step-5-preview"]       # 成员模型池
autonomousSelection = false          # true = 由队长为每个成员选模型
autonomousEffort = false              # true = 由队长为每个成员选 effort

[stepcodeAgentTeam.members]
max = 8                              # 存活成员上限（1–64）
defaultRole = "worker"               # 新成员默认角色
# defaultTools 省略（null）= 用预设白名单或全量工具
maxRecursionDepth = 1                # 团队树深度上限（1–4）

[stepcodeAgentTeam.dispatch]
maxConcurrent = 5                    # 并行成员上限（1–16）；超出的派活排队
timeoutMs = 600000                   # 单次派发超时
handshakeTimeoutMs = 15000           # 成员 spawn 握手超时
retries = 1                          # 任务重试次数（0–5）

[stepcodeAgentTeam.oneshot]
timeoutMs = 600000                   # 无状态派发超时

[stepcodeAgentTeam.cost]
warnThreshold = 1                    # 累计花费告警阈值（美元）；0 = 禁用

[stepcodeAgentTeam.idle]
reapAfterMs = 1800000                # 空闲成员回收阈值（30 分钟）
reapIntervalMs = 300000              # 回收检查间隔（5 分钟）

[stepcodeAgentTeam.storage]
# dir 省略（null）= <agentDir>/teams

[stepcodeAgentTeam.tasks]
max = 999                           # 任务板容量（id 为 T1..T<max>；1–10000）
outputCapBytes = 51200              # 单任务输出截断（字节）；全文保留在 details.fullText

[stepcodeAgentTeam.topology]
default = "star"                     # star/pipeline/mesh/ring/custom
requireDeclaration = false           # true = 未显式声明拓扑前禁止派活
maxLoopCount = 2                     # 环形消息链跳数上限（0 = 无上限，0–64）

[stepcodeAgentTeam.plan]
enabled = false                      # 团队方案选单：激活时给出经济/快速/均衡/性能 + 自定义
tier = "always ask"                  # always ask = 每次弹选单；固定档位则直接应用

[stepcodeAgentTeam.presets.effort]
scout = "low"                        # 按角色覆盖 effort（自定义角色在自己的 frontmatter 里写 effort）
planner = "medium"                   # models.autonomousEffort 开启时一律不生效（由队长选择）
worker = "medium"
reviewer = "high"

[stepcodeAgentTeam]
debug = false                        # 调试日志
```

## 可配置项速览

| 配置节 | 控制内容 |
|---|---|
| `activation` | 默认关闭门：`/topo` 命令（`/topo off` 停用并重新隐藏工具）或关键词提及（大小写不敏感）即激活，会话内粘性。`enabled: false` 时两种触发都无效，命令会提示已被配置禁用。旧版关键词（"agent team"/"智能体团队" 等裸词）会在加载时从生效清单中剥离——强制迁移，激活时提示一次。若配置的全部都是旧词，生效清单将变为空、关键词激活保持关闭，直至设置插件专属关键词。`guardEnabled` / `confirmBeforeActivate` / `headlessAutoActivate` 三层防误触——斜杠命令不经过防护 |
| `models` | 成员模型池。`autonomousSelection` 关（默认）时所有成员强制使用对话当前模型（预设/显式 `model` 忽略）；开时解析链为显式 `model` → 预设 → 对话当前模型（显式模型不在列表则报错并列出可用模型，预设模型不在列表则回退 `available[0]`）。`autonomousEffort` 关时 effort 解析链为：显式参数 → `presets.effort` 配置覆盖 → 预设 frontmatter `effort` → `high`；开时由队长逐成员选择（所有预设 effort 不生效） |
| `members` | `max` 只计**存活**成员（dead 记录可恢复但不占名额）。`maxRecursionDepth`：1 = 成员不能组建团队（其会话中扩展完全惰性）；2+ 授予子队长独立团队（独立注册表与 socket），上限 4 |
| `dispatch` | `maxConcurrent` 在**进程启动前**门控（排队启动）；oneshot 共享同一预算；嵌套成员间接力绕过全局门以避免链式死锁 |
| `oneshot` | 无状态 `mode: "oneshot"` 派发超时 |
| `cost` | 团队级累计花费告警；0 禁用 |
| `idle` | 空闲成员被回收（session 保留可恢复）；运行中成员永不回收 |
| `storage` | 团队数据根目录（注册表、sessions、prompts、socket）；null = `<agentDir>/teams` |
| `tasks` | `max` 决定任务板容量（id 为 T1..T<max>；超出后创建报错并给出配置上限）；`outputCapBytes` 截断模型可见的单任务输出——全文保留在 `details.fullText` |
| `topology` | 成员间消息默认拒绝，除非声明的边允许。`requireDeclaration` 落实「先设计再开工」。`maxLoopCount` 约束链长（队长派发 = 0，每转发 +1）；超限跳被拒且发送方改为把结论写入最终报告——同时防止环形巡游死锁。成员经内置 `topo_team_msg` 工具直达通信（无需 bash，只读角色同样可用），边对所有角色可用；依赖请用任务板 `blockedBy` 表达 |
| `plan` | 团队方案选单（默认关）：激活时队长给出经济/快速/均衡/性能四种*策略* + 自定义流程（规模 → 拓扑 → effort）。档位是带非绑定示例的策略提示词——成员、角色、拓扑与 effort 由模型按任务决定。`tier = "always ask"`（默认）每次弹选单；固定档位在每次激活（命令与关键词路径）直接应用；`/topo <档位名>` 可按次覆盖。选单超时/headless 回退 `balanced`；选项按语言本地化；无成本倍率 |
| `presets.effort` | 按角色覆盖 effort（内置角色名已列出；自定义角色在自己的 frontmatter 写 `effort`）。解析链：显式 `effort` 参数 → 本配置 → 预设 frontmatter → `high`。`models.autonomousEffort` 开启时不生效。自定义角色从 `<agentDir>/agents/` 与 `<project>/.stepcode/agents/` 加载——见 [docs/ROLES.md](ROLES_CN.md) |
| `debug` | stderr 诊断日志 |

拓扑形状（建成员后、派活前用 `team_set_topology` 声明）：

| 形状 | 边 | 适用 |
|---|---|---|
| `star`（默认） | 无 | 队长合并的独立并行支线 |
| `pipeline` | m1→m2→…→mn（按建成员顺序） | 顺序精炼链 |
| `mesh` | 全部有序对 | 同伴交叉检查 |
| `ring` | mi→mi+1（末者回环到首个） | 巡回审查 |
| `custom` | 显式 `[{from, to}]` 列表 | 精确控制 |

成员动态获知可通知的邻居：`topo_team_msg` 被拒时会列出可用队友（server 按发送方身份返回 `mayMessage` 列表），`stepcode-team status` 亦可从 shell 查询。

## 环境变量覆盖

| 变量 | 作用 |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | 等价 `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | 覆盖 `cost.warnThreshold`（非法值忽略） |
| `STEPCODE_TEAM_MAXDEPTH=<n>` | 覆盖 `members.maxRecursionDepth`（1–4，非法值忽略）；队长按生效值注入子成员进程 |
| `STEPCODE_TEAM_SOCK` | 由队长自动注入成员进程，指向团队服务 socket（无需手动设置） |

## 说明

- **首次激活种子化**：插件在会话中首次激活时，若你的全局配置中没有 `stepcodeAgentTeam` 表，会向 `config.toml` 追加一段注释默认值块。全部为注释（默认值照常生效）——取消注释即可覆盖，或整块删除。
- **已知妥协**：注册时固化的工具描述串（如模型列表）与本进程的深度门（`maxRecursionDepth`）不随项目级配置刷新；生效深度上限经 `STEPCODE_TEAM_MAXDEPTH` 向子成员传播，描述变化下一会话生效。
- **沙箱隔离**：`STEP_CODING_AGENT_DIR` 同时移动 agentDir 与全局配置根，沙箱因此绝不触碰你的真实配置。
