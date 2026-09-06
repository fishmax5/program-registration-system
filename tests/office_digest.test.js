// THE OFFICE'S DAILY DIGEST: one message a day instead of a copy of each send.
//
// The archive copy address stopped being BCC'd, invited and shared with on
// every individual send, so the ONLY thing that now tells the office what left
// the organization is this queue. Which makes three properties load-bearing:
// a note must survive the execution that made it (it is a different execution
// that sends), a quiet day must send nothing at all (a daily "nothing
// happened" is how an address gets filtered into a folder nobody opens), and a
// send that fails must leave the queue intact rather than dropping a day of
// record on the floor.
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
let archiveEmail = 'office@example.org';

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
// The Config tab is unreachable in this context, so the address is stubbed at
// the one function every caller reads it through.
this.__setArchive = fn => { getArchiveCopyEmail = fn; };
`, sandbox, { filename: 'program.gs' });

sandbox.__setArchive(() => archiveEmail);

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
  archiveEmail = 'office@example.org';
}

// A quiet day is silent.
reset();
check('an empty queue sends nothing', sandbox.sendOfficeDailyDigest(), false);
check('and no mail went out', sentMail.length, 0);

// A note survives the execution that made it.
reset();
sandbox.noteForOffice('Reminders emailed to registrants', 'a@b.com — Tomorrow: Yoga');
check('a note is not stored until it is saved', sandbox.readOfficeDigestQueue_().lines, 0);
sandbox.saveOfficeDigestQueue();
check('saving persists it', sandbox.readOfficeDigestQueue_().lines, 1);
checkTrue('and the property is really written', !!store[sandbox.OFFICE_DIGEST_PROP_KEY]);

// One email, carrying every category, then an empty queue.
sandbox.noteForOffice('Program leader sheets shared', '"Yoga" (Main) shared with leader@x.org');
sandbox.saveOfficeDigestQueue();
check('the digest sends', sandbox.sendOfficeDailyDigest(), true);
check('exactly one message', sentMail.length, 1);
check('to the archive address', sentMail[0].to, 'office@example.org');
checkTrue('listing the reminder', sentMail[0].body.indexOf('a@b.com — Tomorrow: Yoga') > -1);
checkTrue('and the share', sentMail[0].body.indexOf('leader@x.org') > -1);
check('and the queue is cleared', sandbox.readOfficeDigestQueue_().lines, 0);
check('so a second run has nothing to send', sandbox.sendOfficeDailyDigest(), false);

// A failed send keeps the record.
reset();
sandbox.noteForOffice('Reminders emailed to registrants', 'a@b.com — Tomorrow: Yoga');
sandbox.saveOfficeDigestQueue();
mailThrows = true;
check('a send that throws reports failure', sandbox.sendOfficeDailyDigest(), false);
check('and the queue survives for the next run', sandbox.readOfficeDigestQueue_().lines, 1);
mailThrows = false;
check('which then sends it', sandbox.sendOfficeDailyDigest(), true);

// A blank address records nothing at all.
reset();
archiveEmail = '';
sandbox.noteForOffice('Reminders emailed to registrants', 'a@b.com — Tomorrow: Yoga');
sandbox.saveOfficeDigestQueue();
check('a blank Archive Copy Address queues nothing', sandbox.readOfficeDigestQueue_().lines, 0);

// Past the cap the queue counts without remembering.
reset();
const over = sandbox.OFFICE_DIGEST_MAX_LINES + 40;
for (let i = 0; i < over; i++) {
  sandbox.noteForOffice('Reminders emailed to registrants', `person${i}@b.com — Tomorrow`);
}
sandbox.saveOfficeDigestQueue();
const queue = sandbox.readOfficeDigestQueue_();
check('lines stop at the cap', queue.lines, sandbox.OFFICE_DIGEST_MAX_LINES);
check('but the count is the truth', queue.categories['Reminders emailed to registrants'].count, over);
sandbox.sendOfficeDailyDigest();
checkTrue('and the digest says how many it did not list',
  sentMail[0].body.indexOf(`…and ${over - sandbox.OFFICE_DIGEST_MAX_LINES} more`) > -1);

console.log(failures === 0 ? '\nall passed' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
