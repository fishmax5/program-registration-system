// A TICK BOX ASKS BEFORE IT COUNTS (99zb).
//
// Pins: a single click on an ALLOW-LISTED check box asks; NO puts it back and
// stops the handler; YES lets it through; CANCEL lets it through and silences
// the next five minutes; a multi-cell edit, a non-checkbox cell and a missing
// UI never ask. And R3: an unlisted column (Attended) never asks, the column is
// matched by the header above it in either zone, a tick-only entry does not
// ask on the untick, and every entry names a real column of its tab.
const assert = require('assert');
const vm = require('vm');
const { readSource } = require('./helpers/source');

let answer = 'YES';
let asked = 0;
const cacheStore = {};
const ui = {
  ButtonSet: { YES_NO_CANCEL: 'YNC' },
  Button: { YES: 'YES', NO: 'NO', CANCEL: 'CANCEL', CLOSE: 'CLOSE' },
  alert: () => { asked++; return answer; }
};
let uiAvailable = true;

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '', sleep: () => {}, getUuid: () => 'u', computeDigest: () => [1], DigestAlgorithm: {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {},
    getUi: () => { if (!uiAvailable) throw new Error('no ui'); return ui; },
    DataValidationCriteria: { CHECKBOX: 'CHECKBOX', VALUE_IN_LIST: 'VALUE_IN_LIST' }
  },
  CacheService: {
    getUserCache: () => ({
      get: k => (k in cacheStore ? cacheStore[k] : null),
      put: (k, v, ttl) => { cacheStore[k] = v; cacheStore.__ttl = ttl; }
    })
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(readSource() + `
this.confirmCheckboxEditOrRevert = confirmCheckboxEditOrRevert;
this.onEdit = onEdit;
this.CHECKBOX_CONFIRM_SNOOZE_SECONDS = CHECKBOX_CONFIRM_SNOOZE_SECONDS;
this.CHECKBOX_CONFIRM_COLUMNS = CHECKBOX_CONFIRM_COLUMNS;
this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.PROGRAM_FLAG_COLUMNS = PROGRAM_FLAG_COLUMNS;
this.NOTIFICATION_CHECKBOX_COLUMNS = NOTIFICATION_CHECKBOX_COLUMNS;
`, sandbox);

// The column above the edited cell (row 14): by default a Dropped header on
// row 3 with booleans and blanks between, which is what a tick-box column is.
function columnAbove(header) {
  const col = [['--- Upcoming ---'], [''], [header]];
  while (col.length < 13) col.push([col.length % 2 ? true : '']);
  return col;
}
function edit(opts = {}) {
  const writes = [];
  const above = opts.above || columnAbove(opts.header || 'Dropped');
  const sheet = {
    getName: () => opts.tab || 'All_Registrants',
    getRange: (r, c, n) => { assert.strictEqual(n, 13); return { getValues: () => above }; }
  };
  const range = {
    getNumRows: () => opts.rows || 1,
    getNumColumns: () => 1,
    getA1Notation: () => 'C14',
    getRow: () => 14,
    getColumn: () => 3,
    getDataValidation: () => (opts.noRule ? null : { getCriteriaType: () => opts.criteria || 'CHECKBOX' }),
    setValue: v => writes.push(v),
    getSheet: () => sheet
  };
  return { e: { range, value: opts.value || 'TRUE', oldValue: opts.oldValue }, writes };
}
function reset() { asked = 0; for (const k of Object.keys(cacheStore)) delete cacheStore[k]; uiAvailable = true; }

// YES: let through, nothing written.
reset(); answer = 'YES';
let t = edit();
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.strictEqual(asked, 1);
assert.deepStrictEqual(t.writes, []);

// NO: put back to the opposite of the new value.
reset(); answer = 'NO';
t = edit({ value: 'TRUE' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), false);
assert.deepStrictEqual(t.writes, [false]);
t = edit({ value: 'FALSE', oldValue: 'TRUE' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), false);
assert.deepStrictEqual(t.writes, [true]);

// Closing the dialog is NO.
reset(); answer = 'CLOSE';
t = edit();
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), false);
assert.deepStrictEqual(t.writes, [false]);

// CANCEL: let through, snooze five minutes, and the next click is not asked.
reset(); answer = 'CANCEL';
t = edit();
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.deepStrictEqual(t.writes, []);
assert.strictEqual(cacheStore.__ttl, 300);
assert.strictEqual(sandbox.CHECKBOX_CONFIRM_SNOOZE_SECONDS, 300);
answer = 'NO';
t = edit();
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.strictEqual(asked, 1, 'snoozed: second click not asked');

// Never asked: multi-cell, non-checkbox, no rule, non-boolean value, no UI.
reset(); answer = 'NO';
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(edit({ rows: 3 }).e), true);
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(edit({ criteria: 'VALUE_IN_LIST' }).e), true);
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(edit({ noRule: true }).e), true);
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(edit({ value: 'Chair Yoga' }).e), true);
uiAvailable = false;
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(edit().e), true);
assert.strictEqual(asked, 0);

// R3: an unlisted column on the same tab goes straight through, unasked.
reset(); answer = 'NO';
t = edit({ header: 'Attended' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
t = edit({ header: 'Lunch_Served', value: 'FALSE' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.strictEqual(asked, 0, 'Attended / Lunch_Served never ask');
// A tab with nothing on the list never even reads the column.
t = edit({ tab: 'Some_Tab', above: null });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.strictEqual(asked, 0);

// Matched by header NAME (manual-entry prefix and all), in the Past zone too:
// the nearest header above wins, not the Upcoming one further up.
reset(); answer = 'NO';
const pastZone = [['--- Upcoming ---'], ['Attended'], [true], [false], ['--- Past ---'], ['\u270d\ufe0f Club']];
while (pastZone.length < 13) pastZone.push([false]);
t = edit({ tab: 'All_Program_Sessions', above: pastZone });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), false);
assert.strictEqual(asked, 1, 'Club in the Past zone asks');
const upcomingOnly = [['Club'], [true], ['Attended']];
while (upcomingOnly.length < 13) upcomingOnly.push(['']);
t = edit({ tab: 'All_Program_Sessions', above: upcomingOnly });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true, 'nearest header is not a listed one');
assert.strictEqual(asked, 1);
// Same column name on another tab's list only counts on that tab.
t = edit({ tab: 'All_Program_Sessions', header: 'Dropped' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.strictEqual(asked, 1);

// Every listed tab: flags on both dashboards, Waitlist_Only, the notification
// ticks, the leader's notify tick.
reset(); answer = 'YES';
[['All_Program_Sessions', 'Waitlist_Only'], ['All_Program_Sessions', 'No_Registration'],
 ['Master_Program_Dashboard', 'Personalized_Assistance'], ['Program_Settings', 'Add_Guest_To_Calendar'],
 ['Program_Settings', 'Day_Before'], ['Program_Leaders', 'Notify_Roster_Changes'],
 ['All_Registrants', 'Waitlisted']].forEach(([tab, header]) => {
  const before = asked;
  sandbox.confirmCheckboxEditOrRevert(edit({ tab, header }).e);
  assert.strictEqual(asked, before + 1, `${tab} ${header} asks`);
});

// Club_Members' Active: the tick asks, the untick does not (it asks itself).
reset(); answer = 'NO';
t = edit({ tab: 'Club_Members', header: 'Active', value: 'TRUE' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), false);
assert.strictEqual(asked, 1);
t = edit({ tab: 'Club_Members', header: 'Active', value: 'FALSE' });
assert.strictEqual(sandbox.confirmCheckboxEditOrRevert(t.e), true);
assert.strictEqual(asked, 1);

// The list itself: every entry names a real column of its tab, with a reason
// and a direction; every program flag is on both dashboards.
const list = sandbox.CHECKBOX_CONFIRM_COLUMNS;
assert.ok(list.length >= 14);
list.forEach(entry => {
  assert.ok(sandbox.HEADERS[entry.tab], `HEADERS has ${entry.tab}`);
  assert.ok(sandbox.HEADERS[entry.tab].indexOf(entry.column) !== -1, `${entry.tab} has ${entry.column}`);
  assert.ok(['both', 'tick', 'untick'].indexOf(entry.ask) !== -1);
  assert.ok(entry.why && entry.why.length > 20);
});
sandbox.PROGRAM_FLAG_COLUMNS.forEach(flag => {
  ['All_Program_Sessions', 'Master_Program_Dashboard'].forEach(tab =>
    assert.ok(list.some(x => x.tab === tab && x.column === flag.column), `${tab} ${flag.column}`));
});
sandbox.NOTIFICATION_CHECKBOX_COLUMNS.forEach(c =>
  assert.ok(list.some(x => x.tab === 'Program_Settings' && x.column === c)));
['Attended', 'Lunch_Served', 'Contacted', 'Confirmed'].forEach(c =>
  assert.ok(!list.some(x => x.column === c), `${c} is not confirmed`));

// onEdit: a declined tick never reaches the tab's handler.
reset(); answer = 'NO';
t = edit({ tab: 'All_Registrants' });
sandbox.onEdit(t.e); // would throw inside handleRegistrantsEdit on this stub range if reached
assert.deepStrictEqual(t.writes, [false]);
assert.strictEqual(asked, 1);

console.log('checkbox_confirm: ok');
