// IGT driver using TRUSTED input: clicks are delivered via CDP Input on the DevTools
// front-end at the panel-iframe's coordinates — real user-activation-bearing clicks,
// unlike synthetic dispatchEvent. Tests whether the IGT pipeline requires activation.
import { execSync } from "node:child_process";
import { startBrowser, waitForCdp } from "../dist/browser.js";
import { cdp, sleep, showAxePanel, panelTarget, panelState, feShot, DEEP } from "./igt-lib.mjs";

const url = process.argv[2] || "https://dequeuniversity.com/demo/mars/";
const category = process.argv[3] || "Images";
const HANDSOFF_S = parseInt(process.env.IGT_HANDSOFF || "120", 10);
const useChrome = process.env.IGT_BROWSER === "chrome";
const browserPath = useChrome ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined;
const profileDir = useChrome ? `${process.env.HOME}/.axe-mcp-chrome-igt` : undefined;
const appName = useChrome ? "Google Chrome" : "BrowserOS";

const T = `const T=e=>((e.getAttribute&&e.getAttribute('aria-label'))||e.textContent||'').replace(/\\s+/g,' ').trim();`;

/** Find a button in the panel, scrollIntoView, return its center in PANEL coords. */
async function panelButtonCenter(api, panelSess, labelRe) {
  const r = await api.evalIn(
    panelSess,
    `(()=>{${DEEP}${T}
      const b=deep('button,[role=button],a',document,[]).find(e=>new RegExp(${JSON.stringify(labelRe)},'i').test(T(e)));
      if(!b) return null;
      b.scrollIntoView&&b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      return JSON.stringify({x:r.x+r.width/2, y:r.y+r.height/2, label:T(b)});
    })()`
  );
  return r ? JSON.parse(r) : null;
}

/** Panel iframe offset within the DevTools front-end viewport. */
async function panelOffset(api, feSess) {
  const r = await api.evalIn(
    feSess,
    `(()=>{${DEEP}
      const fr=deep('iframe',document,[]).find(f=>/lhdoppoj/.test(f.src||''));
      if(!fr) return null;
      const r=fr.getBoundingClientRect();
      return JSON.stringify({x:r.x, y:r.y, w:r.width, h:r.height});
    })()`
  );
  return r ? JSON.parse(r) : null;
}

/** Trusted click delivered through the FE at panel-iframe-relative coordinates. */
async function trustedClick(api, feSess, off, pt) {
  const x = off.x + pt.x, y = off.y + pt.y;
  await api.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, feSess);
  await sleep(80);
  await api.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 }, feSess);
  await sleep(60);
  await api.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 }, feSess);
}

// ---- launch ----
const info = startBrowser({ url, port: 9222, browserPath, profileDir });
console.log("launched", info.browser.split("/").pop(), "pid", info.pid);
await waitForCdp(info.endpoint, 30000);
await sleep(6000);

const api = await cdp();
for (const t of await api.targets()) {
  if (t.type === "page" && /deque\.com|install-success/.test(t.url)) await api.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
}
await sleep(600);
const page = (await api.targets()).find((t) => t.type === "page" && t.url.includes(new URL(url).hostname));
if (page) await api.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
try { execSync(`open -a "${appName}"`); } catch {}

const shown = await showAxePanel(api);
console.log("panel shown:", shown);
if (!shown) { console.log("FATAL: axe panel never registered"); process.exit(3); }
await sleep(2000);

const fe = (await api.targets()).find((t) => /devtools_app\.html/.test(t.url));
const feSess = await api.attach(fe.targetId);
const p = await panelTarget(api);
const pSess = await api.attach(p.targetId);

const off = await panelOffset(api, feSess);
console.log("panel iframe offset:", JSON.stringify(off));
if (!off) { console.log("FATAL: no panel iframe in FE"); process.exit(1); }

// dismiss modal if any (synthetic fine for dismissal)
await api.evalIn(pSess, `(()=>{${DEEP}const x=deep('[aria-label*=close i]',document,[])[0]; if(x&&/sign up|waiting for auth/i.test(document.body.innerText)){x.click&&x.click();return 'dismissed';}return 'none';})()`).catch(() => {});

// possible "start new scan" (results screen) — trusted click too
const sns = await panelButtonCenter(api, pSess, "^start new scan$");
if (sns) { await trustedClick(api, feSess, off, sns); console.log("trusted-clicked:", sns.label); await sleep(1500); }

// category
let cat = await panelButtonCenter(api, pSess, `^${category}$`);
if (!cat) { console.log("FATAL: no category button"); process.exit(1); }
await trustedClick(api, feSess, off, cat);
console.log("trusted-clicked:", cat.label);

// wait for Start/Resume
let start = null;
for (let i = 0; i < 14 && !start; i++) { await sleep(1200); start = await panelButtonCenter(api, pSess, "^(start|resume testing)$"); }
if (!start) { console.log("FATAL: Start/Resume never appeared"); process.exit(1); }
await trustedClick(api, feSess, off, start);
console.log("trusted-clicked:", start.label);
await sleep(1500);
const st0 = JSON.parse(await api.evalIn(pSess, `(()=>{return JSON.stringify({t:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,120)})})()`));
console.log("post-Start:", st0.t);

// fully detach for analysis
await api.detach(pSess);
await api.detach(feSess);
api.close();
console.log(`hands-off ${HANDSOFF_S}s...`);
await sleep(HANDSOFF_S * 1000);

for (let i = 0; i < 20; i++) {
  const api2 = await cdp();
  const st = await panelState(api2);
  if (st) {
    console.log(`poll ${i}: analyzing=${st.analyzing} radios=${st.radios.length} :: ${st.text.slice(0, 90)}`);
    if (!st.analyzing && (st.radios.length > 0 || /what would you like|which .* test/i.test(st.text))) {
      await feShot(api2, "/tmp/igt-now.png").catch(() => {});
      console.log("\n>>> WIZARD REACHED A QUESTION (trusted input did it). State:");
      console.log(JSON.stringify(st, null, 1).slice(0, 2000));
      api2.close();
      process.exit(0);
    }
  }
  api2.close();
  await sleep(15000);
}
console.log("RESULT: still analyzing — trusted input did not unblock either.");
process.exit(2);
