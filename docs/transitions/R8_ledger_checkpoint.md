# R8 — Ledger checkpoints (`99zq_ledger_checkpoint.gs`)

Item #8 of `docs/RESTRUCTURING_PROPOSALS.md`. Written before the code, and kept
as the record of what the code promises.

## The problem

`ledgerFoldNow()` (`99k`) calls `readLedgerEntries()`, which is one
`getDataRange().getValues()` of the whole `Registration_Ledger` tab, then folds
every entry from the first. The tab only grows, so every desk mark, every sync
and every backfill slice that asks "which registration is this row?" pays for
the whole history.

## The rule nothing here may break

**The ledger is the only second copy of every registration. The checkpoint
never writes, edits, moves or removes a ledger row.** It is a *derived cache*:
deleting the `Ledger_Checkpoint` tab, or its Script Property, puts every reader
back on the full fold with no other effect. Nothing is ever folded FROM the
checkpoint into the ledger.

## Shape

### The tab: `Ledger_Checkpoint` (`SHEET_NAMES.LEDGER_CHECKPOINT`)

Header `['Generation', 'Kind', 'Registration_ID', 'State']`, one row per:

| Kind | Registration_ID | State (JSON, plain-text cell) |
|---|---|---|
| `state` | the id | `{ "o": order, "d": dead, "b": deadBy, "r": [row cells] }` |
| `problem` | the entry's id | `{ entryId, kind, registrationId, reason }` from the fold |

- **Dead registrations are included** (`removed`, `superseded`, absorbed by
  `merged`). `ledgerRegistrationIdsByKey()` (`99k`) and the backfill (`99o`)
  read dead states, and a later entry against a dead id must still be reported
  as a problem rather than "no registration with this id".
- `r` is the registrant row in the header order recorded in the meta
  (`HEADERS.All_Registrants` at build time), so a column added later is mapped
  by NAME when the checkpoint is loaded and reads back blank, exactly as the
  full fold would leave it.
- Dates (none are written by the fold today, but the encoder does not assume
  that) are tagged `{"$d": ms}`; everything else in a folded row is a JSON
  primitive, because every value the fold writes comes from a JSON Payload, a
  stamper's string, or `false`/`''`.
- The State column is formatted `@` (plain text) so Sheets cannot reinterpret a
  value on the way in. JSON always starts `{`, so it can never be a formula.
- The fold's `problems` for the covered prefix are stored so checkpoint + tail
  reports exactly the problems a full fold would.

### The meta: Script Property `LEDGER_CHECKPOINT_META_V1`

```
{ generation, builtAt, coveredThroughRow, coveredEntries, lastEntryId,
  maxEntryAtMs, stateRows, problemRows, headers: [...] }
```

- `coveredThroughRow` — the last ledger SHEET row the checkpoint folded.
- `lastEntryId` — the Entry_ID on that row: the **anchor**.
- `maxEntryAtMs` — the latest `Entry_At` among covered entries.

### The gate: Script Property `LEDGER_CHECKPOINT_GATE_V1`

```
{ cleanDays: [ 'yyyy-MM-dd', ... ], lastMismatch, lastMismatchAt, disabled }
```

## Why checkpoint + tail is equal to a full fold

`foldRegistrationLedger()` sorts by `(Entry_At, sheet order)` and applies the
entries one at a time to a state map `{ states, order, problems }`. It is
refactored (same signature, same output) into `newLedgerFoldContext_()`,
`foldLedgerEntriesInto_(ctx, entries)` and `finishLedgerFold_(ctx)`. The
checkpoint is a serialized context; the fast fold is
`finish(foldInto(load(checkpoint), sorted tail))`.

That equals `finish(foldInto(new, sort(covered ++ tail)))` exactly when
`sort(covered ++ tail) == sort(covered) ++ sort(tail)`, i.e. when **every tail
entry's `Entry_At` is ≥ `maxEntryAtMs`** (a tie sorts by sheet order, and the
tail is later in the sheet) and **every entry is dated** (the comparator treats
an undated entry by position only, which is not a total order, so no promise
can be made about where it lands). So:

- a checkpoint is **not built** while any covered entry is undated;
- the fast fold **falls back to a full fold** when any tail entry is undated or
  earlier than `maxEntryAtMs`.

The second case is real: an entry's `Entry_At` is stamped when it is COMPOSED
and it reaches the tab when its execution FLUSHES (`__ledgerBuffer`), and the
`onEdit` appender (`18`) takes no lock. An entry composed before the checkpoint
read and flushed after it is exactly a tail entry dated before the covered max.
The fallback costs one full read until the next nightly checkpoint covers it.

**The one column that is not deterministic, even between two full folds:**
`Admin_Notes`. 71's stampers write "Cancelled … on <today>" with the date the
FOLD runs, not the date of the entry. A checkpoint built on the 8th freezes
"on Oct 8" where a full fold on the 9th says "on Oct 9". That is pre-existing
(the full fold already disagrees with itself across midnight), it is already
outside `99n`'s compared columns, and the validation below compares every
column EXCEPT `Admin_Notes` for that reason. Tests compare it too, because they
fold both sides in the same instant.

## Invalidation — when the covered prefix is no longer what was folded

The fast fold reads ONE range: `getRange(coveredThroughRow, 1, lastRow −
coveredThroughRow + 1, width)` — the anchor row plus the tail. It refuses
(full fold) unless:

1. the meta and the tab agree: every tab row carries the meta's `generation`
   and the counts match `stateRows` / `problemRows`;
2. `getLastRow() ≥ coveredThroughRow`;
3. the Entry_ID on `coveredThroughRow` is `lastEntryId` (the anchor);
4. the tail passes the ordering check above.

What moves the prefix, and what catches it:

| Change | Caught by |
|---|---|
| `99za` compaction rewrites and deletes rows | it calls `invalidateLedgerCheckpoint()` explicitly; and any removed row at or before the anchor shifts the anchor row (3) |
| rows deleted/inserted by hand above the anchor | anchor shifts (3) |
| a covered cell edited by hand | `onEdit` (`18`) on the ledger tab at a row ≤ `coveredThroughRow` invalidates; the daily comparison below also catches it |
| ledger tab deleted / recreated | anchor (2, 3) |
| checkpoint tab deleted, renamed or edited | generation/count check (1) — full fold |
| checkpoint write killed half way | (1): the tab is written in full FIRST, the meta (new generation) LAST. A kill between leaves rows whose generation the meta does not name → full fold. Never a half checkpoint. |
| a flush pending in the buffer | not yet on the tab, so not covered and not tail. `flushLedger()` already drops the memo; the next fold reads it as tail. |
| `__ledgerWrittenIds` | unaffected: it only stops this execution writing an entry twice. The checkpoint reads the tab. |

Invalidation is a property write that blanks the meta; the stale tab rows are
left (harmless, generation-mismatched) until the next build overwrites them.

## The gate: validate first, rely later

The fast path is used by `ledgerFoldNow()` ONLY when the gate is open:
`cleanDays.length ≥ LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED` (30) and not
`disabled`. Until then every reader does exactly what it did before.

Every comparison (`validateLedgerCheckpoint()`) reads the ledger ONCE with row
numbers, folds it fully, folds checkpoint + (the same read's rows after
`coveredThroughRow`) and compares every registration — alive/dead, deadBy, and
every cell but `Admin_Notes` — plus the order the live rows come out in and
the problems, by entry and reason.

- **Clean** → today's date is added to `cleanDays` (distinct days).
- **Different** → `cleanDays` is emptied, the difference is logged and filed for
  the office digest, and the checkpoint is invalidated (the nightly build makes
  a fresh one). The fast path is closed again until 30 more clean days.
- **Not comparable** (no checkpoint, fallback condition) → nothing recorded.

It runs from the nightly build (before it replaces the checkpoint) and from
`99n`'s verifier, whose report and digest carry the result.

`setLedgerCheckpointFastPath(false)` (Apps Script editor) sets `disabled`;
`true` clears it. Deleting `LEDGER_CHECKPOINT_GATE_V1` restarts the count.

## Nightly build

Appended to `snapshotRegistrantsDaily()` (`99j`, the 3am trigger) — no new
trigger. Guarded whole: a checkpoint that cannot be built must never cost the
snapshot. Under `workbookLock()` with a short wait (a 3am run that finds a sync
holding the workbook skips a night — that only means a longer tail tomorrow):
`flushLedger()`, one full read, validate the old checkpoint, fold, write the
tab (`99u`'s rule: one `setValues()` over max(old, new) rows, padded with
blanks, never `clear()`), then the meta.

The lock does not stop the `onEdit` appender or a writer outside the lock; it
does not need to. Whatever they append lands below `coveredThroughRow` and is
tail, and the ordering check covers an entry dated before the read.

## Sheet size

One row and four cells per registration ever seen. 20 000 registrations is
80 000 cells of a 10 000 000-cell workbook. Each State cell is a JSON array of
~40 mostly-empty cells — a few hundred characters, far under 50 000. A build
that would put a cell over `LEDGER_CHECKPOINT_MAX_CELL_CHARS` refuses and logs.

## Rollback

Delete the `Ledger_Checkpoint` tab, or the `LEDGER_CHECKPOINT_META_V1`
property, or call `setLedgerCheckpointFastPath(false)`. Any of the three puts
every reader on the full fold. Removing the code means deleting
`99zq_ledger_checkpoint.gs` and its two direct callers (the `onEdit` branch in
`18`, the `invalidateLedgerCheckpoint` line in `99za`); `99k`, `99j` and `99n`
reach it only through `typeof` guards.

## Manual test checklist

1. Run `buildLedgerCheckpointNow()` from the editor. The `Ledger_Checkpoint`
   tab has one row per registration ever recorded; the log names the covered
   row and counts.
2. 🔧 Admin ▸ 📄 Reports ▸ Ledger Verification: the report has a
   "Checkpoint" line saying it agrees with the full fold and how many clean
   days are counted.
3. Quick Mark a registration; run the report again — still agrees (the mark is
   in the tail).
4. Hand-edit a covered ledger cell → the meta is blanked (the report says
   "no checkpoint"). Undo, and rebuild.
5. Run Compact the Registration Ledger → the meta is blanked.
6. Delete the `Ledger_Checkpoint` tab → the report says no checkpoint; the next
   3am run (or step 1) recreates it.
7. With `setLedgerCheckpointFastPath(true)` and the gate forced open (set
   `cleanDays` to 30 dates in the property by hand on a TEST copy only),
   `ledgerFoldNow()` logs that it used the checkpoint, and Quick Mark still
   finds every person.
