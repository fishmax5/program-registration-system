// Master_Program_Dashboard is one row per program-month — the unit buildEventGroups()
// already makes one FORM for, and the one thing the session table cannot show.
// Everything here is about the COLLAPSING: what becomes one row, what refuses
// to, and what a collapsed cell is allowed to claim.
//
// The rules this file holds:
//
//   1. Four sessions sharing a Form_ID are ONE row. That is the whole premise.
//   2. A blank Form_ID falls back to (title, location, month) — the
//      [No Registration] and hand-added cases, which have no form to group by.
//   3. A [Shared] program at two locations has ONE form and is ONE row, with
//      describeLocations() wording the pair.
//   4. An all-uncapped group's Fill is BLANK, never 0% — most programs here
//      are uncapped, and "0% full" about a month of open-door sessions is a
//      lie a person would act on.
//   5. Lunch collapses to one row per location per month.
//
// And, from phase 2 — the metrics block's move up here, the leader-coverage
// line it made possible, and the Sessions drill-through:
//
//   6. The Sessions cell links into the session tab at the group's OWN first
//      day row, and degrades to the plain count rather than to a wrong link.
//   7. Leader coverage counts THIS month's programs with nobody down as
//      leading them, treats a shared program as covered if either building's
//      row names a leader, leaves lunch out of it, and — the line that matters
//      — only ever counts: it shares nothing and sends nothing.
//   8. Moving the metric block onto this tab does not move a number in it. The
//      arithmetic stayed in 43_program_dashboard.gs; this asserts it.
//
// And, from phase 4 — the leader column, which is a window onto
// Program_Leaders and not a second place who-leads-what is stored:
//
//   9. The Leader cell is READ off the leader index the sharing and mail paths
//      already read: both leaders of a two-leader program, both buildings of a
//      shared one, blank for lunch and for a program nobody leads, and blank
//      when no index was handed in at all. Leader_Source says 'matched' while
//      a Title_Match proposal behind it is still unconfirmed.
//  10. Monthly carry-forward needed no code, and the test IS the mechanism:
//      leaderProgramKey() has no month in it, so October reads the same row as
//      September with nothing stored per month.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (date, tz, pattern) => {
      const p = n => String(n).padStart(2, '0');
      if (pattern === 'yyyy-MM-dd') return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
      if (pattern === 'yyyy-MM') return `${date.getFullYear()}-${p(date.getMonth() + 1)}`;
      if (pattern === 'MMM d') return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
      if (pattern === 'EEE MMM d') return `${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`;
      if (pattern === 'EEE') return DAYS[date.getDay()];
      if (pattern === 'MMMM yyyy') return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
      if (pattern === 'd') return String(date.getDate());
      if (pattern === 'h:mm a') {
        const h = date.getHours() % 12 || 12;
        return `${h}:${p(date.getMinutes())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
      }
      return date.toISOString();
    },
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: n => ({ __name: n }), getSpreadsheetTimeZone: () => 'America/New_York' }),
    WrapStrategy: { OVERFLOW: 'OVERFLOW', CLIP: 'CLIP', WRAP: 'WRAP' }
  },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.buildProgramMonthRows = buildProgramMonthRows;
this.describeProgramMonthSchedule = describeProgramMonthSchedule;
this.worstProgramMonthStatus = worstProgramMonthStatus;
this.programMonthSessionsCell = programMonthSessionsCell;
this.detectProgramMonthRecurrence = detectProgramMonthRecurrence;
this.programMonthLinkParts = programMonthLinkParts;
this.hyperlinkFormulaUrl = hyperlinkFormulaUrl;
this.NO_REGISTRATION_LINK_LABEL = NO_REGISTRATION_LINK_LABEL;
this.SHEET_NAMES = SHEET_NAMES;
this.describeProgramMonthNotify = describeProgramMonthNotify;
this.notificationProgramKey = notificationProgramKey;
this.writeNotificationTicks = writeNotificationTicks;
this.programMonthSessionRowNumbers = programMonthSessionRowNumbers;
this.programMonthLeaderCoverage = programMonthLeaderCoverage;
this.computeProgramMetrics = computeProgramMetrics;
this.scanRegistrants = scanRegistrants;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.LUNCH_ONLY_EVENT_ID_PREFIX = LUNCH_ONLY_EVENT_ID_PREFIX;
`, sandbox, { filename: 'program.gs' });

sandbox.log = () => {};
sandbox.noteForAdmin = () => {};

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const sessionHeaders = sandbox.HEADERS.All_Program_Sessions;
const sessionMap = sandbox.getIndexMap(sessionHeaders);
const monthMap = sandbox.getIndexMap(sandbox.HEADERS.Master_Program_Dashboard);

/** One session row. `at` is [year, month0, day, hour, minute]. */
function session(fields) {
  const row = new Array(sessionHeaders.length).fill('');
  const at = fields.at;
  row[sessionMap['Event_Date']] = new Date(at[0], at[1], at[2], at[3], at[4] || 0);
  row[sessionMap['Event_End']] = new Date(at[0], at[1], at[2], at[3] + (fields.hours || 2), at[4] || 0);
  row[sessionMap['Location']] = fields.location || 'Narberth';
  row[sessionMap['Clean_Title']] = fields.title || 'Chair Yoga';
  row[sessionMap['Form_ID']] = fields.formId === undefined ? 'FORM_A' : fields.formId;
  row[sessionMap['Event_ID']] = fields.eventId || `EV_${at.join('_')}_${fields.location || 'Narberth'}`;
  row[sessionMap['Active_Count']] = fields.active === undefined ? 0 : fields.active;
  row[sessionMap['Waitlist_Count']] = fields.waitlist === undefined ? 0 : fields.waitlist;
  row[sessionMap['Max_Capacity']] = fields.capacity === undefined ? '' : fields.capacity;
  row[sessionMap['Status']] = fields.status || '';
  row[sessionMap['Type_Tag']] = fields.type || 'Regular';
  if (fields.club) row[sessionMap['Club']] = true;
  if (fields.noRegistration) row[sessionMap['No_Registration']] = true;
  return row;
}

const cell = (row, header) => row[monthMap[header]];

// --- 1. Four sessions, one Form_ID, one row ---------------------------------
{
  const rows = [
    session({ at: [2026, 8, 1, 9, 30], active: 6, capacity: 12, status: '🟢 Open' }),
    session({ at: [2026, 8, 8, 9, 30], active: 9, capacity: 12, status: '🟡 Almost Full' }),
    session({ at: [2026, 8, 15, 9, 30], active: 4, capacity: 12, status: '🟢 Open' }),
    session({ at: [2026, 8, 22, 9, 30], active: 5, capacity: 12, status: '🟢 Open' })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('four sessions collapse to one row', built.rows.length, 1);
  const row = built.rows[0];
  check('Month_Start is the 1st, as a real Date',
    // Not `instanceof Date`: the value was built inside the vm context, whose
    // Date is a different constructor from this file's. What matters is that
    // the sectioned reader will see a date, which is what this asks.
    [Object.prototype.toString.call(cell(row, 'Month_Start')), cell(row, 'Month_Start').getDate(), cell(row, 'Month_Start').getMonth()],
    ['[object Date]', 1, 8]);
  check('Sessions counts the group', cell(row, 'Sessions'), '4 sessions');
  // FOUR TUESDAYS IN A ROW IS "WEEKLY", and saying so is the point: the same
  // phrase without it is equally true of a class that ran on the 1st, 8th,
  // 15th and 29th, and the difference is what somebody plans around.
  check('Schedule heads with the cadence, then the weekday and the times',
    cell(row, 'Schedule'), 'Weekly · Tue 9:30 AM – 11:30 AM · 4 sessions');
  // THE FOUR COUNTING COLUMNS AS ONE PHRASE. Nobody reads a Registered
  // without the capacity beside it, and Fill was arithmetic on those two.
  check('Seats is the whole count in one cell', cell(row, 'Seats'), '24 / 48 · 50%');
  check('Status is the group\'s worst', cell(row, 'Status'), '🟡 Almost Full');
  check('Group_Key is the form', cell(row, 'Group_Key'), 'form::FORM_A');
}

// --- 2. A blank Form_ID falls back to (title, location, month) --------------
{
  const rows = [
    session({ at: [2026, 8, 2, 10, 0], formId: '', title: 'Coffee Hour', noRegistration: true }),
    session({ at: [2026, 8, 9, 10, 0], formId: '', title: 'Coffee Hour', noRegistration: true }),
    // Same title, DIFFERENT location — a separate program-month, and the
    // fallback key is the only thing that can say so.
    session({ at: [2026, 8, 9, 10, 0], formId: '', title: 'Coffee Hour', location: 'Ashbridge' }),
    // Same title and location, NEXT month. Without the month in the key this
    // would join the September row and claim three sessions.
    session({ at: [2026, 9, 7, 10, 0], formId: '', title: 'Coffee Hour' })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('blank Form_ID groups by title, location and month', built.rows.length, 3);
  check('the fallback key says what it grouped on',
    cell(built.rows[0], 'Group_Key'), 'plain::Coffee Hour::Narberth::2026-09');
  check('the two-session fallback group counts two', cell(built.rows[0], 'Sessions'), '2 sessions');
  // THE FLAGS ARE TICK BOXES ON THIS TAB NOW, not words in a joined cell —
  // real booleans, so the cell is something a person can click.
  check('a program flag reads as a ticked box on the program-month row',
    [cell(built.rows[0], 'No_Registration'), cell(built.rows[0], 'Club')], [true, false]);
}

// --- 3. A [Shared] group across two locations is ONE row --------------------
{
  const rows = [
    session({ at: [2026, 8, 3, 13, 0], formId: 'FORM_SHARED', title: 'Book Club', location: 'Narberth', club: true }),
    session({ at: [2026, 8, 10, 13, 0], formId: 'FORM_SHARED', title: 'Book Club', location: 'Ashbridge', club: true })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('one form across two locations is one row', built.rows.length, 1);
  check('Location is worded by describeLocations()',
    cell(built.rows[0], 'Location'), 'Narberth + Ashbridge');
  check('a club reads as one ticked box', cell(built.rows[0], 'Club'), true);
}

// --- 4. An all-uncapped group's Fill is BLANK, never 0% ---------------------
{
  const rows = [
    session({ at: [2026, 8, 4, 11, 0], formId: 'FORM_U', active: 7 }),
    session({ at: [2026, 8, 11, 11, 0], formId: 'FORM_U', active: 5 })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  const row = built.rows[0];
  check('an uncapped group says "unlimited", never 0%', cell(row, 'Seats'), '12 · unlimited');
  // ...and the note still shows its working, which is where the reason lives.
  const seatNote = built.notes.filter(n => n.row === row && n.header === 'Seats')[0];
  check('the seat note says there is no percentage to give',
    !!seatNote && seatNote.text.indexOf('no percentage') > -1, true);
}

// Nobody registered and nothing capped: an empty cell, not "0 · unlimited".
{
  const row = sandbox.buildProgramMonthRows(
    [session({ at: [2026, 8, 4, 11, 0], formId: 'FORM_E' })], sessionMap).rows[0];
  check('a group nobody has signed up for has nothing to say about seats',
    cell(row, 'Seats'), '');
}

// A waitlist is part of the same sentence.
{
  const row = sandbox.buildProgramMonthRows([
    session({ at: [2026, 8, 4, 11, 0], formId: 'FORM_W', active: 12, capacity: 12, waitlist: 2 })
  ], sessionMap).rows[0];
  check('somebody queueing is said in the same cell', cell(row, 'Seats'), '12 / 12 · 100% · 2 waiting');
}

// A group where only SOME sessions have a cap takes its percentage off the
// capped ones alone — the uncapped sessions have no denominator to contribute.
{
  const rows = [
    session({ at: [2026, 8, 4, 11, 0], formId: 'FORM_M', active: 5, capacity: 10 }),
    session({ at: [2026, 8, 11, 11, 0], formId: 'FORM_M', active: 40 })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  const row = built.rows[0];
  // AND DOES NOT PRINT "45 / 10", which is a nonsense: the 45 and the 10 are
  // two different populations, so the cell says which is which.
  check('a partly-capped group takes its fill off the capped sessions',
    cell(row, 'Seats'), '45 · 10 capped seats · 50%');
  const note = built.notes.filter(n => n.row === row && n.header === 'Seats')[0];
  check('and says so, because 45 / 10 is otherwise a nonsense',
    !!note && note.text.indexOf('uncapped') > -1, true);
}

// --- 5. Lunch collapses to one row per location per month -------------------
{
  const lunch = (day, location) => session({
    at: [2026, 8, day, 12, 0],
    formId: '',
    title: `Lunch @ ${location} — Chx Parm`,
    location,
    eventId: `${sandbox.LUNCH_ONLY_EVENT_ID_PREFIX}${location}_${day}`
  });
  const rows = [];
  [1, 2, 3, 4, 7].forEach(day => rows.push(lunch(day, 'Narberth')));
  [1, 2].forEach(day => rows.push(lunch(day, 'Ashbridge')));
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('lunch is one row per location per month', built.rows.length, 2);
  check('the lunch row says where and how many days',
    [cell(built.rows[0], 'Program'), cell(built.rows[0], 'Sessions')],
    ['Lunch @ Narberth', '5 days']);
  check('the lunch row\'s schedule is its span', cell(built.rows[0], 'Schedule'), 'Sep 1–7');
  check('the second location is its own row',
    [cell(built.rows[1], 'Program'), cell(built.rows[1], 'Sessions')],
    ['Lunch @ Ashbridge', '2 days']);
}

// --- Times that do not agree say so, and name the outliers in a note --------
{
  const rows = [
    session({ at: [2026, 8, 1, 9, 30], formId: 'FORM_V' }),
    session({ at: [2026, 8, 8, 9, 30], formId: 'FORM_V' }),
    session({ at: [2026, 8, 15, 14, 0], formId: 'FORM_V' })
  ];
  const built = sandbox.buildProgramMonthRows(rows, sessionMap);
  check('a moved session makes the schedule read "times vary"',
    cell(built.rows[0], 'Schedule'), '3 sessions · times vary');
  const scheduleNote = built.notes.filter(n => n.header === 'Schedule')[0];
  check('the outlier is named in a note, on the Schedule cell',
    [!!scheduleNote, scheduleNote && scheduleNote.text.indexOf('Tue Sep 15') > -1],
    [true, true]);
}

// --- A REPEAT IS NAMED, AND SO ARE THE WEEKS IT IS MISSING ------------------
//
// "Tue 9:30 AM · 4 sessions" is true of a class that runs every Tuesday and
// equally true of one that ran on the 1st, 8th, 22nd and 29th. The difference
// is the whole of what somebody at a desk wants to know, and the second case
// is the one that gets a room booked on a day nothing happens.
{
  const weekly = [1, 8, 15, 22].map(d => session({ at: [2026, 8, d, 9, 30], formId: 'F_WK' }));
  const built = sandbox.buildProgramMonthRows(weekly, sessionMap);
  check('four Tuesdays in a row read as weekly',
    cell(built.rows[0], 'Schedule'), 'Weekly · Tue 9:30 AM – 11:30 AM · 4 sessions');
  const note = built.notes.filter(n => n.header === 'Schedule')[0];
  check('and the note lists the dates',
    [!!note, note && note.text.indexOf('Tue Sep 1') > -1, note && note.text.indexOf('Tue Sep 22') > -1],
    [true, true, true]);
}

// A GAP IS SAID IN THE CELL, not only in the note: it is the one thing about a
// repeat that "weekly" does not already imply, so a reader who never opens the
// note must still be told the run has a hole in it.
{
  const skipping = [1, 8, 22, 29].map(d => session({ at: [2026, 8, d, 9, 30], formId: 'F_SK' }));
  const built = sandbox.buildProgramMonthRows(skipping, sessionMap);
  check('a missing week is still weekly, and says a week is missing',
    cell(built.rows[0], 'Schedule'), 'Weekly · Tue 9:30 AM – 11:30 AM · 4 sessions · 1 skipped');
  const note = built.notes.filter(n => n.header === 'Schedule')[0];
  check('the note names the week with nothing on it',
    !!note && note.text.indexOf('Tue Sep 15') > -1, true);
  // AND DOES NOT CALL IT CANCELLED. The calendar has no event that week and
  // nothing here can tell a session that was called off from one that was
  // never scheduled.
  check('...without claiming to know why',
    !!note && note.text.indexOf('called off from one that was never scheduled') > -1, true);
}

// THE CADENCE IS THE SMALLEST GAP, not the commonest. A weekly class that
// misses a week has gaps [1, 2, 1]; reading that as "every 2 weeks" would be
// arithmetic winning an argument against the plain fact that it runs Tuesdays.
{
  const fortnightly = [1, 15, 29].map(d => session({ at: [2026, 8, d, 9, 30], formId: 'F_FN' }));
  check('a genuine fortnightly run is named as one',
    cell(sandbox.buildProgramMonthRows(fortnightly, sessionMap).rows[0], 'Schedule'),
    'Every 2 weeks · Tue 9:30 AM – 11:30 AM · 3 sessions');
}

// WHAT IT REFUSES TO CALL A REPEAT. A phrase like "weekly" that is only mostly
// true is worse than no phrase at all — it is the sentence somebody plans
// around — so two sessions is not a pattern, and neither is a run whose gaps
// are not whole weeks.
{
  const twice = [1, 8].map(d => session({ at: [2026, 8, d, 9, 30], formId: 'F_TW' }));
  check('two sessions a week apart are two sessions a week apart',
    cell(sandbox.buildProgramMonthRows(twice, sessionMap).rows[0], 'Schedule'),
    'Tue 9:30 AM – 11:30 AM · 2 sessions');
  const uneven = [1, 8, 11].map(d => session({ at: [2026, 8, d, 9, 30], formId: 'F_UN' }));
  check('a run with a non-weekly gap is not called weekly',
    sandbox.detectProgramMonthRecurrence(uneven.map((row, i) => ({
      row, date: row[sessionMap['Event_Date']], times: '9:30 AM – 11:30 AM'
    }))), null);
  // Times that disagree never reach the detector at all — the cell says so.
  const moved = [
    session({ at: [2026, 8, 1, 9, 30], formId: 'F_MV' }),
    session({ at: [2026, 8, 8, 9, 30], formId: 'F_MV' }),
    session({ at: [2026, 8, 15, 14, 0], formId: 'F_MV' })
  ];
  check('a moved session is not a weekly class', 
    cell(sandbox.buildProgramMonthRows(moved, sessionMap).rows[0], 'Schedule'),
    '3 sessions · times vary');
}

// --- THE THREE LINK COLUMNS AS ONE CELL -------------------------------------
//
// A cell holds one =HYPERLINK() formula, which is why three links were three
// columns three words wide that nobody ever sorted or read — only clicked. One
// cell of rich text holds a link per run.
{
  const withLinks = session({ at: [2026, 8, 1, 9, 30], formId: 'F_L' });
  withLinks[sessionMap['Form_Response_Link']] = '=HYPERLINK("https://forms.example/live","View Live Form")';
  withLinks[sessionMap['Registrant_Sheet_Link']] = 'https://docs.example/roster';
  const built = sandbox.buildProgramMonthRows([withLinks], sessionMap);
  check('the words are on the sheet, in the order they are wanted',
    cell(built.rows[0], 'Links'), 'Register · Roster');
  check('and the URLs travel beside them for the rich-text pass',
    built.links[0].parts,
    [{ label: 'Register', url: 'https://forms.example/live' },
     { label: 'Roster', url: 'https://docs.example/roster' }]);
}
// A link cell holding WORDS rather than a link keeps its words: losing them
// would turn "this program deliberately takes no registrations" into an empty
// cell, which reads as a broken one.
{
  const blocked = session({ at: [2026, 8, 1, 9, 30], formId: '', title: 'Coffee Hour' });
  blocked[sessionMap['Form_Response_Link']] = sandbox.NO_REGISTRATION_LINK_LABEL;
  const built = sandbox.buildProgramMonthRows([blocked], sessionMap);
  check('a link column holding words prints the words, unlinked',
    [cell(built.rows[0], 'Links'), built.links[0].parts[0].url],
    [sandbox.NO_REGISTRATION_LINK_LABEL, '']);
}
check('a URL is read back out of a HYPERLINK formula',
  sandbox.hyperlinkFormulaUrl('=HYPERLINK("https://x.test/a","Go")'), 'https://x.test/a');
check('...and words are not mistaken for one', sandbox.hyperlinkFormulaUrl('— no registration —'), '');

// --- ROOM AND NOTIFY, READ OFF PROGRAM_SETTINGS -----------------------------
//
// Two facts about a program that live on another tab, shown on the row that IS
// that program. READ-ONLY, both of them: Program_Settings' tick boxes are only
// honest because an unticked box means off, and a second place to tick them
// would be a second answer to "does this program email its people".
{
  const settingsHeaders = sandbox.HEADERS.Program_Settings;
  const settingsMap = sandbox.getIndexMap(settingsHeaders);
  const settingsRow = fields => {
    const row = new Array(settingsHeaders.length).fill('');
    row[settingsMap['Event']] = fields.title;
    row[settingsMap['Location']] = fields.location;
    row[settingsMap['Room_Or_Setup']] = fields.room || '';
    sandbox.writeNotificationTicks(row, settingsMap, fields.policy ||
      { invite: false, remind: false, days: [], confirmTime: false });
    return row;
  };
  const index = {};
  const put = fields => {
    index[sandbox.notificationProgramKey(fields.title, fields.location)] = settingsRow(fields);
  };
  put({ title: 'Chair Yoga', location: 'Narberth', room: 'Big room, 20 chairs',
    policy: { invite: true, remind: true, days: [7, 0], confirmTime: false } });
  put({ title: 'Quiet Hour', location: 'Narberth', room: '' });
  // One form, two buildings, two different rooms — which is exactly the thing
  // somebody setting up needs to be told.
  put({ title: 'Memory Cafe', location: 'Narberth', room: 'Lounge',
    policy: { invite: true, remind: false, days: [], confirmTime: false } });
  put({ title: 'Memory Cafe', location: 'Ashbridge', room: 'Hall B',
    policy: { invite: true, remind: false, days: [], confirmTime: false } });

  const build = rows => sandbox.buildProgramMonthRows(rows, sessionMap, null, null, index);

  const yoga = build([session({ at: [2026, 8, 1, 9, 30], title: 'Chair Yoga', formId: 'S_Y' })]);
  check('Notify is the tick boxes as one phrase, soonest last',
    cell(yoga.rows[0], 'Notify'), 'Cal · 7d · AM');
  check('Room is the standing note about where it runs',
    cell(yoga.rows[0], 'Room'), 'Big room, 20 chairs');
  const notifyNote = yoga.notes.filter(n => n.header === 'Notify')[0];
  check('and the note says where the answer is actually changed',
    !!notifyNote && notifyNote.text.indexOf(sandbox.SHEET_NAMES.PROGRAM_SETTINGS) > -1, true);

  // BLANK AND "Silent" ARE DIFFERENT ANSWERS. Blank is a program with no row
  // yet — notified the way its kind is until the next refresh writes one.
  // "Silent" is a row somebody has cleared every box on. One is a gap and one
  // is a decision, and only one of them is worth acting on.
  const quiet = build([session({ at: [2026, 8, 2, 9, 30], title: 'Quiet Hour', formId: 'S_Q' })]);
  check('a row with every box clear reads as a decision', cell(quiet.rows[0], 'Notify'), 'Silent');
  const unknown = build([session({ at: [2026, 8, 3, 9, 30], title: 'Brand New', formId: 'S_N' })]);
  check('a program with no settings row yet is blank, not Silent',
    cell(unknown.rows[0], 'Notify'), '');
  const unknownNote = unknown.notes.filter(n => n.header === 'Notify')[0];
  check('...and its note says the row has not been written yet',
    !!unknownNote && unknownNote.text.indexOf('no row for this program yet') > -1, true);

  // A shared program prints BOTH rooms and ONE notify phrase: the channels are
  // a property of the program, the room is a property of the building.
  const cafe = build([
    session({ at: [2026, 8, 4, 9, 30], title: 'Memory Cafe', formId: 'S_C', location: 'Narberth' }),
    session({ at: [2026, 8, 5, 9, 30], title: 'Memory Cafe', formId: 'S_C', location: 'Ashbridge' })
  ]);
  check('a shared program prints both rooms and one notify phrase',
    [cell(cafe.rows[0], 'Room'), cell(cafe.rows[0], 'Notify')], ['Lounge · Hall B', 'Cal']);

  // Lunch is not a program and has no settings row to look up.
  const lunchRow = build([session({
    at: [2026, 8, 7, 12, 0], formId: '', title: 'Lunch @ Narberth — Chx Parm',
    eventId: `${sandbox.LUNCH_ONLY_EVENT_ID_PREFIX}Narberth_7` })]).rows[0];
  check('lunch has neither a room nor a notify policy',
    [cell(lunchRow, 'Room'), cell(lunchRow, 'Notify')], ['', '']);

  // Handed no index at all — every other test in this file — the two columns
  // are blank rather than guessed at, and nothing is read from anywhere.
  const unlit = sandbox.buildProgramMonthRows(
    [session({ at: [2026, 8, 1, 9, 30], title: 'Chair Yoga', formId: 'S_Y' })], sessionMap).rows[0];
  check('with no settings index in hand the columns stay blank',
    [cell(unlit, 'Room'), cell(unlit, 'Notify')], ['', '']);
}

// --- A status nothing recognizes is the group's worst, not ignored ----------
{
  check('an unknown status wins',
    sandbox.worstProgramMonthStatus(
      [{ row: ['🟢 Open'] }, { row: ['⚠️ Form missing'] }], { Status: 0 }),
    '⚠️ Form missing');
}

// --- A dateless row is left on the session table ----------------------------
{
  const row = session({ at: [2026, 8, 1, 9, 30] });
  row[sessionMap['Event_Date']] = '';
  check('a row with no date contributes no month',
    sandbox.buildProgramMonthRows([row], sessionMap).rows.length, 0);
}

// --- 6. The Sessions drill-through ------------------------------------------
{
  const rows = [
    session({ at: [2026, 8, 1, 9, 30], eventId: 'EV_FIRST' }),
    session({ at: [2026, 8, 8, 9, 30], eventId: 'EV_SECOND' })
  ];
  const linked = sandbox.buildProgramMonthRows(rows, sessionMap,
    { gid: 1234, rowNumbersByEventId: { EV_FIRST: 57, EV_SECOND: 58 } });
  check('the Sessions cell links at the group\u2019s FIRST session row',
    cell(linked.rows[0], 'Sessions'), '=HYPERLINK("#gid=1234&range=A57","2 sessions")');

  // A wrong link is worse than no link: both of these degrade rather than guess.
  const unlocated = sandbox.buildProgramMonthRows(rows, sessionMap, { gid: 1234, rowNumbersByEventId: {} });
  check('and is the plain count when the row cannot be located',
    cell(unlocated.rows[0], 'Sessions'), '2 sessions');
  const noTab = sandbox.buildProgramMonthRows(rows, sessionMap, { gid: null, rowNumbersByEventId: { EV_FIRST: 57 } });
  check('or when there is no session tab to point at', cell(noTab.rows[0], 'Sessions'), '2 sessions');
  check('a build with no link target at all still writes the count',
    cell(sandbox.buildProgramMonthRows(rows, sessionMap).rows[0], 'Sessions'), '2 sessions');

  // The row numbers come off the tab itself. A duplicate Event_ID mid-repair
  // resolves to the EARLIER row, which is the one in the Upcoming block.
  const fakeSessionSheet = {
    getLastRow: () => 4,
    getRange: () => ({ getValues: () => [[''], ['EV_FIRST'], ['EV_SECOND'], ['EV_FIRST']] })
  };
  check('row numbers are read off the session tab, first occurrence winning',
    sandbox.programMonthSessionRowNumbers(fakeSessionSheet, sessionMap), { EV_FIRST: 2, EV_SECOND: 3 });
  // A tab that cannot be read costs the links, never the render.
  check('an unreadable session tab yields no links rather than throwing',
    sandbox.programMonthSessionRowNumbers({ getLastRow: () => { throw new Error('gone'); } }, sessionMap), {});
  check('and neither does no session tab at all',
    sandbox.programMonthSessionRowNumbers(null, sessionMap), {});
}

// --- 7. Leader coverage ------------------------------------------------------
{
  const now = new Date();
  const thisMonth = [now.getFullYear(), now.getMonth()];
  const monthKey = `${thisMonth[0]}-${String(thisMonth[1] + 1).padStart(2, '0')}`;

  const built = sandbox.buildProgramMonthRows([
    session({ at: [thisMonth[0], thisMonth[1], 3, 9, 30], title: 'Chair Yoga', formId: 'F_YOGA' }),
    session({ at: [thisMonth[0], thisMonth[1], 4, 9, 30], title: 'Book Club', formId: 'F_BOOK' }),
    // One form, two buildings — covered if EITHER building has a leader row.
    session({ at: [thisMonth[0], thisMonth[1], 5, 9, 30], title: 'Memory Cafe', formId: 'F_CAFE', location: 'Narberth' }),
    session({ at: [thisMonth[0], thisMonth[1], 6, 9, 30], title: 'Memory Cafe', formId: 'F_CAFE', location: 'Ashbridge' }),
    // Lunch is not a program and is not counted either way.
    session({ at: [thisMonth[0], thisMonth[1], 7, 12, 0], title: 'Lunch @ Narberth \u2014 Chx Parm',
      formId: 'F_LUNCH', eventId: `${sandbox.LUNCH_ONLY_EVENT_ID_PREFIX}x|Narberth` }),
    // Next month's row is somebody else's problem, and not this month's number.
    session({ at: [thisMonth[0], thisMonth[1] + 1, 3, 9, 30], title: 'Watercolor', formId: 'F_PAINT' })
  ], sessionMap);

  const realIndex = sandbox.buildProgramLeaderIndex;
  sandbox.buildProgramLeaderIndex = () => ({
    [sandbox.leaderProgramKey('Chair Yoga', 'Narberth')]: [{ name: 'Jane Doe' }],
    // Only the Ashbridge half of the shared program is named.
    [sandbox.leaderProgramKey('Memory Cafe', 'Ashbridge')]: [{ name: 'Sam Reed' }]
  });
  const coverage = sandbox.programMonthLeaderCoverage(built.rows, monthKey);
  sandbox.buildProgramLeaderIndex = realIndex;

  check('coverage counts this month\u2019s programs, lunch excluded', coverage.considered, 3);
  check('and names only the ones nobody is down for', coverage.missing, ['Book Club — Narberth']);

  // With no leader tab at all, every program reads unassigned — which is the
  // honest answer, and the number the tab exists to drive to zero.
  const empty = sandbox.buildProgramLeaderIndex;
  sandbox.buildProgramLeaderIndex = () => ({});
  check('an empty leader tab reports every program this month',
    sandbox.programMonthLeaderCoverage(built.rows, monthKey).missing.length, 3);
  sandbox.buildProgramLeaderIndex = empty;
}

// --- 8. The metrics did not move by a digit ----------------------------------
{
  // The same rows, the same function, the same scan — the block changed which
  // TAB it is drawn on and nothing else. Computed here the way the month tab
  // computes it on the menu path, and compared against the session-row
  // arithmetic 43_program_dashboard.gs has always done.
  const NOW = new Date(2026, 8, 16);
  const rows = [
    session({ at: [2026, 8, 18, 9, 30], eventId: 'yoga', capacity: 10 }),
    session({ at: [2026, 8, 21, 9, 30], eventId: 'taichi', capacity: 4 }),
    session({ at: [2026, 8, 17, 9, 30], eventId: 'coffee', capacity: '--' })
  ];
  const regHeaders = sandbox.HEADERS.All_Registrants;
  const regMap = sandbox.getIndexMap(regHeaders);
  const registrants = [];
  const add = (eventId, name) => {
    const row = new Array(regHeaders.length).fill('');
    row[regMap['Event_ID']] = eventId;
    row[regMap['Event_Date']] = new Date(2026, 8, 18);
    row[regMap['Name']] = name;
    row[regMap['Program_Status']] = 'Active';
    registrants.push(row);
  };
  for (let i = 0; i < 8; i++) add('yoga', `Yoga ${i}`);
  for (let i = 0; i < 5; i++) add('taichi', `Tai Chi ${i}`);
  const scan = sandbox.scanRegistrants(null, registrants);
  const metrics = sandbox.computeProgramMetrics(rows, sessionMap, scan, NOW);
  check('the near-term window still counts the same sessions', metrics.windows[0].sessions, 3);
  check('and the same registrations', metrics.windows[0].registrations, 13);
  check('and the same fill over capped sessions only', metrics.windows[0].seatsFilledPct, 93);
}

// --- 9. The leader column: a window onto Program_Leaders, not a drawer ------
//
// The rule the whole of phase 4 is built on: this cell is READ off
// Program_Leaders and never read back. What is asserted here is that reading —
// the writing half is one confirmed edit in 18_edit_handlers.gs, and the thing
// worth pinning about it is that nothing in THIS file can do it.
{
  const index = {
    [sandbox.leaderProgramKey('Chair Yoga', 'Narberth')]: [{ name: 'Jane Doe', matched: false }],
    // Two leaders, because a class with a lead and an assistant is ordinary.
    [sandbox.leaderProgramKey('Book Club', 'Narberth')]: [
      { name: 'Sam Reed', matched: false }, { name: 'Kit Alvarez', matched: false }],
    // A row a Title_Match phrase proposed and nobody has confirmed.
    [sandbox.leaderProgramKey('Watercolor', 'Narberth')]: [{ name: 'Ada Frost', matched: true }],
    // One form, two buildings — only the Ashbridge half is named.
    [sandbox.leaderProgramKey('Memory Cafe', 'Ashbridge')]: [{ name: 'Lee Park', matched: false }]
  };
  const build = rows => sandbox.buildProgramMonthRows(rows, sessionMap, null, index).rows;

  const buildAll = rows => sandbox.buildProgramMonthRows(rows, sessionMap, null, index);

  const yoga = build([session({ at: [2026, 8, 1, 9, 30], title: 'Chair Yoga', formId: 'F_Y' })])[0];
  check('the leader is read off Program_Leaders', cell(yoga, 'Leader'), 'Jane Doe');

  const book = build([session({ at: [2026, 8, 2, 9, 30], title: 'Book Club', formId: 'F_B' })])[0];
  check('a program with two leaders prints both', cell(book, 'Leader'), 'Sam Reed, Kit Alvarez');

  // LEADER_SOURCE IS NOT A COLUMN ANY MORE. An unconfirmed Title_Match
  // proposal travels beside the rows instead, which is what the yellow wash
  // and its cell note are applied from — the word 'typed' was a column spent
  // on the ordinary case, and 'matched' was already being said by the colour.
  const paintBuilt = buildAll([session({ at: [2026, 8, 3, 9, 30], title: 'Watercolor', formId: 'F_W' })]);
  const paint = paintBuilt.rows[0];
  check('an unconfirmed title match is flagged for the wash, not printed in a column',
    [cell(paint, 'Leader'), paintBuilt.matched.length, paintBuilt.matched[0] === paint],
    ['Ada Frost', 1, true]);
  check('...and a typed leader is not washed',
    buildAll([session({ at: [2026, 8, 1, 9, 30], title: 'Chair Yoga', formId: 'F_Y' })]).matched.length, 0);
  check('Leader_Source has left the layout',
    sandbox.HEADERS.Master_Program_Dashboard.indexOf('Leader_Source'), -1);

  const cafe = build([
    session({ at: [2026, 8, 4, 9, 30], title: 'Memory Cafe', formId: 'F_C', location: 'Narberth' }),
    session({ at: [2026, 8, 5, 9, 30], title: 'Memory Cafe', formId: 'F_C', location: 'Ashbridge' })
  ])[0];
  check('a shared program takes the leaders of both its buildings',
    [cell(cafe, 'Location'), cell(cafe, 'Leader')], ['Narberth + Ashbridge', 'Lee Park']);

  const nobody = build([session({ at: [2026, 8, 6, 9, 30], title: 'Tai Chi', formId: 'F_T' })])[0];
  check('a program nobody leads is blank', cell(nobody, 'Leader'), '');

  const lunchRow = build([session({
    at: [2026, 8, 7, 12, 0], formId: '', title: 'Lunch @ Narberth — Chx Parm',
    eventId: `${sandbox.LUNCH_ONLY_EVENT_ID_PREFIX}Narberth_7` })])[0];
  check('lunch has no leader row and is not made to look like it does',
    cell(lunchRow, 'Leader'), '');
  // ...and no flag boxes either: an unticked box is an answer, and there is no
  // question here to answer.
  check('and lunch carries no program flags',
    [cell(lunchRow, 'Club'), cell(lunchRow, 'Type_Tag')], ['', '']);

  // Called with no index at all — every test above this section — the columns
  // are blank rather than guessed at, and nothing is read from anywhere.
  const unlit = sandbox.buildProgramMonthRows(
    [session({ at: [2026, 8, 1, 9, 30], title: 'Chair Yoga', formId: 'F_Y' })], sessionMap).rows[0];
  check('with no leader index in hand the columns stay blank', cell(unlit, 'Leader'), '');

  // --- MONTHLY CARRY-FORWARD, WHICH NEEDED NO CODE ---------------------------
  // leaderProgramKey(title, location) has no month in it, so October's row
  // resolves to the same key as September's and prints the same name with
  // nothing stored per month and nothing carried anywhere. This test IS the
  // mechanism: if it ever fails, something has grown a month.
  const across = build([
    session({ at: [2026, 8, 1, 9, 30], title: 'Chair Yoga', formId: 'F_SEP' }),
    session({ at: [2026, 9, 6, 9, 30], title: 'Chair Yoga', formId: 'F_OCT' }),
    session({ at: [2026, 10, 3, 9, 30], title: 'Chair Yoga', formId: 'F_NOV' })
  ]);
  check('every future month of the same program carries the leader forward, unstored',
    across.map(row => `${cell(row, 'Month_Start').getMonth()}:${cell(row, 'Leader')}`),
    ['8:Jane Doe', '9:Jane Doe', '10:Jane Doe']);
}

// --- 10. What "matched" is read off -----------------------------------------
{
  check('a row still carrying the proposal stamp reads as matched',
    sandbox.isTitleMatchedLeaderRow('Matched on "chair yoga" — check this. Emails are off until you tick it.'),
    true);
  check('a row somebody typed a note on does not',
    sandbox.isTitleMatchedLeaderRow('Jane covers this while Sam is away.'), false);
  check('and neither does a blank one', sandbox.isTitleMatchedLeaderRow(''), false);
}

console.log(failures === 0 ? '\nAll program_month tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
