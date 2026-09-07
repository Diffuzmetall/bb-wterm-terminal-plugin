# План: довести Kitty Graphics в Wterm до актуального upstream-состояния

## Цель

Обновить BB-плагин `wterm-terminal-preview`, чтобы Kitty Graphics работал как в актуальном Wterm: изображения корректно принимаются Ghostty core, правильно определяют размеры терминала, масштабируются, размещаются относительно текста и не ломают scrollback, resize или alternate screen.

План не заменяет Ghostty и не переписывает транспорт BB. Он обновляет upstream-пакеты и аккуратно сохраняет BB-специфичные адаптации.

## Исходное состояние

- Репозиторий: `bb-wterm-terminal-plugin`.
- Плагин: `wterm-terminal-preview`.
- Текущие пакеты: `@wterm/core`, `@wterm/dom`, `@wterm/ghostty`, `@wterm/react` версии `0.4.0`.
- Последний стабильный upstream Wterm: `v0.5.0`.
- Корневой `ghostty-vt.wasm` уже совпадает с upstream v0.5.0:

  ```text
  sha256 4a0a02357206349ed52b76ebda8feea4a65e453fe4e199832d8c009d7c41ba4f
  ```

- Текущий core уже умеет прямые Kitty PNG/RGB/RGBA graphics.
- `@wterm/dom` уже создаёт canvas overlay для изображений.
- Upload в BB только записывает файл и вставляет путь в shell. Автоматического Kitty-рендеринга upload сам по себе не делает.

## Что входит в работу

1. Обновление всех `@wterm/*` до `0.5.0`.
2. Проверка совместимости с локальными Ghostty- и OSC 52-обёртками.
3. Получение upstream-улучшений Kitty Graphics из v0.4.1:
   - pixel geometry queries `CSI 14t` и `CSI 16t`;
   - ограничение размеров изображений;
   - сохранение пропорций;
   - корректный implicit image flow.
4. Исправление возможной утечки `GhosttyCore` при размонтировании терминала.
5. Явная настройка scrollback, цветов и image storage.
6. Unit-тесты и headed browser smoke-test через реальный PTY.

## Что не входит

- Замена Ghostty на xterm.js.
- Пересборка или форк Ghostty WASM без необходимости.
- Sixel, iTerm2/OSC 1337, animation, URL/file/shared-memory media.
- Переписывание BB WebSocket replay-протокола.
- Удаление `pnpm-lock.yaml`.
- Изменение upload security model.
- Поднятие WebSocket attachment выше lifecycle панели без отдельного доказательства утечки/задержки.

---

## Фаза 0. Зафиксировать чистую точку

### Задачи

1. Не трогать текущие пользовательские изменения в `README.md`, `ANALYSIS.md`, `PLAN.md` и `docs/`.
2. Сохранить baseline:

   ```sh
   git status --short
   npm test
   npm run build
   sha256sum ghostty-vt.wasm dist/ghostty-vt.wasm
   npm ls @wterm/core @wterm/dom @wterm/ghostty @wterm/react --depth=0
   ```

3. Зафиксировать результаты в рабочем отчёте или в комментарии к задаче.

### Критерии готовности

- До обновления тесты проходят.
- WASM root и `dist/` имеют одинаковый SHA-256.
- Зафиксированы незакоммиченные изменения до начала работы.

---

## Фаза 1. Обновить upstream-пакеты

### Изменяемые файлы

- `package.json`
- `package-lock.json`
- при необходимости `package-lock.json` генерируется npm автоматически.

### Команда

```sh
npm install --save-exact \
  @wterm/dom@0.5.0 \
  @wterm/ghostty@0.5.0 \
  @wterm/react@0.5.0
```

`@wterm/core@0.5.0` должен прийти транзитивно через `dom` и `ghostty`.

### Проверка

```sh
npm ci
npm ls @wterm/core @wterm/dom @wterm/ghostty @wterm/react --depth=0
npm test
npm run build
sha256sum ghostty-vt.wasm dist/ghostty-vt.wasm
```

### Критерии готовности

- Все четыре пакета разрешаются в версии `0.5.0`.
- `npm test` проходит.
- `npm run build` проходит.
- WASM SHA-256 остаётся прежним.
- Никакие BB-specific функции не удалены.

---

## Фаза 2. Проверить совместимость локальной обёртки

Файл: `wterm-renderer.tsx`.

### Проверить

1. `supportAnyEventMouseMode()` продолжает работать поверх `GhosttyCore@0.5.0`.
2. Фильтр OSC 52 не ломает Kitty APC/graphics sequences.
3. `writeRaw` и `writeString` продолжают передавать обычные graphics-последовательности в Ghostty.
4. Игнорирование скрытого размера `1×1` не мешает нормальному Kitty geometry.
5. Existing resize debounce `250ms` сохраняется.
6. `onData` продолжает доставлять ответы core к PTY.

### Новые/обновляемые тесты

- `ghostty-init.test.ts`:
  - прямой Kitty RGB image sequence не вызывает исключение;
  - OSC 52 продолжает обрабатываться;
  - DEC 1003 продолжает отслеживаться;
  - скрытый размер не меняет рабочую геометрию.
- `wterm-renderer.test.ts`:
  - локальная mouse-mode обёртка не ломает core API;
  - текущие selection, resize и scroll invariants остаются зелёными.

### Критерии готовности

- Поведение локальных wrapper-ов подтверждено тестами, а не только успешной TypeScript-сборкой.
- Нет дублирования или удаления PTY input.

---

## Фаза 3. Подключить актуальные Kitty image options

Файлы:

- `wterm-renderer.tsx`
- при необходимости `wterm-renderer.css`
- `terminal-panel.tsx`

### Решение по настройкам

Передавать в `GhosttyCore.load()` явные параметры:

```ts
{
  wasmPath,
  scrollbackLimit: 1024 * 1024,
  imageStorageLimit: 32 * 1024 * 1024,
  foregroundColor: "#d4d4d4",
  backgroundColor: "#1e1e1e",
}
```

Значения цветов должны соответствовать фактической CSS-теме терминала. Если BB меняет тему динамически, не притворяться, что значения всегда одинаковые: либо ограничить тему фиксированной палитрой, либо отдельно спроектировать передачу цветов.

### Image display bounds

После обновления `@wterm/react@0.5.0` проверить доступность:

```tsx
<Terminal
  maxImageWidth={...}
  maxImageHeight={...}
/>
```

Не задавать произвольные ограничения до browser-проверки. Рекомендуемый первый вариант — ограничивать изображение размерами терминальной поверхности, оставляя aspect ratio upstream-рендереру.

### Критерии готовности

- Kitty images не выходят за границы панели.
- Aspect ratio сохраняется.
- Большая картинка не создаёт canvas за пределами терминальной поверхности.
- Лимит storage не позволяет одному PTY бесконечно расходовать WASM-память.

---

## Фаза 4. Проверить implicit image flow и geometry

### Сценарии

Проверить через реальный PTY и Kitty-compatible клиент:

1. `CSI 14t` возвращает pixel size терминала.
2. `CSI 16t` возвращает размер ячейки.
3. Прямое изображение с заданными columns/rows занимает ожидаемую область.
4. Auto-sized image резервирует визуальное место.
5. Следующий shell prompt находится под изображением, а не накладывается на него.
6. Resize панели пересчитывает позицию и размер картинки.
7. Scrollback сохраняет положение картинки.
8. Alternate screen (`vim`, `less`, TUI) не оставляет canvas после выхода.
9. Удаление/замена изображения очищает старый overlay.

### Критерии готовности

- Нет наложения prompt на implicit image.
- Нет stale canvas после удаления или смены экрана.
- Нет скачка scroll position при resize и rollover scrollback.
- Изображения в пределах canvas budget upstream.

---

## Фаза 5. Исправить lifecycle GhosttyCore

Файл: `wterm-renderer.tsx`.

### Проблема

`WTerm.destroy()` не обязан освобождать переданный caller-owned core. Наш renderer создаёт `GhosttyCore`, но при размонтировании панели сейчас не вызывает `core.dispose()` явно.

### Реализация

Добавить cleanup, который:

- вызывает `dispose()` ровно один раз для core, созданного этим renderer;
- не dispose-ит чужой core, если в будущем появится внешний core prop;
- не вызывает dispose после того, как компонент уже заменил core новым экземпляром;
- не ломает retry после ошибки загрузки.

### Тесты

Добавить тест или seam-level проверку на:

- unmount после успешной загрузки вызывает dispose;
- retry не вызывает dispose одного core дважды;
- stale promise после unmount не меняет React state.

### Критерии готовности

- Многократное открытие/закрытие терминала не накапливает живые Ghostty terminal allocations.
- Повторное `dispose()` безопасно.

---

## Фаза 6. Сохранить и проверить BB-функции

Полный regression suite:

```sh
npm test
npm run build
npm install --omit=dev
bb plugin build .
git diff --check
```

Проверить отдельно:

- create terminal;
- attach existing terminal из picker;
- restart terminal;
- thread scope;
- wrong-thread upload;
- SHA/size verification upload;
- replay before live output;
- queued input and latest resize;
- detach without PTY close;
- shared plugin token;
- cached WASM/font;
- new tab always creates a new PTY;
- no zombie `running` sessions;
- no first-paint white flash.

---

## Фаза 7. Headed browser verification

Проводить только после успешных unit/build проверок.

### Сценарий A — Kitty image

1. Открыть BB thread.
2. Открыть Wterm.
3. Запустить Kitty-compatible image output.
4. Проверить размер, позицию, prompt после изображения.
5. Изменить размер панели.
6. Прокрутить scrollback.
7. Перейти в alternate screen и выйти из неё.

### Сценарий B — несколько терминалов

1. Открыть 3–5 Wterm tabs.
2. Убедиться, что каждый tab имеет отдельный PTY.
3. Проверить, что assets не загружаются повторно без необходимости.
4. Закрыть и открыть tabs повторно.
5. Проверить отсутствие zombie reconnect loop.

### Сценарий C — визуальная стабильность

Проверить:

- dark first paint;
- отсутствие белой вспышки;
- отсутствие скачка scroll-to-bottom;
- отсутствие цветных полос после TUI;
- отсутствие stale image canvas;
- отсутствие ошибок в console;
- отсутствие 4xx/5xx при загрузке WASM/font/image.

---

## Матрица критериев

| ID | Критерий | Проверка |
|---|---|---|
| KG-1 | Все `@wterm/*` версии 0.5.0 | `npm ls` |
| KG-2 | WASM unchanged and byte-identical | `sha256sum`, `cmp` |
| KG-3 | Kitty PNG/RGB/RGBA reaches Ghostty | unit + headed |
| KG-4 | `CSI 14t`/`CSI 16t` work | headed PTY |
| KG-5 | Image bounds preserve aspect ratio | headed |
| KG-6 | Implicit image flow reserves space | headed |
| KG-7 | Scrollback/resize do not misplace image | headed |
| KG-8 | Alternate screen clears image state correctly | headed |
| KG-9 | Core disposed on renderer unmount | unit/seam test |
| KG-10 | Existing BB transport/security tests remain green | `npm test` |
| KG-11 | Production-only build works | omit-dev + `bb plugin build` |
| KG-12 | No console/page/network errors in smoke | browser QA |

## Риски и решения

| Риск | Решение |
|---|---|
| v0.5 changes React callback-ref lifecycle | Проверить mount/unmount и attachment ordering |
| Wrapper intercepts Kitty sequences | Использовать `writeRaw`/`writeString` passthrough; добавить direct tests |
| Цвета core не совпадают с CSS | Передавать явные foreground/background или зафиксировать тему |
| Большой scrollback расходует память | Явный byte budget и проверка нескольких tabs |
| Kitty client не использует direct protocol | Это ограничение клиента, не ошибка renderer |
| Upload ожидается как автоматический preview | Документировать: upload вставляет путь, Kitty client должен отправить graphics escape sequence |
| BB SDK drift | Отдельно проверить pin `0.4.21` против локального `0.4.34` |

## Порядок выполнения

```text
Фаза 0 baseline
  ↓
Фаза 1 обновление пакетов
  ↓
Фаза 2 wrapper compatibility
  ↓
Фаза 3 image options
  ↓
Фаза 4 geometry + implicit flow
  ↓
Фаза 5 core lifecycle
  ↓
Фаза 6 regression/build
  ↓
Фаза 7 headed browser verification
```

## Definition of Done

Работа завершена, когда:

- проект использует `@wterm/* 0.5.0`;
- Ghostty WASM остаётся byte-identical;
- Kitty direct PNG/RGB/RGBA проверен в реальном BB PTY;
- geometry, sizing и implicit flow работают;
- изображения корректно ведут себя при resize, scrollback и alternate screen;
- GhosttyCore освобождается при unmount;
- все текущие тесты, build и security invariants зелёные;
- headed browser smoke-test не показывает визуальных артефактов или console/network ошибок.

## Источники

- [Wterm Ghostty documentation](https://wterm.dev/ghostty)
- [Wterm API Reference](https://wterm.dev/api-reference)
- [Wterm v0.4.1 release](https://github.com/vercel-labs/wterm/releases/tag/v0.4.1)
- [Wterm v0.5.0 release](https://github.com/vercel-labs/wterm/releases/tag/v0.5.0)
- [Upstream Ghostty package v0.5.0](https://github.com/vercel-labs/wterm/tree/v0.5.0/packages/%40wterm/ghostty)
