// ============================================================================
// 99zh — REGISTRATION ON SOMEBODY ELSE'S SITE
// ============================================================================
//
// Every session this workbook knows about is registered for on a Google Form
// it built. Some programs are not: a class sold through Amilia, a trip booked
// through a partner's own page. Until now the only way to say so was not to,
// because "Move Sessions to Another Form" (47) refused anything that was not a
// Google Form ("⚠️ That does not look like a form URL or ID.").
//
// So the same dialog now takes an outside address too, and it is the ONLY way
// a session gets one: deliberately per SESSION, for the dates somebody ticked,
// and nothing the calendar adds later inherits it. A ticked session ends up:
//
//   Form_ID             blank — there is no form behind it, so nothing imports,
//                       migrates, relabels or repairs one for it;
//   Form_Response_Link  =HYPERLINK(<outside url>, EXTERNAL_REGISTRATION_LINK_LABEL)
//   Edit_Form_Link      blank — the outside site is edited on the outside site;
//   calendar event      "📝 Register for <title>" pointing at the outside url.
//
// WHY A STORE AND NOT JUST THE CELL. A blank Form_ID is ALSO what a row looks
// like when its form simply has not been written yet, and this workbook has
// several hourly passes whose whole job is to fill that in: the link repair
// (32), the [No Registration] restore (23), the group's own description
// back-injection (26). Each of those would put the program's Google Form
// straight back over the outside link, silently, within the hour. So the
// decision is recorded here (EXTERNAL_REGISTRATION_LINKS_PROP_KEY, keyed by
// Event_ID) and those passes ask `externalRegistrationUrlForEventId()` first.
// The cell is what people read; the store is what the code believes.
//
// UNDONE THE SAME WAY IT IS DONE: moving the session onto a Google Form in the
// same dialog forgets it here (`writeFormIdOntoSessions`, 47), and the form's
// date list picks the date back up on its next refresh.
//
// Behavior plus two self-contained constants. Everything it reaches for
// (`makeHyperlinkFormula`, `computeEventId`, `findProgramSessionHeaderRows`,
// `getZoneDataRange`) it reads at CALL time through hoisted declarations.

/**
 * `{ "<url>": ["<Event_ID>|<yyyy-MM-dd>", ...] }` — grouped by URL because a
 * handful of outside pages cover many sessions, which keeps one property
 * (9KB) good for a few hundred dates. The date rides along so past sessions
 * can be pruned: nothing reads a past event's description link again.
 */
const EXTERNAL_REGISTRATION_LINKS_PROP_KEY = 'EXTERNAL_REGISTRATION_LINKS_V1';

/** The words on the session table's link cell for an outside registration. */
const EXTERNAL_REGISTRATION_LINK_LABEL = 'Register (outside site)';

/** How long past its date an entry is kept before pruning. */
const EXTERNAL_REGISTRATION_KEEP_PAST_DAYS = 60;

let externalRegistrationLinksMemo_ = null;

/** Event_ID -> { url, dateKey }, memoized per execution. Never throws. */
function readExternalRegistrationLinks_() {
  if (externalRegistrationLinksMemo_) return externalRegistrationLinksMemo_;
  const out = {};
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(EXTERNAL_REGISTRATION_LINKS_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    Object.keys(parsed || {}).forEach(url => {
      (Array.isArray(parsed[url]) ? parsed[url] : []).forEach(entry => {
        const [eventId, dateKey] = String(entry || '').split('|');
        if (eventId) out[eventId] = { url, dateKey: dateKey || '' };
      });
    });
  } catch (err) {
    log(`ℹ️ Could not read the outside-registration links (${err}) — treating them as empty.`);
  }
  externalRegistrationLinksMemo_ = out;
  return out;
}

/** Writes the whole map back, past entries pruned. Returns false if it could not. */
function saveExternalRegistrationLinks_(byEventId) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - EXTERNAL_REGISTRATION_KEEP_PAST_DAYS);
  const cutoffKey = formatDateKey(cutoff);
  const byUrl = {};
  Object.keys(byEventId).forEach(eventId => {
    const entry = byEventId[eventId];
    if (!entry || !entry.url) return;
    if (entry.dateKey && entry.dateKey < cutoffKey) return;
    (byUrl[entry.url] = byUrl[entry.url] || []).push(`${eventId}|${entry.dateKey || ''}`);
  });
  try {
    const props = PropertiesService.getScriptProperties();
    if (Object.keys(byUrl).length === 0) props.deleteProperty(EXTERNAL_REGISTRATION_LINKS_PROP_KEY);
    else props.setProperty(EXTERNAL_REGISTRATION_LINKS_PROP_KEY, JSON.stringify(byUrl));
    externalRegistrationLinksMemo_ = null;
    return true;
  } catch (err) {
    log(`⚠️ Could not save the outside-registration links (${err}).`);
    return false;
  }
}

/** The outside registration address for this session, or ''. */
function externalRegistrationUrlForEventId(eventId) {
  const entry = readExternalRegistrationLinks_()[String(eventId || '').trim()];
  return entry ? entry.url : '';
}

/** The same, from the three things an Event_ID is made of. */
function externalRegistrationUrlForEvent(calendarId, cleanTitle, date) {
  if (!calendarId || !cleanTitle || !date) return '';
  if (Object.keys(readExternalRegistrationLinks_()).length === 0) return ''; // no digest on the common path
  return externalRegistrationUrlForEventId(computeEventId(calendarId, cleanTitle, formatDateKey(date)));
}

/** Drops these sessions from the store. Returns how many were in it. */
function forgetExternalRegistrationLinks(eventIds) {
  const current = readExternalRegistrationLinks_();
  const next = Object.assign({}, current);
  let dropped = 0;
  (eventIds || []).forEach(id => {
    const key = String(id || '').trim();
    if (Object.prototype.hasOwnProperty.call(next, key)) { delete next[key]; dropped++; }
  });
  if (dropped > 0) saveExternalRegistrationLinks_(next);
  return dropped;
}

/**
 * What somebody pasted, as an outside registration address — or '' when it is
 * not one. A Google Forms address is never an outside one: that belongs on the
 * form path, and treating it as a plain link would leave a form nobody imports.
 * A missing scheme is supplied ("app.amilia.com/…" is how an address bar copies
 * on some phones).
 */
function normalizeExternalRegistrationUrl(reference) {
  let raw = String(reference || '').trim();
  if (!raw || /\s/.test(raw) || /["<>]/.test(raw)) return '';
  if (!/^https?:\/\//i.test(raw)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(raw)) return '';
    raw = `https://${raw}`;
  }
  if (/^https?:\/\/(docs|forms)\.google\.com\/forms?\b/i.test(raw) || /^https?:\/\/forms\.gle\//i.test(raw)) return '';
  return raw;
}

/** The calendar description line for an outside registration. */
function buildExternalRegistrationLinkLine(cleanTitle, url) {
  // The `#form=external` fragment is what lets stripAllRegistrationLines()
  // (26) recognize this as OUR line and replace it, rather than stacking a
  // second copy beside it on the next rewrite.
  const href = `${url}#${REGISTRATION_LINK_FRAGMENT_KEY}=external`;
  return `<a href="${href}">📝 Register for ${cleanTitle}</a>`;
}

/**
 * The group without its outside-registration sessions, for the FORM half of
 * processCalendarGroup() (24): those dates must not be offered on the Google
 * Form too, or somebody registers twice in two places. Returns the group
 * itself when nothing is outside, so the common path allocates nothing.
 */
function groupWithoutExternalSessions(group) {
  if (!group || !group.sessions) return group;
  if (Object.keys(readExternalRegistrationLinks_()).length === 0) return group;
  const keep = group.sessions.filter(s => !externalRegistrationUrlForEvent(
    s.calendarId, group.cleanTitle, s.event.getStartTime()));
  if (keep.length === group.sessions.length) return group;
  return Object.assign({}, group, { sessions: keep, events: keep.map(s => s.event) });
}

/**
 * Points the session rows in `wanted` (a Set of Event_IDs) at an outside
 * address: Form_ID cleared, the view link set, the edit link cleared — and the
 * decision recorded so no hourly pass undoes it. Returns how many rows changed.
 *
 * Formula-or-value on the link columns for the reason writeFormIdOntoSessions()
 * gives: the rows NOT moving go back byte-identical.
 */
function writeExternalLinkOntoSessions(registrySheet, wanted, url) {
  const headerRows = findProgramSessionHeaderRows(registrySheet);
  if (headerRows.length === 0) return 0;
  const sheetMap = getHeaderMapAt(registrySheet, headerRows[0]); // 1-based
  const view = makeHyperlinkFormula(url, EXTERNAL_REGISTRATION_LINK_LABEL);
  const store = Object.assign({}, readExternalRegistrationLinks_());
  let moved = 0;

  headerRows.forEach((hRow, i) => {
    const nextHeader = (i + 1 < headerRows.length) ? headerRows[i + 1] : null;
    const zone = getZoneDataRange(registrySheet, hRow, nextHeader, sheetMap['Event_Date']);
    if (!zone) return;

    const eventIds = registrySheet.getRange(zone.start, sheetMap['Event_ID'], zone.count, 1).getValues();
    const dates = registrySheet.getRange(zone.start, sheetMap['Event_Date'], zone.count, 1).getValues();
    const idRange = registrySheet.getRange(zone.start, sheetMap['Form_ID'], zone.count, 1);
    const viewRange = registrySheet.getRange(zone.start, sheetMap['Form_Response_Link'], zone.count, 1);
    const editRange = registrySheet.getRange(zone.start, sheetMap['Edit_Form_Link'], zone.count, 1);

    const ids = idRange.getValues();
    const viewValues = viewRange.getValues();
    const editValues = editRange.getValues();
    const views = viewRange.getFormulas().map((f, r) => [f[0] || viewValues[r][0]]);
    const edits = editRange.getFormulas().map((f, r) => [f[0] || editValues[r][0]]);

    let touched = false;
    eventIds.forEach((idRow, r) => {
      const eventId = String(idRow[0] || '').trim();
      if (!eventId || !wanted.has(eventId)) return;
      const d = coerceDate(dates[r][0]);
      store[eventId] = { url, dateKey: d ? formatDateKey(d) : '' };
      if (String(views[r][0] || '') === view && !String(ids[r][0] || '').trim()) return; // already there
      ids[r] = [''];
      views[r] = [view];
      edits[r] = [''];
      touched = true;
      moved++;
    });

    if (touched) {
      idRange.setValues(ids);
      viewRange.setValues(views);
      editRange.setValues(edits);
      invalidateSectionedRowsCache(registrySheet);
    }
  });

  saveExternalRegistrationLinks_(store);
  return moved;
}
