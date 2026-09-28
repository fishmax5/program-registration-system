// =============================================================================
// REVIEW AND EDIT REGISTRATIONS, PROGRAM BY PROGRAM (section 99v)
// =============================================================================
//
// One screen for "show me everybody on this program and let me fix it": pick
// one or MORE programs (a [Grouped] series, a Regular month, a club — anything
// with a form), see every registrant row on every session of them, GUESTS
// INCLUDED, edit the cells a person actually corrects, and tick rows to remove.
//
// WHY GUESTS ARE THE POINT. A form whose "Guest 3 Name" question ended up in
// the wrong section makes every solo registrant type a name to get past it —
// and the import then files that name as a guest who does not exist: a seat
// against the capacity and a line on the door list. Those ghost rows are
// only reachable on the Registrants tab one at a time, or through Quick Mark
// one person at a time. Here they are listed under the person who "brought"
// them and removed in one pass.
//
// THE WRITES ARE THE ONES THIS PROJECT ALREADY MAKES, in the same order:
//   • A removal is 99a's removal — tombstone FIRST (without it the next sync
//     re-imports the row from its form response), a `removed` ledger entry,
//     then the render. Removing a guest also takes one off the primary's
//     Party_Size, so the headcount the leader sees agrees with the rows.
//   • An edit marks Manual_Override 'Manually Edited', which is what stops the
//     hourly import re-deriving the row from its response and undoing it
//     (getProtectedRegistrantKeys, 28) — plus a `corrected` ledger entry.
//   • A NAME edit changes the row's import key, so the old key is tombstoned
//     first; otherwise the response would bring the old spelling back beside
//     the corrected one.
//
// ROWS ARE MATCHED BACK BY THE KEY THEY WERE LOADED UNDER (Event_ID | name |
// Person_Type | Party_ID) and the whole batch is re-read under the lock, so a
// sync that moved things between loading and saving costs a named "could not
// find" rather than an edit landing on the wrong person.
//
// Gated as 'Edit Registrations': it deletes rows. Behavior only; everything it
// reaches for is a hoisted function, read at CALL time.
// =============================================================================

/** The cells the review lets somebody type into. Everything else is read-only here. */
const REGISTRATION_REVIEW_EDITABLE = ['Name', 'Phone', 'Email', 'Meals_Ordered', 'Party_Size', 'Admin_Notes'];

/** Menu entry. */
function showRegistrationReviewDialog() {
  if (!requireAuthorizedAdmin('Edit Registrations')) return;
  if (isBootstrapActive()) {
    explainRefusal(bootstrapBusyMessage());
    return;
  }
  const programs = listRegistrationReviewPrograms();
  if (programs.length === 0) {
    explainRefusal('There are no programs with a form and registrants on them yet.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildRegistrationReviewHtml(programs))
    .setWidth(1100).setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Review & Edit Registrations');
}

/** Stable identity of a registrant row, as loaded. */
function registrationReviewRowKey(row, map) {
  return [row[map['Event_ID']], normalizeNameKey(row[map['Name']]),
    row[map['Person_Type']], map['Party_ID'] === undefined ? '' : row[map['Party_ID']]]
    .map(v => String(v === undefined || v === null ? '' : v).trim()).join('|');
}

/** Event_ID -> Form_ID, and one summary per form, off the session table. */
function readRegistrationReviewSessions_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const rows = sheet ? getSectionedRows(sheet, headers, 'Event_ID') : [];
  const formOfEvent = {};
  const forms = {};
  rows.forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!formId || !eventId) return;
    formOfEvent[eventId] = formId;
    const f = forms[formId] || (forms[formId] = {
      formId, titles: new Set(), locations: new Set(), type: '', first: null, last: null, sessions: 0
    });
    f.titles.add(String(row[map['Clean_Title']] || '').trim());
    f.locations.add(String(row[map['Location']] || '').trim());
    if (!f.type) f.type = String(row[map['Type_Tag']] || '').trim();
    const d = coerceDate(row[map['Event_Date']]);
    if (d) {
      if (!f.first || d < f.first) f.first = d;
      if (!f.last || d > f.last) f.last = d;
    }
    f.sessions++;
  });
  return { formOfEvent, forms };
}

/** Every form with at least one registrant row, most recent first. */
function listRegistrationReviewPrograms() {
  const { formOfEvent, forms } = readRegistrationReviewSessions_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const counts = {};
  (sheet ? getSectionedRows(sheet, headers, 'Event_ID') : []).forEach(row => {
    const formId = formOfEvent[String(row[map['Event_ID']] || '').trim()];
    if (!formId) return;
    const c = counts[formId] || (counts[formId] = { people: 0, guests: 0 });
    if (String(row[map['Person_Type']] || '').trim().toLowerCase() === 'guest') c.guests++;
    else c.people++;
  });
  const fmt = d => d ? Utilities.formatDate(d, TIMEZONE, 'MMM d, yyyy') : '?';
  return Object.keys(counts).map(formId => {
    const f = forms[formId];
    return {
      formId,
      title: Array.from(f.titles).filter(Boolean).join(' / ') || '(untitled)',
      location: Array.from(f.locations).filter(Boolean).join(' + '),
      type: f.type,
      span: f.first && f.last && f.first.getTime() !== f.last.getTime()
        ? `${fmt(f.first)} – ${fmt(f.last)}` : fmt(f.first),
      sessions: f.sessions,
      people: counts[formId].people,
      guests: counts[formId].guests,
      lastTime: f.last ? f.last.getTime() : 0
    };
  }).sort((a, b) => b.lastTime - a.lastTime || a.title.localeCompare(b.title));
}

/** The registrant rows of the chosen forms, as plain objects the page can draw. */
function loadRegistrationReviewRows(formIds) {
  const wanted = new Set((formIds || []).map(String));
  const { formOfEvent } = readRegistrationReviewSessions_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const text = v => v instanceof Date ? Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd')
    : String(v === undefined || v === null ? '' : v);
  return (sheet ? getSectionedRows(sheet, headers, 'Event_ID') : [])
    .filter(row => wanted.has(formOfEvent[String(row[map['Event_ID']] || '').trim()]))
    .map(row => {
      const out = { key: registrationReviewRowKey(row, map) };
      ['Event_Date', 'Event', 'Location', 'Person_Type', 'Primary_Registrant', 'Program_Status',
        'Party_ID', 'Manual_Override'].concat(REGISTRATION_REVIEW_EDITABLE)
        .forEach(h => { out[h] = map[h] === undefined ? '' : text(row[map[h]]); });
      return out;
    })
    .sort((a, b) => a.Event_Date.localeCompare(b.Event_Date) ||
      a.Party_ID.localeCompare(b.Party_ID) ||
      (a.Person_Type.toLowerCase() === 'guest') - (b.Person_Type.toLowerCase() === 'guest') ||
      a.Name.localeCompare(b.Name));
}

/**
 * Saves the page's changes: { edits: [{ key, fields: {col: value} }], removes: [key] }.
 */
function applyRegistrationReviewChanges(payload) {
  if (!requireAuthorizedAdmin('Edit Registrations')) {
    return { ok: false, message: 'Only an admin can edit registrations here.' };
  }
  return withScriptLock(DESK_LOCK_WAIT_MS, () => applyRegistrationReviewChangesLocked_(payload), {
    ok: false, message: '⏳ The workbook is mid-update — nothing was changed. Try Save again in a moment.'
  });
}

function applyRegistrationReviewChangesLocked_(payload) {
  payload = payload || {};
  const edits = Array.isArray(payload.edits) ? payload.edits : [];
  const removeKeys = new Set(Array.isArray(payload.removes) ? payload.removes.map(String) : []);
  if (edits.length === 0 && removeKeys.size === 0) return { ok: true, message: 'Nothing to save.' };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return { ok: false, message: '⚠️ There is no registrants tab.' };
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');
  const byKey = {};
  rows.forEach(row => { byKey[registrationReviewRowKey(row, map)] = row; });
  const missing = [];

  // --- removals ---------------------------------------------------------
  const doomed = [];
  removeKeys.forEach(key => { if (byKey[key]) doomed.push(byKey[key]); else missing.push(key); });
  if (doomed.length) {
    recordRegistrantTombstones(doomed, map);
    doomed.forEach(row => {
      appendLedgerEntry(makeLedgerEntry({
        kind: LEDGER_KINDS.REMOVED,
        source: LEDGER_SOURCES.CHANGE_PANEL,
        registrationId: ledgerIdForRegistrantRow(row, map),
        eventId: row[map['Event_ID']],
        name: row[map['Name']],
        personType: row[map['Person_Type']],
        partyId: map['Party_ID'] === undefined ? '' : row[map['Party_ID']],
        note: 'Removed in Review & Edit Registrations. The form response was left in place.'
      }));
    });
    // A removed guest is one fewer in their party.
    doomed.filter(r => String(r[map['Person_Type']] || '').trim().toLowerCase() === 'guest').forEach(guest => {
      const party = String(guest[map['Party_ID']] || '').trim();
      const eventId = String(guest[map['Event_ID']] || '').trim();
      if (!party) return;
      rows.forEach(row => {
        if (doomed.indexOf(row) !== -1) return;
        if (String(row[map['Party_ID']] || '').trim() !== party) return;
        if (String(row[map['Event_ID']] || '').trim() !== eventId) return;
        const size = Number(row[map['Party_Size']]);
        if (isFinite(size) && size > 1) row[map['Party_Size']] = size - 1;
      });
    });
  }

  // --- edits ------------------------------------------------------------
  let edited = 0;
  edits.forEach(edit => {
    const row = byKey[String(edit && edit.key)];
    if (!row) { missing.push(String(edit && edit.key)); return; }
    if (doomed.indexOf(row) !== -1) return;
    const fields = (edit && edit.fields) || {};
    const payloadOut = {};
    const newName = fields.Name !== undefined ? String(fields.Name).trim() : null;
    if (newName !== null && !newName) return; // a blank name is not an edit — remove the row instead
    if (newName !== null && normalizeNameKey(newName) !== normalizeNameKey(row[map['Name']])) {
      // The old spelling's import key must not come back from its response.
      recordRegistrantTombstones([row.slice()], map);
    }
    REGISTRATION_REVIEW_EDITABLE.forEach(h => {
      if (fields[h] === undefined || map[h] === undefined) return;
      let v = String(fields[h]).trim();
      if ((h === 'Meals_Ordered' || h === 'Party_Size') && v !== '') {
        const n = Number(v);
        if (!isFinite(n) || n < 0) return;
        v = n;
      }
      if (String(row[map[h]]) === String(v)) return;
      row[map[h]] = v;
      payloadOut[h] = ledgerCellValue_(v);
    });
    if (!Object.keys(payloadOut).length) return;
    row[map['Manual_Override']] = 'Manually Edited';
    payloadOut.Manual_Override = 'Manually Edited';
    const entry = ledgerEntryForCorrection_(row, map, payloadOut,
      { source: LEDGER_SOURCES.CHANGE_PANEL, note: 'Edited in Review & Edit Registrations.' });
    if (entry) appendLedgerEntry(entry);
    edited++;
  });

  const kept = rows.filter(row => doomed.indexOf(row) === -1);
  const parts = [];
  if (edited) parts.push(`${edited} row(s) edited`);
  if (doomed.length) parts.push(`${doomed.length} row(s) removed`);
  if (missing.length) parts.push(`${missing.length} row(s) had changed since loading and were skipped — reload and try again`);
  if (!edited && !doomed.length) {
    return { ok: false, message: `⚠️ Nothing was saved. ${parts.join('; ')}` };
  }
  return finishRegistrantChange(ss, sheet, kept, `✅ ${parts.join('; ')}.`);
}

/** The page. Data crosses in as a JSON string and is drawn with textContent only. */
function buildRegistrationReviewHtml(programs) {
  const data = JSON.stringify(JSON.stringify({ programs, editable: REGISTRATION_REVIEW_EDITABLE }))
    .replace(/</g, '\\u003c');
  return `<!doctype html><html><head><base target="_top"><style>
  body{font:13px Arial,sans-serif;margin:8px;color:#222}
  #progs{max-height:170px;overflow:auto;border:1px solid #ccc;padding:4px}
  #progs label{display:block;padding:2px 0}
  .muted{color:#777} .bar{margin:8px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #ddd;padding:2px 4px;vertical-align:top}
  th{background:#f3f3f3;position:sticky;top:0} #wrap{max-height:420px;overflow:auto}
  tr.guest td{background:#fff8e6} tr.guest td.nm{padding-left:18px}
  tr.gone td{text-decoration:line-through;opacity:.5} tr.dirty td{background:#e8f4ff}
  input.cell{width:100%;box-sizing:border-box;border:1px solid transparent;font:inherit;background:transparent}
  input.cell:focus{border-color:#4a90e2;background:#fff} input.num{width:48px}
  button{padding:5px 12px} #msg{font-weight:bold}
  </style></head><body>
  <div class="bar"><b>Programs</b> <input id="filter" placeholder="Filter programs…">
    <button id="load">Load registrations</button></div>
  <div id="progs"></div>
  <div class="bar"><label><input type="checkbox" id="guestsOnly"> Guests only</label>
    <label><input type="checkbox" id="ghosts"> Tick guests with a blank or one-word name</label>
    <span id="count" class="muted"></span></div>
  <div id="wrap"><table><thead><tr id="head"></tr></thead><tbody id="body"></tbody></table></div>
  <div class="bar"><button id="save">Save changes</button><button id="close">Close</button><span id="msg"></span></div>
<script>
  const DATA = JSON.parse(${data});
  const EDIT = DATA.editable;
  let ROWS = [];
  const $ = id => document.getElementById(id);
  function el(tag, text, cls){ const e=document.createElement(tag); if(text!=null) e.textContent=text; if(cls) e.className=cls; return e; }
  function drawPrograms(){
    const f=$('filter').value.toLowerCase(); const box=$('progs');
    const ticked=new Set(Array.from(box.querySelectorAll('input:checked')).map(i=>i.value));
    box.textContent='';
    DATA.programs.forEach(p=>{
      const line=[p.title,p.location,p.type,p.span].filter(Boolean).join(' · ');
      if(f && line.toLowerCase().indexOf(f)===-1) return;
      const l=el('label'); const cb=el('input'); cb.type='checkbox'; cb.value=p.formId; cb.checked=ticked.has(p.formId);
      l.appendChild(cb); l.appendChild(document.createTextNode(' '+line+' '));
      l.appendChild(el('span','('+p.sessions+' dates, '+p.people+' registrants, '+p.guests+' guests)','muted'));
      box.appendChild(l);
    });
  }
  const COLS=['Remove','Event_Date','Event','Location','Person_Type','Name','Primary_Registrant','Program_Status'].concat(EDIT.filter(h=>h!=='Name'));
  function drawHead(){ const h=$('head'); h.textContent=''; COLS.forEach(c=>h.appendChild(el('th',c.replace(/_/g,' ')))); }
  function isGuest(r){ return String(r.Person_Type).toLowerCase()==='guest'; }
  function drawRows(){
    const b=$('body'); b.textContent=''; const only=$('guestsOnly').checked; let n=0;
    ROWS.forEach(r=>{
      if(only && !isGuest(r)) return; n++;
      const tr=el('tr'); tr.className=(isGuest(r)?'guest ':'')+(r._remove?'gone ':'')+(r._dirty?'dirty':'');
      COLS.forEach(c=>{
        const td=el('td'); if(c==='Name') td.className='nm';
        if(c==='Remove'){ const cb=el('input'); cb.type='checkbox'; cb.checked=!!r._remove;
          cb.onchange=()=>{ r._remove=cb.checked; tr.classList.toggle('gone',cb.checked); }; td.appendChild(cb); }
        else if(EDIT.indexOf(c)!==-1){ const i=el('input'); i.className='cell'+((c==='Meals_Ordered'||c==='Party_Size')?' num':'');
          i.value=r[c]; i.oninput=()=>{ r._edits=r._edits||{}; r._edits[c]=i.value; r._dirty=true; tr.classList.add('dirty'); }; td.appendChild(i); }
        else td.textContent=r[c];
        tr.appendChild(td);
      });
      b.appendChild(tr);
    });
    $('count').textContent=n+' row(s) shown';
  }
  $('filter').oninput=drawPrograms;
  $('guestsOnly').onchange=drawRows;
  $('ghosts').onchange=()=>{ const on=$('ghosts').checked;
    ROWS.forEach(r=>{ if(isGuest(r) && String(r.Name).trim().split(/\\s+/).filter(Boolean).length<2) r._remove=on; }); drawRows(); };
  $('load').onclick=()=>{
    const ids=Array.from($('progs').querySelectorAll('input:checked')).map(i=>i.value);
    if(!ids.length){ $('msg').textContent='Tick at least one program.'; return; }
    $('msg').textContent='Loading…';
    google.script.run.withSuccessHandler(rows=>{ ROWS=rows; $('ghosts').checked=false; drawRows(); $('msg').textContent=''; })
      .withFailureHandler(e=>{ $('msg').textContent='⚠️ '+e.message; }).loadRegistrationReviewRows(ids);
  };
  $('save').onclick=()=>{
    const removes=ROWS.filter(r=>r._remove).map(r=>r.key);
    const edits=ROWS.filter(r=>r._dirty && !r._remove).map(r=>({key:r.key,fields:r._edits}));
    if(!removes.length && !edits.length){ $('msg').textContent='Nothing changed.'; return; }
    if(removes.length && !confirm('Remove '+removes.length+' row(s)? The next sync will not put them back.')) return;
    $('save').disabled=true; $('msg').textContent='Saving…';
    google.script.run.withSuccessHandler(res=>{ $('save').disabled=false; $('msg').textContent=res.message;
      if(res.ok) $('load').onclick(); })
      .withFailureHandler(e=>{ $('save').disabled=false; $('msg').textContent='⚠️ '+e.message; })
      .applyRegistrationReviewChanges({edits:edits,removes:removes});
  };
  $('close').onclick=()=>google.script.host.close();
  drawHead(); drawPrograms();
</script></body></html>`;
}
