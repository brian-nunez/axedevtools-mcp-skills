// For each review-list element number: click its "Highlight element" button in
// the panel, then screenshot the PAGE so vision can see exactly which control
// is flagged. Highlights are ephemeral — shoot immediately.
//   node igt-highlight.mjs 1 2 9      -> /tmp/igt-el-1.png etc.
import fs from "node:fs";
import { execSync } from "node:child_process";
import { cdp, sleep, panelTarget, pageTarget, DEEP } from "./igt-lib.mjs";

const nums = process.argv.slice(2).map(Number);
const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);
const page = await pageTarget(api);
if (!page) { console.log("no page target"); process.exit(1); }
const ps = await api.attach(page.targetId);
await api.send("Page.enable", {}, ps).catch(() => {});

for (const n of nums) {
  const r = await api.evalIn(
    s,
    `(()=>{${DEEP}
      const A=e=>e.getAttribute('aria-label')||'';
      const b=deep('button,[role=button]',document,[]).find(e=>/^Highlight element (Interactive )?Element ${n}\\./.test(A(e)));
      if(!b) return 'notfound';
      b.scrollIntoView({block:'center'});
      ['mousedown','mouseup','click'].forEach(x=>b.dispatchEvent(new MouseEvent(x,{bubbles:true,cancelable:true,view:window})));
      try{b.click()}catch(e){}
      return 'clicked: '+A(b).slice(0,90);
    })()`
  );
  console.log(`el ${n}: ${r}`);
  await sleep(900);
  const { data } = await api.send("Page.captureScreenshot", { format: "png" }, ps);
  const path = `/tmp/igt-el-${n}.png`;
  fs.writeFileSync(path, Buffer.from(data, "base64"));
  try { execSync(`sips -Z 1300 ${JSON.stringify(path)} >/dev/null 2>&1`); } catch {}
  console.log(`  -> ${path}`);
}
await api.detach(ps);
await api.detach(s);
api.close();
process.exit(0);
