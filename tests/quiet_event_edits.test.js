// QUIET EVENT EDITS (33_calendar_invitations.gs, section 5c) — the sync's own
// description and time edits never email an event's guests. An event with
// guests is patched through the Advanced Calendar service with
// sendUpdates: 'none'; one without guests keeps the plain CalendarApp call; and
// an event whose API copy cannot be told apart falls back to CalendarApp
// rather than leaving a stale sign-up link.
const assert = require('assert');
const vm = require('vm');
const src = require('./helpers/source').readSource();

const patches = [];
let listItems = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, CacheService: {},
  Calendar: {
    Events: {
      list: () => ({ items: listItems }),
      patch: (resource, calendarId, eventId, options) => { patches.push({ resource, calendarId, eventId, options }); return {}; }
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.setEventDescriptionQuietly = setEventDescriptionQuietly;
this.setEventTimeQuietly = setEventTimeQuietly;
log = function () {};
`, sandbox);

const START = new Date('2026-12-01T15:30:00Z');
const END = new Date('2026-12-01T17:00:00Z');
function fakeEvent(guests) {
  const ev = {
    plainDescription: null, plainTime: null,
    getGuestList: () => guests.map(g => ({ getEmail: () => g })),
    getOriginalCalendarId: () => 'cal@group.calendar.google.com',
    getStartTime: () => START, getEndTime: () => END,
    getTitle: () => 'Intro to Tai Chi',
    setDescription(t) { this.plainDescription = t; },
    setTime(s, e) { this.plainTime = [s, e]; }
  };
  return ev;
}
const instance = { id: 'abc_20261201T153000Z', summary: 'Intro to Tai Chi', start: { dateTime: START.toISOString() }, recurringEventId: 'abc' };

// 1. No guests: the ordinary call, no API round trip.
{
  patches.length = 0; listItems = [instance];
  const ev = fakeEvent([]);
  sandbox.setEventDescriptionQuietly(ev, 'new link');
  assert.strictEqual(ev.plainDescription, 'new link');
  assert.strictEqual(patches.length, 0);
}

// 2. Guests: patched by the INSTANCE id with sendUpdates none; CalendarApp untouched.
{
  patches.length = 0; listItems = [instance];
  const ev = fakeEvent(['member@example.com']);
  sandbox.setEventDescriptionQuietly(ev, 'new link');
  assert.strictEqual(ev.plainDescription, null, 'the notifying CalendarApp call must not run');
  assert.strictEqual(patches.length, 1);
  assert.strictEqual(patches[0].eventId, 'abc_20261201T153000Z');
  assert.strictEqual(patches[0].calendarId, 'cal@group.calendar.google.com');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(patches[0].options)), { sendUpdates: 'none' });
  assert.strictEqual(patches[0].resource.description, 'new link');
}

// 3. Time moves on an event with guests are quiet too.
{
  patches.length = 0; listItems = [instance];
  const ev = fakeEvent(['member@example.com']);
  const s2 = new Date('2026-12-01T15:00:00Z');
  sandbox.setEventTimeQuietly(ev, s2, END);
  assert.strictEqual(ev.plainTime, null);
  assert.strictEqual(patches[0].resource.start.dateTime, s2.toISOString());
  assert.strictEqual(patches[0].resource.end.dateTime, END.toISOString());
  assert.strictEqual(patches[0].options.sendUpdates, 'none');
}

// 4. Two same-titled items in the slot: cannot tell them apart, so fall back
//    to CalendarApp — the description must still be written.
{
  patches.length = 0; listItems = [instance, Object.assign({}, instance, { id: 'other' })];
  const ev = fakeEvent(['member@example.com']);
  sandbox.setEventDescriptionQuietly(ev, 'new link');
  assert.strictEqual(patches.length, 0);
  assert.strictEqual(ev.plainDescription, 'new link');
}

// 5. The API refusing the patch also falls back, and nothing throws.
{
  patches.length = 0; listItems = [instance];
  const saved = sandbox.Calendar.Events.patch;
  sandbox.Calendar.Events.patch = () => { throw new Error('quota'); };
  const ev = fakeEvent(['member@example.com']);
  sandbox.setEventDescriptionQuietly(ev, 'new link');
  assert.strictEqual(ev.plainDescription, 'new link');
  sandbox.Calendar.Events.patch = saved;
}

console.log('quiet_event_edits: all passed');
