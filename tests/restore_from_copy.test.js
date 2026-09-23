// RESTORING REGISTRANTS FROM A COPY OF THE WORKBOOK (99n).
//
// What this pins is the classifier's promise: offer exactly the rows that are
// missing with no record of having been removed on purpose, name the cause,
// and never offer a row that would put somebody in twice or bring back a
// deletion somebody chose. Plus the shape a restored row goes back in.
const vm = require('vm');
const { readSource } = require('./helpers/source');

const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {},
    Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'u'
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.classifyCopyRegistrants = classifyCopyRegistrants;
this.buildRestoredRegistrantRow = buildRestoredRegistrantRow;
this.clubMemberKey = clubMemberKey;
this.restoreCopySpreadsheetId_ = restoreCopySpreadsheetId_;
this.makeLunchOnlyEventId = makeLunchOnlyEventId;
`, sandbox);

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

const H = sandbox.HEADERS.All_Registrants;
const map = sandbox.getIndexMap(H);
const CH = sandbox.HEADERS.Club_Members;
const cmap = sandbox.getIndexMap(CH);

function reg(fields) {
  const row = new Array(H.length).fill('');
  row[map.Program_Status] = 'Active';
  row[map.Person_Type] = 'Attendee';
  row[map.Location] = 'Narberth';
  Object.keys(fields).forEach(k => { row[map[k]] = fields[k]; });
  return row;
}
function club(fields) {
  const row = new Array(CH.length).fill('');
  row[cmap.Person_Type] = 'Attendee';
  row[cmap.Active] = true;
  Object.keys(fields).forEach(k => { row[cmap[k]] = fields[k]; });
  return row;
}
const d = day => new Date(2026, 8, day);
const FORM_LINK = '=HYPERLINK("https://x", "View Submission")';

const copyRows = [
  // 1. still here (same key) — not offered
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Ann Lee', Form_Source: FORM_LINK }),
  // 2. still here under a middle name — not offered
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Robert J. Smith' }),
  // 3. cancelled in the copy — not offered
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Cat Cancel', Program_Status: 'Cancelled' }),
  // 4. tombstoned — not offered
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Tom Stone' }),
  // 5. on triage — not offered
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Tria Ge' }),
  // 6. session gone — not offered, counted
  reg({ Event_ID: 'GONE', Event: 'Old', Event_Date: d(21), Name: 'Nosa Session' }),
  // 7. form row, missing — offered as form
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Fay Form', Form_Source: FORM_LINK, Party_ID: 'P7' }),
  // 8. desk row, missing — offered as desk, and its copy duplicate collapses
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Dee Desk', Manual_Override: 'Manually Added',
    Event_Time: '=IF(W9="","",TEXT(W9))' }),
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Dee  Desk' }),
  // 9. club booking, membership gone from live — offered as club, flagged
  reg({ Event_ID: 'E2', Event: 'Bridge', Event_Date: d(22), Name: 'Cleo Club',
    Party_ID: 'CLUB:' + sandbox.clubMemberKey('bridge|narberth', 'Cleo Club', 'Attendee') }),
  // 10. club booking, membership now INACTIVE — not offered
  reg({ Event_ID: 'E2', Event: 'Bridge', Event_Date: d(22), Name: 'Lefty Club',
    Party_ID: 'CLUB:' + sandbox.clubMemberKey('bridge|narberth', 'Lefty Club', 'Attendee') }),
  // 11. every-date still on file
  reg({ Event_ID: 'E2', Event: 'Bridge', Event_Date: d(22), Name: 'Al Dates', Party_ID: 'PA', Form_Source: FORM_LINK }),
  // 12. one submission, three dates, not in the registry — recurring
  reg({ Event_ID: 'E3a', Event: 'Chess', Event_Date: d(23), Name: 'Rae Cur', Party_ID: 'PR', Form_Source: FORM_LINK }),
  reg({ Event_ID: 'E3b', Event: 'Chess', Event_Date: d(24), Name: 'Rae Cur', Party_ID: 'PR', Form_Source: FORM_LINK }),
  reg({ Event_ID: 'E3c', Event: 'Chess', Event_Date: d(25), Name: 'Rae Cur', Party_ID: 'PR', Form_Source: FORM_LINK }),
  // 13. lunch-only row — no session row needed
  reg({ Event_ID: sandbox.makeLunchOnlyEventId('2026-09-26', 'Narberth'), Event: 'Lunch', Event_Date: d(26), Name: 'Lou Lunch' })
];
const liveRows = [
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Ann Lee', Program_Status: 'Cancelled' }),
  reg({ Event_ID: 'E1', Event: 'Yoga', Event_Date: d(20), Name: 'Robert Smith' })
];
const TH = sandbox.HEADERS.Deleted_Event_Triage;
const tmap = sandbox.getIndexMap(TH);
const triageRow = new Array(TH.length).fill('');
triageRow[tmap.Event_ID] = 'E1'; triageRow[tmap.Name] = 'Tria Ge'; triageRow[tmap.Person_Type] = 'Attendee';

const result = sandbox.classifyCopyRegistrants({
  copyRows, liveRows, triageRows: [triageRow], triageHeaders: TH,
  sessionEventIds: new Set(['E1', 'E2', 'E3a', 'E3b', 'E3c']),
  copyClubRows: [
    club({ Club: 'Bridge', Club_Key: 'bridge|narberth', Name: 'Cleo Club' }),
    club({ Club: 'Bridge', Club_Key: 'bridge|narberth', Name: 'Lefty Club' }),
    club({ Club: 'Bridge', Club_Key: 'bridge|narberth', Name: 'Was Inactive', Active: false })
  ],
  liveClubRows: [club({ Club: 'Bridge', Club_Key: 'bridge|narberth', Name: 'Lefty Club', Active: false })],
  allDatesParties: new Set(['PA|al dates']),
  isTombstoned: (eid, name) => name === 'Tom Stone'
});

const byName = {};
result.groups.forEach(g => { byName[g.name] = g; });
const names = Object.keys(byName).sort();

ok('only the unexplained losses are offered',
  JSON.stringify(names) === JSON.stringify(['Al Dates', 'Cleo Club', 'Dee Desk', 'Fay Form', 'Lou Lunch', 'Rae Cur']));
ok('a person still on the session — any spelling, any status — is counted present', result.counts.present === 2);
ok('a row cancelled in the copy is not offered', result.counts.notLive === 1);
ok('a tombstoned row is hidden', result.counts.deliberate === 1);
ok('a triage row is hidden', result.counts.triage === 1);
ok('a club booking whose member left is hidden', result.counts.clubLeft === 1);
ok('a row whose session is gone is counted, not offered', result.counts.noSession === 1 &&
  result.noSessionSamples[0].indexOf('Nosa Session') === 0);
ok('form cause', byName['Fay Form'].cause === 'form');
ok('desk cause, and the copy\'s duplicate collapses to one', byName['Dee Desk'].cause === 'desk' &&
  byName['Dee Desk'].rowKeys.length === 1);
ok('club cause, flagged as membership gone', byName['Cleo Club'].cause === 'club' && byName['Cleo Club'].membershipGone);
ok('every-date still on file', byName['Al Dates'].cause === 'allDates');
ok('one submission on three dates reads as recurring, grouped into one line',
  byName['Rae Cur'].cause === 'recurring' && byName['Rae Cur'].rowKeys.length === 3 && byName['Rae Cur'].dates.length === 3);
ok('a lunch-only row needs no session row', byName['Lou Lunch'] !== undefined);
ok('only the membership that is gone entirely is offered',
  result.memberships.length === 1 && result.memberships[0].name === 'Cleo Club');

const restored = sandbox.buildRestoredRegistrantRow(copyRows[7], map, 'Restored from X.');
ok('a desk row keeps Manually Added', restored[map.Manual_Override] === 'Manually Added');
ok('a formula Event_Time is blanked for the render to refill', restored[map.Event_Time] === '');
ok('the note is stamped', /Restored from X\./.test(restored[map.Admin_Notes]));
ok('the copy row is not mutated', copyRows[7][map.Admin_Notes] === '');
const restoredForm = sandbox.buildRestoredRegistrantRow(copyRows[6], map, 'n');
ok('a form row is protected as edited, its link and Party_ID kept',
  restoredForm[map.Manual_Override] === 'Manually Edited' && restoredForm[map.Form_Source] === FORM_LINK &&
  restoredForm[map.Party_ID] === 'P7');

ok('the id comes out of a pasted link',
  sandbox.restoreCopySpreadsheetId_('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123/edit#gid=0') ===
  '1AbCdEfGhIjKlMnOpQrStUvWxYz0123');
ok('junk is not an id', sandbox.restoreCopySpreadsheetId_('hello') === '');

if (fail) { console.log(`\n${fail} failed`); process.exit(1); }
console.log('\nall passed');
