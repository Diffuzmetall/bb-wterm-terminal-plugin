const FILE_LINK_ORIGIN = "https://wterm.invalid";
const FILE_LINK_PATH = "/__bb_wterm_file__";

export type TerminalLinkAction =
	| { kind: "url"; url: string }
	| { kind: "file"; path: string };

function fileUriPath(uri: string): string | null {
	try {
		if (!/^file:\/\/\//iu.test(uri)) return null;
		const parsed = new URL(uri);
		if (parsed.protocol !== "file:" || parsed.host !== "") return null;
		const decodedPath = decodeURIComponent(parsed.pathname);
		if (!decodedPath.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(decodedPath)) {
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

/** Decode a rendered terminal anchor into an action owned by the BB host. */
export function terminalLinkAction(href: string): TerminalLinkAction | null {
	try {
		const parsed = new URL(href);
		if (parsed.origin === FILE_LINK_ORIGIN && parsed.pathname === FILE_LINK_PATH) {
			const uri = parsed.searchParams.get("uri");
			const path = uri === null ? null : fileUriPath(uri);
			return path === null ? null : { kind: "file", path };
		}
		if (parsed.protocol === "http:" || parsed.protocol === "https:") {
			return { kind: "url", url: parsed.href };
		}
	} catch {
		return null;
	}
	return null;
}
