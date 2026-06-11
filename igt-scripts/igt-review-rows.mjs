// Keyboard/Interactive-style review-list scraper. Per-element verdicts are
// encoded in button aria-labels:
//   "Mark as passed: <rule>. Element N. <desc>"  => rule currently FAILED on N
//   "Mark as failed: <rule>. Element N. <desc>"  => rule currently passed on N
//   "Edit result [Interactive] Element N. <desc>" => element identity (IE list)
// Prints every element with status + failed rules.
import { cdp, panelTarget, DEEP } from "./igt-lib.mjs";

const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);

const out = await api.evalIn(
  s,
  `(()=>{${DEEP}
    const A=e=>e.getAttribute('aria-label')||'';
    const T=e=>((e&&e.textContent)||'').replace(/\\s+/g,' ').trim();
    const els={};
    for(const b of deep('button,[role=button]',document,[])){
      const a=A(b);
      let m=a.match(/^Mark as (passed|failed): (.+?)\\. (?:Interactive )?Element (\\d+)\\.?\\s*(.*)$/);
      if(m){
        const n=+m[3];
        els[n]=els[n]||{n, desc:'', failedRules:[], passedRules:[]};
        if(m[1]==='passed') els[n].failedRules.push(m[2]); else els[n].passedRules.push(m[2]);
        if(m[4] && m[4].length>els[n].desc.length) els[n].desc=m[4].replace(/\\n/g,' ');
        continue;
      }
      m=a.match(/^(?:Highlight|Inspect) element (?:Interactive )?Element (\\d+)\\.?\\s*(.*)$/) ||
        a.match(/^Edit result (?:Interactive )?Element (\\d+)\\.?\\s*(.*)$/);
      if(m){
        const n=+m[1];
        els[n]=els[n]||{n, desc:'', failedRules:[], passedRules:[]};
        if(m[2] && m[2].length>els[n].desc.length) els[n].desc=m[2].replace(/\\n/g,' ');
      }
    }
    // statuses from "Element N of M" headers
    for(const h of deep('h1,h2,h3,h4,[role=heading],div,span,button',document,[])){
      const m=T(h).match(/^Element (\\d+) of \\d+\\s*,?\\s*(Passed|Failed|Pending)$/i);
      if(m && els[+m[1]] && !els[+m[1]].status) els[+m[1]].status=m[2];
    }
    const list=Object.values(els).sort((a,b)=>a.n-b.n);
    return JSON.stringify({total:list.length, list});
  })()`
);
const d = JSON.parse(out);
console.log("elements:", d.total);
for (const e of d.list) {
  const st = e.status || (e.failedRules.length ? "Failed" : "?");
  console.log(`#${String(e.n).padStart(3)} [${st}] ${e.desc.slice(0, 80)}${e.failedRules.length ? "  FAILS: " + e.failedRules.join(" | ") : ""}`);
}
await api.detach(s);
api.close();
process.exit(0);
