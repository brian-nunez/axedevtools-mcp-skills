#!/usr/bin/env node
import { desktopBounds, startBrowser, waitForCdp } from "./browser.js";
import { clickScanFullPage, completeAxeOnboarding, configureAxeSettings, dismissAxeAiPopup, showAxeDevToolsPanel, signInToAxe } from "./extension.js";
import { waitForAndCloseInstallSuccess } from "./setup.js";
import { CDP } from "./cdp.js";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const targetUrl = process.env.TARGET_URL || process.env.AXE_TARGET_URL;
const port = Number(process.env.AXE_CDP_PORT || 9222);
const endpoint = process.env.AXE_CDP_ENDPOINT || `http://127.0.0.1:${port}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const envNumber = (name: string, fallback: number) => Number(process.env[name] || fallback);

async function verifyPreparedBrowser(endpoint: string, targetUrl: string) {
  const cdp = await CDP.connect(endpoint);
  try {
    const targets = await cdp.targets();
    const pages = targets.filter((t) => t.type === "page");
    const page = pages.find((t) => t.url.includes(targetUrl) || t.url === targetUrl) ?? pages.find((t) => /^https?:/.test(t.url));
    const devtools = targets.find((t) => /devtools_app\.html/.test(t.url));
    const axePanel = targets.find((t) => /lhdoppoj.*panel\.html/.test(t.url));
    return {
      ok: !!page && !!devtools && !!axePanel,
      pageUrl: page?.url ?? null,
      devtoolsUrl: devtools?.url ?? null,
      axePanelUrl: axePanel?.url ?? null,
      targetCount: targets.length,
    };
  } finally {
    cdp.close();
  }
}

async function maximizeBrowserWindow(endpoint: string) {
  const cdp = await CDP.connect(endpoint);
  const bounds = desktopBounds();
  try {
    const targets = await cdp.targets();
    const target =
      targets.find((t) => t.type === "page" && /^https?:/.test(t.url)) ??
      targets.find((t) => t.type === "page") ??
      targets[0];
    if (!target) return { ok: false, reason: "no CDP targets available", bounds };

    const { windowId } = await cdp.send("Browser.getWindowForTarget", { targetId: target.targetId });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
    await cdp.send("Browser.setWindowBounds", { windowId, bounds }).catch(() => { });
    return { ok: true, windowId, targetUrl: target.url, bounds };
  } catch (error: any) {
    return { ok: false, reason: error?.message || String(error), bounds };
  } finally {
    cdp.close();
  }
}

async function restoreOriginalTargetAfterAuth(endpoint: string, targetUrl: string) {
  const cdp = await CDP.connect(endpoint);
  try {
    const targets = await cdp.targets();
    const pages = targets.filter((t) => t.type === "page");
    const originalPage =
      pages.find((t) => t.url === targetUrl || t.url.includes(targetUrl)) ??
      pages.find((t) => {
        try {
          return new URL(t.url).origin === new URL(targetUrl).origin;
        } catch {
          return false;
        }
      });

    if (!originalPage) {
      return { ok: false, reason: "original target page not found", closed: [] };
    }

    const originalHost = (() => {
      try {
        return new URL(originalPage.url).host;
      } catch {
        return "";
      }
    })();
    const closed: Array<{ targetId: string; title: string; url: string; reason: string }> = [];

    for (const target of targets) {
      if (target.targetId === originalPage.targetId) continue;

      const isHttpPage = target.type === "page" && /^https?:\/\//i.test(target.url);
      const isNonOriginalHttpPage =
        isHttpPage &&
        target.url !== originalPage.url &&
        !target.url.includes(targetUrl);
      const isNonOriginalDevTools =
        target.type === "page" &&
        /^devtools:\/\//i.test(target.url) &&
        originalHost &&
        !target.title.includes(originalHost);

      if (isNonOriginalHttpPage || isNonOriginalDevTools) {
        await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
        closed.push({
          targetId: target.targetId,
          title: target.title,
          url: target.url,
          reason: isNonOriginalHttpPage ? "non-original http page" : "non-original devtools page",
        });
      }
    }

    const session = await cdp.attach(originalPage.targetId);
    await cdp.send("Page.bringToFront", {}, session).catch(() => {});
    await cdp.detach(session).catch(() => {});

    return { ok: true, originalPage: { targetId: originalPage.targetId, title: originalPage.title, url: originalPage.url }, closed };
  } finally {
    cdp.close();
  }
}

async function completeAxeOnboardingWithRetries(
  endpoint: string,
  label: string,
  attempts: number,
  timeoutMs: number,
  delayMs: number
) {
  let lastResult: any = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await completeAxeOnboarding(endpoint, timeoutMs);
    lastResult = { ...result, attempt, attempts, timeoutMs };
    console.error(`[axe-mcp] axe onboarding ${label} attempt ${attempt}/${attempts}: ${JSON.stringify(result)}`);
    if (result.completed || result.attempted) return lastResult;
    if (attempt < attempts) await sleep(delayMs);
  }
  return lastResult ?? { attempted: false, completed: false, attempt: 0, attempts, timeoutMs };
}

async function showAxeDevToolsPanelWithRetries(endpoint: string, attempts: number, timeoutMs: number, delayMs: number) {
  let lastResult: any = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await showAxeDevToolsPanel(endpoint, timeoutMs);
    lastResult = { ...result, attempt, attempts, timeoutMs };
    console.error(`[axe-mcp] axe DevTools panel attempt ${attempt}/${attempts}: ${JSON.stringify(result)}`);
    if (result.panelShown && result.panelTargetFound) return lastResult;
    if (attempt < attempts) await sleep(delayMs);
  }
  return lastResult ?? { panelShown: false, panelTargetFound: false, panelUrl: null, attempt: 0, attempts, timeoutMs };
}

function startOptionalPopupWatcher(endpoint: string, timeoutMs: number) {
  const watcherPath = fileURLToPath(new URL("./optional-popup-watcher.js", import.meta.url));
  const child = spawn(process.execPath, [watcherPath], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AXE_CDP_ENDPOINT: endpoint,
      AXE_WE_FOUND_SOMETHING_SAVE_WAIT_MS: String(timeoutMs),
    },
  });
  child.unref();
  return { started: true, pid: child.pid ?? null, timeoutMs };
}

async function main() {
  if (!targetUrl) {
    throw new Error("TARGET_URL or AXE_TARGET_URL is required for startup preparation.");
  }

  const info = startBrowser({ url: targetUrl, port });
  const cdpReady = await waitForCdp(info.endpoint, 45_000);
  console.error(`[axe-mcp] chromium pid=${info.pid} cdp=${info.endpoint} ready=${cdpReady} target=${targetUrl}`);
  if (!cdpReady) process.exit(2);

  const browserWindow = await maximizeBrowserWindow(info.endpoint);
  console.error(`[axe-mcp] browser window maximize: ${JSON.stringify(browserWindow)}`);

  const installSuccess = await waitForAndCloseInstallSuccess(info.endpoint, Number(process.env.AXE_INSTALL_SUCCESS_WAIT_MS || 20_000));
  console.error(`[axe-mcp] axe install-success tab: ${JSON.stringify(installSuccess)}`);

  let onboarding = await completeAxeOnboardingWithRetries(
    info.endpoint,
    "before panel",
    envNumber("AXE_ONBOARDING_ATTEMPTS", 3),
    envNumber("AXE_ONBOARDING_ATTEMPT_MS", 2_000),
    envNumber("AXE_ONBOARDING_RETRY_DELAY_MS", 300)
  );

  const axePanel = await showAxeDevToolsPanelWithRetries(
    info.endpoint,
    envNumber("AXE_PANEL_OPEN_ATTEMPTS", 3),
    envNumber("AXE_PANEL_OPEN_ATTEMPT_MS", 2_500),
    envNumber("AXE_PANEL_OPEN_RETRY_DELAY_MS", 300)
  );
  if (!axePanel.panelShown || !axePanel.panelTargetFound) {
    throw new Error(`Failed to open the axe DevTools panel: ${JSON.stringify(axePanel)}`);
  }

  if (!onboarding.completed) {
    onboarding = await completeAxeOnboardingWithRetries(
      info.endpoint,
      "after panel",
      envNumber("AXE_ONBOARDING_PANEL_ATTEMPTS", 3),
      envNumber("AXE_ONBOARDING_PANEL_ATTEMPT_MS", 3_000),
      envNumber("AXE_ONBOARDING_PANEL_RETRY_DELAY_MS", 300)
    );
  }

  const aiPopup = await dismissAxeAiPopup(info.endpoint, Number(process.env.AXE_AI_POPUP_WAIT_MS || 15_000));
  console.error(`[axe-mcp] axe AI popup dismiss: ${JSON.stringify(aiPopup)}`);

  let signIn: any = null;
  let scanFullPage: any = null;
  let weFoundSomethingSaveWatcher: any = null;
  let postAuthTargetRestore: any = null;
  let postAuthAxePanel: any = null;
  if (process.env.AXE_LOGIN_EMAIL && process.env.AXE_LOGIN_PASSWORD) {
    const result = await signInToAxe({
      endpoint: info.endpoint,
      email: process.env.AXE_LOGIN_EMAIL,
      password: process.env.AXE_LOGIN_PASSWORD,
      onPrem: process.env.ON_PREM !== "0",
    });
    signIn = result;
    console.error(`[axe-mcp] axe sign-in: ${JSON.stringify({
      ok: result.ok,
      onPrem: result.onPrem,
      clicked: result.clickResult?.clicked,
      reason: result.reason,
    })}`);
    if (result.ok) {
      const afterAuthSettleMs = envNumber("AXE_AFTER_AUTH_SETTLE_MS", 5_000);
      console.error(`[axe-mcp] waiting ${afterAuthSettleMs}ms for auth tab cleanup before scan`);
      await sleep(afterAuthSettleMs);

      postAuthTargetRestore = await restoreOriginalTargetAfterAuth(info.endpoint, targetUrl);
      console.error(`[axe-mcp] post-auth original target restore: ${JSON.stringify(postAuthTargetRestore)}`);

      postAuthAxePanel = await showAxeDevToolsPanelWithRetries(
        info.endpoint,
        envNumber("AXE_PANEL_OPEN_ATTEMPTS", 3),
        envNumber("AXE_PANEL_OPEN_ATTEMPT_MS", 2_500),
        envNumber("AXE_PANEL_OPEN_RETRY_DELAY_MS", 300)
      );
      console.error(`[axe-mcp] post-auth original axe DevTools panel: ${JSON.stringify(postAuthAxePanel)}`);

      await sleep(envNumber("AXE_BEFORE_SCAN_SETTLE_MS", 2_000));
      scanFullPage = await clickScanFullPage(info.endpoint, envNumber("AXE_SCAN_FULL_PAGE_WAIT_MS", 30_000));
      console.error(`[axe-mcp] axe Scan full page click: ${JSON.stringify(scanFullPage)}`);
      if (scanFullPage.ok) {
        weFoundSomethingSaveWatcher = startOptionalPopupWatcher(
          info.endpoint,
          envNumber("AXE_WE_FOUND_SOMETHING_SAVE_WAIT_MS", 60_000)
        );
        console.error(`[axe-mcp] axe optional We found something watcher: ${JSON.stringify(weFoundSomethingSaveWatcher)}`);
      } else {
        weFoundSomethingSaveWatcher = { started: false, skipped: true, reason: "Scan full page did not complete" };
        console.error(`[axe-mcp] axe optional We found something watcher skipped: ${JSON.stringify(weFoundSomethingSaveWatcher)}`);
      }
    } else {
      scanFullPage = { ok: false, skipped: true, reason: "sign-in did not complete" };
      weFoundSomethingSaveWatcher = { started: false, skipped: true, reason: "sign-in did not complete" };
      console.error(`[axe-mcp] axe Scan full page click skipped: ${JSON.stringify(scanFullPage)}`);
    }
  } else {
    console.error("[axe-mcp] AXE_LOGIN_EMAIL/AXE_LOGIN_PASSWORD not set; skipping sign-in");
    scanFullPage = { ok: false, skipped: true, reason: "AXE_LOGIN_EMAIL/AXE_LOGIN_PASSWORD not set" };
    weFoundSomethingSaveWatcher = { started: false, skipped: true, reason: "AXE_LOGIN_EMAIL/AXE_LOGIN_PASSWORD not set" };
  }

  // if (process.env.AXE_SERVER_URL) {
  //   const result = await configureAxeSettings({
  //     endpoint: info.endpoint,
  //     serverUrl: process.env.AXE_SERVER_URL,
  //   });
  //   console.error(`[axe-mcp] axe settings configure: ${JSON.stringify(result)}`);
  // } else {
  //   console.error("[axe-mcp] AXE_SERVER_URL not set; skipping settings configuration");
  // }

  const prepared = await verifyPreparedBrowser(info.endpoint, targetUrl);
  console.error(`[axe-mcp] prepared desktop state: ${JSON.stringify(prepared)}`);
  if (!prepared.ok) {
    throw new Error(`Desktop/browser startup did not reach prepared state: ${JSON.stringify(prepared)}`);
  }

  await writeFile(
    "/tmp/axe-mcp/ready.json",
    JSON.stringify(
      {
        ready: true,
        targetUrl,
        cdpEndpoint: info.endpoint,
        browserPid: info.pid,
        browserWindow,
        installSuccess,
        onboarding,
        aiPopup,
        axePanel,
        signIn,
        postAuthTargetRestore,
        postAuthAxePanel,
        scanFullPage,
        weFoundSomethingSaveWatcher,
        prepared,
        readyAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.error("[axe-mcp] startup preparation complete; browser is ready for the agent");
}

main().catch((error) => {
  console.error("[axe-mcp] bootstrap failed:", error?.stack || error?.message || error);
  writeFile(
    "/tmp/axe-mcp/bootstrap-error.json",
    JSON.stringify(
      {
        ready: false,
        error: error?.stack || error?.message || String(error),
        failedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
    .catch(() => { })
    .finally(() => process.exit(1));
});
