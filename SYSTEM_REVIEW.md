# System Review

A pass over the whole system looking for things that will bite — soon, or
eventually. Written after the changes in this branch, so items marked
**FIXED** were addressed here and are listed because they explain behaviour
you may have already been seeing.

Ordered by how much it would hurt, not by how likely it is.

---

## Short term — things that can bite this month

### 1. `onEdit` runs without authorization. **FIXED (mitigated)**

The single most consequential thing in this codebase, and it was invisible.

`onEdit` is a *simple* trigger. Google runs simple triggers **without asking
the user for authorization**, which means they cannot use `CalendarApp`,
`FormApp`, `PropertiesService`, or the range-protection API. They *can* show
alerts, which is why the "are you sure?" dialogs work.

Three things on the edit path needed exactly those forbidden services:

| Edit | Called | Result |
|---|---|---|
| Type a menu into `Lunch_Schedule` | `FormApp.openById`, `PropertiesService` | throws, swallowed by `onEdit`'s catch — **the forms silently never updated** |
| Change `Type_Tag` on the dashboard | `CalendarApp.getCalendarById` | throws — the tag stayed on the sheet and the **next sync put the old value back** |
| Anything that re-renders a tab | `Range.protect()` | threw *after* `sheet.clear()` — a half-cleared tab |

If "I set the menu and the form still shows the old meal" or "I changed
Grouped to Monthly and it changed itself back" sound familiar, this is why.

**What was done.** Form pushes moved off the edit path onto
**🍱 Push Menu Changes to Forms** (menu items run fully authorized).
`🔁 Apply Type Changes to Calendar` added as the recovery for a `Type_Tag`
change the edit couldn't deliver. `getCalendarEventsForWindow()` and
`protectDerivedColumns()` now degrade instead of throwing. `onEdit`'s catch
now **toasts** the failure instead of only logging it.

**The rule going forward, and it is worth defending:** *if it needs a Google
service other than `SpreadsheetApp`, it does not belong on the `onEdit`
path.* An installable `onEdit` would grant the authorization but remove
`getUi()` entirely, silently auto-answering every confirmation dialog — a
worse trade for this workbook.

### 2. `syncRegistrations` had no lock. **FIXED**

`syncCalendars` takes a script lock; `syncRegistrations` did not. It reads
every registrant row, adds to them in memory, and writes the whole tab back —
so two overlapping runs (the hourly trigger and someone pressing the menu item
because they're waiting for a registration to show up, which is precisely when
people press it) both read the same "before" picture, and the last one to
finish overwrites the other's new rows.

Those rows do not come back on the next run: `getResponses()` is bounded by
`LAST_FORM_SYNC_TIME`, which the losing run already advanced. Silent, permanent
data loss, most likely exactly when someone is watching.

Now takes the same lock and skips with a toast.

### 3. A walk-in row blocks that person's real registration

`getProtectedRegistrantKeys()` protects any row marked `Manually Added` or
`Manually Edited`, and `buildRegistrantRow()` returns `null` for a protected
key. That is correct — it's what stops a sync from wiping your corrections.

But the key is `Event_ID | name | Person_Type`. So if someone is added as a
walk-in at the desk and *then* registers online for that same session, the
online submission is **never imported**: no row, no `Party_ID`, no admin
notes, no dietary information they typed in.

Not changed here, because the alternative (letting a sync overwrite a
hand-marked row) is worse. But it is a real gap, and the new Quick Mark
walk-in path makes it easier to reach. **Watch for:** a registrant who "filled
in the form" but has no `Form_Source` link on their row. The fix if it starts
happening: on a protected row, merge the incoming `Admin_Notes`/`Party_ID`
rather than discarding the response wholesale.

### 4. Two people with the same name are one person

`normalizeNameKey()` is `trim().toLowerCase()`. Everything downstream —
Member_Roll, Quick Mark, duplicate detection, supersede logic — treats
"Mary Smith" and "mary smith" as the same human, which is right, and also
treats *two different Mary Smiths* as the same human, which is not.

At a senior center this is a matter of time rather than chance. Symptoms:
`Times_Seen` roughly double what it should be, one person's dietary note
attached to another's row, Quick Mark marking the wrong Mary. There is no
clean automatic fix — identity needs something the forms don't currently
collect. The cheap mitigation is to start collecting one (a phone number or
birth year on the form, folded into the key). Worth doing **before** it
happens, because untangling merged history afterwards is manual.

### 5. Triggers are private to the account that made them

Already documented in the code and guide, and the admin-email restriction is
the right fix at the cause. Restating because it is the failure mode most
likely to recur if someone new starts running setup functions from their own
login: `ScriptApp.getProjectTriggers()` only ever returns triggers **the
current account created**, so two admins each pressing "Check Triggers" build
two mutually invisible sets that both fire forever, and neither can remove the
other's. The Apps Script editor's Triggers page is the only place they are all
visible.

---

## Medium term — the next few months

### 6. The hourly sync has no time budget

`bootstrapCalendars()` is carefully sliced against the 6-minute execution
limit. `syncRegistrations()` is not, and it does an unbounded amount of work:
one `FormApp.openById` per form with new responses, plus
`migrateFormsToCurrentTemplate()`, plus
`refreshFormCapacityLabelsForAllForms()` across every capped form, plus four
full tab renders.

The label-fingerprinting cache keeps the common case cheap, so this is fine
today. It stops being fine when the number of live forms grows — and the
failure mode is bad: a timeout mid-run means the tab renders never happen, the
lock releases, and `LAST_FORM_SYNC_TIME` is never advanced, so the next run
redoes the same too-large job and times out identically. **A stuck sync that
looks like a dead sync.**

**Fix when it's needed:** the same deadline pattern the bootstrap already uses
— check elapsed time between forms, stop cleanly, and advance the sync time
only to the last response actually processed.

### 7. Renders rewrite everything, every time

Every render is `sheet.clear()` then a full rewrite of every row. It is what
makes the layout code simple and the tabs self-healing, and it was the right
call. It also means render cost is proportional to **all history**, not to
what changed — and it runs hourly.

Hiding old months (added here) fixes the human problem, not this one. See
**Old months** in `USER_GUIDE.md` for the archive options and
**🔧 Admin ▸ Archive Old Months (report)** for the measurement. The number to
watch is total cells across the history tabs; ~150,000 is where a full render
starts eating a meaningful share of the execution budget.

### 8. Quick Mark now reads three tabs per keystroke

Widening the dropdowns to all programs and all members means
`refreshQuickMarkDropdowns()` reads `Master_Program_Dashboard`,
`Program_Options` and `Member_Roll` on every panel edit. Correct, and a few
hundred milliseconds today.

That latency lands at a sign-in desk with a queue in front of it, and it grows
with history. If it becomes noticeable: cache the derived lists on a hidden
tab and rebuild them at the end of each sync, rather than deriving them live.

### 9. `FORMS_FOLDER_ID` is empty

`getOrCreateFormsFolder()` falls back to find-or-create **by name**. If a
second folder called "Program Registration Forms" ever exists in the Drive —
a copy, a shared duplicate, someone tidying up — new forms start landing in
whichever one Drive returns first, and they scatter across both.

One-line fix: create the folder once, paste its ID into `FORMS_FOLDER_ID`.
Worth doing now; it costs nothing and removes the ambiguity permanently.

### 10. Renders from an edit aren't locked

`harvestPastedMenuRows()` and the Quick Mark walk-in both re-render a whole
tab from `onEdit`, which can collide with a scheduled sync rendering the same
tab. Narrow window, low stakes (worst case a render is redone), but it is the
same class of bug as #2 and will be worth a lock if either path grows.

---

## Long term — architectural, worth knowing before deciding anything big

### 11. The spreadsheet is the database

Every row on every tab is both storage and UI. That is genuinely the right
choice here — the staff live in the sheet, and nothing else would have been
adopted. The costs to keep in view:

- **No transactions.** A render that fails halfway leaves a partly-written
  tab. The code defends the important ones (`triageDeletedSessions` refuses
  large sweeps; the bootstrap restores automation on error), but the property
  isn't available in general.
- **No schema.** `HEADERS` is the schema, `buildHeaderProjection()` is the
  migration, and both work well — but the guarantee is by convention, held up
  by careful code rather than by the store.
- **The 10-million-cell limit is per file**, shared by every tab including any
  in-workbook archive.

None of this argues for a database. It argues for the archive decision in #7
being made deliberately rather than discovered.

### 12. The calendar is the source of truth, and it's editable by anyone

Program identity is the event title; capacity and grouping are bracket tags in
the description. Anyone with calendar access can rename an event and, from the
system's point of view, delete one program and create another — dashboard row
gone, registrants to triage, new form. `triageDeletedSessions()`'s refusal to
sweep more than 15 sessions or 25% of the table is what stands between a bulk
calendar rename and a wiped dashboard, and it is doing more work than its size
suggests. Leave those limits alone.

### 13. Admin gating is convenience, not access control

`AUTHORIZED_ADMIN_EMAILS` is a constant in a file that anyone with edit access
to the spreadsheet can open and change. The new two-tier menu hides
destructive items; the `requireAuthorizedAdmin()` checks refuse them however
they are started. Both are real improvements to the chance of an accident.
Neither is a boundary against someone who means it — that comes only from who
the spreadsheet is shared with.

### 14. Single-file, 8,000 lines

`Code.gs` is well-organized and unusually well-commented; the comments explain
*why*, which is what makes this maintainable at all. But it is one file with
~270 functions and no tests, and the only way to verify a change is to run it
against the live workbook.

If it keeps growing, the highest-value split is by seam rather than by size:
pull the pure functions (parsing, date/CSV handling, row building, label
formatting — everything that takes values and returns values) into their own
file. That subset is testable off-platform, and it is where the subtle bugs
live.

---

## Verify first, in the live workbook

Start with **🔧 Admin ▸ 🧱 Rebuild Layout (no calendar sync)** — that is what
draws the new layout onto an existing workbook, and it reads nothing outside
the spreadsheet, so it is also the safest thing to try first. Then, in rough
order of what would change your plans:

1. **Paste a few CSV rows** into the ADD block on `Lunch_Schedule`. Confirm
   they move up into the table and the block empties. Then paste one bad row
   and confirm it stays put with a reason.
2. **Press 🍱 Push Menu Changes to Forms** and check a live form actually
   shows the new meal text. This is the path that was silently failing.
3. **Change one `Type_Tag`**, say yes, then reload — does it hold? If it
   reverts, press **🔁 Apply Type Changes to Calendar** and confirm it sticks
   after that.
4. **Open the workbook as a non-admin account** and confirm the 🔧 Admin
   submenu is absent. Then as an admin, confirm it's present — and if it
   isn't, that **🔧 Admin Tools (sign-in check)…** brings it back.
5. **Quick Mark a walk-in**: pick a program nobody has registered for, type a
   new name, tick Attended, confirm the row appears flagged `Manually Added`.
6. **Check the Past sections** show the hidden-row note, and that
   **🕓 Show All Past Rows** brings them back.
