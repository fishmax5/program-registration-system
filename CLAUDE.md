# CLAUDE.md — working in this repo

A Google Apps Script project bound to one Google Sheet. It reads Google
Calendars, generates and maintains a Google Form per program group, imports
responses into the workbook, orders lunch from them, and serves two web pages
to a tablet at the door. There is no framework, no build step, and no
`node_modules`: the deliverable is the `.gs` source itself.

## The one thing to know before editing

**Every `.gs` file at the root is ONE Apps Script project sharing ONE global
scope, and Apps Script evaluates the files in filename order.** The numeric
prefixes exist to make that order deterministic — they are not decoration.

A good number of top-level `const`s are computed from an earlier one
(`MANUAL_OVERRIDE_COLOR` from `PALETTE`, `LUNCH_ONLY_TYPE_TAG` from
`EVENT_TYPES`, `TIMEZONE` from the live spreadsheet). So:

- **Renumbering a file, or moving a top-level `const` to a later-sorting file,
  is a load-time `ReferenceError`, not a runtime bug.** It fails on open, for
  every user, with a dialog nobody can dismiss their way out of.
- Function *declarations* are hoisted across the whole project, so a function
  may freely call one defined in any other file. Only top-level
  initialization order is constrained.
- New file? Give it a prefix that puts it after everything it reads at load
  time. When in doubt, put constants low-numbered and behavior high-numbered.

## Where things are

Line counts are a rough guide to what you are about to load.

### Configuration and shared vocabulary (00–11)

| File | | What is in it |
|---|--:|---|
| `00_overview.gs` | 446 | Nothing but the project's header comment: every tab, the sync flow, the first-run path. **Read this first** — it is the cheapest orientation in the repo. |
| `01_logging_and_access.gs` | 209 | `log()`, the admin-only gate for destructive actions, and the "are you sure?" prompts. |
| `02_palette_and_tags.gs` | 827 | `PALETTE` and every color derived from it; `EVENT_TYPES`; the bracket tags (`Shared`, `Club`, `No Registration`, `Personalized Assistance`) and the regexes that recognize them in a calendar title. |
| `03_sheets_and_headers.gs` | 650 | `SHEET_NAMES`, `HEADERS` (the column list for every tab), legacy renames and header aliases, per-tab staff-owned column lists. **The schema.** |
| `04_settings_and_config.gs` | 368 | `CONFIG_LAYOUT` and the settings on the Config tab — meal buffers, order-ahead days, catering policy, link display, calendar invites, automation on/off — plus locations, addresses, and the forms Drive folder. |
| `05_form_template.gs` | 994 | `TEMPLATE_VERSION` and the shape of the generated Google Form: item titles, page titles, the roster grid, attendance-mode choices, guests, extra meals, and the page navigation helpers every form-shaping path writes through (`setNavigationAfterPage`). **Bump `TEMPLATE_VERSION` when the form's structure changes — page navigation counts.** |
| `06_registries_and_locks.gs` | 148 | The groupKey→Form_ID registry in Script Properties, the all-dates registry, template-version tracking, and the script locks. |
| `07_dates_and_labels.gs` | 589 | `TIMEZONE`, date formatting, and the capacity/meal hints a form's date label carries. |
| `08_execution_caches.gs` | 293 | The per-execution memo caches the sync hot paths use, and their invalidation. |
| `09_lunch_schedule_lookup.gs` | 393 | Reading `Lunch_Schedule` by date × location. |
| `10_form_date_labels.gs` | 723 | Fingerprinted writes of date labels onto a live form (`applyFormDateLabels`). |
| `11_menu_items_paste.gs` | 1103 | Adding menu items to `Lunch_Schedule` — paste CSV, in the sheet or a dialog. |

### Building the workbook (12–15)

| File | | What is in it |
|---|--:|---|
| `12_sheet_setup.gs` | 213 | `initSheet` and the `Lunch_Schedule` tab's own setup. |
| `13_lunch_only_signup_form.gs` | 998 | The lunch-only sign-up form — the one form built from `Lunch_Schedule` rather than the calendar. |
| `14_saved_column_widths.gs` | 462 | "This column should be this wide, always." |
| `15_config_sheet.gs` | 923 | Drawing and validating the Config tab. |

### Menus, triggers, and edits (16–18)

| File | | What is in it |
|---|--:|---|
| `16_menu_and_triggers.gs` | 574 | `onOpen`, the menu tree, trigger installation. |
| `17_trigger_attribution.gs` | 371 | "Who is actually firing this handler?" — duplicate-account detection and trigger status. |
| `18_edit_handlers.gs` | 1621 | `onEdit` and everything downstream: dashboard edits, program-flag edits and how they spread to sibling rows and back onto the calendar description, Config edits, Registrants edits, catering recount. |

### Calendar → forms (19–26)

| File | | What is in it |
|---|--:|---|
| `19_calendar_incremental_sync.gs` | 245 | `onCalendarChange` and sync tokens. |
| `20_calendar_sync.gs` | 341 | `syncCalendars` — the entry point and its shape. |
| `21_description_tag_readers.gs` | 824 | What the system reads out of a calendar event's description, and the tag inspector. |
| `22_renamed_programs.gs` | 687 | A title change that must not cost you the roster: detection and the rename map applied across every tab and ledger. |
| `23_reconcile_sessions.gs` | 993 | Reconciling session times, assistance settings, club tags, No-Registration effects, and the registration horizon against the calendar. |
| `24_calendar_groups.gs` | 516 | `buildEventGroups` / `processCalendarGroup` — grouping events into the thing that gets one form. |
| `25_bootstrap.gs` | 526 | `bootstrapCalendars` — the sliced first import, for setups too large for one execution. |
| `26_event_descriptions.gs` | 1050 | Stripping every registration link out of an event description and writing exactly one back. |

### Responses → the workbook (27–33)

| File | | What is in it |
|---|--:|---|
| `27_registration_import.gs` | 398 | `syncRegistrations` — the entry point. |
| `28_deletion_tombstones.gs` | 433 | Why a deleted registration stays deleted. |
| `29_form_response_processing.gs` | 561 | `processFormResponse` — one response into registrant rows, guests and meals included. |
| `30_registry_counts.gs` | 144 | Active / waitlist / remaining-seat counts. |
| `31_form_shape_and_migration.gs` | 383 | Is a live form still on the current template, and migrating it if not. |
| `32_dashboard_link_repair.gs` | 1256 | Every way a registration link drifts from its session, diagnosed and repaired. |
| `33_calendar_invitations.gs` | 426 | Registrants as guests on the real calendar event. |

### Tabs the staff work in (34–42)

| File | | What is in it |
|---|--:|---|
| `34_sectioned_tables.gs` | 608 | The Upcoming/Past split every date-bearing tab uses. **The sectioned reader is used everywhere — change it carefully.** |
| `35_per_sheet_render.gs` | 102 | Per-sheet render wrappers. |
| `36_quick_mark_dialog.gs` | 999 | Quick Mark, the sign-in desk tool on the menu. |
| `37_regular_needs.gs` | 586 | The standing notes a desk would otherwise have to memorize. |
| `38_quick_mark_index.gs` | 1739 | The cached index Quick Mark and the door pages both read, plus walk-ins and lunch-only sessions. |
| `39_triage_sheet.gs` | 387 | Sessions the calendar stopped mentioning. |
| `40_memory_tabs.gs` | 503 | `Member_Roll` / `Program_Options`, and the shared writer every staff-authored tab is drawn with (`writeMemoryTab`, `readSimpleTable`, the spare validation band). |
| `41_club_rosters.gs` | 448 | `Club_Members`. |
| `42_legacy_tab_merge.gs` | 381 | Merging tabs from older layouts. |

### Dashboards and printed output (43–46)

| File | | What is in it |
|---|--:|---|
| `43_program_dashboard.gs` | 552 | `renderProgramDashboard`. |
| `44_lunch_dashboard.gs` | 1124 | `updateMasterLunchDashboard` and the catering counts. |
| `45_sign_in_sheet.gs` | 646 | The landscape PDF to mark up by hand. |
| `46_program_leader_sheets.gs` | 1305 | A live roster shared out of the workbook to a program leader, banded by session. |

### Repair and last resorts (47–51)

| File | | What is in it |
|---|--:|---|
| `47_moving_sessions.gs` | 506 | Combine forms, or just repoint a link. |
| `48_deleting_registrations.gs` | 397 | `showDeleteRegistrationsDialog`. |
| `49_form_rebuild.gs` | 827 | Destroy and rebuild forms — the Admin-menu last resort, sliced across executions. |
| `50_deleted_form_recovery.gs` | 450 | A form that was deleted out of the Drive folder. |
| `51_form_link_doctor.gs` | 557 | One screen for every way a link goes wrong. |

### Appointments and custom questions (52–55)

| File | | What is in it |
|---|--:|---|
| `52_appointments_and_slots.gs` | 447 | Slot arithmetic, appointment choice labels, booked-time reads. |
| `53_program_questions.gs` | 507 | The `Program_Questions` tab parsed into form items, and its refusals. |
| `54_custom_questions.gs` | 439 | Putting those questions on a form and taking them back off — fingerprints and applied-title tracking. |
| `55_assistance_sync_and_images.gs` | 1592 | Refreshing appointment slots across forms, appointment responses, the assistance report, and form images. |

### Reviews (56–59)

| File | | What is in it |
|---|--:|---|
| `56_time_blocks.gs` | 534 | Collapsing a day of time blocks into one event. |
| `57_program_type.gs` | 142 | "What kind of program is this?" — one answer instead of four. |
| `58_program_review.gs` | 1915 | Decide programs one at a time, apply them all at once. |
| `59_appointment_review.gs` | 1559 | One month, one location, one form. |

### The door (60–64)

| File | | What is in it |
|---|--:|---|
| `60_check_in_page_server.gs` | 985 | `doGet`, the PIN gate, the roster read, and the mark/register handlers. |
| `61_check_in_page_html.gs` | 1195 | `buildCheckInHtml` — the whole served page, one template literal. |
| `62_walk_in_page.gs` | 1253 | The sign-in page for people who never registered. |
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
| `65_program_leaders.gs` | 513 | The `Program_Leaders` tab: who leads what, their addresses, their notification ticks — and the one-time migration that carries `Program_Options`' old `Instructor_Email` column onto it. |
| `66_program_leader_notifications.gs` | 600 | Roster-change alerts: the stored per-program snapshot, the diff against it, and the one email per leader per sync that comes out of it. |

### Two months at the door (67)

| File | | What is in it |
|---|--:|---|
| `67_desk_month_sessions.gs` | 130 | `deskMonthSessions` — every session at one location from today to the end of NEXT month, grouped by day. The live read behind the day picker and the session boxes on both tablet pages (`61`, `62`), and behind the club place a walk-in can take at the door. Behavior only; nothing earlier reads it at load time. |

### Migrations (68)

| File | | What is in it |
|---|--:|---|
| `68_form_state_migrations.gs` | 387 | `FORM_STATE_MIGRATIONS` — the registry of in-place repairs that carry a LIVE form from the shape it was built with to the shape the code now expects, without rebuilding it; the ledger of which have run on which form; the hourly sweep (`runFormStateMigrations`, ahead of `migrateFormsToCurrentTemplate`); and the Admin item that forces it now. Behavior only, loading after everything it reads. |

### Links to the files this system makes (69)

Numbered last for the usual reason: it is behavior only, and its own
constants are the only ones it defines, so nothing earlier reads it at load
time. Its two columns live in `03` like every other schema.

| File | | What is in it |
|---|--:|---|
| `69_generated_file_links.gs` | 236 | Live links to the files this system makes outside the workbook: the printed sign-in PDF registry (and its one-time folder backfill), and the `Leader_Sheet_Link` / `Sign_In_Sheet_Link` columns the dashboards and `Registrant_Dash` stamp on every render. |


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
  revision in the form's history. Rebuilding the form is the fallback for a
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

`tests/helpers/source.js` sorts by filename — the same rule the Apps Script
runtime applies — so a test sees exactly the load order production does.

**Known pre-existing failure:** `tests/appointment_review.test.js` reports 2
failures ("duplicate rows do not duplicate the times", "and the escape hatch is
still last"). It predates the split into multiple files; every other test
passes.

## Deploying

**There is no build step. The numbered `.gs` files ARE the deliverable**, and
they go into the Apps Script project unchanged — via a GitHub-sync browser
extension in the editor, or `clasp push`.

The only invariant that matters on the way in is that **filenames survive
intact**, because the prefixes are the load order (see the top of this file).
Do not rename a file to fit a deployment, and do not merge files to reduce
their number.

`tools/bundle.js` still exists and still works — it writes a single
`Code.bundle.gs` for a one-off paste-install where neither of the above is
available. It is not part of the normal loop: **do not run it as a build step,
and do not treat its output as the source.** `Code.bundle.gs` is gitignored;
edits belong in the numbered files.
