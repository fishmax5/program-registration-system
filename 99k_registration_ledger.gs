// ============================================================================
// 99k. THE REGISTRATION LEDGER  (the tab, the appender, the fold)
// ============================================================================
//
// WHY THIS FILE EXISTS.
//
// All_Registrants is rebuilt by reading ITSELF. Every writer in this project
// ends the same way — take the tab's rows into memory, change some of them,
// renderRegistrantsSheet(false, rows) — and that render clears the sheet and
// writes the array back. At the moment of the clear, ONE SHORT IN-MEMORY ARRAY
// is the only copy of every registration this centre holds. A read that
// returned fewer rows than the tab had, a filter that dropped one row too
// many, a slice that ran out of budget between the read and the write: any of
// those is a permanent, silent deletion, and it has happened more than once
// with no cause ever established.
//
// 99j_registrant_safety_net.gs is the smoke alarm — it refuses a render that
// would lose half the tab, and it keeps last night's CSV. Its own banner says
// what it cannot do: it cannot see the loss of nine rows, and neither half of
// it knows WHICH registrations went, because neither knows what the tab was
// supposed to say.
//
// This file is the second copy. One row per EVENT rather than per person:
//
//   2026-09-14 09:31  registered  Joan Meier  Chair Yoga 9/16 Ashbridge  (form)
//   2026-09-15 14:02  cancelled   Joan Meier  Chair Yoga 9/16 Ashbridge  (cancel page)
//   2026-09-15 14:05  registered  Joan Meier  Chair Yoga 9/23 Ashbridge  (desk)
//
// Three rows, never edited, never removed. Everything the tab shows is a
// replay of them (foldRegistrationLedger), and everything the tab CANNOT show
// — that she rang on the 15th, that the cancel came through the link in her
// calendar invite — is on the record for the first time.
//
// NO KIND IS EVER DELETED OR REWRITTEN. A mistaken entry is answered by a
// further entry — that is what `removed` is for — and the fold's job is to
// make the last word win.
//
// WHAT THESE PHASES ARE. Phase 1 was the tab, the vocabulary, the appender and
// its buffer, and the fold, unit-tested against hand-built entry arrays, with
// nothing calling any of it. Phase 2 is the nine writers of §2, the id
// resolution they all begin with (below), and the verifier that proves each of
// them is appending (99n). Phase 3 is the backfill (99o) and the
// Registration_ID column it puts on every row.
//
// THE TAB IS STILL THE STATE. Nothing renders from the replay and no caller of
// renderRegistrantsSheet() has stopped passing its own array: that is phase 4,
// and it is gated on a month of clean verifier runs and on the onEdit appender
// (18) proving itself in production, because it is the only phase that can
// lose anything. See REGISTRATION_LEDGER_DESIGN.md for the whole sequence and
// for what it retires (28's tombstones, Manual_Override's protection role,
// 99j's thresholds) — none of which has happened yet.

/**
 * The nine kinds, and the whole vocabulary of what can happen to a
 * registration. Written as a frozen map rather than an array so a caller says
 * LEDGER_KINDS.CANCELLED and a typo is a crash at the call site rather than a
 * string the fold silently ignores.
 *
 * `superseded` is the one nobody asks for and the one the fold cannot do
 * without: a newer form submission replacing an older one is an existing path
 * (supersedeRegistrantRow, 29) and a replay that did not know about it would
 * put both seats back.
 *
 * `reactivated` is the reverse of the two reversible states — off the waitlist
 * (stampRegistrantRowActive, 71) or back from a cancellation
 * (stampRegistrantRowUncancelled, 99a). `removed` is NOT a cancellation: a
 * cancellation is a fact about a person, a removal is a fact about a mistake.
 */
const LEDGER_KINDS = Object.freeze({
  REGISTERED: 'registered',
  CANCELLED: 'cancelled',
  WAITLISTED: 'waitlisted',
  REACTIVATED: 'reactivated',
  MOVED: 'moved',
  CORRECTED: 'corrected',
  MERGED: 'merged',
  REMOVED: 'removed',
  SUPERSEDED: 'superseded'
});

/** Every kind, for validation and for the tab's own dropdown later. */
const LEDGER_ENTRY_KINDS = Object.freeze([
  LEDGER_KINDS.REGISTERED, LEDGER_KINDS.CANCELLED, LEDGER_KINDS.WAITLISTED,
  LEDGER_KINDS.REACTIVATED, LEDGER_KINDS.MOVED, LEDGER_KINDS.CORRECTED,
  LEDGER_KINDS.MERGED, LEDGER_KINDS.REMOVED, LEDGER_KINDS.SUPERSEDED
]);

/**
 * ONE VALUE PER CALL SITE, so "where did this come from" is answered by
 * reading a column rather than by inferring it from what else the entry says.
 *
 * `migration` is both the phase 3 backfill and the archive checkpoints of
 * §1.6, which are deliberately the same shape: a checkpoint is a `registered`
 * entry whose Payload is the folded state at the cut, so archival needs no
 * special case in the replay.
 */
const LEDGER_SOURCES = Object.freeze({
  IMPORT: 'import',
  // THE ONE THE DESIGN'S LIST DOES NOT HAVE. §1.2 names ten call sites and
  // §2's table names eleven writers, and the eleventh — row 9, the
  // Registrants-tab onEdit — is a person typing on the tab itself. It is not
  // the change panel (nobody opened a dialog), not the desk (nobody was at
  // one) and not a migration; it is the writer the whole of phase 4 turns on,
  // so it gets a word of its own rather than borrowing one that would make
  // "where did this come from" a guess again.
  SHEET_EDIT: 'sheet-edit',
  ALL_DATES: 'all-dates',
  CLUB: 'club',
  DOOR: 'door',
  QUICK_MARK: 'quick-mark',
  CANCEL_PAGE: 'cancel-page',
  LEADER_SHEET: 'leader-sheet',
  CHANGE_PANEL: 'change-panel',
  DEDUPE: 'dedupe',
  REMOVE_SWEEP: 'remove-sweep',
  MIGRATION: 'migration',
  // A row read back out of an older copy of the workbook (99p). Not
  // `migration`: that word means "was already on the tab when the ledger
  // started", and a restored row is the opposite — it was NOT on the tab, and
  // somebody decided it should be.
  RESTORE: 'restore-from-copy'
});

/** Every source, for validation. */
const LEDGER_ENTRY_SOURCES = Object.freeze(Object.keys(LEDGER_SOURCES).map(k => LEDGER_SOURCES[k]));

/**
 * Payload keys that are the ENTRY's own vocabulary rather than a column of
 * All_Registrants: the session a `moved` came from, the id a `merged`
 * absorbed, the id a `superseded` was replaced by. Everything else in a
 * Payload is a header name and is assigned onto the row.
 */
const LEDGER_PAYLOAD_RESERVED_KEYS = Object.freeze(['from', 'absorbed', 'by']);

/**
 * The statuses a dead registration leaves behind, for a fold that has to say
 * what the row would have looked like. Deliberately the same two words 71 and
 * 85 already use, because a third spelling of "this registration has ended" is
 * how two readers come to disagree about what one is.
 */
const LEDGER_DEAD_STATUSES = Object.freeze({
  removed: 'Superseded',
  superseded: 'Superseded',
  merged: 'Superseded'
});


// --- the tab ----------------------------------------------------------------

/** The ledger tab. `create` makes it (with its header row) rather than returning null. */
function registrationLedgerSheet(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  const existing = ss.getSheetByName(SHEET_NAMES.REGISTRATION_LEDGER);
  if (existing || !create) return existing || null;

  const sheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRATION_LEDGER);
  const headers = HEADERS.Registration_Ledger;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Where the next append goes, and the ONE thing about this tab that must never
 * be wrong.
 *
 * getLastRow() is asked of the sheet rather than remembered, every flush,
 * because another execution may have appended between this one's reads: two
 * syncs overlapping is ordinary here and a remembered row number is how one
 * flush writes over the other's entries. An append never reads what is already
 * there, so this is the whole of the coordination.
 */
function ledgerAppendRow_(sheet) {
  const last = sheet.getLastRow();
  return Math.max(last, 1) + 1;   // never row 1: that is the header
}


// --- the appender and its buffer --------------------------------------------

/**
 * THE PER-EXECUTION BUFFER.
 *
 * sheet.appendRow() per entry is a round trip per entry, which the import
 * cannot afford: one sync reads every form and builds hundreds of rows. So an
 * append BUFFERS, and one setValues() at the end of the execution writes the
 * lot — the same bargain flushPersistentRegistries() makes for the registries,
 * and flushed from the same places for the same reason.
 *
 * An entry buffered and never flushed is this project's original fault in a
 * new coat, which is why flushLedger() is called from flushPersistentRegistries()
 * itself (one call site rather than twenty that can be forgotten separately)
 * AND from a `finally` in runOneSlice_ (75), so a sliced job that ends any way
 * at all still writes what it recorded.
 */
let __ledgerBuffer = [];

/**
 * Entry_IDs this execution has already written, so a flush that is retried
 * after a partial failure does not write an entry twice. The ledger is
 * append-only and nothing de-duplicates it after the fact — a doubled
 * `registered` entry is a doubled seat.
 */
let __ledgerWrittenIds = {};

/**
 * Composes one entry. Mints Entry_ID and stamps Entry_At; everything else is
 * the caller's.
 *
 * THE KIND AND THE SOURCE ARE CHECKED HERE and throw when they are not in the
 * vocabulary. An entry the fold does not understand is worse than no entry:
 * the append succeeds, the writer carries on believing it recorded something,
 * and the replay quietly drops it.
 */
function makeLedgerEntry(fields) {
  const f = fields || {};
  const kind = String(f.kind || '').trim();
  const source = String(f.source || '').trim();
  if (LEDGER_ENTRY_KINDS.indexOf(kind) === -1) {
    throw new Error(`Ledger: "${kind}" is not one of ${LEDGER_ENTRY_KINDS.join(', ')}.`);
  }
  if (LEDGER_ENTRY_SOURCES.indexOf(source) === -1) {
    throw new Error(`Ledger: "${source}" is not one of ${LEDGER_ENTRY_SOURCES.join(', ')}.`);
  }
  if (kind !== LEDGER_KINDS.REGISTERED && !String(f.registrationId || '').trim()) {
    throw new Error(`Ledger: a "${kind}" entry needs the Registration_ID it is about.`);
  }

  return {
    entryId: String(f.entryId || '').trim() || newLedgerId_(),
    // coerceDate rather than `instanceof Date`, because a caller in phase 2
    // hands on what it read off a sheet or out of a form response and those
    // arrive as often as a string as a Date.
    entryAt: coerceDate(f.entryAt) || new Date(),
    // Blank means "the same as Entry_At" — see the schema's banner in 03.
    occurredAt: coerceDate(f.occurredAt),
    kind: kind,
    // A `registered` entry is the only one that may MINT an id, which is what
    // makes "this registration exists" a thing the ledger says rather than a
    // thing a reader infers.
    registrationId: String(f.registrationId || '').trim() || newLedgerId_(),
    eventId: String(f.eventId || '').trim(),
    name: String(f.name || '').trim(),
    personType: String(f.personType || '').trim(),
    partyId: String(f.partyId || '').trim(),
    source: source,
    actor: String(f.actor === undefined ? currentLedgerActor_() : (f.actor || '')).trim(),
    payload: (f.payload && typeof f.payload === 'object') ? f.payload : {},
    note: String(f.note || '').trim()
  };
}

/** Utilities.getUuid(), behind a try so a stub-less context still composes an entry. */
function newLedgerId_() {
  try {
    return Utilities.getUuid();
  } catch (err) {
    return `led-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  }
}

/** Who pressed it, best-effort and never load-bearing — blank where nothing is knowable. */
function currentLedgerActor_() {
  try {
    return getCurrentUserEmail() || '';
  } catch (err) {
    return '';
  }
}

/**
 * Records entries. They are BUFFERED, not written — flushLedger() writes.
 *
 * Takes no lock. Every caller in phase 2 already holds the workbook lock (the
 * desk's withScriptLock, the sync's, the change panel's) and the append is
 * inside it; a second lock would not be reentrant and the consequence of
 * getting that wrong is quiet rather than loud (99b's banner, on exactly this).
 */
function appendLedgerEntries(entries) {
  const list = (entries || []).filter(entry => entry && entry.entryId);
  if (!list.length) return 0;
  list.forEach(entry => { __ledgerBuffer.push(entry); });
  return list.length;
}

/** One entry, for the callers that have one. */
function appendLedgerEntry(entry) {
  return appendLedgerEntries([entry]);
}

/** What is recorded but not yet on the tab — the number a `finally` is protecting. */
function pendingLedgerEntryCount() {
  return __ledgerBuffer.length;
}

/**
 * Writes everything buffered, in one setValues() past the last row.
 *
 * THE BUFFER IS CLEARED ONLY ONCE THE WRITE IS AWAY. A flush that throws
 * leaves its entries pending, so the next flush — the `finally` in the sliced
 * runner, or the one at the end of the execution — writes them instead of
 * losing them. The write itself is idempotent through __ledgerWrittenIds: an
 * entry already on the tab is dropped rather than doubled, because a doubled
 * `registered` entry is a doubled seat.
 */
function flushLedger() {
  if (!__ledgerBuffer.length) return 0;

  const pending = __ledgerBuffer.filter(entry => !__ledgerWrittenIds[entry.entryId]);
  if (!pending.length) { __ledgerBuffer = []; return 0; }

  let sheet;
  try {
    sheet = registrationLedgerSheet(true);
  } catch (err) {
    log(`⚠️ Ledger: could not open "${SHEET_NAMES.REGISTRATION_LEDGER}" (${err}) — ${pending.length} entr(ies) still pending.`);
    return 0;
  }
  if (!sheet) return 0;

  const headers = HEADERS.Registration_Ledger;
  const values = pending.map(entry => ledgerEntryToRow(entry, headers));
  try {
    sheet.getRange(ledgerAppendRow_(sheet), 1, values.length, headers.length).setValues(values);
  } catch (err) {
    // Left in the buffer deliberately. The next flush retries them, and the
    // ids above are what stops a partial success becoming a duplicate.
    log(`⚠️ Ledger: could not write ${pending.length} entr(ies) (${err}) — they stay pending.`);
    return 0;
  }

  pending.forEach(entry => { __ledgerWrittenIds[entry.entryId] = true; });
  __ledgerBuffer = [];
  // What was just appended is part of the answer to the next question — a
  // second writer in this execution resolving the same person must find the id
  // the first one minted. Same reason invalidateSectionedRowsCache() drops the
  // session grid after a write, and it is a no-op before phase 2's readers
  // exist.
  invalidateLedgerFold();
  return pending.length;
}

/** One entry as a row of the tab, in HEADERS.Registration_Ledger order. */
function ledgerEntryToRow(entry, headerList) {
  const headers = headerList || HEADERS.Registration_Ledger;
  const map = getIndexMap(headers);
  const row = new Array(headers.length).fill('');
  row[map['Entry_ID']] = entry.entryId;
  row[map['Entry_At']] = entry.entryAt || new Date();
  row[map['Occurred_At']] = entry.occurredAt || '';
  row[map['Kind']] = entry.kind;
  row[map['Registration_ID']] = entry.registrationId;
  row[map['Event_ID']] = entry.eventId || '';
  row[map['Name']] = entry.name || '';
  row[map['Person_Type']] = entry.personType || '';
  row[map['Party_ID']] = entry.partyId || '';
  row[map['Source']] = entry.source;
  row[map['Actor']] = entry.actor || '';
  // A JSON string in a cell. Written last-thing rather than kept as an object
  // so the tab is readable by eye without a join, which is the same reason
  // Name and Person_Type are denormalized onto every entry.
  row[map['Payload']] = ledgerPayloadToCell_(entry.payload);
  row[map['Note']] = entry.note || '';
  return row;
}

/** JSON, or blank for an empty payload — a cell reading `{}` is noise in a column somebody scans. */
function ledgerPayloadToCell_(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const keys = Object.keys(payload);
  if (!keys.length) return '';
  try {
    return JSON.stringify(payload);
  } catch (err) {
    return '';
  }
}

/** One row of the tab back as an entry. A row the parser cannot read comes back null. */
function ledgerRowToEntry(row, headerList) {
  const headers = headerList || HEADERS.Registration_Ledger;
  const map = getIndexMap(headers);
  const kind = String(row[map['Kind']] || '').trim();
  const registrationId = String(row[map['Registration_ID']] || '').trim();
  if (!kind || !registrationId) return null;

  let payload = {};
  const raw = String(row[map['Payload']] || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') payload = parsed;
    } catch (err) {
      // A payload that will not parse is reported by the fold rather than
      // thrown here: one unreadable cell must not cost the replay every entry
      // after it.
      payload = { __unparseable: raw };
    }
  }

  return {
    entryId: String(row[map['Entry_ID']] || '').trim(),
    entryAt: coerceDate(row[map['Entry_At']]) || null,
    occurredAt: coerceDate(row[map['Occurred_At']]) || null,
    kind: kind,
    registrationId: registrationId,
    eventId: String(row[map['Event_ID']] || '').trim(),
    name: String(row[map['Name']] || '').trim(),
    personType: String(row[map['Person_Type']] || '').trim(),
    partyId: String(row[map['Party_ID']] || '').trim(),
    source: String(row[map['Source']] || '').trim(),
    actor: String(row[map['Actor']] || '').trim(),
    payload: payload,
    note: String(row[map['Note']] || '').trim()
  };
}

/**
 * The whole ledger, in sheet order.
 *
 * ONE READ, and the sheet's own order is the tie-break the fold sorts on — so
 * this deliberately does not sort, filter or de-duplicate. An empty or missing
 * tab is an empty ledger rather than a fault: before phase 2 that is the
 * ordinary state of every workbook.
 */
function readLedgerEntries() {
  const sheet = registrationLedgerSheet(false);
  if (!sheet) return [];
  let values;
  try {
    values = sheet.getDataRange().getValues();
  } catch (err) {
    log(`⚠️ Ledger: could not read "${SHEET_NAMES.REGISTRATION_LEDGER}" (${err}) — treating it as empty.`);
    return [];
  }
  if (!values || values.length < 2) return [];

  // The header row is matched rather than assumed, so a column added at the
  // end of HEADERS.Registration_Ledger reads back correctly on a tab written
  // before it existed.
  const headers = values[0].map(cell => normalizeHeaderText(cell));
  const entries = [];
  for (let i = 1; i < values.length; i++) {
    const entry = ledgerRowToEntry(values[i], headers);
    if (entry) entries.push(entry);
  }
  return entries;
}


// --- the fold ---------------------------------------------------------------

/**
 * THE REPLAY: every entry, in order, into one registrant row per live
 * registration.
 *
 *   foldRegistrationLedger(entries) -> { rows, states, index, problems }
 *
 *   rows      one array per LIVE registration, in HEADERS.All_Registrants
 *             order — which is exactly the array renderRegistrantsSheet(force,
 *             allRows) already takes as its second argument. That is the whole
 *             of phase 4: the fold is not a new writer, it is a new source of
 *             the array the existing writer has always taken.
 *   states    per Registration_ID, for a caller that needs to know a
 *             registration is dead rather than merely absent.
 *   index     registrantTombstoneKey -> Registration_ID, which is how a writer
 *             holding a row but no id finds one (§1.4's second path).
 *   problems  every entry the replay could not honour, with why. Never thrown:
 *             one bad entry must not cost the replay the ones after it, and a
 *             fold that refuses to produce rows is a tab that cannot be drawn.
 *
 * THE ORDER IS THE SHEET'S. Sorted by Entry_At with ties broken by row order,
 * which on an append-only tab is a stable sort over an already-ordered read
 * rather than a clock comparison between two executions.
 *
 * THE STATUSES GO THROUGH 71's STAMPERS, not a fourth copy of the four cells
 * they write. "A status is never one cell" stays true by construction here
 * rather than by a comment, and a change to what a cancellation means reaches
 * the replay the same day it reaches the desk.
 */
function foldRegistrationLedger(entries) {
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const states = {};
  const order = [];
  const problems = [];

  const note = (entry, reason) => problems.push({
    entryId: (entry && entry.entryId) || '',
    kind: (entry && entry.kind) || '',
    registrationId: (entry && entry.registrationId) || '',
    reason: reason
  });

  sortLedgerEntries_(entries).forEach(entry => {
    if (LEDGER_ENTRY_KINDS.indexOf(entry.kind) === -1) {
      note(entry, `"${entry.kind}" is not a kind this replay knows.`);
      return;
    }
    if (entry.payload && entry.payload.__unparseable !== undefined) {
      note(entry, 'Its Payload is not readable JSON — the entry is applied without it.');
      delete entry.payload.__unparseable;
    }

    let state = states[entry.registrationId];

    if (entry.kind === LEDGER_KINDS.REGISTERED) {
      if (!state) {
        state = states[entry.registrationId] = {
          registrationId: entry.registrationId,
          row: newFoldedRegistrantRow_(entry, headers, map),
          dead: false,
          deadBy: ''
        };
        order.push(entry.registrationId);
        applyLedgerPayload_(state.row, map, entry.payload, note, entry);
        return;
      }
      if (state.dead) {
        // A registration that was removed, superseded or absorbed does not come
        // back under the same id: a genuinely new sign-up mints its own. An
        // entry saying otherwise is a writer acting on a stale row.
        note(entry, `A "${state.deadBy}" registration cannot be registered again under the same id.`);
        return;
      }
      // Registering somebody who already has a live registration is the
      // ORDINARY case, not an error: they cancelled and signed up again. It is
      // a reactivation plus a correction, and never a second seat.
      applyLedgerReactivation_(state.row, map, entry);
      applyLedgerPayload_(state.row, map, entry.payload, note, entry);
      return;
    }

    if (!state) {
      note(entry, 'The ledger has no registration with this id — the entry is dropped.');
      return;
    }
    if (state.dead) {
      note(entry, `The registration was "${state.deadBy}" before this entry — it is not resurrected.`);
      return;
    }

    switch (entry.kind) {
      case LEDGER_KINDS.CANCELLED:
        stampRegistrantRowCancelled(state.row, map, ledgerStampOptions_(entry));
        break;
      case LEDGER_KINDS.WAITLISTED:
        stampRegistrantRowWaitlisted(state.row, map, ledgerStampOptions_(entry));
        break;
      case LEDGER_KINDS.REACTIVATED:
        applyLedgerReactivation_(state.row, map, entry);
        break;
      case LEDGER_KINDS.MOVED:
        applyLedgerMove_(state.row, map, entry, note);
        break;
      case LEDGER_KINDS.CORRECTED:
        applyLedgerPayload_(state.row, map, entry.payload, note, entry);
        break;
      case LEDGER_KINDS.MERGED:
        applyLedgerMerge_(states, state, map, entry, note);
        break;
      case LEDGER_KINDS.REMOVED:
      case LEDGER_KINDS.SUPERSEDED:
        killFoldedRegistration_(state, map, entry.kind);
        break;
      default:
        note(entry, `"${entry.kind}" is not a kind this replay knows.`);
    }
  });

  const rows = [];
  const index = {};
  order.forEach(id => {
    const state = states[id];
    if (!state || state.dead) return;
    // Written onto the row when the column exists, and silently skipped when it
    // does not — HEADERS.All_Registrants gains Registration_ID in phase 3, and
    // a fold that threw without it could not be shipped before then.
    if (map['Registration_ID'] !== undefined) state.row[map['Registration_ID']] = id;
    rows.push(state.row);
    index[ledgerRegistrationKey_(state.row, map)] = id;
  });

  return { rows: rows, states: states, index: index, problems: problems };
}

/**
 * Sorted by Entry_At, ties broken by the order they arrived in.
 *
 * An entry with no Entry_At at all keeps its position rather than sorting to
 * the front: the sheet's order is the second piece of evidence about when
 * something happened, and on an append-only tab it is usually the better one.
 */
function sortLedgerEntries_(entries) {
  return (entries || [])
    .filter(entry => entry && entry.kind && entry.registrationId)
    .map((entry, i) => {
      const at = coerceDate(entry.entryAt);
      return { entry: entry, i: i, at: at ? at.getTime() : null };
    })
    .sort((a, b) => {
      if (a.at === null || b.at === null) return a.i - b.i;
      if (a.at !== b.at) return a.at - b.at;
      return a.i - b.i;
    })
    .map(wrapped => wrapped.entry);
}

/** A fresh registrant row carrying the identity the entry states, and nothing else yet. */
function newFoldedRegistrantRow_(entry, headers, map) {
  const row = new Array(headers.length).fill('');
  if (map['Event_ID'] !== undefined) row[map['Event_ID']] = entry.eventId || '';
  if (map['Name'] !== undefined) row[map['Name']] = entry.name || '';
  if (map['Person_Type'] !== undefined) row[map['Person_Type']] = entry.personType || 'Registrant';
  if (map['Party_ID'] !== undefined) row[map['Party_ID']] = entry.partyId || '';
  if (map['Program_Status'] !== undefined) row[map['Program_Status']] = 'Active';
  if (map['Lunch_Status'] !== undefined) row[map['Lunch_Status']] = 'No Lunch';
  if (map['Manual_Override'] !== undefined) row[map['Manual_Override']] = 'Auto-Synced';
  return row;
}

/**
 * Back from the waitlist, or back from a cancellation — through 71's and 99a's
 * own writers, in that order.
 *
 * Both refuse a row that is not in the state they undo, so asking each in turn
 * is the whole of the dispatch: a row that is already Active is a no-op rather
 * than a problem, because a replay must be able to run twice.
 */
function applyLedgerReactivation_(row, map, entry) {
  const opts = ledgerStampOptions_(entry);
  if (stampRegistrantRowActive(row, map, opts)) return true;
  return stampRegistrantRowUncancelled(row, map, opts);
}

/**
 * The same registration, a different session.
 *
 * Event_ID comes off the entry (it is the DESTINATION — the origin is in
 * Payload.from, which is recorded and not replayed) and the date and time off
 * the Payload. THE MARKS ARE CLEARED when the date changes, because "attended"
 * is a fact about a day; that is 99a's rule, through 99a's own function.
 */
function applyLedgerMove_(row, map, entry, note) {
  const before = map['Event_ID'] !== undefined ? String(row[map['Event_ID']] || '') : '';
  if (!entry.eventId) {
    note(entry, 'A "moved" entry with no Event_ID has no session to move to.');
    return;
  }
  if (map['Event_ID'] !== undefined) row[map['Event_ID']] = entry.eventId;
  applyLedgerPayload_(row, map, entry.payload, note, entry);
  if (before !== entry.eventId) clearRegistrantMarksOnRow(row, map);
}

/**
 * Two registrations were one person: the survivor keeps its id, the absorbed
 * one stops existing.
 *
 * THE ARITHMETIC IS THE ENTRY'S, not re-derived here. Payload carries the
 * merge's own numbers (the meal mode's answer, the OR-ed marks) because by the
 * time the fold runs it can no longer see the two rows separately, and a
 * replay that guessed would disagree with what the desk was shown.
 */
function applyLedgerMerge_(states, state, map, entry, note) {
  applyLedgerPayload_(state.row, map, entry.payload, note, entry);
  const absorbedId = String((entry.payload && entry.payload.absorbed) || '').trim();
  if (!absorbedId) {
    note(entry, 'A "merged" entry with no Payload.absorbed names nothing to absorb.');
    return;
  }
  const absorbed = states[absorbedId];
  if (!absorbed) {
    note(entry, `Payload.absorbed names "${absorbedId}", which this ledger has no registration for.`);
    return;
  }
  killFoldedRegistration_(absorbed, map, LEDGER_KINDS.MERGED);
}

/** Marks a registration dead, and leaves the row saying so for anything still holding it. */
function killFoldedRegistration_(state, map, kind) {
  state.dead = true;
  state.deadBy = kind;
  const status = LEDGER_DEAD_STATUSES[kind];
  if (status && map['Program_Status'] !== undefined) state.row[map['Program_Status']] = status;
}

/**
 * Shallow-assigns a Payload over a row: the fields this entry SETS, and no
 * others.
 *
 * A key that is not a column of All_Registrants is reported rather than
 * ignored — a writer appending `Attending` where the column is `Attended` is a
 * correction that never lands, and it is silent in every other way.
 */
function applyLedgerPayload_(row, map, payload, note, entry) {
  if (!payload || typeof payload !== 'object') return;
  Object.keys(payload).forEach(key => {
    if (LEDGER_PAYLOAD_RESERVED_KEYS.indexOf(key) !== -1) return;
    if (map[key] === undefined) {
      note(entry, `Payload names "${key}", which is not a column of ${SHEET_NAMES.REGISTRANT_DASH}.`);
      return;
    }
    row[map[key]] = payload[key];
  });
}

/** What 71's stampers write into Admin_Notes — the entry's own words where it has any. */
function ledgerStampOptions_(entry) {
  return {
    source: entry.source || '',
    by: entry.actor || '',
    reason: entry.note || ''
  };
}

/**
 * The key a writer holding a row but no Registration_ID resolves through — the
 * same one the tombstones, the superseded match and the import index are all
 * already built on (registrantTombstoneKey, 28).
 */
function ledgerRegistrationKey_(row, map) {
  return registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
}

/**
 * §1.4's second resolution path: a writer that did not create the registration
 * and is holding a row without an id.
 *
 * A key that resolves to nothing is not a fault — it is the correct reading of
 * "this person is on a roster and the ledger has never heard of them", which
 * before phase 3's backfill is true of every row in the workbook. The caller
 * answers a null with a `registered` entry.
 */
function resolveRegistrationId(index, eventId, name, personType) {
  if (!index) return null;
  return index[registrantTombstoneKey(eventId, name, personType)] || null;
}


// --- phase 2: how a writer finds the id it is acting on ----------------------
//
// §1.4 gives two answers, in order. The first — the row carries a
// Registration_ID of its own — needs the column, which HEADERS.All_Registrants
// does not gain until phase 3; the second is this: resolve the row's identity
// against the fold's index, and answer a miss with a `registered` entry.
//
// SO PHASE 2 DOES READ THE LEDGER, and the phase's title ("every writer
// appends; nothing reads") is about the TAB: All_Registrants is still the
// state and no render takes its rows from the replay. What is read here is one
// getValues() of the ledger, folded, memoized for the execution — the cost a
// desk mark pays to know which registration it is about.

/** The fold of the tab as it stood when this execution first asked. */
let __ledgerFold = null;

/**
 * Ids minted THIS execution, by registrantTombstoneKey.
 *
 * The memoized fold above is the tab as it was at the start of the execution
 * and the buffer has not been written yet, so without this overlay two writers
 * touching one person in one run would mint two `registered` entries for them
 * — two registrations, two seats, from one sign-in.
 */
let __ledgerMintedIds = {};

/**
 * The ledger, read once and folded once per execution.
 *
 * Memoized here rather than in 08 beside the other hot-path memos because
 * nothing on a hot path reads it yet: in phase 4 the fold becomes the source
 * of the Registrants tab and `foldedRegistrantRows()` moves there with the
 * rest of them. Dropped by flushLedger(), for the same reason
 * invalidateSectionedRowsCache() drops the session grid: what was just
 * appended is part of the answer to the next question.
 */
function ledgerFoldNow() {
  if (!__ledgerFold) __ledgerFold = foldRegistrationLedger(readLedgerEntries());
  return __ledgerFold;
}

/** Drops the memo. Called by flushLedger(), and by any caller that has written the tab. */
function invalidateLedgerFold() {
  __ledgerFold = null;
}

/**
 * THE ONE CALL EVERY PHASE-2 WRITER MAKES FIRST: which registration is this
 * row about?
 *
 * Resolved through the fold's index, and a miss MINTS one — which is not a
 * fallback but the correct reading of "this person is on a roster and the
 * ledger has never heard of them" (§1.4). Before phase 3's backfill that is
 * true of every row in the workbook, so in practice the first thing anybody
 * does to a pre-ledger registration is put it on the record.
 *
 * WHAT THE MINTED ENTRY CARRIES IS THE ROW, not just its identity. A bare
 * `registered` entry would fold to a row holding a name and a session and
 * nothing else, and the verifier would then report every column of a perfectly
 * healthy registration as a disagreement — thousands of them, drowning the one
 * bucket this phase is worth shipping for. So the entry is the same shape
 * phase 3's backfill writes (ledgerEntriesForExistingRow), and the two are one
 * function precisely so they cannot come to disagree about what a migrated
 * registration looks like.
 *
 * Returns the Registration_ID. Never null: a writer that has a row has a
 * registration, whether or not the ledger knew about it a moment ago.
 */
function ledgerIdForRegistrantRow(row, map, opts) {
  const o = opts || {};
  // The column, where phase 3 has put one on the row: the cheapest answer and
  // the only one that survives a person being renamed or a session re-keyed.
  if (map['Registration_ID'] !== undefined) {
    const onRow = String(row[map['Registration_ID']] || '').trim();
    if (onRow) return onRow;
  }

  const key = registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
  if (__ledgerMintedIds[key]) return __ledgerMintedIds[key];

  const found = resolveRegistrationId(ledgerFoldNow().index, row[map['Event_ID']],
    row[map['Name']], row[map['Person_Type']]);
  if (found) return found;

  const entries = ledgerEntriesForExistingRow(row, map, {
    source: o.source || LEDGER_SOURCES.MIGRATION,
    occurredAt: o.occurredAt || null,
    note: o.note || 'On the Registrants tab before the ledger existed — recorded when a writer first touched it.'
  });
  appendLedgerEntries(entries);
  const id = entries[0].registrationId;
  __ledgerMintedIds[key] = id;
  if (map['Registration_ID'] !== undefined) row[map['Registration_ID']] = id;
  return id;
}

/**
 * THE ENTRIES THAT MAKE THE FOLD REPRODUCE ONE EXISTING ROW.
 *
 * A `registered` entry carrying the row's own columns, plus — when the row is
 * not Active — the ONE entry that puts it in the state it is in. That second
 * entry is what stops a replay reviving everybody: `registered` creates an
 * Active registration by construction (newFoldedRegistrantRow_), so a
 * cancelled row recorded with a `registered` entry alone folds back onto the
 * tab as somebody holding a seat they gave up.
 *
 * Shared by phase 2's on-demand mint above and phase 3's backfill, which is
 * the same act at two moments: one row because somebody touched it, every row
 * because somebody pressed the menu item.
 */
function ledgerEntriesForExistingRow(row, map, opts) {
  const o = opts || {};
  const source = o.source || LEDGER_SOURCES.MIGRATION;
  const registered = makeLedgerEntry({
    kind: LEDGER_KINDS.REGISTERED,
    source: source,
    occurredAt: o.occurredAt || null,
    eventId: row[map['Event_ID']],
    name: row[map['Name']],
    personType: row[map['Person_Type']],
    partyId: map['Party_ID'] === undefined ? '' : row[map['Party_ID']],
    payload: ledgerPayloadFromRow(row, map),
    note: o.note || ''
  });

  const entries = [registered];
  const kind = LEDGER_STATUS_ENTRY_KINDS[String(row[map['Program_Status']] || '').trim()];
  if (kind) {
    entries.push(makeLedgerEntry({
      kind: kind,
      source: source,
      occurredAt: o.occurredAt || null,
      registrationId: registered.registrationId,
      eventId: row[map['Event_ID']],
      name: row[map['Name']],
      personType: row[map['Person_Type']],
      note: `The row already read ${row[map['Program_Status']]} when it was recorded.`
    }));
  }
  return entries;
}

/**
 * Program_Status -> the kind that puts a fresh registration in that state.
 *
 * Only the three a row can WEAR. 'Active' is absent deliberately: it is what a
 * `registered` entry already produces, and an entry saying so would be a
 * reactivation of something that was never anything else.
 */
const LEDGER_STATUS_ENTRY_KINDS = Object.freeze({
  Cancelled: LEDGER_KINDS.CANCELLED,
  Waitlisted: LEDGER_KINDS.WAITLISTED,
  Superseded: LEDGER_KINDS.SUPERSEDED
});

/**
 * One registrant row as a Payload: every column that says something, in
 * HEADERS.All_Registrants spelling.
 *
 * DATES ARE yyyy-MM-dd AND NOTHING IS A Date OBJECT (§1.5). The Payload is
 * JSON in a cell; a Date crosses JSON.stringify as an ISO string in UTC, which
 * on an evening session is yesterday. Everything else is left exactly as the
 * tab holds it — a checkbox is a boolean, a count is a number, and Event_Time
 * is the label string the tab already carries rather than a time value.
 *
 * Blank cells are omitted rather than written as '': a Payload states what an
 * entry SETS, and "this column is empty" is not a thing a `registered` entry
 * has any business asserting over a later correction.
 */
function ledgerPayloadFromRow(row, map) {
  const payload = {};
  Object.keys(map).forEach(header => {
    if (LEDGER_PAYLOAD_SKIPPED_COLUMNS.indexOf(header) !== -1) return;
    const value = ledgerCellValue_(row[map[header]]);
    if (value === '') return;
    payload[header] = value;
  });
  return payload;
}

/**
 * ONE CELL, AS A PAYLOAD CARRIES IT. Every writer in phase 2 builds its
 * Payload through this, so four files cannot come to disagree about what a
 * date or a tick looks like in a ledger entry.
 *
 * A DATE BECOMES yyyy-MM-dd (§1.5) and nothing stays a Date object: the
 * Payload is JSON in a cell, and a Date crosses JSON.stringify as an ISO
 * string in UTC — which on an evening session is yesterday. The check is
 * Object.prototype.toString rather than `instanceof Date` deliberately: a
 * value read out of ANOTHER document (openSpreadsheetCached(), 08 — the
 * leaders' shared sheets are read back on every sync) is a Date from a
 * different realm, and `instanceof` answers false for one.
 *
 * A blank is '' rather than null or undefined, so a caller that means to set a
 * cell empty can, and one that does not can test for it.
 */
function ledgerCellValue_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDateKey(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value).trim();
}

/**
 * Columns a Payload never carries.
 *
 * The four the ENTRY already states in columns of its own (a second copy in
 * the Payload is a second thing to keep in step), and the two link cells,
 * which are stamped onto every row by the render from a registry (69) and are
 * therefore a fact about the workbook rather than about the registration.
 */
const LEDGER_PAYLOAD_SKIPPED_COLUMNS = Object.freeze([
  'Event_ID', 'Name', 'Person_Type', 'Party_ID',
  'Registrant_Sheet_Link', 'Sign_In_Sheet_Link', 'Registration_ID'
]);


/**
 * EVERY registration the ledger holds, live or dead, by the key a row
 * resolves through. For the backfill (99o) and for nothing else.
 *
 * resolveRegistrationId() deliberately sees only LIVE registrations: handing a
 * writer the id of one that was removed, superseded or absorbed would have the
 * fold drop the entry it then appends, silently, which is the worst kind of
 * answer a resolver can give.
 *
 * The backfill needs the other question. It records a `registered` entry for
 * EVERY row on the tab including the dead ones (a Superseded row backfilled as
 * though it were live is a second seat in the replay), so the id it mints for
 * a cancelled row is dead the moment it exists — and a second slice asking the
 * live index would find nothing, mint again, and write the duplicate history
 * the design's own correction of 2026-09-23 is about. Asked this way, a row
 * already recorded is recognized whatever state it ended in.
 *
 * ONE ID PER KEY, first wins. Two tab rows sharing one key are a duplicate
 * registration, which is 85's problem and not this map's; the backfill claims
 * the id for the first row and mints for the second, so the ledger reproduces
 * the tab rather than quietly collapsing two rows into one.
 */
function ledgerRegistrationIdsByKey(fold) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const byKey = {};
  const states = (fold && fold.states) || {};
  Object.keys(states).forEach(id => {
    const state = states[id];
    if (!state || !state.row) return;
    const key = ledgerRegistrationKey_(state.row, map);
    if (key && byKey[key] === undefined) byKey[key] = id;
  });
  return byKey;
}


// --- phase 2: the import's compose buffer -----------------------------------
//
// buildRegistrantRow() (29) is where the KIND is decided — the capacity check,
// the Waitlist Only branch, supersedeRegistrantRow() — so it is where the
// entry is composed. It is deliberately not where it is appended.
//
// THE REASON IS ORDERING, not round trips: appendLedgerEntries() buffers, so a
// direct append would cost nothing per response. But a row this function
// builds is not a row anybody has written yet — the import holds them in an
// array until `27` renders the tab — and an entry that reached the ledger's
// own buffer would be flushed by the `finally` in the sliced runner (75)
// whether or not that render ever happened. The appends have to go with the
// rows, in the same order, which is the one property that stops the ledger and
// the tab disagreeing about a slice that ran out of budget.
//
// So 29 composes into here, and 27 hands the batch to the appender in the same
// step that writes the tab.

let __ledgerComposed = [];

/** 29 records a composed entry against the row it just built. */
function recordImportLedgerEntries(entries) {
  (entries || []).forEach(entry => { if (entry) __ledgerComposed.push(entry); });
  return __ledgerComposed.length;
}

/** 27 takes the batch, at the moment it writes the rows those entries are about. */
function takeImportLedgerEntries() {
  const batch = __ledgerComposed;
  __ledgerComposed = [];
  return batch;
}

/** What is composed but not yet handed on — and what the audit (99d) drops on its way out. */
function pendingImportLedgerEntryCount() {
  return __ledgerComposed.length;
}


// --- phase 2: the entry a status change composes ----------------------------
//
// Four of the nine call sites change a status (71's three doors and its two
// leader-sheet ticks, 38's Add to waitlist, 99a's cancel / waitlist / put-them-
// back-on), and every one of them writes it through 71's and 99a's four-cell
// stampers. THE APPEND CANNOT LIVE IN THOSE STAMPERS, which is the one place
// it would otherwise obviously belong: foldRegistrationLedger() calls them too,
// against its in-progress state, and a stamper that appended would write the
// history it was replaying back into the ledger — doubled, every time anybody
// folded. So the callers compose, and this is the one composer they share, so
// that five writers cannot come to disagree about what a cancellation entry
// says.

/**
 * The entry for one status change on one row.
 *
 * `stampOpts` is what the row's own stamper is being given (CANCELLATION_SOURCES'
 * words, who, and the reason) — reused rather than restated, so the sentence in
 * Admin_Notes and the Note on the ledger cannot drift apart. `ledgerOpts`
 * carries what only the ledger has vocabulary for: which call site this is
 * (`source`), when it actually happened where that is knowable (`occurredAt`,
 * blank by design on a tick read back off a shared sheet), and a Note of its
 * own where the stamp's reason is not the whole story.
 *
 * COMPOSED, NOT APPENDED. The caller appends only if its stamper returned
 * true: a refusal ("already cancelled", "not waitlisted by hand") is an answer
 * rather than a failure, and an entry for a change that did not happen is a
 * seat given back twice by the replay.
 */
function ledgerEntryForStatusChange_(row, map, kind, stampOpts, ledgerOpts) {
  const stamp = stampOpts || {};
  const o = ledgerOpts || {};
  return makeLedgerEntry({
    kind: kind,
    source: o.source || LEDGER_SOURCES.CHANGE_PANEL,
    occurredAt: o.occurredAt || null,
    registrationId: ledgerIdForRegistrantRow(row, map),
    eventId: row[map['Event_ID']],
    name: row[map['Name']],
    personType: row[map['Person_Type']],
    partyId: map['Party_ID'] === undefined ? '' : row[map['Party_ID']],
    payload: o.payload || {},
    actor: o.actor,
    note: o.note || String(stamp.reason || '').trim() ||
      `${kind} ${String(stamp.source || '').trim()}`.trim()
  });
}

/**
 * The entry for a correction: the fields that moved, and nothing else (§1.5).
 *
 * A whole row would make every correction a fresh assertion of every column,
 * so a stale field would silently undo a change made between the read and the
 * append — which is the class of fault this tab exists to remove. A caller
 * with nothing to report composes nothing, because an entry that sets no
 * fields records that somebody pressed something and not what it did.
 */
function ledgerEntryForCorrection_(row, map, payload, opts) {
  const o = opts || {};
  const fields = payload || {};
  if (!Object.keys(fields).length) return null;
  return makeLedgerEntry({
    kind: o.kind || LEDGER_KINDS.CORRECTED,
    source: o.source || LEDGER_SOURCES.QUICK_MARK,
    occurredAt: o.occurredAt || null,
    registrationId: o.registrationId || ledgerIdForRegistrantRow(row, map),
    eventId: o.eventId || row[map['Event_ID']],
    name: row[map['Name']],
    personType: row[map['Person_Type']],
    partyId: map['Party_ID'] === undefined ? '' : row[map['Party_ID']],
    payload: fields,
    note: o.note || ''
  });
}
