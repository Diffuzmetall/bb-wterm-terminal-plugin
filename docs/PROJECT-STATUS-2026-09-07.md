# Статус проекта BB Wterm Terminal Plugin

**Дата среза:** 7 сентября 2026 года, 10:52 MSK
**Репозиторий:** `Diffuzmetall/bb-wterm-terminal-plugin`
**Основная ветка разработки:** `main`

## Короткий вывод

1. **Стабильная `v0.4.0` уже опубликована и работает на production BB:** plugin закреплён на коммите `39adf9c`, включён и имеет статус `running`; production browser smoke прошёл без ошибок console, page и network.
2. **Интеграция завершена:** завершённые локальные изменения разложены по коммитам, `origin/main` влит без конфликтов, все локальные ветки входят в `main`, рабочее дерево чистое.
3. **`main` и compatibility mirror `master` обновлены атомарно:** точка интеграции кода — `844d345`. Ветка содержит performance baseline, persistent tabs, security/lifecycle fixes, SDK 0.4.47 и воспроизводимый build preflight.
4. **Проверки зелёные:** preflight, TypeScript, 157 тестов, build и LSP прошли. Для следующего stable speed-релиза остаётся критический путь `.5 → .6`, `.7`, `.18` и `.14`; весь backlog закрывать заранее не нужно.

## 1. Состояние Beads

### Сводка

| Статус | Количество |
| --- | ---: |
| Закрыто | 37 |
| Открыто | 11 |
| В работе | 0 |
| Готово к работе | 7 |
| Циклы зависимостей | 0 |

Важно: закрытый Bead означает, что его критерии были приняты в локальном рабочем контуре. Это **не гарантирует**, что соответствующий код уже закоммичен, запушен или опубликован. Файл `.beads/issues.jsonl` сейчас изменён локально, поэтому удалённый репозиторий не отражает весь текущий статус Beads.

### Закрытые Beads текущего цикла `wterm-a4b`

| Bead | Что сделано |
| --- | --- |
| `wterm-a4b.1` | Согласованы Wterm 0.5.0, lockfile, WASM и активный источник BB. |
| `wterm-a4b.2` | Устранён self-trigger dev watcher; подтверждён стабильный dev-режим. |
| `wterm-a4b.3` | Добавлены fail-fast preflight и build provenance. |
| `wterm-a4b.4` | Создан воспроизводимый baseline startup/input/replay и JSON-метрики. |
| `wterm-a4b.13` | Определён канонический BB build CLI и согласован SDK-контур. |
| `wterm-a4b.13.1` | Сохранён один terminal tab при новом открытии после SDK 0.4.47. |
| `wterm-a4b.13.1.1` | Закрытие plugin tab закрывает связанный Wterm PTY. |
| `wterm-a4b.15` | Разобраны security findings без blanket false-positive. |
| `wterm-a4b.15.1` | OSC 52 ограничен полными кадрами; запись в clipboard требует согласия. |
| `wterm-a4b.15.2` | Подтверждена модель авторизации threadless upload. |
| `wterm-a4b.15.3` | Проверены symlink confinement и границы отмены upload. |
| `wterm-a4b.15.4` | Thread/environment PTY запрещены в threadless upload resolver. |
| `wterm-a4b.15.5` | Сохранены сырые PTY-байты и fragmented OSC 52 framing. |
| `wterm-a4b.16` | Реализованы постоянные standalone Wterm tabs с восстановлением живых PTY. |
| `wterm-a4b.17` | Добавлены rename/reorder, сохранение порядка и активного tab. |
| `wterm-a4b.19` | Восстановлены пункты навигации Herdr и Wterm. |
| `wterm-a4b.20` | Восстановлено npm-окружение после нежелательной pnpm-установки. |
| `wterm-a4b.21` | Проверены dispatch safety, зависимости и ownership. |
| `wterm-a4b.22` | Диагностика Agent Mail остановлена по решению пользователя; продуктовый код не менялся. |

### Закрытый цикл `wterm-speed-feel-ftz`

| Bead | Что внедрено |
| --- | --- |
| `wterm-speed-feel-ftz` | Закрыт основной цикл скорости, корректности и визуальной стабильности. |
| `.1` | Wterm приведён к согласованной версии и проверен WASM. |
| `.2` | Тёмный loading skeleton и прозрачные TUI-строки. |
| `.3` | Не очищается collapsed selection при wheel. |
| `.4` | Безопасное chunked/native Base64-кодирование больших paste. |
| `.5` | Grace period для presence-проверки после создания PTY. |
| `.6` | Явные состояния picker: loading, failed, loaded. |
| `.7` | Кэш Nerd Font bytes на HTTP-слое plugin. |
| `.8` | Read path linked terminals выведен из write mutex. |
| `.9` | Dead-ID TTL и expand-contract для linked terminal records. |
| `.10` | Отсутствующие сессии показываются как unavailable, а не running. |
| `.11` | Единый retryable cache plugin token. |
| `.12` | Ordered replay insert без полной сортировки на каждом chunk. |
| `.13` | Follow-bottom привязан к реальному внутреннему `.wterm` scroller. |
| `.14` | Regression gate: тесты, production install/build и отсутствие workspace imports. |
| `.15` | Headed BB smoke: paint, create, два независимых tabs. |
| `.16` | FOG-задача закрыта без внедрения: remount не дал пользовательской деградации. |
| `.17` | Новый Wterm tab всегда создаёт новую сессию, а не переиспользует последний PTY. |

## 2. Открытые Beads

| Bead | Приоритет | Статус / назначение |
| --- | ---: | --- |
| `wterm-a4b` | P1 | Родительский epic Wterm 0.5.0. |
| `wterm-a4b.5` | P1 | **Ready:** локализовать задержку BB до `openWterm` и стоимость remount. |
| `wterm-a4b.6` | P1 | Уменьшить подтверждённую задержку открытия; зависит от диагностики `.5`. |
| `wterm-a4b.7` | P1 | **Ready:** убрать квадратичное накопление replay. |
| `wterm-a4b.8` | P1 | **Ready:** измерить parsing/queue stall при burst. |
| `wterm-a4b.9` | P2 | Вводить time-budget drain только если `.8` подтвердит stall. |
| `wterm-a4b.10` | P2 | **Ready:** разделить первый PTY resize и стабилизацию анимаций. |
| `wterm-a4b.11` | P2 | **Ready:** проверить повторную сборку scrollback DOM. |
| `wterm-a4b.12` | P2 | **Ready:** сократить list/upload lookup на больших списках. |
| `wterm-a4b.14` | P1 | Финальная end-to-end приёмка по сравнительным метрикам. |
| `wterm-a4b.18` | P1 | **Ready:** независимая приёмка persistent standalone tabs. |

Сейчас реально готовы к работе семь задач: `.5`, `.7`, `.8`, `.10`, `.11`, `.12`, `.18`.

## 3. Что уже запушено и опубликовано

### Стабильный release

- Опубликован GitHub Release [`Wterm Terminal Preview v0.4.0`](https://github.com/Diffuzmetall/bb-wterm-terminal-plugin/releases/tag/v0.4.0), tag `v0.4.0`, коммит `39adf9c`.
- В `v0.4.0` вошли Wterm 0.5 runtime/Kitty Graphics, hyperlinks, copy/clipboard fixes, launchers Herdr/Wterm и закрытый цикл `wterm-speed-feel-ftz`.
- Production BB уже использует точный источник `git:github.com/Diffuzmetall/bb-wterm-terminal-plugin@v0.4.0` и resolved commit `39adf9c`.

### Интегрированный `main`

Следующие локальные изменения теперь входят в удалённые `main` и `master`:

| Коммит | Содержание |
| --- | --- |
| `4dc4418` + `3b3f16c` | Воспроизводимый performance baseline, метрики и scope correction. |
| `3ceba90` + `87ce2d3` | Persistent tabs, restore, rename/reorder и scope correction. |
| `a4c58b2` | SDK/build preflight, security, lifecycle, upload и navigation fixes. |
| `0c3905c` | ISA, Beads, планы и проверяемые evidence-документы. |
| `844d345` | Бесконфликтное объединение локальной линии с опубликованной `v0.4.0`. |

Push выполнен атомарно: `main → main` и `main → master`. На точке интеграции обе удалённые ветки указывали на `844d345`.

## 4. Состояние репозитория после интеграции

- `git status` чистый.
- Незавершённых merge или конфликтов нет.
- Все локальные ветки полностью входят в `main`; уникальных коммитов вне `main` не найдено.
- `origin/main` был влит обычным merge-коммитом без rebase и без переписывания истории.
- Большой lockfile diff принят вместе с обновлением BB SDK/toolchain и проверен через `npm ci`-совместимый preflight, typecheck, tests и build.
- Локальные генерируемые артефакты `pnpm-workspace.yaml` и `types/` исключены через `.gitignore`; они не участвуют в сборке и не засоряют историю.

## 5. Свежая проверка интегрированного `main`

Проверки выполнены 7 сентября 2026 года после merge с `origin/main`:

| Проверка | Результат |
| --- | --- |
| `npm run wterm:preflight` | PASS; Wterm 0.5.0 и WASM SHA-256 подтверждены. |
| `npm run typecheck` | PASS. |
| `npm test` | PASS: 16 файлов, 157 тестов. |
| `npm run build` | PASS; provenance-файл создан. |
| LSP diagnostics | PASS: 16 файлов, 0 ошибок. |
| Dependency graph Beads | PASS: циклов нет. |
| Production browser QA `v0.4.0` | PASS: страница Wterm, network, console и page errors. |

UBS повторил известные ложные срабатывания: дробление `params.terminalId` в dependency array, spread массива terminal sessions как prototype pollution и сравнение обычных terminal/status/hash значений как secrets. Реальные security-paths ранее отдельно приняты в `.15.*`; новых критических дефектов не обнаружено.

## 6. Что можно выкатить сейчас

### Production

`v0.4.0` уже установлена на целевом BB, включена и работает. Повторная установка не нужна: источник закреплён на immutable tag и коммите `39adf9c`. Короткий production smoke прошёл.

### Следующий релиз

Интегрированный `main` уже содержит tabs/security/build изменения и запушен, но отдельный новый tag не создан. Для следующего stable-релиза остаются:

1. `.5 → .6` — измерить и исправить подтверждённую задержку открытия;
2. `.7` — убрать квадратичное накопление replay;
3. `.18` — независимая приёмка persistent tabs;
4. `.14` — финальная сравнительная end-to-end приёмка;
5. version bump, tag и GitHub Release после зелёной матрицы.

## 7. Минимальный путь к новой версии, которую можно честно назвать более быстрой

Не нужно автоматически реализовывать все открытые P2-задачи. Минимальный доказуемый путь:

1. **`.5 → .6`:** измерить задержку до `openWterm` и исправить только подтверждённый bottleneck.
2. **`.7`:** убрать оставшееся квадратичное накопление replay — это наиболее конкретный алгоритмический риск.
3. **`.18`:** независимо принять уже реализованные persistent tabs.
4. **`.14`:** сравнить candidate с baseline и принять end-to-end матрицу.
5. Выпустить `v0.5.0` только если метрики подтверждают улучшение и нет регрессии на unaffected paths.

Условные задачи:

- `.8 → .9` — только если замеры докажут burst stall;
- `.10` — только если первый resize/анимации остаются заметным источником задержки;
- `.11` — только если DOM rebuild подтверждён профилем;
- `.12` — только если большие списки реально дают значимую стоимость lookup.

Такой подход сохраняет цель «быстрее», но не заставляет закрывать весь backlog ради релиза.

## 8. Рекомендуемое решение

1. Оставить production на уже проверенной `v0.4.0` до следующего tag.
2. Продолжать новую работу от синхронизированного `main` после точки интеграции `844d345`.
3. Для следующего stable закрыть `.5/.6`, `.7`, `.18` и `.14`; остальные perf-задачи выполнять только при подтверждённом bottleneck.
4. Не обновлять production на плавающий `main`: выпускать следующий кандидат через отдельный immutable tag.

## Приложение: проверенные идентификаторы

- Точка интеграции кода: `844d345`.
- Удалённые `main` и `master` после атомарного code-push: `844d345`.
- Последний stable tag/release: `v0.4.0`, `39adf9c`.
- Production plugin source: `git:github.com/Diffuzmetall/bb-wterm-terminal-plugin@v0.4.0`.
- Package version интегрированного `main`: `0.4.0`.
- Wterm runtime dependencies: `0.5.0`.
- Свежий тестовый результат: 157/157 PASS.
