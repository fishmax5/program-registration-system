// CLOSING ONE SESSION WITHOUT CLOSING THE PROGRAM — the [Waitlist Only] tag.
//
// Every other tag on a calendar description describes a PROGRAM, and this
// codebase enforces that hard: buildEventGroups() folds a flag up to the group,
// unifyProgramFlagsAcrossGroups() folds it up again across the program's
// months, spreadFlagToSiblingRows() ticks the same box on every other row, and
// reconcileProgramFlagColumns() unticks any row the calendar has stopped
// mentioning. All of that is right for "is this a club" and all of it is wrong
// for "can this Thursday still take anybody".
//
// So this tag goes down a parallel path, and this file is what pins the
// difference in place. The four questions it asks are the four ways the feature
// breaks:
//
//   1. does the parser read the tag — and refuse a sentence that mentions a
//      waitlist?
//   2. does the flag stay on the SESSION it was typed on, instead of being
//      folded onto the group like every neighbouring setting?
//   3. does a registration for a forced session waitlist even when the session
//      has NO capacity at all — the case a cap cannot express, and the reason
//      the feature exists?
//   4. does the calendar write reach that one date's event and no other?
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = require('./helpers/source').readSource();

const RealDate = Date;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sandbox = {
  // Muted: the parser logs every bracket it declines, and half of section 1 is
  // brackets it should decline.
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      // The group key's WHEN half — every date below is in one month, which is
      // what makes the three sessions one group and one form.
      if (pattern === 'MMMM yyyy') return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
      if (pattern === 'h:mm a') return '1:00 PM';
      return `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
    },
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: () => [1],
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: n => ({ __name: n }), getSpreadsheetTimeZone: () => 'America/New_York' }),
    getActive: () => null
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.parseSettingsBrackets = parseSettingsBrackets;
this.resolveEventSettings = resolveEventSettings;
this.parseEventTitle = parseEventTitle;
this.buildEventGroups = buildEventGroups;
this.buildRegistrantRow = buildRegistrantRow;
this.buildCapacityHintsFromRegistryRows = buildCapacityHintsFromRegistryRows;
this.isWaitlistOnlyColumnValue = isWaitlistOnlyColumnValue;
this.stampSessionFlagOnCalendarEvent = stampSessionFlagOnCalendarEvent;
this.getSessionFlagByColumn = getSessionFlagByColumn;
this.pendingFlagKey = pendingFlagKey;
this.formatDateKey = formatDateKey;
this.CAPACITY_HINT_SUFFIX = CAPACITY_HINT_SUFFIX;
this.WAITLIST_ONLY_TAG = WAITLIST_ONLY_TAG;
this.CALENDAR_MAP = CALENDAR_MAP;
this.setCalendarStub = function (getCalendarById, invalidate) {
  CalendarApp = { getCalendarById: getCalendarById };
  invalidateCalendarEventsCache = invalidate || function () {};
};
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};
sandbox.getCateringPolicyForLocation = () => 'Always';
sandbox.getRegistrantTombstone = () => null;
sandbox.computeOrderAheadFlag = () => '';
sandbox.getMealInfoForDate = () => ({ type: 'Hot', shorthand: 'Soup' });
sandbox.isLunchOfferedOn = () => true;
sandbox.lunchIsRuledOutOn = () => false;
sandbox.isExplicitlyNotServing = () => false;
sandbox.resolveRegistrantLunchType = wantsLunch => (wantsLunch ? 'Hot' : 'No Lunch');
sandbox.readLunchScheduleRows = () => [];

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// ===========================================================================
// 1. THE PARSER READS THE TAG — AND ONLY THE TAG
// ===========================================================================
console.log('\n-- the tag parses, in the spellings staff will type --');

const waitlistOnlyOf = text => !!sandbox.parseSettingsBrackets(text).waitlistOnly;

check('[Waitlist Only]', waitlistOnlyOf('[Waitlist Only]'), true);
check('[Wait List Only] spelled as two words', waitlistOnlyOf('[Wait List Only]'), true);
check('[Force Waitlist]', waitlistOnlyOf('[Force Waitlist]'), true);
check('[Waitlist All]', waitlistOnlyOf('[Waitlist All]'), true);

// It composes with a cap rather than replacing it: the cap is still what the
// room holds, and this is a separate statement about today.
const withCap = sandbox.parseSettingsBrackets('[Cap: 12, Waitlist Only]');
check('[Cap: 12, Waitlist Only] keeps the cap', withCap.capacity, 12);
check('...and reads the tag beside it', withCap.waitlistOnly, true);

console.log('\n-- and a sentence about a waitlist is a note, not an instruction --');

// The whole reason isTagOnlyBracket() exists, applied to the newest tag: staff
// are told to put clarifying notes in the description, and "there is a
// waitlist, ring the office" must not close the session.
[
  '[Waitlist: call the office]',
  '[Ask about the waitlist]',
  '[Waitlist forms at the desk]',
  '[Only members, please]'
].forEach(note => check(`${note} sets nothing`, waitlistOnlyOf(note), false));

// Nothing said is nothing meant — the default every untagged session relies on.
check('an untagged description leaves it off', waitlistOnlyOf('Bring a friend.'), false);

// ===========================================================================
// 2. IT BELONGS TO ONE DATE, NOT TO THE PROGRAM
// ===========================================================================
// This is the assertion the rest of the feature rests on. "Chair Yoga" meets
// three times in September on one form — one group, three sessions — and the
// tag typed on the middle one must describe the middle one alone. Every other
// setting in this parse is folded onto the group on purpose; folding this one
// would take "the 16th is full" and apply it to the 9th and the 23rd.
console.log('\n-- a tag typed on one date stays on that date --');

const CAL = Object.keys(sandbox.CALENDAR_MAP)[0];

function calendarEvent(title, description, day) {
  const state = { description: description || '', writes: 0 };
  return {
    state,
    getTitle: () => title,
    getDescription: () => state.description,
    setDescription: d => { state.description = d; state.writes++; },
    getStartTime: () => new RealDate(2026, 8, day, 13, 0, 0),
    getEndTime: () => new RealDate(2026, 8, day, 14, 0, 0),
    isAllDayEvent: () => false
  };
}

function parsedSession(day, description) {
  const event = calendarEvent('Chair Yoga', description, day);
  const parsed = sandbox.parseEventTitle('Chair Yoga');
  const settings = sandbox.resolveEventSettings(event, parsed);
  Object.keys(settings).forEach(key => { parsed[key] = settings[key]; });
  return { event, parsed, calendarId: CAL, locationName: 'Narberth' };
}

const groups = sandbox.buildEventGroups([
  parsedSession(9, '[Cap: 12]'),
  parsedSession(16, '[Waitlist Only]'),
  parsedSession(23, '')
]);

check('the three dates are still one group (one form)', groups.length, 1);
check('and the group itself carries no waitlist answer at all',
  groups[0].waitlistOnly === undefined, true);
check('the 9th is open', groups[0].sessions[0].waitlistOnly, false);
check('the 16th is closed', groups[0].sessions[1].waitlistOnly, true);
check('and the 23rd is open', groups[0].sessions[2].waitlistOnly, false);
// The cap typed on the 9th still behaves the old way — folded onto the group —
// which is what makes the contrast above a deliberate difference rather than an
// accident of where it was read.
check('while the cap typed on ONE date still applies to the group', groups[0].capacity, 12);

// ===========================================================================
// 3. A FORCED SESSION WAITLISTS, CAP OR NO CAP
// ===========================================================================
// The case a cap cannot express, and the reason for the whole feature: an
// UNCAPPED session takes everybody, forever, because there is no number for a
// registration to exceed. `used >= 0` is not a test anything can fail.
console.log('\n-- registrations for a forced session are waitlisted --');

const map = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
const entry = {
  eventId: 'evt-yoga-16', eventDate: new RealDate(2026, 8, 16), location: 'Narberth',
  cleanTitle: 'Chair Yoga', eventTime: '1:00 PM – 2:00 PM', maxCapacity: 0
};

function register(name, registryOverrides) {
  return sandbox.buildRegistrantRow({
    registryEntry: Object.assign({}, entry, registryOverrides || {}),
    name, personType: 'Attendee', lunchType: 'Yes - Lunch', primaryRegistrant: 'Self',
    adminNotes: '', formEditUrl: '', protectedKeys: new Set(), existingRowIndex: new Map(),
    submittedAt: new RealDate(2026, 8, 2), orderAheadDays: 3,
    partyId: `p-${name}`, partySize: 1, phone: '', email: ''
  });
}

const openRow = register('Ada Lovelace');
check('an uncapped session takes people normally', openRow[map['Program_Status']], 'Active');

const forcedRow = register('Grace Hopper', { waitlistOnly: true });
check('the same session, forced, waitlists them', forcedRow[map['Program_Status']], 'Waitlisted');
// The lunch follows the place: somebody who is not in the room is not eating,
// which is the rule every capacity waitlisting has always followed.
check('and their lunch waits with them', forcedRow[map['Lunch_Status']], 'Waitlisted');

// A session with room to spare is the same answer — the tick is not a
// shorthand for "full", it is an instruction that outranks the arithmetic.
const roomySpare = register('Katherine Johnson', { maxCapacity: 40, waitlistOnly: true });
check('a session with 40 free seats, forced, waitlists too',
  roomySpare[map['Program_Status']], 'Waitlisted');

// ...and with the tick off, the cap decides exactly as it always did. This is
// the untick path: nothing about the old behaviour is replaced.
const roomy = register('Annie Easley', { maxCapacity: 40 });
check('with the tick off, capacity decides as before', roomy[map['Program_Status']], 'Active');

// ===========================================================================
// 4. WHAT THE PEOPLE INVOLVED ARE TOLD
// ===========================================================================
console.log('\n-- the form says so before somebody submits --');

// The date label on the form gains "(FULL - Waitlist)". For a CAPPED session
// that already happened when the seats ran out; the tick has to reach the
// uncapped ones, which is where a respondent would otherwise be waitlisted with
// no warning whatever.
const registryMap = sandbox.getIndexMap(sandbox.HEADERS.Master_Program_Dashboard);
function registryRow(values) {
  const row = new Array(sandbox.HEADERS.Master_Program_Dashboard.length).fill('');
  Object.keys(values).forEach(key => { row[registryMap[key]] = values[key]; });
  return row;
}
const hints = sandbox.buildCapacityHintsFromRegistryRows([
  registryRow({ Event_Date: new RealDate(2026, 8, 9), Max_Capacity: '', Remaining_Seats: '' }),
  registryRow({ Event_Date: new RealDate(2026, 8, 16), Max_Capacity: '', Remaining_Seats: '', Waitlist_Only: true }),
  registryRow({ Event_Date: new RealDate(2026, 8, 23), Max_Capacity: 12, Remaining_Seats: 0 })
], registryMap);

check('an ordinary uncapped date carries no hint', hints['2026-09-09'], undefined);
check('a forced uncapped date does', hints['2026-09-16'], sandbox.CAPACITY_HINT_SUFFIX);
check('and a full capped date still does', hints['2026-09-23'], sandbox.CAPACITY_HINT_SUFFIX);

// The column is read the same permissive way every other tag column is, so a
// workbook where somebody pasted text instead of ticking still means it.
check('a real tick reads as on', sandbox.isWaitlistOnlyColumnValue(true), true);
check('pasted "TRUE" reads as on', sandbox.isWaitlistOnlyColumnValue('TRUE'), true);
check('the tag words read as on', sandbox.isWaitlistOnlyColumnValue('Waitlist Only'), true);
check('an empty cell reads as off', sandbox.isWaitlistOnlyColumnValue(''), false);
check('and an unticked box as off', sandbox.isWaitlistOnlyColumnValue(false), false);

// ===========================================================================
// 5. THE CALENDAR WRITE REACHES ONE EVENT
// ===========================================================================
// The delivery half. stampProgramFlagOnCalendar() sweeps every event of the
// program by design; this one must not, or ticking the 16th would close
// September.
console.log('\n-- and the calendar write lands on that day only --');

const flag = sandbox.getSessionFlagByColumn('Waitlist_Only');
const ninth = calendarEvent('Chair Yoga', 'Bring a mat.', 9);
const sixteenth = calendarEvent('Chair Yoga', 'Bring a mat.', 16);
const otherProgram = calendarEvent('Book Club', 'Bring a book.', 16);

function stampOn(dateKey, on, eventsForDay) {
  sandbox.setCalendarStub(() => ({ getEvents: () => eventsForDay }));
  return sandbox.stampSessionFlagOnCalendarEvent('Chair Yoga', CAL, dateKey, flag, on);
}

const stamped = stampOn('2026-09-16', true, [otherProgram, sixteenth]);
check('the tag is written once', stamped.stamped, 1);
check('onto the event asked for', /\[Waitlist Only\]/.test(sixteenth.state.description), true);
check('another program that day is untouched', otherProgram.state.writes, 0);
check('and so is the same program on another date', ninth.state.writes, 0);

// Idempotent: the queue drains on every sync, and a tag already written is a
// calendar notification nobody needs.
check('stamping it again writes nothing', stampOn('2026-09-16', true, [sixteenth]).stamped, 0);
check('but still reports success, so the queue entry clears',
  stampOn('2026-09-16', true, [sixteenth]).ok, true);

// Untick.
check('unticking removes it', stampOn('2026-09-16', false, [sixteenth]).stamped, 1);
check('and leaves the description as it was', sixteenth.state.description, 'Bring a mat.');

// A day this run could not find the event on stays QUEUED rather than being
// dropped: the alternative is a tick that vanishes with nothing to show for it.
const missing = stampOn('2026-09-30', true, []);
check('a day with no matching event is not delivered', missing.ok, false);
check('and nothing is written', missing.stamped, 0);

// The queue tells two dates of one program apart — the whole reason the entry
// carries a date at all.
check('two dates of one program are two queue entries',
  sandbox.pendingFlagKey('Waitlist_Only', CAL, 'Chair Yoga', '2026-09-16') ===
  sandbox.pendingFlagKey('Waitlist_Only', CAL, 'Chair Yoga', '2026-09-23'), false);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
