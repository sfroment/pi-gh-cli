# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Opt-in live lifecycle test (`TEST_LIVE=1`): creates a private scratch repo, runs the PR (create/view/edit/comment/close), issue (create/comment/close), and release (create/view) lifecycles through the documented shapes, then tears the scratch repo down through the danger-gated delete (`forceDangerous: true` + `repo delete`) and verifies its absence by re-listing. Requires an authed gh with the `delete_repo` scope (`gh auth refresh -h github.com -s delete_repo`).

### Fixed
- Skill drift found by the live lifecycle run: `release view` takes the tag as a positional argument (`release view v1.0.0`) — the documented `--tag` flag is rejected by gh; the skill now documents the positional shape, and the previously undocumented `pr edit N` is added to the PR section.
- `limit` on `view` commands is now stripped from argv and executed (noted in the output, `limitStripped` detail) instead of failing the call — the model's intent (fetch the item) is unambiguous.
- `timeoutSeconds` above 120 that is a multiple of 1000 is treated as milliseconds (models echo CLI-style `60000`); the schema `maximum` is gone, the runtime clamp stays.
- The missing-`subcommand` error now states that `subcommand` is not remembered between calls.
- A bare primitive `args` (out-schema junk that can reach the tool as raw JSON) is now dropped instead of serializing into per-character `--0 o` flags.

### Changed
- Internal, no behavior change: the typed-flag argv serialization rule inside `buildArgv` (skip falsy · bare flag for `true` · repeated pairs for arrays · flag+String otherwise) is now a pure seam, `flagValueTokens` (buildArgv CRAP 16 → 9, the seam at 7, both at 100% line coverage) — every module now sits at CRAP ≤ 10.
- The mutation-testing ledger is closed: the four killable survivors are killed by new pins (empty `jsonFields` emits no `--json`; single-char and whitespace-only output boundaries in `formatOutput`), and the remaining sixteen are hand-proven equivalent (loop-bound pairs that can only form `"word undefined"`, `??` operators where the only falsy-difference value produces the same result, empty-object-vs-undefined args returns that serialize identically through every consumer, and a timeout boundary made inert by its `% 1000` conjunct).
- Internal, no behavior change: `runGh` is now single-level orchestration over three pure seams — `coerceTimeoutSeconds` (timeout policy), `isAuthFailure` (auth-failure predicate), `buildCommandResult` (result assembly) — with the return shape named `GhToolResult` (runGh and each seam at CRAP ≤ 10 with 100% line coverage).
- `limit` guidance in the injected prompt guidance and skill now states that only list-style commands accept `--limit`.
- Internal, no behavior change: the mis-shape tolerance layer (`normalizeParams`) is now data-driven — one spec table per mis-shape mode replaces the per-key hand-rolled branches, split into `parseFlagToken`/`parseArrayArgs`/`mergeNestedArgs`/`harvestNestedArgs` (each of the split functions at CRAP ≤ 10 with 100% line coverage). The dead `VIEW_PAIRS_WITH_JSON` constant left from the replaced `assertLimitUsage` guard is gone.
- Removed environment-specific references from docs and packaging (author email domain).
- Made `scripts/link-pi-deps.sh` portable (PI_RUNTIME_DIR override + `npm root -g`, no hardcoded paths).
- Regenerated `bun.lock` against the public npm registry (format v2, no registry URLs); CI and release workflows bumped to bun 1.4 for the lockfile format, with a Type-check step (`tsc --noEmit`, pinned `typescript` devDependency) added to both.

## [1.0.0] - 2026-08-05

### Added
- `gh` tool: typed wrapper around the GitHub `gh` CLI with `subcommand` + `args`
  map + `repo` + `jsonFields` + `jq` + `limit` + `timeoutSeconds` +
  `forceDangerous` parameters.
- Prompt guidance injected when a prompt mentions GitHub / PRs / issues / repos /
  releases / workflows / gists.
- Bundled `gh` skill documenting the tool and common `gh` commands.
- Safety guards: refuses `repo delete`, `release delete`, `codespace delete`
  (unrecoverable) unless `forceDangerous: true`; detects "not authenticated" and
  returns actionable `gh auth login` guidance; output truncation.
- Runtime tolerance for two common mis-shaped calls: `args` as a JSON array
  (positional tokens) and `subcommand`/`jsonFields` nested inside `args`. An
  internal `normalizeParams` step at the `buildArgv`/`runGh` seams coerces both
  to the correct argv, and `runGh` normalizes before `assertSafeCommand` so a
  nested dangerous command cannot bypass the guard.
- Single-source content constants (`GH_CALL_EXAMPLE`, `GH_ARGS_DESCRIPTION`,
  `GH_SUBCOMMAND_DESCRIPTION`) wired into the tool description, schema, prompt
  guidelines, `GH_GUIDANCE`, `SKILL.md`, and `README.md`.
- 61 tests — pure helpers (`buildArgv`, `assertSafeCommand`, `formatOutput`)
  tested directly, `runGh` tested via dependency injection at the `GhExec`
  system boundary; content-contract tests for the guidance constants.
- `scripts/link-pi-deps.sh` + `pretest` hook for reproducible test resolution.
- GPL-3.0 license.
