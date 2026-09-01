// A dashboard whose link columns have slid off their rows cannot be fixed by
// any of the ordinary rebuilds: they READ the session table, sort it, and write
// it back, so a shifted link is read shifted and written shifted into a freshly
// formatted tab. The values have to be re-derived from somewhere that is not
// those cells.
//
// What is pinned here — the two pure decisions the repair rests on:
//
//   • THE SELF-CHECK. Event_ID is a pure function of three other columns on the
//     same row, so a row can be checked against itself with no network at all.
//     A row that vouches for itself can be trusted to name its own form; one
//     that does not has shifted in its IDENTITY columns, and the repair must
//     refuse to guess rather than write a link derived from another session's
//     title.
//   • THE KEY. Which registry entry a row's form comes from — including the
//     span, so a session a month out is not handed the near month's form (the
//     bug this whole area exists because of), and including the separate shape
//     a lunch-only row uses.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'MMMM yyyy') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
    sleep: () => {},
    // computeEventId() digests through Utilities — a stable stand-in keeps the
    // ids deterministic without pulling in a crypto implementation.
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
;this.readSessionRowIdentity = readSessionRowIdentity;
this.registryKeyForSessionRow = registryKeyForSessionRow;
this.computeEventId = computeEventId;
this.makeLunchOnlyEventId = makeLunchOnlyEventId;
this.lunchOnlyGroupKey = lunchOnlyGroupKey;
this.log = function () {};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const CAL = 'narberth@group.calendar.google.com';
const sep = new Date(2026, 8, 15);
const oct = new Date(2026, 9, 13);

// One row, as the planner reads it: a bag of single-column value arrays.
function rowValues(o) {
  const v = {};
  Object.keys(o).forEach(k => { v[k] = [[o[k]]]; });
  return v;
}

// --- A WELL-FORMED ROW VOUCHES FOR ITSELF ----------------------------------
{
  const eventId = sandbox.computeEventId(CAL, 'Chair Yoga', '2026-09-15');
  const id = sandbox.readSessionRowIdentity(rowValues({
    Event_Date: sep, Event_ID: eventId, Calendar_Source: CAL, Clean_Title: 'Chair Yoga',
    Location: 'Narberth', Type_Tag: 'Regular', Form_ID: 'FORM_SEP',
    Form_Response_Link: 'View Live Form', Edit_Form_Link: 'Edit Form Settings'
  }), 0);
  check('a well-formed row passes the self-check', id.aligned, true);
  check('and names its own month\'s registry entry',
    sandbox.registryKeyForSessionRow(id), `${CAL}::Chair Yoga::September 2026`);
}

// --- A ROW WHOSE IDENTITY HAS SHIFTED DOES NOT ------------------------------
// The case the repair must REFUSE. Event_ID here belongs to a different
// session, so the title on this row cannot be trusted to name a form.
{
  const wrongId = sandbox.computeEventId(CAL, 'Bingo', '2026-09-15');
  const id = sandbox.readSessionRowIdentity(rowValues({
    Event_Date: sep, Event_ID: wrongId, Calendar_Source: CAL, Clean_Title: 'Chair Yoga',
    Location: 'Narberth', Type_Tag: 'Regular', Form_ID: 'FORM_SEP',
    Form_Response_Link: 'View Live Form', Edit_Form_Link: ''
  }), 0);
  check('a row carrying another session\'s Event_ID fails the self-check', id.aligned, false);
}

// --- THE SPAN IS IN THE KEY (the bug this area exists because of) -----------
{
  const mk = d => sandbox.readSessionRowIdentity(rowValues({
    Event_Date: d, Event_ID: sandbox.computeEventId(CAL, 'Chair Yoga', d === sep ? '2026-09-15' : '2026-10-13'),
    Calendar_Source: CAL, Clean_Title: 'Chair Yoga', Location: 'Narberth', Type_Tag: 'Regular',
    Form_ID: '', Form_Response_Link: '', Edit_Form_Link: ''
  }), 0);
  const kSep = sandbox.registryKeyForSessionRow(mk(sep));
  const kOct = sandbox.registryKeyForSessionRow(mk(oct));
  check('September and October rows resolve to different registry entries', kSep === kOct, false);
  check('October\'s key names October', kOct, `${CAL}::Chair Yoga::October 2026`);
}

// --- A GROUPED SERIES SHARES ONE KEY ACROSS MONTHS -------------------------
{
  const mk = (d, dk) => sandbox.readSessionRowIdentity(rowValues({
    Event_Date: d, Event_ID: sandbox.computeEventId(CAL, 'Fall Book Club', dk),
    Calendar_Source: CAL, Clean_Title: 'Fall Book Club', Location: 'Narberth', Type_Tag: 'Grouped',
    Form_ID: '', Form_Response_Link: '', Edit_Form_Link: ''
  }), 0);
  check('a Grouped series is one key in both months',
    sandbox.registryKeyForSessionRow(mk(sep, '2026-09-15')),
    sandbox.registryKeyForSessionRow(mk(oct, '2026-10-13')));
  check('and that key is the FIXED one',
    sandbox.registryKeyForSessionRow(mk(sep, '2026-09-15')), `${CAL}::Fall Book Club::FIXED`);
}

// --- A LUNCH-ONLY ROW IS CHECKED AND KEYED BY ITS OWN SHAPE ----------------
// It never came from a calendar, so the calendar-derived digest would call
// every one of them shifted.
{
  const id = sandbox.readSessionRowIdentity(rowValues({
    Event_Date: sep, Event_ID: sandbox.makeLunchOnlyEventId('2026-09-15', 'Narberth'),
    Calendar_Source: '', Clean_Title: 'Lunch @ Narberth', Location: 'Narberth',
    Type_Tag: 'Regular', Form_ID: 'FORM_LUNCH', Form_Response_Link: 'View Live Form', Edit_Form_Link: ''
  }), 0);
  check('a lunch-only row is recognized as one', id.isLunchOnly, true);
  check('and passes its own self-check despite having no calendar', id.aligned, true);
  check('and keys to the lunch group, not a calendar one',
    sandbox.registryKeyForSessionRow(id), sandbox.lunchOnlyGroupKey('Narberth', 'September 2026'));
}

// --- ROWS THAT CANNOT BE PLACED ARE REPORTED, NOT GUESSED AT ---------------
{
  const undated = sandbox.readSessionRowIdentity(rowValues({
    Event_Date: '', Event_ID: 'whatever', Calendar_Source: CAL, Clean_Title: 'Chair Yoga',
    Location: 'Narberth', Type_Tag: 'Regular', Form_ID: '', Form_Response_Link: '', Edit_Form_Link: ''
  }), 0);
  check('an undated row never claims to be aligned', undated.aligned, false);
  check('and yields no registry key at all', sandbox.registryKeyForSessionRow(undated), '');

  const noSource = sandbox.readSessionRowIdentity(rowValues({
    Event_Date: sep, Event_ID: sandbox.computeEventId('', 'Chair Yoga', '2026-09-15'),
    Calendar_Source: '', Clean_Title: 'Chair Yoga', Location: 'Narberth', Type_Tag: 'Regular',
    Form_ID: '', Form_Response_Link: '', Edit_Form_Link: ''
  }), 0);
  check('a non-lunch row with no calendar yields no key rather than a wrong one',
    sandbox.registryKeyForSessionRow(noSource), '');
}

console.log(failures === 0 ? '\nAll dashboard link repair checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
