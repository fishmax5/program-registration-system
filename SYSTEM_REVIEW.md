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

### 5. Changing `CALENDAR_MAP` re-keys every session

The calendar IDs in `CALENDAR_MAP` were repointed in this branch. Worth knowing
what that does, because none of it is loud:

`computeEventId()` hashes **`calendarId | title | date`**. The calendar ID is
part of the key, so the *same program on the same day* under a new calendar ID
is a **different session** as far as this system is concerned.

> The **title** half of that same key is now handled — a program renamed on the
> calendar is detected and its rows are moved onto the new name rather than
> triaged (see "Renaming a program" in `USER_GUIDE.md`). Nothing equivalent
> exists for a changed calendar ID, and the evidence a rename relies on (one
> form, one old title, the old title gone from the calendar) has no analogue
> here: a repointed calendar changes every program at once.

| | What happens |
|---|---|
| Old session rows | Kept. `triageDeletedSessions()` only considers rows whose `Calendar_Source` is a calendar it could read, and the old IDs aren't in `CALENDAR_MAP` any more — so they're skipped, not deleted. **Nothing is lost.** |
| New sync | Imports the new calendars' events as **new** rows with new `Event_ID`s |
| If both calendars hold the same programs | You get **two rows per session** — one stale, one live — and **two forms** |
| Existing registrants | Still joined to the **old** `Event_ID`s, so they attach to the stale rows, not the new ones |
| Sync tokens | The old `CALENDAR_SYNC_TOKEN_*` script properties are orphaned. Harmless. |
| Calendar-edit triggers | Still watching the old calendars until **Check Triggers** is run |
| Config | Unaffected — buffers and catering policy are keyed on the location *name*, which didn't change |

**If these are brand-new, empty calendars:** nothing to do beyond **Check
Triggers**, then a sync.

**If they're the same programs under new IDs** (a recreated or migrated
calendar), decide before syncing. The clean options are to start the workbook's
session history fresh, or to rewrite `Calendar_Source` and `Event_ID` on the
existing rows to match the new IDs. Do **not** just sync and sort it out
afterwards — once duplicate forms exist, registrations start arriving on both.

### 5b. Re-grouping only reaches dates that haven't been imported yet

Both grouping tags — `[Grouped]`/`[Monthly]` and the new `[All Locations]` —
are read when a session is **imported**. `collectCalendarWork()` skips any
group whose dates are all already on the session table, so re-tagging a
program in the calendar changes **future** dates and leaves the ones already
imported on the form they were built with. On a live calendar that reads as
"I changed it and nothing happened."

`🔗 Link Program Across Locations…` is the only path that closes this gap, and
it closes it only for linking: it stamps the tag, moves the **upcoming**
sessions onto one form (`repointProgramSessionsToOneForm()`), re-labels that
form, and rewrites the calendar links. Past sessions are deliberately left on
the form their registrations arrived on.

Nothing equivalent exists for `Grouped` ⇄ `Monthly`, which has always had this
behaviour — the toast still says "run Sync Cal to rebuild their forms", and a
sync will only do that for dates that aren't on the table yet. Worth either
generalising the re-point step to any tag change, or making the toast honest.

Unlinking is also asymmetric on purpose: sessions already on a shared form stay
there, because splitting a live roster back across two forms has no safe
answer to "which form does an existing registrant belong to?"

### 6. Event descriptions accumulated duplicate links. **FIXED**

`backInjectCalendarDescriptions()` found the **first** registration link in a
description and replaced it in place. Anything after that — a second copy left
by Google Calendar flattening the HTML on a UI edit, a line in an older format,
a link that came along with a copy-pasted event — was invisible to it, and
stayed there permanently. Every sync corrected the first one and walked past
the rest.

Now: strip **every** link (all formats, all copies), write back exactly one, at
the top. `stripAllRegistrationLines()` is deliberately narrow about what counts
as a link, so `[Cap: N]`, `[Grouped]`, room notes and other hyperlinks survive
untouched; `tidyDescriptionWhitespace()` closes the gap in both the newline and
`<br>` flavours of description without eating deliberate paragraph breaks.

**🔧 Admin ▸ 🔗 Rewrite Event Links** applies it to everything already out
there, and Config gained a **Registration Link in Events** show/hide setting
that both paths honour.

**The one over-reach to know about:** any `docs.google.com/forms` link in a
program event description is treated as ours and removed. On these calendars
that is always true, and catching mangled duplicates requires it — but a
hand-added link to some *other* Google Form would go with it. The confirmation
dialog says so.

### 7. Triggers are private to the account that made them

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

### 8. The hourly sync has no time budget

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

### 9. Renders rewrite everything, every time

Every render is `sheet.clear()` then a full rewrite of every row. It is what
makes the layout code simple and the tabs self-healing, and it was the right
call. It also means render cost is proportional to **all history**, not to
what changed — and it runs hourly.

Hiding old months (added here) fixes the human problem, not this one. See
**Old months** in `USER_GUIDE.md` for the archive options and
**🔧 Admin ▸ Archive Old Months (report)** for the measurement. The number to
watch is total cells across the history tabs; ~150,000 is where a full render
starts eating a meaningful share of the execution budget.

### 10. Quick Mark reads three tabs to build its lists. **REDUCED**

Widening the lists to all programs and all members means
`collectKnownProgramChoices()` reads `Master_Program_Dashboard`,
`Program_Options`, `Lunch_Schedule` and the registrant rows, and
`collectKnownMembers()` reads `Member_Roll`.

This used to happen **on every panel keystroke**, because Quick Mark was a band
of cells and each edit re-cascaded the dropdowns through `onEdit`. It is now a
dialog: the lists are fetched once when you pick a location and once when you
pick a session, and marking twenty people in a row re-fetches nothing. The
latency that mattered — at a sign-in desk with a queue in front of it — is
gone.

Still worth watching as history grows, and the fix is unchanged if it ever
becomes noticeable: cache the derived lists on a hidden tab and rebuild them at
the end of each sync, rather than deriving them live.

### 11. `FORMS_FOLDER_ID` is empty

`getOrCreateFormsFolder()` falls back to find-or-create **by name**. If a
second folder called "Program Registration Forms" ever exists in the Drive —
a copy, a shared duplicate, someone tidying up — new forms start landing in
whichever one Drive returns first, and they scatter across both.

One-line fix: create the folder once, paste its ID into `FORMS_FOLDER_ID`.
Worth doing now; it costs nothing and removes the ambiguity permanently.

### 12. Renders from an edit aren't locked

`harvestPastedMenuRows()` re-renders a whole tab from `onEdit`, which can
collide with a scheduled sync rendering the same tab. Narrow window, low stakes
(worst case a render is redone), but it is the same class of bug as #2 and will
be worth a lock if that path grows.

The Quick Mark walk-in used to be the other half of this. It still re-renders
the registrants tab, but from a dialog rather than from `onEdit` — so it is no
longer reachable from a stray paste, and it runs with full authorization.

---

### 12b. A club roster is a standing instruction, and standing instructions rot

Clubs (`[Club]`, `Club_Members`) are the first thing in this system that keeps
acting on somebody's behalf **indefinitely**, with no further input from them.
Everything else expires: a form covers a month, a registration covers a session.
A membership covers every meeting there will ever be.

That is the feature, and it is also the risk. Concretely:

- A member who stops coming keeps being booked, and keeps being counted in the
  catering number, until a human notices and unticks **Active**. Nothing in the
  system can tell "hasn't come since March" from "coming next week" — the rows
  look identical.
- Because club bookings are created by the sync rather than by a person, they
  carry no `Manually Added` protection. That is deliberate (they must be able
  to change when the schedule does), but it means the usual "hand-edited rows
  are sacred" instinct does not apply here.

**Worth adding when it starts to hurt:** a staleness report — club members with
no `Attended` tick in N sessions — in the admin digest. Not a rule that removes
them automatically. Deciding somebody has left a club is a judgement about a
person, and the system should raise it, not make it.

**Related and smaller:** `applyClubRosterCatchup()` only ever fills gaps, and
never touches a session a person already has a row for. That is what makes
individual dates manageable (cancel one meeting without leaving the club), but
it also means a booking you delete outright comes back on the next sync.
Cancel it rather than deleting it.

### 12d. Form items are addressed by title and by index, and both bite

Two failures in the first live run of the v4 template, both from the same
underlying fact: the Forms API gives you items keyed by **title** (which is not
unique) and holding a **cached index** (which goes stale the moment you delete
anything).

**Title.** `TEMPLATE_PAGE_TITLES.MODE` was set to the same string as
`TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE` — the page and the question on it
naturally want the same words. Every lookup of that title returned the PAGE
BREAK first, because it is added to the form first, and `asListItem()` on it
threw *"Invalid conversion for item type: PAGE_BREAK"*. Fixed by renaming, by
type-guarding the lookup, and by a test asserting no page title equals any item
title — within-set uniqueness, which was already asserted, does not catch it.

**Index.** Deleting a filtered list of items forward — `getItems().filter(…).
forEach(deleteItem)` — invalidates every later item's index by one. Usually it
silently deletes the wrong item; when the last item on the form is among the
doomed it throws *"Cannot access item at index: N. Number of items: N"*, which
is what a v3 form carrying two "Footer Note" headers did. Fixed by
`deleteFormItems()`, which sorts highest-index-first; both delete sites now go
through it.

**The standing rule:** never address form items by a title that anything else
can share, and never delete them in ascending order. Both are the kind of bug
that works on a form you tested and fails on the fifth one in production.

**And a third, non-bug:** *"Failed to edit the form. Please wait and try
again."* is Forms rate-limiting a rebuild's ~35 writes to one document,
repeated per form. `withFormRetry()` backs off and retries only on that class
of message — a real defect is re-thrown immediately, since repeating it just
burns the execution budget — and there is a 1.5s pause between forms so it is
provoked less often. If rebuilds still fail in batches, lower
`MAX_FORM_REBUILDS_PER_RUN` before doing anything cleverer.

### 12c. Calendar invitations reach outside the workbook

`inviteRegistrantsToCalendarEvents()` is the only thing here that emails people
who are not staff. It is guarded three ways — a Config switch, upcoming-only,
and a ledger so nothing is sent twice — but the failure modes are worth naming:

- **The ledger is Script Properties, not the calendar.** If it is cleared (or a
  workbook is rebuilt from scratch), the next run re-adds every guest, and
  Google notifies each of them again. Guest lists are read per event, so nothing
  is *wrong* afterwards; it is a wave of duplicate invitations, which for a
  membership of a few hundred is not nothing.
- **Matching is by day + title.** A session whose calendar event has been
  renamed is not found, and its registrants are quietly not invited (logged, not
  raised). Storing the real calendar event ID would fix this properly and is the
  obvious next step if it ever matters.
- **Removal depends on a status.** Somebody deleted outright from the
  Registrants tab, rather than marked `Cancelled`, is never removed from the
  guest list — there is no row left to notice.

### 12e. Two checkboxes that write to the calendar, and one that closes a form

`Club` and `No_Registration` on the program dashboard are ticks that reach
outside the workbook: each one writes its tag into the description of **every**
calendar event of that program (`stampProgramFlagOnCalendar()`), and
`[No Registration]` additionally strips the registration link off those events
and calls `setAcceptingResponses(false)` on the program's form. Worth naming:

- **A tick cannot be written by the trigger that sees it.** The simple `onEdit`
  has no authorization for CalendarApp (see #1), and the first version of this
  feature tried to write from there anyway: the tick failed silently, and then
  any calendar activity at all — `onCalendarChange` fires a full
  `syncCalendars()` — recomputed the column from a description that had never
  heard of the tick and unticked the box, destroying the only record that
  anybody had asked for anything. **FIXED**, in two parts: every tick is queued
  on a hidden `_Pending_Tag_Changes` tab (a plain spreadsheet write, which a
  simple trigger *can* do) and is exempt from reconciliation until a calendar
  accepts it; and an INSTALLABLE `onEdit` trigger
  (`onProgramFlagEditInstallable`, installed by Check Triggers) does the
  authorized write seconds later. Remaining risk: a workbook whose owner has
  never run Check Triggers has no such trigger, so ticks wait for the next sync.
  Trigger Status names it when it is missing.
- **Writing a calendar is itself a calendar event.** Ticking a box tags every
  event of the program, and each of those tags is a change the
  `onCalendarChange` triggers would deliver back as news — one tick becoming a
  run of full syncs reacting to their own predecessor's edits. **FIXED**: every
  path that writes descriptions now runs inside
  `withCalendarChangeTriggersPaused()` (triggers down, work, sync tokens
  advanced past our own edits, triggers restored), which also carries the
  restore-only rule that keeps a non-owner from minting a second, invisible
  trigger set. The rule this leaves standing: triggers held by ANOTHER account
  cannot be seen or paused from here, so on a workbook where two accounts have
  set up triggers, the other account's copies still fire on every edit this
  makes. Trigger Status is where that shows up.
- **The queue is a tab, and tabs can be edited.** `_Pending_Tag_Changes` is
  hidden, not protected. A row deleted from it by hand is an instruction
  dropped — the box stays ticked and the calendar never learns. It is also the
  first place to look when a tick has not landed: rows there are, by
  definition, changes that no calendar has accepted.
- **Closing a form is remembered in Script Properties**
  (`NO_REGISTRATION_CLOSED_FORMS_V1`), and only forms recorded there are ever
  re-opened. If that property is cleared, a form closed by this feature stays
  closed after the tag comes off, and nothing says why. The symptom is
  "registration is on again but the form still refuses responses"; the fix is
  one click in the Forms editor.
- **The menu action deliberately does NOT read the checkboxes.** It pushes the
  QUEUE plus `Type_Tag`. Stamping whatever the boxes currently show would mean
  an unticked box — indistinguishable from one nobody has ever touched — could
  march through the calendar deleting hand-typed `[Club]` tags on a workbook
  whose dashboard had gone stale for any reason. Only what a person actually
  did is replayed.
- **`[Drop-In]` reads as no-registration.** That is intended — it is what staff
  would type — but it is the loosest of the tag spellings, and a description
  that says "drop-in welcome" *inside brackets* will turn a program's form off.
  Prose outside brackets is safe.

### 12f. Deleting registrations is the one destructive path

`deleteRegistrationsForSessions()` is the only action in this system that
removes registrant rows rather than marking them `Cancelled`, and with its
optional tick it deletes Google Form responses too. It is gated by an admin
check, a typed `DELETE`, and the script lock (a sync reading the tab either side
of the deletion would otherwise write every row straight back). What remains:

- **A deleted response can cover sessions that were not selected** — one
  submission can span six dates of a grouped form. Those other rows survive as
  the record, but the response behind them is gone, and a full re-import would
  no longer recreate them.
- **~~Deleted rows come straight back.~~ FIXED.** Three separate paths used to
  undo a deletion on the next sync — the all-dates registry re-booking its
  people onto every date, `applyClubRosterCatchup()` re-booking every active
  club member, and the surviving form response being re-imported whenever
  anything moved `LAST_FORM_SYNC_TIME` backwards. Deleting now records a
  tombstone per person per session, and `buildRegistrantRow()` — the single
  funnel all three build rows through — refuses a tombstoned key. What remains
  to know: a tombstone is lifted by a genuinely new submission (a different
  `Party_ID`), by a walk-in, and by a triage restore, all deliberately; and
  deleting a club member's booking still does **not** take them off the club,
  so they are booked into every *other* upcoming meeting. The real off switch
  is still **Active** on `Club_Members` (see #12b).

## Long term — architectural, worth knowing before deciding anything big

### 13. The spreadsheet is the database

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

None of this argues for a database. It argues for the archive decision in #9
being made deliberately rather than discovered.

### 14. The calendar is the source of truth, and it's editable by anyone

Program identity is the event title; capacity and grouping are bracket tags in
the description. Anyone with calendar access can rename an event and, from the
system's point of view, delete one program and create another — dashboard row
gone, registrants to triage, new form. `triageDeletedSessions()`'s refusal to
sweep more than 15 sessions or 25% of the table is what stands between a bulk
calendar rename and a wiped dashboard, and it is doing more work than its size
suggests. Leave those limits alone.

### 15. Admin gating is convenience, not access control

`AUTHORIZED_ADMIN_EMAILS` is a constant in a file that anyone with edit access
to the spreadsheet can open and change. The new two-tier menu hides
destructive items; the `requireAuthorizedAdmin()` checks refuse them however
they are started. Both are real improvements to the chance of an accident.
Neither is a boundary against someone who means it — that comes only from who
the spreadsheet is shared with.

### 16. Single-file, 8,000 lines

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
5a. **Register one test person for lunch on three programs on the same day**
   (three form submissions, same name, lunch ticked each time). On
   `Master_Lunch_Dashboard` that date must read `Registered_Count` **1**, not
   3, and `Lunch_Roster` must show them once with `Requests_Merged` = 2 and
   all three programs listed. This is the number the kitchen orders from —
   check it before trusting a month of it.
5b. **Quick Mark "Sign up for lunch"** on a future catered date. The registrant
   row should come out `Lunch_Status` = `Needed` with `Lunch_Served` **not**
   ticked, the person should appear on `Lunch_Roster` under Upcoming with
   `Registered` ✅ and `Lunch_Served` blank, and `Registered_Count` should go
   up by one while `Served_Confirmed` stays where it was. Then try the same on
   a date with no `Hot`/`Cold` menu row and confirm it is refused with a
   message rather than accepted.
6. **Check the Past sections** show the hidden-row note, and that
   **🕓 Show All Past Rows** brings them back.
7. **Mark an upcoming date "Not Serving"** on `Lunch_Schedule` where somebody
   is signed up for lunch. You should get the named warning immediately, the
   row should leave Master_Lunch_Dashboard on the next sync, and the admin
   address should get an email about it.
8. **Run 🔗 Rewrite Event Links** and open two or three events you know had
   duplicate links. Check there's exactly one, at the top, and that your room
   notes and `[Cap: N]` / `[Grouped]` brackets are untouched.
9. **Link one program across locations** (🔗 Link Program Across Locations…)
   on a program that runs at two sites. Check: one form left carrying all the
   upcoming sessions, every date on it reading "… · Narberth" / "… ·
   Ashbridge", both locations' calendar events pointing at the same link, and
   a test submission landing as rows at the right location. Then register on
   it and confirm the lunch counts still split per location on
   Master_Lunch_Dashboard.
10. **Before the first sync on the new calendar IDs**, read #5 above and decide
   which case you're in. That one is easier to get right beforehand than to
   unpick afterwards.
11. **Decide about calendar invitations before the next registration sync.**
   Config's new **📧 Calendar Invitations** cell defaults to *Invite
   registrants*, and the first sync after that will email every actively
   registered person with an address on file, for every upcoming session. If
   that is not what you want yet, set it to **Do not invite** first. When you do
   turn it on, do it on a quiet afternoon and watch the first run.
12. **Fill in one registration form end to end**, as a registrant would: check
   that picking *Just me — no guests* skips the guest page entirely, that
   picking 2 lands you on a page with exactly two required name boxes, and that
   both sign-up options reach a page that submits. This is the part of the
   change with the most moving pieces, and the one a real person meets first.
13. **Tag one program `[Club]`**, run Sync Cal, and confirm the `Club` column
   fills in on its *existing* sessions. Register on it choosing the club
   option, then check: a row on `Club_Members`, registrant rows for every
   upcoming meeting, and — the part that matters — that the same person is
   still booked after the month rolls over onto a new form. Then untick
   **Active** and confirm the cancellation prompt does what it says.
14. **Print a sign-in sheet** for a real session and look at it on paper.
   Column widths and font size are guesses until somebody has actually written
   in the boxes.
15. **Check one lunch dashboard row's buffers** against Config. They should
   match, including on an upcoming date nobody has registered for yet — that
   was the symptom the buffer change fixes.
16. **Tick `Club` on one program and watch it.** Every other row of that
   program should tick itself immediately, and within a few seconds the
   `[Club]` tag should appear in its calendar events. Then force the case that
   used to break it: tick the box and, before anything else, edit an unrelated
   event on one of the watched calendars (that fires a full sync). The box must
   stay ticked. If `_Pending_Tag_Changes` still holds the row afterwards, the
   edit trigger is missing — run Check Triggers.
17. **Tick `No_Registration` on one program**, then run Sync Cal.
   Check: no form link on its dashboard rows, no "📝 Register for…" line left in
   its calendar events, its old form no longer accepting responses — and its
   room notes and other brackets untouched. Then untick it and confirm all
   three come back.
18. **Delete one test registration** (🗑️ Delete Registrations…). Confirm the
   rows go, the lunch dashboard number drops, and — with the responses tick
   left off — the response is still in the form.
