#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { LegacyTerminalAttachment } from "./terminal-attachment.ts";
import {
  WTERM_PERFORMANCE_MARKS,
  nearestRankStats,
} from "./wterm-performance.ts";

const DEFAULT_SIZES = [1000, 5000, 10000, 30000];
const DEFAULT_WARMUP = 100;
const DEFAULT_RUNS = 5;
const MAX_SIZES = 20;
const MAX_CHUNKS = 1_000_000;
const MAX_RUNS = 100;
const PERFORMANCE_MARKS = new Set(WTERM_PERFORMANCE_MARKS);

class OfflineWebSocket {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = OfflineWebSocket.CONNECTING;
  onclose = null;
  onmessage = null;
  onopen = null;

  constructor(endpoint) {
    this.endpoint = endpoint;
    OfflineWebSocket.instances.push(this);
  }

  open() {
    this.readyState = OfflineWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  receiveRaw(data) {
    this.onmessage?.({ data });
  }

  send() {}

  close() {
    this.readyState = OfflineWebSocket.CLOSED;
  }
}

globalThis.window = { location: { protocol: "http:", host: "offline" } };
globalThis.WebSocket = OfflineWebSocket;

function fail(message) {
  throw new Error(message);
}

function parseInteger(value, name, { min, max }) {
  if (!/^\d+$/.test(value))
    fail(`${name} must be an integer from ${min} to ${max}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    fail(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function parseSizes(value) {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_SIZES) {
    fail(`--sizes must contain 1-${MAX_SIZES} comma-separated values`);
  }
  const sizes = parts.map((part) =>
    parseInteger(part, "size", { min: 1, max: MAX_CHUNKS }),
  );
  if (new Set(sizes).size !== sizes.length)
    fail("--sizes must not contain duplicates");
  return sizes;
}

function parseArgs(argv) {
  const command = argv[0];
  if (command !== "replay" && command !== "summarize") {
    fail(
      "usage: node --experimental-strip-types wterm-performance-baseline.mjs <replay|summarize> [options]",
    );
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag?.startsWith("--")) fail(`unexpected argument: ${flag ?? ""}`);
    const separator = flag.indexOf("=", 2);
    const name = separator === -1 ? flag.slice(2) : flag.slice(2, separator);
    if (!["sizes", "warmup", "runs", "output", "input"].includes(name)) {
      fail(`unknown option: ${flag}`);
    }
    const value = separator === -1 ? argv[++index] : flag.slice(separator + 1);
    if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
    options[name] = value;
  }
  if (command === "summarize" && !options.input) {
    fail("summarize requires --input <replay.json>");
  }
  if (command === "replay" && options.input)
    fail("replay does not accept --input");
  if (
    command === "summarize" &&
    (options.sizes || options.warmup || options.runs)
  ) {
    fail("summarize accepts only --input and --output");
  }
  return { command, options };
}

function buildMessages(size) {
  const encoded = Buffer.from("x").toString("base64");
  return Array.from({ length: size }, (_, seq) =>
    JSON.stringify({ type: "output", chunk: { seq, dataBase64: encoded } }),
  );
}

function expectedSha256(size) {
  return createHash("sha256").update(Buffer.alloc(size, 0x78)).digest("hex");
}

function replayTrial(size, messages) {
  const attachment = new LegacyTerminalAttachment("offline-benchmark");
  const sequences = [];
  const hash = createHash("sha256");
  attachment.subscribe(({ seq, bytes }) => {
    sequences.push(seq);
    hash.update(bytes);
  });
  attachment.connect();
  const socket = OfflineWebSocket.instances.at(-1);
  if (!socket) fail("offline WebSocket was not created");
  socket.open();
  socket.receiveRaw(JSON.stringify({ type: "attached", nextSeq: size }));

  const started = performance.now();
  for (const message of messages) socket.receiveRaw(message);
  const elapsedMs = performance.now() - started;

  if (sequences.length !== size) {
    fail(`replay delivered ${sequences.length} chunks, expected ${size}`);
  }
  for (let index = 0; index < sequences.length; index += 1) {
    if (sequences[index] !== index)
      fail(`replay sequence is not strictly ordered at index ${index}`);
  }
  const sha256 = hash.digest("hex");
  if (sha256 !== expectedSha256(size))
    fail(`replay SHA-256 mismatch for ${size} chunks`);
  attachment.detach();
  return { elapsedMs, count: sequences.length, sha256 };
}

function runReplay({ sizes, warmup, runs }) {
  const results = [];
  for (const size of sizes) {
    const messages = buildMessages(size);
    const warmupMessages = messages.slice(0, Math.min(warmup, size));
    if (warmupMessages.length > 0)
      replayTrial(warmupMessages.length, warmupMessages);
    const measured = Array.from({ length: runs }, () =>
      replayTrial(size, messages),
    );
    const runsMs = measured.map(({ elapsedMs }) => elapsedMs);
    const stats = nearestRankStats(runsMs);
    if (!stats) fail(`no valid timings for ${size} chunks`);
    results.push({
      size,
      runsMs,
      stats,
      validation: {
        count: measured[0].count,
        strictlyOrderedSeq: true,
        sha256: measured[0].sha256,
      },
    });
  }
  return {
    schema: "wterm-performance-baseline/v1",
    operation: "replay",
    warmup,
    runs,
    results,
  };
}

function validateReplayDocument(document) {
  if (
    !document ||
    document.schema !== "wterm-performance-baseline/v1" ||
    document.operation !== "replay"
  ) {
    fail("input is not a wterm replay baseline document");
  }
  if (
    !Number.isSafeInteger(document.warmup) ||
    document.warmup < 0 ||
    document.warmup > MAX_CHUNKS
  )
    fail("input has invalid warmup");
  if (
    !Number.isSafeInteger(document.runs) ||
    document.runs < 1 ||
    document.runs > MAX_RUNS
  )
    fail("input has invalid run count");
  if (
    !Array.isArray(document.results) ||
    document.results.length === 0 ||
    document.results.length > MAX_SIZES
  )
    fail("input has an invalid number of replay results");
  const sizes = new Set();
  for (const result of document.results) {
    if (
      !Number.isSafeInteger(result?.size) ||
      result.size < 1 ||
      result.size > MAX_CHUNKS
    )
      fail("input contains an invalid size");
    if (sizes.has(result.size)) fail("input contains duplicate sizes");
    sizes.add(result.size);
    if (
      !Array.isArray(result.runsMs) ||
      result.runsMs.length !== document.runs ||
      result.runsMs.length > MAX_RUNS
    )
      fail(`input has invalid runs for size ${result.size}`);
    if (!result.runsMs.every((value) => Number.isFinite(value) && value >= 0))
      fail(`input has invalid timing for size ${result.size}`);
    if (
      result.validation?.count !== result.size ||
      result.validation?.strictlyOrderedSeq !== true ||
      !/^[a-f0-9]{64}$/.test(result.validation?.sha256 ?? "")
    ) {
      fail(`input validation failed for size ${result.size}`);
    }
  }
}

function safeLabel(value, name) {
  if (typeof value !== "string" || !/^[a-z0-9._-]{1,64}$/.test(value)) {
    fail(`${name} must match [a-z0-9._-] and be at most 64 characters`);
  }
  return value;
}

function summarizeBrowser(document) {
  if (
    document?.schema !== "wterm-performance-browser/v1" ||
    document.operation !== "browser"
  ) {
    fail("input is not a wterm browser baseline document");
  }
  const scenario = safeLabel(document.scenario, "scenario");
  if (document.cache !== "cold" && document.cache !== "warm")
    fail("input has invalid cache series");
  if (typeof document.profiler !== "boolean")
    fail("input has invalid profiler flag");
  if (
    !Array.isArray(document.series) ||
    document.series.length === 0 ||
    document.series.length > 20
  ) {
    fail("input has an invalid number of browser series");
  }
  const names = new Set();
  const series = document.series.map((entry) => {
    const name = safeLabel(entry?.name, "series name");
    if (names.has(name))
      fail(`input contains duplicate browser series: ${name}`);
    names.add(name);
    if (typeof entry.noisy !== "boolean")
      fail(`series ${name} has invalid noisy flag`);
    if (
      !Array.isArray(entry.requiredMarks) ||
      entry.requiredMarks.length === 0
    ) {
      fail(`series ${name} has no required marks`);
    }
    const requiredMarks = entry.requiredMarks.map((mark) => {
      const label = safeLabel(mark, "required mark");
      if (!PERFORMANCE_MARKS.has(label))
        fail(`series ${name} has unknown required mark: ${label}`);
      return label;
    });
    if (
      !Array.isArray(entry.samples) ||
      entry.samples.length === 0 ||
      entry.samples.length > 10_000
    ) {
      fail(`series ${name} has an invalid sample count`);
    }
    let missing = false;
    const durations = entry.samples.map((sample, index) => {
      if (
        !Number.isFinite(sample?.startMs) ||
        sample.startMs < 0 ||
        !Number.isFinite(sample?.endMs) ||
        sample.endMs < sample.startMs
      ) {
        fail(`series ${name} has invalid timing at sample ${index}`);
      }
      if (
        !Array.isArray(sample.missingMarks) ||
        !sample.missingMarks.every(
          (mark) => typeof mark === "string" && requiredMarks.includes(mark),
        )
      ) {
        fail(`series ${name} has invalid missing marks at sample ${index}`);
      }
      if (sample.missingMarks.length > 0) missing = true;
      if (
        sample.seq !== undefined &&
        (!Number.isSafeInteger(sample.seq) || sample.seq < 0)
      ) {
        fail(`series ${name} has invalid sequence at sample ${index}`);
      }
      return sample.endMs - sample.startMs;
    });
    const reason = entry.noisy
      ? "noisy-series"
      : missing
        ? "missing-required-marks"
        : undefined;
    return {
      name,
      requiredMarks,
      sampleCount: durations.length,
      status: reason ? "inconclusive" : "ok",
      ...(reason
        ? { reason, stats: null }
        : { stats: nearestRankStats(durations) }),
    };
  });
  return {
    schema: "wterm-performance-browser/v1",
    operation: "summary",
    scenario,
    cache: document.cache,
    profiler: document.profiler,
    series,
  };
}

function summarize(document) {
  if (document?.schema === "wterm-performance-browser/v1") {
    return summarizeBrowser(document);
  }
  validateReplayDocument(document);
  return {
    schema: "wterm-performance-baseline/v1",
    operation: "summary",
    sourceOperation: "replay",
    results: document.results.map(({ size, runsMs, validation }) => ({
      size,
      runsMs: [...runsMs],
      stats: nearestRankStats(runsMs),
      validation: { ...validation },
    })),
  };
}

function emit(document, output) {
  const json = `${JSON.stringify(document, null, 2)}\n`;
  if (output) writeFileSync(output, json, "utf8");
  else process.stdout.write(json);
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "replay") {
    const sizes = options.sizes ? parseSizes(options.sizes) : DEFAULT_SIZES;
    const warmup = options.warmup
      ? parseInteger(options.warmup, "--warmup", { min: 0, max: MAX_CHUNKS })
      : DEFAULT_WARMUP;
    const runs = options.runs
      ? parseInteger(options.runs, "--runs", { min: 1, max: MAX_RUNS })
      : DEFAULT_RUNS;
    emit(runReplay({ sizes, warmup, runs }), options.output);
  } else {
    const input = JSON.parse(readFileSync(options.input, "utf8"));
    emit(summarize(input), options.output);
  }
} catch (error) {
  console.error(
    `wterm-performance-baseline: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
