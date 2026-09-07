# Wterm hyperlinks: live QA status — 6 September 2026

## Status

**BLOCKED — neither hyperlink route is verified in the live VPS build.** This is not a confirmed routing failure: the terminal surface did not render the test links, so there was nothing to click.

| Route | Result | What was observed |
| --- | --- | --- |
| `https://example.com` → BB embedded browser | **BLOCKED** | OSC 8 label `WTERM_WEB_QA` never appeared in the terminal surface; no destination tab or URL could be checked. |
| `file:///home/ubuntu/Projects/bb-wterm-terminal-plugin/README.md` → BB Files | **BLOCKED** | OSC 8 label `WTERM_FILE_QA` never appeared; Files preview and README content could not be checked. |

## Reproduction and evidence

Target: `https://vps-7f443bf2.tail8b4514.ts.net:38886`, thread BWT-13.

1. BB thread opened successfully.
2. `More plugin actions → Show session terminal` opened Wterm successfully.
3. The page body contained `Wterm terminal` and a detached shell path.
4. Browser screenshots of the terminal surface were blank white.
5. Harmless OSC 8 probes were entered, but neither visible label appeared in accessibility text or the rendered surface.
6. Because no rendered anchor existed, no hyperlink click was performed and no destination claim is valid.

Screenshots from the run:

- `.pi/wterm-links-wterm.png`
- `.pi/wterm-after-web.png`
- `.pi/wterm-after-file.png`

The screenshots are run artifacts; inspect them in the QA session workspace if the relative paths are not present in this checkout.

## Why it currently does not work (known facts vs hypotheses)

### Confirmed facts

- BB and the Wterm panel are reachable on the VPS.
- The Wterm panel can be opened through the plugin action.
- The terminal surface is present in the DOM/body text.
- The rendered terminal canvas/output was blank in the automated browser session.
- OSC 8 labels were absent, so routing code was never exercised by a user click.

### Plausible causes (not yet distinguished)

1. **Wterm paint/readiness failure:** the renderer or canvas may not reach a usable size or paint frame after mounting.
2. **PTY input/output failure:** the detached shell may exist in host state while its output is not attached to the visible renderer.
3. **VPS production asset/version drift:** the live plugin may not contain the same Wterm package/build as the checked-out source, despite the panel shell opening.
4. **Browser automation surface limitation:** the terminal may be visually rendered in a way not exposed by accessibility text; blank screenshots make this less likely but do not prove the application path is broken for a headed user.
5. **OSC 8 support path not reached:** if ordinary output is also invisible, this is downstream of hyperlink parsing; if ordinary output works manually but OSC 8 does not, then inspect the terminal link parser/event path.

These are hypotheses, not root-cause findings. Do not mark either link route as failed until a visible terminal output is obtained and the two real anchors can be clicked.

## Code path to verify once terminal output works

- `terminal-links.ts`: validates `http:`/`https:` URLs and converts `file:///...` URIs to an internal safe marker.
- `terminal-panel.tsx`: URL actions call `navigate.openUrl()` (with `window.open` fallback); file actions call `navigate.experimental_openFilePreview()` with the current `hostId` and decoded path.
- `wterm-renderer.tsx`: renders the anchor and invokes the supplied `onLinkClick` callback.

Static code inspection is not live behavior proof. The required acceptance evidence is:

- web click opens a BB embedded browser panel/tab at `https://example.com`;
- file click opens the BB Files/file-preview surface showing `README.md` from the selected host;
- neither route silently falls back to an unrelated external browser or an unowned local filesystem.

## Next smallest diagnostic

1. In a headed browser, open BWT-13 and Wterm.
2. Confirm a plain command such as `printf 'VISIBLE\\n'` appears before testing OSC 8.
3. If plain output is invisible, debug Wterm mount/PTY attachment/usable-size/asset provenance first; hyperlink routing is not yet testable.
4. If plain output is visible, emit one OSC 8 probe at a time and click the rendered label.
5. Record destination panel name, URL/path, host ID, and screenshots for each route.

No source files were changed by the live QA run.
