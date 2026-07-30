# Program Registration System

A Google Apps Script system that turns **Google Calendar events into
registration forms**, and turns **form responses into a per-location
catering/lunch order**. Built for a multi-location senior center running
recurring programs (in person and over Zoom).

Staff create an event on a program calendar; the system builds a
registration form, links it into the event description, and rolls every
signup into a live dashboard — who's coming to which session, and how much
lunch each location needs to order.

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

## Docs

[`USER_GUIDE.md`](./USER_GUIDE.md) covers setup, the menu, each sheet/tab,
what registrants see, and troubleshooting.
