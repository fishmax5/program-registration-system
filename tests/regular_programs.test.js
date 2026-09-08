// THE REGULAR PROGRAMS PAGE (sections 18, 18a and 18b) — the second embed, and
// the one that answers "what runs every Thursday" instead of "what is on".
//
// What has to hold:
//
//   1. WEEKLY IS DECIDED FROM THE DATES, because nothing in this workbook
//      stores it. Same weekday, whole weeks apart, smallest gap exactly one,
//      at least three of them — a fortnightly class and a one-off are not on
//      this page, and a weekly class that misses a week still is.
//   2. TITLE + BUILDING IS THE KEY. A [Shared] program that runs on Tuesday in
//      two buildings is two things a person can go to, at two addresses.
//   3. IT PUBLISHES NOTHING THE CALENDAR PAGE DOES NOT. It is a fold of the
//      same snapshot, so the privacy line in 86 holds by construction.
//   4. ?mode=regular REACHES IT, in every spelling, and never a page that asks
//      a stranger for a staff PIN.
//   5. THE PUBLIC PAGES — AND ONLY THEY — ARE FRAMEABLE. The embed on the
//      website is an iframe; every other page here writes to the workbook.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = n => String(n).padStart(2, '0');

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      switch (fmt) {
        case 'yyyy-MM-dd': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        case 'EEE': return DAYS[d.getDay()].slice(0, 3);
        case 'EEEE, MMMM d': return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
        case 'MMMM yyyy': return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        case 'HHmm': return `${pad(d.getHours())}${pad(d.getMinutes())}`;
        default: return `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, 9:00 AM`;
      }
    },
    getUuid: () => 'x', sleep: () => {},
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key === 'CHECK_IN_WEB_APP_URL'
        ? 'https://script.google.com/macros/s/ABC/exec' : null),
      setProperty: () => {}, deleteProperty: () => {}
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSpreadsheetTimeZone: () => 'America/New_York',
      getSheetByName: name => ({ getName: () => name })
    })
  },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, LockService: {},
  HtmlService: {
    XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
    createHtmlOutput: html => ({
      html, title: '', metaTags: [], xFrame: '',
      setTitle(t) { this.title = t; return this; },
      addMetaTag(name, content) { this.metaTags.push(`${name}=${content}`); return this; },
      setXFrameOptionsMode(mode) { this.xFrame = mode; return this; }
    })
  },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {},
  // No cache in these tests: every call builds, which is what makes the
  // fixtures below the only thing deciding an answer.
  CacheService: { getScriptCache: () => { throw new Error('no cache here'); } }
};
vm.createContext(sandbox);
vm.runInContext(src + ';this.HEADERS = HEADERS;', sandbox, { filename: 'program.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// ---------------------------------------------------------------------------
// The fixture, relative to today for the reason every date-bearing fixture in
// this repo is. Offsets stay inside 28 days so the window (today → the end of
// next month) contains them whichever day of the month today happens to be.
// ---------------------------------------------------------------------------
const headers = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(headers);
const today = new Date();
const dayAt = offset => new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 9, 30);

function row(fields) {
  const out = new Array(headers.length).fill('');
  Object.keys(fields).forEach(key => { out[map[key]] = fields[key]; });
  return out;
}

const VIEW = 'https://docs.google.com/forms/d/e/PUB1/viewform';
const link = `=HYPERLINK("${VIEW}","View Live Form")`;
const rows = [];
const add = (offset, fields) => rows.push(row(Object.assign({
  Event_Date: dayAt(offset), Status: 'Open', Event_Time: '9:30 AM',
  Form_Response_Link: link, Max_Capacity: 20, Remaining_Seats: 12
}, fields)));

// Weekly, four dates, one building.
[0, 7, 14, 21].forEach((d, i) => add(d, {
  Location: 'Narberth', Clean_Title: "Ruth's Chair Yoga", Event_ID: 'YOGA' + i
}));
// Weekly, and it misses a week — still weekly (gaps 7, 14).
[1, 8, 22].forEach((d, i) => add(d, {
  Location: 'Narberth', Clean_Title: 'Watercolor', Event_ID: 'WC' + i
}));
// The same weekly program in two buildings: two programs, two addresses.
[2, 9, 16].forEach((d, i) => add(d, {
  Location: 'Ashbridge', Clean_Title: 'Shared Bingo', Event_ID: 'SBA' + i
}));
[2, 9, 16].forEach((d, i) => add(d, {
  Location: 'Narberth', Clean_Title: 'Shared Bingo', Event_ID: 'SBN' + i
}));
// Every other week — deliberately NOT on this page.
[0, 14, 28].forEach((d, i) => add(d, {
  Location: 'Ashbridge', Clean_Title: 'Every Other Week Walk', Event_ID: 'EOW' + i
}));
// Two dates only: a coincidence, not a pattern.
[4, 11].forEach((d, i) => add(d, {
  Location: 'Narberth', Clean_Title: 'Twice Only', Event_ID: 'TO' + i
}));
// Weekly, but no form generated yet — on the page, saying so.
[5, 12, 19].forEach((d, i) => rows.push(row({
  Event_Date: dayAt(d), Location: 'Ashbridge', Clean_Title: 'Tai Chi',
  Event_Time: '10:00 AM', Status: 'Open', Event_ID: 'TC' + i
})));
// Weekly, and full: the form is still the way in, as a waiting list.
[6, 13, 20].forEach((d, i) => add(d, {
  Location: 'Narberth', Clean_Title: 'Book Club', Event_ID: 'BC' + i,
  Waitlist_Only: true, Club: true, Max_Capacity: 8, Remaining_Seats: 0
}));
// Lunch runs nearly every weekday at both buildings and is pinned on the
// calendar page; it is not a thing somebody joins on Tuesdays.
[0, 7, 14].forEach((d, i) => add(d, {
  Location: 'Narberth', Clean_Title: 'Lunch @ Narberth', Event_ID: 'LUNCHONLY:N' + i
}));

sandbox.getSectionedRows = () => rows.map(r => r.slice());

const snap = sandbox.publicRegularPrograms({});
const named = title => snap.programs.filter(p => p.title === title);

// ---------------------------------------------------------------------------
// 1. What counts as regular.
// ---------------------------------------------------------------------------
ok('a weekly program is one entry, not one per date', named("Ruth's Chair Yoga").length === 1);
ok('...carrying every date in the window', named("Ruth's Chair Yoga")[0].sessions.length === 4);
ok('a weekly program that misses a week is still weekly', named('Watercolor').length === 1);
ok('every other week is not weekly', named('Every Other Week Walk').length === 0);
ok('two dates are a coincidence, not a pattern', named('Twice Only').length === 0);
ok('the same program in two buildings is two entries', named('Shared Bingo').length === 2);
ok('...at their own addresses',
  named('Shared Bingo').map(p => p.location).sort().join('|') === 'Ashbridge|Narberth');
ok('lunch is not a weekly program somebody joins',
  snap.programs.every(p => p.title.toLowerCase().indexOf('lunch') === -1));

// ---------------------------------------------------------------------------
// 2. What a program says.
// ---------------------------------------------------------------------------
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const yoga = named("Ruth's Chair Yoga")[0];
ok('a program names the weekday it runs on', WEEK.indexOf(yoga.weekday) !== -1);
ok('and every one of its dates is on that weekday',
  yoga.sessions.every(s => s.dayLabel.split(',')[0] === yoga.weekday));
ok('its dates carry the live form', yoga.sessions[0].url === VIEW);
ok('a weekly program with no form yet is still listed',
  named('Tai Chi').length === 1 && named('Tai Chi')[0].sessions[0].url === '');
ok('a full weekly program keeps its form, as a waiting list',
  named('Book Club')[0].sessions[0].state === 'waitlist');
ok('programs come back Monday-first',
  snap.programs.every((p, i) => i === 0
    || WEEK.indexOf(snap.programs[i - 1].weekday) <= WEEK.indexOf(p.weekday)));
ok('only the buildings with a weekly program are offered as filters',
  JSON.stringify(snap.locations) === JSON.stringify(['Ashbridge', 'Narberth']));
ok('nothing in the fold mentions a registrant',
  JSON.stringify(snap).toLowerCase().indexOf('registrant') === -1);

// The fold may not widen what the calendar page was allowed to publish: the
// sessions on a program are the calendar's own rows, untouched.
const ALLOWED = ['id', 'dateKey', 'weekday', 'dayLabel', 'shortLabel', 'monthLabel', 'title',
  'programKey', 'location', 'time', 'sortTime', 'lunch', 'club', 'appointment', 'url',
  'state', 'seats'];
const extra = Object.keys(yoga.sessions[0]).filter(k => ALLOWED.indexOf(k) === -1);
ok('a published session carries only the agreed fields (found: ' + extra.join(', ') + ')',
  extra.length === 0);

// ---------------------------------------------------------------------------
// 3. The page.
// ---------------------------------------------------------------------------
const html = sandbox.buildPublicRegularHtml(snap, {});
ok('the whole fold is inlined, so the first frame needs no request',
  html.indexOf(VIEW) !== -1 && html.indexOf('Chair Yoga') !== -1);
ok('the page is drawn on the shared embed stylesheet',
  html.indexOf('background: transparent') !== -1 && html.indexOf('--brand-ink') !== -1);
ok('no data is written into the page with innerHTML', html.indexOf('innerHTML') === -1);
ok('a title cannot close the page\'s script block',
  (html.match(/<\/script>/g) || []).length === 1);
const embedHtml = sandbox.buildPublicRegularHtml(snap,
  sandbox.publicCalendarViewOptions({ embed: '1', building: 'narberth' }));
ok('the embed drops the introduction, which is the host site\'s job',
  embedHtml.indexOf('id="orgName"') === -1 && html.indexOf('id="orgName"') !== -1);
ok('...and pins the building it was given, resolved to the real spelling',
  embedHtml.indexOf('\\"location\\":\\"Narberth\\"') !== -1);
ok('the embed knows to report its height', embedHtml.indexOf('postMessage') !== -1);
const failedHtml = sandbox.buildPublicRegularHtml({ ok: false, message: 'Could not look.' }, {});
ok('a failed read is inlined as its own message',
  failedHtml.indexOf('Could not look.') !== -1);

// ---------------------------------------------------------------------------
// 4. Routing, and framing.
// ---------------------------------------------------------------------------
sandbox.buildCancelPageHtml = () => 'PAGE:cancel';
sandbox.readyCheckInSessionIndex = () => ({ sessions: [] });
sandbox.buildCheckInHtml = () => 'PAGE:roster';
sandbox.buildDoorAppHtml = () => 'PAGE:door';
sandbox.buildPublicCalendarHtml = () => 'PAGE:public';
sandbox.buildPublicRegularHtml = () => 'PAGE:regular';

['regular', 'recurring', 'ongoing', 'classes', 'every-week', 'regular-programs',
  'weekly-programs', 'REGULAR'].forEach(mode => {
    ok(`?mode=${mode} opens the regular programs page`,
      sandbox.doGet({ parameter: { mode } }).html === 'PAGE:regular');
  });
ok('?view=recurring opens it too',
  sandbox.doGet({ parameter: { view: 'recurring' } }).html === 'PAGE:regular');
ok('the calendar page is still its own mode',
  sandbox.doGet({ parameter: { mode: 'public' } }).html === 'PAGE:public');
// ?span=weekly is the CALENDAR's next seven days and must stay that: one word
// meaning two things across two printed links is a link pasted wrong.
ok('?span=weekly still means the calendar\'s week, not this page',
  sandbox.doGet({ parameter: { mode: 'public', span: 'weekly' } }).html === 'PAGE:public');
ok('the door app is still what an unrecognized mode gets',
  sandbox.doGet({ parameter: { mode: 'zzz' } }).html === 'PAGE:door');
ok('the link a staff member prints carries the mode the router answers to',
  sandbox.checkInPageUrl({ mode: 'regular' })
    === 'https://script.google.com/macros/s/ABC/exec?mode=regular');
ok('...and so does a link asked for by one of the other spellings',
  sandbox.checkInPageUrl({ mode: 'recurring' })
    === 'https://script.google.com/macros/s/ABC/exec?mode=regular');
ok('the embed snippet can be written for it',
  sandbox.publicRegularEmbedSnippet({}).indexOf('mode=regular&embed=1') !== -1);

// THE EMBEDS MAY BE FRAMED; NOTHING ELSE HERE MAY BE. Both halves matter: the
// website's block is an iframe, and every other page here writes to the
// workbook.
ok('the regular programs page may be framed',
  sandbox.doGet({ parameter: { mode: 'regular' } }).xFrame === 'ALLOWALL');
ok('so may the calendar', sandbox.doGet({ parameter: { mode: 'public' } }).xFrame === 'ALLOWALL');
ok('the door app may not', !sandbox.doGet({ parameter: {} }).xFrame);
ok('the staff roster may not',
  !sandbox.doGet({ parameter: { mode: 'session' } }).xFrame);

console.log(fail ? `\n${fail} failed` : '\nAll regular program checks passed');
process.exit(fail ? 1 : 0);
