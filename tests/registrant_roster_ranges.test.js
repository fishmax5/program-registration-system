// THE TITLE OPENS THE PROGRAM'S ROWS ON All_Registrants (99zzl).
//
// What is pinned:
//   * each program block is found from its heading row in column A, from the
//     heading through its last registrant;
//   * Upcoming wins over Past for the same program; Past is the fallback;
//   * lunch titles (any dish, and the month tab's "Lunch @ X") find the lunch
//     block; a spelling difference falls back to the tolerant key;
//   * "Narberth + Ashbridge" tries each building;
//   * the relink rewrites a dashboard's title run only when the ranges moved,
//     and writes plain text where nothing matches.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.parseRegistrantRosterRanges_ = parseRegistrantRosterRanges_;
this.registrantRosterRangeUrl_ = registrantRosterRangeUrl_;
this.relinkDashboardTitlesToRegistrants_ = relinkDashboardTitlesToRegistrants_;
this.resetRegistrantRosterRanges_ = resetRegistrantRosterRanges_;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.LUNCH_ONLY_LABEL_PREFIX = LUNCH_ONLY_LABEL_PREFIX;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const D = new Date('2026-12-01T15:00:00Z');
const lunchTitle = sandbox.LUNCH_ONLY_LABEL_PREFIX + 'Turkey Chili';
const colA = [
  '⏳ Upcoming Registrants',                 // 1
  'Event_Date',                              // 2
  '▸ Chair Yoga — Narberth',                 // 3
  D, D,                                      // 4, 5
  `▸ ${lunchTitle} — Ashbridge`,             // 6
  D,                                         // 7
  '▸ Empty Program — Narberth',              // 8 (nobody under it)
  '',                                        // 9
  '🕓 Past Registrants',                     // 10
  'Event_Date',                              // 11
  '▸ Chair Yoga — Narberth',                 // 12 (past copy: ignored)
  D,                                         // 13
  '▸ Book Club — Ashbridge',                 // 14
  D, D, D                                    // 15-17
];
const parsed = sandbox.parseRegistrantRosterRanges_(colA.map(v => [v]));
const ranges = Object.assign(parsed, { base: 'https://docs.google.com/spreadsheets/d/X/edit', gid: 77, lastLetter: 'Z' });
const url = (t, l) => sandbox.registrantRosterRangeUrl_(t, l, ranges);

check('a block runs from its heading to its last registrant', url('Chair Yoga', 'Narberth'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A3:Z5');
check('Past is the fallback for a program with nobody upcoming', url('Book Club', 'Ashbridge'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A14:Z17');
check('a heading with nobody under it gets no link', url('Empty Program', 'Narberth'), '');
check('another building is another program', url('Chair Yoga', 'Ashbridge'), '');
check('a shared program tries each building', url('Book Club', 'Narberth + Ashbridge'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A14:Z17');
check('a spelling difference falls back to the tolerant key', url('chair  yoga', 'Narberth'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A3:Z5');
check('several titles are tried in order', url(['Nope', 'Chair Yoga'], 'Narberth'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A3:Z5');
check('any lunch dish finds the lunch block', url(sandbox.LUNCH_ONLY_LABEL_PREFIX + 'Soup', 'Ashbridge'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A6:Z7');
check('the month tab\'s "Lunch @ X" finds the lunch block', url('Lunch @ Ashbridge', 'Ashbridge'),
  'https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A6:Z7');
check('no ranges, no link', sandbox.registrantRosterRangeUrl_('Chair Yoga', 'Narberth', null), '');

// --- the relink -------------------------------------------------------------
function fakeSheet(name, grid) {
  const writes = [];
  return {
    writes,
    getName: () => name,
    getSheetId: () => 77,
    getLastRow: () => grid.length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => grid.slice(r - 1, r - 1 + nr).map(row => {
        const out = []; for (let i = 0; i < nc; i++) out.push(row[c - 1 + i] === undefined ? '' : row[c - 1 + i]); return out;
      }),
      setRichTextValues: vals => writes.push({ row: r, col: c, links: vals.map(v => v[0].url || '') })
    })
  };
}
sandbox.SpreadsheetApp.newRichTextValue = () => {
  const b = { text: '', url: '' };
  b.setText = t => { b.text = t; return b; };
  b.setLinkUrl = u => { b.url = u; return b; };
  b.build = () => ({ text: b.text, url: b.url });
  return b;
};

const regSheet = fakeSheet(sandbox.SHEET_NAMES.REGISTRANT_DASH, colA.map(v => [v]));
const monthHeaders = sandbox.HEADERS[sandbox.SHEET_NAMES.PROGRAM_MONTH];
const mRow = (title, loc) => monthHeaders.map(h => (h === 'Program' ? title : h === 'Location' ? loc : h === monthHeaders[0] ? 'N' : ''));
const monthGrid = [
  ['banner'],
  monthHeaders.slice(),
  mRow('Chair Yoga', 'Narberth'),
  mRow('Mystery', 'Narberth'),
  ['past banner'],
  monthHeaders.slice(),
  mRow('Book Club', 'Ashbridge')
];
const monthSheet = fakeSheet(sandbox.SHEET_NAMES.PROGRAM_MONTH, monthGrid);
const sheets = { [regSheet.getName()]: regSheet, [monthSheet.getName()]: monthSheet };
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getUrl: () => 'https://docs.google.com/spreadsheets/d/X/edit?usp=x',
  getSheetByName: n => sheets[n] || null
});

sandbox.relinkDashboardTitlesToRegistrants_();
check('the month tab is relinked run by run', monthSheet.writes.map(w => [w.row, w.links.length]), [[3, 2], [7, 1]]);
const lastLetter = (() => { let n = sandbox.HEADERS.All_Registrants.length, s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; })();
check('a match links, no match writes plain', monthSheet.writes[0].links, [
  `https://docs.google.com/spreadsheets/d/X/edit#gid=77&range=A3:${lastLetter}5`, '']);
monthSheet.writes.length = 0;
sandbox.relinkDashboardTitlesToRegistrants_();
check('unchanged ranges write nothing', monthSheet.writes.length, 0);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
