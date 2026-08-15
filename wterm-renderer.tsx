import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type UIEvent as ReactUIEvent,
} from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle } from "@wterm/react";
import { z } from "zod";
import type { TerminalAttachment } from "./terminal-attachment.js";
// @ts-expect-error CSS side effects are resolved by the plugin bundler.
import "@wterm/react/css";
// @ts-expect-error CSS side effects are resolved by the plugin bundler.
import "./wterm-renderer.css";

const PLUGIN_ID = "wterm-terminal-preview";
export const GHOSTTY_WASM_URL = `/api/v1/plugins/${PLUGIN_ID}/http/ghostty-vt.wasm`;

/**
 * Ghostty WASM 0.3.4 discards mode 1003 before `mouseTracking()` can expose it.
 * Track that one DEC mode at the write boundary, then let Wterm DOM provide
 * its supported click, wheel, and button-drag subset through mode 1002.
 */
export function supportAnyEventMouseMode(core: GhosttyCore): GhosttyCore {
  const decodeMouseControl = new TextDecoder("latin1");
  const writeRaw = core.writeRaw.bind(core);
  const writeString = core.writeString.bind(core);
  const supportedMode = core.mouseTracking.bind(core);
  let anyEventMouse = false;
  let controlTail = "";

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

  core.writeRaw = (data) => {
    observeMouseMode(decodeMouseControl.decode(data));
    writeRaw(data);
  };
  core.writeString = (data) => {
    observeMouseMode(data);
    writeString(data);
  };
  core.mouseTracking = () => (anyEventMouse ? 1002 : supportedMode());
  return core;
}

async function pluginToken(): Promise<string> {
  const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  const json: unknown = await response.json().catch(() => null);
  const parsed = z.object({ token: z.string() }).safeParse(json);
  if (!response.ok || !parsed.success) {
    throw new Error(`WASM token request failed (HTTP ${response.status})`);
  }
  return parsed.data.token;
}

export async function loadGhosttyCore(
  wasmUrl = GHOSTTY_WASM_URL,
): Promise<GhosttyCore> {
  if (wasmUrl !== GHOSTTY_WASM_URL) {
    return supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: wasmUrl }),
    );
  }
  const response = await fetch(wasmUrl, {
    headers: { "x-bb-plugin-token": await pluginToken() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`WASM request failed (HTTP ${response.status})`);
  }
  const objectUrl = URL.createObjectURL(
    new Blob([await response.arrayBuffer()], { type: "application/wasm" }),
  );
  try {
    return supportAnyEventMouseMode(
      await GhosttyCore.load({ wasmPath: objectUrl }),
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function hasRenderedSize(element: HTMLElement): boolean {
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

interface WtermFontMetricsBoundary {
  cols: number;
  element: HTMLElement;
  rows: number;
  resize(cols: number, rows: number): void;
  _measureCharSize?: () => { charWidth: number; rowHeight: number } | null;
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
  const cols = Math.max(1, Math.floor(contentWidth / metrics.charWidth));
  const rows = Math.max(1, Math.floor(contentHeight / metrics.rowHeight));
  if (cols === terminal.cols && rows === terminal.rows) return false;

  terminal.resize(cols, rows);
  return true;
}

type TerminalFontStyle = CSSProperties & {
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
  const clearSelectionBoundaryRef = useRef<(() => void) | null>(null);
  const followBottomRef = useRef(true);
  const terminalFontStyle: TerminalFontStyle = {
    "--term-font-size": `${fontSizePx}px`,
    "--term-row-height": `${Math.ceil(fontSizePx * 1.2)}px`,
  };

  useEffect(() => {
    let alive = true;
    setCore(null);
    setError(null);
    setReady(false);
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
  }, [wasmUrl]);

  useEffect(() => {
    if (!ready) return;
    return attachment.subscribe(({ bytes }) =>
      terminalRef.current?.write(bytes),
    );
  }, [attachment, ready]);

  useEffect(() => {
    if (!ready) return;
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
  }, [fontSizePx, ready]);

  useEffect(
    () => () => {
      clearSelectionBoundaryRef.current?.();
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
        clearBoundary();
        const terminal = terminalRef.current?.instance?.element;
        const selection = window.getSelection();
        if (
          !terminal ||
          !selection ||
          selection.isCollapsed ||
          selection.rangeCount === 0
        ) {
          return;
        }
        const range = selection.getRangeAt(0);
        if (
          !terminal.contains(range.startContainer) ||
          !terminal.contains(range.endContainer)
        ) {
          return;
        }
        const text = selection.toString();
        if (text.length > 0 && navigator.clipboard?.writeText) {
          void navigator.clipboard.writeText(text).catch(() => undefined);
        }
      };

      clearSelectionBoundaryRef.current = clearBoundary;
      window.addEventListener("mouseup", finishSelection, { once: true });
      window.addEventListener("blur", clearBoundary, { once: true });
    },
    [],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      const element = terminalRef.current?.instance?.element;
      if (element && hasRenderedSize(element)) {
        attachment.sendResize(cols, rows);
      }
    },
    [attachment],
  );

  const handleScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    followBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <= 1;
  }, []);

  if (error) {
    return (
      <div className="wterm-renderer-diagnostic" role="alert">
        Ghostty terminal renderer failed to initialize.
      </div>
    );
  }
  if (!core) {
    return (
      <div
        className="wterm-renderer"
        data-renderer="ghostty"
        aria-busy="true"
      />
    );
  }
  return (
    <Terminal
      ref={terminalRef}
      core={core}
      autoResize
      onReady={() => setReady(true)}
      onError={setError}
      onData={(data) => attachment.sendInput(new TextEncoder().encode(data))}
      onResize={handleResize}
      onMouseDown={handleMouseDown}
      onScroll={handleScroll}
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
