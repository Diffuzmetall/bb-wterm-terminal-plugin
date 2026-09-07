---
task: "Make Wterm fast, flicker-free, and reliable"
slug: 20260904-011200_wterm-speed-and-feel
project: bb-wterm-terminal-plugin
phase: climbing
progress: 69/101
started: 2026-09-04T01:12:10+03:00
updated: 2026-09-06T15:18:00Z
principal_stated_goal: "изучи пожалуйста его докумментацию рантайм как он связан с bb как он в целом работает и дай мне детальный план что внедрить что делать чтобы он работал быстро четко не фликерил там все круто открывалось тут в вебе и так далее"
principal_stated_goal_source: conversation
principal_stated_goal_signal: 2
principal_stated_goal_locked: 2026-09-04T01:12:10+03:00
context_sufficient: true
interview_invoked: false
---

## Problem

**Канонический документ проекта — только этот `ISA.md`.** Ни отдельного ISA эпика, ни нового источника критериев не создаём. Ниже сохранена исходная постановка; F0–F11 и их `[x]` — история прежних проверок, а не свежая приёмка текущей установки. Новая работа `wterm-a4b` находится в F12–F17 и ISC-99/100; все новые критерии открыты. `progress` соответствует счётчику Algorithm: checkbox-записи в `Features`, включая исторические и tombstone. Отдельные Anti-claims (ISC-99/100) этот счётчик не учитывает; они остаются обязательными проверками. Счётчик не является процентом готовности текущего эпика.

**Исходная проблема (2026-09-04; не перечень сегодняшних дефектов).** The standalone Wterm plugin already attaches a Ghostty-backed terminal to a BB thread, but opening and using it still feels slow, empty, and jumpy. Installed `@wterm` packages lag the lockfile, token and font work is repeated, create-then-verify races the KV mutex, dead linked IDs look “running,” the picker paints empty, and the renderer flashes a blank frame, leftover TUI row colors, and forced scroll-to-bottom. Users get “session unavailable,” reconnect loops, and a white or empty first paint instead of a terminal that is already there.

**Текущий цикл (2026-09-06).** Требуется согласовать npm/SDK/build и реально обслуживаемый BB артефакт, разобрать security findings, восстановить навигацию, добавить постоянные standalone-вкладки Wterm и измерить отзывчивость до оптимизаций. Старые caches, skeleton и семантику новых thread-вкладок повторно не реализуем. Старые замеры на несогласованной установке — гипотезы, не baseline 0.5.0.

## Vision

Opening a Wterm tab in the BB web app feels like a local terminal that was already warm: dark first paint with a quiet cursor, **each new tab is a new PTY** (never a silent reopen of the previous session), WASM/font/token paid once, replay without a blank hop, no leftover TUI stripes, no jump-to-bottom while reading scrollback, and several tabs at once without verify stalls or zombie reconnects. Attach to an existing thread session only from the picker, by an explicit click. **Уточнение 2026-09-06:** standalone Wterm дополнительно восстанавливает собственные сохранённые вкладки и живые PTY после навигации/reload, пока BB/host работают. «Новый терминал» по-прежнему создаёт новый PTY; переключение/восстановление существующей вкладки — не создание новой. Имена, порядок и активная вкладка сохраняются.

## Out of Scope

- Native `experimental_primarySurface` Chat ↔ CLI full-screen. Packaged BB 0.40/0.41 does not expose it; composer still opens the side panel or picker.
- Replacing `@wterm` / Ghostty with xterm.js or a custom emulator.
- Subsetting the 1.2 MB Nerd Font (license-ok later; not this climb).
- Upstream `WebAssembly.compileStreaming` inside `@wterm/ghostty` (track on next library bump).
- Ослабление upload security ради производительности. **Изменено 2026-09-06:** прежний запрет менять upload security заменён разрешённым разбором и точечным исправлением подтверждённых дефектов `wterm-a4b.15.*`; изменение host ownership/API без согласования по-прежнему вне scope.
- Shipping a new plugin ID or merging into BB’s bundled `wterm-terminal`.
- Deleting `pnpm-lock.yaml` without explicit owner permission.
- Новое внедрение Kitty Graphics и исполнение старого `PLAN.md`/`PLAN-KITTY-GRAPHICS-UPGRADE.md`. F10 остаётся историей и регрессионным контрактом; незакрытый ISC-57 не считается принятым и не исчезает.
- Восстановление процессов после рестарта BB/host; вкладки внутри Herdr или изменение thread-panel ownership; массовый SDK upgrade, приватный emulator fork и спекулятивные caches/schedulers.
- Удаление файлов, commit/push, изменение глобального harness, перезапуск общего BB и воздействие на чужие PTY без отдельного разрешения.

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

**Standalone Wterm-вкладка** — сохранённая запись собственного PTY внутри отдельной страницы Wterm; её переключение не создаёт PTY.
_Avoid:_ «вкладка BB», «новый терминал» для восстановления.
Relates to: host/workspace scope, имя, порядок, active ID; не thread-linked IDs.

**Пункт навигации** — sidebar-вход на страницу Herdr или Wterm, а не правая host-панель.
_Avoid:_ «пропавшая вкладка» без указания поверхности.

**Приёмка** — свежая проверка конкретных source/lock/served hashes; статус Bead или старый `[x]` сам по себе её не доказывает.
_Avoid:_ «готово» по одному build или отправленному клику.

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
- `@wterm/*` target is the lockfile 0.5.0 line after `npm ci`; do not invent a private fork.
- KV schema for linked IDs must read legacy `string[]` and the new record form.
- `zod` 4.3.6 and `vitest` 4.1.10 stay pinned.
- Root `ghostty-vt.wasm` (577 KB, 0.5.0) is the source of truth; `dist/` is build output.
- No file deletion without explicit written permission.
- Probes attach at user-visible or RPC/HTTP seams (`npm test`, plugin HTTP, picker/renderer behavior), not `@wterm` internals.
- Standalone Wterm больше не закрывает свои PTY при уходе со страницы; только подтверждённое закрытие выбранной вкладки завершает её PTY. Это исключение не меняет Herdr/thread lifecycle и не разрешает присваивать чужой PTY по title.
- Before/after сравниваются на одинаковом workload, версиях, cache/viewport и нагрузке; ≥20 открытий по каждому cold/warm сценарию, ≥100 input samples, profiler отдельно. JSON содержит run ID, monotonic marks, counts/hashes, но не токены и пользовательский payload.
- Целевые бюджеты из Beads: feedback p95 ≤50 ms, готовый panel switch p95 ≤100 ms, echo→paint ≤2 кадров; p95 незатронутых путей не ухудшается более чем на 10%. Шумный результат — inconclusive. Бюджеты фиксируются до патча и не ослабляются задним числом.
- Live upload/clipboard probes — только собственные разрешённые тестовые данные и изолированный backend. Нет разрешения — unavailable, не PASS. Изменение зависимостей/активация/очистка не вытекает из редактирования этого ISA.

## Goal

"изучи пожалуйста его докумментацию рантайм как он связан с bb как он в целом работает и дай мне детальный план что внедрить что делать чтобы он работал быстро четко не фликерил там все круто открывалось тут в вебе и так далее"

Make the installed Wterm preview in the BB web app open quickly, stay visually stable, and remain correct under multi-tab create/verify: aligned `@wterm` 0.5.0 assets, bounded Kitty Graphics, no blank/white first frame, no TUI color bleed in scrollback, no false “session unavailable” right after create, no zombie `running` reconnects, shared token/font/WASM work, and the existing standalone security/ordering suite still passing.

**Дополнение 2026-09-06, без замены исходной цели:** текущий эпик принят, когда воспроизводимый npm/SDK/build контур обслуживает проверенный артефакт, подтверждённые security-дефекты устранены, standalone Wterm сохраняет живые вкладки, а отзывчивость подтверждена сопоставимыми измерениями и независимой E2E-приёмкой. Неизвестное, заблокированное и недостигнутые бюджеты перечисляются явно; закрытие допускается только по согласованным критериям либо явно утверждённым отклонениям.

### Связанные материалы и очередь

- Живой epic: `br show wterm-a4b --json`; каждая карточка: `br show <id> --json`, комментарии: `br comments <id> --json`. Beads хранит ход исполнения; этот ISA — целевое состояние. При расхождении сначала обновляем решение и связь, не считаем Bead-статус доказательством.
- [Снимок всех 26 карточек с описаниями, acceptance criteria, dependencies и 9 комментариями](docs/WTERM-BEADS-SNAPSHOT-2026-09-06.json), снят 2026-09-06 13:35:47 UTC. Это исторический экспорт, **не второй ISA**; поля `issues[].id`, `acceptance_criteria`, `comments` сохраняют полный контекст. Перед исполнением читать живую карточку.
- [Handoff и порядок работы](docs/WTERM-BEADS-HANDOFF.md), [npm/dev 0.5.0](docs/UPGRADE-WTERM-0.5.0-2026-09-06.md), [исходные performance-наблюдения](docs/PERFORMANCE-ANALYSIS-2026-09-06.md).
- [SDK/typecheck evidence](docs/BB-TOOLCHAIN-TYPECHECK-EVIDENCE.md), [security gate](docs/WTERM-SECURITY-GATE.md), [ownership gate](docs/WTERM-OWNERSHIP-GATE.md), [navigation QA](docs/WTERM-LINKS-QA-2026-09-06.md). Ссылки не означают принятия их выводов для текущего hash.
- Порядок: восстановление `.20` → SDK/security/navigation blockers → provenance `.3` → baseline `.4` → измеренные оптимизации → `.14`. Standalone `.16` → `.17` → независимая `.18`; общие файлы не правятся параллельно. Актуальные blockers определяет Beads DAG, не этот сокращённый маршрут.

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
| ISC-11 | historical | SUPERSEDED: prior 0.4.0 install | historical only; current target ISC-51/61/67 | npm ls | derived: aligned emulator |
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
| ISC-51 | install | `@wterm` package versions | all 0.5.0 matching lockfile | npm ls | derived: Kitty Graphics upstream |
| ISC-52 | build | root, dist, and package Ghostty WASM bytes | identical SHA-256 | sha256sum/cmp | derived: aligned core |
| ISC-53 | unit/integration | direct Kitty RGB image | image and placement exposed without throw | Vitest + Ghostty | derived: direct graphics |
| ISC-54 | unit/source | image storage, scrollback, palette configuration | explicit bounded options | Vitest | derived: resource budget |
| ISC-55 | unit | renderer cleanup | one core dispose at most once | Vitest | derived: lifecycle |
| ISC-56 | command | regression suite and plugin build | exit 0 | npm + Vitest + bb | derived: no regression |
| ISC-57 | e2e/manual | headed Kitty image PTY smoke | geometry, flow, resize, scrollback, alternate screen clean | agent-browser / BB web | required: live confirmation |
| ISC-58 | unit | clipboard API still runs when legacy `execCommand("copy")` reports success | both copy paths invoked with the same sentence | Vitest | derived: false-positive legacy copy |
| ISC-59 | e2e | Herdr long drag with injected no-op `execCommand → true` | clipboard sentinel replaced by selected row through `writeText` | agent-browser / BB web | literal: copy-on-select |
| ISC-60 | anti | native Chromium short, long, and edge drag remain correct | selected terminal text only; no surrounding BB text | agent-browser / BB web | derived: no copy regression |
| ISC-43 | unit | composer uses real `wtermOpenCount`; helper `resolveSessionTerminalId` takes `openTabCount` | openTabCount>0 does not reuse last; live composer reveals or creates, never last-id on a new tab | Vitest | derived: new tab is new PTY |
| ISC-31 | unit | replay insert stays ordered without full re-sort each chunk | flush order = seq | Vitest | derived: quickly |
| ISC-32 | anti | upload/auth/order tests still pass after speed slices | `npm test` green including server + attachment | Vitest | literal |
| ISC-33 | anti | production-only install still builds | omit-dev + `bb plugin build` exit 0 | npm + bb CLI | derived: prior constraint |
| ISC-34 | anti | no `experimental_primarySurface` required | app still opens panel/picker when API missing | Vitest or type/branch fixture | derived: out of scope |
| ISC-35 | class sweep | new files stay inside this repo | zero BB workspace paths | rg | derived: standalone |
| ISC-36 | e2e/manual | headed BB: first open shows dark skeleton then content, no white flash | observed | agent-browser / BB web | literal |
| ISC-37 | e2e/manual | headed BB: create terminal does not show unavailable within grace | observed | agent-browser / BB web | literal |
| ISC-38 | e2e/manual | headed BB: two tabs open without multi-second verify stall | observed | agent-browser / BB web | literal |
| ISC-47 | unit | fragmented DEC 1003 enable/disable and switch to mutually exclusive 1002 | exact enabled state + generation | Vitest + Ghostty WASM | derived: correct Herdr hover state |
| ISC-48 | unit | no-button SGR motion is one-based and cell-deduplicated | code 35; one report per changed cell | Vitest | derived: responsive without event flood |
| ISC-49 | e2e/manual | headed Herdr hover precedes click and reaches PTY | SGR 35 before press/release; no same-cell duplicates | agent-browser / WebSocket probe | literal |
| ISC-50 | anti | existing click, drag, resize, replay, and security behavior remains green | full suite + build | Vitest + bb CLI | literal |

### Дополнение для текущего эпика

В строках ниже `.N` означает `wterm-a4b.N`; точные workload, edge cases и acceptance clauses находятся в связанной карточке и снимке выше. Они не отменяются краткой формулировкой ISC. Таблица — план проверок, не уже выполненные тесты.

| isc | type | check | threshold | tool | anchors_to |
| --- | --- | --- | --- | --- | --- |
| ISC-44 | historical/e2e | BWT-4 reproduction | symptom recorded | browser | derived: resize stability |
| ISC-45 | historical/e2e | BWT-4 shrink/grow regression | no stale strip | browser + Vitest | derived: resize stability |
| ISC-46 | historical/tracker | BWT-4 evidence/status record | substantive update exists | issue evidence | derived: verifiable delivery |
| ISC-61 | install | `.20` approved recovery, archive/manifest hashes and npm tree | canonical layout, exact pins; residual native failures block | npm + SHA-256 | derived: reproducible runtime |
| ISC-62 | command | `.13` compare three CLI paths and document invocation | one compatible target or explicitly approved pair | CLI versions + build | derived: reproducible runtime |
| ISC-63 | typecheck | `.13` real TS project including toast/narrowing paths; negative control | real defects resolved; negative control fails | npm run typecheck + regression tests | derived: reliable error paths |
| ISC-64 | e2e | `.13.1` both open paths new/existing/close-own | one intended tab, no native duplicate | browser + PTY counts | derived: new tab identity |
| ISC-65 | e2e | `.19` both sidebar entries open correct functional pages across reload | Herdr and Wterm discoverable; existing PTYs unaffected | browser + served hashes | derived: navigation availability |
| ISC-66 | dev | `.2` owned watcher idle/touch/reload | one bounded rebuild series; two idle samples ≥10 s apart stable | process/log/mtime + browser | derived: reliable dev loop |
| ISC-67 | negative-control | `.3` package/lock/install/core/WASM mismatches | build exits nonzero BEFORE new dist/manifest/activation | fixtures + build | derived: artifact provenance |
| ISC-68 | provenance | `.1/.3` successful build manifest compared with served bytes | source/lock/version/hash chain matches | SHA-256 + browser | derived: actual running artifact |
| ISC-69 | review | `.15` diff-scoped scanner findings | each critical/high has evidence disposition; unknown blocks | UBS + independent review | derived: safety gate |
| ISC-70 | boundary | `.15.1` complete/chunked OSC52 at/over byte cap | oversized data never writes clipboard | targeted tests | derived: bounded clipboard |
| ISC-71 | permission | `.15.1` permitted/denied clipboard scenarios | supported consent required; denial safe | own browser clipboard probe | derived: clipboard consent |
| ISC-72 | authorization | `.15.4` threadless resolver non-null threadId/environmentId | reject before files.write; null/null and thread path unchanged | server regression tests | derived: upload scope |
| ISC-73 | authorization | `.15.2` supported ownership contract and own/foreign/missing-token probes | foreign/missing denied before write; no title-only adoption | host source + isolated probes | derived: upload ownership |
| ISC-74 | confinement | `.15.3` symlink/realpath evidence or safe reproducer | no write outside permitted root | host source + isolated probe | derived: safe host paths |
| ISC-75 | cancellation | `.15.3` abort/cancellation contract | documented observable outcome; no unsupported rollback claim | host source + isolated probe | derived: data integrity |
| ISC-76 | e2e | `.16` create three standalone tabs | three distinct own live PTYs and echo markers | browser | derived: new tab is new PTY |
| ISC-77 | e2e | `.16` switch saved tabs | exact original IDs; zero create calls | browser + counters | derived: stable tab identity |
| ISC-78 | persistence | `.16` navigation/reload with host alive | same PTYs/processes/order/active ID | browser + markers | derived: persistent standalone workspace |
| ISC-79 | e2e | `.16` cancel close confirmation | tab and PTYs unchanged | browser | derived: intentional close |
| ISC-80 | e2e | `.16` confirm selected tab close | only selected owned PTY terminates | browser + PTY status | derived: intentional close |
| ISC-81 | failure-path | `.16` host rejects close | tab retained with recoverable error | deterministic failure test | derived: no silent data loss |
| ISC-82 | interaction | `.17` bounded name, Enter/Escape, failed persistence and reload | correct persisted label; unchanged PTY identity | tests + browser | derived: rename without restart |
| ISC-83 | interaction | `.17` drag and keyboard move/reload | exact order/active ID, accessible focus, same PTYs | tests + browser | derived: reorder without restart |
| ISC-84 | persistence | `.16/.17` host/workspace scope and concurrent updates | no foreign adoption or lost committed tab state | deterministic concurrency tests | derived: reliable persistence |
| ISC-85 | lifecycle | `.16` empty/loading/error/exited/offline states | no silent replacement of saved PTY | tests + browser | derived: truthful session state |
| ISC-86 | review | `.18` independent standalone matrix | fresh source/served hashes; no unverified PASS | read-only reviewer + browser | derived: independent acceptance |
| ISC-87 | measurement | `.4` runner, statistics/absent marks, raw JSON | ≥20 opens per cold/warm scenario; ≥100 input samples; p50/p95/min/max/count | runner + browser + stats test | derived: measured responsiveness |
| ISC-88 | experiment | `.5` correlated click→RPC→WS→core→paint/remount | controlled cause evidence or explicit inconclusive/host handoff | traces + control runs | derived: fix cause not symptom |
| ISC-89 | performance | `.6` same-workload before/after of proven startup fix | useful target interval improvement; feedback p95 ≤50 ms; ready switch p95 ≤100 ms | ≥20 controlled browser repetitions | derived: opens quickly |
| ISC-90 | ordering | `.7` duplicate/reverse/interleaved/truncated/reconnect/detach/late subscriber | identical bytes/hash/order for actual protocol contract | attachment tests + browser reconnect | derived: lossless replay |
| ISC-91 | complexity | `.7` operation counts plus same-workload replay benchmark | no quadratic accumulation; counts/hashes unchanged | deterministic count test + benchmark | derived: replay efficiency |
| ISC-92 | experiment | `.8` bounded burst versus idle control | correlated queue/parse/memory evidence supports change or no-change | traces + byte hashes | derived: measured burst handling |
| ISC-93 | scheduler | `.9` only if `.8` proves hotspot; budgets/reentrancy/dispose/overload | zero drop/reorder; finite workload drains; stalls reduced; or justified no-change | fake clock + real WASM + browser | derived: responsive lossless drain |
| ISC-94 | resize | `.10` initial/final/hidden/font/unmount/cancelled-or-absent transition | correct final geometry; no SIGWINCH storm or visual regression | fake timers + shell/TUI browser | derived: fitted surface |
| ISC-95 | scrollback | `.11` dirty/unchanged/discard/cap/selection/resize | no stale rows; measured benefit or evidence-backed no-change | DOM tests + browser metrics | derived: stable scrollback |
| ISC-96 | lookup | `.12` calls, membership/TTL/races and isolated safe upload matrix | fewer target calls without auth/path/integrity regression, or measured no-change | server tests + own browser | derived: efficient authorized lookup |
| ISC-97 | acceptance | `.14` full functional matrix below | every applicable row freshly passes or explicit owner-approved deviation | typecheck/tests/build + independent browser gate | derived: reliable delivery |
| ISC-98 | performance | `.14` baseline/candidate no-profiler distributions | budgets 50/100 ms, echo→paint ≤2 frames; unaffected p95 regression ≤10% | raw JSON + aggregator | derived: measured speed verdict |
| ISC-99 | anti | evidence/log diff | no secrets or user payload | redaction check + review | derived: privacy constraint |
| ISC-100 | anti | `.16/.14` lifecycle/scope regression | Herdr/thread ownership unchanged; no foreign PTY mutation | own-PTY tests + read-only diff review | derived: scope boundary |

Финальная функциональная матрица ISC-97: cold/warm open; existing-panel switch; 1/5/10 собственных tabs с resource cap; new PTY vs composer reveal; navigation/reload; typing/echo; bounded burst; reconnect/truncated replay; hidden/resume; font/resize/maximize; selection/copy; OSC8 scheme validation; OSC52 consent/limits; mouse/wheel; multiline Unicode bracketed paste; существующая Kitty PNG/RGB/RGBA + scrollback/alternate screen; picker loading/error/empty/unavailable/Retry; upload auth, 10/25 MiB limits, SHA/size/conflict, traversal/symlink/unsafe cwd/no-overwrite и abort. Permission-dependent сценарии без разрешения — unavailable. Typecheck выполняется также после build/generated changes; build не заменяет браузерную проверку. Новый графический функционал эта матрица не заказывает.

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

- [x] ISC-11: **SUPERSEDED — 2026-09-06, см. Decisions.** Исторически после `npm ci` пакеты `@wterm/{dom,ghostty,react}` были 0.4.0 по lockfile. Не текущая цель: версия 0.5.0 задана ISC-51, свежая установка/provenance — ISC-61/67/68.
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

Why: a newly created terminal must not silently attach to another session through a last-id cache.

**Уточнение 2026-09-06:** ISC-30/39/40/41/43 описывают создание новой thread-вкладки и composer reveal. Они не запрещают восстановление **той же сохранённой standalone-вкладки** по принадлежащему ей ID (F14). Старый close-on-page-leave отменён только для standalone Wterm; Herdr/thread-панели без изменений.

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

### F8 · BWT-4 right-edge resize stability

Why: dragging the terminal panel's right edge must keep the background, grid,
cursor, and PTY geometry fitted as one surface instead of leaving a stale or
blank region.

- [x] ISC-44: reproduce the BWT-4 attachment symptom during right-edge shrink/grow in headed BB web.
- [x] ISC-45: repeated right-edge shrink/grow keeps renderer bounds and PTY columns synchronized with no stale or blank strip; focused regression, full suite, build, and browser console/network checks pass.
- [x] ISC-46: BWT-4 contains a substantive update, result artifact, and `in_review` status.

### F9 · Herdr any-event mouse semantics

Why: Herdr requests DEC 1003 because its mouse-driven UI needs hover/cell
transitions before the click. Downgrading 1003 to 1002 keeps press/drag but
makes menus feel stale or late even when click transport itself is fast.

- [x] ISC-47: the Ghostty wrapper tracks fragmented 1003 sequences and clears its override when the app selects another mouse tracking mode.
- [x] ISC-48: no-button SGR movement uses code 35 and emits once per changed cell; button drags and Shift selection stay on existing paths.
- [x] ISC-49: headed Herdr sends a hover report before click press/release, with same-cell movement deduplicated.
- [x] ISC-50: the complete suite and plugin build remain green.

### F10 · Upstream Kitty Graphics 0.5.0

Why: Wterm v0.5.0 now provides the bounded Ghostty graphics path, pixel
geometry responses, implicit image flow, and explicit core disposal needed by
the plugin. The BB renderer keeps its transport and local mouse/selection
adaptations while delegating image placement to upstream.

- [x] ISC-51: package and lockfile dependencies resolve to `@wterm/*` 0.5.0.
- [x] ISC-52: root, built, and package Ghostty WASM files remain byte-identical.
- [x] ISC-53: direct Kitty RGB creates a graphics image and placement in Ghostty.
- [x] ISC-54: renderer loads explicit 1 MiB scrollback, 32 MiB image storage,
  and the fixed dark terminal palette; upstream DOM bounds image overlays to
  the actual terminal surface and preserves aspect ratio.
- [x] ISC-55: renderer-owned Ghostty cores are disposed idempotently on cleanup.
- [x] ISC-56: full Vitest suite and plugin build remain green after the bump.
- [ ] ISC-57: headed BB PTY smoke for geometry, implicit flow, resize, scrollback,
  and alternate screen remains blocked until BB/plugin runtime is available.

### F11 · BWT-16 clipboard truth

Why: `document.execCommand("copy")` is legacy and can return `true` without
changing the OS clipboard. Herdr copy-on-select must also use the modern
Clipboard API instead of treating that boolean as proof of delivery.

- [x] ISC-58: direct selection copy invokes both legacy and modern clipboard paths with the same complete sentence.
- [x] ISC-59: in production Chromium, a no-op `execCommand → true` cannot leave the pre-seeded clipboard sentinel after a long Herdr drag.
- [x] ISC-60: normal short, long, and right-edge Herdr drags still copy terminal text only.

### F12 · Воспроизводимая установка и доступный интерфейс

Why: проверять и оптимизировать нужно тот артефакт, который действительно видит пользователь, а не другой SDK или cache.

- [x] ISC-61: npm-окружение восстановлено по разрешённой недеструктивной процедуре с проверенной сохранностью архива/manifest (`.20`).
- [ ] ISC-62: канонический build/dev CLI и совместимый SDK однозначно документированы (`.13`).
- [ ] ISC-63: authoritative typecheck ловит negative control и не содержит необработанных реальных ошибок (`.13`).
- [ ] ISC-64: оба SDK open paths создают ровно одну ожидаемую host-вкладку, без native duplicate (`.13.1`).
- [x] ISC-65: оба sidebar-входа Herdr/Wterm доступны и открывают правильные работающие страницы после reload (`.19`).
- [ ] ISC-66: dev watcher не самоперезапускается без source edits и даёт ограниченный rebuild после одной правки (`.2`, свежая регрессия).
- [ ] ISC-67: любой mismatch package/lock/install/core/WASM прерывает build до записи нового dist/manifest или активации (`.3`).
- [ ] ISC-68: обслуживаемый браузеру артефакт соответствует сохранённой source/lock/version/hash provenance (`.1/.3`, свежая проверка).

### F13 · Доказанные границы безопасности

Why: зелёные тесты и название PTY не доказывают полномочия на запись или доставку clipboard.

- [ ] ISC-69: каждый critical/high текущего diff получил отдельный доказанный disposition, а неизвестное осталось блокирующим (`.15`).
- [x] ISC-70: oversized complete/chunked OSC52 отклоняется до clipboard write на установленной byte-границе (`.15.1`).
- [ ] ISC-71: OSC52 использует поддерживаемый consent-контракт; отказ не меняет clipboard (`.15.1`).
- [x] ISC-72: threadless upload отклоняет PTY с non-null threadId или environmentId до files.write (`.15.4`).
- [x] ISC-73: threadless upload подтверждает scope/ownership поддерживаемым host-контрактом, не только title (`.15.2`).
- [x] ISC-74: upload не пишет за разрешённый root при symlink/realpath сценариях (`.15.3`).
- [x] ISC-75: cancellation/abort имеет доказанный host-контракт; rollback не заявляется без его подтверждения (`.15.3`).

### F14 · Постоянные standalone-вкладки Wterm

Why: уход со страницы не должен уничтожать работу; явное создание и намеренное закрытие остаются единственными действиями смены PTY lifecycle.

- [ ] ISC-76: три команды «Новый терминал» дают три различных собственных живых PTY (`.16`).
- [ ] ISC-77: переключение standalone-вкладок сохраняет их PTY IDs без создания новых процессов (`.16`).
- [ ] ISC-78: навигация/reload при живом host восстанавливает те же PTY/процессы, порядок и активный ID (`.16`). Antecedent: собственные вкладки сохранены, BB/host не перезапускались.
- [ ] ISC-79: отмена подтверждения закрытия не меняет вкладки или PTY (`.16`).
- [ ] ISC-80: подтверждённое закрытие завершает только PTY выбранной собственной вкладки (`.16`).
- [ ] ISC-81: неудачное закрытие сохраняет вкладку и показывает восстанавливаемую ошибку (`.16`).
- [ ] ISC-82: переименование сохраняется после reload без смены PTY; невалидный ввод/отмена не меняют имя (`.17`).
- [ ] ISC-83: reorder через drag или доступную клавиатурную альтернативу сохраняет порядок/active ID без смены PTY (`.17`).
- [ ] ISC-84: persistence изолирован по host/workspace и не теряет подтверждённые изменения при конкуренции (`.16/.17`).
- [ ] ISC-85: empty/loading/error/exited/offline не приводят к скрытой замене сохранённой сессии новым PTY (`.16`).
- [ ] ISC-86: независимый read-only gate подтверждает standalone-матрицу на свежих source/served hashes (`.18`).

### F15 · Измеренная отзывчивость без потери вывода

Why: ускорение должно воспроизводиться в одной среде и сохранять байты, а не существовать только на скриншоте или в удачном прогоне.

- [ ] ISC-87: другой агент воспроизводит baseline с коррелированными startup/input/replay marks и корректной статистикой (`.4`).
- [ ] ISC-88: причина startup/remount задержки установлена контролируемым экспериментом либо честно оформлена как inconclusive/host handoff (`.5`).
- [ ] ISC-89: исправление доказанной startup-причины улучшает целевой интервал и достигает согласованных feedback/switch бюджетов (`.6`).
- [ ] ISC-90: replay/reconnect доставляет те же bytes/hash/order без потерь и дубликатов в реальном protocol-контракте (`.7`).
- [ ] ISC-91: накопление replay не имеет квадратичного числа операций (`.7`); ISC-31 остаётся прежней гарантией отсутствия полного re-sort, не доказательством этой сложности.
- [ ] ISC-92: bounded burst study доказывает необходимость scheduler либо измеренно обосновывает no-change (`.8`).
- [ ] ISC-93: условный drain сохраняет ordered zero-drop delivery при конечном overload и сокращает stalls; если hotspot не подтверждён, есть явное no-change решение (`.9`). Глобальная bounded-memory гарантия без backpressure-контракта не заявляется.

### F16 · Resize, история и lookup без регрессий

Why: оптимизировать стоит только измеренную стоимость, не меняя привычное поведение терминала и authorization.

- [ ] ISC-94: initial/final PTY resize корректен при анимации, hidden/resume, font change и отсутствии transitionend без SIGWINCH storm (`.10`).
- [ ] ISC-95: scrollback остаётся корректным при dirty rows/discard/cap/resize/selection; оптимизация подтверждена метриками либо принято измеренное no-change (`.11`).
- [ ] ISC-96: list/upload lookup сокращает доказанный overhead без ослабления membership/path/size/integrity гарантий либо получает измеренное no-change (`.12`).

### F17 · Свежая итоговая приёмка

Why: ни старые `[x]`, ни закрытая карточка не подтверждают работу другого установленного bundle.

- [ ] ISC-97: финальный read-only gate принимает перечисленную функциональную матрицу на согласованном артефакте с явными unresolved/skipped/inconclusive (`.14`).
- [ ] ISC-98: сопоставимые no-profiler before/after серии достигают согласованных бюджетов без >10% p95 регрессии незатронутых путей (`.14`); недостижение блокирует fast verdict.

## Anti-claims

- Anti: tests do not depend on the sibling BB workspace at runtime.
- Anti: after each speed/feel slice, `npm test` still passes including `server.test.ts` and `terminal-attachment.test.ts`.
- Anti: `npm install --omit=dev` plus `bb plugin build .` still exits 0.
- Anti: missing `experimental_primarySurface` still opens side panel or picker rather than crashing.
- Anti: new modules do not import paths outside this repository.
- Anti: `LegacyTerminalAction` (and any host path) must not treat localStorage last-id as the identity of a newly opened tab when host params have no terminalId.
- Anti: a truthy legacy `execCommand("copy")` result must not suppress the modern Clipboard API write.

- [ ] ISC-99: Anti: тестовые логи/evidence не содержат credentials, пользовательских команд или вывода.
- [ ] ISC-100: Anti: standalone-вкладки не меняют Herdr/thread PTY ownership и не воздействуют на чужие PTY.

## Decisions

- 2026-09-06: **refined: по прямому указанию пользователя единственный канонический документ — корневой `ISA.md`.** Новые критерии добавляются сюда; старые ID и история сохраняются. Прерванная попытка `docs/WTERM-ISA.md` файла не создала (проверено перед редактированием); снимок Beads — только источник комментариев/acceptance, не отдельная спецификация.
- 2026-09-06: refined: добавлены ISC-61–100 для `wterm-a4b`; ни один не принят. Исторические `.1/.2` и ISC-51/56 не доказывают исправность после npm/SDK drift — свежие проверки ISC-61/66/68/97. Старые 59/60 были несогласованным счётчиком: пересчитаны реальные checkbox-записи, включая дробные IDs и исторические tombstones.
- 2026-09-06: refined: ISC-11 (0.4.0) помечен SUPERSEDED; его исторический PASS сохранён. Актуальная версия 0.5.0 — ISC-51, fail-fast — ISC-67; не требовать двух версий одновременно.
- 2026-09-06: refined: `.16` разрешает persistent standalone Wterm: navigation/reload восстанавливает **ту же** вкладку, а не новую. Это не возврат DROPPED ISC-30 и не отмена ISC-39/40/41/43 для новых thread tabs. Close-on-page-leave отменён только здесь; Herdr/thread unchanged.
- 2026-09-06: refined: security-fix scope `.15.*` заменяет прежний blanket запрет менять upload security. Threadless session exclusion `.15.4` не доказывает изоляцию от доверенного same-token API caller; ownership `.15.2` и confinement/cancellation `.15.3` остаются отдельными проверками.
- 2026-09-06: refined: ISC-31 проверял отсутствие полного re-sort, но не всю сложность replay — добавлен ISC-91. Решение о 250 ms resize debounce остаётся историческим; `.10`/ISC-94 может изменить scheduling только с before/after и сохранением ISC-45.
- 2026-09-06: Kitty Graphics не новая задача этого цикла. ISC-57 остаётся открытым историческим live-check; availability проверяется заново перед probe, старый HTTP 502 не считается нынешним диагнозом. Статусы старых утверждений не массово переоткрываем, текущую регрессию принимает ISC-97.
- 2026-08-15: Ported standalone tests rather than copying BB-private host hooks; closed ISC-1–ISC-10.
- 2026-09-04: New project climb replaces the completed test-port goal. Old ISC IDs stay closed; new work starts at ISC-11 (ID stability).
- 2026-09-04: ANALYSIS.md is the evidence corpus (static code; no headed profiling yet). FLICKER-03 and PERF-03 stay partly fog until headed BB.
- 2026-09-04: Ambiguity check: done means the ANALYSIS slices that make open/use fast and visually stable in BB web, not a Ghostty rewrite and not primarySurface. `context_sufficient: true`; interview not invoked.
- 2026-09-04: Attachment lift (PERF-03) held as fog rather than a premature ISC, so agents do not invent a lifecycle that BB 0.41 may not allow.
- 2026-09-04: Font subsetting and compileStreaming listed Out of Scope / fog so the plan stays shippable.
- 2026-09-04: Principal correction: a new terminal / new tab must open a **new** session, not the previous one. Dropped ISC-30 (Reopen last during picker loading). `readLastTerminalId` remains only as a cache write for the current tab and for explicit picker attach. `LegacyTerminalAction` localStorage fallback is the likely current bug (new tab with empty params mounts last PTY). Composer button may still _reveal an already-open panel_; it must not cause a **new** tab to steal last id.
- 2026-09-04: `bb plugin build` emits JS/CSS only. `npm run build` now copies repo-root `ghostty-vt.wasm` and the Nerd Font into `dist/` after the bundle. The 0.4.0 pin was the prior baseline and is superseded by F10's 0.5.0 bump.
- 2026-09-04: `_measureCharSize` still exists on `@wterm/dom` 0.4.0 as a private method. No fork. Font-size refit keeps the optional private call plus public `resize`.
- 2026-09-04: Headed F6 closed on BB web (`thr_fgn2njixb7`). Hide/show remounts `TerminalPanel`, but reconnect was not a user-visible stall (WASM cached, PTY still running). Keep PERF-03 / `.16` fog — do not lift attachment.
- 2026-09-04: Closed fog bead `.16` without implementation. Epic F1–F5 unit/ISC verified; F6 headed observed.
- 2026-09-04: Killed fog PERF-03 / attachment lift — headed remount reconnect was not user-visible; out of this climb.
- 2026-09-04: Killed fog browser HTTP cache for WASM/font — still needs security review; not this climb.
- 2026-09-04: BWT-4 reproduction showed two PTY resizes during BB's 220ms maximize transition. Keep local Wterm auto-resize responsive, but debounce SIGWINCH delivery for 250ms and record only delivered geometry.
- 2026-09-04: Herdr click transport is not the bottleneck: click → WebSocket input measured 0.3–2.9ms, while the multi-chunk PTY redraw completed around 99–111ms. The actionable compatibility defect was the local 1003 → 1002 downgrade: add only missing no-button SGR motion, deduplicated by terminal cell; do not invent a broader renderer/WebSocket optimization.
- 2026-09-05: Wterm v0.5.0 is the Kitty Graphics boundary. Use its `imageStorageLimit`, geometry responses, surface-bounded DOM overlays, and implicit-flow handling; keep BB-specific transport and selection wrappers. Do not invent app-level image dimensions before headed evidence.
- 2026-09-06: BWT-16 user report reopens clipboard delivery. Headed Herdr reproduced the false-success class by replacing `execCommand` with a no-op returning `true`: the copy toast/path ran, `navigator.clipboard.writeText` was skipped, and the seeded clipboard sentinel remained. Keep the synchronous path, but never use its boolean to suppress the modern write.

## Learning

- 2026-08-15 — Conjectured: test-only migration. Refuted by: source-install WASM resolved one directory too high. Learned: source and built asset resolution both need coverage. Criterion now: ISC-2/ISC-12 still demand aligned WASM after `npm ci`.
- 2026-09-04 — Conjectured: hide/show stall needs lifted WebSocket attachment. Refuted by: headed `thr_fgn2njixb7` remount with cached WASM and immediate prompt. Learned: remount ≠ user-visible reconnect cost on 0.41. Criterion now: PERF-03 stays killed, not an ISC.
- 2026-09-04 — Conjectured: frame-level resize forwarding was harmless. Refuted by: WebSocket instrumentation observed intermediate 74x31 then 127x31 PTY sizes during one maximize animation. Learned: the local grid may follow animation frames, but full-screen TUIs need one settled SIGWINCH; hidden sizes must cancel pending delivery without marking it complete.
- 2026-09-04 — Conjectured: slow Herdr menu clicks came from Wterm's pointer handler or synchronous renderer work. Refuted by: SGR send in ≤2.9ms, first PTY response around 18ms, ≤0.7ms per incoming chunk, no click long tasks. Learned: preserve the downstream ~100ms redraw as a separate fact; fix the observable protocol gap where DEC 1003 hover produced no input at all.

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
- ISC-44/45/46: BWT-4 attachment reproduced in headed Chromium on <http://127.0.0.1:38896> thread `thr_fgn2njixb7`. Before fix, maximize emitted intermediate PTY sizes 74x31 and 127x31; final bundle `f16766173b42ef1f` emits one 61x31 on restore and one 128x31 on maximize, with Herdr filling the surface and no stale/blank strip. `wterm-renderer.test.ts` 11/11; full suite 13 files / 98 tests; `npm run build`; browser console/page errors and 4xx/5xx empty. BWT-4 attachment `01M1P65D7W4RXA0DQ2VYXQHP8Y`; status `in_review` (2026-09-04).
- ISC-47/48/50: red-green tests cover fragmented 1003, explicit disable, direct switch to 1002, SGR code/modifiers/one-based coordinates, same-cell dedupe, button-held and Shift exclusions. `npm test`: 13 files / 102 tests; `npm run build`; `git diff --check` clean (2026-09-04).
- ISC-49: headed Chromium on <http://127.0.0.1:38896> thread `thr_svxmvyshea` after plugin reload. Herdr click emitted `<ESC>[<35;8;5M` before `<ESC>[<0;8;5M` press and `<ESC>[<0;8;5m` release. Ten synthetic mousemoves inside one cell emitted exactly one `<ESC>[<35;11;6M`; browser console/page errors and captured 4xx/5xx were empty. Screenshot: `/home/ubuntu/.bb/pi-bridge-sessions/thr_svxmvyshea/wterm-herdr-1003-smoke.png` (2026-09-04).
- ISC-51/52: `npm ls` resolves `@wterm/core`, `@wterm/dom`, `@wterm/ghostty`, and `@wterm/react` at 0.5.0; root, `dist/`, and package Ghostty WASM SHA-256 remain `4a0a02357206349ed52b76ebda8feea4a65e453fe4e199832d8c009d7c41ba4f` (2026-09-05).
- ISC-53/54: direct Kitty RGB integration exposes one image/placement; renderer option and lifecycle tests cover bounded storage/palette and upstream image-surface delegation (2026-09-05).
- ISC-55/56: idempotent `dispose()` seam test and full `npm test` 14 files / 115 tests plus `npm run build` pass (2026-09-05).
- ISC-57: headed BB smoke remains unverified because `bb plugin dev` and the active BB endpoint return HTTP 502 (2026-09-05).
- ISC-58/59/60: red test proved a truthy legacy result suppressed `writeText`; post-fix full suite 14 files / 120 tests and build pass. Production bundle `54750960f06c5eb2` on the active VPS replaced an injected `BWT16_FALSE_POSITIVE_SENTINEL` with the complete Herdr row through `writeText`; normal short drag copied `- Данные`, and right-edge drag copied the complete terminal row without surrounding BB text. Browser console and page errors were empty (2026-09-06).
- ISC-61: approved non-destructive recovery on `main`; `npm ci --ignore-scripts --no-audit --no-fund`, `npm ls --depth=0`, typecheck, and 128-test suite passed; original manifest hashes unchanged and backup retained at `/home/ubuntu/wterm-recovery.wz09yzax/node_modules.backup.20260906T144714Z.1023880` (2026-09-06). Native `better-sqlite3` bindings remain intentionally unavailable because lifecycle scripts were not run.
- ISC-70: regression/probe — `.15.5` five red regressions then 21 focused/133 full tests pass; parent repeated byte-roundtrip, split-ESC and oversized-tail probes successfully; logs `/tmp/wterm-a4b.15.5-*.log` (2026-09-06).
- ISC-71: partial only — activation/deferral unit tests pass; supported consent and refusal behavior in the current browser artifact remain unverified. Prior checkbox withdrawn (2026-09-06).
- ISC-72: threadless upload rejects non-null `threadId`/`environmentId` before `files.write`; accepted host and thread-owned cases retained, independent review PASS; full 128 tests and typecheck passed (2026-09-06).
- ISC-73: source + isolated probes — BB `da88763504c677267ba4f59a3cd04f7ca631be40`, `routes/plugins.ts:79-100,501-525`; four actual token-auth function probes pass, plugin scope regressions pass; full-trust plugin token, not per-user ownership. Served revision remains ISC-68 (2026-09-06).
- ISC-74: source + filesystem probes — same BB revision, `file-write.ts:69-100,126-153`, `root-path.ts`; four extracted-helper cases pass, preserved fixture `/tmp/wterm-confinement-ksGMpA`. Static symlink confinement proven; concurrent external path mutation not claimed (2026-09-06).
- ISC-75: contract — SDK `FileWriteArgs` has no signal; plugin checks abort before dispatch, with no cancellation or rollback guarantee after dispatch; pre-aborted server regression passes. Reviewed source, not live served behavior (2026-09-06).
- ISC-65: browser — named session `wterm-goal-nav`, both sidebar buttons navigate to `/plugins/wterm-terminal-preview/{wterm,herdr}`; Wterm renders prompt after reload; screenshots `/tmp/wterm-goal-nav-reload.png`, `/tmp/wterm-goal-herdr-nav.png`; served JS SHA256 `25988cf55b1134794eccd1b43a67c7aa74f1d5c485531ea0bdbd6e2214480251`, different from local dist (ISC-68 pending), 2026-09-06.
