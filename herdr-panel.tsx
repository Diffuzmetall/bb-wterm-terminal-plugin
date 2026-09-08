import { useEffect, useRef, useState } from "react";
import { useRpc, type PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";
import { useLegacyTerminalAttachment } from "./terminal-attachment.js";
import { preloadTerminalPanel, TerminalWithUpload } from "./terminal-panel.js";
import type { PickerSession } from "./picker-state.js";
import {
	activeWtermTabId,
	createWtermTabPreference,
	MAX_WTERM_TAB_NAME_LENGTH,
	nextWtermTabIdAfterClose,
	normalizeWtermTabName,
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
	return <NavTerminal session={state.session} />;
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
	const [confirmingCloseId, setConfirmingCloseId] = useState<string | null>(
		null,
	);
	const [menuId, setMenuId] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftName, setDraftName] = useState("");
	const [actionError, setActionError] = useState<string | null>(null);
	const tabRefs = useRef(new Map<string, HTMLButtonElement>());
	const focusAfterEditId = useRef<string | null>(null);

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

	useEffect(() => {
		if (editingId !== null || !focusAfterEditId.current) return;
		tabRefs.current.get(focusAfterEditId.current)?.focus();
		focusAfterEditId.current = null;
	}, [editingId]);

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
	const renameTerminal = (terminalId: string) => {
		const name = normalizeWtermTabName(draftName);
		if (!name) {
			setActionError(
				`Terminal names must be 1–${MAX_WTERM_TAB_NAME_LENGTH} characters.`,
			);
			return;
		}
		setActionError(null);
		setState((current) =>
			current.kind === "ready"
				? {
						...current,
						sessions: current.sessions.map((session) =>
							session.id === terminalId ? { ...session, title: name } : session,
						),
					}
				: current,
		);
		focusAfterEditId.current = terminalId;
		setEditingId(null);
	};
	const moveTerminal = (terminalId: string, offset: -1 | 1) => {
		setActionError(null);
		setState((current) => {
			if (current.kind !== "ready") return current;
			const index = current.sessions.findIndex(({ id }) => id === terminalId);
			const target = current.sessions[index + offset];
			return target
				? {
						...current,
						sessions: [...reorderWtermTabs(current.sessions, terminalId, target.id)],
					}
				: current;
		});
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
			setConfirmingCloseId(null);
			setMenuId(null);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-background text-foreground">
			<div
				className="flex shrink-0 items-center gap-1 border-b p-1"
				role="tablist"
				aria-label="Wterm terminals"
			>
				{state.sessions.map((session, index) => {
					const name = session.title || `Terminal ${index + 1}`;
					return (
						<div
							key={session.id}
							className="flex min-w-0 items-center rounded border"
							draggable={editingId !== session.id}
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
							{editingId === session.id ? (
								<input
									id={`wterm-tab-${session.id}`}
									autoFocus
									aria-label={`Rename ${name}`}
									className="w-32 bg-background px-2 py-1 text-xs"
									maxLength={MAX_WTERM_TAB_NAME_LENGTH}
									value={draftName}
									onChange={(event) => setDraftName(event.currentTarget.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter") renameTerminal(session.id);
										if (event.key === "Escape") {
											focusAfterEditId.current = session.id;
											setEditingId(null);
											setActionError(null);
										}
									}}
								/>
							) : (
								<button
									ref={(element) => {
										if (element) tabRefs.current.set(session.id, element);
										else tabRefs.current.delete(session.id);
									}}
									id={`wterm-tab-${session.id}`}
									type="button"
									role="tab"
									aria-controls="wterm-panel"
									aria-selected={session.id === state.activeId}
									className="max-w-48 truncate px-2 py-1 text-xs aria-selected:bg-muted"
									onClick={() => select(session.id)}
								>
									{name}
								</button>
							)}
							<div className="relative">
								<button
									type="button"
									aria-label={`${name} options`}
									aria-haspopup="menu"
									aria-expanded={menuId === session.id}
									className="px-2 py-1 text-xs"
									onClick={() =>
										setMenuId((current) => (current === session.id ? null : session.id))
									}
								>
									⋮
								</button>
								{menuId === session.id ? (
									<div
										role="menu"
										className="absolute left-0 z-10 flex min-w-28 flex-col rounded border bg-background p-1 shadow"
									>
										<button
											type="button"
											role="menuitem"
											className="px-2 py-1 text-left text-xs"
											onClick={() => {
												setActionError(null);
												setDraftName(name);
												setEditingId(session.id);
												setMenuId(null);
											}}
										>
											Rename
										</button>
										<button
											type="button"
											role="menuitem"
											className="px-2 py-1 text-left text-xs"
											disabled={index === 0}
											onClick={() => moveTerminal(session.id, -1)}
										>
											Move left
										</button>
										<button
											type="button"
											role="menuitem"
											className="px-2 py-1 text-left text-xs"
											disabled={index === state.sessions.length - 1}
											onClick={() => moveTerminal(session.id, 1)}
										>
											Move right
										</button>
										{confirmingCloseId === session.id ? (
											<>
												<button
													type="button"
													role="menuitem"
													className="px-2 py-1 text-left text-xs text-destructive"
													disabled={closingId !== null}
													onClick={() => void closeTerminal(session.id)}
												>
													Confirm close
												</button>
												<button
													type="button"
													role="menuitem"
													className="px-2 py-1 text-left text-xs"
													onClick={() => setConfirmingCloseId(null)}
												>
													Cancel
												</button>
											</>
										) : (
											<button
												type="button"
												role="menuitem"
												className="px-2 py-1 text-left text-xs text-destructive"
												disabled={closingId !== null}
												onClick={() => setConfirmingCloseId(session.id)}
											>
												Close
											</button>
										)}
									</div>
								) : null}
							</div>
						</div>
					);
				})}
				<button
					type="button"
					className="rounded border px-2 py-1 text-xs"
					disabled={opening}
					onClick={() => {
						void preloadTerminalPanel().catch(() => undefined);
						void createTerminal();
					}}
				>
					{opening ? "Opening…" : "New terminal"}
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
					<NavTerminal session={active} />
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
