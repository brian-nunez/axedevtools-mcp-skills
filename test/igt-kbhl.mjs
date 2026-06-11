// For each given Keyboard-review element number: click its "Highlight element"
// button in the panel (expands/locates the element on the page), then screenshot
// the PAGE so vision can see exactly which control is flagged.
//   node igt-kbhl.mjs 1 2 3 9
import fs from "node:fs";
import { execSync } from "node:child_process";
import { cdp, sleep, panelTarget, DEEP } from "./igt-lib.mjs";

const nums = process.argv.slice(2).map(Number);
const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);

const page = (await api.targets()).find((t) => t.type === "page" && /dequeuniversity/.test(t.url));
const ps = await api.attach(page.targetId);
await api.send("Page.enable", {}, ps).catch(() => {});

for (const n of nums) {
  const r = await api.evalIn(
    s,
    `(()=>{${DEEP}
      const A=e=>e.getAttribute('aria-label')||'';
      const b=deep('button,[role=button]',document,[]).find(e=>A(e).startsWith('Highlight element Element ${n}.'));
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
  const path = `/tmp/kb-el-${n}.png`;
  fs.writeFileSync(path, Buffer.from(data, "base64"));
  try { execSync(`sips -Z 1300 ${JSON.stringify(path)} >/dev/null 2>&1`); } catch {}
  console.log(`  -> ${path}`);
}
await api.detach(ps);
await api.detach(s);
api.close();
process.exit(0);
