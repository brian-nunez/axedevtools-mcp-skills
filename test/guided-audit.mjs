// Claude-powered guided audit of the inspected page: capture the page (viewport +
// full) and enumerate per-category elements with a11y metadata for vision judgment.
import { capturePage, captureElement } from "../dist/visual.js";
import { CDP } from "../dist/cdp.js";
import fs from "node:fs";

const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
const urlContains = process.argv[2] || "dequeuniversity.com/demo/mars";

for (const [full, out] of [[false, "/tmp/mars-page.png"], [true, "/tmp/mars-full.png"]]) {
  try {
    const p = await capturePage(endpoint, full, urlContains);
    fs.writeFileSync(out, Buffer.from(p.base64, "base64"));
    console.log("saved", out);
  } catch (e) {
    console.log("page capture fail", out, e.message);
  }
}

const cdp = await CDP.connect(endpoint);
const page = (await cdp.targets()).find((t) => t.type === "page" && t.url.includes(urlContains));
const s = await cdp.attach(page.targetId);
const data = await cdp.evalIn(
  s,
  `(()=>{
    const vis=el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1;};
    let k=0;
    const imgs=[...document.querySelectorAll('img')].filter(vis).map(e=>{e.setAttribute('data-axe-i',k++);const r=e.getBoundingClientRect();
      return {i:+e.getAttribute('data-axe-i'),hasAlt:e.hasAttribute('alt'),alt:e.getAttribute('alt'),w:Math.round(r.width),h:Math.round(r.height),file:(e.currentSrc||e.src||'').split('/').pop().split('?')[0].slice(0,36)};});
    const fields=[...document.querySelectorAll('input,select,textarea')].filter(vis).map(e=>({tag:e.tagName.toLowerCase(),type:e.type||null,
      name:e.name||e.id||null, labelled: !!(e.id&&document.querySelector('label[for="'+CSS.escape(e.id)+'"]'))||!!(e.closest&&e.closest('label'))||!!e.getAttribute('aria-label')||!!e.getAttribute('aria-labelledby'),
      placeholder:e.getAttribute('placeholder')||null, title:e.getAttribute('title')||null}));
    const emptyLinks=[...document.querySelectorAll('a')].filter(vis).filter(a=>!(a.textContent||'').trim()&&!a.getAttribute('aria-label')).map(a=>({hasImg:!!a.querySelector('img'),imgAlt:a.querySelector('img')?a.querySelector('img').getAttribute('alt'):null,href:(a.getAttribute('href')||'').slice(0,40)}));
    const unnamedBtns=[...document.querySelectorAll('button,[role=button]')].filter(vis).filter(b=>!(b.textContent||'').trim()&&!b.getAttribute('aria-label')&&!b.getAttribute('title')).map(b=>({class:(b.className||'').toString().slice(0,40)}));
    const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h=>h.tagName+': '+(h.textContent||'').replace(/\\s+/g,' ').trim().slice(0,46));
    const landmarks=['header','nav','main','footer','[role=banner]','[role=navigation]','[role=main]','[role=contentinfo]'].filter(sel=>document.querySelector(sel));
    const tables=[...document.querySelectorAll('table')].map(t=>({hasTh:!!t.querySelector('th'),hasCaption:!!t.querySelector('caption'),rows:t.rows.length}));
    return JSON.stringify({imgCount:imgs.length,imgs,fields,emptyLinks:emptyLinks.slice(0,14),unnamedBtns,headings,landmarks,tables});
  })()`
);
console.log("META:", data);

// capture each non-trivial image individually for close inspection
const meta = JSON.parse(data);
let saved = 0;
for (const im of meta.imgs) {
  if (im.w < 24 || im.h < 24 || saved >= 12) continue;
  try {
    const r = await captureElement(endpoint, `[data-axe-i="${im.i}"]`, urlContains);
    fs.writeFileSync(`/tmp/mars-img-${im.i}.png`, Buffer.from(r.base64, "base64"));
    saved++;
  } catch (e) {}
}
console.log("element images saved:", saved);
cdp.close();
process.exit(0);
