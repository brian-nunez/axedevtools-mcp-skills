// Run a form-submit experiment on a THROWAWAY duplicate tab so the IGT tab never
// navigates. Answers the Forms wizard's "submit blank / bad data — error shown?"
// questions empirically.
//   node throwaway-submit.mjs <url> --click "#fs-submit" [--fill "#from0=@@bad@@"]...
import { cdp, sleep, trustedClickAt } from "./igt-lib.mjs";

const argv = process.argv.slice(2);
const url = argv[0];
const clickSel = argv[argv.indexOf("--click") + 1];
const fills = argv.flatMap((a, i) => (a === "--fill" ? [argv[i + 1]] : []));
if (!url || !clickSel) { console.log("usage: throwaway-submit.mjs <url> --click '<css>' [--fill 'sel=value']..."); process.exit(1); }

const api = await cdp();
const created = await api.send("Target.createTarget", { url });
await sleep(6000);
const s = await api.attach(created.targetId);
await api.send("Page.enable", {}, s).catch(() => {});

for (const f of fills) {
  const eq = f.indexOf("=");
  const sel = f.slice(0, eq), val = f.slice(eq + 1);
  await api.evalIn(s, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'nf';
    e.value=${JSON.stringify(val)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`)
    .then((v) => console.log(`fill ${sel} = ${v}`));
}
const box = await api.evalIn(s, `(()=>{const b=document.querySelector(${JSON.stringify(clickSel)});if(!b)return null;
  b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();
  return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
if (!box) { console.log("submit selector not found"); process.exit(1); }
const { x, y } = JSON.parse(box);
await sleep(300);
await trustedClickAt(api, s, x, y);
console.log("clicked", clickSel);
await sleep(2500);

const post = await api
  .evalIn(s, `(()=>{
    const T=e=>((e&&e.textContent)||'').replace(/\\s+/g,' ').trim();
    const errs=[...document.querySelectorAll('[class*=error],[id*=error],[role=alert],.alert,[aria-invalid=true]')]
      .map(e=>({vis:getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0, txt:T(e).slice(0,80)}))
      .filter(e=>e.txt);
    return JSON.stringify({url:location.href.slice(0,100), errors:errs.slice(0,8)}, null, 1);
  })()`)
  .catch((e) => "EVAL FAILED — page likely NAVIGATED on submit (no client-side validation): " + e.message);
console.log("result:", post);
await api.send("Target.closeTarget", { targetId: created.targetId }).catch(() => {});
api.close();
console.log("(throwaway tab closed)");
process.exit(0);
