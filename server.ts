import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix as path } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_UPLOAD_BYTES = 25 * 1024 * 1024;
const UPLOAD_PATH = "/upload";
const WASM_PATH = "/ghostty-vt.wasm";
const NERD_FONT_PATH = "/symbols-nerd-font-mono-v3.5.0.woff2";
const UPLOAD_DIRECTORY = ".bb-wterm-uploads";
const IMAGE_EXTENSIONS = new Set([
	"avif",
	"gif",
	"heic",
	"heif",
	"jpeg",
	"jpg",
	"png",
	"svg",
	"webp",
]);

const legacyScope = (threadId: string) => ({
	kind: "thread" as const,
	threadId,
});
const terminalLinksKey = (threadId: string) => `thread-terminals:${threadId}`;
const session = z.object({
	id: z.string(),
	title: z.string(),
	initialCwd: z.string().nullable(),
	status: z.string(),
	updatedAt: z.number(),
	lastUserInputAt: z.number().nullable(),
});
export const wtermRpcContract = defineRpcContract({
	listSessions: {
		input: z.object({ threadId: z.string().min(1) }),
		output: z.array(session),
	},
	createTerminal: {
		input: z.object({ threadId: z.string().min(1) }),
		output: session,
	},
	restartTerminal: {
		input: z.object({
			threadId: z.string().min(1),
			terminalId: z.string().min(1),
		}),
		output: session,
	},
});
type Session = z.infer<typeof session>;

function bundledAssetUrl(fileName: string, moduleUrl: string): URL {
	const builtModule = new URL(".", moduleUrl).pathname.endsWith("/dist/");
	return new URL(
		`${builtModule ? "../" : "./"}${fileName}`,
		moduleUrl,
	);
}

export function bundledWasmUrl(moduleUrl = import.meta.url): URL {
	return bundledAssetUrl("ghostty-vt.wasm", moduleUrl);
}

export function bundledNerdFontUrl(moduleUrl = import.meta.url): URL {
	return bundledAssetUrl("SymbolsNerdFontMono-Regular.woff2", moduleUrl);
}

type PluginHttpContext = Parameters<
	Parameters<BbPluginApi["http"]["route"]>[2]
>[0];

class UploadError extends Error {
	constructor(
		readonly status: 400 | 404 | 409 | 413 | 502,
		message: string,
	) {
		super(message);
	}
}

function uploadLimit(fileName: string, mime: string): number {
	const extension = /\.([A-Za-z0-9]{1,10})$/u
		.exec(fileName)?.[1]
		?.toLowerCase();
	return mime.toLowerCase().startsWith("image/") ||
		(extension !== undefined && IMAGE_EXTENSIONS.has(extension))
		? MAX_IMAGE_UPLOAD_BYTES
		: MAX_FILE_UPLOAD_BYTES;
}

function requiredQuery(context: PluginHttpContext, name: string): string {
	const value = context.req.query(name)?.trim();
	if (!value) throw new UploadError(400, `${name} is required`);
	return value;
}

export function buildUploadPath(
	initialCwd: string,
	fileName: string,
	id: string = randomUUID(),
): { rootPath: string; uploadPath: string } {
	if (!path.isAbsolute(initialCwd)) {
		throw new UploadError(
			400,
			"terminal initialCwd must be an absolute POSIX path",
		);
	}
	const extension = /\.([A-Za-z0-9]{1,10})$/u.exec(fileName)?.[1];
	const basename = extension ? `${id}.${extension.toLowerCase()}` : id;
	return {
		rootPath: initialCwd,
		uploadPath: path.join(initialCwd, UPLOAD_DIRECTORY, basename),
	};
}

export async function readBoundedUploadBody(
	request: Request,
	fileName: string,
	mime: string,
): Promise<Uint8Array> {
	const limit = uploadLimit(fileName, mime);
	const declaredHeader = request.headers.get("content-length");
	if (declaredHeader !== null) {
		const declaredLength = Number(declaredHeader);
		if (!Number.isFinite(declaredLength) || declaredLength < 0) {
			throw new UploadError(
				400,
				"content-length must be a non-negative number",
			);
		}
		if (declaredLength > limit) {
			throw new UploadError(413, `upload exceeds the ${limit} byte limit`);
		}
	}
	if (request.signal.aborted) throw new UploadError(400, "upload aborted");
	if (!request.body) throw new UploadError(400, "upload body is required");

	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = request.body.getReader();
	try {
		while (true) {
			if (request.signal.aborted) throw new UploadError(400, "upload aborted");
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new UploadError(413, `upload exceeds the ${limit} byte limit`);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	if (size === 0) throw new UploadError(400, "upload body is empty");

	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

const terminalLinkWrites = new Map<string, Promise<void>>();

async function linkedTerminalIds(
	bb: BbPluginApi,
	threadId: string,
): Promise<string[]> {
	return (await bb.storage.kv.get<string[]>(terminalLinksKey(threadId))) ?? [];
}

async function saveLinkedTerminalIds(
	bb: BbPluginApi,
	threadId: string,
	terminalIds: readonly string[],
): Promise<void> {
	await bb.storage.kv.set(terminalLinksKey(threadId), [...new Set(terminalIds)]);
}

async function withLinkedTerminalIds<Value>(
	bb: BbPluginApi,
	threadId: string,
	update: (current: string[]) => Promise<Value>,
): Promise<Value> {
	const key = terminalLinksKey(threadId);
	const previous = terminalLinkWrites.get(key) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const queued = previous.then(() => gate);
	terminalLinkWrites.set(key, queued);
	await previous;
	try {
		return await update(await linkedTerminalIds(bb, threadId));
	} finally {
		release();
		if (terminalLinkWrites.get(key) === queued) terminalLinkWrites.delete(key);
	}
}

async function rememberLinkedTerminal(
	bb: BbPluginApi,
	threadId: string,
	terminalId: string,
): Promise<void> {
	await withLinkedTerminalIds(bb, threadId, async (current) => {
		await saveLinkedTerminalIds(bb, threadId, [...current, terminalId]);
	});
}

export function nextLinkedTerminalIds(
	linkedIds: readonly string[],
	results: readonly PromiseSettledResult<{ id: string }>[],
): string[] {
	return linkedIds.flatMap((id, index) => {
		const result = results[index];
		if (!result) return [id];
		if (result.status === "fulfilled") return [result.value.id];
		return [id];
	});
}

function unavailableLinkedSession(terminalId: string): Session {
	return {
		id: terminalId,
		title: "Wterm terminal",
		initialCwd: null,
		status: "running",
		updatedAt: 0,
		lastUserInputAt: null,
	};
}

async function loadLinkedTerminals(bb: BbPluginApi, threadId: string) {
	return withLinkedTerminalIds(bb, threadId, async (linkedIds) => {
		const linkedResults = await Promise.allSettled(
			linkedIds.map((terminalId) => bb.sdk.terminals.get({ terminalId })),
		);
		const nextIds = nextLinkedTerminalIds(linkedIds, linkedResults);
		if (
			nextIds.length !== linkedIds.length ||
			nextIds.some((id, index) => id !== linkedIds[index])
		) {
			await saveLinkedTerminalIds(bb, threadId, nextIds);
		}
		const sessions = linkedResults.flatMap((result) =>
			result.status === "fulfilled" ? [result.value] : [],
		);
		const unavailableIds = linkedIds.filter(
			(_, index) => linkedResults[index]?.status === "rejected",
		);
		return { sessions, unavailableIds };
	});
}

async function sessionsForThread(bb: BbPluginApi, threadId: string) {
	const [legacy, linked] = await Promise.all([
		bb.sdk.terminals.list({ scope: legacyScope(threadId) }),
		loadLinkedTerminals(bb, threadId),
	]);
	return [...new Map(
		[...legacy.sessions, ...linked.sessions].map((terminal) => [terminal.id, terminal]),
	).values()];
}

async function listedSessionsForThread(bb: BbPluginApi, threadId: string) {
	const [legacy, linked] = await Promise.all([
		bb.sdk.terminals.list({ scope: legacyScope(threadId) }),
		loadLinkedTerminals(bb, threadId),
	]);
	const unavailable = linked.unavailableIds.map(unavailableLinkedSession);
	return [...new Map(
		[...legacy.sessions.map(mapSession), ...linked.sessions.map(mapSession), ...unavailable].map(
			(terminal) => [terminal.id, terminal],
		),
	).values()];
}

async function handleUpload(
	bb: BbPluginApi,
	context: PluginHttpContext,
): Promise<Response> {
	try {
		const threadId = requiredQuery(context, "threadId");
		const terminalId = requiredQuery(context, "terminalId");
		const fileName = requiredQuery(context, "fileName");
		const mime =
			context.req.query("mime")?.trim() || "application/octet-stream";
		const sessions = await sessionsForThread(bb, threadId);
		const terminal = sessions.find((item) => item.id === terminalId);
		if (!terminal) {
			throw new UploadError(404, "terminal is not in the requested thread");
		}

		const bytes = await readBoundedUploadBody(context.req.raw, fileName, mime);
		if (context.req.raw.signal.aborted) {
			throw new UploadError(400, "upload aborted");
		}
		const target = buildUploadPath(terminal.initialCwd, fileName);
		const expectedSha256 = createHash("sha256").update(bytes).digest("hex");
		const result = await bb.sdk.files.write({
			hostId: terminal.hostId,
			path: target.uploadPath,
			rootPath: target.rootPath,
			content: Buffer.from(bytes).toString("base64"),
			contentEncoding: "base64",
			createParents: true,
			expectedSha256: null,
			mode: 0o600,
		});
		if (result.outcome === "conflict") {
			throw new UploadError(409, "generated upload path already exists");
		}
		if (
			result.sha256 !== expectedSha256 ||
			result.sizeBytes !== bytes.byteLength
		) {
			throw new UploadError(502, "terminal host did not verify uploaded bytes");
		}
		return context.json(
			{
				path: target.uploadPath,
				sha256: result.sha256,
				sizeBytes: result.sizeBytes,
			},
			201,
		);
	} catch (error) {
		if (error instanceof UploadError) {
			return context.json({ error: error.message }, error.status);
		}
		throw error;
	}
}

function mapSession(value: {
	id: string;
	title: string;
	initialCwd: string;
	status: string;
	updatedAt: number;
	lastUserInputAt?: number | null;
}): Session {
	return {
		id: value.id,
		title: value.title,
		initialCwd: value.initialCwd,
		status: value.status,
		updatedAt: value.updatedAt,
		lastUserInputAt: value.lastUserInputAt ?? null,
	};
}

let ghosttyWasmCache: Promise<Uint8Array> | Uint8Array | null = null;

async function ghosttyWasmBytes(): Promise<Uint8Array> {
	if (ghosttyWasmCache instanceof Uint8Array) return ghosttyWasmCache;
	if (ghosttyWasmCache) return ghosttyWasmCache;
	const pending = readFile(bundledWasmUrl()).then((bytes) => {
		const copy = new Uint8Array(bytes);
		ghosttyWasmCache = copy;
		return copy;
	});
	ghosttyWasmCache = pending;
	return pending;
}

export default function plugin(bb: BbPluginApi) {
	bb.rpc.register(wtermRpcContract, {
		async listSessions({ threadId }) {
			return listedSessionsForThread(bb, threadId);
		},
		async createTerminal({ threadId }) {
			const thread = await bb.sdk.threads.get({ threadId });
			if (!thread.environmentId) {
				throw new Error("Thread has no terminal environment");
			}
			const result = await bb.sdk.terminals.create({
				scope: {
					kind: "environment",
					environmentId: thread.environmentId,
				},
				cols: 80,
				rows: 24,
				start: { mode: "shell" },
				title: "Wterm terminal",
			});
			await rememberLinkedTerminal(bb, threadId, result.id);
			return mapSession(result);
		},
		async restartTerminal({ threadId, terminalId }) {
			const sessions = await sessionsForThread(bb, threadId);
			if (!sessions.some((item) => item.id === terminalId))
				throw new Error("Terminal is not in the requested thread");
			const replacement = await bb.sdk.terminals.restart({ terminalId });
			await withLinkedTerminalIds(bb, threadId, async (linkedIds) => {
				if (!linkedIds.includes(terminalId)) return;
				await saveLinkedTerminalIds(
					bb,
					threadId,
					linkedIds.map((id) => (id === terminalId ? replacement.id : id)),
				);
			});
			return mapSession(replacement);
		},
	});
	bb.http.route("POST", UPLOAD_PATH, (context) => handleUpload(bb, context), {
		auth: "token",
	});
	bb.http.route(
		"GET",
		WASM_PATH,
		async () =>
			new Response(await ghosttyWasmBytes(), {
				headers: {
					"cache-control": "public, max-age=31536000, immutable",
					"content-type": "application/wasm",
				},
			}),
		{ auth: "token" },
	);
	bb.http.route(
		"GET",
		NERD_FONT_PATH,
		async () =>
			new Response(
				await readFile(bundledNerdFontUrl()),
				{
					headers: {
						"cache-control": "public, max-age=31536000, immutable",
						"content-type": "font/woff2",
						"x-content-type-options": "nosniff",
					},
				},
			),
		{ auth: "token" },
	);
}
