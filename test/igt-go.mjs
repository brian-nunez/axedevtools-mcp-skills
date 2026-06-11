// Launch the Images IGT with minimal-attachment strategy:
//   1. fresh browser on the URL (axe ext loaded, devtools auto-open)
//   2. show axe panel (FE attach -> showPanel -> detach)
//   3. panel attach: dismiss modals, "start new scan" if needed, click <category>, Start
//   4. DETACH EVERYTHING + close the CDP socket  <- frees the tab's one debugger slot
//   5. hands-off for HANDSOFF_S seconds (capture + "Running axe" run unimpeded)
//   6. brief polls (fresh socket each time) until the wizard shows a question
//   7. dump state + FE screenshot, exit
import { execSync } from "node:child_process";
import { startBrowser, waitForCdp } from "../dist/browser.js";
import { cdp, sleep, showAxePanel, panelTarget, panelState, feShot, DEEP } from "./igt-lib.mjs";

const url = process.argv[2] || "https://dequeuniversity.com/demo/mars/";
const category = process.argv[3] || "Images";
const HANDSOFF_S = parseInt(process.env.IGT_HANDSOFF || "120", 10);
// IGT_BROWSER=chrome -> plain Google Chrome (no BrowserOS agent layer that could
// hold the tab's single chrome.debugger slot and starve the IGT's own attach).
const useChrome = process.env.IGT_BROWSER === "chrome";
const browserPath = useChrome ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined;
const profileDir = useChrome ? `${process.env.HOME}/.axe-mcp-chrome-igt` : undefined;
const appName = useChrome ? "Google Chrome" : "BrowserOS";

const info = startBrowser({ url, port: 9222, browserPath, profileDir });
console.log("launched", info.browser.split("/").pop(), "pid", info.pid, "->", url);
await waitForCdp(info.endpoint, 30000);
await sleep(6000);

// setup phase (one api connection)
{
  const api = await cdp();
  // close extension onboarding tabs; activate the target page WITHOUT attaching
  for (const t of await api.targets()) {
    if (t.type === "page" && /deque\.com|install-success/.test(t.url)) await api.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
  await sleep(600);
  const page = (await api.targets()).find((t) => t.type === "page" && t.url.includes(new URL(url).hostname));
  if (page) {
    await api.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
    // reload once so the extension's content script is definitely injected
    // (page may have loaded before an unpacked extension finished registering)
    const ps = await api.attach(page.targetId);
    await api.send("Page.reload", {}, ps).catch(() => {});
    await api.detach(ps);
    await sleep(6000);
  }

  const shown = await showAxePanel(api);
  console.log("panel shown:", shown);
  if (!shown) {
    console.log("FATAL: axe panel never registered — if this is Chrome, --load-extension may be ignored on this build.");
    process.exit(3);
  }
  await sleep(2000);
  const p = await panelTarget(api);
  if (!p) { console.log("FATAL: no panel.html"); process.exit(1); }
  const s = await api.attach(p.targetId);
  const setup = await api.evalIn(
    s,
    `(async()=>{${DEEP}
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const t=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();
      const fire=el=>{['mousedown','mouseup','click'].forEach(x=>el.dispatchEvent(new MouseEvent(x,{bubbles:true,cancelable:true,view:window})));try{el.click&&el.click()}catch(e){}};
      const list=()=>deep('button,[role=button],a',document,[]);
      const log=[];
      const body=()=>(document.body.innerText||'');
      if(/sign up|waiting for authentication/i.test(body())){const x=deep('[aria-label*=close i]',document,[])[0];if(x){fire(x);log.push('modal dismissed');await wait(600);}}
      const sns=list().find(e=>/start new scan/i.test(t(e)));
      if(sns){fire(sns);log.push('start new scan');await wait(1500);
        const conf=list().find(e=>/^(yes|confirm|discard|start new scan)$/i.test(t(e))); if(conf && conf!==sns){fire(conf);log.push('confirmed');await wait(1200);}}
      log.push(/\\(Pro\\)|free trial/i.test(body())?'pro/trial detected':'NO pro/trial text');
      // category -> intro can be slow on first open; retry click + poll for Start up to ~25s
      let start=null;
      for(let round=0; round<2 && !start; round++){
        const cat=list().find(e=>new RegExp('^'+${JSON.stringify(category)}+'$','i').test(t(e)));
        if(!cat && round===0) return JSON.stringify({ok:false,log:[...log,'no category button'],buttons:[...new Set(list().map(t))].slice(0,30)});
        if(cat){ fire(cat); log.push('category clicked (round '+round+')'); }
        for(let i=0;i<12 && !start;i++){ await wait(1200); start=list().find(e=>/^(start|resume testing)$/i.test(t(e))); }
      }
      if(!start) return JSON.stringify({ok:false,log,buttons:[...new Set(list().map(t))].slice(0,30)});
      fire(start); log.push('START clicked');
      return JSON.stringify({ok:true,log});
    })()`
  );
  console.log("setup:", setup);
  await api.detach(s);
  api.close(); // <- nothing attached anywhere now
  const parsed = JSON.parse(setup);
  if (!parsed.ok) process.exit(1);
}

// bring the browser window frontmost so background-window throttling can't
// freeze the wizard's progress loop during analysis
try { execSync(`open -a "${appName}"`); } catch {}
console.log(`hands-off for ${HANDSOFF_S}s (capture + analysis run with zero debugger contention)...`);
await sleep(HANDSOFF_S * 1000);

// poll phase: brief fresh connections
for (let i = 0; i < 20; i++) {
  const api = await cdp();
  const st = await panelState(api);
  if (st) {
    console.log(`poll ${i}: analyzing=${st.analyzing} radios=${st.radios.length} :: ${st.text.slice(0, 90)}`);
    if (!st.analyzing && (st.radios.length > 0 || /what would you like|which .* test|select/i.test(st.text))) {
      await feShot(api, "/tmp/igt-now.png").catch(() => {});
      console.log("\n>>> WIZARD READY — first question reached. State:");
      console.log(JSON.stringify(st, null, 1).slice(0, 2200));
      console.log("screenshot -> /tmp/igt-now.png");
      api.close();
      process.exit(0);
    }
  } else console.log(`poll ${i}: no panel target`);
  api.close();
  await sleep(15000);
}
console.log("RESULT: wizard did not reach a question (still analyzing after polls).");
process.exit(2);
