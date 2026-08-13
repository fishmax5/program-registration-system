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
- puts both of those on the dashboard as **checkboxes**: tick one and the tag
  is written onto every one of that program's calendar events for you;
- can **delete registrations** outright — test runs and duplicates, by session,
  behind a typed confirmation, optionally taking the form responses with them;
- records **several different meals per person** on one day (ate the day-1
  meal here, took two subs home), attached to whoever took them;
- prints a **landscape sign-in sheet PDF** for the desk to mark up by hand;
- **invites registrants to the calendar event** they signed up for, and
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
