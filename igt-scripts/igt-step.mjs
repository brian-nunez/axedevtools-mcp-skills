// Stepwise IGT Q&A driver — ALL interactions are TRUSTED input on the panel
// target session (the IGT requires real user activation; synthetic events stall it).
// Modes:
//   node igt-step.mjs                      -> dump current question + screenshot
//   node igt-step.mjs --radio <i>          -> trusted-click radio i, then Next, dump
//   node igt-step.mjs --radio-only <i...>  -> batch radio clicks, NO Next (corrections)
//   node igt-step.mjs --check <i>          -> trusted-click checkbox i, dump (no Next)
//   node igt-step.mjs --button "<regex>"   -> trusted-click matching button, dump
//   node igt-step.mjs --scroll <y>         -> scroll the wizard's inner scrollable
import { cdp, sleep, panelTarget, feShot, stateExpr, DEEP, clickExpr } from "./igt-lib.mjs";

const argv = process.argv.slice(2);
const mode = argv[0] || "--dump";
const arg = argv[1];

const api = await cdp();
const p = await panelTarget(api);
if (!p) { console.log("no panel target"); process.exit(1); }
const s = await api.attach(p.targetId);
const T = `const T=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();`;

const nth = (sel, i) => `(()=>{${T}return deep(${JSON.stringify(sel)},document,[])[${i}]||null;})()`;
const byText = (re) => `(()=>{${T}return deep('button,[role=button]',document,[]).find(e=>new RegExp(${JSON.stringify(re)},'i').test(T(e)));})()`;

if (mode === "--radio") {
  await clickExpr(api, s, nth("[role=radio],input[type=radio]", parseInt(arg, 10)), `radio[${arg}]`);
  await sleep(800);
  await clickExpr(api, s, byText("^(next|continue)"), "Next");
} else if (mode === "--radio-only") {
  for (const idx of argv.slice(1)) {
    await clickExpr(api, s, nth("[role=radio],input[type=radio]", parseInt(idx, 10)), `radio[${idx}]`);
    await sleep(400);
  }
} else if (mode === "--check") {
  await clickExpr(api, s, nth("[role=checkbox],input[type=checkbox]", parseInt(arg, 10)), `checkbox[${arg}]`);
} else if (mode === "--button") {
  await clickExpr(api, s, byText(arg), `button(${arg})`);
} else if (mode === "--scroll") {
  const r = await api.evalIn(
    s,
    `(()=>{${DEEP}
      const cands=deep('*',document,[]).filter(e=>e.scrollHeight>e.clientHeight+40 && e.clientHeight>150);
      cands.sort((a,b)=>b.clientHeight-a.clientHeight);
      const sc=cands[0]||document.scrollingElement;
      sc.scrollTop=${parseInt(arg, 10)};
      return JSON.stringify({scrolledTo:sc.scrollTop, max:sc.scrollHeight-sc.clientHeight});
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
