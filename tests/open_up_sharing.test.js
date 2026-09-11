// EVERY FILE THIS SYSTEM MADE, OPENED BACK UP (section 97).
//
// The fault this repairs is silent by construction: a file created by one
// account and read every hour by another simply stops being readable, and
// nothing in the workbook looks broken. So what is pinned here is the LIST —
// which artifacts the sweep claims, because one this never names is one nobody
// will ever think to repair by hand:
//
//   * the forms named by the session table AND by the stored registry, which
//     disagree in both directions;
//   * the lunch sign-up forms, the template, the membership application;
//   * the registrant sheets, the sign-in documents, the form images;
//   * the folders they live in — with link sharing OFF, because a
//     link-editable folder hands over everything inside it.
//
// Plus the two behaviors underneath it: that `linkSharing: false` really does
// skip setSharing() while still adding the named editors, and that a tick
// column which cannot be drawn as checkboxes is a log line rather than a throw
// that abandons a half-written roster (`46`).
const vm = require('vm');

const src = require('./helpers/source').readSource();

const sharing = { setSharing: [], editors: [] };

function driveFile(id) {
  return {
    getId: () => id,
    getName: () => `file ${id}`,
    addEditor: email => { sharing.editors.push(`${id}|${email}`); },
    setSharing: (access, permission) => { sharing.setSharing.push(`${id}|${access}|${permission}`); }
  };
}

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) =>
      (pattern === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : d.toISOString()),
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    getActive: () => null,
    newDataValidation: () => ({ requireCheckbox: function () { return this; }, build: () => ({}) })
  },
  FormApp: { ItemType: {} },
  CalendarApp: {},
  DriveApp: {
    // getFileById() THROWS on a folder id in Apps Script, which is why the
    // opener has to know which it is holding. The stub refuses the same way.
    getFileById: id => {
      if (/_FOLDER$/.test(id)) throw new Error('Exception: Unexpected error while getting the method or property getFileById');
      return driveFile(id);
    },
    getFolderById: id => driveFile(id),
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' },
    Permission: { EDIT: 'EDIT' }
  },
  HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.collectGeneratedArtifactTargets = collectGeneratedArtifactTargets;
this.openUpFileToAnyoneWithLink = openUpFileToAnyoneWithLink;
this.applyLeaderFlagCheckboxes_ = applyLeaderFlagCheckboxes_;
// The registries and folder lookups are stubbed IN the script's own scope, so
// the calls inside collectGeneratedArtifactTargets() resolve to these.
this.__stub = function (name, fn) { this[name] = fn; eval(name + ' = fn;'); };
`, sandbox, { filename: 'sharing.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- what the sweep claims --------------------------------------------------

const folder = (id, name) => ({ getId: () => id, getName: () => name });
const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };

sandbox.__stub('getOrCreateSheet', () => ({}));
sandbox.__stub('getSectionedRows', () => [
  ['E1', 'FORM_ROW_ONLY'],
  ['E2', 'FORM_BOTH']
]);
sandbox.__stub('getIndexMap', () => ({ Form_ID: 1 }));
sandbox.__stub('getPersistentFormRegistry', () => ({ 'Chess::2026-04': 'FORM_BOTH', 'Yoga::FIXED': 'FORM_REGISTRY_ONLY' }));
sandbox.__stub('getLunchOnlyFormLinks', () => ({ 'Ashbridge|2026-04': { formId: 'LUNCH_FORM' } }));
sandbox.__stub('getOrCreateTemplateForm', () => ({ getId: () => 'TEMPLATE' }));
sandbox.__stub('getMembershipFormId', () => 'MEMBERSHIP');
sandbox.__stub('getProgramLeaderSheetRegistry', () => ({ 'chess|ashbridge': { fileId: 'LEADER_SHEET', title: 'Chess' } }));
sandbox.__stub('getSignInSheetRegistry', () => ({ '2026-04-01|ashbridge': { fileId: 'SIGN_IN_DOC' } }));
sandbox.__stub('getOrCreateFormImageFolder', () => Object.assign(folder('IMG_FOLDER', 'Form Images'), {
  getFiles: () => iter([folder('IMAGE_1', 'poster.png')])
}));
sandbox.__stub('getSystemRootFolder', () => folder('ROOT_FOLDER', 'Program Registration System'));
sandbox.__stub('getOrCreateFormsFolder', () => folder('FORMS_FOLDER', 'Forms'));
sandbox.__stub('getOrCreateSignInSheetDocFolder', () => folder('DOC_FOLDER', 'Sign-In Sheets'));
sandbox.__stub('getOrCreateSignInSheetFolder', () => folder('PDF_FOLDER', 'Printed Sign-In Sheets'));
sandbox.__stub('getOrCreateProgramLeaderSheetFolder', () => folder('LEADER_FOLDER', 'Registrant Sheets'));

const targets = sandbox.collectGeneratedArtifactTargets();
const ids = targets.map(t => t.id);

check('every kind of artifact is claimed', ids, [
  'FORM_ROW_ONLY', 'FORM_BOTH', 'FORM_REGISTRY_ONLY', 'LUNCH_FORM', 'TEMPLATE', 'MEMBERSHIP',
  'LEADER_SHEET', 'SIGN_IN_DOC', 'IMAGE_1',
  'ROOT_FOLDER', 'FORMS_FOLDER', 'DOC_FOLDER', 'PDF_FOLDER', 'LEADER_FOLDER', 'IMG_FOLDER'
]);

check('a form named twice is opened once',
  ids.filter(id => id === 'FORM_BOTH').length, 1);

check('folders are named editors only, never link-shared',
  targets.filter(t => t.folder).map(t => t.id),
  ['ROOT_FOLDER', 'FORMS_FOLDER', 'DOC_FOLDER', 'PDF_FOLDER', 'LEADER_FOLDER', 'IMG_FOLDER']);

// The pictures INSIDE it are link-shared like any other file; the folder
// itself is not, and it is claimed exactly once despite being read twice.
check('the image folder is claimed once, as a folder',
  ids.filter(id => id === 'IMG_FOLDER').length, 1);

// A registry that throws costs its own entries and nothing else — the sweep is
// the repair for a half-broken workbook, so it must not need a whole one.
sandbox.__stub('getSignInSheetRegistry', () => { throw new Error('unreadable'); });
check('an unreadable registry does not lose the rest',
  sandbox.collectGeneratedArtifactTargets().map(t => t.id).indexOf('LEADER_SHEET') !== -1, true);

// --- linkSharing: false -----------------------------------------------------

sandbox.__stub('listAuthorizedAdminEmails', () => ['admin@example.org']);
sandbox.__stub('getTriggerOwner', () => 'owner@example.org');
sandbox.__stub('getCurrentUserEmail', () => 'owner@example.org');
sandbox.__stub('getAllAdminNotificationEmails', () => []);

sharing.setSharing.length = 0;
sharing.editors.length = 0;
const folderOutcome = sandbox.openUpFileToAnyoneWithLink('FORMS_FOLDER', 'the forms folder', { folder: true });
check('a folder gets the named editors', sharing.editors, ['FORMS_FOLDER|admin@example.org', 'FORMS_FOLDER|owner@example.org']);
check('a folder is never link-shared', sharing.setSharing, []);
check('a folder reports no problem', folderOutcome.problems, []);

sharing.setSharing.length = 0;
const fileOutcome = sandbox.openUpFileToAnyoneWithLink('FORM_BOTH', 'a registration form');
check('a file still gets link sharing', sharing.setSharing, ['FORM_BOTH|ANYONE_WITH_LINK|EDIT']);
check('a file reports it was opened', fileOutcome.openedUp, true);

// --- a tick column that will not draw --------------------------------------

// A RangeList has insertCheckboxes() and NOT setDataValidation(), which is the
// whole reason this helper exists: the batched write called the missing one and
// threw "ticks.setDataValidation is not a function" on every sheet, every hour,
// leaving the roster half-written with its tick columns reading TRUE/FALSE.
const drawn = [];
sandbox.applyLeaderFlagCheckboxes_('Contacted', {
  insertCheckboxes: () => { drawn.push('insertCheckboxes'); },
  setHorizontalAlignment: () => { drawn.push('aligned'); }
});
check('a tick column is drawn with the call a RangeList actually has',
  drawn, ['insertCheckboxes', 'aligned']);

let threw = false;
try {
  sandbox.applyLeaderFlagCheckboxes_('Contacted', {
    insertCheckboxes: () => { throw new Error('Exception: You do not have permission'); },
    setHorizontalAlignment: () => {}
  });
} catch (err) {
  threw = true;
}
check('a refused checkbox column never abandons the roster', threw, false);

// A column the headers do not name arrives as null rather than as a NaN column
// index, and is skipped.
sandbox.applyLeaderFlagCheckboxes_('Confirmed', null);
check('a column the headers do not have is skipped', true, true);

console.log(failures === 0 ? '\nall passed' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
