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
and the data its builder inlines — is fetched by `google.script.run
.staffConsolePanel(id)` the first time its tab/button is opened, not shipped in
the console's first paint.

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
moving between tabs. "↻ Reload" on a panel re-fetches it fresh.

## Dialogs moved in this pass

All server functions below are **unchanged**; the console calls the same
builder the menu item calls, behind the same gate.

### Quick Mark + Change this registration (`36` / `38` / `99a`) — Desk tab
- **Server:** `buildQuickMarkHtml(readyQuickMarkIndex())`, gate `isDeskWorkBlocked()` → `deskBusyMessage()` shown in the panel. Page calls `getQuickMarkIndex`, `refreshQuickMarkIndex`, `applyQuickMarkFromDialog`, `applyQuickMarkForHousehold`, `applyRegistrantChangeFromDialog`, `addProgramWaitlistEntryFromDialog`, the regular-needs and any-date-list readers — all through the bridge, unchanged.
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
- **Server:** `buildBulkRegistrantsHtml()` (inlines nothing already). Page calls `listBulkRegistrantPrograms`, `readBulkRegistrantColumns`, `readBulkRegistrantXlsx`, `startBulkRegistrants`, **`bulkRegistrantsStatus` polled every 4s**, `stopBulkRegistrants`, `continueBulkRegistrants`, `dismissBulkRegistrantsResult`.
- **Sliced job:** untouched. The job still runs on `runSlicedJob` triggers whether or not anything is watching; the poll is the page's own `setInterval`, which keeps running while the tab is hidden (as it did while the modal was open) and stops when the console closes. Reopening the panel shows the job's state from `bulkRegistrantsStatus` exactly as reopening the modal did.
- **File input:** FileReader runs in the iframe; the base64 string crosses `postMessage` unchanged.

### Close Sessions to New Registrations (`99m`) — Programs tab
- **Server:** gate `isBootstrapActive()` → `bootstrapBusyMessage()`; no upcoming programs → the same sentence the menu item alerts; else `buildBulkWaitlistOnlyHtml(listWaitlistProgramSessions())`. Apply calls the same server function.
- Refusals are shown IN the panel rather than as an alert (the console is already in front of the person; an alert from a modeless dialog's fetch would stack on top of it).

## Health and Settings
- **Health:** if `typeof showHealthPanel === 'function'` on the server (R4), the tab offers it (`staffConsoleHealthAvailable()`); since it is not yet known whether R4's panel is a dialog or a builder, a builder `buildHealthPanelHtml()` is embedded when it exists, and otherwise a button calls `showHealthPanel()` and says that it opens in place of the console. Neither present → a placeholder.
- **Settings:** "Open the Config tab" and a list of what will move here.

## Rollback
The console is additive: it adds one file, one menu line, one `menu_` wrapper
and one CLAUDE.md section. Every old menu item and dialog is untouched and
still the primary path. Rollback = delete the menu line (or the whole file and
its wrapper). No stored state, no Script Properties, no triggers.

## Manual test checklist (live workbook)
1. Menu → 🗂️ Open the Staff Console: opens in ~1s, Desk tab shows a launcher.
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
