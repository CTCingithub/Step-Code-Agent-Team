# Custom Roles

[简体中文 →](./ROLES_CN.md)

Custom roles are reusable member configurations that behave exactly like the
bundled presets (`scout` / `planner` / `worker` / `reviewer` / `searcher`): drop a Markdown
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
| `tools` | no | Comma-separated allowlist; omit = all tools. Member-to-member messaging uses the built-in `topo_team_msg` tool (no `bash` required) |
| `model` | no | Member model; honored only while `models.autonomousSelection` is on (otherwise members follow the conversation model) |
| `effort` | no | Default effort: `off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`; invalid values are ignored |

## Effort resolution

An explicit `effort` argument to `team_create_member` always wins. Otherwise:

1. the `[stepcodeAgentTeam.presets.effort]` config override — applies to the
   built-in role names it ships with (`scout` / `planner` / `worker` /
   `reviewer` by default);
2. the role's own frontmatter `effort`;
3. the default (`high`).

When `models.autonomousEffort = true` the leader chooses the effort per
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

## The bundled `searcher` role

`searcher` ships with the plugin and is the one role whose job depends on
configuration. It retrieves external information — web search plus URL fetching
— and cites its sources.

Its tools are `read, grep, find, ls, search_web, run_command`. `run_command` is
there because the host ships no dedicated fetch tool, which is the price of a
real fetch capability, not an invitation to run anything else.

Endpoints and credentials come from the `[stepcodeAgentTeam.searcher]` config
table and reach the member as `STEPCODE_TOPO_SEARCH_URL`,
`STEPCODE_TOPO_SEARCH_KEY`, `STEPCODE_TOPO_FETCH_URL`, `STEPCODE_TOPO_FETCH_KEY`
and `STEPCODE_SEARCH_API_KEY` (the host search tool's own name — the configured
key arrives under both names). When the searcher config is configured the
leader also injects `STEPCODE_TOPO_SEARCH_SCRIPT`, the path of
`bin/topo-search.mjs`, and the role prefers that script: it prints one line of
JSON (`ok` / `kind` / `data` / `error` / `retryable` / `meta`), rate-limits
itself, and exits 0 on success, 1 on a failed request and 2 on a usage error
(a missing key is 2, not 1 — it is a configuration problem, so report it rather
than retrying). Without a configured provider the role falls back to
`search_web` plus `curl`.

Nothing here is tied to one provider: point `searchUrl` / `fetchUrl` at any
endpoint that speaks the script's JSON contract and set the matching key. The
DeepSeek endpoints are only the defaults. Note that the host `search_web`
Either spelling works — the **base** (`https://api.deepseek.com`) or the **full endpoint**
(`https://api.deepseek.com/v1/tools/search`); the script strips a duplicate
`/v1/tools/<kind>` suffix, so neither can produce a doubled path (which would
surface as a bare 404 that reads like an outage).
endpoint itself cannot be redirected from the environment — a configured
`searchUrl` is guidance for the role, not an override of that tool.

## Notes

- Project-level roles load only when the project is trusted.
- A role file's body becomes the member's system prompt (plus the plugin's
  coordination section).
- Read-only roles can use their topology edges: the built-in `topo_team_msg` tool needs no shell, so no `bash` is required.
