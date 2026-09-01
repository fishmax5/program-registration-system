// ============================================================================
// 1d. FORM DATE-LABEL WRITES  (fingerprinted — see applyFormDateLabels)
// ============================================================================
//
// Every path that pushes date labels onto a form funnels through
// applyFormDateLabels(). Writing a form item is a remote call AND creates a
// new form revision, and the labels are usually byte-identical to what's
// already there — refreshFormShapeForAllForms() in particular runs
// on EVERY hourly sync across every capped form. So we keep a hash of the
// last labels written per form in Script Properties and short-circuit
// before FormApp.openById() (itself the most expensive call in the path)
// whenever nothing changed.
//
// The fingerprint tracks only what THIS script writes. A human editing a
// form's grid rows by hand would not be noticed until the labels legitimately
// change again — pass { force: true } (or clear the property) to re-assert.
// ============================================================================

const FORM_LABEL_FINGERPRINT_PROP_KEY = 'FORM_LABEL_FINGERPRINTS_V1';

let __formLabelFingerprintCache = null;
let __formLabelFingerprintDirty = false;

function getFormLabelFingerprints() {
  if (__formLabelFingerprintCache) return __formLabelFingerprintCache;
  const raw = PropertiesService.getScriptProperties().getProperty(FORM_LABEL_FINGERPRINT_PROP_KEY);
  __formLabelFingerprintCache = raw ? JSON.parse(raw) : {};
  return __formLabelFingerprintCache;
}

/**
 * The hash a form's date-label write is skipped on. The SHAPE rides along with
 * the labels, and has to: a menu row typed for a month whose dates were
 * already on the form changes what the form should ASK ("does anybody want
 * lunch?") without changing a single date, and a fingerprint made of labels
 * alone said "nothing to do" — which is precisely how a form ended up showing
 * the dish beside every date with no lunch question anywhere on it. See
 * formLunchShapeKey() and refreshFormShapeForAllForms().
 */
function computeFormLabelFingerprint(attendanceLabels, lunchLabels, shape) {
  const raw = JSON.stringify([attendanceLabels, lunchLabels, shape || '']);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw);
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('');
}

/**
 * Sets a form's ATTENDANCE_GRID rows to attendanceLabels and its LUNCH_GRID
 * rows to lunchLabels, plus the mode page's date list, skipping the whole
 * thing when the labels match what we last wrote to that form.
 *
 * An EMPTY lunchLabels list means no date on this form serves lunch, in which
 * case the lunch grid isn't on the form at all any more (see
 * syncLunchQuestionsOnForm()) — the loop below simply finds nothing to write.
 *
 * THE MODE PAGE'S DATE LIST RIDES ALONG HERE deliberately, rather than being
 * written by whichever caller happens to know the dates. It is derived from
 * attendanceLabels, which is exactly what the fingerprint already covers, so
 * putting it here means it is refreshed on precisely the syncs that change the
 * dates and skipped on the many that do not — and no caller can add a date to
 * a form's grids while leaving the mode page describing the old set.
 *
 * options.form    — an already-open Form, to avoid a second openById()
 * options.force   — write even if the fingerprint matches
 * options.shape   — formLunchShapeKey() for this form, folded into the
 *                   fingerprint so a form whose QUESTIONS should change is
 *                   re-examined even when its labels have not moved. Callers
 *                   that hold a form context all pass it; one that does not
 *                   simply fingerprints the labels as before.
 * options.context — short string for the log line on failure
 * Returns true if the form was actually written to.
 */
function applyFormDateLabels(formId, attendanceLabels, lunchLabels, options) {
  options = options || {};
  const fingerprint = computeFormLabelFingerprint(attendanceLabels, lunchLabels, options.shape);
  const fingerprints = getFormLabelFingerprints();
  if (!options.force && fingerprints[formId] === fingerprint) return false;

  try {
    const form = options.form || FormApp.openById(formId);
    const items = form.getItems();
    // Found by either title: on a lunch-only form this same grid is the lunch
    // question and has been renamed to say so. See LUNCH_ONLY_GRID.
    findRosterGridItems(items).forEach(it => it.asCheckboxGridItem().setRows(attendanceLabels));
    if (lunchLabels && lunchLabels.length > 0) {
      items.filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.LUNCH_GRID)
        .forEach(it => it.asCheckboxGridItem().setRows(lunchLabels));
    }

    // Type-guarded as well as titled, for the reason spelled out on
    // TEMPLATE_PAGE_TITLES.MODE: a question and a page break must never be
    // confused for one another by a title lookup.
    //
    // FOUND UNDER EITHER TITLE. A form covering one session has this page
    // retitled (TEMPLATE_PAGE_TITLES.SINGLE_DATE), and on THAT form the date
    // note is the whole content of the page rather than a preamble to a
    // question — so it is the one form where failing to write it would leave a
    // section saying nothing at all. Same reasoning as the roster grid, which
    // is likewise looked up under both of its titles.
    const modeNote = buildModePageDateNote(attendanceLabels);
    if (modeNote) {
      items.filter(it => it.getType() === FormApp.ItemType.PAGE_BREAK &&
        (it.getTitle() === TEMPLATE_PAGE_TITLES.MODE ||
          it.getTitle() === TEMPLATE_PAGE_TITLES.SINGLE_DATE))
        .forEach(it => it.asPageBreakItem().setHelpText(modeNote));
    }
  } catch (err) {
    log(`⚠️ Could not write the date labels on ${describeFormLink(formId)}` +
      `${options.context ? ` (${options.context})` : ''}: ${err}. Its dates will read as whatever they ` +
      `said before — usually a stale capacity or a date that has moved.`);
    return false;
  }

  fingerprints[formId] = fingerprint;
  __formLabelFingerprintDirty = true;
  invalidateFormItemIndex(formId); // cached grid row/column shapes for this form are now stale
  return true;
}

/**
 * The link we hand out: the form's own published URL, with nothing pre-filled.
 *
 * IT USED TO BE A PREFILLED URL with every box in both roster grids already
 * ticked — every person, every date — on the theory that "we're all coming to
 * everything" is the common case and unticking the exceptions is less work
 * than ticking the rule. In practice a pre-ticked box is not a shortcut, it is
 * an assertion made on the respondent's behalf: someone who skims the grid,
 * sees checks, and submits has told us they are coming to nine sessions they
 * never read. That produces catering for people who will not be there, and it
 * is invisible to them and to us until the day. The "sign up for every date"
 * option now covers the genuine all-in case explicitly, as an answer someone
 * actually gives.
 *
 * It also removes a standing fragility: a prefill value only matches a row
 * whose label is still byte-identical, so appending "(FULL - Waitlist)" to a
 * date, or rebuilding a form onto a new template, silently stopped part of the
 * URL working until it was regenerated.
 */
function buildRegistrationUrl(form) {
  return form.getPublishedUrl();
}

/**
 * Deletes a set of items from a form, HIGHEST INDEX FIRST. Returns how many
 * went.
 *
 * The order is the whole point. An Apps Script `Item` carries the index it had
 * when `getItems()` handed it over, and `deleteItem()` acts on that index — so
 * deleting forward through a filtered list invalidates every later item's
 * index by one. Usually that silently deletes the WRONG item; when the last
 * item in the form is among the doomed, it fails outright with
 * "Cannot access item at index: N. Number of items: N", which is what this
 * cost on a v3 form carrying two "Footer Note" headers, the second of them
 * last on the form.
 *
 * Deleting from the end backwards means no surviving item's index ever moves.
 */
function deleteFormItems(form, items, describe) {
  const ordered = (items || []).slice().sort((a, b) => b.getIndex() - a.getIndex());
  let removed = 0;
  ordered.forEach(item => {
    const title = item.getTitle();
    try {
      form.deleteItem(item);
      removed++;
    } catch (err) {
      log(`⚠️ Could not remove "${title}" from ${describe || `form ${form.getId()}`} (${err}).`);
    }
  });
  return removed;
}

/**
 * Transient Forms failures, by the text Google puts in them.
 *
 * "Failed to edit the form. Please wait and try again." is the API telling you
 * it is being written to faster than it likes — which is exactly what
 * rebuilding a form does, since that is ~15 deletes and ~20 adds back to back,
 * repeated per form. It is not a defect in the form and the same call succeeds
 * moments later.
 */
const TRANSIENT_FORM_ERROR_PATTERNS = [
  /please wait and try again/i,
  /failed to edit the form/i,
  /service (unavailable|error)/i,
  /internal error/i,
  /try again later/i,
  /too many/i
];

function isTransientFormError(err) {
  const text = String((err && err.message) || err || '');
  return TRANSIENT_FORM_ERROR_PATTERNS.some(p => p.test(text));
}

/**
 * The errors that mean "this account is not allowed to touch that", by the
 * words Google puts in them.
 *
 * Worth telling apart from every other failure because the FIX is different
 * and specific: a permission error is not a bug in this script and will not
 * come right on the next run — it is a file created by one account and read by
 * another, and it stays broken until somebody opens the file up (see
 * openUpFileToAnyoneWithLink()). Everything else deserves the ordinary "it
 * failed, here is what it said".
 */
const PERMISSION_ERROR_PATTERNS = [
  /permission/i,
  /do(es)? not have access/i,
  /access denied/i,
  /not authorized/i,
  /you are not allowed/i,
  /protected (cell|range|sheet)/i,
  /unable to open/i
];

function isPermissionError(err) {
  const text = String((err && err.message) || err || '');
  return PERMISSION_ERROR_PATTERNS.some(p => p.test(text));
}

/** Attempts before giving up, and the backoff between them (ms). */
const FORM_RETRY_DELAYS_MS = [1000, 3000, 8000];

/**
 * Runs `fn`, retrying with backoff when Forms says it is busy rather than that
 * something is wrong. A NON-transient error is re-thrown immediately — a
 * genuine defect does not get better by being repeated, and burning twelve
 * seconds discovering that costs the sync's whole budget.
 *
 * Safe for the form rebuilds it wraps: those are written to be re-runnable
 * (delete-everything-then-rebuild reaches the same end state whether it starts
 * from a full form or a half-emptied one).
 */
function withFormRetry(label, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!isTransientFormError(err) || attempt >= FORM_RETRY_DELAYS_MS.length) throw err;
      const wait = FORM_RETRY_DELAYS_MS[attempt];
      log(`ℹ️ ${label}: Forms is busy (${err}) — waiting ${wait}ms and trying again ` +
        `(attempt ${attempt + 2} of ${FORM_RETRY_DELAYS_MS.length + 1}).`);
      Utilities.sleep(wait);
    }
  }
}

/**
 * Strips both lunch questions — the per-date LUNCH_GRID and the all-dates
 * who-eats checkbox — off a form that has no lunch to offer: a location
 * whose catering policy is NEVER, or a form none of whose dates serve
 * lunch. Asking someone to pick a lunch that isn't being served is noise at
 * best and a wrong expectation at worst.
 *
 * The parser needs no special case for this: getGridResponseByTitle()
 * returns null when the item is absent and getResponseValueByTitle()
 * returns '', both of which already resolve to "No Lunch" for everyone.
 */
function removeLunchQuestionsFromForm(form, locations, reason) {
  const where = describeLocations(Array.isArray(locations) ? locations : [locations]);
  // The extra-meals question goes with them: it is a question ABOUT the meal,
  // and asking how many extra of a meal nobody is serving is worse than not
  // asking at all.
  const doomed = [TEMPLATE_ITEM_TITLES.LUNCH_GRID, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE,
    TEMPLATE_ITEM_TITLES.EXTRA_MEALS];
  const removed = deleteFormItems(form,
    form.getItems().filter(item => doomed.indexOf(item.getTitle()) !== -1),
    `the ${where} form`);
  if (removed > 0) {
    log(`Removed ${removed} lunch question(s) from a ${where} form — ` +
      (reason || `no location on it caters (policy "${CATERING_POLICIES.NEVER}")`) + '.');
  }
  return removed;
}

/**
 * The inverse of removeLunchQuestionsFromForm(): puts a stripped lunch
 * question back when lunch returns to a form (a Grouped series that gains its
 * first catered date, a menu row added to a By-exception location). Without
 * this, "hide the question when there's nothing to eat" would be a one-way
 * door on a form that outlives the dates it was created with.
 *
 * A re-added item lands at the END of the form, so each one is moved back to
 * its template position — beside the attendance grid on the Specific Dates
 * page, and first on the Everyone, Every Date page. Rows are left as the
 * placeholder; the caller's applyFormDateLabels({ force: true }) sets them.
 */
function restoreLunchQuestionsOnForm(form) {
  const titles = form.getItems().map(it => it.getTitle());
  let restored = 0;

  if (titles.indexOf(TEMPLATE_ITEM_TITLES.LUNCH_GRID) === -1) {
    const gridItem = addLunchGridItem(form);
    const attendanceIdx = form.getItems().findIndex(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID);
    if (attendanceIdx !== -1) form.moveItem(gridItem.getIndex(), attendanceIdx + 1);
    restored++;
  }

  if (titles.indexOf(TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE) === -1) {
    const checkboxItem = addAllDatesLunchItem(form);
    const pageIdx = form.getItems().findIndex(it =>
      it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === TEMPLATE_PAGE_TITLES.ALL_DATES);
    if (pageIdx !== -1) form.moveItem(checkboxItem.getIndex(), pageIdx + 1);
    restored++;
  }

  // One extra-meals question per BRANCH PAGE, the same as the template builds:
  // a respondent meets exactly one of the two pages, and a single shared item
  // could only live on one of them.
  [TEMPLATE_PAGE_TITLES.ALL_DATES, TEMPLATE_PAGE_TITLES.SPECIFIC_DATES].forEach(pageTitle => {
    if (countExtraMealsItemsOnPage(form, pageTitle) > 0) return;
    const item = addExtraMealsItem(form);
    // It belongs immediately after the last question on its page that is not
    // one of the two closing ones — i.e. right behind the lunch question,
    // which is what it is a follow-up to.
    const anchorIdx = lastLunchQuestionIndexOnPage(form, pageTitle);
    if (anchorIdx !== -1) form.moveItem(item.getIndex(), anchorIdx + 1);
    restored++;
  });

  if (restored > 0) log(`Restored ${restored} lunch question(s) to form ${form.getId()} — it has catered dates again.`);
  return restored;
}

/**
 * The item indexes that make up ONE page of a form: everything after that
 * page's break, up to the next one (or the end).
 *
 * Every other lookup in this file finds an item by title across the whole
 * form, which is exactly what will not do for the extra-meals question: there
 * are legitimately TWO of it, one per branch page, and a form-wide "is it
 * there?" answers yes when the page a respondent is actually on has lost it.
 */
function formPageItemRange(form, pageTitle) {
  const items = form.getItems();
  const start = items.findIndex(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === pageTitle);
  if (start === -1) return null;
  let end = items.length;
  for (let i = start + 1; i < items.length; i++) {
    if (items[i].getType() === FormApp.ItemType.PAGE_BREAK) { end = i; break; }
  }
  return { items, start, end };
}

/** How many extra-meals questions one branch page carries — 0 or 1 in a healthy form. */
function countExtraMealsItemsOnPage(form, pageTitle) {
  const range = formPageItemRange(form, pageTitle);
  if (!range) return 0;
  let count = 0;
  for (let i = range.start + 1; i < range.end; i++) {
    if (range.items[i].getTitle() === TEMPLATE_ITEM_TITLES.EXTRA_MEALS) count++;
  }
  return count;
}

/**
 * The index of the last LUNCH question on a branch page — the grid on the
 * specific-dates page, the who-eats checkbox on the all-dates one — or the
 * page break itself when neither is there yet.
 *
 * Used to park the extra-meals question directly behind whatever it is a
 * follow-up to, so a restored item does not land at the bottom of the form
 * under "Anything Else?" where it reads as a question about something else.
 */
function lastLunchQuestionIndexOnPage(form, pageTitle) {
  const range = formPageItemRange(form, pageTitle);
  if (!range) return -1;
  const lunchTitles = [TEMPLATE_ITEM_TITLES.LUNCH_GRID, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE,
    TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID, TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID];
  let found = range.start;
  for (let i = range.start + 1; i < range.end; i++) {
    if (lunchTitles.indexOf(range.items[i].getTitle()) !== -1) found = i;
  }
  return found;
}

/**
 * Single decision point for whether a form asks about lunch at all: it does
 * when at least one of its locations caters AND at least one date on the form
 * actually serves lunch. Both directions are handled, so a form self-heals
 * whichever way its schedule moves.
 *
 * "At least one of its locations" is what a cross-location form needs: a
 * shared form covering a catering site and a Never site must still ask, and
 * the Never site's dates are already absent from the lunch grid because
 * buildDateLabelSets() filters per date+location.
 *
 * Per-DATE filtering is separate and already handled by buildDateLabelSets()
 * — the lunch grid's rows are only the dates that serve lunch, so a date
 * marked "Not Serving" never appears as a lunch row even on a form whose
 * other dates do.
 *
 * Returns how many questions were added or removed, so a caller can force
 * the date-label write that has to follow a restore (a restored grid still
 * holds the template's placeholder row).
 */
function syncLunchQuestionsOnForm(form, locations, hasLunchDates, options) {
  const list = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  // A LUNCH-ONLY FORM IS SHAPED SEPARATELY, and takes precedence over both
  // branches below. It cannot go down the "no lunch here" path (a form whose
  // only subject is lunch, with its lunch questions stripped, is an empty
  // form) and it must not go down the restore path either, which would put
  // back the very second grid makeFormLunchOnly() exists to remove — a
  // tug-of-war fought fresh on every hourly sync.
  if (options && options.isLunchOnly) return makeFormLunchOnly(form);

  // AN APPOINTMENT PROGRAM NEVER CARRIES THE ROSTER LUNCH QUESTIONS, and it
  // has to be said HERE rather than only in the assistance pass: this function
  // runs first on every sync, and would otherwise restore the two lunch
  // questions that pass then deletes again — two Forms writes an hour, forever,
  // and a form whose shape depends on which of the two ran last.
  //
  // It is NOT the same as "an appointment form never asks about lunch". Such a
  // form does ask, where lunch is served: one yes/no about the single day just
  // booked, put on by applyAppointmentLunchQuestion(). What comes off here are
  // the per-date GRIDS, which are the wrong shape for a form on which a person
  // picks one time on one day — see ASSISTANCE_TAG.
  if (options && options.isAssistance) {
    return removeLunchQuestionsFromForm(form, list,
      'this program is booked by appointment (it asks about lunch one day at a time instead)');
  }

  const catersSomewhere = list.some(loc => getCateringPolicyForLocation(loc) !== CATERING_POLICIES.NEVER);
  if (!catersSomewhere) {
    return removeLunchQuestionsFromForm(form, list);
  }
  if (!hasLunchDates) {
    return removeLunchQuestionsFromForm(form, list, 'no date on this form serves lunch');
  }
  return restoreLunchQuestionsOnForm(form);
}

/**
 * THE SAME DECISION, ON ITS OWN — does a form with these locations and this
 * many lunch dates ask about lunch at all? It is the pair of conditions the
 * function above branches on, lifted out because two other places now need the
 * answer without wanting the roster questions written: the appointment shape,
 * which asks it about its own yes/no (applyAppointmentLunchQuestion()), and
 * the hourly all-forms pass, which folds the answer into its fingerprint so a
 * form whose lunch shape has changed is opened even when its date labels have
 * not (refreshFormShapeForAllForms()).
 */
function formWantsLunchQuestions(locations, hasLunchDates) {
  const list = (Array.isArray(locations) ? locations : [locations]).filter(Boolean);
  if (hasLunchDates === false) return false;
  return list.some(loc => getCateringPolicyForLocation(loc) !== CATERING_POLICIES.NEVER);
}

/**
 * WHAT SHAPE THIS FORM'S LUNCH QUESTIONS SHOULD BE IN, as a short string —
 * the answer syncLunchQuestionsOnForm() and the appointment pass are about to
 * act on, written down so a cheap comparison can notice it has changed.
 *
 * Four answers, because there are four shapes: the lunch-only form (one grid,
 * which is the meal), the appointment form with and without its yes/no, and
 * the ordinary form with or without its two roster questions.
 */
function formLunchShapeKey(context, hasLunchDates) {
  const ctx = context || {};
  if (ctx.isLunchOnly) return 'lunch-only';
  const asks = formWantsLunchQuestions(ctx.locations || [], hasLunchDates);
  if (ctx.isAssistance) return asks ? 'appointment+lunch' : 'appointment';
  return asks ? 'lunch' : 'no-lunch';
}

/** True when any session in a form context falls on a day its own location caters. */
function contextHasLunchDates(context) {
  return !!context && (context.sessions || []).some(session =>
    isLunchOfferedOn(session.date, session.location));
}

/**
 * Turns a copy of the standard template into THE LUNCH-ONLY FORM: one grid,
 * one question, no attendance.
 *
 * The standard template asks two per-date questions — who is coming, and who
 * is eating. On a form whose entire subject is the meal those are the same
 * question, and asking both produces the failure mode staff already know from
 * the paper sheets: somebody ticks the lunch row, leaves the attendance row
 * blank, and the import has to guess (processFormResponse() reconciles it with
 * a warning). So the LUNCH_GRID is deleted and the ATTENDANCE_GRID is renamed
 * to be the lunch question — the one that stays is the one every existing
 * lookup already finds, by index and by both titles, which is why this is a
 * rename rather than a swap.
 *
 * processFormResponse() reads a tick on that grid as "wants lunch" whenever
 * the session behind it is a lunch-only one, so nothing downstream has to know
 * which of the two titles the grid happened to carry.
 *
 * The all-dates branch is left exactly as it is: its question is already
 * ALL_DATES_LUNCH_PEOPLE ("Who Needs Lunch?"), which is the right question on
 * this form without any change at all.
 *
 * Idempotent — it runs on every sync for every lunch-only form, and after the
 * first pass finds nothing to remove and nothing to rename.
 */
function makeFormLunchOnly(form) {
  let changed = 0;

  const removed = deleteFormItems(form,
    form.getItems().filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.LUNCH_GRID),
    `the lunch-only form ${form.getId()}`);
  changed += removed;

  // Re-read: a deletion above shifted every later item's index.
  form.getItems()
    .filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_GRID)
    .forEach(it => {
      try {
        it.asCheckboxGridItem()
          .setTitle(TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID)
          .setHelpText('Tick a box for each person on each date they want lunch.\n\n' +
            NO_GUESTS_NOTE + '\n\n' + GUEST_ORDER_REMINDER);
        changed++;
      } catch (err) {
        log(`⚠️ Could not retitle the roster grid on lunch-only form ${form.getId()} (${err}).`);
      }
    });

  if (changed > 0) {
    log(`Shaped form ${form.getId()} as lunch-only: ${removed} duplicate lunch grid(s) removed, roster grid renamed.`);
    invalidateFormItemIndex(form.getId());
  }
  return changed;
}


// ---------------------------------------------------------------------------
// 1g. A FORM COVERING ONE SESSION  (the one-off event)
// ---------------------------------------------------------------------------
//
// A single lecture on the 5th of March gets a form built from the same
// template as a twelve-week series, and that template's whole spine is a
// question about WHICH DATES: "I want to sign up for all events this month" or
// "I want to choose specific days this month to attend", branching to an
// every-date page or to a roster grid. Over a list of one date, both options
// mean the identical thing, the grid is a table with one row, and the question
// is a fork in the road where both branches lead to the same house. People
// stop and read it, because a required question at the front of a form reads
// as consequential; several of them pick the second option and then tick a
// single box to say the thing they had already said by opening the form.
//
// So a one-date form does not ask. The mode question comes off, and the page
// that held it is retitled to say which date this is — the section
// description underneath it already lists the date, written by
// applyFormDateLabels(), so the page stops being a fork and becomes the
// confirmation a one-off event actually wants.
//
// REVERSIBLE, which is why the page is retitled rather than deleted. A
// program that gains a second date in the same month is not a rare event —
// it is what "we've added another session" means — and the form must go back
// to asking on the very next sync, with the question back on the page it came
// off and every navigation still aimed at it. Deleting the page would have
// meant rebuilding one in the right position, which is a much less certain
// thing to do to a form people are registering on.
//
// WHAT READS IT BACK. processFormResponse() takes the every-date path when the
// response carries no mode answer AND the form has no mode question to have
// answered — the form's own shape, exactly as an appointment form is
// recognized by carrying the time question. On a one-date form "every date on
// this form" is that date, which is what was meant.
// ---------------------------------------------------------------------------

/**
 * Shapes a form for the number of sessions it actually covers: one, or more
 * than one. Idempotent in both directions and safe to call on every sync,
 * which is what it does.
 *
 * Returns how many form writes it made — 0 in the steady state.
 */
function syncSessionCountShapeOnForm(form, context) {
  // AN APPOINTMENT FORM HAS ALREADY GIVEN UP ITS MODE QUESTION, for its own
  // reasons (see syncAssistanceQuestionsOnForm), and one appointment session
  // is still a page of times to choose between. Leaving it alone here is what
  // stops the two shapes from taking the question off and putting it back on
  // alternate syncs.
  if (context && context.isAssistance) return 0;
  const sessionCount = (context && context.sessions) ? context.sessions.length : 0;
  if (sessionCount === 0) return 0; // nothing known about it — change nothing

  // A CLUB FORM KEEPS ITS QUESTION HOWEVER FEW DATES IT COVERS, and this is the
  // one that would have been a real loss. The club option — "I want to sign up
  // for all future Book Club meetings" — is a choice on the mode question, and
  // it is not a choice about dates at all: it is how somebody joins the roster
  // and stops having to fill the form in every month. A book club that happens
  // to meet once in March would have had that option deleted along with the
  // question, leaving its members no way to join from the form the club is
  // advertised with.
  //
  // Written as a condition on the collapse rather than an early return, so the
  // OTHER direction still runs: a one-date form that was collapsed before
  // anybody ticked [Club] has to get its question back the moment somebody
  // does, and an early return would have left it collapsed forever.
  const shouldCollapse = sessionCount === 1 && !(context && context.isClub);
  return shouldCollapse
    ? collapseFormToSingleSession(form, context)
    : restoreMultiSessionShapeOnForm(form);
}

/**
 * Takes the mode question off a form covering one session and retitles the
 * page it sat on.
 *
 * Costs one getItems() and nothing else once it has run: the question is gone,
 * the page is already titled, and both checks fail on the second pass.
 */
function collapseFormToSingleSession(form, context) {
  const items = form.getItems();
  let changed = 0;

  // Guarded by the presence of the branch pages, the same way
  // applyAttendanceModeChoices() guards writing to them: a form that has been
  // edited into some other shape is left as it is rather than half-converted.
  const pageOf = title => items.filter(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK && it.getTitle() === title)[0] || null;
  const modePage = pageOf(TEMPLATE_PAGE_TITLES.MODE) || pageOf(TEMPLATE_PAGE_TITLES.SINGLE_DATE);
  const allDatesPage = pageOf(TEMPLATE_PAGE_TITLES.ALL_DATES);
  if (!modePage || !allDatesPage) return 0;

  const modeQuestion = items.filter(it =>
    it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK);
  changed += deleteFormItems(form, modeQuestion, `the one-date form ${form.getId()}`);

  if (modePage.getTitle() !== TEMPLATE_PAGE_TITLES.SINGLE_DATE) {
    modePage.asPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.SINGLE_DATE);
    changed++;
  }
  // STRAIGHT ON TO THE EVERY-DATE PAGE, said out loud rather than left to
  // document order. Document order is right on a form built from the template
  // — but a form that used to be an appointment form has this page pointed at
  // the roster grid (syncAssistanceQuestionsOnForm sets it there), and the
  // grid branch is exactly where a form with no mode question must not send
  // people: nobody ever ticks its one row, so nobody is ever registered.
  // THE READ AND THE WRITE ARE IN SEPARATE try BLOCKS ON PURPOSE. A page break
  // that has never had setGoToPage() called on it — its default state, e.g.
  // straight out of addTemplateItemsToForm() — carries navigation type
  // CONTINUE, not a page target, and getGoToPage() THROWS rather than
  // returning null when asked for one. That used to be caught by the same
  // try/catch guarding the write below it, so the exception from the READ
  // skipped the WRITE entirely: this page's navigation was silently left on
  // its default, and a respondent who reached it — having just had the mode
  // question taken off — met a page with nothing to send them anywhere,
  // Google Forms' own "Submit" button standing in for a broken "Next". A
  // failed read now only means "assume it needs fixing"; it can no longer
  // swallow the fix.
  let currentTargetId = null;
  try {
    const current = modePage.asPageBreakItem().getGoToPage();
    if (current) currentTargetId = current.getId();
  } catch (err) {
    // Not pointed at a page yet (still CONTINUE, or some other non-page
    // navigation) — currentTargetId stays null, which the check below treats
    // exactly like "needs fixing".
  }
  if (currentTargetId !== allDatesPage.getId()) {
    try {
      modePage.asPageBreakItem().setGoToPage(allDatesPage.asPageBreakItem());
      changed++;
    } catch (err) {
      log(`Could not point the date page of form ${form.getId()} at the sign-up page (${err}).`);
    }
  }

  if (changed > 0) {
    const where = context ? describeLocations(context.locations) : '';
    log(`Shaped form ${form.getId()} for its one session${where ? ` (${where})` : ''}: ` +
      `the "how would you like to sign up?" question is off, since there is one date to sign up for.`);
    invalidateFormItemIndex(form.getId());
  }
  return changed;
}

/**
 * The other direction: a form that covers several sessions again gets its mode
 * question back, on the page it came off.
 *
 * THE CHEAP CASE IS THE COMMON ONE. Nearly every form in the workbook covers
 * several dates and has never been collapsed, so this finds the page under its
 * ordinary title, sees the question sitting there, and returns having written
 * nothing.
 */
function restoreMultiSessionShapeOnForm(form) {
  const items = form.getItems();
  const singlePage = items.filter(it =>
    it.getType() === FormApp.ItemType.PAGE_BREAK &&
    it.getTitle() === TEMPLATE_PAGE_TITLES.SINGLE_DATE)[0] || null;
  if (!singlePage) return 0; // never collapsed — the overwhelmingly common case

  // A FORM CARRYING THE TIME QUESTION IS AN APPOINTMENT FORM whatever the
  // context says, and its mode question is meant to be absent. Read off the
  // form itself for the same reason processFormResponse() does: the shape is
  // the fact, a checkbox is an opinion about it.
  const isAppointmentForm = items.some(it =>
    it.getTitle() === TEMPLATE_ITEM_TITLES.APPOINTMENT &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK);
  if (isAppointmentForm) return 0;

  singlePage.asPageBreakItem().setTitle(TEMPLATE_PAGE_TITLES.MODE);
  let changed = 1;

  const hasMode = items.some(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE &&
    it.getType() !== FormApp.ItemType.PAGE_BREAK);
  if (!hasMode) {
    const item = form.addListItem().setTitle(TEMPLATE_ITEM_TITLES.ATTENDANCE_MODE).setRequired(true);
    // Added items land at the END of the form; it belongs immediately under
    // the page break it is the only question on.
    try {
      form.moveItem(item.getIndex(), singlePage.getIndex() + 1);
    } catch (err) {
      log(`Put the sign-up question back on form ${form.getId()} but could not move it onto its page ` +
        `(${err}) — the form needs "Update One Form" run on it.`);
    }
    changed++;
  }

  log(`Form ${form.getId()} covers several dates again — the "how would you like to sign up?" question is back. ` +
    `Its choices are set by the caller's applyAttendanceModeChoices().`);
  invalidateFormItemIndex(form.getId());
  return changed;
}


