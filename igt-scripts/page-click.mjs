// TRUSTED click on a PAGE element — used when a wizard turns on mouse-selection
// mode ("click the label/heading on the page"). Finds by exact text or selector.
//   node page-click.mjs --text "Why MarsCommuter?"
//   node page-click.mjs --selector "#fs-submit"
import { cdp, sleep, pageTarget, trustedClickAt } from "./igt-lib.mjs";

const argv = process.argv.slice(2);
const byText = argv.indexOf("--text");
const bySel = argv.indexOf("--selector");
if (byText < 0 && bySel < 0) { console.log("usage: page-click.mjs --text '<exact text>' | --selector '<css>'"); process.exit(1); }

const api = await cdp();
const page = await pageTarget(api);
if (!page) { console.log("no page target"); process.exit(1); }
const s = await api.attach(page.targetId);

const finder =
  bySel >= 0
    ? `document.querySelector(${JSON.stringify(argv[bySel + 1])})`
    : `(()=>{
        const T=e=>((e&&e.textContent)||'').replace(/\\s+/g,' ').trim();
        const want=${JSON.stringify(argv[byText + 1])};
        const cands=[...document.querySelectorAll('a,span,div,p,label,strong,b,h1,h2,h3,h4,button,li,td,th')].filter(e=>T(e)===want);
        cands.sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length);
        return cands[0]||null;
      })()`;
const m = await api.evalIn(
  s,
  `(()=>{
    const el=${finder};
    if(!el) return null;
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+Math.min(12,r.width/2)), y:Math.round(r.y+r.height/2), tag:el.tagName});
  })()`
);
if (!m) { console.log("NOT FOUND"); process.exit(1); }
const c = JSON.parse(m);
await sleep(350);
await trustedClickAt(api, s, c.x, c.y);
console.log(`trusted-clicked (${c.tag}) @ (${c.x},${c.y})`);
await api.detach(s);
api.close();
process.exit(0);
