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

const src = require('./helpers/source').readSource();

// The stored PIN, and the sheet the roster reads — both swapped per test below.
let storedPin = null;
let registrantRows = [];
let props = {};

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
    computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' },
    // Section 16b packs its stores with gzip + base64 (packCachedText). What
    // matters here is the ROUND TRIP, not the compression, so these stand in
    // for both halves of it.
    newBlob: data => ({ getBytes: () => data, getDataAsString: () => String(data) }),
    gzip: blob => blob,
    ungzip: blob => blob,
    base64Encode: bytes => Buffer.from(String(bytes)).toString('base64'),
    base64Decode: text => Buffer.from(String(text), 'base64').toString()
  },
  // A real (in-memory) property store, because section 16b keeps the door's
  // queue, its deltas and its roster store in Script Properties — chunked,
  // since one property holds 9KB.
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => (key === 'CHECK_IN_PIN'
        ? storedPin
        : (props[key] === undefined ? null : props[key])),
      setProperty: (key, value) => {
        if (key === 'CHECK_IN_PIN') storedPin = value; else props[key] = String(value);
      },
      setProperties: values => { Object.keys(values).forEach(k => { props[k] = String(values[k]); }); },
      deleteProperty: key => {
        if (key === 'CHECK_IN_PIN') storedPin = null; else delete props[key];
      }
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
// The queue's lock is the DOCUMENT lock, deliberately — the script lock is the
// one every sync holds, and taking it to append to the queue would reintroduce
// the blocking section 16b exists to remove.
sandbox.LockService = {
  getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} })
};
vm.createContext(sandbox);
// `const` declarations do not become properties of the context's global, so
// the two constants this file has to reach into are handed over by name — the
// same trick quick_mark_inline_index.test.js uses for its one function.
vm.runInContext(src + ';this.HEADERS = HEADERS; this.CALENDAR_MAP = CALENDAR_MAP;',
  sandbox, { filename: 'program.gs' });

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
    value: 'Chair Yoga · Wed, Sep 16, 2026', label: nasty + ' · Wed, Sep 16, 2026', location: 'Narberth',
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
  ok('the literal parses back to the same lists', parsed.sessions[0].label.indexOf(nasty) === 0);
  // ONLY THE SESSION LIST TRAVELS (checkInPageIndex()). The roll, the names on
  // every session and the standing needs are hundreds of kilobytes a tablet
  // downloads before it can draw anything and then never reads — which is a
  // wait in front of a queue, for data the door page cannot use.
  ok('the member roll does not travel with the door page', parsed.members === undefined);
  ok('nor do the per-session name lists', parsed.namesBySession === undefined);
  ok('nor the standing needs', parsed.needs === undefined);
  ok('and a session keeps only what the page draws',
    Object.keys(parsed.sessions[0]).sort().join(',') === 'dateKey,group,label,location,value');
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

// ---------------------------------------------------------------------------
// 7. The /dev trap.
// ---------------------------------------------------------------------------
// getUrl() does not always hand back the published address — it often returns
// the script editor's own /dev test URL, which opens fine for the script's
// owner and fails for a tablet with "Sorry, unable to open the file at this
// time." Presenting that as a shareable link is how a desk ends up with a
// dead page, so the dialog has to tell the two apart.
function infoWithUrl(url) {
  sandbox.ScriptApp = { getService: () => ({ getUrl: () => url }) };
  try { return sandbox.readCheckInPageInfo(); } finally { sandbox.ScriptApp = {}; }
}
ok('a /dev URL is flagged as the test address',
  infoWithUrl('https://script.google.com/macros/s/ABC123/dev').isDev === true);
ok('a /dev URL with a query string is still flagged',
  infoWithUrl('https://script.google.com/macros/s/ABC123/dev?location=Narberth').isDev === true);
ok('a published /exec URL is not flagged',
  infoWithUrl('https://script.google.com/macros/s/ABC123/exec').isDev === false);
// A script id that merely CONTAINS "dev" is not a dev URL — the check is the
// path segment, not a substring anywhere in the address.
ok('an /exec URL whose id contains "dev" is not flagged',
  infoWithUrl('https://script.google.com/macros/s/AKfy_devXYZ/exec').isDev === false);
ok('no deployment at all is not flagged as dev', infoWithUrl('').isDev === false);

// And the dialog renders the warning rather than the link list.
const devPage = sandbox.buildCheckInPageHtml({ url: 'https://x/dev', isDev: true, locations: ['Narberth'], pinSet: false });
ok('the dialog warns about the test address', /not a published one/.test(devPage));
ok('and names the error a tablet would show', /unable to open the file at this time/.test(devPage));

// ---------------------------------------------------------------------------
// 8. Section 16b — the store the door reads, and the queue it writes.
// ---------------------------------------------------------------------------
// What this pins is the two promises the speed work rests on: a session opens
// WITHOUT reading the registrants tab, and a tap is written down WITHOUT
// waiting for the workbook. Both are silent when they break — a stale roster
// looks like a roster, and a dropped mark looks like a check-in.
props = {};

const today = new Date();
const dayKey = offset => {
  const date = new Date(today.getTime());
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getDate()).padStart(2, '0')}`;
};
const dayDate = offset => new Date(dayKey(offset) + 'T12:00:00');

const storeRows = [
  [dayDate(0), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Ruth Klein', false, false, 'evt1'],
  [dayDate(0), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Al Morris', true, false, 'evt1'],
  // Well outside the window the door covers — a roster nobody at a front door
  // is ever standing in front of, and the thing that would make the blob too
  // big to keep if it were carried.
  [dayDate(120), 'Narberth', 'Chair Yoga', '10:00 AM – 11:00 AM', 'Bea Stone', false, false, 'evt1']
];
const todayLabel = `Chair Yoga · ${sandbox.formatDateLabel(dayDate(0))}`;
const farLabel = `Chair Yoga · ${sandbox.formatDateLabel(dayDate(120))}`;

withStubSheet(storeRows, () => sandbox.refreshCheckInStore());
ok('the door store is kept in Script Properties, not only in a cache',
  Object.keys(props).some(key => key.indexOf('CHECK_IN_STORE_V1') === 0));

// THE POINT OF ALL OF IT: the sheet is gone, and a session still opens.
sandbox.SpreadsheetApp.getActiveSpreadsheet = () => null;
const stored = sandbox.storedCheckInRoster('Narberth', todayLabel);
ok('a session opens off the store with no sheet read at all', !!stored && stored.rows.length === 2);
ok('and the rows carry what a door reads',
  !!stored && stored.rows[0].name === 'Al Morris' && stored.rows[1].name === 'Ruth Klein');
ok('a session outside the stored window answers null, not an empty list',
  sandbox.storedCheckInRoster('Narberth', farLabel) === null);
ok('and so does a location the store has never heard of',
  sandbox.storedCheckInRoster('Zoom', todayLabel) === null);

// A tap: queued, and answered without the sheet — which is still not there.
const marked = sandbox.checkInMark(JSON.stringify({
  location: 'Narberth', session: todayLabel, name: 'Ruth Klein', attended: true
}));
ok('a mark is answered immediately rather than written', marked.ok === true && marked.queued === true);
ok('and it is queued durably', sandbox.readCheckInQueue().length === 1);
ok('and recorded as a delta, which outlives the queue entry',
  sandbox.readCheckInDeltas().length === 1);

// The overlay is what stops the desk seeing its own tap come back unticked.
const overlaid = sandbox.applyCheckInOverlay(
  sandbox.storedCheckInRoster('Narberth', todayLabel).rows,
  'Narberth', todayLabel, { builtAtMs: 0 });
ok('a queued mark shows on the roster before the sheet has it',
  overlaid.filter(r => r.name === 'Ruth Klein')[0].attended === true);
ok('and it does not tick anybody else',
  overlaid.filter(r => r.name === 'Al Morris')[0].attended === true);

// The undo, through the same queue.
sandbox.checkInMark(JSON.stringify({
  location: 'Narberth', session: todayLabel, name: 'Al Morris', clear: true
}));
const cleared2 = sandbox.applyCheckInOverlay(
  sandbox.storedCheckInRoster('Narberth', todayLabel).rows,
  'Narberth', todayLabel, { builtAtMs: 0 });
ok('a queued clear unticks somebody the sheet still has ticked',
  cleared2.filter(r => r.name === 'Al Morris')[0].attended === false);

// A delta the sheet has caught up with is dropped, or every roster would carry
// this morning's marks forever.
const queuedIds = sandbox.readCheckInQueue().map(entry => entry.id);
sandbox.dropCheckInDeltasBefore(new Date().getTime() + 1000);
ok('deltas older than the store build are forgotten', sandbox.readCheckInDeltas().length === 0);
ok('but the queue itself is untouched — those marks are not on the sheet yet',
  sandbox.readCheckInQueue().map(entry => entry.id).join('|') === queuedIds.join('|'));

// A failure has to reach somebody. The volunteer has walked away by the time a
// queued mark is applied, so the next roster load is the only place left.
sandbox.recordCheckInProblem({ name: 'Ruth Klein', session: todayLabel }, 'Nobody by that name.');
const problems = sandbox.checkInRoster(JSON.stringify({ location: 'Narberth', session: todayLabel }));
ok('a failed mark is reported on the next roster load',
  problems.ok === true && problems.problems.join(' ').indexOf('Nobody by that name') !== -1);
ok('and the roster came from the store, and says so', problems.source === 'stored');
sandbox.clearCheckInProblems();
ok('and it is only said once', sandbox.readCheckInProblems().length === 0);

// Chunking, because a Script Property holds 9KB and a store does not.
const long = 'x'.repeat(20000);
ok('a value longer than one property round-trips', (() => {
  sandbox.writeChunkedScriptProperty('TEST_CHUNKED', long, 8000, 10);
  return sandbox.readChunkedScriptProperty('TEST_CHUNKED') === long;
})());
ok('and one too large to hold is refused rather than half-written', (() => {
  const ok2 = sandbox.writeChunkedScriptProperty('TEST_BIG', long, 8000, 1);
  return ok2 === false && sandbox.readChunkedScriptProperty('TEST_BIG') === '';
})());
sandbox.clearChunkedScriptProperty('TEST_CHUNKED');
ok('and clearing it takes the chunks with it',
  Object.keys(props).every(key => key.indexOf('TEST_CHUNKED') !== 0));

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
