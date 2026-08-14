/**
 * ============================================================================
 *  🗓️  CALENDAR & FORM MANAGER  —  Program Registration + Lunch Ordering
 * ============================================================================
 *  Sheets:
 *    - Master_Program_Dashboard : "Today at Each Location" + participation
 *      metrics + the full per-session table, now split into an "Upcoming
 *      Sessions" sub-table and a "Past Sessions" sub-table (see section 7).
 *      The session table no longer carries a Manual_Override column — it's
 *      fully calendar-derived every render (Location/Type_Tag stay
 *      editable dropdowns, but nothing on this table is protected from a
 *      deleted-event triage sweep or a counts recompute anymore). Event_Date
 *      is the first column, and the old separate Month column has been
 *      replaced everywhere by simply color-tinting the Event_Date cell
 *      itself (see getMonthColor()/applyMonthColorTint()).
 *    - Master_Lunch_Dashboard   : "Today's Lunch Needs" (unchanged, always
 *      at the very top) + the full catering schedule, now likewise split
 *      into "Upcoming Lunch Schedule" / "Past Lunch Schedule" sub-tables.
 *      Every row is one date PER LOCATION, so the row itself is tinted by
 *      location (LOCATION_COLOR_MAP / buildLocationRowTintRules()) — except
 *      the month-tinted Event_Date cell and the yellow hand-entry columns,
 *      which keep their own meaning.
 *    - Lunch_and_Event_Registrants : one row per person per session, split
 *      into "Upcoming Registrants" / "Past Registrants" sub-tables. Leads
 *      with Event_Date (like every other date-bearing tab), then Location
 *      and Event so staff never scroll to see which program a row belongs
 *      to, keeps Manual_Override and Order_Ahead_Flag, and trails with
 *      Party_ID (an internal grouping key — see Party_ID/Party_Size below)
 *      as the very last column. Re-ordering a HEADERS array no longer
 *      scrambles data already on the tab: readAllSectionedRows() re-aligns
 *      each row by header NAME (see buildHeaderProjection()).
 *    - Lunch_Schedule           : the day-by-day catering menu, now broken
 *      down PER LOCATION (one row per Event_Date x Location), with a
 *      "Not Serving" Type option — when a form covers a date that's marked
 *      Not Serving for its location, that date is dropped from the lunch
 *      grid entirely (no lunch choice offered) and its label is annotated
 *      "No Lunch Served" wherever it's shown. Also split into
 *      Upcoming/Past sub-tables like every other date-bearing tab.
 *    - Config                   : Meal Buffer Amounts (Location x Hot/Cold
 *      only — "Not Serving" never gets a buffer row) + Order Ahead Time +
 *      an optional Admin Notification Email + Lunch Service by Location +
 *      Automation & Trigger Ownership (the kill switch and the trigger
 *      owner — see the multi-account note below). Unaffected by the
 *      Upcoming/Past split (it's a settings tab, not a per-date log).
 *    - Deleted_Event_Triage     : same Upcoming/Past split + Event_Date
 *      first-column/month-tint treatment as Lunch_and_Event_Registrants.
 *
 *  Notable behaviors:
 *    - All-day calendar events are skipped entirely.
 *    - Calendar-edit triggers are still torn down for the duration of every
 *      FULL syncCalendars() run and rebuilt immediately after (that sync
 *      itself edits calendar descriptions and would otherwise risk
 *      re-triggering itself). The trigger handler itself, onCalendarChange(),
 *      no longer always runs a full syncCalendars() though — see below.
 *    - CALENDAR INCREMENTAL SYNC: onCalendarChange() now uses the Calendar
 *      API's incremental-sync-token pattern (Calendar.Events.list with a
 *      saved syncToken) to fetch ONLY what changed since the last check,
 *      and only escalates to a full syncCalendars() reconciliation pass
 *      when that cheap delta actually contains something relevant (a new/
 *      modified/cancelled timed event in our tracked window). This requires
 *      the "Calendar" Advanced Service to be enabled on this Apps Script
 *      project (Editor -> Services -> + Calendar API) — see SETUP below.
 *    - EVENT GRAMMAR — the TITLE is just the program name; every SETTING
 *      lives in the event DESCRIPTION, in brackets:
 *        Title "Yoga Basics"           + description "[Cap: 12]"  -> capped at 12
 *        Title "Yoga Basics"           + description "[Grouped]"  -> one continuous
 *          series with ONE form, instead of a separate form per month
 *        Title "Yoga Basics"           + description "[Monthly]"  -> a form per
 *          calendar month (the default, so this is only ever explicit intent)
 *        description "[Cap: 12, Grouped]" or "[Cap: 12] [Grouped]" -> both
 *        description "[All Locations]"  -> this event's sessions share ONE
 *          form with the same-titled sessions on EVERY other calendar,
 *          instead of one form per location. Composes with the above:
 *          "[Grouped, All Locations]" is one form for the whole series
 *          everywhere; "[Monthly, All Locations]" is one form per month
 *          everywhere. Also spelled [Shared] / [All Sites] / [Combined] /
 *          [Multi-Site]. See SHARED_LOCATION_SCOPE, and the menu action
 *          "🔗 Link Program Across Locations…" which tags every location's
 *          events and moves the sessions already on the dashboard onto one
 *          form in a single step.
 *      [Fixed] and [Regular] are still read as [Grouped] / [Monthly], so no
 *      existing calendar description needs editing — see EVENT_TYPES.
 *      A title is what attendees read on a shared calendar, so scheduling
 *      jargon does not belong there. Brackets left in a TITLE are still
 *      honored as a legacy fallback (and logged) so existing calendars keep
 *      their capacity; see parseSettingsBrackets()/resolveEventSettings().
 *        Title "*Yoga Basics"          -> TENTATIVE. A leading "*" means the
 *          session isn't confirmed: no form is generated and no registry
 *          row is written, until the asterisk comes off. parseEventTitle()
 *          strips the asterisk from cleanTitle, and since computeEventId()
 *          keys off cleanTitle, confirming an event later produces the
 *          SAME Event_ID — it just flows through as a new session with no
 *          reconciliation. (Re-adding an asterisk to an already-confirmed
 *          event does NOT triage it; existing registrations are kept.)
 *          The asterisk is also how a CANCELLED occurrence is marked: an
 *          event named "*NO Tai Chi" stays visible on the calendar for
 *          staff and attendees while generating no form and no dashboard
 *          row.
 *    - THE REGISTRATION LINK injected into each event description is an
 *      HTML ANCHOR, not a raw URL, and carries no visible Form ID. The ID
 *      rides in the href's #fragment — invisible to the reader, ignored by
 *      Forms, still machine-recoverable so a lost form registry can be
 *      rebuilt instead of spawning duplicate forms. See
 *      buildRegistrationLinkLine()/findRegistrationLineInDescription().
 *    - REGISTRATION LINKS ARE PLAIN published form URLs, with nothing
 *      pre-ticked. They used to be prefilled with every box checked, on the
 *      theory that "all of us, all dates" is the common case — but a
 *      pre-ticked box asserts an answer on the respondent's behalf, and
 *      somebody who skims and submits has told us they are coming to
 *      sessions they never read. The "sign up for every date" option covers
 *      that case as an answer somebody actually gives. See
 *      buildRegistrationUrl().
 *    - PER-LOCATION CATERING POLICY (Config -> "🍽️ Lunch Service by
 *      Location") is what keeps the lunch dashboard from filling with blank
 *      rows. Before it existed the only way to say "Zoom never serves lunch"
 *      was a per-date "Not Serving" row for every Zoom date forever, so in
 *      practice those dates read as merely unconfigured — seeded onto the
 *      dashboard AND asked about on forms. The three postures:
 *        Always        lunch unless a date says otherwise (a catering site)
 *        By exception  only dates with a real Hot/Cold row on Lunch_Schedule
 *        Never         no lunch at all — the location never reaches the
 *                      lunch dashboard, and createRegistrationForm() strips
 *                      both lunch questions off its forms entirely
 *      See isLunchOfferedOn(), which is the single place policy and the
 *      per-date override are reconciled.
 *    - THE LUNCH DASHBOARD LISTS EVERY UPCOMING date x location where lunch
 *      is on the table, even at zero registrants, so staff can plan against
 *      (and hand-enter buffers on) dates nobody has signed up for yet. Past
 *      dates are never back-seeded.
 *    - DEMAND ALWAYS WINS over policy. Policy only decides what gets SEEDED;
 *      a date somebody is actually registered to eat on always appears, and
 *      if no Hot/Cold menu backs it, the admin digest says so. That is the
 *      safety net for "By exception" — forgetting a menu row can leave a
 *      date off the plan, but never off the plan once a real person is
 *      expecting to be fed.
 *    - ADMIN NOTIFICATIONS: set an address in Config to get ONE digest per
 *      sync covering only things needing a human — waitlisted registrants,
 *      forms that couldn't be opened, events sent to triage. A sync with
 *      nothing to report sends nothing. Blank address = disabled.
 *    - ONE FORM TEMPLATE, ONE BRANCH POINT. Every group — Grouped or Monthly
 *      — is built from the same template, and "Attendance Mode" is now on
 *      every form:
 *        "Everyone, every date"          -> one checkbox of who eats, applied
 *          to every session date, including dates added to a Grouped series
 *          afterward (see the ALL_DATES registry + applyAllDatesCatchup()).
 *        "Let me pick specific dates/people" -> the two roster grids,
 *          "Who is Attending Each Date?" and "Who Needs Lunch Each Date?",
 *          with dates as ROWS and PERSON_COLUMN_LABELS as COLUMNS. Full
 *          per-person, per-date resolution: any guest can attend/skip/eat
 *          independently of any other. Checking lunch WITHOUT attendance is
 *          not silently dropped — processFormResponse() reconciles it as
 *          attending and flags it in Admin_Notes.
 *      There is NO "how many guests?" question: page 1 has three optional
 *      guest-name fields and the headcount is simply how many were filled
 *      in. That kills two bugs by construction — the old "said 3, named 2,
 *      catered for 2" mismatch, and mis-routing between guest-count branch
 *      pages (Forms silently falls through to the NEXT section when an
 *      explicit after-section jump isn't applied, which is how picking 2
 *      guests could land you on the 3-guest page). The whole form now has
 *      exactly two page breaks and two navigation rules, both to SUBMIT.
 *      A grid column whose guest name was left blank is ignored at parse
 *      time, so the pre-checked columns for guests you didn't bring cost
 *      nothing.
 *    - OUR OWN CALENDAR EDITS MUST NOT COME BACK AS WORK. Removing the
 *      calendar-edit triggers during a sync stops them FIRING, not the
 *      changes accumulating — so re-creating them afterwards handed
 *      onCalendarChange() one queued description write per event, each of
 *      which escalated to a full syncCalendars(). An import of 272 events
 *      became a queue of full syncs. primeCalendarSyncTokens() now advances
 *      each calendar's sync token past our own edits immediately before the
 *      triggers go back on (in syncCalendarsInternal()'s finally, and at the
 *      end of a bootstrap).
 *    - TRIGGERS ARE RESET, NOT PATCHED. writeTriggers() used to add a
 *      trigger only if none existed, which cannot clean up a duplicate once
 *      one is there. The real-world case: Apps Script installable triggers
 *      are private to the Google account that created them, so a second
 *      person running "Check Triggers"/initSheet() from their own login
 *      creates a SECOND, mutually invisible set of calendar-edit triggers —
 *      both then fire on every edit, forever. writeTriggers()/
 *      writeCalendarChangeTriggers() now delete every trigger for a managed
 *      handler THIS ACCOUNT can see and recreate exactly the intended set,
 *      every time — see resetTriggersForHandler(). That fixes same-account
 *      duplication outright; cross-account duplication needs a human to
 *      open the Apps Script editor's Triggers page (which — unlike the
 *      API — lists every trigger regardless of creator) and delete the
 *      other account's copies, and to agree only one account manages
 *      triggers going forward.
 *    - MULTI-ACCOUNT TRIGGER COORDINATION. "Agree only one account manages
 *      triggers" is not something an agreement can enforce, so it is now
 *      enforced in code. Three parts, in Config's "⚙️ Automation & Trigger
 *      Ownership" section and in section 3a:
 *        1. WHERE THE SECOND SET ACTUALLY CAME FROM. It was mostly not
 *           "Check Triggers" — that's admin-gated and rarely pressed.
 *           syncCalendarsInternal() tears the calendar-edit triggers down
 *           and rebuilt them in its `finally`, and syncCalendars() is
 *           deliberately UNGATED (top menu item, used daily by anyone with
 *           edit access). So every "Sync Cal" click by a non-owner removed
 *           nothing and then created a whole set under that account. That
 *           finally is now RESTORE-ONLY: an account that held none before
 *           the sync ends with none.
 *        2. Trigger_Owner records the one account allowed to build
 *           triggers. writeTriggers() and bootstrapCalendars() refuse from
 *           anyone else and name the owner, so an account that cannot see
 *           the triggers at least learns who to ask. Moving it is a
 *           deliberate act (takeOverTriggerOwnership()) that says plainly
 *           it cannot delete the old owner's copies.
 *        3. Automation_Enabled is a kill switch every managed handler reads
 *           first. Script-level state is shared across accounts even though
 *           triggers are not — so this is the only lever that reaches a
 *           trigger you have no power to delete. It cannot remove the
 *           duplicate, but it stops it firing, from any account, without
 *           editor access.
 *      And because all of that is still bookkeeping that can be bypassed by
 *      running a function straight from the script editor, recordHandlerRun()
 *      stamps who each handler ACTUALLY ran as (an installable trigger runs
 *      as its creator). Two accounts seen firing one handler is duplicate
 *      sets, observed rather than inferred — "Admin → Trigger Status" shows
 *      that next to what this account can see and what Config claims, and it
 *      is the disagreement between the three that identifies the problem.
 *    - TRIAGE DISTRUSTS ITSELF. triageDeletedSessions() is the only thing
 *      that removes sessions, and "the calendar didn't come back" used to
 *      read identically to "every session was deleted." It now ignores
 *      calendars it could not READ, ignores rows it cannot attribute to one
 *      it did read, refuses any sweep that would take out most of the table
 *      (TRIAGE_MAX_SESSIONS_PER_RUN / TRIAGE_MAX_FRACTION_PER_RUN, overridden
 *      once by confirmLargeTriage()), and stands down entirely while a
 *      bootstrap import is writing the table. restoreTriagedRegistrants()
 *      puts rows back if a sweep did fire wrongly — necessary because the
 *      import only reads responses newer than the last sync, so a triaged
 *      registrant exists nowhere else.
 *    - THE FIRST IMPORT IS A SLICED JOB, NOT A SYNC. syncCalendars() is cheap
 *      only because it normally has nothing to do. Importing a real calendar
 *      from scratch — a form per program, a description write per event —
 *      does not fit in one six-minute execution, and a timeout there is
 *      destructive: no `finally` runs, so the calendar triggers stay removed
 *      and the persistent form registry never gets flushed (which duplicates
 *      forms on the next attempt). bootstrapCalendars() (section 4b) pauses
 *      every trigger, imports in budgeted slices that hand off to each other
 *      via one-off triggers, and rebuilds the triggers only when it's done.
 *      syncCalendars()/syncRegistrations() stand down while it runs, and
 *      writeTriggers() refuses to put the paused ones back until it
 *      finishes — a pause is only as good as the paths that can undo it, and
 *      an import that spans half an hour gives "Check Triggers" plenty of
 *      chances. Each slice re-asserts the pause as well.
 *    - LIVE FORMS ARE MIGRATED, NOT JUST THE TEMPLATE. A group's form is
 *      created once and reused for as long as the group runs, so bumping
 *      TEMPLATE_VERSION only ever fixed forms created afterward — everyone
 *      filling in an existing form still met the old questions (and the old
 *      mis-routing). migrateFormsToCurrentTemplate(), which runs at the end
 *      of every syncRegistrations() import, rebuilds any form still on an
 *      older template IN PLACE, keeping its Form ID so every link, registry
 *      entry and calendar description stays valid. Forms already on the
 *      current template are stamped and thereafter skipped without an API
 *      call. Run recheckAllRegistrationForms() from the editor to force a
 *      re-check (e.g. after hand-editing a form).
 *    - NO LUNCH MEANS NO LUNCH QUESTION. The lunch grid only ever lists
 *      dates that actually serve lunch (buildDateLabelSets()), and when NO
 *      date on a form does — or the location never caters —
 *      syncLunchQuestionsOnForm() takes both lunch questions off the form
 *      entirely and says so in the description. They come back on their own
 *      if a catered date later appears. On the data side buildRegistrantRow()
 *      gates lunch demand on isLunchOfferedOn(), so the "everyone, every
 *      date" branch's single who-eats answer can't book a meal on a
 *      Not-Serving date.
 *    - The template calls setCollectEmail(true) and
 *      setAllowResponseEdits(true) — a submitter's email becomes a real
 *      identity key, Google auto-sends a receipt with an edit link, and
 *      Form_Source on Lunch_and_Event_Registrants links straight to that
 *      person's own submission (response.getEditResponseUrl()) instead of
 *      to the shared form editor.
 *    - Allergies / dietary needs is its own required-free text field,
 *      separate from the free-text "Anything Else?" catch-all — previously
 *      a single "Footer Note" paragraph item did double duty as both
 *      display text and the admin-notes scan target. The per-location
 *      note itself is now a non-input SectionHeaderItem.
 *    - Party_ID (= the Google Form response ID) and Party_Size (headcount
 *      including the registrant) are stamped on every row from the same
 *      submission, so staff can see "party of 3, one no-show" at a glance
 *      on Lunch_and_Event_Registrants.
 *    - Name-based identity (dedup / manual-edit protection / the "sign up
 *      for all dates" registry) is matched case/whitespace-insensitively
 *      via normalizeNameKey() — "Jane Smith" and "jane smith " are the same
 *      person. The Name column itself still displays exactly as typed.
 *    - RESUBMISSIONS ARE APPLIED, NOT DROPPED: buildRegistrantRow() keys
 *      identity on Event_ID+Name+Person_Type, same as before, but now also
 *      tracks each row's Party_ID (the originating Response ID). A response
 *      re-seen under the SAME Party_ID (an edit via the "edit response"
 *      link — see setAllowResponseEdits(true) above) patches that one row
 *      in place. A DIFFERENT Party_ID for the same identity — a genuinely
 *      new submission — marks the old row Program_Status/Lunch_Status =
 *      'Superseded' (kept, not deleted, with a note in Admin_Notes) and
 *      inserts the new row as the live truth. 'Superseded' rows are
 *      excluded from every active/waitlist count automatically, the same
 *      way 'Cancelled' already was.
 *    - CAPACITY IS VISIBLE ON THE FORM: whenever a capped session hits 0
 *      Remaining_Seats, its date label on both roster grids gets a
 *      CAPACITY_HINT_SUFFIX ("(FULL - Waitlist)") appended — see
 *      buildCapacityHintsFromRegistryRows() / refreshFormCapacityLabelsForAllForms(),
 *      called at the end of every syncRegistrations() once Remaining_Seats
 *      is fresh. Converts silent waitlisting into something a respondent
 *      actually sees before submitting. A plain hyphen is used (not the em
 *      dash meal-hint separator) so stripMealHint() can strip both
 *      unambiguously when matching a grid row back to its Event_ID.
 *    - Template forms are cached forever in Script Properties, keyed by
 *      TEMPLATE_VERSION — bump that constant whenever the template
 *      structure changes so existing cached forms don't silently drift out
 *      of sync with the parser.
 *    - Form descriptions list dates one-per-line.
 *
 *  PERFORMANCE / CACHING CONTRACT (see section 1c):
 *    Everything expensive in a sync is a REMOTE call — a Sheets read, a
 *    FormApp call, a CalendarApp fetch, a Script Properties round trip — so
 *    the optimization work is all about not making the same one twice.
 *      - Per-EXECUTION caches (Apps Script globals, which die with the run,
 *        so there is no cross-run staleness to reason about): the
 *        Lunch_Schedule meal index, Config's meal buffers + order-ahead
 *        days, per-form item lookups, and the calendar event fetch. Each is
 *        dropped by whatever rewrites its source — invalidateMealInfoIndex()
 *        from renderLunchScheduleSheet(), invalidateConfigCaches() from
 *        buildConfigSheet(), invalidateFormItemIndex() from
 *        applyFormDateLabels(), invalidateCalendarEventsCache() from the
 *        calendar-delta handler. ADD A NEW CACHE ONLY WITH ITS INVALIDATOR.
 *      - Batched Script Properties: the form registry, the all-dates
 *        registry, and the form-label fingerprints are read once and written
 *        at most once per run via flushPersistentRegistries(), called as
 *        soon as each dirtying loop finishes rather than at the very end.
 *      - Fingerprinted form writes: applyFormDateLabels() hashes the labels
 *        it is about to write and skips the entire FormApp round trip when
 *        they match what this script last wrote to that form. Since the
 *        hourly capacity-label refresh normally has nothing to change, the
 *        common case costs zero Forms calls. The fingerprint only tracks
 *        THIS script's writes — a hand-edited form is not detected until
 *        the labels legitimately change again (pass { force: true }).
 *      - Rows already in memory are threaded, not re-read: syncRegistrations()
 *        reads each tab once and hands the rows to the count recompute, the
 *        dashboard render, and the lunch rollup. renderProgramDashboard()
 *        reports registrantsMoved back so a caller knows when its copy went
 *        stale under a triage sweep.
 *    Bulk sheet WRITES were already batched (one setValues/setBackgrounds/
 *    setFormulas per block, never a per-cell loop) — keep it that way.
 *
 *  SETUP:
 *    1. Update CALENDAR_MAP below with your real Calendar IDs -> locations.
 *    2. In the Apps Script editor: Services (+) -> add "Google Calendar API"
 *       (the Advanced Service — this is required for the incremental
 *       calendar-edit sync in section 3b; without it, onCalendarChange()
 *       will fail with "Calendar is not defined").
 *    3. Run initSheet() once (from the editor) to build all tabs, formatting,
 *       AND the triggers.
 *    4. Fill in the Lunch_Schedule tab (now one row per date PER LOCATION)
 *       and Config's Meal Buffer Amounts + Order Ahead Time.
 *    5. Reload the sheet to see the "🗓️ Calendar & Form Manager" menu.
 *    6. FIRST IMPORT: use "Import Everything (First Run)" in that menu
 *       (bootstrapCalendars()), NOT "Sync Cal". The first import has to
 *       build a form for every program on every calendar, which is far more
 *       than one Apps Script execution can do — the bootstrap slices it
 *       across as many runs as it takes and pauses every trigger until it's
 *       finished. See section 4b. initializeAndSyncAll() does steps 3 and 6
 *       in one go.
 * ============================================================================
 */

// ============================================================================
// 1. GLOBAL CONFIGURATION & HELPERS
// ============================================================================

const ENABLE_LOGGING = true;

/** Central logger — no-op when ENABLE_LOGGING is false. */
function log(msg) {
  if (ENABLE_LOGGING) console.log(msg);
}


// ============================================================================
// 1a. ADMIN-ONLY GATE  (structural/destructive actions)
// ============================================================================
//
// Apps Script installable triggers belong to whichever Google account
// created them, invisibly to every other account — that's what let a second
// person's "Check Triggers" click spawn a whole extra, undetectable set of
// calendar-edit triggers (see writeTriggers()'s own doc comment). Resetting
// triggers on every run fixes the symptom for whichever account presses the
// button; this is the cause fix — keep the button out of reach of every
// account except the ones meant to hold it.
//
// Gated here are the STRUCTURAL/DESTRUCTIVE entry points: anything that
// rebuilds tabs, creates/deletes triggers, runs the multi-slice calendar
// import, or overrides a safety limit. Left UNGATED on purpose: the routine
// syncCalendars()/syncRegistrations() triggers and the onEdit/onOpen simple
// triggers — those need to keep running no matter which account's session
// happens to be open, and they already have their own safety nets (the
// triage size limit, the bootstrap-active checks, sync-token priming).
// ============================================================================

/**
 * Google accounts allowed to run a structural/destructive action. Edit this
 * list to change who holds admin access — nothing else in the code needs to
 * change. An empty list means NOBODY can (fails closed, not open).
 */
const AUTHORIZED_ADMIN_EMAILS = [
  'admin@newhorizonsseniorcenter.org'
];

/**
 * The Google account this specific execution is running as. Session.getEffectiveUser()
 * is who the code's side effects are attributed to — for a menu click or a
 * direct editor run, that's whoever is signed in; for an installable trigger
 * (the daily/hourly syncs, the bootstrap hand-off), it's whoever created that
 * trigger, which is exactly "who actually set this in motion."
 *
 * Returns '' if it can't be determined (getEmail() can come back blank in
 * some restricted execution contexts) — callers must treat that as
 * unauthorized, not as a pass.
 */
function getCurrentUserEmail() {
  try {
    return String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  } catch (err) {
    return '';
  }
}

function isAuthorizedAdmin() {
  const email = getCurrentUserEmail();
  if (!email) return false;
  return AUTHORIZED_ADMIN_EMAILS.some(allowed => allowed.trim().toLowerCase() === email);
}

/**
 * Call as the FIRST line of any structural/destructive function. Returns
 * true and does nothing else if the current account is authorized; returns
 * false (having logged and toasted why) otherwise — the caller's very next
 * line should be `return`.
 *
 * FAILS CLOSED: an email that can't be determined is treated as
 * unauthorized, same as a real mismatch. The cost of a false block is
 * someone re-running it after signing in as the right account; the cost of
 * a false pass is an unidentified account rebuilding triggers or running the
 * calendar import.
 */
function requireAuthorizedAdmin(actionName) {
  if (isAuthorizedAdmin()) return true;
  const email = getCurrentUserEmail();
  const whoami = email ? `you're signed in as ${email}` : `your account could not be identified`;
  const message = `⛔ "${actionName}" is restricted to: ${AUTHORIZED_ADMIN_EMAILS.join(', ')} — ${whoami}. ` +
    `Ask one of those accounts to run it, or switch to one of them.`;
  log(message);
  toastIfPossible(message);
  return false;
}


// ============================================================================
// 1b. "ARE YOU SURE?" — consequence prompts for outward-facing changes
// ============================================================================
//
// Some edits in this workbook don't just change the workbook: they rewrite
// LIVE Google Forms that people are mid-way through registering on, or change
// what every future registration is catered as. A spreadsheet gives no hint
// that typing in a cell is about to do that.
//
// So the rule is: anything whose blast radius reaches outside this
// spreadsheet asks first, in plain language, and does nothing at all if the
// answer is no. For a cell edit that means putting the old value BACK, since
// by the time onEdit sees it the new value is already on the sheet.
//
// getUi() is unavailable in a trigger context (a time-driven sync has no
// dialog to show), which is exactly right: an unattended run should proceed
// on its schedule, not sit waiting for a click that will never come. Only a
// human at the keyboard gets asked.
// ============================================================================

/**
 * Asks the user to confirm a consequential action. Returns true to proceed.
 *
 * NO UI AVAILABLE (a trigger run) => returns `defaultWhenUnattended`, which
 * callers must choose deliberately:
 *   - true  for automation that SHOULD keep running unattended (the hourly
 *           sync rewriting form labels — that's its job).
 *   - false for anything a human specifically set in motion, where silence
 *           means nobody is there to take responsibility for it.
 */
function confirmConsequentialAction(title, detail, defaultWhenUnattended) {
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    log(`No UI available to confirm "${title}" — ${defaultWhenUnattended ? 'proceeding' : 'skipping'} (unattended run).`);
    return !!defaultWhenUnattended;
  }
  if (!ui) return !!defaultWhenUnattended;

  const response = ui.alert(title, `${detail}\n\nContinue?`, ui.ButtonSet.YES_NO);
  const proceed = response === ui.Button.YES;
  log(`"${title}": user chose ${proceed ? 'YES — proceeding' : 'NO — nothing changed'}.`);
  if (!proceed) toastIfPossible(`Cancelled — nothing was changed.`);
  return proceed;
}

/**
 * The cell-edit flavour: confirm, and PUT THE OLD VALUE BACK if declined.
 * `e` is the onEdit event, which carries oldValue for a single-cell edit.
 *
 * Multi-cell edits (a paste, a fill-down) have no oldValue to restore, so
 * they are allowed through with a warning toast rather than being reverted to
 * a guess — silently writing the wrong "old" value into a range would be
 * worse than the edit itself.
 */
function confirmCellEditOrRevert(e, title, detail) {
  const isSingleCell = e && e.range && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1;
  if (!isSingleCell) {
    toastIfPossible(`⚠️ ${title}: applied to a multi-cell edit without asking — please double-check the result.`);
    return true;
  }
  if (confirmConsequentialAction(title, detail, false)) return true;

  // Declined: restore what was there. e.oldValue is undefined when the cell
  // was previously empty, which setValue('') reproduces correctly.
  e.range.setValue(e.oldValue === undefined ? '' : e.oldValue);
  return false;
}

/** Calendar ID -> human-readable location name. */
const CALENDAR_MAP = {
  'c7706e8a3c057e02a4adca78268262aeb7116b9717b9325926bf746728566faa@group.calendar.google.com': 'Narberth',
  '1073e5cc279f84bff722d0b03695b38011d845e6230e2f704adab49d31c3d652@group.calendar.google.com': 'Ashbridge',
  'ac990016bc9f04e0d7ef9da8b463367cd34b2aa5a137535d876af9ae4db2f675@group.calendar.google.com': 'Zoom'
};

/**
 * Hardcoded soft colors per "Month Year" label — used to tint the Event_Date
 * cell itself now (there is no separate Month column anywhere anymore).
 * Deliberately picked from TEAL / GOLD / MAGENTA families — NOT green,
 * peach/orange, or lavender (LOCATION_COLOR_MAP's families), and NOT
 * green/red (status colors). Any month not listed falls back to
 * getMonthColor()'s deterministic generator, which draws from the same three
 * safe hue bands.
 */
const MONTH_COLOR_MAP = {
  'January 2026': '#D6F0EC',
  'February 2026': '#F7F2D2',
  'March 2026': '#F5D6EC',
  'April 2026': '#C2E8E0',
  'May 2026': '#F2ECC0',
  'June 2026': '#F0C2E0',
  'July 2026': '#AEE0D4',
  'August 2026': '#EDE6AE',
  'September 2026': '#EBAED4',
  'October 2026': '#9AD8C8',
  'November 2026': '#E8E09C',
  'December 2026': '#E69AC8'
};

/**
 * Column sizing. Every column is autofitted and then padded out to this
 * multiple of its fitted width, so text never sits flush against the cell
 * edge and a dropdown arrow never overlaps the value under it.
 *
 * The MAX clamp is load-bearing, not decoration: autofit on a long
 * Admin_Notes or "Programs Today" cell already produces a very wide column,
 * and 130% of "very wide" is unusable. The MIN keeps a column of 0/1 counts
 * from collapsing to a sliver. Both are in pixels; tune here and re-run
 * resizeAllSheets() to apply to existing tabs.
 */
const COLUMN_WIDTH_BUFFER_MULTIPLIER = 1.3;
const MIN_COLUMN_WIDTH_PX = 60;
const MAX_COLUMN_WIDTH_PX = 400;

// Status color palettes (kept together for easy re-theming).
const EVENT_STATUS_COLORS = {
  '🟢 Open': '#D9EAD3',
  '🟡 Almost Full': '#FFF2CC',
  '🔴 Waitlist Only': '#F4CCCC',
  '🟢 Unlimited': '#B6D7A8'
};

const REGISTRANT_STATUS_COLORS = {
  'Cancelled': '#F4CCCC',
  'Waitlisted': '#FCE5CD',
  'Active': '#D9EAD3',
  'Needed': '#D9EAD3',
  // A newer submission from the same person/event superseded this row — see
  // buildRegistrantRow()/supersedeRegistrantRow(). Distinct grey (reused
  // from NA_CELL_COLOR) so it reads as "historical," not cancelled/waitlisted.
  'Superseded': '#E8E8E8'
};

const MANUAL_OVERRIDE_COLOR = '#D9D2E9';
const ORDER_AHEAD_FLAG_COLOR = '#FFD966';
const NA_CELL_COLOR = '#E8E8E8';
/** Grey used on a Lunch_Schedule/Master_Lunch_Dashboard Type cell reading "Not Serving". */
const NOT_SERVING_COLOR = '#D9D9D9';

// Day_1_In-Person / Day_1_Takeaway / Subs_In-Person / Subs_Takeaway / In_Fridge
// used to be hand-typed here too, but are now tallied automatically from the
// Registrants tab's five per-person meal counts (see
// REGISTRANT_MEAL_COUNT_COLUMNS and buildDashboardRollup()) — the same way
// Served_Confirmed already worked — so they're no longer offered as manual
// entry and get the protectDerivedColumns() warning instead (see
// writeMasterLunchDashboardSheet()).
// Standard_Buffer/Tester_Buffer are no longer hand-entry either, for a
// different reason: they are a CONFIG setting, not an observation. Offering
// them as yellow "type here" columns invited staff to change an ordering
// buffer on one row and expect it to mean something, while the value shown was
// whatever happened to be written when the row was first created — which for
// any date with no registrations yet was a hard-coded 0, hence the column of
// zeroes. updateMasterLunchDashboard() now re-reads both from Config on every
// render (see HEADERS.Master_Lunch_Dashboard).
const LUNCH_DASHBOARD_MANUAL_COLUMNS = [
  'Actual_Ordered', 'Total_Consumed', 'Thrown_Away', 'Discrepancy'
];

/**
 * Nothing on the lunch dashboard is a machine-only key, so nothing is hidden
 * today — the buffer/consumption columns were moved to the END of the row
 * instead (see HEADERS.Master_Lunch_Dashboard), which keeps them reachable
 * while getting them out from between the numbers staff actually order
 * against. The constant exists so the decision has one place to live.
 */
const LUNCH_DASHBOARD_HIDDEN_COLUMNS = [];

/**
 * Master_Program_Dashboard: the session table is rebuilt from the calendar
 * every render, so the only cells a human can usefully change are the ones
 * handleProgramDashboardEdit() writes back to the calendar — Type_Tag and the
 * two flag checkboxes (Club, No_Registration; see PROGRAM_FLAG_COLUMNS).
 * Location is a dropdown for readability but is equally calendar-derived, so
 * it is NOT advertised as editable.
 *
 * NOT given the yellow manual-entry treatment the other tabs' editable
 * columns get — see writeProgramDashboardSheet(). Kept as the single named
 * list of "what a human may change here", which is what
 * protectDerivedColumns() is defined against.
 */
// Spelled out rather than derived from PROGRAM_FLAG_COLUMNS: that list is
// declared further down this file, and a top-level const cannot read another
// one that has not been evaluated yet.
const PROGRAM_DASHBOARD_EDITABLE_COLUMNS = ['Type_Tag', 'Club', 'No_Registration'];

/**
 * Internal plumbing on the program dashboard: the raw IDs and the duplicate
 * link column. Form_Response_Link ("View Live Form") stays visible — it is the
 * link staff actually hand out — while Edit_Form_Link and the bare Form_ID are
 * for troubleshooting only.
 */
const PROGRAM_DASHBOARD_HIDDEN_COLUMNS = ['Form_ID', 'Event_ID', 'Calendar_Source', 'Calendar_Synced?'];
const MANUAL_ENTRY_HEADER_COLOR = '#FFF2CC';
const MANUAL_ENTRY_CELL_TINT = '#FFFCF0';
/**
 * Prepended to a hand-entry column's HEADER CELL by labelManualEntryColumns().
 * Purely decorative — normalizeHeaderText() strips it back off, which is what
 * keeps 'Standard_Buffer' usable as Master_Lunch_Dashboard's header-row marker.
 */
const MANUAL_ENTRY_PREFIX = '✍️';

const MANUAL_OVERRIDE_OPTIONS = ['Auto-Synced', 'Manually Edited', 'Manually Added'];
// 'Superseded' marks a row from an identity (Event_ID + Name + Person_Type)
// that has since submitted again under a different Party_ID — see
// buildRegistrantRow(). It's deliberately excluded from every active/
// waitlist count (scanRegistrants(), buildEventCountsFromRegistrants(),
// buildDashboardRollup() all key off 'Active'/'Waitlisted' by name) without
// needing any special-casing there.
const PROGRAM_STATUS_OPTIONS = ['Active', 'Waitlisted', 'Cancelled', 'Superseded'];
const LUNCH_STATUS_OPTIONS = ['Needed', 'No Lunch', 'Waitlisted', 'Cancelled', 'Superseded'];
/**
 * What a program's Type_Tag says about how its sessions are grouped onto ONE
 * registration form:
 *
 *   GROUPED  every session of the series shares a single form, however many
 *            months it spans. Was called "Fixed".
 *   MONTHLY  sessions are bundled per calendar month — a new month means a
 *            new form. Was called "Regular".
 *
 * The old words said nothing about what actually differs (both are "regular"
 * in plain English, and a "Fixed" series isn't fixed in any sense a user
 * would guess). The mechanism is unchanged — only the vocabulary.
 *
 * BOTH SPELLINGS ARE READ EVERYWHERE, forever: normalizeTypeTag() maps
 * Fixed->Grouped and Regular->Monthly, so session rows written by earlier
 * versions, and `[Fixed]` still sitting in a calendar description, keep
 * working with no migration step. Only what this script WRITES changes.
 */
const EVENT_TYPES = {
  GROUPED: 'Grouped',
  MONTHLY: 'Monthly'
};
const EVENT_TYPE_OPTIONS = [EVENT_TYPES.GROUPED, EVENT_TYPES.MONTHLY];

/** Legacy Type_Tag spellings -> current ones. */
const LEGACY_EVENT_TYPE_ALIASES = {
  fixed: EVENT_TYPES.GROUPED,
  regular: EVENT_TYPES.MONTHLY
};

/**
 * Canonical Type_Tag for a value read from a sheet, a description, or
 * anywhere else. Unrecognized input falls back to MONTHLY — the narrower
 * grouping, so a typo can never silently merge unrelated months onto one
 * form.
 */
function normalizeTypeTag(value) {
  const raw = String(value || '').trim();
  if (!raw) return EVENT_TYPES.MONTHLY;
  const lower = raw.toLowerCase();
  if (LEGACY_EVENT_TYPE_ALIASES[lower]) return LEGACY_EVENT_TYPE_ALIASES[lower];
  const match = EVENT_TYPE_OPTIONS.filter(t => t.toLowerCase() === lower)[0];
  return match || EVENT_TYPES.MONTHLY;
}

/** True when this Type_Tag means "one form for the whole series" (either spelling). */
function isGroupedTypeTag(value) {
  return normalizeTypeTag(value) === EVENT_TYPES.GROUPED;
}

/**
 * CROSS-LOCATION PROGRAMS — the [All Locations] tag.
 *
 * Grouping has always had two dimensions, but only one of them was sayable:
 * WHEN sessions share a form ([Grouped] = the whole series, [Monthly] = a
 * month at a time). WHERE was fixed — the group key started with the calendar
 * ID, so the same program running at Narberth and at Ashbridge always got two
 * separate forms, even when it is one program with one roster that simply
 * meets in two rooms.
 *
 * `[All Locations]` in an event's DESCRIPTION opens up the second dimension:
 * that event's sessions pool with the same-titled sessions on EVERY other
 * program calendar, onto one form. It composes with the existing tags rather
 * than replacing them —
 *
 *   [Grouped, All Locations]  one form for the whole series, everywhere
 *   [Monthly, All Locations]  one form per calendar month, everywhere
 *   [Cap: 12, All Locations]  ...and the cap still applies PER SESSION
 *
 * — because it only changes the SCOPE half of the group key
 * (SHARED_LOCATION_SCOPE in place of the calendar ID; see buildEventGroups()).
 *
 * The tag is read per EVENT, exactly like [Cap: N] and [Grouped]: an event
 * that carries it joins the shared form, one that doesn't keeps its own
 * per-location form. That makes a half-tagged program a describable state
 * rather than an ambiguous one — and since it is nearly always a mistake,
 * warnAboutPartiallySharedPrograms() says so out loud.
 *
 * WHAT A SHARED FORM HAS TO DO DIFFERENTLY. Its dates are no longer all at
 * one place, so:
 *   - every date label names its location (formatSessionLabel()), which is
 *     also what keeps two locations' sessions on the SAME day from collapsing
 *     into one grid row or one registry-index key;
 *   - lunch is decided per date+location as it always was (isLunchOfferedOn),
 *     so a Never-catering location's dates simply never reach the lunch grid,
 *     and the lunch questions come off only when NO location on the form
 *     caters;
 *   - the footer note and the form description list every location involved.
 * Everything downstream — Event_IDs, registrant rows, counts, the lunch
 * dashboard — is already keyed per session, and a session still knows exactly
 * one location. Nothing there had to learn about sharing.
 */
const SHARED_LOCATION_SCOPE = 'ALL_LOCATIONS';

/** What this system WRITES into a description to mark a program cross-location. */
const SHARED_LOCATION_TAG = 'All Locations';

/**
 * What it READS. Several plain-English spellings are accepted for the same
 * reason [Fixed] is still read as [Grouped]: the tag is typed by hand into a
 * calendar, and "Shared"/"All Sites" are what people reach for.
 */
const SHARED_LOCATION_WORDS_REGEX = /\b(All\s+Locations|All\s+Sites|Shared|Combined|Multi-?Site)\b/i;

/**
 * Separator between the date and the location on a cross-location form's row
 * label ("Mon, Jan 5, 2026 · Narberth"). Deliberately NOT the " — " used for
 * meal hints or the " (FULL - Waitlist)" capacity suffix, so stripMealHint()
 * keeps returning a label that still identifies the SESSION — which is what
 * buildRegistryIndex() matches a grid row back to.
 */
const LOCATION_LABEL_SEPARATOR = ' · ';

/** "Narberth" / "Narberth + Ashbridge" — how a form's locations read in prose. */
function describeLocations(locations) {
  const list = (locations || []).filter(Boolean);
  return list.length > 0 ? list.join(' + ') : 'this location';
}

/**
 * CLUBS — the [Club] tag.
 *
 * A club is a program with a MEMBERSHIP rather than a series of one-off
 * sign-ups: the Thursday Book Club, the Knitting Circle. People join once and
 * are expected at every meeting from then on, indefinitely — including
 * meetings whose calendar events do not exist yet.
 *
 * WHY IT IS A THIRD, SEPARATE TAG. [Grouped]/[Monthly] answer "which sessions
 * share ONE FORM", and [All Locations] answers "which locations share it".
 * Neither can express "and the people who signed up stay signed up." Making
 * Club a value of Type_Tag would have forced a choice between them, which is
 * exactly wrong — a club can perfectly well be Monthly (a fresh form each
 * month, so the menu and dates stay current) while its roster carries across
 * every one of those forms. So it composes, the same way [All Locations]
 * does:
 *
 *   [Club]                  a club, one form per month (the default span)
 *   [Club, Grouped]         a club, one form for the whole series
 *   [Club, Monthly]         spelled out; same as [Club]
 *   [Club, Cap: 12]         a club with a per-session cap
 *   [Club, All Locations]   one club meeting at several sites, one form
 *
 * WHAT THE TAG ACTUALLY CHANGES:
 *   - the registration form grows a THIRD attendance-mode choice, "sign up for
 *     all future <program> meetings", which enrolls the whole party in the club
 *     (see ATTENDANCE_MODE_CHOICES / buildClubModeChoice());
 *   - every member of that club gets a registrant row for every session of it,
 *     on every form, forever — applied on each registration sync by
 *     applyClubRosterCatchup(), which is what makes "sign up once" survive the
 *     month rolling over into a brand new form;
 *   - the roster itself lives on the Club_Members tab, one row per person, with
 *     an Active checkbox staff untick to take someone back off it. That is the
 *     REVERSAL half of "sign up once": membership is a fact staff own, not a
 *     one-way consequence of a form submission nobody can undo.
 *
 * A club's identity is the PROGRAM (title + where it runs), not the form —
 * see computeClubKey(). A Monthly club gets a new form every month and must
 * keep the same roster across all of them, so keying membership by form would
 * lose the entire point.
 */
const CLUB_TAG = 'Club';

/** What gets READ as the club tag. Kept as permissive as the shared-location one, and for the same reason: it is typed by hand into a calendar. */
const CLUB_WORDS_REGEX = /\b(Club|Membership|Members\s+Only)\b/i;

/**
 * What gets WRITTEN into Master_Program_Dashboard's Club column for a club
 * session: TRUE, because that column is now a real CHECKBOX (see
 * PROGRAM_FLAG_COLUMNS). Earlier versions wrote the word "Club" there and
 * plenty of workbooks still hold it, which is why isClubColumnValue() reads
 * both spellings and only the WRITE side changed.
 */
const CLUB_COLUMN_VALUE = true;

/**
 * NO REGISTRATION — the [No Registration] tag.
 *
 * The other tags all answer "how should this program's registration work".
 * This one answers "it shouldn't". Plenty of what a senior center runs takes
 * no sign-up at all: a drop-in coffee hour, a rolling art room, a lobby
 * concert. Those events belong on the calendar and on the dashboard — staff
 * still want to see what is on today — but they must not get a form, and a
 * "📝 Register for…" link on them is actively wrong: it tells people to sign
 * up for something nobody is keeping a list for.
 *
 * WHAT THE TAG CHANGES:
 *   - no registration form is ever built for the program (processCalendarGroup
 *     writes its session rows with the link columns blank);
 *   - any registration link already sitting in its calendar events is removed,
 *     and a form it already had stops accepting responses — see
 *     applyNoRegistrationEffects(). Both are reversible: untick the box and
 *     the next sync re-opens the form and puts the link back.
 *
 * It composes with the others the same way [Club] does, though most of those
 * combinations are contradictions worth nothing: a club with no registration
 * is just a program. [No Registration] wins wherever they disagree, since it
 * is the one that says "no form", and there is nothing for the rest to
 * describe.
 */
const NO_REGISTRATION_TAG = 'No Registration';

/**
 * What gets READ as the no-registration tag. As permissive as the club and
 * shared-location ones, and for the same reason: staff type it by hand into a
 * calendar description and will spell it however it comes to them.
 */
const NO_REGISTRATION_WORDS_REGEX =
  /\b(No\s*-?\s*Registration|No\s+Sign[\s-]?ups?|No\s+Sign\s*-?\s*Up|Registration\s+Not\s+Required|Drop[\s-]?In)\b/i;

/** Written into the No_Registration checkbox column for a session that takes no sign-ups. */
const NO_REGISTRATION_COLUMN_VALUE = true;

/**
 * What stands in for "View Live Form" on a session that takes no sign-ups.
 * Words rather than a blank cell: an empty link column on one row of a table
 * full of links reads as a form that failed to build, which is the bug this
 * feature would otherwise look exactly like.
 */
const NO_REGISTRATION_LINK_LABEL = '— no registration —';

/**
 * The two TICKABLE tag columns on Master_Program_Dashboard, and everything
 * that differs between them, in one place.
 *
 * They are the same mechanism twice over — a calendar-description bracket,
 * shown as a checkbox, ticked or unticked by staff, stamped back onto every
 * calendar event of that program — so the edit handler, the menu-driven
 * reconcile and the sync-time catch-up all walk this list instead of naming
 * either flag. Adding a third flag column is then a matter of adding an entry
 * here plus its header.
 *
 *   column   the dashboard header it appears under
 *   tag      the exact word this script WRITES into a description bracket
 *   regex    every spelling it READS back out of one
 *   groupKey the field buildEventGroups() carries it on
 */
const PROGRAM_FLAG_COLUMNS = [
  {
    column: 'Club',
    tag: CLUB_TAG,
    regex: CLUB_WORDS_REGEX,
    groupKey: 'isClub',
    onQuestion: title => `Make "${title}" a club?`,
    onDetail: title =>
      `People who sign up for "${title}" will stay signed up: its registration form grows a ` +
      `"sign up for all future meetings" choice, and everyone on its Club_Members list is booked ` +
      `into every future session automatically.\n\n[${CLUB_TAG}] is written onto its calendar events.`,
    offDetail: title =>
      `"${title}" will stop keeping a standing membership. Nobody is removed from Club_Members and ` +
      `no existing booking is cancelled — the list simply stops being applied to new sessions.\n\n` +
      `[${CLUB_TAG}] is removed from its calendar events.`
  },
  {
    column: 'No_Registration',
    tag: NO_REGISTRATION_TAG,
    regex: NO_REGISTRATION_WORDS_REGEX,
    groupKey: 'noRegistration',
    onQuestion: title => `Turn registration off for "${title}"?`,
    onDetail: title =>
      `"${title}" will stop taking sign-ups. No registration form is built for it, the registration ` +
      `link is removed from its calendar events, and any form it already has stops accepting ` +
      `responses.\n\nRegistrations already collected are kept. Untick the box to turn registration ` +
      `back on.\n\n[${NO_REGISTRATION_TAG}] is written onto its calendar events.`,
    offDetail: title =>
      `"${title}" will take sign-ups again: the next sync builds (or re-opens) its registration form ` +
      `and puts the link back on its calendar events.\n\n[${NO_REGISTRATION_TAG}] is removed from ` +
      `its calendar events.`
  }
];

/** The flag definition for one dashboard column name, or null. */
function getProgramFlagByColumn(columnName) {
  return PROGRAM_FLAG_COLUMNS.filter(f => f.column === columnName)[0] || null;
}

/**
 * PENDING FLAG CHANGES — the tab that makes a tick survive long enough to be
 * delivered.
 *
 * A tick has to end up in a calendar description, and the trigger that sees
 * the tick first is the SIMPLE onEdit, which has no authorization to write to
 * a calendar (see onEdit()). Meanwhile anything at all happening on a watched
 * calendar fires onCalendarChange -> a full syncCalendars(), which recomputes
 * these columns FROM the calendar. Between those two facts sat the bug this
 * tab exists to kill: you tick the box, a sync fires seconds later for an
 * unrelated reason, the calendar still knows nothing about your tick, and the
 * box quietly unticks itself — taking with it the only record that you ever
 * asked for anything, so the menu-driven "apply" then has nothing to apply.
 *
 * So the tick is recorded HERE, on a hidden tab, the instant it happens —
 * which a simple onEdit can do, because it is nothing but a spreadsheet write.
 * From then on:
 *
 *   - reconcileProgramFlagColumns() leaves that program's checkboxes ALONE
 *     while an entry is outstanding. The calendar no longer overwrites an
 *     instruction it has not been told about yet.
 *   - every authorized entry point drains the queue by stamping the calendar:
 *     the installable onEdit (seconds later, the normal case), the next
 *     Sync Cal, and the menu item. An entry is cleared only once its calendar
 *     has actually accepted it.
 *
 * One row per program per flag; a later tick on the same program replaces the
 * earlier one, so the queue holds intentions rather than history.
 */
const PENDING_FLAG_SHEET_NAME = '_Pending_Tag_Changes';
const PENDING_FLAG_HEADERS = ['Column', 'Calendar_Source', 'Clean_Title', 'Turn_On', 'Requested_At'];

/** The queue's identity for one program's one flag. */
function pendingFlagKey(flagColumn, calendarId, title) {
  return `${String(flagColumn || '').trim()}|${String(calendarId || '').trim()}|${String(title || '').trim()}`;
}

/**
 * True when a tag-column cell is ON. Reads a real checkbox (a boolean, or the
 * "TRUE" a pasted cell arrives as) AND the words earlier versions wrote there
 * — a workbook that still says "Club" in that column must keep meaning it
 * until the next render turns it into a tick.
 */
function isFlagColumnValue(value, wordsRegex) {
  if (value === true) return true;
  const text = String(value === false ? '' : (value || '')).trim();
  if (!text) return false;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  return wordsRegex.test(text);
}

/**
 * The stable key a club's membership is filed under: its title, plus the
 * location it meets at — or the shared scope when the program is tagged
 * [All Locations], since that is one club that happens to meet in two rooms.
 *
 * Lower-cased for the same reason normalizeNameKey() is: this key is matched
 * against values typed into a calendar and re-typed onto a sheet, and "Book
 * Club" / "book club " must not become two rosters.
 */
function computeClubKey(cleanTitle, location, isShared) {
  const title = String(cleanTitle || '').trim().toLowerCase();
  if (!title) return '';
  const scope = isShared ? SHARED_LOCATION_SCOPE : String(location || '').trim().toLowerCase();
  return `${scope}::${title}`;
}

/** True when a Master_Program_Dashboard row's Club cell marks it a club session. */
function isClubColumnValue(value) {
  return isFlagColumnValue(value, CLUB_WORDS_REGEX);
}

/** True when a Master_Program_Dashboard row's No_Registration cell says this session takes no sign-ups. */
function isNoRegistrationColumnValue(value) {
  return isFlagColumnValue(value, NO_REGISTRATION_WORDS_REGEX);
}

/**
 * One color per location, used BOTH for the Location cell itself and (on
 * Master_Lunch_Dashboard) for the whole row band — see
 * buildLocationColorRules() / buildLocationRowTintRules().
 */
const LOCATION_COLOR_MAP = {
  'Narberth': '#FCE5CD',  // light orange
  'Ashbridge': '#D9EAD3', // light green
  'Zoom': '#D9D2E9'       // lavender
};

const SHEET_NAMES = {
  CONFIG: 'Config',
  PROGRAM_DASHBOARD: 'Master_Program_Dashboard',
  LUNCH_EVENT_REGISTRANTS: 'Lunch_and_Event_Registrants',
  LUNCH_DASHBOARD: 'Master_Lunch_Dashboard',
  LUNCH_SCHEDULE: 'Lunch_Schedule',
  TRIAGE: 'Deleted_Event_Triage',
  MEMBER_ROLL: 'Member_Roll',
  PROGRAM_OPTIONS: 'Program_Options',
  CLUB_MEMBERS: 'Club_Members'
};

const LEGACY_ACTIVE_PROGRAMS_SHEET_NAME = 'Active_Programs';

/**
 * Column layouts. Every date-bearing sheet now leads with Event_Date (its
 * cell background carries the month tint that used to live in a separate
 * Month column). Master_Program_Dashboard's session table no longer has a
 * Manual_Override column at all; the other date-bearing tabs keep it as
 * the second column.
 */
const HEADERS = {
  // The per-session table inside Master_Program_Dashboard (section C).
  //
  // Active_Count sits directly beside Status — "how many signed up" and "is it
  // full" is the pair anyone reads first. The three CAPACITY columns
  // (Max_Capacity / Waitlist_Count / Remaining_Seats) trail at the end of the
  // VISIBLE run instead, ahead of the hidden plumbing block: most programs
  // here are uncapped, so all three read "" / "🟢 Unlimited" on most rows, and
  // three columns of nothing sitting between the count and the status pushed
  // the form links off the screen to say it.
  //
  // Hidden columns (PROGRAM_DASHBOARD_HIDDEN_COLUMNS) stay last. They don't
  // have to be — applyColumnVisibility() hides by NAME, not position — but
  // keeping them there means the visible table is a contiguous block, which
  // is what makes "the end of the row" mean anything.
  //
  // Club and No_Registration sit immediately after Type_Tag because the three
  // together are what decide how a program behaves: Type_Tag says which
  // sessions share a form, Club says whether signing up once keeps you signed
  // up (see CLUB_TAG), and No_Registration says whether there is a form at all
  // (see NO_REGISTRATION_TAG).
  //
  // All three are calendar-derived AND editable here. The two flags are real
  // checkboxes: ticking one asks, then writes its tag into the program's
  // calendar event descriptions, which is what makes the tick stick instead of
  // being wiped by the next render (see handleProgramDashboardEdit()).
  Master_Program_Dashboard: [
    'Event_Date', 'Location', 'Clean_Title', 'Event_Time', 'Type_Tag', 'Club', 'No_Registration',
    'Active_Count', 'Status', 'Form_Response_Link', 'Edit_Form_Link',
    'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats',
    'Form_ID', 'Calendar_Synced?', 'Event_ID', 'Calendar_Source'
  ],
  // Order_Ahead_Flag is computed once, at import time, and never recomputed
  // afterward — a registration's notice period is a fact about when it
  // happened, not something that should drift if Config changes later.
  // Event_Date leads the row, the same as every other date-bearing tab (it
  // is what these tabs are sorted and split by, and it carries the month
  // tint), with Location and Event right behind it so staff never have to
  // scroll to see which program a registrant belongs to. Party_ID (the Form
  // response ID) sits at the very end — it's an internal grouping key, not
  // something staff read first; Party_Size (the headcount on that
  // submission) stays up front near the person since it IS worth reading at
  // a glance.
  // Attended and Lunch_Served are the two DAY-OF columns: they're what staff
  // tick on the day, and they sit immediately after Name so marking a row is
  // one glance and one click, with no horizontal scrolling.
  //
  // THE FOUR MEAL COUNTS behind them (plus Meals_In_Fridge) are what let ONE
  // PERSON account for SEVERAL DIFFERENT MEALS on the same day, which is what
  // actually happens at the counter: Joe eats the day-1 hot meal in the dining
  // room and carries out two subs on his way home. The previous shape could
  // not say that — it had one Dine_In_Count, one Subs_Count and a single
  // Meals_In_Fridge CHECKBOX that flipped BOTH counts to takeaway together, so
  // every meal on a row had to be the same kind. Splitting dined-in from
  // taken-out per meal type makes the mixed case expressible, and keeps it
  // attached to the person who took them rather than only to the day's total:
  //
  //   Day1_Dined_In    day-1 meals eaten here
  //   Day1_Taken_Out   day-1 meals carried out
  //   Subs_Dined_In    subs eaten here
  //   Subs_Taken_Out   subs carried out
  //   Meals_In_Fridge  meals of theirs left in the fridge to collect later
  //
  // buildDashboardRollup() tallies the four straight into
  // Master_Lunch_Dashboard's Day_1_In-Person / Day_1_Takeaway /
  // Subs_In-Person / Subs_Takeaway columns (and Meals_In_Fridge into In_Fridge)
  // the same way Lunch_Served rolls into Served_Confirmed. Everything the form
  // supplied (Lunch_Type, Party_Size, Form_Source...) follows behind them, and
  // the internal keys trail at the end.
  //
  // Phone and Email come off the form itself (Email is the respondent address
  // Forms collects). Email is what inviteRegistrantsToCalendarEvents() adds as
  // a calendar guest; Phone is what the printed sign-in sheet needs and what
  // staff ring when a program moves.
  Lunch_and_Event_Registrants: [
    'Event_Date', 'Location', 'Event', 'Name', 'Attended', 'Lunch_Served',
    'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
    'Phone', 'Email',
    'Person_Type', 'Lunch_Type', 'Lunch_Status', 'Program_Status',
    'Primary_Registrant', 'Party_Size', 'Order_Ahead_Flag', 'Admin_Notes',
    'Manual_Override', 'Form_Source', 'Event_ID', 'Party_ID'
  ],
  // Registered_Count (what the forms say) and Served_Confirmed (what was
  // actually ticked off on the Registrants tab) sit side by side on purpose —
  // planned versus real is the comparison this tab exists to support.
  //
  // The consumption columns are no longer hand-typed here (see
  // LUNCH_DASHBOARD_MANUAL_COLUMNS): they're tallied by buildDashboardRollup()
  // from the five per-person meal counts on Lunch_and_Event_Registrants, the
  // same way Served_Confirmed is tallied from Lunch_Served.
  // updateMasterLunchDashboard() only overwrites a cell when the tally is
  // greater than zero, so a value typed here before that wiring existed is
  // left alone until the Registrants tab actually reports something for that
  // date+location.
  //
  // The two BUFFER columns now trail at the very end, behind even the
  // consumption/reconciliation block. They are READ-ONLY: every render re-reads
  // them from Config's "Meal Buffer Amounts" section for that row's location
  // and Hot/Cold type (see updateMasterLunchDashboard()), so the number here
  // and the number in Config can no longer disagree — which is what "they all
  // read 0" was a symptom of, since the old code only ever wrote them at
  // row-creation time and wrote 0 whenever the date had no registrations yet.
  // Change a buffer in Config, not here. Total_to_Order's formula still
  // references them by cell (writeMasterLunchDashboardSheet() builds the A1
  // refs from this array), so their position is free to move.
  //
  // In_Fridge sits with the other consumption tallies: it is what the
  // Registrants tab's Meals_In_Fridge counts add up to for that date+location.
  Master_Lunch_Dashboard: [
    'Event_Date', 'Location', 'Lunch_Type', 'Meal_Shorthand',
    'Registered_Count', 'Served_Confirmed', 'Total_to_Order', 'Actual_Ordered',
    'Day_1_In-Person', 'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'In_Fridge',
    'Total_Consumed', 'Thrown_Away', 'Discrepancy', 'Manual_Override',
    'Standard_Buffer', 'Tester_Buffer'
  ],
  // Now one row per Event_Date PER LOCATION. Type includes "Not Serving"
  // (see CATERED_LUNCH_TYPES vs LUNCH_TYPE_OPTIONS below).
  Lunch_Schedule: ['Event_Date', 'Location', 'Type', 'Meal_Description', 'Meal_Shorthand'],
  // A superset of Lunch_and_Event_Registrants' own array (same columns, same
  // order) plus 4 triage-only columns — moveRegistrantsToTriage() copies by
  // HEADER NAME, so keeping this a true prefix-plus-extra of the Registrants
  // array is what keeps every registrant column (Location/Event included)
  // landing in triage rows automatically, with no per-column wiring.
  Deleted_Event_Triage: [
    'Event_Date', 'Location', 'Event', 'Name', 'Attended', 'Lunch_Served',
    'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
    'Phone', 'Email',
    'Person_Type', 'Lunch_Type', 'Lunch_Status', 'Program_Status',
    'Primary_Registrant', 'Party_Size', 'Order_Ahead_Flag', 'Admin_Notes',
    'Manual_Override', 'Form_Source', 'Event_ID', 'Party_ID',
    'Deleted_Event_Title', 'Deleted_Event_Location', 'Flagged_Date', 'Triage_Notes'
  ],
  /**
   * Member_Roll — one row per unique PERSON ever seen on a form, with columns
   * the system maintains and columns only staff write. The point is that a
   * name typed into a registration form once becomes a known member with
   * standing notes attached, instead of a string that has to be re-learned
   * every time.
   *
   * Times_Seen/First_Seen/Last_Seen/Locations/Usual_Lunch are RECOMPUTED from
   * the registrant history on every refresh; Usual_Guests, Dietary_Notes,
   * Contact and Staff_Notes are never touched once written — see
   * MEMBER_ROLL_STAFF_COLUMNS.
   */
  //
  // Phone/Email are RECOMPUTED (the most recent non-blank one this person gave
  // on a form), which is why they sit on the left with the other derived
  // columns. Contact stays a staff column: it is where a note like "reach her
  // daughter Ann first" belongs, and that is not something a form can supply.
  Member_Roll: [
    'Name', 'Phone', 'Email', 'Times_Seen', 'First_Seen', 'Last_Seen', 'Locations', 'Usual_Lunch',
    'Usual_Guests', 'Dietary_Notes', 'Contact', 'Staff_Notes'
  ],
  /**
   * Club_Members — the standing roster of every club (see CLUB_TAG). One row
   * per person per club.
   *
   * Active is the whole point of the tab, and the only column staff normally
   * touch: tick it and applyClubRosterCatchup() books that person into every
   * session of the club from now on; untick it and they stop being booked,
   * with their already-created UPCOMING rows offered up for cancellation on
   * the spot (see handleClubMembersEdit()). "Sign up once, forever" needs an
   * undo, and this is it.
   *
   * Club_Key is the machine key (computeClubKey()) — hidden, and the thing
   * that keeps a Monthly club's roster attached across a new form every month.
   */
  Club_Members: [
    'Club', 'Location', 'Name', 'Person_Type', 'Primary_Registrant',
    'Phone', 'Email', 'Lunch', 'Joined_On', 'Active', 'Source', 'Staff_Notes', 'Club_Key'
  ],
  /**
   * Program_Options — one row per unique PROGRAM (Clean_Title x Location),
   * same split: the left columns are recomputed, the right columns are the
   * staff's own standing notes about how that program actually runs.
   */
  Program_Options: [
    'Event', 'Location', 'Type_Tag', 'Sessions_Tracked', 'Next_Date', 'Last_Date',
    'Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup', 'Staff_Notes'
  ]
};

/** Member_Roll columns the refresh must never overwrite — the staff's own knowledge. */
const MEMBER_ROLL_STAFF_COLUMNS = ['Usual_Guests', 'Dietary_Notes', 'Contact', 'Staff_Notes'];
/** Program_Options columns the refresh must never overwrite. */
const PROGRAM_OPTIONS_STAFF_COLUMNS = ['Typical_Attendance', 'Usual_Capacity', 'Room_Or_Setup', 'Staff_Notes'];

/**
 * Club_Members columns the roster refresh must never overwrite — the staff's
 * own decisions about who is on the list and what they eat. Everything else on
 * the row (contact details, which club, when they joined) is refreshed from
 * the person's most recent registration.
 */
const CLUB_MEMBERS_STAFF_COLUMNS = ['Lunch', 'Active', 'Staff_Notes'];

/** What a Club_Members row's Lunch cell can say. Mirrors the form's own yes/no, not the Hot/Cold a day resolves to. */
const CLUB_LUNCH_OPTIONS = ['Yes - Lunch', 'No Lunch'];

/** Day-of columns on Registrants that staff tick by hand. TRUE/FALSE checkboxes. */
const REGISTRANT_DAYOF_COLUMNS = ['Attended', 'Lunch_Served'];

/**
 * Day-of NUMBER columns on Registrants — how many meals of each kind THIS
 * PERSON accounted for. All five are independent: one row can carry a dined-in
 * day-1 meal and two taken-out subs at once, which is the case the old single
 * "was this takeaway?" checkbox could not express (see
 * HEADERS.Lunch_and_Event_Registrants).
 */
const REGISTRANT_MEAL_COUNT_COLUMNS = [
  'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge'
];

/**
 * Which Master_Lunch_Dashboard tally each per-registrant meal count feeds.
 * One list, so the rollup, the printed sign-in sheet and the dashboard's
 * numeric formatting can never drift apart on what counts as what.
 */
const MEAL_COUNT_TO_DASHBOARD_COLUMN = {
  Day1_Dined_In: 'Day_1_In-Person',
  Day1_Taken_Out: 'Day_1_Takeaway',
  Subs_Dined_In: 'Subs_In-Person',
  Subs_Taken_Out: 'Subs_Takeaway',
  Meals_In_Fridge: 'In_Fridge'
};

/**
 * Header names this workbook USED to use, and what they are now. Consulted by
 * buildHeaderProjection() when a canonical column is nowhere on the sheet, so
 * a workbook written by an earlier version keeps its values through the first
 * render on the new layout instead of silently reading blank.
 *
 * Dine_In_Count/Subs_Count meant "in-person unless the Meals_In_Fridge
 * checkbox was ticked", so they map to the DINED-IN halves of the new split —
 * the reading that is right for every row where that box was clear, which is
 * nearly all of them. buildDashboardRollup() handles the ticked ones (see
 * isLegacyFridgeCheckbox()).
 */
const LEGACY_HEADER_ALIASES = {
  Day1_Dined_In: ['Dine_In_Count'],
  Subs_Dined_In: ['Subs_Count']
};

/** Headers for the small "Today at Each Location" section (A) inside Master_Program_Dashboard. */
const TODAY_AT_LOCATIONS_HEADERS = ['Location', 'Programs Today', 'Sessions Today', 'Registered Today'];

/** Headers for Master_Lunch_Dashboard's "Today's Lunch Needs" block — its own short list. */
const TODAY_LUNCH_HEADERS = ['Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count', 'Served_Confirmed', 'Total_to_Order'];

/** Zero-based { header: index } map for a plain headers array (not a sheet). */
function getIndexMap(headersArray) {
  const map = {};
  headersArray.forEach((h, i) => { map[h] = i; });
  return map;
}

const MEAL_BUFFER_LOCATIONS = ['Narberth', 'Ashbridge'];
const CONFIG_LAYOUT = {
  MEAL_BUFFERS: {
    title: '🍱 Meal Buffer Amounts (Location x Hot/Cold)',
    startCol: 1,
    headers: ['Location', 'Lunch_Type', 'Standard_Buffer_Amount', 'Tester_Buffer_Amount']
  },
  ORDER_AHEAD: {
    title: '⏰ Order Ahead Time',
    startCol: 6,
    headers: ['Order_Ahead_Days']
  },
  ADMIN_NOTIFICATIONS: {
    title: '📧 Admin Notifications',
    startCol: 8,
    headers: ['Admin_Notification_Email']
  },
  CATERING_POLICY: {
    title: '🍽️ Lunch Service by Location',
    startCol: 10,
    headers: ['Location', 'Catering_Policy']
  },
  LINK_DISPLAY: {
    title: '🔗 Registration Link in Events',
    startCol: 13,
    headers: ['Link_Display']
  },
  AUTOMATION: {
    title: '⚙️ Automation & Trigger Ownership',
    startCol: 15,
    headers: ['Automation_Enabled', 'Trigger_Owner', 'Triggers_Verified_At']
  },
  CALENDAR_INVITES: {
    title: '📧 Calendar Invitations',
    startCol: 19,
    headers: ['Invite_Registrants']
  }
};
const CONFIG_SPACER_COLS = [5, 7, 9, 12, 14, 18];
const DEFAULT_MEAL_BUFFERS = { standardBufferAmount: 1, testerBufferAmount: 2 };
const DEFAULT_ORDER_AHEAD_DAYS = 7;

/**
 * Whether the registration link appears in the calendar event's description.
 *
 * "Show link" is the normal setting: attendees open the event and there is a
 * "📝 Register for X" link at the top of it.
 *
 * "Hide link" leaves the description with no registration link at all — for
 * programs where sign-up is handled at the desk and a self-serve link in a
 * shared calendar would be wrong. It has ONE real cost, and it is worth
 * understanding before choosing it: findExistingFormIdFromEvents() recovers a
 * lost form by reading its ID back out of an event description, and with no
 * link there is nothing to read. Form ownership then rests entirely on the
 * Script Properties registry and the Form_ID column of the dashboard, so a
 * workbook rebuilt from scratch under this setting will build new forms
 * rather than adopting the existing ones.
 */
const LINK_DISPLAY_OPTIONS = { SHOW: 'Show link', HIDE: 'Hide link' };
const LINK_DISPLAY_OPTION_LIST = Object.values(LINK_DISPLAY_OPTIONS);
const DEFAULT_LINK_DISPLAY = LINK_DISPLAY_OPTIONS.SHOW;

/**
 * Whether registrants are added as GUESTS to the Google Calendar event they
 * signed up for — so the program lands in their own calendar, with Google's
 * reminders attached, instead of only in this workbook.
 *
 * THIS ONE SENDS MAIL TO REAL PEOPLE, which is why it gets a switch of its own
 * rather than riding along with the rest of the sync. Adding a guest to an
 * event makes Google email them an invitation, and removing one emails a
 * cancellation. That is the intended behavior — an invitation nobody receives
 * is not an invitation — but it means the blast radius of a mistake here is
 * other people's inboxes, so "off" has to be reachable in one cell by anyone
 * with the workbook open, exactly like the automation kill switch.
 *
 * ONLY UPCOMING SESSIONS are ever touched, and only rows whose Program_Status
 * is Active. A cancelled or superseded registrant is REMOVED from the event's
 * guest list (see inviteRegistrantsToCalendarEvents()), which is what keeps a
 * cancellation from leaving somebody holding an invitation to a thing they
 * have withdrawn from.
 */
const CALENDAR_INVITE_OPTIONS = { INVITE: 'Invite registrants', NONE: 'Do not invite' };
const CALENDAR_INVITE_OPTION_LIST = Object.values(CALENDAR_INVITE_OPTIONS);
const DEFAULT_CALENDAR_INVITE = CALENDAR_INVITE_OPTIONS.INVITE;
const CONFIG_HEADER_ROW = 2;
const CONFIG_DATA_START_ROW = 3;
/** Types that actually need a Meal Buffer Amounts row in Config (a "Not Serving" day never does). */
const CATERED_LUNCH_TYPES = ['Hot', 'Cold'];
/** Full set of Type choices offered on Lunch_Schedule / Master_Lunch_Dashboard. */
const LUNCH_TYPE_OPTIONS = ['Hot', 'Cold', 'Not Serving'];
/** Lunch_and_Event_Registrants' own Lunch_Type domain — a PERSON'S lunch is Hot, Cold, or none, never "Not Serving" (that's a day-level fact). */
const REGISTRANT_LUNCH_TYPE_OPTIONS = ['Hot', 'Cold', 'No Lunch'];

/**
 * A location's STANDING catering posture. Until this existed the only way
 * to say "Zoom never serves lunch" was to hand-add a "Not Serving" row to
 * Lunch_Schedule for every Zoom date forever — so in practice those dates
 * read as merely unconfigured, which meant they were seeded onto the lunch
 * dashboard AND asked about lunch on their registration forms.
 *
 *   ALWAYS       Lunch unless told otherwise. Every upcoming date is seeded
 *                onto the dashboard; a per-date "Not Serving" row suppresses
 *                individual days. (A normal catering site.)
 *   BY_EXCEPTION Nothing is assumed. A date shows up only once someone adds
 *                a real Hot/Cold row for it on Lunch_Schedule. (A site that
 *                caters occasionally.)
 *   NEVER        No lunch, ever. The location never appears on the lunch
 *                dashboard, and its forms don't ask about lunch at all.
 *
 * Policy governs what gets SEEDED. Actual registered demand always wins —
 * see buildDashboardRollup(): if someone is down for lunch on a date, that
 * date appears no matter the policy, and gets flagged to the admin when
 * there's no menu behind it.
 */
const CATERING_POLICIES = {
  ALWAYS: 'Always',
  BY_EXCEPTION: 'By exception',
  NEVER: 'Never'
};
const CATERING_POLICY_OPTIONS = Object.values(CATERING_POLICIES);

/**
 * Seeded into Config on setup; edit there afterward, not here. An unknown
 * location falls back to ALWAYS — the safe direction, since a location that
 * wrongly shows up is a visible nuisance while one that wrongly hides is a
 * missed lunch order.
 */
const DEFAULT_CATERING_POLICY_BY_LOCATION = {
  Narberth: CATERING_POLICIES.ALWAYS,
  Ashbridge: CATERING_POLICIES.BY_EXCEPTION,
  Zoom: CATERING_POLICIES.NEVER
};
const FALLBACK_CATERING_POLICY = CATERING_POLICIES.ALWAYS;

// ---------------------------------------------------------------------------
// AUTOMATION KILL SWITCH + TRIGGER OWNERSHIP  (Config -> "⚙️ Automation & Trigger Ownership")
// ---------------------------------------------------------------------------
//
// THE PROBLEM THESE EXIST FOR. Apps Script installable triggers are private
// to the Google account that created them. ScriptApp.getProjectTriggers()
// returns only what the CURRENTLY RUNNING account can see, and
// ScriptApp.deleteTrigger() can only delete those. So when two accounts have
// each run "Check Triggers", both own a full set, both sets fire, and
// NEITHER account can see or remove the other's from code. writeTriggers()
// documents this at length; resetTriggersForHandler() fixes it only within
// one account.
//
// What IS shared across every account on this project: Script Properties,
// and this spreadsheet. That asymmetry is the whole design here — no account
// can DELETE another's trigger, but every account can write state that the
// other account's trigger will read and obey when it fires.
//
//   Automation_Enabled    A kill switch any account can flip. Every managed
//                         handler reads it as its first act and returns
//                         immediately when it's "No". You still cannot delete
//                         a trigger you can't see — but you can make it a
//                         no-op from your own login, without editor access.
//   Trigger_Owner         The one account that is supposed to hold the
//                         triggers. writeTriggers() refuses to run from any
//                         other account, which is what stops a SECOND
//                         invisible set from ever being created. The admin
//                         list (AUTHORIZED_ADMIN_EMAILS) holds more than one
//                         account on purpose; this narrows trigger creation
//                         to exactly one at a time without shrinking it.
//   Triggers_Verified_At  When that owner last rebuilt them, so "is this
//                         claim stale?" is answerable.
//
// See also recordHandlerRun() — the runtime detector that catches duplicate
// sets even when nobody has kept any of this bookkeeping honest.
// ---------------------------------------------------------------------------

const AUTOMATION_ENABLED_OPTIONS = ['Yes', 'No'];

/**
 * FAILS OPEN, and that is the opposite of requireAuthorizedAdmin() on
 * purpose. A blank/unreadable cell reads as ENABLED.
 *
 * The two failure costs are not symmetric. Wrongly enabled means one extra
 * sync, which is idempotent and self-correcting. Wrongly disabled means
 * every calendar sync and registration import silently stops — and because
 * nothing visibly breaks (the sheet just quietly goes stale), that can run
 * for weeks before anyone notices a registration never arrived. So a Config
 * tab that is missing, mid-rebuild, or throwing must never be able to
 * switch automation off by accident. Only the literal string "No" does.
 */
const DEFAULT_AUTOMATION_ENABLED = true;

/**
 * The handlers the kill switch governs, and that recordHandlerRun() attributes.
 *
 * onProgramFlagEditInstallable is DELIBERATELY NOT HERE, though writeTriggers()
 * installs it alongside these. The kill switch exists to stop AUTOMATION —
 * things that run on their own, at their own times, while nobody is watching.
 * That handler runs because somebody just clicked a checkbox, and it writes
 * exactly what they asked for. Pausing automation should not mean a tick
 * silently fails to save; the queue behind it would fill up instead, and the
 * next unpause would deliver a pile of changes nobody remembers making. It is
 * still listed by showTriggerStatus() as a trigger the workbook expects.
 */
const MANAGED_AUTOMATION_HANDLERS = ['syncCalendars', 'syncRegistrations', 'onCalendarChange'];

/** Every trigger writeTriggers() maintains — the automation ones plus the edit handler. */
const EXPECTED_TRIGGER_HANDLERS = MANAGED_AUTOMATION_HANDLERS.concat(['onProgramFlagEditInstallable']);

/**
 * Cross-execution cache TTL for the kill-switch read. onCalendarChange can
 * fire many times a minute during a busy calendar edit; without this, each
 * firing pays a spreadsheet open just to learn it should stop. A minute of
 * staleness on a pause is a fine trade — the point of the switch is stopping
 * a runaway within minutes, not within milliseconds.
 */
const AUTOMATION_FLAG_CACHE_SECONDS = 60;
const AUTOMATION_FLAG_CACHE_KEY = 'AUTOMATION_ENABLED_FLAG';

/** Script Property prefix for the per-handler "which accounts actually ran this" record. */
const HANDLER_ATTRIBUTION_PROP_PREFIX = 'HANDLER_RUN_BY_';

/**
 * How far back recordHandlerRun() looks when deciding whether more than one
 * account is firing the same handler. Wide enough that the once-daily
 * syncCalendars trigger is caught (two accounts' daily triggers can be up to
 * ~24h apart), which is the slowest handler and therefore what sets the floor.
 */
const HANDLER_ATTRIBUTION_WINDOW_MS = 26 * 60 * 60 * 1000;

/** How long an account's stamp for a handler suppresses re-stamping — see recordHandlerRun(). */
const HANDLER_ATTRIBUTION_THROTTLE_SECONDS = 10 * 60;

const FORM_FOOTER_BY_LOCATION = {
  Narberth: 'Additional notes or dietary needs? Let us know here.',
  Ashbridge: 'Additional notes or dietary needs? Let us know here.',
  Zoom: 'Additional notes? Let us know here.'
};
const DEFAULT_FORM_FOOTER = 'Additional notes or dietary needs?';

/**
 * THE ONE PLACE THE CENTER'S CONTACT DETAILS LIVE.
 *
 * They appear in three registrant-facing places that must never disagree with
 * each other: the sign-off at the bottom of every form description
 * (buildFormDescription()), the "more than three guests" note on the guest
 * count question (see getOrCreateTemplateForm()), and the printed sign-in
 * sheet's header. Change them here and all three follow.
 */
const CENTER_PHONE = '(610) 664-2366';
const CENTER_EMAIL = 'info@newhorizonsseniorcenter.org';

/** The standing sign-off appended to every form description. */
const FORM_ASSISTANCE_TAGLINE =
  `If you need additional assistance, please call ${CENTER_PHONE} or email ${CENTER_EMAIL}`;

const SYNC_LOOKAHEAD_DAYS = 60;
const LAST_SYNC_PROP_KEY = 'LAST_FORM_SYNC_TIME';

const FORMS_FOLDER_ID = '';
const FORMS_FOLDER_NAME = 'Program Registration Forms';

/** Returns the dedicated forms folder — by hardcoded ID if set, else find-or-create by name. */
function getOrCreateFormsFolder() {
  if (FORMS_FOLDER_ID) {
    try {
      return DriveApp.getFolderById(FORMS_FOLDER_ID);
    } catch (err) {
      log(`⚠️ FORMS_FOLDER_ID "${FORMS_FOLDER_ID}" could not be opened (${err}) — falling back to a by-name lookup.`);
    }
  }
  const folders = DriveApp.getFoldersByName(FORMS_FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    log(`📋 Using existing "${FORMS_FOLDER_NAME}" folder — copy this ID into FORMS_FOLDER_ID to skip this lookup next time: ${folder.getId()}`);
    return folder;
  }
  const folder = DriveApp.createFolder(FORMS_FOLDER_NAME);
  log(`Created Drive folder "${FORMS_FOLDER_NAME}" for generated registration forms. 📋 Copy this ID into FORMS_FOLDER_ID: ${folder.getId()}`);
  return folder;
}

/**
 * Bump whenever the template FORM STRUCTURE changes (new/renamed items,
 * different page flow, etc.) so cached template IDs in Script Properties
 * are abandoned and rebuilt fresh instead of silently drifting out of sync
 * with what processFormResponse() expects to find.
 */
// v5 is a CORRECTNESS bump, not a design change: v4's mode page carried the
// same title as the mode question, so every rebuild onto v4 threw partway
// through (see TEMPLATE_PAGE_TITLES.MODE) and left the form with placeholder
// grid rows. Any form that did get stamped v4 has to be redone.
//
// v6 changes only HELP TEXT — no item is added, removed or renamed, and the
// page flow is identical — so nothing in processFormResponse() cares. It is
// still a version bump because help text is the entire user-facing surface of
// these three fixes, and a form is created once and reused for as long as its
// group runs: without the bump, migrateFormsToCurrentTemplate() would never
// pick up the live forms and the wording would only ever reach groups created
// from now on. The three: the mode page now lists the dates it is asking
// about (buildModePageDateNote()), the guest reminder points at the form's own
// Back button instead of the browser's answer-destroying one
// (GUEST_ORDER_REMINDER), and the guest columns say outright that a solo
// registrant should ignore them (NO_GUESTS_NOTE).
const TEMPLATE_VERSION = 6;
const TEMPLATE_FORM_PROP_KEY = `TEMPLATE_FORM_ID_V${TEMPLATE_VERSION}`;

/** Stable marker titles used to find-and-customize specific items after copying a template. */
const TEMPLATE_ITEM_TITLES = {
  NAME: 'Name',
  PHONE: 'Phone Number',
  GUEST_COUNT: 'How many guests are you bringing?',
  // Roster grids: rows = dates, columns = PERSON_COLUMN_LABELS.
  ATTENDANCE_GRID: 'Who is Attending Each Date?',
  LUNCH_GRID: 'Who Needs Lunch Each Date?',
  ALLERGIES: 'Allergies / Dietary Needs',
  ADDITIONAL_NOTES: 'Anything Else?',
  ATTENDANCE_MODE: 'How would you like to sign up?',
  ALL_DATES_LUNCH_PEOPLE: 'Who Needs Lunch? (Applies to Every Date)'
};

/**
 * The title the per-location footer note used to occupy as a SectionHeaderItem
 * of its own. Nothing builds one any more — the note is the HELP TEXT of the
 * "Anything Else?" question now (see applyFormFooterNote()), because as a bare
 * section header it rendered as an unexplained bold line floating above the
 * last questions with nothing under it. Kept so a rebuild can recognize and
 * delete the stray header on forms that still carry one.
 */
const LEGACY_FOOTER_ITEM_TITLE = 'Footer Note';

/**
 * THE ATTENDANCE MODE CHOICES — what a respondent picks to say how much of the
 * form they need to fill in. Written as full sentences in the first person,
 * because the old labels ("Everyone, every date") were a description of a
 * data shape rather than an answer to a question, and the help text under them
 * said only "most people want the first option," which tells someone which box
 * to tick without ever telling them what either box does.
 *
 * TWO SPELLINGS OF EACH, and it matters which a given form gets: a [Monthly]
 * form genuinely covers one calendar month, so "all events this month" is
 * exactly right and is what people asked to read. A [Grouped] series runs
 * across however many months it runs across, and telling someone they are
 * signing up for "this month" when the dates listed above run into March would
 * be plainly untrue. buildAttendanceModeChoiceSet() picks the pair that
 * matches the form. Nothing downstream compares against these strings
 * directly: isAllDatesModeAnswer() and isClubModeAnswer() accept either
 * spelling AND the pre-v4 wording, and "pick specific dates" is simply
 * whatever neither of them claims — so responses collected before this change
 * keep parsing, and adding a fourth wording later breaks nothing.
 */
const ATTENDANCE_MODE_CHOICES = {
  ALL_DATES: 'I want to sign up for all events this month.',
  ALL_DATES_SERIES: 'I want to sign up for every date listed on this form.',
  INDIVIDUAL: 'I want to choose specific days this month to attend.',
  INDIVIDUAL_SERIES: 'I want to choose specific dates from the list to attend.'
};

/** Pre-v4 wording, still read so responses submitted against an older form keep importing correctly. */
const LEGACY_ATTENDANCE_MODE_CHOICES = {
  ALL_DATES: 'Everyone, every date',
  INDIVIDUAL: 'Let me pick specific dates/people'
};

/**
 * The club choice's fixed prefix. The rest of the label is the program's own
 * name, so it reads "I want to sign up for all future Book Club meetings." —
 * which is the sentence a club member would actually say. Parsed by prefix
 * (isClubModeAnswer()) rather than by exact match, since the title varies per
 * form and can change when a program is renamed.
 */
const CLUB_MODE_CHOICE_PREFIX = 'I want to sign up for all future ';
const CLUB_MODE_CHOICE_SUFFIX = ' meetings.';

/** "I want to sign up for all future Book Club meetings." */
function buildClubModeChoice(programTitle) {
  const title = String(programTitle || '').trim() || 'these';
  return `${CLUB_MODE_CHOICE_PREFIX}${title}${CLUB_MODE_CHOICE_SUFFIX}`;
}

/** True when this answer means "every date on this form" — either current spelling, or the pre-v4 one. */
function isAllDatesModeAnswer(value) {
  const v = String(value || '').trim();
  return v === ATTENDANCE_MODE_CHOICES.ALL_DATES ||
    v === ATTENDANCE_MODE_CHOICES.ALL_DATES_SERIES ||
    v === LEGACY_ATTENDANCE_MODE_CHOICES.ALL_DATES;
}

/** True when this answer means "join the club" — every date on this form AND every future one. */
function isClubModeAnswer(value) {
  const v = String(value || '').trim();
  return v.indexOf(CLUB_MODE_CHOICE_PREFIX) === 0 && v.endsWith(CLUB_MODE_CHOICE_SUFFIX);
}

/**
 * The two or three choices this form's Attendance Mode question offers, and
 * the page each one goes to. Built per form because both the wording (monthly
 * vs series) and the club option depend on what the form covers.
 */
function buildAttendanceModeChoiceSet(options) {
  options = options || {};
  const isSeries = !!options.isFixed;
  return {
    allDates: isSeries ? ATTENDANCE_MODE_CHOICES.ALL_DATES_SERIES : ATTENDANCE_MODE_CHOICES.ALL_DATES,
    individual: isSeries ? ATTENDANCE_MODE_CHOICES.INDIVIDUAL_SERIES : ATTENDANCE_MODE_CHOICES.INDIVIDUAL,
    club: options.isClub ? buildClubModeChoice(options.programTitle) : null
  };
}

/**
 * The help text under the Attendance Mode question. Says what each option
 * DOES, in the same order the options appear — replacing "Most people want
 * the first option," which was advice about a form rather than information
 * about a choice.
 */
function buildAttendanceModeHelpText(choiceSet) {
  const lines = [
    `• "${choiceSet.allDates}" — one quick page. We book you (and any guests) for every date listed on this form, and you tell us once who is eating.`,
    `• "${choiceSet.individual}" — a grid of the dates, so you can tick exactly which ones each person is coming to.`
  ];
  if (choiceSet.club) {
    lines.push(`• "${choiceSet.club}" — the same as signing up for every date here, and we keep you on the list for future meetings too, so you never have to fill this in again. Call ${CENTER_PHONE} any time to come off the list.`);
  }
  return lines.join('\n');
}

/**
 * How much of the date list the mode page will carry, in characters.
 *
 * Google Forms rejects an over-long help text outright, and a section
 * description that runs for several screens has stopped being read long before
 * it hits any limit. A form with an unusually long date list shows as many as
 * fit and says how many more there are.
 */
const MODE_PAGE_DATES_CHAR_BUDGET = 1200;

/**
 * The section description for the mode page: the dates this form actually
 * covers, one per line.
 *
 * WHY THIS HAS TO BE REPEATED HERE. The mode page asks the one question the
 * whole form turns on — "every date, or let me pick?" — and until now it asked
 * it with the dates nowhere on screen. They ARE on the form
 * (buildFormDescription() lists every one of them), but a Google Forms
 * description renders at the top of the FIRST page only; by the time somebody
 * has answered their name, their phone, a guest count and possibly a page of
 * guest names, that list is several sections behind them. So the choice was
 * being made from memory, and "sign me up for every date" was being picked by
 * people who could no longer see how many dates that was or when they ran to.
 *
 * A page break's own help text is the section description, which is the one
 * place on this page that can hold prose — so the list goes there, immediately
 * above the question it informs.
 */
function buildModePageDateNote(dateLabels) {
  const labels = (dateLabels || []).filter(Boolean);
  if (labels.length === 0) return '';

  const lines = [];
  let used = 0;
  for (const label of labels) {
    const line = `• ${label}`;
    if (used + line.length > MODE_PAGE_DATES_CHAR_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
  }
  // Never show a heading promising dates and then no dates: a budget too small
  // for even one line means something is badly wrong with the labels, and a
  // bare heading is worse than saying nothing.
  if (lines.length === 0) return '';

  const hidden = labels.length - lines.length;
  const heading = labels.length === 1
    ? 'This form covers one date:'
    : `This form covers these ${labels.length} dates:`;
  return `${heading}\n${lines.join('\n')}` +
    (hidden > 0 ? `\n…and ${hidden} more — the full list is at the top of the first page.` : '');
}

/**
 * The title of the guest-count question on templates v1/v2 — a bare "Guest
 * Count" list that branched to a guest-detail page per count and then a roster
 * page per count. v3 removed guest routing entirely; v4 brings a much smaller
 * version of it back (see getOrCreateTemplateForm()) under a DIFFERENT title,
 * so this stays an unambiguous marker for "this form is still on v1/v2".
 */
const LEGACY_GUEST_COUNT_TITLE = 'Guest Count';

/**
 * Titles of every page break the template creates. Stable markers, like
 * TEMPLATE_ITEM_TITLES — restoreLunchQuestionsOnForm() needs ALL_DATES to put
 * a re-added lunch question back on the right page instead of at the end of
 * the form, and addTemplateItemsToForm() wires its navigation by object rather
 * than by title, so these are for finding pages after the fact.
 *
 * GUEST_1/2/3 are the guest-name pages the guest-count question routes to.
 * There is deliberately NO page for "no guests": that choice jumps straight to
 * the mode page, which is one fewer section for the commonest answer and one
 * fewer jump that can go wrong.
 */
const TEMPLATE_PAGE_TITLES = {
  GUEST_1: 'Your Guest',
  GUEST_2: 'Your Guests',
  GUEST_3: 'Your Guests (3)',
  // DELIBERATELY NOT the same text as TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE,
  // which is the question that sits ON this page. They read almost the same to
  // a person and it is tempting to use one string for both — but form items
  // are looked up BY TITLE, and a page break sharing a question's title is
  // returned by those lookups first (it is added to the form first). The
  // caller then calls asListItem() on a PageBreakItem and Forms answers
  // "Invalid conversion for item type: PAGE_BREAK", which is what this cost
  // the first time. Every page title here must differ from every item title in
  // TEMPLATE_ITEM_TITLES.
  MODE: 'Choose How to Sign Up',
  ALL_DATES: 'Sign Up For Every Date',
  SPECIFIC_DATES: 'Pick Your Dates'
};

/**
 * Grid columns and all-dates lunch choices. FIXED at four entries on every
 * form: the roster grids are built once, at template time, and the guest-count
 * question routes people to the right NAME fields rather than varying these.
 * A column whose matching guest name was left blank is simply ignored at parse
 * time, so a solo registrant ticking only "You" is unaffected by the three
 * guest columns sitting beside it.
 */
const PERSON_COLUMN_LABELS = ['You', 'Guest 1', 'Guest 2', 'Guest 3'];

/** Max guests one submission can bring — the number of guest-name pages the form offers. */
const MAX_GUESTS = PERSON_COLUMN_LABELS.length - 1;

/**
 * The reminder attached to every question that refers to guests by NUMBER
 * rather than by name.
 *
 * Google Forms shows one page at a time and does not carry earlier answers
 * forward onto later ones, so by the time someone reaches the roster grid the
 * names they typed are off-screen and "Guest 2" is a column heading with
 * nothing behind it. There is no way to interpolate the names into the grid —
 * the grid is written before anyone answers — so the honest fix is to say
 * where the answer is and how to go back and look at it.
 *
 * WHICH back button matters, and this used to say the wrong one. Google Forms
 * puts its own "Back" button at the BOTTOM LEFT of every page after the first,
 * and that button walks back through the form with every answer still in
 * place. The BROWSER's back arrow does not: it leaves the form page
 * altogether, and what the respondent comes back to is a blank form with
 * everything they had typed gone. Telling someone to use the browser's arrow
 * to "check a name" was therefore advice that destroyed the registration they
 * were part-way through filling in.
 */
const GUEST_ORDER_REMINDER =
  'Guest 1, Guest 2 and Guest 3 are the names you typed earlier, in that order. ' +
  'Not sure which is which? Use the "Back" button at the BOTTOM LEFT of this form to look — ' +
  'nothing you have entered will be lost, and "Next" brings you straight back here. ' +
  'Do not use your browser\'s back arrow: that leaves the form and loses your answers.';

/**
 * The note that tells a solo registrant the guest boxes are not their problem.
 *
 * The form asks the guest count FIRST and routes accordingly, so somebody
 * coming alone never types a guest name (see getOrCreateTemplateForm()). What
 * they DO still meet is Guest 1/2/3 sitting in every roster grid and in the
 * all-dates lunch checkbox — because those columns are baked into the template
 * once, at build time, and cannot vary per respondent. Met with no
 * explanation, an empty labelled box reads as a question you are expected to
 * answer, and the careful thing to do with a question you cannot answer is to
 * stop and ring the office. Saying "ignore them" outright is cheaper than any
 * amount of inferring.
 */
const NO_GUESTS_NOTE =
  'Coming on your own? Ignore the Guest 1, Guest 2 and Guest 3 boxes completely — ' +
  'leave them blank. You do not need to tick them, clear them, or put anything in them.';

/** Placeholder row used on a freshly-built template's grids, before the first real date list is set. */
const TEMPLATE_GRID_PLACEHOLDER_ROW = '(dates will be filled in automatically)';

/**
 * Returns THE template form — one template for every group. Built once and
 * reused forever after (keyed by TEMPLATE_VERSION).
 *
 * PAGE FLOW (v4):
 *
 *   Page 1  Name (required)
 *           Phone Number (required)
 *           "How many guests are you bringing?" — None / 1 / 2 / 3, which
 *             jumps to exactly one of:
 *
 *   "Your Guest"       Guest 1 Name (required)                    -> MODE
 *   "Your Guests"      Guest 1 + Guest 2 Name (both required)     -> MODE
 *   "Your Guests (3)"  Guest 1 + 2 + 3 Name (all required)        -> MODE
 *   (None)                                                        -> MODE
 *
 *   MODE    "How would you like to sign up?" (required), branching to:
 *
 *   "Sign Up For Every Date"  ALL_DATES_LUNCH_PEOPLE checkbox (who eats,
 *                             applied to every session date, including dates
 *                             added to a Grouped series later)    -> SUBMIT
 *
 *   "Pick Your Dates"         ATTENDANCE_GRID + LUNCH_GRID roster grids,
 *                             dates as rows and PERSON_COLUMN_LABELS as
 *                             columns                             -> SUBMIT
 *
 * Both branch pages end with Allergies and an "Anything Else?" catch-all whose
 * HELP TEXT carries the per-location footer note.
 *
 * WHY THE GUEST COUNT IS BACK, CAREFULLY. v3 removed it entirely — every form
 * showed three optional "Guest N Name" boxes and the headcount was however
 * many you filled in. That is structurally safe but reads badly: the great
 * majority of registrants bring nobody, and were met with three empty boxes
 * they had to work out they were allowed to ignore, then a roster grid with
 * three columns for people who did not exist. Asking the question first and
 * routing to the matching page means a solo registrant never sees a guest
 * field at all.
 *
 * The v1/v2 version of this was genuinely broken, and the difference is worth
 * being precise about, because "we tried this and it mis-routed" is the
 * obvious objection. That template branched TWICE — once per count to a
 * guest-detail page, and again per count to a roster page — eight sections
 * deep, and Forms silently falls through to the NEXT section in document order
 * whenever a jump is missing, so a missing jump anywhere put you on another
 * count's page. Here there is exactly one guest branch, every one of its
 * targets is a page whose own setGoToPage() points at the SAME mode page, and
 * the mode page is the next section in document order anyway — so the
 * fall-through case and the intended case are the same page. A dropped jump
 * degrades to "you see one extra section", not "you are catered for the wrong
 * number of people". The old count/names mismatch is gone too, since a guest
 * page's name fields are REQUIRED: picking 3 and typing 2 names cannot submit.
 *
 * IMPORTANT ordering note: in Apps Script Forms, a page's contents are
 * whatever items were added between ITS PageBreakItem and the NEXT one —
 * order of addition, not order of variable creation, decides this.
 */
function getOrCreateTemplateForm() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(TEMPLATE_FORM_PROP_KEY);
  if (existingId) {
    try {
      return FormApp.openById(existingId);
    } catch (err) {
      log(`⚠️ Stored template form ${existingId} could not be opened (${err}) — building a fresh template.`);
    }
  }

  const form = FormApp.create('TEMPLATE — Registration Form Base (do not edit or delete)');
  addTemplateItemsToForm(form);

  props.setProperty(TEMPLATE_FORM_PROP_KEY, form.getId());
  log(`Created template registration form: ${form.getId()}`);
  return form;
}

/**
 * Writes the current template's settings, questions and navigation onto `form`
 * — which is EMPTY when called from getOrCreateTemplateForm(), and freshly
 * emptied when called from rebuildFormFromCurrentTemplate() to bring a live
 * form built on an older template up to date.
 *
 * The Attendance Mode choices are seeded with the generic (monthly, no club)
 * wording here and re-written per form by applyAttendanceModeChoices() once
 * the caller knows what the form actually covers — the template itself belongs
 * to no program, so it cannot know whether to offer a club option or how to
 * name it.
 */
function addTemplateItemsToForm(form) {
  form.setCollectEmail(true);
  form.setAllowResponseEdits(true);

  // --- Page 1: who is registering --------------------------------------
  form.addTextItem().setTitle(TEMPLATE_ITEM_TITLES.NAME).setRequired(true);
  form.addTextItem()
    .setTitle(TEMPLATE_ITEM_TITLES.PHONE)
    .setHelpText('So we can reach you if a program changes, or if there is a problem with your registration.')
    .setRequired(true);
  const guestCountItem = form.addListItem()
    .setTitle(TEMPLATE_ITEM_TITLES.GUEST_COUNT)
    .setHelpText('Guests are anyone coming with you. Pick a number and we will ask for their names next — ' +
      `if you are coming on your own, choose "${GUEST_COUNT_NONE_LABEL}" and skip it entirely. ` +
      `Bringing more than ${MAX_GUESTS} guests? Please call us on ${CENTER_PHONE} and we will add them for you.`)
    .setRequired(true);

  // --- One page per guest count ----------------------------------------
  // Each one jumps to the mode page below, which is also the next section in
  // document order after the last of them — see getOrCreateTemplateForm().
  const guestPages = [];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    const page = form.addPageBreakItem().setTitle(guestPageTitle(g));
    for (let n = 1; n <= g; n++) {
      form.addTextItem()
        .setTitle(`Guest ${n} Name`)
        .setHelpText(n === 1 && g > 1 ? 'The order you enter them in is the order we will list them in later.' : '')
        .setRequired(true);
    }
    guestPages.push(page);
  }

  // --- The mode page ----------------------------------------------------
  const modePage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.MODE);
  const modeItem = form.addListItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE).setRequired(true);

  // --- Branch A: every date ---------------------------------------------
  const allDatesPage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.ALL_DATES);
  addAllDatesLunchItem(form);
  addClosingQuestions(form);
  allDatesPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);

  // --- Branch B: per-date roster ----------------------------------------
  const specificPage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  addAttendanceGridItem(form);
  addLunchGridItem(form);
  addClosingQuestions(form);
  specificPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);

  // Navigation, written last so every page it names already exists.
  guestPages.forEach(page => page.setGoToPage(modePage));
  const guestChoices = [guestCountItem.createChoice(GUEST_COUNT_NONE_LABEL, modePage)];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    guestChoices.push(guestCountItem.createChoice(String(g), guestPages[g - 1]));
  }
  guestCountItem.setChoices(guestChoices);

  applyAttendanceModeChoices(form, {}, { modeItem, allDatesPage, specificPage });
}

/** The "no guests" choice. A word rather than "0" — it is an answer, not a quantity. */
const GUEST_COUNT_NONE_LABEL = 'Just me — no guests';

/** Page title for the N-guest page. Distinct per count so form.getItems() lookups are unambiguous. */
function guestPageTitle(guestCount) {
  if (guestCount === 1) return TEMPLATE_PAGE_TITLES.GUEST_1;
  if (guestCount === 2) return TEMPLATE_PAGE_TITLES.GUEST_2;
  return TEMPLATE_PAGE_TITLES.GUEST_3;
}

/**
 * Sets (or re-sets) the Attendance Mode question's choices and help text for
 * ONE form — the two standard options, plus the club option when the program
 * is tagged [Club].
 *
 * `refs` lets addTemplateItemsToForm() pass the items it has just created;
 * every other caller holds only a live form, so they are looked up by title.
 * A form whose branch pages cannot be found is left exactly as it is rather
 * than being given choices that navigate nowhere.
 */
function applyAttendanceModeChoices(form, options, refs) {
  refs = refs || {};
  const items = refs.modeItem ? null : form.getItems();
  const findPage = title => (items || []).filter(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === title)[0] || null;

  // Type-guarded as well as titled: a PAGE_BREAK can never be the question,
  // and a title collision between a page and a question must fail visibly at
  // build time rather than by handing back an item asListItem() will reject.
  const modeItem = refs.modeItem ||
    ((items || []).filter(it =>
      it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE &&
      it.getType() !== FormApp.ItemType.PAGE_BREAK)[0] || null);
  const allDatesPage = refs.allDatesPage || findPage(TEMPLATE_PAGE_TITLES.ALL_DATES);
  const specificPage = refs.specificPage || findPage(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  if (!modeItem || !allDatesPage || !specificPage) {
    log(`ℹ️ Could not set the sign-up options on form ${form.getId()} — its mode question or branch pages are missing.`);
    return null;
  }

  const list = modeItem.asListItem ? modeItem.asListItem() : modeItem;
  const choiceSet = buildAttendanceModeChoiceSet(options);
  const wantedValues = [choiceSet.allDates, choiceSet.individual];
  // The club option lands on the SAME page as "every date": joining a club is
  // signing up for everything on this form plus everything after it, so the
  // questions it needs to ask are identical. The difference is recorded at
  // import time (see processFormResponse()), not in the form's shape.
  if (choiceSet.club) wantedValues.push(choiceSet.club);
  const wantedHelp = buildAttendanceModeHelpText(choiceSet);

  // SKIP IF NOTHING CHANGED. This runs on every sync for every form that gains
  // a date, and a Forms write is both a remote round trip and a new form
  // revision — re-asserting identical choices every hour would fill a form's
  // history with edits that changed nothing. Comparing the labels and the help
  // text catches every case that matters: the page targets are derived from
  // the same choiceSet, so labels that match were built the same way.
  try {
    const current = list.getChoices().map(c => c.getValue());
    const same = current.length === wantedValues.length &&
      current.every((v, i) => v === wantedValues[i]) &&
      String(list.getHelpText() || '') === wantedHelp;
    if (same) return choiceSet;
  } catch (err) {
    // Unreadable choices — fall through and write them fresh.
  }

  list.setChoices(wantedValues.map(value =>
    list.createChoice(value, value === choiceSet.individual ? specificPage : allDatesPage)));
  list.setHelpText(wantedHelp);
  invalidateFormItemIndex(form.getId());
  return choiceSet;
}

/**
 * The two questions that close BOTH branch pages.
 *
 * There used to be a third thing here: a bare SectionHeaderItem holding the
 * per-location footer note, sitting between Allergies and "Anything Else?".
 * On the rendered form that is a bold line of text floating on its own above
 * the last question, attached to nothing — it reads as a heading for a section
 * that never arrives. The note is now the "Anything Else?" question's own help
 * text (applyFormFooterNote()), which is where it was always trying to be:
 * the sentence that tells you what to put in that box.
 */
function addClosingQuestions(form) {
  form.addTextItem()
    .setTitle(TEMPLATE_ITEM_TITLES.ALLERGIES)
    .setHelpText('Anything we should know about food — allergies, no dairy, soft foods. Leave blank if none.');
  form.addParagraphTextItem().setTitle(TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES);
}

/** The all-dates branch's who-eats checkbox. Appended wherever the cursor is — callers position it. */
function addAllDatesLunchItem(form) {
  return form.addCheckboxItem().setTitle(TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE)
    .setChoiceValues(PERSON_COLUMN_LABELS)
    .setHelpText('Tick everyone who will be eating. This applies only to the dates lunch is ' +
      'actually served on.\n\n' + NO_GUESTS_NOTE + '\n\n' + GUEST_ORDER_REMINDER);
}

/** The per-date attendance roster grid. Rows are set later by applyFormDateLabels(). */
function addAttendanceGridItem(form) {
  return form.addCheckboxGridItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID)
    .setHelpText('Tick a box for each person on each date they are coming.\n\n' +
      NO_GUESTS_NOTE + '\n\n' + GUEST_ORDER_REMINDER)
    .setRows([TEMPLATE_GRID_PLACEHOLDER_ROW]).setColumns(PERSON_COLUMN_LABELS);
}

/** The per-date lunch roster grid. Rows are set later by applyFormDateLabels(). */
function addLunchGridItem(form) {
  return form.addCheckboxGridItem().setTitle(TEMPLATE_ITEM_TITLES.LUNCH_GRID)
    .setHelpText('Only the dates lunch is served on appear here. Tick a box for each person on ' +
      'each date they want lunch.\n\n' + NO_GUESTS_NOTE + '\n\n' + GUEST_ORDER_REMINDER)
    .setRows([TEMPLATE_GRID_PLACEHOLDER_ROW]).setColumns(PERSON_COLUMN_LABELS);
}

/**
 * Builds the form description, including the exact dates being registered
 * for — one date per line, not one long semicolon-separated line. Adds a
 * note when any date is lunch-free, a line about club membership on a club
 * form, and — always, last — the assistance tagline, so every form ends with
 * a way to reach a person.
 */
function buildFormDescription(locations, dateLabels, isFixed, hasLunchDates, options) {
  options = options || {};
  const list = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  const dateList = dateLabels.map(label => `• ${label}`).join('\n');
  const heading = list.length > 1
    ? `Locations: ${list.join(', ')}\n(This program runs at more than one location — each date below says where.)`
    : `Location: ${list[0] || ''}`;
  let description = `${heading}\n\nDates:\n${dateList}\n\nPlease register below.`;
  if (hasLunchDates === false) {
    // Nothing on this form is catered, so the form isn't asking about lunch
    // at all (see syncLunchQuestionsOnForm()) — say so rather than leaving
    // its absence to be guessed at.
    description += `\n\nNote: Lunch is not provided on any of these dates, so there is nothing to choose.`;
  } else if (dateLabels.some(l => l.indexOf('No Lunch Served') !== -1)) {
    description += `\n\nNote: Lunch is not provided on any date marked "No Lunch Served" above.`;
  }
  if (options.isClub) {
    const title = String(options.programTitle || '').trim();
    description += `\n\nThis is a club. You can sign up for ${title ? `all future ${title} meetings` : 'all future meetings'} ` +
      `in one go — you will stay on the list from then on, and will not need to fill this in again each month.`;
  } else if (isFixed) {
    description += `\n\nTip: Coming to every session? Pick the first sign-up option and you will only have to ` +
      `tell us your lunch preference once.`;
  }
  description += `\n\n${FORM_ASSISTANCE_TAGLINE}`;
  return description;
}

/**
 * Persistent groupKey -> Form_ID map (Script Properties), so a group's
 * sessions can be temporarily removed (e.g. triaged away) without spawning
 * a duplicate form the next time it's seen. findExistingFormIdFromEvents()
 * is a further fallback recovering a form ID directly from a calendar
 * event's own description.
 */
const FORM_REGISTRY_PROP_KEY = 'FORM_REGISTRY_MAP_V1';

/**
 * Both persistent registries below are read once per execution and written
 * back at most once, via flushPersistentRegistries(). They used to
 * get+JSON.parse+stringify+set on EVERY entry — once per group in
 * syncCalendars(), and once per PERSON PER RESPONSE in
 * processAllDatesResponse(), which is the worst offender since a party of
 * four cost four full round trips to the property store. The flush is
 * called as soon as the loop that dirties them finishes (not at the very
 * end of the run) so the crash window stays about as small as it was.
 */
let __formRegistryCache = null;
let __formRegistryDirty = false;
let __allDatesRegistryCache = null;
let __allDatesRegistryDirty = false;

function getPersistentFormRegistry() {
  if (__formRegistryCache) return __formRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_REGISTRY_PROP_KEY);
  __formRegistryCache = raw ? JSON.parse(raw) : {};
  return __formRegistryCache;
}

function savePersistentFormRegistryEntry(groupKey, formId) {
  const registry = getPersistentFormRegistry();
  if (registry[groupKey] === formId) return;
  registry[groupKey] = formId;
  __formRegistryDirty = true;
}

/**
 * Persistent registry of "sign up for all dates" respondents, keyed by
 * Form_ID, so that when a Grouped-series form later gains NEW dates (the
 * series keeps running), syncRegistrations() can retroactively add rows
 * for those new dates for everyone who originally chose "all dates" —
 * otherwise "all dates" would silently only mean "all dates that existed
 * at the moment I registered."
 */
const ALL_DATES_REGISTRY_PROP_KEY = 'ALL_DATES_REGISTRANTS_V1';

function getAllDatesRegistry() {
  if (__allDatesRegistryCache) return __allDatesRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(ALL_DATES_REGISTRY_PROP_KEY);
  __allDatesRegistryCache = raw ? JSON.parse(raw) : {};
  return __allDatesRegistryCache;
}

function saveAllDatesRegistryEntry(formId, entry) {
  const registry = getAllDatesRegistry();
  if (!registry[formId]) registry[formId] = [];
  const key = `${normalizeNameKey(entry.name)}|${entry.personType}`;
  registry[formId] = registry[formId].filter(e => `${normalizeNameKey(e.name)}|${e.personType}` !== key);
  registry[formId].push(entry);
  __allDatesRegistryDirty = true;
}

/**
 * Which template version each LIVE (per-group) form was built from — the
 * thing that was missing when TEMPLATE_VERSION went to 3: bumping it rebuilt
 * the cached TEMPLATE, but every form already copied from an older one kept
 * its old questions, and those are the forms people actually fill in. See
 * migrateFormsToCurrentTemplate(), which reads this to know what it can skip
 * without an API call.
 */
const FORM_TEMPLATE_VERSION_PROP_KEY = 'FORM_TEMPLATE_VERSIONS_V1';

let __formTemplateVersionCache = null;
let __formTemplateVersionDirty = false;

function getFormTemplateVersions() {
  if (__formTemplateVersionCache) return __formTemplateVersionCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_TEMPLATE_VERSION_PROP_KEY);
  __formTemplateVersionCache = raw ? JSON.parse(raw) : {};
  return __formTemplateVersionCache;
}

function setFormTemplateVersion(formId, version) {
  const versions = getFormTemplateVersions();
  if (versions[formId] === version) return;
  versions[formId] = version;
  __formTemplateVersionDirty = true;
}

/** Writes back whichever persistent registries were actually modified. Safe to call repeatedly — a clean registry costs nothing. */
function flushPersistentRegistries() {
  const props = PropertiesService.getScriptProperties();
  if (__formRegistryDirty && __formRegistryCache) {
    props.setProperty(FORM_REGISTRY_PROP_KEY, JSON.stringify(__formRegistryCache));
    __formRegistryDirty = false;
  }
  if (__allDatesRegistryDirty && __allDatesRegistryCache) {
    props.setProperty(ALL_DATES_REGISTRY_PROP_KEY, JSON.stringify(__allDatesRegistryCache));
    __allDatesRegistryDirty = false;
  }
  if (__formLabelFingerprintDirty && __formLabelFingerprintCache) {
    props.setProperty(FORM_LABEL_FINGERPRINT_PROP_KEY, JSON.stringify(__formLabelFingerprintCache));
    __formLabelFingerprintDirty = false;
  }
  if (__formTemplateVersionDirty && __formTemplateVersionCache) {
    props.setProperty(FORM_TEMPLATE_VERSION_PROP_KEY, JSON.stringify(__formTemplateVersionCache));
    __formTemplateVersionDirty = false;
  }
}

const SYNC_LOCK_WAIT_MS = 10 * 1000;

const TIMEZONE = SpreadsheetApp.getActiveSpreadsheet()
  ? SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone()
  : Session.getScriptTimeZone();

/**
 * A header cell's canonical name. labelManualEntryColumns() decorates the
 * hand-entry columns' header cells with MANUAL_ENTRY_PREFIX, so the literal
 * cell text on Master_Lunch_Dashboard reads "✍️ Standard_Buffer" — every
 * header lookup has to see through that decoration, or a column (and, for
 * findAllHeaderRows(), the entire header row it marks) becomes invisible.
 */
function normalizeHeaderText(value) {
  const text = String(value === null || value === undefined ? '' : value).trim();
  return text.indexOf(MANUAL_ENTRY_PREFIX) === 0 ? text.substring(MANUAL_ENTRY_PREFIX.length).trim() : text;
}

/** Scans Row 1 for an exact header match and returns its 1-based column index (flat, single-header sheets like Config). */
function getColumnIndex(sheet, colName) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return -1;
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (let i = 0; i < headerRow.length; i++) {
    if (normalizeHeaderText(headerRow[i]) === colName) return i + 1;
  }
  log(`⚠️ getColumnIndex: header "${colName}" not found on sheet "${sheet.getName()}"`);
  return -1;
}

/** Convenience wrapper: builds a { headerName: colIndex } map from Row 1 in one pass. */
function getHeaderMap(sheet) {
  return getHeaderMapAt(sheet, 1);
}

/** Same as getHeaderMap(), but for a header at an arbitrary row. */
function getHeaderMapAt(sheet, headerRow) {
  const map = {};
  if (!headerRow || headerRow < 1) return map;
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return map;
  const headerRowValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  headerRowValues.forEach((h, i) => {
    const name = normalizeHeaderText(h);
    if (name && map[name] === undefined) map[name] = i + 1;
  });
  return map;
}

/**
 * Scans down row-by-row (up to maxRowsToScan) for EVERY row that contains
 * uniqueHeaderText anywhere in it, returning all matching row numbers. Every
 * date-bearing tab now has TWO such header rows (Upcoming + Past sub-tables
 * — see section 6), so this replaces the old single-header-row finder.
 */
function findAllHeaderRows(sheet, uniqueHeaderText, maxRowsToScan) {
  const lastRow = Math.min(Math.max(sheet.getLastRow(), 0), maxRowsToScan || 3000);
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const rows = [];
  for (let r = 0; r < values.length; r++) {
    if (values[r].some(v => normalizeHeaderText(v) === uniqueHeaderText)) rows.push(r + 1);
  }
  return rows;
}

/** Locates Master_Program_Dashboard's session-table header rows (unique marker: 'Event_ID'). */
function findProgramSessionHeaderRows(sheet) {
  return findAllHeaderRows(sheet, 'Event_ID', 5000);
}

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    log(`Created missing tab: ${name}`);
  }
  return sheet;
}

/**
 * Reads a range as values, but substitutes the formula string wherever a
 * cell contains one — use this instead of plain getValues() whenever rows
 * are about to be copied/relocated elsewhere (a plain getValues() read
 * would flatten a HYPERLINK formula down to dead plain text).
 */
function getRowsPreservingFormulas(sheet, startRow, startCol, numRows, numCols) {
  const range = sheet.getRange(startRow, startCol, numRows, numCols);
  const values = range.getValues();
  const formulas = range.getFormulas();
  return values.map((row, r) => row.map((val, c) => formulas[r][c] || val));
}

/**
 * Generic "dropdown restricted to a predefined list" helper — every
 * dropdown in the workbook is built on top of this ONE implementation.
 */
function applyValueListValidationBounded(sheet, colIndex, options, startRow, numRows) {
  if (!colIndex || colIndex < 1 || numRows < 1 || !options || options.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build();
  sheet.getRange(startRow, colIndex, numRows, 1).setDataValidation(rule);
}

/**
 * Same, but SUGGESTING rather than restricting: the list drops down, and a
 * value that isn't on it is still accepted. For cells where the list is a
 * convenience and the vocabulary is genuinely open — a walk-in's name, a
 * pasted location — rejecting the input is worse than not knowing it.
 */
function applyOpenValueListValidationBounded(sheet, colIndex, options, startRow, numRows) {
  if (!colIndex || colIndex < 1 || numRows < 1 || !options || options.length === 0) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(true).build();
  sheet.getRange(startRow, colIndex, numRows, 1).setDataValidation(rule);
}

/** Same as above, from startRow to the end of the sheet. */
function applyValueListValidationRange(sheet, colIndex, options, startRow) {
  if (!colIndex || colIndex < 1) return;
  const numRows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
  applyValueListValidationBounded(sheet, colIndex, options, startRow, numRows);
}

/** Applies a dropdown restricted to MANUAL_OVERRIDE_OPTIONS, starting at row 2 (unbounded — general utility). */
function applyManualOverrideValidation(sheet, colIndex) {
  applyManualOverrideValidationRange(sheet, colIndex, 2);
}

function applyManualOverrideValidationRange(sheet, colIndex, startRow) {
  applyValueListValidationRange(sheet, colIndex, MANUAL_OVERRIDE_OPTIONS, startRow);
}

function applyManualOverrideValidationBounded(sheet, colIndex, startRow, numRows) {
  applyValueListValidationBounded(sheet, colIndex, MANUAL_OVERRIDE_OPTIONS, startRow, numRows);
}

/** Deterministic color fallback for a location not in LOCATION_COLOR_MAP. */
function getLocationColor(locationName) {
  if (LOCATION_COLOR_MAP[locationName]) return LOCATION_COLOR_MAP[locationName];
  let hash = 0;
  for (let i = 0; i < locationName.length; i++) {
    hash = locationName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hslToPastelHex(hueAvoidingReservedColors(hash), 45, 85);
}

/** Dropdown restricted to the current CALENDAR_MAP location names, from startRow to the end of the sheet. */
function applyLocationValidationRange(sheet, colIndex, startRow) {
  applyValueListValidationRange(sheet, colIndex, Object.values(CALENDAR_MAP), startRow);
}

/** Same, but bounded to an exact number of rows. */
function applyLocationValidationBounded(sheet, colIndex, startRow, numRows) {
  applyValueListValidationBounded(sheet, colIndex, Object.values(CALENDAR_MAP), startRow, numRows);
}

/** Builds one color-coded conditional format rule per known location, across one or more ranges. */
function buildLocationColorRules(ranges) {
  if (ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(loc)
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/**
 * Same colors as buildLocationColorRules(), but painted across a row BAND
 * rather than just the Location cell, keyed off that row's own Location
 * column — so a lunch schedule mixing several locations on the same date
 * reads as blocks of color instead of one tinted cell per row.
 *
 * excludeCols (1-based) carves out the cells that already carry their own
 * meaning — the month-tinted Event_Date, the yellow hand-entry columns — the
 * same way buildManualOverrideRowTintRules() does. Push these rules AFTER any
 * more specific rule over the same cells (the purple manual-override tint,
 * the grey "Not Serving" type cell): the first matching rule wins.
 */
function buildLocationRowTintRules(sheet, dataStartRow, numRows, numCols, locationCol, excludeCols) {
  if (numRows < 1 || !locationCol) return [];
  const colLetter = columnToLetter(locationCol);
  const ranges = buildRowRangesExcludingColumns(sheet, dataStartRow, numRows, numCols, excludeCols);
  if (ranges.length === 0) return [];
  return Object.keys(LOCATION_COLOR_MAP).map(loc =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}${dataStartRow}="${loc}"`)
      .setBackground(LOCATION_COLOR_MAP[loc])
      .setRanges(ranges)
      .build()
  );
}

/** Converts a 1-based column index to its A1 letter(s) (1 -> 'A', 27 -> 'AA'). */
function columnToLetter(col) {
  let letter = '';
  while (col > 0) {
    const rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

/**
 * Returns one Range per contiguous run of 1-based columns from 1..numCols,
 * skipping any column in excludeCols — used so a "whole row" conditional
 * tint never paints over a cell that already carries its own more specific
 * meaning.
 */
function buildRowRangesExcludingColumns(sheet, startRow, numRows, numCols, excludeCols) {
  const excludeSet = new Set((excludeCols || []).filter(c => c && c > 0));
  const ranges = [];
  let runStart = null;
  for (let c = 1; c <= numCols; c++) {
    if (excludeSet.has(c)) {
      if (runStart !== null) { ranges.push(sheet.getRange(startRow, runStart, numRows, c - runStart)); runStart = null; }
    } else if (runStart === null) {
      runStart = c;
    }
  }
  if (runStart !== null) ranges.push(sheet.getRange(startRow, runStart, numRows, numCols - runStart + 1));
  return ranges;
}

/**
 * Builds conditional format rules that tint MOST of a row's cells whenever
 * that row's Manual_Override reads "Manually Edited" or "Manually Added".
 * excludeCols (1-based) lets a caller carve out columns with their own more
 * specific highlight (Status, Location, the month tint, a manual-entry
 * column's yellow wash) so the purple tint never overrides them.
 */
function buildManualOverrideRowTintRules(sheet, dataStartRow, numRows, numCols, overrideCol, excludeCols) {
  if (numRows < 1 || !overrideCol) return [];
  const colLetter = columnToLetter(overrideCol);
  const ranges = buildRowRangesExcludingColumns(sheet, dataStartRow, numRows, numCols, excludeCols);
  if (ranges.length === 0) return [];
  return ['Manually Edited', 'Manually Added'].map(text =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$${colLetter}${dataStartRow}="${text}"`)
      .setBackground(MANUAL_OVERRIDE_COLOR)
      .setRanges(ranges)
      .build()
  );
}

/** Highlights + labels the header cells of columns meant for hand entry. */
function labelManualEntryColumns(sheet, headerRow, headers, manualColumnNames) {
  manualColumnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx === -1) return;
    sheet.getRange(headerRow, idx + 1)
      .setValue(`${MANUAL_ENTRY_PREFIX} ${name}`)
      .setBackground(MANUAL_ENTRY_HEADER_COLOR)
      .setFontColor('#000000')
      .setFontWeight('bold');
  });
}

/** Washes the data cells of manual-entry columns with a light tint. */
function tintManualEntryColumns(sheet, startRow, numRows, headers, manualColumnNames) {
  if (numRows < 1) return;
  manualColumnNames.forEach(name => {
    const idx = headers.indexOf(name);
    if (idx === -1) return;
    sheet.getRange(startRow, idx + 1, numRows, 1).setBackground(MANUAL_ENTRY_CELL_TINT);
  });
}

/** Greys out only blank/"--" cells in given columns. General-purpose utility (not currently on any render path). */
function greyOutDashCells(sheet, startRow, numRows, colIndexes) {
  if (numRows < 1) return;
  colIndexes.forEach(col => {
    if (!col || col < 1) return;
    const values = sheet.getRange(startRow, col, numRows, 1).getValues();
    values.forEach((r, i) => {
      const v = String(r[0]).trim();
      if (v === '--' || v === '') {
        sheet.getRange(startRow + i, col).setBackground(NA_CELL_COLOR);
      }
    });
  });
}

/** Deterministic pastel color fallback for months not in MONTH_COLOR_MAP. */
function getMonthColor(monthName) {
  if (MONTH_COLOR_MAP[monthName]) return MONTH_COLOR_MAP[monthName];
  let hash = 0;
  for (let i = 0; i < monthName.length; i++) {
    hash = monthName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hueAvoidingReservedColors(hash);
  return hslToPastelHex(hue, 55, 88);
}

/**
 * Maps an arbitrary hash into a hue that skips reserved bands (status
 * green/red, plus the three location colors' neighborhoods), leaving three
 * safe zones: gold/yellow, teal, magenta — exactly where MONTH_COLOR_MAP's
 * palette lives.
 */
function hueAvoidingReservedColors(hash) {
  const bands = [[50, 80], [165, 195], [290, 335]];
  const totalWidth = bands.reduce((sum, b) => sum + (b[1] - b[0]), 0);
  let pos = Math.abs(hash) % totalWidth;
  for (const [lo, hi] of bands) {
    const width = hi - lo;
    if (pos < width) return lo + pos;
    pos -= width;
  }
  return bands[0][0];
}

function hslToPastelHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function getMonthLabel(date) {
  return Utilities.formatDate(date, TIMEZONE, 'MMMM yyyy');
}

function formatDateKey(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
}

function formatDateLabel(date) {
  return Utilities.formatDate(date, TIMEZONE, 'EEE, MMM d, yyyy');
}

/** Parses a 'yyyy-MM-dd' key back into a local Date at midnight. */
function parseDateKey(dateKey) {
  const parts = String(dateKey).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/** Returns a real Date from a sheet cell value, or null if it can't be parsed. */
function coerceDate(val) {
  if (val instanceof Date) return val;
  if (val === '' || val === null || val === undefined) return null;
  const d = new Date(val);
  return isNaN(d) ? null : d;
}

function makeHyperlinkFormula(url, label) {
  return `=HYPERLINK("${url}","${label}")`;
}

function computeEventId(calendarId, cleanTitle, dateKey) {
  const raw = `${calendarId}|${cleanTitle}|${dateKey}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('').substring(0, 12);
}

function computeStatus(activeCount, maxCapacity) {
  if (maxCapacity <= 0) return '🟢 Open';
  const remaining = maxCapacity - activeCount;
  if (remaining <= 0) return '🔴 Waitlist Only';
  if (remaining <= Math.max(1, Math.ceil(maxCapacity * 0.15))) return '🟡 Almost Full';
  return '🟢 Open';
}

/**
 * Suffix appended by formatDateLabelWithMeal() when a capped session has
 * hit 0 Remaining_Seats — converts silent waitlisting into something a
 * respondent actually sees before submitting (see
 * buildCapacityHintsFromRegistryRows() / refreshFormCapacityLabelsForAllForms()).
 * Deliberately a plain hyphen, not the em dash " — " used for meal hints,
 * so stripMealHint() can tell the two apart unambiguously.
 */
const CAPACITY_HINT_SUFFIX = ' (FULL - Waitlist)';

/** Strips the CAPACITY_HINT_SUFFIX and/or the " — <shorthand/description>" menu hint appended by formatDateLabelWithMeal(), returning the plain date label. */
function stripMealHint(label) {
  let s = String(label);
  if (s.endsWith(CAPACITY_HINT_SUFFIX)) s = s.slice(0, -CAPACITY_HINT_SUFFIX.length);
  const idx = s.indexOf(' — ');
  return idx === -1 ? s : s.substring(0, idx);
}

/** Tints an Event_Date column's cells by month — the direct replacement for the old separate Month column everywhere. */
function applyMonthColorTint(sheet, colIndex1Based, startRow, numRows) {
  if (numRows < 1) return;
  const values = sheet.getRange(startRow, colIndex1Based, numRows, 1).getValues();
  const backgrounds = values.map(r => { const d = coerceDate(r[0]); return [d ? getMonthColor(getMonthLabel(d)) : '#FFFFFF']; });
  sheet.getRange(startRow, colIndex1Based, numRows, 1).setBackgrounds(backgrounds);
}

/** Builds a "text equals" conditional format rule across one or more explicit ranges. */
function buildTextEqualsRuleForRanges(ranges, text, bgColor) {
  if (!ranges || ranges.length === 0) return null;
  return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bgColor).setRanges(ranges).build();
}


// ============================================================================
// 1c. PER-EXECUTION CACHES  (the sync hot paths)
// ============================================================================
//
// An Apps Script global lives exactly as long as ONE execution, which makes
// globals the natural home for "read this tab once per run" memoization:
// there is no cross-run staleness to reason about, only within-run
// invalidation whenever this script itself rewrites the tab a cache was
// built from. Every cache below is explicitly dropped by the code path that
// dirties it — grep the invalidate* functions for their call sites.
//
// What these replace (all of it per-call before):
//   - getMealInfoForDate() re-read the ENTIRE Lunch_Schedule tab on every
//     single call, and buildDateLabelSets() calls it 2-3x PER DATE. A
//     10-date form therefore cost ~30 full-tab reads to build its labels,
//     once per form, on every sync.
//   - getMealBufferConfigForLocation()/getOrderAheadDays() re-read Config
//     per call, the former once per lunch-dashboard rollup row.
//   - form.getItems() is a REMOTE call and getResponseValueByTitle() made
//     one per lookup — roughly ten per response, times every response.
//   - CalendarApp.getEvents() ran once per calendar in syncCalendarsInternal()
//     AND again in every triageDeletedSessions() pass; a full
//     initializeAndSyncAll() hit the calendars four times over.
// ============================================================================

let __mealInfoIndexCache = null;
let __mealBufferIndexCache = null;
let __orderAheadDaysCache = null;
let __adminNotificationEmailCache = null;
let __cateringPolicyIndexCache = null;
let __linkDisplayCache = null;
let __calendarInviteModeCache = null;
let __automationEnabledCache = null;
let __triggerOwnerCache = null;
let __calendarEventsCache = null;
let __formItemIndexCache = {};

/**
 * Reads Lunch_Schedule ONCE per execution into
 * { 'yyyy-MM-dd|Location': mealInfo, 'yyyy-MM-dd': mealInfo }. The
 * date-only key preserves getMealInfoForDate()'s original "no location
 * given -> first matching row wins" behavior; first write wins for both key
 * shapes, matching the old top-to-bottom scan.
 */
function getMealInfoIndex() {
  if (__mealInfoIndexCache) return __mealInfoIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE) : null;
  if (sheet) {
    const headers = HEADERS.Lunch_Schedule;
    const map = getIndexMap(headers);
    readLunchScheduleRows(sheet).forEach(row => {
      const rowDate = coerceDate(row[map['Event_Date']]);
      if (!rowDate) return;
      const dateKey = formatDateKey(rowDate);
      const location = String(row[map['Location']] || '').trim();
      const info = {
        type: row[map['Type']] || '',
        description: row[map['Meal_Description']] || '',
        shorthand: row[map['Meal_Shorthand']] || ''
      };
      const locatedKey = `${dateKey}|${location}`;
      if (index[locatedKey] === undefined) index[locatedKey] = info;
      if (index[dateKey] === undefined) index[dateKey] = info;
    });
  }
  __mealInfoIndexCache = index;
  return index;
}

/** Called by renderLunchScheduleSheet() — the only thing that rewrites the tab this index is built from. */
function invalidateMealInfoIndex() {
  __mealInfoIndexCache = null;
}

/** Called by buildConfigSheet() — the only thing that rewrites/seeds the Config tab. */
function invalidateConfigCaches() {
  __mealBufferIndexCache = null;
  __orderAheadDaysCache = null;
  __adminNotificationEmailCache = null;
  __cateringPolicyIndexCache = null;
  __linkDisplayCache = null;
  __calendarInviteModeCache = null;
  __automationEnabledCache = null;
  __triggerOwnerCache = null;
  // This one also lives in the CROSS-execution cache, which a plain
  // per-execution reset would leave serving the old value to the next
  // trigger firing for up to AUTOMATION_FLAG_CACHE_SECONDS.
  clearAutomationFlagCache();
}

/**
 * Item lookups for one form, built with a SINGLE form.getItems() round
 * trip: { byTitle: {title: [item...]}, paragraphItems: [...] }. Cached per
 * form ID for the rest of the execution. Only ever used for READS — the
 * refresh paths that mutate a form's items call invalidateFormItemIndex().
 */
function getFormItemIndex(form) {
  const formId = form.getId();
  if (__formItemIndexCache[formId]) return __formItemIndexCache[formId];
  const items = form.getItems();
  const byTitle = {};
  const paragraphItems = [];
  items.forEach(item => {
    const title = item.getTitle();
    if (!byTitle[title]) byTitle[title] = [];
    byTitle[title].push(item);
    if (item.getType() === FormApp.ItemType.PARAGRAPH_TEXT) paragraphItems.push(item);
  });
  const index = { form, formId, items, byTitle, paragraphItems };
  __formItemIndexCache[formId] = index;
  return index;
}

function invalidateFormItemIndex(formId) {
  if (formId) delete __formItemIndexCache[formId];
  else __formItemIndexCache = {};
}

/**
 * One CalendarApp.getEvents() per calendar per execution, keyed on the sync
 * window so a differently-scoped call still re-fetches. Returns
 * { calendarId: [CalendarEvent...] | null }, where null means the calendar
 * was inaccessible (callers log and skip, same as before).
 *
 * Safe to share across a full syncCalendars(): that run edits event
 * DESCRIPTIONS (backInjectCalendarDescriptions) but never adds or removes
 * events, so the set of live events this cache represents stays accurate.
 */
function getCalendarEventsForWindow(start, end) {
  const windowKey = `${start.getTime()}|${end.getTime()}`;
  if (__calendarEventsCache && __calendarEventsCache.windowKey === windowKey) {
    return __calendarEventsCache.byCalendar;
  }
  const byCalendar = {};
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    // getCalendarById() returns null for "not found", but THROWS when the
    // running context has no calendar authorization at all — which is the
    // normal state inside a simple onEdit trigger (see onEdit()). Both mean
    // the same thing to every caller: this calendar could not be read.
    try {
      const calendar = CalendarApp.getCalendarById(calendarId);
      byCalendar[calendarId] = calendar ? calendar.getEvents(start, end) : null;
    } catch (err) {
      log(`⚠️ Calendar ${calendarId} could not be read (${err}).`);
      byCalendar[calendarId] = null;
    }
  });
  __calendarEventsCache = { windowKey, byCalendar };
  return byCalendar;
}

/** Drops the calendar cache — used after anything that could change which events exist. */
function invalidateCalendarEventsCache() {
  __calendarEventsCache = null;
}


// ============================================================================
// 1b. LUNCH SCHEDULE LOOKUP (per Event_Date x Location — see Lunch_Schedule tab)
// ============================================================================

/** Returns the hardcoded form footer note for a location (falls back to a generic note). */
function getFormFooterForLocation(locationName) {
  return FORM_FOOTER_BY_LOCATION[locationName] || DEFAULT_FORM_FOOTER;
}

/**
 * The footer note for a form covering `locations` — the one location's note
 * when there is one, and every DISTINCT note (each prefixed with the location
 * it belongs to) when a cross-location form spans several. Locations that
 * share a note are not repeated, so the common "three sites, one house rule"
 * case still reads as a single sentence.
 */
function buildFooterNoteForLocations(locations) {
  const list = (locations || []).filter(Boolean);
  if (list.length <= 1) return getFormFooterForLocation(list[0]);

  const byNote = {};
  list.forEach(loc => {
    const note = getFormFooterForLocation(loc);
    if (!note) return;
    if (!byNote[note]) byNote[note] = [];
    byNote[note].push(loc);
  });
  const notes = Object.keys(byNote);
  if (notes.length === 0) return DEFAULT_FORM_FOOTER;
  if (notes.length === 1) return notes[0];
  return notes.map(note => `${byNote[note].join(' / ')}: ${note}`).join('\n');
}

/**
 * Looks up the day's meal info (Type, Meal_Description, Meal_Shorthand)
 * from Lunch_Schedule for one specific date AND location. Returns null if
 * no row exists for that date+location yet. Type may be 'Hot' | 'Cold' |
 * 'Not Serving'. Backed by getMealInfoIndex()'s one-read-per-execution map
 * (this used to re-read the whole tab on every call).
 */
function getMealInfoForDate(date, location) {
  if (!date) return null;
  const index = getMealInfoIndex();
  const dateKey = formatDateKey(date);
  const key = location ? `${dateKey}|${String(location).trim()}` : dateKey;
  return index[key] || null;
}

/**
 * Builds a "date label + menu hint [+ capacity hint]" string, e.g. "Mon,
 * Jan 5, 2026 — Turkey Sandwich (FULL - Waitlist)", using Meal_Shorthand
 * when present, falling back to Meal_Description. When the date+location is
 * marked "Not Serving," the hint instead reads "No Lunch Served" — this is
 * what lets a form communicate the lack of catering right on the date row
 * itself. capacityHint (CAPACITY_HINT_SUFFIX or '') is always appended
 * LAST, after any meal hint. Used ONLY for form-facing display text;
 * internal matching/storage always uses the plain label via
 * stripMealHint()/formatDateLabel().
 */
function formatDateLabelWithMeal(date, location, capacityHint, showLocation, title, showTitle) {
  const baseLabel = formatSessionLabel(date, location, showLocation, title, showTitle);
  const meal = getMealInfoForDate(date, location);
  let label;
  if (!meal) label = baseLabel;
  else if (meal.type === 'Not Serving') label = `${baseLabel} — No Lunch Served`;
  else {
    const hint = meal.shorthand || meal.description;
    label = hint ? `${baseLabel} — ${hint}` : baseLabel;
  }
  return capacityHint ? `${label}${capacityHint}` : label;
}

/**
 * The plain, meal-and-capacity-free label that IDENTIFIES one session on a
 * form: its date, plus its location when the form covers more than one (see
 * SHARED_LOCATION_SCOPE).
 *
 * This is the join key between a form and the session table — the grid row
 * label a respondent ticks, and the key buildRegistryIndex() looks that row
 * back up by. On a single-location, single-program form it is exactly the date
 * label it has always been, so nothing about existing forms changes.
 *
 * TWO THINGS CAN BE ADDED, and neither is decoration — each exists because
 * without it two different sessions collapse to one indistinguishable row
 * label, which a Forms grid rejects outright and which no lookup could resolve
 * back to a session anyway:
 *
 *   the LOCATION, on a cross-location form (see SHARED_LOCATION_SCOPE), where
 *     two sites can run the same program on the same day;
 *   the PROGRAM NAME, on a combined form (see mergeEventsIntoOneForm()), whose
 *     whole point is that its dates belong to DIFFERENT programs — a bare date
 *     there tells a respondent nothing about what they are signing up for.
 *
 * Both use LOCATION_LABEL_SEPARATOR, and both sit before any meal or capacity
 * hint, so stripMealHint() still returns a label that identifies the SESSION.
 */
function formatSessionLabel(date, location, showLocation, title, showTitle) {
  let base = formatDateLabel(date);
  if (showTitle && title) base += `${LOCATION_LABEL_SEPARATOR}${title}`;
  if (showLocation && location) base += `${LOCATION_LABEL_SEPARATOR}${location}`;
  return base;
}

/** The distinct locations in a list of names, in the order they appear. */
function distinctLocations(names) {
  return dedupePreservingOrder((names || []).map(n => String(n || '').trim()).filter(Boolean));
}

/** The distinct locations a set of [{date, location}] sessions touches. */
function locationsOfSessions(sessions) {
  return distinctLocations((sessions || []).map(s => s.location));
}

/** The distinct PROGRAM names a set of sessions covers — more than one means a combined form. */
function distinctSessionTitles(sessions) {
  return dedupePreservingOrder((sessions || []).map(s => String(s.title || '').trim()).filter(Boolean));
}

/**
 * Splits a form's SESSIONS — [{ date, location }], each session knowing the
 * one place it happens — into the full label list (for the attendance roster
 * grid: every date, whether or not lunch is served) and the lunch-grid label
 * subset (only date+location pairs Lunch_Schedule doesn't mark "Not Serving"),
 * so the lunch grid never offers a choice on a day nothing is being catered.
 *
 * options:
 *   capacityHints  { 'yyyy-MM-dd': CAPACITY_HINT_SUFFIX } (see
 *                  buildCapacityHintsFromRegistryRows()) — omit for none.
 *   showLocation   whether labels name their location. Defaults to "only if
 *                  the sessions actually span more than one", which is right
 *                  for any caller that isn't holding a form's own scope; a
 *                  caller that knows the form is cross-location passes true
 *                  explicitly so its labels stay stable even in a window
 *                  where only one location happens to have dates.
 *   showTitle      whether labels name their program. Same defaulting rule,
 *                  against the sessions' distinct titles — see
 *                  formatSessionLabel().
 *
 * Both lists are DE-DUPLICATED. A group with two sessions on the same day —
 * a morning and an afternoon sitting of the same program — produces the same
 * label twice, and a Google Forms grid rejects duplicate row labels outright
 * ("Invalid data updating form"), which fails the whole form write and takes
 * the date list with it. Collapsing them costs nothing downstream: a grid row
 * is matched back to its session by label (registryIndex is keyed
 * `formId|label`), so the two sittings were always going to resolve to one
 * row anyway.
 */
function buildDateLabelSets(sessions, options) {
  options = options || {};
  const capacityHints = options.capacityHints || {};
  const showLocation = options.showLocation === undefined
    ? locationsOfSessions(sessions).length > 1
    : !!options.showLocation;
  const showTitle = options.showTitle === undefined
    ? distinctSessionTitles(sessions).length > 1
    : !!options.showTitle;

  const label = s => formatDateLabelWithMeal(
    s.date, s.location, capacityHints[formatDateKey(s.date)], showLocation, s.title, showTitle);
  const allDateLabels = dedupePreservingOrder(sessions.map(label));
  const lunchDateLabels = dedupePreservingOrder(
    sessions.filter(s => isLunchOfferedOn(s.date, s.location)).map(label));
  return { allDateLabels, lunchDateLabels };
}

/**
 * The Form_IDs known to belong to a CROSS-LOCATION group, read off the
 * persistent groupKey -> Form_ID registry (a shared group's key is scoped
 * SHARED_LOCATION_SCOPE — see buildEventGroups()).
 *
 * Why it's needed at all: a form's scope is otherwise inferred from its own
 * session rows spanning several locations, which is true in the steady state
 * but not in the window where a shared program has dates at only one of its
 * locations. Reading the registry keeps such a form labelling itself the same
 * way before and after its second location shows up — labels that flip would
 * strand every response already collected against the old ones.
 */
function getSharedFormIdSet() {
  const registry = getPersistentFormRegistry();
  const prefix = `${SHARED_LOCATION_SCOPE}::`;
  const shared = new Set();
  Object.keys(registry).forEach(key => {
    if (key.indexOf(prefix) === 0 && registry[key]) shared.add(registry[key]);
  });
  return shared;
}

/**
 * Everything the form-facing layer needs about ONE form, derived from that
 * form's own session rows: its sessions (each date with the location and
 * program it belongs to, in date order), the distinct locations and programs
 * it covers, whether its labels name either of those, whether it is a club or
 * a grouped series, and its capacity hints.
 *
 * Every "refresh a live form from the sheet" path goes through this, so
 * cross-location, combined-program and club handling are each decided in
 * exactly one place rather than re-derived (differently) in five.
 */
function buildFormSessionContext(formId, formRows, map, sharedFormIds) {
  const sessions = formRows
    .map(row => ({
      date: coerceDate(row[map['Event_Date']]),
      location: String(row[map['Location']] || '').trim(),
      title: String(row[map['Clean_Title']] || '').trim()
    }))
    .filter(s => s.date)
    .sort((a, b) => a.date - b.date);

  const locations = locationsOfSessions(sessions);
  const titles = distinctSessionTitles(sessions);
  return {
    formId,
    sessions,
    locations,
    titles,
    showLocation: locations.length > 1 || !!(sharedFormIds && sharedFormIds.has(formId)),
    showTitle: titles.length > 1,
    // A form is a club form when the sessions on it are club sessions. On a
    // combined form (several programs, one of them a club) that is still true
    // of the form as a whole, which is the right answer: the club option has
    // to be offered for the club's own dates to be joinable at all.
    isClub: formRows.some(row => isClubColumnValue(row[map['Club']])),
    isFixed: formRows.some(row => isGroupedTypeTag(row[map['Type_Tag']])),
    programTitle: titles.length === 1 ? titles[0] : '',
    capacityHints: buildCapacityHintsFromRegistryRows(formRows, map)
  };
}

/** { Form_ID: {showLocation, showTitle} } for a batch of session rows — how each form's date labels read. */
function buildLabelOptionsByForm(rows, map) {
  const sharedFormIds = getSharedFormIdSet();
  const byForm = groupRegistryRowsByForm(rows, map);
  const out = {};
  Object.keys(byForm).forEach(formId => {
    const context = buildFormSessionContext(formId, byForm[formId], map, sharedFormIds);
    out[formId] = { showLocation: context.showLocation, showTitle: context.showTitle };
  });
  return out;
}

/** First occurrence of each value, in the order they appeared. */
function dedupePreservingOrder(values) {
  const seen = new Set();
  return values.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
}

/**
 * Builds { 'yyyy-MM-dd': CAPACITY_HINT_SUFFIX } from a batch of
 * Master_Program_Dashboard rows (any set sharing the same header layout —
 * typically one form's sessions), using each row's own Max_Capacity /
 * Remaining_Seats. Uncapped sessions (no Max_Capacity) never get a hint.
 */
function buildCapacityHintsFromRegistryRows(rows, map) {
  const hints = {};
  rows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    const rawCap = row[map['Max_Capacity']];
    const isCapped = rawCap !== '' && rawCap !== '--' && Number(rawCap) > 0;
    if (!isCapped) return;
    const remaining = Number(row[map['Remaining_Seats']]);
    if (!isNaN(remaining) && remaining <= 0) hints[formatDateKey(d)] = CAPACITY_HINT_SUFFIX;
  });
  return hints;
}

/**
 * Generic lunch response choices offered on every form (Yes/No — the
 * specific dish/serving status for a given day comes from Lunch_Schedule
 * and is shown directly on the date row via formatDateLabelWithMeal()).
 */
const GENERIC_LUNCH_CHOICES = ['No Lunch', 'Yes - Lunch'];


// ============================================================================
// 1d. FORM DATE-LABEL WRITES  (fingerprinted — see applyFormDateLabels)
// ============================================================================
//
// Every path that pushes date labels onto a form funnels through
// applyFormDateLabels(). Writing a form item is a remote call AND creates a
// new form revision, and the labels are usually byte-identical to what's
// already there — refreshFormCapacityLabelsForAllForms() in particular runs
// on EVERY hourly sync across every capped form. So we keep a hash of the
// last labels written per form in Script Properties and short-circuit
// before FormApp.openById() (itself the most expensive call in the path)
// whenever nothing changed.
//
// The fingerprint tracks only what THIS script writes. A human editing a
// form's grid rows by hand would not be noticed until the labels legitimately
// change again — pass { force: true } (or clear the property) to re-assert.
// ============================================================================

const FORM_LABEL_FINGERPRINT_PROP_KEY = 'FORM_LABEL_FINGERPRINTS_V1';

let __formLabelFingerprintCache = null;
let __formLabelFingerprintDirty = false;

function getFormLabelFingerprints() {
  if (__formLabelFingerprintCache) return __formLabelFingerprintCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_LABEL_FINGERPRINT_PROP_KEY);
  __formLabelFingerprintCache = raw ? JSON.parse(raw) : {};
  return __formLabelFingerprintCache;
}

function computeFormLabelFingerprint(attendanceLabels, lunchLabels) {
  const raw = JSON.stringify([attendanceLabels, lunchLabels]);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

/**
 * Sets a form's ATTENDANCE_GRID rows to attendanceLabels and its LUNCH_GRID
 * rows to lunchLabels, plus the mode page's date list, skipping the whole
 * thing when the labels match what we last wrote to that form.
 *
 * An EMPTY lunchLabels list means no date on this form serves lunch, in which
 * case the lunch grid isn't on the form at all any more (see
 * syncLunchQuestionsOnForm()) — the loop below simply finds nothing to write.
 *
 * THE MODE PAGE'S DATE LIST RIDES ALONG HERE deliberately, rather than being
 * written by whichever caller happens to know the dates. It is derived from
 * attendanceLabels, which is exactly what the fingerprint already covers, so
 * putting it here means it is refreshed on precisely the syncs that change the
 * dates and skipped on the many that do not — and no caller can add a date to
 * a form's grids while leaving the mode page describing the old set.
 *
 * options.form    — an already-open Form, to avoid a second openById()
 * options.force   — write even if the fingerprint matches
 * options.context — short string for the log line on failure
 * Returns true if the form was actually written to.
 */
function applyFormDateLabels(formId, attendanceLabels, lunchLabels, options) {
  options = options || {};
  const fingerprint = computeFormLabelFingerprint(attendanceLabels, lunchLabels);
  const fingerprints = getFormLabelFingerprints();
  if (!options.force && fingerprints[formId] === fingerprint) return false;

  try {
    const form = options.form || FormApp.openById(formId);
    const items = form.getItems();
    items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID)
      .forEach(it => it.asCheckboxGridItem().setRows(attendanceLabels));
    if (lunchLabels && lunchLabels.length > 0) {
      items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.LUNCH_GRID)
        .forEach(it => it.asCheckboxGridItem().setRows(lunchLabels));
    }

    // Type-guarded as well as titled, for the reason spelled out on
    // TEMPLATE_PAGE_TITLES.MODE: a question and a page break must never be
    // confused for one another by a title lookup.
    const modeNote = buildModePageDateNote(attendanceLabels);
    if (modeNote) {
      items.filter(it => it.getType() === FormApp.ItemType.PAGE_BREAK &&
        it.getTitle() === TEMPLATE_PAGE_TITLES.MODE)
        .forEach(it => it.asPageBreakItem().setHelpText(modeNote));
    }
  } catch (err) {
    log(`⚠️ Could not write date labels to form ${formId}${options.context ? ` (${options.context})` : ''}: ${err}`);
    return false;
  }

  fingerprints[formId] = fingerprint;
  __formLabelFingerprintDirty = true;
  invalidateFormItemIndex(formId); // cached grid row/column shapes for this form are now stale
  return true;
}

/**
 * The link we hand out: the form's own published URL, with nothing pre-filled.
 *
 * IT USED TO BE A PREFILLED URL with every box in both roster grids already
 * ticked — every person, every date — on the theory that "we're all coming to
 * everything" is the common case and unticking the exceptions is less work
 * than ticking the rule. In practice a pre-ticked box is not a shortcut, it is
 * an assertion made on the respondent's behalf: someone who skims the grid,
 * sees checks, and submits has told us they are coming to nine sessions they
 * never read. That produces catering for people who will not be there, and it
 * is invisible to them and to us until the day. The "sign up for every date"
 * option now covers the genuine all-in case explicitly, as an answer someone
 * actually gives.
 *
 * It also removes a standing fragility: a prefill value only matches a row
 * whose label is still byte-identical, so appending "(FULL - Waitlist)" to a
 * date, or rebuilding a form onto a new template, silently stopped part of the
 * URL working until it was regenerated.
 */
function buildRegistrationUrl(form) {
  return form.getPublishedUrl();
}

/**
 * Deletes a set of items from a form, HIGHEST INDEX FIRST. Returns how many
 * went.
 *
 * The order is the whole point. An Apps Script `Item` carries the index it had
 * when `getItems()` handed it over, and `deleteItem()` acts on that index — so
 * deleting forward through a filtered list invalidates every later item's
 * index by one. Usually that silently deletes the WRONG item; when the last
 * item in the form is among the doomed, it fails outright with
 * "Cannot access item at index: N. Number of items: N", which is what this
 * cost on a v3 form carrying two "Footer Note" headers, the second of them
 * last on the form.
 *
 * Deleting from the end backwards means no surviving item's index ever moves.
 */
function deleteFormItems(form, items, describe) {
  const ordered = (items || []).slice().sort((a, b) => b.getIndex() - a.getIndex());
  let removed = 0;
  ordered.forEach(item => {
    const title = item.getTitle();
    try {
      form.deleteItem(item);
      removed++;
    } catch (err) {
      log(`⚠️ Could not remove "${title}" from ${describe || `form ${form.getId()}`} (${err}).`);
    }
  });
  return removed;
}

/**
 * Transient Forms failures, by the text Google puts in them.
 *
 * "Failed to edit the form. Please wait and try again." is the API telling you
 * it is being written to faster than it likes — which is exactly what
 * rebuilding a form does, since that is ~15 deletes and ~20 adds back to back,
 * repeated per form. It is not a defect in the form and the same call succeeds
 * moments later.
 */
const TRANSIENT_FORM_ERROR_PATTERNS = [
  /please wait and try again/i,
  /failed to edit the form/i,
  /service (unavailable|error)/i,
  /internal error/i,
  /try again later/i,
  /too many/i
];

function isTransientFormError(err) {
  const text = String((err && err.message) || err || '');
  return TRANSIENT_FORM_ERROR_PATTERNS.some(p => p.test(text));
}

/** Attempts before giving up, and the backoff between them (ms). */
const FORM_RETRY_DELAYS_MS = [1000, 3000, 8000];

/**
 * Runs `fn`, retrying with backoff when Forms says it is busy rather than that
 * something is wrong. A NON-transient error is re-thrown immediately — a
 * genuine defect does not get better by being repeated, and burning twelve
 * seconds discovering that costs the sync's whole budget.
 *
 * Safe for the form rebuilds it wraps: those are written to be re-runnable
 * (delete-everything-then-rebuild reaches the same end state whether it starts
 * from a full form or a half-emptied one).
 */
function withFormRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!isTransientFormError(err) || attempt >= FORM_RETRY_DELAYS_MS.length) throw err;
      const wait = FORM_RETRY_DELAYS_MS[attempt];
      log(`ℹ️ ${label}: Forms is busy (${err}) — waiting ${wait}ms and trying again ` +
        `(attempt ${attempt + 2} of ${FORM_RETRY_DELAYS_MS.length + 1}).`);
      Utilities.sleep(wait);
    }
  }
}

/**
 * Strips both lunch questions — the per-date LUNCH_GRID and the all-dates
 * who-eats checkbox — off a form that has no lunch to offer: a location
 * whose catering policy is NEVER, or a form none of whose dates serve
 * lunch. Asking someone to pick a lunch that isn't being served is noise at
 * best and a wrong expectation at worst.
 *
 * The parser needs no special case for this: getGridResponseByTitle()
 * returns null when the item is absent and getResponseValueByTitle()
 * returns '', both of which already resolve to "No Lunch" for everyone.
 */
function removeLunchQuestionsFromForm(form, locations, reason) {
  const where = describeLocations(Array.isArray(locations) ? locations : [locations]);
  const doomed = [TEMPLATE_ITEM_TITLES.LUNCH_GRID, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE];
  const removed = deleteFormItems(form,
    form.getItems().filter(item => doomed.indexOf(item.getTitle()) !== -1),
    `the ${where} form`);
  if (removed > 0) {
    log(`Removed ${removed} lunch question(s) from a ${where} form — ` +
      (reason || `no location on it caters (policy "${CATERING_POLICIES.NEVER}")`) + '.');
  }
  return removed;
}

/**
 * The inverse of removeLunchQuestionsFromForm(): puts a stripped lunch
 * question back when lunch returns to a form (a Grouped series that gains its
 * first catered date, a menu row added to a By-exception location). Without
 * this, "hide the question when there's nothing to eat" would be a one-way
 * door on a form that outlives the dates it was created with.
 *
 * A re-added item lands at the END of the form, so each one is moved back to
 * its template position — beside the attendance grid on the Specific Dates
 * page, and first on the Everyone, Every Date page. Rows are left as the
 * placeholder; the caller's applyFormDateLabels({ force: true }) sets them.
 */
function restoreLunchQuestionsOnForm(form) {
  const titles = form.getItems().map(it => it.getTitle());
  let restored = 0;

  if (titles.indexOf(TEMPLATE_ITEM_TITLES.LUNCH_GRID) === -1) {
    const gridItem = addLunchGridItem(form);
    const attendanceIdx = form.getItems().findIndex(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID);
    if (attendanceIdx !== -1) form.moveItem(gridItem.getIndex(), attendanceIdx + 1);
    restored++;
  }

  if (titles.indexOf(TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE) === -1) {
    const checkboxItem = addAllDatesLunchItem(form);
    const pageIdx = form.getItems().findIndex(it =>
      it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === TEMPLATE_PAGE_TITLES.ALL_DATES);
    if (pageIdx !== -1) form.moveItem(checkboxItem.getIndex(), pageIdx + 1);
    restored++;
  }

  if (restored > 0) log(`Restored ${restored} lunch question(s) to form ${form.getId()} — it has catered dates again.`);
  return restored;
}

/**
 * Single decision point for whether a form asks about lunch at all: it does
 * when at least one of its locations caters AND at least one date on the form
 * actually serves lunch. Both directions are handled, so a form self-heals
 * whichever way its schedule moves.
 *
 * "At least one of its locations" is what a cross-location form needs: a
 * shared form covering a catering site and a Never site must still ask, and
 * the Never site's dates are already absent from the lunch grid because
 * buildDateLabelSets() filters per date+location.
 *
 * Per-DATE filtering is separate and already handled by buildDateLabelSets()
 * — the lunch grid's rows are only the dates that serve lunch, so a date
 * marked "Not Serving" never appears as a lunch row even on a form whose
 * other dates do.
 *
 * Returns how many questions were added or removed, so a caller can force
 * the date-label write that has to follow a restore (a restored grid still
 * holds the template's placeholder row).
 */
function syncLunchQuestionsOnForm(form, locations, hasLunchDates) {
  const list = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  const catersSomewhere = list.some(loc => getCateringPolicyForLocation(loc) !== CATERING_POLICIES.NEVER);
  if (!catersSomewhere) {
    return removeLunchQuestionsFromForm(form, list);
  }
  if (!hasLunchDates) {
    return removeLunchQuestionsFromForm(form, list, 'no date on this form serves lunch');
  }
  return restoreLunchQuestionsOnForm(form);
}


// ============================================================================
// 1e. ADDING MENU ITEMS  (Lunch_Schedule: paste CSV, in the sheet or a dialog)
// ============================================================================
//
// WHAT THIS REPLACED, and why. Adding a menu item used to mean typing into
// the Upcoming table, at which point every single committed cell:
//   1. re-rendered and RE-SORTED the whole tab — so the half-finished row you
//      were typing jumped somewhere else mid-entry; and
//   2. threw up a modal asking whether to rewrite every live registration
//      form covering that date.
// Neither is survivable while entering a month of menus, and there was no
// blank row to type into in the first place: the Upcoming table ends exactly
// where its last dated row does, so adding one meant inserting a row by hand
// first. That whole arrangement is gone.
//
// WHAT IT IS NOW. The tab ends with an ADD block — a banner, a header, and
// open space to the bottom of the sheet. Put CSV there, however much of it:
//
//     2026-09-14, Narberth, Hot, Chicken Parmesan, Chx Parm
//     2026-09-15, Ashbridge, Cold, Turkey Wrap, Turkey
//     2026-09-16, Narberth, Not Serving
//
// as a normal multi-column paste (from Excel/Sheets), as raw comma-separated
// text (one cell per line, or one cell holding every line), or typed a row at
// a time. All of it lands in the same parser, so ONE row and TWO HUNDRED rows
// behave identically — the only difference is how long the toast takes.
// Complete rows are folded into the schedule and the block is emptied ready
// for the next batch; anything unparseable stays put with a reason, so a bad
// date in row 40 never silently swallows a good row 41.
//
// Pushing the menu out to live forms is now an EXPLICIT act — the
// "🍱 Push Menu Changes to Forms" menu item — rather than a modal that
// interrupts typing. The daily Sync Cal picks it up regardless.
// ============================================================================

/** Column A marker that locates the ADD block. Must not collide with a real header. */
const LUNCH_ADD_MARKER = '➕ ADD MENU ITEMS';
/**
 * The ADD block's own header labels. Deliberately NOT the canonical
 * HEADERS.Lunch_Schedule names: getSectionZones()/readAllSectionedRows() find
 * this tab's real tables by scanning for the literal header 'Event_Date', and
 * a third row carrying that word would be read as a third data table.
 */
const LUNCH_ADD_HEADERS = ['Date', 'Location', 'Type', 'Meal Description', 'Shorthand'];
/** Blank rows left under the ADD header. A bigger paste simply extends past it. */
const LUNCH_ADD_BLANK_ROWS = 15;

/**
 * The last row of Lunch_Schedule that is genuinely SCHEDULE — everything
 * above the ADD block's banner.
 *
 * This is the one thing the bottom-mounted ADD block costs, and it has to be
 * respected by every reader of the tab: rows waiting (or rejected) in the add
 * area carry real dates, so an unbounded read would quietly absorb them into
 * the Past table and a rejected row would "disappear into" the schedule
 * instead of staying put to be corrected.
 */
function getLunchScheduleEndRow(sheet) {
  const add = findLunchAddBlock(sheet);
  return add ? add.bannerRow - 1 : sheet.getLastRow();
}

/** Every real schedule row on the tab, ADD block excluded. */
function readLunchScheduleRows(sheet) {
  return readAllSectionedRows(sheet, HEADERS.Lunch_Schedule, 'Event_Date', getLunchScheduleEndRow(sheet));
}

/** The tab's Upcoming/Past data zones, ADD block excluded. */
function getLunchScheduleZones(sheet) {
  return getSectionZones(sheet, 'Event_Date', getLunchScheduleEndRow(sheet));
}

/**
 * Locates the ADD block by its banner marker. Returns null when the tab
 * hasn't been rendered with one yet (an older workbook), which every caller
 * treats as "no add area" rather than an error.
 */
function findLunchAddBlock(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;
  const colA = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0] || '').indexOf(LUNCH_ADD_MARKER) === 0) {
      const bannerRow = i + 1;
      return { bannerRow, headerRow: bannerRow + 1, firstRow: bannerRow + 2 };
    }
  }
  return null;
}

/**
 * Fired via onEdit() when Lunch_Schedule is hand-edited.
 *
 * Two zones, two behaviours:
 *   ADD block  -> harvest whatever is complete into the schedule (see above).
 *   The tables -> tidy the edited cells in place. NO re-render: correcting a
 *                 typo must not move the row you are looking at.
 */
function handleLunchScheduleEdit(e, sheet) {
  const add = findLunchAddBlock(sheet);
  const editedRow = e.range.getRow();
  const editedLastRow = editedRow + e.range.getNumRows() - 1;

  if (add && editedLastRow >= add.firstRow) {
    harvestPastedMenuRows(sheet, add);
    return;
  }
  normalizeLunchScheduleCells(e, sheet);
}

/**
 * Tidies the rows just edited INSIDE one of the real tables: text dates become
 * real dates, and Location/Type are snapped to their canonical spelling. The
 * row stays exactly where it is.
 */
function normalizeLunchScheduleCells(e, sheet) {
  const zones = getLunchScheduleZones(sheet);
  const editedRow = e.range.getRow();
  if (!isRowInAnyDataZone(zones, editedRow)) return;

  const headers = HEADERS.Lunch_Schedule;
  const map = getIndexMap(headers);
  const numRows = e.range.getNumRows();
  const range = sheet.getRange(editedRow, 1, numRows, headers.length);
  const values = range.getValues();

  let changed = false;
  let touchedUpcoming = false;
  const todayKey = formatDateKey(new Date());
  const nowNotServing = [];

  values.forEach(row => {
    const date = coerceDate(row[map['Event_Date']]);
    if (date) {
      if (!(row[map['Event_Date']] instanceof Date)) { row[map['Event_Date']] = date; changed = true; }
      if (formatDateKey(date) >= todayKey) touchedUpcoming = true;
    }
    const loc = canonicalizeLocation(row[map['Location']]);
    if (loc && loc !== row[map['Location']]) { row[map['Location']] = loc; changed = true; }
    const type = canonicalizeLunchType(row[map['Type']]);
    if (type && type !== row[map['Type']]) { row[map['Type']] = type; changed = true; }
    const finalType = String(row[map['Type']] || '').trim();
    if (date && finalType === 'Not Serving') {
      nowNotServing.push({ date, location: String(row[map['Location']] || '').trim() });
    }
  });

  if (changed) range.setValues(values);
  // Before the sign-up check below: it asks getMealInfoForDate() what the
  // schedule says, and the answer has to be what was just typed.
  invalidateMealInfoIndex();

  // Say it now, while the person who closed the kitchen is still looking at
  // the screen. The durable version goes out by email on the next sync — see
  // buildDashboardRollup().
  const warned = warnAboutNotServingSignups(nowNotServing);

  if (touchedUpcoming && warned === 0) {
    toastIfPossible('Menu updated. Live forms still show the old text — use ' +
      '"🍱 Push Menu Changes to Forms", or wait for the next Sync Cal.');
  }
}

/**
 * Reads everything sitting in the ADD block, folds the complete rows into the
 * schedule, and leaves the rest behind with a reason.
 *
 * A row is COMPLETE when it has a parseable date, a known location and a
 * known type. That threshold is what makes typing one row by hand work at
 * all: onEdit fires on every committed cell, so a row still being typed
 * (date entered, location not yet) must be left alone rather than harvested
 * half-built and rejected. A pasted row arrives complete in a single event
 * and is taken immediately.
 */
function harvestPastedMenuRows(sheet, add) {
  const lastRow = sheet.getLastRow();
  if (lastRow < add.firstRow) return;

  const width = Math.max(sheet.getLastColumn(), LUNCH_ADD_HEADERS.length);
  const raw = sheet.getRange(add.firstRow, 1, lastRow - add.firstRow + 1, width).getValues();
  const parsed = parseLunchMenuGrid(raw);
  if (parsed.rows.length === 0 && parsed.rejects.length === 0) return; // block is empty

  if (parsed.rows.length === 0) {
    // Nothing usable yet. Silent while a row is merely unfinished; explicit
    // once something is actually wrong with it.
    const hard = parsed.rejects.filter(r => !r.incomplete);
    if (hard.length > 0) {
      toastIfPossible(`⚠️ Not added — ${hard[0].reason}. Fix it in the add area and it will go in.`);
    }
    return;
  }

  // Re-renders the tab, which clears and rebuilds the ADD block along with
  // everything else — so the accepted rows are now in the table above and the
  // block is empty.
  const merged = upsertLunchScheduleRows(parsed.rows);

  // Put the rejects back into the fresh block so they can be corrected in
  // place rather than silently lost. Its row numbers moved with the render,
  // so it has to be located again.
  const after = findLunchAddBlock(sheet);
  if (after && parsed.rejects.length > 0) {
    const back = parsed.rejects.map(r => {
      const padded = r.raw.slice(0, LUNCH_ADD_HEADERS.length)
        .map(v => (v instanceof Date ? v : String(v === null || v === undefined ? '' : v)));
      while (padded.length < LUNCH_ADD_HEADERS.length) padded.push('');
      return padded;
    });
    const needed = after.firstRow + back.length - 1;
    if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
    sheet.getRange(after.firstRow, 1, back.length, LUNCH_ADD_HEADERS.length).setValues(back);
  }

  // A pasted month routinely contains "Not Serving" rows, and one of them can
  // land on a date people have already signed up to eat on. Same warning as
  // typing it by hand — see warnAboutNotServingSignups().
  const warned = warnAboutNotServingSignups(collectNotServingPairs(parsed.rows));

  const parts = [`✅ ${merged.added} added`];
  if (merged.updated > 0) parts.push(`${merged.updated} updated`);
  if (parsed.rejects.length > 0) parts.push(`⚠️ ${parsed.rejects.length} left in the add area (${parsed.rejects[0].reason})`);
  if (warned === 0) {
    toastIfPossible(`${parts.join(', ')}. Use "🍱 Push Menu Changes to Forms" when you want the forms to show it.`);
  }
  log(`Lunch menu add: ${merged.added} new, ${merged.updated} updated, ${parsed.rejects.length} rejected.`);
}

/** The {date, location} pairs among canonical menu rows whose Type is "Not Serving". */
function collectNotServingPairs(menuRows) {
  const map = getIndexMap(HEADERS.Lunch_Schedule);
  const pairs = [];
  (menuRows || []).forEach(row => {
    if (String(row[map['Type']] || '').trim() !== 'Not Serving') return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    pairs.push({ date, location: String(row[map['Location']] || '').trim() });
  });
  return pairs;
}

/**
 * Turns a raw grid of pasted/typed cells into canonical Lunch_Schedule rows.
 *
 * Accepts, in one pass and without being told which it is getting:
 *   • a proper multi-column paste           -> ['2026-09-14','Narberth','Hot',…]
 *   • one CSV line per cell                 -> ['2026-09-14, Narberth, Hot, …']
 *   • the entire CSV in a single cell       -> a blob with newlines in it
 *   • a header line ("Date,Location,Type…") -> recognized and skipped
 * That is the whole point: "batch and single work similarly" means there is
 * exactly one code path, and the shape of what you pasted is not your problem.
 *
 * Returns { rows: [canonical row arrays], rejects: [{raw, reason, incomplete}] }.
 * `incomplete` marks a row that is merely unfinished (still being typed)
 * rather than wrong — the caller stays quiet about those.
 */
function parseLunchMenuGrid(grid) {
  const rows = [];
  const rejects = [];
  const map = getIndexMap(HEADERS.Lunch_Schedule);

  // Flatten to a list of field-arrays first, expanding any cell that is
  // itself CSV/multi-line text.
  const records = [];
  (grid || []).forEach(cells => {
    const nonEmpty = cells.filter(c => String(c === null || c === undefined ? '' : c).trim() !== '');
    if (nonEmpty.length === 0) return;

    const first = cells[0];
    const firstText = first instanceof Date ? '' : String(first === null || first === undefined ? '' : first);
    const onlyFirstColumn = nonEmpty.length === 1 && firstText.trim() !== '';
    if (onlyFirstColumn && (firstText.indexOf('\n') !== -1 || firstText.indexOf(',') !== -1 || firstText.indexOf('\t') !== -1)) {
      parseCsvText(firstText).forEach(fields => records.push({ fields, raw: [firstText] }));
      return;
    }
    records.push({ fields: cells, raw: cells });
  });

  records.forEach(rec => {
    const f = rec.fields;
    const get = i => {
      const v = f[i];
      if (v instanceof Date) return v;
      return String(v === null || v === undefined ? '' : v).trim();
    };

    // A header line pasted along with the data — skip it silently.
    const firstText = String(get(0) || '').toLowerCase();
    if (firstText === 'date' || firstText === 'event_date') return;

    const date = coerceMenuDate(get(0));
    const location = canonicalizeLocation(get(1));
    const type = canonicalizeLunchType(get(2));
    const description = String(get(3) || '');
    const shorthand = String(get(4) || '');

    const missing = [];
    if (!date) missing.push('a date');
    if (!location) missing.push('a location');
    if (!type) missing.push('a type');
    if (missing.length > 0) {
      // "Wrong" vs "not finished yet": a row where something was TYPED into a
      // field but did not resolve is an error worth reporting; a row where the
      // field is simply still blank is someone mid-entry.
      const typedButUnresolved =
        (!date && String(get(0) || '') !== '') ||
        (!location && String(get(1) || '') !== '') ||
        (!type && String(get(2) || '') !== '');
      rejects.push({
        raw: rec.raw.map(v => (v instanceof Date ? formatDateKey(v) : v)),
        reason: typedButUnresolved
          ? `couldn't read ${missing.join(', ')} in "${[get(0), get(1), get(2)].filter(Boolean).join(', ')}"`
          : `needs ${missing.join(' and ')}`,
        incomplete: !typedButUnresolved
      });
      return;
    }

    const row = new Array(HEADERS.Lunch_Schedule.length).fill('');
    row[map['Event_Date']] = date;
    row[map['Location']] = location;
    row[map['Type']] = type;
    // "Not Serving" is a statement about the DAY, not a meal — a description
    // or shorthand on it would show up as a menu hint on the form's date
    // label for a day nobody is being fed.
    row[map['Meal_Description']] = type === 'Not Serving' ? '' : description;
    row[map['Meal_Shorthand']] = type === 'Not Serving' ? '' : shorthand;
    rows.push(row);
  });

  return { rows, rejects };
}

/**
 * Merges canonical rows into Lunch_Schedule, keyed on date + location — the
 * same identity mergeLegacyTabs() uses. A second row for a date that already
 * has one REPLACES it (re-pasting a corrected month is the common case, and
 * ending up with two contradictory menus for one day is never wanted).
 *
 * Does not render; callers do that once at the end.
 */
function upsertLunchScheduleRows(newRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_SCHEDULE);
  const headers = HEADERS.Lunch_Schedule;
  const map = getIndexMap(headers);
  const existing = readLunchScheduleRows(sheet);

  const keyOf = row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return '';
    return `${formatDateKey(d)}|${String(row[map['Location']] || '').trim()}`;
  };

  const byKey = {};
  const order = [];
  existing.forEach(row => {
    const key = keyOf(row);
    if (!key) return;
    if (byKey[key] === undefined) order.push(key);
    byKey[key] = row;
  });

  let added = 0, updated = 0;
  newRows.forEach(row => {
    const key = keyOf(row);
    if (!key) return;
    if (byKey[key] === undefined) { order.push(key); added++; } else { updated++; }
    byKey[key] = row;
  });

  const out = order.map(k => byKey[k]);
  renderLunchScheduleSheet(false, out);
  return { added, updated, total: out.length };
}

/**
 * A minimal RFC4180 CSV reader: quoted fields, "" escapes, embedded commas
 * and newlines, and tab-separated input (what a spreadsheet actually puts on
 * the clipboard) all included. Returns an array of field-arrays.
 *
 * Written out rather than split(',') because a meal description with a comma
 * in it — "Chicken, rice and beans" — is the normal case here, not an edge one.
 */
function parseCsvText(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  if (src.trim() === '') return [];

  // Tab wins if present: a paste out of Excel/Sheets is tab-separated, and its
  // fields routinely contain unquoted commas.
  const delimiter = src.indexOf('\t') !== -1 ? '\t' : ',';

  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') { inQuotes = true; field = ''; continue; }
    if (ch === delimiter) { record.push(field.trim()); field = ''; continue; }
    if (ch === '\n') {
      record.push(field.trim());
      if (record.some(v => v !== '')) records.push(record);
      record = []; field = '';
      continue;
    }
    field += ch;
  }
  record.push(field.trim());
  if (record.some(v => v !== '')) records.push(record);
  return records;
}

/**
 * Parses whatever a person put in a date cell. Real Dates pass through;
 * yyyy-MM-dd and the US m/d/yyyy are read explicitly (rather than left to
 * `new Date(string)`, which reads "9/14/2026" and "2026-09-14" in two
 * different timezones and lands the second one a day early); anything else
 * falls back to coerceDate().
 */
function coerceMenuDate(value) {
  if (value instanceof Date) return coerceDate(value);
  const text = String(value === null || value === undefined ? '' : value).trim();
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const us = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(us[1]) - 1, Number(us[2]));
  }

  return coerceDate(text);
}

/** Snaps free text onto a CALENDAR_MAP location name, or '' if it matches none. */
function canonicalizeLocation(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!text) return '';
  const names = Object.values(CALENDAR_MAP);
  const exact = names.filter(n => n.toLowerCase() === text)[0];
  if (exact) return exact;
  // A prefix match covers "narb" and "Narberth Center" alike, but only when
  // exactly one location can be meant — an ambiguous abbreviation is a reject,
  // not a coin toss.
  const partial = names.filter(n => n.toLowerCase().indexOf(text) === 0 || text.indexOf(n.toLowerCase()) === 0);
  return partial.length === 1 ? partial[0] : '';
}

/** Snaps free text onto a LUNCH_TYPE_OPTIONS value, or '' if it matches none. */
function canonicalizeLunchType(value) {
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (!text) return '';
  if (text === 'hot') return 'Hot';
  if (text === 'cold') return 'Cold';
  if (['not serving', 'not-serving', 'none', 'no lunch', 'no', 'n/a', 'closed', 'off'].indexOf(text) !== -1) {
    return 'Not Serving';
  }
  return '';
}

/**
 * The paste-or-upload dialog: the same parser as the in-sheet ADD block, for
 * when the CSV is in a file or is too big to want to see land on the tab.
 * Open to everyone — adding a menu changes no structure and deletes nothing.
 */
function showLunchMenuImportDialog() {
  const html = HtmlService.createHtmlOutput(buildLunchMenuImportHtml())
    .setWidth(560)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Menu Items');
}

/** The dialog's markup. Inline so this project stays a single .gs file. */
function buildLunchMenuImportHtml() {
  const locations = Object.values(CALENDAR_MAP).join(' · ');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }
  textarea { width: 100%; height: 210px; font-family: Consolas, Menlo, monospace; font-size: 12px;
             box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
  .row { margin: 10px 0; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 10px; min-height: 18px; font-weight: bold; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Paste CSV, or choose a .csv file</h3>
<p class="hint">
  One line per date and location:<br>
  <code>Date, Location, Type, Meal Description, Shorthand</code><br>
  Locations: ${locations}. Type: <code>Hot</code>, <code>Cold</code> or <code>Not Serving</code>.
  A header line is fine — it's ignored. A date that already has a menu is replaced.
</p>
<div class="row"><input type="file" id="file" accept=".csv,.txt,text/csv"></div>
<textarea id="csv" placeholder="2026-09-14, Narberth, Hot, Chicken Parmesan, Chx Parm
2026-09-15, Ashbridge, Cold, Turkey Wrap, Turkey
2026-09-16, Narberth, Not Serving"></textarea>
<div class="row"><button id="go" onclick="submit()">Add to Lunch_Schedule</button></div>
<div id="status"></div>
<script>
  document.getElementById('file').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { document.getElementById('csv').value = reader.result; };
    reader.readAsText(f);
  });
  function submit() {
    var text = document.getElementById('csv').value;
    if (!text.trim()) { say('Nothing to add — paste some rows first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working…', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .importLunchMenuCsv(text);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Same parser, same upsert, same rules as the in-sheet
 * ADD block — this is a second doorway onto one implementation, not a second
 * implementation. Returns a human-readable summary for the dialog to show.
 */
function importLunchMenuCsv(text) {
  const records = parseCsvText(text);
  if (records.length === 0) return '⚠️ Nothing to add — no rows found in that text.';

  const parsed = parseLunchMenuGrid(records);
  if (parsed.rows.length === 0) {
    const why = parsed.rejects.length > 0 ? ` (${parsed.rejects[0].reason})` : '';
    return `⚠️ No usable rows${why}. Expected: Date, Location, Type, Description, Shorthand.`;
  }

  const merged = upsertLunchScheduleRows(parsed.rows);
  log(`importLunchMenuCsv: ${merged.added} added, ${merged.updated} updated, ${parsed.rejects.length} skipped.`);

  const parts = [`${merged.added} added`];
  if (merged.updated > 0) parts.push(`${merged.updated} updated`);
  if (parsed.rejects.length > 0) parts.push(`${parsed.rejects.length} skipped — ${parsed.rejects[0].reason}`);

  // Reported in the dialog rather than as a toast — a modal is in the way of
  // the toast, and this is the one line in the result somebody must not miss.
  const clash = checkNotServingSignups(collectNotServingPairs(parsed.rows));
  const warning = clash.total > 0
    ? ` ⚠️ ${clash.total} person(s) had signed up for lunch on a date you marked "Not Serving" ` +
      `(${formatDateLabel(clash.affected[0].date)} at ${clash.affected[0].location}: ` +
      `${describePeopleList(clash.affected[0].people)}) — they need telling.`
    : '';

  return `✅ ${parts.join(', ')}. Use "Push Menu Changes to Forms" when you want the forms to show it.${warning}`;
}

/**
 * Rewrites the date labels (and the lunch question) on every live form whose
 * sessions fall on an UPCOMING Lunch_Schedule date — the deliberate,
 * once-you-mean-it counterpart to the modal that used to fire mid-typing.
 *
 * Past dates are skipped: their forms are closed business, and rewriting them
 * is pure quota spend.
 */
function pushLunchMenuToForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  if (!sheet) { toastIfPossible('No Lunch_Schedule tab yet — nothing to push.'); return 0; }

  const headers = HEADERS.Lunch_Schedule;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());

  const pairs = [];
  const seen = {};
  readLunchScheduleRows(sheet).forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) < todayKey) return;
    const location = String(row[map['Location']] || '').trim();
    const key = `${formatDateKey(d)}|${location}`;
    if (seen[key]) return;
    seen[key] = true;
    pairs.push({ date: d, location });
  });

  if (pairs.length === 0) {
    toastIfPossible('No upcoming menu dates — nothing to push.');
    return 0;
  }

  if (!confirmConsequentialAction('Push the menu to the registration forms?',
    `${pairs.length} upcoming date(s) will be pushed.\n\n` +
    'Every registration form covering them will have its date labels rewritten, and the lunch ' +
    'question added or removed to match what the schedule now says.\n\n' +
    'Registrants and their existing answers are never changed.', false)) {
    return 0;
  }

  const affected = refreshFormsForLunchDates(pairs);
  toastIfPossible(`Menu pushed to ${affected} form(s) across ${pairs.length} date(s) ✅`);
  return affected;
}

/**
 * Batched form refresh for a list of {date, location} pairs.
 *
 * Reads the session table ONCE and touches each affected form ONCE, however
 * many dates it covers. The per-date refreshFormsForChangedLunchDate() below
 * re-reads the whole dashboard on every call, which was fine for the single
 * date an onEdit produced and quadratic for a pasted month.
 */
function refreshFormsForLunchDates(pairs) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return 0;

  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;
  const map = getIndexMap(headers);

  const wanted = {};
  pairs.forEach(p => {
    if (!p.date) return;
    wanted[`${formatDateKey(p.date)}|${p.location || ''}`] = true;
  });

  const affectedFormIds = {};
  rows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    const key = formatDateKey(d);
    const location = String(row[map['Location']] || '').trim();
    // A pair with no location means "this date, wherever it is".
    if (!wanted[`${key}|${location}`] && !wanted[`${key}|`]) return;
    const formId = row[map['Form_ID']];
    if (formId) affectedFormIds[formId] = true;
  });

  const formIds = Object.keys(affectedFormIds);
  formIds.forEach(formId => refreshOneFormDateLabels(formId, rows, map, 'menu push'));
  flushPersistentRegistries();
  log(`refreshFormsForLunchDates: refreshed ${formIds.length} form(s) for ${pairs.length} date(s).`);
  return formIds.length;
}

/**
 * Rebuilds one form's date-dependent items from the session rows already in
 * memory — every date that form covers, not just the changed one, so a single
 * menu edit self-heals any stale label on it.
 */
function refreshOneFormDateLabels(formId, sessionRows, map, context) {
  const formRows = sessionRows.filter(row => row[map['Form_ID']] === formId);
  if (formRows.length === 0) return false;

  const formContext = buildFormSessionContext(formId, formRows, map, getSharedFormIdSet());
  if (formContext.sessions.length === 0) return false;

  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(formContext.sessions, formContext);

  // A menu edit is exactly how a form gains or loses its last lunch date, so
  // the question set is re-checked here, not just the row labels.
  let form = null;
  let questionsChanged = 0;
  try {
    form = FormApp.openById(formId);
    questionsChanged = syncLunchQuestionsOnForm(form, formContext.locations, lunchDateLabels.length > 0);
  } catch (err) {
    log(`⚠️ Could not open form ${formId} to re-check its lunch questions after a ${context} (${err}).`);
    return false;
  }

  return applyFormDateLabels(formId, allDateLabels, lunchDateLabels,
    { form, force: questionsChanged > 0, context });
}

/**
 * Single-date convenience wrapper over refreshFormsForLunchDates(), kept for
 * running by hand from the Apps Script editor ("this one date's labels look
 * wrong"). Pass no location to mean "this date, wherever it is".
 */
function refreshFormsForChangedLunchDate(changedDate, location) {
  return refreshFormsForLunchDates([{ date: changedDate, location: location || '' }]);
}


// ============================================================================
// 2. SHEET SETUP UTILITY  (initSheet)
// ============================================================================

/**
 * FIRST-TIME setup for a workbook that has nothing in it yet: build every
 * tab, create the template form, install the triggers, and hand off to the
 * calendar import.
 *
 * NOT the right tool for a workbook already carrying data. To roll a layout
 * change onto a live workbook — new columns, a new panel, changed
 * formatting — use rebuildLayoutFromSheet() instead: same redraw, from the
 * rows already on the tabs, with no calendar read, no form write, and no
 * triage pass that could remove a session.
 */
function initSheet() {
  if (!requireAuthorizedAdmin('Initialize sheet setup')) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // NOT deleted here any more. This used to drop Active_Programs outright,
  // discarding whatever was on it — the log line even claimed its data "now
  // lives in" the new tab, which nothing had actually arranged. Leaving it
  // alone means mergeLegacyTabs() can still salvage it; initSheet() has no
  // business destroying the only copy of anything.
  const legacySheet = ss.getSheetByName(LEGACY_ACTIVE_PROGRAMS_SHEET_NAME);
  if (legacySheet) {
    log(`ℹ️ Found the legacy "${LEGACY_ACTIVE_PROGRAMS_SHEET_NAME}" tab. It is left untouched — ` +
      `run mergeLegacyTabs() to fold its rows into "${SHEET_NAMES.PROGRAM_DASHBOARD}" and remove it.`);
    noteForAdmin('Leftover tabs',
      `"${LEGACY_ACTIVE_PROGRAMS_SHEET_NAME}" is still in the workbook — run mergeLegacyTabs() to merge and clear it.`);
  }

  buildConfigSheet(ss);
  initLunchScheduleSheet(ss);

  try {
    getOrCreateTemplateForm();
  } catch (err) {
    log(`⚠️ Could not build/verify the template registration form during setup (${err}) — it will be retried on the next calendar sync.`);
  }

  renderRegistrantsSheet(true);
  renderTriageSheet(true);

  initPlaceholderSheet(ss, SHEET_NAMES.LUNCH_DASHBOARD, 'Run "Sync Registrations" from the menu to populate this dashboard.');

  renderProgramDashboard(true);
  refreshMemoryTabs(null, null); // builds Member_Roll / Program_Options, empty on a fresh workbook
  renderClubMembersSheet([]);   // and the (empty) club roster, so its columns exist from day one

  writeTriggers();
  reorderTabs(ss);

  toastIfPossible('Sheet setup complete ✅ — next: "Import Everything (First Run)".');
  log('initSheet complete.');
}

/**
 * REBUILD EVERY TAB INTO THE CURRENT LAYOUT, USING ONLY WHAT IS ALREADY IN
 * THE WORKBOOK. No calendar, no forms, no Drive, no network at all.
 *
 * The problem this exists for: shipping a layout change to a workbook that is
 * already carrying a year of real data. initSheet() rebuilds the tabs, but a
 * calendar sync is the normal partner to it, and on a busy calendar that is
 * slow, quota-hungry, and — via triageDeletedSessions() — the one path in the
 * system that can REMOVE sessions and shunt their registrants to triage. None
 * of that is wanted when the only thing that actually changed is where the
 * columns sit.
 *
 * So this is the same rebuild with every outward-facing step removed:
 *
 *   REBUILT (from the rows already on each tab)
 *     Config (older layouts are backed up, current ones kept as-is)
 *     Master_Program_Dashboard    — with triage OFF
 *     Lunch_and_Event_Registrants — including the Quick Mark panel
 *     Deleted_Event_Triage
 *     Lunch_Schedule              — including the new ADD block
 *     Master_Lunch_Dashboard      — recomputed; hand-entered columns kept
 *     Member_Roll / Program_Options — staff columns never touched
 *     Tab order, column widths, dropdowns, conditional formatting
 *
 *   NOT TOUCHED
 *     The calendars.       Nothing is read from or written to them.
 *     The registration forms. No form is opened, created, or relabelled.
 *     The triggers.        Automation keeps running exactly as it was.
 *     The template form.   Not created or version-checked.
 *
 * EVERY ROW IS READ BEFORE ANY TAB IS CLEARED. Each render is otherwise a
 * read-then-clear-then-write on its own tab, which is fine in isolation, but
 * reading up front also means the confirmation dialog can state real counts —
 * and a dialog that says "1,240 registrant rows" is one somebody can actually
 * check before agreeing to it.
 *
 * Safe to run repeatedly. Nothing here is order-dependent on a sync having
 * happened, and running it twice produces the same workbook.
 */
function rebuildLayoutFromSheet() {
  if (!requireAuthorizedAdmin('Rebuild Layout (from sheet)')) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const read = (name, headers, marker) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return [];
    try {
      return name === SHEET_NAMES.LUNCH_SCHEDULE
        ? readLunchScheduleRows(sheet)
        : readAllSectionedRows(sheet, headers, marker);
    } catch (err) {
      log(`⚠️ Rebuild: could not read "${name}" (${err}) — treating it as empty.`);
      return [];
    }
  };

  const sessionRows = read(SHEET_NAMES.PROGRAM_DASHBOARD, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registrantRows = read(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS, HEADERS.Lunch_and_Event_Registrants, 'Event_ID');
  const triageRows = read(SHEET_NAMES.TRIAGE, HEADERS.Deleted_Event_Triage, 'Event_ID');
  const menuRows = read(SHEET_NAMES.LUNCH_SCHEDULE, HEADERS.Lunch_Schedule, 'Event_Date');

  // A workbook with no sessions has nothing to rebuild FROM, and quietly
  // producing a set of correctly-formatted empty tabs would look like success
  // while destroying the "wait, where did everything go?" signal.
  if (sessionRows.length === 0 && registrantRows.length === 0 && menuRows.length === 0) {
    const message = 'Nothing to rebuild from — this workbook has no sessions, registrants or menu rows yet. ' +
      'Use "Import Everything (First Run)" to bring the calendar in.';
    log(`rebuildLayoutFromSheet: ${message}`);
    toastIfPossible(message);
    return null;
  }

  if (!confirmConsequentialAction('Rebuild every tab from the data already here?',
    `Found: ${sessionRows.length} session(s), ${registrantRows.length} registrant row(s), ` +
    `${triageRows.length} triaged row(s), ${menuRows.length} menu row(s).\n\n` +
    'Every tab is redrawn in the current layout using exactly these rows. ' +
    'Your hand-entered columns, notes and manual rows are all kept.\n\n' +
    'The calendars, the registration forms and the automatic triggers are NOT touched — ' +
    'nothing outside this spreadsheet changes, and no session can be removed.', false)) {
    return null;
  }

  toastIfPossible('Rebuilding every tab from the data already here…');

  buildConfigSheet(ss);

  // Triage OFF — see renderProgramDashboard(). This is what makes the whole
  // operation calendar-free, and it is the single most important line here.
  renderProgramDashboard(true, { sessionRows, skipTriage: true, registrantRows });

  renderRegistrantsSheet(true, registrantRows);
  renderTriageSheet(true, triageRows);
  renderLunchScheduleSheet(true, menuRows);

  // After the tabs above, in this order, on purpose:
  //  - counts are recomputed from the registrant rows onto the session table;
  //  - the lunch dashboard reads the menu index, which only becomes correct
  //    once Lunch_Schedule has been rewritten (renderLunchScheduleSheet()
  //    invalidates that cache);
  //  - the memory tabs are derived from both of the tabs above them.
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  if (registrySheet && registrantsSheet) {
    recomputeEventRegistryCounts(registrySheet, registrantsSheet, registrantRows);
  }
  updateMasterLunchDashboard(registrantRows);
  refreshMemoryTabs(registrantRows, sessionRows);
  // Redrawn from its own rows, exactly like every other tab here — the roster
  // is data staff own, so a layout rebuild must preserve it verbatim.
  renderClubMembersSheet(refreshClubMemberLabels(sessionRows));

  reorderTabs(ss);

  const summary = `Rebuilt from existing data ✅ — ${sessionRows.length} session(s), ` +
    `${registrantRows.length} registrant row(s), ${menuRows.length} menu row(s). ` +
    `Calendars, forms and triggers untouched.`;
  log(`rebuildLayoutFromSheet: ${summary}`);
  toastIfPossible(summary);
  return { sessionRows: sessionRows.length, registrantRows: registrantRows.length, menuRows: menuRows.length };
}

/**
 * Builds/refreshes the day-by-day, per-location Lunch_Schedule tab. If an
 * older Month-based (no Location) layout is found, it's renamed to a
 * timestamped backup instead of being destroyed.
 */
function initLunchScheduleSheet(ss) {
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  if (sheet && sheet.getRange(1, 1).getValue() === 'Month') {
    const backupName = `Lunch_Schedule_OLD_${Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss')}`;
    sheet.setName(backupName);
    log(`⚠️ Existing Lunch_Schedule tab used the older Month-based layout — renamed to "${backupName}". ` +
      `The new tab tracks one row per date PER LOCATION (with a "Not Serving" Type option) — please migrate anything you still need.`);
  }
  renderLunchScheduleSheet(true);
}

/** Puts tabs in a logical, at-a-glance order. */
function reorderTabs(ss) {
  const order = [
    SHEET_NAMES.PROGRAM_DASHBOARD,
    SHEET_NAMES.LUNCH_DASHBOARD,
    SHEET_NAMES.LUNCH_EVENT_REGISTRANTS,
    SHEET_NAMES.LUNCH_SCHEDULE,
    SHEET_NAMES.MEMBER_ROLL,
    SHEET_NAMES.CLUB_MEMBERS,
    SHEET_NAMES.PROGRAM_OPTIONS,
    SHEET_NAMES.CONFIG,
    SHEET_NAMES.TRIAGE
  ];
  order.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });
}

function initPlaceholderSheet(ss, tabName, message) {
  const sheet = getOrCreateSheet(ss, tabName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1).setValue(message).setFontStyle('italic').setFontColor('#666666');
  }
  autosizeColumns(sheet);
}

function setHeadersIfNeeded(sheet, headers) {
  const existing = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || 1)).getValues()[0];
  const needsWrite = headers.some((h, i) => String(existing[i] || '').trim() !== h);
  if (needsWrite) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    log(`Headers written on "${sheet.getName()}"`);
  }
}

function styleHeaderRow(sheet, numCols) {
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight('bold')
    .setBackground('#434343')
    .setFontColor('#FFFFFF')
    .setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/**
 * ONE type scale for the whole workbook. Every tab draws from this, so a
 * "banner" looks like a banner everywhere and the eye learns the hierarchy
 * once: big left-aligned blue banner = a section starts here; dark bold row =
 * these are the columns; plain = data.
 *
 * Sizes, not just weights, do the work — bold-on-bold reads as noise, whereas
 * a genuine size step is legible at a glance from across a desk, which is how
 * this workbook actually gets used on a serving day.
 */
const TYPO = {
  BANNER:        { size: 13, weight: 'bold', color: '#FFFFFF', background: '#3C78D8' },
  BANNER_HERO:   { size: 18, weight: 'bold', color: '#FFFFFF', background: '#1155CC' },
  COLUMN_HEADER: { size: 10, weight: 'bold', color: '#FFFFFF', background: '#434343' },
  HERO_VALUE:    { size: 16, weight: 'bold', color: '#0B5394' },
  HERO_LABEL:    { size: 11, weight: 'bold', color: '#434343' },
  MUTED:         { size: 9,  weight: 'normal', color: '#666666' }
};

/** Row heights that go with the scale above. */
const ROW_HEIGHTS = {
  BANNER: 28,
  BANNER_HERO: 40,
  HERO_DATA: 34
};

/**
 * Writes a section banner at an arbitrary row: text in column A, the banner
 * color across the full width of the table.
 *
 * LEFT-ALIGNED, deliberately: centering put the text in the middle of a very
 * wide strip, nowhere near the column-A edge the eye scans down. Left-aligned,
 * every banner starts on the same vertical line as the data beneath it and the
 * tab reads as a stack of labelled blocks.
 *
 * NOT MERGED, and that matters. It used to merge across the table, which is
 * incompatible with freezing columns — Sheets refuses with "you can't freeze
 * columns which contain only part of a merged cell", and since every tab has
 * these banners, one merged banner blocked setFrozenColumns() on the whole tab
 * (this took out initSheet() entirely). Once the text is left-aligned the merge
 * buys nothing: OVERFLOW lets it spill across the empty cells to its right and
 * it looks identical.
 *
 * breakApart() is still called, on the full row width, to undo merges left
 * behind by earlier versions of this function.
 *
 * `hero` gives the one banner per tab that should dominate (Today's Lunch
 * Needs, Today at Each Location) a larger size, deeper blue and a taller row.
 */
function writeSectionBanner(sheet, row, numCols, text, options) {
  options = options || {};
  const style = options.hero ? TYPO.BANNER_HERO : TYPO.BANNER;

  // Full row width, not just numCols: an older render may have merged wider.
  try {
    sheet.getRange(row, 1, 1, Math.max(sheet.getMaxColumns(), numCols)).breakApart();
  } catch (err) { /* nothing merged here */ }

  sheet.getRange(row, 1, 1, numCols)
    .setFontSize(style.size)
    .setFontWeight(style.weight)
    .setFontColor(style.color)
    .setBackground(style.background)
    .setVerticalAlignment('middle');

  sheet.getRange(row, 1)
    .setValue(text)
    .setHorizontalAlignment('left')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);

  try {
    sheet.setRowHeight(row, options.hero ? ROW_HEIGHTS.BANNER_HERO : ROW_HEIGHTS.BANNER);
  } catch (err) { /* row may not exist yet on a brand-new sheet */ }
}

/**
 * Freezes `count` columns, tolerating failure.
 *
 * Sheets refuses to freeze columns that would cut a merged cell in half, and a
 * merge can arrive from anywhere — an old render, or someone merging a few
 * cells by hand. A frozen column is a nicety; losing the entire render over one
 * is not a trade worth making, so this reports and carries on.
 */
function freezeColumnsSafely(sheet, count) {
  if (!count || count < 1) return false;
  try {
    sheet.setFrozenColumns(count);
    return true;
  } catch (err) {
    log(`ℹ️ Could not freeze ${count} column(s) on "${sheet.getName()}" (${err}) — ` +
      `usually a merged cell spanning the freeze line. Everything else rendered normally.`);
    return false;
  }
}

/** Writes a bold, dark header row of the given headers at an arbitrary row. */
function writeSectionHeader(sheet, row, numCols, headerValues) {
  sheet.getRange(row, 1, 1, numCols).setValues([headerValues])
    .setFontSize(TYPO.COLUMN_HEADER.size)
    .setFontWeight(TYPO.COLUMN_HEADER.weight)
    .setBackground(TYPO.COLUMN_HEADER.background)
    .setFontColor(TYPO.COLUMN_HEADER.color)
    .setVerticalAlignment('middle')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

/** Manual alternating white/light-gray fill — safe to be overwritten later. */
function applyZebraStripingManual(sheet, numDataRows) {
  const lastCol = Math.max(sheet.getLastColumn(), HEADERS[sheet.getName()] ? HEADERS[sheet.getName()].length : 1);
  applyZebraStripingManualBounded(sheet, 2, numDataRows, lastCol);
}

/** Same idea, but for an exact row range/column count. */
function applyZebraStripingManualBounded(sheet, startRow, numRows, numCols) {
  if (numRows < 1 || numCols < 1) return;
  const backgrounds = [];
  for (let r = 0; r < numRows; r++) {
    backgrounds.push(new Array(numCols).fill(r % 2 === 0 ? '#FFFFFF' : '#F6F6F6'));
  }
  sheet.getRange(startRow, 1, numRows, numCols).setBackgrounds(backgrounds);
}

/** Native row banding for tabs that are a single flat table with nothing else competing for background color. */
function applyZebraStripingBanding(sheet, startRow) {
  startRow = startRow || 2;
  sheet.getBandings().forEach(b => b.remove());
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const numRows = Math.max(sheet.getMaxRows() - startRow + 1, 1);
  const range = sheet.getRange(startRow, 1, numRows, lastCol);
  const banding = range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  banding.setFirstRowColor('#FFFFFF');
  banding.setSecondRowColor('#F3F3F3');
}

/**
 * Resizes columns to fit their content via a single whole-sheet call.
 * options.minCols guarantees columns are considered even if
 * sheet.getLastColumn() hasn't caught up yet this execution. options.force
 * additionally clears any lingering WRAP strategy first (wrapped cells
 * report a fixed/incorrect content width and block autosize).
 */
function autosizeColumns(sheet, options) {
  options = options || {};
  const force = !!options.force;
  const lastCol = Math.max(sheet.getLastColumn(), options.minCols || 0);
  if (lastCol < 1) return;

  try {
    if (force) {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      sheet.getRange(1, 1, lastRow, lastCol).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
    sheet.autoResizeColumns(1, lastCol);
    applyColumnWidthBuffer(sheet, lastCol);
  } catch (err) {
    log(`autosizeColumns skipped on "${sheet.getName()}": ${err}`);
  }
}

/**
 * Pads already-autofitted columns out to COLUMN_WIDTH_BUFFER_MULTIPLIER of
 * their fitted width, clamped to [MIN_COLUMN_WIDTH_PX, MAX_COLUMN_WIDTH_PX].
 * Assumes the caller just ran autoResizeColumns() — it reads the fitted
 * widths rather than re-fitting.
 *
 * On call counts, since this runs on every render of every tab: the fit is
 * ONE batched autoResizeColumns() (not one autoResizeColumn() per column),
 * and while the N getColumnWidth() reads are unavoidable — SpreadsheetApp
 * has no batch width read — the WRITES are grouped. Consecutive columns
 * landing on the same target width go out as a single setColumnWidths()
 * run, and after clamping that happens a lot: every column pinned to the
 * cap collapses into one call, as does every run of similar short columns.
 */
function applyColumnWidthBuffer(sheet, lastCol) {
  const targets = [];
  for (let col = 1; col <= lastCol; col++) {
    const padded = Math.round(sheet.getColumnWidth(col) * COLUMN_WIDTH_BUFFER_MULTIPLIER);
    targets.push(Math.max(MIN_COLUMN_WIDTH_PX, Math.min(padded, MAX_COLUMN_WIDTH_PX)));
  }

  let runStart = 0;
  for (let i = 1; i <= targets.length; i++) {
    if (i < targets.length && targets[i] === targets[runStart]) continue;
    sheet.setColumnWidths(runStart + 1, i - runStart, targets[runStart]);
    runStart = i;
  }
}

/**
 * One-shot padded autofit across EVERY sheet in the workbook. Exposed on
 * the menu ("Resize All Sheets") and safe to run any time — it only ever
 * sets column widths, so there's no data, formatting, or form state to
 * lose. Use it after tuning the width constants above, or to fix up a tab
 * that predates them.
 *
 * Deliberately NOT called from any render path: each render already
 * autosizes the single tab it just rewrote, which is strictly cheaper than
 * re-walking the workbook, and doing both would size every sheet twice.
 */
function resizeAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  sheets.forEach(sheet => autosizeColumns(sheet, { force: true }));
  log(`resizeAllSheets: padded autofit applied to ${sheets.length} sheet(s).`);
  ss.toast(`Resized ${sheets.length} sheet(s) ✅`, 'Calendar & Form Manager', 5);
}


// ============================================================================
// 2b. CONFIG SHEET (Meal Buffers, Order Ahead, Catering Policy, Automation — see CONFIG_LAYOUT above)
// ============================================================================

function buildConfigSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
  const isCurrentLayout = sheet && sheet.getRange(1, 1).getValue() === CONFIG_LAYOUT.MEAL_BUFFERS.title;

  if (sheet && !isCurrentLayout && sheet.getLastRow() > 0) {
    const backupName = `Config_OLD_${Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd_HHmmss')}`;
    sheet.setName(backupName);
    log(`⚠️ Existing Config tab used an older layout — renamed to "${backupName}". ` +
      `Lunch Menu rows now belong on the "${SHEET_NAMES.LUNCH_SCHEDULE}" tab (by date AND location), ` +
      `and Form Footer Notes are hardcoded in FORM_FOOTER_BY_LOCATION — please migrate anything you still need.`);
    sheet = null;
  }
  if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.CONFIG);

  writeConfigStructure(sheet);
  styleConfigSheet(sheet);
  return sheet;
}

function writeConfigStructure(sheet) {
  Object.values(CONFIG_LAYOUT).forEach(section => {
    const span = section.headers.length;
    // Config's banners DO stay merged: unlike every other tab's, these sit
    // side by side across the row (one per settings block, each spanning only
    // its own columns), so the merge is what visually bounds each block — and
    // Config never freezes columns, so there is nothing for it to conflict
    // with. Left-aligned and on the shared scale, to match the other tabs.
    const bannerRange = sheet.getRange(1, section.startCol, 1, span);
    try { bannerRange.breakApart(); } catch (err) { /* not previously merged */ }
    bannerRange.merge()
      .setValue(section.title)
      .setFontSize(TYPO.BANNER.size)
      .setFontWeight(TYPO.BANNER.weight)
      .setFontColor(TYPO.BANNER.color)
      .setBackground(TYPO.BANNER.background)
      .setHorizontalAlignment('left')
      .setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

    sheet.getRange(CONFIG_HEADER_ROW, section.startCol, 1, span)
      .setValues([section.headers])
      .setFontSize(TYPO.COLUMN_HEADER.size)
      .setFontWeight(TYPO.COLUMN_HEADER.weight)
      .setBackground(TYPO.COLUMN_HEADER.background)
      .setFontColor(TYPO.COLUMN_HEADER.color);
  });
  sheet.setFrozenRows(CONFIG_HEADER_ROW);
}

function styleConfigSheet(sheet) {
  applyZebraStripingBanding(sheet, CONFIG_DATA_START_ROW);
  const lastSectionEndCol = Math.max(...Object.values(CONFIG_LAYOUT).map(s => s.startCol + s.headers.length - 1));
  autosizeColumns(sheet, { force: true, minCols: lastSectionEndCol });

  const bufferSection = CONFIG_LAYOUT.MEAL_BUFFERS;
  const validationRows = MEAL_BUFFER_LOCATIONS.length * CATERED_LUNCH_TYPES.length; // exactly the fixed Location x Hot/Cold combos

  applyValueListValidationBounded(sheet, bufferSection.startCol, MEAL_BUFFER_LOCATIONS, CONFIG_DATA_START_ROW, validationRows);
  applyValueListValidationBounded(sheet, bufferSection.startCol + 1, CATERED_LUNCH_TYPES, CONFIG_DATA_START_ROW, validationRows);

  // One policy row per location, so the dropdowns are bounded the same way.
  const policySection = CONFIG_LAYOUT.CATERING_POLICY;
  const policyRows = Math.max(Object.keys(CALENDAR_MAP).length, 1);
  applyValueListValidationBounded(sheet, policySection.startCol, Object.values(CALENDAR_MAP), CONFIG_DATA_START_ROW, policyRows);
  applyValueListValidationBounded(sheet, policySection.startCol + 1, CATERING_POLICY_OPTIONS, CONFIG_DATA_START_ROW, policyRows);

  applyValueListValidationBounded(sheet, CONFIG_LAYOUT.LINK_DISPLAY.startCol,
    LINK_DISPLAY_OPTION_LIST, CONFIG_DATA_START_ROW, 1);
  applyValueListValidationBounded(sheet, CONFIG_LAYOUT.CALENDAR_INVITES.startCol,
    CALENDAR_INVITE_OPTION_LIST, CONFIG_DATA_START_ROW, 1);

  // Automation_Enabled is a two-value dropdown so the kill switch can never
  // be half-set by a typo — "no", "NO", "nope" and "off" are not the same
  // thing to isAutomationEnabled(), and only one of them stops anything.
  const automationSection = CONFIG_LAYOUT.AUTOMATION;
  applyValueListValidationBounded(sheet, automationSection.startCol, AUTOMATION_ENABLED_OPTIONS, CONFIG_DATA_START_ROW, 1);

  seedMealBufferRows(sheet);
  seedOrderAheadRow(sheet);
  seedAdminNotificationRow(sheet);
  seedCateringPolicyRows(sheet);
  seedLinkDisplayRow(sheet);
  seedAutomationRow(sheet);
  seedCalendarInviteRow(sheet);
  invalidateConfigCaches(); // the seeds above may have just written cells the caches were built from
}

/** Pre-fills the fixed Location x Hot/Cold combinations if they aren't already present. Never overwrites an existing combo's row. */
function seedMealBufferRows(sheet) {
  const section = CONFIG_LAYOUT.MEAL_BUFFERS;
  // Scanned across the sheet's full current height so an existing combo
  // sitting past this section's own data (because some OTHER section is
  // currently taller) is still found — see the startRow comment below for
  // why that same wide scan must NOT be used to decide where to append.
  const sheetLastRow = sheet.getLastRow();
  const existingCombos = new Set();
  if (sheetLastRow >= CONFIG_DATA_START_ROW) {
    const existing = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, sheetLastRow - CONFIG_DATA_START_ROW + 1, 2).getValues();
    existing.forEach(([loc, type]) => { if (loc && type) existingCombos.add(`${loc}|${type}`); });
  }

  const rowsToAdd = [];
  MEAL_BUFFER_LOCATIONS.forEach(loc => {
    CATERED_LUNCH_TYPES.forEach(type => {
      if (!existingCombos.has(`${loc}|${type}`)) {
        rowsToAdd.push([loc, type, DEFAULT_MEAL_BUFFERS.standardBufferAmount, DEFAULT_MEAL_BUFFERS.testerBufferAmount]);
      }
    });
  });
  if (rowsToAdd.length === 0) return;

  // Deliberately NOT sheet.getLastRow(): that's the tallest column on the
  // WHOLE sheet, not this section's own. Once any other Config section is
  // taller than this one, appending at sheetLastRow + 1 pushes these rows
  // down into that other section's column range instead of stacking under
  // this section's own existing rows. existingCombos.size IS this section's
  // own row count (it counts real Location+Type rows already present), so
  // it's what "the next empty row in THIS column" actually means.
  const startRow = CONFIG_DATA_START_ROW + existingCombos.size;
  sheet.getRange(startRow, section.startCol, rowsToAdd.length, section.headers.length).setValues(rowsToAdd);
  log(`Seeded ${rowsToAdd.length} Meal Buffer Amounts row(s) on "${SHEET_NAMES.CONFIG}".`);
}

function seedOrderAheadRow(sheet) {
  const section = CONFIG_LAYOUT.ORDER_AHEAD;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (cell.getValue() === '') {
    cell.setValue(DEFAULT_ORDER_AHEAD_DAYS);
    log(`Seeded default Order Ahead Time (${DEFAULT_ORDER_AHEAD_DAYS} days) on "${SHEET_NAMES.CONFIG}".`);
  }
}

/**
 * Writes one policy row per CALENDAR_MAP location, seeded from
 * DEFAULT_CATERING_POLICY_BY_LOCATION. Never overwrites a location that
 * already has a row — this is a setting staff own once it exists.
 */
function seedCateringPolicyRows(sheet) {
  const section = CONFIG_LAYOUT.CATERING_POLICY;
  const sheetLastRow = sheet.getLastRow(); // see seedMealBufferRows() for why this is scan-only, never append-math
  const existing = new Set();
  if (sheetLastRow >= CONFIG_DATA_START_ROW) {
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, sheetLastRow - CONFIG_DATA_START_ROW + 1, 1)
      .getValues()
      .forEach(([loc]) => { const v = String(loc || '').trim(); if (v) existing.add(v); });
  }

  const rowsToAdd = Object.values(CALENDAR_MAP)
    .filter(loc => !existing.has(loc))
    .map(loc => [loc, DEFAULT_CATERING_POLICY_BY_LOCATION[loc] || FALLBACK_CATERING_POLICY]);
  if (rowsToAdd.length === 0) return;

  // existing.size IS this section's own row count so far — NOT
  // sheet.getLastRow(), which by the time this runs (fourth of four Config
  // seeds) reflects whichever section is tallest and would append these
  // rows into that section's row range instead of this one's. This is what
  // put "Lunch Service by Location" at rows 7-9 instead of 3-5 the first
  // time this ran, once Meal Buffer Amounts had already filled rows 3-6.
  const startRow = CONFIG_DATA_START_ROW + existing.size;
  sheet.getRange(startRow, section.startCol, rowsToAdd.length, section.headers.length).setValues(rowsToAdd);
  sheet.getRange(startRow, section.startCol + 1, rowsToAdd.length, 1).setNote(
    'Always = lunch unless a date is marked Not Serving.\n'
    + 'By exception = only dates with a Hot/Cold row on Lunch_Schedule.\n'
    + 'Never = no lunch at all; hidden from the lunch dashboard and not asked about on forms.');
  log(`Seeded ${rowsToAdd.length} Lunch Service by Location row(s) on "${SHEET_NAMES.CONFIG}".`);
}

/**
 * Leaves the admin email BLANK on purpose — an empty cell means "don't
 * send anything," and guessing an address (the current user's, say) would
 * start mailing someone who never asked for it. Just annotates the cell so
 * it's obvious what goes there.
 */
function seedAdminNotificationRow(sheet) {
  const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setNote('Optional. One address to receive a per-sync digest of items needing attention '
      + '(waitlisted registrants, forms that failed to open, triaged deleted events). Leave blank to disable.');
  }
}

/** Seeds "Show link" and explains the trade-off in the cell note. */
function seedLinkDisplayRow(sheet) {
  const section = CONFIG_LAYOUT.LINK_DISPLAY;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(DEFAULT_LINK_DISPLAY);
    log(`Seeded default Registration Link display ("${DEFAULT_LINK_DISPLAY}") on "${SHEET_NAMES.CONFIG}".`);
  }
  cell.setNote(
    'Show link = every upcoming event description carries a "📝 Register for ..." link at the top.\n'
    + 'Hide link = no registration link in event descriptions at all.\n\n'
    + 'Changing this does not rewrite existing events on its own — run '
    + '"🔗 Rewrite Event Links" from the Admin menu to apply it to what is already out there.');
}

/**
 * Seeds "Invite registrants" and explains, in the cell note, exactly what
 * turning it on causes Google to send.
 */
function seedCalendarInviteRow(sheet) {
  const section = CONFIG_LAYOUT.CALENDAR_INVITES;
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(cell.getValue() || '').trim() === '') {
    cell.setValue(DEFAULT_CALENDAR_INVITE);
    log(`Seeded default Calendar Invitations setting ("${DEFAULT_CALENDAR_INVITE}") on "${SHEET_NAMES.CONFIG}".`);
  }
  cell.setNote(
    'Invite registrants = anyone who gives an email address on a registration form is added as a GUEST '
    + 'to that session\'s Google Calendar event, so it appears in their own calendar with Google\'s reminders.\n\n'
    + 'Google emails an invitation when someone is added and a cancellation when they are removed — this '
    + 'setting sends real mail to real people. Only UPCOMING sessions are ever touched, and someone whose '
    + 'registration is cancelled is taken back off the guest list.\n\n'
    + 'Do not invite = the calendar events are left exactly as they are.');
}

/**
 * The current Calendar Invitations setting. Unlike the link switch this fails
 * CLOSED on anything unrecognized: the cost of wrongly not inviting is that
 * someone has to check the workbook, and the cost of wrongly inviting is mail
 * sent to members on the strength of a typo.
 */
function getCalendarInviteMode() {
  if (__calendarInviteModeCache !== null) return __calendarInviteModeCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let mode = DEFAULT_CALENDAR_INVITE;
  if (sheet) {
    const raw = String(sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.CALENDAR_INVITES.startCol).getValue() || '').trim();
    if (raw) {
      const match = CALENDAR_INVITE_OPTION_LIST.filter(o => o.toLowerCase() === raw.toLowerCase())[0];
      mode = match || CALENDAR_INVITE_OPTIONS.NONE;
      if (!match) {
        log(`⚠️ Config's Invite_Registrants reads "${raw}", which isn't one of ` +
          `${CALENDAR_INVITE_OPTION_LIST.join(' / ')} — not inviting anyone until that is fixed.`);
      }
    }
  }
  __calendarInviteModeCache = mode;
  return mode;
}

/** True when registrants should be added to their session's calendar event as guests. */
function shouldInviteRegistrants() {
  return getCalendarInviteMode() === CALENDAR_INVITE_OPTIONS.INVITE;
}

/**
 * The current Registration Link setting. Anything unrecognized reads as
 * "Show link": a typo in this cell must not silently strip the registration
 * link off every event in the calendar.
 */
function getLinkDisplayMode() {
  if (__linkDisplayCache !== null) return __linkDisplayCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let mode = DEFAULT_LINK_DISPLAY;
  if (sheet) {
    const raw = String(sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.LINK_DISPLAY.startCol).getValue() || '').trim();
    const match = LINK_DISPLAY_OPTION_LIST.filter(o => o.toLowerCase() === raw.toLowerCase())[0];
    if (match) mode = match;
    else if (raw) log(`⚠️ Config's Link_Display reads "${raw}", which isn't one of ${LINK_DISPLAY_OPTION_LIST.join(' / ')} — using "${DEFAULT_LINK_DISPLAY}".`);
  }
  __linkDisplayCache = mode;
  return mode;
}

/** True when registration links belong in calendar event descriptions. */
function shouldShowLinkInDescription() {
  return getLinkDisplayMode() !== LINK_DISPLAY_OPTIONS.HIDE;
}

/**
 * Seeds Automation_Enabled to "Yes" and annotates all three cells.
 *
 * NEVER overwrites an existing value — a rebuild of the Config tab must not
 * silently switch automation back on underneath someone who paused it on
 * purpose, which is exactly the moment they are most likely to be running
 * setup functions. Trigger_Owner is likewise left alone; only a successful
 * writeTriggers() writes that (see claimTriggerOwnership()).
 */
function seedAutomationRow(sheet) {
  const section = CONFIG_LAYOUT.AUTOMATION;
  const enabledCell = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol);
  if (String(enabledCell.getValue() || '').trim() === '') {
    enabledCell.setValue(AUTOMATION_ENABLED_OPTIONS[0]); // 'Yes'
  }
  enabledCell.setNote('Master switch for the calendar sync, registration sync, and calendar-edit handlers. '
    + 'Set to "No" to stop all of them — including triggers created by a DIFFERENT Google account, '
    + 'which is the only way to stop those without opening the Apps Script editor. '
    + 'Anything other than "No" (including blank) means enabled.');

  sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 1).setNote(
    'The one account that holds this project\'s triggers. Written automatically when that account runs '
    + 'Admin → Check Triggers. Other admins are blocked from rebuilding triggers so a second, invisible '
    + 'set can never be created — use Admin → Take Over Trigger Ownership to move it deliberately.');

  sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 2).setNote(
    'When the owner above last rebuilt the triggers.');

  invalidateConfigCaches();
}

/**
 * Looks up the static Standard_Buffer/Tester_Buffer amounts configured for
 * one location + lunch type (Hot/Cold) in Config's "Meal Buffer Amounts"
 * section. Falls back to DEFAULT_MEAL_BUFFERS if no matching row exists
 * (which is always the case for "Not Serving," by design).
 */
function getMealBufferConfigForLocation(locationName, lunchType) {
  const index = getMealBufferIndex();
  const hit = index[`${locationName}|${String(lunchType).trim()}`];
  if (hit) return Object.assign({}, hit);

  log(`No Meal Buffer Amounts row found for "${locationName}" / "${lunchType}" yet — using defaults (Standard: ${DEFAULT_MEAL_BUFFERS.standardBufferAmount}, Tester: ${DEFAULT_MEAL_BUFFERS.testerBufferAmount}).`);
  return Object.assign({}, DEFAULT_MEAL_BUFFERS);
}

/**
 * Reads Config's "Meal Buffer Amounts" section ONCE per execution into
 * { 'Location|Type': {standardBufferAmount, testerBufferAmount} }. Was a
 * full Config read per call, and updateMasterLunchDashboard() calls it once
 * per rollup row.
 */
function getMealBufferIndex() {
  if (__mealBufferIndexCache) return __mealBufferIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (sheet && lastRow >= CONFIG_DATA_START_ROW) {
    const section = CONFIG_LAYOUT.MEAL_BUFFERS;
    const numRows = lastRow - CONFIG_DATA_START_ROW + 1;
    const data = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, numRows, section.headers.length).getValues();
    data.forEach(([loc, type, standardAmt, testerAmt]) => {
      const key = `${String(loc).trim()}|${String(type).trim()}`;
      if (index[key] !== undefined) return; // first matching row wins, as the old top-down scan did
      index[key] = {
        standardBufferAmount: (standardAmt !== '' && !isNaN(standardAmt)) ? Number(standardAmt) : DEFAULT_MEAL_BUFFERS.standardBufferAmount,
        testerBufferAmount: (testerAmt !== '' && !isNaN(testerAmt)) ? Number(testerAmt) : DEFAULT_MEAL_BUFFERS.testerBufferAmount
      };
    });
  }
  __mealBufferIndexCache = index;
  return index;
}

/**
 * Reads Config's "Lunch Service by Location" section ONCE per execution
 * into { Location: policy }. Anything not listed — or listed with an
 * unrecognized value — falls back to FALLBACK_CATERING_POLICY.
 */
function getCateringPolicyIndex() {
  if (__cateringPolicyIndexCache) return __cateringPolicyIndexCache;
  const index = {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (sheet && lastRow >= CONFIG_DATA_START_ROW) {
    const section = CONFIG_LAYOUT.CATERING_POLICY;
    const numRows = lastRow - CONFIG_DATA_START_ROW + 1;
    const data = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol, numRows, section.headers.length).getValues();
    data.forEach(([loc, policy]) => {
      const location = String(loc || '').trim();
      const value = String(policy || '').trim();
      if (!location || index[location] !== undefined) return;
      if (CATERING_POLICY_OPTIONS.indexOf(value) === -1) return;
      index[location] = value;
    });
  }
  __cateringPolicyIndexCache = index;
  return index;
}

/** A location's standing lunch posture — see CATERING_POLICIES. */
function getCateringPolicyForLocation(locationName) {
  const key = String(locationName || '').trim();
  const configured = getCateringPolicyIndex()[key];
  if (configured) return configured;
  return DEFAULT_CATERING_POLICY_BY_LOCATION[key] || FALLBACK_CATERING_POLICY;
}

/**
 * Should this date+location be OFFERED lunch — on the form, and seeded onto
 * the lunch dashboard? Policy sets the default; an explicit Lunch_Schedule
 * row can always override in either direction.
 */
function isLunchOfferedOn(date, locationName) {
  const policy = getCateringPolicyForLocation(locationName);
  if (policy === CATERING_POLICIES.NEVER) return false;

  const meal = getMealInfoForDate(date, locationName);
  if (meal && meal.type === 'Not Serving') return false;
  if (policy === CATERING_POLICIES.BY_EXCEPTION) {
    // Nothing assumed: a real catered menu row has to exist for this date.
    return !!meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1;
  }
  return true; // ALWAYS
}

/**
 * Is there a Lunch_Schedule row for this date+location that explicitly says
 * "Not Serving"?
 *
 * THE DISTINCTION THIS EXISTS TO DRAW, and it is the whole point of the
 * Not-Serving handling: a date with NO menu row is a GAP — somebody hasn't
 * got to it yet — and a gap must never suppress a lunch a real person is
 * signed up for. A date whose row READS "Not Serving" is a DECISION. It has
 * an author, and the answer to "but three people signed up" is not to quietly
 * cater it anyway; it is to tell somebody those three people need telling.
 *
 * Everywhere the catering pipeline says "demand always wins", it means over a
 * gap. This is what it does not win over.
 *
 * Location-specific on purpose: getMealInfoForDate() with a location matches
 * only that location's row, so Narberth closing its kitchen says nothing
 * about Ashbridge on the same day.
 */
function isExplicitlyNotServing(date, locationName) {
  if (!date || !locationName) return false;
  const meal = getMealInfoForDate(date, locationName);
  return !!meal && String(meal.type || '').trim() === 'Not Serving';
}

/**
 * Everyone still expecting to eat at `location` on `dateKey` — Active
 * registrations with Lunch_Status "Needed". Returns [{name, event}].
 *
 * Reads the registrant rows' own Event_Date/Location rather than joining
 * through Event_ID and the session table, so it works from a plain
 * spreadsheet read and is safe to call from an onEdit (see onEdit()).
 */
function findRegistrantsExpectingLunch(dateKey, location, registrantRows) {
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);

  let rows = registrantRows;
  if (!rows) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS) : null;
    if (!sheet) return [];
    try {
      rows = readAllSectionedRows(sheet, headers, 'Event_ID');
    } catch (err) {
      log(`ℹ️ Could not read the registrants tab to check for lunch sign-ups (${err}).`);
      return [];
    }
  }

  const wantedLocation = String(location || '').trim();
  const found = [];
  rows.forEach(row => {
    if (String(row[map['Program_Status']] || '').trim() !== 'Active') return;
    if (String(row[map['Lunch_Status']] || '').trim() !== 'Needed') return;
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) !== dateKey) return;
    if (wantedLocation && String(row[map['Location']] || '').trim() !== wantedLocation) return;
    found.push({
      name: String(row[map['Name']] || '').trim() || '(unnamed)',
      event: String(row[map['Event']] || '').trim()
    });
  });
  return found;
}

/** "Marion Webb, Ada Cole and 3 more" — a name list short enough for a toast. */
function describePeopleList(people, max) {
  const limit = max || 4;
  const names = people.map(p => p.name);
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/**
 * Called the moment a date+location is marked "Not Serving" by hand or by
 * paste. Says, right there, whether anyone was counting on that meal.
 *
 * TOAST ONLY — no email. This runs on the onEdit path, where MailApp is
 * unavailable (see onEdit()); the same finding is raised as a real admin
 * notification by buildDashboardRollup() on the next sync, which is where the
 * durable record belongs. The toast is for the person who just typed it, who
 * is the one who can still ring those people.
 *
 * Past dates are skipped: there is nothing left to act on.
 */
function warnAboutNotServingSignups(pairs, registrantRows) {
  const result = checkNotServingSignups(pairs, registrantRows);
  if (result.total === 0) return 0;

  const first = result.affected[0];
  const more = result.affected.length > 1 ? ` (+${result.affected.length - 1} other date(s))` : '';
  toastIfPossible(
    `⚠️ ${result.total} person(s) had signed up for lunch on a date now marked "Not Serving" — ` +
    `${formatDateLabel(first.date)} at ${first.location}: ${describePeopleList(first.people)}${more}. ` +
    `They will drop off the lunch dashboard; they still need telling.`);
  return result.total;
}

/**
 * The query behind the warning, with no side effects beyond a log line, so
 * callers that report through something other than a toast (the CSV dialog)
 * can use the same answer.
 *
 * Returns { total, affected: [{date, location, people}] }. Past dates are
 * excluded — there is nothing left to act on.
 */
function checkNotServingSignups(pairs, registrantRows) {
  const todayKey = formatDateKey(new Date());
  const affected = [];
  let total = 0;

  (pairs || []).forEach(p => {
    if (!p.date || !p.location) return;
    const dateKey = formatDateKey(p.date);
    if (dateKey < todayKey) return;
    if (!isExplicitlyNotServing(p.date, p.location)) return;
    const people = findRegistrantsExpectingLunch(dateKey, p.location, registrantRows);
    if (people.length === 0) return;
    affected.push({ date: p.date, location: p.location, people });
    total += people.length;
  });

  if (total > 0) {
    log(`Not Serving: ${total} lunch sign-up(s) affected across ${affected.length} date(s).`);
  }
  return { total, affected };
}

function getOrderAheadDays() {
  if (__orderAheadDaysCache !== null) return __orderAheadDaysCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let days = DEFAULT_ORDER_AHEAD_DAYS;
  if (sheet) {
    const section = CONFIG_LAYOUT.ORDER_AHEAD;
    const val = sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue();
    const num = Number(val);
    if (val !== '' && !isNaN(num) && num > 0) days = num;
  }
  __orderAheadDaysCache = days;
  return days;
}

/**
 * The address in Config's "📧 Admin Notifications" section, or '' when
 * blank — in which case notifyAdmin() silently does nothing, so leaving it
 * empty is a perfectly valid way to turn notifications off.
 */
function getAdminNotificationEmail() {
  if (__adminNotificationEmailCache !== null) return __adminNotificationEmailCache;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
  let email = '';
  if (sheet) {
    const section = CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
    email = String(sheet.getRange(CONFIG_DATA_START_ROW, section.startCol).getValue() || '').trim();
  }
  __adminNotificationEmailCache = email;
  return email;
}

/**
 * Reads one cell of Config's Automation section, or '' if anything at all
 * gets in the way (no spreadsheet in this context, tab missing, tab
 * mid-rebuild). Never throws — every caller here treats '' as "not set",
 * and the whole point of the kill switch is that it cannot be tripped by
 * an unrelated failure.
 */
function readAutomationConfigCell(offset) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (!sheet) return '';
    const section = CONFIG_LAYOUT.AUTOMATION;
    return String(sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + offset).getValue() || '').trim();
  } catch (err) {
    log(`⚠️ Could not read the Automation section of Config (${err}).`);
    return '';
  }
}

/**
 * Is automation allowed to do work right now?
 *
 * Read by every managed handler as its first act, INCLUDING handlers fired
 * by triggers belonging to an account that cannot see this one. That is the
 * entire value: Script-level state is shared even though triggers are not,
 * so this is the only lever that reaches a trigger you have no ability to
 * delete.
 *
 * Cached twice over — once per execution, and once across executions via
 * CacheService (see AUTOMATION_FLAG_CACHE_SECONDS) — so a burst of
 * onCalendarChange firings costs one spreadsheet read between them all
 * rather than one apiece.
 *
 * Only the literal "No" disables. See DEFAULT_AUTOMATION_ENABLED for why
 * this fails open.
 */
function isAutomationEnabled() {
  if (__automationEnabledCache !== null) return __automationEnabledCache;

  const cache = tryGetScriptCache();
  if (cache) {
    try {
      const cached = cache.get(AUTOMATION_FLAG_CACHE_KEY);
      if (cached === 'yes' || cached === 'no') {
        __automationEnabledCache = cached === 'yes';
        return __automationEnabledCache;
      }
    } catch (err) { /* cache is an optimization; never let it decide anything */ }
  }

  const raw = readAutomationConfigCell(0);
  // Anything that isn't a deliberate "No" leaves automation on.
  const enabled = raw === '' ? DEFAULT_AUTOMATION_ENABLED : raw.toLowerCase() !== 'no';
  if (cache) {
    try { cache.put(AUTOMATION_FLAG_CACHE_KEY, enabled ? 'yes' : 'no', AUTOMATION_FLAG_CACHE_SECONDS); } catch (err) { /* non-fatal */ }
  }
  __automationEnabledCache = enabled;
  return enabled;
}

/**
 * CacheService is unavailable in some execution contexts (notably a simple
 * trigger running without authorization), and asking for it there throws.
 * Returns null instead so callers can just skip the cache.
 */
function tryGetScriptCache() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    return null;
  }
}

function clearAutomationFlagCache() {
  const cache = tryGetScriptCache();
  if (!cache) return;
  try { cache.remove(AUTOMATION_FLAG_CACHE_KEY); } catch (err) { /* non-fatal */ }
}

/**
 * The gate itself. Call as the first line of a managed handler and return
 * immediately if it comes back false.
 *
 * `quiet` suppresses the toast for the hot path (onCalendarChange, which can
 * fire hundreds of times while a paused calendar is being edited); the log
 * line is always written, because "why did nothing happen?" has to be
 * answerable afterwards.
 */
function automationGateAllows(actionLabel, quiet) {
  if (isAutomationEnabled()) return true;
  const message = `⏸️ Automation is paused — "${actionLabel}" did nothing. ` +
    `Set Automation_Enabled back to "Yes" on the Config tab (${CONFIG_LAYOUT.AUTOMATION.title}) to resume.`;
  log(message);
  if (!quiet) toastIfPossible(message);
  return false;
}

/**
 * The account recorded in Config as holding this project's triggers, or ''
 * when nobody has claimed them yet (in which case writeTriggers() lets the
 * first admin through and records them).
 */
function getTriggerOwner() {
  if (__triggerOwnerCache !== null) return __triggerOwnerCache;
  __triggerOwnerCache = readAutomationConfigCell(1).toLowerCase();
  return __triggerOwnerCache;
}

/**
 * Is the account running right now the recorded trigger owner?
 *
 * An UNCLAIMED project answers false — deliberately. "Nobody has claimed
 * these" is not permission to create them from whichever account happened to
 * click a menu item; it just means "Check Triggers" hasn't been run yet, and
 * that is the one path allowed to make the first claim.
 */
function isTriggerOwnerAccount() {
  const owner = getTriggerOwner();
  if (!owner) return false;
  const me = getCurrentUserEmail();
  return !!me && me === owner;
}

/** When the recorded owner last rebuilt the triggers — display only, '' if never. */
function getTriggersVerifiedAt() {
  return readAutomationConfigCell(2);
}

/**
 * Records `email` as the trigger owner and stamps the verification time.
 * Called by writeTriggers() after a successful rebuild, so the claim always
 * reflects an account that genuinely holds a live set rather than an
 * intention someone typed in.
 */
function claimTriggerOwnership(email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (!sheet) return;
    const section = CONFIG_LAYOUT.AUTOMATION;
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 1).setValue(email);
    sheet.getRange(CONFIG_DATA_START_ROW, section.startCol + 2)
      .setValue(Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd HH:mm'));
    __triggerOwnerCache = null;
  } catch (err) {
    // Not fatal: the triggers themselves were built successfully, and a
    // missing claim only costs the next admin a confirmation prompt.
    log(`⚠️ Triggers were rebuilt but the ownership claim could not be written to Config (${err}).`);
  }
}

/**
 * Sends one admin email, if an address is configured. Never throws — a
 * failed notification must not take down the sync that triggered it.
 */
function notifyAdmin(subject, body) {
  const email = getAdminNotificationEmail();
  if (!email) return false;
  try {
    MailApp.sendEmail(email, subject, body);
    log(`Sent admin notification to ${email}: ${subject}`);
    return true;
  } catch (err) {
    log(`⚠️ Could not send admin notification to "${email}" (${err}).`);
    return false;
  }
}

/**
 * Per-run collector for things an admin should hear about. Sections are
 * only included in the digest if something was actually added to them, and
 * NO email is sent at all when the whole thing is empty — a quiet sync
 * stays quiet, which is the only way a notification like this stays worth
 * reading.
 */
let __adminDigest = null;

function noteForAdmin(category, message) {
  if (!__adminDigest) __adminDigest = {};
  if (!__adminDigest[category]) __adminDigest[category] = [];
  __adminDigest[category].push(message);
}

/** Sends the accumulated digest (if any) and resets the collector. */
function flushAdminDigest(context) {
  const digest = __adminDigest;
  __adminDigest = null;
  if (!digest) return false;

  const categories = Object.keys(digest).filter(c => digest[c].length > 0);
  if (categories.length === 0) return false;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lines = [];
  categories.forEach(category => {
    lines.push(`${category} (${digest[category].length}):`);
    digest[category].forEach(m => lines.push(`  • ${m}`));
    lines.push('');
  });
  if (ss) lines.push(`Workbook: ${ss.getUrl()}`);

  const total = categories.reduce((sum, c) => sum + digest[c].length, 0);
  return notifyAdmin(`[Calendar & Form Manager] ${context}: ${total} item(s) need attention`, lines.join('\n'));
}

function computeOrderAheadFlag(eventDate, submittedAt, orderAheadDays) {
  if (!eventDate || !submittedAt || !orderAheadDays) return '';
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysNotice = Math.floor((eventDate - submittedAt) / msPerDay);
  if (daysNotice < 0) return '⚠️ Registered after the event date';
  if (daysNotice < orderAheadDays) return `⚠️ Only ${daysNotice}d notice (need ${orderAheadDays}d)`;
  return '';
}


// ============================================================================
// 3. MENU & TRIGGER HOOKS
// ============================================================================

/**
 * TWO MENUS, NOT ONE.
 *
 * Everyone gets the day-to-day items: the two syncs, the lunch-menu tools,
 * and Resize All Sheets (safe to click at any time — it only touches column
 * widths). Nothing on that list can restructure the workbook or delete
 * anything.
 *
 * Accounts in AUTHORIZED_ADMIN_EMAILS additionally get an "🔧 Admin"
 * submenu holding the structural entries: trigger repair, the first-run
 * import, and the READ-ONLY leftover-tab report.
 *
 * DELIBERATELY NOT IN ANY MENU:
 *   • mergeLegacyTabs()      — it deletes tabs after folding them in. There
 *                              is no undo, and no reason for it to be one
 *                              mis-click away on a menu that sits open all
 *                              day next to "Sync Cal".
 *   • initSheet()            — rebuilds every tab and all formatting.
 *   • initializeAndSyncAll()
 *   • cancelBootstrapCalendars(), restoreTriagedRegistrants(),
 *     confirmLargeTriage(), recheckAllRegistrationForms(),
 *     cleanupNeverPolicyForms()
 * All of them still exist, still work, and are still admin-gated; they're
 * run from the Apps Script editor by someone who went looking for them.
 *
 * A HIDDEN MENU IS NOT A PERMISSION. Anyone with edit access to the
 * spreadsheet can open the script editor and run any function in this file
 * by name. The menu split is ergonomics — it keeps destructive things out of
 * reach of a normal day. requireAuthorizedAdmin() inside each of those
 * functions is the actual gate, and it is what must be kept correct.
 */
function onOpen() {
  buildAppMenu(SpreadsheetApp.getUi(), isAuthorizedAdmin());
}

/**
 * Builds (or rebuilds) the workbook menu. `includeAdmin` decides whether the
 * structural submenu is attached.
 *
 * Split out from onOpen() so showAdminMenu() can re-run it — see below.
 */
function buildAppMenu(ui, includeAdmin) {
  const menu = ui.createMenu(APP_MENU_NAME)
    .addItem('Sync Cal', 'syncCalendars')
    .addItem('Sync Registrations', 'syncRegistrations')
    .addSeparator()
    .addItem('🖨️ Print Sign-In Sheet (PDF)…', 'showSignInSheetDialog')
    .addItem('📧 Invite Registrants to Calendar Events', 'inviteRegistrantsNow')
    .addSeparator()
    .addItem('🍱 Add Menu Items (paste/upload CSV)…', 'showLunchMenuImportDialog')
    .addItem('🍱 Push Menu Changes to Forms', 'pushLunchMenuToForms')
    .addItem('🔁 Apply Type / Club / No-Reg Changes to Calendar', 'applyProgramTagChangesToCalendar')
    .addItem('🔗 Link Program Across Locations…', 'linkProgramAcrossLocations')
    .addItem('📄 Move Sessions to Another Form…', 'showRepointSessionsDialog')
    .addItem('🗑️ Delete Registrations…', 'showDeleteRegistrationsDialog')
    .addSeparator()
    .addItem('🕓 Show All Past Rows', 'showAllPastRows')
    .addItem('Resize All Sheets', 'resizeAllSheets');

  if (includeAdmin) {
    menu.addSeparator().addSubMenu(ui.createMenu('🔧 Admin')
      .addItem('🧱 Rebuild Layout (no calendar sync)', 'rebuildLayoutFromSheet')
      .addItem('🔗 Rewrite Event Links (fix duplicates)', 'rewriteEventRegistrationLinks')
      .addItem('💣 Destroy & Rebuild Forms…', 'destroyAndRebuildAllForms')
      .addSeparator()
      .addItem('Trigger Status', 'showTriggerStatus')
      .addItem('Check Triggers', 'writeTriggers')
      .addItem('Take Over Trigger Ownership', 'takeOverTriggerOwnership')
      .addItem('Release My Triggers', 'releaseMyTriggers')
      .addSeparator()
      .addItem('Import Everything (First Run)', BOOTSTRAP_ENTRY_NAME)
      .addSeparator()
      .addItem('Find Leftover Tabs (read-only report)', 'previewLegacyTabMerge')
      .addItem('Archive Old Months (report)', 'reportArchivableMonths'));
  } else {
    // The escape hatch. onOpen() runs as a SIMPLE trigger, which in some
    // execution contexts cannot resolve the signed-in account at all — and
    // getCurrentUserEmail() deliberately fails closed, so a genuine admin
    // can open the workbook and find no Admin submenu. Clicking a menu ITEM
    // always runs fully authorized, so this re-checks and rebuilds. A
    // non-admin who clicks it just gets told no.
    menu.addSeparator().addItem('🔧 Admin Tools (sign-in check)…', 'showAdminMenu');
  }

  menu.addToUi();
}

const APP_MENU_NAME = '🗓️ Calendar & Form Manager';

/**
 * Re-checks the current account with full authorization and, if it's an
 * admin, rebuilds the menu WITH the Admin submenu. Google replaces a menu of
 * the same name, so this swaps the menu in place rather than adding a second.
 * The rebuild lasts until the next reload.
 */
function showAdminMenu() {
  if (!requireAuthorizedAdmin('Admin Tools')) return;
  buildAppMenu(SpreadsheetApp.getUi(), true);
  toastIfPossible(`Admin tools added to the "${APP_MENU_NAME}" menu ✅`);
}

/**
 * Full setup from nothing. The calendar half runs as a sliced bootstrap
 * rather than a single syncCalendars(), because on a real calendar the first
 * import is far too much work for one execution — see section 4b.
 * bootstrapCalendars() returns as soon as its first slice is done and
 * finishes itself in the background, restoring every trigger (including the
 * hourly registration sync, which then imports any existing responses).
 */
function initializeAndSyncAll() {
  // Checked here too, not just inside initSheet()/bootstrapCalendars(): both
  // of those would otherwise fire their OWN rejection back to back, and the
  // log line after them ("setup done...") would run regardless and lie.
  if (!requireAuthorizedAdmin('Initialize + Sync Everything')) return;
  initSheet();
  bootstrapCalendars();
  log('initializeAndSyncAll: setup done; the calendar import continues in the background.');
}

/**
 * Ensures the triggers this project depends on exist, WITH NO DUPLICATES —
 *  - Two time-driven triggers (daily calendar sync, hourly registration sync)
 *  - One calendar-update trigger per calendar in CALENDAR_MAP, so an edit
 *    made directly on a calendar kicks off onCalendarChange() (which now
 *    does a cheap incremental check before deciding whether a full
 *    syncCalendars() is actually warranted — see section 3b).
 *
 * A FULL RESET, not an add-if-missing: every trigger for a handler this
 * project manages is deleted first, then exactly the intended set is
 * created. See resetTriggersForHandler(). This is what makes it safe to
 * press "Check Triggers" as often as you like — it can never leave two
 * copies of the same trigger both firing, however many were sitting there
 * before, and whatever left them there.
 *
 * THE ONE THING THIS CANNOT FIX: Apps Script installable triggers are
 * private to the Google account that created them — ScriptApp.getProjectTriggers()
 * only ever returns the triggers the CURRENTLY RUNNING account can see, never
 * another account's. If two different people have each run "Check Triggers"
 * / initSheet() / Import Everything on this project from their own Google
 * logins, each created their OWN calendar-edit triggers, invisible to each
 * other — so both fire on every calendar edit, independently, forever,
 * and no run of this function (from either account) can see or remove the
 * other's copies. That is what actually caused the extra calendar triggers
 * this comment is here because of.
 *   FIX: only ever run setup/trigger functions (this one, initSheet(),
 *   bootstrapCalendars(), the "Check Triggers"/"Import Everything" menu
 *   items) from ONE Google account — ideally whichever one owns the
 *   spreadsheet. To find and remove another account's leftover triggers,
 *   open the Apps Script editor's Triggers page (clock icon in the left
 *   sidebar) — unlike the API, that page lists every trigger on the
 *   project regardless of which account created it, with a "Created by"
 *   column, and anyone with edit access can delete from there.
 *
 * DECLINES while a bootstrap import is in flight, because that import
 * deliberately took these triggers down (see pauseAutomationForBootstrap()).
 * This is the guard that matters: the pause is only as good as the places
 * that can undo it, and "Check Triggers" — pressed by someone watching a long
 * import and wondering why nothing is scheduled — is exactly the reflex that
 * would put a hundred queued calendar edits back in play mid-run. Only
 * finishBootstrap() passes force, restoring everything when the import is
 * genuinely done.
 */
function writeTriggers(force, takingOwnership) {
  if (!requireAuthorizedAdmin('Check Triggers')) return;
  if (!force && isBootstrapActive()) {
    const message = `Triggers stay paused until the large-setup import or forms-rebuild sweep finishes — it restores them itself.`;
    log(`writeTriggers: ${message}`);
    toastIfPossible(message);
    return;
  }
  // `force` is only ever passed by finishBootstrap()/cancelBootstrapCalendars(),
  // which are RESTORING triggers they themselves removed. Those must never be
  // blocked by the ownership check: refusing there would leave the project
  // with no automation at all, which is a far worse failure than a duplicate
  // set, and it would happen precisely when someone is least likely to notice.
  // bootstrapCalendars() carries the ownership check instead, so a non-owner
  // cannot get into that state to begin with.
  if (!force && !takingOwnership && !requireTriggerOwnership()) return;

  let removed = 0;
  removed += resetTriggersForHandler('syncCalendars', () =>
    ScriptApp.newTrigger('syncCalendars').timeBased().everyDays(1).atHour(5).create());
  removed += resetTriggersForHandler('syncRegistrations', () =>
    ScriptApp.newTrigger('syncRegistrations').timeBased().everyHours(1).create());
  // The one trigger here that is not a schedule. An installable onEdit is the
  // only execution in this project that sees a cell edit AND is allowed to
  // write to a calendar, which is what makes ticking Club / No_Registration a
  // one-step action instead of a tick plus two menu items — see
  // onProgramFlagEditInstallable(). Without it everything still works; it just
  // waits for the next sync.
  removed += resetTriggersForHandler('onProgramFlagEditInstallable', () =>
    ScriptApp.newTrigger('onProgramFlagEditInstallable')
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create());

  // Built here, while there is authorization to spare, so the simple onEdit
  // that needs it never has to create a tab mid-edit.
  getPendingFlagSheet(true);

  const calendarResult = writeCalendarChangeTriggers(true); // the bootstrap check above already ran
  removed += calendarResult.removed;

  // Claimed only after the rebuild actually succeeded, so the recorded owner
  // is always an account that demonstrably holds a live set.
  claimTriggerOwnership(getCurrentUserEmail());

  const message = removed > 0
    ? `Triggers rebuilt ✅ (cleared ${removed} duplicate/stale one(s) under this account — see the log if more keep appearing)`
    : `All triggers verified — 1 daily, 1 hourly, ${calendarResult.created} calendar-edit ✅`;
  toastIfPossible(message); // also called from a trigger run, where there's no UI
  log(`writeTriggers complete: ${message}`);
}

/**
 * Blocks trigger creation from any account except the recorded owner.
 *
 * THIS IS THE CAUSE FIX for the duplicate-trigger problem, one level below
 * the admin gate. AUTHORIZED_ADMIN_EMAILS holds more than one account by
 * design — but two admins are exactly enough to reproduce the bug, because
 * each one's "Check Triggers" click builds a set the other cannot see or
 * delete. resetTriggersForHandler() cleans up duplicates WITHIN an account;
 * nothing can clean up across accounts. So the only real fix is to stop the
 * second set from being created at all.
 *
 * Passes when no owner is recorded yet (first run claims it), and when the
 * current account IS the owner. Otherwise refuses and names the owner —
 * the point being that someone who cannot see the triggers at least learns
 * who to ask, which a bare "triggers already exist" boolean could not tell
 * them.
 */
function requireTriggerOwnership() {
  const owner = getTriggerOwner();
  if (!owner) return true; // unclaimed — whoever rebuilds first becomes the owner
  const me = getCurrentUserEmail();
  if (me && me === owner) return true;

  const verifiedAt = getTriggersVerifiedAt();
  const when = verifiedAt ? ` (last rebuilt ${verifiedAt})` : '';
  const message = `⛔ This project's triggers are owned by ${owner}${when}. ` +
    `Rebuilding them from ${me || 'an unidentified account'} would create a SECOND set that neither account ` +
    `can see or delete — which is the exact problem this check exists to prevent. ` +
    `Ask ${owner} to run it, or use Admin → Take Over Trigger Ownership if that account is gone.`;
  log(message);
  toastIfPossible(message);
  return false;
}

/**
 * Deliberately moves trigger ownership to the current account.
 *
 * The honest part of this, and why it prompts rather than just doing it:
 * this CANNOT delete the previous owner's triggers. Nothing can, from here.
 * All it does is build this account's set and update the claim — so on its
 * own it makes the duplicate problem WORSE, not better, unless the previous
 * owner's set is genuinely gone (account deleted, triggers already removed)
 * or is cleaned up by hand afterwards.
 *
 * So the prompt says exactly that, and the success message ends with the
 * manual step rather than implying the job is finished.
 */
function takeOverTriggerOwnership() {
  if (!requireAuthorizedAdmin('Take Over Trigger Ownership')) return;

  const owner = getTriggerOwner();
  const me = getCurrentUserEmail();
  if (owner && me && owner === me) {
    toastIfPossible(`You already own this project's triggers (${me}) — use "Check Triggers" to rebuild them.`);
    return;
  }

  const detail = owner
    ? `Triggers are currently owned by ${owner}.\n\n` +
      `IMPORTANT: this cannot delete ${owner}'s triggers — Apps Script does not allow one account to remove ` +
      `another's, which is the whole reason duplicates are possible. Taking over builds YOUR set and records ` +
      `you as the owner. If ${owner}'s triggers still exist, BOTH sets will fire until someone deletes theirs ` +
      `from the Apps Script editor's Triggers page (clock icon → "Created by" column).\n\n` +
      `Only do this if ${owner} is gone or has already removed theirs.`
    : `No owner is recorded yet. This will build the triggers under ${me || 'this account'} and record it as the owner.`;

  if (!confirmConsequentialAction('Take over trigger ownership?', detail, false)) return;

  writeTriggers(false, true);
  const followUp = owner
    ? `Ownership moved to ${me} ✅ — now check the Apps Script editor's Triggers page and delete anything still listed under ${owner}.`
    : `Trigger ownership recorded as ${me} ✅`;
  toastIfPossible(followUp);
  log(followUp);
}

/**
 * The one useful thing a NON-owner account can do about triggers it holds:
 * remove its own. Ungated beyond the admin check on purpose — telling a
 * second admin "you have a duplicate set" while denying them the ability to
 * clear it would leave them stuck waiting on the owner for a mess only they
 * can clean up.
 */
function releaseMyTriggers() {
  if (!requireAuthorizedAdmin('Release My Triggers')) return;

  const me = getCurrentUserEmail();
  const mine = ScriptApp.getProjectTriggers()
    .filter(t => EXPECTED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1);

  if (mine.length === 0) {
    toastIfPossible(`No managed triggers exist under ${me || 'this account'} — nothing to release.`);
    return;
  }

  const owner = getTriggerOwner();
  const ownerWarning = owner && me && owner === me
    ? `\n\nNOTE: you are the RECORDED OWNER. Releasing leaves this project with no scheduled syncing at all ` +
      `until someone runs "Check Triggers" again.`
    : '';

  if (!confirmConsequentialAction('Release your triggers?',
    `This deletes the ${mine.length} managed trigger(s) created by ${me || 'this account'}. ` +
    `Triggers belonging to other accounts are unaffected — this cannot see or touch those.${ownerWarning}`, false)) {
    return;
  }

  mine.forEach(t => ScriptApp.deleteTrigger(t));
  clearHandlerAttributionForCurrentUser();
  const message = `Released ${mine.length} trigger(s) held by ${me} ✅`;
  log(message);
  toastIfPossible(message);
}


// ============================================================================
// 3a. RUNTIME TRIGGER ATTRIBUTION  ("who is actually firing this handler?")
// ============================================================================
//
// Every other defence here depends on bookkeeping staying honest: the owner
// claim can be bypassed by running writeTriggers() straight from the script
// editor, and a trigger deleted from the editor's Triggers page updates
// nothing at all. This does not depend on any of that.
//
// An installable trigger runs AS THE ACCOUNT THAT CREATED IT, and
// Session.getEffectiveUser() inside the handler therefore reports exactly
// who owns the trigger that just fired (see getCurrentUserEmail()). So each
// handler stamps its own runs, and if two different accounts are seen
// firing the SAME handler inside one window, duplicate trigger sets exist —
// observed, not inferred. That is the detector that would have caught the
// original bug with no discipline required from anyone.
//
// Stored in Script Properties (shared across accounts, unlike the triggers
// themselves) as { email: lastRunIso } per handler.
// ============================================================================

function getHandlerAttributionPropKey(handlerName) {
  return `${HANDLER_ATTRIBUTION_PROP_PREFIX}${handlerName}`;
}

/**
 * Reads one handler's attribution map, dropping anything older than
 * HANDLER_ATTRIBUTION_WINDOW_MS. Unreadable JSON reads as empty — this is a
 * diagnostic, and it must never be able to break a sync it is only watching.
 */
function getHandlerAttribution(handlerName) {
  let raw;
  try {
    raw = PropertiesService.getScriptProperties().getProperty(getHandlerAttributionPropKey(handlerName));
  } catch (err) {
    return {};
  }
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {};
  }
  const cutoff = Date.now() - HANDLER_ATTRIBUTION_WINDOW_MS;
  const fresh = {};
  Object.keys(parsed || {}).forEach(email => {
    const at = Date.parse(parsed[email]);
    if (!isNaN(at) && at >= cutoff) fresh[email] = parsed[email];
  });
  return fresh;
}

/**
 * Stamps "this handler just ran as me" and returns the distinct accounts
 * seen firing it inside the window — length > 1 means duplicate sets. A
 * throttled or failed call returns [] (i.e. "nothing measured this run",
 * never "no duplicates"); detectDuplicateTriggerAccounts() is the read-only
 * question to ask when you want a real answer.
 *
 * Wrapped so it can never throw into a caller: this runs at the top of the
 * sync handlers, and a failed diagnostic write must not stop a real sync.
 *
 * Read-modify-write on a Script Property is not atomic, so two firings
 * landing in the same instant can lose one of the two stamps. That only
 * delays detection to the next run — the duplicate account will stamp again
 * within a day — and the alternative (taking the script lock the syncs
 * themselves use) would make a diagnostic capable of blocking real work.
 */
function recordHandlerRun(handlerName) {
  try {
    const email = getCurrentUserEmail() || 'unidentified';

    // Throttled per handler PER ACCOUNT, which matters: a throttle keyed on
    // the handler alone would let the first account's stamp suppress the
    // second account's, hiding the very duplication this is here to find.
    // Keyed this way, each account still stamps, and onCalendarChange —
    // which can fire many times a minute — stops paying a property write
    // on every one of them. The throttle is minutes against a window of
    // hours, so nothing ages out un-refreshed.
    const cache = tryGetScriptCache();
    const throttleKey = `ATTR_${handlerName}_${email}`;
    if (cache) {
      try {
        // Returns [] rather than reading the property to report accounts:
        // paying a read on the throttled path would give back most of what
        // the throttle is here to save. No caller uses the return value for
        // anything but logging, and the un-throttled call a few minutes
        // later reports the same thing.
        if (cache.get(throttleKey)) return [];
      } catch (err) { /* cache is an optimization only */ }
    }

    const attribution = getHandlerAttribution(handlerName);
    attribution[email] = new Date().toISOString();
    PropertiesService.getScriptProperties()
      .setProperty(getHandlerAttributionPropKey(handlerName), JSON.stringify(attribution));
    if (cache) {
      try { cache.put(throttleKey, '1', HANDLER_ATTRIBUTION_THROTTLE_SECONDS); } catch (err) { /* non-fatal */ }
    }

    const accounts = Object.keys(attribution);
    if (accounts.length > 1) {
      log(`⚠️ DUPLICATE TRIGGERS: "${handlerName}" has fired under ${accounts.length} different accounts in the ` +
        `last ${Math.round(HANDLER_ATTRIBUTION_WINDOW_MS / 3600000)}h (${accounts.join(', ')}). Each account's ` +
        `triggers are invisible to the others, so "Check Triggers" cannot remove them — open the Apps Script ` +
        `editor's Triggers page (clock icon), sort by "Created by", and delete the set that shouldn't be there.`);
    }
    return accounts;
  } catch (err) {
    log(`⚠️ Could not record trigger attribution for "${handlerName}" (${err}) — continuing.`);
    return [];
  }
}

/** Drops the current account's stamps — used by releaseMyTriggers(), so a released set stops being reported as a duplicate. */
function clearHandlerAttributionForCurrentUser() {
  const me = getCurrentUserEmail() || 'unidentified';
  try {
    const props = PropertiesService.getScriptProperties();
    MANAGED_AUTOMATION_HANDLERS.forEach(handler => {
      const attribution = getHandlerAttribution(handler);
      if (attribution[me] === undefined) return;
      delete attribution[me];
      props.setProperty(getHandlerAttributionPropKey(handler), JSON.stringify(attribution));
    });
  } catch (err) {
    log(`⚠️ Could not clear trigger attribution for ${me} (${err}) — harmless, it ages out on its own.`);
  }
}

/** Handlers currently seen firing under more than one account: { handler: [emails] }. */
function detectDuplicateTriggerAccounts() {
  const found = {};
  MANAGED_AUTOMATION_HANDLERS.forEach(handler => {
    const accounts = Object.keys(getHandlerAttribution(handler));
    if (accounts.length > 1) found[handler] = accounts;
  });
  return found;
}

/**
 * The combined picture, in one dialog — deliberately showing all three
 * views side by side, because it is the DISAGREEMENT between them that
 * identifies the problem:
 *
 *   • what this account can see   (authoritative, but only for this account)
 *   • who Config says owns them   (a claim, which can be stale or bypassed)
 *   • who has actually been firing (observed, and the one that can't lie)
 *
 * An account showing in the third list but holding nothing in the first is
 * precisely the invisible duplicate set that no amount of "Check Triggers"
 * will clear.
 */
function showTriggerStatus() {
  if (!requireAuthorizedAdmin('Trigger Status')) return;

  const me = getCurrentUserEmail() || 'unidentified';
  const owner = getTriggerOwner();
  const verifiedAt = getTriggersVerifiedAt();
  const visible = ScriptApp.getProjectTriggers();
  const managed = visible.filter(t => EXPECTED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1);

  const counts = {};
  managed.forEach(t => {
    const handler = t.getHandlerFunction();
    counts[handler] = (counts[handler] || 0) + 1;
  });

  const lines = [];
  lines.push(`Signed in as: ${me}`);
  lines.push(`Automation: ${isAutomationEnabled() ? 'ENABLED' : '⏸️ PAUSED (Config → Automation_Enabled = No)'}`);
  lines.push(`Recorded owner: ${owner || '(unclaimed)'}${verifiedAt ? ` — last rebuilt ${verifiedAt}` : ''}`);
  if (owner && owner !== me) {
    lines.push(`  ⚠️ You are NOT the owner. "Check Triggers" will refuse to run from this account.`);
  }
  lines.push('');

  lines.push(`Triggers visible to THIS account (${managed.length}):`);
  if (managed.length === 0) {
    lines.push('  (none — either you never created any, or you released them)');
  } else {
    EXPECTED_TRIGGER_HANDLERS.forEach(handler => {
      if (counts[handler]) lines.push(`  ${handler}: ${counts[handler]}`);
    });
    lines.push(`  Expected for the owner: syncCalendars 1, syncRegistrations 1, ` +
      `onCalendarChange ${Object.keys(CALENDAR_MAP).length}, onProgramFlagEditInstallable 1`);
    if (!counts['onProgramFlagEditInstallable']) {
      lines.push(`  ⚠️ No onProgramFlagEditInstallable trigger. Ticking Club / No_Registration still works,`);
      lines.push(`     but the calendar is only updated on the next Sync Cal. "Check Triggers" installs it.`);
    }
  }
  lines.push('');

  lines.push(`Accounts actually seen firing (last ${Math.round(HANDLER_ATTRIBUTION_WINDOW_MS / 3600000)}h):`);
  let sawAny = false;
  MANAGED_AUTOMATION_HANDLERS.forEach(handler => {
    const accounts = Object.keys(getHandlerAttribution(handler));
    if (accounts.length === 0) return;
    sawAny = true;
    lines.push(`  ${handler}: ${accounts.join(', ')}${accounts.length > 1 ? '  ⚠️ DUPLICATES' : ''}`);
  });
  if (!sawAny) lines.push('  (nothing has fired yet — this fills in as the triggers run)');

  const duplicates = detectDuplicateTriggerAccounts();
  if (Object.keys(duplicates).length > 0) {
    lines.push('');
    lines.push('⚠️ DUPLICATE TRIGGER SETS EXIST. More than one account is firing the same handler.');
    lines.push('Nothing in this script can delete another account\'s triggers. To fix it:');
    lines.push('  1. Open the Apps Script editor → Triggers (clock icon in the left sidebar).');
    lines.push('  2. That page lists EVERY trigger with a "Created by" column — unlike this script, which');
    lines.push('     only ever sees its own account\'s.');
    lines.push('  3. Delete the sets belonging to any account other than ' + (owner || 'the intended owner') + '.');
    lines.push('  4. That account can also run Admin → Release My Triggers from its own login.');
    lines.push('');
    lines.push('In the meantime, setting Automation_Enabled to "No" on Config stops ALL of them,');
    lines.push('including the ones you cannot see.');
  }

  const report = lines.join('\n');
  log(`Trigger status:\n${report}`);
  try {
    SpreadsheetApp.getUi().alert('Trigger Status', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // No UI (editor run) — the log above is the output.
  }
}

/**
 * Deletes every trigger for `handlerName` visible to this account, then
 * calls `create` to install the replacement.
 *
 * Returns the number of EXCESS triggers found — existing.length minus the
 * one this handler is meant to have, floored at 0. Every normal run removes
 * exactly one (the trigger being replaced) and that's not worth reporting;
 * this return value is what lets writeTriggers() tell "routine rebuild" from
 * "there were actually duplicates" apart in its summary.
 */
function resetTriggersForHandler(handlerName, create) {
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === handlerName);
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  const excess = Math.max(existing.length - 1, 0);
  if (excess > 0) {
    log(`⚠️ Found ${existing.length} "${handlerName}" triggers (expected at most 1) — removed all of them before rebuilding.`);
  }
  create();
  return excess;
}

/**
 * Same reset as resetTriggersForHandler(), but for the one handler with
 * MULTIPLE expected triggers (one per calendar) — so "how many did we
 * expect" has to be compared after creating, not before. `removed` in the
 * result is the EXCESS over that expected count (see resetTriggersForHandler()
 * for why routine replacement doesn't count).
 */
function writeCalendarChangeTriggers(force) {
  if (!force && isBootstrapActive()) {
    log('writeCalendarChangeTriggers: skipped — a large-setup import or forms-rebuild sweep has these paused on purpose.');
    return { removed: 0, created: 0 };
  }

  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onCalendarChange');
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  const expected = Object.keys(CALENDAR_MAP).length;
  const excess = Math.max(existing.length - expected, 0);
  if (excess > 0) {
    log(`⚠️ Found ${existing.length} calendar-edit triggers (expected ${expected}, one per location) — removed all of them before rebuilding.`);
  }

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    ScriptApp.newTrigger('onCalendarChange').forUserCalendar(calendarId).onEventUpdated().create();
    log(`Created calendar-edit trigger for "${CALENDAR_MAP[calendarId]}".`);
  });
  return { removed: excess, created: expected };
}

/**
 * Removes every onCalendarChange trigger. The FULL syncCalendarsInternal()
 * still calls this before it edits calendar descriptions
 * (backInjectCalendarDescriptions), and rebuilds the triggers again in a
 * `finally` block regardless of success/failure — so a full sync's own
 * description edits can never re-fire these triggers and loop. The cheap
 * incremental delta-check in section 3b does NOT edit calendar events, so
 * it's safe to run even while these triggers are active.
 */
function removeCalendarChangeTriggers() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onCalendarChange');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  if (triggers.length > 0) {
    log(`Removed ${triggers.length} calendar-edit trigger(s) for the duration of this sync.`);
  }
  return triggers.length;
}

/**
 * THE QUIET WINDOW. Everything in this project that edits calendar
 * descriptions has to run inside one of these, and this is the one place that
 * knows how.
 *
 * WHY. A calendar edit is a calendar edit whoever made it, so the
 * onCalendarChange triggers cannot tell "somebody moved Tai Chi" from "this
 * script just wrote [Club] into forty descriptions." Left running, every
 * description this script writes fires a trigger, and each firing whose delta
 * contains a tracked event runs a FULL syncCalendars() — so one menu click, or
 * one ticked checkbox, becomes a storm of syncs reacting to nothing but their
 * own predecessor's edits.
 *
 * THE THREE STEPS, in this order and for these reasons:
 *   1. remove the triggers, so nothing fires while we write;
 *   2. do the work;
 *   3. advance each calendar's sync token PAST our own edits
 *      (primeCalendarSyncTokens) and only THEN put the triggers back — a
 *      trigger restored before the token moved would immediately deliver the
 *      changes we just made as news.
 *
 * RESTORE-ONLY, NEVER CREATE. An account that held no calendar triggers before
 * the work ends with none. This rule is not a detail: syncCalendars() and
 * several menu items are reachable by any editor, and unconditionally
 * rebuilding here is what used to hand every one of them a complete, private,
 * invisible-to-the-owner second set of triggers (see writeTriggers()). The
 * recorded trigger owner rebuilds normally, because an owner holding none is
 * a workbook that has simply not been set up yet.
 *
 * Re-entrant: nested calls (the pending-flag drain inside a sync, say) run
 * their work directly rather than restoring the triggers halfway through the
 * outer job.
 */
let calendarQuietWindowDepth = 0;

function withCalendarChangeTriggersPaused(reason, work) {
  if (calendarQuietWindowDepth > 0) return work(); // already inside one

  const held = removeCalendarChangeTriggers();
  if (held === 0) {
    // Either there genuinely are none, or they belong to ANOTHER Google
    // account — this one cannot see or delete those, and they will fire on
    // every description written below. Worth saying, since it is exactly the
    // case where a storm happens despite the precaution.
    log(`ℹ️ ${reason}: no calendar-edit triggers to pause under this account. If another account holds ` +
      `them, its triggers will still fire on the edits this makes.`);
  }

  calendarQuietWindowDepth++;
  try {
    return work();
  } finally {
    calendarQuietWindowDepth--;
    try {
      primeCalendarSyncTokens(reason);
    } catch (err) {
      log(`ℹ️ ${reason}: could not prime the calendar sync tokens (${err}).`);
    }
    try {
      // No force: writeCalendarChangeTriggers() declines during a bootstrap
      // import or a forms-rebuild sweep, which pause these on purpose and
      // restore them themselves.
      if (held > 0 || isTriggerOwnerAccount()) writeCalendarChangeTriggers();
      else {
        log(`${reason}: calendar-edit triggers not restored — this account held none beforehand and is not ` +
          `the recorded trigger owner. Creating them here would add a second, invisible set.`);
      }
    } catch (err) {
      // The loudest failure available: silent automation is how "the calendar
      // stopped syncing" becomes a mystery a fortnight later.
      log(`⚠️ ${reason}: FAILED to restore the calendar-edit triggers (${err}). Run Admin → Check Triggers.`);
      toastIfPossible(`⚠️ Calendar-edit triggers could not be restored — run 🔧 Admin ▸ Check Triggers.`);
    }
  }
}

/**
 * Dispatches to a per-sheet handler for tabs that carry a Manual_Override
 * column (Registrants, Lunch Dashboard) plus the Lunch_Schedule edit hook.
 * Master_Program_Dashboard's session table no longer has a Manual_Override
 * column at all (see HEADERS.Master_Program_Dashboard), so there's nothing
 * to auto-flip there anymore.
 */
/**
 * A SIMPLE trigger, on purpose, and that choice has consequences worth
 * stating because they shape everything reachable from here.
 *
 * Simple onEdit CAN show alerts and prompts (which is why the "are you sure?"
 * dialogs work at all) but runs WITHOUT authorization, so it cannot touch
 * CalendarApp, FormApp, PropertiesService, or the protection API. An
 * INSTALLABLE onEdit is the mirror image: full authorization, no UI at all,
 * so every confirmation would silently answer itself.
 *
 * We keep the dialogs. Everything an edit does that needs authorization is
 * therefore either (a) written to survive being refused — see
 * getCalendarEventsForWindow() and protectDerivedColumns(), both of which
 * degrade instead of throwing — or (b) moved off this path entirely and onto
 * a menu item the user clicks, which runs fully authorized. Pushing a menu
 * change out to live forms is the main example: it used to be attempted from
 * here, where FormApp is unavailable and the failure was swallowed by the
 * catch below, and is now "🍱 Push Menu Changes to Forms".
 *
 * BEFORE ADDING ANYTHING HERE: if it needs a Google service other than
 * SpreadsheetApp, it does not belong on this path.
 */
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const name = sheet.getName();
    if (name === SHEET_NAMES.LUNCH_EVENT_REGISTRANTS) {
      handleRegistrantsEdit(e, sheet);
    } else if (name === SHEET_NAMES.LUNCH_DASHBOARD) {
      handleLunchDashboardEdit(e, sheet);
    } else if (name === SHEET_NAMES.LUNCH_SCHEDULE) {
      handleLunchScheduleEdit(e, sheet);
    } else if (name === SHEET_NAMES.PROGRAM_DASHBOARD) {
      handleProgramDashboardEdit(e, sheet);
    } else if (name === SHEET_NAMES.CONFIG) {
      handleConfigEdit(e, sheet);
    } else if (name === SHEET_NAMES.CLUB_MEMBERS) {
      handleClubMembersEdit(e, sheet);
    }
  } catch (err) {
    // Say something. A silent catch here is how "I typed it and nothing
    // happened" becomes unreportable: the edit stays on the sheet looking
    // accepted while the work behind it never ran.
    log(`onEdit error: ${err}`);
    toastIfPossible(`⚠️ That edit didn't fully process (${err}). The cell is saved; check the log or run the matching menu item.`);
  }
}

/**
 * Master_Program_Dashboard: the session table is rebuilt from the calendar on
 * every render, so almost nothing typed here survives — EXCEPT the three
 * columns that describe how a program's registration works: Type_Tag, and the
 * Club / No_Registration checkboxes (PROGRAM_FLAG_COLUMNS). All three are real,
 * outward-facing decisions.
 *
 * Changing Grouped <-> Monthly re-partitions a program's sessions across
 * forms: Monthly means one form per calendar month, Grouped means one form for
 * the whole series. Applying that means the next sync builds different forms
 * and injects different links into the calendar — so it asks first, reverts
 * the cell on "no", and on "yes" writes the tag back into the calendar
 * DESCRIPTION (the actual source of truth, see resolveEventSettings()) so the
 * change survives the next render instead of being overwritten by it.
 *
 * The two checkboxes work exactly the same way, one tick instead of a dropdown
 * — see handleProgramFlagEdit().
 */
function handleProgramDashboardEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Event_ID');
  const editedRow = e.range.getRow();
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Program_Dashboard);

  // The flag checkboxes first: an edit lands in exactly one column, and
  // handleProgramFlagEdit() reports whether that column was one of theirs.
  for (let i = 0; i < PROGRAM_FLAG_COLUMNS.length; i++) {
    if (handleProgramFlagEdit(e, sheet, zones, headerMap, PROGRAM_FLAG_COLUMNS[i])) return;
  }

  const typeCol = headerMap['Type_Tag'];
  if (typeCol === undefined) return;

  // The edited RANGE, not just its top-left cell: a fill-down or a paste over
  // a block of Type_Tag cells is exactly as consequential as typing one, and
  // used to slip through unasked and unstamped (the calendar never learned
  // about it, so the next render silently put the old tags back — the "my
  // change didn't save" bug, in its quietest form).
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  if (typeCol + 1 < firstCol || typeCol + 1 > lastCol) return;

  const numRows = e.range.getNumRows();
  const isSingleCell = numRows === 1 && e.range.getNumColumns() === 1;

  if (isSingleCell) {
    const newTag = normalizeTypeTag(e.value);
    const oldTag = normalizeTypeTag(e.oldValue);
    if (newTag === oldTag) return;
    const title = String(sheet.getRange(editedRow, (headerMap['Clean_Title'] || 0) + 1).getValue() || 'this program');
    if (!confirmCellEditOrRevert(e, `Change ${title} to "${newTag}"?`, describeTypeTagChange(title, newTag))) return;
    applyTypeTagToCalendar(sheet, editedRow, headerMap, newTag, title);
    return;
  }

  // Multi-row edit. Collect the distinct (row, tag) pairs that actually landed
  // inside a data zone, ask ONCE, and stamp each affected program.
  const targets = [];
  for (let r = 0; r < numRows; r++) {
    const row = editedRow + r;
    if (!isRowInAnyDataZone(zones, row)) continue;
    const tag = normalizeTypeTag(sheet.getRange(row, typeCol + 1).getValue());
    if (tag !== EVENT_TYPES.GROUPED && tag !== EVENT_TYPES.MONTHLY) continue;
    const title = String(sheet.getRange(row, (headerMap['Clean_Title'] || 0) + 1).getValue() || '').trim();
    if (!title) continue;
    if (targets.some(t => t.title === title && t.tag === tag)) continue; // one stamp per program
    targets.push({ row, title, tag });
  }
  if (targets.length === 0) return;

  const list = targets.slice(0, 8).map(t => `• ${t.title} → ${t.tag}`).join('\n');
  const more = targets.length > 8 ? `\n…and ${targets.length - 8} more` : '';
  // NOT confirmCellEditOrRevert(): a multi-cell edit carries no oldValue, so
  // there is nothing truthful to put back on a "no". Instead the change stays
  // on the sheet but is NOT pushed to the calendar, and the toast says so —
  // the next render then restores the calendar's own tags, which is the
  // honest undo.
  if (!confirmConsequentialAction('Change how these programs are grouped?',
    `${targets.length} program(s) would be re-grouped:\n${list}${more}\n\n` +
    'Each one\'s registration forms will be rebuilt on the next sync, and the registration link ' +
    'in its calendar events updated.', false)) {
    toastIfPossible('Not applied. The cells will go back to the calendar\'s own tags on the next sync.');
    return;
  }

  let stampedPrograms = 0;
  targets.forEach(t => {
    if (writeTypeTagToCalendarEvents(sheet, t.row, headerMap, t.tag) > 0) stampedPrograms++;
  });
  toastIfPossible(`Re-grouped ${stampedPrograms}/${targets.length} program(s) — run Sync Cal to rebuild their forms.`);
}

/** The plain-language consequence of flipping one program's Type_Tag. */
function describeTypeTagChange(title, newTag) {
  return newTag === EVENT_TYPES.GROUPED
    ? `"${title}" will switch to ONE shared registration form for its whole series, ` +
      `instead of a separate form each month.\n\nThe next sync will build that form and update the ` +
      `registration link on every one of its calendar events.`
    : `"${title}" will switch to a SEPARATE registration form per calendar month, ` +
      `instead of one form for the whole series.\n\nThe next sync will build those forms and update the ` +
      `registration link on every one of its calendar events.`;
}

/**
 * One tick of a Club / No_Registration checkbox, made LIVE — and made to
 * SURVIVE, which turned out to be the harder half.
 *
 * Returns TRUE when the edit belonged to this flag's column, so the caller can
 * stop looking.
 *
 * WHAT THIS FUNCTION DOES, and deliberately does not do. It runs on the SIMPLE
 * onEdit path, which has no authorization for CalendarApp (see onEdit()), so it
 * does no calendar work at all. It does the two things a spreadsheet write can
 * do, immediately:
 *
 *   1. ticks the same box on every OTHER row of the same program — same
 *      Clean_Title on the same calendar, plus everything sharing the form (see
 *      spreadFlagToSiblingRows()). A flag is a property of a program, never of
 *      one date, and leaving eleven rows unticked said otherwise.
 *   2. records the tick on the pending-changes tab (see
 *      PENDING_FLAG_SHEET_NAME), which is what stops the next sync from
 *      quietly undoing it before anything has had the authorization to write
 *      it to a calendar. THIS IS THE BUG FIX: a calendar edit anywhere fires
 *      onCalendarChange -> syncCalendars(), and that recomputes these columns
 *      from calendar descriptions that had never been told about the tick.
 *
 * The calendar write itself happens seconds later in
 * onProgramFlagEditInstallable(), the INSTALLABLE onEdit trigger, which is the
 * same edit seen by a fully authorized execution. That is what makes ticking
 * the box the only step. If that trigger is not installed (nobody has run
 * 🔧 Admin ▸ Check Triggers on this workbook yet), nothing is lost: the entry
 * stays queued, the box stays ticked, and the next Sync Cal delivers it.
 *
 * NO CONFIRMATION DIALOG. A dropdown holding a real value is worth asking
 * about; a checkbox is already the question, the answer and the undo, and a
 * modal here would also have to be answered before the installable trigger
 * could safely act. The toast says what was done and how to reverse it.
 */
function handleProgramFlagEdit(e, sheet, zones, headerMap, flag) {
  const flagCol = headerMap[flag.column];
  if (flagCol === undefined) return false;

  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  if (flagCol + 1 < firstCol || flagCol + 1 > lastCol) return false;

  const editedRow = e.range.getRow();
  const numRows = e.range.getNumRows();
  const readCell = (row, name) =>
    (headerMap[name] === undefined ? '' : String(sheet.getRange(row, headerMap[name] + 1).getValue() || '').trim());

  // Every distinct program touched by this edit — one cell or a fill-down over
  // a hundred — with the state its box now shows.
  const targets = [];
  for (let r = 0; r < numRows; r++) {
    const row = editedRow + r;
    if (!isRowInAnyDataZone(zones, row)) continue;
    const title = readCell(row, 'Clean_Title');
    const calendarId = readCell(row, 'Calendar_Source');
    if (!title || !calendarId) continue;
    const on = isTruthyCheckbox(sheet.getRange(row, flagCol + 1).getValue());
    if (targets.some(t => t.title === title && t.calendarId === calendarId)) continue;
    targets.push({ row, title, calendarId, on });
  }
  if (targets.length === 0) return true;

  let spread = 0;
  targets.forEach(t => {
    spread += spreadFlagToSiblingRows(sheet, zones, headerMap, flag, t.row, t.on);
    recordPendingProgramFlag(flag.column, t.calendarId, t.title, t.on);
  });

  const headline = targets.length === 1
    ? describeFlagState(flag, targets[0].title, targets[0].on)
    : `${targets.length} program(s) updated`;
  toastIfPossible(`${headline}${spread > 0 ? ` — ${spread} other session row(s) ticked to match` : ''}. ` +
    `Writing [${flag.tag}] to the calendar; the forms follow on the next Sync Cal.`);
  return true;
}

/**
 * Puts the same tick on every other row of the same program, and reports how
 * many rows it changed.
 *
 * WHAT COUNTS AS THE SAME PROGRAM, on the sheet alone (this runs where nothing
 * but SpreadsheetApp is available):
 *
 *   - same Clean_Title on the same Calendar_Source — the program itself, every
 *     one of its dates, past and upcoming;
 *   - anything sharing its Form_ID — which is how a program tagged
 *     [All Locations] reaches its own rows at the other locations, since what
 *     makes those one program is precisely that they share one form.
 *
 * Deliberately NOT "same title anywhere": two locations running an unlinked
 * "Chair Yoga" are two programs with two forms, and stampProgramFlagOnCalendar()
 * would not tag both either. The sheet and the calendar have to agree about
 * what a program is, or the next sync unticks whatever went further.
 */
function spreadFlagToSiblingRows(sheet, zones, headerMap, flag, sourceRow, on) {
  const flagCol = headerMap[flag.column];
  const titleCol = headerMap['Clean_Title'];
  const calCol = headerMap['Calendar_Source'];
  if (flagCol === undefined || titleCol === undefined || calCol === undefined) return 0;
  const formCol = headerMap['Form_ID'];

  const title = String(sheet.getRange(sourceRow, titleCol + 1).getValue() || '').trim();
  const calendarId = String(sheet.getRange(sourceRow, calCol + 1).getValue() || '').trim();
  if (!title || !calendarId) return 0;
  const formId = formCol === undefined
    ? '' : String(sheet.getRange(sourceRow, formCol + 1).getValue() || '').trim();

  let changed = 0;
  (zones || []).forEach(zone => {
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;

    const titles = sheet.getRange(zone.dataStart, titleCol + 1, count, 1).getValues();
    const calendars = sheet.getRange(zone.dataStart, calCol + 1, count, 1).getValues();
    const forms = formCol === undefined
      ? null : sheet.getRange(zone.dataStart, formCol + 1, count, 1).getValues();
    const flagRange = sheet.getRange(zone.dataStart, flagCol + 1, count, 1);
    const flags = flagRange.getValues();

    let touched = false;
    for (let r = 0; r < count; r++) {
      const rowTitle = String(titles[r][0] || '').trim();
      const rowCalendar = String(calendars[r][0] || '').trim();
      const rowForm = forms ? String(forms[r][0] || '').trim() : '';
      const sameProgram = (rowTitle === title && rowCalendar === calendarId) ||
        (!!formId && rowForm === formId);
      if (!sameProgram) continue;
      if (isTruthyCheckbox(flags[r][0]) === on && typeof flags[r][0] === 'boolean') continue;
      flags[r] = [on];
      touched = true;
      if (zone.dataStart + r !== sourceRow) changed++;
    }
    if (touched) flagRange.setValues(flags);
  });
  return changed;
}

/**
 * THE INSTALLABLE onEdit TRIGGER. Same edit as onEdit() above, seen a second
 * time by an execution that is fully authorized — which is the only way a
 * cell edit in this project can reach a calendar at all.
 *
 * Installed by writeTriggers() (🔧 Admin ▸ Check Triggers). Without it
 * everything still works, one sync later; with it, ticking the box is the
 * whole job.
 *
 * It drains the pending-changes queue rather than reading the edit: whatever
 * handleProgramFlagEdit() decided — including a fill-down that touched forty
 * programs — is already recorded there, and draining also picks up anything
 * an earlier failure left behind. Cheap to be wrong about: an edit anywhere
 * else on the workbook costs one sheet-name comparison and returns.
 */
function onProgramFlagEditInstallable(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAMES.PROGRAM_DASHBOARD) return;
    if (isBootstrapActive()) return; // it is rewriting the whole table anyway

    // Was this edit in one of the flag columns? Both triggers start from the
    // same edit and race, so when the answer is yes the queue entry may not be
    // written yet — wait a moment for it rather than deciding there is nothing
    // to do. When the answer is no, nothing is waited for: the drain still
    // runs, but only if something is already queued (a retry of an earlier
    // failure), and it costs one read of a two-column tab.
    if (editTouchesProgramFlagColumn(e, sheet)) {
      Utilities.sleep(1200);
    } else if (readPendingProgramFlags().length === 0) {
      return;
    }

    // The sync holds this lock while it reads every calendar and rewrites the
    // table — and it drains the queue itself as its first act, so there is
    // nothing here worth waiting for it to finish.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) {
      log('onProgramFlagEditInstallable: a sync is running and will deliver the queued change itself.');
      return;
    }
    let result;
    try {
      result = applyPendingProgramFlags();
    } finally {
      lock.releaseLock();
    }
    if (result.applied === 0 && result.failed === 0) return;

    toastIfPossible(result.failed === 0
      ? `Calendar updated ✅ — ${result.stampedEvents} event(s) across ${result.applied} program(s). ` +
        `The forms follow on the next Sync Cal.`
      : `⚠️ ${result.failed} program change(s) could not reach the calendar and are still queued — ` +
        `they will be retried on the next Sync Cal.`);
  } catch (err) {
    log(`onProgramFlagEditInstallable error: ${err}`);
  }
}

/** True when `e` covers a Club / No_Registration cell inside a data zone of the session table. */
function editTouchesProgramFlagColumn(e, sheet) {
  const zone = findZoneForRow(getSectionZones(sheet, 'Event_ID'), e.range.getRow());
  if (!zone) return false;
  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Program_Dashboard);
  const firstCol = e.range.getColumn();
  const lastCol = firstCol + e.range.getNumColumns() - 1;
  return PROGRAM_FLAG_COLUMNS.some(flag => {
    const col = headerMap[flag.column];
    return col !== undefined && col + 1 >= firstCol && col + 1 <= lastCol;
  });
}

/**
 * Drains the pending-changes queue: stamps each outstanding tick onto its
 * program's calendar events and clears the entries that got through.
 *
 * Authorized callers only (it writes to calendars): the installable onEdit
 * above, every sync, and the menu item. An entry survives a failed attempt on
 * purpose — a calendar that could not be read this minute is a reason to try
 * again later, not a reason to drop somebody's instruction.
 */
function applyPendingProgramFlags() {
  const result = { applied: 0, failed: 0, stampedEvents: 0 };
  const entries = readPendingProgramFlags();
  if (entries.length === 0) return result;

  // Every delivery below writes a calendar description, so it runs inside a
  // quiet window: otherwise one ticked checkbox fires the calendar-edit
  // triggers on every event of the program and each firing runs a full
  // syncCalendars(). Nested inside a sync (which drains the queue as its first
  // act) this is a no-op — see withCalendarChangeTriggersPaused().
  withCalendarChangeTriggersPaused('checkbox change', () => drainPendingProgramFlags(entries, result));
  return result;
}

/** The delivery loop itself. Always called inside a calendar quiet window. */
function drainPendingProgramFlags(entries, result) {
  const delivered = [];
  entries.forEach(entry => {
    const flag = getProgramFlagByColumn(entry.column);
    if (!flag || !entry.title || !entry.calendarId) {
      delivered.push(entry); // unreadable row — clearing it is the only sane end
      return;
    }
    const outcome = stampProgramFlagOnCalendar(entry.title, entry.calendarId, flag, entry.on);
    if (!outcome.ok) {
      result.failed++;
      return;
    }
    result.applied++;
    result.stampedEvents += outcome.stamped;
    delivered.push(entry);
    log(`Pending ${entry.column} change delivered: ${describeFlagState(flag, entry.title, entry.on)} ` +
      `(${outcome.stamped} calendar event(s) changed).`);
  });

  clearPendingProgramFlags(delivered);
  return result;
}

/**
 * The hidden queue tab, created on demand.
 *
 * Creating it puts the user somewhere they did not ask to be — insertSheet()
 * makes the new tab ACTIVE, and this can run from a cell edit — so the tab
 * they were working on is put back before anything else happens, and the new
 * one is hidden only after that (a sheet cannot be hidden while it is active).
 */
function getPendingFlagSheet(createIfMissing) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PENDING_FLAG_SHEET_NAME);
  if (!sheet) {
    if (!createIfMissing) return null;
    const wasActive = ss.getActiveSheet();
    sheet = ss.insertSheet(PENDING_FLAG_SHEET_NAME, ss.getNumSheets());
    sheet.getRange(1, 1, 1, PENDING_FLAG_HEADERS.length)
      .setValues([PENDING_FLAG_HEADERS])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
    try { if (wasActive) ss.setActiveSheet(wasActive); } catch (err) { /* nothing to go back to */ }
    try { sheet.hideSheet(); } catch (err) { /* a lone or active tab cannot be hidden */ }
  }
  return sheet;
}

/** Every outstanding entry: { column, calendarId, title, on, row }. */
function readPendingProgramFlags() {
  const sheet = getPendingFlagSheet(false);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, PENDING_FLAG_HEADERS.length).getValues()
    .map((row, i) => ({
      column: String(row[0] || '').trim(),
      calendarId: String(row[1] || '').trim(),
      title: String(row[2] || '').trim(),
      on: isTruthyCheckbox(row[3]),
      row: i + 2
    }))
    .filter(entry => entry.column);
}

/**
 * Records (or replaces) one program's outstanding tick. Callable from a simple
 * onEdit — it is a spreadsheet write and nothing else.
 */
function recordPendingProgramFlag(flagColumn, calendarId, title, on) {
  try {
    const sheet = getPendingFlagSheet(true);
    const key = pendingFlagKey(flagColumn, calendarId, title);
    const existing = readPendingProgramFlags()
      .filter(entry => pendingFlagKey(entry.column, entry.calendarId, entry.title) === key);
    const values = [flagColumn, calendarId, title, !!on, new Date()];

    if (existing.length > 0) {
      sheet.getRange(existing[0].row, 1, 1, values.length).setValues([values]);
      // A duplicate can only exist if two edits raced; keep the first row.
      existing.slice(1).reverse().forEach(entry => sheet.deleteRow(entry.row));
      return;
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, values.length).setValues([values]);
  } catch (err) {
    // Never let the queue break the edit itself. The box stays ticked; the
    // menu item is still there to push it through.
    log(`⚠️ Could not queue the ${flagColumn} change for "${title}" (${err}).`);
  }
}

/** Removes the given entries (bottom-up, so earlier row numbers stay valid). */
function clearPendingProgramFlags(entries) {
  if (!entries || entries.length === 0) return 0;
  const sheet = getPendingFlagSheet(false);
  if (!sheet) return 0;
  const rows = entries.map(entry => entry.row).filter(Boolean).sort((a, b) => b - a);
  rows.forEach(row => {
    try { sheet.deleteRow(row); } catch (err) { log(`⚠️ Could not clear pending row ${row} (${err}).`); }
  });
  return rows.length;
}

/**
 * `Calendar_Source|Clean_Title` for every program with an outstanding tick of
 * this flag — the set reconcileProgramFlagColumns() must not touch, because
 * the calendar has not been told about them yet.
 */
function pendingProgramKeysFor(flagColumn) {
  const keys = new Set();
  readPendingProgramFlags().forEach(entry => {
    if (entry.column !== flagColumn) return;
    keys.add(`${entry.calendarId}|${entry.title}`);
  });
  return keys;
}

/** "Book Club is a club" / "Coffee Hour takes no registration" — one line, for a toast or a list. */
function describeFlagState(flag, title, on) {
  if (flag.column === 'No_Registration') {
    return on ? `"${title}" takes no registration` : `"${title}" takes registrations again`;
  }
  return on ? `"${title}" is a club` : `"${title}" is no longer a club`;
}

/** Stamps one program's new Type_Tag onto its calendar events and reports what happened. */
function applyTypeTagToCalendar(sheet, editedRow, headerMap, newTag, title) {
  const stamped = writeTypeTagToCalendarEvents(sheet, editedRow, headerMap, newTag);
  toastIfPossible(stamped > 0
    ? `Set "${title}" to ${newTag} on ${stamped} calendar event(s) — run Sync Cal to rebuild its form(s).`
    : `⚠️ "${title}" reads ${newTag} on the sheet, but the calendar could not be updated from a cell edit. ` +
      `Click "Apply Type Changes to Calendar" on the menu to make it stick.`);
  return stamped;
}

/**
 * Menu action: push everything the dashboard is still waiting to tell the
 * calendar — every queued Club / No_Registration tick, plus every program's
 * Type_Tag — and stamp the differences.
 *
 * THE RECOVERY PATH for the one thing a cell edit genuinely cannot finish.
 * Writing to a calendar needs authorization that a simple onEdit trigger does
 * not have (see onEdit()). Normally the installable onEdit trigger delivers a
 * tick within seconds and the next sync catches anything it missed; this is
 * what to click when neither has happened — no trigger installed, no sync
 * since, or a calendar that was unreachable at the time.
 *
 * THE FLAGS ARE TAKEN FROM THE QUEUE, NOT FROM THE CELLS, and that distinction
 * matters enough to state. Reading the checkboxes and stamping whatever they
 * currently show sounds equivalent and is not: an unticked box is indis-
 * tinguishable from a box nobody has ever touched, so a sheet that had gone
 * stale for any reason would have this action march through the calendar
 * DELETING [Club] tags that were typed there by hand and were perfectly
 * correct. The queue holds only what a person actually did. Type_Tag has no
 * queue and keeps its sheet-driven behavior, which is safe for the reason the
 * flags are not: it always holds a real, non-empty value.
 *
 * Safe to click at any time.
 */
function applyProgramTagChangesToCalendar() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) { toastIfPossible('No program dashboard yet — run Sync Cal first.'); return 0; }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const byProgram = {};
  readAllSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const title = String(row[map['Clean_Title']] || '').trim();
    const calendarId = String(row[map['Calendar_Source']] || '').trim();
    const tag = normalizeTypeTag(row[map['Type_Tag']]);
    if (!title || !calendarId) return;
    if (tag !== EVENT_TYPES.GROUPED && tag !== EVENT_TYPES.MONTHLY) return;
    // Last row wins per program — they should all agree, and if they don't,
    // the most recently written one is the intent.
    byProgram[`${title}|${calendarId}`] = { title, calendarId, tag };
  });

  // ONE quiet window around the whole job, drain included. Both halves write
  // descriptions, and the calendar-edit triggers must not come back between
  // them — see withCalendarChangeTriggersPaused(). This is the click that used
  // to produce a run of onCalendarChange firings, each one a full sync
  // reacting to the edits of the one before it.
  let stampedEvents = 0;
  let changedPrograms = 0;
  let pending = { applied: 0, failed: 0, stampedEvents: 0 };
  withCalendarChangeTriggersPaused('Apply Type / Club / No-Reg Changes', () => {
    pending = applyPendingProgramFlags();
    stampedEvents = pending.stampedEvents;
    changedPrograms = pending.applied;
    Object.keys(byProgram).forEach(k => {
      const p = byProgram[k];
      const n = stampTypeTagOnCalendar(p.title, p.calendarId, p.tag);
      if (n > 0) { stampedEvents += n; changedPrograms++; }
    });
  });

  const stillQueued = pending.failed > 0
    ? ` ⚠️ ${pending.failed} queued change(s) still could not reach the calendar — check that the calendars are readable.`
    : '';
  const message = changedPrograms > 0
    ? `Applied ${changedPrograms} program change(s) to ${stampedEvents} calendar event(s) — ` +
      `run Sync Cal to rebuild their forms.${stillQueued}`
    : `Everything on the dashboard already matches its calendar ✅ — nothing to change.${stillQueued}`;
  toastIfPossible(message);
  log(`applyProgramTagChangesToCalendar: ${message}`);
  return changedPrograms;
}

/**
 * The name this action had when it only handled Type_Tag. Kept so anything
 * still bound to it — an old menu, a saved trigger, somebody's habit in the
 * script editor — keeps working.
 */
function applyTypeTagChangesToCalendar() {
  return applyProgramTagChangesToCalendar();
}

/**
 * Writes [Grouped]/[Monthly] into the DESCRIPTION of every calendar event
 * belonging to the same program as `editedRow`, replacing whichever grouping
 * bracket was there.
 *
 * The description is where resolveEventSettings() reads this from, so this is
 * what makes a Type_Tag edit stick. Without it the cell would read "Grouped"
 * until the next render recomputed it from the calendar and quietly put
 * "Monthly" back — the classic "my change didn't save" bug.
 *
 * Scope is program + location (every session sharing Clean_Title and
 * Calendar_Source), not just the edited row: grouping is a property of the
 * program, and leaving its other sessions disagreeing would split it across
 * both groupings at once. That's the "unite disparate monthly events" case.
 */
function writeTypeTagToCalendarEvents(sheet, editedRow, headerMap, newTag) {
  const title = String(sheet.getRange(editedRow, (headerMap['Clean_Title'] || 0) + 1).getValue() || '').trim();
  const calendarId = String(sheet.getRange(editedRow, (headerMap['Calendar_Source'] || 0) + 1).getValue() || '').trim();
  return stampTypeTagOnCalendar(title, calendarId, newTag);
}

/**
 * The stamping itself, addressed by program rather than by sheet row, so both
 * the cell-edit path above and the menu-driven reconcile
 * (applyTypeTagChangesToCalendar) share one implementation.
 */
function stampTypeTagOnCalendar(title, calendarId, newTag) {
  if (!title || !calendarId) return 0;

  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  if (!eventsByCalendar[calendarId]) {
    log(`⚠️ Type_Tag change for "${title}": calendar ${calendarId} could not be read — nothing stamped.`);
    return 0;
  }

  let stamped = 0;
  // Every calendar is walked, but only this program's own calendar is stamped
  // unconditionally. The exception is a session tagged [All Locations]: it
  // shares ONE form with the other locations, so leaving them on a different
  // Grouped/Monthly tag would split that shared program back into two forms —
  // one keyed ::FIXED and one keyed by month. Grouping is a property of a
  // program, and a linked program's program spans locations.
  Object.keys(CALENDAR_MAP).forEach(otherCalendarId => {
    const events = eventsByCalendar[otherCalendarId];
    if (!events) return;
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.cleanTitle !== title) return;

      const existing = ev.getDescription() || '';
      if (otherCalendarId !== calendarId &&
        !(parseSettingsBrackets(existing).isShared || parsed.legacyIsShared)) return;

      const updated = setGroupingBracketInDescription(existing, newTag);
      if (updated === existing) return;
      ev.setDescription(updated);
      stamped++;
    });
  });

  if (stamped > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`Stamped [${newTag}] onto ${stamped} calendar event(s) for "${title}".`);
  }
  return stamped;
}

/**
 * The flag equivalent of stampTypeTagOnCalendar(): writes [Club] or
 * [No Registration] into — or out of — the DESCRIPTION of every calendar event
 * of one program, and returns how many events changed.
 *
 * Same scoping rule as the grouping stamp, for the same reason. A program's
 * own calendar is stamped unconditionally; another location's copy is stamped
 * only when it is tagged [All Locations], because then it is genuinely the
 * same program and a club (or a no-sign-up program) that is one at Narberth
 * and not at Ashbridge is a contradiction rather than a setting.
 *
 * `flag` is an entry of PROGRAM_FLAG_COLUMNS; `on` is the state the checkbox
 * was just put into.
 *
 * Returns { stamped, ok }. The two are not the same question and the pending
 * queue needs both: `stamped: 0, ok: true` means the calendar already agreed
 * and the instruction is DONE, while `ok: false` means the calendar could not
 * be read at all and the instruction must stay queued for another attempt.
 * Conflating them is how a tick gets dropped on the one run where Calendar was
 * briefly unavailable.
 */
function stampProgramFlagOnCalendar(title, calendarId, flag, on) {
  if (!title || !calendarId || !flag) return { stamped: 0, ok: false };

  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  if (!eventsByCalendar[calendarId]) {
    log(`⚠️ ${flag.column} change for "${title}": calendar ${calendarId} could not be read — nothing stamped.`);
    return { stamped: 0, ok: false };
  }

  let stamped = 0;
  Object.keys(CALENDAR_MAP).forEach(otherCalendarId => {
    const events = eventsByCalendar[otherCalendarId];
    if (!events) return;
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.cleanTitle !== title) return;

      const existing = ev.getDescription() || '';
      if (otherCalendarId !== calendarId &&
        !(parseSettingsBrackets(existing).isShared || parsed.legacyIsShared)) return;

      const updated = setFlagBracketInDescription(existing, flag.regex, flag.tag, on);
      if (updated === existing) return;
      ev.setDescription(updated);
      stamped++;
    });
  });

  if (stamped > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`${on ? 'Added' : 'Removed'} [${flag.tag}] on ${stamped} calendar event(s) for "${title}".`);
  }
  return { stamped, ok: true };
}

/**
 * Returns `description` with any grouping bracket ([Grouped]/[Monthly], or the
 * legacy [Fixed]/[Regular]) replaced by [newTag] — preserving [Cap: N] and any
 * unrelated bracketed notes, and appending the tag if none was present.
 */
function setGroupingBracketInDescription(description, newTag) {
  const raw = String(description || '');
  const groupingWord = /^\s*(Grouped|Fixed|Monthly|Regular)\s*$/i;
  let replaced = false;

  // Rewrite brackets that ONLY hold a grouping word; leave mixed brackets
  // like [Cap: 12, Grouped] to the combined-content branch below.
  let out = raw.replace(/\[([^\]]*)\]/g, (whole, content) => {
    if (groupingWord.test(content)) { replaced = true; return `[${newTag}]`; }
    if (/\b(Grouped|Fixed|Monthly|Regular)\b/i.test(content)) {
      replaced = true;
      const kept = content
        .split(',')
        .map(part => part.trim())
        .filter(part => part && !groupingWord.test(part));
      return `[${kept.concat(newTag).join(', ')}]`;
    }
    return whole;
  });

  if (!replaced) out = raw ? `${raw.replace(/\s*$/, '')}\n[${newTag}]` : `[${newTag}]`;
  return out;
}

/**
 * Returns `description` with the [All Locations] tag added or removed,
 * preserving [Cap: N], [Grouped]/[Monthly] and any unrelated bracketed notes.
 * Removing it empties a bracket that held nothing else, which is why the
 * result goes through tidyDescriptionWhitespace().
 */
function setSharedBracketInDescription(description, shared) {
  return setFlagBracketInDescription(description, SHARED_LOCATION_WORDS_REGEX, SHARED_LOCATION_TAG, shared);
}

/**
 * The general form of the above: returns `description` with a one-word tag
 * added or removed, preserving every other bracket and every other word inside
 * a shared bracket.
 *
 * This is what a ticked checkbox on the dashboard turns into — [Club] and
 * [No Registration] both go through here (see PROGRAM_FLAG_COLUMNS), as does
 * [All Locations]. The rules that matter:
 *
 *   - adding, when some spelling of the tag is already there, changes nothing.
 *     "[Members Only]" already says club; rewriting it to "[Club]" would edit
 *     somebody's calendar to no effect, and every such edit is a notification
 *     to everyone the event is shared with.
 *   - removing takes the word out of whatever bracket held it and keeps the
 *     rest, so [Cap: 12, Club] becomes [Cap: 12] rather than disappearing.
 *   - a bracket left empty is dropped, and the hole it leaves is closed up by
 *     tidyDescriptionWhitespace().
 */
function setFlagBracketInDescription(description, wordsRegex, tagWord, on) {
  const raw = String(description || '');
  let sawTag = false;

  let out = raw.replace(/\[([^\]]*)\]/g, (whole, content) => {
    if (!wordsRegex.test(content)) return whole;
    sawTag = true;
    if (on) return whole; // already tagged — leave the author's spelling alone
    const kept = content
      .split(',')
      .map(part => part.trim())
      .filter(part => part && !wordsRegex.test(part));
    return kept.length > 0 ? `[${kept.join(', ')}]` : '';
  });

  if (on && !sawTag) {
    out = raw ? `${raw.replace(/\s*$/, '')}\n[${tagWord}]` : `[${tagWord}]`;
  }
  if (!on && sawTag) out = tidyDescriptionWhitespace(out);
  return out;
}

/**
 * Menu action: put one program's sessions at every location onto ONE
 * registration form — or take them back apart.
 *
 * The tag itself is just text in a calendar description ([All Locations], see
 * SHARED_LOCATION_SCOPE) and could be typed by hand on every event. This
 * exists because typing it by hand does only half the job on a calendar that
 * has already been imported:
 *
 *   1. it has to go on the events at EVERY location, or the program ends up
 *      half-linked (warnAboutPartiallySharedPrograms());
 *   2. the dates already on the session table are not re-imported — a group
 *      whose dates are all present is skipped wholesale by
 *      collectCalendarWork() — so without step 3 the change would appear to
 *      do nothing until the next new date appeared months later.
 *   3. so the sessions ALREADY on the table are re-pointed onto whichever of
 *      the program's existing forms is keeping the roster, the survivor form
 *      is relabelled to name its locations, and every calendar link is
 *      rewritten to match.
 *
 * PAST sessions are deliberately left alone: they carry the form their
 * registrations actually came in on, and that is the record.
 */
function linkProgramAcrossLocations() {
  if (!requireAuthorizedAdmin('Link Program Across Locations')) return null;

  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return null;
  }

  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    log(`linkProgramAcrossLocations: no UI available (${err}) — this action has to be run from the menu.`);
    return null;
  }

  const answer = ui.prompt('Link a program across locations',
    'Type the program name exactly as it appears in Clean_Title on the dashboard ' +
    '(e.g. "Tai Chi").\n\n' +
    'Every calendar event with that name, at every location, will be tagged ' +
    `[${SHARED_LOCATION_TAG}] so they all share ONE registration form. Run it again on an ` +
    'already-linked program to unlink it.', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return null;

  const title = String(answer.getResponseText() || '').trim();
  if (!title) {
    toastIfPossible('No program name typed — nothing changed.');
    return null;
  }

  const matches = findProgramEventsAcrossCalendars(title);
  if (matches.total === 0) {
    ui.alert(`No calendar events named "${title}" in the sync window. ` +
      'Check the spelling against the Clean_Title column (the name without any [brackets] or "*").');
    return null;
  }

  // Already fully tagged -> this is an unlink. Otherwise -> link.
  const linking = matches.tagged < matches.total;
  const locationSummary = Object.keys(matches.byLocation)
    .map(loc => `• ${loc}: ${matches.byLocation[loc].total} event(s), ${matches.byLocation[loc].tagged} already tagged`)
    .join('\n');

  const detail = linking
    ? `"${title}" — ${matches.total} event(s) across ${Object.keys(matches.byLocation).length} location(s):\n` +
      `${locationSummary}\n\n` +
      `They will all be tagged [${SHARED_LOCATION_TAG}], and their UPCOMING sessions re-pointed onto one shared ` +
      `form — one for the whole series if this program is Grouped, one per month if it is Monthly, in each case ` +
      `whichever existing form already carries the most of those sessions. Its dates will be relabelled to name ` +
      `their location — "Mon, Jan 5, 2026${LOCATION_LABEL_SEPARATOR}Narberth" — and every upcoming event's ` +
      `registration link rewritten to point at it.\n\n` +
      `Past sessions keep the form they were registered on. Registrations already imported are untouched.`
    : `"${title}" is currently linked across ${Object.keys(matches.byLocation).length} location(s):\n` +
      `${locationSummary}\n\n` +
      `The [${SHARED_LOCATION_TAG}] tag will be removed from all ${matches.total} event(s), so each location's ` +
      `FUTURE dates go back onto their own form. Sessions already on the dashboard keep the shared form they ` +
      `are on now — moving live registrations back apart is not something this can do safely.`;

  if (!confirmConsequentialAction(linking ? 'Link this program across locations?' : 'Unlink this program?', detail, false)) {
    return null;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try again in a moment.');
    return null;
  }
  try {
    // Tagging every event of a program, then rewriting the registration link
    // on each one, is a lot of description writes — all of which the
    // calendar-edit triggers would otherwise deliver straight back as a run of
    // full syncs. See withCalendarChangeTriggersPaused().
    let stamped = 0;
    let repointed = { moved: 0, survivors: [] };
    withCalendarChangeTriggersPaused('Link Program Across Locations', () => {
      stamped = stampSharedTagOnCalendars(matches.events, linking);
      if (linking) repointed = repointProgramSessionsToOneForm(registrySheet, title);
    });

    const summary = linking
      ? `"${title}" linked across locations ✅ — ${stamped} event(s) tagged, ` +
        `${repointed.moved} upcoming session(s) moved onto ${repointed.survivors.length || 1} shared form(s).`
      : `"${title}" unlinked ✅ — the tag came off ${stamped} event(s). Run Sync Cal to build each location's own form.`;
    log(`linkProgramAcrossLocations: ${summary}`);
    toastIfPossible(summary);
    flushAdminDigest('Link program across locations');
    return { linking, stamped, repointed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Every timed event named `title` on every program calendar in the sync
 * window, with a per-location tally of how many already carry the
 * [All Locations] tag. Matching is on cleanTitle, so "*Tai Chi" and
 * "Tai Chi [Cap: 12]" both count as "Tai Chi".
 */
function findProgramEventsAcrossCalendars(title) {
  const wanted = String(title || '').trim().toLowerCase();
  const { start, end } = computeSyncDateRange();
  const eventsByCalendar = getCalendarEventsForWindow(start, end);

  const result = { total: 0, tagged: 0, byLocation: {}, events: [] };
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Link across locations: "${locationName}" could not be read — skipped.`);
      return;
    }
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed || parsed.cleanTitle.toLowerCase() !== wanted) return;

      const isTagged = parseSettingsBrackets(ev.getDescription() || '').isShared || parsed.legacyIsShared;
      if (!result.byLocation[locationName]) result.byLocation[locationName] = { total: 0, tagged: 0 };
      result.byLocation[locationName].total++;
      if (isTagged) result.byLocation[locationName].tagged++;
      result.total++;
      if (isTagged) result.tagged++;
      result.events.push({ event: ev, calendarId, locationName });
    });
  });
  return result;
}

/** Writes (or clears) the [All Locations] tag on a set of events. Returns how many descriptions changed. */
function stampSharedTagOnCalendars(matchedEvents, shared) {
  let stamped = 0;
  matchedEvents.forEach(({ event }) => {
    const existing = event.getDescription() || '';
    const updated = setSharedBracketInDescription(existing, shared);
    if (updated === existing) return;
    event.setDescription(updated);
    stamped++;
  });
  if (stamped > 0) {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    log(`${shared ? 'Tagged' : 'Untagged'} [${SHARED_LOCATION_TAG}] on ${stamped} calendar event(s).`);
  }
  return stamped;
}

/**
 * Moves the UPCOMING sessions of `title` onto one form PER SPAN — one form
 * for the whole series if the program is [Grouped], one per calendar month if
 * it is [Monthly]. That mirrors exactly what a fresh import would build, so a
 * program linked here and a program linked before its dates existed end up in
 * the same shape.
 *
 * Within a span the surviving form is the one already carrying the most of
 * that span's sessions (earliest date breaks a tie), so the form that keeps
 * the roster is the one most people are already looking at.
 *
 * Rewrites Form_ID and both link columns in place, records the resulting
 * cross-location group keys in the persistent registry (so the next sync
 * reuses these forms instead of building more), relabels each surviving form
 * to name its locations, and rewrites the registration link on every upcoming
 * calendar event so nothing still points at a retired form.
 */
function repointProgramSessionsToOneForm(registrySheet, title) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return { moved: 0, survivors: [] };
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  const todayKey = formatDateKey(new Date());
  const wanted = String(title || '').trim().toLowerCase();

  // The form-span this row belongs to — the same partition buildEventGroups()
  // uses, so re-pointing lands where the next import would have put it.
  const spanOf = (typeTag, date) => isGroupedTypeTag(typeTag) ? 'FIXED' : getMonthLabel(date);

  // Pass 1: read the zones once and work out which form survives in each span.
  const zones = [];
  const tally = {};
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;
    const read = col => registrySheet.getRange(zone.start, sheetMap[col], zone.count, 1).getValues();
    const info = {
      zone,
      dates: read('Event_Date'),
      titles: read('Clean_Title'),
      types: read('Type_Tag'),
      formIds: read('Form_ID')
    };
    zones.push(info);

    info.dates.forEach((dateRow, r) => {
      const d = coerceDate(dateRow[0]);
      const rowTitle = String(info.titles[r][0] || '').trim().toLowerCase();
      const formId = String(info.formIds[r][0] || '').trim();
      if (!d || rowTitle !== wanted || !formId || formatDateKey(d) < todayKey) return;
      const span = spanOf(info.types[r][0], d);
      if (!tally[span]) tally[span] = {};
      if (!tally[span][formId]) tally[span][formId] = { count: 0, earliest: d };
      tally[span][formId].count++;
      if (d < tally[span][formId].earliest) tally[span][formId].earliest = d;
    });
  });

  const spans = Object.keys(tally);
  if (spans.length === 0) {
    log(`repointProgramSessionsToOneForm: no upcoming "${title}" sessions on the dashboard yet — the next Sync Cal ` +
      `will build the shared form(s) from the calendar.`);
    return { moved: 0, survivors: [] };
  }

  // The survivor for each span, and its links — resolved up front so a form
  // that won't open costs its own span only, not the whole run.
  const survivorBySpan = {};
  const linksBySpan = {};
  spans.forEach(span => {
    const candidates = Object.keys(tally[span]);
    const survivor = candidates.sort((a, b) =>
      (tally[span][b].count - tally[span][a].count) || (tally[span][a].earliest - tally[span][b].earliest))[0];
    try {
      const form = FormApp.openById(survivor);
      survivorBySpan[span] = survivor;
      linksBySpan[span] = {
        view: makeHyperlinkFormula(buildRegistrationUrl(form), 'View Live Form'),
        edit: makeHyperlinkFormula(form.getEditUrl(), 'Edit Form Settings')
      };
    } catch (err) {
      log(`⚠️ repointProgramSessionsToOneForm: could not open form ${survivor} for "${title}" / ${span} (${err}) — ` +
        `those sessions were left where they are.`);
      noteForAdmin('Programs that could not be linked across locations',
        `"${title}" (${span}) — the form its sessions would move onto (${survivor}) could not be opened: ${err}`);
    }
  });

  // Pass 2: write Form_ID and both links on the rows that are moving.
  let moved = 0;
  zones.forEach(info => {
    const { zone } = info;
    const idRange = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1);
    const viewRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const editRange = registrySheet.getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1);
    const ids = idRange.getValues();
    // Formula-or-value, so rows that are NOT moving are written back exactly
    // as they were (the same care updateRegistryFormLinks() takes).
    const viewValues = viewRange.getValues();
    const editValues = editRange.getValues();
    const views = viewRange.getFormulas().map((f, r) => [f[0] || viewValues[r][0]]);
    const edits = editRange.getFormulas().map((f, r) => [f[0] || editValues[r][0]]);

    let touched = false;
    info.dates.forEach((dateRow, r) => {
      const d = coerceDate(dateRow[0]);
      const rowTitle = String(info.titles[r][0] || '').trim().toLowerCase();
      const formId = String(ids[r][0] || '').trim();
      if (!d || rowTitle !== wanted || !formId || formatDateKey(d) < todayKey) return;
      const survivor = survivorBySpan[spanOf(info.types[r][0], d)];
      if (!survivor || formId === survivor) return;
      ids[r] = [survivor];
      views[r] = [linksBySpan[spanOf(info.types[r][0], d)].view];
      edits[r] = [linksBySpan[spanOf(info.types[r][0], d)].edit];
      touched = true;
      moved++;
    });

    if (touched) {
      idRange.setValues(ids);
      viewRange.setValues(views);
      editRange.setValues(edits);
    }
  });

  const survivors = spans.map(span => survivorBySpan[span]).filter(Boolean);
  if (moved === 0) {
    log(`repointProgramSessionsToOneForm: "${title}" already sits on one form per span — nothing to move.`);
    return { moved, survivors };
  }
  SpreadsheetApp.flush(); // the refresh below re-reads these rows

  // These forms now span locations. Record that where the next sync looks for
  // them, then relabel each one (buildFormSessionContext() sees the
  // multi-location rows and adds the location to every date label).
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const derived = { eventIds: new Set(), groupFormMap: {} };
  addSharedGroupKeysFromRows(derived, rows, map);
  Object.keys(derived.groupFormMap).forEach(key => {
    if (survivors.indexOf(derived.groupFormMap[key]) !== -1) {
      savePersistentFormRegistryEntry(key, derived.groupFormMap[key]);
    }
  });
  flushPersistentRegistries();

  dedupePreservingOrder(survivors).forEach(formId =>
    refreshOneFormDateLabels(formId, rows, map, 'cross-location link'));
  flushPersistentRegistries();

  // Retired forms are still linked from every calendar event they used to
  // cover. Rewriting from the session table is exactly what this does.
  rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());

  return { moved, survivors };
}

/**
 * Config: these cells change how every FUTURE registration is interpreted —
 * a catering policy decides whether a location is asked about lunch at all,
 * and buffers/order-ahead feed the numbers staff order against. Worth a
 * confirmation, and worth invalidating the caches built from them.
 */
function handleConfigEdit(e, sheet) {
  if (typeof e.value === 'undefined') return; // multi-cell paste
  const editedCol = e.range.getColumn();
  const policySection = CONFIG_LAYOUT.CATERING_POLICY;
  const isPolicyEdit = editedCol === policySection.startCol + 1 &&
    e.range.getRow() >= CONFIG_DATA_START_ROW;

  if (isPolicyEdit) {
    const location = String(sheet.getRange(e.range.getRow(), policySection.startCol).getValue() || 'this location');
    const detail = `Lunch service for "${location}" becomes "${e.value}".\n\n` +
      `This changes whether its registration forms ask about lunch at all, and whether its dates ` +
      `appear on the lunch dashboard. Existing forms are updated on the next sync.`;
    if (!confirmCellEditOrRevert(e, `Change lunch service for ${location}?`, detail)) return;
    toastIfPossible(`Lunch service for ${location} set to "${e.value}" — forms update on the next sync.`);
  }

  const isLinkDisplayEdit = editedCol === CONFIG_LAYOUT.LINK_DISPLAY.startCol &&
    e.range.getRow() === CONFIG_DATA_START_ROW;
  if (isLinkDisplayEdit) {
    const hiding = String(e.value || '').trim().toLowerCase() === LINK_DISPLAY_OPTIONS.HIDE.toLowerCase();
    if (!confirmCellEditOrRevert(e, `Set the registration link to "${e.value}"?`,
      hiding
        ? 'Upcoming calendar events will stop showing a registration link. The forms keep working — ' +
          'you hand the link out yourself from the program dashboard.\n\n' +
          'Events already in the calendar keep their link until you run ' +
          '"🔗 Rewrite Event Links" from the Admin menu.'
        : 'Upcoming calendar events will show a "📝 Register for ..." link at the top of their ' +
          'description.\n\nEvents already in the calendar are updated on the next sync, or straight ' +
          'away with "🔗 Rewrite Event Links" from the Admin menu.')) {
      // Reverted — the cache must reflect the value actually on the sheet.
      invalidateConfigCaches();
      return;
    }
    toastIfPossible(`Registration link set to "${e.value}". Run "🔗 Rewrite Event Links" to apply it to existing events.`);
  }

  // Turning invitations ON is the one Config change that reaches members'
  // inboxes, so it asks — and says how many people are about to hear from
  // Google. Turning it OFF needs no confirmation: stopping is always safe.
  const isInviteEdit = editedCol === CONFIG_LAYOUT.CALENDAR_INVITES.startCol &&
    e.range.getRow() === CONFIG_DATA_START_ROW;
  if (isInviteEdit) {
    const turningOn = String(e.value || '').trim().toLowerCase() === CALENDAR_INVITE_OPTIONS.INVITE.toLowerCase();
    if (turningOn && !confirmCellEditOrRevert(e, 'Start sending calendar invitations?',
      'From the next sync, everyone actively registered for an UPCOMING session who gave an email address ' +
      'is added as a guest on that session\'s calendar event — and Google emails each of them an ' +
      'invitation.\n\nThey are removed again (and emailed about that) if their registration is cancelled. ' +
      'Nothing is sent for sessions that have already happened.')) {
      invalidateConfigCaches(); // reverted — the cache must match the sheet
      return;
    }
    toastIfPossible(turningOn
      ? 'Calendar invitations on. Use "📧 Invite Registrants to Calendar Events" to send them now.'
      : 'Calendar invitations off — no guests will be added or removed.');
  }

  // Any Config edit can invalidate a cached read of it, confirmed or not.
  invalidateConfigCaches();
}

/**
 * A 0-based { headerName: index } map read off the table's OWN header row,
 * falling back to the canonical array when the sheet's row can't supply one.
 *
 * An onEdit handler has to trust the sheet, not the constant: right after a
 * HEADERS layout changes, the tab still holds the previous order until its
 * next render, and a map built from the constant would flip Manual_Override
 * on top of whatever column now sits at that index.
 */
function getLiveHeaderMap(sheet, headerRow, headers) {
  const sheetMap = getHeaderMapAt(sheet, headerRow);
  const map = {};
  headers.forEach(h => { if (sheetMap[h]) map[h] = sheetMap[h] - 1; });
  return map['Manual_Override'] === undefined ? getIndexMap(headers) : map;
}

/**
 * Shared auto-flip: given a { headerName: 0-based index } map for whatever
 * table the edit landed in, flips that row's Manual_Override to "Manually
 * Edited" — unless the edit WAS to Manual_Override or Event_ID themselves.
 */
function autoFlipManualOverride(sheet, headerMap0Based, editedRow, editedCol1Based) {
  const overrideCol = headerMap0Based['Manual_Override'];
  if (overrideCol === undefined) return;
  const overrideCol1Based = overrideCol + 1;
  if (editedCol1Based === overrideCol1Based) return;
  const eventIdCol = headerMap0Based['Event_ID'];
  if (eventIdCol !== undefined && editedCol1Based === eventIdCol + 1) return;

  const cell = sheet.getRange(editedRow, overrideCol1Based);
  const current = String(cell.getValue()).trim();
  if (current === 'Auto-Synced' || current === '') {
    cell.setValue('Manually Edited');
  }
}

/** Lunch_and_Event_Registrants: auto-flip on any hand-edit within a data zone, plus status-change toasts. */
function handleRegistrantsEdit(e, sheet) {
  const editedRow = e.range.getRow();
  const editedCol = e.range.getColumn();

  // The Quick Mark panel sits ABOVE the data zones, so it has to be handled
  // before the zone check below discards everything outside them.
  if (editedRow === QUICK_MARK.inputRow) {
    handleQuickMarkEdit(e, sheet, editedCol);
    return;
  }

  const zones = getSectionZones(sheet, 'Event_ID');
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Lunch_and_Event_Registrants);
  autoFlipManualOverride(sheet, headerMap, editedRow, editedCol);

  // Computed from the RANGE, not just its top-left cell, so a fill-down or a
  // paste over a block of statuses recalculates too — those are how somebody
  // cancels a whole table's worth of people at once, which is exactly when the
  // catering number matters most.
  const lastCol = editedCol + e.range.getNumColumns() - 1;
  const rangeCovers = name => headerMap[name] !== undefined &&
    headerMap[name] + 1 >= editedCol && headerMap[name] + 1 <= lastCol;
  const countingColumnsEdited = rangeCovers('Program_Status') || rangeCovers('Lunch_Status');

  if (typeof e.value !== 'undefined') {
    const isProgramStatusCol = editedCol === headerMap['Program_Status'] + 1;

    // Lunch_Served no longer implies Attended, on a direct edit any more than
    // through the Quick Mark panel — one rule, wherever the tick happens. A
    // member can get a take-out meal without ever attending the session, so
    // ticking Lunch here marks lunch only; tick Attended separately for a
    // normal dine-in mark.

    if (isProgramStatusCol && e.oldValue === 'Waitlisted' && e.value === 'Active') {
      toastIfPossible("🚀 Promoted off the waitlist — set their Lunch_Status to 'Needed' if they want a meal.");
    }
  }

  // The catering numbers are recomputed HERE, not left for the hourly sync.
  //
  // This used to be a toast — "check whether this changes your catering
  // numbers" — which put the arithmetic back on the person who had just done
  // the thing that changed it, and left Master_Lunch_Dashboard showing an
  // order that included somebody who had cancelled, for up to an hour. On the
  // one number in this workbook with a supplier deadline attached, "check it
  // yourself later" was the wrong answer.
  if (countingColumnsEdited) {
    recalculateCateringCounts(sheet, headerMap, editedRow, e.range.getNumRows());
  }
}

/**
 * Rebuilds Master_Lunch_Dashboard (and the session table's Active/Waitlist
 * counts) from the registrant rows as they stand right now, and reports the
 * new lunch number for the date that was just edited.
 *
 * WHY THIS IS SAFE ON THE onEdit PATH, which is the constraint that shaped it:
 * every step is SpreadsheetApp only. buildDashboardRollup() reads three tabs
 * and Config; updateMasterLunchDashboard() writes one; recomputeEventRegistryCounts()
 * writes cells. Nothing here opens a form, touches a calendar, or reads a
 * script property — see onEdit(). protectDerivedColumns(), the one call
 * underneath that needs authorization, already degrades instead of throwing.
 *
 * Any noteForAdmin() raised during the rollup is dropped rather than mailed:
 * MailApp is unavailable here, and the next sync re-derives the same notes
 * anyway from the same data.
 *
 * NOT triggered by Lunch_Served ticks, deliberately. Those happen dozens of
 * times an hour at a sign-in desk, a full dashboard render each would make the
 * tab unusable on the day it is needed most — and Served_Confirmed is a record
 * of what happened, not a number anybody orders against. Only Program_Status
 * and Lunch_Status, which are what change the ORDER, recalculate immediately.
 */
function recalculateCateringCounts(sheet, headerMap, editedRow, numRows) {
  const dateIdx = headerMap['Event_Date'];
  const locationIdx = headerMap['Location'];

  // Read the edited rows' date/location BEFORE the rebuild, to report against.
  const touched = [];
  if (dateIdx !== undefined && locationIdx !== undefined) {
    const width = Math.max(dateIdx, locationIdx) + 1;
    const values = sheet.getRange(editedRow, 1, numRows, width).getValues();
    values.forEach(row => {
      const d = coerceDate(row[dateIdx]);
      const location = String(row[locationIdx] || '').trim();
      if (!d || !location) return;
      const key = `${formatDateKey(d)}|${location}`;
      if (!touched.some(t => t.key === key)) touched.push({ key, date: d, location });
    });
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrantRows = readAllSectionedRows(sheet, HEADERS.Lunch_and_Event_Registrants, 'Event_ID');

    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) {
      // Active_Count / Waitlist_Count / Status on the session table come from
      // the same rows. Leaving those stale while the lunch numbers moved would
      // just relocate the confusion to the other dashboard.
      recomputeEventRegistryCounts(registrySheet, sheet, registrantRows);
    }
    updateMasterLunchDashboard(registrantRows);

    toastIfPossible(describeRecalculatedCounts(touched));
    log(`Catering counts recalculated after a status edit on ${numRows} row(s).`);
    return true;
  } catch (err) {
    // Say so. A silently failed recalculation looks exactly like a correct one
    // that happened to produce the same number.
    log(`⚠️ Could not recalculate the catering counts after a status edit (${err}).`);
    toastIfPossible(`⚠️ Status saved, but the lunch numbers could not be recalculated (${err}). Run "Sync Registrations".`);
    return false;
  }
}

/** "Narberth, Mon Sep 14 — 12 lunches to order now." Reads the freshly-written dashboard. */
function describeRecalculatedCounts(touched) {
  if (touched.length === 0) return 'Catering numbers recalculated ✅';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_DASHBOARD);
  if (!sheet) return 'Catering numbers recalculated ✅';

  // The dashboard was written microseconds ago in this same execution; make
  // sure those writes have landed before reading the number back out of it.
  SpreadsheetApp.flush();

  const headers = HEADERS.Master_Lunch_Dashboard;
  const map = getIndexMap(headers);
  const byKey = {};
  readAllSectionedRows(sheet, headers, 'Standard_Buffer').forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    byKey[`${formatDateKey(d)}|${String(row[map['Location']] || '').trim()}`] = row;
  });

  const parts = touched.slice(0, 3).map(t => {
    const row = byKey[t.key];
    if (!row) return `${t.location}, ${formatDateLabel(t.date)} — no longer on the lunch schedule`;
    const registered = Number(row[map['Registered_Count']]) || 0;
    const buffers = (Number(row[map['Standard_Buffer']]) || 0) + (Number(row[map['Tester_Buffer']]) || 0);
    // Total_to_Order is a live formula, so it reads back as a formula string
    // here rather than a number — recompute the same sum instead.
    return `${t.location}, ${formatDateLabel(t.date)} — ${registered} registered, ${registered + buffers} to order`;
  });
  const more = touched.length > 3 ? ` (+${touched.length - 3} more date(s))` : '';
  return `✅ Catering numbers updated: ${parts.join(' · ')}${more}`;
}

/**
 * The Quick Mark panel's own edits: cascade the dropdowns as the selection
 * narrows, and apply a tick to the real registrant row.
 */
function handleQuickMarkEdit(e, sheet, editedCol) {
  if (editedCol === QUICK_MARK.LOCATION_COL) {
    // A new location invalidates whatever program/name was chosen under the
    // previous one — clearing them is what keeps an impossible combination
    // from being submitted.
    sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.EVENT_COL, 1, 2).clearContent();
    const lists = refreshQuickMarkDropdowns(sheet, null);
    setQuickMarkStatus(sheet, HEADERS.Lunch_and_Event_Registrants.length,
      `${lists.programList.length} session(s) at this location, nearest date first — pick one (or "${LUNCH_ONLY_PROGRAM_LABEL}" ` +
      `for a meal with no program), or go straight to a name.`);
    return;
  }

  if (editedCol === QUICK_MARK.EVENT_COL) {
    sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.NAME_COL).clearContent();
    const lists = refreshQuickMarkDropdowns(sheet, null);
    const others = lists.nameList.length - lists.registeredCount;
    setQuickMarkStatus(sheet, HEADERS.Lunch_and_Event_Registrants.length,
      `${lists.registeredCount} registered` +
      (others > 0 ? `, plus ${others} other known member(s)` : '') +
      ` — pick a name (or type a new one), then tick Attended, Lunch, or Lunch Only.`);
    return;
  }

  if (editedCol === QUICK_MARK.NAME_COL) {
    setQuickMarkStatus(sheet, HEADERS.Lunch_and_Event_Registrants.length,
      `Ready — tick Attended, Lunch, or Lunch Only to mark ${e.value || 'them'}.`);
    return;
  }

  if (editedCol === QUICK_MARK.CLEAR_COL) {
    clearQuickMarkInputs(sheet);
    refreshQuickMarkDropdowns(sheet, null);
    setQuickMarkStatus(sheet, HEADERS.Lunch_and_Event_Registrants.length, 'Cleared — choose a location to begin.');
    return;
  }

  if (editedCol === QUICK_MARK.ATTENDED_COL || editedCol === QUICK_MARK.LUNCH_COL ||
    editedCol === QUICK_MARK.LUNCH_ONLY_COL) {
    if (!isTruthyCheckbox(e.value)) return; // un-ticking the panel box marks nothing
    applyQuickMark(sheet, editedCol);
  }
}

/** Master_Lunch_Dashboard: only the Full Schedule table (Upcoming/Past zones, marker 'Standard_Buffer') is real, editable data. */
function handleLunchDashboardEdit(e, sheet) {
  const zones = getSectionZones(sheet, 'Standard_Buffer');
  const editedRow = e.range.getRow();
  const zone = findZoneForRow(zones, editedRow);
  if (!zone) return;

  const headerMap = getLiveHeaderMap(sheet, zone.headerRow, HEADERS.Master_Lunch_Dashboard);
  autoFlipManualOverride(sheet, headerMap, editedRow, e.range.getColumn());
}


// ============================================================================
// 3b. CALENDAR INCREMENTAL SYNC  (onCalendarChange -> Calendar.Events.list)
// ============================================================================
//
// Requires the "Calendar" Advanced Service (Editor -> Services -> + Calendar
// API). The standard EventUpdated trigger payload doesn't say WHICH event
// changed, so instead of re-scanning the whole calendar on every edit, this
// keeps a per-calendar syncToken (Script Properties) and asks the Calendar
// API for only what changed since the last check. If that delta contains
// something we actually care about (a new/modified/cancelled TIMED event,
// matching our title pattern, inside the tracked lookahead window), it
// hands off to the existing, fully-tested syncCalendars() reconciliation
// pass — re-implementing that whole pipeline (grouping, form reuse,
// capacity/waitlist recompute, triage) per single delta event would
// duplicate a lot of carefully-tested logic for very little benefit; the
// real win of incremental sync here is that an edit that ISN'T relevant to
// us (an all-day reminder, a change far outside our window) now costs one
// cheap Events.list call instead of a full multi-calendar scan + form sync.
// ============================================================================

const CALENDAR_SYNC_TOKEN_PROP_PREFIX = 'CALENDAR_SYNC_TOKEN_';
/** Baseline lookback for a calendar's very first (no-token) incremental sync call. */
const CALENDAR_SYNC_TOKEN_TIMEMIN_DAYS_BACK = 1;

function getCalendarSyncTokenPropKey(calendarId) {
  return `${CALENDAR_SYNC_TOKEN_PROP_PREFIX}${calendarId}`;
}

function saveCalendarSyncToken(calendarId, token) {
  const props = PropertiesService.getScriptProperties();
  const key = getCalendarSyncTokenPropKey(calendarId);
  if (token) props.setProperty(key, token);
  else props.deleteProperty(key);
}

/**
 * Fired by the calendar-edit triggers installed in writeCalendarChangeTriggers().
 */
function onCalendarChange(e) {
  // FIRST LINE, before anything else costs a call: a bootstrap import deletes
  // these triggers, but a firing can still arrive afterwards — Google's
  // notification channel for a calendar is torn down asynchronously, and the
  // import is generating hundreds of changes for it to deliver. Deletion
  // stops NEW subscriptions; it does not recall what is already in flight.
  //
  // So the handler treats being called during an import as normal and makes
  // it free: one log line, no delta call, no lock, no sheet read. If these
  // keep appearing long after an import ends, the triggers are being
  // re-created rather than drained — logProjectTriggers() tells you which.
  if (!automationGateAllows('onCalendarChange', true)) return; // quiet: this can fire hundreds of times

  if (isBootstrapActive()) {
    log('onCalendarChange ignored — a large-setup import or forms-rebuild sweep is running and is editing these events itself.');
    return;
  }

  // After the bootstrap check, not before: firings that arrive from a
  // torn-down notification channel during an import are drained noise, and
  // attributing them would report an account that no longer holds a trigger.
  recordHandlerRun('onCalendarChange');

  const calendarId = e && e.calendarId;
  if (!calendarId) {
    log('onCalendarChange fired with no calendarId on the event object — falling back to a full syncCalendars().');
    syncCalendars();
    return;
  }
  log(`onCalendarChange fired (calendarId: ${calendarId}) — running an incremental delta check.`);
  processCalendarDeltaForCalendar(calendarId);
}

function processCalendarDeltaForCalendar(calendarId) {
  if (isBootstrapActive()) {
    log(`processCalendarDeltaForCalendar: a large-setup import or forms-rebuild sweep is in progress — skipping (it is editing these events itself).`);
    return;
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('processCalendarDeltaForCalendar: another sync is already running — skipping this run.');
    return;
  }
  let releasedEarly = false;
  try {
    const result = fetchCalendarDelta(calendarId);
    if (result.fullSyncRequired) {
      log(`Sync token for "${CALENDAR_MAP[calendarId] || calendarId}" was invalid/expired or the API call failed — falling back to a full syncCalendars().`);
      releasedEarly = true;
      lock.releaseLock();
      syncCalendars(); // acquires its own lock
      return;
    }
    if (result.changedEvents.length === 0) {
      log(`No calendar changes for "${CALENDAR_MAP[calendarId] || calendarId}" since the last check.`);
      return;
    }
    applyCalendarDeltaToSheets(calendarId, result.changedEvents);
  } finally {
    if (!releasedEarly) lock.releaseLock();
  }
}

/**
 * Pulls just the events that changed on `calendarId` since the last call,
 * using the Calendar API's incremental sync-token pattern. On the very
 * first call for a calendar (no stored token yet), this instead does a
 * bounded baseline fetch purely to obtain a starting nextSyncToken — it
 * does NOT try to reconcile historical events that way (the daily full
 * syncCalendars() scan, and the menu, already handle that).
 */
function fetchCalendarDelta(calendarId) {
  const tokenKey = getCalendarSyncTokenPropKey(calendarId);
  const props = PropertiesService.getScriptProperties();
  const syncToken = props.getProperty(tokenKey);

  const options = { showDeleted: true, singleEvents: true, maxResults: 250 };
  if (syncToken) {
    options.syncToken = syncToken;
  } else {
    const timeMin = new Date();
    timeMin.setDate(timeMin.getDate() - CALENDAR_SYNC_TOKEN_TIMEMIN_DAYS_BACK);
    options.timeMin = timeMin.toISOString();
  }

  const changedEvents = [];
  let pageToken = null;
  let nextSyncToken = null;

  try {
    do {
      if (pageToken) options.pageToken = pageToken; else delete options.pageToken;
      // Requires the "Calendar" Advanced Service to be enabled for this
      // project (Editor -> Services -> + Calendar API).
      const eventList = Calendar.Events.list(calendarId, options);
      (eventList.items || []).forEach(ev => changedEvents.push(ev));
      pageToken = eventList.nextPageToken;
      if (eventList.nextSyncToken) nextSyncToken = eventList.nextSyncToken;
    } while (pageToken);
  } catch (err) {
    const msg = String((err && err.message) || err);
    const isExpiredToken = msg.indexOf('410') !== -1 || /sync ?token/i.test(msg);
    if (isExpiredToken) {
      log(`⚠️ Calendar sync token for ${calendarId} expired/invalid (${err}) — clearing it so the next check re-baselines.`);
      saveCalendarSyncToken(calendarId, null);
    } else {
      log(`⚠️ Calendar.Events.list failed for ${calendarId} (${err}).`);
    }
    return { fullSyncRequired: true, changedEvents: [] };
  }

  if (nextSyncToken) saveCalendarSyncToken(calendarId, nextSyncToken);

  if (!syncToken) {
    log(`Established an initial Calendar sync token for "${CALENDAR_MAP[calendarId] || calendarId}" — no deltas processed on this baseline call.`);
    return { fullSyncRequired: false, changedEvents: [] };
  }

  return { fullSyncRequired: false, changedEvents };
}

/**
 * Advances every calendar's sync token past changes THIS SCRIPT just made,
 * without acting on them. Call it after anything that edits calendar events,
 * immediately before the calendar-edit triggers go back on.
 *
 * Removing the triggers during a sync only stops them FIRING; it does not
 * stop the changes accumulating. Re-creating them afterwards therefore hands
 * onCalendarChange() a backlog of our own description writes — one per event
 * — every one of which reads as "relevant" and escalates to a full
 * syncCalendars(). One import of 272 events becomes a queue of full syncs,
 * each re-reading every calendar and re-rendering every tab. That storm is
 * what this prevents.
 *
 * The trade-off is deliberate: a genuine third-party edit made in the same
 * window is drained too, and waits for the next scheduled full sync (hourly
 * for registrations, daily for calendars) instead of being reacted to
 * immediately. Losing a few minutes of reaction time beats a self-sustaining
 * sync loop.
 */
function primeCalendarSyncTokens(reason) {
  let primed = 0;
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    try {
      const result = fetchCalendarDelta(calendarId);
      if (result.fullSyncRequired) {
        log(`ℹ️ Could not prime the sync token for "${CALENDAR_MAP[calendarId]}" — its next delta check will re-baseline.`);
        return;
      }
      primed++;
    } catch (err) {
      // Typically the Calendar Advanced Service not being enabled. Nothing
      // here is load-bearing enough to fail a sync over.
      log(`ℹ️ Could not prime the sync token for "${CALENDAR_MAP[calendarId]}" (${err}).`);
    }
  });
  if (primed > 0) log(`Primed ${primed} calendar sync token(s) past this ${reason}'s own edits.`);
  return primed;
}

function isRawEventAllDay(ev) {
  return !!(ev.start && ev.start.date && !ev.start.dateTime);
}

function getRawEventStart(ev) {
  if (!ev.start) return null;
  if (ev.start.dateTime) return new Date(ev.start.dateTime);
  if (ev.start.date) return new Date(ev.start.date);
  return null;
}

/**
 * Decides whether the delta contains anything worth reconciling. A
 * cancelled (event.status === 'cancelled') event always counts as
 * potentially relevant, since a tracked session may have just been
 * deleted. An active event counts if it's a timed event, inside our
 * tracked lookahead window, and matches our title pattern.
 *
 * A still-tentative event ("*" title) is NOT relevant — the full sync
 * would skip it anyway. Note this still catches CONFIRMATION correctly:
 * dropping the asterisk makes the delta's new title non-tentative, which
 * reads as relevant here and triggers the sync that builds its form.
 */
function applyCalendarDeltaToSheets(calendarId, changedEvents) {
  const { start, end } = computeSyncDateRange();
  const locationName = CALENDAR_MAP[calendarId] || calendarId;

  const relevant = changedEvents.some(ev => {
    if (isRawEventAllDay(ev)) return false;
    const evStart = getRawEventStart(ev);
    if (!evStart || evStart < start || evStart > end) return false;
    if (ev.status === 'cancelled') return true;
    const parsed = parseEventTitle(ev.summary);
    return !!parsed && !parsed.isTentative;
  });

  if (!relevant) {
    log(`Calendar delta for "${locationName}" contained ${changedEvents.length} change(s), none relevant to tracked sessions — skipping a full sync.`);
    return;
  }

  log(`Calendar delta for "${locationName}" contained a relevant change — running a full syncCalendars() to reconcile.`);
  invalidateCalendarEventsCache(); // the delta just told us the event set moved
  syncCalendars();
}


// ============================================================================
// 4. CALENDAR SYNC & FORM GENERATION  (syncCalendars)
// ============================================================================

function computeSyncDateRange() {
  const today = new Date();
  const target = new Date(today);
  target.setDate(target.getDate() + SYNC_LOOKAHEAD_DAYS);

  const start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
  const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/** A leading "*" on the title marks an event TENTATIVE — see parseEventTitle(). */
const TENTATIVE_TITLE_PREFIX = '*';

/** Every bracketed group in a string: "[Cap: 12] [Grouped]" and "[Cap: 12, Grouped]" both work. */
const BRACKET_GROUP_REGEX = /\[([^\]]*)\]/g;

/**
 * Pulls the settings this system understands out of any bracketed groups
 * in a blob of text:
 *   [Cap: 12]            -> capacity 12
 *   [Grouped]            -> one form for the whole series (see EVENT_TYPES)
 *   [Monthly]            -> one form per calendar month (the default anyway)
 *   [Cap: 12, Grouped]   -> both, one bracket
 *   [All Locations]      -> this event's sessions pool with the same-titled
 *                           sessions on every other calendar, onto ONE form
 *                           (see SHARED_LOCATION_SCOPE). Also spelled
 *                           [Shared] / [All Sites] / [Combined] / [Multi-Site].
 *   [Club]               -> this program keeps a standing membership; people
 *                           sign up once and stay signed up (see CLUB_TAG).
 *                           Composes with all of the above:
 *                           [Club, Grouped], [Club, Cap: 12, All Locations]…
 *
 * [Fixed] is still read as [Grouped] and [Regular] as [Monthly], so
 * descriptions written before the rename keep working untouched — there is
 * nothing to go back and edit.
 *
 * Unrecognized bracket contents are ignored, so people can bracket other
 * notes in a description without confusing anything.
 */
function parseSettingsBrackets(text) {
  const raw = String(text || '');
  let capacity = 0;
  let isFixed = false;
  let isShared = false;
  let isClub = false;
  let noRegistration = false;
  let sawAny = false;

  BRACKET_GROUP_REGEX.lastIndex = 0; // the /g regex is module-level; never trust its cursor
  let match;
  while ((match = BRACKET_GROUP_REGEX.exec(raw)) !== null) {
    const content = match[1] || '';
    const capMatch = /Cap:\s*(\d+)/i.exec(content);
    if (capMatch) { capacity = parseInt(capMatch[1], 10); sawAny = true; }
    // The WHERE half of grouping, orthogonal to Grouped/Monthly above — see
    // SHARED_LOCATION_SCOPE.
    if (SHARED_LOCATION_WORDS_REGEX.test(content)) { isShared = true; sawAny = true; }
    // Orthogonal to BOTH of the above — see CLUB_TAG. Read from the same
    // bracket or its own, so [Club, Grouped] and [Club] [Grouped] both work.
    if (CLUB_WORDS_REGEX.test(content)) { isClub = true; sawAny = true; }
    // Orthogonal to everything above, and the one that overrides them all —
    // see NO_REGISTRATION_TAG. There is no form to group, cap or share.
    if (NO_REGISTRATION_WORDS_REGEX.test(content)) { noRegistration = true; sawAny = true; }
    // "Grouped" is the current word, "Fixed" the one it replaced — both mean
    // "one form for the whole series." An explicit [Monthly]/[Regular] is
    // recognized too, purely so it counts as sawAny (a deliberate statement
    // of the default) rather than reading as an unrecognized note.
    if (/\b(Grouped|Fixed)\b/i.test(content)) { isFixed = true; sawAny = true; }
    if (/\b(Monthly|Regular)\b/i.test(content)) { sawAny = true; }
  }
  return { capacity, isFixed, isShared, isClub, noRegistration, sawAny };
}

/**
 * Parses event titles. The title is now just the program name, optionally
 * prefixed with "*":
 *   "Yoga Basics"    -> a program
 *   "*Yoga Basics"   -> the same program, TENTATIVE (see below)
 *
 * BOTH capacity and Grouped-vs-Monthly now live in the event DESCRIPTION —
 * see parseSettingsBrackets() / resolveEventSettings(). The title is what
 * attendees read on a shared calendar, and "[Cap: 12, Fixed]" there is
 * internal scheduling jargon. Brackets left in a title are still read as a
 * legacy fallback (and logged) so existing calendars don't silently lose
 * their capacity, but they're stripped from cleanTitle either way.
 *
 * A title beginning with "*" marks the event TENTATIVE: it is skipped
 * entirely by the form/registry pipeline until the asterisk is removed
 * (see syncCalendarsInternal()). The asterisk is stripped from cleanTitle,
 * which matters a lot — computeEventId() keys off cleanTitle, so an event's
 * ID is IDENTICAL before and after it is confirmed. Un-asterisking is
 * therefore just "a new event appears," with no ID churn.
 */
function parseEventTitle(title) {
  let raw = String(title || '').trim();
  if (!raw) return null;

  let isTentative = false;
  while (raw.charAt(0) === TENTATIVE_TITLE_PREFIX) {
    isTentative = true;
    raw = raw.substring(1).trim();
  }
  if (!raw) return null;

  const legacy = parseSettingsBrackets(raw);
  // Strip every bracketed group, wherever it sits, so the clean title is
  // stable no matter how someone spaced things out.
  const cleanTitle = raw.replace(BRACKET_GROUP_REGEX, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return null;

  return {
    cleanTitle,
    isTentative,
    legacyCapacity: legacy.capacity,
    legacyIsFixed: legacy.isFixed,
    legacyIsShared: legacy.isShared,
    legacyIsClub: legacy.isClub,
    legacyNoRegistration: legacy.noRegistration,
    hasLegacyBrackets: legacy.sawAny
  };
}

/**
 * Resolves { capacity, isFixed, isShared, isClub, noRegistration } for one event: the
 * DESCRIPTION's brackets win, and anything the description doesn't specify
 * falls back to legacy brackets left in the title (with a one-time nudge in
 * the log).
 */
function resolveEventSettings(event, parsedTitle) {
  const description = (event && typeof event.getDescription === 'function')
    ? (event.getDescription() || '')
    : '';
  const fromDescription = parseSettingsBrackets(description);

  const capacity = fromDescription.capacity || parsedTitle.legacyCapacity || 0;
  const isFixed = fromDescription.isFixed || parsedTitle.legacyIsFixed || false;
  const isShared = fromDescription.isShared || parsedTitle.legacyIsShared || false;
  const isClub = fromDescription.isClub || parsedTitle.legacyIsClub || false;
  const noRegistration = fromDescription.noRegistration || parsedTitle.legacyNoRegistration || false;

  if (parsedTitle.hasLegacyBrackets && !fromDescription.sawAny) {
    log(`ℹ️ "${parsedTitle.cleanTitle}" still carries its settings in the TITLE. That still works, but the supported ` +
      `place is now the event DESCRIPTION — move "[Cap: N]" / "[Grouped]" / "[Club]" there and drop them from the title.`);
  }
  return { capacity, isFixed, isShared, isClub, noRegistration };
}

/** Public entry point: acquires a script lock so overlapping executions can't race each other. */
function syncCalendars() {
  // Before the bootstrap check, which reads a Script Property, and before
  // anything touches CalendarApp: a paused run should cost as close to
  // nothing as possible, because the account whose trigger is firing may be
  // one nobody here can see or stop any other way.
  if (!automationGateAllows('Sync Cal')) return;
  recordHandlerRun('syncCalendars');

  if (isBootstrapActive()) {
    log(`syncCalendars: a large-setup import or forms-rebuild sweep is in progress — skipping this run so they don't fight over the same forms.`);
    return;
  }

  // Asked only when a human is driving. A calendar sync can create forms,
  // rewrite the date list on existing ones, and edit event descriptions —
  // outward-facing changes people see. The scheduled daily run passes this
  // (defaultWhenUnattended: true) because that is precisely its job; a menu
  // click gets to say no.
  if (!confirmConsequentialAction('Sync calendars now?',
    'This reads every program calendar and may CREATE registration forms, update the dates on ' +
    'existing forms, and edit the registration link in calendar event descriptions.\n\n' +
    'Registrants and their answers are never changed.', true)) {
    return;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('syncCalendars: another sync is already running — skipping this run.');
    toastIfPossible('Another sync is already running — try again in a moment.');
    return;
  }
  try {
    toastIfPossible('Syncing calendars…');
    syncCalendarsInternal();
  } finally {
    lock.releaseLock();
  }
}

function syncCalendarsInternal() {
  // The quiet window — take the calendar watchers down, do the work, advance
  // the sync tokens past our own description edits, put the watchers back
  // (restore-only). All four steps, and the reasons for each, live in
  // withCalendarChangeTriggersPaused(); this was the path that manufactured
  // most of the duplicate calendar triggers before that rule existed.
  withCalendarChangeTriggersPaused('sync', () => {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);

      if (findProgramSessionHeaderRows(registrySheet).length === 0) {
        renderProgramDashboard();
      }

      const summary = importCalendarGroups(registrySheet);
      renderProgramDashboard();

      SpreadsheetApp.getActiveSpreadsheet().toast(
        `Calendar sync complete ✅ (${describeImportSummary(summary)})`, 'Calendar & Form Manager', 5);
    } finally {
      // Inside the window, so both still happen before the triggers return.
      flushPersistentRegistries(); // never strand a form-label fingerprint written during this run
      flushAdminDigest('Calendar sync');
    }
  });
}

/**
 * THE calendar->registry import, shared by syncCalendarsInternal() and the
 * batched bootstrapCalendars(). Walks every group that has dates not already
 * on the session table, gives each one a form (new, reused, or recovered from
 * an event description), writes its rows, and stamps the registration link
 * back onto its calendar events.
 *
 * options.deadline — epoch ms. Checked BETWEEN groups: the loop stops cleanly
 *   the moment it can no longer be confident a whole group fits in what's
 *   left of the execution. A group is the unit of work because its rows, its
 *   form and its calendar-description edits have to land together; stopping
 *   mid-group would leave a form with no rows pointing at it.
 * options.onGroupDone — called after each processed group, for progress logs.
 *
 * Returns a summary including `remaining` (groups still needing work when the
 * deadline hit) and `outOfTime`.
 */
function importCalendarGroups(registrySheet, options) {
  options = options || {};
  const { start, end } = computeSyncDateRange();
  log(`Calendar import window: ${start} -> ${end}`);

  // FIRST, before a single event is read: deliver any checkbox tick that has
  // not reached the calendar yet (see PENDING_FLAG_SHEET_NAME). This run is
  // about to treat the calendar as the truth about every program, so an
  // instruction still sitting in the queue has to become part of that truth
  // now — otherwise this is the sync that unticks somebody's box.
  const pending = applyPendingProgramFlags();
  if (pending.applied > 0) {
    log(`Delivered ${pending.applied} queued checkbox change(s) to the calendar before importing.`);
  }

  const existingState = getExistingRegistryState(registrySheet);
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const work = collectCalendarWork(eventsByCalendar, existingState);

  // Before the per-group loop, and independently of it: a group whose dates
  // are all already on the sheet is skipped below as "up to date", which is
  // right for forms and rows but wrong for a tag somebody has just added to an
  // existing program. [Club] and [No Registration] have to take effect the
  // sync after they are ticked, not the sync after the program's next new
  // date.
  reconcileProgramFlagColumns(registrySheet, work.allGroups || []);
  applyNoRegistrationEffects(registrySheet, work.allGroups || []);

  const summary = {
    groupsTotal: work.length, groupsProcessed: 0, groupsFailed: 0,
    formsCreated: 0, formsReused: 0, groupsWithoutForms: 0,
    eventsAdded: 0, remaining: 0, outOfTime: false
  };

  for (let i = 0; i < work.length; i++) {
    if (options.deadline && Date.now() >= options.deadline) {
      summary.outOfTime = true;
      summary.remaining = work.length - i;
      log(`Out of time for this run — ${summary.remaining} group(s) left to import.`);
      break;
    }

    const item = work[i];
    try {
      const result = processCalendarGroup(registrySheet, item, existingState);
      summary.groupsProcessed++;
      summary.eventsAdded += result.eventsAdded;
      // A [No Registration] group has no form either way — counting it as
      // "reused" would report forms this run never opened.
      if (result.formCreated) summary.formsCreated++;
      else if (result.noForm) summary.groupsWithoutForms++;
      else summary.formsReused++;
    } catch (err) {
      // One bad group must not cost the whole run — especially mid-bootstrap,
      // where everything after it would be stranded too.
      summary.groupsFailed++;
      log(`⚠️ Could not import "${item.group.groupKey}" (${err}) — continuing with the rest.`);
      noteForAdmin('Programs that could not be imported',
        `${item.group.cleanTitle} (${describeLocations(item.group.locations)}) — ${err}`);
    }
    if (options.onGroupDone) options.onGroupDone(summary);
  }

  flushPersistentRegistries(); // one write covering every group touched above

  // Once more, now that the loop has built or recovered forms: a program that
  // has just come back off [No Registration] gets its dashboard links back on
  // the SAME sync that restores its form, rather than on the one after.
  updateRegistrationLinkCells(registrySheet, work.allGroups || [], buildFormIdByProgram(work.allGroups || []));
  return summary;
}

/** Human-readable one-liner for a toast/log line. */
function describeImportSummary(summary) {
  const parts = [`${summary.groupsProcessed} program group(s)`, `${summary.eventsAdded} new date(s)`];
  if (summary.formsCreated > 0) parts.push(`${summary.formsCreated} new form(s)`);
  if (summary.formsReused > 0) parts.push(`${summary.formsReused} existing form(s) reused`);
  if (summary.groupsWithoutForms > 0) parts.push(`${summary.groupsWithoutForms} with no registration`);
  if (summary.groupsFailed > 0) parts.push(`${summary.groupsFailed} failed`);
  return parts.join(', ');
}

/**
 * Turns the raw calendar fetch into an ordered list of units of work —
 * `{ group, configInfo, newSessions }` — skipping groups whose dates are all
 * already on the session table. Pure in-memory work: no form, sheet or
 * calendar writes happen here, so a caller can safely build the whole list up
 * front and then process as much of it as it has time for.
 *
 * Parsing is per calendar (a calendar IS a location), but GROUPING is done
 * once across all of them — that is what lets a program tagged
 * [All Locations] pool its sessions onto one form instead of one per site.
 */
function collectCalendarWork(eventsByCalendar, existingState) {
  const parsedSessions = [];

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const locationName = CALENDAR_MAP[calendarId];
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Calendar not found or inaccessible: ${calendarId}`);
      return;
    }

    const tentativeTitles = new Set();
    events
      .filter(ev => !ev.isAllDayEvent())
      .forEach(ev => {
        const parsed = parseEventTitle(ev.getTitle());
        if (!parsed) return;
        // Tentative events are skipped WHOLESALE — no form, no registry
        // row — until the leading "*" comes off. Because parseEventTitle()
        // strips the asterisk from cleanTitle, confirming an event later
        // produces the exact same Event_ID, so it simply flows through as
        // a brand-new session with no reconciliation needed.
        if (parsed.isTentative) {
          tentativeTitles.add(parsed.cleanTitle);
          return;
        }
        const settings = resolveEventSettings(ev, parsed);
        parsed.capacity = settings.capacity;
        parsed.isFixed = settings.isFixed;
        parsed.isShared = settings.isShared;
        parsed.isClub = settings.isClub;
        parsed.noRegistration = settings.noRegistration;
        parsedSessions.push({ event: ev, parsed, calendarId, locationName });
      });

    if (tentativeTitles.size > 0) {
      log(`Skipped ${tentativeTitles.size} tentative program(s) at ${locationName} (title starts with "*"): ` +
        `${Array.from(tentativeTitles).join(', ')}. Remove the asterisk to generate forms.`);
    }
  });

  const groups = buildEventGroups(parsedSessions);
  warnAboutPartiallySharedPrograms(groups);

  const work = [];
  groups.forEach(group => {
    const newSessions = group.sessions.filter(s => {
      const eventId = computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()));
      return !existingState.eventIds.has(eventId);
    });
    // A program whose rows still say "— no registration —" while its calendar
    // no longer says [No Registration] is NOT up to date, however old its
    // dates are: it needs its form back, and its registration link back on its
    // events. That is the only reason a group with nothing new to add is
    // processed — see processCalendarGroup(), which writes no rows for it and
    // simply restores the form and the links.
    const needsUnblocking = !group.noRegistration && group.sessions.some(s =>
      existingState.blockedPrograms &&
      existingState.blockedPrograms.has(`${s.calendarId}|${group.cleanTitle}`));

    if (newSessions.length === 0 && !needsUnblocking) {
      log(`No new dates for "${group.groupKey}" — already up to date, skipping.`);
      return;
    }
    if (newSessions.length === 0) {
      log(`No new dates for "${group.groupKey}", but it is coming back off [${NO_REGISTRATION_TAG}] — restoring its form and links.`);
    }
    work.push({
      group,
      configInfo: { footerNote: buildFooterNoteForLocations(group.locations) },
      newSessions
    });
  });

  // EVERY group that was seen, including the ones with nothing new to do.
  // reconcileProgramFlagColumns() needs those too — see importCalendarGroups().
  work.allGroups = groups;
  return work;
}

/**
 * Brings the session table's flag checkboxes (Club, No_Registration) into line
 * with what the calendar currently says, for every program seen in this sync's
 * window.
 *
 * Needed because writeEventRegistryRows() only ever writes NEW rows: adding
 * [Club] to a program whose twelve dates are already imported would otherwise
 * change nothing until its thirteenth date appeared. Only programs actually
 * present in `groups` are touched, so a program outside the sync window keeps
 * whatever it has.
 *
 * This is also the half of "live" that runs the other way round. A tick on the
 * sheet is pushed to the calendar by handleProgramFlagEdit(); this pulls the
 * calendar's answer back onto every row of the program, so the two can never
 * sit disagreeing for longer than one sync.
 *
 * Returns how many cells changed.
 */
function reconcileProgramFlagColumns(registrySheet, groups) {
  if (!groups || groups.length === 0) return 0;

  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  if (!sheetMap['Calendar_Source'] || !sheetMap['Clean_Title']) return 0;

  let changed = 0;
  PROGRAM_FLAG_COLUMNS.forEach(flag => {
    if (!sheetMap[flag.column]) return; // a workbook still on the old layout

    // Programs whose tick has not reached the calendar yet are LEFT ALONE.
    // Without this the calendar — which has not been told about the tick —
    // would win, and the box would untick itself between the click and the
    // write. That is the whole bug the pending queue exists to close.
    const pendingKeys = pendingProgramKeysFor(flag.column);

    // Keyed per calendar + title, matching how a session row identifies itself.
    const expected = {};
    groups.forEach(group => {
      const value = !!group[flag.groupKey];
      group.sessions.forEach(session => {
        expected[`${session.calendarId}|${group.cleanTitle}`] = value;
      });
    });

    headerRows.forEach((hRow, i) => {
      const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
      const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
      if (!zone) return;

      const sources = registrySheet.getRange(zone.start, sheetMap['Calendar_Source'], zone.count, 1).getValues();
      const titles = registrySheet.getRange(zone.start, sheetMap['Clean_Title'], zone.count, 1).getValues();
      const flagRange = registrySheet.getRange(zone.start, sheetMap[flag.column], zone.count, 1);
      const current = flagRange.getValues();

      let touched = false;
      for (let r = 0; r < zone.count; r++) {
        const key = `${String(sources[r][0] || '').trim()}|${String(titles[r][0] || '').trim()}`;
        if (!Object.prototype.hasOwnProperty.call(expected, key)) continue;
        if (pendingKeys.has(key)) continue; // waiting to be written TO the calendar
        const want = expected[key];
        // Compared through isFlagColumnValue(), so a row still carrying the
        // word "Club" from an older version counts as already ticked in
        // MEANING — but not in TYPE, hence the second test: it is rewritten as
        // a real boolean so the checkbox renders, once, and never again.
        if (isFlagColumnValue(current[r][0], flag.regex) === want && typeof current[r][0] === 'boolean') continue;
        current[r] = [want];
        touched = true;
        changed++;
      }
      if (touched) flagRange.setValues(current);
    });
  });

  if (changed > 0) log(`reconcileProgramFlagColumns: updated ${changed} flag cell(s) on the session table.`);
  return changed;
}

/**
 * The name this had when Club was the only flag column. Kept for anything
 * still calling it.
 */
function reconcileClubTags(registrySheet, groups) {
  return reconcileProgramFlagColumns(registrySheet, groups);
}

/**
 * Makes [No Registration] mean something to the forms and the calendar, not
 * just to a column.
 *
 * processCalendarGroup() already declines to BUILD a form for a tagged group.
 * This handles the case that actually happens: a program that has been running
 * with a form for months, whose box somebody has just ticked. Two things have
 * to stop, and both have to be reversible —
 *
 *   1. the registration link in its calendar events, which otherwise keeps
 *      inviting people to sign up for something nobody is listing;
 *   2. the form itself, which otherwise keeps quietly accepting responses that
 *      no longer reach anyone. It is CLOSED, never deleted or unlinked: the
 *      responses already in it are the record of who came, and deleting a form
 *      is not something a checkbox should be able to do.
 *
 * Untick the box and both are undone — the link goes back on the next sync,
 * and the form is re-opened here. Only forms THIS function closed are ever
 * re-opened (they are remembered in a Script Property), so a form staff closed
 * by hand in the Forms UI stays closed.
 */
const NO_REGISTRATION_CLOSED_FORMS_PROP_KEY = 'NO_REGISTRATION_CLOSED_FORMS_V1';

function applyNoRegistrationEffects(registrySheet, groups) {
  if (!groups || groups.length === 0) return 0;

  const props = PropertiesService.getScriptProperties();
  let closedIds;
  try {
    closedIds = JSON.parse(props.getProperty(NO_REGISTRATION_CLOSED_FORMS_PROP_KEY) || '{}');
  } catch (err) {
    closedIds = {};
  }
  // Nothing tagged and nothing we have ever closed: every sync of every
  // workbook that does not use this feature stops here, before a single
  // Forms or Calendar call.
  const tagged = groups.filter(g => g.noRegistration);
  if (tagged.length === 0 && Object.keys(closedIds).length === 0) {
    // Nothing to close, re-open or strip. The link columns are still checked:
    // a row left saying "— no registration —" by an earlier tag has to get its
    // links back, and that is cheap (a few reads per zone, and a Forms call
    // only where such a row is actually found).
    updateRegistrationLinkCells(registrySheet, groups, buildFormIdByProgram(groups));
    return 0;
  }

  const formIdsByGroupKey = getPersistentFormRegistry();
  let touched = 0;
  let closedNow = 0;
  let reopenedNow = 0;

  groups.forEach(group => {
    // The registry is the cheap answer. Reading a form ID back out of the
    // event descriptions opens forms one at a time, so it is kept for the
    // tagged groups that actually need one — which is where a form built
    // before the registry existed has to be found.
    const formId = formIdsByGroupKey[group.groupKey] ||
      (group.noRegistration ? (findExistingFormIdFromEvents(group.events || []) || '') : '');

    if (group.noRegistration) {
      // 1. Every registration link out of every one of its events.
      (group.events || []).forEach(ev => {
        const existing = ev.getDescription() || '';
        const stripped = stripAllRegistrationLines(existing);
        if (stripped.removed === 0 || stripped.text === existing) return;
        ev.setDescription(stripped.text);
        touched++;
      });

      // 2. The form stops taking responses, and we remember that we did it.
      if (formId && !closedIds[formId]) {
        try {
          const form = FormApp.openById(formId);
          if (form.isAcceptingResponses()) {
            form.setAcceptingResponses(false);
            closedNow++;
          }
          closedIds[formId] = group.groupKey;
        } catch (err) {
          log(`ℹ️ "${group.cleanTitle}" is tagged [${NO_REGISTRATION_TAG}] but its form ${formId} could not be closed (${err}).`);
        }
      }
      return;
    }

    // The tag has come off: re-open a form we closed for this reason. Anything
    // we did not close ourselves is left exactly as it is.
    if (formId && closedIds[formId]) {
      try {
        const form = FormApp.openById(formId);
        if (!form.isAcceptingResponses()) {
          form.setAcceptingResponses(true);
          reopenedNow++;
        }
      } catch (err) {
        log(`ℹ️ "${group.cleanTitle}" no longer says [${NO_REGISTRATION_TAG}], but its form ${formId} could not be re-opened (${err}).`);
      }
      delete closedIds[formId];
    }
  });

  if (touched > 0) invalidateCalendarEventsCache();
  props.setProperty(NO_REGISTRATION_CLOSED_FORMS_PROP_KEY, JSON.stringify(closedIds));
  updateRegistrationLinkCells(registrySheet, groups, buildFormIdByProgram(groups));

  if (touched || closedNow || reopenedNow) {
    log(`applyNoRegistrationEffects: removed the registration link from ${touched} event(s), ` +
      `closed ${closedNow} form(s), re-opened ${reopenedNow}.`);
  }
  return touched;
}

/**
 * Keeps the session table's two link columns honest about [No Registration].
 *
 * A program that has been running with a form already has "View Live Form" on
 * every one of its rows, and those rows are not rewritten by a sync that has
 * no new dates to add — so ticking the box would leave a live registration
 * link sitting on the dashboard for a program that no longer takes any. Rows
 * of a tagged program therefore say so in words instead (see
 * NO_REGISTRATION_LINK_LABEL), and rows that say so get their real links back
 * when the tag comes off.
 *
 * A tagged program keeps its Form_ID — hidden plumbing, and what makes the
 * restore possible without waiting for a new date to appear. Rows written
 * WHILE the tag was on have no Form_ID at all, so `formIdByProgram`
 * (`calendarId|title` -> Form_ID, from the persistent registry) is the
 * fallback, and it is written into the row on the way past.
 */
function updateRegistrationLinkCells(registrySheet, groups, formIdByProgram) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  if (!sheetMap['Form_Response_Link'] || !sheetMap['Calendar_Source'] || !sheetMap['Clean_Title']) return 0;

  // Same rule as reconcileProgramFlagColumns(): a program whose No_Registration
  // tick has not reached the calendar yet is not something the calendar gets to
  // have an opinion about, so its link cells are left as they are until it has.
  const pendingKeys = pendingProgramKeysFor('No_Registration');

  const wantsNoRegistration = {};
  groups.forEach(group => {
    group.sessions.forEach(session => {
      const key = `${session.calendarId}|${group.cleanTitle}`;
      if (pendingKeys.has(key)) return;
      wantsNoRegistration[key] = !!group.noRegistration;
    });
  });

  const linksByFormId = {};
  const linksFor = formId => {
    if (!formId) return null;
    if (!Object.prototype.hasOwnProperty.call(linksByFormId, formId)) {
      try {
        const form = FormApp.openById(formId);
        linksByFormId[formId] = { publishedUrl: form.getPublishedUrl(), editUrl: form.getEditUrl() };
      } catch (err) {
        log(`ℹ️ Could not re-read form ${formId} to restore its links (${err}).`);
        linksByFormId[formId] = null;
      }
    }
    return linksByFormId[formId];
  };

  let changed = 0;
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const sources = registrySheet.getRange(zone.start, sheetMap['Calendar_Source'], zone.count, 1).getValues();
    const titles = registrySheet.getRange(zone.start, sheetMap['Clean_Title'], zone.count, 1).getValues();
    const formIds = sheetMap['Form_ID']
      ? registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1).getValues()
      : null;
    // Read as VALUES but written CELL BY CELL. These columns hold =HYPERLINK()
    // formulas, which getValues() flattens to their display text — writing a
    // whole column back from that array would turn every link on it into the
    // words "View Live Form".
    const view = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1).getValues();

    for (let r = 0; r < zone.count; r++) {
      const key = `${String(sources[r][0] || '').trim()}|${String(titles[r][0] || '').trim()}`;
      if (!Object.prototype.hasOwnProperty.call(wantsNoRegistration, key)) continue;
      const isBlocked = String(view[r][0] || '').trim() === NO_REGISTRATION_LINK_LABEL;
      const setCell = (colName, value) => {
        if (!sheetMap[colName]) return;
        registrySheet.getRange(zone.start + r, sheetMap[colName], 1, 1).setValue(value);
      };

      if (wantsNoRegistration[key]) {
        if (isBlocked) continue;
        setCell('Form_Response_Link', NO_REGISTRATION_LINK_LABEL);
        setCell('Edit_Form_Link', '');
        changed++;
        continue;
      }

      if (!isBlocked) continue; // already showing its own links
      const rowFormId = formIds ? String(formIds[r][0] || '').trim() : '';
      const formId = rowFormId || (formIdByProgram ? (formIdByProgram[key] || '') : '');
      const links = linksFor(formId);
      if (!links) continue; // no form to point at yet — the next sync builds one
      setCell('Form_Response_Link', makeHyperlinkFormula(links.publishedUrl, 'View Live Form'));
      setCell('Edit_Form_Link', makeHyperlinkFormula(links.editUrl, 'Edit Form Settings'));
      if (!rowFormId) setCell('Form_ID', formId);
      changed++;
    }
  });

  if (changed > 0) log(`updateRegistrationLinkCells: rewrote the link columns on ${changed} session row(s).`);
  return changed;
}

/** `calendarId|title` -> Form_ID, from the persistent form registry, for these groups. */
function buildFormIdByProgram(groups) {
  const registry = getPersistentFormRegistry();
  const out = {};
  (groups || []).forEach(group => {
    const formId = registry[group.groupKey];
    if (!formId) return;
    group.sessions.forEach(session => {
      out[`${session.calendarId}|${group.cleanTitle}`] = formId;
    });
  });
  return out;
}

/**
 * A program that carries [All Locations] on SOME of its events and not others
 * is almost always a half-finished edit — someone tagged one calendar's copies
 * and stopped. It is handled coherently either way (each event follows its own
 * tag, so the untagged ones keep their own per-location form), but it is worth
 * saying out loud: the symptom otherwise is "the shared form is missing
 * Ashbridge" with nothing anywhere explaining why.
 */
function warnAboutPartiallySharedPrograms(groups) {
  const byTitle = {};
  groups.forEach(g => {
    if (!byTitle[g.cleanTitle]) byTitle[g.cleanTitle] = { shared: [], own: [] };
    byTitle[g.cleanTitle][g.isShared ? 'shared' : 'own'].push(g);
  });

  Object.keys(byTitle).forEach(title => {
    const { shared, own } = byTitle[title];
    if (shared.length === 0 || own.length === 0) return;
    const strayLocations = dedupePreservingOrder(own.reduce((acc, g) => acc.concat(g.locations), []));
    const message = `"${title}" is tagged [${SHARED_LOCATION_TAG}] at ${describeLocations(shared[0].locations)} ` +
      `but NOT at ${strayLocations.join(', ')}, so those sessions keep their own separate form(s). ` +
      `Add [${SHARED_LOCATION_TAG}] to their calendar events too (or use "🔗 Link Program Across Locations…") ` +
      `if they were meant to share one.`;
    log(`⚠️ ${message}`);
    noteForAdmin('Programs only partly linked across locations', message);
  });
}

/**
 * One unit of work: resolve the group's form, write its new session rows, and
 * put the registration link on its calendar events. Returns
 * { formCreated, eventsAdded }.
 */
function processCalendarGroup(registrySheet, item, existingState) {
  const { group, configInfo, newSessions } = item;

  // [No Registration] short-circuits the whole form half of this function.
  // The dates still become session rows — the dashboard is what staff read to
  // see what is on — but with no form built, no form reused, and no
  // registration link written back. applyNoRegistrationEffects() has already
  // taken care of any form and any link this program had before the tag went
  // on.
  if (group.noRegistration) {
    const noFormGroup = Object.assign({}, group, {
      sessions: newSessions,
      events: newSessions.map(s => s.event)
    });
    writeEventRegistryRows(registrySheet, noFormGroup, null);
    newSessions.forEach(s => existingState.eventIds.add(
      computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()))));
    log(`"${group.groupKey}" is tagged [${NO_REGISTRATION_TAG}] — wrote ${newSessions.length} date(s) with no form.`);
    return { formCreated: false, noForm: true, eventsAdded: newSessions.length };
  }

  let existingFormId = existingState.groupFormMap[group.groupKey];
  if (!existingFormId) {
    existingFormId = findExistingFormIdFromEvents(group.events);
    if (existingFormId) {
      log(`Recovered existing form ${existingFormId} for "${group.groupKey}" from a calendar event description.`);
    }
  }

  let formInfo;
  let formCreated = false;
  if (existingFormId) {
    try {
      formInfo = refreshFormForNewDates(existingFormId, group, configInfo);
      log(`Reused existing form for "${group.groupKey}"; added ${newSessions.length} new date(s).`);
    } catch (err) {
      log(`⚠️ Could not reopen existing form ${existingFormId} for "${group.groupKey}" (${err}) — creating a replacement form.`);
      formInfo = createRegistrationForm(group, configInfo);
      formCreated = true;
    }
  } else {
    formInfo = createRegistrationForm(group, configInfo);
    formCreated = true;
    log(`Created new form for "${group.groupKey}" with ${newSessions.length} date(s)` +
      (group.isShared ? ` across ${describeLocations(group.locations)}` : '') + '.');
  }
  savePersistentFormRegistryEntry(group.groupKey, formInfo.formId);
  // Flushed HERE, not at the end of the run: between creating a form and
  // writing its rows there is a window where nothing durable points at it,
  // and an execution killed in that window would create a second form for
  // this group on the next attempt. One property write per new group is a
  // cheap price for that never happening. (Everything after this point is
  // itself durable — the rows carry Form_ID, and so does the event
  // description.)
  flushPersistentRegistries();

  const newSessionsGroup = Object.assign({}, group, {
    sessions: newSessions,
    events: newSessions.map(s => s.event)
  });
  writeEventRegistryRows(registrySheet, newSessionsGroup, formInfo);

  backInjectCalendarDescriptions(group, formInfo);

  // Keep the in-memory state honest for the rest of THIS run: these dates now
  // exist, and this group now has a form.
  newSessions.forEach(s => existingState.eventIds.add(
    computeEventId(s.calendarId, group.cleanTitle, formatDateKey(s.event.getStartTime()))));
  existingState.groupFormMap[group.groupKey] = formInfo.formId;

  return { formCreated, eventsAdded: newSessions.length };
}

/**
 * Buckets parsed sessions — `{ event, parsed, calendarId, locationName }`,
 * from every calendar at once — into the groups that each get ONE form.
 *
 * A group key is `<scope>::<title>::<span>`:
 *   scope  the calendar ID, or SHARED_LOCATION_SCOPE when the event is tagged
 *          [All Locations] — the WHERE half of grouping.
 *   span   'FIXED' for a [Grouped] series, else the month label — the WHEN
 *          half. ('FIXED' is deliberately not renamed alongside the Type_Tag
 *          vocabulary; it is a persisted internal key, see
 *          getExistingRegistryState().)
 *
 * Every group carries `sessions` (each with the calendar and location it came
 * from, so nothing downstream has to assume a group is single-location) and
 * `events`, the same list flattened, for the calendar-facing helpers.
 */
function buildEventGroups(parsedSessions) {
  const groups = {};

  parsedSessions.forEach(({ event, parsed, calendarId, locationName }) => {
    const startTime = event.getStartTime();
    const monthLabel = getMonthLabel(startTime);
    const typeTag = parsed.isFixed ? EVENT_TYPES.GROUPED : EVENT_TYPES.MONTHLY;

    const scope = parsed.isShared ? SHARED_LOCATION_SCOPE : calendarId;
    const span = parsed.isFixed ? 'FIXED' : monthLabel;
    const key = `${scope}::${parsed.cleanTitle}::${span}`;

    if (!groups[key]) {
      groups[key] = {
        groupKey: key,
        scope,
        isShared: !!parsed.isShared,
        // The one calendar a non-shared group belongs to. A shared group has
        // no single one — its rows take their Calendar_Source per session.
        calendarId: parsed.isShared ? null : calendarId,
        cleanTitle: parsed.cleanTitle,
        capacity: parsed.capacity,
        isFixed: parsed.isFixed,
        isClub: !!parsed.isClub,
        noRegistration: !!parsed.noRegistration,
        typeTag,
        monthLabel: parsed.isFixed ? null : monthLabel,
        sessions: []
      };
    }
    // A capacity typed on any one of a group's events applies to the group
    // (it always has — this just keeps that true when the first event seen
    // happens to be an untagged one from another calendar).
    if (!groups[key].capacity && parsed.capacity) groups[key].capacity = parsed.capacity;
    // Same rule for [Club], and for the same reason: a program is a club or it
    // isn't, and tagging one of its twelve calendar events is how somebody
    // says so. Never un-set — a missing tag on one event is an omission, not a
    // statement that the club has been dissolved.
    if (parsed.isClub) groups[key].isClub = true;
    // And again for [No Registration]: tagging one event of a program is how
    // somebody says the program takes no sign-ups, and a missing tag on
    // another of its events is an omission rather than a contradiction.
    if (parsed.noRegistration) groups[key].noRegistration = true;
    groups[key].sessions.push({ event, calendarId, locationName });
  });

  return Object.values(groups).map(g => {
    g.sessions.sort((a, b) => a.event.getStartTime() - b.event.getStartTime());
    g.events = g.sessions.map(s => s.event);
    g.locations = distinctLocations(g.sessions.map(s => s.locationName));
    g.calendarIds = dedupePreservingOrder(g.sessions.map(s => s.calendarId));
    if (g.isFixed) {
      const first = g.events[0].getStartTime();
      const last = g.events[g.events.length - 1].getStartTime();
      g.seriesWeeks = Math.max(1, Math.round((last - first) / (7 * 24 * 60 * 60 * 1000)) + 1);
    }
    return g;
  });
}

/** The [{date, location, title}] sessions of a group, in the shape the form layer wants. */
function sessionsOfGroup(group) {
  return group.sessions.map(s => ({
    date: s.event.getStartTime(),
    location: s.locationName,
    title: group.cleanTitle
  }));
}

/**
 * Scans the current per-session table (both Upcoming and Past zones) to
 * build eventIds (every Event_ID already recorded) and groupFormMap
 * (groupKey -> Form_ID already generated), falling back to the persistent
 * registry for any group whose session rows aren't currently on the sheet.
 */
function getExistingRegistryState(registrySheet) {
  // blockedPrograms: `calendarId|title` for every program whose rows currently
  // say "— no registration —". Carried so collectCalendarWork() can tell the
  // difference between a program that is up to date and one that is up to date
  // BUT still showing the marks of a [No Registration] tag that has since come
  // off — the second one has work to do even though it has no new dates.
  const state = { eventIds: new Set(), groupFormMap: {}, blockedPrograms: new Set() };
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);

  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (eventId) state.eventIds.add(eventId);

    if (String(row[map['Form_Response_Link']] || '').trim() === NO_REGISTRATION_LINK_LABEL) {
      state.blockedPrograms.add(
        `${String(row[map['Calendar_Source']] || '').trim()}|${String(row[map['Clean_Title']] || '').trim()}`);
    }

    const source = row[map['Calendar_Source']];
    const title = row[map['Clean_Title']];
    const typeTag = row[map['Type_Tag']];
    const formId = row[map['Form_ID']];
    if (!source || !title || !formId) return;

    const d = coerceDate(row[map['Event_Date']]);
    const month = d ? getMonthLabel(d) : '';
    // The ::FIXED group-key suffix is deliberately NOT renamed alongside the
    // Type_Tag vocabulary: it's an internal key already persisted in the
    // form registry (Script Properties) and matched against buildEventGroups()'
    // output. Renaming it would orphan every stored entry and duplicate every
    // grouped form. isGroupedTypeTag() reads both spellings of the VALUE,
    // which is the part users see.
    const key = isGroupedTypeTag(typeTag) ? `${source}::${title}::FIXED` : `${source}::${title}::${month}`;
    if (!state.groupFormMap[key]) state.groupFormMap[key] = formId;
  });

  addSharedGroupKeysFromRows(state, rows, map);

  const persistent = getPersistentFormRegistry();
  Object.keys(persistent).forEach(key => {
    if (!state.groupFormMap[key]) state.groupFormMap[key] = persistent[key];
  });

  return state;
}

/**
 * Teaches the sheet-derived half of getExistingRegistryState() about
 * CROSS-LOCATION groups, whose key is scoped SHARED_LOCATION_SCOPE rather than
 * to any one calendar and so can never be reconstructed from a single row.
 *
 * It doesn't need a new column to do it: a form whose sessions span more than
 * one Calendar_Source IS a shared group's form — nothing else in this system
 * puts two calendars on one form. So the evidence is already on the sheet, and
 * the sheet stays a genuine fallback for a lost Script-Properties registry
 * (the case this whole function exists for) instead of quietly duplicating
 * every shared form the first time that registry is missing.
 */
function addSharedGroupKeysFromRows(state, rows, map) {
  const byForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const source = row[map['Calendar_Source']];
    const title = row[map['Clean_Title']];
    if (!formId || !source || !title) return;
    if (!byForm[formId]) byForm[formId] = { title, sources: new Set(), keys: new Set() };
    byForm[formId].sources.add(source);

    const d = coerceDate(row[map['Event_Date']]);
    const span = isGroupedTypeTag(row[map['Type_Tag']]) ? 'FIXED' : (d ? getMonthLabel(d) : '');
    byForm[formId].keys.add(`${SHARED_LOCATION_SCOPE}::${title}::${span}`);
  });

  Object.keys(byForm).forEach(formId => {
    const info = byForm[formId];
    if (info.sources.size < 2) return;
    info.keys.forEach(key => {
      if (!state.groupFormMap[key]) state.groupFormMap[key] = formId;
    });
  });
}


// ============================================================================
// 4b. LARGE-SETUP BOOTSTRAP  (bootstrapCalendars / resumeBootstrapCalendars)
// ============================================================================
//
// WHY THIS EXISTS: a normal syncCalendars() finishes in seconds because it has
// almost nothing to do — every group already has its form and its rows, so it
// skips them. The FIRST import is the opposite: every group is new, and each
// one costs a Drive copy, a dozen-plus Forms calls, a sheet write and one
// calendar-description write PER EVENT. Multiply that by a full 60-day window
// of programs across three calendars and it blows straight through Apps
// Script's six-minute execution limit — which is exactly what happens when
// you run initSheet() and then Sync Cal on a real calendar.
//
// A timeout there is worse than slow. The kill is not an exception, so
// syncCalendarsInternal()'s `finally` never runs: the calendar-edit triggers
// it removed at the start stay removed, the persistent registries never get
// flushed (so the forms it just created are forgotten and DUPLICATED on the
// next attempt), and whatever it managed to write is half-applied.
//
// So the bootstrap works in slices:
//   - Automation is paused up front — the calendar-edit triggers AND the
//     time-driven syncCalendars/syncRegistrations triggers — so nothing else
//     runs while a multi-execution import is in flight. syncCalendars() also
//     refuses to start on its own while the bootstrap is active.
//   - Each slice imports whole groups until its time budget runs out, then
//     hands off to the next slice via a one-off trigger. Progress lives in
//     the SHEET (a group with rows is skipped next time), so a slice never
//     has to trust anything it kept in memory.
//   - The hand-off trigger is armed BEFORE the work starts, timed to fire
//     after this slice's budget. If a slice is killed anyway, the next one
//     still comes. A slice that finishes normally re-arms it for a minute
//     out, so the common case doesn't idle.
//   - The final slice rebuilds every trigger, renders the dashboard once,
//     and clears the state.
// ============================================================================

const BOOTSTRAP_ENTRY_NAME = 'bootstrapCalendars';
const BOOTSTRAP_RESUME_HANDLER = 'resumeBootstrapCalendars';
const BOOTSTRAP_STATE_PROP_KEY = 'BOOTSTRAP_STATE_V1';

/**
 * How long one slice may spend importing before it stops between groups —
 * targeting ~5-minute chunks so a big calendar takes fewer, longer runs
 * instead of many short ones.
 *
 * NOT a flat 5 minutes on purpose. Apps Script's hard ceiling is 6 minutes,
 * the budget is only checked BETWEEN groups, and a group can take ~30-60s on
 * its own (a Drive copy, a dozen-plus Forms calls, a description write per
 * event). At a 5.0-minute budget a group starting at 4:59 runs past the
 * ceiling and gets killed mid-write; 4.5 leaves that group room to finish and
 * still leaves time for the wrap-up (flush, re-arm, log, toast). The killed
 * case is survivable — that's what the watchdog is for — but it costs a whole
 * extra slice, so it's worth not inviting.
 */
const BOOTSTRAP_SLICE_BUDGET_MS = 4.5 * 60 * 1000;
/** Gap before the next slice after a clean hand-off. Short, so the import doesn't idle between chunks. */
const BOOTSTRAP_RESUME_DELAY_MS = 30 * 1000;
/** Watchdog: armed before a slice starts, so a slice killed by the timeout still gets a successor. */
const BOOTSTRAP_WATCHDOG_DELAY_MS = BOOTSTRAP_SLICE_BUDGET_MS + 2.5 * 60 * 1000;
/** Toast progress roughly every this many groups WITHIN a slice, so a long chunk isn't silent. */
const BOOTSTRAP_TOAST_EVERY_GROUPS = 5;
/** Hard stop, so a bug can never leave the project trading triggers forever. */
const BOOTSTRAP_MAX_SLICES = 30;
/** Consecutive slices allowed to make no progress before giving up. */
const BOOTSTRAP_MAX_STALLED_SLICES = 2;
/**
 * After this long with no slice completing, isBootstrapActive() stops
 * believing the state — otherwise a bootstrap that died in a way that took
 * its watchdog with it would block every normal sync indefinitely.
 */
const BOOTSTRAP_STALE_MS = 2 * 60 * 60 * 1000;

function getBootstrapState() {
  const raw = PropertiesService.getScriptProperties().getProperty(BOOTSTRAP_STATE_PROP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️ Bootstrap state was unreadable (${err}) — treating it as finished.`);
    return null;
  }
}

function saveBootstrapState(state) {
  PropertiesService.getScriptProperties().setProperty(BOOTSTRAP_STATE_PROP_KEY, JSON.stringify(state));
}

function clearBootstrapState() {
  PropertiesService.getScriptProperties().deleteProperty(BOOTSTRAP_STATE_PROP_KEY);
}

/** Is a sliced import in flight right now, specifically? Stale state (see BOOTSTRAP_STALE_MS) reads as "no". */
function isBootstrapImportActive() {
  const state = getBootstrapState();
  if (!state) return false;
  const age = Date.now() - (state.lastSliceAt || state.startedAt || 0);
  if (age > BOOTSTRAP_STALE_MS) {
    log(`⚠️ Ignoring a large-setup import that hasn't advanced in ${Math.round(age / 60000)} minute(s) — ` +
      `run ${BOOTSTRAP_ENTRY_NAME}() to restart it, or cancelBootstrapCalendars() to clear it.`);
    return false;
  }
  return true;
}

/**
 * Is EITHER kind of sliced background job in flight — the large-setup import
 * above, or the destroy-and-rebuild forms sweep (see the "DESTROY-AND-REBUILD:
 * BACKGROUND SWEEP" block further down)? Both are multi-execution jobs that
 * pause syncCalendars/syncRegistrations/onCalendarChange for their duration
 * and write to the same dashboard, session table, and form registries, so
 * everything already guarded against one has to stand down for the other too.
 * Kept as a single combined check so the many call sites written against the
 * import don't each need to separately learn about the sweep.
 */
function isBootstrapActive() {
  return isBootstrapImportActive() || isFormRebuildSweepActive();
}

/** Which of the two sliced jobs is blocking, in one line — for toasts/logs that need to say why. */
function bootstrapBusyMessage() {
  if (isFormRebuildSweepActive()) {
    return 'A destroy-and-rebuild forms sweep is running in the background — try this once it finishes.';
  }
  return 'A large-setup import is running — try this once it finishes.';
}

/**
 * START HERE for a big calendar. Imports every program on every calendar —
 * creating each one's registration form, or adopting the form already linked
 * from its calendar description — across as many executions as it takes,
 * with all automation paused until it's done.
 *
 * Safe to run on an already-populated workbook: groups whose dates are
 * already on the session table are skipped, so this is also the way to
 * recover after a sync that timed out half-finished.
 */
function bootstrapCalendars() {
  if (!requireAuthorizedAdmin('Import Everything (First Run)')) return;
  // Ownership is checked HERE rather than in the writeTriggers(true) that
  // finishBootstrap() ends with, because by that point refusing would strand
  // the project with no triggers at all. An import both tears automation
  // down and builds it back up — so the account that starts one is choosing
  // to own the triggers, and has to be the owner going in.
  if (!requireTriggerOwnership()) return;
  if (isBootstrapImportActive()) {
    const state = getBootstrapState();
    const message = `A large-setup import is already running (slice ${state.slices} of at most ${BOOTSTRAP_MAX_SLICES}) — leaving it alone.`;
    log(message);
    toastIfPossible(message);
    return;
  }
  if (isFormRebuildSweepActive()) {
    const message = 'A destroy-and-rebuild forms sweep is running in the background — leaving it alone; try this once it finishes.';
    log(message);
    toastIfPossible(message);
    return;
  }

  pauseAutomationForBootstrap();
  saveBootstrapState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0,
    lastRemaining: null, groupsProcessed: 0, eventsAdded: 0,
    formsCreated: 0, formsReused: 0, groupsFailed: 0
  });
  log('Large-setup import started: automation paused, importing in slices.');
  toastIfPossible('Large-setup import started — this runs in the background and may take several minutes.');

  runBootstrapSlice();
}

/** Trigger handler for the next slice. Never call this directly — use bootstrapCalendars(). */
/**
 * DELIBERATELY NOT behind the Automation_Enabled kill switch, unlike the
 * three handlers in MANAGED_AUTOMATION_HANDLERS.
 *
 * An import that stops halfway is not a paused import — it's a stranded one:
 * the triggers stay torn down, the bootstrap state stays active (so every
 * normal sync keeps standing down), and the form registry never gets
 * flushed. Letting the kill switch hit this would turn "pause automation for
 * a minute" into a broken workbook that only cancelBootstrapCalendars() can
 * clear. An import already has its own stop control, which cleans up after
 * itself — that's what to use instead.
 *
 * bootstrapCalendars() is where the ownership check lives, so nothing an
 * un-owned account started can reach here in the first place.
 */
function resumeBootstrapCalendars() {
  runBootstrapSlice();
}

/**
 * One execution's worth of importing. Everything that decides whether there
 * is a NEXT slice happens here.
 */
function runBootstrapSlice() {
  const state = getBootstrapState();
  if (!state) {
    // Nothing in flight — a leftover trigger firing after the job finished.
    deleteBootstrapResumeTriggers();
    return;
  }

  // Armed BEFORE anything else, including the lock: from here on every exit
  // path leaves exactly one live successor behind, so neither an outright
  // kill nor a lock we couldn't get can strand the import. finishBootstrap()
  // is what finally clears it.
  armBootstrapResume(BOOTSTRAP_WATCHDOG_DELAY_MS);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('Bootstrap slice: another execution holds the lock — the next slice will retry.');
    return;
  }

  try {
    state.slices++;
    state.lastSliceAt = Date.now();
    saveBootstrapState(state);

    // Re-asserted EVERY slice, not just at the start. An import runs for
    // half an hour across a dozen executions, and a single trigger that
    // comes back during it — someone pressing "Check Triggers", a re-run of
    // initSheet(), anything at all — puts every event this import has
    // already touched back in onCalendarChange()'s queue, and the remaining
    // slices then fight a sync storm instead of importing. Costs one
    // getProjectTriggers() call per slice and normally removes nothing.
    pauseAutomationForBootstrap();

    if (state.slices > BOOTSTRAP_MAX_SLICES) {
      finishBootstrap(state, `stopped after ${BOOTSTRAP_MAX_SLICES} slices without finishing`);
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    if (findProgramSessionHeaderRows(registrySheet).length === 0) {
      renderProgramDashboard();
    }

    const doneBefore = state.groupsProcessed;
    toastIfPossible(`Import chunk ${state.slices} running… (${doneBefore} program group(s) done so far)`);

    const summary = importCalendarGroups(registrySheet, {
      deadline: Date.now() + BOOTSTRAP_SLICE_BUDGET_MS,
      // A 4.5-minute chunk is a long time to stare at an unchanged screen, so
      // it reports in as it goes rather than only at the hand-off.
      onGroupDone: partial => {
        if (partial.groupsProcessed % BOOTSTRAP_TOAST_EVERY_GROUPS !== 0) return;
        const done = doneBefore + partial.groupsProcessed;
        const left = partial.groupsTotal - partial.groupsProcessed;
        toastIfPossible(`Importing… ${done} program group(s), ${partial.eventsAdded} date(s) so far` +
          (left > 0 ? ` — about ${left} left` : ''));
      }
    });
    state.groupsProcessed += summary.groupsProcessed;
    state.eventsAdded += summary.eventsAdded;
    state.formsCreated += summary.formsCreated;
    state.formsReused += summary.formsReused;
    state.groupsFailed += summary.groupsFailed;
    log(`Bootstrap slice ${state.slices}: ${describeImportSummary(summary)}; ${summary.remaining} group(s) left.`);

    if (!summary.outOfTime) {
      finishBootstrap(state, null);
      return;
    }

    toastIfPossible(`Import chunk ${state.slices} done — ${state.groupsProcessed} program group(s) imported, ` +
      `${summary.remaining} to go. Next chunk starts in ${Math.round(BOOTSTRAP_RESUME_DELAY_MS / 1000)}s.`);

    // Still work to do. Guard against a group that can never succeed keeping
    // this going forever: no forward movement twice running ends it.
    const madeProgress = summary.groupsProcessed > 0 &&
      (state.lastRemaining === null || summary.remaining < state.lastRemaining);
    state.stalledSlices = madeProgress ? 0 : state.stalledSlices + 1;
    state.lastRemaining = summary.remaining;
    saveBootstrapState(state);

    if (state.stalledSlices >= BOOTSTRAP_MAX_STALLED_SLICES) {
      finishBootstrap(state, `stopped early — ${summary.remaining} group(s) could not be imported`);
      return;
    }

    armBootstrapResume(BOOTSTRAP_RESUME_DELAY_MS); // replaces the watchdog with a prompt hand-off
    log(`Bootstrap: handing off to the next slice in ${Math.round(BOOTSTRAP_RESUME_DELAY_MS / 1000)}s.`);
  } catch (err) {
    // An exception, unlike a timeout, is ours to handle: put the system back
    // together rather than leaving automation paused.
    log(`⚠️ Bootstrap slice failed (${err}) — restoring automation.`);
    noteForAdmin('Large-setup import', `The import stopped with an error and automation was restored: ${err}`);
    finishBootstrap(getBootstrapState() || state, `stopped by an error: ${err}`);
  } finally {
    flushPersistentRegistries(); // a killed slice's forms must never be forgotten
    lock.releaseLock();
  }
}

/**
 * Last slice: one dashboard render for everything imported, every trigger
 * back in place, state cleared. `problem` is null on a clean finish.
 */
function finishBootstrap(state, problem) {
  state = state || {};
  deleteBootstrapResumeTriggers();

  // Rendered while the bootstrap still counts as active, deliberately: that
  // is what keeps triageDeletedSessions() out of this render. Everything on
  // the session table was put there by the import that just ran, and a
  // half-read calendar at this exact moment must never be allowed to
  // conclude that all of it has been deleted.
  try {
    renderProgramDashboard(true);
  } catch (err) {
    log(`⚠️ Bootstrap: could not render the dashboard at the end (${err}) — the data is imported; re-run Sync Cal to redraw.`);
  }

  clearBootstrapState();

  try {
    // Swallow the import's own description edits before the calendar-edit
    // triggers go back on, or every one of the events just written becomes a
    // full syncCalendars() a moment later.
    primeCalendarSyncTokens('import');
    // force: this IS the restore, and the state was cleared just above — but
    // not relying on that ordering is what keeps automation from staying off.
    writeTriggers(true); // daily sync, hourly registrations, one calendar-edit trigger per calendar
  } catch (err) {
    // Automation staying paused is the one outcome worth shouting about.
    log(`⚠️ Bootstrap: could not restore the triggers (${err}) — run "Check Triggers" from the menu.`);
    noteForAdmin('Large-setup import',
      `The import finished but its triggers could not be restored (${err}). Run "Check Triggers" from the menu.`);
  }

  const totals = `${state.groupsProcessed || 0} program group(s), ${state.eventsAdded || 0} date(s), ` +
    `${state.formsCreated || 0} new form(s), ${state.formsReused || 0} existing form(s) reused` +
    (state.groupsFailed > 0 ? `, ${state.groupsFailed} failed` : '');
  const headline = problem
    ? `⚠️ Large-setup import ${problem}. Imported so far: ${totals}.`
    : `Large-setup import complete ✅ (${totals}, over ${state.slices || 1} run(s)).`;

  log(headline);
  if (problem) noteForAdmin('Large-setup import', headline);
  toastIfPossible(headline);
  flushAdminDigest('Large-setup import');
  log('Automation restored. Run "Sync Registrations" (or wait for the hourly trigger) to pull in any existing form responses.');
}

/**
 * Deletes the syncCalendars / syncRegistrations / onCalendarChange triggers
 * for the duration of the import. Idempotent by design — every slice calls
 * it, so a trigger that reappears mid-import survives at most one slice.
 */
const BOOTSTRAP_PAUSED_HANDLERS = ['syncCalendars', 'syncRegistrations', 'onCalendarChange'];

function pauseAutomationForBootstrap() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (BOOTSTRAP_PAUSED_HANDLERS.indexOf(t.getHandlerFunction()) === -1) return;
    ScriptApp.deleteTrigger(t);
    removed++;
  });
  if (removed > 0) {
    log(`Paused ${removed} trigger(s) for the duration of the import — finishBootstrap() puts them all back.`);
  }
  return removed;
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. */
function armBootstrapResume(delayMs) {
  deleteBootstrapResumeTriggers();
  ScriptApp.newTrigger(BOOTSTRAP_RESUME_HANDLER).timeBased().after(delayMs).create();
}

/**
 * DIAGNOSTIC — run from the Apps Script editor. Logs every trigger this
 * project currently has, plus whether an import is in flight.
 *
 * Use it when onCalendarChange executions keep appearing during an import.
 * There are only two explanations and this separates them:
 *
 *   - NO onCalendarChange trigger listed, yet executions keep arriving:
 *     Google is draining notifications it had already accepted for a channel
 *     that is being torn down. Nothing in this script can recall those. They
 *     cost one log line each (see onCalendarChange) and stop on their own.
 *   - onCalendarChange triggers ARE listed while an import is active:
 *     something re-created them. That is a bug worth chasing — check whether
 *     initSheet() or another project (a second copy of this script bound to
 *     the same calendars) is running.
 */
function logProjectTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const active = isBootstrapActive();
  log(`Project triggers (${triggers.length}) — large-setup import ${active ? 'IS' : 'is NOT'} currently active:`);
  triggers.forEach(t => {
    const source = t.getTriggerSourceId();
    log(`  • ${t.getHandlerFunction()}${source ? ` [${CALENDAR_MAP[source] || source}]` : ''}`);
  });
  if (active && triggers.some(t => t.getHandlerFunction() === 'onCalendarChange')) {
    log('⚠️ A calendar-edit trigger exists DURING an import — it should have been paused. ' +
      'Something re-created it; the next slice will remove it again.');
  }
  return triggers.length;
}

function deleteBootstrapResumeTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== BOOTSTRAP_RESUME_HANDLER) return;
    ScriptApp.deleteTrigger(t); // one-off triggers linger after firing; clear them out
    removed++;
  });
  return removed;
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops a sliced import and
 * puts automation back exactly as finishBootstrap() would. Whatever was
 * already imported stays imported; re-running bootstrapCalendars() picks up
 * from there.
 */
function cancelBootstrapCalendars() {
  if (!requireAuthorizedAdmin('Cancel Large-Setup Import')) return;
  const state = getBootstrapState();
  if (!state) {
    deleteBootstrapResumeTriggers();
    // NOT forced: with no import in flight there is nothing paused to
    // restore, so this is an ordinary "verify my triggers" and has to
    // respect trigger ownership like any other. Forcing here would let a
    // non-owner admin build a full set (and claim ownership) just by running
    // the escape hatch on a project that was working fine.
    writeTriggers();
    log('No large-setup import was running — triggers verified anyway.');
    return;
  }
  finishBootstrap(state, 'was cancelled');
}

/** Toasts when there's a UI to toast into (a trigger run has none) — never worth throwing over. */
function toastIfPossible(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Calendar & Form Manager', 8);
  } catch (err) {
    // Running from a trigger with no active spreadsheet UI — the log line stands on its own.
  }
}

/**
 * The registration line we inject into a calendar event description.
 *
 * It's an HTML anchor — Google Calendar renders a subset of HTML in
 * descriptions — so attendees see a short "Register for X" link instead of
 * a raw URL.
 *
 * The form ID rides along in the href's #fragment rather than as a visible
 * "[Form ID: ...]" tag. A fragment is never sent to the server and is
 * ignored by Forms, so it changes nothing for the person clicking it — but
 * it keeps the ID machine-recoverable, which is what lets
 * findExistingFormIdFromEvents() rebuild a lost form registry instead of
 * spawning duplicate forms.
 */
const REGISTRATION_LINK_FRAGMENT_KEY = 'form';

function buildRegistrationLinkLine(group, formInfo) {
  const label = group.isFixed
    ? `📝 Register for ${group.cleanTitle}`
    : `📝 Register for ${group.cleanTitle} — ${group.monthLabel}`;
  const href = `${formInfo.publishedUrl}#${REGISTRATION_LINK_FRAGMENT_KEY}=${formInfo.formId}`;
  return `<a href="${href}">${label}</a>`;
}

/** Matches our anchor, capturing (1) the URL without fragment and (2) the form ID. */
const REGISTRATION_ANCHOR_REGEX =
  new RegExp(`<a href="([^"#]*)#${REGISTRATION_LINK_FRAGMENT_KEY}=([a-zA-Z0-9_-]+)"[^>]*>.*?</a>`, 'i');
/** Pre-anchor format, still read so events stamped by older versions keep working. */
const LEGACY_REGISTRATION_LINE_REGEX = /^.*Registration Link:\s*(\S+)\s*\[Form ID:\s*([a-zA-Z0-9_-]+)\]\s*$/m;

/** Finds our registration line in a description in either format. Returns { url, formId, matchText } or null. */
function findRegistrationLineInDescription(description) {
  const anchor = REGISTRATION_ANCHOR_REGEX.exec(description);
  if (anchor) return { url: anchor[1], formId: anchor[2], matchText: anchor[0], isLegacy: false };
  const legacy = LEGACY_REGISTRATION_LINE_REGEX.exec(description);
  if (legacy) return { url: legacy[1], formId: legacy[2], matchText: legacy[0], isLegacy: true };
  return null;
}

function findExistingFormIdFromEvents(events) {
  for (const ev of events) {
    const found = findRegistrationLineInDescription(ev.getDescription() || '');
    if (!found) continue;
    try {
      FormApp.openById(found.formId);
      return found.formId;
    } catch (err) {
      log(`⚠️ Found a Form ID marker (${found.formId}) in an event description, but it could not be opened (${err}) — ignoring.`);
    }
  }
  return null;
}


// ============================================================================
// 4f. EVENT DESCRIPTIONS — stripping every registration link, then writing one
// ============================================================================
//
// findRegistrationLineInDescription() above finds the FIRST link in a
// description, which is all a normal sync needs. It is not enough for cleanup.
//
// Descriptions accumulate registration links. Google Calendar rewrites HTML in
// a description whenever the event is edited in the web UI, and an anchor that
// goes through that can come back out as a bare URL sitting next to the
// original — so one event ends up advertising the same form twice, in two
// formats. Older versions of this script wrote a different format again, and
// pasting an event to duplicate it copies whatever was there. A find-the-first
// -one-and-replace-it pass leaves every extra copy exactly where it was.
//
// So this section takes the other approach: remove EVERY registration link in
// a description, whatever shape it is in, then write back at most one. What it
// removes is deliberately limited to registration links and their orphaned
// labels — every other line, tag and bracket in the description is preserved
// byte for byte, because a description is also where staff keep room numbers,
// notes to volunteers, and the [Cap: N] / [Grouped] settings this system reads.
// ============================================================================

/** Every occurrence of our anchor format, not just the first. */
const REGISTRATION_ANCHOR_REGEX_GLOBAL =
  new RegExp(`<a[^>]*href="[^"]*#${REGISTRATION_LINK_FRAGMENT_KEY}=[a-zA-Z0-9_-]+"[^>]*>[\\s\\S]*?</a>`, 'gi');
/** Every occurrence of the pre-anchor "Registration Link: ... [Form ID: ...]" line. */
const LEGACY_REGISTRATION_LINE_REGEX_GLOBAL =
  /^.*Registration Link:\s*\S+\s*\[Form ID:\s*[a-zA-Z0-9_-]+\].*$/gim;
/** Any anchor pointing at a Google Form — the shape a mangled/duplicated link usually survives as. */
const ANY_FORMS_ANCHOR_REGEX = /<a[^>]*href="[^"]*docs\.google\.com\/forms\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
/** A bare Google Forms URL with no anchor around it — what Calendar leaves behind when it flattens one. */
const BARE_FORMS_URL_REGEX = /https?:\/\/docs\.google\.com\/forms\/\S*/gi;
/** An orphaned "📝 Register for ..." label, left when the anchor around it was flattened away. */
const ORPHAN_REGISTER_LABEL_REGEX = /^\s*📝\s*Register for .*$/gim;

/**
 * Removes every registration link from a description and reports how many
 * distinct ones it found.
 *
 * Order matters: the specific patterns run first so the count reflects real
 * registration links rather than the debris they leave behind, and the
 * catch-all forms-link patterns clean up whatever survived in a shape we no
 * longer recognize.
 *
 * WHAT IT WILL NOT TOUCH: anything that isn't a Google Forms link or one of
 * our own labels. Room numbers, volunteer notes, [Cap: 12], [Grouped], other
 * hyperlinks, blank lines between real paragraphs — all preserved. The one
 * thing it can over-reach on is a link to some OTHER Google Form that a person
 * put in a program event description by hand; on these calendars a forms link
 * is this system's link, and the confirmation dialog says so before anything
 * is written.
 */
function stripAllRegistrationLines(description) {
  const original = String(description || '');
  if (!original) return { text: '', removed: 0 };

  let removed = 0;
  const countAndClear = (text, regex) => text.replace(regex, () => { removed++; return ''; });

  let text = original;
  text = countAndClear(text, REGISTRATION_ANCHOR_REGEX_GLOBAL);
  text = countAndClear(text, LEGACY_REGISTRATION_LINE_REGEX_GLOBAL);
  text = countAndClear(text, ANY_FORMS_ANCHOR_REGEX);
  text = countAndClear(text, BARE_FORMS_URL_REGEX);
  // Labels are debris, not links — cleared, but never counted as a link found,
  // or an event with a flattened anchor would report two.
  text = text.replace(ORPHAN_REGISTER_LABEL_REGEX, '');

  return { text: tidyDescriptionWhitespace(text), removed };
}

/**
 * Closes up the hole left by removing a link, in both the formats a Google
 * Calendar description actually arrives in.
 *
 * Descriptions written by a person through the Calendar UI are HTML with
 * `<br>` as the line break; descriptions written by this script use real
 * newlines; and an event that has been through both has a mix. Removing a link
 * from either leaves a run of separators around the gap, so both are
 * collapsed: 3+ blank lines become one blank line, 3+ `<br>` become two, and
 * separators at the very start or end go entirely.
 *
 * Deliberately conservative — ONE blank line (or a `<br><br>`) between two
 * paragraphs is meaningful formatting somebody typed on purpose, and is kept.
 */
function tidyDescriptionWhitespace(text) {
  const BR_RUN = /(?:\s*<br\s*\/?>\s*){3,}/gi;
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => (line.replace(/<br\s*\/?>/gi, '').trim() === '' ? '' : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(BR_RUN, '<br><br>')
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/** Puts the registration link at the very top, above whatever else is there. */
function prependRegistrationLine(description, linkLine) {
  const body = tidyDescriptionWhitespace(description);
  return body ? `${linkLine}\n\n${body}` : linkLine;
}

/**
 * ADMIN ACTION — "🔗 Rewrite Event Links".
 *
 * Walks every UPCOMING event on every calendar, strips out every registration
 * link it can find (all formats, all duplicates), and then writes back exactly
 * one — or none — according to Config's "Registration Link in Events" setting.
 * The link always goes at the TOP of the description; everything else in the
 * description keeps its content and its order.
 *
 * ONLY UPCOMING EVENTS. A past event's description is a record of what people
 * were sent, and rewriting it changes nothing anyone will act on while
 * spending quota and — worse — generating a calendar notification for an event
 * that has already happened.
 *
 * The form for each event comes from the SESSION TABLE (Event_ID -> Form_ID),
 * not from the description being replaced. That's the point: the description
 * is the thing that is wrong, so it can't also be the source of truth for
 * what should replace it.
 *
 * CALENDAR-EDIT TRIGGERS ARE TAKEN DOWN FOR THE DURATION, exactly as
 * syncCalendarsInternal() does, and rebuilt in a `finally` so they come back
 * whether this succeeds or throws. This function's entire job is editing the
 * description of every upcoming event, and every one of those edits is a
 * calendar update — with the triggers live, a run over a few hundred events
 * queues a few hundred onCalendarChange executions, each of which can decide a
 * full syncCalendars() is warranted. That is the trigger storm this codebase
 * has been bitten by before; a cleanup pass is the single most efficient way
 * to cause it.
 *
 * primeCalendarSyncTokens() then swallows this run's own edits BEFORE the
 * triggers go back on, so the first delta check after the restore doesn't see
 * every event we just touched and start a sync anyway.
 */
function rewriteEventRegistrationLinks() {
  if (!requireAuthorizedAdmin('Rewrite Event Links')) return null;

  // A bootstrap has deliberately paused these triggers and will restore them
  // itself. Taking them down and putting them back underneath it would both
  // fight that and re-arm automation mid-import.
  if (isBootstrapActive()) {
    const message = 'A large-setup import or forms-rebuild sweep is running — try "Rewrite Event Links" once it finishes.';
    log(`rewriteEventRegistrationLinks: ${message}`);
    toastIfPossible(message);
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return null;
  }

  const showLinks = shouldShowLinkInDescription();
  const mode = getLinkDisplayMode();

  // Asked BEFORE the lock is taken: holding a script lock open while a modal
  // waits for a human is how a scheduled sync gets skipped for ten minutes
  // because somebody walked away from the dialog.
  if (!confirmConsequentialAction('Rewrite the registration link on every upcoming event?',
    `Config says "${mode}".\n\n` +
    'Every UPCOMING event on all program calendars will have every registration link removed — ' +
    'including duplicates and older formats — and then ' +
    (showLinks
      ? 'exactly one fresh link written at the top of its description.'
      : 'NO link written back, because the setting is "Hide link".') +
    '\n\nEverything else in each description (room notes, [Cap: N], [Grouped], other text) is kept ' +
    'exactly as it is. Past events are not touched.\n\n' +
    'Note: any link to a Google Form in these descriptions is treated as a registration link and removed.',
    false)) {
    return null;
  }

  // The same lock syncCalendars() takes. Both edit calendar descriptions and
  // both manage the calendar-edit triggers; overlapping them would have one
  // restore the triggers while the other is still writing.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('rewriteEventRegistrationLinks: a sync is already running — skipping this run.');
    toastIfPossible('A sync is already running — try again in a moment.');
    return null;
  }
  try {
    return rewriteEventRegistrationLinksInternal(registrySheet, showLinks);
  } finally {
    lock.releaseLock();
  }
}

/** The rewrite itself, inside the lock. See rewriteEventRegistrationLinks(). */
function rewriteEventRegistrationLinksInternal(registrySheet, showLinks) {
  // Event_ID -> what the session table says this event's form is.
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const sessionByEventId = {};
  readAllSectionedRows(registrySheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const d = coerceDate(row[map['Event_Date']]);
    if (!eventId || !d || formatDateKey(d) < todayKey) return;
    sessionByEventId[eventId] = {
      formId: String(row[map['Form_ID']] || '').trim(),
      cleanTitle: String(row[map['Clean_Title']] || '').trim(),
      isGrouped: isGroupedTypeTag(row[map['Type_Tag']]),
      date: d
    };
  });

  // computeSyncDateRange() starts at the 1st of the current month, so its
  // window includes events that have already happened. Fetch that window (it
  // is the one getCalendarEventsForWindow() caches, shared with every other
  // caller in the run) but only rewrite from today forward.
  const { start, end } = computeSyncDateRange();
  const windowStart = parseDateKey(todayKey);
  const eventsByCalendar = getCalendarEventsForWindow(start, end);

  const formInfoCache = {};
  const stats = {
    scanned: 0, linksRemoved: 0, rewritten: 0, cleared: 0, unchanged: 0,
    noForm: 0, calendarsSkipped: 0, triggersRemoved: 0, triggersRestored: 0
  };

  // EVERY description write below is a calendar update. Take the watchers down
  // first — see this function's header comment — and put them back in the
  // `finally`, so an exception halfway through can't leave the project with no
  // calendar-edit triggers at all.
  //
  // UNLESS SOMEBODY ELSE ALREADY DID. This function is also reached from
  // inside larger jobs that hold their own quiet window (Link Program Across
  // Locations, Move Sessions to Another Form). Restoring the triggers in the
  // middle of one of those would re-arm them for the rest of its work, which
  // is precisely the storm both are avoiding — so when nested, the outer
  // window owns the removal and the restore.
  const nestedInQuietWindow = calendarQuietWindowDepth > 0;
  stats.triggersRemoved = nestedInQuietWindow ? 0 : removeCalendarChangeTriggers();
  if (stats.triggersRemoved === 0 && !nestedInQuietWindow) {
    // Either there genuinely were none — normal on a workbook where "Check
    // Triggers" hasn't been run — or they belong to a DIFFERENT Google
    // account, in which case this account cannot see or delete them (see
    // writeTriggers()) and they will fire on every description written below.
    // Not fatal, and not worth refusing over, but it is exactly the situation
    // where a storm still happens after taking the precaution.
    log('ℹ️ Rewrite Event Links: no calendar-edit triggers to pause under this account. If another ' +
      'account created them, they are still live and will react to these edits — see the Triggers ' +
      'page in the Apps Script editor.');
  }
  try {
    Object.keys(CALENDAR_MAP).forEach(calendarId => {
      const events = eventsByCalendar[calendarId];
      if (!events) {
        log(`⚠️ Rewrite Event Links: "${CALENDAR_MAP[calendarId]}" could not be read — skipped.`);
        stats.calendarsSkipped++;
        return;
      }

      events.forEach(ev => {
        if (ev.isAllDayEvent()) return;
        const startTime = ev.getStartTime();
        if (startTime < windowStart) return; // past — left as the record it is
        const parsed = parseEventTitle(ev.getTitle());
        if (!parsed) return;

        stats.scanned++;
        const existing = ev.getDescription() || '';
        const stripped = stripAllRegistrationLines(existing);
        stats.linksRemoved += stripped.removed;

        let updated = stripped.text;
        if (showLinks) {
          const eventId = computeEventId(calendarId, parsed.cleanTitle, formatDateKey(startTime));
          const session = sessionByEventId[eventId];
          const formInfo = session && session.formId ? getFormInfoForLink(session.formId, formInfoCache) : null;
          if (!formInfo) {
            // No form on the session table (or it wouldn't open). The old links
            // still come off — a stale link to a form nobody is reading is worse
            // than none — but there is nothing correct to put back.
            stats.noForm++;
          } else {
            updated = prependRegistrationLine(stripped.text, buildRegistrationLinkLine({
              isFixed: session.isGrouped,
              cleanTitle: session.cleanTitle || parsed.cleanTitle,
              monthLabel: getMonthLabel(startTime)
            }, formInfo));
          }
        }

        if (updated === existing) { stats.unchanged++; return; }
        ev.setDescription(updated);
        if (showLinks && updated !== stripped.text) stats.rewritten++; else stats.cleared++;
      });
    });
  } finally {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    try {
      // Order matters, same as syncCalendarsInternal(): swallow this run's own
      // edits BEFORE the watchers come back on, or the first delta check after
      // the restore sees every event we just touched and starts a sync anyway.
      //
      // Skipped wholesale when nested: the outer quiet window primes and
      // restores once, around everything. (An `if`, not an early `return` —
      // returning from a `finally` would swallow whatever exception put us
      // here and discard this function's result.)
      if (!nestedInQuietWindow) {
        primeCalendarSyncTokens('link rewrite');
        // RESTORE ONLY, for the same reason syncCalendarsInternal() is —
        // rebuilding unconditionally here would CREATE a full set of
        // calendar-edit triggers under whichever admin ran this, and an admin
        // is not necessarily the trigger owner. That is how an invisible second
        // set gets made by someone doing nothing more suspicious than fixing
        // duplicate links. An account that held none a moment ago ends with
        // none; the log line above already told them why they might hold none.
        //
        // force: the bootstrap check happened at the top of the public entry
        // point, and automation staying off is the one outcome worth avoiding
        // more than a redundant rebuild.
        if (stats.triggersRemoved > 0 || isTriggerOwnerAccount()) {
          stats.triggersRestored = writeCalendarChangeTriggers(true).created;
        } else {
          log('Rewrite Event Links: calendar-edit triggers not restored — this account held none before the ' +
            'run and is not the recorded trigger owner. Creating them here would add a second, invisible set.');
        }
      }
    } catch (err) {
      // The loudest failure this function has. Silent automation is how "the
      // calendar stopped syncing" becomes a mystery two weeks later.
      log(`⚠️ Rewrite Event Links: could not restore the calendar-edit triggers (${err}) — run "Check Triggers".`);
      noteForAdmin('Calendar triggers not restored',
        `"Rewrite Event Links" finished but could not rebuild the calendar-edit triggers (${err}). ` +
        `Run "Check Triggers" from the Admin menu — until then, edits made directly on a calendar ` +
        `will not be picked up until the next daily sync.`);
      toastIfPossible('⚠️ Links rewritten, but the calendar-edit triggers could not be restored — run "Check Triggers".');
    }
  }

  const summary = `Event links rewritten ✅ — ${stats.scanned} upcoming event(s) scanned, ` +
    `${stats.linksRemoved} old link(s) removed, ${stats.rewritten} rewritten, ${stats.cleared} left with no link, ` +
    `${stats.unchanged} already correct; ${stats.triggersRestored} calendar-edit trigger(s) rebuilt` +
    (stats.noForm > 0 ? `, ⚠️ ${stats.noForm} with no form on the dashboard` : '') +
    (stats.calendarsSkipped > 0 ? `, ⚠️ ${stats.calendarsSkipped} calendar(s) unreadable` : '') + '.';
  log(`rewriteEventRegistrationLinks: ${summary}`);
  toastIfPossible(summary);

  if (stats.noForm > 0) {
    noteForAdmin('Events with no registration form',
      `${stats.noForm} upcoming event(s) had their old link(s) removed but no form on the session table to link to. ` +
      `Run Sync Cal to build their forms, then run "🔗 Rewrite Event Links" again.`);
  }
  flushAdminDigest('Rewrite event links');
  return stats;
}

/**
 * { formId, publishedUrl } for a form, memoized per run — the same form covers
 * a whole series, and opening it once per event would be the expensive part of
 * this by an order of magnitude. A form that won't open is cached as null so
 * it isn't retried on every one of its events either.
 */
function getFormInfoForLink(formId, cache) {
  if (Object.prototype.hasOwnProperty.call(cache, formId)) return cache[formId];
  let info = null;
  try {
    const form = FormApp.openById(formId);
    info = { formId, publishedUrl: buildRegistrationUrl(form) };
  } catch (err) {
    log(`⚠️ Could not open form ${formId} to rebuild its event link (${err}).`);
  }
  cache[formId] = info;
  return info;
}

/**
 * Reopens an already-existing form for a series/month and refreshes its
 * date-dependent items. Not-serving dates are excluded from the lunch grid
 * rows (see buildDateLabelSets()) but still appear on the Dates checkbox.
 */
function refreshFormForNewDates(formId, group, configInfo) {
  const form = FormApp.openById(formId);
  const sessions = sessionsOfGroup(group);
  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(sessions, { showLocation: group.isShared });

  form.setDescription(buildFormDescription(group.locations, allDateLabels, group.isFixed, lunchDateLabels.length > 0,
    { isClub: group.isClub, programTitle: group.cleanTitle }));
  // Re-asserted on every refresh, not only at creation: [Club] can be added to
  // (or taken off) a program's calendar events at any time, and the sign-up
  // options are the only place a respondent can act on that.
  applyAttendanceModeChoices(form, { isFixed: group.isFixed, isClub: group.isClub, programTitle: group.cleanTitle });

  // Catches a form that predates this location's policy being set to Never,
  // or predates the policy feature entirely, and re-checks whether the dates
  // now on the form serve lunch at all. Both directions are handled and both
  // are no-ops once the form already matches, so this is cheap on every
  // subsequent call.
  const questionsChanged = syncLunchQuestionsOnForm(form, group.locations, lunchDateLabels.length > 0);

  // Only ROWS are refreshed here — grid COLUMNS (the person labels) are the
  // same on every form and are set once at template-build time.
  applyFormDateLabels(formId, allDateLabels, lunchDateLabels,
    { form, force: questionsChanged > 0, context: 'new dates on an existing form' });

  return {
    formId: form.getId(),
    // Rebuilt here rather than reused: the grid rows just changed, and a
    // prefill URL encodes the exact rows it was generated against.
    publishedUrl: buildRegistrationUrl(form),
    editUrl: form.getEditUrl(),
    dateLabels: allDateLabels
  };
}

/** Creates a new per-group registration form by COPYING the one shared template. */
function createRegistrationForm(group, configInfo) {
  const baseTitle = group.isFixed
    ? `${group.cleanTitle} — Registration`
    : `${group.cleanTitle} - ${group.monthLabel}`;
  // A cross-location form sits in the same Drive folder as the per-location
  // ones and would otherwise be indistinguishable from them by name.
  const formTitle = group.isShared ? `${baseTitle} (${SHARED_LOCATION_TAG})` : baseTitle;

  // One template for everything now — the Attendance Mode fast path is on
  // every form, so Grouped and Monthly groups no longer need separate bases.
  const templateForm = getOrCreateTemplateForm();
  const copiedFile = DriveApp.getFileById(templateForm.getId()).makeCopy(formTitle, getOrCreateFormsFolder());
  const form = FormApp.openById(copiedFile.getId());
  form.setTitle(formTitle);

  try {
    form.setAcceptingResponses(true);
  } catch (err) {
    log(`⚠️ Could not confirm "accepting responses" on copied form "${formTitle}" (${err}).`);
  }
  try {
    if (typeof form.setPublished === 'function') form.setPublished(true);
  } catch (err) {
    log(`⚠️ Could not explicitly publish copied form "${formTitle}" (${err}) — copies are published by default in most accounts.`);
  }

  const sessions = sessionsOfGroup(group);
  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(sessions, { showLocation: group.isShared });

  form.setDescription(buildFormDescription(group.locations, allDateLabels, group.isFixed, lunchDateLabels.length > 0,
    { isClub: group.isClub, programTitle: group.cleanTitle }));
  applyAttendanceModeChoices(form, { isFixed: group.isFixed, isClub: group.isClub, programTitle: group.cleanTitle });

  // A form whose locations never cater — or none of whose dates serve lunch —
  // shouldn't be asking about lunch at all.
  syncLunchQuestionsOnForm(form, group.locations, lunchDateLabels.length > 0);

  // Only ROWS are set here — grid COLUMNS (the person labels) were already
  // baked into the template. force:true because a fresh copy still carries
  // the template's placeholder rows even though this brand-new form ID has
  // no fingerprint on file yet.
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels, { form, force: true, context: 'new form' });
  applyFormFooterNote(form, configInfo.footerNote);
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);

  return {
    formId: form.getId(),
    publishedUrl: buildRegistrationUrl(form), // prefilled all-checked when possible
    editUrl: form.getEditUrl(),
    dateLabels: allDateLabels
  };
}

/**
 * Attaches the per-location note to the "Anything Else?" question — as its
 * HELP TEXT, which is the line under the question title telling you what to
 * put in the box.
 *
 * Also removes any leftover standalone "Footer Note" section header from forms
 * built before v4, where the note lived as a bold heading of its own floating
 * above the last question with nothing under it (see addClosingQuestions()).
 * A form that has already been rebuilt has none, so the sweep costs nothing.
 */
function applyFormFooterNote(form, footerNote) {
  const removed = deleteFormItems(form,
    form.getItems().filter(it => it.getTitle() === LEGACY_FOOTER_ITEM_TITLE),
    `form ${form.getId()}`);
  if (removed > 0) invalidateFormItemIndex(form.getId());

  if (!footerNote) return;
  // Re-read: the deletions above shifted every item index on the form.
  form.getItems().filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES)
    .forEach(it => {
      try {
        it.asParagraphTextItem().setHelpText(footerNote);
      } catch (err) {
        log(`ℹ️ Could not set the footer note on form ${form.getId()} (${err}).`);
      }
    });
}

/**
 * Writes one session table row per session in `group`. Each row takes its
 * Location and Calendar_Source from the SESSION, not from the group — on a
 * cross-location group those differ from row to row, and everything
 * downstream (Event_IDs, lunch policy, the lunch dashboard, triage) keys off
 * the row rather than the form.
 */
function writeEventRegistryRows(registrySheet, group, formInfo) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const isUncapped = !group.capacity || group.capacity <= 0;

  const rows = group.sessions.map(session => {
    const ev = session.event;
    const startTime = ev.getStartTime();
    const dateKey = formatDateKey(startTime);
    const eventId = computeEventId(session.calendarId, group.cleanTitle, dateKey);
    const row = new Array(headers.length).fill('');

    row[map['Event_Date']] = startTime;
    row[map['Location']] = session.locationName;
    row[map['Clean_Title']] = group.cleanTitle;
    // Fallback only — renderProgramDashboard() always overwrites this with
    // a =TEXT(Event_Date,...) formula (see that function for why a formula
    // is required rather than a written time-like string).
    row[map['Event_Time']] = Utilities.formatDate(startTime, TIMEZONE, 'h:mm a');
    row[map['Type_Tag']] = group.typeTag;
    // Real checkbox columns: a boolean either way, never a blank. A blank cell
    // under a checkbox reads as "this row has no box", which is not what an
    // untagged program means — it means the box is there and unticked.
    row[map['Club']] = group.isClub ? CLUB_COLUMN_VALUE : false;
    row[map['No_Registration']] = group.noRegistration ? NO_REGISTRATION_COLUMN_VALUE : false;

    row[map['Max_Capacity']] = isUncapped ? '' : group.capacity;
    row[map['Active_Count']] = 0;
    row[map['Waitlist_Count']] = isUncapped ? '' : 0;
    row[map['Remaining_Seats']] = isUncapped ? '' : group.capacity;
    row[map['Status']] = isUncapped ? '🟢 Unlimited' : computeStatus(0, group.capacity);

    // formInfo is null for a [No Registration] group — there is no form to
    // link to, and the link columns say so in words rather than sitting empty.
    row[map['Form_Response_Link']] = formInfo
      ? makeHyperlinkFormula(formInfo.publishedUrl, 'View Live Form')
      : NO_REGISTRATION_LINK_LABEL;
    row[map['Edit_Form_Link']] = formInfo ? makeHyperlinkFormula(formInfo.editUrl, 'Edit Form Settings') : '';
    row[map['Form_ID']] = formInfo ? formInfo.formId : '';
    row[map['Calendar_Synced?']] = true;
    row[map['Event_ID']] = eventId;
    row[map['Calendar_Source']] = session.calendarId;
    return row;
  });

  if (rows.length > 0) {
    registrySheet.getRange(registrySheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
}

/** Moves any Lunch_and_Event_Registrants rows tied to a deleted event into the Triage tab. */
function moveRegistrantsToTriage(registrantsSheet, deletedEventInfo) {
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const allRows = readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const tMap = getIndexMap(HEADERS.Deleted_Event_Triage);
  const flaggedNow = new Date();

  const keepRows = [];
  const newTriageRows = [];

  allRows.forEach(row => {
    const eventId = row[map['Event_ID']];
    const info = deletedEventInfo[eventId];
    if (!info) { keepRows.push(row); return; }

    const triageRow = new Array(HEADERS.Deleted_Event_Triage.length).fill('');
    headers.forEach(h => { if (tMap[h] !== undefined) triageRow[tMap[h]] = row[map[h]]; });
    triageRow[tMap['Deleted_Event_Title']] = info.cleanTitle;
    triageRow[tMap['Deleted_Event_Location']] = info.location;
    triageRow[tMap['Flagged_Date']] = flaggedNow;
    triageRow[tMap['Triage_Notes']] = 'Original calendar event no longer found during sync — please confirm with the registrant.';
    newTriageRows.push(triageRow);
  });

  if (newTriageRows.length === 0) return;

  renderRegistrantsSheet(false, keepRows);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triageSheet = getOrCreateSheet(ss, SHEET_NAMES.TRIAGE);
  const existingTriageRows = readAllSectionedRows(triageSheet, HEADERS.Deleted_Event_Triage, 'Event_ID');
  renderTriageSheet(false, existingTriageRows.concat(newTriageRows));

  log(`Moved ${newTriageRows.length} registrant row(s) to "${SHEET_NAMES.TRIAGE}".`);
  Object.keys(deletedEventInfo).forEach(eventId => {
    const info = deletedEventInfo[eventId];
    noteForAdmin('Deleted events sent to triage',
      `${info.cleanTitle} (${info.location}) — its calendar event is gone; registrants need confirming.`);
  });
}

/**
 * The inverse of moveRegistrantsToTriage(): puts triaged rows back on
 * Lunch_and_Event_Registrants for every session that is on the dashboard
 * again.
 *
 * Needed because a triage sweep is not recoverable from the forms. The import
 * only ever reads responses newer than the last sync, so a registration that
 * was already imported and then triaged exists nowhere else — moving the row
 * back IS the recovery. Rows for sessions that are still gone are left in
 * triage, and an identity already present on the Registrants tab is dropped
 * rather than duplicated.
 *
 * Run from the Apps Script editor. Returns the number of rows restored.
 */
function restoreTriagedRegistrants() {
  if (!requireAuthorizedAdmin('Restore Triaged Registrants')) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triageSheet = ss.getSheetByName(SHEET_NAMES.TRIAGE);
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!triageSheet || !registrySheet) {
    log('restoreTriagedRegistrants: no triage tab or no dashboard — nothing to do.');
    return 0;
  }

  const triageHeaders = HEADERS.Deleted_Event_Triage;
  const regHeaders = HEADERS.Lunch_and_Event_Registrants;
  const tMap = getIndexMap(triageHeaders);
  const rMap = getIndexMap(regHeaders);

  const sessionRows = readAllSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const sessionMap = getIndexMap(HEADERS.Master_Program_Dashboard);
  const liveEventIds = new Set(sessionRows.map(row => row[sessionMap['Event_ID']]).filter(Boolean));
  if (liveEventIds.size === 0) {
    log('restoreTriagedRegistrants: the session table is empty — import the calendar first, then run this again.');
    return 0;
  }

  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const registrantRows = readAllSectionedRows(registrantsSheet, regHeaders, 'Event_ID');
  const present = new Set(registrantRows.map(row =>
    `${row[rMap['Event_ID']]}|${normalizeNameKey(row[rMap['Name']])}|${row[rMap['Person_Type']]}`));

  const triageRows = readAllSectionedRows(triageSheet, triageHeaders, 'Event_ID');
  const stayInTriage = [];
  const restored = [];

  triageRows.forEach(row => {
    const eventId = row[tMap['Event_ID']];
    if (!eventId || !liveEventIds.has(eventId)) { stayInTriage.push(row); return; }

    const key = `${eventId}|${normalizeNameKey(row[tMap['Name']])}|${row[tMap['Person_Type']]}`;
    if (present.has(key)) {
      log(`restoreTriagedRegistrants: ${row[tMap['Name']]} is already on the Registrants tab for this session — dropping the triaged copy.`);
      return;
    }

    // Triage is a superset of the registrant layout, so this copies by name.
    const restoredRow = new Array(regHeaders.length).fill('');
    regHeaders.forEach(h => { if (tMap[h] !== undefined) restoredRow[rMap[h]] = row[tMap[h]]; });
    const notes = String(restoredRow[rMap['Admin_Notes']] || '').trim();
    const stamp = `Restored from ${SHEET_NAMES.TRIAGE} on ${Utilities.formatDate(new Date(), TIMEZONE, 'M/d/yyyy')}.`;
    restoredRow[rMap['Admin_Notes']] = notes ? `${notes} | ${stamp}` : stamp;
    present.add(key);
    restored.push(restoredRow);
  });

  if (restored.length === 0) {
    log('restoreTriagedRegistrants: nothing in triage belongs to a session that is back.');
    return 0;
  }

  renderRegistrantsSheet(false, registrantRows.concat(restored));
  renderTriageSheet(false, stayInTriage);
  log(`restoreTriagedRegistrants: put ${restored.length} row(s) back on "${SHEET_NAMES.LUNCH_EVENT_REGISTRANTS}"; ` +
    `${stayInTriage.length} row(s) stay in triage (their session is still missing).`);
  toastIfPossible(`Restored ${restored.length} registrant row(s) from triage ✅`);
  return restored.length;
}

function backInjectCalendarDescriptions(group, formInfo) {
  // Config decides whether a link belongs in a description at all. Checked
  // here as well as in rewriteEventRegistrationLinks(), or the next sync would
  // simply put back every link that cleanup just removed.
  if (!shouldShowLinkInDescription()) {
    let cleared = 0;
    group.events.forEach(ev => {
      const existing = ev.getDescription() || '';
      const stripped = stripAllRegistrationLines(existing);
      if (stripped.removed === 0 || stripped.text === existing) return;
      ev.setDescription(stripped.text);
      cleared++;
    });
    if (cleared > 0) {
      log(`Link display is "${LINK_DISPLAY_OPTIONS.HIDE}" — removed the registration link from ${cleared} event(s) of "${group.cleanTitle}".`);
    }
    return;
  }

  const linkLine = buildRegistrationLinkLine(group, formInfo);

  group.events.forEach(ev => {
    const existing = ev.getDescription() || '';
    const found = findRegistrationLineInDescription(existing);

    // Already current, in the current format, and already at the top — leave
    // the event alone rather than burning a write (and a notification) on
    // every sync.
    if (found && !found.isLegacy && found.url === formInfo.publishedUrl &&
      found.formId === formInfo.formId && existing.indexOf(linkLine) === 0) {
      return;
    }

    // Otherwise rebuild: every link out (duplicates included — see
    // stripAllRegistrationLines), one back in AT THE TOP. Replacing in place
    // was what let a second, mangled copy sit in a description untouched
    // forever, since the first match was always the one that got corrected.
    const updated = prependRegistrationLine(stripAllRegistrationLines(existing).text, linkLine);
    if (updated !== existing) ev.setDescription(updated);
  });
}


// ============================================================================
// 5. REGISTRATION IMPORT & WAITLISTING  (syncRegistrations)
// ============================================================================

function getLastSyncTime() {
  const stored = PropertiesService.getScriptProperties().getProperty(LAST_SYNC_PROP_KEY);
  return stored ? new Date(stored) : new Date(0);
}

function setLastSyncTime(date) {
  PropertiesService.getScriptProperties().setProperty(LAST_SYNC_PROP_KEY, date.toISOString());
}

function syncRegistrations() {
  if (!automationGateAllows('Sync Registrations')) return;
  recordHandlerRun('syncRegistrations');

  if (isBootstrapActive()) {
    log(`syncRegistrations: a large-setup import or forms-rebuild sweep is writing to the session table — skipping this run.`);
    return;
  }

  // THE SAME LOCK syncCalendars() takes, and for a sharper reason. This
  // function reads every registrant row, adds to them in memory, and writes
  // the whole tab back. Two overlapping runs — the hourly trigger and someone
  // pressing the menu item, which is exactly what people do when they are
  // waiting for a registration to appear — both read the same "before"
  // picture, and whichever finishes last overwrites the other's new rows with
  // its own. The registrations are not re-read afterwards either: getResponses()
  // is bounded by LAST_FORM_SYNC_TIME, which the losing run has already
  // advanced. So the rows are simply gone until someone notices a name is
  // missing.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('syncRegistrations: another sync is already running — skipping this run.');
    toastIfPossible('Another sync is already running — try again in a moment.');
    return;
  }
  try {
    syncRegistrationsInternal();
  } finally {
    lock.releaseLock();
  }
}

function syncRegistrationsInternal() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);

  const lastSync = getLastSyncTime();
  const syncStartedAt = new Date();
  const orderAheadDays = getOrderAheadDays();

  // One read of each tab up front; both registry-derived structures below
  // are built from the same rows rather than scanning the sheet twice.
  const sessionRows = readAllSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registryIndex = buildRegistryIndex(registrySheet, sessionRows);
  const existingRows = readAllSectionedRows(registrantsSheet, HEADERS.Lunch_and_Event_Registrants, 'Event_ID');
  const protectedKeys = getProtectedRegistrantKeys(existingRows);
  const existingRowIndex = getExistingRegistrantIndex(existingRows);

  const formIds = getDistinctFormIds(registrySheet, sessionRows);
  const newRows = [];
  // Club joins are gathered across every response and written to the roster
  // ONCE, below — a tab rewrite per submission would be both slow and, on a
  // busy sync, a lot of re-reads of a tab we are in the middle of changing.
  const collectors = { clubJoins: [] };

  formIds.forEach(formId => {
    let form;
    try {
      form = FormApp.openById(formId);
    } catch (err) {
      log(`⚠️ Could not open form ${formId}: ${err}`);
      // Worth an admin's attention: a form we can't open is one whose
      // registrations are silently not being imported.
      noteForAdmin('Forms that could not be opened', `${formId} — ${err}`);
      return;
    }

    const responses = form.getResponses(lastSync);
    if (responses.length === 0) return; // don't pay for an item index on a form with nothing new
    const formIndex = getFormItemIndex(form); // ONE getItems() round trip for every response on this form
    responses.forEach(response => {
      const rowsForResponse = processFormResponse(formIndex, response, registryIndex, protectedKeys,
        existingRowIndex, orderAheadDays, collectors);
      newRows.push(...rowsForResponse.filter(Boolean));
    });
  });

  flushPersistentRegistries(); // one write for every all-dates entry recorded above

  // The roster is updated BEFORE the catch-up below reads it, so somebody who
  // joined a club in this very sync is booked into its sessions on the same
  // run rather than waiting an hour for the next one.
  upsertClubMembers(collectors.clubJoins);

  // Deliberately AFTER the import loop above: bringing a form built on an
  // older template up to date replaces its questions, and a response that
  // hadn't been imported yet would lose its answers with them.
  migrateFormsToCurrentTemplate(registrySheet, sessionRows);

  // Catch up "sign up for all dates" registrants on Grouped-series forms
  // whose date list has grown since they originally registered.
  applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows);

  // ...and club members onto every upcoming session of their club, whichever
  // form now covers it. This is the step that makes a membership outlive the
  // form it was created on — see applyClubRosterCatchup().
  applyClubRosterCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows);

  const combinedRegistrantRows = existingRows.concat(newRows);
  renderRegistrantsSheet(false, combinedRegistrantRows);

  // combinedRegistrantRows IS what was just written to the Registrants tab,
  // so every consumer below can work from it instead of re-reading — except
  // where renderProgramDashboard()'s triage pass rewrites the tab, which it
  // reports back via registrantsMoved.
  recomputeEventRegistryCounts(registrySheet, registrantsSheet, combinedRegistrantRows);
  refreshFormCapacityLabelsForAllForms(registrySheet);

  const dashboardResult = renderProgramDashboard(false, { registrantRows: combinedRegistrantRows });
  const reusableRows = dashboardResult.registrantsMoved ? null : combinedRegistrantRows;
  updateMasterLunchDashboard(reusableRows);
  refreshMemoryTabs(reusableRows, null);
  renderClubMembersSheet(refreshClubMemberLabels(sessionRows));

  // LAST, on purpose: this is the only step that reaches outside the workbook
  // to other people, and it should act on the settled picture rather than on
  // rows a later step might still cancel or supersede. Guarded by its own
  // Config switch and a no-op when nothing changed — see section 5b.
  try {
    inviteRegistrantsToCalendarEvents(sessionRows, reusableRows);
  } catch (err) {
    log(`⚠️ Could not send calendar invitations this run (${err}) — the registrations themselves are fine.`);
  }

  flushPersistentRegistries();
  setLastSyncTime(syncStartedAt);
  flushAdminDigest('Registration sync'); // no-op unless something above actually needed attention
  toastIfPossible(`Registration sync complete ✅ — ${newRows.length} new row(s), ` +
    `${combinedRegistrantRows.length} registrant row(s) total.`);
}

function getDistinctFormIds(registrySheet, sessionRows) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const values = rows.map(row => row[map['Form_ID']]);
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * Maps "Form_ID|Plain Session Label" -> { eventId, maxCapacity, eventDate,
 * location, cleanTitle }. The label is exactly what a grid row on that form
 * says once its meal/capacity hints are stripped (formatSessionLabel() /
 * stripMealHint()) — including the location on a cross-location form, which
 * is what keeps two sites' sessions on the same date resolving to two
 * different registry entries instead of one.
 */
function buildRegistryIndex(registrySheet, sessionRows) {
  const index = {};
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const labelOptionsByForm = buildLabelOptionsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const eventDateRaw = row[map['Event_Date']];
    if (!formId || !eventDateRaw) return;
    const eventDate = coerceDate(eventDateRaw);
    if (!eventDate) return;
    const location = row[map['Location']] || '';
    const cleanTitle = row[map['Clean_Title']] || '';
    const opts = labelOptionsByForm[formId] || {};
    const label = formatSessionLabel(eventDate, location, opts.showLocation, cleanTitle, opts.showTitle);
    const isClub = isClubColumnValue(row[map['Club']]);
    index[`${formId}|${label}`] = {
      formId,
      eventId: row[map['Event_ID']],
      maxCapacity: Number(row[map['Max_Capacity']]) || 0,
      eventDate,
      location,
      cleanTitle,
      isClub,
      // A club's roster is keyed by the PROGRAM, which is why this is computed
      // per session rather than per form — see computeClubKey().
      clubKey: isClub ? computeClubKey(cleanTitle, location, sharedFormIds.has(formId)) : ''
    };
  });
  return index;
}

/**
 * Normalizes a name for IDENTITY purposes only (dedup / manual-edit
 * protection / the "sign up for all dates" registry) — "Jane Smith" and
 * "jane smith " are the same person. Display values (the Name column
 * itself) always keep the original, as-typed casing/spacing.
 */
function normalizeNameKey(name) {
  return String(name || '').trim().toLowerCase();
}

/** Keys (Event_ID|normalized Name|Person_Type) for rows marked Manually Edited OR Manually Added. */
function getProtectedRegistrantKeys(rows) {
  const map = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  const set = new Set();
  rows.forEach(row => {
    const override = String(row[map['Manual_Override']]).trim();
    if (override === 'Manually Edited' || override === 'Manually Added') {
      set.add(`${row[map['Event_ID']]}|${normalizeNameKey(row[map['Name']])}|${row[map['Person_Type']]}`);
    }
  });
  return set;
}

/**
 * Map of (Event_ID|normalized Name|Person_Type) -> that row's live array,
 * for every currently-present row (Superseded ones included — a further
 * resubmission still needs to find and re-supersede the CURRENT row, not
 * pile up duplicates). buildRegistrantRow() uses this both to skip true
 * duplicate imports and to locate the row a resubmission should patch or
 * supersede.
 */
function getExistingRegistrantIndex(rows) {
  const map = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  const index = new Map();
  rows.forEach(row => index.set(`${row[map['Event_ID']]}|${normalizeNameKey(row[map['Name']])}|${row[map['Person_Type']]}`, row));
  return index;
}

/**
 * Pulls a named item's response value out of a FormResponse. Checks ALL
 * items sharing that title (a given title appears on several branch-specific
 * pages) and returns the first one that was actually part of this
 * respondent's path.
 *
 * Takes a formIndex from getFormItemIndex() rather than a Form: this used
 * to call form.getItems() — a REMOTE call — on every single lookup, and
 * processFormResponse() makes about ten lookups per response.
 */
function getResponseValueByTitle(formIndex, response, title) {
  const items = formIndex.byTitle[title] || [];
  for (const item of items) {
    // A PAGE_BREAK can share a question's title on a form built before that
    // collision was fixed (see TEMPLATE_PAGE_TITLES.MODE), and asking for a
    // response to a page break is meaningless at best. Skip rather than let a
    // stray page title decide what a respondent answered.
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) continue;
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const val = itemResponse.getResponse();
    if (val === null || val === undefined || val === '') continue;
    if (Array.isArray(val) && val.length === 0) continue;
    return val;
  }
  return '';
}

/**
 * Same "check every branch page, return whichever instance was actually
 * part of this respondent's path" approach as getResponseValueByTitle(),
 * but for a checkbox-grid item (ATTENDANCE_GRID / LUNCH_GRID): returns
 * { rows, columns, values }, where values[rowIdx] is the array of checked
 * column labels for that row. Returns null if the title never had a real
 * answer (shouldn't happen for ATTENDANCE_GRID since every branch has one,
 * but LUNCH_GRID is legitimately absent whenever the response predates this
 * form structure or every date on the form is "Not Serving").
 *
 * getRows()/getColumns() are themselves remote calls, so the resolved grid
 * is memoized on the formIndex — every response on a form shares one read.
 */
function getGridResponseByTitle(formIndex, response, title) {
  const items = formIndex.byTitle[title] || [];
  if (!formIndex.gridShapeByItemId) formIndex.gridShapeByItemId = {};
  for (const item of items) {
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const values = itemResponse.getResponse();
    if (!values || !Array.isArray(values)) continue;
    const itemId = item.getId();
    let shape = formIndex.gridShapeByItemId[itemId];
    if (!shape) {
      const grid = item.asCheckboxGridItem();
      shape = { rows: grid.getRows(), columns: grid.getColumns() };
      formIndex.gridShapeByItemId[itemId] = shape;
    }
    return { rows: shape.rows, columns: shape.columns, values };
  }
  return null;
}

/**
 * Combines the Allergies/Dietary text answer with the "Anything Else?"
 * catch-all into one Admin_Notes string. The Footer Note is a display-only
 * SectionHeaderItem now (see getOrCreateTemplateForm()) so it never shows up
 * here — previously a single paragraph item did double duty as both the
 * static per-location note AND the admin-notes scan target, which meant a
 * respondent could never actually see their own note echoed back to them
 * separately from a genuine "anything else" answer.
 */
function getAdminNotesResponse(formIndex, response) {
  const allergies = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALLERGIES) || '').trim();

  let notes = '';
  for (const item of formIndex.paragraphItems) {
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const val = String(itemResponse.getResponse() || '').trim();
    if (val) { notes = val; break; }
  }

  const parts = [];
  if (allergies) parts.push(`Allergies/Dietary: ${allergies}`);
  if (notes) parts.push(notes);
  return parts.join(' | ');
}

/**
 * Resolves the people on one submission from the name fields alone. There
 * is no guest-count question any more: the headcount IS how many guest
 * name fields were filled in, which makes the old "said 3, named 2,
 * catered for 2" mismatch structurally impossible.
 *
 * Returned in PERSON_COLUMN_LABELS order, and a guest whose name was left
 * blank produces NO entry — so a stray check in that guest's grid column
 * (they're all pre-checked) is correctly ignored rather than inventing a
 * nameless person.
 */
function resolvePeopleOnResponse(formIndex, response, registrantName, adminNotes) {
  const people = [{
    name: registrantName, personType: 'Attendee', primaryRegistrant: 'Self',
    columnLabel: PERSON_COLUMN_LABELS[0], baseNotes: adminNotes
  }];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    const guestName = String(getResponseValueByTitle(formIndex, response, `Guest ${g} Name`) || '').trim();
    if (!guestName) continue;
    people.push({
      name: guestName, personType: 'Guest', primaryRegistrant: registrantName,
      columnLabel: PERSON_COLUMN_LABELS[g], baseNotes: ''
    });
  }
  return people;
}

function processFormResponse(formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays, collectors) {
  const form = formIndex.form;
  const name = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.NAME) || 'Unknown').trim();
  const phone = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.PHONE) || '').trim();
  const email = getRespondentEmail(response);
  const adminNotes = getAdminNotesResponse(formIndex, response);
  // Points at this specific submission (requires setAllowResponseEdits(true)
  // on the template — see getOrCreateTemplateForm()), not the shared form editor.
  const responseEditUrl = response.getEditResponseUrl();
  const submittedAt = response.getTimestamp();
  const partyId = response.getId();

  const people = resolvePeopleOnResponse(formIndex, response, name, adminNotes);
  const partySize = people.length;

  const attendanceMode = getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE);
  const joiningClub = isClubModeAnswer(attendanceMode);
  if (joiningClub || isAllDatesModeAnswer(attendanceMode)) {
    return processAllDatesResponse({
      formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
      name, people, adminNotes, responseEditUrl, submittedAt, partyId, partySize,
      phone, email, joiningClub, collectors
    });
  }

  // Specific-dates path. Two roster grids: ATTENDANCE_GRID's rows are every
  // date on the form, LUNCH_GRID's rows are only the lunch-eligible ("not
  // Not-Serving") subset — see buildDateLabelSets().
  const attendanceGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID);
  const lunchGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.LUNCH_GRID);
  if (!attendanceGrid) return [];

  const rows = [];
  attendanceGrid.rows.forEach((dateLabel, rowIdx) => {
    const plainDateLabel = stripMealHint(dateLabel);
    const registryEntry = registryIndex[`${form.getId()}|${plainDateLabel}`];
    if (!registryEntry) {
      log(`⚠️ No Master_Program_Dashboard match for form ${form.getId()} / ${plainDateLabel}`);
      return;
    }

    const attendingCols = attendanceGrid.values[rowIdx] || [];
    const lunchRowIdx = lunchGrid ? lunchGrid.rows.findIndex(r => stripMealHint(r) === plainDateLabel) : -1;
    const lunchCols = (lunchGrid && lunchRowIdx >= 0) ? (lunchGrid.values[lunchRowIdx] || []) : [];

    people.forEach(person => {
      const isAttending = attendingCols.indexOf(person.columnLabel) !== -1;
      const wantsLunch = lunchCols.indexOf(person.columnLabel) !== -1;
      if (!isAttending && !wantsLunch) return; // this person didn't check anything for this date — no row

      let notes = person.baseNotes || '';
      if (!isAttending && wantsLunch) {
        // Reconcile rather than silently drop: a checked lunch box implies
        // attendance even if that same date wasn't also checked in the
        // attendance grid. Flag it for staff instead of guessing quietly.
        const flag = `⚠️ Checked lunch without attendance for ${plainDateLabel} — reconciled as attending.`;
        notes = notes ? `${notes} | ${flag}` : flag;
        log(`Reconciliation: ${person.name} checked "${TEMPLATE_ITEM_TITLES.LUNCH_GRID}" without "${TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID}" for ${plainDateLabel} on form ${form.getId()} — treating as attending.`);
      }

      rows.push(buildRegistrantRow({
        registryEntry, name: person.name, personType: person.personType,
        lunchType: wantsLunch ? 'Yes - Lunch' : 'No Lunch', primaryRegistrant: person.primaryRegistrant,
        adminNotes: notes, formEditUrl: responseEditUrl, protectedKeys, existingRowIndex, submittedAt, orderAheadDays,
        partyId, partySize,
        // Contact details belong to the SUBMISSION, so a named guest carries
        // the same ones — they arrived together, and the printed sign-in sheet
        // and any calendar invite need a way to reach each row's party.
        phone, email
      }));
    });
  });

  return rows.filter(Boolean);
}

/**
 * Handles a Grouped-series form submitted via "Sign up for all dates": one
 * lunch choice per person is applied to EVERY current session date on the
 * form (matchingEntries), and each person is recorded in the persistent
 * ALL_DATES registry so future syncRegistrations() runs can retroactively
 * add rows for any dates added to the series afterward (see
 * applyAllDatesCatchup()).
 */
function processAllDatesResponse(args) {
  const {
    formIndex, response, registryIndex, protectedKeys, existingRowIndex, orderAheadDays,
    people, adminNotes, responseEditUrl, submittedAt, partyId, partySize,
    phone, email, joiningClub, collectors
  } = args;

  // A single checkbox of PERSON_COLUMN_LABELS: who eats, applied to every
  // date. Checked-but-unnamed columns are already filtered out, since
  // `people` only contains rows for guests who were actually named.
  const eaters = getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE) || [];
  const eaterSet = new Set(Array.isArray(eaters) ? eaters : [eaters]);

  const formId = formIndex.formId;
  const matchingEntries = Object.keys(registryIndex).filter(k => k.startsWith(`${formId}|`)).map(k => registryIndex[k]);

  // Which club(s) this form's sessions belong to, if any — a combined form can
  // legitimately carry more than one, so enrollment follows the SESSION rather
  // than the form. Only reached when the respondent chose the club option.
  const clubsOnForm = {};
  if (joiningClub) {
    matchingEntries.forEach(entry => {
      if (!entry.isClub || !entry.clubKey) return;
      if (!clubsOnForm[entry.clubKey]) {
        clubsOnForm[entry.clubKey] = { clubKey: entry.clubKey, title: entry.cleanTitle, location: entry.location };
      }
    });
  }

  const rows = [];
  people.forEach(person => {
    const lunchType = eaterSet.has(person.columnLabel) ? 'Yes - Lunch' : 'No Lunch';
    saveAllDatesRegistryEntry(formId, {
      name: person.name, personType: person.personType, lunchType,
      primaryRegistrant: person.primaryRegistrant, adminNotes: person.baseNotes || '',
      formEditUrl: responseEditUrl, submittedAt: submittedAt.toISOString(), partyId, partySize,
      phone: phone || '', email: email || ''
    });

    // The club half. Recorded per person, not per submission: a party of three
    // joining a club is three memberships, each of which staff can end on its
    // own (the guest who stops coming, the member who doesn't).
    Object.keys(clubsOnForm).forEach(clubKey => {
      const club = clubsOnForm[clubKey];
      (collectors && collectors.clubJoins ? collectors.clubJoins : []).push({
        clubKey,
        club: club.title,
        location: club.location,
        name: person.name,
        personType: person.personType,
        primaryRegistrant: person.primaryRegistrant,
        phone: phone || '',
        email: email || '',
        lunchType,
        source: 'Registration form'
      });
    });

    matchingEntries.forEach(registryEntry => {
      rows.push(buildRegistrantRow({
        registryEntry, name: person.name, personType: person.personType, lunchType,
        primaryRegistrant: person.primaryRegistrant, adminNotes: person.baseNotes || '', formEditUrl: responseEditUrl,
        protectedKeys, existingRowIndex, submittedAt, orderAheadDays, partyId, partySize,
        phone, email
      }));
    });
  });
  return rows.filter(Boolean);
}

/**
 * The respondent's own email address, which Forms collects because the
 * template sets setCollectEmail(true). Wrapped because getRespondentEmail()
 * returns '' rather than throwing on a form where collection is off, and
 * because a malformed address is worth dropping here rather than at the point
 * where it becomes a calendar invitation.
 */
function getRespondentEmail(response) {
  let raw = '';
  try {
    raw = String(response.getRespondentEmail() || '').trim();
  } catch (err) {
    return '';
  }
  return isPlausibleEmail(raw) ? raw : '';
}

/** A minimal sanity check — enough to keep obvious junk out of a guest list. */
function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/**
 * Runs every registration sync: for every form with "all dates" registrants
 * on file, checks whether any of the form's CURRENT session dates are
 * missing a row for that person, and fills them in — this is what makes
 * "all dates" keep meaning "every date," including ones added to an
 * ongoing Grouped series after the original registration.
 */
function applyAllDatesCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows) {
  const registry = getAllDatesRegistry();
  Object.keys(registry).forEach(formId => {
    const matchingEntries = Object.keys(registryIndex).filter(k => k.startsWith(`${formId}|`)).map(k => registryIndex[k]);
    if (matchingEntries.length === 0) return;
    registry[formId].forEach(entry => {
      matchingEntries.forEach(registryEntry => {
        const row = buildRegistrantRow({
          registryEntry, name: entry.name, personType: entry.personType, lunchType: entry.lunchType,
          primaryRegistrant: entry.primaryRegistrant, adminNotes: entry.adminNotes || '',
          formEditUrl: entry.formEditUrl, protectedKeys, existingRowIndex,
          submittedAt: new Date(entry.submittedAt), orderAheadDays,
          partyId: entry.partyId || '', partySize: entry.partySize || '',
          phone: entry.phone || '', email: entry.email || ''
        });
        if (row) newRows.push(row);
      });
    });
  });
}

/**
 * Marks an existing registrant row as no longer current, WITHOUT deleting
 * it — so staff can see a change actually happened rather than the row
 * just vanishing. Applied when a genuinely different submission (a
 * different Party_ID) shows up for the same Event_ID+Name+Person_Type.
 */
function supersedeRegistrantRow(row, map, supersededAt) {
  if (row[map['Program_Status']] === 'Superseded') return; // already marked by an earlier resubmission this pass
  row[map['Program_Status']] = 'Superseded';
  row[map['Lunch_Status']] = 'Superseded';
  const note = `Superseded by a newer submission on ${Utilities.formatDate(supersededAt, TIMEZONE, 'M/d/yyyy h:mm a')}.`;
  const existingNotes = String(row[map['Admin_Notes']] || '').trim();
  row[map['Admin_Notes']] = existingNotes ? `${existingNotes} | ${note}` : note;
}

/**
 * Resolves what actually gets STORED in a registrant row's Lunch_Type
 * column: the day's real Hot/Cold designation (from Lunch_Schedule, via
 * registryEntry's own date+location) for anyone who wants lunch, 'No Lunch'
 * for anyone who doesn't. Never returns the raw form answer verbatim — a
 * person's lunch type is Hot or Cold, matching Lunch_Schedule's own
 * vocabulary, not a restatement of whether they said yes.
 *
 * Resolved ONCE at row-creation/patch time and never revisited — like
 * Order_Ahead_Flag, it's a fact about what Lunch_Schedule said when this
 * row was written, not something that should drift if the menu changes
 * later. If no Hot/Cold row exists yet for that date, this returns '' —
 * still correctly counted as Needed (see lunchStatus below, which is
 * derived from wantsLunch directly, never from this string) and already
 * surfaced separately by buildDashboardRollup()'s "no menu set" admin note.
 */
function resolveRegistrantLunchType(wantsLunch, registryEntry) {
  if (!wantsLunch) return 'No Lunch';
  const meal = getMealInfoForDate(registryEntry.eventDate, registryEntry.location);
  return (meal && (meal.type === 'Hot' || meal.type === 'Cold')) ? meal.type : '';
}

function buildRegistrantRow(args) {
  const {
    registryEntry, name, personType, lunchType, primaryRegistrant, adminNotes, formEditUrl,
    protectedKeys, existingRowIndex, submittedAt, orderAheadDays, partyId, partySize
  } = args;
  const phone = String(args.phone || '').trim();
  const email = String(args.email || '').trim();
  // Rows that did not come from a form submission (a club booking, say) have
  // no per-response edit link, and "=HYPERLINK("", ...)" is a broken link
  // dressed up as a working one — so they name their origin in plain text.
  const formSource = formEditUrl
    ? makeHyperlinkFormula(formEditUrl, 'View Submission')
    : String(args.formSourceText || '');
  const displayName = String(name || '').trim();
  const key = `${registryEntry.eventId}|${normalizeNameKey(displayName)}|${personType}`;
  // The caller's lunchType is just an intent signal ('No Lunch' vs
  // anything else) — resolveRegistrantLunchType() is what turns that into
  // an actual Hot/Cold value. Deriving lunchStatus from this boolean rather
  // than from the resolved string means an unresolved Hot/Cold (no menu
  // configured yet) never downgrades a real "Needed" registrant.
  //
  // Gated on isLunchOfferedOn(): a date that serves no lunch produces no
  // lunch demand, whatever the form said. The per-date roster grid can't
  // even offer such a date (buildDateLabelSets() leaves it out), but the
  // "everyone, every date" branch asks the lunch question ONCE for the whole
  // form — without this gate, one checkbox would have booked a meal on every
  // Not-Serving date the form covers.
  const intendsLunch = !!lunchType && lunchType !== 'No Lunch';
  const wantsLunch = intendsLunch && isLunchOfferedOn(registryEntry.eventDate, registryEntry.location);

  if (protectedKeys.has(key)) {
    return null; // never overwrite a manually-edited/added row, resubmission or not
  }

  const map = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  const existingRow = existingRowIndex.get(key);

  if (existingRow) {
    const existingPartyId = existingRow[map['Party_ID']];
    if (existingPartyId && existingPartyId === partyId) {
      // Same Response ID — Google keeps a response's ID stable when a
      // respondent uses their "edit response" link (see
      // form.setAllowResponseEdits(true) in getOrCreateTemplateForm()), so
      // this is the SAME submission being re-seen, not a new one. Refresh
      // the one row in place rather than appending a duplicate.
      existingRow[map['Lunch_Type']] = resolveRegistrantLunchType(wantsLunch, registryEntry);
      existingRow[map['Lunch_Status']] = existingRow[map['Program_Status']] === 'Waitlisted'
        ? 'Waitlisted'
        : (wantsLunch ? 'Needed' : 'No Lunch');
      existingRow[map['Admin_Notes']] = adminNotes || '';
      existingRow[map['Party_Size']] = partySize || '';
      existingRow[map['Order_Ahead_Flag']] = computeOrderAheadFlag(registryEntry.eventDate, submittedAt, orderAheadDays);
      existingRow[map['Form_Source']] = formSource;
      // Contact details are only ever ADDED here, never blanked: a resubmission
      // that skipped the phone box must not erase the number we already have.
      if (phone) existingRow[map['Phone']] = phone;
      if (email) existingRow[map['Email']] = email;
      return null; // nothing new to append — the existing row was updated in place
    }
    // A genuinely different submission (a different Party_ID) for the same
    // identity: keep the old row visible for the audit trail instead of
    // silently dropping this resubmission the way a plain duplicate-key
    // check used to.
    supersedeRegistrantRow(existingRow, map, submittedAt);
  }

  const isCapped = registryEntry.maxCapacity > 0;
  const programStatus = isCapped && registryEntry.activeCountSoFar >= registryEntry.maxCapacity
    ? 'Waitlisted' : 'Active';
  const lunchStatus = programStatus === 'Waitlisted'
    ? 'Waitlisted'
    : (wantsLunch ? 'Needed' : 'No Lunch');

  if (programStatus === 'Waitlisted') {
    // Someone just hit a cap. That's the one registration outcome a human
    // usually has to do something about, so it goes in the admin digest.
    noteForAdmin('Waitlisted registrants',
      `${displayName} (${personType}) for ${formatDateLabel(registryEntry.eventDate)} — capacity ${registryEntry.maxCapacity} is full.`);
  }

  registryEntry.activeCountSoFar = (registryEntry.activeCountSoFar || 0) + (programStatus === 'Active' ? 1 : 0);

  const row = new Array(HEADERS.Lunch_and_Event_Registrants.length).fill('');

  row[map['Location']] = registryEntry.location || '';
  row[map['Event']] = registryEntry.cleanTitle || '';
  row[map['Event_Date']] = registryEntry.eventDate;
  row[map['Manual_Override']] = 'Auto-Synced';
  row[map['Name']] = displayName;
  row[map['Phone']] = phone;
  row[map['Email']] = email;
  row[map['Person_Type']] = personType;
  row[map['Lunch_Type']] = resolveRegistrantLunchType(wantsLunch, registryEntry);
  row[map['Primary_Registrant']] = primaryRegistrant;
  row[map['Party_ID']] = partyId || '';
  row[map['Party_Size']] = partySize || '';
  // Points at this specific submission (response.getEditResponseUrl(), via
  // processFormResponse()/processAllDatesResponse()), not the shared form editor.
  row[map['Form_Source']] = formSource;
  row[map['Program_Status']] = programStatus;
  row[map['Lunch_Status']] = lunchStatus;
  row[map['Order_Ahead_Flag']] = computeOrderAheadFlag(registryEntry.eventDate, submittedAt, orderAheadDays);
  row[map['Admin_Notes']] = adminNotes || '';
  row[map['Event_ID']] = registryEntry.eventId;

  existingRowIndex.set(key, row); // reserve/replace immediately so a later row in this same pass supersedes/patches THIS one
  return row;
}

/** Recomputes Active_Count / Waitlist_Count / Remaining_Seats / Status on the session table (both Upcoming and Past zones). */
function recomputeEventRegistryCounts(registrySheet, registrantsSheet, registrantRows) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return;

  const regMap = getHeaderMapAt(registrySheet, headerRows[0]); // identical column layout at every header row
  const counts = buildEventCountsFromRegistrants(registrantsSheet, registrantRows);

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, regMap['Event_Date']);
    if (!zone) return;
    recomputeCountsForZone(registrySheet, zone.start, zone.count, regMap, counts);
  });
}

function buildEventCountsFromRegistrants(registrantsSheet, registrantRows) {
  const counts = {};
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const rows = registrantRows || readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (!eventId) return;
    if (!counts[eventId]) counts[eventId] = { active: 0, waitlist: 0 };
    if (row[map['Program_Status']] === 'Active') counts[eventId].active++;
    if (row[map['Program_Status']] === 'Waitlisted') counts[eventId].waitlist++;
  });
  return counts;
}

function recomputeCountsForZone(registrySheet, dataStart, numRows, regMap, counts) {
  const eventIds = registrySheet.getRange(dataStart, regMap['Event_ID'], numRows, 1).getValues();
  const maxCaps = registrySheet.getRange(dataStart, regMap['Max_Capacity'], numRows, 1).getValues();

  const activeOut = [], waitlistOut = [], remainingOut = [], statusOut = [];
  for (let i = 0; i < numRows; i++) {
    const eventId = eventIds[i][0];
    const rawCap = maxCaps[i][0];
    const isUncapped = rawCap === '--' || rawCap === '' || Number(rawCap) <= 0;
    const maxCap = isUncapped ? 0 : Number(rawCap);
    const c = counts[eventId] || { active: 0, waitlist: 0 };

    activeOut.push([c.active]);
    if (isUncapped) {
      waitlistOut.push(['']);
      remainingOut.push(['']);
      statusOut.push(['🟢 Unlimited']);
    } else {
      waitlistOut.push([c.waitlist]);
      remainingOut.push([Math.max(maxCap - c.active, 0)]);
      statusOut.push([computeStatus(c.active, maxCap)]);
    }
  }
  registrySheet.getRange(dataStart, regMap['Active_Count'], numRows, 1).setValues(activeOut);
  registrySheet.getRange(dataStart, regMap['Waitlist_Count'], numRows, 1).setValues(waitlistOut);
  registrySheet.getRange(dataStart, regMap['Remaining_Seats'], numRows, 1).setValues(remainingOut);
  registrySheet.getRange(dataStart, regMap['Status'], numRows, 1).setValues(statusOut);
}

/**
 * Call AFTER recomputeEventRegistryCounts() so Remaining_Seats is fresh.
 * Re-stamps every capped form's roster-grid ROW labels with a
 * CAPACITY_HINT_SUFFIX wherever a session has hit 0 Remaining_Seats — this
 * is what turns silent waitlisting into a signal a respondent can actually
 * see before they submit. Forms with no capped sessions at all are skipped
 * entirely (nothing on them can ever go full), so this stays cheap on the
 * common case of unlimited/"Monthly" programs.
 */
function refreshFormCapacityLabelsForAllForms(registrySheet) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const sharedFormIds = getSharedFormIdSet();

  Object.keys(byForm).forEach(formId => {
    const formRows = byForm[formId];
    const hasCappedSession = formRows.some(row => {
      const rawCap = row[map['Max_Capacity']];
      return rawCap !== '' && rawCap !== '--' && Number(rawCap) > 0;
    });
    if (!hasCappedSession) return; // nothing on this form can ever go FULL — skip the API round trip

    const formContext = buildFormSessionContext(formId, formRows, map, sharedFormIds);
    if (formContext.sessions.length === 0) return;
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(formContext.sessions, formContext);
    // Fingerprinted: on the overwhelmingly common "nothing filled up since
    // last hour" sync this costs a hash compare and no FormApp call at all.
    applyFormDateLabels(formId, allDateLabels, lunchDateLabels, { context: 'capacity labels' });
  });
  flushPersistentRegistries();
}

/** { Form_ID: [session rows] } from a batch of Master_Program_Dashboard rows. Rows with no form are skipped. */
function groupRegistryRowsByForm(rows, map) {
  const byForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (!formId) return;
    if (!byForm[formId]) byForm[formId] = [];
    byForm[formId].push(row);
  });
  return byForm;
}

/**
 * Is this live form built on the CURRENT template? Structural, not a
 * version stamp — it has to be able to judge a form first seen long before
 * stamps existed.
 *
 * A form is out of date when it still carries the v1/v2 guest-count question
 * (and, behind it, that template's per-count branch pages), when any question
 * the current template introduced is missing, when the old floating footer
 * header is still on it, or when it has more page breaks than the current
 * template builds. Any of those means a respondent is meeting a form this
 * code no longer knows how to read.
 */
function isFormOnCurrentTemplate(form) {
  const items = form.getItems();
  const titles = items.map(it => it.getTitle());
  if (titles.indexOf(LEGACY_GUEST_COUNT_TITLE) !== -1) return false;
  if (titles.indexOf(LEGACY_FOOTER_ITEM_TITLE) !== -1) return false;
  const required = [
    TEMPLATE_ITEM_TITLES.NAME,
    TEMPLATE_ITEM_TITLES.PHONE,
    TEMPLATE_ITEM_TITLES.GUEST_COUNT,
    TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE,
    TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID
  ];
  if (required.some(title => titles.indexOf(title) === -1)) return false;
  const pageBreaks = items.filter(it => it.getType() === FormApp.ItemType.PAGE_BREAK).length;
  return pageBreaks <= Object.keys(TEMPLATE_PAGE_TITLES).length;
}

/**
 * Rewrites a live form's questions to the current template IN PLACE, keeping
 * its Form ID.
 *
 * Keeping the ID is the whole point: every calendar description, dashboard
 * link, registry entry, all-dates registrant record and label fingerprint in
 * the system is keyed by it, and none of them have to be chased down. The
 * cost is that responses already collected against the OLD questions lose
 * their per-question answers when those questions are deleted — which is why
 * this runs from syncRegistrations() only AFTER that run has imported
 * everything new. Rows already on Lunch_and_Event_Registrants are the record
 * of those registrations and are untouched.
 */
function rebuildFormFromCurrentTemplate(form, context) {
  clearFormNavigation(form);
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
  addTemplateItemsToForm(form);

  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(context.sessions, context);
  form.setDescription(buildFormDescription(context.locations, allDateLabels, context.isFixed, lunchDateLabels.length > 0,
    { isClub: context.isClub, programTitle: context.programTitle }));

  // THE DATE LABELS ARE THE ONE STEP THAT CANNOT BE SKIPPED. A rebuilt form's
  // grids hold the template's placeholder row until they are written, so a
  // form that gets here and then fails is a form nobody can register on —
  // strictly worse than the out-of-date one it replaced. The two steps before
  // it are therefore allowed to fail on their own: wrong sign-up wording or a
  // missing footer is a blemish, and reporting it beats abandoning the rebuild.
  // (This is not hypothetical — a title collision made applyAttendanceModeChoices
  // throw here, and every form it touched was left showing
  // "(dates will be filled in automatically)".)
  try {
    applyAttendanceModeChoices(form,
      { isFixed: context.isFixed, isClub: context.isClub, programTitle: context.programTitle });
  } catch (err) {
    log(`⚠️ Rebuilt form ${form.getId()} but could not set its sign-up options (${err}) — ` +
      `it carries the template's default wording.`);
    noteForAdmin('Forms rebuilt with default sign-up wording',
      `${form.getId()} (${describeLocations(context.locations)}) — its options could not be customized: ${err}`);
  }
  syncLunchQuestionsOnForm(form, context.locations, lunchDateLabels.length > 0);
  // force: a rebuilt form's grids are back to the template placeholder row,
  // and its fingerprint on file still describes the labels it had before.
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels, { form, force: true, context: 'template migration' });
  try {
    applyFormFooterNote(form, buildFooterNoteForLocations(context.locations));
  } catch (err) {
    log(`ℹ️ Rebuilt form ${form.getId()} but could not attach its footer note (${err}).`);
  }
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);
}

/** Ceiling on how many out-of-date forms one execution will rebuild — see migrateFormsToCurrentTemplate(). */
const MAX_FORM_REBUILDS_PER_RUN = 5;

/**
 * Cuts every "go to section" link on a form: choice-level page navigation on
 * list/multiple-choice items, and page-level navigation on the page breaks
 * themselves.
 *
 * This is what a rebuild has to do FIRST. Deleting a page break that another
 * item's choice still points at leaves the form describing a jump to a
 * section that no longer exists, and Forms rejects the whole update with a
 * flat "Invalid data updating form" — which is exactly how a migration fails
 * on the old eight-section template, where seven choices point at branch
 * pages. Neutralize the links, and the items delete cleanly.
 */
function clearFormNavigation(form) {
  form.getItems().forEach(item => {
    try {
      const type = item.getType();
      if (type === FormApp.ItemType.PAGE_BREAK) {
        item.asPageBreakItem().setGoToPage(FormApp.PageNavigationType.CONTINUE);
        return;
      }
      if (type !== FormApp.ItemType.LIST && type !== FormApp.ItemType.MULTIPLE_CHOICE) return;
      const typed = type === FormApp.ItemType.LIST ? item.asListItem() : item.asMultipleChoiceItem();
      const values = typed.getChoices().map(c => c.getValue()).filter(v => v !== '' && v !== null && v !== undefined);
      if (values.length > 0) typed.setChoiceValues(values); // plain choices — no navigation attached
    } catch (err) {
      log(`ℹ️ Could not clear navigation on "${item.getTitle()}" of form ${form.getId()} (${err}) — continuing.`);
    }
  });
}

/**
 * Brings every live registration form up to the current template.
 *
 * This is the missing half of a TEMPLATE_VERSION bump. Bumping it rebuilds
 * the cached template, so forms created AFTERWARDS are correct — but a
 * group's form is created once and then reused for as long as the group
 * runs (see refreshFormForNewDates()), so the forms people are actually
 * filling in stayed on whatever template they were born with. A respondent
 * on a v1/v2 form still met the guest-count question and its branch pages,
 * and still got mis-routed by them; the fix shipped in the template never
 * reached them.
 *
 * Cheap by design: a form whose stamp already reads TEMPLATE_VERSION is
 * skipped without any API call, so the steady state costs one Script
 * Properties read. Only unstamped or stale forms are opened, and no more
 * than MAX_FORM_REBUILDS_PER_RUN are rebuilt in any one execution — a
 * rebuild is a few dozen Forms calls, and the hourly sync it rides on has a
 * six-minute ceiling. Whatever is left over is picked up next run, so a
 * backlog drains itself.
 *
 * Call AFTER responses have been imported — see rebuildFormFromCurrentTemplate().
 * Returns the number of forms rebuilt.
 */
function migrateFormsToCurrentTemplate(registrySheet, sessionRows) {
  const headers = HEADERS.Master_Program_Dashboard;
  const rows = sessionRows || readAllSectionedRows(registrySheet, headers, 'Event_ID');
  if (rows.length === 0) return 0;
  const map = getIndexMap(headers);
  const byForm = groupRegistryRowsByForm(rows, map);
  const versions = getFormTemplateVersions();
  const sharedFormIds = getSharedFormIdSet();

  const newUrlByFormId = {};
  let rebuilt = 0;
  let deferred = 0;

  Object.keys(byForm).forEach(formId => {
    if (versions[formId] === TEMPLATE_VERSION) return; // already known good — no API call
    if (rebuilt >= MAX_FORM_REBUILDS_PER_RUN) { deferred++; return; }

    let form;
    try {
      form = FormApp.openById(formId);
    } catch (err) {
      log(`⚠️ migrateFormsToCurrentTemplate: could not open form ${formId} (${err}).`);
      noteForAdmin('Forms that could not be opened', `${formId} — ${err}`);
      return;
    }

    if (isFormOnCurrentTemplate(form)) {
      setFormTemplateVersion(formId, TEMPLATE_VERSION); // first sighting of an already-current form: just record it
      return;
    }

    const formRows = byForm[formId];
    const formContext = buildFormSessionContext(formId, formRows, map, sharedFormIds);
    const location = describeLocations(formContext.locations);
    if (formContext.sessions.length === 0) return;

    try {
      withFormRetry(`rebuilding form ${formId} ("${location}")`,
        () => rebuildFormFromCurrentTemplate(form, formContext));
    } catch (err) {
      log(`⚠️ migrateFormsToCurrentTemplate: could not rebuild form ${formId} for "${location}" (${err}).`);
      noteForAdmin('Forms that could not be updated',
        `${formId} (${location}) is still on an older layout — rebuilding it failed with: ${err}. ` +
        `It keeps its old questions and its link still works; the next sync will try again.`);
      return;
    }

    rebuilt++;
    // A breath between forms. A rebuild is ~35 writes to one document, and
    // running several back to back is precisely what makes Forms start
    // answering "please wait and try again" — the retry above recovers from
    // that, but not provoking it is cheaper than recovering from it.
    if (rebuilt < MAX_FORM_REBUILDS_PER_RUN) Utilities.sleep(1500);
    newUrlByFormId[formId] = buildRegistrationUrl(form);
    // Deliberately says only WHICH version, not what changed in it. This line
    // used to name the v3 change ("the guest-count branch pages are gone") and
    // was still saying it long after v4 brought that question back on purpose —
    // a log line that describes one particular migration goes stale the moment
    // the next one lands, and a stale one is worse than a terse one.
    log(`Rebuilt form ${formId} ("${location}") on template v${TEMPLATE_VERSION}.`);
    noteForAdmin('Registration forms updated',
      `"${form.getTitle()}" (${location}) was on an older layout and has been rebuilt on the current one ` +
      `(template v${TEMPLATE_VERSION}). Its link is unchanged; the boxes it pre-checks are re-generated on the ` +
      `dashboard's "View Live Form" link, and calendar invites pick the new one up the next time that ` +
      `program's dates change.`);
  });

  if (rebuilt > 0) updateRegistryFormLinks(registrySheet, newUrlByFormId);
  if (deferred > 0) log(`${deferred} more form(s) still on an older template — they'll be rebuilt on the next sync.`);
  flushPersistentRegistries();
  return rebuilt;
}

/**
 * Re-points Master_Program_Dashboard's "View Live Form" links at freshly
 * generated URLs, for the forms in urlByFormId. Needed after a rebuild: the
 * link we hand out is a PREFILLED url (buildRegistrationUrl()) whose
 * entry.N parameters name the form's item IDs, and a rebuilt form has new
 * ones. The stale link still opens the right form — Forms ignores parameters
 * it doesn't recognize — it just stops pre-checking anything.
 */
function updateRegistryFormLinks(registrySheet, urlByFormId) {
  if (Object.keys(urlByFormId).length === 0) return;
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based, read off the sheet itself

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const idValues = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1).getValues();
    const linkRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const formulas = linkRange.getFormulas();
    const values = linkRange.getValues();
    const links = formulas.map((f, r) => [f[0] || values[r][0]]); // leave every other row exactly as it is
    let touched = false;
    idValues.forEach((idRow, r) => {
      const url = urlByFormId[idRow[0]];
      if (!url) return;
      links[r] = [makeHyperlinkFormula(url, 'View Live Form')];
      touched = true;
    });
    if (touched) linkRange.setValues(links);
  });
}

/**
 * MAINTENANCE — run from the Apps Script editor when a form needs
 * re-checking right now rather than at the next hourly sync (which already
 * calls migrateFormsToCurrentTemplate() itself), or after someone has hand-
 * edited a form's questions, since the version stamps this clears are the
 * only reason a form gets skipped without being opened.
 *
 * Returns the number of forms that were actually rebuilt.
 */
function recheckAllRegistrationForms() {
  if (!requireAuthorizedAdmin('Re-check All Registration Forms')) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return 0;

  PropertiesService.getScriptProperties().deleteProperty(FORM_TEMPLATE_VERSION_PROP_KEY);
  __formTemplateVersionCache = null;
  __formTemplateVersionDirty = false;

  const rebuilt = migrateFormsToCurrentTemplate(registrySheet);
  flushAdminDigest('Form re-check');
  log(`recheckAllRegistrationForms: rebuilt ${rebuilt} form(s) on template v${TEMPLATE_VERSION}.`);
  return rebuilt;
}

/**
 * ONE-TIME MAINTENANCE — run from the Apps Script editor, not wired to any
 * sync or the menu. createRegistrationForm() strips lunch questions off a
 * NEVER-policy location's form at creation, and refreshFormForNewDates()
 * catches up an existing form the next time it gains new dates — but a
 * form that already exists AND isn't due for new dates soon just sits with
 * stale lunch questions on it until one of those paths touches it. This
 * sweeps every currently-live form for a NEVER-policy location right now.
 *
 * Safe to run any time: removeLunchQuestionsFromForm() is a no-op on a form
 * that's already clean, so re-running this costs a few FormApp calls and
 * changes nothing.
 */
function cleanupNeverPolicyForms() {
  if (!requireAuthorizedAdmin('Cleanup Never-Policy Forms')) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return;

  const headers = HEADERS.Master_Program_Dashboard;
  const rows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const map = getIndexMap(headers);

  const locationsByForm = {};
  rows.forEach(row => {
    const formId = row[map['Form_ID']];
    const location = String(row[map['Location']] || '').trim();
    if (!formId || !location) return;
    if (!locationsByForm[formId]) locationsByForm[formId] = [];
    if (locationsByForm[formId].indexOf(location) === -1) locationsByForm[formId].push(location);
  });

  let checked = 0;
  Object.keys(locationsByForm).forEach(formId => {
    const locations = locationsByForm[formId];
    // A cross-location form only qualifies when EVERY location on it is
    // Never — one catering site on the form is reason enough to keep asking.
    if (locations.some(loc => getCateringPolicyForLocation(loc) !== CATERING_POLICIES.NEVER)) return;
    checked++;
    try {
      removeLunchQuestionsFromForm(FormApp.openById(formId), locations);
    } catch (err) {
      log(`⚠️ cleanupNeverPolicyForms: could not open form ${formId} for "${describeLocations(locations)}" (${err}).`);
    }
  });
  log(`cleanupNeverPolicyForms: checked ${checked} form(s) at Never-policy location(s).`);
}


// ============================================================================
// 5b. CALENDAR INVITATIONS  (registrants -> guests on the real calendar event)
// ============================================================================
//
// A registration lands in this workbook, which is not where the person who
// made it looks. This step closes that gap: anyone who signs up is added as a
// GUEST on the actual Google Calendar event, so the program appears in their
// own calendar, with Google's own reminders, and moves if the event moves.
//
// THREE RULES, all of them about not sending mail we cannot justify:
//
//   UPCOMING ONLY. A past event's guest list is history. Adding somebody to
//   last Tuesday emails them an invitation to something that has happened.
//
//   ACTIVE ONLY, AND SYMMETRIC. Active registrants are invited; anyone whose
//   row is Cancelled, Superseded or Waitlisted is REMOVED if they were
//   previously invited. A one-way invite would leave a cancelled member
//   holding a calendar entry for a session they withdrew from, which is worse
//   than never having invited them.
//
//   ONCE. The ledger below records who has already been added per event, so a
//   sync that changes nothing sends nothing — without it, every hourly run
//   would re-add the same guests, and Google treats each add as an event
//   update worth notifying about.
//
// Governed by Config's "📧 Calendar Invitations" switch (see
// CALENDAR_INVITE_OPTIONS); off means this whole section is a no-op.
// ============================================================================

/** Who we have already put on which event's guest list: { Event_ID: [email...] }. */
const CALENDAR_INVITE_PROP_KEY = 'CALENDAR_INVITES_V1';

let __calendarInviteLedgerCache = null;
let __calendarInviteLedgerDirty = false;

function getCalendarInviteLedger() {
  if (__calendarInviteLedgerCache) return __calendarInviteLedgerCache;
  const raw = PropertiesService.getScriptProperties().getProperty(CALENDAR_INVITE_PROP_KEY);
  __calendarInviteLedgerCache = raw ? JSON.parse(raw) : {};
  return __calendarInviteLedgerCache;
}

function saveCalendarInviteLedger() {
  if (!__calendarInviteLedgerDirty || !__calendarInviteLedgerCache) return;
  PropertiesService.getScriptProperties()
    .setProperty(CALENDAR_INVITE_PROP_KEY, JSON.stringify(__calendarInviteLedgerCache));
  __calendarInviteLedgerDirty = false;
}

/**
 * Ceiling on how many EVENTS one execution will touch. A guest add is a
 * calendar write; the hourly sync this rides on has a six-minute budget and
 * real work to do before it gets here. Anything left over is picked up next
 * run — the ledger makes the work strictly decreasing, so a backlog drains.
 */
const MAX_INVITE_EVENTS_PER_RUN = 40;

/**
 * Brings every upcoming session's calendar guest list into line with its
 * registrants. Returns { invited, removed, eventsTouched, deferred }.
 *
 * Safe to call on every sync and safe to call by hand from the menu: it
 * computes the difference against the ledger and does nothing when there is
 * none.
 */
function inviteRegistrantsToCalendarEvents(sessionRows, registrantRows) {
  const result = { invited: 0, removed: 0, eventsTouched: 0, deferred: 0, skipped: false };
  if (!shouldInviteRegistrants()) {
    result.skipped = true;
    return result;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regMap = getIndexMap(regHeaders);
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const sessions = sessionRows || (registrySheet ? readAllSectionedRows(registrySheet, regHeaders, 'Event_ID') : []);
  if (sessions.length === 0) return result;

  const todayKey = formatDateKey(new Date());
  const sessionByEventId = {};
  sessions.forEach(row => {
    const eventId = String(row[regMap['Event_ID']] || '').trim();
    const date = coerceDate(row[regMap['Event_Date']]);
    const calendarId = String(row[regMap['Calendar_Source']] || '').trim();
    if (!eventId || !date || !calendarId) return;
    if (formatDateKey(date) < todayKey) return; // upcoming only
    sessionByEventId[eventId] = {
      eventId, date, calendarId,
      title: String(row[regMap['Clean_Title']] || '').trim(),
      location: String(row[regMap['Location']] || '').trim()
    };
  });
  if (Object.keys(sessionByEventId).length === 0) return result;

  const lrHeaders = HEADERS.Lunch_and_Event_Registrants;
  const lrMap = getIndexMap(lrHeaders);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const rows = registrantRows ||
    (registrantsSheet ? readAllSectionedRows(registrantsSheet, lrHeaders, 'Event_ID') : []);

  // wanted = should be on the guest list; unwanted = should NOT be, and gets
  // removed if we ever put them there. A person appearing in both (two rows,
  // one cancelled and one active) counts as wanted — the active row wins.
  const wanted = {};
  const unwanted = {};
  rows.forEach(row => {
    const eventId = String(row[lrMap['Event_ID']] || '').trim();
    if (!sessionByEventId[eventId]) return;
    const email = String(row[lrMap['Email']] || '').trim().toLowerCase();
    if (!isPlausibleEmail(email)) return;
    const status = String(row[lrMap['Program_Status']] || '').trim();
    const bucket = status === 'Active' ? wanted : unwanted;
    if (!bucket[eventId]) bucket[eventId] = new Set();
    bucket[eventId].add(email);
  });

  const ledger = getCalendarInviteLedger();
  const eventIds = Object.keys(sessionByEventId);

  for (const eventId of eventIds) {
    const already = new Set(ledger[eventId] || []);
    const want = wanted[eventId] || new Set();
    const drop = unwanted[eventId] || new Set();

    const toAdd = Array.from(want).filter(email => !already.has(email));
    const toRemove = Array.from(drop).filter(email => already.has(email) && !want.has(email));
    if (toAdd.length === 0 && toRemove.length === 0) continue;

    if (result.eventsTouched >= MAX_INVITE_EVENTS_PER_RUN) {
      result.deferred++;
      continue;
    }

    const session = sessionByEventId[eventId];
    const event = findCalendarEventForSession(session);
    if (!event) {
      log(`ℹ️ Calendar invitations: no calendar event found for "${session.title}" on ` +
        `${formatDateLabel(session.date)} (${session.location}) — nobody was invited to it.`);
      continue;
    }

    let changed = false;
    toAdd.forEach(email => {
      try {
        event.addGuest(email);
        already.add(email);
        result.invited++;
        changed = true;
      } catch (err) {
        log(`⚠️ Could not invite ${email} to "${session.title}" on ${formatDateLabel(session.date)} (${err}).`);
      }
    });
    toRemove.forEach(email => {
      try {
        event.removeGuest(email);
        already.delete(email);
        result.removed++;
        changed = true;
      } catch (err) {
        log(`⚠️ Could not remove ${email} from "${session.title}" on ${formatDateLabel(session.date)} (${err}).`);
      }
    });

    if (changed) {
      ledger[eventId] = Array.from(already);
      __calendarInviteLedgerDirty = true;
      result.eventsTouched++;
    }
  }

  saveCalendarInviteLedger();
  if (result.invited > 0 || result.removed > 0) {
    log(`Calendar invitations: ${result.invited} guest(s) added, ${result.removed} removed, ` +
      `across ${result.eventsTouched} event(s)` + (result.deferred > 0 ? `; ${result.deferred} left for the next run.` : '.'));
    // The calendar just changed under the cached event lists.
    invalidateCalendarEventsCache();
  }
  return result;
}

/**
 * Finds the live CalendarEvent one session row refers to.
 *
 * Matched by DAY + cleanTitle rather than by a stored calendar event ID,
 * because this system has never stored one — Event_ID is its own hash of
 * calendar + title + date (computeEventId()), deliberately stable across an
 * event being deleted and re-made. Recurring events also change their
 * underlying IDs in ways a stored ID would not survive.
 *
 * Per-day event lists are memoized for the execution: a program with twelve
 * sessions across three calendars would otherwise re-fetch the same day
 * repeatedly.
 */
let __calendarDayEventsCache = {};

function findCalendarEventForSession(session) {
  const dayKey = `${session.calendarId}|${formatDateKey(session.date)}`;
  let events = __calendarDayEventsCache[dayKey];
  if (events === undefined) {
    try {
      const calendar = CalendarApp.getCalendarById(session.calendarId);
      if (!calendar) {
        events = null;
      } else {
        const start = parseDateKey(formatDateKey(session.date));
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        events = calendar.getEvents(start, end);
      }
    } catch (err) {
      log(`⚠️ Calendar ${session.calendarId} could not be read for invitations (${err}).`);
      events = null;
    }
    __calendarDayEventsCache[dayKey] = events;
  }
  if (!events) return null;

  const wanted = normalizeNameKey(session.title);
  for (const ev of events) {
    if (ev.isAllDayEvent()) continue;
    const parsed = parseEventTitle(ev.getTitle());
    if (parsed && normalizeNameKey(parsed.cleanTitle) === wanted) return ev;
  }
  return null;
}

/**
 * MENU ENTRY. Runs the invitation pass on demand — after turning the Config
 * switch on for the first time, or when somebody wants the invitations out now
 * rather than at the top of the hour.
 */
function inviteRegistrantsNow() {
  if (!shouldInviteRegistrants()) {
    toastIfPossible(`Calendar invitations are switched off — set "Invite_Registrants" to ` +
      `"${CALENDAR_INVITE_OPTIONS.INVITE}" on the ${SHEET_NAMES.CONFIG} tab first.`);
    return null;
  }
  if (!confirmConsequentialAction('Send calendar invitations now?',
    'Everyone actively registered for an UPCOMING session, who gave an email address, will be added as a ' +
    'guest on that session\'s Google Calendar event. Google emails each of them an invitation.\n\n' +
    'Anyone whose registration has since been cancelled is removed from the guest list, which Google also ' +
    'emails them about. People already invited are left alone.', false)) {
    return null;
  }

  const result = inviteRegistrantsToCalendarEvents(null, null);
  const summary = `Calendar invitations ✅ — ${result.invited} invited, ${result.removed} removed, ` +
    `${result.eventsTouched} event(s) updated` +
    (result.deferred > 0 ? ` (${result.deferred} more will go out on the next sync).` : '.');
  toastIfPossible(summary);
  log(`inviteRegistrantsNow: ${summary}`);
  return result;
}


// ============================================================================
// 6. SECTIONED TABLE HELPERS  (Upcoming / Past split — every date-bearing tab)
// ============================================================================
//
// Every tab keyed by Event_Date now renders as two stacked sub-tables: dates
// today-or-later ("Upcoming", ascending) and dates before today ("Past",
// most-recent-first). This section holds the shared machinery: finding a
// tab's (possibly several) header rows, reading all its rows regardless of
// which zone they're currently in, splitting rows by date, and writing the
// two zones back out with consistent banners/headers/zebra striping/month
// tinting. Master_Program_Dashboard and Master_Lunch_Dashboard call the
// lower-level writeUpcomingPastSections() directly (since they have their
// own extra Today/Metrics sections above); the three flat, single-table
// tabs (Lunch_and_Event_Registrants, Deleted_Event_Triage, Lunch_Schedule)
// use the renderFlatDateSheet() wrapper instead.
// ============================================================================

/**
 * Given the exact row of one header and the row of the NEXT header (or null
 * if this is the last zone), finds the contiguous span of rows in between
 * that actually contain a parseable date in dateCol1Based — i.e. the real
 * data rows, skipping whatever banner/spacer rows sit in between. Returns
 * null if the zone has no data rows.
 */
function getZoneDataRange(sheet, headerRow, nextHeaderRow, dateCol1Based) {
  if (!dateCol1Based) return null;
  const scanEnd = nextHeaderRow ? nextHeaderRow - 1 : sheet.getLastRow();
  if (scanEnd < headerRow + 1) return null;
  const values = sheet.getRange(headerRow + 1, dateCol1Based, scanEnd - headerRow, 1).getValues();
  let firstRow = -1, lastRow = -1;
  values.forEach((v, i) => {
    if (coerceDate(v[0])) {
      if (firstRow === -1) firstRow = headerRow + 1 + i;
      lastRow = headerRow + 1 + i;
    }
  });
  if (firstRow === -1) return null;
  return { start: firstRow, count: lastRow - firstRow + 1 };
}

/**
 * Returns [{headerRow, dataStart, dataEnd}, ...] for every header row found
 * via `markerHeaderName` on `sheet`.
 *
 * `endRow` bounds the LAST zone. Without it the final table runs to the
 * bottom of the sheet, which is right everywhere except Lunch_Schedule, whose
 * ADD block sits below the tables and holds dated rows that are explicitly
 * NOT part of the schedule yet — see getLunchScheduleEndRow().
 */
function getSectionZones(sheet, markerHeaderName, endRow) {
  const headerRows = findAllHeaderRows(sheet, markerHeaderName, 5000);
  if (headerRows.length === 0) return [];
  const map = getHeaderMapAt(sheet, headerRows[0]);
  const dateCol = map['Event_Date'];
  const limit = endRow || null;
  return headerRows.map((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : (limit ? limit + 1 : null);
    const zone = getZoneDataRange(sheet, hRow, nextHeader, dateCol);
    return zone
      ? { headerRow: hRow, dataStart: zone.start, dataEnd: zone.start + zone.count - 1 }
      : { headerRow: hRow, dataStart: hRow + 1, dataEnd: hRow };
  });
}

function isRowInAnyDataZone(zones, row) {
  return findZoneForRow(zones, row) !== null;
}

/** The zone (from getSectionZones()) whose data rows contain `row`, or null. */
function findZoneForRow(zones, row) {
  return zones.filter(z => row >= z.dataStart && row <= z.dataEnd)[0] || null;
}

/**
 * Reads every current data row across all of a tab's stacked sub-tables
 * (each with its own header row located via `markerHeaderName`) into one
 * combined array, preserving formulas. Banner/spacer rows are skipped
 * automatically since they never contain a parseable Event_Date.
 *
 * Rows come back in `headers` order even when the SHEET's own columns are in
 * a different order — see buildHeaderProjection(). That is what lets a
 * HEADERS entry be reordered (or gain/lose a column) without scrambling the
 * data already sitting on the tab: the next render reads by header NAME and
 * writes back out in the new order.
 */
function readAllSectionedRows(sheet, headers, markerHeaderName, endRow) {
  const headerRows = findAllHeaderRows(sheet, markerHeaderName, 5000);
  if (headerRows.length === 0) return [];
  const lastRow = endRow ? Math.min(endRow, sheet.getLastRow()) : sheet.getLastRow();
  const sheetLastCol = Math.max(sheet.getLastColumn(), headers.length);
  const dateColIdx = headers.indexOf('Event_Date');
  let combined = [];
  headerRows.forEach((hRow, i) => {
    const zoneEnd = (i + 1 < headerRows.length) ? headerRows[i + 1] - 1 : lastRow;
    if (zoneEnd <= hRow) return;
    const projection = buildHeaderProjection(sheet, hRow, headers, sheetLastCol);
    const numCols = projection ? sheetLastCol : headers.length;
    let rows = getRowsPreservingFormulas(sheet, hRow + 1, 1, zoneEnd - hRow, numCols);
    if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));
    combined = combined.concat(dateColIdx >= 0 ? rows.filter(row => coerceDate(row[dateColIdx])) : rows);
  });
  return combined;
}

/**
 * Compares a header ROW as it actually sits on the sheet against the header
 * array the code expects.
 *
 * Returns null when they already line up column-for-column — the fast path,
 * and the only case that ever ran before this existed. Otherwise returns a
 * per-canonical-column array of 0-based SHEET column indexes (-1 for a
 * column the sheet doesn't have yet), so readAllSectionedRows() can project
 * each row into the expected order.
 *
 * This is what makes changing a HEADERS layout safe on a workbook that
 * already holds data. Reordering the array used to silently reinterpret
 * every stored row positionally — with Event_Date moving to column A, every
 * existing registrant row would have been read with a Location string where
 * its date belonged, failed the date filter, and been dropped on the next
 * render.
 */
function buildHeaderProjection(sheet, headerRow, headers, lastCol) {
  const rowValues = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(normalizeHeaderText);
  const alreadyAligned = headers.every((h, i) => rowValues[i] === h);
  if (alreadyAligned) return null;

  const colByName = {};
  rowValues.forEach((name, i) => { if (name && colByName[name] === undefined) colByName[name] = i; });
  // A canonical column the sheet doesn't have may still be there under the
  // name an older version wrote — see LEGACY_HEADER_ALIASES. Checked only
  // AFTER the canonical name misses, so a workbook carrying both columns
  // (mid-migration) always prefers the current one.
  const resolve = h => {
    if (colByName[h] !== undefined) return colByName[h];
    const aliases = LEGACY_HEADER_ALIASES[h] || [];
    for (const alias of aliases) {
      if (colByName[alias] !== undefined) return colByName[alias];
    }
    return -1;
  };
  const projection = headers.map(resolve);
  const missing = headers.filter((h, i) => projection[i] === -1);
  log(`Re-aligned "${sheet.getName()}" row ${headerRow} by header name` +
    (missing.length > 0 ? ` (no column on the sheet yet for: ${missing.join(', ')})` : ''));
  return projection;
}

/** Splits rows into { upcoming (today-or-later, ascending), past (before today, most-recent-first) }. Rows with no parseable date are treated as upcoming (kept visible). */
function partitionByDate(rows, dateColIdx, todayKey) {
  const upcoming = [], past = [];
  rows.forEach(row => {
    const d = dateColIdx >= 0 ? coerceDate(row[dateColIdx]) : null;
    if (!d) { upcoming.push(row); return; }
    if (formatDateKey(d) >= todayKey) upcoming.push(row); else past.push(row);
  });
  const byDateAsc = (a, b) => {
    const da = coerceDate(a[dateColIdx]), db = coerceDate(b[dateColIdx]);
    if (!da || !db) return 0;
    return da - db;
  };
  upcoming.sort(byDateAsc);
  past.sort((a, b) => -byDateAsc(a, b));
  return { upcoming, past };
}

// ============================================================================
// OLD MONTHS
// ============================================================================
//
// Every date-sorted tab in this workbook grows in one direction forever. A
// year in, the Past section of Lunch_and_Event_Registrants is thousands of
// rows that nobody scrolls through and every render rewrites.
//
// THE CHEAP HALF OF THE PROBLEM — that it is in the way — is solved here, by
// HIDING past rows older than PAST_MONTHS_SHOWN months. Hiding, specifically:
//
//   • Nothing is moved and nothing is deleted, so no sync, count, dashboard
//     rollup or Member_Roll recompute sees any difference. That matters more
//     than it sounds: the rows on these tabs ARE the database, and a scheme
//     that relocates them has to be right about every reader of every tab.
//   • Ctrl+F still finds a hidden row. Someone asking "was Marion here last
//     March?" gets an answer, without the tab opening onto last March.
//   • It is one API call to undo (showAllPastRows(), on the menu).
//
// THE EXPENSIVE HALF — that the rows still cost render time and cells — is
// NOT solved here, deliberately. See reportArchivableMonths(), which measures
// it and says what the options are, and the "Old months" section of
// USER_GUIDE.md, which lays out the archive designs and why none of them is
// worth doing before the numbers say so.
// ============================================================================

/**
 * How many months of past rows stay visible, counting the current month.
 * 2 = this month and last month; anything older is hidden.
 */
const PAST_MONTHS_SHOWN = 2;

/** 'yyyy-MM' for a date — the key old-month collapsing compares on. */
function formatMonthKey(date) {
  return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM');
}

/** The oldest month that stays visible, as a 'yyyy-MM' key. */
function getVisibleMonthCutoffKey() {
  const now = new Date();
  return formatMonthKey(new Date(now.getFullYear(), now.getMonth() - (PAST_MONTHS_SHOWN - 1), 1));
}

/**
 * Hides the tail of a Past block — the rows whose month is older than the
 * cutoff. Returns how many rows were hidden.
 *
 * ONE CONTIGUOUS BLOCK, always: partitionByDate() sorts past rows
 * most-recent-first, so "older than X" is by construction a suffix. That is
 * what keeps this to a single hideRows() call however many years accumulate,
 * and it is why this function is a suffix scan rather than a filter.
 *
 * Undated rows (there shouldn't be any in a Past block, but a hand-typed row
 * can produce one) count as visible and stop the scan — hiding a row nobody
 * can find again by date is exactly the outcome to avoid.
 */
function collapseOldPastMonths(sheet, pastDataStart, pastRows, dateColIdx) {
  if (!pastRows || pastRows.length === 0 || dateColIdx < 0) return 0;
  const cutoff = getVisibleMonthCutoffKey();

  let firstOldIndex = -1;
  for (let i = pastRows.length - 1; i >= 0; i--) {
    const d = coerceDate(pastRows[i][dateColIdx]);
    if (!d || formatMonthKey(d) >= cutoff) break;
    firstOldIndex = i;
  }
  if (firstOldIndex === -1) return 0;

  const count = pastRows.length - firstOldIndex;
  try {
    sheet.hideRows(pastDataStart + firstOldIndex, count);
  } catch (err) {
    log(`ℹ️ Could not hide ${count} old row(s) on "${sheet.getName()}" (${err}) — they stay visible.`);
    return 0;
  }
  return count;
}

/**
 * Un-hides every row on a rendered tab. Called at the START of each full
 * render: sheet.clear() does NOT reset row visibility, so yesterday's hidden
 * range would otherwise still be hidden today, over completely different rows.
 */
function showAllRows(sheet) {
  try {
    sheet.showRows(1, sheet.getMaxRows());
  } catch (err) {
    log(`ℹ️ Could not un-hide rows on "${sheet.getName()}" (${err}).`);
  }
}

/**
 * Menu action: show everything on every date-sorted tab, until the next
 * render puts the old months away again. The counterpart to the automatic
 * collapse — someone doing a year-end count needs the whole thing on screen,
 * and should not have to go hunting through Format ▸ Hide to get it.
 */
function showAllPastRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = [
    SHEET_NAMES.LUNCH_EVENT_REGISTRANTS,
    SHEET_NAMES.PROGRAM_DASHBOARD,
    SHEET_NAMES.LUNCH_SCHEDULE,
    SHEET_NAMES.LUNCH_DASHBOARD,
    SHEET_NAMES.TRIAGE
  ];
  let done = 0;
  names.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    showAllRows(sheet);
    done++;
  });
  toastIfPossible(`All past rows shown on ${done} tab(s). They collapse again on the next sync.`);
  log(`showAllPastRows: un-hid rows on ${done} tab(s).`);
}

/**
 * READ-ONLY. Counts how much history each tab is carrying, by month, and says
 * what it costs — the measurement that has to come before any decision to
 * archive. Changes nothing.
 */
function reportArchivableMonths() {
  if (!requireAuthorizedAdmin('Archive Old Months (report)')) return null;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cutoff = getVisibleMonthCutoffKey();
  const tabs = [
    { name: SHEET_NAMES.LUNCH_EVENT_REGISTRANTS, headers: HEADERS.Lunch_and_Event_Registrants, marker: 'Event_ID' },
    { name: SHEET_NAMES.PROGRAM_DASHBOARD, headers: HEADERS.Master_Program_Dashboard, marker: 'Event_ID' },
    { name: SHEET_NAMES.TRIAGE, headers: HEADERS.Deleted_Event_Triage, marker: 'Event_ID' },
    { name: SHEET_NAMES.LUNCH_SCHEDULE, headers: HEADERS.Lunch_Schedule, marker: 'Event_Date' }
  ];

  const lines = [];
  let grandTotal = 0;
  let grandOld = 0;
  let grandCells = 0;

  tabs.forEach(tab => {
    const sheet = ss.getSheetByName(tab.name);
    if (!sheet) return;
    const rows = tab.name === SHEET_NAMES.LUNCH_SCHEDULE
      ? readLunchScheduleRows(sheet)
      : readAllSectionedRows(sheet, tab.headers, tab.marker);
    const dateIdx = tab.headers.indexOf('Event_Date');

    const months = {};
    let old = 0;
    rows.forEach(row => {
      const d = coerceDate(row[dateIdx]);
      if (!d) return;
      const key = formatMonthKey(d);
      months[key] = (months[key] || 0) + 1;
      if (key < cutoff) old++;
    });

    const monthKeys = Object.keys(months).sort();
    const cells = rows.length * tab.headers.length;
    grandTotal += rows.length;
    grandOld += old;
    grandCells += cells;

    lines.push(`  • ${tab.name}: ${rows.length} row(s) across ${monthKeys.length} month(s)` +
      (monthKeys.length > 0 ? ` (${monthKeys[0]} → ${monthKeys[monthKeys.length - 1]})` : '') +
      `; ${old} older than ${cutoff}; ~${cells} cells.`);
  });

  const verdict = grandCells > ARCHIVE_ADVISORY_CELLS
    ? `⚠️ Over the ${ARCHIVE_ADVISORY_CELLS}-cell advisory line — worth archiving a year out. ` +
      `See "Old months" in USER_GUIDE.md.`
    : `✅ Comfortably inside normal size. Hiding old months is enough for now; nothing needs archiving.`;

  const report = `Old-month report (visible from ${cutoff} onward):\n${lines.join('\n')}\n` +
    `  TOTAL: ${grandTotal} row(s), ${grandOld} in collapsed months, ~${grandCells} cells.\n${verdict}`;

  log(report);
  try {
    SpreadsheetApp.getUi().alert('Old Months', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    toastIfPossible(`${grandTotal} history row(s), ${grandOld} in collapsed months — see the log.`);
  }
  return { totalRows: grandTotal, oldRows: grandOld, cells: grandCells };
}

/**
 * The point at which the history on these tabs is worth doing something about.
 * Nowhere near a Sheets hard limit — it's the point where a full re-render
 * starts eating a meaningful share of the 6-minute execution budget, which is
 * what actually breaks first.
 */
const ARCHIVE_ADVISORY_CELLS = 150000;

/**
 * Writes two stacked sub-tables ("Upcoming" then "Past") starting at
 * `startRow`, each with its own banner, header row, and zebra-striped/
 * month-tinted data rows. Returns the exact row numbers used, so callers
 * can layer per-zone validation/conditional-formatting/formulas on top.
 */
function writeUpcomingPastSections(sheet, startRow, headers, upcomingRows, pastRows, options) {
  options = options || {};
  const numCols = headers.length;
  const dateColIdx = headers.indexOf('Event_Date');
  let row = startRow;

  writeSectionBanner(sheet, row, numCols, options.upcomingLabel || '⏳ Upcoming');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const upcomingHeaderRow = row;
  row++;
  const upcomingDataStart = row;
  if (upcomingRows.length > 0) sheet.getRange(upcomingDataStart, 1, upcomingRows.length, numCols).setValues(upcomingRows);
  applyZebraStripingManualBounded(sheet, upcomingDataStart, upcomingRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, upcomingDataStart, upcomingRows.length);
  row += upcomingRows.length;
  row++; // spacer

  const pastBannerRow = row;
  writeSectionBanner(sheet, row, numCols, options.pastLabel || '🕓 Past');
  row++;
  writeSectionHeader(sheet, row, numCols, headers);
  const pastHeaderRow = row;
  row++;
  const pastDataStart = row;
  if (pastRows.length > 0) sheet.getRange(pastDataStart, 1, pastRows.length, numCols).setValues(pastRows);
  applyZebraStripingManualBounded(sheet, pastDataStart, pastRows.length, numCols);
  if (dateColIdx >= 0) applyMonthColorTint(sheet, dateColIdx + 1, pastDataStart, pastRows.length);
  row += pastRows.length;

  // Old months go away LAST, once the rows are written and formatted — hiding
  // them first would only mean formatting a hidden range, and the banner has
  // to be able to say how many went.
  const hidden = options.collapseOldMonths === false
    ? 0
    : collapseOldPastMonths(sheet, pastDataStart, pastRows, dateColIdx);
  if (hidden > 0) {
    sheet.getRange(pastBannerRow, 1).setValue(
      `${options.pastLabel || '🕓 Past'}  —  ${hidden} row(s) before ${getVisibleMonthCutoffKey()} are hidden ` +
      `(they're still here and still searchable; "Show All Past Rows" on the menu brings them back)`);
  }

  return {
    nextRow: row + 1,
    upcomingHeaderRow, upcomingDataStart, upcomingCount: upcomingRows.length,
    pastBannerRow, pastHeaderRow, pastDataStart, pastCount: pastRows.length,
    hiddenPastRows: hidden
  };
}

/**
 * Fully rebuilds a "flat" (single logical table) sheet into Upcoming/Past
 * sub-tables, driven entirely by each row's Event_Date. Used for
 * Lunch_and_Event_Registrants, Deleted_Event_Triage, and Lunch_Schedule.
 */
function renderFlatDateSheet(sheet, headers, allRows, opts) {
  opts = opts || {};
  sheet.clear();
  sheet.clearFormats();
  // Row visibility is a sheet-level property that survives clear(), exactly
  // like column visibility below — so last render's hidden old-month range
  // has to be released before this render decides its own.
  showAllRows(sheet);
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  // Column visibility is a sheet-level property that survives clear(), so a
  // tab whose hidden-column list has changed needs it re-asserted, not
  // inherited. applyColumnVisibility() (called from the afterWrite hooks)
  // shows everything not currently on the list.

  const todayKey = formatDateKey(new Date());
  const dateColIdx = headers.indexOf('Event_Date');
  const { upcoming, past } = partitionByDate(allRows, dateColIdx, todayKey);

  // opts.startRow leaves room above the tables for a fixed block (the
  // Registrants tab's Quick Mark panel), written by the caller afterwards.
  const result = writeUpcomingPastSections(sheet, opts.startRow || 1, headers, upcoming, past, opts);
  sheet.setFrozenRows(result.upcomingHeaderRow);

  if (opts.afterWrite) opts.afterWrite(sheet, headers, result);

  autosizeColumns(sheet, { force: !!opts.force, minCols: headers.length });
  return result;
}


// ============================================================================
// 6b. PER-SHEET RENDER WRAPPERS  (Registrants / Triage / Lunch_Schedule)
// ============================================================================

function renderRegistrantsSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const rows = allRows || readAllSectionedRows(sheet, headers, 'Event_ID');
  const result = renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    force,
    startRow: QUICK_MARK.rowCount + 1,
    afterWrite: applyRegistrantsFormatting
  });
  writeQuickMarkPanel(sheet, headers, rows);
  return result;
}


// ============================================================================
// 6d. QUICK MARK  (the top-of-Registrants panel)
// ============================================================================
//
// Marking people off on a serving day is the highest-frequency job in this
// workbook and was the worst served: find the right one of hundreds of rows,
// scroll right, tick two boxes, don't lose your place. The tab is sorted by
// date, so a given program's people aren't even contiguous.
//
// The Quick Mark panel puts that on cells at the top of the tab: Location ->
// Program -> Name, each a dropdown narrowed by the one before it, then
// Attended / Lunch / Lunch Only checkboxes. Tick one and the matching
// registrant row is updated in place, wherever it happens to be, and the
// panel reports what it did and clears itself for the next person.
//
// Attended and Lunch are independent: a member can pick up a take-out meal
// without ever attending the session, so ticking Lunch marks Lunch_Served
// only — it does not also mark Attended. Lunch Only exists for exactly that
// case: it marks Lunch_Served and explicitly clears Attended, so a walk-in
// take-out pickup (or a correction to one wrongly marked present) is one tick
// instead of two.
//
// The dropdowns are rebuilt on every edit of the cell to their left, because a
// static list of every name in the workbook is not a usable dropdown once
// there are hundreds — narrowing is the entire value.
// ============================================================================

const QUICK_MARK = {
  bannerRow: 1,
  labelRow: 2,
  inputRow: 3,
  statusRow: 4,
  rowCount: 5, // 4 used + 1 spacer before the tables begin
  // 1-based columns within the panel.
  LOCATION_COL: 1,
  EVENT_COL: 2,
  NAME_COL: 3,
  ATTENDED_COL: 4,
  LUNCH_COL: 5,
  // Take-out: a member can pick up a meal without attending the session at
  // all, so "they got lunch" can no longer be read as "they were here" (see
  // LUNCH_COL below). This is the explicit way to record that — Lunch_Served
  // ticked, Attended left alone (or cleared, if it was already set) — instead
  // of forcing staff to reason about it via two separate ticks every time.
  LUNCH_ONLY_COL: 6,
  CLEAR_COL: 7
};

const QUICK_MARK_LABELS =
  ['1. Location', '2. Program + Date', '3. Name', '✓ Attended', '✓ Lunch', '🥡 Lunch Only', 'Clear'];

/** Writes (or rewrites) the Quick Mark panel and seeds its Location dropdown. */
function writeQuickMarkPanel(sheet, headers, rows) {
  const numCols = Math.max(headers.length, QUICK_MARK_LABELS.length);

  writeSectionBanner(sheet, QUICK_MARK.bannerRow, numCols,
    '⚡ QUICK MARK — pick a location, then the program AND DATE, then a name, then tick Attended / Lunch / Lunch Only',
    { hero: true });

  sheet.getRange(QUICK_MARK.labelRow, 1, 1, QUICK_MARK_LABELS.length)
    .setValues([QUICK_MARK_LABELS])
    .setFontSize(TYPO.HERO_LABEL.size)
    .setFontWeight('bold')
    .setFontColor(TYPO.HERO_LABEL.color)
    .setBackground('#EFEFEF')
    .setHorizontalAlignment('center');

  // The input row itself: yellow, like every other "this is yours" cell.
  const inputRange = sheet.getRange(QUICK_MARK.inputRow, 1, 1, QUICK_MARK_LABELS.length);
  inputRange
    .setBackground(MANUAL_ENTRY_CELL_TINT)
    .setFontSize(TYPO.HERO_LABEL.size)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBorder(true, true, true, true, true, true, '#B7B7B7', SpreadsheetApp.BorderStyle.SOLID);
  try { sheet.setRowHeight(QUICK_MARK.inputRow, ROW_HEIGHTS.HERO_DATA); } catch (err) { /* row absent */ }

  applyValueListValidationBounded(sheet, QUICK_MARK.LOCATION_COL, Object.values(CALENDAR_MAP), QUICK_MARK.inputRow, 1);
  [QUICK_MARK.ATTENDED_COL, QUICK_MARK.LUNCH_COL, QUICK_MARK.LUNCH_ONLY_COL, QUICK_MARK.CLEAR_COL].forEach(col => {
    sheet.getRange(QUICK_MARK.inputRow, col)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  });

  // Program/Name start empty and are filled in by the cascade as soon as a
  // location is chosen — see refreshQuickMarkDropdowns().
  refreshQuickMarkDropdowns(sheet, rows);

  setQuickMarkStatus(sheet, numCols, 'Ready — choose a location to begin.');
}

/**
 * The one-line feedback cell under the panel's inputs. Unmerged and
 * overflowing, for the same reason as writeSectionBanner(): a merge here would
 * block setFrozenColumns() on this tab.
 */
function setQuickMarkStatus(sheet, numCols, message) {
  const width = Math.max(numCols || QUICK_MARK_LABELS.length, QUICK_MARK_LABELS.length);
  try {
    sheet.getRange(QUICK_MARK.statusRow, 1, 1, Math.max(sheet.getMaxColumns(), width)).breakApart();
  } catch (err) { /* nothing merged here */ }

  sheet.getRange(QUICK_MARK.statusRow, 1, 1, width).setBackground('#FFFFFF');
  sheet.getRange(QUICK_MARK.statusRow, 1)
    .setValue(message)
    .setFontSize(TYPO.MUTED.size + 1)
    .setFontColor('#0B5394')
    .setFontWeight('bold')
    .setHorizontalAlignment('left')
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
}

/**
 * What the Quick Mark "Program" dropdown offers at `location` (or everywhere,
 * if `location` is blank), NEAREST TO TODAY FIRST.
 *
 * ONE ENTRY PER SESSION, NOT PER PROGRAM, and each one carries its date:
 *
 *     Chair Yoga · Wed, Sep 16
 *     Chair Yoga · Wed, Sep 23
 *     🥡 Lunch Only (no program) · Wed, Sep 16
 *
 * The list used to hold bare program names, which left the panel guessing
 * which session a tick meant — it picked the nearest one and said so in the
 * status line, which is fine for "mark Marion in, she's standing here" and
 * wrong for everything else: correcting last Thursday, or marking somebody off
 * for a session two weeks out, was simply not expressible. Naming the date
 * makes the common case identical (today's session sorts first) and the
 * uncommon one possible.
 *
 * A dateless entry is still emitted per program, as the last resort for a
 * program whose sessions have aged off the dashboard entirely — picking it
 * falls back to the old nearest-session behavior.
 *
 * LUNCH ONLY entries exist because a meal is served on days with no
 * programming at all (a drop-in lunch, a holiday meal), and someone eating one
 * has to be recordable. They resolve to a synthetic session — see
 * makeLunchOnlyEventId() — which the lunch dashboard counts like any other.
 *
 * Sources, unioned: the session table (authoritative, past and future),
 * Program_Options (so an aged-off program is still offered), the registrant
 * rows (anything hand-added), and Lunch_Schedule (the lunch-only days).
 */
function collectKnownProgramChoices(location, registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const todayKey = formatDateKey(new Date());
  const todayMidnight = parseDateKey(todayKey);
  const choices = {};

  const note = (title, loc, date, options) => {
    const name = String(title || '').trim();
    if (!name) return;
    const rowLocation = String(loc || '').trim();
    if (location && rowLocation !== location) return;
    const d = coerceDate(date);
    const dateKey = d ? formatDateKey(d) : '';
    const label = d ? `${name}${LOCATION_LABEL_SEPARATOR}${formatDateLabel(d)}` : name;
    if (choices[label]) return;
    choices[label] = {
      label,
      title: name,
      dateKey,
      location: rowLocation,
      lunchOnly: !!(options && options.lunchOnly),
      // Undated entries sort last; a real session sorts by how far off it is.
      distance: d ? Math.abs(d - todayMidnight) : Infinity,
      future: d ? dateKey >= todayKey : false
    };
  };

  try {
    const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (dash) {
      const headers = HEADERS.Master_Program_Dashboard;
      const map = getIndexMap(headers);
      readAllSectionedRows(dash, headers, 'Event_ID').forEach(row => {
        note(row[map['Clean_Title']], row[map['Location']], row[map['Event_Date']]);
      });
    }
  } catch (err) {
    log(`ℹ️ Quick Mark could not read the program dashboard for its program list (${err}).`);
  }

  try {
    const options = ss.getSheetByName(SHEET_NAMES.PROGRAM_OPTIONS);
    if (options) {
      const headers = HEADERS.Program_Options;
      const map = getIndexMap(headers);
      readSimpleTable(options, headers).forEach(row => {
        // The dateless fallback entry for every program this workbook has
        // ever run, whether or not its sessions are still on the dashboard.
        note(row[map['Event']], row[map['Location']], '');
      });
    }
  } catch (err) {
    log(`ℹ️ Quick Mark could not read Program_Options for its program list (${err}).`);
  }

  const lrMap = getIndexMap(HEADERS.Lunch_and_Event_Registrants);
  (registrantRows || []).forEach(row => {
    note(row[lrMap['Event']], row[lrMap['Location']], row[lrMap['Event_Date']]);
  });

  try {
    const menu = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
    if (menu) {
      const map = getIndexMap(HEADERS.Lunch_Schedule);
      readLunchScheduleRows(menu).forEach(row => {
        const type = String(row[map['Type']] || '').trim();
        if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return; // nothing is being served
        note(LUNCH_ONLY_PROGRAM_LABEL, row[map['Location']], row[map['Event_Date']], { lunchOnly: true });
      });
    }
  } catch (err) {
    log(`ℹ️ Quick Mark could not read ${SHEET_NAMES.LUNCH_SCHEDULE} for its lunch-only options (${err}).`);
  }

  return Object.keys(choices)
    .map(k => choices[k])
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.future !== b.future) return a.future ? -1 : 1; // a tie goes to the upcoming one
      return a.label.localeCompare(b.label);
    });
}

/**
 * The program name used for a meal eaten on a day with no programming behind
 * it. Stored verbatim in the Registrants tab's Event column, so it reads the
 * same on the sheet, in the dropdown, and on the printed sign-in sheet.
 */
const LUNCH_ONLY_PROGRAM_LABEL = '🥡 Lunch Only (no program)';

/**
 * Event_ID prefix for a lunch-only row. Deliberately NOT a computeEventId()
 * hash: there is no calendar event to key one off, and the prefix is what lets
 * buildDashboardRollup() recognize the row as legitimately session-less rather
 * than as an orphan pointing at a deleted event.
 */
const LUNCH_ONLY_EVENT_ID_PREFIX = 'LUNCHONLY:';

function makeLunchOnlyEventId(dateKey, location) {
  return `${LUNCH_ONLY_EVENT_ID_PREFIX}${dateKey}|${String(location || '').trim()}`;
}

function isLunchOnlyEventId(eventId) {
  return String(eventId || '').indexOf(LUNCH_ONLY_EVENT_ID_PREFIX) === 0;
}

/**
 * Splits a Quick Mark program choice back into { title, dateKey, lunchOnly }.
 *
 * Parsed from the RIGHT and validated as a date, so a program whose own name
 * contains the separator ("Coffee · Chat") still resolves correctly: the split
 * is only taken when what follows it actually parses as a date label.
 */
function parseQuickMarkProgramChoice(value) {
  const raw = String(value || '').trim();
  if (!raw) return { title: '', dateKey: '', lunchOnly: false };
  const idx = raw.lastIndexOf(LOCATION_LABEL_SEPARATOR);
  let title = raw;
  let dateKey = '';
  if (idx > 0) {
    const tail = raw.substring(idx + LOCATION_LABEL_SEPARATOR.length).trim();
    const parsed = coerceDate(tail);
    if (parsed) {
      title = raw.substring(0, idx).trim();
      dateKey = formatDateKey(parsed);
    }
  }
  return { title, dateKey, lunchOnly: title === LUNCH_ONLY_PROGRAM_LABEL };
}

/** Every name on Member_Roll — the standing directory, registered or not. */
function collectKnownMembers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const sheet = ss.getSheetByName(SHEET_NAMES.MEMBER_ROLL);
    if (!sheet) return [];
    const headers = HEADERS.Member_Roll;
    const map = getIndexMap(headers);
    return readSimpleTable(sheet, headers)
      .map(row => String(row[map['Name']] || '').trim())
      .filter(Boolean);
  } catch (err) {
    log(`ℹ️ Quick Mark could not read Member_Roll for its name list (${err}).`);
    return [];
  }
}

/**
 * A Sheets dropdown built from a list this long stops being a dropdown. Cap
 * it — the ordering above guarantees the cut falls on the least relevant end.
 */
const QUICK_MARK_MAX_DROPDOWN_ITEMS = 400;

/**
 * Rebuilds the Program and Name dropdowns from whatever Location/Program is
 * currently selected, narrowing each list to what's actually possible.
 *
 * PROGRAMS: one entry per SESSION, each naming its date, nearest first, plus a
 * lunch-only option per catered day — see collectKnownProgramChoices().
 *
 * NAMES: the people already registered for the chosen program first (the
 * common case — you are ticking someone off a list), then everyone else on
 * Member_Roll. The SAME BUG the program list had applied here: sourcing names
 * from registrant rows alone meant a known member who had not registered for
 * this particular session could not be selected, which is exactly the walk-in
 * this panel is for. applyQuickMark() adds a row for them.
 */
function refreshQuickMarkDropdowns(sheet, rows) {
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);
  const registrantRows = rows || readAllSectionedRows(sheet, headers, 'Event_ID');

  const location = String(sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.LOCATION_COL).getValue() || '').trim();
  const programChoice = String(sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.EVENT_COL).getValue() || '').trim();
  const selection = parseQuickMarkProgramChoice(programChoice);

  const programList = collectKnownProgramChoices(location, registrantRows)
    .slice(0, QUICK_MARK_MAX_DROPDOWN_ITEMS)
    .map(choice => choice.label);

  // Registered-for-this-selection names, in the order the rows themselves are
  // in (the tab is date-sorted, so that is nearest-session-first already).
  // Narrowed by the chosen DATE as well as the program when the choice carried
  // one, which is the point of dated choices: on a date this program runs
  // twice a week, the list is the people expected on THAT day.
  const registered = [];
  const registeredSeen = {};
  registrantRows.forEach(row => {
    const rowLocation = String(row[map['Location']] || '').trim();
    const rowEvent = String(row[map['Event']] || '').trim();
    const rowName = String(row[map['Name']] || '').trim();
    if (!rowName) return;
    if (location && rowLocation !== location) return;
    if (selection.title && rowEvent !== selection.title) return;
    if (selection.dateKey) {
      const d = coerceDate(row[map['Event_Date']]);
      if (!d || formatDateKey(d) !== selection.dateKey) return;
    }
    const key = normalizeNameKey(rowName);
    if (registeredSeen[key]) return;
    registeredSeen[key] = true;
    registered.push(rowName);
  });

  const others = [];
  collectKnownMembers().sort((a, b) => a.localeCompare(b)).forEach(name => {
    const key = normalizeNameKey(name);
    if (registeredSeen[key]) return;
    registeredSeen[key] = true;
    others.push(name);
  });

  const nameList = registered.concat(others).slice(0, QUICK_MARK_MAX_DROPDOWN_ITEMS);

  applyValueListValidationBounded(sheet, QUICK_MARK.EVENT_COL, programList.length ? programList : ['(no programs yet)'],
    QUICK_MARK.inputRow, 1);
  // allowInvalid on the NAME cell: a first-time walk-in has no row and is on
  // no roll, so their name has to be typeable rather than only selectable.
  applyOpenValueListValidationBounded(sheet, QUICK_MARK.NAME_COL,
    nameList.length ? nameList : ['(type a name)'], QUICK_MARK.inputRow, 1);
  return { programList, nameList, registeredCount: registered.length };
}

/** Blanks the panel's inputs, ready for the next person. */
function clearQuickMarkInputs(sheet) {
  sheet.getRange(QUICK_MARK.inputRow, 1, 1, QUICK_MARK_LABELS.length).clearContent();
}

/**
 * Applies a Quick Mark tick to the real registrant row(s).
 *
 * Matches on Location + Event + Name. A name legitimately appears on several
 * rows — the same person registered for several dates of the same program — so
 * this marks the one for the NEAREST session (today first, then the next
 * upcoming, then the most recent past), which is what someone standing at a
 * sign-in desk means. The status line always says which date it marked, so a
 * wrong guess is visible immediately rather than silent.
 */
function applyQuickMark(sheet, column) {
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);

  const location = String(sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.LOCATION_COL).getValue() || '').trim();
  const programChoice = String(sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.EVENT_COL).getValue() || '').trim();
  const selection = parseQuickMarkProgramChoice(programChoice);
  const name = String(sheet.getRange(QUICK_MARK.inputRow, QUICK_MARK.NAME_COL).getValue() || '').trim();
  const numCols = headers.length;

  if (!name) {
    setQuickMarkStatus(sheet, numCols, '⚠️ Pick a name first — nothing was marked.');
    sheet.getRange(QUICK_MARK.inputRow, column).setValue(false);
    return;
  }

  const zones = getSectionZones(sheet, 'Event_ID');
  const nameKey = normalizeNameKey(name);
  const todayKey = formatDateKey(new Date());
  const candidates = [];

  zones.forEach(zone => {
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;
    const values = sheet.getRange(zone.dataStart, 1, count, numCols).getValues();
    values.forEach((row, i) => {
      if (normalizeNameKey(row[map['Name']]) !== nameKey) return;
      if (location && String(row[map['Location']] || '').trim() !== location) return;
      if (selection.title && String(row[map['Event']] || '').trim() !== selection.title) return;
      const d = coerceDate(row[map['Event_Date']]);
      // A dated choice means THAT session and no other — the whole reason the
      // dropdown names dates. Only an undated choice falls back to the
      // nearest-session guess below.
      if (selection.dateKey && (!d || formatDateKey(d) !== selection.dateKey)) return;
      candidates.push({ sheetRow: zone.dataStart + i, date: d, dateKey: d ? formatDateKey(d) : '' });
    });
  });

  if (candidates.length === 0) {
    // Nobody registered under that name for that program. Now that the
    // dropdowns offer every program and every known member, this is no longer
    // a dead end — it is the walk-in case, and it is the reason the lists were
    // widened in the first place.
    sheet.getRange(QUICK_MARK.inputRow, column).setValue(false);
    addQuickMarkWalkIn(sheet, { name, selection, location, column, numCols });
    return;
  }

  // Today, else the soonest future date, else the most recent past one.
  candidates.sort((a, b) => {
    const rank = c => (c.dateKey === todayKey ? 0 : (c.dateKey > todayKey ? 1 : 2));
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 2) return (b.date || 0) - (a.date || 0); // past: newest first
    return (a.date || 0) - (b.date || 0);                    // future: soonest first
  });
  const target = candidates[0];

  const isLunchOnly = column === QUICK_MARK.LUNCH_ONLY_COL;
  const isLunch = column === QUICK_MARK.LUNCH_COL || isLunchOnly;
  const columnName = isLunch ? 'Lunch_Served' : 'Attended';
  if (map[columnName] === undefined) {
    setQuickMarkStatus(sheet, numCols, `⚠️ This tab has no "${columnName}" column yet — run Sync Registrations once.`);
    return;
  }

  sheet.getRange(target.sheetRow, map[columnName] + 1).setValue(true);
  // Lunch no longer implies attendance in either direction: a member can pick
  // up a meal without ever coming in (take-out), so a Lunch tick alone leaves
  // Attended exactly as it was — tick Attended too for a normal dine-in mark.
  // Lunch Only goes one step further and CLEARS Attended, because it exists
  // specifically to say "fed, not present" even when Attended was already
  // ticked (e.g. correcting an earlier mistaken mark).
  if (isLunchOnly && map['Attended'] !== undefined) {
    sheet.getRange(target.sheetRow, map['Attended'] + 1).setValue(false);
  }
  // Hand-marking is a manual edit — say so, the same as any other.
  if (map['Manual_Override'] !== undefined) {
    const overrideCell = sheet.getRange(target.sheetRow, map['Manual_Override'] + 1);
    const current = String(overrideCell.getValue() || '').trim();
    if (current === 'Auto-Synced' || current === '') overrideCell.setValue('Manually Edited');
  }

  const dateLabel = target.date ? formatDateLabel(target.date) : 'an undated session';
  const extra = candidates.length > 1 ? ` (${candidates.length} sessions matched — marked the nearest)` : '';
  const what = isLunchOnly ? 'lunch (take-out, not attending)' : (isLunch ? 'lunch' : 'attendance');
  setQuickMarkStatus(sheet, numCols, `✅ Marked ${what} for ${name} — ${dateLabel}${extra}.`);
  toastIfPossible(`✅ ${name}: ${what} marked for ${dateLabel}.`);

  clearQuickMarkInputs(sheet);
  refreshQuickMarkDropdowns(sheet, null);
}

/**
 * The walk-in path: someone is standing there, they are not on the list for
 * this program, and marking them has to be possible without a form
 * submission.
 *
 * Creates a "Manually Added" registrant row against the NEAREST session of
 * the chosen program (today first, then the next upcoming, then the most
 * recent past — the same rule applyQuickMark() uses to pick among existing
 * rows), then marks it. Manually Added is a protected state: see
 * getProtectedRegistrantKeys(), which is what stops the next registration
 * sync from overwriting or removing the row.
 *
 * Asks first. It writes a person into the record and, if the row is for a
 * lunch-serving date, into the catering count — small, but not something to
 * do because a checkbox was clicked by accident.
 */
function addQuickMarkWalkIn(sheet, args) {
  const { name, selection, location, column, numCols } = args;
  const program = selection ? selection.title : '';

  if (!program) {
    setQuickMarkStatus(sheet, numCols,
      `⚠️ "${name}" has no registration yet. Pick a program in box 2 and tick again to add them as a walk-in.`);
    return;
  }

  const session = selection.lunchOnly
    ? buildLunchOnlySession(selection.dateKey, location)
    : findNearestSessionForProgram(program, location, selection.dateKey);
  if (!session) {
    const when = selection.dateKey ? ` on ${formatDateLabel(parseDateKey(selection.dateKey))}` : '';
    setQuickMarkStatus(sheet, numCols,
      `⚠️ Couldn't find any session of "${program}"${location ? ` at ${location}` : ''}${when} to add "${name}" to. ` +
      `Run Sync Cal if the program is new.`);
    return;
  }

  const isAttendedCol = column === QUICK_MARK.ATTENDED_COL;
  const isLunchOnly = column === QUICK_MARK.LUNCH_ONLY_COL;
  const isLunch = column === QUICK_MARK.LUNCH_COL || isLunchOnly;
  const lunchOffered = isLunchOfferedOn(session.date, session.location);
  const dateLabel = formatDateLabel(session.date);
  // A walk-in takes its Attended value from WHICH box triggered it, the same
  // as an existing row does in applyQuickMark(): the Attended tick is the
  // only one that marks attendance, so a brand-new Lunch or Lunch Only
  // walk-in is fed without being recorded as present — a take-out pickup can
  // add someone to the record for the first time too.
  const marksAttended = isAttendedCol;

  if (!confirmConsequentialAction(`Add ${name} as a walk-in?`,
    `"${name}" has no registration for ${program}.\n\n` +
    `A new row will be added for ${program} — ${dateLabel} (${session.location}), marked ` +
    `${isLunchOnly ? 'lunch served (take-out — not marked attended)' : (isLunch ? 'lunch served' : 'attended')} ` +
    `and flagged "Manually Added".` +
    (isLunch && !lunchOffered ? '\n\nNote: no lunch is scheduled for that date, so no meal will be counted.' : ''),
    false)) {
    setQuickMarkStatus(sheet, numCols, `Nothing added. "${name}" is still not registered for ${program}.`);
    return;
  }

  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);
  const row = new Array(headers.length).fill('');
  row[map['Event_Date']] = session.date;
  row[map['Location']] = session.location;
  row[map['Event']] = session.title;
  row[map['Name']] = name;
  row[map['Attended']] = marksAttended;
  row[map['Lunch_Served']] = isLunch;
  row[map['Person_Type']] = 'Attendee';
  row[map['Lunch_Type']] = isLunch && lunchOffered ? resolveWalkInLunchType(session) : 'No Lunch';
  row[map['Lunch_Status']] = isLunch && lunchOffered ? 'Needed' : 'No Lunch';
  row[map['Program_Status']] = 'Active';
  row[map['Primary_Registrant']] = 'Self';
  row[map['Party_Size']] = 1;
  row[map['Admin_Notes']] = isLunchOnly
    ? `Take-out walk-in added at the desk on ${formatDateLabel(new Date())}.`
    : `Walk-in added at the desk on ${formatDateLabel(new Date())}.`;
  row[map['Manual_Override']] = 'Manually Added';
  row[map['Form_Source']] = 'Walk-in (no form)';
  row[map['Event_ID']] = session.eventId;

  const existing = readAllSectionedRows(sheet, headers, 'Event_ID');
  existing.push(row);
  renderRegistrantsSheet(false, existing);

  const what = isLunchOnly ? 'lunch (take-out, not attending)' : (isLunch ? 'lunch' : 'attendance');
  toastIfPossible(`✅ ${name} added as a walk-in on ${program} — ${dateLabel}, ${what} marked.`);
  setQuickMarkStatus(sheet, numCols,
    `✅ Added ${name} to ${program} — ${dateLabel} (walk-in), ${what} marked.`);
  clearQuickMarkInputs(sheet);
  refreshQuickMarkDropdowns(sheet, null);
}

/**
 * The synthetic "session" a lunch-only walk-in is recorded against: a real
 * date and location, no calendar event, and an Event_ID that says so (see
 * makeLunchOnlyEventId()). Everything downstream keys off date+location
 * anyway, so the meal is counted exactly like a program-day meal.
 */
function buildLunchOnlySession(dateKey, location) {
  const key = dateKey || formatDateKey(new Date());
  const loc = String(location || '').trim();
  if (!loc) return null; // a meal has to belong to a kitchen
  const date = parseDateKey(key);
  return {
    date,
    dateKey: key,
    location: loc,
    title: LUNCH_ONLY_PROGRAM_LABEL,
    eventId: makeLunchOnlyEventId(key, loc),
    lunchType: ''
  };
}

/**
 * A session of `program`: the one on `wantedDateKey` when the Quick Mark
 * choice named a date, else the one nearest to today (today, else the soonest
 * upcoming, else the most recent past). Read from the session table, which is
 * the only place an Event_ID (the key every registrant row is joined on)
 * can come from.
 */
function findNearestSessionForProgram(program, location, wantedDateKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!dash) return null;

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const wanted = normalizeNameKey(program);

  const matches = [];
  readAllSectionedRows(dash, headers, 'Event_ID').forEach(row => {
    if (normalizeNameKey(row[map['Clean_Title']]) !== wanted) return;
    const rowLocation = String(row[map['Location']] || '').trim();
    if (location && rowLocation !== location) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    if (wantedDateKey && formatDateKey(date) !== wantedDateKey) return;
    matches.push({
      date,
      dateKey: formatDateKey(date),
      location: rowLocation,
      title: String(row[map['Clean_Title']] || '').trim(),
      eventId: String(row[map['Event_ID']] || '').trim(),
      lunchType: ''
    });
  });
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const rank = c => (c.dateKey === todayKey ? 0 : (c.dateKey > todayKey ? 1 : 2));
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 2) return b.date - a.date; // past: newest first
    return a.date - b.date;                    // future: soonest first
  });
  return matches[0];
}

/** Hot/Cold for a walk-in's meal, taken from that day's menu; 'Hot' if the menu says nothing. */
function resolveWalkInLunchType(session) {
  const info = getMealInfoForDate(session.date, session.location);
  const type = info ? String(info.type || '').trim() : '';
  return (type === 'Hot' || type === 'Cold') ? type : 'Hot';
}

function renderTriageSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.TRIAGE);
  const headers = HEADERS.Deleted_Event_Triage;
  const rows = allRows || readAllSectionedRows(sheet, headers, 'Event_ID');
  return renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming (Triaged)',
    pastLabel: '🕓 Past (Triaged)',
    force,
    afterWrite: applyRegistrantsFormatting
  });
}

/**
 * Shared formatting for Lunch_and_Event_Registrants AND Deleted_Event_Triage
 * — both carry the same Manual_Override / Program_Status / Lunch_Status /
 * Order_Ahead_Flag / Event_Date columns, just with Triage adding a few
 * extra trailing columns that don't need special styling beyond zebra.
 */
/**
 * Columns on Registrants/Triage a person is MEANT to fill in. Everything else
 * on the row came from a form or is derived, and gets no yellow — so "yellow
 * means yours" holds across every tab in the workbook (same wash as the lunch
 * dashboard's hand-entry columns, via labelManualEntryColumns()).
 */
const REGISTRANT_EDITABLE_COLUMNS = [
  'Attended', 'Lunch_Served',
  'Day1_Dined_In', 'Day1_Taken_Out', 'Subs_Dined_In', 'Subs_Taken_Out', 'Meals_In_Fridge',
  'Phone', 'Lunch_Type', 'Lunch_Status', 'Program_Status', 'Admin_Notes'
];

/**
 * Columns that only ever matter when something has gone wrong — internal keys
 * and the raw form link. Hidden during normal use; unhide from the Sheets UI
 * (or read them in the formula bar) when debugging.
 *
 * Manual_Override is NOT hidden despite being machine-written: it is the one
 * column that explains why a row is a different color, and hiding the legend
 * to a color you can plainly see is worse than the column costing a little
 * width.
 */
const REGISTRANT_HIDDEN_COLUMNS = ['Event_ID', 'Party_ID', 'Form_Source'];

/** Member_Roll columns that come off the forms rather than from staff — refreshed, not hand-kept. */
const MEMBER_ROLL_DERIVED_CONTACT_COLUMNS = ['Phone', 'Email'];

function applyRegistrantsFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];

  zones.forEach(z => {
    if (z.count < 1) return;
    applyManualOverrideValidationBounded(sheet, map['Manual_Override'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Program_Status'] + 1, PROGRAM_STATUS_OPTIONS, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Status'] + 1, LUNCH_STATUS_OPTIONS, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Type'] + 1, REGISTRANT_LUNCH_TYPE_OPTIONS, z.start, z.count);
    // Real checkboxes, not free text: a tick is one click and reads back as a
    // boolean, which is what Served_Confirmed counts.
    REGISTRANT_DAYOF_COLUMNS.forEach(h => {
      if (map[h] === undefined) return;
      sheet.getRange(z.start, map[h] + 1, z.count, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });
    // Whole meal counts, not free text — this is what buildDashboardRollup()
    // sums into Master_Lunch_Dashboard's Day_1_*/Subs_* columns.
    REGISTRANT_MEAL_COUNT_COLUMNS.forEach(h => {
      if (map[h] === undefined) return;
      sheet.getRange(z.start, map[h] + 1, z.count, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation()
          .requireNumberGreaterThanOrEqualTo(0)
          .setAllowInvalid(false)
          .build())
        .setNumberFormat('0')
        .setHorizontalAlignment('center');
    });
  });

  const overrideCol = map['Manual_Override'] + 1;
  const programCol = map['Program_Status'] + 1;
  const lunchCol = map['Lunch_Status'] + 1;
  const orderAheadCol = map['Order_Ahead_Flag'] + 1;
  const dateCol = map['Event_Date'] + 1;
  const editableCols = REGISTRANT_EDITABLE_COLUMNS
    .filter(h => map[h] !== undefined)
    .map(h => map[h] + 1);

  const rules = [];
  zones.forEach(z => {
    if (z.count < 1) return;
    // MANUAL_OVERRIDE, RECONSIDERED. It used to tint most of the row purple,
    // which fought with every other signal on it: the status colors, the
    // month tint, and now the yellow editable band. On a tab where the
    // interesting question is "who still needs marking?", a whole-row wash
    // for "this row was hand-edited" is the least useful thing competing for
    // the strongest visual channel.
    //
    // So the tint is now confined to the Manual_Override CELL itself — the
    // column that names the state — and the row is left to say what staff
    // actually scan for. The information is not lost, just demoted to where
    // it belongs, and the cell is still impossible to miss when you look at
    // the column.
    const overrideRange = sheet.getRange(z.start, overrideCol, z.count, 1);
    ['Manually Edited', 'Manually Added'].forEach(text => {
      const rule = buildTextEqualsRuleForRanges([overrideRange], text, MANUAL_OVERRIDE_COLOR);
      if (rule) rules.push(rule);
    });
  });

  const activeZones = zones.filter(z => z.count > 0);
  const programRanges = activeZones.map(z => sheet.getRange(z.start, programCol, z.count, 1));
  const lunchRanges = activeZones.map(z => sheet.getRange(z.start, lunchCol, z.count, 1));
  const orderAheadRanges = activeZones.map(z => sheet.getRange(z.start, orderAheadCol, z.count, 1));

  ['Cancelled', 'Waitlisted', 'Active', 'Superseded'].forEach(text => {
    const rule = buildTextEqualsRuleForRanges(programRanges, text, REGISTRANT_STATUS_COLORS[text]);
    if (rule) rules.push(rule);
  });
  ['Cancelled', 'Waitlisted', 'Needed', 'Superseded'].forEach(text => {
    const rule = buildTextEqualsRuleForRanges(lunchRanges, text, REGISTRANT_STATUS_COLORS[text]);
    if (rule) rules.push(rule);
  });
  if (orderAheadRanges.length > 0) {
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenCellNotEmpty().setBackground(ORDER_AHEAD_FLAG_COLOR).setRanges(orderAheadRanges).build());
  }

  // Location color-coding on the Location cell, same as every other tab.
  const locRanges = activeZones.map(z => sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  rules.push(...buildLocationColorRules(locRanges));

  sheet.setConditionalFormatRules(rules);

  // The yellow "this is yours to fill in" wash, and the header pencils that
  // label it — identical treatment to Master_Lunch_Dashboard's columns.
  labelManualEntryColumns(sheet, result.upcomingHeaderRow, headers, REGISTRANT_EDITABLE_COLUMNS);
  labelManualEntryColumns(sheet, result.pastHeaderRow, headers, REGISTRANT_EDITABLE_COLUMNS);
  zones.forEach(z => {
    if (z.count < 1) return;
    tintManualEntryColumns(sheet, z.start, z.count, headers, REGISTRANT_EDITABLE_COLUMNS);
  });

  applyColumnVisibility(sheet, headers, REGISTRANT_HIDDEN_COLUMNS);
  // Name is the row's identity; keep it and the date on screen while scrolling
  // right through the form-supplied columns.
  freezeColumnsSafely(sheet, Math.min(map['Name'] + 1, headers.length));

  // Warn (don't block) on the columns the sync owns — a correction typed into
  // Event_Date or Name doesn't move the registration, it just gets overwritten
  // and loses the row's link to its session.
  protectDerivedColumns(sheet, headers,
    ['Event_Date', 'Location', 'Event', 'Name', 'Person_Type', 'Primary_Registrant',
      'Party_Size', 'Order_Ahead_Flag', 'Event_ID', 'Party_ID'],
    zones);

  // No autosize here on purpose: this runs as renderFlatDateSheet()'s
  // afterWrite hook, and that function autosizes immediately afterward.
  // Doing it in both places sized Registrants and Triage twice per render.
}

/**
 * Warning-only protection on columns this script OWNS and rewrites.
 *
 * Deliberately warning-based (setWarningOnly(true)) rather than a hard lock:
 * a hard protection would also block this script's own writes unless every
 * render remembered to unprotect and re-protect, and an admin who genuinely
 * needs to correct a cell shouldn't have to go hunting through protection
 * settings to do it. What people actually need is to be TOLD, at the moment
 * they type, that the value is derived and will be overwritten — which is
 * exactly what the warning dialog says.
 *
 * Re-created from scratch each render (matched by description) so the
 * protected range always matches the columns actually there.
 */
const PROTECTION_TAG = 'Auto-managed by Calendar & Form Manager';

function protectDerivedColumns(sheet, headers, protectedNames, zones) {
  const map = getIndexMap(headers);

  // Cleared ONCE, for the whole sheet, before anything is re-created —
  // clearing per zone would have each zone wipe the previous one's work.
  // Only this script's own protections are touched; anyone else's are left be.
  //
  // The whole call is guarded, not just the per-protection remove(): the
  // protection API needs authorization the script does not have inside a
  // simple onEdit trigger, and a render IS reachable from there (a Quick Mark
  // walk-in rebuilds this tab). Warning labels are a nicety; aborting a
  // render that has already cleared the sheet is not survivable.
  try {
    sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE)
      .filter(p => String(p.getDescription() || '').indexOf(PROTECTION_TAG) === 0)
      .forEach(p => {
        try { p.remove(); } catch (err) { /* someone else's, or already gone */ }
      });
  } catch (err) {
    log(`ℹ️ Could not read protections on "${sheet.getName()}" (${err}) — leaving them as they are.`);
    return;
  }

  (zones || []).forEach(z => {
    if (z.count < 1) return;
    protectedNames.forEach(name => {
      const idx = map[name];
      if (idx === undefined) return;
      try {
        sheet.getRange(z.start, idx + 1, z.count, 1)
          .protect()
          .setDescription(`${PROTECTION_TAG} — "${name}" is filled in automatically and will be overwritten.`)
          .setWarningOnly(true);
      } catch (err) {
        log(`ℹ️ Could not set a protection warning on "${name}" of ${sheet.getName()} (${err}).`);
      }
    });
  });
}

/**
 * Hides the columns named in `hiddenNames` and shows every other one, so a
 * re-render can't leave a column hidden after it's been taken off the list.
 */
function applyColumnVisibility(sheet, headers, hiddenNames) {
  const map = getIndexMap(headers);
  const hide = new Set((hiddenNames || []).filter(h => map[h] !== undefined).map(h => map[h] + 1));
  for (let c = 1; c <= headers.length; c++) {
    try {
      if (hide.has(c)) sheet.hideColumns(c); else sheet.showColumns(c);
    } catch (err) { /* a column beyond the sheet's width — nothing to hide */ }
  }
}

function renderLunchScheduleSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_SCHEDULE);
  const headers = HEADERS.Lunch_Schedule;
  const rows = allRows || readLunchScheduleRows(sheet);
  const result = renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Menu',
    pastLabel: '🕓 Past Menu',
    force,
    afterWrite: applyLunchScheduleFormatting
  });
  invalidateMealInfoIndex(); // this tab is exactly what getMealInfoIndex() is built from
  return result;
}

function applyLunchScheduleFormatting(sheet, headers, result) {
  const map = getIndexMap(headers);
  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];

  zones.forEach(z => {
    if (z.count < 1) return;
    applyValueListValidationBounded(sheet, map['Location'] + 1, Object.values(CALENDAR_MAP), z.start, z.count);
    applyValueListValidationBounded(sheet, map['Type'] + 1, LUNCH_TYPE_OPTIONS, z.start, z.count);
  });

  const rules = [];
  const activeZones = zones.filter(z => z.count > 0);
  const locRanges = activeZones.map(z => sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  rules.push(...buildLocationColorRules(locRanges));

  const typeRanges = activeZones.map(z => sheet.getRange(z.start, map['Type'] + 1, z.count, 1));
  const notServingRule = buildTextEqualsRuleForRanges(typeRanges, 'Not Serving', NOT_SERVING_COLOR);
  if (notServingRule) rules.push(notServingRule);

  sheet.setConditionalFormatRules(rules);

  // The ADD block goes last, below everything, so a paste of any size just
  // extends the sheet downward instead of colliding with the tables.
  writeLunchAddBlock(sheet, result.nextRow + 1);
}

/**
 * Writes the "paste your CSV here" block at the bottom of Lunch_Schedule.
 *
 * BELOW the tables on purpose. A paste area at the TOP has to be a fixed
 * height, and a 40-row paste into a 12-row box overflows into whatever is
 * beneath it — which on this tab is the live schedule. At the bottom there is
 * nothing to overflow into: the paste simply makes the sheet taller, and
 * harvestPastedMenuRows() sweeps everything from the header row down.
 */
function writeLunchAddBlock(sheet, startRow) {
  const numCols = LUNCH_ADD_HEADERS.length;
  // Make room BEFORE writing anything: getRange() throws on a row that isn't
  // there, and on a freshly-cleared tab the schedule can easily run past the
  // sheet's default height.
  const needed = startRow + 1 + LUNCH_ADD_BLANK_ROWS;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());

  writeSectionBanner(sheet, startRow, numCols,
    `${LUNCH_ADD_MARKER} — paste CSV here (Date, Location, Type, Description, Shorthand). ` +
    `One row or a hundred; they move into the schedule above automatically.`);

  const headerRow = startRow + 1;
  sheet.getRange(headerRow, 1, 1, numCols)
    .setValues([LUNCH_ADD_HEADERS])
    .setFontWeight('bold')
    .setFontSize(TYPO.COLUMN_HEADER.size)
    .setFontColor(TYPO.COLUMN_HEADER.color)
    .setBackground(TYPO.COLUMN_HEADER.background);

  const firstRow = headerRow + 1;
  const blankRows = LUNCH_ADD_BLANK_ROWS;
  const entry = sheet.getRange(firstRow, 1, blankRows, numCols);
  entry.setBackground(MANUAL_ENTRY_CELL_TINT)
    .setBorder(true, true, true, true, true, true, '#D9D9D9', SpreadsheetApp.BorderStyle.SOLID);

  // Dropdowns on the two columns with a fixed vocabulary. requireValueInList's
  // second argument false = show the list but DON'T reject anything else:
  // a paste must never be blocked by validation, and canonicalizeLocation() /
  // canonicalizeLunchType() already snap free text onto these values.
  const locationRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.values(CALENDAR_MAP), true).setAllowInvalid(true).build();
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(LUNCH_TYPE_OPTIONS, true).setAllowInvalid(true).build();
  sheet.getRange(firstRow, 2, blankRows, 1).setDataValidation(locationRule);
  sheet.getRange(firstRow, 3, blankRows, 1).setDataValidation(typeRule);
}


// ============================================================================
// 6c. MEMORY TABS  (Member_Roll / Program_Options)
// ============================================================================
//
// Everything else in this workbook is derived: wipe it, re-sync, and it comes
// back. These two tabs are the exception — they're where the ORGANIZATION'S
// OWN knowledge accumulates, the things no calendar event or form response can
// tell you. "Marion always brings her sister." "This program needs the big
// room." "Cold lunch only, no dairy."
//
// Each tab is therefore split down the middle:
//   LEFT  — recomputed from the registrant/session history every refresh.
//           Never hand-edit; it will be overwritten.
//   RIGHT — MEMBER_ROLL_STAFF_COLUMNS / PROGRAM_OPTIONS_STAFF_COLUMNS. Written
//           only by people, never by this script. Keyed by Name (or
//           Event+Location), so a row keeps its notes as long as the key is
//           stable — and normalizeNameKey() makes the key survive the casing
//           and spacing drift that "Jane Smith" vs "jane smith " produces
//           across separate form submissions.
//
// This is also what the Quick Mark dropdowns are built from — the unique
// people and programs, deduplicated once here rather than re-derived on every
// keystroke.
// ============================================================================

/**
 * Rebuilds both memory tabs from current data, preserving every staff column.
 * Called at the end of a registration sync (where the source rows are already
 * in memory) and from initSheet().
 */
function refreshMemoryTabs(registrantRows, sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    refreshMemberRoll(ss, registrantRows);
    refreshProgramOptions(ss, sessionRows);
  } catch (err) {
    // Never let a memory-tab refresh take down a sync — these tabs are
    // reference material, not the system of record.
    log(`⚠️ Could not refresh the memory tabs (${err}) — the rest of the sync is unaffected.`);
  }
}

/**
 * One row per unique person, keyed on normalizeNameKey(Name). Recomputes the
 * history columns, carries the staff columns forward untouched, and keeps a
 * person on the roll even after their sessions age out — a member who came
 * once last year is still a member you might want notes on.
 */
function refreshMemberRoll(ss, registrantRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.MEMBER_ROLL);
  const headers = HEADERS.Member_Roll;
  const map = getIndexMap(headers);

  // What staff have already written, by person key.
  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = normalizeNameKey(row[map['Name']]);
    if (key) existingByKey[key] = row;
  });

  const lrHeaders = HEADERS.Lunch_and_Event_Registrants;
  const lrMap = getIndexMap(lrHeaders);
  const rows = registrantRows ||
    readAllSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS), lrHeaders, 'Event_ID');

  const people = {};
  rows.forEach(row => {
    const name = String(row[lrMap['Name']] || '').trim();
    const key = normalizeNameKey(name);
    if (!key) return;
    const d = coerceDate(row[lrMap['Event_Date']]);
    if (!people[key]) {
      people[key] = { name, times: 0, first: d, last: d, locations: {}, lunches: {}, phone: '', email: '', contactAt: null };
    }
    const p = people[key];
    p.name = name; // last spelling seen wins for DISPLAY; the key stays stable
    p.times++;
    if (d && (!p.first || d < p.first)) p.first = d;
    if (d && (!p.last || d > p.last)) p.last = d;
    // The MOST RECENT contact details they gave, not the first: a phone number
    // is the kind of thing that changes, and the newest one somebody typed on
    // a form is the best guess this tab can make. Rows with no date at all
    // still count, but never displace a dated one.
    const phone = String(row[lrMap['Phone']] || '').trim();
    const email = String(row[lrMap['Email']] || '').trim();
    if ((phone || email) && (!p.contactAt || (d && d >= p.contactAt))) {
      if (phone) p.phone = phone;
      if (email) p.email = email;
      if (d) p.contactAt = d;
    }
    const loc = String(row[lrMap['Location']] || '').trim();
    if (loc) p.locations[loc] = true;
    const lunch = String(row[lrMap['Lunch_Type']] || '').trim();
    if (lunch && lunch !== 'No Lunch') p.lunches[lunch] = (p.lunches[lunch] || 0) + 1;
  });

  // Anyone already on the roll but absent from the current history stays,
  // with their computed columns left as they were.
  const outRows = [];
  const seen = {};
  Object.keys(people).sort((a, b) => people[a].name.localeCompare(people[b].name)).forEach(key => {
    const p = people[key];
    const row = new Array(headers.length).fill('');
    const prior = existingByKey[key];
    if (prior) MEMBER_ROLL_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
    row[map['Name']] = p.name;
    // Never blank out a number we already had just because the latest
    // submission omitted one — a known way to reach someone is not something
    // to lose to a skipped field.
    row[map['Phone']] = p.phone || (prior ? prior[map['Phone']] : '') || '';
    row[map['Email']] = p.email || (prior ? prior[map['Email']] : '') || '';
    row[map['Times_Seen']] = p.times;
    row[map['First_Seen']] = p.first || '';
    row[map['Last_Seen']] = p.last || '';
    row[map['Locations']] = Object.keys(p.locations).sort().join(', ');
    row[map['Usual_Lunch']] = pickMostFrequent(p.lunches);
    outRows.push(row);
    seen[key] = true;
  });
  Object.keys(existingByKey).forEach(key => {
    if (!seen[key]) outRows.push(existingByKey[key]);
  });

  writeMemoryTab(sheet, headers, outRows, {
    banner: '👤 Member Roll — everyone who has ever registered',
    staffColumns: MEMBER_ROLL_STAFF_COLUMNS,
    dateColumns: ['First_Seen', 'Last_Seen'],
    numberColumns: ['Times_Seen']
  });
  log(`Member_Roll refreshed: ${outRows.length} member(s).`);
}

/** One row per unique program (Event x Location), same recomputed/staff split. */
function refreshProgramOptions(ss, sessionRows) {
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_OPTIONS);
  const headers = HEADERS.Program_Options;
  const map = getIndexMap(headers);

  const existingByKey = {};
  readSimpleTable(sheet, headers).forEach(row => {
    const key = `${normalizeNameKey(row[map['Event']])}|${normalizeNameKey(row[map['Location']])}`;
    if (key !== '|') existingByKey[key] = row;
  });

  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regMap = getIndexMap(regHeaders);
  const rows = sessionRows ||
    readAllSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), regHeaders, 'Event_ID');

  const todayKey = formatDateKey(new Date());
  const programs = {};
  rows.forEach(row => {
    const title = String(row[regMap['Clean_Title']] || '').trim();
    const location = String(row[regMap['Location']] || '').trim();
    if (!title) return;
    const key = `${normalizeNameKey(title)}|${normalizeNameKey(location)}`;
    const d = coerceDate(row[regMap['Event_Date']]);
    if (!programs[key]) {
      programs[key] = { title, location, sessions: 0, next: null, last: null, typeTag: '', caps: {} };
    }
    const p = programs[key];
    p.sessions++;
    p.typeTag = normalizeTypeTag(row[regMap['Type_Tag']]);
    if (d) {
      const dk = formatDateKey(d);
      if (dk >= todayKey && (!p.next || d < p.next)) p.next = d;
      if (!p.last || d > p.last) p.last = d;
    }
    const cap = Number(row[regMap['Max_Capacity']]);
    if (cap > 0) p.caps[cap] = (p.caps[cap] || 0) + 1;
  });

  const outRows = [];
  const seen = {};
  Object.keys(programs)
    .sort((a, b) => programs[a].title.localeCompare(programs[b].title))
    .forEach(key => {
      const p = programs[key];
      const row = new Array(headers.length).fill('');
      const prior = existingByKey[key];
      if (prior) PROGRAM_OPTIONS_STAFF_COLUMNS.forEach(h => { row[map[h]] = prior[map[h]]; });
      row[map['Event']] = p.title;
      row[map['Location']] = p.location;
      row[map['Type_Tag']] = p.typeTag;
      row[map['Sessions_Tracked']] = p.sessions;
      row[map['Next_Date']] = p.next || '';
      row[map['Last_Date']] = p.last || '';
      // Only SUGGEST a capacity where the calendar is consistent about it —
      // the staff column is theirs to set, so this never overwrites it.
      if (!row[map['Usual_Capacity']]) row[map['Usual_Capacity']] = pickMostFrequent(p.caps);
      outRows.push(row);
      seen[key] = true;
    });
  Object.keys(existingByKey).forEach(key => {
    if (!seen[key]) outRows.push(existingByKey[key]);
  });

  writeMemoryTab(sheet, headers, outRows, {
    banner: '📋 Program Options — every program, with your standing notes',
    staffColumns: PROGRAM_OPTIONS_STAFF_COLUMNS,
    dateColumns: ['Next_Date', 'Last_Date'],
    numberColumns: ['Sessions_Tracked']
  });
  log(`Program_Options refreshed: ${outRows.length} program(s).`);
}

/**
 * Is this cell value a ticked checkbox? A Sheets checkbox reads back as a real
 * boolean, but the same column filled in by hand, pasted, or read back through
 * a formula can arrive as "TRUE"/"true"/"Yes"/1 — all of which a human plainly
 * meant as yes, and none of which `=== true` catches.
 */
function isTruthyCheckbox(value) {
  if (value === true) return true;
  if (value === 1) return true;
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === 'y' || text === '1' || text === '✓';
}

/**
 * Reads one registrant row's five meal counts and maps them onto the lunch
 * dashboard columns they feed. Returns { total, byDashboardColumn }.
 *
 * THE LEGACY CASE, and why it needs handling rather than ignoring: before this
 * split, a row carried Dine_In_Count/Subs_Count plus a Meals_In_Fridge
 * CHECKBOX that meant "those meals were taken away, not eaten here." Those old
 * columns are read into Day1_Dined_In/Subs_Dined_In by LEGACY_HEADER_ALIASES,
 * which is the right reading for every row where the box was clear. Where it
 * was TICKED, the same numbers meant the opposite, so they are re-routed to
 * the takeaway columns here. Detection is deliberately narrow — an actual
 * boolean, which is what a Sheets checkbox reads back as, and never a number
 * someone has since typed into the same cell as a fridge COUNT.
 */
function readRegistrantMealCounts(row, map) {
  const out = { total: 0, byDashboardColumn: {} };
  const add = (column, amount) => {
    if (!(amount > 0)) return;
    out.byDashboardColumn[column] = (out.byDashboardColumn[column] || 0) + amount;
    out.total += amount;
  };

  const legacyTakeaway = isLegacyFridgeCheckbox(row[map['Meals_In_Fridge']]);
  REGISTRANT_MEAL_COUNT_COLUMNS.forEach(name => {
    if (map[name] === undefined) return;
    const raw = row[map[name]];
    if (name === 'Meals_In_Fridge' && legacyTakeaway) return; // a ticked box is not a count of one
    const amount = Number(raw) || 0;
    if (!(amount > 0)) return;
    let column = MEAL_COUNT_TO_DASHBOARD_COLUMN[name];
    if (legacyTakeaway && name === 'Day1_Dined_In') column = MEAL_COUNT_TO_DASHBOARD_COLUMN.Day1_Taken_Out;
    if (legacyTakeaway && name === 'Subs_Dined_In') column = MEAL_COUNT_TO_DASHBOARD_COLUMN.Subs_Taken_Out;
    add(column, amount);
  });
  return out;
}

/** True only for a real ticked CHECKBOX — the pre-split meaning of Meals_In_Fridge. See readRegistrantMealCounts(). */
function isLegacyFridgeCheckbox(value) {
  return value === true || String(value).trim().toLowerCase() === 'true';
}

/** The key with the highest count, or '' for an empty tally. */
function pickMostFrequent(counts) {
  const keys = Object.keys(counts || {});
  if (keys.length === 0) return '';
  return keys.sort((a, b) => counts[b] - counts[a])[0];
}

/**
 * Reads a plain (single header row at row 2, banner at row 1) tab into rows,
 * projected into `headers` order by NAME — so these tabs survive a layout
 * change the same way the sectioned ones do (see buildHeaderProjection()).
 */
function readSimpleTable(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < MEMORY_TAB_DATA_ROW) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const projection = buildHeaderProjection(sheet, MEMORY_TAB_HEADER_ROW, headers, lastCol);
  const numCols = projection ? lastCol : headers.length;
  let rows = getRowsPreservingFormulas(sheet, MEMORY_TAB_DATA_ROW, 1, lastRow - MEMORY_TAB_DATA_ROW + 1, numCols);
  if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));
  // Blank trailing rows are not members.
  return rows.filter(row => String(row[0] || '').trim() !== '');
}

const MEMORY_TAB_BANNER_ROW = 1;
const MEMORY_TAB_HEADER_ROW = 2;
const MEMORY_TAB_DATA_ROW = 3;

/** Writes a memory tab: banner, header row, data, and the yellow staff-column wash. */
function writeMemoryTab(sheet, headers, rows, options) {
  const numCols = headers.length;
  sheet.clear();
  sheet.clearFormats();
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, numCols, options.banner);
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, numCols, headers);
  labelManualEntryColumns(sheet, MEMORY_TAB_HEADER_ROW, headers, options.staffColumns);

  if (rows.length > 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, 1, rows.length, numCols).setValues(rows);
    const map = getIndexMap(headers);
    (options.dateColumns || []).forEach(h => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[h] + 1, rows.length, 1).setNumberFormat('M/d/yyyy');
    });
    (options.numberColumns || []).forEach(h => {
      sheet.getRange(MEMORY_TAB_DATA_ROW, map[h] + 1, rows.length, 1).setNumberFormat('0');
    });
    applyZebraStripingManualBounded(sheet, MEMORY_TAB_DATA_ROW, rows.length, numCols);
    tintManualEntryColumns(sheet, MEMORY_TAB_DATA_ROW, rows.length, headers, options.staffColumns);
  }

  sheet.setFrozenRows(MEMORY_TAB_HEADER_ROW);
  freezeColumnsSafely(sheet, 1); // the name/program is the row's identity — keep it visible
  autosizeColumns(sheet, { minCols: numCols, force: true });
}


// ============================================================================
// 6f. CLUB ROSTERS  (Club_Members)
// ============================================================================
//
// A club (see CLUB_TAG) is a program you join rather than register for. This
// tab is the membership list — the durable half of that promise, and the only
// place a membership can be ENDED.
//
// THE ASYMMETRY THIS EXISTS TO FIX. Joining is easy: it's a choice on a form,
// and a form submission is a thing a member can do for themselves. Leaving is
// not — nobody re-opens a registration form to un-sign-up, and a form has no
// way to express "and stop booking me from now on" anyway. So a "sign up once,
// forever" feature without a visible, staff-operable OFF switch is a one-way
// door: the only remedy for a member who moves away is deleting rows out of
// the Registrants tab every month, forever, and nobody will.
//
// So membership is a ROW, with an Active checkbox on it:
//
//   ticked    applyClubRosterCatchup() books this person into every upcoming
//             session of the club, on whatever form currently covers it.
//   unticked  they stop being booked — and handleClubMembersEdit() offers, on
//             the spot, to cancel the upcoming rows already created for them,
//             because "stop booking me" almost always means "and not next
//             Thursday either."
//
// Re-ticking re-books them from the next sync. Nothing here is destructive:
// cancelling sets a status, it never deletes a row.
// ============================================================================

/** Reads the roster tab (banner + header + rows, like the memory tabs). */
function readClubMemberRows(sheet) {
  if (!sheet) return [];
  try {
    return readSimpleTable(sheet, HEADERS.Club_Members);
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.CLUB_MEMBERS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/** The identity of one membership: which club, which person, in what role. */
function clubMemberKey(clubKey, name, personType) {
  return `${clubKey}|${normalizeNameKey(name)}|${String(personType || 'Attendee').trim()}`;
}

/** { clubMemberKey: row } for a batch of roster rows. */
function indexClubMemberRows(rows) {
  const map = getIndexMap(HEADERS.Club_Members);
  const index = {};
  rows.forEach(row => {
    const clubKey = String(row[map['Club_Key']] || '').trim();
    if (!clubKey) return;
    index[clubMemberKey(clubKey, row[map['Name']], row[map['Person_Type']])] = row;
  });
  return index;
}

/**
 * Folds new/updated memberships into the roster tab and rewrites it.
 *
 * `entries` are joins as they come off a form: { clubKey, club, location,
 * name, personType, primaryRegistrant, phone, email, lunchType, source }.
 *
 * An entry for somebody already on the roster REFRESHES their contact details
 * and leaves the staff columns alone — with one deliberate exception: if they
 * had been made inactive and have now personally chosen the club option on a
 * form again, they are put back on. That is a member asking, in the only way a
 * member can ask, and quietly ignoring it would be worse than the surprise —
 * so it is also reported to the admin digest rather than done silently.
 *
 * Returns { added, reactivated, unchanged }.
 */
function upsertClubMembers(entries) {
  const result = { added: 0, reactivated: 0, unchanged: 0 };
  if (!entries || entries.length === 0) return result;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.CLUB_MEMBERS);
  const headers = HEADERS.Club_Members;
  const map = getIndexMap(headers);
  const rows = readClubMemberRows(sheet);
  const index = indexClubMemberRows(rows);
  const now = new Date();

  entries.forEach(entry => {
    const clubKey = String(entry.clubKey || '').trim();
    const name = String(entry.name || '').trim();
    if (!clubKey || !name) return;
    const personType = String(entry.personType || 'Attendee').trim();
    const key = clubMemberKey(clubKey, name, personType);
    const existing = index[key];

    if (existing) {
      existing[map['Club']] = entry.club || existing[map['Club']];
      existing[map['Location']] = entry.location || existing[map['Location']];
      existing[map['Primary_Registrant']] = entry.primaryRegistrant || existing[map['Primary_Registrant']];
      if (entry.phone) existing[map['Phone']] = entry.phone;
      if (entry.email) existing[map['Email']] = entry.email;
      if (entry.source) existing[map['Source']] = entry.source;
      if (!isTruthyCheckbox(existing[map['Active']])) {
        existing[map['Active']] = true;
        existing[map['Joined_On']] = now;
        // The staff Lunch preference is theirs, but a re-join is a fresh
        // statement of it — take the one they just gave us.
        if (entry.lunchType) existing[map['Lunch']] = entry.lunchType;
        result.reactivated++;
        noteForAdmin('Club members who re-joined',
          `${name} was marked inactive on "${entry.club || clubKey}" but has just chosen the club option on a ` +
          `registration form, so they are back on the list. Untick Active on ` +
          `"${SHEET_NAMES.CLUB_MEMBERS}" if that is wrong.`);
      } else {
        result.unchanged++;
      }
      return;
    }

    const row = new Array(headers.length).fill('');
    row[map['Club']] = entry.club || '';
    row[map['Location']] = entry.location || '';
    row[map['Name']] = name;
    row[map['Person_Type']] = personType;
    row[map['Primary_Registrant']] = entry.primaryRegistrant || '';
    row[map['Phone']] = entry.phone || '';
    row[map['Email']] = entry.email || '';
    row[map['Lunch']] = entry.lunchType || 'No Lunch';
    row[map['Joined_On']] = now;
    row[map['Active']] = true;
    row[map['Source']] = entry.source || 'Registration form';
    row[map['Club_Key']] = clubKey;
    rows.push(row);
    index[key] = row;
    result.added++;
  });

  if (result.added > 0 || result.reactivated > 0) {
    renderClubMembersSheet(rows);
    // applyClubRosterCatchup() reads this tab back moments from now, in the
    // same execution — make sure what it reads is what was just written.
    SpreadsheetApp.flush();
    log(`Club_Members: ${result.added} new member(s), ${result.reactivated} re-activated.`);
  }
  return result;
}

/** Writes the roster tab: sorted by club then name, Active as a real checkbox, the machine key hidden. */
function renderClubMembersSheet(allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.CLUB_MEMBERS);
  const headers = HEADERS.Club_Members;
  const map = getIndexMap(headers);
  const rows = (allRows || readClubMemberRows(sheet)).slice();

  rows.sort((a, b) => {
    const clubA = String(a[map['Club']] || '');
    const clubB = String(b[map['Club']] || '');
    if (clubA !== clubB) return clubA.localeCompare(clubB);
    return String(a[map['Name']] || '').localeCompare(String(b[map['Name']] || ''));
  });

  writeMemoryTab(sheet, headers, rows, {
    banner: '🎟️ Club Members — who is on each club\'s standing list (untick Active to take someone off)',
    staffColumns: CLUB_MEMBERS_STAFF_COLUMNS,
    dateColumns: ['Joined_On']
  });

  if (rows.length > 0) {
    sheet.getRange(MEMORY_TAB_DATA_ROW, map['Active'] + 1, rows.length, 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
      .setHorizontalAlignment('center');
    applyValueListValidationBounded(sheet, map['Lunch'] + 1, CLUB_LUNCH_OPTIONS, MEMORY_TAB_DATA_ROW, rows.length);
  }
  // Club_Key is the join key, not something to read. Everything else stays.
  applyColumnVisibility(sheet, headers, ['Club_Key']);
  return rows.length;
}

/**
 * Books every ACTIVE club member into every UPCOMING session of their club
 * that they don't already have a row for. This is what makes "sign up once"
 * survive a month rolling over onto a brand-new form.
 *
 * DELIBERATELY GAP-FILLING ONLY: a session the person already has a row for is
 * left completely alone, whatever that row says. They may have registered
 * through the form normally, been hand-added as a walk-in, or been cancelled
 * for that one date — and a roster that re-asserted itself over any of those
 * would make individual dates unmanageable, which is the opposite of what a
 * standing membership is for.
 *
 * PAST sessions are never filled in either. A membership says where someone is
 * expected, not where they were; back-filling would invent attendance history.
 */
function applyClubRosterCatchup(registryIndex, protectedKeys, existingRowIndex, orderAheadDays, newRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  if (!sheet) return 0;

  const map = getIndexMap(HEADERS.Club_Members);
  const members = readClubMemberRows(sheet).filter(row => isTruthyCheckbox(row[map['Active']]));
  if (members.length === 0) return 0;

  // Club sessions only, grouped by the club they belong to.
  const sessionsByClub = {};
  Object.keys(registryIndex).forEach(k => {
    const entry = registryIndex[k];
    if (!entry.isClub || !entry.clubKey) return;
    if (!sessionsByClub[entry.clubKey]) sessionsByClub[entry.clubKey] = [];
    sessionsByClub[entry.clubKey].push(entry);
  });
  if (Object.keys(sessionsByClub).length === 0) return 0;

  const todayKey = formatDateKey(new Date());
  let booked = 0;

  members.forEach(member => {
    const clubKey = String(member[map['Club_Key']] || '').trim();
    const sessions = sessionsByClub[clubKey];
    if (!sessions) return;

    const name = String(member[map['Name']] || '').trim();
    const personType = String(member[map['Person_Type']] || 'Attendee').trim();
    if (!name) return;
    const joinedOn = coerceDate(member[map['Joined_On']]) || new Date();

    sessions.forEach(registryEntry => {
      if (formatDateKey(registryEntry.eventDate) < todayKey) return;
      const rowKey = `${registryEntry.eventId}|${normalizeNameKey(name)}|${personType}`;
      if (existingRowIndex.has(rowKey)) return; // already has a row for this session — never overwritten

      const row = buildRegistrantRow({
        registryEntry,
        name,
        personType,
        lunchType: String(member[map['Lunch']] || 'No Lunch'),
        primaryRegistrant: String(member[map['Primary_Registrant']] || 'Self'),
        adminNotes: `Booked automatically from the ${SHEET_NAMES.CLUB_MEMBERS} list.`,
        phone: String(member[map['Phone']] || ''),
        email: String(member[map['Email']] || ''),
        formEditUrl: '',
        formSourceText: 'Club member (standing list)',
        protectedKeys,
        existingRowIndex,
        submittedAt: joinedOn,
        orderAheadDays,
        // A stable synthetic Party_ID, so a re-run recognizes its own earlier
        // rows as the same submission and patches them instead of superseding
        // them into a growing pile of history.
        partyId: `CLUB:${clubMemberKey(clubKey, name, personType)}`,
        partySize: ''
      });
      if (row) { newRows.push(row); booked++; }
    });
  });

  if (booked > 0) log(`applyClubRosterCatchup: booked ${booked} club registration(s) from the standing lists.`);
  return booked;
}

/**
 * The Club_Members tab's own edits. Only Active matters: unticking it is the
 * documented way to take somebody off a club, and the useful moment to ask
 * about the bookings that membership has already produced.
 */
function handleClubMembersEdit(e, sheet) {
  if (typeof e.value === 'undefined') return; // multi-cell paste — nothing single to act on
  // getIndexMap rather than getLiveHeaderMap: this tab is rewritten whole by
  // renderClubMembersSheet() on every refresh, so its header row is always
  // exactly HEADERS.Club_Members.
  const headerMap = getIndexMap(HEADERS.Club_Members);
  const activeCol = headerMap['Active'];
  if (activeCol === undefined || e.range.getColumn() !== activeCol + 1) return;
  const row = e.range.getRow();
  if (row < MEMORY_TAB_DATA_ROW) return;

  const read = name => (headerMap[name] === undefined ? '' : sheet.getRange(row, headerMap[name] + 1).getValue());
  const name = String(read('Name') || '').trim();
  const club = String(read('Club') || '').trim();
  const clubKey = String(read('Club_Key') || '').trim();
  const personType = String(read('Person_Type') || 'Attendee').trim();
  if (!name || !clubKey) return;

  if (isTruthyCheckbox(e.value)) {
    toastIfPossible(`${name} is back on "${club}". They'll be booked into its upcoming sessions on the next sync.`);
    return;
  }

  const cancelled = cancelUpcomingClubRegistrations({ clubKey, club, name, personType });
  if (cancelled === 0) {
    toastIfPossible(`${name} taken off "${club}". They had no upcoming bookings to cancel.`);
    return;
  }
  toastIfPossible(`${name} taken off "${club}" — ${cancelled} upcoming booking(s) cancelled.`);
}

/**
 * Cancels (never deletes) a former club member's UPCOMING registrant rows for
 * that club, and recomputes the catering numbers those rows were feeding.
 *
 * Asks first, and says how many rows and which club. Declining leaves the
 * membership off but the bookings in place, which is a real and reasonable
 * answer — "stop booking her from January, but she is still coming to the two
 * we've already told the kitchen about."
 *
 * Matching is by program name + location rather than by Event_ID, because the
 * membership outlives any particular form or session: it has to find rows on
 * next month's form, which did not exist when she joined. A club tagged
 * [All Locations] matches at every location, since it is one club.
 */
function cancelUpcomingClubRegistrations(args) {
  const { clubKey, club, name, personType } = args;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  if (!sheet) return 0;

  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);
  const rows = readAllSectionedRows(sheet, headers, 'Event_ID');
  const todayKey = formatDateKey(new Date());
  const nameKey = normalizeNameKey(name);
  const isSharedClub = clubKey.indexOf(`${SHARED_LOCATION_SCOPE}::`) === 0;

  const targets = rows.filter(row => {
    if (normalizeNameKey(row[map['Name']]) !== nameKey) return false;
    if (String(row[map['Person_Type']] || 'Attendee').trim() !== personType) return false;
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) < todayKey) return false;
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return false;
    const rowKey = computeClubKey(row[map['Event']], row[map['Location']], isSharedClub);
    return rowKey === clubKey;
  });

  if (targets.length === 0) return 0;

  if (!confirmConsequentialAction(`Cancel ${name}'s upcoming ${club || 'club'} bookings?`,
    `${name} has ${targets.length} upcoming registration(s) that came from their ${club || 'club'} membership.\n\n` +
    `They will be marked Cancelled (not deleted) and taken out of the catering counts. ` +
    `Answer No to leave those bookings alone — they will simply stop being renewed.`, false)) {
    return 0;
  }

  const stamp = `Cancelled on ${formatDateLabel(new Date())}: taken off the ${club || 'club'} list.`;
  targets.forEach(row => {
    row[map['Program_Status']] = 'Cancelled';
    row[map['Lunch_Status']] = 'Cancelled';
    row[map['Manual_Override']] = 'Manually Edited';
    const notes = String(row[map['Admin_Notes']] || '').trim();
    row[map['Admin_Notes']] = notes ? `${notes} | ${stamp}` : stamp;
  });

  renderRegistrantsSheet(false, rows);
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, rows);
    updateMasterLunchDashboard(rows);
  } catch (err) {
    log(`⚠️ Cancelled ${targets.length} club booking(s) for ${name}, but could not recalculate the counts (${err}).`);
  }
  log(`cancelUpcomingClubRegistrations: cancelled ${targets.length} row(s) for ${name} on "${club}".`);
  return targets.length;
}

/**
 * Refreshes the roster's human-readable Club and Location cells from the
 * session table, and returns the rows.
 *
 * Club_Key is the identity and never changes; Club and Location are labels for
 * a person to read, and a program renamed on the calendar (or a club that
 * starts also meeting at Ashbridge) would otherwise leave the roster naming
 * something that no longer exists. Rows whose club is not currently on the
 * dashboard are left exactly as they are — a club with no scheduled sessions
 * right now is dormant, not gone, and its members must survive the gap.
 */
function refreshClubMemberLabels(sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  const rows = readClubMemberRows(sheet);
  if (rows.length === 0) return rows;

  const map = getIndexMap(HEADERS.Club_Members);
  const clubs = collectKnownClubs(sessionRows);
  rows.forEach(row => {
    const club = clubs[String(row[map['Club_Key']] || '').trim()];
    if (!club) return;
    row[map['Club']] = club.title;
    row[map['Location']] = club.isShared ? SHARED_LOCATION_TAG : (club.locations[0] || row[map['Location']]);
  });
  return rows;
}

/**
 * Every club the workbook currently knows about, from the session table:
 * { clubKey: { clubKey, title, locations[], isShared } }. Used by the roster
 * refresh to keep the human-readable Club/Location columns current when a
 * program is renamed or gains a location.
 */
function collectKnownClubs(sessionRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const rows = sessionRows || (sheet ? readAllSectionedRows(sheet, headers, 'Event_ID') : []);
  const sharedFormIds = getSharedFormIdSet();

  const clubs = {};
  rows.forEach(row => {
    if (!isClubColumnValue(row[map['Club']])) return;
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    if (!title) return;
    const isShared = sharedFormIds.has(row[map['Form_ID']]);
    const key = computeClubKey(title, location, isShared);
    if (!key) return;
    if (!clubs[key]) clubs[key] = { clubKey: key, title, locations: [], isShared };
    if (location && clubs[key].locations.indexOf(location) === -1) clubs[key].locations.push(location);
  });
  return clubs;
}


// ============================================================================
// 6e. LEGACY TAB MERGE  (mergeLegacyTabs / previewLegacyTabMerge)
// ============================================================================
//
// Layout changes inside a tab need no help: readAllSectionedRows() re-aligns
// rows by header NAME, so re-ordering or adding a column is invisible (see
// buildHeaderProjection()). What DOES get stranded is data sitting in a tab
// under a different NAME —
//
//   • Active_Programs            an early version of the session table
//   • Lunch_Schedule_OLD_<date>  renamed by initLunchScheduleSheet() when it
//                               found the old Month-based menu layout
//   • Config_OLD_<date>          same, for Config
//   • "Copy of …", "… (old)"     anything made by hand while troubleshooting
//
// — which is invisible to every sync and quietly rots. Worse,
// initSheet() used to DELETE Active_Programs outright without reading it.
//
// So this identifies those tabs BY CONTENT (how well their header row matches
// each canonical layout, not by guessing at names), merges their rows into the
// right current tab, and only then deletes them.
//
// MERGE RULE: existing rows win. A legacy row is added only when its identity
// key isn't already present, so re-running is idempotent and nothing current is
// ever overwritten by something older. Every merged row is stamped in
// Admin_Notes/Triage_Notes where the tab has such a column, so its provenance
// is visible afterwards.
// ============================================================================

/**
 * Which canonical tab a legacy tab's rows belong to, plus how to tell two rows
 * apart. `identity` receives (row, map) and returns a dedup key, or '' for a
 * row too incomplete to place.
 */
function getMergeTargets() {
  return [
    {
      sheetName: SHEET_NAMES.PROGRAM_DASHBOARD,
      headers: HEADERS.Master_Program_Dashboard,
      marker: 'Event_ID',
      identity: (row, map) => String(row[map['Event_ID']] || '').trim(),
      render: rows => renderProgramDashboardFromRows(rows)
    },
    {
      sheetName: SHEET_NAMES.LUNCH_EVENT_REGISTRANTS,
      headers: HEADERS.Lunch_and_Event_Registrants,
      marker: 'Event_ID',
      identity: (row, map) => {
        const eventId = String(row[map['Event_ID']] || '').trim();
        const name = normalizeNameKey(row[map['Name']]);
        if (!eventId || !name) return '';
        return `${eventId}|${name}|${row[map['Person_Type']] || ''}`;
      },
      noteColumn: 'Admin_Notes',
      render: rows => renderRegistrantsSheet(true, rows)
    },
    {
      sheetName: SHEET_NAMES.TRIAGE,
      headers: HEADERS.Deleted_Event_Triage,
      marker: 'Event_ID',
      identity: (row, map) => {
        const eventId = String(row[map['Event_ID']] || '').trim();
        const name = normalizeNameKey(row[map['Name']]);
        if (!eventId || !name) return '';
        return `${eventId}|${name}|${row[map['Person_Type']] || ''}`;
      },
      noteColumn: 'Triage_Notes',
      render: rows => renderTriageSheet(true, rows)
    },
    {
      sheetName: SHEET_NAMES.LUNCH_SCHEDULE,
      headers: HEADERS.Lunch_Schedule,
      marker: 'Event_Date',
      identity: (row, map) => {
        const d = coerceDate(row[map['Event_Date']]);
        if (!d) return '';
        return `${formatDateKey(d)}|${String(row[map['Location']] || '').trim()}`;
      },
      // Not the generic read: this tab's ADD block sits below its tables and
      // holds dated rows that are NOT schedule yet — see getLunchScheduleEndRow().
      readCurrent: sheet => readLunchScheduleRows(sheet),
      render: rows => renderLunchScheduleSheet(true, rows)
    }
  ];
}

/**
 * Tabs that must never be treated as legacy, whatever their contents look
 * like: the canonical set itself, plus Config (its own layout, migrated
 * separately by buildConfigSheet()) and the two memory tabs (rebuilt from
 * source data, so merging into them would fight refreshMemoryTabs()).
 */
function getProtectedTabNames() {
  // Plus the hidden queue behind the flag checkboxes: it is small, oddly
  // shaped and machine-written, which is exactly the profile the legacy-tab
  // scanner is built to notice.
  return Object.values(SHEET_NAMES).concat([PENDING_FLAG_SHEET_NAME]);
}

/** A legacy tab must have at least this many of a target's columns, and this share of ITS OWN columns recognized. */
const LEGACY_MATCH_MIN_COLUMNS = 4;
const LEGACY_MATCH_MIN_PRECISION = 0.7;

/**
 * Scores a tab against every merge target and returns the best match, or null.
 *
 * Content, not name: "Copy of Registrants (2)" and "Active_Programs" are the
 * same problem, and only their headers say what they hold.
 *
 * SCORED BY PRECISION, NOT COVERAGE — how many of the TAB'S OWN columns are
 * recognized, not how much of the target it fills. A legacy tab is by
 * definition an OLDER layout, so it's missing whatever has been added since;
 * scoring it against the target's full width punishes exactly the tabs worth
 * rescuing (a 9-column old Registrants tab covers only half of today's 18, and
 * a coverage test threw it away). Precision asks the right question: does
 * everything on this tab look like it belongs to that layout?
 *
 * Guards against false positives: the target's MARKER column must be present
 * (without it the rows can't be read at all), at least
 * LEGACY_MATCH_MIN_COLUMNS must match so a two-column coincidence can't
 * qualify, and coverage breaks ties — which is what separates a legacy
 * Registrants tab from Triage, whose layout is a superset of it.
 */
function classifyLegacyTab(sheet) {
  const lastRow = Math.min(sheet.getLastRow(), 50); // a header row is near the top or nowhere
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  if (lastRow < 1) return null;

  const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  let best = null;

  getMergeTargets().forEach(target => {
    const wanted = target.headers.map(h => h.toLowerCase());
    for (let r = 0; r < grid.length; r++) {
      const names = grid[r].map(v => normalizeHeaderText(v).toLowerCase()).filter(Boolean);
      if (names.length === 0) continue;
      if (names.indexOf(target.marker.toLowerCase()) === -1) continue;

      const matched = names.filter(n => wanted.indexOf(n) !== -1).length;
      if (matched < LEGACY_MATCH_MIN_COLUMNS) continue;
      const precision = matched / names.length;      // is everything here ours?
      if (precision < LEGACY_MATCH_MIN_PRECISION) continue;
      const coverage = matched / wanted.length;      // tie-breaker only

      if (!best || precision > best.precision ||
        (precision === best.precision && coverage > best.coverage)) {
        best = { target, headerRow: r + 1, precision, coverage, matched, score: precision };
      }
    }
  });

  return best;
}

/** Every non-protected tab that looks like legacy data, with what it matched. */
function findLegacyTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const protectedNames = getProtectedTabNames();
  const found = [];

  ss.getSheets().forEach(sheet => {
    const name = sheet.getName();
    if (protectedNames.indexOf(name) !== -1) return;
    // Config_OLD_* is Config's own layout, which has no marker column and is
    // handled by buildConfigSheet()'s own migration — classifyLegacyTab()
    // will score it at 0, but skip it explicitly so the report can say why.
    const match = classifyLegacyTab(sheet);
    if (!match) return;
    found.push({
      sheet,
      name,
      target: match.target,
      headerRow: match.headerRow,
      score: match.score,
      matched: match.matched,
      rowCount: Math.max(sheet.getLastRow() - match.headerRow, 0)
    });
  });

  return found;
}

/**
 * READ-ONLY. Reports what mergeLegacyTabs() would do — which tabs it found,
 * what each matched, and how many rows are in them. Changes nothing.
 */
function previewLegacyTabMerge() {
  if (!requireAuthorizedAdmin('Preview Legacy Tab Merge')) return [];
  const found = findLegacyTabs();
  if (found.length === 0) {
    log('previewLegacyTabMerge: no legacy tabs found — nothing to merge.');
    toastIfPossible('No leftover tabs found — nothing to merge.');
    return [];
  }
  log(`previewLegacyTabMerge: ${found.length} tab(s) look like legacy data:`);
  found.forEach(f => {
    log(`  • "${f.name}" -> ${f.target.sheetName} ` +
      `(header row ${f.headerRow}, ${f.rowCount} data row(s), ` +
      `${f.matched} matching column(s), ${Math.round(f.score * 100)}% of its columns recognized)`);
  });
  toastIfPossible(`${found.length} leftover tab(s) found — see the log, then run mergeLegacyTabs().`);
  return found;
}

/**
 * Pulls the data out of every legacy tab into the current tabs, then deletes
 * the legacy tabs.
 *
 * DESTRUCTIVE, and gated accordingly: admin only, and it names every tab it is
 * about to delete before doing anything. A tab is deleted ONLY after its rows
 * have been read AND the merged result written back successfully — a failure
 * anywhere leaves the tab in place to try again.
 *
 * Deleted tabs are recoverable for a while from the spreadsheet's own version
 * history (File > Version history), which is the real safety net here; this
 * function does not keep its own copy, because a workbook full of
 * "…_OLD_OLD_2" tabs is the mess it exists to clean up.
 */
function mergeLegacyTabs() {
  if (!requireAuthorizedAdmin('Merge Legacy Tabs')) return 0;

  const found = findLegacyTabs();
  if (found.length === 0) {
    log('mergeLegacyTabs: no legacy tabs found — nothing to do.');
    toastIfPossible('No leftover tabs found — nothing to merge.');
    return 0;
  }

  const summary = found
    .map(f => `• "${f.name}" → ${f.target.sheetName}  (${f.rowCount} row(s))`)
    .join('\n');
  if (!confirmConsequentialAction('Merge and delete these leftover tabs?',
    `${summary}\n\nTheir rows will be added to the current tabs (existing rows are never ` +
    `overwritten), and then these tabs will be DELETED.\n\n` +
    `You can recover a deleted tab from File > Version history.`, false)) {
    return 0;
  }

  // Group by destination so each target tab is written exactly once.
  const byTarget = {};
  found.forEach(f => {
    if (!byTarget[f.target.sheetName]) byTarget[f.target.sheetName] = { target: f.target, sources: [] };
    byTarget[f.target.sheetName].sources.push(f);
  });

  let mergedRows = 0;
  let deletedTabs = 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(byTarget).forEach(sheetName => {
    const { target, sources } = byTarget[sheetName];
    const map = getIndexMap(target.headers);

    let current;
    try {
      const targetSheet = getOrCreateSheet(ss, sheetName);
      current = target.readCurrent
        ? target.readCurrent(targetSheet)
        : readAllSectionedRows(targetSheet, target.headers, target.marker);
    } catch (err) {
      log(`⚠️ mergeLegacyTabs: could not read "${sheetName}" (${err}) — skipping its sources, tabs left in place.`);
      return;
    }

    const seen = {};
    current.forEach(row => {
      const key = target.identity(row, map);
      if (key) seen[key] = true;
    });

    const added = [];
    const consumed = [];
    sources.forEach(source => {
      let rows;
      try {
        rows = readLegacyTabRows(source, target);
      } catch (err) {
        log(`⚠️ mergeLegacyTabs: could not read "${source.name}" (${err}) — left in place.`);
        return;
      }
      let kept = 0;
      rows.forEach(row => {
        const key = target.identity(row, map);
        if (!key || seen[key]) return; // unplaceable, or the current tab already has it
        seen[key] = true;
        stampMergeProvenance(row, map, target, source.name);
        added.push(row);
        kept++;
      });
      log(`mergeLegacyTabs: "${source.name}" → ${sheetName}: ${kept} new row(s) of ${rows.length} read.`);
      consumed.push(source);
    });

    if (added.length > 0) {
      try {
        target.render(current.concat(added));
      } catch (err) {
        // The write failed, so the sources are still the only copy — keep them.
        log(`⚠️ mergeLegacyTabs: could not write the merged "${sheetName}" (${err}) — source tabs left in place.`);
        return;
      }
      mergedRows += added.length;
    }

    // Only now — rows are safely in the target (or were already there).
    consumed.forEach(source => {
      try {
        ss.deleteSheet(source.sheet);
        deletedTabs++;
        log(`Deleted legacy tab "${source.name}".`);
      } catch (err) {
        log(`⚠️ mergeLegacyTabs: merged "${source.name}" but could not delete it (${err}) — remove it by hand.`);
      }
    });
  });

  // The memory tabs are derived, so rebuild them from whatever just arrived.
  refreshMemoryTabs(null, null);

  const headline = `Merged ${mergedRows} row(s) from ${deletedTabs} leftover tab(s) ✅`;
  log(`mergeLegacyTabs complete: ${headline}`);
  toastIfPossible(headline);
  return mergedRows;
}

/**
 * Reads one legacy tab's rows, projected into the target's column order by
 * header NAME (so a tab whose columns are in any order, or missing some,
 * still lands correctly).
 */
function readLegacyTabRows(source, target) {
  const sheet = source.sheet;
  const lastRow = sheet.getLastRow();
  if (lastRow <= source.headerRow) return [];

  const lastCol = Math.max(sheet.getLastColumn(), target.headers.length);
  const projection = buildHeaderProjection(sheet, source.headerRow, target.headers, lastCol);
  const numCols = projection ? lastCol : target.headers.length;
  let rows = getRowsPreservingFormulas(sheet, source.headerRow + 1, 1, lastRow - source.headerRow, numCols);
  if (projection) rows = rows.map(row => projection.map(src => (src === -1 ? '' : row[src])));

  // Drop banner/spacer rows: on a date-keyed tab, anything without a real date.
  const map = getIndexMap(target.headers);
  const dateIdx = map['Event_Date'];
  if (dateIdx !== undefined) rows = rows.filter(row => coerceDate(row[dateIdx]));
  return rows.filter(row => row.some(v => String(v || '').trim() !== ''));
}

/** Notes on a merged row where it came from, so its provenance is visible on the tab. */
function stampMergeProvenance(row, map, target, sourceName) {
  if (!target.noteColumn || map[target.noteColumn] === undefined) return;
  const existing = String(row[map[target.noteColumn]] || '').trim();
  const stamp = `Merged from "${sourceName}" on ${Utilities.formatDate(new Date(), TIMEZONE, 'M/d/yyyy')}.`;
  row[map[target.noteColumn]] = existing ? `${existing} | ${stamp}` : stamp;
}

/**
 * Renders the session table from an explicit row set. renderProgramDashboard()
 * always re-reads the sheet itself, so a merge needs a way to seed it: the rows
 * are written first, then the normal render picks them up.
 */
function renderProgramDashboardFromRows(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const headers = HEADERS.Master_Program_Dashboard;

  // Write the combined rows into a bare table the normal render will find,
  // then let renderProgramDashboard() lay it out properly.
  sheet.clear();
  sheet.clearFormats();
  writeSectionHeader(sheet, 1, headers.length, headers);
  if (rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  renderProgramDashboard(true);
}


// ============================================================================
// 7. MASTER PROGRAM DASHBOARD  (renderProgramDashboard)
// ============================================================================
//
// One function rebuilds the ENTIRE sheet, top to bottom, every time it's
// called: it reads whatever is currently across both the Upcoming and Past
// session sub-tables, removes any session whose calendar event has
// disappeared (routing its registrants to Triage first, refreshing that
// session's form), sorts/splits the rest by date, computes the Today/
// Metrics sections, then clears the sheet and writes everything fresh.
// ============================================================================

/**
 * options.registrantRows — already-in-memory Lunch_and_Event_Registrants
 * rows, to skip re-reading that tab. Honored only when this render's own
 * triage pass didn't rewrite the tab underneath them (see registrantsMoved).
 * Returns { registrantsMoved } so a caller holding those rows knows whether
 * they are still safe to reuse afterward.
 *
 * options.sessionRows — already-in-memory session rows, same idea.
 *
 * options.skipTriage — do NOT cross-check the sessions against the live
 * calendars. This is the ONLY thing in a dashboard render that reads outside
 * the spreadsheet, and it is also the only thing that can remove data, so
 * rebuildLayoutFromSheet() turns it off: a re-layout must not be able to
 * decide, on the strength of one unreadable calendar, that a program was
 * cancelled. Nothing else in here needs the network.
 */
function renderProgramDashboard(force, options) {
  options = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);

  let sessionRows = options.sessionRows || readAllSectionedRows(sheet, headers, 'Event_ID');

  const triageResult = options.skipTriage
    ? { rows: sessionRows, affectedFormIds: new Set(), registrantsMoved: false }
    : triageDeletedSessions(sessionRows, map, registrantsSheet);
  sessionRows = triageResult.rows;

  sessionRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d) row[map['Event_Date']] = d;
  });

  if (triageResult.affectedFormIds.size > 0) {
    refreshFormDateListsForForms(sessionRows, map, triageResult.affectedFormIds);
  }

  const reusableRegistrantRows = triageResult.registrantsMoved ? null : options.registrantRows;
  const registrantScan = scanRegistrants(registrantsSheet, reusableRegistrantRows);
  const todayData = buildTodayAtLocations(sessionRows, map, registrantScan);
  const metrics = computeProgramMetrics(sessionRows, map, registrantScan);

  writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, force);
  return { registrantsMoved: triageResult.registrantsMoved };
}

/**
 * A triage sweep this size is treated as a symptom, not an instruction — see
 * triageDeletedSessions(). Both have to be exceeded before a sweep is
 * refused, so deleting one whole small program still works normally while a
 * "everything vanished" reading never does.
 */
const TRIAGE_MAX_SESSIONS_PER_RUN = 15;
const TRIAGE_MAX_FRACTION_PER_RUN = 0.25;
/** One-shot property set by confirmLargeTriage() to let the next sweep exceed those limits. */
const TRIAGE_OVERRIDE_PROP_KEY = 'TRIAGE_OVERRIDE_ONCE';

/**
 * Cross-checks in-memory session rows against what's genuinely still on the
 * calendars right now and drops any that are gone. Dropped sessions'
 * registrants are moved to Deleted_Event_Triage. Master_Program_Dashboard no
 * longer has a Manual_Override column, so nothing can be protected from
 * this anymore — every session's presence is strictly calendar-derived.
 *
 * WHICH MAKES THIS THE MOST DESTRUCTIVE FUNCTION IN THE FILE, and it is
 * built to distrust itself accordingly:
 *
 *   1. A calendar that could not be READ proves nothing. getCalendarById()
 *      returns null on a transient failure, and the old code read that as an
 *      empty event list — i.e. "every session at that location is deleted."
 *      Rows whose Calendar_Source we couldn't read are now left alone.
 *   2. A sweep that would take out most of the table is refused outright.
 *      Programs get cancelled a few at a time; 268 sessions disappearing at
 *      once is a failed calendar read, a mid-import snapshot, or a bug — and
 *      the cost of pausing is one log line, while the cost of proceeding is
 *      the whole dashboard plus every registrant on it. confirmLargeTriage()
 *      is the way to say "no, really".
 *   3. While a bootstrap import is in flight, nothing is triaged at all: the
 *      session table is being written as we read it.
 */
function triageDeletedSessions(sessionRows, map, registrantsSheet) {
  const empty = { rows: sessionRows, affectedFormIds: new Set(), registrantsMoved: false };

  if (isBootstrapActive()) {
    log('Triage skipped: a large-setup import or forms-rebuild sweep is still writing the session table.');
    return empty;
  }

  const { start, end } = computeSyncDateRange();

  // Shares syncCalendarsInternal()'s fetch for this window — a full
  // initializeAndSyncAll() used to hit every calendar four separate times
  // (once per renderProgramDashboard(), plus the sync's own scan).
  const eventsByCalendar = getCalendarEventsForWindow(start, end);
  const readableCalendars = new Set();
  const liveEventIds = new Set();
  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    const events = eventsByCalendar[calendarId];
    if (!events) {
      log(`⚠️ Triage: "${CALENDAR_MAP[calendarId]}" could not be read this run — its sessions are left as they are.`);
      return;
    }
    readableCalendars.add(calendarId);
    events.forEach(ev => {
      if (ev.isAllDayEvent()) return;
      const parsed = parseEventTitle(ev.getTitle());
      if (!parsed) return;
      liveEventIds.add(computeEventId(calendarId, parsed.cleanTitle, formatDateKey(ev.getStartTime())));
    });
  });

  if (readableCalendars.size === 0) {
    log('Triage skipped: no calendar could be read this run.');
    return empty;
  }

  const doomedRows = [];
  const deletedEventInfo = {};
  sessionRows.forEach(row => {
    const eventId = row[map['Event_ID']];
    const d = coerceDate(row[map['Event_Date']]);
    const source = row[map['Calendar_Source']];
    // No Calendar_Source (a hand-added row) can't be attributed to a calendar
    // we verified, so it is never triaged.
    if (!eventId || !d || !source || !readableCalendars.has(source)) return;
    if (d < start || d > end) return; // outside the window we can see
    if (liveEventIds.has(eventId)) return;
    doomedRows.push(row);
    deletedEventInfo[eventId] = { cleanTitle: row[map['Clean_Title']], location: row[map['Location']] };
  });

  const deletedCount = Object.keys(deletedEventInfo).length;
  if (deletedCount === 0) return empty;

  if (isTriageTooBig(deletedCount, sessionRows.length)) {
    const message = `Triage REFUSED: ${deletedCount} of ${sessionRows.length} session(s) looked deleted in one pass, ` +
      `which is far more likely to be a bad calendar read than ${deletedCount} real cancellations. ` +
      `Nothing was removed. If they really are all gone, run confirmLargeTriage() from the Apps Script ` +
      `editor and let the next sync through.`;
    log(`⚠️ ${message}`);
    noteForAdmin('Sessions that look deleted', message);
    return empty;
  }

  const doomedSet = new Set(doomedRows);
  const keep = sessionRows.filter(row => !doomedSet.has(row));
  const affectedFormIds = new Set();
  doomedRows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (formId) affectedFormIds.add(formId);
  });

  moveRegistrantsToTriage(registrantsSheet, deletedEventInfo);
  log(`Triaged ${deletedCount} deleted event(s) during dashboard render.`);

  // registrantsMoved tells callers that any registrant rows they were
  // holding from before this call are now stale — moveRegistrantsToTriage()
  // rewrites the Registrants tab.
  return { rows: keep, affectedFormIds, registrantsMoved: true };
}

/** Is this sweep big enough to need a human? Consumes the one-shot override if one is set. */
function isTriageTooBig(deletedCount, totalRows) {
  const overLimit = deletedCount > TRIAGE_MAX_SESSIONS_PER_RUN &&
    deletedCount > totalRows * TRIAGE_MAX_FRACTION_PER_RUN;
  if (!overLimit) return false;

  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(TRIAGE_OVERRIDE_PROP_KEY)) {
    props.deleteProperty(TRIAGE_OVERRIDE_PROP_KEY); // one sweep only
    log('Large triage allowed once by confirmLargeTriage().');
    return false;
  }
  return true;
}

/**
 * MAINTENANCE — run from the Apps Script editor. Lets the NEXT sweep remove
 * more sessions than the safety limit allows, once. Use it after checking
 * that the sessions really are gone from the calendar.
 */
function confirmLargeTriage() {
  if (!requireAuthorizedAdmin('Confirm Large Triage')) return;
  PropertiesService.getScriptProperties().setProperty(TRIAGE_OVERRIDE_PROP_KEY, String(Date.now()));
  log(`confirmLargeTriage: the next sweep may exceed ${TRIAGE_MAX_SESSIONS_PER_RUN} sessions. ` +
    `Run "Sync Cal" to trigger it — the permission is used up by that one sweep.`);
}

/** After sessions are removed (their calendar event vanished), pushes an updated date list to any form those sessions belonged to. */
function refreshFormDateListsForForms(keptSessionRows, map, affectedFormIds) {
  const rowsByForm = {};
  keptSessionRows.forEach(row => {
    const formId = row[map['Form_ID']];
    if (!formId || !affectedFormIds.has(formId)) return;
    if (!rowsByForm[formId]) rowsByForm[formId] = [];
    rowsByForm[formId].push(row);
  });
  const sharedFormIds = getSharedFormIdSet();

  affectedFormIds.forEach(formId => {
    const formContext = buildFormSessionContext(formId, rowsByForm[formId] || [], map, sharedFormIds);
    const dates = formContext.sessions;
    const location = describeLocations(formContext.locations);
    const { allDateLabels, lunchDateLabels } = buildDateLabelSets(formContext.sessions, formContext);
    const attendanceLabels = allDateLabels.length > 0 ? allDateLabels : ['No upcoming dates'];
    const lunchLabels = lunchDateLabels.length > 0 ? lunchDateLabels : ['No upcoming dates'];
    if (applyFormDateLabels(formId, attendanceLabels, lunchLabels, { context: 'deleted-event cleanup' })) {
      log(`Refreshed form ${formId}'s date list to ${dates.length} remaining date(s) after a deleted-event cleanup.`);
    }
    if (dates.length === 0) {
      // Emptying a live form is a big enough thing to say out loud: it means
      // every session that form covered is gone from the calendar.
      noteForAdmin('Registration forms left with no dates',
        `Form ${formId} (${formContext.locations.length > 0 ? location : 'unknown location'}) now shows ` +
        `"No upcoming dates" — every session it covered ` +
        `disappeared from the calendar. Check that this was intended.`);
    }
  });
  flushPersistentRegistries();
}

/** One pass over Lunch_and_Event_Registrants powering BOTH the Today block and the participation metrics. */
function scanRegistrants(registrantsSheet, registrantRows) {
  const result = { countsByEventId: {}, activeNamesByEventId: {} };
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const rows = registrantRows || readAllSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  rows.forEach(row => {
    const eventId = row[map['Event_ID']];
    if (!eventId) return;
    const status = row[map['Program_Status']];
    const name = row[map['Name']];

    if (!result.countsByEventId[eventId]) result.countsByEventId[eventId] = { active: 0, waitlist: 0 };
    if (status === 'Active') {
      result.countsByEventId[eventId].active++;
      if (name) {
        if (!result.activeNamesByEventId[eventId]) result.activeNamesByEventId[eventId] = new Set();
        result.activeNamesByEventId[eventId].add(String(name).trim());
      }
    }
    if (status === 'Waitlisted') result.countsByEventId[eventId].waitlist++;
  });
  return result;
}

/** One row per CALENDAR_MAP location, summarizing what's happening there today. */
function buildTodayAtLocations(sessionRows, map, registrantScan) {
  const todayKey = formatDateKey(new Date());
  const locations = Object.values(CALENDAR_MAP);

  return locations.map(loc => {
    const todaysSessions = sessionRows.filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) === todayKey && row[map['Location']] === loc;
    });
    const programs = Array.from(new Set(todaysSessions.map(r => r[map['Clean_Title']]))).sort();
    const registeredToday = todaysSessions.reduce((sum, row) => {
      const c = registrantScan.countsByEventId[row[map['Event_ID']]];
      return sum + (c ? c.active : 0);
    }, 0);
    return {
      location: loc,
      programsToday: programs.length > 0 ? programs.join(', ') : 'No programs today',
      sessionsToday: todaysSessions.length,
      registeredToday
    };
  });
}

/** Computes the "Program Participation Metrics" numbers directly from the session table + a live registrant scan. */
function computeProgramMetrics(sessionRows, map, registrantScan) {
  const totalSessions = sessionRows.length;
  const uniqueTitles = new Set();
  const uniqueParticipants = new Set();
  let totalRegistrations = 0;
  const fillRates = [];

  sessionRows.forEach(row => {
    const title = row[map['Clean_Title']];
    if (title) uniqueTitles.add(title);

    const eventId = row[map['Event_ID']];
    const c = registrantScan.countsByEventId[eventId];
    const active = c ? c.active : 0;
    totalRegistrations += active;

    const names = registrantScan.activeNamesByEventId[eventId];
    if (names) names.forEach(n => uniqueParticipants.add(n));

    const rawCap = row[map['Max_Capacity']];
    const isUncapped = rawCap === '--' || rawCap === '' || Number(rawCap) <= 0;
    if (!isUncapped) {
      const cap = Number(rawCap);
      if (cap > 0) fillRates.push((active / cap) * 100);
    }
  });

  const avgFillRate = fillRates.length > 0 ? `${Math.round(fillRates.reduce((a, b) => a + b, 0) / fillRates.length)}%` : '';

  return {
    totalPrograms: uniqueTitles.size,
    totalSessions,
    totalRegistrations,
    totalUniqueParticipants: uniqueParticipants.size,
    avgFillRate
  };
}

function setEventTimeFormulas(sheet, dataStart, count, map, dateColLetter) {
  if (count < 1) return;
  const formulas = [];
  for (let i = 0; i < count; i++) formulas.push([`=TEXT(${dateColLetter}${dataStart + i},"h:mm AM/PM")`]);
  sheet.getRange(dataStart, map['Event_Time'] + 1, count, 1).setFormulas(formulas);
}

/** Clears the sheet and redraws all sections in order, then applies all formatting. */
function writeProgramDashboardSheet(sheet, headers, map, sessionRows, todayData, metrics, force) {
  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // see renderFlatDateSheet() — hidden rows outlive clear()
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  const numCols = headers.length;
  let row = 1;

  // --- Section A: Today at Each Location (the hero block) ---
  writeSectionBanner(sheet, row, numCols,
    `📍 TODAY — ${Utilities.formatDate(new Date(), TIMEZONE, 'EEEE, MMM d, yyyy')}`, { hero: true });
  row++;
  writeSectionHeader(sheet, row, TODAY_AT_LOCATIONS_HEADERS.length, TODAY_AT_LOCATIONS_HEADERS);
  row++;
  const todayDataStart = row;
  const todayRowsOut = todayData.map(t => [t.location, t.programsToday, t.sessionsToday, t.registeredToday]);
  if (todayRowsOut.length > 0) {
    const todayRange = sheet.getRange(todayDataStart, 1, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length);
    todayRange.setValues(todayRowsOut).setVerticalAlignment('middle');
    // Same treatment as the lunch dashboard's Today block: this is the line
    // someone reads while walking past, so the numbers get real size.
    sheet.getRange(todayDataStart, 1, todayRowsOut.length, 1)
      .setFontSize(TYPO.HERO_LABEL.size).setFontWeight('bold');
    sheet.getRange(todayDataStart, 2, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length - 1)
      .setFontSize(TYPO.HERO_VALUE.size)
      .setFontWeight(TYPO.HERO_VALUE.weight)
      .setFontColor(TYPO.HERO_VALUE.color)
      .setHorizontalAlignment('center');
    for (let r = 0; r < todayRowsOut.length; r++) {
      try { sheet.setRowHeight(todayDataStart + r, ROW_HEIGHTS.HERO_DATA); } catch (err) { /* row absent */ }
    }
  }
  applyZebraStripingManualBounded(sheet, todayDataStart, todayRowsOut.length, TODAY_AT_LOCATIONS_HEADERS.length);
  row += todayRowsOut.length;
  row++; // spacer

  // --- Section B: Program Participation Metrics ---
  writeSectionBanner(sheet, row, numCols, '📈 Program Participation Metrics');
  row++;
  const metricHeaders = ['Total Programs', 'Total Sessions', 'Total Registrations', 'Unique Participants', 'Avg Fill Rate'];
  writeSectionHeader(sheet, row, metricHeaders.length, metricHeaders);
  row++;
  sheet.getRange(row, 1, 1, metricHeaders.length)
    .setValues([[metrics.totalPrograms, metrics.totalSessions, metrics.totalRegistrations, metrics.totalUniqueParticipants, metrics.avgFillRate]])
    .setFontWeight(TYPO.HERO_VALUE.weight)
    .setFontSize(TYPO.HERO_VALUE.size)
    .setFontColor(TYPO.HERO_VALUE.color)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  try { sheet.setRowHeight(row, ROW_HEIGHTS.HERO_DATA); } catch (err) { /* row absent */ }
  row++;
  row++; // spacer

  // --- Section C: All Program Sessions, split into Upcoming / Past ---
  const todayKey = formatDateKey(new Date());
  const { upcoming, past } = partitionByDate(sessionRows, map['Event_Date'], todayKey);
  const result = writeUpcomingPastSections(sheet, row, headers, upcoming, past, {
    upcomingLabel: '🔜 Upcoming Sessions', pastLabel: '🕓 Past Sessions'
  });

  const dateColLetter = columnToLetter(map['Event_Date'] + 1);
  setEventTimeFormulas(sheet, result.upcomingDataStart, upcoming.length, map, dateColLetter);
  setEventTimeFormulas(sheet, result.pastDataStart, past.length, map, dateColLetter);

  const zones = [
    { start: result.upcomingDataStart, count: upcoming.length },
    { start: result.pastDataStart, count: past.length }
  ];
  const rules = [];
  const locationRanges = [];
  if (todayRowsOut.length > 0) locationRanges.push(sheet.getRange(todayDataStart, 1, todayRowsOut.length, 1));

  zones.forEach(z => {
    if (z.count < 1) return;
    ['Active_Count', 'Max_Capacity', 'Waitlist_Count', 'Remaining_Seats'].forEach(h => {
      sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0');
    });
    applyLocationValidationBounded(sheet, map['Location'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Type_Tag'] + 1, EVENT_TYPE_OPTIONS, z.start, z.count);
    // Club and No_Registration are real checkboxes — one click, and the click
    // is what handleProgramFlagEdit() turns into a calendar-description tag.
    // Text in these columns (a workbook written by an older version says
    // "Club") is normalized to a tick by reconcileProgramFlagColumns() on the
    // next sync, and reads correctly in the meantime — see isFlagColumnValue().
    PROGRAM_FLAG_COLUMNS.forEach(flag => {
      if (map[flag.column] === undefined) return;
      sheet.getRange(z.start, map[flag.column] + 1, z.count, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });

    Object.keys(EVENT_STATUS_COLORS).forEach(text => {
      rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(EVENT_STATUS_COLORS[text])
        .setRanges([sheet.getRange(z.start, map['Status'] + 1, z.count, 1)]).build());
    });
    locationRanges.push(sheet.getRange(z.start, map['Location'] + 1, z.count, 1));
  });

  rules.push(...buildLocationColorRules(locationRanges));
  sheet.setConditionalFormatRules(rules);

  // NO YELLOW MANUAL-ENTRY WASH HERE, deliberately. Type_Tag, Club and
  // No_Registration are the cells a human changes on this table, but none of
  // them is a blank waiting to be filled in — each always already holds a
  // real, calendar-derived value, and washing full columns of correct values
  // in "please type here" yellow read as columns of problems on the tab people
  // scan first. A dropdown and two checkboxes, each with a confirmation dialog
  // behind it (see handleProgramDashboardEdit) — the prompt is the affordance,
  // not the color. Everything else keeps its warning protection.
  protectDerivedColumns(sheet, headers,
    ['Event_Date', 'Clean_Title', 'Event_Time', 'Active_Count', 'Waitlist_Count',
      'Remaining_Seats', 'Status', 'Form_ID', 'Event_ID', 'Calendar_Source'],
    zones);

  applyColumnVisibility(sheet, headers, PROGRAM_DASHBOARD_HIDDEN_COLUMNS);

  // Freeze through the Today block only, so it stays visible while the rest scrolls.
  sheet.setFrozenRows(todayDataStart + todayRowsOut.length - 1);
  freezeColumnsSafely(sheet, 3); // date, location, program name
  autosizeColumns(sheet, { force: !!force, minCols: headers.length });
  log(`renderProgramDashboard complete: ${todayRowsOut.length} location(s) today, ${upcoming.length} upcoming / ${past.length} past session row(s).`);
}


// ============================================================================
// 8. MASTER LUNCH DASHBOARD  (updateMasterLunchDashboard)
// ============================================================================
//
// Row layout:
//   1              Today banner (merged)
//   2              Today headers (TODAY_LUNCH_HEADERS)
//   3..(2+N)       One Today row per location, N = number of locations
//   spacerRow      Blank
//   (from there)   Upcoming Lunch Schedule banner/header/data, then a
//                  spacer, then Past Lunch Schedule banner/header/data —
//                  sizes are dynamic, computed fresh every render.
//
// The Today block is a pure, fully-recomputed READ-ONLY view — it's never
// itself edited. The Full Schedule (Upcoming+Past) is upserted, so
// hand-entered buffers/actuals/discrepancy numbers and Manually Added rows
// survive every sync.
// ============================================================================

function getDashboardRowPlan() {
  const numLocations = Math.max(Object.keys(CALENDAR_MAP).length, 1);
  const todayBannerRow = 1;
  const todayHeaderRow = 2;
  const todayDataStart = 3;
  const todayDataEnd = todayDataStart + numLocations - 1;
  const spacerRow = todayDataEnd + 1;
  const scheduleStartRow = spacerRow + 1;
  return { numLocations, todayBannerRow, todayHeaderRow, todayDataStart, todayDataEnd, spacerRow, scheduleStartRow };
}

/**
 * Aggregates Master_Program_Dashboard's session table + Lunch_and_Event_Registrants
 * into one row per (date, location): how many people need lunch, plus that
 * day's Meal_Shorthand/Type pulled from Lunch_Schedule (per date AND
 * location now). Only rows with Program_Status=Active AND Lunch_Status=Needed
 * count toward catering.
 *
 * Every UPCOMING session date+location is seeded at count 0 whether or not
 * anyone has registered yet, so the catering schedule shows what is coming
 * instead of materializing a date only once its first registrant appears —
 * staff need the empty rows to plan against (and to hand-enter buffers on).
 * Dates explicitly marked "Not Serving" for their location are left out;
 * a date with no Lunch_Schedule row at all IS seeded, since an unconfigured
 * date is exactly the thing worth surfacing. Past dates are never seeded —
 * that would backfill a wall of empty history.
 */
function buildDashboardRollup(registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);

  // No early return on a missing/empty session table any more: the menu is now
  // a source of dashboard rows in its own right (see SEED 1), so a catered day
  // still has to appear even on a workbook whose calendar hasn't been imported.
  const regHeaders = HEADERS.Master_Program_Dashboard;
  const regRows = registrySheet ? readAllSectionedRows(registrySheet, regHeaders, 'Event_ID') : [];
  const regMap = getIndexMap(regHeaders);

  const eventMeta = {};
  regRows.forEach(row => {
    const eventId = row[regMap['Event_ID']];
    const d = coerceDate(row[regMap['Event_Date']]);
    if (!eventId || !d) return;
    eventMeta[eventId] = { dateKey: formatDateKey(d), location: row[regMap['Location']] || '' };
  });

  const rollup = {};
  /** date|location -> people who wanted lunch on a day now marked Not Serving. */
  const notServingWithSignups = {};
  const todayKey = formatDateKey(new Date());

  const seed = (dateKey, location) => {
    const key = `${dateKey}|${location}`;
    if (!rollup[key]) {
      rollup[key] = { dateKey, location, registeredCount: 0, servedConfirmed: 0 };
    }
    return rollup[key];
  };

  // SEED 1 — every upcoming Hot/Cold row on Lunch_Schedule, whether or not a
  // program runs that day.
  //
  // A catered day is a catering commitment. The kitchen is cooking, the order
  // has to be placed, and the number has to appear somewhere someone looks —
  // and "somewhere someone looks" is this tab. Seeding only from the session
  // table meant a meal with no programming behind it (a drop-in lunch, a
  // holiday meal, a day whose calendar event hasn't been made yet) was
  // invisible here even though the menu plainly said it was happening.
  //
  // The menu row is taken as authoritative, deliberately over the location's
  // catering policy: a policy is a default about what USUALLY happens, and an
  // explicit Hot/Cold row for a specific date is somebody overriding it on
  // purpose. The one case worth querying is a menu row at a Never location,
  // which is contradictory rather than deliberate — flagged below, not
  // silently dropped.
  const menuSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
  const menuMap = getIndexMap(HEADERS.Lunch_Schedule);
  (menuSheet ? readLunchScheduleRows(menuSheet) : []).forEach(row => {
    const d = coerceDate(row[menuMap['Event_Date']]);
    const location = String(row[menuMap['Location']] || '').trim();
    const type = String(row[menuMap['Type']] || '').trim();
    if (!d || !location) return;
    if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return; // "Not Serving", or blank
    const dateKey = formatDateKey(d);
    if (dateKey < todayKey) return; // past dates are never seeded — see below

    if (getCateringPolicyForLocation(location) === CATERING_POLICIES.NEVER) {
      noteForAdmin('Menu set at a Never-catering location',
        `Lunch_Schedule has a ${type} row for ${location} on ${formatDateLabel(d)}, but that location's ` +
        `policy in Config is "Never". Either change the policy or remove the menu row — as it stands the ` +
        `date is being catered for a location that is supposed to serve no food.`);
      return;
    }
    seed(dateKey, location);
  });

  // SEED 2 — upcoming session date+location pairs, so the schedule also shows
  // programming that is coming but has no menu row yet. Gated on
  // isLunchOfferedOn(), or a never-catering location (Zoom) would contribute a
  // blank row for every single session it runs.
  //
  // Past dates are never seeded by either pass — that would backfill a wall of
  // empty history. Past rows appear only where a registrant or a served meal
  // put them there.
  Object.keys(eventMeta).forEach(eventId => {
    const meta = eventMeta[eventId];
    if (!meta.location || meta.dateKey < todayKey) return;
    if (!isLunchOfferedOn(parseDateKey(meta.dateKey), meta.location)) return;
    seed(meta.dateKey, meta.location);
  });

  if (registrantsSheet || registrantRows) {
    const lrHeaders = HEADERS.Lunch_and_Event_Registrants;
    const lrRows = registrantRows || readAllSectionedRows(registrantsSheet, lrHeaders, 'Event_ID');
    const lrMap = getIndexMap(lrHeaders);
    lrRows.forEach(row => {
      const eventId = row[lrMap['Event_ID']];
      let meta = eventMeta[eventId];
      if (!meta) {
        // A row with no session behind it is normally a stale Event_ID whose
        // event has been deleted, and is triaged rather than counted. The one
        // exception is a LUNCH-ONLY row — somebody who came in for the meal on
        // a day with no program, added from the Quick Mark panel (see
        // LUNCH_ONLY_EVENT_ID_PREFIX). Those never have a session, and their
        // meal is exactly as real as anyone else's, so they take their date and
        // location from the row itself.
        if (!isLunchOnlyEventId(eventId)) return;
        const d = coerceDate(row[lrMap['Event_Date']]);
        const loc = String(row[lrMap['Location']] || '').trim();
        if (!d || !loc) return;
        meta = { dateKey: formatDateKey(d), location: loc };
      }

      // Served_Confirmed counts what staff actually TICKED, independently of
      // what the form said — that's the whole point of the column. A person
      // whose Lunch_Served box is checked counts here even if they never
      // requested lunch on the form (walk-ins happen), which is why this is
      // tallied before the Program_Status/Lunch_Status filter below.
      if (isTruthyCheckbox(row[lrMap['Lunch_Served']])) {
        const servedKey = `${meta.dateKey}|${meta.location}`;
        if (!rollup[servedKey]) {
          rollup[servedKey] = {
            dateKey: meta.dateKey, location: meta.location,
            registeredCount: 0, servedConfirmed: 0, unplanned: true
          };
        }
        rollup[servedKey].servedConfirmed = (rollup[servedKey].servedConfirmed || 0) + 1;
      }

      // THE MEAL COUNTS feed Master_Lunch_Dashboard's consumption columns the
      // same way Lunch_Served feeds Served_Confirmed — tallied unconditionally,
      // before the Program_Status/Lunch_Status filter below, because a
      // walk-in's actual meal counts whether or not they were ever registered.
      //
      // Each count now says its own destination (MEAL_COUNT_TO_DASHBOARD_COLUMN),
      // so one row can contribute a dined-in day-1 meal AND two taken-out subs
      // at once. Previously a single Meals_In_Fridge checkbox routed the whole
      // row one way or the other, which made the mixed case unsayable.
      const meals = readRegistrantMealCounts(row, lrMap);
      if (meals.total > 0) {
        const mealKey = `${meta.dateKey}|${meta.location}`;
        if (!rollup[mealKey]) {
          rollup[mealKey] = {
            dateKey: meta.dateKey, location: meta.location,
            registeredCount: 0, servedConfirmed: 0, unplanned: true
          };
        }
        const bucket = rollup[mealKey];
        Object.keys(meals.byDashboardColumn).forEach(column => {
          bucket.mealTallies = bucket.mealTallies || {};
          bucket.mealTallies[column] = (bucket.mealTallies[column] || 0) + meals.byDashboardColumn[column];
        });
      }

      if (row[lrMap['Program_Status']] !== 'Active' || row[lrMap['Lunch_Status']] !== 'Needed') return;

      if (getCateringPolicyForLocation(meta.location) === CATERING_POLICIES.NEVER) {
        // NEVER is a hard fact ("this location cannot serve food"), not a
        // scheduling gap — so unlike ALWAYS/BY_EXCEPTION below, demand does
        // NOT override it. A row like this is a data artifact, almost
        // always a form that still asked about lunch before its location
        // was set to Never (createRegistrationForm()/refreshFormForNewDates()
        // strip that question going forward, but can't undo an answer
        // someone already submitted). Flag it for cleanup instead of
        // putting a blank row on the dashboard.
        noteForAdmin('Lunch needed at a Never-catering location',
          `${row[lrMap['Name']]} is marked Lunch_Status=Needed for ${meta.location} on ` +
          `${formatDateLabel(parseDateKey(meta.dateKey))}, but that location's policy is "Never." ` +
          `Probably a stale form answer — fix their Lunch_Status on Lunch_and_Event_Registrants.`);
        return;
      }

      // ...EXCEPT over an explicit "Not Serving". A missing menu row is a gap
      // and demand rightly overrides it (below); a row that READS "Not
      // Serving" is somebody's decision that the kitchen is closed that day,
      // and quietly catering it anyway because three people ticked a box on a
      // form weeks ago is not a safety net, it's an unordered meal.
      //
      // So the date leaves the dashboard, and the people who signed up are
      // collected here and reported by name below. Suppressing them silently
      // would be the actually dangerous version of this.
      if (isExplicitlyNotServing(parseDateKey(meta.dateKey), meta.location)) {
        const nsKey = `${meta.dateKey}|${meta.location}`;
        if (!notServingWithSignups[nsKey]) {
          notServingWithSignups[nsKey] = { dateKey: meta.dateKey, location: meta.location, people: [] };
        }
        notServingWithSignups[nsKey].people.push(String(row[lrMap['Name']] || '').trim() || '(unnamed)');
        return;
      }

      // DEMAND ALWAYS WINS (for ALWAYS/BY_EXCEPTION). Policy decides what
      // gets SEEDED; it never suppresses a date somebody is actually signed
      // up to eat on. This is the safety net for "By exception" — forgetting
      // to add the menu row can make a date invisible on the schedule, but
      // never invisible once a real person is expecting lunch.
      const key = `${meta.dateKey}|${meta.location}`;
      if (!rollup[key]) {
        rollup[key] = {
          dateKey: meta.dateKey, location: meta.location,
          registeredCount: 0, servedConfirmed: 0, unplanned: true
        };
      }
      rollup[key].registeredCount++;
    });
  }

  // Anything that only exists because someone registered for it, on a date
  // with no catered menu behind it, is worth telling a human about.
  Object.keys(rollup).forEach(key => {
    const r = rollup[key];
    if (!r.unplanned || r.registeredCount === 0 || r.dateKey < todayKey) return;
    const meal = getMealInfoForDate(parseDateKey(r.dateKey), r.location);
    const hasMenu = !!meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1;
    if (hasMenu) return;
    noteForAdmin('Lunch needed with no menu set',
      `${r.registeredCount} person(s) need lunch at ${r.location} on ${formatDateLabel(parseDateKey(r.dateKey))}, ` +
      `but Lunch_Schedule has no Hot/Cold row for it.`);
  });

  // THE ONE THAT MATTERS MOST IN THIS FILE'S DIGEST. Everything else it
  // reports is a number that looks wrong somewhere; this is real people who
  // asked for a meal, are going to turn up expecting it, and are about to
  // stop appearing on every screen anyone looks at. The dashboard row going
  // away is correct — the kitchen is closed — but it must not be the last
  // anyone hears of it, so the names go out by email rather than only to a
  // log nobody reads.
  Object.keys(notServingWithSignups).forEach(key => {
    const entry = notServingWithSignups[key];
    if (entry.dateKey < todayKey) return; // already happened; nothing to act on
    noteForAdmin('⚠️ Lunch cancelled with people signed up',
      `${entry.people.length} person(s) asked for lunch at ${entry.location} on ` +
      `${formatDateLabel(parseDateKey(entry.dateKey))}, which Lunch_Schedule now marks "Not Serving": ` +
      `${entry.people.join(', ')}. They have been removed from the catering count and need telling. ` +
      `To keep the meal, change that date's Type back to Hot or Cold on Lunch_Schedule.`);
  });

  return Object.values(rollup).map(r => {
    const meal = getMealInfoForDate(parseDateKey(r.dateKey), r.location);
    r.mealType = meal ? meal.type : '';
    r.mealShorthand = meal ? (meal.shorthand || meal.description) : '';
    return r;
  }).sort((a, b) => (a.dateKey === b.dateKey ? a.location.localeCompare(b.location) : (a.dateKey < b.dateKey ? -1 : 1)));
}

function updateMasterLunchDashboard(registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LUNCH_DASHBOARD);
  const headers = HEADERS.Master_Lunch_Dashboard;
  const map = getIndexMap(headers);
  const plan = getDashboardRowPlan();
  const rollup = buildDashboardRollup(registrantRows);

  // 'Standard_Buffer' is unique to the Full Schedule headers (not present
  // on TODAY_LUNCH_HEADERS), so it safely finds only the schedule's own
  // header rows and not the Today block's.
  const existingTable = readAllSectionedRows(sheet, headers, 'Standard_Buffer');
  const tableByKey = {};
  existingTable.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d) return;
    tableByKey[`${formatDateKey(d)}|${row[map['Location']]}`] = row;
  });

  rollup.forEach(r => {
    const key = `${r.dateKey}|${r.location}`;
    let row = tableByKey[key];
    const override = row ? row[map['Manual_Override']] : null;
    if (override === 'Manually Added' || override === 'Manually Edited') return;

    if (!row) {
      row = new Array(headers.length).fill('');
      row[map['Manual_Override']] = 'Auto-Synced';
      tableByKey[key] = row;
      existingTable.push(row);
    }

    // BUFFERS ARE READ FROM CONFIG ON EVERY RENDER, not written once at row
    // creation. The old code did the latter AND special-cased "no registrants
    // yet" to a hard 0 — so a date seeded before anybody signed up kept a
    // zero buffer forever, which is why the column read as zeroes on exactly
    // the upcoming dates it was supposed to be padding. There is one source of
    // truth for a buffer and it is the Config tab.
    const bufferConfig = getMealBufferConfigForLocation(r.location, r.mealType || 'Hot');
    row[map['Standard_Buffer']] = bufferConfig.standardBufferAmount;
    row[map['Tester_Buffer']] = bufferConfig.testerBufferAmount;

    row[map['Event_Date']] = parseDateKey(r.dateKey);
    row[map['Location']] = r.location;
    row[map['Lunch_Type']] = r.mealType || '';
    row[map['Meal_Shorthand']] = r.mealShorthand || '';
    row[map['Registered_Count']] = r.registeredCount;
    // Blank rather than 0 until someone has actually ticked a box: a real
    // zero ("nobody turned up") and "not counted yet" mean very different
    // things to whoever reconciles this, and 0 would assert the first.
    row[map['Served_Confirmed']] = r.servedConfirmed > 0 ? r.servedConfirmed : '';

    // The consumption columns only move when the Registrants tab actually
    // reports a meal for this date+location — a zero tally leaves whatever is
    // already in the cell alone, rather than blanking out a value someone
    // typed by hand before the per-person counts existed. Once real counts
    // start coming in they take over automatically, same as Served_Confirmed.
    const tallies = r.mealTallies || {};
    Object.keys(tallies).forEach(column => {
      if (map[column] !== undefined && tallies[column] > 0) row[map[column]] = tallies[column];
    });
  });

  writeMasterLunchDashboardSheet(sheet, plan, headers,
    dropNotServingRows(existingTable, map, rollup), rollup);
}

/**
 * Removes the schedule rows for upcoming dates that Lunch_Schedule now marks
 * "Not Serving".
 *
 * WHY THIS IS NEEDED AT ALL: the Full Schedule table is UPSERTED, not rebuilt.
 * That's deliberate — it's what makes hand-entered buffers and actuals survive
 * every sync — but it also means a row, once written, never leaves on its own.
 * So closing the kitchen on a date the dashboard had already picked up left
 * the row sitting there with its old count, indefinitely, and the ordering
 * number stayed on the screen the kitchen orders from.
 *
 * Three things are deliberately NOT dropped:
 *
 *   PAST DATES. Those rows hold Actual_Ordered / Total_Consumed / Thrown_Away —
 *   a record of what really happened. Marking an old date "Not Serving" is
 *   almost always a correction to the plan, and it must not erase the receipt.
 *
 *   HAND-EDITED ROWS (Manually Added / Manually Edited). Everything else in
 *   this workbook treats those as untouchable; an exception here would be the
 *   one place a person's own row disappears under them. Reported instead.
 *
 *   ROWS STILL IN THE ROLLUP. A "Not Serving" day where somebody's
 *   Lunch_Served box is ticked stays, because food demonstrably happened —
 *   Served_Confirmed records reality, not the plan.
 */
function dropNotServingRows(tableRows, map, rollup) {
  const inRollup = {};
  (rollup || []).forEach(r => { inRollup[`${r.dateKey}|${r.location}`] = true; });

  const todayKey = formatDateKey(new Date());
  const kept = [];
  let dropped = 0;

  tableRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    const location = String(row[map['Location']] || '').trim();
    if (!d || !location) { kept.push(row); return; }

    const dateKey = formatDateKey(d);
    if (inRollup[`${dateKey}|${location}`]) { kept.push(row); return; }
    if (dateKey < todayKey) { kept.push(row); return; }
    if (!isExplicitlyNotServing(d, location)) { kept.push(row); return; }

    const override = String(row[map['Manual_Override']] || '').trim();
    if (override === 'Manually Added' || override === 'Manually Edited') {
      noteForAdmin('Not-Serving date still on the lunch dashboard',
        `${formatDateLabel(d)} at ${location} is marked "Not Serving", but its dashboard row was ` +
        `hand-edited (${override}) so it has been left alone. Delete it yourself if it shouldn't be ordered.`);
      kept.push(row);
      return;
    }

    dropped++;
  });

  if (dropped > 0) {
    log(`Master_Lunch_Dashboard: removed ${dropped} upcoming row(s) for date+location(s) now marked "Not Serving".`);
  }
  return kept;
}

function writeMasterLunchDashboardSheet(sheet, plan, headers, fullTableRows, rollup) {
  const map = getIndexMap(headers);
  const numCols = headers.length;

  sheet.clear();
  sheet.clearFormats();
  showAllRows(sheet); // see renderFlatDateSheet() — hidden rows outlive clear()
  sheet.getBandings().forEach(b => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  writeSectionBanner(sheet, plan.todayBannerRow, numCols,
    `📋 TODAY'S LUNCH — ${Utilities.formatDate(new Date(), TIMEZONE, 'EEEE, MMM d, yyyy')}`,
    { hero: true });
  writeSectionHeader(sheet, plan.todayHeaderRow, TODAY_LUNCH_HEADERS.length, TODAY_LUNCH_HEADERS);
  const todayMap = getIndexMap(TODAY_LUNCH_HEADERS);

  const todayKey = formatDateKey(new Date());
  const dateColIdx = map['Event_Date'];
  const { upcoming, past } = partitionByDate(fullTableRows, dateColIdx, todayKey);

  const registeredCol = columnToLetter(map['Registered_Count'] + 1);
  const standardBufferCol = columnToLetter(map['Standard_Buffer'] + 1);
  const testerBufferCol = columnToLetter(map['Tester_Buffer'] + 1);
  const totalToOrderColLetter = columnToLetter(map['Total_to_Order'] + 1);

  // Deterministic row math mirroring exactly what writeUpcomingPastSections()
  // below will place, computed up front so the Total_to_Order formulas (and
  // the Today block's cross-reference to them) can be written before the
  // sections are actually rendered.
  const upcomingHeaderRow = plan.scheduleStartRow + 1;
  const upcomingDataStart = upcomingHeaderRow + 1;
  // +1 blank spacer row, +1 for the Past section's own banner row (writeUpcomingPastSections
  // writes: spacer, banner, header, data — so the header sits TWO rows after the last
  // upcoming data row's end, not one; this previously under-counted by one row).
  const pastHeaderRow = upcomingDataStart + upcoming.length + 2;
  const pastDataStart = pastHeaderRow + 1;

  const scheduleRowByKey = {};
  const assignRowKeyAndFormula = (row, sheetRow) => {
    const d = coerceDate(row[map['Event_Date']]);
    if (d) scheduleRowByKey[`${formatDateKey(d)}|${row[map['Location']]}`] = sheetRow;
    row[map['Total_to_Order']] = `=${registeredCol}${sheetRow}+${standardBufferCol}${sheetRow}+${testerBufferCol}${sheetRow}`;
  };
  upcoming.forEach((row, i) => assignRowKeyAndFormula(row, upcomingDataStart + i));
  past.forEach((row, i) => assignRowKeyAndFormula(row, pastDataStart + i));

  const locations = Object.values(CALENDAR_MAP);
  const todayRows = locations.map(loc => {
    const match = rollup.find(r => r.dateKey === todayKey && r.location === loc);
    const row = new Array(TODAY_LUNCH_HEADERS.length).fill('');
    row[todayMap['Location']] = loc;
    if (match) {
      row[todayMap['Lunch_Type']] = match.mealType || '';
      row[todayMap['Meal_Shorthand']] = match.mealShorthand || '';
      row[todayMap['Registered_Count']] = match.registeredCount;
      row[todayMap['Served_Confirmed']] = match.servedConfirmed > 0 ? match.servedConfirmed : '';
      const scheduleRow = scheduleRowByKey[`${todayKey}|${loc}`];
      row[todayMap['Total_to_Order']] = scheduleRow ? `=${totalToOrderColLetter}${scheduleRow}` : match.registeredCount;
    } else {
      row[todayMap['Lunch_Type']] = '';
      row[todayMap['Meal_Shorthand']] = 'No lunch orders today';
      row[todayMap['Registered_Count']] = 0;
      row[todayMap['Served_Confirmed']] = '';
      row[todayMap['Total_to_Order']] = 0;
    }
    return row;
  });

  if (todayRows.length > 0) {
    const todayRange = sheet.getRange(plan.todayDataStart, 1, todayRows.length, TODAY_LUNCH_HEADERS.length);
    todayRange.setValues(todayRows);
    // The Today block is the one thing on this tab someone reads standing up,
    // mid-service, from further away than a spreadsheet is normally read — so
    // it gets a real size step, taller rows, and centered numbers rather than
    // being just another 10pt table.
    todayRange.setFontSize(TYPO.HERO_LABEL.size).setVerticalAlignment('middle');
    ['Registered_Count', 'Served_Confirmed', 'Total_to_Order'].forEach(h => {
      sheet.getRange(plan.todayDataStart, todayMap[h] + 1, todayRows.length, 1)
        .setNumberFormat('0')
        .setFontSize(TYPO.HERO_VALUE.size)
        .setFontWeight(TYPO.HERO_VALUE.weight)
        .setFontColor(TYPO.HERO_VALUE.color)
        .setHorizontalAlignment('center');
    });
    sheet.getRange(plan.todayDataStart, todayMap['Location'] + 1, todayRows.length, 1)
      .setFontSize(TYPO.HERO_LABEL.size).setFontWeight('bold');
    for (let r = 0; r < todayRows.length; r++) {
      try { sheet.setRowHeight(plan.todayDataStart + r, ROW_HEIGHTS.HERO_DATA); } catch (err) { /* row absent */ }
    }
  }
  applyZebraStripingManualBounded(sheet, plan.todayDataStart, todayRows.length, TODAY_LUNCH_HEADERS.length);
  sheet.getRange(plan.spacerRow, 1, 1, numCols).clearContent().setBackground('#FFFFFF');

  const result = writeUpcomingPastSections(sheet, plan.scheduleStartRow, headers, upcoming, past, {
    upcomingLabel: '📊 Upcoming Lunch Schedule', pastLabel: '📊 Past Lunch Schedule'
  });
  if (result.upcomingDataStart !== upcomingDataStart || result.pastDataStart !== pastDataStart) {
    log(`⚠️ Master_Lunch_Dashboard row math mismatch — Total_to_Order cross-references may be off. ` +
      `Expected upcoming@${upcomingDataStart}/past@${pastDataStart}, got upcoming@${result.upcomingDataStart}/past@${result.pastDataStart}.`);
  }

  labelManualEntryColumns(sheet, result.upcomingHeaderRow, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);
  labelManualEntryColumns(sheet, result.pastHeaderRow, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);

  const zones = [
    { start: result.upcomingDataStart, count: result.upcomingCount },
    { start: result.pastDataStart, count: result.pastCount }
  ];
  const numericCols = ['Registered_Count', 'Served_Confirmed', 'Actual_Ordered', 'Standard_Buffer',
    'Tester_Buffer', 'Day_1_In-Person', 'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'In_Fridge',
    'Total_Consumed', 'Thrown_Away', 'Discrepancy'];

  zones.forEach(z => {
    if (z.count < 1) return;
    sheet.getRange(z.start, map['Event_Date'] + 1, z.count, 1).setNumberFormat('M/d/yyyy');
    numericCols.forEach(h => sheet.getRange(z.start, map[h] + 1, z.count, 1).setNumberFormat('0'));
    tintManualEntryColumns(sheet, z.start, z.count, headers, LUNCH_DASHBOARD_MANUAL_COLUMNS);
  });

  sheet.setFrozenRows(result.upcomingHeaderRow);
  const locationCol = map['Location'] + 1;

  zones.forEach(z => {
    if (z.count < 1) return;
    applyManualOverrideValidationBounded(sheet, map['Manual_Override'] + 1, z.start, z.count);
    applyValueListValidationBounded(sheet, map['Lunch_Type'] + 1, LUNCH_TYPE_OPTIONS, z.start, z.count);
    applyLocationValidationBounded(sheet, locationCol, z.start, z.count);
  });

  const todayLocationCol = todayMap['Location'] + 1;
  applyLocationValidationBounded(sheet, todayLocationCol, plan.todayDataStart, plan.numLocations);

  const rules = [];
  const manualEntryColIndexes = LUNCH_DASHBOARD_MANUAL_COLUMNS.map(h => map[h] + 1);
  zones.forEach(z => {
    if (z.count < 1) return;
    rules.push(...buildManualOverrideRowTintRules(sheet, z.start, z.count, numCols, map['Manual_Override'] + 1,
      [locationCol, map['Event_Date'] + 1, ...manualEntryColIndexes]));
  });

  const activeZones = zones.filter(z => z.count > 0);
  const typeRanges = activeZones.map(z => sheet.getRange(z.start, map['Lunch_Type'] + 1, z.count, 1));
  const notServingRule = buildTextEqualsRuleForRanges(typeRanges, 'Not Serving', NOT_SERVING_COLOR);
  if (notServingRule) rules.push(notServingRule);

  // Location color-coding on the LOCATION CELL ONLY, the same as every other
  // tab. It used to wash the whole row, on the theory that a block of color
  // makes "everything for Ashbridge that week" scannable — but this tab
  // already carries the month tint on Event_Date, the grey "Not Serving"
  // type, the purple manual-override tint and a yellow band of hand-entry
  // columns, and a full-row wash underneath all of that turned the numbers
  // people read into figures on a colored background rather than making
  // anything easier to find. One cell says the same thing and gets out of
  // the way.
  const locationRanges = activeZones.map(z => sheet.getRange(z.start, locationCol, z.count, 1));
  locationRanges.push(sheet.getRange(plan.todayDataStart, todayLocationCol, plan.numLocations, 1));
  rules.push(...buildLocationColorRules(locationRanges));

  sheet.setConditionalFormatRules(rules);

  // Everything to the left of the hand-entry columns is derived from the forms
  // and the menu — warn if someone types over it. Manual_Override is left
  // editable on purpose: switching a row to "Manually Added" is precisely how
  // staff tell the sync to stop managing it.
  protectDerivedColumns(sheet, headers,
    ['Event_Date', 'Location', 'Lunch_Type', 'Meal_Shorthand', 'Registered_Count', 'Served_Confirmed',
      'Day_1_In-Person', 'Day_1_Takeaway', 'Subs_In-Person', 'Subs_Takeaway', 'In_Fridge',
      // Config owns these now — typing over one is overwritten on the next
      // render, and the warning says where to change it instead.
      'Standard_Buffer', 'Tester_Buffer'],
    zones);

  // Nothing on this tab is an internal key, so nothing is hidden — but the
  // call still runs, so a column taken OFF a future hidden list reappears.
  applyColumnVisibility(sheet, headers, LUNCH_DASHBOARD_HIDDEN_COLUMNS);
  freezeColumnsSafely(sheet, 2); // date + location stay visible across the wide reconciliation columns

  autosizeColumns(sheet, { minCols: numCols });
}


// ============================================================================
// 9. PRINTED SIGN-IN SHEET  (a landscape PDF to mark up by hand)
// ============================================================================
//
// Everything else in this workbook assumes a screen. The sign-in desk does not
// have one — or has one that is already showing something else, with a queue
// of people in front of it. What that desk needs is paper: one page per
// session, the expected people already on it, and empty boxes to tick and to
// write meal counts into, which somebody types back in afterwards.
//
// So this builds exactly that. It takes the registrants for one date and
// location, plus what the kitchen is serving that day, and produces a
// LANDSCAPE PDF whose columns are the ones the desk actually uses:
//
//   "In CoPilot"  CAME  Last  First  Phone #  Program  Family / Alt Name
//   Extra Notes  "MEALS ORDERED"  "DINED IN #"  "TAKE OUT #"  "# PUT IN FRIDGE"
//
// The last four line up one-for-one with the per-registrant meal counts on the
// Registrants tab (see REGISTRANT_MEAL_COUNT_COLUMNS), so transcribing a
// finished sheet back into the workbook is column-for-column with no
// re-interpretation — which is the whole reason the meal counts were split per
// person in the first place.
//
// IT IS A SHEET FOR A DAY AND A PLACE, NOT FOR A PROGRAM. The desk is one desk:
// whoever is on it that morning signs in everybody who walks up, whichever
// program they came for, and hands out lunch to the subset who ordered it. A
// per-program sheet would mean the same person holding three sheets and
// guessing which one a given arrival is on — so the picker asks for a LOCATION
// and a DATE, and the roster is every registrant at that place on that day
// across every program, with a Program column saying which is which.
//
// EVERYONE APPEARS, INCLUDING THE PEOPLE NOT EATING, and this is the part that
// is easy to get wrong in the other direction. Printing only the lunch list
// would give the kitchen a clean count and leave the sign-in desk unable to
// tick off half the people in front of it. Printing everyone with the meal
// columns left blank is worse still: a blank box is indistinguishable from a
// box nobody has filled in yet, so at the end of service there is no way to
// tell "ordered nothing" from "we forgot to ask". So a registrant with no
// lunch is printed with a literal 0 in each of the four meal columns — already
// answered, nothing to collect, and it transcribes back as the zero it is.
//
// ONE PAGE unless the roster does not fit, in which case it runs onto as many
// as it needs, with the header row repeated. Landscape is not a preference:
// twelve columns, several of them handwritten-into, do not fit across a
// portrait page at a legible size.
// ============================================================================

/** The printed sheet's columns, left to right, exactly as they appear on paper. */
const SIGN_IN_SHEET_COLUMNS = [
  'In CoPilot', 'CAME', 'Last', 'First', 'Phone #', 'Program', 'Family / Alt Name', 'Extra Notes',
  'MEALS ORDERED', 'DINED IN #', 'TAKE OUT #', '# PUT IN FRIDGE'
];

/**
 * Relative column widths. The three hand-tick columns are narrow, the name,
 * program and notes columns wide — a Doc table divides the page by these, so
 * they are proportions rather than measurements.
 */
const SIGN_IN_SHEET_COLUMN_WEIGHTS = [6, 6, 11, 11, 11, 12, 12, 14, 8, 7, 7, 8];

/** Longest program name printed before it is clipped — the column is ~78pt wide. */
const SIGN_IN_SHEET_MAX_PROGRAM_CHARS = 22;

/** Blank rows added under the roster, for walk-ins nobody knew about. */
const SIGN_IN_SHEET_BLANK_ROWS = 8;

/** US Letter, landscape, in points — the page this is designed against. */
const SIGN_IN_PAGE = { width: 792, height: 612, margin: 28 };

/** Where finished PDFs are filed. Sits beside the forms folder rather than loose in My Drive. */
const SIGN_IN_SHEET_FOLDER_NAME = 'Printed Sign-In Sheets';

/** MENU ENTRY: pick a location + date, get a PDF. */
function showSignInSheetDialog() {
  const options = listSignInSheetOptions();
  if (options.length === 0) {
    toastIfPossible('Nothing to print yet — no sessions or lunch dates in the next few weeks. Run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildSignInSheetHtml(options))
    .setWidth(520)
    .setHeight(440); // three dropdowns now, not two
  SpreadsheetApp.getUi().showModalDialog(html, 'Print a Sign-In Sheet');
}

/**
 * Every location+date worth offering: every session on the dashboard and every
 * catered day on the menu, within a window either side of today.
 *
 * Both sources, because the two answer different questions — the dashboard
 * knows where people are expected, the menu knows where food is being served,
 * and a sign-in sheet is wanted for either. Yesterday and the day before are
 * included on purpose: the commonest reason to print one late is that the
 * original went missing mid-service.
 *
 * Returned as one flat list of entries rather than a location -> dates map:
 * the dialog needs the locations for one dropdown and the dates for the other,
 * and deriving both from a flat list in the browser keeps the shape this
 * function has to promise down to a single thing.
 */
const SIGN_IN_SHEET_WINDOW_BACK_DAYS = 7;
const SIGN_IN_SHEET_WINDOW_FORWARD_DAYS = 45;

/** Bound on how many location+date pairs the dialog carries. The window already limits this; the cap is a backstop. */
const SIGN_IN_SHEET_MAX_OPTIONS = 400;

function listSignInSheetOptions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - SIGN_IN_SHEET_WINDOW_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + SIGN_IN_SHEET_WINDOW_FORWARD_DAYS * 86400000));

  const byKey = {};
  const note = (date, location, programTitle, catered) => {
    const d = coerceDate(date);
    const loc = String(location || '').trim();
    if (!d || !loc) return;
    const dateKey = formatDateKey(d);
    if (dateKey < from || dateKey > to) return;
    const key = `${dateKey}|${loc}`;
    if (!byKey[key]) {
      byKey[key] = { dateKey, location: loc, programs: [], catered: false, distance: Math.abs(d - today) };
    }
    if (catered) byKey[key].catered = true;
    const title = String(programTitle || '').trim();
    if (title && byKey[key].programs.indexOf(title) === -1) byKey[key].programs.push(title);
  };

  try {
    const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (dash) {
      const headers = HEADERS.Master_Program_Dashboard;
      const map = getIndexMap(headers);
      readAllSectionedRows(dash, headers, 'Event_ID').forEach(row => {
        note(row[map['Event_Date']], row[map['Location']], row[map['Clean_Title']], false);
      });
    }
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read the program dashboard (${err}).`);
  }

  try {
    const menu = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
    if (menu) {
      const map = getIndexMap(HEADERS.Lunch_Schedule);
      readLunchScheduleRows(menu).forEach(row => {
        const type = String(row[map['Type']] || '').trim();
        if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return;
        note(row[map['Event_Date']], row[map['Location']], '', true);
      });
    }
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read ${SHEET_NAMES.LUNCH_SCHEDULE} (${err}).`);
  }

  return Object.keys(byKey)
    .map(k => byKey[k])
    // Nearest-first for the CAP only, so that trimming an overlong list drops
    // the far-future dates rather than an arbitrary slice. The dialog re-sorts
    // each location's dates chronologically, which is the order a person
    // scanning a date dropdown expects.
    .sort((a, b) => (a.distance - b.distance) || a.location.localeCompare(b.location))
    .slice(0, SIGN_IN_SHEET_MAX_OPTIONS)
    .map(entry => ({
      value: `${entry.dateKey}|${entry.location}`,
      dateKey: entry.dateKey,
      location: entry.location,
      distance: entry.distance,
      label: formatDateLabel(parseDateKey(entry.dateKey)) +
        (entry.catered ? '  •  lunch served' : '') +
        (entry.programs.length > 0
          ? `  •  ${entry.programs.slice(0, 3).join(', ')}${entry.programs.length > 3 ? `, +${entry.programs.length - 3} more` : ''}`
          : '  •  no program scheduled')
    }));
}

/**
 * The dialog's markup. Inline, so this project stays a single .gs file.
 *
 * TWO dropdowns — location, then date — rather than the single combined
 * "date — location (programs)" list this used to show. That one list read as a
 * program picker, because the program names were the most distinctive thing in
 * each row, and it made the commonest task (I am on the desk at one site, show
 * me today) a hunt through every site's dates interleaved. Picking the place
 * first and then the day matches how somebody actually arrives at wanting this.
 *
 * The date list is filtered in the BROWSER from a JSON copy of the options,
 * so changing location is instant — a google.script.run round trip per change
 * would put a visible stall on a dropdown people flick between.
 */
function buildSignInSheetHtml(options) {
  const locations = [];
  options.forEach(o => { if (locations.indexOf(o.location) === -1) locations.push(o.location); });
  locations.sort();

  // Whichever location owns the nearest date opens selected — on the day
  // itself that is almost always the one wanted.
  const nearest = options.slice().sort((a, b) => a.distance - b.distance)[0];
  const defaultLocation = nearest ? nearest.location : (locations[0] || '');

  const locationTags = locations
    .map(loc => `<option value="${escapeHtmlForDialog(loc)}"${loc === defaultLocation ? ' selected' : ''}>` +
      `${escapeHtmlForDialog(loc)}</option>`)
    .join('\n');

  // `<` is escaped so a location or program name containing one can never
  // close the script element early.
  const payload = JSON.stringify(options).replace(/</g, '\\u003c');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
  select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; }
  label { display: block; margin: 12px 0 4px 0; font-weight: bold; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  a { color: #1155CC; }
</style>
<h3>Print a sign-in sheet</h3>
<p class="hint">
  One landscape page for a place and a day — everyone registered for any program there that day,
  with empty boxes for CAME and the meal counts. Anyone who did not order lunch is printed with 0s
  in the meal columns. Extra blank rows are added for walk-ins.
</p>
<label for="location">Location</label>
<select id="location" onchange="fillDates()">${locationTags}</select>
<label for="session">Date</label>
<select id="session"></select>
<label for="include">Who to list</label>
<select id="include">
  <option value="active">Active registrations only (recommended)</option>
  <option value="all">Everyone, including cancelled and waitlisted</option>
</select>
<button id="go" onclick="submit()">Create PDF</button>
<div id="status"></div>
<script>
  var OPTIONS = ${payload};

  function fillDates() {
    var loc = document.getElementById('location').value;
    var sel = document.getElementById('session');
    sel.innerHTML = '';
    var mine = OPTIONS.filter(function (o) { return o.location === loc; });
    mine.sort(function (a, b) { return a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0); });
    var best = null;
    mine.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
      if (best === null || o.distance < best.distance) best = o;
    });
    if (best) sel.value = best.value; // land on the nearest day, not the earliest
    document.getElementById('go').disabled = mine.length === 0;
    if (mine.length === 0) say('Nothing scheduled at this location in the next few weeks.', 'err');
    else say('', '');
  }

  function submit() {
    var session = document.getElementById('session').value;
    var include = document.getElementById('include').value;
    if (!session) { say('Pick a date first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Building the PDF…', '');
    google.script.run
      .withSuccessHandler(function (res) {
        document.getElementById('go').disabled = false;
        if (!res || !res.url) { say(res && res.message ? res.message : 'Nothing to print.', 'err'); return; }
        var el = document.getElementById('status');
        el.className = 'ok';
        el.innerHTML = res.message + '<br><a href="' + res.url + '" target="_blank">Open the PDF</a>';
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .createSignInSheetPdf(session, include);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }

  fillDates();
</script>`;
}

/** Minimal escaping for values interpolated into the dialog's markup. */
function escapeHtmlForDialog(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Called from the dialog. Builds the PDF and returns { url, message }.
 *
 * `sessionValue` is "yyyy-MM-dd|Location"; `include` is 'active' or 'all'.
 */
function createSignInSheetPdf(sessionValue, include) {
  const parts = String(sessionValue || '').split('|');
  const dateKey = String(parts[0] || '').trim();
  const location = String(parts[1] || '').trim();
  if (!dateKey || !location) return { url: '', message: '⚠️ Pick a date and location first.' };

  const data = collectSignInSheetData(dateKey, location, include === 'all');
  if (data.rows.length === 0 && !data.meal) {
    return { url: '', message: `⚠️ Nothing registered for ${formatDateLabel(parseDateKey(dateKey))} at ${location}, ` +
      `and no lunch on the menu — there is nothing to put on a sheet.` };
  }

  const file = renderSignInSheetPdf(data);
  const message = `✅ ${data.rows.length} name(s) on the sheet ` +
    `(${data.lunchCount} with lunch, ${data.noLunchCount} without)` +
    (data.meal ? `, lunch: ${data.meal.shorthand || data.meal.description || data.meal.type}` : '') + '.';
  log(`createSignInSheetPdf: built "${file.getName()}" with ${data.rows.length} row(s) — ` +
    `${data.lunchCount} with lunch, ${data.noLunchCount} without.`);
  return { url: file.getUrl(), message };
}

/**
 * Gathers everything one printed sheet needs: the day's meal, the people, and
 * the counts the kitchen is working to.
 *
 * EVERY program at this location on this date, in one roster — see the section
 * note. Which program each person came for is kept per row and printed in its
 * own column, so a mixed sheet is still readable at the desk.
 *
 * Sorted by LAST NAME, because that is how a person hunts for their own name
 * on a paper list at a desk — not by registration order, which is meaningless
 * to them, and not by first name, which is what the workbook happens to store.
 *
 * NOT sorted lunch-first, which is the obvious alternative and the wrong one.
 * Grouping the eaters together would suit the kitchen, but the person holding
 * this sheet is looking up arrivals by name, one at a time, all morning; a
 * roster split into two alphabetical halves means every lookup is two lookups.
 * The meal columns carry the lunch/no-lunch distinction instead, which is
 * where somebody counting meals is looking anyway.
 */
function collectSignInSheetData(dateKey, location, includeEveryone) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const date = parseDateKey(dateKey);
  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  const registrantRows = sheet ? readAllSectionedRows(sheet, headers, 'Event_ID') : [];

  const programs = [];
  const rows = [];
  registrantRows.forEach(row => {
    const d = coerceDate(row[map['Event_Date']]);
    if (!d || formatDateKey(d) !== dateKey) return;
    if (String(row[map['Location']] || '').trim() !== location) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (!includeEveryone && status !== 'Active') return;

    const program = String(row[map['Event']] || '').trim();
    if (program && programs.indexOf(program) === -1) programs.push(program);

    const name = String(row[map['Name']] || '').trim();
    const split = splitNameForPrinting(name);
    rows.push({
      last: split.last,
      first: split.first,
      phone: String(row[map['Phone']] || '').trim(),
      program: truncateForPrinting(program, SIGN_IN_SHEET_MAX_PROGRAM_CHARS),
      // "Family / Alt Name" is the desk's column for who this person is WITH.
      // A guest is named against whoever brought them; a registrant who
      // brought people carries the size of their party. Either way the person
      // holding the pen can see that two rows belong together.
      family: describePartyForPrinting(row, map),
      notes: buildSignInNotes(row, map, status),
      lunch: String(row[map['Lunch_Status']] || '').trim() === 'Needed'
    });
  });

  rows.sort((a, b) =>
    a.last.localeCompare(b.last) || a.first.localeCompare(b.first));

  const meal = getMealInfoForDate(date, location);
  const lunchCount = rows.filter(r => r.lunch).length;
  return {
    date,
    dateKey,
    location,
    programs,
    rows,
    meal: meal && CATERED_LUNCH_TYPES.indexOf(meal.type) !== -1 ? meal : null,
    lunchCount,
    noLunchCount: rows.length - lunchCount,
    ordering: lookupOrderingNumbersForPrinting(dateKey, location)
  };
}

/** Clips a value to fit its printed column, with an ellipsis so the clipping is visible. */
function truncateForPrinting(value, maxChars) {
  const text = String(value || '').trim();
  return text.length > maxChars ? `${text.substring(0, maxChars - 1)}…` : text;
}

/**
 * "Smith, Jane" from whatever the form was given. Splits on the LAST space, so
 * "Mary Anne Delacroix" prints as Delacroix / Mary Anne rather than losing the
 * middle of somebody's name; a single word goes in Last, since a one-word
 * entry on a sign-in list is a surname far more often than not.
 */
function splitNameForPrinting(name) {
  const raw = String(name || '').trim().replace(/\s+/g, ' ');
  if (!raw) return { first: '', last: '' };
  if (raw.indexOf(',') !== -1) {
    // Already "Last, First" — respect what was typed.
    const [last, ...rest] = raw.split(',');
    return { last: last.trim(), first: rest.join(',').trim() };
  }
  const idx = raw.lastIndexOf(' ');
  if (idx === -1) return { first: '', last: raw };
  return { first: raw.substring(0, idx).trim(), last: raw.substring(idx + 1).trim() };
}

/** Who this row is with: the person who brought them, or the size of the party they brought. */
function describePartyForPrinting(row, map) {
  const personType = String(row[map['Person_Type']] || '').trim();
  const primary = String(row[map['Primary_Registrant']] || '').trim();
  if (personType === 'Guest' && primary && primary !== 'Self') return `guest of ${primary}`;
  const partySize = Number(row[map['Party_Size']]) || 0;
  if (partySize > 1) return `+${partySize - 1} guest(s)`;
  return '';
}

/** The Extra Notes cell: dietary needs and anything not-normal about the registration. */
function buildSignInNotes(row, map, status) {
  const parts = [];
  if (status && status !== 'Active') parts.push(status.toUpperCase());
  const lunchStatus = String(row[map['Lunch_Status']] || '').trim();
  if (lunchStatus === 'Needed') {
    const type = String(row[map['Lunch_Type']] || '').trim();
    parts.push(type ? `lunch (${type})` : 'lunch');
  }
  const notes = String(row[map['Admin_Notes']] || '').trim();
  if (notes) parts.push(notes);
  const joined = parts.join(' · ');
  // Paper has a width. A note longer than this is a note nobody reads at a
  // desk anyway, and the full text is a click away on the Registrants tab.
  // Shorter than it was, because the Program column now takes a slice of the
  // width this column used to have.
  return joined.length > 75 ? `${joined.substring(0, 72)}…` : joined;
}

/** The kitchen's own numbers for this day, read off the lunch dashboard if it has them. */
function lookupOrderingNumbersForPrinting(dateKey, location) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_DASHBOARD);
  if (!sheet) return null;
  try {
    const headers = HEADERS.Master_Lunch_Dashboard;
    const map = getIndexMap(headers);
    const match = readAllSectionedRows(sheet, headers, 'Standard_Buffer').filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) === dateKey && String(row[map['Location']] || '').trim() === location;
    })[0];
    if (!match) return null;
    const registered = Number(match[map['Registered_Count']]) || 0;
    const standard = Number(match[map['Standard_Buffer']]) || 0;
    const tester = Number(match[map['Tester_Buffer']]) || 0;
    // Total_to_Order is a live formula on the sheet, so it reads back as its
    // own text — recompute the same sum rather than printing "=E12+Q12+R12".
    return { registered, standard, tester, total: registered + standard + tester };
  } catch (err) {
    log(`ℹ️ Sign-in sheet: could not read the lunch dashboard for ordering numbers (${err}).`);
    return null;
  }
}

/**
 * Renders the sheet as a landscape PDF and returns the Drive file.
 *
 * Built as a Google Doc and then exported, rather than assembled as HTML: a
 * Doc paginates by itself, repeats nothing it shouldn't, and gives a table
 * that prints with real gridlines at a predictable size. The temporary Doc is
 * removed once the PDF exists — only the PDF is worth keeping.
 */
function renderSignInSheetPdf(data) {
  const title = buildSignInSheetTitle(data);
  const doc = DocumentApp.create(title);
  try {
    const body = doc.getBody();
    body.setPageWidth(SIGN_IN_PAGE.width);
    body.setPageHeight(SIGN_IN_PAGE.height);
    body.setMarginTop(SIGN_IN_PAGE.margin);
    body.setMarginBottom(SIGN_IN_PAGE.margin);
    body.setMarginLeft(SIGN_IN_PAGE.margin);
    body.setMarginRight(SIGN_IN_PAGE.margin);

    writeSignInSheetHeading(body, data);
    writeSignInSheetTable(body, data);

    // DocumentApp gives every new document one empty paragraph at the top; it
    // costs a line of a page that is meant to hold as many rows as possible.
    const first = body.getChild(0);
    if (body.getNumChildren() > 1 && first.getType() === DocumentApp.ElementType.PARAGRAPH &&
      first.asParagraph().getText() === '') {
      first.removeFromParent();
    }

    doc.saveAndClose();

    const folder = getOrCreateSignInSheetFolder();
    const pdf = folder.createFile(DriveApp.getFileById(doc.getId()).getAs('application/pdf')).setName(`${title}.pdf`);
    return pdf;
  } finally {
    // The Doc was only ever scaffolding for the PDF. Trashed rather than
    // deleted outright, so a failed export is still recoverable by hand.
    try {
      DriveApp.getFileById(doc.getId()).setTrashed(true);
    } catch (err) {
      log(`ℹ️ Could not tidy up the temporary sign-in document (${err}) — it is in your Drive root.`);
    }
  }
}

function buildSignInSheetTitle(data) {
  const stamp = Utilities.formatDate(data.date, TIMEZONE, 'yyyy-MM-dd');
  return `Sign-In ${stamp} ${data.location}`;
}

/** The block above the table: who, where, what is being served, and what was ordered. */
function writeSignInSheetHeading(body, data) {
  const heading = body.appendParagraph(
    `${data.location} — ${Utilities.formatDate(data.date, TIMEZONE, 'EEEE, MMMM d, yyyy')}`);
  heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  heading.editAsText().setFontSize(16).setBold(true);

  const bits = [];
  if (data.programs.length > 0) bits.push(data.programs.join(' · '));
  if (data.meal) {
    const dish = data.meal.shorthand || data.meal.description || '';
    bits.push(`Lunch: ${data.meal.type}${dish ? ` — ${dish}` : ''}`);
  } else {
    bits.push('Lunch: none scheduled');
  }
  bits.push(`${data.lunchCount} meal(s) requested`);
  if (data.noLunchCount > 0) bits.push(`${data.noLunchCount} here without lunch`);
  if (data.ordering) {
    bits.push(`ordered ${data.ordering.total} (${data.ordering.registered} registered ` +
      `+ ${data.ordering.standard} standard + ${data.ordering.tester} tester)`);
  }

  const sub = body.appendParagraph(bits.join('   |   '));
  sub.editAsText().setFontSize(10).setBold(false).setForegroundColor('#444444');

  // Says what the 0s mean. Without this the printed zeros look like a count
  // somebody already took, which is the one reading that would make the sheet
  // worse than blank columns.
  if (data.noLunchCount > 0) {
    const key = body.appendParagraph(
      'Rows pre-filled with 0 ordered no lunch — nothing to serve them, nothing to write in those boxes.');
    key.editAsText().setFontSize(9).setBold(false).setForegroundColor('#444444');
  }

  const help = body.appendParagraph(`Questions at the desk: ${CENTER_PHONE}`);
  help.editAsText().setFontSize(9).setForegroundColor('#777777');
}

/** The table itself: header row, one row per person, then blank rows for walk-ins. */
function writeSignInSheetTable(body, data) {
  const cells = [SIGN_IN_SHEET_COLUMNS.slice()];
  data.rows.forEach(row => {
    // A registrant with no lunch gets a printed 0 in all four meal columns
    // rather than four blanks — see the section note. Somebody WITH lunch gets
    // the ordered count and three empty boxes, because what they actually ate
    // is the thing the desk is there to record.
    const zero = row.lunch ? '' : '0';
    cells.push([
      '', '', row.last, row.first, row.phone, row.program, row.family, row.notes,
      row.lunch ? '1' : '0', zero, zero, zero
    ]);
  });
  for (let i = 0; i < SIGN_IN_SHEET_BLANK_ROWS; i++) {
    cells.push(SIGN_IN_SHEET_COLUMNS.map(() => ''));
  }

  const table = body.appendTable(cells);
  table.setBorderWidth(1);

  // Column widths, scaled to the printable width of the page. The LAST column
  // takes whatever is left rather than its own rounded share: twelve
  // independently-rounded widths can add up to a point or two more than the
  // page actually has, and a table half a rounding error wider than its
  // margins is a table Docs pushes off the edge of the paper.
  const usable = SIGN_IN_PAGE.width - (SIGN_IN_PAGE.margin * 2);
  const totalWeight = SIGN_IN_SHEET_COLUMN_WEIGHTS.reduce((a, b) => a + b, 0);
  let allocated = 0;
  SIGN_IN_SHEET_COLUMN_WEIGHTS.forEach((weight, i) => {
    const last = i === SIGN_IN_SHEET_COLUMN_WEIGHTS.length - 1;
    const width = last ? usable - allocated : Math.round(usable * (weight / totalWeight));
    allocated += width;
    try {
      table.setColumnWidth(i, width);
    } catch (err) { /* a column beyond the table — nothing to size */ }
  });

  const headerRow = table.getRow(0);
  for (let c = 0; c < SIGN_IN_SHEET_COLUMNS.length; c++) {
    const cell = headerRow.getCell(c);
    cell.setBackgroundColor('#D9D9D9');
    cell.editAsText().setBold(true).setFontSize(8);
  }

  // Body rows: small enough to fit eleven columns across, tall enough to write
  // a tick or a digit into by hand.
  for (let r = 1; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    row.setMinimumHeight(22);
    for (let c = 0; c < SIGN_IN_SHEET_COLUMNS.length; c++) {
      row.getCell(c).editAsText().setFontSize(9).setBold(false);
    }
  }
}

/** Find-or-create the Drive folder finished sign-in sheets are filed in. */
function getOrCreateSignInSheetFolder() {
  const folders = DriveApp.getFoldersByName(SIGN_IN_SHEET_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  const folder = DriveApp.createFolder(SIGN_IN_SHEET_FOLDER_NAME);
  log(`Created Drive folder "${SIGN_IN_SHEET_FOLDER_NAME}" for printed sign-in sheets.`);
  return folder;
}


// ============================================================================
// 10. MOVING SESSIONS BETWEEN FORMS  (combine, or just repoint a link)
// ============================================================================
//
// Which form a session belongs to is decided by grouping rules — [Grouped] vs
// [Monthly], [All Locations] — and those rules cover the shapes a program
// USUALLY takes. They cannot express the one-off:
//
//   "These four different programs are one Tuesday afternoon event this month;
//    put them on a single form so people sign up once."
//   "This session's form link is wrong / points at a form we retired. Move it
//    to that one."
//
// Both are the same operation underneath — take some sessions, point them at a
// different form, make everything that references the old one agree — so both
// live behind one menu item. Pick the sessions, then either let it build a new
// COMBINED form covering exactly them, or name an existing form to move them
// onto.
//
// WHAT MAKES A COMBINED FORM WORK AT ALL is that its date labels name their
// program (formatSessionLabel()'s showTitle, which turns itself on as soon as
// a form's sessions carry more than one Clean_Title). Without that, a form
// covering Chair Yoga and Bingo on the same afternoon would offer two
// identical date rows — which Google Forms rejects outright, and which no
// response could be resolved back to a session anyway.
//
// WHAT THIS DOES NOT DO: move registrations. Rows already imported keep
// pointing at the session they were made for, which is correct — the session
// did not change, only the form people reach it through. Anyone who registers
// after the move arrives through the new form.
// ============================================================================

/** MENU ENTRY: pick sessions, pick a destination form. */
function showRepointSessionsDialog() {
  if (!requireAuthorizedAdmin('Move Sessions to Another Form')) return;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const sessions = listRepointableSessions();
  if (sessions.length === 0) {
    toastIfPossible('No upcoming sessions to move — run Sync Cal first.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildRepointSessionsHtml(sessions, listExistingForms()))
    .setWidth(620)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, 'Move Sessions to Another Form');
}

/** How far ahead the picker looks. Past sessions are deliberately not offered — their forms are closed business. */
const REPOINT_WINDOW_FORWARD_DAYS = 120;

/** Every UPCOMING session, newest form link and all, as { value: Event_ID, label }. */
function listRepointableSessions() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const limitKey = formatDateKey(new Date(Date.now() + REPOINT_WINDOW_FORWARD_DAYS * 86400000));

  return readAllSectionedRows(sheet, headers, 'Event_ID')
    .map(row => {
      const date = coerceDate(row[map['Event_Date']]);
      const eventId = String(row[map['Event_ID']] || '').trim();
      if (!date || !eventId) return null;
      const dateKey = formatDateKey(date);
      if (dateKey < todayKey || dateKey > limitKey) return null;
      return {
        value: eventId,
        dateKey,
        label: `${formatDateLabel(date)} — ${String(row[map['Clean_Title']] || '').trim()} ` +
          `(${String(row[map['Location']] || '').trim()})`,
        formId: String(row[map['Form_ID']] || '').trim()
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : a.label.localeCompare(b.label))));
}

/** The forms this workbook already knows about, for the "move onto an existing form" list. */
function listExistingForms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!sheet) return [];

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const byForm = {};

  readAllSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!formId || !date) return;
    const title = String(row[map['Clean_Title']] || '').trim();
    if (!byForm[formId]) byForm[formId] = { formId, titles: [], latest: date, upcoming: 0 };
    if (title && byForm[formId].titles.indexOf(title) === -1) byForm[formId].titles.push(title);
    if (date > byForm[formId].latest) byForm[formId].latest = date;
    if (formatDateKey(date) >= todayKey) byForm[formId].upcoming++;
  });

  return Object.keys(byForm)
    .map(k => byForm[k])
    .filter(f => f.upcoming > 0) // a form with nothing upcoming is not somewhere to send people
    .sort((a, b) => b.latest - a.latest)
    .slice(0, 100)
    .map(f => ({
      value: f.formId,
      label: `${f.titles.slice(0, 3).join(', ')}${f.titles.length > 3 ? '…' : ''} — ` +
        `${f.upcoming} upcoming date(s), through ${formatDateLabel(f.latest)}`
    }));
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildRepointSessionsHtml(sessions, forms) {
  const sessionTags = sessions.map(s =>
    `<label class="row"><input type="checkbox" name="session" value="${escapeHtmlForDialog(s.value)}"> ` +
    `${escapeHtmlForDialog(s.label)}</label>`).join('\n');
  const formTags = forms.map(f =>
    `<option value="${escapeHtmlForDialog(f.value)}">${escapeHtmlForDialog(f.label)}</option>`).join('\n');
  const noForms = forms.length === 0 ? '<option value="">(no other forms yet)</option>' : '';

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  #sessions { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 200px; overflow-y: auto; }
  label.row { display: block; padding: 2px 0; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin: 12px 0 0 0; padding: 8px 10px; }
  legend { font-weight: bold; padding: 0 4px; }
  input[type=text], select { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; margin-top: 4px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Move sessions onto one form</h3>
<p class="hint">
  Tick the sessions, then choose where they should go. Their "View Live Form" links and the
  registration link in their calendar events are both updated. Registrations already collected are
  not moved or changed.
</p>
<div id="sessions">${sessionTags}</div>

<fieldset>
  <legend><label><input type="radio" name="mode" value="new" checked> Build a new combined form</label></legend>
  <input type="text" id="newTitle" placeholder="Form name (optional) — e.g. Tuesday Afternoon Programs">
</fieldset>

<fieldset>
  <legend><label><input type="radio" name="mode" value="existing"> Move onto an existing form</label></legend>
  <select id="existingForm">${noForms}${formTags}</select>
  <input type="text" id="formRef" placeholder="…or paste a form URL or ID to use instead">
</fieldset>

<button id="go" onclick="submit()">Move sessions</button>
<div id="status"></div>
<script>
  function submit() {
    var picked = [].slice.call(document.querySelectorAll('input[name=session]:checked')).map(function (el) { return el.value; });
    if (picked.length === 0) { say('Tick at least one session first.', 'err'); return; }
    var mode = document.querySelector('input[name=mode]:checked').value;
    var payload = {
      mode: mode,
      title: document.getElementById('newTitle').value,
      formRef: document.getElementById('formRef').value || document.getElementById('existingForm').value
    };
    if (mode === 'existing' && !payload.formRef) { say('Pick an existing form, or paste its URL.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… this can take a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .repointSessionsToForm(picked, payload);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Points every session in `eventIds` at one form —
 * newly built, or an existing one named in `target` — and brings everything
 * that references a form into line: the two link columns, the destination
 * form's own date list, and the registration link in the calendar events.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function repointSessionsToForm(eventIds, target) {
  if (!requireAuthorizedAdmin('Move Sessions to Another Form')) return '⚠️ Not permitted.';
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ No sessions were selected.';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) return '⚠️ No program dashboard yet — run Sync Cal first.';

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const allRows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
  const chosenRows = allRows.filter(row => wanted.has(String(row[map['Event_ID']] || '').trim()));
  if (chosenRows.length === 0) return '⚠️ Those sessions are no longer on the dashboard — try Sync Cal and reopen this.';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) return '⚠️ A sync is already running — try again in a moment.';
  try {
    const mode = String((target && target.mode) || 'new');
    let formId;
    let formCreated = false;

    if (mode === 'existing') {
      formId = extractFormId(target.formRef);
      if (!formId) return '⚠️ That does not look like a form URL or ID.';
      try {
        FormApp.openById(formId);
      } catch (err) {
        return `⚠️ Could not open form ${formId} (${err}). Check the ID, and that this account can edit it.`;
      }
    } else {
      const created = createCombinedRegistrationForm(chosenRows, map, target && target.title);
      if (!created) return '⚠️ Could not build the combined form — see the execution log for why.';
      formId = created.formId;
      formCreated = true;
    }

    const moved = writeFormIdOntoSessions(registrySheet, wanted, formId);
    if (moved === 0) return '⚠️ Nothing was moved — those sessions already point at that form.';
    SpreadsheetApp.flush(); // the refresh below re-reads these rows

    // The destination form now covers a different set of dates than it did a
    // moment ago; its grid rows have to say so, or a respondent cannot pick
    // the sessions that were just moved onto it.
    const refreshedRows = readAllSectionedRows(registrySheet, headers, 'Event_ID');
    refreshOneFormDateLabels(formId, refreshedRows, map, 'sessions moved onto this form');
    reapplySignUpOptionsForForm(formId, refreshedRows, map);
    flushPersistentRegistries();

    // Every event that used to link to another form is still saying so.
    rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
    flushAdminDigest('Move sessions to another form');

    const summary = `✅ ${moved} session(s) moved onto ${formCreated ? 'a new combined form' : 'that form'}. ` +
      `Their dashboard links and calendar descriptions now point at it.` +
      (formCreated ? ' Each date on the form is labelled with its own program name.' : '');
    log(`repointSessionsToForm: ${summary} (form ${formId})`);
    toastIfPossible(summary);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Pulls a Form ID out of whatever somebody pasted: a bare ID, an edit URL, a
 * published /viewform URL, or a shortened /d/e/... published link.
 *
 * The /d/e/ form is worth being explicit about — it is the link people copy
 * out of the address bar most often, and the long string in it is a PUBLISHED
 * id, not the form's own ID, so FormApp.openById() will reject it. Better to
 * say that than to hand back "could not open".
 */
function extractFormId(reference) {
  const raw = String(reference || '').trim();
  if (!raw) return '';
  if (raw.indexOf('/d/e/') !== -1) {
    log('ℹ️ That is a published form link (/d/e/…), which does not contain the form ID. ' +
      'Open the form for editing and copy the /d/<id>/edit URL instead.');
    return '';
  }
  const match = /\/d\/([a-zA-Z0-9-_]{20,})/.exec(raw);
  if (match) return match[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(raw) ? raw : '';
}

/**
 * Writes `formId` and its two link columns onto every session row whose
 * Event_ID is in `wanted`. Returns how many rows actually changed.
 *
 * Reads and writes the link columns as formula-or-value, so rows that are NOT
 * moving are written back byte-identical — the same care updateRegistryFormLinks()
 * takes, and the reason a repoint never quietly flattens a neighbouring row's
 * HYPERLINK() into its display text.
 */
function writeFormIdOntoSessions(registrySheet, wanted, formId) {
  let links;
  try {
    const form = FormApp.openById(formId);
    links = {
      view: makeHyperlinkFormula(buildRegistrationUrl(form), 'View Live Form'),
      edit: makeHyperlinkFormula(form.getEditUrl(), 'Edit Form Settings')
    };
  } catch (err) {
    log(`⚠️ writeFormIdOntoSessions: could not open form ${formId} (${err}).`);
    return 0;
  }

  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  let moved = 0;

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const eventIds = registrySheet.getRange(zone.start, sheetMap['Event_ID'], zone.count, 1).getValues();
    const idRange = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1);
    const viewRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const editRange = registrySheet.getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1);

    const ids = idRange.getValues();
    const viewValues = viewRange.getValues();
    const editValues = editRange.getValues();
    const views = viewRange.getFormulas().map((f, r) => [f[0] || viewValues[r][0]]);
    const edits = editRange.getFormulas().map((f, r) => [f[0] || editValues[r][0]]);

    let touched = false;
    eventIds.forEach((idRow, r) => {
      const eventId = String(idRow[0] || '').trim();
      if (!wanted.has(eventId)) return;
      if (String(ids[r][0] || '').trim() === formId) return; // already there
      ids[r] = [formId];
      views[r] = [links.view];
      edits[r] = [links.edit];
      touched = true;
      moved++;
    });

    if (touched) {
      idRange.setValues(ids);
      viewRange.setValues(views);
      editRange.setValues(edits);
    }
  });

  return moved;
}

/**
 * Builds a brand-new form covering exactly `sessionRows`.
 *
 * Treated as a GROUPED series regardless of what its member programs are
 * tagged: a combined form is one form for one fixed list of dates, which is
 * precisely what Grouped means, and it is what makes the "sign up for every
 * date on this form" wording truthful.
 */
function createCombinedRegistrationForm(sessionRows, map, requestedTitle) {
  const sessions = sessionRows
    .map(row => ({
      date: coerceDate(row[map['Event_Date']]),
      location: String(row[map['Location']] || '').trim(),
      title: String(row[map['Clean_Title']] || '').trim()
    }))
    .filter(s => s.date)
    .sort((a, b) => a.date - b.date);
  if (sessions.length === 0) return null;

  const locations = locationsOfSessions(sessions);
  const titles = distinctSessionTitles(sessions);
  const formTitle = String(requestedTitle || '').trim() ||
    `${titles.slice(0, 2).join(' + ')}${titles.length > 2 ? ' + more' : ''} — ` +
    `${formatDateLabel(sessions[0].date)} onward`;

  const created = createFormFromSpec({
    sessions,
    locations,
    showLocation: locations.length > 1,
    // showTitle: this form's whole point is that its dates belong to different
    // programs, so every row says which — see formatSessionLabel().
    showTitle: titles.length > 1,
    // A combined form is one form for one fixed list of dates, which is what
    // Grouped means — and what makes "sign up for every date on this form"
    // the truthful wording.
    isFixed: true,
    isClub: sessionRows.some(row => isClubColumnValue(row[map['Club']])),
    programTitle: titles.length === 1 ? titles[0] : ''
  }, formTitle, 'combined form');
  if (!created) return null;

  log(`Created combined registration form "${formTitle}" (${created.formId}) covering ${sessions.length} ` +
    `session(s) across ${titles.length} program(s).`);
  return created;
}

/**
 * Copies the template and dresses the copy up for one specific set of
 * sessions: title, description, sign-up options, lunch questions, date labels,
 * footer note, version stamp.
 *
 * `spec` is deliberately the same shape buildFormSessionContext() returns —
 * sessions, locations, showLocation, showTitle, isFixed, isClub, programTitle,
 * capacityHints — so a caller holding a live form's context can rebuild it
 * without translating anything, and a caller inventing a new grouping can hand
 * over a literal.
 *
 * Every "a brand-new form appears" path goes through here: the combined-form
 * builder above and the destroy-and-rebuild sweep in section 11. The
 * per-group createRegistrationForm() deliberately does NOT — it is on the sync
 * hot path and works from a calendar group rather than from sheet rows.
 *
 * Returns { formId, formTitle }, or null if the sessions are empty.
 */
function createFormFromSpec(spec, formTitle, context) {
  const sessions = (spec.sessions || []).filter(s => s.date);
  if (sessions.length === 0) return null;
  const locations = spec.locations || locationsOfSessions(sessions);

  const templateForm = getOrCreateTemplateForm();
  const copiedFile = DriveApp.getFileById(templateForm.getId()).makeCopy(formTitle, getOrCreateFormsFolder());
  const form = FormApp.openById(copiedFile.getId());
  form.setTitle(formTitle);

  try {
    form.setAcceptingResponses(true);
  } catch (err) {
    log(`⚠️ Could not confirm "accepting responses" on "${formTitle}" (${err}).`);
  }
  try {
    if (typeof form.setPublished === 'function') form.setPublished(true);
  } catch (err) {
    log(`⚠️ Could not explicitly publish "${formTitle}" (${err}).`);
  }

  const { allDateLabels, lunchDateLabels } = buildDateLabelSets(sessions, {
    showLocation: spec.showLocation,
    showTitle: spec.showTitle,
    capacityHints: spec.capacityHints
  });

  form.setDescription(buildFormDescription(locations, allDateLabels, spec.isFixed, lunchDateLabels.length > 0,
    { isClub: spec.isClub, programTitle: spec.programTitle }));
  applyAttendanceModeChoices(form,
    { isFixed: spec.isFixed, isClub: spec.isClub, programTitle: spec.programTitle });
  syncLunchQuestionsOnForm(form, locations, lunchDateLabels.length > 0);
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels,
    { form, force: true, context: context || 'new form' });
  applyFormFooterNote(form, buildFooterNoteForLocations(locations));
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);
  flushPersistentRegistries();

  return { formId: form.getId(), formTitle };
}

/**
 * Re-asserts one form's sign-up options after its session list has changed —
 * a form that has just gained a club's dates has to start offering the club
 * option, and one that has just lost them has to stop.
 */
function reapplySignUpOptionsForForm(formId, sessionRows, map) {
  const formRows = sessionRows.filter(row => String(row[map['Form_ID']] || '').trim() === formId);
  if (formRows.length === 0) return;
  const context = buildFormSessionContext(formId, formRows, map, getSharedFormIdSet());
  try {
    applyAttendanceModeChoices(FormApp.openById(formId), {
      isFixed: context.isFixed || context.showTitle, // a combined form is a fixed list of dates
      isClub: context.isClub,
      programTitle: context.programTitle
    });
  } catch (err) {
    log(`⚠️ Could not update the sign-up options on form ${formId} (${err}).`);
  }
}


// ============================================================================
// 10b. DELETING REGISTRATIONS  (showDeleteRegistrationsDialog)
// ============================================================================
//
// Everything else in this system CANCELS. A registrant who drops out is marked
// Cancelled and stays on the tab; a session whose calendar event disappears
// sends its people to Deleted_Event_Triage. That is deliberate and it is
// right: a registration is a record of something that happened, and the
// history of who signed up for what is worth more than a tidy sheet.
//
// This is the exception, for the cases where the rows are not history at all:
//
//   - a test run. Somebody submitted the form four times while checking that
//     it worked, and those four people do not exist.
//   - a duplicate import, or rows created against a session that was set up
//     wrong and rebuilt.
//   - a program that was cancelled outright before it ever ran, where nobody
//     wants a permanent list of people who were going to come.
//
// So it deletes, by session, and says so in the plainest words available. What
// keeps it safe is not a soft delete but three gates: an admin check, an
// explicit typed confirmation, and a summary of exactly how many rows on which
// sessions before anything is touched.
//
// WHAT IT ALSO OFFERS, and why: deleting the ROWS does not delete the form
// RESPONSES they came from. Left alone, those responses sit in the form
// forever and reappear on any full re-import — which is exactly what somebody
// clearing out a test run does not want. So "also delete the matching form
// responses" is offered as a separate tick, defaulting to OFF, because
// deleting a response is the one part of this that cannot be undone from
// inside this workbook.
//
// WHAT IT WILL NOT DO: stop a club from re-booking somebody. Membership lives
// on Club_Members and applyClubRosterCatchup() re-books active members into
// upcoming sessions on every sync, so deleting a club member's row for a
// FUTURE session removes it until the next sync puts it straight back. To
// actually take somebody out of a club, untick them on Club_Members — the
// dialog says so where a deletion is about to hit a club session.
// ============================================================================

/** The word that has to be typed before anything is deleted. */
const DELETE_REGISTRATIONS_CONFIRM_WORD = 'DELETE';

/** How far back the picker looks. Older sessions are archive; nobody clears a test run from last spring. */
const DELETE_REGISTRATIONS_WINDOW_BACK_DAYS = 120;
/** And how far forward. Wide enough to cover anything with a form open. */
const DELETE_REGISTRATIONS_WINDOW_FORWARD_DAYS = 180;

/** MENU ENTRY: pick the sessions whose registrations should be deleted. */
function showDeleteRegistrationsDialog() {
  if (!requireAuthorizedAdmin('Delete Registrations')) return;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const sessions = listSessionsWithRegistrations();
  if (sessions.length === 0) {
    toastIfPossible('No registrations to delete in the last few months.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildDeleteRegistrationsHtml(sessions))
    .setWidth(640)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Delete Registrations');
}

/**
 * Every session inside the window that actually HAS registrant rows, with the
 * count, whether it is upcoming, and whether it is a club session (which
 * changes what deleting means — see the section comment).
 */
function listSessionsWithRegistrations() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrantsSheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  if (!registrantsSheet) return [];

  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const backKey = formatDateKey(new Date(Date.now() - DELETE_REGISTRATIONS_WINDOW_BACK_DAYS * 86400000));
  const forwardKey = formatDateKey(new Date(Date.now() + DELETE_REGISTRATIONS_WINDOW_FORWARD_DAYS * 86400000));

  const clubEventIds = collectClubEventIds();
  const byEvent = {};
  readAllSectionedRows(registrantsSheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < backKey || dateKey > forwardKey) return;

    if (!byEvent[eventId]) {
      byEvent[eventId] = {
        value: eventId,
        dateKey,
        date,
        title: String(row[map['Event']] || '').trim(),
        location: String(row[map['Location']] || '').trim(),
        count: 0,
        upcoming: dateKey >= todayKey,
        isClub: clubEventIds.has(eventId)
      };
    }
    byEvent[eventId].count++;
  });

  return Object.keys(byEvent)
    .map(k => byEvent[k])
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : (a.dateKey > b.dateKey ? -1 : a.title.localeCompare(b.title))))
    .map(s => ({
      value: s.value,
      count: s.count,
      label: `${formatDateLabel(s.date)} — ${s.title || '(untitled)'} (${s.location}) — ` +
        `${s.count} registration(s)${s.upcoming ? ' · upcoming' : ''}${s.isClub ? ' · club' : ''}`,
      isClub: s.isClub && s.upcoming
    }));
}

/** Event_IDs on the session table whose program is a club — see the club note in the section comment. */
function collectClubEventIds() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const ids = new Set();
  if (!sheet) return ids;
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  readAllSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    if (map['Club'] === undefined || !isClubColumnValue(row[map['Club']])) return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (eventId) ids.add(eventId);
  });
  return ids;
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildDeleteRegistrationsHtml(sessions) {
  const sessionTags = sessions.map(s =>
    `<label class="row"><input type="checkbox" name="session" value="${escapeHtmlForDialog(s.value)}"> ` +
    `${escapeHtmlForDialog(s.label)}</label>`).join('\n');
  const anyClub = sessions.some(s => s.isClub);
  const clubNote = anyClub
    ? `<p class="warn">Sessions marked <b>club</b> are upcoming meetings of a club. Deleting those rows removes
       them until the next sync, which re-books every active member. To take somebody off a club for good,
       untick them on the <b>Club_Members</b> tab instead.</p>`
    : '';

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  p.warn { color: #B06000; background: #FFF8E1; border: 1px solid #FFE0A3; border-radius: 4px;
           padding: 6px 8px; margin: 0 0 10px 0; line-height: 1.4; }
  #sessions { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 220px; overflow-y: auto; }
  label.row { display: block; padding: 2px 0; }
  fieldset { border: 1px solid #ddd; border-radius: 4px; margin: 12px 0 0 0; padding: 8px 10px; }
  legend { font-weight: bold; padding: 0 4px; }
  input[type=text] { width: 100%; padding: 6px; font-size: 13px; box-sizing: border-box; margin-top: 4px; }
  button { background: #C5221F; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Delete registrations</h3>
<p class="hint">
  Tick the sessions whose registrations should be <b>permanently deleted</b> from
  Lunch_and_Event_Registrants. This is for test runs and duplicates — to record that somebody is no
  longer coming, set their Program_Status to <b>Cancelled</b> instead, which keeps the row and the
  history. The catering numbers are recalculated afterwards.
</p>
${clubNote}
<div id="sessions">${sessionTags}</div>

<fieldset>
  <legend>Also delete the form responses</legend>
  <label class="row">
    <input type="checkbox" id="alsoResponses">
    Delete the matching responses from the Google Form as well (cannot be undone)
  </label>
</fieldset>

<fieldset>
  <legend>Confirm</legend>
  <input type="text" id="confirmWord" placeholder="Type ${DELETE_REGISTRATIONS_CONFIRM_WORD} to enable the button"
         oninput="toggle()" autocomplete="off">
</fieldset>

<button id="go" onclick="submit()" disabled>Delete registrations</button>
<div id="status"></div>
<script>
  function toggle() {
    var typed = document.getElementById('confirmWord').value.trim().toUpperCase();
    document.getElementById('go').disabled = typed !== '${DELETE_REGISTRATIONS_CONFIRM_WORD}';
  }
  function submit() {
    var picked = [].slice.call(document.querySelectorAll('input[name=session]:checked')).map(function (el) { return el.value; });
    if (picked.length === 0) { say('Tick at least one session first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… this can take a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        toggle();
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        toggle();
        say('Failed: ' + err.message, 'err');
      })
      .deleteRegistrationsForSessions(picked, {
        confirm: document.getElementById('confirmWord').value,
        alsoDeleteResponses: document.getElementById('alsoResponses').checked
      });
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}

/**
 * Called from the dialog. Deletes every registrant row belonging to the given
 * sessions, optionally deletes the form responses behind them, and puts the
 * counts that those rows were feeding back in line.
 *
 * Takes the same script lock syncRegistrations() does. Without it, a sync
 * running in parallel would read the tab before the deletion and write its own
 * copy back afterwards, restoring every row this just removed — the same
 * lost-update race that lock was introduced for, in the other direction.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function deleteRegistrationsForSessions(eventIds, options) {
  if (!requireAuthorizedAdmin('Delete Registrations')) return '⚠️ Not permitted.';
  options = options || {};
  if (String(options.confirm || '').trim().toUpperCase() !== DELETE_REGISTRATIONS_CONFIRM_WORD) {
    return `⚠️ Type ${DELETE_REGISTRATIONS_CONFIRM_WORD} to confirm.`;
  }
  const wanted = new Set((eventIds || []).map(id => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ No sessions were selected.';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    return '⚠️ A sync is running right now — try again in a moment.';
  }
  try {
    return deleteRegistrationsForSessionsInternal(wanted, !!options.alsoDeleteResponses);
  } finally {
    lock.releaseLock();
  }
}

function deleteRegistrationsForSessionsInternal(wanted, alsoDeleteResponses) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.LUNCH_EVENT_REGISTRANTS);
  if (!sheet) return '⚠️ There is no registrants tab yet.';

  const headers = HEADERS.Lunch_and_Event_Registrants;
  const map = getIndexMap(headers);
  const allRows = readAllSectionedRows(sheet, headers, 'Event_ID');

  const keepRows = [];
  const doomedRows = [];
  allRows.forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    (wanted.has(eventId) ? doomedRows : keepRows).push(row);
  });
  if (doomedRows.length === 0) return '⚠️ Those sessions have no registrations to delete.';

  // The responses go FIRST, while the rows that name them are still readable.
  // A failure here must not cost the deletion — it is reported and the rows go
  // anyway, since "the rows are gone but two responses survived in the form"
  // is recoverable and "half the rows are gone" is not.
  let responsesDeleted = 0;
  let responseFailures = 0;
  if (alsoDeleteResponses) {
    const result = deleteFormResponsesForRows(doomedRows, map, wanted);
    responsesDeleted = result.deleted;
    responseFailures = result.failed;
  }

  renderRegistrantsSheet(false, keepRows);
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, keepRows);
    updateMasterLunchDashboard(keepRows);
  } catch (err) {
    log(`⚠️ Deleted ${doomedRows.length} registration(s), but could not recalculate the counts (${err}).`);
    return `Deleted ${doomedRows.length} registration(s) — but the counts could not be recalculated (${err}). ` +
      `Run Sync Registrations to bring them back in line.`;
  }

  const message = `Deleted ${doomedRows.length} registration(s) across ${wanted.size} session(s).` +
    (alsoDeleteResponses
      ? ` ${responsesDeleted} form response(s) deleted${responseFailures > 0 ? `, ${responseFailures} could not be` : ''}.`
      : ' The form responses behind them were left in place.');
  log(`deleteRegistrationsForSessions: ${message}`);
  return message;
}

/**
 * Deletes the Google Form responses that produced `rows`.
 *
 * A row names its response in Party_ID (the response ID — see
 * buildRegistrantRow()) and its session in Event_ID; the session table maps
 * that Event_ID to the form the response lives in. Rows with no Party_ID —
 * walk-ins, club bookings, anything typed straight onto the tab — never had a
 * response and are simply skipped.
 *
 * ONE RESPONSE CAN COVER SEVERAL ROWS (a party of four, or one person on six
 * dates of a grouped form), so response IDs are deduplicated. That also means
 * deleting a response can reach further than the sessions picked: a response
 * covering six dates is one object, and there is no way to remove three dates
 * from it. The rows for the other dates are left exactly where they are — they
 * are the record — but the response behind them is gone, which is stated in
 * the dialog's warning that this cannot be undone.
 */
function deleteFormResponsesForRows(rows, map, wanted) {
  const formIdByEventId = buildFormIdByEventId();
  const byForm = {};
  rows.forEach(row => {
    const partyId = String(row[map['Party_ID']] || '').trim();
    if (!partyId) return;
    const formId = formIdByEventId[String(row[map['Event_ID']] || '').trim()] || '';
    if (!formId) return;
    if (!byForm[formId]) byForm[formId] = new Set();
    byForm[formId].add(partyId);
  });

  let deleted = 0;
  let failed = 0;
  Object.keys(byForm).forEach(formId => {
    let form;
    try {
      form = FormApp.openById(formId);
    } catch (err) {
      failed += byForm[formId].size;
      log(`⚠️ Could not open form ${formId} to delete responses (${err}).`);
      return;
    }
    byForm[formId].forEach(responseId => {
      try {
        form.deleteResponse(responseId);
        deleted++;
      } catch (err) {
        failed++;
        log(`⚠️ Could not delete response ${responseId} from form ${formId} (${err}).`);
      }
    });
  });

  if (deleted > 0 || failed > 0) {
    log(`deleteFormResponsesForRows: deleted ${deleted} response(s), ${failed} failed (${wanted.size} session(s) selected).`);
  }
  return { deleted, failed };
}

/** { Event_ID: Form_ID } from the session table. */
function buildFormIdByEventId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const out = {};
  if (!sheet) return out;
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  readAllSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const formId = String(row[map['Form_ID']] || '').trim();
    if (eventId && formId) out[eventId] = formId;
  });
  return out;
}


// ============================================================================
// 11. DESTROY AND REBUILD FORMS  (the last resort, on the Admin menu)
// ============================================================================
//
// THREE WAYS TO FIX A FORM, and it is worth knowing which one you want,
// because they differ by exactly how much they throw away:
//
//   1. The hourly sync's own migration (migrateFormsToCurrentTemplate()) —
//      rewrites a form's questions IN PLACE, keeping its ID. Automatic,
//      invisible, and the right answer almost always.
//   2. recheckAllRegistrationForms() — the same thing, on demand, for every
//      form at once. Run it from the Apps Script editor when you don't want to
//      wait an hour.
//   3. THIS. Throws each form away and builds a brand-new one in its place.
//
// (3) exists for the cases (1) and (2) cannot reach: a form somebody has
// hand-edited into a state the parser no longer recognizes, one whose
// questions were deleted, one whose responses are corrupt, one that Google
// itself will no longer open. In every one of those the form's ID is not an
// asset worth keeping — it is the thing tying you to the broken object.
//
// WHAT IT COSTS, stated plainly because the menu item has to say it out loud:
// every registration link already handed out STOPS WORKING. Old links point at
// the old form, and the old form is in the Drive trash. Calendar descriptions
// and dashboard links are rewritten here, so anything anyone reaches through
// this system is fine — but a link in an email somebody sent last week, or on
// a printed flyer, is not.
//
// WHAT IT DOES NOT COST: registrations. Responses already imported are rows on
// Lunch_and_Event_Registrants and are untouched. Responses NOT yet imported
// would be destroyed with the form, so this imports them first and refuses to
// go on if that import fails — losing a registration to a maintenance action
// is the one outcome that would make this tool not worth having.
//
// Past-only forms are left alone: their sessions have happened, their links
// are nobody's route to anything, and replacing them would break the archive
// for no gain.
// ============================================================================

/**
 * How many forms one SYNCHRONOUS run will replace. Building a form is a few
 * dozen Forms calls plus a Drive copy, and this runs from a menu click with a
 * six-minute ceiling. Whatever is left is reported and picked up by running
 * it again — the work is strictly decreasing, since a rebuilt form is
 * skipped next time.
 *
 * This only governs plans at or below FORM_REBUILD_SLICE_THRESHOLD. Bigger
 * plans skip it entirely and run as the self-continuing background sweep
 * defined below instead — see the block comment above
 * runFormRebuildSweepSlice() for why.
 */
const MAX_FORM_REPLACEMENTS_PER_RUN = 8;

/**
 * Above this many forms, one click starts a background sweep that keeps
 * itself going — the same slice/watchdog/hand-off-trigger technique
 * bootstrapCalendars() uses for a first-time import. Below it, the plain
 * single-run path above (reported leftovers, re-run by hand) is simple
 * enough not to need that machinery, and the "run it again" it occasionally
 * asks for tops out at a handful of clicks rather than dozens.
 */
const FORM_REBUILD_SLICE_THRESHOLD = 50;

/** What the confirmation prompt makes you type. Deliberately not "yes". */
const DESTROY_REBUILD_CONFIRM_WORD = 'REBUILD';

/**
 * ADMIN MENU ENTRY. Replaces every live registration form covering an upcoming
 * session with a brand-new one built from the current template.
 *
 * A plan of FORM_REBUILD_SLICE_THRESHOLD forms or fewer runs to completion (or
 * as far as MAX_FORM_REPLACEMENTS_PER_RUN allows) in this one execution. A
 * bigger plan hands off to startFormRebuildSweep() instead, which finishes the
 * whole job in the background across as many executions as it takes — the
 * person who clicked the menu does not click it again.
 */
function destroyAndRebuildAllForms() {
  if (!requireAuthorizedAdmin('Destroy and Rebuild Forms')) return null;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return null;
  }

  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const plan = planFormRebuilds(readAllSectionedRows(registrySheet, headers, 'Event_ID'), map);
  if (plan.length === 0) {
    toastIfPossible('Nothing to rebuild — no form on this workbook covers an upcoming session.');
    return null;
  }

  const sliced = plan.length > FORM_REBUILD_SLICE_THRESHOLD;
  const preview = plan.slice(0, 6)
    .map(p => `• ${p.describe} (${p.upcomingCount} upcoming date(s))`).join('\n');
  const more = plan.length > 6 ? `\n…and ${plan.length - 6} more` : '';
  const batched = sliced
    ? `\n\nThat is over ${FORM_REBUILD_SLICE_THRESHOLD}, so this runs as a BACKGROUND SWEEP: it rebuilds a ` +
      `few forms at a time and re-arms itself automatically until every one is done — you will NOT need to ` +
      `run this again. Calendar sync and registration sync pause for the duration and resume on their own ` +
      `when the sweep finishes.`
    : plan.length > MAX_FORM_REPLACEMENTS_PER_RUN
      ? `\n\nOnly the first ${MAX_FORM_REPLACEMENTS_PER_RUN} will be done this run — run it again for the rest.`
      : '';

  if (!confirmConsequentialAction('Destroy and rebuild every registration form?',
    `${plan.length} form(s) would be REPLACED with brand-new ones:\n${preview}${more}${batched}\n\n` +
    `⚠️ EVERY REGISTRATION LINK ALREADY HANDED OUT WILL STOP WORKING. The old forms go to the Drive ` +
    `trash (recoverable for 30 days); anything still pointing at them — a link in an email you sent, a ` +
    `printed flyer — leads to a dead form. Calendar event descriptions and the dashboard's links are ` +
    `rewritten here, so those stay right.\n\n` +
    `Registrations are NOT lost: outstanding responses are imported first, and rows already on ` +
    `${SHEET_NAMES.LUNCH_EVENT_REGISTRANTS} are untouched.\n\n` +
    `If a form is merely out of date, you do not want this — the hourly sync already rebuilds forms ` +
    `IN PLACE, keeping their links. This is for a form that is broken beyond that.`, false)) {
    return null;
  }

  // A second, deliberately awkward gate. The first dialog is a Yes/No, and a
  // Yes/No is one mis-aimed click; this one cannot be answered by accident.
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (err) {
    log('destroyAndRebuildAllForms: no UI available — this action has to be run from the menu, by a person.');
    return null;
  }
  const typed = ui.prompt('Confirm: rebuild from scratch',
    `Type ${DESTROY_REBUILD_CONFIRM_WORD} to replace ${plan.length} form(s). Anything else cancels.`,
    ui.ButtonSet.OK_CANCEL);
  if (typed.getSelectedButton() !== ui.Button.OK ||
    String(typed.getResponseText() || '').trim().toUpperCase() !== DESTROY_REBUILD_CONFIRM_WORD) {
    toastIfPossible('Cancelled — nothing was changed.');
    return null;
  }

  if (sliced) {
    return startFormRebuildSweep(plan);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    toastIfPossible('A sync is already running — try again in a moment.');
    return null;
  }
  try {
    return runFormRebuildSweep(registrySheet, plan);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Works out which forms are worth replacing, grouped exactly as they are TODAY
 * — one new form per old form.
 *
 * Grouping by current Form_ID rather than re-deriving groups from the calendar
 * is the whole point: it preserves whatever arrangement the workbook is
 * actually in, including cross-location forms and hand-built combined ones. A
 * rebuild should hand back what you had, not what a fresh import would have
 * built.
 *
 * A form with no upcoming sessions is skipped — see the section note.
 */
function planFormRebuilds(sessionRows, map) {
  const byForm = groupRegistryRowsByForm(sessionRows, map);
  const sharedFormIds = getSharedFormIdSet();
  const todayKey = formatDateKey(new Date());
  const plan = [];

  Object.keys(byForm).forEach(formId => {
    const rows = byForm[formId];
    const upcoming = rows.filter(row => {
      const d = coerceDate(row[map['Event_Date']]);
      return d && formatDateKey(d) >= todayKey;
    });
    if (upcoming.length === 0) return; // past business — leave its link alone

    // Built from the UPCOMING rows only. A rebuilt form should offer the dates
    // somebody can still sign up for, not re-list a term that has finished.
    const context = buildFormSessionContext(formId, upcoming, map, sharedFormIds);
    if (context.sessions.length === 0) return;

    plan.push({
      oldFormId: formId,
      context,
      upcomingCount: upcoming.length,
      eventIds: new Set(upcoming.map(row => String(row[map['Event_ID']] || '').trim()).filter(Boolean)),
      describe: `${context.titles.slice(0, 2).join(', ')}${context.titles.length > 2 ? '…' : ''} ` +
        `(${describeLocations(context.locations)})`
    });
  });

  return plan.sort((a, b) => a.describe.localeCompare(b.describe));
}

/**
 * Does the work: import first, then replace each form, then bring everything
 * that references a form back into agreement.
 */
function runFormRebuildSweep(registrySheet, plan) {
  const result = { replaced: 0, failed: 0, deferred: 0, importFailed: false };

  // IMPORT BEFORE DESTROYING. A response submitted since the last sync lives
  // only on the form, and trashing the form takes it with it. This is the one
  // step that makes the whole action safe, so a failure here aborts rather
  // than being logged and stepped over.
  toastIfPossible('Importing outstanding registrations before rebuilding…');
  try {
    syncRegistrationsInternal();
  } catch (err) {
    result.importFailed = true;
    const message = `⚠️ Nothing was rebuilt. The registrations on the current forms could not be imported ` +
      `first (${err}), and rebuilding would have destroyed any that had not come across yet. ` +
      `Fix the import, or run "Sync Registrations" by hand, then try again.`;
    log(`destroyAndRebuildAllForms: aborted — ${err}`);
    toastIfPossible(message);
    try { SpreadsheetApp.getUi().alert(message); } catch (uiErr) { /* no UI */ }
    return result;
  }

  // RE-READ THE PLAN. The import above re-renders the dashboard and can move
  // rows (its triage pass sends sessions whose calendar event has gone to
  // Triage), so the contexts gathered for the confirmation dialog a moment ago
  // may now describe dates that no longer exist. Rebuilding is restricted to
  // the forms the user actually agreed to, but the SESSIONS on each one are
  // taken fresh — otherwise a new form could be built listing a session that
  // was triaged away between the click and the work.
  const confirmed = new Set(plan.map(item => item.oldFormId));
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const currentPlan = planFormRebuilds(readAllSectionedRows(registrySheet, headers, 'Event_ID'), map)
    .filter(item => confirmed.has(item.oldFormId));

  for (const item of currentPlan) {
    if (result.replaced >= MAX_FORM_REPLACEMENTS_PER_RUN) {
      result.deferred++;
      continue;
    }
    try {
      if (replaceOneForm(registrySheet, item)) {
        result.replaced++;
        // See migrateFormsToCurrentTemplate() — same reason, same pause.
        if (result.replaced < MAX_FORM_REPLACEMENTS_PER_RUN) Utilities.sleep(1500);
      } else {
        result.failed++;
      }
    } catch (err) {
      result.failed++;
      log(`⚠️ Could not rebuild the form for ${item.describe} (${err}) — it was left exactly as it was.`);
      noteForAdmin('Forms that could not be rebuilt', `${item.describe} — ${err}`);
    }
  }

  if (result.replaced > 0) {
    SpreadsheetApp.flush();
    // Every event still carries a link to a form that is now in the trash.
    rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
    renderProgramDashboard(false, { skipTriage: true });
  }
  flushPersistentRegistries();
  flushAdminDigest('Destroy and rebuild forms');

  const summary = `Rebuilt ${result.replaced} form(s)` +
    (result.failed > 0 ? `, ${result.failed} failed` : '') +
    (result.deferred > 0 ? `, ${result.deferred} left — run it again to continue` : '') +
    '. Old forms are in the Drive trash.';
  log(`destroyAndRebuildAllForms: ${summary}`);
  toastIfPossible(`✅ ${summary}`);
  return result;
}

// ============================================================================
// DESTROY-AND-REBUILD: BACKGROUND SWEEP FOR LARGE PLANS
//
// Below FORM_REBUILD_SLICE_THRESHOLD forms, runFormRebuildSweep() above does
// the whole job (or as much of MAX_FORM_REPLACEMENTS_PER_RUN as fits) in the
// one execution the menu click gave it, and any leftover count just says "run
// it again". Fine for a handful of forms. It stops being fine once a plan
// runs past what one execution — or even a few manual re-clicks — can
// reasonably get through: nobody should have to sit at the sheet re-running a
// menu item a dozen-plus times to replace fifty or a hundred forms.
//
// So a plan over the threshold takes the same route bootstrapCalendars() uses
// for a first-time import (see the "BOOTSTRAP" block comment above
// runBootstrapSlice(), which this mirrors closely — same shape, different
// unit of work):
//   - Automation (syncCalendars/syncRegistrations/onCalendarChange) is paused
//     up front, via the same pauseAutomationForBootstrap() the import uses —
//     both are long, multi-execution jobs writing to the same dashboard and
//     session table, so both need the same quiet.
//   - Each slice imports outstanding registrations first, then replaces
//     forms until its time budget runs out, then hands off to the next slice
//     via a one-off trigger. Importing every slice (not just the first)
//     matters here: a response can land on a form that is not yet rebuilt in
//     the gap between slices, and that form is about to be trashed — see
//     runFormRebuildSweep()'s note on why the import has to happen before
//     anything is destroyed.
//   - Progress lives in the STATE (which old Form_IDs are done), not in
//     memory, so a slice never repeats work and a killed slice's watchdog
//     trigger picks up exactly where the state says to.
//   - The final slice restores every trigger and clears the state.
//
// isBootstrapActive() treats this sweep as equivalent to a bootstrap import
// for every guard already written against it (see its definition) — the two
// jobs are different work, but "something big is rewriting the dashboard
// across many executions" is the same fact either way, and everything that
// has to stand down for one has to stand down for the other.
// ============================================================================

const FORM_REBUILD_RESUME_HANDLER = 'resumeFormRebuildSweep';
const FORM_REBUILD_STATE_PROP_KEY = 'FORM_REBUILD_STATE_V1';

/** Mirrors BOOTSTRAP_SLICE_BUDGET_MS — see its comment for why not a flat 5 minutes. */
const FORM_REBUILD_SLICE_BUDGET_MS = 4.5 * 60 * 1000;
/** Mirrors BOOTSTRAP_RESUME_DELAY_MS — gap before the next slice after a clean hand-off. */
const FORM_REBUILD_RESUME_DELAY_MS = 30 * 1000;
/** Mirrors BOOTSTRAP_WATCHDOG_DELAY_MS — armed before a slice starts, so a killed slice still gets a successor. */
const FORM_REBUILD_WATCHDOG_DELAY_MS = FORM_REBUILD_SLICE_BUDGET_MS + 2.5 * 60 * 1000;
/** Hard stop, so a bug can never leave the project trading triggers forever. */
const FORM_REBUILD_MAX_SLICES = 60;
/** Consecutive slices allowed to make no progress before giving up. */
const FORM_REBUILD_MAX_STALLED_SLICES = 2;
/** Mirrors BOOTSTRAP_STALE_MS — after this long with no slice completing, the sweep stops blocking normal syncs. */
const FORM_REBUILD_STALE_MS = 2 * 60 * 60 * 1000;

function getFormRebuildState() {
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_REBUILD_STATE_PROP_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log(`⚠️ Form-rebuild sweep state was unreadable (${err}) — treating it as finished.`);
    return null;
  }
}

function saveFormRebuildState(state) {
  PropertiesService.getScriptProperties().setProperty(FORM_REBUILD_STATE_PROP_KEY, JSON.stringify(state));
}

function clearFormRebuildState() {
  PropertiesService.getScriptProperties().deleteProperty(FORM_REBUILD_STATE_PROP_KEY);
}

/** Is a sliced destroy-and-rebuild sweep in flight right now? Stale state (see FORM_REBUILD_STALE_MS) reads as "no". */
function isFormRebuildSweepActive() {
  const state = getFormRebuildState();
  if (!state) return false;
  const age = Date.now() - (state.lastSliceAt || state.startedAt || 0);
  if (age > FORM_REBUILD_STALE_MS) {
    log(`⚠️ Ignoring a destroy-and-rebuild sweep that hasn't advanced in ${Math.round(age / 60000)} minute(s) — ` +
      `run destroyAndRebuildAllForms() to restart it, or cancelFormRebuildSweep() to clear it.`);
    return false;
  }
  return true;
}

/**
 * Starts the background sweep for a plan over FORM_REBUILD_SLICE_THRESHOLD
 * forms. Called only from destroyAndRebuildAllForms(), after both
 * confirmations, so everything here can assume the user already agreed to
 * replace exactly the forms in `plan`.
 */
function startFormRebuildSweep(plan) {
  // Ownership is checked here for the same reason bootstrapCalendars() checks
  // it before pausing automation: the sweep both tears triggers down and
  // builds them back up, so the account starting it is choosing to own them.
  if (!requireTriggerOwnership()) return null;
  if (isFormRebuildSweepActive()) {
    toastIfPossible('A destroy-and-rebuild sweep is already running — leaving it alone.');
    return null;
  }

  pauseAutomationForBootstrap();
  saveFormRebuildState({
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0,
    confirmed: plan.map(item => item.oldFormId), done: [], replaced: 0, failed: 0
  });
  log(`Destroy-and-rebuild sweep started: automation paused, replacing ${plan.length} form(s) in slices.`);
  toastIfPossible(`Rebuild sweep started for ${plan.length} form(s) — this runs in the background and will ` +
    `finish on its own; no need to run this again.`);

  runFormRebuildSweepSlice();
  return { started: true, planned: plan.length };
}

/** Trigger handler for the next slice. Never call this directly — use destroyAndRebuildAllForms(). */
/**
 * DELIBERATELY NOT behind the Automation_Enabled kill switch, for the same
 * reason resumeBootstrapCalendars() isn't (see its comment): a sweep stopped
 * halfway is not a paused sweep, it's a stranded one — the triggers stay
 * torn down and the state stays active, so every normal sync keeps standing
 * down until something explicitly finishes or cancels it. That "something"
 * is this handler completing normally, or cancelFormRebuildSweep().
 */
function resumeFormRebuildSweep() {
  runFormRebuildSweepSlice();
}

/** One execution's worth of rebuilding. Everything that decides whether there is a NEXT slice happens here. */
function runFormRebuildSweepSlice() {
  const state = getFormRebuildState();
  if (!state) {
    // Nothing in flight — a leftover trigger firing after the sweep finished.
    deleteFormRebuildResumeTriggers();
    return;
  }

  // Armed BEFORE anything else, including the lock: from here on every exit
  // path leaves exactly one live successor behind, so neither an outright
  // kill nor a lock we couldn't get can strand the sweep. finishFormRebuildSweep()
  // is what finally clears it.
  armFormRebuildResume(FORM_REBUILD_WATCHDOG_DELAY_MS);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('Form-rebuild slice: another execution holds the lock — the next slice will retry.');
    return;
  }

  try {
    state.slices++;
    state.lastSliceAt = Date.now();
    saveFormRebuildState(state);
    // Re-asserted every slice, not just at the start — see runBootstrapSlice()'s
    // comment on why a trigger that reappears mid-sweep has to be removed again
    // rather than trusted to stay gone.
    pauseAutomationForBootstrap();

    if (state.slices > FORM_REBUILD_MAX_SLICES) {
      finishFormRebuildSweep(state, `stopped after ${FORM_REBUILD_MAX_SLICES} slices without finishing`);
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (!registrySheet) {
      finishFormRebuildSweep(state, 'stopped — the program dashboard sheet is gone');
      return;
    }

    const remainingBefore = state.confirmed.length - state.done.length;
    toastIfPossible(`Rebuild sweep: chunk ${state.slices} running… (${state.replaced} done, ${remainingBefore} left)`);

    // Import outstanding registrations before every slice, not just the
    // first — a response can be submitted on a not-yet-rebuilt form in the
    // gap between slices, and that form is about to be trashed. This is the
    // one step that makes the whole action safe, so a failure here stops the
    // sweep rather than risking a form being destroyed with a response still
    // on it (see runFormRebuildSweep()'s identical reasoning above).
    try {
      syncRegistrationsInternal();
    } catch (err) {
      finishFormRebuildSweep(state, `stopped — could not import outstanding registrations (${err})`);
      return;
    }

    const headers = HEADERS.Master_Program_Dashboard;
    const map = getIndexMap(headers);
    const confirmedSet = new Set(state.confirmed);
    const doneSet = new Set(state.done);
    // Re-derived fresh every slice, same reason runFormRebuildSweep() re-reads
    // the plan after its import: the sync above can move rows (triage sends a
    // deleted session's row elsewhere), so only the SET of confirmed old
    // Form_IDs is trusted from the original plan — the sessions on each one
    // are taken as they stand right now.
    const remainingPlan = planFormRebuilds(readAllSectionedRows(registrySheet, headers, 'Event_ID'), map)
      .filter(item => confirmedSet.has(item.oldFormId) && !doneSet.has(item.oldFormId));

    if (remainingPlan.length === 0) {
      finishFormRebuildSweep(state, null);
      return;
    }

    const deadline = Date.now() + FORM_REBUILD_SLICE_BUDGET_MS;
    let processedThisSlice = 0;
    for (const item of remainingPlan) {
      if (Date.now() >= deadline) break;
      try {
        if (replaceOneForm(registrySheet, item)) {
          state.replaced++;
        } else {
          state.failed++;
        }
      } catch (err) {
        state.failed++;
        log(`⚠️ Could not rebuild the form for ${item.describe} (${err}) — it was left exactly as it was.`);
        noteForAdmin('Forms that could not be rebuilt', `${item.describe} — ${err}`);
      }
      state.done.push(item.oldFormId);
      processedThisSlice++;
      saveFormRebuildState(state);
      // Pacing between forms — see migrateFormsToCurrentTemplate() / the
      // identical sleep in runFormRebuildSweep() above for the same reason.
      if (Date.now() < deadline) Utilities.sleep(1500);
    }

    if (processedThisSlice > 0) {
      SpreadsheetApp.flush();
      // Every event replaced this slice still carries a link to a form that
      // is now in the trash.
      rewriteEventRegistrationLinksInternal(registrySheet, shouldShowLinkInDescription());
      renderProgramDashboard(false, { skipTriage: true });
      flushPersistentRegistries();
    }

    const remaining = state.confirmed.length - state.done.length;
    if (remaining <= 0) {
      finishFormRebuildSweep(state, null);
      return;
    }

    const madeProgress = processedThisSlice > 0;
    state.stalledSlices = madeProgress ? 0 : (state.stalledSlices || 0) + 1;
    saveFormRebuildState(state);

    if (state.stalledSlices >= FORM_REBUILD_MAX_STALLED_SLICES) {
      finishFormRebuildSweep(state, `stopped early — ${remaining} form(s) could not be processed`);
      return;
    }

    toastIfPossible(`Rebuild sweep: chunk ${state.slices} done — ${state.replaced} form(s) rebuilt so far` +
      (state.failed > 0 ? `, ${state.failed} failed` : '') +
      `, ${remaining} to go. Next chunk starts in ${Math.round(FORM_REBUILD_RESUME_DELAY_MS / 1000)}s.`);
    armFormRebuildResume(FORM_REBUILD_RESUME_DELAY_MS); // replaces the watchdog with a prompt hand-off
  } catch (err) {
    // An exception, unlike a timeout, is ours to handle: put the system back
    // together rather than leaving automation paused.
    log(`⚠️ Form-rebuild slice failed (${err}) — restoring automation.`);
    noteForAdmin('Destroy and rebuild forms', `The sweep stopped with an error and automation was restored: ${err}`);
    finishFormRebuildSweep(getFormRebuildState() || state, `stopped by an error: ${err}`);
  } finally {
    flushPersistentRegistries(); // a killed slice's forms must never be forgotten
    lock.releaseLock();
  }
}

/**
 * Last slice: every trigger back in place, admin digest flushed, state
 * cleared. `problem` is null on a clean finish.
 */
function finishFormRebuildSweep(state, problem) {
  state = state || {};
  deleteFormRebuildResumeTriggers();
  clearFormRebuildState();

  try {
    // force: this IS the restore, and the state was cleared just above — but
    // not relying on that ordering is what keeps automation from staying off.
    writeTriggers(true);
  } catch (err) {
    log(`⚠️ Rebuild sweep: could not restore the triggers (${err}) — run "Check Triggers" from the menu.`);
    noteForAdmin('Destroy and rebuild forms',
      `The sweep finished but its triggers could not be restored (${err}). Run "Check Triggers" from the menu.`);
  }

  const totals = `${state.replaced || 0} form(s) rebuilt` + ((state.failed || 0) > 0 ? `, ${state.failed} failed` : '');
  const headline = problem
    ? `⚠️ Destroy-and-rebuild sweep ${problem}. ${totals}.`
    : `Destroy-and-rebuild sweep complete ✅ (${totals}, over ${state.slices || 1} run(s)). Old forms are in the Drive trash.`;

  log(headline);
  if (problem) noteForAdmin('Destroy and rebuild forms', headline);
  toastIfPossible(headline);
  flushAdminDigest('Destroy and rebuild forms');
}

/** Replaces any pending hand-off with exactly one, `delayMs` out. Mirrors armBootstrapResume(). */
function armFormRebuildResume(delayMs) {
  deleteFormRebuildResumeTriggers();
  ScriptApp.newTrigger(FORM_REBUILD_RESUME_HANDLER).timeBased().after(delayMs).create();
}

function deleteFormRebuildResumeTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() !== FORM_REBUILD_RESUME_HANDLER) return;
    ScriptApp.deleteTrigger(t); // one-off triggers linger after firing; clear them out
    removed++;
  });
  return removed;
}

/**
 * ESCAPE HATCH — run from the Apps Script editor. Stops a sliced rebuild
 * sweep and puts automation back exactly as finishFormRebuildSweep() would.
 * Whatever was already rebuilt stays rebuilt; re-running
 * destroyAndRebuildAllForms() picks up only the forms still left.
 */
function cancelFormRebuildSweep() {
  if (!requireAuthorizedAdmin('Cancel Destroy-and-Rebuild Sweep')) return;
  const state = getFormRebuildState();
  if (!state) {
    deleteFormRebuildResumeTriggers();
    writeTriggers();
    log('No destroy-and-rebuild sweep was running — triggers verified anyway.');
    return;
  }
  finishFormRebuildSweep(state, 'was cancelled');
}

/**
 * Replaces ONE form: build the new one, point its sessions at it, carry the
 * persistent registries across, then trash the old one.
 *
 * ORDER MATTERS, and it is the conservative one. The new form is built and the
 * sheet is repointed BEFORE anything is trashed, so every failure mode leaves
 * a working form somewhere: fail while building and nothing has changed; fail
 * after building and the sessions are on a good new form with the old one
 * still sitting there harmlessly. The only thing a crash can leave behind is
 * an unused form in the Drive folder, which is noise, not damage.
 */
function replaceOneForm(registrySheet, item) {
  const context = item.context;
  const formTitle = readFormTitleOrDerive(item.oldFormId, context);

  const created = withFormRetry(`building the replacement for ${item.describe}`,
    () => createFormFromSpec(context, formTitle, 'destroy and rebuild'));
  if (!created) {
    log(`⚠️ Rebuild skipped for ${item.describe}: no usable sessions to put on a form.`);
    return false;
  }

  const moved = writeFormIdOntoSessions(registrySheet, item.eventIds, created.formId);
  if (moved === 0) {
    log(`⚠️ Rebuild for ${item.describe} built form ${created.formId} but moved no session rows onto it — ` +
      `the old form has been left in place. Check the dashboard's Form_ID column.`);
    return false;
  }

  remapFormRegistries(item.oldFormId, created.formId);
  trashReplacedForm(item.oldFormId, item.describe);

  log(`Rebuilt ${item.describe}: ${moved} session(s) moved from form ${item.oldFormId} to ${created.formId}.`);
  noteForAdmin('Registration forms rebuilt from scratch',
    `${item.describe} — a new form replaced ${item.oldFormId}. Any link handed out before now points at the ` +
    `old form, which is in the Drive trash. The calendar events and the dashboard have the new link.`);
  return true;
}

/** The old form's own title if it can still be opened, else one derived from its sessions. */
function readFormTitleOrDerive(oldFormId, context) {
  try {
    const title = String(FormApp.openById(oldFormId).getTitle() || '').trim();
    if (title) return title;
  } catch (err) {
    // Expected often enough to be worth not shouting about: a form nobody can
    // open is one of the main reasons to be running this at all.
    log(`ℹ️ Could not read the old title of form ${oldFormId} (${err}) — naming the replacement from its sessions.`);
  }
  const titles = context.titles || [];
  const base = titles.length > 0
    ? `${titles.slice(0, 2).join(' + ')}${titles.length > 2 ? ' + more' : ''}`
    : 'Registration';
  return `${base} — ${describeLocations(context.locations)}`;
}

/**
 * Carries the per-form bookkeeping from the old ID to the new one.
 *
 * The ALL_DATES registry is the one that would actually hurt to lose: it is
 * keyed by Form_ID and holds everyone who chose "sign up for every date", which
 * is what keeps them being added to dates the series gains later. Dropping it
 * would silently stop those people being booked, with nothing anywhere saying
 * why. The group -> form map is remapped for the same reason in miniature: the
 * next sync would otherwise reuse a trashed form.
 *
 * The label fingerprint is DELETED rather than moved — it describes labels
 * written to a form that no longer exists, and the new form has its own
 * (written with force:true at build time).
 */
function remapFormRegistries(oldFormId, newFormId) {
  const allDates = getAllDatesRegistry();
  if (allDates[oldFormId]) {
    allDates[newFormId] = (allDates[newFormId] || []).concat(allDates[oldFormId]);
    delete allDates[oldFormId];
    __allDatesRegistryDirty = true;
  }

  const registry = getPersistentFormRegistry();
  Object.keys(registry).forEach(groupKey => {
    if (registry[groupKey] !== oldFormId) return;
    registry[groupKey] = newFormId;
    __formRegistryDirty = true;
  });

  const fingerprints = getFormLabelFingerprints();
  if (fingerprints[oldFormId]) {
    delete fingerprints[oldFormId];
    __formLabelFingerprintDirty = true;
  }

  const versions = getFormTemplateVersions();
  if (versions[oldFormId]) {
    delete versions[oldFormId];
    __formTemplateVersionDirty = true;
  }

  invalidateFormItemIndex(oldFormId);
  flushPersistentRegistries();
}

/**
 * Moves the replaced form to the Drive trash — recoverable for 30 days, which
 * is the right level of destructive for something a person triggered from a
 * menu. Never a hard delete.
 *
 * A failure here is logged, not raised: by this point the sessions are already
 * on the new form and everything downstream is correct. An old form left
 * sitting in the folder is untidy, not broken.
 */
function trashReplacedForm(oldFormId, describe) {
  try {
    DriveApp.getFileById(oldFormId).setTrashed(true);
  } catch (err) {
    log(`ℹ️ Rebuilt ${describe}, but the old form ${oldFormId} could not be trashed (${err}) — ` +
      `nothing points at it any more; delete it by hand if you want it gone.`);
  }
}
