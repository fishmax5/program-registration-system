// ============================================================================
// 99zj. A REGISTRATION ON THE TAB IN TWO MINUTES, NOT THREE HOURS
//       (one shared response spreadsheet, one submit trigger)
// ============================================================================
//
// THE IMPORT (`27`) FINDS NEW REGISTRATIONS BY ASKING EVERY FORM. Every three
// hours it opens each form named in the session table's Form_ID column and asks
// for its responses since LAST_FORM_SYNC_TIME — one FormApp.openById() and one
// getResponses() per live form, whether anybody submitted anything or not —
// and a registration can sit on a form for three hours before the desk sees it.
//
// THIS FILE GIVES THE IMPORT A SIGNAL. Every generated form also sends its
// responses to ONE spreadsheet (Google gives each linked form a tab of its
// own), and ONE installable onFormSubmit trigger on that spreadsheet fires for
// a submission to ANY of them. The handler writes down WHICH FORM was
// submitted and arms a one-off import a minute out; a burst of submissions is
// one import. The import that runs is the ordinary one (`27`/`98`), on the
// queued forms only.
//
// THE TAB IS A SIGNAL, NEVER A SOURCE. processFormResponse() (`29`) stays the
// only interpreter of a response, reading it through FormApp by item. Nothing
// here parses a response-tab column: those headers follow item TITLES, and the
// template migrations rename and delete items (`68`'s v8→v9 meal swap, which
// is the whole story of `99d`), so a column-reader would be a second
// interpreter that drifts. What this file reads off the spreadsheet is
// exactly two facts per tab: which form it belongs to, and how many rows it has.
//
// THE CLOCK IS THE PERIODIC SYNC'S ALONE. The instant import reads from the
// current LAST_FORM_SYNC_TIME and never moves it, so everything it reads the
// periodic window reads again — which is safe because re-reading a response is
// a patch in place (`buildRegistrantRow`, matched by Party_ID), and is what
// every failed window has always done. What the periodic window gains is the
// right to SKIP a form: one that is linked here, whose tab is mapped, and
// whose row count has not moved since the opening of the last window that
// advanced the clock (`withoutUnchangedSharedResponseForms_`). The first
// window of each day reads every form anyway, which is the net under an
// edited response (an edit rewrites its row instead of adding one) and under a
// lost trigger. Anything this file does not KNOW — a form not linked, a tab
// not mapped, no baseline, a spreadsheet that will not open — is read the old
// way. See docs/transitions/R1_event_import.md for the whole argument.
//
// OFF UNTIL SOMEBODY TURNS IT ON. `SHARED_RESPONSES_V1` absent or
// `enabled: false` is today's behaviour exactly; deploying this file changes
// nothing until 🔧 Admin ▸ ⚡ Instant Registration Import… is pressed.
//
// LOAD ORDER: behavior plus self-contained constants. Everything it reaches
// for — openFormCached (`08`), runRegistrationSyncPhases_ (`98`), the
// migration ledger (`68`), getOrCreateSystemFolder (`82`), workbookLock
// (`99w`) — it reaches at CALL time or through a hoisted declaration.
// ============================================================================

/** The switch and the spreadsheet: { enabled, spreadsheetId, createdAt, createdBy, previous: [] }. */
const SHARED_RESPONSES_PROP_KEY = 'SHARED_RESPONSES_V1';

/**
 * formId → { s: sheetId|null, p: publishedIdPrefix, n: baseline lastRow|null,
 * x: another spreadsheet's id when the form was found linked elsewhere }.
 * CHUNKED: a value in Script Properties is capped at 9KB and two hundred forms
 * are more than that. Written only under the workbook lock.
 */
const SHARED_RESPONSE_INDEX_PROP_KEY = 'SHARED_RESPONSE_INDEX_V1';
const SHARED_RESPONSE_INDEX_CHUNK_CHARS = 8000;

/**
 * The row counts a periodic window saw at its OPENING: { window, counts }.
 * Kept off the sync plan on purpose — the plan is ONE property, capped at 9KB,
 * and already carries the form list. `window` is the plan's windowOpenedAt, so
 * counts from a window that died are never committed by a later one.
 */
const SHARED_RESPONSE_OBSERVED_PROP_KEY = 'SHARED_RESPONSE_OBSERVED_V1';

/** One property PER FORM, so two submissions never race one read-modify-write. */
const RESPONSE_SUBMIT_QUEUE_PREFIX = 'RESPONSE_SUBMIT_QUEUE_V1::';
/** A submission whose form could not be named: the import scans every tab for growth. */
const RESPONSE_SUBMIT_UNKNOWN_FORM = '*';

/** When a one-off import was last armed, in ms. */
const INSTANT_IMPORT_ARMED_PROP_KEY = 'INSTANT_IMPORT_ARMED_V1';

const SHARED_RESPONSE_SUBMIT_HANDLER = 'onSharedResponseSubmit';
const INSTANT_IMPORT_HANDLER = 'importSubmittedResponses';

/** A minute: long enough that a household submitting four forms is one import. */
const INSTANT_IMPORT_DELAY_MS = 60 * 1000;
/** The workbook is busy: try again in a little while. */
const INSTANT_IMPORT_BUSY_DELAY_MS = 2 * 60 * 1000;
/** A sync window or a sweep owns the workbook: they take minutes. */
const INSTANT_IMPORT_DEFER_DELAY_MS = 5 * 60 * 1000;
/** An "armed" marker older than this is a trigger that never ran. */
const INSTANT_IMPORT_ARM_STALE_MS = 10 * 60 * 1000;
/** The instant import's own budget, under Config's sync budget. */
const INSTANT_IMPORT_MAX_MS = 4 * 60 * 1000;
/** The steps of the sync's tail that a registration needs at once (`98`). */
const INSTANT_IMPORT_TAIL = ['counts', 'form_shapes', 'appointment_slots'];

/** The daily full read, in `99zg`'s once-a-day store. */
const SHARED_RESPONSES_FULL_READ_STEP = 'responses_full_read';

/** A spreadsheet holds 10M cells; past this the office is asked for a rollover. */
const SHARED_RESPONSES_CELL_WARN = 7000000;

/** Its folder, on the System shelf (`82`): only this code reads it. */
const SHARED_RESPONSES_FOLDER_NAME = 'Registration Responses';

/** The migration id the hourly sweep links forms under (`68`). */
const RESPONSE_DESTINATION_MIGRATION_ID = 'response_destination_r1';

// ----------------------------------------------------------------------------
// The switch
// ----------------------------------------------------------------------------

function getSharedResponsesState_() {
  try {
    const parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty(SHARED_RESPONSES_PROP_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function saveSharedResponsesState_(state) {
  PropertiesService.getScriptProperties().setProperty(SHARED_RESPONSES_PROP_KEY, JSON.stringify(state));
}

/** The id of the responses spreadsheet when the feature is ON, else ''. Never throws. */
function sharedResponsesSpreadsheetId() {
  const state = getSharedResponsesState_();
  return state.enabled && state.spreadsheetId ? String(state.spreadsheetId) : '';
}

function sharedResponsesActive() {
  return !!sharedResponsesSpreadsheetId();
}

// ----------------------------------------------------------------------------
// The index (chunked)
// ----------------------------------------------------------------------------

let __sharedResponseIndex = null;

/** A JSON object stored across `<key>::0..n-1` with the count at `<key>::n`. Throws when unreadable. */
function readChunkedJson_(key) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty(`${key}::n`)) || 0;
  let raw = '';
  for (let i = 0; i < n; i++) raw += props.getProperty(`${key}::${i}`) || '';
  const parsed = raw ? JSON.parse(raw) : {};
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function writeChunkedJson_(key, value) {
  const props = PropertiesService.getScriptProperties();
  const raw = JSON.stringify(value || {});
  const chunks = [];
  for (let i = 0; i < raw.length; i += SHARED_RESPONSE_INDEX_CHUNK_CHARS) {
    chunks.push(raw.slice(i, i + SHARED_RESPONSE_INDEX_CHUNK_CHARS));
  }
  if (chunks.length === 0) chunks.push('{}');
  const oldN = Number(props.getProperty(`${key}::n`)) || 0;
  const batch = {};
  chunks.forEach((chunk, i) => { batch[`${key}::${i}`] = chunk; });
  batch[`${key}::n`] = String(chunks.length);
  props.setProperties(batch);
  for (let i = chunks.length; i < oldN; i++) props.deleteProperty(`${key}::${i}`);
}

function readSharedResponseIndex_() {
  if (__sharedResponseIndex) return __sharedResponseIndex;
  let index = {};
  try {
    index = readChunkedJson_(SHARED_RESPONSE_INDEX_PROP_KEY);
  } catch (err) {
    // An unreadable index is an EMPTY one: every form is then "not known to be
    // linked", which is read the old way. Never a reason to skip a form.
    log(`ℹ️ The shared-response index could not be read (${err}) — every form is read the usual way.`);
    index = {};
  }
  __sharedResponseIndex = index;
  return index;
}

function writeSharedResponseIndex_(index) {
  writeChunkedJson_(SHARED_RESPONSE_INDEX_PROP_KEY, index);
  __sharedResponseIndex = index;
}

function clearSharedResponseIndex_() {
  writeSharedResponseIndex_({});
}

/** formId → (published id prefix) for a URL a sheet or a form hands back. */
function formIdFromResponseUrl_(url) {
  const match = /\/forms\/d\/(e\/)?([A-Za-z0-9_-]{10,})/.exec(String(url || ''));
  if (!match) return null;
  return { id: match[2], published: !!match[1] };
}

/** A prefix is enough to tell two forms apart and keeps the index small. */
function publishedIdPrefix_(form) {
  try {
    const parsed = formIdFromResponseUrl_(form.getPublishedUrl());
    return parsed && parsed.published ? parsed.id.slice(0, 16) : '';
  } catch (err) {
    return '';
  }
}

/** Which form a response tab belongs to, through the index. '' when it cannot be told. */
function formIdForResponseTab_(index, sheetUrl) {
  const parsed = formIdFromResponseUrl_(sheetUrl);
  if (!parsed) return '';
  if (!parsed.published) return index[parsed.id] ? parsed.id : '';
  const prefix = parsed.id.slice(0, 16);
  const ids = Object.keys(index).filter(id => index[id] && index[id].p && index[id].p === prefix);
  return ids.length === 1 ? ids[0] : '';
}

/**
 * Maps every tab nobody has mapped yet onto its form, through getFormUrl().
 * A tab already mapped costs nothing; setDestination() makes its tab a moment
 * later than it returns, which is why this is lazy rather than done at linking.
 * Returns sheetId → formId for every tab it can name. Mutates `index`.
 */
function resolveSharedResponseTabs_(sheets, index) {
  const bySheet = {};
  Object.keys(index).forEach(id => {
    const entry = index[id];
    if (entry && entry.s !== null && entry.s !== undefined && !entry.x) bySheet[String(entry.s)] = id;
  });
  let changed = false;
  sheets.forEach(sheet => {
    const sid = String(sheet.getSheetId());
    if (bySheet[sid]) return;
    let url = '';
    try { url = sheet.getFormUrl(); } catch (err) { url = ''; }
    const formId = url ? formIdForResponseTab_(index, url) : '';
    if (!formId || index[formId].x) return;
    // A form whose tab was REPLACED (unlinked and relinked) gets the new one,
    // and its baseline goes with the old tab — the new one has never been counted.
    if (String(index[formId].s) !== sid) {
      index[formId].s = sheet.getSheetId();
      index[formId].n = null;
      changed = true;
    }
    bySheet[sid] = formId;
  });
  return { bySheet, changed };
}

// ----------------------------------------------------------------------------
// Linking a form (the migration, and at birth)
// ----------------------------------------------------------------------------

/** The `targets` predicate of the migration: only when the feature is on. */
function responseDestinationMigrationTargets_(context) {
  if (!sharedResponsesActive()) return false;
  // An ENDED form accepts no responses (99ze closed it): linking it would only
  // copy its history into the spreadsheet's cell budget.
  try {
    const formId = context && context.formId;
    if (formId && readEndedForms()[formId]) return false;
  } catch (err) { /* judge it linkable */ }
  return true;
}

/**
 * Points a live form's responses at the shared spreadsheet. Idempotent: a form
 * already pointing there costs two reads and re-records its index entry. A form
 * pointing at a spreadsheet that is NOT one of ours is never re-pointed — it is
 * reported, and goes on being read through FormApp like any unlinked form.
 * Returns { changed, recognized: true } for 68's sweep.
 */
function linkFormToSharedResponses(form) {
  const target = sharedResponsesSpreadsheetId();
  if (!target || !form) return { changed: 0, recognized: true };
  const formId = form.getId();
  const index = readSharedResponseIndex_();
  let currentDest = '';
  try {
    if (form.getDestinationType && form.getDestinationType() === FormApp.DestinationType.SPREADSHEET) {
      currentDest = String(form.getDestinationId() || '');
    }
  } catch (err) {
    currentDest = ''; // getDestinationId() throws on a form with no destination
  }

  if (currentDest === target) {
    const existing = index[formId];
    if (!existing || existing.x) {
      index[formId] = { s: null, p: publishedIdPrefix_(form), n: null };
      writeSharedResponseIndex_(index);
    }
    return { changed: 0, recognized: true };
  }

  const previous = getSharedResponsesState_().previous || [];
  if (currentDest && previous.indexOf(currentDest) === -1) {
    if (!index[formId] || index[formId].x !== currentDest) {
      index[formId] = { s: null, p: '', n: null, x: currentDest };
      writeSharedResponseIndex_(index);
      log(`ℹ️ Form ${formId} already sends its responses to another spreadsheet (${currentDest}) — left as it is.`);
      noteForAdmin('Forms not linked to the shared responses spreadsheet',
        `${describeFormLink(formId)} already sends its responses to a different spreadsheet ` +
        `(https://docs.google.com/spreadsheets/d/${currentDest}/edit). It was left alone and is still imported ` +
        `the usual way; to have it picked up instantly, unlink it (form ▸ Responses ▸ ⋮ ▸ Unlink form) and ` +
        `run 🔧 Admin ▸ 🧭 Fix Forms In Place.`);
    }
    return { changed: 0, recognized: true };
  }

  form.setDestination(FormApp.DestinationType.SPREADSHEET, target);
  index[formId] = { s: null, p: publishedIdPrefix_(form), n: null };
  writeSharedResponseIndex_(index);
  log(`Form ${formId} now also sends its responses to the shared responses spreadsheet.`);
  return { changed: 1, recognized: true };
}

/** A form made a moment ago (`26`, `47`): linked at birth. Never throws. */
function linkNewFormToSharedResponses(form) {
  try {
    if (!sharedResponsesActive()) return false;
    const result = linkFormToSharedResponses(form);
    // Recorded, so the hourly sweep does not open it again to find this out.
    try {
      markFormStateMigrationApplied(form.getId(), RESPONSE_DESTINATION_MIGRATION_ID);
      flushFormStateMigrationLedger();
    } catch (err) { /* the sweep's open is the fallback */ }
    return result.changed > 0;
  } catch (err) {
    log(`ℹ️ Could not link the new form to the shared responses spreadsheet (${err}) — the hourly ` +
      `form repairs will try again, and its registrations are imported the usual way meanwhile.`);
    return false;
  }
}

/** Forgets that the migration ran anywhere, so the sweep re-points every form (a rollover). */
function forgetResponseDestinationMigration_() {
  const ledger = getFormStateMigrationLedger();
  Object.keys(ledger).forEach(formId => {
    if (ledger[formId]) delete ledger[formId][RESPONSE_DESTINATION_MIGRATION_ID];
  });
  flushFormStateMigrationLedger();
}

// ----------------------------------------------------------------------------
// The periodic backstop: which linked forms grew
// ----------------------------------------------------------------------------

/**
 * Reads the row count of every mapped tab. Returns formId → lastRow, or null
 * when the spreadsheet cannot be read (and then nothing may be skipped).
 * `withCells` also sums lastRow × lastColumn, for the cell-budget warning.
 */
function readSharedResponseCounts_(options) {
  const id = sharedResponsesSpreadsheetId();
  if (!id) return null;
  const index = readSharedResponseIndex_();
  const ss = SpreadsheetApp.openById(id);
  const sheets = ss.getSheets();
  const resolved = resolveSharedResponseTabs_(sheets, index);
  if (resolved.changed) writeSharedResponseIndex_(index);
  const counts = {};
  let cells = 0;
  sheets.forEach(sheet => {
    const formId = resolved.bySheet[String(sheet.getSheetId())];
    if (!formId && !(options && options.withCells)) return;
    const lastRow = sheet.getLastRow();
    if (formId) counts[formId] = lastRow;
    if (options && options.withCells) cells += lastRow * sheet.getLastColumn();
  });
  return { counts, cells };
}

/**
 * THE ONE RULE FOR SKIPPING A FORM, pure: kept unless it is linked here (no
 * `x`), its tab is mapped, it has a baseline, its count was read, and the
 * count equals the baseline. Every unknown keeps the form on the list.
 */
function formsWithResponseTabChanges_(formIds, index, counts) {
  return formIds.filter(formId => {
    const entry = index[formId];
    if (!entry || entry.x || entry.s === null || entry.s === undefined) return true;
    if (entry.n === null || entry.n === undefined) return true;
    if (!counts || !Object.prototype.hasOwnProperty.call(counts, formId)) return true;
    return counts[formId] !== entry.n;
  });
}

/**
 * The periodic window's list, less the linked forms nothing was submitted to.
 * Records what it saw (SHARED_RESPONSE_OBSERVED_V1, keyed by the window), which becomes the baseline when
 * this window advances the clock. NEVER THROWS, and on any doubt returns the
 * list unchanged — a form read for nothing costs a call; a form skipped wrongly
 * costs a registration.
 */
function withoutUnchangedSharedResponseForms_(formIds, plan) {
  if (!sharedResponsesActive()) return formIds;
  try {
    const fullRead = dailyStepDue_(SHARED_RESPONSES_FULL_READ_STEP);
    const read = readSharedResponseCounts_({ withCells: fullRead });
    if (!read) return formIds;
    if (plan.windowOpenedAt) {
      writeChunkedJson_(SHARED_RESPONSE_OBSERVED_PROP_KEY, { window: plan.windowOpenedAt, counts: read.counts });
      plan.responseCountsObserved = true;
    }
    if (fullRead) {
      plan.responsesFullRead = true;
      if (read.cells > SHARED_RESPONSES_CELL_WARN) {
        noteForAdmin('The shared responses spreadsheet is filling up',
          `It holds about ${read.cells.toLocaleString()} cells of the 10,000,000 a spreadsheet may hold. ` +
          `Start a new one from 🔧 Admin ▸ ⚡ Start a New Responses Spreadsheet — nothing is lost; forms are ` +
          `re-pointed over the next few syncs and imported the usual way until they are.`);
      }
      return formIds;
    }
    const kept = formsWithResponseTabChanges_(formIds, readSharedResponseIndex_(), read.counts);
    const skipped = formIds.length - kept.length;
    if (skipped > 0) {
      log(`Registration sync: ${skipped} linked form(s) skipped — nothing was submitted to them since the ` +
        `last sync (their response tabs have not grown).`);
    }
    return kept;
  } catch (err) {
    log(`ℹ️ Could not read the shared responses spreadsheet (${err}) — every form is read the usual way.`);
    return formIds;
  }
}

/**
 * The window advanced the clock: the counts it saw at its opening are the new
 * baselines — except for a form whose read was refused, which keeps the old
 * one and so is read again next window. Never throws.
 */
function commitSharedResponseBaseline_(plan) {
  try {
    if (plan.responsesFullRead) recordDailyStepRun_(SHARED_RESPONSES_FULL_READ_STEP);
    if (!plan.responseCountsObserved) return;
    const observed = readChunkedJson_(SHARED_RESPONSE_OBSERVED_PROP_KEY);
    if (observed.window !== plan.windowOpenedAt || !observed.counts) return;
    const counts = observed.counts;
    const unread = plan.unreadFormIds || [];
    const index = readSharedResponseIndex_();
    let changed = false;
    Object.keys(counts).forEach(formId => {
      if (unread.indexOf(formId) !== -1) return;
      const entry = index[formId];
      if (!entry || entry.x) return;
      if (entry.n !== counts[formId]) { entry.n = counts[formId]; changed = true; }
    });
    if (changed) writeSharedResponseIndex_(index);
    writeChunkedJson_(SHARED_RESPONSE_OBSERVED_PROP_KEY, {});
  } catch (err) {
    log(`ℹ️ Could not record the response tabs' row counts (${err}) — the next sync reads every form.`);
  }
}

// ----------------------------------------------------------------------------
// The submit trigger
// ----------------------------------------------------------------------------

/**
 * INSTALLABLE onFormSubmit ON THE SHARED SPREADSHEET. Fires for a submission
 * (or an edited response) to any linked form. It takes NO lock and opens
 * nothing: it writes down which form, and arms the import. Everything that
 * could be slow or could collide with the desk happens in the import.
 */
function onSharedResponseSubmit(e) {
  try {
    if (!sharedResponsesActive()) return;
    let formId = '';
    try {
      const sheet = e && e.range && e.range.getSheet();
      if (sheet) {
        const index = readSharedResponseIndex_();
        const sid = String(sheet.getSheetId());
        Object.keys(index).forEach(id => {
          if (!formId && index[id] && !index[id].x && String(index[id].s) === sid) formId = id;
        });
        if (!formId) formId = formIdForResponseTab_(index, sheet.getFormUrl());
      }
    } catch (err) {
      formId = '';
    }
    queueSubmittedForm_(formId || RESPONSE_SUBMIT_UNKNOWN_FORM, Date.now());
    armInstantImport_(INSTANT_IMPORT_DELAY_MS, false);
  } catch (err) {
    // The hourly backstop reads this form anyway; a broken signal costs time.
    console.log(`⚠️ onSharedResponseSubmit: ${err}`);
  }
}

function queueSubmittedForm_(formId, atMs) {
  PropertiesService.getScriptProperties().setProperty(RESPONSE_SUBMIT_QUEUE_PREFIX + formId, String(atMs));
}

/** formId → ms of the latest submission noticed. */
function readSubmitQueue_() {
  const all = PropertiesService.getScriptProperties().getProperties() || {};
  const queue = {};
  Object.keys(all).forEach(key => {
    if (key.indexOf(RESPONSE_SUBMIT_QUEUE_PREFIX) !== 0) return;
    queue[key.slice(RESPONSE_SUBMIT_QUEUE_PREFIX.length)] = Number(all[key]) || 0;
  });
  return queue;
}

/**
 * Drops the entries a read has covered: an entry is covered when it was queued
 * no later than the moment that form's read began. Re-reads the property just
 * before deleting, so a submission that landed during the import survives.
 */
function dequeueSubmittedForms_(readStartedAt) {
  const props = PropertiesService.getScriptProperties();
  Object.keys(readStartedAt || {}).forEach(formId => {
    const key = RESPONSE_SUBMIT_QUEUE_PREFIX + formId;
    const queuedAt = Number(props.getProperty(key));
    if (!props.getProperty(key)) return;
    if (queuedAt <= readStartedAt[formId]) props.deleteProperty(key);
  });
}

function clearSubmitQueue_() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(readSubmitQueue_()).forEach(formId => props.deleteProperty(RESPONSE_SUBMIT_QUEUE_PREFIX + formId));
}

/**
 * One pending one-off import at a time. `force` replaces whatever is armed
 * (the runner re-arming itself); otherwise a fresh marker means a run is
 * already coming and will see this submission's queue entry.
 */
function armInstantImport_(delayMs, force) {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  const armedAt = Number(props.getProperty(INSTANT_IMPORT_ARMED_PROP_KEY)) || 0;
  if (!force && armedAt && now - armedAt < INSTANT_IMPORT_ARM_STALE_MS && now >= armedAt) return false;
  props.setProperty(INSTANT_IMPORT_ARMED_PROP_KEY, String(now));
  if (force) deleteSlicedJobResumeTriggers(INSTANT_IMPORT_HANDLER);
  ScriptApp.newTrigger(INSTANT_IMPORT_HANDLER).timeBased().after(delayMs).create();
  return true;
}

/**
 * The hourly trigger's safety net: a queue with nothing armed for it (a run
 * killed outright, a trigger that could not be created, a pause just lifted)
 * is armed again. Never throws; costs one property read when the feature is off.
 */
function kickInstantImportIfOwed_() {
  try {
    if (!sharedResponsesActive()) return false;
    if (Object.keys(readSubmitQueue_()).length === 0) return false;
    return armInstantImport_(INSTANT_IMPORT_DELAY_MS, false);
  } catch (err) {
    return false;
  }
}

// ----------------------------------------------------------------------------
// The instant import
// ----------------------------------------------------------------------------

/** Which forms the queue names, resolved against what the import knows how to read. */
function instantImportFormList_(queue, knownFormIds, markedFormIds) {
  const known = new Set(knownFormIds.concat(markedFormIds));
  let wanted = Object.keys(queue).filter(id => id !== RESPONSE_SUBMIT_UNKNOWN_FORM && known.has(id));
  const dropped = Object.keys(queue).filter(id => id !== RESPONSE_SUBMIT_UNKNOWN_FORM && !known.has(id));
  return { wanted, dropped, unknown: Object.prototype.hasOwnProperty.call(queue, RESPONSE_SUBMIT_UNKNOWN_FORM) };
}

/**
 * THE ONE-OFF TRIGGER'S HANDLER. The ordinary import, on the queued forms,
 * with the sync clock left exactly where it is. See the banner and
 * docs/transitions/R1_event_import.md §1 for the order of these steps and why
 * each one is where it is.
 */
function importSubmittedResponses() {
  // 1. Spent triggers out, the marker cleared, THEN the queue read: any
  // submission from here on either is in this read or arms the next run.
  try { deleteSlicedJobResumeTriggers(INSTANT_IMPORT_HANDLER); } catch (err) { /* lingering one-offs are harmless */ }
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(INSTANT_IMPORT_ARMED_PROP_KEY);

  if (!sharedResponsesActive()) return { skipped: 'off' };
  // Paused: the queue is kept, and the hourly trigger re-arms once unpaused.
  if (!automationGateAllows('Instant registration import', true)) return { skipped: 'paused' };
  if (isBootstrapActive() || isRegistrationSyncInFlight()) {
    // A periodic window or a sweep owns the session table; it may not cover
    // these responses (its list was fixed when it opened), so come back.
    armInstantImport_(INSTANT_IMPORT_DEFER_DELAY_MS, true);
    return { skipped: 'busy' };
  }

  const queue = readSubmitQueue_();
  if (Object.keys(queue).length === 0) return { skipped: 'empty' };

  const lock = workbookLock('Instant registration import');
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    armInstantImport_(INSTANT_IMPORT_BUSY_DELAY_MS, true);
    return { skipped: 'locked' };
  }

  let outcome = null;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const registrySheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    const knownFormIds = getDistinctFormIds(registrySheet);
    const list = instantImportFormList_(queue, knownFormIds, pendingBackfillFormIds());
    let formIds = list.wanted;
    if (list.unknown) {
      // A submission nobody could name: every linked form whose tab moved since
      // the last window, which certainly includes it.
      const index = readSharedResponseIndex_();
      const linked = knownFormIds.filter(id => index[id] && !index[id].x);
      let grown = linked;
      try {
        const read = readSharedResponseCounts_();
        grown = read ? formsWithResponseTabChanges_(linked, readSharedResponseIndex_(), read.counts) : linked;
      } catch (err) {
        grown = linked; // could not count: read every linked form, which certainly includes it
      }
      formIds = Array.from(new Set(formIds.concat(grown)));
    }
    // Forms no session row names and nobody marked: nothing could be built
    // from them. Their entries go.
    list.dropped.forEach(id => props.deleteProperty(RESPONSE_SUBMIT_QUEUE_PREFIX + id));
    if (formIds.length === 0) {
      if (list.unknown) props.deleteProperty(RESPONSE_SUBMIT_QUEUE_PREFIX + RESPONSE_SUBMIT_UNKNOWN_FORM);
      return { skipped: 'nothing to read' };
    }

    const startedAt = Date.now();
    const plan = {
      eventImport: true,
      startedAt,
      windowOpenedAt: new Date(startedAt).toISOString(),
      lastSync: getLastSyncTime().toISOString(),
      pendingFormIds: formIds.slice(),
      readStartedAt: {},
      formsRead: 0,
      importedRows: 0,
      importDone: false,
      tail: INSTANT_IMPORT_TAIL.slice(),
      problems: []
    };
    const budget = Math.min(getSyncSliceBudgetMs(), INSTANT_IMPORT_MAX_MS);
    log(`Instant registration import: ${formIds.length} form(s) with new submissions.`);
    runRegistrationSyncPhases_({ state: plan, deadline: startedAt + budget, save: () => {} });

    if (plan.registrantsWritten) {
      dequeueSubmittedForms_(plan.readStartedAt);
      if (list.unknown) props.deleteProperty(RESPONSE_SUBMIT_QUEUE_PREFIX + RESPONSE_SUBMIT_UNKNOWN_FORM);
    } else {
      // The rows did not land. The clock never moved, so the periodic sync
      // reads every one of these; retrying here every few minutes would only
      // repeat whatever failed. Said, and let go.
      dequeueSubmittedForms_(plan.readStartedAt);
      noteForAdmin('Instant registration import',
        `The Registrants tab could not be written after ${formIds.length} form(s) were read. Nothing is ` +
        `lost: the next scheduled sync reads the same responses again.`);
    }
    if (Object.keys(readSubmitQueue_()).length > 0) armInstantImport_(INSTANT_IMPORT_DELAY_MS, true);
    outcome = { imported: plan.importedRows || 0, forms: plan.formsRead || 0,
      remaining: (plan.pendingFormIds || []).length };
    log(`Instant registration import: ${outcome.imported} new row(s) from ${outcome.forms} form(s)` +
      (outcome.remaining ? `; ${outcome.remaining} form(s) left for a follow-up run.` : '.'));
  } catch (err) {
    log(`⚠️ Instant registration import failed (${err}) — the scheduled sync will read these responses.`);
    outcome = { error: String(err) };
  } finally {
    try { flushLedger(); } catch (err) { log(`⚠️ Instant import: ledger flush failed (${err}).`); }
    try { flushAdminDigest('Instant registration import'); } catch (err) { /* the digest is best effort */ }
    lock.releaseLock();
    try { flushDeskWritesAfterSync(); } catch (err) { /* its own trigger is the fallback */ }
  }
  if (outcome && outcome.imported > 0) warmQuickMarkAfterSync_();
  return outcome;
}

// ----------------------------------------------------------------------------
// Triggers
// ----------------------------------------------------------------------------

function installSharedResponseSubmitTrigger_(spreadsheetId) {
  return resetTriggersForHandler(SHARED_RESPONSE_SUBMIT_HANDLER, () =>
    ScriptApp.newTrigger(SHARED_RESPONSE_SUBMIT_HANDLER).forSpreadsheet(spreadsheetId).onFormSubmit().create());
}

function removeSharedResponseTriggers_() {
  return deleteSlicedJobResumeTriggers(SHARED_RESPONSE_SUBMIT_HANDLER) +
    deleteSlicedJobResumeTriggers(INSTANT_IMPORT_HANDLER);
}

/** writeTriggers() (`16`): the submit trigger is part of the set only while the switch is on. */
function writeSharedResponseTriggerIfOn_() {
  try {
    const id = sharedResponsesSpreadsheetId();
    if (!id) return 0;
    return installSharedResponseSubmitTrigger_(id);
  } catch (err) {
    log(`⚠️ Could not install the instant-import trigger (${err}) — registrations import on the schedule.`);
    return 0;
  }
}

// ----------------------------------------------------------------------------
// The menu
// ----------------------------------------------------------------------------

function createSharedResponsesSpreadsheet_(previousIds) {
  const year = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy');
  const ss = SpreadsheetApp.create(`Registration Responses ${year} (do not edit — read by the workbook)`);
  const id = ss.getId();
  try {
    const folder = getOrCreateSystemFolder(SHARED_RESPONSES_FOLDER_NAME, null, { systemOnly: true });
    moveDriveFileInto(DriveApp.getFileById(id), folder, 'the shared responses spreadsheet');
  } catch (err) {
    log(`ℹ️ The shared responses spreadsheet was made but could not be filed (${err}).`);
  }
  // NAMED EDITORS ONLY. It holds every registrant's name, phone and e-mail:
  // the link sharing the forms get would publish all of it.
  openUpFileToAnyoneWithLink(id, 'shared responses spreadsheet', { linkSharing: false });
  saveSharedResponsesState_({
    enabled: true,
    spreadsheetId: id,
    createdAt: new Date().toISOString(),
    createdBy: getCurrentUserEmail(),
    previous: previousIds || []
  });
  return id;
}

/** What the setup dialog says about where things stand. Pure over its inputs. */
function describeSharedResponsesStatus_(state, index, queue) {
  const entries = Object.keys(index).map(id => index[id]);
  const linked = entries.filter(e => e && !e.x);
  const mapped = linked.filter(e => e.s !== null && e.s !== undefined);
  const counted = mapped.filter(e => e.n !== null && e.n !== undefined);
  const elsewhere = entries.filter(e => e && e.x).length;
  const lines = [];
  lines.push(state.enabled ? 'Instant import is ON.' : 'Instant import is OFF — registrations import on the schedule.');
  if (state.spreadsheetId) {
    lines.push(`Responses spreadsheet: https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/edit`);
  }
  lines.push(`Forms linked: ${linked.length} (tabs found for ${mapped.length}, counted for ${counted.length}).`);
  if (elsewhere) lines.push(`Forms already sending to ANOTHER spreadsheet (left alone, imported the usual way): ${elsewhere}.`);
  lines.push(`Submissions waiting to be imported: ${Object.keys(queue).length}.`);
  return lines.join('\n');
}

/**
 * MENU: status, and the one switch. Turning it on makes the spreadsheet (once)
 * and the trigger; the hourly form repairs then link the forms, or
 * 🧭 Fix Forms In Place does it now. Turning it off removes the triggers and
 * the queue, and leaves the forms' destinations alone (harmless to every
 * version of this code).
 */
function showInstantImportSetup() {
  const ui = SpreadsheetApp.getUi();
  const state = getSharedResponsesState_();
  const status = describeSharedResponsesStatus_(state, readSharedResponseIndex_(), readSubmitQueue_());
  if (!state.enabled) {
    const answer = ui.alert('⚡ Instant Registration Import',
      `${status}\n\nTurn it on? A new registration then reaches the Registrants tab within a couple of minutes ` +
      `instead of up to ${REGISTRATION_SYNC_EVERY_HOURS} hours. Every form also starts copying its responses ` +
      `into one spreadsheet (kept private to the office), and the scheduled sync stops opening forms nobody ` +
      `has submitted to. Nothing already on the workbook changes.`, ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) return;
    if (!requireAuthorizedAdmin('Instant Registration Import')) return;
    if (!requireTriggerOwnership()) return;
    let id = state.spreadsheetId;
    let openable = false;
    if (id) { try { SpreadsheetApp.openById(id); openable = true; } catch (err) { openable = false; } }
    if (openable) {
      state.enabled = true;
      saveSharedResponsesState_(state);
    } else {
      id = createSharedResponsesSpreadsheet_(state.previous || []);
      clearSharedResponseIndex_();
      forgetResponseDestinationMigration_();
    }
    installSharedResponseSubmitTrigger_(id);
    log(`Instant registration import turned ON by ${getCurrentUserEmail()} (spreadsheet ${id}).`);
    ui.alert('⚡ Instant Registration Import',
      `On. The forms are linked by the hourly form repairs (up to ${MAX_FORM_MIGRATIONS_PER_RUN} an hour); ` +
      `to link them all now, run 🔧 Admin ▸ 🧭 Fix Forms In Place. Until a form is linked it is imported ` +
      `exactly as before.`, ui.ButtonSet.OK);
    return;
  }
  const answer = ui.alert('⚡ Instant Registration Import',
    `${status}\n\nTurn it OFF? Registrations go back to importing on the schedule; nothing already imported ` +
    `changes, and nothing waiting is lost (the scheduled sync reads it).`, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  if (!requireAuthorizedAdmin('Instant Registration Import')) return;
  turnOffInstantImport_();
  ui.alert('⚡ Instant Registration Import', 'Off. The scheduled sync reads every form again.', ui.ButtonSet.OK);
}

function turnOffInstantImport_() {
  const state = getSharedResponsesState_();
  state.enabled = false;
  saveSharedResponsesState_(state);
  const removed = removeSharedResponseTriggers_();
  clearSubmitQueue_();
  PropertiesService.getScriptProperties().deleteProperty(INSTANT_IMPORT_ARMED_PROP_KEY);
  log(`Instant registration import turned OFF by ${getCurrentUserEmail()} (${removed} trigger(s) removed).`);
}

/**
 * MENU: the yearly rollover. A new spreadsheet; the old one kept as a record
 * and named in `previous`, which is what lets the sweep re-point a form linked
 * to it. Until a form is re-pointed it is read the usual way.
 */
function startNewResponsesSpreadsheet() {
  const ui = SpreadsheetApp.getUi();
  const state = getSharedResponsesState_();
  if (!state.enabled || !state.spreadsheetId) {
    ui.alert('Start a New Responses Spreadsheet', 'Instant import is off — there is nothing to roll over.', ui.ButtonSet.OK);
    return;
  }
  const answer = ui.alert('Start a New Responses Spreadsheet',
    'A new responses spreadsheet is made and every live form is re-pointed to it over the next few syncs ' +
    '(each copies its past responses across). The current one is kept, untouched, as a record. ' +
    'Registrations keep importing throughout.', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  if (!requireAuthorizedAdmin('New Responses Spreadsheet')) return;
  if (!requireTriggerOwnership()) return;
  const lock = workbookLock('New responses spreadsheet');
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    explainRefusal('The workbook is in the middle of an update — try again in a few minutes.');
    return;
  }
  try {
    const previous = (state.previous || []).concat([state.spreadsheetId]);
    const id = createSharedResponsesSpreadsheet_(previous);
    clearSharedResponseIndex_();
    forgetResponseDestinationMigration_();
    installSharedResponseSubmitTrigger_(id);
    log(`New shared responses spreadsheet ${id}; the previous one (${state.spreadsheetId}) is kept.`);
  } finally {
    lock.releaseLock();
  }
  ui.alert('Start a New Responses Spreadsheet',
    'Done. Run 🔧 Admin ▸ 🧭 Fix Forms In Place to re-point the forms now, or let the hourly sync do it.',
    ui.ButtonSet.OK);
}
