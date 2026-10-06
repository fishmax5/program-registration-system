// BULK MANUAL REGISTRANTS (99q) — the paste, the roll match, the grouping and
// which dates a person is put on. The writes themselves are Quick Mark's
// Register (applyQuickMarkLocked), pinned by its own tests.
const vm = require('vm');
const assert = require('assert');
const { readSource } = require('./helpers/source');

const RealDate = Date;
const NOW = new RealDate(2026, 8, 9, 9, 0, 0);
const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return `${d.getMonth() + 1}/${d.getDate()}`;
    },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {},
    Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'u'
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {},
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(readSource(), sandbox);
const run = code => vm.runInContext(code, sandbox);

// 1. The paste: header, no header, "Last, First" in one cell, shapes.
let people = run(`parseBulkRegistrantPaste('First,Last,Phone,Email\\nJane,Smith,610-555-0100,jane@x.org\\nBob,Kaplan,,')`);
assert.strictEqual(people.length, 2);
assert.strictEqual(people[0].name, 'Jane Smith');
assert.strictEqual(people[0].phone, '610-555-0100');
assert.strictEqual(people[0].email, 'jane@x.org');
people = run(`parseBulkRegistrantPaste('"Smith, Jane"\\tjane@x.org\\t610 555 0100')`);
assert.strictEqual(people[0].name, 'Jane Smith', 'Last, First is read as a name');
assert.strictEqual(people[0].email, 'jane@x.org', 'an email is recognized in the phone column');
assert.strictEqual(run(`parseBulkRegistrantPaste('Name\\n,\\n')`).length, 0, 'a nameless row is dropped');

// 2. The match.
const out = JSON.parse(run(`(() => {
  const map = getIndexMap(HEADERS.Member_Roll);
  const row = (name, phone, email) => { const r = new Array(HEADERS.Member_Roll.length).fill('');
    r[map['Name']] = name; r[map['Phone']] = phone; r[map['Email']] = email; r[map['Status']] = 'Active'; return r; };
  const roll = [row('Jane Smith', '6105550100', ''), row('Robert Kaplan', '', 'rk@x.org'), row('Mary Lee', '', '')];
  return JSON.stringify(matchBulkRegistrantsToRoll([
    { name: 'jane smith' }, { name: 'Bob Kaplan', email: 'RK@x.org' },
    { name: 'Mark Lee' }, { name: 'Ann Novak' }, { name: 'Bob Jones', phone: '(610) 555-0100' }
  ], roll, map, {}));
})()`));
assert.deepStrictEqual(out.map(p => p.match), ['exact', 'contact', 'similar', 'new', 'contact']);
assert.strictEqual(out[0].suggested, 'Jane Smith', 'exact uses the roll spelling');
assert.strictEqual(out[1].suggested, 'Robert Kaplan', 'a single contact match is pre-selected');
assert.strictEqual(out[2].suggested, 'Mark Lee', 'a similar name is offered, never chosen');
assert.deepStrictEqual(out[2].candidates, ['Mary Lee']);
assert.strictEqual(out[4].suggested, 'Jane Smith', 'phone matched on digits');

// 3. Grouping: two buildings stay two programs; past, lunch and appointment rows are left out.
const programs = JSON.parse(run(`JSON.stringify(groupBulkRegistrantPrograms_([
  { label: 'Yoga · 9/15', title: 'Yoga', dateKey: '2026-09-15', location: 'A' },
  { label: 'Yoga · 9/22', title: 'Yoga', dateKey: '2026-09-22', location: 'A' },
  { label: 'Yoga · 9/15', title: 'Yoga', dateKey: '2026-09-15', location: 'B' },
  { label: 'Yoga · 9/1',  title: 'Yoga', dateKey: '2026-09-01', location: 'A' },
  { label: 'Lunch · 9/15', title: 'Lunch', dateKey: '2026-09-15', location: 'A', lunchOnly: true },
  { label: 'Help · 9/15', title: 'Help', dateKey: '2026-09-15', location: 'A', appointment: {} },
  { label: 'Yoga · 12/1', title: 'Yoga', dateKey: '2026-12-01', location: 'A' }
]))`));
assert.strictEqual(programs.length, 2);
assert.deepStrictEqual(programs[0].sessions.map(s => s.dateKey), ['2026-09-15', '2026-09-22']);

// 4. Which dates.
const p = JSON.stringify(programs[0]);
const keys = rec => JSON.parse(run(`JSON.stringify(bulkRegistrantSessionsFor(${p}, '${rec}', ['2026-09-22', '2027-01-01']))`)).map(s => s.dateKey);
assert.deepStrictEqual(keys('next'), ['2026-09-15']);
assert.deepStrictEqual(keys('club'), ['2026-09-15']);
assert.deepStrictEqual(keys('all'), ['2026-09-15', '2026-09-22']);
assert.deepStrictEqual(keys('picked'), ['2026-09-22'], 'a date the program does not have is ignored');

// 5. Nothing from the workbook is interpolated into the dialog.
assert.ok(!/\$\{/.test(run('buildBulkRegistrantsHtml()')));

// 6. Columns: guessed from a header, from shape without one, and the mapping obeyed.
let cols = JSON.parse(run(`JSON.stringify(readBulkRegistrantColumns('Participant,Tel,Notes\\nJane Smith,610-555-0100,x'))`));
assert.deepStrictEqual(cols.fields, ['name', 'phone', ''], 'a header line is read; an unknown heading is ignored');
assert.strictEqual(cols.hasHeader, true);
cols = JSON.parse(run(`JSON.stringify(readBulkRegistrantColumns('jane@x.org,Jane,Smith,610 555 0100\\nbob@x.org,Bob,Kaplan,'))`));
assert.deepStrictEqual(cols.fields, ['email', 'first', 'last', 'phone'], 'two single-word columns are First and Last');
assert.strictEqual(cols.hasHeader, false);
cols = JSON.parse(run(`JSON.stringify(readBulkRegistrantColumns('Jane Smith,Monday group\\nBob Kaplan,Tuesday group'))`));
assert.deepStrictEqual(cols.fields, ['name', ''], 'one Name column; a second text column is left for the person to map');
people = JSON.parse(run(`JSON.stringify(peopleFromBulkRecords(
  [['Last','First','Mid','Phone'], ['Smith','Jane','Marie','610'], ['Kaplan','Bob','','']],
  ['last', 'first', 'first', ''], true))`));
assert.strictEqual(people[0].name, 'Jane Marie Smith', 'a name part mapped twice is joined');
assert.strictEqual(people[0].phone, '', 'an ignored column is ignored');
assert.strictEqual(people[0].line, 2, 'row numbers count the header line');
assert.strictEqual(people[1].name, 'Bob Kaplan');

// 7. Already registered: live rows on this program only, by person and date; standing places too.
const already = JSON.parse(run(`(() => {
  const rm = getIndexMap(HEADERS.All_Registrants);
  const reg = (name, date, loc, title, status, type) => { const r = new Array(HEADERS.All_Registrants.length).fill('');
    r[rm['Name']] = name; r[rm['Event_Date']] = new Date(date + 'T10:00:00'); r[rm['Location']] = loc;
    r[rm['Event']] = title; r[rm['Program_Status']] = status || 'Active'; r[rm['Person_Type']] = type || ''; return r; };
  const cm = getIndexMap(HEADERS.Club_Members);
  const club = (name, title, loc, active) => { const r = new Array(HEADERS.Club_Members.length).fill('');
    r[cm['Name']] = name; r[cm['Club']] = title; r[cm['Location']] = loc; r[cm['Active']] = active; return r; };
  const program = { title: 'Yoga', location: 'A', sessions: [{ dateKey: '2026-09-15' }, { dateKey: '2026-09-22' }] };
  const lookup = buildBulkRegistrantAlreadyIndex_(program, [
    reg('Jane Smith', '2026-09-15', 'A', 'Yoga'),
    reg('Jane Smith', '2026-09-22', 'A', 'Yoga', 'Waitlisted'),
    reg('Bob Kaplan', '2026-09-15', 'A', 'Yoga', 'Cancelled'),
    reg('Ann Novak', '2026-09-15', 'B', 'Yoga'),
    reg('Ann Novak', '2026-09-15', 'A', 'Bingo'),
    reg('Mary Lee', '2026-09-15', 'A', 'Yoga', 'Active', 'Guest')
  ], rm, [club('Robert Kaplan', 'Yoga', 'A', true), club('Mary Lee', 'Yoga', 'A', false)], cm);
  return JSON.stringify(['jane smith', 'Bob Kaplan', 'Ann Novak', 'Mary Lee', 'Robert Kaplan'].map(lookup));
})()`));
assert.deepStrictEqual(already[0].alreadyOn, { '2026-09-15': 'Active', '2026-09-22': 'Waitlisted' });
assert.deepStrictEqual(already[1].alreadyOn, {}, 'a cancelled row is not a registration');
assert.deepStrictEqual(already[2].alreadyOn, {}, 'another building or another program is not this one');
assert.deepStrictEqual(already[3].alreadyOn, {}, 'a guest row is somebody else');
assert.strictEqual(already[3].standing, false, 'an inactive membership is not a standing place');
assert.strictEqual(already[4].standing, true);
assert.strictEqual(already[0].nameKey, already[0].nameKey && run(`duplicateRegistrationNameKey('Jane Smith')`));

console.log('bulk_manual_registrants: all passed');

// 9. An Excel file: the first VISIBLE sheet, shared + inline strings, gaps kept,
//    a number read as its digits, a comma kept inside its cell.
{
  const parts = {
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets>' +
      '<sheet name="Old" sheetId="1" state="hidden" r:id="rId1"/>' +
      '<sheet name="Sign-ups" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships>' +
      '<Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="ws" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Phone</t></si><si><t>Email</t></si>' +
      '<si><r><t>Smith, </t></r><r><t xml:space="preserve">Jane</t></r><rPh><t>X</t></rPh></si>' +
      '<si><t>O&apos;Brien &amp; Co</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>WRONG</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>6105550100</v></c><c r="C2" t="inlineStr"><is><t>jane@x.org</t></is></c></row>' +
      '<row r="3" spans="1:3"/>' +
      '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="C4" t="inlineStr"><is><t>ob@x.org</t></is></c></row>' +
      '</sheetData></worksheet>'
  };
  sandbox.__xlsxParts = parts;
  sandbox.Utilities.base64Decode = () => [1];
  sandbox.Utilities.newBlob = () => ({});
  sandbox.Utilities.unzip = () => Object.keys(sandbox.__xlsxParts).map(name => ({
    getName: () => name, getDataAsString: () => sandbox.__xlsxParts[name]
  }));
  const res = JSON.parse(run(`JSON.stringify(readBulkRegistrantXlsx('AAAA'))`));
  assert.strictEqual(res.sheetName, 'Sign-ups', 'the hidden sheet is skipped');
  assert.strictEqual(res.hasHeader, true);
  assert.deepStrictEqual(res.fields, ['name', 'phone', 'email']);
  assert.deepStrictEqual(res.records[1], ['Smith, Jane', '6105550100', 'jane@x.org'], 'rich text joined, phonetic dropped, comma kept');
  assert.deepStrictEqual(res.records[2], ["O'Brien & Co", '', 'ob@x.org'], 'entities decoded and the skipped column kept');
  assert.strictEqual(res.records.length, 3, 'an empty row is dropped');
  const ppl = JSON.parse(run(`JSON.stringify(peopleFromBulkRecords(${JSON.stringify(res.records)}, ${JSON.stringify(res.fields)}, true))`));
  assert.strictEqual(ppl[0].name, 'Jane Smith');

  // A one-column sheet of "Last, First" stays one column.
  parts['xl/worksheets/sheet2.xml'] = '<worksheet><sheetData><row><c t="s"><v>3</v></c></row></sheetData></worksheet>';
  const one = JSON.parse(run(`JSON.stringify(readBulkRegistrantXlsx('AAAA'))`));
  assert.deepStrictEqual(one.records, [['Smith, Jane']]);

  sandbox.Utilities.unzip = () => { throw new Error('not a zip'); };
  assert.throws(() => run(`readBulkRegistrantXlsx('AAAA')`), /could not be opened as an Excel workbook/);
}
console.log('bulk xlsx: ok');
