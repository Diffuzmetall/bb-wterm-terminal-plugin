# Wterm ownership gate — `wterm-a4b.13.1`

**Date:** 2026-09-06
**Owner:** SwiftLynx
**Verdict:** **INCOMPLETE / BLOCKED**. The earlier one-tab/one-PTY observation was real for the exercised sidebar smoke path, but it was not evidence for the required isolated-thread scenarios.

## What was actually exercised

The browser session was `wterm-swiftlynx-ownership` against BB at `http://127.0.0.1:38896`.

- Project: `proj_u6jjwia3ej`
- Existing thread: `thr_e3hica6ujn`
- Environment: `env_2py5mg8hte`
- Host: `host_5rncjk8fs2`
- PTY created by the smoke: `term_awbd68j8tk`

The path was the standalone/sidebar Wterm flow: open the existing thread, use **Open new tab (Ctrl + T)**, then choose **Wterm terminal**. The resulting DOM showed one visible `Wterm terminal` secondary-panel tab and one running PTY. This is a **real observation for that path**, not a hypothetical claim.

The PTY was then closed without sending user input:

```text
BB_SERVER_URL=http://127.0.0.1:38896 BB_HOST_DAEMON_PORT=38897 bb terminal close term_awbd68j8tk --if-clean --json
exit 0
result: status=exited, lastUserInputAt=null
```

The preserved screenshot is `.logs/wterm-a4b-13-1-browser.png` (SHA-256 `6d0e6c83c654632bb93f48b5f7983c5e3f1783784ee459250500a3541394c385`).

## Required scenarios and probe status

| Scenario | Count | Result |
| --- | ---: | --- |
| Sidebar smoke (existing thread, new tab + Wterm) | 1 | **PASS for this path:** 1 visible Wterm tab, 1 PTY |
| Isolated thread: thread new-action open versus existing native terminal | 0 | **UNKNOWN**; no isolated thread was created |
| Isolated thread: composer existing-action reveal | 0 | **UNKNOWN**; composer action was not rendered/exercised |
| Composer reveal creates zero PTYs | 0 | **UNKNOWN** |
| Duplicate native-tab suppression in the required path | 0 | **UNKNOWN** |
| Own-lifecycle cleanup | 1 | **PASS for created smoke PTY:** safely closed with `--if-clean` |

No isolated test thread was created. The existing `thr_e3hica6ujn` is not an isolated scenario. The rendered thread did not contain `.wterm-session-terminal-action` (`count 0`), so the composer-existing-action path could not be exercised. No user input was sent.

## Host/API finding

Installed versions were confirmed as BB `0.42.1`, `@get-bb/plugin-sdk` `0.4.47`, TypeScript `5.9.3`, and Vitest `4.1.10`.

The installed SDK declaration does not expose `experimental_claimedTerminalId`: the `openPanel` options contract contains only `title` and JSON `params`. A search of the installed host/runtime packages also found no `claimedTerminalId` implementation. The upstream host source inspected at commit `fb57e370a` does contain the claimed-terminal plumbing, but that is not the installed runtime.

The unsupported field was therefore removed from the new-terminal `openPanel` call. It remains only in the typed existing-panel replacement path; no SDK/host patch or cast was made. Without a supported installed host API, plugin code cannot honestly prove duplicate suppression for the required new-action path.

A host upgrade is required **only if** the product requirement depends on host-level terminal claiming/deduplication. The upgrade must expose a supported API and matching runtime behavior; this evidence does not authorize a host or SDK patch.

## Source and served artifacts

| Artifact | SHA-256 |
| --- | --- |
| `app.tsx` | `5c836a80827d1b3ce5c7193082ea29dc2af3509fefbc8e85469105fb942018a1` |
| `dist/app.js` | `31cf75910d36780bb0f1ac72da14d840d0f6c7155a4e323e8c2d2ddfd3015f43` |
| Served `/api/v1/plugins/wterm-terminal-preview/assets/app.js` | `25988cf55b1134794eccd1b43a67c7aa74f1d5c485531ea0bdbd6e2214480251` |
| `package.json` | `13fa31f930e82bcc0989267d14f43f0e41c2e82c8d13a4a53b0450db264d3dda` |
| `package-lock.json` | `963043d802c67054ce610c37f060e53d6db62a4d7ddf282c0b6e9d8798e159c6` |
| `.logs/wterm-a4b-13-1-browser.png` | `6d0e6c83c654632bb93f48b5f7983c5e3f1783784ee459250500a3541394c385` |

The source and served hashes differ. The served bundle was fetched with the required user agent and contained the session action and `experimental_primarySurface`, but did not contain the new-open claim expression. This is an artifact-correlation warning, not proof of a runtime duplicate.

## Commands and exits

Receipts from the bounded run:

```text
node -e "console.log(require('./package.json').scripts)"
exit 0

npm test -- --run terminal-open-policy.test.ts wterm-open-count.test.ts session-terminal-composer.test.ts
exit 0 — 3 files, 23 tests passed

npm run typecheck
exit 0 — tsc --noEmit

npm test
exit 0 — 14 files, 122 tests passed

npm run build
exit 0 — bb plugin build and asset copy completed

BB_SERVER_URL=http://127.0.0.1:38896 BB_HOST_DAEMON_PORT=38897 bb terminal close term_awbd68j8tk --if-clean --json
exit 0 — PTY exited; lastUserInputAt=null

git diff --check
exit 0

git status --porcelain=v1
exit 0 — staged files: 0; transferred dirty worktree preserved
```

Browser open/inspection/error probes completed with exit 0 and reported no page errors. The following probes remain UNKNOWN rather than PASS: isolated thread creation, thread new-action versus native terminal ownership, composer-existing-action reveal, zero-PTY composer reveal, and duplicate suppression in those paths.

## Acceptance report

```acceptance-report
{
  "bead": "wterm-a4b.13.1",
  "owner": "SwiftLynx",
  "verdict": "INCOMPLETE_BLOCKED",
  "prior_observation": {
    "classification": "real_but_path_limited",
    "path": "existing-thread sidebar Open new tab then Wterm terminal",
    "visible_wterm_tabs": 1,
    "ptys": 1,
    "pty_id": "term_awbd68j8tk",
    "thread_id": "thr_e3hica6ujn",
    "isolated_thread_created": false
  },
  "required_scenarios": {
    "isolated_thread_new_action_vs_existing_native": "UNKNOWN",
    "composer_existing_action": "UNKNOWN",
    "composer_reveal_zero_ptys": "UNKNOWN",
    "duplicate_suppression_required_path": "UNKNOWN",
    "scenario_counts": {"sidebar_smoke": 1, "isolated_new_action": 0, "composer_existing_action": 0}
  },
  "host": {
    "bb_app": "0.42.1",
    "plugin_sdk": "0.4.47",
    "supported_claim_api_installed": false,
    "experimental_claimedTerminalId_in_installed_sdk": false,
    "host_upgrade_required": "only_if_host_terminal_claiming_is_required",
    "host_or_sdk_patched": false
  },
  "artifacts": {
    "screenshot": ".logs/wterm-a4b-13-1-browser.png",
    "screenshot_sha256": "6d0e6c83c654632bb93f48b5f7983c5e3f1783784ee459250500a3541394c385",
    "source_app_sha256": "5c836a80827d1b3ce5c7193082ea29dc2af3509fefbc8e85469105fb942018a1",
    "dist_app_sha256": "31cf75910d36780bb0f1ac72da14d840d0f6c7155a4e323e8c2d2ddfd3015f43",
    "served_app_sha256": "25988cf55b1134794eccd1b43a67c7aa74f1d5c485531ea0bdbd6e2214480251"
  },
  "cleanup": {"command_exit": 0, "last_user_input_at": null, "status": "exited"},
  "verification": {"focused_tests": "23 passed", "full_tests": "122 passed", "typecheck_exit": 0, "build_exit": 0, "staged_files": 0},
  "next_requirement": "Rerun the isolated-thread and composer probes after BB/SDK exposes a supported terminal-claim API; do not infer PASS from the sidebar smoke."
}
```
