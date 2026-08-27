# Calendar & Form Manager — User Guide

This system turns **Google Calendar events into registration forms**, and turns
**form responses into a catering order**. You mostly work in Google Calendar;
the spreadsheet fills itself in.

---

## The one-minute version

1. You create an event on one of the program calendars.
2. The system builds a registration form for it and pastes the link into the
   calendar event's description.
3. People register. Their answers land on the **Registrant_Dash**
   tab, one row per person per session.
4. **Master_Lunch_Dashboard** adds up who needs lunch each day so you know what
   to order.
5. On the day, print a **sign-in sheet** to mark up by hand, or use
   **⚡ Quick Mark** on the menu.

Everything runs on a schedule. You rarely need to press anything.

> **Setting this up for the first time — or on a calendar with a lot already
> on it?** Use **Import Everything (First Run)** in the menu instead of
> **Sync Cal**. See [First run](#first-run) below.

---

## Setting up your calendar events

This is the only "syntax" in the whole system, and it's the part worth getting
right.

**The title is just the program name.** That's what attendees see on a shared
calendar, so no settings go there.

**Everything else goes in the event description, in square brackets:**

| In the description | It means |
|---|---|
| *(nothing)* | A program with **no capacity limit**, grouped by month |
| `[Cap: 12]` | Capped at **12 people**; #13 is waitlisted automatically |
| `[Grouped]` | One continuous series — **one form** for the whole run |
| `[Regular]` | A **separate form per calendar month** (the default) |
| `[Cap: 12, Grouped]` | Both. `[Cap: 12] [Grouped]` on separate lines works too. |
| `[All Locations]` | This program's sessions at **every** location share **one** form |
| `[Club]` | People **join once and stay joined** — see [Clubs](#clubs) |
| `[No Registration]` | **No sign-ups at all** — no form is built — see [No registration](#no-registration) |

**A bracket is either all tags or all note.** You can write anything you like
in the description, including in brackets — a bracket is only read as settings
when the system understands **the whole of it**. Anything with ordinary words
left over is a note and is ignored completely:

| In the description | Read as |
|---|---|
| `[Club]` | the Club tag |
| `[Cap: 12, Grouped]` | both tags |
| `[Film Club selection: Casablanca]` | **a note.** Ignored — it is not a request for a club |
| `[Drop-in welcome]` | **a note.** Ignored |
| `[Combined with the JCC]` | **a note.** Ignored |

This matters because the tag words are ordinary English — *Club*, *Combined*,
*Shared*, *Regular*, *Appointments*, *Drop-In* — and you are asked to put
clarifying info in the description. Before this rule, a bracket only had to
*contain* one of those words: `[Film Club selection: Casablanca]` gave the
program a standing club roster, and `[Drop-in welcome]` deleted its
registration form, both silently.

If you meant a tag and the system decided it was a note, put the tag in a
bracket of its own: `[Club] [Film selection: Casablanca]`. The ignored bracket
is written to the log either way, so a mistyped tag doesn't just vanish.

**You don't have to type `[Club]` or `[No Registration]` by hand.** Both are
also **checkboxes** on the Master_Program_Dashboard — tick one and the tag is
written onto the program's calendar events for you. See
[The two checkboxes](#the-two-checkboxes-club-and-no_registration).

**Grouped vs Regular** — this is just "how many forms?":

- **Grouped** — one form for the whole run. Use it for something like a 6-week
  course, where one registration should cover every session.
- **Regular** — a new form each calendar month. Right for a drop-in weekly
  thing, so January's sign-ups don't pile up with December's. This is what you
  get if you say nothing.

> **These used to be called `Fixed` and `Monthly`.** Both old words still work
> everywhere — in descriptions and in the `Type_Tag` column — so there is
> nothing to go back and change. "Fixed" wasn't fixed in any sense you'd guess,
> and "Monthly" read as a claim about how often the program *meets*, which it
> never was: a `Regular` program can meet three times a week. The tag only ever
> said how often a **new form** is handed out.

**You can also change it from the spreadsheet.** Edit the `Type_Tag` column on
**Master_Program_Dashboard** (it's yellow, because it's yours to change). You'll
be asked to confirm, because switching re-partitions that program across forms —
and if you say yes, the system writes the tag into **every** calendar event for
that program, so the change sticks and all its months end up on the same footing.
Say no and the cell goes straight back to what it was.

> Older events with `[Cap: 12]` or `Fixed` in the **title** still work — the
> system reads them and logs a reminder to move them. New events should put
> everything in the description.

### One form across several locations

`[Grouped]` and `[Regular]` answer *"how many forms over time?"*. `[All
Locations]` answers the other question: *"how many forms across places?"*

Normally the same program at Narberth and at Ashbridge gets **two** forms —
they're two separate things that happen to share a name. Put `[All Locations]`
in the description and they become **one** program with **one** form and one
roster, wherever it meets. It combines with the other tags:

| In the description | It means |
|---|---|
| `[Grouped, All Locations]` | One form for the whole series, at every location |
| `[Regular, All Locations]` | One form per month, covering every location |
| `[Cap: 12, All Locations]` | Shared form — and the cap still applies **per session**, not across them |

`[Shared]`, `[All Sites]`, `[Combined]` and `[Multi-Site]` all mean the same
thing, so whichever you reach for works.

**What a shared form looks like to a registrant.** Every date says where it
is — *"Mon, Jan 5, 2026 · Narberth"* — so someone can sign up for Tuesday at
Narberth and Thursday at Ashbridge on one form. Lunch is still decided per date
and location: a Zoom date on a shared form simply never appears in the lunch
grid, and the lunch questions only come off the form when **none** of its
locations caters.

**The easy way to do it: `🔗 Link Program Across Locations…`** on the menu. Type
the program name, and it tags the events at every location for you *and* moves
the sessions already on the dashboard onto one form — pointing every upcoming
calendar event at it. Tagging by hand only affects dates that haven't been
imported yet, which is usually not what you want on a calendar that's already
running. Run the same menu item again on a linked program to unlink it.

> **Tag every location, or none.** An event that carries the tag joins the
> shared form; one that doesn't keeps its own. If you tag Narberth's copies and
> forget Ashbridge's, the system will do exactly that and tell you it did — it
> shows up in the log and in the admin email as "only partly linked".

> **What doesn't change:** capacity, waitlisting, lunch counts, the dashboards
> and the registrant list are all still **per session**. A shared form is one
> place to sign up, not one shared headcount.

### Clubs

`[Grouped]`/`[Regular]` answer *"how many forms?"*. `[All Locations]` answers
*"how many places?"*. `[Club]` answers a third question entirely: **does
signing up once keep you signed up?**

A club is a program with a **membership** rather than a series of one-off
sign-ups — the Thursday Book Club, the knitting circle. Put `[Club]` in the
description and three things change:

1. The registration form grows a **third** sign-up option:
   *"I want to sign up for all future Book Club meetings."*
2. Anyone who picks it lands on the **Club_Members** tab, and is booked into
   **every** session of that club from then on — including next month's, on a
   form that doesn't exist yet.
3. Staff can take somebody back off, at any time, by unticking one box.

It composes with everything else, which is the point of making it its own tag:

| In the description | It means |
|---|---|
| `[Club]` | A club, with a new form each month (the default span) |
| `[Club, Grouped]` | A club, one form for its whole run |
| `[Club, Cap: 12]` | A club with a per-session cap |
| `[Club, All Locations]` | One club that meets at more than one site, on one form |

`[Membership]` and `[Members Only]` read as the same tag.

**A club's roster follows the PROGRAM, not the form.** That's what makes a
`[Club, Regular]` work: January's form and February's form are different forms,
and the same people are on both without anyone re-registering.

**Adding `[Club]` to a program that already has dates works.** The next
**Sync Cal** updates the `Club` column on every one of its sessions — you don't
have to wait for a new date to appear.

**Taking someone off a club** — the reason the tab exists. Nobody re-opens a
registration form to un-sign-up, so the off switch has to live where staff are:

1. Open **Club_Members**.
2. Find their row and untick **Active**.
3. You'll be asked whether to cancel the bookings that membership has already
   made for upcoming sessions. **Yes** marks those rows `Cancelled` (never
   deleted) and takes them out of the catering counts; **No** leaves those
   dates alone and simply stops renewing.

Re-tick **Active** and they're booked back in on the next sync.

> **A member who signs up through a form again comes back on**, even if you'd
> made them inactive — that's them asking, in the only way a form lets them ask.
> It's reported in the admin email so it's never a silent surprise.

### No registration

Some of what you run takes no sign-up at all: a drop-in coffee hour, an open
art room, a lobby concert. Those events still belong on the calendar and on the
dashboard — staff want to see what's on today — but a "📝 Register for…" link
on them is worse than nothing, because it tells people to sign up for a list
nobody is keeping.

Put `[No Registration]` in the description (or tick the **No_Registration** box
on the dashboard) and:

1. **No form is ever built** for the program.
2. Its dashboard rows still appear, with `— no registration —` where the form
   link would be.
3. If it *already had* a form, the registration link is **removed** from its
   calendar events and the form **stops accepting responses** on the next sync.
   The form and everything in it are kept.

`[No Signup]`, `[No Sign-Up]`, `[Registration Not Required]` and `[Drop-In]`
read as the same tag.

**It's reversible.** Untick the box (or delete the tag) and the next **Sync Cal**
re-opens the form, puts the link back on the calendar events, and restores the
links on the dashboard. Only a form this system closed is re-opened — one you
closed by hand in the Forms editor stays closed.

**Registrations already collected are never touched.** Turning registration off
stops new sign-ups; it doesn't erase the people who already signed up. To remove
those, use [🗑️ Delete Registrations…](#deleting-registrations).

### Personalized assistance (appointments)

Some programs aren't a room full of people at one time — they're one visitor
sitting with one provider for twenty or thirty minutes, and then the next one.
Computer Help with Gerry or with Kathy, Low-Cost Wills with Heather, Medicare
counseling. A "12:30–3:30 Low-Cost Wills" event isn't one session for twelve
people; it's six appointments.

Tag those programs `[Personalized Assistance]` in the event **description**.

```
[Personalized Assistance]
[Personalized Assistance, Slots: 20]
[Personalized Assistance, Slots: 20, Max Per Month: 1]
```

`[By Appointment]`, `[Appointments]`, `[1-on-1]` and `[One on One]` read as the
same tag. So does `[Slots: N]` on its own — asking for slots says the program is
appointment-based.

**What changes:**

| | Ordinary program | `[Personalized Assistance]` |
|---|---|---|
| What you register for | a **date** | a **time on a date** |
| The form asks | which dates, who's coming, who eats | which appointment time, and whether they'd take an earlier one |
| Capacity | `[Cap: N]`, or unlimited | **one person per slot** — so however many slots fit in the event. A *smaller* `[Cap: N]` still wins (keep the last half hour free); a bigger one is ignored, because a slot has no second chair |
| Lunch | asked, if the date serves it | never asked |
| Roster grids / "every date" / club option | yes | no — they don't mean anything for an appointment |
| Guest questions | yes | **yes** — "individual or couple" is a real answer for a will |

**Slots are back-to-back.** The event's start-to-end span is cut into
appointments of `[Slots: N]` minutes (30 if you don't say), with no gaps. A time
somebody has booked **disappears from the form**, and the remaining times are
offered earliest first — so the afternoon fills from the front on its own, which
is what stops a provider being handed a schedule with holes in it. A partial
slot at the end is never offered.

**One person per slot, automatically.** You never type a cap on an appointment
program: a slot holds one person, so the session's `Max_Capacity` on
`Master_Program_Dashboard` is simply its number of slots — a 12:30–3:30 clinic
in 30-minute slots shows **6**. Ticking `Personalized_Assistance` on a program
whose dates are already on the dashboard updates those rows on the next
**Sync Cal**; you don't have to wait for its next new date. Put `[Cap: 4]` on
the event if the provider wants to see fewer people than the span allows —
anything *larger* than the slot count is ignored and logged, since it would be
offering times that don't exist.

**Nobody can book the same time twice.** In the rare case where two people
submit inside the same few minutes, neither is dropped: the second one is
booked and flagged in `Admin_Notes` — *"Double-booked: … already holds …"* — and
named in the admin digest so somebody moves one of them.

**"None of these times work."** Every appointment form ends its time list with
that choice. Picking it books nothing and files the person on the
**Assistance_Requests** tab instead, with their name, phone, email and answers.
That's how a counselor who comes in *when there's demand* gets their demand,
months before a date exists — and how you register somebody without inventing a
calendar event to attach them to. Work the tab, and when you've agreed a time,
put the event on the calendar and add them the normal way (or by hand on
Registrant_Dash).

**`[Max Per Month: 1]`** — for a provider who won't see the same person twice in
a month. A second booking is **flagged, not refused**: the row is created and
says so in `Admin_Notes`, and it's in the admin digest. A form can't be certain
two Jane Smiths are the same person, and staff sometimes make the exception on
purpose, so the system tells you rather than silently throwing a registration
away.

**"If an earlier appointment opens up, may we call you?"** Every appointment
form asks this, directly under the time question. These bookings run months
ahead, and two people who both pick November want opposite things: one is
holding out for November because that's when her daughter visits, the other
took the first date on the list and would drop everything for next week.
Without the answer, filling a cancellation means ringing down the list asking
everybody.

- **It's optional, and blank means no.** Somebody who skipped the question has
  not agreed to be telephoned. Only a *yes* puts them on the call list.
- **The answer lands in `Earlier_Appointment` on Registrant_Dash**, which is
  **yours to edit** — a yellow column with a dropdown. That's the common case:
  people say it on the phone, not on a form. Type it in whenever you hear it.
- **At the desk**, the Quick Mark tick **☎️ Call them if an earlier appointment
  opens up** appears beside the appointment time. Ask while you have them on
  the phone.
- **When something falls through**, open **🗓️ Personalized Assistance
  Schedule…**. Under the provider's list is **☎ Would take an earlier
  appointment** — everyone who said yes, with their phone number, **furthest-out
  booking first**, since they have the most to gain from the slot that just
  opened. The same ☎ marker appears beside their name on the provider's list,
  because the provider is often the one who hears about a cancellation first.
- **Moving somebody** is still done by hand: book them into the free time (Quick
  Mark, or edit the row) and cancel the old one. Nothing moves anybody
  automatically — an appointment is an arrangement with a person, and it changes
  only after they've said yes on the telephone.

> **This used to live in the old form's "Confirmed Date/Time?" column**, as a
> note typed in beside the confirmation. It's a column of its own now so it can
> be sorted, filtered, and turned into a call list.

**Sending the provider their list.** **🗓️ Personalized Assistance Schedule…**
in the menu shows every upcoming appointment — by program, by day, in time
order, with names, phone numbers, emails and each person's answers. Select it
and paste it into the email. That's the whole point of the tag: Heather and the
Medicare counselors need names against times a week ahead.

**Booking one yourself.** People ring up for these far more often than they
fill in the form, so the front desk can book a chair directly: **⚡ Quick Mark**,
pick the session, pick the **Appointment time**, tick **Register them for this
session** (and **☎️ Call them if an earlier appointment opens up**, if they say
so). The time comes off the live form immediately. See [Booking an appointment
at the desk](#booking-an-appointment-at-the-desk).

**It's reversible.** Untick the box (or remove the tag) and the next sync
rebuilds the form as an ordinary date-based one. Appointments already booked
keep their times on Registrant_Dash.

**If a form doesn't look right** — no times on it, or it still offers *"I want
to sign up for all events this month"* — run **📝 Programs & Forms ▸ Rebuild
Appointment Forms + Report…**. It reshapes every appointment form on the spot
instead of waiting for the hourly pass, and reports:

- every program the workbook currently treats as an appointment program, and
  how many of its sessions are marked (a program with only *some* sessions
  marked is called out — the rest are offered as ordinary sign-ups);
- every program that is **not** marked, so you can see at a glance whether the
  tick actually landed;
- how many free times each form is offering, out of how many upcoming
  sessions, and whether the form needed changing.

The two reasons a form offers no times are named as such by that report: every
session on it is in the **past** (add the next dates to the calendar and run
Sync Cal), or every slot is **booked** (cancel a row to free one). Neither is a
failure of the form.

> **What changed here.** The hourly pass used to *add* the appointment question
> to a form without taking the date-based questions off it. A program that
> became `[Personalized Assistance]` *after* its form was built therefore ended
> up carrying both shapes: the old "all events this month" option was still the
> first thing people saw, and picking it jumped straight to the end of the form
> — so the appointment times, sitting on the other branch, were never reached.
> The hourly pass now reshapes the whole form, exactly as a rebuild does.

### Merging half-hour blocks

A provider's afternoon usually gets typed the way a paper diary is written —
one calendar event per appointment:

```
12:30–1:00   Low-Cost Wills
 1:00–1:30   Low-Cost Wills
 1:30–2:00   Low-Cost Wills
 2:00–2:30   Low-Cost Wills
```

**That cannot work, and it will not tell you so.** A session is identified by
its calendar, its name and its **date** — there is no time in it anywhere. So
all four of those events are *the same session*: the dashboard shows **one row**
whose start and end are whichever block the last sync happened to write, the
capacity is one session's worth rather than four, and the form offers the day
rather than the times. Three of the four events are invisible to the system,
quietly fighting the fourth over one row.

The shape that works is the one `[Personalized Assistance]` was built for: **one
event covering 12:30–2:30**, tagged with how long an appointment is, cut into
slots by the form.

**📝 Programs & Forms ▸ ⏱️ Merge Half-Hour Blocks…** converts one into the
other. It lists every day on the calendar that has two or more back-to-back
events of the same name, with how many blocks and how long each one is. Tick the
ones to merge and pick what they are:

| Choice | What you get |
|---|---|
| **These are appointments** | One event covering the whole span, tagged `[Personalized Assistance, Slots: N]` with N taken from the blocks themselves. Its form asks for a **time**, drops each one as it is taken, and packs the day from the front |
| **Just one longer event** | One event of the right length and nothing else — for a three-hour class somebody typed in half-hour pieces |

**Registrations are not affected.** The merged event keeps the same name, date
and calendar, so anybody already registered stays registered for it — the
session it points at does not change.

The first block is the one kept; the others are deleted from the calendar. That
is the only irreversible part, so it happens **last**, after the surviving event
has successfully grown, and the dialog names every event that will go before
anything is touched.

**What it refuses to merge**, because none of these is a diary:

- events that **overlap** — two things genuinely running at once, or a duplicate;
- a gap longer than a comfort break (over 15 minutes) — that is two separate
  things on one day;
- blocks longer than 90 minutes — a double session, not an appointment;
- a **tentative** `*` event — it is not confirmed yet, and merging it would
  confirm it on your behalf.

Run **🔄 Update Everything Now** afterwards so the forms catch up.

---

### Reviewing your appointment months

The question anybody actually asks about an appointment program is not "is this
program set up correctly". It is:

> **Does the September form at Narberth offer every September date, and every
> appointment on every one of those dates?**

That is a question about a **month at a place**, because a month at a place is
what one form covers. **📝 Programs & Forms ▸ 🗓️ Review Appointment Months…**
walks exactly those — one program-month per screen — and answers it.

Each screen shows every date in the month with the time the sheet has for it,
how many appointments that cuts into, how many are booked, how many are free,
and which form it is on. Underneath, in words, what is wrong with it:

| It says | Because |
|---|---|
| **The month is spread across two forms** | Both links work. Whoever follows one of them sees half of September and has no way to know about the rest |
| **The sheet's times are not the calendar's, and N appointments are hidden** | Slots are cut out of the *sheet*. Lengthen an event on the calendar after its date was first written and the row still says the old span, so the form goes on offering one appointment per date |
| **This day is still several back-to-back events** | They all collide onto one session (see [Merging half-hour blocks](#merging-half-hour-blocks)), leaving duplicate rows and repeated times |
| **The form these dates are on also carries another month, or another program** | Handed out as "the September form", it offers times running into October — or files one program's registrants under another's name |
| **The dashboard and the calendar disagree about whether this is an appointment program at all** | The calendar wins on the next sync, so a tick that never reached it is quietly thrown away |
| **Two different appointment lengths in one month** | Usually a `[Slots: N]` typed onto some events and not others |
| **Every date has passed / every appointment is booked** | Both produce a form with no times on it, and both are *correct* — said in words so they don't look like a failure |

And the fixes are on the same screen. Tick the ones you want and move on; nothing
is done until you press **Apply & Update**:

| Fix | What it does |
|---|---|
| **Merge each day's back-to-back events** | The same conversion as ⏱️ Merge Half-Hour Blocks, scoped to this month |
| **Take the times from the calendar again** | Rewrites `Event_Date` and `Event_End` from what the calendar says now, so the slots come out right |
| **Set one appointment length** | Writes `[Slots: N]` onto this month's calendar events and updates its rows — the calendar first, because the calendar is what the next sync reads |
| **Put every upcoming date on ONE form** | Either an existing form (by default the one most of the month is already on, so the fewest handed-out links break) or a new form built for this month |
| **Move one date** | Repoints a single date onto another form, by ID or edit URL — for a session that belongs somewhere else entirely |
| **Remove the duplicate rows** | Tidies the extra rows a day of separate blocks left behind. They share an Event_ID with the row that stays, so nothing that pointed at those sessions moves |

**Apply does everything in the order that makes it work**: the calendar first
(merges, then appointment lengths), then the sheet's times, then the duplicate
rows, then the forms — one sync, and finally the appointment questions
themselves rewritten on every affected form. Pressing Apply twice is safe: a
merged day has no blocks left to merge, and a retimed row already matches.

**You do not have to run this to be safe.** Every sync now brings a session's
times back into line with the calendar on its own, and a day still typed as
several events reads as the whole span it covers rather than as whichever block
happened to be written last. This screen is for seeing what is true, and for
the fixes a sync cannot decide on your behalf — which form a month belongs on,
and how long an appointment is.

---

### Reviewing your programs

Every rule in this system is enforced *on the way in* — when a sync runs, when
you tick a box, when a form is rebuilt. None of them is enforced on the way
**out**. So after a season of editing — a program renamed, a tag typed by hand,
a form rebuilt on Tuesday and re-split on Thursday, a day of appointments
entered as seven half-hour blocks — nothing anywhere tells you which of your
forty programs are still in the state you think they are.

The workbook looks fine. The dashboard is full of rows. The forms all open.

**📝 Programs & Forms ▸ 🔍 Review Programs, Then Update Once…** walks them a
screen at a time and states, for each one, what ought to be true — then says
whether it is.

| It checks | Because |
|---|---|
| The sheet and the calendar **agree about what kind of program this is** | The calendar wins on the next sync. A tick that never reached it is quietly thrown away, and nothing says so |
| **Every one of its calendar events says the same thing** | One tagged event tags the whole program — so a half-tagged program already behaves as fully tagged while *looking* like a deliberate distinction between its dates |
| It has **as many forms as its kind implies** | One for a series, one per month for a monthly, none for a drop-in. Extra forms are what a re-split leaves behind, and the symptom is people registering on a link covering half the dates the newsletter advertised |
| Its calendar events **carry a register link**, or deliberately don't | The link is what the public uses. An event with a form and no link is a program nobody can find |
| An appointment program has a **slot length**, and its day is **one event** | See [Merging half-hour blocks](#merging-half-hour-blocks) |
| It is shared across locations **everywhere or nowhere** | A half-shared program has two forms and neither covers all its dates |
| Every session row has an **event behind it**, and every event has a **row** | A row with no event is a date people can register for that nobody is running; an event with no row is a date nobody can register for at all |
| The **capacity arithmetic** adds up | People waitlisted while other dates have seats free; more registered than the room holds |

Each answer is a ✅ or a sentence saying what disagrees with what, and where
there is one, **the fix is offered right there**.

#### You decide as you go; everything is applied once, at the end

Nothing you do on this screen is written when you do it. Picking a kind,
choosing to merge a day of half-hour blocks, marking a program reviewed — all of
it is *selected*, and a purple bar at the bottom tells you what is waiting:

> **Selected, not yet applied:** 6 kind change(s), 1 merge(s), 12 mark(s).
> Nothing has been written yet — press Apply and it is all done in one pass.
> *Discard selections*

Then **Apply everything & update** does the lot in a single pass: every calendar
retag, every merge, and then **one** update of the sheet, the calendar and the
forms. That last part is the slow bit — a minute or two — and this way you wait
for it **once** instead of once per program.

This matters more than it sounds. Every fix here ends in the same place: a few
calendar writes, then a sync to rebuild the form behind them and rewrite the
"register here" links. Doing that per program meant sitting through forty full
updates to make forty decisions, and each of those updates re-read every
calendar and every form in the workbook to publish the effect of one retag. The
work is the same either way — only the waiting multiplies.

If nothing is selected, the button says **Update everything now** and simply
runs that same update.

> **Changed your mind?** Pick the kind it already is, or press *undo* next to a
> selection, and it comes off the plan. *Discard selections* clears the lot.
> Nothing has been written, so nothing has to be undone.

**Three filters at the top:** *Needs attention* (the default — only the programs
with a ❌ or a ⚠️), *Not yet reviewed*, and *All*.

**Marking a program reviewed records what was true when you looked at it.** If
the calendar moves underneath afterwards, the mark says *"reviewed, but it has
changed since"* rather than going on claiming the program is fine. On a workbook
several people edit, a mark that can quietly become a lie is worse than no mark
at all.

> **It is fast because it opens no forms.** The whole review is the dashboard
> rows plus one pass over the calendar, and the result is handed to the dialog in
> one go — so *Next* is instant. The decisions go back the same way: all at once,
> when you press Apply.

#### Which program is on which form

The second tab, **Which form is each program on?**, reads the same facts the
other way round: one row per form, and everything registering through it. The
dialog switches to it automatically once an update finishes, because it is the
one screen that answers *"did that leave two links for the same sessions?"*

Read down the first column. Two names in one cell means two programs sharing a
sign-up. Above the table, three overlaps are called out by name:

| It says | What it means |
|---|---|
| ❌ **A month split across two forms** | Sessions of one program in the same month sitting on different forms. Two links were handed out for what people think of as one thing, so half the sign-ups land somewhere the person holding the other link can't see. **Move Sessions to Another Form…** puts them back on one |
| ❌ **One form, two differently-named programs** | One program's registrants are being filed under another's name — almost always a repoint that took the wrong rows with it |
| ⚠️ **One form, one name, two locations** | How a cross-location sign-up is *meant* to work. Listed so you can confirm it's deliberate, not because it's wrong |
| ⚠️ **The calendar points somewhere else** | An event description advertising a form your session rows don't use — so the link the public follows and the form this workbook reads are different forms. An update rewrites the event links |

Rows are tinted: red where two different programs share a form, amber where one
program shares one across locations. The form ID links straight to the form's
edit page.

> **This costs nothing.** It is built from the review that was already gathered,
> and — like everything else here — it opens no forms.

#### One kind instead of four checkboxes

`Type_Tag`, `Club`, `No_Registration` and `Personalized_Assistance` are four
separate controls, and they interact in ways nobody holds in their head:
appointments make the Grouped/Regular choice irrelevant, no-registration makes
all three of the others irrelevant, and Club with No_Registration is a
contradiction the sheet will happily let you enter.

The review asks the question the other way round — **what kind of program is
this?** — with six answers:

| Kind | What it means |
|---|---|
| **Monthly sign-up** | The ordinary case. A fresh form each calendar month, so the dates and menu stay current |
| **One form for the whole series** | A course that runs to an end. Every date shares one form |
| **Club — join once, monthly form** | People sign up once and stay signed up. A new form each month; the roster carries across it |
| **Club — join once, one form for the series** | The same standing membership, on a single form for the whole run |
| **Appointments — book a time, not a day** | One visitor at a time. Each event is cut into back-to-back slots and the form asks which one |
| **Drop-in — no registration at all** | Shows on the dashboard, gets no form and no "register here" link |

Each of the six is exactly a setting for all four of the old controls, so
**nothing underneath changed** — same tags, same calendar stamps, same columns,
and a workbook you've been editing by hand goes on working. Choosing one selects
it; when you press **Apply everything & update**, all four are written out to
**the calendar first** (which is what makes a change stick), then onto the
dashboard, and then the update rebuilds the form in its new shape.

---

### Extra questions on one program's form

Every registration form is built from one template, which is what keeps the
system able to read the answers. That used to mean a program that needed to ask
something of its own — a zip code, whether somebody's a member, which document
they need drawn up — had nowhere to put it. Typing the question onto the live
form worked until the next update rebuilt that form and **deleted it, along with
the answers**.

So extra questions live on the **Program_Questions** tab, one row per question,
and the system puts them back on the form every time. Add a row:

> **The quickest way in is the builder.** **📝 Programs & Forms ▸ ➕ Build a
> Form Question…** asks for one question at a time, shows only the fields that
> kind of question actually uses, **uploads a picture for you** if the row is
> one, and — the part the tab cannot do — tells you **which forms it would land
> on, by name**, before you commit to it. It writes the same row you would have
> typed, and can push it to the forms on the spot.
> The tab below is still the right place to edit twenty of them.

| Column | What to put |
|---|---|
| `Program` | **pick from the dropdown** — it lists every program on the dashboard, spelled the way the calendar spells it. `*` (or blank) = every form in the workbook |
| `Location` | dropdown of your locations. `*` or blank = everywhere |
| `Match_Keywords` | the other way to aim a row — **by word rather than by exact name**. One per line (or separated by `\|` or a comma), matched as text against every program title the form covers, its locations and its calendar tags. `wills` reaches *Low-Cost Wills* **and** *Wills & Estates Clinic*; `zoom` reaches everything online; `club` reaches every `[Club]` program. **Any one** keyword matching is enough, and this narrows **together** with Program and Location — Location `Narberth` plus keyword `wills` means the wills clinic at Narberth, not either. Blank = do not narrow by keyword |
| `Question` | the question as the registrant will read it |
| `Type` | `Short answer`, `Paragraph`, `Dropdown`, `Checkboxes`, `Multiple choice`, `Date`, `Time`, `Scale` — or `Notice` / `Image` / `Header image` / `Form description`, which show something instead of asking it (see below) |
| `Choices` | the options, **one per line** (or separated by `\|`), for `Dropdown` / `Checkboxes` / `Multiple choice`. For a picture row this holds the picture's Google Drive link instead (the builder fills it in for you); for a `Scale` row it holds the range and the end labels — `1-5 \| Not at all \| Very much` |
| `Help_Text` | the small grey line under the question. Optional — except on a `Notice` or a `Form description` row, where it is the wording people actually read |
| `Required` | tick to make it compulsory |
| `Sort` | the order the questions appear in. Optional |
| `Active` | untick to take the question off the form without deleting the row |

Then press **❓ Update Program Questions on Forms**, or wait for the next
**Sync Cal**.

**The three rows that show something instead of asking it.**

| Type | Where it lands |
|---|---|
| `Notice` | a block of words **in the middle of the form**, just above *Anything Else?*. `Question` is the bold heading (*"Please note"*), `Help_Text` is the wording. This is where a class disclaimer belongs |
| `Image` | a picture beside the last question, with `Question` as its caption |
| `Header image` | the same picture, **at the very top of the form** instead — above the first question. This is the one for a logo, a photo of the class, a book cover |
| `Form description` | wording added to the **top of the form**, above the first question, where it is read before anybody starts. `Question` only names the rule (it is not shown); `Help_Text` is what people read. *"Bring a photo ID"* belongs here; *"this class involves floor work"* is a `Notice` |

**Putting a photo on a form: choose it, and that's it.** In the builder, pick
`Header image` (or `Image`) and a file picker appears. Choose the photo on your
computer and it is uploaded, filed in a Drive folder called **Form Images**, and
its link written into the row for you — the six steps of *save it, open Drive,
upload, find it, Share, Copy link, come back, paste* are gone. You can still
paste a Drive link by hand if the picture is already up there.

A `Header image` is placed at index 0 of the form, above the first question.
That is as close to a banner as a script can get: Google's own form banner lives
in the form's *theme*, and neither Apps Script nor the Forms API can set it.

> **Uploading a photo does not share anything.** The form does not read the
> Drive file — the script fetches its bytes and puts a copy *into* the form. A
> photo on a public form is not a public Drive file.

> **The dropdowns reach the blank rows too**, so the row you are *about* to type
> into already has them. They used to stop at the last row that had something on
> it — which meant the one row that needed them never had them, and on a tab you
> had not used yet there were none at all.

> **Type the Program from the dropdown, not from memory.** It is matched against
> the calendar exactly: `Bookclub`, or a trailing space, and the question is
> asked of no form at all with nothing here to say so.

**Where the answers go.** Into one column, `Form_Answers`, on Registrant_Dash,
as `Question: answer | Question: answer`. Deliberately one column and not one
per question: a table whose columns changed every time somebody added a question
to any program is exactly the thing that breaks. It's also what the assistance
schedule shows the provider in its "Details" column.

**What it will refuse.** A question can't be given the same wording as one of
the form's own questions (`Name`, `Phone Number`, `Anything Else?`, `Guest 1
Name`…). Re-using one would make the answers to both unreadable, so the row is
skipped, a line goes in the log, and it's named in the admin digest. Re-word it
and it goes on. A dropdown with nothing in `Choices` is skipped the same way.

**Deleting the row, or unticking `Active`,** takes the question off the form on
the next update. Answers already collected stay on the rows they were collected
on. Only questions **this system** added are ever removed — anything you added
to a form by hand is left alone (and will still be lost the next time that form
is rebuilt, which is the reason to use this tab instead).

**Renaming a question is adding a new one.** The wording *is* its identity, so
changing it retires the old question and adds a new one; answers already given
to the old wording stay where they are.

#### Notices and pictures — the two types that ask nothing

Two of the `Type` values put something on the form instead of asking for an
answer. They exist for the same reason the rest of this tab does: **anything you
type onto a form by hand disappears the next time that form is rebuilt.** Put it
here and it comes back every time.

**`Notice`** — a block of words. The `Question` column is the bold heading, and
`Help_Text` is the wording underneath. This is where a class disclaimer belongs:

| Program | Question | Type | Help_Text |
|---|---|---|---|
| T'ai Chi | Please note | Notice | Rosalie sends emails to the class if there's a last-minute and important change, as well as occasional T'ai Chi educational material. They are sent as blind copies so email addresses are not shared. If you have questions or concerns, please contact New Horizons at 610 664-2366 or speak to Rosalie after any T'ai Chi class. |

**`Image`** — a picture: the book, the film, the speaker. Upload it to Google
Drive, use **Share ▸ Copy link**, and paste that link into `Choices`. The
`Question` column is its caption.

| Program | Question | Type | Choices |
|---|---|---|---|
| Film Club | This month: Casablanca | Image | https://drive.google.com/file/d/1AbC…/view?usp=sharing |

Both need something in `Question` — it is how the system finds its own item on
the form again, both to leave it alone and to take it off when you delete the
row. `Required` is ignored for both, since neither collects anything.

If the Drive link can't be read, the row is skipped and says so in the admin
digest, rather than the form quietly appearing without its picture. Make sure
the image is shared so that **anyone with the link can view** it.

For Caroline's four assistance programs the tab reads something like:

| Program | Question | Type | Choices | Required |
|---|---|---|---|---|
| Computer Help with Gerry | Zip Code | Short answer | | ✔ |
| Computer Help with Gerry | Are you a member? | Multiple choice | Yes / No / Not sure | ✔ |
| Computer Help with Gerry | What do you need help with? | Paragraph | | ✔ |
| Computer Help with Gerry | Virtual or in person? | Multiple choice | In person / Virtual | ✔ |
| Low-Cost Wills | Individual or couple? | Multiple choice | Individual / Couple | ✔ |
| Low-Cost Wills | Which document do you need? | Dropdown | New Will / Update Will / New Power of Attorney / … | ✔ |
| Medicare Counseling | Is there a specific issue you need help with? | Paragraph | | |

(one option per line in the real `Choices` cell)

### The three checkboxes: `Club`, `No_Registration` and `Personalized_Assistance`

All three tags are also **tick boxes** on the Master_Program_Dashboard, and
ticking one is exactly the same as typing the tag by hand — because that's what
it does.
**Ticking the box is the only step.**

1. You tick the box on any one of the program's rows.
2. Every other row of that program ticks itself to match, immediately — all its
   dates, past and upcoming, and its rows at the other locations if it's on one
   shared form. A flag belongs to a program, not to a date.
3. Within a few seconds the tag is written into the **description of every
   calendar event** of that program, which is where the system reads it back
   from.
4. The next **Sync Cal** applies the consequences: the form gains its club
   option, the program stops taking registrations, or the form starts asking
   for an appointment time instead of a date.

Untick to reverse, on the same terms. There's no "are you sure?" — a checkbox
is already the question and the undo — and the toast says what happened.

**Why it can't be lost.** A cell edit isn't allowed to write to a calendar
directly (Google's rule, not ours), so the tick is written to a hidden
`_Pending_Tag_Changes` tab the instant you click, and stays there until a
calendar has accepted it. While it's queued, **nothing overwrites your box** —
not a sync, not a calendar change, not the daily run. This is what makes the box
stay ticked while the write is on its way.

> **Ticks land in seconds only if the edit trigger is installed.** Run
> **🔧 Admin ▸ Check Triggers** once on a workbook to install it (it's part of
> the normal trigger set, and **Trigger Status** tells you if it's missing).
> Without it nothing is lost — the tick sits in the queue and the next
> **Sync Cal** delivers it. **📝 Programs & Forms ▸ Push Dashboard
> Ticks to the Calendar** pushes the queue through by hand at any time.

**Tentative events** — start the **title** with `*`:

| Title | Result |
|---|---|
| `Yoga Basics` | Normal — gets a form |
| `*Yoga Basics` | **Tentative** — no form, no dashboard row |

Use it while a date is still being confirmed. Remove the `*` and the event flows
through normally on the next sync and gets its form.

**Use the same `*` to mark a session that ISN'T happening.** If you cancel one
week of a recurring program, put a `*` in front of whatever you'd normally call
it — `*NO Tai Chi`, `*Tai Chi — cancelled` — and leave the event on the
calendar. Staff and anyone sharing the calendar can see the week is off, while
the system skips it entirely: no form, no dashboard row, no lunch on the
catering plan for that date. That's what the asterisk is for in general — *"on
the calendar, but not a session."*

> Removing the `*` is safe and creates no duplicates. Re-adding a `*` to an
> event that *already* has registrations does **not** delete anything — existing
> registrations are kept.

**The registration link** appears in the event description automatically, as a
clickable "📝 Register for …" link. Leave it alone; the system keeps it current.

---

## The tabs

Twelve tabs is a lot to meet at once, so **the tab colours group them** — in
the order they are worth looking at, left to right along the bottom of the
window:

| Colour | Group | Tabs | What they are |
|---|---|---|---|
| 🟩 green | **Today** | Master_Program_Dashboard, Master_Lunch_Dashboard, Lunch_Roster, Registrant_Dash | What a serving day is run from. These are the ones to open |
| 🟦 blue | **Set up** | Lunch_Schedule, Config, Program_Questions | What you fill in ahead of time: the menu, the settings, the extra questions a form should ask |
| 🟨 yellow | **Standing lists** | Member_Roll, Club_Members, Program_Options, Assistance_Requests | Lists that outlive any one session — who the members are, who is in which club, who is waiting for an appointment |
| ⬜ grey | **Archive** | Deleted_Event_Triage | Where things go when they stop being current |

**Which cells may I type in?** That is a question about *columns*, not tabs, so
the colour doesn't try to answer it. The workbook answers it on the cells
themselves: **a yellow column header with a ✍️ in it is yours**, and everything
else is rebuilt. Type in a rebuilt column and your work is lost at the next
sync — most tabs will warn you at the moment you try.

The one tab with **no** editable columns at all is **Lunch_Roster**: it is
rebuilt from scratch every hour, names and all. To add somebody to the lunch
list, use **⚡ Quick Mark**.

### 1. Master_Program_Dashboard
Your at-a-glance view. Three sections stacked top to bottom:

- **📍 Today at Each Location** — what's running today and how many are signed up
- **📈 Program Participation Metrics** — totals and average fill rate
- **🔜 Upcoming Sessions / 🕓 Past Sessions** — every session, with links

The **Status** column is computed for you:

| Status | Meaning |
|---|---|
| 🟢 Unlimited | No cap set on the event |
| 🟢 Open | Plenty of room |
| 🟡 Almost Full | Within the last 15% of seats |
| 🔴 Waitlist Only | Full — new sign-ups are waitlisted |

**Column order.** `Active_Count` sits right next to `Status` — how many signed
up and whether it's full is the pair you read first. The three **capacity**
columns are at the **end** of the visible row:

`Max_Capacity` · `Waitlist_Count` · `Remaining_Seats`

Most programs here are uncapped, so all three are blank on most rows; sitting
between the count and the status they were three columns of nothing pushing the
form links off the screen.

**This whole tab is rebuilt from the calendar on every sync.** Don't hand-edit
it; your changes will be overwritten (you'll get a warning if you try). If a
session is wrong here, fix the calendar event.

**The exceptions are `Type_Tag`, `Club` and `No_Registration`** — those three
*are* yours to change, and changing one writes back to the calendar so it
sticks. `Type_Tag` is a dropdown; `Club` and `No_Registration` are checkboxes;
each has an "are you sure?" behind it rather than a yellow cell, because each
always already holds a real value and marking them as blanks-to-fill-in would
have read as columns of problems. See
[Grouped vs Regular](#setting-up-your-calendar-events),
[The two checkboxes](#the-two-checkboxes-club-and-no_registration), and
**Push Dashboard Ticks to the Calendar** if a change doesn't stick.

| Column | Tick it to |
|---|---|
| `Club` | Make this program a club — people sign up once and stay signed up ([Clubs](#clubs)) |
| `No_Registration` | Stop this program taking sign-ups at all ([No registration](#no-registration)) |

`Form_ID`, `Event_ID`, `Calendar_Source` and `Calendar_Synced?` are **hidden** —
internal plumbing, kept after the capacity columns at the far right. The "View
Live Form" link you actually hand out stays visible.

### 2. Master_Lunch_Dashboard
What to order. Three blocks stacked top to bottom, and the first two stay
frozen on screen while you scroll:

1. **🥡 Lunch Sign-Up Forms** — the links to hand out (see below).
2. **Today's Lunch Needs**.
3. The full schedule, split upcoming/past.

#### The pinned sign-up links
The very top of the tab is the **lunch-only sign-up form** for each location
and month: `Location · Month · Lunch_Dates · Sign_Up_Link · Edit_Form`.
Right-click the link, copy it, paste it into an email or the website. It's at
the top of this tab because this is the tab whose subject is lunch, and "can
you send me the lunch link" is a thing staff get asked at the desk and on the
phone.

You don't create these. Put a `Hot` or `Cold` row on
[Lunch_Schedule](#5-lunch_schedule) and the form for that month builds itself
on the next **Sync Cal** — or immediately, via
**🥡 Build / Refresh Lunch Sign-Up Forms** on the menu. Until there's a catered
date the block says so rather than sitting empty.

Only the **four soonest** location/month forms are pinned, with a line saying
how many more there are. Everything above the schedule is frozen, so each
pinned row is a row of screen the schedule doesn't get; the later months are
on **Master_Program_Dashboard** like every other form, on any
`Lunch @ …` row.

See [The lunch-only sign-up form](#the-lunch-only-sign-up-form) for what
registrants see and how it reaches the counts.

**What appears here.** Every **upcoming** date and location where lunch is on
the table, **even with zero registrants**, so you can plan ahead and enter
buffers before anyone signs up. Two things put a date on this tab:

1. **A `Hot` or `Cold` row on Lunch_Schedule.** If the menu says food is
   happening that day, the date is here — **whether or not a program runs**.
   A drop-in lunch, a holiday meal, or a day whose calendar event hasn't been
   made yet is still a meal somebody has to order.
2. **An upcoming session**, where that location's **Lunch Service** in Config
   allows it. This is what shows you programming that has no menu set yet —
   and what keeps Zoom (which never serves lunch) from adding a blank row for
   every session it runs.

A `Not Serving` menu row removes the date — see
[Not Serving](#not-serving--closing-the-kitchen-for-a-day).

> A **`Hot`/`Cold` menu row beats the location's policy**, because it's a
> deliberate statement about one specific date and the policy is only a
> default. The exception is a location set to **Never**: a menu row there is a
> contradiction rather than a decision, so the date is left off and it goes in
> the admin email to be sorted out.

**Past dates are never added empty** — that would backfill a wall of blank
history. A past date appears only if someone registered for lunch or was
actually served.

The columns you read first are at the **front**:

| Column | What it means |
|---|---|
| `Registered_Count` | What the **forms** say — how many **meals** were asked for. Usually one per person; more when somebody has a standing order (see `Meals_Ordered` below) |
| `Served_Confirmed` | What **actually happened** — how many **people** you ticked `Lunch_Served` for on the Registrants tab |
| `Total_to_Order` | Live formula: `Registered_Count + Standard_Buffer + Tester_Buffer` |

`Served_Confirmed` stays **blank** until something has actually been ticked —
a real `0` ("nobody came") and "not counted yet" mean very different things, so
it doesn't claim the first. It counts every tick, including walk-ins who never
registered.

> **`Registered_Count` counts MEALS; `Served_Confirmed` counts PEOPLE.** That
> difference is deliberate. What the kitchen orders is meals, and one person
> can be down for four of them — Joan orders four every lunch day and they are
> all hers. What a tick on `Lunch_Served` records is that a **person** was
> handed their food; how much of it they took is the four consumption counts
> beside it. [Lunch_Roster](#3-lunch_roster) shows both per person, which is
> where you reconcile them by eye.

> **Neither number counts form answers.** Somebody who signs up for
> Chair Yoga, Bingo and the Book Club on the same Tuesday and ticks "yes,
> lunch" on all three forms — which is the normal thing to do, because each
> form asks — is **one lunch on the order, not three**. Names are matched the
> same way they are everywhere else in the workbook, so `Jane Smith`,
> `jane smith` and `Jane  Smith` are one person. The merge is not silent: the
> `Requests_Merged` column on [Lunch_Roster](#3-lunch_roster) says how many
> extra requests each person made, so you can see it happened.
>
> A row with **no name on it** is never merged into another — an empty name is
> a blank guest box, not evidence that two rows are the same person, and
> guessing wrong there would leave somebody at the counter with no food.

> **Changing a `Program_Status` or `Lunch_Status` on the Registrants tab
> updates these numbers straight away** — you don't wait for the hourly sync,
> and you don't have to work out the new total yourself. A toast tells you what
> it became. (Ticking `Lunch_Served` doesn't trigger a recalculation: that
> happens dozens of times an hour at a sign-in desk, and `Served_Confirmed` is
> a record of what happened rather than a number you order against.)

`Day_1_In-Person` · `Day_1_Takeaway` · `Subs_In-Person` · `Subs_Takeaway` ·
`In_Fridge` are **not typed here any more** — they're totaled automatically
from the five per-person meal counts on the Registrants tab (see
[Registrant_Dash](#4-registrant_dash) below), the same
way `Served_Confirmed` is totaled from `Lunch_Served`. A cell only updates once
the Registrants tab actually reports a meal for that date+location — it never
gets blanked back out, so a number typed here before this existed (or on a date
nobody has logged counts for yet) is left alone.

**`Carried_Over`** sits with them and answers "how many of this day's meals
were eaten on a *different* day?" — portions of this batch that went out later,
counted here because this is the row with the `Actual_Ordered` to reconcile
them against. It is always **part of** the consumption columns beside it, never
an addition to them: a row reading *40 ordered · 14 takeaway · 8 carried over*
means eight of that fourteen left the building on a later day. It fills in by
itself from `Meal_Source` on the Registrants tab, and stays blank on every
ordinary day — see
[Registrant_Dash](#4-registrant_dash).

**`Standard_Buffer` and `Tester_Buffer` aren't typed here either.** They're
**read from Config** on every render, for that row's location and Hot/Cold type.
They used to be yellow hand-entry columns that were only ever written once, when
the row was first created — and written as `0` if nobody had registered yet,
which is why every upcoming date showed a zero buffer no matter what Config
said. Change a buffer in **Config ▸ 🍱 Meal Buffer Amounts** and every row
follows on the next render.

Columns with a **✍️ pencil and a yellow header are yours to fill in** — the
system never overwrites them. They sit **after** the numbers you order against,
because they're reconciliation detail and were pushing those numbers off the
screen:

`Actual_Ordered` · `Total_Consumed` · `Thrown_Away` · `Discrepancy`

…and the two **buffer** columns are at the **very end** of the row:

`Standard_Buffer` · `Tester_Buffer`

They're set once from Config and then rarely touched, so they've been moved out
of the way — but `Total_to_Order` still adds them, wherever they sit.

**Color:** the `Location` cell is shaded by location — Narberth light orange,
Ashbridge light green, Zoom lavender — the same as every other tab. The rest of
the row is left plain so the numbers read as numbers. `Event_Date` keeps its
month tint, `Lunch_Type` goes grey on `Not Serving`, the ✍️ columns keep their
yellow, and a hand-edited row's `Manual_Override` cell goes purple.

### 3. Lunch_Roster
**Who** is eating — one row per person, per date, per location.
`Master_Lunch_Dashboard` tells you how many meals to order; this tells you
whose they are. It's the list to hand the meals out against, and the list to
type into CoPilot afterwards.

| Column | What it means |
|---|---|
| `Event_Date` · `Location` | The meal this person is on |
| `Name` | As typed on the form, or as entered at the desk |
| `Lunch_Type` | `Hot` or `Cold`, taken from that day's menu row |
| `Meals` | How many meals **this one person** is down for. `1` for almost everyone; `4` beside Joan's name is her standing order, not four Joans |
| `Lunch_Served` | ✅ once you've ticked them off (in Quick Mark or on the Registrants tab) |
| `Registered` | ✅ if they asked in advance; `— walk-in` if they only turned up |
| `Requests_Merged` | Blank for almost everyone. `2` means they asked for lunch on **three** different program forms for this one day and are being ordered **one** meal |
| `Programs` | Everything they signed up for that day, so a merged row shows its working |
| `Phone` · `Source` | For ringing them, and which form they came in on |

**This tab is rebuilt from scratch on every sync — don't type into it.**
Anything you write here is gone at the next hourly pass. That's deliberate: a
second, hand-edited place a lunch registration could live is a second number
the kitchen can be given, and the first time the two disagreed nobody could say
which was right. Everything here is derived from the Registrants tab in the
same pass that produces the dashboard count, so **the names and the number can
never disagree**.

**To add somebody at the desk**, use **Quick Mark** (🍽️ menu). It writes a
real registrant row and they appear here on the next render — see
[Signing someone up for lunch at the desk](#signing-someone-up-for-lunch-at-the-desk).

Only people appear here. A catered day nobody has signed up for yet contributes
no rows — its `0` is on the dashboard, where a zero means something.

### 4. Registrant_Dash
One row **per person, per session** — guests get their own rows, not a note on
someone else's.

> **This tab used to be called `Lunch_and_Event_Registrants`.** It is renamed
> automatically the first time this version opens the workbook — the same tab,
> with every row, every column, all its formatting and all its history intact.
> Nothing to do, and nothing to move. The old name said what lands on the tab;
> the new one says what the tab is *for*, which is where you go to see and mark
> people.

#### ⚡ Quick Mark — the fast way to mark people off

**🗓️ Calendar & Form Manager ▸ ⚡ Quick Mark Attendance / Lunch…** — the first
item on the menu, because on a serving day it's the only one you need.

1. **Location** — pick from the dropdown.
2. **Session** — one entry per session, each naming its date, grouped into
   **Upcoming** (soonest first) and **Past** (most recent first): *"Chair Yoga
   · Wed, Sep 16"*. Every program at that location is offered, past and
   present, not just the ones somebody has already registered for. The list
   also includes the day's lunch — *"Lunch @ Narberth — Chx Parm · Wed, Sep
   16"* — for someone who came in only for the meal.
3. **Name** — the people registered for **that session** first, then
   **everyone else on Member_Roll**, then **➕ Someone not on this list…** for
   a name that's on neither.
4. Tick **Attended**, **Lunch**, **Sign up for lunch**, **Register them for
   this session**, or a combination, and press the button.

   On a `[Personalized Assistance]` session a fourth box appears between the
   name and the ticks — **Appointment time** — listing the chairs that are
   still free. See [Booking an appointment at the
   desk](#booking-an-appointment-at-the-desk).

The dialog stays open on the same session and clears just the name and the
ticks, so a queue of thirty people is one pick and one click each. Every mark
is listed underneath as it happens, so you can see what you've done.

> **The lists load once.** When the dialog opens it reads the sessions and the
> names in a single go — you'll see *"Loading the lists…"* for a moment — and
> after that every dropdown is instant, because the narrowing happens in the
> dialog rather than by going back to the sheet. It used to fetch a fresh list
> each time you picked a location and again each time you picked a session,
> which is a wait between every single selection.
>
> The trade is that the lists are a snapshot: somebody registering online while
> you're standing at the desk won't appear in them until you press the small
> **↻ reload** under the location box (or close and reopen). That can only ever
> mean a name is missing from a dropdown — marking is always checked against
> the live sheet — and **➕ Someone not on this list…** covers them anyway.

> **It used to be a band of cells at the top of this tab.** Every part of that
> was a fight with Sheets rather than with the job: the dropdowns were data
> validations rebuilt cell by cell, the feedback was one overflowing cell, the
> state lived in cells anyone could paste over, and a stray paste on row 3
> could fire a mark. The tables now start at **row 1**.

> **Why the dates.** The session list used to hold bare program names, so a
> tick meant "the nearest session" and nothing else — fine for marking somebody
> standing in front of you, useless for correcting last Thursday or marking
> someone off for a session two weeks out. Pick a dated entry and it marks
> exactly that session. Programs whose sessions have aged off the dashboard
> entirely still appear under **Any date (program only)**, and fall back to the
> nearest-session rule.

**What the ticks mean.** This is the whole vocabulary:

| Ticked | What it records |
|---|---|
| **Attended** | They were here. `Lunch_Served` is left alone. |
| **Lunch** *(alone)* | They got a meal but were **not** here — take-out. `Attended` is **cleared**. |
| **Attended + Lunch** | Here, and fed. Both are set. |
| **Sign up for lunch** | They **want** a meal on that date. Nothing is recorded as served, and `Attended` is left exactly as it is. |
| **Register them for this session** | They are **on the list** for that session. Nothing is marked — not attendance, not lunch. This is the phone call and the front-desk sign-up, with no form involved. |
| **…and every future session of it** | The same, plus a **standing place** on that program: they are booked into every future session of it automatically. See [Standing lists](#standing-lists--somebody-who-comes-to-everything). |
| **…and a lunch every time** | The standing place **with a meal on each of those dates**, not just on today's. For the many people who come to a class they never miss and stay for the lunch every time. |

**Lunch** and **Sign up for lunch** are the same fact at two different times —
already handed over, versus expected — so ticking one clears the other.

**…and a lunch every time** only appears once **…and every future session of
it** is ticked, and it arrives already ticked if you ticked **Sign up for
lunch** — because somebody signing a person up for lunch today *and* putting
them on every future session has usually described the whole arrangement, not
half of it. Untick it if you meant only today's meal.

#### Registering somebody at the desk or over the phone

Somebody rings up, or stops at the front desk, and asks to be put down for
Chair Yoga a week Thursday. You don't need to open the form and fill it in as
them:

Pick the location, pick **that Thursday's** session, pick or type their name,
tick **Register them for this session**, press **Sign up**.

That writes an ordinary registration — `Program_Status` = `Active`, nothing
marked attended, nothing ordered for lunch — flagged **Manually Added**, so no
future sync touches or removes it. They appear on the sign-in sheet, in the
session's count, and in the Quick Mark name list from then on.

- **Already on the list?** You're told so and nothing is written twice.
- **Want lunch too?** Tick **Sign up for lunch** as well; the date still needs
  a `Hot` or `Cold` row on Lunch_Schedule.
- **They're standing in front of you right now?** Tick **Attended** instead —
  that both registers them and marks them in, which is what a walk-in is.

#### Booking an appointment at the desk

`[Personalized Assistance]` programs — Computer Help, Low-Cost Wills, Medicare
counseling — are booked by **time**, not by date (see [Personalized
assistance](#personalized-assistance-appointments)), and people much prefer to
ring up or book the next one on their way out of this one.

Pick the session and an **Appointment time** box appears, listing the free
chairs earliest first — *"12:30 PM – 1:00 PM"*. Pick a name, pick a time, tick
**Register them for this session**, press **Sign up**.

- **The times already taken are not listed**, whether they were taken on the
  form or at the desk. It's the same list the form offers, built from the same
  two facts, so the desk and the public can never be handed the same chair.
- **The slot is checked again when you press the button.** If somebody took it
  online while the dialog was open, you're told so and asked to pick another —
  nothing is written.
- **A time just booked disappears from the dropdown**, so a queue of people is
  one pick each without reloading.
- **"Every appointment on this date is taken"** means exactly that. Free one by
  cancelling a row, or add another date to the calendar.
- **Filling a schedule you already keep on paper** is this, once per person:
  each booking takes that time off the live form, which is how you get an
  already-full October onto the system before the link goes out.
- **☎️ Call them if an earlier appointment opens up** sits under the time box.
  Tick it if they say they'd move — it puts them on the call list in the
  [assistance schedule](#personalized-assistance-appointments). If they've
  already got a booking and ring back to change their mind, pick them and tick
  it on its own; the flag lands on the row they already have.

> **There is no standing list for an appointment program**, and the box isn't
> offered on one. "Book me into every one of these" would hand one person a
> chair in every Wills afternoon for the rest of the year and take those times
> off the form. Appointments are booked one at a time, by whoever wants them.

#### Standing lists — somebody who comes to everything

Plenty of people have come to the same class every week for years and have
never filled in a form in their lives. The instructor still needs their name
and their email.

Tick **Register them for this session** and then **…and every future session of
it**. They go on the **[Club_Members](#8-club_members)** tab, and from the next
sync they are booked into **every upcoming session of that program**, on
whatever form currently covers it — forever, until somebody unticks them.

**A place, or a place and a meal.** Those are two different arrangements, and
the third tick — **…and a lunch every time** — is which one you mean. It writes
the **Lunch** column on their `Club_Members` row, and every booking the
standing place makes from then on carries it. Leave it unticked and they are
booked into the program with **No Lunch**, which is what a standing place has
always meant on its own.

- **It doesn't need the `[Club]` tag.** That tag decides whether the public
  *form* offers people the "sign up for all future meetings" option. A standing
  place added at the desk is a decision staff have already made, so any program
  can have one — the Zoom classes above all.
- **To take somebody off**, untick **Active** on their `Club_Members` row. You
  are asked, on the spot, whether to cancel the upcoming rows that membership
  already created. See [Club_Members](#8-club_members).
- **Existing rows are never overwritten.** A session they already have a row
  for — registered normally, added as a walk-in, or cancelled for that one date
  — is left exactly as it is. A standing place fills gaps; it does not
  re-assert itself over decisions somebody made about individual dates.
  **This applies to the lunch too:** changing somebody's standing lunch changes
  what gets booked from then on, and leaves rows that already exist alone. To
  add a meal to a date they are already down for, use **Sign up for lunch** on
  that session, or edit the row on `Registrant_Dash`.
- **You can change your mind later**, either by ticking **…and a lunch every
  time** at the desk again — a tick at the counter is a person saying what the
  arrangement is now, so it updates a member who is already on the list — or by
  editing the **Lunch** column on `Club_Members` directly.
- **Past dates are never filled in.** A standing place says where somebody is
  expected, not where they were.

#### Signing someone up for lunch at the desk

Somebody comes to the front desk on Monday and wants lunch a week Thursday.
Pick the location, pick **that Thursday's** session (or that day's
**Lunch @ …** entry if nothing else is running), pick or type their name, tick **Sign up
for lunch**, press **Sign up**.

They're now on the order for that day: `Lunch_Status` = `Needed`,
`Lunch_Type` taken from that day's menu, and **nothing marked served**. They
appear on [Lunch_Roster](#3-lunch_roster) on the next render, and in
`Registered_Count` on the lunch dashboard.

Someone pre-registering for a **month** of lunches is the same thing once per
date — pick the next date, same name, tick, press. The dialog keeps the
location and clears only the name and the ticks, so it's a few seconds each.

**More than one meal for them?** Ticking **Sign up for lunch** opens a
**Meals to order** box beside it. Leave it at `1` for an ordinary sign-up, or
put `4` in for Joan — it writes `Meals_Ordered` on the row, and the kitchen's
number goes up by four rather than by one. It only ever writes the number
**up**: signing somebody up who already has a standing order of four does not
quietly cut it to one.

#### Recording what somebody actually ate

Ticking **Lunch** opens three boxes: **Ate here**, **Took home** and **Into the
fridge**. They answer the question the tick on its own cannot — *how many, and
where did they go*.

Leave all three at `0` and a Lunch tick means exactly what it always meant:
served, count it off the paper sheet later. Fill them in and they land on that
person's own `Day1_Dined_In`, `Day1_Taken_Out` and `Meals_In_Fridge` — so
"ate 2 here and took 3 home" is one pick and one press, instead of finding
their row on the Registrants tab afterwards.

> **The counts ADD to what the row already holds.** Somebody who comes back an
> hour later for another meal is marked the same way the first time was, and
> the second mark has to extend the first rather than replace it. If you tick
> twice by mistake you will see a number that is one too high, on the row, in
> front of you — which is the correctable direction.

> **The date must have a `Hot` or `Cold` row on Lunch_Schedule.** If it
> doesn't, the sign-up is refused with a message saying so, rather than
> accepted into a day nothing is being cooked on. Add the menu row first.

> **Why this isn't just the Lunch tick.** Ticking **Lunch** writes
> `Lunch_Served`, which means *the meal has already been handed over*. Using it
> to book a future meal puts a served lunch on a date that hasn't happened,
> and `Served_Confirmed` then disagrees with reality on both days.

> **There used to be a third box, 🥡 Lunch Only.** It did exactly what a Lunch
> tick with Attended left clear does, and two ways to say one thing is two ways
> to get it wrong. Ticking Lunch on its own now clears `Attended`, which makes
> it a **correction** as well as a record — the "I marked her present, she only
> collected a meal" case.

Guests brought by another registrant appear in the name list exactly like
anyone else — there's no separate step for them.

If someone's registered for **several dates** of the same program and you
picked an undated entry, it marks the nearest one (today first, then the next
upcoming) and says so, e.g. *"Marion Webb — attended, Tue, Aug 5 (2 sessions
matched — marked the nearest)."* If that's the wrong one, tick the right row
directly.

**Walk-ins.** If the person you picked has **no registration** for that
session, marking offers to add them:

> *Marion Webb has no registration for Chair Yoga.*
> *Add a new row for Chair Yoga — Tue, Aug 5 (Narberth), marked lunch
> (collected, not attending) and flagged "Manually Added"?*

Say yes and the row appears, already marked. It's flagged **Manually Added**,
which means no future sync will touch or remove it. Say no and nothing
happens. You need a **session** picked in box 2 for this — the system won't
guess which one they walked into. A walk-in comes in marked **Attended** only
if you ticked Attended; a Lunch-only walk-in is fed without being recorded as
present, same as for an existing registrant.

You can always tick `Attended` / `Lunch_Served` **directly on a row** instead;
Quick Mark is just faster when you're standing at a sign-in desk. The same rule
applies there too — ticking `Lunch_Served` on a row does not tick `Attended`
for you.

#### The columns

`Event_Date`, `Location`, `Event` and `Event_Time` lead the row, then
**`Name`, `Attended`, `Lunch_Served`** and the five meal counts — so
which-session, who-they-are, did-they-come, and what-they-ate sit together with
no scrolling.

`Event_Time` is the session's **time range** — *"10:00 AM – 11:30 AM"* — taken
from the calendar event, so a row says when to expect somebody without a trip
to the dashboard. It fills itself in: rows created before the column existed
are backfilled from the session table the next time this tab is drawn.

| Column | What it tells you |
|---|---|
| `Event_Date` | The session day — first column, tinted by month |
| `Location` / `Event` | Which program and location this row belongs to |
| ✍️ `Attended` | **Yours to tick.** They turned up |
| ✍️ `Lunch_Served` | **Yours to tick.** They were actually fed — this is what `Served_Confirmed` on the lunch dashboard counts |
| ✍️ `Meals_Ordered` | **Yours to fill in.** How many meals this person is ordering. **Leave it blank for one** — blank means one everywhere. Type `4` for a standing order like Joan's |
| ✍️ `Day1_Dined_In` | **Yours to fill in.** Day-1 meals this person **ate here** |
| ✍️ `Day1_Taken_Out` | **Yours to fill in.** Day-1 meals this person **carried out** |
| ✍️ `Subs_Dined_In` | **Yours to fill in.** Subs eaten here |
| ✍️ `Subs_Taken_Out` | **Yours to fill in.** Subs carried out |
| ✍️ `Meals_In_Fridge` | **Yours to fill in.** How many of their meals went in the fridge to collect later |
| ✍️ `Meal_Source` | **Yours to fill in, only when it isn't today's food.** Which meal those counts were portions of. Leave it blank and it means today's — see below |
| ✍️ `Phone` | From the form. Correct it here if it's wrong |
| `Email` | From the form. What a calendar invitation is sent to |
| `Person_Type` | `Attendee` (registered themselves) or `Guest` |
| ✍️ `Lunch_Type` | `Hot`, `Cold`, or `No Lunch` — the actual dish category, not just yes/no |
| ✍️ `Lunch_Status` | Needed · No Lunch · Waitlisted · Cancelled · Superseded |
| ✍️ `Program_Status` | Active · Waitlisted · Cancelled · Superseded |
| ✍️ `Earlier_Appointment` | **Appointment programs only.** `☎️ Call if earlier` · `Keeping this time` · blank. From the form's own question, or type it in when they tell you on the phone — it's what the [call list](#personalized-assistance-appointments) is built from. Blank means **no**: nobody unasked gets rung about moving their appointment |
| ✍️ `Contacted` | Tick — this person has been reached out to |
| ✍️ `Confirmed` | Tick — they said they're coming |
| ✍️ `Waitlisted` | Tick — the instructor's own waitlist, separate from `Program_Status` above |
| ✍️ `Dropped` | Tick — they said they're not coming |
| ✍️ `Instructor_Notes` | Anything else worth knowing about them for this session |
| `Primary_Registrant` | `Self`, or the name of whoever brought them |
| `Party_Size` | Headcount on that submission — "party of 3, one no-show" |
| `Order_Ahead_Flag` | Highlighted when someone registered too late to order for |
| ✍️ `Admin_Notes` | Allergies/dietary needs, plus anything they typed |
| `Manual_Override` | Turns purple when a row has been hand-edited, so the sync leaves it alone |

Those last five are the columns an instructor fills in on their own shared copy
of the roster — see [Instructor sign-up sheets](#instructor-sign-up-sheets).
They're editable here too, and each hourly sync merges the two **cell by cell**,
so a correction you make here isn't clobbered by a stale copy open in an
instructor's browser tab, and theirs isn't clobbered by yours.

**✍️ and yellow means yours to fill in** — the same convention as every other
tab. Everything without it came from a form or is worked out automatically, and
will be overwritten if you type in it (you'll get a warning if you try).

> **Ordering more than one meal for the same person.** Some people order
> several meals and they are all theirs: Joan takes four every lunch day, the
> Ginsburgs pick up three between the two of them, and on some days you offer
> people a second meal after they've had their first.
>
> **Type the number into `Meals_Ordered` on their row.** That's the whole of
> it. Blank means one — every ordinary registration leaves it empty — so a
> number in that column is always news. `4` on Joan's row means:
>
> * `Registered_Count` on [Master_Lunch_Dashboard](#2-master_lunch_dashboard)
>   counts **four meals** for her,
> * [Lunch_Roster](#3-lunch_roster) shows **one row** — hers — reading `4`
>   under `Meals`,
> * the [printed sign-in sheet](#printed-sign-in-sheets) prints `4` in her
>   `MEALS ORDERED` box instead of a `1` you'd have to cross out.
>
> **Do not put extra meals in the guest boxes.** "Extra Meal 1" and "Extra Meal
> 2" become *people* — they get their own roster rows, their own lines on the
> sign-in sheet, and they inflate `Party_Size` — and every one of them then has
> to be explained to whoever reads those. A meal is not a person.
>
> To order **no** meal, set `Lunch_Status` to `No Lunch`. That's the column
> that says whether somebody eats at all; a `0` in `Meals_Ordered` is ignored
> so that a typo can never quietly cancel somebody's lunch.
>
> **Registrants can order extras themselves.** Every form that asks about lunch
> now also asks **"Extra Meals (Beyond One Each)"** — `None`, or 1 to 6. It is
> asked once and applies to every date on that submission that asked for lunch,
> and the extras go on the person filling the form in, which is who collects
> them. Somebody who needs more than six is asked to ring the office.
>
> **One person, several different meals.** The five meal counts are
> **independent**, which is the whole point of them: Joe eats the day-1 meal in
> the dining room *and* takes two subs home, so his row reads
> `Day1_Dined_In = 1`, `Subs_Taken_Out = 2`. That's four meals accounted for,
> attached to the person who took them — not just added to the day's total.
> Each count feeds exactly one column on Master_Lunch_Dashboard
> (`Day_1_In-Person`, `Day_1_Takeaway`, `Subs_In-Person`, `Subs_Takeaway`,
> `In_Fridge`), and those are the same four count columns on the
> [printed sign-in sheet](#printed-sign-in-sheets), in the same order — so
> typing a finished paper sheet back in is column-for-column.
>
> This replaced a single `Meals_In_Fridge` **checkbox** that flipped a row's
> whole meal count between "eaten here" and "taken away". That couldn't say
> "some of each", which is what actually happens at the counter. Rows written
> under the old scheme are read across automatically on the first render, with
> ticked-fridge rows counted as taken away exactly as they were before.

> **`Meal_Source` — when you serve yesterday's food.** The counts say how many
> meals and in what manner. They never said *what the food was*, because that
> was assumed: a meal counted on a row dated the 17th is a portion of whatever
> Lunch_Schedule lists for the 17th.
>
> Leftovers break that, and they break it in both directions at once. Serve
> Wednesday's chicken on Thursday and **Wednesday reads as twelve meals
> wasted** while **Thursday reads as takeaway demand on a day nothing was
> ordered** — one real batch of food, reported as two wrong numbers.
>
> So on a row where the food came from an earlier day, pick that day's meal
> from the `Meal_Source` dropdown:
>
> | | |
> |---|---|
> | **Blank** | Today's meal. This is the normal case and what every existing row means — leave it alone |
> | `M-20260916-NARBERTH-HOT — Chicken Parm` | These meals were portions of **Wednesday's** chicken, handed over today |
>
> Those meals then count against **the day the food was made**, on the
> dashboard row that has the `Actual_Ordered` to reconcile them against. That
> row's `Carried_Over` says how many of its meals went out on a later day, so
> the number is explained rather than just larger.
>
> Taking the example above: Wednesday goes from *40 ordered, 28 consumed, 12
> unaccounted for* to *40 ordered, 36 consumed, `Carried_Over` 8* — and four
> meals is what was actually thrown away. Thursday stops inventing demand for
> a day the kitchen was closed.
>
> **The one thing it can't say:** a row names **one** meal. If someone ate
> today's lunch *and* carried out yesterday's leftovers, the row can only name
> one of the two. Recording several different meals per person per day needs a
> row per meal handed over, which is a bigger change — see
> `MEAL_IDENTITY_DESIGN.md`.
>
> If `Meal_Source` names a meal that's no longer on Lunch_Schedule (the menu
> row was re-dated, or the day was later closed), those meals **stay counted**
> under their own day and you get a notice naming the person — an unreadable
> reference is a reason to check something, never a reason to lose a meal.

`Event_ID`, `Party_ID` and `Form_Source` are **hidden** — internal plumbing.
Unhide them from Google Sheets' column menu if you're troubleshooting.

Only rows that are **`Active` *and* `Needed`** count toward the catering numbers
that get *ordered*. `Served_Confirmed` is separate — see below.

> `Lunch_Type` is resolved from **Lunch_Schedule** at the moment the row is
> created and doesn't change afterward — the same "fact about when it
> happened" rule as `Order_Ahead_Flag`. If someone registers before that
> date's menu is set, `Lunch_Type` shows blank until they resubmit; `Lunch_Status`
> still correctly reads `Needed` either way, so nobody is missed.

**Superseded** means that person submitted the form again and this is the older
version. It's kept on purpose so you can see the change happened — it's excluded
from all counts automatically.

### 5. Lunch_Schedule
**You own this tab.** It's the menu, one row per **date per location**.

| Column | Notes |
|---|---|
| `Event_Date` | The day |
| `Location` | Narberth / Ashbridge / Zoom |
| `Type` | `Hot`, `Cold`, or `Not Serving` |
| `Meal_Description` | Full description |
| `Meal_Shorthand` | Short label — **this is what registrants see on the form** |
| `Meal_ID` | Worked out for you. The name of that day's meal, which is what `Meal_Source` on the Registrants tab points at. Don't type in it — it's rewritten every sync |

#### "Not Serving" — closing the kitchen for a day

Setting a date to **Not Serving** is treated as a **decision**, not a gap, and
it wins over everything:

- It **removes that date+location from Master_Lunch_Dashboard** — no row, no
  ordering number. If a row was already there, it's taken off.
- It **removes the date from the lunch question** on that form and labels it
  "No Lunch Served," so nobody is asked to pick a meal that doesn't exist. If
  that leaves the form with **no** catered dates at all, the lunch questions
  come off the form entirely and its description says lunch isn't provided —
  and they come back on their own if you later add a catered date.
- **People already signed up for that lunch stop being counted** — and you are
  told about it, by name, straight away:

  > ⚠️ 3 person(s) had signed up for lunch on a date now marked "Not Serving" —
  > Mon, Sep 14 at Narberth: Marion Webb, Ada Cole, Ruth Bell. They will drop
  > off the lunch dashboard; they still need telling.

  The same thing goes to the **admin email** on the next sync, so it isn't lost
  if you clicked past the message. **Their registrations are not changed** —
  they're still coming to the program, they're just not being catered for.
  Ringing them is yours to do; the system won't quietly cancel a meal and say
  nothing.

To put the lunch back, change that date's `Type` to `Hot` or `Cold`. Everything
above reverses on the next sync.

> **A date with no menu row at all is different.** That's a *gap* — nobody's
> got to it yet — and demand wins there: if someone is signed up for lunch on
> a date with no menu, the date stays on the dashboard and you get a "lunch
> needed with no menu set" notice. Only an explicit `Not Serving` cancels.
>
> That holds at the moment a registration is **imported**, too. Somebody who
> ticks "lunch on every date" on a Grouped form before the month's menu has
> been typed is still recorded as needing a meal on every one of those dates —
> at a "By exception" location that used to be silently downgraded to
> `No Lunch`, and typing the menu afterwards never went back for them.

Three things are deliberately **not** removed:

- **Past dates.** Their rows hold what was actually ordered, consumed and
  thrown away. Marking an old date Not Serving is a correction to the plan; it
  doesn't erase the receipt.
- **Hand-edited dashboard rows** (`Manually Added` / `Manually Edited`). Your
  own rows are never deleted out from under you — you get a note instead, and
  can delete it yourself.
- **Days somebody was actually fed.** If `Lunch_Served` is ticked for anyone
  that day, the row stays: `Served_Confirmed` records what happened, not what
  was planned.

#### Adding menu items — paste CSV

Scroll to the bottom of the tab. Under **➕ ADD MENU ITEMS** there is open
space. Put your menu there in this order:

```
Date, Location, Type, Meal Description, Shorthand
2026-09-14, Narberth,  Hot,  Chicken Parmesan, Chx Parm
2026-09-15, Ashbridge, Cold, Turkey Wrap,      Turkey
2026-09-16, Narberth,  Not Serving
```

**One row or two hundred, it's the same thing.** Paste from Excel or Sheets,
paste raw comma-separated text, drop the whole month in one cell, or type a
single row by hand — it all goes through the same reader. Complete rows move
up into the schedule and the box empties itself, ready for the next batch.

- A **header line** is fine — it's ignored.
- A date that **already has a menu** for that location is replaced.
- **Dates** can be `2026-09-14` or `9/14/2026`.
- **Locations** and **types** don't need exact spelling — `narb`, `NARBERTH`
  and `Narberth Center` all land on Narberth; `none`, `no`, `closed` and
  `n/a` all mean `Not Serving`.
- **Commas inside a description** are fine if you quote the field:
  `2026-09-14, Narberth, Hot, "Chicken, rice and beans", Chx`
- Anything it **can't read stays in the box** with a note saying why, so a
  bad row 40 never swallows a good row 41. Fix it in place and it goes in.
- A row you're **still typing** is left alone. It moves up once it has a
  date, a location and a type.

Prefer a dialog, or have the menu in a **`.csv` file**? Use
**🍱 Add Menu Items (paste/upload CSV)…** on the menu. Same reader, same rules.

To fix an existing menu, just **edit the row in the table** — it stays exactly
where it is (dates and spellings get tidied up as you go).

#### Getting the menu onto the forms

Editing the menu **does not** rewrite live registration forms on the spot.
That used to happen on every keystroke and made typing a month of menus
impossible. Instead:

- The **daily Sync Cal** picks it up on its own, or
- click **🍱 Push Menu Changes to Forms** when you want it out there now.

It asks first, then does the whole job in one press:

1. **re-stamps `Lunch_Schedule`** so every row has its `Meal_ID`, and the
   labels below are built from what you just typed rather than a cached copy;
2. **builds or refreshes the lunch sign-up form for every month you touched.**
   This is the step that puts a *newly added date* on its monthly form. A date
   that is new to the menu has no session row yet, and a form's dates come from
   its session rows — so before this existed, adding a date to next month's
   menu and pressing push did nothing visible until the hourly sync happened to
   come round;
3. **rewrites every registration form covering an affected location-month** —
   its date labels, its lunch question, and its description. The *month* is the
   unit, not the date you edited, which is what makes a **deleted** date
   disappear from the forms still offering it and a date flipped to **Not
   Serving** lose its meal hint everywhere it appears;
4. **re-renders `Master_Lunch_Dashboard`**, so the order counts match the menu
   you just pushed.

Past dates are left alone. The toast afterwards says how many forms were
actually rewritten out of how many were tried — and says so plainly when some
of them failed, rather than reporting a ✅ for forms it could not open.

#### Adding rows the easy way

Typing rows by hand works, but the tab is sorted and split into Upcoming/Past
sections, so finding — or creating — the right row gets tedious. Two menu
items do it for you instead:

**Add Lunch Schedule Entry** — one row, a few prompts: Location, date, Type,
description, shorthand. Cancel any prompt and nothing is changed.

**Add Lunch Schedule Entries (Batch)** — a whole run at once: Location, a
start and end date, an optional day-of-week filter (e.g. "Mon,Wed,Fri" — leave
blank for every day in the range), then ONE Type/description/shorthand applied
to every date produced. It shows you a summary — including how many existing
rows it's about to overwrite — before it writes anything. Use this for
something like "Cold lunch, every Tuesday and Thursday, for the next two
months." For a run where different dates need different menus, either run it
more than once (once per menu) or edit the generated rows afterward.

Both **upsert**: a date+location that already has a row gets its
Type/Meal_Description/Meal_Shorthand overwritten — same as hand-editing that
row — rather than creating a duplicate. Both also ask **whether to push the
change out to the forms**, exactly like hand-editing a row does.

Neither needs an authorized admin account — adding a menu row this way is the
same capability as hand-editing the tab, just faster.

### 6. Member_Roll and Program_Options — your own notes

These two tabs are the only ones holding knowledge the system can't work out for
itself. Each is split down the middle:

- **The left columns are recomputed** every sync. Don't hand-edit them; they'll
  be overwritten.
- **The ✍️ yellow columns on the right are yours, permanently.** Nothing ever
  overwrites them.

**Member_Roll** — one row per person who has ever registered:

| Recomputed | Yours |
|---|---|
| `Times_Seen`, `First_Seen`, `Last_Seen`, `Locations`, `Usual_Lunch` | `Confirmed_Member`, `Usual_Guests`, `Dietary_Notes`, `Contact`, `Staff_Notes` |

This is where "Marion always brings her sister" or "cold lunch only, no dairy"
lives. People stay on the roll even after their sessions age out, so the notes
don't evaporate. `Confirmed_Member` is a plain checkbox — tick it once you've
personally verified someone as a real member, independent of how many times
the recomputed history shows them attending.

**Program_Options** — one row per program per location:

| Recomputed | Yours |
|---|---|
| `Type_Tag`, `Sessions_Tracked`, `Next_Date`, `Last_Date` | `Typical_Attendance`, `Usual_Capacity`, `Room_Or_Setup`, `Instructor_Email`, `Staff_Notes` |

"Needs the big room." "Usually 8 even though it's capped at 12."

`Instructor_Email` is who this program's shared sign-up sheet gets handed to —
several addresses are fine, separated by commas. See
[Instructor sign-up sheets](#instructor-sign-up-sheets).

### 7. Config
Eight small settings blocks:

- **🍱 Meal Buffer Amounts** — extra meals per Location × Hot/Cold. **This is
  the only place buffers are set.** Master_Lunch_Dashboard re-reads them here on
  every render, so the two can't disagree — and the column of zeroes that used
  to appear on dates with no registrations yet is gone with it.
- **⏰ Order Ahead Time** — how many days' notice you need. Registrations
  inside that window get flagged.
- **📧 Admin Notifications** — one email address (optional)
- **🍽️ Lunch Service by Location** — see below
- **🔗 Registration Link in Events** — see below
- **⚙️ Automation & Trigger Ownership** — see below
- **📧 Calendar Invitations** — see below
- **🚧 Registration Open Through** — see below

**Lunch Service by Location** is what keeps the lunch dashboard from filling up
with empty rows. Each location gets one of three settings:

| Setting | Use it when | Effect |
|---|---|---|
| **Always** | The location normally serves lunch | Every upcoming date is listed. Mark a specific day `Not Serving` on Lunch_Schedule to skip it. |
| **By exception** | Lunch happens occasionally | Nothing is listed until you add a Hot/Cold row for that date on Lunch_Schedule |
| **Never** | The location can't serve lunch at all | Never appears on the lunch dashboard, and its registration forms **don't ask about lunch** |

Defaults are Narberth = Always, Ashbridge = By exception, Zoom = Never. Change
them in Config any time; you don't need to touch the code.

> **You can't accidentally starve anyone with this.** The setting only controls
> what's listed *in advance*. If someone actually registers for lunch on a date,
> that date shows up regardless — and if there's no menu behind it, it goes in
> the admin email as "lunch needed with no menu set."

If you set the email, you get **at most one message per sync**, and only when
something needs a person: waitlisted registrants, forms that couldn't be opened,
and events sent to triage. A quiet sync sends nothing. **Leave it blank to turn
notifications off.**

#### 🔗 Registration Link in Events

Whether the registration link appears in the **calendar event description**.

| Setting | What attendees see in the event |
|---|---|
| **Show link** (default) | A **📝 Register for …** link at the **top** of the description, above everything else |
| **Hide link** | No registration link at all |

Use **Hide link** when sign-up happens at the desk and a self-serve link in a
shared calendar would be wrong. The forms still exist and still work — you just
hand the link out yourself, from `Form_Response_Link` on the program dashboard.

**Changing this setting doesn't rewrite events on its own.** It applies to
events as they're next synced. To apply it to everything already out there,
run **🔧 Admin ▸ 🔗 Rewrite Event Links**.

> **One trade-off with Hide link.** The system can normally recover a
> "lost" form by reading its ID back out of an event description. With no link
> in the description there's nothing to read, so form ownership rests entirely
> on the `Form_ID` column and the script's own registry. Fine in normal use —
> worth knowing if you ever rebuild the workbook from scratch, because it will
> then build *new* forms rather than adopting the existing ones.

**Automation & Trigger Ownership** is what keeps two different Google
accounts from quietly fighting over this project's automation. Three cells:

| Cell | What it does |
|---|---|
| **Automation_Enabled** | Master switch. Set it to **No** and the calendar sync, registration sync, and calendar-edit handlers all stop immediately — *including ones set up by another account*. Set it back to **Yes** to resume. Anything other than "No" means enabled. |
| **Trigger_Owner** | The one account that holds the triggers. Filled in automatically when that account runs **Check Triggers**. |
| **Triggers_Verified_At** | When that account last rebuilt them. |

**Why the kill switch matters.** Google gives an installable trigger to
whichever account created it, and *no other account can see or delete it* —
not through this script, anyway. So if someone else's leftover triggers are
double-syncing your calendar, you genuinely cannot remove them from your own
login. But this cell is shared by everyone, and every handler checks it
before doing anything. **Setting it to "No" stops triggers you have no power
to delete** — it's the fastest way to stop a runaway sync while you sort out
whose triggers are whose. It doesn't remove anything, so once the mess is
cleaned up, flip it back to "Yes".

Pausing takes effect within about a minute (the setting is cached briefly so
a busy calendar doesn't re-read the sheet hundreds of times).

**Why ownership matters.** Only the recorded owner can run **Check Triggers**
or **Import Everything** — everyone else gets a message naming who the owner
is, so you know who to ask instead of guessing. This is what stops a second,
invisible set of triggers from ever being created. See
[Admin-only actions](#admin-only-actions).

#### 📧 Calendar Invitations

Whether registrants are added as **guests on the real Google Calendar event**,
so the program lands in their own calendar with Google's own reminders.

| Setting | Effect |
|---|---|
| **Invite registrants** (default) | Anyone actively registered for an **upcoming** session, who gave an email address, is added as a guest. Google emails them an invitation. |
| **Do not invite** | Calendar events are left exactly as they are. |

**This one sends mail to real people**, which is why it has a switch of its own
and asks before you turn it on. Three rules keep it from being a nuisance:

- **Upcoming sessions only.** Nobody is ever invited to something that already
  happened.
- **It works both ways.** Somebody whose registration is `Cancelled`,
  `Superseded` or `Waitlisted` is **removed** from the guest list — a
  cancellation shouldn't leave them holding an invitation.
- **Once.** The system remembers who it has already invited, so a sync that
  changes nothing sends nothing. Without that, every hourly run would re-add
  the same guests and Google would notify them each time.

It runs at the end of every registration sync, and on demand from
**📧 Invite Registrants to Calendar Events…**, which **asks which sessions** —
it lists only the ones with somebody still to invite or remove, with the counts,
and you tick the ones to send for. At most 40 events are updated per run;
anything left over goes out on the next one.

> **The manual run used to sweep everything at once**, which is not something
> anybody presses a menu item to do on purpose. The reasons for running it by
> hand are narrow — one program's invitations need to go out before the hourly
> sync gets to them, or one event was fixed and its guests need re-adding — and
> both are a couple of ticks. The hourly pass is unchanged: it still keeps
> every event's guest list in line on its own.

> Registrants who didn't give an email address (walk-ins, club members added by
> hand) are simply skipped. Nothing else about them changes.

#### 🚧 Registration Open Through

**One date that decides how far ahead people can sign up.** Leave it blank —
the default — and nothing changes: every session is open, exactly as before.

Put a date in it and the workbook draws a line:

| Session date | What happens |
|---|---|
| **On or before** the date | Normal. Register link on the calendar event, form taking responses. |
| **After** the date | Not open yet. The calendar event says **🚧 Registration Not Yet Open** instead of carrying a register link, and a form whose remaining sessions are *all* past the date **stops accepting responses**. |

This is for the ordinary case of building a season three months early. The
calendar events go up in June; you don't want a member browsing the shared
calendar in June and registering for November. Set the horizon to the end of
September and September's programs are live while November's are visible but
closed.

**Nothing is deleted and nothing is skipped.** The session rows, the forms, and
the calendar events are all still built ahead of time — the horizon only
decides whether the public is invited into them yet. That's what makes opening
registration a **one-cell** operation: move the date forward and the next sync
puts the links back and re-opens the forms. Clear the cell and everything opens
at once.

**What people see:**

- On the calendar event: `🚧 Registration Not Yet Open` at the top of the
  description, where the register link normally sits.
- On a form somebody already has the link to: Google's closed-form page, saying
  *"Registration Not Yet Open — this program is not taking sign-ups yet. Please
  check back closer to the session date."* Not the bare "no longer accepting
  responses", which reads as *you missed it* for something nobody has been able
  to sign up for yet.

**A few rules worth knowing:**

- **The horizon date itself is open.** It means *through the end of that day*.
- **A series that straddles the line keeps its form live.** A `[Grouped]`
  program running September to December has open sessions, so its form stays
  open — only its events past the horizon carry the notice. The horizon closes
  a form only when **every** remaining session on it is past the date.
- **Past sessions are never touched.** A date behind today is a record of what
  happened, so it keeps its description even if you set the horizon behind
  today (which is a legitimate way to say *nothing is open right now* — it
  closes everything upcoming).
- **Only forms the horizon closed are re-opened by it.** A form you closed by
  hand in the Forms UI stays closed, and one closed by `[No Registration]` is
  left to that checkbox.
- **A typo can't take the workbook down.** Anything that isn't a date is
  refused when you type it, and a cell that somehow ends up holding one anyway
  reads as *no horizon* — everything open — and says so in the log. The
  dangerous direction is the other one, so it fails that way on purpose.
- **It doesn't apply to `Hide link`.** If Config's 🔗 Registration Link in
  Events is set to `Hide link`, event descriptions carry nothing of ours at
  all — no link and no notice.

Changing the date takes effect on the **next sync**. To apply it to events
already in the calendar right away, run **🔗 Rewrite Event Links** from the
Admin menu.

### 8. Club_Members
The standing roster: **who is booked into every future session of a program
without ever signing up again**. One row per person per program.

Two things put somebody here, and they behave identically once the row exists:

- they chose *"I want to sign up for all future … meetings"* on a `[Club]`
  program's form — see [Clubs](#clubs);
- staff put them there from Quick Mark, with **Register them for this session**
  and **…and every future session of it** — see [Standing
  lists](#standing-lists--somebody-who-comes-to-everything). This works for
  **any** program, tagged `[Club]` or not, which is how the long-standing Zoom
  and exercise regulars get onto the list they have never once filled a form
  in for.

Taking somebody off is the same in both cases: untick **Active**.

The columns on the **left** are refreshed automatically (which club, where,
contact details). The **yellow** ones are yours:

| Column | What it's for |
|---|---|
| **Lunch** | Whether this member wants lunch at that program. Applied to every session booked for them. |
| **Active** | The on/off switch. Untick to stop booking them; you'll be asked whether to cancel bookings already made. |
| **Staff_Notes** | Anything you want to remember |

`Club_Key` is hidden — it's the machine key that keeps a roster attached to its
program across a new form every month.

### 9. Program_Questions
The extra questions each program's form asks, one row per question — see
[Extra questions on one program's form](#extra-questions-on-one-programs-form)
for the columns and what each type does. Everything on this tab is yours to
type; nothing on it is ever overwritten. Press **❓ Update Program Questions on
Forms** when you're done, or leave it for the next **Sync Cal**.

**Every column with a fixed answer is a dropdown, including on the blank rows
below.** `Program` lists every program currently on the dashboard, spelled the
way your calendar spells it; `Location` lists your locations; `Type` lists every
kind of row; `Required` and `Active` are real tick boxes. Pick **`*`** in
Program or Location (or leave it blank) for *"every one of them"*.

> **Or don't type the program at all.** `Match_Keywords` aims a row by word
> instead of by exact name — `wills`, `zoom`, `club` — and survives a program
> being renamed on the calendar, which an exactly-matched title does not.

> **Use the Program dropdown rather than typing.** A program name is matched
> against the calendar **exactly** — so `Bookclub`, or `Book Club ` with a
> trailing space, asks its question of no form at all, and nothing on this tab
> would tell you.

### 10. Assistance_Requests
People who want a `[Personalized Assistance]` appointment at a time we haven't
scheduled — they picked *"None of these work"* on the form. One row per request,
newest first.

The columns on the **left** come from their submission (when, which program,
name, phone, email, their answers). The **yellow** ones are yours:

| Column | What it's for |
|---|---|
| **Status** | `New` → `Contacted` → `Scheduled` → `Closed` |
| **Scheduled_For** | The date you agreed with them, once you have one |
| **Staff_Notes** | Anything you want to remember |

Nothing on this tab books anybody. When you've agreed a time, put the event on
the calendar and register them the normal way, then close the row.

### 11. Deleted_Event_Triage
Safety net. If a calendar event disappears but people had registered for it,
their rows are moved here instead of being deleted, with a note. Follow up with
those people, then clear the rows.

---

## What registrants see

Every form is the same shape. **Page 1** asks:

- **Name** (required)
- **Phone Number** (required) — so you can reach someone when a program moves,
  and so it's on the printed sign-in sheet
- **How many guests are you bringing?** — *Just me*, 1, 2 or 3

Picking a number sends them to a page with exactly that many name boxes, all
required. Somebody coming on their own never sees a guest field at all, and
"picked 3, typed 2 names" can't happen. **More than three guests?** The question
says to call — the number is right there on it.

Then one more question, the only real fork in the form:

| They pick | They get |
|---|---|
| **"I want to sign up for all events this month."** | One question: who's eating. Applied to every date. |
| **"I want to choose specific days this month to attend."** | The full roster grid |
| **"I want to sign up for all future *X* meetings."** | The same as the first — plus they join the club. Only on `[Club]` programs. |

On a `[Grouped]` series the first two read *"every date listed on this form"* and
*"specific dates from the list"* instead, since a series isn't a month.

**That page lists the dates it's asking about**, right above the question. They
*are* on the form already — the description at the top spells out every one —
but Google Forms only shows a description on the **first** page, and by the time
somebody has answered a name, a phone number, a guest count and possibly a page
of guest names, that list is several sections behind them. So *"sign me up for
every date"* was being chosen by people who could no longer see how many dates
that was or how far out they ran. Now the dates are on the page where the
decision gets made. (A form with an unusually long list shows as many as fit and
says how many more there are.)

The help text under the question spells out what each option does, rather than
telling anyone which one to pick.

**A form covering ONE date doesn't ask at all.** A single lecture on the 5th of
March gets a form built from the same template as a twelve-week series — and
over a list of one date, *"all events this month"* and *"choose specific days"*
mean the identical thing, while the roster grid behind the second is a table
with one row. It is also the first thing on the form, where a required question
reads as consequential: people stop, read it, pick the second option, and tick
one box to say the thing they had already said by opening the form.

So on a one-date form the question comes off, and the page it sat on is retitled
to say **which date this is** — the list underneath it was already there, so the
page stops being a fork in the road and becomes the confirmation a one-off event
actually wants. The description says *"Date:"* rather than *"Dates:"* over its
list of one.

It reverses itself. Add a second session and the question is back on the very
next sync, on the page it came off. And a **`[Club]` form is never collapsed**,
however few dates it covers — *"I want to sign up for all future X meetings"* is
a choice on that same question, and it isn't about dates at all: it is how
somebody joins the roster.

**Every form that asks about lunch also asks about extra meals**, right under
the lunch question: **"Extra Meals (Beyond One Each)"** — *None*, or 1 to 6.
Everyone listed who is having lunch already gets one; this is only for people
who need **more** than that. It's asked once and applied to every date on the
submission that asked for lunch, and the extras go on the person filling the
form in, since that's who collects them. More than six is asked to ring the
office. On a form with nothing catered the question isn't there at all — it
comes and goes with the lunch questions themselves.

The roster, for those who want it:

```
Who is Attending Each Date?
                 You   Guest 1   Guest 2   Guest 3
  Tue Aug 5       ☑       ☑         ☐         ☐
  Thu Aug 7       ☑       ☐         ☐         ☐

Who Needs Lunch Each Date?
                 You   Guest 1   Guest 2   Guest 3
  Tue Aug 5       ☑       ☑         ☐         ☐
  Thu Aug 7       ☐       ☐         ☐         ☐
```

Dates are rows, people are columns — so any guest can attend or skip any single
date independently, and eat or not eat independently.

A few things worth knowing:

- **Nothing arrives pre-ticked.** The link used to come with every box already
  checked, on the theory that most people are coming to everything. It was
  quietly asserting an answer on their behalf: somebody who skims a wall of
  checks and submits has told you they're coming to nine sessions they never
  read, and you cater for all nine. The *"sign up for all events"* option covers
  that case properly, as an answer somebody actually gives.
- **Columns always show all three guests**, even for somebody coming alone —
  they're baked into the form once and can't vary per person. Columns for guests
  they didn't name are ignored, so a blank one does no harm, but an empty
  labelled box still *reads* as a question you're expected to answer. So every
  grid now says it outright: **coming on your own? ignore the Guest boxes
  completely — you don't need to tick them, clear them, or put anything in
  them.**
- **The note about which guest is which points at the right Back button.** Every
  grid reminds them that Guest 1/2/3 are the names they typed earlier, in order,
  and tells them to use the **"Back" button at the bottom left of the form** to
  look. (Google Forms can't carry those names onto a later page.) It used to say
  *"your browser's Back button"* — which was advice that **destroyed the
  registration they were part-way through**: the browser's arrow leaves the form
  page entirely and they come back to a blank form. Forms' own Back button walks
  back with every answer still in place. The note now says which to use and
  warns off the other.
- Each date shows the **meal shorthand** next to it, and `(FULL - Waitlist)` once
  a capped session runs out of seats — so nobody joins a waitlist unknowingly.
- **Nobody is asked about a lunch that isn't happening.** A date marked
  `Not Serving` never appears as a lunch row, and a form with no catered dates
  at all doesn't show the lunch question in either branch.
- Signing up for **all dates** on a `[Grouped]` series also covers dates added
  to that series *later* — they don't need to re-register.
- There's a dedicated **Allergies / Dietary Needs** field, and the "Anything
  Else?" box carries your location's own note as its instructions. (It used to
  be a bold heading floating above that question with nothing under it.)
- **Every form ends with a way to reach a person:** *"If you need additional
  assistance, please call (610) 664-2366 or email
  info@newhorizonsseniorcenter.org"*. To change it, edit `CENTER_PHONE` /
  `CENTER_EMAIL` at the top of `Code.gs` — the form description, the guest
  question and the printed sign-in sheet all follow.
- Email addresses are collected, so people get a receipt with a link to **edit
  their own response** later — and, if you've switched it on, an **invitation to
  the calendar event** (see [Calendar Invitations](#-calendar-invitations)).

If someone changes their mind and submits again, the new answers win and the old
row is marked `Superseded`.

### The lunch-only sign-up form

Plenty of people come in for the meal and nothing else, and a good number of
them like to book a whole month of lunches in one go. There's a form for
exactly that, one per **location per calendar month**, called
*"Lunch Sign-Up — Narberth, September 2026"*. Its links are pinned to the top
of [Master_Lunch_Dashboard](#2-master_lunch_dashboard).

**You don't build it.** It builds itself from
[Lunch_Schedule](#5-lunch_schedule): every `Hot` or `Cold` row from today
forward becomes a date on the form. Add a month of menu rows, run
**🥡 Build / Refresh Lunch Sign-Up Forms** (or wait for the next hourly
**Sync Cal**), and the form and its link exist. Locations set to
**Never** cater in Config never get one.

**It is the ordinary form with the attendance question taken out.** On a form
whose entire subject is the meal, "which dates are you coming" and "which dates
do you want lunch" are the same question, and asking both is how you get
somebody ticking the lunch row, leaving the attendance row blank, and the
import having to guess. So there's one grid:

```
Who Needs Lunch on Each Date?
                 You   Guest 1   Guest 2   Guest 3
  Mon Sep 14      ☑       ☑         ☐         ☐
  Tue Sep 15      ☑       ☐         ☐         ☐
```

The fork at the top reads in lunch terms too — *"I want lunch on every date
listed on this form"* books a meal on every date in one page, which is the
month-at-a-time case this form exists for. The description says outright, in
its first line, that this books a meal and **not** a program.

**Where the registrations land.** Exactly where every other registration
lands: rows on **Registrant_Dash**, a name on
[Lunch_Roster](#3-lunch_roster), and a number in `Registered_Count` on the
lunch dashboard. The `Event` column reads `Lunch @ Narberth — Chx Parm` — the
place and the dish, the same as the session row it came from.

A few things worth knowing:

- **Signing up here and on a program's form for the same day is one meal,
  not two** — the counts are per person (see
  [Master_Lunch_Dashboard](#2-master_lunch_dashboard)). Their `Lunch_Roster`
  row shows both under `Programs` with `Requests_Merged` = 1.
- The dates are **on** Master_Program_Dashboard as sessions like any other and
  **visible there**, each named `Lunch @ <location> — <dish>`, with a blank
  `Calendar_Source` — because there is no calendar event behind them. That
  blank is what stops them being swept into triage.

  They used to be **hidden**, on the grounds that a meal is not a program.
  That was really about the old name: thirty rows a month all reading
  `🥡 Lunch Only (no program)` said nothing thirty times, and made the tab
  look like it was announcing that nothing was on. A row that says
  `Lunch @ Narberth — Chx Parm` is a line on the schedule like any other, so
  they stay on screen. (If yours are still hidden from before, they're
  unhidden automatically on the next render.)

  They're still left out of the **Today block** and the **participation
  metrics** — "42 programs this month" counting thirty lunches is a number
  nobody can use, and the meal has its own count on the lunch dashboard.

- **The dish in the name is decoration, not identity.** Every join in the
  workbook keys on the row's hidden `Event_ID`, so retyping a menu renames the
  row on the next render and nothing detaches — the people already registered
  for that meal keep their rows, and Quick Mark still finds them under the new
  name.
- For the same reason, **`Type_Tag`, `Club` and `No_Registration` can't be
  edited on those rows.** They're instructions to a calendar event that doesn't
  exist. The workbook tells you so and puts the cell back; change the date on
  `Lunch_Schedule` instead.
- **Nobody is invited to a calendar event** for a lunch-only date, since there
  isn't one. Program invitations are unaffected.
- If a form for a month **can't be opened** — trashed, permissions changed —
  that month is left alone and reported by email rather than being silently
  moved onto a replacement form, which would strand every response already on
  it and every link already handed out.

> **Forms already out in the world get updated too.** A program's form is
> created once and reused for as long as that program runs, so a change to the
> question layout used to reach only *new* forms — which is how an existing
> form could still route someone who named one guest onto a "2 guests" page.
> Every registration sync now checks each live form and rebuilds any that are
> still on an older layout, **keeping the same link**, so calendar invites,
> dashboard links and edit links all keep working. Nothing on
> Registrant_Dash changes. No more than five forms are rebuilt per
> sync, so a big backlog drains itself over a few hours rather than blowing the
> execution budget in one go.

> **"Failed to edit the form. Please wait and try again." in the log is normal
> and self-correcting.** Rebuilding a form is about 35 writes to one document,
> and doing several in a row makes Google's Forms API push back. It's retried
> automatically with a pause; anything that still doesn't go through is left
> exactly as it was — old questions, working link — and tried again on the next
> sync. You don't need to do anything about it.

---

## The menu

Under **🗓️ Calendar & Form Manager** at the top of the spreadsheet.

**There are two versions of this menu.** Everyone sees the day-to-day items.
The **🔧 Admin** submenu only appears for the accounts listed in
`AUTHORIZED_ADMIN_EMAILS`, plus whoever owns this spreadsheet (see
[Admin-only actions](#admin-only-actions)).

**The three you will actually use** sit at the top, on their own:

| Item | What it does |
|---|---|
| **⚡ Quick Mark Attendance / Lunch…** | Mark people in on the day, sign somebody up for a future lunch, or register them for a program (an appointment time included) with no form — location, session, name, then Attended / Lunch / Sign up for lunch / Register them. See [Quick Mark](#-quick-mark--the-fast-way-to-mark-people-off) |
| **🖨️ Print Sign-In Sheet (PDF)…** | Pick a location and a date; get a landscape PDF of everyone expected there that day across every program, with empty boxes to tick and write meal counts into — see [Printed sign-in sheets](#printed-sign-in-sheets) |
| **🔄 Update Everything Now** | Catches the workbook up with the calendars *and* the forms, in that order. This is the one to press when you have just changed something and want to see it. It is the same pair of passes the system runs on its own every hour |

Everything else is grouped by the job it belongs to.

**🍱 Lunch**

| Item | What it does |
|---|---|
| **Add Menu Items (paste/upload CSV)…** | Paste CSV or upload a `.csv` of menu items — see [Lunch_Schedule](#5-lunch_schedule) |
| **Build / Refresh Lunch Sign-Up Forms** | Builds (or updates) the lunch-only sign-up form for every location serving food, and pins the links to the top of Master_Lunch_Dashboard. The hourly pass does this anyway; this is for when you want the link now. See [The lunch-only sign-up form](#the-lunch-only-sign-up-form) |
| **Push Menu Changes to Forms** | The whole delivery in one press: re-stamps the menu tab, builds/refreshes the lunch sign-up form for every month you touched (this is what puts a **newly added date** on its monthly form), rewrites the date labels, lunch question and description on every form covering an affected location-month, and re-renders the lunch dashboard |

**👩‍🏫 Rosters & Schedules**

| Item | What it does |
|---|---|
| **Share a Sign-Up Sheet with an Instructor…** | Pick a program at a location; get a small live spreadsheet holding just that roster, shared with its instructor — see [Instructor sign-up sheets](#instructor-sign-up-sheets) |
| **Refresh Instructor Sheets Now** | Reads every shared sheet's marks back in and sends the current rosters out again, instead of waiting for the next hourly sync |
| **Personalized Assistance Schedule…** | Every upcoming appointment on a `[Personalized Assistance]` program, by day and program, in time order, with names, phone numbers, emails and answers. Select it and paste it into the email to the provider. See [Personalized assistance](#personalized-assistance-appointments) |
| **Invite Registrants to Calendar Events…** | Tick the sessions to send calendar invitations for, now rather than at the next sync — see [Calendar Invitations](#-calendar-invitations) |

**📝 Programs & Forms**

| Item | What it does |
|---|---|
| **🔍 Review Programs, Then Update Once…** | Walks your programs a screen at a time and says, for each, what ought to be true and whether it is; your answers are applied together in one pass at the end, and a second tab shows which program is on which form — see [Reviewing your programs](#reviewing-your-programs). Start here when something looks wrong and you don't know where |
| **➕ Build a Form Question…** | Builds one extra question, notice, picture (uploading it for you) or form-description injection — showing which forms it would reach *before* it writes it — and adds it to **Program_Questions**. See [Extra questions on one program's form](#extra-questions-on-one-programs-form) |
| **Update Program Questions on Forms** | Puts the current **Program_Questions** tab onto every form it names, now rather than at the next sync — and takes off any question the system added before that's no longer listed. See [Extra questions on one program's form](#extra-questions-on-one-programs-form) |
| **Push Dashboard Ticks to the Calendar** | Pushes anything the dashboard is still waiting to tell the calendar: every queued `Club` / `No_Registration` / `Personalized_Assistance` tick, plus every program's Grouped/Regular tag. Normally unnecessary — the edit trigger and the sync do it — but it's the button for "it didn't stick" |
| **Rebuild Appointment Forms + Report…** | Reshapes every `[Personalized Assistance]` form now, and reports which programs the workbook treats as appointment programs, how many free times each form offers, and why one offers none. See [Personalized assistance](#personalized-assistance-appointments) |
| **⏱️ Merge Half-Hour Blocks…** | Finds every day typed as a run of back-to-back events of the same name, and merges each into one event — see [Merging half-hour blocks](#merging-half-hour-blocks) |
| **🗓️ Review Appointment Months…** | Walks your appointment programs one month at a time — the unit a form covers — and says whether that month's form offers every date and every time in it, with the fixes on the same screen — see [Reviewing your appointment months](#reviewing-your-appointment-months) |
| **🩹 Update One Form (keeps its link)…** | Rebuilds **one** form from the current template while you wait — its dates, its questions, and its appointment times. The form keeps its ID, so **every link already handed out goes on working**. This is the single-form version of 🔧 Admin ▸ Rebuild Forms In Place; reach for it when one form has gone wrong and you don't want to sweep the whole workbook. See [Rebuild forms in place](#rebuild-forms-in-place) |
| **Link Program Across Locations…** | Puts one program's sessions at every location onto a single shared form — tags the calendar events and moves the sessions already on the dashboard. Run it again to unlink. |
| **Move Sessions to Another Form…** | Tick any sessions, then either build a **new combined form** covering exactly them, or move them onto an **existing** form. This is also how you fix a wrong form link. See [Moving sessions between forms](#moving-sessions-between-forms) |

**⚙️ Settings & Fixes**

| Item | What it does |
|---|---|
| **Sync Cal only** | Just the calendar half: reads the calendars, creates/updates forms, writes the registration links into event descriptions. Slower of the two |
| **Sync Registrations only** | Just the forms half: pulls in new responses and recomputes every count. Use this when you know nothing on the calendar has changed |
| **Show All Past Rows** | Un-hides collapsed old months — see [Old months](#old-months) |
| **Resize All Sheets** | Tidies column widths only — safe any time |

**🔧 Admin (admin accounts only):**

| Item | What it does |
|---|---|
| **🧱 Rebuild Layout (no calendar sync)** | Redraws every tab from the rows already in the workbook — see [Updating to a new version](#updating-to-a-new-version) |
| **🔗 Rewrite Event Links (fix duplicates)** | Strips every registration link off upcoming events and writes back one — see [Fixing duplicate links](#fixing-duplicate-links-in-event-descriptions) |
| **🗑️ Delete Registrations…** | Permanently deletes the registrations on the sessions you tick, optionally the form responses behind them too. For test runs and duplicates — see [Deleting registrations](#deleting-registrations). Makes you type `DELETE` first |
| **🩹 Rebuild Forms In Place (keeps links)…** | Rewrites every live form's questions from the current template, keeping each form's ID. **Every link already handed out goes on working** — see [Rebuild forms in place](#rebuild-forms-in-place) |
| **💣 Destroy & Rebuild Forms…** | Throws every live form away and builds brand-new ones. **Breaks every link already handed out** — see [Destroy and rebuild forms](#destroy-and-rebuild-forms) |
| **🏷️ Read an Event's Tags…** | Read-only. Type part of a program name and it reads that program's calendar events with the sync's own parser: every `[bracket]` in the description, which ones became settings, which were left as notes and **why**, and whether the dashboard agrees. The tool to reach for whenever a tag "isn't working" — see [Why a tag isn't sticking](#why-a-tag-isnt-sticking) |
| **Trigger Status** | Read-only. Shows what triggers your account holds, who Config says owns them, and which accounts have actually been firing them — the way to diagnose duplicates |
| **Check Triggers** | Resets automation to exactly the expected triggers — 1 daily sync, 1 hourly sync, one per calendar, and the edit trigger that makes a `Club` / `No_Registration` / `Personalized_Assistance` tick reach the calendar straight away. Safe to press any time, clears out duplicates. **Trigger-owner account only** |
| **Take Over Trigger Ownership** | Moves ownership to your account, if the recorded owner is gone. Warns you that it can't delete their triggers |
| **Release My Triggers** | Deletes the triggers *your* account created. The one useful thing a non-owner can do about a duplicate set they're responsible for |
| **Import Everything (First Run)** | The batched first import — see [First run](#first-run). **Trigger-owner account only** |
| **Find Leftover Tabs (read-only report)** | Reports old/stray tabs holding data — see [Leftover tabs](#leftover-tabs) |
| **Archive Old Months (report)** | Read-only: how much history each tab is carrying — see [Old months](#old-months) |

**Not on any menu, on purpose.** Anything that deletes or rebuilds runs from
the Apps Script editor only, by someone who went looking for it:
`mergeLegacyTabs()` (deletes tabs), `initSheet()` (rebuilds every tab),
`initializeAndSyncAll()`, `cancelBootstrapCalendars()`,
`restoreTriagedRegistrants()`, `confirmLargeTriage()`,
`recheckAllRegistrationForms()`, `cleanupNeverPolicyForms()`. They all still
work and are all still admin-gated. Keeping them off a menu that sits open all
day is about mis-clicks, not permissions.

> **Where "Sync Cal" went.** It is still there, under **⚙️ Settings & Fixes**,
> as **Sync Cal only** — and everywhere the rest of this guide says "run Sync
> Cal", pressing **🔄 Update Everything Now** does that and the registrations
> pass too, which is what you almost always want. The two are only split out
> for when you know one half is the half that is behind.

You normally don't need any of this. Automatically:

- **Sync Cal** runs **daily at ~5am**, and also whenever you edit a program
  calendar
- **Sync Registrations** runs **hourly**
- The system looks about **60 days ahead**

Press a menu item when you want something *now* instead of waiting.

> **If you're an admin and the 🔧 Admin submenu isn't there**, click
> **🔧 Admin Tools (sign-in check)…** at the bottom of the menu. Google
> sometimes can't tell the script who you are at the moment the spreadsheet
> opens, and the code deliberately assumes "not an admin" when it can't tell.
> That menu item re-checks properly and adds the submenu.

> **Check Triggers** and **Import Everything** need one thing beyond being an
> admin: that you're the account in Config's **Trigger_Owner** cell. Two
> admins building triggers is precisely what creates the duplicate sets
> neither of them can see — see
> [Admin-only actions](#admin-only-actions).

> If the menu isn't there at all, reload the spreadsheet page.

---

## When it asks "are you sure?"

Most of this workbook only affects the workbook. A few things reach **outside**
it — into live Google Forms people are registering on, or into your calendar
events. Those always ask first, in plain language, and do nothing at all if you
say no:

| You do this | It asks because |
|---|---|
| Press **Sync Cal** | It can create forms, change form dates, and edit calendar descriptions |
| Change `Type_Tag` on the program dashboard | It re-partitions that program across forms, and writes the tag onto every one of its calendar events |
| Press **🗑️ Delete Registrations…** | It **permanently deletes** registrant rows, and can delete the form responses behind them. It also makes you type `DELETE` |
| Press **🩹 Rebuild Forms In Place…** | It rewrites the questions on every live form at once. Links survive, but anyone mid-way through filling one in loses what they typed |
| Press **🔗 Link Program Across Locations…** | It tags calendar events, moves upcoming sessions onto one shared form, and rewrites the registration link on every upcoming event |
| Press **🍱 Push Menu Changes to Forms** | It builds any missing lunch sign-up month, rewrites the date labels, lunch question and description on live forms, and re-renders the lunch dashboard |
| Add a **walk-in** from the Quick Mark dialog | It writes a person into the record, and into the catering count |
| Change **Lunch Service by Location** in Config | It decides whether that location's forms ask about lunch at all |
| `mergeLegacyTabs()` (editor only) | It deletes tabs (after moving their rows to safety) |

For a **single-cell** edit, saying **no puts the old value straight back** —
the cell reverts, nothing is left half-changed.

For a **paste or fill-down** over several cells there's no single old value to
restore, so saying no leaves what you pasted on the sheet but **doesn't act on
it**: the next sync recomputes those cells from the calendar, which is the
honest undo. The toast says so at the time.

**Typing a menu into Lunch_Schedule does not ask.** It used to, on every
keystroke, and that made entering a month of menus unusable. Menu edits stay
in the workbook until you deliberately push them out — see
[Getting the menu onto the forms](#getting-the-menu-onto-the-forms).

**The two checkboxes don't ask either.** `Club` and `No_Registration` reach
outside the workbook like everything above, but a tick box is already the
question, the answer and the undo in one click — a modal on top of it would just
be a second click saying the same thing. What they do instead is tell you: the
toast names the change, and unticking reverses it. See
[The two checkboxes](#the-two-checkboxes-club-and-no_registration).

The **scheduled** runs (daily Sync Cal, hourly Sync Registrations) don't ask —
there's nobody at the keyboard to answer, and doing their job on schedule is the
point. Only a person clicking gets the question.

---

## Printed sign-in sheets

**🖨️ Print Sign-In Sheet (PDF)…** on the menu. Pick a **location**, then a
**date**, and you get a **landscape PDF** with everyone expected already on it
and empty boxes to mark up by hand:

| In CoPilot | CAME | Last | First | Phone # | Program | Family / Alt Name | Extra Notes | MEALS ORDERED | DINED IN # | TAKE OUT # | # PUT IN FRIDGE |
|---|---|---|---|---|---|---|---|---|---|---|---|

**It's a sheet for a place and a day, not for a program.** The desk is one desk
— whoever's on it signs in everybody who walks up, whichever program they came
for. So the roster is **every registrant at that location on that date, across
every program**, with a **Program** column saying which is which. One sheet, not
three.

**MEALS ORDERED is pre-filled with the real number**, not a `1` — so Joan's row
prints `4` and nobody has to remember it or cross anything out. It comes
straight from `Meals_Ordered` on her registrant row.

**Everybody appears, including the people not eating.** Anyone who didn't order
lunch is printed with a **0** in all four meal columns. That's deliberate: a
blank box is indistinguishable from one nobody's filled in yet, so at the end of
service you couldn't tell *"ordered nothing"* from *"we forgot to ask"*. A
printed 0 is already answered — nothing to serve, nothing to write, and it types
back in as the zero it is. A line under the header says so on the sheet itself.

- **Sorted by last name**, which is how somebody finds their own name on a
  paper list. Deliberately *not* grouped lunch-first: you're looking people up
  one at a time all morning, and a roster split into two alphabetical halves
  makes every lookup two lookups.
- The header line carries the day's **menu**, how many **meals** were
  **requested** (meals, not heads — the same number the kitchen was given),
  how many are **here without lunch**, and what was **ordered** (registered +
  standard buffer + tester buffer).
- **Family / Alt Name** says who a row is with: *"guest of Marion Webb"* for a
  guest, *"+2 guest(s)"* for whoever brought them.
- **Extra Notes** carries dietary needs and anything unusual about the
  registration, trimmed to what fits.
- **Eight blank rows** at the bottom for walk-ins nobody knew about.
- One page unless the roster doesn't fit, then as many as it needs.

The last four columns line up **one-for-one** with the meal counts on
Registrant_Dash, so typing a finished sheet back in is
column-for-column with nothing to reinterpret.

You can print for a **lunch-only day** (a meal with no programming behind it) —
the date picker marks those *"no program scheduled"*, and days with catering
say *"lunch served"*.

PDFs are filed in a Drive folder called **Printed Sign-In Sheets**.

---

## Instructor sign-up sheets

**👩‍🏫 Share a Sign-Up Sheet with an Instructor…** on the menu. Pick a
**location**, then a **program**, and you get a **small spreadsheet in Drive**
holding nothing but that program's roster at that location — shared with the
instructor, and **refreshing itself every hour**.

This is the live alternative to a printed sheet. Nobody has to reprint anything
and nobody has to be given this workbook.

### Why not just share this workbook

Because this workbook holds **every location's registrations**, every phone
number, the catering order, and a dozen tabs that misbehave if you type in the
wrong cell. An instructor needs one class list. So they get one file, containing
one class list, and nothing else.

**The boundary is one program at one location.** Somebody teaching Chair Yoga at
Narberth gets Narberth's roster. They do not get Ashbridge's.

### What the instructor sees

| Column | |
|---|---|
| **Event_Date**, **Event_Time**, **Location** | which session the row is for |
| **Name**, **Party_Size**, **Phone**, **Email** | who, and how to reach them |
| **Program_Status** | what *the system* says — Active, Waitlisted, Cancelled |
| **✍️ Contacted** | tick — I have reached out to this person |
| **✍️ Confirmed** | tick — they told me they are coming |
| **✍️ Waitlisted** | tick — no seat for them yet |
| **✍️ Dropped** | tick — they told me they are not coming |
| **✍️ Instructor_Notes** | anything else worth knowing |

The five **yellow** columns are the instructor's. Everything else fills in by
itself, and typing over it gets a warning — a correction typed into `Name` does
not move the registration, it just gets overwritten at the next refresh.

**Waitlisted is not the same as `Program_Status: Waitlisted`.** They answer
different questions. `Program_Status` is what the system worked out from
`Max_Capacity`. The tick is what the instructor decided about somebody they have
actually spoken to. Ticking one does not move the other — both are on the sheet
so you can see both.

### The marks come back

Every hourly registration sync reads each shared sheet's five columns back into
**Registrant_Dash**, where they are five real columns on every registrant row.
So the instructor's ticks show up in the workbook, and staff can see who has
been contacted without opening anything.

**Staff and the instructor can both work on the same roster at once.** Each
refresh remembers exactly what it sent out. On the way back:

- a cell the instructor **changed** wins;
- a cell they **never touched** leaves the workbook's own value alone.

So a status you fix on Registrant_Dash is not clobbered by a stale copy sitting
open in somebody's browser tab, and unticking a box works as an undo rather than
being ignored as "empty".

### Getting the instructor onto it

Fill in **Instructor_Email** on the **Program_Options** tab — the same row that
already holds `Room_Or_Setup` and your standing notes for that program. When you
create the sheet, whoever is named there is added as an **editor**. Several
addresses are fine, separated by commas.

Leave it blank and the sheet is still made; the dialog just hands you the link
to share yourself.

**Anyone with the link can open and edit these sheets.** That is deliberate.
They are rosters of first names, times and ticks, handed to instructors who
often have no account here at all — and the alternative in practice is a sheet
nobody can open. The dialog tells you either way, and if link sharing could not
be turned on it says so, because that is the more urgent half.

**The account that runs the syncs is put on the file too.** This is the failure
this fixes. A sheet is created by whoever clicked the menu item; it is then read
and written every hour by whoever owns the triggers, which is routinely a
*different* account. Drive shares a new file with its creator and nobody else,
so the hourly pass was refused and the round trip silently stopped: the
instructor's ticks never came back, and the workbook's rows never went out —
both sides still looking like they worked.

Now the admins and the trigger owner are added as editors when the sheet is
made, link sharing is turned on, and **a sheet made before this existed is
repaired the first time a sync can still open it**. If a sheet genuinely cannot
be opened, that is reported in plain language — naming the account that was
refused and the two ways to fix it — and it can no longer take the rest of the
run down with it: the other sheets still refresh, and the registrations
themselves were never at risk.

### Things to know

- **It costs no new trigger.** The refresh rides on the hourly registration sync
  that already runs. This matters: Google allows twenty triggers per account and
  this project already spends one per calendar, so a design needing one per
  program would have quietly stopped working somewhere around the twentieth
  class.
- **Sessions from 14 days back to 90 days ahead** are on the sheet. Backwards as
  well as forwards, because marking up last week's class on a Monday is the
  normal case.
- **Pressing the menu item again** for a program that already has a sheet
  refreshes that one and gives you the same link back. It never makes a second
  copy.
- **Superseded rows are left off** — those are registrations a later submission
  replaced, and showing them would list the same person twice with no way to
  tell which is real.
- The files live in a Drive folder called **Instructor Sign-Up Sheets**.
- **Deleting the file** is how you stop sharing. The next sync will note it
  couldn't be read; create it again from the menu if that was a mistake.

---

## Putting a registration link on the website

**The link you want is `Form_Response_Link`** on Master_Program_Dashboard — the
one that reads **View Live Form**. That is the published form, the same page a
registrant reaches from the calendar. (`Edit_Form_Link` is the editor, for you,
and must never go on a website.)

Right-click the cell and copy the link address, or click through and copy the
address bar.

**These links do not change.** It is worth saying plainly, because the system
does rebuild forms and "rebuild" sounds like "replace":

- **A form being updated keeps its link.** When the template changes, or dates
  are added to a series, or a question is added, the form is rewritten **in
  place** — same form, same ID, same URL. This happens routinely and breaks
  nothing.
- **A program being renamed keeps its link.** The form is retitled, not
  replaced.
- **A new month on a `Regular` program gets a NEW link**, because it is a new
  form. That is what `Regular` means. A program whose link must never change
  wants `[Grouped]` — one form for the whole run, one link forever.
- **🩹 Rebuild Forms In Place keeps every link.** It rewrites the questions on
  every live form at once, and each form stays the same form — see
  [Rebuild forms in place](#rebuild-forms-in-place).
- **The one thing that does break links is 💣 Destroy & Rebuild Forms**, below.
  It says so twice before it runs, and it is an admin action nobody presses by
  accident.

So a button on the website pointing at a `[Grouped]` program's form is safe
to set once and leave. For a `Regular` program, the button needs updating
when the new month's form appears — which is the same job as updating the
calendar, and the link is on the dashboard row for the new month's sessions.

> **The lunch sign-up links** work the same way and are **pinned to the top of
> Master_Lunch_Dashboard**, one per location per month, so you don't have to go
> looking for them. Those are `Regular` by nature — a month is a month — so
> they change each month by design.

---

## Rebuild forms in place

**🔧 Admin ▸ 🩹 Rebuild Forms In Place (keeps links)…** — the one to reach for
once forms are live and their links are out in the world.

> **One form, not all of them?** **📝 Programs & Forms ▸ 🩹 Update One Form
> (keeps its link)…** does exactly the same repair to a single form, and
> finishes before the dialog closes. Pick the form from the list (or paste its
> editing URL), press the button, and that's the job — no background sweep, no
> other form touched. Everything below applies to it too: the link survives,
> outstanding responses are imported first, and anyone part-way through filling
> that form in has to start again.

It does what the hourly sync's own repair does — rewrites a form's questions
from the current template, in the same form, under the same ID and the same URL
— except that it does it to **every** form covering an upcoming session, on
demand, and without first asking whether each one looks out of date.

**That last part is the reason it exists.** The automatic repair only touches a
form it judges *stale*. A form somebody has hand-edited **within** the
template's shape — a reworded question, a deleted choice, an extra box — does
not look stale to it, so it is never fixed. This rebuilds every form in the
list regardless, which is what "put the forms back the way the system wants
them" has to mean.

**What it does.** For every form covering an **upcoming** session:

1. **Imports outstanding registrations first.** Rebuilding deletes the
   questions a response's answers hang off, so a response still sitting
   unimported on a form would lose its detail. If that import fails, **nothing
   is rebuilt** — you'll get a message saying so.
2. Empties the form and rebuilds it from the current template: its dates, its
   sign-up wording, its lunch questions, its program questions, its
   appointment times, its notice and picture.
3. Refreshes the dashboard's **View Live Form** link, whose pre-ticked boxes
   are keyed to the questions the rebuild just replaced.

**✅ Every registration link keeps working.** The form keeps its ID, so a link
in an email, on a flyer, or in a calendar invite opens the same form it always
did. Nothing goes to the trash and no calendar event is touched.

**What survives:** all registrations. Rows on Registrant_Dash are untouched,
club memberships are untouched, "sign up for every date" registrants are
untouched — the form they are recorded against still exists.

**The one real cost:** anybody part-way through filling in a form at that exact
moment has to start again, and the per-question detail of a response that
somehow arrives between the import and the rebuild is lost. Both are the same
cost the hourly repair already carries.

**Forms with no upcoming sessions are left alone**, for the same reason as
below: closed business, and nobody's route to anything.

It asks once, with the list of forms it would rewrite, and then **finishes the
whole list on its own**. One run is capped at six minutes, which is a few
forms; the rest continue in the background, a batch at a time, until every form
is done. You do not click it again. A toast reports progress as it goes
("4 done, 11 to go"), and the last one tells you it has finished.

> If you ever need to stop it mid-way, run `cancelInPlaceFormRebuild()` from
> the Apps Script editor. Whatever has been rebuilt stays rebuilt.

---

## Destroy and rebuild forms

**🔧 Admin ▸ 💣 Destroy & Rebuild Forms…** — the last resort, and almost
certainly not what you want.

**Try the gentler thing first.** Every registration sync already rebuilds
out-of-date forms **in place, keeping their links** — nobody has to do
anything, and no link breaks. If you don't want to wait for the next hourly
run, **🩹 Rebuild Forms In Place** one menu item up does the same rewrite on
every live form immediately (and reaches hand-edited ones the automatic repair
skips); `recheckAllRegistrationForms()` from the Apps Script editor is the same
sweep restricted to forms that look stale. Between them they fix a form that is
merely out of date or hand-edited.

**This is for a form that's broken past that:** hand-edited into a state the
system can't read, questions deleted, responses corrupt, or one Google won't
open at all. In those cases the form's ID isn't worth keeping — it's the thing
tying you to the broken object.

**What it does.** For every form covering an **upcoming** session:

1. **Imports outstanding registrations first.** A response submitted since the
   last sync lives only on the form, and throwing the form away would take it
   with it. If that import fails, **nothing is rebuilt** — you'll get a message
   saying so.
2. Builds a brand-new form from the current template, covering that form's
   upcoming dates, keeping its name and its arrangement (a cross-location form
   stays cross-location; a combined form stays combined).
3. Repoints the dashboard's `Form_ID` and both link columns, and rewrites the
   registration link in every affected **calendar event**.
4. Moves the old form to the **Drive trash** — recoverable for 30 days, never
   hard-deleted.

**⚠️ Every registration link already handed out stops working.** Anything this
system controls is updated for you. A link in an email somebody sent last week,
or on a printed flyer, points at a trashed form.

**What survives:** all registrations. Rows on Registrant_Dash are
untouched, club memberships are untouched, and "sign up for every date"
registrants are carried across to the new form so they keep being booked onto
dates the series gains later.

**Forms with no upcoming sessions are left alone.** They're closed business,
their links are nobody's route to anything, and replacing them would break the
archive for nothing.

It asks twice: a summary you can read, then a box you have to type `REBUILD`
into.

**How much it does per run depends on how much there is to do.**

- **50 forms or fewer** — it does up to **eight per run**, and tells you how many
  are left. Run it again for the rest.
- **More than 50** — one click starts a **background sweep**. It rebuilds a few
  at a time and re-arms itself until every one is done, so **you don't run it
  again**. Progress toasts as it goes. Calendar sync and registration sync pause
  for the duration and switch themselves back on at the end — same machinery as
  **Import Everything (First Run)**, which works the same way and for the same
  reason. If a sweep ever gets stuck, `cancelFormRebuildSweep()` from the Apps
  Script editor stops it and restores automation; whatever was already rebuilt
  stays rebuilt.

---

## Moving sessions between forms

**📄 Move Sessions to Another Form…** on the menu. Tick
any sessions you like, then pick where they go:

**Build a new combined form.** For the one-off that the grouping tags can't
describe — *"these four different programs are one Tuesday afternoon this month;
put them on a single form so people sign up once."* You can name it, or let it
name itself.

**Move onto an existing form.** For fixing a wrong or stale form link on a
session or a whole run of them. Pick a form from the list, or paste its URL.

> Paste the **edit** URL (`.../forms/d/<id>/edit`), not the published
> `/d/e/...` one people fill in — that link doesn't contain the form's ID, and
> the dialog will tell you so rather than failing obscurely.

Either way, the same things are brought into line: the `Form_ID` and both link
columns on the dashboard, the **date list on the destination form**, its sign-up
options, and the registration link in every affected **calendar event**.

**On a combined form every date names its own program** — *"Mon, Jan 5, 2026 ·
Chair Yoga · Narberth"* — because a bare date on a form covering four programs
tells a registrant nothing, and two programs on the same day would otherwise
produce two identical rows (which Google Forms rejects outright).

**Registrations already collected are not moved.** They stay attached to the
session they were made for, which is correct — the session didn't change, only
the form people reach it through. Anyone registering after the move comes in on
the new form.

> Sessions of a program you've moved may pull *future* dates onto the new form
> too, since the system learns "this program's form is that one" from the rows
> on the sheet. If you want a one-month-only combination, check the next sync's
> result and move anything you didn't want back.

---

## Renaming a program

Change the title on the program's calendar events and run **Sync Cal**. That's
it — but it's worth knowing what the system does behind that, because it used
to do considerably less.

**What moves across:** the sessions themselves (and therefore every registrant
attached to them, past and future), anything already in
`Deleted_Event_Triage`, the club roster if it's a club, your standing notes on
`Program_Options`, and the record of who has already been sent a calendar
invitation. The **form is kept and renamed to match**, so every registration
link already handed out keeps working and stops advertising the old name.

> **Why this needed doing.** A session's internal ID is built from the calendar,
> the date, *and the title* — so renaming a program re-keyed every one of its
> sessions, and to the rest of the system that looked exactly like "twelve
> sessions were deleted and twelve unrelated ones appeared". You'd get the
> sessions swept into `Deleted_Event_Triage`, which is at least visible. The
> other three losses were silent: a renamed **club** stopped booking its
> standing roster and said nothing, your `Program_Options` notes were stranded
> under the old name, and the invite ledger forgot who it had already emailed.

**It has to be sure first.** A rename is only distinguishable from "one program
ended and another started" by evidence, so all four of these must hold before
anything is moved:

1. The program looks new — nothing already links its name to a form.
2. It nonetheless resolves to an **existing form**, either from the
   registration link still in its calendar descriptions or from the form
   registry.
3. Every row of that form carries exactly **one** other name. If two programs
   share a form (which **📄 Move Sessions to Another Form…** can do), which one
   was renamed isn't answerable.
4. That other name is **gone from every calendar** it can read. If it's still
   there, both names exist and this is a split, not a rename.

Anything less and it leaves well alone, behaving exactly as it did before —
sessions to triage, recoverable by hand. Two renamed-looking programs pointing
at the same form disqualify each other. Every rename it does act on is logged
and goes in the admin digest, so you can see it happened.

> **Past sessions are renamed too.** A form spans months, and renaming only the
> recent half would leave older sessions pointing at IDs their own registrant
> rows no longer carry. One program, one name.

> **What if you rename only *some* of a program's events?** That's condition 4
> failing — both names are live, so it's treated as two programs, which is
> almost certainly what you meant. Rename all of them if you meant a rename.

---

## Deleting registrations

**🗓️ Calendar & Form Manager ▸ 🔧 Admin ▸ 🗑️ Delete Registrations…**

> **This moved into the Admin submenu.** It is permanent and irreversible,
> which is what it has in common with the rest of that submenu — and it was
> sitting one slot away from menu items that are ordinary day-to-day
> corrections.

Everything else in this system **cancels**. Someone who drops out is marked
`Cancelled` and stays on the tab; a session whose calendar event disappears
sends its people to `Deleted_Event_Triage`. That's deliberate — who signed up
for what is worth keeping.

This is the exception, for rows that aren't history at all:

- a **test run** — four submissions made while checking the form worked, by
  people who don't exist;
- a **duplicate import**, or rows made against a session that was set up wrong
  and rebuilt;
- a program **cancelled before it ever ran**, where nobody wants a permanent
  list of people who were going to come.

**How it works:**

1. Open the dialog. It lists every session with registrations from the last
   four months and the next six, with a count on each.
2. Tick the sessions.
3. Optionally tick **"delete the matching form responses too"** — see below.
4. Type `DELETE` in the confirm box. The button stays greyed out until you do.

The registrant rows go, and the catering numbers and the dashboard counts are
recalculated straight away.

**And they stay gone.** Deleting used to look like it hadn't worked: the rows
vanished, and the next sync quietly put them back. Three different things did
that, each doing exactly what it was built to do — the *"sign up for every
date"* registry re-books its people onto every date of a form forever, a club
roster re-books every active member into every upcoming meeting, and a form
response left in place gets re-imported the moment anything moves the sync
clock backwards. None of them had any way to know a human had deliberately
removed a row.

Now deleting records that decision, per person per session, and all three paths
check it. What it does **not** do is block the person: they can register for
other dates, be added as a walk-in, or be restored from triage, and **a
genuinely new form submission for the same person and session comes straight
through** — signing up again is them saying they're coming after all, and a
past deletion has no business overruling that. Re-reading the *same* response
the deletion was aimed at stays blocked, however many times it comes round.

> **To record that somebody isn't coming, don't use this.** Set their
> `Program_Status` to `Cancelled` on **Registrant_Dash** — the row
> and the history stay, and the catering counts drop them either way.

**About deleting the form responses.** Deleting the rows doesn't touch the
Google Form responses they came from. Left alone those responses sit in the form
and would come back on a full re-import — which is exactly what clearing out a
test run doesn't want. So it's offered as a separate tick, **off by default**,
because it's the one part that can't be undone from inside the workbook.

> One response can cover several rows — a party of four, or one person across
> six dates of a grouped form. Deleting the response removes that whole object.
> The rows for the other dates are left alone (they're the record), but the
> response behind them is gone.

**Clubs still need unticking.** Deleting a club member's row for a future
meeting now sticks — that meeting won't be re-booked. But membership itself
lives on `Club_Members`, so they are still booked into every *other* upcoming
meeting, and into new ones as they appear. To take somebody off a club, untick
**Active** on `Club_Members`. The dialog flags the sessions where this
applies.

---

## Leftover tabs

Over time a workbook collects tabs that hold real data but nothing reads any
more:

- `Active_Programs` — the session table's original name
- `Lunch_Schedule_OLD_…` / `Config_OLD_…` — renamed automatically when an older
  layout was found
- `Copy of …`, `… (old)`, anything made by hand while troubleshooting

Those rows are invisible to every sync and quietly rot. Two steps deal with it:

1. **🔧 Admin ▸ Find Leftover Tabs (read-only report)** — lists what it found,
   which current tab each one matches, and how many rows are in it. Changes
   nothing, so run it first.
2. **`mergeLegacyTabs()`** — folds the rows in, then deletes the tabs. It names
   every tab before doing anything and does nothing if you say no.

   **This one is not on the menu.** It deletes tabs and there's no undo beyond
   File ▸ Version history, so it is run deliberately from
   **Extensions ▸ Apps Script**: pick `mergeLegacyTabs` from the function
   dropdown and press Run. It's still admin-gated — a non-admin running it
   there gets refused.

**How it decides.** By the tab's **column headers**, not its name — so a tab
called anything at all is handled, and a tab of your own notes is left alone
(it needs a key column plus most of its columns to be recognizably ours). Old
tabs with **fewer** columns, or columns in a different order, migrate correctly.

**Existing rows always win.** A leftover row is added only if it isn't already
there, so nothing current is ever overwritten by something older, and re-running
is harmless. Merged rows get a note saying which tab they came from.

**A tab is deleted only after its rows are safely written.** If anything fails,
the tab stays put so you can try again. Deleted tabs are recoverable from
**File > Version history** for a while.

> You do **not** need this for ordinary column changes. When a tab's columns are
> re-ordered or added to, the system re-aligns its existing rows by header name
> automatically on the next sync.

---

## First run

The very first import is the one genuinely big job this system ever does: it
has to build a registration form for **every program on every calendar**, and
write a link into **every event**. That is far more than Google gives a script
in a single run, so pressing **Sync Cal** on a busy calendar times out
part-way — and a timed-out sync leaves things half-done: triggers switched off,
some programs imported, and forms it had just created forgotten (so a second
attempt makes duplicates).

**🔧 Admin ▸ Import Everything (First Run)** exists for exactly this (the
🔧 Admin submenu only shows for admin accounts — see
[Admin-only actions](#admin-only-actions)):

- It **pauses all automation** first — the scheduled syncs and the
  calendar-watch triggers — and keeps them paused for the whole import, not
  just the first minute of it. **Check Triggers** deliberately does nothing
  while it's running (it says so); the import puts everything back itself.
- It imports in **batches across several background runs**, a few minutes
  apart. The first batch happens while you watch; the rest carry on by
  themselves. Nothing is lost if a batch is cut short — the next one picks up
  where it left off.
- Programs whose events **already carry a registration link** keep their
  existing form; it isn't replaced.
- When it's done it **rebuilds every trigger**, redraws the dashboard, and
  toasts a summary. The link it wrote into each calendar event is *not*
  treated as a calendar change to react to, so finishing doesn't kick off a
  pile of syncs.

Press it once and let it run — expect a few minutes for a small calendar and
up to half an hour for a big one, and watch rows appear on
**Master_Program_Dashboard** as it goes. Pressing it again is harmless:
anything already imported is skipped, which also makes it the way to recover
if an import was interrupted. When it finishes, run **Sync Registrations** (or
just wait for the hourly run) to pull in responses to any forms that already
existed.

---

## Updating to a new version

When new code is pasted into the Apps Script editor, the *tabs* are still
drawn the old way — new columns, panels and formatting don't appear until
something redraws them.

**🔧 Admin ▸ 🧱 Rebuild Layout (no calendar sync)** does exactly that, and
nothing else. It reads the rows already sitting on your tabs and redraws every
one of them in the current layout.

**It does not touch anything outside the spreadsheet:**

| Rebuilt from what's already here | Left completely alone |
|---|---|
| Master_Program_Dashboard | Your **calendars** — not read, not written |
| Registrant_Dash | Your **registration forms** — none opened or changed |
| Lunch_Schedule (+ the ADD block) | The **triggers** — automation keeps running as it was |
| Master_Lunch_Dashboard (hand-entered columns kept) | |
| Deleted_Event_Triage | |
| Member_Roll / Program_Options (your notes kept) | |
| Club_Members (the roster is kept exactly as it is) | |
| Config, tab order, widths, dropdowns, colours | |

**Nothing can be removed by it.** A normal sync cross-checks sessions against
the live calendar and moves registrants to triage when an event has gone —
this deliberately skips that step, so an unreachable calendar can't be
mistaken for a cancelled program.

It tells you what it found before doing anything ("1,240 registrant rows,
830 sessions…") and does nothing if you say no. Safe to run twice.

**Use it when:** you've pasted new code, or a tab looks wrong and you want it
redrawn.

**Don't use it when:** the workbook is empty — there's nothing to rebuild
*from*, and it'll say so. That's what **Import Everything (First Run)** is for.

> Rebuilding a **copy** of the workbook? Press **Check Triggers** afterwards
> too. The rebuild deliberately doesn't touch automation, and a fresh copy has
> no triggers of its own yet.

**What to expect the first time you update to the version with clubs, phone
numbers and split meal counts:**

1. **Rebuild Layout** adds the new columns (`Phone`, `Email`, the five meal
   counts) and the new **Club_Members** tab, and moves the lunch dashboard's
   buffers out of hand-entry. Anything already in `Dine_In_Count` /
   `Subs_Count` is carried across into `Day1_Dined_In` / `Subs_Dined_In`
   automatically.
2. **Check Config.** A new **📧 Calendar Invitations** block appears, set to
   *Invite registrants*. If you don't want Google emailing your members, set it
   to **Do not invite** before the next registration sync. Nothing is sent for
   sessions that have already happened either way.
3. **The live forms update themselves.** Each registration sync rebuilds up to
   five forms onto the new layout, keeping the same links, so give it a few
   hours to work through them — or run `recheckAllRegistrationForms()` from the
   Apps Script editor to start now.
4. **Run Sync Cal once** so the `Club` column fills in for programs you've
   tagged.

**And when you update to the version with the registration horizon:**

1. **Rebuild Layout** adds the **🚧 Registration Open Through** block to Config.
   It arrives **blank**, which means *no horizon* — every session stays open
   and nothing about your workbook changes until you put a date in it.
2. **Nothing to undo.** Leaving it blank forever is a perfectly good answer;
   the feature costs nothing when it isn't used. See [Registration Open
   Through](#-registration-open-through).

**And when you update to the version with the two checkboxes:**

1. **Rebuild Layout** adds the `No_Registration` column and turns both it and
   `Club` into checkboxes. A `Club` column that currently holds the word
   *"Club"* still reads correctly in the meantime.
2. **Run Sync Cal once.** It rewrites those columns as real ticks and picks up
   any `[No Registration]` tags already in your calendar descriptions.

---

## Fixing duplicate links in event descriptions

Event descriptions collect registration links. Google Calendar rewrites the
HTML in a description whenever someone edits the event in the web UI, and a
link that goes through that can come back out as **plain text sitting next to
the original** — so one event advertises the same form twice, in two formats.
Copy-pasting an event to duplicate it brings whatever was there along with it,
and older versions of this system wrote a different format again.

**🔧 Admin ▸ 🔗 Rewrite Event Links (fix duplicates)** clears the lot and
starts again:

1. Every **upcoming** event on all program calendars is scanned.
2. **Every** registration link is removed — all copies, all formats: the
   current hyperlink, the older `Registration Link: … [Form ID: …]` line,
   flattened plain-text links, and orphaned "📝 Register for …" labels.
   The line an earlier version wrote while links were hidden — "📝
   Registration for … is available on our dashboard/website. [Form: …]" — comes
   off too, marker and all. That sentence carries no URL, so nothing used to
   recognize it: switching [🔗 Registration Link in Events](#-registration-link-in-events)
   from **Hide link** back to **Show link** put the new link in above it and
   left the event advertising registration twice, the second time pointing at a
   form that had since been replaced.

   The "🚧 Registration Not Yet Open" notice comes off with them, in
   whatever shape Calendar handed it back — including the re-encoded
   `&#128679;&nbsp;Registration Not Yet Open` a hand-edited event comes back
   as, which is what used to leave an event showing a register link with the
   old "not open yet" line still sitting underneath it.
3. Then **one** link is written back at the **top** of the description — or
   none, if Config's [🔗 Registration Link in Events](#-registration-link-in-events)
   says **Hide link**.

**Everything else in the description is kept exactly as it was** — room notes,
volunteer names, `[Cap: 12]`, `[Grouped]`, other hyperlinks, and your paragraph
breaks. Only the blank space left behind by a removed link is closed up.

Which form each event gets is read from the **program dashboard**
(`Event_ID` → `Form_ID`), not from the description being replaced — the
description is the thing that's wrong, so it can't also be the source of truth.

- **Past events are never touched.** Their descriptions are a record of what
  people were sent, and rewriting them would generate calendar notifications
  for events that already happened.
- **The calendar-watch triggers are switched off while it runs**, and rebuilt
  when it finishes — including if it fails part-way. Every description it
  writes is a calendar edit, and with the watchers live a run over a few
  hundred events would queue a few hundred syncs. The summary tells you how
  many triggers were rebuilt; if it ever says it couldn't, run **Check
  Triggers**.
  - It only ever puts back triggers **your account already had**. If you
    weren't holding any and you're not the recorded
    [Trigger_Owner](#7-config), it rebuilds nothing
    rather than creating a fresh set under you — that set would be invisible
    to the owner and would double every sync from then on.
- It **won't run during "Import Everything"** — that import has the same
  triggers deliberately paused and restores them itself.
- **An event with no form on the dashboard** still gets its old links removed
  (a stale link to a form nobody reads is worse than none) but nothing written
  back. Those are counted in the summary and go in the admin email — run
  **Sync Cal** to build their forms, then run this again.
- Safe to run twice; the second run reports everything already correct.

> Any link to a **Google Form** in a program event description is treated as a
> registration link and removed. On these calendars that's always this
> system's link — but if you've hand-added a link to some *other* Google Form
> in an event, it will go too.

---

## Admin-only actions

A handful of actions restructure the workbook or the project's automation
itself — rebuilding every tab, creating/deleting triggers, running the
multi-hour first import, or overriding a safety limit. Those are restricted to
specific Google accounts:

- **whoever owns this spreadsheet** — always, and this cannot be edited away;
- plus every address listed in `AUTHORIZED_ADMIN_EMAILS` near the top of the
  code, currently `admin@newhorizonsseniorcenter.org`.

> **The owner is always on the list on purpose.** `AUTHORIZED_ADMIN_EMAILS` is
> a hard-coded list, and a hard-coded list of email addresses goes stale: a
> shared mailbox that was never actually made, or somebody who has left. When
> that happens *every* admin action refuses and names an account nobody can
> sign in as — including **Rebuild Layout**, which is how a new version of the
> code gets installed. That left no way back except editing the source. The
> owner can already change the code, delete the tabs and reshare the workbook,
> so gating them out protected nothing.

**Gated:** Rebuild Layout, Rewrite Event Links, Rebuild Forms In Place,
Destroy & Rebuild Forms,
Trigger Status, Check Triggers, Take Over Trigger Ownership, Release My
Triggers, Import Everything (First Run), Find Leftover Tabs, Archive Old
Months (report), `mergeLegacyTabs()`, `initSheet()`,
`initializeAndSyncAll()`, `cancelBootstrapCalendars()`, `confirmLargeTriage()`,
`restoreTriagedRegistrants()`, `recheckAllRegistrationForms()`,
`cancelInPlaceFormRebuild()`, `cleanupNeverPolicyForms()`.

Everything on that list is under the **🔧 Admin** submenu or has no menu entry
at all. The rule now is simply: **if it's on the main menu, anyone who can edit
the workbook can run it.**

**A second, narrower gate on top of that: trigger ownership.** Being an admin
is no longer enough to *build* triggers — two admins is exactly enough people
to cause the duplicate-trigger problem, since each one's set is invisible to
the other. So **Check Triggers** and **Import Everything** additionally
require that you're the account recorded in Config's **Trigger_Owner** cell.
The first admin to run **Check Triggers** claims it; everyone else gets a
message naming the owner. If that account is genuinely gone, use **Take Over
Trigger Ownership**, which explains up front that it *cannot* delete the old
owner's triggers — only the Apps Script editor's Triggers page can do that.

**Not gated, by design:** everything on the main menu — ⚡ Quick Mark, Sync
Cal, Sync Registrations, the two lunch-menu items, Print Sign-In Sheet, Invite
Registrants to Calendar Events, Push Dashboard Ticks to the Calendar, 🔗 Link Program Across Locations…, 📄 Move Sessions to Another
Form…, Show All Past Rows, Resize All Sheets — plus everyone's ability to
register, edit rows, and view every dashboard. Ordinary day-to-day use needs no
special account, and the desk should never have to wait for an admin to come
and press a button.

> **🗑️ Delete Registrations… is gated, and is why it moved.** It permanently
> removes registrant rows and can delete the form responses behind them, which
> is not an ordinary correction — so it now lives in the **🔧 Admin** submenu
> and checks the signed-in account, in both `showDeleteRegistrationsDialog()`
> **and** `deleteRegistrationsForSessions()` (both, since the dialog calls the
> second directly and a submenu that merely doesn't *appear* stops nobody).
>
> **One open action can still lose data.** 📄 **Move Sessions to Another
> Form…** moves live sessions onto a different form, and is open because
> fixing a wrong form link is a real day-to-day job. What protects it is the
> dialog: it lists every session and every headcount it is about to touch
> before anything happens. Read the list. Nothing else is going to
> stop you.
>
> If you need that one behind an account check too, add
> `if (!requireAuthorizedAdmin('Move Sessions')) return;` as the first
> line of `showRepointSessionsDialog()` **and**
> `repointSessionsToForm()` — both, since the dialog calls the second
> one directly.

> **The menu split is convenience, not security.** Admin items are hidden from
> the menu for non-admins, but anyone with edit access to the spreadsheet can
> open **Extensions ▸ Apps Script** and run any function by name. What actually
> stops them is the `requireAuthorizedAdmin()` check inside each gated
> function, which refuses regardless of how it was started. If you need real
> access control, that comes from **who you share the spreadsheet with**, not
> from this list.

If someone outside that list runs a gated action, nothing happens — no tabs
rebuilt, no triggers touched, no data changed — and they see a toast (and the
log gets a line starting with ⛔) naming which accounts are allowed. There's
no partial effect to clean up.

**Why this exists:** an installable trigger in Apps Script belongs privately
to whichever Google account created it — one account's code can't even see
another's triggers, let alone remove them. Before this restriction, two
people each pressing "Check Triggers" from their own logins built two
separate, mutually invisible sets of calendar-watch triggers that both fired
on every edit forever. Restricting who can press that button is the fix at
the cause; see **Troubleshooting**, "The same event seems to trigger a sync
twice," for the recovery steps if this already happened to you.

**To change who's on the list:** edit `AUTHORIZED_ADMIN_EMAILS` in the Apps
Script editor and save — no other code needs to change. Emptying it is safe:
the spreadsheet's owner is an admin either way, so there is no way to lock
everybody out.

---

## Old months

Every date-sorted tab grows in one direction forever. A year in, the **Past**
section of Registrant_Dash is thousands of rows nobody scrolls
through.

**What happens now.** Past rows older than **this month and last month** are
**hidden**. The Past banner says how many:

> 🕓 Past Registrants — 1,240 row(s) before 2026-07 are hidden (they're still
> here and still searchable; "Show All Past Rows" on the menu brings them back)

Nothing is moved and nothing is deleted:

- Every count, dashboard, rollup and Member_Roll figure is unchanged — they
  read the rows, not the screen.
- **Ctrl+F still finds a hidden row.** "Was Marion here last March?" still has
  an answer; the tab just doesn't open onto last March.
- **🕓 Show All Past Rows** brings everything back on every tab at once. They
  collapse again on the next sync.

**Checking the size.** **🔧 Admin ▸ Archive Old Months (report)** counts what
each tab is carrying, by month, and says whether it's worth doing anything
about. It's read-only.

### When hiding isn't enough

Hiding solves *being in the way*. It doesn't solve *cost*: those rows are still
re-read and re-written on every render, and a full render has to finish inside
Apps Script's 6-minute limit. Somewhere north of ~150,000 cells across the
history tabs (the report tells you), that stops being comfortable — probably
2–4 years in at this size, sooner if registrant volume grows.

Three ways out, worth knowing before you need one:

**1. Archive to a second spreadsheet, once a year.** Rows older than N months
move to `Program Registrations — 2026` and off these tabs. Cheapest to run and
the only option that actually reduces the working set. Costs: history is in
another file, so a year-boundary question means opening two; and the move has
to be transactional (write there, verify, only then delete here) or a failure
halfway through loses rows. **The recommended one when the report says to act.**

**2. Archive to tabs in this workbook** (`Registrants_2026`). Keeps everything
in one file and is easy to undo. But Sheets' 10-million-cell limit is
per-file, so this defers the cell problem rather than solving it — it only
fixes render time. Reasonable as a first step.

**3. Summarize instead of archiving.** Replace each old month with one row per
program per month (attendance, meals served, no-shows). Enormous reduction,
and it answers the questions anyone actually asks of old data. But it is
**lossy** — "which Tuesdays did Marion come to?" is gone forever. Only do this
alongside 1 or 2, never instead of them.

**Not recommended: deleting.** These rows are the only record that a person
attended and was fed. Whatever the retention policy ends up being, it should be
a decision someone makes on purpose, not a side effect of a tab getting long.

---

## Common tasks

**Add a new program**
Create the calendar event — program name as the title, any `[Cap: N]` / `[Fixed]`
settings in the description. Wait for the next sync (or press Sync Cal). The
registration link appears in the event description and on the dashboard.

**Build next season's calendar without opening sign-ups yet**
Put the last date registration should be open for in **🚧 Registration Open
Through** on Config, then build the calendar as far ahead as you like. Anything
past that date goes up as a normal calendar event, but its description reads
`🚧 Registration Not Yet Open` and its form doesn't take responses. When you're
ready, move the date forward — that's the whole operation. See [Registration
Open Through](#-registration-open-through).

**Open registration for the next block of programs**
Change the date in **🚧 Registration Open Through** on Config and run **Sync
Cal** (or **🔗 Rewrite Event Links** to update the calendar immediately). The
register links go back on and the forms re-open.

**Change a program's capacity**
Edit `[Cap: N]` in the event description. New sign-ups respect the new number on
the next sync; already-recorded rows keep the status they were given.

**Change what's for lunch**
Edit the row on **Lunch_Schedule** — it stays where it is, no dialog. To get it
onto live forms now, press **🍱 Push Menu Changes to Forms**; otherwise the
daily sync does it.

**Add a month of menus at once**
Paste your CSV into the **➕ ADD MENU ITEMS** block at the bottom of
**Lunch_Schedule**, or use **🍱 Add Menu Items (paste/upload CSV)…** on the
menu. See [Adding menu items](#adding-menu-items--paste-csv).

**Run one program at two locations off a single form**
**🔗 Link Program Across Locations…** on the menu, type the program name, say
yes. Every location's events get the `[All Locations]` tag, the sessions
already on the dashboard move onto one form, and each date on that form now
says where it is. See [One form across several
locations](#one-form-across-several-locations).

**Mark a week of a recurring program as cancelled**
Rename that one event so its title starts with `*` — `*NO Tai Chi`. It stays on
the calendar for everyone to see, and the system skips it: no form, no
dashboard row, no lunch counted for that date.

**Rename a program**
Change the title on the calendar events and run **Sync Cal**. Everything moves
across with it — sessions, registrants, the club roster, your notes — and the
form is renamed to match. See [Renaming a program](#renaming-a-program).

**Mark people in on the day**
**🗓️ Calendar & Form Manager ▸ ⚡ Quick Mark Attendance / Lunch…** — location,
session, name, then tick Attended and/or Lunch. See
[Quick Mark](#-quick-mark--the-fast-way-to-mark-people-off).

**Mark a take-out lunch for someone who isn't attending**
Same dialog — pick their name and tick **Lunch** on its own. It marks
`Lunch_Served` without marking `Attended` (and clears `Attended` if it was
already ticked by mistake).

**Give somebody the link to sign up for lunch online**
Top of **Master_Lunch_Dashboard** — right-click the `Sign_Up_Link` for their
location and month, copy, paste. See
[The lunch-only sign-up form](#the-lunch-only-sign-up-form).

**Let people register for a month of lunches without coming to a program**
Put the month's `Hot`/`Cold` rows on **Lunch_Schedule**, then run
**🥡 Build / Refresh Lunch Sign-Up Forms**. The form and its link appear at the
top of the lunch dashboard; on it, *"I want lunch on every date listed"* books
the whole month in one page.

**Sign someone up for a future lunch at the front desk**
Same dialog — pick the location, pick **that day's** session (or **🥡 Lunch
Only (no program)**), pick or type their name, tick **Sign up for lunch**. See
[Signing someone up for lunch at the desk](#signing-someone-up-for-lunch-at-the-desk).
For a month of lunches, repeat once per date; the dialog keeps the location.

**See exactly who is eating on a given day**
**Lunch_Roster** — one row per person per date and location, with the programs
they signed up for, whether they've been served, and their phone number. That's
the list to hand meals out against and to type into CoPilot. See
[Lunch_Roster](#3-lunch_roster).

**Check how many lunches actually went out**
Compare `Registered_Count` (what the forms said) with `Served_Confirmed` (what
you ticked) on **Master_Lunch_Dashboard**. Both count **people**, so somebody
who asked for lunch on three of the day's forms is one of each.

**Note that someone always brings a guest**
Put it in `Usual_Guests` on **Member_Roll**. It stays there forever — nothing
overwrites your columns on that tab.

**Cancel one person's registration**
On **Registrant_Dash**, set their `Program_Status` to `Cancelled`.
The `Manual_Override` cell turns purple and the row is protected from being
overwritten — and the **lunch numbers update immediately**, with a toast
telling you the new count:

> ✅ Catering numbers updated: Narberth, Mon Sep 14 — 12 registered, 14 to order

Same for a whole block: select several `Program_Status` or `Lunch_Status` cells
and fill or paste `Cancelled` down them; it recalculates once, for every date
you touched.

**Add a walk-in who never filled out the form**
Use **⚡ Quick Mark**: pick the location and session, choose **➕ Someone not on
this list…** and type their name, then tick Attended and/or Lunch. It offers to
add them, then does it — the row is flagged `Manually Added` and never
overwritten. (You can
still add the row by
hand and set `Manual_Override` to `Manually Added` yourself if you prefer.)

**Move someone off the waitlist**
Change `Program_Status` from `Waitlisted` to `Active`. You'll get a reminder
toast to also update their `Lunch_Status` to `Needed` if they're eating.

**A session was cancelled**
Delete the calendar event. On the next sync the session leaves the dashboard and
any registrants move to **Deleted_Event_Triage** so you can contact them.

---

## Things to know

**Purple rows are protected.** Anything you hand-edit gets marked
`Manually Edited` (or `Manually Added`) and the system stops touching it. That's
what keeps your corrections from being wiped — but it also means a protected row
won't pick up later form changes.

> **One exception, on Master_Lunch_Dashboard.** Typing into that tab's pencil
> columns — `Actual_Ordered` and the reconciliation numbers beside it — marks
> the row `Manually Edited` like anywhere else, but the **counted** columns
> (`Registered_Count`, `Served_Confirmed`, the meal type, the buffers) keep
> updating. They have to: recording what you ordered at 9am must not stop the
> row counting the four people who sign up at 11. Your typed numbers are never
> overwritten. A row you added yourself (`Manually Added`) is still left alone
> completely.

**Names are matched loosely.** "Jane Smith" and "jane smith " are treated as the
same person, so a person doesn't get double-counted or double-catered — including
across several programs on the same day, which is what stops three lunch
requests from one person becoming three meals on the order.

**The dashboards are rebuilt, not patched.** Master_Program_Dashboard and the
Today blocks are regenerated from scratch each sync. Only the pencil columns on
Master_Lunch_Dashboard and manually-marked registrant rows survive.

**`Type_Tag` lives on the calendar, not the sheet.** The Grouped/Regular cell
on the program dashboard is a view of what the calendar event's description
says. Changing it writes the new value back onto every one of that program's
calendar events — that's what makes it stick. If it can't reach the calendar
at that moment you'll get a warning toast; press **Push Dashboard Ticks to the Calendar** and it goes through. Without that, the next sync
quietly puts the old value back.

**`Club` and `No_Registration` live on the calendar too**, in the same way and
for the same reason — they come from the `[Club]` and `[No Registration]` tags
in the event description. Ticking one is a real change, not a note: it is
written onto every one of that program's calendar events, by an edit trigger
that runs a second or two behind the click.

**A queued tick is never overwritten.** Because a cell edit can't reach a
calendar by itself, every tick is recorded on the hidden `_Pending_Tag_Changes`
tab first, and the sync leaves that program's boxes alone until the calendar has
accepted it. Without that, a calendar change anywhere — yours, a colleague's,
Google moving a recurring event — fires a sync that recomputes these columns
from descriptions nobody had told about your tick yet, and the box would untick
itself while you watched.

**Buffers live in Config, nowhere else.** `Standard_Buffer` / `Tester_Buffer` on
the lunch dashboard are re-read from **Config ▸ 🍱 Meal Buffer Amounts** on
every render.

**Old months are hidden, not gone.** See [Old months](#old-months).

---

## Troubleshooting

<a id="why-a-tag-isnt-sticking"></a>
**A checkbox keeps clearing itself — `Personalized_Assistance`, `Club` or
`No_Registration` untick themselves an hour after I tick them**

The calendar is the source of truth for all three. You tick the box, the tick
is written into the event's description as `[Personalized Assistance]`, and
every sync reads the descriptions back and sets the boxes from them. So a box
that clears itself is always the same sentence: **the sync did not read the tag
in the description.** Either it never got there, or it is there in a form this
script does not read.

Press **🔧 Admin ▸ 🏷️ Read an Event's Tags…** and type part of the program
name. It reads the events with the sync's own parser and shows you, per event:
the description exactly as the calendar returns it, every `[bracket]` in it,
which brackets became settings, which were left as notes **and why**, and what
the dashboard currently says about the same session. Where the calendar and the
sheet disagree it says so in those words, and which way round tells you which
to fix:

* **calendar says yes, sheet says no** — the sync hasn't run since the tag went
  on. Press **🔄 Update Everything Now**.
* **calendar says no, sheet said yes** — the tick never reached the calendar.
  Tick the box again and press **📝 Programs & Forms ▸ Push Dashboard Ticks to
  the Calendar**.
* **the tag is plainly typed on the event, and the tool says the bracket was
  left as a note** — that is the commonest one. A bracket sets something only
  when the **whole bracket** is tags this script knows, so
  `[Call the office for an appointment]` is somebody's note and sets nothing,
  on purpose (otherwise `[Film Club selection: Casablanca]` would give the
  program a club roster). Put the tag in a bracket of its own:
  `[Personalized Assistance]` on its own line, and the note in plain text
  beside it.

The same answer, program by program rather than event by event, is at the
bottom of **📝 Programs & Forms ▸ Rebuild Appointment Forms + Report…** under
**WHAT THE CALENDAR SAYS**.

**A new event didn't get a form**
Check, in order: does the title start with `*` (tentative)? Is it an all-day
event (those are skipped)? Is it more than ~60 days out? Is it on one of the
three configured calendars?

**An event says "🚧 Registration Not Yet Open" and shouldn't**
Its date is past **🚧 Registration Open Through** on Config. Move that date
forward (or clear the cell) and run **Sync Cal**, or **🔗 Rewrite Event Links**
to update the calendar straight away.

**A form says registration isn't open yet and I need it open now**
Same cell. The horizon closes a form only when *every* remaining session on it
is past the date, so moving the date past that form's first session re-opens it
on the next sync. If the form was closed by hand in the Forms UI instead, the
horizon won't re-open it — open it yourself in Google Forms.

**Quick Mark shows no appointment times on a Personalized Assistance session**
Quick Mark keeps its lists in two places — a cache, and a hidden
`Quick_Mark_Index` tab — so the dialog opens without a wait. The tab copy does
not expire, and lists built by an older version of the script used to be served
forever. They now carry a version stamp and are thrown away when it doesn't
match, so this heals itself; if you hit it once more, press **🔧 Admin ▸
Rebuild Quick Mark Lists** (or the **↻ reload** link in the dialog itself).

If the times are still missing after a rebuild, the session isn't flagged as an
appointment one: check `Personalized_Assistance` is ticked on its
**Master_Program_Dashboard** row, and that the calendar event carries
`[Personalized Assistance]` — the tick comes from the calendar, and an untagged
event has no slots to offer. The time picker only appears when you tick
**Register them** (you are booking a slot) or **🕐 Move them to a different
time** — marking somebody who already has a booking needs no time.

**A form shows the wrong dates or meals**
Press **🍱 Push Menu Changes to Forms**. Editing `Lunch_Schedule` deliberately
does *not* rewrite live forms on the spot — that push (or the daily Sync Cal)
is what delivers it.

**I added a lunch date and it never appeared on the monthly form**
Press **🍱 Push Menu Changes to Forms**. The push now builds the sign-up month
before it rewrites anything, which is what creates the row a new date hangs
off. If it still does not appear, the toast will say what failed; the most
common answer is that the date is further out than the sign-up forms are built
(six months — see **Build / Refresh Lunch Sign-Up Forms**), in which case the
menu is fine as typed and that month builds itself as it comes closer.

**A menu row I typed didn't go anywhere**
It's in the **➕ ADD MENU ITEMS** block at the bottom of `Lunch_Schedule` and
it's missing something. A row moves up into the schedule once it has a
**date, a location and a type** — anything else it couldn't read stays in the
box with a note saying why.

**I changed Grouped/Regular and it changed itself back**
`Type_Tag` is stored on the *calendar event*, not the sheet, and a cell edit
can't always reach the calendar. Press **Push Dashboard Ticks to the Calendar**, then **Sync Cal**.

**I ticked `Club` and it unticked itself**
That was a real bug and it's fixed: ticks are now queued on the hidden
`_Pending_Tag_Changes` tab and protected from the sync until a calendar accepts
them. If a tick is still sitting in that tab hours later, the calendar can't be
written — check **🔧 Admin ▸ Trigger Status** (is `onProgramFlagEditInstallable`
listed?), run **Check Triggers** if it isn't, then
**Push Dashboard Ticks to the Calendar**.

**Only some locations ended up on the shared form**
The `[All Locations]` tag is read per event, so the locations you didn't tag
kept their own form. The log and the admin email both say which ones ("only
partly linked"). Running **🔗 Link Program Across Locations…** tags them all.

**A shared form's dates suddenly show location names**
That's intended — a form covering more than one location labels every date
with where it is, otherwise two sites meeting on the same day would be
indistinguishable on the form.

**Rows before this month are missing from a tab**
They're hidden, not gone — see [Old months](#old-months). Press
**🕓 Show All Past Rows**. (Ctrl+F finds them either way.)

**An event description has the registration link in it twice**
Run **🔧 Admin ▸ 🔗 Rewrite Event Links (fix duplicates)** — see
[Fixing duplicate links](#fixing-duplicate-links-in-event-descriptions).

**I don't want the registration link showing in the calendar at all**
Set **🔗 Registration Link in Events** to `Hide link` in Config, then run
**🔗 Rewrite Event Links** to strip it from events already out there.

**I pasted the new code and the tabs look the same**
Nothing redraws a tab until something asks it to. Press **🔧 Admin ▸ 🧱
Rebuild Layout (no calendar sync)** — see
[Updating to a new version](#updating-to-a-new-version).

**Someone's registration never appeared**
Check **Deleted_Event_Triage** — the event may have been deleted. Otherwise run
**Sync Registrations** and check whether the row is there but `Superseded` (they
submitted twice) or `Waitlisted` (session was full).

**The lunch count looks too low**
Only `Active` + `Needed` rows count. Check for rows sitting at `Waitlisted`,
`Cancelled`, or `Superseded`.

**A date I expected isn't on the lunch dashboard**
First check whether it's marked **Not Serving** on **Lunch_Schedule** — that
removes it deliberately, and wins even if people signed up. Otherwise check
that location's **Lunch Service by Location** setting in Config: if it's *By
exception*, the date only appears once you add a Hot/Cold row for it on
**Lunch_Schedule**; if it's *Never*, it won't appear at all.

**A date is still on the lunch dashboard after I marked it Not Serving**
Three reasons it's kept on purpose: it's in the **past** (that row is the
record of what was ordered), its `Manual_Override` says **Manually
Added/Edited** (delete it yourself), or somebody's **`Lunch_Served` is ticked**
for that day (people really were fed). Otherwise it clears on the next sync.

**A form isn't asking about lunch**
Either that location is set to *Never* in Config, or none of the dates on that
form serve lunch. Fix whichever applies — set the policy to *Always*/*By
exception*, or add a Hot/Cold row on **Lunch_Schedule** for one of its dates —
and the question comes back on the next sync.

**A `Never`-policy form still has a lunch question on it**
New forms strip it automatically, and an existing form catches up the next
time it gains a new date or its menu is edited. To fix every existing form for
a `Never` location right now, ask your developer to run
`cleanupNeverPolicyForms()` from the Apps Script editor — it's a one-time
cleanup, not a menu item, and it's safe to run more than once.

**A form still looks like the old version (guest-count page, wrong branch)**
Run **Sync Registrations** — it rebuilds up to five out-of-date forms per run,
so a big backlog may take a few passes. To force every form to be re-checked
(after hand-editing one, say), ask your developer to run
`recheckAllRegistrationForms()` from the Apps Script editor.

**Sync Cal ran for ages and then stopped / "Exceeded maximum execution time"**
That's the first-import problem — too many forms to build in one run. Press
**Import Everything (First Run)** instead; it does the same work in batches and
skips whatever already came through. Then press **Check Triggers** to be sure
the schedule is back (the batched import does that itself at the end).

**Programs vanished from Master_Program_Dashboard**
The system removes a session when its calendar event is gone — but it now
refuses to do that *en masse*: if more than a handful of sessions look deleted
at once, it changes nothing, logs why, and tells the admin address, because
that pattern nearly always means a calendar didn't respond rather than that
everything was cancelled. Calendars it couldn't read this run are skipped
entirely.

If sessions did disappear (from an older version), get them back with:

1. **Import Everything (First Run)** — re-imports the sessions and re-adopts
   the forms already linked in the calendar events.
2. Ask your developer to run `restoreTriagedRegistrants()` from the Apps
   Script editor — that moves people back from **Deleted_Event_Triage** onto
   **Registrant_Dash** for every session that's back. This is
   worth doing before anything else touches those rows: registrations that
   were already imported *only* exist on those tabs, so re-syncing the forms
   will not bring them back.
3. **Sync Registrations**.

If sessions really were all cancelled and you want them cleared, your
developer can run `confirmLargeTriage()` and then press **Sync Cal** — that
permits exactly one oversized sweep.

**"Import Everything" seems stuck**
Look at **Master_Program_Dashboard** — if rows are still appearing every few
minutes, it's working. It gives up on its own if two batches in a row make no
progress, and tells you so. To stop it by hand, ask your developer to run
`cancelBootstrapCalendars()` from the Apps Script editor; that restores every
trigger and keeps whatever was already imported.

**Nothing is syncing at all**
Run **Check Triggers** — that rebuilds anything missing, including automation
a first-run import paused and never got to restore. If that doesn't help, the
script may need to be re-authorized from the Apps Script editor.

**The same event seems to trigger a sync twice, or you see far more
`onCalendarChange` activity than editing one event should cause**
First, the case that isn't your fault: **anything this system writes into a
calendar description is itself a calendar edit**, so without care a menu action
that tags forty events would set off forty change notifications, each one
starting a full sync that reacts to nothing but the previous one's work. Every
action that writes descriptions now runs inside a *quiet window* — the
calendar-edit triggers are taken down, the work is done, each calendar's sync
position is advanced past our own edits, and only then are the triggers put
back. That covers Sync Cal, ticking `Club` / `No_Registration`,
**Push Dashboard Ticks to the Calendar**,
**🔗 Link Program Across Locations…**, **🔗 Rewrite Event Links** and
**💣 Destroy & Rebuild Forms…**. If you saw a burst of syncs after one of
those, it should be gone.

Otherwise it is almost always more than one Google account having independently
set up this project's triggers. **Check Triggers** now fully resets the calendar
and sync triggers every time it's pressed — however many exist, all get
removed and exactly the right number get recreated — so this fixes it
**for whichever account presses it**. But an installable trigger belongs to
the Google account that created it, and one account genuinely cannot see or
remove another account's copies; if two different people have both run
**Check Triggers** / **Import Everything** / `initSheet()` from their own
logins, you now have two invisible-to-each-other sets both firing.

To find and clear the other set: open the **Apps Script editor** for this
project, click the **clock icon** (Triggers) in the left sidebar. Unlike
anything this script can do for itself, that page lists **every** trigger
regardless of who created it, with a "Created by" column — delete anything
that isn't the account you intend to use going forward.

Going forward, **only ever run setup and trigger actions from one Google
account** — ideally whoever owns the spreadsheet. This is now enforced rather
than left to memory: see **Trigger_Owner** under
[Config](#7-config). Everyone else can register, view dashboards, and
hand-edit rows freely.

**Start with Admin → Trigger Status.** It tells you, in one dialog, whether
this is actually what's happening: it lists which accounts have been *seen
firing* each handler in the last day or so. More than one account against the
same handler means two sets exist, confirmed rather than guessed. It also
shows which triggers your own account holds, so you can tell whether you're
part of the problem — if you are, **Release My Triggers** clears your set
without touching anyone else's.

**To stop the double-syncing right now, before anyone has cleaned anything
up:** set **Automation_Enabled** to **No** on the Config tab. That halts every
handler, including the other account's triggers that you can't see or delete.
Sort out the triggers, then set it back to **Yes**.

**One thing that used to cause this quietly, now fixed:** pressing **Sync
Cal** — which is open to everyone, not admin-gated — used to rebuild the
calendar-watch triggers under *whoever clicked it*. So a non-admin clicking
the top menu item on an ordinary Tuesday could create a whole invisible set
without any idea they'd done it. Sync Cal now only ever puts back triggers
your account already had, so it can't create a new set anymore.
