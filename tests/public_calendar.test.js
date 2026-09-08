// THE PUBLIC PROGRAM CALENDAR (sections 17 and 17a) — the one page here that
// a stranger opens, on a link that may be printed.
//
// What has to hold, and what each one costs when it does not:
//
//   1. NO NAMES LEAVE THE WORKBOOK. The snapshot is built from the SESSION
//      tab and carries a fixed set of fields. A page on the open internet
//      that grew a roster field would be a privacy incident, not a bug, so
//      the field list is pinned here rather than described in a comment.
//   2. THE LINK IS THE ONE IN THE FORMULA. Form_Response_Link holds a
//      =HYPERLINK() formula whose VALUE is the words "View Live Form" — a
//      read that took values would publish a calendar of cards that open
//      nothing.
//   3. A SESSION NOBODY MAY REGISTER FOR CARRIES NO LINK, and a cancelled one
//      is not on the page at all. Both are dropped SERVER-side: a filter in
//      the page's JavaScript is not a filter.
//   4. THE WINDOW IS TODAY → THE END OF NEXT MONTH, so the page's week and
//      month filters are both subsets of one payload and neither costs a
//      round trip.
//   5. THE PAGE SURVIVES AN APOSTROPHE AND A </script>. Titles are typed by
//      staff into a calendar.
//   6. ?mode=public REACHES IT, in every spelling, and is never answered by a
//      page that asks for a staff PIN — and ?span=week / ?span=month are the
//      two printable links, which only choose the filter the page opens on.
//   7. THE TIME IS THE TIME, NOT THE FORMULA THAT MAKES IT. Event_Time holds
//      an =IF(…TEXT(…)) formula and this read is formula-preserving (see 2),
//      so the label is rebuilt from the row's own start and end. A public
//      page showing a spreadsheet formula where the time should be is what
//      this pins against.
//   8. THE PAGE READS BY PROGRAM. Every session carries the programKey the
//      cards are grouped on, and a lunch-only row is called Lunch at its
//      building rather than "Lunch Only (no program)".
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
        case 'EEE MMM d': return `${DAYS[d.getDay()].slice(0, 3)} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
        case 'h:mm a': {
          const h = d.getHours() % 12 || 12;
          return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
        }
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
    createHtmlOutput: html => ({
      html, title: '', metaTags: [],
      setTitle(t) { this.title = t; return this; },
      addMetaTag(name, content) { this.metaTags.push(`${name}=${content}`); return this; }
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
// The fixture. Dates are relative to today for the reason every date-bearing
// fixture in this repo is: a hard-coded month expires.
// ---------------------------------------------------------------------------
const headers = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(headers);
const today = new Date();
const dayAt = offset => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset, 9, 30);
  return d;
};

function row(fields) {
  const out = new Array(headers.length).fill('');
  Object.keys(fields).forEach(key => { out[map[key]] = fields[key]; });
  return out;
}

const VIEW = 'https://docs.google.com/forms/d/e/PUB1/viewform';
const endAt = (offset, hour) => new Date(today.getFullYear(), today.getMonth(),
  today.getDate() + offset, hour, 30);
const rows = [
  row({
    // Event_Time as the FORMULA the session tab actually holds — this read is
    // formula-preserving, so this is what a public page was handed.
    Event_Date: dayAt(2), Location: 'Narberth', Clean_Title: "Ruth's Chair Yoga",
    Event_Time: '=IF(W9="",TEXT(A9,"h:mm AM/PM"),TEXT(A9,"h:mm AM/PM")&" – "&TEXT(W9,"h:mm AM/PM"))',
    Event_End: endAt(2, 10),
    Status: '🟢 Open', Event_ID: 'EV1',
    Form_Response_Link: `=HYPERLINK("${VIEW}","View Live Form")`,
    Max_Capacity: 20, Remaining_Seats: 12
  }),
  // The same program a week later — one card, two dates.
  row({
    Event_Date: dayAt(9), Location: 'Narberth', Clean_Title: "Ruth's Chair Yoga",
    Event_Time: '=IF(W10="",TEXT(A10,"h:mm AM/PM"),"")', Event_End: endAt(9, 10),
    Status: '🟢 Open', Event_ID: 'EV1B',
    Form_Response_Link: `=HYPERLINK("${VIEW}","View Live Form")`,
    Max_Capacity: 20, Remaining_Seats: 12
  }),
  // Two lunch-only rows at one building: one program called Lunch, not two
  // cards called "Lunch Only (no program)".
  row({
    Event_Date: dayAt(1), Location: 'Narberth', Clean_Title: '🥡 Lunch Only (no program)',
    Status: '🟢 Open', Event_ID: 'LUNCHONLY:2099-01-01|Narberth',
    Form_Response_Link: `=HYPERLINK("${VIEW}","View Live Form")`
  }),
  row({
    Event_Date: dayAt(2), Location: 'Narberth', Clean_Title: 'Lunch @ Narberth — Chx Parm',
    Status: '🟢 Open', Event_ID: 'LUNCHONLY:2099-01-02|Narberth',
    Form_Response_Link: `=HYPERLINK("${VIEW}","View Live Form")`
  }),
  // Almost full, and the seat count is the fact that changes an afternoon.
  row({
    Event_Date: dayAt(3), Location: 'Ashbridge', Clean_Title: 'Watercolor <script>alert(1)</script>',
    Event_Time: '1:00 PM', Status: '🟡 Almost Full', Event_ID: 'EV2',
    Form_Response_Link: `=HYPERLINK("${VIEW}","View Live Form")`,
    Max_Capacity: 10, Remaining_Seats: 1
  }),
  // No registration taken: on the page, but with no link behind it.
  row({
    Event_Date: dayAt(4), Location: 'Narberth', Clean_Title: 'Open Studio',
    Event_Time: '2:00 PM', Status: '🟢 Open', Event_ID: 'EV3',
    No_Registration: true, Form_Response_Link: '— no registration —'
  }),
  // Full: the form is still the way in, it just leads to a waiting list.
  row({
    Event_Date: dayAt(5), Location: 'Narberth', Clean_Title: 'Book Club',
    Event_Time: '11:00 AM', Status: '🔴 Waitlist Only', Event_ID: 'EV4', Club: true,
    Form_Response_Link: `=HYPERLINK("${VIEW}","View Live Form")`,
    Max_Capacity: 8, Remaining_Seats: 0
  }),
  // A month out, with no form generated yet — a real state, not an error.
  row({
    Event_Date: dayAt(40), Location: 'Ashbridge', Clean_Title: 'Tai Chi',
    Event_Time: '10:00 AM', Status: '🟢 Open', Event_ID: 'EV5'
  }),
  row({ Event_Date: dayAt(-3), Location: 'Narberth', Clean_Title: 'Last Week', Event_ID: 'EV6' }),
  row({ Event_Date: dayAt(400), Location: 'Narberth', Clean_Title: 'Next Year', Event_ID: 'EV7' }),
  row({
    Event_Date: dayAt(2), Location: 'Narberth', Clean_Title: 'Called Off',
    Status: 'Cancelled', Event_ID: 'EV8'
  })
];
sandbox.getSectionedRows = () => rows.map(r => r.slice());

const snap = sandbox.buildPublicProgramCalendar();
const byTitle = title => snap.sessions.filter(s => s.title === title)[0];

// ---------------------------------------------------------------------------
// 1. What may leave the workbook — the whole field list, pinned.
// ---------------------------------------------------------------------------
const ALLOWED = ['id', 'dateKey', 'weekday', 'dayLabel', 'shortLabel', 'monthLabel', 'title',
  'programKey', 'location', 'time', 'sortTime', 'lunch', 'club', 'appointment', 'url',
  'state', 'seats'];
const extra = Object.keys(snap.sessions[0]).filter(k => ALLOWED.indexOf(k) === -1);
ok('a public session carries only the agreed fields (found: ' + extra.join(', ') + ')',
  extra.length === 0);
ok('and every one of them is there', ALLOWED.every(k => k in snap.sessions[0]));
ok('nothing in the snapshot mentions a registrant',
  JSON.stringify(snap).toLowerCase().indexOf('registrant') === -1);

// ---------------------------------------------------------------------------
// 2. The link is the one inside the formula.
// ---------------------------------------------------------------------------
ok('the sign-up link is read out of the =HYPERLINK() formula',
  byTitle("Ruth's Chair Yoga").url === VIEW);
ok('and never the words the cell displays',
  snap.sessions.every(s => s.url.indexOf('View Live Form') === -1));

// ---------------------------------------------------------------------------
// 3. Which rows are on the page at all, and which carry a link.
// ---------------------------------------------------------------------------
ok('a past session is not on the page', !byTitle('Last Week'));
ok('a session past the end of next month is not on the page', !byTitle('Next Year'));
ok('a cancelled session is not on the page', !byTitle('Called Off'));
ok('a no-registration session IS on the page', !!byTitle('Open Studio'));
ok('...and carries no link', byTitle('Open Studio').url === '');
ok('...and says so', byTitle('Open Studio').state === 'none');
ok('a full session still links to its form', byTitle('Book Club').url === VIEW);
ok('...as a waiting list', byTitle('Book Club').state === 'waitlist'
  && byTitle('Book Club').seats === 'Waiting list');
ok('a session whose form is not built yet says so rather than nothing',
  byTitle('Tai Chi').state === 'soon' && byTitle('Tai Chi').url === '');
ok('an almost-full session names the number of seats',
  byTitle('Watercolor <script>alert(1)</script>').seats === '1 seat left');
ok('a session with room says so without publishing a headcount',
  byTitle("Ruth's Chair Yoga").seats === 'Seats available');
ok('the club tag reaches the page', byTitle('Book Club').club === true);

// ---------------------------------------------------------------------------
// 3a. The time is the time, and lunch is called Lunch.
// ---------------------------------------------------------------------------
ok('no session carries a spreadsheet formula where its time should be',
  snap.sessions.every(s => s.time.charAt(0) !== '='));
ok('a session with an end time reads as a range',
  byTitle("Ruth's Chair Yoga").time === '9:30 AM – 10:30 AM');
ok('a lunch-only row is called Lunch and nothing else',
  snap.sessions.filter(s => s.lunch).length === 2
  && snap.sessions.filter(s => s.lunch).every(s => s.title === 'Lunch'));
ok('lunch is contained by building, so both of its dates are one program',
  new Set(snap.sessions.filter(s => s.lunch).map(s => s.programKey)).size === 1);
ok('...and that building is on the row that says so',
  snap.sessions.filter(s => s.lunch).every(s => s.location === 'Narberth'));
ok('no session still carries the "no program" wording',
  JSON.stringify(snap).indexOf('no program') === -1);

// ---------------------------------------------------------------------------
// 3b. The grouping the page reads by.
// ---------------------------------------------------------------------------
const yoga = snap.sessions.filter(s => s.title === "Ruth's Chair Yoga");
ok('two dates of one program share one programKey',
  yoga.length === 2 && yoga[0].programKey === yoga[1].programKey);
ok('two different programs do not',
  yoga[0].programKey !== byTitle('Book Club').programKey);
ok('the same program at two buildings would be two cards',
  yoga[0].programKey.indexOf('narberth') !== -1);
ok('every session carries the short date label a chip is drawn with',
  snap.sessions.every(s => !!s.shortLabel));

// ---------------------------------------------------------------------------
// 4. The window and the ordering.
// ---------------------------------------------------------------------------
ok('the window starts today', snap.todayKey === sandbox.formatDateKey(new Date()));
ok('and ends at the end of next month',
  snap.horizonKey === sandbox.deskMonthHorizonKey(new Date()));
ok('sessions come back in date order',
  snap.sessions.every((s, i) => i === 0 || snap.sessions[i - 1].dateKey <= s.dateKey));
ok('only the buildings that have something on are offered as filters',
  JSON.stringify(snap.locations) === JSON.stringify(['Ashbridge', 'Narberth']));

// ---------------------------------------------------------------------------
// 5. The page itself.
// ---------------------------------------------------------------------------
const html = sandbox.buildPublicCalendarHtml(snap);
ok('the whole window is inlined, so the first frame needs no request',
  html.indexOf(VIEW) !== -1 && html.indexOf('Chair Yoga') !== -1);
ok('a program title cannot end the page mid-sentence',
  html.indexOf('<script>alert(1)</script>') === -1);
ok('an apostrophe survives', html.indexOf('Ruth') !== -1);
// Every script tag in the page is one this file opened: a title containing a
// closing tag would show up as an extra one.
// A title carrying a closing tag is the one that ends the page early, and the
// double-JSON escape of "</" is what stops it: the emitted page contains
// exactly ONE closing script tag, this file's own.
ok('a title cannot close the page\'s script block',
  (html.match(/<\/script>/g) || []).length === 1);
ok('no data is written into the page with innerHTML',
  html.indexOf('innerHTML') === -1);
ok('the page draws one card per program rather than one per date',
  html.indexOf('programsFrom') !== -1 && html.indexOf('programKey') !== -1);
ok('the page offers a week, a month and everything',
  html.indexOf('This week') !== -1 && html.indexOf('This month') !== -1
  && html.indexOf('Everything') !== -1);
ok('the form opens in its own tab, so the calendar is still behind it',
  html.indexOf("node.target = '_blank'") !== -1);

// The span the printed links carry reaches the page as its opening range.
// Built NOW rather than lazily: section 6 below replaces the page builder
// with a stub, and a lambda called after that would be testing the stub.
const weekHtml = sandbox.buildPublicCalendarHtml(snap, { span: 'week' });
const defaultSpanHtml = sandbox.buildPublicCalendarHtml(snap, {});

// A read that failed is a sentence, not an empty calendar.
const failedHtml = sandbox.buildPublicCalendarHtml({ ok: false, message: 'Could not look.' });
ok('a failed read is inlined as its own message',
  failedHtml.indexOf('Could not look.') !== -1);

// ---------------------------------------------------------------------------
// 6. Routing, and the gate that is deliberately absent.
// ---------------------------------------------------------------------------
sandbox.buildCancelPageHtml = () => 'PAGE:cancel';
sandbox.readyCheckInSessionIndex = () => ({ sessions: [] });
sandbox.buildCheckInHtml = () => 'PAGE:roster';
sandbox.buildDoorAppHtml = () => 'PAGE:door';
sandbox.buildPublicCalendarHtml = () => 'PAGE:public';

['public', 'calendar', 'programs', 'events', 'signup', 'sign-up', 'signups', 'PUBLIC']
  .forEach(mode => {
    ok(`?mode=${mode} opens the public calendar`,
      sandbox.doGet({ parameter: { mode } }).html === 'PAGE:public');
  });
ok('?view=calendar opens it too',
  sandbox.doGet({ parameter: { view: 'calendar' } }).html === 'PAGE:public');
ok('the door app is still what an unrecognized mode gets',
  sandbox.doGet({ parameter: { mode: 'zzz' } }).html === 'PAGE:door');
ok('the staff roster still answers ?mode=session',
  sandbox.doGet({ parameter: { mode: 'session' } }).html === 'PAGE:roster');

// The public read takes no PIN and reads no identity — the one endpoint here
// that anybody with the link may call.
ok('the public read answers without a PIN',
  sandbox.publicProgramCalendar({}).ok === true);
ok('the link the dialog prints carries the mode the router answers to',
  sandbox.checkInPageUrl({ mode: 'public' })
    === 'https://script.google.com/macros/s/ABC/exec?mode=public');

// TWO PRINTABLE LINKS, one page. The span only decides which filter is
// already pressed, and a spelling the page would ignore is never written.
ok('there is a weekly link',
  sandbox.checkInPageUrl({ mode: 'public', span: 'week' })
    === 'https://script.google.com/macros/s/ABC/exec?mode=public&span=week');
ok('and a monthly one',
  sandbox.checkInPageUrl({ mode: 'public', span: 'monthly' })
    === 'https://script.google.com/macros/s/ABC/exec?mode=public&span=month');
ok('a span nobody recognizes is left off the link rather than printed',
  sandbox.checkInPageUrl({ mode: 'public', span: 'fortnight' })
    === 'https://script.google.com/macros/s/ABC/exec?mode=public');
['week', 'weekly', '7'].forEach(span => {
  ok(`?span=${span} is read as the week`,
    sandbox.publicCalendarSpanRequested_({ span }) === 'week');
});
['month', 'monthly', '31'].forEach(span => {
  ok(`?span=${span} is read as the month`,
    sandbox.publicCalendarSpanRequested_({ span }) === 'month');
});
ok('and the page opens on the range the link asked for',
  weekHtml.indexOf('var SPAN = "week"') !== -1
  && defaultSpanHtml.indexOf('var SPAN = ""') !== -1);

console.log(fail ? `\n${fail} failed` : '\nAll public calendar checks passed');
process.exit(fail ? 1 : 0);
