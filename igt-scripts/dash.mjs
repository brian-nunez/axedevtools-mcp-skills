// Scrape the IGT dashboard: overall % + per-category Runs/issues. Screenshot too.
//   node dash.mjs [/tmp/dash.png]
import { cdp, panelTarget, feShot } from "./igt-lib.mjs";

const shotPath = process.argv[2] || "/tmp/igt-dash.png";
const api = await cdp();
const p = await panelTarget(api);
if (!p) { console.log("no panel target"); process.exit(1); }
const s = await api.attach(p.targetId);
const out = await api.evalIn(
  s,
  `(()=>{
    const body=(document.body?document.body.innerText:'').replace(/[\\u00a0]/g,' ').replace(/\\s+/g,' ');
    const prog=body.match(/Intelligent Guided Testing \\d+% complete/);
    const igt=body.match(/Intelligent Guided Tests[\\s\\S]{0,1200}/);
    const auto=body.match(/Automatic Testing \\d+% complete/);
    return JSON.stringify({auto:auto?auto[0]:null, prog:prog?prog[0]:null, igt:igt?igt[0].slice(0,1100):null});
  })()`
);
const d = JSON.parse(out);
console.log(d.auto || "(automatic % not visible)");
console.log(d.prog || "(IGT % not visible — is the panel on the test Overview?)");
console.log("---");
console.log(d.igt || "(category cards not visible)");
await api.detach(s);
await feShot(api, shotPath);
console.log("shot ->", shotPath);
api.close();
process.exit(0);
