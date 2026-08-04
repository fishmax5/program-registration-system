# Calendar & Form Manager — User Guide

This system turns **Google Calendar events into registration forms**, and turns
**form responses into a catering order**. You mostly work in Google Calendar;
the spreadsheet fills itself in.

---

## The one-minute version

1. You create an event on one of the program calendars.
2. The system builds a registration form for it and pastes the link into the
   calendar event's description.
3. People register. Their answers land on the **Lunch_and_Event_Registrants**
   tab, one row per person per session.
4. **Master_Lunch_Dashboard** adds up who needs lunch each day so you know what
   to order.

Everything runs on a schedule. You rarely need to press anything.

> **Setting this up for the first time — or on a calendar with a lot already
> on it?** Use **Import Everything (First Run)** in the menu instead of
> **Sync Cal**. See [First run](#first-run) below.

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
| Lunch_and_Event_Registrants (+ Quick Mark panel) | Your **registration forms** — none opened or changed |
| Lunch_Schedule (+ the ADD block) | The **triggers** — automation keeps running as it was |
| Master_Lunch_Dashboard (hand-entered columns kept) | |
| Deleted_Event_Triage | |
| Member_Roll / Program_Options (your notes kept) | |
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
| `[Monthly]` | A **separate form per calendar month** (the default) |
| `[Cap: 12, Grouped]` | Both. `[Cap: 12] [Grouped]` on separate lines works too. |

You can write anything else you like in the description around them — only
brackets containing `Cap:`, `Grouped` or `Monthly` are read.

**Grouped vs Monthly** — this is just "how many forms?":

- **Grouped** — one form for the whole run. Use it for something like a 6-week
  course, where one registration should cover every session.
- **Monthly** — a new form each calendar month. Right for a drop-in weekly
  thing, so January's sign-ups don't pile up with December's. This is what you
  get if you say nothing.

> **These used to be called `Fixed` and `Regular`.** Both old words still work
> everywhere — in descriptions and in the `Type_Tag` column — so there is
> nothing to go back and change. "Fixed" wasn't fixed in any sense you'd guess,
> and "Regular" described both cases equally badly.

**You can also change it from the spreadsheet.** Edit the `Type_Tag` column on
**Master_Program_Dashboard** (it's yellow, because it's yours to change). You'll
be asked to confirm, because switching re-partitions that program across forms —
and if you say yes, the system writes the tag into **every** calendar event for
that program, so the change sticks and all its months end up on the same footing.
Say no and the cell goes straight back to what it was.

> Older events with `[Cap: 12]` or `Fixed` in the **title** still work — the
> system reads them and logs a reminder to move them. New events should put
> everything in the description.

**Tentative events** — start the **title** with `*`:

| Title | Result |
|---|---|
| `Yoga Basics` | Normal — gets a form |
| `*Yoga Basics` | **Tentative** — no form, no dashboard row |

Use it while a date is still being confirmed. Remove the `*` and the event flows
through normally on the next sync and gets its form.

> Removing the `*` is safe and creates no duplicates. Re-adding a `*` to an
> event that *already* has registrations does **not** delete anything — existing
> registrations are kept.

**The registration link** appears in the event description automatically, as a
clickable "📝 Register for …" link. Leave it alone; the system keeps it current.

---

## The tabs

They appear in this order, and it's roughly the order you'd use them.

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

**This whole tab is rebuilt from the calendar on every sync.** Don't hand-edit
it; your changes will be overwritten (you'll get a warning if you try). If a
session is wrong here, fix the calendar event.

**The one exception is `Type_Tag`** — it's yellow because it *is* yours to
change, and changing it writes back to the calendar so it sticks. See
[Grouped vs Monthly](#setting-up-your-calendar-events) above.

`Form_ID`, `Event_ID`, `Calendar_Source` and `Calendar_Synced?` are **hidden** —
internal plumbing. The "View Live Form" link you actually hand out stays visible.

### 2. Master_Lunch_Dashboard
What to order. **Today's Lunch Needs** sits at the top and always stays visible.
Below it is the full schedule, split upcoming/past.

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
| `Registered_Count` | What the **forms** say — how many asked for lunch |
| `Served_Confirmed` | What **actually happened** — how many `Lunch_Served` boxes you ticked on the Registrants tab |
| `Total_to_Order` | Live formula: `Registered_Count + Standard_Buffer + Tester_Buffer` |

`Served_Confirmed` stays **blank** until you've ticked something — a real `0`
("nobody came") and "not counted yet" mean very different things, so it won't
claim the first. It counts every tick, including walk-ins who never registered.

Columns with a **✍️ pencil and a yellow header are yours to fill in** — the
system never overwrites them. They sit **after** the numbers you order against,
because they're reconciliation detail and were pushing those numbers off the
screen:

`Actual_Ordered` · `Day_1_In-Person` · `Day_1_Takeaway` · `Subs_In-Person` ·
`Subs_Takeaway` · `Total_Consumed` · `Thrown_Away` · `Discrepancy`

…and the two **buffer** columns are at the **very end** of the row:

`Standard_Buffer` · `Tester_Buffer`

They're set once from Config and then rarely touched, so they've been moved out
of the way — but `Total_to_Order` still adds them, wherever they sit.

**Color:** the `Location` cell is shaded by location — Narberth light orange,
Ashbridge light green, Zoom lavender — the same as every other tab. The rest of
the row is left plain so the numbers read as numbers. `Event_Date` keeps its
month tint, `Lunch_Type` goes grey on `Not Serving`, the ✍️ columns keep their
yellow, and a hand-edited row's `Manual_Override` cell goes purple.

### 3. Lunch_and_Event_Registrants
One row **per person, per session** — guests get their own rows, not a note on
someone else's.

#### ⚡ Quick Mark — the fast way to mark people off

The panel at the **top of this tab** is how you tick people in on the day,
without hunting for their row:

1. **Location** — pick from the dropdown.
2. **Program** — **every** program at that location, past and present,
   **soonest first**. Not just the ones somebody has already registered for.
3. **Name** — the people registered for that program first, then **everyone
   else on Member_Roll**. You can also just **type a name** that isn't on
   either list.
4. Tick **✓ Attended** or **✓ Lunch**.

That's it. The system finds that person's row wherever it is, ticks it, tells
you what it did on the line underneath, and clears itself for the next person.
The **Clear** box resets it if you pick wrong.

- **Ticking Lunch also ticks Attended** — you can't be fed without being there.
- If someone's registered for **several dates** of the same program, it marks
  the nearest one (today first, then the next upcoming) and says so, e.g.
  *"Marked attendance for Marion Webb — Tue, Aug 5 (2 sessions matched — marked
  the nearest)."* If that's the wrong one, tick the right row directly.

**Walk-ins.** If the person you picked has **no registration** for that
program, ticking a box offers to add them:

> *Add Marion Webb as a walk-in?*
> A new row will be added for Chair Yoga — Tue, Aug 5 (Narberth), marked
> attended + lunch served and flagged "Manually Added".

Say yes and the row appears, already marked. It's flagged **Manually Added**,
which means no future sync will touch or remove it. Say no and nothing
happens. You need a **program** picked in box 2 for this — the system won't
guess which one they walked into.

You can always tick `Attended` / `Lunch_Served` **directly on a row** instead;
the panel is just faster when you're standing at a sign-in desk.

#### The columns

`Event_Date`, `Location` and `Event` lead the row, then **`Name`, `Attended`,
`Lunch_Served`** — so who-they-are and did-they-come sit together with no
scrolling.

| Column | What it tells you |
|---|---|
| `Event_Date` | The session day — first column, tinted by month |
| `Location` / `Event` | Which program and location this row belongs to |
| ✍️ `Attended` | **Yours to tick.** They turned up |
| ✍️ `Lunch_Served` | **Yours to tick.** They were actually fed — this is what `Served_Confirmed` on the lunch dashboard counts |
| `Person_Type` | `Attendee` (registered themselves) or `Guest` |
| ✍️ `Lunch_Type` | `Hot`, `Cold`, or `No Lunch` — the actual dish category, not just yes/no |
| ✍️ `Lunch_Status` | Needed · No Lunch · Waitlisted · Cancelled · Superseded |
| ✍️ `Program_Status` | Active · Waitlisted · Cancelled · Superseded |
| `Primary_Registrant` | `Self`, or the name of whoever brought them |
| `Party_Size` | Headcount on that submission — "party of 3, one no-show" |
| `Order_Ahead_Flag` | Highlighted when someone registered too late to order for |
| ✍️ `Admin_Notes` | Allergies/dietary needs, plus anything they typed |
| `Manual_Override` | Turns purple when a row has been hand-edited, so the sync leaves it alone |

**✍️ and yellow means yours to fill in** — the same convention as every other
tab. Everything without it came from a form or is worked out automatically, and
will be overwritten if you type in it (you'll get a warning if you try).

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

### 4. Lunch_Schedule
**You own this tab.** It's the menu, one row per **date per location**.

| Column | Notes |
|---|---|
| `Event_Date` | The day |
| `Location` | Narberth / Ashbridge / Zoom |
| `Type` | `Hot`, `Cold`, or `Not Serving` |
| `Meal_Description` | Full description |
| `Meal_Shorthand` | Short label — **this is what registrants see on the form** |

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

It asks first, then rewrites the date labels — and adds or removes the lunch
question — on every form covering an upcoming menu date. Past dates are left
alone.

### 5. Member_Roll and Program_Options — your own notes

These two tabs are the only ones holding knowledge the system can't work out for
itself. Each is split down the middle:

- **The left columns are recomputed** every sync. Don't hand-edit them; they'll
  be overwritten.
- **The ✍️ yellow columns on the right are yours, permanently.** Nothing ever
  overwrites them.

**Member_Roll** — one row per person who has ever registered:

| Recomputed | Yours |
|---|---|
| `Times_Seen`, `First_Seen`, `Last_Seen`, `Locations`, `Usual_Lunch` | `Usual_Guests`, `Dietary_Notes`, `Contact`, `Staff_Notes` |

This is where "Marion always brings her sister" or "cold lunch only, no dairy"
lives. People stay on the roll even after their sessions age out, so the notes
don't evaporate.

**Program_Options** — one row per program per location:

| Recomputed | Yours |
|---|---|
| `Type_Tag`, `Sessions_Tracked`, `Next_Date`, `Last_Date` | `Typical_Attendance`, `Usual_Capacity`, `Room_Or_Setup`, `Staff_Notes` |

"Needs the big room." "Usually 8 even though it's capped at 12."

### 6. Config
Five small settings blocks:

- **🍱 Meal Buffer Amounts** — extra meals per Location × Hot/Cold, used to
  pre-fill new lunch rows
- **⏰ Order Ahead Time** — how many days' notice you need. Registrations
  inside that window get flagged.
- **📧 Admin Notifications** — one email address (optional)
- **🍽️ Lunch Service by Location** — see below
- **🔗 Registration Link in Events** — see below

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

### 7. Deleted_Event_Triage
Safety net. If a calendar event disappears but people had registered for it,
their rows are moved here instead of being deleted, with a note. Follow up with
those people, then clear the rows.

---

## What registrants see

Every form is the same shape. **Page 1** asks:

- **Name** (required)
- **Guest 1 / 2 / 3 Name** — all optional. There's no "how many guests?"
  question; the headcount is simply how many names they fill in.
- **Attendance Mode**, which is the only fork in the form:

| They pick | They get |
|---|---|
| **Everyone, every date** | One question: who's eating. Applied to every date. |
| **Let me pick specific dates/people** | The full roster grid |

Most people take the first option and are done in three questions.

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

- **The link you hand out arrives with every box already checked.** Most people
  are coming to everything, so they just uncheck exceptions and submit.
- **Columns always show all three guests.** Columns for guests they didn't name
  are ignored, so there's no harm in leaving them checked.
- Each date shows the **meal shorthand** next to it, and `(FULL - Waitlist)` once
  a capped session runs out of seats — so nobody joins a waitlist unknowingly.
- **Nobody is asked about a lunch that isn't happening.** A date marked
  `Not Serving` never appears as a lunch row, and a form with no catered dates
  at all doesn't show the lunch question in either branch.
- Choosing **Everyone, every date** on a `[Fixed]` series also covers dates
  added to that series *later* — they don't need to re-register.
- There's a dedicated **Allergies / Dietary Needs** field.
- Email addresses are collected, so people get a receipt with a link to **edit
  their own response** later.

If someone changes their mind and submits again, the new answers win and the old
row is marked `Superseded`.

> **Forms already out in the world get updated too.** A program's form is
> created once and reused for as long as that program runs, so a change to the
> question layout used to reach only *new* forms — which is how an existing
> form could still route someone who named one guest onto a "2 guests" page.
> Every registration sync now checks each live form and rebuilds any that are
> still on an older layout, **keeping the same link**, so calendar invites,
> dashboard links and edit links all keep working. Nothing on
> Lunch_and_Event_Registrants changes. The one visible side effect: a rebuilt
> form's link stops arriving pre-checked until it's regenerated — the
> dashboard's **View Live Form** link is refreshed right away, and the calendar
> invite catches up the next time that program's dates change.

---

## The menu

Under **🗓️ Calendar & Form Manager** at the top of the spreadsheet.

**There are two versions of this menu.** Everyone sees the day-to-day items.
The **🔧 Admin** submenu only appears for the accounts listed in
`AUTHORIZED_ADMIN_EMAILS` (see [Admin-only actions](#admin-only-actions)).

**Everyone:**

| Item | What it does |
|---|---|
| **Sync Cal** | Reads the calendars, creates/updates forms |
| **Sync Registrations** | Pulls in new form responses, recomputes everything |
| **🍱 Add Menu Items (paste/upload CSV)…** | Paste CSV or upload a `.csv` of menu items — see [Lunch_Schedule](#4-lunch_schedule) |
| **🍱 Push Menu Changes to Forms** | Rewrites the date labels and lunch question on every form covering an upcoming menu date |
| **🔁 Apply Type Changes to Calendar** | Makes a Grouped/Monthly change typed on the dashboard stick, by writing it onto the calendar events |
| **🕓 Show All Past Rows** | Un-hides collapsed old months — see [Old months](#old-months) |
| **Resize All Sheets** | Tidies column widths only — safe any time |

**🔧 Admin (admin accounts only):**

| Item | What it does |
|---|---|
| **🧱 Rebuild Layout (no calendar sync)** | Redraws every tab from the rows already in the workbook — see [Updating to a new version](#updating-to-a-new-version) |
| **🔗 Rewrite Event Links (fix duplicates)** | Strips every registration link off upcoming events and writes back one — see [Fixing duplicate links](#fixing-duplicate-links-in-event-descriptions) |
| **Check Triggers** | Resets the automatic schedule to exactly the expected triggers — safe to press any time, clears out duplicates |
| **Import Everything (First Run)** | The batched first import — see [First run](#first-run) |
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
| Press **🍱 Push Menu Changes to Forms** | It rewrites the date labels on live forms, and can add/remove the lunch question |
| Add a **walk-in** from the Quick Mark panel | It writes a person into the record, and into the catering count |
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

The **scheduled** runs (daily Sync Cal, hourly Sync Registrations) don't ask —
there's nobody at the keyboard to answer, and doing their job on schedule is the
point. Only a person clicking gets the question.

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

## Admin-only actions

A handful of actions restructure the workbook or the project's automation
itself — rebuilding every tab, creating/deleting triggers, running the
multi-hour first import, or overriding a safety limit. Those are restricted to
specific Google accounts, listed in `AUTHORIZED_ADMIN_EMAILS` near the top of
the code:

- `admin@newhorizonsseniorcenter.org`
- `maxfishman@newhorizonsseniorcenter.org`

**Gated:** Rebuild Layout, Rewrite Event Links, Check Triggers, Import
Everything (First Run), Find Leftover Tabs, Archive Old Months (report),
`mergeLegacyTabs()`, `initSheet()`,
`initializeAndSyncAll()`, `cancelBootstrapCalendars()`, `confirmLargeTriage()`,
`restoreTriagedRegistrants()`, `recheckAllRegistrationForms()`,
`cleanupNeverPolicyForms()`.

**Not gated, by design:** Sync Cal, Sync Registrations, the two lunch-menu
items, Apply Type Changes to Calendar, Show All Past Rows, Resize All Sheets,
and everyone's ability to register, edit rows, and view every dashboard.
Ordinary day-to-day use needs no special account.

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
Script editor and save — no other code needs to change. Keep at least one
address on it; an empty list locks everyone out, including you.

---

## Old months

Every date-sorted tab grows in one direction forever. A year in, the **Past**
section of Lunch_and_Event_Registrants is thousands of rows nobody scrolls
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

**Mark people in on the day**
Use the **⚡ Quick Mark** panel at the top of
**Lunch_and_Event_Registrants** — location, program, name, then tick Attended or
Lunch. See [that tab's section](#3-lunch_and_event_registrants).

**Check how many lunches actually went out**
Compare `Registered_Count` (what the forms said) with `Served_Confirmed` (what
you ticked) on **Master_Lunch_Dashboard**.

**Note that someone always brings a guest**
Put it in `Usual_Guests` on **Member_Roll**. It stays there forever — nothing
overwrites your columns on that tab.

**Cancel one person's registration**
On **Lunch_and_Event_Registrants**, set their `Program_Status` to `Cancelled`.
The `Manual_Override` cell turns purple and the row is protected from being
overwritten.

**Add a walk-in who never filled out the form**
Use **⚡ Quick Mark**: pick the location and program, pick or **type** their
name, tick Attended or Lunch. It offers to add them, then does it — the row is
flagged `Manually Added` and never overwritten. (You can still add the row by
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

**Names are matched loosely.** "Jane Smith" and "jane smith " are treated as the
same person, so a person doesn't get double-counted or double-catered.

**The dashboards are rebuilt, not patched.** Master_Program_Dashboard and the
Today blocks are regenerated from scratch each sync. Only the pencil columns on
Master_Lunch_Dashboard and manually-marked registrant rows survive.

**`Type_Tag` lives on the calendar, not the sheet.** The Grouped/Monthly cell
on the program dashboard is a view of what the calendar event's description
says. Changing it writes the new value back onto every one of that program's
calendar events — that's what makes it stick. If it can't reach the calendar
at that moment you'll get a warning toast; press **🔁 Apply Type Changes to
Calendar** and it goes through. Without that, the next sync quietly puts the
old value back.

**Old months are hidden, not gone.** See [Old months](#old-months).

---

## Troubleshooting

**A new event didn't get a form**
Check, in order: does the title start with `*` (tentative)? Is it an all-day
event (those are skipped)? Is it more than ~60 days out? Is it on one of the
three configured calendars?

**A form shows the wrong dates or meals**
Press **🍱 Push Menu Changes to Forms**. Editing `Lunch_Schedule` deliberately
does *not* rewrite live forms on the spot — that push (or the daily Sync Cal)
is what delivers it.

**A menu row I typed didn't go anywhere**
It's in the **➕ ADD MENU ITEMS** block at the bottom of `Lunch_Schedule` and
it's missing something. A row moves up into the schedule once it has a
**date, a location and a type** — anything else it couldn't read stays in the
box with a note saying why.

**I changed Grouped/Monthly and it changed itself back**
`Type_Tag` is stored on the *calendar event*, not the sheet, and a cell edit
can't always reach the calendar. Press **🔁 Apply Type Changes to Calendar**,
then **Sync Cal**.

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
   **Lunch_and_Event_Registrants** for every session that's back. This is
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
This is almost always more than one Google account having independently set
up this project's triggers. **Check Triggers** now fully resets the calendar
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
account** — ideally whoever owns the spreadsheet. Everyone else can register,
view dashboards, and hand-edit rows freely; just don't have more than one
person press **Check Triggers**, **Import Everything**, or run `initSheet()`.
