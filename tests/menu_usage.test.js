// MENU USAGE (section 99r) and the menu it counts (section 16).
//
// Every menu item names a `menu_<action>` wrapper rather than the action, so
// the one way this can break a click is a wrapper that does not exist — Apps
// Script answers that with "Script function not found", on the item somebody
// pressed. Pinned here:
//
//   THE MENU BUILDS, with and without Admin, and EVERY item it names is a
//   function that exists and calls an action that exists.
//
//   A CLICK COUNTS: one increment and a last-used stamp per press, keyed by
//   the action, and the report lists most-pressed first and the never-pressed
//   underneath.
//
//   TRACKING NEVER COSTS THE CLICK: Script Properties throwing, or holding
//   garbage, and the action still runs.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const props = {};
let propsBroken = false;
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10), getUuid: () => 'x', sleep: () => {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: key => { if (propsBroken) throw new Error('quota'); return key in props ? props[key] : null; },
      setProperty: (k, v) => { if (propsBroken) throw new Error('quota'); props[k] = v; },
      deleteProperty: k => { delete props[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, getUi: () => { throw new Error('no ui'); } },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'a@b.c' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.MENU_USAGE_PROP_KEY = MENU_USAGE_PROP_KEY;
this.BOOTSTRAP_ENTRY_NAME = BOOTSTRAP_ENTRY_NAME;
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(label, got, expected) {
  const a = JSON.stringify(got), b = JSON.stringify(expected);
  if (a !== b) { failures++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${b}`); }
  else console.log(`ok   ${label}`);
}

// --- The menu builds, and every item resolves. ------------------------------
function buildWith(includeAdmin) {
  const names = [];
  let root = null;
  function menu(name) {
    const m = { name, items: [], subs: [] };
    m.addItem = (label, fn) => { names.push(fn); m.items.push(label); return m; };
    m.addSeparator = () => m;
    m.addSubMenu = child => { m.subs.push(child); return m; };
    m.addToUi = () => { root = m; };
    return m;
  }
  sandbox.buildAppMenu({ createMenu: menu }, includeAdmin);
  return { names, root };
}
const full = buildWith(true);
const lean = buildWith(false);
check('menu attaches to the UI', !!full.root, true);
check('admin menu has many items', full.names.length > 80, true);
check('non-admin menu offers the sign-in escape hatch', lean.names.includes('menu_showAdminMenu'), true);

const bad = [];
full.names.concat(lean.names).forEach(fn => {
  if (!/^menu_/.test(fn)) return bad.push(`${fn}: not a tracking wrapper`);
  if (typeof sandbox[fn] !== 'function') return bad.push(`${fn}: wrapper missing`);
  const action = fn.slice(5);
  if (typeof sandbox[action] !== 'function') bad.push(`${fn}: action ${action} missing`);
  if (sandbox[fn].toString().indexOf(`return ${action}()`) < 0) bad.push(`${fn}: does not call ${action}`);
});
check('every menu item names an existing wrapper around an existing action', bad, []);
check('the bootstrap wrapper matches BOOTSTRAP_ENTRY_NAME', full.names.includes('menu_' + sandbox.BOOTSTRAP_ENTRY_NAME), true);

// The weekly jobs are at the top level, not in a submenu.
const top = full.root.items;
['Quick Mark', 'Add Registrants in Bulk', 'Log Volunteer Hours', 'Build a Form Question',
 'Update Everything Now', 'Why did nothing happen'].forEach(word =>
  check(`top level carries "${word}"`, top.some(l => l.indexOf(word) >= 0), true));
check('each action appears on the menu once', new Set(full.names).size, full.names.length);

// --- A click counts. --------------------------------------------------------
let ran = 0;
sandbox.showVolunteerHoursDialog = () => { ran++; return 'shown'; };
sandbox.reportWhyNothingHappened = () => { ran++; };
check('the wrapper returns what the action returns', sandbox.menu_showVolunteerHoursDialog(), 'shown');
sandbox.menu_showVolunteerHoursDialog();
sandbox.menu_reportWhyNothingHappened();
const stored = JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]);
check('two presses count two', stored.items.showVolunteerHoursDialog[0], 2);
check('one press counts one', stored.items.reportWhyNothingHappened[0], 1);
check('last-used is stamped', stored.items.showVolunteerHoursDialog[1] > 0, true);
check('the actions ran', ran, 3);

const report = sandbox.describeMenuUsage();
check('report lists the most-pressed first',
  report.indexOf('2 × ') >= 0 && report.indexOf('2 × ') < report.indexOf('1 × '), true);
check('report uses the menu label', report.indexOf('Log Volunteer Hours') >= 0, true);
check('report lists never-pressed items', /Never pressed \(\d+\)/.test(report), true);
check('report labels carry their submenu path', report.indexOf('Admin ▸') >= 0, true);

// --- Tracking never costs the click. ----------------------------------------
props[sandbox.MENU_USAGE_PROP_KEY] = '{not json';
sandbox.menu_showVolunteerHoursDialog();
check('garbage in the property: action still ran', ran, 4);
check('garbage in the property: counting starts again',
  JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]).items.showVolunteerHoursDialog[0], 1);
propsBroken = true;
let threw = null;
try { sandbox.menu_showVolunteerHoursDialog(); } catch (err) { threw = String(err); }
check('properties throwing: the click does not throw', threw, null);
check('properties throwing: action still ran', ran, 5);
propsBroken = false;

// --- Reset (confirmed unattended is "no", so pin the confirm). ----------------
sandbox.confirmConsequentialAction = () => true;
sandbox.resetMenuUsage();
check('reset empties the counts', JSON.parse(props[sandbox.MENU_USAGE_PROP_KEY]).items, {});

if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall menu usage checks passed');
