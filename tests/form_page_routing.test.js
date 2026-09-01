// WHERE THE FORM SENDS PEOPLE, walked end to end — the one thing none of the
// other form tests check, because all of them assert on ITEMS and this is a
// property of the JUMPS BETWEEN THEM.
//
// THE APPS SCRIPT RULE THIS PINS, which is the opposite of what it reads like:
// a PageBreakItem's navigation describes the transition INTO that break, not
// out of the page it opens. The reference is explicit — setGoToPage() "sets
// the page to jump to after completing the page BEFORE this page break (that
// is, upon reaching this page break by normal linear progression through the
// form)". So the setting that ENDS a section lives on the NEXT break, and
// writing a section's exit onto the break that opened it lands it one section
// too early.
//
// THE BUG. addTemplateItemsToForm() wrote `allDatesPage.setGoToPage(SUBMIT)`
// meaning "the every-date branch ends here". What it actually said was "submit
// after the page before it" — the MODE page. On a full form nobody noticed:
// the mode question is a required dropdown whose choices carry their own
// per-answer navigation, and choice navigation overrides the section's, so
// every respondent branched before that setting could apply.
//
// It applies the moment the mode question is NOT there, which is two shapes
// this system deliberately builds:
//
//   • a form covering ONE session — collapseFormToSingleSession() takes the
//     question off, since "which dates?" over a list of one is not a question;
//   • an APPOINTMENT form — syncAssistanceQuestionsOnForm() takes it off and
//     puts the time question in its place.
//
// On both, the respondent finished that page and Forms read the next break's
// SUBMIT: the form ended right there, before the branch page carrying the
// allergies question, "Anything Else?" — and every question the program set on
// Program_Questions, which is where this was noticed. Staff added a question,
// pushed it to the forms, saw it sitting on the form in the editor, and it was
// never asked.
//
// Both shapes DID try to fix their own routing (collapseFormToSingleSession()
// pointed the mode page at the every-date page, syncAssistanceQuestionsOnForm()
// pointed it at the roster page) and both wrote to the same wrong break, so
// neither fix could take.
const vm = require('vm');
const src = require('./helpers/source').readSource();

const PAGE_BREAK = 'PAGE_BREAK';
const SUBMIT = { nav: 'SUBMIT' };
const CONTINUE = { nav: 'CONTINUE' };
const GO_TO_PAGE = { nav: 'GO_TO_PAGE' };

// A form that models the three things routing depends on: item order, page
// breaks, and navigation — both kinds. Page-level navigation is read back
// exactly as Forms serves it, INCLUDING the throw: a break that has never been
// given a page target answers getGoToPage() with an exception rather than null.
function fakeForm(id) {
  const items = [];
  let nextId = 1;
  const make = type => {
    const it = {
      _id: nextId++, type, title: '', help: '', choices: [], goTo: null, navType: CONTINUE,
      getId: () => it._id, getType: () => it.type, getTitle: () => it.title,
      getHelpText: () => it.help, getIndex: () => items.indexOf(it),
      setTitle: t => { it.title = t; return it; },
      setHelpText: t => { it.help = t; return it; },
      setRequired: () => it,
      setChoiceValues: v => { it.choices = v.map(x => ({ getValue: () => x, nav: null })); return it; },
      getChoices: () => it.choices,
      setChoices: cs => { it.choices = cs; return it; },
      createChoice: (v, nav) => ({ getValue: () => v, nav: nav || null }),
      setRows: () => it, setColumns: () => it, setBounds: () => it, setLabels: () => it, setImage: () => it,
      asListItem: () => it, asMultipleChoiceItem: () => it, asCheckboxItem: () => it,
      asPageBreakItem: () => {
        if (it.type !== PAGE_BREAK) throw new Error(`Invalid conversion for item type: ${it.type}`);
        return it;
      },
      getPageNavigationType: () => it.navType,
      getGoToPage: () => {
        if (it.navType !== GO_TO_PAGE) throw new Error('navigation type is not GO_TO_PAGE');
        return it.goTo;
      },
      setGoToPage: target => {
        if (target === SUBMIT || target === CONTINUE) { it.navType = target; it.goTo = null; }
        else { it.navType = GO_TO_PAGE; it.goTo = target; }
        return it;
      }
    };
    items.push(it);
    return it;
  };
  const form = {
    getId: () => id,
    setCollectEmail: () => {}, setAllowResponseEdits: () => {},
    setDescription: d => { form._desc = d; }, getDescription: () => form._desc || '',
    getItems: () => items.slice(),
    deleteItem: it => { items.splice(items.indexOf(it), 1); },
    moveItem: (from, to) => { const [it] = items.splice(from, 1); items.splice(to, 0, it); },
    addTextItem: () => make('TEXT'),
    addParagraphTextItem: () => make('PARAGRAPH_TEXT'),
    addListItem: () => make('LIST'),
    addCheckboxItem: () => make('CHECKBOX'),
    addMultipleChoiceItem: () => make('MULTIPLE_CHOICE'),
    addCheckboxGridItem: () => make('GRID'),
    addPageBreakItem: () => make(PAGE_BREAK),
    addSectionHeaderItem: () => make('SECTION_HEADER'),
    addScaleItem: () => make('SCALE'),
    addDateItem: () => make('DATE'),
    addTimeItem: () => make('TIME'),
    addImageItem: () => make('IMAGE')
  };
  return form;
}

const properties = {};
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: d => d.toISOString(),
    base64EncodeWebSafe: b => Buffer.from(String(b)).toString('base64'),
    computeDigest: (alg, payload) => Array.from(Buffer.from(String(payload))),
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF-8' }, sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (k in properties ? properties[k] : null),
      setProperty: (k, v) => { properties[k] = v; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => null, getActive: () => null },
  FormApp: {
    ItemType: { PAGE_BREAK, PARAGRAPH_TEXT: 'PARAGRAPH_TEXT', LIST: 'LIST', MULTIPLE_CHOICE: 'MULTIPLE_CHOICE' },
    PageNavigationType: { SUBMIT, CONTINUE, GO_TO_PAGE }
  },
  CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York',
    getEffectiveUser: () => ({ getEmail: () => 't@e.com' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.addTemplateItemsToForm = addTemplateItemsToForm;
this.syncCustomQuestionsOnForm = syncCustomQuestionsOnForm;
this.syncSessionCountShapeOnForm = syncSessionCountShapeOnForm;
this.syncAssistanceQuestionsOnForm = syncAssistanceQuestionsOnForm;
this.TEMPLATE_PAGE_TITLES = TEMPLATE_PAGE_TITLES;
this.TEMPLATE_ITEM_TITLES = TEMPLATE_ITEM_TITLES;
this.GUEST_COUNT_NONE_LABEL = GUEST_COUNT_NONE_LABEL;
this.log = function () {};
this.noteForAdmin = function () {};
this.invalidateFormItemIndex = function () {};
this.deleteFormItems = function (form, its) {
  (its || []).forEach(it => form.deleteItem(it));
  return (its || []).length;
};
`, sandbox, { filename: 'program.gs' });

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const T = sandbox.TEMPLATE_PAGE_TITLES;
const Q = sandbox.TEMPLATE_ITEM_TITLES;
const ZIP = 'What is your zip code?';

/** The form as a respondent meets it: page 1, then one section per page break. */
function sections(form) {
  const secs = [{ page: null, title: '(page 1)', items: [] }];
  form.getItems().forEach(it => {
    if (it.getType() === PAGE_BREAK) secs.push({ page: it, title: it.getTitle(), items: [] });
    else secs[secs.length - 1].items.push(it);
  });
  return secs;
}

/**
 * One trip through the form. `pick` maps a question title to the answer given.
 *
 * The two navigation rules, in the order Forms applies them: an answered
 * choice carrying its own "go to section" wins; otherwise the section's exit
 * is read off THE BREAK THAT ENDS IT — the next one down, which is the whole
 * point of this file.
 */
function walk(form, pick) {
  const secs = sections(form);
  const byId = new Map(secs.filter(s => s.page).map(s => [s.page.getId(), s]));
  const seen = [];
  let i = 0;
  for (let guard = 0; i >= 0 && i < secs.length && guard < 50; guard++) {
    const sec = secs[i];
    sec.items.forEach(it => seen.push(it.getTitle()));

    let next = null, decided = false;
    sec.items.forEach(it => {
      const answer = pick[it.getTitle()];
      if (answer === undefined) return;
      const choice = (it.getChoices() || []).filter(c => c.getValue() === answer)[0];
      if (choice && choice.nav) { next = choice.nav; decided = true; }
    });
    if (!decided) {
      const closing = secs[i + 1] ? secs[i + 1].page : null;
      if (!closing) return { seen, ended: 'SUBMIT' }; // the last page submits on its own
      next = closing.getPageNavigationType() === GO_TO_PAGE ? closing.getGoToPage()
        : closing.getPageNavigationType();
    }
    if (next === SUBMIT) return { seen, ended: 'SUBMIT' };
    if (next && next !== CONTINUE && next.getId) {
      const target = byId.get(next.getId());
      i = target ? secs.indexOf(target) : i + 1;
      continue;
    }
    i++;
  }
  return { seen, ended: 'RAN OFF THE END' };
}

const zipSpec = [{ title: ZIP, kind: 'TEXT', required: false, help: '', choices: [] }];
const baseCtx = extra => Object.assign({
  sessions: [{ date: new Date(2026, 2, 5), location: 'Narberth' }],
  locations: ['Narberth'], titles: ['Low-Cost Wills'], programTitle: 'Low-Cost Wills',
  isClub: false, isFixed: false, isAssistance: false, isLunchOnly: false
}, extra || {});

// Each build gets its own form id: syncCustomQuestionsOnForm() records what it
// applied PER FORM and skips a form whose fingerprint already matches, so two
// forms sharing an id would leave the second one without the question.
let builtForms = 0;

/** A form of one of the three shapes, with one program question applied to it. */
function buildForm(shape) {
  const form = fakeForm(`FORM_${shape}_${++builtForms}`);
  sandbox.addTemplateItemsToForm(form);
  const context = baseCtx(shape === 'appointment' ? { isAssistance: true } : null);
  if (shape === 'several dates') context.sessions.push({ date: new Date(2026, 2, 12), location: 'Narberth' });
  if (shape === 'appointment') {
    sandbox.syncAssistanceQuestionsOnForm(form, context, ['Thu Mar 5 — 10:00 AM', 'Thu Mar 5 — 10:30 AM']);
  } else {
    sandbox.syncSessionCountShapeOnForm(form, context);
  }
  sandbox.syncCustomQuestionsOnForm(form, context, zipSpec, {});
  return form;
}

/** Every route through a form: each guest count, times each mode answer. */
function everyRoute(form) {
  const modeItem = form.getItems().filter(it =>
    it.getTitle() === Q.ATTENDANCE_MODE && it.getType() !== PAGE_BREAK)[0] || null;
  const modeAnswers = modeItem ? modeItem.getChoices().map(c => c.getValue()) : [null];
  const routes = [];
  [sandbox.GUEST_COUNT_NONE_LABEL, '1', '2', '3'].forEach(guests => {
    modeAnswers.forEach(mode => {
      const pick = { [Q.GUEST_COUNT]: guests };
      if (mode) pick[Q.ATTENDANCE_MODE] = mode;
      routes.push({ guests, mode, result: walk(form, pick) });
    });
  });
  return routes;
}

// --- the template's own wiring ----------------------------------------------
{
  const form = fakeForm('TEMPLATE');
  sandbox.addTemplateItemsToForm(form);
  const secs = sections(form);
  const breakAfter = title => {
    const at = secs.findIndex(s => s.title === title);
    return at === -1 || !secs[at + 1] ? null : secs[at + 1].page;
  };
  // The break that ends the mode page is the every-date page's own break, and
  // what it says is what a respondent with no mode question to answer gets.
  const afterMode = breakAfter(T.MODE);
  check('the mode page does NOT end the form',
    afterMode && afterMode.getPageNavigationType() !== SUBMIT, true);
  const afterAllDates = breakAfter(T.ALL_DATES);
  check('the every-date branch does end the form',
    afterAllDates && afterAllDates.getPageNavigationType(), SUBMIT);
  check('and the roster branch is last, so it ends by itself',
    secs[secs.length - 1].title, T.SPECIFIC_DATES);
}

// --- every shape reaches every question --------------------------------------
['several dates', 'one date', 'appointment'].forEach(shape => {
  const form = buildForm(shape);
  const routes = everyRoute(form);
  check(`${shape}: every route submits`,
    routes.every(r => r.result.ended === 'SUBMIT'), true);
  check(`${shape}: every route reaches the program's own question`,
    routes.filter(r => r.result.seen.indexOf(ZIP) === -1).map(r => `${r.guests} / ${r.mode}`), []);
  check(`${shape}: every route reaches "${Q.ADDITIONAL_NOTES}"`,
    routes.every(r => r.result.seen.indexOf(Q.ADDITIONAL_NOTES) !== -1), true);
  // The guest pages are a branch of their own, and a respondent must meet
  // exactly the one they asked for — this is the mis-routing the v1/v2
  // template was withdrawn for.
  check(`${shape}: 2 guests are asked for 2 names, not 1 or 3`,
    routes.filter(r => r.guests === '2')
      .every(r => r.result.seen.indexOf('Guest 2 Name') !== -1 &&
        r.result.seen.indexOf('Guest 3 Name') === -1), true);
  check(`${shape}: a solo registrant is asked for no guest at all`,
    routes.filter(r => r.guests === sandbox.GUEST_COUNT_NONE_LABEL)
      .every(r => r.result.seen.indexOf('Guest 1 Name') === -1), true);
});

// --- the one-date shape, specifically ----------------------------------------
{
  const form = buildForm('one date');
  check('a one-date form has no mode question to route on',
    form.getItems().filter(it => it.getTitle() === Q.ATTENDANCE_MODE).length, 0);
  const seen = walk(form, { [Q.GUEST_COUNT]: sandbox.GUEST_COUNT_NONE_LABEL }).seen;
  check('so it flows into the every-date page instead of submitting',
    seen.indexOf(Q.ALL_DATES_LUNCH_PEOPLE) !== -1, true);
  check('and it does not also drag them through the roster grid',
    seen.indexOf(Q.ATTENDANCE_GRID), -1);
}

// --- the appointment shape, specifically -------------------------------------
{
  const form = buildForm('appointment');
  const seen = walk(form, { [Q.GUEST_COUNT]: '1' }).seen;
  check('an appointment form asks the time question', seen.indexOf(Q.APPOINTMENT) !== -1, true);
  check('and then goes on to the closing questions rather than submitting',
    seen.indexOf(Q.ADDITIONAL_NOTES) > seen.indexOf(Q.APPOINTMENT), true);
  check('the program question is asked once, not twice',
    seen.filter(t => t === ZIP).length, 1);
}

// --- and none of this costs a write on the next sync -------------------------
{
  const form = buildForm('one date');
  check('a second pass over a one-date form writes nothing',
    sandbox.syncSessionCountShapeOnForm(form, baseCtx()), 0);
  const appt = buildForm('appointment');
  check('a second pass over an appointment form writes nothing',
    sandbox.syncAssistanceQuestionsOnForm(appt, baseCtx({ isAssistance: true }),
      ['Thu Mar 5 — 10:00 AM', 'Thu Mar 5 — 10:30 AM']), 0);
}

console.log(failures === 0 ? '\nAll form routing checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
