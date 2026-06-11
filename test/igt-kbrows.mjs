// Scrape the Keyboard-IGT review list: per element -> status + which rules are
// currently FAILED (a "Mark as passed: <rule>. Element N. <desc>" button exists
// for each currently-failed rule) + the element description from aria-labels.
import { cdp, panelTarget, DEEP } from "./igt-lib.mjs";

const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);

const out = await api.evalIn(
  s,
  `(()=>{${DEEP}
    const A=e=>e.getAttribute('aria-label')||'';
    const els={};
    for(const b of deep('button,[role=button]',document,[])){
      const a=A(b);
      let m=a.match(/^Mark as (passed|failed): (.+?)\\. Element (\\d+)\\.?\\s*(.*)$/);
      if(m){
        const n=+m[3];
        els[n]=els[n]||{n, desc:'', failedRules:[], passedRules:[]};
        if(m[1]==='passed') els[n].failedRules.push(m[2]); else els[n].passedRules.push(m[2]);
        if(m[4] && m[4].length>els[n].desc.length) els[n].desc=m[4];
        continue;
      }
      m=a.match(/^(Highlight|Inspect) element Element (\\d+)\\.?\\s*(.*)$/);
      if(m){
        const n=+m[2];
        els[n]=els[n]||{n, desc:'', failedRules:[], passedRules:[]};
        if(m[3] && m[3].length>els[n].desc.length) els[n].desc=m[3];
      }
    }
    const list=Object.values(els).sort((a,b)=>a.n-b.n);
    const failed=list.filter(e=>e.failedRules.length);
    return JSON.stringify({total:list.length, failedCount:failed.length, failed}, null, 1);
  })()`
);
console.log(out);
await api.detach(s);
api.close();
process.exit(0);
