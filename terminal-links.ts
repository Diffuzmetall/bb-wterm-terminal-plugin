import type { TerminalAutoLink } from "./terminal-autolinks.js";

const FILE_LINK_ORIGIN = "https://wterm.invalid";
const FILE_LINK_PATH = "/__bb_wterm_file__";
const MAX_LINE_NUMBER = 1_000_000;

export type TerminalLinkAction =
	| { kind: "url"; url: string }
	| {
			kind: "file";
			path: string;
			/** False when the terminal only printed a workspace-relative path. */
			absolute: boolean;
			line: number | null;
			column: number | null;
	  };

function fileUriPath(uri: string): string | null {
	try {
		if (!/^file:\/\/\//iu.test(uri)) return null;
		const parsed = new URL(uri);
		if (parsed.protocol !== "file:" || parsed.host !== "") return null;
		const decodedPath = decodeURIComponent(parsed.pathname);
		if (
			!decodedPath.startsWith("/") ||
			/[\u0000-\u001f\u007f]/u.test(decodedPath)
		) {
			return null;
		}
		return decodedPath;
	} catch {
		return null;
	}
}

function fileLinkMarker(uri: string): string {
	const marker = new URL(FILE_LINK_PATH, FILE_LINK_ORIGIN);
	marker.searchParams.set("uri", uri);
	return marker.href;
}

function positiveInteger(value: string | null): number | null {
	if (value === null || !/^[0-9]{1,7}$/u.test(value)) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LINE_NUMBER
		? parsed
		: null;
}

function safeRelativePath(path: string): string | null {
	if (path.length === 0 || path.startsWith("/")) return null;
	if (/[\u0000-\u001f\u007f]/u.test(path)) return null;
	return path;
}

/** Convert a core-provided OSC 8 URI into a safe DOM href. */
export function terminalLinkHref(uri: string | undefined): string | undefined {
	if (!uri) return undefined;
	try {
		const parsed = new URL(uri);
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return parsed.href;
		}
	} catch {
		return undefined;
	}
	return fileUriPath(uri) === null ? undefined : fileLinkMarker(uri);
}

/**
 * DOM href for a link this renderer detected in plain output rather than
 * received as OSC 8. The host never sees a raw filesystem href: absolute paths
 * become a `file://` URI, relative ones travel as a query parameter.
 */
export function terminalAutoLinkHref(link: TerminalAutoLink): string {
	if (link.kind === "url") return link.url;
	const marker = new URL(FILE_LINK_PATH, FILE_LINK_ORIGIN);
	if (link.absolute) {
		marker.searchParams.set("uri", `file://${encodeURI(link.path)}`);
	} else {
		const path = safeRelativePath(link.path);
		if (path === null) return "";
		marker.searchParams.set("path", path);
	}
	if (link.line !== null) marker.searchParams.set("line", String(link.line));
	if (link.column !== null) {
		marker.searchParams.set("column", String(link.column));
	}
	return marker.href;
}

/** The href of a web URL, or null for anything that is not `http(s)`. */
export function safeWebHref(href: string): string | null {
	try {
		const parsed = new URL(href);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

/** Decode a rendered terminal anchor into an action owned by the BB host. */
export function terminalLinkAction(href: string): TerminalLinkAction | null {
	try {
		const parsed = new URL(href);
		if (
			parsed.origin === FILE_LINK_ORIGIN &&
			parsed.pathname === FILE_LINK_PATH
		) {
			const relative = parsed.searchParams.get("path");
			const uri = parsed.searchParams.get("uri");
			let path: string | null = null;
			if (relative !== null) path = safeRelativePath(relative);
			else if (uri !== null) path = fileUriPath(uri);
			if (path === null) return null;
			return {
				kind: "file",
				path,
				absolute: path.startsWith("/"),
				line: positiveInteger(parsed.searchParams.get("line")),
				column: positiveInteger(parsed.searchParams.get("column")),
			};
		}
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return { kind: "url", url: parsed.href };
		}
	} catch {
		return null;
	}
	return null;
}
