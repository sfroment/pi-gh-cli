/**
 * Shape-sync harness (issue #26) — mechanically validates every gh command
 * shape the extension documents against the INSTALLED gh CLI:
 *
 *   1. every documented verb exists (help exit code + usage line),
 *   2. every documented flag exists on its verb (FLAGS / INHERITED FLAGS),
 *   3. the tool's translation parameters (repo, jsonFields, jq, limit)
 *      produce valid argv for that verb — checked through the real
 *      buildArgv, so the translation itself is exercised, and documented
 *      jsonFields land in the verb's JSON FIELDS list.
 *
 * Shapes are EXTRACTED from the docs, never curated, so guidance edits are
 * picked up by the next run:
 *   - skill/SKILL.md: "Common gh subcommands" bullets (verb + args pairs),
 *     "Full subcommand surface" bullets (verb paths, parenthesized
 *     expansions, inline `gh ...` examples), the "Verification" tool-param
 *     fragments, the "Structured output" block, and the view-forms list.
 *   - README.md: the JSON example blocks.
 *   - index.ts: GH_CALL_EXAMPLE, NO_LIMIT_SUBCOMMANDS, DANGEROUS_COMMANDS
 *     (imported directly — the description strings' prose e.g.-mentions are
 *     covered by these structured shapes and the skill sections).
 *
 * Opt-in: `GH_SHAPE_SYNC=1 bun test` (or `bun run test:shape-sync`). The
 * default `bun test` run stays green — the same convention as the
 * TEST_INTEGRATION-gated tests in index.test.ts. Only `gh ... --help` is
 * ever spawned: no auth, no network, no mutations. Help for every candidate
 * verb is fetched in one parallel prewarm pass so tests stay well under
 * bun's per-test timeout; the harness skips cleanly when the gh CLI is not
 * on PATH, and otherwise fails loudly, listing every mismatch with its
 * source (file:line) so the guidance can be fixed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	buildArgv,
	DANGEROUS_COMMANDS,
	GH_CALL_EXAMPLE,
	NO_LIMIT_SUBCOMMANDS,
	type RawGhParams,
} from "./index.ts";

const OPT_IN = process.env.GH_SHAPE_SYNC === "1";
const GH_PATH = Bun.which("gh");
if (OPT_IN && !GH_PATH) {
	console.warn("[shape-sync] GH_SHAPE_SYNC is set but the gh CLI is not on PATH — skipping.");
}

const HERE = import.meta.dir;
const SKILL_LINES = readFileSync(join(HERE, "skill", "SKILL.md"), "utf8").split("\n");
const SKILL_TEXT = SKILL_LINES.join("\n");
const README_TEXT = readFileSync(join(HERE, "README.md"), "utf8");

type PairValue = string | number | boolean | string[];

/** One documented call shape, from wherever the docs state it. */
type Shape = {
	/** Where the shape is documented, for mismatch reports. */
	source: string;
	/** Full subcommand as documented (may include positionals). */
	subcommand: string;
	/** Pairs documented inside an `args: { ... }` context (nested keys harvest). */
	args: Record<string, PairValue>;
	/** Documented top-level params: repo, jsonFields, jq, limit. */
	top: Record<string, PairValue>;
};

type Mismatch = { source: string; detail: string };

// ——— installed-CLI introspection ———————————————————————————————

type HelpInfo = {
	exists: boolean;
	usage: string | null;
	flags: Set<string>;
	jsonFields: Set<string> | null;
};

const helpCache = new Map<string, HelpInfo>();

/** All-caps flush-left section headers in gh help output. */
const SECTION_HEADER = /^[A-Z][A-Z ]*$/;

/**
 * gh built-in aliases (e.g. `cs` → `codespace`): the alias resolves and runs,
 * but `--help` prints the CANONICAL command in its USAGE line — so the
 * expected usage prefix must be canonicalized or the entry reads as missing.
 */
const GH_ALIASES: Record<string, string> = { cs: "codespace" };

function parseHelp(words: readonly string[], exitCode: number, text: string): HelpInfo {
	const lines = text.split("\n");
	const usageIndex = lines.findIndex((line) => line.trim() === "USAGE");
	const usage = usageIndex === -1 ? null : (lines[usageIndex + 1] ?? "").trim() || null;
	const flags = new Set<string>();
	let jsonFields: Set<string> | null = null;
	let section = "";
	for (const line of lines) {
		if (SECTION_HEADER.test(line)) {
			section = line.trim();
			if (section === "JSON FIELDS") jsonFields = new Set();
			continue;
		}
		if (section === "FLAGS" || section === "INHERITED FLAGS") {
			const flag = line.match(/^\s*(?:-\w,\s*)?(--[a-zA-Z][\w-]*)/);
			if (flag) flags.add(flag[1]);
		} else if (section === "JSON FIELDS" && jsonFields) {
			for (const word of line.split(/[\s,]+/)) if (word) jsonFields.add(word);
		}
	}
	const canonical = words.map((word) => GH_ALIASES[word] ?? word);
	const path = `gh ${canonical.join(" ")}`;
	const exists = exitCode === 0 && (usage === null || usage.startsWith(path));
	return { exists, usage, flags, jsonFields };
}

function cacheHelp(words: readonly string[], exitCode: number, text: string): HelpInfo {
	const key = words.join(" ");
	const info = parseHelp(words, exitCode, text);
	helpCache.set(key, info);
	return info;
}

/** Parsed help for a command path — cache hit, or a synchronous fallback spawn. */
function ghHelp(words: readonly string[]): HelpInfo {
	const key = words.join(" ");
	const cached = helpCache.get(key);
	if (cached) return cached;
	const proc = Bun.spawnSync({
		cmd: ["gh", ...words, "--help"],
		stdout: "pipe",
		stderr: "pipe",
	});
	// A killed/failed spawn reads as "does not exist".
	return cacheHelp(words, proc.exitCode ?? 1, `${proc.stdout.toString()}\n${proc.stderr.toString()}`);
}

/**
 * Split a documented subcommand into its verb (the longest prefix that is a
 * real command path) and the positional remainder — `release view v1.0.0`
 * resolves to verb `release view` + positional `v1.0.0`. Runs entirely on the
 * prewarmed cache.
 */
function resolveVerb(subcommand: string): { words: string[]; positionals: string[] } {
	const tokens = subcommand.trim().split(/\s+/).filter(Boolean);
	let words: string[] = [];
	for (let i = 1; i <= tokens.length; i++) {
		if (!ghHelp(tokens.slice(0, i)).exists) break;
		words = tokens.slice(0, i);
	}
	return { words, positionals: tokens.slice(words.length) };
}

// ——— doc parsing (pure, no spawns) ————————————————————————————

/** ALL-CAPS placeholder tokens in documented verb spans: `OWNER/REPO`, `N`, `TAG`, … */
const PLACEHOLDER = /^[A-Z][A-Z0-9_/.-]*$/;

/** One `key: value` pair as the docs write them: `state: "open"`, `limit: 10`, `label: ["bug"]`, `web: true`. */
const PAIR_RE = /([a-zA-Z][\w-]*):\s*(true|false|"[^"]*"|\d+(?:\.\d+)?|\[[^\]]*\])/g;

function parsePairValue(raw: string): PairValue {
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw.startsWith('"')) return raw.slice(1, -1);
	if (raw.startsWith("[")) {
		return raw
			.slice(1, -1)
			.split(",")
			.map((item) => item.trim().replace(/^"|"$/g, ""))
			.filter(Boolean);
	}
	return Number(raw);
}

function pairs(text: string): Array<[string, PairValue]> {
	const out: Array<[string, PairValue]> = [];
	PAIR_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = PAIR_RE.exec(text)) !== null) out.push([match[1], parsePairValue(match[2])]);
	return out;
}

/** Lines of a markdown section, numbered for mismatch reports. */
function numberedSection(md: string, heading: string, stop: (line: string) => boolean) {
	const lines = md.split("\n");
	const start = lines.findIndex((line) => line === heading);
	if (start === -1) return [] as Array<{ text: string; no: number }>;
	const out: Array<{ text: string; no: number }> = [];
	for (let i = start + 1; i < lines.length; i++) {
		if (stop(lines[i])) break;
		out.push({ text: lines[i], no: i + 1 });
	}
	return out;
}

/** Turn one doc line's pairs into a shape; `subcommand` pairs extend the verb. */
function shapeFromPairs(
	source: string,
	verbWords: string[],
	linePairs: Array<[string, PairValue]>,
	topLevel: boolean,
): Shape {
	const shape: Shape = { source, subcommand: verbWords.join(" "), args: {}, top: {} };
	for (const [key, value] of linePairs) {
		if (key === "subcommand" && typeof value === "string") {
			shape.subcommand = value;
		} else if (topLevel && (key === "repo" || key === "jsonFields" || key === "jq" || key === "limit")) {
			shape.top[key] = value;
		} else {
			shape.args[key] = value;
		}
	}
	return shape;
}

/**
 * "Common gh subcommands" bullets: `- \`repo view OWNER/REPO\` — … (\`args: { web: true }\`…)`.
 * Pairs are documented inside an `args: { … }` context, so they go through
 * args — buildArgv harvests nested tool-param keys exactly as the tool does.
 */
function extractCommonShapes(): Shape[] {
	const section = numberedSection(
		SKILL_TEXT,
		"## Common gh subcommands",
		(line) => line === "### Full subcommand surface" || line.startsWith("## "),
	);
	const shapes: Shape[] = [];
	for (const { text, no } of section) {
		if (!text.startsWith("- `")) continue;
		const verbSpan = text.match(/`([^`]+)`/)?.[1] ?? "";
		const verbWords = verbSpan.split(/\s+/).filter((word) => word && !PLACEHOLDER.test(word));
		shapes.push(shapeFromPairs(`skill/SKILL.md:${no}`, verbWords, pairs(text), false));
	}
	return shapes;
}

/**
 * "Full subcommand surface" bullets, un-resolved: exact verb paths from head
 * verbs (optionally expanded by pure comma-separated word lists in the first
 * parenthetical — `gist` … (create, list, view)), plus the token lists of any
 * inline `gh …` examples, which resolve against the CLI once prewarmed.
 */
function extractFullSurface(): { paths: Array<{ source: string; words: string[] }>; inline: Array<{ source: string; tokens: string[] }> } {
	const section = numberedSection(SKILL_TEXT, "### Full subcommand surface", (line) => line.startsWith("## "));
	const paths: Array<{ source: string; words: string[] }> = [];
	const inline: Array<{ source: string; tokens: string[] }> = [];
	for (const { text, no } of section) {
		if (!text.startsWith("- `")) continue;
		const source = `skill/SKILL.md:${no}`;
		const [head, ...tail] = text.split("—");
		const rest = tail.join("—");
		const heads = [...head.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean);
		const paren = rest.match(/\(([^)]*)\)/)?.[1]?.trim() ?? "";
		const subs =
			paren && /^[a-z][\w-]*(\s*,\s*[a-z][\w-]*)*$/.test(paren)
				? paren.split(",").map((word) => word.trim())
				: [];
		for (const headVerb of heads) {
			for (const sub of subs) paths.push({ source, words: `${headVerb} ${sub}`.split(" ") });
			if (subs.length === 0) paths.push({ source, words: headVerb.split(" ") });
		}
		for (const example of rest.matchAll(/`gh\s+([^`]+)`/g)) {
			inline.push({
				source,
				tokens: example[1].trim().split(/\s+/).filter(Boolean),
			});
		}
	}
	return { paths, inline };
}

/** "Verification" tool-param fragments: `subcommand: "pr list", repo: "owner/repo", limit: 5`. */
function extractVerificationShapes(): Shape[] {
	const shapes: Shape[] = [];
	for (const { text, no } of numberedSection(SKILL_TEXT, "## Verification", () => false)) {
		for (const span of text.matchAll(/`([^`]+)`/g)) {
			const spanPairs = pairs(span[1]);
			const subcommand = spanPairs.find(([key]) => key === "subcommand");
			if (!subcommand || typeof subcommand[1] !== "string") continue;
			shapes.push(shapeFromPairs(`skill/SKILL.md:${no}`, [], spanPairs, true));
		}
	}
	return shapes;
}

/** The "Structured output" example block in the skill's tool reference. */
function extractStructuredOutputShape(): Shape | null {
	const headingIndex = SKILL_TEXT.indexOf("### Structured output");
	if (headingIndex === -1) return null;
	const block = SKILL_TEXT.slice(headingIndex).match(/```\n([\s\S]*?)```/)?.[1];
	if (!block) return null;
	const blockPairs = pairs(block);
	const subcommand = blockPairs.find(([key]) => key === "subcommand");
	if (!subcommand || typeof subcommand[1] !== "string") return null;
	const no = SKILL_TEXT.slice(0, headingIndex).split("\n").length;
	return shapeFromPairs(`skill/SKILL.md:${no}`, [], blockPairs, true);
}

/** README "Examples": every ```json block that documents a call shape. */
function extractReadmeShapes(): Shape[] {
	const shapes: Shape[] = [];
	let match: RegExpExecArray | null;
	const blockRe = /```json\n([\s\S]*?)```/g;
	while ((match = blockRe.exec(README_TEXT)) !== null) {
		const parsed = JSON.parse(match[1]) as Record<string, unknown>;
		if (typeof parsed.subcommand !== "string") continue;
		const { subcommand, args, ...top } = parsed;
		const no = README_TEXT.slice(0, match.index).split("\n").length;
		shapes.push({
			source: `README.md:${no}`,
			subcommand,
			args: (args as Record<string, PairValue>) ?? {},
			top: top as Record<string, PairValue>,
		});
	}
	return shapes;
}

/** Structured tool-param shapes outside the Common bullets (which have their own test). */
function structuredShapes(): Shape[] {
	const structuredOutput = extractStructuredOutputShape();
	return [
		...extractVerificationShapes(),
		...(structuredOutput ? [structuredOutput] : []),
		...extractReadmeShapes(),
		{
			source: "index.ts GH_CALL_EXAMPLE (canonical shape in tool description + prompt guidance)",
			subcommand: GH_CALL_EXAMPLE.subcommand,
			args: { ...GH_CALL_EXAMPLE.args },
			top: {
				repo: GH_CALL_EXAMPLE.repo,
				jsonFields: [...GH_CALL_EXAMPLE.jsonFields],
				limit: GH_CALL_EXAMPLE.limit,
			},
		},
	];
}

/** Every shape the structured sections document — the harness's full input set. */
function allShapes(): Shape[] {
	return [...extractCommonShapes(), ...structuredShapes()];
}

/** The `repo` override pitfall's accept/reject claims, pinned against the CLI. */
function extractRepoOverrideClaims(): { accepts: string[]; rejects: string[] } | null {
	const line = SKILL_LINES.find((text) => text.startsWith("- **`repo` override**"));
	if (!line) return null;
	const acceptsMatch = line.match(/Accepted by [^()]*\(([^)]+)\)/);
	const rejectedFrom = line.indexOf("rejected");
	if (!acceptsMatch || rejectedFrom === -1) return null;
	const spans = (raw: string[]) => raw.map((span) => span.replace(/`/g, "").trim()).filter(Boolean);
	const rejects = spans(
		[...line.slice(rejectedFrom).matchAll(/\(([^)]+)\)/g)].flatMap((m) => m[1].split(",")),
	);
	return { accepts: spans(acceptsMatch[1].split(",")), rejects };
}

// ——— prewarm: fetch every candidate's help in parallel ———————————

/**
 * Every command path the checks might look at: all prefixes of each
 * documented subcommand (stopping at `--` passthroughs), the full-surface
 * paths and inline examples, the strip table, and the danger list.
 */
function prewarmPaths(): string[][] {
	const paths = new Map<string, string[]>();
	const addTokens = (tokens: string[]) => {
		const end = tokens.indexOf("--");
		const stop = end === -1 ? tokens.length : end;
		for (let i = 1; i <= stop; i++) {
			const words = tokens.slice(0, i);
			paths.set(words.join(" "), words);
		}
	};
	for (const shape of allShapes()) addTokens(shape.subcommand.trim().split(/\s+/).filter(Boolean));
	const fullSurface = extractFullSurface();
	for (const { words } of fullSurface.paths) addTokens(words);
	for (const { tokens } of fullSurface.inline) addTokens(tokens);
	const claims = extractRepoOverrideClaims();
	for (const verb of [...(claims?.accepts ?? []), ...(claims?.rejects ?? [])]) {
		addTokens(verb.trim().split(/\s+/).filter(Boolean));
	}
	for (const entry of [...NO_LIMIT_SUBCOMMANDS, ...DANGEROUS_COMMANDS]) {
		addTokens(entry.split(" "));
	}
	return [...paths.values()];
}

let prewarmPromise: Promise<void> | null = null;

/** Fetch help for every candidate path in parallel, once per run. */
function ensurePrewarmed(): Promise<void> {
	if (!prewarmPromise) {
		prewarmPromise = (async () => {
			await Promise.all(
				prewarmPaths().map(async (words) => {
					const key = words.join(" ");
					if (helpCache.has(key)) return;
					const proc = Bun.spawn(["gh", ...words, "--help"], {
						stdout: "pipe",
						stderr: "pipe",
					});
					const [stdout, stderr] = await Promise.all([
						new Response(proc.stdout).text(),
						new Response(proc.stderr).text(),
					]);
					await proc.exited;
					// A killed/failed spawn reads as "does not exist".
					cacheHelp(words, proc.exitCode ?? 1, `${stdout}\n${stderr}`);
				}),
			);
		})();
	}
	return prewarmPromise;
}

// ——— shape validation ——————————————————————————————————————————

/** Counters for the run summary (evidence for the verification tickets). */
const stats = { shapes: 0, verbs: new Set<string>(), flagChecks: 0, mismatches: 0 };

function shapeToParams(shape: Shape): RawGhParams {
	const params: RawGhParams = { subcommand: shape.subcommand };
	if (Object.keys(shape.args).length > 0) params.args = shape.args;
	if (typeof shape.top.repo === "string") params.repo = shape.top.repo;
	if (Array.isArray(shape.top.jsonFields)) params.jsonFields = shape.top.jsonFields;
	if (typeof shape.top.jq === "string") params.jq = shape.top.jq;
	if (typeof shape.top.limit === "number") params.limit = shape.top.limit;
	return params;
}

function validateShape(shape: Shape): Mismatch[] {
	const resolved = resolveVerb(shape.subcommand);
	if (resolved.words.length === 0) {
		return [
			{
				source: shape.source,
				detail: `documented verb not found on the installed gh CLI: \`${shape.subcommand}\``,
			},
		];
	}
	const verb = resolved.words.join(" ");
	const help = ghHelp(resolved.words);
	const params = shapeToParams(shape);
	stats.shapes += 1;
	stats.verbs.add(verb);
	const mismatches: Mismatch[] = [];

	// The real translation: every flag the tool would run must be accepted.
	// After a bare `--` the CLI passes tokens through (git/ssh flags), so
	// flag checking stops there — those belong to the inner command.
	const argv = buildArgv(params);
	for (const token of argv) {
		if (token === "--") break;
		if (!token.startsWith("--")) continue;
		stats.flagChecks += 1;
		if (!help.flags.has(token)) {
			mismatches.push({
				source: shape.source,
				detail: `documented flag \`${token}\` does not exist on \`${verb}\` on the installed gh CLI`,
			});
		}
	}

	// Documented jsonFields must be real JSON fields of the verb.
	if (params.jsonFields && help.jsonFields) {
		for (const field of params.jsonFields) {
			if (!help.jsonFields.has(field)) {
				mismatches.push({
					source: shape.source,
					detail: `documented jsonFields entry \`${field}\` is not a JSON field of \`${verb}\` on the installed gh CLI`,
				});
			}
		}
	}
	return mismatches;
}

/** Throw with the full mismatch list — never fail on the first one found. */
function report(mismatches: Mismatch[], context: string): void {
	if (mismatches.length === 0) return;
	stats.mismatches += mismatches.length;
	const list = mismatches.map((m, i) => `  ${i + 1}. [${m.source}] ${m.detail}`).join("\n");
	throw new Error(
		`${context}: ${mismatches.length} mismatch(es) against the installed gh CLI:\n${list}\n` +
			"Fix the guidance at its source (skill/SKILL.md, README.md, or the index.ts constants), then re-run `GH_SHAPE_SYNC=1 bun test`.",
	);
}

describe.skipIf(!OPT_IN || !GH_PATH)("shape-sync: documented gh shapes vs installed gh CLI", () => {
	test("skill 'Common gh subcommands' shapes (verb, flags, translation argv)", async () => {
		await ensurePrewarmed();
		const shapes = extractCommonShapes();
		expect(shapes.length).toBeGreaterThanOrEqual(30);
		report(shapes.flatMap(validateShape), "skill 'Common gh subcommands'");
	});

	test("skill 'Full subcommand surface' verbs exist", async () => {
		await ensurePrewarmed();
		const { paths, inline } = extractFullSurface();
		const mismatches: Mismatch[] = [];
		for (const { source, words } of paths) {
			stats.verbs.add(words.join(" "));
			if (!ghHelp(words).exists) {
				mismatches.push({
					source,
					detail: `documented verb does not exist on the installed gh CLI: \`gh ${words.join(" ")}\``,
				});
			}
		}
		for (const { source, tokens } of inline) {
			const resolved = resolveVerb(tokens.join(" "));
			if (resolved.words.length === 0) {
				mismatches.push({
					source,
					detail: `documented example verb not found on the installed gh CLI: \`gh ${tokens.join(" ")}\``,
				});
			}
		}
		expect(paths.length + inline.length).toBeGreaterThanOrEqual(40);
		report(mismatches, "skill 'Full subcommand surface'");
	});

	test("skill 'Verification' + 'Structured output', README examples, GH_CALL_EXAMPLE", async () => {
		await ensurePrewarmed();
		const shapes = structuredShapes();
		expect(shapes.length).toBeGreaterThanOrEqual(7);
		report(shapes.flatMap(validateShape), "structured tool-param shapes");
	});

	test("view-form strip table (NO_LIMIT_SUBCOMMANDS) matches the CLI and the documented view list", async () => {
		await ensurePrewarmed();
		const mismatches: Mismatch[] = [];
		for (const entry of NO_LIMIT_SUBCOMMANDS) {
			const help = ghHelp(entry.split(" "));
			if (!help.exists) {
				mismatches.push({
					source: "index.ts NO_LIMIT_SUBCOMMANDS",
					detail: `verb \`${entry}\` does not exist on the installed gh CLI`,
				});
			} else if (help.flags.has("--limit")) {
				mismatches.push({
					source: "index.ts NO_LIMIT_SUBCOMMANDS",
					detail: `\`${entry}\` accepts --limit on the installed gh CLI — the strip table is stale`,
				});
			}
		}
		// The skill's Tool reference documents the view forms as a list —
		// it must name exactly the strip table's entries.
		const documented = SKILL_TEXT.match(/`view` forms \(([^)]+)\)/)?.[1] ?? null;
		const documentedSet = new Set(
			(documented ?? "")
				.replace(/`/g, "")
				.split(",")
				.map((word) => `${word.trim()} view`)
				.filter((entry) => entry !== " view"),
		);
		if (documented === null) {
			mismatches.push({
				source: "skill/SKILL.md tool reference",
				detail: "the view-forms list could not be found — the limit guidance changed",
			});
		} else {
			for (const entry of documentedSet) {
				if (!NO_LIMIT_SUBCOMMANDS.has(entry)) {
					mismatches.push({
						source: "skill/SKILL.md tool reference",
						detail: `documented view form \`${entry}\` is missing from NO_LIMIT_SUBCOMMANDS`,
					});
				}
			}
			for (const entry of NO_LIMIT_SUBCOMMANDS) {
				if (!documentedSet.has(entry)) {
					mismatches.push({
						source: "index.ts NO_LIMIT_SUBCOMMANDS",
						detail: `\`${entry}\` is in the strip table but not documented as a view form in the skill`,
					});
				}
			}
		}
		report(mismatches, "view-form strip table");
	});

	test("dangerous-command gate list exists on the installed CLI", async () => {
		await ensurePrewarmed();
		const mismatches: Mismatch[] = [];
		for (const entry of DANGEROUS_COMMANDS) {
			if (!ghHelp(entry.split(" ")).exists) {
				mismatches.push({
					source: "index.ts DANGEROUS_COMMANDS",
					detail: `verb \`${entry}\` does not exist on the installed gh CLI`,
				});
			}
		}
		report(mismatches, "dangerous-command gate list");
	});

	test("`repo` override pitfall claims match --repo acceptance on the installed CLI", async () => {
		await ensurePrewarmed();
		const claims = extractRepoOverrideClaims();
		expect(claims).not.toBeNull();
		const mismatches: Mismatch[] = [];
		for (const claimed of claims!.accepts) {
			const help = ghHelp(resolveVerb(claimed).words);
			if (!help.exists) {
				mismatches.push({
					source: "skill/SKILL.md `repo` override pitfall",
					detail: `claimed --repo-accepting verb does not exist: \`${claimed}\``,
				});
			} else if (!help.flags.has("--repo")) {
				mismatches.push({
					source: "skill/SKILL.md `repo` override pitfall",
					detail: `\`${claimed}\` does NOT accept --repo on the installed gh CLI`,
				});
			}
		}
		for (const claimed of claims!.rejects) {
			const help = ghHelp(resolveVerb(claimed).words);
			if (!help.exists) {
				mismatches.push({
					source: "skill/SKILL.md `repo` override pitfall",
					detail: `claimed --repo-rejecting verb does not exist: \`${claimed}\``,
				});
			} else if (help.flags.has("--repo")) {
				mismatches.push({
					source: "skill/SKILL.md `repo` override pitfall",
					detail: `\`${claimed}\` DOES accept --repo on the installed gh CLI`,
				});
			}
		}
		report(mismatches, "`repo` override pitfall claims");
	});

	test("run summary (guards against vacuous extraction)", async () => {
		await ensurePrewarmed();
		console.log(
			`[shape-sync] ${stats.shapes} documented shapes validated, ` +
				`${stats.verbs.size} unique verbs checked, ${stats.flagChecks} flag tokens verified against the installed gh CLI — ${stats.mismatches} mismatch(es).`,
		);
		expect(stats.shapes).toBeGreaterThanOrEqual(40);
		expect(stats.verbs.size).toBeGreaterThanOrEqual(55);
		expect(stats.flagChecks).toBeGreaterThanOrEqual(50);
	});
});
