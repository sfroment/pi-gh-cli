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

/**
 * Commands that are destructive/unrecoverable — refused unless forceDangerous
 * is set. `cs delete` is gh's built-in alias for `codespace delete` and must
 * not bypass the gate.
 */
const DANGEROUS_COMMANDS = ["repo delete", "release delete", "codespace delete", "cs delete"];

/** Regex matching gh's not-authenticated error messages. */
const NOT_AUTHED = /not logged in|authentication required|auth.*fail/i;

/**
 * gh subcommands whose `<verb> view` form does NOT accept --limit
 * (only the list/search forms do). Passing --limit there fails with
 * "unknown flag: --limit", which gives the model nothing to recover with.
 * `codespace view`, `ruleset view`, and `project view` verified against the
 * real gh CLI — they exist and take no --limit. stripLimitForViewCommands
 * removes the flag and runs instead of failing the call.
 */
const NO_LIMIT_SUBCOMMANDS = new Set([
	"pr view",
	"issue view",
	"run view",
	"release view",
	"repo view",
	"gist view",
	"codespace view",
	"workflow view",
	"ruleset view",
	"project view",
]);

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

export type RawGhParams = Omit<GhParams, "subcommand" | "args"> & {
	subcommand?: string;
	args?: GhParams["args"] | string[];
};

/**
 * Mode #1's spec table: array-args flag spellings that promote to a
 * top-level field, with each field's parse step — one row per flag.
 */
const PROMOTABLE_FLAGS = new Map<
	string,
	{ field: "jsonFields" | "jq" | "repo" | "limit"; parse: (raw: string) => unknown }
>([
	["json", { field: "jsonFields", parse: (raw) => raw.split(",") }],
	["jq", { field: "jq", parse: (raw) => raw }],
	["repo", { field: "repo", parse: (raw) => raw }],
	["limit", { field: "limit", parse: (raw) => parseInt(raw, 10) }],
]);

/** Type guards deciding whether a nested value may harvest to each top-level key (mode #2). */
const KNOWN_KEY_GUARDS = new Map<string, (value: unknown) => boolean>([
	["subcommand", (v) => typeof v === "string"],
	["jsonFields", (v) => Array.isArray(v)],
	["jq", (v) => typeof v === "string"],
	["repo", (v) => typeof v === "string"],
	["limit", (v) => typeof v === "number"],
	["timeoutSeconds", (v) => typeof v === "number"],
	["forceDangerous", (v) => typeof v === "boolean"],
]);

/**
 * Parse the flag token at tokens[start]: `--name`, `--name=value`, or
 * `--name value` (consuming the next token when it is not itself a flag).
 */
function parseFlagToken(tokens: readonly string[], start: number): {
	name: string;
	value?: string;
	next: number;
} {
	const token = tokens[start];
	const eq = token.indexOf("=");
	if (eq !== -1) {
		return { name: token.slice(2, eq), value: token.slice(eq + 1), next: start };
	}
	if (start + 1 < tokens.length && !tokens[start + 1].startsWith("--")) {
		return { name: token.slice(2), value: tokens[start + 1], next: start + 1 };
	}
	return { name: token.slice(2), next: start };
}

/**
 * Parse array-form args (mode #1): positional tokens extend the subcommand,
 * flag tokens become args entries, and the top-level spellings (json, jq,
 * repo, limit) promote when unset. `promoted` is seeded with the top-level
 * fields, so a set field drops its parsed duplicate and top-level always wins.
 */
function parseArrayArgs(
	subcommand: string,
	tokens: readonly string[],
	rest: RawGhParams,
): Partial<GhParams> & { subcommand: string } {
	const parts: string[] = subcommand.trim().split(/\s+/).filter(Boolean);
	const flags: NonNullable<GhParams["args"]> = {};
	const promoted: Record<string, unknown> = {};
	for (const { field } of PROMOTABLE_FLAGS.values()) {
		promoted[field] = rest[field];
	}

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token.startsWith("--")) {
			parts.push(token);
			continue;
		}
		const { name, value, next } = parseFlagToken(tokens, i);
		i = next;
		const promote = PROMOTABLE_FLAGS.get(name);
		if (promote === undefined) {
			flags[name] = value === undefined ? true : value;
		} else if (value !== undefined && promoted[promote.field] === undefined) {
			promoted[promote.field] = promote.parse(value);
		}
		// A promotable flag whose top-level field is already set, or that carries
		// no value, is dropped — the top-level field always wins.
	}

	return {
		...promoted,
		subcommand: parts.join(" "),
		args: Object.keys(flags).length > 0 ? flags : undefined,
	} as Partial<GhParams> & { subcommand: string };
}

/** Mode #2 harvest state: keys lifted to the top level, and flags kept in args. */
type HarvestState = {
	harvested: Record<string, unknown>;
	remaining: NonNullable<GhParams["args"]>;
};

/**
 * Fold `args` found inside object args into the harvest. Array form recurses
 * via mode #1 (normalizeParams) and lifts the fields it promoted — a
 * subcommand only lifts when non-empty, so an inner "" never clobbers an
 * already-harvested one; object form merges its entries as flags. Returns
 * false for any other shape so the caller keeps the value as a flag.
 */
function mergeNestedArgs(
	value: unknown,
	rest: RawGhParams,
	subcommand: string,
	harvest: HarvestState,
): boolean {
	if (Array.isArray(value)) {
		const inner = normalizeParams({ ...rest, subcommand, args: value as string[] });
		if (inner.subcommand && !subcommand) harvest.harvested.subcommand = inner.subcommand;
		for (const { field } of PROMOTABLE_FLAGS.values()) {
			// No unset-check against rest here: parseArrayArgs seeds the promoted
			// fields from rest, so when a top-level field is set the inner value
			// can only echo it — harvesting is idempotent and needs no guard.
			const innerValue = (inner as Record<string, unknown>)[field];
			if (innerValue !== undefined) harvest.harvested[field] = innerValue;
		}
		if (inner.args) Object.assign(harvest.remaining, inner.args);
		return true;
	}
	if (typeof value === "object" && value !== null) {
		Object.assign(harvest.remaining, value as Record<string, string | number | boolean | string[]>);
		return true;
	}
	return false;
}

/**
 * Harvest object-form args (mode #2): known top-level keys nested inside
 * `args` lift to the top when unset and type-compatible. A set top-level
 * key drops its nested duplicate; a type-mismatched value falls through to
 * a flag so a mis-typed known key (e.g. {args:{limit:"5"}}) becomes
 * --limit 5 instead of being silently dropped.
 */
function harvestNestedArgs(
	rawArgs: Record<string, unknown>,
	rest: RawGhParams,
	subcommand: string,
): GhParams {
	const topLevel = rest as Record<string, unknown>;
	const harvest: HarvestState = { harvested: {}, remaining: {} };

	for (const [key, value] of Object.entries(rawArgs)) {
		const guard = KNOWN_KEY_GUARDS.get(key);
		if (guard === undefined) {
			// `args` inside args folds in via mergeNestedArgs; anything else
			// (including a non-object `args` value) stays a flag — never dropped.
			if (key !== "args" || !mergeNestedArgs(value, rest, subcommand, harvest)) {
				harvest.remaining[key] = value as string | number | boolean | string[];
			}
			continue;
		}
		// subcommand's unset check is falsy-based: "" lets a nested value through.
		const unset = key === "subcommand" ? !subcommand : topLevel[key] === undefined;
		if (!unset) continue; // top-level wins — the nested duplicate is dropped
		if (guard(value)) harvest.harvested[key] = value;
		// Type mismatch — kept as a flag, never silently dropped.
		else harvest.remaining[key] = value as string | number | boolean | string[];
	}

	// harvested holds only keys that were unset in rest, so it wins by spread;
	// the one cast trades seven hand-rolled ?? chains for the spread rule.
	return {
		...rest,
		...harvest.harvested,
		subcommand: (harvest.harvested.subcommand as string | undefined) ?? subcommand,
		args: Object.keys(harvest.remaining).length > 0 ? harvest.remaining : undefined,
	} as GhParams;
}

/**
 * Normalize raw tool params into canonical GhParams. Tolerates two mis-shaped
 * calls the model produces: args as a JSON array (mode #1, parseArrayArgs)
 * and known top-level keys nested inside an object args (mode #2,
 * harvestNestedArgs). Top-level fields always win.
 */
function normalizeParams(raw: RawGhParams): GhParams {
	const { args: rawArgs, ...rest } = raw;
	const subcommand = rest.subcommand ?? "";

	// Mode #1: args is an array of positional/flag tokens.
	if (Array.isArray(rawArgs)) {
		return { ...rest, ...parseArrayArgs(subcommand, rawArgs, rest) };
	}

	// Mode #2: object args — harvest known top-level keys from nested args.
	if (rawArgs && typeof rawArgs === "object") {
		return harvestNestedArgs(rawArgs, rest, subcommand);
	}

	// A bare primitive (out-schema junk) would serialize as per-character flags — drop it.
	return { ...rest, subcommand, args: typeof rawArgs === "object" ? rawArgs : undefined };
}

/**
 * One typed args entry as its argv tokens — gh takes flags as `--key`
 * alone or `--key value` pairs, and a falsy value means the flag was
 * not passed, never `--key false`.
 */
function flagValueTokens(
	key: string,
	value: string | number | boolean | string[] | null | undefined,
): string[] {
	if (value === false || value === null || value === undefined) return [];
	const flag = key.startsWith("--") ? key : `--${key}`;
	if (value === true) return [flag];
	if (Array.isArray(value)) return value.flatMap((v) => [flag, String(v)]);
	return [flag, String(value)];
}

/**
 * Serialize params into the gh CLI's argv format.
 *
 * The subcommand is split on whitespace (e.g. "repo list" → ["repo", "list"])
 * and args entries serialize via flagValueTokens. Global flags (--repo,
 * --json, --jq, --limit) are appended after subcommand and args, in that
 * order (--json before --jq).
 */
export function buildArgv(params: RawGhParams): string[] {
	const normalized = normalizeParams(params);
	const trimmed = normalized.subcommand.trim();
	if (trimmed.length === 0) {
		throw new Error("subcommand is required and must not be empty or whitespace");
	}

	const argv: string[] = trimmed.split(/\s+/);
	for (const [key, value] of Object.entries(normalized.args ?? {})) {
		argv.push(...flagValueTokens(key, value));
	}

	if (normalized.repo) {
		argv.push("--repo", normalized.repo);
	}
	if (normalized.jsonFields && normalized.jsonFields.length > 0) {
		argv.push("--json", normalized.jsonFields.join(","));
	}
	if (normalized.jq) {
		argv.push("--jq", normalized.jq);
	}
	if (typeof normalized.limit === "number") {
		argv.push("--limit", String(normalized.limit));
	}

	return argv;
}

/**
 * `view`-style subcommands fetch a single item and reject `--limit` with
 * "unknown flag: --limit". Instead of failing the call, strip the flag from
 * argv and run — the model's intent (fetch the item) is unambiguous. Returns
 * the scrubbed argv and whether anything was removed.
 */
export function stripLimitForViewCommands(
	argv: readonly string[],
	subcommand: string,
): { argv: string[]; stripped: boolean } {
	const words = subcommand.trim().toLowerCase().split(/\s+/);
	let isView = false;
	for (let i = 0; i < words.length - 1; i++) {
		if (NO_LIMIT_SUBCOMMANDS.has(`${words[i]} ${words[i + 1]}`)) {
			isView = true;
			break;
		}
	}
	if (!isView) return { argv: [...argv], stripped: false };
	const out: string[] = [];
	let dropNext = false;
	for (const token of argv) {
		if (dropNext) {
			dropNext = false;
			continue;
		}
		if (token === "--limit") {
			dropNext = true;
			continue;
		}
		if (token.startsWith("--limit=")) continue;
		out.push(token);
	}
	return { argv: out, stripped: out.length !== argv.length };
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

/** Result shape returned by runGh — the same shape as a Pi tool result. */
export type GhToolResult = {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError: boolean;
};

/**
 * Models echo CLI-style millisecond timeouts (60000, 120000); a multiple
 * of 1000 above the cap is read as ms, everything else clamps to 1..120s.
 */
function coerceTimeoutSeconds(raw: number | undefined): number {
	let seconds = raw ?? 30;
	if (seconds > 120 && seconds % 1000 === 0) seconds = seconds / 1000;
	return Math.min(Math.max(seconds, 1), 120);
}

function isAuthFailure(result: ExecResult): boolean {
	return (
		result.code !== 0 &&
		(NOT_AUTHED.test(result.stdout ?? "") || NOT_AUTHED.test(result.stderr ?? ""))
	);
}

function buildCommandResult(
	subcommand: string,
	argv: readonly string[],
	result: ExecResult,
	limitStripped: boolean,
): GhToolResult {
	const output = formatOutput(result.stdout ?? "", result.stderr ?? "");
	const truncation = truncateTail(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	const commandLine = `gh ${argv.join(" ")}`;
	const code = result.code;
	const codeText = code === null || code === undefined ? "unknown" : String(code);
	let text = `Command: ${commandLine}\nExit code: ${codeText}${result.killed ? " (killed)" : ""}\n\n${truncation.content}`;
	if (truncation.truncated) {
		text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
	}
	if (limitStripped) {
		text += "\n\n[--limit removed: view-style subcommands fetch a single item and do not accept --limit.]";
	}

	return {
		content: [{ type: "text", text }],
		details: {
			subcommand,
			argv,
			code,
			killed: result.killed,
			truncated: truncation.truncated,
			limitStripped: limitStripped || undefined,
		},
		isError: code !== 0,
	};
}

/**
 * Core execution logic, separated from the Pi tool wiring so it can be tested
 * with an injected `exec` (the only system boundary).
 */
export async function runGh(
	rawParams: RawGhParams,
	exec: GhExec,
	signal?: AbortSignal,
): Promise<GhToolResult> {
	// Normalize before guard: the model may nest subcommand inside args,
	// so we must harvest it before assertSafeCommand can see it.
	const params = normalizeParams(rawParams);

	if (!params.subcommand || params.subcommand.trim().length === 0) {
		throw new Error(
			"Pass a gh subcommand, for example `subcommand: 'repo list'` or `subcommand: 'pr list'`. " +
				"subcommand is not remembered between calls — pass it explicitly in every call.",
		);
	}
	assertSafeCommand(params);

	const { argv, stripped: limitStripped } = stripLimitForViewCommands(buildArgv(params), params.subcommand);
	const timeoutMs = coerceTimeoutSeconds(params.timeoutSeconds) * 1000;

	let result: ExecResult;
	try {
		result = await exec("gh", argv, { signal, timeout: timeoutMs });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to run gh CLI. Is it installed and on PATH? ${message}`);
	}

	// Give actionable guidance instead of the raw auth failure.
	if (isAuthFailure(result)) {
		return {
			content: [
				{
					type: "text",
					text:
						"You are not authenticated with the GitHub CLI. Run `gh auth login` to authenticate, " +
						"then retry the command.",
				},
			],
			details: { subcommand: params.subcommand, code: result.code, notAuthed: true },
			isError: true,
		};
	}

	return buildCommandResult(params.subcommand, argv, result, limitStripped);
}

const baseDir = dirname(fileURLToPath(import.meta.url));
const skillPath = join(baseDir, "skill", "SKILL.md");

const RELEVANT_PROMPT = /\b(github|gh cli|pr |pull request|issue|repo|release|workflow|gist)\b/i;

/** Canonical flat call-shape example — single source of truth for all prompt surfaces. */
export const GH_CALL_EXAMPLE = {
	subcommand: "pr list",
	args: { state: "open" },
	repo: "owner/repo",
	jsonFields: ["number", "title", "state"],
	limit: 10,
} as const;

export const GH_ARGS_DESCRIPTION =
	"Command flags as a key/value object map (e.g. {state: \"open\", web: true}). " +
	"Must be an object, not an array. " +
	"Never put subcommand, jsonFields, repo, jq, or limit inside args — " +
	"those are top-level params, not nested inside args.";

export const GH_SUBCOMMAND_DESCRIPTION =
	"The gh CLI subcommand as a top-level param, e.g. 'repo view owner/repo' or 'pr list'. " +
	"Split on spaces into the command path. " +
	"This is a top-level param — never nest it inside args.";

const GH_CALL_EXAMPLE_JSON = JSON.stringify(GH_CALL_EXAMPLE, null, 2);

/**
 * Guidance injected into the system prompt when the user's message looks
 * GitHub-related. Kept short — the full reference lives in the SKILL.md.
 */
export const GH_GUIDANCE = `## GitHub CLI (gh) guidance

The \`gh\` tool wraps the GitHub CLI (\`gh\`) as a single typed tool. All params are top-level siblings — never nest subcommand, jsonFields, repo, jq, or limit inside args.

Call shape (all params flat at top level):
\`\`\`json
${GH_CALL_EXAMPLE_JSON}
\`\`\`

- \`subcommand\` (top-level): the gh command, e.g. "pr list" or "repo view owner/repo".
- \`args\` (top-level): key/value object map of flags only, e.g. {state: "open", web: true}. Must be an object, not an array.
- \`jsonFields\` (top-level): string array for --json output.
- \`jq\` (top-level): jq filter expression.
- \`repo\` (top-level): target repo as owner/repo.
- \`limit\` (top-level): max results. Only valid on list-style commands (e.g. \`pr list\`); \`view\` commands reject it with "unknown flag: --limit" — the tool strips the flag and runs (noted in the output).

Key patterns:
- List PRs: \`subcommand: "pr list"\`, \`args: { state: "open" }\`, \`limit: 10\`.
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
			"All params are top-level siblings: subcommand (e.g. 'pr list'), args (object of flags), jsonFields, jq, repo, limit. " +
			"Never nest subcommand/jsonFields/repo/jq/limit inside args — args is a flat key/value object of flags only.\n" +
			"Example call shape:\n" + GH_CALL_EXAMPLE_JSON + "\n" +
			"Destructive operations (repo delete, release delete, codespace delete) require `forceDangerous: true`.",
		promptSnippet:
			"Interact with GitHub (repos, PRs, issues, releases, workflows, gists) via the gh CLI.",
		promptGuidelines: [
			"Use the `gh` tool when the user asks about GitHub — repos, PRs, issues, releases, workflows, or gists. It calls the gh CLI directly.",
			"All params are top-level siblings: subcommand, args, jsonFields, jq, repo, limit, forceDangerous. Never nest one inside another.",
			"`args` is a key/value object of flags only (e.g. {state: \"open\", web: true}), never an array, and never contains subcommand/jsonFields/repo/jq/limit.",
			"Use `jsonFields` + `jq` for structured output when you need to parse results programmatically.",
			"Destructive operations (`repo delete`, `release delete`, `codespace delete`) require `forceDangerous: true`. Always confirm with the user before using it.",
			"If the tool reports you are not authenticated, tell the user to run `gh auth login`.",
		],
		parameters: Type.Object({
			subcommand: Type.Optional(
				Type.String({
					description: GH_SUBCOMMAND_DESCRIPTION,
				}),
			),
			args: Type.Optional(
				Type.Union([
					Type.Record(
						Type.String(),
						Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Array(Type.String())]),
					),
					Type.Array(Type.String()),
				], {
					description: GH_ARGS_DESCRIPTION,
				}),
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
					default: 30,
					description:
						"Command timeout in seconds (default 30, max 120). A multiple of 1000 above 120 is treated as milliseconds.",
				}),
			),
			forceDangerous: Type.Optional(
				Type.Boolean({
					description: "Opt-in flag to allow destructive commands (repo delete, release delete, codespace delete). Requires explicit user confirmation.",
				}),
			),
		}),
		async execute(_toolCallId, params: RawGhParams, signal) {
			return runGh(params, (cmd, args, opts) => pi.exec(cmd, args, opts), signal);
		},
	});
}
