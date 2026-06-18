#!/usr/bin/env node
// axe-mcp — drive Deque's REAL axe DevTools extension panel via the DevTools UI.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { z } from "zod";
import { panelScan } from "./panel.js";
import { startBrowser, waitForCdp, findAxeExtensionDir } from "./browser.js";
import { captureElement, capturePage, mediaAudit, inventory } from "./visual.js";
import { runScript, scriptsAvailable, SCRIPTS_DIR } from "./igt.js";
import { structureAudit } from "./structure.js";
import { setupEnvironment } from "./setup.js";
import { configureAxeExtension, showAxeDevToolsPanel } from "./extension.js";
import { navigatePage, openPage } from "./navigation.js";

const DEFAULT_ENDPOINT = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
let lastPid: number | null = null;

const server = new McpServer({ name: "axe-mcp", version: "0.2.0" });

server.registerTool(
  "setup_environment",
  {
    title: "Set up the containerized axe IGT environment",
    description:
      "Single first call for agents: launch Chromium with the axe DevTools extension, expose CDP, open the target URL, " +
      "and return noVNC/CDP details plus the seven IGT categories to complete. In Docker, Xvfb/noVNC are started by the container entrypoint.",
    inputSchema: {
      targetUrl: z.string().describe("The page URL to audit with all seven axe Intelligent Guided Tests."),
      port: z.number().int().optional().describe("Remote debugging port. Defaults to AXE_CDP_PORT or 9222."),
      profileDir: z.string().optional().describe("Browser profile directory. Defaults to AXE_PROFILE_DIR or ~/.axe-mcp-browser."),
      browserPath: z.string().optional().describe("Chromium executable path. Defaults to AXE_BROWSER_PATH or auto-discovery."),
      extensionDir: z.string().optional().describe("Unpacked axe DevTools extension path. Defaults to AXE_EXTENSION_DIR/AXE_EXT_DIR or auto-discovery."),
      waitMs: z.number().int().optional().describe("Max milliseconds to wait for CDP. Default 30000."),
    },
  },
  async (a) => {
    const r = await setupEnvironment(a);
    lastPid = r.pid;
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_extension_login",
  {
    title: "Configure/login to axe DevTools extension",
    description:
      "Shows the axe DevTools panel and attempts to log in using credentials from arguments or AXE_LOGIN_EMAIL/AXE_LOGIN_PASSWORD. " +
      "Server URL is normally configured at container startup through managed extension policy from AXE_SERVER_URL.",
    inputSchema: {
      cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
      email: z.string().optional().describe("axe account email. Defaults to AXE_LOGIN_EMAIL."),
      password: z.string().optional().describe("axe account password. Defaults to AXE_LOGIN_PASSWORD."),
    },
  },
  async (a) => {
    const r = await configureAxeExtension({
      endpoint: a.cdpEndpoint || DEFAULT_ENDPOINT,
      email: a.email || process.env.AXE_LOGIN_EMAIL,
      password: a.password || process.env.AXE_LOGIN_PASSWORD,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_open_devtools_panel",
  {
    title: "Open the axe DevTools panel",
    description:
      "Shows Chrome DevTools for the inspected page and selects the axe DevTools extension panel. Use this to repair the visible noVNC state before IGT work.",
    inputSchema: {
      cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
    },
  },
  async (a) => {
    const r = await showAxeDevToolsPanel(a.cdpEndpoint || DEFAULT_ENDPOINT);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_browser_open_page",
  {
    title: "Open a new browser page",
    description:
      "Open a new Chromium tab/page over CDP without replacing the current target page. " +
      "Use this when the agent needs a fresh page while keeping the existing page and axe DevTools state available.",
    inputSchema: {
      url: z.string().describe("URL to open. If no scheme is provided, https:// is prepended."),
      cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
      waitMs: z.number().int().optional().describe("Max milliseconds to wait for the new page to become interactive/complete. Default 15000."),
      newWindow: z.boolean().optional().describe("Open in a new browser window instead of a new tab/page. Default false."),
    },
  },
  async (a) => {
    const r = await openPage({
      endpoint: a.cdpEndpoint || DEFAULT_ENDPOINT,
      url: a.url,
      waitMs: a.waitMs,
      newWindow: a.newWindow,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_browser_navigate",
  {
    title: "Navigate an existing browser page",
    description:
      "Change the URL of an already-open Chromium page over CDP without restarting the browser/container. " +
      "Use this when the agent needs to modify the address of the target page during IGT work.",
    inputSchema: {
      url: z.string().describe("URL to navigate to. If no scheme is provided, https:// is prepended."),
      cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
      urlContains: z.string().optional().describe("Navigate the existing page whose current URL contains this string."),
      targetId: z.string().optional().describe("Navigate this exact CDP targetId. Overrides urlContains."),
      waitMs: z.number().int().optional().describe("Max milliseconds to wait for the new page to become interactive/complete. Default 15000."),
    },
  },
  async (a) => {
    const r = await navigatePage({
      endpoint: a.cdpEndpoint || DEFAULT_ENDPOINT,
      url: a.url,
      urlContains: a.urlContains,
      targetId: a.targetId,
      waitMs: a.waitMs,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_browser_start",
  {
    title: "Start axe-enabled browser",
    description:
      "Launch a Chromium-family browser (prefers BrowserOS) with the installed axe DevTools extension loaded, " +
      "DevTools auto-opening, and a CDP endpoint exposed. Run this before axe_panel_scan unless such a browser is " +
      "already running. Uses a dedicated profile so it won't disturb your everyday browser.",
    inputSchema: {
      url: z.string().optional().describe("URL to open in the tab that will be scanned. Default about:blank."),
      port: z.number().int().optional().describe("Remote debugging port (default 9222)."),
    },
  },
  async (a) => {
    const info = startBrowser({ url: a.url, port: a.port });
    lastPid = info.pid;
    const cdpReady = await waitForCdp(info.endpoint);
    return { content: [{ type: "text" as const, text: JSON.stringify({ ...info, cdpReady }, null, 2) }] };
  }
);

server.registerTool(
  "axe_panel_scan",
  {
    title: "Scan with the real axe DevTools panel",
    description:
      "Drive Deque's actual axe DevTools extension panel through the DevTools UI: show the panel, click Scan, and " +
      "return the panel's own results — totals by impact (critical/serious/moderate/minor) plus the per-issue list. " +
      "Attaches to a browser from axe_browser_start (or any browser launched with the axe extension, " +
      "--remote-debugging-port and --auto-open-devtools-for-tabs).",
    inputSchema: {
      navigateTo: z.string().optional().describe("Navigate the inspected tab to this URL before scanning."),
      scanType: z.enum(["full", "partial"]).optional().describe('Panel scan to run (default "full").'),
      cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
      timeoutMs: z.number().int().optional().describe("Max ms to wait for results (default 30000)."),
    },
  },
  async (a) => {
    const res = await panelScan({
      endpoint: a.cdpEndpoint || DEFAULT_ENDPOINT,
      navigateTo: a.navigateTo,
      scanType: a.scanType,
      timeoutMs: a.timeoutMs,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }] };
  }
);

server.registerTool(
  "axe_browser_stop",
  {
    title: "Stop the axe browser",
    description: "Stop the browser started by axe_browser_start.",
    inputSchema: { pid: z.number().int().optional().describe("PID to stop (defaults to the last one started).") },
  },
  async (a) => {
    const pid = a.pid ?? lastPid;
    if (!pid) return { content: [{ type: "text" as const, text: "No tracked browser pid." }] };
    let stopped = false;
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, "SIGTERM");
        stopped = true;
      } catch {}
    }
    if (pid === lastPid) lastPid = null;
    return { content: [{ type: "text" as const, text: JSON.stringify({ stopped, pid }) }] };
  }
);

server.registerTool(
  "axe_capture_element",
  {
    title: "Screenshot an element for visual judgment",
    description:
      "Capture a cropped screenshot of a specific element in the inspected page (by CSS selector) plus its a11y metadata " +
      "(tag/role/alt/aria-label/tabindex/text). Use this to ANSWER guided-test judgment questions by actually looking at the " +
      "element — e.g. is an image decorative or informative, does the alt text match, is a focus indicator visible.",
    inputSchema: {
      selector: z.string().describe("CSS selector of the element to capture in the page."),
      urlContains: z.string().optional().describe("Pick the inspected tab whose URL contains this (default: first page)."),
      cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
    },
  },
  async (a) => {
    const r = await captureElement(a.cdpEndpoint || DEFAULT_ENDPOINT, a.selector, a.urlContains);
    return {
      content: [
        { type: "image" as const, data: r.base64, mimeType: "image/png" },
        { type: "text" as const, text: JSON.stringify(r.meta, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "axe_capture_page",
  {
    title: "Screenshot the inspected page",
    description:
      "Capture a screenshot of the inspected page (viewport or full scrollable page). Useful for overall layout, reading order, and structure judgments.",
    inputSchema: {
      fullPage: z.boolean().optional().describe("Capture the full scrollable page (default false = viewport)."),
      urlContains: z.string().optional(),
      cdpEndpoint: z.string().optional(),
    },
  },
  async (a) => {
    const r = await capturePage(a.cdpEndpoint || DEFAULT_ENDPOINT, a.fullPage ?? false, a.urlContains);
    return { content: [{ type: "image" as const, data: r.base64, mimeType: "image/png" }] };
  }
);

server.registerTool(
  "axe_inventory",
  {
    title: "Inventory page elements for guided audit",
    description:
      "Enumerate the inspected page's candidate elements by category — images (with alt), form fields (with accessible-name status), interactive elements (real vs fake controls), headings, landmarks (present + missing), tables (data vs layout). Each element gets a stable [data-axe-id] selector you can pass to axe_capture_element. Use this to drive a Claude-powered guided audit of the categories axe's automatic rules can't fully judge.",
    inputSchema: { urlContains: z.string().optional(), cdpEndpoint: z.string().optional() },
  },
  async (a) => {
    const r = await inventory(a.cdpEndpoint || DEFAULT_ENDPOINT, a.urlContains);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_media_audit",
  {
    title: "Audit audio/video accessibility",
    description:
      "List <audio>/<video> elements in the inspected page and whether they have captions, descriptions, accessible names, " +
      "and controls — the media/audio side of accessibility, complementing the visual checks.",
    inputSchema: { urlContains: z.string().optional(), cdpEndpoint: z.string().optional() },
  },
  async (a) => {
    const r = await mediaAudit(a.cdpEndpoint || DEFAULT_ENDPOINT, a.urlContains);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

server.registerTool(
  "axe_structure_audit",
  {
    title: "Audit page structure",
    description:
      "Run a deterministic Structure-category audit against the inspected page: headings, heading order, document language, " +
      "title, common landmarks, and lists. This is the first Claude-powered guided category helper and does not require axe Pro.",
    inputSchema: { urlContains: z.string().optional(), cdpEndpoint: z.string().optional() },
  },
  async (a) => {
    const r = await structureAudit(a.cdpEndpoint || DEFAULT_ENDPOINT, a.urlContains);
    return { content: [{ type: "text" as const, text: JSON.stringify(r, null, 2) }] };
  }
);

// ---------------------------------------------------------------------------
// Intelligent Guided Test (IGT) mechanics. These tools are the PREDICTABLE
// layer: deterministic CDP driving via the proven scripts in
// skills/axe-guided-testing/scripts (single source of truth). The JUDGMENT
// layer — how to answer each wizard question, when to refute AI prefills,
// recovery from the unexpected — lives in the axe-guided-testing skill; read
// its SKILL.md and references before driving.
// ---------------------------------------------------------------------------
const common = {
  cdpEndpoint: z.string().optional().describe(`CDP endpoint. Default ${DEFAULT_ENDPOINT}.`),
  urlContains: z.string().optional().describe("Pick the inspected tab whose URL contains this (default: first page)."),
};
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

server.registerTool(
  "axe_igt_launch",
  {
    title: "Launch a guided test category",
    description:
      "Start an Intelligent Guided Test from the axe dashboard: trusted-clicks the category card's \"+\" (or title), " +
      "then Start/Resume, detaches during capture/AI analysis, and polls until the first wizard question. Returns the " +
      "question state. Categories: Images, Table, Keyboard, Modal Dialog, Interactive Elements, Structure, Forms. " +
      "Can run for minutes when the category AI-analyzes the page.",
    inputSchema: {
      category: z.string().describe('Category name as shown on the dashboard, e.g. "Table".'),
      handoffSeconds: z.number().int().optional().describe("Hands-off wait before polling (default 40)."),
      ...common,
    },
  },
  async (a) => text(await runScript("igt-launch.mjs", [a.category, String(a.handoffSeconds ?? 40)], { ...a, timeoutMs: 600_000 }))
);

server.registerTool(
  "axe_igt_state",
  {
    title: "Dump current wizard state",
    description:
      "Scrape the IGT wizard's current screen: headings (the question), radios/checkboxes with checked state and labels, " +
      "buttons, body text, analyzing flag. Also writes a panel screenshot to /tmp/igt-now.png. Call after every answer to " +
      "verify the wizard advanced.",
    inputSchema: { ...common },
  },
  async (a) => text(await runScript("igt-step.mjs", ["--dump"], a))
);

server.registerTool(
  "axe_igt_answer",
  {
    title: "Answer the current wizard question",
    description:
      "Drive one wizard interaction with TRUSTED input (user activation) on the panel session: " +
      "radio = click radio by index then Next; radioOnly = click several radios (corrections), NO Next; " +
      "check = toggle checkbox by index; button = click button matching a regex (e.g. \"^next$\", \"^finish$\", \"^save$\", " +
      "\"^select all$\"); scroll = scroll the wizard's inner pane to y. Returns the resulting state.",
    inputSchema: {
      action: z.enum(["radio", "radioOnly", "check", "button", "scroll"]),
      value: z.string().describe("radio/check: index. radioOnly: space-separated indices. button: regex. scroll: y px."),
      ...common,
    },
  },
  async (a) => {
    const args =
      a.action === "radioOnly" ? ["--radio-only", ...a.value.split(/\s+/)] : [`--${a.action}`, a.value];
    return text(await runScript("igt-step.mjs", args, a));
  }
);

server.registerTool(
  "axe_igt_rows",
  {
    title: "Scrape Images batch-review rows",
    description:
      "Images IGT step-4 review list: one row per image with the AI-prefilled YES/NO, the radio indices to flip it, " +
      "y-offset, and the row's raw text (accessible name etc.). Use with axe_igt_answer radioOnly to correct wrong prefills.",
    inputSchema: { ...common },
  },
  async (a) => text(await runScript("igt-rows.mjs", [], a))
);

server.registerTool(
  "axe_igt_review_rows",
  {
    title: "Scrape Keyboard/Interactive review list",
    description:
      "AI-review lists (Keyboard, Interactive Elements): every element with its status (Passed/Failed/Pending), " +
      "description (role + accessible name), and which rules currently FAIL. Verdicts are parsed from the per-element " +
      "'Mark as passed/failed' button labels.",
    inputSchema: { ...common },
  },
  async (a) => text(await runScript("igt-review-rows.mjs", [], a))
);

server.registerTool(
  "axe_igt_flip",
  {
    title: "Flip review verdicts",
    description:
      "Flip per-element rule verdicts in an AI-review list (expands each element card, trusted-clicks 'Mark as passed/failed', " +
      "verifies). ONLY flip after empirical evidence (axe_page_keys / axe_page_eval) contradicts the AI.",
    inputSchema: {
      to: z.enum(["passed", "failed"]),
      rule: z.string().describe('Exact rule text, e.g. "Function cannot be performed by keyboard alone".'),
      elements: z.array(z.number().int()).describe("Element numbers from axe_igt_review_rows."),
      ...common,
    },
  },
  async (a) =>
    text(await runScript("igt-flip.mjs", ["--to", a.to, "--rule", a.rule, ...a.elements.map(String)], { ...a, timeoutMs: 420_000 }))
);

server.registerTool(
  "axe_igt_highlight",
  {
    title: "Highlight review elements on the page",
    description:
      "For each element number: clicks its 'Highlight element' button in the panel, then screenshots the PAGE to " +
      "/tmp/igt-el-<n>.png so the flagged control can be SEEN (highlights are ephemeral). Read the files to look.",
    inputSchema: { elements: z.array(z.number().int()), ...common },
  },
  async (a) => text(await runScript("igt-highlight.mjs", a.elements.map(String), { ...a, timeoutMs: 300_000 }))
);

server.registerTool(
  "axe_igt_edit",
  {
    title: "Open an Interactive-Elements result editor",
    description:
      "Expands element n's card and opens its 'Edit result' editor (accessible-name accuracy radios, role select, states), " +
      "dumps the editor + screenshot to /tmp/igt-edit.png. Close afterwards with axe_igt_answer button \"^cancel$\" (or \"^save$\").",
    inputSchema: { element: z.number().int(), ...common },
  },
  async (a) => text(await runScript("igt-edit.mjs", [String(a.element)], a))
);

server.registerTool(
  "axe_igt_dash",
  {
    title: "Read the IGT dashboard",
    description:
      "Scrape the axe dashboard: Automatic/Intelligent Guided Testing % complete and every category's Runs / Total issues / " +
      "Completed line (the proof a run recorded), plus a screenshot. Use after each Finish.",
    inputSchema: { ...common },
  },
  async (a) => text(await runScript("dash.mjs", [], a))
);

server.registerTool(
  "axe_page_eval",
  {
    title: "Evaluate JS in the inspected page",
    description:
      "Ground-truth the page DOM before answering wizard questions: runs a JS expression in the inspected page and returns " +
      "the result (return JSON.stringify(...) for structures). This is the evidence-gathering tool — use liberally.",
    inputSchema: { expression: z.string(), ...common },
  },
  async (a) => text(await runScript("page-eval.mjs", [a.expression], a))
);

server.registerTool(
  "axe_page_click",
  {
    title: "Trusted click on a PAGE element",
    description:
      "Trusted (user-activation) click on an element of the inspected page, by exact visible text or CSS selector. " +
      "Needed when a wizard enters mouse-selection mode ('click the label/heading on the page').",
    inputSchema: {
      textContent: z.string().optional().describe("Exact visible text of the element."),
      selector: z.string().optional().describe("CSS selector (used if textContent not given)."),
      ...common,
    },
  },
  async (a) => {
    const args = a.textContent ? ["--text", a.textContent] : a.selector ? ["--selector", a.selector] : null;
    if (!args) return text("ERROR: provide textContent or selector");
    return text(await runScript("page-click.mjs", args, a));
  }
);

server.registerTool(
  "axe_page_keys",
  {
    title: "Empirical keyboard test on the page",
    description:
      "THE tool for verifying/refuting 'function cannot be performed by keyboard alone': enables focus emulation and sends " +
      "trusted keys with default actions. Either focus a selector and send keys (reporting active element, checked state, and " +
      "an optional /regex/ watched in body text), or tab-walk N stops from the top.",
    inputSchema: {
      focus: z.string().optional().describe("CSS selector to focus first."),
      keys: z.array(z.string()).optional().describe('Keys to send, e.g. ["ArrowDown","Enter"].'),
      tabWalk: z.number().int().optional().describe("Instead: press Tab N times, listing focus stops."),
      watch: z.string().optional().describe("JS regex literal (e.g. \"/Book your Trip/\") tested against body text in each snapshot."),
      ...common,
    },
  },
  async (a) => {
    const args = a.tabWalk
      ? ["--tab-walk", String(a.tabWalk)]
      : [...(a.focus ? ["--focus", a.focus] : []), ...(a.keys ?? []), ...(a.watch ? ["--watch", a.watch] : [])];
    return text(await runScript("page-keys.mjs", args, a));
  }
);

server.registerTool(
  "axe_form_probe",
  {
    title: "Form-submit experiment on a throwaway tab",
    description:
      "Answers the Forms wizard's 'submit blank / bad data — does an error show?' questions WITHOUT touching the IGT tab: " +
      "opens the URL in a disposable tab, optionally fills fields, trusted-clicks the submit selector, reports visible " +
      "errors or navigation, closes the tab. Navigation with no error ⇒ answer No.",
    inputSchema: {
      url: z.string(),
      clickSelector: z.string().describe("CSS selector of the submit control."),
      fills: z.array(z.string()).optional().describe('Each "selector=value", e.g. "#from0=@@junk@@".'),
      ...common,
    },
  },
  async (a) =>
    text(
      await runScript(
        "throwaway-submit.mjs",
        [a.url, "--click", a.clickSelector, ...(a.fills ?? []).flatMap((f) => ["--fill", f])],
        { ...a, timeoutMs: 120_000 }
      )
    )
);

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startStreamableHttp() {
  const port = Number(process.env.MCP_PORT || 3000);
  const host = process.env.MCP_HOST || "0.0.0.0";
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await server.connect(transport);

  const http = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, transport: "streamable-http" }));
        return;
      }
      if (url.pathname === "/livez") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
        return;
      }
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        await transport.handleRequest(req, res, body);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        await transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405, { "content-type": "text/plain" });
      res.end("method not allowed");
    } catch (error: any) {
      console.error("[axe-mcp] HTTP transport error:", error?.stack || error?.message || error);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal server error" }));
      }
    }
  });

  http.listen(port, host, () => {
    console.error(
      `[axe-mcp] ready (streamable-http). MCP: http://${host}:${port}/mcp. ` +
        `axe extension: ${findAxeExtensionDir() ? "found" : "NOT FOUND"}. Default CDP: ${DEFAULT_ENDPOINT}. ` +
        `IGT scripts: ${scriptsAvailable() ? SCRIPTS_DIR : "NOT FOUND (set AXE_IGT_SCRIPTS_DIR)"}`
    );
  });
}

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[axe-mcp] ready (stdio). axe extension: ${findAxeExtensionDir() ? "found" : "NOT FOUND"}. Default CDP: ${DEFAULT_ENDPOINT}. ` +
      `IGT scripts: ${scriptsAvailable() ? SCRIPTS_DIR : "NOT FOUND (set AXE_IGT_SCRIPTS_DIR)"}`
  );
}

if (process.env.MCP_TRANSPORT === "stdio") await startStdio();
else await startStreamableHttp();
