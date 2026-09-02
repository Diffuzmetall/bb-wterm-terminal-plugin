import { useState } from "react";
import { useComposerView } from "@bb/plugin-sdk/app";

export function SessionTerminalComposerAction({
	onOpen,
}: {
	onOpen: (threadId: string) => Promise<void>;
}) {
	const view = useComposerView();
	const [busy, setBusy] = useState(false);
	if (view.scope.kind !== "thread") return null;
	const threadId = view.scope.threadId;

	return (
		<button
			type="button"
			className="wterm-session-terminal-action"
			aria-label="Show session terminal"
			title="Show session terminal"
			disabled={busy}
			onClick={() => {
				void (async () => {
					setBusy(true);
					try {
						await onOpen(threadId);
					} finally {
						setBusy(false);
					}
				})();
			}}
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<rect x="3" y="4" width="18" height="16" rx="2" />
				<path d="m7 9 3 3-3 3" />
				<path d="M13 15h4" />
			</svg>
		</button>
	);
}
