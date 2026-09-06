import { afterEach, describe, expect, it } from "vitest";
import {
  WtermPerformance,
  nearestRankStats,
  summarizePerformance,
} from "./wterm-performance";

afterEach(() => {
  performance.clearMarks();
});

describe("wterm performance instrumentation", () => {
  it("is disabled unless the explicit query flag is 1", () => {
    const disabled = new WtermPerformance("?wterm_perf=0");
    disabled.mark("send", { bytes: 4 });

    expect(disabled.enabled).toBe(false);
    expect(disabled.marks("send")).toEqual([]);
    expect(performance.getEntriesByName("wterm.send")).toHaveLength(0);
  });

  it("calculates nearest-rank stats from unsorted samples", () => {
    expect(nearestRankStats([30, 10, 40, 20])).toEqual({
      p50: 20,
      p95: 40,
      min: 10,
      max: 40,
      count: 4,
    });
  });

  it("returns no stats for empty samples", () => {
    expect(nearestRankStats([])).toBeNull();
    expect(summarizePerformance([], [], new Set())).toEqual({
      status: "inconclusive",
      stats: null,
      reason: "empty-samples",
    });
  });

  it("reports missing required marks as inconclusive", () => {
    expect(
      summarizePerformance(
        [12],
        ["effect-start", "core-ready"],
        new Set(["effect-start"]),
      ),
    ).toEqual({
      status: "inconclusive",
      stats: null,
      reason: "missing-required-marks",
    });
  });

  it("records only sanitized numeric metadata", () => {
    const recorder = new WtermPerformance("?wterm_perf=1");
    recorder.mark("echo", {
      seq: 7,
      bytes: 2,
      count: 1,
      ...({ payload: "secret" } as Record<string, unknown>),
    });

    expect(performance.getEntriesByName("wterm.echo")[0]).toMatchObject({
      detail: { seq: 7, bytes: 2, count: 1 },
    });
  });

  it("does not fabricate zeros for missing or invalid measurements", () => {
    const recorder = new WtermPerformance("?wterm_perf=1");
    recorder.mark("keydown");
    expect(recorder.measure("keydown", "send")).toEqual([]);
    expect(nearestRankStats([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull();
    expect(recorder.summarize([], ["keydown", "send"])).toEqual({
      status: "inconclusive",
      stats: null,
      reason: "missing-required-marks",
    });
  });
});
