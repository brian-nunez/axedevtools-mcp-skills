import assert from "node:assert/strict";
import fs from "node:fs";
import { analyzeStructureSnapshot } from "../dist/structure.js";

const html = fs.readFileSync(new URL("./a11y-test-page.html", import.meta.url), "utf8");

const stripTags = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
const lang = html.match(/<html[^>]*\slang=["']?([^"'\s>]+)/i)?.[1] ?? null;
const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m, i) => ({
  selector: `h${m[1]}:nth-heading(${i + 1})`,
  level: Number(m[1]),
  tag: `h${m[1]}`,
  text: stripTags(m[2]),
}));
const lists = [...html.matchAll(/<(ul|ol|dl)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m, i) => ({
  selector: `${m[1]}:nth-list(${i + 1})`,
  tag: m[1].toLowerCase(),
  itemCount:
    m[1].toLowerCase() === "dl"
      ? [...m[2].matchAll(/<(dt|dd)\b/gi)].length
      : [...m[2].matchAll(/<li\b/gi)].length,
  text: stripTags(m[2]),
}));
const landmarkChecks = {
  banner: /<header\b|role=["']banner["']/i,
  navigation: /<nav\b|role=["']navigation["']/i,
  main: /<main\b|role=["']main["']/i,
  contentinfo: /<footer\b|role=["']contentinfo["']/i,
};
const landmarksPresent = Object.entries(landmarkChecks)
  .filter(([, re]) => re.test(html))
  .map(([name]) => name);
const landmarksMissing = Object.keys(landmarkChecks).filter((name) => !landmarksPresent.includes(name));

const result = analyzeStructureSnapshot({
  url: "file:test/a11y-test-page.html",
  title,
  lang,
  headings,
  lists,
  landmarksPresent,
  landmarksMissing,
});

assert.equal(result.summary.headings, 10);
assert.equal(result.summary.lists, 1);
assert.deepEqual(
  result.issues.filter((issue) => issue.rule === "heading-order").map((issue) => issue.message),
  ["Heading level skips from h2 to h4: Skipped from h2 to h4 (heading-order issue)"]
);
assert.equal(result.issues.some((issue) => issue.rule === "html-lang"), false);
assert.equal(result.issues.some((issue) => issue.rule === "document-title"), false);
assert.equal(result.issues.some((issue) => issue.rule === "missing-landmark"), false);

console.log(JSON.stringify({ ok: true, structureIssues: result.issues }, null, 2));
