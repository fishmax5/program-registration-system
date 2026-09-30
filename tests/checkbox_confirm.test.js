// A TICK BOX ASKS BEFORE IT COUNTS (99zb).
//
// Pins: a single check-box click asks; NO puts it back and stops the handler;
// YES lets it through; CANCEL lets it through and silences the next five
// minutes; a multi-cell edit, a non-checkbox cell and a missing UI never ask.
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
`, sandbox);

function edit(opts = {}) {
  const writes = [];
  const range = {
    getNumRows: () => opts.rows || 1,
    getNumColumns: () => 1,
    getA1Notation: () => 'C14',
    getRow: () => 14,
    getColumn: () => 3,
    getDataValidation: () => (opts.noRule ? null : { getCriteriaType: () => opts.criteria || 'CHECKBOX' }),
    setValue: v => writes.push(v),
    getSheet: () => ({ getName: () => opts.tab || 'Some_Tab' })
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

// onEdit: a declined tick never reaches the tab's handler.
reset(); answer = 'NO';
t = edit({ tab: 'All_Registrants' });
sandbox.onEdit(t.e); // would throw inside handleRegistrantsEdit on this stub range if reached
assert.deepStrictEqual(t.writes, [false]);
assert.strictEqual(asked, 1);

console.log('checkbox_confirm: ok');
