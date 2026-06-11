// Quick check of the visual tool: capture an element screenshot + metadata.
import { captureElement } from "../dist/visual.js";
import fs from "node:fs";
const sel = process.argv[2] || "#images img";
const out = process.argv[3] || "/tmp/axe-el.png";
const r = await captureElement(process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222", sel);
fs.writeFileSync(out, Buffer.from(r.base64, "base64"));
console.log("meta:", JSON.stringify(r.meta));
console.log("saved", out);
process.exit(0);
