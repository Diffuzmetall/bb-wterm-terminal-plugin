import { lazy, useEffect, useRef, useState } from "react";
import {
	definePluginApp,
	useBbContext,
	useBbNavigate,
	useRpc,
} from "@bb/plugin-sdk/app";
import * as BbApp from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";
import { evaluateTerminalPresence } from "./terminal-open-policy.js";
import {
	beginWtermOpen,
	trackWtermMount,
	wtermOpenCount,
} from "./wterm-open-count.js";
import { SessionTerminalComposerAction } from "./session-terminal-action.js";
import {
	hasTerminalParams,
	initialPanelParams,
	revealSessionTerminalPanel,
	writeLastTerminalId,
	type TerminalParams,
} from "./session-terminal-composer.js";
import {
	partitionRunningExited,
	pickerStateFromRpc,
	type PickerListState,
	type PickerSession,
} from "./picker-state.js";
import { toast } from "sonner";
import "./app.css";

const PLUGIN_ID = "wterm-terminal-preview";
const PANEL_ACTION_ID = "terminal";
const PANEL_TITLE = "Wterm terminal";

const loadTerminalPanel = () => import("./terminal-panel.js");
const TerminalPanel = lazy(loadTerminalPanel);

function useTrackOpenWtermTab(threadId: string, params: unknown): void {
	const terminalId = hasTerminalParams(params) ? params.terminalId : null;
	useEffect(() => trackWtermMount(threadId), [threadId]);
	useEffect(() => {
		if (terminalId) writeLastTerminalId(threadId, terminalId);
	}, [terminalId, threadId]);
}

async function callBackendRpc(
	method: string,
	input: unknown,
): Promise<unknown> {
	const response = await fetch(
		`/api/v1/plugins/${PLUGIN_ID}/rpc/${encodeURIComponent(method)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input ?? null),
		},
	);
	const body = (await response.json().catch(() => null)) as {
		ok?: unknown;
		result?: unknown;
		error?: unknown;
	} | null;
	if (!response.ok || body?.ok !== true) {
		const structuredMessage =
			typeof body?.error === "object" &&
			body.error !== null &&
			typeof (body.error as { message?: unknown }).message === "string"
				? String((body.error as { message: string }).message)
				: null;
		throw new Error(
			structuredMessage ?? `rpc "${method}" failed (HTTP ${response.status})`,
		);
	}
	return body.result;
}

function createdTerminalId(result: unknown): string {
	if (
		typeof result === "object" &&
		result !== null &&
		"id" in result &&
		typeof result.id === "string" &&
		result.id.length > 0
	) {
		return result.id;
	}
	throw new Error("Plugin returned an unexpected createTerminal response.");
}

function Picker({
	threadId,
	replace,
	notice,
}: {
	threadId: string;
	replace: (params: unknown) => void;
	notice?: string;
}) {
	const rpc = useRpc<typeof wtermRpcContract>();
	const [list, setList] = useState<PickerListState>({ kind: "loading" });
	const [creating, setCreating] = useState(false);
	const [reload, setReload] = useState(0);
	const request = useRef({ generation: 0, mounted: false });
	const isCurrent = (generation: number) =>
		request.current.mounted && request.current.generation === generation;
	useEffect(() => {
		request.current.mounted = true;
		const generation = request.current.generation;
		setList({ kind: "loading" });
		rpc
			.call("listSessions", { threadId })
			.then(
				(next) => {
					if (isCurrent(generation))
						setList(pickerStateFromRpc({ status: "fulfilled", value: next }));
				},
				(error) => {
					if (isCurrent(generation))
						setList(pickerStateFromRpc({ status: "rejected", reason: error }));
				},
			);
		return () => {
			request.current.mounted = false;
			request.current.generation += 1;
		};
	}, [reload, rpc, threadId]);
	const select = (id: string) => replace({ schemaVersion: 1, terminalId: id });
	const restart = (id: string) => {
		const generation = request.current.generation;
		return rpc
			.call("restartTerminal", { threadId, terminalId: id })
			.then(
				(updated) => {
					if (!isCurrent(generation) || list.kind !== "loaded") return;
					setList({
						kind: "loaded",
						items: list.items.map((item) =>
							item.id === id ? (updated as PickerSession) : item,
						),
					});
					select(updated.id);
				},
				() => undefined,
			);
	};
	const { running, exited } =
		list.kind === "loaded"
			? partitionRunningExited(list.items)
			: { running: [], exited: [] };
	const renderItem = (item: PickerSession) => (
		<div key={item.id} className="rounded border p-3">
			<button
				type="button"
				onClick={() => select(item.id)}
				className="w-full text-left"
			>
				<div>{item.title}</div>
				<div className="text-xs text-muted-foreground">
					{item.initialCwd ?? "~"} · status: {item.status} · updated{" "}
					{new Date(item.updatedAt).toLocaleString()}
				</div>
			</button>
			<div className="mt-1 text-xs text-muted-foreground">
				Last input:{" "}
				{item.lastUserInputAt
					? new Date(item.lastUserInputAt).toLocaleString()
					: "never"}
			</div>
		</div>
	);
	return (
		<div className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-4">
			<h2 className="text-sm font-medium">Wterm terminal</h2>
			{notice ? <p role="alert">{notice}</p> : null}
			<button
				type="button"
				disabled={creating}
				onClick={() => {
					const generation = request.current.generation;
					setCreating(true);
					rpc
						.call("createTerminal", { threadId })
						.then(
							(item) => {
								if (isCurrent(generation)) select(item.id);
							},
							() => undefined,
						)
						.finally(() => {
							if (isCurrent(generation)) setCreating(false);
						});
				}}
				className="rounded border px-3 py-2 text-sm"
			>
				{creating ? "Creating…" : "New terminal"}
			</button>
			{list.kind === "loading" ? (
				<div
					className="wterm-picker-skeleton"
					aria-busy="true"
					aria-label="Loading terminals"
				/>
			) : null}
			{list.kind === "failed" ? (
				<div className="flex flex-col items-start gap-2">
					<p role="alert">{list.message}</p>
					<button
						type="button"
						className="rounded border px-3 py-2 text-sm"
						onClick={() => setReload((current) => current + 1)}
					>
						Retry
					</button>
				</div>
			) : null}
			{list.kind === "loaded" ? (
				<>
					<section>
						<h3 className="text-xs font-medium uppercase">Running</h3>
						{running.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								No running terminals.
							</p>
						) : (
							running.map(renderItem)
						)}
					</section>
					{exited.length > 0 ? (
						<section>
							<h3 className="text-xs font-medium uppercase">Exited</h3>
							{exited.map((item) => (
								<div key={item.id} className="rounded border p-3 opacity-80">
									<div>{item.title}</div>
									<div className="text-xs text-muted-foreground">
										{item.initialCwd ?? "~"} · status: {item.status} · updated{" "}
										{new Date(item.updatedAt).toLocaleString()}
									</div>
									<div className="text-xs text-muted-foreground">
										Last input:{" "}
										{item.lastUserInputAt
											? new Date(item.lastUserInputAt).toLocaleString()
											: "never"}{" "}
										· Read-only
									</div>
									<button
										type="button"
										onClick={() => restart(item.id)}
										className="mt-2 rounded border px-2 py-1 text-xs"
									>
										Restart
									</button>
								</div>
							))}
						</section>
					) : null}
				</>
			) : null}
		</div>
	);
}

function SelectedTerminal({
	threadId,
	params,
	replace,
}: {
	threadId: string;
	params: TerminalParams;
	replace: (params: unknown) => void;
}) {
	const rpc = useRpc<typeof wtermRpcContract>();
	const rpcRef = useRef(rpc);
	const [retry, setRetry] = useState(0);
	const [state, setState] = useState<"ready" | "missing" | "error">("ready");
	rpcRef.current = rpc;

	useEffect(() => {
		let cancelled = false;
		let attempt = 0;
		let retryTimer = 0;
		const verify = () => {
			attempt += 1;
			rpcRef.current
				.call("listSessions", { threadId })
				.then(
					(items) => {
						if (cancelled) return;
						const presence = evaluateTerminalPresence({
							attempt,
							sessions: items,
							terminalId: params.terminalId,
						});
						if (presence === "retry") {
							retryTimer = window.setTimeout(verify, 400);
							return;
						}
						setState(presence);
					},
					() => {
						if (cancelled) return;
						const presence = evaluateTerminalPresence({
							attempt,
							sessions: null,
							terminalId: params.terminalId,
						});
						if (presence === "retry") {
							retryTimer = window.setTimeout(verify, 400);
							return;
						}
						setState(presence === "missing" ? "error" : presence);
					},
				)
				.catch(() => undefined);
		};
		verify();
		return () => {
			cancelled = true;
			window.clearTimeout(retryTimer);
		};
	}, [params.terminalId, retry, threadId]);

	if (state === "missing")
		return (
			<Picker
				threadId={threadId}
				replace={replace}
				notice="Terminal session is no longer available."
			/>
		);
	if (state === "error")
		return (
			<div className="flex h-full flex-col items-start gap-3 p-4">
				<p role="alert">Could not verify the terminal session.</p>
				<button
					type="button"
					className="rounded border px-3 py-2 text-sm"
					onClick={() => setRetry((current) => current + 1)}
				>
					Retry
				</button>
			</div>
		);
	return <TerminalPanel threadId={threadId} params={params} />;
}

function Panel({
	threadId,
	params,
	replace,
}: {
	threadId: string;
	params: unknown;
	replace: (params: unknown) => void;
}) {
	if (hasTerminalParams(params))
		return (
			<SelectedTerminal threadId={threadId} params={params} replace={replace} />
		);
	return <Picker key={threadId} threadId={threadId} replace={replace} />;
}

type ReplaceCurrentPluginTabHook = () => (input: {
	actionId: string;
	title: string;
	params: never;
	experimental_claimedTerminalId?: string | null;
}) => void;

function HostTerminalAction({
	threadId,
	params,
	useReplaceCurrent,
}: {
	threadId: string;
	params: unknown;
	useReplaceCurrent: ReplaceCurrentPluginTabHook;
}) {
	const replaceCurrent = useReplaceCurrent();
	return (
		<Panel
			threadId={threadId}
			params={params}
			replace={(nextParams) =>
				replaceCurrent({
					actionId: "terminal",
					title: "Wterm terminal",
					params: nextParams as never,
					experimental_claimedTerminalId: hasTerminalParams(nextParams)
						? nextParams.terminalId
						: null,
				})
			}
		/>
	);
}

function LegacyTerminalAction({
	threadId,
	params,
}: {
	threadId: string;
	params: unknown;
}) {
	const [selectedParams, setSelectedParams] = useState<unknown>(null);
	const currentParams = initialPanelParams(params) ?? selectedParams;
	const replace = (nextParams: unknown) => {
		setSelectedParams(nextParams);
		if (hasTerminalParams(nextParams)) {
			writeLastTerminalId(threadId, nextParams.terminalId);
		}
	};
	return <Panel threadId={threadId} params={currentParams} replace={replace} />;
}

function OpenSessionTerminalAction() {
	const navigate = useBbNavigate();
	return (
		<SessionTerminalComposerAction
			onOpen={async (threadId) => {
				try {
					void loadTerminalPanel()
						.then(({ preloadTerminalPanel }) => preloadTerminalPanel())
						.catch(() => undefined);
					if (wtermOpenCount(threadId) > 0) {
						revealSessionTerminalPanel({
							actionId: PANEL_ACTION_ID,
							openThreadPanel: navigate.openThreadPanel,
							title: PANEL_TITLE,
						});
						return;
					}
					const release = beginWtermOpen(threadId);
					try {
						const terminalId = createdTerminalId(
							await callBackendRpc("createTerminal", { threadId }),
						);
						writeLastTerminalId(threadId, terminalId);
						revealSessionTerminalPanel({
							actionId: PANEL_ACTION_ID,
							openThreadPanel: navigate.openThreadPanel,
							terminalId,
							title: PANEL_TITLE,
						});
					} catch (error) {
						release();
						throw error;
					}
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					console.warn(
						`[plugin:${PLUGIN_ID}] failed to open session terminal: ${message}`,
					);
					toast.error(message);
				}
			}}
		/>
	);
}

export default definePluginApp((app) => {
	app.composer.customize({
		id: "session-terminal",
		scopes: ["thread"],
		actions: [{ id: "open-session-terminal", component: OpenSessionTerminalAction }],
	});
	app.slots.threadPanelAction({
		id: PANEL_ACTION_ID,
		title: PANEL_TITLE,
		icon: "Terminal",
		layout: "flush",
		async run({ threadId, openPanel }) {
			const release = beginWtermOpen(threadId);
			try {
				void loadTerminalPanel()
					.then(({ preloadTerminalPanel }) => preloadTerminalPanel())
					.catch(() => undefined);
				const terminalId = createdTerminalId(
					await callBackendRpc("createTerminal", { threadId }),
				);
				writeLastTerminalId(threadId, terminalId);
				openPanel({
					title: PANEL_TITLE,
					params: { schemaVersion: 1, terminalId },
					experimental_claimedTerminalId: terminalId,
				});
			} catch (error) {
				release();
				throw error;
			}
		},
		component: function TerminalAction({ threadId, params }) {
			const { threadId: contextThreadId } = useBbContext();
			const currentThreadId = threadId || contextThreadId || "";
			useTrackOpenWtermTab(currentThreadId, params);
			const useReplaceCurrent = Reflect.get(
				BbApp,
				"experimental_useReplaceCurrentPluginTab",
			) as ReplaceCurrentPluginTabHook | undefined;
			return useReplaceCurrent ? (
				<HostTerminalAction
					threadId={currentThreadId}
					params={params}
					useReplaceCurrent={useReplaceCurrent}
				/>
			) : (
				<LegacyTerminalAction threadId={currentThreadId} params={params} />
			);
		},
	});
});
