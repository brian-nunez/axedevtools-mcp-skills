// Standalone browser launcher for axe IGT driving. No project dependencies.
//   node launch.mjs <url> [--find-only]
// Env: AXE_BROWSER_PATH (default Google Chrome), AXE_PROFILE_DIR (default
// ~/.axe-mcp-chrome-igt — keeps the axe Pro trial state), AXE_EXT_DIR (skip
// discovery), AXE_CDP_PORT (default 9222), AXE_EXTRA_ARGS ("||"-separated).
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cdp, sleep, showAxePanel, pageTarget } from "./igt-lib.mjs";

const AXE_EXT_ID = "lhdoppojpmngadmnindnejefpokejbdd";
const url = process.argv[2] || "about:blank";
const findOnly = process.argv.includes("--find-only");
const port = parseInt(process.env.AXE_CDP_PORT || "9222", 10);
const browserPath =
  process.env.AXE_BROWSER_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = process.env.AXE_PROFILE_DIR || path.join(os.homedir(), ".axe-mcp-chrome-igt");

function findAxeExtensionDir() {
  if (process.env.AXE_EXT_DIR) return process.env.AXE_EXT_DIR;
  const roots = [
    "Library/Application Support/BrowserOS",
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Chromium",
  ].map((r) => path.join(os.homedir(), r));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const prof of fs.readdirSync(root)) {
      const extBase = path.join(root, prof, "Extensions", AXE_EXT_ID);
      if (!fs.existsSync(extBase)) continue;
      const versions = fs.readdirSync(extBase).filter((v) => fs.existsSync(path.join(extBase, v, "manifest.json")));
      versions.sort();
      if (versions.length) return path.join(extBase, versions[versions.length - 1]);
    }
  }
  return null;
}

const extDir = findAxeExtensionDir();
if (!extDir) {
  console.error("FATAL: axe DevTools extension not found on disk. Install it in Chrome/BrowserOS or set AXE_EXT_DIR.");
  process.exit(3);
}
console.log("extension:", extDir);
if (findOnly) process.exit(0);

const args = [
  `--user-data-dir=${profileDir}`,
  `--load-extension=${extDir}`,
  "--disable-features=DisableLoadExtensionCommandLineSwitch", // Chrome 137+ ignores --load-extension without this
  `--remote-debugging-port=${port}`,
  "--remote-allow-origins=*",
  "--auto-open-devtools-for-tabs",
  "--no-first-run",
  "--no-default-browser-check",
  ...(process.env.AXE_EXTRA_ARGS ? process.env.AXE_EXTRA_ARGS.split("||") : []),
  url,
];
const child = spawn(browserPath, args, { detached: true, stdio: "ignore" });
child.unref();
console.log("launched pid", child.pid, "->", url);

// wait for CDP
const endpoint = `http://127.0.0.1:${port}`;
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { await (await fetch(endpoint + "/json/version")).json(); up = true; } catch { await sleep(500); }
}
if (!up) { console.error("FATAL: CDP never came up on " + endpoint); process.exit(2); }
await sleep(5000);

const api = await cdp(endpoint);
// close extension onboarding tabs (a 2nd DevTools FE breaks panel lookup)
for (const t of await api.targets()) {
  if (t.type === "page" && /deque\.com|install-success/.test(t.url)) {
    await api.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
}
await sleep(600);
// reload the page once so the unpacked extension's content script is definitely injected
const page = await pageTarget(api);
if (page) {
  await api.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
  const ps = await api.attach(page.targetId);
  await api.send("Page.reload", {}, ps).catch(() => {});
  await api.detach(ps);
  await sleep(6000);
}
const shown = await showAxePanel(api);
console.log("axe panel shown:", shown);
api.close();
// foreground so background-window throttling can't freeze the wizard
try { execSync(`open -a ${JSON.stringify(process.env.AXE_BROWSER_APP || "Google Chrome")}`); } catch {}
process.exit(shown ? 0 : 4);
