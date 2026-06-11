// Direct test: does the local vision model actually describe an element screenshot?
import { captureElement } from "../dist/visual.js";
const sel = process.argv[2] || "#images img";
const model = process.env.AXE_VISION_MODEL || "moondream";
const r = await captureElement(process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222", sel);
console.log("captured", sel, `${r.meta.w}x${r.meta.h}`, "alt=", JSON.stringify(r.meta.alt));
const res = await fetch("http://localhost:11434/api/generate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, prompt: "Describe this image in one short sentence.", images: [r.base64], stream: false, options: { temperature: 0 } }),
});
const j = await res.json();
console.log("http", res.status, "| done_reason:", j.done_reason, "| eval_count:", j.eval_count);
console.log("RESPONSE:", JSON.stringify(j.response));
if (j.error) console.log("ERROR:", j.error);
process.exit(0);
