import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  clearTerminalSelection,
  isUsableTerminalSize,
  shouldApplyTerminalResize,
  shouldClearSelectionOnWheel,
  computeFollowBottom,
  encodeAnyEventMouseMove,
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
    expect(encodeAnyEventMouseMove({ ...input, previous: null, buttons: 1 })).toBeNull();
    expect(encodeAnyEventMouseMove({ ...input, previous: null, shiftKey: true })).toBeNull();
    expect(encodeAnyEventMouseMove({ ...input, previous: null, active: false })).toBeNull();
  });
});

describe("OSC 52 from TUI output", () => {
  it("attempts a synchronous clipboard copy immediately", () => {
    const execCommand = vi.fn(() => true);
    const field = {
      value: "",
      style: { position: "", left: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: () => field,
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
    const wrapped = supportAnyEventMouseMode(core as never);
    wrapped.writeString(`\x1b]52;c;${btoa("herdr")}`);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(field.value).toBe("herdr");
  });
});
