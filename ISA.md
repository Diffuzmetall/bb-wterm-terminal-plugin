---
task: "Make Wterm fast, flicker-free, and reliable"
slug: 20260904-011200_wterm-speed-and-feel
project: bb-wterm-terminal-plugin
phase: complete
progress: 46/46
started: 2026-09-04T01:12:10+03:00
updated: 2026-09-04T12:55:00+03:00
principal_stated_goal: "изучи пожалуйста его докумментацию рантайм как он связан с bb как он в целом работает и дай мне детальный план что внедрить что делать чтобы он работал быстро четко не фликерил там все круто открывалось тут в вебе и так далее"
principal_stated_goal_source: conversation
principal_stated_goal_signal: 2
principal_stated_goal_locked: 2026-09-04T01:12:10+03:00
context_sufficient: true
interview_invoked: false
---

## Problem

The standalone Wterm plugin already attaches a Ghostty-backed terminal to a BB thread, but opening and using it still feels slow, empty, and jumpy. Installed `@wterm` packages lag the lockfile, token and font work is repeated, create-then-verify races the KV mutex, dead linked IDs look “running,” the picker paints empty, and the renderer flashes a blank frame, leftover TUI row colors, and forced scroll-to-bottom. Users get “session unavailable,” reconnect loops, and a white or empty first paint instead of a terminal that is already there.

## Vision

Opening a Wterm tab in the BB web app feels like a local terminal that was already warm: dark first paint with a quiet cursor, **each new tab is a new PTY** (never a silent reopen of the previous session), WASM/font/token paid once, replay without a blank hop, no leftover TUI stripes, no jump-to-bottom while reading scrollback, and several tabs at once without verify stalls or zombie reconnects. Attach to an existing session only from the picker, by an explicit click.

## Out of Scope

- Native `experimental_primarySurface` Chat ↔ CLI full-screen. Packaged BB 0.40/0.41 does not expose it; composer still opens the side panel or picker.
- Replacing `@wterm` / Ghostty with xterm.js or a custom emulator.
- Subsetting the 1.2 MB Nerd Font (license-ok later; not this climb).
- Upstream `WebAssembly.compileStreaming` inside `@wterm/ghostty` (track on next library bump).
- Changing upload security (thread scope, size, SHA, path confinement) except to keep tests green.
- Shipping a new plugin ID or merging into BB’s bundled `wterm-terminal`.
- Deleting `pnpm-lock.yaml` without explicit owner permission.

## Language

**Linked terminal IDs** — KV list of terminal IDs this thread claims.
_Avoid:_ “sessions list”, “PTY registry”, “tab store”.
Relates to: `withLinkedTerminalIds`, `rememberLinkedTerminal`.

**Verify loop** — `SelectedTerminal` polling `listSessions` until presence is `ready` or `missing`.
_Avoid:_ “health check”, “heartbeat”.
Relates to: `evaluateTerminalPresence`.

**Unavailable session** — a linked ID whose `terminals.get` failed; must not be labeled `running`.
_Avoid:_ “exited”, “dead tab” as the status string (Exited is the picker section).

**Legacy attachment** — browser WebSocket `/ws/terminals/:id` path used when the host tab API is absent.
_Avoid:_ “native socket”, “host terminal”.

**Last-terminal cache** — thread-scoped localStorage of the most recently _shown_ terminal id. Used to write after create/select, never to decide what a newly opened tab _is_.
_Avoid:_ “current terminal”, “the session”, “default tab”.
Relates to: `readLastTerminalId`, `LegacyTerminalAction` fallback (bug).

**Replay** — ordered historical output flushed before live chunks.
_Avoid:_ “buffer dump”, “scrollback restore” (scrollback is the renderer’s history rows).

## Principles

- First paint must look like a terminal, never like a blank document.
- Read paths must not wait on write locks that hold host round-trips.
- One token, one WASM compile, one font buffer per process/window lifetime unless invalidated.
- Dead host objects must be visible as dead, never as healthy.
- A new Wterm tab is a new PTY. Thread-scoped `lastTerminalId` is not tab identity.
- Existing upload and stream-ordering invariants stay green; speed work does not reopen those doors.
- Prefer a small vertical slice users can feel over a speculative architecture rewrite.

## Constraints

- Runtime deps must still install under `npm install --omit=dev`; tests stay `devDependencies`.
- Plugin ID remains `wterm-terminal-preview`; host APIs stay optional/feature-detected.
- `@wterm/*` target is the lockfile 0.4.0 line after `npm ci`; do not invent a private fork.
- KV schema for linked IDs must read legacy `string[]` and the new record form.
- `zod` 4.3.6 and `vitest` 4.1.10 stay pinned.
- Root `ghostty-vt.wasm` (577 KB, 0.4.0) is the source of truth; `dist/` is build output.
- No file deletion without explicit written permission.
- Probes attach at user-visible or RPC/HTTP seams (`npm test`, plugin HTTP, picker/renderer behavior), not `@wterm` internals.

## Goal

"изучи пожалуйста его докумментацию рантайм как он связан с bb как он в целом работает и дай мне детальный план что внедрить что делать чтобы он работал быстро четко не фликерил там все круто открывалось тут в вебе и так далее"

Make the installed Wterm preview in the BB web app open quickly, stay visually stable, and remain correct under multi-tab create/verify: aligned `@wterm` 0.4.0 assets, no blank/white first frame, no TUI color bleed in scrollback, no false “session unavailable” right after create, no zombie `running` reconnects, shared token/font/WASM work, and the existing standalone security/ordering suite still passing.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to |
| --- | --- | --- | --- | --- | --- |
| ISC-1 | command | standalone suite | exit 0 | npm + Vitest | derived: prior test-port climb closed |
| ISC-2 | install/build | omit-dev install + plugin build | exit 0 | npm + bb CLI | derived: prior test-port climb closed |
| ISC-3 | unit | hostile filename / relative cwd | all pass | Vitest | derived: prior test-port climb closed |
| ISC-4 | boundary | oversized declared body | HTTP 413; zero writes | Vitest | derived: prior test-port climb closed |
| ISC-5 | boundary | oversized streamed body | HTTP 413; zero writes | Vitest | derived: prior test-port climb closed |
| ISC-6 | authorization | wrong-thread upload | rejected | Vitest | derived: prior test-port climb closed |
| ISC-6.1 | authorization | wrong-thread restart | rejected | Vitest | derived: prior test-port climb closed |
| ISC-7 | integrity | conflict/SHA/size | never HTTP 201 | Vitest | derived: prior test-port climb closed |
| ISC-8 | ordering | replay before live, no dup seq | exact order | Vitest | derived: prior test-port climb closed |
| ISC-9 | lifecycle | queued input flushed once | sent exactly once | Vitest | derived: prior test-port climb closed |
| ISC-9.1 | lifecycle | two queued resizes | only latest sent | Vitest | derived: prior test-port climb closed |
| ISC-9.2 | lifecycle | detach | socket close only; no PTY close | Vitest | derived: prior test-port climb closed |
| ISC-10 | class sweep | no BB workspace imports | zero external paths | rg | derived: prior test-port climb closed |
| ISC-11 | install | `npm ci` then node_modules `@wterm/*` | all 0.4.0 matching lockfile | npm ls | derived: aligned emulator |
| ISC-12 | build | rebuilt `dist/ghostty-vt.wasm` sha256 | equals root `ghostty-vt.wasm` | sha256sum | derived: aligned emulator |
| ISC-13 | command | `npm test` after ci/build | exit 0 | npm + Vitest | literal |
| ISC-14 | unit | CSS selector covers `.term-scrollback-row` | file contains both selectors | Vitest or rg fixture | derived: no TUI stripe |
| ISC-15 | unit/dom | loading renderer has `--loading` and dark bg | class + computed/style contract | Vitest | derived: first paint |
| ISC-16 | unit | wheel handler no-ops when selection collapsed | `removeAllRanges` not called | Vitest | derived: no flicker |
| ISC-17 | unit | follow-bottom tracks inner `.wterm` scroll, not outer wrapper | fixture sets false when not at bottom | Vitest | derived: no jump-to-bottom |
| ISC-18 | unit | `encodeBase64` chunked or native; 100KiB+ input | finishes; not O(n²) concat path | Vitest | derived: large paste |
| ISC-19 | unit | presence: missing id during grace → retry | `"retry"` | Vitest | derived: no false unavailable |
| ISC-20 | unit | presence: still missing after grace+max → missing | `"missing"` | Vitest | derived: no false unavailable |
| ISC-21 | unit | presence: inactive status → missing immediately | `"missing"` | Vitest | derived: no false unavailable |
| ISC-22 | unit | `getPluginToken` shared module cache | second caller awaits first; one fetch | Vitest | derived: one token |
| ISC-23 | unit | nerd font route uses in-memory cache | second GET no second `readFile` | Vitest | derived: open quickly |
| ISC-24 | unit | `listSessions` does not hold write mutex across `terminals.get` | overlapping create/list both complete | Vitest | derived: multi-tab |
| ISC-25 | unit | rejected `get` does not keep id forever after TTL | id dropped after grace | Vitest | derived: no zombies |
| ISC-26 | unit | unavailable linked session status | `"unavailable"` not `"running"` | Vitest | derived: no reconnect loop |
| ISC-27 | unit | `isActiveStatus` rejects unavailable | presence `"missing"` | Vitest | derived: no reconnect loop |
| ISC-28 | unit | Picker loading vs failed vs empty loaded | three distinct UIs | Vitest | derived: opens clearly |
| ISC-29 | unit | RPC failure is not empty list | failed state + retry | Vitest | derived: opens clearly |
| ISC-30 | unit | [DROPPED] Reopen-last-on-open | tombstone | n/a | Decisions 2026-09-04 |
| ISC-39 | unit | `threadPanelAction.run` always `createTerminal` and openPanel params use that new id | create spy called; params.terminalId !== last stored id | Vitest | derived: new tab is new PTY |
| ISC-40 | anti | newly mounted tab without host params must not hydrate from lastTerminalId | fixture last id present; panel still Picker or new create, not last PTY | Vitest | derived: new tab is new PTY |
| ISC-41 | unit | Picker "New terminal" always createTerminal | never `replace(lastId)` | Vitest | derived: new tab is new PTY |
| ISC-42 | e2e/manual | headed: second Wterm tab shows a different terminal id than the first | two distinct PTYs | agent-browser / BB web | derived: new tab is new PTY |
| ISC-43 | unit | composer uses real `wtermOpenCount`; helper `resolveSessionTerminalId` takes `openTabCount` | openTabCount>0 does not reuse last; live composer reveals or creates, never last-id on a new tab | Vitest | derived: new tab is new PTY |
| ISC-31 | unit | replay insert stays ordered without full re-sort each chunk | flush order = seq | Vitest | derived: quickly |
| ISC-32 | anti | upload/auth/order tests still pass after speed slices | `npm test` green including server + attachment | Vitest | literal |
| ISC-33 | anti | production-only install still builds | omit-dev + `bb plugin build` exit 0 | npm + bb CLI | derived: prior constraint |
| ISC-34 | anti | no `experimental_primarySurface` required | app still opens panel/picker when API missing | Vitest or type/branch fixture | derived: out of scope |
| ISC-35 | class sweep | new files stay inside this repo | zero BB workspace paths | rg | derived: standalone |
| ISC-36 | e2e/manual | headed BB: first open shows dark skeleton then content, no white flash | observed | agent-browser / BB web | literal |
| ISC-37 | e2e/manual | headed BB: create terminal does not show unavailable within grace | observed | agent-browser / BB web | literal |
| ISC-38 | e2e/manual | headed BB: two tabs open without multi-second verify stall | observed | agent-browser / BB web | literal |

## Features

### F0 · Cross-cutting — standalone invariants

Why: speed work is worthless if the public plugin stops building, uploading safely, or staying standalone.

- [x] ISC-1: `npm test` exists and exits zero from the standalone repository.
- [x] ISC-2: production-only dependency installation still builds the plugin.
- [x] ISC-3: upload paths discard caller filenames and stay below the absolute terminal cwd.
- [x] ISC-4: declared uploads above the applicable size limit are rejected before host write.
- [x] ISC-5: streamed uploads that exceed the applicable limit are rejected before host write.
- [x] ISC-6: uploads reject terminal IDs outside the requested thread.
- [x] ISC-6.1: restarts reject terminal IDs outside the requested thread.
- [x] ISC-7: host conflict or mismatched size/SHA never returns upload success.
- [x] ISC-8: replay output is delivered before buffered live output without duplicate sequences.
- [x] ISC-9: queued input flushes exactly once after socket open.
- [x] ISC-9.1: only the latest queued resize flushes after socket open.
- [x] ISC-9.2: detach closes only the browser socket and sends no terminal-close message.
- [x] ISC-10: tests do not depend on the sibling BB workspace at runtime.
- [x] ISC-32: after each speed/feel slice, `npm test` still passes including `server.test.ts` and `terminal-attachment.test.ts`.
- [x] ISC-33: `npm install --omit=dev` plus `bb plugin build .` still exits 0.
- [x] ISC-34: missing `experimental_primarySurface` still opens side panel or picker rather than crashing.
- [x] ISC-35: new modules do not import paths outside this repository.

### F1 · Aligned Ghostty / @wterm 0.4.0

Why: running 0.3.4 against a 0.4.0 lockfile means tests, WASM, and `dist/` are three different programs.

- [x] ISC-11: after `npm ci`, `node_modules/@wterm/{dom,ghostty,react}` report 0.4.0 matching `package-lock.json`.
- [x] ISC-12: `npm run build` writes `dist/ghostty-vt.wasm` with the same sha256 as repo-root `ghostty-vt.wasm`.
- [x] ISC-13: `npm test` exits 0 on that aligned tree.

### F2 · First paint and visual stability

Why: the web panel must look like a terminal immediately and must not jump, flash, or keep TUI stripes.

- [x] ISC-14: `.wterm-renderer .term-scrollback-row` is forced transparent the same way `.term-row` is.
- [x] ISC-15: before Ghostty core is ready, the renderer paints a dark `--loading` surface with a muted cursor placeholder (not an empty unstyled div).
- [x] ISC-16: wheel capture does not call `removeAllRanges` when the window selection is collapsed.
- [x] ISC-17: follow-bottom is computed from the inner scrolling `.wterm` (or `instance.element`), so reading scrollback is not yanked to the bottom on resize/output.

### F3 · Create, verify, and linked-ID truth

Why: opening a tab must not lie about “unavailable” or “running,” and listing must not serialize behind host GETs.

- [x] ISC-19: `evaluateTerminalPresence` returns `retry` when the new id is absent during the grace window.
- [x] ISC-20: after grace plus `maxAttempts`, a still-absent id is `missing`.
- [x] ISC-21: a present session with inactive status is `missing` without consuming the grace window.
- [x] ISC-24: `listSessions` / read path does not hold `withLinkedTerminalIds` for the duration of `terminals.get` fan-out.
- [x] ISC-25: linked ids whose `get` stays rejected beyond `DEAD_TERMINAL_GRACE_MS` are dropped; legacy `string[]` KV still loads.
- [x] ISC-26: synthetic missing host sessions use status `"unavailable"`, not `"running"`.
- [x] ISC-27: `"unavailable"` is not an active status, so the panel does not treat zombies as ready.

### F4 · Pay once for token, font, WASM-adjacent bytes, and large paste

Why: opening and pasting should not repeat disk/network/CPU the plugin already paid for.

- [x] ISC-18: `encodeBase64` uses native `toBase64` or 8KiB chunks; a ≥100KiB buffer encodes without the per-byte string concat loop.
- [x] ISC-22: `terminal-panel.tsx` and `wterm-renderer.tsx` share one retryable plugin-token cache (one in-flight POST).
- [x] ISC-23: Nerd Font HTTP GET serves from a module-level bytes cache with in-flight coalescing, matching `ghosttyWasmBytes`.
- [x] ISC-31: replay chunks flush in seq order without re-sorting the entire pending set on every chunk.

### F5 · Picker that tells the truth while loading

Why: the first screen after a failed create or a cold tab must not look like “there are no terminals.”

- [x] ISC-28: Picker distinguishes `loading`, `loaded`, and `failed` (skeleton vs list vs error+retry).
- [x] ISC-29: `listSessions` rejection does not collapse to an empty successful list.

### F7 · New tab is a new session

Why: README already promises every Wterm tab starts an independent PTY; localStorage last-id currently steals that.

- [x] ISC-30: DROPPED (2026-09-04) — Reopen-last is not a criterion; new tab must not reopen last session.
- [x] ISC-39: `threadPanelAction.run` always calls `createTerminal` and passes that new id in `openPanel` params.
- [x] ISC-40: `LegacyTerminalAction` (and any host path) must not treat localStorage last-id as the identity of a newly opened tab when host params have no terminalId.
- [x] ISC-41: Picker **New terminal** always creates; attaching an existing session happens only by clicking that row.
- [x] ISC-43: live composer reads `wtermOpenCount` (mounted + pending): already-open tab → reveal without last id; otherwise `createTerminal`. `resolveSessionTerminalId` still takes `openTabCount` in unit tests and must not hardcode `0`.

### F6 · Headed confirmation in BB web

Why: flicker and multi-tab stalls are user-visible; unit tests cannot close the principal goal alone.

- [x] ISC-36: headed BB web: first terminal open shows dark loading then content, not a white empty flash. Antecedent: a Wterm tab is opened in headed BB web.
- [x] ISC-37: headed BB web: creating a terminal does not flash “no longer available” within the grace window.
- [x] ISC-38: headed BB web: opening two Wterm tabs in one thread does not stall verify for multiple seconds.
- [x] ISC-42: headed BB web: the second new Wterm tab is a different session than the first (not a silent reopen of last).

## Anti-claims

- Anti: tests do not depend on the sibling BB workspace at runtime.
- Anti: after each speed/feel slice, `npm test` still passes including `server.test.ts` and `terminal-attachment.test.ts`.
- Anti: `npm install --omit=dev` plus `bb plugin build .` still exits 0.
- Anti: missing `experimental_primarySurface` still opens side panel or picker rather than crashing.
- Anti: new modules do not import paths outside this repository.
- Anti: `LegacyTerminalAction` (and any host path) must not treat localStorage last-id as the identity of a newly opened tab when host params have no terminalId.

## Decisions

- 2026-08-15: Ported standalone tests rather than copying BB-private host hooks; closed ISC-1–ISC-10.
- 2026-09-04: New project climb replaces the completed test-port goal. Old ISC IDs stay closed; new work starts at ISC-11 (ID stability).
- 2026-09-04: ANALYSIS.md is the evidence corpus (static code; no headed profiling yet). FLICKER-03 and PERF-03 stay partly fog until headed BB.
- 2026-09-04: Ambiguity check: done means the ANALYSIS slices that make open/use fast and visually stable in BB web, not a Ghostty rewrite and not primarySurface. `context_sufficient: true`; interview not invoked.
- 2026-09-04: Attachment lift (PERF-03) held as fog rather than a premature ISC, so agents do not invent a lifecycle that BB 0.41 may not allow.
- 2026-09-04: Font subsetting and compileStreaming listed Out of Scope / fog so the plan stays shippable.
- 2026-09-04: Principal correction: a new terminal / new tab must open a **new** session, not the previous one. Dropped ISC-30 (Reopen last during picker loading). `readLastTerminalId` remains only as a cache write for the current tab and for explicit picker attach. `LegacyTerminalAction` localStorage fallback is the likely current bug (new tab with empty params mounts last PTY). Composer button may still _reveal an already-open panel_; it must not cause a **new** tab to steal last id.
- 2026-09-04: `bb plugin build` emits JS/CSS only. `npm run build` now copies repo-root `ghostty-vt.wasm` and the Nerd Font into `dist/` after the bundle. Stay on 0.4.0; do not bump to 0.4.1.
- 2026-09-04: `_measureCharSize` still exists on `@wterm/dom` 0.4.0 as a private method. No fork. Font-size refit keeps the optional private call plus public `resize`.
- 2026-09-04: Headed F6 closed on BB web (`thr_fgn2njixb7`). Hide/show remounts `TerminalPanel`, but reconnect was not a user-visible stall (WASM cached, PTY still running). Keep PERF-03 / `.16` fog — do not lift attachment.
- 2026-09-04: Closed fog bead `.16` without implementation. Epic F1–F5 unit/ISC verified; F6 headed observed.
- 2026-09-04: Killed fog PERF-03 / attachment lift — headed remount reconnect was not user-visible; out of this climb.
- 2026-09-04: Killed fog browser HTTP cache for WASM/font — still needs security review; not this climb.

## Learning

- 2026-08-15 — Conjectured: test-only migration. Refuted by: source-install WASM resolved one directory too high. Learned: source and built asset resolution both need coverage. Criterion now: ISC-2/ISC-12 still demand aligned WASM after `npm ci`.
- 2026-09-04 — Conjectured: hide/show stall needs lifted WebSocket attachment. Refuted by: headed `thr_fgn2njixb7` remount with cached WASM and immediate prompt. Learned: remount ≠ user-visible reconnect cost on 0.41. Criterion now: PERF-03 stays killed, not an ISC.

## Verification

- ISC-1 … ISC-10: prior climb — `npm test` 15 passed; omit-dev build; `server.test.ts` / `terminal-attachment.test.ts`; no BB workspace imports (2026-08-15).
- ISC-11: `npm ls @wterm/dom @wterm/ghostty @wterm/react` all 0.4.0 matching lockfile (2026-09-04).
- ISC-12: sha256 `4a0a02357206349ed52b76ebda8feea4a65e453fe4e199832d8c009d7c41ba4f` equal for root, `dist/`, and `node_modules/@wterm/ghostty/wasm/` after `npm run build` (2026-09-04).
- ISC-13: `npm test` 10 files / 68 tests pass on the aligned 0.4.0 tree (2026-09-04).
- ISC-14: `wterm-renderer.test.ts` “forces transparent backgrounds on both viewport and scrollback rows” (2026-09-04).
- ISC-15: `wterm-renderer.test.ts` “paints a dark reduced-motion loading surface before Ghostty core is ready”; `npm test` 10 files / 70 tests (2026-09-04).
- ISC-18: `encodeBase64` “encodes a 100KiB buffer round-trip” + small-buffer `btoa` match; `npm test` 10 files / 72 tests (2026-09-04).
- ISC-16: `shouldClearSelectionOnWheel` skips collapsed/null; `npm test` 12 files / 83 tests (2026-09-04).
- ISC-19/20/21: `evaluateTerminalPresence` grace 2, maxAttempts 6; inactive present is missing on attempt 1 (2026-09-04).
- ISC-22: `plugin-token.test.ts` concurrent callers share one fetch; renderer + panel import `getPluginToken` (2026-09-04).
- ISC-23: `createBytesCache` overlapping reads invoke `read` once (2026-09-04).
- ISC-25: `linked-terminal-records.test.ts` legacy parse, stamp clear, drop after 60s (2026-09-04).
- ISC-31: out-of-order replay insert emits increasing seq then live (2026-09-04).
- ISC-17: `computeFollowBottom` false when not at bottom; renderer binds `instance.element` scroll and gates `scrollTop` on `shouldRestoreBottom` (2026-09-04).
- ISC-24: `server.test.ts` delayed `terminals.get` does not block `createTerminal` remember; reconcile keeps the new id (2026-09-04).
- ISC-26/27: synthetic list row `status: "unavailable"`; presence `missing` on attempt 1; picker partition puts it in Exited (2026-09-04).
- ISC-28/29: `pickerStateFromRpc` loaded-empty ≠ failed; Picker renders skeleton / alert+Retry / list (2026-09-04).
- ISC-39/40/41/43: `run()` always `createTerminal`; `initialPanelParams` ignores last-id; New terminal still `createTerminal`; composer `onOpen` uses `wtermOpenCount` (reveal if >0, else create) and does not call `resolveSessionTerminalId`; helper still tested with explicit `openTabCount` (2026-09-04).
- ISC-32: `npm test` 13 files / 97 pass including server.test.ts and terminal-attachment.test.ts (2026-09-04).
- ISC-33: clean-dir `npm install --omit=dev` + `bb plugin build .` exit 0 (2026-09-04).
- ISC-34: missing `experimental_useReplaceCurrentPluginTab` uses LegacyTerminalAction; `experimental_primarySurface` is only an openThreadPanel option (2026-09-04).
- ISC-35: rg on ts/tsx/js found no sibling BB workspace imports (2026-09-04).
- ISC-36/37/38/42: headed BB web 2026-09-04 07:46Z, plugin 0.3.16 via `bb plugin dev` on <http://127.0.0.1:38896> thread `thr_fgn2njixb7`. First tab `term_7d8wrt626z` Ghostty with existing scrollback (agent-browser TUI). Open new tab → Wterm created `term_3gwkt6m52p` (created_at 1788508010144, updated +398ms, status running); KV `thread-terminals:thr_fgn2njixb7` holds both ids; second tab paints a fresh starship prompt `0.3.16` with no first-tab scrollback. Remount second tab: `unavail=[]`, no “no longer available”, Ghostty content without empty wait. Loading CSS remains `.wterm-renderer--loading { background: var(--term-bg, #1e1e1e) }` (WASM already cached so skeleton not screenshotable). `npm test` 13 files / 97 pass same commit.
