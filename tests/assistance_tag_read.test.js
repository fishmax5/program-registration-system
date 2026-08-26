// [Personalized Assistance] has to survive the trip BACK from the calendar.
//
// The bug this file pins down is the other half of assistance_tag_write.test.js.
// Writing the tag worked; reading it did not. buildGroupsForWindow() copied
// resolveEventSettings()'s answer onto the parsed event field by field, and the
// list of fields was written before the assistance tag existed — so
// isAssistance, slotMinutes and maxPerMonth were resolved correctly from every
// description and then thrown away. buildEventGroups() read
// `parsed.isAssistance`, got undefined, and every group came out
// isAssistance:false.
//
// The visible symptom was the whole feature quietly reverting: the tick
// reached the calendar, the next sync read the calendar, saw (as far as it
// could tell) no tag anywhere, and reconcileProgramFlagColumns() wrote `false`
// into the Personalized_Assistance box of every session row. No checks left in
// the sheet, an hour after ticking them, with nothing in the log to say why.
//
// The rest of the file covers the two things that then had to hold for the fix
// to be worth anything: a flag is a property of a PROGRAM (not of one of its
// month groups), and a description that has been through the Calendar web UI
// still reads as tagged.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const logLines = [];
const sandbox = {
  console: { log: line => logLines.push(String(line)) },
  Utilities: {
    // Real enough for the two patterns that decide grouping: a month label
    // that varied per DAY would put every event in its own group and quietly
    // pass the tests below for the wrong reason.
    formatDate: (d, tz, pattern) => {
      const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];
      if (pattern === 'MMMM yyyy') return `${months[d.getMonth()]} ${d.getFullYear()}`;
      if (pattern === 'yyyy-MM-dd') {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
          `${String(d.getDate()).padStart(2, '0')}`;
      }
      return d.toISOString();
    },
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
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
;this.CALENDAR_MAP = CALENDAR_MAP;
this.ASSISTANCE_TAG = ASSISTANCE_TAG;
this.ASSISTANCE_WORDS_REGEX = ASSISTANCE_WORDS_REGEX;
this.APPOINTMENT_SLOT_MINUTES = APPOINTMENT_SLOT_MINUTES;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const CAL_IDS = Object.keys(sandbox.CALENDAR_MAP);
const NARBERTH = CAL_IDS[0];
const ASHBRIDGE = CAL_IDS[1];

function fakeEvent(title, description, start, hours) {
  const end = new Date(start.getTime() + (hours || 3) * 3600 * 1000);
  return {
    getTitle: () => title,
    getDescription: () => description,
    isAllDayEvent: () => false,
    getStartTime: () => start,
    getEndTime: () => end
  };
}

/** buildGroupsForWindow() takes the raw fetch, which is all this needs to stub. */
function groupsFor(eventsByCalendar) {
  return sandbox.buildGroupsForWindow(eventsByCalendar);
}
function findGroup(groups, title) {
  return groups.filter(g => g.cleanTitle === title);
}

// ---------------------------------------------------------------------------
// 1. THE BUG ITSELF: the tag in a description reaches the group.
// ---------------------------------------------------------------------------
{
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Low-Cost Wills', '[Personalized Assistance]', new Date(2026, 8, 3, 12, 30))]
  });
  check('description tag reaches the group', groups[0].isAssistance, true);
}

{
  // "[Slots: 20]" alone says appointments too — parseSettingsBrackets() has
  // always said so, and the dropped copy meant nothing downstream heard it.
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Computer Help', '[Slots: 20]', new Date(2026, 8, 4, 10, 0))]
  });
  check('[Slots: N] alone marks appointments', groups[0].isAssistance, true);
  check('[Slots: N] carries the length', groups[0].slotMinutes, 20);
}

{
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Medicare Counseling',
      'Gerry is in room 4.\n[Personalized Assistance, Slots: 20, Max Per Month: 1]',
      new Date(2026, 8, 5, 13, 0))]
  });
  check('a combined bracket carries all three', [
    groups[0].isAssistance, groups[0].slotMinutes, groups[0].maxPerMonth
  ], [true, 20, 1]);
}

{
  // The neighbouring flags were never broken — they are here so a future
  // rewrite of the copy cannot drop one of them the way this one dropped three.
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Book Club', '[Club, Grouped, Cap: 12]', new Date(2026, 8, 6, 14, 0))]
  });
  check('the other settings still arrive', [
    groups[0].isClub, groups[0].isFixed, groups[0].capacity, groups[0].isAssistance
  ], [true, true, 12, false]);
}

{
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Coffee Hour', 'Come as you are.', new Date(2026, 8, 7, 9, 0))]
  });
  check('an untagged program is not an appointment program', groups[0].isAssistance, false);
}

// ---------------------------------------------------------------------------
// 2. A FLAG IS A PROPERTY OF A PROGRAM, NOT OF ONE MONTH OF IT.
// ---------------------------------------------------------------------------
{
  // A Regular program is grouped per calendar month, so twelve dates are
  // twelve groups. Staff tag one event; the reconciler keys its answer by
  // calendar + title with no month in it, so an untagged month's `false`
  // landed on the same key and, whenever it was written last, unticked the
  // whole program.
  const groups = groupsFor({
    [NARBERTH]: [
      fakeEvent('Low-Cost Wills', '[Personalized Assistance, Slots: 20]', new Date(2026, 8, 3, 12, 30)),
      fakeEvent('Low-Cost Wills', 'Heather is in the small room.', new Date(2026, 9, 1, 12, 30)),
      fakeEvent('Low-Cost Wills', '', new Date(2026, 10, 5, 12, 30))
    ]
  });
  const wills = findGroup(groups, 'Low-Cost Wills');
  check('one program, three month groups', wills.length, 3);
  check('every month group is an appointment program', wills.map(g => g.isAssistance), [true, true, true]);
  check('every month group knows the slot length', wills.map(g => g.slotMinutes), [20, 20, 20]);
}

{
  // The same rule for the flags that already had it stated within a group.
  const groups = groupsFor({
    [NARBERTH]: [
      fakeEvent('Knitting Circle', '[Club]', new Date(2026, 8, 3, 10, 0)),
      fakeEvent('Knitting Circle', '', new Date(2026, 9, 3, 10, 0))
    ]
  });
  check('club spreads across months too',
    findGroup(groups, 'Knitting Circle').map(g => g.isClub), [true, true]);
}

{
  // NOT across programs that merely share a name. Two locations running an
  // untagged "Chair Yoga" are two programs with two forms, and the tick is
  // spread by the same rule on the sheet (spreadFlagToSiblingRows()).
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Chair Yoga', '[Personalized Assistance]', new Date(2026, 8, 3, 10, 0))],
    [ASHBRIDGE]: [fakeEvent('Chair Yoga', '', new Date(2026, 8, 4, 10, 0))]
  });
  const yoga = groups.filter(g => g.cleanTitle === 'Chair Yoga')
    .sort((a, b) => String(a.calendarId).localeCompare(String(b.calendarId)));
  check('two unlinked locations stay two programs', yoga.length, 2);
  check('the untagged location is left alone',
    yoga.map(g => g.isAssistance).sort().join(','), 'false,true');
}

{
  // …but a [All Locations] program IS one program, and its groups share a
  // scope, so the tag reaches the other site.
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Tai Chi', '[All Locations, Personalized Assistance]', new Date(2026, 8, 3, 10, 0))],
    [ASHBRIDGE]: [fakeEvent('Tai Chi', '[All Locations]', new Date(2026, 8, 4, 10, 0))]
  });
  const taiChi = findGroup(groups, 'Tai Chi');
  check('a linked program is one program', taiChi.length, 1);
  check('and it is an appointment program', taiChi[0].isAssistance, true);
}

// ---------------------------------------------------------------------------
// 3. WHAT COMES BACK OUT OF THE CALENDAR WEB UI.
// ---------------------------------------------------------------------------
{
  // Editing an event by hand re-flows its description into HTML and turns the
  // space this script wrote into &nbsp;. "Personalized&nbsp;Assistance" did not
  // match \s+, so the bracket read as prose and the tag vanished.
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Low-Cost Wills',
      '<div>Heather Turner</div><div>[Personalized&nbsp;Assistance,&nbsp;Slots: 20]</div>',
      new Date(2026, 8, 3, 12, 30))]
  });
  check('an &nbsp; inside the bracket still reads as the tag', groups[0].isAssistance, true);
  check('and the slot length with it', groups[0].slotMinutes, 20);
}

{
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Book Club', '[Club<br>]', new Date(2026, 8, 3, 10, 0))]
  });
  check('a stray tag inside the bracket does not hide the word', groups[0].isClub, true);
}

{
  // The promise isTagOnlyBracket() exists to keep, unchanged by any of this: a
  // sentence that happens to contain a tag word is a note, not an instruction.
  check('prose is still prose', sandbox.parseSettingsBrackets(
    '[Call the office for an appointment]').isAssistance, false);
  check('prose with an &nbsp; is still prose', sandbox.parseSettingsBrackets(
    '[Call&nbsp;the&nbsp;office&nbsp;for&nbsp;an&nbsp;appointment]').isAssistance, false);
  check('a film club is still not a club', sandbox.parseSettingsBrackets(
    '[Film Club selection: Casablanca]').isClub, false);
}

// ---------------------------------------------------------------------------
// 4. WHAT THE ADMIN TOOL REPORTS.
// ---------------------------------------------------------------------------
{
  const read = sandbox.readTagsFromDescription(
    'Heather Turner, small room.\n[Personalized Assistance, Slots: 20]\n[Notes: bring ID]');
  check('the tag reader finds the appointment tag',
    read.recognized.filter(t => t.key === 'isAssistance').length, 1);
  check('the tag reader reports the slot length',
    read.recognized.filter(t => t.key === 'slotMinutes').map(t => t.value), [20]);
  check('the tag reader names the bracket it ignored',
    read.ignored.map(b => b.content), ['Notes: bring ID']);
  check('the tag reader agrees with the parser', read.settings.isAssistance, true);
}

{
  const read = sandbox.readTagsFromDescription('[Call the office for an appointment]');
  check('an ignored bracket is reported as ignored, not as a tag',
    [read.recognized.length, read.ignored.length], [0, 1]);
  check('and the reason is given', read.ignored[0].reason.indexOf('note') >= 0, true);
}

{
  const read = sandbox.readTagsFromDescription('Room 4. Bring a friend.');
  check('a description with no brackets reports nothing',
    [read.recognized.length, read.ignored.length], [0, 0]);
}

// ---------------------------------------------------------------------------
// 5. WHAT THE LOG SAYS.
// ---------------------------------------------------------------------------
{
  // The sync used to identify a program by group key, which is a 70-character
  // calendar ID with the program name buried in the middle of it — and said
  // nothing at all about the tags, which is the fact the log is opened for.
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Low-Cost Wills', '[Personalized Assistance, Slots: 20, Cap: 5]',
      new Date(2026, 8, 3, 12, 30))]
  });
  const line = sandbox.describeGroup(groups[0]);
  check('the log names the program, not the calendar ID', line.indexOf('@group.calendar') === -1, true);
  check('it names the program', line.indexOf('"Low-Cost Wills"') >= 0, true);
  check('it names the place and the span', line.indexOf('Narberth · September 2026') >= 0, true);
  check('it names the tags it resolved',
    line.indexOf('[Personalized Assistance, Slots: 20, Regular, Cap: 5]') >= 0, true);
  check('it says how many dates', line.indexOf('1 date(s)') >= 0, true);
}

{
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Coffee Hour', '', new Date(2026, 8, 3, 9, 0))]
  });
  check('an untagged program still reports its grouping',
    sandbox.describeGroupTags(groups[0]), '[Regular]');
}

{
  // An appointment program with no [Slots: N] still reports the length it will
  // actually use — the default is a real answer, and a blank there reads as a
  // program that did not take.
  const groups = groupsFor({
    [NARBERTH]: [fakeEvent('Medicare', '[By Appointment]', new Date(2026, 8, 3, 13, 0))]
  });
  check('the default slot length is stated, not left blank',
    sandbox.describeGroupTags(groups[0]).indexOf(`Slots: ${sandbox.APPOINTMENT_SLOT_MINUTES}`) >= 0, true);
}

{
  check('a form is logged as something openable',
    sandbox.describeFormLink('1AbC_dEf'), '(https://docs.google.com/forms/d/1AbC_dEf/edit)');
  check('and a form that does not exist says so', sandbox.describeFormLink(''), 'no form');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
