import { describe, expect, it, vi } from "vitest";
import {
  clearTerminalSelection,
  isUsableTerminalSize,
  shouldApplyTerminalResize,
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

    expect(
      clearTerminalSelection(fixture.terminal, fixture.selection),
    ).toBe(true);
    expect(fixture.removeAllRanges).toHaveBeenCalledOnce();
  });

  it("leaves selections outside the terminal alone", () => {
    const fixture = selectionFixture({ start: "outside" });

    expect(
      clearTerminalSelection(fixture.terminal, fixture.selection),
    ).toBe(false);
    expect(fixture.removeAllRanges).not.toHaveBeenCalled();
  });

  it("leaves collapsed selections alone", () => {
    const fixture = selectionFixture({ collapsed: true });

    expect(
      clearTerminalSelection(fixture.terminal, fixture.selection),
    ).toBe(false);
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
});
