# BB toolchain and TypeScript evidence — `wterm-a4b.13`

Date: 2026-09-06 (UTC)
Scope: evidence-only continuation. No product, dependency, package, configuration, Beads, process, or host changes were made by this continuation.

## Acceptance summary

The requested toolchain evidence is **partially verified**. The repository has a real, bounded TypeScript check and it passes. The current local package graph is internally clean. A real BB browser session loaded successfully with console/page/network diagnostics clean, but this continuation did not create a new Wterm PTY and therefore does not claim a fresh command-echo smoke. The prior Wterm smoke artifact is retained and cited as historical evidence.

## Current source and working-tree evidence

- `git status --short` at inspection: existing implementation/package/document changes were present; this report was the only file added by this continuation.
- `git diff --stat`: existing diff includes application/test files plus `package.json` and `package-lock.json`; no implementation changes were made here.
- No staged files: `git diff --cached --quiet` (exit 0).
- Current lockfile: lockfileVersion 3, 274 package entries. The observed prior comparison was 509 → 274 entries (239 removed, 4 added). The pruning is consistent with the BB 0.42.1 graph removing four `@earendil-works/pi-*` packages; no evidence was found that a required declared package was lost. `node-pty` 1.1 → 1.2.0-beta.15 is an upstream BB dependency, not a root dependency.
- `tsconfig.json` is a new repository file. Its actual typecheck scope is `*.ts` and `*.tsx` at repository root, excluding `dist`, `node_modules`, and `.bb-wterm-uploads`; strict mode, bundler resolution, React JSX, Node/Vitest globals, and explicit SDK path aliases are enabled.

## Toolchain versions and paths

| Surface | Actual evidence |
| --- | --- |
| Node | `v24.19.0` |
| npm | `11.17.0` |
| TypeScript | `Version 5.9.3` from `./node_modules/.bin/tsc` |
| BB executable | `/home/ubuntu/.local/bin/bb` → `/home/ubuntu/.bb-server/app/node_modules/bb-app/dist/bb.js` |
| BB CLI | `0.42.1` |
| package `bb-app` | `0.42.1` |
| package `@get-bb/plugin-sdk` | `0.4.47` |
| React types | `@types/react 19.1.13`, `@types/react-dom 19.1.9` |
| Node types | `@types/node 22.20.1` |
| Wterm packages | `@wterm/dom`, `@wterm/ghostty`, `@wterm/react` all `0.5.0` |
| running watcher | PID 83278, `bb plugin dev /home/ubuntu/Projects/bb-wterm-terminal-plugin` |
| BB web / host daemon | `http://127.0.0.1:38896` / `127.0.0.1:38897` |

`BB_SERVER_URL=... BB_HOST_DAEMON_PORT=... bb plugin source wterm-terminal-preview` resolved to the current repository path and reported engines `bb >=0.35.1`, `bbPluginSdk ^0.4.1`.

## Commands and results

- `timeout 60s npm run typecheck` — **exit 0**. Ran `tsc --noEmit` against the scope above after the existing watcher/build-generated types were present.
- `npm ls @get-bb/plugin-sdk bb-app typescript @types/node @types/react @types/react-dom @wterm/core @wterm/dom @wterm/ghostty @wterm/react node-pty --depth=0` — **exit 0**. No invalid entries; `@wterm/core` is not a root package in this manifest, while the three declared Wterm packages are 0.5.0.
- `BB_SERVER_URL=http://127.0.0.1:38896 BB_HOST_DAEMON_PORT=38897 bb plugin source wterm-terminal-preview` — **exit 0**; source resolved to this checkout.
- Existing `.logs/wterm-0.5.0-tests.log` — correlated prior `npm test` run: 14 files / 120 tests passed, exit implied by successful completion.
- Existing `.logs/wterm-0.5.0-build.log` — correlated prior `npm run build` artifact listing; the log contains an old SDK warning (`0.4.6`) and is not current provenance for the current CLI. Do not mix that warning with the current `0.4.47` package/host observation.
- Existing `.logs/wterm-0.5.0-activation.log` — path install/activation evidence, plugin running, 17 calls.
- Negative typecheck control: no new fixture was created. The earlier worker's negative probe is not independently reproducible from a saved artifact in this checkout, so it is recorded as **not independently verified**, not as a pass.

## Browser evidence

Fresh native `agent_browser` checks used an own session and did not touch other PTYs:

- `qa http://127.0.0.1:38896` with DOMContentLoaded, console, page-error, network checks — **passed**.
- Browser navigated to Extensions → Installed plugins, filtered `wterm`, and confirmed **Wterm Terminal Preview** is installed/enabled.
- Verified screenshot: `.logs/wterm-a4b13-browser.png`.
- Browser resource inspection loaded the BB app successfully; no console/page/network errors were reported by QA.
- The existing Wterm-specific smoke remains `.logs/wterm-0.5.0-smoke.png`; `docs/UPGRADE-WTERM-0.5.0-2026-09-06.md` records its sanitized `printf` marker, 27 terminal rows, no page errors, and served-bundle SHA-256 `5689b07dd31a7d8afc2a1753a9a16130c30d6546d4d09d0d8f14c4049860cab5`. This is prior-run evidence, not a newly generated PTY in this continuation.
- Current local `dist/app.js` SHA-256: `31cf75910d36780bb0f1ac72da14d840d0f6c7155a4e323e8c2d2ddfd3015f43`. A fresh served-Wterm hash match was **not claimed** because the browser session did not open a new Wterm terminal and the watcher can rebuild asynchronously.
- Toast error path (`terminal-panel.tsx:222/230`) was not safely triggered. Treat as an unresolved gap; typecheck cannot prove runtime error-path behavior.

## UBS / review evidence

The reported prior UBS result was 14 critical / 271 warnings, but no saved UBS report was found in the repository or `.logs` during bounded filename/content search. Therefore no file:line classification is possible from durable evidence, and this report does **not** call all findings false positives. No UBS rerun, global doctor/fix, installation, or blanket suppression was performed. Parent should treat the prior UBS result as an unresolved review input and obtain the original report or rerun the approved diff-scoped scanner separately.

## Residual blockers / risks

1. Fresh Wterm PTY command-echo and exact current served `dist/app.js` hash match were not independently produced in this continuation; prior artifact is retained and explicitly labeled historical.
2. Negative typecheck fixture/probe is not durably saved.
3. Toast failure-path runtime behavior remains untested.
4. UBS 14-critical/271-warning report is unavailable, so introduced-vs-pre-existing classification remains blocked.
5. Existing tests/build are accepted only as correlated saved logs, not rerun here.

No files were deleted, no packages or global tools were installed/upgraded, no watcher/server was started or stopped, and no commits/pushes or Beads mutations were performed.
