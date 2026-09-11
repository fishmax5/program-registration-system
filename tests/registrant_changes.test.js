// CHANGING ONE REGISTRATION FROM THE DESK (99_registrant_changes.gs).
//
// THE FAILURE THIS FILE GUARDS is the same one 71_cancellation.gs and section
// 83 guard, arriving through a new door: a change that reads as done and is
// undone by the next hourly sync, or a change that hands one seat to two
// people. So what is pinned here is not the wording — it is the writes.
//
//   1. A MOVE rewrites the five cells that say WHICH SESSION a row is on, and
//      tombstones the OLD key before it does — without which the form response
//      still pointing at the old Event_ID puts the original row straight back
//      and the person is on both dates.
//   2. A move clears the marks when the DATE changes and keeps them when only
//      the slot does: "attended" is a fact about a day.
//   3. A move is refused onto a session the person is already on (that is a
//      duplicate, not a move), onto a full one, and onto an appointment whose
//      chair has gone in the meantime.
//   4. PUT THEM BACK ON undoes a cancellation and a by-hand waitlisting, and
//      refuses to promote somebody the IMPORT waitlisted at capacity — the
//      same queue rule applyLeaderWaitlistTicks() follows.
//   5. CANCEL goes through the one writer in 71, so all four cells move.
//   6. UNDO takes the tick and the meal counts off together.
//   7. THE MEAL is SET, not added — the opposite of the marking path, because
//      this is a correction.
//   8. CONTACT DETAILS land on every upcoming row and on no past one.
//   9. REMOVE asks first, tombstones the doomed rows, and redraws from the
//      kept ones.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const NOW = new Date(2026, 8, 16, 9, 0, 0); // Wed 16 Sep 2026
const RealDate = Date;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sandbox = {
  console: { log: () => {} },
  Date: class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW.getTime()])); }
    static now() { return NOW.getTime(); }
  },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      const d = new RealDate(date);
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${p(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
    },
    sleep: () => {}, computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'desk@example.org' })
  },
  FormApp: { ItemType: {} }, ScriptApp: {}, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.applyRegistrantChangeFromDialog = applyRegistrantChangeFromDialog;
this.stampRegistrantRowUncancelled = stampRegistrantRowUncancelled;
this.pickRegistrantRowForChange = pickRegistrantRowForChange;
this.registrantChangeParty = registrantChangeParty;
this.getIndexMap = getIndexMap;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.__setHooks = function (hooks) {
  Object.keys(hooks).forEach(function (name) { this[name] = hooks[name]; }, this);
};
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
function row(over) {
  const r = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
  Object.keys(over).forEach(k => { r[map[k]] = over[k]; });
  return r;
}
const TUE = new RealDate(2026, 8, 15);
const THU = new RealDate(2026, 8, 17);

const sheets = {};
sheets[sandbox.SHEET_NAMES.REGISTRANT_DASH] = { __name: 'registrants' };
sheets[sandbox.SHEET_NAMES.PROGRAM_DASHBOARD] = { __name: 'sessions' };
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
  getSheetByName: name => sheets[name] || null
});

// What the test controls: the rows on the tab, the session a move is aimed at,
// whether lunch is on, and how full the destination is.
const world = {
  rows: [],
  target: null,
  lunchOn: true,
  seats: {},
  tombstoned: [],
  cleared: [],
  rendered: null,
  counted: null,
  lunchCounted: null,
  invalidated: 0
};
sandbox.__setHooks({
  log: () => {},
  toastIfPossible: () => {},
  getSectionedRows: () => world.rows,
  renderRegistrantsSheet: (force, rows) => { world.rendered = rows; },
  recomputeEventRegistryCounts: (registry, sheet, rows) => { world.counted = rows; },
  updateMasterLunchDashboard: rows => { world.lunchCounted = rows; },
  invalidateQuickMarkIndexCache: () => { world.invalidated++; },
  recordRegistrantTombstones: rows => { world.tombstoned = world.tombstoned.concat(rows); },
  clearRegistrantTombstones: keys => { world.cleared = world.cleared.concat(keys); },
  buildWaitlistSeatIndex: () => world.seats,
  isLunchOfferedOn: () => world.lunchOn,
  resolveWalkInLunchType: () => 'Hot',
  findNearestSessionForProgram: () => world.target,
  // The session choice is parsed and tested in tests/quick_mark_index.test.js;
  // here it is a plain "Title|dateKey" so a date label cannot make this file
  // fail for a reason that has nothing to do with what it is pinning.
  parseQuickMarkProgramChoice: value => {
    const parts = String(value || '').split('|');
    return { title: parts[0] || '', dateKey: parts[1] || '', lunchOnly: false };
  }
});

function reset(rows) {
  world.rows = rows;
  world.tombstoned = [];
  world.cleared = [];
  world.rendered = null;
  world.counted = null;
  world.lunchCounted = null;
  world.invalidated = 0;
  world.lunchOn = true;
  world.seats = {};
}

function ruthOnTuesday(over) {
  return row(Object.assign({
    Name: 'Ruth Cohen', Event: 'Chair Yoga', Location: 'Ashbridge', Event_Date: TUE,
    Event_ID: 'E-TUE', Person_Type: 'Attendee', Primary_Registrant: 'Self',
    Program_Status: 'Active', Lunch_Type: 'Hot', Lunch_Status: 'Needed',
    Manual_Override: 'Auto-Synced', Party_ID: 'R1'
  }, over || {}));
}
const thursday = {
  date: THU, dateKey: '2026-09-17', location: 'Ashbridge', title: 'Chair Yoga',
  eventId: 'E-THU', eventTime: '10:00 AM – 11:00 AM', end: null, slotMinutes: 0,
  isAssistance: false, formId: 'F1'
};

// ---------------------------------------------------------------- 1, 2. move
{
  const ruth = ruthOnTuesday({ Attended: true, Lunch_Served: true, Day1_Dined_In: 2 });
  const guest = row({
    Name: 'Ruth Cohen Guest', Event: 'Chair Yoga', Location: 'Ashbridge', Event_Date: TUE,
    Event_ID: 'E-TUE', Person_Type: 'Guest', Primary_Registrant: 'Ruth Cohen',
    Program_Status: 'Active', Lunch_Type: 'No Lunch', Lunch_Status: 'No Lunch'
  });
  const elsewhere = ruthOnTuesday({ Name: 'Sam Adler', Party_ID: 'R2' });
  reset([ruth, guest, elsewhere]);
  world.target = thursday;

  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Chair Yoga|2026-09-17'
  });

  ok('a move to another day is accepted', res.ok, res.message);
  eq('the row now carries the new session', ruth[map['Event_ID']], 'E-THU');
  eq('and the new date', ruth[map['Event_Date']], THU);
  eq('and the new time', ruth[map['Event_Time']], '10:00 AM – 11:00 AM');
  eq('and the new title', ruth[map['Event']], 'Chair Yoga');
  eq('and the new location', ruth[map['Location']], 'Ashbridge');
  eq('the move is a manual edit, so the next sync leaves it alone',
    ruth[map['Manual_Override']], 'Manually Edited');
  ok('and it says so on the row',
    String(ruth[map['Admin_Notes']]).indexOf('Moved from') !== -1, ruth[map['Admin_Notes']]);

  // 2. The marks belong to the day that was left behind.
  eq('the attendance tick did not travel', ruth[map['Attended']], false);
  eq('nor did the lunch tick', ruth[map['Lunch_Served']], false);
  eq('nor did the meals they took', ruth[map['Day1_Dined_In']], '');
  ok('and the desk is told the marks went',
    res.message.indexOf('marks were cleared') !== -1, res.message);

  // The guest goes with the person who brought them; the stranger does not.
  eq('the guest moved too', guest[map['Event_ID']], 'E-THU');
  eq('somebody else on the same session did not', elsewhere[map['Event_ID']], 'E-TUE');

  // 1. The tombstone, and the destination's own tombstone lifted.
  eq('both moved rows were tombstoned on the way out', world.tombstoned.length, 2);
  // WHICH session they were tombstoned against is the whole point, and cannot
  // be read off the rows afterwards — they have been rewritten by then. The
  // block below pins it by capturing the value at call time.
  ok('the destination key was cleared instead',
    world.cleared.some(k => String(k).indexOf('E-THU|ruth cohen|') === 0), world.cleared);
  eq('the tab was redrawn from the rows in hand', world.rendered, world.rows);
  ok('and the counts came off those same rows', world.counted === world.rows);
  ok('the stored Quick Mark lists were dropped', world.invalidated === 1);
}

// The order pinned properly: a tombstone recorded before the rewrite names the
// session the row is LEAVING. Checked by capturing the value at call time.
{
  const ruth = ruthOnTuesday({});
  reset([ruth]);
  world.target = thursday;
  const seen = [];
  const keep = sandbox.recordRegistrantTombstones;
  sandbox.__setHooks({
    recordRegistrantTombstones: rows => { rows.forEach(r => seen.push(r[map['Event_ID']])); }
  });
  sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Chair Yoga|2026-09-17'
  });
  eq('the tombstone names the session being left, not the one arrived at', seen, ['E-TUE']);
  sandbox.__setHooks({ recordRegistrantTombstones: keep });
}

// ------------------------------------------------------- 3. the three refusals
{
  const ruth = ruthOnTuesday({});
  const already = ruthOnTuesday({ Event_ID: 'E-THU', Event_Date: THU, Party_ID: 'R3' });
  reset([ruth, already]);
  world.target = thursday;
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Chair Yoga|2026-09-17'
  });
  ok('a move onto a session they are already on is refused', !res.ok, res.message);
  ok('and it says why', res.message.indexOf('already has a') !== -1, res.message);
  eq('nothing was written', ruth[map['Event_ID']], 'E-TUE');
  eq('and nothing was tombstoned', world.tombstoned.length, 0);
}

{
  const ruth = ruthOnTuesday({});
  reset([ruth]);
  world.target = thursday;
  world.seats = { 'E-THU': { capacity: 12, active: 12, closed: false } };
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Chair Yoga|2026-09-17'
  });
  ok('a move onto a full session is refused', !res.ok, res.message);
  ok('and the number is in the refusal', res.message.indexOf('12 of 12') !== -1, res.message);
  eq('nothing was written', ruth[map['Event_ID']], 'E-TUE');
}

{
  // A [Waitlist Only] session refuses whatever the count says.
  const ruth = ruthOnTuesday({});
  reset([ruth]);
  world.target = thursday;
  world.seats = { 'E-THU': { capacity: 20, active: 1, closed: true } };
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Chair Yoga|2026-09-17'
  });
  ok('a move onto a closed session is refused even with room', !res.ok, res.message);
}

{
  // An appointment destination: the chair has to be named, and free.
  const ruth = ruthOnTuesday({ Event_Time: '10:00 AM – 10:30 AM' });
  const holder = row({
    Name: 'Ida Weiss', Event: 'Wills', Location: 'Ashbridge', Event_Date: THU,
    Event_ID: 'E-APPT', Event_Time: '11:00 AM – 11:30 AM', Person_Type: 'Attendee',
    Program_Status: 'Active'
  });
  reset([ruth, holder]);
  world.target = {
    date: new RealDate(2026, 8, 17, 10, 0), dateKey: '2026-09-17', location: 'Ashbridge',
    title: 'Wills', eventId: 'E-APPT', eventTime: '', end: new RealDate(2026, 8, 17, 12, 0),
    slotMinutes: 30, isAssistance: true, formId: 'F2'
  };

  const noTime = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Wills|2026-09-17'
  });
  ok('an appointment destination with no time named is refused', !noTime.ok, noTime.message);

  const taken = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Wills|2026-09-17', toAppointmentTime: '11:00 AM'
  });
  ok('and a chair somebody else is in is refused', !taken.ok, taken.message);
  eq('nothing was written', ruth[map['Event_ID']], 'E-TUE');

  const free = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    toLocation: 'Ashbridge', toSession: 'Wills|2026-09-17', toAppointmentTime: '11:30 AM'
  });
  ok('a free chair is taken', free.ok, free.message);
  eq('and the row carries the SLOT, not the session span',
    ruth[map['Event_Time']], '11:30 AM – 12:00 PM');
}

{
  // ONE PERSON CAN HOLD TWO CHAIRS on one afternoon, which is exactly what the
  // ordinary "you are already on that session" guard would refuse. Moving one
  // of them must not be blocked by the other.
  const early = row({
    Name: 'Ruth Cohen', Event: 'Wills', Location: 'Ashbridge',
    Event_Date: new RealDate(2026, 8, 17, 10, 0), Event_ID: 'E-APPT',
    Event_Time: '10:00 AM – 10:30 AM', Person_Type: 'Attendee', Program_Status: 'Active'
  });
  const late = row({
    Name: 'Ruth Cohen', Event: 'Wills', Location: 'Ashbridge',
    Event_Date: new RealDate(2026, 8, 17, 10, 0), Event_ID: 'E-APPT',
    Event_Time: '12:00 PM – 12:30 PM', Person_Type: 'Attendee', Program_Status: 'Active'
  });
  reset([early, late]);
  world.target = {
    date: new RealDate(2026, 8, 17, 10, 0), dateKey: '2026-09-17', location: 'Ashbridge',
    title: 'Wills', eventId: 'E-APPT', eventTime: '', end: new RealDate(2026, 8, 17, 13, 0),
    slotMinutes: 30, isAssistance: true, formId: 'F2'
  };
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'move', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Wills|2026-09-17',
    bookedTime: '10:00 AM',
    toLocation: 'Ashbridge', toSession: 'Wills|2026-09-17', toAppointmentTime: '11:00 AM'
  });
  ok('one of two appointments can be moved past the other', res.ok, res.message);
  eq('the moved chair is the one that was picked', early[map['Event_Time']], '11:00 AM – 11:30 AM');
  eq('and the other is untouched', late[map['Event_Time']], '12:00 PM – 12:30 PM');
  eq('a slot move on the same session keeps the marks', early[map['Attended']], '');
}

// ------------------------------------------------------ 4. put them back on
{
  const ruth = ruthOnTuesday({
    Program_Status: 'Cancelled', Lunch_Status: 'Cancelled',
    Admin_Notes: 'Cancelled at the door on Tue, Sep 15.'
  });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'restore', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('a cancellation can be put back', res.ok, res.message);
  eq('the seat is theirs again', ruth[map['Program_Status']], 'Active');
  eq('and the meal comes back from Lunch_Type, not from memory',
    ruth[map['Lunch_Status']], 'Needed');
  eq('it sticks against the next sync', ruth[map['Manual_Override']], 'Manually Edited');
}

{
  // The same person, but with No Lunch on the row: restoring must not order a
  // meal nobody asked for.
  const ruth = ruthOnTuesday({
    Program_Status: 'Cancelled', Lunch_Status: 'Cancelled', Lunch_Type: 'No Lunch'
  });
  reset([ruth]);
  sandbox.applyRegistrantChangeFromDialog({
    change: 'restore', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  eq('a row that never wanted feeding goes back to No Lunch',
    ruth[map['Lunch_Status']], 'No Lunch');
}

{
  // Waitlisted by the IMPORT because the session was full: not this button's
  // to undo.
  const ruth = ruthOnTuesday({ Program_Status: 'Waitlisted', Lunch_Status: 'Waitlisted' });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'restore', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('a capacity waitlisting is not promoted out of turn', !res.ok, res.message);
  ok('and the refusal says what to do instead',
    res.message.indexOf('Max_Capacity') !== -1, res.message);
  eq('the row did not move', ruth[map['Program_Status']], 'Waitlisted');
}

{
  // Waitlisted by hand at the desk: that one can be taken back.
  const ruth = ruthOnTuesday({
    Program_Status: 'Waitlisted', Lunch_Status: 'Waitlisted',
    Admin_Notes: 'Waitlisted at the door on Tue, Sep 15.'
  });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'restore', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('a by-hand waitlisting is given its seat', res.ok, res.message);
  eq('and the row says so', ruth[map['Program_Status']], 'Active');
}

{
  // A full session gives nothing back, however the place was made.
  const ruth = ruthOnTuesday({
    Program_Status: 'Cancelled', Lunch_Status: 'Cancelled',
    Admin_Notes: 'Cancelled at the door on Tue, Sep 15.'
  });
  reset([ruth]);
  world.seats = { 'E-TUE': { capacity: 8, active: 8, closed: false } };
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'restore', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('a seat that is not there cannot be handed back', !res.ok, res.message);
  eq('the row stays cancelled', ruth[map['Program_Status']], 'Cancelled');
}

// ------------------------------------------------------------- 5. cancel
{
  const ruth = ruthOnTuesday({});
  const guest = row({
    Name: 'Ruth Cohen Guest', Event: 'Chair Yoga', Location: 'Ashbridge', Event_Date: TUE,
    Event_ID: 'E-TUE', Person_Type: 'Guest', Primary_Registrant: 'Ruth Cohen',
    Program_Status: 'Active', Lunch_Status: 'Needed'
  });
  reset([ruth, guest]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'cancel', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    reason: 'Hospital appointment'
  });
  ok('a cancellation goes through', res.ok, res.message);
  eq('the seat goes back', ruth[map['Program_Status']], 'Cancelled');
  eq('and the meal with it', ruth[map['Lunch_Status']], 'Cancelled');
  eq('and it sticks', ruth[map['Manual_Override']], 'Manually Edited');
  ok('the reason is on the row',
    String(ruth[map['Admin_Notes']]).indexOf('Hospital appointment') !== -1, ruth[map['Admin_Notes']]);
  eq('the guest goes with them', guest[map['Program_Status']], 'Cancelled');

  const again = sandbox.applyRegistrantChangeFromDialog({
    change: 'cancel', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('cancelling twice is refused rather than stamped twice', !again.ok, again.message);
}

// --------------------------------------------------------------- 6. undo
{
  const ruth = ruthOnTuesday({
    Attended: true, Lunch_Served: true, Day1_Dined_In: 1, Meals_In_Fridge: 2
  });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'undo', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    clearAttended: true, clearLunch: true
  });
  ok('a mark can be taken back off', res.ok, res.message);
  eq('attended is clear', ruth[map['Attended']], false);
  eq('lunch is clear', ruth[map['Lunch_Served']], false);
  eq('and the meals went with the lunch tick', ruth[map['Day1_Dined_In']], '');
  eq('all of them', ruth[map['Meals_In_Fridge']], '');
}

{
  // Only the attendance tick: the meal stays exactly as handed over.
  const ruth = ruthOnTuesday({ Attended: true, Lunch_Served: true, Day1_Dined_In: 1 });
  reset([ruth]);
  sandbox.applyRegistrantChangeFromDialog({
    change: 'undo', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    clearAttended: true
  });
  eq('attended is clear', ruth[map['Attended']], false);
  eq('the meal they were handed is untouched', ruth[map['Lunch_Served']], true);
  eq('and so is the count', ruth[map['Day1_Dined_In']], 1);
}

{
  const ruth = ruthOnTuesday({});
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'undo', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('undoing nothing is refused rather than written', !res.ok, res.message);
}

// --------------------------------------------------------------- 7. the meal
{
  const ruth = ruthOnTuesday({ Meals_Ordered: 4 });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'lunch', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    lunchType: 'Cold', mealsOrdered: 2
  });
  ok('the meal can be corrected', res.ok, res.message);
  eq('the type is what was asked for', ruth[map['Lunch_Type']], 'Cold');
  eq('the order is SET, not added to', ruth[map['Meals_Ordered']], 2);
  eq('and the status follows', ruth[map['Lunch_Status']], 'Needed');
}

{
  const ruth = ruthOnTuesday({ Meals_Ordered: 4 });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'lunch', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    lunchType: 'No Lunch'
  });
  ok('and taken off entirely', res.ok, res.message);
  eq('the order is gone', ruth[map['Meals_Ordered']], '');
  eq('and so is the demand', ruth[map['Lunch_Status']], 'No Lunch');
}

{
  const ruth = ruthOnTuesday({ Lunch_Type: 'No Lunch', Lunch_Status: 'No Lunch' });
  reset([ruth]);
  world.lunchOn = false;
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'lunch', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    lunchType: 'Hot'
  });
  ok('a meal on a date that serves none is refused', !res.ok, res.message);
  eq('and nothing was written', ruth[map['Lunch_Status']], 'No Lunch');
}

{
  const ruth = ruthOnTuesday({ Program_Status: 'Waitlisted', Lunch_Status: 'Waitlisted' });
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'lunch', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    lunchType: 'Hot'
  });
  ok('somebody with no seat cannot be given a meal', !res.ok, res.message);
  eq('the waitlisted lunch status stands', ruth[map['Lunch_Status']], 'Waitlisted');
}

// ------------------------------------------------------- 8. contact details
{
  const past = ruthOnTuesday({ Event_Date: new RealDate(2026, 7, 4), Event_ID: 'E-AUG' });
  const today = ruthOnTuesday({ Event_Date: new RealDate(2026, 8, 16), Event_ID: 'E-TODAY' });
  const soon = ruthOnTuesday({ Event_Date: THU, Event_ID: 'E-THU' });
  const someoneElse = ruthOnTuesday({ Name: 'Sam Adler', Event_ID: 'E-THU' });
  reset([past, today, soon, someoneElse]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'contact', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-16',
    phone: '610-555-0142', email: 'ruth@example.org'
  });
  ok('contact details are accepted', res.ok, res.message);
  eq('today is updated', today[map['Phone']], '610-555-0142');
  eq('and every upcoming row too', soon[map['Email']], 'ruth@example.org');
  eq('a past row keeps how we reached them at the time', past[map['Phone']], '');
  eq('and nobody else is touched', someoneElse[map['Phone']], '');
  ok('the desk is told it went on more than one row',
    res.message.indexOf('all 2 of their upcoming rows') !== -1, res.message);
}

{
  const ruth = ruthOnTuesday({});
  reset([ruth]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'contact', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    email: 'not-an-address'
  });
  ok('something that is not an email address is refused', !res.ok, res.message);
  eq('and nothing was written', ruth[map['Email']], '');
}

// --------------------------------------------------------------- 9. remove
{
  const ruth = ruthOnTuesday({});
  const guest = row({
    Name: 'Ruth Cohen Guest', Event: 'Chair Yoga', Location: 'Ashbridge', Event_Date: TUE,
    Event_ID: 'E-TUE', Person_Type: 'Guest', Primary_Registrant: 'Ruth Cohen',
    Program_Status: 'Active'
  });
  const keep = ruthOnTuesday({ Name: 'Sam Adler' });
  reset([ruth, guest, keep]);

  const asked = sandbox.applyRegistrantChangeFromDialog({
    change: 'remove', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('a removal asks before it deletes', asked.needsConfirm, JSON.stringify(asked));
  ok('and the question names the guest rows going with it',
    asked.question.indexOf('guest row(s) go with it') !== -1, asked.question);
  eq('nothing was deleted by asking', world.rendered, null);
  eq('and nothing was tombstoned by asking', world.tombstoned.length, 0);

  const done = sandbox.applyRegistrantChangeFromDialog({
    change: 'remove', name: 'Ruth Cohen', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15',
    confirmRemove: true
  });
  ok('a confirmed removal goes through', done.ok, done.message);
  eq('both rows were tombstoned', world.tombstoned.length, 2);
  eq('and the tab was redrawn from the kept rows only', world.rendered, [keep]);
  ok('the counts came off the kept rows', world.counted === world.rendered);
  ok('and the form response was left alone, which the message says',
    done.message.indexOf('form response was left in place') !== -1, done.message);
}

// ---------------------------------------------------- the row that isn't there
{
  reset([ruthOnTuesday({})]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'cancel', name: 'Nobody At All', location: 'Ashbridge', session: 'Chair Yoga|2026-09-15'
  });
  ok('a name with no row is an answer, not a crash', !res.ok, res.message);
  ok('and it suggests the reload that would fix it',
    res.message.indexOf('Reload the lists') !== -1, res.message);
}

// -------------------------------------------------------- the unknown change
{
  reset([ruthOnTuesday({})]);
  const res = sandbox.applyRegistrantChangeFromDialog({
    change: 'do-something-clever', name: 'Ruth Cohen', location: 'Ashbridge',
    session: 'Chair Yoga|2026-09-15'
  });
  ok('a change this file does not recognize writes nothing', !res.ok, res.message);
}

// ---------------------------------------------- the new writer, on its own
{
  const active = ruthOnTuesday({});
  ok('an active row has no cancellation to undo',
    sandbox.stampRegistrantRowUncancelled(active, map, {}) === false);
  const superseded = ruthOnTuesday({ Program_Status: 'Superseded' });
  ok('nor does a superseded one',
    sandbox.stampRegistrantRowUncancelled(superseded, map, {}) === false);
  const waiting = ruthOnTuesday({ Program_Status: 'Waitlisted' });
  ok('and a waitlisted row is the other writer\'s job',
    sandbox.stampRegistrantRowUncancelled(waiting, map, {}) === false);
}

console.log(failures === 0 ? '\nAll registrant-change checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
