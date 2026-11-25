// ===================================================================
// 99zzl. THE TITLE OPENS THE PROGRAM'S ROWS ON All_Registrants
// ===================================================================
//
// WHAT CHANGED (Nov 2026). A program's title on Master_Program_Dashboard and
// All_Program_Sessions used to link to that program's own roster sheet. Roster
// sheets are now made only for programs with a leader, and they are plain
// view-only lists (46). Staff work off All_Registrants, so the title now opens
// THAT tab with the program's block selected: its heading row through its last
// registrant, in the Upcoming section when it has one there, else the Past.
//
// WHERE THE RANGES COME FROM. Column A of All_Registrants, read in one call.
// Every program block opens with a heading row (99zs) whose label is
// "▸ Title — Location", so the tab itself says where each block is and
// nothing is stored per program. Read once per execution and memoized; a
// render of All_Registrants drops the memo.
//
// KEEPING THE LINKS TRUE. Registrant rows move whenever a block above them
// grows, so the dashboards' links go stale every time All_Registrants is
// redrawn. renderRegistrantsSheet() therefore calls
// relinkDashboardTitlesToRegistrants_() after every full render. It hashes the
// ranges and rewrites the two title columns only when the hash moved — a few
// reads and two rich-text writes, and nothing at all on a quiet hour.
//
// NEVER THROWS. A link that cannot be worked out leaves the title as plain
// text; it never stops a render.

const REGISTRANT_ROSTER_RANGES_SIG_PROP_KEY = 'REGISTRANT_ROSTER_RANGES_SIG_V1';

let __registrantRosterRangesMemo = null;

/** Drops this execution's copy of the ranges. */
function resetRegistrantRosterRanges_() {
  __registrantRosterRangesMemo = null;
}

/**
 * The key one program block is found under — the same one 99zs groups on.
 * Lunch titles collapse to one key whatever the dish (quickMarkTitleKey, 38),
 * and so does the month tab's "Lunch @ Narberth" display name.
 */
function registrantRosterRangeKey_(title, location) {
  const t = quickMarkTitleKey(String(title || '').trim());
  return `${String(t).toLowerCase()}|${String(location || '').trim().toLowerCase()}`;
}

/** The spelling-tolerant twin of the key above (programTitleMatchKey, 53). */
function registrantRosterRangeLooseKey_(title, location) {
  const text = String(title || '').trim();
  const t = isLunchOnlyProgramTitle(text) ? LUNCH_ONLY_TITLE_MATCH_KEY : programTitleMatchKey(text);
  if (!t) return '';
  return `${t}|${String(location || '').trim().toLowerCase()}`;
}

/** Title and location out of one heading label, or null. */
function parseRegistrantGroupLabel_(value) {
  if (!isSectionedDividerValue(value)) return null;
  const body = String(value).trim().slice(REGISTRANT_GROUP_DIVIDER_PREFIX.trim().length).trim();
  if (!body || body === '(no program named)') return null;
  const at = body.lastIndexOf(' — ');
  return at === -1
    ? { title: body, location: '' }
    : { title: body.slice(0, at).trim(), location: body.slice(at + 3).trim() };
}

/**
 * Every program block in column A, as 1-based [first, last] row pairs.
 * Upcoming wins over Past for the same program: the Past block is only used
 * for a program with nobody upcoming.
 */
function parseRegistrantRosterRanges_(columnA) {
  const exact = {};
  const loose = {};
  const values = (columnA || []).map(r => (Array.isArray(r) ? r[0] : r));
  const isStop = v => {
    if (isSectionedDividerValue(v)) return true;
    const s = String(v === null || v === undefined ? '' : v).trim();
    return s === 'Event_Date' || /^[⏳🕓]/u.test(s);
  };
  for (let i = 0; i < values.length; i++) {
    const label = parseRegistrantGroupLabel_(values[i]);
    if (!label) continue;
    let last = i;
    for (let j = i + 1; j < values.length && !isStop(values[j]); j++) {
      if (String(values[j] === null || values[j] === undefined ? '' : values[j]).trim() !== '') last = j;
    }
    if (last === i) continue; // a heading with nobody under it
    const span = [i + 1, last + 1];
    const k = registrantRosterRangeKey_(label.title, label.location);
    if (!exact[k]) exact[k] = span;
    const lk = registrantRosterRangeLooseKey_(label.title, label.location);
    if (lk && !loose[lk]) loose[lk] = span;
  }
  return { exact, loose };
}

/** The ranges on All_Registrants now, with what a link needs. Null on failure. */
function readRegistrantRosterRanges_() {
  if (__registrantRosterRangesMemo) return __registrantRosterRangesMemo;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
    if (!sheet) return null;
    const lastRow = sheet.getLastRow();
    const columnA = lastRow > 0 ? sheet.getRange(1, 1, lastRow, 1).getValues() : [];
    const parsed = parseRegistrantRosterRanges_(columnA);
    const base = String(ss.getUrl() || '').replace(/[?#].*$/, '');
    if (!base) return null;
    __registrantRosterRangesMemo = Object.assign(parsed, {
      base,
      gid: sheet.getSheetId(),
      lastLetter: columnToLetter((HEADERS.All_Registrants || []).length || 1)
    });
    return __registrantRosterRangesMemo;
  } catch (err) {
    log(`ℹ️ Could not read where each program sits on ${SHEET_NAMES.REGISTRANT_DASH} (${err}).`);
    return null;
  }
}

/**
 * The link that opens a program's rows on All_Registrants, or ''.
 *   titles   — one title or several (the month tab passes every spelling its
 *              sessions carry); tried in order.
 *   location — one building, or "Narberth + Ashbridge"; each part is tried.
 */
function registrantRosterRangeUrl_(titles, location, ranges) {
  const r = ranges || readRegistrantRosterRanges_();
  if (!r) return '';
  const list = (Array.isArray(titles) ? titles : [titles]).map(t => String(t || '').trim()).filter(Boolean);
  const locs = String(location || '').split(' + ').map(s => s.trim()).filter(Boolean);
  if (locs.length === 0) locs.push('');
  let span = null;
  for (const loc of locs) {
    for (const t of list) { span = r.exact[registrantRosterRangeKey_(t, loc)]; if (span) break; }
    if (span) break;
  }
  if (!span) {
    for (const loc of locs) {
      for (const t of list) {
        const lk = registrantRosterRangeLooseKey_(t, loc);
        span = lk ? r.loose[lk] : null;
        if (span) break;
      }
      if (span) break;
    }
  }
  if (!span) return '';
  return `${r.base}#gid=${r.gid}&range=A${span[0]}:${r.lastLetter}${span[1]}`;
}

/** A short, stable hash of the ranges — what decides whether to relink. */
function registrantRosterRangesSignature_(ranges) {
  const text = JSON.stringify([ranges.gid, ranges.exact]);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${h.toString(36)}`;
}

/**
 * Rewrites one dashboard's title column to the current ranges. Finds the
 * table by its header rows (the first header and the title header both in
 * place), and rewrites each run of rows under one, down to the first row with
 * no title (a banner or the end). Returns how many titles it wrote.
 */
function relinkDashboardTitleColumn_(ss, sheetName, titleHeader, ranges) {
  const sheet = ss.getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  if (!sheet || !headers) return 0;
  const titleIdx = headers.indexOf(titleHeader);
  const locIdx = headers.indexOf('Location');
  if (titleIdx === -1 || locIdx === -1) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(1, 1, lastRow, headers.length).getValues();
  let written = 0;
  for (let r = 0; r < values.length; r++) {
    if (values[r][0] !== headers[0] || values[r][titleIdx] !== titleHeader) continue;
    const start = r + 1;
    let end = start;
    while (end < values.length && String(values[end][titleIdx] || '').trim() !== '') end++;
    if (end === start) continue;
    const run = values.slice(start, end);
    linkTitleCellsToRosters_(sheet, start + 1, titleIdx + 1,
      run.map(v => v[titleIdx]),
      run.map(v => registrantRosterRangeUrl_(v[titleIdx], v[locIdx], ranges)),
      { writePlain: true });
    written += run.length;
    r = end - 1;
  }
  return written;
}

/**
 * After All_Registrants is redrawn: when the program blocks moved, point both
 * dashboards' titles at where they are now. Never throws.
 */
function relinkDashboardTitlesToRegistrants_() {
  resetRegistrantRosterRanges_();
  try {
    const ranges = readRegistrantRosterRanges_();
    if (!ranges) return;
    const sig = registrantRosterRangesSignature_(ranges);
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(REGISTRANT_ROSTER_RANGES_SIG_PROP_KEY) === sig) return;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const a = relinkDashboardTitleColumn_(ss, SHEET_NAMES.PROGRAM_DASHBOARD, 'Clean_Title', ranges);
    const b = relinkDashboardTitleColumn_(ss, SHEET_NAMES.PROGRAM_MONTH, 'Program', ranges);
    props.setProperty(REGISTRANT_ROSTER_RANGES_SIG_PROP_KEY, sig);
    log(`Title links pointed at ${SHEET_NAMES.REGISTRANT_DASH}: ${a} session row(s), ${b} program row(s).`);
  } catch (err) {
    log(`ℹ️ Could not repoint the title links at ${SHEET_NAMES.REGISTRANT_DASH} (${err}).`);
  }
}
