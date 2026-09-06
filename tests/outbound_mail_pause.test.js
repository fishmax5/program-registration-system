// THE ONE SWITCH THAT SAYS "NOT WHILE I AM WORKING".
//
// The failure it was built for: rows that had been deleted came back on the
// next sync — a form rebuild, a re-import, a catch-up — the roster diff
// compared the roster against its stored snapshot exactly as designed, and
// program leaders were emailed about a dozen registrations that had never
// actually changed. Nothing malfunctioned; there was simply no way to stop
// the workbook talking to people outside the office while it was being
// repaired.
//
// So the whole of this switch's correctness is four questions, and every one
// of them is somebody's inbox:
//
//   * does "Yes" actually stop a message, and does anything else — blank, a
//     typo, a Config tab that cannot be read at all — leave mail ON, since a
//     switch that trips by accident silently stops every reminder for weeks;
//   * is a held message DROPPED rather than saved up: the caller's ledger has
//     to advance, or switching the pause off delivers the churn it was set to
//     prevent;
//   * does the office still hear what happened — notifyAdmin() must not be
//     pausable, or the message telling you the repair went wrong is the one
//     you silenced;
//   * and does a message the caller had already sent still read as a
//     duplicate rather than as a pause, so a ledger is never double-counted.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sentMail = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString(), sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, setProperties: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => null,
    newDataValidation: () => {
      const rule = { requireCheckbox: () => rule, requireValueInList: () => rule, setAllowInvalid: () => rule, build: () => 'rule' };
      return rule;
    }
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  // No CacheService: the cross-execution half of the read is an optimization,
  // and tryGetScriptCache() answering null is a context this really runs in.
  CacheService: null,
  MailApp: {
    getRemainingDailyQuota: () => 100,
    // Both call shapes: the rationed mailer sends an options object, and
    // notifyAdmin() deliberately does not go through it and sends positionally.
    sendEmail: (a, subject, body) => sentMail.push(
      a && typeof a === 'object' ? a : { to: a, subject, body })
  }
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.CONFIG_LAYOUT = CONFIG_LAYOUT;
this.CONFIG_DATA_START_ROW = CONFIG_DATA_START_ROW;
this.OUTBOUND_MAIL_PAUSE_OPTIONS = OUTBOUND_MAIL_PAUSE_OPTIONS;
this.DEFAULT_OUTBOUND_MAIL_PAUSED = DEFAULT_OUTBOUND_MAIL_PAUSED;
this.isOutboundMailPaused = isOutboundMailPaused;
this.sendRationedEmail = sendRationedEmail;
this.rationedMailPausedCount = rationedMailPausedCount;
this.resetRationedMailState = resetRationedMailState;
this.invalidateConfigCaches = invalidateConfigCaches;
this.notifyAdmin = notifyAdmin;
this.seedOutboundMailRow = seedOutboundMailRow;
this.configLastColumn = configLastColumn;
this.flushAdminDigest = flushAdminDigest;
this.__setConfigSheet = function (sheet) { __configSheetForTest = sheet; };
var __configSheetForTest = null;
SpreadsheetApp.getActiveSpreadsheet = function () {
  return {
    getUrl: function () { return 'https://example.test/workbook'; },
    getSheetByName: name => (name === SHEET_NAMES.CONFIG ? __configSheetForTest : null)
  };
};
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const PAUSE = sandbox.CONFIG_LAYOUT.OUTBOUND_MAIL;
const ROW = sandbox.CONFIG_DATA_START_ROW;

/** A Config tab holding one value in the pause cell (and the digest table empty). */
function configSheet(pauseValue, options) {
  const opts = options || {};
  const notes = {};
  const grid = {};
  if (pauseValue !== undefined) grid[`${ROW},${PAUSE.startCol}`] = pauseValue;
  // One person in the office ticked for the sync digest, so notifyAdmin() has
  // somebody to write to and "the office still hears" is a real send rather
  // than an empty list read as success.
  if (opts.digestTo) {
    const admin = sandbox.CONFIG_LAYOUT.ADMIN_NOTIFICATIONS;
    grid[`${ROW},${admin.startCol}`] = opts.digestTo;
    grid[`${ROW},${admin.startCol + 1}`] = true; // Sync_Digest
  }
  const sheet = {
    notes,
    getName: () => 'Config',
    getLastRow: () => 8,
    getMaxColumns: () => 60,
    getRange: (row, col, numRows, numCols) => {
      if (opts.throwOnRead) throw new Error('the tab is mid-rebuild');
      const key = `${row},${col}`;
      const rows = numRows === undefined ? 1 : numRows;
      const cols = numCols === undefined ? 1 : numCols;
      const range = {
        getValue: () => (grid[key] === undefined ? '' : grid[key]),
        getValues: () => {
          const out = [];
          for (let r = 0; r < rows; r++) {
            const line = [];
            for (let c = 0; c < cols; c++) {
              const v = grid[`${row + r},${col + c}`];
              line.push(v === undefined ? '' : v);
            }
            out.push(line);
          }
          return out;
        },
        setValue: v => { grid[key] = v; return range; },
        setNote: n => { notes[key] = n; return range; },
        setDataValidation: () => range,
        clearContent: () => range,
        clearNote: () => range
      };
      return range;
    }
  };
  return sheet;
}

function useSheet(sheet) {
  sandbox.__setConfigSheet(sheet);
  sandbox.invalidateConfigCaches();
  sandbox.resetRationedMailState();
  sentMail.length = 0;
}

/** One message with a ledger the caller would write on a successful send. */
function sendOne(options) {
  const opts = options || {};
  const ledger = { recorded: false };
  const outcome = sandbox.sendRationedEmail({
    to: 'leader@example.org',
    subject: 'Roster changed',
    body: 'somebody registered',
    reserve: 5,
    alreadySent: opts.alreadySent,
    recordSent: () => { ledger.recorded = true; }
  });
  return { outcome, ledger };
}

// ---------------------------------------------------------------------------
// 1. FAILING OPEN. Only the literal "Yes" pauses — because the cost of a
//    switch tripped by accident is every reminder for weeks, silently.
// ---------------------------------------------------------------------------
check('the default is not paused', sandbox.DEFAULT_OUTBOUND_MAIL_PAUSED, false);

useSheet(configSheet('No'));
check('"No" sends', sendOne().outcome.status, 'sent');

useSheet(configSheet(''));
check('a blank cell sends', sendOne().outcome.status, 'sent');

useSheet(configSheet(undefined));
check('a Config tab that never had the column sends', sendOne().outcome.status, 'sent');

useSheet(configSheet('paused'));
check('a word that is not "Yes" sends', sendOne().outcome.status, 'sent');

useSheet(configSheet('Yes', { throwOnRead: true }));
check('a Config tab that cannot be read at all sends', sendOne().outcome.status, 'sent');

sandbox.__setConfigSheet(null);
sandbox.invalidateConfigCaches();
sandbox.resetRationedMailState();
sentMail.length = 0;
check('and so does a workbook with no Config tab', sendOne().outcome.status, 'sent');

// ---------------------------------------------------------------------------
// 2. PAUSED. Nothing on the wire, and the caller's ledger advances anyway —
//    that is what makes a held message dropped rather than owed.
// ---------------------------------------------------------------------------
useSheet(configSheet('Yes'));
let attempt = sendOne();
check('"Yes" holds the message', attempt.outcome.status, 'paused');
check('nothing goes on the wire', sentMail.length, 0);
check('and nothing is spent off the quota', attempt.outcome.cost, 0);
check('but the caller records it as handled — DROPPED, not owed', attempt.ledger.recorded, true);
check('and it is counted', sandbox.rationedMailPausedCount(), 1);

useSheet(configSheet('yes'));
check('the case of the word does not matter', sendOne().outcome.status, 'paused');

// A message the caller's own ledger has already accounted for is not a message
// this switch dropped, so the duplicate check still comes first.
useSheet(configSheet('Yes'));
attempt = sendOne({ alreadySent: () => true });
check('an already-sent message still reads as a duplicate', attempt.outcome.status, 'duplicate');
check('and is not counted against the pause', sandbox.rationedMailPausedCount(), 0);

// ---------------------------------------------------------------------------
// 3. THE OFFICE STILL HEARS. notifyAdmin() does not come through the rationed
//    mailer, and pausing member mail must not silence the workbook's own
//    report of what it just did.
// ---------------------------------------------------------------------------
useSheet(configSheet('Yes', { digestTo: 'office@example.org' }));
const paused = sandbox.sendRationedEmail({
  to: 'member@example.org', subject: 'Reminder', body: 'tomorrow', reserve: 0
});
check('the member is not written to', paused.status, 'paused');
// The pause writes one line into the admin digest the first time it holds a
// message, which is how "why did nobody hear from us?" stays answerable.
// notifyAdmin() reads the ticked office addresses off Config, and does not go
// through the rationed mailer at all — which is the point.
sentMail.length = 0;
check('...and the digest still goes to the office',
  sandbox.flushAdminDigest('Registration sync'), true);
check('as a real message, to the person ticked for it',
  sentMail.map(m => m.to), ['office@example.org']);
check('and it names the pause',
  sentMail[0].body.indexOf('paused') !== -1, true);

console.log(failures === 0 ? '\nAll outbound mail pause tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
