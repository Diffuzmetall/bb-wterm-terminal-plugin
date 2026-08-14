import { lazy, useEffect, useRef, useState } from "react";
import {
	definePluginApp,
	experimental_useReplaceCurrentPluginTab,
	useBbContext,
	useRpc,
} from "@bb/plugin-sdk/app";
import type { wtermRpcContract } from "./server";

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
function Picker({
	threadId,
	replace,
}: {
	threadId: string;
	replace: (params: unknown) => void;
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
		rpc.call("listSessions", { threadId }).then(
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
function Panel({
	threadId,
	params,
	replace,
}: {
	threadId: string;
	params: unknown;
	replace: (params: unknown) => void;
}) {
	if (
		typeof params === "object" &&
		params !== null &&
		"schemaVersion" in params &&
		(params as { schemaVersion?: unknown }).schemaVersion === 1
	)
		return <TerminalPanel threadId={threadId} params={params} />;
	return <Picker key={threadId} threadId={threadId} replace={replace} />;
}
export default definePluginApp((app) => {
	app.slots.threadPanelAction({
		id: "terminal",
		title: "Wterm terminal",
		icon: "Terminal",
		layout: "flush",
		component: function TerminalAction({ threadId, params }) {
			const { threadId: contextThreadId } = useBbContext();
			const replaceCurrent = experimental_useReplaceCurrentPluginTab();
			const replace = (params: unknown) =>
				replaceCurrent({
					actionId: "terminal",
					title: "Wterm terminal",
					params: params as never,
				});
			return (
				<Panel
					threadId={threadId || contextThreadId || ""}
					params={params}
					replace={replace}
				/>
			);
		},
	});
});
