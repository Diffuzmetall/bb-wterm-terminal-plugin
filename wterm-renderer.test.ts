import { readFileSync } from "node:fs";
import { GhosttyCore } from "@wterm/ghostty";
import { describe, expect, it, vi } from "vitest";
import {
  clearTerminalSelection,
  isUsableTerminalSize,
  shouldApplyTerminalResize,
  computeFollowBottom,
  disposeGhosttyCore,
  encodeAnyEventMouseMove,
  ghosttyCoreOptions,
  loadGhosttyCore,
  preloadGhosttyCore,
  supportAnyEventMouseMode,
} from "./wterm-renderer";

function selectionFixture({
  collapsed = false,
  end = "outside",
  start = "inside",
}: {
  collapsed?: boolean;
  end?: string;
  start?: string;
} = {}) {
  const removeAllRanges = vi.fn();
  return {
    removeAllRanges,
    selection: {
      getRangeAt: () => ({ endContainer: end, startContainer: start }),
      isCollapsed: collapsed,
      rangeCount: 1,
      removeAllRanges,
    },
    terminal: {
      contains: (node: string) => node === "inside",
    },
  };
}

describe("clearTerminalSelection", () => {
  it("clears a selection that touches the terminal", () => {
    const fixture = selectionFixture();

    expect(clearTerminalSelection(fixture.terminal, fixture.selection)).toBe(
      true,
    );
    expect(fixture.removeAllRanges).toHaveBeenCalledOnce();
  });

  it("leaves selections outside the terminal alone", () => {
    const fixture = selectionFixture({ start: "outside" });

    expect(clearTerminalSelection(fixture.terminal, fixture.selection)).toBe(
      false,
    );
    expect(fixture.removeAllRanges).not.toHaveBeenCalled();
  });

  it("leaves collapsed selections alone", () => {
    const fixture = selectionFixture({ collapsed: true });

    expect(clearTerminalSelection(fixture.terminal, fixture.selection)).toBe(
      false,
    );
    expect(fixture.removeAllRanges).not.toHaveBeenCalled();
  });
});

describe("collapsed terminal sizes", () => {
  it("rejects the 1×1 size hidden tabs collapse into", () => {
    expect(isUsableTerminalSize(1, 1)).toBe(false);
    expect(isUsableTerminalSize(0, 24)).toBe(false);
    expect(isUsableTerminalSize(80, 1)).toBe(false);
    expect(isUsableTerminalSize(80, 24)).toBe(true);
  });

  it("does not apply a collapsed resize even when the element reports a box", () => {
    expect(shouldApplyTerminalResize(1, 1, true)).toBe(false);
    expect(shouldApplyTerminalResize(80, 24, false)).toBe(false);
    expect(shouldApplyTerminalResize(80, 24, true)).toBe(true);
  });

  it("settles panel transitions before sending the final PTY resize", () => {
    const source = readFileSync(
      new URL("./wterm-renderer.tsx", import.meta.url),
      "utf8",
    );
    const handleResizeSource = source.slice(
      source.indexOf("const handleResize"),
      source.indexOf("const handleWheelCapture"),
    );
    expect(source).toContain("const TERMINAL_RESIZE_SETTLE_MS = 250;");
    expect(handleResizeSource).toContain(
      "window.clearTimeout(resizeTimerRef.current)",
    );
    expect(handleResizeSource).toContain(
      "resizeTimerRef.current = window.setTimeout",
    );
    expect(handleResizeSource).toContain(
      "attachment.sendResize(instance.cols, instance.rows)",
    );
    expect(handleResizeSource).toContain(
      "lastResizeRef.current = { cols: instance.cols, rows: instance.rows }",
    );
    expect(
      handleResizeSource.indexOf(
        "attachment.sendResize(instance.cols, instance.rows)",
      ),
    ).toBeLessThan(
      handleResizeSource.indexOf(
        "lastResizeRef.current = { cols: instance.cols, rows: instance.rows }",
      ),
    );
    expect(source).not.toContain("resizeFrameRef");
  });
});

describe("SDK typecheck regressions", () => {
  it("guards pointer-up coordinates before comparing grid points", () => {
    const source = readFileSync(
      new URL("./wterm-renderer.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "if (!end || !selectionMoved(drag.start, end)) return;",
    );
  });

  it("keeps terminal-link failures on the imported toast path", () => {
    const source = readFileSync(
      new URL("./terminal-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('import { toast } from "sonner";');
    expect(source).toContain(
      'toast.error("BB could not open this terminal file.");',
    );
  });
});

describe("first paint and TUI scrollback", () => {
  it("forces transparent backgrounds on both viewport and scrollback rows", () => {
    const css = readFileSync(
      new URL("./wterm-renderer.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".wterm-renderer .term-row");
    expect(css).toContain(".wterm-renderer .term-scrollback-row");
    expect(css).toMatch(/background:\s*transparent\s*!important/);
  });

  it("paints a dark reduced-motion loading surface before Ghostty core is ready", () => {
    const css = readFileSync(
      new URL("./wterm-renderer.css", import.meta.url),
      "utf8",
    );
    const source = readFileSync(
      new URL("./wterm-renderer.tsx", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".wterm-renderer--loading");
    expect(css).toContain("var(--term-bg, #1e1e1e)");
    expect(css).toContain("prefers-reduced-motion");
    expect(source).toContain(
      'className="wterm-renderer wterm-renderer--loading"',
    );
    expect(source).toContain('aria-label="Terminal loading"');
    expect(source).toContain('aria-busy="true"');
  });
});

describe("terminal hyperlink activation", () => {
  it("delegates rendered anchors to the BB link opener", () => {
    const source = readFileSync(
      new URL("./wterm-renderer.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("onClick={handleLinkClick}");
    expect(source).toContain("terminalLinkAction(link.href)");
    expect(source).toContain("onLinkClick(link.href)");
  });
});

describe("Ghostty graphics configuration and lifecycle", () => {
  function stubDefaultGhosttyAssets(): () => void {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ token: "fixture" }), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        )
        .mockResolvedValueOnce(new Response(new Uint8Array([0, 97, 115, 109]))),
    );
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:wterm-test");
    return () => {
      createObjectUrl.mockRestore();
      vi.unstubAllGlobals();
    };
  }

  it("hands the preloaded core to the next renderer without loading twice", async () => {
    vi.useFakeTimers();
    const core = {
      dispose: vi.fn(),
      init: vi.fn(),
      mouseTracking: vi.fn(() => 0),
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeString: vi.fn(),
    } as unknown as GhosttyCore;
    const load = vi.spyOn(GhosttyCore, "load").mockResolvedValue(core);
    const restoreAssets = stubDefaultGhosttyAssets();

    try {
      await preloadGhosttyCore();
      expect(await loadGhosttyCore()).toBe(core);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(core.dispose).not.toHaveBeenCalled();
      expect(load).toHaveBeenCalledOnce();
    } finally {
      restoreAssets();
      load.mockRestore();
      vi.useRealTimers();
      disposeGhosttyCore(core);
    }
  });

  it("hands off a preload that is still pending", async () => {
    const core = {
      dispose: vi.fn(),
      init: vi.fn(),
      mouseTracking: vi.fn(() => 0),
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeString: vi.fn(),
    } as unknown as GhosttyCore;
    let resolveCore!: (core: GhosttyCore) => void;
    const load = vi.spyOn(GhosttyCore, "load").mockReturnValue(
      new Promise<GhosttyCore>((resolve) => {
        resolveCore = resolve;
      }),
    );
    const restoreAssets = stubDefaultGhosttyAssets();

    try {
      const preload = preloadGhosttyCore();
      const rendererLoad = loadGhosttyCore();
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      resolveCore(core);
      await expect(rendererLoad).resolves.toBe(core);
      await expect(preload).resolves.toBeUndefined();
      expect(load).toHaveBeenCalledOnce();
    } finally {
      restoreAssets();
      load.mockRestore();
      disposeGhosttyCore(core);
    }
  });

  it("disposes a preloaded core that no renderer consumes", async () => {
    vi.useFakeTimers();
    const core = {
      dispose: vi.fn(),
      init: vi.fn(),
      mouseTracking: vi.fn(() => 0),
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeString: vi.fn(),
    } as unknown as GhosttyCore;
    const load = vi.spyOn(GhosttyCore, "load").mockResolvedValue(core);
    const restoreAssets = stubDefaultGhosttyAssets();

    try {
      await preloadGhosttyCore();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(core.dispose).toHaveBeenCalledOnce();
      expect(load).toHaveBeenCalledOnce();
    } finally {
      restoreAssets();
      load.mockRestore();
      vi.useRealTimers();
    }
  });

  it("starts standalone core preload before opening a new PTY", () => {
    const source = readFileSync(
      new URL("./herdr-panel.tsx", import.meta.url),
      "utf8",
    );
    const labelIndex = source.indexOf('aria-label="New terminal"');
    const handler = source.slice(
      source.lastIndexOf("<button", labelIndex),
      source.indexOf("</button>", labelIndex),
    );
    const preloadIndex = handler.indexOf("preloadTerminalPanel()");
    const createIndex = handler.indexOf("createTerminal()");
    expect(labelIndex).toBeGreaterThan(-1);
    expect(preloadIndex).toBeGreaterThan(-1);
    expect(createIndex).toBeGreaterThan(-1);
    expect(preloadIndex).toBeLessThan(createIndex);
  });

  it("keeps Kitty storage bounded and uses the terminal dark palette", () => {
    expect(ghosttyCoreOptions("/ghostty-vt.wasm")).toEqual({
      wasmPath: "/ghostty-vt.wasm",
      scrollbackLimit: 1024 * 1024,
      foregroundColor: "#d4d4d4",
      backgroundColor: "#1e1e1e",
      imageStorageLimit: 32 * 1024 * 1024,
    });
  });

  it("disposes one core at most once across repeated React cleanups", () => {
    const core = { dispose: vi.fn() };
    disposeGhosttyCore(core);
    disposeGhosttyCore(core);
    expect(core.dispose).toHaveBeenCalledOnce();
  });

  it("keeps image sizing delegated to the upstream terminal surface", () => {
    const source = readFileSync(
      new URL("./wterm-renderer.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("autoResize");
    expect(source).toContain(
      "imageStorageLimit: GHOSTTY_IMAGE_STORAGE_LIMIT_BYTES",
    );
    expect(source).not.toContain("maxImageWidth={window");
    expect(source).not.toContain("maxImageHeight={window");
  });
});

describe("computeFollowBottom", () => {
  it("is false when the inner scroller is not at the bottom", () => {
    expect(
      computeFollowBottom({
        clientHeight: 100,
        scrollHeight: 400,
        scrollTop: 0,
      }),
    ).toBe(false);
  });

  it("is true within 1px of the bottom", () => {
    expect(
      computeFollowBottom({
        clientHeight: 100,
        scrollHeight: 400,
        scrollTop: 299,
      }),
    ).toBe(true);
  });

  it("tracks instance.element and does not force bottom while reading history", () => {
    const source = readFileSync(
      new URL("./wterm-renderer.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("const scroller = instance.element;");
    expect(source).toContain('scroller.addEventListener("scroll", onScroll');
    expect(source).toContain("if (element && shouldRestoreBottom)");
    expect(source).not.toContain("onScroll=");
  });
});

describe("DEC 1003 any-event mouse motion", () => {
  const point = { col: 7, row: 4 };

  it("encodes one-based SGR no-button motion with modifiers", () => {
    expect(
      encodeAnyEventMouseMove({
        active: true,
        altKey: true,
        buttons: 0,
        cell: point,
        ctrlKey: true,
        previous: null,
        shiftKey: false,
      }),
    ).toBe("\x1b[<59;8;5M");
  });

  it("skips duplicate cells, button drags, shift selection, and inactive mode", () => {
    const input = {
      active: true,
      altKey: false,
      buttons: 0,
      cell: point,
      ctrlKey: false,
      previous: point,
      shiftKey: false,
    };
    expect(encodeAnyEventMouseMove(input)).toBeNull();
    expect(
      encodeAnyEventMouseMove({ ...input, previous: null, buttons: 1 }),
    ).toBeNull();
    expect(
      encodeAnyEventMouseMove({ ...input, previous: null, shiftKey: true }),
    ).toBeNull();
    expect(
      encodeAnyEventMouseMove({ ...input, previous: null, active: false }),
    ).toBeNull();
  });
});

describe("OSC 52 from TUI output", () => {
  it("queues remote clipboard data without treating TUI output as consent", () => {
    const execCommand = vi.fn(() => true);
    const onClipboardRequest = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(),
      execCommand,
      body: { append: vi.fn() },
    });

    const core = {
      init: vi.fn(),
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeString: vi.fn(),
      mouseTracking: vi.fn(() => 0),
    };
    const wrapped = supportAnyEventMouseMode(core as never, onClipboardRequest);
    wrapped.writeString(`\x1b]52;c;${btoa("herdr")}`);

    expect(onClipboardRequest).toHaveBeenCalledWith("herdr");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("keeps clipboard requests isolated between renderer cores", () => {
    const coreFixture = () => ({
      init: vi.fn(),
      resize: vi.fn(),
      writeRaw: vi.fn(),
      writeString: vi.fn(),
      mouseTracking: vi.fn(() => 0),
    });
    const requestsA: string[] = [];
    const requestsB: string[] = [];
    const wrappedA = supportAnyEventMouseMode(
      coreFixture() as never,
      (text) => {
        requestsA.push(text);
      },
    );
    const wrappedB = supportAnyEventMouseMode(
      coreFixture() as never,
      (text) => {
        requestsB.push(text);
      },
    );

    wrappedA.writeString(`\x1b]52;c;${btoa("panel-a")}\x07`);
    wrappedB.writeString(`\x1b]52;c;${btoa("panel-b")}\x07`);

    expect(requestsA).toEqual(["panel-a"]);
    expect(requestsB).toEqual(["panel-b"]);
  });
});
