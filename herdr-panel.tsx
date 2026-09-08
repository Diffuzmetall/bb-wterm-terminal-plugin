import { useEffect, useState } from "react";
import { useRpc, type PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";
import { useLegacyTerminalAttachment } from "./terminal-attachment.js";
import { preloadTerminalPanel, TerminalWithUpload } from "./terminal-panel.js";
import type { PickerSession } from "./picker-state.js";
import {
	activeWtermTabId,
	createWtermTabPreference,
	nextWtermTabIdAfterClose,
	parseWtermTabPreference,
	reorderWtermTabs,
	restoreWtermTabs,
} from "./wterm-tabs.js";

const PLUGIN_ID = "wterm-terminal-preview";
const wtermTabPreferenceKey = (hostId: string) => `wterm:nav-tabs:v1:${hostId}`;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function closeHerdr(terminalId: string): void {
	void fetch(`/api/v1/plugins/${PLUGIN_ID}/rpc/closeHerdr`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ terminalId }),
		keepalive: true,
	}).catch(() => undefined);
}

function HerdrTerminalPanel() {
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
			closeHerdr(id);
		};
		const handlePageHide = () => {
			if (terminalId) closeTerminal(terminalId);
		};
		window.addEventListener("pagehide", handlePageHide);
		setState({ kind: "loading" });
		void rpc.call("openHerdr", {}).then(
			(session) => {
				terminalId = session.id;
				if (cancelled) closeTerminal(session.id);
				else setState({ kind: "ready", session });
			},
			(error: unknown) => {
				if (!cancelled) setState({ kind: "error", message: errorMessage(error) });
			},
		);
		return () => {
			cancelled = true;
			window.removeEventListener("pagehide", handlePageHide);
			if (terminalId) closeTerminal(terminalId);
		};
	}, [reload, rpc]);

	if (state.kind === "error") {
		return (
			<PanelError
				message={state.message}
				retry={() => setReload((value) => value + 1)}
			/>
		);
	}
	if (state.kind === "loading") return <PanelLoading />;
	return (
		<NavTerminal
			session={state.session}
			toolbarTargetId="wterm-herdr-toolbar-slot"
		/>
	);
}

export default function HerdrPanel(_props: PluginNavPanelProps) {
	return <HerdrTerminalPanel />;
}

export function WtermPanel(_props: PluginNavPanelProps) {
	const rpc = useRpc<typeof wtermRpcContract>();
	const [reload, setReload] = useState(0);
	const [state, setState] = useState<
		| { kind: "loading" }
		| { kind: "error"; message: string }
		| {
				kind: "ready";
				hostId: string;
				sessions: PickerSession[];
				activeId: string | null;
		  }
	>({ kind: "loading" });
	const [opening, setOpening] = useState(false);
	const [closingId, setClosingId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	useEffect(() => {
		void preloadTerminalPanel().catch(() => undefined);
	}, []);

	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		void rpc.call("listWtermTabs", {}).then(
			(workspace) => {
				if (cancelled) return;
				let preference = null;
				try {
					preference = parseWtermTabPreference(
						window.localStorage.getItem(wtermTabPreferenceKey(workspace.hostId)),
					);
				} catch {
					// Persistence is optional; the authoritative PTY registry is server-side.
				}
				const sessions = restoreWtermTabs(
					workspace.sessions,
					preference,
					workspace.hostId,
				);
				setState({
					kind: "ready",
					hostId: workspace.hostId,
					sessions,
					activeId: activeWtermTabId(sessions, preference, workspace.hostId),
				});
			},
			(error: unknown) => {
				if (!cancelled) setState({ kind: "error", message: errorMessage(error) });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [reload, rpc]);

	useEffect(() => {
		if (state.kind !== "ready" || !state.activeId) return;
		try {
			window.localStorage.setItem(
				wtermTabPreferenceKey(state.hostId),
				JSON.stringify(
					createWtermTabPreference(state.sessions, state.hostId, state.activeId),
				),
			);
		} catch {
			setActionError("Tab changes could not be saved; retry the action.");
		}
	}, [state]);

	if (state.kind === "error") {
		return (
			<PanelError
				message={state.message}
				retry={() => setReload((value) => value + 1)}
			/>
		);
	}
	if (state.kind === "loading") return <PanelLoading />;

	const active = state.sessions.find(({ id }) => id === state.activeId) ?? null;
	const select = (activeId: string) => {
		setActionError(null);
		setState((current) =>
			current.kind === "ready" ? { ...current, activeId } : current,
		);
	};
	const createTerminal = async () => {
		if (opening) return;
		setOpening(true);
		setActionError(null);
		try {
			const session = await rpc.call("openWterm", {
				requestId: window.crypto.randomUUID(),
			});
			setState((current) =>
				current.kind === "ready"
					? {
							...current,
							sessions: [...current.sessions, session],
							activeId: session.id,
						}
					: current,
			);
		} catch (error) {
			setActionError(errorMessage(error));
		} finally {
			setOpening(false);
		}
	};
	const dropTerminal = (movedId: string, targetId: string) => {
		setActionError(null);
		setState((current) =>
			current.kind === "ready"
				? {
						...current,
						sessions: [...reorderWtermTabs(current.sessions, movedId, targetId)],
					}
				: current,
		);
	};
	const closeTerminal = async (terminalId: string) => {
		if (closingId) return;
		setClosingId(terminalId);
		setActionError(null);
		try {
			await rpc.call("closeWterm", { terminalId });
			setState((current) => {
				if (current.kind !== "ready") return current;
				return {
					...current,
					activeId: nextWtermTabIdAfterClose(
						current.sessions,
						terminalId,
						current.activeId,
					),
					sessions: current.sessions.filter(({ id }) => id !== terminalId),
				};
			});
		} catch (error) {
			setActionError(errorMessage(error));
		} finally {
			setClosingId(null);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<div
				className="flex shrink-0 items-end gap-0 border-b bg-muted/30 px-2 pt-1"
				role="tablist"
				aria-label="Wterm terminals"
			>
				{state.sessions.map((session, index) => {
					const name = session.title || `Terminal ${index + 1}`;
					const selected = session.id === state.activeId;
					return (
						<div
							key={session.id}
							className={`flex min-w-0 items-center border transition-colors ${
								selected
									? "-mb-px border-border border-b-background bg-background"
									: "border-transparent border-r-border/60 text-muted-foreground hover:bg-muted/60"
							}`}
							draggable
							onDragStart={(event) => {
								event.dataTransfer.effectAllowed = "move";
								event.dataTransfer.setData("text/plain", session.id);
							}}
							onDragOver={(event) => event.preventDefault()}
							onDrop={(event) => {
								event.preventDefault();
								dropTerminal(event.dataTransfer.getData("text/plain"), session.id);
							}}
						>
							<button
								id={`wterm-tab-${session.id}`}
								type="button"
								role="tab"
								aria-controls="wterm-panel"
								aria-selected={session.id === state.activeId}
								className="max-w-48 truncate px-2.5 py-2 text-xs font-medium transition-colors aria-selected:text-foreground"
								onClick={() => select(session.id)}
							>
								{name}
							</button>
							<button
								type="button"
								aria-label={`Close ${name}`}
								title={`Close ${name}`}
								className="px-2 py-2 text-sm leading-none text-muted-foreground transition-colors hover:text-foreground"
								disabled={closingId !== null}
								onClick={() => void closeTerminal(session.id)}
							>
								×
							</button>
						</div>
					);
				})}
				<button
					type="button"
					aria-label="New terminal"
					title="New terminal"
					className="mb-1 ml-1 flex size-7 items-center justify-center border border-dashed text-sm text-muted-foreground transition-colors hover:border-solid hover:bg-muted hover:text-foreground"
					disabled={opening}
					onClick={() => {
						void preloadTerminalPanel().catch(() => undefined);
						void createTerminal();
					}}
				>
					{opening ? "…" : "+"}
				</button>
			</div>
			{actionError ? (
				<p role="alert" className="shrink-0 p-2 text-xs text-destructive">
					{actionError}
				</p>
			) : null}
			<div
				id="wterm-panel"
				role="tabpanel"
				aria-labelledby={active ? `wterm-tab-${active.id}` : undefined}
				className="min-h-0 flex-1"
			>
				{active && (active.status === "running" || active.status === "starting") ? (
					<NavTerminal session={active} toolbarTargetId="wterm-herdr-toolbar-slot" />
				) : (
					<div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
						{active ? `Terminal is ${active.status}.` : "No Wterm terminals."}
					</div>
				)}
			</div>
		</div>
	);
}

function PanelLoading() {
	return <div className="wterm-herdr-page wterm-renderer--loading" />;
}

function PanelError({
	message,
	retry,
}: {
	message: string;
	retry: () => void;
}) {
	return (
		<div className="space-y-2 p-4 text-sm">
			<p>{message}</p>
			<button
				type="button"
				className="rounded border px-2 py-1 text-xs"
				onClick={retry}
			>
				Retry
			</button>
		</div>
	);
}

function NavTerminal({
	session,
	toolbarTargetId,
}: {
	session: PickerSession;
	toolbarTargetId?: string;
}) {
	const attachment = useLegacyTerminalAttachment(session.id);
	return (
		<div className="wterm-herdr-page">
			<TerminalWithUpload
				threadId=""
				terminalId={session.id}
				attachment={attachment}
				session={session}
				toolbarTargetId={toolbarTargetId}
			/>
		</div>
	);
}
