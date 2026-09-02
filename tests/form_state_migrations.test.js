// FIXING A LIVE FORM WITHOUT REBUILDING IT.
//
// A template fix only ever reaches forms created afterwards: a group's form is
// made once and reused for as long as the group runs. Until repairFormPageRouting()
// the only way to close that gap was to rebuild the form — every question
// replaced, every pre-checked box regenerated, five forms per execution.
//
// This walks a form that is in the state v7 left it in — the every-date page's
// SUBMIT sitting on its own break, where Forms reads it as the exit of the page
// BEFORE it — proves a respondent on the two shapes with no mode question ends
// the form before the closing questions, and then proves the repair puts them
// back on the road with no rebuild and no second write.
const vm = require('vm');
const { fakeForm, baseSandbox, PAGE_BREAK, SUBMIT, CONTINUE, GO_TO_PAGE } = require('./helpers/fake_form');
const src = require('./helpers/source').readSource();

const sandbox = baseSandbox();
vm.createContext(sandbox);
vm.runInContext(src + `
;this.addTemplateItemsToForm = addTemplateItemsToForm;
this.syncSessionCountShapeOnForm = syncSessionCountShapeOnForm;
this.syncAssistanceQuestionsOnForm = syncAssistanceQuestionsOnForm;
this.repairFormPageRouting = repairFormPageRouting;
this.TEMPLATE_PAGE_TITLES = TEMPLATE_PAGE_TITLES;
this.TEMPLATE_ITEM_TITLES = TEMPLATE_ITEM_TITLES;
this.APPOINTMENT_PAGE_TITLE = APPOINTMENT_PAGE_TITLE;
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

function sections(form) {
  const secs = [{ page: null, title: '(page 1)', items: [] }];
  form.getItems().forEach(it => {
    if (it.getType() === PAGE_BREAK) secs.push({ page: it, title: it.getTitle(), items: [] });
    else secs[secs.length - 1].items.push(it);
  });
  return secs;
}

/** One trip through the form: a choice's own navigation wins, otherwise the
 *  section's exit is read off the break that ENDS it. */
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
      if (!closing) return { seen, ended: 'SUBMIT' };
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

const baseCtx = extra => Object.assign({
  sessions: [{ date: new Date(2026, 2, 5), location: 'Narberth' }],
  locations: ['Narberth'], titles: ['Low-Cost Wills'], programTitle: 'Low-Cost Wills',
  isClub: false, isFixed: false, isAssistance: false, isLunchOnly: false
}, extra || {});

let built = 0;
const pageOf = (form, title) => form.getItems().filter(it =>
  it.getType() === PAGE_BREAK && it.getTitle() === title)[0] || null;

/**
 * A form in the state TEMPLATE_VERSION 7 built: every navigation setting on the
 * break that OPENS the section it was meant to end, which is one section early.
 */
function buildV7Form(shape) {
  const form = fakeForm(`FORM_${shape}_${++built}`);
  sandbox.addTemplateItemsToForm(form);
  const context = baseCtx(shape === 'appointment' ? { isAssistance: true } : null);
  if (shape === 'several dates') context.sessions.push({ date: new Date(2026, 2, 12), location: 'Narberth' });
  if (shape === 'appointment') {
    sandbox.syncAssistanceQuestionsOnForm(form, context, ['Thu Mar 5 — 10:00 AM']);
  } else if (shape === 'one date') {
    sandbox.syncSessionCountShapeOnForm(form, context);
  }

  // Now un-fix it, exactly the way v7 had it. The mode page's own break carries
  // the branch target the old code wrote there, and the every-date page's own
  // break carries the SUBMIT — which Forms reads as the exit of the mode page.
  const modePage = pageOf(form, T.MODE) || pageOf(form, T.SINGLE_DATE) ||
    pageOf(form, sandbox.APPOINTMENT_PAGE_TITLE);
  const allDates = pageOf(form, T.ALL_DATES);
  const specific = pageOf(form, T.SPECIFIC_DATES);
  modePage.setGoToPage(shape === 'appointment' ? specific : allDates);
  allDates.setGoToPage(SUBMIT);
  specific.setGoToPage(CONTINUE);
  return { form, context };
}

const routeSolo = form => walk(form, { [Q.GUEST_COUNT]: sandbox.GUEST_COUNT_NONE_LABEL });

// --- the damage, first, so the repair is measured against something ----------
['one date', 'appointment'].forEach(shape => {
  const { form } = buildV7Form(shape);
  check(`${shape}: a v7 form ends before the closing questions`,
    routeSolo(form).seen.indexOf(Q.ADDITIONAL_NOTES) !== -1, false);
});

// --- and the repair ----------------------------------------------------------
['several dates', 'one date', 'appointment'].forEach(shape => {
  const { form, context } = buildV7Form(shape);
  const outcome = sandbox.repairFormPageRouting(form, context);
  check(`${shape}: the form is recognized`, outcome.recognized, true);
  check(`${shape}: something was actually written`, outcome.changed > 0, true);

  const routes = [sandbox.GUEST_COUNT_NONE_LABEL, '1', '2', '3'].map(guests => {
    const modeItem = form.getItems().filter(it =>
      it.getTitle() === Q.ATTENDANCE_MODE && it.getType() !== PAGE_BREAK)[0] || null;
    const modes = modeItem ? modeItem.getChoices().map(c => c.getValue()) : [null];
    return modes.map(mode => {
      const pick = { [Q.GUEST_COUNT]: guests };
      if (mode) pick[Q.ATTENDANCE_MODE] = mode;
      return { guests, mode, result: walk(form, pick) };
    });
  }).reduce((all, r) => all.concat(r), []);

  check(`${shape}: every route submits`, routes.every(r => r.result.ended === 'SUBMIT'), true);
  check(`${shape}: every route reaches "${Q.ADDITIONAL_NOTES}"`,
    routes.filter(r => r.result.seen.indexOf(Q.ADDITIONAL_NOTES) === -1)
      .map(r => `${r.guests} / ${r.mode}`), []);
  check(`${shape}: 2 guests are still asked for 2 names, not 3`,
    routes.filter(r => r.guests === '2')
      .every(r => r.result.seen.indexOf('Guest 2 Name') !== -1 &&
        r.result.seen.indexOf('Guest 3 Name') === -1), true);

  // THE PART THAT MAKES IT SAFE TO RUN HOURLY: a repaired form costs reads and
  // no writes, so it gains no revision in its history and no Forms quota.
  check(`${shape}: a second repair writes nothing`,
    sandbox.repairFormPageRouting(form, context).changed, 0);
});

// --- a form this does not recognize is left alone, not half-wired ------------
{
  const stranger = fakeForm('HANDMADE');
  stranger.addTextItem().setTitle('Your name');
  stranger.addPageBreakItem().setTitle('Some page nobody here named');
  const outcome = sandbox.repairFormPageRouting(stranger, null);
  check('an unrecognized form is reported, not repaired', outcome, { changed: 0, recognized: false });
}

// --- the repair leaves a complete form exactly as the template built it ------
{
  const fresh = fakeForm('CURRENT');
  sandbox.addTemplateItemsToForm(fresh);
  check('a form built on the current template needs no repair at all',
    sandbox.repairFormPageRouting(fresh, null).changed, 0);
}

console.log(failures === 0 ? '\nAll form migration checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
