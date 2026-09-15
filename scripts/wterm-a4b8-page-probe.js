/**
 * wterm-a4b.8 — page-side probe helper (own test PTY only).
 *
 * Install once per document with `agent_browser` `eval --stdin`; the driver is
 * `wterm-a4b8-burst-probe.script.js`. It records bounded sanitized timing
 * evidence only: marks already emitted by the served bundle, long-task entries,
 * marker appearance times, heap sizes and DOM row counts. No terminal text,
 * commands, tokens, or terminal ids are captured.
 */
(() => {
  const root = () => document.querySelector(".wterm-renderer");
  const tailText = () => {
    const el = root();
    if (!el) return "";
    const rows = el.querySelectorAll(".term-row");
    const from = Math.max(0, rows.length - 4);
    let text = "";
    for (let i = from; i < rows.length; i += 1)
      text += rows[i].textContent || "";
    return text;
  };
  const api = {
    start(runId, samples) {
      performance.clearMarks();
      const state = {
        runId,
        samples,
        longTasks: [],
        markers: {},
        pending: [],
        wait: null,
        heap: performance.memory
          ? {
              used: performance.memory.usedJSHeapSize,
              total: performance.memory.totalJSHeapSize,
            }
          : null,
        domRows: document.querySelectorAll(".term-row").length,
      };
      let longTaskObserver = null;
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({
              start: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        longTaskObserver.observe({ entryTypes: ["longtask"] });
      } catch {
        longTaskObserver = null;
      }
      const scan = () => {
        const text = tailText();
        while (state.pending.length > 0) {
          const marker = state.pending[0];
          if (!text.includes(marker)) break;
          state.markers[marker] = performance.now();
          state.pending.shift();
        }
      };
      const observer = new MutationObserver(scan);
      const scroller = root();
      if (scroller) {
        observer.observe(scroller, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      }
      state.dispose = () => {
        observer.disconnect();
        longTaskObserver?.disconnect();
      };
      window.__a4b8state = state;
      return {
        runId,
        samples,
        domRows: state.domRows,
        heap: state.heap,
        longTask: longTaskObserver !== null,
        memoryApi: performance.memory !== undefined,
      };
    },
    expect(marker) {
      const state = window.__a4b8state;
      if (!state) return false;
      state.pending.push(marker);
      return true;
    },
    startWait(marker, timeoutMs) {
      const state = window.__a4b8state;
      if (!state) return false;
      const deadline = performance.now() + timeoutMs;
      state.wait = { found: false, at: null, done: false };
      const tick = () => {
        if (tailText().includes(marker)) {
          state.wait = { found: true, at: performance.now(), done: true };
          return;
        }
        if (performance.now() >= deadline) {
          state.wait = { found: false, at: null, done: true };
          return;
        }
        setTimeout(tick, 25);
      };
      setTimeout(tick, 25);
      return true;
    },
    waitStatus() {
      const state = window.__a4b8state;
      return state && state.wait
        ? state.wait
        : { found: false, at: null, done: false };
    },
    collect() {
      const state = window.__a4b8state;
      if (!state) return null;
      state.dispose?.();
      const all = performance
        .getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith("wterm."))
        .map((entry) => ({
          name: entry.name.slice("wterm.".length),
          at: entry.startTime,
          seq:
            entry.detail && typeof entry.detail.seq === "number"
              ? entry.detail.seq
              : undefined,
          bytes:
            entry.detail && typeof entry.detail.bytes === "number"
              ? entry.detail.bytes
              : undefined,
          count:
            entry.detail && typeof entry.detail.count === "number"
              ? entry.detail.count
              : undefined,
        }));
      const delivered = all.filter((mark) => mark.name === "delivered");
      const paints = all.filter((mark) => mark.name === "paint");
      let deliveredBytes = 0;
      let seqMonotonic = true;
      let firstSeq = null;
      let lastSeq = null;
      for (const mark of delivered) {
        if (typeof mark.bytes === "number") deliveredBytes += mark.bytes;
        if (typeof mark.seq === "number") {
          if (lastSeq !== null && mark.seq <= lastSeq) seqMonotonic = false;
          if (firstSeq === null) firstSeq = mark.seq;
          lastSeq = mark.seq;
        }
      }
      const kept = all.filter(
        (mark) => mark.name !== "delivered" && mark.name !== "paint",
      );
      const bounded = (list, head, tail) =>
        list.length <= head + tail
          ? list.slice()
          : [...list.slice(0, head), ...list.slice(-tail)];
      kept.push(...bounded(delivered, 100, 100), ...bounded(paints, 50, 50));
      return {
        runId: state.runId,
        marks: kept.sort((left, right) => left.at - right.at),
        delivered: {
          count: delivered.length,
          bytes: deliveredBytes,
          firstSeq,
          lastSeq,
          seqMonotonic,
        },
        paintCount: paints.length,
        longTasks: state.longTasks,
        markers: state.markers,
        heapStart: state.heap,
        heapEnd: performance.memory
          ? {
              used: performance.memory.usedJSHeapSize,
              total: performance.memory.totalJSHeapSize,
            }
          : null,
        domRowsStart: state.domRows,
        domRowsEnd: document.querySelectorAll(".term-row").length,
        now: performance.now(),
      };
    },
  };
  window.__a4b8 = api;
  return true;
})();
