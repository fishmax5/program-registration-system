// THE STORES THAT OUTGREW SCRIPT PROPERTIES (section 99zj).
//
//   THE MOVE FREES THE SPACE: the per-form stores leave Script Properties for
//   Document Properties, values intact, and the door's snapshot chunks are
//   dropped rather than copied.
//
//   IT HAPPENS BEFORE THE PLAN: saveSlicedJobState makes room before it
//   writes, so a store that filled up on the per-form keys no longer refuses
//   the sync's plan — the 2026-10-09 failure.
//
//   READERS FIND THE VALUE either side of the move, a document copy wins over
//   a stale script one, and a document write that throws lands in Script
//   Properties without leaving an old copy to shadow it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

function fakeStore(quotaChars, opts) {
  const data = {};
  const size = () => Object.keys(data).reduce((n, k) => n + k.length + String(data[k]).length, 0);
  return {
    data,
    getProperty: key => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setProperty: (key, value) => {
      if (opts && opts.refuse) throw new Error('refused');
      const before = data[key];
      data[key] = String(value);
      if (quotaChars && size() > quotaChars) {
        if (before === undefined) delete data[key]; else data[key] = before;
        throw new Error('You have exceeded the property storage quota.');
      }
    },
    deleteProperty: key => { delete data[key]; },
    getKeys: () => Object.keys(data),
    getProperties: () => Object.assign({}, data)
  };
}

function load(script, doc) {
  const sandbox = {
    console: { log: () => {} },
    Utilities: { formatDate: () => '2026-10-09', sleep: () => {} },
    PropertiesService: {
      getScriptProperties: () => script,
      getDocumentProperties: doc === undefined ? undefined : () => doc
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
    FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
    Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
    ScriptApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: null, MailApp: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(src + `
;this.saveSlicedJobState = saveSlicedJobState;
this.getFormTemplateVersions = getFormTemplateVersions;
this.setFormTemplateVersion = setFormTemplateVersion;
this.flushPersistentRegistries = flushPersistentRegistries;
this.getAppliedCustomQuestions = getAppliedCustomQuestions;
this.readDocumentStoreProperty = readDocumentStoreProperty;
this.writeDocumentStoreProperty = writeDocumentStoreProperty;
this.renewWorkbookLease = function () {};
this.flushLedger = function () {};
this.log = function () {};
`, sandbox, { filename: 'program.gs' });
  return sandbox;
}

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
}

// --- The 2026-10-09 shape: a full Script Properties refuses the plan --------
{
  const big = 'x'.repeat(4000);
  const script = fakeStore(20000);
  script.data.FORM_TEMPLATE_VERSIONS_V1 = JSON.stringify({ f1: 9, pad: big });
  script.data.CUSTOM_FORM_QUESTIONS_V1 = JSON.stringify({ f1: { titles: ['Allergies'] }, pad: big });
  script.data.FORM_LABEL_FINGERPRINTS_V1 = JSON.stringify({ f1: 'abc', pad: big });
  script.data.WALK_IN_DAY_STORE_V1 = JSON.stringify({ chunks: 1 });
  script.data.WALK_IN_DAY_STORE_V1_0 = big;
  script.data.FORM_REGISTRY_MAP_V1 = JSON.stringify({ g: 'f1' });
  script.data.UNRELATED_V1 = 'stays';
  const doc = fakeStore(500000);
  const s = load(script, doc);

  let threw = null;
  try { s.saveSlicedJobState('REGISTRATION_SYNC_PLAN_V1', { pendingFormIds: ['f1'], pad: 'y'.repeat(3000) }); }
  catch (err) { threw = String(err); }
  check('the plan saves once the per-form stores have moved', threw, null);
  check('the plan is in Script Properties', !!script.data.REGISTRATION_SYNC_PLAN_V1, true);
  check('the per-form stores left Script Properties',
    ['FORM_TEMPLATE_VERSIONS_V1', 'CUSTOM_FORM_QUESTIONS_V1', 'FORM_LABEL_FINGERPRINTS_V1']
      .filter(k => k in script.data), []);
  check('…and arrived intact in Document Properties',
    JSON.parse(doc.data.FORM_TEMPLATE_VERSIONS_V1).f1, 9);
  check('the door snapshot chunks are dropped, not copied',
    ['WALK_IN_DAY_STORE_V1', 'WALK_IN_DAY_STORE_V1_0'].filter(k => k in script.data || k in doc.data), []);
  check('the form registry and everything else stay where they were',
    [script.data.FORM_REGISTRY_MAP_V1, script.data.UNRELATED_V1], [JSON.stringify({ g: 'f1' }), 'stays']);
  check('readers find the moved values', s.getFormTemplateVersions().f1, 9);
  check('…the custom questions too', s.getAppliedCustomQuestions().f1.titles, ['Allergies']);

  s.setFormTemplateVersion('f2', 9);
  s.flushPersistentRegistries();
  check('a write lands in Document Properties', JSON.parse(doc.data.FORM_TEMPLATE_VERSIONS_V1).f2, 9);
  check('…and not back in Script Properties', 'FORM_TEMPLATE_VERSIONS_V1' in script.data, false);
}

// --- A document copy wins over a stale script one, which is then removed ----
{
  const script = fakeStore();
  script.data.FORM_DESCRIPTION_STATE_V1 = '{"old":1}';
  const doc = fakeStore();
  doc.data.FORM_DESCRIPTION_STATE_V1 = '{"new":1}';
  const s = load(script, doc);
  check('the document copy is read', s.readDocumentStoreProperty('FORM_DESCRIPTION_STATE_V1'), '{"new":1}');
  check('the stale script copy is deleted', 'FORM_DESCRIPTION_STATE_V1' in script.data, false);
}

// --- A document store that refuses: the write still lands, unshadowed -------
{
  const script = fakeStore();
  const doc = fakeStore(0, { refuse: true });
  doc.data.FORM_STATE_MIGRATIONS_V1 = '{"stale":1}';
  const s = load(script, doc);
  s.writeDocumentStoreProperty('FORM_STATE_MIGRATIONS_V1', '{"fresh":1}');
  check('a refused document write lands in Script Properties', script.data.FORM_STATE_MIGRATIONS_V1, '{"fresh":1}');
  check('…and the stale document copy no longer shadows it',
    s.readDocumentStoreProperty('FORM_STATE_MIGRATIONS_V1'), '{"fresh":1}');
}

// --- No Document Properties at all: everything as before --------------------
{
  const script = fakeStore();
  script.data.FORM_TEMPLATE_VERSIONS_V1 = '{"f1":9}';
  const s = load(script, undefined);
  check('without Document Properties the store stays put', s.getFormTemplateVersions().f1, 9);
  s.saveSlicedJobState('REGISTRATION_SYNC_PLAN_V1', { a: 1 });
  check('…and nothing is moved', 'FORM_TEMPLATE_VERSIONS_V1' in script.data, true);
}

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall document property store checks passed');
