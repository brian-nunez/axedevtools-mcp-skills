---
name: axe-guided-testing
description: >-
  Drive Deque's REAL axe DevTools browser extension — automatic scans AND all 7
  Intelligent Guided Tests (Images, Table, Keyboard, Modal Dialog, Interactive
  Elements, Structure, Forms) — end-to-end over the Chrome DevTools Protocol,
  answering every wizard question by inspecting the page DOM, taking screenshots,
  and running empirical interaction tests. Use this whenever the user mentions
  axe DevTools, guided tests, IGT, "Runs: 0" on the axe dashboard, completing
  guided/manual accessibility test categories, driving the axe panel, or wants a
  full WCAG audit with the actual Deque extension rather than bare axe-core —
  even if they don't say "guided" or "IGT". Requires the axe-mcp MCP server (its
  axe_* tools) and a Chromium browser with the axe DevTools extension.
---

# axe Guided Testing — drive the real extension with judged answers

You will drive Deque's axe DevTools extension UI (inside Chrome DevTools), complete
Intelligent Guided Test wizards, and answer their judgment questions the way a
careful human expert would: by **looking at the page and testing it**, never by
guessing or blindly trusting the wizard's AI prefills.

**Division of labor.** All PREDICTABLE mechanics (launching, trusted clicking,
scraping, keyboard probes) are deterministic and provided by the **`axe-mcp` MCP
server** — use its tools; never hand-roll CDP driving. This document and its
references are the JUDGMENT layer: what to answer, when to refute the wizard's AI,
and what to do when something unexpected happens.

No MCP available? The tools are thin wrappers over zero-dependency Node scripts in
the axe-mcp checkout (`~/github/axe-mcp/igt-scripts/`, override with
`AXE_IGT_SCRIPTS_DIR`); run the same-named script with `node` and identical
semantics. Everything below is written in tool terms.

`AXE_CDP_ENDPOINT` / the `cdpEndpoint` argument (default `http://127.0.0.1:9222`)
points the tools at the browser — always `127.0.0.1`, never `localhost` (the debug
port is IPv4-only).

## The precision contract (non-negotiable)

1. **Ground every answer.** Before answering ANY wizard question: read it
   (`axe_igt_state`), identify the subject element in the page DOM
   (`axe_page_eval`), and look at it (`axe_capture_page` / `axe_capture_element` /
   `axe_igt_highlight`). If the question is behavioral ("can it be done by
   keyboard?", "does an error show?"), **test it empirically** (`axe_page_keys`,
   `axe_form_probe`) — never answer behavior questions from markup alone.
2. **Trust nothing the AI prefilled.** The wizards pre-answer many questions, and
   they are frequently wrong in BOTH directions (observed: 10 of 56 image answers
   wrong; 15 of 15 keyboard failures were false positives). Review every prefill;
   flip only with evidence (`axe_igt_flip`); spot-check a few AI *passes* too.
3. **Wizard interaction goes through the tools only.** They dispatch trusted,
   user-activation-carrying input on the panel's own session — synthetic clicks
   silently stall the IGT pipeline at "Running axe".
4. **No hollow runs.** Proceeding with 0 elements selected records a worthless
   0-issue "Completed" run. If a selection step shows 0/N, stop and select.
5. **Verify every step advanced.** After each answer, `axe_igt_state` must show a
   NEW question (or results). Same screen ⇒ the click missed — retry; never
   double-answer blind.
6. **Hands off during analysis.** When the panel says it is capturing/analyzing,
   don't touch the page or panel; poll `axe_igt_state` and wait it out
   (`axe_igt_launch` does this for the launch phase).

## Workflow

1. **Launch** (skip if a prepared browser is already on :9222): `axe_browser_start`
   with the target URL. The profile keeps the axe Pro trial state — IGTs need
   Pro/trial active.
2. **Baseline automatic scan**: `axe_panel_scan` → totals + per-issue list.
3. **Per category × 7**: `axe_igt_launch {category}` → loop: `axe_igt_state` →
   ground-truth (`axe_page_eval` / screenshots / `axe_page_keys` /
   `axe_form_probe`) → `axe_igt_answer` → verify advanced. Follow
   `references/categories.md` for each category's questions, validated answers
   methodology, and traps.
4. **AI-review steps** (Keyboard, Interactive Elements): `axe_igt_review_rows` →
   `axe_igt_highlight` the failures → empirically test each claim → `axe_igt_flip`
   only what the evidence contradicts → `axe_igt_edit` to inspect name/role/state
   editors.
5. **Finish each run**: `axe_igt_answer button "^finish$"` (then `"^save$"` if a
   save dialog appears) → `axe_igt_dash` must show the category at
   `Runs: 1 … Completed` — that line is the proof. The overall
   "Intelligent Guided Testing N% complete" rises ~14% per category.
6. **Report**: per category — issues found, what YOU corrected (flips + evidence),
   what was N/A and why; include the final dashboard screenshot.

## When things go wrong

Read `references/troubleshooting.md` FIRST — it maps every observed failure (stall
at "Running axe", Start click missing, dead keyboard events, AI batch errors,
`--load-extension` ignored, second DevTools window, oversized screenshots…) to root
cause and fix. Each was debugged the hard way once; don't re-debug them.

## Remote / sandboxed agents

The browser runs on the HOST. From a sandbox, pass
`cdpEndpoint: "http://<host-ip>:9222"` (or set `AXE_CDP_ENDPOINT`), launch the host
browser with `AXE_EXTRA_ARGS="--remote-debugging-address=0.0.0.0"` or tunnel the
port, and allow the sandbox→host:9222 network policy. Browser launching itself must
happen on the host.

## Vision-less agents

You can still complete every category except the visual-judgment steps of Images:
substitute DOM evidence via `axe_page_eval` (alt text vs file names, natural vs
rendered size, sibling text) and say so in the report. Never pretend to have looked.
