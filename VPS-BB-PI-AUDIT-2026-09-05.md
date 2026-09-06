# Аудит VPS, BB и Pi

Дата: 2026-09-05  
Проект: `bb-wterm-terminal-plugin`  
Задача: `BWT-13`

## Итог

- `wterm-terminal-preview@0.3.18` установлен из текущего worktree и работает в production.
- Активный BB endpoint VPS: `https://vps-7f443bf2.tail8b4514.ts.net:38886`.
- Root и `/health` отвечают HTTP 200.
- В браузере на VPS открыт Wterm и проверен реальный PTY.
- Kitty Graphics обновлён до `@wterm/* 0.5.0`.
- `npm test`: 115 тестов прошли.
- Build и production `bb plugin build` прошли.
- BWT-13 переведён в `in_review`.

## Live revalidation гиперссылок на VPS (2026-09-06)

Первичный отчёт `WTERM-LINKS-QA-2026-09-06.md` пометил проверку как BLOCKED,
потому что automation получил белый скриншот и не увидел OSC8-метки. Повторная
проверка с fresh selectors и корректной передачей ESC-последовательности через
PTY этот результат не воспроизвела.

Подтверждено:

- `wterm-terminal-preview@0.3.18` переустановлен и перезагружен из
  `/home/ubuntu/Projects/bb-wterm-terminal-plugin`; статус `running`,
  `handlerStats.errorCount=0`.
- Wterm surface отображается; реальный PTY создал ровно один DOM-элемент
  `.term-link` с меткой `WTERM_WEB_QA`.
- Клик по `https://example.com` открыл отдельную вкладку Chromium с URL
  `https://example.com/`.
- Клик по `file://.../README.md` открыл вкладку BB Files `README.md` с
  `Preview`, `Raw`, `Copy file path` и содержимым Markdown.
- Browser page errors и console output пусты. Запросы terminal creation, token,
  Ghostty WASM, font и file content завершились HTTP 200.
- Скриншоты приложены к задаче BWT-13: `wterm-osc8-web-rendered.png` и
  `wterm-file-route-production.png`.

Диагностический вывод: BLOCKED был вызван stale accessibility refs (фокус ушёл
в composer вместо terminal) и потерей backslash/ESC в первой automation-команде,
а не дефектом Wterm surface или маршрутизации ссылок.

### Ручная проверка Kitty Graphics

Проверять в свежем thread, открытом через VPS URL:

1. Открыть `More plugin actions` → `Show session terminal`.
2. Ввести в Wterm:

   ```bash
   printf '\033]8;;https://example.com\033\\WEB_TEST\033]8;;\033\\\n'
   ```

   Метка `WEB_TEST` должна стать кликабельной и открыть сайт в BB browser.
3. Для file route выполнить:

   ```bash
   printf '\033]8;;file:///absolute/path/to/README.md\033\\FILE_TEST\033]8;;\033\\\n'
   ```

   Метка `FILE_TEST` должна открыть этот файл в BB Files/file viewer.
4. Для Kitty-картинки использовать Kitty-compatible client, который отправляет
   direct PNG/RGB/RGBA graphics escape sequence. Проверить, что картинка видна,
   сохраняет пропорции, не перекрывает prompt, остаётся на месте после resize и
   scrollback, а после выхода из `vim`/`less` не оставляет stale canvas.

Важно: upload-функция Wterm только загружает файл и вставляет путь в shell; она
не является автоматическим Kitty image preview. Для проверки картинки нужен
клиент, который действительно отправляет Kitty Graphics escape sequence.

## Почему возвращается MacBook URL

### Подтверждённые факты

- Активный VPS app слушает `127.0.0.1:38896`.
- Публичный VPS listener слушает `100.95.132.126:38886`.
- `~/.bb/config.json` указывает на локальный VPS app.
- `/home/ubuntu/.bb-server/config.json` содержит активный `BB_APP_URL` VPS.
- Активный `bb-app.service` не содержит MacBook URL.
- `bb connect servers` показывает только сервер `diffuz`.
- `bb machine list` показывает только `vps-7f443bf2`, статус `connected`, permission `full`.
- MacBook URL найден только в трёх старых backup-файлах legacy daemon.

### Корень проблемы

Текущий provider/thread получает переменную окружения:

```text
BB_SERVER_URL=https://macbook-pro.tail8b4514.ts.net
```

Она приходит из launch environment старого thread. BB передаёт `BB_SERVER_URL` в окружение provider-процесса. Переменная окружения имеет приоритет над конфигурационным файлом.

Поэтому:

```bash
unset BB_SERVER_URL
```

действует только внутри одного shell. Следующий tool/shell снова получает исходное значение из snapshot запуска.

Это не означает, что VPS снова переключился на MacBook. Это устаревшее окружение конкретного thread/provider процесса.

### Как убрать проблему окончательно

1. Открывать BB только через:

   ```text
   https://vps-7f443bf2.tail8b4514.ts.net:38886
   ```

2. Не продолжать старые threads, созданные при MacBook routing. Создавать новый thread из VPS UI.

3. На клиенте, который создаёт BB threads, убрать старый export и выставить VPS:

   ```bash
   unset BB_SERVER_URL
   export BB_SERVER_URL=https://vps-7f443bf2.tail8b4514.ts.net:38886
   ```

4. На MacBook проверить источник переменной:

   ```bash
   launchctl getenv BB_SERVER_URL
   rg -n 'BB_SERVER_URL|macbook-pro\.tail8b4514' \
     ~/.zshrc ~/.zprofile ~/.profile ~/.config ~/Library/LaunchAgents 2>/dev/null
   ```

5. В BB проверить:

   - `Settings -> Machines`: оставить только VPS.
   - `Settings -> Remote access/Connect`: оставить единственный server `diffuz`.

MacBook filesystem и `launchd` из текущего VPS sandbox недоступны, поэтому именно MacBook-side источник требует проверки на самом MacBook.

## Состояние BB

- Plugins: 42 обнаружено.
- Running: 39.
- Disabled: 3:
  - `bb-rpiv-todo-renderer`
  - `monaco-editor`
  - `plugin-api-docs`
- `wterm-terminal-preview`: running из текущего worktree.
- Default provider: `pi`.
- Единственная подключённая машина: `vps-7f443bf2`.
- Permission mode машины: `full`.

## Состояние Pi

- Pi: `0.85.0`.
- Default provider: `openai-codex`.
- Default model: `gpt-5.6-sol`.
- Default thinking: `high`.
- В `settings.json`: 36 packages и 3 configured extensions.
- В `mcp.json`: 5 MCP servers:

  ```text
  codegraph
  context-mode
  mcp-agent-mail
  paper
  railway
  ```

### Важное ограничение bridge

Активный BB Pi bridge запускается с:

```text
--no-extensions
```

и затем загружает 10 явных extensions:

```text
pi-cursor
pi-mcp-adapter
pi-smart-fetch
pi-smart-web-search
pi-agent-browser-native
pi-subagents
agent-mail-identity-bridge
pi-algorithm-v8-v8202
dcg
ubs-stop
```

Следовательно, 36 packages из `settings.json` не означают, что все они активны в BB Pi bridge. Для максимальной стабильности нужен явный allowlist, а не безусловное включение всего списка.

## Prompt-конфигурация

Присутствуют:

- `~/.pi/agent/AGENTS.md`
- `~/.pi/agent/LIFEOS/LIFEOS_SYSTEM_PROMPT.md`
- `~/.pi/agent/LIFEOS/ROUTING.md`

Отсутствуют:

- `~/.bb/AGENTS.md`
- `~/.bb-server/AGENTS.md`
- workspace `.bb/AGENTS.md`

Для BB-wide инструкций нужен:

```text
/home/ubuntu/.bb/AGENTS.md
```

Для инструкций конкретного репозитория:

```text
<repo>/.bb/AGENTS.md
```

Pi-specific правила должны оставаться в `~/.pi/agent/AGENTS.md`; не следует дублировать туда всю LifeOS constitution.

## Что доступно текущему Codex-сеансу

- Shell и чтение/запись текущего worktree.
- BB CLI через явный VPS endpoint.
- BB plugins, tasks, providers, machines и settings через active BB API.
- MCP-инструменты текущего Codex-сеанса: CodeGraph, Context7, GBrain, Agent Mail, Railway и связанные системные приложения.
- `agent-browser` для Chromium smoke tests.
- `br` установлен, версия `0.5.7`.

## Ограничения доступа

- Нет доступа к filesystem и `launchd` окружению MacBook.
- Pi — отдельный provider process; в текущем Codex-сеансе проверена его static config и BB bridge, но не полный live registry его tools после нового запуска.
- Нет доступа к credentials, API keys, bearer tokens и secret-bearing `.env` файлам.
- `br` не может открыть workspace write lock в managed worktree:

  ```text
  .beads/.write.lock: Read-only file system
  ```

- BB Tasks работает отдельно и был доступен для комментариев и обновления статуса.
- Наличие MCP в `mcp.json` ещё не доказывает, что authenticated remote call успешно проходит из свежего Pi thread; это нужно проверять отдельно.

## Рекомендованный порядок доведения Pi до максимума

1. Зафиксировать единственный VPS в BB Machines и Connect.
2. Создать новый Pi thread из VPS URL.
3. Добавить глобальный BB prompt в `~/.bb/AGENTS.md`.
4. Добавить repo prompt в `<repo>/.bb/AGENTS.md` и хранить его в git.
5. Проверить каждый MCP из свежего Pi thread.
6. Оставить extensions в явном allowlist и проверять фактический `modelId` после изменения routing.
7. Дать Pi рабочий checkout с доступным `.beads`, если требуется полноценный `br` workflow.
8. Не включать все 36 packages автоматически без проверки конфликтов и permissions.

## Файлы и evidence

- [wterm-renderer.tsx](./wterm-renderer.tsx)
- [terminal-panel.tsx](./terminal-panel.tsx)
- [terminal-links.ts](./terminal-links.ts)
- [ghostty-init.test.ts](./ghostty-init.test.ts)
- [PLAN-KITTY-GRAPHICS-UPGRADE.md](./PLAN-KITTY-GRAPHICS-UPGRADE.md)
- Production commit: `c864fdc feat: upgrade wterm Kitty Graphics`
- Hyperlink commit: `478c643 feat: open terminal hyperlinks in BB`
