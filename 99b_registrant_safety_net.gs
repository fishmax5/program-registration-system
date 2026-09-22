// ============================================================================
// 99b. THE REGISTRANT TAB'S SAFETY NET  (shrink guard + daily snapshot)
// ============================================================================
//
// WHY THIS FILE EXISTS.
//
// All_Registrants is nominally the source of truth for every registration in
// this workbook, and it is rebuilt by reading ITSELF, clearing itself, and
// writing the rows back:
//
//     renderRegistrantsSheet()  ->  getSectionedRows(sheet, ...)   // read
//     renderFlatDateSheet()     ->  sheet.clear()                  // wipe
//                               ->  writeUpcomingPastSections()    // rewrite
//
// Read-self, wipe, rewrite. Every registration in the building depends on ONE
// in-memory array being complete at the instant of that clear(). Anything that
// makes the array short — a partial read, an over-broad tombstone match, a
// filter that threw half way, an upstream pass that handed on fewer rows than
// it was given — is silent, total and permanent. There is no second copy of
// All_Registrants anywhere in this project, which is why the only recoveries
// so far have been through Google's own file version history.
//
// This file does not fix that shape. It does the two cheap things that make
// the shape survivable while it is still the shape:
//
//   1. A SHRINK GUARD, consulted immediately before the clear(). A render that
//      is about to write back dramatically fewer rows than the tab currently
//      holds is REFUSED — it throws rather than writing, so the tab keeps the
//      rows it has and somebody is told. A smaller loss is allowed through but
//      snapshotted and reported, because legitimate ones exist (the duplicate
//      merge, the remove sweep, a session deletion) and a guard that blocks
//      those is a guard somebody turns off.
//
//   2. A SNAPSHOT, written to Drive as a dated CSV: once a day on a trigger,
//      and additionally whenever the guard fires. Recovery stops being an
//      archaeology dig through version history and becomes a file lookup.
//
// DELIBERATELY NOT A LEDGER. The durable answer is an append-only record that
// every writer appends to first, with this tab as a fold of it — at which
// point neither half of this file is needed. That is a much larger change;
// this is what holds the line until then, and it is worth keeping afterwards
// anyway, because a guard on a destructive write costs one comparison.

/**
 * A shrink this large is not a deletion anybody performed — it is a bug.
 *
 * Both conditions must hold, and that pairing is the whole calibration: the
 * FRACTION is what makes it impossible to hit by legitimate means (nobody
 * removes half the registrations in the workbook through a render), and the
 * ROW FLOOR is what keeps a tab with four rows on it from refusing to redraw
 * when two of them are correctly dropped.
 */
const REGISTRANT_GUARD_REFUSE_FRACTION = 0.5;
const REGISTRANT_GUARD_REFUSE_MIN_ROWS = 10;

/**
 * Below the refusal, above this: written, but snapshotted and reported.
 *
 * The duplicate review, the remove sweep and a session deletion all legitimately
 * land here, so the office reads it as a note rather than an alarm — but it is
 * the line that makes an unexplained loss of a dozen rows VISIBLE, which is the
 * thing that has been missing.
 */
const REGISTRANT_GUARD_WARN_MIN_ROWS = 5;

const REGISTRANT_SNAPSHOT_FOLDER_NAME = 'Registrant Snapshots';
const REGISTRANT_SNAPSHOT_KEEP_DAYS = 90;

/**
 * Consulted by renderFlatDateSheet() immediately before its clear(), and only
 * for a tab whose caller asked for it (`opts.guardMarker`) — which today is
 * All_Registrants and nothing else. Triage and Lunch_Schedule are projections
 * of the calendar and are rebuilt from it; this tab is the only one where a
 * short array is an unrecoverable loss.
 *
 * Throws on a refusal rather than returning quietly. A silent skip is exactly
 * the failure mode that produced this file: the sliced sync (98) records a
 * step that threw and steps over it, and a desk action that refuses in front
 * of somebody is the correct outcome — the alternative is telling them a thing
 * happened that did not.
 */
function guardRegistrantRowLoss_(sheet, headers, markerHeaderName, newRows) {
  if (!sheet || !headers || !markerHeaderName) return;
  const incoming = (newRows || []).length;

  let existing;
  try {
    // Memoized for the execution (08), so on the ordinary path — where the
    // render has already read this tab — this costs nothing at all.
    existing = getSectionedRows(sheet, headers, markerHeaderName).length;
  } catch (err) {
    // A read that will not go through is not evidence of loss, and refusing a
    // render on the strength of it would be the guard causing the outage.
    log(`ℹ️ Could not count existing rows on "${sheet.getName()}" for the shrink guard (${err}).`);
    return;
  }

  // A tab being built for the first time, or one somebody has just emptied on
  // purpose. There is nothing to protect.
  if (existing === 0) return;

  const lost = existing - incoming;
  if (lost < REGISTRANT_GUARD_WARN_MIN_ROWS) return;

  const fraction = lost / existing;
  const refusing = lost >= REGISTRANT_GUARD_REFUSE_MIN_ROWS
    && fraction >= REGISTRANT_GUARD_REFUSE_FRACTION;

  // SNAPSHOT FIRST, in both cases and before anything else can throw: on a
  // refusal it is the evidence, and on a warning it is the copy somebody will
  // want if the loss turns out to have been real after all.
  const snapshot = snapshotRegistrantTab_(sheet, refusing ? 'refused-render' : 'shrink');
  const where = snapshot ? `\n\nA copy of the tab as it stands was saved to Drive as "${snapshot}".` : '';
  const scale = `${lost} of ${existing} row(s) (${Math.round(fraction * 100)}%)`;

  if (!refusing) {
    log(`⚠️ Registrant render is dropping ${scale}.`);
    spoolOfficeNote('Registrations',
      `A rewrite of the registrants tab wrote ${scale} fewer rows than the tab was holding. ` +
      `That is normal after merging duplicates, removing marked rows or deleting a session's ` +
      `registrations — and is worth a look if nobody did any of those.${where}`);
    return;
  }

  const message =
    `A rewrite of the registrants tab was REFUSED because it would have removed ${scale}.\n\n` +
    `Nothing was deleted — the tab still holds every row it held. The rewrite that was ` +
    `refused has been stopped, so whatever it was part of (an hourly sync, a desk action) ` +
    `did not finish, and may report an error.\n\n` +
    `A loss on this scale is not something any menu item does. Treat it as a fault and ` +
    `check the tab before running anything else.${where}`;
  log(`🛑 ${message}`);
  notifyAdminUrgent('🛑 Registrant tab rewrite refused — possible data loss prevented', message);
  throw new Error(
    `Refused to rewrite ${sheet.getName()}: it would have removed ${scale}. ` +
    `Nothing was deleted; the office has been emailed.`);
}

/**
 * The tab as it stands, as a dated CSV in Drive.
 *
 * Values rather than formulas, deliberately: this is a record to read a lost
 * registration back out of, not a tab to restore wholesale — and the one
 * formula column here (Event_Time) is more useful as the time it displays.
 *
 * Never throws. A snapshot that cannot be written must not be the reason a
 * render fails, and on the refusal path the message says whether there is one.
 */
function snapshotRegistrantTab_(sheet, reason) {
  try {
    const values = sheet.getDataRange().getValues();
    if (values.length === 0) return '';
    const csv = values.map(row => row.map(cell => {
      const text = cell === null || cell === undefined ? '' : String(cell);
      return `"${text.replace(/"/g, '""')}"`;
    }).join(',')).join('\n');

    const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd_HHmm');
    const name = `All_Registrants ${stamp} (${reason || 'snapshot'}).csv`;
    const folder = getOrCreateSystemFolder(REGISTRANT_SNAPSHOT_FOLDER_NAME);
    if (!folder) return '';
    folder.createFile(name, csv, MimeType.CSV);
    log(`Saved a registrant snapshot: ${name} (${values.length - 1} row(s)).`);
    return name;
  } catch (err) {
    log(`⚠️ Could not save a registrant snapshot (${err}).`);
    return '';
  }
}

/**
 * The daily trigger. One CSV a night, pruned after REGISTRANT_SNAPSHOT_KEEP_DAYS.
 *
 * Runs whether or not automation is enabled: the kill switch stops this system
 * CHANGING things, and a copy of what is already there changes nothing. A
 * workbook somebody paused because it was misbehaving is exactly the one whose
 * yesterday is worth keeping.
 */
function snapshotRegistrantsDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) {
    log('ℹ️ No registrants tab to snapshot.');
    return;
  }
  snapshotRegistrantTab_(sheet, 'daily');
  pruneRegistrantSnapshots_();
}

/** The menu's "save one now", for somebody about to do something alarming. */
function snapshotRegistrantsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`There is no "${SHEET_NAMES.REGISTRANT_DASH}" tab to save.`);
    return;
  }
  const name = snapshotRegistrantTab_(sheet, 'manual');
  SpreadsheetApp.getUi().alert(name
    ? `Saved a copy of ${SHEET_NAMES.REGISTRANT_DASH} to the "${REGISTRANT_SNAPSHOT_FOLDER_NAME}" ` +
      `folder in Drive as:\n\n${name}`
    : `Could not save a copy — see the log for why.`);
}

/**
 * Old snapshots go. Ninety days is chosen against how these losses are
 * actually found: not on the day, but when somebody turns up for a session
 * they registered for weeks ago.
 */
function pruneRegistrantSnapshots_() {
  try {
    const folder = getOrCreateSystemFolder(REGISTRANT_SNAPSHOT_FOLDER_NAME);
    if (!folder) return;
    const cutoff = new Date().getTime() - REGISTRANT_SNAPSHOT_KEEP_DAYS * 24 * 60 * 60 * 1000;
    const files = folder.getFiles();
    let removed = 0;
    while (files.hasNext()) {
      const file = files.next();
      if (file.getDateCreated().getTime() >= cutoff) continue;
      // Trashed rather than deleted: the whole file is about not losing things.
      file.setTrashed(true);
      removed++;
    }
    if (removed > 0) log(`Trashed ${removed} registrant snapshot(s) older than ${REGISTRANT_SNAPSHOT_KEEP_DAYS} days.`);
  } catch (err) {
    log(`⚠️ Could not prune registrant snapshots (${err}).`);
  }
}
