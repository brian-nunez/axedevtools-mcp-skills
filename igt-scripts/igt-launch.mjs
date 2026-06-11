// Launch an IGT category on an ALREADY-RUNNING browser/panel (dashboard or
// panel home). Trusted-clicks the category card's green "+" (IconButton--primary)
// or the category title, then Start/Resume Testing, detaches for analysis, polls.
//   node igt-launch.mjs "Table" [handoffSeconds]
import { execSync } from "node:child_process";
import { cdp, sleep, panelTarget, panelState, feShot, stateExpr, clickExpr, measureExpr, trustedClickAt } from "./igt-lib.mjs";

const category = process.argv[2] || "Images";
const HANDSOFF_S = parseInt(process.argv[3] || process.env.IGT_HANDSOFF || "40", 10);

const api = await cdp();
const p = await panelTarget(api);
if (!p) { console.log("no panel target — run launch.mjs first"); process.exit(1); }
const s = await api.attach(p.targetId);
const T = `const T=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();`;

// 1. category card: green "+" inside the smallest container starting with the
//    category name (saved-test dashboard), else exact-text element (panel home).
const catExpr = `(()=>{${T}
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
if (!(await clickExpr(api, s, catExpr, `category "${category}"`))) {
  console.log("FATAL: category element not found");
  const st = JSON.parse(await api.evalIn(s, stateExpr()));
  console.log("btns:", JSON.stringify(st.btns));
  process.exit(1);
}

// 2. Start / Resume Testing (intro screen), verify the click took
const startExpr = `(()=>{${T}return deep('button,[role=button]',document,[]).find(e=>/^(start|resume testing)$/i.test(T(e)));})()`;
let started = false;
for (let round = 0; round < 18 && !started; round++) {
  await sleep(1300);
  const m = await measureExpr(api, s, startExpr);
  if (!m || m.hidden) continue;
  await sleep(300);
  const m2 = (await measureExpr(api, s, startExpr)) || m;
  await trustedClickAt(api, s, m2.x, m2.y);
  console.log(`trusted-clicked Start @ (${m2.x},${m2.y})`);
  await sleep(1800);
  const st = JSON.parse(await api.evalIn(s, stateExpr()));
  if (st.analyzing || !(await measureExpr(api, s, startExpr))) { started = true; break; }
  console.log("start click didn't take, retrying…");
}
if (!started) { console.log("FATAL: never got past Start"); process.exit(2); }

await api.detach(s);
api.close(); // nothing attached during capture/analysis — the IGT needs the debugger slot

try { execSync(`open -a ${JSON.stringify(process.env.AXE_BROWSER_APP || "Google Chrome")}`); } catch {}
console.log(`hands-off ${HANDSOFF_S}s for capture/analysis…`);
await sleep(HANDSOFF_S * 1000);

for (let i = 0; i < 30; i++) {
  const api2 = await cdp();
  const st = await panelState(api2);
  if (st) {
    console.log(`poll ${i}: analyzing=${st.analyzing} radios=${st.radios.length} checks=${st.checks.length} :: ${st.text.slice(0, 110)}`);
    if (!st.analyzing && (st.radios.length || st.checks.length || /select|which|what|does|is th|review|found/i.test(st.text))) {
      await feShot(api2, "/tmp/igt-now.png").catch(() => {});
      console.log("\n>>> WIZARD READY:");
      console.log(JSON.stringify({ heads: st.heads, radios: st.radios.slice(0, 12), checks: st.checks.slice(0, 12), btns: st.btns }, null, 1).slice(0, 2400));
      console.log("text:", st.text.slice(0, 480));
      console.log("shot -> /tmp/igt-now.png");
      api2.close();
      process.exit(0);
    }
  } else console.log(`poll ${i}: no panel`);
  api2.close();
  await sleep(12000);
}
console.log("RESULT: still analyzing after polls — re-poll with igt-step.mjs --dump");
process.exit(2);
