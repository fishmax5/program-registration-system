// THE WAITLIST SOMEBODY PUTS SOMEONE ON BY HAND — the fifth Quick Mark tick,
// the program leader's Waitlisted box, and the promotion that must not jump a
// queue.
//
// THE FAILURES THIS FILE GUARDS.
//
// 1. A waitlisting is four cells, exactly like a cancellation (see
//    tests/cancellation.test.js): the seat, the meal, the manual override that
//    stops the next hourly sync re-deriving the row from its form response,
//    and the Admin_Notes stamp. Three of the four is a person who is waiting
//    and still being cooked for, or one who is back on the list an hour later
//    with nobody having touched anything.
//
// 2. It is TWO-WAY, and that is where the real hazard is. Unticking a box on a
//    shared sheet a program leader can edit must never promote somebody the
//    IMPORT waitlisted at capacity — that is the eleventh person losing their
//    place to the twelfth — and must never seat anybody a full or closed
//    session has no room for.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console,
  // A REAL formatDate: applyLeaderWaitlistTicks() decides "upcoming" by
  // comparing yyyy-MM-dd keys, and a stub that returns '' makes every date
  // equal to every other one and the test passes on a bug.
  Utilities: {
    formatDate: (date, tz, fmt) => {
      const d = new Date(date);
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toDateString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'desk@example.org' })
  },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfyTEST/exec' }) },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.stampRegistrantRowWaitlisted = stampRegistrantRowWaitlisted;
this.stampRegistrantRowActive = stampRegistrantRowActive;
this.wasWaitlistedByHand = wasWaitlistedByHand;
this.buildWaitlistSeatIndex = buildWaitlistSeatIndex;
this.applyLeaderWaitlistTicks = applyLeaderWaitlistTicks;
this.describeQuickMark = describeQuickMark;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.WAITLIST_SOURCES = WAITLIST_SOURCES;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function ok(name, cond, note) {
  if (cond) console.log('ok   ' + name);
  else { failures++; console.log('FAIL ' + name + (note ? '\n     ' + note : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`);
}

const map = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
const sessionMap = sandbox.getIndexMap(sandbox.HEADERS.All_Program_Sessions);
function blankRow(over) {
  const row = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
  Object.keys(over || {}).forEach(k => { row[map[k]] = over[k]; });
  return row;
}
function sessionRow(over) {
  const row = new Array(sandbox.HEADERS.All_Program_Sessions.length).fill('');
  Object.keys(over || {}).forEach(k => { row[sessionMap[k]] = over[k]; });
  return row;
}
const DAY = 86400000;
const soon = new Date(Date.now() + 7 * DAY);
const gone = new Date(Date.now() - 7 * DAY);

// --- the four cells ---------------------------------------------------------

{
  const row = blankRow({
    Name: 'Ruth Cohen', Program_Status: 'Active', Lunch_Status: 'Needed',
    Lunch_Type: 'Hot', Admin_Notes: 'Uses a walker.'
  });
  const moved = sandbox.stampRegistrantRowWaitlisted(row, map,
    { source: sandbox.WAITLIST_SOURCES.DESK, reason: 'room only holds twelve' });
  ok('a waitlisting reports that it moved', moved === true);
  eq('the seat goes back', row[map['Program_Status']], 'Waitlisted');
  eq('and the meal with it', row[map['Lunch_Status']], 'Waitlisted');
  eq('the override is what makes it stick', row[map['Manual_Override']], 'Manually Edited');
  ok('the standing note is kept, not overwritten',
    row[map['Admin_Notes']].indexOf('Uses a walker.') === 0);
  ok('the stamp says which door and why',
    /Waitlisted at the door on .* room only holds twelve/.test(row[map['Admin_Notes']]),
    row[map['Admin_Notes']]);
  // The type is deliberately untouched: it is the only record of which meal
  // they asked for, and it is what a promotion restores the status from.
  eq('the lunch TYPE is left alone', row[map['Lunch_Type']], 'Hot');
}

{
  const row = blankRow({ Program_Status: 'Waitlisted' });
  ok('waitlisting an already-waitlisted row is a no-op, not a second stamp',
    sandbox.stampRegistrantRowWaitlisted(row, map, {}) === false);
  eq('…and nothing is appended to the notes', row[map['Admin_Notes']], '');
}

{
  const row = blankRow({ Program_Status: 'Cancelled' });
  ok('a cancellation is not turned into a queue place',
    sandbox.stampRegistrantRowWaitlisted(row, map, {}) === false);
  const superseded = blankRow({ Program_Status: 'Superseded' });
  ok('nor is a superseded row',
    sandbox.stampRegistrantRowWaitlisted(superseded, map, {}) === false);
}

// --- and back again ---------------------------------------------------------

{
  const row = blankRow({ Program_Status: 'Waitlisted', Lunch_Status: 'Waitlisted', Lunch_Type: 'Cold' });
  ok('a promotion reports that it moved', sandbox.stampRegistrantRowActive(row, map, {}) === true);
  eq('the seat comes back', row[map['Program_Status']], 'Active');
  eq('and the meal is restored from the type they asked for',
    row[map['Lunch_Status']], 'Needed');
}

{
  const row = blankRow({ Program_Status: 'Waitlisted', Lunch_Status: 'Waitlisted', Lunch_Type: 'No Lunch' });
  sandbox.stampRegistrantRowActive(row, map, {});
  eq('somebody who never wanted a meal is not ordered one', row[map['Lunch_Status']], 'No Lunch');
}

{
  const cancelled = blankRow({ Program_Status: 'Cancelled' });
  ok('a cancellation is not promoted back onto the list',
    sandbox.stampRegistrantRowActive(cancelled, map, {}) === false);
  const active = blankRow({ Program_Status: 'Active' });
  ok('and an active row is left exactly as it is',
    sandbox.stampRegistrantRowActive(active, map, {}) === false);
}

// --- whose waitlist place is it? --------------------------------------------

{
  const byHand = blankRow({ Program_Status: 'Waitlisted' });
  sandbox.stampRegistrantRowWaitlisted(byHand, map, { source: sandbox.WAITLIST_SOURCES.LEADER });
  ok('a leader is not credited for a place the import made — the stamp is the only claim',
    sandbox.wasWaitlistedByHand(blankRow({
      Program_Status: 'Waitlisted', Admin_Notes: 'Auto-waitlisted: capacity 12 is full.'
    }), map) === false);
}

// --- the leader's tick, both ways -------------------------------------------

const sessions = [
  sessionRow({ Event_ID: 'e-open', Max_Capacity: 3 }),
  sessionRow({ Event_ID: 'e-full', Max_Capacity: 1 }),
  sessionRow({ Event_ID: 'e-closed', Max_Capacity: 20, Waitlist_Only: true })
];

{
  const ticked = blankRow({
    Event_ID: 'e-open', Event_Date: soon, Name: 'Ruth Cohen',
    Program_Status: 'Active', Lunch_Status: 'Needed', Lunch_Type: 'Hot',
    Waitlisted: true, Leader_Notes: 'no room this week'
  });
  const past = blankRow({
    Event_ID: 'e-open', Event_Date: gone, Name: 'Sol Weiss',
    Program_Status: 'Active', Waitlisted: true
  });
  const moved = sandbox.applyLeaderWaitlistTicks([ticked, past], sessions);
  eq('one tick, one move', moved, 1);
  eq('the ticked row is waiting', ticked[map['Program_Status']], 'Waitlisted');
  ok('with the leader named and their note carried as the reason',
    /Waitlisted by the program leader on .*no room this week/.test(ticked[map['Admin_Notes']]),
    ticked[map['Admin_Notes']]);
  // A leader tidying up last month's sheet is recording history. A past
  // session's seat is not a seat.
  eq('a past session is left alone', past[map['Program_Status']], 'Active');
}

{
  // Unticked, and the place was one this project made: they go back on.
  const promoted = blankRow({
    Event_ID: 'e-open', Event_Date: soon, Name: 'Ruth Cohen',
    Program_Status: 'Waitlisted', Lunch_Status: 'Waitlisted', Lunch_Type: 'Hot',
    Waitlisted: false,
    Admin_Notes: 'Waitlisted by the program leader on Mon 1 Jun: no room this week.'
  });
  // …and one the IMPORT waitlisted at capacity, which no tick may promote.
  const queued = blankRow({
    Event_ID: 'e-open', Event_Date: soon, Name: 'Sol Weiss',
    Program_Status: 'Waitlisted', Waitlisted: false
  });
  const moved = sandbox.applyLeaderWaitlistTicks([promoted, queued], sessions);
  eq('one untick, one move', moved, 1);
  eq('the leader-waitlisted person is back on the list', promoted[map['Program_Status']], 'Active');
  eq('and their meal with them', promoted[map['Lunch_Status']], 'Needed');
  eq("the import's queue is not jumped", queued[map['Program_Status']], 'Waitlisted');
}

{
  // The session has one seat and somebody is in it: unticking gives nothing.
  const holder = blankRow({
    Event_ID: 'e-full', Event_Date: soon, Name: 'Ada Stern', Program_Status: 'Active'
  });
  const hopeful = blankRow({
    Event_ID: 'e-full', Event_Date: soon, Name: 'Ruth Cohen', Program_Status: 'Waitlisted',
    Waitlisted: false, Admin_Notes: 'Waitlisted by the program leader on Mon 1 Jun.'
  });
  eq('a full session promotes nobody', sandbox.applyLeaderWaitlistTicks([holder, hopeful], sessions), 0);
  eq('…and says so by leaving the row where it is', hopeful[map['Program_Status']], 'Waitlisted');
}

{
  // A session somebody has CLOSED by hand takes nobody back, however empty it
  // is — the whole point of the tag. See WAITLIST_ONLY_TAG.
  const hopeful = blankRow({
    Event_ID: 'e-closed', Event_Date: soon, Name: 'Ruth Cohen', Program_Status: 'Waitlisted',
    Waitlisted: false, Admin_Notes: 'Waitlisted by the program leader on Mon 1 Jun.'
  });
  eq('a closed session promotes nobody either',
    sandbox.applyLeaderWaitlistTicks([hopeful], sessions), 0);
}

{
  // Run twice on the same rows — the hourly case. The second pass must be
  // silent, or Admin_Notes becomes a column of identical sentences by Friday.
  const row = blankRow({
    Event_ID: 'e-open', Event_Date: soon, Name: 'Ruth Cohen',
    Program_Status: 'Active', Waitlisted: true
  });
  sandbox.applyLeaderWaitlistTicks([row], sessions);
  const notes = row[map['Admin_Notes']];
  eq('the second hourly pass changes nothing', sandbox.applyLeaderWaitlistTicks([row], sessions), 0);
  eq('…and appends nothing', row[map['Admin_Notes']], notes);
}

// --- what the desk is told ---------------------------------------------------

eq('the waitlist tick outranks every other word for the same row',
  sandbox.describeQuickMark(false, false, false, true, true), 'added to the waitlist');
eq('and the other four are unchanged by its arrival',
  [sandbox.describeQuickMark(true, true), sandbox.describeQuickMark(false, false, true),
    sandbox.describeQuickMark(true), sandbox.describeQuickMark(false, false, false, true)],
  ['attended + lunch', 'signed up for lunch (not served yet)', 'attended', 'registered (nothing marked yet)']);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
