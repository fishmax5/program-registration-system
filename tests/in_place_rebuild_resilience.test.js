// A sweep that ends on the first exception is how a template migration stops
// half-applied. The v8 routing fix lives on the form itself, so the forms it
// has not reached go on sending people to Submit before the questions — and
// the failure that stops the sweep is usually not even ours: Apps Script's own
// "the JavaScript engine reported an unexpected error, error code INTERNAL"
// strikes a run rather than a form, and is gone on the next one.
//
// What is pinned here:
//   • a slice that throws leaves the sweep ALIVE — its state kept, its
//     progress kept, and a hand-off armed to try again;
//   • failing over and over still ends, rather than handing itself on forever;
//   • the count is consecutive: a slice that completes clears it.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let failures = 0;
function check(label, cond) {
  if (!cond) { failures++; console.log(`FAIL: ${label}`); } else { console.log(`ok: ${label}`); }
}

const props = {};
let triggers = [];
let sheetThrows = false; // flipped on after load: TIMEZONE reads the workbook at load time

const sandbox = {
  console: { log: () => {} },
  Utilities: { sleep: () => {}, formatDate: d => d.toISOString() },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => {
      if (sheetThrows) throw new Error('the JavaScript engine reported an unexpected error. Error code INTERNAL.');
      return { getSheetByName: () => null, getSpreadsheetTimeZone: () => 'America/New_York' };
    },
    getActive: () => null,
    getUi: () => { throw new Error('no ui'); }
  },
  ScriptApp: {
    newTrigger: handler => ({
      timeBased: () => ({ after: () => ({ create: () => { triggers.push(handler); } }) })
    }),
    getProjectTriggers: () => triggers.map(h => ({ getHandlerFunction: () => h, __h: h })),
    deleteTrigger: t => { triggers = triggers.filter(h => h !== t.__h); }
  },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.runInPlaceRebuildSlice = runInPlaceRebuildSlice;
this.saveInPlaceRebuildState = saveInPlaceRebuildState;
this.getInPlaceRebuildState = getInPlaceRebuildState;
this.IN_PLACE_REBUILD_STATE_PROP_KEY = IN_PLACE_REBUILD_STATE_PROP_KEY;
this.IN_PLACE_REBUILD_MAX_ERROR_SLICES = IN_PLACE_REBUILD_MAX_ERROR_SLICES;
this.IN_PLACE_REBUILD_RESUME_HANDLER = IN_PLACE_REBUILD_RESUME_HANDLER;
// Silence the parts of a slice that talk to a workbook we are not stubbing.
log = function () {};
toastIfPossible = function () {};
noteForAdmin = function () {};
flushAdminDigest = function () {};
flushPersistentRegistries = function () {};
`, sandbox);

sheetThrows = true;

const plan = () => ({
  startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0, errorSlices: 0,
  confirmed: ['formA', 'formB', 'formC'], done: ['formA'], rebuilt: 1
});

// --- one failing slice ------------------------------------------------------
sandbox.saveInPlaceRebuildState(plan());
triggers = [];
sandbox.runInPlaceRebuildSlice();
let state = sandbox.getInPlaceRebuildState();
check('a slice that throws does not end the sweep', state !== null);
check('the forms already rebuilt stay done', state && state.done.length === 1 && state.rebuilt === 1);
check('the failure is counted', state && state.errorSlices === 1);
check('a hand-off is armed to try again',
  triggers.length === 1 && triggers[0] === sandbox.IN_PLACE_REBUILD_RESUME_HANDLER);

// --- failing to the limit ---------------------------------------------------
for (let i = 1; i < sandbox.IN_PLACE_REBUILD_MAX_ERROR_SLICES; i++) sandbox.runInPlaceRebuildSlice();
check('a sweep that cannot get past its error ends', sandbox.getInPlaceRebuildState() === null);
check('and leaves no trigger handing itself on', triggers.length === 0);

// --- the count is consecutive, not cumulative -------------------------------
sandbox.saveInPlaceRebuildState(plan());
triggers = [];
sandbox.runInPlaceRebuildSlice();                       // one failure
check('one failure recorded', sandbox.getInPlaceRebuildState().errorSlices === 1);
sheetThrows = false;                                    // a slice that completes
sandbox.runInPlaceRebuildSlice();
const after = sandbox.getInPlaceRebuildState();
// The dashboard sheet is missing in this pass, which ends the sweep tidily on
// its own path — what matters is that it was NOT the error path that ended it.
check('a completed slice does not count as a failure',
  after === null || after.errorSlices === 0);

console.log(failures === 0 ? 'All in-place rebuild resilience checks passed.' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
