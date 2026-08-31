# Program Registration System

A Google Apps Script system that turns **Google Calendar events into
registration forms**, and turns **form responses into a per-location
catering/lunch order**. Built for a multi-location senior center running
recurring programs (in person and over Zoom).

Staff create an event on a program calendar; the system builds a
registration form, links it into the event description, and rolls every
signup into a live dashboard — who's coming to which session, and how much
lunch each location needs to order.

It also:

- keeps **club rosters** — programs tagged `[Club]` in their calendar
  description, where people sign up once and stay signed up across every
  future form, reversibly, from a `Club_Members` tab;
- supports programs that take **no registration at all** (`[No Registration]`)
  — a drop-in coffee hour still shows on the dashboard, but gets no form and no
  "register here" link on its calendar events;
- registers **one-to-one appointments** by TIME rather than by date — programs
  tagged `[Personalized Assistance]` (computer help, low-cost wills, Medicare
  counseling) have each event cut into back-to-back slots, and their form asks
  which slot you want, with taken times removed and the day packing from the
  front so a provider never gets a schedule with gaps in it. Anybody the offered
  times don't suit lands on an `Assistance_Requests` tab instead of being booked
  onto a date they never chose, and one menu item prints the whole day's list —
  names against times, with contact details — to send the provider a week ahead;
- **reviews those appointment programs a month at a time** — the unit one form
  actually covers — and fixes them from the same screen: `🗓️ Review Appointment
  Months…` walks one program-month per screen ("Low-Cost Wills — September 2026,
  Narberth"), says whether the form somebody is about to hand out offers every
  date in the month and every appointment on each date, and offers the fixes
  underneath it: merge a day still typed as one event per appointment, take the
  times from the calendar again, set one appointment length, put the whole month
  onto one form, move a single date somewhere else, tidy the duplicate rows a
  day of blocks left behind. Nothing is applied until you press Apply, and then
  the calendar, the sheet and the forms are all brought into line in one pass;
- **keeps a session's times honest.** `Event_Date` and `Event_End` used to be
  written once, when a date first appeared, and never again — so lengthening a
  calendar event afterwards left the sheet saying the old span, and an
  appointment's slots are cut out of the SHEET. A month of 90-minute blocks
  therefore offered one appointment per date. Every sync now brings those two
  columns back into line with the calendar, and a day still typed as several
  back-to-back events reads as the whole span it covers rather than as whichever
  block was written last;
- lets a single program **ask its own extra questions** (zip code, membership,
  which document you need drawn up) from a `Program_Questions` tab, applied to
  its form and re-applied after every template rebuild — so a question survives
  the updates that used to silently delete it, can never collide with a question
  the system reads by name, and lands in one `Form_Answers` column rather than
  changing the shape of the registrants table;
- puts all three tags on the dashboard as **checkboxes**: tick one and every
  other row of that program ticks to match, and the tag is written onto every
  one of its calendar events for you, seconds later — with the tick queued and
  protected in the meantime, so a sync can't undo it before it lands;
- can **delete registrations** outright — test runs and duplicates, by session,
  behind a typed confirmation, optionally taking the form responses with them,
  and they **stay** deleted: neither the sign-up-for-every-date registry, the
  club rosters, nor a re-import puts them back, while a genuinely new
  submission from the same person still comes through;
- follows a program through a **rename** — change the title on the calendar and
  the sessions, registrants, club roster, staff notes and form all move across
  with it, instead of the sessions being swept into triage and the club roster
  silently detaching;
- counts a lunch **once per person per day**, however many of that day's
  programs they ticked the lunch box on — three sign-ups from one person is one
  meal on the order, not three, with a `Requests_Merged` column showing where a
  merge happened so the number stays auditable (a person who genuinely orders
  several meals says so in one place, not by registering repeatedly);
- takes registrations for **lunch on its own**, with no program attached — a
  self-building sign-up form per location per month, generated from the lunch
  menu rather than the calendar, on which "I want lunch on every date listed"
  books a whole month of meals in one page; its links are **pinned to the top
  of the lunch dashboard**, which is where staff are standing when somebody
  asks for them, and a menu typed **up to six months ahead** gets its form and
  its link straight away, so the link exists before the newsletter advertising
  it does; each generated lunch date sits on the program dashboard named for
  its place and its dish (`Lunch @ Narberth — Chx Parm`) rather than as one of
  thirty identical rows reading "Lunch Only (no program)", and stays out of the
  participation numbers and the Today block — a meal is not a program, but it
  is worth reading;
- lists **who is eating**, not just how many, on a `Lunch_Roster` tab: one row
  per person per date and location, with their programs, phone, `Hot`/`Cold`
  and whether they've been handed their meal — built from the same pass as the
  order count, so the names and the number cannot disagree;
- marks people off at the desk from a **Quick Mark dialog** — location,
  session, name, then Attended and/or Lunch, with Lunch on its own recording a
  meal collected by somebody who never came in — and **signs somebody up for a
  future lunch** from the same dialog, recording the demand without claiming a
  meal was served;
- puts that same sign-in **on a tablet at the door**, as a web page served by
  this script (`doGet`) rather than a second system: `📱 Door Pages` hands
  over the links, two per building, and the check-in list shows a session's
  roster — every registered name as a row you tap once to mark present, ticked names
  showing as checked in, a running "14 of 30", a second tap for a meal handed
  over, and an undo for the tap that landed on the wrong row. It writes through
  exactly the function Quick Mark writes through, under the same lock, into the
  same cells — no copy of the data anywhere, and nothing new to authenticate
  against. A PIN can be set for the deployment a shared tablet needs, where
  nobody is signed into a Google account;
- **signs in the person who never registered** — the other page on the same
  deployment, and the one the plain `?location=` link now opens on, because a
  senior center's front door is mostly people who read the newsletter and
  walked in. It asks the two questions a door asks: *who are you* — everybody
  signed up for anything here today as a card, alphabetically, so tapping your
  own name beats typing it, plus a search across the whole member roll and an
  **I'm new here** that takes a name and an email — and *what are you here
  for*: every program on at this building today with the ones they are already
  registered for **ticked and labelled**, the rest offered unticked so ticking
  one registers them on the spot, and any `[Personalized Assistance]` program
  shown but left to staff, since a chair at a time is a conversation. It writes
  through exactly the function Quick Mark writes through, and the new member
  lands on `Member_Roll` with a staff note saying the membership form still has
  to go out;
- **tells a meal that is ordered from one that is merely wanted.** Lunch is the
  last line of that page, and it says which: a registered meal reads *already
  ordered for you — collect it at the counter*, while an unregistered one reads
  *tick this to be added to the list, then check with a staff member that a
  meal is available* — recording the demand (`Lunch_Status` = `Needed`) without
  ever promising food that was ordered from a caterer three days ago against a
  count. A day the kitchen is shut cannot be ticked at all, and says so;
- orders **more than one meal for the same person** — a standing order of four
  is a number in `Meals_Ordered` on one row, not four invented guests called
  "Extra Meal 1"; the kitchen's count adds meals rather than heads, the roster
  still shows one name, and the printed sign-in sheet prints the real number in
  its `MEALS ORDERED` box. Registrants can ask for extras on the form itself,
  and a desk can type them into Quick Mark;
- records **several different meals per person** on one day (ate the day-1
  meal here, took two subs home), attached to whoever took them — enterable at
  the desk from Quick Mark rather than only by finding the row — and **which
  lunch** they were, so serving Wednesday's leftovers on Thursday stops
  reporting one batch of food as both waste and phantom demand;
- shares a **live sign-up sheet with an instructor** — a small spreadsheet in
  Drive holding one program's roster at one location, refreshed on the hourly
  sync rather than printed, where the instructor ticks who has been
  **contacted**, **confirmed**, **waitlisted** or has **dropped** and those
  marks come back into the workbook, cell by cell, without overwriting a
  correction staff made in the meantime — and with no trigger of its own, so it
  still works at the sixtieth program;
- holds **registration shut until a date you set** — one `Registration Open
  Through` cell on Config, so next season's calendar can go up months early
  without anyone signing up for it: sessions past that date get a calendar
  event that reads **🚧 Registration Not Yet Open** instead of a register link,
  and their form is built but not accepting responses. Move the date forward
  and the links and forms come back on the next sync;
- prints a **landscape sign-in sheet PDF** for the desk to mark up by hand;
- **invites registrants to the calendar event** they signed up for — every
  session on the hourly pass, or a session you pick from the menu — and
  un-invites them if they cancel.

- **reviews itself, program by program** — every rule here is enforced on
  the way IN, when a sync runs or a box is ticked, and none of them on the way
  out; so after a season of editing nothing says which of forty programs are
  still in the state their author believes they are in. One dialog now walks
  them a screen at a time and states what ought to be true of each — the sheet
  and the calendar agreeing about what kind of program it is, its events all
  saying the same thing, as many forms as its kind implies, a register link on
  every event, a slot length on an appointment program, every row with an
  event behind it and every event with a row — with the fix on a button beside
  each answer that isn't a tick. It reads twice and opens no form, so forty
  programs take seconds, and marking one reviewed records what was TRUE when
  you looked, so a calendar that moves underneath says "changed since" rather
  than going on claiming the program is fine;
- asks **what kind of program is this** in one place instead of spreading it
  over four checkboxes that interact in ways nobody holds in their head:
  monthly, series, club, club series, appointments, drop-in. Each of the six is
  exactly a setting for all four of the old controls — same tags, same calendar
  stamps, same columns — so a workbook edited by hand goes on working;
- **merges a day typed one event per appointment into one event**. A session is
  identified by its calendar, its name and its DATE, with no time in it
  anywhere, so seven back-to-back "Low-Cost Wills" blocks are all the *same*
  session — the dashboard shows one row fighting over which block's times to
  display, and six of the seven events are invisible. Merging gives one event
  covering the span, tagged with how long an appointment is, which is the shape
  the times are actually booked from. Registrations are untouched: the survivor
  keeps the same name, date and calendar, so it is the same session it always
  was;
- **stops asking a one-date form which dates you want**. "All events this month"
  and "choose specific days" mean the identical thing over a list of one, and
  the grid behind the second is a table with one row — so the question comes off
  and the page it sat on says which date this is instead. Reversible on the next
  sync when a second date appears, and never applied to a club form, where that
  same question is how somebody joins the roster.

This repo was split out of `fishmax5.github.io`, where it had been
mixed in with an unrelated static site — full development history preserved.

## Install

1. Create a new Google Sheet.
2. **Extensions ▸ Apps Script.**
3. Delete the stub `Code.gs`, then add a new script file named `Code` and
   paste in the contents of [`Code.gs`](./Code.gs).
4. Save and reload the spreadsheet tab.
5. See [`USER_GUIDE.md`](./USER_GUIDE.md) for first-run setup (there's a
   dedicated **Import Everything (First Run)** path for calendars that
   already have events on them) and day-to-day use.

## Updating an existing workbook

Paste the new [`Code.gs`](./Code.gs) over the old one, reload the spreadsheet,
then run **🔧 Admin ▸ 🧱 Rebuild Layout (no calendar sync)**. It redraws every
tab from the rows already in the workbook — no calendar read, no form write,
no trigger changes, and nothing can be removed. See
[Updating to a new version](./USER_GUIDE.md#updating-to-a-new-version).

## Docs

- [`USER_GUIDE.md`](./USER_GUIDE.md) — setup, the menu, each sheet/tab, what
  registrants see, old months, and troubleshooting.
- [`SYSTEM_REVIEW.md`](./SYSTEM_REVIEW.md) — known failure modes, short and
  long term, and what to verify in a live workbook.
- [`STRESS_TEST.md`](./STRESS_TEST.md) — what came back when the logic was run
  against adversarial inputs: what was fixed, and what is known and left.
- [`SIMPLIFICATION_REVIEW.md`](./SIMPLIFICATION_REVIEW.md) — a review of the
  whole system against what it is actually asked to do: where the complexity
  falls on the person operating it, which tabs and tags could be condensed
  (and which should not be yet), and the five bugs that review turned up.

## Tests

The Apps Script services are stubbed and `Code.gs` is loaded into a Node `vm`
context, so the pure helpers — appointment-slot arithmetic, the tag brackets,
the Program_Questions parser and its refusals — can be exercised without a
spreadsheet:

```
node tests/bracket_tags.test.js
node tests/assistance_and_questions.test.js
node tests/lunch_signup_links.test.js
node tests/lunch_signup_horizon.test.js
node tests/quick_mark_index.test.js
node tests/quick_mark_signup.test.js
node tests/lunch_demand.test.js
node tests/form_rebuild.test.js
node tests/sectioned_value_reader.test.js
node tests/column_widths.test.js
node tests/regular_needs.test.js
node tests/quick_mark_inline_index.test.js
node tests/multiple_meals.test.js
node tests/standing_lunch.test.js
node tests/event_time_epoch.test.js
node tests/appointment_review.test.js
node tests/check_in_page.test.js
node tests/walk_in_page.test.js
```
