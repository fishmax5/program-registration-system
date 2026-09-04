# CLAUDE.md — working in this repo

A Google Apps Script project bound to one Google Sheet. It reads Google
Calendars, generates and maintains a Google Form per program group, imports
responses into the workbook, orders lunch from them, and serves two web pages
to a tablet at the door. There is no framework, no build step, and no
`node_modules`: the deliverable is the `.gs` source itself.

## The one thing to know before editing

**Every `.gs` file at the root is ONE Apps Script project sharing ONE global
scope.** The numeric prefixes ask the project to evaluate them in filename
order, and `tests/helpers/source.js` reproduces that order — but nothing
*enforces* it. Apps Script evaluates files in whatever order the project has
them stored, and a GitHub-sync browser extension that writes files back
most-recently-edited-first will happily evaluate `03_sheets_and_headers`
before `02_palette_and_tags`.

That used to be fatal, and was: a top-level `const` computed from another
file's constant threw `ReferenceError: PALETTE is not defined` on open, for
every user, with a dialog nobody could dismiss their way out of. There were 34
such cross-file reads across 15 constants.

**That is fixed, and the fix is the rule to follow.** Any constant whose
initializer mentions a constant from a *different file* is declared through
`defineLazyGlobal_` (see `01a_lazy_globals.gs`) instead of `const`: the name
binds at load, the value is computed on first read — by which point every file
has evaluated, whatever order they came in.

- **Load order no longer matters.** Renumbering a file, or moving a top-level
  `const` to a later-sorting file, is safe. Keep the prefixes anyway: they are
  how a reader finds things, and how the tables below are organized.
- A constant whose initializer is self-contained (`PALETTE`, `SHEET_NAMES`,
  `EVENT_TYPES`) stays an ordinary `const`. Nothing it needs can be missing.
- **A top-level statement that *reads* a lazy global is the same hazard
  wearing a different hat.** `PROGRAM_FORM_TYPES.forEach(...)` at file scope
  forces the getter at load time; fold that work into the factory instead.
- `tests/load_order.test.js` is what holds the line. It loads the whole project
  in reverse filename order and in 60 shuffles, and checks every derived global
  reads back identically. A failure there is not a broken test — it is a new
  eager cross-file read. Wrap it in `defineLazyGlobal_`.
- Function *declarations* are hoisted across the whole project, so a function
  may freely call one defined in any other file — `defineLazyGlobal_` included.

## Where things are

Line counts are a rough guide to what you are about to load.

### Configuration and shared vocabulary (00–11)

| File | | What is in it |
|---|--:|---|
| `00_overview.gs` | 539 | Nothing but the project's header comment: every tab, the sync flow, the first-run path. **Read this first** — it is the cheapest orientation in the repo. |
| `01_logging_and_access.gs` | 211 | `log()`, the admin-only gate for destructive actions, and the "are you sure?" prompts. |
| `01a_lazy_globals.gs` | 63 | `defineLazyGlobal_` — the one helper that makes file load order stop mattering. Read the banner before adding a constant derived from another file's. |
| `02_palette_and_tags.gs` | 972 | `PALETTE` and every color derived from it; `EVENT_TYPES`; the bracket tags (`Shared`, `Club`, `No Registration`, `Personalized Assistance`) and the regexes that recognize them in a calendar title. Plus the one tag that describes a DATE rather than a program — `Waitlist Only`, which closes a single session to new Active registrations whatever its capacity says — and the two lists that keep the difference straight: `PROGRAM_FLAG_COLUMNS` (ticked onto every row of a program) and `SESSION_FLAG_COLUMNS` (ticked onto the row you clicked, and nowhere else). |
| `03_sheets_and_headers.gs` | 770 | `SHEET_NAMES`, `HEADERS` (the column list for every tab), legacy renames and header aliases, per-tab staff-owned column lists. **The schema.**Member_Roll's household and name columns are described here; what they MEAN is `77`. Note the one place a tab's name and its schema key deliberately disagree: the session tab is `Program_Sessions` (renamed from `Master_Program_Dashboard` in September 2026, carried across in place by `LEGACY_SHEET_RENAMES`) but its header list is still keyed `HEADERS.Master_Program_Dashboard` — a schema key is read by code, a tab name by people. Same reasoning as `LEADER_SHEET_REGISTRY_PROP_KEY` still being spelled `INSTRUCTOR_SHEET_REGISTRY_V1`. |
| `04_settings_and_config.gs` | 504 | `CONFIG_LAYOUT` and the settings on the Config tab — meal buffers, order-ahead days, catering policy, link display, calendar invites, automation on/off, and the Admin Notification Emails table (`ADMIN_NOTIFICATION_CATEGORIES`: who in the office is copied on which outbound mail, replacing the retired single Admin Notification / Archive Copy cells) — plus locations, addresses, and the forms Drive folder. |
| `05_form_template.gs` | 1173 | `TEMPLATE_VERSION` and the shape of the generated Google Form: item titles, page titles, the roster grid, attendance-mode choices, guests, the meal totals, and the page navigation helpers every form-shaping path writes through (`setNavigationAfterPage`). **Bump `TEMPLATE_VERSION` when the form's structure changes — page navigation counts.** |
| `06_registries_and_locks.gs` | 152 | The groupKey→Form_ID registry in Script Properties, the all-dates registry, template-version tracking, and the script locks. |
| `07_dates_and_labels.gs` | 624 | `TIMEZONE`, date formatting, and the capacity/meal hints a form's date label carries. |
| `08_execution_caches.gs` | 491 | The per-execution memo caches the sync hot paths use, and their invalidation — including `openFormCached()`, the one `FormApp.openById()` per form per run. |
| `09_lunch_schedule_lookup.gs` | 403 | Reading `Lunch_Schedule` by date × location. |
| `10_form_date_labels.gs` | 749 | Fingerprinted writes of date labels onto a live form (`applyFormDateLabels`). |
| `11_menu_items_paste.gs` | 1107 | Adding menu items to `Lunch_Schedule` — paste CSV, in the sheet or a dialog. |

### Building the workbook (12–15)

| File | | What is in it |
|---|--:|---|
| `12_sheet_setup.gs` | 213 | `initSheet` and the `Lunch_Schedule` tab's own setup. |
| `13_lunch_only_signup_form.gs` | 1032 | The lunch-only sign-up form — the one form built from `Lunch_Schedule` rather than the calendar. Also the shared sheet-shaping helpers it grew around: `autosizeColumns`, and `ensureSheetColumns` (a layout that outgrows a tab's column count is a throw, not a resize). |
| `14_saved_column_widths.gs` | 463 | "This column should be this wide, always." |
| `15_config_sheet.gs` | 1203 | Drawing and validating the Config tab, reading its settings back (`getAdminNotificationRows` / `adminEmailsForCategory` among them), and `notifyAdmin`. |

### Menus, triggers, and edits (16–18)

| File | | What is in it |
|---|--:|---|
| `16_menu_and_triggers.gs` | 597 | `onOpen`, the menu tree, trigger installation. |
| `17_trigger_attribution.gs` | 371 | "Who is actually firing this handler?" — duplicate-account detection and trigger status. |
| `18_edit_handlers.gs` | 2062 | `onEdit` and everything downstream: dashboard edits, program-flag edits and how they spread to sibling rows and back onto the calendar description, the per-session `Waitlist_Only` tick and the one calendar event it is stamped onto instead, Config edits, Registrants edits, catering recount, and the Member_Roll edits that mean something (`handleMemberRollEdit`: a `Display_Name` correction carried across every tab, a `Household_Override` recomputed). Plus `handleProgramMonthEdit` — the `Program_Month` Leader dropdown, the one edit anywhere that writes to `Program_Leaders` from another tab: it asks first (this decides who may read a roster), only ever ADDS a row, refuses a fill-down, and answers a cleared cell by saying that nothing was removed and where a leader actually is. |

### Calendar → forms (19–26)

| File | | What is in it |
|---|--:|---|
| `19_calendar_incremental_sync.gs` | 245 | `onCalendarChange` and sync tokens. |
| `20_calendar_sync.gs` | 356 | `syncCalendars` — the entry point and its shape. |
| `21_description_tag_readers.gs` | 844 | What the system reads out of a calendar event's description, and the tag inspector. |
| `22_renamed_programs.gs` | 794 | A title change that must not cost you the roster: detection and the rename map applied across every tab and ledger. Also `reconcileProgramFlagColumns` / `reconcileSessionFlagColumns` — the sync bringing the dashboard's tick boxes back into line with the calendar, keyed per program and per date respectively. |
| `23_reconcile_sessions.gs` | 996 | Reconciling session times, assistance settings, club tags, No-Registration effects, and the registration horizon against the calendar. |
| `24_calendar_groups.gs` | 526 | `buildEventGroups` / `processCalendarGroup` — grouping events into the thing that gets one form. |
| `25_bootstrap.gs` | 554 | `bootstrapCalendars` — the sliced first import, for setups too large for one execution. |
| `26_event_descriptions.gs` | 1104 | Stripping every registration link out of an event description and writing exactly one back. |

### Responses → the workbook (27–33)

| File | | What is in it |
|---|--:|---|
| `27_registration_import.gs` | 453 | `syncRegistrations` — the entry point. |
| `28_deletion_tombstones.gs` | 517 | Why a deleted registration stays deleted. |
| `29_form_response_processing.gs` | 615 | `processFormResponse` — one response into registrant rows, guests and meals included. |
| `30_registry_counts.gs` | 162 | Active / waitlist / remaining-seat counts. |
| `31_form_shape_and_migration.gs` | 396 | Is a live form still on the current template, and migrating it if not. |
| `32_dashboard_link_repair.gs` | 1257 | Every way a registration link drifts from its session, diagnosed and repaired. |
| `33_calendar_invitations.gs` | 457 | Registrants as guests on the real calendar event. |

### Tabs the staff work in (34–42)

| File | | What is in it |
|---|--:|---|
| `34_sectioned_tables.gs` | 649 | The Upcoming/Past split every date-bearing tab uses. **The sectioned reader is used everywhere — change it carefully.** |
| `35_per_sheet_render.gs` | 105 | Per-sheet render wrappers. |
| `36_quick_mark_dialog.gs` | 1043 | Quick Mark, the sign-in desk tool on the menu. |
| `37_regular_needs.gs` | 592 | The standing notes a desk would otherwise have to memorize. |
| `38_quick_mark_index.gs` | 1823 | The cached index Quick Mark and the door pages both read, plus walk-ins and lunch-only sessions. |
| `39_triage_sheet.gs` | 391 | Sessions the calendar stopped mentioning. |
| `40_memory_tabs.gs` | 593 | `Member_Roll` / `Program_Options`, and the shared writer every staff-authored tab is drawn with (`writeMemoryTab`, `readSimpleTable`, the spare validation band). Also `stampMemberHouseholds` / `refreshMemberHouseholds` — where the household grouping decided in `77` meets the roll. What is particular to a roll of PEOPLE — the name split, the dedupe, retirement, the paste — is `79`, and both writers here go through its `writeMemberRollTab()`. |
| `41_club_rosters.gs` | 448 | `Club_Members`. |
| `42_legacy_tab_merge.gs` | 382 | Merging tabs from older layouts. |

### Dashboards and printed output (43–46)

| File | | What is in it |
|---|--:|---|
| `43_program_dashboard.gs` | 1016 | `renderProgramDashboard`. Still the home of the metrics block's arithmetic and every one of its column notes (`computeProgramMetrics` / `writeProgramMetricsSection`) — the block itself is now DRAWN on `Program_Month` (`78`), the tab whose grain it matches. |
| `44_lunch_dashboard.gs` | 1131 | `updateMasterLunchDashboard` and the catering counts. |
| `45_sign_in_sheet.gs` | 1322 | The desk's sheet for one day and one building — a **live Google Doc**, rebuilt in place so the link never goes stale, filed in `Sign-In Sheets`. Lunch on page one, everybody on page two. One row per PERSON (`signInPersonKey` / `dedupeSignInEntries`: a duplicate's meals take the MAXIMUM, a guest's ADD), and two washes for how a meal is handled — yellow it leaves the building, purple it needs doing something with here. It used to export a PDF and throw the document away; `getOrCreateSignInSheetFolder()` is all that is left of that, for the backfill in `69`. |
| `46_program_leader_sheets.gs` | 1535 | **Program registrant sheets** — a live roster shared out of the workbook, banded by session. One sheet per program (not per date), so a link handed out in September is still right in March. Built on the menu, automatically a week before a program's next session for EVERY program (`ensureRegistrantSheetsForUpcomingPrograms`, capped per run), and automatically for a leader who asked to be notified whenever their program runs (`ensureProgramLeaderSheetsForNotifyingLeaders`). The identifiers still say "leader" for the same reason `LEADER_SHEET_REGISTRY_PROP_KEY` still says "instructor"; only the words a person reads changed. |

### Repair and last resorts (47–51)

| File | | What is in it |
|---|--:|---|
| `47_moving_sessions.gs` | 513 | Combine forms, or just repoint a link. |
| `48_deleting_registrations.gs` | 397 | `showDeleteRegistrationsDialog`. |
| `49_form_rebuild.gs` | 798 | Destroy and rebuild forms — the Admin-menu last resort, sliced across executions. |
| `50_deleted_form_recovery.gs` | 455 | A form that was deleted out of the Drive folder. |
| `51_form_link_doctor.gs` | 557 | One screen for every way a link goes wrong. |

### Appointments and custom questions (52–55)

| File | | What is in it |
|---|--:|---|
| `52_appointments_and_slots.gs` | 450 | Slot arithmetic, appointment choice labels, booked-time reads. |
| `53_program_questions.gs` | 507 | The `Program_Questions` tab parsed into form items, and its refusals. |
| `54_custom_questions.gs` | 439 | Putting those questions on a form and taking them back off — fingerprints and applied-title tracking. |
| `55_assistance_sync_and_images.gs` | 1592 | Refreshing appointment slots across forms, appointment responses, the assistance report, and form images. |

### Reviews (56–59)

| File | | What is in it |
|---|--:|---|
| `56_time_blocks.gs` | 534 | Collapsing a day of time blocks into one event. |
| `57_program_type.gs` | 144 | "What kind of program is this?" — one answer instead of four. |
| `58_program_review.gs` | 1919 | Decide programs one at a time, apply them all at once. |
| `59_appointment_review.gs` | 1559 | One month, one location, one form. |

### The door (60–64)

| File | | What is in it |
|---|--:|---|
| `60_check_in_page_server.gs` | 1168 | `doGet` and `DOOR_ROUTES` — the ordered table of every page this one deployment serves (cancel first, the door app last and matching everything, including a retired `?mode=walkin`/`walk-in`/`legacy` bookmark), which `checkInPageUrl` also builds its `?mode=` from so a link and the router cannot drift. Plus `checkInRosterModeRequested`, the PIN gate, the roster read, and the mark/register handlers. |
| `61_check_in_page_html.gs` | 1490 | `buildCheckInHtml` — the whole served page, one template literal. |
| `62_walk_in_page.gs` | 36 | **Retired (September 2026) — a banner and nothing else.** The sign-in page for people who never registered; replaced by the door app (`73`). Kept, empty, because a file here is never renumbered or removed. Its server half is `74`; `checkInRosterModeRequested` went to `60`. |
| `63_check_in_store.gs` | 789 | The door's own store: a roster it reads, a queue it writes. |
| `64_walk_in_day_store.gs` | 336 | The sign-in page's boot snapshot: today, per building, stored so the page draws it before it asks. **Deliberately not invalidated** — see its banner. |

### Program leaders (65–66)

Numbered after the door rather than beside `46_program_leader_sheets.gs`,
because renumbering an existing file is the one edit this project cannot make
(see above). Both files hold behavior only — their schema (`SHEET_NAMES`,
`HEADERS.Program_Leaders`, `PROGRAM_LEADERS_STAFF_COLUMNS`) lives in `03`, so
nothing earlier reads them at load time, and neither reads `64` at load time
either.

| File | | What is in it |
|---|--:|---|
| `65_program_leaders.gs` | 1078 | The `Program_Leaders` tab: who leads what, their addresses, their notification ticks, and `Notify_Timing` — the closed dropdown deciding WHEN a ticked leader hears from `66`: at each change, N days before a date, or on a fixed weekday before one (`parseLeaderNotifyTiming`, `leaderNotifyTimingDaysBefore`) — plus the one-time migration that carries `Program_Options`' old `Instructor_Email` column onto it, and `attachProgramLeaderRow` — the single write this tab accepts from elsewhere (`Program_Month`'s Leader cell), which only ever adds a row, takes the address off the leader's own other rows, and leaves the notify tick clear. Also `Title_Match`, the phrases that let a program find its leader instead of the other way round (`proposeProgramLeaderRowsFromTitles`): a program nobody has typed a row for is PROPOSED to a matching leader as a concrete row with the notify tick clear — a phrase never overrides a typed row, never shares anything and never sends anything, because `buildProgramLeaderIndex()` still reads concrete rows only. |
| `66_program_leader_notifications.gs` | 985 | **Two channels, one tick.** Roster-change alerts: the stored per-program snapshot, the diff against it, and the one email per leader per sync that comes out of it. And the day-before digests for a leader whose `Notify_Timing` is a day count or a weekday instead: one email per session, N days ahead of it (a weekday row working its own count out per session, so one answer covers a Tuesday class and a Saturday one), listing who is on the roster — with its own ledger so an hourly pass sends it once. |

### Two months at the door (67)

| File | | What is in it |
|---|--:|---|
| `67_desk_month_sessions.gs` | 130 | `deskMonthSessions` — every session at one location from today to the end of NEXT month, grouped by day. The live read behind the day picker and the session boxes on the staff roster's register screen (`61`), and behind the club place a walk-in can take at the door. Behavior only; nothing earlier reads it at load time. |

### Migrations (68)

| File | | What is in it |
|---|--:|---|
| `68_form_state_migrations.gs` | 737 | `FORM_STATE_MIGRATIONS` — the registry of in-place repairs that carry a LIVE form from the shape it was built with to the shape the code now expects, without rebuilding it; the ledger of which have run on which form; the hourly sweep (`runFormStateMigrations`, ahead of `migrateFormsToCurrentTemplate`), which opens only the forms a pending migration is `targets`-ed at; and the Admin item that forces it now, slicing itself across executions until every form has been looked at. Behavior only, loading after everything it reads. |

### Links to the files this system makes (69)

Numbered last for the usual reason: it is behavior only, and its own
constants are the only ones it defines, so nothing earlier reads it at load
time. Its two columns live in `03` like every other schema.

| File | | What is in it |
|---|--:|---|
| `69_generated_file_links.gs` | 291 | Live links to the files this system makes outside the workbook: the sign-in sheet registry (which is also how `45` finds the document to rewrite, rather than making a second one) and its one-time backfill across both the live-Doc folder and the retired PDF one, plus the `Registrant_Sheet_Link` / `Sign_In_Sheet_Link` columns the dashboards and `Registrant_Dash` stamp on every render. |

### How often registrants hear from us (70)

Behavior only, and last for the usual reason: its two columns live in `03`
like every other schema, everything `33` and `40` call into it is a hoisted
function, and its own top-level `const`s stand alone.

| File | | What is in it |
|---|--:|---|
| `70_registrant_notifications.gs` | 526 | How often each program writes to the people signed up for it: `Program_Options`' `Notify_Mode` / `Reminder_Days`, the policy the calendar invites (`33`) and the reminder emails both read, and the ledger that stops an hourly sync repeating a send. The appointment time a shared calendar description cannot carry is stated here. |

### Cancellation (71)

Behavior only, and numbered last so it is clear of `67`–`70`: it reads the
door pages' vocabulary and declares nothing anything else derives from.

| File | | What is in it |
|---|--:|---|
| `71_cancellation.gs` | 749 | **One writer, three doors.** `cancelRegistrantRows()` is the only place a booking becomes a cancellation — four cells, not one (`Program_Status`, `Lunch_Status`, `Manual_Override`, an `Admin_Notes` stamp), and the `Manual_Override` is what stops the next hourly sync re-deriving the row from its form response and quietly un-cancelling it. The doors: the check-in page's cancel button (`checkInCancel`), a program leader's `Dropped` tick (`applyLeaderDropsAsCancellations`, called from the import right after the leader merge), and the member's own cancel page (`buildCancelPageHtml`, served at `?mode=cancel&form=…` from the link in the calendar invite). |


### The door app (72–73)

One deployment, one link. The setup screen (building + day, stored on the
tablet), the A–Z name list, the personal confirm screen, and the walk-in
sign-up that used to be three separate URLs. `doGet` in `60` serves this by
default; `?mode=session` is still the staff roster. `?mode=walkin` was the
previous door page and is no longer a route — an unrecognized mode falls
through to this app, so a stale bookmark opens it rather than an error.

| File | | What is in it |
|---|--:|---|
| `72_door_app.gs` | 796 | The server half: the date-aware day read (`doorDay`), the recurring-registration writes (`applyDoorRecurring` — the rest of the month, or a club place), the either-kind contact rule, and the live membership application — `doorMembershipForm` / `doorMembershipSubmit`, built generically from the Membership Application form's own items (`readMembershipFormShape`) and submitted through the Forms API, with `recordMembershipHandoff` (renamed from `sendMembershipEmail` — it never sent mail) as the record that survives someone not filling it in. |
| `73_door_app_html.gs` | 1412 | `buildDoorAppHtml` — the whole served app, one template literal, five screens redrawn into one `<main>`, membership application included. |

### The door's day and its one write (74)

The server half the retired walk-in page (`62`) was built around, which
outlived it: the door app reads its day and writes its sign-ins through these,
and the boot store (`64`) builds its snapshot from the same read. Numbered at
the end for the usual reason — never renumber — and safely so: it is behavior
only, its two `const`s stand alone, everything it calls is a hoisted function,
and its schema (`SHEET_NAMES`, `HEADERS.Member_Roll`) lives in `03`.

| File | | What is in it |
|---|--:|---|
| `74_door_day_and_sign_in.gs` | 743 | `readWalkInDay` — one building, one date: the programs on, who is expected and what each is already down for, the meal, and the member roll for the search box; `walkInDay`, its PIN-gated endpoint (`doorDay` in `72` is the date-aware one the app calls); `readWalkInMembers` and its per-execution memo; and `walkInSignIn`, the one place a door sign-in becomes rows — every mark through `applyQuickMarkFromDialog`, plus `recordWalkInMember` for somebody the roll has never heard of. |

### The sliced-job runner (75)

Numbered after `74` (taken by the door's day-and-sign-in file above) and after
the four callers it was extracted FROM (`25`, `32`, `49`, `68`), for the usual
reason: renumbering an existing file is the one edit this project cannot make,
and every one of those five predates this file. It reads and writes the same
Script Property keys and the same state shape those four callers always did,
so a job already mid-flight when this shipped resumed on its next slice
without noticing anything changed — see the file's own banner for why that
was a design goal, not an accident.

| File | | What is in it |
|---|--:|---|
| `75_sliced_jobs.gs` | 312 | `runSlicedJob` — the state machine every multi-execution job in this project runs on: the watchdog armed before work starts, the deadline, the slice counter, stall and consecutive-error detection, and the hand-off trigger. `runSlicedItems` is the one-item-one-lock-hold inner loop the two form sweeps (`32`, `49`) share. Behavior only; the four callers supply their own state, their own budgets, and every word the person reads. |

### Every email this workbook sends (76)

Numbered after `74` (the door's day-and-sign-in file) and `75` (the sliced-job
runner) — both landed first — and for the usual reason otherwise: it is
behavior only, it defines two constants nothing else derives from, it reads no
other file's constants at load time, and `66` and `70` reach it through a
hoisted function declaration — so whatever order the project's files come in,
it is there when they call it.

| File | | What is in it |
|---|--:|---|
| `76_rationed_mailer.gs` | 254 | `sendRationedEmail` — the plumbing every send to somebody outside the workbook shares: the once-per-execution read of `MailApp.getRemainingDailyQuota()` and the floor each caller refuses to dig below, the office BCC the caller resolves from its own Config category (each address counted as its own message, because it is one), the send, the refused address remembered so the run stops paying to be told no twice, and the caller's ledger written only once the message is away. **The policies stay with their callers** — who is written to, what it says, how often, and how much of the day's hundred messages a pass may spend live in `66` and `70`. `notifyAdmin` (`15`) deliberately does not come through here; the banner says why. |

### Who arrives with whom, and what they are called (77)

Behavior and vocabulary for two facts the desk used to hold in its head. Last
for the usual reason: its columns live in `03` like every other schema, its own
constants stand alone, and everything that calls into it (`29`, `36`, `38`,
`40`, `72`, `74`) reaches it through a hoisted function declaration.

| File | | What is in it |
|---|--:|---|
| `77_households_and_names.gs` | 453 | **A household is a guess, and a name is not a key you can retype.** `buildHouseholdAssignments` reads the people who arrive together off the contact details they share — one email, one phone — with the office's own address thrown out first (`HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN`) and `Household_Override` beating the guess in both directions; `readHouseholdIndex` / `householdCompanionsOf` are how the door (`74`) and Quick Mark (`38`) ask. And the names: `parseMemberName` lifts the nickname out of `Bob (Robert)` or `Robert "Bob" Kaplan` so a desk can find somebody under what they are actually called, while `applyMemberNameCorrection` is what a staff correction in `Display_Name` costs — the spelling rewritten across every tab that carries it, plus a remembered old→new map (`canonicalMemberName`) so the responses still arriving under the wrong one are filed under the right one. |

### The month behind the sessions (78)

Numbered after `77` (taken by the households-and-names file, which landed
first) and last for the usual reason: behavior only, its own top-level constants
stand alone, and everything it reads from other files it reaches through a
hoisted function call or `HEADERS` — so it is there whatever order the files
come in. Its schema (`SHEET_NAMES.PROGRAM_MONTH`, `HEADERS.Program_Month`)
lives in `03` like every other tab's.

| File | | What is in it |
|---|--:|---|
| `78_program_month_dashboard.gs` | 784 | The `Program_Month` tab: one row per program-month — the unit `buildEventGroups()` already makes one form for, and the one thing the session table cannot show. Grouped by `Form_ID` (the groupKey's own identity, already on the row), falling back to `(Clean_Title, Location, month)` for the `[No Registration]` and hand-added rows that have no form; a `[Shared]` program at two locations is ONE row, worded by `describeLocations()`. `Schedule` is what earns the tab its keep — `Tue 9:30 AM – 11:30 AM · 4 sessions`, or `times vary` with the outliers in a cell note. **Derived, read-only and purely additive**: nothing reads it, nothing is stored on it that is not already on a session row, and deleting the tab leaves every other behavior alone. Drawn from the session rows `renderProgramDashboard()` already holds — never a second read of that tab. A `FIXED`-span group (one form for a whole run of dates, no month of its own) is ONE row filed under its FIRST month — the design doc's open question #2, answered in the banner: repeating it per month it touches would double-count every number on the row. **Also the home of the metrics block** — `43` still owns its arithmetic and its words (`computeProgramMetrics` / `writeProgramMetricsSection`), which is what keeps "the numbers did not move" true by construction; only the drawing came here — plus the leader-coverage line under it (`programMonthLeaderCoverage`, which reads the memoized `buildProgramLeaderIndex()` and only ever COUNTS: it shares nothing and sends nothing) and the `Sessions` `HYPERLINK` that drills through to the group's own first day row, degrading to a plain count rather than to a wrong link. **And the `Leader` / `Leader_Source` pair** — the one thing on this tab a person may type into, and not storage: the name is read off `buildProgramLeaderIndex()` on every render and never read back, so an edit writes a row on `Program_Leaders` (`handleProgramMonthEdit` in `18`) rather than becoming a second answer to who may read a roster. `Leader_Source` reads `matched` while a `Title_Match` proposal behind it is unconfirmed, and those cells get the yellow wash. Monthly carry-forward needed no code — `leaderProgramKey()` has no month in it — and `tests/program_month.test.js` pins that rather than a mechanism. |

### The member roll (79)

Numbered after `78` for the usual reason — never renumber, and this landed
last. Safe there: behavior only, its own constants stand alone, its schema
(`HEADERS.Member_Roll`, `MEMBER_ROLL_STAFF_COLUMNS`) lives in `03`, and
everything `40`, `38` and `74` reach it through is a hoisted function.

| File | | What is in it |
|---|--:|---|
| `79_member_roll.gs` | 900 | **The roll as a roll of people, not a list of strings.** `First_Name`/`Last_Name`, split out of `Display_Name` or `Name` (`splitPersonName`) wherever they are blank and the staff's once written — and **never composed back onto `Name`**, because renaming somebody belongs to `applyMemberNameCorrection()` in `77`, which does it on every tab at once; a second rename path here would leave a person's history behind under their old spelling. The dedupe that runs on every write (`mergeMemberRollRows`: additive in every column, the longer history survives, `Merged_From` is its receipt), keyed on the name and on contact details paired with a surname and first initial, so a couple sharing a telephone number stays two people — and made durable by `rememberMemberNameCorrection()`, without which the refresh rebuilds the absorbed row on the next sync. Retirement as a `Status` column and a section at the foot of the tab rather than a delete: the row keeps every note and stops being offered at the door (`38`) or in the door app's search box. And the paste-in dialog (`showMemberRollImportDialog`), column mapping and preview included, on the pattern of `11`. `writeMemberRollTab()` is the ONE writer every path reaches the tab through — `40`'s refresh and its household recompute, `74`'s door sign-up, the paste, and the menu's dedupe — which is also where `stampMemberHouseholds()` runs, after the fold rather than before it. |

## Conventions

- **Comments carry the reasoning.** This codebase explains *why* a thing is
  shaped the way it is, usually in a banner above the code and often with the
  failure it exists to prevent. Match that when you add code; do not strip it
  when you edit around it.
- **Banners.** Files open with a `// ====` banner naming their section. Keep it
  accurate if a file's contents change character.
- **Constants over literals.** Colors come from `PALETTE`, tab names from
  `SHEET_NAMES`, columns from `HEADERS`. A bare string that duplicates one of
  those is a bug waiting for a rename.
- **A change to a live shape ships its migration in the same commit.** A
  template fix reaches forms created *afterwards* and nobody else: a group's
  form is created once and reused for as long as the group runs. A version bump
  says "this is different now"; the migration is what makes it different for
  everyone already holding the old thing. So when a change moves the shape of
  something already out in the world — a form's page navigation, its questions,
  a stored registry's fields — write the state A → state B repair beside it,
  register it in `FORM_STATE_MIGRATIONS` (`68_form_state_migrations.gs`) with
  its own never-reused id, and leave the earlier entries alone: a workbook that
  has been quiet for six months runs all of them in order on its next sync. A
  migration must be **idempotent** and must return 0 when the form is already
  right — it runs hourly, and a redundant Forms write is a round trip and a new
  revision in the form's history. Give it a `targets` predicate whenever the
  change only reaches some shapes: judged from the dashboard rows, it keeps the
  sweep from opening a form the repair would write nothing to. Rebuilding the form is the fallback for a
  shape no migration recognizes, not the first answer.
- **Script Properties keys are versioned** (`..._V1`). Changing a stored
  shape means a new key, not a silent reinterpretation of the old one. The
  converse is worth knowing too: a key whose stored shape has NOT changed keeps
  its value even when the words around it are renamed —
  `LEADER_SHEET_REGISTRY_PROP_KEY` is still spelled
  `'INSTRUCTOR_SHEET_REGISTRY_V1'`, and the comment above it says why.
- **Anything served to a browser is a template literal.** Values interpolated
  into a page's inline `<script>` must be escaped — a member named O'Brien, or
  a program title containing `</script>`, otherwise ends the page mid-sentence.
  See `tests/check_in_page.test.js` for what that guards.

## Tests

Plain Node scripts, no runner, no dependencies. Each one stubs the Apps Script
services, concatenates the whole project via `tests/helpers/source.js`, and
evaluates it in a `vm` context.

```
node tests/check_in_page.test.js        # one file
for f in tests/*.test.js; do node "$f"; done
```

`tests/helpers/source.js` sorts by filename — the order the project asks for —
so a test sees the same load order a correctly-ordered deployment does.
`tests/load_order.test.js` deliberately does the opposite: it loads the project
reversed and shuffled, because a real deployment's order is not guaranteed.

All tests pass. If one starts failing on a date-bearing fixture, check whether
the fixture's month has simply gone past: `buildAppointmentChoicesForContext()`
and friends drop sessions that have already started, so a hard-coded month
expires. `tests/appointment_review.test.js` builds its month relative to today
for that reason.

## Deploying

**There is no build step. The numbered `.gs` files ARE the deliverable**, and
they go into the Apps Script project unchanged — via a GitHub-sync browser
extension in the editor, or `clasp push`.

Filenames should survive intact — the prefixes are how the project is
organized and how these tables are indexed. They are no longer *load-bearing*
(see the top of this file), so a sync tool that reorders files in the project
is no longer a load-time crash; but a renamed file still costs you every
cross-reference in this document.
Do not rename a file to fit a deployment, and do not merge files to reduce
their number.

`tools/bundle.js` still exists and still works — it writes a single
`Code.bundle.gs` for a one-off paste-install where neither of the above is
available. It is not part of the normal loop: **do not run it as a build step,
and do not treat its output as the source.** `Code.bundle.gs` is gitignored;
edits belong in the numbered files.

