// THE DOOR APP (sections 16f and 16g) — one deployment, one link, one page.
//
// What this file pins is the handful of things that break SILENTLY on a page
// members of the public tap unsupervised:
//
//   1. THE DEFAULT PAGE IS THE APP. A bare URL has to be the door app, and the
//      two named modes have to keep working — a tablet on the wrong page is a
//      tablet nobody can tell is on the wrong page.
//   2. THE INLINED OPTIONS ARE ONE STRING LITERAL. Same hazard as every other
//      served page: a building called "St. Mary's </script>" ends the page
//      mid-sentence and the tablet goes blank with nothing in the log.
//   3. EITHER CONTACT DETAIL WILL DO. A good number of members have a phone
//      and no email at all, and refusing their sign-in is the door turning
//      away the person it exists for.
//   4. "THE REST OF THIS MONTH" STOPS AT THE END OF THE MONTH, and never
//      includes the day it was said on — that one is already being signed in.
//   5. A STANDING PLACE IS REFUSED ON AN APPOINTMENT PROGRAM, in words. One
//      person holding every slot a program will ever run is the failure.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'yyyy-MM-dd') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
          `${String(d.getDate()).padStart(2, '0')}`;
      }
      if (fmt === 'EEE, MMM d, yyyy') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
          'Nov', 'Dec'];
        return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
      }
      return '9:00 AM';
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => null, setProperty: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + ';this.HEADERS = HEADERS;', sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// ---------------------------------------------------------------------------
// 1. Which page a URL asks for.
// ---------------------------------------------------------------------------
ok('a bare URL is not the staff roster', sandbox.checkInRosterModeRequested({}) === false);
ok('?mode=session still is', sandbox.checkInRosterModeRequested({ mode: 'session' }) === true);
// The old door page is retired and ?mode=walkin is no longer a route, so an
// unchanged bookmark has to fall through to THIS app rather than to an error.
ok('a stale ?mode=walkin bookmark is not claimed by the roster',
  sandbox.checkInRosterModeRequested({ mode: 'walkin' }) === false);

// ---------------------------------------------------------------------------
// 2. The page's inlined options.
// ---------------------------------------------------------------------------
const nasty = 'St. Mary\'s </script><script>alert("x")</script>';
const page = sandbox.buildDoorAppHtml({
  location: nasty, pinRequired: true, locations: [nasty, 'Narberth'], todayKey: '2025-09-02'
});
const body = page.substring(page.indexOf('<script>'));
ok('the page has exactly one closing script tag', body.split('</script>').length - 1 === 1);
const literal = /var OPTS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/.exec(page);
ok('the options are inlined as a single string literal', !!literal);
if (literal) {
  const opts = JSON.parse(JSON.parse(literal[1]));
  ok('the hostile location survives the round trip', opts.location === nasty);
  ok('the buildings travel with the page', opts.locations.indexOf('Narberth') !== -1);
  ok('the PIN requirement travels with it', opts.pinRequired === true);
  // The tablet has no clock anybody should trust. The SERVER's date is what
  // decides whether a stored setup is stale.
  ok("and so does the server's own date", opts.todayKey === '2025-09-02');
}
const inner = page.substring(page.indexOf('<script>') + '<script>'.length, page.lastIndexOf('</script>'));
let parses = true;
try { new vm.Script(inner); } catch (err) { parses = false; }
ok('the page script parses as JavaScript', parses);
ok('the setup screen asks for a building and a day',
  /Which building\?/.test(page) && /Which day\?/.test(page));
ok('the walk-in box is on the name screen, not behind a tap of its own',
  /New here, or not registered\?/.test(page));
ok('the walk-in form asks for either contact detail',
  /An email or a phone number/.test(page));
ok('the recurring choices are offered', /rest of this month/i.test(page) && /club list/i.test(page));
ok('and the membership question is asked', /Are you a member\?/.test(page));
ok('an unregistered lunch is still never promised',
  /meals are ordered in advance/i.test(page));

// ---------------------------------------------------------------------------
// 3. A way to reach somebody — either kind.
// ---------------------------------------------------------------------------
ok('a phone number is a contact detail', sandbox.isPlausiblePhone('610-555-0134') === true);
ok('so is one typed as digits', sandbox.isPlausiblePhone('6105550134') === true);
ok('an extension number is not', sandbox.isPlausiblePhone('204') === false);
ok('nor is a blank', sandbox.isPlausiblePhone('') === false);
ok('an email alone is enough', sandbox.hasDoorContact('a@b.co', '') === true);
ok('a phone alone is enough', sandbox.hasDoorContact('', '610-555-0134') === true);
ok('neither is not', sandbox.hasDoorContact('', '') === false);
ok('and half an email is not', sandbox.hasDoorContact('joan@', '') === false);

// ---------------------------------------------------------------------------
// 4. "The rest of this month."
// ---------------------------------------------------------------------------
// Read through readDeskMonthSessions() (section 16e), which is stubbed here:
// what this pins is the MONTH BOUNDARY and the title match, not that function's
// own read, which has its own test.
sandbox.readDeskMonthSessions = () => ([
  { dateKey: '2025-09-02', monthKey: '2025-09', sessions: [
    { value: 'Chair Yoga · Tue, Sep 2, 2025', title: 'Chair Yoga' }] },
  { dateKey: '2025-09-09', monthKey: '2025-09', sessions: [
    { value: 'Chair Yoga · Tue, Sep 9, 2025', title: 'Chair Yoga' },
    { value: 'Bingo · Tue, Sep 9, 2025', title: 'Bingo' }] },
  { dateKey: '2025-09-16', monthKey: '2025-09', sessions: [
    { value: 'Chair Yoga · Tue, Sep 16, 2025', title: 'Chair Yoga' }] },
  { dateKey: '2025-10-07', monthKey: '2025-10', sessions: [
    { value: 'Chair Yoga · Tue, Oct 7, 2025', title: 'Chair Yoga' }] }
]);
const later = sandbox.doorRemainingMonthSessions('Narberth', 'Chair Yoga', '2025-09-02');
ok('the later sessions this month are found', later.length === 2);
ok('and they are in date order',
  later[0].dateKey === '2025-09-09' && later[1].dateKey === '2025-09-16');
// The day itself is already being signed in; next month is a different promise
// from the one the door made.
ok('the day itself is not one of them', later.every(s => s.dateKey !== '2025-09-02'));
ok('next month is not either', later.every(s => s.dateKey.indexOf('2025-10') !== 0));
ok('and another program on the same day is not', later.every(s => s.title === 'Chair Yoga'));
// Every write is made against a Quick Mark session choice, so the value has to
// parse back to the same title and date — a value that does not is a mark that
// lands on the wrong session, or on none.
const parsed = sandbox.parseQuickMarkProgramChoice(later[0].value);
ok('the value parses back to the same session',
  parsed.title === 'Chair Yoga' && parsed.dateKey === '2025-09-09');

// ---------------------------------------------------------------------------
// 5. The standing place itself.
// ---------------------------------------------------------------------------
const marks = [];
sandbox.applyQuickMarkFromDialog = args => {
  marks.push(args);
  return { ok: true, message: `marked ${args.session}` };
};
const monthLines = sandbox.applyDoorRecurring({
  location: 'Narberth', name: 'Joan Alvarez', dateKey: '2025-09-02', choice: 'month',
  programs: [{ value: 'Chair Yoga · Tue, Sep 2, 2025', title: 'Chair Yoga', byAppointment: false }]
});
ok('a month of sessions is registered one at a time', marks.length === 2);
ok('and registered, never marked present — being here is a fact about the day',
  marks.every(m => m.register === true && !m.attended));
ok('the receipt says how many', /2 further sessions/.test(monthLines.join(' ')));

marks.length = 0;
const clubLines = sandbox.applyDoorRecurring({
  location: 'Narberth', name: 'Joan Alvarez', dateKey: '2025-09-02', choice: 'club', lunch: true,
  programs: [{ value: 'Chair Yoga · Tue, Sep 2, 2025', title: 'Chair Yoga', byAppointment: false }]
});
ok('a club place is one write, not a loop', marks.length === 1);
ok('and it is the standing one', marks[0].standing === true && marks[0].register === true);
ok('a ticked lunch makes it a standing lunch too', marks[0].standingLunch === true);
ok('and the receipt carries what came back', clubLines.length === 1);

marks.length = 0;
const apptLines = sandbox.applyDoorRecurring({
  location: 'Narberth', name: 'Joan Alvarez', dateKey: '2025-09-02', choice: 'club',
  programs: [{ value: 'Tech Help · Tue, Sep 2, 2025', title: 'Tech Help', byAppointment: true }]
});
ok('an appointment program takes no standing place', marks.length === 0);
ok('and is refused in words rather than silently',
  /booked by appointment/i.test(apptLines.join(' ')));

marks.length = 0;
ok('"just today" writes nothing at all',
  sandbox.applyDoorRecurring({ location: 'Narberth', name: 'Joan Alvarez', choice: 'none',
    programs: [{ value: 'x', title: 'x' }] }).length === 0 && marks.length === 0);

console.log(fail ? `\n${fail} FAILURE(S)` : '\nall passed');
process.exit(fail ? 1 : 0);
