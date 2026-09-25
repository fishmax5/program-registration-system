// ============================================================================
// 99t — THE CALENDAR'S OWN WORDS, AT THE TOP OF THE FORM
// ============================================================================
//
// A program's calendar event already says what the program IS — "bring a yoga
// mat", "meets in the library", "this week: watercolour" — and the form built
// from it said none of that: Location, Dates, "Please register below." The
// person deciding whether to sign up was shown everything except the one
// paragraph written for them.
//
// So the form description now OPENS with the event description, cleaned of
// everything this system writes into or reads out of it:
//
//   - every registration link, cancel link and horizon notice `26` writes back
//     (stripAllRegistrationLines() — the same stripper, so the two cannot
//     disagree about what a link of ours looks like), and
//   - every bracket that is nothing but tags ([Shared], [Club], [Cap: 12],
//     [Waitlist Only], [Grouped] …) — judged by isTagOnlyBracket() (`20`), the
//     test the parser itself uses, so a bracket holding a NOTE ("[room 4]")
//     stays, exactly as it does on the calendar.
//
// A calendar description is HTML when somebody typed it in the Calendar UI and
// plain text when a script wrote it; a form description is plain text only,
// so it is flattened here (line breaks kept, a link kept as its words plus the
// address in brackets).
//
// ONE TEXT SHOWS ONCE; SEVERAL ARE SAID PER DATE. A weekly class whose events
// all say the same thing gets that paragraph, once, with no dates. A series
// whose sessions differ ("Oct 3: pastels", "Oct 10: watercolour") is listed by
// date, with dates sharing identical text folded onto one line.
//
// AND IT STAYS OUT OF THE REGISTRATION PATH. The text lives on the session
// table in `Event_Description` (hidden, last column, written with the row and
// kept current by reconcileEventDescriptionsFromCalendar() in the sync's
// reconcile scope), so the hourly form check reads it off the rows it already
// holds rather than opening a calendar.
//
// COMPOSITION. A form's description is three parts:
//
//     top      Program_Questions "Form description" rows placed Above
//              calendar, then the calendar text — or, if any matching row says
//              Replace calendar, those rows INSTEAD of it
//     base     whatever else is there: buildFormDescription()'s Location /
//              Dates / sign-up wording, and anything somebody typed by hand
//     bottom   rows placed Below calendar (the default, and exactly where every
//              such row has always gone — so a workbook that never touches the
//              new column sees the calendar text appear and nothing move)
//
// The base cannot be re-derived on the sync path, so the parts are STRIPPED
// rather than rebuilt: the bottom by the exact text `54` has always recorded,
// the top by its length and hash (FORM_DESCRIPTION_STATE_PROP_KEY — a hash
// rather than the text, because a paragraph per form in one Script Property
// would reach its 9KB ceiling on a real workbook). A description somebody has
// since edited inside our block no longer matches, nothing is stripped, and
// their words survive — the same conservative answer `54` gives.
//
// IDEMPOTENT, AND FINGERPRINTED. Nothing is written when the composed text is
// what the form already says, and the hourly form check (`31`) compares a
// fingerprint of the top and bottom before opening a form at all — so a
// workbook whose calendars have not changed pays a hash per form and no Forms
// call. That fingerprint is also the whole rollout: no form has one yet, so
// every live form is visited once (inside the check's own per-run cap) and
// gains its calendar text. No FORM_STATE_MIGRATIONS entry and no
// TEMPLATE_VERSION bump: nothing about a form's STRUCTURE changes, only the
// text above its first question.
//
// Numbered after `99q` for the usual reason — never renumber. Behavior plus
// four constants that stand alone; everything it reaches for
// (stripAllRegistrationLines, isTagOnlyBracket, BRACKET_GROUP_REGEX,
// questionsForFormContext, the applied-question store, loadSessionGrid) it
// reads at CALL time or through a hoisted function declaration.
// ============================================================================

/** The three answers Program_Questions' Description_Placement column takes. */
const FORM_DESCRIPTION_PLACEMENTS = Object.freeze({
  ABOVE: 'Above calendar',
  BELOW: 'Below calendar',
  REPLACE: 'Replace calendar'
});

/** The dropdown, in the order a person reads it. Blank means Below. */
const FORM_DESCRIPTION_PLACEMENT_OPTIONS = [
  FORM_DESCRIPTION_PLACEMENTS.ABOVE,
  FORM_DESCRIPTION_PLACEMENTS.BELOW,
  FORM_DESCRIPTION_PLACEMENTS.REPLACE
];

/** Per form: "topLength:topHash:fingerprint" — see the banner. */
const FORM_DESCRIPTION_STATE_PROP_KEY = 'FORM_DESCRIPTION_STATE_V1';

/**
 * One event's text is cut here. A form description is read on a phone above
 * the first question; an event description can be pages of pasted newsletter,
 * and a session-table cell has its own ceiling.
 */
const CALENDAR_DESCRIPTION_MAX_CHARS = 3000;

/** Blank, unrecognized or "below" all mean Below — the one placement that moves nothing. */
function normalizeDescriptionPlacement(value) {
  const text = String(value || '').trim().toLowerCase();
  if (/^above/.test(text)) return FORM_DESCRIPTION_PLACEMENTS.ABOVE;
  if (/^(replace|instead)/.test(text)) return FORM_DESCRIPTION_PLACEMENTS.REPLACE;
  return FORM_DESCRIPTION_PLACEMENTS.BELOW;
}

/**
 * A calendar event's description as a form can show it: our links and tags
 * off, HTML flattened, whitespace tidied, length capped. '' when nothing a
 * person wrote is left. Pure.
 */
function calendarDescriptionToFormText(raw) {
  let text = String(raw || '');
  if (!text.trim()) return '';
  text = stripAllRegistrationLines(text).text;
  text = htmlDescriptionToPlainText_(text);
  text = stripTagOnlyBrackets_(text);
  text = text
    .split('\n')
    .map(line => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length > CALENDAR_DESCRIPTION_MAX_CHARS) {
    text = `${text.slice(0, CALENDAR_DESCRIPTION_MAX_CHARS - 1).trim()}…`;
  }
  return text;
}

/** Calendar HTML to plain text: breaks kept, a link kept as its words and its address. */
function htmlDescriptionToPlainText_(html) {
  let text = String(html || '').replace(/\r\n?/g, '\n');
  text = text.replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
    const words = label.replace(/<[^>]*>/g, '').trim();
    const url = href.trim();
    if (!words) return url;
    if (!url || words === url || /^(mailto|tel):/i.test(url)) return words;
    return `${words} (${url})`;
  });
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/(p|div|ul|ol|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeHtmlEntities_(text);
}

function decodeHtmlEntities_(text) {
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => (dec === '39' ? "'" : String.fromCharCode(parseInt(dec, 10))))
    .replace(/&([a-z]+);/gi, (m, name) => (named[name.toLowerCase()] !== undefined ? named[name.toLowerCase()] : m))
    .replace(/ /g, ' ');
}

/** Removes every bracket that is nothing but tags; a bracket holding a note is left alone. */
function stripTagOnlyBrackets_(text) {
  const pattern = new RegExp(BRACKET_GROUP_REGEX.source, 'g');
  return String(text || '').replace(pattern, (whole, content) => (isTagOnlyBracket(content) ? '' : whole));
}

/**
 * The calendar block for a form: one text once, or several per date.
 * `sessions` are [{ date, calendarText }]; two on one date (a twin event) take
 * the first non-empty text. Pure.
 */
function buildCalendarDescriptionBlock(sessions) {
  const byDate = [];
  const seen = {};
  (sessions || [])
    .map(s => ({ date: s ? coerceDate(s.date) : null, calendarText: s ? s.calendarText : '' }))
    .filter(s => s.date)
    .sort((a, b) => a.date - b.date)
    .forEach(s => {
      const key = formatDateKey(s.date);
      const text = String(s.calendarText || '').trim();
      if (seen[key]) {
        if (!seen[key].text && text) seen[key].text = text;
        return;
      }
      seen[key] = { date: s.date, text };
      byDate.push(seen[key]);
    });

  const withText = byDate.filter(d => d.text);
  if (withText.length === 0) return '';

  const groups = [];
  const groupByText = {};
  withText.forEach(d => {
    if (!groupByText[d.text]) {
      groupByText[d.text] = { text: d.text, dates: [] };
      groups.push(groupByText[d.text]);
    }
    groupByText[d.text].dates.push(d.date);
  });
  if (groups.length === 1 && withText.length === byDate.length) return groups[0].text;

  const multiLine = groups.some(g => g.text.indexOf('\n') !== -1);
  return groups
    .map(g => `${g.dates.map(date => Utilities.formatDate(date, TIMEZONE, 'MMM d')).join(', ')}: ${g.text}`)
    .join(multiLine ? '\n\n' : '\n');
}

/**
 * { top, bottom } for one form, from its calendar block and the question specs
 * that match it. `bottom` is byte-for-byte what buildDescriptionInjectionText()
 * has always produced for the Below rows, which is what keeps every form that
 * predates this reading back as unchanged below the calendar text.
 */
function composeFormDescriptionParts(calendarBlock, matchingSpecs) {
  const rows = (matchingSpecs || [])
    .filter(spec => questionTypeIsDescription(spec.kind))
    .map(spec => ({
      text: String(spec.help || spec.title || '').trim(),
      placement: normalizeDescriptionPlacement(spec.placement)
    }))
    .filter(row => row.text);
  const textsAt = placement => rows.filter(row => row.placement === placement).map(row => row.text);
  const above = textsAt(FORM_DESCRIPTION_PLACEMENTS.ABOVE);
  const replace = textsAt(FORM_DESCRIPTION_PLACEMENTS.REPLACE);
  const calendar = String(calendarBlock || '').trim();
  const topPieces = above.concat(replace.length > 0 ? replace : (calendar ? [calendar] : []));
  return {
    top: topPieces.length > 0 ? `${topPieces.join('\n\n')}\n\n` : '',
    bottom: buildDescriptionInjectionText(matchingSpecs)
  };
}

/** The parts for a form context (rows or a calendar group — both carry calendarText). */
function formDescriptionPartsForContext(context, matchingSpecs) {
  return composeFormDescriptionParts(buildCalendarDescriptionBlock((context && context.sessions) || []),
    matchingSpecs);
}

// --- the stored state -------------------------------------------------------

let __formDescriptionStateCache = null;

function getFormDescriptionState() {
  if (__formDescriptionStateCache) return __formDescriptionStateCache;
  try {
    __formDescriptionStateCache = JSON.parse(
      PropertiesService.getScriptProperties().getProperty(FORM_DESCRIPTION_STATE_PROP_KEY) || '{}');
  } catch (err) {
    __formDescriptionStateCache = {};
  }
  return __formDescriptionStateCache;
}

function saveFormDescriptionState_(all) {
  __formDescriptionStateCache = all;
  try {
    PropertiesService.getScriptProperties().setProperty(FORM_DESCRIPTION_STATE_PROP_KEY, JSON.stringify(all));
  } catch (err) {
    // A state that will not save costs a redundant compare next hour, never a
    // wrong description: the write itself is still guarded by comparing text.
    log(`Could not save the form description state (${err}).`);
  }
}

/**
 * Called by every writer that puts a BARE buildFormDescription() onto a form:
 * the top we recorded is no longer there, and the fingerprint must not claim
 * it is, or the hourly check would skip a form that has just lost its
 * calendar text.
 */
function forgetFormDescriptionState(formId) {
  const all = getFormDescriptionState();
  if (!formId || !all[formId]) return;
  delete all[formId];
  saveFormDescriptionState_(all);
}

function descriptionDigest_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text || ''));
  return digest.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, '0')).join('').slice(0, 16);
}

function formDescriptionFingerprint(parts) {
  return descriptionDigest_(JSON.stringify([parts.top || '', parts.bottom || '']));
}

function parseFormDescriptionState_(value) {
  const bits = String(value || '').split(':');
  return { topLength: Number(bits[0]) || 0, topHash: bits[1] || '', fingerprint: bits[2] || '' };
}

function recordFormDescriptionState(formId, parts) {
  if (!formId) return;
  const all = getFormDescriptionState();
  const value = `${parts.top.length}:${descriptionDigest_(parts.top)}:${formDescriptionFingerprint(parts)}`;
  if (all[formId] === value) return;
  all[formId] = value;
  saveFormDescriptionState_(all);
}

/** True when the hourly check has to open this form to bring its description into line. */
function formDescriptionNeedsSync(formId, parts) {
  const stored = getFormDescriptionState()[formId];
  return !stored || parseFormDescriptionState_(stored).fingerprint !== formDescriptionFingerprint(parts);
}

/**
 * The live description with our recorded top and bottom taken off — what is
 * left is the base, whoever wrote it. Each part comes off only when it is
 * still there exactly as recorded.
 */
function stripRecordedDescriptionParts(current, previousBottom, stateValue) {
  let base = String(current || '');
  const bottom = String(previousBottom || '');
  if (bottom && base.length >= bottom.length && base.lastIndexOf(bottom) === base.length - bottom.length) {
    base = base.slice(0, base.length - bottom.length);
  }
  const state = parseFormDescriptionState_(stateValue);
  if (state.topLength > 0 && base.length >= state.topLength &&
      descriptionDigest_(base.slice(0, state.topLength)) === state.topHash) {
    base = base.slice(state.topLength);
  }
  return base;
}

/**
 * The one writer: a base plus this form's parts, written only when different,
 * with both records brought up to date. Returns true when the form was written.
 */
function writeComposedFormDescription(form, base, parts) {
  const formId = form.getId();
  const wanted = `${parts.top}${base}${parts.bottom}`;
  const current = form.getDescription() || '';
  const store = getAppliedCustomQuestions();
  if (String((store[formId] || {}).description || '') !== parts.bottom) {
    store[formId] = Object.assign({}, store[formId], { description: parts.bottom });
    saveAppliedCustomQuestions(store);
  }
  recordFormDescriptionState(formId, parts);
  if (wanted === current) return false;
  form.setDescription(wanted);
  return true;
}

/**
 * The hourly check's own visit, for a form whose labels are right and whose
 * description fingerprint is not. Guarded: a description must never cost the
 * pass the forms after it.
 */
function syncFormDescriptionFromContext(formId, context, matchingSpecs) {
  try {
    const form = openFormCached(formId);
    return syncDescriptionInjectionsOnForm(form, context, matchingSpecs);
  } catch (err) {
    log(`Could not bring the description of form ${formId} into line with its calendar events (${err}).`);
    return 0;
  }
}

// --- the session table's copy -----------------------------------------------

/** What goes in the Event_Description cell: text, never a formula. */
function eventDescriptionCellValue(text) {
  const value = String(text || '');
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** And back: the leading apostrophe Sheets normally eats, removed if it did not. */
function readEventDescriptionCell(value) {
  const text = String(value == null ? '' : value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

/** One event's cleaned text, or '' for anything that will not answer. */
function calendarTextOfEvent(event) {
  try {
    return event && typeof event.getDescription === 'function'
      ? calendarDescriptionToFormText(event.getDescription())
      : '';
  } catch (err) {
    return '';
  }
}

/**
 * Brings Event_Description on rows that ALREADY EXIST into line with the
 * calendar — the same gap reconcileSessionTimesFromCalendar() (`23`) closes for
 * the times, keyed the same way (sessionTimeKey), inside the same
 * withSessionGrid() scope. Without it a description edited on the calendar
 * after the date was imported would never reach the form, and no row written
 * before this file existed would ever carry one.
 *
 * Returns how many rows changed.
 */
function reconcileEventDescriptionsFromCalendar(registrySheet, groups) {
  const expected = {};
  (groups || []).forEach(group => {
    (group.sessions || [])
      .filter(session => session && session.event)
      .map(session => {
        let start = null;
        try { start = session.event.getStartTime(); } catch (err) { start = null; }
        return { session, start };
      })
      .filter(item => item.start)
      .sort((a, b) => a.start - b.start)
      .forEach(item => {
        const key = sessionTimeKey(item.session.calendarId, group.cleanTitle, formatDateKey(item.start));
        const text = calendarTextOfEvent(item.session.event);
        if (!(key in expected) || (!expected[key] && text)) expected[key] = text;
      });
  });
  if (Object.keys(expected).length === 0) return 0;

  const model = loadSessionGrid(registrySheet);
  if (!model) return 0;
  const needed = ['Calendar_Source', 'Clean_Title', 'Event_Date', 'Event_Description'];
  if (needed.some(header => !model.map[header])) return 0; // the column arrives with the next render

  let changed = 0;
  model.zones.forEach(zone => {
    const sources = sessionGridColumn(model, zone, 'Calendar_Source');
    const titles = sessionGridColumn(model, zone, 'Clean_Title');
    const starts = sessionGridColumn(model, zone, 'Event_Date');
    const texts = sessionGridColumn(model, zone, 'Event_Description');
    if (!sources || !titles || !starts || !texts) return;
    let touched = false;
    for (let r = 0; r < zone.count; r++) {
      const date = coerceDate(starts[r]);
      if (!date) continue;
      const key = sessionTimeKey(sources[r], String(titles[r] || '').trim(), formatDateKey(date));
      if (!(key in expected)) continue;
      if (readEventDescriptionCell(texts[r]) === expected[key]) continue;
      texts[r] = eventDescriptionCellValue(expected[key]);
      touched = true;
      changed++;
    }
    if (touched) markSessionGridColumn(model, zone, 'Event_Description');
  });
  flushSessionGrid(model); // a no-op inside the sync's scope, which owns the write
  if (changed > 0) {
    log(`Calendar descriptions brought onto ${changed} session row(s); the forms pick them up on the ` +
      `next form check.`);
  }
  return changed;
}
