# BWT-16 evidence

## Diagnosis

Both selection paths rejected a drag whose end point was outside the rendered terminal:

- native selection discarded a `Range` when either endpoint was outside the Wterm element;
- Herdr/TUI cell-copy discarded the drag when the mouseup point was outside the grid.

That made short selections work while a sentence dragged to the edge or past the last cell produced no copy. The native handler also removed its temporary selection CSS before reading the browser selection.

## Change

- Native `Range` selections are cloned and clipped to the terminal boundary when only one endpoint is outside. A selection wholly belonging to the surrounding page is still ignored.
- TUI mouseup coordinates are clamped to the nearest terminal cell for cell extraction.
- Native selection text is read before the temporary CSS boundary is cleared.
- Added regression coverage for an outside endpoint, clamped TUI coordinates, and a complete Herdr OSC 52 sentence.

## Validation

- `npm test -- --run`: 13 files, 105 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- `ubs terminal-selection.ts terminal-selection.test.ts wterm-renderer.tsx osc52-clipboard.test.ts`: no findings reported.
- Headless Chromium `Range` check: the unscoped range included `outside`, while the clipped range returned only `one two three four five`; console and page errors were empty.

## Remaining live check

The active VPS BB UI was reachable, but the installed Wterm plugin reported `rpc listSessions failed: fetch failed`, so an authenticated Herdr/PTTY drag could not be reproduced in the live browser during this run. The source-level and browser DOM checks are complete; production installation and live Herdr smoke still require a healthy PTY RPC.
