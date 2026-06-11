import { inventory } from "../dist/visual.js";
const r = await inventory(process.env.AXE_CDP_ENDPOINT || "http://127.0.0.1:9222", process.argv[2] || "a11y-test-page");
console.log("counts:", JSON.stringify(r.counts));
console.log("landmarks present:", JSON.stringify(r.landmarksPresent), "missing:", JSON.stringify(r.landmarksMissing));
console.log("images:", JSON.stringify(r.images));
console.log("fields:", JSON.stringify(r.formFields));
console.log("interactive(sample):", JSON.stringify(r.interactive.slice(0, 6)));
console.log("tables:", JSON.stringify(r.tables));
process.exit(0);
