# GitHub CLI (gh) Pi extension

A [pi coding agent](https://github.com/earendil-works/pi-mono) extension that wraps the GitHub `gh` CLI as a single typed tool — **directly**, not via an MCP server.

## What it provides

- a `gh` custom tool with typed parameters (`subcommand` + `args` map + `repo` + `jsonFields` + `jq` + `limit` + `timeoutSeconds` + `forceDangerous`)
- a bundled `SKILL.md` documenting the tool and common `gh` commands
- per-turn prompt guidance when a prompt mentions GitHub, PRs, issues, repos, releases, workflows, or gists
- graceful detection of the "not authenticated" failure with actionable guidance
- a safety guard that refuses `repo delete` and `release delete` (unrecoverable) unless `forceDangerous: true` is set

## Why not MCP?

The `gh` CLI already exposes the full GitHub API (repos, PRs, issues, releases, Actions, gists) and uses the user's existing `gh auth login` credentials. Wrapping it in a typed pi tool gives structured, discoverable parameters and output truncation without an extra server process.

## Requirements

- `gh` CLI on PATH — [cli.github.com](https://cli.github.com/)
- Authenticated via `gh auth login`

## Installation

Drop the extension into `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local), then reload:

```text
/reload
```

Or install from git:

```bash
pi install git:github.com/sfroment/pi-gh-cli
```

## Tool parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subcommand` | `string` | The gh subcommand (e.g. `"pr list"`, `"repo view"`, `"issue view 42"`). |
| `args` | `object` | Command flags as a key/value map. Booleans → bare flags (`{web: true}` → `--web`). Strings/numbers → `key=value`. Arrays → repeated tokens (`{label: ["bug","urgent"]}` → `--label bug --label urgent`). |
| `repo` | `string` | Target repository as `owner/repo` (→ `--repo owner/repo`). |
| `jsonFields` | `string[]` | Fields to return as JSON (→ `--json field1,field2`). |
| `jq` | `string` | jq expression to filter JSON output (→ `--jq expr`). |
| `limit` | `integer` | Maximum results (→ `--limit N`). |
| `timeoutSeconds` | `integer` | Command timeout (default 30, max 120). |
| `forceDangerous` | `boolean` | Opt-in for destructive commands (`repo delete`, `release delete`). |

## Examples

List open PRs in a repo:

```json
{
  "subcommand": "pr list",
  "repo": "owner/repo",
  "args": { "state": "open" },
  "jsonFields": ["number", "title", "state"],
  "limit": 10
}
```

View a specific issue:

```json
{
  "subcommand": "issue view 42",
  "repo": "owner/repo",
  "args": { "comments": true }
}
```

## Development

```bash
bun test          # pretest links pi runtime deps automatically
bunx tsc --noEmit # type-check
```

## License

MIT
