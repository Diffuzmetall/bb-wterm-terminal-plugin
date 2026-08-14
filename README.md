# Wterm Terminal Preview for BB

Private standalone build of the current Wterm terminal work from BB commit
`2dcf5960c` (V1 terminal attachment, V2 reconnect, V3 host file upload).
Version `0.3.2` serves Ghostty WASM through the authenticated plugin route and
falls back to BB's legacy terminal WebSocket when the newer attachment hooks
are unavailable.

## Requirements

- A BB build with plugin SDK `^0.4.1` and host file writes. Newer attachment
  hooks are used when present; older hosts use the legacy terminal socket.
- `git`, `npm`, `gh`, and `bb` on `PATH`.
- GitHub access to `Diffuzmetall/bb-wterm-terminal-plugin`.

## Install the pinned version

```sh
gh auth status
gh auth setup-git
bb plugin install 'git:github.com/Diffuzmetall/bb-wterm-terminal-plugin@v0.3.2' --yes
bb plugin list
```

BB clones the private repository through Git's HTTPS credential helper, installs
runtime dependencies with lifecycle scripts disabled, and builds the plugin.

## Track `main` instead

Use this only when you deliberately want later commits:

```sh
bb plugin install 'git:github.com/Diffuzmetall/bb-wterm-terminal-plugin@main' --yes
bb plugin update wterm-terminal-preview
```

## Control or remove

```sh
bb plugin disable wterm-terminal-preview
bb plugin enable wterm-terminal-preview
bb plugin remove wterm-terminal-preview
```

The plugin ID is `wterm-terminal-preview`, so it can coexist with the bundled
official `wterm-terminal` during development.
