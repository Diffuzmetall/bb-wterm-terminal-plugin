# Wterm performance baseline

This baseline measures transport replay and the browser-visible startup/input path
without collecting terminal content, commands, tokens, or full URLs. Instrumentation
is off by default. Enable the browser marks only with the explicit query flag
`?wterm_perf=1`.

## Deterministic replay

Run the default replay benchmark from the repository root:

```sh
node --experimental-strip-types wterm-performance-baseline.mjs replay --output /tmp/wterm-replay.json
node --experimental-strip-types wterm-performance-baseline.mjs summarize --input /tmp/wterm-replay.json --output /tmp/wterm-replay-summary.json
```

The defaults are `warmup=100`, sizes `1000,5000,10000,30000`, and `runs=5`.
A bounded smoke run is:

```sh
node --experimental-strip-types wterm-performance-baseline.mjs replay --sizes 100,500 --warmup 10 --runs 2 --output /tmp/wterm-a4b.4-replay-smoke.json
node --experimental-strip-types wterm-performance-baseline.mjs summarize --input /tmp/wterm-a4b.4-replay-smoke.json --output /tmp/wterm-a4b.4-replay-summary.json
```

`replay` imports the real `LegacyTerminalAttachment` and uses an offline WebSocket
only to feed prebuilt JSON messages. JSON is built before each timed run. Every
run must deliver exactly `size` chunks, with strictly increasing sequence numbers,
and the same SHA-256 of the concatenated output bytes. The output schema contains
only sizes, timings, statistics, and validation metadata. `runsMs` is retained for
later review; p50/p95 use nearest rank. Invalid options, oversized inputs, missing
validation, and malformed JSON fail with a nonzero exit.

## Browser procedure

Use the native `agent_browser` tool, not a shell browser CLI. Start the existing
BB/dev server if available and open the plugin with `?wterm_perf=1` in the query.
Keep the URL itself out of artifacts; record only a route label such as
`wterm-panel`.

For each scenario:

1. Use `agent_browser` `open` and one `snapshot -i` to confirm the terminal control.
2. Capture at least **20 opens** of the same controlled terminal scenario. Record
   only mark durations and pass/fail validation, never DOM terminal text.
3. Capture at least **100 input samples** using the existing terminal input control.
   Count the samples; do not record key values, commands, output, tokens, or URLs.
4. Repeat the matrix separately for cold and warm runs. Cold means a fresh page or
   cleared asset/session state; warm means the same page and cached assets after one
   setup open. Do not mix the distributions.
5. Repeat each distribution with the profiler disabled and enabled. Profiler-on
   numbers are diagnostic and must not be compared as if they were profiler-off
   performance.
6. Re-snapshot after navigation, structural changes, or stale references. Use
   screenshots only for layout/paint confirmation and redact them before sharing.

The mark sequence to correlate is `effect-start`, `core-ready`, `ws-open`,
`attached`, `replay-complete`, `keydown`, `send`, `echo`, `delivered`, `paint`,
`first-rows`, and `first-paint`. Marks expose only timestamps plus allow-listed
integer `seq`, `bytes`, and `count` detail. Pair an `echo` with the next `paint`
carrying the same sequence number; use an idle owned shell and one input sample at
a time so unrelated output cannot be mistaken for echo. Missing required marks,
noisy samples, dropped samples, or failed ordering/hash checks are
**inconclusive**, never zero-filled and never silently removed from a report.

Before each series in the isolated test page, clear prior diagnostic marks with
`performance.clearMarks()`.
Collect `performance.getEntriesByType("mark")`, keep entries whose names start
with `wterm.`, and copy only `name`, `startTime`, and numeric `detail.seq`,
`detail.bytes`, or `detail.count` into the raw JSON.

Summarize each browser distribution with the same CLI:

```sh
node --experimental-strip-types wterm-performance-baseline.mjs summarize \
  --input /tmp/wterm-browser-raw.json \
  --output /tmp/wterm-browser-summary.json
```

The browser input schema is:

```json
{
  "schema": "wterm-performance-browser/v1",
  "operation": "browser",
  "scenario": "input",
  "cache": "warm",
  "profiler": false,
  "series": [{
    "name": "echo-to-paint",
    "requiredMarks": ["echo", "paint"],
    "noisy": false,
    "samples": [{
      "startMs": 10.1,
      "endMs": 21.4,
      "missingMarks": [],
      "seq": 42
    }]
  }]
}
```

Use a separate file for every scenario/cache/profiler combination. The summary
preserves those labels, reports `sampleCount`, and emits p50/p95/min/max or an
explicit `inconclusive` reason.

If Resource Timing is inspected, retain only sanitized aggregates (resource kind,
request phase, duration, transfer-size bucket, and count). Remove URL, path,
query, initiator URL, headers, response body, terminal ID, and any user data before
saving results.

## Acceptance targets

Use fixed workload and environment for before/after comparisons:

- feedback p95 <= **50 ms**;
- switch p95 <= **100 ms**;
- echo-to-paint <= **2 frames**;
- unaffected operation p95 regression <= **10%**.

A target is not PASS when its required marks are absent or its sample set is noisy;
report it as inconclusive with the reason. Keep cold/warm and profiler/no-profiler
results in separate files or clearly separate sections.

## Reproducibility and privacy

Record the measurement date, OS/runtime, browser and BB versions, plugin commit,
installed `@wterm/*` versions, and SHA-256 hashes of the plugin bundle/WASM and
benchmark input schema. Do not record user names, terminal IDs, working directories, commands, output, tokens, cookies, full URLs, or raw traces. Keep
raw run values only for sanitized synthetic replay or duration samples. An
environment/version/hash mismatch invalidates a before/after comparison rather
than being normalized away.
