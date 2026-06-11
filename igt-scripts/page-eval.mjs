// Evaluate a JS expression in the inspected PAGE and print the result.
// Use for DOM ground-truthing before answering any wizard question.
//   node page-eval.mjs 'document.querySelectorAll("table").length'
//   node page-eval.mjs 'JSON.stringify([...document.querySelectorAll("h1,h2")].map(h=>h.textContent.trim()))'
import { cdp, pageTarget } from "./igt-lib.mjs";

const expr = process.argv[2];
if (!expr) { console.log("usage: page-eval.mjs '<js expression>'"); process.exit(1); }
const api = await cdp();
const page = await pageTarget(api);
if (!page) { console.log("no page target"); process.exit(1); }
const s = await api.attach(page.targetId);
try {
  const out = await api.evalIn(s, expr);
  console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
} catch (e) {
  console.error("EVAL ERROR:", e.message);
  process.exitCode = 1;
}
await api.detach(s);
api.close();
process.exit();
