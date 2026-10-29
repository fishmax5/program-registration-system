// ROOMS AND DOUBLE-BOOKING (99zw_room_conflicts.gs) — warn only, never block.
//
// Pinned here:
//   • the overlap rule: strict (back-to-back is fine), per room, and a room is
//     `Building: Room` — the same name in two buildings is two rooms;
//   • a session with no usable span is counted as unjudged, never assumed;
//   • effective room = the date's Room_Override if set, else the program's
//     Room_Or_Setup, and text that is not on Config's list is left OUT of the
//     check and NAMED, not compared;
//   • only today and later are looked at;
//   • the digest: one line per conflict per day — a second hourly pass files
//     nothing — and a NEW conflict the same day is still filed;
//   • the schema: Room_Override is the LAST session-table column, is not a
//     protected column, and the Config section sits in fresh columns.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const props = {};
const spooled = [];

const sandbox = {
  console: { log: (m) => { if (process.env.DBG) process.stderr.write(String(m) + "\n"); } },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    computeDigest: (algo, raw) => Array.from(require('crypto').createHash('md5').update(String(raw)).digest()),
    DigestAlgorithm: { MD5: 'MD5' },
    base64Encode: b => Buffer.from(b).toString('base64'),
    sleep: () => {},
    Charset: { UTF_8: 'UTF-8' }
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: k => { delete props[k]; } }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.findRoomConflicts = findRoomConflicts;
this.analyzeRoomConflicts = analyzeRoomConflicts;
this.checkRoomConflictsForDigest = checkRoomConflictsForDigest;
this.describeRoomConflicts = describeRoomConflicts;
this.forgetRoomsList = forgetRoomsList;
this.roomOptionLabels = roomOptionLabels;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.notificationProgramKey = notificationProgramKey;
this.CONFIG_LAYOUT = CONFIG_LAYOUT;
this.PROGRAM_DASHBOARD_EDITABLE_COLUMNS = PROGRAM_DASHBOARD_EDITABLE_COLUMNS;
this.REGISTRATION_SYNC_TAIL_STEPS = REGISTRATION_SYNC_TAIL_STEPS;
this.HEALTH_CHECKS = HEALTH_CHECKS;
this.__state = { rooms: [], sessions: [], settings: {} };
readRoomsList.__orig = readRoomsList;
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const day = (offset, h, min) => {
  const d = new Date(); d.setHours(h, min || 0, 0, 0); d.setDate(d.getDate() + offset); return d;
};
const s = (room, title, startH, endH, extra) => Object.assign({
  room, title, location: 'Narberth', eventId: `${title}-${startH}`,
  start: day(3, startH), end: day(3, endH)
}, extra || {});

// ---------------------------------------------------------------------------
// 1. THE PURE CHECK
// ---------------------------------------------------------------------------
{
  const R = 'Narberth: Social Hall';
  let out = sandbox.findRoomConflicts([s(R, 'Yoga', 9, 10), s(R, 'Bingo', 10, 11)]);
  ok('back-to-back sessions do not conflict', out.conflicts.length === 0);

  out = sandbox.findRoomConflicts([s(R, 'Yoga', 9, 11), s(R, 'Bingo', 10, 12)]);
  ok('overlapping sessions in one room conflict', out.conflicts.length === 1);
  ok('the earlier start is first', out.conflicts[0].first.title === 'Yoga');

  out = sandbox.findRoomConflicts([s(R, 'Yoga', 9, 11), s('Ashbridge: Social Hall', 'Bingo', 10, 12)]);
  ok('the same room name in two buildings is two rooms', out.conflicts.length === 0);

  out = sandbox.findRoomConflicts([s(R, 'A', 9, 12), s(R, 'B', 10, 11), s(R, 'C', 10, 13)]);
  ok('three mutually overlapping sessions are three pairs', out.conflicts.length === 3, `got ${out.conflicts.length}`);

  out = sandbox.findRoomConflicts([s(R, 'A', 9, 10), s(R, 'B', 11, 12), s(R, 'C', 13, 14)]);
  ok('a clean day has no conflicts', out.conflicts.length === 0);

  out = sandbox.findRoomConflicts([s(R, 'A', 9, 11), s(R.toUpperCase(), 'B', 10, 12)]);
  ok('room spelling differing only in case is one room', out.conflicts.length === 1);

  out = sandbox.findRoomConflicts([s(R, 'A', 9, 11), Object.assign(s(R, 'B', 10, 12), { end: null })]);
  ok('a session with no end time is unjudged, not assumed', out.conflicts.length === 0 && out.unjudged === 1);

  out = sandbox.findRoomConflicts([s(R, 'A', 9, 11), Object.assign(s(R, 'B', 10, 12), { end: day(3, 10) })]);
  ok('an end that is not after the start is unjudged', out.unjudged === 1);

  const a = sandbox.findRoomConflicts([s(R, 'A', 9, 11), s(R, 'B', 10, 12)]).conflicts[0].key;
  const b = sandbox.findRoomConflicts([s(R, 'B', 10, 12), s(R, 'A', 9, 11)]).conflicts[0].key;
  ok('the conflict key does not depend on input order', a === b);

  const late = sandbox.findRoomConflicts([
    Object.assign(s(R, 'Late', 23, 24), { end: day(4, 1) }),
    Object.assign(s(R, 'Later', 23, 24), { start: day(4, 0, 30), end: day(4, 2) })]);
  ok('a session running past midnight still meets one starting after it', late.conflicts.length === 1);
}

// ---------------------------------------------------------------------------
// 2. READING THE WORKBOOK: override beats default, strays are named
// ---------------------------------------------------------------------------
const configRows = [['Narberth', 'Social Hall'], ['Narberth', 'Library'], ['Ashbridge', 'Social Hall'], ['', '']];
const headers = sandbox.HEADERS.All_Program_Sessions;
const psHeaders = sandbox.HEADERS.Program_Settings;
const sessionRow = (title, location, start, end, override, id) => {
  const row = new Array(headers.length).fill('');
  row[headers.indexOf('Event_Date')] = start;
  row[headers.indexOf('Event_End')] = end;
  row[headers.indexOf('Clean_Title')] = title;
  row[headers.indexOf('Location')] = location;
  row[headers.indexOf('Room_Override')] = override || '';
  row[headers.indexOf('Event_ID')] = id;
  return row;
};
const settingsRow = (title, location, room) => {
  const row = new Array(psHeaders.length).fill('');
  row[psHeaders.indexOf('Event')] = title;
  row[psHeaders.indexOf('Location')] = location;
  row[psHeaders.indexOf('Room_Or_Setup')] = room;
  return row;
};

let SESSIONS = [];
let SETTINGS = [];
function install() {
  sandbox.forgetRoomsList();
  const configSheet = {
    getLastRow: () => 2 + configRows.length,
    getRange: (r, c, n, w) => ({ getValues: () => configRows.slice(0, n).map(x => x.slice(0, w)) })
  };
  const sessionSheet = { getName: () => 'S' };
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: name => name === sandbox.SHEET_NAMES.CONFIG ? configSheet
      : name === sandbox.SHEET_NAMES.PROGRAM_DASHBOARD ? sessionSheet : null
  });
  sandbox.getSectionedRowValues = () => SESSIONS.map(r => r.slice());
  sandbox.readNotificationPolicyRows = () => {
    const out = {};
    SETTINGS.forEach(r => {
      out[sandbox.notificationProgramKey(r[psHeaders.indexOf('Event')], r[psHeaders.indexOf('Location')])] = r;
    });
    return out;
  };
}

{
  install();
  SETTINGS = [settingsRow('Chair Yoga', 'Narberth', 'Narberth: Social Hall'),
    settingsRow('Bingo', 'Narberth', 'narberth:  social hall'),   // a sloppy spelling of the same room
    settingsRow('Painting', 'Narberth', 'chairs in rows, projector')];
  SESSIONS = [
    sessionRow('Chair Yoga', 'Narberth', day(3, 9), day(3, 11), '', 'yoga'),
    sessionRow('Bingo', 'Narberth', day(3, 10), day(3, 12), '', 'bingo'),
    sessionRow('Painting', 'Narberth', day(3, 10), day(3, 12), '', 'paint'),
    // yesterday's clash is history
    sessionRow('Chair Yoga', 'Narberth', day(-1, 9), day(-1, 11), '', 'yoga-old'),
    sessionRow('Bingo', 'Narberth', day(-1, 10), day(-1, 12), '', 'bingo-old')
  ];
  let a = sandbox.analyzeRoomConflicts();
  ok('two programs with the same default room overlap', a.conflicts.length === 1, JSON.stringify(a.conflicts.length));
  ok('past sessions are not checked', a.checked === 2, `checked ${a.checked}`);
  ok('free text is named, not compared',
    a.unrecognized.length === 1 && a.unrecognized[0].raw === 'chairs in rows, projector' &&
    a.unrecognized[0].source === 'default', JSON.stringify(a.unrecognized));

  // The override moves ONE date: Bingo goes to the Library that day, and the clash is gone.
  SESSIONS[1] = sessionRow('Bingo', 'Narberth', day(3, 10), day(3, 12), 'Narberth: Library', 'bingo');
  a = sandbox.analyzeRoomConflicts();
  ok('an override beats the default', a.conflicts.length === 0);

  // ...and an override can CREATE a conflict the defaults did not have.
  SESSIONS[2] = sessionRow('Painting', 'Narberth', day(3, 10), day(3, 12), 'Narberth: Social Hall', 'paint');
  a = sandbox.analyzeRoomConflicts();
  ok('an override can create a conflict', a.conflicts.length === 1 &&
    [a.conflicts[0].first.title, a.conflicts[0].second.title].sort().join() === 'Chair Yoga,Painting');

  // Unlisted override text is named with its source.
  SESSIONS[2] = sessionRow('Painting', 'Narberth', day(3, 10), day(3, 12), 'the big room', 'paint');
  a = sandbox.analyzeRoomConflicts();
  ok('an unlisted override is named as an override',
    a.unrecognized.some(u => u.raw === 'the big room' && u.source === 'override'));

  ok('the report says nothing is blocked', /Nothing is blocked/.test(
    sandbox.describeRoomConflicts({ roomsListed: 3, checked: 2, unjudged: 0, unrecognized: [],
      conflicts: sandbox.findRoomConflicts([s('R', 'A', 9, 11), s('R', 'B', 10, 12)]).conflicts })));
}

// No rooms listed: the check says so rather than reporting a clean bill of health.
{
  const saved = configRows.splice(0, configRows.length);
  install();
  const a = sandbox.analyzeRoomConflicts();
  ok('no rooms listed means nothing is checked', a.roomsListed === 0 && a.conflicts.length === 0);
  ok('and the report says so', /No rooms are listed/.test(sandbox.describeRoomConflicts(a)));
  ok('and the digest step files nothing', sandbox.checkRoomConflictsForDigest() === 0);
  saved.forEach(r => configRows.push(r));
}

// ---------------------------------------------------------------------------
// 3. THE DIGEST: once per conflict per day
// ---------------------------------------------------------------------------
{
  install();
  Object.keys(props).forEach(k => delete props[k]);
  SETTINGS = [settingsRow('Chair Yoga', 'Narberth', 'Narberth: Social Hall'),
    settingsRow('Bingo', 'Narberth', 'Narberth: Social Hall')];
  SESSIONS = [
    sessionRow('Chair Yoga', 'Narberth', day(3, 9), day(3, 11), '', 'yoga'),
    sessionRow('Bingo', 'Narberth', day(3, 10), day(3, 12), '', 'bingo')
  ];
  sandbox.spoolOfficeNote = (section, message) => { spooled.push({ section, message }); return true; };

  ok('the first pass files the conflict', sandbox.checkRoomConflictsForDigest() === 1);
  ok('under the Room conflicts heading, naming both programs and the room',
    spooled.length === 1 && spooled[0].section === 'Room conflicts' &&
    /Chair Yoga/.test(spooled[0].message) && /Bingo/.test(spooled[0].message) &&
    /Narberth: Social Hall/.test(spooled[0].message), JSON.stringify(spooled));
  ok('the next hourly pass files nothing', sandbox.checkRoomConflictsForDigest() === 0 && spooled.length === 1);

  SESSIONS.push(sessionRow('Mah Jongg', 'Narberth', day(4, 13), day(4, 15), 'Narberth: Social Hall', 'mj'),
    sessionRow('Knitting', 'Narberth', day(4, 14), day(4, 16), 'Narberth: Social Hall', 'knit'));
  ok('a NEW conflict the same day is filed', sandbox.checkRoomConflictsForDigest() === 1 && spooled.length === 2);
  ok('and the first is still not repeated', sandbox.checkRoomConflictsForDigest() === 0);

  // A new day tells it again.
  const saved = JSON.parse(props['ROOM_CONFLICTS_SPOOLED_V1']);
  props['ROOM_CONFLICTS_SPOOLED_V1'] = JSON.stringify({ day: '2000-01-01', keys: saved.keys });
  ok('a conflict still there tomorrow is told again', sandbox.checkRoomConflictsForDigest() === 2);

  // A spool that refuses never throws into the sync.
  sandbox.spoolOfficeNote = () => { throw new Error('spool full'); };
  props['ROOM_CONFLICTS_SPOOLED_V1'] = '{}';
  let threw = false;
  try { sandbox.checkRoomConflictsForDigest(); } catch (e) { threw = true; }
  ok('a failing spool never throws into the caller', !threw);
}

// ---------------------------------------------------------------------------
// 4. THE SCHEMA AND THE WIRING
// ---------------------------------------------------------------------------
{
  const h = sandbox.HEADERS.All_Program_Sessions;
  ok('Room_Override is the LAST session-table column', h[h.length - 1] === 'Room_Override');
  ok('Room_Override is a human-editable column', Array.from(sandbox.PROGRAM_DASHBOARD_EDITABLE_COLUMNS).indexOf('Room_Override') !== -1);
  const taken = Object.values(sandbox.CONFIG_LAYOUT).filter(x => x !== sandbox.CONFIG_LAYOUT.ROOMS)
    .reduce((m, x) => Math.max(m, x.startCol + x.headers.length - 1), 0);
  ok('Rooms sit in fresh columns past every other section', sandbox.CONFIG_LAYOUT.ROOMS.startCol > taken + 0 &&
    sandbox.CONFIG_LAYOUT.ROOMS.headers.join() === 'Building,Room');
  ok('the hourly tail has the room step, before the ledger verifier',
    (() => { const ids = sandbox.REGISTRATION_SYNC_TAIL_STEPS.map(x => x.id);
      return ids.indexOf('room_conflicts') !== -1 && ids.indexOf('room_conflicts') < ids.indexOf('ledger_verify'); })());
  ok('the Health panel has a row for it',
    sandbox.HEALTH_CHECKS.some(c => c.id === 'roomConflicts' && c.action === 'reportRoomConflicts'));
}

if (failures > 0) { console.log(`\n${failures} FAILED`); process.exit(1); }
console.log('\nall room conflict checks passed');
