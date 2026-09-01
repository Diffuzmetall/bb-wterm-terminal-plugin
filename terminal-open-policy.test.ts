import { describe, expect, it } from "vitest";
import { reusableTerminalId } from "./terminal-open-policy";

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
