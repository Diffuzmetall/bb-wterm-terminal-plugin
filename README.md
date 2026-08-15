# Wterm Terminal Preview for BB

A Ghostty-backed terminal panel for [BB](https://github.com/get-bb/bb). It
attaches to a terminal session owned by the current BB thread, keeps the stock
BB terminal untouched, and adds file transfer and terminal-specific font
controls.

This repository is an early public preview. The plugin ID is
`wterm-terminal-preview`, so it can coexist with BB's bundled
`wterm-terminal` while the integration is evaluated.

## Features

- Ghostty terminal emulation through `@wterm/ghostty` and WebAssembly.
- Bundled Symbols Nerd Font Mono fallback for Powerline, Starship, and Nerd
  Font prompt icons; no local font installation is required.
- Every **Wterm terminal** tab starts an independent thread-scoped terminal;
  opening another tab never reuses or replaces the current session.
- Select and restart existing thread-scoped BB terminal sessions when needed.
- Keyboard, resize, wheel, click, and button-drag mouse input for terminal UIs.
- Persistent font size controls from 10px to 24px.
- Native text selection contained inside the terminal and copied on selection.
- File upload by button or drag-and-drop, plus image upload from the clipboard.
- Files are written on the terminal host and their quoted path is inserted at
  the prompt using bracketed paste.
- Compatibility with BB hosts that expose the legacy terminal WebSocket.

## Requirements

- A current BB installation with plugin SDK `^0.4.1` and host file writes.
- Single-tab presentation requires a BB build that supports
  `experimental_claimedTerminalId`. Older hosts still work, but also show the
  same session in a native terminal tab.
- `git`, `npm`, and `bb` available on `PATH`.
- Network access to GitHub and the npm registry during installation.

## Install

Install the pinned release:

```sh
bb plugin install 'git:github.com/Diffuzmetall/bb-wterm-terminal-plugin@v0.3.13' --yes
bb plugin source wterm-terminal-preview
```

Open a BB thread and choose **Wterm terminal** from the new-tab menu. Each
activation creates a new terminal session and opens it in its own panel tab.

To follow the latest commit on `main` instead of a release tag:

```sh
bb plugin install 'git:github.com/Diffuzmetall/bb-wterm-terminal-plugin@main' --yes
bb plugin update wterm-terminal-preview --yes
```

Release tags are recommended because a pinned source is reproducible. Updating
a pinned tag requires installing the newer tag explicitly.

## Terminal controls

- Use the `-` and `+` toolbar buttons to change the terminal font size. The
  setting is remembered in the browser.
- In a normal shell, drag to select text.
- When a TUI such as Herdr has enabled mouse tracking, click and drag are sent
  to the TUI. Hold `Shift` while dragging to use browser-native selection.
- A completed native selection is copied to the clipboard when browser
permissions allow it.

## Renderer and shell

The plugin uses `libghostty` through `@wterm/ghostty` as its VT and Unicode
core. `@wterm/dom` paints that state as an HTML terminal grid, so settings from
the native Ghostty application do not control this embedded terminal. The
bundled Nerd Font fallback supplies prompt icons consistently across machines.

Seeing `zsh` is normal: it is the shell process running inside the Ghostty-backed
terminal. A separate neighbouring native `zsh` tab is different; that means the
BB host does not yet support `experimental_claimedTerminalId`.

## File and image transfer

Use **Upload file**, drop a file over the panel, or paste an image. The plugin
sends the bytes through an authenticated BB plugin route and `bb.sdk.files` to
the host that owns the selected terminal. It does not implement a second SCP or
SSH client.

Uploads are stored under `<terminal cwd>/.bb-wterm-uploads/` with randomized
names and mode `0600`. The plugin verifies the returned size and SHA-256 before
inserting the path. Images are limited to 10 MiB and other files to 25 MiB.

## Manage the plugin

```sh
bb plugin list
bb plugin reload wterm-terminal-preview
bb plugin disable wterm-terminal-preview
bb plugin enable wterm-terminal-preview
bb plugin remove wterm-terminal-preview
```

If the BB host daemon restarts and the selected terminal is no longer
available, reopen the Wterm panel and select or restart a terminal session.

## Security model

- The WASM and upload endpoints require BB's per-plugin HTTP token.
- An upload is accepted only when the terminal belongs to the requested thread.
- File writes use the terminal's host and initial working directory as the BB
  file boundary.
- Upload names are randomized; existing files are not overwritten.
- The repository contains no credentials and the plugin does not persist BB
  tokens.

Before installing code from `main`, review the current commit. Prefer a signed
or otherwise trusted release policy for production deployments.

## Development

```sh
git clone https://github.com/Diffuzmetall/bb-wterm-terminal-plugin.git
cd bb-wterm-terminal-plugin
npm ci
bb plugin build .
```

The build produces the frontend and server bundles in `dist/` and copies
`ghostty-vt.wasm` and the bundled Nerd Font from the repository. Generated
dependencies and build output are intentionally not committed.

## License

[MIT](LICENSE)

The bundled Ghostty WASM renderer comes from
[`@wterm/ghostty`](https://github.com/vercel-labs/wterm/tree/main/packages/%40wterm/ghostty),
which is distributed under the Apache-2.0 license.

`SymbolsNerdFontMono-Regular.woff2` comes from Nerd Fonts v3.5.0 and is
distributed under the included [MIT license](LICENSE-NERD-FONTS-SYMBOLS).
