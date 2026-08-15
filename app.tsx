import { lazy, useEffect, useRef, useState } from "react";
import { definePluginApp, useBbContext, useRpc } from "@bb/plugin-sdk/app";
import * as BbApp from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";

const PLUGIN_ID = "wterm-terminal-preview";
const PANEL_ACTION_ID = "terminal";
const PANEL_TITLE = "Wterm terminal";

const TerminalPanel = lazy(() => import("./terminal-panel.js"));
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
	const replaceRef = useRef(replace);
	const [retry, setRetry] = useState(0);
	const [state, setState] = useState<
		"checking" | "ready" | "missing" | "error"
	>("checking");
	replaceRef.current = replace;

	useEffect(() => {
		let cancelled = false;
		setState("checking");
		const timeout = window.setTimeout(() => {
			if (!cancelled) setState("error");
		}, 10_000);
		rpc
			.call("listSessions", { threadId })
			.then(
				(items) => {
					if (cancelled) return;
					window.clearTimeout(timeout);
					const selected = items.find((item) => item.id === params.terminalId);
					if (selected && isActive(selected)) {
						setState("ready");
						return;
					}
					setState("missing");
					replaceRef.current(null);
				},
				() => {
					if (!cancelled) {
						window.clearTimeout(timeout);
						setState("error");
					}
				},
			)
			.catch(() => {});
		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
		};
	}, [params.terminalId, retry, rpc, threadId]);

	if (state === "ready")
		return <TerminalPanel threadId={threadId} params={params} />;
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
	return <div className="p-4 text-sm">Checking terminal session…</div>;
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
	const storageKey = `bb.wterm-terminal-preview.${threadId}`;
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

export default definePluginApp((app) => {
	app.slots.threadPanelAction({
		id: PANEL_ACTION_ID,
		title: PANEL_TITLE,
		icon: "Terminal",
		layout: "flush",
		async run({ threadId, openPanel }) {
			const terminalId = createdTerminalId(
				await callBackendRpc("createTerminal", { threadId }),
			);
			openPanel({
				title: PANEL_TITLE,
				params: { schemaVersion: 1, terminalId },
			});
		},
		component: function TerminalAction({ threadId, params }) {
			const { threadId: contextThreadId } = useBbContext();
			const currentThreadId = threadId || contextThreadId || "";
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
