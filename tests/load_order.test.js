// LOAD ORDER MUST NOT MATTER (see 01a_lazy_globals.gs).
//
// Every `.gs` file is one script in one shared global scope, and the Apps
// Script project evaluates them in whatever order IT has them stored. The
// numeric prefixes ask for filename order; nothing enforces it. A GitHub-sync
// extension that writes files back most-recently-edited-first is enough to
// evaluate `03_sheets_and_headers` before `02_palette_and_tags` — which, while
// the derived constants were eager `const`s, threw
//
//     ReferenceError: PALETTE is not defined
//
// on open, for every user, before a single menu was drawn.
//
// So this file does not test a feature. It tests the property that made that
// failure impossible: the project loads, and every derived global reads back
// the same value, NO MATTER WHAT ORDER THE FILES ARE IN. Reverse order is the
// worst case (every dependency lands after its dependent); the shuffles are
// there to catch a new eager constant whose one bad ordering reverse happens
// to miss.
//
// A failure here is not a broken test — it is a top-level `const` somewhere
// reading another file's constant at load time. Wrap it in defineLazyGlobal_.
const vm = require('vm');
const { sourceFiles } = require('./helpers/source');
const fs = require('fs');

let fail = 0;
function ok(name, cond) {
  if (cond) console.log('ok   ' + name);
  else { fail++; console.log('FAIL ' + name); }
}

// The globals that are derived from another file's constants — the ones that
// used to be load-order landmines. Each is read back and compared.
const DERIVED_GLOBALS = [
  'PROGRAM_FLAG_COLUMNS', 'LOCATION_COLOR_MAP', 'HEADERS', 'TEMPLATE_ITEM_TITLES',
  'LUNCH_ONLY_TYPE_TAG', 'TAB_GROUPS', 'TYPO', 'RECOGNIZED_TAG_PATTERNS',
  'DESCRIPTION_TAG_READERS', 'REGISTRATION_NOT_OPEN_NOTICE_PATTERNS',
  'REGISTRANT_EDITABLE_COLUMNS', 'LEADER_SHEET_BAND_BG', 'LEADER_SHEET_BAND_INK',
  'PROGRAM_FORM_TYPES', 'REGISTRATION_ANCHOR_REGEX_GLOBAL', 'DOOR_ROUTES',
  'STRAY_FILE_PATTERNS'
];

/** Just enough Apps Script for the project to finish evaluating. */
function stubs() {
  return {
    console: { log: () => {} },
    Utilities: {
      formatDate: () => '', getUuid: () => 'x', sleep: () => {},
      computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' },
      newBlob: d => ({ getBytes: () => d, getDataAsString: () => String(d) }),
      gzip: b => b, ungzip: b => b,
      base64Encode: b => String(b), base64Decode: t => String(t)
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null, setProperty: () => {},
        setProperties: () => {}, deleteProperty: () => {}
      })
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => null },
    Session: {
      getScriptTimeZone: () => 'America/New_York',
      getEffectiveUser: () => ({ getEmail: () => 'a@b.c' })
    },
    FormApp: { ItemType: {} },
    MimeType: {
      GOOGLE_FORMS: 'application/vnd.google-apps.form',
      GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
      GOOGLE_DOCS: 'application/vnd.google-apps.document'
    },
    CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
    ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {},
    Calendar: {}, CacheService: {}
  };
}

/**
 * Evaluate the project with its files in `order`, then read every derived
 * global back out. Returns them JSON-shaped so two orders can be compared.
 */
function loadInOrder(order) {
  const src = order.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const sandbox = stubs();
  vm.createContext(sandbox);
  // Reading through globalThis is the point: after the refactor these names
  // are lazy properties, so this is also what proves the getters fire.
  const lift = DERIVED_GLOBALS
    .map(n => `this[${JSON.stringify('__' + n)}] = ${n};`).join('');
  vm.runInContext(src + ';' + lift, sandbox, { filename: 'program.gs' });
  const out = {};
  for (const n of DERIVED_GLOBALS) out[n] = sandbox['__' + n];
  return out;
}

/** Regexes and functions do not survive JSON, so compare them by source text. */
function shape(value) {
  return JSON.stringify(value, (k, v) => {
    if (v instanceof RegExp) return 'RegExp:' + v.toString();
    if (typeof v === 'function') return 'fn:' + v.name;
    return v;
  });
}

const canonical = sourceFiles();

// 1. Filename order — what the runtime is SUPPOSED to give us — is the baseline.
let baseline = null;
try {
  baseline = loadInOrder(canonical);
  ok('the project loads in filename order', true);
} catch (e) {
  ok('the project loads in filename order — ' + e.message, false);
}

// 2. Reverse order. Every dependency now evaluates after its dependent; before
//    the lazy-globals refactor this threw on the very first derived constant.
if (baseline) {
  try {
    const reversed = loadInOrder(canonical.slice().reverse());
    ok('the project loads in REVERSE filename order', true);
    for (const n of DERIVED_GLOBALS) {
      ok(`${n} is identical under reverse order`, shape(reversed[n]) === shape(baseline[n]));
    }
  } catch (e) {
    ok('the project loads in REVERSE filename order — ' + e.message, false);
  }
}

// 3. Shuffles, seeded so a failure is reproducible rather than a Tuesday.
function shuffled(list, seed) {
  const copy = list.slice();
  let s = seed;
  const rand = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

let shufflesPassed = 0;
if (baseline) {
  for (let seed = 1; seed <= 60; seed++) {
    try {
      const got = loadInOrder(shuffled(canonical, seed));
      const same = DERIVED_GLOBALS.every(n => shape(got[n]) === shape(baseline[n]));
      if (!same) ok(`shuffle #${seed}: a derived global differs`, false);
      else shufflesPassed++;
    } catch (e) {
      ok(`shuffle #${seed} loads — ${e.message}`, false);
    }
  }
}

ok('60 shuffled load orders all agree with filename order', shufflesPassed === 60);

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
