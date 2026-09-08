// ONE EMAIL A DAY, AT TEN, ABOUT YESTERDAY.
//
// The office was on four mailing paths at once — the per-sync digest, the
// per-category notices, a copy of every registrant reminder, and a BCC on
// every leader alert — which on a busy Tuesday was forty messages, and forty
// messages is the same as none. Everything the office is TOLD is spooled now
// and sent once, in the morning, covering the day before.
//
// What is pinned here is what makes that safe to rely on:
//
//   * A DAY IS CLOSED BEFORE IT IS SENT. The 10am pass sends every spooled day
//     strictly before today, so a note written at 09:59 cannot be mailed in a
//     digest headed with yesterday's date and then written again into today's.
//   * THE SPOOL IS CLEARED ONLY ONCE THE MESSAGE IS AWAY. A day cleared before
//     the send is a day nobody ever hears about; a day sent and not cleared is
//     a day sent twice.
//   * THE SAME NOTE TWICE IS ONE LINE AND A COUNT. An hourly sync that cannot
//     open the same form reports it twenty-four times; the office reads it once.
//   * IT GOES TO EVERYBODY ON THE TABLE, ticked or not. The per-category ticks
//     now govern only what still goes out immediately.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const sentMail = [];
const logged = [];
const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    // Read off the date it is given, in UTC: the spool files a note under a
    // DAY and stamps it with a time, and both have to come from the same clock
    // the sweep compares against.
    formatDate: (d, tz, pattern) => {
      const date = new Date(d);
      if (pattern === 'yyyy-MM-dd') {
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      }
      if (pattern === 'HH:mm') return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
      return date.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
      setProperty: (key, value) => { props[key] = value; },
      setProperties: obj => { Object.keys(obj).forEach(k => { props[k] = obj[k]; }); },
      deleteProperty: key => { delete props[key]; },
      getKeys: () => Object.keys(props)
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: null,
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail: (a, subject, body) => sentMail.push(
      a && typeof a === 'object' ? a : { to: a, subject, body })
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.spoolOfficeNote = spoolOfficeNote;
this.readOfficeDigestDay = readOfficeDigestDay;
this.sendOfficeDigestForDay = sendOfficeDigestForDay;
this.sendOfficeDailyDigest = sendOfficeDailyDigest;
this.buildOfficeDigestBody = buildOfficeDigestBody;
this.officeDigestDateKey = officeDigestDateKey_;
this.officeDigestChunkKey = officeDigestChunkKey_;
this.resetOfficeDigestSpoolCache = resetOfficeDigestSpoolCache;
this.OFFICE_DIGEST_SPOOL_PROP_PREFIX = OFFICE_DIGEST_SPOOL_PROP_PREFIX;
this.OFFICE_DIGEST_MAX_DAYS_SWEPT = OFFICE_DIGEST_MAX_DAYS_SWEPT;
this.log = function (message) { this.__logged.push(String(message)); };
`, sandbox, { filename: 'program.gs' });
sandbox.__logged = logged;

// Everybody on Config's table, whatever they are ticked for — the digest's own
// rule, stubbed here so the test is about the digest and not about Config.
let office = ['dana@example.org', 'lee@example.org'];
vm.runInContext('getAllAdminNotificationEmails = function () { return this.__office; };', sandbox);
sandbox.__office = office;

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}
// The spool holds the day it is working on in memory; deleting the properties
// out from under it is a test-only move, so the cache is dropped with them.
const clearProps = () => {
  Object.keys(props).forEach(k => delete props[k]);
  sandbox.resetOfficeDigestSpoolCache();
};
const dayKey = offsetDays => sandbox.officeDigestDateKey(
  new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
const today = dayKey(0);

// ---------------------------------------------------------------------------
// 1. THE SAME NOTE TWICE IS ONE LINE AND A COUNT.
// ---------------------------------------------------------------------------
clearProps();
sandbox.spoolOfficeNote('Forms that could not be opened', '1a2b3c');
sandbox.spoolOfficeNote('Forms that could not be opened', '1a2b3c');
sandbox.spoolOfficeNote('Forms that could not be opened', 'd4e5f6');
sandbox.spoolOfficeNote('Reminders sent to registrants', 'Ada — Chair Yoga');
let day = sandbox.readOfficeDigestDay(today);
check('three distinct notes, however often they were made', day.length, 3);
check('the repeat is a count on the first', day[0].n, 2);
check('a note with nothing in it is not a note',
  sandbox.spoolOfficeNote('Section', '   '), false);
check('...and files nothing', sandbox.readOfficeDigestDay(today).length, 3);

// ---------------------------------------------------------------------------
// 2. THE BODY: sections in the order they first appeared, counts, times.
// ---------------------------------------------------------------------------
const body = sandbox.buildOfficeDigestBody(today, day);
check('the section is headed with its total',
  body.indexOf('Forms that could not be opened (3)') !== -1, true);
check('a repeated note says how many times', body.indexOf('2×') !== -1, true);
check('every section is there',
  body.indexOf('Reminders sent to registrants (1)') !== -1, true);
check('and the day it covers is named', body.indexOf(today) !== -1, true);

// ---------------------------------------------------------------------------
// 3. SENDING ONE DAY: everybody on the table, then the spool is cleared.
// ---------------------------------------------------------------------------
sentMail.length = 0;
check('it goes', sandbox.sendOfficeDigestForDay(today), true);
check('as ONE message to everybody on the table',
  sentMail.map(m => m.to), ['dana@example.org,lee@example.org']);
check('the subject names the day and counts the items',
  sentMail[0].subject, `[Office digest] ${today} — 4 item(s)`);
check('and the spool is cleared once it is away',
  sandbox.readOfficeDigestDay(today).length, 0);
check('a day with nothing on it is not a message',
  sandbox.sendOfficeDigestForDay(today), false);

// A day nobody can be sent is a day KEPT, not a day thrown away.
clearProps();
sandbox.__office = [];
sandbox.spoolOfficeNote('Forms that could not be opened', '1a2b3c');
sentMail.length = 0;
check('with no addresses on Config nothing is sent', sandbox.sendOfficeDigestForDay(today), false);
check('...and nothing was mailed', sentMail.length, 0);
check('...but the day is still there for when somebody is added',
  sandbox.readOfficeDigestDay(today).length, 1);
sandbox.__office = office;

// A send that throws keeps the day too — tomorrow's sweep picks it up.
const realSend = sandbox.MailApp.sendEmail;
sandbox.MailApp.sendEmail = () => { throw new Error('over quota'); };
check('a refused send is not a sent day', sandbox.sendOfficeDigestForDay(today), false);
check('...and the day is kept for the next pass',
  sandbox.readOfficeDigestDay(today).length, 1);
sandbox.MailApp.sendEmail = realSend;

// ---------------------------------------------------------------------------
// 4. THE 10AM SWEEP: yesterday goes, today waits, a fortnight-old day is dropped.
// ---------------------------------------------------------------------------
clearProps();
const yesterday = dayKey(-1);
const stale = dayKey(-(sandbox.OFFICE_DIGEST_MAX_DAYS_SWEPT + 3));
const seed = (key, entries) => {
  props[sandbox.officeDigestChunkKey(key, 0)] = JSON.stringify(entries);
};
seed(yesterday, [{ s: 'Reminders sent to registrants', m: 'Ada — Chair Yoga', n: 1, f: '09:00', l: '09:00' }]);
seed(stale, [{ s: 'Forms that could not be opened', m: 'old news', n: 1, f: '09:00', l: '09:00' }]);
sandbox.spoolOfficeNote('Calendar invitations', 'written this morning, at 09:59');

sentMail.length = 0;
check('one day was sent', sandbox.sendOfficeDailyDigest(), 1);
check('...and it was yesterday', sentMail.map(m => m.subject.indexOf(yesterday) > 0), [true]);
check('yesterday is cleared', sandbox.readOfficeDigestDay(yesterday).length, 0);
check('TODAY IS UNTOUCHED — a closed day is what gets sent',
  sandbox.readOfficeDigestDay(today).length, 1);
check('the fortnight-old day is dropped rather than mailed',
  sandbox.readOfficeDigestDay(stale).length, 0);
check('...and said so in the log',
  logged.some(line => line.indexOf('Dropped the office digest spool') !== -1), true);

// ---------------------------------------------------------------------------
// 5. A LONG DAY ROLLS ONTO A SECOND PROPERTY.
//
// A Script Property is capped at 9KB, and a day of a busy workbook is more
// than that: the day is chunked, and every chunk still reads back in order.
// ---------------------------------------------------------------------------
clearProps();
for (let i = 0; i < 120; i++) {
  sandbox.spoolOfficeNote('Reminders sent to registrants',
    `person${i}@example.org — "A Program With A Reasonably Long Title" on Tue, Mar ${i}, 2026`);
}
const chunkKeys = Object.keys(props).filter(k => k.indexOf(sandbox.OFFICE_DIGEST_SPOOL_PROP_PREFIX) === 0);
check('the day spilled onto more than one property', chunkKeys.length > 1, true);
check('no property is anywhere near the 9KB cap',
  chunkKeys.every(k => props[k].length < 9000), true);
check('and every note reads back', sandbox.readOfficeDigestDay(today).length, 120);

console.log(failures === 0 ? '\nAll office daily digest checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
