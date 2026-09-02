import {
	reusableTerminalId,
	terminalIdAfterListFailure,
	type TerminalOpenCandidate,
} from "./terminal-open-policy.js";

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
}: {
	createTerminalId: () => Promise<string>;
	lastTerminalId: string | null;
	listCandidates: () => Promise<readonly TerminalOpenCandidate[]>;
}): Promise<string> {
	if (lastTerminalId !== null) {
		try {
			const reusable = reusableTerminalId({
				lastTerminalId,
				openTabCount: 0,
				sessions: await listCandidates(),
			});
			if (reusable !== null) return reusable;
		} catch {
			const fallback = terminalIdAfterListFailure({
				lastTerminalId,
				openTabCount: 0,
			});
			if (fallback !== null) return fallback;
		}
	}
	return createTerminalId();
}
