# R6 — One staff console instead of many modal dialogs (transition plan)

Item #6 of `docs/RESTRUCTURING_PROPOSALS.md`. Written before the code, kept
current with it. File: `99zo_staff_console.gs`. Menu: **🗂️ Open the Staff
Console** directly under Quick Mark (`menu_openStaffConsole` in `99r`).

## The one decision: a modeless dialog

| Host | Width | Runs as | Verdict |
|---|---|---|---|
| Sidebar | fixed 300px | the person | Too narrow. Quick Mark is laid out for 560px, the bulk-add review table for 920px. Every panel would need re-laying-out, which is exactly the rewrite this pass must not do. |
| Web app `?mode=staff` | any | **the OWNER** (`60`'s deployment executes as the owner) | Wrong identity. `getCurrentUserEmail()` (`01`) would return the owner for every desk write, so `Admin_Notes` stamps, the ledger's `Actor`, and volunteer-hour `Logged_By` would all name the office account. `99f` already had to pass `loggedBy` by hand for exactly this reason; doing that for every writer is a change to nine server paths. Also needs a deployment, a URL, and a second gate. |
| **Modeless dialog** (`showModelessDialog`, 1000×760) | wide | **the person** | Chosen. Same execution identity, same `ADMIN_GATED_ACTIONS`, same `google.script.run` semantics as today's modals, no deployment. It stays open while staff scroll the sheet, which a modal does not allow. |

Limits of the choice, stated: Sheets shows ONE dialog at a time, so opening any
old modal (or a server call that opens one) replaces the console; a dialog
cannot be resized by the user; and it does not survive a page reload.

## How a dialog moves in without being rewritten

Every migrated dialog's page is **the same HTML its builder produces today**,
run unchanged inside an `<iframe srcdoc>` in the console. The console shell is
small (chrome, tab bar, one escaping helper, the bridge); a panel's markup —
and the data its builder inlines — reaches the iframe either inside the
console's own document or from `google.script.run.staffConsolePanel(id)`, and
which one it is changes nothing about the page (see **What opening it costs**
below).

A child iframe has no `google.script.run` of its own, so
`staffConsoleWrapPanelHtml_()` prepends a ~60-line **bridge shim** to the page:
`google.script.run` in the child is a chainable proxy
(`withSuccessHandler`, `withFailureHandler`, `withUserObject`, any function
name) that `postMessage`s `{fn, args}` to the console, which makes the real
`google.script.run` call and posts the result (or `{message}` of the error)
back. `google.script.host.close()` returns the panel to its launcher;
`setHeight`/`setWidth` are no-ops. Structured clone across `postMessage`
means the child receives plain objects in its own realm, as it did from
`google.script.run` before.

A child calling one of the dialogs' own `show…Dialog` functions (Quick Mark's
"Log volunteer hours" link calls `showVolunteerHoursDialog`) is intercepted and
opens that panel in the console instead — otherwise it would open a modal that
REPLACES the console.

Panels are hidden, never destroyed, on tab switch: client state (a half-typed
form, Quick Mark's log of marks, the bulk-add review, a running poll) survives
moving between tabs. "↻ Reload" on a panel re-fetches it fresh — live, past
any copy carried with the document or built ahead.

## What opening it costs

A `google.script.run` is a whole Apps Script EXECUTION, and on this workbook
that is a second or two before the server has read anything. The first version
of the console removed the dialog per job and kept the round trip per job:
opening it spent two executions end to end (the document, then the desk's
page, with "Opening Quick Mark…" on screen for the second), and every other
panel cost one more the first time it was opened. Three changes pay that,
none of which touches a panel's own calls.

**1. The pages the console is certain to need travel inside its document**
(`staffConsoleInlinePanels_()`). The panel it opens with (`STAFF_CONSOLE_OPENS_WITH`,
Quick Mark) is built in the SAME execution that builds the chrome, so the
console paints with Quick Mark already interactive and asks the server nothing
at all. Two more are free to carry and marked `static` on their panel entry,
because their pages contain no workbook data and so cannot go stale: Add
Registrants in Bulk (`99q` inlines nothing already) and the Health panel
(`99zm`'s checks are a constant and nothing runs on open). **The statics are
given the room first**, which reads backwards until you ask what each page
loses by not fitting: a static page has no smaller version and costs a whole
round trip the first time its tab is opened, while the opening page has one and
costs a round trip for data it already knows how to ask for.

The ceiling is `99g`'s failure: a dialog whose document grows too big does not
fail — the execution completes, the banner clears and no dialog appears. So
every carried page is measured AS ENCODED against `STAFF_CONSOLE_INLINE_MAX_CHARS`
(450K, below the ~0.5MB Quick Mark's own modal is proven at, not at it). Over
it, a panel falls back to its `buildLite` — for Quick Mark, its own
"fetch your own lists" page, 86K against a stored index that may be 400K —
and failing that is not carried at all, so the client fetches it exactly as
before. The whole step is guarded whole, because it runs before the dialog
exists and nothing there may be able to stop it appearing
(`showQuickMarkDialog()`'s own banner, on the same risk). A panel whose gate
refuses is never carried: the refusal is fetched live, since the reason may
not hold ten minutes from now.

The carried pages cross into the console's one `<script>` block through
`staffConsoleInlineJson_()` — **encoded once**, not twice like every other
value in this project. The double encoding is right for a context and wrong
for a page: the inner pass is already full of escaped quotes and the outer one
escapes each of them again, and it is the doubling that decides whether Quick
Mark's lists can ride along. Single `JSON.stringify` is valid JavaScript by
construction, every `<` becomes `\u003c` (so no `</script>` and no `<!--`,
however a program is titled) and U+2028/U+2029 are escaped. `tests/inline_pages_parse.test.js`
compiles the shell carrying a page titled `Tai Chi </script>`.

**2. The rest are built ahead, while nobody is waiting** (`staffConsolePanels(ids)`).
Volunteer hours, a private session and closing a run of dates read staff tabs,
so they cannot ride along — but the console is up, the desk is reading its
first screen and the server is idle. One batched execution builds all three and
the client keeps them, so the first open of each is a paint. Batched because
the cost being removed is the EXECUTION rather than the work: three pages in
one execution is one spin-up, the session table is read once between them
(`getSectionedRows`/`getSectionedRowValues` are memoized per execution, `08`),
and the member roll is read once for the two pages that want it
(`collectKnownMembers()` gained a per-execution memo, cleared by the same two
writers that clear the door's — `writeMemberRollTab()` in `79` and
`applyMemberNameCorrection()` in `77`).

**The desk comes first, always.** The prefetch waits out
`STAFF_CONSOLE_PREFETCH_IDLE_MS` of quiet, stands down whenever any panel has
a call in flight, goes at most `STAFF_CONSOLE_PREFETCH_MAX_ROUNDS` times and
gives up silently on a failure — a mark pressed at the desk must never queue
behind a page nobody has asked for. Server-side it is budgeted
(`STAFF_CONSOLE_PREFETCH_BUDGET_MS`, `STAFF_CONSOLE_PREFETCH_MAX_CHARS`) and
hands back what it did not reach. A page built ahead is kept for
`STAFF_CONSOLE_PREFETCH_TTL_MS` (10 min) and then asked for again: these carry
a roll of names and a list of recent visits, and showing a twenty-minute-old
copy without saying so is the one thing a cache here must not do. A `static`
page has nothing in it to go stale and is exempt.

**3. What the console can answer itself, it does.** The Health tab used to
spend a round trip on `staffConsoleHealthInfo()` before it could draw — that is
a `typeof` on the server, so it is resolved while the document is built and
travels with it. The function stays, for the fallback path and so that one
answer has one definition.

Net: opening the console is one execution with no waiting panel, and the first
open of any panel after it is free. Nothing about a panel's own calls changed —
a Mark is still one `google.script.run`, issued when the page issues it.

## Dialogs moved in this pass

All server functions below are **unchanged**; the console calls the same
builder the menu item calls, behind the same gate.

### Quick Mark + Change this registration (`36` / `38` / `99a`) — Desk tab
- **Server:** `buildQuickMarkHtml(readyQuickMarkIndex())`, gate `isDeskWorkBlocked()` → `deskBusyMessage()` shown in the panel. Carried inside the console's document when it fits (`buildLite` → `buildQuickMarkHtml(null)` when it does not), so the normal open is one execution. Page calls `getQuickMarkIndex`, `refreshQuickMarkIndex`, `applyQuickMarkFromDialog`, `applyQuickMarkForHousehold`, `applyRegistrantChangeFromDialog`, `addProgramWaitlistEntryFromDialog`, the regular-needs and any-date-list readers — all through the bridge, unchanged.
- **Client state:** `INDEX`, picks, the mark log, the change panel — in the iframe, kept across tab switches.
- **Escaping:** unchanged (the builder's own double-`JSON.stringify` into `<script>`, `textContent` for data).
- **Optimistic writes:** unchanged by construction. The page still draws the mark as done before the call returns; the server still answers `{ok:true, queued:true}` behind a sync (`99w`'s `deferQuickMarkBehindSync_`) and still queues refusals on `99b` / mails `reportOptimisticQuickMarkFailure`. The bridge adds one `postMessage` hop each way and changes no ordering: calls are issued in the order the page makes them, each its own `google.script.run`, exactly as before.
- **Size failure mode (`QUICK_MARK_INLINE_INDEX_MAX_CHARS`, `99g`):** the builder still applies its 400K ceiling and fetches above it. The console adds a second safety: the panel arrives as a `google.script.run` RETURN VALUE, so a payload too big fails into the panel's failure handler ("could not open — ↻ try again") instead of the modal's silent nothing.
- **Focus:** the iframe is focused when shown; `needText.focus()` etc. work as the page is visible when they run.

### Log Volunteer Hours (`99e`) — People tab
- **Server:** `buildVolunteerHoursHtml(volunteerDialogContext())`; page calls `logVolunteerVisit…` unchanged. Not gated (never was). `name` is focused by the page itself.

### Log a Private Session (`99zi`) — People tab
- **Server:** `buildPrivateSessionHtml(privateSessionDialogContext())`; page calls `logPrivateSession`. Not gated.

### Add Registrants in Bulk (`99q`) — People tab
- **Server:** `buildBulkRegistrantsHtml()` (inlines nothing already, which is what makes it `static`: carried with the document, never re-fetched for age). Page calls `listBulkRegistrantPrograms`, `readBulkRegistrantColumns`, `readBulkRegistrantXlsx`, `startBulkRegistrants`, **`bulkRegistrantsStatus` polled every 4s**, `stopBulkRegistrants`, `continueBulkRegistrants`, `dismissBulkRegistrantsResult`.
- **Sliced job:** untouched. The job still runs on `runSlicedJob` triggers whether or not anything is watching; the poll is the page's own `setInterval`, which keeps running while the tab is hidden (as it did while the modal was open) and stops when the console closes. Reopening the panel shows the job's state from `bulkRegistrantsStatus` exactly as reopening the modal did.
- **File input:** FileReader runs in the iframe; the base64 string crosses `postMessage` unchanged.

### Close Sessions to New Registrations (`99m`) — Programs tab
- **Server:** gate `isBootstrapActive()` → `bootstrapBusyMessage()`; no upcoming programs → the same sentence the menu item alerts; else `buildBulkWaitlistOnlyHtml(listWaitlistProgramSessions())`. Apply calls the same server function.
- Refusals are shown IN the panel rather than as an alert (the console is already in front of the person; an alert from a modeless dialog's fetch would stack on top of it).

## Health and Settings
- **Health:** resolved on the server while the document is built (`staffConsoleHealthInfo()`, inlined — the tab costs no round trip to draw) and `static`, since nothing in R4's panel runs on open. If `typeof showHealthPanel === 'function'` (R4) the tab offers it; since it is not yet known whether R4's panel is a dialog or a builder, a builder `buildHealthPanelHtml()` is embedded when it exists, and otherwise a button calls `showHealthPanel()` and says that it opens in place of the console. Neither present → a placeholder.
- **Settings:** "Open the Config tab" and a list of what will move here.

## Rollback
The console is additive: it adds one file, one menu line, one `menu_` wrapper
and one CLAUDE.md section. Every old menu item and dialog is untouched and
still the primary path. Rollback = delete the menu line (or the whole file and
its wrapper). No stored state, no Script Properties, no triggers.

## Manual test checklist (live workbook)
1. Menu → 🗂️ Open the Staff Console: opens in ~1s with **Quick Mark already drawn** — no "Opening Quick Mark…" step. The Apps Script executions list should show ONE execution for the open, not two.
1a. Within a few seconds of opening, one `staffConsolePanels` execution runs by itself; after it, People → Volunteer hours / Private session and Programs → Close Sessions each open with no pause at all.
1b. On a workbook with big Quick Mark lists, the log says the page is over the ceiling and its smaller page went instead — the console still paints at once and the lists arrive a moment later.
2. Desk → Quick Mark: lists appear; mark someone Attended — shown done at once; row updated on the sheet; `Admin_Notes`/ledger name YOUR account, not the owner.
3. During a running sync: mark → "⏳ goes on the sheet when the sync finishes"; lands after.
4. Quick Mark → Change this registration → cancel a test row; check the four cells.
5. Quick Mark's "Log volunteer hours" link opens the People/Volunteer panel inside the console (not a new dialog).
6. Switch tabs mid-typing and back: text still there.
7. People → Add in Bulk: paste 3 names, review, run; close the console mid-run; reopen; progress resumes from `bulkRegistrantsStatus`.
8. People → .xlsx upload works.
9. People → Volunteer hours and Private session: log one each; rows appear.
10. Programs → Close Sessions: tick a date, Apply; calendar event gets `[Waitlist Only]`.
11. With a bootstrap running: Close Sessions panel shows the busy sentence instead of opening.
12. A member named O'Brien / a program titled `</script>` renders as text everywhere.
13. Old menu items (Quick Mark, etc.) still open their modals unchanged.
14. Mark somebody and immediately switch to the People tab: the prefetch does not delay the mark, and the panel is there when you arrive.
15. ↻ Reload on a panel that opened instantly: it fetches live (watch the executions list) and shows fresh data.
16. Leave the console open 15 minutes, then open Volunteer hours: it is re-fetched (its recent-visits list is current), while Add in Bulk still opens instantly.

## Follow-ups (not in this pass)
Remaining dialogs to move, roughly by use: Member Roll import (`79`),
Duplicate registrations (`85`), Program review (`58`), Appointment review
(`59`), Question builder (`53`/`55`), Move Sessions (`47`), Delete
registrations (`48`), Restore from copy / ledger (`99p`/`99v`), Form & Link
Doctor (`51`), Unopenable forms (`99s`), Forked forms (`32`), Weekend loader
(`80`), Lunch menu paste (`11`), Sign-in sheet (`45`), Leader sheet (`46`),
Door pages (`61`), Time blocks (`56`), Reimport form (`99`). Each is: one
`STAFF_CONSOLE_PANELS` entry naming its builder and gate, plus its show
function in `STAFF_CONSOLE_SHOW_INTERCEPTS`. After that: drop the per-page CSS
in favour of the console's, and retire the bridge for pages rewritten as
native panels.
