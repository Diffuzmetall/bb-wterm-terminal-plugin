export interface GridPoint {
  col: number;
  row: number;
}

export interface CellLayout {
  charWidth: number;
  cols: number;
  originLeft: number;
  originTop: number;
  rowHeight: number;
  rows: number;
}

export interface SelectionCell {
  char: number;
  chars?: string;
  width?: number;
}

export interface ViewportTextSource {
  getCell(row: number, col: number): SelectionCell;
  getCols(): number;
  getRows(): number;
}

export interface TerminalDomSelection<NodeValue> {
  getRangeAt(index: number): {
    cloneRange?(): {
      setEnd(container: NodeValue, offset: number): void;
      setStart(container: NodeValue, offset: number): void;
      toString(): string;
    };
    endContainer: NodeValue;
    startContainer: NodeValue;
  };
  isCollapsed: boolean;
  rangeCount: number;
  toString(): string;
}

/** Return selected terminal text, clipped when a drag ends outside it. */
export function selectedTerminalText<NodeValue>(
  terminal: {
    childNodes?: { length: number };
    contains(node: NodeValue): boolean;
  },
  selection: TerminalDomSelection<NodeValue> | null,
): string | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const startInside = terminal.contains(range.startContainer);
  const endInside = terminal.contains(range.endContainer);
  if (!startInside && !endInside) {
    return null;
  }
  let text = selection.toString();
  if (startInside !== endInside) {
    const scopedRange = range.cloneRange?.();
    const terminalLength = terminal.childNodes?.length;
    if (!scopedRange || terminalLength === undefined) return null;
    if (startInside) {
      scopedRange.setEnd(terminal as NodeValue, terminalLength);
    } else {
      scopedRange.setStart(terminal as NodeValue, 0);
    }
    text = scopedRange.toString();
  }
  return text.length > 0 ? text : null;
}

export function cellAtPoint(
  layout: CellLayout,
  clientX: number,
  clientY: number,
): GridPoint | null {
  if (layout.charWidth <= 0 || layout.rowHeight <= 0) return null;
  if (layout.cols <= 0 || layout.rows <= 0) return null;
  const col = Math.floor((clientX - layout.originLeft) / layout.charWidth);
  const row = Math.floor((clientY - layout.originTop) / layout.rowHeight);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) {
    return null;
  }
  return { col, row };
}

export function cellAtPointClamped(
  layout: CellLayout,
  clientX: number,
  clientY: number,
): GridPoint | null {
  if (layout.charWidth <= 0 || layout.rowHeight <= 0) return null;
  if (layout.cols <= 0 || layout.rows <= 0) return null;
  const col = Math.floor((clientX - layout.originLeft) / layout.charWidth);
  const row = Math.floor((clientY - layout.originTop) / layout.rowHeight);
  return {
    col: Math.max(0, Math.min(layout.cols - 1, col)),
    row: Math.max(0, Math.min(layout.rows - 1, row)),
  };
}

export function cellText(cell: SelectionCell): string {
  if (cell.width === 0) return "";
  if (cell.chars && cell.chars.length > 0) return cell.chars;
  if (!cell.char) return " ";
  try {
    return String.fromCodePoint(cell.char);
  } catch {
    return " ";
  }
}

function comparePoints(left: GridPoint, right: GridPoint): number {
  return left.row === right.row ? left.col - right.col : left.row - right.row;
}

export function extractViewportText(
  source: ViewportTextSource,
  start: GridPoint,
  end: GridPoint,
): string {
  const cols = source.getCols();
  const rows = source.getRows();
  if (cols <= 0 || rows <= 0) return "";

  const first = comparePoints(start, end) <= 0 ? start : end;
  const last = first === start ? end : start;
  const fromRow = Math.max(0, Math.min(rows - 1, first.row));
  const toRow = Math.max(0, Math.min(rows - 1, last.row));
  const lines: string[] = [];

  for (let row = fromRow; row <= toRow; row += 1) {
    const fromCol = row === fromRow ? Math.max(0, first.col) : 0;
    const toCol = row === toRow ? Math.min(cols - 1, last.col) : cols - 1;
    let line = "";
    for (let col = fromCol; col <= toCol; col += 1) {
      line += cellText(source.getCell(row, col));
    }
    lines.push(line.replace(/ +$/u, ""));
  }

  return lines.join("\n");
}

export function selectionMoved(start: GridPoint, end: GridPoint): boolean {
  return start.col !== end.col || start.row !== end.row;
}
