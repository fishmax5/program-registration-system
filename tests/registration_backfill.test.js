// A FORM NOBODY IS IMPORTING, AND THE WAY BACK FROM ONE.
//
// The import walks the Form_ID COLUMN and nothing else, and reads each form
// from LAST_FORM_SYNC_TIME. Put those two together and there is a failure with
// no output at all: a session row whose Form_ID names a form that has been
// deleted, while the link beside it — the one staff hand out, the one filling
// with responses — names a form the import has never heard of. Nothing opens
// it, so nothing can report that it is going unread.
//
// What is pinned here:
//   • a marked form is read from the BEGINNING and an unmarked one from the
//     sync clock — the whole mechanism of a re-import;
//   • marking is idempotent and clearing is precise, because the mark is what
//     stops a backfill being either skipped or repeated forever;
//   • the "could not be read" note names the programs, the span of dates, and
//     the registry's disagreement with the column — the three facts that turn
//     an unactionable line into the two-step fix;
//   • a form the registry knows and no session row names IS reported when it
//     holds responses, and is NOT reported when it holds none;
//   • the re-import picker offers those forms FIRST, since they are the reason
//     somebody opened it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const store = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'MMMM yyyy') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (fmt === 'EEE, MMM d, yyyy') return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
      return d.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      deleteProperty: k => { delete store[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.backfillSinceFor = backfillSinceFor;
this.markFormForBackfill = markFormForBackfill;
this.pendingBackfillFormIds = pendingBackfillFormIds;
this.isFormMarkedForBackfill = isFormMarkedForBackfill;
this.clearBackfillMarks = clearBackfillMarks;
this.describeUnimportedFormPointer = describeUnimportedFormPointer;
this.findUnimportedForms = findUnimportedForms;
this.listFormsForReimport = listFormsForReimport;
this.classifyReimportRegistryEntry_ = classifyReimportRegistryEntry_;
this.registryKeySpanMonthKey_ = registryKeySpanMonthKey_;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.SHEET_NAMES = SHEET_NAMES;
this.log = function () {};
this.setRegistry = function (r) { getPersistentFormRegistry = function () { return r; }; };
this.setForms = function (forms) {
  openFormCached = function (id) {
    if (!forms[id]) throw new Error('Form not found: ' + id);
    return {
      getId: function () { return id; },
      getTitle: function () { return forms[id].title; },
      getResponses: function () {
        return (forms[id].responses || []).map(function (t) {
          return { getTimestamp: function () { return t; } };
        });
      }
    };
  };
};
this.setRows = function (rows) { getSectionedRows = function () { return rows; }; };
describeFormLink = function (id) { return 'FORM(' + id + ')'; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const map = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
const sessionRow = fields => {
  const row = new Array(sandbox.HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(fields).forEach(k => { if (map[k] !== undefined) row[map[k]] = fields[k]; });
  return row;
};

// --- the mark, and the read window it changes --------------------------------
{
  const lastSync = new Date('2026-09-01T00:00:00Z');
  check('an unmarked form is read from the sync clock',
    sandbox.backfillSinceFor('formA', lastSync).getTime(), lastSync.getTime());

  check('marking a form is news the first time', sandbox.markFormForBackfill('formA'), true);
  check('...and not the second — marking twice is not marking harder',
    sandbox.markFormForBackfill('formA'), false);
  check('a blank id marks nothing', sandbox.markFormForBackfill('   '), false);

  check('a marked form is read from the BEGINNING, not from the clock',
    sandbox.backfillSinceFor('formA', lastSync).getTime(), 0);
  check('and the sync gets it in its work list', sandbox.pendingBackfillFormIds(), ['formA']);

  // THE POINT OF READING EVERYTHING rather than from a guessed-at date: a
  // backfill is asked for precisely because nobody knows how long the form has
  // been going unread.
  check('the beginning really is the epoch, whatever the clock says',
    sandbox.backfillSinceFor('formA', new Date('1999-01-01T00:00:00Z')).getTime(), 0);

  sandbox.markFormForBackfill('formB');
  check('clearing one mark leaves the other alone',
    sandbox.clearBackfillMarks(['formA']) === 1 && sandbox.pendingBackfillFormIds(), ['formB']);
  check('clearing a form that was never marked changes nothing',
    sandbox.clearBackfillMarks(['nobody']), 0);
  sandbox.clearBackfillMarks(['formB']);
  check('and an empty list stores nothing at all', sandbox.pendingBackfillFormIds(), []);
  check('a cleared form goes back to the sync clock',
    sandbox.backfillSinceFor('formA', lastSync).getTime(), lastSync.getTime());
}

// --- what the admin digest says when a form will not open --------------------
{
  // The real shape of the fault: two months of one appointment program still
  // naming a form that has been deleted, while the registry — keyed ::ASSIST,
  // because the program is an appointment program — names the rolling form
  // they were supposed to be moved onto.
  const rows = [
    sessionRow({ Event_ID: 'e1', Event_Date: new Date(2026, 9, 13, 10, 0), Calendar_Source: 'cal1',
      Clean_Title: 'Computer Tech Support', Location: 'Narberth', Form_ID: 'deadForm',
      Personalized_Assistance: true }),
    sessionRow({ Event_ID: 'e2', Event_Date: new Date(2026, 10, 10, 10, 0), Calendar_Source: 'cal1',
      Clean_Title: 'Computer Tech Support', Location: 'Narberth', Form_ID: 'deadForm',
      Personalized_Assistance: true }),
    // A different program on a healthy form — it must not be counted in.
    sessionRow({ Event_ID: 'e3', Event_Date: new Date(2026, 9, 14, 10, 0), Calendar_Source: 'cal1',
      Clean_Title: 'Chair Yoga', Location: 'Narberth', Form_ID: 'liveYoga' })
  ];
  sandbox.setRegistry({ 'cal1::Computer Tech Support::ASSIST': 'rollingForm' });
  sandbox.setForms({ rollingForm: { title: 'Computer Tech Support', responses: [] } });

  const note = sandbox.describeUnimportedFormPointer('deadForm', rows, map);
  check('it counts only the rows that name the unreadable form',
    note.indexOf('2 session row(s) point at it') !== -1, true);
  check('it names the program', note.indexOf('Computer Tech Support') !== -1, true);
  check('...and not the program on the healthy form', note.indexOf('Chair Yoga'), -1);
  check('it gives the span of dates that have stopped importing',
    note.indexOf('Oct 13, 2026') !== -1 && note.indexOf('Nov 10, 2026') !== -1, true);
  check('it says the registrations are not arriving, in those words',
    note.indexOf('NOT being imported') !== -1, true);
  // THE SIGNATURE OF THIS BUG, and free to check: the registry and the column
  // disagree.
  check('it names the form the registry says those sessions belong on',
    note.indexOf('FORM(rollingForm)') !== -1, true);
  check('it says the column and the registry disagree',
    note.indexOf('disagree') !== -1, true);
  // THE HALF THAT IS EASY TO MISS: repairing the pointer collects nothing
  // already submitted, because those responses are behind the sync clock.
  check('and it says repairing the pointer is only half the fix',
    note.indexOf('Re-import') !== -1 && note.indexOf('does NOT recover') !== -1, true);

  const none = sandbox.describeUnimportedFormPointer('strayForm', rows, map);
  check('a form no row points at is not reported as an outage',
    none.indexOf('no program is waiting on it') !== -1, true);
}

// --- the standing report -----------------------------------------------------
{
  const rows = [
    sessionRow({ Event_ID: 'e1', Event_Date: new Date(2026, 9, 13, 10, 0), Calendar_Source: 'cal1',
      Clean_Title: 'Computer Tech Support', Location: 'Narberth', Form_ID: 'deadForm',
      Personalized_Assistance: true })
  ];
  sandbox.setRows(rows);
  sandbox.setRegistry({
    'cal1::Computer Tech Support::ASSIST': 'rollingForm',
    'cal1::Chair Yoga::October 2026': 'quietForm',
    'cal1::Knitting::October 2026': 'emptyForm'
  });
  sandbox.setForms({
    rollingForm: { title: 'Computer Tech Support', responses: [new Date(2026, 8, 20), new Date(2026, 8, 27)] },
    quietForm: { title: 'Chair Yoga', responses: [new Date(2026, 8, 1)] },
    emptyForm: { title: 'Knitting', responses: [] }
  });

  const found = sandbox.findUnimportedForms({});
  check('a form the session table names and cannot open is reported',
    found.unreadable.map(f => f.formId), ['deadForm']);
  // THE CHECK NOTHING ELSE MAKES. These forms are alive, their links are in
  // circulation, they are collecting responses, and getDistinctFormIds() has
  // never heard of them.
  check('a form holding responses that no session row names is reported, worst first',
    found.unnamed.map(f => [f.formId, f.responses]), [['rollingForm', 2], ['quietForm', 1]]);
  check('a form with no responses is not a fault — nothing is being lost',
    found.unnamed.some(f => f.formId === 'emptyForm'), false);
}

// --- the picker --------------------------------------------------------------
{
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => ({}) });
  sandbox.setRows([
    sessionRow({ Event_ID: 'e1', Event_Date: new Date(2026, 9, 13, 10, 0), Calendar_Source: 'cal1',
      Clean_Title: 'Chair Yoga', Location: 'Narberth', Form_ID: 'liveYoga' })
  ]);
  sandbox.setRegistry({ 'cal1::Computer Tech Support::ASSIST': 'rollingForm' });

  const offered = sandbox.listFormsForReimport();
  check('the form nothing points at is offered FIRST — it is why the dialog was opened',
    offered[0].value, 'rollingForm');
  check('...and says so, rather than looking like any other choice',
    offered[0].label.indexOf('NO SESSION ROW POINTS AT THIS FORM') !== -1, true);
  check('a form the session table does name is still offered, below it',
    offered.map(f => f.value), ['rollingForm', 'liveYoga']);
}

// --- the months that have simply aged off the table --------------------------
//
// THE BUG THIS PINS: the session table holds a bounded window of dates, so
// every month that rolls off the back of it leaves its form in the registry
// forever. Calling all of those "NO SESSION ROW POINTS AT THIS FORM" — and
// sorting them above the healthy ones — made a picker in which every single
// line carried a warning, which is the same as no warning at all.
{
  check('a month label is read out of the span half of a key',
    sandbox.registryKeySpanMonthKey_('cal1::Chair Yoga::October 2026'), '2026-10');
  check('a lunch-only key is read the same way',
    sandbox.registryKeySpanMonthKey_('LUNCHONLY::Narberth::March 2025'), '2025-03');
  check('a [Grouped] series names no month, so it can never be excused as an old one',
    sandbox.registryKeySpanMonthKey_('cal1::Eight Week Course::FIXED'), '');
  check('and neither can an appointment program',
    sandbox.registryKeySpanMonthKey_('cal1::Computer Tech Support::ASSIST'), '');

  check('a form filed only under months gone by is ordinary housekeeping',
    sandbox.classifyReimportRegistryEntry_(['cal1::Chair Yoga::October 2025'], '2026-09'), 'past');
  check('THIS month is not gone by — a live form nothing points at is the fault',
    sandbox.classifyReimportRegistryEntry_(['cal1::Chair Yoga::September 2026'], '2026-09'), 'orphaned');
  check('one current key among old ones is enough to keep the warning',
    sandbox.classifyReimportRegistryEntry_(
      ['cal1::Chair Yoga::May 2026', 'cal1::Chair Yoga::December 2026'], '2026-09'), 'orphaned');
  check('a spanless key is never excused',
    sandbox.classifyReimportRegistryEntry_(['cal1::Computer Tech Support::ASSIST'], '2026-09'), 'orphaned');

  sandbox.setRows([
    sessionRow({ Event_ID: 'e1', Event_Date: new Date(2026, 9, 13, 10, 0), Calendar_Source: 'cal1',
      Clean_Title: 'Chair Yoga', Location: 'Narberth', Form_ID: 'liveYoga' })
  ]);
  sandbox.setRegistry({
    'cal1::Computer Tech Support::ASSIST': 'rollingForm',
    'cal1::Chair Yoga::January 2020': 'ancientForm'
  });
  const offered = sandbox.listFormsForReimport();
  check('the three kinds come in the order they deserve',
    offered.map(f => f.value), ['rollingForm', 'liveYoga', 'ancientForm']);
  check('an aged-off month is offered without a warning on it',
    offered[2].label.indexOf('NO SESSION ROW') === -1 &&
      offered[2].label.indexOf('past month') !== -1, true);
  check('...and the real fault still has one',
    offered[0].label.indexOf('NO SESSION ROW POINTS AT THIS FORM') !== -1, true);
}

// --- a session table that could not be read ----------------------------------
//
// Nothing to judge against is not evidence of a fault: accusing every form in
// the registry is the loudest possible way to report that the question was
// never asked.
{
  sandbox.setRows([]);
  sandbox.setRegistry({ 'cal1::Computer Tech Support::ASSIST': 'rollingForm' });
  const offered = sandbox.listFormsForReimport();
  check('no rows at all accuses nobody',
    offered[0].label.indexOf('NO SESSION ROW') === -1, true);
  check('...and says why instead',
    offered[0].label.indexOf('could not be read') !== -1, true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
