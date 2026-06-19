# Troubleshooting — every failure observed live, with root cause and fix

Each of these cost real debugging time once. Check here BEFORE re-deriving.

| Symptom | Root cause | Fix |
|---|---|---|
| IGT stalls forever at "Running axe" / capture | Clicks were synthetic (`dispatchEvent`) — no **user activation**; the pipeline silently requires it | Trusted CDP `Input.dispatchMouseEvent` on the **panel target's own session** (all axe-mcp tools do this). NOT auth (backend returns 200s), NOT a chrome.debugger conflict (attach succeeds mid-stall) — both disproven |
| Trusted click "hits" but Start doesn't react | panel.html is an OOPIF — clicking through the DevTools front-end at iframe-offset coords misses | Dispatch on the PANEL session at panel-local coords; re-measure after `scrollIntoView`; verify state changed, retry |
| `ECONNREFUSED ::1:9222` | `localhost` resolves IPv6; debug port is IPv4-only | Always `http://127.0.0.1:9222` |
| Extension, login, panel, or prepared page is missing after init | Initialization did not complete its contract | Do not launch or configure a browser manually. Preserve output, perform final cleanup if the tool is available, and report the blocker |
| `showPanel` alternatives all fail | DevTools chrome ignores synthetic events; trusted input doesn't route to docked FE menus | `InspectorFrontendAPI.showPanel(id)` with the id from `UI.panels` — the ONLY reliable way |
| Scan button not found | Label varies: "Scan full page" / "Full Page Scan" / "Re-run scan" | Order-independent regex (`axe_igt_answer` button "(full|scan)"`) |
| Page keyboard events do nothing (Tab stays on BODY, arrows dead) | Two traps: `rawKeyDown` performs no default actions; unfocused window ⇒ renderer skips default key handling | Use `type:'keyDown'` AND `Emulation.setFocusEmulationEnabled` first (`axe_page_keys` does both) |
| Radio arrows move selection but you concluded "function broken" | You tested while the relevant form was hidden (earlier interaction switched the widget) | Restore state using controls on the existing page; never reload or navigate |
| `Page.captureScreenshot` fails on panel | Only top-level targets can screenshot | Screenshot the DevTools FE (`feShot`) or the page (`pageShot`), never the panel iframe |
| Screenshots rejected by vision tooling | DPR-2 captures exceed input limits | `sips -Z 1300/1400` downscale (baked into the capture tools; harmless if sips absent) |
| Interactive Elements: "There was a problem analyzing", everything Pending | Deque AI back end fails on large batches (168 failed twice; 3 and 33 fine) | Re-select in role-group batches ≤ ~50 and retry; review what analyzed |
| Pressing Next after Back records a 0-issue run | Back resets selection to 0/N and Next at 0 skips silently to results | Always re-select after Back; never Finish a hollow run |
| Wizard "stuck analyzing" per your poll, but text says "Click NEXT to continue" | Over-broad busy regex | Read the text; "Found N fields. Click NEXT" is a WAIT-FOR-YOU state |
| Label question never appeared for an obviously unlabeled field | The Forms optimizer auto-resolves label association it already knows; missing-label issues surface in results / the automatic scan (`select-name`) | Don't force it; verify the issue shows in results or automatic findings |
| Highlight overlay not found in DOM probes | The extension's highlight is ephemeral / not a high-z div | Click Highlight then screenshot IMMEDIATELY (`axe_igt_highlight`); read the box from pixels |
| Review-card buttons unclickable (0×0) | Cards are collapsed; aria-labels exist but geometry doesn't | Trusted-click the "Element N of M" header to expand first (`axe_igt_flip` handles) |
| Form submit may navigate the IGT tab away | Submission behavior is unsafe in the prepared session | Do not submit and do not use `axe_form_probe`; mark untested/not applicable when offered and report the limitation |
| Background long-runs swallow output | piping through `head` on a backgrounded scan | Write results to files; use hard timeouts |
| MV3 service worker gone | idles out after ~30s | Don't depend on the SW; drive the panel/page directly |
| Wizard analysis dies if you attach to the page | The IGT's own `chrome.debugger.attach` needs the tab's single debugger slot | Detach EVERYTHING and close the CDP socket during capture/analysis phases |
| "0 runs" on the dashboard after lots of work | Runs only count on Finish (+ Save when offered) | Always Finish → Save → verify `Runs: 1` via `axe_igt_dash` |
| Testing and dashboard capture are complete | The prepared browser and MCP server must not be left running | As the final tool action, call `axe_cleanup_shutdown {confirmIrreversible:true}`; never call another tool afterward |

Container, browser, extension, authentication, target navigation, and MCP wiring
belong to `init.sh`. Do not troubleshoot those layers by launching a browser,
changing endpoints, or running the underlying scripts directly.
