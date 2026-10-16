// ============================================================================
// 99q. BULK REGISTRATION UPDATES  (one program, one list, reviewed first)
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
// beside it in date order), paste the list or open a CSV or Excel file, say which
// column is which, and REVIEW what the workbook made of it before anything is
// written.
//
// AND IT WAS ONLY EVER HALF THE JOB. A list arrives at the office in both
// directions and this dialog could read it in one: the same sheet of paper
// that says "these twenty are coming every Tuesday" in September says "these
// six have dropped out" in November, and the whole of the term's last week is
// "the class is finished, take everybody off". Every one of those was twenty
// or six or forty trips through the change panel (99a), one person at a time,
// each a full redraw of the Registrants tab — which is how a list of
// cancellations becomes a job somebody does half of and finishes on Monday.
//
// So the list now carries an ACTION as well as a scope of dates
// (BULK_REGISTRANT_ACTIONS): register, register-and-mark-attended, cancel,
// waitlist, put back on, or a corrected phone and email. One per row, with a
// list-wide default above them, because "all of these cancelled except Marion,
// who is moving to the waiting list" is one list and one press.
//
// WHICH TURNS THE REVIEW ROUND, and that is the only genuinely new idea here.
// "Already registered" is a reason to UNTICK a row when registering — it is
// the duplicate 85 exists to clean up — and the only state in which there is
// anything to do at all when cancelling, where the row to untick is the one
// the workbook has never heard of. The same screen, the same column, opposite
// verdicts; said once, in judge(), with the action in front of it rather than
// threaded as a condition through the loop. Unticking stays a DEFAULT and
// never a refusal: every writer's own checks are underneath, and a tick put
// back registers nobody twice and cancels nothing that was not there.
//
// AND THE NAMES NO LONGER HAVE TO BE TYPED AT ALL. A paste is right for a list
// that came from outside the workbook, and that is how people get PUT ON a
// program; every other action is about people the tab already holds, and
// asking somebody to re-key those names — against a roll that will then offer
// them a choice of spellings — is asking for the wrong Mary to be picked at
// the end of it. So "Pick from this program's registrants"
// (previewBulkRegistrantsFromRoster) reads them off the tab into the same
// review, one entry per PERSON, every match exact by construction. The paste
// and the mapping steps are skipped whole; nothing else about the screen or
// the write changes, which is what keeps one review rather than two.
//
// NOTHING HERE IS A NEW WRITER. Register is Quick Mark's own tick, as it
// always was; cancel is 71's one cancellation writer, waitlist and put-back-on
// are 71's two stampers under 99a's guards, and a corrected number is 99a's
// own contact change. A status is four cells that have to agree, and a list
// applied to forty people is the worst possible place for a fifth copy of
// them. What is deliberately NOT offered is `remove`: 99a argues its way to
// deleting a row outright on the strength of the press being nine changes deep
// behind one name, which is exactly what a list of forty is not.
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
// AND WHETHER THEY WERE THERE. A list is as often handed over AFTER the class
// as before it — the sign-in sheet off the door, typed up at four o'clock, or
// the leader's email saying "these eight came today" — so the review carries
// an ATTENDED tick beside the rest: one in the header that sets every row at
// once, and one per row that may disagree with it.
//
// ATTENDANCE IS A FACT ABOUT A DAY, and that is the whole of the rule. A
// person put on eight Tuesdays has not attended seven of them, and a tick
// that marked all eight would assert an attendance for a class that has not
// happened yet — onto the very row the desk will mark for real on the day, so
// nothing on any screen would ever say it was wrong. So the tick reaches only
// the dates that are TODAY OR EARLIER (bulkRegistrantAttendedDateKeys); every
// other date is still registered and is not marked.
//
// THE RULE IS APPLIED AT WRITE TIME, not at review time. A slice handed on
// overnight resumes with a different "today" (the slice already drops the
// dates that have gone past), so the dates it may mark have to be the ones it
// is standing on rather than the ones somebody was looking at when they
// pressed the button. In practice that is today's own session, because the
// programs offered run from today forward (groupBulkRegistrantPrograms_); it
// is stated as today-or-earlier because that is what makes it true rather
// than incidental, and because the dialog disables the box on a row with no
// such date instead of letting somebody tick what cannot happen.
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
// The follow-up email (see THE FOLLOW-UP EMAIL below). Its own key: it outlives
// the plan, which is cleared when the list finishes, and it carries who has
// already been written to so a re-press can never send the same person twice.
const BULK_FOLLOWUP_PROP_KEY = 'BULK_REGISTRANTS_FOLLOWUP_V1';
// One call to the server sends for at most this long; the dialog calls again
// for the rest. Client-driven rather than a sliced job (75) on 99s's precedent:
// somebody is watching and the quota (a hundred a day) bounds the list anyway.
const BULK_FOLLOWUP_BUDGET_MS = 90 * 1000;
// What this send will not dig the day's mail quota below — the registrant
// reminders (70) and leader alerts (66) run on the same hundred.
const BULK_FOLLOWUP_QUOTA_RESERVE = 20;
// The words for "what happened to you", keyed by the row's action.
const BULK_FOLLOWUP_CHANGE_PHRASES = {
  register: 'you have been registered',
  attended: 'you have been registered and marked as attended',
  cancel: 'your registration has been cancelled',
  waitlist: 'you have been moved onto the waiting list',
  reactivate: 'your registration has been put back on',
  contact: 'your contact details have been updated'
};

/** The four answers to "how often", in the order the dialog offers them. */
const BULK_REGISTRANT_RECURRENCES = ['next', 'picked', 'all', 'club'];

/**
 * WHAT TO DO WITH EACH PERSON ON THE LIST. One per row, with a list-wide
 * default above them, matched on the way in — a value not in here is refused
 * rather than guessed at, for the reason REGISTRANT_CHANGE_ACTIONS (99a) gives:
 * the failure mode of guessing is writing the wrong change to the right row.
 */
const BULK_REGISTRANT_ACTIONS = [
  'register',   // put them on, the only thing this dialog could ever do
  'attended',   // register them if need be, and mark the day they came
  'cancel',     // take the booking off and give the seat and the meal back
  'waitlist',   // onto the waiting list: no seat, no meal
  'reactivate', // off the waiting list, or back on after a cancellation
  'contact'     // a corrected phone or email across their upcoming rows
];

/**
 * Which actions need a row that ALREADY EXISTS — the half of the review that
 * reads the opposite way round from the other.
 *
 * "Already registered" unticks a row under `register`, because registering
 * somebody twice is the duplicate 85 exists to clean up. Under `cancel` it is
 * the only state in which there is anything to do at all, and a row the
 * workbook has never heard of is the one to untick. One list, so the dialog's
 * note and the write's refusal cannot come to disagree about which way round
 * a given action reads.
 */
const BULK_REGISTRANT_EXISTING_ROW_ACTIONS = ['cancel', 'waitlist', 'reactivate', 'contact'];

/** True for an action that changes a booking rather than making one. */
function bulkActionNeedsExistingRow(action) {
  return BULK_REGISTRANT_EXISTING_ROW_ACTIONS.indexOf(String(action || '')) !== -1;
}

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

// ---- An Excel file, read as it is rather than "save it as CSV first".
//
// An .xlsx is a zip of XML parts, and Apps Script can open a zip
// (Utilities.unzip) — so the dialog sends the file's bytes here and gets back
// the FIRST VISIBLE SHEET as the same text a paste would have been, which then
// goes through readBulkRegistrantColumns like any other list. Nothing about
// the mapping or the review changes, and the text lands in the paste box, so
// what the workbook read is on screen to be checked and edited.
//
// Read with a few regular expressions rather than XmlService: the four parts
// that matter (the workbook's sheet list, its relationships, the shared
// strings, one sheet) are flat and machine-written, and a pure reader over
// strings is a reader the tests can run. Values are what Excel STORED — a
// phone typed as a number reads back as its digits, a date as its serial
// number, which for a list of names, phones and emails is no loss. The old
// binary .xls is not a zip and is refused by name in the dialog.

/** Bytes of an .xlsx (base64, from the dialog) → { text, sheetName, ...readBulkRegistrantColumns(text) }. */
function readBulkRegistrantXlsx(base64) {
  let entries;
  try {
    const bytes = Utilities.base64Decode(String(base64 || ''));
    entries = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', 'list.xlsx'));
  } catch (e) {
    throw new Error('That file could not be opened as an Excel workbook (.xlsx). Save it as CSV and open that instead.');
  }
  const parts = {};
  (entries || []).forEach(b => {
    const name = String(b.getName() || '').replace(/^\/+/, '');
    if (/\.(xml|rels)$/i.test(name)) parts[name] = b.getDataAsString('UTF-8');
  });
  const sheet = bulkXlsxFirstSheet_(parts);
  if (!sheet) throw new Error('No sheet found in that Excel file.');
  const text = bulkRowsToTabText_(sheet.rows);
  return Object.assign({ text, sheetName: sheet.name }, readBulkRegistrantColumns(text));
}

/** The first visible sheet of an unzipped .xlsx ({ path: xml }) as { name, rows: [[string]] }, or null. */
function bulkXlsxFirstSheet_(parts) {
  const workbook = parts['xl/workbook.xml'];
  if (!workbook) return null;
  const rels = {};
  bulkXmlTags_(parts['xl/_rels/workbook.xml.rels'] || '', 'Relationship').forEach(a => {
    if (a.Id) rels[a.Id] = a.Target || '';
  });
  const sheets = bulkXmlTags_(workbook, 'sheet');
  const pick = sheets.find(a => !a.state || a.state === 'visible') || sheets[0];
  if (!pick) return null;
  const relId = pick['r:id'] || Object.keys(pick).filter(k => /:id$/.test(k)).map(k => pick[k])[0];
  let target = String(rels[relId] || 'worksheets/sheet1.xml');
  target = target.charAt(0) === '/' ? target.slice(1) : `xl/${target}`;
  const xml = parts[target];
  if (xml === undefined) return null;
  return { name: pick.name || '', rows: bulkXlsxSheetRows_(xml, bulkXlsxSharedStrings_(parts['xl/sharedStrings.xml'] || '')) };
}

/** Every <prefix:tag …> opening tag's attributes, entity-decoded. */
function bulkXmlTags_(xml, tag) {
  const out = [];
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)>`, 'g');
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(bulkXmlAttrs_(m[1]));
  return out;
}

function bulkXmlAttrs_(text) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(String(text || '')))) attrs[m[1]] = bulkXmlDecode_(m[3] !== undefined ? m[3] : m[4]);
  return attrs;
}

/** XML entities, then Excel's own _xHHHH_ escapes for control characters. */
function bulkXmlDecode_(text) {
  return String(text || '')
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
      const k = e.toLowerCase();
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'amp') return '&';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      const code = k.charAt(1) === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return isFinite(code) ? String.fromCodePoint(code) : all;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (all, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** The text of every <t> in a fragment, joined — a rich-text cell is several runs. Phonetic hints dropped. */
function bulkXlsxText_(fragment) {
  const src = String(fragment || '').replace(/<(?:[\w-]+:)?rPh\b[\s\S]*?<\/(?:[\w-]+:)?rPh>/g, '');
  let text = '';
  const re = /<(?:[\w-]+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?t>)/g;
  let m;
  while ((m = re.exec(src))) text += bulkXmlDecode_(m[1] || '');
  return text;
}

function bulkXlsxSharedStrings_(xml) {
  const out = [];
  const re = /<(?:[\w-]+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?si>)/g;
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(bulkXlsxText_(m[1] || ''));
  return out;
}

/** "AB12" → 27 (zero-based column), or -1. */
function bulkXlsxColumnIndex_(ref) {
  const letters = (String(ref || '').match(/^[A-Z]+/i) || [''])[0].toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

/** One sheet's XML as rows of strings, gaps kept where a cell reference skips a column. */
function bulkXlsxSheetRows_(xml, shared) {
  const rows = [];
  const rowRe = /<(?:[\w-]+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?row>)/g;
  const cellRe = /<(?:[\w-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?c>)/g;
  const valueRe = /<(?:[\w-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?v>/;
  let rm;
  while ((rm = rowRe.exec(String(xml || '')))) {
    const row = [];
    const body = rm[1] || '';
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(body))) {
      const attrs = bulkXmlAttrs_(cm[1]);
      const inner = cm[2] || '';
      const vm = inner.match(valueRe);
      const raw = vm ? bulkXmlDecode_(vm[1]) : '';
      let value;
      if (attrs.t === 's') value = shared[parseInt(raw, 10)] || '';
      else if (attrs.t === 'inlineStr') value = bulkXlsxText_(inner);
      else if (attrs.t === 'b') value = raw === '1' ? 'TRUE' : (raw === '0' ? 'FALSE' : raw);
      else value = raw;
      const col = bulkXlsxColumnIndex_(attrs.r);
      const at = col >= 0 ? col : row.length;
      while (row.length < at) row.push('');
      row[at] = value;
    }
    rows.push(row);
  }
  return rows;
}

/** Rows as tab-separated text parseCsvText (11) reads back cell for cell. */
function bulkRowsToTabText_(rows) {
  return (rows || [])
    .map(r => r.map(cell => {
      const v = String(cell === null || cell === undefined ? '' : cell);
      return /[\t\n\r",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join('\t'))
    .filter(line => line.replace(/\t/g, '').trim() !== '')
    .join('\n');
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
  // Session table only. This list keeps dated sessions that are neither lunch
  // nor appointment, and those come from the session table alone — reading the
  // whole Registrants tab (and two more tabs) to build it made the dialog's
  // program box take far longer than anything else on the page.
  return groupBulkRegistrantPrograms_(collectKnownProgramChoices(null, [], { sessionsOnly: true }));
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
      // `todayKey` is the WORKBOOK's today, carried so the dialog can grey out
      // an attended box that would mark nothing. The tablet's own clock is not
      // an answer here: it may be in another timezone, or simply wrong, and
      // the rule has to be the one the write will apply.
      byKey[key] = { key, title: choice.title, location: choice.location, todayKey, sessions: [] };
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
 * Which of a person's sessions an attended tick may be applied to, as date
 * keys. Pure, and the one statement of the rule in the banner above:
 * attendance is a fact about a day, so a tick reaches today and anything
 * earlier and no future date at all. `todayKey` is the caller's — the job
 * reads it per slice, because a slice handed on overnight is standing on a
 * different day from the one the list was reviewed on.
 */
function bulkRegistrantAttendedDateKeys(sessions, todayKey) {
  const today = String(todayKey || '');
  if (!today) return [];
  return (sessions || [])
    .filter(s => s && s.dateKey && String(s.dateKey) <= today)
    .map(s => String(s.dateKey));
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
  // CANCELLED ROWS, KEPT APART. They are not registrations, which is why
  // `alreadyOn` has never counted them and why registering somebody whose
  // booking was cancelled is a thing this dialog must go on allowing. But
  // "put them back on" is an action ABOUT a cancelled row, and a review that
  // could not see one would untick every person it was meant for. Two maps
  // rather than one value, so neither question can be answered with the
  // other's answer.
  const cancelledByName = {};
  (registrantRows || []).forEach(row => {
    const status = String(row[regMap['Program_Status']] || '').trim();
    if (status === 'Superseded') return;
    if (/guest/i.test(String(row[regMap['Person_Type']] || ''))) return;
    const dateKey = sessionDate[duplicateRegistrationSessionKey(row, regMap)];
    if (!dateKey) return;
    const nameKey = duplicateRegistrationNameKey(row[regMap['Name']]);
    if (!nameKey) return;
    if (status === 'Cancelled') {
      cancelledByName[nameKey] = cancelledByName[nameKey] || {};
      cancelledByName[nameKey][dateKey] = status;
      return;
    }
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
    return {
      nameKey: key,
      alreadyOn: (key && byName[key]) || {},
      cancelledOn: (key && cancelledByName[key]) || {},
      standing: !!(key && standing[key])
    };
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
 * EVERYBODY ALREADY ON ONE PROGRAM, as the same `people` the paste produces.
 *
 * THE SECOND WAY IN, and the one that is right for every action but Register.
 * A list is pasted when it comes from outside the workbook — a leader's email,
 * a sign-in sheet — and that is how people get PUT ON a program. The sentences
 * this dialog grew to answer are the other direction: "the Tuesday class is
 * cancelled, take everybody off", "these six dropped out", "move the waiting
 * list onto the trip". Every one of those is about people the workbook already
 * knows, and asking somebody to type their names back in — against a roll that
 * will then match them "similar" and offer them a choice of spellings — is
 * asking them to re-key what is already on the tab, with a chance of picking
 * the wrong Mary at the end of it.
 *
 * So this reads them off the program instead. Pure, so the fold is testable:
 * `registrantRows` / `regMap` are All_Registrants rows, `clubRows` / `clubMap`
 * Club_Members rows.
 *
 * ONE ENTRY PER PERSON, not per row, because every action in this dialog is a
 * decision about a person and a scope of dates — the dates themselves ride on
 * `alreadyOn`, exactly as they do for a pasted name, which is what lets the
 * review table and its notes be the same code for both ways in. The match is
 * `exact` by construction: these names came off the tab, so there is no
 * spelling to resolve and no choice to offer. Sorted by name, because a person
 * looking for somebody in a list of forty reads rather than scrolls.
 *
 * Guests are not listed: a guest is cancelled, waitlisted and moved WITH the
 * person who brought them (matchesCancellationParty, 71), so offering them as
 * a row of their own would be offering the same decision twice.
 */
function bulkRosterPeopleFrom_(program, registrantRows, regMap, clubRows, clubMap) {
  const lookup = buildBulkRegistrantAlreadyIndex_(program, registrantRows, regMap, clubRows, clubMap);
  const location = String((program && program.location) || '').trim().toLowerCase();
  const titleKey = String(quickMarkTitleKey((program && program.title) || '') || '').toLowerCase();
  const dates = {};
  ((program && program.sessions) || []).forEach(s => {
    dates[`s:${s.dateKey}|${location}|${titleKey}`] = true;
  });

  const byKey = {};
  const order = [];
  (registrantRows || []).forEach(row => {
    const status = String(row[regMap['Program_Status']] || '').trim();
    if (status === 'Superseded') return;
    if (/guest/i.test(String(row[regMap['Person_Type']] || ''))) return;
    if (!dates[duplicateRegistrationSessionKey(row, regMap)]) return;
    const name = String(row[regMap['Name']] || '').trim();
    const key = duplicateRegistrationNameKey(name);
    if (!name || !key) return;
    if (!byKey[key]) {
      byKey[key] = { name, phone: '', email: '', statuses: {} };
      order.push(key);
    }
    const person = byKey[key];
    // The first non-blank of each, which is nearly always every row's: a
    // person's number is a fact about them, not about one booking.
    if (!person.phone && regMap['Phone'] !== undefined) person.phone = String(row[regMap['Phone']] || '').trim();
    if (!person.email && regMap['Email'] !== undefined) person.email = String(row[regMap['Email']] || '').trim();
    if (status) person.statuses[status] = (person.statuses[status] || 0) + 1;
  });

  return order
    .map(key => byKey[key])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((person, i) => {
      const found = lookup(person.name);
      const states = Object.keys(person.statuses).sort();
      return {
        name: person.name,
        phone: person.phone,
        email: person.email,
        line: i + 1,
        match: 'exact',
        candidates: [person.name],
        suggested: person.name,
        // WHAT THEY ARE NOW, said on the row, because it is what decides which
        // actions can do anything: there is nothing to cancel about a
        // cancellation and nothing to promote about an Active seat.
        statuses: states,
        options: [Object.assign({ name: person.name, label: person.name }, found)]
      };
    });
}

/**
 * Called from the dialog's "pick from the program" button: the program's own
 * people, in the review's shape. Reads; writes nothing.
 */
function previewBulkRegistrantsFromRoster(programKey) {
  const program = listBulkRegistrantPrograms().filter(p => p.key === String(programKey || ''))[0];
  if (!program) {
    return { ok: false, message: '\u26a0\ufe0f That program has no upcoming dates any more \u2014 close this and open it again.' };
  }
  let people = [];
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const regSheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
    const regRows = regSheet ? getSectionedRowValues(regSheet, HEADERS.All_Registrants, 'Event_ID') : [];
    const clubRows = readClubMemberRows(ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS));
    people = bulkRosterPeopleFrom_(program, regRows, getIndexMap(HEADERS.All_Registrants),
      clubRows, getIndexMap(HEADERS.Club_Members));
  } catch (err) {
    log(`\u26a0\ufe0f Bulk registrations could not read who is on ${program.label} (${err}).`);
    return { ok: false, message: `\u26a0\ufe0f Could not read who is on that program: ${err}` };
  }
  if (!people.length) {
    return { ok: false, message: '\u2796 Nobody is registered on any of that program\u2019s upcoming dates yet, ' +
      'so there is nobody to change. Paste a list to put people on it.' };
  }
  return {
    ok: true,
    people,
    fromRoster: true,
    duplicatesChecked: true,
    counts: { exact: people.length, contact: 0, similar: 0, 'new': 0 }
  };
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

  let lookup = name => ({ nameKey: duplicateRegistrationNameKey(name), alreadyOn: {}, cancelledOn: {}, standing: false });
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
    `ℹ️ A bulk registration update has been idle for ${minutes} minute(s) — treating it as stopped.`);
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
      lunch: !!p.lunch,
      // WAS THIS PERSON THERE? The header tick sets it for the list and the
      // row's own tick may disagree; which DATES it then reaches is decided
      // per slice at write time, not here (see the banner).
      //
      // BULK_REGISTRANTS_PLAN_V1 KEEPS ITS KEY. The rule for a stored shape is
      // a new key, and the reason is a reader that would misread the old
      // shape — but this field is purely additive and its absence reads back
      // as false, which is exactly what every plan written before it meant:
      // nobody marked attended. So a job already mid-flight when this shipped
      // carries on correctly, and a plan written here and read by the older
      // code simply ignores it. Nothing stored changed meaning.
      attended: !!p.attended,
      // WHAT TO DO WITH THEM. Absent reads back as 'register', which is what
      // every plan written before this field meant and is why
      // BULK_REGISTRANTS_PLAN_V1 keeps its key: the shape is purely additive
      // and nothing stored changed meaning (the same reasoning as `attended`
      // above). A value outside the vocabulary is refused to 'register' here
      // rather than guessed at further down.
      action: BULK_REGISTRANT_ACTIONS.indexOf(String(p.action)) !== -1 ? String(p.action) : 'register',
      // One sentence, for the Admin_Notes stamp and the ledger entry every
      // status change leaves — "class cancelled", "term ended". Capped by
      // waitlistStamp()/cancellationStamp() where it lands.
      reason: String(p.reason || '')
    }));
  if (!people.length) return { ok: false, message: '⚠️ Nobody is ticked — nothing to do.' };
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
  // WHICH ACTIONS, in the log and in the label, because "40 people queued" on
  // a list that cancels them reads as the opposite of what it is.
  const actions = {};
  people.forEach(x => { actions[x.action] = (actions[x.action] || 0) + 1; });
  const what = Object.keys(actions).sort().map(k => `${actions[k]} ${k}`).join(', ');
  log(`startBulkRegistrants: ${program.label} — ${people.length} people queued (${what}).`);
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
  clearChunkedScriptProperty(BULK_FOLLOWUP_PROP_KEY);
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
    remaining: result.remaining || [],
    changedCount: (result.changed || []).length
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

  // WHICH OF THOSE DATES THE ATTENDED TICK REACHES — today and anything
  // earlier, and nothing else (bulkRegistrantAttendedDateKeys). Resolved HERE,
  // inside the slice that is about to write, rather than carried on the plan:
  // a list reviewed at five o'clock and finished by a trigger after midnight
  // would otherwise mark yesterday's class attended under tomorrow's name.
  const attendedKeys = {};
  if (person.attended) {
    bulkRegistrantAttendedDateKeys(sessions, formatDateKey(new Date()))
      .forEach(k => { attendedKeys[k] = true; });
  }

  const outcome = withScriptLock(DESK_LOCK_WAIT_MS * 5, () => {
    let done = 0;
    let already = 0;
    let refused = '';
    // ONE WRITE PER PERSON, not one per date. Each date is still Quick Mark's
    // Register — the same checks, the same row, the same ledger entry — but a
    // new row is HELD until the person's last date and then all of them go on
    // the tab together (withRegistrantAddBatch_, 38), where each used to be a
    // redraw of the whole Registrants tab: twenty people on eight dates was a
    // hundred and sixty of them.
    withRegistrantAddBatch_(() => sessions.forEach(session => {
      const res = applyQuickMarkLocked({
        location: program.location,
        session: session.value,
        name,
        register: true,
        // The desk's own Attended mark, on the dates it may be true of. Never
        // written here: applyQuickMarkLocked sets the column on an existing
        // row and on a row it creates, which is what keeps a bulk-added
        // attendance identical to a ticked one — the same cells, the same
        // Manual_Override stamp, the same ledger entry.
        attended: !!attendedKeys[session.dateKey],
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
      // what happened). The desk says it only when the tick added nothing at
      // all, so a person already on a date who is now being marked attended
      // does not come back that way — their Attended cell moved, which is a
      // write, and is counted as one.
      if (res.ok && /already registered/i.test(String(res.message || ''))) already++;
      else if (res.ok) done++;
      else if (!refused) refused = res.message || '';
    }));
    // Inside the lock, per person: the desk write buffers its ledger entries
    // (99k), and an entry buffered and never flushed is the loss the ledger
    // exists to prevent. One flush per person, not per date.
    flushPersistentRegistries();
    return { done, already, refused };
  }, null);
  if (!outcome) return { busy: true };

  const alreadyNote = outcome.already ? ` Already on ${outcome.already} date(s), left as they were.` : '';
  // NAMED, NOT COUNTED. "Marked attended" beside a person put on eight dates
  // is the sentence this rule exists to stop anybody reading, so the line says
  // which date(s) it was — and says nothing at all where the tick reached no
  // date, rather than reporting an attendance nobody got.
  const attendedLabels = sessions.filter(s => attendedKeys[s.dateKey]).map(s => s.dateLabel || s.dateKey);
  const attendedNote = attendedLabels.length
    ? ` Marked attended on ${attendedLabels.join(', ')}.`
    : (person.attended ? ' Not marked attended: every date chosen is still to come.' : '');
  let line;
  if (recurrence === 'club') {
    line = outcome.done || outcome.already
      ? `🔁 ${name} — standing place on ${program.title}; every future date will follow.${attendedNote}`
      : `⚠️ ${name} — no standing place was made. ${outcome.refused}`;
  } else if (outcome.done) {
    line = `✅ ${name} — ${outcome.done} of ${sessions.length} date(s).${alreadyNote}${attendedNote}` +
      (outcome.refused ? ` Not the rest: ${outcome.refused}` : '');
  } else if (outcome.already && !outcome.refused) {
    line = `➖ ${name} — already registered on every date chosen; nothing added.${attendedNote}`;
  } else {
    line = `⚠️ ${name} — nothing written.${alreadyNote} ${outcome.refused}`;
  }
  return { line, written: outcome.done };
}

// ----------------------------------------------------------------------------
// The other five actions: a list applied to bookings that already exist
// ----------------------------------------------------------------------------
//
// EVERY ONE OF THESE GOES THROUGH THE WRITER THAT ALREADY OWNS IT, for the
// reason the Register half goes through Quick Mark's own tick: a status is four
// cells that have to agree (71's banner), and a fourth copy of those four cells
// here would be a fourth place for them to come apart. So:
//
//   cancel      cancelRegistrantRowsLocked (71) — ONE call per person over
//               every chosen date at once, which is what its matcher argument
//               is for and what keeps a person's eight cancelled Tuesdays to
//               one render of the tab rather than eight.
//   waitlist    stampRegistrantRowWaitlisted (71), per row, one render after.
//   reactivate  stampRegistrantRowActive / stampRegistrantRowUncancelled (71,
//               99a) under 99a's own guards — a capacity waitlisting is never
//               jumped and a seat that is not there is never given.
//   contact     applyRegistrantChangeLocked's own `contact` (99a), once, which
//               already spreads a corrected number across every upcoming row.
//
// WHAT IS DELIBERATELY NOT HERE IS `remove`. 99a's banner argues its way to
// deleting a row outright rather than marking it, and the argument turns on
// the press being "nine changes deep behind a name, a date and a confirmation"
// — which is exactly what a list of forty names is not. A pasted column read
// as the wrong thing (the fault the whole mapping step exists for) would here
// be forty deletions nobody can get back. Cancel is the answer this list is
// allowed to give; a mistaken cancellation is a row that says so and a seat
// that can be given back.
//
// AND NOTHING IS WRITTEN FOR SOMEBODY WHO IS NOT THERE. Register's refusals
// are about doing a thing twice; these are about doing it to nobody, and the
// line says which rather than reporting a success over no rows at all.

/**
 * The rows one action is about: this person (and the guests who came with
 * them) on this program, on the chosen dates. Pure, and the one statement of
 * it — matchesCancellationParty (71) answers the same question keyed on an
 * Event_ID, which is the right key at the desk and the wrong one here: a list
 * is reviewed against DATES, and an Event_ID is a hash of calendar, title and
 * date that nothing can be read back out of.
 *
 * A GUEST GOES WITH THE PERSON WHO BROUGHT THEM and never the other way round,
 * the rule 71 states and this borrows whole.
 */
function bulkActionRowMatcher_(program, dateKeys, name) {
  const location = String((program && program.location) || '').trim().toLowerCase();
  const titleKey = String(quickMarkTitleKey((program && program.title) || '') || '').toLowerCase();
  const wanted = {};
  (dateKeys || []).forEach(k => { wanted[String(k)] = true; });
  const nameKey = normalizeNameKey(name);
  return (row, map) => {
    if (!nameKey) return false;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date || !wanted[formatDateKey(date)]) return false;
    if (String(row[map['Location']] || '').trim().toLowerCase() !== location) return false;
    if (String(quickMarkTitleKey(row[map['Event']]) || '').toLowerCase() !== titleKey) return false;
    if (normalizeNameKey(row[map['Name']]) === nameKey) return true;
    return String(row[map['Person_Type']] || '').trim() === 'Guest' &&
      normalizeNameKey(row[map['Primary_Registrant']]) === nameKey;
  };
}

/** The Admin_Notes stamp and the ledger word every action here shares. */
function bulkActionStampOptions_(person) {
  return {
    // Read in Admin_Notes by somebody six weeks later: the office did this,
    // which is what "in the workbook" means in that vocabulary (71).
    source: CANCELLATION_SOURCES.STAFF,
    ledgerSource: LEDGER_SOURCES.BULK_LIST,
    by: getCurrentUserEmail() || '',
    reason: String((person && person.reason) || '')
  };
}

/** Cancel one person across every chosen date, in one call and one render. */
function cancelOneBulkPerson_(program, sessions, person) {
  const name = String(person.name || '').trim();
  const dateKeys = sessions.map(s => s.dateKey);
  const result = cancelRegistrantRowsLocked(
    bulkActionRowMatcher_(program, dateKeys, name),
    Object.assign({ name, emptyMessage: `${name} had no live booking on the date(s) chosen.` },
      bulkActionStampOptions_(person))) || {};
  if (!result.ok || !result.cancelled) {
    return { line: `➖ ${name} — nothing cancelled: ${result.message || 'no live booking on those dates.'}`, written: 0 };
  }
  invalidateQuickMarkIndexCache();
  return {
    line: `✅ ${name} — cancelled on ${result.cancelled} row(s) of ${sessions.length} date(s); ` +
      `those seats and meals have gone back.`,
    written: result.cancelled
  };
}

/**
 * Onto the waiting list, or back off it, across every chosen date. One read,
 * the stampers per row, one render.
 *
 * `reactivate` carries 99a's three refusals rather than a looser version of
 * them: a capacity waitlisting is not promoted out of turn (wasWaitlistedByHand),
 * a seat that is not there is not given (registrantChangeSeatRefusal), and a
 * Superseded row is not a booking. Each is COUNTED and said, because "nothing
 * happened" and "the class is full" need different next steps.
 */
function restatusOneBulkPerson_(program, sessions, person, toWaitlist) {
  const name = String(person.name || '').trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
  if (!sheet) return { line: `⚠️ ${name} — there is no registrants tab to change.`, written: 0 };

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const rows = getSectionedRows(sheet, headers, 'Event_ID');
  const matches = rows.filter(row => bulkActionRowMatcher_(program, sessions.map(s => s.dateKey), name)(row, map));
  if (!matches.length) {
    return { line: `➖ ${name} — no row on the date(s) chosen, so nothing was changed.`, written: 0 };
  }

  const stamp = bulkActionStampOptions_(person);
  let moved = 0;
  let full = 0;
  let inTurn = 0;
  matches.forEach(row => {
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Superseded') return;
    if (toWaitlist) {
      const entry = ledgerEntryForStatusChange_(row, map, LEDGER_KINDS.WAITLISTED, stamp,
        { source: LEDGER_SOURCES.BULK_LIST });
      if (!stampRegistrantRowWaitlisted(row, map, stamp)) return;
      appendLedgerEntry(entry);
      moved++;
      return;
    }
    if (status === 'Active') return;
    if (status === 'Waitlisted' && !wasWaitlistedByHand(row, map)) { inTurn++; return; }
    const eventId = String(row[map['Event_ID']] || '').trim();
    if (registrantChangeSeatRefusal(rows, map, eventId, describeRegistrantRowSession(row, map))) { full++; return; }
    const entry = ledgerEntryForStatusChange_(row, map, LEDGER_KINDS.REACTIVATED, stamp,
      { source: LEDGER_SOURCES.BULK_LIST, note: status === 'Waitlisted'
        ? 'Taken off the waiting list from a list the office applied in bulk.'
        : 'Put back on the list from a list the office applied in bulk.' });
    if (status === 'Waitlisted') {
      if (!stampRegistrantRowActive(row, map, stamp)) return;
      // The leader's own tick left standing would re-waitlist them on the next
      // sync (applyLeaderWaitlistTicks, 71) — 99a's reasoning, unchanged.
      if (map['Waitlisted'] !== undefined) row[map['Waitlisted']] = false;
    } else if (!stampRegistrantRowUncancelled(row, map, stamp)) {
      return;
    }
    appendLedgerEntry(entry);
    moved++;
  });

  const notes = [];
  if (inTurn) notes.push(`${inTurn} waitlisted at capacity, not by hand — left in the queue`);
  if (full) notes.push(`${full} with no free seat`);
  if (!moved) {
    return { line: `➖ ${name} — nothing to ${toWaitlist ? 'waitlist' : 'put back on'}` +
      (notes.length ? ` (${notes.join('; ')})` : ' on the date(s) chosen') + '.', written: 0 };
  }
  finishRegistrantChange(ss, sheet, rows, toWaitlist
    ? `✅ ${name} moved onto the waiting list for ${moved} row(s).`
    : `✅ ${name} put back on the list for ${moved} row(s).`);
  return {
    line: `✅ ${name} — ${toWaitlist ? 'onto the waiting list' : 'back on the list'} ` +
      `on ${moved} row(s)` + (notes.length ? `; ${notes.join('; ')}` : '') + '.',
    written: moved
  };
}

/**
 * A corrected phone or email. 99a's own writer, once — it spreads across every
 * upcoming row this person has and appends one ledger entry per row, which is
 * what makes it a correction about a PERSON rather than about one booking. The
 * date scope therefore does not narrow it, and the line says so rather than
 * implying the chosen dates were all it touched.
 */
function contactOneBulkPerson_(program, sessions, person) {
  const name = String(person.name || '').trim();
  const phone = String(person.phone || '').trim();
  const email = String(person.email || '').trim();
  if (!phone && !email) {
    return { line: `➖ ${name} — the list has no phone or email for them, so nothing was changed.`, written: 0 };
  }
  const res = applyRegistrantChangeLocked({
    change: REGISTRANT_CHANGE_ACTIONS.CONTACT,
    name,
    location: program.location,
    session: sessions[0].value,
    phone, email,
    reason: String(person.reason || '')
  }) || {};
  return res.ok
    ? { line: `✅ ${name} — ${res.message}`, written: 1 }
    : { line: `⚠️ ${name} — ${res.message || 'the contact details could not be updated.'}`, written: 0 };
}

/**
 * ONE PERSON, ONE ACTION, under the workbook lock — the dispatcher the slice
 * calls. Register and Attended are the same path they always were
 * (registerOneBulkPerson_, which takes its own lock per person); the other
 * four take one lock around the one writer each needs.
 *
 * Returns { busy } when the lock could not be had, exactly as the Register
 * path does, so the slice's hand-off reads one answer for every action.
 */
function applyOneBulkPersonAction_(program, picked, person) {
  const action = BULK_REGISTRANT_ACTIONS.indexOf(String(person && person.action)) !== -1
    ? String(person.action) : 'register';
  if (action === 'register') return registerOneBulkPerson_(program, picked, person);
  // ATTENDED IS REGISTER WITH THE TICK FORCED, and deliberately not a writer of
  // its own: a sign-in sheet typed up at four o'clock names the people who were
  // in the room, some of whom never registered, and the desk's own answer to
  // that is a walk-in row marked attended. Which DATES the tick reaches is
  // still today-or-earlier, decided inside the slice (see the banner).
  if (action === 'attended') {
    return registerOneBulkPerson_(program, picked, Object.assign({}, person, { attended: true }));
  }

  const name = String((person && person.name) || '').trim();
  const sessions = bulkRegistrantSessionsFor(program, person.recurrence, picked);
  if (!sessions.length) {
    return { line: `⚠️ ${name} — no dates left to change, so nothing was written.`, written: 0 };
  }
  const outcome = withScriptLock(DESK_LOCK_WAIT_MS * 5, () => {
    let res;
    if (action === 'cancel') res = cancelOneBulkPerson_(program, sessions, person);
    else if (action === 'waitlist') res = restatusOneBulkPerson_(program, sessions, person, true);
    else if (action === 'reactivate') res = restatusOneBulkPerson_(program, sessions, person, false);
    else res = contactOneBulkPerson_(program, sessions, person);
    // Inside the lock, per person, for the reason the Register path flushes
    // here: an entry buffered and never flushed is the loss the ledger exists
    // to prevent (99k).
    flushPersistentRegistries();
    return res;
  }, null);
  return outcome || { busy: true };
}

/** ONE SLICE: work down the list until the budget runs out, then hand on. */
function runBulkRegistrantsSlice() {
  return runSlicedJob({
    label: 'Update registrations in bulk',
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
        const outcome = applyOneBulkPersonAction_(program, plan.picked, people[state.next]);
        if (outcome.busy) { busy = true; break; }
        result.lines = (result.lines || []).concat([outcome.line]);
        // WHO WAS ACTUALLY CHANGED, for the follow-up email: a person whose
        // outcome wrote nothing ("already registered", "no live booking") has
        // nothing to be told. The dates are the ones CHOSEN for the row, which
        // can name a date the person was already on — the email says "for",
        // not "newly added to".
        if (outcome.written > 0) {
          result.changed = (result.changed || []).concat([
            bulkFollowUpEntryFor_(program, plan.picked, people[state.next])]);
        }
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
    ? `⚠️ A bulk update of ${result.label || 'a program'} ${problem} — ` +
      `${next} of ${result.total || next} people done, ${remaining.length} not reached.`
    : `✅ Applied a bulk update to ${result.total || next} people on ${result.label || 'a program'} ` +
      `(${result.written || 0} row(s) written).`;
  log(`bulkRegistrants: ${headline}`);
  if (problem && problem !== 'was stopped') {
    spoolOfficeNote('Update Registrations in Bulk', `${headline} Not reached: ${remaining.join(', ')}.`);
  }
  toastIfPossible(headline);
  return result;
}

// ----------------------------------------------------------------------------
// THE FOLLOW-UP EMAIL: telling the people whose registration just changed
// ----------------------------------------------------------------------------
//
// A list that cancels twenty people at four o'clock is, in the office's hands,
// twenty phone calls or one email. This is the email: after the job finishes,
// the dialog offers one message, written once, sent to each person the job
// ACTUALLY changed (result.changed, recorded as each person finishes — somebody
// "already registered" or with "no live booking" wrote nothing and is not told
// anything).
//
// IT IS THE ORDINARY MAILER, so every house rule holds without being restated
// here: the quota floor, quiet hours (5pm–8am: held, not dropped — the list
// below is KEPT, so pressing Send again after eight carries on), the Config
// pause, and notification test mode all live in sendRationedEmail (76). A hold
// stops the whole send, because every later message would be held for the same
// reason and a loop of identical refusals is what `retry` exists to prevent.
//
// NOBODY IS WRITTEN TO TWICE. Each recipient's status is saved as the send
// goes (BULK_FOLLOWUP_PROP_KEY) and `alreadySent` reads it, so a second press,
// a reopened window or a call that overlapped the first re-sends no one.
//
// THE ADDRESS comes off the list the person was entered on, then Member_Roll
// by name. A person with neither is shown as "no email" and left out — nothing
// guesses an address, and nothing else is done about it.
//
// Client-driven in chunks (BULK_FOLLOWUP_BUDGET_MS) rather than a sliced job,
// on 99s's precedent: somebody is watching, and the daily quota bounds the list.

/** The follow-up record for one person the job changed. Pure. */
function bulkFollowUpEntryFor_(program, picked, person) {
  const action = BULK_FOLLOWUP_CHANGE_PHRASES[person.action] ? person.action : 'register';
  let dates = '';
  if (action === 'contact') dates = '';
  else if (person.recurrence === 'club') dates = 'every upcoming date';
  else dates = bulkRegistrantSessionsFor(program, person.recurrence, picked)
    .map(s => s.dateLabel || s.dateKey).join(', ');
  return { name: String(person.name || '').trim(), email: String(person.email || '').trim(), action, dates };
}

/**
 * Fills {Name} {Program} {Dates} {Change} in `template`. Pure, single pass (a
 * value containing "{Name}" is not expanded again), case-insensitive, and any
 * other brace text is left exactly as typed.
 */
function renderBulkFollowUpText_(template, vars) {
  return String(template || '').replace(/\{(name|program|dates|change)\}/gi,
    (m, key) => String(vars[key.toLowerCase()] || ''));
}

function bulkFollowUpVars_(state, r) {
  return {
    name: r.name,
    program: state.label || '',
    dates: r.dates || 'the dates on your registration',
    change: BULK_FOLLOWUP_CHANGE_PHRASES[r.action] || ''
  };
}

function defaultBulkFollowUpMessage_() {
  return {
    subject: 'Your registration for {Program} has been updated',
    body: 'Hello {Name},\n\nWe are writing to let you know that {Change}: {Program}, {Dates}.\n\n' +
      'If this does not look right, please reply to this email or give us a call.\n\n' +
      (typeof CENTER_NAME === 'string' ? CENTER_NAME : '')
  };
}

function readBulkFollowUp_() {
  const text = readChunkedScriptProperty(BULK_FOLLOWUP_PROP_KEY);
  if (!text) return null;
  try { return JSON.parse(text); } catch (err) { return null; }
}

function writeBulkFollowUp_(state) {
  return writeChunkedScriptProperty(BULK_FOLLOWUP_PROP_KEY, JSON.stringify(state),
    BULK_REGISTRANTS_CHUNK_CHARS, BULK_REGISTRANTS_MAX_CHUNKS);
}

/** The address for each name the roll holds, keyed by normalizeNameKey. */
function bulkFollowUpRollEmails_() {
  const byName = {};
  try {
    readMemberRollRows().rows.forEach(row => {
      const email = String(row.Email || '').trim();
      if (!BULK_REGISTRANT_EMAIL_RE.test(email)) return;
      [row.Name, row.Display_Name].forEach(n => {
        const key = normalizeNameKey(n);
        if (key && !byName[key]) byName[key] = email;
      });
    });
  } catch (err) {
    log(`ℹ️ Bulk follow-up could not read the member roll for addresses (${err}).`);
  }
  return byName;
}

/**
 * Called by the dialog once a list has finished: who can be written to, who
 * cannot, and the starting wording. Idempotent — a follow-up already prepared
 * for this job is returned with its sent marks, never rebuilt, which is what
 * keeps a reopened window from forgetting who has been told.
 */
function prepareBulkFollowUp() {
  const result = readBulkRegistrantsResult_();
  if (!result || !result.done) return { ok: false, message: 'The list has not finished yet.' };
  let state = readBulkFollowUp_();
  if (!state || state.jobId !== result.jobId) {
    const roll = (result.changed || []).some(c => !BULK_REGISTRANT_EMAIL_RE.test(c.email))
      ? bulkFollowUpRollEmails_() : {};
    const seen = {};
    const recipients = [];
    (result.changed || []).forEach(c => {
      const email = BULK_REGISTRANT_EMAIL_RE.test(c.email) ? c.email : (roll[normalizeNameKey(c.name)] || '');
      // One message per ADDRESS: a household entered twice on one email is one
      // person to write to, and the second copy is the duplicate this avoids.
      const key = email.toLowerCase() + '|' + c.action;
      if (email && seen[key]) return;
      if (email) seen[key] = true;
      recipients.push({ name: c.name, email, action: c.action, dates: c.dates, status: '', error: '' });
    });
    state = { jobId: result.jobId, label: result.label || '', recipients };
    if (!writeBulkFollowUp_(state)) {
      return { ok: false, message: '⚠️ The recipient list could not be saved, so nothing can be sent safely.' };
    }
  }
  return Object.assign({ ok: true, label: state.label, quietHours: isWithinMailQuietHours(),
    recipients: state.recipients.map((r, id) => ({ id, name: r.name, email: r.email,
      change: BULK_FOLLOWUP_CHANGE_PHRASES[r.action], dates: r.dates, status: r.status, error: r.error })) },
    defaultBulkFollowUpMessage_());
}

/** The first ticked recipient's message exactly as it will go. */
function previewBulkFollowUp(args) {
  args = args || {};
  const state = readBulkFollowUp_();
  if (!state) return { ok: false, message: 'No follow-up is prepared.' };
  const ids = (args.ids || []).map(Number);
  const r = state.recipients[ids.length ? ids[0] : 0];
  if (!r) return { ok: false, message: 'Tick at least one person.' };
  const vars = bulkFollowUpVars_(state, r);
  return { ok: true, to: r.email, subject: renderBulkFollowUpText_(args.subject, vars),
    body: renderBulkFollowUpText_(args.body, vars) };
}

/**
 * Sends to the ticked people not yet written to, for at most
 * BULK_FOLLOWUP_BUDGET_MS. Returns { ok, sent, failed, remaining, stopped,
 * message, recipients } — `remaining` > 0 with no `stopped` means "call again".
 */
function sendBulkFollowUp(args) {
  args = args || {};
  const subject = String(args.subject || '').replace(/[\r\n]+/g, ' ').trim();
  const body = String(args.body || '').trim();
  if (!subject || !body) return { ok: false, message: 'Write a subject and a message first.' };
  if (subject.length > 200 || body.length > 8000) return { ok: false, message: 'That message is too long.' };
  const state = readBulkFollowUp_();
  if (!state) return { ok: false, message: 'No follow-up is prepared — close this and reopen the finished list.' };

  const wanted = {};
  (args.ids || []).forEach(i => { wanted[Number(i)] = true; });
  const deadline = Date.now() + BULK_FOLLOWUP_BUDGET_MS;
  let sent = 0;
  let failed = 0;
  let stopped = '';
  try {
    for (let i = 0; i < state.recipients.length && !stopped; i++) {
      const r = state.recipients[i];
      if (!wanted[i] || r.status === 'sent' || r.status === 'failed') continue;
      if (!BULK_REGISTRANT_EMAIL_RE.test(r.email)) continue;
      if (Date.now() >= deadline) break;
      const vars = bulkFollowUpVars_(state, r);
      const outcome = sendRationedEmail({
        to: r.email,
        subject: renderBulkFollowUpText_(subject, vars),
        body: renderBulkFollowUpText_(body, vars),
        reserve: BULK_FOLLOWUP_QUOTA_RESERVE,
        alreadySent: () => r.status === 'sent',
        // Deliberately empty: the mailer calls this for a PAUSED message too
        // (76), so the status below — not this — says what happened.
        recordSent: () => {}
      });
      if (outcome.status === 'sent') {
        r.status = 'sent'; sent++;
        spoolOfficeNote('Bulk update follow-up emails', `${r.name} <${r.email}> — "${state.label}"`);
      } else if (outcome.status === 'duplicate') {
        r.status = 'sent';
      } else if (outcome.status === 'held') {
        stopped = outcome.retry === 'diverted'
          ? 'Notification test mode is on — those went to the office, not to the people. Turn it off on Config to send for real.'
          : outcome.retry === 'tomorrow'
            ? 'Today’s mail allowance is used up. The list is kept — press Send again tomorrow.'
            : 'Mail is held right now (nothing leaves between 5pm and 8am, and the day’s allowance keeps a reserve). ' +
              'The list is kept — press Send again later.';
      } else if (outcome.status === 'paused') {
        stopped = 'Outbound mail is paused on Config, so nothing was sent.';
      } else {
        r.status = 'failed'; r.error = String(outcome.error || outcome.status); failed++;
      }
      if ((sent + failed) % 10 === 0) writeBulkFollowUp_(state);
    }
  } finally {
    writeBulkFollowUp_(state);
  }
  const remaining = state.recipients.filter((r, i) =>
    wanted[i] && r.status !== 'sent' && r.status !== 'failed' && BULK_REGISTRANT_EMAIL_RE.test(r.email)).length;
  log(`bulkRegistrants follow-up: ${sent} sent, ${failed} failed, ${remaining} to go${stopped ? ' — ' + stopped : ''}`);
  return { ok: true, sent, failed, remaining, stopped,
    recipients: state.recipients.map((r, id) => ({ id, status: r.status, error: r.error })) };
}

/** The menu item. Open to everyone, like Quick Mark's Register: it deletes nothing. */
function showBulkRegistrantsDialog() {
  const html = HtmlService.createHtmlOutput(buildBulkRegistrantsHtml())
    .setWidth(920)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'Update Registrations in Bulk');
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
<h3>2. What to do with them</h3>
<select id="action">
  <option value="register">Register them</option>
  <option value="attended">Register if needed, and mark them attended</option>
  <option value="cancel">Cancel their registration</option>
  <option value="waitlist">Move them onto the waiting list</option>
  <option value="reactivate">Put them back on (off the waiting list, or after a cancellation)</option>
  <option value="contact">Update their phone / email</option>
</select>
<label style="margin-left:12px">Why (optional): <input id="reason" type="text" style="width:260px"
  placeholder="class cancelled, term ended…"></label>
<p class="hint" id="actionHint" style="margin-top:4px"></p>
<div id="recurrenceRow" style="margin-top:8px">
  Which dates, for everyone (change any row below):
  <select id="recurrence">
    <option value="next">Next date only</option>
    <option value="picked">The dates ticked below</option>
    <option value="all">Every date through next month</option>
    <option value="club">Standing place (every future date)</option>
  </select>
  <label style="margin-left:12px"><input type="checkbox" id="lunch"> with lunch</label>
  <label style="margin-left:12px"><input type="checkbox" id="attended"> mark everyone attended</label>
  <span class="hint" style="display:block;margin-top:4px">Attended is a fact about a day, so it is only
  written on dates that are <b>today or earlier</b> — a future date is registered and left unmarked, and a
  row with no such date has its box greyed out.</span>
</div>
<div id="dates" style="margin-top:6px"></div>
<h3>3. Who</h3>
<p class="hint"><b>Everybody already on this program</b> is the quick way for anything but Register — their names
come off the tab, so there is nothing to type and no spelling to get wrong. Tick the ones you mean in the review.</p>
<div><button id="roster" class="plain" onclick="pickFromRoster()">Pick from this program’s registrants</button></div>
<p class="hint" style="margin-top:10px">Or open an Excel (.xlsx) or CSV file, or paste the list — one person per line,
straight out of a spreadsheet or typed as <code>Name, Phone, Email</code>. An Excel file is read from its first sheet.</p>
<input type="file" id="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
<textarea id="csv" style="margin-top:6px" placeholder="…or paste here"></textarea>
<div style="margin-top:8px"><button id="read" onclick="readColumns()">Read the columns</button></div>
<div id="mapping" style="display:none">
<h3>4. Which column is which</h3>
<p class="hint">Check each column's heading — it is a guess. Set a column to <b>ignore</b> to leave it out;
two columns set to the same name part are joined.</p>
<label><input type="checkbox" id="hasHeader"> The first row is headings, not a person</label>
<div id="columns" style="margin-top:6px"></div>
<div style="margin-top:8px"><button id="check" onclick="check()">Check against the member roll</button></div>
</div>
<div id="reviewBox" style="display:none">
<h3>5. Review</h3>
<p class="hint"><span class="exact">On the roll</span> is used as-is.
<span class="contact">Same phone/email</span> is pre-selected — check it.
<span class="similar">Similar name</span> is offered but not chosen.
<span class="new">New</span> is added to the roll as typed.
Anybody the chosen action <b>cannot do anything for</b> — already registered when registering, not
registered at all when cancelling — is unticked for you and says why. Untick anybody else to leave them out.</p>
<p class="hint" style="margin:0 0 6px 0"><a href="#" onclick="return tickAll(true)">Check all</a> ·
<a href="#" onclick="return tickAll(false)">Uncheck all</a></p>
<div id="review"></div>
<div style="margin-top:8px"><button id="commit" onclick="commit()" disabled>Apply to the ticked people</button></div>
</div>
</div>
<div id="progress">
<h3 id="progTitle">Working through the list…</h3>
<div class="bar"><div id="barFill"></div></div>
<div id="progText"></div>
<p class="hint">This carries on by itself, a few minutes at a time, until everybody is done —
you can close this window and open it again to see how far it has got.</p>
<div id="log"></div>
<div id="followup" style="display:none">
<h3>Follow up: email the people who were changed</h3>
<p class="hint">One email each, to the people this list actually changed (anybody it left alone is not here).
Use <code>{Name}</code>, <code>{Program}</code>, <code>{Dates}</code> and <code>{Change}</code> to personalise it.
Mail follows the usual rules — nothing leaves between 5pm and 8am, and this list is kept so you can send later.</p>
<div id="fuWarn" class="err"></div>
<div id="fuPeople"></div>
<label>Subject <input id="fuSubject" type="text" style="width:100%;box-sizing:border-box"></label>
<textarea id="fuBody" style="height:130px;margin-top:6px;font-family:Arial,Helvetica,sans-serif;font-size:13px"></textarea>
<div style="margin-top:6px">
  <button id="fuPreview" class="plain" onclick="fuPreview()">Preview</button>
  <button id="fuSend" onclick="fuSend()">Send emails</button>
</div>
<div id="fuPreviewBox" class="hint" style="white-space:pre-wrap"></div>
<div id="fuStatus" style="white-space:pre-wrap;margin-top:6px"></div>
</div>
<div style="margin-top:8px">
  <button id="stop" class="plain" onclick="stopJob()">Stop after this person</button>
  <button id="carryOn" onclick="carryOn()" style="display:none">Carry on</button>
  <button id="another" onclick="another()" style="display:none">Start another list</button>
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
  // Where this list came from: the tab's own registrants, or a paste. It
  // changes nothing about the write — only whether the mapping step is shown
  // and what the review says a row was read out of.
  var FROM_ROSTER = false;
  // The per-row dropdown's words. Short, because they sit in a table cell
  // beside seven other columns; the full sentences are in the header select.
  var ACTIONS = [['register','Register'],['attended','Register + attended'],['cancel','Cancel'],
    ['waitlist','Waitlist'],['reactivate','Put back on'],['contact','Update contact']];
  // One sentence under the header dropdown, because what a row's note MEANS
  // reads backwards between the two halves: unticked-because-already-there
  // when registering, unticked-because-not-there when cancelling.
  var ACTION_HINTS = {
    register: 'Puts each ticked person on the dates chosen. Anybody already registered on all of them is unticked.',
    attended: 'Marks the day they came, and registers anybody who was not signed up — which is what a sign-in sheet typed up at four o’clock is. Attended is only written on dates that are today or earlier.',
    cancel: 'Takes the booking off and gives the seat and the meal back, on the dates chosen. Their guests go with them. Anybody with no live booking on those dates is unticked.',
    waitlist: 'No seat and no meal: the row stays, as a place in the queue. Only an active booking can be moved, so anybody already waiting or cancelled is unticked.',
    reactivate: 'Puts a cancelled or by-hand waitlisted booking back. Somebody waitlisted because the class was FULL is never promoted out of turn, and a seat that is not there is never given — those rows say so and are left alone.',
    contact: 'Writes the phone and email from the list onto every one of that person’s upcoming rows, whichever dates are chosen above. Nothing else about the booking changes.'
  };
  function action() { return $('action').value; }
  function isRegisterish(a) { return a === 'register' || a === 'attended'; }
  // Today as the WORKBOOK's own date key, for the attended rule — read off
  // the programs the server sent (groupBulkRegistrantPrograms_ puts it there)
  // rather than off this tablet's clock, which may be in another timezone or
  // simply wrong. Empty until the list arrives, which greys every attended box
  // until it does: nothing may be ticked attended on a day nobody has stated.
  var TODAY = '';
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
    TODAY = (PROGRAMS[0] && PROGRAMS[0].todayKey) || '';
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
  // THE ACTION, for the whole list, with every row's own dropdown following it
  // — the same bargain the recurrence and the attended box make: a starting
  // point for the list, which any one row may then disagree with.
  $('action').addEventListener('change', function () { applyAction(); });
  function applyAction() {
    var a = action();
    $('actionHint').textContent = ACTION_HINTS[a] || '';
    // A standing place is a REGISTRATION on every future date, which is not a
    // thing any of the other five actions can be about. Rather than leave a
    // dead end in the dropdown, the option goes away and anything sitting on
    // it moves to every date — the widest honest reading of what was chosen.
    var clubOk = a === 'register';
    Array.prototype.forEach.call(document.querySelectorAll('option[value=club]'), function (o) {
      o.disabled = !clubOk;
      o.hidden = !clubOk;
    });
    if (!clubOk && $('recurrence').value === 'club') $('recurrence').value = 'all';
    // The two marks only mean anything beside a registration.
    $('lunch').disabled = !isRegisterish(a);
    $('attended').disabled = a !== 'register';
    ROWS.forEach(function (r) {
      r.act.value = a;
      if (!clubOk && r.rec.value === 'club') r.rec.value = 'all';
    });
    evaluate();
  }
  // SELECT ALL, and no more than that: it sets what every row ASKED for, and
  // evaluate() still decides what each row can actually be given. Untick one
  // row afterwards and it stays unticked — the header is a starting point for
  // the list, not an override of the person reading it.
  $('attended').addEventListener('change', function () {
    var on = this.checked;
    ROWS.forEach(function (r) { r.attWanted = on; });
    evaluate();
  });

  // ---- 2. The file or the paste.
  $('file').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (/[.]xls$/i.test(f.name)) {
      say('That is an old-style Excel file (.xls) — save it as .xlsx or CSV first, then open that.', 'err');
      return;
    }
    if (/[.]xls[xm]$/i.test(f.name)) { readExcel(f); return; }
    var reader = new FileReader();
    reader.onload = function () { $('csv').value = String(reader.result || ''); readColumns(); };
    reader.onerror = function () { say('Could not read that file.', 'err'); };
    reader.readAsText(f);
  });

  // An .xlsx is a zip, and the browser has no reader for it — the server does
  // (readBulkRegistrantXlsx), and hands the first sheet back as pasted text.
  function readExcel(f) {
    var reader = new FileReader();
    reader.onload = function () {
      var b64 = String(reader.result || '').split(',')[1] || '';
      $('read').disabled = true;
      say('Reading the Excel file…');
      google.script.run.withSuccessHandler(function (res) {
        $('read').disabled = false;
        $('csv').value = (res && res.text) || '';
        showColumns(res, res && res.sheetName ? ' (sheet "' + res.sheetName + '")' : '');
      }).withFailureHandler(function (err) {
        $('read').disabled = false;
        say('Failed: ' + err.message, 'err');
      }).readBulkRegistrantXlsx(b64);
    };
    reader.onerror = function () { say('Could not read that file.', 'err'); };
    reader.readAsDataURL(f);
  }

  function showColumns(res, from) {
    if (!res || !res.records || !res.records.length) { say('No rows found in that.', 'err'); return; }
    RAW = res;
    $('hasHeader').checked = !!res.hasHeader;
    drawColumns();
    $('mapping').style.display = '';
    $('reviewBox').style.display = 'none';
    PEOPLE = []; ROWS = [];
    say(res.records.length + ' row(s), ' + res.columns + ' column(s)' + (from || '') + '. Check the headings, then press Check.');
  }

  function readColumns() {
    var text = $('csv').value;
    if (!text.trim()) { say('Open a file or paste some names first.', 'err'); return; }
    $('read').disabled = true;
    say('Reading…');
    google.script.run.withSuccessHandler(function (res) {
      $('read').disabled = false;
      showColumns(res, '');
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
      FROM_ROSTER = false;
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

  // THE OTHER WAY IN: this program's own registrants, already matched.
  function pickFromRoster() {
    if (!program()) { say('Choose the program first.', 'err'); return; }
    $('roster').disabled = true;
    say('Reading who is on this program…');
    google.script.run.withSuccessHandler(function (res) {
      $('roster').disabled = false;
      if (!res || !res.ok) { say((res && res.message) || 'Nothing came back.', 'err'); return; }
      FROM_ROSTER = true;
      RAW = null;
      PEOPLE = res.people;
      $('mapping').style.display = 'none';
      drawReview();
      say(PEOPLE.length + ' people are on this program’s upcoming dates. Tick the ones you mean.' + summaryOfAlready());
    }).withFailureHandler(function (err) {
      $('roster').disabled = false;
      say('Failed: ' + err.message, 'err');
    }).previewBulkRegistrantsFromRoster($('program').value);
  }

  // ---- 5. The review.
  function drawReview() {
    var box = $('review');
    box.textContent = '';
    ROWS = [];
    var table = el('table');
    var head = el('tr');
    ['', 'Row', 'Name', 'Match', 'Acting on', 'Phone', 'Email', 'What to do', 'Which dates', 'Attended today', 'Note']
      .forEach(function (h) { head.appendChild(el('th', h)); });
    table.appendChild(head);
    var defaultRec = $('recurrence').value;
    var defaultAtt = $('attended').checked;
    PEOPLE.forEach(function (p, i) {
      var tr = el('tr');
      var r = { tr: tr, person: p, auto: false, touched: false };
      var tdOn = el('td'); var on = document.createElement('input');
      // A list read off the program starts with nobody ticked: it is everybody
      // on the program, and the point of picking is to choose some of them. A
      // pasted list is the opposite — every line was typed on purpose.
      on.type = 'checkbox'; on.checked = !FROM_ROSTER;
      on.addEventListener('change', function () { r.touched = true; updateCommit(); });
      tdOn.appendChild(on); tr.appendChild(tdOn); r.on = on;
      tr.appendChild(el('td', String(p.line || i + 1)));
      tr.appendChild(el('td', p.name));
      // A name read off the tab has no spelling to resolve, so the Match column
      // says what it IS instead — Active, Waitlisted, Cancelled — which is the
      // thing somebody picking people off a roster is actually reading down.
      tr.appendChild(p.statuses && p.statuses.length
        ? el('td', p.statuses.join(', '), 'exact')
        : el('td', LABELS[p.match] || p.match, p.match));
      var tdAs = el('td'); var as = document.createElement('select');
      (p.options || []).forEach(function (opt, k) { var o = el('option', opt.label); o.value = String(k); as.appendChild(o); });
      for (var k = 0; k < (p.options || []).length; k++) if (p.options[k].name === p.suggested) as.value = String(k);
      as.addEventListener('change', evaluate);
      tdAs.appendChild(as); tr.appendChild(tdAs); r.as = as;
      tr.appendChild(el('td', p.phone || ''));
      tr.appendChild(el('td', p.email || ''));
      // THE ROW'S OWN ACTION, which may disagree with the header's — "all of
      // these cancelled except Marion, who is moving to the waiting list" is
      // one list and one press, not two.
      var tdAct = el('td'); var act = document.createElement('select');
      ACTIONS.forEach(function (x) { var o = el('option', x[1]); o.value = x[0]; act.appendChild(o); });
      act.value = action();
      act.addEventListener('change', evaluate);
      tdAct.appendChild(act); tr.appendChild(tdAct); r.act = act;
      var tdRec = el('td'); var rec = document.createElement('select');
      RECURRENCES.forEach(function (x) { var o = el('option', x[1]); o.value = x[0]; rec.appendChild(o); });
      rec.value = defaultRec;
      rec.addEventListener('change', evaluate);
      tdRec.appendChild(rec); tr.appendChild(tdRec); r.rec = rec;
      // THE ROW'S OWN ANSWER, which may disagree with the header's. attWanted
      // is what the person asked for and the box is what can actually happen:
      // they part company on a row whose dates are all still to come, and come
      // back together the moment its dates include today (see evaluate()).
      var tdAtt = el('td'); var att = document.createElement('input');
      att.type = 'checkbox'; att.checked = defaultAtt;
      att.addEventListener('change', function () { r.attWanted = att.checked; evaluate(); });
      tdAtt.appendChild(att); tr.appendChild(tdAtt); r.att = att; r.attWanted = defaultAtt;
      r.note = el('td', '', 'note'); tr.appendChild(r.note);
      table.appendChild(tr);
      ROWS.push(r);
    });
    box.appendChild(table);
    $('reviewBox').style.display = '';
    applyAction();
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
  function chosen(r) {
    return (r.person.options || [])[Number(r.as.value)] ||
      { name: r.person.name, alreadyOn: {}, cancelledOn: {} };
  }
  // The same rule the server applies (bulkRegistrantAttendedDateKeys), said
  // once more here so the screen can grey out a box that would do nothing.
  // The server is still the one that decides, on the day it writes.
  function attendableDates(rec) {
    return datesFor(rec).filter(function (d) { return d.dateKey <= TODAY; });
  }

  // WHAT THE CHOSEN ACTION CAN ACTUALLY DO FOR THIS ROW, as { note,
  // nothingToDo } — said on screen before anything is written, and the one
  // place the two halves of this dialog read in opposite directions.
  //
  // Registering somebody already registered is the duplicate 85 exists to
  // clean up, so "already there" unticks the row. Cancelling somebody already
  // registered is the ONLY case there is anything to do, so "not there at all"
  // unticks it instead. The same screen, the same column, opposite verdicts —
  // which is exactly why this is one function with the action in front of it
  // rather than a condition threaded through the loop below.
  //
  // Unticking is still a DEFAULT and never a refusal: the writer's own checks
  // are underneath every one of these, and a tick put back writes nothing
  // twice and cancels nothing that is not there.
  function judge(opt, rec, act, person) {
    var on = opt.alreadyOn || {};
    var off = opt.cancelledOn || {};
    var dates = datesFor(rec);
    if (!dates.length && act !== 'contact') return { note: 'No dates chosen.', nothingToDo: false };
    var live = dates.filter(function (d) { return on[d.dateKey]; });
    var activeOnly = dates.filter(function (d) { return on[d.dateKey] === 'Active'; });
    var waiting = dates.filter(function (d) { return on[d.dateKey] === 'Waitlisted'; });
    var cancelled = dates.filter(function (d) { return off[d.dateKey]; });
    var labels = function (list) { return list.map(function (d) { return d.dateLabel; }).join(', '); };

    if (act === 'register') {
      if (rec === 'club' && opt.standing) {
        return { note: 'Already has a standing place on this program.', nothingToDo: true };
      }
      if (rec === 'club') return { note: '', nothingToDo: false };
      if (live.length === dates.length) {
        return { nothingToDo: true, note: 'Already registered' +
          (dates.length > 1 ? ' on all ' + dates.length + ' dates' : ' for ' + dates[0].dateLabel) +
          (waiting.length ? ' (waitlisted)' : '') + '.' };
      }
      if (live.length) {
        return { nothingToDo: false, note: 'Already on ' + labels(live) +
          (waiting.length ? ' (waitlisted)' : '') + ' — only the other ' + (dates.length - live.length) +
          ' will be added.' };
      }
      return { note: '', nothingToDo: false };
    }
    if (act === 'attended') {
      var marks = attendableDates(rec);
      if (!marks.length) {
        return { nothingToDo: false, note: 'No date today or earlier is chosen, so nothing will be marked ' +
          'attended — they will be registered for the ' + dates.length + ' date(s) chosen.' };
      }
      return { nothingToDo: false, note: 'Attended on ' + labels(marks) +
        (live.length ? '' : ' — and registered, since they are not signed up.') };
    }
    if (act === 'cancel') {
      if (!live.length) {
        return { nothingToDo: true, note: cancelled.length
          ? 'Already cancelled on ' + labels(cancelled) + ' — nothing to cancel.'
          : 'Not registered on the date(s) chosen, so there is nothing to cancel.' };
      }
      return { nothingToDo: false, note: 'Will be cancelled on ' + labels(live) + '.' +
        (opt.standing ? ' They also hold a standing place — untick Active on the club list, or the next sync books them again.' : '') };
    }
    if (act === 'waitlist') {
      if (!activeOnly.length) {
        return { nothingToDo: true, note: waiting.length
          ? 'Already on the waiting list for ' + labels(waiting) + '.'
          : 'No active booking on the date(s) chosen, so there is nothing to move.' };
      }
      return { nothingToDo: false, note: 'Onto the waiting list for ' + labels(activeOnly) +
        ' — no seat and no meal.' };
    }
    if (act === 'reactivate') {
      var back = waiting.concat(cancelled);
      if (!back.length) {
        return { nothingToDo: true, note: activeOnly.length
          ? 'Already on the list for ' + labels(activeOnly) + ' — nothing to put back.'
          : 'Nothing cancelled or waitlisted on the date(s) chosen.' };
      }
      return { nothingToDo: false, note: 'Put back on for ' + labels(back) +
        '. A place the class’s capacity decided is never promoted out of turn — those rows will say so.' };
    }
    // contact. The details are read off the ROW as it was read in, never off
    // the name chosen from the roll — the roll's copy is the one being
    // replaced, and taking the new number from it would write it back onto
    // itself and report a correction that corrected nothing.
    var p = person || {};
    if (!String(p.phone || '').trim() && !String(p.email || '').trim()) {
      return { nothingToDo: true, note: 'No phone or email on this row, so there is nothing to put on.' };
    }
    return { nothingToDo: false, note: 'Phone / email written onto every upcoming row they have.' };
  }

  // Who is already there, and who is on the list twice — worked out again on
  // every change, because the answer depends on the name, the dates and the
  // program. A row that becomes a duplicate is unticked unless somebody has
  // ticked it by hand; one that stops being one is ticked again.
  function evaluate() {
    var seen = {};
    ROWS.forEach(function (r) {
      var opt = chosen(r);
      var rec = r.rec.value;
      var act = r.act.value;
      var verdict = judge(opt, rec, act, r.person);
      var note = verdict.note;
      var already = verdict.nothingToDo;
      var key = opt.nameKey || '';
      if (!already && key && seen[key]) {
        already = true;
        note = 'Listed twice — same person as row ' + seen[key] + '.';
      }
      // Attended is only offered beside a plain Register: the Attended ACTION
      // already means it, and the other four are not about a day anybody came.
      var attendRow = act === 'register';
      if (!already && key && (r.on.checked || r.auto)) seen[key] = r.person.line;
      // Attendance is a fact about a day: a row whose chosen dates are all
      // still to come cannot be marked, so the box is greyed rather than
      // left ticked over a promise the write will not keep.
      var canAttend = attendRow && attendableDates(rec).length > 0;
      r.att.disabled = !canAttend;
      r.att.checked = canAttend && !!r.attWanted;
      r.att.title = canAttend
        ? 'Marked attended on ' + attendableDates(rec).map(function (d) { return d.dateLabel; }).join(', ')
        : (attendRow
          ? 'No date today or earlier is chosen for this row, so there is no day to mark.'
          : 'Only a plain Register offers this — the Attended action already marks the day.');
      r.note.textContent = note;
      r.tr.className = already ? 'already' : '';
      if (already && !r.touched && r.on.checked) { r.on.checked = false; r.auto = true; }
      else if (!already && r.auto && !r.touched) { r.on.checked = true; r.auto = false; }
    });
    updateCommit();
  }
  function summaryOfAlready() {
    var n = ROWS.filter(function (r) { return r.tr.className === 'already'; }).length;
    return n ? ' ' + n + ' with nothing for this action to do (or listed twice) — unticked.' : '';
  }

  // Check all ticks every row that has something to do; a row the review has
  // greyed out ("already registered", "listed twice") stays unticked, because
  // ticking those is how a person is registered twice.
  function tickAll(on) {
    ROWS.forEach(function (r) {
      if (on && r.tr.className === 'already') return;
      r.on.checked = on; r.touched = true; r.auto = false;
    });
    updateCommit();
    return false;
  }

  function updateCommit() {
    var any = ROWS.some(function (r) { return r.on.checked; });
    $('commit').disabled = !(any && program());
  }

  function commit() {
    var p = program();
    if (!p) { say('Choose a program first.', 'err'); return; }
    var lunch = $('lunch').checked && !$('lunch').disabled;
    var reason = $('reason').value;
    var people = [];
    var byAction = {};
    ROWS.forEach(function (r) {
      if (!r.on.checked) return;
      var opt = chosen(r);
      var act = r.act.value;
      byAction[act] = (byAction[act] || 0) + 1;
      people.push({ name: opt.name, phone: r.person.phone, email: r.person.email,
        recurrence: r.rec.value, action: act, reason: reason,
        lunch: lunch && isRegisterish(act),
        attended: act === 'register' && r.att.checked && !r.att.disabled });
    });
    // WHAT IS ABOUT TO HAPPEN, COUNTED BY ACTION. "Apply to 40 people" says
    // nothing about which forty seats are about to go back, and a cancellation
    // is the one action here nobody can undo by pressing the button again.
    var lines = ACTIONS.filter(function (x) { return byAction[x[0]]; })
      .map(function (x) { return byAction[x[0]] + ' × ' + x[1]; });
    var marked = people.filter(function (x) { return x.attended; }).length;
    if (!confirm('On ' + p.label + ':\\n\\n' + lines.join('\\n') +
      (marked ? '\\n\\n' + marked + ' will also be marked attended — on today, never on a date still to come.' : '') +
      (byAction.cancel ? '\\n\\nCancelling gives the seats and the meals back. Putting somebody back on afterwards is a separate press.' : '') +
      '\\n\\nGo ahead?')) return;
    $('commit').disabled = true;
    say('');
    showProgress({ exists: true, active: true, label: p.label, total: people.length, next: 0, lines: [] });
    // The picked dates are sent whatever the recurrences are, because a row set to
    // "ticked dates" is re-checked against them on the server (see
    // bulkRegistrantSessionsFor) and a row set to anything else ignores them.
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
    $('progTitle').textContent = (st.done ? (st.problem ? 'Stopped: ' : 'Done: ') : 'Working through: ') + (st.label || '');
    $('barFill').style.width = (total ? Math.round(100 * next / total) : 0) + '%';
    var text = next + ' of ' + total + ' people done';
    if (st.written !== undefined) text += ' · ' + st.written + ' row(s) written';
    if (st.done && st.problem) text += '\\nIt ' + st.problem + '.';
    if (st.stalled) text += '\\nIt has stopped without finishing. Press Carry on to pick up from the next person.';
    if (st.remaining && st.remaining.length) text += '\\nNot reached: ' + st.remaining.join(', ');
    $('progText').textContent = text;
    $('log').textContent = (st.lines || []).join('\\n');
    $('stop').style.display = st.active ? '' : 'none';
    $('carryOn').style.display = st.stalled ? '' : 'none';
    $('another').style.display = (st.done || st.stalled) ? '' : 'none';
    if (st.done && st.changedCount && !FU_LOADED) loadFollowUp();
    if (st.active && !POLL) POLL = setInterval(poll, 4000);
    if (!st.active && POLL) { clearInterval(POLL); POLL = null; }
  }
  function poll() {
    google.script.run.withSuccessHandler(function (st) { if (st && st.exists) showProgress(st); })
      .bulkRegistrantsStatus();
  }

  // ---- 6. The follow-up email. Everything from the workbook goes in with textContent.
  var FU_LOADED = false;
  var FU = [];
  function fuSay(text, cls) { var s = $('fuStatus'); s.textContent = text || ''; s.className = cls || ''; }
  function loadFollowUp() {
    FU_LOADED = true;
    google.script.run.withSuccessHandler(function (res) {
      if (!res || !res.ok) { FU_LOADED = false; fuSay((res && res.message) || 'Could not prepare the follow-up.', 'err'); return; }
      FU = res.recipients;
      $('followup').style.display = '';
      $('fuSubject').value = res.subject;
      $('fuBody').value = res.body;
      $('fuWarn').textContent = res.quietHours
        ? 'It is outside sending hours (5pm–8am), so emails will be held. Press Send again after 8am — this list is kept.' : '';
      drawFollowUp();
    }).withFailureHandler(function (err) { FU_LOADED = false; fuSay('Failed: ' + err.message, 'err'); })
      .prepareBulkFollowUp();
  }
  function drawFollowUp() {
    var box = $('fuPeople');
    box.textContent = '';
    var table = el('table');
    var head = el('tr');
    ['', 'Name', 'Email', 'Change', 'Sent?'].forEach(function (h) { head.appendChild(el('th', h)); });
    table.appendChild(head);
    FU.forEach(function (r) {
      var tr = el('tr', null, r.email ? '' : 'already');
      var td = el('td'); var c = document.createElement('input');
      c.type = 'checkbox'; c.className = 'fu'; c.value = String(r.id);
      c.checked = !!r.email && r.status !== 'sent'; c.disabled = !r.email || r.status === 'sent';
      td.appendChild(c); tr.appendChild(td);
      tr.appendChild(el('td', r.name));
      tr.appendChild(el('td', r.email || 'no email — will not be sent'));
      tr.appendChild(el('td', r.change || ''));
      tr.appendChild(el('td', r.status === 'sent' ? 'Sent' : (r.status === 'failed' ? 'Failed: ' + (r.error || '') : '')));
      table.appendChild(tr);
    });
    box.appendChild(table);
  }
  function fuIds() {
    return Array.prototype.map.call(document.querySelectorAll('input.fu:checked'), function (c) { return Number(c.value); });
  }
  function fuPreview() {
    var ids = fuIds();
    if (!ids.length) { fuSay('Tick at least one person.', 'err'); return; }
    google.script.run.withSuccessHandler(function (res) {
      $('fuPreviewBox').textContent = res && res.ok
        ? 'To: ' + res.to + '\\nSubject: ' + res.subject + '\\n\\n' + res.body : ((res && res.message) || '');
    }).withFailureHandler(function (err) { fuSay('Failed: ' + err.message, 'err'); })
      .previewBulkFollowUp({ ids: ids, subject: $('fuSubject').value, body: $('fuBody').value });
  }
  function fuSend() {
    var ids = fuIds();
    if (!ids.length) { fuSay('Tick at least one person.', 'err'); return; }
    if (!$('fuSubject').value.trim() || !$('fuBody').value.trim()) { fuSay('Write a subject and a message first.', 'err'); return; }
    if (!confirm('Send this email to ' + ids.length + ' ' + (ids.length === 1 ? 'person' : 'people') + '? It cannot be recalled.')) return;
    $('fuSend').disabled = true;
    fuSay('Sending…');
    var totals = { sent: 0, failed: 0 };
    (function next() {
      google.script.run.withSuccessHandler(function (res) {
        if (!res || !res.ok) { $('fuSend').disabled = false; fuSay((res && res.message) || 'Nothing came back.', 'err'); return; }
        totals.sent += res.sent; totals.failed += res.failed;
        res.recipients.forEach(function (u) { FU[u.id].status = u.status; FU[u.id].error = u.error; });
        drawFollowUp();
        var line = totals.sent + ' sent' + (totals.failed ? ', ' + totals.failed + ' failed' : '');
        if (res.stopped) { $('fuSend').disabled = false; fuSay(line + '.\\n' + res.stopped, 'err'); return; }
        if (res.remaining > 0) { fuSay(line + ', ' + res.remaining + ' to go…'); next(); return; }
        $('fuSend').disabled = false;
        fuSay('Done: ' + line + '.');
      }).withFailureHandler(function (err) {
        $('fuSend').disabled = false;
        fuSay('Failed: ' + err.message + ' — press Send again; anybody already written to is skipped.', 'err');
      }).sendBulkFollowUp({ ids: ids, subject: $('fuSubject').value, body: $('fuBody').value });
    })();
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
    // Go back at once and forget the server's copy in the background: the screen
    // must not depend on that call, and one that failed used to leave the button
    // doing nothing at all, silently.
    backToSetup();
    google.script.run.withSuccessHandler(function () {})
      .withFailureHandler(function (err) {
        say('The finished list could not be cleared (' + err.message + '). You can still start a new one; it will show again if this window is reopened.', 'err');
      }).dismissBulkRegistrantsResult();
  }
  function backToSetup() {
    if (POLL) { clearInterval(POLL); POLL = null; }
    // A new list starts empty: the last one's rows, mapping and review would
    // otherwise sit under the setup, ready to be applied a second time.
    RAW = null; PEOPLE = []; ROWS = []; FROM_ROSTER = false;
    FU_LOADED = false; FU = [];
    $('followup').style.display = 'none';
    $('fuPreviewBox').textContent = ''; fuSay('');
    $('csv').value = '';
    try { $('file').value = ''; } catch (e) {}
    $('review').textContent = '';
    $('columns').textContent = '';
    $('mapping').style.display = 'none';
    $('reviewBox').style.display = 'none';
    $('progress').style.display = 'none';
    $('setup').style.display = '';
    say('');
    updateCommit();
  }
</script>`;
}
