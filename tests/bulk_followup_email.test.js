// BULK FOLLOW-UP EMAIL (99q) — only the people the job actually changed are
// offered the message; addresses come off the list then Member_Roll; a person
// is never written to twice; a hold stops the send and keeps the list.
const vm = require('vm');
const assert = require('assert');
const { readSource } = require('./helpers/source');

const store = {};
const props = {
  getProperty: k => (k in store ? store[k] : null),
  setProperty: (k, v) => { store[k] = String(v); },
  setProperties: o => { Object.keys(o).forEach(k => { store[k] = String(o[k]); }); },
  deleteProperty: k => { delete store[k]; },
  getProperties: () => Object.assign({}, store),
  getKeys: () => Object.keys(store)
};
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '2026-09-15', computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' },
    sleep: () => {}, Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'job-1' },
  PropertiesService: { getScriptProperties: () => props, getUserProperties: () => props },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {}, hasLock: () => true }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }),
    getActiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {} },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: { getScriptCache: () => null },
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(readSource(), sandbox);
const run = code => vm.runInContext(code, sandbox);

const sent = [];
let holdAfter = Infinity;
sandbox.__sent = sent;
sandbox.__hold = () => sent.length >= holdAfter;
run(`
  log = () => {}; spoolOfficeNote = () => true; isWithinMailQuietHours = () => false;
  readMemberRollRows = () => ({ rows: [{ Name: 'Cal Test', Display_Name: 'Cal Test', Email: 'cal@x.org' }] });
  sendRationedEmail = req => {
    if (__hold()) return { status: 'held', retry: 'later' };
    __sent.push(req); return { status: 'sent' };
  };
`);

// Rendering: single pass, case-insensitive, unknown braces untouched.
assert.strictEqual(run(`renderBulkFollowUpText_('Hi {name}, {Program} {x} {Change}', { name: '{Dates}', program: 'Yoga', dates: 'D', change: 'c' })`),
  'Hi {Dates}, Yoga {x} c');

// Seed a finished job: Ann changed (email on list), Bob (none anywhere), Cal (roll), Dee same email as Ann.
run(`writeBulkRegistrantsResult_({ jobId: 'j1', label: 'Yoga — A', done: true, total: 4, changed: [
  { name: 'Ann Test', email: 'ann@x.org', action: 'cancel', dates: 'Sep 15' },
  { name: 'Bob Test', email: '', action: 'register', dates: 'Sep 15' },
  { name: 'Cal Test', email: '', action: 'register', dates: 'Sep 22' },
  { name: 'Ann T', email: 'ann@x.org', action: 'cancel', dates: 'Sep 15' }] })`);
const prep = run('prepareBulkFollowUp()');
assert.strictEqual(prep.ok, true);
assert.strictEqual(prep.recipients.length, 3, 'same address + action collapses to one');
assert.strictEqual(prep.recipients[2 - 1].email, '', 'no address anywhere stays blank');
assert.strictEqual(prep.recipients.filter(r => r.email === 'cal@x.org').length, 1, 'roll supplies the address');

sandbox.__a = { ids: [0, 1, 2], subject: 'Hi {Name}', body: 'Re {Program}: {Change}' };
let res = run('sendBulkFollowUp(__a)');
assert.strictEqual(res.sent, 2, 'Bob has no address and is skipped');
assert.strictEqual(sent[0].subject, 'Hi Ann Test');
assert.ok(/Yoga — A: your registration has been cancelled/.test(sent[0].body));

// A second press sends nobody again.
res = run('sendBulkFollowUp(__a)');
assert.strictEqual(res.sent, 0);
assert.strictEqual(sent.length, 2);

// A hold stops the run and the unsent person stays owed.
run(`writeBulkRegistrantsResult_({ jobId: 'j2', label: 'Y', done: true, total: 2, changed: [
  { name: 'A', email: 'a@x.org', action: 'register', dates: 'd' }, { name: 'B', email: 'b@x.org', action: 'register', dates: 'd' }] })`);
run('prepareBulkFollowUp()');
holdAfter = sent.length + 1;
res = run('sendBulkFollowUp({ ids: [0, 1], subject: "s", body: "b" })');
assert.strictEqual(res.sent, 1);
assert.strictEqual(res.remaining, 1);
assert.ok(res.stopped);
holdAfter = Infinity;
res = run('sendBulkFollowUp({ ids: [0, 1], subject: "s", body: "b" })');
assert.strictEqual(res.sent, 1, 'the kept list carries on with the one left');
assert.strictEqual(run('sendBulkFollowUp({ ids: [0], subject: "", body: "b" })').ok, false);

console.log('bulk_followup_email: all passed');
