import { useCallback, useEffect, useRef, useState } from "react";
import type { ExperimentalTerminalAttachment } from "@bb/plugin-sdk/app";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, type TerminalHandle } from "@wterm/react";
// @ts-expect-error CSS side effects are resolved by the plugin bundler.
import "@wterm/react/css";
// @ts-expect-error CSS side effects are resolved by the plugin bundler.
import "./wterm-renderer.css";

const PLUGIN_ID = "wterm-terminal-preview";
export const GHOSTTY_WASM_URL =
  `/api/v1/plugins/${PLUGIN_ID}/http/ghostty-vt.wasm`;

async function pluginToken(): Promise<string> {
  const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const json: unknown = await response.json().catch(() => null);
  const token =
    json && typeof json === "object" && "token" in json
      ? (json as { token: unknown }).token
      : undefined;
  if (!response.ok || typeof token !== "string") {
    throw new Error(`WASM token request failed (HTTP ${response.status})`);
  }
  return token;
}

export async function loadGhosttyCore(
  wasmUrl = GHOSTTY_WASM_URL,
): Promise<GhosttyCore> {
  if (wasmUrl !== GHOSTTY_WASM_URL) {
    return GhosttyCore.load({ wasmPath: wasmUrl });
  }
  const response = await fetch(wasmUrl, {
    headers: { "x-bb-plugin-token": await pluginToken() },
  });
  if (!response.ok) {
    throw new Error(`WASM request failed (HTTP ${response.status})`);
  }
  const objectUrl = URL.createObjectURL(
    new Blob([await response.arrayBuffer()], { type: "application/wasm" }),
  );
  try {
    return await GhosttyCore.load({ wasmPath: objectUrl });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function hasRenderedSize(element: HTMLElement): boolean {
  const { width, height } = element.getBoundingClientRect();
  return width > 0 && height > 0;
}

export function WtermRenderer({
  attachment,
  wasmUrl = GHOSTTY_WASM_URL,
}: {
  attachment: ExperimentalTerminalAttachment;
  wasmUrl?: string;
}) {
  const terminalRef = useRef<TerminalHandle>(null);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);

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

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      const element = terminalRef.current?.instance?.element;
      if (element && hasRenderedSize(element)) {
        attachment.sendResize(cols, rows);
      }
    },
    [attachment],
  );

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
      className="wterm-renderer"
      data-renderer="ghostty"
    />
  );
}

export function TerminalRenderer({
  terminalId,
  attachment,
}: {
  terminalId: string;
  attachment: ExperimentalTerminalAttachment | null;
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
      <WtermRenderer key={terminalId} attachment={attachment} />
    </div>
  );
}
