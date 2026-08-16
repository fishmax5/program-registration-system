# Stress Test

A pass over the system done by *running* it rather than reading it: the pure
logic in `Code.gs` was loaded into a Node sandbox with the Google Apps Script
services mocked, and then fed the inputs a live workbook actually produces —
program names with punctuation in them, a menu pasted in the wrong date
format, two menus for one day, a person whose name gained a second space, a
registrant row whose event has been deleted, a description somebody typed
their own bracketed note into.

Where a companion to [`SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md): that document
reasons about failure modes from the code. This one reports what came back
when the inputs were supplied.

Everything under **Fixed** is fixed in this branch. Everything under
**Known, not fixed** is a real finding with a reason it was left, and is the
more useful half of the list.

---

## Fixed

### 1. A program name containing " — " silently lost every registration

**The worst thing found, and it is silent.**

`registryIndex` is keyed `Form_ID | plain session label`. A form's grid row
label is the same label with decoration appended — a menu hint after " — ",
then the capacity suffix — so `processFormResponse()` recovered the key with
`stripMealHint()`, which cut the label at the **first** " — ".

That is right only when the separator appears once. `formatSessionLabel()`
puts the PROGRAM NAME into the plain label on a combined or cross-location
form, so a program called `Tech Help — Drop In` produced:

| | |
|---|---|
| registry key | `Mon, Jan 5, 2026 · Tech Help — Drop In` |
| form row label | `Mon, Jan 5, 2026 · Tech Help — Drop In — Chicken` |
| looked up as | `Mon, Jan 5, 2026 · Tech Help` |
| result | **no match — every registration for that program dropped** |

The only trace was one line in the execution log. No row, no count, no
dashboard change, nothing a person would see. The same thing happened from the
other side whenever a meal shorthand contained an em dash
(`Chicken — house made`), which is a perfectly ordinary way to write a menu.

**Fixed.** `sessionLabelCandidates()` generates every plain label a decorated
label could be hiding — capacity suffix off, then each " — " cut away from the
right — and `resolveSessionLabelForForm()` takes the first that answers in the
registry. Longest first, so a form holding both `· Tech Help` and
`· Tech Help — Drop In` still resolves each to its own session. A row that
matches nothing now raises an admin note saying so by name, instead of only a
log line.

### 2. An explicit `[Monthly]` in the description could not override `[Grouped]` in the title

`resolveEventSettings()` documented "the DESCRIPTION's brackets win, and
anything the description doesn't specify falls back to legacy brackets left in
the title", and implemented it as `fromDescription.isFixed || legacyIsFixed`.

Grouping is the one setting with a spelling for *off*. `isFixed === false`
cannot tell "the description says Monthly" apart from "the description says
nothing about grouping", so an explicit `[Monthly]` lost to a `[Grouped]` left
behind in the title — and the title is exactly where the old convention put it.
Moving a program to Monthly in the description did nothing at all until
somebody also found and deleted the legacy title bracket. Same shape as the
"I changed Grouped to Monthly and it changed itself back" failure in
`SYSTEM_REVIEW.md` §1, one layer further down.

**Fixed.** `parseSettingsBrackets()` now reports `explicitGrouping`
(`'Grouped'` / `'Monthly'` / `''`), and the description wins outright when it
states one. `[Cap: N]`, `[Club]` and `[All Locations]` are unchanged — they have
no "off" spelling, so falling back to the title is still the right reading.

### 3. `Mary  Smith` and `Mary Smith` were two different people

`normalizeNameKey()` was `trim().toLowerCase()`, which does nothing about
whitespace **inside** a name. These names are typed by the public into a form
and by staff into Quick Mark, and a stray second space is the commonest way one
person becomes two: two `Member_Roll` rows, `Times_Seen` split across them, a
club membership that doesn't match the registration, the same person offered
twice in a Quick Mark dropdown. All from a keystroke nobody can see.

`computeClubKey()` had the same gap on a *program* name, which is worse — a
calendar title that gains a double space becomes a different club, and a club
whose key changes loses its whole standing roster.

**Fixed.** Both collapse `\s+` to a single space. This is the cheap half of
`SYSTEM_REVIEW.md` §4; the hard half (two genuinely different Mary Smiths)
still needs something the forms don't collect.

### 4. A hand-typed `not serving` defeated every Not-Serving safeguard at once

`getMealInfoIndex()` read the `Type` cell verbatim, and every check downstream
compares it to the exact string `'Not Serving'`. Lowercase `not serving` is not
that string, so:

- `isExplicitlyNotServing()` → false
- `isLunchOfferedOn()` → true
- the form kept offering lunch on a day the kitchen was closed
- nobody was warned, because the warning is gated on the same comparison

The `Type` column does carry a strict dropdown — but a paste brings its own
validation over the top of the cell's, and pasting a month of menu is the
normal way this tab gets filled.

**Fixed.** The index canonicalizes the type on read (anything
`canonicalizeLunchType()` doesn't recognize is kept verbatim, as before), and
`stampMealIds()` — the one pass that already rewrites every row on every
render — canonicalizes the cell itself, so it only has to be got right once
rather than at every reader.

### 5. Two catered menus for one date and location: the second one vanished

`Lunch_Schedule` can hold a Hot row *and* a Cold row for the same day and
place. Nothing rejects it, and `deriveMealId()` deliberately mints a distinct
`Meal_ID` for each — `M-…-HOT` and `M-…-COLD` — both of which
`getRecentMealIdOptions()` then offers in the `Meal_Source` dropdown.

But the rollup is keyed `date | location`, `getMealInfoForDate()` returns the
**first** matching row, and `resolveRegistrantLunchType()` hands everyone that
row's type. So the second batch produced no dashboard row, no order and no
form hint — while still appearing in a dropdown that invites staff to attribute
meals to it, which would then be counted against the *other* batch's row.

**Reported, not restructured.** Supporting two catered types side by side means
re-keying this tab, the dashboard rollup and the registrant `Lunch_Type`
together — see *Known, not fixed* §A. The clash now raises an admin note
naming both types and the date, so it can never be silent. An exact duplicate
row (same type twice) stays quiet; it is genuinely harmless.

### 6. Served meals on a row with no session were dropped on the floor

`buildDashboardRollup()` skipped any registrant row whose `Event_ID` matched no
session, on the reasoning that such a row is a deleted event and gets triaged
instead. Triage doesn't cover every way a row gets stranded — re-pointing
`CALENDAR_MAP` re-keys every `Event_ID` and deliberately leaves the old rows
alone (`SYSTEM_REVIEW.md` §5) — and the skip happened *before* the
`Lunch_Served` tick and the meal counts were tallied.

So a row reading "Lunch_Served ✓, 5 meals" quietly contributed nothing to the
catering record. That is the same mistake the orphan `Meal_Source` path
explicitly refuses to make: *an unreadable reference is a reason to ask
somebody, not to lose a meal that demonstrably happened.*

**Fixed.** A stranded row carrying a served tick or a meal count now raises an
admin note with the person, place, date and dead `Event_ID`. A stranded row
carrying nothing stays quiet.

### 7. Unticking a checkbox could delete somebody's note off a shared calendar

`setFlagBracketInDescription()` removed a comma-separated part when the part
*contained* the tag word. `[Book Club]` contains `Club`, so unticking the Club
box deleted the whole bracket — a line off a calendar event that attendees can
see, with no undo and no mention. `[Drop-In room 4]` went the same way to the
No_Registration box, since `Drop[\s-]?In` is one of its spellings.

**Fixed.** Removal is now exact: a part goes only when the part **is** the tag
(`Club`, `Members Only`, `Cap: 12, Club` → `Cap: 12`), never when it merely
contains it. Whatever survives is reported —
`descriptionStillCarriesFlag()` detects it and
`stampProgramFlagOnCalendar()` tells the admin the box will re-tick itself on
the next sync and which events to edit by hand.

The trade is deliberate. A checkbox that won't stick is visible, explained and
fixable in thirty seconds. A deleted note is neither.

### 8. A pasted menu date could be silently wrong by decades

`coerceMenuDate()` fell through to `new Date(text)`, which accepts a great deal
that is not a menu date:

| pasted | landed on the tab as |
|---|---|
| `9/16` (no year) | **September 2001** |
| `45000` (a spreadsheet serial, i.e. a date column that lost its formatting) | **the year 45000** |

Both were accepted as valid rows — not rejects — so they never appeared in the
"couldn't read these" report shown to whoever pasted them. They just landed
somewhere nobody will ever scroll to, and the day they were meant for stayed
blank.

**Fixed.** `plausibleMenuDate()` bounds the year to two years back and three
forward. Anything outside becomes a normal parse reject, reported on screen
while the paste is still in front of the person who made it.

### 9. Two smaller ones, fixed in passing

- **A whitespace-only description gained a leading blank line** when a tag was
  added — `"   "` became `"\n[Club]"`, because the emptiness test was on the
  raw string rather than the trimmed one. Both bracket writers now test
  `raw.trim()`.
- **`onProgramFlagEditInstallable()` never flushed the admin digest.** It is
  the one path that delivers a tick to the calendar without a sync wrapped
  around it, so anything `stampProgramFlagOnCalendar()` needed to report was
  assembled and then discarded with the execution. It flushes now — which is
  what makes §7's report actually arrive.

---

## Known, not fixed

### A. One catered meal per location per day is a structural assumption

Everything in §5 above is a symptom of one thing: `date | location` is the key
this half of the system is built on. `upsertLunchScheduleRows()` merges on it,
`getMealInfoIndex()` indexes on it, `buildDashboardRollup()` buckets on it,
and `resolveRegistrantLunchType()` resolves a person's Hot-or-Cold through it.

`Meal_ID` is the one part that already says otherwise — it includes the type,
precisely because a batch is a thing distinct from a day. So the two halves
disagree, and the disagreement is what makes a second catered row half-exist:
real enough to be offered in a dropdown, invisible everywhere it would count.

Making it real means, together and in one change:

1. re-keying the rollup and `Master_Lunch_Dashboard` on `date | location |
   type` (the tab already has a `Lunch_Type` column and per-type buffers, so
   the shape is there);
2. giving the form a way for a registrant to choose *which* meal, which today
   is a single Yes/No — `GENERIC_LUNCH_CHOICES` — with the type inferred from
   the day;
3. deciding what `resolveRegistrantLunchType()` stores for a person who
   answered before the second batch existed.

Worth doing only when a location actually starts serving two catered meals in
one day. Until then the admin note from §5 is the whole of what is needed:
the situation is rare, and it is no longer silent.

### B. A walk-in row still blocks that person's real registration

Unchanged from `SYSTEM_REVIEW.md` §3, and re-confirmed here: a protected key
(`Event_ID | name | Person_Type`) makes `buildRegistrantRow()` return `null`,
so the online submission is discarded whole — `Party_ID`, admin notes and
dietary information with it.

Now that §1 is fixed, this is the **last remaining path by which a real
registration disappears without trace**, which moves it up the list. The fix
named in the review — merge the incoming `Admin_Notes` / `Party_ID` into the
protected row rather than discarding the response — is the right one, and it
is a contained change to one function. It was left out of this branch only
because it changes what a protected row means, and that deserves its own
decision rather than riding along with nine unrelated fixes.

### C. Meal counts accept fractions and are unbounded

`Day1_Dined_In = 2.5` produces two and a half meals on the dashboard;
`1000000000` produces a billion. Negative numbers and text are correctly
ignored. Nothing rounds, bounds or queries any of it.

Left alone because the column is typed by one or two people who are counting
plates, and a wrong number there is visible on the same row they typed it
into. A `Math.round` and a sanity ceiling would be two lines if it ever bites.

### D. Meals that move LOCATION are not reported as carried over

`resolveMealSource()` sets `carried` from the date alone
(`batch.dateKey !== meta.dateKey`). Point a row's `Meal_Source` at another
location's batch on the same day and the meals move to that location's
dashboard row with `Carried_Over` reading 0 — the number changes, and nothing
on the row explains why.

Left alone because `Carried_Over` is documented as "eaten on a different day",
and widening it to mean "or in a different place" is a definition change, not
a bug fix. If it is widened, the column's comment in `HEADERS` has to move
with it.

### E. A superseded registration's served meal is still counted

`Lunch_Served` and the meal counts are tallied before the
`Program_Status`/`Lunch_Status` filter, on purpose — a walk-in's meal is real
whether or not they ever registered. But `Superseded` means "replaced by a
newer submission from the same person", so a superseded row and its
replacement both carrying a served tick double-counts one lunch.

`supersedeRegistrantRow()` rewrites both statuses and leaves the day-of columns
alone, which is correct for its own purpose (a superseded row is a record of
what was submitted). Reaching one row's `Lunch_Served` from another row's
supersede is a rule with more edges than the double-count it prevents. Worth
watching, and easy to spot: `Served_Confirmed` higher than the headcount.

### F. `[Cap: 99999999999999999999]` is accepted as written

Capacity is `parseInt` with no ceiling, so a typo in a calendar description
propagates as `1e20` into `Remaining_Seats` and the status calculation.
`[Cap: -3]` is read as no capacity at all rather than as an error. Neither
does damage beyond a silly-looking cell, and both are visible on the dashboard
the moment they happen.

---

## Running it again

The harness is not in this repo, and deliberately — it mocks eleven Google
services and would rot faster than the code it tests. It is about 150 lines:
load `Code.gs` into a `vm` context whose globals are stubs for
`SpreadsheetApp`, `CalendarApp`, `FormApp`, `PropertiesService`, `Utilities`
and the rest, then call the pure functions by name. Because Apps Script
function declarations land on the sandbox's global object, individual sheet
readers (`readAllSectionedRows`, `readLunchScheduleRows`,
`getCateringPolicyForLocation`) can be replaced from outside to drive the
stateful paths — which is how `buildDashboardRollup()` was exercised above
without mocking a spreadsheet at all.

The one thing worth keeping in mind if it is rebuilt: `const` declarations in
`Code.gs` land in the context's *lexical* scope, not on the global object, so
they can be read by evaluating their name in the context but cannot be
overridden from the host. Functions can.
