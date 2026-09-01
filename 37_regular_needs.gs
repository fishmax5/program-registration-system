// ============================================================================
// 6e. REGULAR NEEDS  (the standing notes a desk would otherwise have to know)
// ============================================================================
//
// "Put her meals in the fridge." "No milk." "Take-out, she brings her own
// containers." "One meal every World Affairs day." "Crab cake — she doesn't
// always come, order it anyway."
//
// Every one of those is real, every one of them belongs to a PERSON rather
// than to a registration, and every one of them was being carried in
// somebody's head or in a free-text Notes column on a spreadsheet nobody at
// the sign-in desk has open. When the person who knows is off that day, the
// meal goes out wrong.
//
// A REGULAR NEED IS A STANDING FACT PLUS WHEN IT APPLIES. The fact is a short
// line of text — deliberately from a shared vocabulary (REGULAR_NEED_PRESETS)
// so that "No Milk", "no milk" and "NO MILK!" are one thing and not three.
// The when is a recurrence:
//
//     Every time        whenever this person is marked for a matching session
//     Weekly            on the named weekdays ("Tue, Thu")
//     Every N weeks     the same, every other week / every third week
//     Monthly           the same day of the month as Starts
//     Specific dates    a listed handful
//     Once              one date and then done
//
// narrowed by LOCATION and PROGRAM, either of which may be blank for "any".
// A blank program with "Every time" is the plain standing note ("no milk,
// ever"); naming a program is what expresses "one meal every World Affairs
// day" without anybody having to know which Tuesdays those fall on.
//
// A blank NAME is allowed and means the whole session: "everybody on this
// trip needs a bagged lunch" is the same shape of fact.
//
// WHAT IT DOES, in two places and no others:
//   1. The Quick Mark dialog shows a person's needs the moment their name is
//      picked — before the mark, which is the only moment the note is any use.
//   2. A mark that lands stamps the needs that apply onto that row's
//      Admin_Notes, so the roster, the sign-in sheet and the kitchen list all
//      carry it without anybody re-typing it.
//
// It never changes a count, a status or a meal type. A need is something a
// person is told, not something the workbook decides.
// ============================================================================

/**
 * The shared vocabulary. Offered in the dialog and as an OPEN dropdown on the
 * tab — anything can still be typed, because the day somebody needs a note
 * this list has not thought of is the day the feature has to not be in the
 * way.
 *
 * Grouped the way the real notes group, which is what the groups were read
 * off: how the meal is handled, what is in it, when it is collected, and who
 * collects it.
 */
const REGULAR_NEED_PRESETS = [
  { group: 'Handling', text: 'Put meals in the fridge' },
  { group: 'Handling', text: 'Put meals in the freezer' },
  { group: 'Handling', text: 'If not picked up within 2 days, dispose of the meals' },
  { group: 'Handling', text: 'Take-out' },
  { group: 'Handling', text: 'Take-out — brings their own containers' },
  { group: 'Handling', text: 'Serve at 11:30 AM' },
  { group: 'Handling', text: 'If there are spare meals, offer 1' },
  { group: 'Handling', text: 'If there are spare meals, offer 2' },
  { group: 'Diet', text: 'No milk' },
  { group: 'Diet', text: 'No pork' },
  { group: 'Diet', text: 'No meat — vegetarian' },
  { group: 'Diet', text: 'No eggs / no omelets' },
  { group: 'Diet', text: 'No fruit cups' },
  { group: 'Diet', text: 'No roll (bread slices are fine)' },
  { group: 'Diet', text: 'No cold meals' },
  { group: 'Diet', text: 'Low fat, low salt' },
  { group: 'Standing order', text: 'Always order: crab cake' },
  { group: 'Standing order', text: 'Always order: baked fish' },
  { group: 'Attendance', text: 'Does not always come — order anyway' },
  { group: 'Attendance', text: 'Currently on hiatus' },
  { group: 'Pick-up', text: 'Somebody else collects for them' },
  { group: 'Pick-up', text: 'They collect for somebody else' }
];

/** How often a need applies. The vocabulary of the Frequency column. */
const REGULAR_NEED_FREQUENCIES = [
  'Every time', 'Weekly', 'Every N weeks', 'Monthly', 'Specific dates', 'Once'
];

/** Sun-first, matching Date.getDay(). */
const REGULAR_NEED_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** What a need is ABOUT, so a dozen of them on one tab can be read at a glance. */
const REGULAR_NEED_KINDS = ['Handling', 'Diet', 'Standing order', 'Attendance', 'Pick-up', 'Note'];

const REGULAR_NEEDS_STAFF_COLUMNS = [
  'Need', 'Kind', 'Quantity', 'Frequency', 'Weekdays', 'Interval', 'Dates',
  'Starts', 'Ends', 'Active', 'Auto_Note', 'Staff_Notes'
];

/**
 * Parses whatever is in the Weekdays cell into day NUMBERS.
 *
 * Deliberately loose, because this column is typed by hand and the real
 * spreadsheets it comes from say "Every Tues, Thurs", "Tues -- Fri Every
 * Week", "Thursdays ONLY" and "Mon/Wed/Fri". Anything that starts with the
 * three letters of a weekday counts, separators are whatever was to hand, and
 * a RANGE ("Tue - Fri") expands — writing five days out is exactly the sort of
 * chore that makes somebody stop using the tab.
 */
function parseNeedWeekdays(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const found = [];
  const push = day => { if (found.indexOf(day) === -1) found.push(day); };

  // The tokens, in order, so a range knows what it is between.
  const tokens = [];
  const re = /(sun|mon|tue|wed|thu|fri|sat)[a-z]*|(-{1,2}|–|—|\bto\b|\bthrough\b)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1]) tokens.push({ day: REGULAR_NEED_WEEKDAYS.indexOf(m[1][0].toUpperCase() + m[1].substring(1).toLowerCase()) });
    else tokens.push({ range: true });
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.day === undefined) continue;
    const prev = tokens[i - 1];
    const before = tokens[i - 2];
    if (prev && prev.range && before && before.day !== undefined) {
      // "Tue - Fri": everything from the day before the dash to this one,
      // wrapping through the end of the week if it has to.
      let cursor = before.day;
      for (let guard = 0; guard < 7; guard++) {
        cursor = (cursor + 1) % 7;
        push(cursor);
        if (cursor === token.day) break;
      }
      continue;
    }
    push(token.day);
  }
  return found.sort((a, b) => a - b);
}

/** The Dates cell as date keys: "9/16/2026, 2026-09-23" -> ['2026-09-16', '2026-09-23']. */
function parseNeedDates(value) {
  return String(value || '')
    .split(/[,;\n]/)
    .map(part => coerceDate(part.trim()))
    .filter(Boolean)
    .map(formatDateKey);
}

/**
 * ONE NEED, ONE DATE: does it apply?
 *
 * Pure, and the whole of the recurrence rule — everything else about this
 * feature is reading rows and writing notes. `need` is the shape
 * readRegularNeedRows() produces.
 *
 * The window (Starts/Ends) is checked FIRST and for every frequency, so
 * "no milk, until she finishes the course of antibiotics" is expressible
 * against any of them rather than being its own special case.
 */
function regularNeedAppliesOn(need, date) {
  const when = coerceDate(date);
  if (!need || !when || need.active === false) return false;
  const dateKey = formatDateKey(when);
  if (need.startsKey && dateKey < need.startsKey) return false;
  if (need.endsKey && dateKey > need.endsKey) return false;

  const frequency = String(need.frequency || '').trim();
  const weekdays = need.weekdays || [];

  // A weekday list is honoured under EVERY frequency, not only under Weekly.
  // "Every time, but only on Thursdays" is a thing people write, and refusing
  // to read it would send a meal out on a Tuesday.
  if (weekdays.length > 0 && weekdays.indexOf(when.getDay()) === -1) return false;

  switch (frequency) {
    case 'Once':
      return !!need.startsKey && dateKey === need.startsKey;

    case 'Specific dates':
      return (need.dates || []).indexOf(dateKey) !== -1;

    case 'Monthly': {
      // The same day of the month as it started on. A need that started on the
      // 31st applies on the last day of a shorter month rather than skipping
      // it — "the end of the month" is what somebody who picked the 31st meant.
      const start = need.startsKey ? parseDateKey(need.startsKey) : null;
      if (!start) return weekdays.length > 0; // no anchor: a weekday list is all there is to go on
      const last = new Date(when.getFullYear(), when.getMonth() + 1, 0).getDate();
      return when.getDate() === Math.min(start.getDate(), last);
    }

    case 'Every N weeks': {
      const interval = Math.max(1, Math.round(Number(need.interval) || 1));
      if (interval === 1) return true; // every week, which the weekday list has already narrowed
      const start = need.startsKey ? parseDateKey(need.startsKey) : null;
      if (!start) return true; // nothing to count from; every week is the honest reading
      // Counted in whole weeks from the START OF ITS WEEK, so every day of an
      // "on" week is on — otherwise "every other Tue and Thu" would put the
      // Tuesday in one fortnight and the Thursday in the next.
      const weeksApart = Math.floor((startOfWeek(when) - startOfWeek(start)) / (7 * 24 * 60 * 60 * 1000));
      return weeksApart >= 0 && weeksApart % interval === 0;
    }

    case 'Weekly':
      // Weekly with no weekday named means the weekday it started on.
      if (weekdays.length > 0) return true;
      if (!need.startsKey) return true;
      return parseDateKey(need.startsKey).getDay() === when.getDay();

    case 'Every time':
    default:
      return true;
  }
}

/** Local midnight on the Sunday of `date`'s week — the anchor "every N weeks" counts from. */
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/**
 * Every need that applies to one person on one session.
 *
 * A need with no NAME applies to everybody on a matching session; one with no
 * PROGRAM or no LOCATION applies at any. Matching on the loose name key
 * (normalizeNameKey) for the same reason every other name comparison in this
 * file does: "Jane Smith" and "jane  smith " are one person.
 */
function regularNeedsFor(needs, context) {
  const nameKey = normalizeNameKey((context && context.name) || '');
  const location = String((context && context.location) || '').trim();
  const title = String((context && context.title) || '').trim();
  const date = context && context.date;
  return (needs || []).filter(need => {
    if (need.nameKey && need.nameKey !== nameKey) return false;
    if (need.location && location && need.location !== location) return false;
    if (need.program && title && need.program !== title) return false;
    // A need pinned to a program must not leak onto a session whose
    // program we could not name — that is how "one meal every World Affairs
    // day" becomes a meal every day.
    if (need.program && !title) return false;
    return regularNeedAppliesOn(need, date);
  });
}

/**
 * Writes onto `row`'s Admin_Notes every regular need that applies to this
 * person on this session, and returns the clause to append to the message.
 *
 * WHY IT IS WRITTEN AND NOT JUST SHOWN. The dialog shows the needs to the
 * person doing the marking, which is the only moment they can act on them.
 * But the meal is packed by somebody else, off a roster printed later, and
 * that person never saw the dialog — so the fact has to end up ON THE ROW,
 * where the roster, the sign-in sheet and the kitchen list all read from.
 *
 * NEVER DUPLICATED. The same need stamped on every one of thirty marks would
 * turn Admin_Notes into a wall by Thursday, so a need already in the cell is
 * left exactly as it is.
 */
function stampRegularNeedsOnRow(sheet, map, sheetRow, needs) {
  const applicable = (needs || []).filter(need => need.autoNote !== false);
  if (applicable.length === 0 || map['Admin_Notes'] === undefined) return '';
  const cell = sheet.getRange(sheetRow, map['Admin_Notes'] + 1);
  const existing = String(cell.getValue() || '').trim();
  const added = applicable
    .map(describeRegularNeed)
    .filter(text => existing.indexOf(text) === -1);
  if (added.length === 0) return '';
  cell.setValue([existing, ...added.map(text => `🔔 ${text}`)].filter(Boolean).join(' · '));
  return ` Noted: ${added.join('; ')}.`;
}

/** "Put meals in the fridge (×2)" — one need as one short line. */
function describeRegularNeed(need) {
  const quantity = Number(need && need.quantity) || 0;
  return `${need.need}${quantity > 1 ? ` (×${quantity})` : ''}`;
}

// ----------------------------------------------------------------------------
// The tab
// ----------------------------------------------------------------------------

/** Every row on Regular_Needs, parsed into the shape regularNeedAppliesOn() wants. */
function readRegularNeedRows(sheet) {
  const target = sheet || SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGULAR_NEEDS);
  if (!target) return [];
  try {
    return readSimpleTableValues(target, HEADERS.Regular_Needs).map(parseRegularNeedRow).filter(Boolean);
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.REGULAR_NEEDS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/**
 * One sheet row -> one need. Null for a row with nothing to say.
 *
 * The NEED TEXT is what makes a row real, not the name: a need with no name
 * applies to everybody on the matching session, which is a legitimate row.
 */
function parseRegularNeedRow(row) {
  const map = getIndexMap(HEADERS.Regular_Needs);
  const need = String(row[map['Need']] || '').trim();
  if (!need) return null;
  const name = String(row[map['Name']] || '').trim();
  const starts = coerceDate(row[map['Starts']]);
  const ends = coerceDate(row[map['Ends']]);
  return {
    name,
    nameKey: name ? normalizeNameKey(name) : '',
    need,
    kind: String(row[map['Kind']] || '').trim(),
    quantity: Number(row[map['Quantity']]) || 0,
    location: String(row[map['Location']] || '').trim(),
    program: String(row[map['Program']] || '').trim(),
    frequency: String(row[map['Frequency']] || '').trim() || 'Every time',
    weekdays: parseNeedWeekdays(row[map['Weekdays']]),
    interval: Number(row[map['Interval']]) || 0,
    dates: parseNeedDates(row[map['Dates']]),
    startsKey: starts ? formatDateKey(starts) : '',
    endsKey: ends ? formatDateKey(ends) : '',
    // Blank means ACTIVE. A row somebody typed and did not tick is a row they
    // meant — an opt-in checkbox here would mean every hand-typed need
    // silently does nothing, which is the one failure this tab cannot have.
    active: !isRegularNeedOff(row[map['Active']]),
    autoNote: !isRegularNeedOff(row[map['Auto_Note']]),
    id: String(row[map['Need_ID']] || '').trim()
  };
}

/** Only a deliberate NO turns a need off — see the `active` note above. */
function isRegularNeedOff(value) {
  if (value === false) return true;
  const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  return text === 'no' || text === 'false' || text === 'off';
}

/** Writes the tab: newest needs last, dropdowns on the vocabulary columns. */
function renderRegularNeedsSheet(allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.REGULAR_NEEDS);
  const headers = HEADERS.Regular_Needs;
  const map = getIndexMap(headers);
  const rows = (allRows || readRegularNeedRawRows(sheet)).slice();

  rows.sort((a, b) => {
    const nameA = String(a[map['Name']] || '');
    const nameB = String(b[map['Name']] || '');
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return String(a[map['Need']] || '').localeCompare(String(b[map['Need']] || ''));
  });

  writeMemoryTab(sheet, headers, rows, {
    banner: '🔔 Regular Needs',
    bannerNote: 'Standing facts about a person that the sign-in desk would otherwise have to already ' +
      'know — "put her meals in the fridge", "no milk", "one meal every World Affairs day".\n\n' +
      'Quick Mark shows them the moment a name is picked, and stamps them onto the row it marks.\n\n' +
      'Leave Location or Program blank for "any". Leave the whole When block blank for "every time".',
    staffColumns: REGULAR_NEEDS_STAFF_COLUMNS,
    dateColumns: ['Starts', 'Ends', 'Last_Applied', 'Added_On'],
    numberColumns: ['Quantity', 'Interval']
  });

  // Down the blank band as well as the data — the row that needs a dropdown is
  // the empty one somebody is about to type a standing need into. See
  // MEMORY_TAB_SPARE_ROWS.
  applyMemoryTabValidation(sheet, headers, rows.length, {
    checkboxes: ['Active', 'Auto_Note'],
    lists: { Frequency: REGULAR_NEED_FREQUENCIES, Kind: REGULAR_NEED_KINDS },
    // OPEN, not restricted: the shared vocabulary is there to keep the common
    // notes spelled one way, not to refuse the note nobody thought of. Program
    // joins them for the same reason it does on Program_Questions — it is
    // matched by exact text, so a title typed from memory silently matches
    // nothing.
    openLists: {
      Need: REGULAR_NEED_PRESETS.map(p => p.text),
      Location: Object.values(CALENDAR_MAP),
      Program: listKnownProgramTitles()
    }
  });

  // Need_ID is the join key, not something to read.
  applyColumnVisibility(sheet, headers, ['Need_ID']);
  return rows.length;
}

/** The raw rows, for a render that is only reordering what is already there. */
function readRegularNeedRawRows(sheet) {
  if (!sheet) return [];
  try {
    return readSimpleTable(sheet, HEADERS.Regular_Needs);
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.REGULAR_NEEDS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/**
 * Adds one need from the Quick Mark dialog, and says in plain words what it
 * will now do.
 *
 * APPENDED, NOT RE-RENDERED. A desk adding "no milk" mid-shift must not cost a
 * rewrite of the whole tab, and appending is also what keeps somebody's
 * half-typed row on the bottom line of the tab from being sorted out from
 * under them.
 */
function addRegularNeedFromDialog(args) {
  args = args || {};
  const need = String(args.need || '').trim();
  if (!need) return { ok: false, message: 'Nothing was added — a need needs some words in it.' };

  return withScriptLock(DESK_LOCK_WAIT_MS, () => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.REGULAR_NEEDS);
    const headers = HEADERS.Regular_Needs;
    const map = getIndexMap(headers);
    // A tab that has never been rendered has no header row to write under.
    if (sheet.getLastRow() < MEMORY_TAB_HEADER_ROW) renderRegularNeedsSheet([]);

    const name = String(args.name || '').trim();
    const row = new Array(headers.length).fill('');
    row[map['Name']] = name;
    row[map['Need']] = need;
    row[map['Kind']] = String(args.kind || 'Note').trim();
    row[map['Quantity']] = Number(args.quantity) || '';
    row[map['Location']] = String(args.location || '').trim();
    row[map['Program']] = String(args.program || '').trim();
    row[map['Frequency']] = REGULAR_NEED_FREQUENCIES.indexOf(String(args.frequency || '').trim()) !== -1
      ? String(args.frequency).trim()
      : 'Every time';
    row[map['Weekdays']] = String(args.weekdays || '').trim();
    row[map['Interval']] = Number(args.interval) || '';
    row[map['Dates']] = String(args.dates || '').trim();
    const starts = coerceDate(args.starts);
    const ends = coerceDate(args.ends);
    if (starts) row[map['Starts']] = starts;
    if (ends) row[map['Ends']] = ends;
    row[map['Active']] = true;
    row[map['Auto_Note']] = args.autoNote === false ? false : true;
    row[map['Added_By']] = getCurrentUserEmail() || 'the desk';
    row[map['Added_On']] = new Date();
    row[map['Need_ID']] = `RN-${Utilities.getUuid().substring(0, 8).toUpperCase()}`;

    const at = Math.max(sheet.getLastRow() + 1, MEMORY_TAB_DATA_ROW);
    if (sheet.getMaxRows() < at) sheet.insertRowsAfter(sheet.getMaxRows(), at - sheet.getMaxRows());
    sheet.getRange(at, 1, 1, headers.length).setValues([row]);
    ['Starts', 'Ends', 'Added_On'].forEach(h => {
      sheet.getRange(at, map[h] + 1, 1, 1).setNumberFormat(DATE_DISPLAY_FORMAT);
    });
    [map['Active'] + 1, map['Auto_Note'] + 1].forEach(col => {
      sheet.getRange(at, col, 1, 1)
        .setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build())
        .setHorizontalAlignment('center');
    });

    // The dialog is holding a copy of the need list — see getQuickMarkIndex().
    invalidateQuickMarkIndexCache();

    const message = `🔔 Noted for ${name || 'everyone on that session'}: ${need} — ` +
      `${describeNeedSchedule(parseRegularNeedRow(row))}.`;
    log(`addRegularNeedFromDialog: ${message}`);
    toastIfPossible(message);
    return { ok: true, message, stored: needForDialog(parseRegularNeedRow(row)) };
  }, { ok: false, message: 'Somebody else is writing to the desk tabs — try again in a moment.' });
}

/** "every Tue and Thu", "on 16 Sep", "every time" — the WHEN of a need, in words. */
function describeNeedSchedule(need) {
  if (!need) return 'every time';
  const days = (need.weekdays || []).map(d => REGULAR_NEED_WEEKDAYS[d]);
  const dayPhrase = days.length ? ` on ${days.join(', ')}` : '';
  const where = [
    need.program ? `every ${need.program}` : '',
    need.location ? `at ${need.location}` : ''
  ].filter(Boolean).join(' ');
  const window = [
    need.startsKey ? `from ${need.startsKey}` : '',
    need.endsKey ? `until ${need.endsKey}` : ''
  ].filter(Boolean).join(' ');

  let base;
  switch (need.frequency) {
    case 'Once': base = need.startsKey ? `once, on ${need.startsKey}` : 'once'; break;
    case 'Specific dates': base = `on ${(need.dates || []).join(', ') || 'the listed dates'}`; break;
    case 'Monthly': base = `monthly${dayPhrase}`; break;
    case 'Every N weeks': base = `every ${Math.max(1, Math.round(need.interval || 1))} weeks${dayPhrase}`; break;
    case 'Weekly': base = `weekly${dayPhrase || ''}`; break;
    default: base = days.length ? `every time${dayPhrase}` : 'every time';
  }
  return [base, where, need.frequency === 'Once' ? '' : window].filter(Boolean).join(', ');
}

/**
 * One need as the dialog wants it: what it says, when it says it, and the few
 * fields the browser needs to decide whether it applies to the name just
 * picked. Deliberately NOT the whole row — the dialog is not an editor for
 * this tab, and the fields it does not use are fields it cannot get wrong.
 */
function needForDialog(need) {
  return {
    text: describeRegularNeed(need),
    when: describeNeedSchedule(need),
    kind: need.kind || 'Note',
    nameKey: need.nameKey,
    location: need.location,
    program: need.program,
    frequency: need.frequency,
    weekdays: need.weekdays,
    dates: need.dates,
    startsKey: need.startsKey,
    endsKey: need.endsKey
  };
}

/** Joins a location and a session label into the key namesBySession is stored under. */
const QUICK_MARK_SESSION_KEY_SEPARATOR = '|~|';

/**
 * Joins a name and the appointment slot it holds into one dropdown value.
 *
 * A NAME IS NOT AN IDENTITY on a Personalized Assistance session: the same
 * person can hold 10:30 and 11:30 on the same afternoon, and a mark against
 * "Jane Smith" alone lands on whichever of her two rows sorts first. Carrying
 * the slot in the value is what makes the second one markable at all.
 *
 * Deliberately not a character a name or a time label can contain.
 */
const QUICK_MARK_NAME_TIME_SEPARATOR = '|@|';

/**
 * How long a stored index is served before it is rebuilt. Six hours is the
 * CacheService maximum, and the right number here for the same reason the
 * dialog was always allowed to work off a snapshot: a stale list can only ever
 * mean a NAME IS MISSING from a dropdown, never a mark landing on the wrong
 * row — the mark itself is still matched against the live sheet — and a
 * walk-in covers the missing name anyway. The ↻ link rebuilds on demand, and
 * every write that could add a name drops the entry (see
 * invalidateQuickMarkIndexCache()).
 */
/**
 * The most meals one Quick Mark can record in a single box. Not a rule about
 * what the workbook can hold — staff type any number onto the row — but the
 * same judgement MAX_EXTRA_MEALS makes about a control anybody can lean on: a
 * mistyped 200 in a hurry should not reach the kitchen's order.
 */
const QUICK_MARK_MAX_MEAL_COUNT = 20;

const QUICK_MARK_CACHE_SECONDS = 21600;
const QUICK_MARK_CACHE_KEY = 'QUICK_MARK_INDEX_V2';

/**
 * THE SHAPE of the stored index, stamped into every copy and checked on every
 * read. Bump it whenever buildQuickMarkIndex() starts producing a field the
 * dialog relies on.
 *
 * WHY THIS HAD TO EXIST. The index is kept in two places, and one of them is
 * durable: a CacheService entry that expires in six hours, and a hidden TAB
 * that expires never. Adding appointment TIMES to the index therefore did not
 * reach a workbook that already had a stored copy — getQuickMarkIndex() reads
 * cache, then tab, then builds, so the pre-times tab copy was found first,
 * copied back into the cache on the way past, and served to the desk for as
 * long as nobody ran a full rebuild. The dialog then had sessions with no
 * `times` and no `byAppointment`, and a Personalized Assistance session showed
 * no appointment times at all — the exact symptom, on exactly the workbooks
 * that had used Quick Mark before the feature landed.
 *
 * A durable store with no version is a bug that only appears after a deploy,
 * on somebody else's spreadsheet, which is the worst kind to be missing. So a
 * stored copy that does not carry the CURRENT stamp is not an index: both
 * readers drop it and the next open rebuilds.
 */
const QUICK_MARK_INDEX_SCHEMA = 3;
/**
 * CacheService caps one value at 100KB. The index for a workbook with a year
 * of history is bigger than that even gzipped, so it is stored as a manifest
 * key naming N chunk keys, written and read with putAll()/getAll() — one round
 * trip each way regardless of how many chunks there are.
 */
const QUICK_MARK_CACHE_CHUNK_CHARS = 90000;
const QUICK_MARK_CACHE_MAX_CHUNKS = 40;

