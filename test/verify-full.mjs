// Verify the COMPLETE self-contained lifecycle through the shipped code:
// startBrowser() (browser.ts) -> waitForCdp() -> panelScan() (panel.ts).
import { startBrowser, waitForCdp } from "../dist/browser.js";
import { panelScan } from "../dist/panel.js";

const url = process.argv[2] || "file:///Users/chandu/github/axe-mcp/test/bad-page.html";
const info = startBrowser({ url, port: 9222 });
console.log("started:", JSON.stringify(info));
const up = await waitForCdp(info.endpoint, 30000);
console.log("cdpReady:", up);
await new Promise((r) => setTimeout(r, 4000)); // let DevTools + extension settle
const res = await panelScan({ endpoint: info.endpoint, scanType: "full", timeoutMs: 45000 });
console.log(JSON.stringify({ testUrl: res.testUrl, axeVersion: res.axeVersion, totals: res.totals, issueCount: res.issues.length }, null, 2));
