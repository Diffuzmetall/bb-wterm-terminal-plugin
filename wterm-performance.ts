export const WTERM_PERFORMANCE_MARKS = [
  "effect-start",
  "preload-ready",
  "core-ready",
  "ws-open",
  "attached",
  "replay-complete",
  "keydown",
  "send",
  "echo",
  "delivered",
  "paint",
  "first-rows",
  "first-paint",
  "write-start",
  "write-end",
  "queued",
  "drain-start",
  "drain-end",
  "stream-digest",
  "resize-request",
  "resize-send",
  "write-failure",
] as const;

export type WtermPerformanceMark = (typeof WTERM_PERFORMANCE_MARKS)[number];

export interface WtermPerformanceMarkMetadata {
  seq?: number;
  bytes?: number;
  count?: number;
  digest?: number;
  cols?: number;
  rows?: number;
}

export interface WtermPerformanceStats {
  p50: number;
  p95: number;
  min: number;
  max: number;
  count: number;
}

export interface WtermPerformanceSummary {
  status: "ok" | "inconclusive";
  stats: WtermPerformanceStats | null;
  reason?: "empty-samples" | "missing-required-marks" | "invalid-samples";
}

const markNames = new Set<string>(WTERM_PERFORMANCE_MARKS);
const PERF_PREFIX = "wterm.";

export function isWtermPerformanceEnabled(search?: string): boolean {
  const query =
    search ??
    (typeof window !== "undefined" && window.location
      ? window.location.search
      : "");
  try {
    return new URLSearchParams(query).get("wterm_perf") === "1";
  } catch {
    return false;
  }
}

/** Calculate nearest-rank statistics without inventing samples. */
export function nearestRankStats(
  samples: readonly number[],
): WtermPerformanceStats | null {
  if (samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    return null;
  }
  const values = [...samples].sort((left, right) => left - right);
  if (values.length === 0) return null;
  const minimum = values.at(0);
  const maximum = values.at(-1);
  if (minimum === undefined || maximum === undefined) return null;
  const nearestRank = (percentile: number) =>
    values[Math.max(0, Math.ceil(percentile * values.length) - 1)] ?? minimum;
  return {
    p50: nearestRank(0.5),
    p95: nearestRank(0.95),
    min: minimum,
    max: maximum,
    count: values.length,
  };
}

export function summarizePerformance(
  samples: readonly number[],
  requiredMarks: readonly WtermPerformanceMark[] = [],
  presentMarks: ReadonlySet<WtermPerformanceMark> = new Set(),
): WtermPerformanceSummary {
  if (requiredMarks.some((mark) => !presentMarks.has(mark))) {
    return {
      status: "inconclusive",
      stats: null,
      reason: "missing-required-marks",
    };
  }
  const stats = nearestRankStats(samples);
  if (!stats) {
    return {
      status: "inconclusive",
      stats: null,
      reason: samples.length === 0 ? "empty-samples" : "invalid-samples",
    };
  }
  return { status: "ok", stats };
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export class WtermPerformance {
  readonly enabled: boolean;
  private readonly times = new Map<WtermPerformanceMark, number[]>();

  constructor(search?: string) {
    this.enabled = isWtermPerformanceEnabled(search);
  }

  mark(
    name: WtermPerformanceMark,
    metadata?: WtermPerformanceMarkMetadata,
  ): void {
    if (!this.enabled || !markNames.has(name)) return;
    const timestamp = now();
    const values = this.times.get(name) ?? [];
    values.push(timestamp);
    this.times.set(name, values);
    const detail = Object.fromEntries(
      Object.entries(metadata ?? {}).filter(
        ([key, value]) =>
          (key === "seq" ||
            key === "bytes" ||
            key === "count" ||
            key === "digest" ||
            key === "cols" ||
            key === "rows") &&
          Number.isSafeInteger(value) &&
          value >= 0,
      ),
    );
    try {
      performance.mark(`${PERF_PREFIX}${name}`, {
        detail: Object.keys(detail).length === 0 ? undefined : detail,
      });
    } catch {
      // Performance marks are diagnostic only; never affect terminal behavior.
    }
  }

  marks(name: WtermPerformanceMark): readonly number[] {
    return this.times.get(name)?.slice() ?? [];
  }

  measure(start: WtermPerformanceMark, end: WtermPerformanceMark): number[] {
    const starts = this.times.get(start) ?? [];
    const ends = this.times.get(end) ?? [];
    const count = Math.min(starts.length, ends.length);
    const durations: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const start = starts[index];
      const end = ends[index];
      if (start === undefined || end === undefined) continue;
      const duration = end - start;
      if (Number.isFinite(duration) && duration >= 0) durations.push(duration);
    }
    return durations;
  }

  summarize(
    samples: readonly number[],
    requiredMarks: readonly WtermPerformanceMark[] = [],
  ): WtermPerformanceSummary {
    const present = new Set<WtermPerformanceMark>();
    for (const mark of requiredMarks) {
      if ((this.times.get(mark)?.length ?? 0) > 0) present.add(mark);
    }
    return summarizePerformance(samples, requiredMarks, present);
  }

  clear(): void {
    this.times.clear();
    if (!this.enabled) return;
    for (const mark of WTERM_PERFORMANCE_MARKS) {
      try {
        globalThis.performance?.clearMarks(`${PERF_PREFIX}${mark}`);
      } catch {
        // Diagnostic cleanup is best effort.
      }
    }
  }
}

/**
 * FNV-1a (32 bit) over the bytes handed to the terminal core, in delivery
 * order. Probe-only: it detects dropped, duplicated or reordered chunks in a
 * controlled burst run and is not a cryptographic digest. Carries no payload.
 */
export class WtermStreamDigest {
  private hash = 0x811c9dc5;
  private bytes = 0;
  private count = 0;

  update(chunk: Uint8Array): void {
    let hash = this.hash;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      hash ^= chunk[index];
      hash = Math.imul(hash, 0x01000193);
    }
    this.hash = hash >>> 0;
    this.bytes += chunk.byteLength;
    this.count += 1;
  }

  snapshot(): { digest: number; bytes: number; count: number } {
    return { digest: this.hash, bytes: this.bytes, count: this.count };
  }

  reset(): void {
    this.hash = 0x811c9dc5;
    this.bytes = 0;
    this.count = 0;
  }
}

export const wtermPerformance = new WtermPerformance();

export function markWtermPerformance(
  name: WtermPerformanceMark,
  metadata?: WtermPerformanceMarkMetadata,
): void {
  wtermPerformance.mark(name, metadata);
}
