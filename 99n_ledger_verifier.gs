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
// AND A THIRD SIDE, read only to keep bucket two honest: Deleted_Event_Triage.
// When a session's calendar event goes, moveRegistrantsToTriage() (26) moves
// its rows off All_Registrants and onto triage, and appends nothing to the
// ledger — so every one of them used to land in bucket two, and by November
// 2026 they were nearly nine in ten of the 1,200 the digest called missing.
// A triaged row is not lost: it is on a tab, with a note asking a person to
// confirm it. So a registration the fold holds and the tab does not, but
// triage DOES, is reported as ON TRIAGE and kept out of the 🚨 count. Only
// the ones dated today onward reach the digest, because those are the people
// on no roster for a session still ahead; the rest is history the triage tab
// already shows. A triage tab that could not be read is said, and its rows
// fall back into bucket two for that run rather than vanishing from it.
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
  'Attended', 'Lunch_Served'
];

/**
 * The columns of LEDGER_VERIFY_COLUMNS that are TICK BOXES, where an unticked
 * box and a blank cell mean the same thing. The tab writes `false` into a
 * checkbox column it has drawn and the fold leaves a field no entry ever set
 * blank, so without this every registration nobody marked is a disagreement.
 * Only these: a blank Program_Status or Meals_Ordered is a real difference.
 */
const LEDGER_VERIFY_CHECKBOX_COLUMNS = ['Attended', 'Lunch_Served'];

/** How many findings of each kind one run names before it says "and N more". */
const LEDGER_VERIFY_MAX_LISTED = 25;

/** The digest section every line of this report is filed under. */
const LEDGER_VERIFY_DIGEST_SECTION = 'Registration ledger';

/**
 * The statuses of somebody still expecting a seat — a Cancelled row parked on
 * triage is nobody's problem, and a blank reads as the fold's own default.
 * Words from PROGRAM_STATUS_OPTIONS (02), spelled out here because this file's
 * constants stand alone (see LOAD ORDER above).
 */
const LEDGER_VERIFY_HOLDING_STATUSES = ['Active', 'Waitlisted', ''];

/** How many programs the "on triage, still ahead" line names before it says "and N more". */
const LEDGER_VERIFY_TRIAGE_PROGRAMS_LISTED = 15;

/**
 * PAUSED IN THE SYNC (Nov 2026). The daily run filed about 94 lines a day into
 * the office digest (over a thousand "missing", a hundred disagreements, a
 * hundred and seventy entries it could not replay) and nobody was working
 * them: the triage report built to sort them had never been opened. A report
 * nobody acts on costs a fold of the whole ledger every day and buries the
 * lines in the digest that do need someone. So the sync no longer runs it.
 *
 * Nothing about the ledger itself changes: every writer still appends, and
 * the check is still one press away (Health panel, or the menu's ledger
 * report, showLedgerVerificationReport). Turning it back on is this one
 * function returning true, once the ledger is settled or the day phase 4 is
 * taken up again.
 */
function ledgerVerifyRunsInSync_() {
  return false;
}

/**
 * THE COMPARISON. Returns a plain object and writes nothing.
 *
 *   { ok, checked, folded, missingFromFold, missingFromTab, onTriage,
 *     disagreeing, problems, skipped }
 *
 * `onTriage` is the part of "in the fold, not on the tab" that is on
 * Deleted_Event_Triage instead: accounted for, so NOT in missingFromTab. Each
 * carries `dateKey`, `when` ('future' — today included — 'past' or
 * 'undated') and the fold's `status`, so the digest can name the ones still
 * ahead.
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
      missingFromFold: [], missingFromTab: [], onTriage: [], disagreeing: [],
      problems: folded ? folded.problems : [], skipped: skipped
    };
  }

  // The third side. Guarded on its own and NOT fatal: without it the check is
  // exactly what it was before triage was read, which is a worse answer and
  // still an answer — so it is said, and the run goes on.
  let onTriageIndex = {};
  try {
    onTriageIndex = ledgerVerifyTriageIndex_(readLedgerVerifyTriageRows_());
  } catch (err) {
    skipped.push(`${SHEET_NAMES.TRIAGE} could not be read (${err}), so rows parked there are counted as missing this run`);
  }
  const todayKey = formatDateKey(new Date());

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
  const onTriage = [];
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
    const foldRow = byKeyInFold[key];
    const described = describeLedgerVerifyRow_(foldRow, map);
    if (onTriageIndex[key] === undefined) {
      missingFromTab.push(described);
      return;
    }
    const dateKey = ledgerVerifyDateKey_(foldRow[map['Event_Date']]);
    onTriage.push(Object.assign(described, {
      event: String(foldRow[map['Event']] || '').trim() || 'an untitled session',
      location: String(foldRow[map['Location']] || '').trim(),
      dateKey: dateKey,
      when: !dateKey ? 'undated' : (dateKey >= todayKey ? 'future' : 'past'),
      status: String(foldRow[map['Program_Status']] || '').trim()
    }));
  });

  return {
    ok: true,
    checked: Object.keys(byKeyOnTab).length,
    folded: Object.keys(byKeyInFold).length,
    missingFromFold: missingFromFold,
    missingFromTab: missingFromTab,
    onTriage: onTriage,
    disagreeing: disagreeing,
    problems: folded.problems || [],
    skipped: skipped,
    // Checkpoint + tail against a full replay (99zq), for the validation
    // period before the fast path is trusted. Its own read, its own gate;
    // a difference is filed for the digest by 99zq itself, so a clean run
    // here still files nothing.
    checkpoint: ledgerVerifyCheckpoint_()
  };
}

/**
 * Deleted_Event_Triage's rows, in its own layout. Its own function so the
 * triage report (99zz) reads the tab the same way, and so a test can hand the
 * verifier a triage side without standing up a sheet.
 */
function readLedgerVerifyTriageRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.TRIAGE);
  return sheet ? getSectionedRows(sheet, HEADERS.Deleted_Event_Triage, 'Event_ID') : [];
}

/**
 * { registrantTombstoneKey: triage row } — the same key the other two sides
 * are matched on, built from triage's OWN column positions (it is a superset
 * of the Registrants layout, not the same one). A Superseded row is out of
 * scope here for the reason it is out of scope everywhere in this file.
 */
function ledgerVerifyTriageIndex_(triageRows) {
  const tMap = getIndexMap(HEADERS.Deleted_Event_Triage);
  const index = {};
  (triageRows || []).forEach(row => {
    if (isSupersededRegistrantRow(row, tMap)) return;
    const key = registrantTombstoneKey(row[tMap['Event_ID']], row[tMap['Name']], row[tMap['Person_Type']]);
    if (key && index[key] === undefined) index[key] = row;
  });
  return index;
}

/** A row's date as 'yyyy-MM-dd' — a folded row carries the Payload's string, a tab row a Date. */
function ledgerVerifyDateKey_(raw) {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  const date = coerceDate(raw);
  return date ? formatDateKey(date) : '';
}

/** validateLedgerCheckpoint(), guarded — a cache check must never cost the verifier its answer. */
function ledgerVerifyCheckpoint_() {
  try {
    return typeof validateLedgerCheckpoint === 'function' ? validateLedgerCheckpoint() : null;
  } catch (err) {
    return null;
  }
}

/** "Joan Meier (Registrant) — Chair Yoga, Wed, Sep 16 (Ashbridge)", for a line somebody reads. */
function describeLedgerVerifyRow_(row, map) {
  const name = String(row[map['Name']] || '').trim() || '(unnamed)';
  const personType = String(row[map['Person_Type']] || '').trim() || 'Registrant';
  const event = String(row[map['Event']] || '').trim();
  const location = String(row[map['Location']] || '').trim();
  // A folded row carries its date as the Payload's 'yyyy-MM-dd' string, and
  // `new Date('2026-09-16')` is UTC midnight — the evening before, in TIMEZONE.
  // parseDateKey reads it as the local date it names.
  const rawDate = row[map['Event_Date']];
  const date = typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())
    ? parseDateKey(rawDate.trim())
    : coerceDate(rawDate);
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
    if (LEDGER_VERIFY_CHECKBOX_COLUMNS.indexOf(header) !== -1 &&
        (mine === '' || mine === 'false') && (theirs === '' || theirs === 'false')) return;
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

  // ON TRIAGE, STILL AHEAD. Not lost and not a writer fault, so no 🚨 — but
  // these are people on no roster for a session that has not happened, which
  // is worth a line every day until somebody restores or confirms them. Named
  // by PROGRAM, not by person: the fix is per program (a rename, a move, a
  // deleted series), and a list of four hundred names is a list nobody reads.
  // Past-dated triage rows file nothing; the triage tab already shows them.
  const ahead = (result.onTriage || []).filter(r => r.when === 'future' && LEDGER_VERIFY_HOLDING_STATUSES.indexOf(r.status) !== -1);
  if (ahead.length) {
    lines.push(`📥 ${ahead.length} registration(s) for today onward are on ${SHEET_NAMES.TRIAGE}, ` +
      `not on ${SHEET_NAMES.REGISTRANT_DASH}. They are not lost — their session was renamed, moved or ` +
      `taken off the calendar — but nobody on them is on a roster until the office restores or confirms them.`);
    const byProgram = {};
    const order = [];
    ahead.forEach(r => {
      const label = `${r.event}${r.location ? ` (${r.location})` : ''}`;
      if (!byProgram[label]) { byProgram[label] = { count: 0, first: r.dateKey }; order.push(label); }
      byProgram[label].count++;
      if (r.dateKey && r.dateKey < byProgram[label].first) byProgram[label].first = r.dateKey;
    });
    order.sort((a, b) => byProgram[b].count - byProgram[a].count || (a < b ? -1 : 1));
    const shown = order.slice(0, LEDGER_VERIFY_TRIAGE_PROGRAMS_LISTED).map(label =>
      `${label}: ${byProgram[label].count}, from ${byProgram[label].first}`);
    if (order.length > shown.length) shown.push(`…and ${order.length - shown.length} more program(s)`);
    shown.forEach(line => lines.push(`   • ${line}`));
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
  const checkpointLine = result.checkpoint && typeof describeLedgerCheckpointValidation_ === 'function'
    ? `\n\n${describeLedgerCheckpointValidation_(result.checkpoint)}` : '';
  const parked = (result.onTriage || []).length;
  const triageLine = parked ? ` ${parked} of the ledger's are on ${SHEET_NAMES.TRIAGE} instead, and count as accounted for.` : '';
  const text = `${result.checked} row(s) on the tab, ${result.folded} registration(s) in the ledger.${triageLine}\n\n${body}${checkpointLine}`;
  log(`Ledger verification: ${body}`);
  presentReport_('Registration ledger vs the Registrants tab', text);
  return result;
}
