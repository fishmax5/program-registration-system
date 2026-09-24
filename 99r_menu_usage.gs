// ============================================================================
// 99r. MENU USAGE  (which menu items anybody actually presses)
// ============================================================================
//
// Numbered after `99q` for the usual reason — never renumber, and this landed
// last. Safe there: behavior only, its two constants stand alone, it declares
// no schema, and everything it reaches for — the menu builder (`16`), every
// menu action in every other file, `TIMEZONE` (`07`),
// `confirmConsequentialAction` (`01`) — it reads at CALL time or through a
// hoisted function declaration. Nothing here is a lazy global and nothing runs
// at load.
//
// WHY. The menu has been reorganized three times on a guess about how often
// each item is pressed ("a serving day at the top, once-a-year behind Admin").
// The guess is the whole rule, and nothing measured it. This does: every menu
// click adds one to a counter and stamps a last-used time, and 🔧 Admin ▸ 📄
// Reports ▸ Menu Usage lists them, most-pressed first, with the items nobody
// has pressed at all underneath — which is the list the next reorganization
// should start from.
//
// HOW A CLICK IS SEEN. An Apps Script menu item names a GLOBAL FUNCTION, and
// that is all it can do: there is no callback, no argument, no hook. So every
// item on the menu names a thin wrapper here instead of the action itself —
// `menu_<action>` — and `buildAppMenu()` (`16`) asks `menuFn_()` for that name.
// The wrappers are written out as ordinary function DECLARATIONS rather than
// generated onto `globalThis` from a table: a declaration is hoisted across the
// whole project whatever order the files load in (see `01a`), it shows up in
// the editor's function list, and it cannot be missing at the moment a click
// arrives. The price is one line per item, and `tests/menu_usage.test.js` is
// what makes that price safe — it builds the menu and fails if any item names a
// wrapper that does not exist, or a wrapper that calls nothing.
//
// TRACKING MUST NEVER COST THE CLICK. `recordMenuUsage_()` is guarded whole:
// a Script Properties read that throws, a stored value that will not parse, a
// write refused over quota — each is logged and swallowed, and the action runs
// regardless. Recording happens BEFORE the action, so a dialog that stays open
// (or an action that throws) is still counted. It takes no lock: two clicks in
// the same second can lose one increment between them, which is the right
// trade for a usage count — a lock here would make every menu item in the
// workbook wait on the hourly sync.
//
// ONE PROPERTY, VERSIONED (`MENU_USAGE_V1`): `{ since, items: { action:
// [count, lastUsedMs] } }`, keyed by the ACTION's name rather than the label,
// so renaming a label keeps its history. Ninety-odd items at ~40 characters is
// well inside the 9KB a property holds.

const MENU_USAGE_PROP_KEY = 'MENU_USAGE_V1';
const MENU_WRAPPER_PREFIX = 'menu_';

/** The global name a menu item should call for `actionName`. */
function menuFn_(actionName) {
  return MENU_WRAPPER_PREFIX + actionName;
}

function readMenuUsage_() {
  const raw = PropertiesService.getScriptProperties().getProperty(MENU_USAGE_PROP_KEY);
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch (err) { data = null; }
  }
  if (!data || typeof data !== 'object' || !data.items || typeof data.items !== 'object') {
    data = { since: Date.now(), items: {} };
  }
  return data;
}

/** One click on `actionName`. Never throws — see the banner. */
function recordMenuUsage_(actionName) {
  try {
    const data = readMenuUsage_();
    const prev = Array.isArray(data.items[actionName]) ? data.items[actionName] : [0, 0];
    data.items[actionName] = [(Number(prev[0]) || 0) + 1, Date.now()];
    PropertiesService.getScriptProperties().setProperty(MENU_USAGE_PROP_KEY, JSON.stringify(data));
  } catch (err) {
    try { log(`ℹ️ Menu usage not recorded for ${actionName} (${err}).`); } catch (ignored) { /* nothing */ }
  }
}

/**
 * Every menu item, as { action → "Submenu ▸ Label" }, read by running the
 * real builder against a recording stand-in for the UI — so the report's
 * labels cannot drift from the menu, and an item nobody has pressed is still
 * listed.
 */
function collectMenuItemLabels_() {
  function stubMenu(name) {
    const m = { name: name, entries: [] };
    m.addItem = (label, fn) => { m.entries.push({ label: label, fn: fn }); return m; };
    m.addSeparator = () => m;
    m.addSubMenu = child => { m.entries.push({ sub: child }); return m; };
    m.addToUi = () => { root = m; };
    return m;
  }
  let root = null;
  buildAppMenu({ createMenu: stubMenu }, true);
  const out = {};
  (function walk(menu, path) {
    menu.entries.forEach(e => {
      if (e.sub) return walk(e.sub, path.concat(e.sub.name));
      const action = String(e.fn).indexOf(MENU_WRAPPER_PREFIX) === 0
        ? String(e.fn).slice(MENU_WRAPPER_PREFIX.length) : String(e.fn);
      out[action] = path.concat(e.label).join(' ▸ ');
    });
  })(root || { entries: [] }, []);
  return out;
}

/** The report's text: pressed items most-first, then the ones never pressed. */
function describeMenuUsage() {
  const data = readMenuUsage_();
  let labels = {};
  try { labels = collectMenuItemLabels_(); } catch (err) { labels = {}; }
  const fmt = ms => (ms ? Utilities.formatDate(new Date(ms), TIMEZONE, 'yyyy-MM-dd') : '—');
  const used = Object.keys(data.items)
    .map(action => ({ action: action, count: Number(data.items[action][0]) || 0, last: Number(data.items[action][1]) || 0 }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count || b.last - a.last);
  const lines = [`Counting since ${fmt(data.since)}.`, ''];
  if (!used.length) lines.push('No menu item has been pressed since then.');
  used.forEach(r => lines.push(`${r.count} × ${labels[r.action] || r.action} (last ${fmt(r.last)})`));
  const never = Object.keys(labels).filter(a => !(data.items[a] && Number(data.items[a][0]) > 0));
  if (never.length) {
    lines.push('', `Never pressed (${never.length}):`);
    never.forEach(a => lines.push(`• ${labels[a]}`));
  }
  return lines.join('\n');
}

/** MENU ACTION — Admin ▸ Reports ▸ Menu Usage. Read-only, ungated. */
function showMenuUsageReport() {
  const text = describeMenuUsage();
  log(`showMenuUsageReport:\n${text}`);
  try {
    SpreadsheetApp.getUi().alert('Menu Usage', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    toastIfPossible('See the log — the menu usage is written there.');
  }
}

/** MENU ACTION — start the counts over. Asks first; ungated (it is only counts). */
function resetMenuUsage() {
  if (!confirmConsequentialAction('Reset Menu Usage',
    'Every menu item\'s count and last-used date will start again from zero.', false)) return;
  PropertiesService.getScriptProperties().setProperty(MENU_USAGE_PROP_KEY,
    JSON.stringify({ since: Date.now(), items: {} }));
  toastIfPossible('Menu usage counts reset ✅');
}

// ---------------------------------------------------------------------------
// 99r-b. The wrappers — one per menu item, named menu_<action>.
// Adding a menu item? Add its wrapper here; tests/menu_usage.test.js fails
// until you do.
// ---------------------------------------------------------------------------

function menu_applyProgramTagChangesToCalendar() { recordMenuUsage_('applyProgramTagChangesToCalendar'); return applyProgramTagChangesToCalendar(); }
function menu_backfillLedgerFromTab() { recordMenuUsage_('backfillLedgerFromTab'); return backfillLedgerFromTab(); }
function menu_backfillSignInSheetRegistry() { recordMenuUsage_('backfillSignInSheetRegistry'); return backfillSignInSheetRegistry(); }
function menu_clearSavedTabOrder() { recordMenuUsage_('clearSavedTabOrder'); return clearSavedTabOrder(); }
function menu_clearStuckBackgroundJobs() { recordMenuUsage_('clearStuckBackgroundJobs'); return clearStuckBackgroundJobs(); }
function menu_dedupeMemberRollNow() { recordMenuUsage_('dedupeMemberRollNow'); return dedupeMemberRollNow(); }
function menu_destroyAndRebuildAllForms() { recordMenuUsage_('destroyAndRebuildAllForms'); return destroyAndRebuildAllForms(); }
function menu_flushCheckInQueueNow() { recordMenuUsage_('flushCheckInQueueNow'); return flushCheckInQueueNow(); }
function menu_linkProgramAcrossLocations() { recordMenuUsage_('linkProgramAcrossLocations'); return linkProgramAcrossLocations(); }
function menu_openRegularNeedsTab() { recordMenuUsage_('openRegularNeedsTab'); return openRegularNeedsTab(); }
function menu_openUpAllFormSharing() { recordMenuUsage_('openUpAllFormSharing'); return openUpAllFormSharing(); }
function menu_openUpAllGeneratedFileSharing() { recordMenuUsage_('openUpAllGeneratedFileSharing'); return openUpAllGeneratedFileSharing(); }
function menu_openVolunteerHoursTab() { recordMenuUsage_('openVolunteerHoursTab'); return openVolunteerHoursTab(); }
function menu_organizeGeneratedFiles() { recordMenuUsage_('organizeGeneratedFiles'); return organizeGeneratedFiles(); }
function menu_previewLegacyTabMerge() { recordMenuUsage_('previewLegacyTabMerge'); return previewLegacyTabMerge(); }
function menu_pushLunchMenuToForms() { recordMenuUsage_('pushLunchMenuToForms'); return pushLunchMenuToForms(); }
function menu_pushProgramQuestionsToForms() { recordMenuUsage_('pushProgramQuestionsToForms'); return pushProgramQuestionsToForms(); }
function menu_rebuildAllFormsInPlace() { recordMenuUsage_('rebuildAllFormsInPlace'); return rebuildAllFormsInPlace(); }
function menu_rebuildAssistanceFormsNow() { recordMenuUsage_('rebuildAssistanceFormsNow'); return rebuildAssistanceFormsNow(); }
function menu_rebuildLayoutFromSheet() { recordMenuUsage_('rebuildLayoutFromSheet'); return rebuildLayoutFromSheet(); }
function menu_rebuildQuickMarkListsNow() { recordMenuUsage_('rebuildQuickMarkListsNow'); return rebuildQuickMarkListsNow(); }
function menu_refreshLunchSignUpForms() { recordMenuUsage_('refreshLunchSignUpForms'); return refreshLunchSignUpForms(); }
function menu_refreshMetricsTabNow() { recordMenuUsage_('refreshMetricsTabNow'); return refreshMetricsTabNow(); }
function menu_refreshProgramLeaderSheetsNow() { recordMenuUsage_('refreshProgramLeaderSheetsNow'); return refreshProgramLeaderSheetsNow(); }
function menu_releaseMyTriggers() { recordMenuUsage_('releaseMyTriggers'); return releaseMyTriggers(); }
function menu_removeAdminGuestsFromCalendarEvents() { recordMenuUsage_('removeAdminGuestsFromCalendarEvents'); return removeAdminGuestsFromCalendarEvents(); }
function menu_removeAllCalendarInvitesFromEvents() { recordMenuUsage_('removeAllCalendarInvitesFromEvents'); return removeAllCalendarInvitesFromEvents(); }
function menu_removeDuplicateSessionRows() { recordMenuUsage_('removeDuplicateSessionRows'); return removeDuplicateSessionRows(); }
function menu_removeMarkedRegistrants() { recordMenuUsage_('removeMarkedRegistrants'); return removeMarkedRegistrants(); }
function menu_removeOrphanedSessionRows() { recordMenuUsage_('removeOrphanedSessionRows'); return removeOrphanedSessionRows(); }
function menu_renderProgramMonthSheetNow() { recordMenuUsage_('renderProgramMonthSheetNow'); return renderProgramMonthSheetNow(); }
function menu_repairDashboardLinks() { recordMenuUsage_('repairDashboardLinks'); return repairDashboardLinks(); }
function menu_repairFormRoutingNow() { recordMenuUsage_('repairFormRoutingNow'); return repairFormRoutingNow(); }
function menu_reportArchivableMonths() { recordMenuUsage_('reportArchivableMonths'); return reportArchivableMonths(); }
function menu_reportDuplicateSessionRows() { recordMenuUsage_('reportDuplicateSessionRows'); return reportDuplicateSessionRows(); }
function menu_reportLeaderSheetRosters() { recordMenuUsage_('reportLeaderSheetRosters'); return reportLeaderSheetRosters(); }
function menu_reportMissingRegistrations() { recordMenuUsage_('reportMissingRegistrations'); return reportMissingRegistrations(); }
function menu_reportOrphanedProgramQuestions() { recordMenuUsage_('reportOrphanedProgramQuestions'); return reportOrphanedProgramQuestions(); }
function menu_reportOrphanedSessionRows() { recordMenuUsage_('reportOrphanedSessionRows'); return reportOrphanedSessionRows(); }
function menu_reportUnimportedForms() { recordMenuUsage_('reportUnimportedForms'); return reportUnimportedForms(); }
function menu_reportVolunteerHours() { recordMenuUsage_('reportVolunteerHours'); return reportVolunteerHours(); }
function menu_reportWhyNothingHappened() { recordMenuUsage_('reportWhyNothingHappened'); return reportWhyNothingHappened(); }
function menu_resetMenuUsage() { recordMenuUsage_('resetMenuUsage'); return resetMenuUsage(); }
function menu_resetRemoveAllCalendarInvitesSweep() { recordMenuUsage_('resetRemoveAllCalendarInvitesSweep'); return resetRemoveAllCalendarInvitesSweep(); }
function menu_resizeAllSheets() { recordMenuUsage_('resizeAllSheets'); return resizeAllSheets(); }
function menu_rewriteEventRegistrationLinks() { recordMenuUsage_('rewriteEventRegistrationLinks'); return rewriteEventRegistrationLinks(); }
function menu_saveCurrentTabOrder() { recordMenuUsage_('saveCurrentTabOrder'); return saveCurrentTabOrder(); }
function menu_sendOfficeDigestNow() { recordMenuUsage_('sendOfficeDigestNow'); return sendOfficeDigestNow(); }
function menu_sendProgramLeaderDayDigestsNow() { recordMenuUsage_('sendProgramLeaderDayDigestsNow'); return sendProgramLeaderDayDigestsNow(); }
function menu_sendProgramLeaderRosterAlertsNow() { recordMenuUsage_('sendProgramLeaderRosterAlertsNow'); return sendProgramLeaderRosterAlertsNow(); }
function menu_sendRegistrantRemindersNow() { recordMenuUsage_('sendRegistrantRemindersNow'); return sendRegistrantRemindersNow(); }
function menu_showAdminMenu() { recordMenuUsage_('showAdminMenu'); return showAdminMenu(); }
function menu_showAllPastRows() { recordMenuUsage_('showAllPastRows'); return showAllPastRows(); }
function menu_showAssistanceReviewDialog() { recordMenuUsage_('showAssistanceReviewDialog'); return showAssistanceReviewDialog(); }
function menu_showAssistanceScheduleDialog() { recordMenuUsage_('showAssistanceScheduleDialog'); return showAssistanceScheduleDialog(); }
function menu_showBulkRegistrantsDialog() { recordMenuUsage_('showBulkRegistrantsDialog'); return showBulkRegistrantsDialog(); }
function menu_showBulkWaitlistOnlyDialog() { recordMenuUsage_('showBulkWaitlistOnlyDialog'); return showBulkWaitlistOnlyDialog(); }
function menu_showCalendarInviteDialog() { recordMenuUsage_('showCalendarInviteDialog'); return showCalendarInviteDialog(); }
function menu_showCheckInPageDialog() { recordMenuUsage_('showCheckInPageDialog'); return showCheckInPageDialog(); }
function menu_showColumnWidthDialog() { recordMenuUsage_('showColumnWidthDialog'); return showColumnWidthDialog(); }
function menu_showDeleteRegistrationsDialog() { recordMenuUsage_('showDeleteRegistrationsDialog'); return showDeleteRegistrationsDialog(); }
function menu_showDuplicateRegistrationsDialog() { recordMenuUsage_('showDuplicateRegistrationsDialog'); return showDuplicateRegistrationsDialog(); }
function menu_showEventTagInspectorDialog() { recordMenuUsage_('showEventTagInspectorDialog'); return showEventTagInspectorDialog(); }
function menu_showFixOneFormDialog() { recordMenuUsage_('showFixOneFormDialog'); return showFixOneFormDialog(); }
function menu_showForkedFormsDialog() { recordMenuUsage_('showForkedFormsDialog'); return showForkedFormsDialog(); }
function menu_showFormLinkDoctorDialog() { recordMenuUsage_('showFormLinkDoctorDialog'); return showFormLinkDoctorDialog(); }
function menu_showLedgerVerificationReport() { recordMenuUsage_('showLedgerVerificationReport'); return showLedgerVerificationReport(); }
function menu_showLunchMenuImportDialog() { recordMenuUsage_('showLunchMenuImportDialog'); return showLunchMenuImportDialog(); }
function menu_showMemberRollImportDialog() { recordMenuUsage_('showMemberRollImportDialog'); return showMemberRollImportDialog(); }
function menu_showMenuUsageReport() { recordMenuUsage_('showMenuUsageReport'); return showMenuUsageReport(); }
function menu_showProgramLeaderSheetDialog() { recordMenuUsage_('showProgramLeaderSheetDialog'); return showProgramLeaderSheetDialog(); }
function menu_showProgramReviewDialog() { recordMenuUsage_('showProgramReviewDialog'); return showProgramReviewDialog(); }
function menu_showQuestionBuilderDialog() { recordMenuUsage_('showQuestionBuilderDialog'); return showQuestionBuilderDialog(); }
function menu_showQuickMarkDialog() { recordMenuUsage_('showQuickMarkDialog'); return showQuickMarkDialog(); }
function menu_showReimportFormDialog() { recordMenuUsage_('showReimportFormDialog'); return showReimportFormDialog(); }
function menu_showRepointSessionsDialog() { recordMenuUsage_('showRepointSessionsDialog'); return showRepointSessionsDialog(); }
function menu_showRestoreRegistrantsFromCopyDialog() { recordMenuUsage_('showRestoreRegistrantsFromCopyDialog'); return showRestoreRegistrantsFromCopyDialog(); }
function menu_showSignInSheetDialog() { recordMenuUsage_('showSignInSheetDialog'); return showSignInSheetDialog(); }
function menu_showTimeBlockDialog() { recordMenuUsage_('showTimeBlockDialog'); return showTimeBlockDialog(); }
function menu_showTriggerStatus() { recordMenuUsage_('showTriggerStatus'); return showTriggerStatus(); }
function menu_showVolunteerHoursDialog() { recordMenuUsage_('showVolunteerHoursDialog'); return showVolunteerHoursDialog(); }
function menu_showWeekendEventLoaderDialog() { recordMenuUsage_('showWeekendEventLoaderDialog'); return showWeekendEventLoaderDialog(); }
function menu_snapshotRegistrantsNow() { recordMenuUsage_('snapshotRegistrantsNow'); return snapshotRegistrantsNow(); }
function menu_syncCalendars() { recordMenuUsage_('syncCalendars'); return syncCalendars(); }
function menu_syncEverythingNow() { recordMenuUsage_('syncEverythingNow'); return syncEverythingNow(); }
function menu_syncRegistrations() { recordMenuUsage_('syncRegistrations'); return syncRegistrations(); }
function menu_takeOverTriggerOwnership() { recordMenuUsage_('takeOverTriggerOwnership'); return takeOverTriggerOwnership(); }
function menu_writeTriggers() { recordMenuUsage_('writeTriggers'); return writeTriggers(); }
// BOOTSTRAP_ENTRY_NAME ('25') names this one; the test checks they agree.
function menu_bootstrapCalendars() { recordMenuUsage_('bootstrapCalendars'); return bootstrapCalendars(); }
