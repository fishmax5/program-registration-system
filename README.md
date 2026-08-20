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
- puts both of those on the dashboard as **checkboxes**: tick one and every
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
  merge happened so the number stays auditable;
- takes registrations for **lunch on its own**, with no programme attached — a
  self-building sign-up form per location per month, generated from the lunch
  menu rather than the calendar, on which "I want lunch on every date listed"
  books a whole month of meals in one page; its links are **pinned to the top
  of the lunch dashboard**, which is where staff are standing when somebody
  asks for them;
- lists **who is eating**, not just how many, on a `Lunch_Roster` tab: one row
  per person per date and location, with their programs, phone, `Hot`/`Cold`
  and whether they've been handed their meal — built from the same pass as the
  order count, so the names and the number cannot disagree;
- marks people off at the desk from a **Quick Mark dialog** — location,
  session, name, then Attended and/or Lunch, with Lunch on its own recording a
  meal collected by somebody who never came in — and **signs somebody up for a
  future lunch** from the same dialog, recording the demand without claiming a
  meal was served;
- records **several different meals per person** on one day (ate the day-1
  meal here, took two subs home), attached to whoever took them — and **which
  lunch** they were, so serving Wednesday's leftovers on Thursday stops
  reporting one batch of food as both waste and phantom demand;
- shares a **live sign-up sheet with an instructor** — a small spreadsheet in
  Drive holding one program's roster at one location, refreshed on the hourly
  sync rather than printed, where the instructor ticks who has been
  **contacted**, **confirmed**, **waitlisted** or has **dropped** and those
  marks come back into the workbook, cell by cell, without overwriting a
  correction staff made in the meantime — and with no trigger of its own, so it
  still works at the sixtieth program;
- prints a **landscape sign-in sheet PDF** for the desk to mark up by hand;
- **invites registrants to the calendar event** they signed up for — every
  session on the hourly pass, or a session you pick from the menu — and
  un-invites them if they cancel.

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
