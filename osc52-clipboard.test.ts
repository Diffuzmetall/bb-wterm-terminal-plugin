import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Osc52ClipboardFilter,
  copyTextToClipboard,
  decodeLatin1,
  decodeOsc52Payload,
  encodeLatin1,
  approveClipboardText,
} from "./osc52-clipboard";

const MAX_FRAME_BYTES = 1_048_576;

function encodePayload(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function asciiBase64(length: number): string {
  if (length % 4 !== 0) throw new Error("base64 length must be divisible by 4");
  return "QUFB".repeat(length / 4);
}

function makeFrame(base64Length: number): string {
  return `\x1b]52;c;${asciiBase64(base64Length)}\x07`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Latin-1 byte conversion", () => {
  it("round-trips every byte without Windows-1252 substitutions", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, value) => value);

    expect(Array.from(encodeLatin1(decodeLatin1(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("decodeOsc52Payload", () => {
  it("decodes UTF-8 clipboard bytes", () => {
    expect(decodeOsc52Payload(encodePayload("привет"))).toBe("привет");
  });

  it("rejects invalid base64", () => {
    expect(decodeOsc52Payload("!!!!")).toBeNull();
  });
});

describe("copyTextToClipboard", () => {
  it("uses the Clipboard API even when execCommand reports success", () => {
    const writeText = vi.fn(() => Promise.resolve());
    const execCommand = vi.fn(() => true);
    const field = {
      value: "",
      style: { position: "", left: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement: () => field,
      execCommand,
      body: { append: vi.fn() },
    });

    copyTextToClipboard("selected");

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(writeText).toHaveBeenCalledWith("selected");
  });

  it("keeps selection copying separate when native APIs are unavailable", () => {
    const execCommand = vi.fn(() => true);
    const field = {
      value: "",
      style: { position: "", left: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: () => field,
      execCommand,
      body: { append: vi.fn() },
    });

    copyTextToClipboard("selected");

    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});

describe("approveClipboardText", () => {
  it("does not write when the Clipboard API is absent", async () => {
    vi.stubGlobal("navigator", {});
    await expect(approveClipboardText("remote")).resolves.toBe(false);
  });

  it("writes only the explicitly approved captured text", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(approveClipboardText("approved")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("approved");
  });

  it("keeps native permission denial safe", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("denied")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(approveClipboardText("denied")).resolves.toBe(false);
    expect(writeText).toHaveBeenCalledWith("denied");
  });
});

describe("approval isolation", () => {
  it("uses the captured request when another request arrives during approval", async () => {
    let resolveWrite: (() => void) | undefined;
    const writeText = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveWrite = resolve;
      }),
    );
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    let currentRequest: { text: string } | null = { text: "first" };
    const capturedRequest = currentRequest;
    const approval = approveClipboardText(capturedRequest.text);
    currentRequest = { text: "second" };
    resolveWrite?.();

    if (await approval) {
      currentRequest = currentRequest === capturedRequest ? null : currentRequest;
    }
    expect(writeText).toHaveBeenCalledWith("first");
    expect(currentRequest?.text).toBe("second");
  });

  it("keeps explicit selection writes separate from remote approval", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const execCommand = vi.fn(() => true);
    const field = {
      value: "",
      style: { position: "", left: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement: () => field,
      execCommand,
      body: { append: vi.fn() },
    });

    copyTextToClipboard("selection");
    await approveClipboardText("remote");

    expect(writeText).toHaveBeenNthCalledWith(1, "selection");
    expect(writeText).toHaveBeenNthCalledWith(2, "remote");
  });
});

describe("Osc52ClipboardFilter", () => {
  it("copies a BEL-terminated clipboard write and strips it from the stream", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const payload = encodePayload("copied");
    const next = filter.consumeString(`prompt\x1b]52;c;${payload}\x07more`);

    expect(next).toBe("promptmore");
    expect(onWrite).toHaveBeenCalledWith("copied");
  });

  it("preserves a complete sentence from Herdr copy-on-select", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const sentence = "one two three four five";
    const payload = encodePayload(sentence);

    expect(filter.consumeString(`\x1b]52;c;${payload}\x07`)).toBe("");
    expect(onWrite).toHaveBeenCalledWith(sentence);
  });

  it("copies an ST-terminated sequence split across chunks", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const payload = encodePayload("split");
    expect(filter.consumeString(`\x1b]52;c;${payload.slice(0, 2)}`)).toBe("");
    expect(onWrite).not.toHaveBeenCalled();
    expect(filter.consumeString(`${payload.slice(2)}\x1b\\tail`)).toBe("tail");
    expect(onWrite).toHaveBeenCalledWith("split");
  });

  it("accepts a complete frame exactly at the byte cap", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const frame = makeFrame(MAX_FRAME_BYTES - 8);

    expect(frame.length).toBe(MAX_FRAME_BYTES);
    expect(filter.consumeString(`${frame}tail`)).toBe("tail");
    expect(onWrite).toHaveBeenCalledOnce();
    expect(onWrite.mock.calls[0]?.[0]).toHaveLength(((MAX_FRAME_BYTES - 8) / 4) * 3);
  });

  it("rejects complete and chunked frames over the byte cap", () => {
    const completeWrite = vi.fn();
    const completeFilter = new Osc52ClipboardFilter(completeWrite);
    const oversizedFrame = makeFrame(MAX_FRAME_BYTES - 4);
    expect(oversizedFrame.length).toBe(MAX_FRAME_BYTES + 4);
    expect(completeFilter.consumeString(`${oversizedFrame}tail`)).toBe("tail");
    expect(completeWrite).not.toHaveBeenCalled();

    const chunkedWrite = vi.fn();
    const chunkedFilter = new Osc52ClipboardFilter(chunkedWrite);
    expect(chunkedFilter.consumeString(oversizedFrame.slice(0, MAX_FRAME_BYTES))).toBe("");
    expect(chunkedFilter.consumeString(`${oversizedFrame.slice(MAX_FRAME_BYTES)}tail`)).toBe("tail");
    expect(chunkedWrite).not.toHaveBeenCalled();
  });

  it("preserves UTF-8 bytes and clipboard order across raw chunks", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const frame = `\x1b]52;c;${encodePayload("привет")}\x07`;
    const input = new TextEncoder().encode(`до ${frame} после`);
    const split = new TextEncoder().encode("до ").length + 5;
    const first = filter.consumeBytes(input.slice(0, split));
    const second = filter.consumeBytes(input.slice(split));
    const output = new Uint8Array(first.length + second.length);
    output.set(first);
    output.set(second, first.length);

    expect(new TextDecoder().decode(output)).toBe("до  после");
    expect(onWrite).toHaveBeenCalledWith("привет");
  });

  it("ignores clipboard queries and empty payloads", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    expect(filter.consumeString("\x1b]52;c;?\x07\x1b]52;c;\x07keep")).toBe("keep");
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("passes through unrelated OSC sequences", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const title = "\x1b]0;herdr\x07";
    expect(filter.consumeString(title)).toBe(title);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("filters clipboard writes from raw bytes without copying unrelated data", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const payload = encodePayload("bytes");
    const input = encodeLatin1(`pre\x1b]52;p;${payload}\x07post`);
    expect(Array.from(filter.consumeBytes(input))).toEqual(
      Array.from(encodeLatin1("prepost")),
    );
    expect(onWrite).toHaveBeenCalledWith("bytes");
  });

  it("returns ordinary chunks without decoding when no ESC is present", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const input = encodeLatin1("plain output");
    expect(filter.consumeBytes(input)).toBe(input);
    expect(onWrite).not.toHaveBeenCalled();
  });

  it("keeps an OSC introducer split after ESC", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const payload = encodePayload("split introducer");

    expect(filter.consumeString("visible\x1b")).toBe("visible");
    expect(filter.consumeString(`]52;c;${payload}\x07tail`)).toBe("tail");
    expect(onWrite).toHaveBeenCalledWith("split introducer");
  });

  it("recognizes BEL and ST terminators at every chunk boundary", () => {
    for (const terminator of ["\x07", "\x1b\\"] as const) {
      const payload = encodePayload(`split ${terminator === "\x07" ? "BEL" : "ST"}`);
      const frame = `prefix\x1b]52;c;${payload}${terminator}suffix`;
      for (let split = 1; split < frame.length; split += 1) {
        const onWrite = vi.fn();
        const filter = new Osc52ClipboardFilter(onWrite);
        const first = filter.consumeString(frame.slice(0, split));
        const second = filter.consumeString(frame.slice(split));

        expect(first + second, `${terminator === "\x07" ? "BEL" : "ST"} split ${split}`).toBe("prefixsuffix");
        expect(onWrite, `${terminator === "\x07" ? "BEL" : "ST"} split ${split}`).toHaveBeenCalledWith(
          `split ${terminator === "\x07" ? "BEL" : "ST"}`,
        );
      }
    }
  });

  it("preserves non-ASCII PTY bytes across every raw chunk boundary", () => {
    const frame = `\x1b]52;c;${encodePayload("clipboard")}\x07`;
    const input = encodeLatin1(`до ${frame} после`);
    const expected = encodeLatin1("до  после");

    for (let split = 1; split < input.length; split += 1) {
      const onWrite = vi.fn();
      const filter = new Osc52ClipboardFilter(onWrite);
      const first = filter.consumeBytes(input.slice(0, split));
      const second = filter.consumeBytes(input.slice(split));

      expect(Array.from(new Uint8Array([...first, ...second])), `raw split ${split}`).toEqual(Array.from(expected));
      expect(onWrite, `raw split ${split}`).toHaveBeenCalledWith("clipboard");
    }
  });

  it("discards oversized unclosed frames through BEL and ST before recovering", () => {
    for (const terminator of ["\x07", "\x1b\\"] as const) {
      const onWrite = vi.fn();
      const filter = new Osc52ClipboardFilter(onWrite);
      const oversizedPrefix = `\x1b]52;c;${"A".repeat(MAX_FRAME_BYTES)}`;
      const validFrame = `\x1b]52;c;${encodePayload("recovered")}\x07`;

      expect(filter.consumeString(oversizedPrefix)).toBe("");
      expect(filter.consumeString(`QUFB${terminator}${validFrame}tail`)).toBe("tail");
      expect(onWrite).toHaveBeenCalledOnce();
      expect(onWrite).toHaveBeenCalledWith("recovered");
    }
  });
});
