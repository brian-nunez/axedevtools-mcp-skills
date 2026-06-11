// Screenshot the DevTools front-end (top-level target) showing the axe panel.
import { CDP } from "../dist/cdp.js";
import fs from "node:fs";

const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
const out = process.argv[2] || "/tmp/axe-amazon-panel.png";
const cdp = await CDP.connect(endpoint);
const fe = (await cdp.targets()).find((t) => /devtools_app\.html/.test(t.url));
if (!fe) {
  console.log("no DevTools front-end target");
  process.exit(0);
}
const s = await cdp.attach(fe.targetId);
await cdp.send("Page.enable", {}, s).catch(() => {});
const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, s);
fs.writeFileSync(out, Buffer.from(data, "base64"));
console.log("saved", out);
cdp.close();
process.exit(0);
