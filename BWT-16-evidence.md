# BWT-16 evidence

## Diagnosis

The first fix addressed two real boundary defects:

- native selection discarded a `Range` when either endpoint was outside the Wterm element;
- Herdr/TUI cell-copy discarded the drag when the mouseup point was outside the grid.

That made short selections work while a sentence dragged to the edge or past the last cell produced no copy. The native handler also removed its temporary selection CSS before reading the browser selection.

The user then confirmed that production copy-on-select still failed. A real
Herdr drag in the production BB panel reproduced the remaining clipboard
delivery defect. With `document.execCommand("copy")` instrumented as a no-op
that returned `true`, Wterm showed the success path but never called
`navigator.clipboard.writeText`; pasting returned the pre-seeded
`BWT16_FALSE_POSITIVE_SENTINEL`. The deprecated API's boolean was being treated
as proof that the OS clipboard had changed.

## Change

- Native `Range` selections are cloned and clipped to the terminal boundary when only one endpoint is outside. A selection wholly belonging to the surrounding page is still ignored.
- TUI mouseup coordinates are clamped to the nearest terminal cell for cell extraction.
- Native selection text is read before the temporary CSS boundary is cleared.
- Added regression coverage for an outside endpoint, clamped TUI coordinates, and a complete Herdr OSC 52 sentence.
- Direct selection copy now also invokes the modern Clipboard API even when the legacy `execCommand("copy")` call reports success. The legacy path remains for synchronous user-gesture compatibility.
- Added regression coverage that fails when a truthy legacy result suppresses `navigator.clipboard.writeText`.

## Validation

- Red regression: focused test failed because `writeText` had zero calls after `execCommand` returned `true`.
- Focused post-fix suite: 2 files, 30 tests passed.
- `npm test -- --run`: 14 files, 120 tests passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- `ubs osc52-clipboard.ts osc52-clipboard.test.ts`: 0 critical and 0 warning findings.
- Headless Chromium `Range` check: the unscoped range included `outside`, while the clipped range returned only `one two three four five`; console and page errors were empty.
- The fixed worktree was installed on the active VPS BB host. Plugin status was `running`, `statusDetail` was null, and the bundle hash was `54750960f06c5eb2` with SDK `0.4.34`.
- A live thread-scoped PTY returned through Wterm `listSessions`; its output contained the complete marker `BWT16_COPY_SENTENCE one two three four five`. The test PTY then exited cleanly with code `0`.
- Production Chromium false-positive probe: after a long Herdr drag, `writeText` received `- Данные не удаляются; orchestrator-swarm-pi сохранит свои локальные тесты и`, and paste returned the same row instead of the sentinel.
- Production Chromium normal probes: short drag pasted `- Данные`; a long drag ending beyond the right terminal edge pasted the complete visible terminal row and did not include surrounding BB UI.
- Browser console contained only Ghostty capacity logs; page errors were empty.
