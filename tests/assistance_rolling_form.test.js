// AN APPOINTMENT PROGRAM IS ONE FORM, THREE MONTHS WIDE.
//
// [Personalized Assistance] programs used to be grouped per calendar month
// like everything else: twelve forms a year for one standing arrangement,
// twelve links, and a link handed out in September opening a form in October
// with no free slot on it because it was never about October. They are now one
// group, one form, and a rolling window of dates — this month and the two
// after it — that moves on its own as the months go by.
//
// What is pinned here (the grouping half is in assistance_tag_read.test.js):
//   • the window's two ends, and that it is stated in months rather than days;
//   • the ROW-derived form context is trimmed to the same window, and trimmed
//     in `sessions` ONLY — the fields that decide how a date is LABELLED stay
//     derived from the whole row set, because buildRegistryIndex() matches a
//     response back by exactly those labels;
//   • a [Grouped] series and a lunch-only form are left completely alone;
//   • which of a program's old month forms is adopted: the one its NEXT
//     session is on, because that is the link in circulation right now.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const pad = n => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      if (fmt === 'MMMM yyyy') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString();
    },
    sleep: () => {}
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null, flush: () => {} },
  FormApp: { ItemType: {}, PageNavigationType: {} },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.assistanceFormWindow = assistanceFormWindow;
this.isWithinAssistanceFormWindow = isWithinAssistanceFormWindow;
this.describeAssistanceFormWindow = describeAssistanceFormWindow;
this.ASSISTANCE_FORM_MONTHS = ASSISTANCE_FORM_MONTHS;
this.ASSISTANCE_FORM_SPAN = ASSISTANCE_FORM_SPAN;
this.buildFormSessionContext = buildFormSessionContext;
this.chooseAdoptedAssistanceForms = chooseAdoptedAssistanceForms;
this.trimGroupsToFormWindows = trimGroupsToFormWindows;
this.formSpanForGroup = formSpanForGroup;
this.formSpanForRow = formSpanForRow;
this.HEADERS = HEADERS;
this.getIndexMap = getIndexMap;
this.log = function () {};
// Every date serves lunch or not by the same answer here: this file is about
// which sessions reach the form, not about what is on the menu.
isLunchOfferedOn = function () { return false; };
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const today = new Date();
const monthsOut = (offset, day) => new Date(today.getFullYear(), today.getMonth() + offset, day || 10, 12, 0);

// --- the window --------------------------------------------------------------
{
  const window = sandbox.assistanceFormWindow();
  check('it opens on the first of this month',
    [window.start.getDate(), window.start.getMonth()], [1, today.getMonth()]);
  check('it is three months wide', sandbox.ASSISTANCE_FORM_MONTHS, 3);
  // Day 0 of the month after the last one it covers — whatever length that
  // month is, which is the whole reason this is not written in days.
  check('and it closes at the end of the third month',
    [window.end.getMonth(), window.end.getDate()],
    [new Date(today.getFullYear(), today.getMonth() + 2, 1).getMonth(),
      new Date(today.getFullYear(), today.getMonth() + 3, 0).getDate()]);

  check('last month is off it', sandbox.isWithinAssistanceFormWindow(monthsOut(-1)), false);
  check('a date earlier THIS month is still on it — the window moves in months, not days',
    sandbox.isWithinAssistanceFormWindow(new Date(today.getFullYear(), today.getMonth(), 1, 9, 0)), true);
  check('the third month is on it', sandbox.isWithinAssistanceFormWindow(monthsOut(2)), true);
  check('the fourth is not yet', sandbox.isWithinAssistanceFormWindow(monthsOut(3)), false);
  check('a blank date is nobody\'s session', sandbox.isWithinAssistanceFormWindow(''), false);
}

// --- the span helpers agree, group and row -----------------------------------
{
  check('a group of one appointment program spans the program, not a month',
    sandbox.formSpanForGroup({ isAssistance: true, isFixed: false, monthLabel: 'September 2026' }),
    sandbox.ASSISTANCE_FORM_SPAN);
  check('and its rows read back the same way',
    sandbox.formSpanForRow('Regular', monthsOut(1), true), sandbox.ASSISTANCE_FORM_SPAN);
  check('[Grouped] still wins over it, group side',
    sandbox.formSpanForGroup({ isAssistance: true, isFixed: true, monthLabel: null }), 'FIXED');
  check('and row side', sandbox.formSpanForRow('Grouped', monthsOut(1), true), 'FIXED');
  check('an ordinary program is untouched by any of it',
    sandbox.formSpanForRow('Regular', new Date(2026, 8, 15), false), 'September 2026');
}

// --- the row-derived context is trimmed to the same window -------------------
const headers = sandbox.HEADERS.All_Program_Sessions;
const map = sandbox.getIndexMap(headers);
function row(date, opts) {
  const r = new Array(headers.length).fill('');
  const o = opts || {};
  r[map['Event_ID']] = `${o.location || 'Narberth'}-${date.getMonth()}`;
  r[map['Event_Date']] = date;
  r[map['Clean_Title']] = o.title || 'Low-Cost Wills';
  r[map['Location']] = o.location || 'Narberth';
  r[map['Form_ID']] = o.formId || 'FORM-A';
  r[map['Type_Tag']] = o.typeTag || 'Regular';
  if (map['Personalized_Assistance'] !== undefined) {
    r[map['Personalized_Assistance']] = o.assistance === false ? false : true;
  }
  return r;
}

{
  const rows = [row(monthsOut(-2)), row(monthsOut(-1)), row(monthsOut(0)),
    row(monthsOut(2)), row(monthsOut(4))];
  const context = sandbox.buildFormSessionContext('FORM-A', rows, map, new Set());
  check('the form offers the window and nothing else',
    context.sessions.map(s => s.date.getMonth()),
    [monthsOut(0).getMonth(), monthsOut(2).getMonth()]);
}

{
  // THE FIELDS THAT DECIDE A LABEL ARE NOT WINDOWED. This program runs at two
  // sites and has nothing at the second one inside the window; if the trim
  // reached showLocation, every date on the form would be relabelled without
  // its location and every response already collected against the old labels
  // would stop resolving.
  const rows = [
    row(monthsOut(-1), { location: 'Ashbridge' }),
    row(monthsOut(1), { location: 'Narberth' })
  ];
  const context = sandbox.buildFormSessionContext('FORM-A', rows, map, new Set());
  check('the trim reaches the sessions only', context.sessions.length, 1);
  check('and the labels still know this is a two-site form', context.showLocation, true);
  check('the locations are the program\'s, not the window\'s',
    context.locations.slice().sort(), ['Ashbridge', 'Narberth']);
}

{
  const rows = [row(monthsOut(-1), { typeTag: 'Grouped' }), row(monthsOut(4), { typeTag: 'Grouped' })];
  const context = sandbox.buildFormSessionContext('FORM-A', rows, map, new Set());
  check('a [Grouped] appointment series keeps every date of its run',
    context.sessions.length, 2);
}

{
  const rows = [row(monthsOut(-1), { assistance: false }), row(monthsOut(4), { assistance: false })];
  const context = sandbox.buildFormSessionContext('FORM-A', rows, map, new Set());
  check('and an ordinary program is not windowed at all', context.sessions.length, 2);
}

// --- the trim, and the one caller that overrides it --------------------------
{
  const group = (isAssistance, dates) => ({
    cleanTitle: 'Low-Cost Wills', isAssistance, isFixed: false,
    sessions: dates.map(d => ({ event: { getStartTime: () => d } }))
  });
  const far = monthsOut(5);
  const ordinaryEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0, 23, 59, 59);

  const trimmed = sandbox.trimGroupsToFormWindows(
    [group(true, [monthsOut(1), far]), group(false, [monthsOut(1), far])], { ordinaryEnd });
  check('an appointment group is trimmed to its window, an ordinary one to the horizon',
    trimmed.map(g => g.sessions.length), [1, 1]);

  // The weekend loader reads a window somebody TYPED, and a date they ticked
  // must not be dropped because an unattended hourly pass would not have
  // reached it.
  const asked = sandbox.trimGroupsToFormWindows(
    [group(true, [far])], { ordinaryEnd: far, assistanceEnd: far });
  check('a caller reading its own window keeps what it asked for',
    asked.length && asked[0].sessions.length, 1);

  check('and a group left with nothing at all is dropped',
    sandbox.trimGroupsToFormWindows([group(true, [monthsOut(-3)])], { ordinaryEnd }).length, 0);
}

// --- which old form is adopted ----------------------------------------------
{
  const key = `cal::Low-Cost Wills::${sandbox.ASSISTANCE_FORM_SPAN}`;
  const state = { groupFormMap: {}, splitAssistancePrograms: new Set() };
  sandbox.chooseAdoptedAssistanceForms(state, {
    [key]: [
      { formId: 'FORM-LAST-MONTH', date: monthsOut(-1) },
      { formId: 'FORM-NEXT', date: monthsOut(0, 28) },
      { formId: 'FORM-AFTER', date: monthsOut(1) }
    ]
  });
  check('the form the next session is on is the one that survives',
    state.groupFormMap[key], 'FORM-NEXT');
  check('and the program is flagged as still split across forms',
    state.splitAssistancePrograms.has(key), true);
}

{
  const key = `cal::Tax Help::${sandbox.ASSISTANCE_FORM_SPAN}`;
  const state = { groupFormMap: {}, splitAssistancePrograms: new Set() };
  sandbox.chooseAdoptedAssistanceForms(state, {
    [key]: [{ formId: 'FORM-OLD', date: monthsOut(-2) }, { formId: 'FORM-LESS-OLD', date: monthsOut(-1) }]
  });
  check('a program with nothing upcoming keeps the last form anybody used',
    state.groupFormMap[key], 'FORM-LESS-OLD');
  check('and there is nothing to move', state.splitAssistancePrograms.has(key), false);
}

{
  const key = `cal::Computer Help::${sandbox.ASSISTANCE_FORM_SPAN}`;
  const state = { groupFormMap: {}, splitAssistancePrograms: new Set() };
  sandbox.chooseAdoptedAssistanceForms(state, {
    [key]: [{ formId: 'FORM-ONE', date: monthsOut(0, 20) }, { formId: 'FORM-ONE', date: monthsOut(2) }]
  });
  check('a program already on one form is not asked to move',
    [state.groupFormMap[key], state.splitAssistancePrograms.has(key)], ['FORM-ONE', false]);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
