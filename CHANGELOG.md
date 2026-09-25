# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `limit` on `view` commands is now stripped from argv and executed (noted in the output, `limitStripped` detail) instead of failing the call — the model's intent (fetch the item) is unambiguous.
- `timeoutSeconds` above 120 that is a multiple of 1000 is treated as milliseconds (models echo CLI-style `60000`); the schema `maximum` is gone, the runtime clamp stays.
- The missing-`subcommand` error now states that `subcommand` is not remembered between calls.

### Added
- `assertLimitUsage` guard: `limit` on `view` commands (`pr`, `issue`, `run`, `release`, `repo`, `gist`, `codespace`, `workflow`, `ruleset`, `project` view) is refused with a working-form error instead of the CLI's bare "unknown flag: --limit" (flag-shaped `args.limit` included; retry suggestion tailored per pair — jsonFields where the view supports `--json`, plain output otherwise).

### Changed
- `limit` guidance in the tool description, prompt guidelines, and skill now states that only list-style commands accept `--limit`.
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
