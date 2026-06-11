# Driving axe DevTools Guided Tests via CDP — notes for a future skill

This documents how to drive Deque's **axe DevTools** extension (panel scans + Intelligent
Guided Tests) over the Chrome DevTools Protocol, and where AI **visual / media analysis**
answers the judgment questions. It's written to be turned into a Claude skill later.

## 0. The big picture

axe DevTools has three test modes, increasing in human judgment:

| Mode | What | Automatable | Judgment needed |
|---|---|---|---|
| **Full/Partial Page Scan** | axe-core automatic rules | Fully (`axe_panel_scan`) | none |
| **Intelligent Guided Tests (IGTs)** | AI-assisted walkthroughs per element type | Launch + drive via CDP | **yes** — answered with `axe_capture_element` (vision) |
| **Manual issues** | hand-logged findings | n/a | yes |

The 7 IGT categories: **Table, Keyboard, Modal Dialog, Interactive Elements, Structure, Images, Forms**.

## 1. Prerequisites

- A Chromium browser (BrowserOS preferred) with the **axe DevTools** extension installed
  (id `lhdoppojpmngadmnindnejefpokejbdd`), launched with:
  `--remote-debugging-port=9222 --remote-allow-origins=* --auto-open-devtools-for-tabs`
  (`axe_browser_start` does this).
- **IGTs require axe DevTools Pro.** A 14-day free trial unlocks them; the trial state lives in
  the browser profile (`~/.axe-mcp-browser`), so it persists across relaunches.
- Use `127.0.0.1`, never `localhost` (IPv4-only debug port).

## 2. MCP tools (in this server)

| Tool | Use |
|---|---|
| `axe_browser_start` | launch the extension-bearing browser at a URL |
| `axe_panel_scan` | full/partial automatic scan → structured results |
| `axe_capture_element` | **screenshot one element + a11y metadata** → vision judgment |
| `axe_capture_page` | screenshot the page (viewport/full) → layout/structure judgment |
| `axe_media_audit` | list `<audio>/<video>` + caption/description tracks |
| `axe_browser_stop` | stop the browser |

## 3. Panel automation mechanism (shared by scans + IGTs)

The panel lives in a DevTools iframe, unreachable by normal page automation. The reliable path
(raw CDP, see `src/cdp.ts` / `src/panel.ts`):

1. Attach to the DevTools front-end target (`devtools://…/devtools_app.html`).
2. Read the axe panel id from `UI.panels` and call **`InspectorFrontendAPI.showPanel(panelId)`**.
   (Every other show method fails — synthetic events ignored, trusted Input doesn't route to a
   docked FE, overflow menu DOM elusive, no command-menu entry.)
3. Attach to the extension's `panel.html` target (it instantiates only after `showPanel`).
4. The panel's own buttons honor **synthetic** DOM clicks (dispatch mousedown/mouseup/click).

## 4. IGT flow (per category)

Launching `Images` (others are analogous) from the panel's initial screen:

```
[panel initial screen]
  click "Images"                      -> intro: "Let's get started… put your site in the state…"
  click "Start"                       -> "Capturing screenshots of each image (N of M)"
                                      -> "Loading Intelligent Guided Test … analyzing your page…"
  [5-step wizard: 1 2 3 4 5]          -> per-element judgment questions (radios + Back/Next)
  …answer each…                       -> records pass/fail per element
  finish                              -> results roll into the panel report; "Save progress & quit"
```

Key UI signals (scrape the `panel.html` body innerText / shadow DOM):
- `Capturing screenshots of each image (N of M)` — capture phase (needs the tab **foregrounded**;
  `Page.bringToFront` on the page target).
- `Loading Intelligent Guided Test … analyzing your page…` — **AI analysis phase** (calls Deque's
  cloud; can be slow).
- A judgment step shows `[role=radio]` options + `Back`/`Next`.

### ⚠️ Caveat discovered
The IGT **AI "analyzing your page…" step depends on Deque's cloud backend** and can stall in an
automated/background context. Foregrounding the tab (`Page.bringToFront`) and using a real
`http(s)` URL (not `file://`) helps. Status of the live attempt is recorded below.

## 5. The 7 IGTs — what each asks, and how AI analysis answers it

For each judgment step, capture the element under test with `axe_capture_element` (the panel
highlights/identifies it; grab its selector) and let vision decide, then click the matching radio.

| IGT | Tests | Typical judgment question | Answered by |
|---|---|---|---|
| **Images** | informative vs decorative; alt quality | "Does this image convey information? Is the alt appropriate?" | `axe_capture_element` → see the image, compare to its `alt` |
| **Structure** | headings, landmarks, reading order, lists | "Is the heading level correct? Is this a real heading?" | `axe_capture_page` → see visual hierarchy vs DOM order |
| **Table** | data vs layout; header associations | "Is this a data table? Are headers correct?" | `axe_capture_element` of the table |
| **Forms** | labels, grouping, required, errors | "Does this field have a correct visible label?" | `axe_capture_element` of field + label |
| **Interactive Elements** | real vs fake controls; name/role/state | "Does this look/behave like a button/link?" | `axe_capture_element` + role/tabindex metadata |
| **Modal Dialog** | focus trap, return focus, labelling | "Is focus trapped? Is the dialog named?" | drive keyboard + `axe_capture_page` |
| **Keyboard** | focus order, visible focus, no traps | "Is the focus indicator visible? Order logical?" | `axe_capture_page` after focusing each control |

(Media/audio: `axe_media_audit` covers captions/descriptions for `<audio>/<video>` — the
audio side of accessibility, complementing the visual checks.)

## 6. Driving a judgment step (pattern)

```
read current step  -> { questionText, options:[role=radio labels], elementSelector? }
if needs vision    -> axe_capture_element(elementSelector)  // Claude looks
decide answer      -> pick the radio whose label matches the judgment
click radio, click "Next"
repeat until step 5 / "complete"
```

## 7. Turning this into a skill

A `guided-a11y-audit` skill would:
1. `axe_browser_start({url})` → `axe_panel_scan` for the automatic baseline.
2. For each IGT category: launch it, and for every judgment step call `axe_capture_element`,
   reason about the screenshot, and answer — looping until complete.
3. Aggregate automatic + guided findings into a WCAG report.
4. Fall back gracefully if the IGT AI step stalls (record "needs manual review").

## Fixture
`test/a11y-test-page.html` has minimal, known content for every IGT category (good/bad/decorative
images, data + layout tables, labeled/unlabeled fields, a modal, real vs fake controls, a heading-
order skip, a positive-tabindex keyboard anti-pattern) so each guided test is fast and reproducible.

## 8. Live results & the key finding

What works hands-free:
- **Automatic panel scan** (`axe_panel_scan`): ✅ amazon.com → 3 issues; `bad-page.html` → 6.
- **IGT launch + screenshot capture**: ✅ category launches, "Start", and per-element capture all drive fine via CDP.
- **`axe_capture_element` visual judgments**: ✅ verified on the fixture (see below).

The blocker — SOLVED (and two earlier theories disproven):
- **Not auth**: CDP network capture shows the Deque Pro backend calls all succeed (`/healthcheck`,
  `/api/screenshots`, `/api/axe-devtools-pro/advanced-rules` → 200). No 401/403.
- **Not a chrome.debugger conflict**: probing from the panel context mid-stall,
  `chrome.debugger.attach({tabId})` **succeeded** — nothing was holding the slot.
- **Real root cause: user activation.** Synthetic `dispatchEvent` clicks carry no activation
  (`navigator.userActivation` stays false), and the IGT pipeline silently stalls at "Running axe"
  without it. **Fix: dispatch trusted input via CDP `Input.dispatchMouseEvent` on the PANEL target's
  own session** at panel-local coordinates (panel.html is an OOPIF — clicking "through" the DevTools
  front-end at iframe-offset coordinates misses). With a trusted Start click, analysis completes in
  ~30s and the whole wizard is drivable.
- **Proof**: Images IGT on the Mars demo driven end-to-end — 72 images, all 5 steps, the batch
  Yes/No review corrected with Claude vision (10 wrong AI prefills flipped), 27 issues, results
  saved, dashboard shows "Runs: 1 · 100% complete". Toolkit: `test/igt-lib.mjs`, `igt-go.mjs`,
  `igt-start-fix.mjs`, `igt-step.mjs`, `igt-rows.mjs`. Chrome 137+ needs
  `--disable-features=DisableLoadExtensionCommandLineSwitch` for `--load-extension`.

### ALL 7 IGTs completed on the Mars demo (6/10/2026) — 100% guided coverage

| IGT | Issues | Notes |
|---|---|---|
| Images | 27 | 10 AI prefills vision-corrected |
| Table | 0 | both detected tables = FB-likebox layout `uiGrid` → "not a data table" |
| Keyboard | 0 | **all 15 AI failures were false positives** — refuted empirically and flipped |
| Modal Dialog | 0 | page has no modal ("Login" opens a popup *window*) → "I do not have a modal" |
| Interactive Elements | 13 | role/state mismatches (menu triggers coded as links, heading-links, no-name link) |
| Structure | 6 | prose-as-H2, 3 unmarked visual headings (sidebar tabs), mismatched heading, missing `lang` |
| Forms | 2 | route-type radio group lacks visible label; group-label association |

Additional mechanics learned driving the remaining 6:
- **In-place category launch** (`igt-launch.mjs`): on the dashboard each category card's green "+"
  is `button.IconButton--primary` (no accessible name!) — trusted-click it, then Start/Resume.
- **Keyboard/Interactive review lists**: per-element verdicts live in button aria-labels —
  `"Mark as passed: <rule>. Element N. <desc>"` = rule currently FAILED on N (and vice versa).
  Cards must be EXPANDED (trusted-click the "Element N of M" header) before the buttons are
  clickable (`igt-kbfix.mjs` flips verdicts; `igt-kbrows.mjs`/`igt-kbhl.mjs` scrape/identify).
- **Refuting "function cannot be performed by keyboard alone"**: drive the PAGE with trusted
  CDP keys. Two traps: use `type:'keyDown'` (NOT `rawKeyDown` — no default actions) and enable
  `Emulation.setFocusEmulationEnabled` first (unfocused window ⇒ Tab/arrows silently dead).
  Mars booking-widget radios: Tab-reachable (positive tabindex puts them FIRST), arrows move
  checked state AND switch the widget panel — round-trip proven, AI verdict wrong.
- **Interactive Elements AI batch limit**: "There was a problem analyzing" with all 168 elements
  (twice); 3 and 33 work fine. Select role-groups via the per-group "Select all" buttons to
  keep batches ≤~50. Back resets selection to 0 — Next with 0 selected silently yields a hollow
  0-issue run; don't.
- **Forms wizard**: iterates the form's ~10 fields; an optimizer skips repeat label questions.
  Group questions (radio sets) come first; visible group labels are selected by trusted-clicking
  the text ON THE PAGE (mouse-selection mode), same as Structure's missed headings.
  Blank/bad-data submit probes: run them on a THROWAWAY duplicate tab (`Target.createTarget`)
  so the IGT tab never navigates — Mars form1 submits silently with no validation, so both
  answers are "No"; defaulted radio groups/selects → "Not applicable".
- The carousel's slide links, hover menus ("Your country/language" open on Enter), and the
  datepicker all pass keyboard checks — the AI's passes held up under spot-checks.

### The working alternative: a **Claude-powered guided audit**
The `axe_capture_element` / `axe_capture_page` tools let **Claude perform the same per-element
judgments the IGTs ask for** — no Deque AI, no Pro account. Demonstrated on `a11y-test-page.html`:

**Images** (capture `#images` + alt metadata):
| img | visual | alt | verdict |
|---|---|---|---|
| 1 | green ✓ | `In stock` | pass — informative, alt matches |
| 2 | gray box | `""` | pass — decorative, correctly empty |
| 3 | orange circle | *(none)* | **fail** — missing alt (looks informative) |
| 4 | red box | `IMG_4821.png` | **fail** — alt is a filename |

**Forms**: `email` field has only a placeholder, no label → **fail**; name/qty/terms labelled → pass.
**Interactive**: `div` "Fake button" (no role/tabindex) → **fail**; empty `<a href="#">` → **fail**;
real button, ARIA button (`role=button tabindex=0`), real link → pass.

**Recommended skill design:** skip Deque's IGT AI entirely. For each category, enumerate the
candidate elements (DOM query), `axe_capture_element` each, let Claude judge, and aggregate — a
guided audit that needs neither Pro nor a sign-in.
