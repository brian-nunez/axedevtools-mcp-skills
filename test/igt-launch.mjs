// In-place IGT category launcher for an ALREADY-RUNNING browser/panel.
// Trusted-clicks the category card on the dashboard, then Start/Resume Testing,
// then detaches fully for the analysis phase and polls until a question appears.
//   node igt-launch.mjs "Table" [handoffSeconds]
import { execSync } from "node:child_process";
import { cdp, sleep, panelTarget, panelState, feShot, stateExpr, DEEP } from "./igt-lib.mjs";

const category = process.argv[2] || "Table";
const HANDSOFF_S = parseInt(process.argv[3] || process.env.IGT_HANDSOFF || "45", 10);

const api = await cdp();
const p = await panelTarget(api);
if (!p) { console.log("no panel target"); process.exit(1); }
const s = await api.attach(p.targetId);
const T = `const T=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();`;

async function trustedClickAt(x, y) {
  await api.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, s);
  await sleep(60);
  await api.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, s);
  await sleep(50);
  await api.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, s);
}
async function measure(expr) {
  const r = await api.evalIn(s, `(()=>{${DEEP}${T}
    const el=${expr};
    if(!el) return null;
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), label:T(el).slice(0,80)});
  })()`);
  return r ? JSON.parse(r) : null;
}
async function clickMeasured(expr, what) {
  let m = await measure(expr);
  if (!m) return false;
  await sleep(400);
  m = (await measure(expr)) || m;
  await trustedClickAt(m.x, m.y);
  console.log(`trusted-clicked ${what} @ (${m.x},${m.y}) "${m.label}"`);
  return true;
}

// 1. the category card's green "+" (IconButton--primary) — the new-run launcher.
//    Fallback: the exact-text title element (panel initial screen layout).
const catExpr = `(()=>{
  const want=${JSON.stringify(category)}.toLowerCase();
  const cards=deep('div,li,section',document,[])
    .filter(e=>T(e).toLowerCase().startsWith(want) && T(e).length<120);
  cards.sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length);
  for(const c of cards){
    const plus=deep('button',c,[]).find(b=>/IconButton--primary/.test((b.className||'')+''));
    if(plus) return plus;
  }
  const all=deep('button,[role=button],a,h1,h2,h3,h4,div,span,p',document,[])
    .filter(e=>T(e).toLowerCase()===want);
  all.sort((a,b)=>(a.textContent||'').length-(b.textContent||'').length);
  return all[0]||null;
})()`;
if (!(await clickMeasured(catExpr, `category "${category}"`))) {
  console.log("FATAL: category element not found");
  const st = JSON.parse(await api.evalIn(s, stateExpr()));
  console.log("btns:", JSON.stringify(st.btns));
  process.exit(1);
}

// 2. wait for Start / Resume Testing on the intro screen, trusted-click it
const startExpr = `deep('button,[role=button]',document,[]).find(e=>/^(start|resume testing)$/i.test(T(e)))`;
let started = false;
for (let round = 0; round < 18 && !started; round++) {
  await sleep(1300);
  const m = await measure(startExpr);
  if (!m) continue;
  await sleep(300);
  const m2 = (await measure(startExpr)) || m;
  await trustedClickAt(m2.x, m2.y);
  console.log(`trusted-clicked Start @ (${m2.x},${m2.y}) "${m2.label}"`);
  // verify it took: button gone or analyzing text appears
  await sleep(1800);
  const st = JSON.parse(await api.evalIn(s, stateExpr()));
  if (st.analyzing || !(await measure(startExpr))) { started = true; break; }
  console.log("start click didn't take, retrying…");
}
if (!started) { console.log("FATAL: never got past Start"); process.exit(2); }

await api.detach(s);
api.close(); // nothing attached during analysis

try { execSync(`open -a "Google Chrome"`); } catch {}
console.log(`hands-off ${HANDSOFF_S}s for capture/analysis…`);
await sleep(HANDSOFF_S * 1000);

for (let i = 0; i < 25; i++) {
  const api2 = await cdp();
  const st = await panelState(api2);
  if (st) {
    console.log(`poll ${i}: analyzing=${st.analyzing} radios=${st.radios.length} checks=${st.checks.length} :: ${st.text.slice(0, 110)}`);
    if (!st.analyzing && (st.radios.length || st.checks.length || /select|which|what|does|is th|review/i.test(st.text))) {
      await feShot(api2, "/tmp/igt-now.png").catch(() => {});
      console.log("\n>>> WIZARD READY:");
      console.log(JSON.stringify({ heads: st.heads, radios: st.radios.slice(0, 12), checks: st.checks.slice(0, 12), btns: st.btns }, null, 1).slice(0, 2400));
      console.log("text:", st.text.slice(0, 480));
      api2.close();
      process.exit(0);
    }
  } else console.log(`poll ${i}: no panel`);
  api2.close();
  await sleep(12000);
}
console.log("RESULT: still analyzing after polls");
process.exit(2);
