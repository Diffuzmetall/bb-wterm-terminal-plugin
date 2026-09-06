import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "@wterm/ghostty";
import {
  getAnyEventMouseModeState,
  supportAnyEventMouseMode,
} from "./wterm-renderer";
import { encodeLatin1 } from "./osc52-clipboard";
import { terminalLinkAction } from "./terminal-links";

const wasmBytes = await readFile(new URL("./ghostty-vt.wasm", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ghostty core wrapper", () => {
  it("inits, ignores a second init, and survives OSC 52 writes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(80, 24);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);

    core.init(120, 40);
    expect(core.getCols()).toBe(120);
    expect(core.getRows()).toBe(40);

    const afterChunk = vi.fn();
    expect(() => {
      core.writeRaw(encodeLatin1("hello\x1b]52;c;YQ==\x07world"), afterChunk);
      core.writeString("plain\n", afterChunk);
      core.writeRaw(new Uint8Array(4096).fill(65));
    }).not.toThrow();
    expect(afterChunk).toHaveBeenCalled();
  });

  it("accepts a direct Kitty RGB image and exposes bounded graphics state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({
        wasmPath: "http://wterm.test/ghostty-vt.wasm",
        imageStorageLimit: 32 * 1024 * 1024,
      }),
    );
    core.init(80, 24);

    expect(() => {
      core.writeString("\x1b_Ga=T,f=24,s=1,v=1,c=1,r=1,m=0;AP8A\x1b\\");
    }).not.toThrow();
    const graphics = core.getGraphicsState();
    expect(graphics?.images).toHaveLength(1);
    expect(graphics?.placements).toHaveLength(1);
    expect(core.getResourceState().graphics?.capacity).toBe(32 * 1024 * 1024);
    const image = graphics?.images[0];
    expect(image).toBeDefined();
    expect(core.getGraphicsImage?.(image!.imageId, image!.version)?.rgba).toEqual(
      new Uint8Array([0, 255, 0, 255]),
    );
  });

  it("tracks fragmented DEC 1003 enable and disable sequences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(80, 24);

    core.writeString("\x1b[?10");
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: false,
      generation: 0,
    });
    core.writeString("03h");
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: true,
      generation: 1,
    });
    expect(core.mouseTracking()).toBe(1002);

    core.writeString("\x1b[?1002h");
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: false,
      generation: 2,
    });
    expect(core.mouseTracking()).toBe(1002);

    core.writeString("\x1b[?1003h");
    core.writeRaw(encodeLatin1("\x1b[?1003l"));
    expect(getAnyEventMouseModeState(core)).toEqual({
      enabled: false,
      generation: 4,
    });
  });

  it("ignores collapsed 1x1 init and resize from a hidden tab", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(1, 1);
    expect(core.getCols()).toBe(0);
    expect(core.getRows()).toBe(0);

    core.init(80, 24);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);

    core.resize(1, 1);
    expect(core.getCols()).toBe(80);
    expect(core.getRows()).toBe(24);
  });

  it("exposes OSC 8 web and file links through the renderer-safe core wrapper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(wasmBytes, { headers: { "content-type": "application/wasm" } })),
    );
    const core = supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: "http://wterm.test/ghostty-vt.wasm" }),
    );
    core.init(80, 24);
    core.writeString(
      "\x1b]8;;https://example.com\x07web\x1b]8;;\x07\r\n" +
        "\x1b]8;;file:///workspace/src/app.ts\x07file\x1b]8;;\x07",
    );

    expect(core.getCell(0, 0).linkUri).toBe("https://example.com/");
    expect(terminalLinkAction(core.getCell(1, 0).linkUri ?? "")).toEqual({
      kind: "file",
      path: "/workspace/src/app.ts",
    });
  });
});
