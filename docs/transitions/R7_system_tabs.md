# R7 — A front office and a back room (hide and protect)

Item #7 of `docs/RESTRUCTURING_PROPOSALS.md`. **This pass hides and
warning-protects the machine-owned tabs. It moves nothing to another
spreadsheet.** Every tab stays in the workbook, every reader keeps the handle it
has, and every change here is undone by unhiding.

Code: `99zp_system_tabs.gs`. Config: `CONFIG_LAYOUT.SYSTEM_TABS` (`04`,
column 42, `Hide_System_Tabs`). Menu: 🔧 Admin ▸ 🎨 Appearance ▸ **Show / Hide
System Tabs**.

## 1. Which tabs are the back room

Read off every `SHEET_NAMES` entry and the four tab names declared outside it
(`PENDING_FLAG_SHEET_NAME`, `QUICK_MARK_INDEX_SHEET_NAME`, the two legacy
names in `03`). A tab is a SYSTEM tab when no person is meant to type in it in
the ordinary course of a day **and** nobody reads it to run the day.

| Tab | Written by | Why it is back-room |
|---|---|---|
| `Registration_Ledger` | `99k` (append buffer), `99o` backfill, `99za` compaction | Append-only record. A hand edit is a falsified history; the fold reads it. |
| `Ledger_Checkpoint` | R8 (not on this branch yet) | Machine checkpoint of the fold. Looked up by NAME, missing tab ignored. |
| `Deleted_Event_Triage` | `26` `moveRegistrantsToTriage`, `39` render, `83` sweep | Parked rows. Restored by the menu (`restoreTriagedRegistrants`), not by typing. |
| `Metrics` | `83` monthly capture / `refreshMetricsTabNow` | A stored record; read through **Update Metrics Now**, which now opens it. |
| `_Pending_Tag_Changes` | `18` / `99m` pending-flag queue | Already hidden at creation; now also protected. |
| `Quick_Mark_Index` | `38` `writeSheetQuickMarkIndex` | Already hidden; a packed JSON cache. |
| `Active_Programs` (legacy) | `42` merges then clears it | Leftover from an old layout, kept until merged. |
| `Registrant_Notifications` (legacy) | `81` marks it retired, leaves it | Retired tab left in place for the record. |

**Stays visible (front office)** — everything else, in particular:
`All_Program_Sessions` (the proposal's list omits it, but staff open it every
morning and tick `Waitlist_Only` on it — hiding it would be a usability
regression this pass does not need), `Master_Program_Dashboard`,
`All_Registrants`, `Master_Lunch_Dashboard`, `All_Lunch_Registrants`,
`Lunch_Schedule`, `Config`, `Program_Questions`, `Member_Roll`,
`Club_Members`, `Regular_Needs`, `Program_Settings`, `Program_Leaders`,
`Assistance_Requests`, `Volunteer_Hours`, `Private_Sessions`,
`Program_Waitlist`, and **any tab staff made themselves**.

### Why the list declares the HIDDEN set, not the visible one

The brief asked for "the visible-tab set as a single declarative list". The
list is `SYSTEM_TAB_NAMES` in `99zp`, and the visible set is its complement,
computed — never typed. Declaring the visible set instead would hide every tab
the code does not know about: the office's own notes tab, a copy somebody
pasted in, a tab a future file adds before anyone remembers to list it. Hiding
what we did not make is the wrong failure. `frontOfficeTabNames()` returns the
complement over `TAB_GROUPS` for anything that wants the visible set by name,
and the test pins that the two lists never overlap.

## 2. Protection semantics: warning-only, never an editors list

Each system tab gets ONE sheet-level protection with
`setWarningOnly(true)` and the description `SYSTEM_TAB_PROTECTION_DESCRIPTION`.

- **Warning-only restricts nobody.** It shows "you are editing a protected
  range" to a person in the UI and lets them continue. Scripts are never
  prompted. So the trigger owner, whichever account runs the syncs
  (`17_trigger_attribution.gs` — it is routinely NOT the person who pressed
  setup), the installable `onEdit`, and the simple `onEdit` running as whoever
  is typing all keep writing exactly as before.
- **An editors-list protection is deliberately not used.** It would lock out
  any account not on the list, and the sync account changes (Take Over Trigger
  Ownership). A hard protection that excludes the trigger owner fails every
  ledger flush with "You are trying to edit a protected cell" — inside a
  `try` in most writers, i.e. silently. Not worth it for a deterrent.
- Idempotent: an existing protection carrying our description is left alone
  (and turned back to warning-only if someone hardened it). Other protections
  on the tab (`39`'s derived-column warnings on triage) are untouched.

## 3. What edits on those tabs do

- `onEdit` (`18`) dispatches by tab name; none of these tabs has a handler, so
  a hand edit runs nothing — except `99zb`'s check-box confirmation, which
  applies to any check-box cell anywhere (triage has none it cares about).
- The ledger's `onEdit` appender is on `All_Registrants`, not on the ledger.
  A hand edit to `Registration_Ledger` is simply written; the warning is the
  only thing standing in front of it, which is the point of this pass.
- The bump of the workbook change generation (`99zg`) fires on every edit,
  hidden tab or not — unchanged.

## 4. Code that could un-hide a tab, and what was done

| Where | Risk | Change |
|---|---|---|
| `13` `reorderTabs()` | `setActiveSheet()` on a hidden tab **shows it**; it walks TRIAGE and METRICS every setup/rebuild/Reset Tab Order. Pre-existing: it also un-hid staff's own hidden tabs. | Records which tabs were hidden before, re-hides them after, then applies system visibility. |
| `13` `saveCurrentTabOrder()` | Records hidden tabs' positions — fine, records nothing about visibility. | None. |
| `83` `refreshMetricsTabNow()` | `sheet.activate()` on a hidden Metrics. | `openSystemTab_()` — show, then activate, and the toast says it will be tucked away again. |
| `18` `getPendingFlagSheet`, `38` `writeSheetQuickMarkIndex` | Create-then-hide already. | None. |
| `07` `getOrCreateSheet()` | `insertSheet()` makes a NEW tab active and visible (e.g. the ledger's first flush). | Not changed here; the daily apply hides it. Documented. |
| `14` column widths dialog | Lists only visible tabs. | None — a hidden tab is not offered, correct. |
| renderers (`39` triage, `83` metrics, `99k` ledger) | No `showSheet`/`activate` found. | None. |

Nothing in the code reads `getActiveSheet()` to find a system tab: every reader
uses `getSheetByName`, which works on hidden tabs.

## 5. When visibility is applied

`applySystemTabVisibility()` is idempotent and cheap: one `getSheets()`, then
per system tab that exists one `isSheetHidden()` and one `getProtections()`;
writes only on a tab that is in the wrong state. It runs:

1. at the end of `reorderTabs()` — i.e. `initSheet`, `rebuildLayoutFromSheet`,
   **Reset to the Built-In Tab Order**;
2. once a day from `syncRegistrations()` (`applySystemTabVisibilityIfDue_()`:
   one property read when not due), so a tab somebody unhid by hand, or a
   ledger tab created visible, is tucked away within a day;
3. when the admin's "show" window lapses (below).

It never throws — a tab that will not hide must not cost a sync.

## 6. The Config switch — default ON

`Hide_System_Tabs` (Yes/No dropdown, blank = Yes). **ON by default** because
the change is (a) reversible by one click, (b) non-destructive — hidden tabs
are read and written identically, (c) restricts nobody (warning-only), and
(d) the whole point of the item is that staff stop seeing tabs they must not
touch; an off-by-default switch on a workbook nobody configures is a feature
that never ships. Set to "No" and the next apply SHOWS every system tab and
removes our protections (it does not touch anything it did not add).

## 7. The menu item: Show / Hide System Tabs

Ungated (hidden tabs are reachable to any editor via View ▸ Hidden sheets
anyway; this is convenience, not access). If any system tab is hidden it shows
them all for `SYSTEM_TABS_SHOW_WINDOW_MS` (2 hours,
`SYSTEM_TABS_SHOWN_UNTIL_V1`), during which the daily apply leaves them be;
pressing again hides them at once. Protection stays on while shown.

## 8. Reports that say "look at tab X"

`84`'s confirmation names `Deleted_Event_Triage`; `99za`, `99v`, `99p` name
`Registration_Ledger`; `99zi` names Metrics. These are statements of where a
row went, not instructions to open the tab, and each has a menu path that
does the work (Restore Triaged Registrants, the ledger restore and reports,
Update Metrics Now). Left as they are; the Show/Hide item is the way in.

## 9. Rollback

Any one of, cheapest first:
1. Config ▸ `Hide_System_Tabs` = **No** → next apply (setup, Reset Tab
   Order, or the next day's sync) shows all and lifts our protections.
2. Run `showAllSystemTabsPermanently_()` from the editor — same thing, now.
3. View ▸ Hidden sheets in the spreadsheet UI, per tab.
Reverting the code leaves tabs hidden but fully functional; step 1 or 3
before reverting if that matters.

## 10. Manual test checklist

- [ ] Deploy; run Admin ▸ Appearance ▸ Reset to the Built-In Tab Order. The
      eight back-room tabs (those that exist) disappear; the front office
      tabs are in order and coloured; a tab you hid yourself stays hidden.
- [ ] Unhide `Registration_Ledger` via View ▸ Hidden sheets, type in a cell:
      the warning dialog appears. Cancel.
- [ ] Run Update Registrations as the trigger owner AND as a second editor:
      ledger entries still append (check row count).
- [ ] Show / Hide System Tabs → all appear; press again → all hidden.
- [ ] Update Metrics Now → the Metrics tab opens even though it was hidden.
- [ ] Config `Hide_System_Tabs` = No, Reset Tab Order → all shown, our
      protections gone (Data ▸ Protected sheets). Set back to Yes.
- [ ] Tick a Waitlist_Only box on All_Program_Sessions → the queue tab
      `_Pending_Tag_Changes` stays hidden.

## 11. Later: a system spreadsheet (sketch, not implemented)

If the ledger's size starts to slow the workbook's open/recalc:
- `SHEET_NAMES` gains a parallel `SHEET_BOOKS = { REGISTRATION_LEDGER:
  'system', LEDGER_CHECKPOINT: 'system', TRIAGE: 'system', METRICS: 'system' }`,
  everything else implicitly `'front'`.
- One resolver, `bookFor(name)` → `SpreadsheetApp.getActiveSpreadsheet()` or
  `openSpreadsheetCached(systemSpreadsheetId())`, the id kept in a versioned
  property (`SYSTEM_SPREADSHEET_ID_V1`) and the file on `82`'s `System` shelf.
- Every `ss.getSheetByName(SHEET_NAMES.X)` / `getOrCreateSheet(ss, …)` for a
  system tab goes through `sheetFor(SHEET_NAMES.X)` — a grep-able change.
- A one-time sliced job copies the tabs across, verifies row counts, then
  renames the originals `…_moved` (never deletes) — `99v`/`99p` restores keep
  working against either copy.
- Sharing: the sync account must own or edit the system book; `89`'s sweep
  would add it to its targets.
- `99zp`'s list becomes "what is in the system book"; hiding is then only for
  the queue/cache tabs that stay local.
