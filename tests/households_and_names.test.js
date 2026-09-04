// HOUSEHOLDS, AND THE NAMES PEOPLE ARE ACTUALLY CALLED.
//
// What is pinned here is the part that decides who gets marked present
// alongside somebody else, which is the part that must not be loose:
//
//   * a nickname is lifted out of a parenthetical or a quoted middle, and
//     anything that is plainly not a nickname is left where it is;
//   * two people who share a phone number or an address are a household, and
//     a detail a whole building shares is not a household at all;
//   * a staff override beats the guess in both directions — out of a group it
//     got wrong, and into one it never would have made;
//   * a household of one is not a household;
//   * a correction is remembered, and the next response under the old
//     spelling comes back as the new one.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const props = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d, tz, fmt) => new Date(d).toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (props[k] === undefined ? null : props[k]),
      setProperty: (k, v) => { props[k] = v; },
      setProperties: () => {},
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.parseMemberName = parseMemberName;
this.memberSearchNames = memberSearchNames;
this.buildHouseholdAssignments = buildHouseholdAssignments;
this.householdOverrideIntent = householdOverrideIntent;
this.householdPhoneKey = householdPhoneKey;
this.householdEmailKey = householdEmailKey;
this.rememberMemberNameCorrection = rememberMemberNameCorrection;
this.canonicalMemberName = canonicalMemberName;
this.stampMemberHouseholds = stampMemberHouseholds;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.MEMBER_ROLL_STAFF_COLUMNS = MEMBER_ROLL_STAFF_COLUMNS;
this.HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN = HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// ---------------------------------------------------------------- names
const parse = sandbox.parseMemberName;
check('a parenthetical is a nickname', parse('Bob (Robert) Kaplan'),
  { name: 'Bob Kaplan', nickname: 'Robert' });
check('so is a quoted middle', parse('Robert "Bob" Kaplan'),
  { name: 'Robert Kaplan', nickname: 'Bob' });
check('a surname-first name keeps its comma', parse('Kaplan, Robert (Bob)'),
  { name: 'Kaplan, Robert', nickname: 'Bob' });
check('an ordinary name is left alone', parse('Jane Smith'),
  { name: 'Jane Smith', nickname: '' });
check('a parenthetical with a digit is not a nickname', parse('Jane Smith (2 guests)'),
  { name: 'Jane Smith (2 guests)', nickname: '' });
check('nor is a sentence', parse('Jane Smith (cancelled her afternoon class)'),
  { name: 'Jane Smith (cancelled her afternoon class)', nickname: '' });
check('a name that is nothing BUT a parenthetical keeps what was inside it',
  parse('(Bob)'), { name: 'Bob', nickname: '' });

check('every spelling a person can be found under',
  sandbox.memberSearchNames('Robert (Bob) Kaplan', ''),
  ['Robert (Bob) Kaplan', 'Robert Kaplan', 'Bob']);

// ------------------------------------------------------------ households
const build = sandbox.buildHouseholdAssignments;

const couple = build([
  { key: 'jane smith', name: 'Jane Smith', phone: '(610) 555-0100', email: 'jane@example.com' },
  { key: 'ray smith', name: 'Ray Smith', phone: '610-555-0100', email: '' },
  { key: 'ann lee', name: 'Ann Lee', phone: '610-555-0999', email: 'ann@example.com' }
]);
check('a shared phone number is a household',
  (couple.byKey['jane smith'] || {}).members.map(m => m.key), ['jane smith', 'ray smith']);
check('...with the same id on both rows',
  couple.byKey['jane smith'].id === couple.byKey['ray smith'].id, true);
check('...and the id is derived from the first member, not counted out',
  couple.byKey['ray smith'].id, 'H-JANE-SMITH');
check('somebody who shares nothing is in no household', couple.byKey['ann lee'], undefined);

const byEmail = build([
  { key: 'a a', name: 'A A', email: 'Family@Example.com ', phone: '' },
  { key: 'b b', name: 'B B', email: 'family@example.com', phone: '' }
]);
check('a shared address is a household too, however it was typed',
  (byEmail.byKey['a a'] || {}).members.length, 2);

// The office's own address, typed onto everybody's form by whoever helped
// them fill it in. Grouping on it would put the building in one family.
const shared = [];
for (let i = 0; i < sandbox.HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN; i++) {
  shared.push({ key: `p${i} x`, name: `P${i} X`, email: 'frontdesk@center.org', phone: '' });
}
check('a detail a whole building shares is not a household',
  Object.keys(build(shared).byKey).length, 0);
check('...but one person short of that still is',
  Object.keys(build(shared.slice(0, sandbox.HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN - 1)).byKey).length,
  sandbox.HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN - 1);

const overridden = build([
  { key: 'jane smith', name: 'Jane Smith', phone: '610-555-0100', email: '' },
  { key: 'ray smith', name: 'Ray Smith', phone: '610-555-0100', email: '', override: 'none' }
]);
check('a staff "none" leaves somebody out of a group the guess made',
  Object.keys(overridden.byKey).length, 0);

const declared = build([
  { key: 'ann lee', name: 'Ann Lee', phone: '610-555-0001', email: '', override: 'Lee' },
  { key: 'ben lee', name: 'Ben Lee', phone: '610-555-0002', email: '', override: ' lee ' },
  { key: 'cal roe', name: 'Cal Roe', phone: '610-555-0003', email: '' }
]);
check('two people who share nothing can still be declared a household',
  (declared.byKey['ann lee'] || {}).members.map(m => m.key), ['ann lee', 'ben lee']);
check('...and it does not sweep anybody else in', declared.byKey['cal roe'], undefined);

check('a person on their own is not a household',
  Object.keys(build([{ key: 'solo one', name: 'Solo One', phone: '610-555-1234' }]).byKey).length, 0);

check('an override that says "own" is a solo answer',
  sandbox.householdOverrideIntent('Own'), { solo: true });
check('anything else is the name of a household',
  sandbox.householdOverrideIntent('The  Smiths'), { group: 'the smiths' });
check('a blank is no answer at all', sandbox.householdOverrideIntent('  '), {});

check('a nine-digit phone number is not an identity', sandbox.householdPhoneKey('555-0100'), '');
check('and a note in the email column is not an address',
  sandbox.householdEmailKey('ask her daughter'), '');

// --------------------------------------------------- onto the actual tab
const headers = sandbox.HEADERS.Member_Roll;
const map = sandbox.getIndexMap(headers);
const rowFor = (name, phone, email, override) => {
  const row = new Array(headers.length).fill('');
  row[map['Name']] = name;
  row[map['Phone']] = phone;
  row[map['Email']] = email;
  row[map['Household_Override']] = override || '';
  return row;
};
const rows = [
  rowFor('Jane Smith', '610-555-0100', 'jane@example.com'),
  rowFor('Ray Smith', '610-555-0100', ''),
  rowFor('Ann Lee', '', 'ann@example.com')
];
sandbox.stampMemberHouseholds(rows, headers);
check('the household cell names the OTHER people in it, never this row',
  [rows[0][map['Household']], rows[1][map['Household']], rows[2][map['Household']]],
  ['Ray Smith', 'Jane Smith', '']);
check('and the id is the same on both rows of one household',
  rows[0][map['Household_ID']] === rows[1][map['Household_ID']] &&
  rows[0][map['Household_ID']] !== '', true);
check('a person in no household gets no id', rows[2][map['Household_ID']], '');

check('Display_Name and Household_Override are the staff\'s own',
  sandbox.MEMBER_ROLL_STAFF_COLUMNS.indexOf('Display_Name') !== -1 &&
  sandbox.MEMBER_ROLL_STAFF_COLUMNS.indexOf('Household_Override') !== -1, true);

// --------------------------------------------------------- corrections
sandbox.rememberMemberNameCorrection('Bob Kaplin', 'Robert Kaplan');
check('a response under the old spelling comes back as the new one',
  sandbox.canonicalMemberName(' bob   kaplin '), 'Robert Kaplan');
check('a name nobody corrected is used exactly as typed',
  sandbox.canonicalMemberName('Jane Smith'), 'Jane Smith');
sandbox.rememberMemberNameCorrection('Robert Kaplan', 'Robert Kaplan Jr');
check('a name corrected twice never points at the spelling in the middle',
  sandbox.canonicalMemberName('Bob Kaplin'), 'Robert Kaplan Jr');

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll household and name checks passed.');
process.exit(failures ? 1 : 0);
