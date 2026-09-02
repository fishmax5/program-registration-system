// CANCELLATION — the four cells, the three doors, and the link that must not
// multiply.
//
// THE FAILURE THIS FILE GUARDS. A cancellation is not one write, it is four:
// the program status (the seat), the lunch status (the meal), the manual
// override (what stops the next hourly sync re-deriving the row from the form
// response and quietly un-cancelling it), and the Admin_Notes stamp. Three
// doors reach that write — the desk, the leader's Dropped tick, and the member
// on the cancel page — and the whole point of routing them through one
// function is that no door can end up writing three of the four.
//
// The second half is the calendar description. The cancel link lives beside
// the register link in an event description, and a description is rewritten
// every sync: a link that cannot be STRIPPED is a link that accumulates, and
// four "Cancel here" lines in a diary entry is how a member decides the system
// is broken and rings the office instead.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const sandbox = {
  console,
  // A REAL formatDate, because half of what this file tests is a date
  // comparison: applyLeaderDropsAsCancellations() decides "upcoming" by
  // comparing yyyy-MM-dd keys, and a stub that returns '' makes every date
  // equal to every other one and the test passes on a bug.
  Utilities: {
    formatDate: (date, tz, fmt) => {
      const d = new Date(date);
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toDateString();
    },
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: {} },
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'desk@example.org' })
  },
  ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/AKfyTEST/exec' }) },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.stampRegistrantRowCancelled = stampRegistrantRowCancelled;
this.cancellationIdentityMatches = cancellationIdentityMatches;
this.matchesCancellationParty = matchesCancellationParty;
this.applyLeaderDropsAsCancellations = applyLeaderDropsAsCancellations;
this.parseCancelIdentity = parseCancelIdentity;
this.isCheckedTrue = isCheckedTrue;
this.buildCancelLinkLine = buildCancelLinkLine;
this.buildRegistrationLinkLine = buildRegistrationLinkLine;
this.stripAllRegistrationLines = stripAllRegistrationLines;
this.prependRegistrationLine = prependRegistrationLine;
this.getIndexMap = getIndexMap;
this.normalizeNameKey = normalizeNameKey;
this.HEADERS = HEADERS;
this.CANCELLATION_SOURCES = CANCELLATION_SOURCES;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function ok(name, cond, note) {
  if (cond) console.log('ok   ' + name);
  else { failures++; console.log('FAIL ' + name + (note ? '\n     ' + note : '')); }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    `got      ${JSON.stringify(actual)}\n     expected ${JSON.stringify(expected)}`);
}

const map = sandbox.getIndexMap(sandbox.HEADERS.Registrant_Dash);
function blankRow(over) {
  const row = new Array(sandbox.HEADERS.Registrant_Dash.length).fill('');
  Object.keys(over || {}).forEach(k => { row[map[k]] = over[k]; });
  return row;
}

// --- the four cells ---------------------------------------------------------

{
  const row = blankRow({ Name: 'Ruth Cohen', Program_Status: 'Active', Lunch_Status: 'Needed' });
  const moved = sandbox.stampRegistrantRowCancelled(row, map,
    { source: sandbox.CANCELLATION_SOURCES.DESK, reason: 'chest infection' });
  ok('a cancellation reports that it moved', moved === true);
  eq('the seat goes back', row[map['Program_Status']], 'Cancelled');
  eq('the meal goes back', row[map['Lunch_Status']], 'Cancelled');
  // WITHOUT THIS the next import re-derives the row from the form response
  // that is still sitting in the responses sheet, and the cancellation is
  // reversed by the very next hourly run.
  eq('and the sync is told not to undo it', row[map['Manual_Override']], 'Manually Edited');
  ok('the note says which door it came through',
    /Cancelled at the door/.test(row[map['Admin_Notes']]), row[map['Admin_Notes']]);
  ok('and carries the reason', /chest infection/.test(row[map['Admin_Notes']]));
}

{
  const row = blankRow({ Name: 'Ruth Cohen', Program_Status: 'Cancelled', Admin_Notes: 'first note' });
  ok('cancelling twice is a no-op, not a second stamp',
    sandbox.stampRegistrantRowCancelled(row, map, {}) === false);
  eq('and leaves the original note alone', row[map['Admin_Notes']], 'first note');
}

{
  const row = blankRow({ Name: 'X', Program_Status: 'Active', Admin_Notes: 'Allergic to shellfish' });
  sandbox.stampRegistrantRowCancelled(row, map, {});
  ok('a standing note about the person survives the cancellation',
    /^Allergic to shellfish \| Cancelled/.test(row[map['Admin_Notes']]), row[map['Admin_Notes']]);
}

{
  const row = blankRow({ Name: 'X', Program_Status: 'Active' });
  sandbox.stampRegistrantRowCancelled(row, map, { reason: 'x'.repeat(500) });
  ok('a reason typed into a public web box cannot flood the cell',
    row[map['Admin_Notes']].length < 260, String(row[map['Admin_Notes']].length));
}

// --- who goes with whom -----------------------------------------------------

{
  // Built the way the code builds it, never by hand — a test that hard-codes
  // its own idea of the key passes while the two sides disagree.
  const args = { eventId: 'EV1', nameKey: sandbox.normalizeNameKey('Ruth Cohen') };
  const member = blankRow({ Event_ID: 'EV1', Name: 'Ruth Cohen' });
  const guest = blankRow({ Event_ID: 'EV1', Name: "Ruth's daughter", Person_Type: 'Guest', Primary_Registrant: 'Ruth Cohen' });
  const stranger = blankRow({ Event_ID: 'EV1', Name: 'Mary Ray' });
  const otherDay = blankRow({ Event_ID: 'EV2', Name: 'Ruth Cohen' });

  ok('the member matches', sandbox.matchesCancellationParty(member, map, args));
  // An orphaned guest row is a stranger on every door list from then on, and
  // a meal the kitchen still cooks.
  ok('their guest goes with them', sandbox.matchesCancellationParty(guest, map, args));
  ok('nobody else on the session does', !sandbox.matchesCancellationParty(stranger, map, args));
  ok('and neither does the same person on another date',
    !sandbox.matchesCancellationParty(otherDay, map, args));
}

{
  // The reverse is deliberately NOT true: a guest dropping out must not
  // cancel the member who brought them.
  const guestArgs = { eventId: 'EV1', nameKey: sandbox.normalizeNameKey("Ruth's daughter") };
  const member = blankRow({ Event_ID: 'EV1', Name: 'Ruth Cohen' });
  ok('cancelling a guest does not cancel their member',
    !sandbox.matchesCancellationParty(member, map, guestArgs));
}

// --- the cancel page's identity check ---------------------------------------

{
  const row = blankRow({ Name: 'Ruth Cohen', Phone: '(610) 555-0142', Email: 'Ruth@Example.ORG' });
  const by = payload => sandbox.cancellationIdentityMatches(row, map, sandbox.parseCancelIdentity(payload));

  ok('the email matches whatever case it is typed in',
    by({ name: 'ruth cohen', contact: 'RUTH@example.org' }));
  ok('the phone matches however it is punctuated',
    by({ name: 'Ruth Cohen', contact: '610-555-0142' }));
  ok('the last four digits are enough', by({ name: 'Ruth Cohen', contact: '0142' }));
  ok('the right contact detail with the wrong name is refused',
    !by({ name: 'Mary Ray', contact: 'ruth@example.org' }));
  // The name alone is printed on a sign-in sheet that sits on a table all
  // morning. It is not the credential.
  ok('the right name with the wrong contact detail is refused',
    !by({ name: 'Ruth Cohen', contact: '9999' }));
  ok('and with no contact detail at all', !by({ name: 'Ruth Cohen', contact: '' }));
}

{
  // An empty contact column must never become the one that opens for anybody.
  const bare = blankRow({ Name: 'Ruth Cohen' });
  ok('a row with no phone and no email cannot be matched at all',
    !sandbox.cancellationIdentityMatches(bare, map,
      sandbox.parseCancelIdentity({ name: 'Ruth Cohen', contact: '' })) &&
    !sandbox.cancellationIdentityMatches(bare, map,
      sandbox.parseCancelIdentity({ name: 'Ruth Cohen', contact: 'anything@example.org' })));
}

// --- the leader's Dropped tick ----------------------------------------------

{
  const future = new Date(Date.now() + 14 * 864e5);
  const past = new Date(Date.now() - 14 * 864e5);
  const rows = [
    blankRow({ Name: 'A', Event_Date: future, Program_Status: 'Active', Dropped: true }),
    blankRow({ Name: 'B', Event_Date: future, Program_Status: 'Active', Dropped: 'TRUE' }),
    blankRow({ Name: 'C', Event_Date: future, Program_Status: 'Active', Dropped: false }),
    blankRow({ Name: 'D', Event_Date: past, Program_Status: 'Active', Dropped: true })
  ];
  const count = sandbox.applyLeaderDropsAsCancellations(rows);
  eq('two upcoming drops become two cancellations', count, 2);
  eq('a checkbox ticked in the sheet counts', rows[0][map['Program_Status']], 'Cancelled');
  // A leader typing into a shared sheet by hand does not produce a boolean.
  eq('and so does the word a leader typed', rows[1][map['Program_Status']], 'Cancelled');
  eq('an untouched row is left alone', rows[2][map['Program_Status']], 'Active');
  // Tidying last month's sheet is recording history, not freeing a seat.
  eq('and last month is history, not a cancellation', rows[3][map['Program_Status']], 'Active');
  ok('the note names the leader as the source',
    /Cancelled by the program leader/.test(rows[0][map['Admin_Notes']]));
}

eq('"y" is a tick and "no" is not',
  [sandbox.isCheckedTrue('y'), sandbox.isCheckedTrue('Yes'), sandbox.isCheckedTrue('no'),
    sandbox.isCheckedTrue(''), sandbox.isCheckedTrue(true)],
  [true, true, false, false, true]);

// --- the link that must not multiply ----------------------------------------

const linkLine = sandbox.buildRegistrationLinkLine(
  { isFixed: true, cleanTitle: 'Tai Chi', monthLabel: 'March' },
  { publishedUrl: 'https://docs.google.com/forms/d/e/ABC/viewform', formId: 'FORM123' });

ok('the register link still leads', /^<a href="https:\/\/docs\.google\.com\/forms/.test(linkLine), linkLine);
ok('and the cancel link rides beside it', /mode=cancel&form=FORM123/.test(linkLine), linkLine);

{
  const description = sandbox.prependRegistrationLine('Room 4. Bring a mat.', linkLine);
  const once = sandbox.stripAllRegistrationLines(description);
  eq('stripping leaves the description itself alone', once.text, 'Room 4. Bring a mat.');
  // Counted as ONE link found, not two: callers that report "N old links
  // removed", and the sync's already-correct fast path, both read this number.
  eq('and reports one link, not two', once.removed, 1);

  // THE ACCUMULATION TEST. Write, strip, write again — which is what every
  // sync does — and the description must not grow a second cancel link.
  const rewritten = sandbox.prependRegistrationLine(once.text, linkLine);
  eq('a rewrite produces the same description, not a longer one', rewritten, description);
}

{
  // A re-published deployment has a different /exec address, so a link written
  // before it must still come off — matched by its wording instead.
  const stale = '<a href="https://script.google.com/macros/s/OLDDEPLOY/exec?mode=cancel&form=F">' +
    '\u{1F6AB} Cannot make it? Cancel here</a>\n\nRoom 4.';
  ok('a cancel link from an older deployment still strips',
    !/Cannot make it/.test(sandbox.stripAllRegistrationLines(stale).text),
    sandbox.stripAllRegistrationLines(stale).text);
}

{
  // What Google Calendar hands back is not what this script wrote — see
  // DESCRIPTION_HTML_SPACE.
  const reencoded = '<a href="https://script.google.com/macros/s/D/exec?mode=cancel&amp;form=F">' +
    '&#128683;&nbsp;Cannot make it? Cancel here</a>&nbsp;Room 4.';
  ok('and so does one Calendar has re-encoded',
    !/Cannot make it/.test(sandbox.stripAllRegistrationLines(reencoded).text),
    sandbox.stripAllRegistrationLines(reencoded).text);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
