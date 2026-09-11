// A FORM_ID NAMING A FORM THAT WILL NOT OPEN IS EVIDENCE, NOT A DEAD END.
//
// The repair resolved one candidate — `registry[key] || majority(key)` — opened
// it, and gave up on the row if it would not open. That is backwards for the
// commonest way a dashboard goes wrong, and the two halves compounded: a
// workbook whose registry has no entry for a key falls through to the vote, the
// vote is the rows saying what they already say, so a whole program pointing at
// one DELETED form resolved to that same deleted form, failed to open, and was
// skipped — and the repair then reported that every link already matched the
// registry. It had not looked.
//
// What is pinned here:
//   • a healthy workbook resolves on the first candidate and behaves exactly as
//     before — this must not change what a working repair does;
//   • a dead registry form falls through to the row's own EDIT link, which
//     names a form where a published link cannot;
//   • the candidate is always OPENED and asked for its URLs — never harvested
//     from the cell, which is the fortnight-long bug the file's banner records;
//   • a run that writes nothing says which of the four reasons applied.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const opened = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd'
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : String(d)),
    sleep: () => {},
    computeDigest: () => [1, 2, 3, 4, 5, 6],
    DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/New_York' }),
    getActive: () => null, flush: () => {}
  },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.planDashboardLinkRepair = planDashboardLinkRepair;
this.describeEmptyLinkRepair = describeEmptyLinkRepair;
this.log = function () {};
this.__opened = ${JSON.stringify(opened)};

// Only these two forms exist. DEAD is in the trash / gone.
this.setLive = function (live) {
  openFormCached = function (id) {
    if (!live[id]) throw new Error('Form not found: ' + id);
    __opened.push(id);
    return {
      getId: function () { return id; },
      getEditUrl: function () { return 'https://docs.google.com/forms/d/' + id + '/edit'; }
    };
  };
  buildRegistrationUrl = function (form) {
    // A PUBLISHED url carries its own identifier, which is the whole reason it
    // cannot be read backwards into a form id.
    return 'https://docs.google.com/forms/d/e/PUB-' + form.getId() + '/viewform';
  };
};
this.setRegistry = function (r) { getPersistentFormRegistry = function () { return r; }; };
getSharedFormIdSet = function () { return new Set(); };
`, sandbox, { filename: 'program.gs' });

// Form ids are 30+ characters in the real world, and extractFormId() insists on
// at least 20 — a shorter fixture would pass through the code under test and
// never be recognized as naming a form.
const GOOD = '1GoodFormAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DEAD = '1DeadFormBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const ROLL = '1RollingFormCCCCCCCCCCCCCCCCCCCCCCCCCC';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// A stand-in session tab: two rows of one appointment program, both pointing at
// a form that has been deleted, both carrying links to the form that replaced it.
const COLS = ['Event_Date', 'Event_ID', 'Calendar_Source', 'Clean_Title', 'Location',
  'Type_Tag', 'Personalized_Assistance', 'Form_ID', 'Form_Response_Link', 'Edit_Form_Link'];
const viewFormula = id => `=HYPERLINK("https://docs.google.com/forms/d/e/PUB-${id}/viewform","View Live Form")`;
const editFormula = id => `=HYPERLINK("https://docs.google.com/forms/d/${id}/edit","Edit Form Settings")`;

function fakeSheet(rows) {
  // One header row at 1, data from row 2. getRange(r, c, n, w) is answered from
  // the arrays below; the repair reads a column at a time.
  const grid = rows.map(r => COLS.map(c => (c === 'Form_Response_Link' || c === 'Edit_Form_Link') ? '' : r[c]));
  const formulas = rows.map(r => COLS.map(c =>
    c === 'Form_Response_Link' ? viewFormula(r.linkForm)
      : c === 'Edit_Form_Link' ? editFormula(r.linkForm) : ''));
  return { grid, formulas };
}

const baseRow = (i, formId, linkForm) => ({
  Event_Date: new Date(2026, 9, 13 + i, 10, 0),
  Event_ID: 'evt' + i,
  Calendar_Source: 'cal1',
  Clean_Title: 'Computer Tech Support',
  Location: 'Narberth',
  Type_Tag: '',
  Personalized_Assistance: true,
  Form_ID: formId,
  linkForm: linkForm
});

// The repair reads the sheet through findProgramSessionHeaderRows/getZoneDataRange,
// which is more plumbing than this test wants to reproduce. Stub the reader layer
// and let the resolution logic — the part under test — run for real.
function runPlan(rows, registry) {
  const f = fakeSheet(rows);
  vm.runInContext(`
    findProgramSessionHeaderRows = function () { return [1]; };
    getHeaderMapAt = function () {
      var m = {}; ${JSON.stringify(COLS)}.forEach(function (c, i) { m[c] = i + 1; }); return m;
    };
    getZoneDataRange = function () { return { start: 2, count: ${rows.length} }; };
    computeEventId = function (src, title, dateKey) { return 'evt' + (Number(dateKey.slice(-2)) - 13); };
    __GRID = ${JSON.stringify(f.grid.map(r => r.map(v => (v instanceof Date ? null : v))))};
  `, sandbox);
  // Dates cannot cross the JSON boundary, so put them back by reference.
  sandbox.__GRID.forEach((r, i) => { r[0] = rows[i].Event_Date; });
  const grid = sandbox.__GRID;
  const formulas = f.formulas;
  const sheet = {
    getRange: (r, c, n, w) => ({
      getValues: () => grid.slice(r - 2, r - 2 + n).map(row => [row[c - 1]]),
      getFormulas: () => formulas.slice(r - 2, r - 2 + n).map(row => [row[c - 1]])
    })
  };
  sandbox.setRegistry(registry);
  return sandbox.planDashboardLinkRepair(sheet);
}

// --- the healthy case must not change ---------------------------------------
{
  sandbox.__opened.length = 0;
  sandbox.setLive({ [GOOD]: true });
  const out = runPlan([baseRow(0, GOOD, GOOD), baseRow(1, GOOD, GOOD)],
    { 'cal1::Computer Tech Support::ASSIST': GOOD });
  check('a dashboard that agrees with the registry needs no repair', out.stats.willFix, 0);
  check('...and every row is counted as already right', out.stats.alreadyRight, 2);
  check('...having opened exactly one form', sandbox.__opened.length, 1);
  check('no row fell past its first candidate', out.stats.deadForm, 0);
}

// --- the bug: the registry names a form that is gone -------------------------
{
  sandbox.__opened.length = 0;
  sandbox.setLive({ [ROLL]: true }); // the old month form is NOT in Drive
  const out = runPlan([baseRow(0, DEAD, ROLL), baseRow(1, DEAD, ROLL)],
    { 'cal1::Computer Tech Support::ASSIST': DEAD });
  check('both rows are repaired rather than skipped', out.stats.willFix, 2);
  check('...and none is written off as having no form', out.stats.noForm, 0);
  check('the fall-through to a live form is counted', out.stats.deadForm, 2);
  check('the fault is named as pointing at the wrong form', out.stats.wrongForm, 2);
  check('the plan moves them onto the form the EDIT link names',
    out.plan.map(p => [p.wasFormId, p.formId]), [[DEAD, ROLL], [DEAD, ROLL]]);
  // THE BANNED SHORTCUT. The published URL written must come from opening the
  // form, never from the cell — a published link carries an identifier no file
  // id can be read back out of.
  check('the live link written was read from the form, not lifted off the row',
    out.plan[0].view.indexOf('PUB-' + ROLL) !== -1, true);
  check('...and the form was actually opened to get it', sandbox.__opened.indexOf(ROLL) !== -1, true);
}

// --- the registry knows nothing, and the rows can only vote for themselves ---
{
  sandbox.__opened.length = 0;
  sandbox.setLive({ [ROLL]: true });
  const out = runPlan([baseRow(0, DEAD, ROLL)], {});
  check('a missing registry entry is counted', out.stats.noRegistryEntry, 1);
  check('...and the row is still rescued through its edit link', out.stats.willFix, 1);
}

// --- nothing recoverable: say so, do not report success ----------------------
{
  sandbox.__opened.length = 0;
  sandbox.setLive({}); // nothing opens at all
  const out = runPlan([baseRow(0, DEAD, DEAD)], {});
  check('a row whose every candidate is gone is left alone', out.stats.willFix, 0);
  check('...and counted as having no form to point at', out.stats.noForm, 1);

  const said = sandbox.describeEmptyLinkRepair(out.stats);
  check('the report does NOT claim every link already matched',
    said.indexOf('already matches') === -1 && said.indexOf('Nothing was written') === 0, true);
  check('it names the forms that could not be opened', said.indexOf('could NOT be opened') !== -1, true);
  check('it names the missing registry entries', said.indexOf('no entry in the form registry') !== -1, true);
  check('and it points at the tool that can still do it by hand',
    said.indexOf('Move Sessions to Another Form') !== -1, true);

  const clean = sandbox.describeEmptyLinkRepair(
    { scanned: 9, alreadyRight: 9, noForm: 0, noRegistryEntry: 0, misaligned: 0 });
  check('a genuinely clean tab still reads as good news', clean.indexOf('nothing to repair') !== -1, true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
