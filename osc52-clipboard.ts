const OSC_INTRODUCER = "\x1b]";
const BEL = "\x07";
const ST = "\x1b\\";
const MAX_CARRY_CHARS = 1_048_576;
const CLIPBOARD_SPECIFIERS = new Set(["", "c", "p", "s", "0", "1", "2", "3", "4", "5", "6", "7"]);
const latin1Decoder = new TextDecoder("latin1");

export function decodeLatin1(bytes: Uint8Array): string {
  return latin1Decoder.decode(bytes);
}

export function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
  }
  return bytes;
}

export function decodeOsc52Payload(base64: string): string | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") return false;
  let field: { remove(): void } | null = null;
  try {
    field = document.createElement("textarea") as HTMLTextAreaElement;
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.append(field);
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field?.remove();
  }
}

let pendingClipboardText: string | null = null;

export function peekPendingClipboardText(): string | null {
  return pendingClipboardText;
}

export function queueClipboardText(text: string): void {
  if (text.length === 0) return;
  pendingClipboardText = text;
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard?.writeText) return;
  void clipboard.writeText(text).then(
    () => {
      if (pendingClipboardText === text) pendingClipboardText = null;
    },
    () => {},
  );
}

export function copyTextToClipboard(text: string): void {
  if (text.length === 0) return;
  pendingClipboardText = text;
  if (copyWithExecCommand(text)) {
    pendingClipboardText = null;
    return;
  }
  queueClipboardText(text);
}

export function flushPendingClipboardCopy(): void {
  if (pendingClipboardText) copyTextToClipboard(pendingClipboardText);
}

export class Osc52ClipboardFilter {
  private carry = "";

  constructor(private readonly onWrite: (text: string) => void = queueClipboardText) {}

  consumeString(text: string): string {
    return this.consume(text);
  }

  consumeBytes(data: Uint8Array): Uint8Array {
    if (this.carry.length === 0 && data.indexOf(0x1b) < 0) return data;
    const decoded = decodeLatin1(data);
    const next = this.consume(decoded);
    return next === decoded ? data : encodeLatin1(next);
  }

  private consume(text: string): string {
    const stream = this.carry + text;
    let output = "";
    let cursor = 0;

    while (cursor < stream.length) {
      const start = stream.indexOf(OSC_INTRODUCER, cursor);
      if (start < 0) {
        output += stream.slice(cursor);
        this.carry = "";
        return output;
      }

      output += stream.slice(cursor, start);
      const bodyStart = start + OSC_INTRODUCER.length;
      if (stream.length - bodyStart < 3) {
        this.carry = this.boundedCarry(stream.slice(start));
        return output;
      }

      if (!stream.startsWith("52;", bodyStart)) {
        const nextIntroducer = stream.indexOf(OSC_INTRODUCER, start + 1);
        if (nextIntroducer < 0) {
          output += stream.slice(start);
          this.carry = "";
          return output;
        }
        output += stream.slice(start, nextIntroducer);
        cursor = nextIntroducer;
        continue;
      }

      const payloadStart = bodyStart + 3;
      const bel = stream.indexOf(BEL, payloadStart);
      const st = stream.indexOf(ST, payloadStart);
      const end =
        bel >= 0 && (st < 0 || bel <= st)
          ? bel
          : st >= 0
            ? st
            : -1;
      const terminatorLength = end === bel ? 1 : 2;
      if (end < 0) {
        this.carry = this.boundedCarry(stream.slice(start));
        return output;
      }

      this.handlePayload(stream.slice(payloadStart, end));
      cursor = end + terminatorLength;
    }

    this.carry = "";
    return output;
  }

  private boundedCarry(value: string): string {
    return value.length > MAX_CARRY_CHARS ? "" : value;
  }

  private handlePayload(payload: string): void {
    const separator = payload.indexOf(";");
    if (separator < 0) return;
    const specifier = payload.slice(0, separator);
    const data = payload.slice(separator + 1);
    if (!CLIPBOARD_SPECIFIERS.has(specifier) || data.length === 0 || data === "?") {
      return;
    }
    const text = decodeOsc52Payload(data);
    if (text) this.onWrite(text);
  }
}
