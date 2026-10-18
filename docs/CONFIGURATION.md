# 配置参考

Step-Code-Agent-Team 通过一个 JSON 配置文件控制全部行为参数。

## 位置与优先级

```
全局：  <agentDir>/stepcode-agent-team.json
       （agentDir 遵循 STEP_CODING_AGENT_DIR，默认 ~/.stepcode/agent；
         开发沙箱中自动指向 sandbox/agent，互不干扰）
```

优先级：**内置默认 < 配置文件 < 环境变量覆盖**。

- 文件为标准 JSON（不支持注释）。
- 未知键会被忽略（`debug: true` 时在 stderr 打印提示）。
- 非法值回退为默认值并在 debug 日志中警告。
- 配置在扩展加载时读取一次并缓存；修改后需新会话生效（`/reload` 会重新读取，但插件也会随之回到默认关闭状态）。
- 预留：项目级配置（`<cwd>/.stepcode/stepcode-agent-team.json`）尚未接入——项目信任信息只在事件处理器中可用，会破坏"注册工具前加载配置"的时序。

## 环境变量覆盖

| 变量 | 作用 |
|---|---|
| `STEPCODE_TEAM_DEBUG=1` | 等价 `debug: true` |
| `STEPCODE_TEAM_COST_WARN=<usd>` | 覆盖 `cost.warnThreshold`（非法值忽略） |
| `STEPCODE_TEAM_SOCK` | 由队长自动注入成员进程，指向团队服务 socket（无需手动设置） |

## 完整配置项

```jsonc
{
  "activation": {
    "enabled": true,                  // 总开关：false 时任何触发都不激活
    "keywords": ["agent team", "智能体团队", "..."],   // 自然语言触发词；[] = 禁用关键词激活
    "notifyOnActivate": true          // 激活时是否 notify 提示
  },
  "models": {
    "available": ["step-5-preview"],  // 成员可用模型列表
    "autonomousSelection": false,     // 对话模型自主为子代理选模型
    "autonomousThinking": false       // 对话模型自主为子代理选思考强度
  },
  "members": {
    "max": 8,                         // 团队成员上限（1–64）
    "defaultRole": "worker",          // 未指定 role 时的默认角色（命中同名预设）
    "defaultTools": null              // 成员默认工具白名单；null = 用预设或全量
  },
  "dispatch": {
    "maxConcurrent": 4,               // 全局并发调度上限（1–16）
    "timeoutMs": 180000,              // 单次 dispatch/promptAndSettle 超时
    "handshakeTimeoutMs": 15000,      // 成员 spawn 握手超时
    "retries": 1                      // 任务失败重试次数（0–5）
  },
  "oneshot": {
    "timeoutMs": 180000               // oneshot 进程超时
  },
  "cost": {
    "warnThreshold": 1                // 累计花费告警阈值（美元）；0 = 禁用
  },
  "idle": {
    "reapAfterMs": 1800000,           // 空闲成员回收阈值（30 分钟）
    "reapIntervalMs": 300000          // 回收检查间隔（5 分钟）
  },
  "storage": {
    "dir": null                       // 团队数据根目录；null = <agentDir>/teams
  },
  "debug": false                      // 调试日志（模型裁决、配置警告、socket 错误）
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
