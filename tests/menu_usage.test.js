// MENU USAGE (section 99r) and the menu it counts (section 16).
//
// Every menu item names a `menu_<action>` wrapper rather than the action, so
// the one way this can break a click is a wrapper that does not exist — Apps
// Script answers that with "Script function not found", on the item somebody
// pressed. Pinned here:
//
//   THE MENUS BUILD for every role, and EVERY item they name is a function
//   that exists and calls an action that exists. Nothing on the pre-R4 menu
//   became unreachable, and the role table resolves a blank account to the
//   FULL menu.
//
//   A CLICK COUNTS: one increment and a last-used stamp per press, keyed by
//   the action, and the report lists most-pressed first and the never-pressed
//   underneath.
//
//   TRACKING NEVER COSTS THE CLICK: Script Properties throwing, or holding
//   garbage, and the action still runs.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
let propsBroken = false;
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10), getUuid: () => 'x', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => { if (propsBroken) throw new Error('quota'); return key in props ? props[key] : null; },
      setProperty: (k, v) => { if (propsBroken) throw new Error('quota'); props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.MENU_USAGE_PROP_KEY = MENU_USAGE_PROP_KEY;
this.BOOTSTRAP_ENTRY_NAME = BOOTSTRAP_ENTRY_NAME;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a !== b) { failures++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`); }
  else console.log(`ok   ${label}`);
}

// --- The menus build, and every item resolves. -----------------------------
// R4: three top-level menus chosen by role (99zma). `build(role)` records every
// root that reaches addToUi, by name.
function build(includeAdmin, role) {
  const names = [];
  const roots = [];
  function menu(name) {
    const m = { name, items: [], subs: [], fns: [] };
    m.addItem = (label, fn) => { names.push(fn); m.items.push(label); m.fns.push(fn); return m; };
    m.addSeparator = () => m;
    m.addSubMenu = child => { m.subs.push(child); return m; };
    m.addToUi = () => { roots.push(m); };
    return m;
  }
  sandbox.buildAppMenu({ createMenu: menu }, includeAdmin, role);
  return { names, roots, byName: n => roots.find(r => r.name === n) };
}
const full = build(true);
const lean = build(false);
const unknown = build(false, 'unknown');
const DESK = vm.runInContext('DESK_MENU_NAME', sandbox);
const COORD = vm.runInContext('COORDINATOR_MENU_NAME', sandbox);
const ADMIN = vm.runInContext('ADMIN_MENU_NAME', sandbox);
check('admin gets Desk, Coordinator, Admin in that order', full.roots.map(r => r.name), [DESK, COORD, ADMIN]);
check('non-admin gets Desk and Coordinator only', lean.roots.map(r => r.name), [DESK, COORD]);
check('an unidentified viewer gets Admin too', unknown.roots.map(r => r.name), [DESK, COORD, ADMIN]);
check('every role together still offers many items', full.names.length > 80, true);
check('non-admin menu offers the sign-in escape hatch', lean.names.includes('menu_showAdminMenu'), true);
check('admin menu does not', full.names.includes('menu_showAdminMenu'), false);
check('unidentified viewer does not need it', unknown.names.includes('menu_showAdminMenu'), false);

const bad = [];
full.names.concat(lean.names).forEach(fn => {
  if (!/^menu_/.test(fn)) return bad.push(`${fn}: not a tracking wrapper`);
  if (typeof sandbox[fn] !== 'function') return bad.push(`${fn}: wrapper missing`);
  const action = fn.slice(5);
  if (typeof sandbox[action] !== 'function') bad.push(`${fn}: action ${action} missing`);
  if (sandbox[fn].toString().indexOf(`return ${action}()`) < 0) bad.push(`${fn}: does not call ${action}`);
});
check('every menu item names an existing wrapper around an existing action', bad, []);
check('the bootstrap wrapper matches BOOTSTRAP_ENTRY_NAME', full.names.includes('menu_' + sandbox.BOOTSTRAP_ENTRY_NAME), true);

// The Desk menu is the serving day, at its top level, unnested.
const desk = full.byName(DESK);
check('desk has no submenus', desk.subs.length, 0);
['Quick Mark', 'Add Registrants in Bulk', 'Log Volunteer Hours', 'Log a Private Session', 'Sign-In Sheet',
 'Open the Sign-In App', 'Update Everything Now', 'Why did nothing happen'].forEach(word =>
  check(`desk carries "${word}"`, desk.items.some(l => l.indexOf(word) >= 0), true));
check('the Health panel is at the top of Coordinator', full.byName(COORD).fns[0], 'menu_showHealthPanel');
// One item is deliberately on two menus: the Health panel (Coordinator, and
// Admin ▸ Reports where the reports used to be). Everything else is on one.
const dupes = full.names.filter((n, i) => full.names.indexOf(n) !== i);
check('each action appears on the menus once (bar the Health panel)', dupes, ['menu_showHealthPanel']);

// --- NOTHING BECAME UNREACHABLE. --------------------------------------------
// Every action on the menu before R4 (taken from collectMenuItemLabels_() on
// the base branch), and the escape hatch. Each must be reachable by SOME role:
// on a menu that role is built, on the separate Sign-In App menu, or as a
// Health panel check.
const BEFORE_R4 = [
  'showQuickMarkDialog',
  'showBulkRegistrantsDialog',
  'showVolunteerHoursDialog',
  'showPrivateSessionDialog',
  'showQuestionBuilderDialog',
  'syncEverythingNow',
  'reportWhyNothingHappened',
  'showLunchMenuImportDialog',
  'pushLunchMenuToForms',
  'refreshLunchSignUpForms',
  'openRegularNeedsTab',
  'showMemberRollImportDialog',
  'dedupeMemberRollNow',
  'showDuplicateRegistrationsDialog',
  'showRegistrationReviewDialog',
  'openVolunteerHoursTab',
  'openPrivateSessionsTab',
  'removeMarkedRegistrants',
  'showRestoreRegistrantsFromCopyDialog',
  'showRestoreRegistrantsFromLedgerDialog',
  'showProgramLeaderSheetDialog',
  'refreshProgramLeaderSheetsNow',
  'sendProgramLeaderRosterAlertsNow',
  'sendProgramLeaderDayDigestsNow',
  'showAssistanceScheduleDialog',
  'showCalendarInviteDialog',
  'sendRegistrantRemindersNow',
  'showProgramReviewDialog',
  'pushProgramQuestionsToForms',
  'showFixOneFormDialog',
  'applyProgramTagChangesToCalendar',
  'showBulkWaitlistOnlyDialog',
  'showAssistanceReviewDialog',
  'showTimeBlockDialog',
  'rebuildAssistanceFormsNow',
  'linkProgramAcrossLocations',
  'showRepointSessionsDialog',
  'showSignInSheetDialog',
  'showCheckInPageDialog',
  'refreshMyPermissions',
  'syncCalendars',
  'syncRegistrations',
  'rebuildQuickMarkListsNow',
  'renderProgramMonthSheetNow',
  'flushCheckInQueueNow',
  'refreshMetricsTabNow',
  'snapshotRegistrantsNow',
  'showAllPastRows',
  'resizeAllSheets',
  'rebuildLayoutFromSheet',
  'rewriteEventRegistrationLinks',
  'openUpAllFormSharing',
  'openUpAllGeneratedFileSharing',
  'showEventTagInspectorDialog',
  'showWeekendEventLoaderDialog',
  'showFormLinkDoctorDialog',
  'showUnopenableFormsDialog',
  'repairDashboardLinks',
  'showForkedFormsDialog',
  'repairFormRoutingNow',
  'showReimportFormDialog',
  'backfillSignInSheetRegistry',
  'organizeGeneratedFiles',
  'removeAdminGuestsFromCalendarEvents',
  'backfillLedgerFromTab',
  'bootstrapCalendars',
  'showColumnWidthDialog',
  'saveCurrentTabOrder',
  'clearSavedTabOrder',
  'showTriggerStatus',
  'writeTriggers',
  'clearStuckBackgroundJobs',
  'takeOverTriggerOwnership',
  'releaseMyTriggers',
  'previewLegacyTabMerge',
  'reportLeaderSheetRosters',
  'showLedgerVerificationReport',
  'reportLedgerGrowth',
  'reportOrphanedSessionRows',
  'reportDuplicateSessionRows',
  'reportArchivableMonths',
  'reportUnimportedForms',
  'reportMissingRegistrations',
  'reportOrphanedProgramQuestions',
  'reportVolunteerHours',
  'reportPrivateSessions',
  'sendOfficeDigestNow',
  'reportScriptPropertiesUsage',
  'showMenuUsageReport',
  'resetMenuUsage',
  'rebuildAllFormsInPlace',
  'destroyAndRebuildAllForms',
  'showDeleteRegistrationsDialog',
  'removeOrphanedSessionRows',
  'removeDuplicateSessionRows',
  'compactRegistrationLedger',
  'removeAllCalendarInvitesFromEvents',
  'resetRemoveAllCalendarInvitesSweep',
  'openSignInApp',
  'showAdminMenu'
];
const signInMenu = (() => {
  const names = [];
  sandbox.buildSignInAppMenu({ createMenu: () => {
    const m = { addItem: (l, fn) => { names.push(fn); return m; }, addSeparator: () => m,
      addSubMenu: () => m, addToUi: () => {} };
    return m;
  } });
  return names;
})();
const reachable = new Set();
['admin', 'staff', 'unknown'].forEach(role => {
  build(role !== 'staff', role).names.forEach(fn => reachable.add(fn.slice(5)));
});
signInMenu.forEach(fn => reachable.add(fn.slice(5)));
const healthActions = vm.runInContext('HEALTH_CHECKS.map(c => c.action)', sandbox);
healthActions.forEach(a => reachable.add(a));
check('every pre-R4 menu action is still reachable by some role', BEFORE_R4.filter(a => !reachable.has(a)), []);
check('every pre-R4 action still exists', BEFORE_R4.filter(a => typeof sandbox[a] !== 'function'), []);
const staffReach = new Set(build(false, 'staff').names.map(fn => fn.slice(5)).concat(healthActions, signInMenu.map(f => f.slice(5))));
check('a non-admin still reaches the Doctor, unopenable forms and the stuck-job hatch',
  ['showFormLinkDoctorDialog', 'showUnopenableFormsDialog', 'clearStuckBackgroundJobs'].filter(a => !staffReach.has(a)), []);
check('every Health check names an existing action', healthActions.filter(a => typeof sandbox[a] !== 'function'), []);
const reportsOnMenu = ['reportVolunteerHours', 'showTriggerStatus', 'reportMissingRegistrations', 'showMenuUsageReport']
  .filter(a => full.names.includes('menu_' + a));
check('the read-only reports left the menu for the panel', reportsOnMenu, []);

// --- THE ROLE TABLE. ---------------------------------------------------------
const role = (email, admins) => sandbox.menuRoleForEmail(email, admins);
check('blank address is unknown, never staff', role('', ['a@x.org']), 'unknown');
check('admin address is admin (case-insensitive)', role(' A@X.org ', ['a@x.org']), 'admin');
check('anyone else is staff', role('b@x.org', ['a@x.org']), 'staff');
check('menusForRole(staff)', sandbox.menusForRole('staff').map(r => r.menu), ['desk', 'coordinator']);
check('menusForRole(unknown) includes admin', sandbox.menusForRole('unknown').map(r => r.menu), ['desk', 'coordinator', 'admin']);
check('a role nobody wrote down is treated as unknown', sandbox.menusForRole(undefined).map(r => r.menu), ['desk', 'coordinator', 'admin']);
{
  const saved = { Session: sandbox.Session, list: sandbox.listAuthorizedAdminEmails, cfg: sandbox.getAllAdminNotificationEmails };
  const setViewer = (active, effective) => {
    sandbox.Session = {
      getScriptTimeZone: () => 'America/New_York',
      getActiveUser: () => { if (active instanceof Error) throw active; return { getEmail: () => active }; },
      getEffectiveUser: () => { if (effective instanceof Error) throw effective; return { getEmail: () => effective }; }
    };
  };
  sandbox.listAuthorizedAdminEmails = () => ['owner@x.org'];
  sandbox.getAllAdminNotificationEmails = () => ['office@x.org'];
  setViewer('', '');
  check('onOpen-style blank account resolves to unknown', sandbox.resolveMenuRole(), 'unknown');
  setViewer(new Error('no scope'), new Error('no scope'));
  check('Session throwing resolves to unknown', sandbox.resolveMenuRole(), 'unknown');
  setViewer('owner@x.org', '');
  check('the hardcoded/owner list is admin', sandbox.resolveMenuRole(), 'admin');
  setViewer('', 'office@x.org');
  check('falls back to the effective user; a Config admin address is admin', sandbox.resolveMenuRole(), 'admin');
  setViewer('desk@x.org', 'desk@x.org');
  check('anybody else is staff', sandbox.resolveMenuRole(), 'staff');
  sandbox.getAllAdminNotificationEmails = () => { throw new Error('Config mid-rebuild'); };
  setViewer('owner@x.org', '');
  check('Config unreadable costs only its own half', sandbox.resolveMenuRole(), 'admin');
  sandbox.listAuthorizedAdminEmails = () => { throw new Error('boom'); };
  setViewer('desk@x.org', '');
  check('no admin list at all still resolves (staff, not a throw)', sandbox.resolveMenuRole(), 'staff');

  // onOpen builds by role.
  sandbox.listAuthorizedAdminEmails = () => ['owner@x.org'];
  sandbox.getAllAdminNotificationEmails = () => [];
  const openWith = () => {
    const roots = [];
    const ui = { createMenu: name => {
      const m = { addItem: () => m, addSeparator: () => m, addSubMenu: () => m, addToUi: () => roots.push(name) };
      return m;
    } };
    const prev = sandbox.SpreadsheetApp;
    sandbox.SpreadsheetApp = { getActiveSpreadsheet: () => null, getUi: () => ui };
    sandbox.migrateLegacySheetNames = () => {};
    try { sandbox.onOpen(); } finally { sandbox.SpreadsheetApp = prev; }
    return roots;
  };
  setViewer('', '');
  check('onOpen, account invisible: Admin is built', openWith().indexOf(ADMIN) >= 0, true);
  setViewer('desk@x.org', '');
  check('onOpen, identified non-admin: no Admin menu', openWith().indexOf(ADMIN) >= 0, false);
  setViewer('owner@x.org', '');
  check('onOpen, admin: Admin is built', openWith().indexOf(ADMIN) >= 0, true);
  check('onOpen still adds the Sign-In App menu', openWith().indexOf(vm.runInContext('SIGN_IN_APP_MENU_NAME', sandbox)) >= 0, true);

  sandbox.Session = saved.Session;
  sandbox.listAuthorizedAdminEmails = saved.list;
  sandbox.getAllAdminNotificationEmails = saved.cfg;
}

// --- A click counts. --------------------------------------------------------
let ran = 0;
sandbox.showVolunteerHoursDialog = () => { ran++; return 'shown'; };
sandbox.reportWhyNothingHappened = () => { ran++; };
check('the wrapper returns what the action returns', sandbox.menu_showVolunteerHoursDialog(), 'shown');
sandbox.menu_showVolunteerHoursDialog();
sandbox.menu_reportWhyNothingHappened();
const stored = JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]);
check('two presses count two', stored.items.showVolunteerHoursDialog[0], 2);
check('one press counts one', stored.items.reportWhyNothingHappened[0], 1);
check('last-used is stamped', stored.items.showVolunteerHoursDialog[1] > 0, true);
check('the actions ran', ran, 3);

const report = sandbox.describeMenuUsage();
check('report lists the most-pressed first',
  report.indexOf('2 × ') >= 0 && report.indexOf('2 × ') < report.indexOf('1 × '), true);
check('report uses the menu label', report.indexOf('Log Volunteer Hours') >= 0, true);
check('report lists never-pressed items', /Never pressed \(\d+\)/.test(report), true);
check('report labels carry their menu path', report.indexOf('Admin ▸') >= 0, true);
check('a report that moved to the panel is labelled under the panel', report.indexOf('🩺 Health ▸') >= 0, true);

// --- The separate Sign-In App menu. -----------------------------------------
{
  const names = [];
  let root = null;
  function menu(name) {
    const m = { name, items: [], subs: [] };
    m.addItem = (label, fn) => { names.push(fn); m.items.push(label); return m; };
    m.addSeparator = () => m;
    m.addSubMenu = child => { m.subs.push(child); return m; };
    m.addToUi = () => { root = m; };
    return m;
  }
  sandbox.buildSignInAppMenu({ createMenu: menu });
  check('sign-in app menu is its own top-level menu', !!root && full.roots.every(r => r.name !== root.name), true);
  check('sign-in app menu opens the app through a wrapper', names, ['menu_openSignInApp']);
  check('the wrapper exists and calls the action',
    typeof sandbox.menu_openSignInApp === 'function' && typeof sandbox.openSignInApp === 'function', true);
  check('usage report labels the sign-in app item',
    sandbox.describeMenuUsage().indexOf('Open the Sign-In App') >= 0, true);
  const page = sandbox.buildSignInAppLauncherHtml('https://x.test/exec?a=1&b=</script>',
    [{ location: "St. John's <Hall>", url: 'https://x.test/exec?location=St' }]);
  check('launcher calls window.open', page.indexOf('window.open(') >= 0, true);
  check('launcher cannot be ended by the URL', page.indexOf('b=</script>') < 0, true);
  check('launcher escapes a building name', page.indexOf('&lt;Hall&gt;') >= 0 && page.indexOf('<Hall>') < 0, true);
}

// --- Tracking never costs the click. ----------------------------------------
props[sandbox.MENU_USAGE_PROP_KEY] = '{not json';
sandbox.menu_showVolunteerHoursDialog();
check('garbage in the property: action still ran', ran, 4);
check('garbage in the property: counting starts again',
  JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]).items.showVolunteerHoursDialog[0], 1);
propsBroken = true;
let threw = null;
try { sandbox.menu_showVolunteerHoursDialog(); } catch (err) { threw = String(err); }
check('properties throwing: the click does not throw', threw, null);
check('properties throwing: action still ran', ran, 5);
propsBroken = false;

// --- Reset (confirmed unattended is "no", so pin the confirm). ----------------
sandbox.confirmConsequentialAction = () => true;
sandbox.resetMenuUsage();
check('reset empties the counts', JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]).items, {});

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall menu usage checks passed');
