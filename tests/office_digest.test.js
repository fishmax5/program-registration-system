// THE OFFICE'S DAILY DIGEST: one message a day instead of a copy of each send.
//
// A tick on Config's Admin Notification Emails table used to put a copy of
// every leader alert and every registrant reminder in somebody's inbox as it
// went. It now means one email a day, so this queue is the ONLY thing that
// tells the office what left the organization — which makes four properties
// load-bearing: a note must survive the execution that made it (a different
// execution sends it), a quiet day must send nothing at all (a daily "nothing
// happened" is how an address gets filtered into a folder nobody opens), a
// person must read only the categories they are ticked for, and a send that
// fails must leave the queue intact rather than dropping a day of record.
//
// The cap is checked too: a Script Property is 9KB and a day of reminders is
// hundreds of lines, so past the cap the queue keeps COUNTING without
// remembering — "and 212 more" is true and useful; a write that throws
// mid-sync is neither.
const vm = require('vm');

const src = require('./helpers/source').readSource();

const store = {};
let sentMail = [];
let mailThrows = false;
// Who is ticked for what on Config's Admin Notification Emails table.
let ticks = { leaderRosterAlerts: ['office@example.org'], registrantReminders: ['office@example.org'] };

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      setProperties: obj => { Object.keys(obj).forEach(k => { store[k] = obj[k]; }); },
      deleteProperty: k => { delete store[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {},
  MailApp: {
    sendEmail: (to, subject, body) => {
      if (mailThrows) throw new Error('quota');
      sentMail.push({ to, subject, body });
    }
  },
  DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.noteForOffice = noteForOffice;
this.saveOfficeDigestQueue = saveOfficeDigestQueue;
this.sendOfficeDailyDigest = sendOfficeDailyDigest;
this.readOfficeDigestQueue_ = readOfficeDigestQueue_;
this.OFFICE_DIGEST_PROP_KEY = OFFICE_DIGEST_PROP_KEY;
this.OFFICE_DIGEST_MAX_LINES = OFFICE_DIGEST_MAX_LINES;
// The Config tab is unreachable in this context, so the ticks are stubbed at
// the two functions every caller reads them through.
this.__setTicks = fn => { adminEmailsForCategory = fn; getAllAdminNotificationEmails = () => fn('filesShared'); };
`, sandbox, { filename: 'program.gs' });

sandbox.__setTicks(key => ticks[key] || []);

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function checkTrue(name, actual) { check(name, !!actual, true); }
function reset() {
  Object.keys(store).forEach(k => { delete store[k]; });
  sentMail = [];
  mailThrows = false;
  ticks = { leaderRosterAlerts: ['office@example.org'], registrantReminders: ['office@example.org'] };
}

// A quiet day is silent.
reset();
check('an empty queue sends nothing', sandbox.sendOfficeDailyDigest(), 0);
check('and no mail went out', sentMail.length, 0);

// A note survives the execution that made it.
reset();
sandbox.noteForOffice('registrantReminders', 'a@b.com — Tomorrow: Yoga');
check('a note is not stored until it is saved', sandbox.readOfficeDigestQueue_().lines, 0);
sandbox.saveOfficeDigestQueue();
check('saving persists it', sandbox.readOfficeDigestQueue_().lines, 1);
checkTrue('and the property is really written', !!store[sandbox.OFFICE_DIGEST_PROP_KEY]);

// One email per person, carrying their own sections, then an empty queue.
sandbox.noteForOffice('leaderRosterAlerts', 'leader@x.org — Chair Yoga: 2 changes');
sandbox.saveOfficeDigestQueue();
check('the digest reaches one address', sandbox.sendOfficeDailyDigest(), 1);
check('in exactly one message', sentMail.length, 1);
check('to the ticked address', sentMail[0].to, 'office@example.org');
checkTrue('listing the reminder', sentMail[0].body.indexOf('a@b.com — Tomorrow: Yoga') > -1);
checkTrue('and the roster alert', sentMail[0].body.indexOf('leader@x.org') > -1);
check('and the queue is cleared', sandbox.readOfficeDigestQueue_().lines, 0);
check('so a second run has nothing to send', sandbox.sendOfficeDailyDigest(), 0);

// A person reads only the categories they are ticked for.
reset();
ticks = { leaderRosterAlerts: ['leaders@example.org'], registrantReminders: ['members@example.org'] };
sandbox.noteForOffice('leaderRosterAlerts', 'leader@x.org — Chair Yoga: 2 changes');
sandbox.noteForOffice('registrantReminders', 'a@b.com — Tomorrow: Yoga');
sandbox.saveOfficeDigestQueue();
check('two people, two messages', sandbox.sendOfficeDailyDigest(), 2);
const toLeaders = sentMail.filter(m => m.to === 'leaders@example.org')[0];
checkTrue('the roster reader gets the alerts', toLeaders.body.indexOf('leader@x.org') > -1);
check('and nothing about the reminders', toLeaders.body.indexOf('a@b.com'), -1);

// A section nobody is ticked for is never queued at all.
reset();
ticks = {};
sandbox.noteForOffice('registrantReminders', 'a@b.com — Tomorrow: Yoga');
sandbox.saveOfficeDigestQueue();
check('an untouched table queues nothing', sandbox.readOfficeDigestQueue_().lines, 0);

// Files shared reach every address on the table, ticked or not.
reset();
ticks = { filesShared: ['office@example.org', 'desk@example.org'] };
sandbox.noteForOffice('filesShared', '"Yoga" (Main) shared with leader@x.org');
sandbox.saveOfficeDigestQueue();
check('everybody on the table hears about a share', sandbox.sendOfficeDailyDigest(), 2);

// A failed send keeps the record.
reset();
sandbox.noteForOffice('registrantReminders', 'a@b.com — Tomorrow: Yoga');
sandbox.saveOfficeDigestQueue();
mailThrows = true;
check('a send that throws reaches nobody', sandbox.sendOfficeDailyDigest(), 0);
check('and the queue survives for the next run', sandbox.readOfficeDigestQueue_().lines, 1);
mailThrows = false;
check('which then sends it', sandbox.sendOfficeDailyDigest(), 1);

// Past the cap the queue counts without remembering.
reset();
const over = sandbox.OFFICE_DIGEST_MAX_LINES + 40;
for (let i = 0; i < over; i++) {
  sandbox.noteForOffice('registrantReminders', `person${i}@b.com — Tomorrow`);
}
sandbox.saveOfficeDigestQueue();
const queue = sandbox.readOfficeDigestQueue_();
check('lines stop at the cap', queue.lines, sandbox.OFFICE_DIGEST_MAX_LINES);
check('but the count is the truth', queue.sections.registrantReminders.count, over);
sandbox.sendOfficeDailyDigest();
checkTrue('and the digest says how many it did not list',
  sentMail[0].body.indexOf(`…and ${over - sandbox.OFFICE_DIGEST_MAX_LINES} more`) > -1);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
