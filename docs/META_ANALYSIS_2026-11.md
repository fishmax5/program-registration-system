# Meta-analysis: what is wrong with the system, and how to fix it without interrupting anyone

*November 9, 2026. Sources: the office digest emails (Oct 12 – Nov 9), staff
threads (Caroline, leaders), system alert mail, the titles and outcomes of
about 50 Claude Code sessions on this repo (Oct 14 – Nov 6), and
`docs/RESTRUCTURING_PROPOSALS.md` with R1–R9. Member names are left out on
purpose.*

`RESTRUCTURING_PROPOSALS.md` is about **speed and usability**: round trips,
menus, consoles. This document is about something else: **evidence that the
system is telling people the wrong thing, or nothing**, and that the way it
changes makes this worse. None of the proposals below replaces R1–R9. Each
one sits beside them.

---

## 1. Findings

### F1. The office digest has stopped being readable (and the worst alarm is buried in it)

| Digest for | Items |
|---|--:|
| Oct 16–26 | 64–120 a day |
| Nov 1 | 122 |
| Nov 2–5 | 213–264 |
| Nov 6 | **299** |
| Nov 8 | 224 |

Item counts tripled in three weeks. What the Nov 8 digest contained:

- **Registration ledger: "🚨 1148 registrations are in the ledger and NOT on
  All_Registrants."** This is the alarm `99n` was built to raise: either rows
  were lost from the tab, or writers record things they never write. It shows
  25 names and then "…and 1123 more". Several of the 25 are **future
  sessions** (a recurring weekly program on Nov 5, 12, 19 and 26 for two
  people), so this is not only stale September history. *Nobody has acted on
  it*. It looks like the same "Registration ledger" block every day, and it
  sits next to 200 other lines.
- **70 registrations where the ledger and the tab disagree.** These follow a
  few patterns, which points to specific writers that are not appending, not
  to random drift:
  - `Program_Status` is Cancelled on the tab and Active in the ledger, for one
    person on every date of a club. That looks like a club cancel path or a
    Quick Mark cancel path that is not recorded.
  - `Meals_Ordered` is blank on the tab and 2 in the ledger, for one person on
    every lunch in November. Something cleared the meal count without an
    entry.
  - `Attended` is ticked on the tab and blank in the ledger, across the
    Ashbridge art club. An attendance writer (leader sheet `Attended`, the
    door, or the web roster) is not appending.
- **87 "could not be replayed"**: all of them a `superseded` entry after a
  registration was already superseded. This is noise about a known,
  harmless double-supersede.
- **78 lines of "Lunch cancelled with people signed up"**, each repeated 6
  times a day ("01:59–20:06, 6×"), every day since Narberth closed. This
  needs action (people have to be told), and the digest has no way to say
  "still open, day 9".
- **54 lines of "Lunch needed with no menu set"**, for January 2027.
- A form with no dates at "(unknown location)", 3 times.

**Diagnosis.** The digest coalesces repeats *within* a day but not *across*
days. It has no severity ordering, no "new vs still open" split, and no cap
per section. The one line that may mean lost registrations looks exactly like
the lines that do not matter. This is `99g`'s "a refusal nobody can see",
recreated at the scale of the office inbox.

### F2. There is no single answer to "who is registered for X?"

- **Medicare Counseling, Nov 9.** Three people are registered for Nov 17.
  Caroline found **no registrant sheet** for the program and an **empty Roster**
  link on the program dashboard. She needed the names to tell the three about
  the move to Ashbridge. The workaround Max gave was *"Cmd-F for medicare on
  All_Registrants."*
- **Intro to T'ai Chi, Nov 2.** The leader's day-before digest listed 8 people.
  The leader replied that the class holds **4** and named two people the
  system had *waitlisted* who are actually in the class. Capacity and who is
  active vs. waitlisted were the system's guess, and the leader is the
  authority. Nothing let her say that except replying to a no-reply email.
- **Heart 2 Heart, Oct 29.** The program was not on the calendar, but its
  registration link (already printed on the website) still opened an
  October-only form. Caroline had to email four people to find out whether
  the program still existed.

**Diagnosis.** A roster exists in up to five places: the tab, the ledger, the
leader sheet, the web roster page, and the dashboard link. Each is built by
its own path with its own conditions (for example, a leader sheet is made a
week before the next session, or when a leader asks for one). When any one is
missing or empty, the person asking cannot tell whether that means "nobody",
"not built yet", or "broken". The system knows the answer and does not give it
in one place.

### F3. Changes to the real world arrive faster than tools to handle them

In two weeks: Narberth closed indefinitely (burst pipe), Low Cost Wills moved,
Medicare moved, rooms were reassigned, and the always-open events were added.
**Each one became its own build session**: Move Sessions to Another Building,
Room Management (three sessions), per-date room picks, Standing Events, a
deleted-registrants loader, and the bulk follow-up email. Several were shipped
**"not yet tested on a real workbook or calendar"**. `99zy` says outright that
its calendar instance lookup is unverified against real Apps Script.

**Diagnosis.** The system models programs well but has no model of an
*operational event* such as "Building X is closed from date A to date B".
Each consequence of one event (move sessions, cancel lunch, tell registrants,
fix the website link, tell leaders) is a separate tool, used in an order only
Max knows. The digest then reports what was left undone, every day, for as
long as the event lasts (F1).

### F4. What is deployed is unknown

Almost every session ends with *"pushed to main; needs clasp push / sync /
redeploy to take effect."* Nothing records:

- which commit the live Apps Script project is running;
- whether the web app (door app, public pages, leader roster) was redeployed
  after the `.gs` sync. That is a separate step;
- whether one-time jobs were run, such as the ledger backfill (the digest still
  says *"until the one-time backfill has been run…"*), the membership alert
  install, Choose System Home Folder, or Update Metrics Now.

So when something "doesn't work", the first question cannot be answered: *is
the fix even live?* The ledger findings in F1 may be real bugs, or code that
is fixed on `main` and not deployed. Nobody can tell from either end.

### F5. Door failures are reported but not resolved

*"A door app sign-in was shown as done and then refused, and has been retried
20 times over the last 40 minutes without ever going through."* (Oct 29). The
optimistic-write design (`99b`) worked as written: it told someone. But the
person left long ago, and the only next step is for a person to re-enter the
sign-in by hand from the email. There is no "pending sign-ins" list to clear
with one click.

### F6. Build pace is higher than verification pace, and every session pays for the codebase's size

- About 50 sessions in about 3.5 weeks, most of them additive features.
- Six sessions are still **blocked** on an unanswered question (room decisions,
  sign-in checkbox size, a confirmation gate, an accessibility audit choice).
  Some of those were superseded by later sessions that made the decision
  anyway.
- `CLAUDE.md` loads into every session in full. It is a few thousand lines of
  per-file narrative, so every small fix pays for the whole history before it
  reads one line of code.
- The test suite is thorough (150 files) but models Apps Script. The faults
  that actually reach staff are about *real* Google behavior: Drive sharing,
  calendar instances, lock lapse, quota, and redeploys. The tests cannot see
  those.

---

## 2. Root causes (what F1–F6 have in common)

1. **The system speaks, but does not rank.** Diagnostics are thorough and
   honest, and they all go to one undifferentiated channel.
2. **Truth is projected into many copies, and each copy can be missing for
   its own reason.** The fix so far has been more diagnostics for each copy,
   not one authoritative read.
3. **Operational events are handled as a pile of tools, not as one object
   with a lifecycle.**
4. **The gap between `main` and live is invisible.**
5. **Changes are additive and unverified live.** Every new path is another
   writer that may forget the ledger (F1's disagreements), and another thing
   to deploy (F4).

---

## 3. Proposals: dark launch, in the existing R-series style

Every proposal follows the same pattern R1/R2/R8 already use:

- **Behind a flag in Script Properties, off by default.** "Off" means exactly
  today's behavior.
- **Shadow mode first.** The new path runs beside the old one, reads only, and
  reports to Max, not the office.
- **A stated gate to turn it on** (for example, N clean days).
- **One-step rollback**: flip the flag. Never a migration that has to be
  undone.
- Nothing changes what Caroline, the desk, the door tablet or a leader
  clicks until the gate is passed.

### P1. A digest that ranks (fixes F1). *Do this first.*

- Each spooled note gets a **severity**: `act-now` / `act-today` / `fyi`. It
  also gets a **stable issue key** (section + subject, for example "lunch
  cancelled | Narberth | 2026-11-10").
- The digest has three blocks:
  1. **New and needs action**, capped at 15 lines and with each line's
     one-click fix named;
  2. **Still open**, one line per issue: *"day 9: 3 people booked lunch at
     Narberth on closed dates (Nov 10–Dec 3)"*;
  3. **FYI**, counts only, with a link to the Health panel for detail.
- Sections that report the same facts every day (ledger buckets, lunch
  without a menu) show the **change since yesterday** (+12 / −3), not the full
  list.
- The ledger alarm is split by date: *missing, future sessions* goes to
  act-now; *missing, past* goes to fyi.
- **Dark launch:** flag `OFFICE_DIGEST_V2`. For 7 days, send the V2 digest
  **to Max only** beside the unchanged V1. Gate: the V2 "new and needs
  action" block holds every item Max would have acted on in V1, measured by
  hand for one week. Then V2 replaces V1 for the office. V1 stays one flag
  away.
- Code: `88` (spool keeps a key and severity, which is additive and
  backward-compatible) and callers' `spoolOfficeNote` gain an optional third
  argument. No caller has to change on day one; anything without a severity
  is `fyi`.

### P2. Settle the ledger before anything trusts it (fixes F1, de-risks phase 4)

- **Read-only triage job first.** Classify the 1148 + 70:
  - by date (past / future);
  - by kind (lunch-only, club/standing, form, desk);
  - by which `Source` last wrote the registration;
  - and for "disagrees", by which **column** and which writer last touched
    that row on the tab.

  This turns "1148 problems" into perhaps 4 to 6 named causes. The F1
  patterns already suggest three: club or desk cancel, meal clear, attendance
  tick.
- For each cause, either **fix the writer** (add the missing append, with a
  test on the `tests/ledger_missing_appends.test.js` pattern), or **mark the
  class as expected** in the verifier so it stops being reported.
- For the future-session "missing" rows, compare against the 3am Drive
  snapshots (`99j`) to find out whether they were *lost from the tab*. If so,
  restore them with `99v` (Restore from the Ledger), which already exists.
  **This is the one check that may affect real people on real dates. Run it
  before anything else in this document.**
- **Keep ledger phase 4 frozen** until the verifier has been clean for 30
  days. That is already the stated gate; this makes it measurable.
- No user-facing change at all.

### P3. A visible deployed version (fixes F4)

- A `DEPLOYED_BUILD` constant (commit SHA and date) is written into one `.gs`
  file by a tiny `tools/stamp_build.js`, run in the same step that already
  syncs to Apps Script. No build step is added to the source, and the
  constant is self-contained, so it is load-order safe.
- It appears in the Health panel, in the digest footer, and on the door app's
  long-press setup screen. The Health panel also compares it with
  `main`'s head through the GitHub Contents API (`99zu` already holds a
  token pattern), and lists the **one-time jobs still owed**. Each one-time
  job records `ONE_TIME_JOBS_RUN_V1` when it finishes, which is additive.
- The web app adds its own stamp, so "the .gs is new but the web app was
  not redeployed" becomes visible.
- **Dark launch:** nothing to flag. It is read-only text in places staff
  already look.

### P4. One answer to "who is registered for X?" (fixes F2)

- **"Find people" in the Health panel and the Staff Console.** Type part of a
  program title and get every live registration by date, read straight from
  `All_Registrants` and `Program_Waitlist`. It does not depend on whether a
  leader sheet, a dashboard link or a web roster exists. It also says *why*
  the other copies are missing ("no leader sheet yet: one is made 7 days
  before the first session, which is Nov 10"). This answers Caroline's
  Medicare email in one step, and her workflow does not change.
- The program dashboard's **Roster** cell is never empty when registrants
  exist. If there is no sheet yet, it links to this search, filtered.
- **A leader can correct capacity and active/waitlist status** without
  replying to a no-reply email. Add a single line to the leader digest:
  *"Wrong number or wrong people? Open your roster"*, linking to the R5 web
  roster (already built, already token-gated), with a `Capacity` request
  that goes into the office digest as `act-today`. It never writes
  capacity directly.
- **Dark launch:** search is additive (a new panel row). The leader-digest
  line is behind `LEADER_DIGEST_CORRECTION_LINK` and is turned on for one
  leader first.

### P5. A closure is one object (fixes F3)

- A **`Closures` staff tab** (Building, From, To, Reason, Move_To optional,
  Status) and a **"Plan this closure…"** dialog that only *composes existing
  tools* into a dry-run checklist:
  1. sessions affected, using `99zy`'s list;
  2. lunch dates to mark Not Serving;
  3. people booked on those dates, with their contact details;
  4. a draft follow-up email to them, using `99q`'s bulk follow-up;
  5. leaders to tell, using `66`;
  6. website links that will now point at dates with no sessions.

  Each step has its own Apply button that calls the existing writer. Nothing
  new writes registrations.
- The digest then reports **one open issue per closure** ("Narberth closure:
  2 of 6 steps done") in place of 78 lunch lines a day.
- **Dark launch:** the tab and dialog are additive, and the planner is
  read-only until a step is pressed. The existing tools stay on their menus.
  Use the current Narberth closure as the live trial, starting with the
  read-only checklist.

### P6. Pending door sign-ins you can clear (fixes F5)

- A **"Sign-ins that didn't save"** list (Desk menu and Staff Console),
  generated from `99b`'s exhausted retries and `63`'s problem list, with a
  per-row **Retry now** or **Add by hand** button that opens Quick Mark
  pre-filled.
- The urgent email links straight to that row.
- **Dark launch:** additive list. The email still goes out as today.

### P7. Change how the system is changed (fixes F6)

- **A verify-live step per ship.** A session that changes a path touching
  real Google services (calendar move, Drive share, web app) ends with a
  three-line "how to check this live" note, put in the Health panel's
  owed-jobs list (P3). Shipped-but-unverified then becomes a visible list,
  not a remark in a session summary.
- **Split `CLAUDE.md`.** Keep the load-order rule, the conventions and a
  one-line-per-file index (about 150 lines). Move the per-file narratives to
  `docs/FILES.md`, read on demand. Every future session gets cheaper and
  starts faster, and no code changes.
- **Batch small requests.** Six sessions are still blocked on questions.
  Collect desk feedback in one weekly list and handle it in one session, not
  ten.
- **Feature pause, two weeks:** P1–P3 only. They are the three that make every
  later fault visible and ranked.

---

## 4. Order and gates

| Week | Do | Visible to staff? | Gate to proceed |
|---|---|---|---|
| 1 | **P2 triage** (read-only) plus the snapshot comparison for future-dated "missing" rows; restore if lost | Only if rows are restored | Every one of the 1148 + 70 is in a named class |
| 1 | **P3** deployed-build stamp and owed-jobs list | Health panel and footer text only | Live build matches `main` |
| 1–2 | **P1** digest V2 in shadow, to Max only | No | One week with no action item missed |
| 2 | Fix the 3–6 ledger writers P2 named; P1 V2 goes to the office | Digest gets shorter | Verifier "disagree" bucket at 0 for 7 days |
| 3 | **P4** Find people; Roster cell never empty | New panel row | Caroline can answer the Medicare question unaided |
| 3–4 | **P6** pending door sign-ins | New list | — |
| 4+ | **P5** closures, piloted on Narberth | New tab and dialog | Narberth closure tracked to Status = Done |
| ongoing | **P7** | — | — |

**Rollback for every row:** flip its flag, or ignore the new panel. Nothing in
this plan removes a menu item, changes a tab staff edit, or changes what the
door tablet shows.

---

## 5. What would sharpen this

- The full ledger buckets from one verifier run (Admin ▸ Reports ▸ Ledger
  verification), not the digest's 25-name sample.
- Whether the ledger backfill (`99o`) has been run on the live workbook.
- Which commit is live in Apps Script today. This needs P3, or a look in the
  editor.
- The Menu Usage report (`99r`). It shows which of the reactive tools from F3
  have actually been used since they shipped.
