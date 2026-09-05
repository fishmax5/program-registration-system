# Simplification Review

A review of the whole system against what it is actually being asked to do,
prompted by one worry: *"I am worried the system is getting too complicated to
operate."*

That worry is correct, and it is worth being precise about **who** it is
complicated for, because the answer changes what to do about it.

The requirements here come from `USER_GUIDE.md`, `SYSTEM_REVIEW.md`,
`STRESS_TEST.md`, the code itself, and the email thread with the
administrative assistant who runs this workbook day to day — which is the only
source that says what the system is like to *use*.

---

## 1. Where the complexity actually is

| | Before this branch | After |
|---|---|---|
| `Code.gs` | 24,011 lines, 625 functions | 24,499 lines, 635 functions |
| Tabs | 12 (+1 hidden) | 12 (+1 hidden), colour-grouped |
| Top-level menu items | 18 | 3, plus 4 submenus |
| Config sections | 8 across 22 columns | unchanged |
| Words that could switch on a tag | ~20, **anywhere inside a bracket** | 9 patterns, **whole bracket only** |

Two things stand out.

**The code did not get simpler, and that is fine.** `SYSTEM_REVIEW.md` §16 was
written when this file was 8,000 lines and 270 functions. It has tripled since.
But nobody operating this workbook reads `Code.gs`. The size is a *maintenance*
problem — worth acting on eventually, discussed in §5 — not the thing making
the system hard to run.

**The operator-facing surface is where the pain is**, and it was genuinely
large: eighteen flat menu items, twelve undifferentiated tabs, six tags with
about twenty accepted spellings, three checkbox columns that write to Google
Calendar, and a rule ("don't type there") that only existed in an email.

That is what this branch attacks.

---

## 2. Bugs found

Five, ordered by how much damage each can do. All five are fixed on this
branch. The three marked **new** are not in `SYSTEM_REVIEW.md` or
`STRESS_TEST.md`.

### 2.1 A bracketed note silently reconfigured a program — **new, worst**

Staff were told two things at once, and the two collided:

> *"Move clarifying info to event descriptions."*
> — the calendar naming-conventions email, to all staff

> Settings go in the event description, in square brackets.
> — `USER_GUIDE.md`

Every tag was detected by testing its regex against the **whole bracket**, so a
bracket only had to *contain* one of these ordinary English words. Verified
against the real parser before the fix:

| Somebody types | What actually happened |
|---|---|
| `[Film Club selection: Casablanca]` | program given a **standing club roster** |
| `[Drop-in welcome]` | **registration form deleted** |
| `[Combined with the JCC]` | **pooled onto one form with every other location** |
| `[Call the office for an appointment]` | **cut into 30-minute appointment slots** |
| `[Regular attendees only]` | forced to one form per month |
| `[Multi-Site event in the spring]` | pooled across every location |

None of it announced itself. The parser's own comment promised the opposite:
*"Unrecognized bracket contents are ignored, so people can bracket other notes
in a description without confusing anything."*

This was not hypothetical. The program roster in the workbook includes a Film
Club and a Book Club, and the person who maintains the print calendar had
already asked, in writing, where to put the month's film and book topics.

**Fixed.** A bracket is read as settings only when the system understands *all*
of it. Strip every recognized tag out; if real words are left, it is a sentence
and the whole bracket is ignored — honouring half of "Film Club selection" is
worse than honouring none. `tests/bracket_tags.test.js` pins both halves: all
21 tag spellings and every documented combination still parse, and twelve
realistic notes now set nothing.

### 2.2 A background sweep shut the sign-in desk — **new**

Reported from the desk:

> *"I tried to run Quick Mark and half the time it has trouble running due to
> the destroy and sweep program running in the background — how often does that
> program run and how long does it take?"*

Two independent causes, both real:

- **It refused to open.** `showQuickMarkDialog()` guarded on
  `isBootstrapActive()`, true for a bootstrap import *or* a destroy-and-rebuild
  forms sweep. The import genuinely conflicts. The sweep replaces *forms*, and
  touches registrations only through the ordinary import at the head of each
  slice — which Quick Mark coexists with every hour of every day. A sweep can
  run up to 60 slices, so the desk's most-used tool could be gone for hours
  because a maintenance job was rebuilding forms nobody was standing at.
- **Even open, it was locked out.** Each slice took the script lock and held it
  for its whole 4.5-minute budget, handing off 30 seconds later. The workbook
  was shut roughly **90% of the time a sweep ran** — "half the time", as
  observed, and generous.

**Fixed.** Quick Mark asks the narrower question (`isDeskWorkBlocked()`), and
the sweep now takes the lock around one unit of work at a time — the import,
the plan re-read, **each form**, the closing render — so there is a gap between
every form for anything else to get in. The 1.5s pacing sleep moved outside the
lock, where it is a gap rather than holding the workbook shut doing nothing.

### 2.3 Quick Mark's write had no lock at all

Already flagged in `SYSTEM_REVIEW.md` §12 as a general concern; here is the
specific consequence. `applyQuickMarkFromDialog()` read the tab to find a row,
then wrote to that **row number**. A render landing in between — a sync, a
rebuild slice, another desk — sent the tick to whichever row had moved into
that position. Small window, silent outcome: somebody else marked present.

**Fixed.** It takes the lock for a short 3 seconds and says "press it again in
a moment" rather than hanging or guessing.

### 2.4 The admin list could lock everybody out — **new**

`AUTHORIZED_ADMIN_EMAILS` held exactly one hardcoded address,
`admin@newhorizonsseniorcenter.org`. `USER_GUIDE.md` claimed it held two. That
drift is itself the warning.

If that address is not an account anybody can sign in as, **every** admin
action refuses and names an account nobody has: Rebuild Layout, Delete
Registrations, Import Everything, Check Triggers, Re-check All Forms, Restore
Triaged Registrants, Archive Old Months, Confirm Large Triage. That includes
the one the `README`'s own upgrade instructions tell you to run, so the
documented way to install a new version stops working, with no way back except
editing the source.

**Fixed.** The workbook's **owner** is always an admin. They can already change
the code, delete the tabs and reshare the workbook; gating them out protected
nothing and stranded everything. Everyone else still fails closed.

### 2.5 No day of the week on any date

Asked for from the desk:

> *"Any chance we could have the day of the week on the main event page as well
> as the date? It would make it easier to find things like 'Advanced Mah Jongg'
> at Ashbridge (Tues) vs 'Advanced Mah Jongg' at Narberth (Mon)."*

Programs here are known by their day as much as by their name. Every
`Event_Date` now reads `Tue 9/16/2026`, across all six date-bearing tabs, from
one change in the function that already formats that column.

### Checked and clean

- No undefined function references anywhere in the file.
- No sort comparators returning booleans, no zero-row `getRange` calls, no ES6
  features Apps Script's V8 runtime lacks.
- The lunch de-duplication, appointment-slot arithmetic and meal-source
  attribution are all correct as written and unusually well defended.
- The known-but-unfixed items in `STRESS_TEST.md` (one catered meal per
  location per day, walk-in rows blocking a later real registration, fractional
  meal counts) are accurately described and still stand.

---

## 3. What sheets can be condensed

**Short answer: none should be deleted right now, and here is why that is the
recommendation rather than a dodge.**

Every tab was assessed for whether it earns its place:

| Tab | Grain | Verdict |
|---|---|---|
| `All_Program_Sessions` | session | Core. Keep |
| `All_Registrants` | person × session | Core. Keep |
| `Master_Lunch_Dashboard` | date × location | Core. Keep |
| `All_Lunch_Registrants` | person × date × location | **Different grain from the dashboard** — one is counts, one is names, and both were asked for explicitly. Keep |
| `Lunch_Schedule` | date × location | Core. Keep |
| `Config` | settings | Keep |
| `Club_Members` | person × club | Keep |
| `Program_Questions` | program × question | Keep, now doing more (§4) |
| `Assistance_Requests` | request | Keep — but see the workflow gap below |
| `Member_Roll` | person | Thin: feeds Quick Mark's name list, plus staff notes. Keep |
| `Program_Options` | program × location | **Thinnest.** One functional column (`Instructor_Email`); the rest are display-only or staff notes |
| `Deleted_Event_Triage` | person × session | **The real merge candidate** — 37 columns duplicating `All_Registrants`'s entire schema plus four |

Two are genuinely mergeable:

**`Deleted_Event_Triage` could be a status value, not a tab.** It duplicates
every column of `All_Registrants` and adds four. A `Program_Status = 'Triaged'`
plus the four extra columns on the main tab would remove a 37-column tab and
its whole parallel read/write path — the single biggest structural
simplification available.

**`Program_Options` could fold into `Member_Roll`** as a second table, or lose
its derived columns entirely and become a short "instructor and room notes"
block.

**Why not now.** September registration is being set up in the live workbook
this week. Both merges touch the deletion/restore path and the instructor-sheet
path — the two places where getting it wrong loses a registration rather than
looking wrong. Neither buys the operator much: the complaint is not "there are
twelve tabs", it is "I cannot tell which of these twelve matter or which I am
allowed to type in".

**So this branch answers the actual complaint instead**, and the tab merges are
recorded here for a quiet month:

- The tabs are now **coloured by group** — 🟩 Today, 🟦 Set up, 🟨 Standing
  lists, ⬜ Archive — in the order they are worth looking at.
- The guide now states the typing rule in one line: **a yellow column header
  with ✍️ is yours; everything else is rebuilt.**

### The workflow gap that a tab merge would not fix

> *"Medicare needs a way to register for a consultation outside a set schedule…
> Do we have a way in the new system to accommodate a basic request for help
> which is not tied to a specific date? …how do I add the person into the
> system once a date and time has been hammered out? Do I have to create a new
> event or can I just add their name and the date and time?"*

The first half is built: `Assistance_Requests` files exactly those people. The
second half — turning a filed request into a real booking — has no button. The
answer today is: create the calendar event, then add them through **Quick
Mark** as a walk-in. That works, and it is now the documented path, but a
"schedule this request" action on the requests tab would be the natural
finish. Recorded, not built: it is a feature, not a fix.

---

## 4. What event tags can be condensed

The tag vocabulary is six tags with about twenty accepted spellings:

| Tag | Also spelled |
|---|---|
| `[Cap: N]` | — |
| `[Grouped]` | `[Fixed]` |
| `[Regular]` | `[Monthly]` |
| `[All Locations]` | `[Shared]` `[All Sites]` `[Combined]` `[Multi-Site]` |
| `[Club]` | `[Membership]` `[Members Only]` |
| `[No Registration]` | `[Drop-In]` `[No Sign-ups]` `[Registration Not Required]` |
| `[Personalized Assistance]` | `[By Appointment]` `[Appointments]` `[1-on-1]` `[One-on-One]` |
| `[Slots: N]`, `[Max Per Month: N]` | — |

**The right fix was not to delete spellings — it was to stop them matching
loosely.** Deleting an alias breaks whatever calendar events already carry it,
for no gain: nobody has to *remember* twenty spellings, they only have to type
one. The alias list costs the operator nothing.

What *did* cost them was that any of those twenty words matched **anywhere
inside a bracket**, which is bug 2.1. With that fixed, the vocabulary a person
must hold shrinks from "twenty magic words that can appear anywhere in a
bracket, in a description you have also been told to write notes in" to **"six
tags, written on their own"** — which is what the guide always claimed.

Two further observations, not acted on:

- **Three of the six are also checkboxes** on the dashboard (`Club`,
  `No_Registration`, `Personalized_Assistance`), which is a second way to say
  the same thing, backed by a queue tab and an edit trigger
  (`SYSTEM_REVIEW.md` §12e catalogues the five ways that can go wrong). The
  checkboxes are the *better* interface. If anything goes eventually, it should
  be the hand-typed spelling of those three, not the aliases.
- **`[Max Per Month: N]` only flags, it does not block.** A second booking in a
  month is recorded in `Admin_Notes` and the admin digest, not refused. That is
  probably right — refusing a real person at a form is worse than telling staff
  — but it is not what "Gerry does not want a person registered for more than
  one appointment a month" literally asks for. Worth a decision.

---

## 5. Are there better options that work mostly inside Google?

The honest answer is that **this system is already inside Google, and moving
any part of it out would be worse.** Calendar is the source of truth, Forms
collect, Sheets holds, Apps Script joins them, and there is no external
service, no Zapier, and no database. That is the right architecture for a
two-person office and it should not change.

Four alternatives were considered seriously:

**Calendar Appointment Schedules instead of the `[Personalized Assistance]`
slot engine.** This is the strongest candidate, and it is what the office calls
"Booking Calendar". Google's native booking pages do slot arithmetic, remove
taken slots, and hand the provider a real diary — replacing several hundred
lines here. Against it: bookings do not reach this workbook without Calendar
API reads and a mapping layer, custom questions are limited (Low-Cost Wills
needs a six-option dropdown that Heather can only fulfil three ways), and the
existing implementation already works and already feeds the sheet, which is the
entire point of the system. **Verdict: not worth swapping now.** Revisit if
appointment programs grow past a handful.

**One form per program forever, instead of one per month.** This is already
available — it is `[Grouped]` — and it is the answer to the website-button
question ("do the links change?"). Worth *recommending* per program rather
than changing the default, since `Regular` correctly stops January's sign-ups
piling up with December's.

**Splitting `Code.gs` into several files.** `SYSTEM_REVIEW.md` §16 already
proposes the right seam: pull the pure functions — parsing, date handling, row
building, label formatting — into their own file, because that subset is
testable off-platform and is where the subtle bugs live. Bug 2.1 is direct
evidence: it lived in a pure function, and a five-line test would have caught
it years earlier. This branch adds `tests/bracket_tags.test.js` as a fourth
test file; the suite now covers the bracket parser, the appointment maths, the
questions parser and the lunch-form horizon. **Recommended, and the highest
maintenance-value change available.**

**Moving to a real database / an app platform (AppSheet, a web app).** Rejected.
It would trade a system two people can inspect in a spreadsheet for one only
its author can. `SYSTEM_REVIEW.md` §13 is right that the spreadsheet-as-database
has real limits, and none of them bind yet.

---

## 6. What changed on this branch

| Commit | What |
|---|---|
| Stop a bracketed note from silently reconfiguring a program | Bug 2.1, plus `tests/bracket_tags.test.js` |
| Stop a background forms sweep shutting the sign-in desk | Bugs 2.2 and 2.3 |
| Put the day of the week on every date, and stop admin locking itself out | Bugs 2.4 and 2.5 |
| Let a program put a notice or a picture on its form, permanently | `Notice` and `Image` types on `Program_Questions` |
| Group the menu by the job, and make catching up one click | 18 top-level items → 3 + 4 submenus; `Update Everything Now` |
| Colour the tabs by what they are for | Four groups, in reading order |
| Document the new menu, the bracket rule, notices, images and link stability | `USER_GUIDE.md` |

The `Notice` and `Image` types answer the two remaining requests from the
office that had nowhere to go:

> *"Any form for T'ai Chi needs to contain the following disclaimer…"*

> *"Is there a way to add images and small touches to the forms that will stay?
> In the old forms, we were able to put headers in and/or images of the
> books/films/people."*

"That will stay" is the whole difficulty, and the reason both belong on
`Program_Questions` rather than on the form: anything typed onto a live form by
hand is deleted the next time that form is rebuilt. A row on that tab is
re-applied after every rebuild.

**Nothing on this branch changes data.** No tab is added, removed or re-keyed;
no column moves; no form is rebuilt as a consequence of any of it. Install it
the ordinary way — paste `Code.gs`, reload, run **🔧 Admin ▸ 🧱 Rebuild
Layout** — and the only visible differences are the menu, the tab colours, the
day names on dates, and brackets that hold sentences no longer doing anything.

---

## 7. Recommended next, in order

1. **Check the live calendars for bracketed notes** that were being read as
   tags. Anything that reads as prose now stops taking effect, which is
   correct — but if a program has been quietly running as a club or with no
   form because of one, that changes back on the next sync. The log names every
   bracket it declines.
2. **Decide `[Max Per Month: N]`**: flag, or refuse?
3. **Add a "schedule this request" action** to `Assistance_Requests` (§3).
4. **Split the pure functions into their own file** and grow the test suite
   (§5). Highest maintenance value.
5. **Then, in a quiet month, merge `Deleted_Event_Triage` into
   `All_Registrants`** as a status (§3).
