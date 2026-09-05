// ============================================================================
// 6b. PER-SHEET RENDER WRAPPERS  (Registrants / Triage / Lunch_Schedule)
// ============================================================================

function renderRegistrantsSheet(force, allRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  const headers = HEADERS.All_Registrants;
  const rows = allRows || getSectionedRows(sheet, headers, 'Event_ID');
  backfillRegistrantEventTimes(ss, headers, rows);
  // Same derived pair as the session table, keyed off this row's own program
  // and day — see 69_generated_file_links.gs.
  stampGeneratedFileLinks(rows, getIndexMap(headers), { titleColumn: 'Event' });
  return renderFlatDateSheet(sheet, headers, rows, {
    upcomingLabel: '⏳ Upcoming Registrants',
    pastLabel: '🕓 Past Registrants',
    // "10:00 AM" is words, not a time value — see stampTextColumns().
    textColumns: ['Event_Time'],
    force,
    afterWrite: applyRegistrantsFormatting
  });
}

/**
 * Fills Event_Time in on any row that hasn't got one, from the session table —
 * and turns any cell Sheets has already eaten back into the words it held.
 *
 * New rows are stamped at build time (buildRegistrantRow()), so this only ever
 * has work to do for rows written before the column existed — and for those it
 * is the difference between a column that fills in over months and one that is
 * simply right the first time anyone looks at it. Reads the session table only
 * when at least one row actually needs it, and never fails the render: a
 * missing time is cosmetic, and the tab is not.
 *
 * THE REPAIR IS THE SAME PASS. A session with no end time wrote its start
 * alone — "10:00 AM" — and Sheets turned that into a time value dated 30 Dec
 * 1899, which is what the column showed: the right date in Event_Date and
 * "12/30/1899" beside it. New writes can no longer be coerced (the column is
 * stamped as text before the rows land), but the cells already coerced read
 * back as Dates, and this is the render that puts their labels back. Done here
 * rather than in a one-off repair because every registrant render passes
 * through it, so the tab heals the first time anybody looks at it.
 */
function backfillRegistrantEventTimes(ss, headers, rows) {
  const map = getIndexMap(headers);
  if (map['Event_Time'] === undefined) return;
  rows.forEach(row => {
    const value = row[map['Event_Time']];
    const label = eventTimeLabelOf(value);
    if (label !== value) row[map['Event_Time']] = label;
  });
  const needy = rows.filter(row =>
    !String(row[map['Event_Time']] || '').trim() && String(row[map['Event_ID']] || '').trim());
  if (needy.length === 0) return;

  let timeByEventId;
  try {
    timeByEventId = buildEventTimeByEventId(ss);
  } catch (err) {
    log(`ℹ️ Could not read session times to fill in Event_Time (${err}) — the column stays blank on older rows.`);
    return;
  }
  needy.forEach(row => {
    const time = timeByEventId[String(row[map['Event_ID']] || '').trim()];
    if (time) row[map['Event_Time']] = time;
  });
}

/**
 * { Event_ID: "10:00 AM – 11:30 AM" } from the session table, memoized for the
 * execution.
 *
 * The memo is what keeps the backfill from costing anything on a settled
 * workbook. renderRegistrantsSheet() runs several times in one sync, and rows
 * whose session has aged off the dashboard NEVER get a time — so without this,
 * every one of those renders paid for a full re-read of the session table to
 * fill in nothing. Dropped by whatever rewrites the session table; see the
 * caching contract at the top of this file.
 */
let __eventTimeByEventIdCache = null;

function invalidateEventTimeIndex() {
  __eventTimeByEventIdCache = null;
}

function buildEventTimeByEventId(ss) {
  if (__eventTimeByEventIdCache) return __eventTimeByEventIdCache;
  const book = ss || SpreadsheetApp.getActiveSpreadsheet();
  const sheet = book.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const out = {};
  if (!sheet) return out;
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return;
    const time = formatTimeRange(row[map['Event_Date']],
      map['Event_End'] === undefined ? '' : row[map['Event_End']]);
    if (time) out[eventId] = time;
  });
  __eventTimeByEventIdCache = out;
  return out;
}


