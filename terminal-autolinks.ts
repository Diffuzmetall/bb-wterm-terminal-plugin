/**
 * Bare text links in terminal output.
 *
 * Programs only emit OSC 8 hyperlinks when they recognize the terminal, and
 * most TUIs in a BB terminal decide they do not. This scanner recovers the
 * links that are plainly there as text — HTTP(S) URLs and file paths — so the
 * renderer can make them clickable anyway.
 *
 * The rules stay deliberately narrow: a false link is worse than a missed one.
 */

export type TerminalAutoLink =
	| {
			kind: "url";
			start: number;
			end: number;
			url: string;
	  }
	| {
			kind: "file";
			start: number;
			end: number;
			path: string;
			absolute: boolean;
			line: number | null;
			column: number | null;
	  };

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`\\|]+/giu;
const TRAILING_URL_PUNCTUATION = /[.,;:!?)\]}'"]+$/u;
const TOKEN_PATTERN = /[^\s<>"'`()[\]{}|*?]+/gu;
const MAX_PATH_LENGTH = 4096;
const MAX_LINE_NUMBER = 1_000_000;

function maskRange(text: string, start: number, end: number): string {
	return `${text.slice(0, start)}${" ".repeat(end - start)}${text.slice(end)}`;
}

function trimTrailingPathPunctuation(token: string): string {
	return token.replace(/[.,;:!?]+$/u, "");
}

function splitLocationSuffix(token: string): {
	path: string;
	line: number | null;
	column: number | null;
} {
	const match = /^(.*?):([0-9]{1,7})(?::([0-9]{1,7}))?$/u.exec(token);
	if (!match) return { path: token, line: null, column: null };
	const line = Number.parseInt(match[2] ?? "", 10);
	if (!Number.isInteger(line) || line < 1 || line > MAX_LINE_NUMBER) {
		return { path: token, line: null, column: null };
	}
	const column = match[3] === undefined ? null : Number.parseInt(match[3], 10);
	return {
		path: match[1] ?? "",
		line,
		column:
			column !== null && Number.isInteger(column) && column >= 1 ? column : null,
	};
}

function hasFileExtension(path: string): boolean {
	const lastSegment = path.slice(path.lastIndexOf("/") + 1);
	const dot = lastSegment.lastIndexOf(".");
	if (dot <= 0) return false;
	const extension = lastSegment.slice(dot + 1);
	return /^[A-Za-z0-9]{1,10}$/u.test(extension) && /[A-Za-z]/u.test(extension);
}

/**
 * A path is linkable when it is unambiguous enough to be worth a click:
 * a slash-separated location whose last segment looks like a file name.
 */
function classifyPath(token: string): {
	path: string;
	absolute: boolean;
} | null {
	if (token.length === 0 || token.length > MAX_PATH_LENGTH) return null;
	if (token === "/" || token.endsWith("/")) return null;
	const { path } = splitLocationSuffix(token);
	if (path.length === 0) return null;
	// A home shorthand cannot be resolved without knowing the home directory,
	// and a literal `~/x` would open the wrong file, so leave it as text.
	if (path.startsWith("~")) return null;
	const absolute = path.startsWith("/");
	const separator = path.indexOf("/");
	if (separator === -1) return null;
	if (!absolute && separator === 0) return null;
	// A single leading slash is as likely to be the tail of a glob as a real
	// filesystem path, so absolute paths need one more separator.
	if (absolute && path.split("/").length < 3) return null;
	if (!hasFileExtension(path)) return null;
	if (/[/.]+$/u.test(path)) return null;
	return { path, absolute };
}

/**
 * Find every bare link in one rendered terminal row.
 *
 * Results are ordered and non-overlapping; callers may add them to the row
 * in a single pass.
 */
export function scanTerminalAutoLinks(text: string): TerminalAutoLink[] {
	if (text.length === 0) return [];
	const links: TerminalAutoLink[] = [];
	let masked = text;

	for (const match of text.matchAll(URL_PATTERN)) {
		const start = match.index;
		const raw = match[0];
		const url = raw.replace(TRAILING_URL_PUNCTUATION, "");
		if (url.length === 0) continue;
		links.push({ kind: "url", start, end: start + url.length, url });
		masked = maskRange(masked, start, start + url.length);
	}

	for (const match of masked.matchAll(TOKEN_PATTERN)) {
		const start = match.index;
		const token = trimTrailingPathPunctuation(match[0]);
		if (token.length === 0) continue;
		// `**/foo.ts` and friends are globs, not files.
		if (masked[start - 1] === "*") continue;
		const withoutScheme = token.startsWith("file://")
			? token.slice("file://".length)
			: token;
		const location = splitLocationSuffix(withoutScheme);
		const classified = classifyPath(withoutScheme);
		if (classified === null) continue;
		links.push({
			kind: "file",
			start,
			end: start + token.length,
			path: classified.path,
			absolute: classified.absolute,
			line: location.line,
			column: location.column,
		});
	}

	return links.sort((left, right) => left.start - right.start);
}

/**
 * Whether a match is only a fragment of a link the terminal has not finished
 * painting: the row filled its last column and no row follows it yet.
 */
export function isPartialAutoLink(
	link: TerminalAutoLink,
	text: string,
	boundaries: { wrapped: boolean; continues: boolean },
): boolean {
	if (boundaries.continues && link.start === 0) return true;
	const trimmedEnd = text.replace(/\s+$/u, "").length;
	return boundaries.wrapped && link.end >= trimmedEnd;
}

/**
 * One row of a rendered terminal, as far as link scanning is concerned.
 *
 * A rendered row is padded to the terminal width, so a row that has no
 * trailing whitespace is a row whose last column was written: the terminal
 * wrapped there instead of ending the line.
 */
function rowFilled(text: string): boolean {
	return text.length > 0 && !/\s$/u.test(text);
}

/**
 * Whether a row starts mid-token because the row above was wrapped.
 *
 * A rendered row is padded to the terminal width, so a row with no trailing
 * whitespace wrote its last column and the terminal wrapped there. A
 * continuation starts with the very next character, never with whitespace.
 *
 * The one case this cannot separate is two paths printed on consecutive rows
 * that both fill the row: they read as one token. Joining is still the better
 * error — a wrapped path is common and a path that ends exactly on the last
 * column of a full row is not — and the joined target simply fails to open.
 */
export function continuesTerminalRow(texts: string[], index: number): boolean {
	if (index <= 0) return false;
	if (!rowFilled(texts[index - 1] ?? "")) return false;
	const text = texts[index] ?? "";
	return text.length > 0 && !/^\s/u.test(text);
}

/** One fragment of a link, addressed inside one rendered row. */
export interface TerminalAutoLinkPlacement {
	rowIndex: number;
	start: number;
	end: number;
	link: TerminalAutoLink;
}

/**
 * Find the links in a stack of rendered rows, stitching together the rows a
 * terminal wrap split in two.
 *
 * A path longer than the terminal is written across two rows, and neither
 * half is a link on its own — the first has no file name, the second no
 * directory. Reading the wrapped rows as one line recovers the real target,
 * and the returned placements carry the same `link` for every fragment so one
 * click opens it from either row.
 */
export function planTerminalAutoLinks(
	texts: string[],
): TerminalAutoLinkPlacement[] {
	const placements: TerminalAutoLinkPlacement[] = [];
	const groups: number[][] = [];
	let current: number[] = [];
	for (let index = 0; index < texts.length; index += 1) {
		if (index > 0 && !continuesTerminalRow(texts, index)) {
			groups.push(current);
			current = [];
		}
		current.push(index);
	}
	if (current.length > 0) groups.push(current);

	for (const group of groups) {
		const offsets: number[] = [];
		let joined = "";
		for (const rowIndex of group) {
			offsets.push(joined.length);
			joined += texts[rowIndex] ?? "";
		}
		const last = group.at(-1) ?? 0;
		// A token that reaches the end of a full final row may still continue
		// in a row the terminal has not painted yet, so it stays text until the
		// rest of it arrives.
		const openEnd = last === texts.length - 1 && rowFilled(texts[last] ?? "");
		const trimmedEnd = joined.replace(/\s+$/u, "").length;

		for (const link of scanTerminalAutoLinks(joined)) {
			if (openEnd && link.end >= trimmedEnd) continue;
			for (const [position, rowIndex] of group.entries()) {
				const from = offsets[position] ?? 0;
				const to = from + (texts[rowIndex] ?? "").length;
				const start = Math.max(link.start, from);
				const end = Math.min(link.end, to);
				if (end <= start) continue;
				placements.push({
					rowIndex,
					start: start - from,
					end: end - from,
					link,
				});
			}
		}
	}

	return placements;
}
