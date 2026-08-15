---
task: "Port standalone Wterm regression tests"
project: bb-wterm-terminal-plugin
phase: complete
progress: 13/13
started: 2026-08-15T17:34:05+03:00
updated: 2026-08-15T17:50:14+03:00
principal_stated_goal: "MGrin предложил перенести тесты из BB workspace в standalone-репозиторий. Он отдельно отметил, что это не требование листинга давай сделаем, а для чего это нужны очень пули."
principal_stated_goal_source: prompt
principal_stated_goal_signal: 4
principal_stated_goal_locked: 2026-08-15T17:34:05+03:00
context_sufficient: true
interview_invoked: false
---

## Problem

The public standalone plugin builds, but it has no local test command. Its file-upload and terminal-attachment invariants are therefore protected only by tests in a different repository whose implementation can drift.

## Vision

A fresh contributor can clone the public repository, run one documented command, and obtain direct evidence that its full-trust upload and terminal-stream boundaries still behave safely.

## Out of Scope

This slice does not redesign the plugin, change runtime behavior, or copy monorepo tests whose assertions depend on BB-private host hooks.

## Constraints

- Runtime dependencies must remain available under the managed installer's `npm install --omit=dev` path.
- Tests must exercise the standalone sources, not import implementations from the BB workspace.
- Test-only files and dependencies must not become runtime requirements.

## Goal

"MGrin предложил перенести тесты из BB workspace в standalone-репозиторий. Он отдельно отметил, что это не требование листинга давай сделаем, а для чего это нужны очень пули."

Ship a focused standalone test suite for the security- and ordering-sensitive behavior that users install from this repository.

## Claims

- [x] ISC-1: `npm test` exists and exits zero from the standalone repository. Falsifier: the script is missing or the suite fails.
- [x] ISC-2: production-only dependency installation still builds the plugin. Falsifier: `npm install --omit=dev` plus plugin build fails in a clean copy.
- [x] ISC-3: upload paths discard caller filenames and stay below the absolute terminal cwd. Falsifier: a traversal-like filename appears in the generated path or a relative cwd is accepted.
- [x] ISC-4: declared uploads above the applicable size limit are rejected before host write. Falsifier: an oversized `content-length` reaches `bb.sdk.files.write`.
- [x] ISC-5: streamed uploads that exceed the applicable limit are rejected before host write. Falsifier: excess streamed bytes reach `bb.sdk.files.write`.
- [x] ISC-6: uploads reject terminal IDs outside the requested thread. Falsifier: an upload crosses thread scope.
- [x] ISC-6.1: restarts reject terminal IDs outside the requested thread. Falsifier: a restart crosses thread scope.
- [x] ISC-7: host conflict or mismatched size/SHA never returns upload success. Falsifier: any unverifiable write returns HTTP 201.
- [x] ISC-8: replay output is delivered before buffered live output without duplicate sequences. Falsifier: an ordering fixture emits live-first or duplicates.
- [x] ISC-9: queued input flushes exactly once after socket open. Falsifier: an input message is lost or duplicated.
- [x] ISC-9.1: only the latest queued resize flushes after socket open. Falsifier: an obsolete resize is sent or the latest resize is lost.
- [x] ISC-9.2: detach closes only the browser socket and sends no terminal-close message. Falsifier: detach sends a PTY close command.
- [x] ISC-10: Anti: tests do not depend on the sibling BB workspace at runtime. Falsifier: any test/config/package script imports an absolute or relative path outside this repository.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to |
| --- | --- | --- | --- | --- | --- |
| ISC-1 | command | run standalone suite | exit 0 | npm + Vitest | principal_stated_goal |
| ISC-2 | install/build | clean production-only install and build | exit 0 | npm + bb CLI | Goal |
| ISC-3 | unit | hostile filename and relative cwd cases | all pass | Vitest | Goal |
| ISC-4 | boundary | oversized declared body | HTTP 413; zero writes | Vitest | Goal |
| ISC-5 | boundary | oversized streamed body | HTTP 413; zero writes | Vitest | Goal |
| ISC-6 | authorization | wrong-thread upload | rejected | Vitest | Goal |
| ISC-6.1 | authorization | wrong-thread restart | rejected | Vitest | Goal |
| ISC-7 | integrity | conflict/SHA/size fixtures | never HTTP 201 | Vitest | Goal |
| ISC-8 | ordering | replay/live sequence fixture | exact ordered output | Vitest | Goal |
| ISC-9 | lifecycle | queued input fixture | sent exactly once | Vitest | Goal |
| ISC-9.1 | lifecycle | two queued resizes | only latest sent | Vitest | Goal |
| ISC-9.2 | lifecycle | detach fixture | socket close only | Vitest | Goal |
| ISC-10 | class sweep | search test imports and package scripts | zero external-workspace paths | rg | Constraints |

## Decisions

- 2026-08-15: Port behavior, not files blindly; the public legacy WebSocket attachment and asset paths differ from the official plugin integration.

## Verification

- ISC-1: `npm test` — 15 tests passed.
- ISC-2: clean production-only install and `bb plugin build .` — exit 0.
- ISC-3 through ISC-7: `server.test.ts` boundary fixtures — passed.
- ISC-8 through ISC-9.2: `terminal-attachment.test.ts` ordering and lifecycle fixtures — passed.
- ISC-10: standalone test bridge resolves the published SDK package; no BB workspace imports.
- Environment: Node.js 22.19.0; GitHub Actions workflow validated with actionlint.

## Learning

- 2026-08-15 — Conjectured: this would be a test-only migration. Refuted by: the source-install asset test exposed a WASM path that resolved one directory too high while the built `dist` path worked. Learned: source and built plugin asset resolution both need explicit regression coverage.
