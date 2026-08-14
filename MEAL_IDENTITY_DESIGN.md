# Meal Identity — design draft

**Status: Phase 1 (§7) is implemented. Phases 2 and 3 are still a proposal.**
This is a design for how the workbook could answer *"which lunch did this
person get?"* rather than only *"how many meals went out that day?"*

What shipped: `Meal_ID` on `Lunch_Schedule` (derived, never typed),
`Meal_Source` on `Lunch_and_Event_Registrants` (blank = today's meal), the
rollup attributing meals to the batch they name, and `Carried_Over` on
`Master_Lunch_Dashboard`. The worked example in §10 is what it does. What did
NOT ship from Phase 1: giving subs their own `Lunch_Schedule` rows — that one
reaches the registration forms, so it wants deciding on its own.

The question comes from a real situation at the counter: a meal handed out on
Wednesday is not necessarily Wednesday's meal. Leftovers get served the next
day, meals go into the fridge and are collected later, and take-out and eat-in
on the same day can be two different dishes. The current data model cannot say
any of that, because it has no name for a meal — only for a date.

---

## 1. What the system records today

Five hand-entered counts per registrant row
(`REGISTRANT_MEAL_COUNT_COLUMNS`, `Code.gs:1259`):

```
Day1_Dined_In    Day1_Taken_Out    Subs_Dined_In    Subs_Taken_Out    Meals_In_Fridge
```

`readRegistrantMealCounts()` (`Code.gs:13038`) maps each of those onto a
`Master_Lunch_Dashboard` column via `MEAL_COUNT_TO_DASHBOARD_COLUMN`
(`Code.gs:1268`), and `buildDashboardRollup()` (`Code.gs:14424`) adds them into
the bucket keyed `` `${dateKey}|${location}` ``.

The dish itself lives somewhere else entirely: `Lunch_Schedule` has one row per
`Event_Date` × `Location`, carrying `Type` (Hot / Cold / Not Serving),
`Meal_Description` and `Meal_Shorthand` (`Code.gs:1168`).

### The assumption this encodes

> Every meal counted on a registrant row dated **D** at location **L** is a
> portion of the meal `Lunch_Schedule` lists for **D × L**.

That join is implicit. It is never written down anywhere — it emerges from the
fact that the count and the menu happen to share a date key. It holds for the
common case and breaks in exactly the four cases that prompted this document:

| Case | What actually happened | What the workbook says |
|---|---|---|
| **Leftovers** | Thursday's take-out is Wednesday's chicken | Thursday's meal, Thursday's count |
| **Fridge** | Set aside Monday, collected Friday | Counted `In_Fridge` under Monday, forever; the collection is invisible |
| **Split day** | Ate today's hot meal in, carried out a leftover sub | Both attributed to today's menu |
| **Subs** | Subs may be a standing item made on their own cycle | `Subs_*` counts have no menu row at all — `Meal_Shorthand` only ever describes the Hot/Cold meal |

Note the last one: `Subs_Dined_In` / `Subs_Taken_Out` are already a second
meal-*type* running alongside the day's catered meal, with no dish attached and
no schedule row. The subs half of the model has always been meal-identity-free.

### Downstream consequences

- **`Total_to_Order`** treats each date as independent. If Wednesday's leftovers
  feed six people on Thursday, Thursday still orders as though it were starting
  from zero, and Wednesday's over-order never shows up as the reason.
- **`Discrepancy` / `Thrown_Away`** reconcile a single day. A batch that is
  cooked Wednesday, part-eaten Wednesday, part-eaten Thursday and binned Friday
  has its life split across three rows that don't know about each other.
- **`In_Fridge`** is a tally, not a balance. Nothing ever draws it back down, so
  it accumulates and no one can be told "you have a meal waiting."
- **Nobody can be told what they ate.** There is no per-person meal history, so
  a recall ("that Tuesday soup batch was bad"), an allergen question, or a
  dietary preference report has no data to run on.

---

## 2. The one idea

**A meal needs an identity separate from the date it is handed over.**

Everything below follows from splitting one conflated concept into three:

| Concept | Definition | Where it lives today |
|---|---|---|
| **Menu** | The dish — "Chicken Parmesan" | `Lunch_Schedule.Meal_Description` |
| **Batch** | A quantity of that dish, cooked/delivered once, on one date, at one location, with a finite life | *nowhere* |
| **Handover** | One portion of one batch passing to one person, on some date, in some manner | approximated by the five counts |

The date on a registrant row is a property of the **handover**. The date on
`Lunch_Schedule` is a property of the **batch**. Right now they are forced to be
the same number, and leftovers are precisely the case where they differ.

Give the batch an ID and the problem dissolves: a handover points at a batch,
and the batch knows its own date, dish and type.

### Meal_ID

Add `Meal_ID` to `Lunch_Schedule`. Derive it deterministically, because
`renderLunchScheduleSheet()` (`Code.gs:12713`) rewrites the whole tab on every
render and a random ID would not survive:

```
M-<YYYYMMDD>-<LOCATION_SLUG>-<TYPE>        e.g.  M-20260916-NARB-HOT
```

Deterministic derivation means the ID can also be *recomputed* for every
existing row with no migration step, and that an old row referencing a rebuilt
schedule still resolves. Two batches of the same type at one location on one
day would collide — if that is real (two deliveries, two vendors), the ID needs
a `-2` suffix and the schedule needs to allow a second row. Worth asking; see
§8.

The subs line needs the same treatment: either a `Type` of `Subs` on
`Lunch_Schedule` (which gets subs a dish name, a shorthand and a batch date for
free), or an explicit standing-item batch (`M-STANDING-NARB-SUBS`) if subs
genuinely aren't cooked per-date. Recommendation: give subs real schedule rows.
It is less special-casing everywhere else, and it is the only way "which sub"
becomes answerable.

---

## 3. Two shapes for the handover record

### Option A — widen the registrant row

Keep the five counts, add a "which meal" column beside each:

```
Day1_Dined_In   Day1_Meal_ID   Day1_Taken_Out   Day1_TakeOut_Meal_ID   ...
```

**For:** small diff, no new tab, `buildDashboardRollup()` changes shallowly, the
sheet stays one-row-per-person-per-session.

**Against:** it caps each bucket at one source batch. "One of today's hot and one
of yesterday's leftover hot" is *still* unsayable — the same failure that the
old single `Meals_In_Fridge` checkbox had, one level up. It also doubles the
width of the busiest block on the busiest tab, and it has no place to record
*when* a fridge meal was collected. **Not recommended**, except as the Phase 1
stepping stone in §7.

### Option B — a `Meal_Ledger` tab (recommended)

One row per handover. Long format, append-only in normal use:

| Column | Meaning |
|---|---|
| `Handover_Date` | the day the food physically changed hands |
| `Location` | where |
| `Name` | who — same `normalizeNameKey()` identity as everywhere else |
| `Meal_ID` | **which batch** — the whole point |
| `Disposition` | `Dined_In` \| `Taken_Out` \| `To_Fridge` \| `Collected` \| `Discarded` |
| `Qty` | portions, defaulting to 1 |
| `Event_ID` / `Party_ID` | back-reference to the registrant row, blank for a pure take-out walk-in |
| `Source` | `Quick Mark` \| `Sign-in sheet` \| `Manual` |
| `Marked_At` | timestamp, for undo and for "who marked this twice" |
| `Notes` | free text |

**For:** every case in the table in §1 is directly expressible. A person can take
three portions of three different batches in one visit — three rows. A fridge
meal is a `To_Fridge` row on Monday and a `Collected` row on Friday, so the
balance closes. A batch's whole life is `WHERE Meal_ID = …`, across dates. Per
person history is `WHERE Name = …`. Both of the reports staff actually want fall
out of one tab.

**Against:** a new tab that grows without bound (see §6), and it introduces the
first genuinely relational structure into a workbook whose stated architecture
is "the spreadsheet is the database" (`SYSTEM_REVIEW.md` §13). That is a real
cost and should be a deliberate decision, not a side effect.

### What happens to the five count columns

They must stop being a second source of truth. Two options, and the choice
matters more than it looks:

1. **Derived and protected.** The ledger is authoritative; the five columns
   become a rollup of it, rendered read-only alongside `Attended` /
   `Lunch_Served` via the existing `protectDerivedColumns()` path. Clean, and it
   costs staff the ability to fix a number by typing over it — which they do
   today, and which the yellow "this is yours" wash currently promises them
   (`REGISTRANT_EDITABLE_COLUMNS`, `Code.gs:12506`).
2. **Editable, with a documented precedence.** A typed value overrides the
   ledger for that row and cell, and the row gets a `Manual_Override` note the
   way every other hand-edit does. Keeps the escape hatch, at the cost of two
   numbers that can disagree.

Recommendation: **(2) during rollout, (1) once staff trust the ledger.** The
override is what makes it safe to ship a half-trusted mechanism into a live
workbook, and `Manual_Override` already exists to make the divergence visible.

---

## 4. The counter is the hard part, not the schema

The data cannot be better than what someone records while handing over a tray.
Any design that makes the common case slower will be worked around, and the
ledger will fill with defaults that mean nothing.

**Design rule: the default path must stay one tick.**

### Quick Mark, adapted

The panel (`Code.gs:11869`) is `Location → Program+Date → Name → ☑Attended
☑Lunch 🥡Lunch Only`. Add **one** cell:

```
1. Location   2. Program + Date   3. Name   4. Meal   ☑Attended  ☑Lunch  🥡Lunch Only  Clear
```

`4. Meal` is a dropdown that **pre-fills with today's batch at that location**
and is cascaded from the location the same way the others already are
(`refreshQuickMarkDropdowns()`). Its list, nearest-first:

```
Today — Hot: Chicken Parm                    (default)
Today — Subs: Turkey
Yesterday's leftovers — Hot: Beef Stew
🧊 From the fridge — Joe R.'s Mon 9/14 Hot
```

Leave it alone and behaviour is **identical to today**: one tick writes
`Lunch_Served` and a ledger row against today's batch. Touch it only when the
food isn't today's — which is the exception, and which is exactly when someone
is already thinking about it.

Disposition comes from the checkbox that was ticked, so it costs nothing:
`☑Lunch` → `Dined_In`, `🥡Lunch Only` → `Taken_Out`. A `🧊 To Fridge` checkbox
is the one genuinely new tick. Choosing a `🧊 From the fridge` entry in the meal
dropdown implies `Collected` and closes that balance.

### The printed sign-in sheet

The desk marks up paper and transcribes later, so the paper has to carry the
identity or it is lost before it is typed. The sheet should print today's batch
shorthand *and* any batch still live from previous days, as named columns —
"Hot: Chicken Parm" / "Y'day: Beef Stew" / "Subs: Turkey" — rather than the
generic Day-1/Subs headings. Tally marks then land against a dish, and the
transcriber is choosing from the same four options the dropdown offers.

### Fridge labels

A fridge meal is only identifiable later if the bag says so. The label wants
name + short batch code + date (`Joe R. · 9/14 HOT`). This is the cheapest
change in the whole proposal and the one without which `Collected` rows are
guesswork.

---

## 5. What the dashboard becomes

`Master_Lunch_Dashboard` is currently one row per date × location, and every
consumption column is same-day. With batches, the natural unit for
*reconciliation* is the batch, while the unit for *ordering* stays the date.
Those want to be two blocks, not one.

**Ordering block** (per date × location — the existing one, mostly unchanged),
with two additions:

- `Carried_In` — portions of earlier batches expected to be available today.
- `Total_to_Order` reduced by `Carried_In`. This is the first time the workbook
  can say "order less tomorrow, we over-ordered today," which is the direct
  operational payoff and probably the strongest argument for doing any of this.

**Batch reconciliation block** (per `Meal_ID`, spanning its whole life):

```
Meal_ID  Batch_Date  Location  Dish  Ordered  Dined_In  Taken_Out  To_Fridge  Collected  Discarded  Unaccounted  Status
```

`Status` walks `Open → Carried Over → Closed`. `Unaccounted` is
`Ordered − (everything else)` and is the honest version of today's
`Discrepancy` — it stops blaming a single day for a multi-day batch.

**Fridge register** (a small section, or its own tab): open balances only —
person, batch, date set aside, days waiting. Rows disappear as they close. This
is the "who has food waiting for them" list that does not exist today, and it
also becomes the discard prompt: anything over N days is stale (see §8).

**"Who ate what"** — the report the question actually asked for — is a view over
the ledger, offered two ways: by batch (a recall list: everyone who got Tuesday's
soup) and by person (a history: what Joe has eaten, which also feeds a much
better `Member_Roll.Usual_Lunch` than the current mode-of-`Lunch_Type` guess at
`Code.gs:1201`).

---

## 6. Risks, in the order they will bite

1. **Two sources of truth.** The single biggest risk, and §3 addresses it head
   on. If the five columns and the ledger can both be authoritative and nobody
   has written down which wins, every number on the dashboard becomes
   arguable. Decide before writing code.
2. **Ledger growth.** ~1–3 rows per attendee per serving day. A few hundred
   attendees a week is tens of thousands of rows a year. `SYSTEM_REVIEW.md` §9
   already flags that renders rewrite everything every time. The ledger must be
   append-mostly and **must not** be re-rendered wholesale — or it needs the
   same Upcoming/Past split the other date tabs use, with old months archived
   off. Design for this on day one; it is very hard to retrofit.
3. **Quick Mark already reads three tabs per keystroke** (`SYSTEM_REVIEW.md`
   §10). A fourth dropdown sourced from `Lunch_Schedule` plus a fridge-balance
   scan makes it worse. Both lists are small and cacheable per execution (the
   `getMealInfoForDate()` index at `Code.gs:2886` is the existing pattern), but
   it needs measuring, not assuming.
4. **Orphan `Meal_ID`s.** Schedule rows get retyped and re-rendered; a ledger row
   can end up pointing at a batch that no longer exists. Never drop those —
   surface them in a reconciliation section, the way triage already handles
   deleted-event rows.
5. **Name identity.** `SYSTEM_REVIEW.md` §4 — two people with the same name are
   one person. A meal ledger makes that worse, because it accumulates history
   under a name key. It does not have to be solved first, but it should be
   solved before anyone treats per-person meal history as a record.
6. **Staff load.** If the meal dropdown gets touched on every transaction rather
   than the exception, the change has failed. Worth watching in the first two
   weeks: what fraction of ledger rows are non-default?

---

## 7. Staging

Each phase is independently shippable and independently useful. Stop after any
of them.

**Phase 1 — identity, no new tab. SHIPPED**, except for the subs schedule rows.
`Meal_ID` on `Lunch_Schedule` (derived, so no migration). A single
`Meal_Source` column on the registrant row: blank means "today's batch,"
which is exactly the current implicit rule, so **no existing number changes**.
Staff can now write down that a whole row's meals were yesterday's. Crude — one
source per row — but it covers the plain leftover case and it costs almost
nothing.

Two things came out slightly different from this sketch, both for the same
reason — the counter, not the schema:

- The dropdown offers `M-20260916-NARBERTH-HOT — Chicken Parm`, ID *and* dish.
  A bare ID is unreadable at a serving counter and picking the wrong one off a
  list of near-identical strings is the exact mistake the column exists to
  prevent. `parseMealIdReference()` trims the label back off.
- `Carried_Over` was added to `Master_Lunch_Dashboard` even though the batch
  block is Phase 3 work. Without it, Wednesday's takeaway count silently grows
  by eight and nothing on the row says why — a corrected number nobody can
  explain is not obviously better than a wrong one.

**Subs schedule rows are deliberately still outstanding.** `Lunch_Schedule`
feeds the registration forms' date labels and the lunch question, so adding a
`Subs` type changes what registrants see. That is a decision about the forms,
not a data-model tidy-up, and it belongs with question 2 in §8.

**Phase 2 — the ledger.** Add `Meal_Ledger`. Generate rows from Quick Mark, with
the meal dropdown defaulting to today. Backfill from existing rows by minting
one ledger row per non-zero count against that row's own date+location batch —
the current implicit join, made explicit, so the dashboard's numbers are
unchanged on the day of migration. Preserve the legacy fridge-checkbox reading
(`isLegacyFridgeCheckbox()`, `Code.gs:13062`) during backfill; the alias
mechanism at `LEGACY_HEADER_ALIASES` (`Code.gs:1288`) is the precedent for how
this workbook handles that kind of shift.

**Phase 3 — reconciliation.** Batch block, `Carried_In` feeding
`Total_to_Order`, fridge register, who-ate-what views. This is where the payoff
is; it is also worthless without Phase 2's data.

---

## 8. Open questions

These change the design, not just the implementation:

1. **How long is a leftover servable?** One day, two, "until it's gone"? This
   sets how far back the meal dropdown looks, when a batch auto-closes, and
   when the fridge register starts nagging.
2. **Are subs made in batches at all,** or are they a standing item with no
   date? Determines whether subs get `Lunch_Schedule` rows or a synthetic
   standing batch.
3. **Can one location have two batches of the same type on one day?** Two
   deliveries, two vendors, hot meal cooked twice. If yes, `Meal_ID` needs a
   sequence and `Lunch_Schedule` needs to accept a second row per date ×
   location × type — which is a bigger change than everything else here.
4. **Does the fridge belong to a person or to a shelf?** A meal reserved *for
   Joe* is a per-person balance. A meal simply left over and available is a pool
   anyone can draw from. These are different mechanisms; the current
   `Meals_In_Fridge` column reads as the first, but the second is what
   "leftovers" usually means.
5. **Is per-person meal history wanted as a record** — dietary needs, allergens,
   recall — or only as a byproduct? If it is a record, name identity (risk 5)
   and retention become requirements rather than nice-to-haves.
6. **Who reconciles a batch, and when?** `Discarded` is the only disposition
   nobody is standing at a counter for. If no one closes batches, `Unaccounted`
   grows and the block stops being read.

---

## 9. Recommendation

Do **Phase 1 now** — it is small, it changes no existing number, and it makes
the plain "we served yesterday's food" case recordable. Run it for a month and
look at how often `Meal_Source` gets filled in. That number decides whether
Phase 2 is worth a new tab in a workbook that has deliberately stayed flat, and
answers questions 1, 2 and 4 from live behaviour instead of a meeting.

---

## 10. Worked example — why Phase 1 alone is worth shipping

One ordinary week at Narberth. Illustrative numbers; the mechanism is real.

**What happened.** Wed Sep 16, Hot — Chicken Parmesan, 40 ordered. 34
registered, 28 fed: 22 dined in, 6 taken out. Twelve portions go back in the
walk-in. Thu Sep 17 has a program but no delivery — `Lunch_Schedule` says
`Not Serving`. The kitchen portions out Wednesday's chicken at the counter and
8 people take one home. The remaining 4 are binned Friday.

**What the workbook says today.** Staff tick Thursday's 8 rows with
`Day1_Taken_Out = 1`. There is nowhere else for those counts to go — the only
join is the shared date key, so they land on the 17th, which has no meal. Two
numbers come out wrong, in opposite directions:

| | `Actual_Ordered` | `Total_Consumed` | `Discrepancy` | Dish |
|---|---|---|---|---|
| Wed Sep 16 | 40 | 28 | **12** | Chicken Parm |
| Thu Sep 17 | 0 | **8** | **−8** | *(blank)* |

Wednesday reads as a third of the order wasted, so the obvious correction is to
cut next Wednesday to 28 — and run short. Thursday reads as phantom demand:
`buildDashboardRollup()` has no schedule row to key against, so it creates an
`unplanned` bucket with 8 takeaway meals and no dish, on a day nothing was
ordered.

**What Phase 1 changes.** `Lunch_Schedule` gains a derived `Meal_ID`
(`M-20260916-NARB-HOT`). Thursday's 8 rows get `Meal_Source` set to it — one
dropdown, once. Every other row in the workbook stays blank, blank still means
"today's meal", and so **no existing number moves**.

| | Today | With `Meal_Source` |
|---|---|---|
| Eaten on the day | 28 | 28 |
| Eaten the next day | not recorded anywhere | 8, carried over |
| `Total_Consumed` for the batch | 28 | **36** |
| Actually thrown away | reported as 12 unaccounted | **4** |
| Thu Sep 17 dashboard row | phantom: 8 takeaway, no dish | 8 served from Wed 9/16 |
| What to order next Wednesday | looks like 28 | 36, and 4 is the real trim |

**What this example deliberately does not show,** because Phase 1 cannot do it:
a row that draws on two batches at once (Joe ate Thursday's cold meal *and*
carried out a Wednesday leftover — the row names one or the other); the moment a
fridge meal is collected, so the fridge still never draws down; and per-person
history, since these are still row counts rather than events. All three are §3
Option B's job. None of them is why the Wednesday number was wrong.
