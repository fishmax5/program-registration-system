// =====================================================================// 3. MENU & TRIGGER HOOKS
// =====================================================================
/**
 * TWO MENUS, NOT ONE.
 *
 * Everyone gets the day-to-day items: the two syncs, the lunch-menu tools,
 * the sign-in sheet, the per-program tools (link across locations, move
 * sessions to another form, delete registrations) and Resize All Sheets.
 * These are open to anyone who can edit the workbook, on purpose — they are
 * the things a person running a program needs on the day, and the desk cannot
 * wait for an admin to come and press a button.
 *
 * TWO OF THEM DO REAL DAMAGE IF MIS-CLICKED, and are open anyway:
 * "🗑️ Delete Registrations…" removes registrant rows and can take the form
 * responses with them, and "📄 Move Sessions to Another Form…" moves live
 * sessions onto a different form. What protects those is not who is signed
 * in — it is the dialog: both name every session and every headcount they are
 * about to touch, and the delete path additionally requires a confirmation
 * word to be TYPED before it will run. That is the guard that has to be kept
 * correct now (see DELETE_REGISTRATIONS_CONFIRM_WORD), because it is the only
 * one left on that path.
 *
 * Accounts in AUTHORIZED_ADMIN_EMAILS additionally get an "🔧 Admin"
 * submenu holding the structural entries: trigger repair, the first-run
 * import, the two form rebuilds (in place, and destroy-and-replace), and the
 * READ-ONLY leftover-tab report. Those stay
 * gated — they restructure the workbook or rewrite every form at once, and
 * none of them is something a normal day needs.
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
 * by name — which is the reason the split was never a security boundary in
 * the first place, and part of why the day-to-day half is no longer gated:
 * it was stopping the desk from working while stopping nobody who meant harm.
 * requireAuthorizedAdmin() inside a gated ADMIN function is still the actual
 * gate, and it is what must be kept correct — but it now covers only the
 * irreversible and trigger-touching items (ADMIN_GATED_ACTIONS), so the
 * submenu is ATTACHED FOR EVERYONE. Hiding it never protected anything, and
 * hiding it from an account onOpen could not identify — a simple trigger
 * frequently cannot — was how a genuine admin ended up with no Admin menu at
 * all. The destructive items inside still refuse; the repairs no longer do.
 */
function onOpen() {
  try {
    migrateLegacySheetNames(SpreadsheetApp.getActiveSpreadsheet());
  } catch (err) {
    log(`ℹ️ Could not check for legacy tab names on open (${err}).`);
  }
  buildAppMenu(SpreadsheetApp.getUi(), true);
}

/**
 * Builds (or rebuilds) the workbook menu. `includeAdmin` decides whether the
 * structural submenu is attached.
 *
 * Split out from onOpen() so showAdminMenu() can re-run it — see below.
 */
/**
 * "Update Everything Now" — the calendar pass, then the registrations pass.
 *
 * WHY IT IS ONE MENU ITEM. Sync Cal and Sync Registrations are the two halves
 * of one machine: the first reads the calendars and makes sure every session
 * has a row and a form, the second reads the forms and makes sure every
 * response has a registrant. Which of the two you need depends on which half
 * of the machine is behind, and nobody outside this file should be expected
 * to work that out — the thing a person actually wants is for the workbook to
 * catch up with reality. So the default is both, in the order that makes the
 * second one see the first one's work.
 *
 * The pair is exactly what the hourly triggers already run, so this is not a
 * new combination of work — only a new way to ask for it.
 *
 * They stay available separately under "Settings & Fixes" for the times one
 * of them genuinely is what you want: a calendar sync writes to event
 * descriptions and takes the longer of the two, so re-importing responses
 * without it is a real thing to want.
 *
 * syncCalendars() asks its own "are you sure" (it edits calendar events, which
 * people can see), and answering NO stops here rather than going on to import
 * — a declined confirmation means "not now", not "skip that bit".
 */
function syncEverythingNow() {
  const before = getLastSyncTime();
  syncCalendars();
  // Nothing to do with the answer to the confirmation: syncCalendars() returns
  // quietly whether it ran, was declined, or stood down for a bootstrap. The
  // import is safe and useful in all three cases, and standing down is
  // something it decides for itself.
  syncRegistrations();
  log(`syncEverythingNow: calendar + registrations pass finished (last import before this run: ${before}).`);
}

function buildAppMenu(ui, includeAdmin) {
  // GROUPED BY THE JOB SOMEBODY CAME HERE TO DO, not by what the code does,
  // and now nested one level deeper where a submenu had itself grown too long
  // to scan.
  //
  // THE RULE THIS MENU IS BUILT ON: how often a thing is done decides how deep
  // it sits. The three items at the top are a serving day — they are what the
  // workbook is opened FOR, and they should never be behind anything. Below
  // them, one item that makes the workbook catch up with the world. Below
  // that, the jobs somebody does occasionally, by name. Behind Admin, the
  // things done once a year or once ever.
  //
  // WHAT MOVED, and why:
  //
  //   "Check-In Page" came UP to the top. It is the tablet at the front door —
  //   the other half of Quick Mark — and it was filed under Settings & Fixes
  //   with "Resize All Sheets", two clicks from the desk it belongs to.
  //
  //   "Sync Cal only" / "Sync Registrations only" came DOWN into Settings.
  //   They are the two halves of "Update Everything Now" for the times one of
  //   them is what you actually want, which is rare and diagnostic.
  //
  //   Programs & Forms had ten items at one altitude, mixing "what is wrong
  //   with my programs" with surgery nobody does twice a year. The surgical
  //   ones are now behind Appointments and Move & Merge, so the six that
  //   remain are the six worth reading.
  //
  //   Admin had twenty flat items and a doubled separator. It is now four
  //   named groups, with everything irreversible collected behind one clearly
  //   labelled door instead of sitting a slot away from a report.
  //
  // Nothing was removed. Every function that was on this menu is still on it.
  const menu = ui.createMenu(APP_MENU_NAME)
    // --- A SERVING DAY. The whole of ordinary use, at the top, unnested. ---
    .addItem('\u26a1 Quick Mark Attendance / Lunch\u2026', 'showQuickMarkDialog')
    .addItem('\ud83d\udccb Sign-In Sheet (live Doc)\u2026', 'showSignInSheetDialog')
    // The tablet at the door is the other half of Quick Mark (section 16), and
    // it is used on exactly the days those two are.
    .addItem('\ud83d\udcf1 Door Pages (links & PIN)\u2026', 'showCheckInPageDialog')
    .addSeparator()
    // ONE ITEM, NOT TWO. "Sync Cal" and "Sync Registrations" are a distinction
    // between two halves of one machine, and nobody outside this file should
    // have to hold it: what a person wants is for the workbook to catch up
    // with the calendar and the forms. Both still exist on their own under
    // Settings & Fixes for the times one of them is what you actually want.
    .addItem('\ud83d\udd04 Update Everything Now', 'syncEverythingNow')
    .addSeparator()
    .addSubMenu(ui.createMenu('\ud83c\udf71 Lunch')
      .addItem('Add Menu Items (paste/upload CSV)\u2026', 'showLunchMenuImportDialog')
      // Directly under the item that WRITES the menu, because it is what you
      // press next: typing a menu changes nothing out in the world until the
      // forms are told about it.
      .addItem('Push Menu Changes to Forms', 'pushLunchMenuToForms')
      .addSeparator()
      .addItem('Build / Refresh Lunch Sign-Up Forms', 'refreshLunchSignUpForms'))
    .addSubMenu(ui.createMenu('\ud83d\udc69\u200d\ud83c\udfeb Rosters & Sharing')
      // On this submenu rather than under Settings, because a standing need is
      // roster work: it is what somebody has to know to serve the person, and
      // it is edited by the same people who keep the rosters.
      .addItem('\ud83d\udd14 Regular Needs (standing notes)\u2026', 'openRegularNeedsTab')
      // Beside the standing notes because it is the same tab's other half: who
      // the office knows, as against what it knows about them. The dedupe runs
      // on every write already (section 77) — this is the item for the
      // afternoon somebody has just pasted a list in and wants the number.
      .addItem('\ud83d\udc65 Add Members to the Roll (paste/upload)\u2026', 'showMemberRollImportDialog')
      .addItem('Merge Duplicate Members Now', 'dedupeMemberRollNow')
      // THE ONE-ROW DELETE, beside the roll tools because it is the same job
      // at the other tab: a duplicate found while reading down a list. Mark
      // the rows on All_Registrants (Manual_Override → "Remove This Row"),
      // then press this. Section 83 says why marking and removing are two
      // steps. Its session-wide sibling stays behind Admin → Destructive.
      .addItem('\ud83d\uddd1\ufe0f Remove Marked Registrants\u2026', 'removeMarkedRegistrants')
      .addSeparator()
      // The three halves of one job, adjacent: hand a sheet out, keep it
      // current, and tell the leader what moved on it. The last two both ride
      // the hourly sync already — these are for when somebody does not want to
      // wait an hour.
      .addItem('Share a Program Registrant Sheet\u2026', 'showProgramLeaderSheetDialog')
      .addItem('Refresh Program Registrant Sheets Now', 'refreshProgramLeaderSheetsNow')
      .addItem('Send Roster Change Alerts Now', 'sendProgramLeaderRosterAlertsNow')
      // The countdown-channel twin of the item above — see Notify_Timing on
      // Program_Leaders for which leaders are on which.
      .addItem('Send Roster Digests Now', 'sendProgramLeaderDayDigestsNow')
      .addSeparator()
      .addItem('Personalized Assistance Schedule\u2026', 'showAssistanceScheduleDialog')
      .addItem('Invite Registrants to Calendar Events\u2026', 'showCalendarInviteDialog')
      // Beside the invitations because they are the two channels one
      // Program_Settings row governs, and this is the one that can
      // say "your appointment is at 2:15". See sections 9e and 9h.
      .addItem('Send Registrant Reminders Now', 'sendRegistrantRemindersNow'))
    .addSubMenu(ui.createMenu('\ud83d\udcdd Programs & Forms')
      // FIRST, because it is the one that says what is wrong before anything
      // else here is worth pressing. Everything below acts on one program;
      // this is how somebody finds out which. See section 14.
      .addItem('\ud83d\udd0d Review Programs, Then Update Once\u2026', 'showProgramReviewDialog')
      .addSeparator()
      // ABOVE the push, because it is the half somebody does first: this
      // WRITES a question (and says which forms it would reach before it
      // does), the item below sends whatever the tab currently says.
      .addItem('\u2795 Build a Form Question\u2026', 'showQuestionBuilderDialog')
      .addItem('Update Program Questions on Forms', 'pushProgramQuestionsToForms')
      .addSeparator()
      // The single-form repair staff actually reach for: one form has gone
      // wrong, and rebuilding every form on the workbook to correct it is a
      // sweep nobody wants to wait for. Same repair, same kept link.
      .addItem('\ud83e\ude79 Update One Form (keeps its link)\u2026', 'showFixOneFormDialog')
      // NAMED FOR WHAT IT DOES, not for the four columns it happens to read:
      // the ticks you made on the dashboard have not reached the calendar yet,
      // and this sends them.
      .addItem('Push Dashboard Ticks to the Calendar', 'applyProgramTagChangesToCalendar')
      .addSeparator()
      // APPOINTMENTS ARE THEIR OWN SHAPE, and their three items only ever make
      // sense together — a [Personalized Assistance] program is booked by time
      // slot, and none of this applies to anything else on the workbook.
      .addSubMenu(ui.createMenu('\ud83d\uddd3\ufe0f Appointments')
        // First: the one that walks the appointment MONTHS — the unit a form
        // actually covers — and says whether the form somebody is about to
        // hand out offers every date in it and every time on every date.
        .addItem('Review Appointment Months\u2026', 'showAssistanceReviewDialog')
        // Under it because it is the same job at the other altitude, and it
        // fixes the CALENDAR rather than the sheet: a day typed as one event
        // per appointment is not a form problem. See section 12.
        .addItem('\u23f1\ufe0f Merge Half-Hour Blocks\u2026', 'showTimeBlockDialog')
        .addSeparator()
        .addItem('Rebuild Appointment Forms + Report\u2026', 'rebuildAssistanceFormsNow'))
      // THE TWO THAT MOVE SESSIONS BETWEEN FORMS. Rare, consequential, and
      // easy to press by mistake when they sit in a list of ordinary repairs.
      .addSubMenu(ui.createMenu('\ud83d\udd00 Move & Merge')
        .addItem('Link Program Across Locations\u2026', 'linkProgramAcrossLocations')
        .addItem('Move Sessions to Another Form\u2026', 'showRepointSessionsDialog')))
    .addSeparator()
    .addSubMenu(ui.createMenu('\u2699\ufe0f Settings & Fixes')
      // The two halves of "Update Everything Now", for the times one of them
      // is what you actually want. Diagnostic rather than daily, which is why
      // they are here and not at the top.
      .addItem('Sync Cal only', 'syncCalendars')
      .addItem('Sync Registrations only', 'syncRegistrations')
      .addSeparator()
      // The \u21bb link inside the Quick Mark dialog does the same thing. This is
      // for the other order \u2014 rebuild the lists first, THEN walk to the desk.
      .addItem('Rebuild Quick Mark Lists', 'rebuildQuickMarkListsNow')
      // The month view is redrawn by every dashboard render; this is for
      // somebody who deleted the tab, or who wants it caught up without
      // waiting for the next sync. See 78_program_month_dashboard.gs.
      .addItem('Rebuild the Program Month View', 'renderProgramMonthSheetNow')
      // The check-in page queues its marks and a trigger writes them; this is
      // the "write them NOW" for somebody standing over the tab wondering
      // where this morning's ticks are. See flushCheckInQueue().
      .addItem('Write Queued Check-Ins Now', 'flushCheckInQueueNow')
      .addSeparator()
      // The Metrics tab writes itself on the 2nd of every month. This is for
      // the other order — somebody looking at the year-over-year block today
      // and wanting the month running counted in.
      .addItem('\ud83d\udcc8 Update Metrics Now', 'refreshMetricsTabNow')
      .addSeparator()
      .addItem('Show All Past Rows', 'showAllPastRows')
      .addItem('Resize All Sheets', 'resizeAllSheets'));

  if (includeAdmin) {
    menu.addSeparator().addSubMenu(ui.createMenu('\ud83d\udd27 Admin')
      // THE FOUR THAT ARE SAFE TO PRESS, at the top of the submenu. Each one
      // repairs something in place and none of them can lose data.
      .addItem('\ud83e\uddf1 Rebuild Layout (no calendar sync)', 'rebuildLayoutFromSheet')
      .addItem('\ud83d\udd17 Rewrite Event Links (fix duplicates)', 'rewriteEventRegistrationLinks')
      // THE ANSWER TO "REGISTRATIONS STOPPED ARRIVING FROM ONE FORM". Run as
      // the account that made the forms \u2014 see openUpAllFormSharing().
      .addItem('\ud83d\udd13 Open Up Form Sharing', 'openUpAllFormSharing')
      // THE ONE THAT ANSWERS "WHY ISN'T THIS TAG WORKING". Every other item
      // here does something; this one only looks \u2014 at a calendar event, with
      // the sync's own parser \u2014 and says which brackets it read, which it
      // ignored, and whether the dashboard agrees. See section 4c-bis.
      .addItem('\ud83c\udff7\ufe0f Read an Event\'s Tags\u2026', 'showEventTagInspectorDialog')
      // THE WEEKEND, ON PURPOSE. A Saturday on a program calendar is as often
      // a rental or a placeholder as a program, so this lists the Sat/Sun
      // dates that are not loaded yet and loads only the ones somebody ticks.
      // It adds dates; it changes nothing about what the sync does. See 80.
      .addItem('\ud83d\uddd3\ufe0f Load Weekend Events\u2026', 'showWeekendEventLoaderDialog')
      .addSeparator()
      // EVERYTHING ABOUT A LINK THAT LOOKS WRONG, BEHIND ONE ITEM. There were
      // four here \u2014 check the tab against itself, check the calendar against
      // the tab, repair the links, recover the forms \u2014 and each answered a
      // real question while none of them answered "what is wrong with my
      // links", which is the only question anybody arrives with. They also had
      // to be run in the right ORDER, and nothing said so. The Doctor runs
      // every check in one pass and lists what it found in the order to fix it,
      // each finding carrying its own button. The four functions are still
      // here and still work from the Apps Script editor; they are just no
      // longer four things to choose between. See section 6f-vi.
      .addItem('\ud83e\ude7a Form & Link Doctor\u2026', 'showFormLinkDoctorDialog')
      // NOT under "Destructive": it moves no link and rebuilds nothing — it
      // writes only the specific repairs a live form needs to match the
      // current template (FORM_STATE_MIGRATIONS). It is the thing to reach for
      // BEFORE "Rebuild Forms In Place", not after. The handler is still
      // called repairFormRoutingNow() because the first such repair was the
      // page routing; renaming it would strand the trigger that resumes it.
      .addItem('\ud83e\udded Fix Forms In Place (no rebuild)', 'repairFormRoutingNow')
      .addSeparator()
      // THE ONE-TIME JOBS, BEHIND ONE DOOR. Each of these is pressed once on a
      // workbook upgraded from an older version and never again — they catch
      // the workbook up on something it did before the code knew better — and
      // three of them sitting between the everyday repairs made the Admin
      // submenu read as a list of things to do rather than a list of things to
      // reach for. Nothing was removed and nothing changed about what they do;
      // they are simply no longer in the way. Each is safe to press twice.
      .addSubMenu(ui.createMenu('\ud83e\uddf0 One-Time Jobs')
        // Only worth pressing on a workbook that was printing sign-in sheets
        // before those links existed: it reads the PDF folder once and teaches
        // the registry about what is already in it. New PDFs register
        // themselves as they are built. See backfillSignInSheetRegistry().
        .addItem('\ud83d\udda8\ufe0f Rebuild Sign-In Sheet Links', 'backfillSignInSheetRegistry')
        // The same kind of job one tab over: every folder lookup used to create
        // at My Drive ROOT, so a year of forms, leader sheets and sign-in
        // documents can be sitting loose there. This files them under the
        // folder the workbook lives in. It moves files; it changes no link and
        // deletes nothing. See section 82.
        .addItem('\ud83d\uddc2\ufe0f Organize Generated Files', 'organizeGeneratedFiles')
        // For a workbook upgraded from the version that put the office on every
        // event's guest list: it takes those addresses back off the upcoming
        // events (the office is mailed a digest instead now — see section 5b).
        // A run that hits its cap says so.
        .addItem('\ud83d\udc65 Remove Office Guests from Calendar Events', 'removeAdminGuestsFromCalendarEvents')
        .addSeparator()
        // THE FIRST RUN, which is the one-time job by definition. It was filed
        // under "Setup & Reports" beside two read-only reports, which is how a
        // full import came to sit one slot from something that only measures.
        .addItem('\ud83c\udfc1 Import Everything (First Run)', BOOTSTRAP_ENTRY_NAME))
      // ARRANGEMENTS SOMEBODY MAKES BY HAND that the next rebuild would
      // otherwise undo. They belong together because that is the one thing
      // they have in common. See section 2a-ii.
      .addSubMenu(ui.createMenu('\ud83c\udfa8 Appearance')
        .addItem('\ud83d\udccf Column Widths\u2026', 'showColumnWidthDialog')
        .addItem('\ud83d\uddc2\ufe0f Save This Tab Order', 'saveCurrentTabOrder')
        .addItem('Reset to the Built-In Tab Order', 'clearSavedTabOrder'))
      .addSubMenu(ui.createMenu('\u23f0 Triggers')
        .addItem('Trigger Status', 'showTriggerStatus')
        .addItem('Check Triggers', 'writeTriggers')
        .addSeparator()
        .addItem('Take Over Trigger Ownership', 'takeOverTriggerOwnership')
        .addItem('Release My Triggers', 'releaseMyTriggers'))
      // REPORTS ONLY, now that the first-run import moved to One-Time Jobs
      // above — which is what lets the label promise that nothing in here
      // writes anything.
      .addSubMenu(ui.createMenu('\ud83d\udcc4 Reports')
        // Both READ-ONLY, and named so. They measure; they change nothing.
        .addItem('Find Leftover Tabs (read-only report)', 'previewLegacyTabMerge')
        // The measurement half of the retired-calendar sweep. Its action half
        // is behind the Destructive door below — but this report is the only
        // thing that names WHICH calendar the leftover rows are from, and the
        // calendar ID is the whole question, so it is read first. See 84.
        .addItem('Find Leftover Calendar Rows (read-only report)', 'reportOrphanedSessionRows')
        .addItem('Archive Old Months (report)', 'reportArchivableMonths'))
      .addSeparator()
      // EVERYTHING IRREVERSIBLE, BEHIND ONE DOOR THAT SAYS SO. These used to
      // sit interleaved with the repairs above \u2014 "Delete Registrations" was
      // one slot from "Rewrite Event Links", and the two form rebuilds were
      // adjacent with only their wording to tell the safe one from the one
      // that reissues every link in the building.
      .addSubMenu(ui.createMenu('\u26a0\ufe0f Destructive \u2014 read the prompt')
        // Directly above its destructive twin on purpose: this is the one to
        // pick once links are out in the world, and the pairing is the only
        // place the difference between them is visible at a glance.
        .addItem('\ud83e\ude79 Rebuild Forms In Place (keeps links)\u2026', 'rebuildAllFormsInPlace')
        .addItem('\ud83d\udca3 Destroy & Rebuild Forms\u2026', 'destroyAndRebuildAllForms')
        .addSeparator()
        .addItem('\ud83d\uddd1\ufe0f Delete Registrations\u2026', 'showDeleteRegistrationsDialog')
        // Takes every session row off a calendar this workbook no longer
        // reads. Registrants go to Triage rather than being deleted and no
        // form is touched, but a whole location can leave the table in one
        // press \u2014 which is what puts it here. Read the report first. See 84.
        .addItem('\ud83e\uddf9 Remove Leftover Calendar Rows\u2026', 'removeOrphanedSessionRows')));
  } else {
    // The escape hatch. onOpen() runs as a SIMPLE trigger, which in some
    // execution contexts cannot resolve the signed-in account at all — and
    // getCurrentUserEmail() deliberately fails closed, so a genuine admin
    // can open the workbook and find no Admin submenu. Clicking a menu ITEM
    // always runs fully authorized, so this re-checks and rebuilds. A
    // non-admin who clicks it just gets told no.
    menu.addSeparator().addItem('\ud83d\udd27 Admin Tools (sign-in check)\u2026', 'showAdminMenu');
  }

  menu.addToUi();
}

/**
 * Menu entry: put the Regular_Needs tab in front, building it first if this
 * workbook predates it.
 *
 * A tab is the right editor for these — there are tens of them, they are
 * edited in batches, and a dialog listing every standing need in the building
 * would be a worse spreadsheet. Quick Mark's own need form is for the other
 * case: one need, about the person standing at the desk right now.
 */
function openRegularNeedsTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAMES.REGULAR_NEEDS);
  if (!sheet || sheet.getLastRow() < MEMORY_TAB_HEADER_ROW) {
    renderRegularNeedsSheet(sheet ? null : []);
    sheet = ss.getSheetByName(SHEET_NAMES.REGULAR_NEEDS);
  }
  if (!sheet) return;
  ss.setActiveSheet(sheet);
  toastIfPossible('🔔 Regular Needs — one row per standing fact. Quick Mark reads it as names are picked.');
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
  // AN HOUR AFTER THE CALENDAR SYNC, not alongside it: this reads
  // All_Registrants and the dashboard, and wants that hour's syncCalendars()
  // run — whatever it moved or added overnight — reflected before it prints,
  // not raced against it. See autoCreateTodaysSignInSheets() (45).
  removed += resetTriggersForHandler('autoCreateTodaysSignInSheets', () =>
    ScriptApp.newTrigger('autoCreateTodaysSignInSheets').timeBased().everyDays(1).atHour(6).create());
  removed += resetTriggersForHandler('syncRegistrations', () =>
    ScriptApp.newTrigger('syncRegistrations').timeBased().everyHours(1).create());
  // THE DOOR'S QUEUE, drained every five minutes. Check-in marks are written
  // to a queue rather than to the sheet so that a tap at the desk never waits
  // for the workbook (section 16c); this is what carries them across. Five
  // minutes rather than one because nothing reads attendance in real time, and
  // the desk's own roster loads flush it sooner anyway.
  removed += resetTriggersForHandler('flushCheckInQueueTrigger', () =>
    ScriptApp.newTrigger('flushCheckInQueueTrigger').timeBased().everyMinutes(5).create());
  // THE MONTH JUST ENDED, WRITTEN DOWN. Metrics is the one tab that is a
  // record rather than a projection (see 83_monthly_metrics.gs): a month has
  // to be counted while its rows are still in the workbook, because a
  // year-over-year comparison outlives them. The 2nd rather than the 1st so a
  // registration marked the morning after a month-end session is already in;
  // 4am for the same reason every other nightly job runs then.
  removed += resetTriggersForHandler('captureMonthlyMetricsTrigger', () =>
    ScriptApp.newTrigger('captureMonthlyMetricsTrigger')
      .timeBased().onMonthDay(2).atHour(4).create());
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
    : `All triggers verified — 2 daily (calendar sync + sign-in sheets), 1 hourly, 1 monthly metrics, 1 check-in flush, ` +
      `${calendarResult.created} calendar-edit ✅`;
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


