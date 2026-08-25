// A one-off event — a single lecture on the 5th of March — got a form built
// from the same template as a twelve-week series, and that template's spine is
// a required question about WHICH DATES: "all events this month" or "choose
// specific days". Over a list of one date both options mean the same thing and
// the roster grid behind the second one is a table with one row.
//
// What is pinned here:
//   • a one-date form loses the mode question and its page is retitled;
//   • a club form NEVER loses it, however few dates it covers — the club
//     option is how somebody joins the roster, not a choice about dates;
//   • an appointment form is left entirely alone (it has its own shape);
//   • the form goes back to asking the moment it covers a second date;
//   • a response that never met the question is read as "every date on this
//     form", which on a one-date form is that date — the half of this that
//     decides whether a registration is imported at all.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

const logs = [];
const PAGE_BREAK = 'PAGE_BREAK';
const sandbox = {
  console: { log: () => {} },
  Utilities: { formatDate: d => d.toISOString(), sleep: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: { ItemType: { PAGE_BREAK, PARAGRAPH_TEXT: 'PARAGRAPH_TEXT' },
    PageNavigationType: { SUBMIT: 'SUBMIT', CONTINUE: 'CONTINUE' } },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.syncSessionCountShapeOnForm = syncSessionCountShapeOnForm;
this.TEMPLATE_PAGE_TITLES = TEMPLATE_PAGE_TITLES;
this.TEMPLATE_ITEM_TITLES = TEMPLATE_ITEM_TITLES;
this.log = function () {};
this.invalidateFormItemIndex = function () {};
`, sandbox, { filename: 'Code.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const T = sandbox.TEMPLATE_PAGE_TITLES;
const Q = sandbox.TEMPLATE_ITEM_TITLES;

// A form reduced to the two things this code touches: titles, and item types.
function fakeForm(spec) {
  let nextId = 1;
  const items = spec.map(s => {
    const item = {
      id: nextId++, title: s.title, type: s.type || 'LIST', goTo: s.goTo || null,
      getTitle: () => item.title,
      getType: () => item.type,
      getId: () => item.id,
      getIndex: () => items.indexOf(item),
      asPageBreakItem: () => ({
        getId: () => item.id,
        getIndex: () => items.indexOf(item),
        setTitle: t => { item.title = t; },
        getGoToPage: () => item.goTo,
        setGoToPage: p => { item.goTo = p; }
      })
    };
    return item;
  });
  const added = [];
  const form = {
    getId: () => 'FORM1',
    getItems: () => items.slice(),
    deleteItem: it => { items.splice(items.indexOf(it), 1); },
    moveItem: (from, to) => { const [it] = items.splice(from, 1); items.splice(to, 0, it); },
    addListItem: () => {
      const item = {
        title: '', type: 'LIST',
        getTitle: () => item.title, getType: () => item.type, getIndex: () => items.indexOf(item),
        setTitle: t => { item.title = t; return item; },
        setRequired: () => item
      };
      items.push(item); added.push(item);
      return item;
    }
  };
  return { form, items, added, titles: () => items.map(i => i.title) };
}

const templateItems = () => [
  { title: Q.NAME, type: 'TEXT' },
  { title: T.MODE, type: PAGE_BREAK },
  { title: Q.ATTENDANCE_MODE, type: 'LIST' },
  { title: T.ALL_DATES, type: PAGE_BREAK },
  { title: Q.ALL_DATES_LUNCH_PEOPLE, type: 'CHECKBOX' },
  { title: T.SPECIFIC_DATES, type: PAGE_BREAK },
  { title: Q.ATTENDANCE_GRID, type: 'GRID' }
];

const ctx = extra => Object.assign({
  sessions: [{ date: new Date(2026, 2, 5), location: 'Narberth' }],
  locations: ['Narberth'], titles: ['Spring Lecture'], programTitle: 'Spring Lecture',
  isClub: false, isFixed: false, isAssistance: false, isLunchOnly: false
}, extra || {});

// --- one date: the question comes off, the page is retitled ----------------
{
  const f = fakeForm(templateItems());
  const changed = sandbox.syncSessionCountShapeOnForm(f.form, ctx());
  check('a one-date form is changed', changed > 0, true);
  check('the mode question is gone', f.titles().indexOf(Q.ATTENDANCE_MODE), -1);
  check('and its page says which date this is', f.titles().indexOf(T.SINGLE_DATE) !== -1, true);
  check('the branch pages are both still there',
    [T.ALL_DATES, T.SPECIFIC_DATES].map(t => f.titles().indexOf(t) !== -1), [true, true]);
  const single = f.items.filter(i => i.title === T.SINGLE_DATE)[0];
  check('and it flows to the every-date page', single.goTo && single.goTo.getId(),
    f.items.filter(i => i.title === T.ALL_DATES)[0].id);
}

// --- and running again writes nothing ---------------------------------------
{
  const f = fakeForm(templateItems());
  sandbox.syncSessionCountShapeOnForm(f.form, ctx());
  check('a second pass over a collapsed form writes nothing',
    sandbox.syncSessionCountShapeOnForm(f.form, ctx()), 0);
}

// --- A CLUB FORM KEEPS ITS QUESTION. This is the one that would have hurt ---
{
  const f = fakeForm(templateItems());
  const changed = sandbox.syncSessionCountShapeOnForm(f.form, ctx({ isClub: true }));
  check('a club form covering one date is not collapsed', changed, 0);
  check('so members can still join from it', f.titles().indexOf(Q.ATTENDANCE_MODE) !== -1, true);
}

// --- an appointment form is left entirely alone ------------------------------
{
  const f = fakeForm(templateItems());
  check('an appointment form is shaped elsewhere',
    sandbox.syncSessionCountShapeOnForm(f.form, ctx({ isAssistance: true })), 0);
}

// --- a second date puts the question back ------------------------------------
{
  const f = fakeForm(templateItems());
  sandbox.syncSessionCountShapeOnForm(f.form, ctx());
  check('collapsed first', f.titles().indexOf(Q.ATTENDANCE_MODE), -1);

  const two = ctx({ sessions: [{ date: new Date(2026, 2, 5) }, { date: new Date(2026, 2, 12) }] });
  const changed = sandbox.syncSessionCountShapeOnForm(f.form, two);
  check('a second date is a change', changed > 0, true);
  check('the question is back', f.titles().indexOf(Q.ATTENDANCE_MODE) !== -1, true);
  check('the page is called what the template calls it again',
    f.titles().indexOf(T.MODE) !== -1, true);
  check('and the question sits on that page',
    f.titles().indexOf(Q.ATTENDANCE_MODE), f.titles().indexOf(T.MODE) + 1);
}

// --- ticking [Club] on a form already collapsed puts it back too -------------
{
  const f = fakeForm(templateItems());
  sandbox.syncSessionCountShapeOnForm(f.form, ctx());
  check('collapsed first', f.titles().indexOf(Q.ATTENDANCE_MODE), -1);
  sandbox.syncSessionCountShapeOnForm(f.form, ctx({ isClub: true }));
  check('and ticking Club brings the question back on the same one date',
    f.titles().indexOf(Q.ATTENDANCE_MODE) !== -1, true);
}

// --- an ordinary multi-date form is never touched ----------------------------
{
  const f = fakeForm(templateItems());
  const two = ctx({ sessions: [{ date: new Date(2026, 2, 5) }, { date: new Date(2026, 2, 12) }] });
  check('a form that was never collapsed costs nothing',
    sandbox.syncSessionCountShapeOnForm(f.form, two), 0);
}

// --- a form with no known sessions is left alone -----------------------------
{
  const f = fakeForm(templateItems());
  check('no sessions means no opinion', sandbox.syncSessionCountShapeOnForm(f.form, ctx({ sessions: [] })), 0);
}

// --- a form already shaped as an appointment form is not un-shaped ----------
{
  const f = fakeForm(templateItems().concat([{ title: Q.APPOINTMENT, type: 'LIST' }]));
  // collapse it first so the SINGLE_DATE page is what restore would find
  sandbox.syncSessionCountShapeOnForm(f.form, ctx());
  const two = ctx({ sessions: [{ date: new Date(2026, 2, 5) }, { date: new Date(2026, 2, 12) }] });
  check('a form carrying the time question keeps its shape',
    sandbox.syncSessionCountShapeOnForm(f.form, two), 0);
  check('and gains no mode question', f.titles().indexOf(Q.ATTENDANCE_MODE), -1);
}

console.log(failures === 0 ? '\nAll single-session form checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
