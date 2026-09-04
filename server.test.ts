import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import plugin, {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_FILE_UPLOAD_BYTES,
  buildUploadPath,
  bundledNerdFontUrl,
  bundledWasmUrl,
  createBytesCache,
  nextLinkedTerminalIds,
  readBoundedUploadBody,
  wtermRpcContract,
} from "./server";

function uploadContext({
  bytes = new Uint8Array([1, 2, 3]),
  fileName = "photo.png",
  headers,
  mime = "image/png",
  signal,
  terminalId = "term-1",
  threadId = "thread-1",
}: {
  bytes?: Uint8Array;
  fileName?: string;
  headers?: HeadersInit;
  mime?: string;
  signal?: AbortSignal;
  terminalId?: string;
  threadId?: string;
} = {}) {
  const url = new URL("http://bb/upload");
  url.search = new URLSearchParams({
    fileName,
    mime,
    terminalId,
    threadId,
  }).toString();
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const raw = new Request(url, {
    method: "POST",
    headers,
    body,
    signal,
  });
  return {
    req: {
      raw,
      query: (name: string) => url.searchParams.get(name) ?? undefined,
    },
    json: (value: unknown, status = 200) => Response.json(value, { status }),
  } as never;
}

function createPluginHarness() {
  const register = vi.fn();
  const route = vi.fn();
  const terminal = {
    id: "term-1",
    threadId: "thread-1",
    environmentId: "environment-1",
    hostId: "remote-host",
    title: "Shell",
    initialCwd: "/workspace",
    cols: 80,
    rows: 24,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    updatedAt: 2,
    lastUserInputAt: null,
  };
  const list = vi.fn((input: { scope: { threadId: string } }) =>
    Promise.resolve({
      sessions: input.scope.threadId === terminal.threadId ? [terminal] : [],
    }),
  );
  const write = vi.fn();
  const bb = {
    http: { route },
    rpc: { register },
    storage: {
      kv: {
        get: vi.fn().mockResolvedValue(undefined),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    sdk: { files: { write }, terminals: { get: vi.fn(), list } },
  } as never;
  plugin(bb);
  const handlers = new Map(
    route.mock.calls.map(([method, path, handler]) => [
      `${String(method)} ${String(path)}`,
      handler,
    ]),
  );
  return {
    font: handlers.get(
      "GET /symbols-nerd-font-mono-v3.5.0.woff2",
    ) as () => Promise<Response>,
    list,
    register,
    route,
    wasm: handlers.get("GET /ghostty-vt.wasm") as () => Promise<Response>,
    write,
    upload: handlers.get("POST /upload") as (
      context: unknown,
    ) => Promise<Response>,
  };
}

describe("createBytesCache", () => {
  it("coalesces overlapping reads and serves the stored copy", async () => {
    let resolveRead: ((value: Uint8Array) => void) | undefined;
    const read = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const cached = createBytesCache(read);
    const first = cached();
    const second = cached();
    expect(read).toHaveBeenCalledOnce();
    resolveRead?.(new Uint8Array([1, 2, 3]));
    await expect(Promise.all([first, second])).resolves.toEqual([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([1, 2, 3]),
    ]);
    await expect(cached()).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(read).toHaveBeenCalledOnce();
  });
});

describe("Wterm server boundaries", () => {
  it("registers authenticated upload and renderer asset routes", () => {
    const register = vi.fn();
    const route = vi.fn();
    plugin({ http: { route }, rpc: { register }, sdk: {} } as never);

    expect(register).toHaveBeenCalledWith(wtermRpcContract, expect.any(Object));
    expect(Object.keys(wtermRpcContract)).toEqual([
      "listSessions",
      "createTerminal",
      "restartTerminal",
    ]);
    expect(route).toHaveBeenCalledWith(
      "POST",
      "/upload",
      expect.any(Function),
      { auth: "token" },
    );
    expect(route).toHaveBeenCalledWith(
      "GET",
      "/ghostty-vt.wasm",
      expect.any(Function),
      { auth: "token" },
    );
    expect(route).toHaveBeenCalledWith(
      "GET",
      "/symbols-nerd-font-mono-v3.5.0.woff2",
      expect.any(Function),
      { auth: "token" },
    );
  });

  it("resolves and serves source and built renderer assets", async () => {
    expect(bundledWasmUrl("file:///plugin/server.ts").pathname).toBe(
      "/plugin/ghostty-vt.wasm",
    );
    expect(bundledWasmUrl("file:///plugin/dist/server.js").pathname).toBe(
      "/plugin/ghostty-vt.wasm",
    );
    expect(bundledNerdFontUrl("file:///plugin/server.ts").pathname).toBe(
      "/plugin/SymbolsNerdFontMono-Regular.woff2",
    );
    expect(bundledNerdFontUrl("file:///plugin/dist/server.js").pathname).toBe(
      "/plugin/SymbolsNerdFontMono-Regular.woff2",
    );

    const harness = createPluginHarness();
    const wasm = await harness.wasm();
    const font = await harness.font();
    expect(wasm.headers.get("content-type")).toBe("application/wasm");
    expect(wasm.headers.get("cache-control")).toContain("immutable");
    expect((await wasm.arrayBuffer()).byteLength).toBeGreaterThan(400_000);
    expect(font.headers.get("content-type")).toBe("font/woff2");
    expect(font.headers.get("x-content-type-options")).toBe("nosniff");
    expect(font.headers.get("cache-control")).toContain("immutable");
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(1_000_000);
  });

  it("keeps the vendored Ghostty WASM byte-identical to the pinned package", async () => {
    const vendored = await readFile(
      new URL("./ghostty-vt.wasm", import.meta.url),
    );
    const upstream = await readFile(
      new URL(
        "./node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm",
        import.meta.url,
      ),
    );
    const expected =
      "4a0a02357206349ed52b76ebda8feea4a65e453fe4e199832d8c009d7c41ba4f";

    expect(createHash("sha256").update(vendored).digest("hex")).toBe(expected);
    expect(createHash("sha256").update(upstream).digest("hex")).toBe(expected);
  });

  it("creates hidden environment terminals and rejects cross-thread restart", async () => {
    const register = vi.fn();
    const list = vi.fn().mockResolvedValue({
      sessions: [
        {
          id: "term-1",
          title: "Shell",
          initialCwd: "/tmp",
          status: "running",
          updatedAt: 10,
        },
      ],
    });
    const create = vi.fn().mockResolvedValue({
      id: "term-2",
      title: "New",
      initialCwd: "/tmp",
      status: "running",
      updatedAt: 11,
    });
    const restart = vi.fn();
    const kvGet = vi.fn().mockResolvedValue(undefined);
    const kvSet = vi.fn().mockResolvedValue(undefined);
    const bb = {
      http: { route: vi.fn() },
      rpc: { register },
      storage: { kv: { get: kvGet, set: kvSet } },
      sdk: {
        threads: {
          get: vi.fn().mockResolvedValue({ environmentId: "environment-1" }),
        },
        terminals: { get: vi.fn(), list, create, restart },
      },
    } as never;
    plugin(bb);
    const handlers = register.mock.calls[0]?.[1];

    await expect(
      handlers.listSessions({ threadId: "thread-1" }),
    ).resolves.toMatchObject([{ id: "term-1" }]);
    await handlers.createTerminal({ threadId: "thread-1" });
    expect(list).toHaveBeenCalledWith({
      scope: { kind: "thread", threadId: "thread-1" },
    });
    expect(create).toHaveBeenCalledWith({
      scope: { kind: "environment", environmentId: "environment-1" },
      cols: 80,
      rows: 24,
      start: { mode: "shell" },
      title: "Wterm terminal",
    });
    expect(kvSet).toHaveBeenCalledWith("thread-terminals:thread-1", [
      { id: "term-2", firstUnavailableAt: null },
    ]);

    list.mockClear();
    list.mockImplementation(({ scope: requestedScope }) =>
      Promise.resolve({
        sessions:
          requestedScope.threadId === "thread-1"
            ? [
                {
                  id: "term-1",
                  title: "Shell",
                  initialCwd: "/tmp",
                  status: "running",
                  updatedAt: 10,
                },
              ]
            : [],
      }),
    );
    await expect(
      handlers.restartTerminal({
        threadId: "thread-other",
        terminalId: "term-1",
      }),
    ).rejects.toThrow("not in the requested thread");
    expect(list).toHaveBeenCalledWith({
      scope: { kind: "thread", threadId: "thread-other" },
    });
    expect(restart).not.toHaveBeenCalled();

    restart.mockResolvedValueOnce({
      id: "term-1",
      title: "Shell",
      initialCwd: "/tmp",
      status: "running",
      updatedAt: 12,
    });
    await expect(
      handlers.restartTerminal({
        threadId: "thread-1",
        terminalId: "term-1",
      }),
    ).resolves.toMatchObject({ id: "term-1" });
    expect(restart).toHaveBeenCalledWith({ terminalId: "term-1" });
  });

  it("lists and restarts terminals linked from the thread to its environment", async () => {
    const register = vi.fn();
    const linked = {
      id: "term-environment",
      title: "Wterm terminal",
      initialCwd: "/workspace",
      status: "running",
      updatedAt: 20,
      lastUserInputAt: null,
    };
    const kvGet = vi.fn().mockResolvedValue([linked.id]);
    const kvSet = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(linked);
    const restart = vi.fn().mockResolvedValue({
      ...linked,
      id: "term-replacement",
      updatedAt: 21,
    });
    const bb = {
      http: { route: vi.fn() },
      rpc: { register },
      storage: { kv: { get: kvGet, set: kvSet } },
      sdk: {
        terminals: {
          get,
          list: vi.fn().mockResolvedValue({ sessions: [] }),
          restart,
        },
      },
    } as never;
    plugin(bb);
    const handlers = register.mock.calls[0]?.[1];

    await expect(
      handlers.listSessions({ threadId: "thread-1" }),
    ).resolves.toMatchObject([{ id: linked.id }]);
    await expect(
      handlers.restartTerminal({
        threadId: "thread-1",
        terminalId: linked.id,
      }),
    ).resolves.toMatchObject({ id: "term-replacement" });
    expect(get).toHaveBeenCalledWith({ terminalId: linked.id });
    expect(restart).toHaveBeenCalledWith({ terminalId: linked.id });
    expect(kvSet).toHaveBeenCalledWith("thread-terminals:thread-1", [
      { id: "term-replacement", firstUnavailableAt: null },
    ]);
  });

  it("keeps linked terminal ids when a host lookup fails transiently", async () => {
    const register = vi.fn();
    const kvGet = vi.fn().mockResolvedValue(["term-environment"]);
    const kvSet = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockRejectedValue(new Error("host unavailable"));
    const bb = {
      http: { route: vi.fn() },
      rpc: { register },
      storage: { kv: { get: kvGet, set: kvSet } },
      sdk: {
        terminals: {
          get,
          list: vi.fn().mockResolvedValue({ sessions: [] }),
        },
      },
    } as never;
    plugin(bb);
    const handlers = register.mock.calls[0]?.[1];

    await expect(
      handlers.listSessions({ threadId: "thread-1" }),
    ).resolves.toEqual([
      {
        id: "term-environment",
        title: "Wterm terminal",
        initialCwd: null,
        status: "unavailable",
        updatedAt: 0,
        lastUserInputAt: null,
      },
    ]);
    await vi.waitFor(() => {
      expect(kvSet).toHaveBeenCalledWith("thread-terminals:thread-1", [
        {
          id: "term-environment",
          firstUnavailableAt: expect.any(Number),
        },
      ]);
    });
  });

  it("does not hold the linked-id write mutex while listSessions waits on terminals.get", async () => {
    const register = vi.fn();
    let rejectGet!: (error: Error) => void;
    const blockedGet = new Promise<never>((_, reject) => {
      rejectGet = reject;
    });
    const kv = new Map<string, unknown>([
      ["thread-terminals:thread-1", ["term-old"]],
    ]);
    const kvSet = vi.fn(async (key: string, value: unknown) => {
      kv.set(key, value);
    });
    const get = vi.fn().mockImplementation(() => blockedGet);
    const create = vi.fn().mockResolvedValue({
      id: "term-new",
      title: "Wterm terminal",
      initialCwd: "/tmp",
      status: "running",
      updatedAt: 11,
      lastUserInputAt: null,
    });
    const bb = {
      http: { route: vi.fn() },
      rpc: { register },
      storage: {
        kv: {
          get: vi.fn(async (key: string) => kv.get(key)),
          set: kvSet,
        },
      },
      sdk: {
        threads: {
          get: vi.fn().mockResolvedValue({ environmentId: "environment-1" }),
        },
        terminals: {
          get,
          list: vi.fn().mockResolvedValue({ sessions: [] }),
          create,
        },
      },
    } as never;
    plugin(bb);
    const handlers = register.mock.calls[0]?.[1];

    const listing = handlers.listSessions({ threadId: "thread-1" });
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    await expect(
      handlers.createTerminal({ threadId: "thread-1" }),
    ).resolves.toMatchObject({ id: "term-new" });
    expect(kv.get("thread-terminals:thread-1")).toEqual([
      { id: "term-old", firstUnavailableAt: null },
      { id: "term-new", firstUnavailableAt: null },
    ]);

    rejectGet(new Error("timeout"));
    await expect(listing).resolves.toEqual([
      {
        id: "term-old",
        title: "Wterm terminal",
        initialCwd: null,
        status: "unavailable",
        updatedAt: 0,
        lastUserInputAt: null,
      },
    ]);
    await vi.waitFor(() => {
      const stored = kv.get("thread-terminals:thread-1") as {
        id: string;
        firstUnavailableAt: number | null;
      }[];
      expect(stored.map((record) => record.id)).toEqual([
        "term-old",
        "term-new",
      ]);
      expect(stored[0]?.firstUnavailableAt).toEqual(expect.any(Number));
      expect(stored[1]).toEqual({
        id: "term-new",
        firstUnavailableAt: null,
      });
    });
  });

  it("does not authorize upload to an unavailable linked terminal", async () => {
    const register = vi.fn();
    const route = vi.fn();
    const write = vi.fn();
    const bb = {
      http: { route },
      rpc: { register },
      storage: {
        kv: {
          get: vi.fn().mockResolvedValue(["term-zombie"]),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      sdk: {
        files: { write },
        terminals: {
          get: vi.fn().mockRejectedValue(new Error("host unavailable")),
          list: vi.fn().mockResolvedValue({ sessions: [] }),
        },
      },
    } as never;
    plugin(bb);
    const upload = route.mock.calls.find(
      ([method, path]) => method === "POST" && path === "/upload",
    )?.[2] as (context: unknown) => Promise<Response>;

    const response = await upload(
      uploadContext({ terminalId: "term-zombie" }),
    );
    expect(response.status).toBe(404);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not drop a linked id from a rejected lookup", () => {
    expect(
      nextLinkedTerminalIds(
        ["term-a", "term-b"],
        [
          { status: "rejected", reason: new Error("timeout") },
          { status: "fulfilled", value: { id: "term-b" } },
        ],
      ),
    ).toEqual(["term-a", "term-b"]);
  });

  it("writes verified bytes to a UUID path below the selected terminal cwd", async () => {
    const harness = createPluginHarness();
    const bytes = new Uint8Array([0, 1, 2, 3, 255]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    harness.write.mockResolvedValue({
      outcome: "written",
      sha256,
      sizeBytes: bytes.byteLength,
    });

    const response = await harness.upload(
      uploadContext({
        bytes,
        fileName: "../../bad name '$(touch nope)'.PNG",
      }),
    );

    expect(response.status).toBe(201);
    const result = (await response.json()) as { path: string; sha256: string };
    expect(result.path).toMatch(
      /^\/workspace\/\.bb-wterm-uploads\/[a-f0-9-]+\.png$/u,
    );
    expect(result.path).not.toContain("bad name");
    expect(result.sha256).toBe(sha256);
    expect(harness.list).toHaveBeenCalledWith({
      scope: { kind: "thread", threadId: "thread-1" },
    });
    expect(harness.write).toHaveBeenCalledWith({
      hostId: "remote-host",
      path: result.path,
      rootPath: "/workspace",
      content: Buffer.from(bytes).toString("base64"),
      contentEncoding: "base64",
      createParents: true,
      expectedSha256: null,
      mode: 0o600,
    });
  });

  it("rejects cross-thread, oversized, and aborted uploads before host write", async () => {
    const harness = createPluginHarness();

    expect(
      await harness.upload(uploadContext({ threadId: "thread-other" })),
    ).toHaveProperty("status", 404);
    expect(
      await harness.upload(
        uploadContext({
          headers: { "content-length": String(MAX_IMAGE_UPLOAD_BYTES + 1) },
        }),
      ),
    ).toHaveProperty("status", 413);
    expect(
      await harness.upload(
        uploadContext({
          bytes: new Uint8Array(MAX_IMAGE_UPLOAD_BYTES + 1),
          fileName: "screenshot.PNG",
          mime: "application/octet-stream",
        }),
      ),
    ).toHaveProperty("status", 413);

    const controller = new AbortController();
    controller.abort();
    expect(
      await harness.upload(uploadContext({ signal: controller.signal })),
    ).toHaveProperty("status", 400);
    expect(harness.write).not.toHaveBeenCalled();
  });

  it("rejects host conflicts and unverifiable write receipts", async () => {
    const harness = createPluginHarness();
    harness.write.mockResolvedValueOnce({
      outcome: "conflict",
      currentSha256: "existing",
    });
    expect(await harness.upload(uploadContext())).toHaveProperty("status", 409);

    harness.write.mockResolvedValueOnce({
      outcome: "written",
      sha256: "wrong",
      sizeBytes: 3,
    });
    expect(await harness.upload(uploadContext())).toHaveProperty("status", 502);

    harness.write.mockResolvedValueOnce({
      outcome: "written",
      sha256: createHash("sha256")
        .update(new Uint8Array([1, 2, 3]))
        .digest("hex"),
      sizeBytes: 2,
    });
    expect(await harness.upload(uploadContext())).toHaveProperty("status", 502);
  });

  it("builds paths only below an absolute cwd and discards hostile basenames", () => {
    expect(buildUploadPath("/work", "../../evil.SH", "fixed-id")).toEqual({
      rootPath: "/work",
      uploadPath: "/work/.bb-wterm-uploads/fixed-id.sh",
    });
    expect(
      buildUploadPath("/work", "archive.verylongextension", "fixed-id"),
    ).toEqual({
      rootPath: "/work",
      uploadPath: "/work/.bb-wterm-uploads/fixed-id",
    });
    expect(() => buildUploadPath("relative", "x.txt", "fixed-id")).toThrow(
      "absolute POSIX path",
    );
  });

  it("concatenates a bounded multi-chunk request body exactly", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 1]));
        controller.enqueue(new Uint8Array([2, 255]));
        controller.close();
      },
    });
    const request = new Request("http://bb/upload", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(
      readBoundedUploadBody(request, "data.bin", "application/octet-stream"),
    ).resolves.toEqual(new Uint8Array([0, 1, 2, 255]));
  });

  it("applies image and ordinary-file size limits independently", async () => {
    const image = new Request("http://bb/upload", {
      method: "POST",
      headers: { "content-length": String(MAX_IMAGE_UPLOAD_BYTES + 1) },
      body: new Uint8Array([1]),
    });
    const fileAboveImageLimit = new Request("http://bb/upload", {
      method: "POST",
      headers: { "content-length": String(MAX_IMAGE_UPLOAD_BYTES + 1) },
      body: new Uint8Array([1]),
    });
    const file = new Request("http://bb/upload", {
      method: "POST",
      headers: { "content-length": String(MAX_FILE_UPLOAD_BYTES + 1) },
      body: new Uint8Array([1]),
    });

    await expect(
      readBoundedUploadBody(image, "photo.png", "application/octet-stream"),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readBoundedUploadBody(
        fileAboveImageLimit,
        "archive.bin",
        "application/octet-stream",
      ),
    ).resolves.toEqual(new Uint8Array([1]));
    await expect(
      readBoundedUploadBody(file, "archive.bin", "application/octet-stream"),
    ).rejects.toMatchObject({ status: 413 });
  });
});
