# Dashboard reorganization — design draft

**Status: phases 1, 2 and 3 are shipped** — `78_program_month_dashboard.gs` (the
design doc says 77; see the numbering note in `DASHBOARD_REORG_PHASES.md`), the
`Program_Month` tab, the metrics block moved up onto it, the leader-coverage
line, lunch collapsed, the `Sessions` drill-through, and §5's `Title_Match`
column and matcher (option **B**). Phases 4 and 5 are still proposals.

Two questions prompted this, and they turn out to be the same question:

1. `Master_Program_Dashboard` is long and repetitive. A weekly class shows up
   four or five times a month as near-identical rows — same form, same leader,
   same roster file, same capacity — differing only in a date.
2. `Program_Leaders` is good at catching a new program as it comes in, but only
   if somebody notices the new program and types a row. Nothing attributes an
   incoming event to a person on its own.

The connecting fact is that **this system already has a unit bigger than a
session, and the dashboard is the one place that does not show it.**

---

## 1. The unit that already exists

`buildEventGroups()` (`24_calendar_groups.gs:180`) keys every group as:

```
`${scope}::${parsed.cleanTitle}::${span}`     // scope = calendarId, or SHARED
                                              // span  = monthLabel, or 'FIXED'
```

That key — call it the **program-month** — is the unit almost everything
downstream is actually organized around:

| Thing | Grain |
|---|---|
| A Google Form | one per `groupKey` — one program, one location, one month |
| `Form_ID` on a dashboard row | the `groupKey`'s form, repeated on every session row |
| A program leader sheet | `leaderProgramKey(title, location)` — program-month with the month dropped |
| A `Program_Leaders` row | same: `title \| location` |
| A `Program_Options` row | same: `Event × Location` |
| A leader notification | one per leader per sync, across their programs |
| **`Master_Program_Dashboard`** | **one row per session** |

Every row of a four-session group carries the *same* `Form_ID`,
`Form_Response_Link`, `Edit_Form_Link`, `Leader_Sheet_Link`, `Max_Capacity`,
`Club`, `No_Registration`, `Personalized_Assistance`, `Type_Tag`,
`Slot_Minutes` and `Max_Per_Month`. Fourteen of the twenty-four columns are
program-month facts printed four times. Only `Event_Date`, `Event_Time`,
`Event_End`, `Active_Count`, `Waitlist_Count`, `Remaining_Seats`, `Status` and
`Event_ID` genuinely vary per session.

So the tab is not "a dashboard with too many rows". It is **two tables written
as one**, and the repetition is the join printed out longhand.

There is a second source of length: the generated lunch rows. A month of
lunches at two locations is ~42 rows that no program metric counts (they are
filtered out at `43_program_dashboard.gs:63`) and that exist on the tab only so
staff can see what is on. That is a real need, but it does not need 42 rows.

---

## 2. The proposal in one line

> Split the tab in two along the seam that is already there. The **month view**
> becomes the front page — one row per program-month, one row per form. The
> **session view** keeps every row it has today and becomes the day-level
> table it always was.

### 2a. Two tabs, not one

| Tab | Grain | Answers |
|---|---|---|
| `Program_Month` (new) | program × location × month | What are we running? Who leads it? How full? Where is its form? |
| `Program_Sessions` (today's `Master_Program_Dashboard`) | one session | What is on Tuesday? Who is coming to *that* one? |

Everything about a session — the checkboxes staff tick, the counts, the
per-session status, the Quick Mark and door reads, `32_dashboard_link_repair`,
`triageDeletedSessions`, `67_desk_month_sessions`, the sign-in PDFs — keeps
reading the session table exactly as it does now. **The month tab is derived,
top to bottom, with one exception (§4). It stores nothing that is not already
somewhere else.** That is what makes it cheap to build and safe to delete.

### 2b. About the rename

Every one of the 37 files that touches this tab does so through
`SHEET_NAMES.PROGRAM_DASHBOARD` — not one bare string. And
`LEGACY_SHEET_RENAMES` (`03_sheets_and_headers.gs:57`) exists precisely to make
a tab rename survive on a workbook that already holds data: the old tab is
renamed in place before an empty new one could be created, keeping the rows,
the formatting and every reference.

So renaming is a two-line change:

```js
PROGRAM_DASHBOARD: 'Program_Sessions',            // was 'Master_Program_Dashboard'
// and
const LEGACY_SHEET_RENAMES = {
  'Registrant_Dash': 'Lunch_and_Event_Registrants',
  'Program_Sessions': 'Master_Program_Dashboard'   // new -> old
};
```

The real cost is documentation: `CLAUDE.md`, `00_overview.gs`, `USER_GUIDE.md`
and `HEADERS.Master_Program_Dashboard` all say the old name.
`HEADERS.Master_Program_Dashboard` is the awkward one — the headers key is
independent of the sheet name and can simply stay as it is, at the price of the
two never quite agreeing again. **Recommendation: rename the tab, keep the
`HEADERS` key**, and say why in a comment. A schema key is read by code; a tab
name is read by people, and the people are the ones being confused.

---

## 3. What a `Program_Month` row looks like

```
Month_Start | Location | Program | Leader | Leader_Source | Type | Flags |
Schedule | Sessions | Registered | Capacity | Fill | Waitlist |
Form_Link | Edit_Form_Link | Leader_Sheet_Link | Sign_In_Sheets |
Status | Group_Key | Form_ID
```

Worth spelling out:

- **`Month_Start`** is a real date (the 1st), so `writeUpcomingPastSections()`
  and `getSectionedRows()` work unchanged — the month tab gets the same
  Upcoming/Past split, the same month tint, the same reader. No new table
  machinery.
- **`Schedule`** is the compression that earns the tab its keep:
  `Tue 9:30–11:00 · 4 sessions` for the regular case, and
  `4 sessions · times vary` with the outlier named in a cell note when they do
  not. A person reads one line instead of scanning four rows for a difference
  that is usually not there.
- **`Sessions`** is a `HYPERLINK` into the session tab. The row positions are
  known at render time, so the cell can be
  `=HYPERLINK("#gid=<sessions gid>&range=A57", "4 sessions")` — the month row
  drills through to its own block of day rows. Cheap, and it makes the split
  feel like one view rather than two tabs.
- **`Flags`** collapses `Club` / `No_Registration` / `Personalized_Assistance`
  into one readable cell (`Club · Assistance`) — those are group facts, never
  per-session ones (`buildEventGroups` sets them on the group and never unsets
  them), so three checkbox columns × four rows is twelve cells saying what one
  cell says.
- **`Registered` / `Waitlist`** sum the group's sessions. **`Fill`** uses the
  same `percentageOrNull` discipline as today: blank, never 0%, when nothing in
  the group has a cap.
- **`Status`** is the group's worst session status, so a group with one broken
  form link does not read green.

### The lunch rows

One row per location per month: `Lunch @ Narberth · 21 days`, with the count
and the date span, linking into the session tab for the day-by-day. The lunch
dashboard remains where the meal actually lives.

### Grouping rule

`Form_ID` first — it is on the row already, it is exactly the `groupKey`'s
identity, and it costs nothing. Fall back to
`(Clean_Title, Location, monthKey)` when `Form_ID` is blank, which is the
`[No Registration]` case and the hand-added-row case. Two groups that
legitimately share a form (a `[Shared]` program across locations) get one row
with `Location` reading `Narberth + Ashbridge`, the way `describeLocations()`
already words it.

### What moves to the month tab

- **The metrics block.** It is monthly reasoning
  (`computeMonthOverMonth`) sitting on top of a session table. It belongs on
  the tab whose grain it matches.
- **A new metric line the leader work makes possible:**
  *Programs with no leader this month: 3.* That is the number §5 exists to
  drive to zero, and it is the honest measure of whether the attribution is
  working.

### What stays on the session tab

The Today block, the ticks, the per-session everything. `Today` is arguably the
door's job now (`72`/`73` serve it live), but that is a separate argument and
this proposal does not need to win it.

---

## 4. The leader dropdown — and the one rule that must not break

The ask: a `Leader` column on the program dashboard, auto-populated from the
title, editable as a dropdown, applying automatically each month.

The hazard: **that column must not become a second place where "who leads
what" is stored.** `Program_Leaders` is the source of truth; a sign-up sheet is
shared off it and an email is sent off it. A dropdown that quietly held a
different answer would mean two records disagreeing about who may read a
roster, discovered the day somebody is emailed a class they do not teach.

So the column is not storage. It is a **reader and a writer**:

```
read:   Program_Leaders row (title|location)   →  Leader cell
write:  edit the Leader cell → onEdit writes/updates that Program_Leaders row
                             → invalidateProgramLeaderIndex()
                             → re-render
```

Editing the dropdown *is* editing `Program_Leaders`, through the same handler
pattern `18_edit_handlers.gs` already uses for program-flag edits that spread
to sibling rows and back onto the calendar description. The dropdown's options
are the distinct `Leader_Name`s on the leader tab, plus a blank.

`Leader_Source` says where the value came from: `typed` (a real leader row) or
`matched` (§5 proposed it). Two words, one column, and it is the difference
between a dashboard that reports and one that guesses without saying so. Render
`matched` cells in the manual-entry wash the other tabs use for "please look at
this", `typed` cells plain.

**Monthly carry-forward is free.** `leaderProgramKey(title, location)` has no
month in it. Once a leader is attached to Chair Yoga at Narberth, every future
month's group resolves to the same key and shows the same leader with no
retyping. The thing the user wants ("auto-applying for each month") falls out
of the existing key shape — it does not need building, only surfacing.

---

## 5. The title detector

### The column

Add `Title_Match` to `HEADERS.Program_Leaders`:

> Phrases that mean this program is Jane's. Comma-separated. A new calendar
> event whose title contains one of them is proposed for her.

Matched against `Clean_Title` — i.e. **after** `parseEventTitle()` has stripped
the bracket tags, so `[Club]` and `[Shared]` can never accidentally be part of
a phrase. Compare with `normalizeNameKey()` semantics: lowercased, whitespace
collapsed. `yoga` matches `Chair Yoga`, `Gentle Yoga` and `Yoga for Balance`.

### Precedence

1. **An explicit row wins.** A `Program_Leaders` row naming this exact
   `title | location` is the answer, full stop. A phrase never overrides a
   person's typed row — including a typed row that deliberately assigns the
   program to somebody *else*.
2. **Longest matching phrase wins** among phrase rows. `chair yoga` beats
   `yoga`, which is how a specific claim overrides a general one without
   needing a priority column.
3. **A tie proposes nothing** and reports both candidates. Two leaders both
   claiming `yoga` at the same length is a question for a human, and silently
   picking the alphabetically-first one is how the wrong person gets a roster.

### The rule that keeps the privacy boundary intact

`65_program_leaders.gs` is explicit that there are **no wildcards**: a blank
`Program` or `Location` is reported unmatched rather than resolved generously,
because the privacy boundary for a shared roster is one program at one
location.

A phrase is a wildcard wearing a different hat, so:

> **A phrase match never shares anything and never sends anything. It proposes
> a concrete `title | location` row. Sharing and mail continue to read only
> concrete rows.**

Concretely: `buildProgramLeaderIndex()` — which
`getProgramLeaderEmailsForProgram()` and `getProgramLeadersWantingAlerts()`
both read — stays exactly as it is, matching on concrete rows only. The phrase
matcher is a separate pass that *writes rows into the tab* (or proposes them),
and every one of those rows is a real, inspectable, editable, deletable line
with a program and a location in it. The two paths can never disagree about who
may read what, because there is still only one path.

Then the open question is how a proposed row becomes a real one, and there are
three honest answers:

| | Behavior | Cost |
|---|---|---|
| **A. Propose only** | Matched programs appear on the month tab with `Leader_Source = matched`, and in a "Suggested leader rows" block at the bottom of `Program_Leaders`. A human ticks to accept. | Nothing happens by itself, which is also the point. |
| **B. Auto-write, notify off** | The sync writes the row, with `Notify_Roster_Changes` unticked and `Staff_Notes` reading "matched on 'yoga' — check this". No sheet is shared, no mail is sent, until somebody ticks. | One `noteForAdmin` per batch. |
| **C. Auto-write and act** | The row is live immediately. | A phrase typo shares a roster with the wrong person. |

**Recommendation: B.** It matches how the `Instructor_Email` migration already
behaves — carry the data across, leave the notification tick clear, and say so
out loud (`65_program_leaders.gs:386`, "Turning notifications on for forty
addresses nobody has been asked about, as a side effect of an upgrade, is a
mail-out"). The precedent is in the repo and it is the right one. C is the one
to refuse.

### Where it runs

In `refreshProgramLeadersTab()`, which already receives `sessionRows` and
already computes `knownProgramKeys()` — every program the workbook has ever
seen, keyed exactly the way the matcher needs. The matcher is:

```
for each known programKey not already covered by a concrete row:
    candidates = leader rows whose Title_Match phrases hit that title
    resolve by precedence
    emit a proposed row
```

No new read, no new network call, no new cache. It is a loop over two
structures the function has in hand.

### Two safeguards worth building in

- **A phrase that matches nothing** gets a cell note: *"No program title
  contains this."* A typo in a phrase is otherwise perfectly silent — the
  leader simply never gets attributed, and nobody finds out until a roster
  goes unshared.
- **A phrase that matches more than N programs** (say 10) is reported rather
  than applied. `a` matches everything, and a one-character phrase is how one
  person gets proposed for every class in the building.

---

## 6. What this makes possible next

Once the month row exists, three things that are currently awkward become easy:

- **Coverage as a first-class number.** "3 programs running next month have no
  leader" on the metrics block, and the unassigned rows tinted on the month
  tab. This is the thing the user wants `Program_Leaders` to catch, stated as
  a number instead of as a scan.
- **A leader's own line.** `Program_Leaders` can carry derived
  `Programs_Led` / `Sessions_This_Month` / `Registered` columns next to
  `Sheet_Link` and `Last_Notified`, filled by the same pass. The tab currently
  reports what the system did *to* a row; this reports what the row is *worth*.
- **One click from month to everything.** The month row is the natural home for
  the actions currently spread across menus and dialogs — rebuild this form,
  share this leader sheet, print these sign-in sheets — because it is finally a
  row that means the same thing those actions mean.

---

## 7. Suggested order of work

Each phase is useful shipped alone, and none of them is a prerequisite for the
next in a way that traps a half-finished state.

| Phase | What ships | Notes |
|---|---|---|
| **1** | `Program_Month` tab, derived, read-only. New file `77_program_month_dashboard.gs`. | Purely additive. No rename, no schema change to existing tabs, no form change. Delete the tab and nothing else notices. |
| **2** | Metrics block moves up to the month tab; lunch rows collapse to one row per location per month; `Sessions` drill-through links. | The session tab gets shorter and plainer. |
| **3** ✅ shipped | `Title_Match` on `Program_Leaders` + the matcher, option **B**. | Adds one column to `HEADERS.Program_Leaders`. `writeMemoryTab` handles a widened schema, but check the spare-validation band. |
| **4** | `Leader` + `Leader_Source` on the month tab, dropdown, write-back through `18_edit_handlers.gs`. | The only phase that writes. Needs a confirmation prompt on the edit, like the program-flag edits have. |
| **5** | The rename: `Master_Program_Dashboard` → `Program_Sessions`, via `LEGACY_SHEET_RENAMES`. | Last, deliberately — it is the change with the widest documentation blast radius and the least behavior in it. |

### What this does *not* need

Worth stating plainly, because it is the cheapest part of the whole proposal:

- **No `TEMPLATE_VERSION` bump.** No form's shape changes.
- **No `FORM_STATE_MIGRATIONS` entry.** Nothing already out in the world
  changes shape. (Phase 3 adds a spreadsheet column, which `writeMemoryTab`
  widens in place — that is a tab redraw, not a live-form repair.)
- **No new Script Property.** Every derived value is recomputed per render;
  the only stored thing is a `Program_Leaders` row, which is a row on a tab.
- **No load-order hazard**, provided the new file declares only self-contained
  constants and reaches everything else through hoisted function calls — the
  same discipline `67`, `69`, `70` and `76` are numbered late for.

### Tests

`tests/load_order.test.js` covers the new file for free. Worth adding:

- a grouping test — four session rows with one `Form_ID` collapse to one month
  row, and a blank-`Form_ID` row falls back to title+location+month;
- a matcher test — precedence, the longest-phrase rule, the tie refusal, and
  that a concrete row is never overridden;
- a boundary test — that `buildProgramLeaderIndex()` still returns nothing for
  a phrase-only row, i.e. that a phrase cannot share a sheet.

That third one is the test that holds §5's line. It should be written first.

---

## 8. The open questions

1. **Does the session tab keep the Today block, or does the door own it?**
   The door pages read live and are what staff actually look at on the day.
2. ~~**`FIXED`-span groups**~~ — **ANSWERED, and shipped: one row, filed under
   its FIRST month.** Every number on a month row is a sum over that row's
   sessions, so repeating the group per month it touches would either
   double-count them or have to divide them up, and a `Registered` figure that
   is a third of the truth in three places is worse than a row filed a month
   early. The `Schedule` cell states the real span and its note names every
   session, so nothing about the run is hidden by where the row sits. See the
   banner of `78_program_month_dashboard.gs`.
3. **Should `Program_Options` and `Program_Month` merge?** Both are program ×
   location. `Program_Options` is staff-typed memory (`Typical_Attendance`,
   `Room_Or_Setup`, `Notify_Mode`); `Program_Month` is derived and monthly.
   They are close enough to be confusing and different enough that merging
   them would put a typed cell and a derived cell in the same row — which is
   exactly the mixture `Program_Leaders` keeps carefully separated with its
   two derived columns. Probably keep them apart, and link between them.
