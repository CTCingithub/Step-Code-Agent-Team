# 自定义角色

[English →](./ROLES.md)

自定义角色是与内置预设（`scout` / `planner` / `worker` / `reviewer`）行为完全一致的
可复用成员配置：把一个带 frontmatter 的 Markdown 文件放进预设目录，即可通过
`team_create_member(role="<角色名>")` 用它创建成员。

## 角色目录与优先级

| 层级 | 目录 | 优先级 |
|---|---|---|
| 内置 | `<package>/agents/`（随插件分发） | 最低 |
| 用户级 | `<agentDir>/agents/`（默认 `~/.stepcode/agent/agents/`） | 中 |
| 项目级 | `<projectDir>/.stepcode/agents/`（仅项目被信任时加载） | 最高 |

角色以 frontmatter 的 `name` 为键：同名自定义文件**覆盖**内置预设，项目级覆盖
用户级。只读取 `.md` 文件；缺失 `name` 或 `description` 的文件被静默跳过。

## 文件格式

```
---
name: security-auditor
description: Audits changes for security issues without making changes
tools: read, grep, find, ls
model: step-5-preview
effort: medium
---
You are a security auditor. You read changes and judge them. You never modify
anything.
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 角色名，用于 `team_create_member(role=...)` |
| `description` | 是 | 一句话描述，亦出现在工具结果中 |
| `tools` | 否 | 逗号分隔的工具白名单；省略 = 全部工具。成员需要 `bash` 才能使用成员间消息通道 |
| `model` | 否 | 成员模型；仅 `models.autonomousSelection` 开启时生效（否则成员跟随对话当前模型） |
| `effort` | 否 | 默认 effort：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`；非法值忽略 |

## effort 解析规则

`team_create_member` 显式传 `thinking` 时始终优先。否则按序：

1. `[stepcodeAgentTeam.presets.effort]` 配置覆盖——仅对随配置内置的四个角色名
   （`scout` / `planner` / `worker` / `reviewer`）生效；
2. 角色自己的 frontmatter `effort`；
3. 默认值（`high`）。

当 `models.autonomousThinking = true` 时由队长逐成员选择 effort，预设 effort
（frontmatter 与配置）一律不生效。

## 使用方式

自定义角色与内置角色用法完全相同：

```
team_create_member(name="auditor1", role="security-auditor")
```

## 示例

### 只读安全审计员

```markdown
---
name: security-auditor
description: Audits changes for security issues without making changes
tools: read, grep, find, ls
effort: high
---
You are a security auditor. You read changes and judge them. You never modify
anything. Check for: injection, secrets in code, unsafe shell usage, path
traversal. Report findings with path:line references and a concrete fix.
```

### 带写权限的文档写手

```markdown
---
name: docs-writer
description: Writes and updates project documentation
tools: read, write, edit, grep, find, ls
effort: medium
---
You write and update documentation. Match the existing structure and tone.
Report what you changed and why.
```

### 低成本快速杂工

```markdown
---
name: quickfix
description: Handles small mechanical fixes at minimal cost
tools: read, edit, bash, grep
effort: low
---
You handle small, mechanical fixes (typos, renames, formatting). Make the
smallest change that satisfies the task and report it briefly.
```

## 注意事项

- 项目级角色仅在项目被信任时加载。
- 角色文件正文即成员的系统提示词（另加插件的团队协作段）。
- 只读角色没有 `bash`，指向它们的拓扑边不可用——由队长中转。
