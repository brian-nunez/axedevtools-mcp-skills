// Click the wizard's Start/Resume button with TRUSTED input dispatched directly on
// the PANEL target session (panel-local coordinates — no FE offset math), retrying
// with re-measurement and a focus+Enter fallback until the wizard actually advances.
import { cdp, sleep, panelTarget, DEEP } from "./igt-lib.mjs";

const api = await cdp();
const p = await panelTarget(api);
if (!p) { console.log("no panel"); process.exit(1); }
const s = await api.attach(p.targetId);
const T = `const T=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();`;

const bodyText = async () =>
  await api.evalIn(s, `(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,160)`);

const measure = async (re) => {
  const r = await api.evalIn(
    s,
    `(()=>{${DEEP}${T}
      const b=deep('button,[role=button]',document,[]).find(e=>new RegExp(${JSON.stringify(re)},'i').test(T(e)));
      if(!b) return null;
      b.scrollIntoView&&b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), w:Math.round(r.width), label:T(b)});
    })()`
  );
  return r ? JSON.parse(r) : null;
};

const advanced = (t) => /capturing screenshots|analyzing your page|running axe|loading intelligent/i.test(t);

console.log("before:", await bodyText());
let ok = false;
for (let round = 0; round < 5 && !ok; round++) {
  const btn = await measure("^(start|resume testing)$");
  if (!btn) { console.log(`round ${round}: no Start/Resume button visible`); break; }
  await sleep(400); // settle after scrollIntoView
  const fresh = await measure("^(start|resume testing)$"); // re-measure post-scroll
  const { x, y, label } = fresh || btn;
  if (round % 2 === 0) {
    // trusted mouse on the panel session itself, panel-local coords
    await api.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, s);
    await sleep(60);
    await api.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, s);
    await sleep(50);
    await api.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, s);
    console.log(`round ${round}: trusted mouse on panel @ (${x},${y}) "${label}"`);
  } else {
    // focus the button, then trusted Enter on the panel session
    await api.evalIn(s, `(()=>{${DEEP}${T}const b=deep('button,[role=button]',document,[]).find(e=>/^(start|resume testing)$/i.test(T(e)));if(b){b.focus();return 'focused';}return 'no';})()`);
    await api.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, s);
    await api.send("Input.dispatchKeyEvent", { type: "char", text: "\r", key: "Enter" }, s);
    await api.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, s);
    console.log(`round ${round}: focus + trusted Enter "${label}"`);
  }
  await sleep(1800);
  const t = await bodyText();
  console.log(`        body: ${t.slice(0, 110)}`);
  if (advanced(t)) { ok = true; break; }
}
console.log(ok ? ">>> WIZARD ADVANCED — capture/analysis underway." : ">>> still on intro after retries.");
await api.detach(s);
api.close();
process.exit(ok ? 0 : 2);
