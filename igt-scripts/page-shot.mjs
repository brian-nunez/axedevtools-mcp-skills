// Screenshot the inspected PAGE (downscaled for vision input).
//   node page-shot.mjs /tmp/page.png ["#cssSelectorToScrollTo"]
import { cdp, pageShot } from "./igt-lib.mjs";

const path = process.argv[2] || "/tmp/page.png";
const sel = process.argv[3];
const api = await cdp();
const ok = await pageShot(api, path, sel);
console.log(ok ? `-> ${path}` : "FAILED (no page target?)");
api.close();
process.exit(ok ? 0 : 1);
