# The 7 IGT categories — what each asks, and how to answer with precision

Validated end-to-end on https://dequeuniversity.com/demo/mars/ (all 7 completed,
48 guided issues). Steps vary slightly by site; the METHOD transfers. All
mechanics below are axe-mcp tools.

## Images (5 steps)
1. **Select images to test** — select ALL (thorough path) unless the user scoped it.
2. **Mark purely decorative** — view every group (`axe_capture_page`, panel shots
   from `axe_igt_state`); decorative = spacers, divider bars, ornament bullets.
   NOT decorative: anything conveying sequence/meaning (numbered globes),
   functional images (carousel arrows), logos.
3. **Mark text-in-image** — images with text baked into pixels (banner numerals).
   Exclude icons/logos and images whose visible text is real DOM text overlaid.
4. **Batch Yes/No review of accessible names** (the big one) — the wizard
   PRE-FILLS AI guesses. `axe_igt_rows` lists every row (name + current answer +
   radio indices). For each row: does the accessible name truthfully describe the
   image you can SEE? Flip wrong ones with `axe_igt_answer`
   `{action:"radioOnly", value:"<noIdx> <noIdx> …"}` (batch, no Next). Classic
   wrongs: filename alts (`icecream.jpg`) on photos, copy-pasted alts on different
   images, concatenated junk names, `"..."` icon names.
5. **Results → Finish → Save.**

## Table (3 steps)
1. Pick which detected table to test (thumbnails). Inspect ALL `<table>`s first via
   `axe_page_eval` — include iframes (`f.contentDocument` for same-origin); detected
   tables are often inside widget iframes (Facebook likebox on Mars).
2. **"What type of data table is this?"** — ground truth from markup+content:
   real headers (`th`/scope) ⇒ pick the matching header layout; presentational
   grids (`class=uiGrid`, no th, no caption, layout-only) ⇒ **"This is not a data
   table"**. A correctly-identified layout table yields 0 issues — that's correct,
   not a failure.
3. Results → Finish.

## Keyboard (5 steps, AI batch + review)
- After Start, the AI analyzes every interactive element (~minutes for ~170).
  DON'T interact with the page during analysis.
- Review list: `axe_igt_review_rows`. For every FAILED element:
  1. Identify it: `axe_igt_highlight` → read the page shots it writes.
  2. **Empirically test the claim** with `axe_page_keys`:
     - Tab-reachable? `{tabWalk: 60}`
     - Function works? `{focus:"#el", keys:["ArrowDown"], watch:"/text-proving-the-panel-switched/"}`
     - Menus: `{focus:"a.trigger", keys:["Enter"]}` then check submenu visibility
       via `axe_page_eval`.
  3. False positive ⇒ `axe_igt_flip {to:"passed", rule:"<the rule>", elements:[…]}`.
- Also spot-check known-risky PASSED elements (hover menus, carousels,
  datepickers). Genuinely broken ⇒ flip to failed with the right rule.
- On Mars ALL 15 AI failures were false positives (label/radio pairs + panels of
  the booking widget — radios were Tab-reachable and arrows switched the widget).

## Modal Dialog (3 steps)
1. "Does your modal have a launcher?" — HUNT for a real modal first
   (`axe_page_eval` for `[role=dialog]`, `dialog`, modal/popup classes; click
   suspected launchers via `axe_page_click` and watch for overlays vs popup
   WINDOWS). A `window.open` popup is NOT a modal. No modal on the page ⇒ answer
   "I do not have a modal" — a legitimate 0-issue completion. If a modal exists:
   answer launcher questions, then the wizard walks focus-trap/Escape/labeling
   checks — test each with `axe_page_keys` (Tab cycles inside? Escape closes?
   focus returns to launcher?).
2. Close any popup tabs you opened before proceeding.

## Interactive Elements (3 steps, AI batch + review)
1. Step 1 lists AI-found "interactive without proper markup" candidates
   (pre-selected). Verify each via `axe_page_eval` (labels acting as tab
   switchers, `<a>` without href, clickable divs). Keep real ones.
2. Element selection: **the AI back end may fail on large batches** ("There was a
   problem analyzing") — it handled 33 but errored twice on 168. Select role-groups
   via the per-group `axe_igt_answer {action:"button", value:"select all .Group: N.$"}`
   buttons, keep batches ≤ ~50, Next. NOTE: Back resets selection to 0/N —
   re-select before Next; never proceed at 0.
3. Review: `axe_igt_review_rows` for statuses; `axe_igt_edit` opens the
   name/role/state editor. The AI marks an element failed when its *purpose*
   (e.g. combobox with collapsed/has-popup states for a "Your country ▾" trigger)
   ≠ its calculated role (link). Confirm by looking; these are usually RIGHT.
   Close editors with `axe_igt_answer {action:"button", value:"^cancel$"}` if you
   change nothing.

## Structure (7 steps)
1. **"Any highlighted headings that should NOT be headings?"** — scrape all
   headings (`axe_page_eval`): a multi-sentence paragraph in an `<h2>` (body-size
   font) is prose-as-heading ⇒ Yes, then check it in the list.
2. **"Any headings we missed?"** — look for visually-heading-like text not marked
   up (panel/tab titles styled bold above content). Select them by clicking ON THE
   PAGE: `axe_page_click {textContent:"<exact text>"}` (verify "Fields selected: N"
   rises in `axe_igt_state`).
3. **"Does each heading describe the content after it?"** — pre-filled Yes per
   heading. Check the satirical/mismatched ones by reading what actually follows
   (`axe_page_eval` on siblings). Flip with `axe_igt_answer radioOnly <noIdx>`.
4. **Lists that shouldn't be lists / missed lists** — enumerate `ul/ol/dl`,
   verify each is a genuine list; pagination dots/tabs are NOT missed lists.
5. **Language** — the wizard compares AI-detected language vs `lang` attribute;
   confirm the real page language (missing `lang` ⇒ confirming raises the issue).
6. **Page title accurate? / frame titles accurate?** — read them, judge.
7. Results → Finish.

## Forms (4 steps, per-field loop)
1. Pick the form (inspect all `<form>`s first via `axe_page_eval`; pick the main
   user-facing one).
2. The wizard iterates ~10 fields. Per field: test? → group? → visible label
   (often auto-skipped by its optimizer once it knows the form) → label persists?
   → label accurate? → required marker? → blank-submit error? → bad-data error?
3. **Radio sets = groups.** Group label: select the visible question text via
   `axe_page_click`; if none exists, Next with nothing selected — that records the
   missing-group-label issue (e.g. One-Way/Round-Trip/Multi-Planet).
4. **Submit experiments NEVER on the IGT tab** — use
   `axe_form_probe {url, clickSelector:"#submit", fills:["#field=@@junk@@"]}`.
   Navigation with no visible error ⇒ answer "No". Defaulted radio groups/selects
   can't be blank ⇒ "Not applicable". Don't answer Yes unless you SAW the error.
5. Final question (financial/legal/exam consequences) — for search forms: none;
   Next.
6. Skip redundant per-field re-tests of radios whose group you already covered
   (answer "No" to "test this field?") — note it in the report.

## Completion proof
After each Finish (+ Save if offered): `axe_igt_dash` must show the category at
`Runs: 1 … Completed`, and the overall "Intelligent Guided Testing N% complete"
should rise (7 categories ⇒ ~14% each). Screenshot the final 100% dashboard.
