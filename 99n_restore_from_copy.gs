// ============================================================================
// 99n. RESTORING REGISTRANTS FROM A COPY OF THE WORKBOOK
// ============================================================================
//
// THE SITUATION THIS FILE IS FOR. Registrations went missing from
// All_Registrants, and the only second copy of them is a whole copy of the
// workbook somebody made from Google's version history ("Make a copy" on an
// older version). 99j's banner is honest that until the ledger (99k) is being
// written, that copy IS the recovery path. What was missing was a way to use
// it that is not reading two spreadsheets side by side and retyping names.
//
// So: paste the copy's link, and this reads ITS All_Registrants (and its
// Club_Members) beside the live ones and lists the people the copy has that
// the workbook no longer does — grouped by the most likely CAUSE, one tick per
// person per program — and puts the ticked rows back exactly as the copy had
// them.
//
// WHAT IS NOT OFFERED, deliberately (the "hide what was done on purpose"
// rule). Every one of these is a reason the row is gone that somebody chose,
// or a place the row already is:
//
//   • The person is still on that session, under any spelling the duplicate
//     review (85) would call the same person — including cancelled. A
//     cancellation is an answer, not a loss.
//   • The row was Cancelled or Superseded in the copy too — it was never a
//     place.
//   • A TOMBSTONE exists for it (28): somebody deleted it, removed it through
//     "Remove This Row" (83), merged it as a duplicate (85) or moved it (99a).
//   • It is on Deleted_Event_Triage — the calendar event went, and triage has
//     its own restore.
//   • It is a standing-list booking whose membership is now INACTIVE on
//     Club_Members — unticking Active is how somebody leaves a club.
//
// What IS offered is counted in those terms at the top of the dialog, so
// "why is X not in the list?" has an answer on the same screen.
//
// THE THREE KINDS THAT GROW BACK, OR DON'T. A registration is not always one
// row somebody typed once:
//
//   • STANDING-LIST (club) bookings carry `CLUB:<membership key>` as their
//     Party_ID and are re-derived from Club_Members every sync — for UPCOMING
//     dates only. If the membership itself is gone from the live tab, putting
//     the rows back is half a repair: the next date would never be booked. So
//     the memberships the copy has (active) that the live tab has no row for
//     at all are offered in a section of their own, restored verbatim, and the
//     sync's own catch-up does the rest.
//   • EVERY-DATE registrations live in the all-dates registry (06) and are
//     re-derived the same way. A missing row whose submission is still in the
//     registry is labelled as such; one whose submission is NOT, but which
//     the copy shows on several dates of one program under one submission, is
//     labelled as "looks recurring" — restoring brings back the dates the copy
//     knew about, and the label says that later dates will not follow on
//     their own. Nothing here writes the registry: whether somebody asked for
//     every date or ticked five is not on either spreadsheet, and booking a
//     person onto dates they never chose is worse than asking.
//   • The door's "rest of the month" is just desk rows, one per date, and is
//     restored as desk rows.
//
// HOW A ROW GOES BACK. Verbatim — status, meals, marks, notes, Party_ID — with
// three changes: Manual_Override says it was put back by hand (so the next
// sync cannot re-derive it from a form response and drop or alter it, which
// is the property getProtectedRegistrantKeys() gives any hand-edited row), an
// Admin_Notes stamp names the copy it came from, and the two derived link
// columns and a formula Event_Time are blanked for the render to rebuild
// (a formula copied from another row points at the wrong cells). Only rows
// whose SESSION still exists are offered, because a row pointing at an
// Event_ID nothing knows is a registration nobody can find.
//
// THE SERVER RE-DECIDES. The dialog sends back only keys; the write re-reads
// both spreadsheets under the workbook lock and restores only what is STILL
// missing and still offerable — so two people pressing Restore, or a sync
// landing between the scan and the press, cannot put anybody in twice.
//
// NOT THE LEDGER. The ledger (99k) is in phase 1 and nothing appends to it
// yet; when phase 2 wires its writers, this is one of them (a `registered`
// entry per restored row, source 'restore from copy').
// ============================================================================

/** What the Admin_Notes stamp and the Manual_Override say about a restored row. */
const RESTORE_FROM_COPY_OVERRIDE = 'Manually Edited';

/** How many sessions of one program one submission must cover to read as recurring. */
const RESTORE_FROM_COPY_RECURRING_MIN_DATES = 3;

/** The causes, in the order the dialog lists them. Words only; the logic is classifyCopyRegistrants(). */
const RESTORE_FROM_COPY_CAUSES = [
  { id: 'form', label: 'From a form response',
    explain: 'The response is behind the sync clock, so the import will not bring it back on its own.' },
  { id: 'desk', label: 'Entered at the desk or the door',
    explain: 'No form stands behind these rows — nothing in the workbook can rebuild them.' },
  { id: 'club', label: 'Standing-list (club) bookings',
    explain: 'Re-derived from Club_Members for upcoming dates only. Where the membership itself is gone, ' +
      'restore it below too, or future dates will not be booked.' },
  { id: 'allDates', label: 'Every-date registrations still on file',
    explain: 'The submission is still in the every-date record; restoring puts these dates back.' },
  { id: 'recurring', label: 'Looks recurring (one submission, several dates)',
    explain: 'Restoring brings back the dates the copy has. Dates added to the program later will NOT ' +
      'be booked automatically — re-register the person if they should be.' },
  { id: 'other', label: 'No recorded cause',
    explain: 'Nothing in the workbook says why these went.' }
];

// ---------------------------------------------------------------------------
// The pure half — no Apps Script calls, so the test can drive it directly.
// ---------------------------------------------------------------------------

/**
 * Splits the copy's rows into what is offered and what is not, and why.
 *
 * `input`:
 *   copyRows, liveRows, triageRows        — All_Registrants-shaped rows (triage in its own headers)
 *   triageHeaders                          — HEADERS.Deleted_Event_Triage
 *   sessionEventIds                        — Set of Event_IDs on the live session table
 *   copyClubRows, liveClubRows             — Club_Members-shaped rows
 *   isTombstoned(eventId, name, type)      — the live tombstone store
 *   allDatesParties                        — Set of `${Party_ID}|${nameKey}` in the every-date registry
 */
function classifyCopyRegistrants(input) {
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const clubMap = getIndexMap(HEADERS.Club_Members);
  const counts = { offered: 0, present: 0, notLive: 0, deliberate: 0, triage: 0,
    clubLeft: 0, noSession: 0 };
  const noSessionSamples = [];

  const liveExact = new Set();
  const liveLoose = new Set();
  (input.liveRows || []).forEach(row => {
    liveExact.add(restoreCopyRowKey_(row, map));
    const loose = duplicateRegistrationKey(row, map);
    if (loose) liveLoose.add(loose);
  });

  const triageKeys = new Set();
  if (input.triageRows && input.triageHeaders) {
    const tMap = getIndexMap(input.triageHeaders);
    input.triageRows.forEach(row => triageKeys.add(restoreCopyRowKey_(row, tMap)));
  }

  const liveClubByKey = indexClubMemberRows(input.liveClubRows || []);
  const allDatesParties = input.allDatesParties || new Set();
  const isTombstoned = input.isTombstoned || (() => false);

  // One submission on several dates of one program is what recurring looks like.
  const partyDates = {};
  (input.copyRows || []).forEach(row => {
    const party = String(row[map['Party_ID']] || '').trim();
    if (!party) return;
    const k = `${party}|${normalizeNameKey(row[map['Name']])}|${normalizeNameKey(row[map['Event']])}`;
    partyDates[k] = (partyDates[k] || 0) + 1;
  });

  const groups = {};
  const seenLoose = new Set();
  (input.copyRows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const name = String(row[map['Name']] || '').trim();
    if (!eventId || !name) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (CANCELLATION_TERMINAL_STATUSES.indexOf(status) !== -1) { counts.notLive++; return; }

    const key = restoreCopyRowKey_(row, map);
    const loose = duplicateRegistrationKey(row, map);
    if (liveExact.has(key) || (loose && liveLoose.has(loose))) { counts.present++; return; }
    // The copy's own duplicates collapse to one offer — restoring both would
    // re-create the pair 85 exists to merge.
    const dedupe = loose || key;
    if (seenLoose.has(dedupe)) return;
    seenLoose.add(dedupe);

    const personType = String(row[map['Person_Type']] || '').trim();
    if (isTombstoned(eventId, name, personType)) { counts.deliberate++; return; }
    if (triageKeys.has(key)) { counts.triage++; return; }

    const party = String(row[map['Party_ID']] || '').trim();
    let cause = '';
    let membershipGone = false;
    if (party.indexOf('CLUB:') === 0) {
      const member = liveClubByKey[party.slice(5)];
      if (member && !isTruthyCheckbox(member[clubMap['Active']])) { counts.clubLeft++; return; }
      cause = 'club';
      membershipGone = !member;
    }

    if (!input.sessionEventIds.has(eventId) && !isLunchOnlyEventId(eventId)) {
      counts.noSession++;
      if (noSessionSamples.length < 15) {
        noSessionSamples.push(`${name} — ${row[map['Event']] || eventId} (${restoreCopyDateLabel_(row[map['Event_Date']])})`);
      }
      return;
    }

    if (!cause) {
      const nameKey = normalizeNameKey(name);
      const override = String(row[map['Manual_Override']] || '').trim();
      const source = String(row[map['Form_Source']] || '');
      if (party && allDatesParties.has(`${party}|${nameKey}`)) cause = 'allDates';
      else if (party && (partyDates[`${party}|${nameKey}|${normalizeNameKey(row[map['Event']])}`] || 0) >=
        RESTORE_FROM_COPY_RECURRING_MIN_DATES) cause = 'recurring';
      else if (override === 'Manually Added' || /front desk|walk-in|no form/i.test(source)) cause = 'desk';
      else if (/HYPERLINK|View Submission/i.test(source)) cause = 'form';
      else cause = 'other';
    }

    const program = String(row[map['Event']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    const groupId = [cause, normalizeNameKey(name), personType, normalizeNameKey(program),
      location.toLowerCase()].join('|');
    if (!groups[groupId]) {
      groups[groupId] = { id: groupId, cause, name, personType, program, location,
        membershipGone: false, dates: [], rowKeys: [], sortKey: '' };
    }
    const g = groups[groupId];
    if (membershipGone) g.membershipGone = true;
    const date = coerceDate(row[map['Event_Date']]);
    g.dates.push(`${restoreCopyDateLabel_(date)}${status && status !== 'Active' ? ` (${status})` : ''}`);
    g.rowKeys.push(key);
    const dk = date ? formatDateKey(date) : '';
    if (!g.sortKey || dk < g.sortKey) g.sortKey = dk;
    counts.offered++;
  });

  // Memberships the copy had, active, that the live tab has no row for at all.
  // A row that is there but inactive was ended on purpose and is not offered.
  const memberships = [];
  (input.copyClubRows || []).forEach(row => {
    if (!isTruthyCheckbox(row[clubMap['Active']])) return;
    const clubKey = String(row[clubMap['Club_Key']] || '').trim();
    const name = String(row[clubMap['Name']] || '').trim();
    if (!clubKey || !name) return;
    const key = clubMemberKey(clubKey, name, row[clubMap['Person_Type']]);
    if (liveClubByKey[key]) return;
    memberships.push({
      key,
      name,
      club: String(row[clubMap['Club']] || clubKey),
      location: String(row[clubMap['Location']] || ''),
      lunch: String(row[clubMap['Lunch']] || '')
    });
  });

  const order = RESTORE_FROM_COPY_CAUSES.map(c => c.id);
  const list = Object.keys(groups).map(k => groups[k]).sort((a, b) =>
    (order.indexOf(a.cause) - order.indexOf(b.cause)) ||
    a.name.localeCompare(b.name) || a.sortKey.localeCompare(b.sortKey));
  return { groups: list, memberships, counts, noSessionSamples };
}

/** The exact identity a row is matched on — the tombstone/import key (28). */
function restoreCopyRowKey_(row, map) {
  return registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
}

function restoreCopyDateLabel_(value) {
  const date = coerceDate(value);
  return date ? formatDateLabel(date) : '(no date)';
}

/**
 * The copy's row as it goes back onto the live tab. A fresh array: the copy's
 * rows are never mutated.
 */
function buildRestoredRegistrantRow(row, map, note) {
  const out = row.slice();
  const override = String(out[map['Manual_Override']] || '').trim();
  // A desk row keeps "Manually Added"; everything else is protected as edited,
  // which is what stops the next sync re-deriving it from a form response.
  if (override !== 'Manually Added') out[map['Manual_Override']] = RESTORE_FROM_COPY_OVERRIDE;
  const notes = String(out[map['Admin_Notes']] || '').trim();
  out[map['Admin_Notes']] = notes ? `${notes} | ${note}` : note;
  ['Registrant_Sheet_Link', 'Sign_In_Sheet_Link'].forEach(col => {
    if (map[col] !== undefined) out[map[col]] = '';
  });
  if (map['Event_Time'] !== undefined && /^=/.test(String(out[map['Event_Time']] || ''))) {
    out[map['Event_Time']] = '';
  }
  return out;
}

/** The copy's Club_Members row as it goes back, noted. */
function buildRestoredClubMemberRow(row, clubMap, note) {
  const out = row.slice();
  const notes = String(out[clubMap['Staff_Notes']] || '').trim();
  out[clubMap['Staff_Notes']] = notes ? `${notes} | ${note}` : note;
  return out;
}

// ---------------------------------------------------------------------------
// The Apps Script half.
// ---------------------------------------------------------------------------

/** MENU ENTRY. Opens the dialog; nothing is read until a link is pasted into it. */
function showRestoreRegistrantsFromCopyDialog() {
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const html = HtmlService.createHtmlOutput(buildRestoreFromCopyHtml())
    .setWidth(820)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Restore Registrants from a Copy');
}

/** The spreadsheet id out of a pasted link, or the id itself. */
function restoreCopySpreadsheetId_(source) {
  const text = String(source || '').trim();
  const m = text.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || text.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : '';
}

/**
 * Everything both the scan and the write need, read once. Throws a sentence a
 * person can act on.
 */
function readRestoreFromCopyInputs_(source) {
  const id = restoreCopySpreadsheetId_(source);
  if (!id) throw new Error('That does not look like a link to a Google Sheet. Paste the copy\'s address from its browser tab.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (id === ss.getId()) throw new Error('That link is THIS workbook. Paste the link to the older copy.');

  let copy;
  try {
    copy = SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error(`The copy could not be opened (${err}). Check the link, and that this account can open it.`);
  }
  const copySheet = copy.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!copySheet) {
    throw new Error(`The copy has no "${SHEET_NAMES.REGISTRANT_DASH}" tab. Its tabs are: ` +
      copy.getSheets().map(s => s.getName()).join(', '));
  }
  const headers = HEADERS.All_Registrants;
  // NOT getSectionedRows(): its memo is keyed on the tab NAME, and the copy's
  // tab has the live tab's name. The grid cache underneath checks the sheet
  // object and so cannot be fooled, but is dropped afterwards so the live
  // read below does not have to evict the copy's grid to find its own.
  const copyRows = readAllSectionedRows(copySheet, headers, 'Event_ID');
  invalidateSheetGridCache(SHEET_NAMES.REGISTRANT_DASH);

  let copyClubRows = [];
  const copyClubSheet = copy.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  if (copyClubSheet) {
    try { copyClubRows = readSimpleTable(copyClubSheet, HEADERS.Club_Members); } catch (err) {
      log(`restoreFromCopy: the copy's ${SHEET_NAMES.CLUB_MEMBERS} could not be read (${err}).`);
    }
  }

  const liveSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  const liveRows = getSectionedRows(liveSheet, headers, 'Event_ID');
  const triageSheet = ss.getSheetByName(SHEET_NAMES.TRIAGE);
  const triageRows = triageSheet
    ? getSectionedRowValues(triageSheet, HEADERS.Deleted_Event_Triage, 'Event_ID') : [];
  const sessionSheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
  const sessionEventIds = new Set((sessionSheet
    ? getSectionedRowValues(sessionSheet, HEADERS.All_Program_Sessions, 'Event_ID') : [])
    .map(row => String(row[sessionMap['Event_ID']] || '').trim()).filter(Boolean));
  const liveClubSheet = ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS);
  const liveClubRows = readClubMemberRows(liveClubSheet);

  const allDatesParties = new Set();
  const registry = getAllDatesRegistry();
  Object.keys(registry).forEach(formId => (registry[formId] || []).forEach(entry => {
    if (entry && entry.partyId) allDatesParties.add(`${entry.partyId}|${normalizeNameKey(entry.name)}`);
  }));

  return {
    ss, copy, copyRows, copyClubRows, liveSheet, liveRows, liveClubSheet, liveClubRows,
    classified: classifyCopyRegistrants({
      copyRows, liveRows, triageRows, triageHeaders: HEADERS.Deleted_Event_Triage,
      sessionEventIds, copyClubRows, liveClubRows, allDatesParties,
      isTombstoned: (eventId, name, type) => !!getRegistrantTombstone(eventId, name, type)
    })
  };
}

/** DIALOG ENDPOINT. Read-only: what the copy has that the workbook does not. */
function scanRegistrantCopy(source) {
  try {
    const inputs = readRestoreFromCopyInputs_(source);
    const c = inputs.classified;
    return {
      ok: true,
      copyName: inputs.copy.getName(),
      copyRowCount: inputs.copyRows.length,
      liveRowCount: inputs.liveRows.length,
      causes: RESTORE_FROM_COPY_CAUSES,
      groups: c.groups.map(g => ({
        id: g.id, cause: g.cause, name: g.name, personType: g.personType, program: g.program,
        location: g.location, membershipGone: g.membershipGone, dates: g.dates
      })),
      memberships: c.memberships,
      counts: c.counts,
      noSessionSamples: c.noSessionSamples
    };
  } catch (err) {
    return { ok: false, message: String(err && err.message ? err.message : err) };
  }
}

/**
 * DIALOG ENDPOINT. Puts the ticked groups and memberships back. `payload` is
 * { source, groupIds: [...], membershipKeys: [...] } — ids only, re-decided
 * here against a fresh read.
 */
function restoreRegistrantsFromCopy(payload) {
  if (isBootstrapActive()) return { ok: false, message: bootstrapBusyMessage() };
  const busy = { ok: false, message: 'A sync is running right now — try again in a moment. Nothing was restored.' };
  return withScriptLock(SYNC_LOCK_WAIT_MS, () => {
    try {
      invalidateSectionedRowsCache();
      return restoreRegistrantsFromCopyLocked_(payload || {});
    } catch (err) {
      return { ok: false, message: `Nothing was restored: ${err && err.message ? err.message : err}` };
    }
  }, busy);
}

function restoreRegistrantsFromCopyLocked_(payload) {
  const inputs = readRestoreFromCopyInputs_(payload.source);
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const wantedGroups = new Set(payload.groupIds || []);
  const wantedMembers = new Set(payload.membershipKeys || []);

  const wantedRowKeys = new Set();
  inputs.classified.groups.forEach(g => {
    if (wantedGroups.has(g.id)) g.rowKeys.forEach(k => wantedRowKeys.add(k));
  });
  const note = `Restored from the copy "${inputs.copy.getName()}" on ${formatDateLabel(new Date())}.`;

  const restored = [];
  const taken = new Set();
  inputs.copyRows.forEach(row => {
    const key = restoreCopyRowKey_(row, map);
    if (!wantedRowKeys.has(key) || taken.has(key)) return;
    taken.add(key);
    restored.push(buildRestoredRegistrantRow(row, map, note));
  });

  const clubMap = getIndexMap(HEADERS.Club_Members);
  const offeredMembers = new Set(inputs.classified.memberships.map(m => m.key));
  const restoredMembers = [];
  inputs.copyClubRows.forEach(row => {
    const key = clubMemberKey(row[clubMap['Club_Key']], row[clubMap['Name']], row[clubMap['Person_Type']]);
    if (!wantedMembers.has(key) || !offeredMembers.has(key)) return;
    offeredMembers.delete(key); // once
    restoredMembers.push(buildRestoredClubMemberRow(row, clubMap, note));
  });

  if (restored.length === 0 && restoredMembers.length === 0) {
    return { ok: true, message: 'Nothing to restore — everything ticked is already back, or was not offered.' };
  }

  if (restoredMembers.length > 0) {
    renderClubMembersSheet(inputs.liveClubRows.concat(restoredMembers));
  }

  let countsNote = '';
  if (restored.length > 0) {
    const all = inputs.liveRows.concat(restored);
    renderRegistrantsSheet(false, all);
    try {
      const registrySheet = inputs.ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
      if (registrySheet) recomputeEventRegistryCounts(registrySheet, inputs.liveSheet, all);
      updateMasterLunchDashboard(all);
    } catch (err) {
      countsNote = ` The counts could not be recalculated (${err}) — run Update Everything Now.`;
    }
  }

  const message = `Restored ${restored.length} registration row(s)` +
    (restoredMembers.length ? ` and ${restoredMembers.length} standing-list membership(s)` : '') +
    ` from "${inputs.copy.getName()}".${countsNote}`;
  log(`restoreRegistrantsFromCopy: ${message}`);
  try { noteForAdmin('Registrants restored from a copy', message); } catch (err) { /* the digest is a courtesy */ }
  return { ok: true, message };
}

/**
 * The dialog. No workbook data is inlined — everything arrives through
 * google.script.run and is written with textContent, so a name or a program
 * title can never become markup.
 */
function buildRestoreFromCopyHtml() {
  return `<!DOCTYPE html>
<html><head><base target="_top">
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 14px 0 4px; font-size: 14px; }
  p.hint { color: #555; margin: 2px 0 8px; line-height: 1.4; }
  input[type=text] { width: 100%; box-sizing: border-box; padding: 6px; font-size: 13px; }
  button { padding: 6px 14px; margin: 8px 8px 0 0; font-size: 13px; cursor: pointer; }
  .summary { background: #f4f4f4; padding: 8px 10px; border-radius: 4px; margin: 10px 0; line-height: 1.5; }
  .row { display: block; padding: 4px 0; border-bottom: 1px solid #eee; }
  .dates { color: #555; font-size: 12px; margin-left: 22px; }
  .warn { color: #a15c00; font-size: 12px; margin-left: 22px; }
  .msg { margin-top: 10px; font-weight: bold; }
  .err { color: #b00020; }
</style></head>
<body>
  <p class="hint">Paste the link to the older copy of this workbook (made from File → Version history → Make a copy).
  Nothing is changed until you press Restore.</p>
  <input type="text" id="src" placeholder="https://docs.google.com/spreadsheets/d/…">
  <button id="scan">Compare with this workbook</button>
  <div id="out"></div>
  <div id="msg" class="msg"></div>
<script>
  var SRC = '';
  var el = function (tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  var msg = function (text, bad) { var m = document.getElementById('msg'); m.textContent = text; m.className = 'msg' + (bad ? ' err' : ''); };

  document.getElementById('scan').onclick = function () {
    SRC = document.getElementById('src').value;
    document.getElementById('out').textContent = '';
    msg('Reading both spreadsheets…');
    google.script.run.withSuccessHandler(draw).withFailureHandler(function (e) { msg(String(e && e.message || e), true); })
      .scanRegistrantCopy(SRC);
  };

  function draw(r) {
    var out = document.getElementById('out');
    out.textContent = '';
    if (!r || !r.ok) { msg((r && r.message) || 'The scan came back empty.', true); return; }
    msg('');
    var c = r.counts;
    var s = el('div', '', 'summary');
    [
      '"' + r.copyName + '" has ' + r.copyRowCount + ' registrant rows; this workbook has ' + r.liveRowCount + '.',
      c.offered + ' row(s) are missing with nothing on record saying they were removed on purpose — listed below.',
      'Not listed: ' + c.present + ' still here (any spelling, any status) · ' + c.notLive + ' already cancelled/superseded in the copy · ' +
        c.deliberate + ' deleted on purpose · ' + c.triage + ' on Deleted_Event_Triage · ' + c.clubLeft + ' from a standing list the person has left · ' +
        c.noSession + ' whose session is no longer in the workbook.'
    ].forEach(function (line) { s.appendChild(el('div', line)); });
    if (r.noSessionSamples.length) s.appendChild(el('div', 'Session gone (cannot be restored): ' + r.noSessionSamples.join('; ') + (c.noSession > r.noSessionSamples.length ? '; …' : '')));
    out.appendChild(s);

    r.causes.forEach(function (cause) {
      var gs = r.groups.filter(function (g) { return g.cause === cause.id; });
      if (!gs.length) return;
      var h = el('h3', cause.label + ' (' + gs.length + ')');
      var all = document.createElement('input'); all.type = 'checkbox'; all.checked = true;
      h.insertBefore(all, h.firstChild);
      out.appendChild(h);
      out.appendChild(el('p', cause.explain, 'hint'));
      var boxes = [];
      gs.forEach(function (g) {
        var row = el('label', '', 'row');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.name = 'group'; cb.value = g.id;
        boxes.push(cb);
        row.appendChild(cb);
        row.appendChild(el('b', ' ' + g.name));
        row.appendChild(document.createTextNode((g.personType && g.personType !== 'Attendee' ? ' (' + g.personType + ')' : '') +
          ' — ' + g.program + (g.location ? ' @ ' + g.location : '') + ' · ' + g.dates.length + ' date' + (g.dates.length === 1 ? '' : 's')));
        row.appendChild(el('div', g.dates.join(', '), 'dates'));
        if (g.membershipGone) row.appendChild(el('div', 'Their standing-list membership is gone too — see below.', 'warn'));
        out.appendChild(row);
      });
      all.onchange = function () { boxes.forEach(function (b) { b.checked = all.checked; }); };
    });

    if (r.memberships.length) {
      out.appendChild(el('h3', 'Standing-list memberships to put back (' + r.memberships.length + ')'));
      out.appendChild(el('p', 'Active in the copy, and not on Club_Members at all now. Restored as they were; the next sync then books their upcoming dates.', 'hint'));
      r.memberships.forEach(function (m) {
        var row = el('label', '', 'row');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.name = 'member'; cb.value = m.key;
        row.appendChild(cb);
        row.appendChild(el('b', ' ' + m.name));
        row.appendChild(document.createTextNode(' — ' + m.club + (m.location ? ' @ ' + m.location : '') + (m.lunch ? ' · ' + m.lunch : '')));
        out.appendChild(row);
      });
    }

    if (!r.groups.length && !r.memberships.length) { out.appendChild(el('p', 'Nothing to restore.', 'hint')); return; }
    var go = el('button', 'Restore ticked');
    go.onclick = function () {
      var pick = function (name) { return Array.prototype.slice.call(document.querySelectorAll('input[name=' + name + ']:checked')).map(function (b) { return b.value; }); };
      var groupIds = pick('group'), membershipKeys = pick('member');
      if (!groupIds.length && !membershipKeys.length) { msg('Nothing is ticked.', true); return; }
      if (!confirm('Restore ' + groupIds.length + ' person/program line(s) and ' + membershipKeys.length + ' membership(s)?')) return;
      go.disabled = true;
      msg('Restoring…');
      google.script.run.withSuccessHandler(function (res) {
        msg(res && res.message || 'Done.', !(res && res.ok));
        if (res && res.ok) google.script.run.withSuccessHandler(draw).scanRegistrantCopy(SRC);
        else go.disabled = false;
      }).withFailureHandler(function (e) { msg(String(e && e.message || e), true); go.disabled = false; })
        .restoreRegistrantsFromCopy({ source: SRC, groupIds: groupIds, membershipKeys: membershipKeys });
    };
    out.appendChild(go);
    var close = el('button', 'Close'); close.onclick = function () { google.script.host.close(); };
    out.appendChild(close);
  }
</script>
</body></html>`;
}
