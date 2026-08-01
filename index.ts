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
