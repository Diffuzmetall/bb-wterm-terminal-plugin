import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GhosttyCore } from "@wterm/ghostty";
import { supportAnyEventMouseMode } from "./wterm-renderer";
import { encodeLatin1 } from "./osc52-clipboard";

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
});
