import { startBrowser, waitForCdp } from "./browser.js";
import { CDP, sleep } from "./cdp.js";

export interface SetupEnvironmentOptions {
  targetUrl: string;
  port?: number;
  profileDir?: string;
  browserPath?: string;
  extensionDir?: string;
  waitMs?: number;
}

function noVncUrl(): string | null {
  const port = process.env.NOVNC_PORT || "6080";
  return port ? `http://127.0.0.1:${port}/vnc.html` : null;
}

async function prepareBrowser(endpoint: string, targetUrl: string) {
  const cdp = await CDP.connect(endpoint);
  try {
    // The extension often opens install-success/onboarding tabs. Close them so
    // DevTools/axe panel lookup binds to the inspected page only.
    for (const t of await cdp.targets()) {
      if (t.type === "page" && /deque\.com|install-success/.test(t.url)) {
        await cdp.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
      }
    }
    await sleep(500);

    const pages = (await cdp.targets()).filter((t) => t.type === "page");
    const page =
      pages.find((t) => t.url === targetUrl || t.url.includes(targetUrl)) ??
      pages.find((t) => /^(https?|file):/.test(t.url)) ??
      pages[0];
    if (!page) return { pageReady: false, pageUrl: null };

    await cdp.send("Target.activateTarget", { targetId: page.targetId }).catch(() => {});
    const session = await cdp.attach(page.targetId);
    await cdp.send("Page.enable", {}, session).catch(() => {});
    if (page.url !== targetUrl) {
      await cdp.send("Page.navigate", { url: targetUrl }, session);
      await sleep(2500);
    } else {
      // Reload once after extension load so content scripts are definitely present.
      await cdp.send("Page.reload", {}, session).catch(() => {});
      await sleep(2500);
    }
    const pageUrl = await cdp
      .evalIn(session, "location.href")
      .catch(() => targetUrl);
    await cdp.detach(session);
    return { pageReady: true, pageUrl };
  } finally {
    cdp.close();
  }
}

export async function setupEnvironment(opts: SetupEnvironmentOptions) {
  const port = opts.port ?? Number(process.env.AXE_CDP_PORT || 9222);
  const info = startBrowser({
    url: opts.targetUrl,
    port,
    profileDir: opts.profileDir,
    browserPath: opts.browserPath,
    extensionDir: opts.extensionDir,
  });
  const cdpReady = await waitForCdp(info.endpoint, opts.waitMs ?? 30_000);
  const prepared = cdpReady ? await prepareBrowser(info.endpoint, opts.targetUrl) : { pageReady: false, pageUrl: null };
  return {
    ok: cdpReady && prepared.pageReady,
    targetUrl: opts.targetUrl,
    pageUrl: prepared.pageUrl,
    cdpReady,
    cdpEndpoint: info.endpoint,
    noVncUrl: noVncUrl(),
    pid: info.pid,
    browser: info.browser,
    profileDir: info.profileDir,
    extensionDir: info.extensionDir,
    nextTools: [
      "axe_panel_scan",
      "axe_igt_launch",
      "axe_igt_state",
      "axe_igt_answer",
      "axe_igt_dash",
      "axe_structure_audit",
    ],
    igtCategories: ["Images", "Table", "Keyboard", "Modal Dialog", "Interactive Elements", "Structure", "Forms"],
  };
}
