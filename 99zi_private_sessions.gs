// ============================================================================
// 99zi. PRIVATE SESSIONS — the appointments that are never on the calendar
// ============================================================================
//
// EVERY OTHER SESSION IN THIS WORKBOOK STARTS AS A CALENDAR EVENT, and that is
// exactly wrong for a few of them. Debbie's private counselling is booked one
// person at a time by Debbie; Gerry helps somebody with a computer on a
// Saturday. Neither should be advertised — not on the calendar, not on a form,
// not on the public page — and neither was counted anywhere, so the stats the
// county asks for (who was helped, when, for how long) had a hole exactly
// where the most personal help is (Caroline, October 2026).
//
// So this is a tab of its own, `Private_Sessions`, on the pattern of
// Volunteer_Hours (99e): staff-authored, ONE ROW PER PERSON HELPED PER
// SESSION, written only when somebody presses the button. A session with two
// people in it is two rows sharing a Session_ID, which is what lets the report
// count sessions once and people once. Nothing derives a row here, nothing
// reads this tab but the report and the monthly Metrics capture (83), and
// deleting it leaves every other behavior alone.
//
// WHY NOT A ROW ON All_Registrants: every row there hangs off an Event_ID, and
// a session row with no calendar event behind it is precisely what the sync
// treats as left over (84) or deleted (43). A row that looks like a mistake to
// three different passes is a row that will be cleaned up by one of them.
//
// The helper's own time can go on Volunteer_Hours in the same press (a tick,
// on by default), through logVolunteerVisit() — the one writer of that tab.
//
// Safe at the end for the usual reason: behavior plus its own constants, its
// schema (SHEET_NAMES.PRIVATE_SESSIONS, HEADERS.Private_Sessions,
// PRIVATE_SESSIONS_STAFF_COLUMNS) in 03, and everything it reaches for it
// reads at CALL time or through a hoisted function declaration.

/** Suggested program names. Open, like every list here — the next one nobody thought of is still typed. */
const PRIVATE_SESSION_PROGRAMS = [
  'Private Counseling', 'Computer Help', 'Medicare Counseling', 'Wills & Estate Planning'
];

/** How far back the report looks by default. */
const PRIVATE_SESSIONS_REPORT_MONTHS = 12;

/** A session longer than this is a typo ("30" for thirty minutes), refused rather than counted. */
const PRIVATE_SESSION_MAX_HOURS = 12;


// --- reading -----------------------------------------------------------------

function privateSessionsSheet(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  return create
    ? getOrCreateSheet(ss, SHEET_NAMES.PRIVATE_SESSIONS)
    : ss.getSheetByName(SHEET_NAMES.PRIVATE_SESSIONS);
}

function readPrivateSessionRawRows(sheet) {
  const target = sheet || privateSessionsSheet(false);
  if (!target) return [];
  try {
    return readSimpleTable(target, HEADERS.Private_Sessions);
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.PRIVATE_SESSIONS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/** One sheet row -> one attendance, or null for a row with no person or no date. */
function parsePrivateSessionRow(row, map) {
  const attendee = String(row[map['Attendee']] || '').trim();
  const date = coerceDate(row[map['Date']]);
  if (!attendee || !date) return null;
  const hours = volunteerVisitHours(row[map['Start']], row[map['End']], row[map['Hours']]);
  return {
    date,
    dateKey: formatDateKey(date),
    monthKey: formatMonthKey(date),
    program: String(row[map['Program']] || '').trim() || '(no program)',
    helper: String(row[map['Helper']] || '').trim(),
    attendee,
    attendeeKey: normalizeNameKey(canonicalMemberName(attendee)),
    location: String(row[map['Location']] || '').trim(),
    hours,
    // A row typed by hand with no Session_ID is its own session.
    sessionId: String(row[map['Session_ID']] || '').trim() ||
      String(row[map['Entry_ID']] || '').trim() || `${formatDateKey(date)}|${attendee}`
  };
}

function readPrivateSessions(sheet) {
  const map = getIndexMap(HEADERS.Private_Sessions);
  return readPrivateSessionRawRows(sheet)
    .map(row => parsePrivateSessionRow(row, map))
    .filter(Boolean);
}


// --- writing -----------------------------------------------------------------

/** THE ONE WRITER, newest first — it is a log, and the row wanted is the one just added. */
function writePrivateSessionsTab(rows) {
  const sheet = privateSessionsSheet(true);
  const headers = HEADERS.Private_Sessions;
  const map = getIndexMap(headers);

  const ordered = (rows || []).slice().filter(row =>
    String(row[map['Attendee']] || '').trim() || coerceDate(row[map['Date']]));

  ordered.forEach(row => {
    row[map['Hours']] = volunteerVisitHours(row[map['Start']], row[map['End']], row[map['Hours']]);
    if (!String(row[map['Entry_ID']] || '').trim()) row[map['Entry_ID']] = Utilities.getUuid();
  });

  ordered.sort((a, b) => {
    const left = coerceDate(a[map['Date']]);
    const right = coerceDate(b[map['Date']]);
    const leftKey = left ? formatDateKey(left) : '';
    const rightKey = right ? formatDateKey(right) : '';
    if (leftKey !== rightKey) return leftKey < rightKey ? 1 : -1;
    return String(a[map['Attendee']] || '').localeCompare(String(b[map['Attendee']] || ''));
  });

  writeMemoryTab(sheet, headers, ordered, {
    banner: '🔒 Private Sessions',
    bannerNote: 'Appointments that are NOT on the calendar and never should be — private counselling, ' +
      'weekend computer help. One row per PERSON helped per session; two people in one session are two ' +
      'rows with the same Session_ID.\n\n' +
      'Hours are worked out from Start and End, or typed when there were no times.\n\n' +
      'Nothing here is published anywhere: not on the calendar, a form or the public page. It is counted ' +
      'on the Metrics tab and in the Health panel ▸ Private Sessions.',
    staffColumns: PRIVATE_SESSIONS_STAFF_COLUMNS,
    dateColumns: ['Date', 'Logged_On']
  });

  applyMemoryTabValidation(sheet, headers, ordered.length, {
    openLists: {
      Program: privateSessionProgramChoices_(),
      Location: Object.values(CALENDAR_MAP).concat([VOLUNTEER_OFF_SITE_LOCATION])
    }
  });
  applyColumnVisibility(sheet, headers, ['Session_ID', 'Entry_ID']);
  return ordered.length;
}

function privateSessionProgramChoices_() {
  let known = [];
  try { known = listKnownProgramTitles(); } catch (err) { known = []; }
  const seen = {};
  return PRIVATE_SESSION_PROGRAMS.concat(known).filter(title => {
    const key = String(title || '').trim().toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

/** The names in the dialog's "who was helped" box: one per line, or comma-separated. */
function parsePrivateSessionAttendees(text) {
  const seen = {};
  return String(text || '').split(/[\n,;]+/)
    .map(name => name.replace(/\s+/g, ' ').trim())
    .filter(name => {
      const key = normalizeNameKey(name);
      if (!name || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

/**
 * Called from the dialog. One session, one row per person helped, and —
 * when ticked — the helper's visit on Volunteer_Hours. Returns a sentence;
 * a refusal starts with ⚠️ like every other dialog here.
 */
function logPrivateSession(payload) {
  const p = payload || {};
  const attendees = parsePrivateSessionAttendees(p.attendees);
  if (!attendees.length) return '⚠️ Type who was helped first — nothing was recorded.';
  const program = String(p.program || '').trim();
  if (!program) return '⚠️ Say what kind of session it was — nothing was recorded.';
  const date = coerceVolunteerVisitDate(p.date);
  if (!date) return '⚠️ That date could not be read — nothing was recorded.';
  if (formatDateKey(date) > formatDateKey(new Date())) {
    return '⚠️ That date is in the future — record the session after it happens. Nothing was recorded.';
  }
  const hours = volunteerVisitHours(p.start, p.end, p.hours);
  if (!hours) return '⚠️ How long was it? Fill in both times, or type the hours. Nothing was recorded.';
  if (hours > PRIVATE_SESSION_MAX_HOURS) {
    return `⚠️ ${hours} hours is longer than any session — for minutes, type e.g. 0.5. Nothing was recorded.`;
  }

  const helper = String(p.helper || '').trim();
  const location = String(p.location || '').trim() || VOLUNTEER_OFF_SITE_LOCATION;
  const headers = HEADERS.Private_Sessions;
  const map = getIndexMap(headers);
  const sessionId = Utilities.getUuid();

  const written = withScriptLock(DESK_LOCK_WAIT_MS, () => {
    const rows = readPrivateSessionRawRows();
    attendees.forEach(name => {
      const row = new Array(headers.length).fill('');
      row[map['Date']] = date;
      row[map['Program']] = program;
      row[map['Helper']] = helper;
      row[map['Attendee']] = name;
      row[map['Location']] = location;
      row[map['Start']] = formatVolunteerClockTime(p.start);
      row[map['End']] = formatVolunteerClockTime(p.end);
      row[map['Hours']] = hours;
      row[map['Logged_By']] = getCurrentUserEmail() || '';
      row[map['Logged_On']] = new Date();
      row[map['Staff_Notes']] = String(p.notes || '').trim();
      row[map['Session_ID']] = sessionId;
      row[map['Entry_ID']] = Utilities.getUuid();
      rows.push(row);
    });
    writePrivateSessionsTab(rows);
    return true;
  }, null);
  if (written === null) return '⚠️ The workbook is mid-update — try again in a moment. Nothing was recorded.';

  // The helper's time, through the volunteer tab's own writer. After the
  // session is safely down, and its failure said rather than thrown: the
  // session is the record somebody asked for.
  let volunteerNote = '';
  if (p.logHelperHours && helper) {
    const said = logVolunteerVisit({
      name: helper, date: formatDateKey(date), program, location,
      arrived: p.start, departed: p.end, hours: p.hours,
      role: 'Program Leader', notes: `Private session (${attendees.length} person${attendees.length === 1 ? '' : 's'}).`
    });
    volunteerNote = String(said).indexOf('⚠️') === 0
      ? ` The helper's volunteer hours were NOT recorded: ${said.replace(/^⚠️\s*/, '')}`
      : ` ${helper}'s volunteer hours are recorded too.`;
  }

  const who = attendees.length === 1 ? attendees[0] : `${attendees.length} people`;
  const message = `Recorded ${program} for ${who} on ${formatDateLabel(date)} — ${hours} hour(s)` +
    (helper ? ` with ${helper}` : '') + `.${volunteerNote}`;
  log(`logPrivateSession: ${message}`);
  return message;
}


// --- what it adds up to --------------------------------------------------------

/**
 * Sessions counted ONCE (by Session_ID), people counted ONCE, and hours summed
 * per SESSION — an hour with two people in it is one hour of help, not two.
 */
function summarizePrivateSessions(entries) {
  const sessions = {};
  const people = {};
  (entries || []).forEach(entry => {
    if (!sessions[entry.sessionId]) sessions[entry.sessionId] = entry.hours;
    people[entry.attendeeKey || entry.attendee] = true;
  });
  const hours = Object.keys(sessions).reduce((sum, id) => sum + (sessions[id] || 0), 0);
  return {
    sessions: Object.keys(sessions).length,
    people: Object.keys(people).length,
    attendances: (entries || []).length,
    hours: Math.round(hours * 100) / 100
  };
}

/** The Metrics tab's three columns for one month (83). */
function privateSessionMetricsForMonth(monthKey, entries) {
  return summarizePrivateSessions((entries || []).filter(entry => entry.monthKey === monthKey));
}

/** HEALTH PANEL (99zm) ▸ Private Sessions. Read-only and ungated, like the volunteer report beside it. */
function reportPrivateSessions() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - PRIVATE_SESSIONS_REPORT_MONTHS + 1, 1);
  const fromKey = formatDateKey(from);
  const entries = readPrivateSessions().filter(entry => entry.dateKey >= fromKey);
  if (!entries.length) {
    presentReport_('Private Sessions', `Nothing recorded since ${formatDateLabel(from)}.\n\n` +
      'Desk ▸ Log a Private Session… is where one goes on.');
    return;
  }
  const total = summarizePrivateSessions(entries);
  const byProgram = {};
  entries.forEach(entry => { (byProgram[entry.program] = byProgram[entry.program] || []).push(entry); });
  const byMonth = {};
  entries.forEach(entry => { (byMonth[entry.monthKey] = byMonth[entry.monthKey] || []).push(entry); });

  const programLines = Object.keys(byProgram).sort().map(name => {
    const s = summarizePrivateSessions(byProgram[name]);
    return `• ${name} — ${s.sessions} session(s), ${s.people} person(s), ${s.hours} hour(s)`;
  }).join('\n');
  const monthLines = Object.keys(byMonth).sort().reverse().map(month => {
    const s = summarizePrivateSessions(byMonth[month]);
    return `• ${month} — ${s.sessions} session(s), ${s.people} person(s), ${s.hours} hour(s)`;
  }).join('\n');

  presentReport_('Private Sessions',
    `${formatDateLabel(from)} – ${formatDateLabel(now)}\n\n` +
    `${total.sessions} session(s), ${total.people} different person(s), ${total.hours} hour(s).\n\n` +
    `By program:\n${programLines}\n\nBy month:\n${monthLines}`);
}

/** MENU ENTRY: open the tab, building it the first time. */
function openPrivateSessionsTab() {
  if (!privateSessionsSheet(false)) {
    writePrivateSessionsTab([]);
    toastIfPossible('Created the Private Sessions tab.');
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const target = ss.getSheetByName(SHEET_NAMES.PRIVATE_SESSIONS);
  if (target) ss.setActiveSheet(target);
}


// --- the dialog -----------------------------------------------------------------

/** MENU ENTRY. */
function showPrivateSessionDialog() {
  const html = HtmlService.createHtmlOutput(buildPrivateSessionHtml(privateSessionDialogContext()))
    .setWidth(560)
    .setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'Log a Private Session');
}

function privateSessionDialogContext() {
  let names = [];
  try { names = collectKnownMembers(); } catch (err) { names = []; }
  const recent = readPrivateSessions()
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : (a.dateKey > b.dateKey ? -1 : 0)))
    .slice(0, 8)
    .map(entry => `${formatDateLabel(entry.date)} — ${entry.program}: ${entry.attendee}` +
      (entry.helper ? ` (with ${entry.helper})` : '') + `, ${entry.hours} hour(s)`);
  return {
    names: names.slice(0, 600),
    programs: privateSessionProgramChoices_(),
    locations: [VOLUNTEER_OFF_SITE_LOCATION].concat(Object.values(CALENDAR_MAP)),
    today: formatDateKey(new Date()),
    recent
  };
}

/**
 * The dialog's markup. Everything from the workbook crosses as one
 * double-encoded string and is written with textContent or an option's value —
 * the same rule as 99e, for the same O'Brien.
 */
function buildPrivateSessionHtml(context) {
  const payload = JSON.stringify(JSON.stringify(context || {})).replace(/</g, '\\u003c');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  label { display: block; margin-top: 8px; font-weight: bold; }
  label.tick { font-weight: normal; }
  label.tick input { width: auto; margin-right: 6px; }
  input, select, textarea { width: 100%; box-sizing: border-box; padding: 6px; font-size: 13px;
                            border: 1px solid #ccc; border-radius: 4px; }
  .pair { display: flex; gap: 10px; }
  .pair > div { flex: 1; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button.small { margin-top: 4px; padding: 4px 10px; background: #5f6368; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
  #recent { margin-top: 14px; border-top: 1px solid #eee; padding-top: 8px; color: #555; }
  #recent ul { margin: 4px 0 0 18px; padding: 0; }
</style>
<h3>Log a private session</h3>
<p class="hint">
  For appointments that are <b>not</b> on the calendar — private counselling, weekend help.
  Nothing here is published anywhere; it is counted for the stats only.
</p>

<div class="pair">
  <div>
    <label for="program">Kind of session</label>
    <input id="program" list="programs" autocomplete="off" placeholder="e.g. Private Counseling">
    <datalist id="programs"></datalist>
  </div>
  <div>
    <label for="date">Date</label>
    <input id="date" type="date">
  </div>
</div>

<div class="pair">
  <div>
    <label for="helper">Who led it</label>
    <input id="helper" list="names" autocomplete="off" placeholder="e.g. Debbie Robinson">
  </div>
  <div>
    <label for="location">Where</label>
    <input id="location" list="locations" autocomplete="off">
    <datalist id="locations"></datalist>
  </div>
</div>

<label for="addName">Who was helped</label>
<div class="pair">
  <div style="flex:3"><input id="addName" list="names" autocomplete="off" placeholder="Start typing a name, then Add"></div>
  <div style="flex:1"><button class="small" type="button" onclick="addName()">Add</button></div>
</div>
<datalist id="names"></datalist>
<textarea id="attendees" rows="3" placeholder="One name per line"></textarea>

<div class="pair">
  <div><label for="start">Start</label><input id="start" type="time"></div>
  <div><label for="end">End</label><input id="end" type="time"></div>
  <div><label for="hours">or Hours</label><input id="hours" type="number" min="0" step="0.25" placeholder="e.g. 1"></div>
</div>

<label class="tick"><input type="checkbox" id="logHelper" checked>
  Also record the leader's time on <b>Volunteer Hours</b></label>

<label for="notes">Notes</label>
<textarea id="notes" rows="2" placeholder="Optional — kept on the tab, never published"></textarea>

<button id="go" onclick="submit()">Record this session</button>
<div id="status"></div>
<div id="recent"><b>Last few</b><ul id="recentList"></ul></div>

<script>
  var CONTEXT = JSON.parse(${payload});
  function el(id) { return document.getElementById(id); }
  function fill(listId, values) {
    var list = el(listId);
    (values || []).forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      list.appendChild(option);
    });
  }
  fill('names', CONTEXT.names);
  fill('programs', CONTEXT.programs);
  fill('locations', CONTEXT.locations);
  el('date').value = CONTEXT.today;
  el('location').value = CONTEXT.locations[0] || '';
  (CONTEXT.recent || []).forEach(function (line) { addRecent(line, false); });

  function addRecent(line, first) {
    var item = document.createElement('li');
    item.textContent = line;
    var list = el('recentList');
    if (first) list.insertBefore(item, list.firstChild); else list.appendChild(item);
  }

  function addName() {
    var name = el('addName').value.trim();
    if (!name) return;
    var box = el('attendees');
    box.value = (box.value.trim() ? box.value.trim() + '\\n' : '') + name;
    el('addName').value = '';
    el('addName').focus();
  }
  el('addName').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addName(); }
  });

  function submit() {
    if (el('addName').value.trim()) addName();
    el('go').disabled = true;
    say('Recording\\u2026', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        el('go').disabled = false;
        var bad = msg.indexOf('\\u26a0') === 0;
        say(msg, bad ? 'err' : 'ok');
        if (!bad) {
          ['attendees', 'start', 'end', 'hours', 'notes'].forEach(function (id) { el(id).value = ''; });
          addRecent(msg, true);
        }
      })
      .withFailureHandler(function (err) {
        el('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .logPrivateSession({
        program: el('program').value,
        date: el('date').value,
        helper: el('helper').value,
        location: el('location').value,
        attendees: el('attendees').value,
        start: el('start').value,
        end: el('end').value,
        hours: el('hours').value,
        logHelperHours: el('logHelper').checked,
        notes: el('notes').value
      });
  }

  function say(msg, cls) { el('status').textContent = msg; el('status').className = cls; }
</script>`;
}
