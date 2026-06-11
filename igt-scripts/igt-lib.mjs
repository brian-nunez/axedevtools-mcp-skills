// Shared CDP helpers for driving the axe DevTools panel + IGT wizards.
// Design rules baked in from hard-won debugging:
//  - MINIMAL attachment residency: attach to panel.html only for seconds at a time,
//    never sit attached to the inspected page during IGT analysis.
//  - ALL wizard interactions use TRUSTED input (Input.dispatch*) on the PANEL
//    target's own session — synthetic dispatchEvent clicks carry no user
//    activation and the IGT pipeline silently stalls at "Running axe".
//  - Page keyboard tests need Emulation.setFocusEmulationEnabled + type:'keyDown'
//    (rawKeyDown performs NO default actions: Tab/arrows silently dead).
import fs from "node:fs";

export const ENDPOINT = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222"; // 127.0.0.1, never localhost (IPv6 ECONNREFUSED)
export const DEEP =
  "function deep(sel,root,acc){try{root.querySelectorAll(sel).forEach(e=>acc.push(e))}catch(_){}" +
  "for(const e of root.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;}";

export async function cdp(endpoint = ENDPOINT) {
  const ver = await (await fetch(endpoint + "/json/version")).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws error")); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const msg = { id: ++id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      pending.set(msg.id, { resolve, reject });
      ws.send(JSON.stringify(msg));
    });
  return {
    send,
    targets: async () => { await send("Target.setDiscoverTargets", { discover: true }); return (await send("Target.getTargets")).targetInfos; },
    attach: async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId,
    detach: (sessionId) => send("Target.detachFromTarget", { sessionId }).catch(() => {}),
    evalIn: async (s, expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "eval failed");
      return r.result?.value;
    },
    close: () => { try { ws.close(); } catch {} },
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attach to FE(s), show the axe panel via InspectorFrontendAPI.showPanel, detach. */
export async function showAxePanel(api) {
  for (let i = 0; i < 30; i++) {
    for (const fe of (await api.targets()).filter((t) => /devtools_app\.html/.test(t.url))) {
      const s = await api.attach(fe.targetId);
      const pid = await api
        .evalIn(s, `(()=>{const k=Object.keys((globalThis.UI&&globalThis.UI.panels)||{}).find(k=>/axe/i.test(k));return k||null;})()`)
        .catch(() => null);
      if (pid) {
        await api.evalIn(s, `(()=>{try{InspectorFrontendAPI.showPanel(${JSON.stringify(pid)})}catch(e){}})()`).catch(() => {});
        await api.detach(s);
        return true;
      }
      await api.detach(s);
    }
    await sleep(500);
  }
  return false;
}

/** The axe extension's panel.html target (instantiates only after showPanel). */
export async function panelTarget(api) {
  for (let i = 0; i < 25; i++) {
    const p = (await api.targets()).find((t) => /lhdoppoj.*panel\.html/.test(t.url));
    if (p) return p;
    await sleep(300);
  }
  return null;
}

/** The inspected page target. AXE_PAGE_MATCH narrows by URL substring. */
export async function pageTarget(api, match = process.env.AXE_PAGE_MATCH) {
  for (let i = 0; i < 15; i++) {
    const pages = (await api.targets()).filter((t) => t.type === "page" && /^https?:/.test(t.url));
    const p = match ? pages.find((t) => t.url.includes(match)) : pages[0];
    if (p) return p;
    await sleep(400);
  }
  return null;
}

/** Trusted, user-activation-carrying click at session-local CSS coords. */
export async function trustedClickAt(api, s, x, y) {
  await api.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, s);
  await sleep(60);
  await api.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, s);
  await sleep(50);
  await api.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, s);
}

/** Trusted key WITH default actions (focus traversal, radio arrows, Enter). */
export async function trustedKey(api, s, k, code) {
  const vk = code ?? { Tab: 9, Enter: 13, Escape: 27, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }[k] ?? 0;
  await api.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, text: k === "Enter" ? "\r" : undefined }, s);
  await api.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, s);
}

/** scrollIntoView + measure an element (by JS expression) → {x,y,label} or null/hidden. */
export async function measureExpr(api, s, expr) {
  const r = await api.evalIn(s, `(()=>{${DEEP}
    const T=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();
    const el=${expr};
    if(!el) return null;
    el.scrollIntoView&&el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    if(r.width<2&&r.height<2) return JSON.stringify({hidden:true});
    return JSON.stringify({x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), label:T(el).slice(0,80)});
  })()`);
  return r ? JSON.parse(r) : null;
}

/** Re-measure after scroll settles, then trusted-click. Returns false if not found/hidden. */
export async function clickExpr(api, s, expr, what = "target") {
  let m = await measureExpr(api, s, expr);
  if (!m || m.hidden) return false;
  await sleep(350);
  m = (await measureExpr(api, s, expr)) || m;
  if (m.hidden) return false;
  await trustedClickAt(api, s, m.x, m.y);
  console.log(`trusted-clicked ${what} @ (${m.x},${m.y}) "${m.label || ""}"`);
  return true;
}

/** Scrape the wizard's current state (headings, radios, checks, buttons, text). */
export function stateExpr() {
  return `(()=>{${DEEP}
    const t=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();
    const heads=deep('h1,h2,h3,h4,[role=heading],legend',document,[]).map(t).filter(Boolean);
    const radios=deep('[role=radio],input[type=radio]',document,[]).map((e,i)=>{
      let c=e; for(let k=0;k<5&&c&&t(c).length<3;k++)c=c.parentElement;
      return {i, checked: !!(e.checked||e.getAttribute('aria-checked')==='true'), label:t(c).slice(0,160)};
    });
    const checks=deep('[role=checkbox],input[type=checkbox]',document,[]).map((e,i)=>{
      let c=e; for(let k=0;k<5&&c&&t(c).length<3;k++)c=c.parentElement;
      return {i, checked: !!(e.checked||e.getAttribute('aria-checked')==='true'), label:t(c).slice(0,140)};});
    const btns=[...new Set(deep('button,[role=button]',document,[]).map(t).filter(Boolean))];
    const body=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    return JSON.stringify({
      heads:heads.slice(0,8), radios, checks:checks.slice(0,30), btns:btns.slice(0,25),
      analyzing:/analyzing your page|capturing screenshots|running axe|loading intelligent|AI is analyzing|don.t interact|Optimizing your test/i.test(body),
      text:body.slice(0,650)});
  })()`;
}

/** One-shot: attach panel, eval state, detach. */
export async function panelState(api) {
  const p = await panelTarget(api);
  if (!p) return null;
  const s = await api.attach(p.targetId);
  const out = await api.evalIn(s, stateExpr()).catch((e) => JSON.stringify({ error: e.message }));
  await api.detach(s);
  return JSON.parse(out);
}

/** Screenshot the DevTools front-end (whole axe panel). Downscales for vision input. */
export async function feShot(api, path) {
  const fe = (await api.targets()).find((t) => /devtools_app\.html/.test(t.url));
  if (!fe) return false;
  const s = await api.attach(fe.targetId);
  await api.send("Page.enable", {}, s).catch(() => {});
  const { data } = await api.send("Page.captureScreenshot", { format: "png" }, s);
  fs.writeFileSync(path, Buffer.from(data, "base64"));
  await api.detach(s);
  try { (await import("node:child_process")).execSync(`sips -Z 1400 ${JSON.stringify(path)} >/dev/null 2>&1`); } catch {}
  return true;
}

/** Screenshot the inspected PAGE (top-level target only; panel iframes can't). */
export async function pageShot(api, path, scrollToSelector) {
  const p = await pageTarget(api);
  if (!p) return false;
  const s = await api.attach(p.targetId);
  await api.send("Page.enable", {}, s).catch(() => {});
  if (scrollToSelector) {
    await api.evalIn(s, `(()=>{const e=document.querySelector(${JSON.stringify(scrollToSelector)});e&&e.scrollIntoView({block:'center'});})()`).catch(() => {});
    await sleep(600);
  }
  const { data } = await api.send("Page.captureScreenshot", { format: "png" }, s);
  fs.writeFileSync(path, Buffer.from(data, "base64"));
  await api.detach(s);
  try { (await import("node:child_process")).execSync(`sips -Z 1300 ${JSON.stringify(path)} >/dev/null 2>&1`); } catch {}
  return true;
}
