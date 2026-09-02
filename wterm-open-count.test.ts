import { afterEach, describe, expect, it } from "vitest";
import {
  beginWtermOpen,
  resetWtermOpenCounts,
  trackWtermMount,
  wtermOpenCount,
} from "./wterm-open-count";

afterEach(() => {
  resetWtermOpenCounts();
});

describe("wtermOpenCount", () => {
  it("counts a pending open before the panel mounts so a second run does not reuse", () => {
    expect(wtermOpenCount("thread-1")).toBe(0);
    beginWtermOpen("thread-1");
    expect(wtermOpenCount("thread-1")).toBe(1);
    beginWtermOpen("thread-1");
    expect(wtermOpenCount("thread-1")).toBe(2);
  });

  it("moves a pending open onto the mounted tab and drops it on unmount", () => {
    beginWtermOpen("thread-1");
    const unmount = trackWtermMount("thread-1");
    expect(wtermOpenCount("thread-1")).toBe(1);
    unmount();
    expect(wtermOpenCount("thread-1")).toBe(0);
  });

  it("releases a pending open when panel creation fails", () => {
    const cancel = beginWtermOpen("thread-1");
    cancel();
    expect(wtermOpenCount("thread-1")).toBe(0);
  });

  it("keeps the mounted count across a Strict Mode remount without a new run", () => {
    beginWtermOpen("thread-1");
    const first = trackWtermMount("thread-1");
    first();
    const second = trackWtermMount("thread-1");
    expect(wtermOpenCount("thread-1")).toBe(1);
    second();
    expect(wtermOpenCount("thread-1")).toBe(0);
  });
});
