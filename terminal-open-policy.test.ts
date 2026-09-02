import { describe, expect, it } from "vitest";
import {
  evaluateTerminalPresence,
  reusableTerminalId,
  terminalIdAfterListFailure,
} from "./terminal-open-policy";

const sessions = [
  { id: "term-running", status: "running" },
  { id: "term-exited", status: "exited" },
];

describe("reusableTerminalId", () => {
  it("reopens the last running terminal when no Wterm tab remains", () => {
    expect(
      reusableTerminalId({
        lastTerminalId: "term-running",
        openTabCount: 0,
        sessions,
      }),
    ).toBe("term-running");
  });

  it("creates a new terminal when another Wterm tab is open", () => {
    expect(
      reusableTerminalId({
        lastTerminalId: "term-running",
        openTabCount: 1,
        sessions,
      }),
    ).toBeNull();
  });

  it("does not reopen an exited or missing terminal", () => {
    expect(
      reusableTerminalId({
        lastTerminalId: "term-exited",
        openTabCount: 0,
        sessions,
      }),
    ).toBeNull();
    expect(
      reusableTerminalId({
        lastTerminalId: "term-missing",
        openTabCount: 0,
        sessions,
      }),
    ).toBeNull();
  });
});

describe("evaluateTerminalPresence", () => {
  it("keeps a running terminal ready", () => {
    expect(
      evaluateTerminalPresence({
        attempt: 1,
        sessions,
        terminalId: "term-running",
      }),
    ).toBe("ready");
  });

  it("retries transient list failures instead of tearing the panel down", () => {
    expect(
      evaluateTerminalPresence({
        attempt: 1,
        sessions: null,
        terminalId: "term-running",
      }),
    ).toBe("retry");
    expect(
      evaluateTerminalPresence({
        attempt: 3,
        sessions: null,
        terminalId: "term-running",
      }),
    ).toBe("ready");
  });

  it("retries a missing id a few times before treating it as gone", () => {
    expect(
      evaluateTerminalPresence({
        attempt: 1,
        sessions,
        terminalId: "term-missing",
      }),
    ).toBe("retry");
    expect(
      evaluateTerminalPresence({
        attempt: 3,
        sessions,
        terminalId: "term-missing",
      }),
    ).toBe("missing");
  });

  it("treats an exited session as missing", () => {
    expect(
      evaluateTerminalPresence({
        attempt: 1,
        sessions,
        terminalId: "term-exited",
      }),
    ).toBe("missing");
  });
});

describe("terminalIdAfterListFailure", () => {
  it("reuses the last terminal when no Wterm tab is open", () => {
    expect(
      terminalIdAfterListFailure({
        lastTerminalId: "term-running",
        openTabCount: 0,
      }),
    ).toBe("term-running");
  });

  it("does not reuse while another Wterm tab is already opening", () => {
    expect(
      terminalIdAfterListFailure({
        lastTerminalId: "term-running",
        openTabCount: 1,
      }),
    ).toBeNull();
  });
});
