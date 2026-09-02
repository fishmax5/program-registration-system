// THE WALK-IN SIGN-IN PAGE (section 16b) — the door page the location links
// now open on, for the person who walked in without registering.
//
// What this file pins is the handful of things that break SILENTLY, which on a
// page a member of the public taps unsupervised means either a sign-in that
// records nothing or a promise of a meal that does not exist:
//
//   1. THE SESSION VALUES ARE QUICK MARK CHOICES. Every write the page makes
//      goes through applyQuickMarkFromDialog() against a "title · date" string
//      built here, so a value that does not parse back to the same title and
//      date is a mark that silently lands on the wrong session — or on none.
//   2. TODAY, AT THIS BUILDING, AND NOTHING ELSE. A page that quietly shows
//      yesterday's programs, or Ashbridge's, is a page that signs people in
//      against rows nobody will ever read.
//   3. A REGISTERED PERSON IS PRE-TICKED AND AN UNREGISTERED ONE IS NOT. That
//      distinction is the whole of what the second screen says, and lunch
//      hangs off it: a meal is ordered days ahead against a count, so an
//      unregistered lunch is a request to be checked with staff and must never
//      be presented as one that is waiting for them.
//   4. THE OPTIONS ARE AN INLINE LITERAL. Same hazard as the check-in page's
//      (check_in_page.test.js): a location name carrying the two characters
//      that end a script tag would end the page mid-sentence.
//   5. THE REFUSALS HOLD. A new member the office has no way to reach — no
//      email AND no phone — is the one thing the page turns away, because
//      being able to follow up is the entire reason it asks a stranger for
//      anything. Either detail on its own is enough.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = require('./helpers/source').readSource();

let storedPin = null;

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
      getProperty: key => (key === 'CHECK_IN_PIN' ? storedPin : null),
      setProperty: () => {},
      deleteProperty: () => {}
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
vm.runInContext(src + ';this.HEADERS = HEADERS; this.CALENDAR_MAP = CALENDAR_MAP;',
  sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// ---------------------------------------------------------------------------
// 1. Which page the URL asks for.
// ---------------------------------------------------------------------------
// The door is the DEFAULT, because the link taped to the tablet by the
// entrance is the one everybody has, and a volunteer should not have to
// choose a page before they can use one.
ok('a bare URL is the door', sandbox.checkInRosterModeRequested({}) === false);
ok('a location pin alone is still the door',
  sandbox.checkInRosterModeRequested({ location: 'Narberth' }) === false);
ok('?mode=session is the staff roster', sandbox.checkInRosterModeRequested({ mode: 'session' }) === true);
// Spelled several ways on purpose — the URL gets typed by hand onto tablets.
ok('so is ?mode=checkin', sandbox.checkInRosterModeRequested({ mode: 'checkin' }) === true);
ok('so is ?mode=check-in', sandbox.checkInRosterModeRequested({ mode: 'check-in' }) === true);
ok('and it is case-insensitive', sandbox.checkInRosterModeRequested({ mode: ' Roster ' }) === true);
ok('nonsense is the door, not an error', sandbox.checkInRosterModeRequested({ mode: 'banana' }) === false);

// ---------------------------------------------------------------------------
// 2. The URLs the dialog hands out.
// ---------------------------------------------------------------------------
let savedWebAppUrl = null;
sandbox.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: key => (key === 'CHECK_IN_PIN' ? storedPin
      : (key === 'CHECK_IN_WEB_APP_URL' ? savedWebAppUrl : null)),
    setProperty: (key, value) => { if (key === 'CHECK_IN_WEB_APP_URL') savedWebAppUrl = value; },
    deleteProperty: key => { if (key === 'CHECK_IN_WEB_APP_URL') savedWebAppUrl = null; }
  })
};

function withUrl(url, fn) {
  sandbox.ScriptApp = { getService: () => ({ getUrl: () => url }) };
  try { return fn(); } finally { sandbox.ScriptApp = {}; }
}
withUrl('https://script.google.com/macros/s/ABC/exec', () => {
  ok('a bare deployment URL is handed back as it is',
    sandbox.checkInPageUrl({}) === 'https://script.google.com/macros/s/ABC/exec');
  ok('a location pin is a query string',
    sandbox.checkInPageUrl({ location: 'Narberth' }) ===
    'https://script.google.com/macros/s/ABC/exec?location=Narberth');
  ok('the roster link carries both parameters',
    sandbox.checkInPageUrl({ location: 'Narberth', mode: 'session' }) ===
    'https://script.google.com/macros/s/ABC/exec?location=Narberth&mode=session');
  // A location with a space in it has to survive being a URL.
  ok('a location is escaped, not pasted',
    sandbox.checkInPageUrl({ location: 'St Marys' }).indexOf('location=St%20Marys') !== -1);
});
ok('an undeployed script has no link rather than a broken one',
  withUrl('', () => sandbox.checkInPageUrl({ location: 'Narberth' })) === '');
ok('and a script that throws on getUrl has none either', sandbox.checkInPageUrl({}) === '');

// ---------------------------------------------------------------------------
// 2b. The pasted deployment address — the fix for "the link is not accessible".
// ---------------------------------------------------------------------------
// getUrl() is not reliably the published address: on a bound script it
// commonly reports the editor's /dev test address, which opens for the script
// owner and refuses everybody else. So staff paste the real one, and every
// link is built from that instead.
const norm = sandbox.normalizeCheckInWebAppUrl;
ok('a published address is accepted',
  norm('https://script.google.com/macros/s/ABC/exec').url === 'https://script.google.com/macros/s/ABC/exec');
ok('and is trimmed', norm('  https://script.google.com/macros/s/ABC/exec  ').ok === true);
// What actually gets pasted is very often a link that has been opened once,
// and building "?location=X" onto that would give the parameter twice.
ok('a query string is cut off, not kept',
  norm('https://script.google.com/macros/s/ABC/exec?location=Narberth').url ===
  'https://script.google.com/macros/s/ABC/exec');
ok('and so is a fragment',
  norm('https://script.google.com/macros/s/ABC/exec#top').url ===
  'https://script.google.com/macros/s/ABC/exec');
// THE ONE THIS BOX EXISTS FOR. Saving a /dev address would be the dialog
// carefully recording the exact mistake it is there to prevent.
const dev = norm('https://script.google.com/macros/s/ABC/dev');
ok('the test address is refused', dev.ok === false && dev.url === '');
ok('and the refusal names the error a tablet shows',
  /unable to open the file at this time/i.test(dev.message));
ok('an address that ends in neither is refused',
  norm('https://script.google.com/macros/s/ABC/').ok === false);
ok('and so is something that is not a URL at all', norm('paste it here').ok === false);
ok('a blank is not a refusal — it clears the setting', norm('   ').ok === true);

// Saved, and then used by every link.
savedWebAppUrl = null;
const savedRes = sandbox.setCheckInWebAppUrl('https://script.google.com/macros/s/REAL/exec');
ok('saving stores the address', savedRes.ok === true && savedWebAppUrl === 'https://script.google.com/macros/s/REAL/exec');
ok('a refused address is not stored',
  sandbox.setCheckInWebAppUrl('https://script.google.com/macros/s/OTHER/dev').ok === false &&
  savedWebAppUrl === 'https://script.google.com/macros/s/REAL/exec');
// THE WHOLE POINT: the saved one beats whatever getUrl() claims.
ok('the saved address wins over the one the script reports',
  withUrl('https://script.google.com/macros/s/WRONG/dev',
    () => sandbox.checkInPageUrl({ location: 'Narberth' })) ===
  'https://script.google.com/macros/s/REAL/exec?location=Narberth');
const savedInfo = withUrl('https://script.google.com/macros/s/WRONG/dev', () => sandbox.readCheckInPageInfo());
ok('and the dialog says the links came from it', savedInfo.fromSaved === true);
ok('and stops warning about a /dev address it is no longer using', savedInfo.isDev === false);
ok('while still reporting what the script claims, for comparison',
  savedInfo.scriptUrl === 'https://script.google.com/macros/s/WRONG/dev');
// ---------------------------------------------------------------------------
// 2c. THE /a/<domain>/ SPELLING — one deployment, two addresses, one of which
//     dead-ends at the door.
// ---------------------------------------------------------------------------
// Reported as: the address in the Deploy screen opens, every link off the menu
// answers "Sorry, unable to open the file at this time". Same workbook. The
// menu's links came from getUrl(), which on a Workspace script returns the
// domain-scoped spelling — it resolves against a signed-in account in that
// domain, which a tablet does not have.
const strip = sandbox.stripWebAppDomainSegment;
ok('the /a/<domain>/ segment comes off',
  strip('https://script.google.com/a/newhorizonsseniorcenter.org/macros/s/AKfy123/exec') ===
  'https://script.google.com/macros/s/AKfy123/exec');
// THE SECOND SPELLING, and the one a Workspace deployment hands out today:
// the domain sits INSIDE /macros/ rather than before it. It was not
// recognised, so it survived every tidy-up untouched — the menu published a
// domain-scoped link and a tablet outside the domain got "unable to open the
// file at this time" from an address that looked exactly like the one in the
// Deploy screen, because it was.
ok('the /a/macros/<domain>/ spelling comes off too',
  strip('https://script.google.com/a/macros/newhorizonsseniorcenter.org/s/AKfy123/exec') ===
  'https://script.google.com/macros/s/AKfy123/exec');
ok('and it is normalized when pasted, not stored as it was typed',
  norm('https://script.google.com/a/macros/newhorizonsseniorcenter.org/s/AKfy123/exec').url ===
  'https://script.google.com/macros/s/AKfy123/exec');
ok('a plain address is untouched',
  strip('https://script.google.com/macros/s/AKfy123/exec') ===
  'https://script.google.com/macros/s/AKfy123/exec');
// Only that one segment, and only in that one position: a domain appearing
// anywhere else in the address is part of the address.
ok('a deployment id containing "/a/"-looking text is left alone',
  strip('https://script.google.com/macros/s/AKfy_a_123/exec') ===
  'https://script.google.com/macros/s/AKfy_a_123/exec');
ok('something that is not a web app address is untouched',
  strip('https://example.com/a/x/macros/s/ABC/exec') === 'https://example.com/a/x/macros/s/ABC/exec');
ok('and a blank stays blank', strip('') === '');

// It is stripped where the address is READ...
savedWebAppUrl = null;
ok('the address the script reports is stripped before any link is built from it',
  withUrl('https://script.google.com/a/newhorizonsseniorcenter.org/macros/s/AKfy123/exec',
    () => sandbox.checkInPageUrl({ location: 'Ashbridge', mode: 'session' })) ===
  'https://script.google.com/macros/s/AKfy123/exec?location=Ashbridge&mode=session');
// ...and where one is PASTED, since a signed-in staff member copying out of
// their own browser bar copies exactly the spelling that fails.
ok('a pasted /a/<domain>/ address is saved in the form that opens for everyone',
  norm('https://script.google.com/a/newhorizonsseniorcenter.org/macros/s/AKfy123/exec').url ===
  'https://script.google.com/macros/s/AKfy123/exec');

// The two spellings are the same DEPLOYMENT, so pasting one is not a conflict
// with the other — but two different ids are, and the dialog says so.
const D = sandbox.webAppDeploymentId;
ok('the deployment id reads through every spelling',
  D('https://script.google.com/a/x.org/macros/s/AKfy123/exec') === 'AKfy123' &&
  D('https://script.google.com/a/macros/x.org/s/AKfy123/exec') === 'AKfy123' &&
  D('https://script.google.com/macros/s/AKfy123/exec') === 'AKfy123');
// Reading it out of only one spelling is how the dialog came to announce two
// deployments where there is one: the unread spelling compared as "no
// deployment at all".
ok('so two spellings of one deployment agree',
  D('https://script.google.com/a/macros/x.org/s/AKfy123/exec') ===
  D('https://script.google.com/macros/s/AKfy123/exec'));
ok('and is empty for an address that names no deployment', D('https://example.com/') === '');

savedWebAppUrl = null;
sandbox.setCheckInWebAppUrl('https://script.google.com/a/x.org/macros/s/AKfy123/exec');
const sameInfo = withUrl('https://script.google.com/a/x.org/macros/s/AKfy123/exec',
  () => sandbox.readCheckInPageInfo());
ok('two spellings of one deployment are not reported as two deployments', sameInfo.mismatch === false);
const twoInfo = withUrl('https://script.google.com/a/x.org/macros/s/AKfyOTHER/exec',
  () => sandbox.readCheckInPageInfo());
ok('two different ids are', twoInfo.mismatch === true);
ok('and the dialog says so above the links',
  /Two deployments/.test(sandbox.buildCheckInPageHtml(twoInfo)));
savedWebAppUrl = 'https://script.google.com/macros/s/REAL/exec';

const clearedRes = sandbox.setCheckInWebAppUrl('');
ok('a blank clears it', clearedRes.ok === true && savedWebAppUrl === null);
ok('and the script-reported address is warned about again',
  withUrl('https://script.google.com/macros/s/WRONG/dev', () => sandbox.readCheckInPageInfo()).isDev === true);

// ---------------------------------------------------------------------------
// 3. The page's inlined options.
// ---------------------------------------------------------------------------
const nastyLocation = 'St. Mary\'s </script><script>alert("x")</script>';
const page = sandbox.buildWalkInHtml({
  location: nastyLocation, pinRequired: true, locations: [nastyLocation, 'Narberth'],
  rosterUrl: 'https://x/exec?location=Narberth&mode=session'
});
const body = page.substring(page.indexOf('<script>'));
ok('the page has exactly one closing script tag', body.split('</script>').length - 1 === 1);
const literal = /var OPTS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/.exec(page);
ok('the options are inlined as a single string literal', !!literal);
if (literal) {
  const opts = JSON.parse(JSON.parse(literal[1]));
  ok('the hostile location survives the round trip', opts.location === nastyLocation);
  ok('the locations travel with the page', opts.locations.indexOf('Narberth') !== -1);
  ok('the PIN requirement travels with it', opts.pinRequired === true);
  ok('and so does the way back to the staff roster', /mode=session/.test(opts.rosterUrl));
}
// The page's own script has to be JavaScript — a template-literal escape that
// went wrong is otherwise a blank tablet with nothing in the log.
const inner = page.substring(page.indexOf('<script>') + '<script>'.length, page.lastIndexOf('</script>'));
let parses = true;
try { new vm.Script(inner); } catch (err) { parses = false; }
ok('the page script parses as JavaScript', parses);
// The sentence the whole lunch section exists for.
ok('the page warns that an unregistered lunch is not a promised meal',
  /check with a staff member that one is available/i.test(page));
// The tick IS the handover now, on both sides of the registered/not line —
// the door is where the food is collected, so a meal ticked here is marked
// served (Lunch_Served), and the page has to say that before it is ticked.
ok('and says a tick records the meal as taken',
  /recorded as taking a meal/i.test(page) && /records it as handed to you/i.test(page));
ok('and offers the way out of a mistaken tick',
  /leave it unticked if you are not taking it today/i.test(page));

// ---------------------------------------------------------------------------
// 4. The day, read off stub tabs.
// ---------------------------------------------------------------------------
const DASH_HEADERS = ['Event_Date', 'Location', 'Clean_Title', 'Event_Time',
  'Personalized_Assistance', 'No_Registration', 'Event_ID'];
const REG_HEADERS = ['Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended',
  'Lunch_Served', 'Lunch_Status', 'Phone', 'Event_ID'];
const ROLL_HEADERS = ['Name', 'Phone', 'Email', 'Times_Seen', 'First_Seen', 'Last_Seen',
  'Locations', 'Usual_Lunch', 'Usual_Guests', 'Dietary_Notes', 'Contact', 'Staff_Notes'];

// A sheet the way the readers expect one: a grid, read whole or in ranges.
function gridSheet(name, values) {
  return {
    getName: () => name,
    getLastRow: () => values.length,
    getLastColumn: () => (values[0] || []).length,
    getMaxRows: () => values.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || (values[0] || []).length))),
      getValue: () => values[row - 1][col - 1],
      getDisplayValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || (values[0] || []).length)).map(String))
    })
  };
}

const realHeaders = {
  dash: sandbox.HEADERS.Master_Program_Dashboard,
  reg: sandbox.HEADERS.Registrant_Dash,
  roll: sandbox.HEADERS.Member_Roll
};
const realMeal = sandbox.getMealInfoForDate;

function withWorkbook(parts, fn) {
  sandbox.HEADERS.Master_Program_Dashboard = DASH_HEADERS;
  sandbox.HEADERS.Registrant_Dash = REG_HEADERS;
  sandbox.HEADERS.Member_Roll = ROLL_HEADERS;
  // The menu is stubbed rather than a fourth sheet: what readWalkInDay() does
  // with a meal is all this file is about, and Lunch_Schedule's own reader has
  // its tests elsewhere.
  sandbox.getMealInfoForDate = (date, loc) => (parts.meal === undefined ? null : parts.meal);
  const sheets = {
    Master_Program_Dashboard: gridSheet('Master_Program_Dashboard',
      [DASH_HEADERS].concat(parts.dash || [])),
    Registrant_Dash: gridSheet('Registrant_Dash', [REG_HEADERS].concat(parts.reg || [])),
    Member_Roll: parts.roll
      ? gridSheet('Member_Roll', [['👤 Member Roll'], ROLL_HEADERS].concat(parts.roll))
      : null
  };
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({
    getSheetByName: n => sheets[n] || null
  });
  try { return fn(); } finally {
    sandbox.HEADERS.Master_Program_Dashboard = realHeaders.dash;
    sandbox.HEADERS.Registrant_Dash = realHeaders.reg;
    sandbox.HEADERS.Member_Roll = realHeaders.roll;
    sandbox.getMealInfoForDate = realMeal;
    sandbox.SpreadsheetApp.getActiveSpreadsheet = () => null;
  }
}

const TODAY = '2026-09-16';
const YESTERDAY = '2026-09-15';
const d = key => new Date(key + 'T10:00:00');

const dashRows = [
  [d(TODAY), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', false, false, 'evt1'],
  [new Date(TODAY + 'T13:00:00'), 'Narberth', 'Bingo', '1:00 PM – 3:00 PM', false, false, 'evt2'],
  // Offered, never bookable from a door — a chair at a time.
  [new Date(TODAY + 'T09:00:00'), 'Narberth', 'Computer Help', '9:00 AM – 12:00 PM', true, false, 'evt3'],
  // The three that must not appear: another day, another building, and the
  // day's lunch, which has its own line at the bottom of the page.
  [d(YESTERDAY), 'Narberth', 'Watercolors', '10:00 AM', false, false, 'evt4'],
  [d(TODAY), 'Ashbridge', 'Tai Chi', '10:00 AM', false, false, 'evt5'],
  [d(TODAY), 'Narberth', 'Lunch @ Narberth — Chx Parm', '', false, false, 'LUNCHONLY:' + TODAY + '|Narberth']
];

const regRows = [
  [d(TODAY), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Ruth Klein', true, false, 'Needed', '610-555-0100', 'evt1'],
  [d(TODAY), 'Narberth', 'Bingo', '1:00 PM – 3:00 PM', 'Al Morris', false, false, 'No Lunch', '', 'evt2'],
  [d(TODAY), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Al Morris', false, false, 'No Lunch', '', 'evt1'],
  // Lunch and nothing else — a real registration, and not a program.
  [d(TODAY), 'Narberth', 'Lunch @ Narberth — Chx Parm', '', 'Bea Stone', false, false, 'Needed', '', 'LUNCHONLY:' + TODAY + '|Narberth'],
  // Yesterday, and another building: neither is today's door.
  [d(YESTERDAY), 'Narberth', 'Watercolors', '10:00 AM', 'Sam Older', false, false, 'No Lunch', '', 'evt4'],
  [d(TODAY), 'Ashbridge', 'Tai Chi', '10:00 AM', 'Elsewhere Person', false, false, 'No Lunch', '', 'evt5']
];

const day = withWorkbook({
  dash: dashRows, reg: regRows,
  meal: { type: 'Hot', description: 'Chicken Parmesan', shorthand: 'Chx Parm' },
  roll: [['Ruth Klein'], ['Bea Stone'], ['Never Registered']]
}, () => sandbox.readWalkInDay('Narberth', TODAY));

const titles = day.programs.map(p => p.title);
ok('today\'s programs are listed', titles.indexOf('Chair Yoga') !== -1 && titles.indexOf('Bingo') !== -1);
ok('in the order the day runs', titles.indexOf('Computer Help') === 0);
ok('yesterday is not today', titles.indexOf('Watercolors') === -1);
ok('and neither is the other building', titles.indexOf('Tai Chi') === -1);
ok('the lunch is not one of the programs',
  titles.filter(t => /^Lunch @/.test(t)).length === 0);
ok('an appointment program is shown, and marked as one',
  day.programs.filter(p => p.title === 'Computer Help')[0].byAppointment === true);
ok('an ordinary one is not', day.programs.filter(p => p.title === 'Bingo')[0].byAppointment === false);

// THE CONTRACT WITH QUICK MARK: every value the page sends back has to parse
// into the session it names, or the mark lands somewhere else entirely.
const yoga = day.programs.filter(p => p.title === 'Chair Yoga')[0];
const parsed = sandbox.parseQuickMarkProgramChoice(yoga.value);
ok('a program value parses back to its own title', parsed.title === 'Chair Yoga');
ok('and to today\'s date', parsed.dateKey === TODAY);
const parsedLunch = sandbox.parseQuickMarkProgramChoice(day.lunch.value);
ok('the lunch value parses back as a lunch', parsedLunch.lunchOnly === true);
ok('and to today', parsedLunch.dateKey === TODAY);

// The people, and what each of them is already down for.
const names = day.people.map(p => p.name);
ok('everybody registered here today is a card', names.length === 3);
ok('and they are alphabetical', names.join('|') === 'Al Morris|Bea Stone|Ruth Klein');
ok('somebody registered at another location is not', names.indexOf('Elsewhere Person') === -1);
ok('nor is yesterday\'s registrant', names.indexOf('Sam Older') === -1);

const ruth = day.people.filter(p => p.name === 'Ruth Klein')[0];
ok('a registration pre-ticks its own session', ruth.registered.indexOf(yoga.value) !== -1);
ok('an attendance already marked shows as signed in', ruth.here === true);
ok('and the ticked session is the one recorded', ruth.attended.indexOf(yoga.value) !== -1);
ok('a meal already ordered is known', ruth.lunchRegistered === true);
ok('and the phone comes with her', ruth.phone === '610-555-0100');

const al = day.people.filter(p => p.name === 'Al Morris')[0];
ok('two registrations are two ticks, not two people', al.registered.length === 2);
ok('and nothing is ticked that was not marked', al.attended.length === 0);
ok('somebody with no meal ordered is not shown one', al.lunchRegistered === false);

const bea = day.people.filter(p => p.name === 'Bea Stone')[0];
ok('a lunch-only registration is a person on the list', !!bea);
ok('with a meal ordered', bea.lunchRegistered === true);
ok('and no program ticked, because a meal is not one', bea.registered.length === 0);
// Her meal sits on a row of its OWN, which is what the sign-in marks her
// present against — otherwise a visit that is only lunch records nothing.
ok('a lunch-only registration is known to be one', bea.lunchOnly === true);
ok('while a meal ridden on a program registration is not', ruth.lunchOnly === false);
// WHICH ROW ORDERED THE FOOD. The handover is marked on that row and not on
// whichever program sorted first: Al holds two rows today and neither of them
// is a meal, and marking a served lunch on a row that ordered none is a meal
// the day cannot account for.
ok('the row carrying the meal is named', bea.lunchOn === day.lunch.value);
ok('and for a meal ridden on a program, it is that program\'s row',
  ruth.lunchOn === yoga.value);
ok('somebody with no meal has no row carrying one', al.lunchOn === '');

// ---------------------------------------------------------------------------
// 4b. The live session list — the fallback that stops the staff page being
//     blank on a workbook that has never synced.
// ---------------------------------------------------------------------------
// The stored Quick Mark lists only exist once something has built them, and a
// page reading "the lists have not been built yet" is indistinguishable, from
// a tablet, from a page that does not work.
const live = withWorkbook({ dash: dashRows, reg: regRows }, () => sandbox.buildLiveCheckInSessionIndex());
ok('the live list says it is live', live.live === true);
ok('and how far ahead it looked', live.liveDays === 14);
ok('and carries no names, because the roster is read per session',
  JSON.stringify(live.namesBySession) === '{}');
// The stub rows are dated 2026 and the clock is real, so what this pins is the
// WINDOW, not the contents: a session outside it is never listed.
ok('sessions outside the next fortnight are not listed',
  live.sessions.every(entry => entry.dateKey >= sandbox.formatDateKey(new Date())));
ok('every entry parses back to its own session',
  live.sessions.every(entry => sandbox.parseQuickMarkProgramChoice(entry.value).title === entry.title));
// And an empty workbook is an empty list rather than a throw.
const liveEmpty = withWorkbook({ dash: [], reg: [] }, () => sandbox.buildLiveCheckInSessionIndex());
ok('a workbook with no session table has no live sessions', liveEmpty.sessions.length === 0);
ok('and is still a well-formed index', liveEmpty.live === true && !!liveEmpty.builtAt);

ok('the day names its own date', day.dateKey === TODAY);
ok('and says which building it is', day.location === 'Narberth');
ok('the dish reaches the page', day.lunch.dish === 'Chx Parm');
ok('and so does the kind of meal it is', day.lunch.type === 'Hot');
ok('lunch is offered at an always-catering location', day.lunch.offered === true);
ok('and is not ruled out', day.lunch.ruledOut === false);
ok('the member roll travels for the search box', day.members.length === 3);
ok('including somebody who has never registered for anything',
  day.members.filter(m => m.name === 'Never Registered').length === 1);

// A location that never caters cannot be signed up for a meal, whatever the
// menu says — that is the difference between "not planned" and "not served".
const zoomDay = withWorkbook({ dash: [], reg: [], meal: null },
  () => sandbox.readWalkInDay('Zoom', TODAY));
ok('a never-catering location offers no lunch', zoomDay.lunch.offered === false);
ok('and says it is ruled out rather than merely unplanned', zoomDay.lunch.ruledOut === true);

// A day the kitchen has shut is a DECISION, and reads differently from a gap.
const shutDay = withWorkbook({ dash: [], reg: [], meal: { type: 'Not Serving', description: '', shorthand: '' } },
  () => sandbox.readWalkInDay('Narberth', TODAY));
ok('a Not Serving day offers no lunch', shutDay.lunch.offered === false);
ok('and is ruled out, not merely unplanned', shutDay.lunch.ruledOut === true);

// An empty workbook is a page that says so, not a throw.
const emptyDay = withWorkbook({ dash: [], reg: [] }, () => sandbox.readWalkInDay('Narberth', TODAY));
ok('a day with nothing on it has no programs', emptyDay.programs.length === 0);
ok('and nobody expected', emptyDay.people.length === 0);

// ---------------------------------------------------------------------------
// 5. The refusals — everything that must not be written.
// ---------------------------------------------------------------------------
const sign = args => sandbox.walkInSignIn(JSON.stringify(args));

ok('no location is a refusal',
  sign({ name: 'Ruth Klein', programs: ['x'] }).ok === false);
ok('a location this workbook does not have is a refusal',
  sign({ location: 'Nowhere', name: 'Ruth Klein', programs: ['x'] }).ok === false);
ok('no name is a refusal',
  sign({ location: 'Narberth', programs: ['x'] }).ok === false);
const nothing = sign({ location: 'Narberth', name: 'Ruth Klein', programs: [], lunch: false });
ok('ticking nothing at all is a refusal', nothing.ok === false);
ok('and says what to do about it', /Tick what you are here for/.test(nothing.message));

// THE ONE THING A STRANGER IS TURNED AWAY FOR. Some way to reach them is the
// entire reason the page asks a new member for anything, so a row with neither
// an email nor a phone number on it is a person the office has quietly lost.
// EITHER will do: plenty of members have a phone and no address at all.
const noContact = sign({
  location: 'Narberth', name: 'New Person', newMember: true, email: '', phone: '', programs: ['x']
});
ok('a new member with no way to reach them is refused', noContact.ok === false);
ok('and told why', /membership form/.test(noContact.message));
ok('a new member with junk for an email and no phone is refused too',
  sign({ location: 'Narberth', name: 'New Person', newMember: true, email: 'not-an-email',
    programs: ['x'] }).ok === false);
ok('and an extension number is not a phone number either',
  sign({ location: 'Narberth', name: 'New Person', newMember: true, phone: '204',
    programs: ['x'] }).ok === false);
// That a phone number ALONE gets past this refusal is the whole point of it
// being either, and is pinned next door (door_app.test.js) on hasDoorContact()
// rather than here: getting past it means reaching the write path, and the
// write path is a lock and a sheet this file does not stand up.

// The PIN gate covers both of the page's calls, exactly as it covers the
// roster's — a gate on one door and not the other is not a gate.
storedPin = '4821';
ok('a wrong PIN refuses the day', sandbox.walkInDay(JSON.stringify({ location: 'Narberth', pin: 'no' })).needsPin === true);
ok('and refuses the sign-in', sign({ location: 'Narberth', name: 'Ruth', programs: ['x'], pin: 'no' }).needsPin === true);
storedPin = null;

// ---------------------------------------------------------------------------
// 6. The menu dialog's links, which were printed as plain text.
// ---------------------------------------------------------------------------
// A monospace URL in a dialog LOOKS like a link and does nothing when it is
// tapped — the reported "the links in the menu don't work". Every address the
// dialog offers has to be an anchor, and a dialog is an iframe, so it has to
// open outside itself or it tries to render the page inside a 520px box.
const dialog = sandbox.buildCheckInPageHtml({
  url: 'https://script.google.com/macros/s/ABC/exec',
  isDev: false, locations: ['Narberth', 'Ashbridge'], pinSet: false
});
ok('the dialog builds its links as anchors', /<a href="' \+ esc\(url\) \+ '" target="_blank"/.test(dialog));
ok('and offers a copy button beside each one', /function copyLink\(/.test(dialog));
ok('with a fallback for browsers with no clipboard API', /execCommand\('copy'\)/.test(dialog));
// ONE LINK FOR EVERY DOOR now — the app asks each tablet which building it is
// standing at, so there is no per-location address to get wrong (section 16e).
ok('the sign-in app is offered as one link', /The sign-in app \(every door\)/.test(dialog));
ok('and it is the bare deployment address, with nothing pinned onto it',
  /linkRow\('The sign-in app \(every door\)', INFO\.url,/.test(dialog) ||
  /'The sign-in app \(every door\)'[\s\S]{0,40}INFO\.url/.test(dialog));
ok('and the staff roster is offered beside it, with its mode',
  /mode=session/.test(dialog) && /check-in list \(staff\)/.test(dialog));
// The test address is not a link you can hand out, but it IS one the script's
// owner opens — so it is clickable too, under the warning that explains it.
const devDialog = sandbox.buildCheckInPageHtml({
  url: 'https://script.google.com/macros/s/ABC/dev', isDev: true, locations: ['Narberth'], pinSet: false
});
ok('the test address is still warned about', /not a published one/.test(devDialog));
ok('and is itself an anchor', /Test address \(you only\)/.test(devDialog) && /target="_blank"/.test(devDialog));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
