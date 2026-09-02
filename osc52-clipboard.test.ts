import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Osc52ClipboardFilter,
  copyTextToClipboard,
  decodeOsc52Payload,
  encodeLatin1,
  flushPendingClipboardCopy,
  peekPendingClipboardText,
  queueClipboardText,
} from "./osc52-clipboard";

function encodePayload(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

afterEach(() => {
  vi.unstubAllGlobals();
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
  it("copies with execCommand during the gesture even when writeText exists", () => {
    const writeText = vi.fn(() => Promise.reject(new Error("no activation")));
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
    expect(writeText).not.toHaveBeenCalled();
    expect(peekPendingClipboardText()).toBeNull();
  });

  it("does not mutate the DOM when OSC 52 arrives during a PTY write", () => {
    const writeText = vi.fn(() => Promise.resolve());
    const execCommand = vi.fn(() => true);
    const createElement = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement,
      execCommand,
      body: { append: vi.fn() },
    });

    queueClipboardText("herdr");

    expect(createElement).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("herdr");
    expect(peekPendingClipboardText()).toBe("herdr");
  });

  it("keeps OSC 52 text pending when the gesture is already gone", () => {
    const writeText = vi.fn(() => Promise.reject(new Error("no activation")));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      createElement: () => {
        throw new Error("no document");
      },
      execCommand: () => false,
      body: { append: vi.fn() },
    });

    copyTextToClipboard("herdr");
    expect(peekPendingClipboardText()).toBe("herdr");

    const execCommand = vi.fn(() => true);
    const field = {
      value: "",
      style: { position: "", left: "" },
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: () => field,
      execCommand,
      body: { append: vi.fn() },
    });
    flushPendingClipboardCopy();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(peekPendingClipboardText()).toBeNull();
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

  it("copies an ST-terminated sequence split across chunks", () => {
    const onWrite = vi.fn();
    const filter = new Osc52ClipboardFilter(onWrite);
    const payload = encodePayload("split");
    expect(filter.consumeString(`\x1b]52;c;${payload.slice(0, 2)}`)).toBe("");
    expect(onWrite).not.toHaveBeenCalled();
    expect(filter.consumeString(`${payload.slice(2)}\x1b\\tail`)).toBe("tail");
    expect(onWrite).toHaveBeenCalledWith("split");
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
});
