#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { clickWeFoundSomethingSave } from "./extension.js";

const endpoint = process.env.AXE_CDP_ENDPOINT || `http://127.0.0.1:${process.env.AXE_CDP_PORT || 9222}`;
const timeoutMs = Number(process.env.AXE_WE_FOUND_SOMETHING_SAVE_WAIT_MS || 60_000);
const resultPath = process.env.AXE_WE_FOUND_SOMETHING_RESULT_PATH || "/tmp/axe-mcp/we-found-something-save.json";

async function writeResult(result: any) {
  await mkdir("/tmp/axe-mcp", { recursive: true }).catch(() => {});
  await writeFile(
    resultPath,
    JSON.stringify(
      {
        ...result,
        endpoint,
        timeoutMs,
        finishedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

async function main() {
  console.error(`[axe-mcp] optional We found something watcher started; timeout=${timeoutMs}ms`);
  const result = await clickWeFoundSomethingSave(endpoint, timeoutMs);
  await writeResult(result);
  console.error(`[axe-mcp] optional We found something watcher finished: ${JSON.stringify(result)}`);
}

main().catch(async (error) => {
  const result = {
    ok: false,
    attempted: false,
    saved: false,
    error: error?.stack || error?.message || String(error),
  };
  await writeResult(result).catch(() => {});
  console.error("[axe-mcp] optional We found something watcher failed:", result.error);
  process.exit(1);
});
