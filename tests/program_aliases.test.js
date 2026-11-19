// ONE PROGRAM, MORE THAN ONE TITLE (section 99zzc).
//
//   A TITLE STAFF LISTED IN A PROGRAM'S Also_Known_As FILES UNDER THAT PROGRAM,
//   at that building only, so its sessions reach the program's one roster.
//
//   A "CANCELLED…:" STATUS WORD IS NOT PART OF THE NAME.
//
//   AMBIGUITY IS REFUSED: a title listed under two programs at one building
//   files under its own name.
//
//   A TITLE WITH NO ALIAS KEYS EXACTLY AS BEFORE — no registry entry moves.
//
//   THE PUSH LEAVES A MERGED-AWAY SHEET ALONE rather than writing it empty.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}\n       expected ${e}\n       got      ${a}`);
  }
}

const sandbox = {
  console: { log: () => {} },
  Utilities: { getUuid: () => 'uuid-1', sleep: () => {}, formatDate: d => d.toISOString().slice(0, 10) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => '' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, MimeType: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.PROGRAM_SETTINGS_STAFF_COLUMNS = PROGRAM_SETTINGS_STAFF_COLUMNS;
this.buildProgramAliasIndex = buildProgramAliasIndex;
this.canonicalProgramTitle = canonicalProgramTitle;
this.stripProgramStatusPrefix = stripProgramStatusPrefix;
this.programTitleIsFiledElsewhere = programTitleIsFiledElsewhere;
this.leaderProgramKey = leaderProgramKey;
this.useAliasRows = function (rows) {
  __programAliasIndex = buildProgramAliasIndex(rows, HEADERS.Program_Settings);
};
this.forgetAliases = function () { invalidateProgramAliasIndex(); };
this.invalidateNotificationPolicyCache = invalidateNotificationPolicyCache;
this.peekAliasIndex = function () { return __programAliasIndex; };
`, sandbox);

const headers = sandbox.HEADERS.Program_Settings;
const col = name => headers.indexOf(name);
function settingsRow(event, location, alsoKnownAs) {
  const row = new Array(headers.length).fill('');
  row[col('Event')] = event;
  row[col('Location')] = location;
  row[col('Also_Known_As')] = alsoKnownAs || '';
  return row;
}

console.log('the column');
check('Program_Settings has Also_Known_As', col('Also_Known_As') !== -1, true);
check('and it is a staff column, carried across every redraw',
  sandbox.PROGRAM_SETTINGS_STAFF_COLUMNS.indexOf('Also_Known_As') !== -1, true);

console.log('with no aliases, nothing changes');
sandbox.useAliasRows([settingsRow('Chair Yoga', 'Narberth', '')]);
check('a plain title keys as it always did',
  sandbox.leaderProgramKey('Chair Yoga', 'Narberth'), 'chair yoga|narberth');
check('spacing and case still fold the same way',
  sandbox.leaderProgramKey('  Chair   YOGA ', 'Narberth'), 'chair yoga|narberth');

console.log('an alias files under its program, at that building only');
sandbox.useAliasRows([
  settingsRow('Medicare Counseling', 'Ashbridge', 'Medicare Counseling (by appt.), Medicare Help'),
  settingsRow('Medicare Counseling', 'Narberth', '')
]);
check('the alias reaches the program\'s key',
  sandbox.leaderProgramKey('Medicare Counseling (by appt.)', 'Ashbridge'), 'medicare counseling|ashbridge');
check('so do the other titles in the cell',
  sandbox.leaderProgramKey('medicare help', 'Ashbridge'), 'medicare counseling|ashbridge');
check('the program\'s own title is unchanged',
  sandbox.leaderProgramKey('Medicare Counseling', 'Ashbridge'), 'medicare counseling|ashbridge');
check('the same title at another building is NOT merged',
  sandbox.leaderProgramKey('Medicare Counseling (by appt.)', 'Narberth'), 'medicare counseling (by appt.)|narberth');
check('the canonical title is the row\'s Event, as spelled there',
  sandbox.canonicalProgramTitle('Medicare Counseling (by appt.)', 'Ashbridge'), 'Medicare Counseling');
check('a title filed elsewhere is said to be',
  sandbox.programTitleIsFiledElsewhere('Medicare Counseling (by appt.)', 'Ashbridge'), true);
check('and the program\'s own title is not',
  sandbox.programTitleIsFiledElsewhere('Medicare Counseling', 'Ashbridge'), false);

console.log('a status word before a colon is not the name');
check('CANCELLED DUE TO ILLNESS:', sandbox.stripProgramStatusPrefix("CANCELLED DUE TO ILLNESS:T'ai Chi 1 - Open to All"),
  "T'ai Chi 1 - Open to All");
check('Canceled - weather:', sandbox.stripProgramStatusPrefix('Canceled - weather: Walking Club'), 'Walking Club');
check('no colon, no change', sandbox.stripProgramStatusPrefix('Cancelled Plans Book Club'), 'Cancelled Plans Book Club');
check('nothing after the colon, no change', sandbox.stripProgramStatusPrefix('CANCELLED:'), 'CANCELLED:');
check('the cancelled date files with its program',
  sandbox.leaderProgramKey("CANCELLED DUE TO ILLNESS:T'ai Chi 1 - Open to All", 'Ashbridge'),
  sandbox.leaderProgramKey("T'ai Chi 1 - Open to All", 'Ashbridge'));
check('and is filed elsewhere',
  sandbox.programTitleIsFiledElsewhere("CANCELLED DUE TO ILLNESS:T'ai Chi 1 - Open to All", 'Ashbridge'), true);

console.log('ambiguity is refused');
const idx = sandbox.buildProgramAliasIndex([
  settingsRow('Computer Tech Support', 'Ashbridge', 'Tech Help'),
  settingsRow('Phone Help', 'Ashbridge', 'Tech Help'),
  settingsRow('Knit & Chat', 'Ashbridge', 'Knit & Chat')
], headers);
check('a title under two programs at one building is dropped', idx.aliases['tech help|ashbridge'], undefined);
check('and named as ambiguous', idx.ambiguous, ['tech help|ashbridge']);
check('a row listing its own name adds nothing', Object.keys(idx.aliases), []);
check('an ambiguous title files under its own name',
  sandbox.canonicalProgramTitle('Tech Help', 'Ashbridge', idx), 'Tech Help');

console.log('the memo is forgotten when Program_Settings is rewritten');
sandbox.useAliasRows([settingsRow('Medicare Counseling', 'Ashbridge', 'Medicare Counseling (by appt.)')]);
sandbox.invalidateNotificationPolicyCache();
check('invalidateNotificationPolicyCache() drops the alias memo too', sandbox.peekAliasIndex(), undefined);
check('with no workbook, no alias applies and nothing throws',
  sandbox.leaderProgramKey('Medicare Counseling (by appt.)', 'Ashbridge'), 'medicare counseling (by appt.)|ashbridge');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
