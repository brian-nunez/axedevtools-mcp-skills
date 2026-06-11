// Runs a real scan WITH the panel injected, then reconnects and screenshots the
// page so we can see the injected panel. Panel persists as in-page DOM after the
// scan disconnects.
import { chromium } from "playwright-core";
import { scan } from "../dist/scanner.js";

const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";

const res = await scan({
  cdpEndpoint: endpoint,
  tags: ["wcag2a", "wcag2aa", "best-practice"],
  showPanel: true,
});
console.log(
  `panelInjected: ${res.panelInjected} | rules: ${res.totals.rulesViolated} | elements: ${res.totals.elementsAffected}`
);

const browser = await chromium.connectOverCDP(endpoint);
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => /^(https?|file):/.test(p.url()));
if (!page) {
  console.error("no page to screenshot");
  process.exit(1);
}
await page.screenshot({ path: "/tmp/axe-panel.png" });
await browser.close();
console.log("screenshot -> /tmp/axe-panel.png");
