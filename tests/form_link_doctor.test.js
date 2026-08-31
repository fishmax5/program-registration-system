// The Doctor's two decisions, both of them pure and both of them the kind that
// only shows up as a wrong answer on somebody's screen:
//
//   • WHICH FAULT A ROW HAS. Four different things can be wrong with a row's
//     links and they need four different sentences. The one that matters most
//     is the one that used to be undetectable: a row naming the RIGHT form
//     whose "View Live Form" goes somewhere else. A published URL
//     (/forms/d/e/<published id>/viewform) is a separate identifier from the
//     file ID, so an edit link — which is built from the file ID — stays
//     correct while the live link is wrong, and the old repair compared a
//     harvested URL against itself and reported everything as fine.
//   • WHAT ORDER TO FIX THINGS IN. Dependency order, not severity order:
//     repairing links before restoring the forms they point at repairs them
//     onto a form that is still in the trash, and rewriting the calendar
//     before the dashboard is right copies the wrong answer onto every event.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'MMMM yyyy') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (fmt === 'yyyy-MM') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      return d.toISOString();
    },
    sleep: () => {},
    DigestAlgorithm: { MD5: 'MD5' },
    computeDigest: (algo, raw) => {
      const out = [];
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = (raw.charCodeAt(i) + ((h << 5) - h)) | 0;
      for (let i = 0; i < 16; i++) { out.push((h >> (i % 4 * 8)) & 0xff); h = (h * 31 + i) | 0; }
      return out;
    }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.diagnoseRowLinkFault = diagnoseRowLinkFault;
this.buildDoctorFindings = buildDoctorFindings;
this.buildFormLinkDoctorHtml = buildFormLinkDoctorHtml;
this.DOCTOR_FIXES = DOCTOR_FIXES;
this.log = function () {};
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const PUB = 'https://docs.google.com/forms/d/e/PUBLISHED_ID/viewform';
const EDIT = 'https://docs.google.com/forms/d/FORM_A/edit';
const urls = { publishedUrl: PUB, editUrl: EDIT };
const row = over => Object.assign({ formId: 'FORM_A', viewHref: PUB, editHref: EDIT }, over);

// --- THE FOUR FAULTS -------------------------------------------------------
{
  check('a row whose form and both links agree needs no write',
    sandbox.diagnoseRowLinkFault(row({}), 'FORM_A', urls), '');
  check('a row naming another session\'s form is the wrong-form fault',
    sandbox.diagnoseRowLinkFault(row({ formId: 'FORM_B' }), 'FORM_A', urls), 'wrongForm');
  check('a row with the RIGHT form and a live link to somewhere else is caught',
    sandbox.diagnoseRowLinkFault(
      row({ viewHref: 'https://docs.google.com/forms/d/e/OTHER/viewform' }), 'FORM_A', urls), 'staleLiveLink');
  check('and so is the mirror image on the edit link',
    sandbox.diagnoseRowLinkFault(
      row({ editHref: 'https://docs.google.com/forms/d/FORM_B/edit' }), 'FORM_A', urls), 'staleEditLink');
  check('a row with a form and an empty link cell is a gap, not a wrong link',
    sandbox.diagnoseRowLinkFault(row({ viewHref: '', editHref: '' }), 'FORM_A', urls), 'missingLink');
}

// --- THE FAULT THAT HID BEHIND A CORRECT EDIT LINK -------------------------
// The whole reason the live half went wrong on its own: the edit URL is built
// from the form ID, so it is right by construction even when the published URL
// beside it belongs to a different form. Judging a row by its Form_ID or its
// edit link can never find this.
{
  const wrongLive = row({ viewHref: 'https://docs.google.com/forms/d/e/SOMEONE_ELSE/viewform' });
  check('the form ID is right', wrongLive.formId, 'FORM_A');
  check('the edit link is right', wrongLive.editHref, EDIT);
  check('and the row still needs repairing',
    sandbox.diagnoseRowLinkFault(wrongLive, 'FORM_A', urls), 'staleLiveLink');
}

// --- NOTHING WRONG IS A REAL ANSWER ----------------------------------------
{
  const findings = sandbox.buildDoctorFindings({
    linkStats: { scanned: 40, misaligned: 0, noForm: 0, willFix: 0, alreadyRight: 40 },
    recovery: { ok: [{}, {}], trashed: [], strayed: [], gone: [] },
    drift: { stats: { scanned: 40, disagrees: 0 }, drift: [] },
    duplicates: []
  });
  check('a healthy workbook produces no findings at all', findings.length, 0);
}

// --- DEPENDENCY ORDER ------------------------------------------------------
{
  const findings = sandbox.buildDoctorFindings({
    linkStats: { scanned: 40, misaligned: 2, noForm: 1, willFix: 9, alreadyRight: 28,
      wrongForm: 3, staleLiveLink: 5, staleEditLink: 0, missingLink: 1 },
    recovery: {
      ok: [{}], trashed: [{ describe: 'Knit and Chat (Narberth)', formId: 'F1' }],
      strayed: [{ describe: 'Chess (Ashbridge)', formId: 'F2' }],
      gone: [{ describe: 'World Affairs (Narberth)', formId: 'F3' }]
    },
    drift: { stats: { scanned: 40, disagrees: 7 },
      drift: [{ title: 'Knit and Chat', location: 'Narberth', dateKey: '2026-09-03' }] },
    duplicates: [{ title: 'Mah Jongg - September 2026', formIds: ['a', 'b'], usedId: 'a' }]
  });
  check('every fault is reported once, in dependency order',
    findings.map(f => f.code),
    ['shiftedRows', 'trashedForms', 'lostForms', 'wrongForm', 'staleLiveLink', 'missingLink',
      'calendarDisagrees', 'strayedForms', 'noFormOnRegistry', 'duplicateForms']);

  const at = code => findings.map(f => f.code).indexOf(code);
  check('forms are taken out of the trash BEFORE links are pointed at them',
    at('trashedForms') < at('wrongForm'), true);
  check('replacements are decided before any link is written, since they change the ID',
    at('lostForms') < at('staleLiveLink'), true);
  check('the calendar is rewritten LAST, after the dashboard it copies is right',
    at('calendarDisagrees') > at('staleLiveLink'), true);

  check('a fault with no clean answer offers instructions rather than a button',
    [findings[at('shiftedRows')].fix, findings[at('duplicateForms')].fix], ['', '']);
  check('and the ones that can be fixed name a real dispatch key',
    findings.filter(f => f.fix).every(f =>
      Object.keys(sandbox.DOCTOR_FIXES).some(k => sandbox.DOCTOR_FIXES[k] === f.fix)), true);
  check('a rebuild is the one fix that asks a second time',
    findings.filter(f => f.confirm).map(f => f.code), ['lostForms']);
  check('the three link faults share one repair, since one pass fixes all of them',
    [findings[at('wrongForm')].fix, findings[at('staleLiveLink')].fix, findings[at('missingLink')].fix],
    [sandbox.DOCTOR_FIXES.LINKS, sandbox.DOCTOR_FIXES.LINKS, sandbox.DOCTOR_FIXES.LINKS]);
}

// --- A FAULT WITH A COUNT OF ZERO IS NOT A FINDING -------------------------
{
  const findings = sandbox.buildDoctorFindings({
    linkStats: { scanned: 10, misaligned: 0, noForm: 0, willFix: 2, alreadyRight: 8,
      wrongForm: 0, staleLiveLink: 2, staleEditLink: 0, missingLink: 0 },
    recovery: { ok: [{}], trashed: [], strayed: [], gone: [] },
    drift: { stats: { scanned: 10, disagrees: 0 }, drift: [] },
    duplicates: []
  });
  check('only the fault that actually happened is listed',
    findings.map(f => f.code), ['staleLiveLink']);
}

// --- A CALENDAR THAT COULD NOT BE READ IS NOT A CLEAN BILL OF HEALTH -------
{
  const findings = sandbox.buildDoctorFindings({
    linkStats: { scanned: 10, misaligned: 0, noForm: 0, willFix: 0, alreadyRight: 10 },
    recovery: { ok: [{}], trashed: [], strayed: [], gone: [] },
    drift: null, duplicates: []
  });
  check('a skipped calendar reports nothing rather than reporting agreement',
    findings.filter(f => f.code === 'calendarDisagrees').length, 0);
}

// --- THE DIALOG CARRIES ITS DATA SAFELY ------------------------------------
// Same guard every inline-data dialog in this file needs: a program title
// containing "</script>" must not end the script block.
{
  const html = sandbox.buildFormLinkDoctorHtml({
    ok: true, checked: { rows: 1, forms: 1, events: 1 },
    findings: [{ code: 'x', severity: 'info', count: 1, title: 'Films </script> night',
      what: 'w', why: 'y', fix: '', fixLabel: '', items: [] }]
  });
  check('no raw "</script>" survives into the page', html.indexOf('</script> night'), -1);
  check('and it is carried as a JSON escape instead', html.indexOf('\\u003c/script> night') !== -1, true);
}

console.log(failures === 0 ? '\nAll Form & Link Doctor checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
