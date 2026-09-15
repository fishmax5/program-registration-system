// TWO FORMS, ONE PROGRAM — and the repair above must not decide it.
//
// planDashboardLinkRepair() assumes Form_ID is the truth and the links are what
// drifted. That is right when a column slid and exactly wrong when a program is
// left holding two near-identical twins: same title, same questions, same
// dates. Repairing from Form_ID would then rewrite the live link to point at
// the EMPTY twin — the dashboard would agree with itself and send every future
// registration somewhere nobody reads.
//
// Which form is right is a fact, and it is not on the spreadsheet: it is the
// number of responses on each. So this reports and asks.
//
// What is pinned here:
//   • a view link is read BACKWARDS to a file id, through forms that were
//     opened and asked for their own published URL — never inferred from a cell;
//   • a program whose three pointers agree is not reported;
//   • the forms are offered with the one holding the responses first;
//   • choosing one repoints UPCOMING sessions only and marks that form for
//     re-import, because its responses are behind the sync clock.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd'
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`),
    sleep: () => {}
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
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  MimeType: { GOOGLE_FORMS: 'application/vnd.google-apps.form' }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.findForkedFormPrograms = findForkedFormPrograms;
this.publishedFormKey_ = publishedFormKey_;
this.buildPublishedFormIndex = buildPublishedFormIndex;
this.resolveForkedProgramNow = resolveForkedProgramNow;
this.buildForkedFormsHtml = buildForkedFormsHtml;
this.log = function () {};
this.__moved = [];
this.__marked = [];
this.setForms = function (forms) {
  openFormCached = function (id) {
    if (!forms[id]) throw new Error('Form not found: ' + id);
    return {
      getId: function () { return id; },
      getTitle: function () { return forms[id].title; },
      getPublishedUrl: function () {
        return 'https://docs.google.com/forms/d/e/' + forms[id].pub + '/viewform';
      },
      getEditUrl: function () { return 'https://docs.google.com/forms/d/' + id + '/edit'; },
      getResponses: function () {
        return (forms[id].responses || []).map(function (t) {
          return { getTimestamp: function () { return t; } };
        });
      }
    };
  };
};
getPersistentFormRegistry = function () { return {}; };
// THE FOLDER IS WHERE THE TWIN LIVES. Nothing on the tab names it by file id.
this.setFolder = function (ids) {
  getOrCreateFormsFolder = function () {
    var i = 0;
    return { getFiles: function () {
      return {
        hasNext: function () { return i < ids.length; },
        next: function () {
          var id = ids[i++];
          return { getId: function () { return id; }, isTrashed: function () { return false; },
            getMimeType: function () { return 'application/vnd.google-apps.form'; } };
        }
      };
    } };
  };
};
writeFormIdOntoSessions = function (sheet, wanted, formId) {
  __moved.push({ ids: Array.from(wanted).sort(), formId });
  return wanted.size;
};
markFormForBackfill = function (formId) { __marked.push(formId); return true; };
isBootstrapActive = function () { return false; };
noteForAdmin = function () {};
describeFormLink = function (id) { return 'FORM(' + id + ')'; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// The two twins: same title, same shape. One has every registration on it.
const LIVE = '1LiveTwinAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const EMPTY = '1EmptyTwinBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
sandbox.setForms({
  [LIVE]: { title: 'Computer Tech Support', pub: 'PUBLIVE', responses: [new Date(2026, 8, 20), new Date(2026, 8, 27)] },
  [EMPTY]: { title: 'Computer Tech Support', pub: 'PUBEMPTY', responses: [] }
});

sandbox.setFolder([LIVE, EMPTY]);

// --- reading a view link backwards -------------------------------------------
{
  check('a published URL yields its own identifier',
    sandbox.publishedFormKey_('https://docs.google.com/forms/d/e/PUBLIVE/viewform'), 'PUBLIVE');
  check('...and anything else yields nothing rather than a guess',
    sandbox.publishedFormKey_('https://docs.google.com/forms/d/' + LIVE + '/edit'), '');

  const index = sandbox.buildPublishedFormIndex([LIVE, EMPTY, 'notAFormAtAllXXXXXXXXXXXXXXXXXXXXX']);
  check('the inverse index is built by opening each form and asking it',
    index, { PUBLIVE: LIVE, PUBEMPTY: EMPTY });
}

const COLS = ['Event_Date', 'Event_ID', 'Calendar_Source', 'Clean_Title', 'Location',
  'Form_ID', 'Form_Response_Link', 'Edit_Form_Link'];
const view = pub => `=HYPERLINK("https://docs.google.com/forms/d/e/${pub}/viewform","View Live Form")`;
const edit = id => `=HYPERLINK("https://docs.google.com/forms/d/${id}/edit","Edit Form Settings")`;

function sheetOf(rows) {
  vm.runInContext(`
    findProgramSessionHeaderRows = function () { return [1]; };
    getHeaderMapAt = function () {
      var m = {}; ${JSON.stringify(COLS)}.forEach(function (c, i) { m[c] = i + 1; }); return m;
    };
    getZoneDataRange = function () { return { start: 2, count: ${rows.length} }; };
  `, sandbox);
  const values = rows.map(r => COLS.map(c => (c.indexOf('Link') === -1 ? r[c] : '')));
  const formulas = rows.map(r => COLS.map(c =>
    c === 'Form_Response_Link' ? view(r.viewPub) : c === 'Edit_Form_Link' ? edit(r.editId) : ''));
  return {
    getRange: (r, c, n) => ({
      getValues: () => values.slice(r - 2, r - 2 + n).map(row => [row[c - 1]]),
      getFormulas: () => formulas.slice(r - 2, r - 2 + n).map(row => [row[c - 1]])
    })
  };
}

const soon = new Date(Date.now() + 14 * 86400000);
const later = new Date(Date.now() + 28 * 86400000);
const past = new Date(Date.now() - 28 * 86400000);
const row = (date, id, formId, editId, viewPub) => ({
  Event_Date: date, Event_ID: id, Calendar_Source: 'cal1',
  Clean_Title: 'Computer Tech Support', Location: 'Narberth',
  Form_ID: formId, editId, viewPub
});

// --- the fork ----------------------------------------------------------------
{
  // The exact shape reported: Form_ID and the edit link name the empty twin,
  // the view link opens the one everybody has been filling in.
  const found = sandbox.findForkedFormPrograms(sheetOf([
    row(past, 'e0', EMPTY, EMPTY, 'PUBLIVE'),
    row(soon, 'e1', EMPTY, EMPTY, 'PUBLIVE'),
    row(later, 'e2', EMPTY, EMPTY, 'PUBLIVE')
  ]));
  check('the program is reported once, not once per session', found.length, 1);
  check('with every row of it counted', [found[0].rowCount, found[0].upcoming], [3, 2]);
  check('and both forms offered', found[0].forms.length, 2);
  // THE FACT THAT DECIDES IT, and the reason this asks rather than repairs.
  check('the form holding the registrations is offered FIRST',
    [found[0].forms[0].formId, found[0].forms[0].responses], [LIVE, 2]);
  check('...and the empty twin second', [found[0].forms[1].formId, found[0].forms[1].responses], [EMPTY, 0]);
  check('each form says how the rows name it',
    [found[0].forms[0].asView, found[0].forms[0].asFormId,
      found[0].forms[1].asView, found[0].forms[1].asFormId], [3, 0, 0, 3]);
}

// --- a dashboard that agrees is not reported ---------------------------------
{
  const found = sandbox.findForkedFormPrograms(sheetOf([
    row(soon, 'e1', LIVE, LIVE, 'PUBLIVE'),
    row(later, 'e2', LIVE, LIVE, 'PUBLIVE')
  ]));
  check('three pointers that agree are not a fork', found, []);
}

// --- choosing ----------------------------------------------------------------
{
  vm.runInContext(`getSectionedRows = function () {
    var map = getIndexMap(HEADERS.All_Program_Sessions);
    return [
      ${JSON.stringify(['e0', past.toISOString()])},
      ${JSON.stringify(['e1', soon.toISOString()])},
      ${JSON.stringify(['e2', later.toISOString()])}
    ].map(function (pair) {
      var r = new Array(HEADERS.All_Program_Sessions.length).fill('');
      r[map['Event_ID']] = pair[0];
      r[map['Event_Date']] = new Date(pair[1]);
      r[map['Calendar_Source']] = 'cal1';
      r[map['Clean_Title']] = 'Computer Tech Support';
      return r;
    });
  };
  SpreadsheetApp.getActiveSpreadsheet = function () {
    return { getSheetByName: function () { return {}; }, getSpreadsheetTimeZone: function () { return 'America/New_York'; } };
  };`, sandbox);

  const message = sandbox.resolveForkedProgramNow('cal1|Computer Tech Support', LIVE);
  // PAST ROWS KEEP THEIR FORM: a past row's Form_ID is the record of where that
  // registration came from, and it keeps the twin on the import's work list.
  check('only the upcoming sessions are repointed',
    sandbox.__moved.map(m => [m.ids, m.formId]), [[['e1', 'e2'], LIVE]]);
  // THE HALF THAT IS EASY TO MISS. Those responses were submitted while the
  // rows named the other form, so they sit behind the sync clock.
  check('and the chosen form is marked to be read from the beginning', sandbox.__marked, [LIVE]);
  check('the message says what will happen next', message.indexOf('re-import') !== -1, true);

  const refused = sandbox.resolveForkedProgramNow('cal1|Computer Tech Support', 'noSuchFormXXXXXXXXXXXXXXXXXXXXX');
  check('a form that will not open is refused rather than written',
    refused.indexOf('could not be opened') !== -1, true);
  check('...and nothing further was moved', sandbox.__moved.length, 1);
}

// --- the page ----------------------------------------------------------------
{
  const html = sandbox.buildForkedFormsHtml();
  const body = html.match(/<script>([^]*?)<\/script>/)[1];
  new vm.Script(body);
  check('the dialog script parses in a browser', true, true);
  // Nothing from the workbook is interpolated into this page at all — it asks
  // the server for its contents after it is on screen.
  check('and it carries no workbook data inline', /\$\{/.test(body), false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
