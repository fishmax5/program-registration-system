// ============================================================================
// 5c. DELETION TOMBSTONES  (why a deleted registration stays deleted)
// ============================================================================
//
// Deleting rows from the registrants tab did not delete anything for long. The
// rows went, and then the next sync put them straight back — which read as the
// delete tool being broken, and was in fact three separate paths each doing
// exactly what they were built to do:
//
//   1. THE ALL-DATES REGISTRY. Somebody who answered "sign up for every date"
//      is recorded once, per form, and applyAllDatesCatchup() re-books them
//      onto every session that form covers, on every sync, forever. Deleting
//      the ROWS never touched the registry entry that produces them.
//   2. THE CLUB ROSTER. Same shape: an active Club_Members row means
//      applyClubRosterCatchup() books that person into every upcoming session
//      of the club. Deleting a booking is not resigning from the club.
//   3. THE FORM RESPONSE. Left in place unless the dialog was told otherwise —
//      deliberately, since it is the only copy of what somebody actually
//      said — and re-imported the moment anything moves LAST_FORM_SYNC_TIME
//      backwards (a restore, a re-run, a form migration).
//
// None of those is wrong on its own. What was missing is a record that a human
// deliberately removed a registration, which is what a tombstone is: the key
// (Event_ID|name|Person_Type) of a row somebody deleted on purpose.
// buildRegistrantRow() is the single funnel every path builds rows through —
// the import, both catch-ups — and it refuses to build a row whose key is
// tombstoned, so all three paths are closed by one check.
//
// A TOMBSTONE IS NOT FOREVER. It is scoped to one person on one session, so it
// blocks a re-import, not the person: they can register again for a different
// date, be added as a walk-in, or be booked into the same session by hand.
// Re-registering for THAT session with a genuinely new submission is the one
// case a tombstone should stand down for, and it does — see
// clearRegistrantTombstones(), called whenever a row for that key is written
// deliberately rather than re-derived.
//
// They also expire: a session's tombstones are dropped once the session is
// well past (TOMBSTONE_RETENTION_DAYS), because nothing re-imports a session
// that old and a property that only ever grows is a property that eventually
// stops being writable.
// ============================================================================

/**
 * { "Event_ID|nameKey|Person_Type": { d: "yyyy-MM-dd" session date, p: Party_ID } }.
 *
 * The Party_ID is what makes "they registered again" distinguishable from
 * "the same response came round a second time". A re-import of the response
 * the deletion was aimed at carries the SAME Party_ID and stays blocked; a
 * genuinely new submission carries a different one and lifts the tombstone.
 * Without it, anything that moves LAST_FORM_SYNC_TIME backwards would quietly
 * resurrect every deleted row.
 */
const REGISTRANT_TOMBSTONE_PROP_KEY = 'DELETED_REGISTRANTS_V1';

/** How long after a session's date its tombstones are kept. */
const TOMBSTONE_RETENTION_DAYS = 400;

let __tombstoneCache = null;
let __tombstoneDirty = false;

function getRegistrantTombstones() {
  if (__tombstoneCache) return __tombstoneCache;
  const raw = PropertiesService.getScriptProperties().getProperty(REGISTRANT_TOMBSTONE_PROP_KEY);
  try {
    __tombstoneCache = raw ? JSON.parse(raw) : {};
  } catch (err) {
    log(`⚠️ The deleted-registration list could not be read (${err}) — starting a fresh one.`);
    __tombstoneCache = {};
  }
  return __tombstoneCache;
}

function saveRegistrantTombstones() {
  if (!__tombstoneDirty || !__tombstoneCache) return;
  PropertiesService.getScriptProperties()
    .setProperty(REGISTRANT_TOMBSTONE_PROP_KEY, JSON.stringify(__tombstoneCache));
  __tombstoneDirty = false;
}

/** The tombstone key for one registrant row. Same shape as getExistingRegistrantIndex()'s keys. */
function registrantTombstoneKey(eventId, name, personType) {
  return `${String(eventId || '').trim()}|${normalizeNameKey(name)}|${String(personType || '').trim()}`;
}

/**
 * Records that these rows were deliberately deleted, and drops any tombstone
 * whose session is long enough past to be beyond re-import.
 */
function recordRegistrantTombstones(rows, map) {
  const store = getRegistrantTombstones();
  let added = 0;
  (rows || []).forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const name = String(row[map['Name']] || '').trim();
    if (!eventId || !name) return; // nothing an import could match against anyway
    const date = coerceDate(row[map['Event_Date']]);
    const key = registrantTombstoneKey(eventId, name, row[map['Person_Type']]);
    if (store[key]) return;
    store[key] = {
      d: date ? formatDateKey(date) : formatDateKey(new Date()),
      p: String(row[map['Party_ID']] || '').trim()
    };
    added++;
  });

  const cutoff = formatDateKey(new Date(Date.now() - TOMBSTONE_RETENTION_DAYS * 86400000));
  let expired = 0;
  Object.keys(store).forEach(key => {
    if (tombstoneDateKey(store[key]) < cutoff) { delete store[key]; expired++; }
  });

  if (added > 0 || expired > 0) {
    __tombstoneDirty = true;
    saveRegistrantTombstones();
    log(`recordRegistrantTombstones: ${added} registration(s) marked deleted, ${expired} expired tombstone(s) dropped.`);
  }
  return added;
}

/**
 * Lifts the tombstones for these keys — the "they signed up again" case.
 *
 * Called wherever a row is written DELIBERATELY rather than re-derived: a
 * genuinely new form submission, a walk-in typed at the desk, a restore from
 * triage. Without this a deletion would be permanent for that person on that
 * session, which is a stronger claim than anybody made by pressing delete.
 */
function clearRegistrantTombstones(keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  const store = getRegistrantTombstones();
  let cleared = 0;
  list.forEach(key => {
    if (!key || !store[key]) return;
    delete store[key];
    cleared++;
  });
  if (cleared > 0) {
    __tombstoneDirty = true;
    saveRegistrantTombstones();
  }
  return cleared;
}

/**
 * The tombstone for this exact person-on-this-session, or null.
 *
 * Tolerates the bare date string an earlier version stored: an entry with no
 * recorded Party_ID blocks every re-import of that key, which is the safe
 * reading — it can still be lifted by a walk-in or a restore, both of which
 * clear the tombstone outright rather than testing it.
 */
function getRegistrantTombstone(eventId, name, personType) {
  const entry = getRegistrantTombstones()[registrantTombstoneKey(eventId, name, personType)];
  if (!entry) return null;
  return typeof entry === 'string' ? { d: entry, p: '' } : entry;
}

/** The session date on a tombstone, whichever shape it was stored in. */
function tombstoneDateKey(entry) {
  if (!entry) return '';
  return String(typeof entry === 'string' ? entry : (entry.d || ''));
}


/**
 * Keys (Event_ID|normalized Name|Person_Type) for rows marked Manually Edited
 * or Manually Added — and for rows marked "Remove This Row", which are
 * protected for the same reason by a different route: a mark that an hourly
 * sync can overwrite with "Auto-Synced" is a mark that quietly disappears
 * between somebody setting it and somebody running the sweep (section 83).
 */
function getProtectedRegistrantKeys(rows) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const set = new Set();
  rows.forEach(row => {
    const override = String(row[map['Manual_Override']]).trim();
    if (override === 'Manually Edited' || override === 'Manually Added' ||
        override === REGISTRANT_REMOVE_OVERRIDE_OPTION) {
      set.add(`${row[map['Event_ID']]}|${normalizeNameKey(row[map['Name']])}|${row[map['Person_Type']]}`);
    }
  });
  return set;
}

/**
 * Map of (Event_ID|normalized Name|Person_Type) -> that row's live array,
 * for every currently-present row (Superseded ones included — a further
 * resubmission still needs to find and re-supersede the CURRENT row, not
 * pile up duplicates). buildRegistrantRow() uses this both to skip true
 * duplicate imports and to locate the row a resubmission should patch or
 * supersede.
 */
/**
 * ONE SESSION'S LIVE OCCUPANCY, hung off its registry entry and shared by
 * every row built against it during a run: how many people hold a place, and
 * which appointment slots are spoken for.
 *
 * Created on first use so a caller that builds its own registry entry by hand
 * (the sign-in desk's Quick Mark) needs to know nothing about it.
 */
function sessionOccupancy(registryEntry) {
  if (!registryEntry.occupancy) {
    registryEntry.occupancy = { people: 0, slots: new Set(), untimed: 0 };
  }
  return registryEntry.occupancy;
}

/**
 * Starts every session's occupancy from the registrations ALREADY ON THE
 * SHEET, so a cap means what it says across runs and not merely within one.
 *
 * WHAT IT WAS. The counter behind the waitlist decision started at zero on
 * every execution, so it only ever saw the registrations that arrived in that
 * one hour: a program capped at twelve took twelve MORE people every run, and
 * "#13 is waitlisted automatically" was true only of a thirteenth who
 * submitted inside the same sixty minutes as the other twelve. The
 * All_Program_Sessions's own Status went red on schedule, which is why
 * this was invisible — the sheet said Waitlist Only while the rows underneath
 * it all said Active.
 *
 * Counted the way the session's capacity is written (see
 * occupancyForSession()): heads for an ordinary session, distinct appointment
 * slots for an assistance one, and one place for an assistance row carrying no
 * time at all. Rows that are Cancelled, Superseded or already Waitlisted hold
 * nothing.
 *
 * ONE OBJECT PER SESSION, not per index key: a day still typed as one calendar
 * event per appointment puts several rows on the dashboard sharing an
 * Event_ID, and two counters for one session would each let the cap be reached
 * separately.
 */
function seedRegistryOccupancy(registryIndex, existingRows) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const byEventId = {};
  (existingRows || []).forEach(row => {
    if (String(row[map['Program_Status']] || '').trim() !== 'Active') return;
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (!eventId) return;
    if (!byEventId[eventId]) byEventId[eventId] = { people: 0, slots: new Set(), untimed: 0 };
    const entry = byEventId[eventId];
    entry.people++;
    const slot = appointmentStartLabelOf(row[map['Event_Time']]);
    if (slot) entry.slots.add(slot); else entry.untimed++;
  });

  Object.keys(registryIndex || {}).forEach(key => {
    const entry = registryIndex[key];
    if (!entry || !entry.eventId) return;
    if (!byEventId[entry.eventId]) {
      byEventId[entry.eventId] = { people: 0, slots: new Set(), untimed: 0 };
    }
    entry.occupancy = byEventId[entry.eventId];
  });
  return registryIndex;
}

function getExistingRegistrantIndex(rows) {
  const map = getIndexMap(HEADERS.All_Registrants);
  const index = new Map();
  rows.forEach(row => index.set(`${row[map['Event_ID']]}|${normalizeNameKey(row[map['Name']])}|${row[map['Person_Type']]}`, row));
  return index;
}

/**
 * Pulls a named item's response value out of a FormResponse. Checks ALL
 * items sharing that title (a given title appears on several branch-specific
 * pages) and returns the first one that was actually part of this
 * respondent's path.
 *
 * Takes a formIndex from getFormItemIndex() rather than a Form: this used
 * to call form.getItems() — a REMOTE call — on every single lookup, and
 * processFormResponse() makes about ten lookups per response.
 */
function getResponseValueByTitle(formIndex, response, title) {
  const items = formIndex.byTitle[title] || [];
  for (const item of items) {
    // A PAGE_BREAK can share a question's title on a form built before that
    // collision was fixed (see TEMPLATE_PAGE_TITLES.MODE), and asking for a
    // response to a page break is meaningless at best. Skip rather than let a
    // stray page title decide what a respondent answered.
    if (item.getType() === FormApp.ItemType.PAGE_BREAK) continue;
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const val = itemResponse.getResponse();
    if (val === null || val === undefined || val === '') continue;
    if (Array.isArray(val) && val.length === 0) continue;
    return val;
  }
  return '';
}

/**
 * Same "check every branch page, return whichever instance was actually
 * part of this respondent's path" approach as getResponseValueByTitle(),
 * but for a GRID item: returns { rows, columns, values }, where values[rowIdx]
 * is that row's answer — an ARRAY of checked column labels on a checkbox grid
 * (ATTENDANCE_GRID), a single string on a multiple-choice one
 * (MEAL_COUNT_GRID, where a date can carry only one number). Returns null if
 * the title never had a real answer (shouldn't happen for ATTENDANCE_GRID
 * since every branch has one, but the meal grid is legitimately absent
 * whenever the response predates this form structure or every date on the form
 * is "Not Serving").
 *
 * getRows()/getColumns() are themselves remote calls, so the resolved grid
 * is memoized on the formIndex — every response on a form shares one read.
 */
function getGridResponseByTitle(formIndex, response, title) {
  const items = formIndex.byTitle[title] || [];
  if (!formIndex.gridShapeByItemId) formIndex.gridShapeByItemId = {};
  for (const item of items) {
    const itemResponse = response.getResponseForItem(item);
    if (!itemResponse) continue;
    const values = itemResponse.getResponse();
    if (!values || !Array.isArray(values)) continue;
    const itemId = item.getId();
    let shape = formIndex.gridShapeByItemId[itemId];
    if (!shape) {
      // BY THE ITEM'S TYPE, not by its title. The two kinds of grid have
      // different accessors and Apps Script refuses the wrong one outright
      // ("Invalid conversion for item type: GRID"), which on this path would
      // lose a whole form's responses rather than one answer.
      const grid = item.getType() === FormApp.ItemType.GRID
        ? item.asGridItem() : item.asCheckboxGridItem();
      shape = { rows: grid.getRows(), columns: grid.getColumns() };
      formIndex.gridShapeByItemId[itemId] = shape;
    }
    return { rows: shape.rows, columns: shape.columns, values };
  }
  return null;
}

/**
 * Combines the Allergies/Dietary text answer with the "Anything Else?"
 * catch-all into one Admin_Notes string. The Footer Note is a display-only
 * SectionHeaderItem now (see getOrCreateTemplateForm()) so it never shows up
 * here — previously a single paragraph item did double duty as both the
 * static per-location note AND the admin-notes scan target, which meant a
 * respondent could never actually see their own note echoed back to them
 * separately from a genuine "anything else" answer.
 */
function getAdminNotesResponse(formIndex, response) {
  const allergies = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALLERGIES) || '').trim();

  // BY TITLE FIRST, and only then by shape. This used to take the first
  // PARAGRAPH item on the form that had an answer, which was safe only while
  // "Anything Else?" was the only paragraph question there could ever be. A
  // program that adds a paragraph question of its own (see
  // HEADERS.Program_Questions) breaks that assumption outright — its answer
  // would land in Admin_Notes and the respondent's actual note would vanish.
  // The fallback scan is kept for forms built before the titles settled, with
  // every custom question excluded from it.
  let notes = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES) || '').trim();
  if (!notes) {
    const custom = new Set(formIndex.customTitles || []);
    for (const item of formIndex.paragraphItems) {
      if (custom.has(item.getTitle())) continue;
      const itemResponse = response.getResponseForItem(item);
      if (!itemResponse) continue;
      const val = String(itemResponse.getResponse() || '').trim();
      if (val) { notes = val; break; }
    }
  }

  const parts = [];
  if (allergies) parts.push(`Allergies/Dietary: ${allergies}`);
  if (notes) parts.push(notes);
  return parts.join(' | ');
}

/**
 * Every extra question this program asked, as "Question: answer" pairs in one
 * string — the whole of what an added question contributes to a row.
 *
 * ONE COLUMN, NOT ONE PER QUESTION. A column per question would mean
 * All_Registrants's shape changing every time somebody adds a question to any
 * program, which is precisely the "adding a question breaks things" this
 * feature exists to avoid: every render, every projection, every downstream
 * consumer would have to cope with a table whose columns depend on a different
 * tab's contents. A single Form_Answers column is readable by a person, ignored
 * by everything that does not want it, and cannot collide with anything.
 *
 * Unanswered questions are left out entirely rather than written as blanks —
 * "Zip Code: " tells a reader nothing they did not already know.
 */
function getCustomAnswersResponse(formIndex, response) {
  const titles = formIndex.customTitles || [];
  if (titles.length === 0) return '';
  const parts = [];
  titles.forEach(title => {
    const value = getResponseValueByTitle(formIndex, response, title);
    // A checkbox question answers with an array; ", " is how a person would
    // read the several boxes they ticked.
    const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '').trim();
    if (text) parts.push(`${title}: ${text}`);
  });
  return parts.join(' | ');
}

/**
 * PRE-v9: how many EXTRA meals one submission asked for, beyond one per person
 * listed. Only ever reached now as the fallback in readMealCountResponse(),
 * for a response collected against a v8 form.
 *
 * Zero for every form that does not carry the question — getResponseValueByTitle()
 * returns '' for all of those, which is the same answer as "None" and needs no
 * special case.
 *
 * CAPPED at MAX_EXTRA_MEALS rather than trusted: the question was a list of
 * fixed choices, so a number above the cap can only come from an edited form,
 * and an order of ninety meals should reach a person before it reaches the
 * kitchen. Anything unparseable is zero — the safe direction here, since the
 * person still gets the one meal their registration is.
 */
function readExtraMealsResponse(formIndex, response) {
  const raw = String(getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.EXTRA_MEALS) || '').trim();
  if (!raw || raw === EXTRA_MEALS_NONE_LABEL) return 0;
  const amount = Math.floor(Number(raw) || 0);
  if (!(amount > 0)) return 0;
  return Math.min(amount, MAX_EXTRA_MEALS);
}

/**
 * HOW MANY MEALS ONE SUBMISSION ASKED FOR ON THE ALL-DATES BRANCH — the total
 * for the whole party, the registrant included, applied to every date on the
 * form that serves lunch.
 *
 * THREE SHAPES OF FORM ANSWER THIS, and they are tried in that order:
 *
 *  1. v9 — ALL_DATES_MEAL_COUNT, a number. Taken as given.
 *  2. v8 — ALL_DATES_LUNCH_PEOPLE, a checkbox of who eats, plus EXTRA_MEALS.
 *     The total is the people ticked (only those actually named — a tick in an
 *     unnamed guest's box is nobody) plus the extras.
 *  3. Neither — a form with no lunch question at all, or a response from
 *     before either existed. Null, meaning "not asked", which the caller reads
 *     as no lunch rather than as zero meals ordered.
 *
 * `people` is the resolved party from resolvePeopleOnResponse(), used only by
 * the v8 path.
 */
function readMealCountResponse(formIndex, response, people) {
  const direct = readMealCountAnswer(
    getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALL_DATES_MEAL_COUNT));
  if (direct !== null) return direct;

  const eaters = getResponseValueByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.ALL_DATES_LUNCH_PEOPLE);
  const ticked = new Set(Array.isArray(eaters) ? eaters : (eaters ? [eaters] : []));
  const extras = readExtraMealsResponse(formIndex, response);
  if (ticked.size === 0 && extras === 0) return null;
  const named = (people || []).filter(person => ticked.has(person.columnLabel)).length;
  return Math.min(named + extras, MAX_MEALS_PER_SUBMISSION);
}

/**
 * THE PER-DATE MEAL COUNTS off one response, as { plainRowLabel: count } is
 * not what it returns — the row labels are the form's own and have to be
 * resolved against the registry by the caller — so it hands back the grid it
 * read plus a reader for one row:
 *
 *   { rows, countForRow(rowIdx) }   or null when the form asked nothing.
 *
 * Same three shapes as readMealCountResponse(), in the same order: the v9
 * meal grid (a number per date), the v8 lunch grid (people ticked per date,
 * plus the submission's extras on the registrant), or nothing.
 */
function readMealCountGridResponse(formIndex, response, people) {
  const mealGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.MEAL_COUNT_GRID) ||
    getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.LUNCH_ONLY_GRID);
  if (mealGrid) {
    return {
      rows: mealGrid.rows,
      countForRow: rowIdx => {
        const value = mealGrid.values[rowIdx];
        // A multiple-choice grid answers with one string per row; a stray
        // array (a grid somebody converted by hand) reads as its first entry
        // rather than as nothing.
        const count = readMealCountAnswer(Array.isArray(value) ? value[0] : value);
        return count === null ? 0 : count;
      }
    };
  }

  const legacyGrid = getGridResponseByTitle(formIndex, response, TEMPLATE_ITEM_TITLES.LUNCH_GRID) ||
    getGridResponseByTitle(formIndex, response, LEGACY_LUNCH_ONLY_GRID_TITLE);
  if (!legacyGrid) return null;
  const extras = readExtraMealsResponse(formIndex, response);
  return {
    rows: legacyGrid.rows,
    countForRow: rowIdx => {
      const ticked = legacyGrid.values[rowIdx] || [];
      const list = Array.isArray(ticked) ? ticked : [ticked];
      const named = (people || []).filter(person => list.indexOf(person.columnLabel) !== -1).length;
      if (named === 0) return 0;
      return Math.min(named + extras, MAX_MEALS_PER_SUBMISSION);
    }
  };
}

/**
 * Resolves the people on one submission from the name fields alone. There
 * is no guest-count question any more: the headcount IS how many guest
 * name fields were filled in, which makes the old "said 3, named 2,
 * catered for 2" mismatch structurally impossible.
 *
 * Returned in PERSON_COLUMN_LABELS order, and a guest whose name was left
 * blank produces NO entry — so a stray check in that guest's grid column
 * (they're all pre-checked) is correctly ignored rather than inventing a
 * nameless person.
 */
function resolvePeopleOnResponse(formIndex, response, registrantName, adminNotes) {
  const people = [{
    name: registrantName, personType: 'Attendee', primaryRegistrant: 'Self',
    columnLabel: PERSON_COLUMN_LABELS[0], baseNotes: adminNotes
  }];
  for (let g = 1; g <= MAX_GUESTS; g++) {
    const guestName = String(getResponseValueByTitle(formIndex, response, `Guest ${g} Name`) || '').trim();
    if (!guestName) continue;
    people.push({
      name: guestName, personType: 'Guest', primaryRegistrant: registrantName,
      columnLabel: PERSON_COLUMN_LABELS[g], baseNotes: ''
    });
  }
  return people;
}

