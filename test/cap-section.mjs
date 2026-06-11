// Capture page sections for a Claude-powered guided audit, + per-element a11y metadata.
import { captureElement } from "../dist/visual.js";
import { CDP } from "../dist/cdp.js";
import fs from "node:fs";

const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
for (const [sel, out] of [
  ["#images", "/tmp/sec-images.png"],
  ["#forms", "/tmp/sec-forms.png"],
  ["#interactive", "/tmp/sec-interactive.png"],
]) {
  try {
    const r = await captureElement(endpoint, sel, "a11y-test-page");
    fs.writeFileSync(out, Buffer.from(r.base64, "base64"));
    console.log("saved", out, JSON.stringify(r.meta.tag));
  } catch (e) {
    console.log("fail", sel, e.message);
  }
}
const cdp = await CDP.connect(endpoint);
const page = (await cdp.targets()).find((t) => t.type === "page" && /a11y-test-page/.test(t.url));
const s = await cdp.attach(page.targetId);
const meta = await cdp.evalIn(
  s,
  `(()=>{
    const imgs=[...document.querySelectorAll('#images img')].map((e,i)=>({i:i+1, hasAlt:e.hasAttribute('alt'), alt:e.getAttribute('alt')}));
    const fields=[...document.querySelectorAll('#forms input,#forms select')].map(e=>({tag:e.tagName.toLowerCase(),type:e.type||null,id:e.id||null,
      labelled: !!(e.id&&document.querySelector('label[for="'+e.id+'"]')) || !!(e.closest&&e.closest('label')),
      placeholder:e.getAttribute('placeholder')||null}));
    const inter=[...document.querySelectorAll('#interactive *')].filter(e=>e.onclick||e.tagName==='BUTTON'||e.tagName==='A'||e.getAttribute('role')==='button').map(e=>({tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),tabindex:e.getAttribute('tabindex'),text:(e.textContent||'').trim().slice(0,24),href:e.getAttribute('href')}));
    return JSON.stringify({imgs, fields, inter});
  })()`
);
console.log("META:", meta);
cdp.close();
process.exit(0);
