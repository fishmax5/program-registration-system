// ============================================================================
// 99zn. A LEADER'S ROSTER, SERVED AS A PAGE  (item #5 of the restructuring)
// ============================================================================
//
// THE SHEET WAS THE WRONG SHAPE FOR THE JOB. Section 9b (`46`) gives every
// program its own spreadsheet, pushes the roster into it hourly and pulls the
// leader's five ticks back out through a per-cell snapshot merge. It works,
// and it is the most expensive thing the sync does: a foreign spreadsheet per
// program, fingerprints, crash markers, a sharing sweep (`89`), Drive change
// detection (`99zf`) and a doctor (`99h`) for the ways those copies drift.
//
// A PAGE HAS NO COPY TO DRIFT. `?mode=roster&t=<token>` on the deployment the
// door already uses draws ONE program's roster at the moment somebody looks,
// from All_Registrants and the session table, through the push's OWN join
// (buildLeaderSheetRowsByProgram / leaderSheetContentFor, `46`) — so the page
// and the sheet cannot disagree about who is on it. The ticks are buttons, and
// a press writes the same cells on the same row the hourly merge would have,
// through the same two writers (`71`), with the ledger told (`leader-page`).
//
// NOTHING CHANGES UNTIL THE OFFICE SAYS SO. Program_Settings gained
// Roster_Delivery (`03`, appended last): blank or Sheet is today's behaviour,
// Both shows the page as a read-only preview beside the sheet, and Web makes
// the page the roster. ONE SOURCE OF TRUTH PER PROGRAM AT A TIME: the page
// refuses every write until the program is Web AND its sheet has been cut
// over — protected first, read one last time after, bannered, and only then
// marked settled (cutOverLeaderSheet_). See
// docs/transitions/R5_leader_web_roster.md for the whole plan and rollback.
//
// WHO CAN SEE IT. One unguessable token per program (title × building, the
// same privacy boundary as the sheet), in Script Properties, revocable and
// rotatable from Rosters & Sharing ▸ Leader Roster Pages…, and NEVER logged:
// no log line, office note or doctor line here carries a token or a page URL.
// The web app runs as the owner, so every server call re-checks the token and
// a write re-checks that the row belongs to that token's program. The staff
// dialog's calls carry a one-time staff key, because anything public here can
// be called by google.script.run from any page this deployment serves.
//
// LOAD ORDER. Behavior plus self-contained constants; everything it reaches for
// (`46`'s join, `71`'s writers, `38`'s row patch, `99b`'s queue, `99w`'s lock,
// `60`'s link builder) it reads at CALL time or through a hoisted function.
// ============================================================================

/** The three answers Roster_Delivery accepts. Blank (and anything else) reads as Sheet. */
const ROSTER_DELIVERY = Object.freeze({ SHEET: 'Sheet', BOTH: 'Both', WEB: 'Web' });
const ROSTER_DELIVERY_OPTIONS = ['Sheet', 'Both', 'Web'];

/** programKey -> { token, title, location, createdAt }. Versioned like every stored shape. */
const LEADER_ROSTER_TOKENS_PROP_KEY = 'LEADER_ROSTER_TOKENS_V1';

/** programKey -> { fileId, frozenAt, settledAt }: how far a sheet's move to the page has got. */
const LEADER_ROSTER_CUTOVER_PROP_KEY = 'LEADER_ROSTER_CUTOVER_V1';

/** The ?mode= the page answers to — WITH a ?t=. Without one, 'roster' is still the staff roster (`60`). */
const LEADER_ROSTER_MODE = 'roster';

/** How a frozen sheet's protection is recognized again, so a rollback removes ours and nobody else's. */
const LEADER_ROSTER_PROTECTION_DESCRIPTION = 'Moved to the web roster page';

/** A leader's note, capped like every other free-text field that arrives from outside. */
const LEADER_ROSTER_NOTE_MAX_CHARS = 500;

/** The staff dialog's one-time key: how long a dialog left open stays usable. */
const LEADER_ROSTER_STAFF_KEY_TTL_SECONDS = 6 * 60 * 60;
const LEADER_ROSTER_STAFF_KEY_PREFIX = 'LEADER_ROSTER_STAFF_';

/** What an unknown, rotated or revoked link is told — the same words for all three, on purpose. */
const LEADER_ROSTER_INVALID_LINK_TEXT =
  'This roster link is not valid any more. Ask the office for the current one.';


// --- Roster_Delivery --------------------------------------------------------

let __rosterDeliveryMemo = null;

/** "web", "WEB ", "Web" → Web; "both" → Both; anything else → Sheet. */
function normalizeRosterDelivery(value) {
  const v = String(value === null || value === undefined ? '' : value).trim().toLowerCase();
  if (v === 'web') return ROSTER_DELIVERY.WEB;
  if (v === 'both') return ROSTER_DELIVERY.BOTH;
  return ROSTER_DELIVERY.SHEET;
}

/**
 * programKey -> { delivery, title, location } for every Program_Settings row
 * NOT on Sheet, read once per execution. Never throws: a tab that cannot be
 * read means every program is on Sheet, which is exactly today's behaviour.
 */
function readRosterDeliveryByProgram_() {
  if (__rosterDeliveryMemo) return __rosterDeliveryMemo;
  const out = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss && ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS);
    if (sheet) {
      const headers = HEADERS.Program_Settings;
      const map = getIndexMap(headers);
      readSimpleTable(sheet, headers).forEach(row => {
        const delivery = normalizeRosterDelivery(row[map['Roster_Delivery']]);
        if (delivery === ROSTER_DELIVERY.SHEET) return;
        const title = String(row[map['Event']] || '').trim();
        const location = String(row[map['Location']] || '').trim();
        if (!title) return;
        out[leaderProgramKey(title, location)] = { delivery, title, location };
      });
    }
  } catch (err) {
    log(`ℹ️ Could not read Roster_Delivery off ${SHEET_NAMES.PROGRAM_SETTINGS} (${err}) — every roster stays on its sheet this run.`);
  }
  __rosterDeliveryMemo = out;
  return out;
}

/** Sheet, Both or Web for one program (leaderProgramKey). */
function rosterDeliveryFor(programKey) {
  const entry = readRosterDeliveryByProgram_()[programKey];
  return entry ? entry.delivery : ROSTER_DELIVERY.SHEET;
}


// --- tokens -----------------------------------------------------------------

function readLeaderRosterTokens_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(LEADER_ROSTER_TOKENS_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeLeaderRosterTokens_(tokens) {
  PropertiesService.getScriptProperties().setProperty(LEADER_ROSTER_TOKENS_PROP_KEY, JSON.stringify(tokens || {}));
}

/** Two UUIDs' worth of hex: unguessable, URL-safe, and nothing in it means anything. */
function newLeaderRosterToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
}

/** A shape check before any lookup, so a junk ?t= costs nothing and matches nothing. */
function isLeaderRosterTokenShape_(token) {
  return /^[0-9a-f]{40,128}$/.test(String(token || ''));
}

/** { programKey, title, location } for a live token, or null. Never logs the token. */
function resolveLeaderRosterToken_(token) {
  const wanted = String(token || '').trim().toLowerCase();
  if (!isLeaderRosterTokenShape_(wanted)) return null;
  const tokens = readLeaderRosterTokens_();
  const keys = Object.keys(tokens);
  for (let i = 0; i < keys.length; i++) {
    const entry = tokens[keys[i]] || {};
    if (entry.token && entry.token === wanted) {
      return { programKey: keys[i], title: entry.title || '', location: entry.location || '' };
    }
  }
  return null;
}

/** The program's token, minted (and stored) if it has none. Callers hold the workbook lock or are the sync. */
function ensureLeaderRosterToken_(programKey, title, location) {
  const tokens = readLeaderRosterTokens_();
  if (tokens[programKey] && tokens[programKey].token) return tokens[programKey].token;
  const token = newLeaderRosterToken_();
  tokens[programKey] = { token, title: String(title || ''), location: String(location || ''),
    createdAt: new Date().toISOString() };
  writeLeaderRosterTokens_(tokens);
  log(`Leader roster page: a link was made for "${title}" (${location}).`);
  return token;
}

/** The page's address for one program, or '' (no token yet, or the web app was never deployed). */
function leaderRosterPageUrl(programKey) {
  const entry = readLeaderRosterTokens_()[programKey];
  if (!entry || !entry.token) return '';
  return leaderRosterUrlForToken_(entry.token);
}

function leaderRosterUrlForToken_(token) {
  return checkInPageUrl({ mode: LEADER_ROSTER_MODE, params: { t: token } });
}


// --- which link a leader is sent -------------------------------------------

/**
 * The link a leader's email carries (`66`): the sheet on Sheet, the sheet plus
 * the page on Both, the page on Web. A token is made on demand for Both and
 * Web, so the office never has to remember to. An undeployed web app falls
 * back to the sheet rather than to nothing.
 */
function leaderRosterEmailLink(programKey, entry) {
  const sheetUrl = entry && entry.fileId ? `https://docs.google.com/spreadsheets/d/${entry.fileId}/edit` : '';
  const sheetLink = { url: sheetUrl, label: 'Your sign-up sheet', alsoUrl: '' };
  let delivery = ROSTER_DELIVERY.SHEET;
  try { delivery = rosterDeliveryFor(programKey); } catch (err) { return sheetLink; }
  if (delivery === ROSTER_DELIVERY.SHEET) return sheetLink;
  let pageUrl = '';
  try {
    const settings = readRosterDeliveryByProgram_()[programKey] || {};
    const token = ensureLeaderRosterToken_(programKey, settings.title || (entry && entry.title),
      settings.location || (entry && entry.location));
    pageUrl = leaderRosterUrlForToken_(token);
  } catch (err) {
    log(`ℹ️ Could not build the web roster link for a leader email (${err}) — the sheet link is sent instead.`);
  }
  if (delivery === ROSTER_DELIVERY.BOTH) {
    if (!sheetUrl) return { url: pageUrl, label: 'Your roster page', alsoUrl: '' };
    return { url: sheetUrl, label: 'Your sign-up sheet', alsoUrl: pageUrl };
  }
  return pageUrl ? { url: pageUrl, label: 'Your roster page', alsoUrl: '' } : sheetLink;
}


// --- cutover state ----------------------------------------------------------

// Held for the execution: the push and the pull each ask once per sheet, and
// ninety property reads an hour to learn "nothing has moved" is the kind of
// cost this whole item exists to remove. Every write goes through the setter
// below, so the copy cannot go stale inside one run.
let __leaderRosterCutoverMemo = null;

/** A COPY of the cutover state — callers mutate and write it back. */
function readLeaderRosterCutover_() {
  if (!__leaderRosterCutoverMemo) {
    let parsed = {};
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(LEADER_ROSTER_CUTOVER_PROP_KEY);
      parsed = raw ? JSON.parse(raw) : {};
    } catch (err) {
      parsed = {};
    }
    __leaderRosterCutoverMemo = parsed && typeof parsed === 'object' ? parsed : {};
  }
  return JSON.parse(JSON.stringify(__leaderRosterCutoverMemo));
}

function writeLeaderRosterCutover_(state) {
  PropertiesService.getScriptProperties().setProperty(LEADER_ROSTER_CUTOVER_PROP_KEY, JSON.stringify(state || {}));
  __leaderRosterCutoverMemo = JSON.parse(JSON.stringify(state || {}));
}

/**
 * Has this program's sheet been frozen AND read one last time? Then nothing
 * reads it again — the page is the roster. Deliberately NOT conditional on the
 * delivery still saying Web: between the office switching back and the
 * rollback running, a frozen sheet's stale cells would otherwise be pulled
 * back over whatever the page did since. The rollback is what un-retires it.
 */
function leaderRosterSheetRetired(programKey) {
  const st = readLeaderRosterCutover_()[programKey];
  return !!(st && st.settledAt);
}

/**
 * The push's question, per sheet (`46`): should this sheet be left alone?
 * True for a Web program — cut over first if it has not been. A program that
 * has come back off the web is rolled back here and answered false, so the
 * push redraws its sheet in the same pass. Never throws.
 */
function leaderRosterHandlesSheet_(programKey, entry) {
  let delivery;
  let state;
  try {
    delivery = rosterDeliveryFor(programKey);
    state = readLeaderRosterCutover_();
  } catch (err) {
    return false;
  }
  const st = state[programKey];
  if (delivery !== ROSTER_DELIVERY.WEB) {
    if (st) rollBackLeaderRosterCutover_(programKey, entry);
    return false;
  }
  if (st && st.settledAt) return true;
  cutOverLeaderSheet_(programKey, entry);
  return true;
}

/** Protects a roster tab outright — every editor but the owner removed. Returns the protection. */
function freezeLeaderSheetTab_(tab) {
  const existing = tab.getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .filter(p => p.getDescription() === LEADER_ROSTER_PROTECTION_DESCRIPTION);
  const protection = existing[0] || tab.protect().setDescription(LEADER_ROSTER_PROTECTION_DESCRIPTION);
  protection.setWarningOnly(false);
  const editors = protection.getEditors();
  if (editors && editors.length) protection.removeEditors(editors);
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  return protection;
}

/**
 * MOVES ONE PROGRAM FROM ITS SHEET TO ITS PAGE, in the only order that loses
 * nothing: freeze, then read, then banner, then settle.
 *
 *   1. FREEZE. From this moment a leader cannot type a tick this code would
 *      then fail to read. Recorded at once (`frozenAt`).
 *   2. READ, AFTER THE FREEZE — the pull's own per-cell rule
 *      (collectLeaderSheetEdits_), applied through the page's own locked
 *      writer with the ledger's `leader-sheet` source, because that is where
 *      the tick was made. Usually empty: the pull at the head of the sync has
 *      already read everything up to a few minutes ago.
 *   3. BANNER on both tabs, pointing at the page. The file is never trashed,
 *      unshared or renamed — a link already handed out keeps opening.
 *   4. SETTLE, only once 2 and 3 have landed. A failure anywhere after 1
 *      leaves the sheet frozen and un-settled (page read-only, pull still reads
 *      it), says so in the digest, and the next run starts again at 2 —
 *      harmless, since the writer no-ops on a cell already holding the value.
 *
 * Never throws: the push calls this per sheet, and one program's move must
 * not stop the others' rosters.
 */
function cutOverLeaderSheet_(programKey, entry) {
  const name = `"${(entry && entry.title) || programKey}"${entry && entry.location ? ` (${entry.location})` : ''}`;
  try {
    if (!entry || !entry.fileId) return { ok: true, applied: 0 };
    const file = openSpreadsheetCached(entry.fileId);
    const tab = file.getSheetByName(LEADER_SHEET_TAB_NAME);
    if (tab) freezeLeaderSheetTab_(tab);
    let state = readLeaderRosterCutover_();
    state[programKey] = Object.assign({}, state[programKey] || {}, {
      fileId: entry.fileId,
      frozenAt: (state[programKey] && state[programKey].frozenAt) || new Date().toISOString()
    });
    delete state[programKey].settledAt;
    writeLeaderRosterCutover_(state);

    let applied = 0;
    if (tab) {
      const edits = collectLeaderSheetEdits_(readSimpleTable(tab, LEADER_SHEET_HEADERS), {});
      const rowKeys = Object.keys(edits);
      if (rowKeys.length) {
        // Reentrant inside the sync (99w); taken here for the menu's Switch now.
        const result = withScriptLock(30 * 1000, () => {
          let n = 0;
          rowKeys.forEach(rowKey => {
            const changes = {};
            LEADER_OWNED_COLUMNS.forEach((col, i) => {
              if (edits[rowKey].changed[i]) changes[col] = edits[rowKey].values[i];
            });
            const res = applyLeaderRosterEditLocked_({
              programKey, rowKey, changes, trusted: true,
              source: LEDGER_SOURCES.LEADER_SHEET,
              note: 'Read off the program registrant sheet as it was frozen for the move to the web roster page.'
            });
            // A row that has left the Registrants tab is not a tick anybody can lose.
            if (!res.ok && !res.notFound) throw new Error(res.message);
            n += res.changed || 0;
          });
          return n;
        }, null, 'Leader roster cutover');
        if (result === null) throw new Error('the workbook was busy, so the last ticks could not be read yet');
        applied = result;
      }
    }

    writeLeaderRosterSheetBanners_(file, programKey);

    state = readLeaderRosterCutover_();
    state[programKey] = Object.assign({}, state[programKey] || {}, { settledAt: new Date().toISOString() });
    writeLeaderRosterCutover_(state);
    log(`Program registrant sheet for ${name} moved to the web roster page — ${applied} last ` +
      `tick(s) read off it; the sheet is frozen and kept.`);
    return { ok: true, applied };
  } catch (err) {
    log(`⚠️ Could not finish moving ${name} to the web roster page (${err}) — tried again next sync.`);
    noteForAdmin('Program rosters that could not move to the web page yet',
      `${name} is set to Web on ${SHEET_NAMES.PROGRAM_SETTINGS}, but its spreadsheet could not be switched ` +
      `over (${err}). Until it is, the page stays read-only and the spreadsheet's ticks are still read. ` +
      `Nothing has been lost; the next sync tries again.`);
    return { ok: false, message: String(err) };
  }
}

/** Row 1 of both tabs says where the roster went. The link is the page's — the sheet's audience already has it. */
function writeLeaderRosterSheetBanners_(file, programKey) {
  const url = leaderRosterPageUrl(programKey);
  const text = url
    ? `📋 This roster has moved to a web page, which is always up to date: ${url}`
    : '📋 This roster has moved to a web page — ask the office for the link.';
  const note = 'This spreadsheet is no longer updated, and ticks typed here are not read. Everything ' +
    'ticked here before the move has been carried over. Use the web page from now on.';
  [LEADER_SHEET_TAB_NAME, LEADER_WAITLIST_TAB_NAME].forEach(tabName => {
    const tab = file.getSheetByName(tabName);
    if (!tab) return;
    tab.getRange(MEMORY_TAB_BANNER_ROW, 1).setValue(text).setNote(note);
  });
}

/**
 * Web → Sheet or Both: our protection off, the state gone, and the stored
 * fingerprint dropped so the push redraws the whole sheet — banner, every tick
 * made on the page, a fresh snapshot — in the same pass. Never throws; a
 * failure is tried again next run, and the push writes through a protection
 * the owner holds anyway.
 */
function rollBackLeaderRosterCutover_(programKey, entry) {
  const name = `"${(entry && entry.title) || programKey}"`;
  try {
    if (entry && entry.fileId) {
      const file = openSpreadsheetCached(entry.fileId);
      const tab = file.getSheetByName(LEADER_SHEET_TAB_NAME);
      if (tab) {
        tab.getProtections(SpreadsheetApp.ProtectionType.SHEET)
          .filter(p => p.getDescription() === LEADER_ROSTER_PROTECTION_DESCRIPTION)
          .forEach(p => p.remove());
      }
      const fresh = Object.assign({}, getProgramLeaderSheetRegistry()[programKey] || entry);
      delete fresh.pushedFingerprint;
      saveProgramLeaderSheetRegistryEntry(programKey, fresh);
      flushProgramLeaderSheetRegistry_();
      delete entry.pushedFingerprint;
    }
    const state = readLeaderRosterCutover_();
    delete state[programKey];
    writeLeaderRosterCutover_(state);
    log(`Program registrant sheet for ${name} is the roster again — unfrozen and redrawn from the workbook.`);
  } catch (err) {
    log(`⚠️ Could not move ${name} back onto its spreadsheet (${err}) — tried again next sync.`);
  }
}


// --- reading a roster -------------------------------------------------------

let __leaderRosterRowsMemo = null;

/** The push's own join, once per execution. */
function leaderRosterRowsByProgram_() {
  if (__leaderRosterRowsMemo) return __leaderRosterRowsMemo;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = getSectionedRows(ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD),
    HEADERS.All_Program_Sessions, 'Event_ID');
  const registrantRows = getSectionedRows(ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH),
    HEADERS.All_Registrants, 'Event_ID');
  __leaderRosterRowsMemo = {
    sessionRows,
    byProgram: buildLeaderSheetRowsByProgram(sessionRows, registrantRows)
  };
  return __leaderRosterRowsMemo;
}

function forgetLeaderRosterRows_() {
  __leaderRosterRowsMemo = null;
}

/** May the page write this program's ticks right now? { writable, reason }. */
function leaderRosterWriteState_(programKey) {
  const delivery = rosterDeliveryFor(programKey);
  if (delivery === ROSTER_DELIVERY.BOTH) {
    return { writable: false, reason: 'For now, ticks for this class are still made on its spreadsheet. ' +
      'This page shows the same roster.' };
  }
  if (delivery !== ROSTER_DELIVERY.WEB) {
    return { writable: false, reason: 'Ticks for this class are made on its spreadsheet. This page shows ' +
      'the same roster, read-only.' };
  }
  const entry = getProgramLeaderSheetRegistry()[programKey];
  if (entry && entry.fileId && !leaderRosterSheetRetired(programKey)) {
    return { writable: false, reason: 'This roster is moving here from its spreadsheet. The buttons switch ' +
      'on as soon as the last ticks on the spreadsheet have been read — usually within a few hours.' };
  }
  return { writable: true, reason: '' };
}

/** A date-free label for a cell value a page can carry (google.script.run refuses a Date). */
function leaderRosterText_(value) {
  if (value && typeof value.getMonth === 'function') return formatDateLabel(value);
  return String(value === null || value === undefined ? '' : value).trim();
}

/**
 * Everything the page draws, as plain strings, numbers and booleans. Every
 * row is in its session's band — the waiting ones too, at the foot of the
 * band, so a leader can see them and untick one — and the Waitlist section
 * underneath is the sheet's Waitlist tab, one line per person.
 */
function leaderRosterView(token) {
  const program = resolveLeaderRosterToken_(token);
  if (!program) return { ok: false, message: LEADER_ROSTER_INVALID_LINK_TEXT };
  const data = leaderRosterRowsByProgram_();
  const rows = data.byProgram[program.programKey] || [];
  const content = leaderSheetContentFor({ title: program.title, location: program.location }, rows);
  const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
  const waitMap = getIndexMap(LEADER_WAITLIST_HEADERS);
  const todayKey = formatDateKey(new Date());
  const state = leaderRosterWriteState_(program.programKey);

  const sessions = groupLeaderSheetRowsBySession(rows, sheetMap).map(group => {
    const dateKey = group.date ? formatDateKey(group.date) : '';
    return {
      label: leaderSheetSessionBandLabel(group),
      dateKey,
      past: !!dateKey && dateKey < todayKey,
      rows: group.rows.map(row => ({
        key: String(row[sheetMap['Row_Key']] || ''),
        date: group.date ? formatDateLabel(group.date) : '',
        time: leaderRosterText_(row[sheetMap['Event_Time']]),
        name: leaderRosterText_(row[sheetMap['Name']]),
        party: leaderRosterText_(row[sheetMap['Party_Size']]),
        phone: leaderRosterText_(row[sheetMap['Phone']]),
        email: leaderRosterText_(row[sheetMap['Email']]),
        status: leaderRosterText_(row[sheetMap['Program_Status']]) || 'Active',
        Contacted: normalizeLeaderFlag(row[sheetMap['Contacted']]),
        Confirmed: normalizeLeaderFlag(row[sheetMap['Confirmed']]),
        Waitlisted: normalizeLeaderFlag(row[sheetMap['Waitlisted']]),
        Dropped: normalizeLeaderFlag(row[sheetMap['Dropped']]),
        notes: leaderRosterText_(row[sheetMap['Leader_Notes']]),
        answers: leaderRosterText_(row[sheetMap['Answers']])
      }))
    };
  });

  return {
    ok: true,
    title: program.title,
    location: program.location,
    writable: state.writable,
    reason: state.reason,
    refreshed: `${formatDateLabel(new Date())}, ${formatTimeLabel(new Date())}`,
    sessions,
    waitlist: content.waitlist.map(row => ({
      name: leaderRosterText_(row[waitMap['Name']]),
      phone: leaderRosterText_(row[waitMap['Phone']]),
      email: leaderRosterText_(row[waitMap['Email']]),
      party: leaderRosterText_(row[waitMap['Party_Size']]),
      dates: leaderRosterText_(row[waitMap['Dates']]),
      added: leaderRosterText_(row[waitMap['Added']]),
      notes: leaderRosterText_(row[waitMap['Notes']])
    }))
  };
}


// --- the page's two calls ---------------------------------------------------

/** google.script.run: the roster again (Refresh, and after a queued tick). */
function leaderRosterData(token) {
  try {
    return leaderRosterView(String(token || ''));
  } catch (err) {
    log(`⚠️ A web roster page could not be read (${err}).`);
    return { ok: false, message: 'The roster could not be read just now — try again in a minute.' };
  }
}

/**
 * google.script.run: one tick (or the notes box) on one row.
 *
 * Checked in this order, every time: the token, whether the page may write
 * this program at all (Web and settled), the column. Behind a sync it is
 * queued on 99b exactly as Quick Mark is (deferQuickMarkBehindSync_), carrying
 * the program key and never the token, and applied when the sync lets go.
 */
function leaderRosterMark(token, rowKey, column, value) {
  try {
    const program = resolveLeaderRosterToken_(String(token || ''));
    if (!program) return { ok: false, message: LEADER_ROSTER_INVALID_LINK_TEXT };
    const state = leaderRosterWriteState_(program.programKey);
    if (!state.writable) return { ok: false, message: state.reason };
    const col = String(column || '');
    if (LEADER_OWNED_COLUMNS.indexOf(col) === -1) {
      return { ok: false, message: 'That column cannot be changed here.' };
    }
    const key = String(rowKey || '');
    const changes = {};
    changes[col] = value;
    const args = {
      programKey: program.programKey,
      programTitle: program.title,
      rowKey: key,
      changes,
      source: LEDGER_SOURCES.LEADER_PAGE,
      note: 'Ticked on the web roster page.',
      name: leaderRosterNameFor_(program.programKey, key),
      optimistic: true
    };
    const deferred = deferQuickMarkBehindSync_('leaderRosterMark', args, false);
    if (deferred) return deferred;
    const busy = { ok: false, busy: true, message: '⏳ The workbook is mid-update — nothing was saved. Try again in a moment.' };
    const result = withScriptLock(DESK_LOCK_WAIT_MS, () => applyLeaderRosterEditLocked_(args), busy, 'Leader roster page');
    if (result === busy) {
      const queued = deferQuickMarkBehindSync_('leaderRosterMark', args, true);
      return queued || busy;
    }
    if (result && result.ok) result.view = leaderRosterView(String(token || ''));
    return result;
  } catch (err) {
    log(`⚠️ A tick on a web roster page could not be saved (${err}).`);
    return { ok: false, message: 'That could not be saved just now — try again in a minute.' };
  }
}

/** The name on one roster line, for the "saved for …" message. '' when it is not on this program's roster. */
function leaderRosterNameFor_(programKey, rowKey) {
  try {
    const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
    const rows = leaderRosterRowsByProgram_().byProgram[programKey] || [];
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][sheetMap['Row_Key']] || '') === rowKey) return String(rows[i][sheetMap['Name']] || '');
    }
  } catch (err) { /* only a message */ }
  return '';
}

/** Equality the way a cell reads back: true/"TRUE", 2/"2", '' / null. */
function leaderRosterSameCell_(a, b) {
  if (a === b) return true;
  const sa = a && typeof a.getTime === 'function' ? String(a.getTime()) : String(a === null || a === undefined ? '' : a);
  const sb = b && typeof b.getTime === 'function' ? String(b.getTime()) : String(b === null || b === undefined ? '' : b);
  return sa === sb;
}

/**
 * THE WRITE, with the workbook lock already held (the page's call, 99b's
 * retry, the cutover). Finds every row on All_Registrants carrying this
 * Row_Key, sets the leader columns it was handed, tells the ledger, and runs
 * the two writers the hourly sync runs — a Dropped tick is the four-cell
 * cancellation, a Waitlisted tick (or untick) the two-way waitlist — on THOSE
 * rows only. Then it writes back only the cells that moved
 * (writeRegistrantRowPatch_: the formula columns between are never touched).
 *
 * `trusted` skips the check that the row is on this program's roster now —
 * for the cutover, whose row keys came off the program's own sheet and may
 * have left the page's window since.
 */
function applyLeaderRosterEditLocked_(args) {
  const a = args || {};
  const programKey = String(a.programKey || '');
  const rowKey = String(a.rowKey || '');
  const source = a.source || LEDGER_SOURCES.LEADER_PAGE;
  const note = a.note || 'Ticked on the web roster page.';
  const clean = {};
  Object.keys(a.changes || {}).forEach(col => {
    if (LEADER_OWNED_COLUMNS.indexOf(col) === -1) return;
    clean[col] = LEADER_FLAG_COLUMNS.indexOf(col) === -1
      ? normalizeLeaderNote(a.changes[col]).slice(0, LEADER_ROSTER_NOTE_MAX_CHARS)
      : normalizeLeaderFlag(a.changes[col]);
  });
  if (!rowKey || !Object.keys(clean).length) return { ok: false, message: 'Nothing to change.' };

  const notOnRoster = { ok: false, notFound: true,
    message: 'That person is no longer on this roster — refresh the page.' };
  if (!a.trusted) {
    const sheetMap = getIndexMap(LEADER_SHEET_HEADERS);
    const rows = leaderRosterRowsByProgram_().byProgram[programKey] || [];
    if (!rows.some(row => String(row[sheetMap['Row_Key']] || '') === rowKey)) return notOnRoster;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return notOnRoster;
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const numCols = headers.length;
  const grid = readSheetGrid(sheet, false);
  const matches = [];
  getSectionZones(sheet, 'Event_ID').forEach(zone => {
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;
    const values = grid
      ? grid.values.slice(zone.dataStart - 1, zone.dataEnd)
      : sheet.getRange(zone.dataStart, 1, count, numCols).getValues();
    values.forEach((row, i) => {
      if (leaderRowKey(row[map['Event_ID']], row[map['Party_ID']], row[map['Name']]) !== rowKey) return;
      matches.push({ sheetRow: zone.dataStart + i, row: row.slice(0, numCols) });
    });
  });
  if (!matches.length) return notOnRoster;

  let changed = 0;
  let statusMoved = false;
  let refused = false;
  let sessionRows = null;
  matches.forEach(match => {
    const row = match.row;
    while (row.length < numCols) row.push('');
    const before = row.slice();
    const changedHeaders = [];
    Object.keys(clean).forEach(col => {
      if (map[col] === undefined) return;
      const was = LEADER_FLAG_COLUMNS.indexOf(col) === -1
        ? normalizeLeaderNote(row[map[col]]) : normalizeLeaderFlag(row[map[col]]);
      if (was === clean[col]) return;
      row[map[col]] = clean[col];
      changedHeaders.push(col);
    });
    if (!changedHeaders.length) return;

    // The same `corrected` the hourly merge appends for a sheet tick, with
    // this door's Source. Guarded whole: a ledger that will not write must not
    // cost the leader the tick (the verifier names the row instead).
    try {
      const entry = ledgerEntryForCorrection_(row, map, ledgerColumnsPayload_(row, map, changedHeaders),
        { source, note });
      if (entry) appendLedgerEntry(entry);
    } catch (err) {
      log(`⚠️ A leader's tick was saved but could not be recorded in the ledger (${err}).`);
    }
    if (changedHeaders.indexOf('Dropped') !== -1 && clean.Dropped) {
      applyLeaderDropsAsCancellations([row], { ledgerSource: source, note });
    }
    if (changedHeaders.indexOf('Waitlisted') !== -1) {
      if (!sessionRows) {
        sessionRows = getSectionedRows(ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD),
          HEADERS.All_Program_Sessions, 'Event_ID');
      }
      const others = getSectionedRows(sheet, headers, 'Event_ID').filter(other =>
        leaderRowKey(other[map['Event_ID']], other[map['Party_ID']], other[map['Name']]) !== rowKey);
      applyLeaderWaitlistTicks(others.concat([row]), sessionRows, { ledgerSource: source, note, only: [row] });
      if (!clean.Waitlisted && String(row[map['Program_Status']] || '').trim() === 'Waitlisted') refused = true;
    }

    const patch = {};
    headers.forEach((header, i) => {
      if (!leaderRosterSameCell_(before[i], row[i])) patch[header] = row[i];
    });
    writeRegistrantRowPatch_(sheet, map, match.sheetRow, patch);
    changed += changedHeaders.length;
    if (!leaderRosterSameCell_(before[map['Program_Status']], row[map['Program_Status']])) statusMoved = true;
  });

  invalidateSectionedRowsCache(sheet);
  forgetLeaderRosterRows_();
  if (statusMoved) {
    // The seat and the meal go back now, as they do from Quick Mark.
    try {
      const settled = getSectionedRows(sheet, headers, 'Event_ID');
      const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
      if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, settled);
      updateMasterLunchDashboard(settled);
    } catch (err) {
      log(`⚠️ A leader's tick changed a place, but the counts could not be recalculated (${err}) — the next sync will.`);
    }
  }
  const message = refused
    ? 'Saved — but they stay on the waiting list: the session is full or closed, or the waiting list there is ' +
      'in the order people signed up. The office can move them.'
    : changed ? '✅ Saved.' : 'Already saved.';
  return { ok: true, changed, statusMoved, message };
}


// --- the staff dialog -------------------------------------------------------

/** MENU ACTION — Rosters & Sharing ▸ Leader Roster Pages…: links, rotation and the switch, per program. */
function showLeaderRosterPagesDialog() {
  const html = HtmlService.createHtmlOutput(buildLeaderRosterPagesDialogHtml({
    staffKey: issueLeaderRosterStaffKey_(),
    programs: listLeaderRosterPrograms_()
  })).setWidth(780).setHeight(580);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Leader Roster Pages');
}

/** A one-time key for one opened dialog, so a page served to the public cannot drive these calls. */
function issueLeaderRosterStaffKey_() {
  const key = newLeaderRosterToken_();
  const cache = tryGetScriptCache();
  if (cache) cache.put(LEADER_ROSTER_STAFF_KEY_PREFIX + key, '1', LEADER_ROSTER_STAFF_KEY_TTL_SECONDS);
  return key;
}

function leaderRosterStaffKeyValid_(key) {
  if (!isLeaderRosterTokenShape_(key)) return false;
  const cache = tryGetScriptCache();
  return !!(cache && cache.get(LEADER_ROSTER_STAFF_KEY_PREFIX + key));
}

/** Every program on Program_Settings, plus any that only the token store still names. */
function listLeaderRosterPrograms_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS);
  const headers = HEADERS.Program_Settings;
  const map = getIndexMap(headers);
  const tokens = readLeaderRosterTokens_();
  const cutover = readLeaderRosterCutover_();
  const registry = getProgramLeaderSheetRegistry();
  const out = [];
  const seen = {};
  const add = (key, title, location, delivery) => {
    if (seen[key]) return;
    seen[key] = true;
    const st = cutover[key] || {};
    const token = tokens[key] && tokens[key].token;
    out.push({
      key, title, location, delivery,
      hasSheet: !!(registry[key] && registry[key].fileId),
      move: st.settledAt ? 'moved' : st.frozenAt ? 'frozen' : '',
      url: token ? leaderRosterUrlForToken_(token) : ''
    });
  };
  (sheet ? readSimpleTable(sheet, headers) : []).forEach(row => {
    const title = String(row[map['Event']] || '').trim();
    if (!title) return;
    const location = String(row[map['Location']] || '').trim();
    add(leaderProgramKey(title, location), title, location, normalizeRosterDelivery(row[map['Roster_Delivery']]));
  });
  Object.keys(tokens).forEach(key => {
    add(key, tokens[key].title || key, tokens[key].location || '', ROSTER_DELIVERY.SHEET);
  });
  out.sort((x, y) => x.title.localeCompare(y.title) || x.location.localeCompare(y.location));
  return out;
}

/**
 * google.script.run from the staff dialog: 'create' | 'rotate' | 'revoke' |
 * 'switch'. Refused without the dialog's own staff key. Answers with the
 * refreshed list, so the dialog never has to ask for it on its own.
 */
function leaderRosterPagesAction(staffKey, programKey, action) {
  if (!leaderRosterStaffKeyValid_(String(staffKey || ''))) {
    return { ok: false, message: 'This window has expired — close it and open it again from the menu.' };
  }
  try {
    const programs = listLeaderRosterPrograms_();
    const program = programs.filter(p => p.key === programKey)[0];
    if (!program) return { ok: false, message: 'That program is not on the list any more.', programs };
    const busy = { ok: false, message: '⏳ The workbook is mid-update — try again in a moment.' };
    const result = withScriptLock(30 * 1000, () => {
      const tokens = readLeaderRosterTokens_();
      if (action === 'create' || action === 'rotate') {
        const hadOne = !!(tokens[programKey] && tokens[programKey].token);
        tokens[programKey] = { token: newLeaderRosterToken_(), title: program.title, location: program.location,
          createdAt: new Date().toISOString() };
        writeLeaderRosterTokens_(tokens);
        log(`Leader roster page: ${hadOne ? 'a new link replaced the old one' : 'a link was made'} for ` +
          `"${program.title}" (${program.location}).`);
        return { ok: true, message: hadOne ? 'New link made — the old one has stopped working.' : 'Link made.' };
      }
      if (action === 'revoke') {
        delete tokens[programKey];
        writeLeaderRosterTokens_(tokens);
        log(`Leader roster page: the link for "${program.title}" (${program.location}) was turned off.`);
        return { ok: true, message: 'Link turned off — it no longer opens anything.' };
      }
      if (action === 'switch') {
        if (program.delivery !== ROSTER_DELIVERY.WEB) {
          return { ok: false, message: `Set Roster_Delivery to Web on ${SHEET_NAMES.PROGRAM_SETTINGS} first.` };
        }
        const entry = getProgramLeaderSheetRegistry()[programKey];
        if (!entry || !entry.fileId) return { ok: true, message: 'This program has no spreadsheet — the page is already live.' };
        if (leaderRosterSheetRetired(programKey)) return { ok: true, message: 'Already moved.' };
        ensureLeaderRosterToken_(programKey, program.title, program.location);
        const moved = cutOverLeaderSheet_(programKey, entry);
        return moved.ok
          ? { ok: true, message: `Moved — ${moved.applied} last tick(s) read off the spreadsheet, which is now frozen.` }
          : { ok: false, message: `Could not move it yet: ${moved.message}` };
      }
      return { ok: false, message: 'Unknown action.' };
    }, busy, 'Leader roster pages');
    return Object.assign({}, result, { programs: listLeaderRosterPrograms_() });
  } catch (err) {
    log(`⚠️ Leader roster pages: an action could not be completed (${err}).`);
    return { ok: false, message: 'That could not be done just now.' };
  }
}


// --- the doctor's note ------------------------------------------------------

/** Lines for `99h`'s report: which programs are on the web page, by name only — never the link. */
function leaderRosterDoctorLines_(findings) {
  try {
    const web = (findings || []).filter(f => rosterDeliveryFor(f.programKey) === ROSTER_DELIVERY.WEB);
    if (!web.length) return [];
    const lines = [`ON THE WEB ROSTER PAGE (${web.length}) — these programs' sheets are frozen on purpose, ` +
      'so an old roster or a stale fingerprint on them below is expected:'];
    web.forEach(f => {
      lines.push(`• ${f.title || f.programKey}${f.location ? ` — ${f.location}` : ''}: ` +
        (leaderRosterSheetRetired(f.programKey) ? 'moved; the sheet is frozen and kept.' : 'moves at the next sync.'));
    });
    lines.push('');
    return lines;
  } catch (err) {
    return [];
  }
}
