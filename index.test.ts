import { assertSafeCommand, buildArgv, formatOutput, runGh, stripLimitForViewCommands, GH_GUIDANCE, GH_CALL_EXAMPLE, GH_ARGS_DESCRIPTION, GH_SUBCOMMAND_DESCRIPTION, type ExecResult, type GhExec, type GhParams } from "./index.ts";
import { describe, expect, mock, test } from "bun:test";

describe("buildArgv", () => {
	test("1. subcommand split on spaces", () => {
		expect(buildArgv({ subcommand: "repo list" })).toEqual(["repo", "list"]);
	});

	test("2. args become --flag value token pairs", () => {
		expect(
			buildArgv({ subcommand: "pr list", args: { state: "open", limit: 10 } }),
		).toEqual(["pr", "list", "--state", "open", "--limit", "10"]);
	});

	test("3. boolean true becomes a bare --flag", () => {
		const argv = buildArgv({ subcommand: "repo view", args: { web: true } });
		expect(argv).toContain("--web");
		expect(argv).not.toContain("--web=true");
		expect(argv).not.toContain("web=true");
	});

	test("4. boolean false is omitted", () => {
		const argv = buildArgv({ subcommand: "repo view", args: { web: false } });
		expect(argv).not.toContain("--web");
		expect(argv).not.toContain("web");
		expect(argv).not.toContain("web=false");
	});

	test("5. array values become repeated --flag value pairs", () => {
		expect(
			buildArgv({ subcommand: "pr list", args: { label: ["bug", "urgent"] } }),
		).toEqual(["pr", "list", "--label", "bug", "--label", "urgent"]);
	});

	test("6. jsonFields produce --json with comma-joined fields", () => {
		const argv = buildArgv({
			subcommand: "pr list",
			jsonFields: ["number", "title", "state"],
		});
		expect(argv).toContain("--json");
		expect(argv).toContain("number,title,state");
	});

	test("7. jq produces --jq with the expression", () => {
		const argv = buildArgv({ subcommand: "pr list", jq: ".[].title" });
		expect(argv).toContain("--jq");
		expect(argv).toContain(".[].title");
	});

	test("8. repo produces --repo with the value", () => {
		const argv = buildArgv({ subcommand: "pr list", repo: "owner/repo" });
		expect(argv).toContain("--repo");
		expect(argv).toContain("owner/repo");
	});

	test("9. limit produces --limit with the value", () => {
		const argv = buildArgv({ subcommand: "pr list", limit: 5 });
		expect(argv).toContain("--limit");
		expect(argv).toContain("5");
	});

	test("10. null and undefined args values are skipped", () => {
		expect(
			buildArgv({
				subcommand: "search",
				args: { query: "x", state: undefined, limit: null },
			}),
		).toEqual(["search", "--query", "x"]);
	});

	test("11. repo appears after subcommand and args", () => {
		const argv = buildArgv({
			subcommand: "pr list",
			args: { state: "open" },
			repo: "owner/repo",
		});
		expect(argv.indexOf("--repo")).toBeGreaterThan(argv.indexOf("list"));
	});

	test("12. --json precedes --jq", () => {
		const argv = buildArgv({
			subcommand: "issue list",
			jsonFields: ["number", "title"],
			jq: ".[].title",
		});
		expect(argv.indexOf("--json")).toBeLessThan(argv.indexOf("--jq"));
	});

	test("13a. empty subcommand throws", () => {
		expect(() => buildArgv({ subcommand: "" })).toThrow(/subcommand/i);
	});

	test("13b. whitespace-only subcommand throws", () => {
		expect(() => buildArgv({ subcommand: "   " })).toThrow(/subcommand/i);
	});
});

describe("buildArgv mode#1 (array args)", () => {
	test("A1.1 real payload: subcommand + array args with --json, top-level jsonFields wins", () => {
		expect(
			buildArgv({
				subcommand: "repo",
				args: ["view", "cli/cli", "--json", "description,repositoryTopics,url,visibility"],
				jsonFields: ["description", "repositoryTopics", "url", "visibility"],
			}),
		).toEqual(["repo", "view", "cli/cli", "--json", "description,repositoryTopics,url,visibility"]);
	});

	test("A1.2 array args alone with --json (no top-level jsonFields) — promoted from array", () => {
		expect(
			buildArgv({ subcommand: "pr", args: ["list", "--json", "number,title"] }),
		).toEqual(["pr", "list", "--json", "number,title"]);
	});

	test("A1.3 array args with boolean flag", () => {
		expect(
			buildArgv({ subcommand: "repo", args: ["view", "--web"] }),
		).toEqual(["repo", "view", "--web"]);
	});
});

describe("buildArgv mode#2 (nested args)", () => {
	test("A2.1 real payload: subcommand+jsonFields nested inside args", () => {
		expect(
			buildArgv({
				args: {
					subcommand: "repo view cli/cli",
					jsonFields: ["description", "repositoryTopics", "url", "visibility"],
				},
			}),
		).toEqual(["repo", "view", "cli/cli", "--json", "description,repositoryTopics,url,visibility"]);
	});

	test("A2.2 nested repo+limit in args are harvested to top-level", () => {
		expect(
			buildArgv({
				args: { subcommand: "pr list", repo: "owner/repo", limit: 5, state: "open" },
			}),
		).toEqual(["pr", "list", "--state", "open", "--repo", "owner/repo", "--limit", "5"]);
	});

	test("A2.3 top-level value wins over nested duplicate", () => {
		expect(
			buildArgv({
				subcommand: "pr list",
				jsonFields: ["a"],
				args: { jsonFields: ["b"], state: "open" },
			}),
		).toEqual(["pr", "list", "--state", "open", "--json", "a"]);
	});

	test("A2.4 mis-typed known key nested in args becomes a flag, not dropped", () => {
		// limit as a string (type mismatch) should fall through to a --limit flag
		// rather than being silently dropped by the harvest branch.
		expect(
			buildArgv({ args: { subcommand: "pr list", limit: "5", state: "open" } }),
		).toEqual(["pr", "list", "--limit", "5", "--state", "open"]);
	});
});

describe("stripLimitForViewCommands", () => {
	test("pr view: --limit N pair is removed", () => {
		const res = stripLimitForViewCommands(["pr", "view", "123", "--limit", "3"], "pr view 123");
		expect(res).toEqual({ argv: ["pr", "view", "123"], stripped: true });
	});

	test("pr view: --limit=N token is removed", () => {
		const res = stripLimitForViewCommands(["pr", "view", "123", "--limit=3"], "pr view 123");
		expect(res).toEqual({ argv: ["pr", "view", "123"], stripped: true });
	});

	test("issue view and run view are stripped", () => {
		expect(stripLimitForViewCommands(["issue", "view", "42", "--limit", "5"], "issue view 42").stripped).toBe(true);
		expect(stripLimitForViewCommands(["run", "view", "987", "--limit", "1"], "run view 987").stripped).toBe(true);
	});

	test("ruleset view and project view are stripped", () => {
		expect(stripLimitForViewCommands(["ruleset", "view", "7", "--limit", "1"], "ruleset view 7").stripped).toBe(true);
		expect(stripLimitForViewCommands(["project", "view", "3", "--limit", "1"], "project view 3").stripped).toBe(true);
	});

	test("pr list keeps --limit (only view pairs are scrubbed)", () => {
		const res = stripLimitForViewCommands(["pr", "list", "--limit", "10"], "pr list");
		expect(res).toEqual({ argv: ["pr", "list", "--limit", "10"], stripped: false });
	});

	test("repo list keeps --limit", () => {
		const res = stripLimitForViewCommands(["repo", "list", "--limit", "5"], "repo list");
		expect(res.stripped).toBe(false);
	});

	test("pr view without any limit is untouched", () => {
		const res = stripLimitForViewCommands(["pr", "view", "123"], "pr view 123");
		expect(res).toEqual({ argv: ["pr", "view", "123"], stripped: false });
	});

	test("limit: false neither triggers the strip nor serializes to argv", () => {
		expect(buildArgv({ subcommand: "pr list", limit: false as never })).toEqual(["pr", "list"]);
	});

	test("flags after the stripped limit survive", () => {
		const res = stripLimitForViewCommands(
			["pr", "view", "123", "--limit", "3", "--json", "state"],
			"pr view 123",
		);
		expect(res).toEqual({ argv: ["pr", "view", "123", "--json", "state"], stripped: true });
	});
});

describe("assertSafeCommand", () => {
	test("1. repo delete refused without opt-in", () => {
		expect(() => assertSafeCommand({ subcommand: "repo delete" })).toThrow(/repo delete/);
	});

	test("2. repo delete with args is refused as unrecoverable", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "repo delete", args: { yes: true } }),
		).toThrow(/unrecoverable/);
	});

	test("3. repo delete with forceDangerous is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "repo delete", forceDangerous: true }),
		).not.toThrow();
	});

	test("4. release delete refused", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "release delete" }),
		).toThrow(/release delete/);
	});

	test("5. release delete with forceDangerous is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "release delete", forceDangerous: true }),
		).not.toThrow();
	});

	test("6. pr merge is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "pr merge 123" }),
		).not.toThrow();
	});

	test("7. issue close is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "issue close 42" }),
		).not.toThrow();
	});

	test("8. safe commands are allowed", () => {
		expect(() => assertSafeCommand({ subcommand: "repo list" })).not.toThrow();
		expect(() => assertSafeCommand({ subcommand: "pr list" })).not.toThrow();
	});

	test("9. dangerous command embedded in longer subcommand is caught (bypass fix)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "run repo delete" }),
		).toThrow(/repo delete/);
	});

	test("10. whitespace-padded dangerous command is caught", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "  repo delete  " }),
		).toThrow(/repo delete/);
	});

	test("11. safe command with extra words is allowed", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "repo view owner/repo" }),
		).not.toThrow();
	});

	test("12. codespace delete is refused", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "codespace delete" }),
		).toThrow(/codespace delete/);
	});

	test("13. run delete is allowed (re-runnable, not irreversible)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "run delete" }),
		).not.toThrow();
	});

	test("14. secret delete is allowed (recreatable, not irreversible)", () => {
		expect(() =>
			assertSafeCommand({ subcommand: "secret delete" }),
		).not.toThrow();
	});
});

describe("formatOutput", () => {
	test("1. stdout only", () => {
		expect(formatOutput("hello", "")).toBe("hello");
	});

	test("2. stderr appended with label", () => {
		expect(formatOutput("out", "err")).toBe("out\n\nstderr:\nerr");
	});

	test("3. empty produces placeholder", () => {
		expect(formatOutput("", "")).toBe("(no output)");
	});

	test("4. whitespace-only is treated as empty", () => {
		expect(formatOutput("   \n  ", "  ")).toBe("(no output)");
	});
});

describe("GH_GUIDANCE", () => {
	test("1. does not contain stale key=value format", () => {
		expect(GH_GUIDANCE).not.toContain("key=value");
	});
});

describe("GH_CALL_EXAMPLE", () => {
	test("A4.1 structure: has subcommand, args, jsonFields; args is non-array object; jsonFields is array", () => {
		const keys = Object.keys(GH_CALL_EXAMPLE);
		expect(keys).toContain("subcommand");
		expect(keys).toContain("args");
		expect(keys).toContain("jsonFields");
		expect(Array.isArray(GH_CALL_EXAMPLE.args)).toBe(false);
		expect(typeof GH_CALL_EXAMPLE.args).toBe("object");
		expect(Array.isArray(GH_CALL_EXAMPLE.jsonFields)).toBe(true);
	});
});

describe("GH_ARGS_DESCRIPTION", () => {
	test("A4.2 says object-not-array", () => {
		expect(GH_ARGS_DESCRIPTION).toMatch(/not an array|never an array|must be an object/i);
	});

	test("A4.3 prohibits nesting with literal names", () => {
		expect(GH_ARGS_DESCRIPTION).toMatch(/never[^.]*subcommand[^.]*jsonFields|top-level params, not nested/i);
		expect(GH_ARGS_DESCRIPTION).toContain("subcommand");
		expect(GH_ARGS_DESCRIPTION).toContain("jsonFields");
	});
});

describe("GH_SUBCOMMAND_DESCRIPTION", () => {
	test("A4.4 says top-level, never in args, has command path", () => {
		expect(GH_SUBCOMMAND_DESCRIPTION).toMatch(/top-level/i);
		expect(GH_SUBCOMMAND_DESCRIPTION).toMatch(/never[^.]*args/i);
		expect(GH_SUBCOMMAND_DESCRIPTION).toContain("repo view");
	});
});

describe("GH_GUIDANCE content", () => {
	test("A4.5 embeds the flat example", () => {
		expect(GH_GUIDANCE).toContain(JSON.stringify(GH_CALL_EXAMPLE, null, 2));
	});

	test("A4.6 documents that only list-style commands accept limit", () => {
		expect(GH_GUIDANCE).toContain("Only valid on list-style commands");
		expect(GH_GUIDANCE).toContain("unknown flag: --limit");
	});
});

/**
 * Fake exec: returns a canned ExecResult, recording the call so tests can
 * assert on the argv that was built. This is the only system boundary mocked
 * (per the TDD mocking skill — mock at boundaries, never internal collaborators).
 */
function makeFakeExec(result: ExecResult): GhExec & { calls: Parameters<GhExec>[] } {
	const calls: Parameters<GhExec>[] = [];
	const fn = mock(async (_cmd: string, args: string[], opts) => {
		calls.push([_cmd, args, opts]);
		return result;
	}) as unknown as GhExec & { calls: Parameters<GhExec>[] };
	fn.calls = calls;
	return fn;
}

describe("runGh", () => {
	test("1. builds argv from params and passes it to exec", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "pr list", args: { state: "open" } }, exec);
		expect(exec.calls[0][0]).toBe("gh");
		expect(exec.calls[0][1]).toEqual(["pr", "list", "--state", "open"]);
	});

	test("2. success echoes command, exit code, and output", async () => {
		const exec = makeFakeExec({ stdout: "repo-list-output", code: 0 });
		const res = await runGh({ subcommand: "repo list" }, exec);
		expect(res.isError).toBe(false);
		expect(res.content[0].text).toContain("Command: gh repo list");
		expect(res.content[0].text).toContain("Exit code: 0");
		expect(res.content[0].text).toContain("repo-list-output");
	});

	test("3. non-zero exit sets isError true and includes exit code + stderr", async () => {
		const exec = makeFakeExec({ stdout: "", stderr: "not found", code: 1 });
		const res = await runGh({ subcommand: "repo view" }, exec);
		expect(res.isError).toBe(true);
		expect(res.content[0].text).toContain("Exit code: 1");
		expect(res.content[0].text).toContain("not found");
	});

	test("4. exec rejection (ENOENT) is wrapped with install hint", async () => {
		const failing: GhExec = async () => {
			throw new Error("spawn ENOENT");
		};
		await expect(runGh({ subcommand: "repo list" }, failing)).rejects.toThrow(/installed and on PATH/);
	});

	test("5. not-authed returns isError with notAuthed detail and auth login guidance", async () => {
		const exec = makeFakeExec({
			stdout: "",
			stderr: "You are not logged in to any GitHub hosts. Run gh auth login to authenticate.",
			code: 4,
		});
		const res = await runGh({ subcommand: "repo list" }, exec);
		expect(res.isError).toBe(true);
		expect(res.details).toMatchObject({ notAuthed: true });
		expect(res.content[0].text).toContain("gh auth login");
	});

	test("6. repo delete refused before exec is called", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(
			runGh({ subcommand: "repo delete" }, exec),
		).rejects.toThrow(/repo delete/);
		expect(exec.calls).toHaveLength(0);
	});

	test("7. missing subcommand throws with the not-remembered warning", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(runGh({} as GhParams, exec)).rejects.toThrow(
			/subcommand is not remembered between calls/,
		);
	});

	test("8. large output is truncated and flagged", async () => {
		const huge = Array.from({ length: 5000 }, () => "line of content").join("\n");
		const exec = makeFakeExec({ stdout: huge, code: 0 });
		const res = await runGh({ subcommand: "repo list" }, exec);
		expect(res.details).toMatchObject({ truncated: true });
		expect(res.content[0].text).toContain("Output truncated");
	});

	test("9a. pr view with limit strips --limit instead of failing", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh(
			{ subcommand: "pr view 123", limit: 3, jsonFields: ["state", "title"] },
			exec,
		);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123", "--json", "state,title"]);
		expect(res.details).toMatchObject({ limitStripped: true });
		expect(res.content[0].text).toContain("--limit");
	});

	test("9. timeout 9999 is clamped to 120s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "repo list", timeoutSeconds: 9999 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120000);
	});

	test("9b. timeout 60000 is treated as milliseconds (60s)", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "repo list", timeoutSeconds: 60000 }, exec);
		expect(exec.calls[0][2].timeout).toBe(60000);
	});

	test("9c. timeout 120000 ms coerces to the 120s cap", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "repo list", timeoutSeconds: 120000 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120000);
	});

	test("9d. timeout 150 (not ms-shaped) is clamped to 120s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "repo list", timeoutSeconds: 150 }, exec);
		expect(exec.calls[0][2].timeout).toBe(120000);
	});

	test("10. no timeoutSeconds defaults to 30s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "repo list" }, exec);
		expect(exec.calls[0][2].timeout).toBe(30000);
	});

	test("11. timeoutSeconds 0 is clamped to min 1s", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "repo list", timeoutSeconds: 0 }, exec);
		expect(exec.calls[0][2].timeout).toBe(1000);
	});

	test("12. repo override appears in argv", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		await runGh({ subcommand: "pr list", repo: "owner/repo" }, exec);
		expect(exec.calls[0][1]).toContain("--repo");
		expect(exec.calls[0][1]).toContain("owner/repo");
	});

	test("13. jsonFields + jq appear in argv", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		await runGh({
			subcommand: "pr list",
			jsonFields: ["number", "title"],
			jq: ".[].title",
		}, exec);
		expect(exec.calls[0][1]).toContain("--json");
		expect(exec.calls[0][1]).toContain("number,title");
		expect(exec.calls[0][1]).toContain("--jq");
		expect(exec.calls[0][1]).toContain(".[].title");
	});
});

describe("runGh tolerance", () => {
	test("A3.1 mode#1 array args → correct argv passed to exec, isError false", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		const res = await runGh({
			subcommand: "repo",
			args: ["view", "cli/cli", "--json", "description,repositoryTopics,url,visibility"],
			jsonFields: ["description", "repositoryTopics", "url", "visibility"],
		}, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["repo", "view", "cli/cli", "--json", "description,repositoryTopics,url,visibility"]);
	});

	test("A3.2 mode#2 nested args → correct argv passed to exec, isError false", async () => {
		const exec = makeFakeExec({ stdout: "ok", code: 0 });
		const res = await runGh({
			args: {
				subcommand: "repo view cli/cli",
				jsonFields: ["description", "repositoryTopics", "url", "visibility"],
			},
		}, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["repo", "view", "cli/cli", "--json", "description,repositoryTopics,url,visibility"]);
	});

	test("A3.3 dangerous command nested in args is still refused", async () => {
		const exec = makeFakeExec({ stdout: "", code: 0 });
		await expect(
			runGh({ args: { subcommand: "repo delete" } }, exec),
		).rejects.toThrow(/repo delete/);
		expect(exec.calls).toHaveLength(0);
	});

	test("A3.4 pr view with top-level limit strips --limit and runs", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh({ subcommand: "pr view 123", limit: 3 }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123"]);
		expect(res.details).toMatchObject({ limitStripped: true });
	});

	test("A3.6 array-args --limit token on a view command is stripped after normalization", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh({ subcommand: "pr", args: ["view", "123", "--limit", "3"] }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123"]);
	});

	test("A3.10 pr list with embedded --limit passes through to exec untouched", async () => {
		const exec = makeFakeExec({ stdout: "[]", code: 0 });
		const res = await runGh({ subcommand: "pr list --limit 5" }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "list", "--limit", "5"]);
	});

	test("A3.9 --limit embedded in the subcommand string on a view command is stripped", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh({ subcommand: "pr view 123 --limit 3" }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123"]);
	});

	test("A3.8 dash-prefixed --limit key on a view command is stripped", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh({ subcommand: "pr view 123", args: { "--limit": "3" } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123"]);
	});

	test("A3.7 string-typed nested limit on a view command is stripped (flag-shaped bypass fix)", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh({ args: { subcommand: "pr view 123", limit: "5" } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123"]);
	});

	test("A3.5 pr view with nested limit in args is stripped", async () => {
		const exec = makeFakeExec({ stdout: "pr-body", code: 0 });
		const res = await runGh({ args: { subcommand: "pr view 123", limit: 3 } }, exec);
		expect(res.isError).toBe(false);
		expect(exec.calls[0][1]).toEqual(["pr", "view", "123"]);
	});
});

// --- Integration tests (opt-in) ---
// Gated by TEST_INTEGRATION=1. Skipped by default so CI runs don't need gh.
// When enabled + gh authed, these validate the full buildArgv→exec→formatOutput
// pipeline against the real gh binary's cobra flag parser.

const realExec: GhExec = async (cmd, args, opts) => {
	const proc = Bun.spawn([cmd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
		signal: opts.signal,
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { stdout, stderr, code };
};

describe("integration (real gh)", () => {
	test.skipIf(!process.env.TEST_INTEGRATION)("1. gh auth status succeeds", async () => {
		const res = await runGh({ subcommand: "auth status" }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("2. gh repo list --limit serialization", async () => {
		const res = await runGh({ subcommand: "repo list", args: { limit: 3 } }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("3. gh pr list --state --limit --json serialization", async () => {
		const res = await runGh({
			subcommand: "pr list",
			args: { state: "open", limit: 1 },
			jsonFields: ["number"],
			repo: "cli/cli",
		}, realExec);
		expect(res.isError).toBe(false);
	});
});
