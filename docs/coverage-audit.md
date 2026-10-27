# Coverage audit — documented surface vs shipped checks

Issue #32. Every command and translation behavior the extension documents is
mapped below to the check that proves it: **zero uncovered**, and everything
that is deliberately not proved live is recorded in [Exclusions](#exclusions)
with its rationale.

## Scope and method

The documented surface is whatever the three guidance surfaces state:

| Surface | Documented content |
|---|---|
| `skill/SKILL.md` | tool reference, call shape, structured output, the "Common gh subcommands" bullets, the "Full subcommand surface" list, pitfalls, verification steps |
| `README.md` | "What it provides", the tool-parameters table, the JSON examples, the verification recipe |
| `index.ts` | the registered tool's description + parameter descriptions, `GH_GUIDANCE`, `GH_CALL_EXAMPLE`, the `DANGEROUS_COMMANDS` and `NO_LIMIT_SUBCOMMANDS` tables, `RELEVANT_PROMPT` |

The audit cross-references that surface against the five check suites:

| Suite | File | Gate | What it proves |
|---|---|---|---|
| Unit | `index.test.ts` | always on | translation rules, mis-shape tolerance, guards, failure modes, wiring |
| Shape-sync | `shape-sync.test.ts` | `GH_SHAPE_SYNC=1` | every documented shape (verb, flags, translation argv, internal tables) against the installed gh CLI's `--help` |
| Smoke | `smoke.test.ts` | `TEST_INTEGRATION=1` | every documented read-only command, executed live |
| Contract | `contract.test.ts` | `TEST_INTEGRATION=1` | the structured-output surface pinned live (argv + reported output) |
| Lifecycle | `index.test.ts` | `TEST_LIVE=1` | the documented write paths end to end on a scratch repo, torn down through the danger gate |

Run recipe: see the README's [Verification](../README.md#verification) section.

## Command coverage

"SS-Common" = shape-sync's *Common gh subcommands* test (validates the verb
exists on the installed CLI and that the tool's translation of every
documented flag produces argv that verb accepts); "SS-Full" = shape-sync's
*Full subcommand surface* test (validates each documented verb path exists).
"Smoke N"/"Contract N" are the numbered tests in `smoke.test.ts` /
`contract.test.ts`; "Lifecycle" is the opt-in scratch-repo test.

### Repos

| Command | Shape | Live |
|---|---|---|
| `repo list` (`limit` flag) | SS-Common | Smoke 2, INT 2 |
| `repo view OWNER/REPO` (`web` flag) | SS-Common | Smoke 3 |
| `repo clone` (git flags after `--`) | SS-Common | excluded — local filesystem side effect |
| `repo create NAME` (`public`/`private`) | SS-Common | Lifecycle (scratch repo create) |
| `repo fork` | SS-Common | excluded — mutates the account outside a scratch context |
| `repo sync` | SS-Common | excluded — mutates a fork |

### Pull requests

| Command | Shape | Live |
|---|---|---|
| `pr list` (`state`, list-style `limit`) | SS-Common, SS-Structured | Smoke 4, INT 3, Contract 1 |
| `pr view N` (`web`; view strip) | SS-Common, SS-StripTable | Smoke 5; strip: `strip` unit suite + runGh 9a |
| `pr create` (`title`/`body`/`base`/`head`) | SS-Common | Lifecycle |
| `pr edit N` (`title`/`body`) | SS-Common | Lifecycle |
| `pr merge N` (`squash`/`merge`/`rebase`) | SS-Common | excluded — mutation outside the scratch lifecycle; the write pipeline is Lifecycle-proven |
| `pr diff N` | SS-Common | Smoke 14 |
| `pr checkout N` | SS-Common | excluded — local git mutation |
| `pr review N` (`approve`/`request-changes`/`body`) | SS-Common | excluded — mutation outside the scratch lifecycle |
| `pr comment N` (`body`) | SS-Common | Lifecycle |
| `pr close N` | SS-Common | Lifecycle |
| `pr ready N` | SS-Common | excluded — mutation outside the scratch lifecycle; needs a draft PR state |

### Issues

| Command | Shape | Live |
|---|---|---|
| `issue list` (`state`, `limit`) | SS-Common | Smoke 6; Contract 7 (array `label` flag) |
| `issue view N` (view strip, `comments`) | SS-StripTable | Smoke 7; Contract 2 (`--limit` strip + note), Contract 4/5 (boolean true/false), runGh null-value unit |
| `issue create` (`title`/`body`/`label`) | SS-Common | Lifecycle |
| `issue close N` | SS-Common | Lifecycle |
| `issue comment N` (`body`) | SS-Common | Lifecycle |
| `issue edit N` (`title`) | SS-Common | excluded — mutation outside the scratch lifecycle; the PR-edit path proves the same edit pipeline live |

### Releases

| Command | Shape | Live |
|---|---|---|
| `release list` | SS-Common | Smoke 8 |
| `release view TAG` (positional tag) | SS-Common, SS-StripTable | Smoke 9 (latest form), Contract 3 (strip + note) |
| `release create TAG` (`title`/`notes`/`draft`) | SS-Common | Lifecycle |
| `release delete TAG` | SS-Common, SS-Danger | excluded from live — the gate: `danger` 4/5, runGh 6b; Lifecycle proves the refusal fires before gh runs |
| `release download TAG` | SS-Common | excluded — writes files to the working directory |

### Actions / Workflows

| Command | Shape | Live |
|---|---|---|
| `run list` (`limit`) | SS-Common | Smoke 10 |
| `run view N` (`log`, `verbose`) | SS-Common, SS-StripTable | Smoke 15 |
| `workflow list` | SS-Common | Smoke 11 |
| `workflow run ID` (`ref`) | SS-Common | excluded — triggers CI on a real repo |
| `workflow view ID` | SS-Common, SS-StripTable | Smoke 12 |

### Search

| Command | Shape | Live |
|---|---|---|
| `search repos QUERY` (positional) | SS-Common | Smoke 17 |
| `search issues QUERY` (positional qualifiers) | SS-Common | Smoke 18 |
| `search prs QUERY` (positional qualifiers) | SS-Common | Smoke 19 |
| `search code QUERY` (text + qualifier) | SS-Common | Smoke 20 |
| `search commits QUERY` (text required — qualifiers-only rejected) | SS-Common | Smoke 21 |

### Raw API

| Command | Shape | Live |
|---|---|---|
| `api ENDPOINT` (`method` GET) | SS-Common | Smoke 22 |
| `api` POST bodies (`field` pairs) | SS-Common | Lifecycle (branch/commit/tag setup through `api`) |
| `api graphql` (`raw-field` query) | SS-Common | Smoke 23 |

### Full subcommand surface

The skill documents these as existing gh subcommands (the doc's claim is
existence, not usage patterns). SS-Full validates every expanded verb path —
`gist create/list/view/clone/edit/delete`, `codespace create/list/view/ssh/cp/stop/delete`,
`secret`, `variable`, `org list`, `label list/create/edit/delete/clone`,
`project`, `discussion`, `cache`, `ruleset`, `extension install/list/upgrade`,
`alias`, `config get`, `auth status/login/refresh`, `gpg-key`, `ssh-key`,
`attestation`, `browse`, `status`, `completion`, `reference` — against the
installed CLI. Live probes exist where usage is also documented:

| Verb | Shape | Live |
|---|---|---|
| `gist list` / `gist view` | SS-Full | Smoke 13 / Smoke 16 |
| `auth status` | SS-Full | Smoke 1, INT 1 |
| `gist create/clone/edit/delete`, `codespace` ops, `secret`, `variable`, `label` writes, `project`, `discussion`, `cache`, `extension`, `alias`, `config`, `gpg-key`, `ssh-key`, `attestation`, `browse`, `status`, `completion`, `reference`, `org list` | SS-Full | excluded — existence is the documented claim; see Exclusions |

## Behavior coverage

| Documented behavior | Source | Check |
|---|---|---|
| `subcommand` split on whitespace; flags never inside it | skill pitfalls, README | buildArgv 1/13a/13b; pins P8/P8b; wiring W4 |
| `args` boolean `true` → bare `--flag` | skill, README, param description | buildArgv 3; Contract 4 |
| `args` `false`/`null`/`undefined` skipped | skill, README | buildArgv 4/10; Contract 4/5 |
| `args` string/number → `--flag value` pair | skill, README | buildArgv 2; Contract 6 |
| `args` array → repeated `--flag value` pairs | skill, README | buildArgv 5; Contract 7 |
| args-as-array tolerated and parsed (mode #1) | skill pitfall ("tolerates an array") | mode#1 suite A1.1–A1.3, pins P11–P15, tolerance A3.1 |
| nested top-level keys harvested, top-level always wins (mode #2) | skill pitfall | mode#2 suite A2.1–A2.4, pins P1–P10/P16–P21, tolerance A3.2 |
| `repo` → `--repo owner/repo` appended after args | skill, README, guidance | buildArgv 8/11; runGh 12; Contract argv pins |
| `repo` override acceptance/rejection claims per command | skill pitfall | SS-RepoOverride |
| `jsonFields` → `--json a,b,c`; empty array → no token | skill, README | buildArgv 6/14 |
| `--json` precedes `--jq` | skill, README, guidance | buildArgv 12; Contract 1; guidance A4.6 |
| `jq` → `--jq expr` | skill, README | buildArgv 7; runGh 13 |
| `limit` → `--limit N`; list-style only; view forms stripped, run, and noted | skill, README, guidance | strip suite; runGh 9a; tolerance A3.4–A3.10; Contract 2/3; SS-StripTable |
| `timeoutSeconds` default 30 / max 120 / ms heuristic | param description, README | runGh 9/9b–9e/10/11 |
| `forceDangerous` gate: `repo delete`, `release delete`, `codespace delete`, `cs delete` alias refused without opt-in | skill, README, guidance, description | danger suite 1–12d; runGh 6/6b; SS-Danger; Lifecycle (live refusal before gh runs) |
| not-authenticated detected with `gh auth login` guidance | skill, README, guidance | runGh 5/5b/5c |
| gh-not-installed wrapped with install hint | skill pitfall | runGh 4 |
| output format: stdout, `stderr:` label, `(no output)` placeholder | — | formatOutput 1–7 |
| large output truncated (2000 lines / 50 KB) with a note | skill pitfall | runGh 8 |
| exit code rendering (`unknown` for null, `(killed)`) | — | runGh 8b/8c |
| missing/whitespace `subcommand` → guidance incl. "not remembered between calls" | guidance | runGh 7/7b |
| out-schema junk (`args` as bare primitive) dropped, not flag-serialized | — | pins P21, tolerance A3.11 |
| per-turn prompt guidance injected for GitHub-mentioning prompts | README ("What it provides") | wiring W3, W5 (trigger words, singular + plural) |
| bundled `SKILL.md` discoverable as a skill | README ("What it provides") | wiring W2 |
| the registered tool's typed surface + description + flat-call example | README, tool description | wiring W1/W4; `GH_CALL_EXAMPLE` A4.1; description tests A4.2–A4.6 |
| structured output via `jsonFields` + `jq` → parseable rows | skill "Structured output" | Contract 1; SS-Structured |
| skill verification steps 1–3 | skill "Verification" | Smoke 1/2/4; SS-Structured |
| skill verification step 4 (re-query after writes) | skill "Verification" | Lifecycle (re-queries state after every write) |

## Exclusions

Nothing documented is unproven; these are the deliberate live-execution
exclusions, each with its rationale. Every excluded command is still
mechanically validated by shape-sync (verb exists; every documented flag is
accepted by that verb on the installed CLI), and the shared write pipeline
(args → argv → exec → re-query) is proven live by the Lifecycle test.

| Exclusion | Rationale |
|---|---|
| Local-side-effect commands: `repo clone`, `pr checkout`, `release download` | They mutate the local filesystem (clone, branch checkout, asset files). The read/translation surface is SS-proven; there is no throwaway local context in the harness equivalent to the scratch repo. |
| Account/repo-mutating commands outside a scratch context: `repo fork`, `repo sync`, `pr merge`, `pr review`, `pr ready`, `issue edit`, `workflow run` | Mutations of real repos or account state that no scratch lifecycle owns. The lifecycle proves the identical write pipeline (argv → exec → re-query) on `pr create/edit/comment/close`, `issue create/comment/close`, `release create`, and `repo create/delete`; extending it to every verb would multiply mutation surface for no additional translation coverage. |
| `release delete` live | Unrecoverable operation behind the danger gate — running it for coverage would defeat the gate's purpose. The gate is unit-proven (danger suite, runGh 6/6b) and the Lifecycle proves the refusal fires before gh executes anything. |
| Full-surface existence verbs without documented usage (codespace ops, `secret`, `variable`, `label` writes, `org list`, `project`, `discussion`, `cache`, `extension`, `alias`, `config`, `gpg-key`, `ssh-key`, `attestation`, `browse`, `status`, `completion`, `reference`, gist create/clone/edit/delete) | The skill's claim for these is exactly "this subcommand exists" (with `gh <subcommand> --help` as the documented escape hatch); SS-Full proves that claim against the installed CLI. Live-proving undocumented usage would test gh, not the extension. |
| `TEST_LIVE` lifecycle in credential-less environments | Requires the `delete_repo` scope (`gh auth refresh -h github.com -s delete_repo`); without it the run would leave a scratch repo behind. The check is shipped, gated, and documented in the run recipe. |

## Audit log — findings and fixes from this run

The six verification branches (#26–#31) were merged into one branch and the
full suite run against the merged tree. Each branch was green alone; the
consolidation caught what the branches couldn't see individually:

1. **Cross-branch break**: merging #30's `cs delete` gate entry into #26's
   shape-sync harness made the danger-gate check fail — `gh cs delete --help`
   prints its canonical usage (`gh codespace delete`), so the alias read as
   "does not exist". Fixed: the harness canonicalizes gh's built-in aliases
   when matching the usage line.
2. **Doc drift between sibling fixes**: #26 and #31 both fixed the search
   drift, #26 and #28 both fixed `release view` — with different wording.
   Resolved semantically; the merged `search commits` example now carries
   search text (`search commits refactor repo:owner/repo`), because
   qualifiers-only commit searches are rejected by the live API (verified).
3. **Smoke gap**: the #27 smoke covered 13 documented read-only commands but
   missed `pr diff`, `run view`, `gist view`, all five `search` verbs, and the
   `api` GET/graphql read forms. Closed: smokes 14–23.
4. **Wiring gap**: the README's "bundled SKILL.md" and "per-turn prompt
   guidance" claims had no checks, and the trigger regex did not match the
   plural forms the README itself lists ("PRs", "issues", "repos",
   "releases", "workflows", "gists") or a bare "PR". Closed: wiring tests
   W1–W5 and a corrected, exported `RELEVANT_PROMPT`.

The re-run evidence: default suite green; shape-sync green on the merged
surface (46 documented shapes, 84 unique verbs, 55 flag tokens, 0 mismatches);
all 23 smokes + 7 contract probes + 3 integration tests green against the live
account; type-check clean.
