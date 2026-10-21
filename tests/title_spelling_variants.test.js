// Calendar titles that differ only by spacing, punctuation or a common
// abbreviation are ONE program: one Event_ID, one group. Offline.
const vm = require('vm');
const src = require('./helpers/source').readSource();

// A session table that already holds one spelling, to prove it wins.
let tableTitles = [];
const sandbox = {
  console,
  Utilities: {
    formatDate: d => d.toISOString(),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => Array.from(require('crypto').createHash('md5').update(String(payload)).digest()).map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' }, sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({}), getSpreadsheetTimeZone: () => 'America/New_York' }), getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: {}, ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' }) }
};
vm.createContext(sandbox);
vm.runInContext(src + '\n;this.HEADERS = HEADERS;', sandbox, { filename: 'program.gs' });
// Shadow the sectioned reader so the "session table" is the list above.
vm.runInContext('getSectionedRows = function () { const map = getIndexMap(HEADERS.All_Program_Sessions); return __titles.map(t => { const r = []; r[map["Clean_Title"]] = t; return r; }); };', sandbox);

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function fresh(titles) {
  sandbox.__titles = titles;
  sandbox.resetCanonicalEventTitles_();
}

const key = sandbox.eventTitleMatchKey;
check('w/ with and without a space, and "with"',
  [key('Line Dancing w/ IBX'), key('Line Dancing w/IBX')], [key('Line Dancing with IBX'), key('Line Dancing with IBX')]);
check('stray spaces and case', key('  line   DANCING with  ibx '), key('Line Dancing with IBX'));
check('& is and', key('Arts & Crafts'), key('Arts and Crafts'));
check('w/o is without', key('Tea w/o Sugar'), key('Tea without Sugar'));
check('St is Saint', key('St. Patrick Social'), key('Saint Patrick Social'));
check('weekday short forms', key('Tues Bridge'), key('Tuesday Bridge'));
check('Sun alone is not Sunday', key('Sun Salutations') === key('Sunday Salutations'), false);
check('Sun. is Sunday', key('Sun. Brunch'), key('Sunday Brunch'));
check('a qualified title is NOT the same program', key('Chair Yoga (Beginner)') === key('Chair Yoga'), false);
check('different words stay different', key('Line Dancing with IBX') === key('Line Dancing'), false);
check('empty', key('  '), '');

// parseEventTitle: one spelling out, whichever went in.
fresh([]);
const parse = t => sandbox.parseEventTitle(t).cleanTitle;
const first = parse('Line Dancing w/ IBX');
check('first sight keeps its own spelling', first, 'Line Dancing w/ IBX');
check('the others fold onto it',
  [parse('Line Dancing w/IBX'), parse('Line Dancing with IBX'), parse('Line  Dancing w/ IBX')], [first, first, first]);

// The session table's spelling wins, majority first.
fresh(['Line Dancing w/IBX', 'Line Dancing with IBX', 'Line Dancing with IBX']);
check('the most-used spelling on the table wins', parse('Line Dancing w/ IBX'), 'Line Dancing with IBX');
fresh(['Line Dancing w/IBX', 'Line Dancing with IBX']);
check('a tie is broken alphabetically', parse('Line Dancing w/ IBX'), 'Line Dancing w/IBX');
fresh(['Line Dancing w/IBX']);
check('event ids agree across spellings',
  sandbox.computeEventId('cal', parse('Line Dancing with IBX'), '2026-11-03'),
  sandbox.computeEventId('cal', parse('Line Dancing w/ IBX'), '2026-11-03'));

// Brackets and the tentative mark still come off first.
fresh([]);
check('brackets still stripped', parse('[Club] Mah Jongg w/ Lee'), 'Mah Jongg w/ Lee');
check('and fold', parse('*Mah Jongg with Lee'), 'Mah Jongg w/ Lee');

// The Program_Questions key shares the rule.
check('programTitleMatchKey folds w/', sandbox.programTitleMatchKey('Line Dancing w/IBX'), sandbox.programTitleMatchKey('Line Dancing with IBX'));

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
