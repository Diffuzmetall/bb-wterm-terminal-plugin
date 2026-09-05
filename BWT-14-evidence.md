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

## Root cause and remediation

- The active provider was `@rahularya01/pi-cursor` 1.4.28 with the default Cursor client header `cli-2026.05.01-eea359f`.
- Its lifecycle/scrollback evidence contained `wire_drift`, unknown `ExecServerMessage` and `ConversationCheckpointUpdate` fields, repeated stream starts, and KV blob misses. Those failures explain the stalled agent and cancelled compaction while Wterm continued to render correctly.
- `pi-cursor` 1.4.30 added the missing Cursor `agent.v1` envelope fields. Version 1.4.31 also updated the default client header to `cli-2026.07.23-e383d2b`, made transient `internal`/`unavailable` end-stream failures recoverable, and fixed incomplete checkpoint/blob replay.
- The global pinned package was changed from 1.4.28 to 1.4.31. The installed package, settings pin, and bundled client header were verified on disk.
- `/reload` was sent once through the affected Wterm/Herdr client. The old bridge closed at the same timestamp; no other terminal session was restarted or closed.
- A clean authenticated process using the updated transport completed a real `cursor-account-2/cursor-grok-4.6` turn with exact output `BWT14_CURSOR_OK` and exit code 0.

## Remaining uncertainty

The transient colour change was not reproduced independently. No correlated Wterm exception, WebSocket close, or replay-sequence failure was found, so no renderer/replay source patch was applied. The verified remediation addresses the terminal becoming unusable because the embedded Cursor provider stalled; it does not claim a separate Wterm colour-rendering RCA.

## Follow-up if the visual symptom returns

Capture the failing tab's terminal ID and screenshot immediately after the colour change. Correlate that ID with terminal resize/replay events before changing renderer code.
