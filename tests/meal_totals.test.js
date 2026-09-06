// MEALS ARE A NUMBER, NOT A LIST OF PEOPLE.
//
// Until v9 every lunch question on the form asked WHO was eating — a column
// per person on the roster grid, a box per person on the every-date page — and
// then a third question asked how many meals were wanted BEYOND one each.
// Somebody bringing three guests had to name them, tick four boxes, and then
// work out that the four meals they actually wanted was "none extra".
//
// So the guests are still named, and the meals are now one total per date,
// including the person filling the form in. This file holds the three things
// that has to be true of a live form: the template builds the new shape, a
// form still on the old shape is swapped over in place rather than rebuilt,
// and the lunch-only form — whose single grid IS its whole question — ends up
// with the grid that carries the count rather than the one that carried the
// people.
const vm = require('vm');
const { fakeForm, baseSandbox, PAGE_BREAK, SUBMIT } = require('./helpers/fake_form');
const src = require('./helpers/source').readSource();

const sandbox = baseSandbox();
vm.createContext(sandbox);
vm.runInContext(src + `
;this.addTemplateItemsToForm = addTemplateItemsToForm;
this.syncLunchQuestionsOnForm = syncLunchQuestionsOnForm;
this.makeFormLunchOnly = makeFormLunchOnly;
this.isFormOnCurrentTemplate = isFormOnCurrentTemplate;
this.addAttendanceGridItem = addAttendanceGridItem;
this.TEMPLATE_PAGE_TITLES = TEMPLATE_PAGE_TITLES;
this.TEMPLATE_ITEM_TITLES = TEMPLATE_ITEM_TITLES;
this.LEGACY_LUNCH_ONLY_GRID_TITLE = LEGACY_LUNCH_ONLY_GRID_TITLE;
this.MEAL_COUNT_CHOICES = MEAL_COUNT_CHOICES;
this.PERSON_COLUMN_LABELS = PERSON_COLUMN_LABELS;
this.log = function () {};
this.noteForAdmin = function () {};
this.invalidateFormItemIndex = function () {};
this.describeLocations = function (l) { return (l || []).join(', '); };
this.deleteFormItems = function (form, its) {
  (its || []).forEach(it => form.deleteItem(it));
  return (its || []).length;
};
`, sandbox, { filename: 'program.gs' });

// Every location caters, so syncLunchQuestionsOnForm() takes the restore path.
sandbox.getCateringPolicyForLocation = () => 'Always';

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

const T = sandbox.TEMPLATE_PAGE_TITLES;
const Q = sandbox.TEMPLATE_ITEM_TITLES;
const titlesOf = form => form.getItems().map(it => it.getTitle());
const itemNamed = (form, title) => form.getItems().filter(it => it.getTitle() === title)[0] || null;
const ctx = extra => Object.assign({
  locations: ['Narberth'], isClub: false, isFixed: false, isAssistance: false, isLunchOnly: false
}, extra || {});

// --- 1. what the template builds --------------------------------------------
{
  const form = fakeForm('tpl');
  sandbox.addTemplateItemsToForm(form);
  const titles = titlesOf(form);

  check('the every-date page asks for a total', titles.indexOf(Q.ALL_DATES_MEAL_COUNT) !== -1, true);
  check('the roster branch has a meal grid', titles.indexOf(Q.MEAL_COUNT_GRID) !== -1, true);
  check('and still asks who is coming', titles.indexOf(Q.ATTENDANCE_GRID) !== -1, true);
  // The three questions v9 replaced. A form carrying any of them is stale by
  // definition (isFormOnCurrentTemplate()), so the template must not build one.
  [Q.EXTRA_MEALS, Q.LUNCH_GRID, Q.ALL_DATES_LUNCH_PEOPLE].forEach(gone =>
    check(`"${gone}" is not built any more`, titles.indexOf(gone), -1));

  const grid = itemNamed(form, Q.MEAL_COUNT_GRID);
  // A MULTIPLE-CHOICE grid: one date, one number. A checkbox grid would let a
  // date carry two answers, which is the ambiguity this change exists to end.
  check('the meal grid is a multiple-choice grid', grid.getType(), 'GRID');
  check('...whose columns are the counts', grid.getColumns(), sandbox.MEAL_COUNT_CHOICES);
  check('...starting at zero', sandbox.MEAL_COUNT_CHOICES[0].indexOf('0'), 0);
  check('the attendance grid is still a checkbox grid of people',
    itemNamed(form, Q.ATTENDANCE_GRID).getType(), 'CHECKBOX_GRID');
  check('...with a column per person',
    itemNamed(form, Q.ATTENDANCE_GRID).getColumns(), sandbox.PERSON_COLUMN_LABELS);

  // The routing is unchanged by any of this, and the one rule that matters is
  // still there: the every-date branch ends the form rather than falling into
  // the roster grid its respondent has just said they do not need.
  const items = form.getItems();
  const pageIdx = items.findIndex(it => it.getType() === PAGE_BREAK && it.getTitle() === T.SPECIFIC_DATES);
  check('the every-date branch still submits', items[pageIdx].getPageNavigationType(), SUBMIT);

  check('and a form built from it is on the current template',
    sandbox.isFormOnCurrentTemplate(form), true);
}

// --- 2. a live v8 form is swapped over in place -----------------------------
{
  // The shape v8 left behind: a checkbox of people on the every-date page, a
  // checkbox grid of people on the roster page, and the extras question under
  // each of them.
  const form = fakeForm('live-v8');
  sandbox.addTemplateItemsToForm(form);
  form.deleteItem(itemNamed(form, Q.ALL_DATES_MEAL_COUNT));
  form.deleteItem(itemNamed(form, Q.MEAL_COUNT_GRID));
  form.addCheckboxItem().setTitle(Q.ALL_DATES_LUNCH_PEOPLE).setChoiceValues(sandbox.PERSON_COLUMN_LABELS);
  form.addCheckboxGridItem().setTitle(Q.LUNCH_GRID).setColumns(sandbox.PERSON_COLUMN_LABELS);
  form.addListItem().setTitle(Q.EXTRA_MEALS);
  check('the v8 form is recognized as stale', sandbox.isFormOnCurrentTemplate(form), false);

  const changed = sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx());
  check('swapping it over is a change', changed > 0, true);
  const titles = titlesOf(form);
  check('it now asks for a total on the every-date page',
    titles.indexOf(Q.ALL_DATES_MEAL_COUNT) !== -1, true);
  check('and carries a meal grid', titles.indexOf(Q.MEAL_COUNT_GRID) !== -1, true);
  [Q.EXTRA_MEALS, Q.LUNCH_GRID, Q.ALL_DATES_LUNCH_PEOPLE].forEach(gone =>
    check(`"${gone}" is off the form`, titles.indexOf(gone), -1));
  check('a swapped form is on the current template', sandbox.isFormOnCurrentTemplate(form), true);
  // A restored question lands at the END of the form; it belongs beside the
  // question it is a follow-up to, not under "Anything Else?" on whichever
  // page happens to be last.
  const items = form.getItems();
  const specificIdx = items.findIndex(it => it.getType() === PAGE_BREAK && it.getTitle() === T.SPECIFIC_DATES);
  check('the meal grid sits on the roster page, not at the end of the form',
    items.findIndex(it => it.getTitle() === Q.MEAL_COUNT_GRID) > specificIdx, true);

  // IDEMPOTENT. This runs on every sync for every form, and a redundant Forms
  // write is a round trip and a new revision in the form's history.
  check('a second pass writes nothing',
    sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx()), 0);
}

// --- 3. a form with nothing to serve, and then something ---------------------
{
  const form = fakeForm('no-lunch');
  sandbox.addTemplateItemsToForm(form);
  sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], false, ctx());
  const titles = titlesOf(form);
  check('a form with no catered date asks nothing about meals',
    [Q.ALL_DATES_MEAL_COUNT, Q.MEAL_COUNT_GRID].filter(t => titles.indexOf(t) !== -1), []);
  check('...but still asks who is coming', titles.indexOf(Q.ATTENDANCE_GRID) !== -1, true);
  sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx());
  check('and the questions come back when a catered date appears',
    [Q.ALL_DATES_MEAL_COUNT, Q.MEAL_COUNT_GRID].every(t => titlesOf(form).indexOf(t) !== -1), true);
}

// --- 4. the lunch-only form: one grid, and it is the counting one ------------
{
  const form = fakeForm('lunch-only');
  sandbox.addTemplateItemsToForm(form);
  const changed = sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx({ isLunchOnly: true }));
  check('shaping a lunch-only form is a change', changed > 0, true);
  const titles = titlesOf(form);
  check('the attendance grid is gone — a meal IS the registration here',
    titles.indexOf(Q.ATTENDANCE_GRID), -1);
  check('and the grid that stayed is the one that counts meals',
    titles.indexOf(Q.LUNCH_ONLY_GRID) !== -1, true);
  check('...still a multiple-choice grid', itemNamed(form, Q.LUNCH_ONLY_GRID).getType(), 'GRID');
  check('a second pass writes nothing',
    sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx({ isLunchOnly: true })), 0);
}

// --- 5. ...including a pre-v9 lunch-only form, whose ONLY grid was the old one
{
  // The shape makeFormLunchOnly() used to leave: the attendance grid retitled,
  // and no meal grid at all. Deleting that grid without putting one back would
  // leave a form with no question on it — the one failure this case exists for.
  const form = fakeForm('lunch-only-v8');
  sandbox.addTemplateItemsToForm(form);
  form.deleteItem(itemNamed(form, Q.MEAL_COUNT_GRID));
  form.deleteItem(itemNamed(form, Q.ALL_DATES_MEAL_COUNT));
  itemNamed(form, Q.ATTENDANCE_GRID).setTitle(sandbox.LEGACY_LUNCH_ONLY_GRID_TITLE);
  check('the old lunch-only form is recognized as stale',
    sandbox.isFormOnCurrentTemplate(form), false);

  sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx({ isLunchOnly: true }));
  const titles = titlesOf(form);
  check('the old people-grid is gone', titles.indexOf(sandbox.LEGACY_LUNCH_ONLY_GRID_TITLE), -1);
  check('a counting grid is there in its place', titles.indexOf(Q.LUNCH_ONLY_GRID) !== -1, true);
  check('...and the every-date page got its question back too',
    titles.indexOf(Q.ALL_DATES_MEAL_COUNT) !== -1, true);
  check('the form is left on exactly one grid',
    form.getItems().filter(it => it.getType() === 'GRID' || it.getType() === 'CHECKBOX_GRID').length, 1);
  check('a second pass writes nothing',
    sandbox.syncLunchQuestionsOnForm(form, ['Narberth'], true, ctx({ isLunchOnly: true })), 0);
}

console.log(failures === 0 ? '\nAll meal-total checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
