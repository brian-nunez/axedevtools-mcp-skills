#!/usr/bin/env node
import { startBrowser, waitForCdp } from "./browser.js";
import { configureAxeExtension } from "./extension.js";
import { waitForAndCloseInstallSuccess } from "./setup.js";

const targetUrl = process.env.TARGET_URL || process.env.AXE_TARGET_URL || "about:blank";
const port = Number(process.env.AXE_CDP_PORT || 9222);
const endpoint = process.env.AXE_CDP_ENDPOINT || `http://127.0.0.1:${port}`;

async function main() {
  const info = startBrowser({ url: targetUrl, port });
  const cdpReady = await waitForCdp(info.endpoint, 45_000);
  console.error(`[axe-mcp] chromium pid=${info.pid} cdp=${info.endpoint} ready=${cdpReady} target=${targetUrl}`);
  if (!cdpReady) process.exit(2);

  const installSuccess = await waitForAndCloseInstallSuccess(info.endpoint, Number(process.env.AXE_INSTALL_SUCCESS_WAIT_MS || 20_000));
  console.error(`[axe-mcp] axe install-success tab: ${JSON.stringify(installSuccess)}`);

  if (process.env.AXE_LOGIN_EMAIL && process.env.AXE_LOGIN_PASSWORD) {
    const result = await configureAxeExtension({
      endpoint,
      email: process.env.AXE_LOGIN_EMAIL,
      password: process.env.AXE_LOGIN_PASSWORD,
    });
    console.error(`[axe-mcp] axe extension login bootstrap: ${JSON.stringify({
      panelShown: result.panelShown,
      loginAttempted: result.loginAttempted,
      loggedIn: result.loggedIn,
      reason: result.reason,
    })}`);
  } else {
    console.error("[axe-mcp] AXE_LOGIN_EMAIL/AXE_LOGIN_PASSWORD not set; skipping extension login bootstrap");
  }
}

main().catch((error) => {
  console.error("[axe-mcp] bootstrap failed:", error?.stack || error?.message || error);
  process.exit(1);
});
