// ============================================================================
// SECTION 99za — IS THE LEDGER STILL GROWING FOR NOTHING, AND COMPACTING IT
// ============================================================================
//
// The registration ledger (99k) is append-only, and for most of September one
// of its writers appended an identical `corrected` entry per every-date and
// club registration on EVERY sync (fixed in 29 on 2026-09-28: the re-seen
// response branch now appends only when the row's payload moved). The fix
// stopped the flood; it did not take back what the flood had already written,
// and nothing on screen said whether some OTHER writer was still doing it.
// This file answers both.
//
// WHAT "REDUNDANT" MEANS HERE IS EXACT, not a heuristic: an entry is redundant
// when replaying it, at the point the replay reaches it, changes NOTHING about
// its registration — not the row, not whether it is dead. Such an entry can be
// taken out and the replay of every entry after it is unchanged, by
// construction: the fold is a sequential function of (state, entry), and the
// state it hands on is the state it was given. So compaction here is LOSSLESS
// for the fold — every registration folds to the identical row with or
// without the dropped entries — and it is checked, not assumed:
// compactRegistrationLedger() folds the whole ledger both ways and refuses to
// write anything if a single row differs.
//
// How "at that point" is computed cheaply: the running state of each
// registration is re-expressed as a CHECKPOINT — a `registered` entry whose
// Payload is every column of the folded row, which is §1.6's own shape — and
// the candidate entry is folded onto that checkpoint alone. One two-entry fold
// per entry, instead of re-folding a registration's whole history for each of
// its entries (which on a registration with five hundred hourly corrections is
// the difference between a second and the six-minute ceiling).
//
// WHAT IS NEVER TOUCHED:
//   - A registration named by a `merged` entry (either side). A merge reaches
//     across two registrations and the per-registration replay above cannot
//     see both; those histories are kept whole.
//   - The first entry of a registration, and any entry the replay could not
//     place (no registration yet, an unknown kind, a row that did not parse).
//     "Changes nothing" is only claimed where it has been measured.
//   - Entries that DO change something, however often they appear. A column
//     that flips A→B→A every hour is a live bug in a writer, not dead weight;
//     the report names it (the note on a catch-up correction lists the columns
//     that moved — 29) so it can be fixed at the source.
//
// NOTHING IS DELETED FROM DRIVE (§1.6). Every dropped row is written, whole,
// to a dated CSV in the `Ledger Archive` folder BEFORE the tab is rewritten,
// and a CSV that cannot be written stops the compaction.
//
// Behavior only, numbered last for the usual reason. Its constants stand
// alone; everything it reaches for (the ledger's reader, fold and flush in
// 99k, workbookLock in 99w, getOrCreateSystemFolder in 82) it reads at CALL
// time or through a hoisted function declaration.
// ============================================================================

/** The Drive folder the dropped entries are archived into. */
const LEDGER_ARCHIVE_FOLDER_NAME = 'Ledger Archive';

/**
 * `<anchor>/System/Ledger Archive` (`82`'s 82b). System-only: an archive read
 * after the fact, by name, if ever.
 */
function getOrCreateLedgerArchiveFolder() {
  return getOrCreateSystemFolder(LEDGER_ARCHIVE_FOLDER_NAME, null, { systemOnly: true });
}

/** How many days back the growth report tabulates, newest first. */
const LEDGER_GROWTH_REPORT_DAYS = 14;

/** "Recent", for the question "is it STILL growing": the last this-many days. */
const LEDGER_GROWTH_RECENT_DAYS = 2;

/** How many churning registrations / columns the report names before "and N more". */
const LEDGER_GROWTH_MAX_LISTED = 10;


// --- the analysis (pure: rows in, verdicts out) ------------------------------

/**
 * Reads the ledger tab's raw values into entries that remember their row.
 *
 * Returned beside the header so the rewrite can put back exactly the rows it
 * read. A row that does not parse (no Kind or no Registration_ID) is carried
 * as `null` and is always kept — this file never drops what it cannot read —
 * except a row that is blank in every cell, which is not an entry at all.
 */
function ledgerCompactionRowsToEntries_(values) {
  const headers = (values[0] || []).map(cell => normalizeHeaderText(cell));
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const raw = values[i];
    const blank = raw.every(cell => cell === '' || cell === null || cell === undefined);
    const entry = blank ? null : ledgerRowToEntry(raw, headers);
    if (entry) entry.__row = i;
    out.push({ row: i, blank: blank, entry: entry });
  }
  return { headers: headers, items: out };
}

/** A folded registration state as one comparable string. */
function ledgerStateSignature_(state) {
  if (!state) return 'none';
  return JSON.stringify([!!state.dead, state.deadBy || '', state.row]);
}

/**
 * The folded state of ONE registration re-expressed as a single `registered`
 * entry: identity in the entry's own fields, every column (blanks included) in
 * the Payload. Folding it alone reproduces the row — which is what lets the
 * next entry be judged against a two-entry fold.
 */
function ledgerCheckpointEntry_(state, map) {
  const row = state.row;
  const payload = {};
  Object.keys(map).forEach(header => {
    if (LEDGER_PAYLOAD_RESERVED_KEYS.indexOf(header) !== -1) return;
    payload[header] = row[map[header]];
  });
  return {
    entryId: '__checkpoint', entryAt: null, occurredAt: null,
    kind: LEDGER_KINDS.REGISTERED,
    registrationId: state.registrationId,
    eventId: row[map['Event_ID']] || '',
    name: row[map['Name']] || '',
    personType: row[map['Person_Type']] || '',
    partyId: map['Party_ID'] === undefined ? '' : (row[map['Party_ID']] || ''),
    source: LEDGER_SOURCES.MIGRATION, actor: '', note: '',
    payload: payload
  };
}

/** A deep-enough copy of an entry, so a fold (which may edit a Payload) cannot reach the original. */
function cloneLedgerEntry_(entry) {
  const copy = Object.assign({}, entry);
  copy.payload = entry.payload ? JSON.parse(JSON.stringify(entry.payload)) : {};
  return copy;
}

/**
 * THE VERDICT: which entries change nothing.
 *
 *   analyzeLedgerRedundancy(entries) -> { redundant: Set<entry>, reasons: Map<entry, string>, skipped }
 *
 * `entries` are ledgerRowToEntry() shapes; they are not modified. Walked in
 * the fold's own order (sortLedgerEntries_), per registration.
 */
function analyzeLedgerRedundancy(entries) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const sorted = sortLedgerEntries_(entries);

  // Registrations a merge reaches across: kept whole.
  const untouchable = {};
  sorted.forEach(entry => {
    if (entry.kind !== LEDGER_KINDS.MERGED) return;
    untouchable[entry.registrationId] = true;
    const absorbed = String((entry.payload && entry.payload.absorbed) || '').trim();
    if (absorbed) untouchable[absorbed] = true;
  });

  const current = {};            // registrationId -> folded state after the kept entries so far
  const redundant = new Set();
  const reasons = new Map();
  let skipped = 0;

  sorted.forEach(entry => {
    const id = entry.registrationId;
    if (untouchable[id]) { skipped++; return; }
    if (LEDGER_ENTRY_KINDS.indexOf(entry.kind) === -1) return;

    const state = current[id];
    if (!state) {
      // The registration's first placed entry. Only a `registered` places one;
      // anything else before it is an entry the replay drops — kept, because
      // "changes nothing" was not measured against anything.
      if (entry.kind !== LEDGER_KINDS.REGISTERED) return;
      const fold = foldRegistrationLedger([cloneLedgerEntry_(entry)]);
      current[id] = fold.states[id] || null;
      return;
    }

    if (state.dead) {
      // The replay ignores everything after a registration dies (99k).
      redundant.add(entry);
      reasons.set(entry, `after the registration was ${state.deadBy}`);
      return;
    }

    const before = ledgerStateSignature_(state);
    const fold = foldRegistrationLedger([ledgerCheckpointEntry_(state, map), cloneLedgerEntry_(entry)]);
    const next = fold.states[id];
    if (ledgerStateSignature_(next) === before) {
      redundant.add(entry);
      reasons.set(entry, 'changed nothing');
      return;
    }
    current[id] = next;
  });

  return { redundant: redundant, reasons: reasons, skipped: skipped };
}

/**
 * THE CHECK THE WRITE DEPENDS ON: do these two entry lists fold to the same
 * registrations? Compared per id — alive or dead, and every cell of the row.
 * Returns '' when they agree, otherwise the first difference in words.
 */
function compareLedgerFolds_(allEntries, keptEntries) {
  const a = foldRegistrationLedger(allEntries.map(cloneLedgerEntry_)).states;
  const b = foldRegistrationLedger(keptEntries.map(cloneLedgerEntry_)).states;
  const ids = Object.keys(Object.assign({}, a, b));
  for (let i = 0; i < ids.length; i++) {
    if (ledgerStateSignature_(a[ids[i]]) !== ledgerStateSignature_(b[ids[i]])) {
      return `registration ${ids[i]} folds differently without the dropped entries`;
    }
  }
  return '';
}


// --- the growth report --------------------------------------------------------

/** yyyy-MM-dd in the workbook's timezone, or '' for an entry with no Entry_At. */
function ledgerEntryDayKey_(entry) {
  const at = coerceDate(entry && entry.entryAt);
  return at ? Utilities.formatDate(at, TIMEZONE, 'yyyy-MM-dd') : '';
}

/**
 * The numbers behind "is it still growing for nothing?" — pure, so a test can
 * hand it entries. `now` is injectable for the same reason.
 */
function summarizeLedgerGrowth(entries, analysis, now) {
  const today = now || new Date();
  const days = [];
  for (let d = 0; d < LEDGER_GROWTH_REPORT_DAYS; d++) {
    const day = new Date(today.getTime() - d * 86400000);
    days.push(Utilities.formatDate(day, TIMEZONE, 'yyyy-MM-dd'));
  }
  const recentDays = days.slice(0, LEDGER_GROWTH_RECENT_DAYS);

  const perDay = {};
  days.forEach(day => { perDay[day] = { total: 0, redundant: 0 }; });
  const recentRedundantBy = {};     // "kind / source" -> count
  const recentChangedPerReg = {};   // registrationId -> { count, name, columns: {} }

  entries.forEach(entry => {
    const day = ledgerEntryDayKey_(entry);
    const isRedundant = analysis.redundant.has(entry);
    if (perDay[day]) {
      perDay[day].total++;
      if (isRedundant) perDay[day].redundant++;
    }
    if (recentDays.indexOf(day) === -1) return;
    if (isRedundant) {
      const k = `${entry.kind} / ${entry.source || '(no source)'}`;
      recentRedundantBy[k] = (recentRedundantBy[k] || 0) + 1;
    } else if (entry.kind === LEDGER_KINDS.CORRECTED) {
      const reg = recentChangedPerReg[entry.registrationId] ||
        (recentChangedPerReg[entry.registrationId] = { count: 0, name: entry.name, source: entry.source, columns: {} });
      reg.count++;
      const moved = /changed:\s*(.+?)\.?$/.exec(entry.note || '');
      const cols = moved ? moved[1].split(/,\s*/) : Object.keys(entry.payload || {});
      cols.forEach(c => { if (c) reg.columns[c] = (reg.columns[c] || 0) + 1; });
    }
  });

  // A registration corrected more than once a day, on average, over the
  // recent window is churning: nobody edits a registration that often.
  const churning = Object.keys(recentChangedPerReg)
    .map(id => Object.assign({ id: id }, recentChangedPerReg[id]))
    .filter(reg => reg.count > LEDGER_GROWTH_RECENT_DAYS)
    .sort((x, y) => y.count - x.count);

  const recentRedundant = recentDays.reduce((n, day) => n + perDay[day].redundant, 0);
  return {
    total: entries.length,
    redundantTotal: analysis.redundant.size,
    days: days, perDay: perDay,
    recentDays: recentDays, recentRedundant: recentRedundant,
    recentRedundantBy: recentRedundantBy,
    churning: churning
  };
}

/** The report's words. */
function describeLedgerGrowth(summary, analysis) {
  const lines = [];
  const stillGrowing = summary.recentRedundant > 0 || summary.churning.length > 0;
  lines.push(stillGrowing
    ? `YES — still growing needlessly: ${summary.recentRedundant} entr(ies) in the last ` +
      `${LEDGER_GROWTH_RECENT_DAYS} day(s) changed nothing` +
      (summary.churning.length ? `, and ${summary.churning.length} registration(s) are being corrected over and over.` : '.')
    : `NO — nothing appended in the last ${LEDGER_GROWTH_RECENT_DAYS} day(s) was redundant.`);
  lines.push('');
  lines.push(`${summary.total} entries in all; ${summary.redundantTotal} change nothing and can be compacted away` +
    (analysis.skipped ? ` (${analysis.skipped} on merged registrations were not examined).` : '.'));
  lines.push('');
  lines.push('Per day (appended / of which redundant):');
  summary.days.forEach(day => {
    const d = summary.perDay[day];
    if (d.total) lines.push(`  ${day}: ${d.total} / ${d.redundant}`);
  });

  const by = Object.keys(summary.recentRedundantBy).sort((a, b) => summary.recentRedundantBy[b] - summary.recentRedundantBy[a]);
  if (by.length) {
    lines.push('');
    lines.push(`Redundant in the last ${LEDGER_GROWTH_RECENT_DAYS} day(s), by kind / source (the writer to look at):`);
    by.slice(0, LEDGER_GROWTH_MAX_LISTED).forEach(k => lines.push(`  ${k}: ${summary.recentRedundantBy[k]}`));
  }

  if (summary.churning.length) {
    lines.push('');
    lines.push('Corrected over and over (a column something keeps reverting between syncs):');
    summary.churning.slice(0, LEDGER_GROWTH_MAX_LISTED).forEach(reg => {
      const cols = Object.keys(reg.columns).sort((a, b) => reg.columns[b] - reg.columns[a]).slice(0, 4);
      lines.push(`  ${reg.name || reg.id} — ${reg.count}× via ${reg.source || '?'}: ${cols.join(', ')}`);
    });
    if (summary.churning.length > LEDGER_GROWTH_MAX_LISTED) {
      lines.push(`  …and ${summary.churning.length - LEDGER_GROWTH_MAX_LISTED} more.`);
    }
  }
  return lines;
}

/** Reads the tab. Returns null (and says why) when there is nothing to read. */
function readLedgerForCompaction_() {
  const sheet = registrationLedgerSheet(false);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return null;
  const parsed = ledgerCompactionRowsToEntries_(values);
  const entries = parsed.items.filter(item => item.entry).map(item => item.entry);
  return { sheet: sheet, values: values, items: parsed.items, entries: entries };
}

/**
 * 🔧 Admin ▸ 📄 Reports ▸ Is the Ledger Still Growing? — read-only, ungated.
 */
function reportLedgerGrowth() {
  flushLedger();
  const read = readLedgerForCompaction_();
  let body;
  let summary = null;
  if (!read) {
    body = `There is no ${SHEET_NAMES.REGISTRATION_LEDGER} tab, or it has no entries yet.`;
  } else {
    const analysis = analyzeLedgerRedundancy(read.entries);
    summary = summarizeLedgerGrowth(read.entries, analysis);
    body = describeLedgerGrowth(summary, analysis).join('\n');
  }
  log(`Ledger growth report:\n${body}`);
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Is the registration ledger still growing?', body, ui.ButtonSet.OK);
  } catch (err) {
    // No UI (a trigger or the editor): the log line above is the answer.
  }
  return summary;
}


// --- the compaction -----------------------------------------------------------

/** The dropped rows, whole, as a CSV in Drive. Returns the file name, or '' when it could not be written. */
function archiveCompactedLedgerRows_(headerRow, rows) {
  try {
    const csv = [headerRow].concat(rows).map(row => row.map(cell => {
      let text = cell === null || cell === undefined ? '' : cell;
      if (Object.prototype.toString.call(text) === '[object Date]') {
        text = Utilities.formatDate(text, TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
      }
      return `"${String(text).replace(/"/g, '""')}"`;
    }).join(',')).join('\n');
    const stamp = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd_HHmm');
    const name = `${SHEET_NAMES.REGISTRATION_LEDGER} compacted ${stamp} (${rows.length} entries).csv`;
    const folder = getOrCreateLedgerArchiveFolder();
    if (!folder) return '';
    folder.createFile(name, csv, MimeType.CSV);
    return name;
  } catch (err) {
    log(`⚠️ Ledger compaction: could not archive the dropped entries (${err}).`);
    return '';
  }
}

/**
 * 🔧 Admin ▸ 🧨 Destructive ▸ Compact the Registration Ledger… — gated, asks first.
 *
 * Removes only the entries analyzeLedgerRedundancy() proves change nothing,
 * after (1) folding the ledger with and without them and finding every
 * registration identical, and (2) archiving them to Drive. Under the workbook
 * lock, and it re-checks the tab's length just before writing: the onEdit
 * appender (18) does not take the lock, and a row appended between the read and
 * the write would otherwise be overwritten.
 */
function compactRegistrationLedger() {
  if (!requireAuthorizedAdmin('Compact Registration Ledger')) return 0;
  const lock = workbookLock('Compact Registration Ledger');
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('compactRegistrationLedger: another sync is already running — skipping.');
    explainRefusal('A sync is running, so the ledger was not compacted. Try again when it has finished.');
    return 0;
  }
  try {
    return compactRegistrationLedgerLocked_();
  } finally {
    lock.releaseLock();
  }
}

function compactRegistrationLedgerLocked_() {
  flushLedger();
  const read = readLedgerForCompaction_();
  if (!read) {
    toastIfPossible('The ledger has no entries — nothing to compact.');
    return 0;
  }

  const analysis = analyzeLedgerRedundancy(read.entries);
  const blankRows = read.items.filter(item => item.blank).length;
  if (!analysis.redundant.size && !blankRows) {
    toastIfPossible('Every ledger entry changes something — nothing to compact.');
    return 0;
  }

  const keptItems = read.items.filter(item => !item.blank && !(item.entry && analysis.redundant.has(item.entry)));
  const droppedItems = read.items.filter(item => item.entry && analysis.redundant.has(item.entry));

  // THE PROOF, on fresh parses of the same rows.
  const fresh = rows => ledgerCompactionRowsToEntries_([read.values[0]].concat(rows))
    .items.filter(item => item.entry).map(item => item.entry);
  const mismatch = compareLedgerFolds_(
    fresh(read.items.map(item => read.values[item.row])),
    fresh(keptItems.map(item => read.values[item.row])));
  if (mismatch) {
    log(`⚠️ Ledger compaction refused: ${mismatch}. Nothing was changed.`);
    explainRefusal(`Compaction refused: removing the redundant entries would change the replay (${mismatch}). Nothing was changed.`);
    return 0;
  }

  const byReason = {};
  droppedItems.forEach(item => {
    const why = analysis.reasons.get(item.entry) || 'changed nothing';
    const k = `${item.entry.kind} (${why})`;
    byReason[k] = (byReason[k] || 0) + 1;
  });
  const reasonLines = Object.keys(byReason).sort((a, b) => byReason[b] - byReason[a])
    .map(k => `  ${k}: ${byReason[k]}`);

  if (!confirmConsequentialAction('Compact the registration ledger?',
    `${read.entries.length} entries; ${droppedItems.length} change nothing and would be removed` +
    (blankRows ? ` (plus ${blankRows} blank row(s))` : '') + `:\n${reasonLines.join('\n')}\n\n` +
    `Every registration replays to exactly the same row without them — checked just now. ` +
    `The removed rows are saved first as a CSV in the "${LEDGER_ARCHIVE_FOLDER_NAME}" Drive folder.`, false)) {
    return 0;
  }

  const archived = droppedItems.length
    ? archiveCompactedLedgerRows_(read.values[0], droppedItems.map(item => read.values[item.row]))
    : '(none needed)';
  if (!archived) {
    explainRefusal('The ledger was not compacted: the entries it would remove could not be saved to Drive first.');
    return 0;
  }

  const sheet = read.sheet;
  if (sheet.getLastRow() !== read.values.length) {
    log('⚠️ Ledger compaction: the tab changed while it was being checked — nothing was written.');
    explainRefusal('The ledger was not compacted: something appended to it while it was being checked. Run it again.');
    return 0;
  }

  // ONE write over the whole old range: the kept rows, then blanks. The tab is
  // never half-rewritten (99u's rule), and a kill after it leaves only blank
  // rows, which the reader skips.
  const width = read.values[0].length;
  const oldCount = read.values.length - 1;
  const out = keptItems.map(item => read.values[item.row]);
  while (out.length < oldCount) out.push(new Array(width).fill(''));
  sheet.getRange(2, 1, oldCount, width).setValues(out);
  const spare = oldCount - keptItems.length;
  if (spare > 0) {
    try {
      sheet.deleteRows(keptItems.length + 2, spare);
    } catch (err) {
      log(`ℹ️ Ledger compaction: the ${spare} emptied row(s) could not be deleted (${err}) — they are blank and harmless.`);
    }
  }
  invalidateLedgerFold();

  const summary = `Ledger compacted: ${droppedItems.length} redundant entr(ies) removed` +
    (blankRows ? ` and ${blankRows} blank row(s)` : '') +
    `, ${keptItems.length} kept. Archived to "${LEDGER_ARCHIVE_FOLDER_NAME}/${archived}".`;
  log(summary);
  spoolOfficeNote('Registration ledger', summary);
  toastIfPossible(summary);
  return droppedItems.length;
}
