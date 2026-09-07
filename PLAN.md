# Wterm speed, truth, and visual stability — implementation plan

This plan is self-contained. Agents should not need ANALYSIS.md or chat history to execute, but those files remain the research trail. Canonical done-conditions live in [ISA.md](./ISA.md) (ISC-11 onward; ISC-1–ISC-10 already closed).

---

## 1. Why this exists

The plugin (`wterm-terminal-preview`, package `bb-plugin-wterm-terminal-preview` **0.3.16**) is a Ghostty-backed terminal for [BB](https://github.com/get-bb/bb). It is already useful: thread-scoped PTY, uploads, Nerd Font, OSC 52, legacy WebSocket. What users feel in the BB **web** app is still wrong:

1. First paint is an empty/white hole while WASM and font load.
2. Creating a terminal sometimes immediately says the session is gone.
3. Two or three tabs in one thread stall on verification.
4. Dead PTY IDs look `running` and reconnect forever.
5. After vim/Herdr, colored TUI stripes remain in scrollback.
6. Wheel and resize yank the viewport; large paste can wedge `encodeBase64`.
7. Installed `@wterm` 0.3.4 does not match lockfile 0.4.0, so `dist/` WASM ≠ repo WASM.

The principal goal: make it work **fast**, **crisp**, **without flicker**, and **open well in the web UI**.

This is not a rewrite. It is a sequenced set of vertical slices on the existing plugin.

---

## 2. How the system actually works

```
BB App (browser)
  app.tsx  definePluginApp
    composer button → session-terminal-action.tsx
                    → session-terminal-composer.ts
                    → revealSessionTerminalPanel (openThreadPanel)
    threadPanelAction → TerminalAction
         HostTerminalAction  (experimental_useReplaceCurrentPluginTab)
         LegacyTerminalAction  (localStorage last terminal id)
              Panel → SelectedTerminal → TerminalPanel (lazy)
                   LegacyAttachedTerminal
                        useLegacyTerminalAttachment
                             WebSocket /ws/terminals/:id
                        TerminalWithUpload
                             TerminalRenderer → WtermRenderer
                                  loadGhosttyCore  (WASM via plugin HTTP)
                                  loadNerdFont     (WOFF2 via plugin HTTP)
                                  <Terminal core autoResize />  @wterm/react

BB Server (Node)
  server.ts  definePluginApi
    RPC: listSessions / createTerminal / restartTerminal
    GET  /ghostty-vt.wasm          auth token, in-memory cache TODAY
    GET  /symbols-nerd-font-mono-v3.5.0.woff2  auth token, NO cache TODAY
    POST /upload                   auth token, thread-scoped
```

Host facts (BB ~0.41 / packaged 0.40):

- `experimental_primarySurface` is **not** in packaged 0.40; composer opens side panel. Out of scope to invent full-screen.
- `experimental_claimedTerminalId` — yes; suppresses duplicate native tab.
- `experimental_useReplaceCurrentPluginTab` — yes; HostTerminalAction.
- Legacy WS `/ws/terminals/:id` — yes.
- `bb.sdk.terminals.create` with `scope.kind="environment"` — yes.

Pinned deps (do not casually bump): `zod` 4.3.6, `vitest` 4.1.10, `@get-bb/plugin-sdk` 0.4.21. Target `@wterm/*` **0.4.0** from `package-lock.json`.

Do not delete `pnpm-lock.yaml` (legacy leftover) without owner permission.

---

## 3. User workflows this plan must improve

| Workflow | Today | Done |
| --- | --- | --- |
| Open Wterm from tab menu / + tab | Blank frame; **LegacyTerminalAction hydrates empty params from last localStorage id** so a "new" tab can show the previous PTY | Always `createTerminal`; new tab params are the new id; empty params show Picker, never auto-last |
| Picker New terminal | Creates (good) | Keep create; do not add a default Reopen-last control that steals new-tab |
| Composer terminal button | Side panel (no primarySurface) | Unchanged host behavior; still must not crash |
| New terminal | create RPC then verify loop 3×400ms then missing if KV lag | Grace retries; listSessions not blocked by write mutex |
| Second/third tab | All listSessions serialize on withLinkedTerminalIds holding N×terminals.get | Reads snapshot KV without write lock; writes stay serialized |
| Hide/show panel | WS torn down in useEffect cleanup (WASM/font cached) | Keep detach-on-unmount unless headed BB proves a lift is legal (fog) |
| Exit TUI | Viewport rows transparent; scrollback rows keep TUI bg | Both row types transparent |
| Scroll to read history | onScroll on outer overflow:hidden; followBottom stays true; jump down | Follow inner `.wterm` |
| Wheel | getSelection + removeAllRanges every wheel | No-op if collapsed |
| Paste large buffer | O(n) string concat in encodeBase64 | native toBase64 or 8KiB chunks |
| Upload | Extra plugin token fetch | Shared token cache |
| Long-lived thread | Dead IDs accumulate; zombies show Running 01.01.1970 | TTL drop + status unavailable then Exited/Restart |

---

## 4. Architecture decisions (why this shape)

### 4.1 Align packages before any renderer fix

`package.json` declares `^0.4.0`. Lockfile has 0.4.0. `node_modules` may still be 0.3.4. Root `ghostty-vt.wasm` (577013 B) matches 0.4.0; `dist/ghostty-vt.wasm` (434450 B) matches the stale 0.3.4 tree. Measuring `terminal._measureCharSize` on the wrong ABI wastes the rest of the climb.

Decision: Phase 0 is `npm ci` + `npm run build` + `npm test`. No feature code until ISC-11–13 are green.

### 4.2 Read/write split on linked IDs, not just more retries

BUG-03 (verify misses a just-created id) is partly a race with `rememberLinkedTerminal`. Increasing `maxAttempts` and adding grace (ISC-19–21) treats the symptom. The cause of multi-tab stall is `loadLinkedTerminals` taking the write mutex for the whole `Promise.allSettled(terminals.get)` fan-out. `listSessions` (verify every 400ms), picker, and upload all enter that lock.

Decision: `withLinkedTerminalIds` stays **only** for true mutations (`rememberLinkedTerminal`, restart rewrite). Reads: snapshot `linkedTerminalIds`, fan-out **outside** the lock, reconcile id replacements best-effort later under the lock without blocking the RPC response.

### 4.3 KV schema expand–contract

Today: `string[]`. Need: `{ id, firstUnavailableAt }[]` for TTL of dead IDs.

Decision: parser accepts both. Writes may emit records. Never require a migration job. `DEAD_TERMINAL_GRACE_MS = 60000` (transient host blips survive; unbounded N does not).

### 4.4 Unavailable is not running

`unavailableLinkedSession` currently sets `status: "running"` so a brief host miss does not kill the tab. Combined with never dropping rejected IDs, the picker and verify loop treat zombies as healthy and the WS reconnects forever.

Decision: status `"unavailable"`. `isActiveStatus` already allows only `running`/`starting`, so presence is `missing`. Picker can show them under Exited with Restart. Do not invent a new BB SDK status enum beyond this plugin’s `Session` type.

### 4.5 Shared token module, not a global store

`wterm-renderer.tsx` has `createRetryablePromiseCache` for token. `terminal-panel.tsx` has a second `pluginToken(signal)` for uploads. First open + upload = up to 3 POSTs.

Decision: new `plugin-token.ts` exporting one cache. Both import it. If the cache cannot take a per-call AbortSignal without splitting caches, use a 10s timeout on the in-flight request and let callers race abort locally without cancelling a shared token fetch (token is not user-data).

### 4.6 Font cache copies WASM’s pattern exactly

WASM already has `ghosttyWasmCache`. Font GET `readFile`s 1.2 MB every time. `cache-control: immutable` does not help authenticated `fetch` with `x-bb-plugin-token`.

Decision: `nerdFontBytes()` twin of `ghosttyWasmBytes()`. Subsetting is out of scope.

### 4.7 Attachment lift is fog, not a first bead

PERF-03 (WS dies when the panel unmounts) needs headed BB proof that lifting `LegacyTerminalAttachment` to `SelectedTerminal` or a module map does not leak sockets after tab close. ISA fog records this. Do not implement lift in Phase 1–2.

### 4.8 Tests stay standalone

Do not import BB workspace. New unit tests mock `bb.sdk` like `server.test.ts` already does. Picker currently has no tests — add them with the Picker slice (extract presentational helpers if `app.tsx` is too coupled).

---

## 5. Phased work (vertical slices)

Each phase is independently verifiable. Later phases must not require reverting earlier ones.

### Phase 0 — Align the emulator (ISC-11, 12, 13)

Commands at repo root:

```bash
npm ci
npm ls @wterm/dom @wterm/ghostty @wterm/react
npm run build
npm test
sha256sum ghostty-vt.wasm dist/ghostty-vt.wasm
```

Success: all `@wterm/*` 0.4.0; wasm hashes equal; tests exit 0.

If `_measureCharSize` disappeared: do not guess. Record in ISA fog / Decisions; font-size refit uses public API only.

### Phase 1 — Cheap pixels and CPU (ISC-14, 15, 16, 18)

1. `wterm-renderer.css` — add `.term-scrollback-row` to the transparent background rule. Add `.wterm-renderer--loading` dark bg + cursor `::after` + `prefers-reduced-motion`.
2. `wterm-renderer.tsx` — empty core branch gets `--loading` + `aria-label="Terminal loading"`. Wheel: if `!selection || selection.isCollapsed` return before `clearTerminalSelection`.
3. `terminal-attachment.ts` `encodeBase64` — `toBase64()` if present, else 8192-charCode chunks + `btoa`. Unit test with ~100KiB `Uint8Array`.

### Phase 2 — Truthful open path (ISC-19–21, 28–29, 39–42)

1. `terminal-open-policy.ts` — `maxAttempts` default 6; `gracePeriodAttempts` default 2; absent id retries during grace; inactive status still immediate `missing`. Update `terminal-open-policy.test.ts` exhaustively.
2. Picker in `app.tsx` — state machine `loading | loaded | failed`. Failed shows message + Retry. Loaded empty shows explicit empty copy. Hide Exited section when empty. Skeleton CSS in `app.css`. **Do not** add “Reopen last terminal” as an auto path. Existing sessions appear as list rows; New terminal always `createTerminal`.
3. **New tab ≠ last session (bead `wterm-speed-feel-ftz.17`, ISC-39–42).** `threadPanelAction.run` already `createTerminal`s. Fix `LegacyTerminalAction`: do not hydrate empty host params from localStorage last id. Extract `initialPanelParams(hostParams)` → host params or null (picker). Composer `resolveSessionTerminalId` / `OpenSessionTerminalAction` may *reveal an already-open panel*; they must not make a **new** tab bind last id. `reusableTerminalId` already returns null when `openTabCount > 0` — composer currently hardcodes `openTabCount: 0`, so it reuses last even when tabs exist. Pass real `wtermOpenCount(threadId)` (including pending opens). Tests: last id in storage + empty host params ≠ that id; composer with openTabCount>0 creates or reveals without stealing.
4. Extract picker helpers (`partitionRunningExited`, `pickerStateFromRpc`) only if needed to unit-test without the plugin harness.

### Phase 3 — Server mutex, TTL, unavailable (ISC-23–27)

1. `nerdFontBytes` + route — identical coalescing to WASM. Test: two overlapping GETs → one `readFile`.
2. `readLinkedTerminals` — snapshot ids, fan-out gets, return sessions + unavailable ids, then optional async reconcile under mutex.
3. `listedSessionsForThread` / `sessionsForThread` — use read path. Upload auth must not treat unavailable as uploadable.
4. Parse linked records — string or `{id, firstUnavailableAt}`. On reject: set firstUnavailableAt once; if now - firstUnavailableAt > 60s, drop. On fulfill: clear stamp.
5. `unavailableLinkedSession` — `status: "unavailable"`. Tests: listSessions concurrent with remember; zombie not `running`; TTL drop; legacy array still loads.

Concurrency test sketch: fake `terminals.get` that delays; start `listSessions` then `createTerminal`; create’s remember must not wait on the delayed gets.

### Phase 4 — Shared token + replay insert + follow-bottom (ISC-22, 31, 17)

1. `plugin-token.ts` — shared cache; both call sites. Test with mocked `fetch` (one POST for two callers).
2. Replay — keep seq uniqueness. Sorted insert or equivalent. Do not lose ISC-8. Extend `terminal-attachment.test.ts`.
3. Follow-bottom — in `handleReady`, listen `scroll` on `instance.element` (passive). Remove misleading `onScroll` on the outer `.wterm-renderer` if it never scrolls.

### Phase 5 — Headed BB web (ISC-36–38, ISC-42)

Requires a running BB with this plugin sourced.

1. Open thread → Wterm: first paint dark, then content. Screenshot.
2. New terminal: no “no longer available” flash.
3. Second tab: both usable without multi-second verify death.

If headed env is missing, leave these ISC open; do not mark F6 complete from unit tests.

### Phase 6 — Fog, not required to start swarm

- Lift attachment across panel hide after headed confirmation.
- `_measureCharSize` replacement if 0.4.0 broke it.
- Auth shape so WASM/font can use HTTP cache (security review).
- Font subsetting.

---

## 6. File map

| File | Phases | Notes |
| --- | --- | --- |
| package-lock.json / node_modules | 0 | npm ci only |
| ghostty-vt.wasm, dist/ | 0 | dist regenerated |
| wterm-renderer.css | 1 | scrollback + loading |
| wterm-renderer.tsx | 1, 4 | loading, wheel, scroll listener |
| wterm-renderer.test.ts | 1, 4 | extend |
| terminal-attachment.ts / tests | 1, 4 | encodeBase64, replay insert |
| app.tsx / app.css | 2 | Picker states; LegacyTerminalAction no last-id hydrate |
| session-terminal-composer.ts / tests | 2 | pass real openTabCount; no reuse when a tab is opening |
| terminal-open-policy.ts / tests | 2 | grace + reusableTerminalId |
| new picker-state.ts (if extracted) | 2 | testable |
| new panel-params.ts (if extracted) | 2 | `initialPanelParams(host)` never reads thread last-id |
| server.ts / server.test.ts | 3 | font cache, read path, schema |
| new plugin-token.ts + test | 4 | shared cache |
| ISA.md | all | checkboxes + Verification stubs |
| pnpm-lock.yaml | never | do not delete |

Reserve files via Agent Mail when parallel agents touch the same path (`app.tsx`, `server.ts`, `wterm-renderer.tsx` are hot).

---

## 7. Test strategy

Always: `npm test` after every slice (ISC-32). Class sweep for sibling BB workspace imports (ISC-35). After server or package changes: `npm install --omit=dev` in a clean copy + `bb plugin build` when feasible (ISC-33).

Unit (Vitest, existing style): fake RPC, fake `bb.sdk`, fake fetch, fake WS. Prefer red tests first for policy, encodeBase64, picker state, linked-id parser, unavailable status.

Do not add Playwright against production BB from CI unless already present. Headed checks are F6.

---

## 8. Risk register

| Risk | Mitigation |
| --- | --- |
| npm ci changes renderer behavior | Phase 0 isolated; tests before pixel patches |
| Read path stale vs concurrent create | Grace on client + next listSessions sees new id |
| Reconcile overwrites a concurrent remember | Re-read current under lock; only remap ids still present |
| Shared token + AbortSignal | Do not abort the shared fetch from a cancelled upload |
| Picker tests require full plugin harness | Extract pure state function |
| unavailable breaks HostTerminalAction | Only synthetic sessions change status |
| Replay insert off-by-one | Keep ISC-8 fixtures as the oracle |
| Composer/new-tab steals last PTY | Empty host params ≠ last id; composer uses real openTabCount; headed ISC-42 |

---

## 9. Explicit non-goals

- Chat ↔ CLI full screen via `experimental_primarySurface`
- Forking `@wterm`
- Deleting `pnpm-lock.yaml`
- Changing upload threat model
- Subsetting Nerd Font
- compileStreaming inside vendor wasm-bindings

---

## 10. Swarm order

Phase 0 before all. Then parallel:

- Track A: CSS/loading/wheel — `wterm-renderer.css`, parts of `wterm-renderer.tsx`
- Track B: encodeBase64 — `terminal-attachment.ts` (coordinate if Track D also edits it)
- Track C: open-policy + picker + **new-tab-never-reuses** — `terminal-open-policy.ts`, `app.tsx`, `session-terminal-composer.ts` (one agent: same files)
- Track D: server read path + font cache + unavailable — `server.ts`

Track D tests before claiming multi-tab done. F6 last.

---

## 11. Done

ISA F1–F5 claims checked with Verification stubs (commit / test name). F6 checked only with headed evidence. `npm test` green. Plugin still installs with omit-dev. Users in BB web: dark first paint, truthful picker, **each new tab is a new PTY**, create does not lie, extra tabs do not wedge, no TUI stripes, no wheel/scroll jump, large paste survives.
