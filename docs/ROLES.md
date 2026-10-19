# Custom Roles

[简体中文 →](./ROLES_CN.md)

Custom roles are reusable member configurations that behave exactly like the
bundled presets (`scout` / `planner` / `worker` / `reviewer`): drop a Markdown
file with frontmatter into a preset directory and `team_create_member` can
spawn members with it via `role="<name>"`.

## Where roles live

| Tier | Directory | Precedence |
|---|---|---|
| Bundled | `<package>/agents/` (ships with the plugin) | lowest |
| User | `<agentDir>/agents/` (default `~/.stepcode/agent/agents/`) | middle |
| Project | `<projectDir>/.stepcode/agents/` (trusted projects only) | highest |

Roles are keyed by their `name` frontmatter: a custom file **overrides** a
bundled preset with the same name, and project-level files override user-level
ones. Only `.md` files are read; files missing `name` or `description` are
skipped silently.

## File format

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

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The role name used in `team_create_member(role=...)` |
| `description` | yes | One line; also surfaced in tool results |
| `tools` | no | Comma-separated allowlist; omit = all tools. Member-to-member messaging uses the built-in `team_msg` tool (no `bash` required) |
| `model` | no | Member model; honored only while `models.autonomousSelection` is on (otherwise members follow the conversation model) |
| `effort` | no | Default effort: `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`; invalid values are ignored |

## Effort resolution

An explicit `thinking` argument to `team_create_member` always wins. Otherwise:

1. the `[stepcodeAgentTeam.presets.effort]` config override — applies to the
   built-in role names it ships with (`scout` / `planner` / `worker` /
   `reviewer` by default);
2. the role's own frontmatter `effort`;
3. the default (`high`).

When `models.autonomousThinking = true` the leader chooses the effort per
member, so preset efforts — frontmatter and config alike — are inert.

## Usage

Create a member with the custom role exactly like a built-in one:

```
team_create_member(name="auditor1", role="security-auditor")
```

## Examples

### Read-only auditor

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

### Writer with edit access

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

### Cheap quick-fix hand

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

## Notes

- Project-level roles load only when the project is trusted.
- A role file's body becomes the member's system prompt (plus the plugin's
  coordination section).
- Read-only roles can use their topology edges: the built-in `team_msg` tool needs no shell, so no `bash` is required.
