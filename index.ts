import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

/** Commands that are destructive/unrecoverable — refused unless forceDangerous is set. */
const DANGEROUS_COMMANDS = ["repo delete", "release delete", "codespace delete"];

/** Regex matching gh's not-authenticated error messages. */
const NOT_AUTHED = /not logged in|authentication required|auth.*fail/i;

export type GhParams = {
	subcommand: string;
	args?: Record<string, string | number | boolean | string[] | null | undefined>;
	repo?: string;
	jsonFields?: string[];
	jq?: string;
	limit?: number;
	timeoutSeconds?: number;
	forceDangerous?: boolean;
};

/**
 * Serialize params into the gh CLI's argv format.
 *
 * The subcommand is split on whitespace (e.g. "repo list" → ["repo", "list"]).
 * Args are serialized as `--flag value` token pairs; booleans become bare
 * `--flag` tokens; arrays become repeated `--flag value` pairs;
 * false/null/undefined are skipped. Keys without a `--` prefix are prefixed.
 * Global flags (--repo, --json, --jq, --limit) are appended after subcommand
 * and args, in that order (--json before --jq).
 */
export function buildArgv(params: GhParams): string[] {
	const trimmed = params.subcommand.trim();
	if (trimmed.length === 0) {
		throw new Error("subcommand is required and must not be empty or whitespace");
	}

	const argv: string[] = trimmed.split(/\s+/);
	const args = params.args ?? {};
	for (const [key, value] of Object.entries(args)) {
		if (value === false || value === null || value === undefined) continue;
		const flag = key.startsWith("--") ? key : `--${key}`;
		if (value === true) {
			argv.push(flag);
		} else if (Array.isArray(value)) {
			for (const v of value) {
				argv.push(flag, String(v));
			}
		} else {
			argv.push(flag, String(value));
		}
	}

	if (params.repo) {
		argv.push("--repo", params.repo);
	}
	if (params.jsonFields && params.jsonFields.length > 0) {
		argv.push("--json", params.jsonFields.join(","));
	}
	if (params.jq) {
		argv.push("--jq", params.jq);
	}
	if (params.limit !== undefined && params.limit !== null) {
		argv.push("--limit", String(params.limit));
	}

	return argv;
}

/**
 * Guard against destructive gh operations that are hard or impossible to
 * reverse. The tool refuses these unless the caller explicitly sets
 * `forceDangerous: true`, which keeps the LLM from nuking a repo or release
 * by accident.
 */
export function assertSafeCommand(params: GhParams): void {
	const words = params.subcommand.trim().toLowerCase().split(/\s+/);
	for (let i = 0; i < words.length - 1; i++) {
		const pair = `${words[i]} ${words[i + 1]}`;
		if (DANGEROUS_COMMANDS.includes(pair)) {
			if (params.forceDangerous === true) return;
			throw new Error(
				`Refusing \`${pair}\` from the gh tool — this operation is unrecoverable. ` +
					"To override, set `forceDangerous: true` and confirm with the user first.",
			);
		}
	}
}

/**
 * Format stdout/stderr into a single human-readable string.
 * If both are empty/whitespace, returns a placeholder.
 */
export function formatOutput(stdout: string, stderr: string): string {
	const chunks: string[] = [];
	if (stdout.trim().length > 0) chunks.push(stdout.trimEnd());
	if (stderr.trim().length > 0) chunks.push(`stderr:\n${stderr.trimEnd()}`);
	return chunks.join("\n\n") || "(no output)";
}

/** Result shape returned by the injected exec boundary (compatible with pi.exec). */
export type ExecResult = { stdout?: string; stderr?: string; code?: number | null; killed?: boolean };

/** System boundary: spawns the gh CLI. Injected for testing. */
export type GhExec = (
	command: string,
	args: string[],
	options: { signal?: AbortSignal; timeout?: number },
) => Promise<ExecResult>;

/**
 * Core execution logic, separated from the Pi tool wiring so it can be tested
 * with an injected `exec` (the only system boundary). Returns the same shape
 * as a Pi tool result.
 */
export async function runGh(
	params: GhParams,
	exec: GhExec,
	signal?: AbortSignal,
): Promise<{
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError: boolean;
}> {
	if (!params.subcommand || params.subcommand.trim().length === 0) {
		throw new Error("Pass a gh subcommand, for example `subcommand: 'repo list'` or `subcommand: 'pr list'`.");
	}
	assertSafeCommand(params);

	const argv = buildArgv(params);
	const timeoutSeconds = Math.min(Math.max(params.timeoutSeconds ?? 30, 1), 120);

	let result: ExecResult;
	try {
		result = await exec("gh", argv, { signal, timeout: timeoutSeconds * 1000 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to run gh CLI. Is it installed and on PATH? ${message}`);
	}

	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";
	const code = result.code;

	// Detect the common "not authenticated" failure and give actionable guidance.
	if (code !== 0 && (NOT_AUTHED.test(stdout) || NOT_AUTHED.test(stderr))) {
		return {
			content: [
				{
					type: "text",
					text:
						"You are not authenticated with the GitHub CLI. Run `gh auth login` to authenticate, " +
						"then retry the command.",
				},
			],
			details: { subcommand: params.subcommand, code, notAuthed: true },
			isError: true,
		};
	}

	const output = formatOutput(stdout, stderr);
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const commandLine = `gh ${argv.join(" ")}`;
	const codeText = code === null || code === undefined ? "unknown" : String(code);
	let text = `Command: ${commandLine}\nExit code: ${codeText}${result.killed ? " (killed)" : ""}\n\n${truncation.content}`;
	if (truncation.truncated) {
		text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	}

	return {
		content: [{ type: "text", text }],
		details: {
			subcommand: params.subcommand,
			argv,
			code,
			killed: result.killed,
			truncated: truncation.truncated,
		},
		isError: code !== 0,
	};
}

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(baseDir, "skill", "SKILL.md");

const RELEVANT_PROMPT = /\b(github|gh cli|pr |pull request|issue|repo|release|workflow|gist)\b/i;

/**
 * Guidance injected into the system prompt when the user's message looks
 * GitHub-related. Kept short — the full reference lives in the SKILL.md.
 */
export const GH_GUIDANCE = `## GitHub CLI (gh) guidance

The \`gh\` tool wraps the GitHub CLI (\`gh\`) as a single typed tool. Pass the gh subcommand as \`subcommand\` and its flags as \`args\`. Booleans become bare flags (e.g. \`{ web: true }\` → \`--web\`). Strings/numbers become \`--flag value\` pairs. Arrays become repeated \`--flag value\` pairs (e.g. \`{ label: ["bug", "urgent"] }\` → \`--label bug --label urgent\`).

Key patterns:
- List PRs: \`subcommand: "pr list"\`, \`args: { state: "open", limit: 10 }\`.
- Structured output: \`jsonFields: ["number", "title", "state"]\` → \`--json number,title,state\`. Use \`jq\` to filter/project.
- Target a repo: \`repo: "owner/repo"\` → \`--repo owner/repo\`.
- Destructive ops (\`repo delete\`, \`release delete\`, \`codespace delete\`) require \`forceDangerous: true\` and explicit user confirmation.

If the tool reports you are not authenticated, run \`gh auth login\` via bash.`;

export default function ghExtension(pi: ExtensionAPI) {
	// Make the bundled SKILL.md discoverable as a skill.
	pi.on("resources_discover", () => ({
		skillPaths: [skillPath],
	}));

	// Inject concise guidance when the prompt looks GitHub-related.
	pi.on("before_agent_start", (event) => {
		if (!RELEVANT_PROMPT.test(event.prompt)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${GH_GUIDANCE}\n`,
		};
	});

	pi.registerTool({
		name: "gh",
		label: "GitHub CLI",
		description:
			"Call the GitHub CLI (gh) to interact with repositories, pull requests, issues, releases, workflows, gists, and more. " +
			"Pass the gh subcommand as `subcommand` (e.g. 'pr list', 'repo view', 'issue list') and its flags as `args`. " +
			"Use `jsonFields` + `jq` for structured output, `repo` to target a specific repository, and `limit` to cap results. " +
			"Destructive operations (repo delete, release delete, codespace delete) require `forceDangerous: true`.",
		promptSnippet:
			"Interact with GitHub (repos, PRs, issues, releases, workflows, gists) via the gh CLI.",
		promptGuidelines: [
			"Use the `gh` tool when the user asks about GitHub — repos, PRs, issues, releases, workflows, or gists. It calls the gh CLI directly.",
			"Pass the gh subcommand as `subcommand` (e.g. 'pr list') and its flags as `args`. Booleans become bare flags, arrays become repeated flags.",
			"Use `jsonFields` + `jq` for structured output when you need to parse results programmatically.",
			"Destructive operations (`repo delete`, `release delete`, `codespace delete`) require `forceDangerous: true`. Always confirm with the user before using it.",
			"If the tool reports you are not authenticated, tell the user to run `gh auth login`.",
		],
		parameters: Type.Object({
			subcommand: Type.String({
				description:
					"The gh CLI subcommand (e.g. 'repo list', 'pr list', 'issue view 42'). Split on spaces into the command path.",
			}),
			args: Type.Optional(
				Type.Record(
					Type.String(),
					Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
					{
						description:
							"Command flags as a key/value map. Booleans become bare flags (e.g. {web: true} → --web). Strings/numbers become --flag value pairs. Arrays become repeated --flag value pairs.",
					},
				),
			),
			repo: Type.Optional(
				Type.String({
					description: "Target repository as owner/repo (translates to --repo owner/repo).",
				}),
			),
			jsonFields: Type.Optional(
				Type.Array(
					Type.String(),
					{ description: "GitHub fields to return as JSON (translates to --json field1,field2,...)." },
				),
			),
			jq: Type.Optional(
				Type.String({ description: "jq expression to filter/project JSON output (translates to --jq expr)." }),
			),
			limit: Type.Optional(
				Type.Integer({ minimum: 1, description: "Maximum number of results (translates to --limit N)." }),
			),
			timeoutSeconds: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 120,
					default: 30,
					description: "Command timeout in seconds (default 30, max 120).",
				}),
			),
			forceDangerous: Type.Optional(
				Type.Boolean({
					description: "Opt-in flag to allow destructive commands (repo delete, release delete, codespace delete). Requires explicit user confirmation.",
				}),
			),
		}),
		async execute(_toolCallId, params: GhParams, signal) {
			return runGh(params, (cmd, args, opts) => pi.exec(cmd, args, opts), signal);
		},
	});
}
