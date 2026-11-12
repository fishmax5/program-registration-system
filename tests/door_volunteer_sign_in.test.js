// THE DOOR APP'S STANDING VOLUNTEER SIGN-IN (72, 73, 99b).
//
// Pinned: the refusals (no name, no hours, too many, a future day), that ONE
// row goes through logVolunteerVisit() with the hours the volunteer chose and
// no departure (so the planned hours are the ones recorded), that a workbook
// held by a sync QUEUES the sign-in instead of writing, that a failed write is
// queued or mailed rather than lost, that the retry queue treats the kind as
// one that takes its own lock, and that the page carries the button and screen.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const iso = new Date(d.getTime()).toISOString();
      return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : '9:30 AM';
    },
    sleep: () => {}, getUuid: () => 'uuid'
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 'office@example.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.doorVolunteerSignIn = doorVolunteerSignIn;
this.doorVolunteerRefusal_ = doorVolunteerRefusal_;
this.applyQueuedOptimisticWrite = applyQueuedOptimisticWrite;
this.formatDateKey = formatDateKey;
this.buildDoorAppHtml = buildDoorAppHtml;
`, sandbox, { filename: 'program.gs' });

// Stubs for everything outside the file under test.
const calls = { logged: [], queued: [], urgent: [], digest: [] };
let held = false;
let writerAnswer = 'Recorded 3 hour(s) for Ann.';
vm.runInContext(`
checkInPinAccepted = () => true;
matchCheckInLocation = v => (v === 'Narberth' ? 'Narberth' : '');
workbookHeldElsewhere = () => globalThis.__held;
logVolunteerVisit = p => { globalThis.__calls.logged.push(p); return globalThis.__answer(); };
queueOptimisticRetry = (kind, args, why) => { globalThis.__calls.queued.push({ kind, args }); return globalThis.__queueOk; };
notifyAdminUrgent = (s, b, o) => { globalThis.__calls.urgent.push({ s, b, o }); };
spoolOfficeNote = (sec, line) => { globalThis.__calls.digest.push(line); };
`, sandbox);
sandbox.__calls = calls;
Object.defineProperty(sandbox, '__held', { get: () => held });
sandbox.__answer = () => writerAnswer;
sandbox.__queueOk = true;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}
function reset() { calls.logged = []; calls.queued = []; calls.urgent = []; calls.digest = []; held = false; sandbox.__queueOk = true; writerAnswer = 'Recorded 3 hour(s) for Ann.'; }
const today = sandbox.formatDateKey(new Date());
const good = { name: 'Ann', hours: 3, location: 'Narberth', dateKey: today, pin: '' };

// --- Refusals ------------------------------------------------------------
['name', 'hours', 'location'].forEach(k => {
  reset();
  const bad = Object.assign({}, good, { [k]: '' });
  const res = sandbox.doorVolunteerSignIn(JSON.stringify(bad));
  check(`no ${k} refuses`, res.ok, false);
  check(`no ${k} writes nothing`, calls.logged.length + calls.queued.length, 0);
});
reset();
check('too many hours refuses', sandbox.doorVolunteerSignIn(JSON.stringify(Object.assign({}, good, { hours: 99 }))).ok, false);
check('a future day refuses',
  sandbox.doorVolunteerSignIn(JSON.stringify(Object.assign({}, good, { dateKey: '2999-01-01' }))).ok, false);
check('half an hour is allowed', sandbox.doorVolunteerRefusal_(Object.assign({}, good, { hours: 0.5 })), '');

// --- The write -----------------------------------------------------------
reset();
let res = sandbox.doorVolunteerSignIn(JSON.stringify(good));
check('a good sign-in succeeds', res.ok, true);
check('one row is written', calls.logged.length, 1);
check('with the chosen hours', calls.logged[0].hours, 3);
check('no departure is recorded', calls.logged[0].departed, undefined);
check('arrival is the moment of the press', calls.logged[0].arrived, '9:30 AM');
check('signed by the door app, not the owner', calls.logged[0].loggedBy, 'door app');
check('the office is told once, in the digest', calls.digest.length, 1);

reset();
sandbox.doorVolunteerSignIn(JSON.stringify(Object.assign({}, good, { dateKey: '2020-01-01' })));
check('an earlier day has no arrival time', calls.logged[0].arrived, '');

// --- A sync is running ---------------------------------------------------
reset(); held = true;
res = sandbox.doorVolunteerSignIn(JSON.stringify(good));
check('held workbook queues', calls.queued.map(q => q.kind), ['doorVolunteer']);
check('held workbook writes nothing now', calls.logged.length, 0);
check('and still answers ok', res.ok && res.queued, true);

// --- A failed write ------------------------------------------------------
reset(); writerAnswer = '⚠️ The workbook is mid-update — try again.';
sandbox.doorVolunteerSignIn(JSON.stringify(good));
check('a refused write is queued', calls.queued.map(q => q.kind), ['doorVolunteer']);
reset(); writerAnswer = '⚠️ nope'; sandbox.__queueOk = false;
sandbox.doorVolunteerSignIn(JSON.stringify(good));
check('and mailed when it cannot be queued', calls.urgent.length, 1);

// --- The retry queue replays it ----------------------------------------
reset();
res = sandbox.applyQueuedOptimisticWrite({ kind: 'doorVolunteer', args: good });
check('the queued kind replays through the writer', [res.ok, calls.logged.length], [true, 1]);

// --- The page ------------------------------------------------------------
const html = String(sandbox.buildDoorAppHtml({}));
check('page has the volunteer button', html.indexOf('I am here to volunteer') > -1, true);
check('page calls the server function', html.indexOf('.doorVolunteerSignIn(') > -1, true);

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
console.log('door volunteer sign-in: all passed');
