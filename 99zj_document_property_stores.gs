// ============================================================================
// 99zj. THE STORES THAT OUTGREW SCRIPT PROPERTIES  (moved to the workbook's own)
// ============================================================================
// Script Properties is ONE store of about 500KB for the whole project, and a
// full one fails in whichever writer happens to run next. On 2026-10-09 that
// was the registration sync's own plan — a few hundred characters —
// `saveSlicedJobState` throwing "You have exceeded the property storage
// quota" before a single form was read. The report (99zd) showed the store at
// 512KB of ~500KB, and the plan had nothing to do with it: six stores keyed
// one entry per FORM, which only ever gain an entry (a Regular program takes
// a new form every month and every one is remembered), plus the door's boot
// snapshot.
//
// A bound script has a SECOND store with a quota of its own: Document
// Properties. Moving the per-form stores there is the cheapest relief that
// changes nothing about what they mean — same keys, same JSON, same readers,
// one store over. Pruning them would have been the other answer, and it is
// not a safe one: every hourly sweep (31, 68, 54, 55) walks every form on the
// session table, past ones included, and reads a missing entry as "never
// done" — a template version forgotten is a past form opened and rebuilt, a
// custom-question record forgotten is the questions added a second time.
//
// THE MOVE IS IN PLACE AND IDEMPOTENT. `moveStoresToDocumentProperties()`
// runs once per execution, before the first read or write of any of these
// keys and at the top of both syncs: a key still in Script Properties is
// copied across (unless the document already has one — the document wins) and
// then deleted. Deleting is what frees the space, and it always succeeds on a
// full store. The door's snapshot is not copied at all: it is a cache rebuilt
// every few minutes, so its old chunks are simply dropped.
//
// FAILING SAFE. Where Document Properties is unavailable (not bound, or a
// context that refuses it) everything falls back to Script Properties exactly
// as before. A document write that throws falls back too, after removing the
// document's copy — reads look in the document first, so a stale copy left
// there would shadow the newer one.
// ============================================================================

/** The keys that live in Document Properties. A function: every name is another file's constant (01a). */
function documentPropertyStoreKeys_() {
  return [
    ALL_DATES_REGISTRY_PROP_KEY,
    FORM_TEMPLATE_VERSION_PROP_KEY,
    FORM_LABEL_FINGERPRINT_PROP_KEY,
    FORM_STATE_MIGRATION_LEDGER_PROP_KEY,
    CUSTOM_QUESTIONS_PROP_KEY,
    FORM_DESCRIPTION_STATE_PROP_KEY
  ];
}

let __documentStoreProps = undefined;
let __documentStoresMoved = false;

/** Document Properties, or null where this execution cannot have them. */
function documentStoreProps_() {
  if (__documentStoreProps !== undefined) return __documentStoreProps;
  let props = null;
  try {
    props = (typeof PropertiesService.getDocumentProperties === 'function')
      ? PropertiesService.getDocumentProperties() : null;
  } catch (err) {
    props = null;
  }
  __documentStoreProps = props || null;
  return __documentStoreProps;
}

/**
 * Moves every listed key out of Script Properties, once per execution.
 * Never throws: a move that fails leaves the key where it was, and every
 * reader below still finds it there.
 */
function moveStoresToDocumentProperties() {
  if (__documentStoresMoved) return;
  __documentStoresMoved = true;
  const doc = documentStoreProps_();
  let script;
  try { script = PropertiesService.getScriptProperties(); } catch (err) { return; }
  let present;
  try { present = script.getKeys(); } catch (err) { return; }
  const has = {};
  (present || []).forEach(k => { has[k] = true; });

  if (doc) {
    documentPropertyStoreKeys_().forEach(key => {
      if (!has[key]) return;
      try {
        const value = script.getProperty(key);
        if (value !== null && value !== undefined && doc.getProperty(key) === null) {
          doc.setProperty(key, value);
        }
        script.deleteProperty(key);
        log(`ℹ️ Moved ${key} (${String(value || '').length} chars) from Script Properties to ` +
          `the workbook's Document Properties (99zj).`);
      } catch (err) {
        log(`⚠️ Could not move ${key} to Document Properties (${err}) — it stays in Script Properties.`);
      }
    });
  }

  // The door's boot snapshot: a cache, so its Script Properties chunks are
  // dropped rather than copied. The next warm writes it where it lives now.
  const walkIn = (typeof WALK_IN_DAY_STORE_PROP_KEY === 'string') ? WALK_IN_DAY_STORE_PROP_KEY : '';
  if (doc && walkIn && has[walkIn]) {
    (present || []).forEach(k => {
      if (k !== walkIn && k.indexOf(walkIn + '_') !== 0) return;
      try { script.deleteProperty(k); } catch (err) { /* left for the next run */ }
    });
  }
}

/** The stored text, document first, then Script Properties (a key not moved yet). */
function readDocumentStoreProperty(key) {
  moveStoresToDocumentProperties();
  const doc = documentStoreProps_();
  if (doc) {
    try {
      const value = doc.getProperty(key);
      if (value !== null && value !== undefined) return value;
    } catch (err) { /* fall through to the old home */ }
  }
  return PropertiesService.getScriptProperties().getProperty(key);
}

/** Writes the text where it lives now. Throws only if both stores refuse it. */
function writeDocumentStoreProperty(key, value) {
  moveStoresToDocumentProperties();
  const doc = documentStoreProps_();
  if (doc) {
    try {
      doc.setProperty(key, value);
      return;
    } catch (err) {
      log(`⚠️ Could not write ${key} to Document Properties (${err}) — writing it to Script Properties.`);
      try { doc.deleteProperty(key); } catch (e) { /* a copy that will not delete is still read first */ }
    }
  }
  PropertiesService.getScriptProperties().setProperty(key, value);
}

/** Removes the key from both stores. */
function deleteDocumentStoreProperty(key) {
  moveStoresToDocumentProperties();
  const doc = documentStoreProps_();
  if (doc) {
    try { doc.deleteProperty(key); } catch (err) { /* nothing to remove */ }
  }
  try { PropertiesService.getScriptProperties().deleteProperty(key); } catch (err) { /* ditto */ }
}

/** The props object the door's chunked snapshot is kept in (64). */
function walkInDayStoreProps_() {
  return documentStoreProps_() || tryGetScriptProperties();
}
