# R1 — Event-driven import through one shared response spreadsheet

Item #1 of `docs/RESTRUCTURING_PROPOSALS.md`. Code: `99zj_shared_response_sheet.gs`,
plus small hooks in `27`, `26`, `47`, `68`, `16`, `99r`, `01`.

**Deploying the code changes nothing.** Every new behaviour is behind one switch
(`SHARED_RESPONSES_V1` in Script Properties, turned on only by
🔧 Admin ▸ ⚡ Instant Registration Import…). Until somebody presses that, the
import runs exactly as today, and the only code that runs on the hot path is
one property read that returns "off".

## 1. Current state → new state

| | Today | With the switch on |
|---|---|---|
| How a submission is noticed | The 3-hourly import opens **every** form in the `Form_ID` column (less `99ze`'s ended ones) and calls `getResponses(LAST_FORM_SYNC_TIME)` | Each form also writes to its own tab in ONE responses spreadsheet. ONE installable `onFormSubmit` trigger on that spreadsheet (`onSharedResponseSubmit`) notes *which form* was submitted and arms a one-off import a minute out |
| Who interprets a response | `processFormResponse` (`29`) via `FormApp` | **Unchanged.** The tab is only a *signal*. Nothing parses response-tab columns, so a template migration that renames or deletes items (the v8→v9 meal swap, `68`, `99d`) cannot misread anything |
| Time to reach `All_Registrants` | up to 3 hours | ~1–2 minutes (the near-immediate import, `importSubmittedResponses`) |
| The 3-hourly import | reads every live form | reads only the forms that are **not** confirmed-linked, plus linked forms whose tab row count moved since the last completed window, plus every re-import mark (`99`). **The first window of each day reads every form**, as today |
| Sync clock `LAST_FORM_SYNC_TIME` | advanced by the periodic window | **Only** the periodic window advances it, exactly as today. The instant import never touches it |

### The instant import, precisely

`importSubmittedResponses()` (one-off trigger handler):

1. Deletes its own spent one-off triggers, then clears the "armed" marker, then
   reads the queue — in that order, so a submission landing at any point is
   either in this run's queue read or arms a new run.
2. Gates: switch on; `automationGateAllows` (kill switch — queue is kept, the
   hourly trigger re-arms after unpause); bootstrap/rebuild sweep or a periodic
   sync plan in flight → re-arm 5 minutes out (queue kept).
3. Takes `workbookLock('Instant registration import')` (99w), `tryLock(10s)`;
   busy → re-arm 2 minutes out.
4. Runs the **same** `runRegistrationSyncPhases_()` the periodic sync runs, on
   an in-memory plan with `eventImport: true`, `pendingFormIds` = the queued
   forms that are on the session table or marked for re-import, `lastSync` =
   the current clock, tail = `counts`, `form_shapes`, `appointment_slots`
   (capacity and form labels follow at once — the rest of the tail is the
   periodic sync's). Budget: the smaller of `Sync_Minutes_Per_Run` and 4 min.
5. In event mode the import phase: does not add other re-import marks; does
   not run the form migrations or close ended forms; **does not move the
   clock or clear re-import marks**.
6. A queued form is removed from the queue only if the Registrants write
   landed AND the queue entry's time is ≤ the moment that form's read began
   (`readStartedAt`). A submission that arrived after the read began stays
   queued and gets another run. Forms not reached before the deadline stay
   queued → re-armed 1 minute out.
7. Flushes the ledger buffer and the admin digest in a `finally`, releases the
   lock, flushes the desk queue (`flushDeskWritesAfterSync`), warms Quick Mark.

### Why nothing is read twice into a doubled seat, and nothing skipped

- **Re-reading is already idempotent** and the design relies on it (banner of
  `98`): `buildRegistrantRow` matches a re-read response back to its row by
  `Party_ID` and patches in place; the ledger only gets a `corrected` entry
  when something actually changed (and not if the ledger already says so);
  tombstones still block a deleted response; hand-protected rows are
  untouched. The instant import reads `getResponses(LAST_FORM_SYNC_TIME)`, so
  it re-reads up to 3 hours of a form's responses — cheap, and the same thing
  a failed periodic window always did.
- **Skipping**: the clock is never moved by the instant import, so every
  response is still read by a periodic window that has the form in its list.
  A linked form leaves that list only when its tab's `getLastRow()` equals the
  baseline taken **at the opening of the last window that advanced the clock**
  (the counts are read after `windowOpenedAt`, in the same slice that builds
  the list). A response submitted after that baseline grows the tab, so the
  next window reads the form from a clock ≤ the submission. Forms whose read
  was *refused* get no new baseline, so they are read again next window.
- Anything unknown is read the old way: a form not in the index, a tab not yet
  mapped, a form without a baseline, a spreadsheet that will not open, a
  count that cannot be read. `withoutUnchangedSharedResponseForms_` never
  throws; on any error it returns the list unchanged.
- **Edited responses** (forms allow edits, `05`): an edit updates its tab row in
  place, so the row count does not move. The spreadsheet `onFormSubmit`
  trigger also fires for an edit, which queues it; and the **daily full read**
  (`responses_full_read`, first window of each day) reads every form
  regardless. Worst case for an edit whose trigger was lost: next day, instead
  of ≤3 hours. Manual check below.
- A human deleting rows on a response tab makes its count differ → it is read.
  Delete-then-resubmit to exactly the old count would be missed by the
  backstop until the daily full read; the submit trigger covers the resubmit.

## 2. Every store, tab, property and trigger touched

| What | Kind | Written by | Notes |
|---|---|---|---|
| `SHARED_RESPONSES_V1` | Script Property (JSON) | the setup menu, the rollover menu | `{ enabled, spreadsheetId, createdAt, createdBy, previous: [ids] }`. Absent = off |
| `SHARED_RESPONSE_INDEX_V1::n`, `::0..` | Script Property, chunked JSON | form linking (under the workbook lock), the periodic window close | `{ formId: { s: sheetId|null, p: publishedIdPrefix, n: baselineLastRow|null } }`. ~80 chars/form, 8000/chunk |
| `RESPONSE_SUBMIT_QUEUE_V1::<formId>` (and `::*`) | Script Property, one per form | the submit handler (no lock — each key is its own form, last write wins) | value = ms of the latest submission. `*` = a submission whose form could not be identified → growth scan |
| `INSTANT_IMPORT_ARMED_V1` | Script Property | submit handler / runner | ms when a one-off was armed; stale after 10 min |
| `DAILY_STEP_RUNS_V1['responses_full_read']` | existing store (`99zg`) | periodic window close | the daily full read |
| `FORM_STATE_MIGRATIONS_V1[formId].response_destination_r1` | existing ledger (`68`) | the hourly migration sweep | new id; entries for this id are cleared on rollover |
| `SHARED_RESPONSE_OBSERVED_V1::n`, `::0..` | Script Property, chunked JSON | the periodic window's first slice | `{ window: windowOpenedAt, counts }` — the counts seen at the window's opening; committed as baselines only by THAT window. Kept off the plan because the plan is one property capped at 9KB |
| `REGISTRATION_SYNC_PLAN_V1` | existing | unchanged shape + optional flags `responseCountsObserved`, `responsesFullRead`, `unreadFormIds` | an older in-flight plan without them simply commits no baseline |
| Responses spreadsheet `Registration Responses <year>` | new Drive file, in `<anchor>/System` (`82`) | `SpreadsheetApp.create` + `moveDriveFileInto` | Google adds one tab per linked form. **Never link-shared** — it holds names, phones and emails; named editors only (`openUpFileToAnyoneWithLink(..., { linkSharing: false })`) |
| `onSharedResponseSubmit` | installable trigger, `forSpreadsheet(id).onFormSubmit()` | setup menu, `writeTriggers()` (only when on), rollover | one per account that owns triggers |
| `importSubmittedResponses` | one-off time trigger | the submit handler, the runner, the hourly kick | deleted by the runner when it starts |
| Every live form's destination | Forms | the migration `response_destination_r1` and `createRegistrationForm` / `createFormFromSpec` (birth) | idempotent; a form already linked to a **different** spreadsheet is reported (office digest) and left alone |
| `All_Registrants`, ledger, session counts, form labels | existing | the instant import, through the existing writers | no new writer of any tab |

## 3. How existing data reaches the new shape

There is no data to convert. What changes is that each live form gets a
destination:

1. **Turn on** (menu, admin-gated `Instant Registration Import`, trigger owner
   only): creates the spreadsheet, shares it with the named editors, stores
   `SHARED_RESPONSES_V1`, installs the submit trigger.
2. The hourly sync's migration sweep (`runFormStateMigrations`, max 20 forms
   opened per run, after the import loop) runs `response_destination_r1` on
   every form that is **not recorded ended** (`99ze`) — ended forms accept no
   responses and would only spend cells. 🔧 Admin ▸ 🧭 Fix Forms In Place
   forces the sweep now (it slices itself).
3. `setDestination` backfills a form's existing responses into its new tab.
   That is the only bulk effect, and it is in a spreadsheet nothing else
   reads. Cell budget: rows × columns per form; a 300-response form with 30
   columns is 9,000 cells, so 200 such forms are 1.8M of the 10M ceiling.
   The first window of each day sums `lastRow × lastColumn` over the tabs and
   files an office-digest note above 7M asking for a rollover.
4. Verification: the setup dialog reports linked / not linked / linked
   elsewhere / tabs mapped / baselines; until a form is linked AND mapped AND
   has a baseline it is read the old way, so the transition is gradual and
   never skips a form.

**Yearly rollover** (🔧 Admin ▸ ⚡ … ▸ "start a new responses spreadsheet",
admin-gated `New Responses Spreadsheet`): creates the next spreadsheet, keeps
the old id in `previous`, clears the index and the migration ledger entries
for `response_destination_r1`, and moves the submit trigger. Forms are
re-pointed by the sweep (a form linked to a `previous` spreadsheet is ours to
move; anything else is still reported). Until each is re-pointed it is
"not linked to current" → read by FormApp every window. Re-pointing backfills
that form's history into the new tab again; the old spreadsheet is left in
place as a record.

## 4. Mid-transition

- **Old code + new data** (code reverted with the switch still on): forms stay
  linked (harmless — the old code reads via FormApp from its clock); the
  installed trigger names a function that no longer exists, so each
  submission produces an Apps Script failure e-mail to the trigger owner.
  **Turn the switch off before reverting** (it removes the trigger), or delete
  the `onSharedResponseSubmit` trigger by hand. The new Script Properties are
  ignored by the old code.
- **New code + old data**: no `SHARED_RESPONSES_V1` → everything off,
  identical to today.
- **A sync slice killed mid-migration**: the migration ledger and index are
  flushed at the end of the sweep, so a killed slice re-runs `apply` on those
  forms; `apply` sees `getDestinationId() === ours` and only re-records the
  index entry. A linked form missing from the index is read the old way.
- **A sliced sync mid-flight when this deploys**: its plan has no
  `responseCountsObserved`; nothing is filtered and no baseline is committed for that
  window. The next window behaves normally.
- **The instant import killed mid-run**: it cleared the armed marker at start
  and removes queue entries only after the write, so the queue is intact; the
  next submission or the next hourly trigger (`kickInstantImportIfOwed_`)
  re-arms. Its lock lease lapses (99w).
- **Switch turned off mid-flight**: the runner checks the switch first and
  returns; queued entries are dropped by "turn off". The periodic import
  resumes reading every form.

## 5. Concurrency

- **Submit handler**: never takes the workbook lock or the script lock, never
  opens the workbook or a form. It reads the switch and the index, writes one
  queue property, and maybe one armed property + one trigger. Two simultaneous
  submissions may both arm a trigger; the second run finds the lock busy or
  the queue empty — harmless.
- **Hourly sync**: the instant import refuses while a periodic plan is in
  flight (`isRegistrationSyncInFlight`) and otherwise both take the same
  workbook lock, so they never overlap. A periodic window that arrives while
  an instant import holds the lock is skipped/re-armed by its own logic, as
  with any other lock holder.
- **Quick Mark / door app**: they already defer behind any lock holder
  (`workbookHeldElsewhere`, `99b`) and `flushDeskWritesAfterSync()` is called
  when the instant import releases, as both syncs do.
- **onEdit**: unaffected. The instant import's writes suppress the change
  generation like the periodic sync's (inside `runRegistrationSyncPhases_`).

## 6. Quotas

- Triggers: one installable submit trigger + at most one pending one-off per
  account (20/user cap). One-off triggers are deleted by the runner.
- Execution time: the instant import is bounded to 4 minutes; a burst of 30
  submissions in a minute is ONE run (coalesced by the armed marker).
- Trigger total runtime (90 min/day consumer, 6 h Workspace): each instant
  import is roughly an import of K forms + a Registrants write + 3 tail steps.
  The periodic import in exchange opens far fewer forms.
- Script Properties (500KB): the index is ~16KB for 200 forms; queue keys
  exist only between a submission and its import.
- Spreadsheet: 10M cells — see §3.

## 7. Rollback

1. 🔧 Admin ▸ ⚡ Instant Registration Import… ▸ turn **off**. This removes the
   submit trigger(s) visible to this account and any pending one-off, drops
   the queue, and sets `enabled: false`. From the next window the periodic
   import reads every form again — the clock was never moved by the feature,
   so nothing is owed.
2. Revert the code if wanted. Forms may stay linked; old code ignores that.
   To unlink anyway, open each form ▸ Responses ▸ ⋮ ▸ Unlink form (optional).
3. If the trigger was installed by another account, sign in as it and delete
   `onSharedResponseSubmit` on the Apps Script Triggers page.

## 8. Measurements

`tools/sync_bench.js` and `tools/render_bench.js` measure the reconcile phase
and one Registrants render; neither path changes here (the instant import
calls the same renderer), so the numbers are unchanged:

| bench | before | after |
|---|---|---|
| sync_bench (reconcile phase) | 16 round trips; 4 reads, 22,776 cells | identical |
| render_bench (Registrants, two renders / one leader sheet) | 252 / 191 | identical |

What does change, and cannot be benched against the stubs: a quiet periodic
window opens one spreadsheet and makes ~1 call per response tab
(`getSheets()` once, `getLastRow()` per tab, `getFormUrl()` only for an
unmapped tab) instead of one `FormApp.openById` + one `getResponses` per live
form.

## 9. Manual test checklist (test workbook)

1. Deploy. Run "Sync Registrations only": the log must not mention shared
   responses; nothing in Drive changes. (Off by default.)
2. 🔧 Admin ▸ ⚡ Instant Registration Import… → turn on. Check: a spreadsheet
   `Registration Responses <year>` in `<anchor>/System`; its sharing is NOT
   "anyone with the link"; Apps Script Triggers lists `onSharedResponseSubmit`.
3. 🔧 Admin ▸ 🧭 Fix Forms In Place. Reopen the setup dialog: forms linked,
   tabs appear in the responses spreadsheet with their past responses.
4. Submit a test registration on a live form. Within ~2 minutes it is on
   `All_Registrants`, the session's counts moved, the Executions page shows
   `onSharedResponseSubmit` then `importSubmittedResponses`.
5. Submit 5 registrations within a minute on two forms → one
   `importSubmittedResponses` run (maybe two), all rows present once each.
6. Edit a submitted response via its edit link → the row updates within ~2
   minutes, no duplicate row, ledger gets one `corrected`.
7. While "Sync Registrations only" is running, submit a response → it lands
   after that sync ends (re-armed), once.
8. Quick Mark during an instant import → "goes on the sheet when the sync
   finishes", then lands.
9. Set `Automation_Enabled` = No, submit → nothing imported; set back to Yes →
   within the hour the next trigger kicks the import.
10. Run "Sync Registrations only" twice with no new submissions → the second
    log says linked forms were skipped as unchanged (except on the first
    window of the day).
11. Link one form by hand to some other spreadsheet → the sweep reports it in
    the office digest and leaves it; it is still imported (by FormApp).
12. Turn off → trigger gone, submissions take ≤3 h again, nothing lost.
13. Rollover on the test workbook → new spreadsheet, forms re-pointed over the
    next sweeps, submissions keep importing throughout.
