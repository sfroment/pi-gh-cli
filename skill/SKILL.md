---
name: gh
description: Run GitHub CLI (gh) commands via the `gh` tool (a direct CLI wrapper, not MCP). Use for any question about repositories, pull requests, issues, releases, workflows, Actions, gists, code search, or raw API calls — especially when the user references GitHub, a repo, a PR, or an issue.
---

## When to Use

Use whenever the user asks about anything on GitHub — listing repos, viewing or creating PRs, triaging issues, checking CI/Actions runs, managing releases, searching code/issues/PRs, or making raw API calls. Triggers: "list my repos", "open PRs", "show issue 42", "merge the PR", "create a release", "check the workflow", "search for X on GitHub", "gh api".

**IMPORTANT**: The `gh` tool calls the GitHub CLI (`gh`) directly. It is **not** an MCP server — do not use the `mcp` gateway. The `gh` CLI must be installed and authenticated. If the tool returns "not authenticated", tell the user to run `gh auth login` via bash.

## Tool reference

The `gh` tool takes:

- `subcommand` (required, string) — the full gh CLI subcommand path (e.g. `"repo list"`, `"pr list"`, `"issue view 42"`). Top-level parameter — never nest it inside `args`.
- `args` (optional object) — a key/value object of flags ONLY (never an array; do not nest `subcommand`, `jsonFields`, `jq`, `repo`, or `limit` here). Booleans become bare `--flag` (`{web: true}` → `--web`). Strings/numbers become `--flag value` tokens (`{state: "open"}` → `--state open`). Arrays become repeated `--flag value` pairs (`{label: ["bug", "urgent"]}` → `--label bug --label urgent`). `false`/`null`/`undefined` are skipped.
- `repo` (optional string) — target repository as `owner/repo` (translates to `--repo owner/repo`).
- `jsonFields` (optional string[]) — GitHub fields to return as JSON (translates to `--json field1,field2,...`). Must be set before `jq`.
- `jq` (optional string) — jq expression to filter/project JSON output (translates to `--jq expr`). Requires `jsonFields` to produce JSON output; `--json` always precedes `--jq`.
- `limit` (optional integer) — maximum number of results (translates to `--limit N`).
- `timeoutSeconds` (optional, default 30, max 120) — command timeout.
- `forceDangerous` (optional boolean) — opt-in for destructive commands (`repo delete`, `release delete`, `codespace delete`). Requires explicit user confirmation.

### Call shape

All parameters are TOP-LEVEL siblings. `args` is a key/value object of flags ONLY — never an array, and never nest the other parameters inside it.

```json
{
  "subcommand": "pr list",
  "args": { "state": "open" },
  "repo": "owner/repo",
  "jsonFields": ["number", "title", "state"],
  "limit": 10
}
```

### Structured output

For parseable results, pass `jsonFields` and optionally `jq`:

```
subcommand: "pr list"
repo: "owner/repo"
jsonFields: ["number", "title", "state", "author"]
jq: ".[] | {number, title}"
```

This produces `gh pr list --repo owner/repo --json number,title,state,author --jq '.[] | {number, title}'`.

## Common gh subcommands

### Repos

- `repo list` — list your repos (`args: { limit: 10 }`).
- `repo view OWNER/REPO` — view repo details (`args: { web: true }` to open in browser).
- `repo clone OWNER/REPO` — clone a repo (`args: { depth: 1 }` for shallow).
- `repo create NAME` — create a new repo (`args: { public: true }` or `private: true`).
- `repo fork OWNER/REPO` — fork a repo.
- `repo sync` — sync a fork with its upstream.

### Pull requests

- `pr list` — list PRs (`args: { state: "open", limit: 10 }`; states: open|closed|merged|all).
- `pr view N` — view PR details (`args: { web: true }` to open in browser).
- `pr create` — create a PR (`args: { title: "feat: X", body: "description", base: "main", head: "feature-branch" }`).
- `pr merge N` — merge a PR (`args: { squash: true }` or `merge: true` or `rebase: true`).
- `pr diff N` — show the diff for a PR.
- `pr checkout N` — check out a PR locally.
- `pr review N` — review a PR (`args: { approve: true }` or `request_changes: true, body: "comment" }`).
- `pr comment N` — comment on a PR (`args: { body: "comment text" }`).
- `pr close N` — close a PR.
- `pr ready N` — mark a draft PR as ready for review.

### Issues

- `issue list` — list issues (`args: { state: "open", limit: 10 }`).
- `issue view N` — view issue details.
- `issue create` — create an issue (`args: { title: "Bug: X", body: "description", label: ["bug", "urgent"] }`).
- `issue close N` — close an issue.
- `issue comment N` — comment on an issue (`args: { body: "comment text" }`).
- `issue edit N` — edit an issue (`args: { title: "New title" }`).

### Releases

- `release list` — list releases.
- `release view` — view latest release (`args: { tag: "v1.0.0" }` for a specific tag).
- `release create TAG` — create a release (`args: { title: "Release title", notes: "changelog", draft: true }`).
- `release delete TAG` — delete a release. **Requires `forceDangerous: true`.**
- `release download TAG` — download release assets.

### Actions / Workflows

- `run list` — list recent workflow runs (`args: { limit: 5 }`).
- `run view N` — view a run (`args: { log: true }` for logs; `verbose: true` for steps).
- `workflow list` — list workflows.
- `workflow run ID` — trigger a workflow (`args: { ref: "main" }`).
- `workflow view ID` — view workflow details.

### Search

- `search repos` — search repositories (`args: { query: "language:typescript" }`).
- `search issues` — search issues (`args: { query: "repo:owner/repo is:issue is:open" }`).
- `search prs` — search pull requests.
- `search code` — search code (`args: { query: "func main repo:owner/repo" }`).
- `search commits` — search commits.

### Raw API

- `api ENDPOINT` — raw GitHub REST/GraphQL API call (`args: { method: "GET" }`; `subcommand: "api repos/owner/repo/issues"`).

### Full subcommand surface

The categories above cover the common cases. gh has many more top-level subcommands — the full list (run `gh --help` via bash for the authoritative version):

- `gist` — manage gists (create, list, view, clone, edit, delete).
- `codespace` — manage codespaces (create, list, ssh, cp, stop, delete).
- `secret` / `variable` — manage repo/org Actions secrets and variables.
- `org` — organization management (list, members, teams).
- `label` — manage repo labels (list, create, edit, delete, clone).
- `project` / `discussion` — GitHub Projects and Discussions (limited CLI support; prefer `api`).
- `run` / `workflow` — Actions runs and workflows (covered under Actions / Workflows).
- `release` — releases (covered under Releases).
- `cache` — manage Actions cache.
- `ruleset` / `rulesets` — repo/org rulesets.
- `extension` — manage gh extensions (install, list, upgrade).
- `alias` / `config` — CLI aliases and config (`gh config get editor`).
- `auth` — authentication (`gh auth status`, `gh auth login`, `gh auth refresh`).
- `gpg-key` / `ssh-key` — manage GPG and SSH keys.
- `attestation` / `browse` / `status` / `completion` / `reference` — misc (browse opens the repo in a browser; `gh status` shows notifications).
- `repo` / `issue` / `pr` — covered under Repos / Issues / Pull requests.

For any subcommand not listed, run `gh <subcommand> --help` via bash to see its flags.

## Pitfalls

- **`args` is an object, never an array** — pass `{ state: "open" }`, not `["--state","open"]`. The tool tolerates an array but it's not the correct shape.
- **Never nest parameters inside `args`** — `subcommand`, `jsonFields`, `jq`, `repo`, `limit` are top-level siblings of `args`, not keys inside it.
- **`repo delete`, `release delete`, and `codespace delete` are refused** by the tool unless `forceDangerous: true` is set. Always confirm with the user before using it — these operations are unrecoverable.
- **Auth failures** — if the tool returns "not authenticated", tell the user to run `gh auth login` via bash. Do NOT retry the tool in a loop.
- **gh not installed** — if the tool reports `gh` is not on PATH, tell the user to install it from https://cli.github.com/ or via `brew install gh`.
- **`--json` must precede `--jq`** — the tool handles this automatically (jsonFields → `--json`, then jq → `--jq`), but if you pass raw args via the `args` map, ensure you don't inject `--jq` before `--json`.
- **Use `jsonFields` + `jq` for structured output** — the default text output is hard to parse. Pass `jsonFields: ["number", "title", "state"]` and optionally a `jq` expression for clean, parseable results.
- **`subcommand` is split on whitespace** — `"issue view 42"` becomes `["issue", "view", "42"]`. Do not quote subcommands.
- **`repo` override** — if you pass `repo: "owner/repo"`, it adds `--repo owner/repo` to the command. This works for any subcommand, even when operating on a different repo than the cwd.
- **Large output is truncated** — the tool caps output at 2000 lines / 50KB. Use `limit` to cap results proactively.

## Verification

1. `gh` tool with `subcommand: "auth status"` exits 0 and shows the authenticated account.
2. `gh` tool with `subcommand: "repo list", limit: 3` returns up to 3 repositories.
3. For structured output: `subcommand: "pr list", repo: "owner/repo", jsonFields: ["number", "title", "state"], limit: 5` returns JSON.
4. For write ops (create PR, merge, close issue), re-query with a list/view to confirm the change landed before reporting success.
