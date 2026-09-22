// TWO ROWS, ONE SESSION — the collapse (26_event_descriptions.gs) and the
// sweep for the rows written before it existed (99l_duplicate_session_rows.gs).
//
// An Event_ID is `calendarId | cleanTitle | dateKey` and everything downstream
// treats it as the identity of a session, so two rows carrying one Event_ID is
// never "two sittings" — it is one session on the tab twice, with the second
// row's counts permanently stale. The properties pinned here are the ones that
// decide whether the two halves are safe:
//
//   • collapseSessionsByEventId_() keeps the EARLIEST event and invents
//     nothing from the others — in particular it does not widen the span,
//     which for an appointment program would manufacture slots over a lunch
//     break. It does OR the [Waitlist Only] tick, because that is a statement
//     about the DATE and either event may carry it.
//   • it leaves a group whose dates are all distinct exactly as it found it,
//     which is every healthy program in the workbook.
//   • findDuplicateSessionRows() merges ADDITIVELY — a row written in a run
//     that could not open the form has empty link cells and its twin does not,
//     and picking either one whole would throw away what the other knows — and
//     it never treats a BLANK Event_ID as an identity two rows can share.
//   • the derived counts are deliberately NOT carried across, because they are
//     recomputed from the registrant rows the moment the sweep lands.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = n => String(n).padStart(2, '0');

const notes = [];

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, pattern) => {
      if (pattern === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (pattern === 'h:mm a') {
        const h = d.getHours();
        return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
      }
      return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    },
    // computeEventId() digests `calendarId|cleanTitle|dateKey` and keeps the
    // first twelve hex characters, so the digest has to actually spread across
    // the whole input: a stub that echoed the bytes of the raw string gave
    // every date of one program the same id, since only the calendar's first
    // six characters survived the truncation.
    computeDigest: (algo, raw) =>
      Array.from(require('crypto').createHash('md5').update(String(raw)).digest()),
    DigestAlgorithm: { MD5: 'MD5' },
    sleep: () => {},
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    Charset: { UTF_8: 'UTF-8' }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.collapseSessionsByEventId_ = collapseSessionsByEventId_;
this.findDuplicateSessionRows = findDuplicateSessionRows;
this.describeDuplicateSessionRows = describeDuplicateSessionRows;
this.computeEventId = computeEventId;
this.formatDateKey = formatDateKey;
this.ADMIN_GATED_ACTIONS = ADMIN_GATED_ACTIONS;
this.WAITLIST_ONLY_COLUMN_VALUE = WAITLIST_ONLY_COLUMN_VALUE;
// noteForAdmin() spools to the office digest through Script Properties, which
// is not what this file is about — recorded instead, so the "never silent"
// half can be asserted without a digest.
this.__notes = [];
noteForAdmin = function (category, message) { this.__notes.push({ category, message }); }.bind(this);
`, sandbox, { filename: 'project.gs' });

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const CAL = 'programs@group.calendar.google.com';
const ev = (y, m, d, h, min) => {
  const start = new Date(y, m, d, h, min || 0);
  return { getStartTime: () => start, getEndTime: () => new Date(y, m, d, h + 1, min || 0) };
};
const session = (event, waitlistOnly) => ({
  event, calendarId: CAL, locationName: 'Narberth', waitlistOnly: !!waitlistOnly
});

// ---------------------------------------------------------------------------
// 1. THE COLLAPSE
// ---------------------------------------------------------------------------

// A healthy program — four distinct Tuesdays — must come back untouched.
{
  sandbox.__notes.length = 0;
  const group = {
    cleanTitle: 'Chair Yoga',
    sessions: [ev(2026, 8, 1, 9), ev(2026, 8, 8, 9), ev(2026, 8, 15, 9), ev(2026, 8, 22, 9)].map(e => session(e))
  };
  const out = sandbox.collapseSessionsByEventId_(group);
  ok('four distinct dates are left alone', out.length === 4, `got ${out.length}`);
  ok('a healthy program files no note', sandbox.__notes.length === 0);
}

// Two events on one day: one row, the EARLIER one, and the span is not widened.
{
  sandbox.__notes.length = 0;
  const morning = ev(2026, 8, 1, 9);
  const afternoon = ev(2026, 8, 1, 13);
  const group = {
    cleanTitle: 'Low-Cost Wills',
    sessions: [session(afternoon), session(morning)] // deliberately out of order
  };
  const out = sandbox.collapseSessionsByEventId_(group);
  ok('two events on one day become one session', out.length === 1, `got ${out.length}`);
  ok('the earliest event is the one kept',
    out[0].event.getStartTime().getHours() === 9,
    `kept ${out[0].event.getStartTime().getHours()}:00`);
  ok('the span is NOT widened over the gap',
    out[0].event.getEndTime().getHours() === 10,
    `end ${out[0].event.getEndTime().getHours()}:00`);
  ok('the collision is filed for the office, not swallowed',
    sandbox.__notes.length === 1 &&
    /more than one calendar event/.test(sandbox.__notes[0].message),
    JSON.stringify(sandbox.__notes));
}

// [Waitlist Only] is a statement about the DATE, so either twin carrying it
// closes the date — whichever of them wins the row.
{
  sandbox.__notes.length = 0;
  const group = {
    cleanTitle: 'Bingo',
    // The LATER event is the tagged one, and it is not the one kept.
    sessions: [session(ev(2026, 8, 1, 9), false), session(ev(2026, 8, 1, 14), true)]
  };
  const out = sandbox.collapseSessionsByEventId_(group);
  ok('a tick on either twin closes the date', out.length === 1 && out[0].waitlistOnly === true,
    JSON.stringify(out.map(s => s.waitlistOnly)));
}
{
  const group = {
    cleanTitle: 'Bingo',
    // …and the other way round: the tag on the EARLIER one survives being the
    // row that is kept.
    sessions: [session(ev(2026, 8, 1, 14), false), session(ev(2026, 8, 1, 9), true)]
  };
  const out = sandbox.collapseSessionsByEventId_(group);
  ok('the kept twin does not lose its own tick', out.length === 1 && out[0].waitlistOnly === true,
    JSON.stringify(out.map(s => s.waitlistOnly)));
}

// Two calendars, one day, one title is NOT a duplicate: the calendar is half
// of the Event_ID, and an [All Locations] program genuinely meets twice.
{
  sandbox.__notes.length = 0;
  const other = 'second@group.calendar.google.com';
  const group = {
    cleanTitle: 'Chair Yoga',
    sessions: [
      session(ev(2026, 8, 1, 9)),
      Object.assign(session(ev(2026, 8, 1, 9)), { calendarId: other, locationName: 'Ashbridge' })
    ]
  };
  const out = sandbox.collapseSessionsByEventId_(group);
  ok('one day at two buildings stays two sessions', out.length === 2, `got ${out.length}`);
  ok('two buildings file no collision note', sandbox.__notes.length === 0);
}

// ---------------------------------------------------------------------------
// 2. THE SWEEP
// ---------------------------------------------------------------------------

const map = {
  Event_ID: 0, Clean_Title: 1, Location: 2, Event_Date: 3, Calendar_Source: 4,
  Form_ID: 5, Form_Response_Link: 6, Waitlist_Only: 7, Active_Count: 8, Status: 9
};
const srow = (over) => {
  const r = new Array(10).fill('');
  r[map.Event_ID] = 'e1'; r[map.Clean_Title] = 'Chair Yoga'; r[map.Location] = 'Narberth';
  r[map.Event_Date] = new Date(2026, 8, 1); r[map.Calendar_Source] = CAL;
  r[map.Waitlist_Only] = false;
  Object.keys(over || {}).forEach(k => { r[map[k]] = over[k]; });
  return r;
};

// Nothing to do on a healthy tab.
{
  const rows = [srow({ Event_ID: 'e1' }), srow({ Event_ID: 'e2' }), srow({ Event_ID: 'e3' })];
  const found = sandbox.findDuplicateSessionRows(rows, map);
  ok('distinct Event_IDs produce no duplicates',
    found.drop.length === 0 && found.keep.length === 3 && found.groups.length === 0);
  ok('the report says so plainly',
    /no duplicates/.test(sandbox.describeDuplicateSessionRows(found)),
    sandbox.describeDuplicateSessionRows(found));
}

// The merge is additive: the twin's link and form id fill the base's blanks.
{
  const rows = [
    srow({ Event_ID: 'e1', Form_ID: '', Form_Response_Link: '' }),
    srow({ Event_ID: 'e1', Form_ID: 'FORM_A', Form_Response_Link: '=HYPERLINK("u","View Live Form")' }),
    srow({ Event_ID: 'e2' })
  ];
  const found = sandbox.findDuplicateSessionRows(rows, map);
  ok('two rows under one Event_ID collapse to one',
    found.keep.length === 2 && found.drop.length === 1,
    `keep ${found.keep.length}, drop ${found.drop.length}`);
  const kept = found.keep[0];
  ok('the twin\'s Form_ID fills the blank the base left', kept[map.Form_ID] === 'FORM_A',
    String(kept[map.Form_ID]));
  ok('the twin\'s link FORMULA is carried across, not its display text',
    String(kept[map.Form_Response_Link]).indexOf('=HYPERLINK(') === 0,
    String(kept[map.Form_Response_Link]));
  ok('the date is named in the report',
    /Sep 1, 2026/.test(sandbox.describeDuplicateSessionRows(found)),
    sandbox.describeDuplicateSessionRows(found));
}

// A value the base already holds is never overwritten by a twin.
{
  const rows = [
    srow({ Event_ID: 'e1', Form_ID: 'FORM_RIGHT' }),
    srow({ Event_ID: 'e1', Form_ID: 'FORM_OTHER' })
  ];
  const found = sandbox.findDuplicateSessionRows(rows, map);
  ok('the first row wins a column both rows fill',
    found.keep[0][map.Form_ID] === 'FORM_RIGHT', String(found.keep[0][map.Form_ID]));
}

// Waitlist_Only is OR-ed here for the same reason it is in the collapse.
{
  const rows = [
    srow({ Event_ID: 'e1', Waitlist_Only: false }),
    srow({ Event_ID: 'e1', Waitlist_Only: true })
  ];
  const found = sandbox.findDuplicateSessionRows(rows, map);
  ok('a tick on either row survives the merge',
    found.keep[0][map.Waitlist_Only] === sandbox.WAITLIST_ONLY_COLUMN_VALUE,
    String(found.keep[0][map.Waitlist_Only]));
}

// The counts are NOT merged — they are recomputed from the registrant rows.
{
  const rows = [
    srow({ Event_ID: 'e1', Active_Count: 4, Status: '🟢 Open' }),
    srow({ Event_ID: 'e1', Active_Count: 11, Status: '🔴 Waitlist Only' })
  ];
  const found = sandbox.findDuplicateSessionRows(rows, map);
  ok('a stale count on the twin is not carried across',
    found.keep[0][map.Active_Count] === 4, String(found.keep[0][map.Active_Count]));
}

// A blank Event_ID is not an identity. Three half-written rows are three rows.
{
  const rows = [srow({ Event_ID: '' }), srow({ Event_ID: '' }), srow({ Event_ID: 'e1' })];
  const found = sandbox.findDuplicateSessionRows(rows, map);
  ok('rows with no Event_ID are never folded together',
    found.drop.length === 0 && found.keep.length === 3,
    `keep ${found.keep.length}, drop ${found.drop.length}`);
}

// Removing rows is gated; measuring them is not.
{
  ok('the sweep is admin-gated',
    sandbox.ADMIN_GATED_ACTIONS.indexOf('Remove Duplicate Session Rows') !== -1);
  ok('the read-only report is NOT gated',
    sandbox.ADMIN_GATED_ACTIONS.indexOf('Find Duplicate Session Rows') === -1);
}

console.log(failures === 0 ? '\nAll duplicate-session-row tests passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
