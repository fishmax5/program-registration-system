# Google Groups in this system — what it would look like, and what could go wrong

Status: **investigation only.** Nothing in the project reads or writes a Google
Group today, and the manifest enables three advanced services (Drive, Sheets,
Calendar) and no fourth. This document is the thinking before the branch.

The idea: one group for staff, one for all program leaders, and one per club.

---

## 1. The prerequisite, and it is not a small one

Groups cannot be created or have their membership changed from a plain Google
account. It takes the **Admin SDK Directory API**, and the account making the
call must hold an admin role in the Workspace tenant with the Groups
privilege — super admin, or a custom role with "Groups: read / create /
update".

This system runs as **whoever created the triggers** (`17` is a whole file
about that fact), and that account today needs no special standing at all: it
needs to be able to open the workbook, the calendars and the forms. Putting
group membership into the hourly sync means **the trigger owner becomes a
Workspace admin**, and stays one, and that every future "the triggers moved to
somebody else's account" conversation now includes granting that person admin
rights. That is the single biggest cost here and it is organizational, not
technical.

There are two ways to soften it:

- **A custom admin role** limited to Groups, nothing else. The trigger owner
  can manage groups and cannot touch users, billing, security settings or
  another person's Drive. This is the right answer if the feature ships.
- **Read-only membership.** The Directory API can *list* a group's members
  with a much narrower blessing than it takes to change them. A version of
  this feature where the system only ever *reports* drift between a club
  roster and its group, and a person clicks in the Groups console to fix it,
  needs no write privilege. Less useful, far cheaper to allow, and it is the
  honest answer to "we don't want the script able to change mailing lists."

Everything below assumes Workspace with shared drives (which `82`'s anchor and
`04`'s 25-minute sync budget already assume) and a trigger owner who has been
granted the Groups role.

---

## 2. What each of the three group kinds is actually for

They look alike and they are not. Worth separating before any code, because
the settings, the membership source and the failure modes differ.

### staff@ — a destination

Small, stable, changes a few times a year. **No membership sync at all** is
the right first version: a person maintains it in the Groups console the way
they maintain any mailing list, and this system only ever *sends to it*.

What it replaces: Config's **Admin Notification Emails** table as a delivery
list. `88`'s daily digest sends to every address on that table; `15`'s
`notifyAdminUrgent` the same. Both become one address. A new hire starts
getting the digest because somebody added them to a group, not because
somebody found the Config tab and typed into row 3.

What it must **not** replace: the per-category ticks (`ADMIN_NOTIFICATION_CATEGORIES`,
`04`) and — more importantly — `listAuthorizedAdminEmails()` (`01`). See §5.3;
this is the one place a group would make a gate worse.

### leaders@ — a destination and a permission

Membership is derivable: the `Email` column of `Program_Leaders`. So this is
the first group where a sync makes sense, and it is small enough (tens of
addresses) that a full reconcile costs nothing.

What it buys beyond mail is the interesting half: **a group can hold a
permission.** Grant `leaders@` edit on the `Program Registrant Sheets` folder
and viewer on the program calendars, and two long-standing problems get
smaller:

- `89_open_up_all_sharing.gs` exists because every file is created by whoever
  pressed the button and read by whoever owns the triggers, and Drive gives a
  new file to its creator alone. A folder shared with a group hands every file
  *later placed in it* to the whole group. That does not retire `89` — a file
  still needs link sharing for a leader who is not in the group, and the
  sweep's "repair what was made before this existed" job stands — but it means
  the normal path stops depending on the sweep.
- Calendar ACLs stop being per-person.

### club-*@ — a list people are *on*

This is the one with teeth. Membership is `Club_Members` (`Club`, `Location`,
`Email`, `Active`, `Club_Key`), it churns, the addresses are personal Gmail
accounts belonging to members of the public, and **the members can act on the
group themselves** — reply to it, and unsubscribe from it.

Everything in §6 that is genuinely dangerous is about these.

---

## 3. What it buys

1. **Message quota.** `76_rationed_mailer.gs` exists because Apps Script gets
   ~100 messages a day on a consumer account and ~1,500 on Workspace, and the
   project spends them carefully enough to have a floor-per-caller, a day-long
   hold and a digest that replaced four mailing paths. A message to a group
   address counts as **one** message no matter how many people receive it. A
   club announcement to forty people is one.
2. **Staff churn stops touching the workbook.** Nobody edits Config to add a
   person to the digest.
3. **Sharing and calendar access by group** — §2, leaders@.
4. **Clubs can talk to each other** without the office relaying it, if that is
   wanted. It may not be.
5. **An archive.** Also a liability — §6.4.

What it does **not** buy: anything to do with registrants. `33`'s calendar
invitations must stay per-person (a group on an event invites everyone and
shows them to each other), and reminder mail is addressed to one person about
one session.

---

## 4. What the implementation would look like

Shaped like the rest of the project, which is most of why this is cheap to
build and cheap to turn off.

### 4.1 A new numbered file, off by default

`99zs_google_groups.gs` — behavior plus its own constants, numbered last,
reading `HEADERS` and the leader/club readers at call time like every other
late file. One versioned Script Property as the switch
(`GOOGLE_GROUPS_V1`: `off` / `report` / `sync`), on `99zr`'s precedent — off
is today's behavior exactly, `report` only ever tells you about drift, `sync`
writes. **Every entry point returns false when the advanced service is absent
or a call throws**, and the caller carries on the old way: `99zk`'s dispatcher
pattern, for the same reason — a 403 on the Directory API must never be the
reason a sync fails.

### 4.2 The registry

`GOOGLE_GROUP_REGISTRY_V1` in Script Properties — or, given `99zj`'s lesson,
in **Document** Properties if it is per-club and therefore grows forever:
`clubKey → { email, createdAt, aliases }`. Keyed on `Club_Key`, never on the
club's display name, and a renamed club gets an **alias** on the existing
group, never a new group. `22_renamed_programs.gs` is nine stores long because
a rename that misses one store is this project's quietest fault; a tenth store
here is exactly that shape.

A group's address cannot be changed after creation (you add an alias and the
old address keeps working). That is a feature here: the address printed on a
flyer in March still works.

### 4.3 The reconcile

The same shape as every other sync pass in this project:

- read the desired membership off the tab (`Active` rows with a non-blank,
  plausible `Email`, canonicalized through `canonicalMemberName`'s sibling for
  addresses — lower-cased and trimmed, and *not* de-plussed or
  dot-normalized, because two different Gmail spellings are two people as far
  as anybody here can tell);
- read the actual membership (`AdminDirectory.Members.list`, paged);
- diff, and apply only the difference;
- **fingerprint it** (`46`/`99zf`'s rule) so an hour in which no club roster
  moved costs one property read and no API call at all. Without this, "n
  clubs" is n list calls an hour forever.

It runs as a tail step of the registration sync (`98`), after the memory tabs
and before `ledger_verify`, so a spent budget defers it to the follow-up slice
and nothing breaks. It takes no new lock — the workbook lock is already held,
and the only thing being written is outside the workbook.

### 4.4 The group's own settings

Created once, through the Groups Settings API, and never silently changed
afterwards. The defaults that matter:

| Setting | Value | Why |
|---|---|---|
| `whoCanViewMembership` | managers | Otherwise every club member can read every other member's email address. For a senior center that is a real disclosure, not a preference. |
| `whoCanPostMessage` | managers (announce-only) *or* members, per club | A decision per club, not a global default. See §6.2. |
| `replyTo` | the group's managers, or the sender | The default "reply goes to the whole list" is how one person's "please take me off this" reaches forty people. |
| `allowExternalMembers` | **true, and it must also be allowed tenant-wide** | Club members are on gmail.com. If the domain setting forbids external members, nothing works and the error does not say that clearly. |
| `isArchived` | false for anything carrying rosters | §6.4. |
| `whoCanJoin` | invited only | Nobody self-joins a club list. |

### 4.5 Menu and reports

- 🔧 Admin ▸ One-Time Jobs ▸ **Set Up Google Groups…** — creates what is
  missing, names what it would do before it does it, gated and confirmed.
- 📄 Reports ▸ **Group Membership Drift** — read-only, ungated, in
  `HEALTH_CHECKS` (`99zm`): per group, who is on the tab and not in the group,
  who is in the group and not on the tab, who unsubscribed, who is bouncing if
  that can be read. This is the whole feature in `report` mode, and it is
  worth shipping on its own.
- A line in the office's daily digest (`88`) when a sync added or removed
  anybody, because a mailing list changing itself silently is not acceptable.

---

## 5. The three places a group makes an existing thing *worse*

Worth stating plainly, because each is an easy mistake to make while the
feature feels like a simplification.

### 5.1 Bounces go somewhere this system cannot see

Today a send that fails is a return value: `76` records the refused address
and stops paying to be told no twice. A message to a group is accepted in one
hop and then fanned out by Google; a member whose mailbox is full or whose
address is wrong bounces **to the group's managers**, not to the script. So
delivery failure stops being something the workbook knows about. This is
precisely the class of fault the project spends the most code on (see `99d`,
`99h`, `51` — "nothing to fix" and "nothing looked at" are different
answers), and a group reintroduces it by design. The drift report is the
mitigation and it is a partial one.

### 5.2 Two sources of truth for a roster

If the sheet syncs the group, then a staff edit made in the Groups console is
gone within the hour, silently. That is the leader-sheet fault (`46`, `99h`)
in a new place. The answer is the one `99zn` already landed on for rosters:
**declare the direction, per group, in a column** — the sheet is truth and
the group is a projection, or the group is truth and this system only reports.
Not both, not implicitly.

### 5.3 Do not put the admin gate behind a group

`01`'s `ADMIN_GATED_ACTIONS` gate and `99zma`'s menu-role table resolve a
viewer against `listAuthorizedAdminEmails()` plus Config's table. Resolving
them against a group's membership instead means a Directory API call on a path
that runs on a destructive click and on `onOpen`, and `99zma`'s rule is
explicit about what happens when that resolution fails: a blank or unresolved
account gets the **full** menu, because hiding repair tools from the one
person who can run them is the failure never to repeat. A group-backed admin
list is therefore a cached list with a hard-coded fallback — which is what
`AUTHORIZED_ADMIN_EMAILS` already is. Leave the gate alone; use the group for
*delivery* only.

---

## 6. Potential issues, worst first

### 6.1 Somebody unsubscribes and the sync puts them back

Every Google Group message carries an unsubscribe link, and a member who uses
it is removed from the group. The next reconcile reads the tab, sees them
missing, and adds them again — and they get another message, and unsubscribe
again, hourly, forever. **This is the thing most likely to generate an angry
phone call**, and a system that re-subscribes a person who opted out is doing
something worse than a nuisance.

It needs the same shape as `95`'s `AUTO_GROUPED_SERIES_PROP_KEY`: a removal
this system did not make is **an answer**, recorded once
(`GROUP_OPT_OUTS_V1`, keyed group × address) and never argued with. The
reconcile adds an address once; if it comes back missing and this system did
not remove it, that address is opted out until a person says otherwise. The
drift report names them so the office knows, and `Club_Members` gets a note on
the row rather than the tab quietly disagreeing with the group forever.

Detecting the difference between "they left" and "we have not added them yet"
is why the registry has to record **what it added and when**, not just the
desired state.

### 6.2 Reply-all

A club group where members can post is a discussion list, and a senior
center's Mah Jongg list is exactly the place where one "thank you!" becomes
forty inboxes. Announce-only (managers post) is the safe default; a club that
actually wants to talk to each other can be switched on deliberately. This is
a per-club setting and therefore a **column**, not a constant.

### 6.3 Addresses in the group are visible by default

Covered in §4.4, repeated here because it is the one that is a disclosure
rather than an annoyance: a group's default `whoCanViewMembership` lets
members list the membership. Forty email addresses of elderly members,
readable by anyone on the list, is not something anybody consented to.

### 6.4 The archive outlives the message

Groups keep a searchable archive. A roster alert naming registrants — and
this system's leader alerts do name them, with meals and sometimes with
standing needs (`37`) — sitting in an archive that members can browse is a
durable copy of personal information in a place nobody is managing. Rosters go
to people, not to archived groups; or the group has archiving off.

### 6.5 The trigger owner becomes a Workspace admin

§1. Worth a second mention because it is the reason this might simply not be
worth doing: the feature's whole benefit is convenience, and its cost is a
permanent privilege escalation on an account that currently holds none, in an
organization where the triggers have already moved between people once.

### 6.6 Propagation delay

A membership change can take minutes to reach delivery. A leader added and
immediately mailed may not get the message. Not serious, and worth knowing
before somebody debugs it as a bug.

### 6.7 The consent screen, and the non-admin viewer

Adding the Admin SDK adds an OAuth scope, which means **every existing user
re-authorizes the project** on next open, through a screen that says the
script will "view and manage the provisioning of groups on your domain." On a
workbook used by front-desk staff that is an alarming dialog, and a staff
member who declines or who simply lacks the privilege hits a 403 on whichever
path touches Groups. Hence §4.1: guarded whole, off by default, and never on
the path of a desk action.

### 6.8 Group count and naming

Workspace allows plenty of groups, so the count is not the issue; the
addresses are. `club-chair-yoga@` collides with the next Chair Yoga, a club
whose name has an apostrophe or an ampersand needs slugging, and two
buildings running an unlinked club of the same name are **two clubs** here
(`99m`'s `Calendar_Source | Clean_Title` boundary) and therefore two groups,
which the address has to distinguish. A prefix and the `Club_Key` is the
obvious answer; it is not a pretty address.

### 6.9 One more store to carry a rename through

§4.2. `22` is the file that records what this costs.

### 6.10 It does not reduce anything to zero

The clubs still need `Club_Members` (lunch, phone, `Primary_Registrant`,
`Joined_On`, standing places — a group holds an address and nothing else), the
leaders still need `Program_Leaders` (which program, which timing, which
sheet), and the office still needs Config (who is copied on what). Groups sit
beside all of it as a delivery and permission mechanism. If the hope is that
they replace a tab, they do not.

---

## 7. A staging that answers the question cheaply

Each stage is independently useful and independently abandonable.

| Stage | What ships | What it proves |
|---|--:|---|
| 0 | Nothing in code. A person makes `staff@` and `leaders@` by hand; Config's table holds the two addresses instead of eight. | Whether one address per audience is actually better. Costs no code and no scope. |
| 1 | `leaders@` granted access to the registrant-sheets folder and the calendars. | Whether group-held permissions do what §2 claims — measurable against how often `89`'s sweep finds something. |
| 2 | The Admin SDK scope, read-only. `report` mode and the **Group Membership Drift** report in the Health panel. | Whether the drift is real and worth automating, and what the opt-out situation looks like, before anything can write. |
| 3 | `sync` mode for `leaders@` only — small, stable, and nobody on it is a member of the public. | The reconcile, the fingerprint, the registry, the digest line. |
| 4 | Clubs, one club first, announce-only, with the opt-out store from day one. | Everything in §6. |

Stage 0 is worth doing this week regardless, and stages 2 and 3 are maybe two
days of work with the scope granted. Stage 4 is the one to be slow about.

---

## 8. What to decide before any of it

1. Is the trigger owner allowed to hold a Groups admin role — and if the
   triggers move, does that transfer? (§1, §6.5)
2. Do clubs get announce-only lists or discussion lists? Per club, or one
   rule? (§6.2)
3. Who owns a club's membership — the sheet or the group? (§5.2)
4. Is a club member's email address allowed to be visible to other members of
   that club? (§6.3)
5. Do roster contents go to a group at all, given the archive? (§6.4)
6. Is the goal fewer messages, less sharing work, or less Config editing? Each
   points at a different stage above, and only one of them needs the write
   scope.
