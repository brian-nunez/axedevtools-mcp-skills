// Flip review verdicts (Keyboard/Interactive lists): expand each element's card
// (trusted-click the "Element N of M" header), then trusted-click its
// "Mark as passed: <rule>. Element N." (or "Mark as failed:") button. Verifies.
//   node igt-flip.mjs --to passed --rule "Function cannot be performed by keyboard alone" 1 2 3
//   node igt-flip.mjs --to failed --rule "Focus indicator is missing" 7
import { cdp, sleep, panelTarget, clickExpr } from "./igt-lib.mjs";

const argv = process.argv.slice(2);
const to = argv[argv.indexOf("--to") + 1] || "passed";
const rule = argv[argv.indexOf("--rule") + 1] || "Function cannot be performed by keyboard alone";
const nums = argv.filter((a) => /^\d+$/.test(a)).map(Number);
if (!nums.length) { console.log("usage: igt-flip.mjs --to passed|failed --rule '<rule>' <n> [n...]"); process.exit(1); }

const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);
const T = `const A=e=>e.getAttribute('aria-label')||'';const T=e=>(A(e)||e.textContent||'').replace(/\\s+/g,' ').trim();`;

for (const n of nums) {
  console.log(`element ${n}:`);
  const markBtn = `(()=>{${T}return deep('button,[role=button]',document,[]).find(e=>A(e).startsWith('Mark as ${to}: ${rule}. ') && / Element ${n}\\./.test(' '+A(e)));})()`;
  let ok = await clickExpr(api, s, markBtn, `Mark-as-${to}[${n}]`);
  if (!ok) {
    const header = `(()=>{${T}return deep('button,[role=button],[aria-expanded]',document,[]).find(e=>T(e).startsWith('Element ${n} of '));})()`;
    await clickExpr(api, s, header, `header[${n}]`);
    await sleep(600);
    ok = await clickExpr(api, s, markBtn, `Mark-as-${to}[${n}] (after expand)`);
  }
  if (!ok) { console.log(`  !! could not click for element ${n}`); continue; }
  await sleep(900);
  // the mark click triggers a panel re-render that can kill in-flight evals — tolerate it
  const still = await api.evalIn(s, `(()=>{${T}
    return deep('button,[role=button]',document,[]).some(e=>A(e).startsWith('Mark as ${to}: ${rule}. ') && / Element ${n}\\./.test(' '+A(e)))?'NOT flipped':'flipped';
  })()`).catch(() => "verify-skipped (panel re-rendered)");
  console.log(`  verify: ${still}`);
}
const tally = await api.evalIn(s, `(()=>{${T}
  const f=deep('button,[role=button]',document,[]).filter(e=>A(e).startsWith('Mark as passed: ')).length;
  return 'remaining failed rules (mark-as-passed buttons): '+f;
})()`).catch(() => "tally unavailable");
console.log(tally);
await api.detach(s);
api.close();
process.exit(0);
