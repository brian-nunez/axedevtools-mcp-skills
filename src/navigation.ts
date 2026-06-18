import { CDP, TargetInfo, sleep } from "./cdp.js";

export interface NavigatePageOptions {
  endpoint: string;
  url: string;
  urlContains?: string;
  targetId?: string;
  waitMs?: number;
}

export interface OpenPageOptions {
  endpoint: string;
  url: string;
  waitMs?: number;
  newWindow?: boolean;
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isNavigablePage(target: TargetInfo) {
  return (
    target.type === "page" &&
    !/^devtools:\/\//i.test(target.url) &&
    !/^chrome:\/\//i.test(target.url) &&
    !/^chrome-extension:\/\//i.test(target.url)
  );
}

function chooseTarget(targets: TargetInfo[], urlContains?: string, targetId?: string) {
  const pages = targets.filter(isNavigablePage);
  if (targetId) return pages.find((target) => target.targetId === targetId) ?? null;
  if (urlContains) return pages.find((target) => target.url.includes(urlContains)) ?? null;
  return pages.find((target) => /^https?:\/\//i.test(target.url)) ?? pages[0] ?? null;
}

export async function navigatePage(opts: NavigatePageOptions) {
  const cdp = await CDP.connect(opts.endpoint);
  const nextUrl = normalizeUrl(opts.url);
  const waitMs = opts.waitMs ?? 15_000;
  try {
    const targets = await cdp.targets();
    const target = chooseTarget(targets, opts.urlContains, opts.targetId);
    if (!target) {
      return {
        ok: false,
        reason: "No navigable page target found",
        availablePages: targets
          .filter((t) => t.type === "page")
          .map((t) => ({ targetId: t.targetId, title: t.title, url: t.url })),
      };
    }

    const session = await cdp.attach(target.targetId);
    try {
      await cdp.send("Page.enable", {}, session).catch(() => {});
      await cdp.send("Page.bringToFront", {}, session).catch(() => {});
      await cdp.send("Page.navigate", { url: nextUrl }, session);

      const deadline = Date.now() + waitMs;
      let finalUrl = nextUrl;
      let readyState: string | null = null;
      while (Date.now() < deadline) {
        const state = await cdp
          .evalIn(
            session,
            `(()=>JSON.stringify({url: location.href, readyState: document.readyState}))()`
          )
          .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
          .catch(() => null);
        if (state?.url) finalUrl = state.url;
        if (state?.readyState) readyState = state.readyState;
        if (finalUrl !== "about:blank" && (readyState === "interactive" || readyState === "complete")) break;
        await sleep(250);
      }

      return {
        ok: true,
        targetId: target.targetId,
        previousUrl: target.url,
        requestedUrl: opts.url,
        navigatedUrl: nextUrl,
        finalUrl,
        readyState,
      };
    } finally {
      await cdp.detach(session).catch(() => {});
    }
  } finally {
    cdp.close();
  }
}

export async function openPage(opts: OpenPageOptions) {
  const cdp = await CDP.connect(opts.endpoint);
  const nextUrl = normalizeUrl(opts.url);
  const waitMs = opts.waitMs ?? 15_000;
  try {
    const created = await cdp.send("Target.createTarget", {
      url: nextUrl,
      newWindow: opts.newWindow ?? false,
    });
    const targetId = created.targetId as string;
    await cdp.send("Target.activateTarget", { targetId }).catch(() => {});

    const session = await cdp.attach(targetId);
    try {
      await cdp.send("Page.enable", {}, session).catch(() => {});
      await cdp.send("Page.bringToFront", {}, session).catch(() => {});

      const deadline = Date.now() + waitMs;
      let finalUrl = nextUrl;
      let readyState: string | null = null;
      let title = "";
      while (Date.now() < deadline) {
        const state = await cdp
          .evalIn(
            session,
            `(()=>JSON.stringify({url: location.href, readyState: document.readyState, title: document.title}))()`
          )
          .then((s) => (typeof s === "string" ? JSON.parse(s) : s))
          .catch(() => null);
        if (state?.url) finalUrl = state.url;
        if (state?.readyState) readyState = state.readyState;
        if (state?.title) title = state.title;
        if (finalUrl !== "about:blank" && (readyState === "interactive" || readyState === "complete")) break;
        await sleep(250);
      }

      return {
        ok: true,
        targetId,
        requestedUrl: opts.url,
        openedUrl: nextUrl,
        finalUrl,
        title,
        readyState,
        newWindow: opts.newWindow ?? false,
      };
    } finally {
      await cdp.detach(session).catch(() => {});
    }
  } finally {
    cdp.close();
  }
}
