// End-to-end smoke test: attaches to a browser on $AXE_CDP_ENDPOINT (default :9222)
// and runs axe against the first open http(s)/file tab. No panel (structured only).
import { scan } from "../dist/scanner.js";

const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
const res = await scan({
  cdpEndpoint: endpoint,
  tags: ["wcag2a", "wcag2aa", "best-practice"],
  showPanel: false,
});

console.log("Scanned:", res.url);
console.log("Totals :", JSON.stringify(res.totals));
for (const v of res.violations) {
  console.log(`  - [${v.impact}] ${v.id}: ${v.help} — ${v.nodes.length} node(s)`);
}
