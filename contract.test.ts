import { runGh, type GhExec } from "./index.ts";
import { describe, expect, test } from "bun:test";

// --- Live contract: the structured-output surface (opt-in) ---
// Gated by TEST_INTEGRATION=1 — the same gate as the integration block in
// index.test.ts — and skipped by default, so CI runs without gh credentials
// stay green. When enabled + gh authed, this pins the tool's translation
// contract against the real gh CLI, asserting the executed argv and the
// reported output: jsonFields → --json before jq → --jq, limit translated on
// list forms and stripped-and-noted on view forms, and the args flag shapes
// (boolean true → bare flag, false/null skipped, string/number → pair,
// array → repeated pairs). Real repos are read-only targets: nothing here
// mutates anything, and the fixed targets (issue 29, the latest release,
// completed run 40500751715, cli/cli's open PRs) are permanent public
// artifacts.

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

/** The output section of runGh's reported text — past the "Command:"/"Exit code:" header. */
function reportedOutput(res: Awaited<ReturnType<typeof runGh>>): string {
	const lines = res.content[0].text.split("\n");
	// lines[0] "Command: …", lines[1] "Exit code: …", lines[2] "" — output follows.
	return lines.slice(3).join("\n");
}

describe("live contract: structured-output surface", () => {
	test.skipIf(!process.env.TEST_INTEGRATION)(
		"1. jsonFields → --json precedes jq → --jq; jq projects rows; --limit caps (pr list)",
		async () => {
			const res = await runGh(
				{
					subcommand: "pr list",
					args: { state: "open" },
					repo: "cli/cli",
					jsonFields: ["number", "title", "state"],
					jq: ".[] | {number, state}",
					limit: 2,
				},
				realExec,
			);
			expect(res.isError).toBe(false);
			// Global flags append after subcommand and args flags, in the documented
			// order: --repo, then --json, then --jq, then --limit.
			expect(res.details.argv).toEqual([
				"pr",
				"list",
				"--state",
				"open",
				"--repo",
				"cli/cli",
				"--json",
				"number,title,state",
				"--jq",
				".[] | {number, state}",
				"--limit",
				"2",
			]);
			// gh --jq emits one projected object per line; with --limit 2 there are ≤2.
			const rows = reportedOutput(res)
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));
			expect(rows.length).toBeGreaterThan(0); // cli/cli always has open PRs
			expect(rows.length).toBeLessThanOrEqual(2); // --limit translated on a list form
			for (const row of rows) {
				// The jq projection dropped `title`: exactly {number, state} per row.
				expect(Object.keys(row).sort()).toEqual(["number", "state"]);
			}
		},
	);

	test.skipIf(!process.env.TEST_INTEGRATION)(
		"2. view form strips --limit and notes it instead of failing (issue view)",
		async () => {
			const res = await runGh({ subcommand: "issue view 29", repo: REPO, limit: 5 }, realExec);
			expect(res.isError).toBe(false); // ran instead of failing on --limit
			expect(res.details.argv).toEqual(["issue", "view", "29", "--repo", REPO]); // --limit gone
			expect(res.details.limitStripped).toBe(true);
			expect(res.content[0].text).toContain(
				"[--limit removed: view-style subcommands fetch a single item and do not accept --limit.]",
			);
			expect(res.content[0].text).toContain("title:"); // the item really came back
		},
	);

	test.skipIf(!process.env.TEST_INTEGRATION)(
		"3. release view strips --limit too (second view pair)",
		async () => {
			const res = await runGh({ subcommand: "release view", repo: REPO, limit: 2 }, realExec);
			expect(res.isError).toBe(false);
			expect(res.details.argv).toEqual(["release", "view", "--repo", REPO]);
			expect(res.details.limitStripped).toBe(true);
			expect(res.content[0].text).toContain("[--limit removed:");
		},
	);

	test.skipIf(!process.env.TEST_INTEGRATION)(
		"4. boolean true → bare flag; false → skipped (issue view --comments)",
		async () => {
			const on = await runGh(
				{ subcommand: "issue view 29", args: { comments: true }, repo: REPO },
				realExec,
			);
			expect(on.isError).toBe(false);
			// Bare: --comments carries no value token; --repo follows directly.
			expect(on.details.argv).toEqual(["issue", "view", "29", "--comments", "--repo", REPO]);
			const off = await runGh(
				{ subcommand: "issue view 29", args: { comments: false }, repo: REPO },
				realExec,
			);
			expect(off.isError).toBe(false);
			expect(off.details.argv).toEqual(["issue", "view", "29", "--repo", REPO]); // false flag never emitted
		},
	);

	test.skipIf(!process.env.TEST_INTEGRATION)("5. null args value is skipped", async () => {
		const res = await runGh(
			{ subcommand: "issue view 29", args: { comments: null }, repo: REPO },
			realExec,
		);
		expect(res.isError).toBe(false);
		expect(res.details.argv).toEqual(["issue", "view", "29", "--repo", REPO]); // no --comments, no "null" value
	});

	test.skipIf(!process.env.TEST_INTEGRATION)(
		"6. number arg → --flag value pair (run watch --interval)",
		async () => {
			// 40500751715 is a completed successful run on this repo — watch on a
			// finished run returns immediately with exit 0.
			const res = await runGh(
				{ subcommand: "run watch 40500751715", args: { interval: 3 }, repo: REPO },
				realExec,
			);
			expect(res.isError).toBe(false);
			expect(res.details.argv).toEqual([
				"run",
				"watch",
				"40500751715",
				"--interval",
				"3",
				"--repo",
				REPO,
			]);
		},
	);

	test.skipIf(!process.env.TEST_INTEGRATION)(
		"7. array arg → repeated --flag value pairs (issue list --label)",
		async () => {
			const res = await runGh(
				{
					subcommand: "issue list",
					args: { label: ["ready-for-agent", "bug"] },
					repo: REPO,
					jsonFields: ["number"],
				},
				realExec,
			);
			expect(res.isError).toBe(false); // gh accepts the shape; no issue carries both labels → []
			expect(res.details.argv).toEqual([
				"issue",
				"list",
				"--label",
				"ready-for-agent",
				"--label",
				"bug",
				"--repo",
				REPO,
				"--json",
				"number",
			]);
		},
	);
});
