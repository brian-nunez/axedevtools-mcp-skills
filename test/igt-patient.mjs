// One patient, clean attempt to actually COMPLETE a native IGT: no Network
// instrumentation (avoids ERR_CACHE_MISS), tab foregrounded, wait up to 210s,
// and report whether it advances to questions / increments the run count.
import { sleep } from "../dist/cdp.js";
const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
const which = process.argv[2] || "Images";
const ver = await (await fetch(endpoint + "/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const msg = { id: ++id, method, params }; if (sessionId) msg.sessionId = sessionId; pending.set(msg.id, { resolve, reject }); ws.send(JSON.stringify(msg)); });
const targets = async () => { await send("Target.setDiscoverTargets", { discover: true }); return (await send("Target.getTargets")).targetInfos; };
const attach = async (t) => (await send("Target.attachToTarget", { targetId: t, flatten: true })).sessionId;
const evalIn = async (s, e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }, s); await send("Runtime.enable", {}, s).catch(()=>{}); return r.exceptionDetails ? null : r.result?.value; };
const DEEP = "function deep(sel,root,acc){try{root.querySelectorAll(sel).forEach(e=>acc.push(e))}catch(_){}for(const e of root.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;}";

const tis = await targets();
const page = tis.find((t) => t.type === "page" && /dequeuniversity/.test(t.url));
if (page) { const ps = await attach(page.targetId); await send("Page.enable", {}, ps).catch(()=>{}); await send("Page.bringToFront", {}, ps).catch(()=>{}); }

let feSess = null, axePid = null;
for (let i = 0; i < 30; i++) { for (const fe of (await targets()).filter((t) => /devtools_app\.html/.test(t.url))) { const s = await attach(fe.targetId); const pid = await evalIn(s, `(()=>{const k=Object.keys((globalThis.UI&&globalThis.UI.panels)||{}).find(k=>/axe/i.test(k));return k||null;})()`); if (pid) { feSess = s; axePid = pid; break; } } if (axePid) break; await sleep(500); }
await evalIn(feSess, `(()=>{try{InspectorFrontendAPI.showPanel(${JSON.stringify(axePid)})}catch(e){}})()`);
await sleep(2000);
let panel; for (let i = 0; i < 25; i++) { await sleep(300); panel = (await targets()).find((t) => /lhdoppoj.*panel\.html/.test(t.url)); if (panel) break; }
const p = await attach(panel.targetId);

const launch = await evalIn(p, `(async()=>{${DEEP}
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const fire=el=>['mousedown','mouseup','click'].forEach(x=>el.dispatchEvent(new MouseEvent(x,{bubbles:true,cancelable:true,view:window})));
  const list=()=>deep('button,[role=button],a',document,[]); const t=e=>(e.getAttribute('aria-label')||e.textContent||'').trim();
  const sns=list().find(e=>/start new scan/i.test(t(e))); if(sns){fire(sns);await wait(1500);}
  const launch=list().find(e=>new RegExp('^'+${JSON.stringify(which)}+'$','i').test(t(e))); if(!launch) return 'no launcher'; fire(launch); await wait(1800);
  const start=list().find(e=>/^start$/i.test(t(e))); if(start) fire(start); return 'launched+started';
})()`);
console.log("launch:", launch, "— waiting patiently (up to 210s)...");

let advanced = false;
for (let i = 0; i < 14; i++) {
  await sleep(15000);
  const st = await evalIn(p, `(()=>{${DEEP}
    const radios=deep('[role=radio],input[type=radio]',document,[]).length;
    const passfail=deep('button,[role=button]',document,[]).filter(e=>/^(pass|fail|yes|no|decorative|informative|next question)$/i.test((e.textContent||'').trim())).length;
    const txt=(document.body?document.body.innerText:'').replace(/\\s+/g,' ');
    const analyzing=/analyzing|loading intelligent|capturing/i.test(txt);
    return JSON.stringify({radios,passfail,analyzing,snippet:txt.slice(0,80)});
  })()`);
  const s = JSON.parse(st);
  console.log(`t+${(i + 1) * 15}s radios=${s.radios} answers=${s.passfail} analyzing=${s.analyzing} :: ${s.snippet}`);
  if (s.radios > 0 || s.passfail > 0 || (!s.analyzing && i > 1)) { advanced = true; console.log(">>> IGT ADVANCED PAST ANALYZING!"); break; }
}
console.log(advanced ? "RESULT: native IGT progressed." : "RESULT: still stuck on analyzing after 210s.");
ws.close();
process.exit(0);
