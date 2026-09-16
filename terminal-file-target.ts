import type { ExperimentalFileLocation, ExperimentalLiveFileTarget } from "@bb/plugin-sdk/app";
import type { TerminalLinkAction } from "./terminal-links.js";

/** What the terminal knows about the thread it belongs to. */
export interface TerminalFileSource {
	environmentId: string;
	rootPath: string;
	hostId: string;
}

export interface TerminalFileOpen {
	target: ExperimentalLiveFileTarget;
	location: ExperimentalFileLocation | null;
}

function normalizeAbsolute(path: string): string {
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return `/${parts.join("/")}`;
}

/** The workspace-relative path when `path` lives inside `rootPath`, else null. */
export function workspaceRelativePath(
	rootPath: string,
	path: string,
): string | null {
	const root = normalizeAbsolute(rootPath);
	const absolute = normalizeAbsolute(path);
	if (absolute === root) return null;
	const prefix = root.endsWith("/") ? root : `${root}/`;
	if (!absolute.startsWith(prefix)) return null;
	const relative = absolute.slice(prefix.length);
	return relative.length === 0 ? null : relative;
}

/**
 * Choose the file target for one terminal link.
 *
 * A path that lives in the thread's workspace travels as a workspace target —
 * the same identity rendered Markdown uses, which is what lets the host apply
 * file-opener preferences. Everything else falls back to the host path.
 */
export function terminalFileOpen({
	action,
	source,
	initialCwd,
	hostId,
}: {
	action: Extract<TerminalLinkAction, { kind: "file" }>;
	source: TerminalFileSource | null;
	initialCwd: string | null;
	hostId: string | null;
}): TerminalFileOpen | null {
	const location: ExperimentalFileLocation | null =
		action.line === null
			? null
			: { kind: "line", line: action.line, column: action.column };
	if (source === null) {
		// A relative path means nothing without a workspace to resolve it in.
		if (!action.absolute) return null;
		const hostOnly = hostId ?? null;
		return hostOnly === null
			? null
			: {
					target: { kind: "host", hostId: hostOnly, path: action.path },
					location,
				};
	}
	const absolutePath = action.absolute
		? action.path
		: // A relative path is relative to the directory the program runs in,
			// which is the directory the terminal was opened in.
			`${initialCwd ?? source.rootPath}/${action.path}`;
	const relative = workspaceRelativePath(source.rootPath, absolutePath);
	if (relative !== null) {
		return {
			target: {
				kind: "workspace",
				environmentId: source.environmentId,
				path: relative,
			},
			location,
		};
	}
	const fallbackHostId = hostId ?? source.hostId;
	return {
		target: { kind: "host", hostId: fallbackHostId, path: absolutePath },
		location,
	};
}
