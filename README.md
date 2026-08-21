# pi-gh-cli

[![CI](https://github.com/sfroment/pi-gh-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/sfroment/pi-gh-cli/actions/workflows/ci.yml)
[![Release](https://github.com/sfroment/pi-gh-cli/actions/workflows/release.yml/badge.svg)](https://github.com/sfroment/pi-gh-cli/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/@sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-gh-cli)
[![npm downloads](https://img.shields.io/npm/dm/@sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://www.npmjs.com/package/@sfroment/pi-gh-cli)
[![npm bundle size](https://img.shields.io/bundlephobia/min/@sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://bundlephobia.com/package/@sfroment/pi-gh-cli)
[![GitHub Release](https://img.shields.io/github/v/release/sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://github.com/sfroment/pi-gh-cli/releases)
[![GitHub stars](https://img.shields.io/github/stars/sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://github.com/sfroment/pi-gh-cli/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://github.com/sfroment/pi-gh-cli/commits)
[![GitHub commits since latest release](https://img.shields.io/github/commits-since/sfroment/pi-gh-cli/latest.svg?cacheSeconds=120)](https://github.com/sfroment/pi-gh-cli/releases)
[![license](https://img.shields.io/npm/l/@sfroment/pi-gh-cli.svg?cacheSeconds=120)](https://github.com/sfroment/pi-gh-cli/blob/main/LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-fd4b3a?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A [pi coding agent](https://github.com/earendil-works/pi-mono) extension that wraps the GitHub `gh` CLI as a single typed tool — **directly**, not via an MCP server.

## What it provides

- a `gh` custom tool with typed parameters (`subcommand` + `args` map + `repo` + `jsonFields` + `jq` + `limit` + `timeoutSeconds` + `forceDangerous`)
- a bundled `SKILL.md` documenting the tool and common `gh` commands
- per-turn prompt guidance when a prompt mentions GitHub, PRs, issues, repos, releases, workflows, or gists
- graceful detection of the "not authenticated" failure with actionable guidance
- a safety guard that refuses `repo delete`, `release delete`, and `codespace delete` (unrecoverable) unless `forceDangerous: true` is set

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
| `subcommand` | `string` | The full gh subcommand path (e.g. `"pr list"`, `"repo view"`, `"issue view 42"`). Top-level — never nest inside `args`. |
| `args` | `object` | A key/value object of flags ONLY — **never an array**, and do not nest `subcommand`/`jsonFields`/`jq`/`repo`/`limit` here. Booleans → bare `--flag` (`{web: true}` → `--web`). Strings/numbers → `--flag value` (`{state: "open"}` → `--state open`). Arrays → repeated `--flag value` pairs (`{label: ["bug","urgent"]}` → `--label bug --label urgent`). |
| `repo` | `string` | Target repository as `owner/repo` (→ `--repo owner/repo`). |
| `jsonFields` | `string[]` | Fields to return as JSON (→ `--json field1,field2`). |
| `jq` | `string` | jq expression to filter JSON output (→ `--jq expr`). |
| `limit` | `integer` | Maximum results (→ `--limit N`). |
| `timeoutSeconds` | `integer` | Command timeout (default 30, max 120). |
| `forceDangerous` | `boolean` | Opt-in for destructive commands (`repo delete`, `release delete`, `codespace delete`). |

## Examples

List open PRs in a repo:

```json
{
  "subcommand": "pr list",
  "args": { "state": "open" },
  "repo": "owner/repo",
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

GPL-3.0

## Links

- **Author:** [Sacha Froment](https://sacha42.com)
- **Source:** <https://github.com/sfroment/pi-gh-cli>
- **Issues:** <https://github.com/sfroment/pi-gh-cli/issues>
