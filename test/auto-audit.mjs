// FULLY AUTONOMOUS guided accessibility audit — no human in the loop.
//   launch -> automatic scan -> inventory -> DETERMINISTIC heuristic judges
//   -> VISION judge (pluggable: Anthropic API / local Ollama vision model) for the
//      narrow "must see it" cases -> aggregated report.
//
// Usage: node test/auto-audit.mjs <url> [--no-vision]
import { startBrowser, waitForCdp } from "../dist/browser.js";
import { panelScan } from "../dist/panel.js";
import { inventory, captureElement, mediaAudit } from "../dist/visual.js";
import fs from "node:fs";

const url = process.argv[2] || "https://www.example.com";
const useVision = !process.argv.includes("--no-vision");
const VISION_MODEL = process.env.AXE_VISION_MODEL || "moondream";
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
const OUT = process.env.AXE_OUT || "/tmp/auto-audit.json";

// ---------- deterministic heuristic judges (no LLM, no human) ----------
const FILENAME_RE = /\.(jpe?g|png|gif|svg|webp|bmp|ico)\s*$/i;
const JUNK_ALT = new Set(["...", "image", "photo", "picture", "img", "graphic", "untitled", "image.", "thumbnail"]);

function judgeImages(images) {
  const out = [];
  for (const im of images) {
    const alt = (im.alt ?? "").trim();
    if (!im.hasAlt) {
      if (im.w >= 16 && im.h >= 16) out.push({ cat: "Images", sev: "critical", el: im.selector, rule: "image-alt", verdict: "fail", why: `Missing alt (${im.file} ${im.w}x${im.h})` });
    } else if (alt === "") {
      out.push({ cat: "Images", sev: "review", el: im.selector, rule: "decorative?", verdict: "needs-vision", why: `Empty alt — confirm the image is truly decorative`, alt });
    } else if (FILENAME_RE.test(alt) || /^IMG[_-]?\d/i.test(alt)) {
      out.push({ cat: "Images", sev: "serious", el: im.selector, rule: "alt-is-filename", verdict: "fail", why: `Alt is a filename, not a description: "${alt}"` });
    } else if (JUNK_ALT.has(alt.toLowerCase())) {
      out.push({ cat: "Images", sev: "serious", el: im.selector, rule: "alt-meaningless", verdict: "fail", why: `Meaningless alt: "${alt}"` });
    } else {
      out.push({ cat: "Images", sev: "review", el: im.selector, rule: "alt-accuracy", verdict: "needs-vision", why: `Alt present ("${alt}") — verify it matches the image`, alt });
    }
  }
  return out;
}

function judgeForms(fields) {
  return fields
    .filter((f) => f.type !== "submit" && f.type !== "button" && f.type !== "hidden")
    .flatMap((f) => {
      if (!f.hasLabel) {
        const placeholderOnly = !!f.placeholder;
        return [{ cat: "Forms", sev: "serious", el: f.selector, rule: placeholderOnly ? "placeholder-as-label" : "no-label",
          verdict: "fail", why: placeholderOnly ? `Only a placeholder ("${f.placeholder}"), no real label` : `Field has no programmatic label (${f.tag}${f.name ? " " + f.name : ""})` }];
      }
      return [];
    });
}

function judgeInteractive(items) {
  const out = [];
  for (const it of items) {
    if (it.looksClickableButNotNative) out.push({ cat: "Interactive", sev: "critical", el: it.selector, rule: "fake-control", verdict: "fail", why: `<${it.tag}> behaves like a control but has no role/keyboard support` });
    const name = (it.accessibleName ?? "").trim();
    if ((it.tag === "a" || it.tag === "button" || it.role === "button" || it.role === "link") && !name) out.push({ cat: "Interactive", sev: "serious", el: it.selector, rule: "no-accessible-name", verdict: "fail", why: `<${it.tag}> has no accessible name` });
    if (it.tabindex && parseInt(it.tabindex, 10) > 0) out.push({ cat: "Interactive", sev: "moderate", el: it.selector, rule: "positive-tabindex", verdict: "fail", why: `tabindex=${it.tabindex} hijacks focus order` });
  }
  return out;
}

function judgeStructure(inv) {
  const out = [];
  for (const lm of inv.landmarksMissing) out.push({ cat: "Structure", sev: "serious", el: "(page)", rule: "missing-landmark", verdict: "fail", why: `No ${lm} landmark — users can't navigate by region/skip to it` });
  const levels = inv.headings.map((h) => parseInt(h.level.slice(1), 10)).filter((n) => n >= 1 && n <= 6);
  const h1 = levels.filter((l) => l === 1).length;
  if (h1 === 0) out.push({ cat: "Structure", sev: "serious", el: "(page)", rule: "no-h1", verdict: "fail", why: "Page has no <h1>" });
  if (h1 > 1) out.push({ cat: "Structure", sev: "moderate", el: "(page)", rule: "multiple-h1", verdict: "fail", why: `Page has ${h1} <h1> elements` });
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) { out.push({ cat: "Structure", sev: "moderate", el: "(page)", rule: "skipped-heading", verdict: "fail", why: `Heading jumps h${levels[i - 1]}→h${levels[i]} ("${inv.headings[i].text}")` }); break; }
  return out;
}

function judgeTables(tables) {
  return tables.flatMap((t) =>
    t.likelyLayout
      ? [{ cat: "Tables", sev: "moderate", el: t.selector, rule: "layout-table", verdict: "fail", why: `<table> used for layout (${t.rows}×${t.cols}, no <th>) — use CSS/role=presentation` }]
      : !t.hasTh
      ? [{ cat: "Tables", sev: "serious", el: t.selector, rule: "no-headers", verdict: "fail", why: `Data table has no <th> header cells` }]
      : []
  );
}

// ---------- vision judge (pluggable; degrades gracefully) ----------
async function ollamaVision(imageB64, prompt) {
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: VISION_MODEL, prompt, images: [imageB64], stream: false, options: { temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}`);
  const j = await res.json();
  return (j.response || "").trim();
}

async function visionAvailable() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    const j = await r.json();
    return (j.models || []).some((m) => m.name.startsWith(VISION_MODEL));
  } catch {
    return false;
  }
}

function classify(resp) {
  const s = resp.toLowerCase();
  if (/\bfail\b|\bno\b|not (accurate|descriptive|decorative)|informative/.test(s.slice(0, 40))) return "fail";
  if (/\bpass\b|\byes\b|accurate|decorative|matches/.test(s.slice(0, 40))) return "pass";
  return "unclear";
}

async function runVision(endpoint, finding) {
  const { base64 } = await captureElement(endpoint, finding.el, undefined);
  let prompt;
  if (finding.rule === "decorative?")
    prompt = `You are an accessibility auditor. This image currently has EMPTY alt text, so screen readers ignore it. Look at the image. If it conveys meaningful content a blind user needs, answer "FAIL: informative". If it is purely decorative, answer "PASS: decorative". Then 5 words why.`;
  else
    prompt = `You are an accessibility auditor. This image's alt text is: "${finding.alt}". Look at the image. If the alt accurately and usefully describes what is shown, answer "PASS". If it does not match the image, answer "FAIL". Then a colon and 6 words of reason.`;
  const resp = await ollamaVision(base64, prompt);
  const cls = classify(resp);
  return { ...finding, verdict: cls === "fail" ? "fail" : cls === "pass" ? "pass" : "review", visionModel: VISION_MODEL, visionSays: resp.replace(/\s+/g, " ").slice(0, 120) };
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const info = startBrowser({ url, port: 9222 });
  await waitForCdp(info.endpoint, 30000);
  await new Promise((r) => setTimeout(r, 6000));
  const endpoint = info.endpoint;

  const scan = await panelScan({ endpoint, scanType: "full", timeoutMs: 90000 }).catch((e) => ({ error: String(e.message) }));
  const inv = await inventory(endpoint);
  const media = await mediaAudit(endpoint).catch(() => ({ count: 0, media: [] }));

  // deterministic pass
  let findings = [
    ...judgeImages(inv.images),
    ...judgeForms(inv.formFields),
    ...judgeInteractive(inv.interactive),
    ...judgeStructure(inv),
    ...judgeTables(inv.tables),
  ];

  // vision pass for the needs-vision items
  const haveVision = useVision && (await visionAvailable());
  let visionJudged = 0;
  if (haveVision) {
    const pending = findings.filter((f) => f.verdict === "needs-vision");
    for (const f of pending) {
      try {
        const judged = await runVision(endpoint, f);
        Object.assign(f, judged);
        visionJudged++;
      } catch (e) {
        f.why += ` [vision error: ${e.message}]`;
      }
    }
  }

  const counts = findings.reduce((a, f) => ((a[f.verdict] = (a[f.verdict] || 0) + 1), a), {});
  const report = {
    url,
    durationSec: Math.round((Date.now() - t0) / 1000),
    visionJudge: haveVision ? VISION_MODEL : "none (heuristics only)",
    automatic: scan.totals ? { total: scan.totals.total, byImpact: { critical: scan.totals.critical, serious: scan.totals.serious } } : scan,
    guided: { counts, visionJudged, total: findings.length },
    media,
    findings,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // printed summary
  console.log(`\n=== AUTONOMOUS GUIDED AUDIT: ${url} ===`);
  console.log(`time ${report.durationSec}s · vision judge: ${report.visionJudge}`);
  console.log(`automatic: ${scan.totals ? scan.totals.total + " issues" : "n/a"} | guided findings: ${findings.length} (` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") + `)`);
  for (const cat of ["Images", "Forms", "Interactive", "Structure", "Tables"]) {
    const fs2 = findings.filter((f) => f.cat === cat && f.verdict === "fail");
    if (!fs2.length) continue;
    console.log(`\n${cat} — ${fs2.length} fail:`);
    for (const f of fs2.slice(0, 8)) console.log(`  ✗ [${f.sev}] ${f.why}${f.visionSays ? `  (vision: ${f.visionSays})` : ""}`);
  }
  const nv = findings.filter((f) => f.verdict === "needs-vision");
  if (nv.length) console.log(`\n${nv.length} item(s) deferred (no vision judge available).`);
  console.log(`\nfull report -> ${OUT}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL", e); process.exit(1); });
