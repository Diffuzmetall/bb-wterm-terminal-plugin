import { describe, expect, it } from "vitest";
import {
  DEAD_TERMINAL_GRACE_MS,
  nextLinkedRecords,
  nextLinkedTerminalIds,
  parseLinkedRecords,
  reconcileLinkedRecords,
} from "./linked-terminal-records";

describe("parseLinkedRecords", () => {
  it("loads legacy string arrays as live records", () => {
    expect(parseLinkedRecords(["term-a", "term-b"])).toEqual([
      { id: "term-a", firstUnavailableAt: null },
      { id: "term-b", firstUnavailableAt: null },
    ]);
  });

  it("keeps numeric stamps and skips junk", () => {
    expect(
      parseLinkedRecords([
        { id: "term-a", firstUnavailableAt: 10 },
        { id: 1 },
        null,
        { firstUnavailableAt: 1 },
        { id: "term-b" },
      ]),
    ).toEqual([
      { id: "term-a", firstUnavailableAt: 10 },
      { id: "term-b", firstUnavailableAt: null },
    ]);
  });
});

describe("nextLinkedRecords", () => {
  it("clears the stamp on a live host get", () => {
    expect(
      nextLinkedRecords(
        [{ id: "term-a", firstUnavailableAt: 1 }],
        [{ status: "fulfilled", value: { id: "term-a" } }],
        100,
      ),
    ).toEqual([{ id: "term-a", firstUnavailableAt: null }]);
  });

  it("keeps a rejected id inside the grace window", () => {
    expect(
      nextLinkedRecords(
        [{ id: "term-a", firstUnavailableAt: null }],
        [{ status: "rejected", reason: new Error("timeout") }],
        1_000,
      ),
    ).toEqual([{ id: "term-a", firstUnavailableAt: 1_000 }]);
    expect(
      nextLinkedRecords(
        [{ id: "term-a", firstUnavailableAt: 1_000 }],
        [{ status: "rejected", reason: new Error("timeout") }],
        1_000 + DEAD_TERMINAL_GRACE_MS,
      ),
    ).toEqual([{ id: "term-a", firstUnavailableAt: 1_000 }]);
  });

  it("drops a rejected id after the grace window", () => {
    expect(
      nextLinkedRecords(
        [{ id: "term-a", firstUnavailableAt: 1_000 }],
        [{ status: "rejected", reason: new Error("timeout") }],
        1_000 + DEAD_TERMINAL_GRACE_MS + 1,
      ),
    ).toEqual([]);
  });
});

describe("nextLinkedTerminalIds", () => {
  it("does not drop a linked id from a rejected lookup within grace", () => {
    expect(
      nextLinkedTerminalIds(
        ["term-a", "term-b"],
        [
          { status: "rejected", reason: new Error("timeout") },
          { status: "fulfilled", value: { id: "term-b" } },
        ],
        0,
      ),
    ).toEqual(["term-a", "term-b"]);
  });
});

describe("reconcileLinkedRecords", () => {
  it("keeps a concurrently remembered id and remaps replacements", () => {
    expect(
      reconcileLinkedRecords(
        [
          { id: "term-old", firstUnavailableAt: null },
          { id: "term-new", firstUnavailableAt: null },
        ],
        [{ id: "term-old", firstUnavailableAt: null }],
        [{ status: "fulfilled", value: { id: "term-replaced" } }],
        0,
      ),
    ).toEqual([
      { id: "term-replaced", firstUnavailableAt: null },
      { id: "term-new", firstUnavailableAt: null },
    ]);
  });
});
