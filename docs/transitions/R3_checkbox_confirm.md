# R3 — Confirm only the ticks that matter (`99zb`)

Proposal #3 in `docs/RESTRUCTURING_PROPOSALS.md`.

## Current behavior

`confirmCheckboxEditOrRevert()` (`99zb`), called first thing in the simple
`onEdit` (`18`), asks **Tick this box? / Untick this box?** on **every**
single-cell click of a cell with check-box validation, on **every** tab.
YES keeps it, NO / ✕ puts it back (and no handler runs), CANCEL keeps it and
silences the question for 5 minutes for that user (`CHECKBOX_CONFIRM_SNOOZED_V1`
in the *user* cache).

The commonest click in the workbook — `Attended` / `Lunch_Served` on
`All_Registrants` — therefore costs a dialog, which trains people to press Yes
without reading.

## New behavior

The question is asked only for a column on an explicit allow-list,
`CHECKBOX_CONFIRM_COLUMNS` (`99zb`, a `defineLazyGlobal_` because it is built
from `PROGRAM_FLAG_COLUMNS`, `SESSION_FLAG_COLUMNS`, `NOTIFICATION_CHECKBOX_COLUMNS`
and `SHEET_NAMES`, all in other files). Each entry is `{ tab, column, ask, why }`:

- `ask` — `'both'`, `'tick'` or `'untick'`: which direction is consequential.
- `why` — one sentence, shown in the dialog and kept as the entry's reason.

The column is matched by **header name**, never by letter: the cells above the
edited one in the same column are read once and the nearest non-blank,
non-boolean cell is taken as the header (normalized through
`normalizeHeaderText`, so a `✍️` manual-entry prefix does not matter). This is
right in **both** sectioned zones (Upcoming / Past each have their own header
row) and on the memory tabs (header on row 2), and it costs one read only after
the cheap checks (tab on the list, single cell, boolean value, check-box
validation) have passed. A column not on the list is let through without a
question — exactly what happened before `99zb` existed.

The dialog itself, the NO-reverts behaviour and the 5-minute CANCEL snooze are
unchanged. The snooze now only ever silences these consequential ticks.

## The allow-list

| Tab | Column(s) | Ask | Why |
|---|---|---|---|
| `All_Program_Sessions` | `Club`, `No_Registration`, `Personalized_Assistance` (`PROGRAM_FLAG_COLUMNS`) | both | Writes a tag onto **every calendar event** of the program (installable trigger) and reshapes its forms on the next sync. |
| `All_Program_Sessions` | `Waitlist_Only` (`SESSION_FLAG_COLUMNS`) | both | Stamps `[Waitlist Only]` onto that date's calendar event and closes it to new Active registrations. |
| `Master_Program_Dashboard` | the three `PROGRAM_FLAG_COLUMNS` | both | Same flags, written through to every session row and the calendar (`handleProgramMonthFlagEdit`). |
| `Program_Settings` | `Add_Guest_To_Calendar`, `Week_Before`, `Day_Before`, `Morning_Of`, `Confirm_On_Booking` (`NOTIFICATION_CHECKBOX_COLUMNS`) | both | Ticking starts calendar invitations / emails to every registrant; Google emails a guest the moment they are added, so an invite cannot be taken back. |
| `Program_Leaders` | `Notify_Roster_Changes` | both | Ticking emails the leader and builds and **shares** a roster sheet with them. |
| `All_Registrants` | `Dropped` | both | The next sync turns a ticked upcoming row into a **cancellation** (`applyLeaderDropsAsCancellations`) — the seat is given away. |
| `All_Registrants` | `Waitlisted` | both | The next sync moves the person to the waitlist (`applyLeaderWaitlistTicks`); unticking only promotes back if a seat is still free. |
| `Club_Members` | `Active` | tick | Ticking books the person into every upcoming session of the club on the next sync (and so into invites / confirmations). Unticking already asks its own question in `cancelUpcomingClubRegistrations`, so it is not asked twice. |

### Considered and deliberately NOT on the list

| Tab | Column(s) | Why not |
|---|---|---|
| `All_Registrants` | `Attended`, `Lunch_Served` | Desk marks; undone by unticking. This is the click the change is for. |
| `All_Registrants` | `Contacted`, `Confirmed` | Leader notes; nothing reads them. |
| `Program_Questions` | `Required`, `Active` | Changes a form on the next sync, but unticking takes it back the same way; nothing is sent. Add it here if that proves wrong. |
| `Regular_Needs` | `Active`, `Auto_Note` | Internal desk notes. |
| `Config` | Admin Notification Emails ticks | Only routes office-internal mail; the daily digest goes to everybody on the table regardless. |
| Program registrant sheets | `Contacted` / `Confirmed` / `Waitlisted` / `Dropped` | Separate files; no `onEdit` runs there. |

Adding a column: one entry in `CHECKBOX_CONFIRM_COLUMNS` with its reason;
`tests/checkbox_confirm.test.js` checks that every entry names a real column of
its tab's `HEADERS` list.

## What an unconfirmed tick can now do, and how it is undone

Only the non-listed ticks go through unasked, and each is undone by clicking
it again:

- `Attended` / `Lunch_Served` — counted in Served_Confirmed and the catering
  reconcile; untick to undo. Appended to the ledger as a `corrected` entry
  either way (the untick is a second `corrected`).
- `Contacted` / `Confirmed` — notes only.
- `Program_Questions` `Active` / `Required` — the next sync adds or removes the
  question; untick before then and nothing happens.
- `Regular_Needs`, `Config` notification ticks — internal; untick to undo.

## Interaction with the installable trigger

`onProgramFlagEditInstallable` (`18`) drains the pending-flag queue the simple
`onEdit` writes. Because the simple trigger sits on the dialog until somebody
answers, `waitForFreshPendingFlag_()` polls (up to 45s) for the queue entry.
**Every column that writes a queue entry — the program flags and
`Waitlist_Only` on `All_Program_Sessions` — is still confirmed**, so the poll is
still needed and is left exactly as it is. For a non-flag column the installable
trigger never waits (`editTouchesProgramFlagColumn` is false), so nothing there
changes either.

## Snooze cache

Same key (`CHECKBOX_CONFIRM_SNOOZED_V1`), same user cache, same 5-minute TTL.
The stored shape is unchanged, so the key is not versioned up. A snooze set
before the deploy simply lapses.

## Rollback

Revert the commit. Nothing is stored that the old code would misread; the
snooze key and its shape are unchanged. To restore "ask on everything" without
a revert, `checkboxConfirmEntryFor_()` can be made to return a generic entry.

## Manual test checklist (test workbook)

1. `All_Registrants`, Upcoming zone: tick `Attended` — **no dialog**; it stays ticked. Untick — no dialog.
2. Same in the **Past** zone.
3. `All_Registrants`: tick `Dropped` on an upcoming row — dialog appears naming the cancellation; NO puts it back.
4. `All_Program_Sessions`: tick `Club` on a row — dialog; YES; the calendar event gets `[Club]` (installable trigger installed). Repeat in the Past zone header region to confirm matching by header.
5. `All_Program_Sessions`: tick `Waitlist_Only` — dialog; YES; within ~a minute the event description carries `[Waitlist Only]` and Status reads waitlist-only (proves `waitForFreshPendingFlag_` still works while the dialog is up).
6. `Master_Program_Dashboard`: tick `No_Registration` — dialog; NO reverts and nothing is queued.
7. `Program_Settings`: tick `Day_Before` — dialog. `Program_Leaders`: tick `Notify_Roster_Changes` — dialog.
8. `Club_Members`: tick `Active` — dialog. Untick — only the existing "cancel upcoming bookings?" question, not two.
9. Press CANCEL on any listed tick, then tick another listed box within 5 minutes — no dialog.
10. Paste / fill-down over several `Club` boxes — no 99zb dialog (unchanged).
11. Move a column (e.g. drag `Dropped` elsewhere) and re-check 3 — still asked (header match, not letter).
