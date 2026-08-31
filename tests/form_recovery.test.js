// A form deleted out of the Drive folder leaves NO mark on this workbook: the
// dashboard still carries its link, the registry still names it, the calendar
// events still point at it. Only Drive knows, and it distinguishes cases the
// sheet cannot see at all.
//
// What is pinned here — the two decisions the recovery rests on, both of them
// made without touching Drive:
//
//   • THE FOUR STATES. Trashed is recoverable and keeps every link, so it must
//     never be lumped in with gone, which can only be answered by a new form
//     with a new link. "Alive but outside the folder" is filing, not damage,
//     and must not trigger a rebuild. "Cannot tell where it is filed" must be
//     read as fine rather than as strayed — an unreadable parent list is a
//     permissions answer, and moving a file on the strength of it is how a
//     form ends up somewhere nobody expects.
//   • WHAT COUNTS AS DEPENDED ON. A form can be load-bearing without appearing
//     on the dashboard: the registry decides what the NEXT sync reuses, and a
//     lunch sign-up form has no session rows of its own. Checking only the
//     Form_ID column would report those as fine right up until they were
//     needed.
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
;this.collectFormsWorkbookDependsOn = collectFormsWorkbookDependsOn;
this.classifyFormFileState = classifyFormFileState;
this.planFormRecovery = planFormRecovery;
this.log = function () {};
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// The dashboard columns this reads, in the order the fixture rows write them.
const COLS = ['Event_Date', 'Clean_Title', 'Location', 'Form_ID'];
const map = {};
COLS.forEach((c, i) => { map[c] = i; });
const row = (date, title, location, formId) => [date, title, location, formId];

const DAY = 24 * 60 * 60 * 1000;
const soon = new Date(Date.now() + 30 * DAY);
const gone = new Date(Date.now() - 30 * DAY);

// --- THE FOUR STATES -------------------------------------------------------
{
  check('a present, untrashed, correctly filed form is fine',
    sandbox.classifyFormFileState({ found: true, trashed: false, inFolder: true }), 'ok');
  check('a trashed form is restorable, not lost',
    sandbox.classifyFormFileState({ found: true, trashed: true, inFolder: false }), 'trashed');
  check('a live form outside the folder is a filing problem',
    sandbox.classifyFormFileState({ found: true, trashed: false, inFolder: false }), 'strayed');
  check('a file Drive cannot produce is the only unrecoverable state',
    sandbox.classifyFormFileState({ found: false }), 'gone');
  check('and no answer at all is treated as gone rather than as fine',
    sandbox.classifyFormFileState(null), 'gone');
}

// --- AN UNREADABLE PARENT LIST IS NOT A REASON TO MOVE A FILE --------------
// probeFormFile() reports inFolder:true when it cannot read the parents. The
// classifier must agree with that reading rather than second-guessing it, or a
// form somebody else owns gets filed somewhere on every run.
{
  check('a form whose folders cannot be read is left where it is',
    sandbox.classifyFormFileState({ found: true, trashed: false, inFolder: true }), 'ok');
}

// --- WHAT COUNTS AS DEPENDED ON --------------------------------------------
{
  const rows = [
    row(soon, 'Chair Yoga', 'Narberth', 'FORM_YOGA'),
    row(gone, 'Chair Yoga', 'Narberth', 'FORM_YOGA'),
    row(soon, 'Bingo', 'Bala', 'FORM_BINGO')
  ];
  const refs = sandbox.collectFormsWorkbookDependsOn(rows, map,
    { 'cal::Knitting::FIXED': 'FORM_KNIT' },
    { 'lunch::Narberth::2026-09': { formId: 'FORM_LUNCH', publishedUrl: 'https://x' } });
  const ids = refs.map(r => r.formId).sort();
  check('the union of dashboard, registry and lunch links is checked',
    ids, ['FORM_BINGO', 'FORM_KNIT', 'FORM_LUNCH', 'FORM_YOGA']);

  const yoga = refs.filter(r => r.formId === 'FORM_YOGA')[0];
  check('a form is counted over every session row that points at it', yoga.sessions, 2);
  check('and only the future ones count as upcoming', yoga.upcoming, 1);
  check('a dashboard form is described by its programs, not its ID',
    yoga.describe, 'Chair Yoga (Narberth)');

  const knit = refs.filter(r => r.formId === 'FORM_KNIT')[0];
  check('a form only the registry names is still checked', knit.sources, ['registry']);
  check('and is named by its group key, since it has no rows to describe it',
    knit.describe, 'cal::Knitting::FIXED (no session rows)');
}

// --- A ROW WITH NO FORM IS NOT A FORM --------------------------------------
{
  const refs = sandbox.collectFormsWorkbookDependsOn(
    [row(soon, 'Coffee Hour', 'Narberth', ''), row(soon, 'Coffee Hour', 'Narberth', '  ')],
    map, {}, {});
  check('a [No Registration] row contributes no form to check', refs.length, 0);
}

// --- THE PLAN SORTS, AND CHANGES NOTHING -----------------------------------
{
  const refs = sandbox.collectFormsWorkbookDependsOn([
    row(soon, 'Chair Yoga', 'Narberth', 'FORM_OK'),
    row(soon, 'Bingo', 'Bala', 'FORM_TRASHED'),
    row(soon, 'Art Class', 'Narberth', 'FORM_STRAY'),
    row(soon, 'Wills', 'Bala', 'FORM_GONE')
  ], map, {}, {});
  const drive = {
    FORM_OK: { found: true, trashed: false, inFolder: true },
    FORM_TRASHED: { found: true, trashed: true, inFolder: false },
    FORM_STRAY: { found: true, trashed: false, inFolder: false },
    FORM_GONE: { found: false }
  };
  const buckets = sandbox.planFormRecovery(refs, id => drive[id]);
  check('each form lands in exactly one bucket',
    [buckets.ok, buckets.trashed, buckets.strayed, buckets.gone].map(b => b.map(r => r.formId)),
    [['FORM_OK'], ['FORM_TRASHED'], ['FORM_STRAY'], ['FORM_GONE']]);
  check('and carries its state with it', buckets.trashed[0].state, 'trashed');
  check('planning is read-only — the refs it was given are unchanged',
    refs.map(r => r.state === undefined), [true, true, true, true]);
}

console.log(failures === 0 ? '\nAll form recovery checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
