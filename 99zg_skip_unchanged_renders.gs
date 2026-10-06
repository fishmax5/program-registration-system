// ============================================================================
// 99zg. AN HOUR IN WHICH NOTHING CHANGED COSTS ALMOST NOTHING
// ============================================================================
//
// Most hourly registration syncs import nobody. They used to rewrite the
// Registrants tab anyway, redraw the session table and the month view, the
// lunch dashboard and the memory tabs, read every program calendar again to
// look for deleted events, and fold the whole registration ledger — each of
// them correct, and each of them producing exactly what was already there.
//
// Three tools, each the same bargain a fingerprint has made elsewhere in this
// project (`46`'s leader sheets, `10`'s form labels): say what the output is a
// function OF, remember it, and skip the work when it has not moved.
//
//   THE REGISTRANTS TAB (`registrantRenderUnchanged_`). `renderRegistrantsSheet`
//   hashes the rows it is about to write — after the superseded drop, the time
//   backfill and the link stamp, so the hash is of the OUTPUT — with today's
//   date, and every full render (any caller) records it. The sync then skips
//   its rewrite when the rows match. That is safe by construction: those rows
//   were READ from the tab this same run, so a hand edit, a desk patch or a
//   door insert made since the last render is in them and the hash differs.
//   Today's date is in the hash so the Upcoming/Past split still moves at
//   midnight, which also makes the first sync of every day a full render — the
//   backstop for anything cosmetic a patch writer left behind.
//
//   THE TAIL'S DASHBOARDS (`tailRenderUnchanged_` / `recordTailRender_`). Their
//   inputs are wider than the rows a sync holds — a staff tab, Config, a
//   registry — so the hash adds a WORKBOOK CHANGE GENERATION: bumped by every
//   `onEdit` (`18`) and by every write that drops the sectioned-row cache
//   (`08`) in any execution that is NOT this sync, i.e. the calendar sync, the
//   desk, the door, every dialog. Writes the sync makes itself are its own
//   outputs and are suppressed (`suppressWorkbookChangeGeneration_`), or no
//   hour would ever skip. What that cannot see — a derived cell one tail step
//   writes that an earlier one reads — is what TAIL_RENDER_MAX_AGE_MS is for:
//   no dashboard goes longer than that without a real redraw.
//
//   ONCE A DAY (`dailyStepDue_` / `recordDailyStepRun_`). Triage — the calendar
//   read that finds deleted events — already runs on every calendar sync and
//   every calendar-change trigger; the hourly registration sync now runs it
//   only if nothing has today. The ledger verifier reports to the NEXT day's
//   10am digest, so once a day says everything twenty-four did.
//
// Numbered after `99zf` for the usual reason. Behavior plus self-contained
// constants; everything it reaches for it reads at CALL time.
// ============================================================================

/** { stepId: 'yyyy-MM-dd' } — the last day each once-a-day step ran. */
const DAILY_STEP_RUNS_PROP_KEY = 'DAILY_STEP_RUNS_V1';

/** A number (ms timestamp) that moves whenever something outside the registration sync writes. */
const WORKBOOK_CHANGE_GENERATION_PROP_KEY = 'WORKBOOK_CHANGE_GENERATION_V1';

/** { stepId: { fp, at } } for the tail's skippable dashboards. */
const TAIL_RENDER_FINGERPRINTS_PROP_KEY = 'TAIL_RENDER_FINGERPRINTS_V1';

/** `${dayKey}|${hash}` of the rows the Registrants tab was last rendered from. */
const REGISTRANT_RENDER_FINGERPRINT_PROP_KEY = 'REGISTRANT_RENDER_FINGERPRINT_V1';

/** The longest a skippable dashboard goes without a real redraw. */
const TAIL_RENDER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

let __workbookChangeSuppressed = false;
let __workbookChangeBumped = false;

// --- the hash ----------------------------------------------------------------

/** MD5 of the JSON of `parts`, base64 — or '' when there is no way to hash. */
function fingerprintOf_(parts) {
  try {
    const text = JSON.stringify(parts);
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
    return Utilities.base64Encode(bytes);
  } catch (err) {
    return '';
  }
}

function todayKey_() {
  return formatDateKey(new Date());
}

function readJsonProperty_(key) {
  try {
    const parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeJsonProperty_(key, value) {
  try {
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(value));
  } catch (err) {
    log(`ℹ️ Could not save ${key} (${err}) — the next run simply does the work again.`);
  }
}

// --- once a day ----------------------------------------------------------------

function dailyStepDue_(stepId) {
  return readJsonProperty_(DAILY_STEP_RUNS_PROP_KEY)[stepId] !== todayKey_();
}

function recordDailyStepRun_(stepId) {
  const runs = readJsonProperty_(DAILY_STEP_RUNS_PROP_KEY);
  if (runs[stepId] === todayKey_()) return;
  runs[stepId] = todayKey_();
  writeJsonProperty_(DAILY_STEP_RUNS_PROP_KEY, runs);
}

// --- the workbook change generation -------------------------------------------

/**
 * Something outside the registration sync wrote to the workbook. One property
 * write per execution at most, and never from inside the sync itself. Never
 * throws: it is called from `onEdit` and from the cache invalidation every
 * writer goes through.
 */
function bumpWorkbookChangeGeneration_() {
  if (__workbookChangeSuppressed || __workbookChangeBumped) return;
  __workbookChangeBumped = true;
  try {
    PropertiesService.getScriptProperties()
      .setProperty(WORKBOOK_CHANGE_GENERATION_PROP_KEY, String(Date.now()));
  } catch (err) {
    // A generation that did not move costs a redraw at most TAIL_RENDER_MAX_AGE_MS late.
  }
}

/** Called by the registration sync for the length of its execution: its writes are its own outputs. */
function suppressWorkbookChangeGeneration_(on) {
  __workbookChangeSuppressed = on !== false;
}

function readWorkbookChangeGeneration_() {
  try {
    return PropertiesService.getScriptProperties().getProperty(WORKBOOK_CHANGE_GENERATION_PROP_KEY) || '';
  } catch (err) {
    return String(Date.now()); // unreadable: never matches, so nothing is skipped
  }
}

// --- the tail's dashboards ------------------------------------------------------

/**
 * The fingerprint a skippable tail step is judged by: its own inputs, today,
 * the change generation, and the two generated-file registries whose links
 * every dashboard stamps (`69`) — a sheet the sync itself just created must
 * reach the dashboards within the hour, and the sync's own writes do not move
 * the generation.
 */
function tailRenderFingerprint_(stepId, parts) {
  let registries = '';
  try {
    const props = PropertiesService.getScriptProperties();
    registries = [LEADER_SHEET_REGISTRY_PROP_KEY, SIGN_IN_SHEET_REGISTRY_PROP_KEY]
      .map(key => props.getProperty(key) || '').join('|');
  } catch (err) {
    registries = String(Date.now());
  }
  return fingerprintOf_([stepId, todayKey_(), readWorkbookChangeGeneration_(), registries, parts]);
}

/** True when `stepId` last drew exactly this, recently enough to trust. */
function tailRenderUnchanged_(stepId, fingerprint) {
  if (!fingerprint) return false;
  const stored = readJsonProperty_(TAIL_RENDER_FINGERPRINTS_PROP_KEY)[stepId];
  if (!stored || stored.fp !== fingerprint) return false;
  return Date.now() - Number(stored.at || 0) < TAIL_RENDER_MAX_AGE_MS;
}

function recordTailRender_(stepId, fingerprint) {
  if (!fingerprint) return;
  const all = readJsonProperty_(TAIL_RENDER_FINGERPRINTS_PROP_KEY);
  all[stepId] = { fp: fingerprint, at: Date.now() };
  writeJsonProperty_(TAIL_RENDER_FINGERPRINTS_PROP_KEY, all);
}

/**
 * Runs `draw` unless its fingerprint says it would draw what is already
 * there. `parts` is whatever the step's output is a function of beyond the
 * generation; `force` (a manual run) always draws. Returns what `draw`
 * returned, or `skipped` when it did not run.
 */
function runTailRenderUnlessUnchanged_(stepId, parts, draw, skipped) {
  const fingerprint = tailRenderFingerprint_(stepId, parts);
  if (tailRenderUnchanged_(stepId, fingerprint)) {
    log(`Registration sync: ${stepId} — nothing it is drawn from has changed; left as it is.`);
    return skipped;
  }
  const result = draw();
  recordTailRender_(stepId, fingerprint);
  return result;
}

// --- the Registrants tab --------------------------------------------------------

/** The fingerprint of the rows `renderRegistrantsSheet` is about to write, with today in it. */
function registrantRenderFingerprint_(rows) {
  const hash = fingerprintOf_([HEADERS.All_Registrants, rows]);
  return hash ? `${todayKey_()}|${hash}` : '';
}

function registrantRenderUnchanged_(fingerprint) {
  if (!fingerprint) return false;
  try {
    return PropertiesService.getScriptProperties().getProperty(REGISTRANT_RENDER_FINGERPRINT_PROP_KEY) === fingerprint;
  } catch (err) {
    return false;
  }
}

function recordRegistrantRenderFingerprint_(fingerprint) {
  try {
    const props = PropertiesService.getScriptProperties();
    if (fingerprint) props.setProperty(REGISTRANT_RENDER_FINGERPRINT_PROP_KEY, fingerprint);
    else props.deleteProperty(REGISTRANT_RENDER_FINGERPRINT_PROP_KEY);
  } catch (err) {
    // A fingerprint that was not saved costs one redundant render next hour.
  }
}
