/**
 * Persistent groupKey -> Form_ID map (Script Properties), so a group's
 * sessions can be temporarily removed (e.g. triaged away) without spawning
 * a duplicate form the next time it's seen. findExistingFormIdFromEvents()
 * is a further fallback recovering a form ID directly from a calendar
 * event's own description.
 */
const FORM_REGISTRY_PROP_KEY = 'FORM_REGISTRY_MAP_V1';

/**
 * Both persistent registries below are read once per execution and written
 * back at most once, via flushPersistentRegistries(). They used to
 * get+JSON.parse+stringify+set on EVERY entry — once per group in
 * syncCalendars(), and once per PERSON PER RESPONSE in
 * processAllDatesResponse(), which is the worst offender since a party of
 * four cost four full round trips to the property store. The flush is
 * called as soon as the loop that dirties them finishes (not at the very
 * end of the run) so the crash window stays about as small as it was.
 */
let __formRegistryCache = null;
let __formRegistryDirty = false;
let __allDatesRegistryCache = null;
let __allDatesRegistryDirty = false;

function getPersistentFormRegistry() {
  if (__formRegistryCache) return __formRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_REGISTRY_PROP_KEY);
  __formRegistryCache = raw ? JSON.parse(raw) : {};
  return __formRegistryCache;
}

function savePersistentFormRegistryEntry(groupKey, formId) {
  const registry = getPersistentFormRegistry();
  if (registry[groupKey] === formId) return;
  registry[groupKey] = formId;
  __formRegistryDirty = true;
}

/**
 * Persistent registry of "sign up for all dates" respondents, keyed by
 * Form_ID, so that when a Grouped-series form later gains NEW dates (the
 * series keeps running), syncRegistrations() can retroactively add rows
 * for those new dates for everyone who originally chose "all dates" —
 * otherwise "all dates" would silently only mean "all dates that existed
 * at the moment I registered."
 */
const ALL_DATES_REGISTRY_PROP_KEY = 'ALL_DATES_REGISTRANTS_V1';

function getAllDatesRegistry() {
  if (__allDatesRegistryCache) return __allDatesRegistryCache;
  const raw = PropertiesService.getScriptProperties().getProperty(ALL_DATES_REGISTRY_PROP_KEY);
  __allDatesRegistryCache = raw ? JSON.parse(raw) : {};
  return __allDatesRegistryCache;
}

function saveAllDatesRegistryEntry(formId, entry) {
  const registry = getAllDatesRegistry();
  if (!registry[formId]) registry[formId] = [];
  const key = `${normalizeNameKey(entry.name)}|${entry.personType}`;
  registry[formId] = registry[formId].filter(e => `${normalizeNameKey(e.name)}|${e.personType}` !== key);
  registry[formId].push(entry);
  __allDatesRegistryDirty = true;
}

/**
 * Which template version each LIVE (per-group) form was built from — the
 * thing that was missing when TEMPLATE_VERSION went to 3: bumping it rebuilt
 * the cached TEMPLATE, but every form already copied from an older one kept
 * its old questions, and those are the forms people actually fill in. See
 * migrateFormsToCurrentTemplate(), which reads this to know what it can skip
 * without an API call.
 */
const FORM_TEMPLATE_VERSION_PROP_KEY = 'FORM_TEMPLATE_VERSIONS_V1';

let __formTemplateVersionCache = null;
let __formTemplateVersionDirty = false;

function getFormTemplateVersions() {
  if (__formTemplateVersionCache) return __formTemplateVersionCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_TEMPLATE_VERSION_PROP_KEY);
  __formTemplateVersionCache = raw ? JSON.parse(raw) : {};
  return __formTemplateVersionCache;
}

function setFormTemplateVersion(formId, version) {
  const versions = getFormTemplateVersions();
  if (versions[formId] === version) return;
  versions[formId] = version;
  __formTemplateVersionDirty = true;
}

/** Writes back whichever persistent registries were actually modified. Safe to call repeatedly — a clean registry costs nothing. */
function flushPersistentRegistries() {
  const props = PropertiesService.getScriptProperties();
  if (__formRegistryDirty && __formRegistryCache) {
    props.setProperty(FORM_REGISTRY_PROP_KEY, JSON.stringify(__formRegistryCache));
    __formRegistryDirty = false;
  }
  if (__allDatesRegistryDirty && __allDatesRegistryCache) {
    props.setProperty(ALL_DATES_REGISTRY_PROP_KEY, JSON.stringify(__allDatesRegistryCache));
    __allDatesRegistryDirty = false;
  }
  if (__formLabelFingerprintDirty && __formLabelFingerprintCache) {
    props.setProperty(FORM_LABEL_FINGERPRINT_PROP_KEY, JSON.stringify(__formLabelFingerprintCache));
    __formLabelFingerprintDirty = false;
  }
  if (__instructorSheetRegistryDirty && __instructorSheetRegistryCache) {
    props.setProperty(INSTRUCTOR_SHEET_REGISTRY_PROP_KEY, JSON.stringify(__instructorSheetRegistryCache));
    __instructorSheetRegistryDirty = false;
  }
  if (__formTemplateVersionDirty && __formTemplateVersionCache) {
    props.setProperty(FORM_TEMPLATE_VERSION_PROP_KEY, JSON.stringify(__formTemplateVersionCache));
    __formTemplateVersionDirty = false;
  }
}

const SYNC_LOCK_WAIT_MS = 10 * 1000;

/**
 * How long a DESK action waits for the lock before giving up. Shorter than
 * SYNC_LOCK_WAIT_MS on purpose: somebody is standing at the counter with a
 * queue behind them, and a dialog that appears to hang for ten seconds reads
 * as broken. Three seconds is long enough to ride out the gap between two
 * background operations and short enough to answer "busy, press it again".
 */
const DESK_LOCK_WAIT_MS = 3 * 1000;

/**
 * Runs `fn` holding the script lock, and ALWAYS gives the lock back.
 *
 * Returns `fn`'s value, or `onBusy` (default null) if the lock could not be
 * taken in `waitMs`. The point is the `finally`: every long job in this file
 * used to open-code this, and the ones that hold the lock across a whole
 * multi-minute budget are exactly why the sign-in desk found Quick Mark
 * unavailable "half the time". Wrapping one unit of work at a time lets a
 * background sweep YIELD between forms instead of owning the workbook for
 * four and a half minutes at a stretch.
 */
function withScriptLock(waitMs, fn, onBusy) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(waitMs)) return onBusy === undefined ? null : onBusy;
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

