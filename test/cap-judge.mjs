// Download the actual image files for the needs-vision items (bypasses carousel
// rendering) so Claude can judge each against its alt text.
import { CDP } from "../dist/cdp.js";
import fs from "node:fs";
const cdp = await CDP.connect(process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222");
const page = (await cdp.targets()).find((t) => t.url.includes("dequeuniversity.com/demo/mars"));
const s = await cdp.attach(page.targetId);
for (const sel of process.argv.slice(2)) {
  const info = await cdp.evalIn(s, `(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e)return null; return JSON.stringify({src:e.currentSrc||e.src, alt:e.getAttribute('alt')});})()`);
  if (!info) { console.log(sel, "not found"); continue; }
  const { src, alt } = JSON.parse(info);
  const id = sel.replace(/\D/g, "");
  const ext = (src.split(".").pop().split("?")[0] || "png").toLowerCase();
  try {
    const res = await fetch(src);
    fs.writeFileSync(`/tmp/mj-${id}.${ext}`, Buffer.from(await res.arrayBuffer()));
    console.log(`${sel}  alt=${JSON.stringify(alt)}  file=${src.split("/").pop()}  -> /tmp/mj-${id}.${ext}`);
  } catch (e) { console.log(sel, "download fail", e.message); }
}
cdp.close();
process.exit(0);
