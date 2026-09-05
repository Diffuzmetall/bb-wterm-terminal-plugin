# BWT-14 diagnostic evidence

Date: 2026-09-05 (MSK)

## Verified

- Active BB endpoint: `https://vps-7f443bf2.tail8b4514.ts.net:38886`; health returned HTTP 200.
- Host `vps-7f443bf2` was connected and the production Wterm plugin was running at version `0.3.18`.
- Fresh PTY `term_r3gggv7a22` was created in the BWT-14 thread. It emitted `BWT14_REPRO_READY`, accepted input producing `BWT14_LIVE_INPUT_OK`, and accepted a resize from `80x24` to `120x40`.
- The real VPS UI opened the right panel and displayed the `BWT-14 repro PTY` tab. Browser console and page-error checks were empty.
- Repository checks on the unchanged branch passed: `npm test` (13 files, 104 tests) and `npm run build`.

## Runtime signal

The active server log contains repeated event-loop stalls while building the BWT-14 thread timeline. Observed timeline builds ranged from about 150 ms to 3.2 s, with roughly 1.8–2.4 MB of event data and around 1,500 events. `ws:daemon terminal.output` also appears as the last work around some stalls. This is evidence of shared BB responsiveness pressure, not proof of a Wterm renderer failure.

## New screenshot evidence

The screenshot supplied after the repeated restart shows the Wterm canvas rendering normally: two `Wterm terminal` tabs are present, the selected tab has a visible input prompt and live terminal status line. The visible failures are emitted by the program running inside the PTY: `Error: Connect error internal` from the Cursor wire, `Error: Compaction cancelled`, and repeated `cache broke` messages. Production scrollback for `term_zf6gij2bnw` and `term_cv3u9a9m24` contains the same Cursor/compaction messages. This shifts the leading diagnosis toward the embedded agent/runtime rather than Wterm painting or PTY transport.

## Not proven

The exact user terminal that failed after restart was not identified. No correlated Wterm exception, WebSocket close, or replay-sequence failure was found for that terminal. Therefore no renderer or replay patch was applied: changing code without the terminal ID would risk masking the incident and damaging healthy sessions. The screenshot does not prove that the underlying Cursor session recovered; it proves only that the Wterm view remains attached and renders the underlying errors.

## Next evidence needed

Capture the failing tab's terminal ID (or a screenshot including the tab/error) immediately after the next failure. Then correlate its server-side output/replay/close events and test restart on that same session.
