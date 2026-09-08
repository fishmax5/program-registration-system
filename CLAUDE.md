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
| `00_overview.gs` | 547 | Nothing but the project's header comment: every tab, the sync flow, the first-run path. **Read this first** — it is the cheapest orientation in the repo. |
| `01_logging_and_access.gs` | 268 | `log()`, the admin-only gate — which applies to `ADMIN_GATED_ACTIONS` and nothing else, so a repair or a read is open to whoever can open the workbook — and the "are you sure?" prompts. |
| `01a_lazy_globals.gs` | 63 | `defineLazyGlobal_` — the one helper that makes file load order stop mattering. Read the banner before adding a constant derived from another file's. |
| `02_palette_and_tags.gs` | 972 | `PALETTE` and every color derived from it; `EVENT_TYPES`; the bracket tags (`Shared`, `Club`, `No Registration`, `Personalized Assistance`) and the regexes that recognize them in a calendar title. Plus the one tag that describes a DATE rather than a program — `Waitlist Only`, which closes a single session to new Active registrations whatever its capacity says — and the two lists that keep the difference straight: `PROGRAM_FLAG_COLUMNS` (ticked onto every row of a program) and `SESSION_FLAG_COLUMNS` (ticked onto the row you clicked, and nowhere else). |
| `03_sheets_and_headers.gs` | 1034 | `SHEET_NAMES`, `HEADERS` (the column list for every tab), legacy renames and header aliases, per-tab staff-owned column lists. **The schema.** `Program_Settings`' guest-list tick is `Add_Guest_To_Calendar` — it was `Add_To_Calendar`, which read as though unticking it would take the program off the calendar; it never meant that (the event is the calendar's) and the old spelling is carried across by `LEGACY_HEADER_ALIASES`. `Program_Settings` is the one tab here that was made by MERGING two: `Program_Options` and `Registrant_Notifications` had one grain, one key and one refresh between them, so they are one tab and one `PROGRAM_SETTINGS_STAFF_COLUMNS` list now — carried across by a `LEGACY_SHEET_RENAMES` entry for the first and a migration for the second.Member_Roll's household and name columns are described here; what they MEAN is `77`. Note the one place a tab's name and its schema key deliberately disagree: the session tab is `All_Program_Sessions` (renamed from `All_Program_Sessions` in September 2026, carried across in place by `LEGACY_SHEET_RENAMES`) but its header list is still keyed `HEADERS.All_Program_Sessions` — a schema key is read by code, a tab name by people. Same reasoning as `LEADER_SHEET_REGISTRY_PROP_KEY` still being spelled `INSTRUCTOR_SHEET_REGISTRY_V1`. |
| `04_settings_and_config.gs` | 590 | `CONFIG_LAYOUT` and the settings on the Config tab — meal buffers, order-ahead days, catering policy, link display, calendar invites, automation on/off, and the Admin Notification Emails table (`ADMIN_NOTIFICATION_CATEGORIES`: who in the office is copied on which outbound mail, replacing the retired single Admin Notification / Archive Copy cells) — plus locations, addresses, and the forms Drive folder. Also the SECOND kill switch, which answers a different question from the first: `Pause_Outbound_Mail` (`OUTBOUND_MAIL_PAUSE_OPTIONS`) stops everything that leaves the organization while the syncs, dashboards and repairs carry on — and DISCARDS what it holds rather than queueing it, because the run somebody pauses for is the run that would otherwise mail a leader about a dozen registrations that never changed. Fails open like `Automation_Enabled`: only the literal "Yes" pauses. |
| `05_form_template.gs` | 1183 | `TEMPLATE_VERSION` and the shape of the generated Google Form: item titles, page titles, the roster grid, attendance-mode choices, guests, the meal totals, and the page navigation helpers every form-shaping path writes through (`setNavigationAfterPage`). **Bump `TEMPLATE_VERSION` when the form's structure changes — page navigation counts.** |
| `06_registries_and_locks.gs` | 152 | The groupKey→Form_ID registry in Script Properties, the all-dates registry, template-version tracking, and the script locks. |
| `07_dates_and_labels.gs` | 649 | `TIMEZONE`, date formatting, and the capacity/meal hints a form's date label carries. |
| `08_execution_caches.gs` | 491 | The per-execution memo caches the sync hot paths use, and their invalidation — including `openFormCached()`, the one `FormApp.openById()` per form per run. |
| `09_lunch_schedule_lookup.gs` | 403 | Reading `Lunch_Schedule` by date × location. |
| `10_form_date_labels.gs` | 749 | Fingerprinted writes of date labels onto a live form (`applyFormDateLabels`). |
| `11_menu_items_paste.gs` | 1107 | Adding menu items to `Lunch_Schedule` — paste CSV, in the sheet or a dialog. |

### Building the workbook (12–15)

| File | | What is in it |
|---|--:|---|
| `12_sheet_setup.gs` | 213 | `initSheet` and the `Lunch_Schedule` tab's own setup. |
| `13_lunch_only_signup_form.gs` | 1039 | The lunch-only sign-up form — the one form built from `Lunch_Schedule` rather than the calendar. Also the shared sheet-shaping helpers it grew around: `autosizeColumns`, and `ensureSheetColumns` (a layout that outgrows a tab's column count is a throw, not a resize). |
| `14_saved_column_widths.gs` | 463 | "This column should be this wide, always." |
| `15_config_sheet.gs` | 1349 | Drawing and validating the Config tab, reading its settings back (`getAdminNotificationRows` / `adminEmailsForCategory` / `isOutboundMailPaused` among them), and the two ways the office is told anything: `notifyAdmin` / `notifyAdminCategory` / `flushAdminDigest`, which now FILE a line for the daily digest (`88`) rather than sending, and `notifyAdminUrgent`, which is the old send-at-once behavior kept for the two faults that cannot wait. Neither is pausable. |

### Menus, triggers, and edits (16–18)

| File | | What is in it |
|---|--:|---|
| `16_menu_and_triggers.gs` | 648 | `onOpen`, the menu tree (the Admin submenu is now attached for everyone — the gate lives inside its destructive items, not on the menu), trigger installation. The items pressed ONCE on a workbook upgraded from an older version — the two backfills, the guest sweep, and the first-run import — are collected behind Admin → **One-Time Jobs**, which is what lets the sibling submenu beside it be called `Reports` and mean it. |
| `17_trigger_attribution.gs` | 371 | "Who is actually firing this handler?" — duplicate-account detection and trigger status. |
| `18_edit_handlers.gs` | 2062 | `onEdit` and everything downstream: dashboard edits, program-flag edits and how they spread to sibling rows and back onto the calendar description, the per-session `Waitlist_Only` tick and the one calendar event it is stamped onto instead, Config edits, Registrants edits, catering recount, and the Member_Roll edits that mean something (`handleMemberRollEdit`: a `Display_Name` correction carried across every tab, a `Household_Override` recomputed). Plus `handleProgramMonthEdit` — the `Master_Program_Dashboard` Leader dropdown, the one edit anywhere that writes to `Program_Leaders` from another tab: it asks first (this decides who may read a roster), only ever ADDS a row, refuses a fill-down, and answers a cleared cell by saying that nothing was removed and where a leader actually is. |

### Calendar → forms (19–26)

| File | | What is in it |
|---|--:|---|
| `19_calendar_incremental_sync.gs` | 245 | `onCalendarChange` and sync tokens. |
| `20_calendar_sync.gs` | 356 | `syncCalendars` — the entry point and its shape. |
| `21_description_tag_readers.gs` | 844 | What the system reads out of a calendar event's description, and the tag inspector. |
| `22_renamed_programs.gs` | 796 | A title change that must not cost you the roster: detection and the rename map applied across every tab and ledger. Also `reconcileProgramFlagColumns` / `reconcileSessionFlagColumns` — the sync bringing the dashboard's tick boxes back into line with the calendar, keyed per program and per date respectively. |
| `23_reconcile_sessions.gs` | 996 | Reconciling session times, assistance settings, club tags, No-Registration effects, and the registration horizon against the calendar. |
| `24_calendar_groups.gs` | 526 | `buildEventGroups` / `processCalendarGroup` — grouping events into the thing that gets one form. |
| `25_bootstrap.gs` | 554 | `bootstrapCalendars` — the sliced first import, for setups too large for one execution. |
| `26_event_descriptions.gs` | 1104 | Stripping every registration link out of an event description and writing exactly one back. |

### Responses → the workbook (27–33)

| File | | What is in it |
|---|--:|---|
| `27_registration_import.gs` | 476 | `syncRegistrations` — the entry point. |
| `28_deletion_tombstones.gs` | 517 | Why a deleted registration stays deleted. |
| `29_form_response_processing.gs` | 615 | `processFormResponse` — one response into registrant rows, guests and meals included. |
| `30_registry_counts.gs` | 162 | Active / waitlist / remaining-seat counts. |
| `31_form_shape_and_migration.gs` | 396 | Is a live form still on the current template, and migrating it if not. |
| `32_dashboard_link_repair.gs` | 1257 | Every way a registration link drifts from its session, diagnosed and repaired. |
| `33_calendar_invitations.gs` | 738 | Registrants — and nobody else — as guests on the real calendar event. The office is told by mail instead: one digest per pass naming who was invited to what and how (`notifyOfficeOfCalendarInvites`), plus the one-time Admin sweep that takes staff addresses back off the events they are still on (`removeAdminGuestsFromCalendarEvents`). |

### Tabs the staff work in (34–42)

| File | | What is in it |
|---|--:|---|
| `34_sectioned_tables.gs` | 649 | The Upcoming/Past split every date-bearing tab uses. **The sectioned reader is used everywhere — change it carefully.** |
| `35_per_sheet_render.gs` | 105 | Per-sheet render wrappers. |
| `36_quick_mark_dialog.gs` | 1355 | Quick Mark, the sign-in desk tool on the menu — including **Add to waitlist**, the one tick that clears every mark beside it (no seat, no meal). Its writes are **optimistic**: pressing Mark draws the mark as done and clears for the next person while the sheet write runs underneath, with the walk-in question asked from the dialog's own lists first (`walkInNames`) rather than from a `needsConfirm` round trip after. |
| `37_regular_needs.gs` | 592 | The standing notes a desk would otherwise have to memorize. |
| `38_quick_mark_index.gs` | 2019 | The cached index Quick Mark and the door pages both read, plus walk-ins and lunch-only sessions — and `applyQuickMarkLocked`, where the desk's five ticks land (the fifth, **Add to waitlist**, goes through `71`'s writer rather than setting a status here). Also `warmQuickMarkIndexIfCold` (the five-minute rebuild that keeps a stored index there to inline) and `reportOptimisticQuickMarkFailure` (a refused mark told to the office, because the desk has already moved on). |
| `39_triage_sheet.gs` | 391 | Sessions the calendar stopped mentioning. |
| `40_memory_tabs.gs` | 926 | `Member_Roll` / `Program_Settings` — including `refreshProgramSettings`, the ONE pass that writes the tab `Program_Options` and `Registrant_Notifications` were merged into — now GROUPED BY KIND (`groupProgramSettingsRows` / `programSettingsGroupOf`, resolving section 13's six `PROGRAM_FORM_TYPES` off the same four controls everything else does, plus a seventh heading for the programs the calendar has stopped mentioning), the headings being real rows every reader skips (`isMemoryTabDividerValue`, which generalizes Member_Roll's retired divider) — and `seedNotificationHalf`, the newest-first rule that keeps "a row is never born blank" true through that merge. Plus the shared writer every staff-authored tab is drawn with (`writeMemoryTab`, `readSimpleTable`, the spare validation band). Also `stampMemberHouseholds` / `refreshMemberHouseholds` — where the household grouping decided in `77` meets the roll. What is particular to a roll of PEOPLE — the name split, the dedupe, retirement, the paste — is `79`, and both writers here go through its `writeMemberRollTab()`. |
| `41_club_rosters.gs` | 448 | `Club_Members`. |
| `42_legacy_tab_merge.gs` | 385 | Merging tabs from older layouts. |

### Dashboards and printed output (43–46)

| File | | What is in it |
|---|--:|---|
| `43_program_dashboard.gs` | 1036 | `renderProgramDashboard`. Still the home of the metrics block's arithmetic and every one of its column notes (`computeProgramMetrics` / `writeProgramMetricsSection`) — the block itself is now DRAWN on `Master_Program_Dashboard` (`78`), the tab whose grain it matches. |
| `44_lunch_dashboard.gs` | 1131 | `updateMasterLunchDashboard` and the catering counts. |
| `45_sign_in_sheet.gs` | 1322 | The desk's sheet for one day and one building — a **live Google Doc**, rebuilt in place so the link never goes stale, filed in `Sign-In Sheets`. Lunch on page one, everybody on page two. One row per PERSON (`signInPersonKey` / `dedupeSignInEntries`: a duplicate's meals take the MAXIMUM, a guest's ADD), and two washes for how a meal is handled — yellow it leaves the building, purple it needs doing something with here. It used to export a PDF and throw the document away; `getOrCreateSignInSheetFolder()` is all that is left of that, for the backfill in `69`. |
| `46_program_leader_sheets.gs` | 1606 | **Program registrant sheets** — a live roster shared out of the workbook, banded by session. One sheet per program (not per date), so a link handed out in September is still right in March. Built on the menu, automatically a week before a program's next session for EVERY program (`ensureRegistrantSheetsForUpcomingPrograms`, capped per run), and automatically for a leader who asked to be notified whenever their program runs (`ensureProgramLeaderSheetsForNotifyingLeaders`). The identifiers still say "leader" for the same reason `LEADER_SHEET_REGISTRY_PROP_KEY` still says "instructor"; only the words a person reads changed. Two of its five leader-owned ticks reach outside the sheet: `Dropped` (a cancellation) and `Waitlisted` (a waitlisting, and the only one that can be taken back) — the second is washed peach on the row, `isLeaderSheetWaitlistedRow`. |

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
| `55_assistance_sync_and_images.gs` | 1643 | Refreshing appointment slots across forms, appointment responses, the assistance report, and form images. |

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
| `60_check_in_page_server.gs` | 1228 | `doGet` and `DOOR_ROUTES` — the ordered table of every page this one deployment serves that WRITES to the workbook (cancel first, the door app last and matching everything, including a retired `?mode=walkin`/`walk-in`/`legacy` bookmark), which `checkInPageUrl` also builds its `?mode=` (and any extra `params`) from so a link and the router cannot drift. A route may also declare `frameable`, which is how ONE page — the public calendar, the only one here that writes nothing — gets `setXFrameOptionsMode(ALLOWALL)` while every page that writes keeps the default refusal. Plus `checkInRosterModeRequested`, the PIN gate, the roster read, and the mark/register handlers. The two PUBLIC pages are no longer in this table: `doGet` asks `publicEmbedRoute` (`91`) before it walks this one and `doorRouteUrlMode_` asks `publicEmbedUrlMode` before it answers, because the one thing that separates them — that another website may FRAME them — is a property of the response, not of a page. |
| `61_check_in_page_html.gs` | 1490 | `buildCheckInHtml` — the whole served page, one template literal. |
| `62_walk_in_page.gs` | 36 | **Retired (September 2026) — a banner and nothing else.** The sign-in page for people who never registered; replaced by the door app (`73`). Kept, empty, because a file here is never renumbered or removed. Its server half is `74`; `checkInRosterModeRequested` went to `60`. |
| `63_check_in_store.gs` | 796 | The door's own store: a roster it reads, a queue it writes. Its five-minute flush trigger also re-warms Quick Mark's lists when a desk write has dropped them. |
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
| `65_program_leaders.gs` | 1079 | The `Program_Leaders` tab: who leads what, their addresses, their notification ticks, and `Notify_Timing` — the closed dropdown deciding WHEN a ticked leader hears from `66`: at each change, N days before a date, or on a fixed weekday before one (`parseLeaderNotifyTiming`, `leaderNotifyTimingDaysBefore`) — plus the one-time migration that carries `Program_Options`' old `Instructor_Email` column onto it, and `attachProgramLeaderRow` — the single write this tab accepts from elsewhere (`Master_Program_Dashboard`'s Leader cell), which only ever adds a row, takes the address off the leader's own other rows, and leaves the notify tick clear. Also `Title_Match`, the phrases that let a program find its leader instead of the other way round (`proposeProgramLeaderRowsFromTitles`): a program nobody has typed a row for is PROPOSED to a matching leader as a concrete row with the notify tick clear — a phrase never overrides a typed row, never shares anything and never sends anything, because `buildProgramLeaderIndex()` still reads concrete rows only. |
| `66_program_leader_notifications.gs` | 990 | **Two channels, one tick.** Roster-change alerts: the stored per-program snapshot, the diff against it, and the one email per leader per sync that comes out of it. And the day-before digests for a leader whose `Notify_Timing` is a day count or a weekday instead: one email per session, N days ahead of it (a weekday row working its own count out per session, so one answer covers a Tuesday class and a Saturday one), listing who is on the roster — with its own ledger so an hourly pass sends it once. |

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
| `69_generated_file_links.gs` | 291 | Live links to the files this system makes outside the workbook: the sign-in sheet registry (which is also how `45` finds the document to rewrite, rather than making a second one) and its one-time backfill across both the live-Doc folder and the retired PDF one, plus the `Registrant_Sheet_Link` / `Sign_In_Sheet_Link` columns the dashboards and `All_Registrants` stamp on every render. |

### How often registrants hear from us (70)

Behavior only, and last for the usual reason: its two columns live in `03`
like every other schema, everything `33` and `40` call into it is a hoisted
function, and its own top-level `const`s stand alone.

| File | | What is in it |
|---|--:|---|
| `70_registrant_notifications.gs` | 458 | How often each program writes to the people signed up for it: the policy the calendar invites (`33`) and the reminder emails both read — resolved from `Registrant_Notifications`' tick boxes (`81`) — and the ledger that stops an hourly sync repeating a send. The appointment time a shared calendar description cannot carry is stated here. |

### Cancellation (71)

Behavior only, and numbered last so it is clear of `67`–`70`: it reads the
door pages' vocabulary and declares nothing anything else derives from.

| File | | What is in it |
|---|--:|---|
| `71_cancellation.gs` | 988 | **One writer, three doors** — and a second writer for the waitlist beside it. `cancelRegistrantRows()` is the only place a booking becomes a cancellation — four cells, not one (`Program_Status`, `Lunch_Status`, `Manual_Override`, an `Admin_Notes` stamp), and the `Manual_Override` is what stops the next hourly sync re-deriving the row from its form response and quietly un-cancelling it. The doors: the check-in page's cancel button (`checkInCancel`), a program leader's `Dropped` tick (`applyLeaderDropsAsCancellations`, called from the import right after the leader merge), and the member's own cancel page (`buildCancelPageHtml`, served at `?mode=cancel&form=…` from the link in the calendar invite).<br><br>The waitlist half writes the same four cells for a state that is not an ending: `stampRegistrantRowWaitlisted` / `stampRegistrantRowActive`, reached from Quick Mark's **Add to waitlist** and from the leader sheet's `Waitlisted` tick (`applyLeaderWaitlistTicks`, two-way). A promotion is refused unless the place was made by hand (`wasWaitlistedByHand` — the import's capacity queue is never jumped) and the session has a free seat (`buildWaitlistSeatIndex`). |


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
| `74_door_day_and_sign_in.gs` | 750 | `readWalkInDay` — one building, one date: the programs on, who is expected and what each is already down for, the meal, and the member roll for the search box; `walkInDay`, its PIN-gated endpoint (`doorDay` in `72` is the date-aware one the app calls); `readWalkInMembers` and its per-execution memo; and `walkInSignIn`, the one place a door sign-in becomes rows — every mark through `applyQuickMarkFromDialog`, plus `recordWalkInMember` for somebody the roll has never heard of. |

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
| `76_rationed_mailer.gs` | 339 | `sendRationedEmail` — the plumbing every send to somebody outside the workbook shares: the once-per-execution read of `MailApp.getRemainingDailyQuota()` and the floor each caller refuses to dig below, the office BCC the caller resolves from its own Config category (each address counted as its own message, because it is one), the send, the refused address remembered so the run stops paying to be told no twice, and the caller's ledger written only once the message is away. It is also the ONE place the outbound-mail pause is read (`04`): a paused message returns `'paused'` and has its `recordSent()` called anyway, so the ledger advances and the message is dropped rather than owed — the three callers in `66` and `70` treat that status as told, which is what stops the pause becoming a delayed flood. **The policies stay with their callers** — who is written to, what it says, how often, and how much of the day's hundred messages a pass may spend live in `66` and `70`. `notifyAdmin` (`15`) deliberately does not come through here; the banner says why. Since `88`, NO caller passes a `bcc` or an `officeCopy`: the office reads one line per send in its daily digest instead, which is also why a reminder costs one message against the quota rather than one plus the size of the office table. |

### Who arrives with whom, and what they are called (77)

Behavior and vocabulary for two facts the desk used to hold in its head. Last
for the usual reason: its columns live in `03` like every other schema, its own
constants stand alone, and everything that calls into it (`29`, `36`, `38`,
`40`, `72`, `74`) reaches it through a hoisted function declaration.

| File | | What is in it |
|---|--:|---|
| `77_households_and_names.gs` | 453 | **A household is a guess, and a name is not a key you can retype.** `buildHouseholdAssignments` reads the people who arrive together off the contact details they share — one email, one phone — with the office's own address thrown out first (`HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN`) and `Household_Override` beating the guess in both directions; `readHouseholdIndex` / `householdCompanionsOf` are how the door (`74`) and Quick Mark (`38`) ask. And the names: `parseMemberName` lifts the nickname out of `Bob (Robert)` or `Robert "Bob" Kaplan` so a desk can find somebody under what they are actually called, while `applyMemberNameCorrection` is what a staff correction in `Display_Name` costs — the spelling rewritten across every tab that carries it, plus a remembered old→new map (`canonicalMemberName`) so the responses still arriving under the wrong one are filed under the right one. |

### The program behind the sessions (78)

Numbered after `77` (taken by the households-and-names file, which landed
first) and last for the usual reason: behavior only, its own top-level constants
stand alone, and everything it reads from other files it reaches through a
hoisted function call or `HEADERS` — so it is there whatever order the files
come in. Its schema (`SHEET_NAMES.PROGRAM_MONTH`, `HEADERS.Master_Program_Dashboard`)
lives in `03` like every other tab's. The filename still says "month" for the
same reason `LEADER_SHEET_REGISTRY_PROP_KEY` still says "instructor": renaming
a file is the one edit this project cannot make.

| File | | What is in it |
|---|--:|---|
| `78_program_month_dashboard.gs` | 1180 | The `Master_Program_Dashboard` tab: **one row per PROGRAM** — one title, at the building(s) it runs in, for as long as it runs. It was one row per program-MONTH, keyed on `Form_ID`, which is the unit a form and a capacity belong to and the wrong unit for a front page: a weekly class was twelve rows a year differing only in which dates they summed. The key is now `program::<title>::<building signature>`, with `programFormLocations()` resolving the signature — `Form_ID` is what tells you a `[Shared]` program's two buildings are ONE thing to run, and is no longer the key itself, because a Regular program takes a new form every month and keying on it is how the month got into the grain. **Derived, read-only and purely additive**: nothing reads it, nothing is stored on it that is not already on a session row or on `Program_Leaders` / `Program_Settings`, and deleting the tab leaves every other behavior alone. Drawn from the session rows `renderProgramDashboard()` already holds — never a second read of that tab.<br><br>**Fifteen columns a person reads, where there were seventeen** — the rule `describeProgramMonthSchedule()` set, applied to the whole tab: the fact goes in the cell, the follow-up goes in a cell note. `Schedule` is the cadence, times, span and count (`detectProgramMonthRecurrence` names `Weekly` / `Every 2 weeks` and any week the run SKIPS — never "cancelled", because nothing here can tell a session called off from one never scheduled; the per-month breakdown is in the note). `Seats` is Registered/Max_Capacity/Fill/Waitlist as one sentence, summed over **this month and next** (`programSeatWindow` — a lifetime total only goes up, says nothing about next Tuesday, and beside a capacity reads as something bookable). `Links` is four link columns as one cell of rich text (`writeProgramMonthLinkCells`). `Leader_Source` became a yellow wash and a note. The split is **Running / Not currently running** (`partitionRunningPrograms` — a status, borrowed from `79`'s retirement section, not `34`'s date partition), running sorted by `Next_Date`, the rest by how recently they stopped. The `FIXED`-span filing problem in the old banner dissolved with the month.<br><br>**Also the home of the metrics block** — `43` still owns its arithmetic and its words (`computeProgramMetrics` / `writeProgramMetricsSection`), which is what keeps "the numbers did not move" true by construction; only the drawing came here — plus the leader-coverage line under it (`programMonthLeaderCoverage`, which reads the memoized `buildProgramLeaderIndex()`, counts the RUNNING programs, and only ever COUNTS).<br><br>**Four windows and two panes**, every one still derived: `Room` and `Notify` are read-only cells off `Program_Settings` (`programMonthSettingsCell`, through the same memoized `readNotificationPolicyRows()` the invitation and reminder passes use — a third caller of one memo, not a third read of one tab); `Notify` blank means no settings row yet and `Silent` means every box cleared. `Room` is still written on every render but HIDDEN (`PROGRAM_MONTH_HIDDEN_COLUMNS`) while nobody is filling `Room_Or_Setup` in — a column of blanks on a front page reads as an answer rather than an unasked question; unhiding it is one name off that list. The four writable ones: `Leader` (an edit writes a row on `Program_Leaders` via `handleProgramMonthEdit` in `18`) and the three PROGRAM FLAGS — `Club`, `No_Registration`, `Personalized_Assistance` — which moved here off the session table, where a program carried twelve identical copies of each. A tick writes through to every session row of that program and onto the calendar (`handleProgramMonthFlagEdit` / `applyProgramMonthFlagToSessions` in `18`, reusing the same pending-flag queue); the session table keeps the columns as hidden plumbing, because that is still where the answer is stored. Carry-forward needed no code — `leaderProgramKey()` has no month in it, and now neither does the row — and `tests/program_month.test.js` pins that rather than a mechanism. |

### The member roll (79)

Numbered after `78` for the usual reason — never renumber, and this landed
last. Safe there: behavior only, its own constants stand alone, its schema
(`HEADERS.Member_Roll`, `MEMBER_ROLL_STAFF_COLUMNS`) lives in `03`, and
everything `40`, `38` and `74` reach it through is a hoisted function.

| File | | What is in it |
|---|--:|---|
| `79_member_roll.gs` | 925 | **The roll as a roll of people, not a list of strings.** `First_Name`/`Last_Name`, split out of `Display_Name` or `Name` (`splitPersonName`) wherever they are blank and the staff's once written — and **never composed back onto `Name`**, because renaming somebody belongs to `applyMemberNameCorrection()` in `77`, which does it on every tab at once; a second rename path here would leave a person's history behind under their old spelling. The dedupe that runs on every write (`mergeMemberRollRows`: additive in every column, the longer history survives, `Merged_From` is its receipt), keyed on the name and on contact details paired with a surname and first initial, so a couple sharing a telephone number stays two people — and made durable by `rememberMemberNameCorrection()`, without which the refresh rebuilds the absorbed row on the next sync. Retirement as a `Status` column and a section at the foot of the tab rather than a delete: the row keeps every note and stops being offered at the door (`38`) or in the door app's search box. And the paste-in dialog (`showMemberRollImportDialog`), column mapping and preview included, on the pattern of `11`. `writeMemberRollTab()` is the ONE writer every path reaches the tab through — `40`'s refresh and its household recompute, `74`'s door sign-up, the paste, and the menu's dedupe — which is also where `stampMemberHouseholds()` runs, after the fold rather than before it. |

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

### The weekend, on purpose (80)

Behavior only, and numbered last for the usual reason: its two constants stand
alone, everything it calls is a hoisted function, and nothing else reads it at
load time. It was `77` on `main` until the merge that brought `77`–`79` in;
renumbering it was the one way to keep both, and the prefix is all that changed.

| File | | What is in it |
|---|--:|---|
| `80_weekend_event_loader.gs` | 322 | `showWeekendEventLoaderDialog` — the Sat/Sun dates in a window (today through the end of next month by default, with its own two date boxes) that are NOT yet on the dashboard, ticked one at a time and loaded through the sync's own `processCalendarGroup`. A weekend event on a program calendar is as often a rental or a placeholder as a program, so this is the deliberate one-off; it changes nothing about which events `syncCalendars` considers. |

### The tab those notifications are set on (81)

Behavior and one schema-free constant block, numbered last for the usual
reason: everything it calls is a hoisted function, `70` reaches it the same
way, and its own `const`s stand alone. It was `78` on `main` before the same
merge; see `80` above.

| File | | What is in it |
|---|--:|---|
| `81_registrant_notifications_tab.gs` | 430 | **The notification half of `Program_Settings`, and no longer a tab of its own.** A tick box per channel, none of them exclusive: `Add_Guest_To_Calendar` (the guest list on the real event — not whether the event is on the calendar, which this system never decides; it was `Add_To_Calendar` and the old spelling is aliased), `Week_Before`, `Day_Before`, `Morning_Of`, `Other_Reminders` (any further day counts) and `Confirm_On_Booking`; `policyFromNotificationRow` is what `70` resolves a session's policy through. What stayed here after the merge is the vocabulary and the two one-time carry-overs: `readLegacyNotifyModeRows` (the retired `Notify_Mode` / `Reminder_Days` cells) and `readLegacyRegistrantNotificationRows` / `markProgramSettingsMergeDone` (the retired tab's own ticks, translated through `LEGACY_NOTIFICATION_COLUMN_RENAMES` and lifted onto the merged row and the old tab left in the workbook marked retired rather than deleted). Both are read by `40`'s single refresh, before its write — which is the only order that works, and now the only order there is. |

### Removing one registrant (83)

Behavior only, numbered last for the usual reason: its own two constants stand
alone, its schema is `HEADERS.All_Registrants` in `03` like every other tab's,
and everything it calls — the tombstones, both renders, the two recounts — is a
hoisted function.

| File | | What is in it |
|---|--:|---|
| `83_remove_marked_registrants.gs` | 189 | **The one-row delete, as a mark and a sweep.** `48` deletes by SESSION, which is the right shape for a test run and the wrong one for "this person was entered twice" — so `Manual_Override` gained a fourth option on the registrant tabs, `REGISTRANT_REMOVE_OVERRIDE_OPTION` (`'Remove This Row'`, `02`), the one value in that column that is a request rather than a record and the one washed red (`39`). **Marking deletes nothing**: `removeMarkedRegistrants()` on the Rosters & Sharing menu is what sweeps, because a mis-click in a dropdown must not be permanent and because three duplicates found while reading down a roster are cleared in one pass. It names every row before it goes, records the tombstones (`28`) BEFORE the redraw — without which the import and both catch-ups rebuild every removed row on the next sync — redraws from the kept rows, and recomputes the session counts and the catering from those same rows. It leaves the form responses alone (the tombstone, not a deletion, is what keeps them from coming back as rows), and the mark itself is protected from re-derivation in `getProtectedRegistrantKeys()`, without which an hourly sync between the mark and the sweep quietly resets it to `Auto-Synced`. |

### Where the generated files live (82)

Behavior plus its own two constants, numbered last for the usual reason:
nothing else derives from them, and `04`, `05`, `45`, `46` and `55` all reach
it through hoisted function declarations. It was `79` on its own branch until
the merge that brought `79`–`81` in; the prefix is all that changed.

| File | | What is in it |
|---|--:|---|
| `82_drive_organization.gs` | 427 | **The anchor.** Every folder this system keeps was found with a Drive-WIDE `getFoldersByName` and created with a parent-less `createFolder` — that is, in My Drive root. `getSystemRootFolder()` is the folder the WORKBOOK sits in, remembered in Script Properties, and `getOrCreateSystemFolder()` is the one lookup all five now share: inside the anchor first, adopting (and renaming) a stray folder of that name if there is one — never duplicating it, because the files in it have live links — and creating inside the anchor otherwise. `moveDriveFileInto()` is `50`'s `moveTo`-then-`addFile` pair generalized, and never throws. Plus `organizeGeneratedFiles()`, the Admin one-time sweep: everything with an id in a registry, then My Drive root by name AND MIME type (`STRAY_FILE_PATTERNS`). |

### One row per month (83)

Numbered after `82` (the Drive-organization file) for the usual reason — never
renumber, and this landed last. Safe there: behavior only, its schema
(`SHEET_NAMES.METRICS`, `HEADERS.Metrics`, `METRICS_STAFF_COLUMNS`) lives in
`03` like every other tab's, its own `const` stands alone, and everything it
calls into `34`, `40` and `43` is a hoisted function.

| File | | What is in it |
|---|--:|---|
| `83_monthly_metrics.gs` | 708 | The `Metrics` tab: one stored row per calendar month, and the year-over-year block built on those rows rather than on `All_Registrants`. **The rule the file exists for:** a month whose registrant rows have been archived recounts to `null`, not to zero — overwriting a captured month with a count of nothing would report a collapse that never happened. It is the ONE tab in this workbook that is a record rather than a projection of the rows still on the other tabs, and `collapseOldPastMonths` is why it has to be. Counted through the same readers `43` uses, so the two blocks cannot disagree about what a registration is. Runs monthly (`captureMonthlyMetricsTrigger`, the 2nd at 4am) and on demand (`refreshMetricsTabNow`, under Settings & Fixes).<br><br>Its own `HEADERS.Metrics` key is spelled for the TAB, unlike the session table's — there is no second tab called `Metrics` for it to collide with. |

### Session rows left behind by a calendar (84)

Behavior only, numbered last for the usual reason: it declares no constant
anything else derives from, and everything it reaches for — `CALENDAR_MAP`,
`HEADERS`, `renderProgramDashboard`, `moveRegistrantsToTriage` — it reads at
CALL time or through a hoisted function declaration. It was `83` on its own
branch until the merge that brought the `Metrics` tab in; the prefix is all
that changed.

| File | | What is in it |
|---|--:|---|
| `84_orphaned_session_rows.gs` | 297 | **A calendar that left, not a date that did.** `triageDeletedSessions` (`43`) removes a session whose calendar EVENT went; by design it leaves alone any row it cannot attribute to a calendar it just read, which is what stops one unreadable calendar cancelling a location — and which also means a retired, recreated or repointed calendar leaves a residue nothing reaches, re-importing beside itself under the new ID. `findOrphanedSessionRows` is the pure split, scoped by `Calendar_Source` alone: a blank one is a lunch or hand-typed row and is never in scope, and a CONFIGURED calendar's rows never are either — nothing here reads a calendar, so a calendar that merely failed to load cannot be read as a retired one, which is also why this needs no size limit where triage does (a retired location legitimately IS most of the table). `describeOrphanedSessionRows` names each calendar ID in full with its rows, programs and date span, and is shared by `reportOrphanedSessionRows` (read-only, ungated) and the confirmation `removeOrphanedSessionRows` asks — menu-only, never a trigger, gated as `Remove Leftover Calendar Rows`. Registrants MOVE to `Deleted_Event_Triage` rather than being deleted, which is why `moveRegistrantsToTriage` (`26`) now takes optional wording: "the event is gone" would be a lie about a session whose event may still sit on a calendar we no longer read. The retired calendar's forms are left alone — a link already in circulation still opens. |

### Duplicate registrations (85)

Numbered after `84` for the usual reason — never renumber, and this landed
last. Safe there: its own constants stand alone,
its schema is `HEADERS.All_Registrants` in `03` like every other tab's, and
everything it calls — the tombstones (`28`), the name corrections (`77`), the
render and the two recounts — is a hoisted function.

| File | | What is in it |
|---|--:|---|
| `85_duplicate_registrations.gs` | 446 | **One person, one session, two rows** — the form plus a walk-in, a form submitted twice, two spellings of one name. Two rows are two seats against a capacity and two meals against a catering count, so `showDuplicateRegistrationsDialog` lists what looks like a duplicate and collapses only what somebody ticks: a REVIEW, not a sweep, because two rows for one name are usually a duplicate and sometimes two people, and nothing here can tell those apart. The key is deliberately GENEROUS, because a group somebody unticks costs a glance and a duplicate never offered costs a seat: the SESSION (`duplicateRegistrationSessionKey` — date + building + canonical title, falling back to Event_ID, so a form row and a door row on one class still pair up when an appointment day is typed as one event per slot or a `[Shared]` program one per building) + `Person_Type` with a blank read as Registrant (what the door writes) + the name worn down to first and last (`duplicateRegistrationNameKey` — the parenthetical off via `parseMemberName`, an earlier correction applied via `canonicalMemberName`, then accents, punctuation, suffixes, "Smith, Bob" and the middle name one form asks for and another does not). A `Cancelled` or `Superseded` row never groups with a live one, because "they cancelled and signed up again" is what `71` exists to keep. The merge is additive in every column (`mergeRegistrantRow`): marks OR-ed, meal counts MAXIMUM and never summed, notes joined, the most active status kept. What makes it stick is the pair at the end — a dropped row whose IMPORT key (`registrantImportKey` — Event_ID | spelling | Person_Type, which is stricter than the grouping key and is what `28` matches on) differs from the survivor's is tombstoned, since the next sync would otherwise write it straight back — that now includes a row on a second Event_ID, not only a second spelling — while a spelling difference also remembers the correction (`77`). Two rows sharing one import key need neither, and a tombstone there would suppress the row that was kept. |

### The office's one email a day (88)

Behavior only, and numbered last for the usual reason: its own constants stand
alone, it reads no other file's constants at load time, and its callers (`15`,
`33`, `66`, `70`) reach it through hoisted function declarations.

| File | | What is in it |
|---|--:|---|
| `88_office_daily_digest.gs` | 418 | **Everything the office is told, spooled, and sent once at ten.** The office was on four mailing paths at once — the per-sync digest (`15`), the per-category notices (`55`), a forwarded copy of every registrant reminder (`70`) and a BCC on every leader alert (`66`) — which on a busy day was forty messages, and forty messages is the same as none. `spoolOfficeNote()` is the one way anything reaches the office now: a section, a line, and the time, written to Script Properties as it happens (one property per chunk per day, because a value there is capped at 9KB; one WRITE per note and no read, because the day is held in memory). `sendOfficeDailyDigest()` is the 10am trigger — it sends every spooled day STRICTLY BEFORE today and deletes it, which is what makes a missed trigger cost nothing (Friday sends Tuesday and Wednesday, in two messages, each headed with its own day) and what stops a note written at 09:59 being split across two digests. The spool is cleared only once the message is away. Sent to EVERY address on Config's Admin Notification Emails table, ticked or not, and never rationed or paused — like `notifyAdmin` always was, and for the same reason.<br><br>**The same note twice is one line and a count** (`spoolOfficeNote` coalesces on section + message, keeping the first and last times), which is the difference between a digest of twelve lines and one that says the same twelve things two hundred times. **What does NOT wait** is `notifyAdminUrgent` (`15`) and its two callers only — a Quick Mark that would not save (`38`) and a door sign-in that did not complete (`72`) — because somebody is at the desk. Adding a third is a decision, not a detail. The per-category ticks on Config therefore govern only who gets those; four of the five route nothing now and their cell notes say so rather than pretending otherwise. |

### The public program calendar (86–87)

The one page in this project opened by somebody who is not staff, not at the
door, and not already registered — so the one that can be printed on a flyer.
Numbered last for the usual reason: both are behavior only, their own
constants stand alone, and everything they reach for (`HEADERS`,
`getSectionedRows`, `deskMonthHorizonKey`, the tag readers, `tryGetScriptCache`)
they read at CALL time or through a hoisted function declaration. `60`'s
`DOOR_ROUTES` gains a `public` entry that names them, which is lazy for
exactly this reason.

| File | | What is in it |
|---|--:|---|
| `86_public_program_calendar.gs` | 538 | **What is on, and the form to sign up with — for a stranger.** `publicProgramCalendar()` is the ungated read behind `?mode=public`: every session from today to the end of NEXT month (`deskMonthHorizonKey`, the same horizon the door's month picker uses), each carrying the CURRENT registration link for that session — which for a Regular program is the thing an emailed link is always wrong about a month later. It is safe to publish because of what `buildPublicSessionRow()` does NOT put in it: **no names, no counts of who, no `All_Registrants` read at all** — only what is already printed on a calendar event a member can see, plus whether there is room (`publicSeatsPhrase_`, exact at the bottom end and vague at the top: "3 seats left" changes an afternoon, "37 registered" is an internal number). Rows that must not be shown are dropped SERVER-side (past, beyond the horizon, untitled, `Cancelled`) — a filter in a public page's JavaScript is not a filter — and `publicSessionState_` resolves the four things a stranger can be told: sign up, join the waiting list, just come along (`No_Registration`), or not yet (the sessions are on the calendar but no form is generated, which is ordinary a month out). The link is read out of the `=HYPERLINK()` FORMULA in `Form_Response_Link`, because the cell's value is the words "View Live Form" — and for the same reason the TIME cannot be read out of its cell either: `Event_Time` is a formula (`setEventTimeFormulas`), so `publicSessionTimeLabel_` rebuilds the label from the row's own start and end rather than publishing `=IF(W9="",TEXT(…))` where the time should be. Each row also carries the `programKey` the page groups on (title + building) and the `shortLabel` its date chips are drawn with; a lunch-only row is renamed `Lunch` (`PUBLIC_LUNCH_PROGRAM_TITLE`) so lunch is one program per location instead of a tile a day called "Lunch Only (no program)". The snapshot also carries an `intro` — `CENTER_NAME` / `CENTER_PHONE` / `CENTER_EMAIL` from `04` (the same three the forms and the sign-in sheet print, so a changed number cannot be right on a form and wrong here), the one editable sentence `PUBLIC_CALENDAR_INTRO`, and the addresses of the buildings that actually have something on: this is the one page whose reader may not know whose calendar it is. Cached in CacheService for `PUBLIC_CALENDAR_CACHE_SECONDS` under a key with today's date in it — a TTL alone would go on offering yesterday as the first day past midnight. **No PIN, deliberately**: it writes nothing, and a page that asks a stranger for a staff code is a page that becomes a phone call.<br><br>**And the embed (17b), which is the same route and not a second page.** `?embed=1` takes the chrome off — no introduction, no background of its own, no sticky bar — so the calendar inherits the website around it, where a Google Calendar embed would otherwise sit in Google's own furniture and be unable to say whether there is a seat or open THIS month's form. `publicCalendarViewOptions` is the only thing read off the query string, and it changes how the page is DRAWN and nothing about what it contains: `?building=` pins the building and `?span=` the range — the same `?span=` the two printed links carry, read by the same `publicCalendarSpanRequested_`, so a spelling that works in a newsletter works in an iframe. A building the snapshot has never heard of is dropped rather than obeyed (an empty calendar on a website is the failure nobody reports, because it looks deliberate). `publicCalendarEmbedUrl` / `publicCalendarEmbedSnippet` build the `<iframe>` and the eleven-line resize listener staff paste into their site — the listener answers only its own frame and only `PUBLIC_CALENDAR_EMBED_MESSAGE`, and the iframe's own `height` is the fallback for a host that never hears it. |
| `87_public_program_calendar_html.gs` | 688 | `buildPublicCalendarHtml` — the served page, one template literal. **One TILE per PROGRAM, two to a row, not one card per date**: the tile names the program, says when it runs in one line (`scheduleLine` — "Tuesdays & Thursdays · 9:30 AM – 10:30 AM", or the count when the rhythm is not one), and carries its dates as chips, each its own link to that session's form (`+N more` for a long run). **The whole rectangle is the button** — a `role="button"` div rather than an `<a>`, because a browser will not honour an anchor nested in an anchor, with `tabIndex`/Enter/Space wired by hand and the chips' clicks stopped from reaching it. It opens the next date somebody can ACTUALLY get into (`leadOf`), which is the same rule the words follow: **"Join the waiting list" is said about a program only when every date in view is full** (`everyDateFull`) — a class with four open weeks and one full one is a class you can come to, and a tile labelled off its next date sends that person away from something that was theirs. The full dates are coloured amber instead (`.chip.full`), with a one-line legend on the tiles carrying both kinds. **Lunch is pinned** ahead of everything and drawn full width: it runs nearly every weekday at both buildings and in date order would sit wherever tomorrow happens to fall. Above the grid, the page introduces the centre from the snapshot's `intro` — name, sentence, a `tel:` link a thumb can dial, and the buildings with their addresses. **The whole two-month window is inlined**, so the first frame is the answer and the week / month / everything filters, the building filter and the search are arithmetic in the browser rather than a round trip apiece; the only server call is the quiet re-read after the first paint (and the Refresh control), which never redraws under a finger. `?span=week` / `?span=month` (resolved in `60` by `publicCalendarSpanRequested_`, written by `checkInPageUrl({ mode: 'public', span })`) only choose which filter is already pressed on open — which is what makes a weekly newsletter link and a monthly flyer link two addresses of one page rather than two pages. A tap marks the tile (or the chip) as opening in the same frame and the form opens in its own tab, so the calendar a person spent four taps filtering is still behind it. Everything from the workbook is written with `textContent` — the page uses no `innerHTML` with data in it at all — and the snapshot crosses into script through the same double-`JSON.stringify` every other page here uses. **Embedded (`?embed=1`), it also reports its own height** (`postMessage`, after every draw and through a `ResizeObserver`), which is what stops the scrollbar INSIDE the frame — on a phone, the gesture where somebody scrolls the calendar meaning to scroll the website and concludes the site is broken; a tile expanded to show the rest of its dates is exactly the case that needs it. The embed skin is written SERVER-side rather than switched on by a class the page's own script adds: a class added after the first paint is an introduction drawn, seen and then removed inside somebody else's website. A page with a pinned building also stores nothing, since the embed and the printed link share one origin and one storage key. `tests/public_calendar.test.js` pins the field list that may leave the workbook, the four states, the grouping, the time, the introduction, the two-column grid, the lunch pin, the whole-tile button and the waiting-list rule, the routing, which routes may be framed and what the embed pins; `tests/inline_pages_parse.test.js` compiles its script block, framed and unframed. |

### The public embeds and the weekly page (91–93)

The two pages that live on somebody ELSE'S website, and the property that
separates them from everything else this deployment serves: they may be
FRAMED. Numbered after `88`–`90` for the usual reason — never renumber, and
these landed last — and safely so: all three are behavior only,
`PUBLIC_EMBED_ROUTES` is lazy (`01a`), the mode, span and weekday constants
stand alone, and every page they name is a hoisted function.

| File | | What is in it |
|---|--:|---|
| `91_public_embeds.gs` | 442 | **The public router, the shared look, and the one place `ALLOWALL` is written.** `PUBLIC_EMBED_ROUTES` declares both public pages — `PUBLIC_CALENDAR_MODES` and `PUBLIC_CALENDAR_SPANS` / `publicCalendarSpanRequested_` moved here from `60`, plus `PUBLIC_REGULAR_MODES`, which deliberately does NOT claim 'weekly': `?span=weekly` already means the calendar's next seven days, and one word meaning two things across two links printed side by side is a link pasted wrong. `publicEmbedRoute` claims a request, `publicEmbedUrlMode` is what keeps a printed `?mode=` and this table together, and `servePublicEmbed` is where `XFrameOptionsMode.ALLOWALL` lives — it was a `frameable` flag on a row of `DOOR_ROUTES`, which is a property of the RESPONSE described on a page; every route left in that table writes to the workbook, so the permission now belongs to the file that only serves pages which cannot. Also `publicEmbedStyles()` / `publicEmbedSkinStyles()`, the stylesheet BOTH public pages are drawn on: transparent body (the website's own block colour is the page), white self-painting surfaces, black pill buttons, an outlined building chip, and **no `prefers-color-scheme` block** — the old one turned the text pale on a phone set to dark while the green block behind it stayed green, which is why the "3 programs · 12 dates · Refresh" line could not be seen. Plus `PUBLIC_LOCATION_COLORS` — the website's own two colours doing a job, green for Ashbridge and yellow for Narberth, keyed on the lower-cased building name and inlined into both pages by `publicLocationColorScript()`: the building's chip is FILLED in it and the tile carries a stripe of it down its edge, because on a screen of tiles "which one is at Narberth" is scanned rather than read. A building this map has never heard of keeps the neutral outline rather than borrowing a colour that means something else on the site. The pages take the width they are given (three tiles a row past 1100px, seven weekday columns on `93`), because an embed is read landscape on a laptop as often as portrait on a phone. And there is **no "Sign up" pill on a tile**: the whole tile is already the button, so that slot now carries only the states a tap cannot answer — no sign-up taken, no form yet, waiting list. Plus `publicRegularEmbedUrl` / `publicRegularEmbedSnippet`, the second page's own snippet with its own frame id, so a site embedding both grows two frames. |
| `92_regular_programs.gs` | 193 | **What runs every Tuesday, decided from the dates.** Nothing in this workbook stores "this is a weekly class" — the recurrence lives in the calendar — so `foldRegularPrograms_` reads it off the sessions: same weekday, gaps a whole number of weeks, smallest gap exactly one (the rule `detectProgramMonthRecurrence` in `78` uses, and for the same reason — a weekly class that misses a week has gaps [1, 2, 1]), at least `PUBLIC_REGULAR_MIN_SESSIONS` of them. Every OTHER week is deliberately not here, and neither is lunch (it runs nearly every weekday and is pinned on the calendar page already). Grouped on the server's own `programKey`, so a `[Shared]` Tuesday program stays two programs at two addresses and the two public pages cannot disagree about what one program is. Built by folding what `publicProgramCalendar()` already returned — one tab read, one cache, two pages — and its programs carry the calendar's own session rows untouched, so nothing new leaves the workbook. |
| `93_regular_programs_html.gs` | 464 | `buildPublicRegularHtml` — the served page, on `publicEmbedStyles()` and the same tile `87` draws (whole-tile button, date chips each carrying their own form, the waiting-list rule read across every date in view). **The week is COLUMNS** — one `.daycol` per weekday that has anything on (`repeat(auto-fit, minmax(190px, 1fr))`, so a centre that runs nothing on Sundays prints no Sunday), each headed **Every Monday** … **Every Sunday** with its programs stacked under it; folding to one column on a phone. The weekday is the column, so a tile's own line drops it and says the time and how many dates are left instead, and its date chips cut off at four rather than six because a tile here is a fifth of the screen wide. Takes the same `publicCalendarViewOptions` the calendar does — `?embed=1` and `?building=` mean the same thing on both pages — and reports its own height the same way, so a host frame grows instead of scrolling. `tests/regular_programs.test.js` pins what counts as regular, the field list, the routing, the embed pins and the framing; `tests/inline_pages_parse.test.js` compiles its script block. |
