# Troubleshooting — every failure observed live, with root cause and fix

Each of these cost real debugging time once. Check here BEFORE re-deriving.

| Symptom | Root cause | Fix |
|---|---|---|
| IGT stalls forever at "Running axe" / capture | Clicks were synthetic (`dispatchEvent`) — no **user activation**; the pipeline silently requires it | Trusted CDP `Input.dispatchMouseEvent` on the **panel target's own session** (all axe-mcp tools do this). NOT auth (backend returns 200s), NOT a chrome.debugger conflict (attach succeeds mid-stall) — both disproven |
| Trusted click "hits" but Start doesn't react | panel.html is an OOPIF — clicking through the DevTools front-end at iframe-offset coords misses | Dispatch on the PANEL session at panel-local coords; re-measure after `scrollIntoView`; verify state changed, retry |
| `ECONNREFUSED ::1:9222` | `localhost` resolves IPv6; debug port is IPv4-only | Always `http://127.0.0.1:9222` |
| Extension never loads (no axe panel) on Chrome 137+ | Chrome stable ignores `--load-extension` | Add `--disable-features=DisableLoadExtensionCommandLineSwitch` (`axe_browser_start` does) |
| `zsh: no matches found: --remote-allow-origins=*` | zsh glob expansion | Quote the flag in shells; spawn argv is literal |
| Panel never found / two DevTools windows | Fresh profile opens the extension's onboarding tab → second DevTools FE | Close `deque.com|install-success` tabs; poll EVERY FE until the axe panel registers (`axe_browser_start` does) |
| `showPanel` alternatives all fail | DevTools chrome ignores synthetic events; trusted input doesn't route to docked FE menus | `InspectorFrontendAPI.showPanel(id)` with the id from `UI.panels` — the ONLY reliable way |
| Scan button not found | Label varies: "Scan full page" / "Full Page Scan" / "Re-run scan" | Order-independent regex (`axe_igt_answer` button "(full|scan)"`) |
| Page keyboard events do nothing (Tab stays on BODY, arrows dead) | Two traps: `rawKeyDown` performs no default actions; unfocused window ⇒ renderer skips default key handling | Use `type:'keyDown'` AND `Emulation.setFocusEmulationEnabled` first (`axe_page_keys` does both) |
| Radio arrows move selection but you concluded "function broken" | You tested while the relevant form was hidden (earlier interaction switched the widget) | Reload to a known state before keyboard experiments; re-run |
| `Page.captureScreenshot` fails on panel | Only top-level targets can screenshot | Screenshot the DevTools FE (`feShot`) or the page (`pageShot`), never the panel iframe |
| Screenshots rejected by vision tooling | DPR-2 captures exceed input limits | `sips -Z 1300/1400` downscale (baked into the capture tools; harmless if sips absent) |
| Interactive Elements: "There was a problem analyzing", everything Pending | Deque AI back end fails on large batches (168 failed twice; 3 and 33 fine) | Re-select in role-group batches ≤ ~50 and retry; review what analyzed |
| Pressing Next after Back records a 0-issue run | Back resets selection to 0/N and Next at 0 skips silently to results | Always re-select after Back; never Finish a hollow run |
| Wizard "stuck analyzing" per your poll, but text says "Click NEXT to continue" | Over-broad busy regex | Read the text; "Found N fields. Click NEXT" is a WAIT-FOR-YOU state |
| Label question never appeared for an obviously unlabeled field | The Forms optimizer auto-resolves label association it already knows; missing-label issues surface in results / the automatic scan (`select-name`) | Don't force it; verify the issue shows in results or automatic findings |
| Highlight overlay not found in DOM probes | The extension's highlight is ephemeral / not a high-z div | Click Highlight then screenshot IMMEDIATELY (`axe_igt_highlight`); read the box from pixels |
| Review-card buttons unclickable (0×0) | Cards are collapsed; aria-labels exist but geometry doesn't | Trusted-click the "Element N of M" header to expand first (`axe_igt_flip` handles) |
| Form submit navigates the IGT tab away | The demo form has zero validation; submit = navigation | NEVER submit on the IGT tab — `axe_form_probe` uses a disposable tab |
| Background long-runs swallow output | piping through `head` on a backgrounded scan | Write results to files; use hard timeouts |
| MV3 service worker gone | idles out after ~30s | Don't depend on the SW; drive the panel/page directly |
| Wizard analysis dies if you attach to the page | The IGT's own `chrome.debugger.attach` needs the tab's single debugger slot | Detach EVERYTHING and close the CDP socket during capture/analysis phases |
| "0 runs" on the dashboard after lots of work | Runs only count on Finish (+ Save when offered) | Always Finish → Save → verify `Runs: 1` via `axe_igt_dash` |

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `AXE_CDP_ENDPOINT` | `http://127.0.0.1:9222` | where the browser's debug port is |
| `AXE_PAGE_MATCH` | (first http(s) page) | URL substring to pick the inspected page |
| `AXE_BROWSER_PATH` | Google Chrome.app binary | browser to launch |
| `AXE_BROWSER_APP` | `Google Chrome` | app name for `open -a` foregrounding (macOS) |
| `AXE_PROFILE_DIR` | `~/.axe-mcp-chrome-igt` | profile (holds the axe Pro trial state) |
| `AXE_EXT_DIR` | (auto-discovered) | unpacked axe extension dir override |
| `AXE_CDP_PORT` | `9222` | debug port for `axe_browser_start` |
| `AXE_EXTRA_ARGS` | — | `\|\|`-separated extra browser flags |
| `AXE_IGT_SCRIPTS_DIR` | `<axe-mcp>/igt-scripts` | where the mechanic scripts live (MCP resolves automatically) |
