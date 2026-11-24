// ============================================================================
// 99zzh. "WEEK 3 OF 8" ON THE CALENDAR, FOR A GROUPED PROGRAM
// ============================================================================
//
// A [Grouped] program (95) is a COURSE: one form, a run with a length. On the
// calendar each date looked like any other weekly class, so nobody reading the
// calendar could tell "the third meeting of an eight-week course" from "a
// Tuesday class". This writes `[Week N of M]` onto the end of each event TITLE
// of a grouped program. Calendar only: the session table, forms, rosters and
// public pages keep the clean title.
//
// WHY IT COSTS NO NEW FORM. Event_ID and the group key are built from the
// clean title, and parseEventTitle() (20) strips EVERY bracket before it builds
// one. So "Memoir Writing [Week 3 of 8]" has the same Event_ID, group and form
// as "Memoir Writing". parseSettingsBrackets() skips the bracket silently
// (isSeriesWeekLabelBracket), so it is never read as a tag or logged as a note.
//
// HOW A WEEK IS COUNTED. By the program's own DATES, not by the calendar's
// repeat rule. A rule is split by "this and following" edits, a make-up date
// is a one-off event, and an imported series has no readable rule at all. The
// dates on the session table (past and upcoming) plus the events in the sync
// window are the program, whatever produced them.
//   • A week is a Monday-to-Sunday week that holds at least one session, so a
//     twice-weekly course is "Week 1" on both days.
//   • A CANCELLATION keeps its number. Staff cancel by renaming the event
//     "CANCELLED…: Title" (99zzc). The event is still there, so its week still
//     counts, and the label goes on the cancelled event too.
//   • A CLOSURE skips a week. A week with no event takes no number: 1, 2, 3,
//     closure, then "Week 4" the week after.
//   • A gap longer than SERIES_WEEK_RUN_GAP_DAYS starts a new RUN at Week 1,
//     because the same course offered again in spring is a second course.
//
// FROZEN BY DEFAULT. A date DELETED from the calendar looks exactly like a
// closure, but is usually a cancellation somebody made the quick way. So a
// number, once given to a week, is kept: the weeks after it keep theirs, and
// "of 8" stays 8. That is Config's `Week_Numbering` = Freeze. Recount numbers
// from the dates as they are on every sync (a deleted date then closes the
// gap). Off writes no labels and takes ours back off. Each program can override
// the Config default, and can be recounted ONCE without changing its mode,
// from 📋 Coordinator ▸ Programs & Forms ▸ 🔢 Series Week Numbers…
//
// A date ADDED in the middle of a frozen run cannot be numbered without
// renumbering the weeks after it, which freezing promises not to do. It is
// left unlabelled and named in the office digest ("recount it if this was a
// closure discovered late"). A date added at the END is the next number, and
// "of M" grows with it.
//
// WHEN IT RUNS. At the end of a calendar sync that finished its window (21),
// inside the sync's quiet window, so the title writes neither mail guests
// (setEventTitleQuietly, 33) nor fire the calendar-edit triggers. And from the
// dialog when a mode changes. Capped per run (SERIES_WEEK_MAX_WRITES_PER_RUN);
// what is left is written by the next sync.
//
// THE LEDGER. SERIES_WEEK_LABELS_V1 in Document Properties (99zj: a store that
// grows per program belongs there). Per program: its mode override, and the
// frozen number of every week ever numbered. Pruned once a program's last week
// is SERIES_WEEK_PRUNE_DAYS gone.
//
// LIMIT. A program is one calendar + one title. A [Shared] grouped program
// that runs at two buildings is numbered per building.
// ============================================================================

const SERIES_WEEK_LABELS_PROP_KEY = 'SERIES_WEEK_LABELS_V1';
const SERIES_WEEK_NUMBERING_OPTIONS = ['Freeze', 'Recount', 'Off'];
const DEFAULT_SERIES_WEEK_NUMBERING = 'Freeze';
const SERIES_WEEK_RUN_GAP_DAYS = 35;
const SERIES_WEEK_MAX_WRITES_PER_RUN = 150;
const SERIES_WEEK_PRUNE_DAYS = 180;
// Matches our label anywhere in a title, with the space before it.
const SERIES_WEEK_LABEL_REGEX = /\s*\[\s*Week\s+\d+\s+of\s+\d+\s*\]/gi;

let __seriesWeekNumberingCache = null;

/** True for the inside of a "[Week 3 of 8]" bracket. */
function isSeriesWeekLabelBracket(content) {
  return /^\s*Week\s+\d+\s+of\s+\d+\s*$/i.test(String(content || ''));
}

/** "Memoir Writing [Week 3 of 8]" → "Memoir Writing". */
function stripSeriesWeekLabel(title) {
  return String(title || '').replace(SERIES_WEEK_LABEL_REGEX, '').replace(/\s+/g, ' ').trim();
}

/** The title an event should carry: ours replaced, everything else as typed. `label` '' takes ours off. */
function titleWithSeriesWeekLabel(rawTitle, label) {
  const base = stripSeriesWeekLabel(rawTitle);
  return label ? `${base} ${label}` : base;
}

function seriesWeekLabelText(week, total) {
  return `[Week ${week} of ${total}]`;
}

/** 'freeze' | 'recount' | 'off' for any spelling, or '' for nothing recognizable. */
function normalizeSeriesWeekMode(value) {
  const text = String(value || '').trim().toLowerCase();
  if (text === 'freeze' || text === 'frozen') return 'freeze';
  if (text === 'recount' || text === 'dynamic') return 'recount';
  if (text === 'off' || text === 'no') return 'off';
  return '';
}

/** Config's Week_Numbering, memoized for the execution. A blank or unreadable cell is Freeze. */
function getSeriesWeekNumberingDefault() {
  if (__seriesWeekNumberingCache !== null) return __seriesWeekNumberingCache;
  let mode = normalizeSeriesWeekMode(DEFAULT_SERIES_WEEK_NUMBERING);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CONFIG) : null;
    if (sheet) {
      const read = normalizeSeriesWeekMode(
        sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.SERIES_WEEK_LABELS.startCol).getValue());
      if (read) mode = read;
    }
  } catch (err) { /* the default is the answer */ }
  __seriesWeekNumberingCache = mode;
  return mode;
}

function invalidateSeriesWeekNumberingCache() {
  __seriesWeekNumberingCache = null;
}

function seedSeriesWeekLabelsRow(sheet) {
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.SERIES_WEEK_LABELS.startCol);
  if (String(cell.getValue() || '').trim() === '') cell.setValue(DEFAULT_SERIES_WEEK_NUMBERING);
  cell.setNote(
    'Adds "[Week 3 of 8]" to the calendar title of every date of a GROUPED program (one form for the ' +
    'whole run). Nothing else changes: same form, same registrations.\n\n' +
    'A cancelled date (renamed "CANCELLED…") keeps its number. A week with no event is a closure and ' +
    'takes no number.\n\n' +
    'Freeze (default): a number, once given, is kept, so deleting a date does not renumber the rest.\n' +
    'Recount: numbers come from the dates as they are now, on every sync.\n' +
    'Off: no labels, and the ones this added are taken back off.\n\n' +
    'Each program can be set differently, or recounted once: Coordinator ▸ Programs & Forms ▸ ' +
    'Series Week Numbers.');
}

// --- pure: the numbering ------------------------------------------------------

function seriesWeekDayGap_(fromKey, toKey) {
  const a = String(fromKey).split('-').map(Number);
  const b = String(toKey).split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/**
 * Pure. The week numbers for one program.
 *
 * dateKeys — every date of the program that exists now (cancelled ones included).
 * frozen   — { mondayKey: n } from the ledger ({} for none).
 * mode     — 'freeze' | 'recount'.
 *
 * Returns { byWeek: { monday: { week, total } }, frozen: { monday: n } (what to
 * store), unnumbered: [mondayKey] (dates added inside a frozen run) }.
 */
function computeSeriesWeekNumbers(dateKeys, frozen, mode) {
  const current = {};
  (dateKeys || []).forEach(key => { if (key) current[mondayOfDateKey_(key)] = true; });
  const kept = {};
  if (mode !== 'recount') {
    Object.keys(frozen || {}).forEach(w => {
      const n = Number(frozen[w]);
      if (n > 0) kept[w] = Math.floor(n);
    });
  }
  const all = Object.keys(Object.assign({}, kept, current)).sort();

  // Split into runs where consecutive weeks are more than the gap apart.
  const runs = [];
  all.forEach((week, i) => {
    if (i === 0 || seriesWeekDayGap_(all[i - 1], week) > SERIES_WEEK_RUN_GAP_DAYS) runs.push([]);
    runs[runs.length - 1].push(week);
  });

  const out = {};
  const unnumbered = [];
  runs.forEach(run => {
    // A frozen run that sits beside a new one keeps its numbers; numbering
    // restarts at 1 per run only for weeks no number was ever given to.
    let last = 0;
    const numbered = {};
    run.forEach((week, i) => {
      if (kept[week]) {
        numbered[week] = kept[week];
        last = Math.max(last, kept[week]);
        return;
      }
      const frozenLater = run.slice(i + 1).some(w => kept[w]);
      if (frozenLater) { unnumbered.push(week); return; }
      last += 1;
      numbered[week] = last;
      kept[week] = last;
    });
    const total = Math.max(0, ...Object.keys(numbered).map(w => numbered[w]));
    Object.keys(numbered).forEach(week => {
      if (current[week]) out[week] = { week: numbered[week], total };
    });
  });
  return { byWeek: out, frozen: kept, unnumbered };
}

// --- the ledger -----------------------------------------------------------------

function readSeriesWeekLedger() {
  try {
    const raw = readDocumentStoreProperty(SERIES_WEEK_LABELS_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && parsed.programs) return parsed;
  } catch (err) {
    log(`⚠️ Could not read the series week numbers (${err}) — numbering from the dates instead.`);
  }
  return { programs: {} };
}

function writeSeriesWeekLedger(ledger) {
  writeDocumentStoreProperty(SERIES_WEEK_LABELS_PROP_KEY, JSON.stringify(ledger));
}

/** One calendar + one title, the title with its CANCELLED word off. */
function seriesWeekProgramKey(calendarId, title) {
  const key = eventTitleMatchKey(stripProgramStatusPrefix(title));
  return key ? `${calendarId}|${key}` : '';
}

function seriesWeekModeFor_(entry) {
  return normalizeSeriesWeekMode(entry && entry.mode) || getSeriesWeekNumberingDefault();
}

// --- gathering the programs -----------------------------------------------------

function seriesWeekDateKey_(value) {
  const d = coerceDate(value);
  return d ? formatDateKey(d) : '';
}

/**
 * Every grouped program on the session table, with all its dates:
 * { key: { key, title, calendarId, location, dates: {dateKey: true} } }.
 */
function collectGroupedSeriesPrograms_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  if (!sheet) return {};
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');
  const programs = {};
  const datesByKey = {};
  rows.forEach(row => {
    const calendarId = String(row[map['Calendar_Source']] || '').trim();
    const title = String(row[map['Clean_Title']] || '').trim();
    const key = calendarId ? seriesWeekProgramKey(calendarId, title) : '';
    const dateKey = seriesWeekDateKey_(row[map['Event_Date']]);
    if (!key || !dateKey) return;
    (datesByKey[key] = datesByKey[key] || {})[dateKey] = true;
    if (!isGroupedTypeTag(row[map['Type_Tag']])) return;
    if (!programs[key]) {
      programs[key] = {
        key,
        title: stripProgramStatusPrefix(title),
        calendarId,
        location: String(row[map['Location']] || '').trim() || CALENDAR_MAP[calendarId] || '',
        dates: {}
      };
    }
  });
  Object.keys(programs).forEach(key => { programs[key].dates = datesByKey[key] || {}; });
  return programs;
}

// --- applying it ----------------------------------------------------------------

/**
 * Writes the labels onto the calendar events in the sync window. Never throws.
 * Call inside withCalendarChangeTriggersPaused() (the sync already is).
 * Returns { programs, written, cleared, unnumbered, deferred }.
 */
function applySeriesWeekLabels(options) {
  options = options || {};
  const result = { programs: 0, written: 0, cleared: 0, unnumbered: 0, deferred: 0 };
  try {
    const programs = collectGroupedSeriesPrograms_();
    const ledger = readSeriesWeekLedger();
    const todayKey = formatDateKey(new Date());

    const { start, end } = computeSyncDateRange();
    const byCalendar = getCalendarEventsForWindow(start, end) || {};
    const eventsByKey = {};
    Object.keys(byCalendar).forEach(calendarId => {
      (byCalendar[calendarId] || []).forEach(ev => {
        try {
          if (ev.isAllDayEvent && ev.isAllDayEvent()) return;
          const raw = String(ev.getTitle() || '');
          const parsed = parseEventTitle(raw);
          if (!parsed || parsed.isTentative) return;
          const key = seriesWeekProgramKey(calendarId, parsed.cleanTitle);
          if (!key) return;
          (eventsByKey[key] = eventsByKey[key] || []).push({ ev, raw, dateKey: formatDateKey(ev.getStartTime()) });
          if (programs[key]) programs[key].dates[formatDateKey(ev.getStartTime())] = true;
        } catch (err) { /* one unreadable event is not the whole calendar */ }
      });
    });

    const wanted = []; // { ev, raw, title }
    const unnumberedNotes = [];
    Object.keys(programs).forEach(key => {
      const program = programs[key];
      const entry = ledger.programs[key] || { weeks: {} };
      const mode = seriesWeekModeFor_(entry);
      result.programs++;
      const recountOnce = options.recountKey === key;
      const numbers = mode === 'off' ? null :
        computeSeriesWeekNumbers(Object.keys(program.dates), recountOnce ? {} : entry.weeks,
          recountOnce ? 'recount' : mode);
      if (numbers) {
        entry.weeks = numbers.frozen;
        numbers.unnumbered.forEach(week => {
          if (week >= mondayOfDateKey_(todayKey)) unnumberedNotes.push(`${program.title} (${program.location}), week of ${week}`);
        });
        result.unnumbered += numbers.unnumbered.length;
      }
      entry.title = program.title;
      entry.location = program.location;
      entry.lastWeek = Object.keys(program.dates).sort().pop() || entry.lastWeek || '';
      ledger.programs[key] = entry;
      (eventsByKey[key] || []).forEach(item => {
        const hit = numbers && numbers.byWeek[mondayOfDateKey_(item.dateKey)];
        const label = hit ? seriesWeekLabelText(hit.week, hit.total) : '';
        wanted.push({ ev: item.ev, raw: item.raw, title: titleWithSeriesWeekLabel(item.raw, label) });
      });
    });

    // A program we labelled that is no longer grouped: take our labels back off.
    Object.keys(ledger.programs).forEach(key => {
      if (programs[key]) return;
      (eventsByKey[key] || []).forEach(item => {
        if (stripSeriesWeekLabel(item.raw) !== item.raw.trim()) {
          wanted.push({ ev: item.ev, raw: item.raw, title: stripSeriesWeekLabel(item.raw) });
        }
      });
    });

    wanted.forEach(item => {
      if (item.title === item.raw.trim() || item.title === item.raw) return;
      if (result.written + result.cleared >= SERIES_WEEK_MAX_WRITES_PER_RUN) { result.deferred++; return; }
      try {
        setEventTitleQuietly(item.ev, item.title);
        if (stripSeriesWeekLabel(item.title) === item.title) result.cleared++;
        else result.written++;
      } catch (err) {
        log(`⚠️ Could not label "${item.raw}" (${err}).`);
      }
    });

    // Prune programs long finished.
    const pruneBefore = shiftDateKey_(todayKey, -SERIES_WEEK_PRUNE_DAYS);
    Object.keys(ledger.programs).forEach(key => {
      const entry = ledger.programs[key];
      if (!programs[key] && entry.lastWeek && entry.lastWeek < pruneBefore && !entry.mode) {
        delete ledger.programs[key];
      }
    });
    writeSeriesWeekLedger(ledger);

    if (unnumberedNotes.length) {
      spoolOfficeNote('Series week numbers',
        `A date was added between weeks that already have numbers, so it is left without one: ` +
        `${unnumberedNotes.join('; ')}. If a closure was found late, recount the program in ` +
        `Coordinator ▸ Programs & Forms ▸ Series Week Numbers.`, { oncePerDay: true });
    }
    if (result.written || result.cleared || result.deferred) {
      log(`Series week labels: ${result.written} written, ${result.cleared} taken off` +
        (result.deferred ? `, ${result.deferred} left for the next sync` : '') + '.');
    }
  } catch (err) {
    log(`⚠️ Series week labels were not updated this run (${err}).`);
    result.error = String(err);
  }
  return result;
}

// --- the dialog -----------------------------------------------------------------

/** What the dialog draws: every grouped program, its mode, and its upcoming labels. */
function listSeriesWeekPrograms() {
  const programs = collectGroupedSeriesPrograms_();
  const ledger = readSeriesWeekLedger();
  const todayKey = formatDateKey(new Date());
  return Object.keys(programs).map(key => {
    const program = programs[key];
    const entry = ledger.programs[key] || { weeks: {} };
    const mode = seriesWeekModeFor_(entry);
    const numbers = mode === 'off' ? null : computeSeriesWeekNumbers(Object.keys(program.dates), entry.weeks, mode);
    const upcoming = Object.keys(program.dates).sort().filter(d => d >= todayKey).map(d => {
      const hit = numbers && numbers.byWeek[mondayOfDateKey_(d)];
      return { date: d, label: hit ? `Week ${hit.week} of ${hit.total}` : (mode === 'off' ? 'off' : 'no number') };
    });
    return {
      key, title: program.title, location: program.location,
      override: normalizeSeriesWeekMode(entry.mode), upcoming
    };
  }).sort((a, b) => a.title.localeCompare(b.title) || a.location.localeCompare(b.location));
}

function showSeriesWeekNumbersDialog() {
  const programs = listSeriesWeekPrograms();
  if (programs.length === 0) {
    explainRefusal('There are no grouped programs on the session table. A program is grouped when its ' +
      'calendar event says [Grouped], or it repeats and ends after a set number of times.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildSeriesWeekNumbersHtml(programs, getSeriesWeekNumberingDefault()))
    .setWidth(640).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Series Week Numbers');
}

/** Runs the labeler now, if no sync holds the workbook. */
function applySeriesWeekLabelsNow_(options) {
  const lock = workbookLock('Series week numbers');
  if (!lock.tryLock(5000)) {
    return { ok: true, busy: true, message: 'Saved. A sync is running, so the calendar is relabelled when it finishes.' };
  }
  try {
    const result = withCalendarChangeTriggersPaused('series-week-labels', () => applySeriesWeekLabels(options));
    if (result.error) return { ok: false, message: `Saved, but the calendar could not be relabelled: ${result.error}` };
    return { ok: true, message: `Saved. ${result.written} title(s) labelled, ${result.cleared} label(s) taken off` +
      (result.deferred ? `, ${result.deferred} left for the next sync.` : '.') };
  } finally {
    lock.releaseLock();
  }
}

/** From the dialog: { key: 'freeze'|'recount'|'off'|'' } ('' = use Config's). */
function saveSeriesWeekSettings(changes) {
  const ledger = readSeriesWeekLedger();
  Object.keys(changes || {}).forEach(key => {
    const mode = normalizeSeriesWeekMode(changes[key]);
    const entry = ledger.programs[key] || { weeks: {} };
    if (mode) entry.mode = mode; else delete entry.mode;
    ledger.programs[key] = entry;
  });
  writeSeriesWeekLedger(ledger);
  return applySeriesWeekLabelsNow_({});
}

/** From the dialog: renumber one program from its dates as they are now, keeping its mode. */
function recountSeriesWeeksNow(key) {
  const result = applySeriesWeekLabelsNow_({ recountKey: String(key || '') });
  if (result.busy) {
    return { ok: false, message: 'A sync is running — try the recount again in a few minutes.' };
  }
  return result;
}

function buildSeriesWeekNumbersHtml(programs, defaultMode) {
  const payload = JSON.stringify(JSON.stringify({ programs, defaultMode })).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head><base target="_top"><style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  .p { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; }
  .t { font-weight: bold; } .loc { color: #666; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
  .dates { color: #444; margin-top: 6px; font-size: 12px; }
  button { padding: 6px 12px; } #status { margin-top: 10px; }
  .hint { color: #555; }
</style></head><body>
<p class="hint">Each grouped program's calendar titles end in "[Week N of M]". <b>Freeze</b> keeps a number once
given, so deleting a date does not renumber the rest. <b>Recount</b> numbers from the dates as they are on every
sync. <b>Recount once</b> renumbers this program now and keeps its setting.</p>
<div id="list"></div>
<button id="save" onclick="save()">Save</button>
<div id="status"></div>
<script>
  var DATA = JSON.parse(${payload});
  var LABELS = { freeze: 'Freeze', recount: 'Recount', off: 'Off' };
  function el(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  function draw() {
    var list = document.getElementById('list');
    DATA.programs.forEach(function (p) {
      var box = el('div', '', 'p');
      var head = el('div');
      head.appendChild(el('span', p.title, 't'));
      head.appendChild(el('span', ' · ' + p.location, 'loc'));
      box.appendChild(head);
      var row = el('div', '', 'row');
      var sel = document.createElement('select');
      sel.setAttribute('data-key', p.key);
      [['', 'Use Config (' + LABELS[DATA.defaultMode] + ')'], ['freeze', 'Freeze'], ['recount', 'Recount'], ['off', 'Off']]
        .forEach(function (o) { var opt = el('option', o[1]); opt.value = o[0]; if (o[0] === p.override) opt.selected = true; sel.appendChild(opt); });
      row.appendChild(sel);
      var once = el('button', 'Recount once');
      once.onclick = function () { recount(p.key); };
      row.appendChild(once);
      box.appendChild(row);
      var dates = p.upcoming.slice(0, 12).map(function (d) { return d.date + ': ' + d.label; }).join(' · ');
      box.appendChild(el('div', dates || 'No upcoming dates.', 'dates'));
      list.appendChild(box);
    });
  }
  function say(msg) { document.getElementById('status').textContent = msg; }
  function save() {
    var changes = {};
    var sels = document.querySelectorAll('select[data-key]');
    for (var i = 0; i < sels.length; i++) changes[sels[i].getAttribute('data-key')] = sels[i].value;
    say('Saving…');
    google.script.run.withSuccessHandler(function (r) { say(r.message); })
      .withFailureHandler(function (e) { say('Could not save: ' + e.message); }).saveSeriesWeekSettings(changes);
  }
  function recount(key) {
    say('Recounting…');
    google.script.run.withSuccessHandler(function (r) { say(r.message); })
      .withFailureHandler(function (e) { say('Could not recount: ' + e.message); }).recountSeriesWeeksNow(key);
  }
  draw();
</script></body></html>`;
}
