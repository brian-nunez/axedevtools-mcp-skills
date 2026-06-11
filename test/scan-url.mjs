// Launch BrowserOS with the axe extension, open a URL, drive a full-page scan
// through the real axe DevTools panel. Writes results to a JSON file (buffer-proof)
// and screenshots the panel. Has a hard timeout so it always terminates.
import { startBrowser, waitForCdp } from "../dist/browser.js";
import { panelScan } from "../dist/panel.js";
import { CDP } from "../dist/cdp.js";
import fs from "node:fs";

const url = process.argv[2] || "https://www.amazon.com";
const OUT = process.env.AXE_OUT || "/tmp/axe-scan.json";
const SHOT = process.env.AXE_SHOT || "/tmp/axe-scan.png";

const hardTimeout = setTimeout(() => {
  try {
    fs.writeFileSync(OUT, JSON.stringify({ error: "hard timeout (180s)" }));
  } catch {}
  process.exit(2);
}, 180000);

async function main() {
  const info = startBrowser({ url, port: 9222 });
  console.log("launched pid", info.pid, "->", url);
  await waitForCdp(info.endpoint, 30000);
  await new Promise((r) => setTimeout(r, 7000)); // heavy page + DevTools settle

  const res = await panelScan({ endpoint: info.endpoint, scanType: "full", timeoutMs: 90000 });
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  console.log("wrote", OUT);

  try {
    const cdp = await CDP.connect(info.endpoint);
    const panel = (await cdp.targets()).find((t) => /lhdoppoj.*panel\.html/.test(t.url));
    if (panel) {
      const s = await cdp.attach(panel.targetId);
      await cdp.send("Page.enable", {}, s).catch(() => {});
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, s);
      fs.writeFileSync(SHOT, Buffer.from(data, "base64"));
      console.log("wrote", SHOT);
    }
    cdp.close();
  } catch (e) {
    console.log("screenshot skipped:", e?.message);
  }
}

main()
  .then(() => {
    clearTimeout(hardTimeout);
    process.exit(0);
  })
  .catch((e) => {
    try {
      fs.writeFileSync(OUT, JSON.stringify({ error: String((e && e.message) || e) }, null, 2));
    } catch {}
    clearTimeout(hardTimeout);
    process.exit(1);
  });
