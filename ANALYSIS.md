# bb-wterm-terminal-plugin — Глубокий технический анализ

> Версия плагина: **0.3.16** · BB SDK: **0.4.21** · @wterm/*: **0.3.4** (установлено) / **0.4.0** (задекларировано) · Дата анализа: сентябрь 2025

---

## Содержание

1. [Архитектура и поток данных](#1-архитектура-и-поток-данных)
2. [Критические баги](#2-критические-баги)
3. [Деградация производительности](#3-деградация-производительности)
4. [Флики и визуальные артефакты](#4-флики-и-визуальные-артефакты)
5. [Матрица оптимизаций](#5-матрица-оптимизаций)
6. [Конкретные патчи по файлам](#6-конкретные-патчи-по-файлам)
7. [Зависимости: что обновить и что не трогать](#7-зависимости-что-обновить-и-что-не-трогать)
8. [Очерёдность реализации](#8-очерёдность-реализации)

---

## 1. Архитектура и поток данных

```
BB App (браузер)
  └─ app.tsx  ──── definePluginApp
       ├─ composer button  ──── session-terminal-action.tsx
       │                          └─ session-terminal-composer.ts
       │                               └─ revealSessionTerminalPanel (openThreadPanel)
       └─ threadPanelAction  ──── component → TerminalAction
            ├─ HostTerminalAction (экспериментальный API experimental_useReplaceCurrentPluginTab)
            └─ LegacyTerminalAction (localStorage-fallback)
                 └─ Panel → SelectedTerminal → TerminalPanel (lazy)
                       └─ LegacyAttachedTerminal
                            └─ useLegacyTerminalAttachment  ←→ WebSocket /ws/terminals/:id
                                 └─ TerminalWithUpload
                                      └─ TerminalRenderer → WtermRenderer
                                           ├─ loadGhosttyCore  (WASM через plugin HTTP route)
                                           ├─ loadNerdFont     (WOFF2 через plugin HTTP route)
                                           └─ <Terminal core={...} autoResize />  (@wterm/react)

BB Server (Node)
  └─ server.ts  ──── definePluginApi
       ├─ RPC: listSessions / createTerminal / restartTerminal
       ├─ HTTP GET  /ghostty-vt.wasm   (auth: token, cache: immutable)
       ├─ HTTP GET  /symbols-nerd-font-mono-v3.5.0.woff2 (auth: token)
       └─ HTTP POST /upload            (auth: token, thread-scoped)
```

**Важные ограничения текущего BB 0.41.0:**
- `experimental_primarySurface` — НЕ поддерживается пакетным BB 0.40.0; поэтому кнопка в composer открывает side panel, а не full-screen режим.
- `experimental_claimedTerminalId` — поддерживается, подавляет параллельный нативный tab.
- `experimental_useReplaceCurrentPluginTab` — поддерживается, применяется в `HostTerminalAction`.

---

## 2. Критические баги

### BUG-01 · Несоответствие версий @wterm в node_modules

**Приоритет: КРИТИЧЕСКИЙ**

`package.json` декларирует `"@wterm/dom": "^0.4.0"`, но реально установлена версия `0.3.4`:

```
core@0.3.4  dom@0.3.4  ghostty@0.3.4  react@0.3.4   ← реально в node_modules
^0.4.0 declared in package.json                       ← что требует package.json
```

`package-lock.json` при этом содержит `0.4.0` — значит lock-файл сгенерирован с правильными версиями, но сама установка устарела. Это означает, что `dist/` собран из одной версии, а тесты и локальная разработка работают с другой.

**Конкретный риск:** В `wterm-renderer.tsx` используется `terminal._measureCharSize?.()` — приватный метод `WTerm`. В 0.3.4 он есть, в 0.4.0 интерфейс мог измениться. Также `ghostty-vt.wasm` в репозитории (577 013 байт, sha256 `4a0a02...`) совпадает с `@wterm/ghostty@0.4.0`, но `dist/ghostty-vt.wasm` (434 450 байт, sha256 `d96f1f...`) совпадает с тем, что лежит в `node_modules/@wterm/ghostty/wasm/` — то есть сборка сделана из **разных** WASM-файлов от разных версий.

**Исправление:**
```bash
npm install  # или npm ci -- пересоздаст node_modules из lock-файла
```

---

### BUG-02 · Протекание background TUI-строк в normal-shell режиме

**Приоритет: ВЫСОКИЙ**

В `wterm-renderer.css` есть fix:
```css
.wterm-renderer .term-row {
  background: transparent !important;
  box-shadow: none !important;
}
```

Это подавляет оптимизацию @wterm/dom, которая промоутирует background последней ячейки строки на весь `div.term-row`. Проблема решена правильно, но только для viewport-строк. В `renderer.js` та же логика applied и к scrollback-строкам (`term-scrollback-row`), которые не покрываются этим selector'ом, потому что он не включает `.term-scrollback-row`.

После выхода из TUI (Herdr, vim) в scrollback может оставаться цветная строка-полоса от последнего экрана TUI.

**Исправление в `wterm-renderer.css`:**
```css
/* было */
.wterm-renderer .term-row {
  background: transparent !important;
  box-shadow: none !important;
}

/* надо */
.wterm-renderer .term-row,
.wterm-renderer .term-scrollback-row {
  background: transparent !important;
  box-shadow: none !important;
}
```

---

### BUG-03 · Race: terminal verification retries при быстром создании

**Приоритет: СРЕДНИЙ**

В `app.tsx` → `SelectedTerminal`, при открытии вкладки сразу запускается `verify()` через `listSessions`. Retry-логика в `evaluateTerminalPresence` даёт 3 попытки с задержкой 400 мс. Но `createTerminal` на сервере работает асинхронно — создаёт терминал, затем записывает ID в KV-store через `rememberLinkedTerminal`, которая сама является serialized-queue (`withLinkedTerminalIds`).

Если `listSessions` вызывается пока ещё идёт `saveLinkedTerminalIds`, новый терминал не будет в списке linked, и `evaluateTerminalPresence` вернёт `missing` после 3 попыток — пользователь видит "Terminal session is no longer available" сразу после создания.

**Диагноз:** Последовательность такова:
1. `createTerminal` RPC → создаёт PTY → вызывает `rememberLinkedTerminal` (async, ждёт queue)
2. RPC возвращает `session` объект с id
3. Фронтенд получает id, открывает `SelectedTerminal`, тут же вызывает `verify()`
4. `verify()` делает `listSessions`, который тоже ждёт `withLinkedTerminalIds` queue
5. Если шаг 1 ещё в очереди — новый id не найден в результате

**Исправление:** Увеличить `maxAttempts` до 6 и задержку до 600 мс для первой попытки, либо вернуть id сразу в ответе `createTerminal` и в `evaluateTerminalPresence` допускать absence в первые 2 попытки при `sessions !== null`:

```typescript
// terminal-open-policy.ts
export function evaluateTerminalPresence({
  attempt,
  maxAttempts = 6,   // было 3
  gracePeriodAttempts = 2, // новый параметр
  sessions,
  terminalId,
}: { ... gracePeriodAttempts?: number }): "ready" | "retry" | "missing" {
  if (sessions === null) return attempt < maxAttempts ? "retry" : "ready";
  const selected = sessions.find((s) => s.id === terminalId);
  if (selected && isActiveStatus(selected.status)) return "ready";
  if (selected) return "missing";
  // Grace period: терминал только что создан, KV-запись может ещё не сохранена
  if (attempt <= gracePeriodAttempts) return "retry";
  return attempt < maxAttempts ? "retry" : "missing";
}
```

---

### BUG-04 · `encodeBase64` — O(n) string concatenation

**Приоритет: СРЕДНИЙ** (производительность + корректность при больших объёмах)

В `terminal-attachment.ts`:
```typescript
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);  // O(n²) при больших размерах
  return btoa(binary);
}
```

При вводе крупного блока текста (paste большого файла, OSC 52 clipboard) это создаёт O(n²) строковую конкатенацию. В V8 это ломается при ~100KB.

**Исправление:**
```typescript
function encodeBase64(bytes: Uint8Array): string {
  // Нативный метод доступен в современных браузерах и Node 24
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64;
  if (typeof (bytes as unknown as { toBase64?: unknown }).toBase64 === "function") {
    return (bytes as unknown as { toBase64(): string }).toBase64();
  }
  // Fallback без O(n²) конкатенации
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
```

---

## 3. Деградация производительности

### PERF-01 · Двойной fetch токена при каждом открытии панели

**Профиль:** При открытии терминальной панели происходит следующее:

1. `preloadTerminalAssets()` вызывается (lazy preload из `app.tsx`)
2. Внутри него: `ghosttyWasmObjectUrl()` → `pluginToken()` → POST `/api/v1/plugins/.../token`
3. Параллельно: `loadNerdFont()` → `pluginToken()` → тот же POST

Оба запроса токена идут к одному `createRetryablePromiseCache` (`pluginToken` в `wterm-renderer.tsx`), так что второй дождётся первого — это правильно.

**НО:** В `terminal-panel.tsx` есть отдельная функция `pluginToken(signal: AbortSignal)`, которая делает тот же запрос независимо (не использует кеш из `wterm-renderer.tsx`). Это третий независимый токен-запрос при каждом upload.

Итого при первом открытии + upload: **3 token fetch** вместо 1.

**Исправление:** Вынести `createRetryablePromiseCache` для токена в отдельный модуль `plugin-token.ts` и импортировать его в оба файла.

```typescript
// plugin-token.ts (новый файл)
import { createRetryablePromiseCache } from "./retryable-cache.js";
import { z } from "zod";

const PLUGIN_ID = "wterm-terminal-preview";

export const getPluginToken = createRetryablePromiseCache(async (signal?: AbortSignal) => {
  const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  const json: unknown = await response.json().catch(() => null);
  const parsed = z.object({ token: z.string() }).safeParse(json);
  if (!response.ok || !parsed.success) {
    throw new Error(`asset token request failed (HTTP ${response.status})`);
  }
  return parsed.data.token;
});
```

---

### PERF-02 · WASM загружается без `WebAssembly.compileStreaming`

В `@wterm/ghostty/dist/wasm-bindings.js`:
```javascript
const response = await fetch(url);
const bytes = await response.arrayBuffer();  // весь файл в память
const { instance } = await WebAssembly.instantiate(bytes, { ... });
```

`WebAssembly.instantiate(bytes)` требует полностью загруженный буфер. `WebAssembly.compileStreaming(response)` может начать парсить WASM поблочно прямо во время загрузки, экономя ~200-400 мс на первом открытии (для файла 577 KB).

Это ограничение библиотеки @wterm/ghostty, не нашего кода. Но мы уже кешируем WASM как `ObjectURL` в `ghosttyWasmObjectUrl`:
```typescript
return URL.createObjectURL(
  new Blob([await response.arrayBuffer()], { type: "application/wasm" }),
);
```

Проблема в том, что мы сначала создаём Blob из `arrayBuffer()`, потом GhosttyCore делает `fetch(objectUrl)` и опять `arrayBuffer()` — данные копируются дважды. Можно передавать bytes напрямую:

```typescript
// Вместо ObjectURL можно передать bytes напрямую через loadGhosttyCore
// если @wterm/ghostty 0.4.x примет Uint8Array через опцию wasmBytes
// Проверить при обновлении до 0.4.x
```

---

### PERF-03 · Reconnect при каждой смене вкладки

`LegacyTerminalAttachment.connect()` вызывается в `useLegacyTerminalAttachment`:
```typescript
useEffect(() => {
  const next = new LegacyTerminalAttachment(terminalId);
  next.connect();
  setAttachment(next);
  return () => {
    setAttachment(null);
    next.detach();  // полностью уничтожает WebSocket + все listeners
  };
}, [terminalId]);
```

При скрытии и повторном показе панели (BB переключает tabs) `TerminalPanel` remount'ится, что вызывает `detach()` + новый `connect()`. В commit-истории видно, что это было исправлено (`fix: keep Wterm sessions alive across panel closes`), но только частично — WASM-ядро и font переиспользуются через кеш, а сам WebSocket пересоздаётся.

Полное исправление: поднять `LegacyTerminalAttachment` на уровень выше lifecycle панели (в `SelectedTerminal` или `TerminalAction`) и передавать его как prop. Тогда при скрытии/показе панели WebSocket останется открытым.

---

### PERF-04 · `flushWhenReplayComplete` пересортировывает каждый раз

В `terminal-attachment.ts`:
```typescript
const replay = [...this.pendingReplay.values()].sort((l, r) => l.seq - r.seq);
```

Map уже хранит значения в порядке вставки, а seq в replay поступают не обязательно по порядку. Сортировка — O(n log n), вызывается при каждом новом chunk. При длинном replay (~1000 строк) это накапливается.

Более быстрый подход — вставлять в sorted array при получении:
```typescript
// вместо Map<number, OutputChunk> использовать sorted insert
private insertSorted(target: OutputChunk[], chunk: OutputChunk): void {
  const idx = target.findIndex(c => c.seq > chunk.seq);
  target.splice(idx === -1 ? target.length : idx, 0, chunk);
}
```
Для replay это даёт O(n) поиска при вставке и O(n) flush без сортировки.

---

## 4. Флики и визуальные артефакты

### FLICKER-01 · Blank frame при первом рендере

**Причина:** `WtermRenderer` рендерит пустой `<div>` до загрузки core:
```typescript
if (!core) {
  return (
    <div className="wterm-renderer" data-renderer="ghostty" aria-busy="true" />
  );
}
```

При открытии терминала видна последовательность:
1. Пустой div (WASM ещё грузится, ~200-600 мс)
2. Терминал появляется, но пустой (core готов, attachment ещё не ready)
3. Replay данные flush'атся — появляется содержимое

Это создаёт 2-3 визуальных «скачка». `preloadTerminalPanel()` должен был это исправить (вызывается заранее при hover/click), но загрузка шрифта и WASM занимает время.

**Исправление:** Добавить skeleton-placeholder с правильным фоном вместо пустого div:
```tsx
if (!core) {
  return (
    <div
      className="wterm-renderer wterm-renderer--loading"
      data-renderer="ghostty"
      aria-busy="true"
      aria-label="Загрузка терминала…"
      style={{
        background: "var(--term-bg, #1e1e1e)",
        // Имитировать курсор чтобы не было белой вспышки
      }}
    />
  );
}
```

И в CSS:
```css
.wterm-renderer--loading::after {
  content: "";
  display: block;
  width: 8px;
  height: calc(var(--term-row-height, 17px) * 0.85);
  margin: 12px;
  background: var(--term-cursor, #aeafad);
  opacity: 0.4;
  animation: wterm-pulse 1.2s ease-in-out infinite;
}
@keyframes wterm-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.15; }
}
```

---

### FLICKER-02 · Resize вызывает layout-thrash при смене font size

В `wterm-renderer.tsx` при изменении `fontSizePx`:
```typescript
useEffect(() => {
  if (!readyRef.current) return;
  const frame = window.requestAnimationFrame(() => {
    const instance = terminalRef.current?.instance;
    refitTerminalAfterFontChange(instance);           // 1 reflow: measureCharSize()
    settleFrame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;       // 2й reflow: форсирует layout
    });
  });
}, [fontSizePx]);
```

`refitTerminalAfterFontChange` читает `getBoundingClientRect()` и `getComputedStyle()` — это форсированный layout (reflow). Затем `scrollHeight` во втором frame — второй reflow. Между ними `terminal.resize()` изменяет DOM (добавляет/убирает строки) — получаем layout-thrash: read → write → read.

**Исправление:** Батчить через `ResizeObserver`, который уже используется внутри `WTerm` при `autoResize: true`. При смене font-size нужно только обновить CSS-переменную и дать `ResizeObserver` обработать изменившийся размер контейнера автоматически. `refitTerminalAfterFontChange` вызывает `terminal.resize()` напрямую — нужно удостовериться что это не дублирует вызов из ResizeObserver.

---

### FLICKER-03 · `contain: layout paint style` на `.term-grid` блокирует overflow scroll

В `@wterm/dom/src/terminal.css`:
```css
.term-grid {
  contain: layout paint style;
  will-change: contents;
}
```

`contain: layout` изолирует layout-контекст, что хорошо для производительности. Но вместе с `overflow-y: auto` на `.wterm` (класс `.has-scrollback`) это создаёт double scroll context — браузер неправильно вычисляет `scrollHeight`, что приводит к "прыжкам" при длинном scrollback.

Симптом: после быстрого скролла вверх терминал "прыгает" обратно вниз.

В нашем `wterm-renderer.css`:
```css
.wterm-renderer {
  overflow: hidden;           /* мы переопределяем на hidden */
  overscroll-behavior: contain;
}
```

Мы уже переопределяем overflow на hidden, так что `.has-scrollback` класс добавляется @wterm/dom на элемент с классом `wterm`, но НАШ элемент имеет класс `wterm-renderer`. Это не конфликтует — но если `autoResize=true` и `WTerm` управляет scroll самостоятельно, то `onScroll` callback в нашем `WtermRenderer` может срабатывать на неправильном элементе.

**Диагностика:** В `WtermRenderer` используется `onScroll` на внешнем div (`className="wterm-renderer"`), но scroll на самом деле происходит на элементе `.wterm` внутри него. Это значит `followBottomRef` никогда не обновляется через наш `onScroll` handler — всегда остаётся `true` и принудительно скроллит вниз при каждом resize.

**Исправление:** Убрать `onScroll` из outer div или подписаться на правильный элемент:
```typescript
// В handleReady:
const instance = terminalRef.current?.instance;
if (instance?.element) {
  instance.element.addEventListener("scroll", () => {
    const el = instance.element;
    followBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
  }, { passive: true });
}
```

---

### FLICKER-04 · `clearTerminalSelection` при wheel scroll вызывает repaint

```typescript
const handleWheelCapture = useCallback(
  (event: ReactWheelEvent<HTMLDivElement>) => {
    if (clearSelectionBoundaryRef.current) return;
    clearTerminalSelection<Node | null>(
      terminalRef.current?.instance?.element ?? event.currentTarget,
      window.getSelection(),
    );
  }, [],
);
```

`window.getSelection()` и `selection.removeAllRanges()` форсируют repaint при каждом wheel event. Если пользователь активно скроллит — это 60+ раз в секунду.

**Исправление:** Проверять `selection.isCollapsed` до вызова removeAllRanges, добавить дебаунс или проверку через `selection.rangeCount > 0` (что уже делается внутри `clearTerminalSelection`, но вызов самой функции всё равно происходит):

```typescript
const handleWheelCapture = useCallback(
  (event: ReactWheelEvent<HTMLDivElement>) => {
    if (clearSelectionBoundaryRef.current) return;
    const selection = window.getSelection();
    // Только если есть что очищать
    if (!selection || selection.isCollapsed) return;
    clearTerminalSelection<Node | null>(
      terminalRef.current?.instance?.element ?? event.currentTarget,
      selection,
    );
  }, [],
);
```

---

## 5. Матрица оптимизаций

| # | Компонент | Тип | Impact | Conf | Effort | Score | Статус |
|---|-----------|-----|--------|------|--------|-------|--------|
| O-1 | `encodeBase64` O(n²) | Алгоритм | 4 | 5 | 1 | **20** | Готово к патчу |
| O-2 | Единый token cache | Архитектура | 3 | 5 | 2 | **7.5** | Требует новый файл |
| O-3 | Blank WASM div → тёмный skeleton | UX/Render | 4 | 5 | 1 | **20** | CSS + 3 строки |
| O-4 | WebSocket выживает при скрытии панели | Архитектура | 5 | 4 | 3 | **6.7** | Рефактор attachment lift |
| O-5 | wheel handler guard | Render | 3 | 5 | 1 | **15** | 2 строки |
| O-6 | scrollback selector в CSS | Визуальный | 3 | 5 | 1 | **15** | 1 строка |
| O-7 | onScroll на правильном элементе | Корректность | 4 | 4 | 2 | **8** | Средний рефактор |
| O-8 | npm ci / обновление node_modules | Dependency | 5 | 5 | 1 | **25** | Одна команда |
| O-9 | Retry grace period при create | Корректность | 4 | 4 | 1 | **16** | Изменение параметров |
| O-10 | font-size → ResizeObserver delegat. | Render | 3 | 3 | 3 | **3** | Требует изучения @wterm |
| O-11 | Кеш Nerd Font на сервере | Server I/O | 4 | 5 | 1 | **20** | 3 строки, см. §9.1 |
| O-12 | Разделить read/write path в KV-мьютексе | Архитектура | 5 | 4 | 3 | **6.7** | См. §9.2 |
| O-13 | Loading state в Picker | UX | 4 | 5 | 1 | **20** | См. §9.3 |

**Score = Impact × Confidence / Effort**

---

## 6. Конкретные патчи по файлам

### 6.1 `wterm-renderer.css` — 2 изменения

```css
/* Патч 1: scrollback-строки тоже получают transparent background */
.wterm-renderer .term-row,
.wterm-renderer .term-scrollback-row {
  background: transparent !important;
  box-shadow: none !important;
}

/* Патч 2: loading state */
.wterm-renderer--loading {
  background: var(--term-bg, #1e1e1e);
}

.wterm-renderer--loading::after {
  content: "";
  display: block;
  width: 8px;
  height: 14px;
  margin: 12px;
  background: var(--term-cursor, #aeafad);
  opacity: 0.35;
  animation: wterm-blink 1.2s step-end infinite;
}

@keyframes wterm-blink {
  0%, 100% { opacity: 0.35; }
  50%       { opacity: 0; }
}
```

### 6.2 `wterm-renderer.tsx` — 3 изменения

**a) Loading state:**
```typescript
// Было:
if (!core) {
  return (
    <div className="wterm-renderer" data-renderer="ghostty" aria-busy="true" />
  );
}

// Стало:
if (!core) {
  return (
    <div
      className="wterm-renderer wterm-renderer--loading"
      data-renderer="ghostty"
      aria-busy="true"
      aria-label="Terminal loading"
    />
  );
}
```

**b) Wheel handler guard:**
```typescript
const handleWheelCapture = useCallback(
  (event: ReactWheelEvent<HTMLDivElement>) => {
    if (clearSelectionBoundaryRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;  // <-- добавить
    clearTerminalSelection<Node | null>(
      terminalRef.current?.instance?.element ?? event.currentTarget,
      selection,
    );
  }, [],
);
```

**c) onScroll: убрать с outer div или перенести на instance.element в handleReady.**

### 6.3 `terminal-attachment.ts` — `encodeBase64`

```typescript
function encodeBase64(bytes: Uint8Array): string {
  // Нативный метод (Node 22+, Chrome 117+, Firefox 120+)
  if (typeof (bytes as { toBase64?: unknown }).toBase64 === "function") {
    return (bytes as { toBase64(): string }).toBase64();
  }
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
```

### 6.4 `terminal-open-policy.ts` — grace period

```typescript
export function evaluateTerminalPresence({
  attempt,
  maxAttempts = 6,        // было 3
  gracePeriodAttempts = 2,
  sessions,
  terminalId,
}: {
  attempt: number;
  maxAttempts?: number;
  gracePeriodAttempts?: number;
  sessions: readonly TerminalOpenCandidate[] | null;
  terminalId: string;
}): "ready" | "retry" | "missing" {
  if (sessions === null) return attempt < maxAttempts ? "retry" : "ready";
  const selected = sessions.find((session) => session.id === terminalId);
  if (selected && isActiveStatus(selected.status)) return "ready";
  if (selected) return "missing"; // терминал есть, но не running
  // Не нашли в списке: может быть grace period (KV ещё не записал)
  if (attempt <= gracePeriodAttempts) return "retry";
  return attempt < maxAttempts ? "retry" : "missing";
}
```

Это изменение требует обновления тестов в `terminal-open-policy.test.ts`.

---

## 7. Зависимости: что обновить и что не трогать

### Обновить немедленно

```bash
npm ci   # пересоздать node_modules из package-lock.json (даст @wterm 0.4.0)
```

### Проверить при обновлении @wterm 0.4.x → 0.4.1 (latest)

Разница между 0.4.0 и 0.4.1 в npm-тарболле нулевая (одинаковый sha256 WASM). Скорее всего — патч документации или типов. Обновление безопасно.

### Не трогать

- `ghostty-vt.wasm` в корне репозитория (577 KB) — это **правильная версия** для 0.4.0 (совпадает с sha256 из npm пакета). Файл в `dist/` (434 KB) — старая версия, **перезапишется при сборке** после `npm ci`.
- `zod: 4.3.6` — пинованная точная версия, не трогать.
- `vitest: 4.1.10` — пинованная, не трогать.

### Предупреждение о `pnpm-lock.yaml`

В `.gitignore` указан `pnpm-lock.yaml`, но файл существует в репозитории и содержит более старые версии (3.x). Одновременно есть `package-lock.json` (npm). Это означает что проект мигрировал с pnpm на npm, но pnpm-lock остался. Нужно либо добавить в gitignore явно, либо удалить (с разрешения владельца — согласно RULE 1 нельзя без разрешения).

---

## 8. Очерёдность реализации

### Фаза 1 — Одна команда, максимальный эффект (< 5 минут)

```bash
cd /home/ubuntu/Projects/bb-wterm-terminal-plugin
npm ci
npm run build
npm test
```

Это исправляет BUG-01, синхронизирует WASM-файл, переключает на правильную версию @wterm.

### Фаза 2 — Быстрые патчи кода (< 30 минут, каждый независим)

1. `wterm-renderer.css`: добавить `.term-scrollback-row` в background selector (1 строка)
2. `wterm-renderer.css`: добавить `--loading` стиль (cursor placeholder) (15 строк CSS)
3. `wterm-renderer.tsx`: loading div добавить класс `--loading` (2 строки)
4. `wterm-renderer.tsx`: wheel handler guard (2 строки)
5. `terminal-attachment.ts`: `encodeBase64` fix (8 строк)
6. `terminal-open-policy.ts`: grace period + `maxAttempts=6` (10 строк + тест)

### Фаза 3 — Архитектурные изменения (< 2 часа, требуют тестирования)

7. `plugin-token.ts`: единый кеш токена, обновить импорты в `wterm-renderer.tsx` и `terminal-panel.tsx`
8. Поднять `LegacyTerminalAttachment` на уровень `SelectedTerminal` чтобы WebSocket жил при скрытии панели

### Фаза 4 — Исследовательские оптимизации (требуют браузерного профилирования)

9. Проверить `onScroll` на правильном элементе через DevTools → Performance
10. Оценить переход на `WebAssembly.compileStreaming` при обновлении @wterm (нужны changes upstream)

---

## 9. Три находки с наибольшим влиянием на «ощущение скорости»

Эти три пункта обнаружены при чтении кода после составления основной матрицы. По совокупности «эффект / стоимость» они опережают большинство пунктов выше, поэтому вынесены отдельно.

---

### 9.1 · Nerd Font читается с диска при каждом HTTP-запросе

**Приоритет: ВЫСОКИЙ** · Score 20 · Правка ~6 строк

WASM на сервере кешируется корректно — есть явный module-level кеш с защитой от повторного чтения при параллельных запросах:

```typescript
// server.ts:365 — правильный паттерн
let ghosttyWasmCache: Promise<Uint8Array> | Uint8Array | null = null;

async function ghosttyWasmBytes(): Promise<Uint8Array> {
	if (ghosttyWasmCache instanceof Uint8Array) return ghosttyWasmCache;
	if (ghosttyWasmCache) return ghosttyWasmCache;   // in-flight promise — дедупликация
	const pending = readFile(bundledWasmUrl()).then((bytes) => {
		const copy = new Uint8Array(bytes);
		ghosttyWasmCache = copy;
		return copy;
	});
	ghosttyWasmCache = pending;
	return pending;
}
```

Шрифт такого кеша **не имеет** — `readFile` вызывается внутри самого хендлера:

```typescript
// server.ts:434 — каждый GET заново читает 1.2 MB с диска
bb.http.route(
	"GET",
	NERD_FONT_PATH,
	async () =>
		new Response(
			await readFile(bundledNerdFontUrl()),   // ← disk I/O на каждый запрос
			{
				headers: {
					"cache-control": "public, max-age=31536000, immutable",
					"content-type": "font/woff2",
					"x-content-type-options": "nosniff",
				},
			},
		),
	{ auth: "token" },
);
```

**Почему `cache-control: immutable` не спасает.** Заголовок работает только для браузерного HTTP-кеша. Но клиент не запрашивает шрифт как обычный ресурс: в `wterm-renderer.tsx` он тянется через `fetch` с header `x-bb-plugin-token`, затем оборачивается в `FontFace` из `ArrayBuffer`:

```typescript
// wterm-renderer.tsx:181
const response = await fetch(NERD_FONT_URL, {
  headers: { "x-bb-plugin-token": await pluginToken() },
  signal: AbortSignal.timeout(10_000),
});
const face = new FontFace(NERD_FONT_FAMILY, await response.arrayBuffer(), ...);
```

Запрос с кастомным заголовком авторизации — не тот случай, где браузер уверенно переиспользует кеш-запись, а `nerdFontLoads` — это `WeakMap`, привязанная к `document.fonts`. При полной перезагрузке BB-окна или в другом окне/сессии кеш пуст, и запрос уходит на сервер снова.

**Практический эффект.** Каждое попадание в сервер = синхронное (для этого запроса) чтение 1 202 596 байт. При открытии нескольких вкладок/окон подряд, при перезагрузке BB, при работе нескольких пользователей в одном BB-хосте — это N × 1.2 MB дискового чтения и N × аллокация буфера в heap Node-процесса, обслуживающего все плагины.

**Патч** — тот же паттерн, что уже применён для WASM:

```typescript
// server.ts — добавить рядом с ghosttyWasmCache
let nerdFontCache: Promise<Uint8Array> | Uint8Array | null = null;

async function nerdFontBytes(): Promise<Uint8Array> {
	if (nerdFontCache instanceof Uint8Array) return nerdFontCache;
	if (nerdFontCache) return nerdFontCache;
	const pending = readFile(bundledNerdFontUrl()).then((bytes) => {
		const copy = new Uint8Array(bytes);
		nerdFontCache = copy;
		return copy;
	});
	nerdFontCache = pending;
	return pending;
}
```

и в маршруте:

```typescript
bb.http.route(
	"GET",
	NERD_FONT_PATH,
	async () =>
		new Response(await nerdFontBytes(), {
			headers: {
				"cache-control": "public, max-age=31536000, immutable",
				"content-type": "font/woff2",
				"x-content-type-options": "nosniff",
			},
		}),
	{ auth: "token" },
);
```

**Дополнительно стоит рассмотреть:** ~1.2 MB для набора символов Powerline/Starship — это весь Symbols Nerd Font Mono. Подмножество (subset) только с реально используемыми диапазонами (Powerline U+E0A0–E0D4, Devicons, Font Awesome ядро) уменьшит файл в 5–10 раз. Это отдельная задача с проверкой лицензии Nerd Fonts (MIT, subsetting разрешён).

---

### 9.2 · `withLinkedTerminalIds` — мьютекс, удерживаемый на время сетевых round-trip'ов

**Приоритет: КРИТИЧЕСКИЙ** · Score 6.7 (высокий effort, но самый большой эффект на многотабовый сценарий)

Это — вероятная корневая причина того, что несколько одновременно открываемых терминалов «залипают» на верификации.

#### Механика

В `server.ts` есть per-thread сериализующая очередь:

```typescript
const terminalLinkWrites = new Map<string, Promise<void>>();

async function withLinkedTerminalIds<Value>(
	bb: BbPluginApi,
	threadId: string,
	update: (current: string[]) => Promise<Value>,
): Promise<Value> {
	const key = terminalLinksKey(threadId);
	const previous = terminalLinkWrites.get(key) ?? Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const queued = previous.then(() => gate);
	terminalLinkWrites.set(key, queued);
	await previous;                                     // ← ждём всю предыдущую цепочку
	try {
		return await update(await linkedTerminalIds(bb, threadId));
	} finally {
		release();
		if (terminalLinkWrites.get(key) === queued) terminalLinkWrites.delete(key);
	}
}
```

Сама очередь реализована аккуратно. Проблема в том, **что именно** выполняется внутри критической секции. `loadLinkedTerminals` — это операция **чтения**, но она заходит в тот же мьютекс и держит его, пока идут N обращений к хосту:

```typescript
async function loadLinkedTerminals(bb: BbPluginApi, threadId: string) {
	return withLinkedTerminalIds(bb, threadId, async (linkedIds) => {
		const linkedResults = await Promise.allSettled(
			linkedIds.map((terminalId) => bb.sdk.terminals.get({ terminalId })),
		);                                   // ← N round-trip'ов ВНУТРИ блокировки
		...
	});
}
```

И `sessionsForThread`, и `listedSessionsForThread` вызывают `loadLinkedTerminals`. То есть **каждый** `listSessions` берёт эксклюзивную блокировку по потоку.

#### Кто конкурирует за эту блокировку

| Вызов | Частота | Держит мьютекс на время |
|-------|---------|-------------------------|
| `listSessions` (verify loop из `SelectedTerminal`) | каждые 400 мс, до 3 попыток на вкладку | N × `terminals.get` |
| `listSessions` (первый рендер `Picker`) | 1× на открытие Picker | N × `terminals.get` |
| `createTerminal` → `rememberLinkedTerminal` | 1× на новую вкладку | 1 × KV write |
| `restartTerminal` | по кнопке | 1 × KV write |
| `handleUpload` → `sessionsForThread` | на каждый upload | N × `terminals.get` |

Поскольку `evaluateTerminalPresence` ретраит с интервалом 400 мс, две открытые вкладки создают устойчивый поток блокирующих запросов. Каждая новая вкладка добавляет свой verify-poll в ту же очередь. Задержка растёт как O(вкладки × N × RTT).

**Это замыкает петлю с BUG-03.** Verify-loop не находит только что созданный терминал не из-за «сети», а потому что его собственный `listSessions` стоит в очереди за `rememberLinkedTerminal` того же самого create — и за verify-poll'ами соседних вкладок. Увеличение `maxAttempts` (§6.4) лечит симптом; разделение read/write лечит причину.

#### Усугубляющий фактор: список linked-ID растёт неограниченно

```typescript
export function nextLinkedTerminalIds(
	linkedIds: readonly string[],
	results: readonly PromiseSettledResult<{ id: string }>[],
): string[] {
	return linkedIds.flatMap((id, index) => {
		const result = results[index];
		if (!result) return [id];
		if (result.status === "fulfilled") return [result.value.id];
		return [id];        // ← rejected: ID сохраняется навсегда
	});
}
```

Мёртвые ID никогда не удаляются. Следствия накапливаются:

1. **N растёт монотонно** за время жизни потока. Каждый `listSessions` делает `terminals.get` по каждому мёртвому ID — вероятно, с таймаутом. Чем дольше живёт поток, тем длиннее критическая секция. Плагин становится тем медленнее, чем дольше им пользуются.

2. **Мёртвые терминалы отображаются как живые.** Недоступный ID превращается в синтетическую сессию:

```typescript
function unavailableLinkedSession(terminalId: string): Session {
	return {
		id: terminalId,
		title: "Wterm terminal",
		initialCwd: null,
		status: "running",        // ← мёртвый терминал заявлен как running
		updatedAt: 0,
		lastUserInputAt: null,
	};
}
```

Это попадает в `listedSessionsForThread`, оттуда — в `Picker` (секция «Running», строка `~ · status: running · updated 01.01.1970`) и в `evaluateTerminalPresence`, который на `status === "running"` возвращает `"ready"`. Панель открывает WebSocket к несуществующему PTY: `LegacyTerminalAttachment` соединяется, получает `onclose`, уходит в `scheduleReconnect` с backoff до 2 с — и цикл повторяется бесконечно. Пользователь видит пустой терминал без сообщения об ошибке.

Вероятно, `status: "running"` выбран намеренно, чтобы кратковременный сбой хоста не убивал вкладку. Но без различения «временно недоступен» и «мёртв» результат — вечные зомби-записи.

#### Патч

**Шаг 1. Read path не берёт блокировку.** Чтение получает снимок KV и делает host round-trip'ы вне мьютекса; реконсиляция откладывается и не задерживает ответ.

```typescript
async function readLinkedTerminals(bb: BbPluginApi, threadId: string) {
	// Снимок без блокировки: конкурентный create может добавить ID уже после
	// чтения — это допустимо, следующий вызов его увидит.
	const linkedIds = await linkedTerminalIds(bb, threadId);
	const linkedResults = await Promise.allSettled(
		linkedIds.map((terminalId) => bb.sdk.terminals.get({ terminalId })),
	);
	const sessions = linkedResults.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	const unavailableIds = linkedIds.filter(
		(_, index) => linkedResults[index]?.status === "rejected",
	);

	// Реконсиляция — отдельно, под блокировкой, не блокируя текущий ответ.
	const replacements = new Map<string, string>();
	linkedIds.forEach((id, index) => {
		const result = linkedResults[index];
		if (result?.status === "fulfilled" && result.value.id !== id) {
			replacements.set(id, result.value.id);
		}
	});
	if (replacements.size > 0) {
		void withLinkedTerminalIds(bb, threadId, async (current) => {
			// Перечитываем под блокировкой: применяем только к ID, которые всё ещё
			// присутствуют, чтобы не затереть конкурентный rememberLinkedTerminal.
			await saveLinkedTerminalIds(
				bb,
				threadId,
				current.map((id) => replacements.get(id) ?? id),
			);
		}).catch(() => {
			// Реконсиляция — best-effort; следующее чтение повторит попытку.
		});
	}

	return { sessions, unavailableIds };
}
```

Затем `sessionsForThread` и `listedSessionsForThread` переводятся на `readLinkedTerminals`. Мьютекс остаётся только за истинными записями: `rememberLinkedTerminal` и `restartTerminal`.

**Шаг 2. Ограничить время удержания мёртвых ID.** Добавить к каждой записи метку первого отказа и удалять ID после порога.

```typescript
interface LinkedTerminalRecord {
	id: string;
	/** Момент первого подряд идущего отказа get(); null — терминал жив. */
	firstUnavailableAt: number | null;
}

const DEAD_TERMINAL_GRACE_MS = 60_000;
```

Логика: отказ — записать `firstUnavailableAt` (если ещё не установлен); успех — сбросить в `null`; при отказе, старше `DEAD_TERMINAL_GRACE_MS`, удалить ID из списка. Это сохраняет устойчивость к кратковременным сбоям хоста и при этом гарантирует, что N остаётся ограниченным.

Миграция схемы KV: текущее значение — `string[]`. Нужно принимать оба формата при чтении:

```typescript
function parseLinkedRecords(value: unknown): LinkedTerminalRecord[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		if (typeof item === "string") {
			return [{ id: item, firstUnavailableAt: null }];   // legacy-формат
		}
		if (
			typeof item === "object" && item !== null &&
			"id" in item && typeof item.id === "string"
		) {
			const at = (item as { firstUnavailableAt?: unknown }).firstUnavailableAt;
			return [{
				id: item.id,
				firstUnavailableAt: typeof at === "number" ? at : null,
			}];
		}
		return [];
	});
}
```

**Шаг 3. Не выдавать недоступные терминалы за `running`.** Ввести отдельный статус, чтобы `evaluateTerminalPresence` не считал их готовыми:

```typescript
function unavailableLinkedSession(terminalId: string): Session {
	return {
		id: terminalId,
		title: "Wterm terminal",
		initialCwd: null,
		status: "unavailable",     // было "running"
		updatedAt: 0,
		lastUserInputAt: null,
	};
}
```

`isActiveStatus` в `terminal-open-policy.ts` уже принимает только `running` / `starting`, поэтому `"unavailable"` автоматически даст `"missing"` → Picker с понятным уведомлением вместо бесконечного WebSocket-reconnect. `Picker` покажет такую запись в секции «Exited», где есть кнопка **Restart** — то есть у пользователя появляется рабочий выход из состояния.

Этот шаг требует обновления `server.test.ts` и `terminal-open-policy.test.ts`.

---

### 9.3 · `Picker` не имеет loading state — первый экран пустой

**Приоритет: ВЫСОКИЙ** · Score 20 · Правка ~20 строк

Самая заметная для пользователя проблема из трёх, и самая дешёвая в исправлении.

`Picker` инициализирует список пустым массивом и не различает «загружается» и «пусто»:

```typescript
// app.tsx
const [items, setItems] = useState<Session[]>([]);
const [creating, setCreating] = useState(false);
// ...
useEffect(() => {
	request.current.mounted = true;
	const generation = request.current.generation;
	rpc.call("listSessions", { threadId })
		.then(
			(next) => { if (isCurrent(generation)) setItems(next); },
			() => { if (isCurrent(generation)) setItems([]); },   // ошибка ≡ пусто
		)
		.catch(() => {});
}, [rpc, threadId]);
```

При рендере это даёт:

```
Wterm terminal
[ New terminal ]
RUNNING
              ← пусто
EXITED
              ← пусто
```

Что пользователь видит на практике:

1. **Заголовки без содержимого на 200–400 мс** (дольше, если `listSessions` стоит в очереди мьютекса из §9.2). Нет ни спиннера, ни скелетона.
2. **Ошибка RPC выглядит как «терминалов нет».** Обработчик отказа выставляет `setItems([])` — тот же результат, что и успешный пустой ответ. Существующие сессии становятся невидимыми, и пользователь, скорее всего, создаст ещё один дубликат.
3. **Picker появляется там, где ожидался терминал.** `run()` в `threadPanelAction` вызывает `createTerminal` перед `openPanel`, поэтому нормальный путь ведёт прямо в терминал. Но если create отказал, или host-путь недоступен и сработал `LegacyTerminalAction` без сохранённого `terminalId`, пользователь попадает в Picker без объяснения причины.

Это резко контрастирует с уровнем проработки остальной части плагина, где есть и `AbortController`-генерации, и retry-политики, и защита от гонок. По первому впечатлению бьёт сильнее, чем любой из технических баг-пунктов выше.

#### Патч

Заменить `items: Session[]` на явную машину состояний. Паттерн `creating` уже присутствует в компоненте — расширяем его на начальную загрузку.

```typescript
type PickerState =
	| { kind: "loading" }
	| { kind: "loaded"; items: Session[] }
	| { kind: "failed"; message: string };

function Picker({
	threadId,
	replace,
	notice,
}: {
	threadId: string;
	replace: (params: unknown) => void;
	notice?: string;
}) {
	const rpc = useRpc<typeof wtermRpcContract>();
	const [state, setState] = useState<PickerState>({ kind: "loading" });
	const [creating, setCreating] = useState(false);
	const [reload, setReload] = useState(0);
	const request = useRef({ generation: 0, mounted: false });
	const isCurrent = (generation: number) =>
		request.current.mounted && request.current.generation === generation;

	useEffect(() => {
		request.current.mounted = true;
		const generation = request.current.generation;
		setState({ kind: "loading" });
		rpc
			.call("listSessions", { threadId })
			.then(
				(next) => {
					if (isCurrent(generation)) setState({ kind: "loaded", items: next });
				},
				(error: unknown) => {
					if (!isCurrent(generation)) return;
					setState({
						kind: "failed",
						message:
							error instanceof Error ? error.message : "Could not list terminals.",
					});
				},
			)
			.catch(() => {});
		return () => {
			request.current.mounted = false;
			request.current.generation += 1;
		};
	}, [reload, rpc, threadId]);
```

Рендер списка получает три ветки вместо одной:

```tsx
	{state.kind === "loading" ? (
		<div className="wterm-picker-skeleton" aria-busy="true">
			<span className="sr-only">Loading terminal sessions…</span>
			<div className="wterm-picker-skeleton-row" />
			<div className="wterm-picker-skeleton-row" />
		</div>
	) : state.kind === "failed" ? (
		<div className="flex flex-col items-start gap-2">
			<p role="alert" className="text-sm">
				Could not list terminal sessions: {state.message}
			</p>
			<button
				type="button"
				className="rounded border px-2 py-1 text-xs"
				onClick={() => setReload((current) => current + 1)}
			>
				Retry
			</button>
		</div>
	) : (
		<>
			<section>
				<h3 className="text-xs font-medium uppercase">Running</h3>
				{running.length === 0 ? (
					<p className="text-xs text-muted-foreground">No running terminals.</p>
				) : (
					running.map(renderItem)
				)}
			</section>
			{/* Exited — только если непусто, чтобы не показывать мёртвый заголовок */}
			{exited.length > 0 ? (
				<section>
					<h3 className="text-xs font-medium uppercase">Exited</h3>
					{exited.map(renderExitedItem)}
				</section>
			) : null}
		</>
	)}
```

Скелетон в `app.css`:

```css
.wterm-picker-skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.wterm-picker-skeleton-row {
  height: 4.25rem;
  border-radius: 0.375rem;
  background: color-mix(in oklch, var(--ink) 6%, var(--canvas));
  animation: wterm-skeleton-pulse 1.4s ease-in-out infinite;
}

.wterm-picker-skeleton-row:nth-child(3) {
  animation-delay: 0.2s;
}

@keyframes wterm-skeleton-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.55; }
}

@media (prefers-reduced-motion: reduce) {
  .wterm-picker-skeleton-row { animation: none; }
}
```

#### Мгновенная кнопка «Reopen last»

Отдельное улучшение, снимающее ожидание полностью. `readLastTerminalId(threadId)` — синхронное чтение `localStorage`, доступное **до** любого RPC. Если сохранённый ID есть, можно предложить действие сразу на первом кадре, не дожидаясь `listSessions`:

```tsx
const lastTerminalId = useMemo(() => readLastTerminalId(threadId), [threadId]);

// Рендерится немедленно, до завершения listSessions
{lastTerminalId ? (
	<button
		type="button"
		onClick={() => replace({ schemaVersion: 1, terminalId: lastTerminalId })}
		className="rounded border px-3 py-2 text-sm"
	>
		Reopen last terminal
	</button>
) : null}
```

Если терминал уже мёртв, `SelectedTerminal` отработает штатно: `evaluateTerminalPresence` вернёт `missing` и вернёт пользователя в Picker с уведомлением — то есть худший случай не хуже текущего поведения, а лучший избавляет от ожидания целиком.

Это изменение требует обновления тестов Picker'а, если они появятся; на текущий момент `Picker` тестами не покрыт — сам по себе повод добавить покрытие вместе с патчем.

---

## Приложение: Известные ограничения BB 0.41.0

| Функция | Статус в BB 0.41.0 |
|---------|-------------------|
| `experimental_primarySurface` | ❌ не поддерживается (composer кнопка открывает side panel) |
| `experimental_claimedTerminalId` | ✅ поддерживается |
| `experimental_useReplaceCurrentPluginTab` | ✅ поддерживается |
| Native terminal WebSocket `/ws/terminals/:id` | ✅ поддерживается (legacy path) |
| `bb.sdk.terminals.create` с `scope.kind="environment"` | ✅ поддерживается |

Composer кнопка "Chat ↔ CLI" не будет работать как full-screen toggle пока BB не добавит `experimental_primarySurface`. Это не баг плагина — плагин корректно определяет отсутствие API через `openPanel` → `!opened → throw`.

---

*Документ сгенерирован на основе статического анализа исходного кода без запуска браузера. Для подтверждения FLICKER-03 и PERF-03 необходимо браузерное профилирование в Chrome DevTools → Performance.*
