// Ground-truth probe: evaluate inside the axe extension's SERVICE WORKER while the
// IGT is stalled at "Running axe". Asks Chrome itself:
//   - chrome.debugger.getTargets(): is the mars tab marked attached? by whom?
//   - chrome.debugger.attach({tabId}): does it succeed or what EXACT error?
import { cdp } from "./igt-lib.mjs";

const api = await cdp();
// Probe from the PANEL (an extension page with chrome.debugger + chrome.devtools):
// the service worker idles out under MV3, but the panel target persists.
const sw = (await api.targets()).find((t) => /lhdoppoj.*panel\.html/.test(t.url));
if (!sw) { console.log("axe panel target not found"); process.exit(1); }
const s = await api.attach(sw.targetId);

const out = await api.evalIn(
  s,
  `(async()=>{
    const res={};
    try{
      res.inspectedTabId = (chrome.devtools&&chrome.devtools.inspectedWindow)?chrome.devtools.inspectedWindow.tabId:null;
      res.swAlive = !!(chrome.runtime);
      try{ const pong = await chrome.runtime.sendMessage({__axe_mcp_ping:1}).catch(e=>String(e&&e.message||e)); res.swPing = typeof pong==='string'?pong:JSON.stringify(pong); }catch(e){ res.swPing='threw: '+String(e&&e.message||e); }
      const tabs=await chrome.tabs.query({});
      const mars=tabs.find(t=>/dequeuniversity/.test(t.url||''));
      res.marsTab=mars?{id:mars.id,active:mars.active,url:(mars.url||'').slice(0,60)}:null;
      const targets=await chrome.debugger.getTargets();
      res.targetsForTab=targets.filter(t=>(mars&&t.tabId===mars.id)).map(t=>({type:t.type,attached:t.attached,title:(t.title||'').slice(0,40),extensionId:t.extensionId||null}));
      if(mars){
        try{ await chrome.debugger.attach({tabId:mars.id},'1.3'); res.attachOK=true;
             await chrome.debugger.detach({tabId:mars.id}).catch(()=>{}); }
        catch(e){ res.attachOK=false; res.attachError=String(e&&e.message||e); }
      }
    }catch(e){ res.fatal=String(e&&e.message||e); }
    return JSON.stringify(res,null,1);
  })()`
);
console.log(typeof out === "string" ? out : JSON.stringify(out));
api.close();
process.exit(0);
