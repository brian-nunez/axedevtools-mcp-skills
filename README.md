# axe-mcp

An MCP server that **drives Deque's real axe DevTools browser extension** through the DevTools UI over the Chrome DevTools Protocol — it shows the extension's panel, clicks **Scan**, and returns the panel's *own* results (totals by impact + the per-issue list) as structured data to Claude.

This is the actual extension (axe DevTools 4.x, the panel running axe-core under the hood), **not** a re-implementation. A secondary axe-core/Playwright path is also included (see the end).

## How it works

DevTools panels and the panel iframe aren't reachable through normal page automation, so axe-mcp talks raw CDP:

1. Attach to the page's **DevTools front-end** target (`devtools://…/devtools_app.html`).
2. Read the axe panel's id from `UI.panels` and call **`InspectorFrontendAPI.showPanel(panelId)`** — the host→frontend bridge. This reliably opens the panel with no menus, coordinates, or docking hacks (those all fail: DevTools ignores synthetic events and the overflow menu/command-menu don't expose it).
3. Attach to the extension's **`panel.html`** target once it instantiates.
4. Click the panel's **Scan** button (the panel honors programmatic clicks).
5. Poll and scrape the panel's rendered results.

## Requirements

- **BrowserOS** (or Chrome/Edge) with the **axe DevTools** extension installed (id `lhdoppojpmngadmnindnejefpokejbdd`). axe-mcp finds the installed extension on disk and loads it.
- Node 18+ (built/tested on Node 25).

## Install & build

```bash
cd axe-mcp
npm install
npm run build
```

## Register with Claude Code

```bash
claude mcp add axe-mcp -- node /Users/chandu/github/axe-mcp/dist/index.js
```

…or in `.mcp.json`:

```json
{
  "mcpServers": {
    "axe-mcp": { "command": "node", "args": ["/Users/chandu/github/axe-mcp/dist/index.js"] }
  }
}
```

## Tools

| Tool | What it does |
|---|---|
| `axe_browser_start` | Launch BrowserOS (or Chrome/Edge) with the axe extension loaded, DevTools auto-opening, and a CDP endpoint. Args: `url`, `port` (default 9222). Uses a dedicated profile (`~/.axe-mcp-browser`) so it won't disturb your everyday browser. |
| `axe_panel_scan` | Drive the real axe panel: show it, click Scan, return results. Args: `navigateTo`, `scanType` (`full`/`partial`), `cdpEndpoint`, `timeoutMs`. |
| `axe_browser_stop` | Stop the browser started by `axe_browser_start`. |

### Typical flow

> "Start the axe browser on https://example.com, then run axe_panel_scan."

`axe_browser_start({ url: "https://example.com" })` → `axe_panel_scan({})`.

You can also attach to **any** browser you launched yourself with the extension plus
`--remote-debugging-port=9222 --remote-allow-origins=* --auto-open-devtools-for-tabs`,
by passing that `cdpEndpoint` to `axe_panel_scan`.

### Result shape

```json
{
  "engine": "axe DevTools extension panel (Deque)",
  "axeVersion": "4.11.4",
  "standard": "WCAG 2.1 AA",
  "bestPractices": false,
  "testUrl": "https://example.com/",
  "totals": { "total": 6, "critical": 3, "serious": 3, "moderate": 0, "minor": 0, "automatic": 6, "guided": 0, "manual": 0 },
  "issues": [
    { "title": "Buttons must have discernible text", "description": "Ensure buttons have discernible text", "elementsAffected": 1 }
  ]
}
```

> Note: the panel defaults to **WCAG 2.1 AA with Best Practices OFF**, so its totals can be lower than a raw `axe.run()` with best-practice rules enabled — that's the panel's configuration, faithfully reported.

## Gotchas baked into the code

- **`127.0.0.1`, not `localhost`** — Chrome's debug port is IPv4-only; `localhost` resolves to `::1` → `ECONNREFUSED`.
- **`--remote-allow-origins=*`** is required (Chrome 111+) for non-browser CDP clients; passed as discrete argv so the shell can't glob it.
- **Showing the panel:** synthetic clicks on DevTools chrome are ignored, trusted Input doesn't route to a *docked* front-end, the overflow menu's DOM is elusive, and there's no command-menu entry — so `InspectorFrontendAPI.showPanel()` is the one robust method.
- **Onboarding tab:** a fresh profile pops the extension's `install-success` tab (a second DevTools FE); the scanner closes it and polls every front-end until the axe panel registers.

## Smoke test

```bash
node test/verify-full.mjs                 # startBrowser -> panelScan, fresh profile
node test/verify-tool.mjs                 # panelScan against a running browser on :9222
```

`test/bad-page.html` intentionally trips 6 WCAG rules (missing alt, empty button/link, low contrast, missing `lang`, unlabeled input).

## Secondary: axe-core / Playwright path

`src/scanner.ts` (tools not registered by default) runs **axe-core via `@axe-core/playwright`** attached over CDP and injects an in-page results panel. Use it for headless, CSP-proof structured results when you don't need the actual extension UI. Tests: `test/smoke.mjs`, `test/panel-shot.mjs`.
