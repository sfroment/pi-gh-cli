import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateTail,
} from "@earendil-works/pi-coding-agent";

/** Commands that are destructive/unrecoverable — refused unless forceDangerous is set. */
const DANGEROUS_COMMANDS = ["repo delete", "release delete"];

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
 * Args are serialized as `key=value` tokens; booleans become bare flags;
 * arrays become repeated tokens; false/null/undefined are skipped.
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
		if (value === true) {
			argv.push(key);
		} else if (Array.isArray(value)) {
			for (const v of value) {
				argv.push(`${key}=${String(v)}`);
			}
		} else {
			argv.push(`${key}=${String(value)}`);
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
	const normalized = params.subcommand.trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
	if (DANGEROUS_COMMANDS.some((cmd) => normalized.startsWith(cmd))) {
		if (params.forceDangerous === true) return;
		throw new Error(
			`Refusing \`${normalized}\` from the gh tool — this operation is unrecoverable. ` +
				"To override, set `forceDangerous: true` and confirm with the user first.",
		);
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
