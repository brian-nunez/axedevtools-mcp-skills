// Verify the SHIPPED compiled tool code (dist/panel.js) drives the real panel.
import { panelScan } from "../dist/panel.js";
const endpoint = process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222";
const res = await panelScan({ endpoint, scanType: "full" });
console.log(JSON.stringify(res, null, 2));
