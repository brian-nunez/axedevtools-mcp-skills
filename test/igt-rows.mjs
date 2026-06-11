// Scrape the step-4 review rows: per image -> Name / Types / element+overlapping
// text / current Yes-No selection / row scroll offset (for targeted screenshots).
import { cdp, panelTarget, DEEP } from "./igt-lib.mjs";

const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);

const out = await api.evalIn(
  s,
  `(()=>{${DEEP}
    const T=e=>((e&&e.textContent)||'').replace(/\\s+/g,' ').trim();
    const radios=deep('[role=radio],input[type=radio]',document,[]);
    const rows=[];
    // a row = the nearest ancestor that contains exactly one radio PAIR
    const seen=new Set();
    for(let i=0;i<radios.length;i+=2){
      let el=radios[i];
      while(el && deep('[role=radio],input[type=radio]',el,[]).length<2) el=el.parentElement;
      // keep climbing until the container holds the row's fields too (Name/thumbnail),
      // but stop before swallowing multiple radio pairs (the whole list)
      while(el && el.parentElement && deep('[role=radio],input[type=radio]',el.parentElement,[]).length<=2 && T(el).length<60) el=el.parentElement;
      if(!el||seen.has(el)) continue; seen.add(el);
      const txt=T(el);
      const yes=radios[i], no=radios[i+1];
      const yesOn=!!(yes.checked||yes.getAttribute('aria-checked')==='true');
      const noOn=!!(no.checked||no.getAttribute('aria-checked')==='true');
      const r=el.getBoundingClientRect();
      const sc=deep('.panel-content,[class*=panel-content]',document,[])[0]||document.scrollingElement;
      rows.push({row:rows.length, yesIdx:i, noIdx:i+1, current: yesOn?'YES':(noOn?'NO':'-'),
        raw: txt.slice(0,210),
        offsetY: Math.round(r.top + (sc?sc.scrollTop:0))});
    }
    return JSON.stringify({count:rows.length, rows});
  })()`
);
const d = JSON.parse(out);
console.log("rows:", d.count);
for (const r of d.rows) {
  console.log(`#${String(r.row).padStart(2)} [${r.current}] y=${r.offsetY} :: ${r.raw}`);
}
await api.detach(s);
api.close();
process.exit(0);
