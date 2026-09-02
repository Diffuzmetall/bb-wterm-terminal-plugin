import { lazy, useEffect, useRef, useState } from "react";
import {
	definePluginApp,
	useBbContext,
	useBbNavigate,
	useRpc,
} from "@bb/plugin-sdk/app";
import * as BbApp from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";
import {
	evaluateTerminalPresence,
	type TerminalOpenCandidate,
} from "./terminal-open-policy.js";
import { trackWtermMount } from "./wterm-open-count.js";
import { SessionTerminalComposerAction } from "./session-terminal-action.js";
import {
	resolveSessionTerminalId,
	revealSessionTerminalPanel,
} from "./session-terminal-composer.js";
import { toast } from "sonner";
import "./app.css";

const PLUGIN_ID = "wterm-terminal-preview";
const PANEL_ACTION_ID = "terminal";
const PANEL_TITLE = "Wterm terminal";
const LAST_TERMINAL_STORAGE_PREFIX = "bb.wterm-terminal-preview";

const loadTerminalPanel = () => import("./terminal-panel.js");
const TerminalPanel = lazy(loadTerminalPanel);
type Session = {
	id: string;
	title: string;
	initialCwd: string | null;
	status: string;
	updatedAt: number;
	lastUserInputAt: number | null;
};
const isActive = (item: Session) => {
	const status = item.status.toLowerCase();
	return status === "running" || status === "starting";
};

function terminalStorageKey(threadId: string): string {
	return `${LAST_TERMINAL_STORAGE_PREFIX}.${threadId}`;
}

function readLastTerminalId(threadId: string): string | null {
	try {
		const saved = window.localStorage.getItem(terminalStorageKey(threadId));
		if (!saved) return null;
		const parsed: unknown = JSON.parse(saved);
		return hasTerminalParams(parsed) ? parsed.terminalId : null;
	} catch {
		return null;
	}
}

function writeLastTerminalId(threadId: string, terminalId: string): void {
	try {
		window.localStorage.setItem(
			terminalStorageKey(threadId),
			JSON.stringify({ schemaVersion: 1, terminalId }),
		);
	} catch {
		// Reopening still works for the current tab when storage is unavailable.
	}
}

function terminalCandidates(value: unknown): TerminalOpenCandidate[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (
			typeof item !== "object" ||
			item === null ||
			!("id" in item) ||
			typeof item.id !== "string" ||
			!("status" in item) ||
			typeof item.status !== "string"
		) {
			return [];
		}
		return [{ id: item.id, status: item.status }];
	});
}

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
	const [items, setItems] = useState<Session[]>([]);
	const [creating, setCreating] = useState(false);
	const request = useRef({ generation: 0, mounted: false });
	const isCurrent = (generation: number) =>
		request.current.mounted && request.current.generation === generation;
	useEffect(() => {
		request.current.mounted = true;
		const generation = request.current.generation;
		rpc
			.call("listSessions", { threadId })
			.then(
				(next) => {
					if (isCurrent(generation)) setItems(next);
				},
				() => {
					if (isCurrent(generation)) setItems([]);
				},
			)
			.catch(() => {});
		return () => {
			request.current.mounted = false;
			request.current.generation += 1;
		};
	}, [rpc, threadId]);
	const select = (id: string) => replace({ schemaVersion: 1, terminalId: id });
	const restart = (id: string) => {
		const generation = request.current.generation;
		return rpc
			.call("restartTerminal", { threadId, terminalId: id })
			.then(
				(updated) => {
					if (!isCurrent(generation)) return;
					setItems((current) =>
						current.map((item) => (item.id === id ? updated : item)),
					);
					select(updated.id);
				},
				() => {},
			)
			.catch(() => {});
	};
	const running = items.filter(isActive);
	const exited = items.filter((item) => !isActive(item));
	const renderItem = (item: Session) => (
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
							() => {},
						)
						.finally(() => {
							if (isCurrent(generation)) setCreating(false);
						})
						.catch(() => {});
				}}
				className="rounded border px-3 py-2 text-sm"
			>
				{creating ? "Creating…" : "New terminal"}
			</button>
			<section>
				<h3 className="text-xs font-medium uppercase">Running</h3>
				{running.map(renderItem)}
			</section>
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
		</div>
	);
}

type TerminalParams = { schemaVersion: 1; terminalId: string };

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
				.catch(() => {});
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
	const storageKey = terminalStorageKey(threadId);
	const [fallbackParams, setFallbackParams] = useState<unknown>(() => {
		try {
			const saved = window.localStorage.getItem(storageKey);
			if (saved) {
				const parsed: unknown = JSON.parse(saved);
				if (hasTerminalParams(parsed)) return parsed;
			}
		} catch {}
		return null;
	});
	const currentParams = hasTerminalParams(params) ? params : fallbackParams;
	const replace = (nextParams: unknown) => {
		setFallbackParams(nextParams);
		try {
			window.localStorage.setItem(storageKey, JSON.stringify(nextParams));
		} catch {}
	};
	return <Panel threadId={threadId} params={currentParams} replace={replace} />;
}

function hasTerminalParams(value: unknown): value is TerminalParams {
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

async function openSessionTerminal(
	threadId: string,
	openPanel: (terminalId: string) => void,
): Promise<void> {
	void loadTerminalPanel()
		.then(({ preloadTerminalPanel }) => preloadTerminalPanel())
		.catch(() => {});
	const terminalId = await resolveSessionTerminalId({
		createTerminalId: async () =>
			createdTerminalId(await callBackendRpc("createTerminal", { threadId })),
		lastTerminalId: readLastTerminalId(threadId),
		listCandidates: async () =>
			terminalCandidates(await callBackendRpc("listSessions", { threadId })),
	});
	writeLastTerminalId(threadId, terminalId);
	openPanel(terminalId);
}

function OpenSessionTerminalAction() {
	const navigate = useBbNavigate();
	return (
		<SessionTerminalComposerAction
			onOpen={async (threadId) => {
				try {
					void loadTerminalPanel()
						.then(({ preloadTerminalPanel }) => preloadTerminalPanel())
						.catch(() => {});
					const lastTerminalId = readLastTerminalId(threadId);
					revealSessionTerminalPanel({
						actionId: PANEL_ACTION_ID,
						openThreadPanel: navigate.openThreadPanel,
						...(lastTerminalId === null ? {} : { terminalId: lastTerminalId }),
						title: PANEL_TITLE,
					});
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
			void loadTerminalPanel()
				.then(({ preloadTerminalPanel }) => preloadTerminalPanel())
				.catch(() => {});
			const terminalId = createdTerminalId(
				await callBackendRpc("createTerminal", { threadId }),
			);
			writeLastTerminalId(threadId, terminalId);
			openPanel({
				title: PANEL_TITLE,
				params: { schemaVersion: 1, terminalId },
				experimental_claimedTerminalId: terminalId,
			});
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
