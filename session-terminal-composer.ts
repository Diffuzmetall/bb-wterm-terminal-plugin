import {
	reusableTerminalId,
	terminalIdAfterListFailure,
	type TerminalOpenCandidate,
} from "./terminal-open-policy.js";

export type TerminalParams = { schemaVersion: 1; terminalId: string };

export function hasTerminalParams(value: unknown): value is TerminalParams {
	return (
		typeof value === "object" &&
		value !== null &&
		"schemaVersion" in value &&
		(value as { schemaVersion?: unknown }).schemaVersion === 1 &&
		"terminalId" in value &&
		typeof (value as { terminalId?: unknown }).terminalId === "string" &&
		(value as { terminalId: string }).terminalId.length > 0
	);
}

export function initialPanelParams(hostParams: unknown): TerminalParams | null {
	return hasTerminalParams(hostParams) ? hostParams : null;
}

const LAST_TERMINAL_STORAGE_PREFIX = "bb.wterm-terminal-preview";

export function terminalStorageKey(threadId: string): string {
	return `${LAST_TERMINAL_STORAGE_PREFIX}.${threadId}`;
}

export function readLastTerminalId(threadId: string): string | null {
	try {
		const saved = window.localStorage.getItem(terminalStorageKey(threadId));
		if (!saved) return null;
		const parsed: unknown = JSON.parse(saved);
		return hasTerminalParams(parsed) ? parsed.terminalId : null;
	} catch {
		return null;
	}
}

export function writeLastTerminalId(threadId: string, terminalId: string): void {
	try {
		window.localStorage.setItem(
			terminalStorageKey(threadId),
			JSON.stringify({ schemaVersion: 1, terminalId }),
		);
	} catch {
		// The current tab still works when storage is unavailable.
	}
}

export function revealSessionTerminalPanel({
	actionId,
	openThreadPanel,
	terminalId,
	title,
}: {
	actionId: string;
	openThreadPanel: (options: {
		actionId: string;
		experimental_primarySurface: true;
		params?: { schemaVersion: 1; terminalId: string };
		title: string;
	}) => boolean;
	terminalId?: string;
	title: string;
}): void {
	const opened = openThreadPanel({
		actionId,
		title,
		...(terminalId === undefined
			? {}
			: { params: { schemaVersion: 1, terminalId } }),
		experimental_primarySurface: true,
	});
	if (!opened) {
		throw new Error("This BB view could not switch to the session terminal.");
	}
}

export async function resolveSessionTerminalId({
	createTerminalId,
	lastTerminalId,
	listCandidates,
	openTabCount,
}: {
	createTerminalId: () => Promise<string>;
	lastTerminalId: string | null;
	listCandidates: () => Promise<readonly TerminalOpenCandidate[]>;
	openTabCount: number;
}): Promise<string> {
	if (lastTerminalId !== null) {
		try {
			const reusable = reusableTerminalId({
				lastTerminalId,
				openTabCount,
				sessions: await listCandidates(),
			});
			if (reusable !== null) return reusable;
		} catch {
			const fallback = terminalIdAfterListFailure({
				lastTerminalId,
				openTabCount,
			});
			if (fallback !== null) return fallback;
		}
	}
	return createTerminalId();
}
