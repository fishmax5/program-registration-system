// ============================================================================
// 99o. THE LEDGER'S ONE-TIME BACKFILL  (backfillLedgerFromTab)
// ============================================================================
//
// EVERYTHING ON All_Registrants TODAY PREDATES THE LEDGER. Phase 2 put an
// append in front of every writer, so from the day it shipped a registration
// that CHANGES is on the record — but a row nobody has touched since is not,
// and most of the tab is exactly that. Until this job has run, the verifier's
// first bucket (99n: "on the tab, not in the fold") is the whole workbook and
// says nothing, which is another way of saying the verifier cannot yet do the
// job phase 4's gate depends on it for.
//
// So: one `registered` entry per row, Source `migration`, and the fold key
// written back ONTO the row so §1.4's first resolution path works from then on
// — which is most of why that column exists. A row whose Program_Status is
// Cancelled, Waitlisted or Superseded gets its `registered` entry PLUS the one
// entry that puts it in that state (ledgerEntriesForExistingRow, 99k), because
// the fold's `registered` creates an Active registration by construction and a
// replay built from `registered` alone would put every cancelled seat in the
// building back.
//
// ---------------------------------------------------------------------------
// IDEMPOTENCY IS RESOLVE-BEFORE-MINT, NOT "SKIP A ROW THAT HAS AN ID".
//
// That was the design's first rule and it keys the idempotency on the one
// field that is blank on every row this job exists to process. The starting
// state is a tab where EVERY Registration_ID is empty; this job is SLICED; and
// Apps Script kills an execution at its ceiling with no exception and no
// `finally`. A slice that died between appending the `registered` entry and
// writing the id back would leave a still-blank row, and the next slice would
// mint a SECOND id and append a SECOND `registered` entry. The fold keys state
// on Registration_ID, so that is two live states for one person: two rows, two
// seats against a capacity, two meals against a catering count — the exact
// duplication 85 exists to clean up, manufactured by the migration meant to be
// invisible.
//
// So every row is resolved against the ledger first (ledgerRegistrationIdsByKey,
// 99k — which sees DEAD registrations too, since a cancelled row's id is dead
// the moment it is minted and the live index would never find it again) and
// minted only on a miss. The row's blankness is a hint about where to look
// next, never the key. And the id goes onto the row BEFORE the entries are
// flushed: a row with an id and no entry is the safe failure — the tab is
// authoritative until phase 4 and the verifier names the row — while an entry
// no row claims is the unsafe one.
//
// ---------------------------------------------------------------------------
// THE IDS GO BACK AS A COLUMN WRITE, NEVER A RE-RENDER.
//
// Calling renderRegistrantsSheet() per slice to persist them would be the
// read-self / clear() / rewrite operation this whole design distrusts, run
// repeatedly over the entire tab and straight into 99j's shrink guard. One
// setValues() over the Registration_ID column of one section zone instead, on
// the pattern 96_session_grid.gs uses — and the zones are re-read at the top of
// every slice, never carried across executions, because a row position read an
// hour ago names whatever the desk has written there since.
//
// The COLUMN itself is this commit's migration, and it needs almost nothing:
// buildHeaderProjectionFromRow() (34) already projects a canonical column the
// sheet does not have to -1 and reads it back blank, which is what makes
// adding a column to HEADERS safe on a tab holding data. All this job adds is
// the header cell, so a targeted column write has somewhere to land before the
// next full render happens — see ensureLedgerIdColumn_().
//
// ---------------------------------------------------------------------------
// LOAD ORDER. Numbered after 99n for the usual reason — never renumber, and
// this landed last. Safe there: behavior only, its own four constants stand
// alone, its schema is HEADERS.All_Registrants in 03 like every other tab's,
// and everything it reaches for — the ledger (99k), runSlicedJob (75),
// getSectionZones / getHeaderMapAt (34, 07), ensureSheetColumns (13),
// withScriptLock (06), spoolOfficeNote (88) — it reads at CALL time or through
// a hoisted function declaration. One earlier file names it: 16, on Admin ▸
// One-Time Jobs.

/** This job's state, versioned like every stored shape in this project. */
const LEDGER_BACKFILL_STATE_PROP_KEY = 'LEDGER_BACKFILL_STATE_V1';

/** The trigger handler one slice arms for the next. */
const LEDGER_BACKFILL_RESUME_HANDLER = 'resumeLedgerBackfill';

/**
 * How many rows one slice records before it stops.
 *
 * Deliberately modest. The expensive part is not the arithmetic — it is that
 * this job holds the workbook lock while it writes, and 75's own banner is
 * about the sweep that held it for four and a half minutes and made Quick Mark
 * unavailable at the sign-in desk "half the time". A few hundred rows a slice
 * over a few minutes is a job nobody at a desk notices.
 */
const LEDGER_BACKFILL_ROWS_PER_SLICE = 250;

/** The envelope: budget, gaps, ceilings. The same shape the four older sliced jobs use. */
const LEDGER_BACKFILL_JOB = {
  budgetMs: 60 * 1000,
  resumeDelayMs: 60 * 1000,
  watchdogDelayMs: 5 * 60 * 1000,
  maxSlices: 200,
  maxStalledSlices: 2,
  staleMs: 30 * 60 * 1000
};

/**
 * Admin ▸ One-Time Jobs. Starts the backfill, or says it is already running.
 *
 * ASKS FIRST, because it writes a column onto every row of the tab this
 * project is most careful about — even though what it writes is an internal
 * key and nothing a person reads. The prompt says what it will and will not
 * do, which for a migration is the whole of what somebody needs to decide.
 */
function backfillLedgerFromTab() {
  if (isSlicedJobActive(LEDGER_BACKFILL_STATE_PROP_KEY, LEDGER_BACKFILL_JOB.staleMs,
    minutes => `The ledger backfill last moved ${minutes} minute(s) ago — starting it again.`)) {
    toastIfPossible('📒 The ledger backfill is already running — it carries on by itself.');
    return 'The ledger backfill is already running.';
  }

  const rows = countLedgerBackfillRows_();
  if (rows === null) {
    return `There is no ${SHEET_NAMES.REGISTRANT_DASH} tab to back-fill from yet.`;
  }
  if (!confirmLedgerBackfill_(rows)) return 'Nothing was changed.';

  saveSlicedJobState(LEDGER_BACKFILL_STATE_PROP_KEY, {
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0,
    errorSlices: 0, recorded: 0
  });
  armSlicedJobResume(LEDGER_BACKFILL_RESUME_HANDLER, 1000);
  toastIfPossible(`📒 Recording ${rows} registration(s) in the ledger — this runs in the background.`);
  return `The ledger backfill has started on ${rows} row(s). It carries on by itself and files a ` +
    `line for the office's daily digest when it finishes.`;
}

/** The trigger handler. One slice, then it arms the next or ends the job. */
function resumeLedgerBackfill() {
  return runSlicedJob({
    propKey: LEDGER_BACKFILL_STATE_PROP_KEY,
    label: 'the registration ledger backfill',
    resumeHandler: LEDGER_BACKFILL_RESUME_HANDLER,
    budgetMs: LEDGER_BACKFILL_JOB.budgetMs,
    resumeDelayMs: LEDGER_BACKFILL_JOB.resumeDelayMs,
    watchdogDelayMs: LEDGER_BACKFILL_JOB.watchdogDelayMs,
    maxSlices: LEDGER_BACKFILL_JOB.maxSlices,
    maxStalledSlices: LEDGER_BACKFILL_JOB.maxStalledSlices,
    // THE LOCK FOR THE WHOLE SLICE, which is the one thing this job cannot do
    // per item: it reads the zones, decides, and writes a column back, and a
    // render landing between the read and the write would put the ids onto
    // whatever rows had moved into those positions. The slice is a minute
    // rather than five for exactly that reason — 75's own banner is about the
    // sweep that held this lock for four and a half minutes and made Quick
    // Mark unavailable at the desk.
    //
    // A lock somebody else holds SKIPS the slice rather than failing it: the
    // rows are still un-done, nothing was written, and the watchdog armed at
    // the head of runSlicedJob() brings the next one. Written out rather than
    // through withScriptLock(), which is the shape 90 and 98 use, and for the
    // same reason — the skip has to be distinguishable from a slice that ran
    // and did nothing, or the stall counter ends a job that was only waiting.
    around: run => {
      const lock = LockService.getScriptLock();
      if (!lock.tryLock(DESK_LOCK_WAIT_MS)) {
        log('Ledger backfill: the workbook is busy — this slice will be retried.');
        return null;
      }
      try {
        return run();
      } finally {
        lock.releaseLock();
      }
    },
    work: ctx => runLedgerBackfillSlice_(ctx),
    madeProgress: (state, result) => (result.processed || 0) > 0,
    noteProgress: (state, result) => { state.recorded = (state.recorded || 0) + (result.processed || 0); },
    overrunProblem: () => 'it ran for more slices than it is allowed',
    stalledProblem: () => 'two slices in a row recorded nothing',
    errorProblem: err => `it stopped with an error (${err})`,
    onError: (err, n, max) => log(`⚠️ Ledger backfill slice failed (${n}/${max}): ${err}`),
    onDone: (state, problem) => finishLedgerBackfill_(state, problem)
  });
}

/**
 * ONE SLICE: read the zones as they stand, record what is not yet recorded,
 * write the ids back.
 *
 * The zones are read HERE and used HERE. Nothing about a row position crosses
 * an execution boundary — the whole job's stored state is a count.
 */
function runLedgerBackfillSlice_(ctx) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return { stop: `there is no ${SHEET_NAMES.REGISTRANT_DASH} tab` };

  const headers = HEADERS.All_Registrants;
  ensureLedgerIdColumn_(sheet, headers);

  // Resolved ONCE per slice, against the whole ledger: live registrations and
  // dead ones alike. See ledgerRegistrationIdsByKey() for why the live-only
  // resolver every other writer uses would be wrong here.
  const claimed = ledgerRegistrationIdsByKey(ledgerFoldNow());

  let processed = 0;
  let remaining = 0;
  const zones = getSectionZones(sheet, 'Event_ID');

  for (let z = 0; z < zones.length; z++) {
    const zone = zones[z];
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) continue;

    // The map the SHEET actually has, not the one the code expects: on a
    // workbook whose columns were reordered by hand, or mid-migration, those
    // are two different answers and only one of them names a real column.
    // Built here rather than through getLiveHeaderMap() (18) because that one
    // falls back to the canonical order when Manual_Override is missing, which
    // is right for an edit handler (it is about to flip one well-known cell)
    // and wrong for this: a header row a projection cannot read is a tab to
    // leave alone, not one to write a column into by position.
    const map = ledgerBackfillHeaderMap_(sheet, zone.headerRow, headers);
    if (map['Registration_ID'] === undefined) continue;

    let width = headers.length;
    Object.keys(map).forEach(h => { width = Math.max(width, map[h] + 1); });
    const values = sheet.getRange(zone.dataStart, 1, count, width).getValues();
    const ids = values.map(row => String(row[map['Registration_ID']] || '').trim());

    let wroteInThisZone = false;
    for (let i = 0; i < values.length; i++) {
      if (ids[i]) continue;
      // A row with no name and no session is a spacer or a half-typed line,
      // not a registration. It is skipped rather than recorded, and it is not
      // counted as remaining either — otherwise the job stalls on it forever.
      if (!String(values[i][map['Name']] || '').trim() &&
        !String(values[i][map['Event_ID']] || '').trim()) continue;

      if (processed >= LEDGER_BACKFILL_ROWS_PER_SLICE || Date.now() > ctx.deadline) {
        remaining++;
        continue;
      }
      ids[i] = recordLedgerBackfillRow_(values[i], map, claimed);
      wroteInThisZone = true;
      processed++;
    }

    if (wroteInThisZone) {
      // THE IDS FIRST, THEN THE ENTRIES. One setValues() over this zone's
      // Registration_ID column and nothing else — never a re-render, and never
      // a write wider than the one column this job owns.
      sheet.getRange(zone.dataStart, map['Registration_ID'] + 1, ids.length, 1)
        .setValues(ids.map(id => [id]));
      invalidateSectionedRowsCache(sheet);
    }
  }

  // AFTER the column write, deliberately: a row carrying an id whose entry was
  // lost is recognized by the next slice (resolve-before-mint reads the column
  // first) and reported by the verifier; an entry no row claims is the failure
  // that cannot be seen from the tab at all.
  flushLedger();

  if (remaining > 0) return { processed: processed, remaining: remaining };
  return { finished: true, processed: processed, remaining: 0 };
}

/**
 * ONE ROW ONTO THE RECORD. Returns the Registration_ID it now carries.
 *
 * RESOLVE BEFORE YOU MINT. A row whose key the ledger already holds takes that
 * id — which is what makes a slice killed between the append and the column
 * write harmless — and a key is claimed only ONCE, so two tab rows sharing one
 * key become two registrations rather than one. Two such rows are a duplicate
 * registration, which is 85's dialog to resolve and not this job's to hide.
 */
function recordLedgerBackfillRow_(row, map, claimed) {
  const key = registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
  if (key && claimed[key]) {
    const found = claimed[key];
    delete claimed[key];   // claimed once: the next row with this key mints its own
    return found;
  }

  const entries = ledgerEntriesForExistingRow(row, map, {
    source: LEDGER_SOURCES.MIGRATION,
    occurredAt: ledgerBackfillOccurredAt_(row, map),
    note: 'Recorded by the one-time backfill — this registration predates the ledger.'
  });
  appendLedgerEntries(entries);
  return entries[0].registrationId;
}

/**
 * WHEN THIS REGISTRATION HAPPENED, from the row's best available evidence —
 * which is the session's own date, and the design's "otherwise" clause is the
 * only clause this can take.
 *
 * The design's first answer is "the form response's submitted time where
 * Form_Source still resolves". It does not resolve to a time: Form_Source
 * holds a `=HYPERLINK()` naming one RESPONSE, and turning that into a
 * timestamp means opening the form and walking its responses — once per row,
 * across every form this workbook has ever made, inside a sliced job holding
 * the desk lock, for rows whose form is as often deleted as not. That is not a
 * cost a migration may charge, and a timestamp recovered for a third of the
 * tab would be worse than none: a column that is sometimes the real minute and
 * sometimes the session's midnight is a column no reader can use.
 *
 * So the session date, for every row, which is honest about what it is — the
 * ORDER these registrations happened in, near enough, rather than a claim
 * about the minute. Blank where even that is missing, which means "the same as
 * Entry_At" (§1.2) and is the correct answer for a row carrying no date.
 */
function ledgerBackfillOccurredAt_(row, map) {
  if (map['Event_Date'] === undefined) return null;
  return coerceDate(row[map['Event_Date']]) || null;
}

/**
 * The column, on a tab written before it existed.
 *
 * THE WHOLE MIGRATION, and it is this small on purpose: reading is already
 * handled — buildHeaderProjectionFromRow() (34) projects a canonical column
 * the sheet does not have to -1 and hands the row back with a blank there,
 * which is what makes adding a column to a HEADERS array safe on a tab holding
 * data — and the next full render writes the header out with everything else.
 * What is missing until then is somewhere for a TARGETED write to land, so
 * this widens the sheet if it has to and writes the header cell on each
 * section's header row. Idempotent: a header row that already says it is left
 * alone, which matters because this runs at the top of every slice.
 */
function ensureLedgerIdColumn_(sheet, headers) {
  if (headers.indexOf('Registration_ID') === -1) return 0;
  // A widened sheet is a different grid from the one the per-execution cache
  // (96) is holding, and every header read below comes out of that cache.
  const before = sheet.getMaxColumns();
  if (ensureSheetColumns(sheet, headers.length) !== before) invalidateSectionedRowsCache(sheet);

  let written = 0;
  getSectionZones(sheet, 'Event_ID').forEach(zone => {
    const map = getHeaderMapAt(sheet, zone.headerRow);
    if (map['Registration_ID'] !== undefined) return;
    // At the end of the header row as the SHEET has it, which is where the
    // canonical list puts it too — never at `wanted` blindly, because a tab
    // whose columns somebody reordered would take the write on top of a
    // column that means something else.
    const col = Math.max(sheet.getLastColumn(), headers.length);
    sheet.getRange(zone.headerRow, col, 1, 1).setValue('Registration_ID').setFontWeight('bold');
    written++;
  });
  if (written) {
    invalidateSectionedRowsCache(sheet);
    log(`Registration_ID added to ${written} header row(s) on ${SHEET_NAMES.REGISTRANT_DASH}.`);
  }
  return written;
}

/**
 * A 0-based header map for one section's header row, as the SHEET has it.
 *
 * Falls back to the canonical order when the row does not carry the names this
 * job needs — a tab whose header row is missing or mangled is one to leave
 * alone rather than to write a column into by position.
 */
function ledgerBackfillHeaderMap_(sheet, headerRow, headers) {
  const sheetMap = getHeaderMapAt(sheet, headerRow);
  const map = {};
  headers.forEach(h => { if (sheetMap[h] !== undefined) map[h] = sheetMap[h] - 1; });
  const needed = ['Name', 'Event_ID', 'Person_Type', 'Program_Status'];
  return needed.every(h => map[h] !== undefined) ? map : getIndexMap(headers);
}

/** How many rows are still waiting, for the prompt. Null when there is no tab. */
function countLedgerBackfillRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return null;
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  return getSectionedRows(sheet, headers, 'Event_ID')
    .filter(row => !String(row[map['Registration_ID']] || '').trim())
    .filter(row => String(row[map['Name']] || '').trim() || String(row[map['Event_ID']] || '').trim())
    .length;
}

/** The prompt. True to go ahead. No UI (a trigger, a test) reads as yes. */
function confirmLedgerBackfill_(rows) {
  try {
    const ui = SpreadsheetApp.getUi();
    return ui.alert('Record the registrations already on the tab?',
      `${rows} row(s) on ${SHEET_NAMES.REGISTRANT_DASH} were written before the registration ledger ` +
      `existed and are not on it.\n\n` +
      `This writes one entry per row into ${SHEET_NAMES.REGISTRATION_LEDGER} — plus, for a row that is ` +
      `cancelled, waitlisted or superseded, the one entry that says so — and puts an internal id in a ` +
      `hidden Registration_ID column so each row and its entry can find each other.\n\n` +
      `Nothing anybody reads on the tab changes, no registration is created, cancelled or moved, and ` +
      `it is safe to run twice. It works in the background and can take several minutes.`,
      ui.ButtonSet.YES_NO) === ui.Button.YES;
  } catch (err) {
    return true;   // no UI — a trigger or a test, where the decision is already made
  }
}

/**
 * The end of the job, however it ends.
 *
 * Told to the office's daily digest (88) rather than only toasted, because the
 * person who pressed this is not the person who has to know it finished: the
 * whole point of it is what the verifier can say the morning afterwards.
 */
function finishLedgerBackfill_(state, problem) {
  clearSlicedJobState(LEDGER_BACKFILL_STATE_PROP_KEY);
  deleteSlicedJobResumeTriggers(LEDGER_BACKFILL_RESUME_HANDLER);

  const recorded = state && state.recorded ? state.recorded : 0;
  const said = problem
    ? `The ledger backfill stopped after recording ${recorded} registration(s): ${problem}. ` +
      `Running it again picks up where it left off — it never records a row twice.`
    : `The ledger backfill finished: ${recorded} registration(s) that predate the ledger are now on it. ` +
      `From tomorrow's check, a row on ${SHEET_NAMES.REGISTRANT_DASH} with no entry behind it is a ` +
      `writer that is not appending rather than simply an old row.`;

  log(`Ledger backfill: ${said}`);
  try {
    spoolOfficeNote('Registration ledger', said);
  } catch (err) {
    log(`⚠️ The ledger backfill finished but could not be filed for the digest (${err}).`);
  }
  toastIfPossible(problem ? `⚠️ ${said}` : `✅ ${said}`);
  return said;
}
