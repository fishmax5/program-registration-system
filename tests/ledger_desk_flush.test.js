// DESK PATHS FLUSH THE LEDGER. Quick Mark, the household press, 99a's changes,
// 71's cancels, the door app and 99b's retries all write inside
// withScriptLock() and never reach flushPersistentRegistries(), so an entry
// they append must be flushed by the lock itself — BEFORE the release, so the
// append lands under the lock that covered the rows — and a refused lock or a
// throwing body must not skip it. The two web-app cancel doors flush too.
const vm = require('vm');
const assert = require('assert');
const src = require('./helpers/source').readSource();

const events = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), getUuid: () => 'u', sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => sandbox.__lockFree, releaseLock: () => events.push('release') }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'x' }), getActiveUser: () => ({ getEmail: () => 'x' }) },
  __lockFree: true
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
vm.runInContext(`
  flushLedger = function () { __events.push('flush'); return 0; };
  log = function () {};
`, Object.assign(sandbox, { __events: events }));

// Ordinary desk write: flushed, and flushed before the release.
assert.strictEqual(sandbox.withScriptLock(10, () => { events.push('body'); return 7; }), 7);
assert.deepStrictEqual(events.splice(0), ['body', 'flush', 'release']);

// A body that throws still flushes what it appended before throwing.
assert.throws(() => sandbox.withScriptLock(10, () => { events.push('body'); throw new Error('x'); }));
assert.deepStrictEqual(events.splice(0), ['body', 'flush', 'release']);

// A flush that throws must not keep the lock held or mask the result.
vm.runInContext(`flushLedger = function () { __events.push('flush'); throw new Error('boom'); };`, sandbox);
assert.strictEqual(sandbox.withScriptLock(10, () => 3), 3);
assert.deepStrictEqual(events.splice(0), ['flush', 'release']);
vm.runInContext(`flushLedger = function () { __events.push('flush'); return 0; };`, sandbox);

// A busy lock runs nothing, so there is nothing to flush.
sandbox.__lockFree = false;
assert.strictEqual(sandbox.withScriptLock(10, () => 1, 'busy'), 'busy');
assert.deepStrictEqual(events.splice(0), []);
sandbox.__lockFree = true;

// The two web-app cancel doors flush even when the cancel itself throws.
vm.runInContext(`
  parseCheckInPayload = p => p; checkInPinAccepted = () => true; isDeskWorkBlocked = () => false;
  getCurrentUserEmail = () => '';
  cancelOneRegistration = () => { __events.push('cancel'); throw new Error('mid'); };
  parseCancelIdentity = () => ({ nameKey: 'k', email: 'e', formId: 'f', name: 'N' });
  upcomingEventIdsForForm = () => ({ E1: true });
  cancelRegistrantRows = () => { __events.push('cancel'); return { ok: true, cancelled: 1 }; };
`, sandbox);
assert.throws(() => sandbox.checkInCancel({ name: 'Joan', eventId: 'E1' }));
assert.deepStrictEqual(events.splice(0), ['cancel', 'flush']);
assert.strictEqual(sandbox.cancelPageApply({ eventIds: ['E1'] }).ok, true);
assert.deepStrictEqual(events.splice(0), ['cancel', 'flush']);

console.log('ledger_desk_flush: ok');
