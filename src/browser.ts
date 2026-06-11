// Launch a Chromium-family browser (prefers BrowserOS) with the installed axe
// DevTools extension loaded and the flags needed to drive its panel over CDP.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const AXE_EXT_ID = "lhdoppojpmngadmnindnejefpokejbdd";

const BROWSER_CANDIDATES = [
  "/Applications/BrowserOS.app/Contents/MacOS/BrowserOS",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const EXT_PROFILE_DIRS = [
  join(homedir(), "Library/Application Support/BrowserOS/Default/Extensions"),
  join(homedir(), "Library/Application Support/Google/Chrome/Default/Extensions"),
  join(homedir(), "Library/Application Support/Microsoft Edge/Default/Extensions"),
];

/** Locate the unpacked axe DevTools extension dir (latest version) on disk. */
export function findAxeExtensionDir(): string | null {
  for (const profExt of EXT_PROFILE_DIRS) {
    const dir = join(profExt, AXE_EXT_ID);
    if (!existsSync(dir)) continue;
    const versions = readdirSync(dir).filter((v) => /\d/.test(v));
    if (!versions.length) continue;
    versions.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return join(dir, versions[versions.length - 1]);
  }
  return null;
}

function findBrowser(): string | null {
  return BROWSER_CANDIDATES.find((b) => existsSync(b)) ?? null;
}

export interface StartOptions {
  url?: string;
  port?: number;
  profileDir?: string;
  browserPath?: string;
  extensionDir?: string;
}

export function startBrowser(opts: StartOptions): {
  pid: number;
  endpoint: string;
  browser: string;
  extensionDir: string;
  profileDir: string;
} {
  const port = opts.port ?? 9222;
  const url = opts.url ?? "about:blank";
  const profileDir = opts.profileDir ?? join(homedir(), ".axe-mcp-browser");
  const browser = opts.browserPath ?? findBrowser();
  if (!browser) throw new Error("No Chromium-family browser found in /Applications.");
  const extensionDir = opts.extensionDir ?? findAxeExtensionDir();
  if (!extensionDir) {
    throw new Error(
      `Could not find the axe DevTools extension (${AXE_EXT_ID}) in BrowserOS/Chrome/Edge. Install it first, or pass extensionDir.`
    );
  }
  // Clear a stale singleton lock so relaunching the same profile works.
  try {
    rmSync(join(profileDir, "SingletonLock"), { force: true });
  } catch {}

  // Passed as discrete argv (no shell) so the "*" in --remote-allow-origins is literal.
  // AXE_EXTRA_ARGS: "||"-separated extra Chromium flags (e.g. feature toggles).
  const extra = (process.env.AXE_EXTRA_ARGS || "").split("||").map((s) => s.trim()).filter(Boolean);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--remote-debugging-port=${port}`,
    "--remote-allow-origins=*",
    "--auto-open-devtools-for-tabs",
    "--no-first-run",
    "--no-default-browser-check",
    ...extra,
    url,
  ];
  const child = spawn(browser, args, { detached: true, stdio: "ignore" });
  child.unref();
  return { pid: child.pid ?? -1, endpoint: `http://127.0.0.1:${port}`, browser, extensionDir, profileDir };
}

export async function waitForCdp(endpoint: string, timeoutMs = 25000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(endpoint.replace(/\/$/, "") + "/json/version");
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
