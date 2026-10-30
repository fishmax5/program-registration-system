// BULK REGISTRANTS, THE THIRD WAY IN (99q): a deleted session's people off
// Deleted_Event_Triage — grouped per session, one per person, guests left
// alone, and only the people the job wrote are taken off the tab afterwards.
const vm = require('vm');
const assert = require('assert');
const { readSource } = require('./helpers/source');

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; },
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {}, Charset: { UTF_8: 'UTF-8' }, getUuid: () => 'u' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {},
  Logger: { log: () => {} }
};
vm.createContext(sandbox);
vm.runInContext(readSource(), sandbox);
const run = code => vm.runInContext(code, sandbox);

const out = JSON.parse(run(`(() => {
  const H = HEADERS.Deleted_Event_Triage;
  const m = getIndexMap(H);
  const mk = o => { const r = new Array(H.length).fill(''); Object.keys(o).forEach(k => { r[m[k]] = o[k]; }); return r; };
  const d1 = new Date(2026, 9, 6), d2 = new Date(2026, 9, 13);
  const rows = [
    mk({ Name: 'Jane Smith', Phone: '610', Email: 'j@x.org', Event_ID: 'A', Event_Date: d1, Deleted_Event_Title: 'Chair Yoga', Deleted_Event_Location: 'Narberth', Person_Type: 'Registrant' }),
    mk({ Name: 'Jane Smith', Event_ID: 'A', Event_Date: d1, Deleted_Event_Title: 'Chair Yoga', Deleted_Event_Location: 'Narberth', Person_Type: 'Registrant' }),
    mk({ Name: 'Her Guest', Event_ID: 'A', Event_Date: d1, Deleted_Event_Title: 'Chair Yoga', Deleted_Event_Location: 'Narberth', Person_Type: 'Guest' }),
    mk({ Name: 'Bob Kaplan', Event_ID: 'A', Event_Date: d1, Deleted_Event_Title: 'Chair Yoga', Deleted_Event_Location: 'Narberth', Person_Type: 'Registrant', Program_Status: 'Superseded' }),
    mk({ Name: 'Al Jones', Event_ID: 'B', Event_Date: d2, Deleted_Event_Title: 'Bingo', Deleted_Event_Location: 'Ashbridge', Person_Type: 'Registrant' })
  ];
  return JSON.stringify({
    events: bulkTriageEventsFrom_(rows, m),
    peopleA: bulkTriagePeopleFrom_(rows, m, 'A'),
    peopleB: bulkTriagePeopleFrom_(rows, m, 'B'),
    none: bulkTriagePeopleFrom_(rows, m, 'Z')
  });
})()`));

assert.strictEqual(out.events.length, 2, 'one entry per deleted session');
assert.strictEqual(out.events[0].key, 'B', 'newest session first');
assert.strictEqual(out.events.find(e => e.key === 'A').count, 1, 'counted as people, matching the review');
assert.deepStrictEqual(out.peopleA.map(p => p.name), ['Jane Smith'], 'one per person; guest and superseded left out');
assert.strictEqual(out.peopleA[0].phone, '610');
assert.strictEqual(out.peopleB.length, 1);
assert.strictEqual(out.none.length, 0);
console.log('bulk from triage: ok');
