// IGT tool layer: each MCP tool shells out to the battle-tested driver scripts
// in this repo's igt-scripts/ (single source of truth for the CDP mechanics —
// the axe-guided-testing skill ships only instructions, not code). Scripts are
// plain Node (>=22), zero dependencies.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // .../dist
export const SCRIPTS_DIR =
  process.env.AXE_IGT_SCRIPTS_DIR || path.resolve(HERE, "..", "igt-scripts");

export interface RunOpts {
  cdpEndpoint?: string;
  urlContains?: string;
  timeoutMs?: number;
}

export function scriptsAvailable(): boolean {
  return existsSync(path.join(SCRIPTS_DIR, "igt-step.mjs"));
}

/** Run one driver script; capture stdout+stderr; never throw on nonzero exit. */
export function runScript(script: string, args: string[], opts: RunOpts = {}): Promise<string> {
  const file = path.join(SCRIPTS_DIR, script);
  if (!existsSync(file)) return Promise.resolve(`ERROR: script not found: ${file} (set AXE_IGT_SCRIPTS_DIR)`);
  const env = { ...process.env };
  if (opts.cdpEndpoint) env.AXE_CDP_ENDPOINT = opts.cdpEndpoint;
  if (opts.urlContains) env.AXE_PAGE_MATCH = opts.urlContains;
  const timeoutMs = opts.timeoutMs ?? 180_000;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const cap = (d: Buffer) => { if (out.length < 200_000) out += d.toString(); };
    child.stdout.on("data", cap);
    child.stderr.on("data", cap);
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      out += `\n[axe-mcp] TIMEOUT after ${timeoutMs}ms — for long analysis phases poll with axe_igt_state instead.`;
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out.trim() : `${out.trim()}\n[exit code ${code}]`);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(`ERROR spawning node: ${e.message}`);
    });
  });
}
