// Empirical keyboard testing on the PAGE — the tool for refuting/confirming
// "function cannot be performed by keyboard alone" AI verdicts.
// Enables focus emulation (required when the window isn't OS-focused) and sends
// trusted keyDown events (default actions: Tab traversal, radio arrows, Enter).
//   node page-keys.mjs --focus "#widget-controls-fares" ArrowDown ArrowUp
//   node page-keys.mjs --tab-walk 60          -> list focus stops
//   node page-keys.mjs --focus "a.menu" Enter --watch "/regex to grep body for/"
import { cdp, sleep, pageTarget, trustedKey } from "./igt-lib.mjs";

const argv = process.argv.slice(2);
const fIdx = argv.indexOf("--focus");
const wIdx = argv.indexOf("--watch");
const tIdx = argv.indexOf("--tab-walk");
const watch = wIdx >= 0 ? argv[wIdx + 1] : null;
const keys = argv.filter((a, i) => !a.startsWith("--") && i !== fIdx + 1 && i !== wIdx + 1 && i !== tIdx + 1);

const api = await cdp();
const page = await pageTarget(api);
if (!page) { console.log("no page target"); process.exit(1); }
const s = await api.attach(page.targetId);
await api.send("Emulation.setFocusEmulationEnabled", { enabled: true }, s);

const snap = async (tag) => {
  const r = await api.evalIn(s, `(()=>{
    const e=document.activeElement;
    const body=document.body.innerText;
    return JSON.stringify({active:e?(e.id||e.name||e.tagName)+(e.type?':'+e.type:''):'none',
      checked:e&&e.type==='radio'?e.checked:undefined,
      watch:${watch ? `${watch}.test(body)` : "undefined"}});
  })()`);
  const d = JSON.parse(r);
  d.tag = tag;
  console.log(JSON.stringify(d));
};

if (tIdx >= 0) {
  const n = parseInt(argv[tIdx + 1] || "40", 10);
  await api.evalIn(s, `(()=>{document.activeElement&&document.activeElement.blur();window.scrollTo(0,0);})()`);
  for (let i = 0; i < n; i++) {
    await trustedKey(api, s, "Tab");
    const a = await api.evalIn(s, `(()=>{const e=document.activeElement;return e?(e.tagName||'')+(e.type?':'+e.type:'')+(e.id?'#'+e.id:'')+' "'+((e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,28))+'"':'none'})()`);
    console.log(`${i + 1}: ${a}`);
  }
} else {
  if (fIdx >= 0) {
    await api.evalIn(s, `(()=>{const e=document.querySelector(${JSON.stringify(argv[fIdx + 1])});if(e)e.focus();return !!e;})()`)
      .then((ok) => console.log("focused:", ok));
  }
  await snap("before");
  for (const k of keys) {
    await trustedKey(api, s, k);
    await sleep(900);
    await snap(`after ${k}`);
  }
}
await api.detach(s);
api.close();
process.exit(0);
