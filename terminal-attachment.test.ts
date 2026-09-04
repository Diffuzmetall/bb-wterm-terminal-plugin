import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeBase64,
  encodeBase64,
  LegacyTerminalAttachment,
} from "./terminal-attachment";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  closeCount = 0;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly endpoint: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCount += 1;
    this.readyState = FakeWebSocket.CLOSED;
  }

  disconnect(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new Event("close") as CloseEvent);
  }

  beginClosing(): void {
    this.readyState = FakeWebSocket.CLOSING;
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receive(message: object): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

function output(seq: number, value: string) {
  return {
    type: "output",
    chunk: { seq, dataBase64: btoa(value) },
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("window", {
    location: { host: "bb.test", protocol: "https:" },
  });
  vi.stubGlobal("WebSocket", FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("decodeBase64", () => {
  it("decodes binary bytes without changing values", () => {
    expect(decodeBase64("AAH+/w==")).toEqual(new Uint8Array([0, 1, 254, 255]));
  });
});

describe("encodeBase64", () => {
  it("matches btoa for small buffers", () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    expect(encodeBase64(bytes)).toBe("AAH+/w==");
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it("encodes a 100KiB buffer round-trip", () => {
    const bytes = new Uint8Array(100 * 1024);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i & 0xff;
    const decoded = decodeBase64(encodeBase64(bytes));
    expect(decoded).toHaveLength(bytes.length);
    expect(decoded.every((byte, index) => byte === bytes[index])).toBe(true);
  });
});

describe("LegacyTerminalAttachment", () => {
  it("connects to the encoded terminal endpoint", () => {
    const attachment = new LegacyTerminalAttachment("terminal/one");
    attachment.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]?.endpoint).toBe(
      "wss://bb.test/ws/terminals/terminal%2Fone",
    );
  });

  it("delivers replay before buffered live output and drops duplicates", () => {
    const attachment = new LegacyTerminalAttachment("terminal-1");
    const received: string[] = [];
    attachment.subscribe((chunk) =>
      received.push(new TextDecoder().decode(chunk.bytes)),
    );
    attachment.connect();
    const socket = FakeWebSocket.instances[0]!;

    socket.receive(output(3, "live"));
    socket.receive({ type: "attached", nextSeq: 3 });
    socket.receive(output(0, "replay-0"));
    socket.receive(output(1, "replay-1"));
    expect(received).toEqual([]);
    socket.receive(output(2, "replay-2"));
    socket.receive(output(3, "duplicate"));
    socket.receive(output(4, "after"));

    expect(received).toEqual([
      "replay-0",
      "replay-1",
      "replay-2",
      "live",
      "after",
    ]);
  });

  it("inserts out-of-order replay chunks by seq before live", () => {
    const attachment = new LegacyTerminalAttachment("terminal-1");
    const received: string[] = [];
    attachment.subscribe((chunk) =>
      received.push(`${chunk.seq}:${new TextDecoder().decode(chunk.bytes)}`),
    );
    attachment.connect();
    const socket = FakeWebSocket.instances[0]!;

    socket.receive(output(3, "live"));
    socket.receive({ type: "attached", nextSeq: 3 });
    socket.receive(output(1, "replay-1"));
    socket.receive(output(0, "replay-0"));
    socket.receive(output(0, "dup-0"));
    expect(received).toEqual([]);
    socket.receive(output(2, "replay-2"));

    expect(received).toEqual([
      "0:replay-0",
      "1:replay-1",
      "2:replay-2",
      "3:live",
    ]);
  });

  it("buffers output until a renderer subscribes", () => {
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.receive({ type: "attached", nextSeq: 0 });
    socket.receive(output(0, "prompt"));

    const listener = vi.fn();
    attachment.subscribe(listener);

    expect(listener).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(listener.mock.calls[0]![0].bytes)).toBe(
      "prompt",
    );
  });

  it("flushes the latest resize before queued inputs when the socket opens", () => {
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const socket = FakeWebSocket.instances[0]!;

    expect(attachment.sendInput(new TextEncoder().encode("a"))).toBe(true);
    expect(attachment.sendResize(80, 24)).toBe(true);
    expect(attachment.sendResize(120, 40)).toBe(true);
    expect(attachment.sendInput(new TextEncoder().encode("é"))).toBe(true);
    expect(socket.sent).toEqual([]);

    socket.open();

    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "resize", cols: 120, rows: 40 },
      { type: "input", dataBase64: "YQ==" },
      { type: "input", dataBase64: "w6k=" },
    ]);
  });

  it("reconnects automatically after the socket closes", () => {
    vi.useFakeTimers();
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const first = FakeWebSocket.instances[0]!;
    first.open();

    first.disconnect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(100);

    expect(FakeWebSocket.instances).toHaveLength(2);
    attachment.detach();
  });

  it("reconnects immediately and preserves input typed while disconnected", () => {
    vi.useFakeTimers();
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.disconnect();

    expect(attachment.sendInput(new TextEncoder().encode("resume"))).toBe(true);
    const second = FakeWebSocket.instances[1]!;
    expect(second.sent).toEqual([]);
    second.open();

    expect(second.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "input", dataBase64: "cmVzdW1l" },
    ]);
    attachment.detach();
  });

  it("detaches without sending terminal close and rejects future sends", () => {
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();

    attachment.detach();

    expect(socket.sent).toEqual([]);
    expect(socket.closeCount).toBe(1);
    expect(attachment.sendInput(new Uint8Array([1]))).toBe(false);
    expect(attachment.sendResize(80, 24)).toBe(false);
  });

  it("skips replay already delivered before reconnect", () => {
    vi.useFakeTimers();
    const attachment = new LegacyTerminalAttachment("terminal-1");
    const received: string[] = [];
    attachment.subscribe((chunk) =>
      received.push(new TextDecoder().decode(chunk.bytes)),
    );
    attachment.connect();
    const first = FakeWebSocket.instances[0]!;
    first.receive({ type: "attached", nextSeq: 0 });
    first.receive(output(0, "old-0"));
    first.receive(output(1, "old-1"));
    first.disconnect();
    vi.advanceTimersByTime(0);

    const second = FakeWebSocket.instances[1]!;
    second.receive(output(0, "replay-0"));
    second.receive({ type: "attached", nextSeq: 2 });
    second.receive(output(2, "live"));

    expect(received).toEqual(["old-0", "old-1", "live"]);
    attachment.detach();
  });

  it("queues input while the socket is closing", () => {
    vi.useFakeTimers();
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const first = FakeWebSocket.instances[0]!;
    first.open();
    first.beginClosing();

    expect(attachment.sendInput(new TextEncoder().encode("keep"))).toBe(true);
    expect(first.sent).toEqual([]);

    first.disconnect();
    vi.advanceTimersByTime(0);
    const second = FakeWebSocket.instances[1]!;
    second.open();
    expect(second.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "input", dataBase64: "a2VlcA==" },
    ]);
    attachment.detach();
  });

  it("does not resend an unchanged resize", () => {
    const attachment = new LegacyTerminalAttachment("terminal-1");
    attachment.connect();
    const socket = FakeWebSocket.instances[0]!;
    socket.open();
    expect(attachment.sendResize(80, 24)).toBe(true);
    expect(attachment.sendResize(80, 24)).toBe(true);
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "resize", cols: 80, rows: 24 },
    ]);
    attachment.detach();
  });
});
