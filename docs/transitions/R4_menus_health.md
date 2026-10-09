# R4 — Role-shaped menus and the Health panel: transition plan

Item #4 of `docs/RESTRUCTURING_PROPOSALS.md`. Written before the code, kept in
step with it. The rule this whole change is held to: **nothing becomes
unreachable.** Every action that was on the menu is still on a menu, or in the
Health panel, for somebody whose role should see it — and
`tests/menu_usage.test.js` fails if that stops being true.

## What changes, in one paragraph

The single `🗓️ Calendar & Form Manager` menu (99 items) becomes three
top-level menus: **🛎️ Desk** (the serving day — eight items), **📋 Coordinator**
(Lunch, Rosters & Sharing, Programs & Forms, Sign-In & Door, Settings & Fixes,
plus the Health panel), and **🔧 Admin** (the old Admin submenu, promoted to a
menu of its own and built only for admins — or when the viewer cannot be
identified). The fifteen read-only reports, Trigger Status and "Why did nothing
happen?" become sections of a **🩺 Health panel** sidebar, each run on demand.
The separate **📱 Sign-In App** menu (`99zc`) is unchanged. No action function
was deleted or renamed.

## The role table

One declarative table, `MENU_ROLE_TABLE` in `99zma_menu_roles.gs`:

| Menu | admin | staff (identified, not admin) | unknown (blank account) |
|---|:-:|:-:|:-:|
| 🛎️ Desk | ✅ | ✅ | ✅ |
| 📋 Coordinator | ✅ | ✅ | ✅ |
| 🔧 Admin | ✅ | — (gets "🔧 Admin Tools (sign-in check)…" instead) | ✅ |

There is no third, desk-only role: nothing in the workbook lists which accounts
are "desk only", and everything on Coordinator was already open to anyone who
can open the workbook. A desk-only role is one more column in that table and a
list to read it from, if the office ever wants one.

### How "admin" is decided

`resolveMenuRole()` (`99zma`):

1. The viewer's address: `Session.getActiveUser().getEmail()`, falling back to
   `getCurrentUserEmail()` (`01`, `Session.getEffectiveUser()`). Either call
   throwing counts as blank.
2. **Blank → `unknown` → the full menu, Admin included.** A simple `onOpen`
   trigger frequently cannot see the account (consumer Gmail, a viewer from
   another domain). Hiding the repair tools from the one person who can run
   them — which is how a genuine admin once ended up with no Admin menu — is
   the failure this must never reproduce. Showing them costs nothing: a hidden
   menu was never a permission (see `16`'s banner), and every irreversible item
   still asks `requireAuthorizedAdmin()` itself.
3. Admin = `listAuthorizedAdminEmails()` (`01`: `AUTHORIZED_ADMIN_EMAILS` plus
   the spreadsheet's owner) **∪** every address on Config's Admin Notification
   Emails table (`getAllAdminNotificationEmails()`, `15`). The Config half is
   what lets the office change who SEES Admin without editing source. It does
   not widen who may RUN a gated action: `ADMIN_GATED_ACTIONS` and
   `requireAuthorizedAdmin()` are untouched, so a Config-listed address that is
   not in `listAuthorizedAdminEmails()` sees Admin and is still refused by the
   destructive items, exactly as everybody was before this change.
4. Reading Config throwing (a tab mid-rebuild) counts as "not on Config", and
   any other failure in the resolution counts as `unknown`. Never as `staff`.

### What a non-admin sees

Desk, Coordinator, and at the foot of Coordinator **🔧 Admin Tools (sign-in
check)…** (`showAdminMenu`). Clicking it re-runs the resolution with full
authorization (a menu click always can see the account): an admin gets the
Admin menu added in place; anybody else gets an alert naming the admin
accounts and saying that the Health panel holds the reports and the Form &
Link Doctor. The ungated repairs a desk most needs — the **Form & Link
Doctor**, **Review Unopenable Forms** and **Clear a Stuck Background Job** —
are on the Health panel's Tools list, so an identified non-admin can still
reach them.

What an identified non-admin can no longer reach from a menu (they still can
from the Apps Script editor, and an admin can from Admin): the rest of the old
Admin submenu — Rebuild Layout, Rewrite Event Links, Open Up sharing, Read an
Event's Tags, Load Weekend Events, Repair Dashboard Links (also inside the
Doctor), Sessions Split Across Two Forms, Fix Forms In Place, Re-import a
Form's Responses, One-Time Jobs, Appearance, Triggers, Reports' two writers and
Destructive. That is the point of the item.

## Every menu item → its new home

Generated from `collectMenuItemLabels_()` against the menu as it stood on the
base branch (99 items, plus the non-admin escape hatch).

| Action | Was | Now |
|---|---|---|
| `showQuickMarkDialog` | ⚡ Quick Mark Attendance / Lunch… | Desk |
| `showBulkRegistrantsDialog` | 📋 Add Registrants in Bulk (paste or CSV)… | Desk |
| `showVolunteerHoursDialog` | 🤝 Log Volunteer Hours… | Desk |
| `showPrivateSessionDialog` | 🔒 Log a Private Session… | Desk |
| `showQuestionBuilderDialog` | ➕ Build a Form Question… | Coordinator ▸ 📝 Programs & Forms (first item) |
| `syncEverythingNow` | 🔄 Update Everything Now | Desk |
| `reportWhyNothingHappened` | ❓ Why did nothing happen? | Desk (also a Health panel section) |
| `showLunchMenuImportDialog` | 🍱 Lunch ▸ Add Menu Items (paste/upload CSV)… | Coordinator ▸ 🍱 Lunch |
| `pushLunchMenuToForms` | 🍱 Lunch ▸ Push Menu Changes to Forms | Coordinator ▸ 🍱 Lunch |
| `refreshLunchSignUpForms` | 🍱 Lunch ▸ Build / Refresh Lunch Sign-Up Forms | Coordinator ▸ 🍱 Lunch |
| `openRegularNeedsTab` | 👩‍🏫 Rosters & Sharing ▸ 🔔 Regular Needs (standing notes)… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showMemberRollImportDialog` | 👩‍🏫 Rosters & Sharing ▸ 👥 Add Members to the Roll (paste/upload)… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `dedupeMemberRollNow` | 👩‍🏫 Rosters & Sharing ▸ Merge Duplicate Members Now | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showDuplicateRegistrationsDialog` | 👩‍🏫 Rosters & Sharing ▸ 🔎 Review Duplicate Registrations… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showRegistrationReviewDialog` | 👩‍🏫 Rosters & Sharing ▸ 📝 Review & Edit Registrations… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `openVolunteerHoursTab` | 👩‍🏫 Rosters & Sharing ▸ 🤝 Open the Volunteer Hours Tab | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `openPrivateSessionsTab` | 👩‍🏫 Rosters & Sharing ▸ 🔒 Open the Private Sessions Tab | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `removeMarkedRegistrants` | 👩‍🏫 Rosters & Sharing ▸ 🗑️ Remove Marked Registrants… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showRestoreRegistrantsFromCopyDialog` | 👩‍🏫 Rosters & Sharing ▸ ♻️ Restore Registrants from a Copy… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showRestoreRegistrantsFromLedgerDialog` | 👩‍🏫 Rosters & Sharing ▸ 📒 Restore Registrants from the Ledger… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showProgramLeaderSheetDialog` | 👩‍🏫 Rosters & Sharing ▸ Share a Program Registrant Sheet… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `refreshProgramLeaderSheetsNow` | 👩‍🏫 Rosters & Sharing ▸ Refresh Program Registrant Sheets Now | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `sendProgramLeaderRosterAlertsNow` | 👩‍🏫 Rosters & Sharing ▸ Send Roster Change Alerts Now | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `sendProgramLeaderDayDigestsNow` | 👩‍🏫 Rosters & Sharing ▸ Send Roster Digests Now | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showAssistanceScheduleDialog` | 👩‍🏫 Rosters & Sharing ▸ Personalized Assistance Schedule… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showCalendarInviteDialog` | 👩‍🏫 Rosters & Sharing ▸ Invite Registrants to Calendar Events… | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `sendRegistrantRemindersNow` | 👩‍🏫 Rosters & Sharing ▸ Send Registrant Reminders Now | Coordinator ▸ 👩‍🏫 Rosters & Sharing |
| `showProgramReviewDialog` | 📝 Programs & Forms ▸ 🔍 Review Programs, Then Update Once… | Coordinator ▸ 📝 Programs & Forms |
| `pushProgramQuestionsToForms` | 📝 Programs & Forms ▸ Update Program Questions on Forms | Coordinator ▸ 📝 Programs & Forms |
| `showFixOneFormDialog` | 📝 Programs & Forms ▸ 🩹 Update One Form (keeps its link)… | Coordinator ▸ 📝 Programs & Forms |
| `applyProgramTagChangesToCalendar` | 📝 Programs & Forms ▸ Push Dashboard Ticks to the Calendar | Coordinator ▸ 📝 Programs & Forms |
| `showBulkWaitlistOnlyDialog` | 📝 Programs & Forms ▸ 🔴 Close Sessions to New Registrations… | Coordinator ▸ 📝 Programs & Forms |
| `showAssistanceReviewDialog` | 📝 Programs & Forms ▸ 🗓️ Appointments ▸ Review Appointment Months… | Coordinator ▸ 📝 Programs & Forms ▸ 🗓️ Appointments |
| `showTimeBlockDialog` | 📝 Programs & Forms ▸ 🗓️ Appointments ▸ ⏱️ Merge Half-Hour Blocks… | Coordinator ▸ 📝 Programs & Forms ▸ 🗓️ Appointments |
| `rebuildAssistanceFormsNow` | 📝 Programs & Forms ▸ 🗓️ Appointments ▸ Rebuild Appointment Forms + Report… | Coordinator ▸ 📝 Programs & Forms ▸ 🗓️ Appointments |
| `linkProgramAcrossLocations` | 📝 Programs & Forms ▸ 🔀 Move & Merge ▸ Link Program Across Locations… | Coordinator ▸ 📝 Programs & Forms ▸ 🔀 Move & Merge |
| `showRepointSessionsDialog` | 📝 Programs & Forms ▸ 🔀 Move & Merge ▸ Move Sessions to Another Form… | Coordinator ▸ 📝 Programs & Forms ▸ 🔀 Move & Merge |
| `showSignInSheetDialog` | 🚪 Sign-In & Door ▸ 📋 Sign-In Sheet (live Doc)… | Desk |
| `showCheckInPageDialog` | 🚪 Sign-In & Door ▸ 📱 Door Pages (links & PIN)… | Coordinator ▸ 🚪 Sign-In & Door |
| `refreshMyPermissions` | ⚙️ Settings & Fixes ▸ 🔑 Refresh My Permissions | Coordinator ▸ ⚙️ Settings & Fixes |
| `syncCalendars` | ⚙️ Settings & Fixes ▸ Sync Cal only | Coordinator ▸ ⚙️ Settings & Fixes |
| `syncRegistrations` | ⚙️ Settings & Fixes ▸ Sync Registrations only | Coordinator ▸ ⚙️ Settings & Fixes |
| `rebuildQuickMarkListsNow` | ⚙️ Settings & Fixes ▸ Rebuild Quick Mark Lists | Coordinator ▸ ⚙️ Settings & Fixes |
| `renderProgramMonthSheetNow` | ⚙️ Settings & Fixes ▸ Rebuild the Program Month View | Coordinator ▸ ⚙️ Settings & Fixes |
| `flushCheckInQueueNow` | ⚙️ Settings & Fixes ▸ Write Queued Check-Ins Now | Coordinator ▸ 🚪 Sign-In & Door |
| `refreshMetricsTabNow` | ⚙️ Settings & Fixes ▸ 📈 Update Metrics Now | Coordinator ▸ ⚙️ Settings & Fixes |
| `snapshotRegistrantsNow` | ⚙️ Settings & Fixes ▸ 💾 Save a Copy of the Registrants Tab | Coordinator ▸ ⚙️ Settings & Fixes |
| `showAllPastRows` | ⚙️ Settings & Fixes ▸ Show All Past Rows | Coordinator ▸ ⚙️ Settings & Fixes |
| `resizeAllSheets` | ⚙️ Settings & Fixes ▸ Resize All Sheets | Coordinator ▸ ⚙️ Settings & Fixes |
| `rebuildLayoutFromSheet` | 🔧 Admin ▸ 🧱 Rebuild Layout (no calendar sync) | Admin (unchanged) |
| `rewriteEventRegistrationLinks` | 🔧 Admin ▸ 🔗 Rewrite Event Links (fix duplicates) | Admin (unchanged) |
| `openUpAllFormSharing` | 🔧 Admin ▸ 🔓 Open Up Form Sharing | Admin (unchanged) |
| `openUpAllGeneratedFileSharing` | 🔧 Admin ▸ 🔓 Open Up ALL File Sharing | Admin (unchanged) |
| `showEventTagInspectorDialog` | 🔧 Admin ▸ 🏷️ Read an Event's Tags… | Admin (unchanged) |
| `showWeekendEventLoaderDialog` | 🔧 Admin ▸ 🗓️ Load Weekend Events… | Admin (unchanged) |
| `showFormLinkDoctorDialog` | 🔧 Admin ▸ 🩺 Form & Link Doctor… | Admin (unchanged) + Health panel ▸ Tools |
| `showUnopenableFormsDialog` | 🔧 Admin ▸ 🪦 Review Unopenable Forms… | Admin (unchanged) + Health panel ▸ Tools |
| `repairDashboardLinks` | 🔧 Admin ▸ 🔗 Repair Dashboard Links (no calendar read) | Admin (unchanged) |
| `showForkedFormsDialog` | 🔧 Admin ▸ 🔀 Sessions Split Across Two Forms… | Admin (unchanged) |
| `repairFormRoutingNow` | 🔧 Admin ▸ 🧭 Fix Forms In Place (no rebuild) | Admin (unchanged) |
| `showReimportFormDialog` | 🔧 Admin ▸ ♻️ Re-import a Form's Responses… | Admin (unchanged) |
| `backfillSignInSheetRegistry` | 🔧 Admin ▸ 🧰 One-Time Jobs ▸ 🖨️ Rebuild Sign-In Sheet Links | Admin ▸ 🧰 One-Time Jobs (unchanged) |
| `organizeGeneratedFiles` | 🔧 Admin ▸ 🧰 One-Time Jobs ▸ 🗂️ Organize Generated Files | Admin ▸ 🧰 One-Time Jobs (unchanged) |
| `removeAdminGuestsFromCalendarEvents` | 🔧 Admin ▸ 🧰 One-Time Jobs ▸ 👥 Remove Office Guests from Calendar Events | Admin ▸ 🧰 One-Time Jobs (unchanged) |
| `backfillLedgerFromTab` | 🔧 Admin ▸ 🧰 One-Time Jobs ▸ 📒 Back-fill the Registration Ledger | Admin ▸ 🧰 One-Time Jobs (unchanged) |
| `bootstrapCalendars` | 🔧 Admin ▸ 🧰 One-Time Jobs ▸ 🏁 Import Everything (First Run) | Admin ▸ 🧰 One-Time Jobs (unchanged) |
| `showColumnWidthDialog` | 🔧 Admin ▸ 🎨 Appearance ▸ 📏 Column Widths… | Admin ▸ 🎨 Appearance (unchanged) |
| `saveCurrentTabOrder` | 🔧 Admin ▸ 🎨 Appearance ▸ 🗂️ Save This Tab Order | Admin ▸ 🎨 Appearance (unchanged) |
| `clearSavedTabOrder` | 🔧 Admin ▸ 🎨 Appearance ▸ Reset to the Built-In Tab Order | Admin ▸ 🎨 Appearance (unchanged) |
| `showTriggerStatus` | 🔧 Admin ▸ ⏰ Triggers ▸ Trigger Status | Health panel ▸ Trigger Status |
| `writeTriggers` | 🔧 Admin ▸ ⏰ Triggers ▸ Check Triggers | Admin ▸ ⏰ Triggers (unchanged) |
| `clearStuckBackgroundJobs` | 🔧 Admin ▸ ⏰ Triggers ▸ 🧹 Clear a Stuck Background Job | Admin ▸ ⏰ Triggers (unchanged) + Health panel ▸ Tools |
| `takeOverTriggerOwnership` | 🔧 Admin ▸ ⏰ Triggers ▸ Take Over Trigger Ownership | Admin ▸ ⏰ Triggers (unchanged) |
| `releaseMyTriggers` | 🔧 Admin ▸ ⏰ Triggers ▸ Release My Triggers | Admin ▸ ⏰ Triggers (unchanged) |
| `previewLegacyTabMerge` | 🔧 Admin ▸ 📄 Reports ▸ Find Leftover Tabs (read-only report) | Health panel ▸ section |
| `reportLeaderSheetRosters` | 🔧 Admin ▸ 📄 Reports ▸ 🔎 Why is a roster sheet empty? (read-only) | Health panel ▸ section |
| `showLedgerVerificationReport` | 🔧 Admin ▸ 📄 Reports ▸ 📒 Check the Registration Ledger (read-only) | Health panel ▸ section |
| `reportLedgerGrowth` | 🔧 Admin ▸ 📄 Reports ▸ 📈 Is the Ledger Still Growing? (read-only) | Health panel ▸ section |
| `reportOrphanedSessionRows` | 🔧 Admin ▸ 📄 Reports ▸ Find Leftover Calendar Rows (read-only report) | Health panel ▸ section |
| `reportDuplicateSessionRows` | 🔧 Admin ▸ 📄 Reports ▸ Find Duplicate Session Rows (read-only report) | Health panel ▸ section |
| `reportArchivableMonths` | 🔧 Admin ▸ 📄 Reports ▸ Archive Old Months (report) | Health panel ▸ section |
| `reportUnimportedForms` | 🔧 Admin ▸ 📄 Reports ▸ Find Forms Nothing Is Importing (read-only report) | Health panel ▸ section |
| `reportMissingRegistrations` | 🔧 Admin ▸ 📄 Reports ▸ Find Missing Registrations (read-only report) | Health panel ▸ section |
| `reportOrphanedProgramQuestions` | 🔧 Admin ▸ 📄 Reports ▸ Find Questions Aimed At Nothing (read-only report) | Health panel ▸ section |
| `reportVolunteerHours` | 🔧 Admin ▸ 📄 Reports ▸ 🤝 Volunteer Hours (read-only report) | Health panel ▸ section |
| `reportPrivateSessions` | 🔧 Admin ▸ 📄 Reports ▸ 🔒 Private Sessions (read-only report) | Health panel ▸ section |
| `sendOfficeDigestNow` | 🔧 Admin ▸ 📄 Reports ▸ 📨 Send the Office Digest Now | Admin ▸ 📄 Reports (it SENDS mail, so it is not a Health check) |
| `reportScriptPropertiesUsage` | 🔧 Admin ▸ 📄 Reports ▸ 🗄️ What is filling Script Properties? (read-only) | Health panel ▸ section |
| `showMenuUsageReport` | 🔧 Admin ▸ 📄 Reports ▸ 📊 Menu Usage (read-only report) | Health panel ▸ section |
| `resetMenuUsage` | 🔧 Admin ▸ 📄 Reports ▸ Reset Menu Usage Counts… | Admin ▸ 📄 Reports (it WRITES, so it is not a Health check) |
| `rebuildAllFormsInPlace` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 🩹 Rebuild Forms In Place (keeps links)… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `destroyAndRebuildAllForms` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 💣 Destroy & Rebuild Forms… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `showDeleteRegistrationsDialog` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 🗑️ Delete Registrations… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `removeOrphanedSessionRows` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 🧹 Remove Leftover Calendar Rows… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `removeDuplicateSessionRows` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 🧹 Remove Duplicate Session Rows… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `compactRegistrationLedger` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 🧹 Compact the Registration Ledger… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `removeAllCalendarInvitesFromEvents` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ 📅 Remove ALL Calendar Invitations… | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `resetRemoveAllCalendarInvitesSweep` | 🔧 Admin ▸ ⚠️ Destructive — read the prompt ▸ ↩️ Start the Invitation Removal Over | Admin ▸ ⚠️ Destructive — read the prompt (unchanged) |
| `openSignInApp` | 📱 Sign-In App ▸ 🚪 Open the Sign-In App | Desk (and still its own 📱 Sign-In App menu) |
| `showAdminMenu` | (non-admins only) 🔧 Admin Tools (sign-in check)… | Coordinator, last item — shown only to a viewer resolved as NOT an admin |
| `showHealthPanel` | — (new) | Coordinator ▸ 🩺 Health Panel… (everyone) |

**Count:** 8 on Desk, 42 under Coordinator (plus the new Health Panel item),
34 still on Admin (One-Time Jobs, Appearance, Triggers, Destructive and the
repairs, unchanged), and 15 read-only checks moved off the menu into the Health
panel — 99 in all. "Why did nothing happen?" is on Desk AND in the panel; the
Form & Link Doctor, Review Unopenable Forms and Clear a Stuck Background Job
are on Admin AND in the panel's Tools. The Health Panel item itself is on
Coordinator and under Admin ▸ 📄 Reports (where the reports used to be) — the
one item deliberately on two menus.

## The Health panel

`showHealthPanel()` (`99zm_health_panel.gs`), on **Coordinator ▸ 🩺 Health
Panel…** for everyone, and the top-level function the R6 staff console calls if
it is defined. A sidebar listing every check with a **Run** button; **nothing
runs on open** (several of these read every form or every row, and Apps Script
stops an execution at its ceiling with no warning — the same reason `51` opens
before it checks anything). Each Run is one `google.script.run` call to
`runHealthCheck(id)`, which:

- runs the report's EXISTING menu function inside a capture scope, so the text
  that function would have put in an alert comes back to the panel instead —
  one code path, two presentations; no report computes its answer twice;
- records the press in `MENU_USAGE_V1` under the same action name the menu
  item used, so usage history carries straight on;
- never throws: a report that fails comes back as "could not run: …".

Reports that only `ui.alert`-ed their text now go through `presentReport_()`
(`99zm`), which alerts as before when called from a menu or the editor and
records the text when a capture scope is open. `toastIfPossible()` (`25`)
records into the same scope, so a report that answers with a toast ("No
session table yet") still says something in the panel.

Everything from the workbook is written into the panel with `textContent`; the
check list crosses into the page's script through `JSON.stringify` with `<`
escaped. `tests/health_panel.test.js` pins both.

## MENU_USAGE_V1 history

Kept. Its keys are action names, and no action was renamed. Labels in the
usage report now carry the menu they live on (`🛎️ Desk ▸ Quick Mark…`), and the
Health panel's checks are listed as `🩺 Health ▸ <section>` so a report that
moved off the menu is still named and still counted.

## How to read the usage numbers (do this before retiring anything)

1. Open the workbook. **📋 Coordinator ▸ 🩺 Health Panel…**
2. Find **📊 Menu Usage** and press **Run**. (From the editor instead: run
   `showMenuUsageReport`, and read the alert or the execution log.)
3. The first line says when counting began. Most-pressed are listed first; the
   section **Never pressed** is the candidate list.
4. Treat an item as retire-able when it shows **0 presses over at least 90
   days of counting** (or a last-used date more than 90 days ago) AND it is not
   on the "never retire" list below.
5. To start a fresh window after a reorganization: **🔧 Admin ▸ 📄 Reports ▸
   Reset Menu Usage Counts…** — but only after you have copied the report.

### Proposed for retirement, pending those numbers

"Retire" means move into **Admin ▸ 🧰 One-Time Jobs** or a Health panel Tools
entry — never delete the function.

| Item | Why it is a candidate |
|---|---|
| Programs & Forms ▸ Push Dashboard Ticks to the Calendar | The installable edit trigger delivers ticks within seconds. |
| Settings & Fixes ▸ Sync Cal only / Sync Registrations only | Diagnostic halves of Update Everything Now. |
| Settings & Fixes ▸ Rebuild Quick Mark Lists | The five-minute warm-up (`38`) rebuilds them. |
| Settings & Fixes ▸ Rebuild the Program Month View | Redrawn by every sync. |
| Sign-In & Door ▸ Write Queued Check-Ins Now | The five-minute flush and the post-sync flush (`99w`) write them. |
| Settings & Fixes ▸ Show All Past Rows / Resize All Sheets | Cosmetic; collapse again on the next sync. |
| Rosters & Sharing ▸ Send Roster Change Alerts Now / Send Roster Digests Now / Send Registrant Reminders Now | The sync sends all three. |
| Rosters & Sharing ▸ Merge Duplicate Members Now | Runs on every roll write (`79`). |
| Admin ▸ Rewrite Event Links (fix duplicates) | Superseded by the description writer (`26`). |
| Admin ▸ Read an Event's Tags… / Load Weekend Events… | Rare, one-off. |
| Admin ▸ Fix Forms In Place (no rebuild) | The hourly migration sweep (`68`) does this. |
| Admin ▸ Destructive ▸ Start the Invitation Removal Over | Only meaningful mid-sweep. |
| Admin ▸ Appearance ▸ Reset to the Built-In Tab Order | Rare. |

**Never retire**, whatever the count says: Quick Mark, Update Everything Now,
Why did nothing happen?, Refresh My Permissions, Clear a Stuck Background Job,
Check Triggers / Take Over Trigger Ownership, the Restore items, and every
Destructive item — these are pressed rarely BECAUSE they are for the bad day.

## Rollback

The whole change is `16` (the menu tree), `99r` (wrappers + labels), two new
files (`99zm`, `99zma`), and a mechanical `presentReport_()` substitution in the
reports. To roll back: revert the commit. No Script Property, sheet, trigger or
stored shape changed, so there is nothing to migrate back; `MENU_USAGE_V1`
counts recorded meanwhile stay valid (same keys). For a faster partial
rollback that keeps the panel: in `MENU_ROLE_TABLE`, add `'staff'` to the Admin
row — every viewer then gets the full menu again.

## Manual test checklist

- [ ] Open the workbook as the OWNER: three menus (Desk, Coordinator, Admin) +
      📱 Sign-In App. No "Admin Tools (sign-in check)" item.
- [ ] Open as an editor NOT on `AUTHORIZED_ADMIN_EMAILS` or Config's admin
      table: Desk + Coordinator only, "🔧 Admin Tools (sign-in check)…" at the
      foot of Coordinator; clicking it explains and adds nothing.
- [ ] Add that editor to Config's Admin Notification Emails, reload: Admin
      appears. Press Admin ▸ Destructive ▸ Delete Registrations…: still refused
      unless also in `listAuthorizedAdminEmails()`.
- [ ] Open from a consumer Gmail account (or any account `onOpen` cannot see):
      Admin is present.
- [ ] Coordinator ▸ 🩺 Health Panel…: the sidebar opens instantly, nothing runs.
- [ ] Run "Why did nothing happen?", "Trigger Status", "What is filling Script
      Properties?", "Menu Usage": each shows its text in the panel, no alert.
- [ ] Run "Find Missing Registrations" (slow): the button shows Running…,
      the text arrives, the panel stays usable.
- [ ] Health ▸ Tools ▸ Form & Link Doctor: the Doctor dialog opens over the
      sheet.
- [ ] Old menu path still works where kept: Admin ▸ 📄 Reports ▸ Send the Office
      Digest Now.
- [ ] Health ▸ Menu Usage after a few presses: the panel presses are counted
      under the same names as the old menu items.
