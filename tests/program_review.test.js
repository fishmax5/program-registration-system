// Every rule in this file is enforced on the way IN — when a sync runs, a box
// is ticked, a form is rebuilt. None of them is enforced on the way OUT, so
// after a season of editing nothing anywhere says which of forty programmes
// are still in the state their author believes they are in.
//
// What is pinned here is the two halves of the review that can silently be
// wrong:
//
//   THE VOCABULARY — six named kinds standing in for four checkboxes. The
//   round trip has to be exact in both directions, or the review shows people
//   a kind their programme is not.
//
//   THE INLINE PAYLOAD — the whole review travels inside the dialog's own
//   <script> block, so a programme whose title contains "</script>" would end
//   the page in the middle of a sentence and leave a dialog that does nothing.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: () => '2026-08-25 10:00', sleep: () => {}, computeDigest: () => [1],
    DigestAlgorithm: { MD5: 'MD5' }, getUuid: () => 'x' },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.resolveProgramFormType = resolveProgramFormType;
this.programFormTypeSettings = programFormTypeSettings;
this.getProgramFormType = getProgramFormType;
this.PROGRAM_FORM_TYPES = PROGRAM_FORM_TYPES;
this.buildProgramReviewHtml = buildProgramReviewHtml;
this.EVENT_TYPES = EVENT_TYPES;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}
function ok(name, cond) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}`); }
}

const T = sandbox.EVENT_TYPES;

// --- the four controls resolve to a kind ------------------------------------
const kind = state => sandbox.resolveProgramFormType(state).key;
check('nothing ticked is the ordinary monthly form',
  kind({ typeTag: T.REGULAR, isClub: false, noRegistration: false, isAssistance: false }), 'MONTHLY');
check('grouped is a series', kind({ typeTag: T.GROUPED }), 'SERIES');
check('club on a monthly form is a club', kind({ typeTag: T.REGULAR, isClub: true }), 'CLUB');
check('club on a series is a club series', kind({ typeTag: T.GROUPED, isClub: true }), 'CLUB_SERIES');
check('appointments beat grouping', kind({ typeTag: T.GROUPED, isAssistance: true }), 'APPOINTMENTS');
check('appointments beat club too', kind({ isClub: true, isAssistance: true }), 'APPOINTMENTS');
check('no registration beats everything',
  kind({ typeTag: T.GROUPED, isClub: true, isAssistance: true, noRegistration: true }), 'DROP_IN');
check('an empty state is still one of the six', kind({}), 'MONTHLY');
check('a legacy [Fixed] spelling is still a series', kind({ typeTag: 'Fixed' }), 'SERIES');

// --- and a kind resolves back to the four -----------------------------------
sandbox.PROGRAM_FORM_TYPES.forEach(type => {
  const settings = sandbox.programFormTypeSettings(type.key);
  check(`"${type.label}" round-trips`, sandbox.resolveProgramFormType(settings).key, type.key);
});
check('an unknown key is not a kind', sandbox.programFormTypeSettings('WHATEVER'), null);
check('the kinds are all distinct',
  new Set(sandbox.PROGRAM_FORM_TYPES.map(t => t.key)).size, sandbox.PROGRAM_FORM_TYPES.length);

// Every kind must set every one of the four, or applying it would leave a
// control at whatever the last kind happened to set it to.
sandbox.PROGRAM_FORM_TYPES.forEach(type => {
  const s = sandbox.programFormTypeSettings(type.key);
  ok(`"${type.label}" states all four controls`,
    s.typeTag !== undefined && typeof s.isClub === 'boolean' &&
    typeof s.noRegistration === 'boolean' && typeof s.isAssistance === 'boolean');
});

// --- THE INLINE PAYLOAD IS A LITERAL ----------------------------------------
const nasty = 'Films </script><script>alert("x")</script> & "quotes" \u2014 O\'Brien';
const review = {
  ready: true,
  summary: { total: 1, problems: 1, warnings: 0, reviewed: 0, calendarsUnread: [] },
  programmes: [{
    id: 'cal1::' + nasty, title: nasty, locations: ['Narberth'], isShared: false,
    sessionCount: 2, upcomingCount: 2, eventCount: 2, formCount: 1, formIds: ['F1'],
    firstDateLabel: 'Mon, Mar 2', lastDateLabel: 'Mon, Mar 9', nextDateKey: '2026-03-02',
    dateLabels: ['Mon, Mar 2', 'Mon, Mar 9'], moreDates: 0,
    sheetTypeKey: 'MONTHLY', sheetTypeLabel: 'Monthly sign-up',
    calendarTypeKey: 'SERIES', calendarTypeLabel: 'One form for the whole series',
    registered: 4, waitlisted: 0, capacity: 0, slotMinutes: 0, timeBlockDays: 0,
    checks: [{ level: 'problem', text: 'The sheet and the calendar disagree.', fix: 'kind' }],
    worst: 'problem', fingerprint: 'x/y/1', reviewedAt: '', reviewedBy: '', changedSinceReview: false
  }]
};

const html = sandbox.buildProgramReviewHtml(review);
const scriptBody = html.substring(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

ok('the hostile title never appears as a raw </script>', scriptBody.indexOf('</script>') === -1);
ok('it is carried as an escaped literal instead', scriptBody.indexOf('\\u003c/script') !== -1);
ok('the dialog script parses as JavaScript', (() => {
  try { new vm.Script(scriptBody); return true; } catch (e) { console.log('  ' + e.message); return false; }
})());

// The payload the browser actually evaluates must reconstruct the title byte
// for byte — an escape that mangles it is as bad as one that breaks the page.
{
  const box = { out: null };
  const ctx = vm.createContext(box);
  const assign = scriptBody.substring(scriptBody.indexOf('var REVIEW = '));
  const line = assign.substring(0, assign.indexOf('\n'));
  vm.runInContext(line + '\n out = REVIEW;', ctx);
  check('and the title survives the round trip', box.out.programmes[0].title, nasty);
}

// The six kinds travel as DATA, not as pre-built markup: stringifying
// "<option>" tags would put raw "<" into a script block for no reason at all,
// and the browser can make the same tags out of three strings.
ok('the kinds arrive as a JSON array', /var KINDS = \[\{/.test(scriptBody));
ok('no <option> tag is baked in around a label',
  sandbox.PROGRAM_FORM_TYPES.every(t => html.indexOf('<option value="' + t.key + '"') === -1));
ok('but every label is there', sandbox.PROGRAM_FORM_TYPES.every(t => html.indexOf(t.label) !== -1));

console.log(failures === 0 ? '\nAll programme review checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
