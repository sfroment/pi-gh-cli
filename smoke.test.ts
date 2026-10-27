import { runGh, type GhExec } from "./index.ts";
import { describe, expect, test } from "bun:test";

// --- Live smoke: every documented read-only command (opt-in) ---
// Gated by TEST_INTEGRATION=1 — the same gate as the integration block in
// index.test.ts — and skipped by default, so CI runs without gh credentials
// stay green. When enabled + gh authed, this executes every documented
// read-only command live against the real account. Real repos are read-only
// targets: nothing here creates or mutates anything, and the fixed targets
// (merged PR #24, issue #27, the latest release, ci.yml) are permanent
// public artifacts of this repo.

// Mirrors the realExec boundary in index.test.ts.
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

const REPO = "sfroment/pi-gh-cli";

describe("live smoke: documented read-only commands", () => {
	test.skipIf(!process.env.TEST_INTEGRATION)("1. auth status", async () => {
		const res = await runGh({ subcommand: "auth status" }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("2. repo list", async () => {
		const res = await runGh({ subcommand: "repo list", limit: 3 }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("3. repo view", async () => {
		const res = await runGh({ subcommand: `repo view ${REPO}` }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("4. pr list", async () => {
		const res = await runGh(
			{ subcommand: "pr list", repo: REPO, jsonFields: ["number", "title", "state"], limit: 5 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("5. pr view", async () => {
		const res = await runGh({ subcommand: "pr view 24", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("6. issue list", async () => {
		const res = await runGh(
			{ subcommand: "issue list", repo: REPO, jsonFields: ["number", "title", "state"], limit: 5 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("7. issue view", async () => {
		const res = await runGh({ subcommand: "issue view 27", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("8. release list", async () => {
		const res = await runGh({ subcommand: "release list", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("9. release view (latest)", async () => {
		const res = await runGh({ subcommand: "release view", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("10. run list", async () => {
		const res = await runGh({ subcommand: "run list", repo: REPO, limit: 3 }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("11. workflow list", async () => {
		const res = await runGh({ subcommand: "workflow list", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("12. workflow view", async () => {
		const res = await runGh({ subcommand: "workflow view ci.yml", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("13. gist list", async () => {
		const res = await runGh({ subcommand: "gist list", limit: 5 }, realExec);
		expect(res.isError).toBe(false);
	});

	// --- issue #32 audit: the remaining documented read-only commands ---
	// The first 13 smokes covered the list/view heads; these close the rest of
	// the documented read-only surface — pr diff, run view, gist view, every
	// search verb, and the api GET/graphql read forms.

	test.skipIf(!process.env.TEST_INTEGRATION)("14. pr diff (merged PR #24)", async () => {
		const res = await runGh({ subcommand: "pr diff 24", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("15. run view (completed run)", async () => {
		const res = await runGh({ subcommand: "run view 40500751715", repo: REPO }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("16. gist view (the account's first listed gist)", async () => {
		const list = await runGh({ subcommand: "gist list", limit: 1 }, realExec);
		expect(list.isError).toBe(false);
		const body = list.content[0].text.slice(list.content[0].text.indexOf("\n\n") + 2);
		const id = body.split("\n")[0]?.split("\t")[0]?.trim();
		if (!id) {
			// No gists on this account: the translation still ran live via gist list.
			return;
		}
		const res = await runGh({ subcommand: `gist view ${id}` }, realExec);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("17. search repos (positional query)", async () => {
		const res = await runGh(
			{ subcommand: "search repos language:typescript", limit: 3 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("18. search issues (positional qualifiers)", async () => {
		const res = await runGh(
			{ subcommand: "search issues repo:sfroment/pi-gh-cli is:issue is:open", limit: 5 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("19. search prs (positional qualifiers)", async () => {
		const res = await runGh(
			{ subcommand: "search prs repo:sfroment/pi-gh-cli is:open", limit: 5 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("20. search code (text + qualifier)", async () => {
		const res = await runGh(
			{ subcommand: "search code buildArgv repo:sfroment/pi-gh-cli", limit: 5 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("21. search commits (text + qualifier)", async () => {
		const res = await runGh(
			{ subcommand: "search commits refactor repo:sfroment/pi-gh-cli", limit: 5 },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("22. api GET", async () => {
		const res = await runGh(
			{ subcommand: "api repos/sfroment/pi-gh-cli", args: { method: "GET" } },
			realExec,
		);
		expect(res.isError).toBe(false);
	});

	test.skipIf(!process.env.TEST_INTEGRATION)("23. api graphql (raw-field read query)", async () => {
		const res = await runGh(
			{ subcommand: "api graphql", args: { "raw-field": "query=query { viewer { login } }" } },
			realExec,
		);
		expect(res.isError).toBe(false);
	});
});
