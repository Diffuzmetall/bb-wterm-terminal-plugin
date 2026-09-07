# Wterm Beads — передача внедрения, 2026-09-06

## Полномочия и модели

Пользователь просит внедрять обновлённые Beads через `$pi-beads-orchestrator` в отдельной панели Herdr.

- Репозиторий: `/home/ubuntu/Projects/bb-wterm-terminal-plugin`, ветка `main`.
- Оркестратор: **`openai-codex/gpt-6-astra`, thinking `medium`**. Herdr-agent `wterm-orchestrator`, панель `wX:p7` (перед управлением перечитать opaque ID).
- **Все дети**, включая worker, QA и reviewer: **`openai-codex/gpt-5.6-luna`, thinking `high`**. Это явное указание оператора, выше model defaults навыка. Нет автоматического перехода на другую модель. Для реализации использовать доступного `luna-high-worker`, для ревью — `reviewer` с проверенным high. Перед запуском проверить конфигурацию роли и фактическую модель.
- Пользователь явно выбрал **«По Beads (рекомендую)»** на вопрос о работе без ISA. `algorithm_v8_status` сообщает невалидную ISA. Разрешена ISA-less очередь, только критерии Beads; ISA не исправлять и не объявлять выполненной.
- Загрузить `/home/ubuntu/.agents/skills/pi-beads-orchestrator/SKILL.md` и следовать ему. Название `Agent` в upstream-описании адаптировать к нативному `subagent`/`workflowScript`; Herdr только держит оркестратора, детей не размножать в panes.
- Очередь — только `br`/`bv --robot-*`, не новая параллельная очередь. Один claim — один ограниченный дочерний запуск, controller владеет приёмкой. Не закрывать Bead по одному тексту «done».

## Текущее состояние

Эпик `wterm-a4b`. Изначальные `.1` (установка Wterm 0.5.0) и `.2` (dev watcher) закрыты с доказательствами; не переоткрывать без выявленной регрессии. Остальные карточки получили `agent_context` и текстовые маршруты: skills, paths, model/effort, тип проверки, тесты скорости и безопасности.

**`.13` не закрыта**: обновление CLI/SDK и typecheck реализованы, но приёмка неполная. Изменения лежат в текущем dirty checkout, не в отдельной ветке. Старые implementation/evidence workers завершились; независимый reviewer `94ddbc37` тоже завершился. Старый controller больше не меняет продуктовые файлы. Получить текущий `br show`, ownership и file reservations перед продолжением; передачу `.13` prior owner фиксирует отдельным комментарием и owner/assignee.

Текущие проверенные pins: `bb-app 0.42.1`, `@get-bb/plugin-sdk 0.4.47`, TypeScript `5.9.3`, Wterm `0.5.0`. Это наблюдения текущего checkout, не вечные значения latest.

`npm run typecheck` реально отработал с exit 0 после изменений сборки. Implementation worker сообщил 122 passing tests и build PASS, однако сохранённые старые логи на 120 тестов **не доказывают** нынешние 122. При отсутствии коррелированного свежего лога повторить нужную проверку и сохранить выход. Негативный контроль typecheck ещё нуждается в воспроизводимом артефакте: заведомая ошибка в отдельной сохранённой fixture должна давать nonzero; не исключать реальные исходники из tsconfig и не добавлять broad any/ts-nocheck.

## Что делать первым

1. Принять передачу грязной `.13`, не сбрасывать/прятать её изменения. Сверить `git diff`, package/lock, типы и все untracked файлы. Ничего не удалять.
2. Выполнить ready **`wterm-a4b.15`**: независимый security-review текущего diff. Старый UBS заявил 14 critical/271 warnings, raw report отсутствует. Нужна воспроизводимая классификация, а не blanket false-positive. `.13` и финальная `.14` зависят от `.15`.
3. Выполнить **`wterm-a4b.13.1`**: разобраться с потерей `experimental_claimedTerminalId` на новом открытии. Не закрывать `.13` с открытой дочерней регрессией. `.3` дополнительно заблокирована этим finding.
4. Завершить остальные критерии `.13`: версии и совместимость, настоящий typecheck/negative control, нынешние tests/build, failure path toast, сохранение PTY/tab semantics. Только затем закрывать `.13`.
5. `.3` provenance → `.4` baseline → исследования и узкие оптимизации согласно DAG. Не мерить производительность на меняющемся SDK и не подменять readiness отрисованным loader.
6. `.14` — независимая итоговая read-only приёмка. Непроверенные сценарии — gaps, не PASS.

## Независимый code review

Reviewer `94ddbc37`, Luna high, нашёл **high** в `app.tsx:589-592`: удалён `experimental_claimedTerminalId` у нового terminal open, хотя existing-open путь ещё передаёт поле. README и commit `c1777d9` связывают поле с подавлением соседнего native terminal tab. В SDK 0.4.47 оно исчезло; документированная замена не найдена. Это основание для `.13.1`; фактическое поведение текущего host нужно проверить, а не просто вернуть поле через cast.

Другие выводы reviewer:

- `sonner` поддерживается runtime shim, toast import сам по себе совместим.
- Guard `hostId` и проверка cwd сохраняют безопасность upload.
- Root TypeScript coverage строгая, broad any/ts-nocheck не найдено.
- Lockfile 509 → 274 entries согласован с удалением BB-зависимостей `pi-*`; сам размер diff не является дефектом. `node-pty 1.2.0-beta.15` — требование upstream BB, не произвольный prerelease.
- Повторный `if (!end)` в renderer избыточен, но не функциональный дефект; не начинать отдельную косметическую кампанию.

## Свежая родительская browser-проверка

После evidence-worker родитель проверил **сам Wterm**, не только shell BB:

- Новый собственный browser session `wterm-parent-acceptance` открыл `http://127.0.0.1:38896/plugins/wterm-terminal-preview/wterm`.
- В Terminal textbox введено `printf 'WTERM_TOOLCHAIN_PARENT_OK\n'`, нажата Enter.
- DOM содержит отдельную точную строку `WTERM_TOOLCHAIN_PARENT_OK`; 27 terminal rows.
- `agent_browser errors`: `No page errors`.
- Served `/api/v1/plugins/wterm-terminal-preview/assets/app.js`: HTTP 200, SHA-256 совпадает с текущим `dist/app.js`:
  `31cf75910d36780bb0f1ac72da14d840d0f6c7155a4e323e8c2d2ddfd3015f43`.
- Проверенный скриншот: `.logs/wterm-parent-toolchain-smoke.png` (44 357 bytes).

Это закрывает пробел echo/hash из `docs/BB-TOOLCHAIN-TYPECHECK-EVIDENCE.md`, но **не** доказывает new-thread panel/native-tab ownership, error-path toast, скорость или полную security-приёмку. При изменении bundle после этого smoke нужен новый релевантный прогон.

## Verification skills и критерии

В каждой карточке уже есть конкретный список. Общие маршруты:

- Скорость: `extreme-software-optimization`; гипотеза → trace/profile → минимальная правка → before/after. `agent-browser` для живой проверки. Для сложной причины — `diagnose`.
- Unit/regression: `tdd`; для chunk/replay/queue инвариантов по необходимости `hardening` (property/mutation), без большой новой test-платформы.
- SDK/dependencies: `library-updater`, `bb-cli`; новые API проверять по актуальным docs/Context7.
- Безопасность: `ubs` и `security-hardening` только как применимые app-checklists, **не** разрешение менять VPS/firewall/services. Авторизация upload до side effects, чужой thread/PTY, traversal/symlink/cwd, лимиты/integrity/abort, OSC8/52 и отсутствие утечек.
- Финальная приёмка: `verification-evidence`, read-only reviewer, fresh source/artifact correlation.

Минимум evidence: source/lock/bundle hashes, версии, command + exit code, собственный test-session/run ID, sane log paths. Cold/warm отдельно, >=20 opens и >=100 input samples, p50/p95 + sample count и оговорка малой выборки; raw sanitized timing JSON. Rows != paint. Одно наблюдение != p95. Стабильность correctness/byte ordering/ownership важнее ускорения. Цели и regression budget фиксируются до патча, noisy run = inconclusive.

Исследовательские карточки не должны сразу писать product patch. Реальные новые дефекты оформляются отдельными self-contained Beads с маршрутами; reviewer никогда не исправляет свой finding. Для новых файлов забронировать точные пути до записи.

## Безопасность текущей среды

- Существующий BB: `127.0.0.1:38896`, daemon `38897`; использовать явные `BB_SERVER_URL` и `BB_HOST_DAEMON_PORT`.
- Plugin source — этот checkout, не старый `.bb-server/worktrees/...`.
- Watcher: `.logs/wterm-dev-runtime.json`; исторические PIDs parent83278/child83687, проверить `ps` перед любым воздействием. Не `pkill bb`, не shared-host restart. Логи живого watcher вне repo: `/tmp/bb-wterm-dev-20260906T105700Z.log`; писать их внутрь `.logs/dev-server.log` нельзя — self-trigger reload loop.
- Не трогать чужие PTY, браузеры и процессы. Новый свой sidebar terminal должен закрываться уходом со страницы; чистить только собственный lifecycle, никаких файловых удалений.
- Без удаления файлов/каталогов, git reset/clean, коммитов/push, глобальных обновлений или скрытой смены модели. Без реальных пользовательских данных/токенов в логах.
- `ctx_batch_execute` ранее завис на первом вызове на 13 минут, даже с timeout120s. Использовать bounded native read/grep/bash; не рекурсивно grep огромные `.logs`, не печатать целые minified bundles, не чинить глобальную инфраструктуру как side quest.
- Не делать test runtime безлимитным. Сохранять частичный результат и blockers при реальном сбое инструмента, не скрывать его passing build.

## Передача

Новая панель создана и модель Astra medium подтверждена по её footer. До финального промпта агент выполняет только bootstrap и ждёт. После фиксации owner/assignee и release предыдущих reservations новый controller должен зарезервировать собственные exact write paths и продолжить существующую `.13`/её blockers, а не заводить второй параллельный цикл upgrade.
