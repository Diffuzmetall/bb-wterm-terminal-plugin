import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle } from "@wterm/react";
import type { TerminalAttachment } from "./terminal-attachment.js";
import { getPluginToken } from "./plugin-token.js";
import {
  Osc52ClipboardFilter,
  copyTextToClipboard,
  flushPendingClipboardCopy,
  queueClipboardText,
} from "./osc52-clipboard.js";
import { createRetryablePromiseCache } from "./retryable-cache.js";
import {
  cellAtPoint,
  extractViewportText,
  selectionMoved,
  type CellLayout,
  type GridPoint,
} from "./terminal-selection.js";
// @ts-expect-error CSS side effects are resolved by the plugin bundler.
import "@wterm/react/css";
// @ts-expect-error CSS side effects are resolved by the plugin bundler.
import "./wterm-renderer.css";

const PLUGIN_ID = "wterm-terminal-preview";
export const GHOSTTY_WASM_URL = `/api/v1/plugins/${PLUGIN_ID}/http/ghostty-vt.wasm`;
export const NERD_FONT_URL = `/api/v1/plugins/${PLUGIN_ID}/http/symbols-nerd-font-mono-v3.5.0.woff2`;
export const NERD_FONT_FAMILY = "Wterm Symbols Nerd Font Mono";
const nerdFontLoads = new WeakMap<object, Promise<void>>();
const MIN_USABLE_TERMINAL_CELLS = 2;
const TERMINAL_RESIZE_SETTLE_MS = 250;

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

/**
 * Ghostty WASM 0.4.0 still discards mode 1003 before `mouseTracking()` can
 * expose it. Track that one DEC mode at the write boundary, then let Wterm DOM
 * provide its supported click, wheel, and button-drag subset through mode 1002.
 */
export function supportAnyEventMouseMode(core: GhosttyCore): GhosttyCore {
  const decodeMouseControl = new TextDecoder("latin1");
  const writeRaw = core.writeRaw.bind(core);
  const writeString = core.writeString.bind(core);
  const initCore = core.init.bind(core);
  const resizeCore = core.resize.bind(core);
  const supportedMode = core.mouseTracking.bind(core);
  const osc52 = new Osc52ClipboardFilter(queueClipboardText);
  let anyEventMouse = false;
  let controlTail = "";
  let initialized = false;

  const observeMouseMode = (text: string) => {
    const control = controlTail + text;
    for (const match of control.matchAll(/\x1b\[\?([0-9;]*)([hl])/g)) {
      const modes = match[1]?.split(";") ?? [];
      if (modes.includes("1003")) {
        anyEventMouse = match[2] === "h";
      }
      if (
        match[2] === "l" &&
        modes.some(
          (mode) => mode === "47" || mode === "1047" || mode === "1049",
        )
      ) {
        anyEventMouse = false;
      }
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
  return core;
}

const pluginToken = getPluginToken;

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

export async function loadGhosttyCore(
  wasmUrl = GHOSTTY_WASM_URL,
): Promise<GhosttyCore> {
  if (wasmUrl !== GHOSTTY_WASM_URL) {
    return supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: wasmUrl }),
    );
  }
  return supportAnyEventMouseMode(
    await GhosttyCore.load({ wasmPath: await ghosttyWasmObjectUrl() }),
  );
}

export async function preloadTerminalAssets(): Promise<void> {
  await Promise.all([ghosttyWasmObjectUrl(), loadNerdFont()]);
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

type TerminalFontStyle = CSSProperties & {
  "--term-font-family": string;
  "--term-font-size": string;
  "--term-row-height": string;
};

export function WtermRenderer({
  attachment,
  fontSizePx = 14,
  wasmUrl = GHOSTTY_WASM_URL,
}: {
  attachment: TerminalAttachment;
  fontSizePx?: number;
  wasmUrl?: string;
}) {
  const terminalRef = useRef<TerminalHandle>(null);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const clearSelectionBoundaryRef = useRef<(() => void) | null>(null);
  const tuiCopyDragCleanupRef = useRef<(() => void) | null>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastResizeRef = useRef({ cols: 0, rows: 0 });
  const writesOpenRef = useRef(false);
  const pendingWritesRef = useRef<Uint8Array[]>([]);
  const readyRef = useRef(false);
  const tuiDragRef = useRef<{
    layout: CellLayout;
    start: GridPoint;
  } | null>(null);
  const followBottomRef = useRef(true);
  const followScrollCleanupRef = useRef<(() => void) | null>(null);
  const terminalFontStyle: TerminalFontStyle = {
    "--term-font-family": `Menlo, Consolas, "DejaVu Sans Mono", "Courier New", "${NERD_FONT_FAMILY}", monospace`,
    "--term-font-size": `${fontSizePx}px`,
    "--term-row-height": `${Math.ceil(fontSizePx * 1.2)}px`,
  };

  useEffect(() => {
    let alive = true;
    setCore(null);
    setError(null);
    setReady(false);
    writesOpenRef.current = false;
    pendingWritesRef.current = [];
    lastResizeRef.current = { cols: 0, rows: 0 };
    void loadNerdFont().catch(() => undefined);
    void loadGhosttyCore(wasmUrl).then(
      (loaded) => {
        if (alive) setCore(loaded);
      },
      (loadError) => {
        if (alive) setError(loadError);
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadNonce, wasmUrl]);

  readyRef.current = ready;

  useEffect(() => {
    if (!ready) return;
    return attachment.subscribe(({ bytes }) => {
      if (!writesOpenRef.current) {
        pendingWritesRef.current.push(bytes);
        return;
      }
      try {
        terminalRef.current?.write(bytes);
      } catch {
        // A live write must not unmount the renderer. Replay and OSC 52
        // can throw inside Ghostty without meaning init failed.
      }
    });
  }, [attachment, ready]);

  useEffect(() => {
    if (!readyRef.current) return;
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

  useEffect(
    () => () => {
      clearSelectionBoundaryRef.current?.();
      tuiCopyDragCleanupRef.current?.();
      followScrollCleanupRef.current?.();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
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

      flushPendingClipboardCopy();
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
        clearBoundary();
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          return;
        }
        const text = selection.toString();
        if (text.length > 0) copyTextToClipboard(text);
      };

      clearSelectionBoundaryRef.current = clearBoundary;
      window.addEventListener("mouseup", finishSelection, { once: true });
      window.addEventListener("blur", clearBoundary, { once: true });
    },
    [],
  );

  const handleTuiCopyDragStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      flushPendingClipboardCopy();
      if (event.button !== 0 || event.shiftKey) return;
      tuiCopyDragCleanupRef.current?.();
      const instance = terminalRef.current?.instance;
      const bridge = instance?.bridge;
      if (!instance || !bridge || bridge.mouseTracking() === 0) return;
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
        const end = cellAtPoint(drag.layout, up.clientX, up.clientY);
        if (!end || !selectionMoved(drag.start, end)) return;
        const text = extractViewportText(bridge, drag.start, end);
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

  const flushPendingWrites = useCallback(() => {
    if (writesOpenRef.current) return;
    writesOpenRef.current = true;
    const pending = pendingWritesRef.current.splice(0);
    for (const bytes of pending) {
      try {
        terminalRef.current?.write(bytes);
      } catch {
        // Replay must not unmount the renderer.
      }
    }
  }, []);

  const handleReady = useCallback(() => {
    setReady(true);
    const instance = terminalRef.current?.instance;
    if (!instance) return;
    followScrollCleanupRef.current?.();
    const scroller = instance.element;
    if (scroller) {
      const onScroll = () => {
        followBottomRef.current = computeFollowBottom(scroller);
      };
      onScroll();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      followScrollCleanupRef.current = () => {
        scroller.removeEventListener("scroll", onScroll);
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
    flushPendingWrites();
    attachment.sendResize(instance.cols, instance.rows);
  }, [attachment, flushPendingWrites]);

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      const element = terminalRef.current?.instance?.element;
      if (
        !shouldApplyTerminalResize(
          cols,
          rows,
          element ? hasRenderedSize(element) : false,
        )
      ) {
        if (resizeTimerRef.current !== null) {
          window.clearTimeout(resizeTimerRef.current);
          resizeTimerRef.current = null;
        }
        return;
      }
      flushPendingWrites();
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
      if (
        lastResizeRef.current.cols === cols &&
        lastResizeRef.current.rows === rows
      ) {
        return;
      }
      // BB animates panel maximize/restore for 220ms. Keep Wterm's local grid
      // responsive, but send only the settled PTY size so TUIs do not paint a
      // series of intermediate SIGWINCH frames over the changing grid.
      resizeTimerRef.current = window.setTimeout(() => {
        resizeTimerRef.current = null;
        const instance = terminalRef.current?.instance;
        if (
          instance &&
          hasRenderedSize(instance.element) &&
          (lastResizeRef.current.cols !== instance.cols ||
            lastResizeRef.current.rows !== instance.rows)
        ) {
          attachment.sendResize(instance.cols, instance.rows);
          lastResizeRef.current = { cols: instance.cols, rows: instance.rows };
        }
      }, TERMINAL_RESIZE_SETTLE_MS);
    },
    [attachment, flushPendingWrites],
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
    <Terminal
      ref={terminalRef}
      core={core}
      autoResize
      onReady={handleReady}
      onError={setError}
      onData={(data) => attachment.sendInput(new TextEncoder().encode(data))}
      onResize={handleResize}
      onMouseDown={handleMouseDown}
      onMouseDownCapture={handleTuiCopyDragStart}
      onWheelCapture={handleWheelCapture}
      style={terminalFontStyle}
      className="wterm-renderer"
      data-renderer="ghostty"
    />
  );
}

export function TerminalRenderer({
  terminalId,
  attachment,
  fontSizePx = 14,
}: {
  terminalId: string;
  attachment: TerminalAttachment | null;
  fontSizePx?: number;
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
      />
    </div>
  );
}
