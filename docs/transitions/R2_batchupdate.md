# R2 — render formatting through one `Sheets.Spreadsheets.batchUpdate`

Restructuring proposal #2 (`docs/RESTRUCTURING_PROPOSALS.md`). Branch
`claude/restructure-r2-batchupdate`. New file prefix `99zk`.

## Current state → new state

**Before.** Every formatting attribute a render sets is its own SpreadsheetApp
round trip. `97_render_batching.gs` already collapsed a render's formatting into
one call per attribute *plane* per band, but that is still a call per plane, per
header row, per run. The program registrant sheet (`46`,
`writeProgramLeaderSheetTab`) is worse: banded per session, it measured **191
round trips** for a year of a weekly class (143 sheet-level: a row height per
band, a protection per derived column at four calls each, a range list per
attribute), and it is repeated for every program, hourly when rosters move and
all at once on a `LEADER_SHEET_TEMPLATE_KEY` bump.

**After.** The formatting is described as Sheets API v4 requests and sent in
one `Sheets.Spreadsheets.batchUpdate` per step:

| Writer | Before | After (API path) | Fallback |
|---|---|---|---|
| `writeProgramLeaderSheetTab` (`46`) | 191 calls | see *Bench numbers* | the old function, renamed `writeProgramLeaderSheetTabLegacy_`, unchanged |
| `flushRenderBatch_` (`97`) — Registrants, Triage, Lunch_Schedule, the session table, the lunch dashboard | ~4 calls per header row + 2–6 per band | 1 batchUpdate | the old per-plane loop, unchanged |

Nothing about WHAT is painted changes. The staging layer in `97` is untouched
(every `stage*` still returns false outside a scope, so the twenty non-render
callers behave exactly as before); only the flush and the leader-sheet writer
gained a second implementation.

### The leader sheet, step by step

| # | Old path | API path |
|---|---|---|
| 1 | `clearDataValidations()` | same (SpreadsheetApp) |
| 2 | `writeTabValuesBeforeRender_` (`99u`) | same, except the header row is written already LABELLED (`✏️ Contacted`), which is what the render writes there anyway |
| 3 | `clearFormats()`, banding removal, banner, header, labels, `'@'` stamp, `setValues(grid)`, zebra, waitlist ink, band rows + heights, number formats, wraps, wash, checkboxes, protections, freeze rows, visibility, autosize's CLIP + `autoResizeColumns` | **batchUpdate #1** (banding removal stays a SpreadsheetApp call — the Banding object exposes no id; it is one read and normally zero removals) |
| 4 | — | `Sheets.Spreadsheets.get` — the fitted column widths, one read (replaces one `getColumnWidth` per column) |
| 5 | width buffer, visibility again, freeze columns | **batchUpdate #2** |
| 6 | `applySavedColumnWidths` | same (free on a tab with no saved widths) |

The grid's values are NOT re-sent: they landed in step 2. The one column the old
path re-wrote them for — `Event_Time`, so a bare `10:00 AM` is not read as a time
— is written in batchUpdate #1 as `stringValue` AFTER its `'@'` format, which is
exactly what `'@'` + `setValues(string)` produces. If any `Event_Time` value is
not a string, the whole grid is re-sent with `setValues()` after #1, as before.

`LEADER_SHEET_TEMPLATE_KEY` is **not** bumped: the painted sheet is identical
(golden test), so no sheet needs redrawing because of this change. The
fingerprint, the in-flight crash marker (`LEADER_SHEET_PUSH_IN_FLIGHT_V1`),
`leaderSheetTabReadsEmpty_()` and the registry are untouched — they live in the
caller (`pushProgramLeaderSheets`), which still calls `writeProgramLeaderSheetTab`
with the same arguments.

### A pre-existing quirk this preserves on purpose

`autosizeColumns(…, { force: true })` sets `CLIP` over the whole used range
before fitting — AFTER the leader sheet has set `WRAP` on `Answers` and
`OVERFLOW` on the band labels — so those two wraps never survive. The API path
reproduces that exactly (the golden test would fail otherwise). Fixing it is a
visible change to every leader sheet and belongs in its own commit with a
template bump; it is noted here, not done.

## Every store / tab / property / trigger touched

- **Tabs written:** the same tabs, the same cells, the same attributes. No
  schema change, no `HEADERS` change, no new tab.
- **Script Properties:** one new key, `SHEETS_BATCH_FORMATTING_V1` — a kill
  switch, absent by default. `off` sends every render down the old path.
  `DERIVED_COLUMN_PROTECTIONS_V1` (`39`) is read and written by the API path
  with exactly the same value format the old path writes, so either path can
  follow the other.
- **Triggers:** none added, none changed.
- **Advanced service:** `Sheets` v4, already enabled in `appsscript.json`; no
  new OAuth scope (the project already holds `spreadsheets`).
- **Menu:** nothing added.

## How existing data reaches the new shape

There is no new shape. A sheet painted by the old path and one painted by the
new path are cell-for-cell identical in every attribute either path sets —
value, background, font colour/weight/style/size, horizontal and vertical
alignment, wrap, number format, data validation, note, row heights, column
widths, hidden columns, frozen rows/columns, warning protections.
`tests/sheets_batch_golden.test.js` paints the same input both ways onto a
modelling fake and compares the two models; that comparison IS the
verification, and it runs for the leader sheet (a year of a weekly class, a
waitlisted row, an empty roster, a sheet re-rendered with fewer rows than it
had) and for the Registrants render.

## Mid-transition behaviour

- **Render killed mid-way** (Apps Script's ceiling — no exception, no
  `finally`): values are written by `99u`'s single `setValues()` before any
  formatting request, exactly as before, so a kill leaves the rows on the tab.
  A batchUpdate is atomic: a kill during it leaves the old formatting or the new,
  never half of either. The next render repaints everything.
- **A batchUpdate that throws** (service disabled, quota, a 403 on a foreign
  sheet the trigger owner can only reach through SpreadsheetApp, a frozen
  column across a hand-merged cell): logged once, and the whole render is
  redone on the old path. Batch #1 is atomic, so a failure there leaves nothing
  half-applied; a failure in #2 repaints from the top on the old path, which is
  idempotent. Three failures in one execution stop the API being tried again
  in that execution, so a broken service costs three attempts, not one per
  sheet.
- **A sliced push mid-flight when this deploys:** the push's state (fingerprints,
  crash marker, registry) is unchanged in shape and meaning; the next slice
  simply paints through the new path.
- **The shrink guards (`99j`, `99x`) and write-before-clear (`99u`)** run before
  any of this and are untouched: the guards in the callers, the early write as
  step 2 above. `tests/write_before_clear.test.js` still passes against both
  paths (it runs without the `Sheets` service, i.e. the old path; the golden
  test covers the new one).

## Concurrency

No new lock. The writers already run under the caller's `workbookLock()`;
batchUpdate changes how many round trips the lock is held for, not whether it is
held. A leader editing the sheet during a push is the same race it always was
(the pull reads ticks back before the push; the push's write is what it was).

## Quota and request size

- Google recommends ≤ 2MB per request. A leader sheet (16 columns, a few hundred
  rows) is tens of KB. The Registrants band backgrounds are the large one: 1,280
  rows × 38 columns. `sheetsBackgroundRequests_` encodes a background plane as
  per-row runs merged down identical columns OR as one `updateCells`, whichever
  serializes smaller, and `sendSheetsBatch_` splits a request list that would
  exceed `SHEETS_BATCH_MAX_BYTES` (1.8MB) into consecutive batchUpdates (still
  one per ~1.8MB, never one per call).
- Sheets API quota: 300 write requests/minute/project, 60/minute/user. One
  sync slice writing 90 leader sheets is 180 batchUpdates + 90 reads; a template
  bump pushing every sheet at once is the case to watch. A `429`/quota error
  throws, the sheet falls back to the old path for that sheet, and after three
  failures the execution stops trying — so quota exhaustion degrades to today's
  behaviour, never to a failed push.

## Rollback

`git revert` of this branch's commits restores the old writers; nothing stored
needs undoing, because nothing stored changed shape. Every tab painted by the
new path is readable by the old code (it is the same paint). For an immediate
rollback without a deploy, set Script Property `SHEETS_BATCH_FORMATTING_V1` to
`off` (Project Settings → Script Properties, or run
`PropertiesService.getScriptProperties().setProperty('SHEETS_BATCH_FORMATTING_V1','off')`
in the editor).

## Bench numbers

Recorded by `node tools/render_bench.js` (fake service; counts are round trips,
a batchUpdate counted as one).

| Measurement | Before | After | of which API calls |
|---|--:|--:|--:|
| Leader sheet, a year of a weekly class (208 rows, 52 bands) | **191** | **11** | 3 (2 batchUpdate + 1 width read) |
| Registrants tab, second render (same geometry) | 72 | 52 | 2 batchUpdate |
| Registrants tab, first render (empty tab) | 180 | 120 | 2 batchUpdate |
| `node tools/sync_bench.js` (reconcile phase — not touched) | 4 reads | 4 reads | — |

A protection rebuild on a sheet that already has protections adds one read
(the protected-range ids); a fresh sheet or an unchanged geometry does not.

The Registrants render sends ~1.3MB per render, almost all of it the background
plane (1,280 rows × 38 columns). It goes out as two batchUpdates because the
size check counts UTF-16 length × 2 as a conservative byte estimate. The rest
of that render's 50 calls are outside the flush (protections, conditional
formats, the early write, the autosize) and are the "other tabs" follow-up, not
part of this change.

Two faults the golden test caught while this was written, both fixed before
commit: `h:mm AM/PM` was typed `DATE_TIME` (the `M` in `AM/PM` read as a
month), and a single oversized `updateCells` could not be split by the byte
ceiling (it now slices itself by whole rows).

## Manual test checklist (test workbook)

1. Deploy the branch. Confirm `appsscript.json` still lists the `Sheets` v4
   advanced service (Services panel in the editor).
2. **Rosters & Sharing → Refresh Program Registrant Sheets** (`force: true`).
   Open two leader sheets: one with several sessions, one with nobody signed
   up. Check: banner, header with yellow ✏️ columns, blue session bands at 30px,
   zebra stripes, peach waitlisted rows with an orange status cell, tick boxes
   centred, dates as `Tue 1/6/2026`, hidden `Row_Key`/`Pushed_Snapshot`, frozen
   header and first four columns, hovering a derived cell's edit shows the
   warning.
3. Executions log for that run: no `ℹ️ Sheets API formatting failed` lines. If
   there are, note the error — the sheets will still be correct (old path).
4. Tick `Contacted` on a leader sheet, run **Update Everything Now**, confirm the
   tick arrives on `All_Registrants` and is still on the sheet afterwards.
5. Run a registration sync that rewrites `All_Registrants`. Check the yellow
   ✏️ header labels, the manual-entry wash, the dropdowns and tick boxes on the
   Registrants tab, both Upcoming and Past.
6. Set Script Property `SHEETS_BATCH_FORMATTING_V1` = `off`, repeat step 2 on
   one sheet, compare — it should look identical. Delete the property.
7. Time a full leader-sheet refresh before and after (executions list duration).
