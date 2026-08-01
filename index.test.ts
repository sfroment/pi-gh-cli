import { describe, expect, test } from "bun:test";
import { assertSafeCommand, buildArgv, formatOutput, type GhParams } from "./index.ts";

describe("buildArgv", () => {
	test("1. subcommand split on spaces", () => {
		expect(buildArgv({ subcommand: "repo list" })).toEqual(["repo", "list"]);
	});

	test("2. args become key=value tokens", () => {
		expect(
			buildArgv({ subcommand: "pr list", args: { state: "open", limit: 10 } }),
		).toEqual(["pr", "list", "state=open", "limit=10"]);
	});

	test("3. boolean true becomes a bare flag", () => {
		const argv = buildArgv({ subcommand: "repo view", args: { web: true } });
		expect(argv).toContain("web");
		expect(argv).not.toContain("web=true");
	});

	test("4. boolean false is omitted", () => {
		const argv = buildArgv({ subcommand: "repo view", args: { web: false } });
		expect(argv).not.toContain("web");
		expect(argv).not.toContain("web=false");
	});

	test("5. array values become repeated tokens", () => {
		expect(
			buildArgv({ subcommand: "pr list", args: { label: ["bug", "urgent"] } }),
		).toEqual(["pr", "list", "label=bug", "label=urgent"]);
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
		).toEqual(["search", "query=x"]);
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
