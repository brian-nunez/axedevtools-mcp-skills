// Drives Deque's REAL axe DevTools extension panel via CDP:
//   1. attach to the page's DevTools front-end
//   2. show the axe panel via InspectorFrontendAPI.showPanel(panelId)  (panelId read from UI.panels)
//   3. attach to the extension's panel.html target
//   4. click "Scan full page" (the panel honors programmatic clicks)
//   5. poll + scrape the panel's own rendered results
import { CDP, TargetInfo, sleep } from "./cdp.js";

const PANEL_RE = /lhdoppoj.*panel\.html/; // axe DevTools extension panel page
const FE_RE = /devtools_app\.html/; // DevTools front-end
const DEEP =
  "function deep(sel,root,acc){try{root.querySelectorAll(sel).forEach(e=>acc.push(e))}catch(_){}" +
  "for(const e of root.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;}";

export interface PanelScanOptions {
  endpoint: string;
  navigateTo?: string;
  scanType?: "full" | "partial";
  timeoutMs?: number;
}

function pageTarget(tis: TargetInfo[], urlContains?: string): TargetInfo | undefined {
  const pages = tis.filter((t) => t.type === "page" && /^(https?|file):/.test(t.url));
  if (urlContains) return pages.find((p) => p.url.includes(urlContains)) ?? pages[0];
  return pages[0];
}

export async function panelScan(opts: PanelScanOptions) {
  const cdp = await CDP.connect(opts.endpoint);
  const timeout = opts.timeoutMs ?? 30000;
  try {
    // Close the extension's first-run onboarding tab if present — a second tab
    // creates a second DevTools front-end and makes tab/panel binding ambiguous.
    for (const t of await cdp.targets()) {
      if (t.type === "page" && /deque\.com|install-success/.test(t.url)) {
        await cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
      }
    }
    await sleep(500);

    // Optional: navigate the inspected tab first.
    if (opts.navigateTo) {
      const page = pageTarget(await cdp.targets());
      if (page) {
        const sess = await cdp.attach(page.targetId);
        await cdp.send("Page.enable", {}, sess).catch(() => {});
        await cdp.send("Page.navigate", { url: opts.navigateTo }, sess);
        await sleep(2500);
      }
    }

    // 1+2) Find a DevTools front-end whose axe panel has registered (registration
    //      is async after DevTools opens, and a stray tab can add a second FE), then
    //      show that panel via the host->frontend bridge (no menu/coords/docking).
    let feSess: string | null = null;
    let axePid: string | null = null;
    let sawAnyFe = false;
    for (let i = 0; i < 30; i++) {
      const fes = (await cdp.targets()).filter((t) => FE_RE.test(t.url));
      sawAnyFe = sawAnyFe || fes.length > 0;
      for (const feTarget of fes) {
        const sess = await cdp.attach(feTarget.targetId);
        const pid = await cdp
          .evalIn(
            sess,
            `(()=>{const k=Object.keys((globalThis.UI&&globalThis.UI.panels)||{}).find(k=>/axe/i.test(k));return k||null;})()`
          )
          .catch(() => null);
        if (pid) {
          feSess = sess;
          axePid = pid;
          break;
        }
      }
      if (axePid) break;
      await sleep(500);
    }
    if (!sawAnyFe) {
      throw new Error(
        "No DevTools front-end is open for the page. Launch the browser with --auto-open-devtools-for-tabs (axe_browser_start does this)."
      );
    }
    if (!axePid || !feSess) {
      throw new Error(
        "The axe DevTools panel did not register in DevTools. Is the axe extension installed/loaded in this browser profile?"
      );
    }
    const shown = await cdp.evalIn(
      feSess,
      `(()=>{try{globalThis.InspectorFrontendAPI.showPanel(${JSON.stringify(axePid)});return 'OK';}catch(e){return 'ERR '+e.message;}})()`
    );
    if (typeof shown === "string" && shown.startsWith("ERR")) {
      throw new Error("Failed to show axe panel: " + shown);
    }

    // 3) wait for panel.html to instantiate, then attach
    let panel: TargetInfo | undefined;
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      panel = (await cdp.targets()).find((t) => PANEL_RE.test(t.url));
      if (panel) break;
    }
    if (!panel) throw new Error("axe panel.html did not instantiate after showPanel.");
    const pSess = await cdp.attach(panel.targetId);

    // 4) click the scan button — handle initial ("Scan full page"), results
    //    ("Re-run scan"), and reset ("start new scan" -> options) states.
    const wantPartial = opts.scanType === "partial";
    const click = await cdp.evalIn(
      pSess,
      `(async()=>{${DEEP}
        const wait=ms=>new Promise(r=>setTimeout(r,ms));
        const fire=el=>['mousedown','mouseup','click'].forEach(x=>el.dispatchEvent(new MouseEvent(x,{bubbles:true,cancelable:true,view:window})));
        const list=()=>deep('button,[role=button],a',document,[]);
        const t=e=>(e.getAttribute('aria-label')||e.textContent||'').trim();
        // Order-independent matches: handles "Scan full page" and "Full Page Scan", plus re-run/reset.
        const match=(...res)=>list().find(e=>{const s=t(e);return res.every(r=>r.test(s));});
        const reRun=()=>match(/re-?run/i,/scan/i);
        const full=()=>match(/full/i,/scan/i);
        const partial=()=>match(/partial/i,/scan/i);
        const reset=()=>list().find(e=>/start new scan|new scan/i.test(t(e)));
        const want=()=>${wantPartial}?partial():full();
        let b=reRun()||want();
        if(!b){ const r=reset(); if(r){ fire(r); await wait(900); b=want(); } }
        if(!b) return JSON.stringify({clicked:false, options:[...new Set(list().map(t).filter(Boolean))].slice(0,20)});
        fire(b);
        return JSON.stringify({clicked:true, label:t(b)});
      })()`
    );
    const clickInfo = JSON.parse(click);
    if (!clickInfo.clicked) {
      throw new Error("Could not find a Scan button in the panel. Buttons seen: " + JSON.stringify(clickInfo.options));
    }
    await sleep(1500); // let the scan start / prior results clear before polling

    // 5) poll until results render, then scrape
    const deadline = Date.now() + timeout;
    let scraped: any = null;
    while (Date.now() < deadline) {
      await sleep(1000);
      const data = await cdp.evalIn(pSess, scrapeExpr());
      const parsed = typeof data === "string" ? JSON.parse(data) : data;
      if (parsed && parsed.ready) {
        scraped = parsed;
        break;
      }
    }
    if (!scraped) throw new Error("Scan did not produce results before timeout.");

    return {
      engine: "axe DevTools extension panel (Deque)",
      axeVersion: scraped.axeVersion,
      standard: scraped.standard,
      bestPractices: scraped.bestPractices,
      testUrl: scraped.testUrl,
      scannedButton: clickInfo.label,
      totals: scraped.totals,
      issues: scraped.issues,
    };
  } finally {
    cdp.close();
  }
}

/** Expression evaluated inside the panel page to scrape its rendered results. */
function scrapeExpr(): string {
  return `(()=>{${DEEP}
    const text=(document.body?document.body.innerText:'').replace(/\\s+/g,' ').trim();
    if(!/TOTAL ISSUES/i.test(text) || !/Re-run scan/i.test(text)) return JSON.stringify({ready:false});
    const summary=((deep('[class*=issues__summary]',document,[])[0]||document.body).textContent||'').replace(/\\s+/g,' ');
    const n=re=>{const m=summary.match(re); return m?parseInt(m[1],10):0;};
    const totals={
      total: (text.match(/TOTAL ISSUES\\s*:?\\s*(\\d+)/i)||[])[1]!=null?parseInt((text.match(/TOTAL ISSUES\\s*:?\\s*(\\d+)/i)||[])[1],10):n(/Total Issues\\s*(\\d+)/i),
      automatic: n(/Automatic Issues\\s*(\\d+)/i),
      guided: n(/Guided Issues\\s*(\\d+)/i),
      manual: n(/Manual Issues\\s*(\\d+)/i),
      critical: n(/Critical\\s*(\\d+)/i),
      serious: n(/Serious\\s*(\\d+)/i),
      moderate: n(/Moderate\\s*(\\d+)/i),
      minor: n(/Minor\\s*(\\d+)/i)
    };
    const groups=deep('[class*=issueGroup]',document,[]);
    const seen=new Set(); const issues=[];
    for(const gp of groups){
      const gtext=(gp.textContent||'').replace(/\\s+/g,' ').trim();
      const desc=((deep('[class*=issue__description]',gp,[])[0]||{}).textContent||'').trim();
      const title=gtext.split(/\\s+\\d/)[0].trim();      // rule name = text before the count badge
      const inst=gtext.match(/(\\d+)\\s+of\\s+(\\d+)/);   // "N of M" instances
      const key=desc||title;                            // description is the stable per-rule identifier
      if(!key || key.length<3 || seen.has(key)) continue; seen.add(key);
      issues.push({title:title||null, description:desc||null, elementsAffected:inst?parseInt(inst[2],10):null});
    }
    return JSON.stringify({
      ready:true,
      testUrl:(text.match(/Test URL\\s+(\\S+)/)||[])[1]||null,
      axeVersion:(text.match(/axe-core[^0-9]*([0-9.]+)/i)||[])[1]||null,
      standard:(text.match(/(WCAG[^A-Za-z]*[0-9.]+\\s*A+)/i)||[])[1]||null,
      bestPractices:/Best Practices:\\s*ON/i.test(text),
      totals, issues
    });
  })()`;
}
