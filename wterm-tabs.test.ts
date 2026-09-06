import { describe, expect, it } from "vitest";
import {
  activeWtermTabId,
  createWtermTabPreference,
  normalizeWtermTabName,
  nextWtermTabIdAfterClose,
  parseWtermTabPreference,
  reorderWtermTabs,
  restoreWtermTabs,
} from "./wterm-tabs.js";

const sessions = [{ id: "term-a" }, { id: "term-b" }, { id: "term-c" }];

describe("standalone Wterm tab preference", () => {
  it("restores only an active tab from the same host and current workspace", () => {
    expect(
      activeWtermTabId(
        sessions,
        parseWtermTabPreference(
          JSON.stringify({
            schemaVersion: 1,
            hostId: "host-1",
            activeTerminalId: "term-b",
          }),
        ),
        "host-1",
      ),
    ).toBe("term-b");
    expect(
      activeWtermTabId(
        sessions,
        parseWtermTabPreference(
          JSON.stringify({
            schemaVersion: 1,
            hostId: "other-host",
            activeTerminalId: "term-b",
          }),
        ),
        "host-1",
      ),
    ).toBe("term-a");
    expect(
      activeWtermTabId(
        sessions,
        parseWtermTabPreference(
          JSON.stringify({
            schemaVersion: 1,
            hostId: "host-1",
            activeTerminalId: "foreign-terminal",
          }),
        ),
        "host-1",
      ),
    ).toBe("term-a");
  });

  it("keeps the selected tab unless it closes, then chooses its neighbour", () => {
    expect(nextWtermTabIdAfterClose(sessions, "term-a", "term-c")).toBe(
      "term-c",
    );
    expect(nextWtermTabIdAfterClose(sessions, "term-b", "term-b")).toBe(
      "term-c",
    );
    expect(nextWtermTabIdAfterClose(sessions, "term-c", "term-c")).toBe(
      "term-b",
    );
    expect(
      nextWtermTabIdAfterClose([{ id: "term-a" }], "term-a", "term-a"),
    ).toBeNull();
  });

  it("restores persisted names and order without adopting foreign tabs", () => {
    const preference = createWtermTabPreference(
      [
        { id: "term-c", title: "Logs" },
        { id: "term-a", title: "API" },
        { id: "foreign", title: "Ignore me" },
      ],
      "host-1",
      "term-c",
    );

    expect(
      restoreWtermTabs(
        [
          { id: "term-a", title: "Wterm" },
          { id: "term-b", title: "Wterm" },
          { id: "term-c", title: "Wterm" },
        ],
        preference,
        "host-1",
      ),
    ).toEqual([
      { id: "term-c", title: "Logs" },
      { id: "term-a", title: "API" },
      { id: "term-b", title: "Wterm" },
    ]);
  });

  it("reorders tabs only when both ids belong to the workspace", () => {
    expect(
      reorderWtermTabs(sessions, "term-c", "term-a").map(({ id }) => id),
    ).toEqual(["term-c", "term-a", "term-b"]);
    expect(reorderWtermTabs(sessions, "foreign", "term-a")).toBe(sessions);
  });

  it("accepts bounded nonempty names and rejects malformed persisted state", () => {
    expect(normalizeWtermTabName("  API logs  ")).toBe("API logs");
    expect(normalizeWtermTabName("   ")).toBeNull();
    expect(normalizeWtermTabName("x".repeat(65))).toBeNull();
    expect(parseWtermTabPreference("not json")).toBeNull();
    expect(
      parseWtermTabPreference(JSON.stringify({ schemaVersion: 2 })),
    ).toBeNull();
    expect(
      parseWtermTabPreference(
        JSON.stringify({
          schemaVersion: 2,
          hostId: "host-1",
          activeTerminalId: "term-a",
          tabs: [{ id: "term-a", name: "" }],
        }),
      ),
    ).toBeNull();
  });
});
