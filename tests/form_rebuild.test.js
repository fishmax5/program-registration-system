// replaceOneForm() reports how many sessions it moved AFTER the swap is done,
// in a log line that sits below the try/catch guarding the swap. When the
// count was declared with `const` inside that try block, the name was gone by
// the time the log line read it, and the whole rebuild — a form built, the
// sessions repointed, the registries carried across, the old form trashed —
// ended in "ReferenceError: moved is not defined". The caller could only
// report that as a failed rebuild ("it was left exactly as it was"), which was
// the opposite of what had happened: the swap HAD completed.
//
// So the two things worth pinning are that a good rebuild returns true, and
// that the "moved no session rows" bail-out still trashes the new form.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const logs = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => d.toISOString(),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => payload,
    DigestAlgorithm: { MD5: 'MD5' },
    Charset: { UTF_8: 'UTF-8' },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: { PAGE_BREAK: 'PAGE_BREAK', PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: {
    getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 'test@example.com' })
  },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.replaceOneForm = replaceOneForm;
this.migrateFormsToCurrentTemplate = migrateFormsToCurrentTemplate;
this.TEMPLATE_VERSION = TEMPLATE_VERSION;
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const trashed = [];
// The collaborators replaceOneForm() leans on, each reduced to the one answer
// this test needs. They are plain function declarations in Code.gs, so
// reassigning them on the sandbox is what the call sites see.
function stub(movedCount) {
  logs.length = 0;
  trashed.length = 0;
  sandbox.log = msg => logs.push(String(msg));
  sandbox.noteForAdmin = () => {};
  sandbox.readFormTitleOrDerive = () => 'Walking Club (Narberth)';
  sandbox.createFormFromSpec = () => ({ formId: 'NEW_FORM' });
  sandbox.writeFormIdOntoSessions = () => movedCount;
  sandbox.remapFormRegistries = () => {};
  sandbox.trashReplacedForm = id => trashed.push(id);
  sandbox.DriveApp.getFileById = id => ({ setTrashed: () => trashed.push(id) });
}

const item = {
  oldFormId: 'OLD_FORM',
  describe: 'Walking Club (Narberth)',
  eventIds: ['e1', 'e2', 'e3'],
  context: { titles: ['Walking Club'], locations: ['Narberth'] }
};

// 1. The ordinary rebuild: it completes, and it says so.
stub(3);
check('a completed rebuild returns true', sandbox.replaceOneForm({}, item), true);
check('the old form is the one trashed', trashed, ['OLD_FORM']);
check('the count survives to the success log',
  logs.some(l => l.indexOf('Rebuilt Walking Club (Narberth): 3 session(s) moved') === 0), true);

// 2. The bail-out: nothing was repointed, so the NEW form goes in the trash
//    and the old one is left alone.
stub(0);
check('a rebuild that moved nothing returns false', sandbox.replaceOneForm({}, item), false);
check('the new form is the one trashed', trashed, ['NEW_FORM']);



// ---------------------------------------------------------------------------
// migrateFormsToCurrentTemplate() options — the three things
// rebuildAllFormsInPlace() needs it to do that the hourly sync does not:
// rebuild a form that already looks current, stay inside the list of forms the
// person agreed to, and stop when the click's time budget is gone.
// ---------------------------------------------------------------------------

const rebuiltForms = [];
// Everything migrateFormsToCurrentTemplate() reaches for, reduced to the one
// answer these cases need. Both forms below are ALREADY on the current
// template and stamped as such — the state the hourly sync skips outright.
function stubMigration() {
  rebuiltForms.length = 0;
  sandbox.log = () => {};
  sandbox.noteForAdmin = () => {};
  sandbox.groupRegistryRowsByForm = () => ({ FORM_A: [{}], FORM_B: [{}] });
  sandbox.getFormTemplateVersions = () => ({ FORM_A: sandbox.TEMPLATE_VERSION, FORM_B: sandbox.TEMPLATE_VERSION });
  sandbox.getSharedFormIdSet = () => new Set();
  sandbox.FormApp.openById = id => ({ getId: () => id, getTitle: () => id });
  sandbox.isFormOnCurrentTemplate = () => true;
  sandbox.buildFormSessionContext = formId => ({ formId, sessions: [{}], locations: ['Narberth'], titles: ['X'] });
  sandbox.describeLocations = () => 'Narberth';
  sandbox.withFormRetry = (what, fn) => fn();
  sandbox.rebuildFormFromCurrentTemplate = form => rebuiltForms.push(form.getId());
  sandbox.setFormTemplateVersion = () => {};
  sandbox.buildRegistrationUrl = () => 'https://example.test/form';
  sandbox.updateRegistryFormLinks = () => {};
  sandbox.flushPersistentRegistries = () => {};
}

// The hourly sync's own call: both forms are stamped current, so neither is
// even opened. This is the skip that makes the steady state free.
stubMigration();
check('no options rebuilds nothing already current', sandbox.migrateFormsToCurrentTemplate({}, [{}]), 0);

// force: rebuild them anyway. A form hand-edited within the template's shape
// looks current to both skips, and is exactly what this reaches.
stubMigration();
check('force rebuilds a form that looks current', sandbox.migrateFormsToCurrentTemplate({}, [{}], { force: true }), 2);
check('force rebuilt both forms', rebuiltForms.sort(), ['FORM_A', 'FORM_B']);

// onlyFormIds: the person confirmed a list, and nothing outside it is touched.
stubMigration();
sandbox.migrateFormsToCurrentTemplate({}, [{}], { force: true, onlyFormIds: new Set(['FORM_B']) });
check('onlyFormIds stays inside the confirmed list', rebuiltForms, ['FORM_B']);

// limit and deadline: one run does what it can and leaves the rest.
stubMigration();
check('limit caps one run', sandbox.migrateFormsToCurrentTemplate({}, [{}], { force: true, limit: 1 }), 1);
stubMigration();
check('a deadline already past rebuilds nothing',
  sandbox.migrateFormsToCurrentTemplate({}, [{}], { force: true, deadline: Date.now() - 1 }), 0);

console.log(failures === 0 ? '\nAll form-rebuild checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
