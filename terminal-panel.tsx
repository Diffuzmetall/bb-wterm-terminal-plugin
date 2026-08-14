import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";
import * as BbApp from "@bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@bb/plugin-sdk/app";
import {
  useLegacyTerminalAttachment,
  type TerminalAttachment,
} from "./terminal-attachment.js";
import { TerminalRenderer } from "./wterm-renderer.js";

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILE_UPLOAD_BYTES = 25 * 1024 * 1024;
const PLUGIN_ID = "wterm-terminal-preview";
const IMAGE_EXTENSIONS = new Set([
  "avif",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);

interface TerminalUploadResult {
  path: string;
  sha256: string;
  sizeBytes: number;
}

type TransferState =
  | { kind: "idle" }
  | { kind: "uploading"; fileName: string }
  | { kind: "ready"; path: string }
  | { kind: "failed"; message: string };

function errorMessage(value: unknown, fallback: string): string {
  return value && typeof value === "object" && "error" in value
    ? String((value as { error: unknown }).error)
    : fallback;
}

async function pluginToken(signal: AbortSignal): Promise<string> {
  const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal,
  });
  const json: unknown = await response.json().catch(() => null);
  const token =
    json && typeof json === "object" && "token" in json
      ? (json as { token: unknown }).token
      : undefined;
  if (!response.ok || typeof token !== "string") {
    throw new Error(
      errorMessage(json, `token request failed (HTTP ${response.status})`),
    );
  }
  return token;
}

export async function uploadTerminalFile({
  file,
  signal,
  terminalId,
  threadId,
}: {
  file: File;
  signal: AbortSignal;
  terminalId: string;
  threadId: string;
}): Promise<TerminalUploadResult> {
  const extension = /\.([A-Za-z0-9]{1,10})$/u
    .exec(file.name)?.[1]
    ?.toLowerCase();
  const limit =
    file.type.toLowerCase().startsWith("image/") ||
    (extension !== undefined && IMAGE_EXTENSIONS.has(extension))
      ? MAX_IMAGE_UPLOAD_BYTES
      : MAX_FILE_UPLOAD_BYTES;
  if (file.size > limit) {
    throw new Error(`File exceeds the ${limit} byte limit`);
  }
  const token = await pluginToken(signal);
  const query = new URLSearchParams({
    threadId,
    terminalId,
    fileName: file.name || "upload",
    mime: file.type || "application/octet-stream",
  });
  const response = await fetch(
    `/api/v1/plugins/${PLUGIN_ID}/http/upload?${query.toString()}`,
    {
      method: "POST",
      headers: { "x-bb-plugin-token": token },
      body: file,
      signal,
    },
  );
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      errorMessage(json, `upload failed (HTTP ${response.status})`),
    );
  }
  if (
    !json ||
    typeof json !== "object" ||
    !("path" in json) ||
    typeof json.path !== "string" ||
    !("sha256" in json) ||
    typeof json.sha256 !== "string" ||
    !("sizeBytes" in json) ||
    typeof json.sizeBytes !== "number"
  ) {
    throw new Error("upload returned an invalid response");
  }
  return {
    path: json.path,
    sha256: json.sha256,
    sizeBytes: json.sizeBytes,
  };
}

export function bracketedPastePath(path: string): Uint8Array {
  if (/[\u0000-\u001f\u007f]/u.test(path)) {
    throw new Error("upload path contains terminal control characters");
  }
  const shellArgument = `'${path.replaceAll("'", `'\\''`)}'`;
  return new TextEncoder().encode(`\u001b[200~${shellArgument}\u001b[201~`);
}

export interface TerminalPanelParams {
  schemaVersion: 1;
  terminalId: string;
}
export function parseTerminalParams(
  value: unknown,
): TerminalPanelParams | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 &&
    typeof record.terminalId === "string" &&
    record.terminalId.length > 0
    ? { schemaVersion: 1, terminalId: record.terminalId }
    : null;
}

function AttachedTerminal({
  threadId,
  terminalId,
}: {
  threadId: string;
  terminalId: string;
}) {
  const useHostAttachment = Reflect.get(
    BbApp,
    "experimental_useTerminalAttachment",
  ) as TerminalAttachmentHook | undefined;
  return useHostAttachment ? (
    <HostAttachedTerminal
      threadId={threadId}
      terminalId={terminalId}
      useAttachment={useHostAttachment}
    />
  ) : (
    <LegacyAttachedTerminal threadId={threadId} terminalId={terminalId} />
  );
}

type TerminalAttachmentHook = (options: {
  threadId: string;
  terminalId: string;
}) => TerminalAttachment | null;

function HostAttachedTerminal({
  threadId,
  terminalId,
  useAttachment,
}: {
  threadId: string;
  terminalId: string;
  useAttachment: TerminalAttachmentHook;
}) {
  const attachment = useAttachment({ threadId, terminalId });
  return (
    <TerminalWithUpload
      threadId={threadId}
      terminalId={terminalId}
      attachment={attachment}
    />
  );
}

function LegacyAttachedTerminal({
  threadId,
  terminalId,
}: {
  threadId: string;
  terminalId: string;
}) {
  const attachment = useLegacyTerminalAttachment(terminalId);
  return (
    <TerminalWithUpload
      threadId={threadId}
      terminalId={terminalId}
      attachment={attachment}
    />
  );
}

function TerminalWithUpload({
  attachment,
  terminalId,
  threadId,
}: {
  attachment: TerminalAttachment | null;
  terminalId: string;
  threadId: string;
}) {
  const [transfer, setTransfer] = useState<TransferState>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const activeUpload = useRef<AbortController | null>(null);
  const generation = useRef(0);

  useEffect(
    () => () => {
      generation.current += 1;
      activeUpload.current?.abort();
    },
    [attachment, terminalId, threadId],
  );

  const upload = useCallback(
    async (file: File) => {
      if (!attachment || transfer.kind === "uploading") return;
      const currentGeneration = ++generation.current;
      activeUpload.current?.abort();
      const controller = new AbortController();
      activeUpload.current = controller;
      setTransfer({ kind: "uploading", fileName: file.name || "upload" });
      try {
        const result = await uploadTerminalFile({
          file,
          signal: controller.signal,
          terminalId,
          threadId,
        });
        if (generation.current !== currentGeneration) return;
        if (!attachment.sendInput(bracketedPastePath(result.path))) {
          throw new Error(
            "uploaded path could not be inserted into the terminal",
          );
        }
        setTransfer({ kind: "ready", path: result.path });
      } catch (error) {
        if (
          generation.current === currentGeneration &&
          !controller.signal.aborted
        ) {
          setTransfer({
            kind: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        if (generation.current === currentGeneration) {
          activeUpload.current = null;
        }
      }
    },
    [attachment, terminalId, threadId, transfer.kind],
  );

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void upload(file);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!attachment) {
      setTransfer({
        kind: "failed",
        message: "terminal attachment unavailable",
      });
    } else if (file) {
      void upload(file);
    }
  };
  const onPasteCapture = (event: ClipboardEvent<HTMLDivElement>) => {
    const image = Array.from(event.clipboardData.files).find((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );
    if (!image || !attachment) return;
    event.preventDefault();
    event.stopPropagation();
    void upload(image);
  };

  const message =
    transfer.kind === "uploading"
      ? `Uploading ${transfer.fileName}…`
      : transfer.kind === "ready"
        ? `Ready: ${transfer.path}`
        : transfer.kind === "failed"
          ? `Failed: ${transfer.message}`
          : "Drop a file or paste an image";

  return (
    <div
      className="wterm-terminal-with-upload"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onPasteCapture={onPasteCapture}
    >
      <div className="wterm-upload-toolbar">
        <button
          type="button"
          disabled={!attachment || transfer.kind === "uploading"}
          onClick={() => inputRef.current?.click()}
          className="rounded border px-2 py-1 text-xs"
        >
          Upload file
        </button>
        <input
          ref={inputRef}
          type="file"
          aria-label="Choose file to upload"
          className="sr-only"
          onChange={onFileChange}
        />
        <span
          className="min-w-0 truncate text-xs text-muted-foreground"
          role="status"
        >
          {message}
        </span>
      </div>
      <div className="wterm-upload-terminal">
        <TerminalRenderer terminalId={terminalId} attachment={attachment} />
      </div>
    </div>
  );
}

export default function TerminalPanel({
  threadId,
  params,
}: {
  threadId: PluginThreadPanelProps["threadId"];
  params: unknown;
}): ReactNode {
  const selected = parseTerminalParams(params);
  return selected ? (
    <AttachedTerminal threadId={threadId} terminalId={selected.terminalId} />
  ) : (
    <div className="p-4 text-sm">Select a terminal to continue.</div>
  );
}
