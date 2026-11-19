// ============================================================================
// 99ze. A FORM WHOSE PROGRAM HAS ENDED STOPS BEING READ EVERY HOUR
// ============================================================================
//
// The import (27) opens every form the session table names and asks it for
// its new responses — every hour, and every form, including the ones whose
// last session was in the spring. A Regular program takes a new form every
// month and the old ones never leave the `Form_ID` column (the Past section
// keeps them as the record of where each registration came from), so the list
// only grows, and every entry on it is a FormApp.openById() plus a
// getResponses() — a second or two each, for forms that will never receive
// another registration anybody means.
//
// So a form whose LAST session ended more than ENDED_FORM_CLOSE_DAYS ago is
// closed — `setAcceptingResponses(false)` with a message saying the program
// has ended — and, once one more sync window has read it, dropped from the
// hourly list. Closed is what makes dropping it safe: a form that cannot take
// a response cannot be holding one behind the sync clock.
//
// THE ONE EXTRA READ, and why it is not optional. The sync clock is the moment
// a window OPENED (27), so a response that lands between the read and the close
// belongs to the NEXT window — which must therefore still read this form. A
// form is left on the list until the clock has passed the moment it was closed
// (`endedFormStillOwedARead_`), which is exactly one more hourly read.
//
// THE RULES THAT KEEP IT FROM BEING DESTRUCTIVE, the same two the horizon
// (23) and [No Registration] keep:
//
//   ONLY A FORM THIS FILE CLOSED IS EVER RE-OPENED. A form somebody closed by
//   hand, or that the horizon or [No Registration] closed, is recorded as
//   ended (so it still leaves the hourly list — it cannot take responses
//   either) but `closedByUs` is false, and nothing here re-opens it.
//
//   A FORM THAT GAINS A SESSION AGAIN IS LIVE AGAIN. A [Grouped] series
//   extended in January, or a form a date was moved onto (47), names an
//   upcoming session once more; it is re-opened (if this closed it) and goes
//   back on the hourly list. Nothing could be submitted while it was closed,
//   so there is no gap behind the clock to fill.
//
// A form marked for a full re-import (99) is read whatever this says — that
// list is joined onto the plan separately, from the beginning of time.
//
// A LUNCH-ONLY FORM ENDS WHEN IT HAS NO SERVED DAY LEFT TO OFFER, not a week
// after its last row. Its rows can outlive their menu (13 keeps a "Not
// Serving" date that people signed up for, so the record of who asked
// survives), and a day the kitchen is not serving is not one anybody can sign
// up for. So a form whose every row is a lunch-only row is judged by its
// UPCOMING days that isLunchOfferedOn() (15) still says yes to. With none
// left it is ended at once (NO_SERVED_DAY_KEY sorts before any cutoff); if
// that is because upcoming days turned to "Not Serving", the closed message
// says so rather than that a program ended. Turning a day back to a catered
// menu revives it through the same rule as any other form: only a form this
// file closed is re-opened.
//
// Numbered after `99zd` for the usual reason — never renumber. Behavior plus
// self-contained constants; everything it reaches for (`openFormCached`,
// `formatDateKey`, `coerceDate`, `CENTER_PHONE`) it reads at CALL time.
// ============================================================================

/** Days after a form's last session before it is closed and left out of the hourly import. */
const ENDED_FORM_CLOSE_DAYS = 7;

/**
 * { formId: { closedAt: ISO, closedByUs: bool, lastSession: 'yyyy-MM-dd' } }.
 * Versioned like every stored shape.
 */
const ENDED_FORMS_PROP_KEY = 'ENDED_FORMS_CLOSED_V1';

/** A first deploy may find dozens; the rest are closed on the following runs. */
const ENDED_FORMS_MAX_CLOSES_PER_RUN = 25;

/** The "last session" of a lunch-only form with no served day left: earlier than any cutoff. */
const NO_SERVED_DAY_KEY = '0000-01-01';

function readEndedForms() {
  try {
    const parsed = JSON.parse(PropertiesService.getScriptProperties().getProperty(ENDED_FORMS_PROP_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeEndedForms_(ended) {
  PropertiesService.getScriptProperties().setProperty(ENDED_FORMS_PROP_KEY, JSON.stringify(ended));
}

/**
 * { formId: 'yyyy-MM-dd' } — the latest session date each form covers, over
 * BOTH sections of the session table. A form with any row whose date cannot
 * be read is left out entirely: not knowing when it ends is not knowing that
 * it has.
 *
 * A form whose every row is lunch-only counts only its upcoming served days,
 * and one with none gets NO_SERVED_DAY_KEY — see the header. `notServingFormIds`
 * (when passed) collects the ones that lost upcoming days to "Not Serving", so
 * the close can say so.
 */
function lastSessionDateByForm_(sessionRows, notServingFormIds, now) {
  const todayKey = formatDateKey(now || new Date());
  const map = getIndexMap(HEADERS.All_Program_Sessions);
  const latest = {};
  const latestServed = {};
  const unreadable = {};
  const notLunchOnly = {};
  const notServingAhead = {};
  const seen = {};
  (sessionRows || []).forEach(row => {
    const formId = String(row[map['Form_ID']] || '').trim();
    if (!formId) return;
    seen[formId] = true;
    const lunch = isLunchOnlyEventId(row[map['Event_ID']]);
    if (!lunch) notLunchOnly[formId] = true;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) { unreadable[formId] = true; return; }
    const key = formatDateKey(date);
    if (!latest[formId] || key > latest[formId]) latest[formId] = key;
    if (!lunch || key < todayKey) return;
    let served = true; // a menu tab that cannot be read never closes a form
    try {
      served = isLunchOfferedOn(date, String(row[map['Location']] || '').trim());
    } catch (err) {
      served = true;
    }
    if (!served) {
      notServingAhead[formId] = true;
    } else if (!latestServed[formId] || key > latestServed[formId]) {
      latestServed[formId] = key;
    }
  });
  Object.keys(seen).forEach(formId => {
    if (notLunchOnly[formId] || !latest[formId] || latestServed[formId]) return;
    // Past rows only: it ends a week after the last one, like any form.
    if (!notServingAhead[formId]) return;
    latest[formId] = NO_SERVED_DAY_KEY;
    if (notServingFormIds) notServingFormIds[formId] = true;
  });
  Object.keys(unreadable).forEach(id => delete latest[id]);
  return latest;
}

/** The date key on or before which a form's last session makes it ended. */
function endedFormCutoffKey_(now) {
  const today = parseDateKey(formatDateKey(now || new Date()));
  return formatDateKey(new Date(today.getTime() - ENDED_FORM_CLOSE_DAYS * 86400000));
}

/**
 * Pure: which forms have ended (last session on or before the cutoff), and
 * which recorded ones have come back to life (a session after it).
 */
function classifyEndedForms(lastByForm, ended, cutoffKey) {
  const toClose = [];
  const revived = [];
  Object.keys(lastByForm).forEach(formId => {
    const isEnded = lastByForm[formId] <= cutoffKey;
    if (isEnded && !ended[formId]) toClose.push(formId);
    if (!isEnded && ended[formId]) revived.push(formId);
  });
  return { toClose, revived };
}

/**
 * True while a recorded form still has one window to be read in: the window
 * this plan is reading opened (`lastSync`) BEFORE the form was closed, so a
 * response submitted in between is behind no clock yet.
 */
function endedFormStillOwedARead_(entry, lastSync) {
  if (!entry || !entry.closedAt) return true;
  const closedAt = new Date(entry.closedAt).getTime();
  const since = lastSync instanceof Date ? lastSync.getTime() : new Date(lastSync).getTime();
  if (!isFinite(closedAt) || !isFinite(since)) return true;
  return closedAt >= since;
}

/**
 * The hourly work list with the ended forms taken out. Called once per plan,
 * where 27 first writes the list down.
 */
function withoutEndedForms(formIds, lastSync) {
  const ended = readEndedForms();
  const kept = [];
  let left = 0;
  (formIds || []).forEach(id => {
    if (ended[id] && !endedFormStillOwedARead_(ended[id], lastSync)) { left++; return; }
    kept.push(id);
  });
  // The caller's own array when nothing was left out: most hours, nothing is.
  if (left === 0) return formIds || [];
  log(`Registration sync: ${left} form(s) whose programs ended more than ${ENDED_FORM_CLOSE_DAYS} ` +
    `day(s) ago are closed and not read this hour.`);
  return kept;
}

function endedFormClosedMessage_() {
  let phone = '';
  try { phone = CENTER_PHONE; } catch (err) { phone = ''; }
  return 'Registration for these dates has ended. To sign up for a current session, please use the ' +
    'link on the program calendar' + (phone ? ` or call ${phone}` : '') + '.';
}

function lunchNotServingClosedMessage_() {
  let phone = '';
  try { phone = CENTER_PHONE; } catch (err) { phone = ''; }
  return 'Lunch is not being served on the dates this form covers, so it is no longer taking sign-ups. ' +
    'Please check the program calendar for upcoming lunch dates' + (phone ? ` or call ${phone}` : '') + '.';
}

/**
 * Closes the forms that have ended and re-opens the ones this closed that have
 * a session again. Runs after the import's rows are on the tab (27), so a
 * form is never closed with responses on it that nobody has read; the one
 * window still owed is the one `withoutEndedForms` leaves it on the list for.
 *
 * Bounded by the slice's deadline and ENDED_FORMS_MAX_CLOSES_PER_RUN: each
 * close is a Forms write, and the first run after this shipped finds every
 * past month at once.
 */
function closeEndedForms(sessionRows, options) {
  options = options || {};
  const deadline = options.deadline || Infinity;
  const now = options.now || new Date();
  const ended = readEndedForms();
  const notServingFormIds = {};
  const lastByForm = lastSessionDateByForm_(sessionRows, notServingFormIds, now);
  const { toClose, revived } = classifyEndedForms(lastByForm, ended, endedFormCutoffKey_(now));
  let changed = false;
  let closed = 0;
  let reopened = 0;

  revived.forEach(formId => {
    const entry = ended[formId];
    if (entry.closedByUs) {
      try {
        const form = openFormCached(formId);
        if (!form.isAcceptingResponses()) form.setAcceptingResponses(true);
        reopened++;
      } catch (err) {
        // Kept on the record so the next run tries again: a form this closed
        // and could not re-open is a program nobody can register for.
        log(`⚠️ ${describeFormLink(formId)} has an upcoming session again but could not be re-opened (${err}).`);
        return;
      }
    }
    delete ended[formId];
    changed = true;
  });

  for (let i = 0; i < toClose.length; i++) {
    if (closed >= ENDED_FORMS_MAX_CLOSES_PER_RUN || (closed > 0 && Date.now() >= deadline)) break;
    const formId = toClose[i];
    try {
      const form = openFormCached(formId);
      let closedByUs = false;
      if (form.isAcceptingResponses()) {
        form.setCustomClosedFormMessage(notServingFormIds[formId]
          ? lunchNotServingClosedMessage_() : endedFormClosedMessage_());
        form.setAcceptingResponses(false);
        closedByUs = true;
      }
      ended[formId] = { closedAt: new Date().toISOString(), closedByUs, lastSession: lastByForm[formId] };
      changed = true;
      closed++;
    } catch (err) {
      // Not recorded: a form that cannot be opened stays on the hourly list,
      // where the import's own note says which programs it affects.
      log(`ℹ️ ${describeFormLink(formId)} has ended but could not be closed (${err}).`);
    }
  }

  if (changed) writeEndedForms_(ended);
  if (closed > 0 || reopened > 0) {
    log(`Ended forms: closed ${closed}` + (reopened > 0 ? `, re-opened ${reopened}` : '') +
      (toClose.length > closed ? ` (${toClose.length - closed} more on the next run)` : '') + '.');
  }
  return { closed, reopened, pending: toClose.length - closed };
}
