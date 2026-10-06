// WHAT IS FILLING SCRIPT PROPERTIES (section 99zd) and the cap on the store
// that filled it (the office digest spool, section 88).
//
//   THE REPORT GROUPS BY STORE: a chunked store's keys fold onto one line, a
//   versioned key keeps its _V1, and the biggest store leads.
//
//   THE SPOOL HAS A CEILING: unsent closed days past
//   OFFICE_DIGEST_MAX_SPOOL_CHARS are dropped OLDEST first, today never is,
//   and today's spool says so once.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
const pad = n => String(n).padStart(2, '0');
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      const date = new Date(d);
      if (pattern === 'yyyy-MM-dd') return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
      if (pattern === 'HH:mm') return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
      if (pattern === 'H') return '12';
      return date.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null),
      setProperty: (key, value) => { props[key] = value; },
      deleteProperty: key => { delete props[key]; },
      getKeys: () => Object.keys(props),
      getProperties: () => Object.assign({}, props)
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: null, MailApp: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.spoolOfficeNote = spoolOfficeNote;
this.readOfficeDigestDay = readOfficeDigestDay;
this.officeDigestDateKey = officeDigestDateKey_;
this.officeDigestChunkKey = officeDigestChunkKey_;
this.resetOfficeDigestSpoolCache = resetOfficeDigestSpoolCache;
this.OFFICE_DIGEST_MAX_SPOOL_CHARS = OFFICE_DIGEST_MAX_SPOOL_CHARS;
this.summarizeScriptProperties = summarizeScriptProperties;
this.describeScriptPropertiesUsage = describeScriptPropertiesUsage;
this.reportScriptPropertiesUsage = reportScriptPropertiesUsage;
this.scriptPropertyGroupOf = scriptPropertyGroupOf_;
this.log = function () {};
this.toastIfPossible = function () {};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`}`);
}

// 1. GROUPING.
check('a digest chunk folds onto its store', sandbox.scriptPropertyGroupOf('OFFICE_DIGEST_SPOOL_V1::2026-10-05::3'), 'OFFICE_DIGEST_SPOOL_V1');
check('a _n chunk folds onto its store', sandbox.scriptPropertyGroupOf('QUICK_MARK_INDEX_V2_4'), 'QUICK_MARK_INDEX_V2');
check('a versioned key keeps its version', sandbox.scriptPropertyGroupOf('FORM_REGISTRY_MAP_V1'), 'FORM_REGISTRY_MAP_V1');

const summary = sandbox.summarizeScriptProperties({
  'OFFICE_DIGEST_SPOOL_V1::2026-10-01::0': 'x'.repeat(8000),
  'OFFICE_DIGEST_SPOOL_V1::2026-10-02::0': 'x'.repeat(8000),
  FORM_REGISTRY_MAP_V1: 'y'.repeat(100),
  LAST_FORM_SYNC_TIME: '123'
});
check('the biggest store leads', summary.groups[0].group, 'OFFICE_DIGEST_SPOOL_V1');
check('...with both its keys counted', summary.groups[0].keys, 2);
check('every key is counted', summary.count, 4);
const text = sandbox.describeScriptPropertiesUsage(summary);
check('the report names the digest store', /OFFICE_DIGEST_SPOOL_V1/.test(text), true);
check('...and says what it is', /10am digest/.test(text), true);
check('an empty store is said plainly', /Nothing is stored/.test(
  sandbox.describeScriptPropertiesUsage(sandbox.summarizeScriptProperties({}))), true);
check('the menu item runs without a UI', typeof sandbox.reportScriptPropertiesUsage(), 'string');

// 2. THE SPOOL'S CEILING.
Object.keys(props).forEach(k => delete props[k]);
sandbox.resetOfficeDigestSpoolCache();
const dayKey = offset => sandbox.officeDigestDateKey(new Date(Date.now() + offset * 86400000));
const today = dayKey(0);
// Twenty closed days of 8KB each: 160KB, past the ceiling.
for (let i = 20; i >= 1; i--) {
  props[sandbox.officeDigestChunkKey(dayKey(-i), 0)] = JSON.stringify([{ s: 'S', m: 'x'.repeat(7900), n: 1, f: '09:00', l: '09:00' }]);
}
props.UNRELATED_V1 = 'keep me';
sandbox.spoolOfficeNote('Today', 'a note');
const spoolChars = Object.keys(props).filter(k => k.indexOf('OFFICE_DIGEST_SPOOL_V1::') === 0 && k.indexOf(today) === -1)
  .reduce((n, k) => n + k.length + props[k].length, 0);
check('the closed days are back under the ceiling', spoolChars <= sandbox.OFFICE_DIGEST_MAX_SPOOL_CHARS, true);
check('the oldest day went', sandbox.readOfficeDigestDay(dayKey(-20)).length, 0);
check('yesterday was kept', sandbox.readOfficeDigestDay(dayKey(-1)).length, 1);
check('nothing else was touched', props.UNRELATED_V1, 'keep me');
const todayLines = sandbox.readOfficeDigestDay(today);
check('today has the note and one line saying days were dropped', todayLines.map(e => e.s), ['Office digest', 'Today']);
// Once per execution: a second note does not re-measure.
sandbox.spoolOfficeNote('Today', 'another');
check('the drop line is not repeated', sandbox.readOfficeDigestDay(today).filter(e => e.s === 'Office digest').length, 1);

// 3. UNDER THE CEILING NOTHING IS DROPPED.
Object.keys(props).forEach(k => delete props[k]);
sandbox.resetOfficeDigestSpoolCache();
props[sandbox.officeDigestChunkKey(dayKey(-2), 0)] = JSON.stringify([{ s: 'S', m: 'small', n: 1, f: '09:00', l: '09:00' }]);
sandbox.spoolOfficeNote('Today', 'a note');
check('a small backlog is kept', sandbox.readOfficeDigestDay(dayKey(-2)).length, 1);
check('...and nothing is said about it', sandbox.readOfficeDigestDay(today).map(e => e.s), ['Today']);

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall ok');
