# The registration ledger — design draft

**Status: phase 1 is built** (`99k_registration_ledger.gs` — the tab, the
vocabulary, the appender and its buffer, and the fold; nothing calls the
appender). Phases 2–5 are unbuilt. Phase 0 below is a prerequisite read of the
code, not a change; phases 1–5 are the shippable sequence.

---

## 0. The fault this is for

`All_Registrants` is rebuilt by reading itself. Every writer in this project
ends the same way — take the tab's rows into memory, change some of them,
`renderRegistrantsSheet(false, rows)` — and that render clears the sheet and
writes the array back (`35_per_sheet_render.gs:5` → `renderFlatDateSheet` in
`34_sectioned_tables.gs`). Fifteen call sites reach it:

```
12_sheet_setup  22_renamed_programs  26_event_descriptions (x2)  27_registration_import
38_quick_mark_index  41_club_rosters  42_legacy_tab_merge  46_program_leader_sheets
48_deleting_registrations  71_cancellation  85_duplicate_registrations
99a_registrant_changes
```

At the moment of the clear, **one short in-memory array is the only copy of
every registration this centre holds**. A read that returned fewer rows than
the tab had, a filter that dropped one row too many, a slice that ran out of
budget between the read and the write, an exception swallowed by a caller that
had already built a shortened array — any of those is a permanent, silent
deletion, and it has happened more than once with no cause ever established.

The codebase already carries the scar tissue. `dropSupersededRegistrantRows()`
(`35_per_sheet_render.gs:47`) has a long banner about the one case where its
own filter deleted registrations instead of tidying duplicates, and it now
checks a claim it used to trust. That is the right fix for that filter and it
does nothing for the next one. `99d_registration_import_audit.gs` exists
because "never registered" and "dropped by the import" produce the identical
silence — it reconstructs what should have been imported by re-reading the
forms, which is only possible for rows that came from a form at all. A door
sign-in or a Quick Mark walk-in has no form behind it; if that row is lost, it
is lost with no second copy anywhere in the system.

The shrink guard and the nightly CSV snapshot that landed in
`99j_registrant_safety_net.gs` are the smoke alarm: they notice a loss and they
keep a copy from some hours ago. The guard fires at a loss of half the tab and
at least ten rows, which is calibrated so it cannot be hit legitimately — and
therefore cannot see the loss of nine. The snapshot is last night's, so a
registration taken this morning and lost this afternoon was never in it, and
reading one back out of a CSV is a person retyping a row. Neither can tell you
*which* registrations went, because neither knows what the tab was supposed to
say.

---

## 1. The ledger

### 1.1 The grain: one row per EVENT, not per person

This is the whole difference. `All_Registrants` is one row per person per
session, mutated in place — so "Joan cancelled" is the absence of a word she
used to have, and "Joan was moved from Tuesday to Thursday" is a row that has
always said Thursday. The ledger records the *happening*:

```
2026-09-14 09:31  registered   Joan Meier   Chair Yoga 9/16 Ashbridge   (form)
2026-09-15 14:02  cancelled    Joan Meier   Chair Yoga 9/16 Ashbridge   (cancel page)
2026-09-15 14:05  registered   Joan Meier   Chair Yoga 9/23 Ashbridge   (desk)
```

Three rows, never edited, never removed. Everything the tab shows is a replay
of them, and everything the tab *cannot* show — that she rang on the 15th, that
the cancel came from the link in her calendar invite — is on the record for the
first time.

### 1.2 The tab

A sheet `Registration_Ledger`, `SHEET_NAMES.REGISTRATION_LEDGER`, headers
`HEADERS.Registration_Ledger` in `03_sheets_and_headers.gs` like every other
tab's. Never rendered by a sectioned writer, never sorted, never cleared:
appended to and read whole.

| Column | What it holds |
|---|---|
| `Entry_ID` | `Utilities.getUuid()`, minted at append. The ledger's own identity, used by nothing but de-duplication of a retried append. |
| `Entry_At` | When the append happened, in `TIMEZONE`. Not when the thing happened — see `Occurred_At`. |
| `Occurred_At` | When the thing being recorded happened, where that differs: a form response's submission time, a leader's tick read back hours later. Blank means "the same as `Entry_At`". |
| `Kind` | One of the eight below. |
| `Registration_ID` | **The fold key.** The identity of the registration this entry is about — see §1.4. |
| `Event_ID` | The session. On a `moved` entry, the session being moved *to*; the one moved from is in `Payload`. |
| `Name` | The display name as written at the time. Denormalized deliberately: a ledger row has to be readable by eye without a join. |
| `Person_Type` | Registrant / Guest / Volunteer, as `All_Registrants` spells it. |
| `Party_ID` | The form response's party, where there is one. Blank for a desk or door entry, which is exactly why it is not the fold key. |
| `Source` | Which writer appended: `import`, `all-dates`, `club`, `door`, `quick-mark`, `cancel-page`, `leader-sheet`, `change-panel`, `dedupe`, `remove-sweep`, `migration`. One value per call site, so "where did this come from" is answered by reading rather than inferring. |
| `Actor` | `Session.getActiveUser().getEmail()` where a person pressed something, the trigger owner where a sync did, blank where neither is knowable. Best-effort and never load-bearing. |
| `Payload` | JSON. The fields this entry sets, and nothing else — see §1.5. |
| `Note` | One sentence a person reads. What `Admin_Notes` stamps say today. |

### 1.3 The eight kinds

The user's brief names seven; the eighth (`superseded`) falls out of the
existing resubmission path and has to be here or the fold cannot reproduce the
tab.

| Kind | Means | Appended by |
|---|---|---|
| `registered` | A place taken. The only kind that may create a `Registration_ID`. | import, all-dates catch-up, club catch-up, door, Quick Mark walk-in, change panel (restore onto a new session) |
| `cancelled` | A place given up. | cancel page, leader `Dropped` tick, change panel, Quick Mark |
| `waitlisted` | Holding a place in the queue rather than a seat. Reversible. | import (capacity), Quick Mark's **Add to waitlist**, leader `Waitlisted` tick, change panel |
| `reactivated` | Back off the waitlist, or back from a cancellation. The reverse of the two above, which today is `stampRegistrantRowActive` and `stampRegistrantRowUncancelled` (`71`, `99a`). | Quick Mark, leader tick, change panel |
| `moved` | The same registration, a different session. `Event_ID` is the destination; `Payload.from` is the origin. | change panel, `47_moving_sessions` |
| `corrected` | Any field change that is not a status change: a phone number, a spelling, a meal count, a mark ticked at the desk. `Payload` carries only the fields that changed. | Quick Mark (marks), change panel, the `onEdit` handlers on the tab itself |
| `merged` | Two registrations were one person. `Payload.absorbed` names the `Registration_ID` that stops existing; the surviving id is in `Registration_ID`. | dedupe |
| `removed` | This registration should never have existed. Not a cancellation — a cancellation is a fact about a person, a removal is a fact about a mistake. | remove sweep, change panel's `remove` |
| `superseded` | A newer submission replaced this one. `Payload.by` names the new `Registration_ID`. | import |

That is nine rows in the table because `superseded` is the addition; the seven
in the brief plus `reactivated` and `superseded`, with `registered` covering
both a form sign-up and a walk-in.

**No kind is ever deleted or rewritten.** A mistaken entry is answered by a
further entry — that is what `removed` is for — and the fold's job is to make
the last word win.

### 1.4 `Registration_ID`, and why it is not `Party_ID`

The brief asks for state per `Party_ID`. It cannot be: **`Party_ID` is blank on
every row this system writes outside the form import.** `buildRegistrantRow()`
sets it from the response (`29_form_response_processing.gs:611`) and nothing in
`38_quick_mark_index.gs` or `74_door_day_and_sign_in.gs` passes one — grep for
`partyId` in either file and there is nothing. It is also not unique per
person: a party is a household submitting together, so four rows share one.

So the ledger mints its own: `Registration_ID`, `Utilities.getUuid()`, created
by the `registered` entry and carried verbatim by every later entry about that
registration. `Party_ID` stays a column beside it, because the import still
needs it to tell "the same response came round again" from "they registered
again" (`29:355`), and because §5's backfill matches on it.

**How a writer that is not the one that created the registration finds the id.**
Two answers, in order:

1. The row it is acting on carries it. A new column `Registration_ID` on
   `HEADERS.All_Registrants`, written by the fold, hidden like
   `PROGRAM_MONTH_HIDDEN_COLUMNS` hides `Room`. Quick Mark, the change panel,
   the cancel page and the dedupe are all acting on a row they already hold, so
   this is the answer for all of them.
2. Nothing has one — a leader's tick read back from a shared sheet, a migration
   entry, a row written before phase 2 — so the writer resolves through
   `resolveRegistrationId(eventId, name, personType)`, which is
   `registrantImportKey()` (`85_duplicate_registrations.gs:239`) looked up
   against the fold's index. The same key the tombstones, the superseded match
   and the import index are all already built on
   (`supersededRegistrantMatchKey`, `35:97`). A key that resolves to nothing at
   all is a `registered` entry, which is the correct reading of "this person is
   on a roster and the ledger has never heard of them".

### 1.5 `Payload`

A JSON object of the columns this entry sets, in `HEADERS.All_Registrants`
spelling, and no others. Not a whole row — a whole row per entry would make
every entry a fresh assertion of every field, and a stale field in a `corrected`
entry would then silently undo a change made between the read and the append,
which is the same class of fault this whole document is about.

```json
{"Attended": true, "Meals_Ordered": 2}
{"from": "ashb-2026-09-16-chairyoga", "Event_Date": "2026-09-23", "Event_Time": "10:00 AM"}
{"absorbed": "9f2c…", "Meals_Ordered": 3}
```

Values are JSON scalars; a date is `yyyy-MM-dd` and a time is the label string
the tab already carries (`Event_Time` is words, not a time value — see
`textColumns` at `35:18`). Everything that crosses into a served page is still
escaped by the rules in CLAUDE.md; nothing here changes that.

### 1.6 Size, and when the tab stops being a tab

A centre at this scale writes on the order of 10–15k registrations a year;
with corrections and marks, call it three ledger entries per registration —
40k rows a year. Sheets will hold that for years, and `getValues()` over 40k ×
14 is one read of roughly the size the Registrants tab already is at 1,280 × 37
(`tools/render_bench.js`).

It still grows forever, so **archival is part of the design, not a later
worry**: `archiveLedgerThrough(date)` moves every entry whose registration has
no session on or after `date` into a dated `Registration_Ledger_2026` tab and
leaves a single `registered`-shaped **checkpoint** entry per still-live
registration in its place. A checkpoint is a `registered` entry whose `Payload`
is the folded state at the cut, with `Source: 'migration'` and a `Note` saying
so — which is exactly the shape the fold already handles, so archival needs no
special case in the replay. Nothing is archived until phase 5, and nothing is
ever deleted from Drive.

---

## 2. Every writer that must append

The rule: **append first, then do what you do now.** An append that throws
means the change does not happen; a change that happened without an append is
the fault this design exists to remove, and it is better to refuse a desk mark
than to take one that leaves no record. (Quick Mark and the door are optimistic
— they answer before they write — so a refused append is a refused write and
goes down `99b_optimistic_retry.gs`'s queue like any other, unchanged.)

| # | File | Call site | Kind(s) | Note |
|---|---|---|---|---|
| 1 | `27_registration_import.gs` | `runRegistrationImportPhase`, at the point rows are collected and before `renderRegistrantsSheet(false, combinedRegistrantRows)` (`27:286`) | `registered`, `waitlisted`, `superseded` | The import builds rows through `buildRegistrantRow()` and hands them up; the append is one batch per slice, not one per row (§2.1). A slice that runs out of budget mid-loop already writes the rows it built without advancing the clock (`98`) — the appends go with those rows, in the same order, so the two halves cannot come apart. |
| 2 | `29_form_response_processing.gs` | `buildRegistrantRow()` itself — the single funnel every path builds rows through, import and both catch-ups | `registered`, `waitlisted`, `superseded` | This is where the kind is *decided* (the capacity check, the `WAITLIST_ONLY_TAG` branch, `supersedeRegistrantRow()` at `29:357`), so this is where the entry is *composed*. It is not where it is appended: the function is called inside a loop with a live occupancy counter, and one `appendRow` per response is hundreds of round trips. It returns the entry alongside the row and `27` flushes the batch. |
| 3 | `74_door_day_and_sign_in.gs` | `walkInSignIn()` (`74:542`), around its call into `applyQuickMarkFromDialog` | `registered`, `corrected` | The door is where the absence of a second copy is worst: no form response behind the row, so `99d`'s audit cannot reconstruct it. `recordWalkInMember()` (`74:817`) writes the roll, not a registration, and appends nothing. |
| 4 | `71_cancellation.gs` | `cancelRegistrantRowsLocked()` (`71:141`) — the one writer all three cancel doors funnel through — and `stampRegistrantRowWaitlisted` / `stampRegistrantRowActive` (`71:796`, `71:823`) | `cancelled`, `waitlisted`, `reactivated` | One append per matched row, inside the existing lock, before the four cells are stamped. `applyLeaderDropsAsCancellations` (`71:285`) and `applyLeaderWaitlistTicks` (`71:936`) reach these same writers and so need no append of their own — but they do need `Source: 'leader-sheet'` and an `Occurred_At` they cannot know, so those two pass `Occurred_At` blank and say in `Note` that the tick was read back on this sync. |
| 5 | `38_quick_mark_index.gs` | `applyQuickMarkLocked()` (`38:1021`), which is where the desk's five ticks land | `corrected`, `registered` (walk-in), `waitlisted` (**Add to waitlist**, which reaches `71`'s writer and is therefore covered by #4) | The four marks are `corrected` entries carrying only the ticked fields. `applyQuickMarkForHousehold` presses several people at once and appends one entry each — a household is a convenience at the desk, not one registration. |
| 6 | `99a_registrant_changes.gs` | `applyRegistrantChangeFromDialog()` (`99a:113`), once per action, on the rows `pickRegistrantRowForChange()` resolved | all nine | The densest caller and the easiest, because every one of its nine actions is already a named intent — the dispatch table *is* the kind mapping. `move` appends `moved` with `Payload.from`; `remove` appends `removed`. |
| 7 | `85_duplicate_registrations.gs` | `mergeRegistrantRow()` (`85:351`), per collapsed pair, before `renderRegistrantsSheet(false, keepRows)` (`85:490`) | `merged` | `Registration_ID` is the survivor, `Payload.absorbed` the one that stops existing, and `Payload` carries the merge's own arithmetic (the meal mode, the OR-ed marks) so the fold reproduces the same numbers rather than re-deriving them from two entries it can no longer see separately. |
| 8 | `83_remove_marked_registrants.gs` | `removeMarkedRegistrantsInternal()` (`83:162`), where it records tombstones today | `removed` | The append replaces the tombstone write, not accompanies it — see §4.1. |
| 9 | `18_edit_handlers.gs` | the Registrants-tab `onEdit` branch | `corrected` | **The one this design must not forget.** Staff edit the tab by hand, and today that edit is the state. Once the tab is a projection, a hand edit that is not appended is overwritten by the next fold — which is a new way to lose a change, introduced by the fix. Phase 3 is gated on this being in place. |
| 10 | `41_club_rosters.gs`, `26_event_descriptions.gs`, `22_renamed_programs.gs`, `46_program_leader_sheets.gs`, `42_legacy_tab_merge.gs` | their `renderRegistrantsSheet` calls | — | **These append nothing.** Each is a re-render or a re-key of rows that already exist (a rename carried across, a triage move, a leader-sheet push). They are listed here to say so: a writer that changes no registration's state appends nothing, and phase 2's verifier (§5.2) is what proves each of these belongs on this line rather than the one above. |

### 2.1 Batching, and the one lock

`sheet.appendRow()` per entry is a round trip per entry, which the import
cannot afford. So: `appendLedgerEntries(entries)`, one `setValues()` into the
rows past the last, and a per-execution buffer with `flushLedger()` called from
the same places `flushPersistentRegistries()` is — plus a `finally` on every
sliced job, because an entry buffered and not flushed is the loss again in a
new coat.

Appends take **no new lock**. Every caller above already holds the workbook
lock (the desk's `withScriptLock`, the sync's, the change panel's), and the
append is inside it. The one exception is a caller that takes no lock today;
there is none in the table above, and if one appears it takes the existing lock
rather than a second one — `LockService` locks are not reentrant and the
consequence of getting that wrong is quiet rather than loud
(`99b_optimistic_retry.gs`'s banner, on exactly this).

---

## 3. The fold

### 3.1 What it is

```
foldRegistrationLedger(entries) -> { rowsByRegistrationId, index, problems }
```

Read the ledger whole. Sort by `Entry_At`, ties broken by row order — the sheet
*is* the order, so this is a stable sort over an already-ordered read and not a
clock comparison. Then, per entry:

- `registered` — create the state if the id is new; if it exists, treat as
  `reactivated` plus `corrected` (a re-registration after a cancellation is the
  ordinary case and must not create a second seat).
- `cancelled` / `waitlisted` / `reactivated` — set `Program_Status` and
  `Lunch_Status` through **`71`'s existing stampers**, not a fourth copy of the
  four cells. The fold calls `stampRegistrantRowCancelled` etc. against the
  in-progress state, which is what keeps "a status is never one cell" true by
  construction rather than by a comment.
- `moved` — rewrite `Event_ID`/`Event_Date`/`Event_Time`, clear the marks
  (`clearRegistrantMarksOnRow` — attended is a fact about a day), carry the
  meal per `99a`'s existing rule.
- `corrected` — shallow-assign `Payload` over the state.
- `merged` — assign into the survivor and mark the absorbed id dead.
- `removed` / `superseded` — mark the id dead. A dead id is not written out and
  is not resurrected by a later `corrected` (which would be a writer appending
  against a stale row; it is recorded in `problems` and dropped).

Out comes one state per live `Registration_ID`, projected into
`HEADERS.All_Registrants` order — which is exactly the array
`renderRegistrantsSheet(force, allRows)` already takes as its second argument.

### 3.2 Where it runs

**Not inside the render.** The render's contract stays "here are the rows, draw
them"; fifteen callers depend on it and the fold has no business in the middle
of `renderFlatDateSheet`'s two zones.

It runs one layer up, in `35_per_sheet_render.gs`, as the source of the rows:

```js
function renderRegistrantsSheet(force, allRows) {
  const rows = allRows || foldedRegistrantRows();   // was: getSectionedRows(sheet, …)
  …
}
```

and `foldedRegistrantRows()` is `foldRegistrationLedger()` memoized per
execution in `08_execution_caches.gs` beside the other hot-path memos,
invalidated by `flushLedger()` for the same reason
`invalidateSectionedRowsCache()` drops the session grid.

The `allRows` argument stays, and it is the whole of the incremental story:
during phases 1–3 every caller keeps passing the array it built, the fold runs
beside it, and the difference between the two is the verifier. In phase 4 the
callers stop passing it — they append and then render — and at that point the
tab is a projection and the array in memory is nobody's only copy.

Three readers do not go through `renderRegistrantsSheet` and read the tab
directly (`38`'s index, `44`'s rollup, `46`'s push). They keep reading the tab,
because after phase 4 the tab is correct by construction — reading a projection
is safe in a way that *writing through* one is not.

### 3.3 Cost, and the answer if it is too slow

A fold over 40k entries in Apps Script is arithmetic over an array already in
memory: the read is the cost, not the replay, and it is one read. If it
measures badly, the answer is the checkpoint of §1.6 brought forward — a
checkpoint entry per live registration written nightly collapses the replay to
"the checkpoints plus today", and needs no change to the fold because a
checkpoint is a `registered` entry. `tools/render_bench.js` is the before/after,
and a `tools/ledger_bench.js` beside it is part of phase 2.

---

## 4. What this retires

### 4.1 The deletion tombstones (`28_deletion_tombstones.gs`)

A tombstone is "a human deliberately removed this registration", stored in
Script Properties because there was nowhere else to put it. In the ledger it is
a `removed` entry, and the three paths its banner names close for the same
reason they close now:

- the all-dates registry and the club roster re-book somebody on every sync —
  but they build rows through `buildRegistrantRow()`, which asks the fold
  whether this `registrantImportKey` has a `removed` entry more recent than its
  last `registered` one. Same check, same funnel, a different store.
- the form response is re-imported whenever `LAST_FORM_SYNC_TIME` moves
  backwards — and the re-import produces a `registered` entry whose `Party_ID`
  matches the one already folded, which is a duplicate append and is dropped.
  That is `28`'s Party_ID rule (`28:45`) moved onto the ledger verbatim.

Two properties of the tombstones survive and must be carried, not assumed:
**they expire** (`TOMBSTONE_RETENTION_DAYS`, 400 — a property that only grows
stops being writable; the ledger's answer is §1.6's archival, which is why
archival is in this document rather than a later one) and **they stand down**
for a genuinely new submission (`clearRegistrantTombstones()`), which in the
ledger is the plain reading of a `registered` entry that is later than the
`removed` one.

`99d_registration_import_audit.gs` calls `withReadOnlyRegistries_()` precisely
because `clearRegistrantTombstones` writes immediately and could not be covered
by not-flushing. Once the tombstones are ledger entries and the audit's fold is
a pure function of an array, that swap-and-restore goes with them — which is a
small file getting smaller for a reason worth writing down.

### 4.2 `Manual_Override`'s protection role

`getProtectedRegistrantKeys()` (`28:172`) exists because an hourly sync
re-derives rows from their form responses and would overwrite a staff edit with
`Auto-Synced`. It protects three values — `Manually Edited`, `Manually Added`,
and `Remove This Row`, the last for the reason `83`'s banner gives.

The ledger removes the need for all three, because the sync no longer
overwrites anything: it *appends*, and a `corrected` entry appended by the
`onEdit` handler (#9 above) is later than the import's, so the staff edit wins
by being the last word. That is the ordering guarantee the `Manual_Override`
flag was standing in for.

**`Manual_Override` the column stays.** It is a thing staff read, set and sort
by, `39_triage_sheet.gs` washes `Remove This Row` red, and `83`'s dropdown is a
real workflow. What is retired is its *protection* role: after phase 4,
`getProtectedRegistrantKeys()` is called by nothing and the column is a label
rather than a mechanism. `83`'s sweep still sweeps; it appends `removed` and
the fold does the rest.

### 4.3 Both halves of `99j_registrant_safety_net.gs`

The guard (`guardRegistrantRowLoss_`, consulted by `renderFlatDateSheet()`
immediately before its `clear()`) is a heuristic answer to "did this render
just lose rows": refuse at a loss of half the tab and at least ten rows, warn
and snapshot at five. Its own banner is honest about the calibration — the
fraction is what makes it impossible to hit legitimately, which is another way
of saying **it cannot see the loss of nine rows**, and nine registrations is a
week of a class.

With the ledger the question stops being a heuristic and becomes decidable: the
fold says how many live registrations there are, and a render that would write
a different number is a bug in the projection rather than a possible data loss.
It is still reported — the refusal is still the right outcome in front of
somebody, and `99j`'s reasoning about throwing rather than skipping quietly
(the sliced sync records a step that threw and steps over it) holds exactly as
written. What changes is the threshold: **one row**, because with a second copy
in the workbook a false refusal costs a redraw instead of a roster.

So `guardRegistrantRowLoss_` is not deleted. It is re-pointed at the fold's
count in phase 5, its two constants go, and the file keeps its name and its
banner.

The CSV snapshot stays too, and outlives all of this — see §6's last bullet: a
copy outside the workbook is the one thing the ledger cannot be, and after
phase 5 `snapshotRegistrantsDaily()` snapshots the **ledger** as well as the
tab. `REGISTRANT_SNAPSHOT_KEEP_DAYS` (90, chosen against how these losses are
actually found — not on the day, but when somebody turns up for a session they
registered for weeks ago) is the one number here that should probably go up
rather than away: the ledger makes the 91st day recoverable from inside the
workbook, which is a reason to trust the export less, not more.

`tests/registrant_shrink_guard.test.js` pins the current thresholds, so phase 5
changes that test rather than removing it.

---

## 5. Phases

The ordering rule throughout: **the ledger is written and proved correct before
anything reads from it**, and the tab stays the state until the day it does not.

### Phase 1 — the tab, the schema, the appender

`SHEET_NAMES.REGISTRATION_LEDGER`, `HEADERS.Registration_Ledger`,
`LEDGER_ENTRY_KINDS` and `LEDGER_SOURCES` in a new file numbered at the end
(never renumber). `appendLedgerEntries()`, the per-execution buffer,
`flushLedger()`, and its `finally` on every sliced job. `foldRegistrationLedger()`
written and unit-tested against hand-built entry arrays —
`tests/registration_ledger.test.js`, plain Node like every other test here.

**Nothing calls the appender.** Shippable, inert, reversible by deleting a tab.

### Phase 2 — every writer appends; nothing reads

The nine call sites of §2. Still nobody folds into the tab.

Beside them, the thing that makes the rest of this safe:
`verifyLedgerAgainstTab()`, run at the end of every sync and reported into the
office's daily digest (`88`) — fold the ledger, read the tab, and name the
differences in three buckets:

- **on the tab, not in the fold** — a writer that is not appending. The list of
  which writers those are is the whole output of this phase.
- **in the fold, not on the tab** — either a writer appending something it does
  not write, or *a row the tab has lost*. This bucket is the original fault,
  detected for the first time, and it is worth shipping phase 2 for on its own.
- **both, disagreeing** — a fold bug, per column, which is what phase 3's work
  is scoped from.

This phase is where the time goes and it is the phase that pays first: from the
day it ships, a lost registration is a line in tomorrow's digest naming the
person, rather than a phone call in March.

Exit criterion: the first two buckets empty and the third stable, over a month
of real syncs including at least one month-end and one bootstrap.

### Phase 3 — the backfill

Everything on `All_Registrants` today predates the ledger. `backfillLedgerFromTab()`
writes one `registered` entry per live row, `Source: 'migration'`,
`Occurred_At` the row's best available evidence (the form response's submitted
time where `Form_Source` still resolves, the session date otherwise),
`Registration_ID` freshly minted and **written back onto the row** so §1.4's
first resolution path works from then on. A row whose `Program_Status` is
`Cancelled`, `Waitlisted` or `Superseded` gets its `registered` entry plus the
one entry that puts it in that state, so the fold reproduces the tab rather
than reviving everybody.

Sliced on `runSlicedJob` (`75`) like the four other long jobs, idempotent per
row, and run once from Admin ▸ One-Time Jobs. After it, bucket one of the
verifier is empty for historical reasons as well as behavioural ones.

**Correction (2026-09-23), and it is the whole of what makes the backfill
safe.** An earlier draft of this section said the job is "idempotent per row (a
row that already carries a `Registration_ID` is skipped)" — which keys the
idempotency on the one field that is blank on every row the job exists to
process. The starting state is a tab where EVERY `Registration_ID` is empty,
and the job is SLICED, and Apps Script kills an execution at its ceiling with
no exception and no `finally`. So a slice that dies between appending the
`registered` entry and writing the id back onto the row leaves a still-blank
row, and the next slice mints a SECOND id and appends a SECOND `registered`
entry. The fold keys state on `Registration_ID`, so that is two live states for
one person: two rows, two seats against a capacity and two meals against a
catering count — the exact duplication `85` exists to clean up, manufactured by
the migration meant to be invisible.

So the rule is **resolve before you mint**: per row, ask
`resolveRegistrationId(index, eventId, name, personType)` against the folded
ledger and mint only when it answers null. A blank row is then idempotent
whether or not the row write landed, and it is §1.4's second resolution path
doing exactly the job it was written for — the row's blankness is a hint, not
the key. Where an order must still be chosen, write the row's id BEFORE
appending: a row with an id and no entry is the safe failure (the tab is
authoritative until phase 4, and the verifier's bucket one names it), while an
entry no row claims is the unsafe one.

Two more things follow from the blank window, which lasts as long as the
backfill does:

- **`Registration_ID` is not a column the verifier compares.** While the
  backfill runs, the tab's column is blank and the fold's rows carry ids, so a
  naive per-column diff puts every row into bucket three. A verifier reporting
  twelve hundred disagreements is a verifier nobody reads, and it would bury
  the real findings during precisely the month phase 4's gate is measured over.
  A blank there means "not yet backfilled", not a disagreement: it is ledger
  bookkeeping rather than registration state.
- **The ids go back as a targeted column write, never a re-render.** Having the
  backfill call `renderRegistrantsSheet()` per slice to persist them is the
  read-self / `clear()` / rewrite operation this entire document distrusts, run
  repeatedly over the whole tab and straight into `99j`'s shrink guard. Write
  the column directly, one `setValues()` per section zone on the pattern
  `96_session_grid.gs` uses, and never against row positions read in an earlier
  execution.

### Phase 4 — the fold becomes the source

`renderRegistrantsSheet()` takes its rows from `foldedRegistrantRows()` when no
array is passed; the callers of §2 stop passing one. `getProtectedRegistrantKeys()`
loses its callers. The tombstone checks in `buildRegistrantRow()` are re-pointed
at the fold.

Gated on: §2's #9 (the `onEdit` appender) shipped and verified, and the
verifier clean. The switch is one function's body and is revertible in one
commit, which is deliberate — this is the only phase that can lose anything, so
it is the one that has to be undoable in a hurry.

### Phase 5 — the retirements and the archive

`28`'s store, `99j`'s guard re-pointed at the fold's count (and its snapshot
re-pointed at the ledger), `99d`'s `withReadOnlyRegistries_()` swap, and
`archiveLedgerThrough()` with its checkpoint entries. Each is its own commit,
each after its own quiet month.

---

## 6. What this does not fix, said plainly

- **A ledger entry that is never appended.** The fault moves rather than
  vanishing: today a writer can lose a row, afterwards it can fail to record
  one. It is a better failure — it is one call site rather than a whole array,
  it is caught by the verifier in phase 2 and by the fold disagreeing with the
  tab afterwards — but it is not nothing, and the `onEdit` case (#9) is the one
  where a real person's real change is on the line.
- **A wrong entry.** An append-only store makes history honest, not correct. A
  desk that marks the wrong Mary appends a true record of a wrong act.
- **The forms.** A response that never became a row still never becomes a
  ledger entry; `99d`'s audit is unaffected and still needed.
- **Sheets.** The ledger is a tab in the same workbook as the thing it protects.
  A workbook lost is both lost. That is what the nightly export is actually for,
  and it is why `99j`'s snapshot is the one part of that file this design does
  not touch except to widen — pointed at the ledger as well as at
  `All_Registrants`.
