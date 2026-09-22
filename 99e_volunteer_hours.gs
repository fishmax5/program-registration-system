// ============================================================================
// 99e. VOLUNTEER HOURS  (who worked, when, for how long, and where)
// ============================================================================
//
// Numbered after `99d` for the usual reason — never renumber, and this landed
// last. Safe at the end: behavior plus its own vocabulary, its schema
// (`SHEET_NAMES.VOLUNTEER_HOURS`, `HEADERS.Volunteer_Hours`,
// `VOLUNTEER_HOURS_STAFF_COLUMNS`) lives in `03` like every other tab's, its
// own `const`s stand alone, and everything it reaches for — `writeMemoryTab`
// (40), `readSimpleTable` (40), `collectKnownMembers` (38),
// `listKnownProgramTitles` (53), `CALENDAR_MAP` (04) — it reads at CALL time
// or through a hoisted function declaration.
//
// WHY THIS IS NOT A REGISTRATION. A volunteer is the one person in the
// building who is not attending anything: they are working, they often stay
// for a session they are not in, and a good many of them are not at either
// building at all — Debbie Robinson does the private counselling somewhere
// else, and the Mah Jongg leaders telephone round from home to find out who
// is coming to play. Person_Type on `All_Registrants` would have handled the
// first kind and nothing else: every row there hangs off an Event_ID, and
// there is no calendar event for an afternoon on the telephone.
//
// What the year-end report needs is also a different shape from a roster. The
// centre is credited for its volunteers and their HOURS, so the grain is one
// row per VISIT — the same person leading the same class every Tuesday is
// thirty-six rows, not one row somebody keeps adding a number to. A tab of
// visits sums any way somebody asks: by person, by program, by month, by year.
//
// THE HOURS ARE WORKED OUT WHERE THEY CAN BE AND TYPED WHERE THEY CANNOT.
// Arrived and Departed are the two facts a front desk actually has, and
// volunteerVisitHours() turns them into a number. A volunteer working away
// from the building has neither — nobody watched them start — so they report
// "two hours" and leave the times blank. Typed hours are therefore never
// overwritten by a blank pair of times, and a pair of times always wins over
// a stale typed number: the times are the evidence and the number is the
// summary. See volunteerVisitHours() for the one case that is refused.
//
// NOTHING HERE IS DERIVED FROM ANYTHING ELSE, which is the property that makes
// the tab safe to delete and safe to hand-edit: no sync writes it, no render
// rebuilds it, and the only code that adds a row is somebody pressing a
// button. `refreshVolunteerHoursTab()` re-draws what is already there.
// ============================================================================

/** What a volunteer was doing. Open, not restricted — see the validation below. */
const VOLUNTEER_ROLES = [
  'Program Leader',
  'Program Helper',
  'Front Desk',
  'Kitchen / Lunch',
  'Driver',
  'Telephone / Outreach',
  'Office / Admin',
  'Counselling',
  'Board / Committee',
  'Maintenance / Garden',
  'Other'
];

/**
 * The location a volunteer who was not at either building gets. A real value
 * rather than a blank, because "away from the centre" and "nobody filled this
 * in" are different answers and the annual report distinguishes them.
 */
const VOLUNTEER_OFF_SITE_LOCATION = 'Off-site';

/** How far back the summary report looks when nobody says. A year of credit. */
const VOLUNTEER_REPORT_DEFAULT_MONTHS = 12;

// ---------------------------------------------------------------------------
// 99e-a. The arithmetic
// ---------------------------------------------------------------------------

/**
 * A clock time as minutes past midnight, or null.
 *
 * Takes what the three sources actually hand over: a Date (what a cell
 * formatted as a time reads back as), "9:30 AM" / "9:30am" / "9.30" (what
 * somebody types), and "14:15" (what an <input type="time"> submits). A bare
 * number is read as an hour, because "9" in a column headed Arrived is 9am and
 * nothing else.
 */
function parseVolunteerClockTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return null;
    return value.getHours() * 60 + value.getMinutes();
  }
  if (typeof value === 'number' && isFinite(value)) {
    // A spreadsheet time can arrive as a fraction of a day (0.5 = midday); an
    // ordinary number in this column is an hour.
    if (value > 0 && value < 1) return Math.round(value * 24 * 60);
    if (value >= 0 && value <= 24) return Math.round(value * 60);
    return null;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) return null;
  const match = text.match(/^(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(am|pm|a|p)?\.?$/);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3] ? match[3].charAt(0) : '';
  if (hours > 23 || minutes > 59) return null;
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Minutes past midnight back into "9:30 AM", for a report somebody reads. */
function formatVolunteerClockTime(value) {
  const minutes = parseVolunteerClockTime(value);
  if (minutes === null) return '';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  const shown = hours % 12 === 0 ? 12 : hours % 12;
  return `${shown}:${rest < 10 ? '0' : ''}${rest} ${meridiem}`;
}

/**
 * How long a visit was, in hours to two decimal places.
 *
 * THE TIMES WIN WHERE THERE ARE TWO OF THEM, because they are the evidence and
 * the typed number is a summary of it: a volunteer who stayed an hour longer
 * than usual has their departure time changed at the desk and nobody thinks to
 * change the total beside it.
 *
 * THE ONE REFUSAL: a departure at or before the arrival. That is somebody
 * typing 9 for 9pm or leaving a field half-edited, and reading it as a
 * negative afternoon or an overnight shift would put a wrong number into a
 * figure the centre is credited on. It falls back to the typed hours, and
 * `describeVolunteerHoursProblem()` is what says so on the tab.
 */
function volunteerVisitHours(arrived, departed, typedHours) {
  const from = parseVolunteerClockTime(arrived);
  const to = parseVolunteerClockTime(departed);
  if (from !== null && to !== null && to > from) {
    return Math.round(((to - from) / 60) * 100) / 100;
  }
  const typed = Number(typedHours);
  return isFinite(typed) && typed > 0 ? Math.round(typed * 100) / 100 : 0;
}

/**
 * What is wrong with a row's hours, in a sentence, or ''. Read by the dialog
 * before it writes and by the report after it reads, so the same row is
 * described the same way in both places.
 */
function describeVolunteerHoursProblem(row) {
  const from = parseVolunteerClockTime(row.arrived);
  const to = parseVolunteerClockTime(row.departed);
  if (from !== null && to !== null && to <= from) {
    return 'the departure time is not after the arrival time, so the hours below were used instead';
  }
  if ((from === null) !== (to === null)) {
    return 'only one of the two times is filled in, so the hours below were used instead';
  }
  if (!row.hours) return 'no hours — fill in both times, or type the hours';
  return '';
}

// ---------------------------------------------------------------------------
// 99e-b. Reading the tab
// ---------------------------------------------------------------------------

function volunteerHoursSheet(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  return create
    ? getOrCreateSheet(ss, SHEET_NAMES.VOLUNTEER_HOURS)
    : ss.getSheetByName(SHEET_NAMES.VOLUNTEER_HOURS);
}

/** The raw rows, in HEADERS.Volunteer_Hours order. Empty if the tab is not there yet. */
function readVolunteerHourRawRows(sheet) {
  const target = sheet || volunteerHoursSheet(false);
  if (!target) return [];
  try {
    return readSimpleTable(target, HEADERS.Volunteer_Hours);
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.VOLUNTEER_HOURS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/**
 * One sheet row -> one visit, or null for a row with nothing on it.
 *
 * A NAME AND A DATE ARE WHAT MAKE A ROW REAL. Hours of nobody, and a visit on
 * no day, are both a half-typed row somebody abandoned — counting either is
 * how a total stops being defensible.
 */
function parseVolunteerHourRow(row, map) {
  const name = String(row[map['Name']] || '').trim();
  const date = coerceDate(row[map['Date']]);
  if (!name || !date) return null;
  const arrived = row[map['Arrived']];
  const departed = row[map['Departed']];
  return {
    date,
    dateKey: formatDateKey(date),
    monthKey: formatMonthKey(date),
    name,
    // canonicalMemberName so a volunteer whose spelling was corrected on the
    // roll (77) totals as one person rather than two half-years.
    nameKey: normalizeNameKey(canonicalMemberName(name)),
    role: String(row[map['Role']] || '').trim(),
    program: String(row[map['Program']] || '').trim(),
    location: String(row[map['Location']] || '').trim(),
    arrived,
    departed,
    hours: volunteerVisitHours(arrived, departed, row[map['Hours']]),
    typedHours: Number(row[map['Hours']]) || 0,
    notes: String(row[map['Staff_Notes']] || '').trim(),
    id: String(row[map['Entry_ID']] || '').trim()
  };
}

/** Every visit on the tab, parsed, oldest first. */
function readVolunteerVisits(sheet) {
  const map = getIndexMap(HEADERS.Volunteer_Hours);
  return readVolunteerHourRawRows(sheet)
    .map(row => parseVolunteerHourRow(row, map))
    .filter(Boolean)
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : 0)));
}

// ---------------------------------------------------------------------------
// 99e-c. Writing the tab
// ---------------------------------------------------------------------------

/**
 * THE ONE WRITER. Every path that puts rows on this tab comes through here —
 * the dialog, the menu's refresh — so the tab cannot come back sorted one way
 * from one of them and another way from the next.
 *
 * NEWEST FIRST, which is the opposite of Regular_Needs beside it and
 * deliberate: this is a log, and the row somebody wants to see after pressing
 * the button is the one they just added.
 *
 * The Hours column is RECOMPUTED on every write where the times allow it,
 * which is what makes a departure time corrected on the tab correct the total
 * as well without anybody being told to.
 */
function writeVolunteerHoursTab(rows) {
  const sheet = volunteerHoursSheet(true);
  const headers = HEADERS.Volunteer_Hours;
  const map = getIndexMap(headers);

  const ordered = (rows || []).slice().filter(row => {
    const name = String(row[map['Name']] || '').trim();
    const date = coerceDate(row[map['Date']]);
    return name || date;   // a wholly blank row is the spare band, not a visit
  });

  ordered.forEach(row => {
    row[map['Hours']] = volunteerVisitHours(row[map['Arrived']], row[map['Departed']], row[map['Hours']]);
    if (!String(row[map['Entry_ID']] || '').trim()) row[map['Entry_ID']] = Utilities.getUuid();
  });

  ordered.sort((a, b) => {
    const left = coerceDate(a[map['Date']]);
    const right = coerceDate(b[map['Date']]);
    const leftKey = left ? formatDateKey(left) : '';
    const rightKey = right ? formatDateKey(right) : '';
    if (leftKey !== rightKey) return leftKey < rightKey ? 1 : -1;   // newest first
    return String(a[map['Name']] || '').localeCompare(String(b[map['Name']] || ''));
  });

  writeMemoryTab(sheet, headers, ordered, {
    banner: '🤝 Volunteer Hours',
    bannerNote: 'One row per volunteer VISIT — who was here, when they arrived, when they left, and ' +
      'what they were doing.\n\n' +
      'Hours are worked out from Arrived and Departed. A volunteer who worked away from the centre ' +
      `(Location "${VOLUNTEER_OFF_SITE_LOCATION}") leaves the times blank and types the Hours instead.\n\n` +
      'Program is for a volunteer attached to one — a class they lead, or the people they telephone ' +
      'about it. Leave it blank for the front desk, the kitchen and the office.\n\n' +
      'Nothing in this workbook writes to this tab on its own: it is yours, and it is what the ' +
      'annual volunteer report is counted from.',
    staffColumns: VOLUNTEER_HOURS_STAFF_COLUMNS,
    dateColumns: ['Date', 'Logged_On']
  });

  applyMemoryTabValidation(sheet, headers, ordered.length, {
    // OPEN, not restricted, and for the reason Regular_Needs' lists are: the
    // vocabulary is here to keep the common answers spelled one way, not to
    // refuse the role nobody thought of.
    openLists: {
      Role: VOLUNTEER_ROLES,
      Location: Object.values(CALENDAR_MAP).concat([VOLUNTEER_OFF_SITE_LOCATION]),
      Program: listKnownProgramTitles()
    }
  });

  // The join key, not something to read.
  applyColumnVisibility(sheet, headers, ['Entry_ID']);
  return ordered.length;
}

/** MENU ENTRY: redraw the tab from what is on it — sorting, hours and all. */
function refreshVolunteerHoursTab() {
  const count = withScriptLock(DESK_LOCK_WAIT_MS, () => writeVolunteerHoursTab(readVolunteerHourRawRows()), null);
  if (count === null) {
    toastIfPossible('The workbook is mid-update, so the volunteer hours were left alone. Try again in a minute.');
    return;
  }
  toastIfPossible(`Volunteer Hours: ${count} visit(s).`);
}

/** MENU ENTRY: open the tab, building it the first time somebody asks for it. */
function openVolunteerHoursTab() {
  const sheet = volunteerHoursSheet(false);
  if (!sheet) {
    writeVolunteerHoursTab([]);
    toastIfPossible('Created the Volunteer Hours tab.');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const target = ss.getSheetByName(SHEET_NAMES.VOLUNTEER_HOURS);
  if (target) ss.setActiveSheet(target);
}

// ---------------------------------------------------------------------------
// 99e-d. Logging one visit
// ---------------------------------------------------------------------------

/**
 * Called from the dialog (and from the Quick Mark panel, which opens it). One
 * visit onto the tab, under the desk lock like every other optimistic-looking
 * write in this project — the tab is rewritten whole, so a sync writing its
 * own copy alongside would lose the row.
 *
 * Returns a sentence for the dialog to show; a refusal starts with ⚠️, which
 * is the convention every other dialog here answers on.
 */
function logVolunteerVisit(payload) {
  const visit = payload || {};
  const name = String(visit.name || '').trim();
  if (!name) return '⚠️ Type who the volunteer is first.';
  const date = coerceDate(visit.date) || new Date();
  const hours = volunteerVisitHours(visit.arrived, visit.departed, visit.hours);
  if (!hours) {
    return '⚠️ No hours to record — fill in both times, or type the number of hours.';
  }

  const headers = HEADERS.Volunteer_Hours;
  const map = getIndexMap(headers);
  const written = withScriptLock(DESK_LOCK_WAIT_MS, () => {
    const rows = readVolunteerHourRawRows();
    const row = new Array(headers.length).fill('');
    row[map['Date']] = date;
    row[map['Name']] = name;
    row[map['Role']] = String(visit.role || '').trim();
    row[map['Program']] = String(visit.program || '').trim();
    row[map['Location']] = String(visit.location || '').trim();
    row[map['Arrived']] = formatVolunteerClockTime(visit.arrived);
    row[map['Departed']] = formatVolunteerClockTime(visit.departed);
    row[map['Hours']] = hours;
    // WHO TYPED IT, not who did the work. The dialog leaves this to the
    // signed-in account; the volunteer's own page (99f) passes it explicitly,
    // because a web app runs as the workbook's OWNER and would otherwise sign
    // every self-logged row with the office's address.
    row[map['Logged_By']] = String(visit.loggedBy || '').trim() || getCurrentUserEmail() || '';
    row[map['Logged_On']] = new Date();
    row[map['Staff_Notes']] = String(visit.notes || '').trim();
    row[map['Entry_ID']] = Utilities.getUuid();
    rows.push(row);
    writeVolunteerHoursTab(rows);
    return rows.length;
  }, null);

  if (written === null) {
    return '⚠️ The workbook is mid-update — try again in a moment. Nothing was recorded.';
  }
  const message = `Recorded ${hours} hour(s) for ${name} on ${formatDateLabel(date)}` +
    (visit.program ? ` (${String(visit.program).trim()})` : '') + '.';
  log(`logVolunteerVisit: ${message}`);
  return message;
}

// ---------------------------------------------------------------------------
// 99e-e. What it adds up to
// ---------------------------------------------------------------------------

/**
 * Every visit between two date keys, folded by person.
 *
 * Returns { from, to, totalHours, totalVisits, people: [{ name, hours, visits,
 * programs, offSiteHours }], programs: [{ program, hours, visits }] } — people
 * by hours worked, most first, which is the order the annual report is read in.
 */
function summarizeVolunteerHours(fromKey, toKey) {
  const visits = readVolunteerVisits().filter(visit =>
    (!fromKey || visit.dateKey >= fromKey) && (!toKey || visit.dateKey <= toKey));

  const byPerson = {};
  const byProgram = {};
  let totalHours = 0;

  visits.forEach(visit => {
    totalHours += visit.hours;
    const personKey = visit.nameKey || visit.name;
    if (!byPerson[personKey]) {
      byPerson[personKey] = { name: visit.name, hours: 0, visits: 0, offSiteHours: 0, programs: [] };
    }
    const person = byPerson[personKey];
    person.hours += visit.hours;
    person.visits++;
    if (visit.location === VOLUNTEER_OFF_SITE_LOCATION) person.offSiteHours += visit.hours;
    if (visit.program && person.programs.indexOf(visit.program) === -1) person.programs.push(visit.program);

    const programKey = visit.program || '(no program)';
    if (!byProgram[programKey]) byProgram[programKey] = { program: programKey, hours: 0, visits: 0 };
    byProgram[programKey].hours += visit.hours;
    byProgram[programKey].visits++;
  });

  const round = n => Math.round(n * 100) / 100;
  return {
    from: fromKey || '',
    to: toKey || '',
    totalHours: round(totalHours),
    totalVisits: visits.length,
    people: Object.keys(byPerson).map(k => byPerson[k])
      .map(p => ({ ...p, hours: round(p.hours), offSiteHours: round(p.offSiteHours) }))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name)),
    programs: Object.keys(byProgram).map(k => byProgram[k])
      .map(p => ({ ...p, hours: round(p.hours) }))
      .sort((a, b) => b.hours - a.hours)
  };
}

/**
 * The volunteer half of one calendar month, for the Metrics tab (83).
 *
 * Returns { volunteers, visits, hours } — DISTINCT PEOPLE, not visits, in the
 * first: "how many volunteers do you have" and "how many times did they come"
 * are the two different questions the year-end return asks, and one number
 * cannot answer both.
 */
function volunteerMetricsForMonth(monthKey, visits) {
  const rows = (visits || readVolunteerVisits()).filter(visit => visit.monthKey === monthKey);
  const people = {};
  let hours = 0;
  rows.forEach(visit => {
    people[visit.nameKey || visit.name] = true;
    hours += visit.hours;
  });
  return {
    volunteers: Object.keys(people).length,
    visits: rows.length,
    hours: Math.round(hours * 100) / 100
  };
}

/**
 * MENU ENTRY (Admin ▸ Reports). Read-only, and ungated like the reports beside
 * it: the person who has to answer to Judy for the year's hours is the person
 * who should be able to press it.
 */
function reportVolunteerHours() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - VOLUNTEER_REPORT_DEFAULT_MONTHS + 1, 1);
  const summary = summarizeVolunteerHours(formatDateKey(from), formatDateKey(now));
  const ui = SpreadsheetApp.getUi();

  if (summary.totalVisits === 0) {
    ui.alert('Volunteer Hours',
      `Nothing recorded between ${formatDateLabel(from)} and ${formatDateLabel(now)}.\n\n` +
      'Rosters & Sharing ▸ Log Volunteer Hours… is where a visit goes on.',
      ui.ButtonSet.OK);
    return;
  }

  const people = summary.people.slice(0, 30).map(person =>
    `• ${person.name} — ${person.hours} hour(s) over ${person.visits} visit(s)` +
    (person.offSiteHours > 0 ? ` (${person.offSiteHours} away from the centre)` : '') +
    (person.programs.length ? `\n    ${person.programs.join(', ')}` : '')).join('\n');

  ui.alert('Volunteer Hours',
    `${formatDateLabel(from)} – ${formatDateLabel(now)}\n\n` +
    `${summary.totalHours} hour(s), ${summary.totalVisits} visit(s), ` +
    `${summary.people.length} volunteer(s).\n\n${people}` +
    (summary.people.length > 30 ? `\n… and ${summary.people.length - 30} more on the tab.` : ''),
    ui.ButtonSet.OK);
}

// ---------------------------------------------------------------------------
// 99e-f. The dialog
// ---------------------------------------------------------------------------

/** MENU ENTRY: the form a visit is typed into. */
function showVolunteerHoursDialog() {
  const html = HtmlService.createHtmlOutput(buildVolunteerHoursHtml(volunteerDialogContext()))
    .setWidth(560)
    .setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Log Volunteer Hours');
}

/**
 * Everything the dialog draws itself from, in one read: who the workbook has
 * heard of, what the programs are called, the buildings, and the last few
 * visits so somebody can see their entry land.
 */
function volunteerDialogContext() {
  let names = [];
  try {
    names = collectKnownMembers();
  } catch (err) {
    log(`ℹ️ Volunteer dialog: could not read the member list (${err}) — typing a name still works.`);
  }
  const recent = readVolunteerVisits().slice(-8).reverse().map(visit =>
    `${formatDateLabel(visit.date)} — ${visit.name}, ${visit.hours} hour(s)` +
    (visit.role ? ` · ${visit.role}` : '') +
    (visit.program ? ` · ${visit.program}` : ''));

  let programs = [];
  try {
    programs = listKnownProgramTitles();
  } catch (err) {
    programs = [];
  }

  return {
    names: names.slice(0, 600),
    programs,
    locations: Object.values(CALENDAR_MAP).concat([VOLUNTEER_OFF_SITE_LOCATION]),
    roles: VOLUNTEER_ROLES,
    today: formatDateKey(new Date()),
    recent
  };
}

/**
 * The dialog's markup. Inline, like every other page in this project.
 *
 * EVERYTHING FROM THE WORKBOOK CROSSES INTO THE SCRIPT AS ONE DOUBLE-ENCODED
 * STRING and is written with textContent or through an option element's own
 * text — a volunteer named O'Brien, or a program called "Tai Chi </script>",
 * otherwise ends the page mid-sentence. Same rule as the door pages; see
 * tests/check_in_page.test.js.
 */
function buildVolunteerHoursHtml(context) {
  // "Tai Chi </script>" would otherwise end the script block in the middle of
  // the payload — \u003c is a valid JSON escape for "<", so the value survives
  // intact and the page does not. Same guard as 58 and 59.
  const payload = JSON.stringify(JSON.stringify(context || {})).replace(/</g, '\\u003c');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  label { display: block; margin-top: 8px; font-weight: bold; }
  input, select, textarea { width: 100%; box-sizing: border-box; padding: 6px; font-size: 13px;
                            border: 1px solid #ccc; border-radius: 4px; }
  .pair { display: flex; gap: 10px; }
  .pair > div { flex: 1; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  #recent { margin-top: 14px; border-top: 1px solid #eee; padding-top: 8px; color: #555; }
  #recent ul { margin: 4px 0 0 18px; padding: 0; }
</style>
<h3>Log volunteer hours</h3>
<p class="hint">
  One visit at a time. Fill in <b>Arrived</b> and <b>Departed</b> and the hours are worked out;
  for a volunteer working away from the centre, leave the times blank and type the hours.
</p>

<label for="name">Volunteer</label>
<input id="name" list="names" autocomplete="off" placeholder="Start typing a name">
<datalist id="names"></datalist>

<div class="pair">
  <div>
    <label for="date">Date</label>
    <input id="date" type="date">
  </div>
  <div>
    <label for="role">What were they doing?</label>
    <input id="role" list="roles" autocomplete="off" placeholder="e.g. Program Leader">
    <datalist id="roles"></datalist>
  </div>
</div>

<div class="pair">
  <div>
    <label for="program">Program (if any)</label>
    <input id="program" list="programs" autocomplete="off" placeholder="Leave blank for the desk or office">
    <datalist id="programs"></datalist>
  </div>
  <div>
    <label for="location">Where</label>
    <input id="location" list="locations" autocomplete="off">
    <datalist id="locations"></datalist>
  </div>
</div>

<div class="pair">
  <div>
    <label for="arrived">Arrived</label>
    <input id="arrived" type="time">
  </div>
  <div>
    <label for="departed">Left</label>
    <input id="departed" type="time">
  </div>
  <div>
    <label for="hours">or Hours</label>
    <input id="hours" type="number" min="0" step="0.25" placeholder="e.g. 2">
  </div>
</div>

<label for="notes">Notes</label>
<textarea id="notes" rows="2" placeholder="Anything the year-end report should know"></textarea>

<button id="go" onclick="submit()">Record this visit</button>
<div id="status"></div>
<div id="recent"><b>Last few visits</b><ul id="recentList"></ul></div>

<script>
  var CONTEXT = JSON.parse(${payload});

  function fill(listId, values) {
    var list = document.getElementById(listId);
    (values || []).forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;          // an attribute, never parsed as markup
      list.appendChild(option);
    });
  }
  fill('names', CONTEXT.names);
  fill('roles', CONTEXT.roles);
  fill('programs', CONTEXT.programs);
  fill('locations', CONTEXT.locations);
  document.getElementById('date').value = CONTEXT.today;
  drawRecent(CONTEXT.recent);

  function drawRecent(lines) {
    var list = document.getElementById('recentList');
    list.textContent = '';
    (lines || []).forEach(function (line) {
      var item = document.createElement('li');
      item.textContent = line;       // from the workbook — never innerHTML
      list.appendChild(item);
    });
  }

  function submit() {
    var name = document.getElementById('name').value.trim();
    if (!name) { say('Type who the volunteer is first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Recording\\u2026', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        var bad = msg.indexOf('\\u26a0') === 0;
        say(msg, bad ? 'err' : 'ok');
        if (!bad) clearForNext(name, msg);
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .logVolunteerVisit({
        name: name,
        date: document.getElementById('date').value,
        role: document.getElementById('role').value,
        program: document.getElementById('program').value,
        location: document.getElementById('location').value,
        arrived: document.getElementById('arrived').value,
        departed: document.getElementById('departed').value,
        hours: document.getElementById('hours').value,
        notes: document.getElementById('notes').value
      });
  }

  // READY FOR THE NEXT PERSON, not for the next edit of this one: the desk
  // logs volunteers in a batch at the end of an afternoon, and the date, the
  // role and the program are usually the same for all of them.
  function clearForNext(name, message) {
    ['name', 'arrived', 'departed', 'hours', 'notes'].forEach(function (id) {
      document.getElementById(id).value = '';
    });
    document.getElementById('name').focus();
    var list = document.getElementById('recentList');
    var item = document.createElement('li');
    item.textContent = message;
    list.insertBefore(item, list.firstChild);
  }

  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}
