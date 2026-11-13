// GUESTS NEVER SEE EACH OTHER (33, section 5b-iii).
//
// Registrants are added as guests on the real calendar event, and Google shows
// every guest the whole list unless the event says otherwise — a class roster
// of members' personal addresses handed to everybody on it. This pins the
// one-event helper, and the sweep's three rules: only events WITH guests are
// touched (a recurring series must not be split for nothing), an event already
// hidden is left alone, and a refusal is counted rather than thrown.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const logs = [];
function fakeEvent(title, guests, canSee, refuse) {
  return {
    title, canSee, writes: 0,
    getTitle() { return this.title; },
    getGuestList() { return guests.map(e => ({ getEmail: () => e })); },
    guestsCanSeeGuests() { return this.canSee; },
    setGuestsCanSeeGuests(v) { if (refuse) throw new Error('refused'); this.writes++; this.canSee = v; return this; }
  };
}
const exposed = fakeEvent('Chair Yoga', ['a@x.com', 'b@x.com'], true);
const noGuests = fakeEvent('Bingo', [], true);
const alreadyHidden = fakeEvent('Mah Jongg', ['c@x.com'], false);
const refuses = fakeEvent('T\'ai Chi', ['d@x.com'], true, true);

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => String(d), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} },
  CalendarApp: { getCalendarById: () => ({ getEvents: () => [exposed, noGuests, alreadyHidden, refuses] }) },
  DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.hideAllCalendarGuestLists = hideAllCalendarGuestLists;
this.hideEventGuestList_ = hideEventGuestList_;
Object.keys(CALENDAR_MAP).forEach(k => delete CALENDAR_MAP[k]); CALENDAR_MAP['one@group.calendar.google.com'] = 'Narberth';
log = function (m) { __logs.push(m); };
toastIfPossible = function () {};
`, Object.assign(sandbox, { __logs: logs }), { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const summary = sandbox.hideAllCalendarGuestLists();
check('an event with guests showing is hidden', [exposed.canSee, exposed.writes], [false, 1]);
check('an event with no guests is not touched', noGuests.writes, 0);
check('an event already hidden is not written again', alreadyHidden.writes, 0);
check('the summary counts what changed and what refused',
  /hidden on 1 upcoming event\(s\); 3 event\(s\) with guests out of 4 checked\. 1 could not be changed/.test(summary), true);
check('a refusal is logged, not thrown', logs.some(m => /Could not hide the guest list/.test(m)), true);

const again = sandbox.hideAllCalendarGuestLists();
check('a second press changes nothing it already did', /hidden on 0 upcoming/.test(again), true);

const fresh = fakeEvent('Knit', ['e@x.com'], true);
check('the helper hides an exposed event', [sandbox.hideEventGuestList_(fresh, null), fresh.canSee], [true, false]);
check('and reports no change on a hidden one', sandbox.hideEventGuestList_(fresh, null), false);

if (failures) { console.log(`${failures} failure(s)`); process.exit(1); }
