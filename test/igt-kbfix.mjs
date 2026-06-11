// Flip Keyboard-review verdicts: for each element number given, expand its card
// (trusted click on the "Element N of 169" header), then trusted-click the
// "Mark as passed: <rule>. Element N. ..." button. Verifies the flip.
//   node igt-kbfix.mjs 1 2 3 ... 15
import { cdp, sleep, panelTarget, DEEP } from "./igt-lib.mjs";

const nums = process.argv.slice(2).map(Number);
const RULE = "Function cannot be performed by keyboard alone";

const api = await cdp();
const p = await panelTarget(api);
const s = await api.attach(p.targetId);
const T = `const A=e=>e.getAttribute('aria-label')||'';const T=e=>(A(e)||e.textContent||'').replace(/\\s+/g,' ').trim();`;

async function trustedClickAt(x, y) {
  await api.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, s);
  await sleep(50);
  await api.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, s);
  await sleep(40);
  await api.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, s);
}
async function measure(expr) {
  const r = await api.evalIn(s, `(()=>{${DEEP}${T}
    const el=${expr};
    if(!el) return null;
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    if(r.width<2&&r.height<2) return JSON.stringify({hidden:true});
    return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), label:T(el).slice(0,70)});
  })()`);
  return r ? JSON.parse(r) : null;
}
async function clickExpr(expr, what) {
  let m = await measure(expr);
  if (!m || m.hidden) return false;
  await sleep(300);
  m = (await measure(expr)) || m;
  if (m.hidden) return false;
  await trustedClickAt(m.x, m.y);
  console.log(`  clicked ${what} @ (${m.x},${m.y})`);
  return true;
}

for (const n of nums) {
  console.log(`element ${n}:`);
  const markBtn = `deep('button,[role=button]',document,[]).find(e=>A(e).startsWith('Mark as passed: ${RULE}. Element ${n}.'))`;
  // try direct (card may already be expanded)
  let ok = await clickExpr(markBtn, `Mark-as-passed[${n}]`);
  if (!ok) {
    // expand the card via its header, then retry
    const header = `deep('button,[role=button],[aria-expanded]',document,[]).find(e=>T(e).startsWith('Element ${n} of '))`;
    await clickExpr(header, `header[${n}]`);
    await sleep(600);
    ok = await clickExpr(markBtn, `Mark-as-passed[${n}] (after expand)`);
  }
  if (!ok) { console.log(`  !! could not click for element ${n}`); continue; }
  await sleep(700);
  // verify: the mark-as-passed button for this rule should be GONE (now shows Mark as failed)
  const still = await api.evalIn(s, `(()=>{${DEEP}${T}
    return deep('button,[role=button]',document,[]).some(e=>A(e).startsWith('Mark as passed: ${RULE}. Element ${n}.'))?'still-failed':'flipped';
  })()`);
  console.log(`  verify: ${still}`);
}

// final tally
const tally = await api.evalIn(s, `(()=>{${DEEP}${T}
  const f=deep('button,[role=button]',document,[]).filter(e=>A(e).startsWith('Mark as passed: ')).length;
  return 'remaining mark-as-passed buttons (failed rules): '+f;
})()`);
console.log(tally);
await api.detach(s);
api.close();
process.exit(0);
