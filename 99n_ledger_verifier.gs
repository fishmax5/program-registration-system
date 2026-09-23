// ============================================================================
// 99n. IS THE LEDGER TELLING THE TRUTH?  (verifyLedgerAgainstTab)
// ============================================================================
//
// WHY THIS FILE EXISTS, and why it ships in the same phase as the writers.
//
// Phase 2 of the registration ledger (99k) put an append in front of nine
// writers. Nothing reads the result yet — All_Registrants is still the state,
// every caller of renderRegistrantsSheet() still passes the array it built —
// and that is deliberate: the tab does not become a projection of the ledger
// until phase 4, which is the only phase of this design that can lose
// anything.
//
// What makes it safe to take that step LATER is this file, run NOW. Every
// sync folds the ledger, reads the tab, and names the differences. Three
// buckets, reported apart because the fix for each is a different fix:
//
//   ON THE TAB, NOT IN THE FOLD — a writer that is not appending. Before
//   phase 3's backfill this is most of the workbook and means nothing; after
//   it, every name in this bucket is a call site somebody has to go and find.
//   The list of which writers those are is the whole output of phase 2.
//
//   IN THE FOLD, NOT ON THE TAB — either a writer appending something it does
//   not write, or A ROW THE TAB HAS LOST. THIS BUCKET IS THE ORIGINAL FAULT,
//   detected for the first time, and it is what this phase is worth shipping
//   for on its own. 99j's guard cannot see the loss of nine rows and neither
//   half of it can say WHICH rows went, because neither knows what the tab was
//   supposed to say. This does: it names the person, the session and the day
//   they registered, in tomorrow morning's digest, instead of a phone call in
//   March from somebody who turned up to a class they are no longer on.
//
//   BOTH, DISAGREEING — a fold bug, reported PER COLUMN, because "these two
//   rows differ" is not something anybody can act on and "Meals_Ordered says 2
//   and the tab says 4" is.
//
// IT IS READ-ONLY AND IT NEVER THROWS. It runs at the end of a sync that has
// already done everything that matters, and a verifier that took the sync down
// with it would be a diagnostic causing the fault it exists to report. Every
// stage is guarded on its own and a run that could not read one of the two
// sides says so rather than reporting an empty bucket, because "nothing to
// report" and "nothing looked at" are different answers — the same rule
// describeEmptyLinkRepair() (32) and the form-link doctor (51) already follow.
//
// WHERE IT IS REPORTED. spoolOfficeNote() (88), so it reaches a person in the
// 10am digest rather than a log nobody opens. One line per finding, capped,
// and the coalescing in 88 means a fault that persists across twenty syncs is
// one line and a count rather than twenty identical ones.
//
// LOAD ORDER. Numbered after 99m for the usual reason — never renumber, and
// this landed last. Safe there: behavior only, its own three constants stand
// alone, its schema is HEADERS.All_Registrants in 03 like every other tab's,
// and everything it reaches for — the fold and the ledger's own readers (99k),
// getSectionedRows (34), spoolOfficeNote (88) — it reads at CALL time or
// through a hoisted function declaration. One earlier file calls into it the
// same way: 98, at the end of the sync's tail.

/**
 * The columns a comparison is made on, and the reason it is a list rather than
 * "every column".
 *
 * A registration is what these say: who, on what session, in what state, with
 * what meal. Everything else on the tab is either derived from somewhere else
 * on every render (the two link cells, stamped from a registry by 69), a
 * formula the cell's VALUE does not carry, or a free-text column two writers
 * legitimately word differently (Admin_Notes, which every stamper appends its
 * own sentence to — comparing it would report every cancellation in the
 * workbook as a disagreement, which is a bucket nobody would read twice).
 *
 * AND `Registration_ID` IS DELIBERATELY NOT ON IT, which is the one exclusion
 * worth stating on its own. It is the ledger's own bookkeeping rather than
 * anything about the registration, and while the backfill (99o) is running the
 * tab's column is blank on every row it has not reached yet while the fold's
 * rows all carry one — so a naive per-column diff would put the entire
 * workbook into bucket three and bury the real findings during exactly the
 * month phase 4's gate is measured over. A blank there means "not yet
 * backfilled", not a disagreement.
 *
 * Widening this list is how a fold bug gets found; widening it to everything
 * is how the report stops being read.
 */
const LEDGER_VERIFY_COLUMNS = [
  'Event_Date', 'Location', 'Event', 'Name', 'Person_Type',
  'Program_Status', 'Lunch_Status', 'Lunch_Type', 'Meals_Ordered',
  'Attended', 'Lunch_Served', 'Party_ID'
];

/** How many findings of each kind one run names before it says "and N more". */
const LEDGER_VERIFY_MAX_LISTED = 25;

/** The digest section every line of this report is filed under. */
const LEDGER_VERIFY_DIGEST_SECTION = 'Registration ledger';

/**
 * THE COMPARISON. Returns a plain object and writes nothing.
 *
 *   { ok, checked, folded, missingFromFold, missingFromTab, disagreeing,
 *     problems, skipped }
 *
 * `ok` is false only when a side could not be read at all — an empty bucket is
 * a good answer, an unread side is not one.
 *
 * MATCHED ON registrantTombstoneKey (28), which is the key the tombstones, the
 * superseded match, the import index and the fold's own index are all already
 * built on. A fifth spelling of "the same registration" is how two readers
 * come to disagree about what one is.
 *
 * DEAD ROWS ARE OUT OF SCOPE ON BOTH SIDES. A Superseded row is bookkeeping
 * rather than a registration (isSupersededRegistrantRow, 29) and the fold does
 * not write one out at all, so counting it here would report every
 * resubmission in the workbook as a row the ledger had lost.
 */
function verifyLedgerAgainstTab() {
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const skipped = [];

  let folded = null;
  try {
    folded = foldRegistrationLedger(readLedgerEntries());
  } catch (err) {
    skipped.push(`the ledger could not be read or folded (${err})`);
  }

  let tabRows = null;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
    tabRows = sheet ? getSectionedRows(sheet, headers, 'Event_ID') : [];
  } catch (err) {
    skipped.push(`${SHEET_NAMES.REGISTRANT_DASH} could not be read (${err})`);
  }

  if (!folded || !tabRows) {
    return {
      ok: false, checked: 0, folded: 0,
      missingFromFold: [], missingFromTab: [], disagreeing: [],
      problems: folded ? folded.problems : [], skipped: skipped
    };
  }

  const byKeyOnTab = {};
  tabRows.forEach(row => {
    if (isSupersededRegistrantRow(row, map)) return;
    const key = registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
    if (!key) return;
    // A duplicate key on the tab is 85's problem, not this file's: the first
    // row wins the comparison so a pair of duplicates is not also reported
    // here as a row the ledger has lost.
    if (byKeyOnTab[key] === undefined) byKeyOnTab[key] = row;
  });

  const byKeyInFold = {};
  folded.rows.forEach(row => {
    const key = registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
    if (key && byKeyInFold[key] === undefined) byKeyInFold[key] = row;
  });

  const missingFromFold = [];
  const missingFromTab = [];
  const disagreeing = [];

  Object.keys(byKeyOnTab).forEach(key => {
    const tabRow = byKeyOnTab[key];
    const foldRow = byKeyInFold[key];
    if (!foldRow) {
      missingFromFold.push(describeLedgerVerifyRow_(tabRow, map));
      return;
    }
    const differences = compareLedgerVerifyRows_(tabRow, foldRow, map);
    if (differences.length) {
      disagreeing.push(Object.assign(describeLedgerVerifyRow_(tabRow, map), { columns: differences }));
    }
  });

  Object.keys(byKeyInFold).forEach(key => {
    if (byKeyOnTab[key] !== undefined) return;
    missingFromTab.push(describeLedgerVerifyRow_(byKeyInFold[key], map));
  });

  return {
    ok: true,
    checked: Object.keys(byKeyOnTab).length,
    folded: Object.keys(byKeyInFold).length,
    missingFromFold: missingFromFold,
    missingFromTab: missingFromTab,
    disagreeing: disagreeing,
    problems: folded.problems || [],
    skipped: skipped
  };
}

/** "Joan Meier (Registrant) — Chair Yoga, Wed, Sep 16 (Ashbridge)", for a line somebody reads. */
function describeLedgerVerifyRow_(row, map) {
  const name = String(row[map['Name']] || '').trim() || '(unnamed)';
  const personType = String(row[map['Person_Type']] || '').trim() || 'Registrant';
  const event = String(row[map['Event']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  const date = coerceDate(row[map['Event_Date']]);
  return {
    name: name,
    where: `${event || 'an untitled session'}${date ? `, ${formatDateLabel(date)}` : ''}` +
      `${location ? ` (${location})` : ''}`,
    said: `${name} (${personType}) — ${event || 'an untitled session'}` +
      `${date ? `, ${formatDateLabel(date)}` : ''}${location ? ` (${location})` : ''}`
  };
}

/**
 * Which of LEDGER_VERIFY_COLUMNS two rows disagree about.
 *
 * COMPARED AS THE TAB WOULD READ THEM, not as JavaScript holds them: a date
 * against a date is a date key, a checkbox against the string "TRUE" is a
 * boolean (isCheckedTrue, 71 — the same rule a leader's hand-typed tick is
 * read by), a count against a blank is a number, and everything else is
 * trimmed text. Reporting `2` against `'2'` as a difference is how a report of
 * real faults becomes a report nobody opens.
 */
function compareLedgerVerifyRows_(tabRow, foldRow, map) {
  const differences = [];
  LEDGER_VERIFY_COLUMNS.forEach(header => {
    if (map[header] === undefined) return;
    const mine = ledgerVerifyValue_(tabRow[map[header]]);
    const theirs = ledgerVerifyValue_(foldRow[map[header]]);
    if (mine === theirs) return;
    differences.push(`${header}: the tab says ${ledgerVerifySay_(mine)}, the ledger says ${ledgerVerifySay_(theirs)}`);
  });
  return differences;
}

/** One cell, worn down to something two readers cannot disagree about by accident. */
function ledgerVerifyValue_(value) {
  const cell = ledgerCellValue_(value);
  if (cell === '') return '';
  if (cell === true || cell === false) return cell ? 'true' : 'false';
  const text = String(cell).trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase();
  if (text !== '' && !isNaN(Number(text))) return String(Number(text));
  return text;
}

/** How a value is printed in a finding — a blank said out loud rather than as nothing. */
function ledgerVerifySay_(value) {
  return value === '' ? '(blank)' : `"${value}"`;
}

/**
 * The comparison, run and filed for the office's 10am digest (88).
 *
 * CALLED AT THE END OF EVERY SYNC and guarded whole: the sync has by then done
 * everything that matters, and a verifier that threw would turn a clean run
 * into a reported failure over a diagnostic. Returns the result for a caller
 * that wants it (the menu item below), or null when it could not run at all.
 *
 * A CLEAN RUN FILES NOTHING. An hourly "the ledger agrees with the tab" is
 * twenty-four lines a day saying nothing happened, which is how a digest
 * stops being read — and 99g's whole argument is that the report nobody reads
 * is the report that is not there.
 */
function reportLedgerVerification() {
  let result;
  try {
    result = verifyLedgerAgainstTab();
  } catch (err) {
    log(`⚠️ The ledger verifier could not run (${err}).`);
    return null;
  }

  try {
    describeLedgerVerification(result).forEach(line =>
      spoolOfficeNote(LEDGER_VERIFY_DIGEST_SECTION, line));
  } catch (err) {
    log(`⚠️ The ledger verifier ran but could not be filed for the digest (${err}).`);
  }
  return result;
}

/**
 * The verifier's findings as lines a person reads. Empty when there is nothing
 * to say.
 *
 * THE THREE BUCKETS ARE THREE HEADINGS AND NOT ONE LIST, because the fix for
 * each is a different fix and a merged list is a list somebody has to sort
 * before they can start. Each is capped at LEDGER_VERIFY_MAX_LISTED and says
 * how many it did not print, because a bucket with four hundred rows in it is
 * a fault about the whole workbook rather than four hundred faults, and
 * printing it in full is how the other two buckets go unread.
 */
function describeLedgerVerification(result) {
  if (!result) return ['The ledger could not be checked against the Registrants tab at all this run.'];
  const lines = [];

  if (!result.ok || result.skipped.length) {
    result.skipped.forEach(why => lines.push(`⚠️ The ledger check was incomplete: ${why}.`));
    // A PARTIAL PASS IS NEVER DRAWN AS A CLEAN BILL OF HEALTH — 51's rule,
    // and the reason is the same: an empty bucket from a side that was never
    // read is the most misleading thing this file could print.
    if (!result.ok) return lines;
  }

  if (result.missingFromTab.length) {
    lines.push(`🚨 ${result.missingFromTab.length} registration(s) are in the ledger and NOT on ` +
      `${SHEET_NAMES.REGISTRANT_DASH}. Either a writer is recording something it does not write, or ` +
      `those rows have been lost from the tab — check them by name before anything else here.`);
    ledgerVerifyList_(result.missingFromTab.map(r => r.said)).forEach(line => lines.push(`   • ${line}`));
  }

  if (result.missingFromFold.length) {
    lines.push(`${result.missingFromFold.length} row(s) on ${SHEET_NAMES.REGISTRANT_DASH} have no ` +
      `registration in the ledger. Until the one-time backfill has been run (Admin \u25b8 One-Time Jobs \u25b8 ` +
      `Back-fill the Registration Ledger) that is every row written before the ledger existed; ` +
      `afterwards it is a writer that is not appending.`);
    ledgerVerifyList_(result.missingFromFold.map(r => r.said)).forEach(line => lines.push(`   • ${line}`));
  }

  if (result.disagreeing.length) {
    lines.push(`${result.disagreeing.length} registration(s) are on both and disagree.`);
    ledgerVerifyList_(result.disagreeing.map(r => `${r.said} — ${r.columns.join('; ')}`))
      .forEach(line => lines.push(`   • ${line}`));
  }

  if (result.problems.length) {
    lines.push(`${result.problems.length} ledger entr(ies) could not be replayed.`);
    ledgerVerifyList_(result.problems.map(p => `${p.kind || 'an entry'} on ${p.registrationId}: ${p.reason}`))
      .forEach(line => lines.push(`   • ${line}`));
  }

  return lines;
}

/** The first LEDGER_VERIFY_MAX_LISTED of a list, plus a line saying what was left off. */
function ledgerVerifyList_(items) {
  const shown = items.slice(0, LEDGER_VERIFY_MAX_LISTED);
  if (items.length > shown.length) shown.push(`…and ${items.length - shown.length} more`);
  return shown;
}

/**
 * The same check, on the menu, drawn in an alert.
 *
 * READ-ONLY AND UNGATED, like every other report in that submenu: the person
 * staring at a roster that is missing somebody is the person who should be
 * able to press it, and this writes nothing at all.
 */
function showLedgerVerificationReport() {
  const result = verifyLedgerAgainstTab();
  const lines = describeLedgerVerification(result);
  const body = lines.length
    ? lines.join('\n')
    : `The ledger and ${SHEET_NAMES.REGISTRANT_DASH} agree on all ${result.checked} live registration(s).`;
  try {
    SpreadsheetApp.getUi().alert('Registration ledger vs the Registrants tab',
      `${result.checked} row(s) on the tab, ${result.folded} registration(s) in the ledger.\n\n${body}`,
      SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    log(`Ledger verification (no UI available): ${body}`);
  }
  return result;
}
