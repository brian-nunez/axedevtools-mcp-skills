// Stepwise IGT Q&A driver — ALL interactions use TRUSTED input dispatched on the
// panel target session (the IGT requires real user activation; synthetic events stall it).
// Modes:
//   node igt-step.mjs                      -> dump current question + screenshot
//   node igt-step.mjs --radio <i>          -> trusted-click radio i, then Next, dump
//   node igt-step.mjs --check <i>          -> trusted-click checkbox i, dump (no Next)
//   node igt-step.mjs --button "<regex>"   -> trusted-click matching button, dump
//   node igt-step.mjs --scroll <y>         -> scroll panel, screenshot only
import { cdp, sleep, panelTarget, feShot, stateExpr, DEEP } from "./igt-lib.mjs";

const argv = process.argv.slice(2);
const mode = argv[0] || "--dump";
const arg = argv[1];

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
  const r = await api.evalIn(
    s,
    `(()=>{${DEEP}${T}
      const el=${expr};
      if(!el) return null;
      el.scrollIntoView&&el.scrollIntoView({block:'center'});
      const r=el.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), label:T(el).slice(0,80)});
    })()`
  );
  return r ? JSON.parse(r) : null;
}
const nth = (sel, i) => `deep(${JSON.stringify(sel)},document,[])[${i}]`;
const byText = (re) => `deep('button,[role=button]',document,[]).find(e=>new RegExp(${JSON.stringify(re)},'i').test(T(e)))`;

async function clickMeasured(expr, what) {
  let m = await measure(expr);
  if (!m) { console.log(`NO TARGET for ${what}`); return false; }
  await sleep(350);
  m = (await measure(expr)) || m; // re-measure post-scroll
  await trustedClickAt(m.x, m.y);
  console.log(`trusted-clicked ${what} @ (${m.x},${m.y}) "${m.label}"`);
  return true;
}

if (mode === "--radio") {
  await clickMeasured(nth("[role=radio],input[type=radio]", parseInt(arg, 10)), `radio[${arg}]`);
  await sleep(800);
  await clickMeasured(byText("^(next|continue)"), "Next");
} else if (mode === "--radio-only") {
  for (const idx of argv.slice(1)) {
    await clickMeasured(nth("[role=radio],input[type=radio]", parseInt(idx, 10)), `radio[${idx}]`);
    await sleep(400);
  }
} else if (mode === "--check") {
  await clickMeasured(nth("[role=checkbox],input[type=checkbox]", parseInt(arg, 10)), `checkbox[${arg}]`);
} else if (mode === "--button") {
  await clickMeasured(byText(arg), `button(${arg})`);
} else if (mode === "--scroll") {
  const r = await api.evalIn(
    s,
    `(()=>{${DEEP}
      const cands=deep('*',document,[]).filter(e=>e.scrollHeight>e.clientHeight+40 && e.clientHeight>150);
      cands.sort((a,b)=>b.clientHeight-a.clientHeight);
      const sc=cands[0]||document.scrollingElement;
      sc.scrollTop=${parseInt(arg, 10)};
      return JSON.stringify({scrolledTo:sc.scrollTop, max:sc.scrollHeight-sc.clientHeight, el:(sc.className||sc.tagName||'').toString().slice(0,40)});
    })()`
  );
  console.log("scroll:", r);
}

await sleep(1500);
for (let i = 0; i < 30; i++) {
  const st = JSON.parse(await api.evalIn(s, stateExpr()));
  if (!st.analyzing) break;
  if (i === 0) console.log("(re-analyzing — waiting...)");
  await sleep(3000);
}
const st = JSON.parse(await api.evalIn(s, stateExpr()));
await api.detach(s);
await feShot(api, "/tmp/igt-now.png").catch(() => {});
console.log("\n=== STATE ===");
console.log("heads :", JSON.stringify(st.heads));
console.log("radios:", JSON.stringify(st.radios));
if (st.checks.length) console.log("checks:", JSON.stringify(st.checks.slice(0, 28)));
console.log("btns  :", JSON.stringify(st.btns));
console.log("text  :", st.text.slice(0, 500));
console.log("shot -> /tmp/igt-now.png");
api.close();
process.exit(0);
