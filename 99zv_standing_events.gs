// ============================================================================
// 99zv. ALWAYS-OPEN EVENTS — a standing event that is on no calendar
// ============================================================================
//
// Numbered after `99zu` for the usual reason — never renumber, and this landed
// last. Safe there: behavior plus self-contained constants; its schema
// (`SHEET_NAMES.STANDING_EVENTS`, `HEADERS.Standing_Events`) lives in `03`, and
// everything it reaches for (`getOrCreateSheet` `07`, `readSimpleTable` `40`,
// `checkInLocations` `60`, `writeSectionBanner` `13`) it reads at CALL time or
// through a hoisted function declaration. Four earlier files call into it the
// same way: `38` (the Quick Mark choices, the mark and the walk-in row), `74`
// (the door's day) and `44` (the lunch count).
//
// WHAT THIS IS. Jigsaw Puzzles, Community Hour: a table in the corner that is
// simply THERE, every day the building is open. There is no calendar event to
// read a session off, no form, no capacity and no date — and so, until now,
// nothing to sign a walk-in IN to. This is the sibling of the [No Registration]
// tag for the case where the calendar has nothing to tag. It is timeless.
//
// HOW A DAY EXISTS. A row on `Standing_Events` (staff-owned, one per event per
// building) is turned into a SYNTHETIC SESSION for whichever date somebody
// signs in on, exactly as `buildLunchOnlySession()` (`38`) does for a meal with
// no programming: a real date and building, no calendar event, and an Event_ID
// that says so (`STANDING:<date>|<building>|<title>`). Nothing is written to the
// session table — it is a projection of the calendar and these are not on one —
// so no sync, triage, dashboard or form needs to learn about them. The only
// thing written is the registrant row of the person who signed in.
//
// A REAL SESSION ALWAYS WINS. If the calendar also has a session of the same
// title at that building on that date, the walk-in is recorded against it; the
// synthetic one is only used when there is nothing real to use. Retyping an
// always-open event onto the calendar therefore never splits its attendance.
//
// WHERE IT SHOWS. Quick Mark offers each one in a group of its own at the top
// of the session list, undated (`orderQuickMarkChoices`, `38`): the choice
// resolves to TODAY at the moment of the mark, never to "the nearest session",
// because the nearest "session" of an event that has none is last Thursday's
// row. The sign-in app lists it with the day's programs, first (`readWalkInDay`,
// `74`). Both skip the "no registration for this — add a new row?" question,
// since an always-open event has no registration to be missing.
//
// NO STANDING PLACE. "Every future session" means nothing for an event with no
// sessions, so it is refused in words rather than silently dropped.
// ============================================================================

/** Event_ID prefix of a sign-in against an always-open event. */
const STANDING_EVENT_ID_PREFIX = 'STANDING:';

const STANDING_EVENT_DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The group the Quick Mark session list files these under (first in the list). */
const STANDING_EVENT_CHOICE_GROUP = 'Open every day (no calendar)';

let __standingEventsMemo = null;

/** Dropped by every write here, so a new event is offered on the next read. */
function invalidateStandingEventsMemo_() {
  __standingEventsMemo = null;
}

function makeStandingEventId(dateKey, location, title) {
  return `${STANDING_EVENT_ID_PREFIX}${dateKey}|${String(location || '').trim()}|` +
    `${normalizeNameKey(title)}`;
}

function isStandingEventId(eventId) {
  return String(eventId || '').indexOf(STANDING_EVENT_ID_PREFIX) === 0;
}

/**
 * "Mon-Fri", "Tue, Thu", "Weekdays", "Every day", blank -> [0..6] day numbers,
 * or null for every day. A token it cannot read is ignored, and a cell that
 * names nothing it can read means EVERY day: an event that vanishes from the
 * desk because of a typo is the worse mistake, and staff see it at once.
 */
function parseStandingEventDays(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw || /^(every ?day|daily|all|7 days|any)$/.test(raw)) return null;
  if (/^week ?days?$/.test(raw)) return [1, 2, 3, 4, 5];
  if (/^week ?ends?$/.test(raw)) return [0, 6];
  const indexOf = token => STANDING_EVENT_DAY_NAMES.indexOf(token.slice(0, 3));
  const days = {};
  raw.split(/[,&/;]|\band\b/).forEach(part => {
    const piece = part.trim();
    if (!piece) return;
    const range = piece.split(/\s*(?:-|–|—|to)\s*/);
    if (range.length === 2 && indexOf(range[0]) !== -1 && indexOf(range[1]) !== -1) {
      let d = indexOf(range[0]);
      const end = indexOf(range[1]);
      for (let guard = 0; guard < 8; guard++) {
        days[d] = true;
        if (d === end) break;
        d = (d + 1) % 7;
      }
      return;
    }
    piece.split(/\s+/).forEach(word => {
      const i = word.length >= 3 ? indexOf(word) : -1;
      if (i !== -1) days[i] = true;
    });
  });
  const list = Object.keys(days).map(Number).sort((a, b) => a - b);
  return list.length ? list : null;
}

/**
 * Every ACTIVE always-open event, one entry per (event, building) — a row with
 * no Location is every building. Memoized per execution; NEVER CREATES THE TAB
 * AND NEVER THROWS: the door and the desk read this on every load, and a
 * workbook that has never used the feature costs them an empty list.
 */
function readStandingEvents() {
  if (__standingEventsMemo) return __standingEventsMemo;
  const out = [];
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.STANDING_EVENTS);
    if (sheet) {
      const headers = HEADERS.Standing_Events;
      const map = getIndexMap(headers);
      const seen = {};
      readSimpleTable(sheet, headers).forEach(row => {
        const title = String(row[map['Event']] || '').trim();
        if (!title) return;
        const active = String(row[map['Active']] === undefined ? '' : row[map['Active']]).trim().toLowerCase();
        if (active === 'false' || active === 'no' || active === 'n' || active === '0') return;
        const place = String(row[map['Location']] || '').trim();
        const locations = place ? [place] : checkInLocations();
        const days = parseStandingEventDays(row[map['Days_Open']]);
        const timeNote = String(row[map['Time_Note']] || '').trim();
        locations.forEach(location => {
          const key = `${location}\u0000${normalizeNameKey(title)}`;
          if (seen[key]) return;
          seen[key] = true;
          out.push({ title, location, days, timeNote, titleKey: normalizeNameKey(title) });
        });
      });
    }
  } catch (err) {
    log(`ℹ️ Could not read ${SHEET_NAMES.STANDING_EVENTS} (${err}).`);
  }
  __standingEventsMemo = out;
  return out;
}

/** Is this event open on the date? (`days` null = every day.) */
function standingEventOpenOn(event, dateKey) {
  if (!event) return false;
  if (!event.days) return true;
  const d = parseDateKey(dateKey);
  return !!d && event.days.indexOf(d.getDay()) !== -1;
}

/** The always-open events at one building (all of them when `location` is blank). */
function standingEventsAt(location) {
  const loc = String(location || '').trim();
  return readStandingEvents().filter(ev => !loc || ev.location === loc);
}

/**
 * The always-open event a Quick Mark/door choice names, or null. Matched on the
 * title worn down to a key, so a retyped space or capital does not lose it.
 */
function findStandingEvent(title, location) {
  const key = normalizeNameKey(title);
  if (!key) return null;
  return standingEventsAt(location).filter(ev => ev.titleKey === key)[0] || null;
}

/**
 * The synthetic session a walk-in at an always-open event is recorded against.
 * Same shape as `buildLunchOnlySession()` (`38`) plus `isStandingEvent`, which
 * is how the desk write knows to skip the "no registration" question and to
 * refuse a standing place.
 */
function buildStandingEventSession(event, dateKey, location) {
  const key = dateKey || formatDateKey(new Date());
  const loc = String(location || (event && event.location) || '').trim();
  if (!event || !loc) return null;
  return {
    date: parseDateKey(key),
    dateKey: key,
    location: loc,
    title: event.title,
    eventId: makeStandingEventId(key, loc, event.title),
    eventTime: event.timeNote || '',
    lunchType: '',
    isStandingEvent: true
  };
}

// ----------------------------------------------------------------------------
// The tab, and the two menu items that reach it
// ----------------------------------------------------------------------------

/**
 * The tab, drawn once and then LEFT ALONE: staff-owned, so nothing here clears,
 * re-sorts or reformats it after the first draw.
 */
function ensureStandingEventsTab_(ss) {
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(book, SHEET_NAMES.STANDING_EVENTS);
  const headers = HEADERS.Standing_Events;
  const existing = sheet.getLastRow() >= MEMORY_TAB_HEADER_ROW
    ? String(sheet.getRange(MEMORY_TAB_HEADER_ROW, 1).getValue() || '').trim() : '';
  if (existing) return sheet;
  if (sheet.getLastRow() > 0) {
    throw new Error(`"${SHEET_NAMES.STANDING_EVENTS}" has content but no header row — ` +
      'nothing was written. Rename that tab and try again.');
  }
  ensureSheetColumns(sheet, headers.length);
  writeSectionBanner(sheet, MEMORY_TAB_BANNER_ROW, headers.length,
    '♾️ Always-Open Events — on no calendar', {
      note: 'Events that are simply there every day — Jigsaw Puzzles, Community Hour. Each is ' +
        'offered first on Quick Mark and on the sign-in app on every day it is open, so walk-ins ' +
        'can be signed in with no registration. Location blank = every building. Days_Open blank ' +
        '= every day; or "Mon-Fri", "Tue, Thu". Untick Active to take one off the screens. ' +
        'Nothing here appears on the calendar or the public pages.'
    });
  writeSectionHeader(sheet, MEMORY_TAB_HEADER_ROW, headers.length, headers);
  try {
    const activeCol = headers.indexOf('Active') + 1;
    sheet.getRange(MEMORY_TAB_DATA_ROW, activeCol, Math.max(1, sheet.getMaxRows() - MEMORY_TAB_HEADER_ROW), 1)
      .insertCheckboxes();
  } catch (err) {
    log(`ℹ️ Could not put check boxes on ${SHEET_NAMES.STANDING_EVENTS} (${err}).`);
  }
  freezeRowsSafely(sheet, MEMORY_TAB_HEADER_ROW);
  return sheet;
}

/**
 * Adds one always-open event (the writer behind the menu item). Refuses a
 * duplicate of an event already on the tab at that building. Returns
 * { ok, message }.
 */
function addStandingEvent(title, location, daysOpen, timeNote) {
  const name = String(title || '').trim();
  if (!name) return { ok: false, message: 'Type the name of the event first — nothing was added.' };
  const loc = String(location || '').trim();
  const known = checkInLocations();
  if (loc && known.indexOf(loc) === -1) {
    return { ok: false, message: `"${loc}" is not one of your buildings (${known.join(', ')}). Nothing was added.` };
  }
  const sheet = ensureStandingEventsTab_();
  invalidateStandingEventsMemo_();
  const clash = readStandingEvents().filter(ev =>
    ev.titleKey === normalizeNameKey(name) && (!loc || ev.location === loc))[0];
  if (clash) {
    return { ok: false, message: `${name} is already an always-open event at ${clash.location}. Nothing was added.` };
  }
  const headers = HEADERS.Standing_Events;
  const map = getIndexMap(headers);
  const row = new Array(headers.length).fill('');
  row[map['Event']] = name;
  row[map['Location']] = loc;
  row[map['Days_Open']] = String(daysOpen || '').trim();
  row[map['Time_Note']] = String(timeNote || '').trim();
  row[map['Active']] = true;
  const target = Math.max(sheet.getLastRow() + 1, MEMORY_TAB_DATA_ROW);
  sheet.getRange(target, 1, 1, headers.length).setValues([row]);
  try { sheet.getRange(target, map['Active'] + 1).insertCheckboxes(); } catch (err) { /* cosmetic */ }
  invalidateStandingEventsMemo_();
  try { invalidateQuickMarkIndexCache(); } catch (err) { /* the next rebuild picks it up */ }
  return {
    ok: true,
    message: `✅ ${name} is now offered ${loc ? `at ${loc}` : 'at every building'} on Quick Mark and the ` +
      'sign-in app, every day it is open.'
  };
}

/** Menu: add an always-open event, by asking for its name and building. */
function showAddStandingEventDialog() {
  const ui = SpreadsheetApp.getUi();
  const named = ui.prompt('♾️ Add an Always-Open Event',
    'What is it called? (for example: Jigsaw Puzzles, Community Hour)', ui.ButtonSet.OK_CANCEL);
  if (named.getSelectedButton() !== ui.Button.OK) return;
  const buildings = checkInLocations();
  const where = ui.prompt('♾️ Which building?',
    `Type one of: ${buildings.join(', ')}\n\nLeave blank for every building.`, ui.ButtonSet.OK_CANCEL);
  if (where.getSelectedButton() !== ui.Button.OK) return;
  const typed = String(where.getResponseText() || '').trim();
  const location = buildings.filter(b => b.toLowerCase() === typed.toLowerCase())[0] || typed;
  const result = addStandingEvent(named.getResponseText(), location, '', '');
  ui.alert(result.ok
    ? `${result.message}\n\nTo limit it to certain days or add a time note, open "Always-Open Events" and edit its row.`
    : result.message);
}

/** Menu: open the tab (drawing it first if it does not exist yet). */
function showStandingEventsTab() {
  const sheet = ensureStandingEventsTab_();
  SpreadsheetApp.getActiveSpreadsheet().setActiveSheet(sheet);
}
