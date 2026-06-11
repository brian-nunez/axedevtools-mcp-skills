// Shared helpers for driving the axe DevTools IGT wizard over CDP with MINIMAL
// attachment residency: never attach to the inspected page; attach to panel.html
// only for seconds at a time, so the IGT's own chrome.debugger.attach (which needs
// the tab's single debugger slot) is never blocked by us.
import fs from "node:fs";

export const ENDPOINT = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
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

/** Attach to FE(s), show the axe panel, detach. Returns true if shown. */
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

export async function panelTarget(api) {
  for (let i = 0; i < 25; i++) {
    const p = (await api.targets()).find((t) => /lhdoppoj.*panel\.html/.test(t.url));
    if (p) return p;
    await sleep(300);
  }
  return null;
}

/** Scrape the wizard's current state (question, options, buttons). */
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
      analyzing:/analyzing your page|capturing screenshots|running axe|loading intelligent/i.test(body),
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

/** Screenshot the DevTools front-end (shows the whole axe panel) to a file. */
export async function feShot(api, path) {
  const fe = (await api.targets()).find((t) => /devtools_app\.html/.test(t.url));
  if (!fe) return false;
  const s = await api.attach(fe.targetId);
  await api.send("Page.enable", {}, s).catch(() => {});
  const { data } = await api.send("Page.captureScreenshot", { format: "png" }, s);
  fs.writeFileSync(path, Buffer.from(data, "base64"));
  await api.detach(s);
  // downscale below 2000px so vision tools can read it (DPR-2 captures exceed it)
  try { (await import("node:child_process")).execSync(`sips -Z 1400 ${JSON.stringify(path)} >/dev/null 2>&1`); } catch {}
  return true;
}
