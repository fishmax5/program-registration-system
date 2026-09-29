// ============================================================================
// 99q. BULK MANUAL REGISTRANTS  (one program, a pasted list, reviewed first)
// ============================================================================
//
// Quick Mark's Register tick puts ONE person on ONE session, and that is the
// right shape for the desk. It is the wrong shape for the list a leader hands
// the office on the first day of term — twenty names on a sheet of paper or in
// an email, "these are all coming every Tuesday" — which until now was twenty
// trips through the dialog, or twenty form submissions typed in by staff.
//
// So: pick the PROGRAM first (the same reason 99m picks it first — every date
// offered is then that one program's, and a name can never land on the class
// beside it in date order), paste the list or open a CSV file, say which
// column is which, and REVIEW what the workbook made of it before anything is
// written.
//
// THE COLUMNS ARE THE PERSON'S CALL, NOT OURS. A list comes out of whatever
// somebody had to hand — a sign-up sheet typed into Excel, a leader's email, a
// roll exported "Last, First" — and a column read as the wrong thing is a
// registration in the wrong name that nobody notices until the day. So the
// file is read into COLUMNS first (readBulkRegistrantColumns), each with a
// guess — from a header line where there is one, from the shape of what is in
// it where there is not (an email looks like an email, a phone like a phone,
// two columns of single words like a first and a last name) — and the dialog
// shows the first rows under a dropdown per column. Nothing is matched until
// somebody has looked at that and pressed Check. Two columns given the same
// name field are joined ("Jane" + "Marie" → "Jane Marie"); a column set to
// "ignore" is ignored.
//
// THE REVIEW IS THE POINT. A pasted name is a string; a registration belongs
// to a person, and the roll (79) is where the office keeps who the people are.
// Each pasted row is matched against Member_Roll and the dialog SHOWS the
// match rather than applying it:
//
//   exact     the name, after any remembered correction (77), is a name on the
//             roll — used as-is, because it already is that person.
//   contact   the phone or email is on the roll under a DIFFERENT name —
//             offered, pre-selected, because "Bob Kaplan" with Robert Kaplan's
//             number is nearly always Robert Kaplan.
//   similar   same surname and first initial — offered and NOT pre-selected,
//             because that is also a description of a married couple (see the
//             correction in 79's banner, which is why the roll stopped folding
//             on it).
//   new       nobody — written as typed; the ordinary walk-in path adds them to
//             the roll (recordWalkInMember, 74) exactly as the desk would.
//
// AND IT SAYS WHO IS ALREADY THERE. Every name the dialog can register a row
// as carries the dates of THIS program that person already has a live row on
// (Active or Waitlisted — never Cancelled or Superseded), and whether they
// already hold a standing place on it (buildBulkRegistrantAlreadyIndex_, keyed
// the way 85's duplicate review keys a person and a session, so the two cannot
// disagree about what "already registered" means). A row whose chosen dates
// are ALL already taken is unticked by the dialog and says so; a row that is
// on some of them says which, and only the rest are written. The same person
// twice in one list is the second case of the same thing, and is unticked
// beside the row it repeats. Unticking is a default, not a refusal — the desk's
// own duplicate check is still underneath, and a tick put back writes nothing
// twice.
//
// HOW OFTEN is chosen once for the list and may be changed per row:
//   next      the next date only.
//   picked    the dates ticked in the dialog.
//   all       every date offered (today through the end of next month —
//             deskMonthHorizonKey, the same horizon the door registers into).
//   club      a standing place: a Club_Members row, which catches up every
//             future session by itself (applyClubRosterCatchup). Never on an
//             appointment program, which is why those are not offered at all —
//             an appointment is a chair at a time, and a list has no times.
//
// EVERY WRITE IS QUICK MARK'S REGISTER. Nothing here builds a registrant row:
// each (person, date) goes through applyQuickMarkLocked() with `register`, so
// the duplicate check, the capacity waitlisting, the walk-in roll entry and
// the wording are the desk's own and cannot drift from it. The lock is taken
// PER PERSON rather than for the whole list, so a forty-name paste does not
// shut the desk out of Quick Mark for the length of it.
//
// AND IT IS A SLICED JOB (75), WHICH IS THE RULE FOR EVERY BULK WRITE A DIALOG
// STARTS. The first version stopped at its budget and told the person to
// "paste just those and run again" — a job that only finishes if somebody sits
// there retyping the tail of their own list, on exactly the day the list is
// longest. Now Register saves the reviewed list (BULK_REGISTRANTS_PLAN_V1,
// chunked, because a list of a hundred people is more than one 9KB property)
// and works through it slice by slice, recording each person as they finish,
// and handing the rest on to resumeBulkRegistrants whenever a slice runs out
// of time or a sync is holding the workbook. The dialog POLLS
// bulkRegistrantsStatus() for progress rather than waiting on one call, which
// is what lets it be closed half way: reopening it shows the same list,
// carrying on or finished. A person half done when a slice is killed outright
// is simply done again — the desk's Register answers "already registered" for
// the dates that landed, which is what makes the resume safe rather than
// delicate. A job that died with its watchdog (stale past
// BULK_REGISTRANTS_STALE_MS) is offered a "Carry on" button, never a re-paste.
// ============================================================================

/** One slice works this long, then hands on. Apps Script's ceiling is six minutes. */
const BULK_REGISTRANTS_BUDGET_MS = 4 * 60 * 1000;
/** The sliced job's envelope (75's shape) — small, one property. */
const BULK_REGISTRANTS_JOB_PROP_KEY = 'BULK_REGISTRANTS_JOB_V1';
/** The reviewed list itself, chunked across properties. */
const BULK_REGISTRANTS_PLAN_PROP_KEY = 'BULK_REGISTRANTS_PLAN_V1';
/** What the dialog shows: one line per person so far, and how it ended. Kept after the job. */
const BULK_REGISTRANTS_RESULT_PROP_KEY = 'BULK_REGISTRANTS_RESULT_V1';
const BULK_REGISTRANTS_RESUME_HANDLER = 'resumeBulkRegistrants';
const BULK_REGISTRANTS_RESUME_DELAY_MS = 20 * 1000;
/** Longer than a slice's budget plus its slack, so a live slice is never raced by its own watchdog. */
const BULK_REGISTRANTS_WATCHDOG_DELAY_MS = 8 * 60 * 1000;
/** Generous, because a sync holding the workbook for 25 minutes costs a slice a minute. */
const BULK_REGISTRANTS_MAX_SLICES = 150;
const BULK_REGISTRANTS_MAX_STALLED_SLICES = 3;
const BULK_REGISTRANTS_MAX_ERROR_SLICES = 3;
const BULK_REGISTRANTS_STALE_MS = 60 * 60 * 1000;
const BULK_REGISTRANTS_CHUNK_CHARS = 8000;
const BULK_REGISTRANTS_MAX_CHUNKS = 30;
/** More than this is a roll import, not a class list — and would outgrow the plan's chunks. */
const BULK_REGISTRANTS_MAX_PEOPLE = 400;

/** The four answers to "how often", in the order the dialog offers them. */
const BULK_REGISTRANT_RECURRENCES = ['next', 'picked', 'all', 'club'];

/** What a column can be. '' is "ignore this column". */
const BULK_REGISTRANT_COLUMN_FIELDS = ['name', 'first', 'last', 'phone', 'email', ''];

/** Column headings the paste recognizes, lower-cased, → field. */
const BULK_REGISTRANT_HEADER_FIELDS = {
  'name': 'name', 'full name': 'name', 'registrant': 'name', 'member': 'name', 'participant': 'name',
  'first': 'first', 'first name': 'first', 'first_name': 'first', 'firstname': 'first',
  'last': 'last', 'last name': 'last', 'last_name': 'last', 'lastname': 'last', 'surname': 'last',
  'phone': 'phone', 'telephone': 'phone', 'phone number': 'phone', 'cell': 'phone', 'mobile': 'phone',
  'tel': 'phone',
  'email': 'email', 'e-mail': 'email', 'email address': 'email'
};

const BULK_REGISTRANT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The pasted text or CSV file as COLUMNS, for the dialog's mapping step:
 * { records: [[cell]], fields: [field per column], hasHeader, columns }.
 * Blank lines are dropped; nothing is interpreted beyond the guess.
 */
function readBulkRegistrantColumns(text) {
  const records = parseCsvText(String(text || '').replace(/^﻿/, ''))
    .map(r => r.map(cell => String(cell === null || cell === undefined ? '' : cell).trim()))
    .filter(r => r.some(cell => cell !== ''));
  if (!records.length) return { records: [], fields: [], hasHeader: false, columns: 0 };
  const columns = records.reduce((n, r) => Math.max(n, r.length), 0);

  const headerFields = [];
  for (let i = 0; i < columns; i++) {
    headerFields.push(BULK_REGISTRANT_HEADER_FIELDS[String(records[0][i] || '').toLowerCase()] || '');
  }
  const hasHeader = headerFields.some(Boolean);
  const fields = hasHeader ? headerFields : guessBulkRegistrantFields_(records, columns);
  return { records, fields, hasHeader, columns };
}

/**
 * With no header line, a column's guess comes from what is IN it: mostly
 * emails is Email, mostly phone numbers is Phone, and of what is left the
 * first text column is the Name — unless the first two text columns side by
 * side hold nothing but single words, which is a First and a Last. Only a
 * guess, and shown as one: the person maps the columns before anything is
 * matched.
 */
function guessBulkRegistrantFields_(records, columns) {
  const sample = records.slice(0, 50);
  const shapes = [];
  for (let i = 0; i < columns; i++) {
    const s = { filled: 0, email: 0, phone: 0, text: 0, oneWord: 0 };
    sample.forEach(r => {
      const v = String(r[i] || '');
      if (!v) return;
      s.filled++;
      if (BULK_REGISTRANT_EMAIL_RE.test(v)) s.email++;
      else if (bulkLooksLikePhone_(v)) s.phone++;
      else {
        s.text++;
        if (!/[\s,]/.test(v)) s.oneWord++;
      }
    });
    shapes.push(s);
  }
  const fields = new Array(columns).fill('');
  let sawEmail = false;
  let sawPhone = false;
  shapes.forEach((s, i) => {
    if (!s.filled) return;
    if (!sawEmail && s.email * 2 >= s.filled) { fields[i] = 'email'; sawEmail = true; return; }
    if (!sawPhone && s.phone * 2 >= s.filled) { fields[i] = 'phone'; sawPhone = true; }
  });
  const textCols = [];
  shapes.forEach((s, i) => { if (!fields[i] && s.filled && s.text * 2 >= s.filled) textCols.push(i); });
  const single = i => shapes[i].text > 0 && shapes[i].oneWord === shapes[i].text;
  if (textCols.length >= 2 && textCols[1] === textCols[0] + 1 && single(textCols[0]) && single(textCols[1])) {
    fields[textCols[0]] = 'first';
    fields[textCols[1]] = 'last';
  } else if (textCols.length) {
    fields[textCols[0]] = 'name';
  }
  return fields;
}

/** Digits enough for a phone and no letters: "610-555-0100", "(610) 555 0100 x2" is not. */
function bulkLooksLikePhone_(value) {
  return bulkPhoneDigits_(value).length >= 7 && !/[a-z]/i.test(String(value || ''));
}

/**
 * Rows as people, through the mapping the person chose:
 * [{ name, phone, email, line }] where `line` is the row's number in the list
 * as they see it (the header, if any, is line 1). Name fields mapped twice are
 * joined; a phone or email mapped twice keeps the first one filled in.
 */
function peopleFromBulkRecords(records, fields, hasHeader) {
  const body = hasHeader ? (records || []).slice(1) : (records || []);
  const people = [];
  body.forEach((record, i) => {
    const p = { name: '', first: '', last: '', phone: '', email: '' };
    (fields || []).forEach((field, c) => {
      if (!field || BULK_REGISTRANT_COLUMN_FIELDS.indexOf(field) === -1) return;
      const value = String((record && record[c]) || '').trim();
      if (!value) return;
      if (field === 'phone' || field === 'email') { p[field] = p[field] || value; return; }
      p[field] = p[field] ? `${p[field]} ${value}` : value;
    });
    // "Smith, Jane" in a single cell is a name, read the way the roll reads it.
    const name = p.name || composeMemberName(p.first, p.last);
    const parts = splitPersonName(name);
    const full = composeMemberName(parts.first, parts.last) || name;
    if (!String(full || '').trim()) return;
    people.push({ name: full, phone: p.phone, email: p.email, line: i + 1 + (hasHeader ? 1 : 0) });
  });
  return people;
}

/**
 * The pasted text as people, with the columns as guessed — what the dialog
 * does in one step when nobody changes the mapping.
 */
function parseBulkRegistrantPaste(text) {
  const read = readBulkRegistrantColumns(text);
  return peopleFromBulkRecords(read.records, read.fields, read.hasHeader);
}

/** The last ten digits — enough to match "610-555-0100" to "(610) 555 0100". */
function bulkPhoneDigits_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Each pasted person against the roll. Pure: `rollRows` / `map` are
 * Member_Roll rows and its index map, `corrections` the remembered spellings.
 *
 * Returns the people with { match: 'exact'|'contact'|'similar'|'new',
 * candidates: [roll names], suggested: the name the dialog pre-selects }.
 * Retired rows still match — a returning member is the same person — but are
 * listed after the active ones.
 */
function matchBulkRegistrantsToRoll(people, rollRows, map, corrections) {
  const byName = {};
  const byPhone = {};
  const byEmail = {};
  const bySurname = {};
  const ordered = (rollRows || []).slice().sort((a, b) =>
    (memberRollIsRetired(a, map) ? 1 : 0) - (memberRollIsRetired(b, map) ? 1 : 0));
  const push = (index, key, name) => {
    if (!key) return;
    (index[key] = index[key] || []);
    if (index[key].indexOf(name) === -1) index[key].push(name);
  };
  ordered.forEach(row => {
    const name = String(row[map['Name']] || '').trim();
    if (!name) return;
    push(byName, normalizeNameKey(name), name);
    push(byName, normalizeNameKey(row[map['Display_Name']]), name);
    const phone = bulkPhoneDigits_(row[map['Phone']]);
    if (phone.length >= 7) push(byPhone, phone, name);
    push(byEmail, String(row[map['Email']] || '').trim().toLowerCase(), name);
    push(bySurname, bulkSurnameKey_(name), name);
  });

  return (people || []).map(person => {
    const typed = canonicalMemberName(person.name, corrections || {});
    const exact = byName[normalizeNameKey(typed)] || [];
    if (exact.length) {
      return Object.assign({}, person, { name: typed, match: 'exact', candidates: exact, suggested: exact[0] });
    }
    const contact = [];
    const phone = bulkPhoneDigits_(person.phone);
    (phone.length >= 7 ? byPhone[phone] || [] : []).forEach(n => { if (contact.indexOf(n) === -1) contact.push(n); });
    (byEmail[String(person.email || '').trim().toLowerCase()] || [])
      .forEach(n => { if (contact.indexOf(n) === -1) contact.push(n); });
    if (contact.length) {
      // One candidate is a suggestion; several people on one number is the
      // household or the office's own line, and a person has to choose.
      return Object.assign({}, person, { name: typed,
        match: 'contact', candidates: contact, suggested: contact.length === 1 ? contact[0] : typed
      });
    }
    const similar = (bySurname[bulkSurnameKey_(typed)] || []);
    if (similar.length) {
      return Object.assign({}, person, { name: typed, match: 'similar', candidates: similar, suggested: typed });
    }
    return Object.assign({}, person, { name: typed, match: 'new', candidates: [], suggested: typed });
  });
}

/** "jane smith" → "smith|j". Empty for a one-word name, which matches nothing. */
function bulkSurnameKey_(name) {
  const parts = splitPersonName(String(name || ''));
  const first = normalizeNameKey(parts.first);
  const last = normalizeNameKey(parts.last);
  return first && last ? `${last}|${first.charAt(0)}` : '';
}

/**
 * Every program the list can be pasted against: one entry per building ×
 * title, with its upcoming dated sessions through the end of next month.
 * Appointment programs and lunch-only rows are left out (see the banner).
 */
function listBulkRegistrantPrograms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
  const registrantRows = sheet
    ? getSectionedRowValues(sheet, HEADERS.All_Registrants, 'Event_ID')
    : [];
  return groupBulkRegistrantPrograms_(collectKnownProgramChoices(null, registrantRows));
}

/** Pure half of listBulkRegistrantPrograms(), so the grouping is testable. */
function groupBulkRegistrantPrograms_(choices) {
  const todayKey = formatDateKey(new Date());
  const horizonKey = deskMonthHorizonKey(new Date());
  const byKey = {};
  (choices || []).forEach(choice => {
    if (!choice.dateKey || choice.lunchOnly || choice.appointment) return;
    if (choice.dateKey < todayKey || choice.dateKey > horizonKey) return;
    const key = `${choice.location}${QUICK_MARK_SESSION_KEY_SEPARATOR}${choice.title}`;
    if (!byKey[key]) {
      byKey[key] = { key, title: choice.title, location: choice.location, sessions: [] };
    }
    if (byKey[key].sessions.some(s => s.value === choice.label)) return;
    byKey[key].sessions.push({
      value: choice.label,
      dateKey: choice.dateKey,
      dateLabel: formatDateLabel(parseDateKey(choice.dateKey))
    });
  });
  return Object.keys(byKey).map(k => byKey[k])
    .map(p => {
      p.sessions.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      p.label = `${p.title} — ${p.location || 'no location'} (${p.sessions.length} upcoming)`;
      return p;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Which session values one person is registered for. Pure. A `picked` list
 * is re-checked against the program's own sessions — a date that has gone
 * past, or a value the dialog did not draw, is not a date anybody chose.
 */
function bulkRegistrantSessionsFor(program, recurrence, pickedDateKeys) {
  const sessions = (program && program.sessions) || [];
  if (!sessions.length) return [];
  if (recurrence === 'next' || recurrence === 'club') return [sessions[0]];
  if (recurrence === 'all') return sessions.slice();
  if (recurrence === 'picked') {
    const wanted = {};
    (pickedDateKeys || []).forEach(k => { wanted[String(k)] = true; });
    return sessions.filter(s => wanted[s.dateKey]);
  }
  return [];
}

/**
 * Who is already on this program. Pure: `registrantRows` / `regMap` are
 * All_Registrants rows, `clubRows` / `clubMap` Club_Members rows.
 *
 * Returns lookup(name) → { alreadyOn: { dateKey: status }, standing: bool }.
 * A session is matched the way 85 matches one (duplicateRegistrationSessionKey:
 * date + building + canonical title) and a person the way 85 does too
 * (duplicateRegistrationNameKey), so "already registered" here and "a
 * duplicate" there are the same judgement. Cancelled and Superseded rows are
 * not registrations; guests are somebody else's.
 */
function buildBulkRegistrantAlreadyIndex_(program, registrantRows, regMap, clubRows, clubMap) {
  const location = String((program && program.location) || '').trim().toLowerCase();
  const titleKey = String(quickMarkTitleKey((program && program.title) || '') || '').toLowerCase();
  const sessionDate = {};
  ((program && program.sessions) || []).forEach(s => {
    sessionDate[`s:${s.dateKey}|${location}|${titleKey}`] = s.dateKey;
  });

  const byName = {};
  (registrantRows || []).forEach(row => {
    const status = String(row[regMap['Program_Status']] || '').trim();
    if (status === 'Cancelled' || status === 'Superseded') return;
    if (/guest/i.test(String(row[regMap['Person_Type']] || ''))) return;
    const dateKey = sessionDate[duplicateRegistrationSessionKey(row, regMap)];
    if (!dateKey) return;
    const nameKey = duplicateRegistrationNameKey(row[regMap['Name']]);
    if (!nameKey) return;
    byName[nameKey] = byName[nameKey] || {};
    // Active beats Waitlisted when a person has both on one date.
    if (byName[nameKey][dateKey] !== 'Active') byName[nameKey][dateKey] = status || 'Active';
  });

  const standing = {};
  (clubRows || []).forEach(row => {
    if (!isTruthyCheckbox(row[clubMap['Active']])) return;
    if (String(quickMarkTitleKey(row[clubMap['Club']]) || '').toLowerCase() !== titleKey) return;
    const rowLocation = String(row[clubMap['Location']] || '').trim().toLowerCase();
    if (rowLocation && location && rowLocation !== location) return;
    const nameKey = duplicateRegistrationNameKey(row[clubMap['Name']]);
    if (nameKey) standing[nameKey] = true;
  });

  return name => {
    const key = duplicateRegistrationNameKey(name);
    return { nameKey: key, alreadyOn: (key && byName[key]) || {}, standing: !!(key && standing[key]) };
  };
}

/**
 * The names the dialog offers for one matched person, each carrying what the
 * dialog needs to judge a duplicate without asking again: [{ name, label,
 * nameKey, alreadyOn, standing }]. Pure.
 */
function bulkRegistrantOptions_(person, lookup) {
  const names = [];
  (person.candidates || []).forEach(n => { if (names.indexOf(n) === -1) names.push(n); });
  if (person.match !== 'exact' && names.indexOf(person.name) === -1) names.push(person.name);
  return names.map(n => Object.assign({
    name: n,
    label: n === person.name && person.match !== 'exact' ? `${n} (as typed — new)` : n
  }, lookup(n)));
}

/**
 * Called from the dialog: the mapped list, matched and checked for who is
 * already on the program, for review. Writes nothing.
 *
 * `args` is { records, fields, hasHeader, programKey } — or, for the old
 * one-step call, the pasted text itself.
 */
function previewBulkRegistrants(args) {
  if (typeof args === 'string') args = Object.assign({ programKey: '' }, readBulkRegistrantColumns(args));
  args = args || {};
  const fields = args.fields || [];
  if (!fields.some(f => f === 'name' || f === 'first' || f === 'last')) {
    return { ok: false, message: '⚠️ No column is set to a name. Set at least one column to Name, First name or Last name.' };
  }
  const people = peopleFromBulkRecords(args.records || [], fields, !!args.hasHeader);
  if (!people.length) {
    return { ok: false, message: '⚠️ No names found — every row\'s name columns are empty.' };
  }
  if (people.length > BULK_REGISTRANTS_MAX_PEOPLE) {
    return { ok: false, message: `⚠️ That is ${people.length} people — more than ${BULK_REGISTRANTS_MAX_PEOPLE} ` +
      'at once is a roll import rather than a class list. Split it into two lists.' };
  }

  let rows = [];
  const map = getIndexMap(HEADERS.Member_Roll);
  let corrections = {};
  try {
    rows = readMemberRollRows().rows;
    corrections = readMemberNameCorrections();
  } catch (err) {
    log(`ℹ️ Bulk registrants could not read the roll (${err}) — everyone will show as new.`);
  }
  const matched = matchBulkRegistrantsToRoll(people, rows, map, corrections);

  let lookup = name => ({ nameKey: duplicateRegistrationNameKey(name), alreadyOn: {}, standing: false });
  let checked = false;
  const program = args.programKey
    ? listBulkRegistrantPrograms().filter(p => p.key === args.programKey)[0]
    : null;
  if (program) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const regSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
      const regRows = regSheet ? getSectionedRowValues(regSheet, HEADERS.All_Registrants, 'Event_ID') : [];
      const clubRows = readClubMemberRows(ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS));
      lookup = buildBulkRegistrantAlreadyIndex_(program, regRows, getIndexMap(HEADERS.All_Registrants),
        clubRows, getIndexMap(HEADERS.Club_Members));
      checked = true;
    } catch (err) {
      log(`ℹ️ Bulk registrants could not check who is already registered (${err}).`);
    }
  }

  matched.forEach(p => { p.options = bulkRegistrantOptions_(p, lookup); });
  return {
    ok: true,
    people: matched,
    duplicatesChecked: checked,
    counts: ['exact', 'contact', 'similar', 'new'].reduce((acc, k) => {
      acc[k] = matched.filter(p => p.match === k).length;
      return acc;
    }, {})
  };
}

// ----------------------------------------------------------------------------
// The write, as a sliced job
// ----------------------------------------------------------------------------

function readBulkRegistrantsPlan_() {
  const text = readChunkedScriptProperty(BULK_REGISTRANTS_PLAN_PROP_KEY);
  if (!text) return null;
  try { return JSON.parse(text); } catch (err) { return null; }
}

function readBulkRegistrantsResult_() {
  const text = readChunkedScriptProperty(BULK_REGISTRANTS_RESULT_PROP_KEY);
  if (!text) return null;
  try { return JSON.parse(text); } catch (err) { return null; }
}

function writeBulkRegistrantsResult_(result) {
  return writeChunkedScriptProperty(BULK_REGISTRANTS_RESULT_PROP_KEY, JSON.stringify(result),
    BULK_REGISTRANTS_CHUNK_CHARS, BULK_REGISTRANTS_MAX_CHUNKS);
}

/** Is a list being worked through? Stale state reads as "no" — see 75. */
function isBulkRegistrantsJobActive() {
  return isSlicedJobActive(BULK_REGISTRANTS_JOB_PROP_KEY, BULK_REGISTRANTS_STALE_MS, minutes =>
    `ℹ️ A bulk registration has been idle for ${minutes} minute(s) — treating it as stopped.`);
}

/**
 * Called from the dialog: saves the reviewed list and starts working through
 * it. `args` is { programKey, picked: [dateKey], people: [{ name, phone,
 * email, recurrence, lunch }] }. Returns the status the dialog polls for —
 * after the first slice, which the dialog does not wait on to show progress.
 */
function startBulkRegistrants(args) {
  args = args || {};
  if (isBulkRegistrantsJobActive()) {
    return Object.assign(bulkRegistrantsStatus(), { ok: false,
      message: '⏳ A list is already being registered — its progress is shown here. ' +
        'Let it finish (or stop it) before starting another.' });
  }
  const program = listBulkRegistrantPrograms().filter(p => p.key === args.programKey)[0];
  if (!program) {
    return { ok: false, message: '⚠️ That program has no upcoming dates any more — nothing was written. ' +
      'Close this and open it again.' };
  }
  const people = (args.people || [])
    .filter(p => String((p && p.name) || '').trim())
    .map(p => ({
      name: String(p.name).trim(),
      phone: String(p.phone || ''),
      email: String(p.email || ''),
      recurrence: BULK_REGISTRANT_RECURRENCES.indexOf(p.recurrence) !== -1 ? p.recurrence : 'next',
      lunch: !!p.lunch
    }));
  if (!people.length) return { ok: false, message: '⚠️ Nobody is ticked — nothing to register.' };
  if (people.length > BULK_REGISTRANTS_MAX_PEOPLE) {
    return { ok: false, message: `⚠️ More than ${BULK_REGISTRANTS_MAX_PEOPLE} people at once — split the list.` };
  }

  const jobId = Utilities.getUuid();
  const plan = { jobId, program, picked: (args.picked || []).map(String), people };
  if (!writeChunkedScriptProperty(BULK_REGISTRANTS_PLAN_PROP_KEY, JSON.stringify(plan),
    BULK_REGISTRANTS_CHUNK_CHARS, BULK_REGISTRANTS_MAX_CHUNKS)) {
    return { ok: false, message: '⚠️ The list could not be saved to work through — nothing was written. ' +
      'Try a shorter list.' };
  }
  writeBulkRegistrantsResult_({
    jobId, label: program.label, total: people.length, next: 0, written: 0,
    lines: [], done: false, problem: '', remaining: [], startedAt: Date.now()
  });
  saveSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY, {
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0, errorSlices: 0,
    jobId, next: 0, total: people.length, written: 0
  });
  log(`startBulkRegistrants: ${program.label} — ${people.length} people queued.`);
  runBulkRegistrantsSlice();
  return Object.assign({ ok: true }, bulkRegistrantsStatus());
}

/** THE TRIGGER HANDLER. Named as a string in BULK_REGISTRANTS_RESUME_HANDLER. */
function resumeBulkRegistrants() {
  runBulkRegistrantsSlice();
}

/**
 * Called from the dialog for a job that stopped without finishing (its
 * watchdog lost, the state gone stale): carry on from the next person rather
 * than asking anybody to paste the rest.
 */
function continueBulkRegistrants() {
  const result = readBulkRegistrantsResult_();
  const plan = readBulkRegistrantsPlan_();
  if (!result || result.done || !plan || plan.jobId !== result.jobId) return bulkRegistrantsStatus();
  if (!isBulkRegistrantsJobActive()) {
    const state = getSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY) || {};
    saveSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY, {
      startedAt: state.startedAt || Date.now(), lastSliceAt: Date.now(),
      slices: 0, stalledSlices: 0, errorSlices: 0,
      jobId: result.jobId, next: result.next || 0, total: result.total, written: result.written || 0
    });
    runBulkRegistrantsSlice();
  }
  return bulkRegistrantsStatus();
}

/** Called from the dialog: stop after the person being written now. */
function stopBulkRegistrants() {
  const result = readBulkRegistrantsResult_();
  const state = getSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY);
  if (state || (result && !result.done)) {
    finishBulkRegistrants_(state || { jobId: result.jobId, next: result.next }, 'was stopped');
  }
  return bulkRegistrantsStatus();
}

/** Called from the dialog once a finished list has been read: forget it. */
function dismissBulkRegistrantsResult() {
  if (isBulkRegistrantsJobActive()) return bulkRegistrantsStatus();
  clearChunkedScriptProperty(BULK_REGISTRANTS_RESULT_PROP_KEY);
  return { exists: false };
}

/**
 * What the dialog shows: { exists, active, stalled, done, label, total, next,
 * written, lines, problem, remaining }. `stalled` is a job neither running nor
 * finished — the one case with a "Carry on" button.
 */
function bulkRegistrantsStatus() {
  const result = readBulkRegistrantsResult_();
  if (!result) return { exists: false };
  const state = getSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY);
  const active = !!state && state.jobId === result.jobId && isBulkRegistrantsJobActive();
  return {
    exists: true,
    active,
    stalled: !active && !result.done,
    done: !!result.done,
    label: result.label || '',
    total: result.total || 0,
    next: result.next || 0,
    written: result.written || 0,
    lines: result.lines || [],
    problem: result.problem || '',
    remaining: result.remaining || []
  };
}

/**
 * One person onto their dates, under the workbook lock. Returns
 * { busy } when the lock could not be had, else { line, written }.
 */
function registerOneBulkPerson_(program, picked, person) {
  const name = String(person.name || '').trim();
  const recurrence = person.recurrence;
  const sessions = bulkRegistrantSessionsFor(program, recurrence, picked);
  if (!sessions.length) return { line: `⚠️ ${name} — no dates left to put them on, so nothing was written.`, written: 0 };

  const outcome = withScriptLock(DESK_LOCK_WAIT_MS * 5, () => {
    let done = 0;
    let already = 0;
    let refused = '';
    sessions.forEach(session => {
      const res = applyQuickMarkLocked({
        location: program.location,
        session: session.value,
        name,
        register: true,
        standing: recurrence === 'club',
        standingLunch: recurrence === 'club' && !!person.lunch,
        signup: !!person.lunch && recurrence !== 'club',
        confirmWalkIn: true,
        phone: String(person.phone || ''),
        email: String(person.email || '')
      }) || {};
      // The desk's own "already registered — nothing to add" is a success
      // that wrote nothing; counted apart so the line does not claim a date
      // it did not add (and so a person re-run after a killed slice reads as
      // what happened).
      if (res.ok && /already registered/i.test(String(res.message || ''))) already++;
      else if (res.ok) done++;
      else if (!refused) refused = res.message || '';
    });
    // Inside the lock, per person: the desk write buffers its ledger entries
    // (99k), and an entry buffered and never flushed is the loss the ledger
    // exists to prevent. One flush per person, not per date.
    flushPersistentRegistries();
    return { done, already, refused };
  }, null);
  if (!outcome) return { busy: true };

  const alreadyNote = outcome.already ? ` Already on ${outcome.already} date(s), left as they were.` : '';
  let line;
  if (recurrence === 'club') {
    line = outcome.done || outcome.already
      ? `🔁 ${name} — standing place on ${program.title}; every future date will follow.`
      : `⚠️ ${name} — no standing place was made. ${outcome.refused}`;
  } else if (outcome.done) {
    line = `✅ ${name} — ${outcome.done} of ${sessions.length} date(s).${alreadyNote}` +
      (outcome.refused ? ` Not the rest: ${outcome.refused}` : '');
  } else if (outcome.already && !outcome.refused) {
    line = `➖ ${name} — already registered on every date chosen; nothing added.`;
  } else {
    line = `⚠️ ${name} — nothing written.${alreadyNote} ${outcome.refused}`;
  }
  return { line, written: outcome.done };
}

/** ONE SLICE: work down the list until the budget runs out, then hand on. */
function runBulkRegistrantsSlice() {
  return runSlicedJob({
    label: 'Add registrants in bulk',
    propKey: BULK_REGISTRANTS_JOB_PROP_KEY,
    resumeHandler: BULK_REGISTRANTS_RESUME_HANDLER,
    budgetMs: BULK_REGISTRANTS_BUDGET_MS,
    resumeDelayMs: BULK_REGISTRANTS_RESUME_DELAY_MS,
    watchdogDelayMs: BULK_REGISTRANTS_WATCHDOG_DELAY_MS,
    maxSlices: BULK_REGISTRANTS_MAX_SLICES,
    maxStalledSlices: BULK_REGISTRANTS_MAX_STALLED_SLICES,
    // A failure is usually Apps Script's own and gone by the next run; every
    // person already done stays done, so ending on the first would be a list
    // somebody has to notice and carry on by hand.
    maxErrorSlices: BULK_REGISTRANTS_MAX_ERROR_SLICES,

    work: ctx => {
      const state = ctx.state;
      const plan = readBulkRegistrantsPlan_();
      if (!plan || plan.jobId !== state.jobId) {
        return { stop: 'lost its saved list (the stored copy could not be read)' };
      }
      const result = readBulkRegistrantsResult_() || {};
      if (result.jobId !== state.jobId) {
        return { stop: 'lost its progress record' };
      }
      const people = plan.people || [];
      if (state.next >= people.length) return { finished: true };

      // A slice resumed tomorrow must not register anybody onto yesterday.
      const todayKey = formatDateKey(new Date());
      const program = Object.assign({}, plan.program, {
        sessions: (plan.program.sessions || []).filter(s => s.dateKey >= todayKey)
      });

      let processed = 0;
      let busy = false;
      while (state.next < people.length) {
        if (Date.now() >= ctx.deadline) break;
        // Stopped from the dialog while this slice was mid-list: the state is
        // gone, and saving it again below would bring the job back to life.
        const live = getSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY);
        if (!live || live.jobId !== state.jobId) return { stop: 'was stopped' };
        // A sync holds the workbook for up to its whole budget; waiting on the
        // lock person by person would spend this slice doing nothing.
        if (workbookHeldElsewhere()) { busy = true; break; }
        const outcome = registerOneBulkPerson_(program, plan.picked, people[state.next]);
        if (outcome.busy) { busy = true; break; }
        result.lines = (result.lines || []).concat([outcome.line]);
        state.written = (state.written || 0) + outcome.written;
        state.next++;
        result.next = state.next;
        result.written = state.written;
        processed++;
        // Recorded as each person finishes, not at the end of the slice: a
        // slice killed outright must not make its successor redo the list.
        writeBulkRegistrantsResult_(result);
        ctx.save();
      }

      if (state.next >= people.length) return { finished: true };
      state.errorSlices = 0;
      if (busy && processed === 0) return { handOff: true };
      return { processed, remaining: people.length - state.next };
    },

    onHandOff: (state, result) => {
      log(`Bulk registrants: ${state.next} done, ${result.remaining} to go — carrying on by itself.`);
    },
    overrunProblem: () => `stopped after ${BULK_REGISTRANTS_MAX_SLICES} runs without finishing`,
    stalledProblem: result => `stopped — ${result.remaining} people could not be reached at all`,
    onError: (err, n) => {
      log(`⚠️ A bulk registration run failed (${err}) — failure ${n} of ${BULK_REGISTRANTS_MAX_ERROR_SLICES} in a row.`);
    },
    errorProblem: (err, n) => `stopped after ${n} run(s) in a row ended in an error, the last of them: ${err}`,
    saveErrorProblem: err => `stopped after an error it could not record: ${err}`,

    onDone: (state, problem) => finishBulkRegistrants_(state, problem)
  });
}

/** Ends the job: clear the plan and the state, drop the hand-off, keep what happened for the dialog. */
function finishBulkRegistrants_(state, problem) {
  const plan = readBulkRegistrantsPlan_();
  const result = readBulkRegistrantsResult_() || { jobId: state.jobId, lines: [] };
  clearSlicedJobState(BULK_REGISTRANTS_JOB_PROP_KEY);
  deleteSlicedJobResumeTriggers(BULK_REGISTRANTS_RESUME_HANDLER);
  // Already ended (stopped from the dialog while a slice was running): the
  // record written then is the right one, and its plan is already gone.
  if (result.done) return result;

  const next = Math.max(state.next || 0, result.next || 0);
  const remaining = plan && plan.jobId === result.jobId
    ? (plan.people || []).slice(next).map(p => p.name)
    : [];
  result.done = true;
  result.next = next;
  result.problem = problem || '';
  result.remaining = remaining;
  result.finishedAt = Date.now();
  writeBulkRegistrantsResult_(result);
  clearChunkedScriptProperty(BULK_REGISTRANTS_PLAN_PROP_KEY);

  const headline = problem
    ? `⚠️ Adding registrants in bulk to ${result.label || 'a program'} ${problem} — ` +
      `${next} of ${result.total || next} people done, ${remaining.length} not reached.`
    : `✅ Added ${result.total || next} people in bulk to ${result.label || 'a program'} ` +
      `(${result.written || 0} registration(s) written).`;
  log(`bulkRegistrants: ${headline}`);
  if (problem && problem !== 'was stopped') {
    spoolOfficeNote('Add Registrants in Bulk', `${headline} Not reached: ${remaining.join(', ')}.`);
  }
  toastIfPossible(headline);
  return result;
}

/** The menu item. Open to everyone, like Quick Mark's Register: it deletes nothing. */
function showBulkRegistrantsDialog() {
  const html = HtmlService.createHtmlOutput(buildBulkRegistrantsHtml())
    .setWidth(920)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Registrants in Bulk');
}

/**
 * The dialog's markup. Nothing from the workbook is interpolated here: the
 * programs, the columns, the preview and the progress are fetched at runtime
 * and written with textContent, so a member called O'Brien or a program
 * titled `</script>` cannot end the page.
 */
function buildBulkRegistrantsHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 14px 0 6px 0; font-size: 14px; }
  p.hint { color: #666; margin: 0 0 8px 0; line-height: 1.4; }
  select, textarea { font-size: 13px; }
  textarea { width: 100%; height: 90px; font-family: Consolas, Menlo, monospace; font-size: 12px;
             box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-right: 6px; }
  button.plain { background: #fff; color: #1155CC; border: 1px solid #1155CC; }
  button[disabled] { background: #9aa0a6; color: #fff; border-color: #9aa0a6; cursor: default; }
  #dates label { display: inline-block; margin: 2px 10px 2px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: middle; }
  th { background: #f1f3f4; }
  #columns th select { width: 100%; }
  #columns tr.headerRow td { color: #888; font-style: italic; }
  .exact { color: #188038; } .contact { color: #b06000; } .similar { color: #b06000; } .new { color: #1155CC; }
  tr.already td { background: #f8f9fa; color: #80868b; }
  td.note { color: #b06000; }
  tr.already td.note { color: #5f6368; font-weight: bold; }
  #review, #columns { max-height: 240px; overflow: auto; }
  #status { margin-top: 10px; white-space: pre-wrap; }
  .err { color: #C5221F; font-weight: bold; }
  #progress { display: none; }
  .bar { height: 10px; background: #e8eaed; border-radius: 5px; overflow: hidden; margin: 8px 0; }
  .bar div { height: 100%; background: #1155CC; width: 0; }
  #log { max-height: 380px; overflow: auto; white-space: pre-wrap; border: 1px solid #ddd;
         border-radius: 4px; padding: 8px; font-size: 12px; }
</style>
<div id="setup">
<h3>1. Program</h3>
<select id="program" style="width:100%"><option value="">Loading…</option></select>
<div id="recurrenceRow" style="margin-top:8px">
  How often, for everyone (change any row below):
  <select id="recurrence">
    <option value="next">Next date only</option>
    <option value="picked">The dates ticked below</option>
    <option value="all">Every date through next month</option>
    <option value="club">Standing place (every future date)</option>
  </select>
  <label style="margin-left:12px"><input type="checkbox" id="lunch"> with lunch</label>
</div>
<div id="dates" style="margin-top:6px"></div>
<h3>2. The list</h3>
<p class="hint">Open a CSV file, or paste the list — one person per line, straight out of a spreadsheet
or typed as <code>Name, Phone, Email</code>. (An Excel file: File → Save As → CSV first.)</p>
<input type="file" id="file" accept=".csv,.tsv,.txt,text/csv,text/plain">
<textarea id="csv" style="margin-top:6px" placeholder="…or paste here"></textarea>
<div style="margin-top:8px"><button id="read" onclick="readColumns()">Read the columns</button></div>
<div id="mapping" style="display:none">
<h3>3. Which column is which</h3>
<p class="hint">Check each column's heading — it is a guess. Set a column to <b>ignore</b> to leave it out;
two columns set to the same name part are joined.</p>
<label><input type="checkbox" id="hasHeader"> The first row is headings, not a person</label>
<div id="columns" style="margin-top:6px"></div>
<div style="margin-top:8px"><button id="check" onclick="check()">Check against the member roll</button></div>
</div>
<div id="reviewBox" style="display:none">
<h3>4. Review</h3>
<p class="hint"><span class="exact">On the roll</span> is used as-is.
<span class="contact">Same phone/email</span> is pre-selected — check it.
<span class="similar">Similar name</span> is offered but not chosen.
<span class="new">New</span> is added to the roll as typed.
Anybody <b>already registered</b> on the dates chosen, or listed twice, is unticked for you and says so.
Untick anybody else to leave them out.</p>
<div id="review"></div>
<div style="margin-top:8px"><button id="commit" onclick="commit()" disabled>Register them</button></div>
</div>
</div>
<div id="progress">
<h3 id="progTitle">Registering…</h3>
<div class="bar"><div id="barFill"></div></div>
<div id="progText"></div>
<p class="hint">This carries on by itself, a few minutes at a time, until everybody is done —
you can close this window and open it again to see how far it has got.</p>
<div id="log"></div>
<div style="margin-top:8px">
  <button id="stop" class="plain" onclick="stopJob()">Stop after this person</button>
  <button id="carryOn" onclick="carryOn()" style="display:none">Carry on</button>
  <button id="another" onclick="another()" style="display:none">Register another list</button>
</div>
</div>
<div id="status"></div>
<script>
  var PROGRAMS = [];
  var RAW = null;
  var PEOPLE = [];
  var ROWS = [];
  var POLL = null;
  var LABELS = { exact: 'On the roll', contact: 'Same phone/email', similar: 'Similar name', 'new': 'New' };
  var RECURRENCES = [['next','Next date'],['picked','Ticked dates'],['all','Every date'],['club','Standing']];
  var FIELDS = [['name','Name'],['first','First name'],['last','Last name'],['phone','Phone'],['email','Email'],['','— ignore —']];

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function $(id) { return document.getElementById(id); }
  function say(text, cls) { var s = $('status'); s.textContent = text || ''; s.className = cls || ''; }
  function program() {
    var key = $('program').value;
    for (var i = 0; i < PROGRAMS.length; i++) if (PROGRAMS[i].key === key) return PROGRAMS[i];
    return null;
  }

  // ---- 0. A list already being worked through is shown before anything else.
  google.script.run.withSuccessHandler(function (st) {
    if (st && st.exists) showProgress(st);
  }).bulkRegistrantsStatus();

  google.script.run.withSuccessHandler(function (list) {
    PROGRAMS = list || [];
    var sel = $('program');
    sel.textContent = '';
    sel.appendChild(el('option', PROGRAMS.length ? 'Choose a program…' : 'No upcoming programs found'));
    sel.options[0].value = '';
    PROGRAMS.forEach(function (p) { var o = el('option', p.label); o.value = p.key; sel.appendChild(o); });
  }).withFailureHandler(function (err) { say('Could not read the programs: ' + err.message, 'err'); })
    .listBulkRegistrantPrograms();

  // ---- 1. Program and dates.
  $('program').addEventListener('change', function () {
    drawDates();
    // Who is already registered depends on the program, so a list already
    // checked is checked again against the new one.
    if (PEOPLE.length) check();
  });
  function drawDates() {
    var box = $('dates');
    box.textContent = '';
    var p = program();
    if (!p) return;
    p.sessions.forEach(function (s) {
      var l = el('label');
      var c = document.createElement('input');
      c.type = 'checkbox'; c.value = s.dateKey; c.className = 'date'; c.checked = true;
      c.addEventListener('change', evaluate);
      l.appendChild(c); l.appendChild(document.createTextNode(' ' + s.dateLabel));
      box.appendChild(l);
    });
    evaluate();
  }
  $('recurrence').addEventListener('change', function () {
    var v = this.value;
    ROWS.forEach(function (r) { r.rec.value = v; });
    evaluate();
  });

  // ---- 2. The file or the paste.
  $('file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (/[.]xlsx?$/i.test(f.name)) {
      say('That is an Excel file — save it as CSV first (File → Save As → CSV), then open that.', 'err');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { $('csv').value = String(reader.result || ''); readColumns(); };
    reader.onerror = function () { say('Could not read that file.', 'err'); };
    reader.readAsText(f);
  });

  function readColumns() {
    var text = $('csv').value;
    if (!text.trim()) { say('Open a file or paste some names first.', 'err'); return; }
    $('read').disabled = true;
    say('Reading…');
    google.script.run.withSuccessHandler(function (res) {
      $('read').disabled = false;
      if (!res || !res.records || !res.records.length) { say('No rows found in that.', 'err'); return; }
      RAW = res;
      $('hasHeader').checked = !!res.hasHeader;
      drawColumns();
      $('mapping').style.display = '';
      $('reviewBox').style.display = 'none';
      PEOPLE = []; ROWS = [];
      say(res.records.length + ' row(s), ' + res.columns + ' column(s). Check the headings, then press Check.');
    }).withFailureHandler(function (err) {
      $('read').disabled = false;
      say('Failed: ' + err.message, 'err');
    }).readBulkRegistrantColumns(text);
  }

  // ---- 3. The mapping: one dropdown per column, over the first rows.
  function drawColumns() {
    var box = $('columns');
    box.textContent = '';
    var table = el('table');
    var head = el('tr');
    for (var c = 0; c < RAW.columns; c++) {
      var th = el('th');
      var sel = document.createElement('select');
      sel.className = 'field'; sel.dataset.c = c;
      FIELDS.forEach(function (f) { var o = el('option', f[1]); o.value = f[0]; sel.appendChild(o); });
      sel.value = RAW.fields[c] || '';
      sel.addEventListener('change', function () { RAW.fields[Number(this.dataset.c)] = this.value; });
      th.appendChild(sel);
      head.appendChild(th);
    }
    table.appendChild(head);
    var header = $('hasHeader').checked;
    RAW.records.slice(0, header ? 7 : 6).forEach(function (rec, i) {
      var tr = el('tr', null, header && i === 0 ? 'headerRow' : '');
      for (var c = 0; c < RAW.columns; c++) tr.appendChild(el('td', rec[c] || ''));
      table.appendChild(tr);
    });
    box.appendChild(table);
    var more = RAW.records.length - (header ? 7 : 6);
    if (more > 0) box.appendChild(el('p', '…and ' + more + ' more row(s).', 'hint'));
  }
  $('hasHeader').addEventListener('change', function () { if (RAW) drawColumns(); });

  function check() {
    if (!RAW) { say('Read the columns first.', 'err'); return; }
    if (!program()) { say('Choose the program first — that is how people already registered are found.', 'err'); return; }
    var fields = RAW.fields.slice();
    if (!fields.some(function (f) { return f === 'name' || f === 'first' || f === 'last'; })) {
      say('Set at least one column to Name, First name or Last name.', 'err'); return;
    }
    $('check').disabled = true;
    say('Checking against the member roll and the program…');
    google.script.run.withSuccessHandler(function (res) {
      $('check').disabled = false;
      if (!res || !res.ok) { say((res && res.message) || 'Nothing came back.', 'err'); return; }
      PEOPLE = res.people;
      drawReview();
      var c = res.counts;
      say(PEOPLE.length + ' people: ' + c.exact + ' on the roll, ' + c.contact + ' by phone/email, ' +
        c.similar + ' similar, ' + c['new'] + ' new.' + summaryOfAlready() +
        (res.duplicatesChecked ? '' : ' (Could not check who is already registered.)'));
    }).withFailureHandler(function (err) {
      $('check').disabled = false;
      say('Failed: ' + err.message, 'err');
    }).previewBulkRegistrants({ records: RAW.records, fields: fields,
      hasHeader: $('hasHeader').checked, programKey: $('program').value });
  }

  // ---- 4. The review.
  function drawReview() {
    var box = $('review');
    box.textContent = '';
    ROWS = [];
    var table = el('table');
    var head = el('tr');
    ['', 'Row', 'Pasted', 'Match', 'Register as', 'Phone', 'Email', 'How often', 'Note']
      .forEach(function (h) { head.appendChild(el('th', h)); });
    table.appendChild(head);
    var defaultRec = $('recurrence').value;
    PEOPLE.forEach(function (p, i) {
      var tr = el('tr');
      var r = { tr: tr, person: p, auto: false, touched: false };
      var tdOn = el('td'); var on = document.createElement('input');
      on.type = 'checkbox'; on.checked = true;
      on.addEventListener('change', function () { r.touched = true; updateCommit(); });
      tdOn.appendChild(on); tr.appendChild(tdOn); r.on = on;
      tr.appendChild(el('td', String(p.line || i + 1)));
      tr.appendChild(el('td', p.name));
      tr.appendChild(el('td', LABELS[p.match] || p.match, p.match));
      var tdAs = el('td'); var as = document.createElement('select');
      (p.options || []).forEach(function (opt, k) { var o = el('option', opt.label); o.value = String(k); as.appendChild(o); });
      for (var k = 0; k < (p.options || []).length; k++) if (p.options[k].name === p.suggested) as.value = String(k);
      as.addEventListener('change', evaluate);
      tdAs.appendChild(as); tr.appendChild(tdAs); r.as = as;
      tr.appendChild(el('td', p.phone || ''));
      tr.appendChild(el('td', p.email || ''));
      var tdRec = el('td'); var rec = document.createElement('select');
      RECURRENCES.forEach(function (x) { var o = el('option', x[1]); o.value = x[0]; rec.appendChild(o); });
      rec.value = defaultRec;
      rec.addEventListener('change', evaluate);
      tdRec.appendChild(rec); tr.appendChild(tdRec); r.rec = rec;
      r.note = el('td', '', 'note'); tr.appendChild(r.note);
      table.appendChild(tr);
      ROWS.push(r);
    });
    box.appendChild(table);
    $('reviewBox').style.display = '';
    evaluate();
  }

  function pickedKeys() {
    return Array.prototype.map.call(document.querySelectorAll('input.date:checked'), function (c) { return c.value; });
  }
  function datesFor(rec) {
    var p = program();
    if (!p) return [];
    if (rec === 'next' || rec === 'club') return p.sessions.slice(0, 1);
    if (rec === 'all') return p.sessions.slice();
    var picked = pickedKeys();
    return p.sessions.filter(function (s) { return picked.indexOf(s.dateKey) !== -1; });
  }
  function chosen(r) { return (r.person.options || [])[Number(r.as.value)] || { name: r.person.name, alreadyOn: {} }; }

  // Who is already there, and who is on the list twice — worked out again on
  // every change, because the answer depends on the name, the dates and the
  // program. A row that becomes a duplicate is unticked unless somebody has
  // ticked it by hand; one that stops being one is ticked again.
  function evaluate() {
    var seen = {};
    ROWS.forEach(function (r) {
      var opt = chosen(r);
      var rec = r.rec.value;
      var note = '';
      var already = false;
      if (rec === 'club' && opt.standing) {
        already = true;
        note = 'Already has a standing place on this program.';
      } else {
        var dates = datesFor(rec);
        var on = dates.filter(function (d) { return opt.alreadyOn && opt.alreadyOn[d.dateKey]; });
        var waitlisted = on.some(function (d) { return opt.alreadyOn[d.dateKey] === 'Waitlisted'; });
        if (!dates.length) {
          note = 'No dates chosen.';
        } else if (on.length === dates.length && rec !== 'club') {
          already = true;
          note = 'Already registered' + (dates.length > 1 ? ' on all ' + dates.length + ' dates' :
            ' for ' + dates[0].dateLabel) + (waitlisted ? ' (waitlisted)' : '') + '.';
        } else if (on.length) {
          note = 'Already on ' + on.map(function (d) { return d.dateLabel; }).join(', ') +
            (waitlisted ? ' (waitlisted)' : '') + ' — only the other ' + (dates.length - on.length) +
            ' will be added.';
        }
      }
      var key = opt.nameKey || '';
      if (!already && key && seen[key]) {
        already = true;
        note = 'Listed twice — same person as row ' + seen[key] + '.';
      }
      if (!already && key && (r.on.checked || r.auto)) seen[key] = r.person.line;
      r.note.textContent = note;
      r.tr.className = already ? 'already' : '';
      if (already && !r.touched && r.on.checked) { r.on.checked = false; r.auto = true; }
      else if (!already && r.auto && !r.touched) { r.on.checked = true; r.auto = false; }
    });
    updateCommit();
  }
  function summaryOfAlready() {
    var n = ROWS.filter(function (r) { return r.tr.className === 'already'; }).length;
    return n ? ' ' + n + ' already registered or listed twice — unticked.' : '';
  }

  function updateCommit() {
    var any = ROWS.some(function (r) { return r.on.checked; });
    $('commit').disabled = !(any && program());
  }

  function commit() {
    var p = program();
    if (!p) { say('Choose a program first.', 'err'); return; }
    var lunch = $('lunch').checked;
    var people = [];
    ROWS.forEach(function (r) {
      if (!r.on.checked) return;
      var opt = chosen(r);
      people.push({ name: opt.name, phone: r.person.phone, email: r.person.email,
        recurrence: r.rec.value, lunch: lunch });
    });
    if (!confirm('Register ' + people.length + ' people on ' + p.label + '?')) return;
    $('commit').disabled = true;
    say('');
    showProgress({ exists: true, active: true, label: p.label, total: people.length, next: 0, lines: [] });
    google.script.run.withSuccessHandler(function (st) {
      if (st && st.ok === false && !st.exists) { say(st.message || 'Nothing was written.', 'err'); backToSetup(); return; }
      if (st && st.message) say(st.message, st.ok === false ? 'err' : '');
      if (st) showProgress(st);
    }).withFailureHandler(function (err) {
      // The first slice's call failing is not the job failing — it may well be
      // carrying on from its trigger — so ask rather than assume.
      say('The first run reported: ' + err.message + ' — checking whether it is carrying on…');
      poll();
    }).startBulkRegistrants({ programKey: p.key, picked: pickedKeys(), people: people });
  }

  // ---- 5. Progress, polled — the work does not live in this window.
  function showProgress(st) {
    $('setup').style.display = 'none';
    $('progress').style.display = 'block';
    var total = st.total || 0, next = st.next || 0;
    $('progTitle').textContent = (st.done ? (st.problem ? 'Stopped: ' : 'Done: ') : 'Registering: ') + (st.label || '');
    $('barFill').style.width = (total ? Math.round(100 * next / total) : 0) + '%';
    var text = next + ' of ' + total + ' people done';
    if (st.written !== undefined) text += ' · ' + st.written + ' registration(s) written';
    if (st.done && st.problem) text += '\\nIt ' + st.problem + '.';
    if (st.stalled) text += '\\nIt has stopped without finishing. Press Carry on to pick up from the next person.';
    if (st.remaining && st.remaining.length) text += '\\nNot reached: ' + st.remaining.join(', ');
    $('progText').textContent = text;
    $('log').textContent = (st.lines || []).join('\\n');
    $('stop').style.display = st.active ? '' : 'none';
    $('carryOn').style.display = st.stalled ? '' : 'none';
    $('another').style.display = (st.done || st.stalled) ? '' : 'none';
    if (st.active && !POLL) POLL = setInterval(poll, 4000);
    if (!st.active && POLL) { clearInterval(POLL); POLL = null; }
  }
  function poll() {
    google.script.run.withSuccessHandler(function (st) { if (st && st.exists) showProgress(st); })
      .bulkRegistrantsStatus();
  }
  function stopJob() {
    if (!confirm('Stop after the person being registered now? Everybody already done stays done.')) return;
    $('stop').disabled = true;
    google.script.run.withSuccessHandler(function (st) { $('stop').disabled = false; if (st && st.exists) showProgress(st); })
      .withFailureHandler(function (err) { $('stop').disabled = false; say('Failed: ' + err.message, 'err'); })
      .stopBulkRegistrants();
  }
  function carryOn() {
    $('carryOn').disabled = true;
    if (!POLL) POLL = setInterval(poll, 4000);
    google.script.run.withSuccessHandler(function (st) { $('carryOn').disabled = false; if (st && st.exists) showProgress(st); })
      .withFailureHandler(function (err) { $('carryOn').disabled = false; say('Failed: ' + err.message, 'err'); poll(); })
      .continueBulkRegistrants();
  }
  function another() {
    google.script.run.withSuccessHandler(function () { backToSetup(); }).dismissBulkRegistrantsResult();
  }
  function backToSetup() {
    if (POLL) { clearInterval(POLL); POLL = null; }
    $('progress').style.display = 'none';
    $('setup').style.display = '';
    updateCommit();
  }
</script>`;
}
