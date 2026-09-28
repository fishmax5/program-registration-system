// ============================================================================
// 99v. RESTORE REGISTRANTS FROM THE LEDGER
// ============================================================================
//
// THE SECOND COPY, USED. Since phase 2 every writer appends to
// Registration_Ledger (99k) before it touches All_Registrants, and the verifier
// (99n) has been able to NAME a registration the ledger holds and the tab does
// not. What it could not do is put it back — that took a copy of the workbook
// made from version history, read through 99p, which only works if somebody
// can say to the minute when the tab was last right.
//
// Found on 2026-09-28: every Personalized Assistance registrant (and ~150
// others across the programs) gone from the tab after a rewrite on Sep 25,
// with NO removal, cancellation or supersede entry in the ledger — the ledger
// still folded every one of them as live. The every-date and club rows were
// rebuilt by the next sync on their own; the rest (restored rows, desk and door
// rows, appointment bookings behind the sync clock) have nothing that rebuilds
// them, which is why appointment programs were emptied outright.
//
// So this reads the FOLD instead of a copy. The fold is already the answer
// phase 4 will render from; here it is only consulted, and only ADDS: a
// registration the fold says is live, on a session still in the workbook, that
// the tab has no row for under any status — matched on registrantTombstoneKey
// (28), the key the verifier and the fold's own index use. Nothing on the tab
// is changed or removed.
//
// WHAT IS NEVER OFFERED, only counted: a registration whose session is no
// longer on the session table (it would be a row for nothing), one the
// tombstones say was deleted on purpose, and one sitting on Deleted_Event_Triage
// (it has somewhere to be already).
//
// NO LEDGER ENTRY IS APPENDED. Every row put back is one the ledger already
// holds, under the Registration_ID it already has — which is what makes the
// verifier agree afterwards rather than reporting a second registration. A
// restored row carries Manual_Override (so the next sync does not re-derive it
// from a form response and quietly change it) and an Admin_Notes stamp.
//
// Pure half first (classifyLedgerRestore, driven by the test), then the dialog.
// ============================================================================

const RESTORE_FROM_LEDGER_OVERRIDE = 'Manually Edited';

/**
 * `input`:
 *   foldRows          — foldRegistrationLedger().rows (All_Registrants order)
 *   liveRows          — the tab's rows
 *   sessionEventIds   — Set of Event_IDs on the session table
 *   triageKeys        — Set of registrantTombstoneKey()s on Deleted_Event_Triage
 *   isTombstoned(eventId, name, personType)
 *
 * Returns { groups, counts } — a group is one program at one building, holding
 * the fold rows to restore.
 */
function classifyLedgerRestore(input) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const keyOf = row => registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);
  const onTab = new Set();
  (input.liveRows || []).forEach(row => { const k = keyOf(row); if (k) onTab.add(k); });

  const counts = { present: 0, noSession: 0, deliberate: 0, triage: 0, offered: 0 };
  const groups = {};
  const seen = new Set();
  (input.foldRows || []).forEach(row => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (onTab.has(key)) { counts.present++; return; }
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!input.sessionEventIds || !input.sessionEventIds.has(eventId)) { counts.noSession++; return; }
    if (input.triageKeys && input.triageKeys.has(key)) { counts.triage++; return; }
    if (input.isTombstoned && input.isTombstoned(eventId, row[map['Name']], row[map['Person_Type']])) {
      counts.deliberate++;
      return;
    }
    const program = String(row[map['Event']] || '').trim() || '(untitled session)';
    const location = String(row[map['Location']] || '').trim();
    const gid = `${normalizeNameKey(program)}|${normalizeNameKey(location)}`;
    if (!groups[gid]) groups[gid] = { id: gid, program, location, rows: [] };
    groups[gid].rows.push(row);
    counts.offered++;
  });

  const list = Object.keys(groups).map(k => groups[k]);
  list.forEach(g => g.rows.sort((a, b) =>
    ledgerRestoreDateKey_(a[map['Event_Date']]).localeCompare(ledgerRestoreDateKey_(b[map['Event_Date']])) ||
    String(a[map['Name']]).localeCompare(String(b[map['Name']]))));
  list.sort((a, b) => a.program.localeCompare(b.program) || a.location.localeCompare(b.location));
  return { groups: list, counts };
}

/** A fold row's date is a 'yyyy-MM-dd' string; a tab row's is a Date. Either as a key. */
function ledgerRestoreDateKey_(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
  const date = coerceDate(value);
  return date ? formatDateKey(date) : '';
}

/**
 * The fold's row as it goes onto the tab. A fresh array. The date goes back as
 * a local Date (the fold holds the Payload's string, and `new Date('2026-09-16')`
 * is the evening before in TIMEZONE); the Registration_ID is KEPT.
 */
function buildLedgerRestoredRow(row, map, note) {
  const out = row.slice();
  const dateKey = ledgerRestoreDateKey_(out[map['Event_Date']]);
  if (dateKey) out[map['Event_Date']] = parseDateKey(dateKey);
  const override = String(out[map['Manual_Override']] || '').trim();
  if (override !== 'Manually Added') out[map['Manual_Override']] = RESTORE_FROM_LEDGER_OVERRIDE;
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

// ---------------------------------------------------------------------------
// The Apps Script half.
// ---------------------------------------------------------------------------

/** MENU ENTRY. */
function showRestoreRegistrantsFromLedgerDialog() {
  if (isBootstrapActive()) {
    explainRefusal(bootstrapBusyMessage());
    return;
  }
  const html = HtmlService.createHtmlOutput(buildRestoreFromLedgerHtml())
    .setWidth(820)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Restore Registrants from the Ledger');
}

function readRestoreFromLedgerInputs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const folded = foldRegistrationLedger(readLedgerEntries());

  const liveSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  const liveRows = getSectionedRows(liveSheet, headers, 'Event_ID');

  const sessionSheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
  const sessionEventIds = new Set((sessionSheet
    ? getSectionedRowValues(sessionSheet, HEADERS.All_Program_Sessions, 'Event_ID') : [])
    .map(row => String(row[sessionMap['Event_ID']] || '').trim()).filter(Boolean));

  const triageKeys = new Set();
  const triageSheet = ss.getSheetByName(SHEET_NAMES.TRIAGE);
  if (triageSheet) {
    const tMap = getIndexMap(HEADERS.Deleted_Event_Triage);
    getSectionedRowValues(triageSheet, HEADERS.Deleted_Event_Triage, 'Event_ID').forEach(row => {
      const k = registrantTombstoneKey(row[tMap['Event_ID']], row[tMap['Name']], row[tMap['Person_Type']]);
      if (k) triageKeys.add(k);
    });
  }

  return {
    ss, map, liveSheet, liveRows, folded,
    classified: classifyLedgerRestore({
      foldRows: folded.rows, liveRows, sessionEventIds, triageKeys,
      isTombstoned: (eventId, name, type) => !!getRegistrantTombstone(eventId, name, type)
    })
  };
}

/** DIALOG ENDPOINT. Read-only. */
function scanLedgerForMissingRegistrants() {
  try {
    const inputs = readRestoreFromLedgerInputs_();
    const map = inputs.map;
    return {
      ok: true,
      liveRowCount: inputs.liveRows.length,
      foldRowCount: inputs.folded.rows.length,
      counts: inputs.classified.counts,
      groups: inputs.classified.groups.map(g => ({
        id: g.id, program: g.program, location: g.location,
        people: g.rows.map(row => ({
          id: String(row[map['Registration_ID']] || ''),
          name: String(row[map['Name']] || ''),
          personType: String(row[map['Person_Type']] || ''),
          status: String(row[map['Program_Status']] || ''),
          date: (() => { const k = ledgerRestoreDateKey_(row[map['Event_Date']]); return k ? formatDateLabel(parseDateKey(k)) : '(no date)'; })()
        }))
      }))
    };
  } catch (err) {
    return { ok: false, message: String(err && err.message ? err.message : err) };
  }
}

/**
 * DIALOG ENDPOINT. `payload.registrationIds` — ids only, re-decided here
 * against a fresh read under the workbook lock, so a row put back by the sync
 * or another person since the scan is not put back twice.
 */
function restoreRegistrantsFromLedger(payload) {
  if (isBootstrapActive()) return { ok: false, message: bootstrapBusyMessage() };
  const busy = { ok: false, message: 'A sync is running right now — try again in a moment. Nothing was restored.' };
  return withScriptLock(SYNC_LOCK_WAIT_MS, () => {
    try {
      invalidateSectionedRowsCache();
      invalidateLedgerFold();
      return restoreRegistrantsFromLedgerLocked_(payload || {});
    } catch (err) {
      return { ok: false, message: `Nothing was restored: ${err && err.message ? err.message : err}` };
    }
  }, busy);
}

function restoreRegistrantsFromLedgerLocked_(payload) {
  const wanted = new Set((payload.registrationIds || []).map(String));
  if (wanted.size === 0) return { ok: true, message: 'Nothing was ticked.' };
  const inputs = readRestoreFromLedgerInputs_();
  const map = inputs.map;
  const note = `Restored from ${SHEET_NAMES.REGISTRATION_LEDGER} on ${formatDateLabel(new Date())}.`;

  const restored = [];
  inputs.classified.groups.forEach(g => g.rows.forEach(row => {
    if (wanted.has(String(row[map['Registration_ID']] || ''))) restored.push(buildLedgerRestoredRow(row, map, note));
  }));
  if (restored.length === 0) {
    return { ok: true, message: 'Nothing to restore — everything ticked is already back on the tab.' };
  }

  const all = inputs.liveRows.concat(restored);
  renderRegistrantsSheet(false, all);
  let countsNote = '';
  try {
    const registrySheet = inputs.ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, inputs.liveSheet, all);
    updateMasterLunchDashboard(all);
  } catch (err) {
    countsNote = ` The counts could not be recalculated (${err}) — run Update Everything Now.`;
  }

  const message = `Restored ${restored.length} registration row(s) from ${SHEET_NAMES.REGISTRATION_LEDGER}.${countsNote}`;
  log(`restoreRegistrantsFromLedger: ${message}`);
  try { noteForAdmin('Registrants restored from the ledger', message); } catch (err) { /* a courtesy */ }
  return { ok: true, message };
}

/** The dialog. No workbook data inlined; everything written with textContent. */
function buildRestoreFromLedgerHtml() {
  return `<!DOCTYPE html>
<html><head><base target="_top">
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 14px 0 4px; font-size: 14px; }
  p.hint { color: #555; margin: 2px 0 8px; line-height: 1.4; }
  button { padding: 6px 14px; margin: 8px 8px 0 0; font-size: 13px; cursor: pointer; }
  .summary { background: #f4f4f4; padding: 8px 10px; border-radius: 4px; margin: 10px 0; line-height: 1.5; }
  .row { display: block; padding: 3px 0 3px 22px; border-bottom: 1px solid #f0f0f0; }
  .status { color: #a15c00; font-size: 12px; }
  .msg { margin-top: 10px; font-weight: bold; }
  .err { color: #b00020; }
</style></head>
<body>
  <p class="hint">Registrations the ledger says are still live, on sessions still in the workbook, that have no row on
  ${SHEET_NAMES.REGISTRANT_DASH}. Nothing on the tab is changed or removed — ticked rows are only added back.</p>
  <div id="out"></div>
  <div id="msg" class="msg">Reading the ledger…</div>
<script>
  var el = function (tag, text, cls) { var e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  var msg = function (text, bad) { var m = document.getElementById('msg'); m.textContent = text; m.className = 'msg' + (bad ? ' err' : ''); };
  function scan() {
    google.script.run.withSuccessHandler(draw).withFailureHandler(function (e) { msg(String(e && e.message || e), true); })
      .scanLedgerForMissingRegistrants();
  }
  function draw(r) {
    var out = document.getElementById('out');
    out.textContent = '';
    if (!r || !r.ok) { msg((r && r.message) || 'The scan came back empty.', true); return; }
    msg('');
    var c = r.counts;
    var s = el('div', '', 'summary');
    [
      'The ledger folds to ' + r.foldRowCount + ' registrations; the tab holds ' + r.liveRowCount + ' rows.',
      c.offered + ' registration(s) are missing from the tab — listed below.',
      'Not listed: ' + c.present + ' already on the tab · ' + c.noSession + ' whose session is no longer in the workbook · ' +
        c.deliberate + ' deleted on purpose · ' + c.triage + ' on Deleted_Event_Triage.'
    ].forEach(function (line) { s.appendChild(el('div', line)); });
    out.appendChild(s);
    if (!r.groups.length) { out.appendChild(el('p', 'Nothing to restore.', 'hint')); return; }

    r.groups.forEach(function (g) {
      var h = el('h3', ' ' + g.program + (g.location ? ' @ ' + g.location : '') + ' (' + g.people.length + ')');
      var all = document.createElement('input'); all.type = 'checkbox'; all.checked = true;
      h.insertBefore(all, h.firstChild);
      out.appendChild(h);
      var boxes = [];
      g.people.forEach(function (p) {
        var row = el('label', '', 'row');
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.name = 'reg'; cb.value = p.id;
        boxes.push(cb);
        row.appendChild(cb);
        row.appendChild(el('b', ' ' + p.name));
        row.appendChild(document.createTextNode((p.personType && p.personType !== 'Attendee' ? ' (' + p.personType + ')' : '') + ' — ' + p.date + ' '));
        if (p.status && p.status !== 'Active') row.appendChild(el('span', p.status, 'status'));
        out.appendChild(row);
      });
      all.onchange = function () { boxes.forEach(function (b) { b.checked = all.checked; }); };
    });

    var go = el('button', 'Restore ticked');
    go.onclick = function () {
      var ids = Array.prototype.slice.call(document.querySelectorAll('input[name=reg]:checked')).map(function (b) { return b.value; });
      if (!ids.length) { msg('Nothing is ticked.', true); return; }
      if (!confirm('Put ' + ids.length + ' registration(s) back on the tab?')) return;
      go.disabled = true;
      msg('Restoring…');
      google.script.run.withSuccessHandler(function (res) {
        msg(res && res.message || 'Done.', !(res && res.ok));
        if (res && res.ok) scan(); else go.disabled = false;
      }).withFailureHandler(function (e) { msg(String(e && e.message || e), true); go.disabled = false; })
        .restoreRegistrantsFromLedger({ registrationIds: ids });
    };
    out.appendChild(go);
    var close = el('button', 'Close'); close.onclick = function () { google.script.host.close(); };
    out.appendChild(close);
  }
  scan();
</script>
</body></html>`;
}
