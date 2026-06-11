import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";

export interface ScanOptions {
  cdpEndpoint: string;
  urlContains?: string;
  pageIndex?: number;
  goto?: string;
  tags?: string[];
  include?: string;
  exclude?: string;
  showPanel?: boolean;
}

/**
 * Attach to an already-running browser over CDP, run `fn`, then disconnect.
 * Closing a connectOverCDP browser only detaches Playwright — your real browser keeps running.
 */
async function withBrowser<T>(endpoint: string, fn: (b: Browser) => Promise<T>): Promise<T> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch (e: any) {
    throw new Error(
      `Could not attach to a browser at ${endpoint}.\n` +
        `Launch a Chromium-family browser with a debug port first, e.g.:\n` +
        `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\\n` +
        `    --remote-debugging-port=9222 --remote-allow-origins=* \\\n` +
        `    --user-data-dir="$HOME/.axe-mcp-chrome"\n` +
        `Original error: ${e?.message ?? e}`
    );
  }
  try {
    return await fn(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

function realPages(browser: Browser): Page[] {
  const out: Page[] = [];
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      if (/^(https?|file):/.test(p.url())) out.push(p);
    }
  }
  return out;
}

function pickPage(browser: Browser, opts: ScanOptions): Page {
  const pages = realPages(browser);
  if (pages.length === 0) {
    throw new Error("No http(s)/file tabs are open in the attached browser. Open a page (or pass `goto`) and retry.");
  }
  if (typeof opts.pageIndex === "number") {
    const p = pages[opts.pageIndex];
    if (!p) throw new Error(`pageIndex ${opts.pageIndex} is out of range (0..${pages.length - 1}).`);
    return p;
  }
  if (opts.urlContains) {
    const p = pages.find((pg) => pg.url().includes(opts.urlContains!));
    if (!p) throw new Error(`No open tab's URL contains "${opts.urlContains}".`);
    return p;
  }
  return pages[0];
}

export async function listPages(endpoint: string) {
  return withBrowser(endpoint, async (browser) => {
    const pages = realPages(browser);
    const rows = [];
    for (let i = 0; i < pages.length; i++) {
      rows.push({ index: i, url: pages[i].url(), title: await pages[i].title().catch(() => "") });
    }
    return { endpoint, count: rows.length, pages: rows };
  });
}

export async function scan(opts: ScanOptions) {
  return withBrowser(opts.cdpEndpoint, async (browser) => {
    const page = pickPage(browser, opts);
    if (opts.goto) await page.goto(opts.goto, { waitUntil: "load" });

    let builder = new AxeBuilder({ page });
    if (opts.tags?.length) builder = builder.withTags(opts.tags);
    if (opts.include) builder = builder.include(opts.include);
    if (opts.exclude) builder = builder.exclude(opts.exclude);
    const results = await builder.analyze();

    const violations = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: v.nodes.map((n) => ({
        target: n.target as unknown as string[],
        html: n.html,
        failureSummary: n.failureSummary,
      })),
    }));

    const byImpact: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0, unknown: 0 };
    for (const v of violations) byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;

    if (opts.showPanel) {
      await page.evaluate(injectPanel as any, { violations, url: page.url() } as any);
    }

    return {
      url: page.url(),
      title: await page.title().catch(() => ""),
      testedWith: opts.tags?.length ? opts.tags : ["axe-core defaults"],
      totals: {
        rulesViolated: violations.length,
        elementsAffected: violations.reduce((a, v) => a + v.nodes.length, 0),
        byImpact,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
      },
      violations,
      panelInjected: !!opts.showPanel,
    };
  });
}

export async function clearPanel(endpoint: string, where: { urlContains?: string; pageIndex?: number }) {
  return withBrowser(endpoint, async (browser) => {
    const page = pickPage(browser, where as ScanOptions);
    await page.evaluate(() => (window as any).__axeMcpClear?.());
    return { cleared: true, url: page.url() };
  });
}

/* ---------------------------------------------------------------------------
 * injectPanel runs INSIDE the page via page.evaluate, so it must be fully
 * self-contained (no references to anything in module scope).
 * ------------------------------------------------------------------------- */
function injectPanel(data: { violations: any[]; url: string }) {
  const ID = "__axe_mcp_panel__";
  const existing = document.getElementById(ID);
  if (existing) existing.remove();

  const clearHl = () => {
    document.querySelectorAll("[data-axe-mcp-hl]").forEach((el) => {
      (el as HTMLElement).style.outline = (el as any).__axePrevOutline || "";
      el.removeAttribute("data-axe-mcp-hl");
    });
  };
  (window as any).__axeMcpClear = () => {
    const n = document.getElementById(ID);
    if (n) n.remove();
    clearHl();
  };

  const color: any = {
    critical: "#d7263d",
    serious: "#f46036",
    moderate: "#e2a400",
    minor: "#3aa0a0",
    unknown: "#888",
  };
  const esc = (s: string) =>
    (s || "").replace(/[&<>"]/g, (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[c]));

  const host = document.createElement("div");
  host.id = ID;
  host.style.cssText = "position:fixed;top:0;right:0;height:100vh;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });

  const elementCount = data.violations.reduce((a: number, v: any) => a + (v.nodes ? v.nodes.length : 0), 0);

  const rows = data.violations.length
    ? data.violations
        .map((v: any, i: number) => {
          const c = color[v.impact] || color.unknown;
          const nodes = (v.nodes || [])
            .map((n: any) => {
              const selector = Array.isArray(n.target) ? n.target.join(" ") : String(n.target);
              const why = esc((n.failureSummary || "").split("\n").slice(0, 2).join(" "));
              return `<div class="node" data-sel="${esc(selector)}"><code>${esc(selector)}</code><div class="why">${why}</div></div>`;
            })
            .join("");
          return `<div class="v" data-i="${i}">
              <div class="vh"><span class="dot" style="background:${c}"></span>
                <div><div class="vt">${esc(v.help)}</div>
                <div class="vm">${esc(v.impact)} &middot; ${v.nodes ? v.nodes.length : 0} element(s) &middot; <a href="${esc(
            v.helpUrl
          )}" target="_blank" rel="noopener">${esc(v.id)}</a></div></div>
              </div><div class="nodes">${nodes}</div></div>`;
        })
        .join("")
    : `<div class="empty">No violations found &#127881;</div>`;

  root.innerHTML =
    `<style>
      *{box-sizing:border-box;font-family:-apple-system,system-ui,'Segoe UI',sans-serif}
      .wrap{width:380px;height:100vh;overflow:auto;background:#1b1b1f;color:#eaeaea;box-shadow:-3px 0 14px rgba(0,0,0,.45)}
      .hd{position:sticky;top:0;background:#0f0f12;padding:11px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #2c2c33}
      .hd h1{margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7fe7c4}
      .hd button{background:#2a2a31;color:#eee;border:0;border-radius:5px;padding:4px 9px;cursor:pointer;font-size:12px}
      .sum{padding:10px 14px;font-size:12px;color:#aab;border-bottom:1px solid #26262c;line-height:1.45}
      .v{border-bottom:1px solid #26262c}
      .vh{padding:9px 14px;display:flex;gap:9px;align-items:flex-start;cursor:pointer}
      .vh:hover{background:#232329}
      .dot{width:10px;height:10px;border-radius:50%;margin-top:4px;flex:0 0 auto}
      .vt{font-size:13px;line-height:1.3}
      .vm{font-size:11px;color:#8c8c98;margin-top:3px}
      .vm a{color:#6cf;text-decoration:none}
      .nodes{display:none;padding:2px 14px 9px 33px}
      .v.open .nodes{display:block}
      .node{font-size:11px;color:#cfcfd6;padding:7px 9px;margin:6px 0;background:#26262d;border-radius:6px;cursor:pointer}
      .node:hover{background:#30303a}
      .node code{color:#7fe7c4;word-break:break-all}
      .why{color:#9a9aa6;margin-top:3px}
      .empty{padding:26px 14px;color:#7fe7c4;font-size:14px}
    </style>
    <div class="wrap">
      <div class="hd"><h1>axe &middot; mcp</h1><button id="x">&#10005; close</button></div>
      <div class="sum"><b>${data.violations.length}</b> rule(s) &middot; <b>${elementCount}</b> element(s)<br><span style="color:#777">${esc(
      data.url
    )}</span></div>
      ${rows}
    </div>`;

  (root.querySelector("#x") as HTMLElement).addEventListener("click", () => (window as any).__axeMcpClear());
  root.querySelectorAll(".vh").forEach((vh) =>
    vh.addEventListener("click", () => (vh.parentElement as HTMLElement).classList.toggle("open"))
  );
  root.querySelectorAll(".node").forEach((nd) =>
    nd.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const selector = (nd as HTMLElement).dataset.sel || "";
      const last = selector.split(" ").filter(Boolean).pop() || selector;
      let el: HTMLElement | null = null;
      try {
        el = document.querySelector(last) as HTMLElement;
      } catch (_) {}
      if (!el) {
        try {
          el = document.querySelector(selector) as HTMLElement;
        } catch (_) {}
      }
      if (!el) return;
      clearHl();
      (el as any).__axePrevOutline = el.style.outline;
      el.style.outline = "3px solid #f46036";
      el.style.outlineOffset = "1px";
      el.setAttribute("data-axe-mcp-hl", "1");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    })
  );

  document.documentElement.appendChild(host);
}
