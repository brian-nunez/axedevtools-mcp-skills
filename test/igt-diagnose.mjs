// Diagnose WHY the native IGT "analyzing your page…" step stalls: launch the Images
// IGT, click Start, and capture network + console across the panel, the extension's
// background service worker, and the page — so we can see what it's actually waiting on.
import { sleep } from "../dist/cdp.js";

const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
const ver = await (await fetch(endpoint + "/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const net = [];        // network events
const consoleErrs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    return;
  }
  // events
  if (m.method === "Network.requestWillBeSent") net.push({ t: "req", url: m.params.request.url, method: m.params.request.method });
  else if (m.method === "Network.responseReceived") net.push({ t: "res", url: m.params.response.url, status: m.params.response.status });
  else if (m.method === "Network.loadingFailed") net.push({ t: "FAIL", reqId: m.params.requestId, err: m.params.errorText, canceled: m.params.canceled });
  else if (m.method === "Log.entryAdded" && /error|warning/i.test(m.params.entry.level)) consoleErrs.push(`[${m.params.entry.level}] ${m.params.entry.text}`.slice(0, 200));
  else if (m.method === "Runtime.exceptionThrown") consoleErrs.push(`[exception] ${(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 200)}`);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const msg = { id: ++id, method, params }; if (sessionId) msg.sessionId = sessionId;
  pending.set(msg.id, { resolve, reject }); ws.send(JSON.stringify(msg));
});
const targets = async () => { await send("Target.setDiscoverTargets", { discover: true }); return (await send("Target.getTargets")).targetInfos; };
async function attach(targetId) { const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }); return sessionId; }
async function instrument(sessionId) {
  await send("Network.enable", {}, sessionId).catch(() => {});
  await send("Log.enable", {}, sessionId).catch(() => {});
  await send("Runtime.enable", {}, sessionId).catch(() => {});
}
const DEEP = "function deep(sel,root,acc){try{root.querySelectorAll(sel).forEach(e=>acc.push(e))}catch(_){}for(const e of root.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;}";
async function evalIn(s, expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, s); return r.exceptionDetails ? { __e: r.exceptionDetails.text } : r.result?.value; }

// instrument page + background SW
const tis = await targets();
const page = tis.find((t) => t.type === "page" && /dequeuniversity/.test(t.url));
const sw = tis.find((t) => t.type === "service_worker" && /lhdoppoj/.test(t.url));
if (page) { const ps = await attach(page.targetId); await instrument(ps); await send("Page.bringToFront", {}, ps).catch(() => {}); console.log("instrumented page"); }
if (sw) { const ss = await attach(sw.targetId); await instrument(ss); console.log("instrumented background SW"); }

// show panel
let feSess = null, axePid = null;
for (let i = 0; i < 30; i++) {
  for (const fe of (await targets()).filter((t) => /devtools_app\.html/.test(t.url))) {
    const s = await attach(fe.targetId);
    const pid = await evalIn(s, `(()=>{const k=Object.keys((globalThis.UI&&globalThis.UI.panels)||{}).find(k=>/axe/i.test(k));return k||null;})()`).catch(() => null);
    if (pid) { feSess = s; axePid = pid; break; }
  }
  if (axePid) break; await sleep(500);
}
await evalIn(feSess, `(()=>{try{InspectorFrontendAPI.showPanel(${JSON.stringify(axePid)})}catch(e){}})()`);
await sleep(2000);
let panel; for (let i = 0; i < 25; i++) { await sleep(300); panel = (await targets()).find((t) => /lhdoppoj.*panel\.html/.test(t.url)); if (panel) break; }
const pSess = await attach(panel.targetId); await instrument(pSess); console.log("instrumented panel");

// launch Images IGT + Start
const launch = await evalIn(pSess, `(async()=>{${DEEP}
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const fire=el=>['mousedown','mouseup','click'].forEach(x=>el.dispatchEvent(new MouseEvent(x,{bubbles:true,cancelable:true,view:window})));
  const list=()=>deep('button,[role=button],a',document,[]); const t=e=>(e.getAttribute('aria-label')||e.textContent||'').trim();
  const sns=list().find(e=>/start new scan/i.test(t(e))); if(sns){fire(sns);await wait(1200);}
  const img=list().find(e=>/^images$/i.test(t(e))); if(!img) return 'no Images launcher'; fire(img); await wait(1500);
  const start=list().find(e=>/^start$/i.test(t(e))); if(start) fire(start); return 'launched+started';
})()`);
console.log("launch:", launch);

// watch for ~80s
for (let i = 0; i < 16; i++) {
  await sleep(5000);
  const txt = await evalIn(pSess, `(document.body?document.body.innerText:'').replace(/\\s+/g,' ').slice(0,90)`);
  const radios = await evalIn(pSess, `(()=>{${DEEP}return deep('[role=radio],input[type=radio]',document,[]).length;})()`);
  console.log(`t+${(i + 1) * 5}s radios=${radios} :: ${txt}`);
  if (radios > 0) { console.log(">>> QUESTION APPEARED — IGT advanced!"); break; }
}

// dump diagnostics
const interesting = net.filter((e) => e.t === "FAIL" || (e.url && !/dequeuniversity\.com\/demo|\.(png|jpe?g|gif|svg|css|woff2?|js)(\?|$)/i.test(e.url)));
console.log("\n=== NETWORK (non-page-asset / failed) ===");
for (const e of interesting.slice(0, 40)) console.log(" ", e.t, e.status || e.err || "", (e.url || "").slice(0, 110), e.method || "");
console.log("\n=== CONSOLE errors/warnings ===");
for (const c of consoleErrs.slice(0, 25)) console.log(" ", c);
console.log(`\n(total net events: ${net.length}, console: ${consoleErrs.length})`);
ws.close();
process.exit(0);
