/**
 * wterm-a4b.8 bounded burst probe — agent_browser `script` body.
 *
 * Usage (page-side helper must already be installed in the session's document
 * from `wterm-a4b8-page-probe.js`):
 *   agent_browser({ script: <this file>, timeoutMs: 600000, outputPath: <raw.json> })
 *
 * Sequence: own test PTY is created by the caller; this script types one finite
 * known byte workload exactly once, interleaves paced real keystrokes with
 * marker correlation, waits for the sentinel line, then collects bounded
 * sanitized evidence. It never closes or deletes anything.
 */

const SESSION = "wterm-a4b8";
const RUN_ID = globalThis.__A4B8_RUN_ID__ ?? Date.now().toString(36);
const MODE = globalThis.__A4B8_MODE__ ?? "burst"; // "burst" | "idle"
const SAMPLES = 20;
const WIDTH = 96;
const LINES = 8192;
const EXPECTED_BYTES = LINES * (WIDTH + 2);
const SENTINEL = `A4B8DONE${RUN_ID}`;
const COMMAND = `head -c ${WIDTH * LINES} /dev/zero | tr '\\0' x | fold -w ${WIDTH}; echo ${SENTINEL}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const call = (args, stdin, timeoutMs) => browser({ args, stdin, timeoutMs });
const evalIn = (snippet, timeoutMs) =>
  call(["eval", "--stdin", "--session", SESSION], snippet, timeoutMs);

const result = {
  runId: RUN_ID,
  mode: MODE,
  steps: [],
  expectedBytes: MODE === "burst" ? EXPECTED_BYTES : 0,
};

try {
  const started = await evalIn(
    `window.__a4b8.start(${JSON.stringify(RUN_ID)}, ${SAMPLES})`,
  );
  result.steps.push({ name: "probe-start", ok: !!started, detail: started });
  const focus = await evalIn(`(() => {
    const textarea = document.querySelector(".wterm-renderer textarea");
    if (!textarea) return { ok: false };
    textarea.focus();
    return { ok: document.activeElement === textarea };
  })()`);
  result.steps.push({
    name: "input-focused",
    ok: !!(focus && focus.ok),
    detail: focus,
  });
  if (!(focus && focus.ok)) throw new Error("terminal input not focused");

  if (MODE === "burst") {
    await call(
      ["keyboard", "type", COMMAND, "--session", SESSION],
      undefined,
      60000,
    );
    await call(["press", "Enter", "--session", SESSION], undefined, 30000);
  }
  result.steps.push({ name: "workload-sent", ok: true, detail: MODE });

  for (let index = 0; index < SAMPLES; index += 1) {
    const marker = `S${index}Z`;
    await evalIn(`window.__a4b8.expect(${JSON.stringify(marker)})`);
    await call(
      ["keyboard", "type", marker, "--session", SESSION],
      undefined,
      30000,
    );
    await sleep(120);
  }
  result.steps.push({ name: "paced-input", ok: true, detail: SAMPLES });

  await evalIn(
    `window.__a4b8.startWait(${JSON.stringify(SENTINEL)}, 60000)`,
    30000,
  );
  let wait = { done: false, found: false };
  for (let attempt = 0; attempt < 120 && !wait.done; attempt += 1) {
    await sleep(500);
    wait = (await evalIn("window.__a4b8.waitStatus()")) ?? {
      done: false,
      found: false,
    };
  }
  result.steps.push({ name: "sentinel", ok: !!wait.found, detail: wait });

  await sleep(500);
  result.raw = await evalIn("window.__a4b8.collect()", 60000);
  result.page = await evalIn(
    `({ route: "/plugins/wterm-terminal-preview/wterm", ua: navigator.userAgent, viewport: [innerWidth, innerHeight], deviceMemory: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency ?? null })`,
    30000,
  );
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String((error && error.message) || error);
}

emit(result);
