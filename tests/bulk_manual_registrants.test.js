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

// ---------------------------------------------------------------------------
// 10. ATTENDED IS A FACT ABOUT A DAY (99q's banner). The pure rule: a tick
//     reaches today and anything earlier, and no future date at all.
// ---------------------------------------------------------------------------
{
  const sessions = JSON.stringify([
    { dateKey: '2026-09-01', dateLabel: 'Sep 1' },   // past
    { dateKey: '2026-09-09', dateLabel: 'Sep 9' },   // today
    { dateKey: '2026-09-22', dateLabel: 'Sep 22' },  // still to come
    { dateLabel: 'no date at all' }
  ]);
  const keys = today => JSON.parse(run(`JSON.stringify(bulkRegistrantAttendedDateKeys(${sessions}, '${today}'))`));
  assert.deepStrictEqual(keys('2026-09-09'), ['2026-09-01', '2026-09-09'],
    'today and earlier are marked; a future date never is');
  assert.deepStrictEqual(keys('2026-09-30'), ['2026-09-01', '2026-09-09', '2026-09-22'],
    'the rule is today-or-earlier, not today alone');
  assert.deepStrictEqual(keys('2026-08-01'), [], 'nothing has happened yet');
  assert.deepStrictEqual(keys(''), [],
    'no stated today means nothing may be marked — never the tablet\'s own guess');
  assert.deepStrictEqual(JSON.parse(run(`JSON.stringify(bulkRegistrantAttendedDateKeys(null, '2026-09-09'))`)), []);
}

// 11. The workbook's own today rides out with the programs, which is what lets
//     the dialog grey a box rather than ask the browser what day it is.
assert.strictEqual(programs[0].todayKey, '2026-09-09');

// ---------------------------------------------------------------------------
// 12. THE REVIEW STEP'S TWO ATTENDED CONTROLS, run against a fake DOM.
//
//     A string search of the template could not tell a select-all that sets
//     every row from a checkbox that merely sits near the word, so the
//     dialog's own script is executed here and its controls pressed: the
//     header tick sets every row, a row's own tick disagrees with it, and a
//     row whose chosen dates are all still to come is greyed out and sends
//     nothing — the same rule the server applies when it writes.
// ---------------------------------------------------------------------------
{
  const html = run('buildBulkRegistrantsHtml()');
  const open = html.indexOf('<script>');
  const script = html.substring(open + '<script>'.length, html.indexOf('</script>', open));

  // The column and the header control are on screen at all, and the rule is
  // said in words where somebody ticking it can read it.
  assert.ok(/id="attended"/.test(html), 'the list-wide attended control exists');
  assert.ok(/Attended today/.test(html), 'the review column says which day it is about');
  assert.ok(/today or earlier/.test(html), 'the screen states the rule');

  let doc = null;
  class Node {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.children = []; this.parentNode = null; this.attrs = {}; this.style = {};
      this.className = ''; this._text = ''; this.value = ''; this.checked = false;
      this.disabled = false; this.title = ''; this.dataset = {}; this.listeners = {};
      this.files = null;
    }
    set id(v) { this.attrs.id = v; } get id() { return this.attrs.id || ''; }
    set type(v) { this.attrs.type = v; } get type() { return this.attrs.type || ''; }
    set textContent(v) { this._text = String(v); this.children = []; }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    get options() { return this.children.filter(c => c.tagName === 'OPTION'); }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
    fire(t) { (this.listeners[t] || []).forEach(fn => fn.call(this, { type: t })); }
    walk(fn) { fn(this); this.children.forEach(c => c.walk(fn)); }
  }
  const body = new Node('body');
  ['setup', 'program', 'recurrenceRow', 'recurrence', 'lunch', 'attended', 'dates', 'file', 'csv',
   'read', 'mapping', 'hasHeader', 'columns', 'check', 'reviewBox', 'review', 'commit', 'progress',
   'progTitle', 'barFill', 'progText', 'log', 'stop', 'carryOn', 'another', 'status']
    .forEach(id => { const n = new Node('div'); n.id = id; body.appendChild(n); });
  const all = () => { const out = []; body.walk(n => out.push(n)); return out; };
  doc = {
    body,
    createElement: tag => new Node(tag),
    createTextNode: text => { const n = new Node('#text'); n._text = String(text); return n; },
    getElementById: id => all().find(n => n.id === id) || null,
    // The one selector the page uses: the ticked date boxes.
    querySelectorAll: sel => {
      assert.strictEqual(sel, 'input.date:checked', `unexpected selector ${sel}`);
      return all().filter(n => n.tagName === 'INPUT' && n.className === 'date' && n.checked);
    },
    addEventListener: () => {}
  };
  // google.script.run, with the two boot calls answered by hand so the page
  // holds the programs the server would have sent.
  const PROGRAM = {
    key: 'A|Yoga', title: 'Yoga', location: 'A', label: 'Yoga — A (2 upcoming)',
    todayKey: '2026-09-09',
    sessions: [{ value: 'Yoga · 9/9', dateKey: '2026-09-09', dateLabel: 'Sep 9' },
               { value: 'Yoga · 9/22', dateKey: '2026-09-22', dateLabel: 'Sep 22' }]
  };
  let started = null;
  const runner = () => {
    let onSuccess = null;
    const api = new Proxy({}, {
      get: (t, k) => {
        if (k === 'withSuccessHandler') return fn => { onSuccess = fn; return api; };
        if (k === 'withFailureHandler') return () => api;
        if (k === 'bulkRegistrantsStatus') return () => { if (onSuccess) onSuccess({ exists: false }); };
        if (k === 'listBulkRegistrantPrograms') return () => { if (onSuccess) onSuccess([PROGRAM]); };
        if (k === 'startBulkRegistrants') return args => { started = args; if (onSuccess) onSuccess({ ok: true, exists: true, active: false, done: true, lines: [] }); };
        return () => {};
      }
    });
    return api;
  };
  const page = {
    document: doc,
    google: { script: { get run() { return runner(); } } },
    confirm: () => true,
    setInterval: () => 1, clearInterval: () => {},
    FileReader: function () {}, Number, JSON, Math, Object, Array, String, Date, Set, console,
    assert
  };
  page.window = page;
  vm.createContext(page);
  vm.runInContext(script, page, { filename: 'bulk-registrants.js' });

  const $ = id => doc.getElementById(id);
  // A real <select> opens on its first option, which is "Next date only".
  $('recurrence').value = 'next';
  // The programs arrived, so the dialog knows what day the workbook is on.
  assert.strictEqual(vm.runInContext('TODAY', page), '2026-09-09');

  // Choose the program (which draws its date boxes), then hand the page a
  // reviewed list the way previewBulkRegistrants would have.
  $('program').value = 'A|Yoga';
  $('program').fire('change');
  const dateBoxes = doc.querySelectorAll('input.date:checked');
  assert.strictEqual(dateBoxes.length, 2, 'both dates drawn and ticked');

  vm.runInContext(`PEOPLE = [
    { name: 'Ann Test', line: 1, match: 'new', phone: '', email: '',
      options: [{ name: 'Ann Test', label: 'Ann Test', nameKey: 'ann|test', alreadyOn: {}, standing: false }] },
    { name: 'Bob Test', line: 2, match: 'new', phone: '', email: '',
      options: [{ name: 'Bob Test', label: 'Bob Test', nameKey: 'bob|test', alreadyOn: {}, standing: false }] },
    { name: 'Cal Test', line: 3, match: 'new', phone: '', email: '',
      options: [{ name: 'Cal Test', label: 'Cal Test', nameKey: 'cal|test', alreadyOn: {}, standing: false }] }
  ]; drawReview();`, page);
  const rows = () => vm.runInContext('ROWS', page);
  // Arrays made inside the vm context belong to its own realm, so the flags
  // are copied out before they are compared.
  const flags = () => Array.from(rows().map(r => !!r.att.checked));
  assert.strictEqual(rows().length, 3);

  // Nothing is ticked attended until somebody asks for it.
  assert.deepStrictEqual(flags(), [false, false, false],
    'attended is never on by default — a row that arrives ticked is a row somebody taps past');

  // (a) THE SELECT-ALL SETS EVERY ROW.
  $('attended').checked = true;
  $('attended').fire('change');
  assert.deepStrictEqual(flags(), [true, true, true],
    'the header tick sets every row');

  // (b) A PER-ROW TICK DISAGREES WITH IT, and survives every later redraw of
  //     the notes — the header is a starting point, not an override.
  rows()[1].att.checked = false;
  rows()[1].att.fire('change');
  assert.deepStrictEqual(flags(), [true, false, true],
    'a row unticked by hand stays unticked');
  $('recurrence').fire('change');
  assert.deepStrictEqual(flags(), [true, false, true],
    'and is not quietly restored by a recalculation');

  // (c) A FUTURE-ONLY ROW CANNOT BE MARKED. Untick today's date and put row 3
  //     on "the dates ticked below", which leaves it with Sep 22 alone.
  dateBoxes[0].checked = false;
  rows()[2].rec.value = 'picked';
  rows()[2].rec.fire('change');
  assert.strictEqual(rows()[0].att.disabled, false, 'row 1 is still on today ("next date")');
  assert.strictEqual(rows()[2].att.disabled, true, 'a row with no date today or earlier is greyed out');
  assert.strictEqual(rows()[2].att.checked, false, 'and is not shown as something that will happen');
  assert.ok(/no day to mark/.test(rows()[2].att.title), rows()[2].att.title);
  assert.ok(/Sep 9/.test(rows()[0].att.title), rows()[0].att.title);

  // (d) WHAT COMMIT SENDS: what each row asked for, and never a flag a greyed
  //     box would have meant.
  vm.runInContext('commit()', page);
  assert.ok(started, 'the list was sent');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(started.people.map(p => [p.name, !!p.attended]))),
    [['Ann Test', true], ['Bob Test', false], ['Cal Test', false]]);

  // (e) Asked for again, a row whose dates come back into reach is ticked once
  //     more — the person's answer was remembered, not thrown away.
  dateBoxes[0].checked = true;
  rows()[2].rec.fire('change');
  assert.strictEqual(rows()[2].att.disabled, false);
  assert.strictEqual(rows()[2].att.checked, true, 'what they asked for is restored, not lost');
}
console.log('bulk attended review: ok');
