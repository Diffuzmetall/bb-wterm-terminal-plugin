import { useEffect, useState } from "react";

export interface TerminalAttachmentChunk {
  seq: number;
  bytes: Uint8Array;
}

export interface TerminalAttachment {
  readonly terminalId: string;
  subscribe(listener: (chunk: TerminalAttachmentChunk) => void): () => void;
  sendInput(bytes: Uint8Array): boolean;
  sendResize(cols: number, rows: number): boolean;
  detach(): void;
}

interface OutputChunk {
  seq: number;
  dataBase64: string;
}

interface AttachedMessage {
  type: "attached";
  nextSeq: number;
}

interface OutputMessage {
  type: "output";
  chunk: OutputChunk;
}

type TerminalServerMessage = AttachedMessage | OutputMessage;

export class LegacyTerminalAttachment implements TerminalAttachment {
  readonly terminalId: string;
  private attachedNextSeq: number | null = null;
  private detached = false;
  private lastDeliveredSeq = -1;
  private readonly listeners = new Set<
    (chunk: TerminalAttachmentChunk) => void
  >();
  private readonly pendingBeforeAttach = new Map<number, OutputChunk>();
  private readonly pendingBeforeSubscribe: TerminalAttachmentChunk[] = [];
  private readonly pendingInputs: string[] = [];
  private readonly pendingLive = new Map<number, OutputChunk>();
  private readonly pendingReplay = new Map<number, OutputChunk>();
  private pendingResize: string | null = null;
  private socket: WebSocket | null = null;

  constructor(terminalId: string) {
    this.terminalId = terminalId;
  }

  connect(): void {
    if (this.detached || this.socket !== null) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const endpoint = `${protocol}//${window.location.host}/ws/terminals/${encodeURIComponent(this.terminalId)}`;
    const socket = new WebSocket(endpoint);
    this.socket = socket;
    socket.onmessage = (event) => {
      if (this.socket === socket) this.handleMessage(event.data);
    };
    socket.onopen = () => {
      if (this.socket === socket) this.flushPendingSends(socket);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.pendingInputs.length = 0;
      this.pendingResize = null;
    };
  }

  subscribe(listener: (chunk: TerminalAttachmentChunk) => void): () => void {
    this.listeners.add(listener);
    const pending = this.pendingBeforeSubscribe.splice(0);
    for (const chunk of pending) listener(chunk);
    return () => this.listeners.delete(listener);
  }

  sendInput(bytes: Uint8Array): boolean {
    return this.sendInputMessage(
      JSON.stringify({ type: "input", dataBase64: encodeBase64(bytes) }),
    );
  }

  sendResize(cols: number, rows: number): boolean {
    if (!Number.isSafeInteger(cols) || cols <= 0) return false;
    if (!Number.isSafeInteger(rows) || rows <= 0) return false;
    return this.sendResizeMessage(JSON.stringify({ type: "resize", cols, rows }));
  }

  detach(): void {
    if (this.detached) return;
    this.detached = true;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onopen = null;
      socket.close();
    }
    this.listeners.clear();
    this.pendingBeforeAttach.clear();
    this.pendingBeforeSubscribe.length = 0;
    this.pendingInputs.length = 0;
    this.pendingLive.clear();
    this.pendingReplay.clear();
    this.pendingResize = null;
  }

  private handleMessage(raw: unknown): void {
    const message = parseTerminalServerMessage(raw);
    if (!message) return;
    if (message.type === "attached") {
      this.attachedNextSeq = message.nextSeq;
      for (const chunk of this.pendingBeforeAttach.values()) {
        this.pendingLive.set(chunk.seq, chunk);
      }
      this.pendingBeforeAttach.clear();
      this.flushWhenReplayComplete();
      return;
    }
    if (this.attachedNextSeq === null) {
      this.pendingBeforeAttach.set(message.chunk.seq, message.chunk);
      return;
    }
    if (message.chunk.seq < this.attachedNextSeq) {
      this.pendingReplay.set(message.chunk.seq, message.chunk);
      this.flushWhenReplayComplete();
      return;
    }
    if (
      this.attachedNextSeq > 0 &&
      this.lastDeliveredSeq < this.attachedNextSeq - 1
    ) {
      this.pendingLive.set(message.chunk.seq, message.chunk);
      return;
    }
    this.deliver(message.chunk);
  }

  private flushWhenReplayComplete(): void {
    if (this.attachedNextSeq === null) return;
    if (
      this.attachedNextSeq > 0 &&
      !this.pendingReplay.has(this.attachedNextSeq - 1)
    ) {
      return;
    }
    const replay = [...this.pendingReplay.values()].sort(
      (left, right) => left.seq - right.seq,
    );
    this.pendingReplay.clear();
    for (const chunk of replay) this.deliver(chunk);
    const live = [...this.pendingLive.values()].sort(
      (left, right) => left.seq - right.seq,
    );
    this.pendingLive.clear();
    for (const chunk of live) this.deliver(chunk);
  }

  private deliver(chunk: OutputChunk): void {
    if (chunk.seq <= this.lastDeliveredSeq) return;
    this.lastDeliveredSeq = chunk.seq;
    const decoded = { seq: chunk.seq, bytes: decodeBase64(chunk.dataBase64) };
    if (this.listeners.size === 0) {
      this.pendingBeforeSubscribe.push(decoded);
      return;
    }
    for (const listener of this.listeners) listener(decoded);
  }

  private sendInputMessage(message: string): boolean {
    if (this.detached || this.socket === null) return false;
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.pendingInputs.push(message);
      return true;
    }
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(message);
    return true;
  }

  private sendResizeMessage(message: string): boolean {
    if (this.detached || this.socket === null) return false;
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.pendingResize = message;
      return true;
    }
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(message);
    return true;
  }

  private flushPendingSends(socket: WebSocket): void {
    if (this.pendingResize !== null) socket.send(this.pendingResize);
    this.pendingResize = null;
    for (const message of this.pendingInputs) socket.send(message);
    this.pendingInputs.length = 0;
  }
}

export function useLegacyTerminalAttachment(
  terminalId: string,
): TerminalAttachment | null {
  const [attachment, setAttachment] = useState<TerminalAttachment | null>(null);
  useEffect(() => {
    const next = new LegacyTerminalAttachment(terminalId);
    next.connect();
    setAttachment(next);
    return () => {
      setAttachment(null);
      next.detach();
    };
  }, [terminalId]);
  return attachment;
}

function parseTerminalServerMessage(raw: unknown): TerminalServerMessage | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    record.type === "attached" &&
    Number.isSafeInteger(record.nextSeq) &&
    Number(record.nextSeq) >= 0
  ) {
    return { type: "attached", nextSeq: Number(record.nextSeq) };
  }
  if (record.type !== "output" || !record.chunk || typeof record.chunk !== "object") {
    return null;
  }
  const chunk = record.chunk as Record<string, unknown>;
  if (
    !Number.isSafeInteger(chunk.seq) ||
    Number(chunk.seq) < 0 ||
    typeof chunk.dataBase64 !== "string"
  ) {
    return null;
  }
  return {
    type: "output",
    chunk: { seq: Number(chunk.seq), dataBase64: chunk.dataBase64 },
  };
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
