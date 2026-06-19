---
name: axe-guided-testing
description: >-
  Initialize and drive Deque's REAL axe DevTools browser extension — automatic scans and
  Intelligent Guided Tests (Images, Table, Keyboard, Modal Dialog, Interactive
  Elements, Structure, Forms) — end-to-end over the Chrome DevTools Protocol,
  answering every wizard question by inspecting the page DOM, taking screenshots,
  and running empirical interaction tests. Use this whenever the user mentions
  axe DevTools, guided tests, IGT, "Runs: 0" on the axe dashboard, completing
  guided/manual accessibility test categories, driving the axe panel, or wants a
  full WCAG audit with the actual Deque extension rather than bare axe-core —
  even if they don't say "guided" or "IGT". Always run this skill's init.sh with
  the target URL first, use the forwarded axe_* MCP tools against the prepared
  browser, and call axe_cleanup_shutdown as the final MCP action.
---

# axe Guided Testing — drive the real extension with judged answers

You will drive Deque's axe DevTools extension UI (inside Chrome DevTools), complete
Intelligent Guided Test wizards, and answer their judgment questions the way a
careful human expert would: by **looking at the page and testing it**, never by
guessing or blindly trusting the wizard's AI prefills.

**Division of labor.** `scripts/init.sh` owns the container, browser, target-page
navigation, extension, DevTools, authentication, and startup scan. All predictable
test mechanics (trusted clicking,
scraping, keyboard probes) are deterministic and provided by the **`axe-mcp` MCP
server** — use its tools; never hand-roll CDP driving. This document and its
references are the JUDGMENT layer: what to answer, when to refute the wizard's AI,
and what to do when something unexpected happens.

## Mandatory lifecycle

1. **First action — initialize.** Run the `scripts/init.sh` located beside this
   `SKILL.md`, passing the user's target URL unchanged:

   ```bash
   "<absolute-skill-directory>/scripts/init.sh" "<target-url>"
   ```

   Wait for successful completion. Do not inspect files, call MCP tools, launch a
   browser, or perform other task work before this command. If it fails, report
   its output; do not reproduce its setup manually.
2. **Middle — use only the prepared browser.** After initialization, use the axe
   MCP tools to inspect and control the already-open page and axe panel. Never call
   `setup_environment`, `axe_extension_login`, `axe_browser_start`,
   `axe_browser_open_page`, `axe_browser_navigate`, or `axe_browser_stop`. Never
   reload, navigate, or open another page. Do not use direct CDP, Playwright,
   Selenium, raw browser automation, or Node/script fallbacks.
3. **Last MCP action — clean up.** After collecting the final dashboard state and
   all evidence needed for the report, call exactly:

   ```text
   axe_cleanup_shutdown({confirmIrreversible: true})
   ```

   This must be the final MCP/tool action of the session, including on a partial
   run or test failure after successful initialization. It shuts down the browser
   and MCP server; do not call any tool after it. Then return the report from the
   evidence already collected.

## The precision contract (non-negotiable)

1. **Ground every answer.** Before answering ANY wizard question: read it
   (`axe_igt_state`), identify the subject element in the page DOM
   (`axe_page_eval`), and look at it (`axe_capture_page` / `axe_capture_element` /
   `axe_igt_highlight`). If the question is behavioral ("can it be done by
   keyboard?"), **test it empirically** (`axe_page_keys`) — never answer behavior
   questions from markup alone. Do not navigate or create a disposable page to
   test form submission.
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

1. **Use the initialized page**: `init.sh` has already opened the URL, prepared
   DevTools and axe, authenticated, and run the startup scan. Do not repeat setup.
2. **Baseline automatic scan**: when the user requested scan results, call
   `axe_panel_scan` without `navigateTo` → totals + per-issue list.
3. **Requested categories**: run only categories named by the user; run all 7 for
   a full audit. For each: `axe_igt_launch {category}` → loop: `axe_igt_state` →
   ground-truth (`axe_page_eval` / screenshots / `axe_page_keys` /
   trusted page controls) → `axe_igt_answer` → verify advanced. Follow
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
6. **Capture report evidence**: before cleanup, retain per-category issues, what
   YOU corrected (flips + evidence), what was N/A and why, and the final dashboard.
7. **Clean up**: call `axe_cleanup_shutdown {confirmIrreversible:true}`. Call no
   tool afterward, then report from the retained evidence.

## When things go wrong

Read `references/troubleshooting.md` FIRST. Recover only with axe tools against
the initialized browser. If recovery would require setup, browser lifecycle,
navigation, reload, or direct CDP, preserve the evidence gathered, call
`axe_cleanup_shutdown` as the final tool action, and report the blocker.

## Vision-less agents

You can still complete every category except the visual-judgment steps of Images:
substitute DOM evidence via `axe_page_eval` (alt text vs file names, natural vs
rendered size, sibling text) and say so in the report. Never pretend to have looked.
