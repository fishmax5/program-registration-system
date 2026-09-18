// THE VOLUNTEER'S OWN HOURS PAGE (section 99f).
//
// What is pinned here is what only a PUBLIC page has to get right, since the
// arithmetic and the row belong to 99e and are pinned there:
//
//   THE ROUTE. ?mode=volunteer (and its three other spellings) reaches this
//   page and not the door app, and the page is declared BEFORE the catch-all.
//   A link printed in an email is worth a test.
//
//   THE PIN. A wrong PIN refuses and writes nothing — this route writes to the
//   workbook, so it is gated like every other page in DOOR_ROUTES.
//
//   THE REFUSALS THIS PAGE OWNS. No name, a date in the future, a date too far
//   back, and the typo guard: "30" typed into a box labelled hours when the
//   answer was thirty minutes.
//
//   THE ATTRIBUTION. A self-logged row is signed by the volunteer, not by the
//   workbook's owner — a web app runs as the owner, and a tab full of the
//   office's address reads as the office having typed them all in.
//
//   WHAT LEAVES THE WORKBOOK. The context carries no names and no contact
//   details, and nothing from the workbook is written into the page as markup.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const iso = new Date(d.getTime()).toISOString();
      return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
    },
    sleep: () => {},
    getUuid: () => 'uuid'
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key === 'CHECK_IN_PIN' ? sandbox.__pin : null),
      setProperty: () => {},
      deleteProperty: () => {}
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'UTC',
    getEffectiveUser: () => ({ getEmail: () => 'office@example.org' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  __pin: null
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.VOLUNTEER_SELF_LOG_MODES = VOLUNTEER_SELF_LOG_MODES;
this.VOLUNTEER_SELF_LOG_MAX_HOURS = VOLUNTEER_SELF_LOG_MAX_HOURS;
this.VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS = VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS;
this.buildVolunteerSelfLogHtml = buildVolunteerSelfLogHtml;
this.volunteerSelfLogContext = volunteerSelfLogContext;
this.volunteerSelfLogNote_ = volunteerSelfLogNote_;
this.volunteerSelfLogDateRefusal_ = volunteerSelfLogDateRefusal_;
this.DOOR_ROUTES = DOOR_ROUTES;
this.doorRouteUrlMode_ = doorRouteUrlMode_;
this.formatDateKey = formatDateKey;
this.volunteerSelfLog = volunteerSelfLog;
`, sandbox, { filename: 'program.gs' });

const {
  VOLUNTEER_SELF_LOG_MODES, VOLUNTEER_SELF_LOG_MAX_HOURS, VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS,
  buildVolunteerSelfLogHtml, volunteerSelfLogContext, volunteerSelfLogNote_,
  volunteerSelfLogDateRefusal_, DOOR_ROUTES, formatDateKey
} = sandbox;

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(expected);
  if (a === b) { console.log(`ok   ${label}`); return; }
  failures++;
  console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`);
}
function checkTrue(label, got) { check(label, !!got, true); }

// --- The route ------------------------------------------------------------
function routeIdFor(params) {
  for (let i = 0; i < DOOR_ROUTES.length; i++) {
    if (DOOR_ROUTES[i].match(params)) return DOOR_ROUTES[i].id;
  }
  return null;
}
VOLUNTEER_SELF_LOG_MODES.forEach(mode => {
  check(`?mode=${mode} opens the volunteer page`, routeIdFor({ mode }), 'volunteer');
});
check('?view= is the same question', routeIdFor({ view: 'volunteer' }), 'volunteer');
// The catch-all is still the catch-all, and the staff roster still wins its own
// spelling: a route added in the middle of that table is a route that can take
// somebody else's page away.
check('a bare URL still opens the door app', routeIdFor({}), 'door');
check('?mode=session is still the staff roster', routeIdFor({ mode: 'session' }), 'session');
check('an unknown mode still falls through to the door app',
  routeIdFor({ mode: 'whatever' }), 'door');
// The link and the router cannot drift — same rule as every other page here.
check('the link builder writes the spelling the table answers to',
  sandbox.doorRouteUrlMode_('volunteer'), 'volunteer');

// --- The refusals this page owns -------------------------------------------
const today = formatDateKey(new Date());
check('today is fine', volunteerSelfLogDateRefusal_(new Date(today)), '');
const tomorrow = new Date(new Date(today).getTime() + 86400000);
checkTrue('a date in the future is refused',
  /future/.test(volunteerSelfLogDateRefusal_(tomorrow)));
const longAgo = new Date(new Date(today).getTime() -
  (VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS + 5) * 86400000);
checkTrue('a date months back is sent to the office',
  /email the office/.test(volunteerSelfLogDateRefusal_(longAgo)));
const justInside = new Date(new Date(today).getTime() -
  (VOLUNTEER_SELF_LOG_MAX_BACKDATE_DAYS - 1) * 86400000);
check('and the day inside the bound is not', volunteerSelfLogDateRefusal_(justInside), '');

// --- Attribution -----------------------------------------------------------
// The note is the receipt: a row whose Logged_By is an address nobody verified
// must say on its face that it was self-logged.
check('the note says who filed it',
  volunteerSelfLogNote_('gerry@example.net', 'phone call'),
  'Self-logged by gerry@example.net — phone call');
check('and still says so with no address and no note',
  volunteerSelfLogNote_('', ''), 'Self-logged');

// --- What leaves the workbook ----------------------------------------------
// The whole of it. A field added to this context without a line in this list
// is a field somebody has to justify.
const context = volunteerSelfLogContext({ pinRequired: true });
check('the context carries these fields and no others',
  Object.keys(context).sort(),
  ['centerName', 'locations', 'offSite', 'pinRequired', 'programs', 'roles', 'today']);
checkTrue('and no names among them',
  JSON.stringify(context).indexOf('Logged_By') === -1);

// --- The PIN --------------------------------------------------------------
// This route WRITES, so it is gated like every other page in DOOR_ROUTES. The
// refusal has to come before anything is recorded, which is why it is the
// first line of the endpoint rather than a check inside the writer.
sandbox.__pin = '4821';
const refused = sandbox.volunteerSelfLog({
  name: 'Gerry', date: today, hours: 0.5, pin: '0000'
});
check('a wrong PIN refuses and records nothing', [refused.ok, refused.needsPin], [false, true]);

// --- The page --------------------------------------------------------------
const html = buildVolunteerSelfLogHtml({
  roles: ["Bob's job"], locations: [], programs: ['</script><b>x</b>'],
  offSite: 'Off-site', today: '2026-09-16', pinRequired: false, centerName: 'NH'
});
check('nothing from the workbook is written as markup',
  html.indexOf('</script><b>x</b>'), -1);
check('but the payload still carries the value',
  JSON.parse(JSON.parse(html.match(/JSON\.parse\((".*?")\);/)[1].replace(/\\u003c/g, '<'))).programs,
  ['</script><b>x</b>']);
checkTrue('the page calls the one endpoint it has',
  html.indexOf('.volunteerSelfLog(') !== -1);
checkTrue('and the typo guard is on the input too',
  html.indexOf(`max="${VOLUNTEER_SELF_LOG_MAX_HOURS}"`) !== -1);

console.log(failures === 0 ? '\nAll volunteer self-log checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
