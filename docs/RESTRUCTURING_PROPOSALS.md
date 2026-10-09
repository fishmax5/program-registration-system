# Restructuring proposals — speed and usability

Written 2026-10-09. A survey, not a plan: nothing here is built yet. Each item
says what it replaces, what it buys, what it costs, and what could go wrong.
Ranked by value per unit of effort, with focus on (1) hourly sync runtime,
(2) staff UI responsiveness, (3) menu and workbook clutter. Items that bring in
new pieces outside Apps Script are marked **[new piece]**.

## Where things stand (measured, not guessed)

- 138 `.gs` files, ~95k lines, one global scope.
- **Reconcile phase**: already batched — 16 round trips for 432 sessions
  (`tools/sync_bench.js`). Not where the time is now.
- **Registrants tab render**: 180 calls on an empty tab, 72 on a repeat render,
  of which **46 are range formatting and 14 sheet-level** — only 5 are
  `setValues` (`tools/render_bench.js`).
- **One program registrant sheet rewrite**: 191 calls, **143 of them
  sheet-level** formatting/banding — times one spreadsheet per program.
- **The import** opens every live form and asks for responses since the clock
  (`27`): about one `FormApp.openById()` plus a `getResponses()` per form,
  per run. `99ze` closes ended forms and the trigger now imports every 3 hours,
  but the cost still grows with the number of live forms, and a registration
  can take up to 3 hours to appear.
- **The ledger fold** reads the whole `Registration_Ledger` tab
  (`getDataRange().getValues()`, `99k:431`) whenever anything needs an id that
  is not on the row. It only grows.
- **Menus**: 100 items across 14 submenus, plus a second top-level menu.
  15 named tabs in `SHEET_NAMES` alone, more with the system tabs.
- **Every single tick box** on every tab raises a modal confirm (`99zb`).
- The **Sheets v4 advanced service is enabled in `appsscript.json` and used
  nowhere.**

---

## Tier 1 — big win, contained change

### 1. Event-driven import through one shared response spreadsheet

**Replaces:** the hourly/3-hourly poll that opens every form (`27`, `98`'s
import half).

Every generated form calls `form.setDestination(FormApp.DestinationType.SPREADSHEET, RESPONSES_SS_ID)`.
Google gives each form its own tab in that one spreadsheet. Then:

- **One installable `onFormSubmit` trigger on that spreadsheet** fires for a
  submission to *any* linked form — one trigger total, not one per form (the
  per-form route would hit the 20-triggers-per-user cap). The handler appends
  the response to a small queue (CacheService/Properties, the `63` pattern)
  and arms a one-off import a minute out, coalescing bursts.
- The periodic import becomes a **backstop**: instead of opening N forms it
  reads only the response tabs whose `getLastRow()` moved since last time — one
  call per tab, all inside one spreadsheet, no `FormApp` at all for the common
  case.

**Buys:** registrations on the tab in ~1–2 minutes instead of up to 3 hours;
the hourly sync stops paying per live form; the sync clock (`LAST_FORM_SYNC_TIME`)
stops being the single fragile point `99`, `99d` and `99ze` exist to defend —
the response tab *is* a durable second copy of every submission, readable by
anyone, which is also what `99d`'s audit wishes it had.

**Costs / risks:** a migration in `FORM_STATE_MIGRATIONS` to set the destination
on every live form (idempotent: skip if already linked). Response-tab columns
follow item *titles*, which change when the template migrates — so the reader
must still resolve by item id via `FormApp` when a header is unknown (fallback
to today's path, not a replacement of it). A spreadsheet holds 10M cells: a
yearly rollover of the responses spreadsheet is needed. Keep `processFormResponse`
as the single interpreter of a response.

### 2. Render formatting through one Sheets API `batchUpdate`

**Replaces:** the 46 range-formatting + 14 sheet-level calls in each render
(`97`, `39`), and the 143 sheet-level calls per leader-sheet rewrite (`46`).

`97_render_batching.gs` already *stages* every background, validation, number
format and alignment into planes before writing. Instead of flushing those
planes with `setBackgrounds`/`setDataValidations`/… per run, build one
`Sheets.Spreadsheets.batchUpdate` request (`repeatCell`/`updateCells`,
`setDataValidation`, `addBanding`, `updateDimensionProperties`, protections) and
send it in **one HTTP call**. The service is already enabled.

**Buys:** a repeat Registrants render from ~72 calls to ~6; a leader-sheet
rewrite from ~191 to ~3–5 — and that one multiplies by every program on a
template bump (the 2026-09-30 nineteen-minute push). It also makes the
"crashed mid-push" class (`recoverLeaderSheetPushCrash_`) much rarer, because
a single batchUpdate is atomic: the sheet is either the old one or the new one.

**Costs / risks:** the staging layer stays; only `flush` changes, so the
`stage*`-returns-false fallback keeps every non-render caller working. Needs a
test double for `Sheets.Spreadsheets.batchUpdate` in `tests/helpers`. Request
size limits (~10MB) are far above a tab's formatting. Do the leader sheets
first — highest multiplier, one writer (`writeProgramLeaderSheetTab`).

### 3. Narrow the checkbox confirmation

**Replaces:** a modal on every single tick on every tab (`99zb`).

A confirm that fires on everything trains people to click Yes without reading,
so it protects nothing, and it holds the simple trigger (which is why `99m` had
to start polling for its queue entry). Confirm only the ticks that **leave the
workbook or are hard to undo** — program flags that write to the calendar
(`PROGRAM_FLAG_COLUMNS`, `Waitlist_Only`), `Add_Guest_To_Calendar`, notify
ticks on `Program_Leaders` — via an allow-list in `99zb`. Attendance/lunch
marks on the registrant tab are undone by unticking and should not ask.

**Buys:** the most frequent desk interaction stops costing a dialog. **Cost:**
a list of ~8 column names. Small, but it is a policy change — confirm with
whoever asked for `99zb`.

### 4. Role-shaped menus, pruned with the usage data you already collect

**Replaces:** one 100-item menu for everyone.

`99r` has been counting clicks since it shipped. Use it:

- **Desk menu** (everyone): Quick Mark, Add Registrants in Bulk, Log Volunteer
  Hours, Log a Private Session, Sign-In Sheet, Open the Sign-In App, Why did
  nothing happen? — about 8 items.
- **Coordinator menu**: Lunch, Rosters & Sharing, Programs & Forms.
- **Admin menu**: only built when `Session.getActiveUser()` is on the Config
  admin list (the gate already exists for `ADMIN_GATED_ACTIONS`; CLAUDE.md notes
  the Admin submenu is currently attached for everyone).
- Fold the **14 read-only reports + Form & Link Doctor + Why did nothing
  happen? + Trigger Status** into **one "Health" sidebar** (see 6) with a
  section per check, run on demand. That alone removes ~18 menu items.
- Retire items the usage report shows unpressed for 90 days into the One-Time
  Jobs drawer or the Health page.

**Buys:** staff find things; fewer wrong presses on destructive items. **Cost:**
mostly `16` + `99r` (labels are derived from `buildAppMenu`, so the usage
report keeps working). Pull the `MENU_USAGE_V1` numbers first — the cut should
be driven by them, not by guessing.

---

## Tier 2 — bigger change, bigger payoff

### 5. Replace per-program registrant spreadsheets with a leader web page

**Replaces:** one Google Spreadsheet per program (`46`), its fingerprint
registry, crash markers, sharing sweep (`89`), Drive change detection
(`99zf`), the stranded-roster doctor (`99h`) — a large share of the sync tail.

Serve each leader's roster from the existing web app: `?mode=roster&t=<token>`,
one unguessable token per leader (or per program), read from the Registrants
tab at view time through the same cached index the door uses (`38`/`64`).
Leaders' five ticks (Attended, Dropped, Waitlisted, …) become buttons that
write through the existing writers (`71`, `38`) — the same path the door app
uses, ledger included.

**Buys:** the most expensive thing the sync does (every hour, every program)
disappears — rosters are computed when someone looks, so they are never stale
and there is nothing to push. Sharing/ownership failures vanish because nothing
is shared from Drive. The two-way pull (and its "leader edited a cell we
overwrote" edge cases) becomes a direct write.

**Costs / risks:** leaders lose "it's a spreadsheet I can sort and print" —
offer a *Download CSV / Print* button on the page. Links already handed out
point at spreadsheets: keep the push running for a transition period and put a
banner on each sheet pointing at the new link, then freeze them. Token
leakage = roster leakage; tokens must be revocable (store in Script
Properties, rotate from Program_Leaders). Web-app execution quotas are fine at
this scale.

### 6. One staff console instead of many modal dialogs

**Replaces:** ~25 separate `HtmlService` dialogs, each a cold server round
trip and a full HTML document per open (the `99g` "nothing appeared" failure
is a symptom of this: an oversized modal fails silently).

A single **sidebar app** (or the same web app at `?mode=staff`, gated on the
Google account) with tabs: Desk (Quick Mark + change registration), People
(bulk add, roll import, duplicates), Programs (review, close sessions,
questions), Health (all the reports), Settings. Load once, keep state client
side, call `google.script.run` per action. Shared JS/CSS means one place to
fix escaping and keyboard handling instead of twenty-five.

**Buys:** dialogs open instantly after the first; less menu; one consistent UI.
**Cost:** large, but incremental — move one dialog at a time behind a tab;
the server functions they call do not change. Do the Health tab first (pairs
with 4).

### 7. Split the workbook: a front office and a back room

**Replaces:** one workbook in which staff see ~20 tabs, several of which they
must never touch (`Registration_Ledger`, `Deleted_Event_Triage`, system
queues, `Metrics`).

Keep in the staff workbook only what people read or type in:
`Master_Program_Dashboard`, `All_Registrants`, `Master_Lunch_Dashboard`,
`Lunch_Schedule`, `Member_Roll`, `Program_Settings`, `Program_Leaders`,
`Config`. Move machine-owned tabs — the ledger, triage, the response archive
from (1), metrics — into a **system spreadsheet** in the `System` Drive folder
(`82` already has the shelf), opened with `openSpreadsheetCached()`.

**Buys:** fewer tabs; the ledger stops slowing the workbook's own open/recalc
and cannot be hand-edited by accident. A cheaper first step that gets most of
the clutter win: **hide** those tabs and protect them, no move.

**Risk:** every reader of a moved tab needs the other spreadsheet's handle;
`SHEET_NAMES` should carry which book a tab lives in. Do the "hide" step
first and move only if the ledger's size starts to matter.

### 8. Ledger checkpoints so the fold reads only the tail

**Replaces:** `readLedgerEntries()` reading the whole tab every time a fold is
needed.

Every night (after the 3am snapshot), fold the ledger and store the result as
a checkpoint (one `registered`-with-full-Payload row per live registration —
the shape `99za` already uses for its comparisons) on a separate tab or in the
system spreadsheet, recording the ledger row it covers through. A fold then
reads the checkpoint plus the rows after it. This is also exactly the state
phase 4 of the ledger design would render from.

**Buys:** constant-time folds regardless of history; compaction (`99za`)
becomes optional. **Cost:** moderate; the verifier (`99n`) can compare
checkpoint+tail against a full fold for a month before anything relies on it.

---

## Tier 3 — **[new piece]** options, if Sheets itself becomes the limit

### 9. A real datastore for the registration state

Firestore (via its REST API from Apps Script, or a tiny Cloud Run service)
holding the ledger and the folded state, with the Registrants tab becoming a
**read-only view rendered from it**. That is phase 4 of the ledger design
with a store built for appends and keyed reads instead of a tab. Buys:
millisecond keyed lookups for Quick Mark and the door, no `clear()`/rewrite
risk at all (`99j`, `99u`, `99x` become unnecessary), real transactions in
place of the lease lock (`99w`). Costs: a GCP project with billing, a service
account secret in Script Properties, and a second system to keep alive for a
small nonprofit. **Only worth it if (1), (2), (5) and (8) still leave the
sync too slow** — I expect they will not.

### 10. Move the door app and public pages off Apps Script hosting

Apps Script web apps cold-start in 1–3 s and are framed by Google's wrapper
(the `window.top` height workaround in `99y`). A static site (Cloudflare
Pages / GitHub Pages) serving the public calendar from the JSON snapshot
`99y` already writes to Drive (publish it as a public file or push it to the
site) would load instantly and embed cleanly. The door app could follow,
posting writes to the existing `doGet`/`doPost`. Costs: hosting and a
deploy step this project does not currently have.

---

## Suggested order

1. **3** (checkbox allow-list) and **4** (menu pruning, read `MENU_USAGE_V1`
   first) — days, immediate usability.
2. **2** for the leader sheets, then the Registrants render — measurable with
   the existing benches before/after.
3. **1** (shared response spreadsheet + one `onFormSubmit` trigger) — the
   single biggest change to how fast registrations appear and how much the
   sync costs.
4. **5** and **6** together (both are "a page in the web app we already
   deploy"), starting with the Health tab.
5. **7** (hide first) and **8** when the ledger's size shows up in timings.
6. **9 / 10** only with evidence that 1–8 were not enough.

## What would sharpen this

- `MENU_USAGE_V1` contents (Admin ▸ Reports ▸ Menu Usage) — decides item 4.
- A week of execution durations per handler (`tools/fetch_logs.py` over a
  window) — confirms whether the leader push or the import dominates.
- Number of live forms and of program registrant sheets today.
