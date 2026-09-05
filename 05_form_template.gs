/**
 * Bump whenever the template FORM STRUCTURE changes (new/renamed items,
 * different page flow, etc.) so cached template IDs in Script Properties
 * are abandoned and rebuilt fresh instead of silently drifting out of sync
 * with what processFormResponse() expects to find.
 */
// v5 is a CORRECTNESS bump, not a design change: v4's mode page carried the
// same title as the mode question, so every rebuild onto v4 threw partway
// through (see TEMPLATE_PAGE_TITLES.MODE) and left the form with placeholder
// grid rows. Any form that did get stamped v4 has to be redone.
//
// v6 changes only HELP TEXT — no item is added, removed or renamed, and the
// page flow is identical — so nothing in processFormResponse() cares. It is
// still a version bump because help text is the entire user-facing surface of
// these three fixes, and a form is created once and reused for as long as its
// group runs: without the bump, migrateFormsToCurrentTemplate() would never
// pick up the live forms and the wording would only ever reach groups created
// from now on. The three: the mode page now lists the dates it is asking
// about (buildModePageDateNote()), the guest reminder points at the form's own
// Back button instead of the browser's answer-destroying one
// (GUEST_ORDER_REMINDER), and the guest columns say outright that a solo
// registrant should ignore them (NO_GUESTS_NOTE).
//
// v8 MOVES ONE NAVIGATION SETTING DOWN ONE PAGE, and it has to be a bump
// because where a form sends people IS its structure: the setting lives on the
// form, so a live v7 form goes on mis-routing until it is rebuilt. No item is
// added, removed or renamed. The every-date page's break carried SUBMIT and
// now carries CONTINUE, with the SUBMIT moved onto the roster page's break —
// see setNavigationAfterPage() for the whole of the reason: a page break's
// navigation is the transition INTO it, so a section's exit belongs on the
// NEXT break, and writing it on the section's own break lands it one section
// early. Nothing showed on a full form, because the mode question's per-answer
// navigation overrides the section's own. It showed the moment that question
// is absent — a one-date form and an appointment form, both of which take it
// off on purpose — where the respondent met "Submit" at the end of the mode
// page and the form ended before the branch page carrying Allergies, "Anything
// Else?" and every question from Program_Questions.
// See tests/form_page_routing.test.js.
//
// v9 CHANGES WHAT A LUNCH QUESTION ASKS FOR. Every lunch question on the form
// used to be a question about PEOPLE — tick who is eating, in a column per
// person, then a separate list for "extra meals beyond one each". A meal and a
// person are not the same thing, and asking for one in terms of the other made
// somebody bringing three guests do arithmetic the form should be doing: name
// the guests, tick four boxes, then work out that the four meals they actually
// want is "none extra".
//
// So the guests are still named — the roster, the sign-in sheet and the
// calendar invite all need them — and the meals are now asked for as ONE TOTAL,
// including the person filling the form in: 0 to MAX_MEALS_PER_SUBMISSION.
// Three questions become two:
//
//   ALL_DATES_LUNCH_PEOPLE (checkbox: You/Guest 1/2/3)  ⟶  ALL_DATES_MEAL_COUNT (0-4)
//   LUNCH_GRID (checkbox grid: dates x people)          ⟶  MEAL_COUNT_GRID (dates x 0-4)
//   EXTRA_MEALS (list: none/1..6)                       ⟶  gone, folded into the total
//
// It is a structure bump of the loudest kind — two items change TYPE and one
// disappears — so every live form has to be rebuilt onto it, which is what the
// stamp above is for and what isFormOnCurrentTemplate() now recognizes: a form
// still carrying any of the three questions on the left is stale by
// definition. Responses collected against the old shape keep importing:
// readMealCountResponse() and readMealCountGridResponse() fall back to the
// per-person answers and the extra-meals list when the new questions are not
// on the response (see 29_form_response_processing.gs).
const TEMPLATE_VERSION = 9;
const TEMPLATE_FORM_PROP_KEY = `TEMPLATE_FORM_ID_V${TEMPLATE_VERSION}`;

/** Stable marker titles used to find-and-customize specific items after copying a template. */
defineLazyGlobal_('TEMPLATE_ITEM_TITLES', () => ({
  NAME: 'Name',
  PHONE: 'Phone Number',
  GUEST_COUNT: 'How many guests are you bringing?',
  // Roster grids: rows = dates, columns = PERSON_COLUMN_LABELS.
  ATTENDANCE_GRID: 'Who is Attending Each Date?',
  /**
   * The per-date meal question: rows are the dates lunch is served on, columns
   * are 0 to MAX_MEALS_PER_SUBMISSION, and the answer on a row is the TOTAL
   * number of meals that party wants that day — the registrant's own included.
   *
   * A multiple-choice grid, so one date can only carry one answer. See
   * TEMPLATE_VERSION's v9 note for why this replaced a checkbox grid of people.
   */
  MEAL_COUNT_GRID: 'How Many Meals Each Date?',
  /** PRE-v9: the per-date lunch question as a person-per-column checkbox grid. Read, never written. */
  LUNCH_GRID: 'Who Needs Lunch Each Date?',
  ALLERGIES: 'Allergies / Dietary Needs',
  ADDITIONAL_NOTES: 'Anything Else?',
  ATTENDANCE_MODE: 'How would you like to sign up?',
  /** PRE-v9: the all-dates lunch question as a person-per-box checkbox. Read, never written. */
  ALL_DATES_LUNCH_PEOPLE: 'Who Needs Lunch? (Applies to Every Date)',
  /**
   * The all-dates branch's meal question: one total, 0 to
   * MAX_MEALS_PER_SUBMISSION, applied to every date on the submission that
   * serves lunch. The counterpart of MEAL_COUNT_GRID on the branch where a
   * respondent has said the dates are all the same to them.
   */
  ALL_DATES_MEAL_COUNT: 'How Many Meals? (Applies to Every Date)',
  /**
   * PRE-v9: "how many meals do you want ON TOP of one each?", asked once per
   * submission beside the lunch question.
   *
   * It existed because a meal and a person are not the same thing and the form
   * had no way to say so: somebody who collects four meals could only be
   * entered as four people, which puts three invented names on the roster, the
   * sign-in sheet and the party count.
   *
   * v9 asks for the TOTAL instead (MEAL_COUNT_GRID / ALL_DATES_MEAL_COUNT),
   * which is the same fact without the subtraction. The title stays here
   * because responses submitted against a v8 form are still imported from it —
   * see readMealCountResponse().
   */
  EXTRA_MEALS: 'Extra Meals (Beyond One Each)',
  /**
   * The one question an appointment form asks instead of the roster grids —
   * see ASSISTANCE_TAG. It is NOT built by the template (the template belongs
   * to no program and cannot know the times), only by
   * syncAssistanceQuestionsOnForm(), which is also what its absence means:
   * a form without it is an ordinary date-based form.
   */
  APPOINTMENT: 'Which appointment time would you like?',
  /**
   * Asked immediately after it, on the same page, and only on an appointment
   * form — see EARLIER_APPOINTMENT_CHOICES. Like APPOINTMENT it is not built
   * by the template, so a form carrying it is a form that was shaped as an
   * appointment form.
   */
  EARLIER_APPOINTMENT: 'If an earlier appointment opens up, may we call you?',
  /**
   * WHETHER THEY ARE STAYING FOR LUNCH — asked on an appointment form, and
   * only on the days one is actually being served.
   *
   * The appointment shape used to take lunch off outright, on the reasoning
   * that a counselling appointment is not a meal. That is true of the
   * APPOINTMENT and false of the DAY: somebody seeing Heather at 12:30 at a
   * site that serves lunch at noon is exactly the person who would stay for
   * it, and the form was the only place they could have said so. The two
   * roster grids still have no business on this form — an appointment is one
   * person at one time, not a party across a month of dates — so this is a
   * plain yes/no rather than a restored grid, asked once, about the one day
   * they just booked.
   *
   * Built by syncAssistanceQuestionsOnForm(), like the two questions above it,
   * and taken off again the moment no date on the form serves lunch.
   */
  APPOINTMENT_LUNCH: 'Would you like lunch on the day of your appointment?',
  /**
   * What the MEAL_COUNT_GRID is RETITLED TO on a lunch-only form, where
   * "which dates are you coming" and "how many meals do you want" are the same
   * question and asking both would be asking twice. The ATTENDANCE_GRID is the
   * one that goes (see makeFormLunchOnly()); a number above zero on this grid
   * IS the attendance.
   *
   * A retitle rather than a second item, because one grid is the honest shape
   * of that form — but it does mean the grid can arrive under either of two
   * titles, and every lookup of it has to accept both.
   *
   * PRE-v9 IT WAS THE OTHER WAY AROUND: the ATTENDANCE_GRID survived, under
   * this title, as a person-per-column checkbox grid — see
   * LEGACY_LUNCH_ONLY_GRID_TITLE, which is what those forms and their
   * responses still carry.
   */
  LUNCH_ONLY_GRID: 'How Many Meals on Each Date?'
}));

/**
 * The title the lunch-only form's single grid carried BEFORE v9, when it was
 * the ATTENDANCE_GRID retitled rather than the MEAL_COUNT_GRID retitled — a
 * checkbox grid of people, not a count. Never written any more; read so a
 * response collected on such a form still imports.
 */
const LEGACY_LUNCH_ONLY_GRID_TITLE = 'Who Needs Lunch on Each Date?';

/**
 * Every title a per-date grid can carry, whatever it is asking — the two
 * current ones, the lunch-only retitle, and both pre-v9 spellings. This is the
 * list for "find the grids on this form" (setting rows, deleting them off an
 * appointment form); reading an ANSWER goes by the specific title, since what
 * a grid means depends on which one it is.
 */
const ROSTER_GRID_TITLES = [
  TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID,
  TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID,
  LEGACY_LUNCH_ONLY_GRID_TITLE
];

/**
 * The grids that hold MEAL COUNTS — the per-date one, and the lunch-only
 * form's retitled copy of it. Both are multiple-choice grids whose columns are
 * MEAL_COUNT_CHOICES.
 */
const MEAL_COUNT_GRID_TITLES = [
  TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID,
  TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID
];

/** True when this item title is a grid of meal counts rather than of people. */
function isMealCountGridTitle(title) {
  return MEAL_COUNT_GRID_TITLES.indexOf(String(title || '')) !== -1;
}

/** The roster-grid items on `form`, under whichever title they carry. */
function findRosterGridItems(items) {
  return (items || []).filter(it => ROSTER_GRID_TITLES.indexOf(it.getTitle()) !== -1);
}

/**
 * Sets a grid item's rows without the caller having to know which KIND of grid
 * it is. The attendance grid is a checkbox grid and the meal-count grids are
 * multiple-choice grids, and Apps Script will not let one be cast as the
 * other: asCheckboxGridItem() on a GRID item answers "Invalid conversion for
 * item type: GRID". Judged by the item's own TYPE rather than by its title, so
 * a form left mid-migration — the new title on an old item, or the reverse —
 * still gets its dates written instead of throwing the whole label pass away.
 */
function setGridItemRows(item, rows) {
  if (item.getType() === FormApp.ItemType.GRID) {
    item.asGridItem().setRows(rows);
    return;
  }
  item.asCheckboxGridItem().setRows(rows);
}

/**
 * The title the per-location footer note used to occupy as a SectionHeaderItem
 * of its own. Nothing builds one any more — the note is the HELP TEXT of the
 * "Anything Else?" question now (see applyFormFooterNote()), because as a bare
 * section header it rendered as an unexplained bold line floating above the
 * last questions with nothing under it. Kept so a rebuild can recognize and
 * delete the stray header on forms that still carry one.
 */
const LEGACY_FOOTER_ITEM_TITLE = 'Footer Note';

/**
 * THE ATTENDANCE MODE CHOICES — what a respondent picks to say how much of the
 * form they need to fill in. Written as full sentences in the first person,
 * because the old labels ("Everyone, every date") were a description of a
 * data shape rather than an answer to a question, and the help text under them
 * said only "most people want the first option," which tells someone which box
 * to tick without ever telling them what either box does.
 *
 * THREE SPELLINGS OF EACH, and it matters which a given form gets: a [Regular]
 * form genuinely covers one calendar month, so "all events this month" is
 * exactly right and is what people asked to read. A [Grouped] series runs
 * across however many months it runs across, and telling someone they are
 * signing up for "this month" when the dates listed above run into March would
 * be plainly untrue. A lunch-only form has a third pair again, because nothing
 * is being "attended" on it. buildAttendanceModeChoiceSet() picks the pair
 * that matches the form. Nothing downstream compares against these strings
 * directly: isAllDatesModeAnswer() and isClubModeAnswer() accept EVERY
 * spelling AND the pre-v4 wording, and "pick specific dates" is simply
 * whatever neither of them claims — so responses collected before this change
 * keep parsing.
 *
 * ADDING A SPELLING MEANS ADDING IT TO isAllDatesModeAnswer() TOO. That is not
 * a style note: the lunch-only pair below was added without it, and because
 * "every date" is recognized by name and "pick specific dates" is merely
 * everything else, an unrecognized all-dates answer does not fail loudly — it
 * is read as "pick specific dates", sent looking for a roster grid the
 * respondent was correctly branched past, and dropped with no row and no
 * warning. Every lunch-only form's one-page option silently registered nobody
 * for a month.
 */
const ATTENDANCE_MODE_CHOICES = {
  ALL_DATES: 'I want to sign up for all events this month.',
  ALL_DATES_SERIES: 'I want to sign up for every date listed on this form.',
  INDIVIDUAL: 'I want to choose specific days this month to attend.',
  INDIVIDUAL_SERIES: 'I want to choose specific dates from the list to attend.',
  // The lunch-only form's pair. Nothing is being "attended" on it — the whole
  // form is one question about food — so borrowing the attendance wording
  // would have somebody signing up to "attend" a meal. The all-dates option
  // is the one this form exists for: a month of lunches booked in one pass,
  // which is exactly what people ring up asking to do.
  ALL_DATES_LUNCH: 'I want lunch on every date listed on this form.',
  INDIVIDUAL_LUNCH: 'I want to pick which days I am having lunch.'
};

/** Pre-v4 wording, still read so responses submitted against an older form keep importing correctly. */
const LEGACY_ATTENDANCE_MODE_CHOICES = {
  ALL_DATES: 'Everyone, every date',
  INDIVIDUAL: 'Let me pick specific dates/people'
};

/**
 * The club choice's fixed prefix. The rest of the label is the program's own
 * name, so it reads "I want to sign up for all future Book Club meetings." —
 * which is the sentence a club member would actually say. Parsed by prefix
 * (isClubModeAnswer()) rather than by exact match, since the title varies per
 * form and can change when a program is renamed.
 */
const CLUB_MODE_CHOICE_PREFIX = 'I want to sign up for all future ';
const CLUB_MODE_CHOICE_SUFFIX = ' meetings.';

/** "I want to sign up for all future Book Club meetings." */
function buildClubModeChoice(programTitle) {
  const title = String(programTitle || '').trim() || 'these';
  return `${CLUB_MODE_CHOICE_PREFIX}${title}${CLUB_MODE_CHOICE_SUFFIX}`;
}

/** True when this answer means "every date on this form" — any current spelling, or the pre-v4 one. */
function isAllDatesModeAnswer(value) {
  const v = String(value || '').trim();
  return v === ATTENDANCE_MODE_CHOICES.ALL_DATES ||
    v === ATTENDANCE_MODE_CHOICES.ALL_DATES_SERIES ||
    // The lunch-only form's own wording. It says "lunch" rather than "sign up"
    // because a meal is not something you attend — but it is the same answer,
    // and leaving it out here is what stopped a month of lunches booked in one
    // pass from booking anything at all.
    v === ATTENDANCE_MODE_CHOICES.ALL_DATES_LUNCH ||
    v === LEGACY_ATTENDANCE_MODE_CHOICES.ALL_DATES;
}

/** True when this answer means "join the club" — every date on this form AND every future one. */
function isClubModeAnswer(value) {
  const v = String(value || '').trim();
  return v.indexOf(CLUB_MODE_CHOICE_PREFIX) === 0 && v.endsWith(CLUB_MODE_CHOICE_SUFFIX);
}

/**
 * The two or three choices this form's Attendance Mode question offers, and
 * the page each one goes to. Built per form because both the wording (monthly
 * vs series) and the club option depend on what the form covers.
 */
function buildAttendanceModeChoiceSet(options) {
  options = options || {};
  const isSeries = !!options.isFixed;
  // A lunch-only form is never a club and never a series — it is one month of
  // meals at one location — so its wording is picked first and the other two
  // flags cannot reach it.
  if (options.isLunchOnly) {
    return {
      allDates: ATTENDANCE_MODE_CHOICES.ALL_DATES_LUNCH,
      individual: ATTENDANCE_MODE_CHOICES.INDIVIDUAL_LUNCH,
      club: null,
      isLunchOnly: true
    };
  }
  return {
    allDates: isSeries ? ATTENDANCE_MODE_CHOICES.ALL_DATES_SERIES : ATTENDANCE_MODE_CHOICES.ALL_DATES,
    individual: isSeries ? ATTENDANCE_MODE_CHOICES.INDIVIDUAL_SERIES : ATTENDANCE_MODE_CHOICES.INDIVIDUAL,
    club: options.isClub ? buildClubModeChoice(options.programTitle) : null
  };
}

/**
 * The help text under the Attendance Mode question. Says what each option
 * DOES, in the same order the options appear — replacing "Most people want
 * the first option," which was advice about a form rather than information
 * about a choice.
 */
function buildAttendanceModeHelpText(choiceSet) {
  if (choiceSet.isLunchOnly) {
    return [
      `• "${choiceSet.allDates}" — one quick page. We put you (and any guests) down for a meal on every date listed on this form.`,
      `• "${choiceSet.individual}" — a grid of the dates, so you can tick exactly which meals each person wants.`
    ].join('\n');
  }
  const lines = [
    `• "${choiceSet.allDates}" — one quick page. We book you (and any guests) for every date listed on this form, and you tell us once who is eating.`,
    `• "${choiceSet.individual}" — a grid of the dates, so you can tick exactly which ones each person is coming to.`
  ];
  if (choiceSet.club) {
    lines.push(`• "${choiceSet.club}" — the same as signing up for every date here, and we keep you on the list for future meetings too, so you never have to fill this in again. Call ${CENTER_PHONE} any time to come off the list.`);
  }
  return lines.join('\n');
}

/**
 * How much of the date list the mode page will carry, in characters.
 *
 * Google Forms rejects an over-long help text outright, and a section
 * description that runs for several screens has stopped being read long before
 * it hits any limit. A form with an unusually long date list shows as many as
 * fit and says how many more there are.
 */
const MODE_PAGE_DATES_CHAR_BUDGET = 1200;

/**
 * The section description for the mode page: the dates this form actually
 * covers, one per line.
 *
 * WHY THIS HAS TO BE REPEATED HERE. The mode page asks the one question the
 * whole form turns on — "every date, or let me pick?" — and until now it asked
 * it with the dates nowhere on screen. They ARE on the form
 * (buildFormDescription() lists every one of them), but a Google Forms
 * description renders at the top of the FIRST page only; by the time somebody
 * has answered their name, their phone, a guest count and possibly a page of
 * guest names, that list is several sections behind them. So the choice was
 * being made from memory, and "sign me up for every date" was being picked by
 * people who could no longer see how many dates that was or when they ran to.
 *
 * A page break's own help text is the section description, which is the one
 * place on this page that can hold prose — so the list goes there, immediately
 * above the question it informs.
 */
function buildModePageDateNote(dateLabels) {
  const labels = (dateLabels || []).filter(Boolean);
  if (labels.length === 0) return '';

  const lines = [];
  let used = 0;
  for (const label of labels) {
    const line = `• ${label}`;
    if (used + line.length > MODE_PAGE_DATES_CHAR_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
  }
  // Never show a heading promising dates and then no dates: a budget too small
  // for even one line means something is badly wrong with the labels, and a
  // bare heading is worse than saying nothing.
  if (lines.length === 0) return '';

  const hidden = labels.length - lines.length;
  const heading = labels.length === 1
    ? 'This form covers one date:'
    : `This form covers these ${labels.length} dates:`;
  return `${heading}\n${lines.join('\n')}` +
    (hidden > 0 ? `\n…and ${hidden} more — the full list is at the top of the first page.` : '');
}

/**
 * The title of the guest-count question on templates v1/v2 — a bare "Guest
 * Count" list that branched to a guest-detail page per count and then a roster
 * page per count. v3 removed guest routing entirely; v4 brings a much smaller
 * version of it back (see getOrCreateTemplateForm()) under a DIFFERENT title,
 * so this stays an unambiguous marker for "this form is still on v1/v2".
 */
const LEGACY_GUEST_COUNT_TITLE = 'Guest Count';

/**
 * Titles of every page break the template creates. Stable markers, like
 * TEMPLATE_ITEM_TITLES — restoreLunchQuestionsOnForm() needs ALL_DATES to put
 * a re-added lunch question back on the right page instead of at the end of
 * the form, and addTemplateItemsToForm() wires its navigation by object rather
 * than by title, so these are for finding pages after the fact.
 *
 * GUEST_1/2/3 are the guest-name pages the guest-count question routes to.
 * There is deliberately NO page for "no guests": that choice jumps straight to
 * the mode page, which is one fewer section for the commonest answer and one
 * fewer jump that can go wrong.
 */
const TEMPLATE_PAGE_TITLES = {
  GUEST_1: 'Your Guest',
  GUEST_2: 'Your Guests',
  GUEST_3: 'Your Guests (3)',
  // DELIBERATELY NOT the same text as TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE,
  // which is the question that sits ON this page. They read almost the same to
  // a person and it is tempting to use one string for both — but form items
  // are looked up BY TITLE, and a page break sharing a question's title is
  // returned by those lookups first (it is added to the form first). The
  // caller then calls asListItem() on a PageBreakItem and Forms answers
  // "Invalid conversion for item type: PAGE_BREAK", which is what this cost
  // the first time. Every page title here must differ from every item title in
  // TEMPLATE_ITEM_TITLES.
  MODE: 'Choose How to Sign Up',
  /**
   * What the MODE page is retitled to on a form covering ONE session — see
   * collapseFormToSingleSession(). "Choose How to Sign Up" is a heading over
   * nothing once the choice has been taken off, and it was never true of a
   * one-off event in the first place: there is one date, and the only thing
   * left to say about it is which one.
   *
   * A retitle rather than a deletion, for the same reason makeFormLunchOnly()
   * renames a grid instead of swapping it: the page stays exactly where it is
   * in the form, every navigation already aimed at it still lands, and putting
   * the mode question back is a retitle in the other direction rather than a
   * page rebuilt in the right position.
   */
  SINGLE_DATE: 'The Date You Are Registering For',
  ALL_DATES: 'Sign Up For Every Date',
  SPECIFIC_DATES: 'Pick Your Dates'
};

// ---------------------------------------------------------------------------
// PAGE NAVIGATION — the one Apps Script rule that reads backwards
//
// A PageBreakItem's navigation describes the transition INTO that break, not
// out of the page it opens. The reference says so outright: setGoToPage()
// "sets the page to jump to after completing the page BEFORE this page break
// (that is, upon reaching this page break by normal linear progression through
// the form)". So the setting that ENDS a section lives on the NEXT break down,
// and `allDatesPage.setGoToPage(SUBMIT)` — which reads exactly like "the
// every-date branch ends here" — actually says "submit after the page before
// it", the mode page.
//
// Every navigation write in this project used to be spelled that way, and on a
// complete form none of it mattered: the mode question is a required dropdown
// whose choices carry their own per-answer navigation, and choice navigation
// overrides the section's, so nobody ever fell through to the setting that was
// one page out of place. What it cost is in TEMPLATE_VERSION's v8 note.
//
// Write navigation through the two functions below and the question does not
// come up again: they take the page whose EXIT is being described, which is
// what a caller means, and put the setting where Forms will read it.
// ---------------------------------------------------------------------------

/**
 * The page break that ENDS the section `page` opens — the next break after it
 * in document order — or null when that section runs to the end of the form
 * (where Forms submits on its own, and there is nothing to write).
 *
 * `page` may be null, meaning the form's first section: everything before the
 * first page break.
 */
function pageBreakEndingSection(form, page) {
  const items = form.getItems();
  let start = -1;
  if (page) {
    const pageId = page.getId();
    start = items.findIndex(it => it.getType() === FormApp.ItemType.PAGE_BREAK && it.getId() === pageId);
    if (start === -1) return null; // not on this form (deleted, or never added)
  }
  for (let i = start + 1; i < items.length; i++) {
    if (items[i].getType() === FormApp.ItemType.PAGE_BREAK) return items[i].asPageBreakItem();
  }
  return null;
}

/**
 * What a page break currently points at, as an item id — or null when it
 * carries no page target at all.
 *
 * NEVER THROWS, which is the point of it. A break that has not been given a
 * page target answers getGoToPage() with an exception rather than with null,
 * and a caller that reads inside the same try/catch as its own write loses the
 * write to that exception. That has happened twice in this codebase already
 * (see collapseFormToSingleSession() and syncAssistanceQuestionsOnForm()).
 */
function pageBreakTargetId(pageBreak) {
  try {
    const target = pageBreak.getGoToPage();
    return target ? target.getId() : null;
  } catch (err) {
    return null;
  }
}

/**
 * Sets what happens AFTER the section that `page` opens — pass the page a
 * respondent is finishing, not the one they are going to.
 *
 * `target` is another page (as a PageBreakItem or a plain Item) or one of
 * FormApp.PageNavigationType.SUBMIT / CONTINUE. Returns 1 if it wrote, 0 if
 * the setting was already right or there was nowhere to write it — this runs
 * on every sync for every form, and a Forms write is a remote round trip and a
 * new revision in the form's history.
 */
function setNavigationAfterPage(form, page, target) {
  const closing = pageBreakEndingSection(form, page);
  if (!closing) return 0; // the last section of a form ends by submitting anyway

  // AS A PAGE BREAK, NOT AS AN ITEM — the same conversion applyAttendanceModeChoices()
  // documents at length. form.getItems() hands back generic Items, and the
  // navigation methods will not take one: they answer "The parameters
  // (FormApp.Item) don't match the method signature". Callers holding a live
  // form look their pages up by title and have exactly that, so the conversion
  // belongs here rather than at each of them.
  const targetPage = (target && typeof target.asPageBreakItem === 'function')
    ? target.asPageBreakItem() : null;
  // A JUMP INTO THE VERY SECTION THE FORM WAS ALREADY FALLING INTO IS NOT A
  // JUMP. Said as CONTINUE it means the same thing to a respondent and stays
  // true if that section is later renamed or moved, and it keeps a break from
  // being handed itself as its own destination.
  const wanted = !targetPage ? target
    : (targetPage.getId() === closing.getId() ? FormApp.PageNavigationType.CONTINUE : targetPage);

  const currentTargetId = pageBreakTargetId(closing);
  if (wanted && typeof wanted.getId === 'function') {
    if (currentTargetId === wanted.getId()) return 0;
  } else if (currentTargetId === null && typeof closing.getPageNavigationType === 'function') {
    // SUBMIT and CONTINUE are told apart by the navigation TYPE — both have no
    // page target, so the id comparison above cannot see the difference.
    try {
      if (closing.getPageNavigationType() === wanted) return 0;
    } catch (err) {
      // Unreadable — fall through and write it. A redundant write is a wasted
      // call; a skipped one is a form that sends people to the wrong place.
    }
  }

  closing.setGoToPage(wanted);
  return 1;
}

/**
 * Grid columns and all-dates lunch choices. FIXED at four entries on every
 * form: the roster grids are built once, at template time, and the guest-count
 * question routes people to the right NAME fields rather than varying these.
 * A column whose matching guest name was left blank is simply ignored at parse
 * time, so a solo registrant ticking only "You" is unaffected by the three
 * guest columns sitting beside it.
 */
const PERSON_COLUMN_LABELS = ['You', 'Guest 1', 'Guest 2', 'Guest 3'];

/** Max guests one submission can bring — the number of guest-name pages the form offers. */
const MAX_GUESTS = PERSON_COLUMN_LABELS.length - 1;

/**
 * The reminder attached to every question that refers to guests by NUMBER
 * rather than by name.
 *
 * Google Forms shows one page at a time and does not carry earlier answers
 * forward onto later ones, so by the time someone reaches the roster grid the
 * names they typed are off-screen and "Guest 2" is a column heading with
 * nothing behind it. There is no way to interpolate the names into the grid —
 * the grid is written before anyone answers — so the honest fix is to say
 * where the answer is and how to go back and look at it.
 *
 * WHICH back button matters, and this used to say the wrong one. Google Forms
 * puts its own "Back" button at the BOTTOM LEFT of every page after the first,
 * and that button walks back through the form with every answer still in
 * place. The BROWSER's back arrow does not: it leaves the form page
 * altogether, and what the respondent comes back to is a blank form with
 * everything they had typed gone. Telling someone to use the browser's arrow
 * to "check a name" was therefore advice that destroyed the registration they
 * were part-way through filling in.
 */
const GUEST_ORDER_REMINDER =
  'Guest 1, Guest 2 and Guest 3 are the names you typed earlier, in that order. ' +
  'Not sure which is which? Use the "Back" button at the BOTTOM LEFT of this form to look — ' +
  'nothing you have entered will be lost, and "Next" brings you straight back here. ' +
  'Do not use your browser\'s back arrow: that leaves the form and loses your answers.';

/**
 * The note that tells a solo registrant the guest boxes are not their problem.
 *
 * The form asks the guest count FIRST and routes accordingly, so somebody
 * coming alone never types a guest name (see getOrCreateTemplateForm()). What
 * they DO still meet is Guest 1/2/3 sitting in every roster grid and in the
 * all-dates lunch checkbox — because those columns are baked into the template
 * once, at build time, and cannot vary per respondent. Met with no
 * explanation, an empty labelled box reads as a question you are expected to
 * answer, and the careful thing to do with a question you cannot answer is to
 * stop and ring the office. Saying "ignore them" outright is cheaper than any
 * amount of inferring.
 */
const NO_GUESTS_NOTE =
  'Coming on your own? Ignore the Guest 1, Guest 2 and Guest 3 boxes completely — ' +
  'leave them blank. You do not need to tick them, clear them, or put anything in them.';

/** Placeholder row used on a freshly-built template's grids, before the first real date list is set. */
const TEMPLATE_GRID_PLACEHOLDER_ROW = '(dates will be filled in automatically)';

/**
 * Returns THE template form — one template for every group. Built once and
 * reused forever after (keyed by TEMPLATE_VERSION).
 *
 * PAGE FLOW (v8):
 *
 *   Page 1  Name (required)
 *           Phone Number (required)
 *           "How many guests are you bringing?" — None / 1 / 2 / 3, which
 *             jumps to exactly one of:
 *
 *   "Your Guest"       Guest 1 Name (required)                    -> MODE
 *   "Your Guests"      Guest 1 + Guest 2 Name (both required)     -> MODE
 *   "Your Guests (3)"  Guest 1 + 2 + 3 Name (all required)        -> MODE
 *   (None)                                                        -> MODE
 *
 *   MODE    "How would you like to sign up?" (required), branching to:
 *
 *   "Sign Up For Every Date"  ALL_DATES_MEAL_COUNT list (0-4 meals in total,
 *                             applied to every session date that serves lunch,
 *                             including dates added to a Grouped series later)
 *                                                                 -> SUBMIT
 *
 *   "Pick Your Dates"         ATTENDANCE_GRID (dates x PERSON_COLUMN_LABELS)
 *                             + MEAL_COUNT_GRID (dates x 0-4)     -> SUBMIT
 *
 * WHO is coming is still asked per person; HOW MANY MEALS is asked as one
 * total per date, the registrant's own included — see TEMPLATE_VERSION's v9
 * note. Both meal questions come off a form with nothing to serve and go back
 * on when it has (syncLunchQuestionsOnForm()).
 *
 * Both branch pages end with Allergies and an "Anything Else?" catch-all whose
 * HELP TEXT carries the per-location footer note.
 *
 * WHY THE GUEST COUNT IS BACK, CAREFULLY. v3 removed it entirely — every form
 * showed three optional "Guest N Name" boxes and the headcount was however
 * many you filled in. That is structurally safe but reads badly: the great
 * majority of registrants bring nobody, and were met with three empty boxes
 * they had to work out they were allowed to ignore, then a roster grid with
 * three columns for people who did not exist. Asking the question first and
 * routing to the matching page means a solo registrant never sees a guest
 * field at all.
 *
 * The v1/v2 version of this was genuinely broken, and the difference is worth
 * being precise about, because "we tried this and it mis-routed" is the
 * obvious objection. That template branched TWICE — once per count to a
 * guest-detail page, and again per count to a roster page — eight sections
 * deep, and Forms silently falls through to the NEXT section in document order
 * whenever a jump is missing, so a missing jump anywhere put you on another
 * count's page. Here there is exactly one guest branch, every one of its
 * targets exits to the SAME mode page (see setNavigationAfterPage() for where
 * that setting is actually stored), and the mode page is the next section in
 * document order anyway — so the fall-through case and the intended case are
 * the same page. A dropped jump
 * degrades to "you see one extra section", not "you are catered for the wrong
 * number of people". The old count/names mismatch is gone too, since a guest
 * page's name fields are REQUIRED: picking 3 and typing 2 names cannot submit.
 *
 * IMPORTANT ordering note: in Apps Script Forms, a page's contents are
 * whatever items were added between ITS PageBreakItem and the NEXT one —
 * order of addition, not order of variable creation, decides this.
 */
function getOrCreateTemplateForm() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(TEMPLATE_FORM_PROP_KEY);
  if (existingId) {
    try {
      return openFormCached(existingId);
    } catch (err) {
      log(`⚠️ Stored template form ${existingId} could not be opened (${err}) — building a fresh template.`);
    }
  }

  const form = FormApp.create('TEMPLATE — Registration Form Base (do not edit or delete)');
  addTemplateItemsToForm(form);

  // Same reason every registration form and program leader sheet opens itself
  // up the moment it is created (see openUpFileToAnyoneWithLink()): the
  // template is created by whoever ran this, but copied by makeCopy() every
  // time a program's form is built — routinely a DIFFERENT account, on the
  // hourly triggers. Leaving the template itself unshared means the very
  // first copy attempt from another account fails, and openUpAllFormSharing()
  // only reaches it retroactively if someone remembers to run it.
  openUpFileToAnyoneWithLink(form.getId(), 'the form template');

  // FILED, not left where FormApp.create() dropped it. Every other file this
  // system makes goes into a folder of its own kind; the template is one of a
  // kind, so it sits in the system folder itself beside the workbook. Without
  // this it stayed in My Drive root — which is exactly the mess `79` exists
  // to stop, and the template was the most conspicuous piece of it.
  const systemRoot = getSystemRootFolder();
  if (systemRoot) {
    moveDriveFileInto(DriveApp.getFileById(form.getId()), systemRoot, 'the form template');
  }

  props.setProperty(TEMPLATE_FORM_PROP_KEY, form.getId());
  log(`Created template registration form: ${form.getId()}`);
  return form;
}

/**
 * Writes the current template's settings, questions and navigation onto `form`
 * — which is EMPTY when called from getOrCreateTemplateForm(), and freshly
 * emptied when called from rebuildFormFromCurrentTemplate() to bring a live
 * form built on an older template up to date.
 *
 * The Attendance Mode choices are seeded with the generic (monthly, no club)
 * wording here and re-written per form by applyAttendanceModeChoices() once
 * the caller knows what the form actually covers — the template itself belongs
 * to no program, so it cannot know whether to offer a club option or how to
 * name it.
 */
function addTemplateItemsToForm(form) {
  form.setCollectEmail(true);
  form.setAllowResponseEdits(true);

  // --- Page 1: who is registering --------------------------------------
  form.addTextItem().setTitle(TEMPLATE_ITEM_TITLES.NAME).setRequired(true);
  form.addTextItem()
    .setTitle(TEMPLATE_ITEM_TITLES.PHONE)
    .setHelpText('So we can reach you if a program changes, or if there is a problem with your registration.')
    .setRequired(true);
  const guestCountItem = form.addListItem()
    .setTitle(TEMPLATE_ITEM_TITLES.GUEST_COUNT)
    .setHelpText('Guests are anyone coming with you. Pick a number and we will ask for their names next — ' +
      `if you are coming on your own, choose "${GUEST_COUNT_NONE_LABEL}" and skip it entirely. ` +
      `Bringing more than ${MAX_GUESTS} guests? Please call us on ${CENTER_PHONE} and we will add them for you.`)
    .setRequired(true);

  // --- One page per guest count ----------------------------------------
  // Each one jumps to the mode page below, which is also the next section in
  // document order after the last of them — see getOrCreateTemplateForm().
  const guestPages = [];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    const page = form.addPageBreakItem().setTitle(guestPageTitle(g));
    for (let n = 1; n <= g; n++) {
      form.addTextItem()
        .setTitle(`Guest ${n} Name`)
        .setHelpText(n === 1 && g > 1 ? 'The order you enter them in is the order we will list them in later.' : '')
        .setRequired(true);
    }
    guestPages.push(page);
  }

  // --- The mode page ----------------------------------------------------
  const modePage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.MODE);
  const modeItem = form.addListItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE).setRequired(true);

  // --- Branch A: every date ---------------------------------------------
  const allDatesPage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.ALL_DATES);
  addAllDatesMealCountItem(form);
  addClosingQuestions(form);

  // --- Branch B: per-date roster ----------------------------------------
  const specificPage = form.addPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  addAttendanceGridItem(form);
  addMealCountGridItem(form);
  addClosingQuestions(form);

  // Navigation, written last so every page it names already exists — and
  // written through setNavigationAfterPage(), which takes the page being
  // FINISHED and puts the setting on the break Forms actually reads it off.
  // Each line below is "after this page, go here".
  //
  // The first two are belt and braces: the guest-count question routes page 1
  // by choice, and the mode question routes its own page the same way. What
  // they buy is the fall-through — a form whose guest-count or mode question
  // has been deleted (both happen: see collapseFormToSingleSession() and
  // syncAssistanceQuestionsOnForm()) walks forward to the next page instead of
  // hitting a Submit button that ends the form three questions early.
  setNavigationAfterPage(form, null, modePage);
  guestPages.forEach(page => setNavigationAfterPage(form, page, modePage));
  setNavigationAfterPage(form, modePage, FormApp.PageNavigationType.CONTINUE);
  // The every-date branch is where the form ends for the people who take it —
  // otherwise they would fall on into the roster grid they just said they did
  // not need. The roster branch is the last page and submits by itself.
  setNavigationAfterPage(form, allDatesPage, FormApp.PageNavigationType.SUBMIT);
  const guestChoices = [guestCountItem.createChoice(GUEST_COUNT_NONE_LABEL, modePage)];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    guestChoices.push(guestCountItem.createChoice(String(g), guestPages[g - 1]));
  }
  guestCountItem.setChoices(guestChoices);

  applyAttendanceModeChoices(form, {}, { modeItem, allDatesPage, specificPage });
}

/** The "no guests" choice. A word rather than "0" — it is an answer, not a quantity. */
const GUEST_COUNT_NONE_LABEL = 'Just me — no guests';

/** PRE-v9: the "no extras" choice on the extra-meals question. Read, never written. */
const EXTRA_MEALS_NONE_LABEL = 'None — one meal each is right';

/** PRE-v9: the largest EXTRA order a v8 form would take, still the cap when one of its responses is read. */
const MAX_EXTRA_MEALS = 6;

/**
 * The largest TOTAL order a form will take: the registrant plus
 * MAX_GUESTS, which is as many people as one submission can name.
 *
 * Not a limit on what the workbook can hold — staff type any number into
 * Meals_Ordered — but a limit on what a public form will accept without a
 * person in the loop, the same judgement MAX_GUESTS makes: an order of thirty
 * meals is a conversation, not a tick. Somebody who needs more is told to ring,
 * in the help text of both meal questions.
 */
const MAX_MEALS_PER_SUBMISSION = MAX_GUESTS + 1;

/**
 * The choices on both meal questions: "0" through MAX_MEALS_PER_SUBMISSION, as
 * strings, because a Forms choice is text.
 *
 * ZERO IS A REAL ANSWER and leads the list — "I am coming, I do not want
 * lunch" is a thing a great many people mean, and before v9 they said it by
 * ticking nobody, which is indistinguishable from not having noticed the
 * question. Its label says so in words for the same reason
 * GUEST_COUNT_NONE_LABEL does; readMealCountAnswer() takes the leading number
 * off whatever it is given, so the wording can change without breaking a
 * response.
 */
const MEAL_COUNT_NONE_LABEL = '0 — no lunch, thank you';

const MEAL_COUNT_CHOICES = (() => {
  const choices = [MEAL_COUNT_NONE_LABEL];
  for (let n = 1; n <= MAX_MEALS_PER_SUBMISSION; n++) choices.push(String(n));
  return choices;
})();

/**
 * The help text both meal questions share: what the number means, and that it
 * includes the person answering.
 *
 * "INCLUDING YOURSELF" IS THE WHOLE SENTENCE. The question this replaced asked
 * for meals BEYOND one each, and somebody who read that question and now reads
 * this one will otherwise answer the old one — three guests, "3", and a party
 * of four gets three meals.
 */
// LAZY, because it names CENTER_PHONE — a constant from another file, and a
// top-level read of one is the load-order hazard 01a_lazy_globals.gs exists to
// remove.
defineLazyGlobal_('MEAL_COUNT_HELP', () =>
  'The TOTAL number of meals you want, including your own — so if you are coming with two ' +
  'guests and all three of you are eating, that is 3. Choose "0" if nobody in your party ' +
  `wants lunch. Need more than ${MAX_MEALS_PER_SUBMISSION}? Please call us on ${CENTER_PHONE} ` +
  'and we will sort it out with you.');

/**
 * ONE ANSWER OFF A MEAL QUESTION, as a number of meals — or null when the
 * question was not answered at all.
 *
 * NULL AND ZERO ARE DIFFERENT, and both callers depend on it: zero is somebody
 * saying "no lunch", null is a response that never met the question — a v8
 * form, an appointment form, a form with nothing to serve — where the answer
 * has to be looked for somewhere else before it can be called no lunch. See
 * readMealCountResponse().
 *
 * Parses the LEADING NUMBER rather than the whole label, so
 * MEAL_COUNT_NONE_LABEL ("0 — no lunch, thank you") reads as 0 and the wording
 * of it can change without stranding every response collected under the old
 * one. Anything with no number in front of it is null, not zero: an
 * unrecognizable answer is a question we have not really been told the answer
 * to.
 *
 * CAPPED at MAX_MEALS_PER_SUBMISSION rather than trusted — the question is a
 * list of fixed choices, so a larger number can only come from an edited form,
 * and an order of ninety meals should reach a person before it reaches the
 * kitchen.
 */
function readMealCountAnswer(value) {
  const raw = String(value === 0 ? '0' : (value || '')).trim();
  if (!raw) return null;
  const match = raw.match(/^-?\d+/);
  if (!match) return null;
  const amount = Math.floor(Number(match[0]));
  if (!isFinite(amount) || amount <= 0) return 0;
  return Math.min(amount, MAX_MEALS_PER_SUBMISSION);
}

/** Page title for the N-guest page. Distinct per count so form.getItems() lookups are unambiguous. */
function guestPageTitle(guestCount) {
  if (guestCount === 1) return TEMPLATE_PAGE_TITLES.GUEST_1;
  if (guestCount === 2) return TEMPLATE_PAGE_TITLES.GUEST_2;
  return TEMPLATE_PAGE_TITLES.GUEST_3;
}

/**
 * Sets (or re-sets) the Attendance Mode question's choices and help text for
 * ONE form — the two standard options, plus the club option when the program
 * is tagged [Club].
 *
 * `refs` lets addTemplateItemsToForm() pass the items it has just created;
 * every other caller holds only a live form, so they are looked up by title.
 * A form whose branch pages cannot be found is left exactly as it is rather
 * than being given choices that navigate nowhere.
 */
function applyAttendanceModeChoices(form, options, refs) {
  refs = refs || {};
  // AN APPOINTMENT FORM HAS NO MODE QUESTION — syncAssistanceQuestionsOnForm()
  // removes it, because "everyone, every date" and "join the club" are not
  // things you can do with a thirty-minute slot in somebody's diary. Returning
  // early is not merely an optimization: without it this would log a "could
  // not set the sign-up options" warning for every assistance form on every
  // sync, about a question whose absence is the intended state.
  if (options && options.isAssistance) return null;
  const items = refs.modeItem ? null : form.getItems();
  // AS A PAGE BREAK, NOT AS AN ITEM. form.getItems() hands back generic Items,
  // and ListItem.createChoice(value, navigationItem) will not take one: it
  // throws "The parameters (String,FormApp.Item) don't match the method
  // signature for FormApp.ListItem.createChoice."
  //
  // That is the exception every lunch sign-up form died on. It never showed up
  // on the template build, because addTemplateItemsToForm() passes the real
  // PageBreakItems it just created through `refs` — and it never showed up on
  // an ordinary monthly form either, because a copy of the template already
  // carries the standard mode labels, so the "skip if nothing changed" branch
  // below returned before reaching createChoice. It struck exactly the forms
  // whose labels DIFFER from the template's: every lunch-only form, every
  // [Club] form and every [Grouped] series. Those were the forms that had to
  // write their choices, and writing them was what failed — so no lunch form
  // was ever built, and with no form there was no link to pin.
  const asPage = item => (item && typeof item.asPageBreakItem === 'function' ? item.asPageBreakItem() : item);
  const findPage = title => asPage((items || []).filter(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === title)[0] || null);

  // Type-guarded as well as titled: a PAGE_BREAK can never be the question,
  // and a title collision between a page and a question must fail visibly at
  // build time rather than by handing back an item asListItem() will reject.
  const modeItem = refs.modeItem ||
    ((items || []).filter(it =>
      it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE &&
      it.getType() !== FormApp.ItemType.PAGE_BREAK)[0] || null);
  // asPage() on the refs too — they arrive as real PageBreakItems from
  // addTemplateItemsToForm() and pass straight through, but nothing about the
  // signature says a future caller has to hand them over that way.
  const allDatesPage = asPage(refs.allDatesPage) || findPage(TEMPLATE_PAGE_TITLES.ALL_DATES);
  const specificPage = asPage(refs.specificPage) || findPage(TEMPLATE_PAGE_TITLES.SPECIFIC_DATES);
  if (!modeItem || !allDatesPage || !specificPage) {
    // A FORM COVERING ONE SESSION HAS NO MODE QUESTION EITHER, and its absence
    // is the intended state — see section 1g. Recognized by the page it came
    // off, which collapseFormToSingleSession() retitles precisely so this can
    // be told apart from a form that has genuinely lost its question. Without
    // this, every one-off event's form would report a missing question, every
    // hour, forever, about a question deliberately taken off it — the same
    // false alarm the isAssistance guard above exists to prevent.
    const collapsed = (items || []).some(it => it.getType() === FormApp.ItemType.PAGE_BREAK &&
      it.getTitle() === TEMPLATE_PAGE_TITLES.SINGLE_DATE);
    if (!collapsed) {
      log(`ℹ️ Could not set the sign-up options on form ${form.getId()} — its mode question or branch pages are missing.`);
    }
    return null;
  }

  const list = modeItem.asListItem ? modeItem.asListItem() : modeItem;
  const choiceSet = buildAttendanceModeChoiceSet(options);
  const wantedValues = [choiceSet.allDates, choiceSet.individual];
  // The club option lands on the SAME page as "every date": joining a club is
  // signing up for everything on this form plus everything after it, so the
  // questions it needs to ask are identical. The difference is recorded at
  // import time (see processFormResponse()), not in the form's shape.
  if (choiceSet.club) wantedValues.push(choiceSet.club);
  const wantedHelp = buildAttendanceModeHelpText(choiceSet);

  // SKIP IF NOTHING CHANGED. This runs on every sync for every form that gains
  // a date, and a Forms write is both a remote round trip and a new form
  // revision — re-asserting identical choices every hour would fill a form's
  // history with edits that changed nothing. Comparing the labels and the help
  // text catches every case that matters: the page targets are derived from
  // the same choiceSet, so labels that match were built the same way.
  try {
    const current = list.getChoices().map(c => c.getValue());
    const same = current.length === wantedValues.length &&
      current.every((v, i) => v === wantedValues[i]) &&
      String(list.getHelpText() || '') === wantedHelp;
    if (same) return choiceSet;
  } catch (err) {
    // Unreadable choices — fall through and write them fresh.
  }

  list.setChoices(wantedValues.map(value =>
    list.createChoice(value, value === choiceSet.individual ? specificPage : allDatesPage)));
  list.setHelpText(wantedHelp);
  invalidateFormItemIndex(form.getId());
  return choiceSet;
}

/**
 * The two questions that close BOTH branch pages.
 *
 * There used to be a third thing here: a bare SectionHeaderItem holding the
 * per-location footer note, sitting between Allergies and "Anything Else?".
 * On the rendered form that is a bold line of text floating on its own above
 * the last question, attached to nothing — it reads as a heading for a section
 * that never arrives. The note is now the "Anything Else?" question's own help
 * text (applyFormFooterNote()), which is where it was always trying to be:
 * the sentence that tells you what to put in that box.
 */
function addClosingQuestions(form) {
  form.addTextItem()
    .setTitle(TEMPLATE_ITEM_TITLES.ALLERGIES)
    .setHelpText('Anything we should know about food — allergies, no dairy, soft foods. Leave blank if none.');
  form.addParagraphTextItem().setTitle(TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES);
}

/**
 * The all-dates branch's meal question: one total for the whole party, applied
 * to every date on the form that serves lunch. Appended wherever the cursor is
 * — callers position it.
 *
 * A LIST, not a free-text number: an open box collects "2 for my sister",
 * "maybe 1?" and "n/a", none of which is a number, and this answer goes
 * straight into a count the kitchen orders against.
 *
 * NOT REQUIRED. It sits on the branch a respondent takes to say "every date is
 * the same to me", and a required question about food is a required question
 * about something they may simply not want; an unanswered one reads as no
 * lunch, which is the reading a person can correct at the desk.
 */
function addAllDatesMealCountItem(form) {
  return form.addListItem().setTitle(TEMPLATE_ITEM_TITLES.ALL_DATES_MEAL_COUNT)
    .setChoiceValues(MEAL_COUNT_CHOICES)
    .setHelpText('This applies to every date on this form that lunch is actually served on.\n\n' +
      MEAL_COUNT_HELP);
}

/** The per-date attendance roster grid. Rows are set later by applyFormDateLabels(). */
function addAttendanceGridItem(form) {
  return form.addCheckboxGridItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID)
    .setHelpText('Tick a box for each person on each date they are coming.\n\n' +
      NO_GUESTS_NOTE + '\n\n' + GUEST_ORDER_REMINDER)
    .setRows([TEMPLATE_GRID_PLACEHOLDER_ROW]).setColumns(PERSON_COLUMN_LABELS);
}

/**
 * The per-date meal grid: one row per lunch date, one column per possible
 * total. Rows are set later by applyFormDateLabels().
 *
 * A MULTIPLE-CHOICE grid rather than a checkbox one, which is the whole point:
 * a date can carry exactly one number, so "how many meals on the 4th?" has one
 * answer instead of a set of ticks that have to be counted and reconciled. A
 * date left blank is no meal that day — the same reading an empty row of
 * tick-boxes always had.
 */
function addMealCountGridItem(form) {
  return form.addGridItem().setTitle(TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID)
    .setHelpText('Only the dates lunch is served on appear here. Pick the TOTAL number of meals ' +
      'your party wants on each date — your own included. Leave a date blank if nobody wants ' +
      'lunch that day.\n\n' + MEAL_COUNT_HELP)
    .setRows([TEMPLATE_GRID_PLACEHOLDER_ROW]).setColumns(MEAL_COUNT_CHOICES);
}

/**
 * Builds the form description, including the exact dates being registered
 * for — one date per line, not one long semicolon-separated line, and each
 * with the session's own start and end time on it (options.dateLines, from
 * buildDateLabelSets()). Adds a line when no date on the form serves lunch, a
 * line about club membership on a club form, and — always, last — the
 * assistance tagline, so every form ends with a way to reach a person.
 */
function buildFormDescription(locations, dateLabels, isFixed, hasLunchDates, options) {
  options = options || {};
  const list = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  // THE LINES, NOT THE LABELS, wherever the caller has them: a description
  // line is the same date with its clock time in it (buildDateLabelSets()).
  // The labels are the fallback for a caller that has none — and are still
  // what every other decision below is made on, because they are what the
  // form's grid rows actually read.
  //
  // NOT ON A LUNCH-ONLY FORM. Those sessions are dated at noon by
  // LUNCH_ONLY_SESSION_HOUR so that they sort and print sensibly — it is a
  // placeholder, not the hour the food goes out — and printing it would be
  // this system inventing a serving time and putting it in front of the
  // people who turn up by it.
  const lines = (!options.isLunchOnly && Array.isArray(options.dateLines) &&
      options.dateLines.length === dateLabels.length)
    ? options.dateLines
    : dateLabels;
  const dateList = lines.map(line => `• ${line}`).join('\n');
  const heading = list.length > 1
    ? `Locations:\n${list.map(loc => `• ${describeLocationWithAddress(loc)}`).join('\n')}\n` +
      `This program runs at more than one location; each date below says where.`
    : `Location: ${describeLocationWithAddress(list[0] || '')}`;
  // ONE DATE IS NOT "Dates". A one-off event's form led with a plural heading
  // over a list of one, which reads as a form that has lost most of its
  // content — and it is the first thing on the page. See section 1g for the
  // rest of what a one-date form does differently.
  const oneDate = dateLabels.length === 1;
  const dateHeading = oneDate ? 'Date:' : 'Dates:';
  let description = `${heading}\n\n${dateHeading}\n${dateList}\n\nPlease register below.`;
  if (options.isLunchOnly) {
    // Said FIRST and said plainly, because this form looks like every other
    // registration form and is not one: there is no program behind these
    // dates, only a meal, and somebody who signs up expecting an activity has
    // been misled by a page they had every reason to trust.
    description = `${heading}\n\nThis form is for lunch only. It reserves you a meal rather than a ` +
      `place in a program — to join a class or an activity, please use that program's own form.\n\n` +
      `Lunch is served on:\n${dateList}\n\nPlease sign up below.` +
      `\n\n${FORM_ASSISTANCE_TAGLINE}`;
    return description;
  }
  if (options.isAssistance) {
    // Said early and said plainly, for the same reason the lunch-only note is:
    // this form looks like every other registration form and asks something
    // different. Somebody who reads "Dates" and stops has not yet been told
    // that they are booking one time slot within one of those days.
    description = `${heading}\n\nThis is a one-to-one appointment, so you are booking a time rather ` +
      `than a whole day. Appointments are offered on:\n${dateList}\n\nPlease choose a time on the ` +
      `next page. Times already taken are not shown; if none of them suit you, tell us and we will ` +
      `call to arrange another.`;
    // LUNCH IS SERVED ON SOME OF THESE DAYS, and an appointment form is now
    // allowed to ask about it — see syncAssistanceQuestionsOnForm(). Somebody
    // seeing a dish beside their appointment date needs telling that they are
    // welcome to stay for it, not left to assume the meal comes with the
    // appointment.
    if (hasLunchDates !== false) {
      description += `\n\nLunch is served on some of these days, and you are welcome to stay for it. ` +
        `Say so under the time you pick and we will order one for you.`;
    }
    description += `\n\n${FORM_ASSISTANCE_TAGLINE}`;
    return description;
  }
  if (hasLunchDates === false) {
    // Nothing on this form is catered, so the form isn't asking about lunch
    // at all (see syncLunchQuestionsOnForm()) — say so rather than leaving
    // its absence to be guessed at.
    description += `\n\nLunch is not served on any of these dates, so this form does not ask about it.`;
  }
  if (options.isClub) {
    const title = String(options.programTitle || '').trim();
    description += `\n\nThis is a club, so you can sign up for ` +
      `${title ? `all future ${title} meetings` : 'all future meetings'} at once. You will stay on ` +
      `the list from then on, with no need to fill this in again each month.`;
  } else if (isFixed && !oneDate) {
    // Not on a one-date form: there is no first sign-up option on it to pick
    // (section 1g takes the question off), and "coming to every session?" of a
    // single session is a question with one possible answer.
    description += `\n\nComing to every session? Pick the first sign-up option and you will only need ` +
      `to tell us your lunch preference once.`;
  }
  description += `\n\n${FORM_ASSISTANCE_TAGLINE}`;
  return description;
}

