import { describe, expect, it, vi } from "vitest";
import { clearTerminalSelection } from "./wterm-renderer";

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
