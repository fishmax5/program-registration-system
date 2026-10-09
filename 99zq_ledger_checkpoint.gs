// =============================================================================
// THE LEDGER CHECKPOINT (99zq) — a fold written down, so the next fold reads
// only the tail.
// =============================================================================
//
// ledgerFoldNow() (99k) answered every "which registration is this row?" by
// reading the WHOLE Registration_Ledger tab and replaying it from the first
// entry. The tab only grows, so every desk mark, every sync and every backfill
// slice paid for the whole history, and paid more every week.
//
// So, nightly (appended to 99j's 3am snapshot — no trigger of its own), the
// fold's working state is written to the Ledger_Checkpoint tab with the ledger
// row it covers through; a fold then loads that state and replays only the rows
// after it, read with ONE ranged getRange() rather than getDataRange().
//
// THE RULE THIS FILE MAY NOT BREAK: THE LEDGER IS THE ONLY SECOND COPY OF EVERY
// REGISTRATION, AND NOTHING HERE WRITES TO IT. The checkpoint is a derived
// cache. Deleting its tab, blanking its meta property, or turning the fast
// path off puts every reader back on the full fold and changes nothing else.
// docs/transitions/R8_ledger_checkpoint.md is the full argument; the short
// form of each guard is beside the code it guards.
//
// WHY CHECKPOINT + TAIL EQUALS A FULL FOLD. The fold sorts by (Entry_At, sheet
// order) and applies entries one by one to { states, order, problems } (split
// out of foldRegistrationLedger() for exactly this, 99k). Carrying a saved
// context on with the tail equals the full fold exactly when the tail sorts
// AFTER everything covered: every tail entry dated, and none dated before the
// latest covered Entry_At. That is not guaranteed — Entry_At is stamped when an
// entry is COMPOSED and it reaches the tab when its execution FLUSHES, and 18's
// onEdit appender takes no lock — so it is CHECKED on every fast fold, and a
// tail that fails it is folded the slow way.
//
// AND THE FAST PATH IS NOT TRUSTED UNTIL IT HAS EARNED IT. ledgerFoldNow() uses
// it only once LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED distinct days of
// comparisons (validateLedgerCheckpoint(), run by the nightly build and by
// 99n's verifier) have found checkpoint + tail identical to a full fold. One
// difference empties the count, invalidates the checkpoint and says so in the
// digest. Until then this file costs one extra fold a night and nothing else.
//
// Numbered 99zq for the usual reason — never renumber. Safe there: behavior
// plus self-contained constants; its schema (SHEET_NAMES.LEDGER_CHECKPOINT) is
// in 03, and everything it reaches for (99k's fold pieces and readers, 99w's
// lock, 99za's clone, 88's spool) it reads at CALL time.
// =============================================================================

const LEDGER_CHECKPOINT_META_PROP_KEY = 'LEDGER_CHECKPOINT_META_V1';
const LEDGER_CHECKPOINT_GATE_PROP_KEY = 'LEDGER_CHECKPOINT_GATE_V1';

/** Distinct clean days of comparison before ledgerFoldNow() may use the checkpoint. */
const LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED = 30;

/** The tab's header. Generation is on every row: it is how a half-written tab is told from a whole one. */
const LEDGER_CHECKPOINT_HEADERS = Object.freeze(['Generation', 'Kind', 'Registration_ID', 'State']);

/** A Sheets cell holds 50 000 characters; a build that would come near that refuses rather than truncates. */
const LEDGER_CHECKPOINT_MAX_CELL_CHARS = 45000;

/** How long the 3am build waits for the workbook. A night skipped is a longer tail tomorrow, nothing worse. */
const LEDGER_CHECKPOINT_LOCK_WAIT_MS = 30000;

/**
 * Columns NOT compared when judging checkpoint + tail against a full fold.
 * 71's stampers write "Cancelled … on <date>" with the date the FOLD runs, so
 * two full folds either side of midnight already disagree here; a checkpoint
 * freezes the night it was built. Same reason 99n leaves the column out.
 */
const LEDGER_CHECKPOINT_UNCOMPARED_COLUMNS = Object.freeze(['Admin_Notes']);


// --- reading the ledger with its row numbers ---------------------------------

/**
 * The whole ledger, as { headers, items: [{ row, entry, entryIdCell }], lastRow }.
 * readLedgerEntries() (99k) without dropping where each entry sits, which the
 * checkpoint needs and nobody else does. Returns null for no tab.
 */
function readLedgerWithRows_() {
  const sheet = registrationLedgerSheet(false);
  if (!sheet) return null;
  const values = sheet.getDataRange().getValues();
  if (!values || !values.length) return { headers: [], items: [], lastRow: 0 };
  const headers = values[0].map(cell => normalizeHeaderText(cell));
  return { headers: headers, items: ledgerItemsFromValues_(values.slice(1), headers, 2), lastRow: values.length };
}

/** Rows of the tab, the first at sheet row `firstRow`, as items. Pure. */
function ledgerItemsFromValues_(rows, headers, firstRow) {
  const idCol = headers.indexOf('Entry_ID');
  return (rows || []).map((cells, i) => ({
    row: firstRow + i,
    entry: ledgerRowToEntry(cells, headers),
    entryIdCell: idCol === -1 ? '' : String(cells[idCol] || '').trim()
  }));
}

function ledgerCheckpointEntryTime_(entry) {
  const at = entry ? coerceDate(entry.entryAt) : null;
  return at ? at.getTime() : null;
}


// --- building one (pure) -------------------------------------------------------

/**
 * Folds `items` up to and including the anchor and returns everything needed
 * to write it down. Pure: { ok, reason } or { ok, ctx, meta, coveredEntries }.
 *
 * THE ANCHOR is the last row carrying an Entry_ID. Covered is EXACTLY the rows
 * at or above it — an entry folded into the checkpoint and then read again as
 * tail would be applied twice, which for a `registered` is a reactivation that
 * never happened.
 *
 * Refused while any covered entry is undated: the fold's comparator places an
 * undated entry by position only, which is not a total order, so no promise can
 * be made about where a later entry lands relative to it.
 */
function buildLedgerCheckpointFromItems_(items, generation) {
  let anchor = null;
  (items || []).forEach(item => { if (item.entry && item.entryIdCell) anchor = item; });
  if (!anchor) return { ok: false, reason: 'the ledger has no entry with an Entry_ID to anchor on' };

  const covered = items.filter(item => item.entry && item.row <= anchor.row).map(item => item.entry);
  let maxAt = null;
  for (let i = 0; i < covered.length; i++) {
    const at = ledgerCheckpointEntryTime_(covered[i]);
    if (at === null) return { ok: false, reason: `entry ${covered[i].entryId || '(no id)'} has no Entry_At` };
    if (maxAt === null || at > maxAt) maxAt = at;
  }

  const ctx = foldLedgerEntriesInto_(newLedgerFoldContext_(),
    sortLedgerEntries_(covered.map(ledgerCheckpointCloneEntry_)));

  return {
    ok: true,
    ctx: ctx,
    coveredEntries: covered.length,
    meta: {
      generation: generation,
      builtAt: new Date().toISOString(),
      coveredThroughRow: anchor.row,
      coveredEntries: covered.length,
      lastEntryId: anchor.entryIdCell,
      maxEntryAtMs: maxAt,
      headers: HEADERS.All_Registrants.slice()
    }
  };
}

/** The fold mutates what it is handed (an unreadable Payload is deleted); it is never handed the caller's entries. */
function ledgerCheckpointCloneEntry_(entry) {
  if (typeof cloneLedgerEntry_ === 'function') return cloneLedgerEntry_(entry);
  const copy = Object.assign({}, entry);
  copy.payload = entry.payload ? JSON.parse(JSON.stringify(entry.payload)) : {};
  return copy;
}

/**
 * A fold context as the tab's rows. Pure.
 *
 * Every state is written, DEAD ones too: ledgerRegistrationIdsByKey() (99k) and
 * the backfill (99o) read dead states, and an entry in the tail against a dead
 * id must still be the "not resurrected" problem a full fold reports.
 */
function ledgerCheckpointRowsFromContext_(ctx, generation) {
  const rows = [];
  ctx.order.forEach((id, i) => {
    const state = ctx.states[id];
    if (!state) return;
    rows.push([generation, 'state', id, JSON.stringify({
      o: i, d: !!state.dead, b: state.deadBy || '',
      r: state.row.map(ledgerCheckpointEncodeCell_)
    })]);
  });
  ctx.problems.forEach(problem => {
    rows.push([generation, 'problem', problem.registrationId || '', JSON.stringify(problem)]);
  });
  return rows;
}

/** Nothing the fold writes today is a Date, but a Date through JSON comes back a string, and silently. */
function ledgerCheckpointEncodeCell_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return { $d: value.getTime() };
  return value === undefined ? '' : value;
}

function ledgerCheckpointDecodeCell_(value) {
  if (value && typeof value === 'object' && typeof value.$d === 'number') return new Date(value.$d);
  return value;
}

/**
 * The tab's rows back as a fold context, or { error }. Pure.
 *
 * THE GENERATION AND THE COUNTS MUST MATCH THE META. The tab is written whole
 * first and the meta last, so a build killed in between leaves rows carrying a
 * generation the meta does not name — refused here, and the reader folds the
 * slow way. There is no such thing as half a checkpoint.
 *
 * The rows were written in the meta's header order; a column added to
 * HEADERS.All_Registrants since is mapped by NAME and reads back blank, which
 * is what the full fold leaves a column nobody's Payload has set.
 */
function ledgerCheckpointContextFromRows_(rows, meta) {
  if (!meta || !meta.generation) return { error: 'no checkpoint has been built' };
  const states = {};
  const ordered = [];
  const problems = [];
  const savedHeaders = Array.isArray(meta.headers) ? meta.headers : HEADERS.All_Registrants;
  const headers = HEADERS.All_Registrants;
  const savedIndex = {};
  savedHeaders.forEach((h, i) => { savedIndex[h] = i; });

  for (let i = 0; i < (rows || []).length; i++) {
    const cells = rows[i];
    if (!cells || cells.every(cell => cell === '' || cell === null)) continue;
    if (String(cells[0]) !== String(meta.generation)) {
      return { error: 'the checkpoint tab does not match its last completed build' };
    }
    let data;
    try {
      data = JSON.parse(String(cells[3] || ''));
    } catch (err) {
      return { error: `checkpoint row ${i + 2} is not readable` };
    }
    const kind = String(cells[1] || '');
    if (kind === 'problem') {
      problems.push(data);
    } else if (kind === 'state') {
      const id = String(cells[2] || '');
      const saved = Array.isArray(data.r) ? data.r.map(ledgerCheckpointDecodeCell_) : [];
      const row = headers.map(h => (savedIndex[h] === undefined ? '' : (saved[savedIndex[h]] === undefined ? '' : saved[savedIndex[h]])));
      states[id] = { registrationId: id, row: row, dead: !!data.d, deadBy: data.b || '' };
      ordered.push({ id: id, o: Number(data.o) });
    } else {
      return { error: `checkpoint row ${i + 2} has an unknown kind "${kind}"` };
    }
  }
  if (ordered.length !== meta.stateRows || problems.length !== meta.problemRows) {
    return { error: 'the checkpoint tab does not hold the rows its last build wrote' };
  }
  ordered.sort((a, b) => a.o - b.o);
  return { ctx: { states: states, order: ordered.map(x => x.id), problems: problems } };
}


// --- carrying a fold on (pure) -------------------------------------------------

/**
 * Can these tail entries be applied after the checkpoint and give the full
 * fold's answer? '' when they can, otherwise why not. Pure.
 */
function ledgerCheckpointTailRefusal_(meta, tailEntries) {
  for (let i = 0; i < tailEntries.length; i++) {
    const at = ledgerCheckpointEntryTime_(tailEntries[i]);
    if (at === null) return `tail entry ${tailEntries[i].entryId || '(no id)'} has no Entry_At`;
    if (at < meta.maxEntryAtMs) {
      return `tail entry ${tailEntries[i].entryId || '(no id)'} is dated before the checkpoint's last entry`;
    }
  }
  return '';
}

/** The checkpoint's context, carried on with `tailEntries` — foldRegistrationLedger()'s shape. Pure. */
function foldLedgerFromCheckpointContext_(ctx, tailEntries) {
  return finishLedgerFold_(foldLedgerEntriesInto_(ctx, sortLedgerEntries_(tailEntries.map(ledgerCheckpointCloneEntry_))));
}

/**
 * Do two fold results describe the same registrations? '' when they do,
 * otherwise the first difference in words. Pure.
 *
 * Per id: alive or dead, how it died, and every cell but
 * LEDGER_CHECKPOINT_UNCOMPARED_COLUMNS — plus the order the live rows come
 * out in, and the problems by entry and reason.
 */
function compareLedgerFoldResults_(a, b) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const skip = {};
  LEDGER_CHECKPOINT_UNCOMPARED_COLUMNS.forEach(h => { if (map[h] !== undefined) skip[map[h]] = true; });
  const sig = state => (state
    ? JSON.stringify([!!state.dead, state.deadBy || '', state.row.filter((_, i) => !skip[i]).map(ledgerCheckpointEncodeCell_)])
    : 'none');

  const ids = Object.keys(Object.assign({}, a.states, b.states));
  for (let i = 0; i < ids.length; i++) {
    if (sig(a.states[ids[i]]) !== sig(b.states[ids[i]])) return `registration ${ids[i]} folds differently`;
  }
  const idCol = map['Registration_ID'];
  if (idCol !== undefined) {
    const order = r => r.rows.map(row => row[idCol]).join('|');
    if (order(a) !== order(b)) return 'the live registrations come out in a different order';
  }
  const probs = r => r.problems.map(p => `${p.entryId}:${p.reason}`).sort().join('\n');
  if (probs(a) !== probs(b)) return `the replay reports different problems (${a.problems.length} vs ${b.problems.length})`;
  return '';
}


// --- the stored meta and the gate ----------------------------------------------

function ledgerCheckpointProps_() {
  try {
    const props = PropertiesService.getScriptProperties();
    return props && typeof props.getProperty === 'function' ? props : null;
  } catch (err) {
    return null;
  }
}

function readLedgerCheckpointJson_(key) {
  const props = ledgerCheckpointProps_();
  if (!props) return null;
  try {
    const parsed = JSON.parse(props.getProperty(key) || 'null');
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeLedgerCheckpointJson_(key, value) {
  const props = ledgerCheckpointProps_();
  if (!props) return false;
  if (value === null) props.deleteProperty(key);
  else props.setProperty(key, JSON.stringify(value));
  return true;
}

/**
 * Forgets the checkpoint. The tab rows are left — harmless, since no meta names
 * their generation — and the next build overwrites them. Never throws.
 */
function invalidateLedgerCheckpoint(reason) {
  try {
    if (!readLedgerCheckpointJson_(LEDGER_CHECKPOINT_META_PROP_KEY)) return false;
    writeLedgerCheckpointJson_(LEDGER_CHECKPOINT_META_PROP_KEY, null);
    log(`ℹ️ Ledger checkpoint set aside (${reason || 'no reason given'}) — folds read the whole ledger until the next nightly build.`);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * 18's onEdit, for an edit on the ledger tab: a hand edit at or above the
 * covered row means the checkpoint no longer describes what is there. An edit
 * below it is tail, and the next fold reads it as such.
 */
function noteLedgerTabEditForCheckpoint_(e) {
  try {
    const meta = readLedgerCheckpointJson_(LEDGER_CHECKPOINT_META_PROP_KEY);
    if (!meta) return;
    const row = e && e.range && typeof e.range.getRow === 'function' ? e.range.getRow() : 0;
    if (!row || row <= meta.coveredThroughRow) invalidateLedgerCheckpoint('the ledger tab was edited by hand');
  } catch (err) {
    // An edit must never fail because of a cache.
  }
}

function readLedgerCheckpointGate_() {
  const gate = readLedgerCheckpointJson_(LEDGER_CHECKPOINT_GATE_PROP_KEY) || {};
  if (!Array.isArray(gate.cleanDays)) gate.cleanDays = [];
  return gate;
}

/** Is the fast path allowed to answer? Never throws; a gate that cannot be read is closed. */
function ledgerCheckpointGateOpen_() {
  try {
    const gate = readLedgerCheckpointGate_();
    return !gate.disabled && gate.cleanDays.length >= LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED;
  } catch (err) {
    return false;
  }
}

/**
 * From the Apps Script editor: false turns the fast path off whatever the count
 * says, true lets the count decide again. The count itself is never set by
 * hand from here — it is earned.
 */
function setLedgerCheckpointFastPath(on) {
  const gate = readLedgerCheckpointGate_();
  gate.disabled = !on;
  writeLedgerCheckpointJson_(LEDGER_CHECKPOINT_GATE_PROP_KEY, gate);
  log(`Ledger checkpoint fast path ${on ? 'allowed (once the clean-day count is met)' : 'turned off'}.`);
  return gate;
}

/**
 * Records one comparison. Clean adds today (distinct days); a difference
 * empties the count, invalidates the checkpoint and files a digest line.
 */
function recordLedgerCheckpointComparison_(result) {
  if (!result || (result.status !== 'clean' && result.status !== 'different')) return;
  const gate = readLedgerCheckpointGate_();
  const today = formatDateKey(new Date());
  if (result.status === 'clean') {
    if (gate.cleanDays.indexOf(today) === -1) gate.cleanDays.push(today);
    // Only the most recent run of days matters; keep the property small.
    if (gate.cleanDays.length > LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED + 5) {
      gate.cleanDays = gate.cleanDays.slice(-(LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED + 5));
    }
  } else {
    gate.cleanDays = [];
    gate.lastMismatch = result.difference;
    gate.lastMismatchAt = new Date().toISOString();
  }
  writeLedgerCheckpointJson_(LEDGER_CHECKPOINT_GATE_PROP_KEY, gate);
  result.cleanDays = gate.cleanDays.length;

  if (result.status === 'different') {
    invalidateLedgerCheckpoint('it did not match a full fold');
    const line = `The ledger checkpoint did not match a full replay (${result.difference}). ` +
      'Folds keep reading the whole ledger; the clean-day count starts again and a fresh checkpoint is built tonight.';
    log(`⚠️ ${line}`);
    try {
      spoolOfficeNote(LEDGER_VERIFY_DIGEST_SECTION, line);
    } catch (err) {
      // The log line above is the record.
    }
  }
}


// --- the tab --------------------------------------------------------------------

function ledgerCheckpointSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  const existing = ss.getSheetByName(SHEET_NAMES.LEDGER_CHECKPOINT);
  if (existing || !create) return existing || null;
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.LEDGER_CHECKPOINT);
  sheet.getRange(1, 1, 1, LEDGER_CHECKPOINT_HEADERS.length).setValues([LEDGER_CHECKPOINT_HEADERS.slice()]);
  try { sheet.setFrozenRows(1); } catch (err) { /* cosmetic */ }
  try { sheet.hideSheet(); } catch (err) { /* cosmetic: nobody reads it by eye */ }
  return sheet;
}

/**
 * Writes the rows, THEN the meta. One setValues() over max(old, new) rows,
 * padded with blanks (99u's rule — never clear()), in plain-text format so
 * Sheets cannot reinterpret a JSON cell on the way in. A kill before the meta
 * write leaves a tab the meta does not describe, which every reader refuses.
 */
function writeLedgerCheckpoint_(built) {
  const generation = built.meta.generation;
  const rows = ledgerCheckpointRowsFromContext_(built.ctx, generation);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][3]).length > LEDGER_CHECKPOINT_MAX_CELL_CHARS) {
      throw new Error(`registration ${rows[i][2]} would not fit in one cell`);
    }
  }
  const sheet = ledgerCheckpointSheet_(true);
  if (!sheet) throw new Error('no spreadsheet to write the checkpoint into');

  // The meta goes first in the sense that matters: blanked, so a reader between
  // here and the end can never pair the OLD meta with a half-new tab.
  writeLedgerCheckpointJson_(LEDGER_CHECKPOINT_META_PROP_KEY, null);

  const width = LEDGER_CHECKPOINT_HEADERS.length;
  const oldCount = Math.max(sheet.getLastRow() - 1, 0);
  const total = Math.max(rows.length, oldCount);
  if (total > 0) {
    const out = rows.slice();
    while (out.length < total) out.push(new Array(width).fill(''));
    const range = sheet.getRange(2, 1, total, width);
    try { range.setNumberFormat('@'); } catch (err) { /* a stub, or a protected range: the JSON still starts with { */ }
    range.setValues(out);
  }

  const meta = Object.assign({}, built.meta, {
    stateRows: rows.filter(r => r[1] === 'state').length,
    problemRows: rows.filter(r => r[1] === 'problem').length
  });
  writeLedgerCheckpointJson_(LEDGER_CHECKPOINT_META_PROP_KEY, meta);
  return meta;
}

/** The stored checkpoint as { meta, ctx }, or { error }. One read of the tab. */
function loadLedgerCheckpoint_() {
  const meta = readLedgerCheckpointJson_(LEDGER_CHECKPOINT_META_PROP_KEY);
  if (!meta || !meta.generation) return { error: 'no checkpoint has been built' };
  const sheet = ledgerCheckpointSheet_(false);
  if (!sheet) return { error: `there is no ${SHEET_NAMES.LEDGER_CHECKPOINT} tab` };
  const last = sheet.getLastRow();
  const rows = last >= 2 ? sheet.getRange(2, 1, last - 1, LEDGER_CHECKPOINT_HEADERS.length).getValues() : [];
  const loaded = ledgerCheckpointContextFromRows_(rows, meta);
  if (loaded.error) return loaded;
  return { meta: meta, ctx: loaded.ctx };
}


// --- the fast fold ----------------------------------------------------------------

/**
 * What ledgerFoldNow() (99k) asks first. A fold result, or null — and null is
 * always safe: the caller reads the whole ledger exactly as before.
 *
 * ONE ranged read of the ledger: the anchor row and everything after it. The
 * anchor's Entry_ID must be the one the build recorded, which is what catches
 * a prefix that moved under it — compaction (99za), rows deleted or inserted by
 * hand, a tab recreated.
 */
function foldLedgerFromCheckpointIfAllowed_() {
  if (!ledgerCheckpointGateOpen_()) return null;
  const refuse = why => {
    log(`ℹ️ Ledger checkpoint not used (${why}) — reading the whole ledger.`);
    return null;
  };
  try {
    const cp = loadLedgerCheckpoint_();
    if (cp.error) return refuse(cp.error);
    const sheet = registrationLedgerSheet(false);
    if (!sheet) return refuse('there is no ledger tab');

    const start = cp.meta.coveredThroughRow;
    const last = sheet.getLastRow();
    if (last < start) return refuse('the ledger is shorter than the checkpoint');
    const width = Math.max(sheet.getLastColumn(), 1);
    const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(cell => normalizeHeaderText(cell));
    const values = sheet.getRange(start, 1, last - start + 1, width).getValues();
    const items = ledgerItemsFromValues_(values, headers, start);
    if (!items.length || items[0].entryIdCell !== cp.meta.lastEntryId) {
      return refuse('the ledger rows it covered have moved');
    }
    const tail = items.slice(1).filter(item => item.entry).map(item => item.entry);
    const why = ledgerCheckpointTailRefusal_(cp.meta, tail);
    if (why) return refuse(why);
    return foldLedgerFromCheckpointContext_(cp.ctx, tail);
  } catch (err) {
    return refuse(String(err));
  }
}


// --- validating it against the full fold ---------------------------------------

/**
 * THE COMPARISON THE GATE IS BUILT ON. Reads the ledger once (or takes a read
 * already made), folds it whole, folds the checkpoint carried on with the same
 * read's rows after the anchor, and compares. Records the answer in the gate.
 *
 *   { status: 'clean' | 'different' | 'none' | 'skipped', difference, reason, cleanDays }
 *
 * 'none' (nothing to compare) and 'skipped' (a tail that cannot be carried on)
 * record nothing: an absent comparison is neither a clean day nor a dirty one.
 * Never throws.
 */
function validateLedgerCheckpoint(read) {
  const result = { status: 'none', difference: '', reason: '', cleanDays: readLedgerCheckpointGate_().cleanDays.length };
  try {
    const cp = loadLedgerCheckpoint_();
    if (cp.error) { result.reason = cp.error; return result; }
    const r = read || readLedgerWithRows_();
    if (!r) { result.reason = 'there is no ledger tab'; return result; }

    const anchor = r.items.filter(item => item.row === cp.meta.coveredThroughRow)[0];
    if (!anchor || anchor.entryIdCell !== cp.meta.lastEntryId) {
      // The prefix moved. The checkpoint is no use, but nothing was compared.
      result.status = 'skipped';
      result.reason = 'the ledger rows it covered have moved';
      invalidateLedgerCheckpoint(result.reason);
      return result;
    }
    const tail = r.items.filter(item => item.row > cp.meta.coveredThroughRow && item.entry).map(item => item.entry);
    const why = ledgerCheckpointTailRefusal_(cp.meta, tail);
    if (why) { result.status = 'skipped'; result.reason = why; return result; }

    const full = foldRegistrationLedger(r.items.filter(item => item.entry).map(item => ledgerCheckpointCloneEntry_(item.entry)));
    const fast = foldLedgerFromCheckpointContext_(cp.ctx, tail);
    result.difference = compareLedgerFoldResults_(full, fast);
    result.status = result.difference ? 'different' : 'clean';
    recordLedgerCheckpointComparison_(result);
  } catch (err) {
    result.status = 'skipped';
    result.reason = String(err);
  }
  return result;
}

/** One line for 99n's report. */
function describeLedgerCheckpointValidation_(v) {
  if (!v) return '';
  const days = `${v.cleanDays || 0} of ${LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED} clean day(s) counted`;
  const using = ledgerCheckpointGateOpen_() ? 'folds now start from it' : 'folds still read the whole ledger';
  switch (v.status) {
    case 'clean': return `Checkpoint: matches a full replay (${days}; ${using}).`;
    case 'different': return `Checkpoint: DID NOT match a full replay — ${v.difference}. Set aside; the count starts again.`;
    case 'skipped': return `Checkpoint: not compared (${v.reason}).`;
    default: return `Checkpoint: none yet (${v.reason || 'built nightly at 3am'}).`;
  }
}


// --- the nightly build -------------------------------------------------------------

/**
 * Validates the checkpoint there is, then replaces it with one covering the
 * whole ledger as it stands. Called from snapshotRegistrantsDaily() (99j) and
 * by hand as buildLedgerCheckpointNow(). Never throws: a checkpoint that cannot
 * be built must not cost the snapshot it rides on.
 *
 * Under the workbook lock with a short wait, so a sync mid-flush is not read
 * half way through its own buffer. The lock does not stop 18's onEdit appender
 * and does not need to: whatever lands after the read is tail, and an entry
 * dated before the read is caught by the tail check.
 */
function refreshLedgerCheckpointNightly() {
  let lock = null;
  try {
    lock = workbookLock('Ledger checkpoint');
    if (!lock.tryLock(LEDGER_CHECKPOINT_LOCK_WAIT_MS)) {
      log('ℹ️ Ledger checkpoint: the workbook is busy — not rebuilt tonight.');
      return null;
    }
    flushLedger();
    const read = readLedgerWithRows_();
    if (!read || !read.items.length) {
      log('ℹ️ Ledger checkpoint: the ledger is empty — nothing to checkpoint.');
      return null;
    }
    const validation = validateLedgerCheckpoint(read);
    if (validation.status !== 'none') log(describeLedgerCheckpointValidation_(validation));

    const built = buildLedgerCheckpointFromItems_(read.items, newLedgerId_());
    if (!built.ok) {
      invalidateLedgerCheckpoint(`not rebuilt: ${built.reason}`);
      log(`ℹ️ Ledger checkpoint not built: ${built.reason}.`);
      return null;
    }
    const meta = writeLedgerCheckpoint_(built);
    log(`Ledger checkpoint built: ${meta.coveredEntries} entr(ies) through row ${meta.coveredThroughRow}, ` +
      `${meta.stateRows} registration(s), ${meta.problemRows} problem(s).`);
    invalidateLedgerFold();
    return meta;
  } catch (err) {
    log(`⚠️ Ledger checkpoint: ${err} — folds keep reading the whole ledger.`);
    try { invalidateLedgerCheckpoint('a build failed part way'); } catch (e) { /* logged above */ }
    return null;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (err) { /* nothing held */ }
    }
  }
}

/** The same, from the Apps Script editor. */
function buildLedgerCheckpointNow() {
  return refreshLedgerCheckpointNightly();
}
