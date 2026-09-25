// FORMS THAT WILL NOT OPEN (99s_unopenable_forms.gs).
//
// Pins: the inventory (every store, the folder, the session rows split
// upcoming/past per program), the swap candidates and their default (the next
// session's form, only if it opens), the purge of both store shapes, the probe
// handing back what its budget did not reach, the server re-probe refusing a
// form that opens now, the purge leaving rows alone unless asked, the gate, and
// a program titled "</script>" not ending the page.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const store = {};
const DEAD = new Set(['deadAAAAAAAAAAAAAAAAAAAA', 'deadBBBBBBBBBBBBBBBBBBBB']);
let probes = 0;

const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    computeDigest: (a, raw) => Array.from(require('crypto').createHash('md5').update(String(raw)).digest()),
    DigestAlgorithm: { MD5: 'MD5' }, sleep: () => {}, Charset: { UTF_8: 'UTF-8' }
  },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in store ? store[k] : null),
    setProperty: (k, v) => { store[k] = v; },
    deleteProperty: k => { delete store[k]; }
  }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => (sandbox.__ssReady ? { getSheetByName: () => null } : null), getActive: () => null },
  FormApp: {
    ItemType: {},
    openById: id => {
      probes++;
      if (DEAD.has(id)) throw new Error('No item with the given ID could be found.');
      return { getTitle: () => `Form ${id.slice(0, 4)}` };
    }
  },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, Calendar: {}, CacheService: {},
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }), getActiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}
};
vm.createContext(sandbox);
vm.runInContext((src + `
;this.buildUnopenableFormInventory_ = buildUnopenableFormInventory_;
this.swapCandidatesFor_ = swapCandidatesFor_;
this.purgeFormIdFromStore_ = purgeFormIdFromStore_;
this.probeFormsForUnopenableReview = probeFormsForUnopenableReview;
this.swapUnopenableForms = swapUnopenableForms;
this.purgeUnopenableForms = purgeUnopenableForms;
this.buildUnopenableFormsHtml = buildUnopenableFormsHtml;
this.ADMIN_GATED_ACTIONS = ADMIN_GATED_ACTIONS;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.FORM_REGISTRY_PROP_KEY = FORM_REGISTRY_PROP_KEY;
this.REGISTRATION_BACKFILL_PROP_KEY = REGISTRATION_BACKFILL_PROP_KEY;
this.FORM_TEMPLATE_VERSION_PROP_KEY = FORM_TEMPLATE_VERSION_PROP_KEY;
this.setBudget = ms => { UNOPENABLE_FORMS_PROBE_BUDGET_MS = ms; };
isAuthorizedAdmin = () => this.__admin;
`).replace('const UNOPENABLE_FORMS_PROBE_BUDGET_MS', 'var UNOPENABLE_FORMS_PROBE_BUDGET_MS'), sandbox, { filename: 'project.gs' });
sandbox.__admin = true;
sandbox.__ssReady = true;

let failures = 0;
function ok(name, cond, extra) {
  if (cond) console.log(`ok   ${name}`);
  else { failures++; console.log(`FAIL ${name}${extra ? '\n  ' + extra : ''}`); }
}

const headers = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(headers);
function row(date, title, loc, formId, eventId) {
  const r = headers.map(() => '');
  r[map.Event_Date] = new Date(date + 'T12:00:00');
  r[map.Clean_Title] = title; r[map.Location] = loc; r[map.Calendar_Source] = 'cal1';
  r[map.Form_ID] = formId; r[map.Event_ID] = eventId;
  return r;
}
const A = 'deadAAAAAAAAAAAAAAAAAAAA', B = 'deadBBBBBBBBBBBBBBBBBBBB';
const LIVE1 = 'live1111111111111111111111', LIVE2 = 'live2222222222222222222222';
const rows = [
  row('2026-09-01', 'Chair Yoga', 'Ashbridge', A, 'e1'),
  row('2026-10-06', 'Chair Yoga', 'Ashbridge', A, 'e2'),
  row('2026-10-13', 'Chair Yoga', 'Ashbridge', A, 'e3'),
  row('2026-10-20', 'Chair Yoga', 'Ashbridge', LIVE2, 'e4'),
  row('2026-08-04', 'Chair Yoga', 'Ashbridge', LIVE1, 'e0'),
  row('2026-08-11', 'Chair Yoga', 'Ashbridge', LIVE1, 'e00'),
  row('2026-10-01', 'Bingo', 'Narberth', LIVE1, 'b1')
];
const stores = [
  { label: 'Form registry (group → form)', shape: 'values', data: { 'k1': A, 'k2': LIVE1 } },
  { label: 'Template versions', shape: 'keys', data: { [B]: 9, [LIVE1]: 9 } },
  { label: 'Broken store', shape: 'keys', data: null }
];
const inv = sandbox.buildUnopenableFormInventory_(rows, map, stores, [LIVE2, 'folderOnly00000000000000'], '2026-09-24');

ok('every store, the folder and the table contribute ids',
  Object.keys(inv.forms).sort().join(',') === [A, B, LIVE1, LIVE2, 'folderOnly00000000000000'].sort().join(','),
  Object.keys(inv.forms).join(','));
ok('a dead form lists which stores hold it',
  inv.forms[A].stores.join('|') === 'Form registry (group → form)|Session table', inv.forms[A].stores.join('|'));
ok('a form no row names is still listed, from its store alone',
  inv.forms[B].stores.join('|') === 'Template versions' && inv.forms[B].sessions.length === 0);
ok('sessions split upcoming vs past', inv.forms[A].upcoming === 2 && inv.forms[A].past === 1);
ok('sessions sorted by date', inv.forms[A].sessions.map(s => s.eventId).join(',') === 'e1,e2,e3');
ok('the program the dead form sits on is named', inv.forms[A].programKeys.join() === 'cal1|Chair Yoga');

const opens = { [A]: false, [B]: false, [LIVE1]: true, [LIVE2]: true };
let c = sandbox.swapCandidatesFor_(A, inv, opens);
ok('candidates are the program\'s other forms that open', c.candidates.slice().sort().join() === [LIVE1, LIVE2].sort().join());
ok('default is the most-used candidate when the next session is on the dead form itself', c.defaultId === LIVE1, c.defaultId);
// Move the next upcoming session onto LIVE2: that is now the link in circulation.
const inv2 = sandbox.buildUnopenableFormInventory_(
  rows.concat([row('2026-09-30', 'Chair Yoga', 'Ashbridge', LIVE2, 'e5')]), map, stores, [], '2026-09-24');
c = sandbox.swapCandidatesFor_(A, inv2, opens);
ok('default is the next upcoming session\'s form when it opens', c.defaultId === LIVE2, c.defaultId);
c = sandbox.swapCandidatesFor_(A, inv2, Object.assign({}, opens, { [LIVE2]: false }));
ok('a candidate that does not open is never offered', c.candidates.join() === LIVE1 && c.defaultId === LIVE1);
c = sandbox.swapCandidatesFor_(B, inv, opens);
ok('a form with no sessions has no candidates', c.candidates.length === 0 && c.defaultId === '');

const reg = { k1: A, k2: LIVE1, k3: A };
ok('purge by value removes every entry naming it', sandbox.purgeFormIdFromStore_(reg, 'values', A) === 2 && Object.keys(reg).join() === 'k2');
const keyed = { [A]: 1, [LIVE1]: 2 };
ok('purge by key removes the key', sandbox.purgeFormIdFromStore_(keyed, 'keys', A) === 1 && !(A in keyed));
ok('purge of a null store is a no-op', sandbox.purgeFormIdFromStore_(null, 'keys', A) === 0);

// Probing: each form once, a failure reported rather than thrown, and a spent
// budget handing the rest back.
let res = sandbox.probeFormsForUnopenableReview([A, LIVE1]);
ok('a dead form probes as not opening, with its error', res.results[A].opens === false && /could be found/.test(res.results[A].error), JSON.stringify(res.results[A]));
ok('a live form probes as opening, with its title', res.results[LIVE1].opens === true && res.results[LIVE1].title === 'Form live');
sandbox.setBudget(-1);
res = sandbox.probeFormsForUnopenableReview([A, LIVE1, LIVE2]);
ok('a spent budget still probes one, and hands back the rest', Object.keys(res.results).length === 1 && res.remaining.join() === [LIVE1, LIVE2].join());
sandbox.setBudget(20000);

// Purge through the real entry point, against the stubbed Script Properties.
store[sandbox.FORM_REGISTRY_PROP_KEY] = JSON.stringify({ k1: A, k2: LIVE1 });
store[sandbox.FORM_TEMPLATE_VERSION_PROP_KEY] = JSON.stringify({ [A]: 9 });
store[sandbox.REGISTRATION_BACKFILL_PROP_KEY] = JSON.stringify({ [A]: 'x' });
let out = sandbox.purgeUnopenableForms([{ deadId: A }, { deadId: LIVE1 }]);
ok('purge succeeds for an admin', out.ok === true, JSON.stringify(out));
ok('the registry entry is gone and the live one kept', store[sandbox.FORM_REGISTRY_PROP_KEY] === JSON.stringify({ k2: LIVE1 }));
ok('an emptied store is deleted rather than left as {}',
  !(sandbox.FORM_TEMPLATE_VERSION_PROP_KEY in store) && !(sandbox.REGISTRATION_BACKFILL_PROP_KEY in store));
ok('a form that opens is refused by the server re-probe', out.lines.some(l => l.indexOf(LIVE1) === 0 && /opens now/.test(l)));
ok('rows are kept as history unless asked', out.lines.some(l => /kept as history/.test(l)));

sandbox.__admin = false;
out = sandbox.purgeUnopenableForms([{ deadId: B }]);
ok('purge is gated', out.ok === false && /restricted/.test(out.message));
out = sandbox.swapUnopenableForms([{ deadId: A, targetId: LIVE1 }]);
ok('swap is gated', out.ok === false && /restricted/.test(out.message));
ok('both actions are on the gated list',
  sandbox.ADMIN_GATED_ACTIONS.indexOf('Swap Unopenable Forms') !== -1 && sandbox.ADMIN_GATED_ACTIONS.indexOf('Purge Unopenable Forms') !== -1);
sandbox.__admin = true;
sandbox.__ssReady = true;

// The page: a hostile title survives, and the script block compiles.
const hostile = sandbox.buildUnopenableFormInventory_(
  [row('2026-10-01', 'Bingo </script><b>O\'Brien', 'Ashbridge', A, 'h1')], map, [], [], '2026-09-24');
const html = sandbox.buildUnopenableFormsHtml(hostile);
const scripts = html.split('<script>');
ok('exactly one script block, not ended early by a title', scripts.length === 2 && scripts[1].indexOf('</script>') === scripts[1].lastIndexOf('</script>'));
let parsed = true;
try { new vm.Script(scripts[1].slice(0, scripts[1].lastIndexOf('</script>'))); } catch (e) { parsed = String(e); }
ok('the page script compiles', parsed === true, parsed);
ok('no innerHTML with data', html.indexOf('innerHTML') === -1);

console.log(failures === 0 ? '\nall passed' : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
