import { useEffect, useState } from "react";
import { useRpc, type PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";
import { useLegacyTerminalAttachment } from "./terminal-attachment.js";
import { TerminalWithUpload } from "./terminal-panel.js";
import type { PickerSession } from "./picker-state.js";

const PLUGIN_ID = "wterm-terminal-preview";

type NavTerminalKind = "herdr" | "wterm";

function closeNavTerminal(kind: NavTerminalKind, terminalId: string): void {
	const method = kind === "herdr" ? "closeHerdr" : "closeWterm";
	void fetch(`/api/v1/plugins/${PLUGIN_ID}/rpc/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ terminalId }),
		keepalive: true,
	}).catch(() => undefined);
}

function NavTerminalPanel({ kind }: { kind: NavTerminalKind }) {
	const rpc = useRpc<typeof wtermRpcContract>();
	const [reload, setReload] = useState(0);
	const [state, setState] = useState<
		| { kind: "loading" }
		| { kind: "ready"; session: PickerSession }
		| { kind: "error"; message: string }
	>({ kind: "loading" });

	useEffect(() => {
		let cancelled = false;
		let closeRequested = false;
		let terminalId: string | null = null;
		const closeTerminal = (id: string) => {
			if (closeRequested) return;
			closeRequested = true;
			closeNavTerminal(kind, id);
		};
		const handlePageHide = () => {
			if (terminalId) closeTerminal(terminalId);
		};
		window.addEventListener("pagehide", handlePageHide);
		setState({ kind: "loading" });
		const sessionPromise =
			kind === "herdr" ? rpc.call("openHerdr", {}) : rpc.call("openWterm", {});
		void sessionPromise
			.then((session) => {
				terminalId = session.id;
				if (cancelled) {
					closeTerminal(session.id);
					return;
				}
				setState({ kind: "ready", session });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						kind: "error",
						message:
							error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
			window.removeEventListener("pagehide", handlePageHide);
			if (terminalId) closeTerminal(terminalId);
		};
	}, [kind, reload, rpc]);

	if (state.kind === "error") {
		return (
			<div className="space-y-2 p-4 text-sm">
				<p>{state.message}</p>
				<button
					type="button"
					className="rounded border px-2 py-1 text-xs"
					onClick={() => setReload((value) => value + 1)}
				>
					Retry
				</button>
			</div>
		);
	}
	if (state.kind === "loading") {
		return <div className="wterm-herdr-page wterm-renderer--loading" />;
	}
	return <NavTerminal session={state.session} />;
}

export default function HerdrPanel(_props: PluginNavPanelProps) {
	return <NavTerminalPanel kind="herdr" />;
}

export function WtermPanel(_props: PluginNavPanelProps) {
	return <NavTerminalPanel kind="wterm" />;
}

function NavTerminal({ session }: { session: PickerSession }) {
	const attachment = useLegacyTerminalAttachment(session.id);
	return (
		<div className="wterm-herdr-page">
			<TerminalWithUpload
				threadId=""
				terminalId={session.id}
				attachment={attachment}
				session={session}
			/>
		</div>
	);
}
