import { describe, expect, it } from "vitest";
import {
  parsePickerSessions,
  partitionRunningExited,
  pickerStateFromRpc,
} from "./picker-state";

const running = {
  id: "term-running",
  title: "Shell",
  initialCwd: "/tmp",
  status: "running",
  updatedAt: 1,
  lastUserInputAt: null,
};
const unavailable = {
  ...running,
  id: "term-zombie",
  status: "unavailable",
};

describe("pickerStateFromRpc", () => {
  it("treats a successful list as loaded, not loading or failed", () => {
    expect(
      pickerStateFromRpc({ status: "fulfilled", value: [running] }),
    ).toEqual({ kind: "loaded", items: [running] });
  });

  it("keeps an empty success distinct from a failed list", () => {
    expect(pickerStateFromRpc({ status: "fulfilled", value: [] })).toEqual({
      kind: "loaded",
      items: [],
    });
    expect(
      pickerStateFromRpc({
        status: "rejected",
        reason: new Error("offline"),
      }),
    ).toEqual({ kind: "failed", message: "offline" });
  });

  it("does not collapse a malformed success into an empty loaded list", () => {
    expect(
      pickerStateFromRpc({ status: "fulfilled", value: { sessions: [] } }),
    ).toEqual({ kind: "failed", message: "Could not list sessions" });
  });
});

describe("partitionRunningExited", () => {
  it("puts unavailable synthetic sessions in Exited, not Running", () => {
    expect(partitionRunningExited([running, unavailable])).toEqual({
      running: [running],
      exited: [unavailable],
    });
  });
});

describe("parsePickerSessions", () => {
  it("drops rows without an id or status", () => {
    expect(parsePickerSessions([running, { title: "nope" }, null])).toEqual([
      running,
    ]);
  });
});
