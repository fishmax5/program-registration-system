// THE CHECK-IN PAGE (section 16) — a web app serving the same marking Quick
// Mark does, to a tablet at the door.
//
// What this file pins is the handful of things that break SILENTLY, which on a
// page served to a browser nobody controls means a volunteer standing in front
// of a queue looking at half a screen:
//
//   1. THE INLINED LISTS ARE A LITERAL. The lists travel inside the page's own
//      <script> block, so a member called O'Brien — or a program title
//      containing the two characters that end a script tag — would otherwise
//      end the page in the middle of a sentence. Same hazard as the dialog's
//      (quick_mark_inline_index.test.js), and a worse blast radius: the dialog
//      is opened by staff who can reach the sheet another way.
//   2. A PIN THAT IS SET ACTUALLY REFUSES. The whole reason the page can be
//      deployed to a tablet with no Google account signed into it is that the
//      PIN gate holds; a gate that silently passed would turn the link into an
//      open write endpoint without anything on screen looking different.
//   3. THE ROSTER READS AS A DOOR LIST. Appointment sessions sort by time and
//      everything else by name, a person holding two slots stays two rows, and
//      the Attended column is read the way the rest of the workbook reads a
//      checkbox.
//   4. A LOCATION PIN THAT NAMES NOTHING IS NOT ONE. ?location=Narbeth (typo)
//      must open the ordinary picker, not a page filtered to a building that
//      does not exist and showing an empty list forever.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

// The stored PIN, and the sheet the roster reads — both swapped per test below.
let storedPin = null;
let registrantRows = [];

// Event_ID is the MARKER the sectioned reader finds a header row by, so a
// stub without it is a tab the reader sees no tables on at all.
const HEADER_ROW = [
  'Event_Date', 'Location', 'Event', 'Event_Time', 'Name', 'Attended', 'Lunch_Served', 'Event_ID'
];

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
      setProperty: (key, value) => { if (key === 'CHECK_IN_PIN') storedPin = value; },
      deleteProperty: key => { if (key === 'CHECK_IN_PIN') storedPin = null; }
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
// `const` declarations do not become properties of the context's global, so
// the two constants this file has to reach into are handed over by name — the
// same trick quick_mark_inline_index.test.js uses for its one function.
vm.runInContext(src + ';this.HEADERS = HEADERS; this.CALENDAR_MAP = CALENDAR_MAP;',
  sandbox, { filename: 'Code.gs' });

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// ---------------------------------------------------------------------------
// 1. The inlined lists are a literal, through a name chosen to break it.
// ---------------------------------------------------------------------------
const nasty = 'O\'Brien </script><script>alert("x")</script> "quoted"';
const index = {
  builtAt: '9:00 AM',
  sessions: [{
    value: 'Chair Yoga · Wed, Sep 16, 2026', label: 'Chair Yoga · Wed, Sep 16, 2026', location: 'Narberth',
    title: 'Chair Yoga', dateKey: '2026-09-16', byAppointment: false, times: [], group: 'Upcoming'
  }],
  namesBySession: { 'Narberth|~|Chair Yoga · Wed, Sep 16, 2026': { names: [nasty], keys: ['x'], times: [''] } },
  members: [{ name: nasty, key: 'x' }],
  needs: []
};

const page = sandbox.buildCheckInHtml(index, { location: 'Narberth', pinRequired: false });
const body = page.substring(page.indexOf('<script>'));
ok('the page has exactly one closing script tag', body.split('</script>').length - 1 === 1);

const literal = /var INDEX = ("(?:[^"\\]|\\.)*") \? JSON\.parse/.exec(page);
ok('the lists are inlined as a single string literal', !!literal);
if (literal) {
  const parsed = JSON.parse(JSON.parse(literal[1]));
  ok('the literal parses back to the same lists', parsed.members[0].name === nasty);
}
// The options ride the same way, and carry the location pin the URL asked for.
const optsLiteral = /var OPTS = JSON\.parse\(("(?:[^"\\]|\\.)*")\);/.exec(page);
ok('the page options are inlined as a literal too', !!optsLiteral);
if (optsLiteral) {
  const opts = JSON.parse(JSON.parse(optsLiteral[1]));
  ok('the location pin reaches the page', opts.location === 'Narberth');
  ok('the locations travel with the page', opts.locations.indexOf('Narberth') !== -1);
}

// A workbook whose lists have never been built serves a page that says so
// rather than one that spins.
const noIndex = sandbox.buildCheckInHtml(null, { location: '', pinRequired: false });
ok('an index-less page says INDEX = null', /var INDEX = null \? JSON\.parse\(null\) : null;/.test(noIndex));
ok('and tells the reader how to fix it', noIndex.indexOf('Update Everything Now') !== -1);

// ---------------------------------------------------------------------------
// 2. The PIN gate.
// ---------------------------------------------------------------------------
storedPin = null;
ok('no PIN set means the page is ungated', sandbox.checkInPinAccepted('') === true);
ok('and an offered PIN is harmless when none is set', sandbox.checkInPinAccepted('9999') === true);

storedPin = '4821';
ok('a set PIN refuses a blank', sandbox.checkInPinAccepted('') === false);
ok('a set PIN refuses a wrong one', sandbox.checkInPinAccepted('1234') === false);
ok('a set PIN accepts the right one', sandbox.checkInPinAccepted('4821') === true);
// A tablet keyboard that appends a space must not lock the desk out of its
// own page with nothing on screen to say why.
ok('a trailing space is trimmed, not refused', sandbox.checkInPinAccepted(' 4821 ') === true);

// And the refusal reaches the caller as a refusal — not as an empty roster,
// which would read on the tablet as "nobody is registered".
const refused = sandbox.checkInRoster(JSON.stringify({ location: 'Narberth', session: 'x', pin: 'nope' }));
ok('a wrong PIN refuses the roster call', refused.ok === false && refused.needsPin === true);
const refusedMark = sandbox.checkInMark(JSON.stringify({ name: 'Ruth', attended: true, pin: 'nope' }));
ok('a wrong PIN refuses the mark call', refusedMark.ok === false && refusedMark.needsPin === true);

// Setting and clearing, from the dialog.
const cleared = sandbox.setCheckInPin('  ');
ok('a blank clears the PIN', cleared.pinSet === false && storedPin === null);
ok('and says what that means', /whole internet/.test(cleared.message));
const set = sandbox.setCheckInPin(' 1379 ');
ok('a PIN is stored trimmed', set.pinSet === true && storedPin === '1379');
storedPin = null;

// ---------------------------------------------------------------------------
// 3. The roster, read off a stub sheet.
// ---------------------------------------------------------------------------
// readCheckInRoster() goes through readAllSectionedRowValues(), so the stub is
// a sheet shaped the way that reader expects: a header row, then data.
function sheetFrom(rows) {
  const values = [HEADER_ROW].concat(rows);
  return {
    getName: () => 'Registrant_Dash',
    getLastRow: () => values.length,
    getLastColumn: () => HEADER_ROW.length,
    getMaxRows: () => values.length,
    getRange: (row, col, numRows, numCols) => ({
      getValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || HEADER_ROW.length))),
      getValue: () => values[row - 1][col - 1],
      getDisplayValues: () => values.slice(row - 1, row - 1 + (numRows || 1))
        .map(r => r.slice(col - 1, col - 1 + (numCols || HEADER_ROW.length)).map(String))
    })
  };
}

// HEADERS.Registrant_Dash is the real, wide layout; the stub above is the
// narrow slice this test cares about. Point the reader at the slice.
const realHeaders = sandbox.HEADERS.Registrant_Dash;
function withStubSheet(rows, fn) {
  sandbox.HEADERS.Registrant_Dash = HEADER_ROW;
  const sheet = sheetFrom(rows);
  sandbox.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheetByName: () => sheet });
  try { return fn(); } finally {
    sandbox.HEADERS.Registrant_Dash = realHeaders;
    sandbox.SpreadsheetApp.getActiveSpreadsheet = () => null;
  }
}

const d = key => new Date(key + 'T12:00:00');

// An ordinary class: three people, one already marked, one marked with the
// string a hand-typed cell holds rather than a real checkbox.
const classRows = [
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Ruth Klein', true, false, 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Al Morris', 'Yes', false, 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Bea Stone', '', false, 'evt1'],
  // Same program, different building — must not appear on Narberth's door list.
  [d('2026-09-16'), 'Ashbridge', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Sam Roth', false, false, 'evt1'],
  // Same building, different day — must not appear on the 16th's list.
  [d('2026-09-23'), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Ida Weiss', false, false, 'evt1']
];

const classList = withStubSheet(classRows,
  () => sandbox.readCheckInRoster('Narberth', 'Chair Yoga · Wed, Sep 16, 2026'));

ok('the door list holds only this building and this date', classList.length === 3);
ok('an ordinary session sorts by name',
  classList.map(r => r.name).join('|') === 'Al Morris|Bea Stone|Ruth Klein');
ok('a real checkbox reads as attended', classList.filter(r => r.name === 'Ruth Klein')[0].attended === true);
ok('a hand-typed "Yes" reads as attended too',
  classList.filter(r => r.name === 'Al Morris')[0].attended === true);
ok('a blank reads as not yet here', classList.filter(r => r.name === 'Bea Stone')[0].attended === false);
// EVERY session carries an Event_Time, appointment or not — so "an ordinary
// class has no times" is false, and the thing that actually distinguishes the
// two is whether the times DIFFER down the list. A class of thirty shares one
// time, which is why it still sorts by name above, and why the page suppresses
// a subtitle that would otherwise repeat the heading on all thirty rows.
ok('an ordinary session carries one time, shared by every row',
  classList.every(r => r.time === '10:00 AM'));
// The suppression itself lives in the page, so pin the rule the page reads
// rather than only the data it reads it from.
ok('the page only prints a slot where slots vary', /if \(r\.time && timesVary\(\)\)/.test(page));

// A Personalized Assistance morning: read as a schedule, and one person
// legitimately holding two slots stays two rows.
const apptRows = [
  [d('2026-09-16'), 'Narberth', 'Low-Cost Wills', '11:30 AM – 12:00 PM', 'Ida Weiss', false, false, 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Low-Cost Wills', '9:30 AM – 10:00 AM', 'Ruth Klein', false, false, 'evt1'],
  [d('2026-09-16'), 'Narberth', 'Low-Cost Wills', '10:30 AM – 11:00 AM', 'Ruth Klein', false, false, 'evt1'],
  // A true duplicate — same person, same slot — collapses to one row.
  [d('2026-09-16'), 'Narberth', 'Low-Cost Wills', '10:30 AM – 11:00 AM', 'Ruth Klein', false, false, 'evt1']
];
const apptList = withStubSheet(apptRows,
  () => sandbox.readCheckInRoster('Narberth', 'Low-Cost Wills · Wed, Sep 16, 2026'));

ok('a duplicate registration collapses', apptList.length === 3);
ok('an appointment session sorts by time, not by name',
  apptList.map(r => r.time).join('|') === '9:30 AM|10:30 AM|11:30 AM');
ok('and one person holding two slots stays two rows',
  apptList.filter(r => r.name === 'Ruth Klein').length === 2);
ok('an appointment session carries a different time per row',
  new Set(apptList.map(r => r.time)).size === 3);

// The undated "program only" choice spans dates, and each row says which.
const undated = withStubSheet(classRows, () => sandbox.readCheckInRoster('Narberth', 'Chair Yoga'));
ok('an undated choice returns every date', undated.length === 4);
ok('and sorts the earlier date first', undated[0].dateKey === '2026-09-16');
ok('with the last row on the later date', undated[undated.length - 1].dateKey === '2026-09-23');

// ---------------------------------------------------------------------------
// 4. The location pin.
// ---------------------------------------------------------------------------
const known = sandbox.checkInLocations();
ok('the locations come off CALENDAR_MAP, deduped',
  known.length === known.filter((v, i, a) => a.indexOf(v) === i).length && known.length > 0);
ok('an exact location pins', sandbox.matchCheckInLocation(known[0]) === known[0]);
ok('a hand-typed lowercase one pins too',
  sandbox.matchCheckInLocation(known[0].toLowerCase()) === known[0]);
ok('a typo pins nothing rather than filtering to a building that does not exist',
  sandbox.matchCheckInLocation('Narbeth') === '');
ok('and so does an empty one', sandbox.matchCheckInLocation('') === '');

// ---------------------------------------------------------------------------
// 5. The payload the page sends.
// ---------------------------------------------------------------------------
ok('a JSON string parses', sandbox.parseCheckInPayload('{"name":"Ruth"}').name === 'Ruth');
ok('an object passes through', sandbox.parseCheckInPayload({ name: 'Ruth' }).name === 'Ruth');
// Garbage from a browser mid-reload must be an empty payload, not a throw that
// the page renders as a red bar with a stack trace in it.
ok('garbage is an empty payload, not a throw',
  JSON.stringify(sandbox.parseCheckInPayload('{oh dear')) === '{}');
ok('and so is nothing at all', JSON.stringify(sandbox.parseCheckInPayload()) === '{}');

// ---------------------------------------------------------------------------
// 6. The slot comparator, which the appointment ordering above rests on.
// ---------------------------------------------------------------------------
const cmp = sandbox.compareAppointmentStartLabels;
ok('morning sorts before afternoon', cmp('9:30 AM', '1:00 PM') < 0);
ok('noon is not midnight', cmp('12:00 PM', '11:00 AM') > 0);
ok('midnight is not noon', cmp('12:30 AM', '1:00 AM') < 0);
ok('a blank sorts last', cmp('', '9:00 AM') > 0);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
