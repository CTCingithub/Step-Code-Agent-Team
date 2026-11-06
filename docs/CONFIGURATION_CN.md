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

### 改配置前必读（排查「我改了却没生效」）

**全局表在 `dirname(STEP_CODING_AGENT_DIR)/config.toml`**——在 agentDir **旁边**，不在里面。沙箱下即 `sandbox/config.toml`（agentDir 是 `sandbox/agent`）；正常安装是 `~/.stepcode/config.toml`。**不存在** `sandbox/agent/config.toml`。

**配置只在队长进程加载扩展时读一次。** 会话运行中改动对该会话绝不生效——不是文件选错了，而是没有任何东西会重读它。请重启会话（或 `/reload`，但它同时把插件重置回默认关闭）。

**想确认「到底读了哪个文件、生效值是多少」**，用 `STEPCODE_TEAM_DEBUG=1` 运行：激活时插件会打印 `config: unified=<路径> topology.maxLoopCount=… dispatch.timeoutMs=… members.max=… plan.enabled=… plan.tier=…`，且对该文件的每次读取（成功与失败）都有 trace。于是你能区分「我读了你的文件，里面写的是 2」与「我从没打开过那个路径」。

沙箱注意：`sandbox/config.toml` 同时会**遮蔽 `cfg-*` 探针 fixture**（见 [TESTING_CN.md](TESTING_CN.md) C 层）——依赖 fixture 的探针运行时请做好隔离。

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
timeoutMs = 600000                   # 单次派发超时（ms）——覆盖成员整个回合，含嵌套中继
handshakeTimeoutMs = 15000           # 成员 spawn 握手超时
retries = 1                          # 仅对“尚未启动”的派发重试（0–5）

[stepcodeAgentTeam.oneshot]
timeoutMs = 600000                   # 无状态派发超时

[stepcodeAgentTeam.cost]
warnThreshold = 1                    # 累计花费告警阈值（美元）；0 = 禁用

[stepcodeAgentTeam.idle]
reapAfterMs = 1800000                # 空闲成员回收阈值（30 分钟）
reapIntervalMs = 300000              # 回收检查间隔（5 分钟）

[stepcodeAgentTeam.storage]
# dir 省略（null）= <agentDir>/teams
# dir 须为绝对路径：相对路径按 <agentDir> 解析（registry.ts teamsRoot），不按进程 cwd

[stepcodeAgentTeam.tasks]
max = 999                           # 任务板容量（id 为 T1..T<max>；1–10000）
outputCapBytes = 51200              # 单任务输出截断（字节）；全文保留在 details.fullText

[stepcodeAgentTeam.topology]
default = "star"                     # star/pipeline/mesh/ring/custom
requireDeclaration = false           # true = 未显式声明拓扑前禁止派活
maxLoopCount = 2                     # 环形消息链跳数上限（0 = 无上限，0–64）；计的是单次队长派发内嵌套中继的深度

[stepcodeAgentTeam.plan]
enabled = false                      # 团队方案选单：激活时给出经济/快速/均衡/性能 + 自定义
tier = "always ask"                  # always ask = 每次弹选单；固定档位则直接应用（选单与确认框均不弹）

[stepcodeAgentTeam.presets.effort]
scout = "low"                        # 按角色覆盖 effort（自定义角色在自己的 frontmatter 里写 effort）
planner = "medium"                   # models.autonomousEffort 开启时一律不生效（由队长选择）
worker = "medium"
reviewer = "high"
searcher = "medium"                  # searcher 角色（v0.4.0 新增）

[stepcodeAgentTeam.searcher]           # searcher 角色的检索/抓取端点与凭证（v0.4.0 新增）
searchUrl = ""                        # 空 = 宿主 search_web 的默认端点
searchApiKey = ""                     # 空 = 登录态 / STEPCODE_SEARCH_API_KEY
fetchUrl = ""                         # 空 = 对目标 URL 的普通无认证请求
# 两个 key 都留空时，searcher 角色会以 exit code 2 失败，并给出点名本表的提示——
# 缺凭证是配置问题而非请求失败，因此绝不重试。队长会注入你在此处设置的值，
# 无需手动 export 任何环境变量。
fetchApiKey = ""                      # 空 = 不带 Authorization 头
#
# 「空」的含义取决于你说的是哪个消费者，两者不同：**角色**回落到宿主工具
# （search 用 search_web 自己的凭证解析，fetch 用普通 curl），而**脚本**
# （bin/topo-search.mjs）回落到内置的 DeepSeek 端点与 DEEPSEEK_API_KEY。把 key
# 配上，非默认厂家对两条路才同时真正生效。
#
# 这四个键就是重点：searcher 角色**不绑定任何厂家**。把 searchUrl/fetchUrl 指向
# 任何遵循该脚本 JSON 契约的端点（{query,count,need_content} → {results}；
# {url} → {title,content}）并在此配上对应密钥即可。队长会把它们以
# STEPCODE_TOPO_SEARCH_URL / _SEARCH_KEY / _FETCH_URL / _FETCH_KEY 注入成员进程，
# 另有 STEPCODE_SEARCH_API_KEY 供宿主 search 工具，以及指向脚本本身的
# STEPCODE_TOPO_SEARCH_SCRIPT。

[stepcodeAgentTeam.encryption]         # 团队注册表的落盘加密（v0.4.0 新增，默认开）
enabled = true                        # AES-256-GCM；密钥在 .topo/team.key（0600）

[stepcodeAgentTeam.records]            # 团队协作记录（v0.4.1 新增）
enabled = true                        # 每次协作任务结束后向 .topo/records 写一份记录
dir = "records"                       # .topo/ 下的子目录名

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
| `storage` | 团队数据根目录（注册表、sessions、prompts、socket）；null = `<agentDir>/teams`。**相对** `dir` 按 **agentDir** 解析（不按启动目录——队长 cwd 任意且成员会继承，按 cwd 锚定会把同一团队的注册表撒布到不同项目目录）；绝对路径原样使用 |
| `tasks` | `max` 决定任务板容量（id 为 T1..T<max>；超出后创建报错并给出配置上限）；`outputCapBytes` 截断模型可见的单任务输出——全文保留在 `details.fullText` |
| `topology` | 成员间消息默认拒绝，除非声明的边允许。`requireDeclaration` 落实「先设计再开工」。`maxLoopCount` 约束链长（队长派发 = 0，每转发 +1）；超限跳被拒且发送方改为把结论写入最终报告——同时防止环形巡游死锁。成员经内置 `topo_team_msg` 工具直达通信（无需 bash，只读角色同样可用），边对所有角色可用；依赖请用任务板 `blockedBy` 表达 |
| `plan` | 团队方案选单（默认关）：激活时队长给出经济/快速/均衡/性能四种*策略* + 自定义流程（规模 → 拓扑 → effort）。带请求文本时，模型先经一次性规划调用（带进度动画）为该请求起草实际组队方案，Accept/取消 选择框展示该方案——批准后以高于一般性策略的优先级注入；裸 `/topo`（无请求）或规划调用失败时回退为该档位的标准方案形态。`tier = "always ask"`（默认）每次弹选单；**固定档位在每次激活（命令与关键词路径）直接应用——钉档即「别再问」：选单与三选项确认框一律不弹**（规划调用与确认仅发生在选单或 `/topo <档位名>` 显式路径）；`/topo <档位名>` 可按次覆盖（仍走实际方案确认）。选单超时/headless 回退 `balanced`；选项按语言本地化；无成本倍率 |
| `presets.effort` | 按角色覆盖 effort（内置角色名已列出；自定义角色在自己的 frontmatter 写 `effort`）。解析链：显式 `effort` 参数 → 本配置 → 预设 frontmatter → `high`。`models.autonomousEffort` 开启时不生效。预设随包发布（`agents/<role>.md`：scout/planner/worker/reviewer），可被 `<agentDir>/agents/` 与受信任项目的 `<project>/.stepcode/agents/` 遮蔽或扩展——见 [docs/ROLES.md](ROLES_CN.md) |
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

## 自动压缩（`[compaction]`，Step Code 0.1.7）

Step Code 会在会话上下文逼近模型窗口时自动压缩。自 0.1.7 起，触发条件是**上下文窗口的比例**而非固定预留，且配置在 **Step Code 自己的统一配置**里——**不在**本插件的表中：

```toml
[compaction]
triggerPolicy = "v2"            # 或 "legacy"（旧的固定预留行为）
triggerRatio = 0.9              # 0 < 比例 <= 0.95；默认 0.9
modelTriggerRatios = { "step/step-5-preview" = 0.8 }   # 按 provider/model 覆盖
tokenLimit = 120000             # 绝对上限；只能让压缩更早触发
```

非法值会**回落默认值**并进入 settings diagnostics，不会让运行失败。

**为什么这与团队相关**：成员进程以队长的环境启动（含 `STEP_CODING_AGENT_DIR`），因此与队长读写**同一份**全局 `config.toml`。你在这里设的内容对队长和每个成员**一视同仁**——没有插件级键可设，加一个也只会给同一行为制造两个真相来源。相位探针钉住了这个继承关系（phase32 的 "spawn env"），将来重构无法悄悄破坏它。

旧的固定预留在 64K 窗口下约 74% 触发，在 1M 窗口下却要到 ~98%；比例默认值 0.9 在两种窗口下都留有余量。长团队会话中，成员报告加任务板会很快填满窗口——想更早压缩就调低 `triggerRatio` 或设 `tokenLimit`。

## `.topo/` 与落盘加密（v0.4.0）

**`.topo/` 是什么**：插件在你**当前工作目录**下的工作目录。首次激活时自动创建（插件默认关闭，因此未激活的会话不会在你目录里留任何东西），并把 `.topo/` 追加进**已存在的** `.gitignore`——若没有 `.gitignore` 则**不会替你创建**。目前里面只放一个文件：`team.key`（加密密钥，32 字节 base64，权限 0600）。

**加密什么**：团队注册表 `registry.json`——它的 `tasks[].title/detail/result` 承载成员完整报告，是最敏感的载荷。算法 AES-256-GCM，信封带 `iv/tag/data` 与明文头 `teamId`/`cwd`（cwd 不敏感，读回时用它定位密钥文件）。`encryption.enabled = false` 时写明文。

**必须知道的边界（不要夸大）**：
- 防的是**其他用户读取**该文件，以及它被**误提交/误备份**；
- **不防同 uid 的攻击者**——他能连 `.topo/team.key` 一起读；
- **不覆盖宿主写出的成员会话 JSONL**（权限 0644，插件无权改写）——那仍是最大的真实暴露面，加密不解决它；
- **丢密钥 = 数据不可恢复**；
- 旧版本写的明文 `registry.json` **仍可正常读取**（读到信封走解密，否则按明文）。

**降级路径**：`.topo` 已存在但是文件、是符号链接（不跟随——避免把密钥写到链接指向的任意路径）、父目录只读、路径过长——全部降级：插件照常运行，只是不做落盘加密，并在 stderr 留一行说明。

### 协作记录（`.topo/records/`）

每次团队协作任务结束后（整队解散 `team_disband`、或 `/topo off` 停用；会话结束时团队仍活跃则补一份），插件向 `.topo/records/<teamId>-<UTC时间戳>.json` 写一份记录，并附同名 `.md` 人读摘要。内容：成员名册（角色/模型/effort/工具/状态/轮次/花费）、任务板全量（状态/负责人/依赖）、拓扑终态、累计花费与汇总计数。**幂等**：同一 teamId 不重复生成。

是否加密**按你的加密选项**：`encryption.enabled` 开启且有密钥 → 与 registry 同一套 AES-256-GCM 信封；否则明文。`records.enabled = false` 可完全关闭。降级原则与上面相同：记录写不进去只在 stderr 留一行，**绝不阻断解散或停用**。

## 环境变量覆盖

| 变量 | 作用 |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | 等价 `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | 覆盖 `cost.warnThreshold`（非法值忽略） |
| `STEPCODE_TEAM_MAXDEPTH=<n>` | 覆盖 `members.maxRecursionDepth`（1–4，非法值忽略）；队长按生效值注入子成员进程 |
| `STEPCODE_TEAM_SOCK` | 由队长自动注入成员进程，指向团队服务 socket（无需手动设置） |
| `STEPCODE_TOPO_SEARCH_URL` / `STEPCODE_TOPO_FETCH_URL` / `STEPCODE_TOPO_FETCH_KEY` / `STEPCODE_TOPO_SEARCH_KEY` / `STEPCODE_SEARCH_API_KEY` / `STEPCODE_TOPO_SEARCH_SCRIPT` | 由队长按 `[stepcodeAgentTeam.searcher]` 注入成员进程（searcher 角色按名取用；见 `docs/ROLES_CN.md`）。配置的 key 会以两个名字到达——`STEPCODE_TOPO_SEARCH_KEY`（脚本自己读的名字）与 `STEPCODE_SEARCH_API_KEY`（宿主 `search_web` 工具的名字）；脚本路径仅在 searcher 配置非空时才注入。仅在直接测 `bin/topo-search.mjs` 时才需要手工设置 |
| `STEPCODE_SEARCH_API_KEY` | searcher 的 `searchApiKey` 非空时由队长注入；也是宿主 `search_web` 自带的凭证键 |

## 说明

- **首次激活种子化**：插件在会话中首次激活时，若你的全局配置中没有 `stepcodeAgentTeam` 表，会向 `config.toml` 追加一段注释默认值块。全部为注释（默认值照常生效）——取消注释即可覆盖，或整块删除。
- **`default` 标记**：写成 `"default"` 的键表示*使用内置默认值*，加载器会把它解析为默认值。这正是种子化配置能扛住升级的原因：写字面量会把种子化那一刻的值钉死，并在此后永远压过新版本的默认值；而 `DEFAULT` 会跟着默认值走，且对数字、布尔、数组、字符串一律有效（已对全部 27 个键逐一实证）。省略该键效果相同，所以 `DEFAULT` 是"可以放心取消注释"的文档。
- **`"default"` 是保留 token——务必带引号。** 裸 `default`（不加引号）不是合法 TOML 标量：step 的配置读取器会**丢弃整表**，并静默带走你在该表里的全部真实设置。插件无法检测到这一点——表在我们的代码运行之前就已消失，且配置告警只在 debug 下输出——所以不会有任何提示。引号正是让它成为加载器可识别字符串的关键。已对 step 自己的读取器实证：`max = "default"` 可解析并解析为内置默认值、同表其余键不受影响；而 `max = default`（裸写，大小写皆然）会丢弃整表。
- **升级后会补上新选项**：块中每个段都带有所文档化它的插件版本。安装新版本后，下次激活只会追加新增或变更过的段——不会重复整块，也不会覆盖你写过的任何内容。你已经有的段（无论是注释参考还是你自己配的活动表）都算"已文档化"，因此旧安装不会被复制一份；标记为旧版本的段会被刷新，使其内部新增的键出现。在你取消注释之前，一切始终是注释。
- **已知妥协**：注册时固化的工具描述串（如模型列表）与本进程的深度门（`maxRecursionDepth`）不随项目级配置刷新；生效深度上限经 `STEPCODE_TEAM_MAXDEPTH` 向子成员传播，描述变化下一会话生效。
- **管辖范围**：本组设置仅管辖团队插件。内置 subagent 扩展（`subagent` / `agent_send` 工具）有各自的设置与生命周期；team 角色预设与 subagent agent 定义从同一批目录发现但独立解析。个人会话内 checklist 请用内置 `task_*` 工具——团队任务板是跨成员共享板。
- **沙箱隔离**：`STEP_CODING_AGENT_DIR` 同时移动 agentDir 与全局配置根，沙箱因此绝不触碰你的真实配置。
