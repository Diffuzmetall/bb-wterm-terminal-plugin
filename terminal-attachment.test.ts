import { beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyTerminalAttachment } from "./terminal-attachment";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
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
});
