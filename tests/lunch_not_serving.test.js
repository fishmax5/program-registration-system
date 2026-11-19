// ============================================================================
// A LUNCH DAY THE KITCHEN IS NOT SERVING LEAVES THE FORM, THE PUBLIC SCHEDULE
// AND THE "UNLIMITED" STATUS — WITHOUT LOSING WHO SIGNED UP
//
// Lunch_Schedule marks a day "Not Serving". The lunch sync (13) stops wanting
// it, but a row people signed up for stays on the session tab so the record of
// who asked survives. Pins what then happens to that kept row:
//
//   1. 09 — buildFormSessionContext() gives a lunch-only form only its served
//      days, so the hourly shape check cannot put the day back on the form; a
//      form with none left comes out empty (callers leave it alone; 99ze
//      closes it — see sync_skip_unchanged). A program form is untouched.
//   2. 30 — the row's Status reads "⛔ Not Serving" (count kept), not Unlimited.
//   3. 86 — the public schedule leaves the row out.
//   4. 13 — the hourly lunch pass takes the row off once every sign-up on it
//      is Cancelled or Superseded, but keeps a still-open form's last upcoming
//      rows until 99ze has closed it.
// ============================================================================
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const x = new Date(d);
      const pad = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
      return x.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSpreadsheetTimeZone: () => 'America/New_York' }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York' },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.NOT_SERVING_STATUS = NOT_SERVING_STATUS;
this.EVENT_STATUS_COLORS = EVENT_STATUS_COLORS;
this.SHEET_NAMES = SHEET_NAMES;
`, sandbox, { filename: 'program.gs' });
sandbox.log = () => {};
sandbox.getPersistentFormRegistry = () => ({});

const headers = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(headers);
const today = new Date();
const dayAt = n => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n, 11, 30);
const key = d => sandbox.formatDateKey(d);

const SERVED = dayAt(2);
const DARK = dayAt(3);
const notServed = new Set([key(DARK)]);
sandbox.isLunchOfferedOn = date => !notServed.has(key(date));

function row(fields) {
  const out = new Array(headers.length).fill('');
  Object.keys(fields).forEach(k => { out[map[k]] = fields[k]; });
  return out;
}
const lunchRow = (date, extra) => row(Object.assign({
  Event_Date: date, Location: 'Narberth', Clean_Title: 'Lunch @ Narberth',
  Event_ID: `LUNCHONLY:${key(date)}|Narberth`, Form_ID: 'LUNCHFORM', Max_Capacity: '--'
}, extra || {}));

// ---------------------------------------------------------------------------
// 1. The form's dates
// ---------------------------------------------------------------------------
{
  const ctx = sandbox.buildFormSessionContext('LUNCHFORM', [lunchRow(SERVED), lunchRow(DARK)], map, new Set());
  assert.strictEqual(ctx.isLunchOnly, true);
  assert.deepStrictEqual(ctx.sessions.map(s => key(s.date)), [key(SERVED)],
    'a lunch-only form offers only its served days');

  const empty = sandbox.buildFormSessionContext('LUNCHFORM', [lunchRow(DARK)], map, new Set());
  assert.strictEqual(empty.sessions.length, 0, 'a form with no served day comes out with no sessions');

  const program = row({ Event_Date: DARK, Location: 'Narberth', Clean_Title: 'Chair Yoga',
    Event_ID: 'EV1', Form_ID: 'PROGFORM' });
  const progCtx = sandbox.buildFormSessionContext('PROGFORM', [program], map, new Set());
  assert.strictEqual(progCtx.sessions.length, 1, 'a program form keeps every date, served or not');
}

// ---------------------------------------------------------------------------
// 2. The session tab's Status
// ---------------------------------------------------------------------------
{
  const rows = [lunchRow(SERVED), lunchRow(DARK), row({ Event_Date: DARK, Location: 'Narberth',
    Clean_Title: 'Chair Yoga', Event_ID: 'EV1', Max_Capacity: 10 })];
  const colMap = {};
  headers.forEach((h, i) => { colMap[h] = i + 1; });
  const model = { map: colMap, grid: rows, columns: {}, dirty: {} };
  const zone = { start: 1, count: rows.length };
  const counts = {
    [`LUNCHONLY:${key(SERVED)}|Narberth`]: { active: 3, waitlist: 0 },
    [`LUNCHONLY:${key(DARK)}|Narberth`]: { active: 4, waitlist: 0 },
    EV1: { active: 2, waitlist: 0 }
  };
  sandbox.recomputeCountsForZone(model, zone, counts);
  const status = sandbox.sessionGridColumn(model, zone, 'Status');
  const active = sandbox.sessionGridColumn(model, zone, 'Active_Count');
  assert.strictEqual(status[0], '🟢 Unlimited', 'a served lunch day reads as before');
  assert.strictEqual(status[1], sandbox.NOT_SERVING_STATUS, 'a Not Serving lunch day says so');
  assert.strictEqual(active[1], 4, 'and keeps its count: those are the people to tell');
  assert.strictEqual(status[2], '🟢 Open', 'a program on the same day is untouched');
  assert.ok(sandbox.EVENT_STATUS_COLORS[sandbox.NOT_SERVING_STATUS], 'the new status has a colour');

  // A menu tab that cannot be read leaves the row as it was.
  const realOffered = sandbox.isLunchOfferedOn;
  sandbox.isLunchOfferedOn = () => { throw new Error('sheet unavailable'); };
  const model2 = { map: colMap, grid: rows, columns: {}, dirty: {} };
  sandbox.recomputeCountsForZone(model2, zone, counts);
  assert.strictEqual(sandbox.sessionGridColumn(model2, zone, 'Status')[1], '🟢 Unlimited');
  sandbox.isLunchOfferedOn = realOffered;
}

// ---------------------------------------------------------------------------
// 3. The public schedule
// ---------------------------------------------------------------------------
{
  const todayKey = key(today);
  const horizonKey = key(dayAt(60));
  assert.ok(sandbox.buildPublicSessionRow(lunchRow(SERVED, { Status: '🟢 Unlimited' }), map, todayKey, horizonKey),
    'a served lunch day is on the schedule');
  assert.strictEqual(sandbox.buildPublicSessionRow(lunchRow(DARK, { Status: '🟢 Unlimited' }), map, todayKey, horizonKey),
    null, 'a Not Serving lunch day is not');
}

// ---------------------------------------------------------------------------
// 4. The hourly lunch pass takes a row off once nobody live is signed up
// ---------------------------------------------------------------------------
{
  const rMap = sandbox.getIndexMap(sandbox.HEADERS.All_Registrants);
  const reg = (eventId, status) => {
    const r = new Array(sandbox.HEADERS.All_Registrants.length).fill('');
    r[rMap['Event_ID']] = eventId; r[rMap['Program_Status']] = status;
    return r;
  };
  const d = n => dayAt(n);
  const id = date => `LUNCHONLY:${key(date)}|Narberth`;
  const A = d(5), B = d(6), C = d(7), E = d(8), F = d(9), PAST = d(-5);
  let sessionRows, registrantRows, rendered, ended;
  const setup = () => {
    sessionRows = [
      lunchRow(A),                                // live sign-up: stays
      lunchRow(B),                                // all cancelled: goes
      lunchRow(C),                                // nobody ever: goes
      lunchRow(E, { Form_ID: 'DECFORM' }),        // the only upcoming row of an open form
      lunchRow(F, { Form_ID: 'DECFORM' }),
      lunchRow(PAST, { Form_ID: 'DECFORM' })      // a past row does not keep a form "seen"
    ];
    registrantRows = [reg(id(A), 'Active'), reg(id(A), 'Cancelled'),
      reg(id(B), 'Cancelled'), reg(id(B), 'Superseded'), reg(id(F), 'Cancelled')];
    rendered = null;
  };
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSpreadsheetTimeZone: () => 'America/New_York',
    getSheetByName: name => ({ name })
  });
  sandbox.getSectionedRows = sheet => (sheet && sheet.name === sandbox.SHEET_NAMES.REGISTRANT_DASH
    ? registrantRows : sessionRows);
  sandbox.renderProgramDashboard = (force, opts) => { rendered = opts.sessionRows; };
  sandbox.readEndedForms = () => ended;
  const headersS = sandbox.HEADERS.All_Program_Sessions;
  const left = () => rendered.map(r => key(r[map['Event_Date']]));

  setup(); ended = {};
  const n = sandbox.pruneStaleLunchOnlyRows_({ name: 'sessions' }, headersS, map, {}, { cateredRows: 3 });
  assert.strictEqual(n, 2, 'the all-cancelled day and the nobody day go');
  assert.deepStrictEqual(left(), [key(A), key(E), key(F), key(PAST)],
    'a live sign-up keeps its day, and a still-open form keeps its last upcoming rows');

  setup(); ended = { DECFORM: { closedByUs: true } };
  sandbox.pruneStaleLunchOnlyRows_({ name: 'sessions' }, headersS, map, {}, { cateredRows: 3 });
  assert.deepStrictEqual(left(), [key(A), key(PAST)], 'once the form is closed, its rows go too');
}

console.log('✅ lunch_not_serving.test.js passed');
