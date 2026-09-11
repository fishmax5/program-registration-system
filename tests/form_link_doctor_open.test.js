// THE DIALOG OPENS BEFORE ANYTHING IS CHECKED.
//
// showFormLinkDoctorDialog() used to run the whole diagnosis and hand the
// result to the page — so the menu item probed every form in Drive, listed the
// forms folder and read every calendar in the sync window BEFORE the dialog
// was created. Apps Script stops an execution at its ceiling with no warning
// and no exception, so on a real workbook the dialog was simply never created:
// a menu item that does nothing at all, and says nothing about why.
//
// What is pinned here:
//   • opening the dialog reads no form, no Drive file and no calendar;
//   • the quick pass skips Drive and the calendars, and the deep one does not;
//   • a scan says which stages it skipped, so a partial pass can never be
//     drawn as a clean bill of health;
//   • one stage failing does not take the others down with it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const calls = { forms: 0, drive: 0, calendars: 0, folder: 0 };
const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => (fmt === 'yyyy-MM-dd'
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : String(d)),
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: () => ({ getName: () => 'All_Program_Sessions' }),
      getSpreadsheetTimeZone: () => 'America/New_York'
    }),
    getActive: () => null,
    flush: () => {},
    getUi: () => ({ showModalDialog: (html, title) => { sandbox.__shown = title; } })
  },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, LockService: {},
  HtmlService: {
    createHtmlOutput: html => ({
      html, setWidth() { return this; }, setHeight() { return this; }
    })
  },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.showFormLinkDoctorDialog = showFormLinkDoctorDialog;
this.gatherFormLinkFacts = gatherFormLinkFacts;
this.runFormLinkDoctorScan = runFormLinkDoctorScan;
this.doctorScanDepth = doctorScanDepth;
this.log = function () {};
this.__counts = ${JSON.stringify(calls)};

// Every expensive stage, counted rather than performed. Each also THROWS, which
// is the second thing under test: a stage that cannot run must not take the
// diagnosis down with it.
planDashboardLinkRepair = function () {
  __counts.forms++;
  return { plan: [], stats: { scanned: 7, willFix: 2, wrongForm: 2, misaligned: 0, noKey: 0,
    noForm: 0, alreadyRight: 5, blocked: 0, formsOpened: 3, staleLiveLink: 0, staleEditLink: 0,
    missingLink: 0 } };
};
getOrCreateFormsFolder = function () { __counts.folder++; return { getId: function () { return 'folder1'; } }; };
collectFormsWorkbookDependsOn = function () { return []; };
planFormRecovery = function () { __counts.drive++; return { ok: [], trashed: [], strayed: [], gone: [] }; };
findDuplicateFormTitles = function () { __counts.drive++; return []; };
planEventLinkDrift = function () { __counts.calendars++; return { stats: { scanned: 40, disagrees: 0 }, drift: [] }; };
getSectionedRows = function () { return []; };
getPersistentFormRegistry = function () { return {}; };
getLunchOnlyFormLinks = function () { return {}; };
isBootstrapActive = function () { return false; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
const counts = () => sandbox.__counts;
const reset = () => { counts().forms = 0; counts().drive = 0; counts().calendars = 0; counts().folder = 0; };

// --- opening the dialog ------------------------------------------------------
{
  reset();
  sandbox.showFormLinkDoctorDialog();
  check('the dialog is shown', sandbox.__shown, 'Form & Link Doctor');
  // THE WHOLE POINT. Not one round trip before the page exists.
  check('and nothing at all was checked first',
    [counts().forms, counts().drive, counts().calendars, counts().folder], [0, 0, 0, 0]);
}

// --- the two depths ----------------------------------------------------------
{
  check('the quick depth skips Drive and the calendars',
    sandbox.doctorScanDepth(false), { skipDrive: true, skipCalendar: true });
  check('the deep one skips nothing', sandbox.doctorScanDepth(true), {});

  reset();
  const quick = sandbox.runFormLinkDoctorScan(sandbox.doctorScanDepth(false));
  check('the quick pass builds the link plan — it is what people open this for', counts().forms, 1);
  check('...and touches neither Drive nor a calendar', [counts().drive, counts().calendars], [0, 0]);
  check('it still finds the rows pointing at the wrong form',
    quick.findings.map(f => f.code), ['wrongForm']);
  // A PARTIAL PASS MUST SAY SO. "Nothing wrong" about a stage that never ran is
  // the one thing this dialog cannot be allowed to say.
  check('and it reports what it did not look at',
    [quick.checked.driveSkipped, quick.checked.calendarSkipped], [true, true]);
  check('...while not pretending to have counted forms it never opened', quick.checked.forms, 0);

  reset();
  const deep = sandbox.runFormLinkDoctorScan(sandbox.doctorScanDepth(true));
  check('the deep pass reads Drive and the calendars', [counts().drive, counts().calendars], [2, 1]);
  check('and claims no skipped stage',
    [deep.checked.driveSkipped, deep.checked.calendarSkipped], [false, false]);
  check('the calendar count reaches the page', deep.checked.events, 40);
}

// --- one stage failing is one stage failing ---------------------------------
{
  vm.runInContext(`planFormRecovery = function () { throw new Error('Drive said no'); };`, sandbox);
  reset();
  const scan = sandbox.runFormLinkDoctorScan(sandbox.doctorScanDepth(true));
  check('a Drive failure still leaves the link findings on screen',
    scan.findings.map(f => f.code), ['wrongForm']);
  check('...and is reported as a stage that did not run', scan.checked.driveSkipped, true);
  check('...while the calendars were still read', scan.checked.calendarSkipped, false);

  vm.runInContext(`planDashboardLinkRepair = function () { throw new Error('no forms'); };`, sandbox);
  const noLinks = sandbox.runFormLinkDoctorScan(sandbox.doctorScanDepth(false));
  check('a link plan that will not build does not throw the dialog away',
    noLinks.ok && noLinks.checked.linksSkipped, true);
  check('...and claims to have scanned no rows rather than zero problems',
    noLinks.checked.rows, 0);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
