# Google Groups in this system — an investigation

Status: **investigation only.** Nothing here is implemented, nothing here is
decided. Written 2026-10-14 against the tree at the time.

There is no Google Groups integration in this project today. The phrase
"mailing list" appears four times and is metaphor every time (`65`'s banner on
why attaching a leader to a program is not the same as putting them on one;
`99f`'s on why the volunteer page needs a PIN). `appsscript.json` enables Drive
v2, Sheets v4 and Calendar v3 and nothing else. The live setup is a Google
Workspace domain (`newhorizonsseniorcenter.org`), which is the one fact that
makes most of what follows possible at all — on a consumer account almost none
of it is.

---

## 0. The frame: a Group is five different things

"Google Group integration" is not one feature, and treating it as one is how
this gets scoped wrong. A Group is five capabilities wearing one address, and
this codebase has a distinct, already-painful seam for each:

| | A Group is… | The seam it lands on |
|---|---|---|
| **1** | a **fan-out address** — one recipient, many readers | `76_rationed_mailer`, `88_office_daily_digest`, `99i` |
| **2** | a **permission principal** — an ACL entry Drive and Calendar accept | `89_open_up_all_sharing`, `46`, `99zr`, `82` |
| **3** | a **membership set** — queryable: is this address in this group? | `01_logging_and_access`, `99zma_menu_roles` |
| **4** | a **durable searchable archive** — free, permanent, threaded, full-text | `88`, `99zd`, `log()` |
| **5** | a **collaborative inbox** — assign, resolve, reply-to a shared place | `72`'s membership handoff, `63`'s check-in problems, `99s` |

Capacities 1 and 4 are the same send. Capacity 2 is the one with the largest
mechanical payoff. Capacity 5 is the one that gives the office something it has
never had. Capacity 3 is the one most likely to cause an outage if done
carelessly, and it is the one people reach for first.

The rest of this document works through them in that order, then states what a
Group **cannot** do, then proposes a staged plan.

---

## 1. Capacity 1 — the quota multiplier

### What the code does now

`sendRationedEmail` prices a send at exactly one message per address:

```
76_rationed_mailer.gs:506     const cost = 1 + bccList.length;
```

and its banner says so in words: *"Every BCC'd office address is its own
message against the same allowance, so a send is counted at one plus however
many of them there are, never at one."* The daily digest does the same thing
without going through the mailer at all:

```
88_office_daily_digest.gs:453  const emails = getAllAdminNotificationEmails();
88_office_daily_digest.gs:459  MailApp.sendEmail(emails.join(','), …)
```

So an office of six on Config's Admin Notification Emails table costs six
messages for one digest, six for every `notifyAdminUrgent`, and — the
expensive one — six **per diverted message** in notification test mode
(`99i`), which is capped at `NOTIFICATION_TEST_MODE_MAX_PER_RUN` (12)
specifically because each rehearsal spends real quota.

`76`'s banner records what that cost actually did on 2026-09-20/21: 25
held-back roster alerts for one leader, 21 held-back digests for another, and
**21 outright `Service invoked too many times for one day: email` failures**,
because every hourly sync re-diverted the same copies to the office.

### What a Group changes

A group address is **one recipient**. The fan-out to its members happens on
Google's side, after the send, and is not metered against the sender's
`MailApp` allowance. So:

- the digest goes from `|office|` messages to **1**
- every `notifyAdminUrgent` goes from `|office|` to **1**
- test-mode diversion goes from `12 × |office|` to **12**, which makes the cap
  a cap on *reading volume* rather than on quota, which is what its banner
  wishes it were
- `LEADER_ALERT_QUOTA_RESERVE` and `REMINDER_QUOTA_RESERVE` stop having to
  reserve headroom for an office table that grows every time somebody is hired

**Verify before relying on it.** I am reasoning from the documented recipient
model, not from a measurement on this account. The honest test is two sends and
two reads of `MailApp.getRemainingDailyQuota()` — one to a group of six, one to
six addresses — in a throwaway script. Do that before any code change prices
a group at 1. (`RATIONED_MAIL_ASSUMED_QUOTA = 100` is the conservative consumer
number even on Workspace, which is the right kind of wrong and should stay.)

### The shape the change would take here

`sendRationedEmail` already has the one place that prices a send, and
`getAllAdminNotificationEmails()` already has the one place that answers "who
is the office". A Config cell — `Office_Group_Address`, one address — read by
`getAllAdminNotificationEmails()` as a **preferred** answer with the table as
the fallback, is a two-function change that every one of the eight call sites
inherits for free. Fail-open, like `Automation_Enabled` and
`Pause_Outbound_Mail`: a blank or unparseable cell means "use the table",
which is today's behaviour exactly.

---

## 2. Capacity 2 — the permission principal (the biggest win)

### What the code does now

`openUpFileToAnyoneWithLink()` (`46_program_leader_sheets.gs:1930`) does two
things to every artifact this system makes:

```
46:1974   const wanted = listAuthorizedAdminEmails()
46:1975     .concat([getTriggerOwner(), getCurrentUserEmail()])
46:1976     .concat(getAllAdminNotificationEmails())
…
46:1994   driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT);
```

That is **one `addEditor` call per address per file**, plus a link-sharing
write. `89_open_up_all_sharing`'s banner puts the artifact count at "three
hundred", which is why it had to become a sliced job on `75` with a four-minute
budget and a resume trigger: *"a workbook with three hundred artifacts is more
Drive calls than one execution has."*

Two costs follow from the per-address shape, and the second is worse than the
first:

1. **~300 files × ~6 addresses ≈ 1,800 Drive writes per sweep.** A group is one
   address, so the same sweep is ~300 writes — it very likely stops needing to
   be sliced at all.
2. **Membership changes require re-running the whole sweep.** Hire somebody,
   add them to the Config table, and not one of the three hundred existing
   files knows about them until a person presses Open Up All Sharing and waits
   out its slices. With a group as the editor, **adding them to the group gives
   them all three hundred instantly**, and the sweep's job shrinks to "files
   made before the group existed". This is the structural win; the call-count
   saving is a side effect.

### And it retires a privacy trade this repo is uncomfortable with

`89`'s banner argues the link-sharing trade honestly and reluctantly: *"a
registration form is a public sign-up page and a roster is first names and
ticks; the alternative in practice is a file nobody can open and a feature
nobody uses."* `99zr` refuses the same trade for the shared responses
spreadsheet in as many words:

```
99zr:719   // NAMED EDITORS ONLY. It holds every registrant's name, phone and e-mail:
99zr:720   // the link sharing the forms get would publish all of it.
```

A group makes the third option real. With `nhsc-system@` (or similar) as a
named editor, the alternative to "anyone with the link can edit" is no longer
"a file nobody can open" — it is "a file the group can open". That means
**registrant sheets can stop being link-editable**, which is the single
largest exposure this system currently accepts on purpose. Forms stay public,
because a sign-up page must be.

### The maximal version: a group on the shared drive

`82_drive_organization`'s anchor is already the shared drive's root on the live
setup. A group added as **Content Manager on the shared drive itself** gives
every file beneath it — forms, rosters, sign-in Docs, snapshots, the ledger
archive, the responses spreadsheet — to every member of that group with
**zero per-file calls, now and in future**. At that point `89` is not an
optimisation target; it is mostly obsolete, retained only for artifacts that
ended up outside the anchor (which is exactly what `82`'s sweep exists to drag
back in).

This is the highest-leverage idea in this document and it is almost entirely a
*configuration* change, not a code change.

### The creative extension: a group per program, for leaders

`46` shares one registrant sheet per program, and the people who need it are
**external** (leaders on gmail/aol — a group solves the internal
trigger-owner-vs-creator problem, not this one, unless you go further). Going
further: a group per program, whose members are that program's leaders, as the
sheet's editor. Then:

- leader turnover is a group membership edit, not a re-share of a file
- `Program_Leaders`' notify ticks and the sharing list stop being two
  hand-maintained lists of the same people
- `99h`'s leader-sheet doctor gains a checkable fact it does not have today —
  "is this program's group non-empty?" — for the case where a sheet exists and
  nobody can open it

Costs: external members must be permitted by Workspace policy, and creating a
group per program needs Admin SDK (see §6). This is the stage to do **last**,
if at all, and only once the office has opinions about the first four.

---

## 3. Capacity 3 — the membership set (handle with care)

### What the code does now

Two independent notions of "staff", both hand-maintained:

- `AUTHORIZED_ADMIN_EMAILS` — a **hardcoded array in source** (`01`), plus the
  workbook owner, read by `isAuthorizedAdmin()` / `requireAuthorizedAdmin()`.
  Changing it is a code edit and a deploy.
- Config's Admin Notification Emails table (`15:1285`) — which `99zma` unions
  with the above to decide **who sees the Admin menu**, and which `46` unions
  into the sharing list.

So a new coordinator has to be added in two places, one of which is source
code, and neither of which is where the office manages people.

### Why a group is the obvious answer and the dangerous one

It is obvious: `is this address in staff@?` is one lookup, managed in the Admin
console by whoever already manages accounts.

It is dangerous because of the two rules this project has already learned the
hard way, and they point in opposite directions:

- `99zma`'s banner: *"The last time a menu was hidden from an account onOpen
  could not identify, a genuine admin opened the workbook to find no Admin menu
  at all. So a blank account is its own role, `unknown`, and `unknown` gets
  EVERYTHING. … Any failure in resolving the role is also `unknown` — never
  `staff`."* Fails **open**.
- `01`'s `requireAuthorizedAdmin`: *"FAILS CLOSED: an email that can't be
  determined is treated as unauthorized."*

`GroupsApp.getGroupByEmail(addr).hasUser(email)` **throws** when the executing
account cannot see the group — which includes a simple `onOpen` trigger on a
consumer-signed-in viewer, exactly the case `99zma` was burned by. So:

> **A group may widen who is recognised. It must never be the only thing that
> narrows.** In `99zma` a Groups lookup is safe to add — a throw lands in the
> existing `catch` and resolves to `unknown`, which already gets everything. In
> `01` a Groups lookup must be unioned *on top of* `AUTHORIZED_ADMIN_EMAILS`,
> never in place of it, or a Groups outage locks every destructive item for
> everybody, with `99g`'s report as the only clue.

The lighter-touch version, which sidesteps `GroupsApp` entirely: let the
**Config cell hold a group address**, and resolve its membership once per
execution via Admin SDK where available, falling back to the table. Or simpler
still, and probably correct for now: leave role resolution alone and spend the
Groups budget on §1, §2, §4 and §5, which carry no outage risk at all.

---

## 4. Capacity 4 — the archive the system does not have

This is the one I would not have predicted before reading `99zd` and `88`
together, and it may be the best value-per-line in the document.

### The failure it answers

On **2026-10-09**, Script Properties reached 512KB of its ~500KB ceiling and
refused the registration sync's own plan (`99zj`'s banner). `88` already caps
its spool at `OFFICE_DIGEST_MAX_SPOOL_CHARS` (120K across every day) and, past
it, **drops the oldest closed days unsent** — a digest that is not going out
because nobody put addresses on Config is a digest that eventually deletes
itself. And `log()` goes to Stackdriver, which the office cannot read and which
expires.

So: every durable thing this system has to say about itself competes for a
500KB store shared with the sync's own state, and the losing end of that
competition is the office's history.

### What a Group gives for free

A Google Group is a permanent, threaded, **full-text searchable** archive with
no storage quota the script has to manage, no Script Properties cost, and a web
UI the office can already sign into. Mail the digest to `system-log@` and:

- *"When did the Chair Yoga roster last fail to push?"* becomes a search box
  instead of a question nobody can answer
- a missed 10am trigger stops being a data-loss event, because yesterday's
  digest is in the archive whether or not anybody read the mail
- `88`'s spool only has to survive until 10am, not until somebody reads it —
  which takes the pressure off the cap that currently drops days
- `notifyAdminUrgent`'s two callers (a Quick Mark that would not save, a door
  sign-in that did not complete) leave a permanent trace instead of one email
  somebody archives

**The retention question is real and is not technical.** A roster alert names
registrants; a check-in problem names the person whose registration did not
land. Putting those into a permanent, searchable, broadly-readable archive is a
records decision for whoever is accountable for member data — not a thing to
switch on because it is convenient. The clean split: **a system-log group for
the machine's own voice** (failures, counts, which sheet, which form), and
member-identifying lines stay on the existing narrow path. `88` already
sections its notes, so the split is a filter on section, not a rewrite.

---

## 5. Capacity 5 — the collaborative inbox (the thing the office lacks)

Three places in this system produce **work items for a human** and track none
of them:

- `recordMembershipHandoff` (`72`) — a name, a number, and the application's
  link, filed as one digest line. Whether anybody rang them back is recorded
  nowhere.
- `recordCheckInProblem` (`63`) — a queued mark given up on. Its page copy is
  *"DISMISSED by whoever next loads a roster, which on a two-site day is
  routinely the tablet at the other building"*, and `63`'s banner says the
  digest line exists precisely because it *"outlives that dismissal and reaches
  somebody whose job is to put it right."* There is still no record that it
  *was* put right.
- `99s`'s unopenable forms, and `99h`'s empty rosters — reports a person reads
  and then re-reads tomorrow, with no state in between.

A Groups **collaborative inbox** is assignment + resolution + search, for
approximately zero code: send those lines to `desk-followups@`, set the group
to collaborative inbox in its own settings, and the office gets a thread per
item it can take, mark resolved, and search later. The workbook stays the
system of record for registrations; the group becomes the system of record for
*"did anybody deal with that"*, which the workbook has never tried to be and
probably should not become.

The only code involved is the destination address and a `replyTo`. Everything
else is a Groups setting.

---

## 6. The cheapest change in the document: `replyTo`

Today every message leaves as the **trigger owner** — a real person. So:

- a member replying to a reminder reaches one staff member's personal mailbox
- a leader replying to a roster alert ("can you add Joan?") does the same
- when that person leaves, those replies go nowhere, and nobody knows

`sendRationedEmail` builds one `options` object (`76:501`–`526`). Adding
`replyTo: <group address>` is **one field in one function**, and every send in
the project inherits it. It needs no Groups API, no admin rights, no scope, no
migration — only that the group exists and accepts mail. If exactly one thing
from this document ships, it should be this one.

---

## 7. Calendar, briefly

`33_calendar_invitations` puts registrants — and deliberately nobody else — on
the real event, and has a one-time sweep (`removeAdminGuestsFromCalendarEvents`)
taking staff addresses back *off* events they are still on. A group is a valid
guest and a valid calendar ACL principal, which offers two small things:

- staff-facing events (not program events) can carry one group guest instead of
  a list that has to be swept
- the calendars in `CALENDAR_MAP` can be shared **to a group** rather than
  per-person, so a new coordinator sees every program calendar on day one

Neither is urgent. Both are configuration, not code.

---

## 8. What a Group cannot do — read this before promising anything

1. **You cannot read a group's messages from Apps Script.** There is no API
   that hands you the content of posts to a group. The Groups Migration API
   inserts archival copies; it does not read. So **a Group is a write surface
   plus a membership-read surface, and nothing else.** Any idea of the form
   "staff reply to the digest and the workbook picks it up" is out — that would
   need a mailbox and `GmailApp`, which is a different design with different
   consent questions.
2. **Membership management needs Admin SDK, not `GroupsApp`.** `GroupsApp` is
   read-only (`hasUser`, `getUsers`) and only sees groups the executing account
   can see. Creating groups, adding and removing members needs the
   **AdminDirectory** advanced service, the
   `admin.directory.group` scope, and an executing account with group-admin
   privileges — or a service account with domain-wide delegation, which plain
   Apps Script cannot hold without a key file. **A group per program (§2) is
   gated on this.** The first four stages below are not.
3. **A Group cannot own a Drive file.** It can be granted access; the file still
   has an owner. The shared-drive route (§2) is how you get ownership out of an
   individual's hands.
4. **External members and posting permissions are Workspace settings.** Leaders
   on gmail can only be group members if the domain permits external members,
   and the script's sends bounce unless the group's posting policy admits the
   sending identity. A group that silently refuses the script's mail is a new
   way for the office to hear nothing — which is `99g`'s whole subject, so it
   belongs in that report as a checkable reason.
5. **Group membership is not a gate for the public pages.** The door app, the
   volunteer self-log and the leader roster page are opened by people who are
   not signed in to anything. The PIN (`60`) and the per-program token (`99zn`)
   stay exactly as they are. Nothing in this document touches them.
6. **A group address in a `Payload` or an `Admin_Notes` stamp is still PII-ish
   routing data.** Nothing here should end up in the registration ledger.

---

## 9. A staged plan, ordered by value over risk

Each stage is independently shippable, independently reversible, and does not
depend on the stage after it.

**Stage 0 — no code.** Create the groups and measure. `office@` (or reuse an
existing one), `system-log@`, `desk-followups@`. Then the quota measurement
from §1: two sends, two `getRemainingDailyQuota()` reads, one to a group of six
and one to six addresses. Everything below is priced on that answer.

**Stage 1 — `replyTo`.** One field in `sendRationedEmail` (§6). Rollback is
deleting the field. No Config cell needed if the address is a constant, though
a cell is kinder.

**Stage 2 — one address instead of six.** A `CONFIG_LAYOUT` section with
`Office_Group_Address`, preferred by `getAllAdminNotificationEmails()` with the
table as fallback. Config's highest `startCol` is **42** today (14 sections), so
a new section starts at **43** — fresh columns, never a reflow, per `04`'s own
rule. Cuts digest, urgent and diverted-message cost to 1 each. Rollback is
clearing the cell.

**Stage 3 — the group as a named editor.** Add the group address to `wanted` in
`openUpFileToAnyoneWithLink` (`46:1974`) and, separately and more importantly,
add the group to the **shared drive** (§2). Measure `89`'s sweep before and
after; it may stop needing to be sliced. Rollback is removing one entry from
one array.

**Stage 4 — stop link-sharing the registrant sheets.** Only after Stage 3 has
been verified on a real leader sheet opened by a real leader. This one *changes
a live shape* — files already out in the world have their sharing set — so per
this repo's own convention it ships its migration in the same commit: a sweep
that tightens what Stage 3 has already widened, idempotent, returning 0 when a
file is already right, resumable on `75`. Rollback is `89` as it stands today,
which is why `89` should not be deleted even when it looks obsolete.

**Stage 5 — collaborative inbox for the three work-item sources (§5).** Mostly
Groups settings plus a destination; the retention split from §4 applies.

**Stage 6 — role resolution (§3), or not at all.** Widening only, union only,
`99zma` before `01`, and only if the office actually finds the two-list problem
annoying. The safest version of this stage is to skip it.

### What any of it owes this codebase

- a new stored shape gets a `_V1` key (`06`'s convention)
- a constant derived from another file's goes through `defineLazyGlobal_`
  (`01a`), and `tests/load_order.test.js` is what notices if it does not
- a change to a live shape ships its state A → state B repair in the same
  commit and registers it in `FORM_STATE_MIGRATIONS` (`68`) if it touches a
  form — Stage 4 is the one that triggers this
- a new reason the office hears nothing belongs in `99g`'s report (§8.4)
- tests are plain Node scripts under `tests/`, no runner, no dependencies

---

## 10. One-paragraph answer, if that is all there is room for

The two changes worth making are both unglamorous: **`replyTo` a group** (one
field, fixes replies vanishing into a personal mailbox) and **a group on the
shared drive** (configuration, not code — turns ~1,800 Drive writes per sharing
sweep into ~300, makes hiring somebody a membership edit instead of a
three-hundred-file re-sweep, and finally makes it possible to stop
link-sharing rosters that contain members' names). The interesting one is
**the group as an archive**: it gives the office a permanent searchable history
of what the system did, which it has never had, and relieves the Script
Properties store that overflowed on 2026-10-09 — subject to a records decision
about member names that is not the engineer's to make. The one to be careful
with is **membership as an authorization source**: a Groups lookup may widen who
is recognised and must never be the only thing that narrows, because
`GroupsApp` throws exactly where `99zma` has already been burned once.
