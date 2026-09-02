import { describe, expect, it } from "vitest";
import {
  cellAtPoint,
  extractViewportText,
  selectionMoved,
  type SelectionCell,
} from "./terminal-selection";

function cell(char: string, width = 1): SelectionCell {
  return {
    char: char.codePointAt(0) ?? 32,
    width,
  };
}

function grid(lines: string[]) {
  return {
    getCols: () => lines[0]?.length ?? 0,
    getRows: () => lines.length,
    getCell(row: number, col: number): SelectionCell {
      return cell(lines[row]?.[col] ?? " ");
    },
  };
}

describe("cellAtPoint", () => {
  const layout = {
    charWidth: 10,
    cols: 8,
    originLeft: 100,
    originTop: 50,
    rowHeight: 20,
    rows: 4,
  };

  it("maps a pointer into the containing cell", () => {
    expect(cellAtPoint(layout, 121, 71)).toEqual({ col: 2, row: 1 });
  });

  it("rejects points outside the grid", () => {
    expect(cellAtPoint(layout, 99, 71)).toBeNull();
    expect(cellAtPoint(layout, 121, 200)).toBeNull();
  });
});

describe("extractViewportText", () => {
  it("copies a forward and reverse range as line-oriented text", () => {
    const source = grid(["abcdef", "ghijkl"]);
    expect(
      extractViewportText(source, { col: 1, row: 0 }, { col: 3, row: 1 }),
    ).toBe("bcdef\nghij");
    expect(
      extractViewportText(source, { col: 3, row: 1 }, { col: 1, row: 0 }),
    ).toBe("bcdef\nghij");
  });

  it("trims trailing spaces and skips wide-cell continuations", () => {
    const source = {
      getCols: () => 4,
      getRows: () => 1,
      getCell(row: number, col: number): SelectionCell {
        if (row !== 0) return cell(" ");
        if (col === 0) return { ...cell("あ"), width: 2 };
        if (col === 1) return { ...cell(""), width: 0 };
        if (col === 2) return cell("x");
        return cell(" ");
      },
    };
    expect(
      extractViewportText(source, { col: 0, row: 0 }, { col: 3, row: 0 }),
    ).toBe("あx");
  });
});

describe("selectionMoved", () => {
  it("requires the pointer to change cells", () => {
    expect(
      selectionMoved({ col: 1, row: 1 }, { col: 1, row: 1 }),
    ).toBe(false);
    expect(
      selectionMoved({ col: 1, row: 1 }, { col: 2, row: 1 }),
    ).toBe(true);
  });
});
