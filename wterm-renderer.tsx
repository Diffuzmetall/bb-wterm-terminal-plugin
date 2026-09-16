import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle } from "@wterm/react";
import type { TerminalAttachment } from "./terminal-attachment.js";
import {
  markWtermPerformance,
  wtermPerformance,
  WtermStreamDigest,
} from "./wterm-performance.ts";
import { terminalLinkAction, terminalLinkHref } from "./terminal-links.js";
import { attachTerminalAutoLinksWhenReady } from "./terminal-autolink-dom.js";
import { getPluginToken } from "./plugin-token.js";
import {
  Osc52ClipboardFilter,
  approveClipboardText,
  copyTextToClipboard,
} from "./osc52-clipboard.js";
import { createRetryablePromiseCache } from "./retryable-cache.js";
import {
  cellAtPoint,
  cellAtPointClamped,
  extractViewportText,
  selectedTerminalText,
  selectionMoved,
  type CellLayout,
  type GridPoint,
} from "./terminal-selection.js";
import "@wterm/react/css";
import "./wterm-renderer.css";

const PLUGIN_ID = "wterm-terminal-preview";
export const GHOSTTY_WASM_URL = `/api/v1/plugins/${PLUGIN_ID}/http/ghostty-vt.wasm`;
export const NERD_FONT_URL = `/api/v1/plugins/${PLUGIN_ID}/http/symbols-nerd-font-mono-v3.5.0.woff2`;
export const NERD_FONT_FAMILY = "Wterm Symbols Nerd Font Mono";
export const GHOSTTY_SCROLLBACK_LIMIT_BYTES = 1024 * 1024;
export const GHOSTTY_IMAGE_STORAGE_LIMIT_BYTES = 32 * 1024 * 1024;
export const GHOSTTY_FOREGROUND_COLOR = "#d4d4d4";
export const GHOSTTY_BACKGROUND_COLOR = "#1e1e1e";
const nerdFontLoads = new WeakMap<object, Promise<void>>();
const disposedCores = new WeakSet<object>();
const anyEventMouseModes = new WeakMap<
  object,
  { enabled: boolean; generation: number }
>();
type AnyEventCore = Parameters<typeof anyEventMouseModes.get>[0];
const MIN_USABLE_TERMINAL_CELLS = 2;
const TERMINAL_RESIZE_SETTLE_MS = 250;
const MAX_WHEEL_SCROLL_ROWS = 3;

export interface TerminalResizeDecision {
  /** Whether the PTY should be told about this size at all. */
  send: boolean;
  /** 0 reaches the PTY at once; a positive value coalesces animation frames. */
  delayMs: number;
}

/**
 * The first valid resize after a core (re)load reaches the PTY immediately, so
 * the shell never keeps running at the pre-layout size. Later resizes wait for
 * BB's 220ms panel animation, so TUIs do not paint a series of intermediate
 * SIGWINCH frames over the changing grid.
 */
export function decideTerminalResize(
  sizeIsApplicable: boolean,
  sizeChanged: boolean,
  initialResizeSent: boolean,
): TerminalResizeDecision {
  if (!sizeIsApplicable || !sizeChanged) return { send: false, delayMs: 0 };
  return {
    send: true,
    delayMs: initialResizeSent ? TERMINAL_RESIZE_SETTLE_MS : 0,
  };
}

/**
 * Hidden plugin tabs collapse to 0×0. `@wterm/dom` then does
 * `Math.max(1, floor(0 / cell))` and resizes Ghostty to 1×1, which reflows a
 * TUI like Herdr into stacked duplicates. Ignore that collapsed size.
 */
export function isUsableTerminalSize(cols: number, rows: number): boolean {
  return (
    Number.isSafeInteger(cols) &&
    Number.isSafeInteger(rows) &&
    cols >= MIN_USABLE_TERMINAL_CELLS &&
    rows >= MIN_USABLE_TERMINAL_CELLS
  );
}

export function shouldClearSelectionOnWheel(
  selection: { isCollapsed: boolean } | null,
): boolean {
  return Boolean(selection && !selection.isCollapsed);
}

export function shouldApplyTerminalResize(
  cols: number,
  rows: number,
  hasSize: boolean,
): boolean {
  return hasSize && isUsableTerminalSize(cols, rows);
}

export function computeFollowBottom(element: {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
}

/** Keep wheel notches bounded while preserving small pixel deltas from trackpads. */
export function terminalWheelDelta(
  deltaY: number,
  deltaMode: number,
  rowHeight: number,
  clientHeight: number,
): number {
  if (
    !Number.isFinite(deltaY) ||
    !Number.isFinite(rowHeight) ||
    rowHeight <= 0
  ) {
    return 0;
  }
  const unit =
    deltaMode === 1
      ? rowHeight
      : deltaMode === 2 && Number.isFinite(clientHeight) && clientHeight > 0
        ? clientHeight
        : 1;
  const pixels = deltaY * unit;
  const limit = rowHeight * MAX_WHEEL_SCROLL_ROWS;
  return Math.sign(pixels) * Math.min(Math.abs(pixels), limit);
}

export function getAnyEventMouseModeState(core: AnyEventCore): {
  enabled: boolean;
  generation: number;
} {
  return anyEventMouseModes.get(core) ?? { enabled: false, generation: 0 };
}

export function encodeAnyEventMouseMove({
  active,
  altKey,
  buttons,
  cell,
  ctrlKey,
  previous,
  shiftKey,
}: {
  active: boolean;
  altKey: boolean;
  buttons: number;
  cell: GridPoint;
  ctrlKey: boolean;
  previous: GridPoint | null;
  shiftKey: boolean;
}): string | null {
  if (
    !active ||
    buttons !== 0 ||
    shiftKey ||
    (previous?.col === cell.col && previous.row === cell.row)
  ) {
    return null;
  }
  const modifiers = (altKey ? 8 : 0) | (ctrlKey ? 16 : 0);
  return `\x1b[<${35 | modifiers};${cell.col + 1};${cell.row + 1}M`;
}

/**
 * Ghostty WASM 0.5.0 still discards mode 1003 before `mouseTracking()` can
 * expose it. Track that one DEC mode at the write boundary, then let Wterm DOM
 * provide its supported click, wheel, and button-drag subset through mode 1002.
 */
export function supportAnyEventMouseMode(
  core: GhosttyCore,
  onClipboardRequest: (text: string) => void = () => {},
): GhosttyCore {
  const decodeMouseControl = new TextDecoder("latin1");
  const writeRaw = core.writeRaw.bind(core);
  const writeString = core.writeString.bind(core);
  const initCore = core.init.bind(core);
  const resizeCore = core.resize.bind(core);
  const supportedMode = core.mouseTracking.bind(core);
  const getCell = core.getCell?.bind(core);
  const getScrollbackCell = core.getScrollbackCell?.bind(core);
  const decorateCell = <Cell extends { linkUri?: string }>(
    cell: Cell,
  ): Cell => {
    const href = terminalLinkHref(cell.linkUri);
    return href === cell.linkUri ? cell : ({ ...cell, linkUri: href } as Cell);
  };
  const osc52 = new Osc52ClipboardFilter(onClipboardRequest);
  let anyEventMouse = false;
  let anyEventGeneration = 0;
  let controlTail = "";
  let initialized = false;
  anyEventMouseModes.set(core, {
    enabled: anyEventMouse,
    generation: anyEventGeneration,
  });

  const observeMouseMode = (text: string) => {
    const control = controlTail + text;
    let nextAnyEventMouse = anyEventMouse;
    for (const match of control.matchAll(/\x1b\[\?([0-9;]*)([hl])/g)) {
      const modes = match[1]?.split(";") ?? [];
      for (const mode of modes) {
        if (
          match[2] === "h" &&
          (mode === "9" ||
            mode === "1000" ||
            mode === "1001" ||
            mode === "1002" ||
            mode === "1003")
        ) {
          nextAnyEventMouse = mode === "1003";
        } else if (match[2] === "l" && mode === "1003") {
          nextAnyEventMouse = false;
        }
        if (
          match[2] === "l" &&
          (mode === "47" || mode === "1047" || mode === "1049")
        ) {
          nextAnyEventMouse = false;
        }
      }
    }
    if (nextAnyEventMouse !== anyEventMouse) {
      anyEventMouse = nextAnyEventMouse;
      anyEventGeneration += 1;
      anyEventMouseModes.set(core, {
        enabled: anyEventMouse,
        generation: anyEventGeneration,
      });
    }
    controlTail = control.slice(-64);
  };

  core.init = (cols, rows) => {
    if (!isUsableTerminalSize(cols, rows)) return;
    if (initialized) {
      resizeCore(cols, rows);
      return;
    }
    initCore(cols, rows);
    initialized = true;
  };
  core.resize = (cols, rows) => {
    if (!isUsableTerminalSize(cols, rows)) return;
    if (!initialized) {
      initCore(cols, rows);
      initialized = true;
      return;
    }
    resizeCore(cols, rows);
  };
  core.writeRaw = (data, afterChunk) => {
    let filtered = data;
    try {
      filtered = osc52.consumeBytes(data);
      if (controlTail.length > 0 || filtered.indexOf(0x1b) >= 0) {
        observeMouseMode(decodeMouseControl.decode(filtered));
      }
    } catch {
      filtered = data;
    }
    writeRaw(filtered, afterChunk);
  };
  core.writeString = (data, afterChunk) => {
    let filtered = data;
    try {
      filtered = osc52.consumeString(data);
      if (controlTail.length > 0 || filtered.includes("\x1b")) {
        observeMouseMode(filtered);
      }
    } catch {
      filtered = data;
    }
    writeString(filtered, afterChunk);
  };
  core.mouseTracking = () => (anyEventMouse ? 1002 : supportedMode());
  if (getCell) {
    core.getCell = (row, col) => decorateCell(getCell(row, col));
  }
  if (getScrollbackCell) {
    core.getScrollbackCell = (offset, col) =>
      decorateCell(getScrollbackCell(offset, col));
  }
  return core;
}

export function ghosttyCoreOptions(wasmPath: string) {
  return {
    wasmPath,
    scrollbackLimit: GHOSTTY_SCROLLBACK_LIMIT_BYTES,
    foregroundColor: GHOSTTY_FOREGROUND_COLOR,
    backgroundColor: GHOSTTY_BACKGROUND_COLOR,
    imageStorageLimit: GHOSTTY_IMAGE_STORAGE_LIMIT_BYTES,
  };
}

export function disposeGhosttyCore(
  core: Pick<GhosttyCore, "dispose"> | null,
): void {
  if (!core || disposedCores.has(core)) return;
  disposedCores.add(core);
  core.dispose();
}

const pluginToken = getPluginToken;
const GHOSTTY_CORE_PRELOAD_TTL_MS = 10_000;

type PreloadedGhosttyCore = {
  promise: Promise<GhosttyCore>;
  disposeTimer: ReturnType<typeof setTimeout> | null;
};

let preloadedGhosttyCore: PreloadedGhosttyCore | null = null;

const ghosttyWasmObjectUrl = createRetryablePromiseCache(async () => {
  const response = await fetch(GHOSTTY_WASM_URL, {
    headers: { "x-bb-plugin-token": await pluginToken() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`WASM request failed (HTTP ${response.status})`);
  }
  return URL.createObjectURL(
    new Blob([await response.arrayBuffer()], { type: "application/wasm" }),
  );
});

async function createDefaultGhosttyCore(): Promise<GhosttyCore> {
  return GhosttyCore.load(ghosttyCoreOptions(await ghosttyWasmObjectUrl()));
}

function ghosttyCorePreloadDisabled(): boolean {
  if (!wtermPerformance.enabled || typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("wterm_preload") === "0"
  );
}

export function preloadGhosttyCore(): Promise<void> {
  if (ghosttyCorePreloadDisabled()) return Promise.resolve();
  if (!preloadedGhosttyCore) {
    const slot: PreloadedGhosttyCore = {
      promise: createDefaultGhosttyCore(),
      disposeTimer: null,
    };
    preloadedGhosttyCore = slot;
    void slot.promise.then(
      (core) => {
        if (preloadedGhosttyCore !== slot) return;
        markWtermPerformance("preload-ready");
        slot.disposeTimer = setTimeout(() => {
          if (preloadedGhosttyCore !== slot) return;
          preloadedGhosttyCore = null;
          disposeGhosttyCore(core);
        }, GHOSTTY_CORE_PRELOAD_TTL_MS);
      },
      () => {
        if (preloadedGhosttyCore === slot) preloadedGhosttyCore = null;
      },
    );
  }
  return preloadedGhosttyCore.promise.then(() => undefined);
}

async function takeDefaultGhosttyCore(): Promise<GhosttyCore> {
  const slot = preloadedGhosttyCore;
  if (!slot) return createDefaultGhosttyCore();
  preloadedGhosttyCore = null;
  if (slot.disposeTimer !== null) clearTimeout(slot.disposeTimer);
  return slot.promise;
}

export async function loadGhosttyCore(
  wasmUrl = GHOSTTY_WASM_URL,
  onClipboardRequest: (text: string) => void = () => {},
): Promise<GhosttyCore> {
  if (wasmUrl !== GHOSTTY_WASM_URL) {
    return supportAnyEventMouseMode(
      await GhosttyCore.load(ghosttyCoreOptions(wasmUrl)),
      onClipboardRequest,
    );
  }
  return supportAnyEventMouseMode(
    await takeDefaultGhosttyCore(),
    onClipboardRequest,
  );
}

export async function preloadTerminalAssets(): Promise<void> {
  if (ghosttyCorePreloadDisabled()) return;
  await Promise.all([preloadGhosttyCore(), loadNerdFont()]);
}

export async function loadNerdFont(
  fontFaceSet: Pick<FontFaceSet, "add"> = document.fonts,
): Promise<void> {
  const key = fontFaceSet as object;
  const cached = nerdFontLoads.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const response = await fetch(NERD_FONT_URL, {
      headers: { "x-bb-plugin-token": await pluginToken() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`font request failed (HTTP ${response.status})`);
    }
    const face = new FontFace(NERD_FONT_FAMILY, await response.arrayBuffer(), {
      style: "normal",
      weight: "400",
    });
    fontFaceSet.add(await face.load());
  })();
  const retryable = pending.catch((error: unknown) => {
    nerdFontLoads.delete(key);
    throw error;
  });
  nerdFontLoads.set(key, retryable);
  return retryable;
}

export function hasRenderedSize(element: HTMLElement): boolean {
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

type SelectionLike<NodeValue> = {
  getRangeAt(index: number): {
    endContainer: NodeValue;
    startContainer: NodeValue;
  };
  isCollapsed: boolean;
  rangeCount: number;
  removeAllRanges(): void;
};

export function clearTerminalSelection<NodeValue>(
  terminal: { contains(node: NodeValue): boolean },
  selection: SelectionLike<NodeValue> | null,
): boolean {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (
    !terminal.contains(range.startContainer) &&
    !terminal.contains(range.endContainer)
  ) {
    return false;
  }
  selection.removeAllRanges();
  return true;
}

interface WtermFontMetricsBoundary {
  cols: number;
  element: HTMLElement;
  rows: number;
  resize(cols: number, rows: number): void;
  _measureCharSize?: () => { charWidth: number; rowHeight: number } | null;
}

export function terminalCellLayout(
  terminal: WtermFontMetricsBoundary,
): CellLayout | null {
  const metrics = terminal._measureCharSize?.();
  if (!metrics || !hasRenderedSize(terminal.element)) return null;
  const viewportRow = terminal.element.querySelector(
    ".term-row:not(.term-scrollback-row)",
  );
  const rowRect = viewportRow?.getBoundingClientRect();
  const hostRect = terminal.element.getBoundingClientRect();
  return {
    charWidth: metrics.charWidth,
    cols: terminal.cols,
    originLeft: rowRect?.left ?? hostRect.left,
    originTop: rowRect?.top ?? hostRect.top,
    rowHeight: metrics.rowHeight,
    rows: terminal.rows,
  };
}

export function refitTerminalAfterFontChange(
  instance: NonNullable<TerminalHandle["instance"]>,
): boolean {
  // SAFETY: Wterm exposes the font metrics fields consumed by this helper.
  const terminal = instance as unknown as WtermFontMetricsBoundary;
  const metrics = terminal._measureCharSize?.();
  if (!metrics || !hasRenderedSize(terminal.element)) return false;

  const style = getComputedStyle(terminal.element);
  const contentWidth =
    terminal.element.clientWidth -
    (Number.parseFloat(style.paddingLeft) || 0) -
    (Number.parseFloat(style.paddingRight) || 0);
  const contentHeight =
    terminal.element.clientHeight -
    (Number.parseFloat(style.paddingTop) || 0) -
    (Number.parseFloat(style.paddingBottom) || 0);
  const cols = Math.max(0, Math.floor(contentWidth / metrics.charWidth));
  const rows = Math.max(0, Math.floor(contentHeight / metrics.rowHeight));
  if (!isUsableTerminalSize(cols, rows)) return false;
  if (cols === terminal.cols && rows === terminal.rows) return false;

  terminal.resize(cols, rows);
  return true;
}

/**
 * Write failures are split by what actually broke:
 *
 * - `response`: `@wterm/dom` applies the whole chunk to the core and only then
 *   rethrows the first error raised while delivering terminal responses. The
 *   screen is correct; the PTY is missing a response it may be waiting for.
 * - `core`: anything else, including a WASM trap inside the bridge, which
 *   writes in 8 KiB slices and can therefore leave part of a chunk applied.
 *   The visible screen can no longer be trusted.
 */
export type WtermWriteFailurePhase = "live" | "drain";
export type WtermWriteFailureKind = "core" | "response";

export interface WtermWriteFailure {
  phase: WtermWriteFailurePhase;
  kind: WtermWriteFailureKind;
  /** Sequence of the chunk that threw, when the attachment supplied one. */
  seq: number | null;
  bytes: number;
  generation: number;
  /** Chunks discarded in that batch because the failure stopped the drain. */
  dropped: number;
  /** Constructor name only: never the message, which can carry PTY payload. */
  errorName: string;
}

/** Tagged replacement for errors raised by our own response delivery. */
export class WtermResponseDeliveryError extends Error {
  constructor() {
    super("terminal response delivery failed");
  }
}

export function classifyWtermWriteFailure(
  error: unknown,
): WtermWriteFailureKind {
  return error instanceof WtermResponseDeliveryError ? "response" : "core";
}

/** Metadata-only failure record: no message, no stack, no chunk payload. */
export function wtermWriteFailureMetadata(input: {
  phase: WtermWriteFailurePhase;
  kind: WtermWriteFailureKind;
  seq: number | null;
  bytes: number;
  generation: number;
  dropped: number;
  error: unknown;
}): WtermWriteFailure {
  const name =
    input.error instanceof Error && input.error.name
      ? input.error.name
      : "NonError";
  return {
    phase: input.phase,
    kind: input.kind,
    seq: input.seq,
    bytes: input.bytes,
    generation: input.generation,
    dropped: input.dropped,
    errorName: name.slice(0, 40),
  };
}

/**
 * Diagnostic-only fault injection for the real-browser failure smoke test.
 * Inert unless `?wterm_perf=1&wterm_write_fault=<kind>@<phase>` is present, so
 * the failure path is reachable without a real WASM fault.
 */
export interface WtermWriteFault {
  kind: WtermWriteFailureKind;
  phase: WtermWriteFailurePhase;
}

export function parseWtermWriteFault(
  query: string,
  enabled: boolean,
): WtermWriteFault | null {
  if (!enabled) return null;
  let raw: string | null;
  try {
    raw = new URLSearchParams(query).get("wterm_write_fault");
  } catch {
    return null;
  }
  for (const kind of ["core", "response"] as const) {
    for (const phase of ["live", "drain"] as const) {
      if (raw === `${kind}@${phase}`) return { kind, phase };
    }
  }
  return null;
}

const wtermWriteFault = parseWtermWriteFault(
  globalThis.location?.search ?? "",
  wtermPerformance.enabled,
);
let writeFaultArmed = wtermWriteFault !== null;

/** Diagnostic-only: throw where the core (or its response drain) would. */
function throwInjectedWriteFault(
  kind: WtermWriteFailureKind,
  phase: WtermWriteFailurePhase,
): void {
  if (!writeFaultArmed || wtermWriteFault === null) return;
  if (wtermWriteFault.kind !== kind || wtermWriteFault.phase !== phase) return;
  writeFaultArmed = false;
  if (kind === "response") throw new WtermResponseDeliveryError();
  throw new Error("injected core write failure");
}

type TerminalFontStyle = CSSProperties & {
  "--term-font-family": string;
  "--term-font-size": string;
  "--term-row-height": string;
};

export function WtermRenderer({
  attachment,
  fontSizePx = 14,
  onLinkClick,
  wasmUrl = GHOSTTY_WASM_URL,
}: {
  attachment: TerminalAttachment;
  fontSizePx?: number;
  onLinkClick?: (href: string) => boolean;
  wasmUrl?: string;
}) {
  const terminalRef = useRef<TerminalHandle>(null);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  type ClipboardRequest = { text: string };
  const [clipboardRequest, setClipboardRequest] =
    useState<ClipboardRequest | null>(null);
  const clearSelectionBoundaryRef = useRef<(() => void) | null>(null);
  const tuiCopyDragCleanupRef = useRef<(() => void) | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const initialResizeSentRef = useRef(false);
  const paintFrameRef = useRef<number | null>(null);
  const lastResizeRef = useRef({ cols: 0, rows: 0 });
  const writesOpenRef = useRef(false);
  const pendingWritesRef = useRef<
    Array<{ seq: number | null; bytes: Uint8Array }>
  >([]);
  const streamDigestRef = useRef<WtermStreamDigest | null>(null);
  const writeFailureRef = useRef<WtermWriteFailure | null>(null);
  const writeStopRef = useRef(false);
  const droppedWritesRef = useRef(0);
  const firstDeliveredSeqRef = useRef<number | null>(null);
  const [writeFailure, setWriteFailure] = useState<WtermWriteFailure | null>(
    null,
  );
  const readyRef = useRef(false);
  const tuiDragRef = useRef<{
    layout: CellLayout;
    start: GridPoint;
  } | null>(null);
  const anyEventLayoutRef = useRef<CellLayout | null>(null);
  const anyEventModeGenerationRef = useRef(-1);
  const lastAnyEventCellRef = useRef<GridPoint | null>(null);
  const followBottomRef = useRef(true);
  const followScrollCleanupRef = useRef<(() => void) | null>(null);
  const rowHeightPx = Math.ceil(fontSizePx * 1.2);
  const rowHeightPxRef = useRef(rowHeightPx);
  rowHeightPxRef.current = rowHeightPx;
  const terminalFontStyle: TerminalFontStyle = {
    "--term-font-family": `Menlo, Consolas, "DejaVu Sans Mono", "Courier New", "${NERD_FONT_FAMILY}", monospace`,
    "--term-font-size": `${fontSizePx}px`,
    "--term-row-height": `${rowHeightPx}px`,
  };

  const approveClipboardRequest = useCallback(async () => {
    const request = clipboardRequest;
    if (!request) return;
    if (await approveClipboardText(request.text)) {
      setClipboardRequest((current) => (current === request ? null : current));
    }
  }, [clipboardRequest]);

  const generationRef = useRef(0);
  generationRef.current = reloadNonce;

  /**
   * Record a failed write. Metadata only: the exception message can carry PTY
   * payload, so neither the log nor the banner ever includes it.
   */
  const reportWriteFailure = useCallback(
    (
      phase: WtermWriteFailurePhase,
      chunk: { seq: number | null; bytes: number },
      failure: unknown,
      dropped: number,
    ) => {
      const kind = classifyWtermWriteFailure(failure);
      const generation = generationRef.current;
      const previous = writeFailureRef.current;
      const metadata = wtermWriteFailureMetadata({
        phase,
        kind,
        seq: chunk.seq,
        bytes: chunk.bytes,
        generation,
        dropped,
        error: failure,
      });
      writeFailureRef.current = metadata;
      if (kind === "core") {
        // Fail-stop: stop applying the PTY stream and stop presenting the
        // current screen as current. A fresh core is the only recovery this
        // renderer offers; the PTY itself keeps running.
        writeStopRef.current = true;
        writesOpenRef.current = false;
        pendingWritesRef.current = [];
      }
      const firstOfKind =
        previous?.kind !== kind ||
        previous?.phase !== phase ||
        previous?.generation !== generation;
      if (firstOfKind) {
        markWtermPerformance("write-failure", {
          seq: chunk.seq ?? 0,
          bytes: chunk.bytes,
          count: dropped,
        });
        // SAFETY: the record is constructed above and holds no chunk payload.
        console.error("[wterm] terminal write failed", metadata);
      }
      setWriteFailure(metadata);
    },
    [],
  );

  /** Only recovery this renderer owns: a fresh core plus a replayed history. */
  const reloadAfterWriteFailure = useCallback(() => {
    setWriteFailure(null);
    setReloadNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    markWtermPerformance("effect-start");
    let alive = true;
    const onClipboardRequest = (text: string) => {
      if (alive) setClipboardRequest({ text });
    };
    setCore(null);
    setClipboardRequest(null);
    setError(null);
    setReady(false);
    writesOpenRef.current = false;
    pendingWritesRef.current = [];
    writeStopRef.current = false;
    writeFailureRef.current = null;
    droppedWritesRef.current = 0;
    firstDeliveredSeqRef.current = null;
    setWriteFailure(null);
    streamDigestRef.current = wtermPerformance.enabled
      ? new WtermStreamDigest()
      : null;
    lastResizeRef.current = { cols: 0, rows: 0 };
    initialResizeSentRef.current = false;
    void loadNerdFont().catch(() => undefined);
    void loadGhosttyCore(wasmUrl, onClipboardRequest).then(
      (loaded) => {
        if (alive) {
          markWtermPerformance("core-ready");
          setCore(loaded);
        }
      },
      (loadError) => {
        if (alive) setError(loadError);
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadNonce, wasmUrl]);

  useEffect(() => {
    if (!core) return;
    return () => disposeGhosttyCore(core);
  }, [core]);

  readyRef.current = ready;

  useEffect(() => {
    if (!ready) return;
    return attachment.subscribe(({ seq, bytes }) => {
      if (firstDeliveredSeqRef.current === null) {
        firstDeliveredSeqRef.current = seq;
      }
      if (writeStopRef.current) {
        // The surface is already flagged as stale; applying more output would
        // only make the frozen screen look current again.
        droppedWritesRef.current += 1;
        return;
      }
      if (!writesOpenRef.current) {
        pendingWritesRef.current.push({ seq, bytes });
        if (wtermPerformance.enabled) {
          markWtermPerformance("queued", {
            seq,
            bytes: bytes.byteLength,
            count: pendingWritesRef.current.length,
          });
        }
        return;
      }
      try {
        if (wtermPerformance.enabled) {
          markWtermPerformance("write-start", { seq, bytes: bytes.byteLength });
        }
        throwInjectedWriteFault("core", "live");
        terminalRef.current?.write(bytes);
        throwInjectedWriteFault("response", "live");
        if (wtermPerformance.enabled) {
          streamDigestRef.current?.update(bytes);
          markWtermPerformance("write-end", { seq, bytes: bytes.byteLength });
          const digest = streamDigestRef.current?.snapshot();
          if (digest) markWtermPerformance("stream-digest", digest);
          if (paintFrameRef.current !== null) {
            window.cancelAnimationFrame(paintFrameRef.current);
          }
          paintFrameRef.current = window.requestAnimationFrame(() => {
            paintFrameRef.current = null;
            markWtermPerformance("paint", { seq, bytes: bytes.byteLength });
          });
        }
      } catch (failure) {
        // A live write must not unmount the renderer, but it must not be
        // swallowed either: report it, then stop applying the stream.
        reportWriteFailure(
          "live",
          { seq, bytes: bytes.byteLength },
          failure,
          0,
        );
      }
    });
  }, [attachment, ready, reportWriteFailure]);

  useEffect(() => {
    if (!ready) return;
    let paintFrame: number | null = null;
    const rowsFrame = window.requestAnimationFrame(() => {
      const element = terminalRef.current?.instance?.element;
      if (element?.querySelector(".term-row")) {
        markWtermPerformance("first-rows");
      }
      paintFrame = window.requestAnimationFrame(() => {
        markWtermPerformance("first-paint");
      });
    });
    return () => {
      window.cancelAnimationFrame(rowsFrame);
      if (paintFrame !== null) window.cancelAnimationFrame(paintFrame);
    };
  }, [ready]);

  useEffect(() => {
    if (!readyRef.current) return;
    anyEventLayoutRef.current = null;
    lastAnyEventCellRef.current = null;
    const shouldRestoreBottom = followBottomRef.current;
    let settleFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      const instance = terminalRef.current?.instance;
      if (!instance) return;
      refitTerminalAfterFontChange(instance);
      settleFrame = window.requestAnimationFrame(() => {
        const element = terminalRef.current?.instance?.element;
        if (element && shouldRestoreBottom) {
          element.scrollTop = element.scrollHeight;
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (settleFrame !== null) window.cancelAnimationFrame(settleFrame);
    };
  }, [fontSizePx]);

  useEffect(() => {
    if (!ready) return;
    return attachTerminalAutoLinksWhenReady(
      () => terminalRef.current?.instance?.element ?? null,
    );
  }, [ready, reloadNonce]);

  useEffect(
    () => () => {
      clearSelectionBoundaryRef.current?.();
      tuiCopyDragCleanupRef.current?.();
      followScrollCleanupRef.current?.();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }
      if (paintFrameRef.current !== null) {
        window.cancelAnimationFrame(paintFrameRef.current);
      }
    },
    [],
  );

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // WTerm prevents this event when a TUI owns the mouse. Shift-drag and
      // ordinary shell selection remain native and reach this boundary.
      if (event.button !== 0 || event.defaultPrevented) {
        return;
      }

      clearSelectionBoundaryRef.current?.();
      const selectionRoot = event.currentTarget;
      document.documentElement.dataset.wtermNativeSelection = "active";
      selectionRoot.dataset.wtermSelectionActive = "true";

      const clearBoundary = () => {
        window.removeEventListener("mouseup", finishSelection);
        window.removeEventListener("blur", clearBoundary);
        if (clearSelectionBoundaryRef.current === clearBoundary) {
          clearSelectionBoundaryRef.current = null;
          delete document.documentElement.dataset.wtermNativeSelection;
          delete selectionRoot.dataset.wtermSelectionActive;
        }
      };
      const finishSelection = () => {
        const selection = window.getSelection();
        const text = selectedTerminalText(
          terminalRef.current?.instance?.element ?? selectionRoot,
          selection,
        );
        clearBoundary();
        if (text) copyTextToClipboard(text);
      };

      clearSelectionBoundaryRef.current = clearBoundary;
      window.addEventListener("mouseup", finishSelection, { once: true });
      window.addEventListener("blur", clearBoundary, { once: true });
    },
    [],
  );

  const handleTuiCopyDragStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || event.shiftKey) return;
      tuiCopyDragCleanupRef.current?.();
      const instance = terminalRef.current?.instance;
      const bridge = instance?.bridge;
      if (
        !instance ||
        !bridge ||
        typeof bridge.mouseTracking !== "function" ||
        bridge.mouseTracking() === 0
      )
        return;
      const terminalBridge = bridge;
      // SAFETY: Wterm exposes the font metrics fields consumed by this helper.
      const layout = terminalCellLayout(
        instance as unknown as WtermFontMetricsBoundary,
      );
      if (!layout) return;
      const start = cellAtPoint(layout, event.clientX, event.clientY);
      if (!start) return;

      tuiDragRef.current = { layout, start };
      const finish = (up: MouseEvent) => {
        window.removeEventListener("mouseup", finish);
        if (tuiCopyDragCleanupRef.current === cleanup) {
          tuiCopyDragCleanupRef.current = null;
        }
        const drag = tuiDragRef.current;
        tuiDragRef.current = null;
        if (!drag || up.button !== 0) return;
        const end = cellAtPointClamped(drag.layout, up.clientX, up.clientY);
        if (!end || !selectionMoved(drag.start, end)) return;
        if (!end) return;
        const text = extractViewportText(terminalBridge, drag.start, end);
        if (text.length > 0) copyTextToClipboard(text);
      };
      const cleanup = () => {
        window.removeEventListener("mouseup", finish);
        tuiDragRef.current = null;
        if (tuiCopyDragCleanupRef.current === cleanup) {
          tuiCopyDragCleanupRef.current = null;
        }
      };
      tuiCopyDragCleanupRef.current = cleanup;
      window.addEventListener("mouseup", finish);
    },
    [],
  );

  const handleCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      const text = selectedTerminalText(
        terminalRef.current?.instance?.element ?? event.currentTarget,
        window.getSelection(),
      );
      if (!text) return;

      // BB owns copy handlers around plugin surfaces. Stop the event at the
      // terminal boundary so it cannot serialize the surrounding message row.
      event.preventDefault();
      event.stopPropagation();
      event.clipboardData.setData("text/plain", text);
    },
    [],
  );

  const handleAnyEventMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const instance = terminalRef.current?.instance;
      const bridge = instance?.bridge;
      if (!instance || !bridge) return;
      const mode = getAnyEventMouseModeState(bridge);
      if (anyEventModeGenerationRef.current !== mode.generation) {
        anyEventModeGenerationRef.current = mode.generation;
        lastAnyEventCellRef.current = null;
      }
      if (!mode.enabled || !bridge.mouseSgr?.()) return;

      // SAFETY: Wterm exposes the font metrics fields consumed by this helper.
      const layout =
        anyEventLayoutRef.current ??
        terminalCellLayout(instance as unknown as WtermFontMetricsBoundary);
      anyEventLayoutRef.current = layout;
      if (!layout) return;
      const cell = cellAtPoint(layout, event.clientX, event.clientY);
      if (!cell) {
        lastAnyEventCellRef.current = null;
        return;
      }
      const data = encodeAnyEventMouseMove({
        active: mode.enabled,
        altKey: event.altKey,
        buttons: event.buttons,
        cell,
        ctrlKey: event.ctrlKey,
        previous: lastAnyEventCellRef.current,
        shiftKey: event.shiftKey,
      });
      if (!data) return;
      lastAnyEventCellRef.current = cell;
      attachment.sendInput(new TextEncoder().encode(data));
    },
    [attachment],
  );

  const flushPendingWrites = useCallback(() => {
    if (writesOpenRef.current) return;
    writesOpenRef.current = true;
    const pending = pendingWritesRef.current.splice(0);
    if (wtermPerformance.enabled && pending.length > 0) {
      markWtermPerformance("drain-start", { count: pending.length });
    }
    for (const [index, chunk] of pending.entries()) {
      if (writeStopRef.current) return;
      try {
        if (wtermPerformance.enabled) {
          markWtermPerformance("write-start", {
            seq: chunk.seq ?? 0,
            bytes: chunk.bytes.byteLength,
          });
        }
        throwInjectedWriteFault("core", "drain");
        terminalRef.current?.write(chunk.bytes);
        throwInjectedWriteFault("response", "drain");
        if (wtermPerformance.enabled) {
          streamDigestRef.current?.update(chunk.bytes);
          markWtermPerformance("write-end", {
            seq: chunk.seq ?? 0,
            bytes: chunk.bytes.byteLength,
          });
        }
      } catch (failure) {
        reportWriteFailure(
          "drain",
          { seq: chunk.seq, bytes: chunk.bytes.byteLength },
          failure,
          pending.length - index - 1,
        );
        // A core failure stops the replay; an undelivered response does not,
        // because that chunk already reached the core.
        if (writeStopRef.current) return;
      }
    }
    if (wtermPerformance.enabled && pending.length > 0) {
      markWtermPerformance("drain-end", { count: pending.length });
      const digest = streamDigestRef.current?.snapshot();
      if (digest) markWtermPerformance("stream-digest", digest);
    }
  }, [reportWriteFailure]);

  const handleData = useCallback(
    (data: string) => {
      try {
        attachment.sendInput(new TextEncoder().encode(data));
      } catch {
        // @wterm/dom rethrows the first response-delivery error after the chunk
        // was fully applied, so tag it instead of blaming the core.
        throw new WtermResponseDeliveryError();
      }
    },
    [attachment],
  );

  /** Send the size the PTY should settle on, once the grid is real. */
  const sendSettledResize = useCallback(() => {
    const instance = terminalRef.current?.instance;
    if (
      !instance ||
      !hasRenderedSize(instance.element) ||
      (lastResizeRef.current.cols === instance.cols &&
        lastResizeRef.current.rows === instance.rows)
    ) {
      return;
    }
    markWtermPerformance("resize-send", {
      cols: instance.cols,
      rows: instance.rows,
    });
    attachment.sendResize(instance.cols, instance.rows);
    lastResizeRef.current = { cols: instance.cols, rows: instance.rows };
    initialResizeSentRef.current = true;
  }, [attachment]);

  const handleReady = useCallback(() => {
    setReady(true);
    const instance = terminalRef.current?.instance;
    if (!instance) return;
    // SAFETY: Wterm exposes the font metrics fields consumed by this helper.
    anyEventLayoutRef.current = terminalCellLayout(
      instance as unknown as WtermFontMetricsBoundary,
    );
    followScrollCleanupRef.current?.();
    const scroller = instance.element;
    if (scroller) {
      const onScroll = () => {
        followBottomRef.current = computeFollowBottom(scroller);
      };
      const onWheel = (event: WheelEvent) => {
        // Wterm prevents the event first when a TUI has mouse reporting enabled.
        if (
          event.defaultPrevented ||
          event.ctrlKey ||
          event.metaKey ||
          Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ) {
          return;
        }
        const delta = terminalWheelDelta(
          event.deltaY,
          event.deltaMode,
          rowHeightPxRef.current,
          scroller.clientHeight,
        );
        if (delta === 0) return;
        const before = scroller.scrollTop;
        scroller.scrollTop += delta;
        if (scroller.scrollTop !== before) event.preventDefault();
      };
      onScroll();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      scroller.addEventListener("wheel", onWheel, { passive: false });
      followScrollCleanupRef.current = () => {
        scroller.removeEventListener("scroll", onScroll);
        scroller.removeEventListener("wheel", onWheel);
      };
    }
    if (refitTerminalAfterFontChange(instance)) {
      return;
    }
    if (
      !shouldApplyTerminalResize(
        instance.cols,
        instance.rows,
        hasRenderedSize(instance.element),
      )
    ) {
      return;
    }
    lastResizeRef.current = { cols: instance.cols, rows: instance.rows };
    initialResizeSentRef.current = true;
    flushPendingWrites();
    markWtermPerformance("resize-send", {
      cols: instance.cols,
      rows: instance.rows,
    });
    attachment.sendResize(instance.cols, instance.rows);
  }, [attachment, flushPendingWrites]);

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      anyEventLayoutRef.current = null;
      lastAnyEventCellRef.current = null;
      const element = terminalRef.current?.instance?.element;
      const decision = decideTerminalResize(
        shouldApplyTerminalResize(
          cols,
          rows,
          element ? hasRenderedSize(element) : false,
        ),
        lastResizeRef.current.cols !== cols ||
          lastResizeRef.current.rows !== rows,
        initialResizeSentRef.current,
      );
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      if (!decision.send) return;
      flushPendingWrites();
      markWtermPerformance("resize-request", { cols, rows });
      if (decision.delayMs === 0) {
        sendSettledResize();
        return;
      }
      // BB animates panel maximize/restore for 220ms. Keep Wterm's local grid
      // responsive, but send only the settled PTY size so TUIs do not paint a
      // series of intermediate SIGWINCH frames over the changing grid.
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        sendSettledResize();
      }, decision.delayMs);
    },
    [flushPendingWrites, sendSettledResize],
  );

  const handleWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (clearSelectionBoundaryRef.current) return;
      const selection = window.getSelection();
      if (!shouldClearSelectionOnWheel(selection)) return;
      clearTerminalSelection<Node | null>(
        terminalRef.current?.instance?.element ?? event.currentTarget,
        selection,
      );
    },
    [],
  );

  const handleLinkClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>(".term-link");
      if (!link || !onLinkClick) return;
      const action = terminalLinkAction(link.href);
      if (
        action?.kind === "url" &&
        (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      ) {
        return;
      }
      if (onLinkClick(link.href)) event.preventDefault();
    },
    [onLinkClick],
  );

  const historyTruncated =
    firstDeliveredSeqRef.current !== null && firstDeliveredSeqRef.current > 0;

  if (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return (
      <div className="wterm-renderer-diagnostic" role="alert">
        <p>Ghostty terminal renderer failed to initialize.</p>
        <pre className="mt-2 max-w-full overflow-auto text-left text-xs whitespace-pre-wrap">
          {detail}
        </pre>
        <button
          type="button"
          className="mt-3 rounded border px-2 py-1 text-xs"
          onClick={() => {
            setError(null);
            setReloadNonce((current) => current + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  }
  if (!core) {
    return (
      <div
        className="wterm-renderer wterm-renderer--loading"
        data-renderer="ghostty"
        aria-busy="true"
        aria-label="Terminal loading"
      />
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {clipboardRequest && (
        <button
          type="button"
          aria-label="Copy terminal clipboard request"
          onClick={approveClipboardRequest}
          style={{ flex: "none" }}
        >
          Copy terminal clipboard request
        </button>
      )}
      {writeFailure && (
        <div
          className="wterm-write-failure"
          role={writeFailure.kind === "core" ? "alert" : "status"}
        >
          <span>
            {writeFailure.kind === "core"
              ? `Terminal output stopped being applied (${writeFailure.phase} write failed, seq ${writeFailure.seq ?? "unknown"}, ${writeFailure.bytes} B, ${writeFailure.errorName}). The screen below is frozen and may be out of date.`
              : `A terminal response could not be delivered (${writeFailure.phase}, seq ${writeFailure.seq ?? "unknown"}). The PTY may be waiting for it; the screen is still updating.`}
          </span>
          {writeFailure.kind === "core" && writeFailure.dropped > 0 && (
            <span>{writeFailure.dropped} queued chunk(s) were discarded.</span>
          )}
          {writeFailure.kind === "core" && historyTruncated && (
            <span>
              A reload replays only the history the PTY still retains; earlier
              output cannot be recovered.
            </span>
          )}
          {writeFailure.kind === "core" ? (
            <button type="button" onClick={reloadAfterWriteFailure}>
              Reload terminal
            </button>
          ) : (
            <button type="button" onClick={() => setWriteFailure(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
      <Terminal
        ref={terminalRef}
        core={core}
        autoResize
        onReady={handleReady}
        onError={setError}
        onData={handleData}
        onKeyDownCapture={() => markWtermPerformance("keydown")}
        onResize={handleResize}
        onMouseDown={handleMouseDown}
        onMouseDownCapture={handleTuiCopyDragStart}
        onMouseMoveCapture={handleAnyEventMouseMove}
        onMouseLeave={() => {
          lastAnyEventCellRef.current = null;
        }}
        onWheelCapture={handleWheelCapture}
        onCopyCapture={handleCopy}
        onClick={handleLinkClick}
        style={{ ...terminalFontStyle, flex: 1, height: "auto" }}
        className="wterm-renderer"
        data-renderer="ghostty"
      />
    </div>
  );
}

export function TerminalRenderer({
  terminalId,
  attachment,
  fontSizePx = 14,
  onLinkClick,
}: {
  terminalId: string;
  attachment: TerminalAttachment | null;
  fontSizePx?: number;
  onLinkClick?: (href: string) => boolean;
}) {
  if (!attachment) {
    return (
      <div className="wterm-renderer" data-terminal-id={terminalId}>
        Waiting for terminal attachment…
      </div>
    );
  }
  return (
    <div className="wterm-renderer-panel" data-terminal-id={terminalId}>
      <WtermRenderer
        key={terminalId}
        attachment={attachment}
        fontSizePx={fontSizePx}
        onLinkClick={onLinkClick}
      />
    </div>
  );
}
