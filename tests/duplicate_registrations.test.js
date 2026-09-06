// COLLAPSING TWO REGISTRANT ROWS INTO ONE.
//
// The whole feature is a judgement about identity followed by a merge, and
// both halves can lose something real. Judge too loosely and two people who
// share a name become one, with one seat and one meal between them. Merge
// carelessly and the meals DOUBLE (two records of one person's lunch, added
// up) or the desk's attendance tick is dropped because it was on the row that
// went. So both are pinned here: what counts as the same person, and what a
// merged row is holding afterwards.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d, tz, p) => d.toISOString().slice(0, 10), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.duplicateRegistrationKey = duplicateRegistrationKey;
this.isDeadRegistrationRow = isDeadRegistrationRow;
this.mergeRegistrantRow = mergeRegistrantRow;
this.pickSurvivingRegistrantRow = pickSurvivingRegistrantRow;
this.describeDuplicateRegistrationGroup = describeDuplicateRegistrationGroup;
this.buildDuplicateRegistrationsHtml = buildDuplicateRegistrationsHtml;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { console.log('ok   ' + name); return; }
  failures++; console.log('FAIL ' + name + '\n     expected ' + e + '\n     actual   ' + a);
}
function checkTrue(name, value) { check(name, !!value, true); }

const headers = sandbox.HEADERS.All_Registrants;
const map = sandbox.getIndexMap(headers);
function rowWith(values) {
  const row = new Array(headers.length).fill('');
  Object.keys(values).forEach(h => { row[map[h]] = values[h]; });
  return row;
}
const keyOf = values => sandbox.duplicateRegistrationKey(rowWith(values), map);

// ---------------------------------------------------------------------------
// WHO IS THE SAME PERSON.
// ---------------------------------------------------------------------------
check('the same name typed twice is one person',
  keyOf({ Event_ID: 'e1', Name: 'Bob Smith' }) === keyOf({ Event_ID: 'e1', Name: ' bob   smith ' }), true);
// The parenthetical is the case this was asked for: the form has one spelling
// and the desk types another, and they are unmistakably one man.
check('a nickname in brackets is the same person',
  keyOf({ Event_ID: 'e1', Name: 'Bob (Robert) Smith' }) === keyOf({ Event_ID: 'e1', Name: 'Bob Smith' }), true);
check('...and so is a quoted one',
  keyOf({ Event_ID: 'e1', Name: 'Robert "Bob" Smith' }) === keyOf({ Event_ID: 'e1', Name: 'Robert Smith' }), true);
check('two sessions are never one registration',
  keyOf({ Event_ID: 'e1', Name: 'Bob Smith' }) === keyOf({ Event_ID: 'e2', Name: 'Bob Smith' }), false);
// A registrant and their guest share a session and often a surname.
check('a guest is not their registrant',
  keyOf({ Event_ID: 'e1', Name: 'Bob Smith', Person_Type: 'Guest' }) ===
  keyOf({ Event_ID: 'e1', Name: 'Bob Smith', Person_Type: 'Registrant' }), false);
check('a row with no session cannot be judged at all', keyOf({ Name: 'Bob Smith' }), '');
check('nor can a row with no name', keyOf({ Event_ID: 'e1' }), '');

// A cancellation is history, not a duplicate — see section 71.
checkTrue('a cancelled row never groups with a live one',
  sandbox.isDeadRegistrationRow(rowWith({ Program_Status: 'Cancelled' }), map));
checkTrue('...and neither does a superseded one',
  sandbox.isDeadRegistrationRow(rowWith({ Program_Status: 'Superseded' }), map));
checkTrue('an active row is live',
  !sandbox.isDeadRegistrationRow(rowWith({ Program_Status: 'Active' }), map));

// ---------------------------------------------------------------------------
// WHAT THE MERGED ROW HOLDS.
// ---------------------------------------------------------------------------
const kept = rowWith({
  Event_ID: 'e1', Name: 'Bob Smith', Program_Status: 'Waitlisted', Party_ID: 'r1',
  Meals_Ordered: 1, Day1_Dined_In: 1, Attended: false, Admin_Notes: 'Uses a walker.'
});
const absorbed = rowWith({
  Event_ID: 'e1', Name: 'Bob (Robert) Smith', Program_Status: 'Active',
  Meals_Ordered: 1, Day1_Dined_In: 1, Attended: true, Phone: '610-555-0100',
  Admin_Notes: 'Paid in cash.'
});
sandbox.mergeRegistrantRow(kept, absorbed, map);

// THE ONE THAT COSTS MONEY IF IT IS WRONG. Two rows are two RECORDS of one
// person's lunch, so the meals are the maximum and never the sum.
check('meals take the highest count, never the total', kept[map['Meals_Ordered']], 1);
check('...and so does each meal column', kept[map['Day1_Dined_In']], 1);
// A tick on either row is a tick: the desk marked one of the two rows.
check('a mark on the row that goes is kept', kept[map['Attended']], true);
// An empty cell is not an answer, so filling it in is never a loss.
check('a blank cell takes the other row’s value', kept[map['Phone']], '610-555-0100');
// Both were typed by a person; choosing between them is how a note is lost.
check('two typed notes are joined, not picked',
  kept[map['Admin_Notes']], 'Uses a walker.\nPaid in cash.');
// A stale waitlist row must not take a seat back off somebody who has one.
check('the most active status wins', kept[map['Program_Status']], 'Active');
// And the row's own identity is untouched.
check('the surviving row keeps its own name and response', 
  [kept[map['Name']], kept[map['Party_ID']]], ['Bob Smith', 'r1']);

// The same note on both rows is one note.
const twice = rowWith({ Admin_Notes: 'Uses a walker.' });
sandbox.mergeRegistrantRow(twice, rowWith({ Admin_Notes: 'Uses a walker.' }), map);
check('the same note on both is not doubled', twice[map['Admin_Notes']], 'Uses a walker.');

// The survivor is the row the import will go on updating.
const withResponse = rowWith({ Event_ID: 'e1', Name: 'Bob Smith', Party_ID: 'r9' });
const walkIn = rowWith({ Event_ID: 'e1', Name: 'Bob Smith', Phone: '1', Email: 'b@e.com', Attended: true });
check('the row that came from a form response survives',
  sandbox.pickSurvivingRegistrantRow([walkIn, withResponse], map)[map['Party_ID']], 'r9');

// ---------------------------------------------------------------------------
// The dialog is a template literal with names typed by the public in it.
// ---------------------------------------------------------------------------
const html = sandbox.buildDuplicateRegistrationsHtml([{
  key: 'e1|o\'brien|', label: `Mary O'Brien </script><script>alert(1)</script>`, detail: ['<b>x</b>'], count: 2
}]);
checkTrue('a name cannot end the page mid-sentence', html.indexOf('<script>alert(1)') === -1);
checkTrue('...and neither can a row description', html.indexOf('<b>x</b>') === -1);

console.log(failures === 0 ? '\nAll duplicate registration checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
