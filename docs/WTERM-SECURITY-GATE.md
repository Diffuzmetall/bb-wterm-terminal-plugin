# Security gate — wterm-a4b.15

2026-09-06. Independent reviewer `b39e2164`, `openai-codex/gpt-5.6-luna`, high (confirmed by runtime). Controller: SwiftLynx. **Acceptance blocked**, not a clean security verdict.

## Reproducible evidence

- HEAD: `c3a301a8a4b71be7b5dd3071a3dde101c7e80e53` plus transferred dirty .13 implementation.
- UBS 5.3.13, explicit 11-file scope including tsconfig and both untracked SDK declarations; scanner counts 10 supported source files.
- Command: `ubs --no-auto-update --ci --format=jsonl --files=app.tsx,osc52-clipboard.ts,server.test.ts,server.ts,terminal-panel.tsx,terminal-selection.test.ts,wterm-renderer.test.ts,wterm-renderer.tsx,tsconfig.json,types/bb-plugin-sdk-app.d.ts,types/bb-plugin-sdk.d.ts .`
- Run 12:08:15–12:09:03 UTC; exit 1, 14 critical / 271 warnings / 1814 info.
- Raw **JSONL**, despite .json extension: `.logs/wterm-a4b-15-ubs.json`, SHA256 `46c2efb4d89ef5c86a4c66a9dd3236cc6719caf5377049670d9a07d9afb669a2`.
- Scope, exact severe locations, dispositions and command exits: `.logs/wterm-a4b-15-scope.json`, SHA256 `f7fa2b656defa360840b3ed80ba8a19bdae5755b894c7d29100208a6afd9a895`.
- stderr: `.logs/wterm-a4b-15-ubs.stderr`. Controller independently confirmed raw/manifest hashes and `git diff --check` exit 0. No staged changes.

## Severe scanner dispositions

All 14 criticals were reproduced and classified, not blanket-suppressed:

1. `app.tsx:365`: dependency warning; effect reads `params.terminalId` and declares that dependency. Pre-existing false positive.
2. `server.ts:314`: object-merge warning; fixed scope and SDK results are collected into a Map keyed by terminal IDs, not request-object properties. Pre-existing false positive.
3. Twelve sensitive-comparison warnings (full locations in manifest): state, shape, title, ID, and integrity-receipt comparisons, not secrets. Same expressions in HEAD. Pre-existing false positives.

No introduced critical/high security defect was found in .13. This does not classify every warning as safe or prove live host behavior.

## Acceptance risks requiring follow-up

- HIGH baseline: threadless upload at `server.ts:360–365` selects active Herdr/Wterm by known ID/title/status; caller-session ownership needs a supported threat-model/host-contract decision before changing PTY semantics.
- HIGH unknown: `server.ts:125–141,392–400` lexical `rootPath` does not itself prove host symlink confinement. Verify actual supported host implementation without writing to user data; missing proof is not a demonstrated exploit.
- HIGH baseline: `osc52-clipboard.ts:143–169` complete terminated frames lack the carry buffer's size bound and explicit consent gating. Separate bounded fix and tests required.
- MEDIUM residual: abort can race `files.write` after the final signal check; SDK call receives no AbortSignal. Investigate supported cancellation semantics rather than claim rollback.

Static checks support thread-scoped authorization, host/cwd/traversal validation, 10/25MiB checks, receipt integrity, OSC8 scheme filtering, no token logging, and package provenance. They do not substitute for live negative authorization tests, symlink tests, or cancellation proof. No product fixes, builds, shared-host restart, or user PTY operations were performed by reviewer.
