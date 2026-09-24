// ============================================================================
// 99r. FORMS THAT WILL NOT OPEN — every id the workbook remembers, probed,
// and the two things somebody can do about the ones that fail
// ============================================================================
//
// A form id is written down in more places than anybody would guess: the
// session table's Form_ID column, the groupKey→form registry (06), the
// all-dates registry (06), the template-version map (06), the date-label
// fingerprints (10), the form-state migration ledger (68), the applied
// custom-question map (54), the two "forms this code closed" lists (23), the
// re-import marks (99), and the forms folder itself (04/32). When a form is
// deleted, trashed, or left behind in an account that has gone, EVERY one of
// those keeps its copy. Each reader then meets the dead id on its own, logs a
// warning in its own words, and carries on — so the fault is reported nine
// ways, hourly, and never once as "this form is gone; here is everything that
// still names it."
//
// `32` (the link repair) and `51` (the Doctor) answer the commonest version —
// a row whose links drifted from a form that is alive. Neither can help when
// the form a program's rows name is the thing that is gone: there is nothing
// to repair FROM. And `99` marks a form for re-import but assumes somebody
// already knows which form. This file is the inventory those three presume.
//
// WHAT IT DOES
//   • showUnopenableFormsDialog() collects every id from every store above
//     (cheap: one sheet read, a handful of Script Properties, one folder
//     listing) and opens the dialog with that inventory inlined.
//   • The PAGE then probes, in chunks, through probeFormsForUnopenableReview()
//     — each call a bounded budget, handing back what it did not reach. That
//     is the slicing, and it is deliberately not runSlicedJob (75): that
//     runner is for unattended work with no page to report to, handing off to
//     a trigger. Here somebody is watching a list fill in, and a chunk per
//     round trip is both the progress bar and the time limit. No chunk can
//     approach the execution ceiling, so there is nothing for a watchdog to do.
//   • Probing goes through openFormCached() (08), which never caches a
//     FAILURE — the banner there gives the three reasons, and the one that
//     matters here is that a form restored from the trash between the probe
//     and the action must be seen as alive. For the same reason both actions
//     RE-PROBE on the server before they write anything: the page's list is
//     a claim from a minute ago.
//
// THE TWO ACTIONS
//   (a) SWAP — repoint the dead form's sessions onto a form that opens,
//       through writeFormIdOntoSessions() (47), which writes all three
//       pointers at once so they cannot come apart again. UPCOMING rows only
//       unless asked: a past row's Form_ID is the record of where that
//       registration came from, the same rule `94` and `32` keep. The chosen
//       form is then MARKED for re-import (99), because every response it took
//       while the rows named the dead form is behind the sync clock — without
//       the mark the swap looks finished and the people who signed up in the
//       meantime never become rows. The dead id is NOT purged by a swap;
//       that is (b), and a separate decision.
//   (b) PURGE — take the dead id out of every Script Properties store listed
//       in unopenableFormStores_(). Session rows are left alone unless the
//       "also blank the session rows" box is ticked, because a past row's
//       Form_ID is history and blanking it costs the answer to "which form
//       did this come from?" forever. The forms folder is only ever REPORTED:
//       a file this code cannot open is not a file it should be moving.
//
// Both are gated through ADMIN_GATED_ACTIONS (01) and confirmed on the page,
// and both run under the script lock: they write the session table and the
// registries an hourly sync is reading.
// ============================================================================

/** How long one probe call may spend before it hands the rest back to the page. */
const UNOPENABLE_FORMS_PROBE_BUDGET_MS = 20 * 1000;

/** The session-row fields a dialog needs per form, and no more. */
const UNOPENABLE_FORMS_MAX_SESSIONS_LISTED = 400;

/**
 * Every Script Properties store that holds form ids, and HOW it holds them.
 * A function rather than a top-level const: every key named here is another
 * file's constant (see 01a).
 *   shape 'keys'   — { formId: … }
 *   shape 'values' — { anything: formId }
 */
function unopenableFormStores_() {
  return [
    { propKey: FORM_REGISTRY_PROP_KEY, label: 'Form registry (group → form)', shape: 'values' },
    { propKey: ALL_DATES_REGISTRY_PROP_KEY, label: 'All-dates registrants', shape: 'keys' },
    { propKey: FORM_TEMPLATE_VERSION_PROP_KEY, label: 'Template versions', shape: 'keys' },
    { propKey: FORM_LABEL_FINGERPRINT_PROP_KEY, label: 'Date-label fingerprints', shape: 'keys' },
    { propKey: FORM_STATE_MIGRATION_LEDGER_PROP_KEY, label: 'Form migration ledger', shape: 'keys' },
    { propKey: CUSTOM_QUESTIONS_PROP_KEY, label: 'Custom questions applied', shape: 'keys' },
    { propKey: NO_REGISTRATION_CLOSED_FORMS_PROP_KEY, label: 'Closed by [No Registration]', shape: 'keys' },
    { propKey: REGISTRATION_HORIZON_CLOSED_FORMS_PROP_KEY, label: 'Closed by the registration horizon', shape: 'keys' },
    { propKey: REGISTRATION_BACKFILL_PROP_KEY, label: 'Marked for re-import', shape: 'keys' }
  ];
}

/** One store's parsed contents, or null when it is absent or unreadable. */
function readFormIdStore_(propKey) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(propKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    log(`⚠️ Unopenable forms: store ${propKey} could not be read (${err}) — its ids are not listed.`);
    return null;
  }
}

/** The form ids one store names. Pure. */
function formIdsInStore_(obj, shape) {
  if (!obj) return [];
  const ids = shape === 'values'
    ? Object.keys(obj).map(k => obj[k])
    : Object.keys(obj);
  return ids.map(id => String(id || '').trim()).filter(Boolean);
}

/**
 * Removes one form id from one store's object IN PLACE. Returns how many
 * entries went. Pure apart from the mutation.
 */
function purgeFormIdFromStore_(obj, shape, formId) {
  if (!obj) return 0;
  let removed = 0;
  Object.keys(obj).forEach(k => {
    const id = shape === 'values' ? String(obj[k] || '').trim() : String(k).trim();
    if (id !== formId) return;
    delete obj[k];
    removed++;
  });
  return removed;
}

/**
 * THE INVENTORY — every known form id, what names it, and which programs'
 * sessions sit on it. Pure: the caller supplies the rows, the stores and the
 * folder listing, so a test can build it with no services at all.
 *
 *   sessionRows — rows in HEADERS.All_Program_Sessions order
 *   stores      — [{ label, shape, data }]
 *   folderIds   — ids listed in the forms folder
 *   todayKey    — 'yyyy-MM-dd'; a session on or after it is UPCOMING
 */
function buildUnopenableFormInventory_(sessionRows, map, stores, folderIds, todayKey) {
  const forms = {};
  const programs = {};
  const entry = id => {
    if (!forms[id]) forms[id] = { formId: id, stores: [], sessions: [], upcoming: 0, past: 0, programKeys: [] };
    return forms[id];
  };

  (stores || []).forEach(store => {
    formIdsInStore_(store.data, store.shape).forEach(id => {
      const e = entry(id);
      if (e.stores.indexOf(store.label) === -1) e.stores.push(store.label);
    });
  });
  (folderIds || []).forEach(id => {
    const e = entry(String(id).trim());
    if (e.stores.indexOf('Forms folder') === -1) e.stores.push('Forms folder');
  });

  (sessionRows || []).forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    const source = String(row[map['Calendar_Source']] || '').trim();
    const title = String(row[map['Clean_Title']] || '').trim();
    const location = String(row[map['Location']] || '').trim();
    // A program is `Calendar_Source | Clean_Title` — the boundary 99m and the
    // flag reconcilers draw, so two buildings' unlinked "Chair Yoga" stay two.
    const programKey = `${source}|${title}`;
    if (!programs[programKey]) {
      programs[programKey] = { programKey, label: location ? `${title} — ${location}` : title, formIds: [], nextUpcoming: null };
    }
    const prog = programs[programKey];
    if (!formId) return;
    if (prog.formIds.indexOf(formId) === -1) prog.formIds.push(formId);

    const dateKey = date ? formatDateKey(date) : '';
    const upcoming = !!dateKey && dateKey >= todayKey;
    if (upcoming && (!prog.nextUpcoming || dateKey < prog.nextUpcoming.dateKey)) {
      prog.nextUpcoming = { dateKey, formId };
    }

    const e = entry(formId);
    if (e.stores.indexOf('Session table') === -1) e.stores.push('Session table');
    if (upcoming) e.upcoming++; else e.past++;
    if (e.programKeys.indexOf(programKey) === -1) e.programKeys.push(programKey);
    if (e.sessions.length < UNOPENABLE_FORMS_MAX_SESSIONS_LISTED) {
      e.sessions.push({
        eventId: String(row[map['Event_ID']] || '').trim(),
        dateKey, title, location, upcoming, programKey
      });
    }
  });

  Object.keys(forms).forEach(id => forms[id].sessions.sort((a, b) => a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  return { forms, programs };
}

/**
 * The forms somebody could swap a dead one for, and which to preselect.
 * Pure. `opens` is { formId: true|false } from the probe.
 *
 * Candidates are the OTHER forms the dead form's programs already sit on —
 * the program's own history is the only evidence of which form is "its" —
 * that are known to open. The default is the form the program's NEXT upcoming
 * session is on (the link in circulation, `94`'s rule), else the candidate the
 * most of its rows name.
 */
function swapCandidatesFor_(deadId, inventory, opens) {
  const counts = {};
  let preferred = '';
  (inventory.forms[deadId] ? inventory.forms[deadId].programKeys : []).forEach(pk => {
    const prog = inventory.programs[pk];
    if (!prog) return;
    prog.formIds.forEach(id => {
      if (id === deadId || opens[id] !== true) return;
      const f = inventory.forms[id];
      counts[id] = (counts[id] || 0) + (f ? f.sessions.filter(s => s.programKey === pk).length : 0);
    });
    const next = prog.nextUpcoming;
    if (!preferred && next && next.formId !== deadId && opens[next.formId] === true) preferred = next.formId;
  });
  const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  return { candidates: ids, defaultId: preferred || ids[0] || '' };
}

/** Reads everything the inventory needs, from the live workbook. */
function collectUnopenableFormInventory_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  const headers = HEADERS.All_Program_Sessions;
  const rows = sheet ? getSectionedRows(sheet, headers, 'Event_ID') : [];
  const stores = unopenableFormStores_().map(s => Object.assign({}, s, { data: readFormIdStore_(s.propKey) }));
  let folderIds = [];
  try { folderIds = formIdsInFormsFolder_(); } catch (err) { log(`ℹ️ Unopenable forms: folder not listed (${err}).`); }
  return buildUnopenableFormInventory_(rows, getIndexMap(headers), stores, folderIds, formatDateKey(new Date()));
}

/** Admin ▸ Review Unopenable Forms… */
function showUnopenableFormsDialog() {
  // Registries are flushed first so the inventory is what is STORED, not what
  // an earlier call in this execution has only buffered.
  try { flushPersistentRegistries(); } catch (err) { /* the read below still works */ }
  const inventory = collectUnopenableFormInventory_();
  if (Object.keys(inventory.forms).length === 0) {
    toastIfPossible('This workbook names no forms yet — nothing to check.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildUnopenableFormsHtml(inventory))
    .setWidth(820)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Review Unopenable Forms');
}

/** One probe. Never throws; a failure is the finding. */
function probeOneForm_(formId) {
  try {
    const form = openFormCached(formId);
    return { opens: true, title: String(form.getTitle() || '') };
  } catch (err) {
    return { opens: false, error: String(err && err.message || err) };
  }
}

/**
 * Called from the page, a chunk at a time. Probes until the budget is spent
 * and hands back what it did not reach — the page calls again with those.
 */
function probeFormsForUnopenableReview(formIds) {
  const started = Date.now();
  const results = {};
  const ids = (formIds || []).map(id => String(id || '').trim()).filter(Boolean);
  let i = 0;
  for (; i < ids.length; i++) {
    if (i > 0 && Date.now() - started > UNOPENABLE_FORMS_PROBE_BUDGET_MS) break;
    results[ids[i]] = probeOneForm_(ids[i]);
  }
  return { results, remaining: ids.slice(i) };
}

/** '' when allowed; otherwise the sentence the page shows. */
function unopenableFormsGate_(actionName) {
  if (!isAdminGatedAction(actionName) || isAuthorizedAdmin()) return '';
  const email = getCurrentUserEmail();
  return `"${actionName}" is restricted to: ${listAuthorizedAdminEmails().join(', ')} — ` +
    `${email ? `you're signed in as ${email}` : 'your account could not be identified'}.`;
}

/**
 * (a) SWAP. `requests` is [{ deadId, targetId, includePast }]. Returns one
 * result line per request; never throws to the page.
 */
function swapUnopenableForms(requests) {
  const refusal = unopenableFormsGate_('Swap Unopenable Forms');
  if (refusal) return { ok: false, message: refusal, lines: [] };
  return withScriptLock(SYNC_LOCK_WAIT_MS, () => {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (!sheet) return { ok: false, message: 'No session table yet.', lines: [] };
    const inventory = collectUnopenableFormInventory_();
    const lines = [];
    (requests || []).forEach(req => {
      const deadId = String(req && req.deadId || '').trim();
      const targetId = extractFormId(String(req && req.targetId || '').trim()) || String(req && req.targetId || '').trim();
      if (!deadId || !targetId) { lines.push(`${deadId || '(no id)'}: no form to swap to — skipped.`); return; }
      if (deadId === targetId) { lines.push(`${deadId}: cannot swap a form for itself — skipped.`); return; }
      // Re-probed, both ways: the page's list is a minute old.
      if (probeOneForm_(deadId).opens) {
        lines.push(`${deadId}: opens now — left alone (restored since the check?).`);
        return;
      }
      const target = probeOneForm_(targetId);
      if (!target.opens) { lines.push(`${deadId}: the chosen form ${targetId} will not open either — skipped.`); return; }
      const e = inventory.forms[deadId];
      const wanted = new Set((e ? e.sessions : [])
        .filter(s => s.eventId && (s.upcoming || req.includePast))
        .map(s => s.eventId));
      if (wanted.size === 0) { lines.push(`${deadId}: no ${req.includePast ? '' : 'upcoming '}sessions name it — nothing to swap.`); return; }
      const moved = writeFormIdOntoSessions(sheet, wanted, targetId);
      const marked = moved > 0 ? markFormForBackfill(targetId) : false;
      lines.push(`${deadId} → "${target.title}": ${moved} session row(s) repointed` +
        (moved > 0 ? `; ${marked ? 'marked' : 'already marked'} for re-import on the next sync.` : '.'));
    });
    lines.forEach(l => log(`🔁 Unopenable forms (swap): ${l}`));
    return { ok: true, message: '', lines };
  }, { ok: false, message: 'A sync is running — try again in a minute.', lines: [] });
}

/**
 * Blanks Form_ID and both link cells on every session row naming `formId`.
 * Returns how many rows changed. Same zone walk and formula-preserving read
 * as writeFormIdOntoSessions() (47), so untouched rows go back byte-identical.
 */
function blankFormIdOnSessions_(registrySheet, formId) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]);
  let blanked = 0;
  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;
    const idRange = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1);
    const viewRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const editRange = registrySheet.getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1);
    const ids = idRange.getValues();
    const viewValues = viewRange.getValues();
    const editValues = editRange.getValues();
    const views = viewRange.getFormulas().map((f, r) => [f[0] || viewValues[r][0]]);
    const edits = editRange.getFormulas().map((f, r) => [f[0] || editValues[r][0]]);
    let touched = false;
    ids.forEach((idRow, r) => {
      if (String(idRow[0] || '').trim() !== formId) return;
      ids[r] = [''];
      views[r] = [''];
      edits[r] = [''];
      touched = true;
      blanked++;
    });
    if (touched) {
      idRange.setValues(ids);
      viewRange.setValues(views);
      editRange.setValues(edits);
      invalidateSectionedRowsCache(registrySheet);
    }
  });
  return blanked;
}

/**
 * The in-memory copies other files keep of the stores this edits. Dropped
 * after a purge so a later read in this execution re-reads what was written,
 * rather than a stale cache being flushed straight back over it.
 */
function dropFormIdStoreCaches_() {
  __formRegistryCache = null; __formRegistryDirty = false;
  __allDatesRegistryCache = null; __allDatesRegistryDirty = false;
  __formTemplateVersionCache = null; __formTemplateVersionDirty = false;
  __formLabelFingerprintCache = null; __formLabelFingerprintDirty = false;
  __formStateMigrationLedger = null;
}

/**
 * (b) PURGE. `requests` is [{ deadId, blankRows }]. The id comes out of every
 * store in unopenableFormStores_(); session rows are blanked only when asked.
 */
function purgeUnopenableForms(requests) {
  const refusal = unopenableFormsGate_('Purge Unopenable Forms');
  if (refusal) return { ok: false, message: refusal, lines: [] };
  return withScriptLock(SYNC_LOCK_WAIT_MS, () => {
    // Anything buffered in this execution lands first, so the raw edit below
    // is an edit of what is stored and nothing flushes over it afterwards.
    flushPersistentRegistries();
    try { flushFormStateMigrationLedger(); } catch (err) { /* nothing buffered */ }
    const props = PropertiesService.getScriptProperties();
    const stores = unopenableFormStores_().map(s => Object.assign({}, s, { data: readFormIdStore_(s.propKey), dirty: false }));
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    const lines = [];

    (requests || []).forEach(req => {
      const deadId = String(req && req.deadId || '').trim();
      if (!deadId) return;
      if (probeOneForm_(deadId).opens) {
        lines.push(`${deadId}: opens now — left alone (restored since the check?).`);
        return;
      }
      const from = [];
      stores.forEach(store => {
        const n = purgeFormIdFromStore_(store.data, store.shape, deadId);
        if (n > 0) { store.dirty = true; from.push(`${store.label}${n > 1 ? ` ×${n}` : ''}`); }
      });
      const blanked = (req.blankRows && sheet) ? blankFormIdOnSessions_(sheet, deadId) : 0;
      lines.push(`${deadId}: removed from ${from.length ? from.join(', ') : 'no store'}` +
        (req.blankRows ? `; ${blanked} session row(s) blanked.` : '; session rows kept as history.'));
    });

    stores.forEach(store => {
      if (!store.dirty) return;
      if (Object.keys(store.data).length === 0) props.deleteProperty(store.propKey);
      else props.setProperty(store.propKey, JSON.stringify(store.data));
    });
    dropFormIdStoreCaches_();
    lines.forEach(l => log(`🗑️ Unopenable forms (purge): ${l}`));
    return { ok: true, message: '', lines };
  }, { ok: false, message: 'A sync is running — try again in a minute.', lines: [] });
}

/**
 * The page. Everything from the workbook crosses into the script through the
 * doubled JSON.stringify with every "<" escaped (99m's banner has the reason),
 * and is written into the page with textContent — never innerHTML with data.
 */
function buildUnopenableFormsHtml(inventory) {
  const payload = JSON.stringify(JSON.stringify(inventory)).replace(/</g, '\\u003c');
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  #status { margin: 8px 0; font-weight: bold; }
  .form { border: 1px solid #ccc; border-radius: 4px; padding: 8px; margin-bottom: 8px; }
  .form .id { font-family: monospace; font-size: 12px; color: #555; word-break: break-all; }
  .form .err { color: #a33; font-size: 12px; }
  .form ul { margin: 4px 0 4px 18px; padding: 0; max-height: 110px; overflow-y: auto; }
  .row { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  select, input[type=text] { padding: 4px; font-size: 12px; max-width: 360px; }
  button { padding: 6px 12px; font-size: 13px; cursor: pointer; }
  #result { white-space: pre-wrap; background: #f6f6f6; padding: 8px; margin-top: 8px; display: none; }
  .past { color: #888; }
</style>
<h3>Forms this workbook names that will not open</h3>
<p class="hint">Every form id in the session table, the registries, the ledgers, the re-import marks and the
forms folder is being opened once. <b>Swap</b> repoints a dead form's sessions to a working form (upcoming
only unless you tick "past too") and marks that form for re-import. <b>Purge</b> takes the dead id out of every
registry and ledger; session rows are kept as history unless you tick "blank rows".</p>
<div id="status">Checking…</div>
<div id="bulk" style="display:none" class="row">
  <label><input type="checkbox" id="all"> Select all</label>
  <button id="swapSel">Swap selected</button>
  <button id="purgeSel">Purge selected</button>
</div>
<div id="list"></div>
<div id="result"></div>
<script>
  var INV = JSON.parse(${payload});
  var OPENS = {};
  var TITLES = {};
  var ERRORS = {};
  var ids = Object.keys(INV.forms);
  var total = ids.length;

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function setStatus(t) { document.getElementById('status').textContent = t; }

  function probe(rest) {
    if (rest.length === 0) { draw(); return; }
    var chunk = rest.slice(0, 25);
    setStatus('Checking… ' + (total - rest.length) + ' of ' + total + ' forms opened.');
    google.script.run
      .withSuccessHandler(function (res) {
        Object.keys(res.results).forEach(function (id) {
          OPENS[id] = res.results[id].opens === true;
          if (res.results[id].title) TITLES[id] = res.results[id].title;
          if (res.results[id].error) ERRORS[id] = res.results[id].error;
        });
        probe(res.remaining.concat(rest.slice(chunk.length)));
      })
      .withFailureHandler(function (err) { setStatus('The check stopped: ' + (err && err.message || err)); draw(); })
      .probeFormsForUnopenableReview(chunk);
  }

  // Candidates for one dead form: the other forms its programs sit on that
  // open. Mirrors swapCandidatesFor_() on the server, which is what the tests pin.
  function candidatesFor(deadId) {
    var counts = {}, preferred = '';
    (INV.forms[deadId].programKeys || []).forEach(function (pk) {
      var prog = INV.programs[pk]; if (!prog) return;
      prog.formIds.forEach(function (id) {
        if (id === deadId || OPENS[id] !== true) return;
        var f = INV.forms[id];
        counts[id] = (counts[id] || 0) + (f ? f.sessions.filter(function (s) { return s.programKey === pk; }).length : 0);
      });
      var n = prog.nextUpcoming;
      if (!preferred && n && n.formId !== deadId && OPENS[n.formId] === true) preferred = n.formId;
    });
    var list = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    return { list: list, def: preferred || list[0] || '' };
  }

  var CARDS = [];
  function draw() {
    var dead = ids.filter(function (id) { return OPENS[id] === false; });
    var unchecked = ids.filter(function (id) { return OPENS[id] === undefined; }).length;
    setStatus(dead.length === 0
      ? 'Every form this workbook names opens.' + (unchecked ? ' (' + unchecked + ' not checked.)' : '')
      : dead.length + ' of ' + total + ' forms will not open.' + (unchecked ? ' ' + unchecked + ' not checked.' : ''));
    var list = document.getElementById('list');
    list.textContent = '';
    CARDS = [];
    document.getElementById('bulk').style.display = dead.length ? 'flex' : 'none';
    dead.forEach(function (id) {
      var f = INV.forms[id];
      var card = el('div', null, 'form');
      var head = el('label');
      var pick = el('input'); pick.type = 'checkbox';
      head.appendChild(pick);
      var names = (f.programKeys || []).map(function (pk) { return INV.programs[pk] ? INV.programs[pk].label : pk; });
      head.appendChild(el('b', ' ' + (names.length ? names.join('; ') : 'No sessions name this form')));
      card.appendChild(head);
      card.appendChild(el('div', id, 'id'));
      if (ERRORS[id]) card.appendChild(el('div', ERRORS[id], 'err'));
      card.appendChild(el('div', 'Held by: ' + f.stores.join(', ') + ' · ' + f.upcoming + ' upcoming, ' + f.past + ' past session(s)'));
      if (f.sessions.length) {
        var ul = el('ul');
        f.sessions.forEach(function (s) {
          ul.appendChild(el('li', s.dateKey + ' — ' + s.title + (s.location ? ' (' + s.location + ')' : '') + (s.upcoming ? '' : ' · past'), s.upcoming ? '' : 'past'));
        });
        card.appendChild(ul);
      }
      var row = el('div', null, 'row');
      var c = candidatesFor(id);
      var sel = el('select');
      c.list.forEach(function (cid) {
        var o = el('option', (TITLES[cid] || cid) + (cid === c.def ? ' (next session\\'s form)' : ''));
        o.value = cid; if (cid === c.def) o.selected = true; sel.appendChild(o);
      });
      var other = el('option', 'Another form (paste its edit link)…'); other.value = '';
      sel.appendChild(other);
      if (!c.def) other.selected = true;
      var typed = el('input'); typed.type = 'text'; typed.placeholder = 'Form edit link or id';
      typed.style.display = c.def ? 'none' : '';
      sel.onchange = function () { typed.style.display = sel.value ? 'none' : ''; };
      var pastL = el('label'); var past = el('input'); past.type = 'checkbox';
      pastL.appendChild(past); pastL.appendChild(document.createTextNode(' past too'));
      var blankL = el('label'); var blank = el('input'); blank.type = 'checkbox';
      blankL.appendChild(blank); blankL.appendChild(document.createTextNode(' blank rows on purge'));
      var swapB = el('button', 'Swap'); var purgeB = el('button', 'Purge');
      [sel, typed, pastL, swapB, blankL, purgeB].forEach(function (n) { row.appendChild(n); });
      card.appendChild(row);
      list.appendChild(card);
      var ref = { id: id, pick: pick, target: function () { return sel.value || typed.value.trim(); }, past: past, blank: blank };
      CARDS.push(ref);
      swapB.onclick = function () { doSwap([ref]); };
      purgeB.onclick = function () { doPurge([ref]); };
    });
  }

  function showResult(res) {
    var box = document.getElementById('result');
    box.style.display = 'block';
    box.textContent = res && res.ok ? (res.lines.join('\\n') || 'Nothing to do.') : ((res && res.message) || 'Refused.');
    setStatus('Done — reopen this dialog to re-check.');
  }
  function run(fn, reqs) {
    setStatus('Working…');
    google.script.run.withSuccessHandler(showResult)
      .withFailureHandler(function (e) { showResult({ ok: false, message: String(e && e.message || e) }); })[fn](reqs);
  }
  function doSwap(refs) {
    var reqs = refs.map(function (r) { return { deadId: r.id, targetId: r.target(), includePast: r.past.checked }; });
    var missing = reqs.filter(function (q) { return !q.targetId; }).length;
    if (missing) { alert(missing + ' selected form(s) have no form chosen to swap to.'); return; }
    if (!confirm('Repoint the sessions of ' + reqs.length + ' dead form(s) to the chosen forms, and mark those for re-import?')) return;
    run('swapUnopenableForms', reqs);
  }
  function doPurge(refs) {
    var reqs = refs.map(function (r) { return { deadId: r.id, blankRows: r.blank.checked }; });
    var blanking = reqs.filter(function (q) { return q.blankRows; }).length;
    if (!confirm('Remove ' + reqs.length + ' dead form id(s) from every registry and ledger?' +
      (blanking ? '\\n\\n' + blanking + ' will ALSO have their session rows\\' form links blanked, past rows included. That cannot be undone.' : '\\n\\nSession rows are kept as history.'))) return;
    run('purgeUnopenableForms', reqs);
  }
  function selected() { return CARDS.filter(function (r) { return r.pick.checked; }); }
  document.getElementById('all').onchange = function () { var v = this.checked; CARDS.forEach(function (r) { r.pick.checked = v; }); };
  document.getElementById('swapSel').onclick = function () { var s = selected(); if (s.length) doSwap(s); };
  document.getElementById('purgeSel').onclick = function () { var s = selected(); if (s.length) doPurge(s); };

  probe(ids.slice());
</script>`;
}
