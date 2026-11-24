// ============================================================================
// 99zzh. EMAIL GROUPS — a Google Group per class, and three interest lists
// ============================================================================
//
// WHAT THIS IS. A leader who wants to tell "everybody in Beginner Mahjong" that
// the room has moved has had two choices: forward it to the office, or copy
// thirty addresses off a roster into a To: line where everybody can see
// everybody. A Google Group is the right shape for that — one address, the
// member list hidden, nobody's address visible to anybody else — and this
// Workspace already has Groups. This file keeps those groups in step with the
// workbook.
//
// TWO KINDS OF GROUP, and they answer different questions:
//
//   Class     people on ONE program. Proposed from the roster, approved by a
//             person, and taken back off automatically when the roster says
//             they have left.
//   Interest  people who asked to hear about a subject (Art, Exercise,
//             Movies). Asked for at the door or on the self-serve page, BORN
//             APPROVED, and never removed by anything a roster does: a person
//             who cancels a painting class has not stopped liking art.
//
// THE SCOPE OF A CLASS GROUP. A [Grouped] series (an eight- or twelve-week
// course) is one group PER RUN, because a course that runs again in spring is
// a different set of people who should not get the autumn class's news. A run
// is the form its sessions are on — the `::FIXED` form group — so the scope
// key is `course:<Form_ID>` and the address is the title plus the month the
// run starts (beginner-mahjong-2026-11). Everything else that gets a group —
// a club, a Regular weekly program — is ONE STANDING group for as long as it
// runs, keyed on the title it is filed under (`canonicalProgramTitle`, 99zzc),
// so an alias or a "CANCELLED:" prefix lands in the same group. Appointment
// programs and lunch never get a group: there is no class to tell anything.
//
// NO BUILDING IN A GROUP'S NAME OR ADDRESS, on purpose: the buildings are
// moving about at the moment (99zy), and a group called "Chair Yoga —
// Ashbridge" that now meets at Narberth is a group whose name is wrong. A
// standing group is therefore keyed on the TITLE ALONE, across buildings —
// one "Chair Yoga" group, whichever building it is in this month — and the
// Email_Group tick on any of that title's Program_Settings rows turns it on.
//
// THE QUEUE IS A TAB. `Group_Requests` is one row per person per group, and
// it is the only thing the apply job reads: nothing is added to a Google Group
// without a row saying Approved, and nothing is removed without a row saying
// Removed. Staff approve by ticking `Approve` (a fill-down approves a column of
// them), or a whole program at once from the menu. `In_Group` is what this
// file believes Google holds — it is what lets a removal know there is
// anything to remove, and it is written only by the apply job.
//
//   Pending    proposed from the roster, waiting for somebody.
//   Approved   to be added at the next apply.
//   Added      in the group.
//   Removed    taken off (or to be taken off, while In_Group is still ticked).
//   Failed     Google refused; Notes says why. Set it back to Approved to retry.
//   Declined   somebody said no. Never proposed again for that group. A
//              Declined row with no Group is the door's "no thanks", which is
//              how the door knows not to ask twice.
//
// REMOVAL IS AUTOMATIC, AND NARROW, because a wrong removal is somebody who
// stops hearing about their own class with nobody noticing:
//
//   course     only once EVERY date of that run they were on is cancelled
//              or gone from the tab. One cancelled week is not leaving.
//   standing   only with no live upcoming registration, no active
//              Club_Members place, AND their last change being a
//              cancellation — "the most recent date they were on is
//              Cancelled". A person who simply stopped coming after their
//              last class stays in, which is what the office asked for:
//              lapsing is not leaving.
//   interest   never, by anything here. Staff set Status to Removed by hand.
//
// Only rows the ROSTER put there (Source `registration` / `setup`) are ever
// removed automatically; a person staff added by hand is staff's to remove.
// Every removal is one line in the office's 10am digest (88).
//
// APPLYING IS A SLICED JOB (75), run from the menu and once a day at 1am —
// never hourly, because a Google Group is a thing people receive mail from,
// and a membership that flickers hourly with the sync is worse than one a
// day late. The plan is fixed at the start (automatic removals decided, then
// the creates, the manager adds, the member adds and removes in that order),
// each Directory call is one item, and outcomes are written back to the tab
// at the end of every slice. A group is created on its FIRST approved member:
// announcement-only (managers post), the member list visible to managers only,
// external (gmail) members allowed — most members are not on this domain —
// and the program's leaders (Program_Leaders) made managers.
//
// THE DOOR (73/74) asks once, after somebody signs in and before the green
// "You're signed in" screen, whether they would like any of the interest
// lists. Skippable, and it shows the address it would use MASKED (j•••e@g•••.com),
// asking for one only when the roll has none. While a sync holds the workbook
// the answer is queued on 99b's retry queue like a sign-in is.
//
// THE SELF-SERVE PAGE (`?mode=lists`) takes a name, an email and ticks. The
// person is matched to Member_Roll ON THE SERVER and the match is never shown
// (the page says "check your email" whoever you are, so it cannot be used to
// find out who is a member), and nobody is added until they press the button
// on the page the confirmation email links to — a GET never confirms, for the
// same reason 99zzf's link never unsubscribes: mail scanners open every link.
//
// SETUP. Needs the AdminDirectory (Admin SDK Directory, directory_v1) and
// AdminGroupsSettings (groupssettings_v1) advanced services, both in
// appsscript.json, and a trigger owner holding the Groups Admin role. The
// one-time job (Admin ▸ One-Time Jobs ▸ Set Up Email Groups) draws both tabs,
// seeds the three interest lists, and APPROVES everyone currently registered
// for a ticked program — the only time a class add is not a person's decision,
// because it is the decision to start.
//
// Numbered after `99zzg` for the usual reason — never renumber. Behavior plus
// self-contained constants; its schema (`SHEET_NAMES.EMAIL_GROUPS`,
// `SHEET_NAMES.GROUP_REQUESTS`, `HEADERS.Email_Groups`, `HEADERS.Group_Requests`,
// the `Email_Group` column on `Program_Settings`) is in `03`, and everything
// it reaches for it reads at CALL time. `16`, `18`, `60`, `72`, `74` and `99b`
// reach it through hoisted declarations.
// ============================================================================

const EMAIL_GROUP_KINDS = { CLASS: 'Class', INTEREST: 'Interest' };
const GROUP_REQUEST_STATUSES = ['Pending', 'Approved', 'Added', 'Removed', 'Failed', 'Declined'];
const GROUP_REQUEST_SOURCES = {
  REGISTRATION: 'registration', SETUP: 'setup', DOOR: 'door',
  SELF_SERVE: 'self-serve', STAFF: 'staff'
};
/** The sources whose rows the roster may also take away again. */
const GROUP_ROSTER_SOURCES = ['registration', 'setup'];
const EMAIL_GROUPS_SEED_INTERESTS = ['Art', 'Exercise', 'Movies'];

const EMAIL_GROUPS_SETTINGS_PROP_KEY = 'EMAIL_GROUPS_SETTINGS_V1';
const EMAIL_GROUPS_APPLY_STATE_PROP_KEY = 'EMAIL_GROUPS_APPLY_V1';
const EMAIL_GROUPS_MANAGERS_PROP_KEY = 'EMAIL_GROUPS_MANAGERS_V1';
const EMAIL_GROUPS_SECRET_PROP_KEY = 'EMAIL_GROUPS_LIST_SECRET_V1';
const GROUP_LIST_CONFIRM_PROP_KEY = 'EMAIL_GROUPS_LIST_CONFIRM_V1';
const GROUP_LIST_DAILY_COUNT_PROP_KEY = 'EMAIL_GROUPS_LIST_SENDS_V1';

const EMAIL_GROUPS_APPLY_HANDLER = 'resumeApplyGroupChanges';
const EMAIL_GROUPS_DAILY_HANDLER = 'applyGroupChangesDaily';
const EMAIL_GROUPS_DAILY_HOUR = 1;
const EMAIL_GROUPS_BUDGET_MS = 4 * 60 * 1000;
const EMAIL_GROUPS_RESUME_DELAY_MS = 30 * 1000;
const EMAIL_GROUPS_WATCHDOG_MS = 8 * 60 * 1000;
const EMAIL_GROUPS_MAX_SLICES = 40;
const EMAIL_GROUPS_STALE_MS = 60 * 60 * 1000;

const GROUP_LIST_MODES = ['lists', 'email-lists', 'newsletters'];
/** A confirmation not clicked in this long is dropped. */
const GROUP_LIST_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The public page can send at most this many confirmations a day, and one per address. */
const GROUP_LIST_MAX_SENDS_PER_DAY = 60;
const GROUP_LIST_MAIL_RESERVE = 25;

// --- small pure helpers ----------------------------------------------------

function normalizeGroupEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

/** "Beginner Mahjong!" → "beginner-mahjong". Accents dropped, never empty. */
function groupSlug_(text) {
  const s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 50).replace(/-+$/g, '');
  return s || 'group';
}

/** j•••e@g•••.com — enough for a person to recognize, too little to harvest. */
function maskEmailForDisplay(email) {
  const e = normalizeGroupEmail_(email);
  const at = e.indexOf('@');
  if (at < 1) return '';
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const maskedLocal = local[0] + '•••' + (local.length > 2 ? local[local.length - 1] : '');
  return `${maskedLocal}@${host[0] || ''}•••${tld}`;
}

/** The domain groups are made on: the setting if there is one, else the owner's own. */
function emailGroupsDomain_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(EMAIL_GROUPS_SETTINGS_PROP_KEY);
    const settings = raw ? JSON.parse(raw) : {};
    if (settings && settings.domain) return String(settings.domain).trim().toLowerCase();
  } catch (err) { /* fall through */ }
  try {
    const owner = String(Session.getEffectiveUser().getEmail() || '');
    const at = owner.indexOf('@');
    return at > 0 ? owner.slice(at + 1).toLowerCase() : '';
  } catch (err) {
    return '';
  }
}

/**
 * WHICH GROUP A SESSION'S PEOPLE BELONG IN, or null for none. Pure apart from
 * canonicalProgramTitle()'s memoized index (`aliasIndex` overrides it).
 *
 * `session` is { title, location, typeTag, club, assistance, formId, dateKey }.
 * `enabled` is { normalizedTitle: true } for every title whose Email_Group is
 * ticked on any of its Program_Settings rows.
 */
function emailGroupScopeForSession(session, enabled, aliasIndex) {
  const s = session || {};
  const raw = String(s.title || '').trim();
  if (!raw || s.assistance) return null;
  if (typeof isLunchOnlyProgramTitle === 'function' && isLunchOnlyProgramTitle(raw)) return null;
  const title = canonicalProgramTitle(raw, s.location, aliasIndex) || raw;
  const programKey = normalizeNameKey(title);
  if (!enabled || !enabled[programKey]) return null;
  const grouped = normalizeTypeTag(s.typeTag) === EVENT_TYPES.GROUPED && !s.club;
  const formId = String(s.formId || '').trim();
  if (grouped && formId) {
    return { scopeKey: `course:${formId}`, course: true, title: title, programKey: programKey };
  }
  return { scopeKey: `program:${programKey}`, course: false, title: title, programKey: programKey };
}

/**
 * A group's address and display name, from its scope. The month on a course
 * is the month its run STARTS. A slug another scope already holds gets -2,
 * -3… so two programs can never share a group by accident.
 */
function proposeEmailGroupIdentity(scope, startDateKey, domain, takenEmails) {
  let base = groupSlug_(scope.title);
  let name = scope.title;
  if (scope.course && startDateKey) {
    base = `${base}-${String(startDateKey).slice(0, 7)}`;
    const d = parseDateKey(startDateKey);
    if (d) name = `${scope.title} (${Utilities.formatDate(d, TIMEZONE, 'MMM yyyy')})`;
  }
  const taken = takenEmails || {};
  let email = `${base}@${domain}`;
  for (let n = 2; taken[email]; n++) email = `${base}-${n}@${domain}`;
  return { email: email, name: name };
}

// --- the tabs --------------------------------------------------------------

function emailGroupsSheet_(name, headers, create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  let sheet = ss.getSheetByName(name);
  if (!sheet && create) sheet = getOrCreateSheet(ss, name);
  if (!sheet) return null;
  if (create && sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    try {
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    } catch (err) { /* cosmetic */ }
  }
  return sheet;
}

/** The tick boxes and the Status dropdown, down the whole tab. Cosmetic; never throws. */
function styleGroupRequestsTab_(sheet) {
  try {
    const headers = HEADERS.Group_Requests;
    const map = getIndexMap(headers);
    const rows = emailGroupsValidationRows_(sheet);
    ['Approve', 'In_Group'].forEach(h => {
      sheet.getRange(2, map[h] + 1, rows, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireCheckbox().build());
    });
    sheet.getRange(2, map['Status'] + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(GROUP_REQUEST_STATUSES, true)
        .setAllowInvalid(false).build());
    sheet.getRange(1, map['In_Group'] + 1).setNote(
      'Written by Apply Group Changes only: what this workbook believes Google holds. ' +
      'Do not tick it by hand.');
  } catch (err) {
    log(`ℹ️ Could not style ${SHEET_NAMES.GROUP_REQUESTS} (${err}).`);
  }
}

function styleEmailGroupsTab_(sheet) {
  try {
    const headers = HEADERS.Email_Groups;
    const map = getIndexMap(headers);
    const rows = emailGroupsValidationRows_(sheet);
    sheet.getRange(2, map['Active'] + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireCheckbox().build());
    sheet.getRange(2, map['Kind'] + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(
        [EMAIL_GROUP_KINDS.CLASS, EMAIL_GROUP_KINDS.INTEREST], true).build());
  } catch (err) {
    log(`ℹ️ Could not style ${SHEET_NAMES.EMAIL_GROUPS} (${err}).`);
  }
}

/** Every row of a simple header-row-1 tab as objects, each with its 1-based `_row`. */
function readHeaderTable_(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const width = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  const head = values[0].map(h => String(h || '').trim());
  const at = {};
  headers.forEach(h => { at[h] = head.indexOf(h); });
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const obj = { _row: i + 1 };
    let any = false;
    headers.forEach(h => {
      const v = at[h] === -1 ? '' : values[i][at[h]];
      obj[h] = v;
      if (v !== '' && v !== null && v !== false) any = true;
    });
    if (any) out.push(obj);
  }
  return out;
}

function objectToRow_(obj, headers) {
  return headers.map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
}

function readEmailGroups_() {
  return readHeaderTable_(emailGroupsSheet_(SHEET_NAMES.EMAIL_GROUPS, HEADERS.Email_Groups, false),
    HEADERS.Email_Groups).map(g => Object.assign(g, {
    Group_Email: normalizeGroupEmail_(g.Group_Email),
    active: g.Active === '' ? true : isTruthyCheckbox(g.Active)
  }));
}

function readGroupRequests_() {
  return readHeaderTable_(emailGroupsSheet_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, false),
    HEADERS.Group_Requests).map(r => Object.assign(r, {
    Email: normalizeGroupEmail_(r.Email),
    Group: normalizeGroupEmail_(r.Group),
    Status: String(r.Status || '').trim() || 'Pending'
  }));
}

/**
 * THE LAST ROW WITH SOMETHING IN IT, by content — never getLastRow(). A
 * checkbox column reads FALSE in every row it is drawn on, so getLastRow() on a
 * tab whose tick boxes ran to row 1000 answered 1000 and every append landed
 * below it, out of sight (the first version of this file did exactly that).
 */
function lastContentRow_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return Math.min(last, 1);
  const width = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(1, 1, last, width).getValues();
  for (let r = values.length - 1; r >= 1; r--) {
    if (values[r].some(v => v !== '' && v !== null && v !== false)) return r + 1;
  }
  return 1;
}

/** Tick boxes and dropdowns cover the rows in use plus a spare band, never the whole sheet. */
const EMAIL_GROUPS_SPARE_ROWS = 25;
function emailGroupsValidationRows_(sheet) {
  return Math.max(lastContentRow_(sheet) - 1, 0) + EMAIL_GROUPS_SPARE_ROWS;
}

/**
 * THE REPAIR for a tab written by that first version: its rows are packed back
 * up under the header in their order, the old cells blanked (one setValues,
 * never a clear), and the validation taken off everything below the band.
 * Idempotent: a tab that is already packed is read once and left alone.
 * Returns how many rows moved.
 */
function packEmailGroupsTab_(sheet) {
  try {
    const last = sheet.getLastRow();
    if (last < 2) return 0;
    const width = Math.max(sheet.getLastColumn(), 1);
    const values = sheet.getRange(2, 1, last - 1, width).getValues();
    const isRow = row => row.some(v => v !== '' && v !== null && v !== false);
    const kept = values.filter(isRow);
    const firstGap = values.findIndex(row => !isRow(row));
    if (firstGap === -1 || firstGap >= kept.length) return 0;
    const blank = () => Array(width).fill('');
    const out = kept.concat(values.slice(kept.length).map(blank));
    sheet.getRange(2, 1, last - 1, width).clearDataValidations();
    sheet.getRange(2, 1, out.length, width).setValues(out);
    return kept.length;
  } catch (err) {
    log(`⚠️ Could not tidy ${sheet.getName()} (${err}).`);
    return 0;
  }
}

function appendRowsToTab_(name, headers, objects) {
  if (!objects.length) return 0;
  const sheet = emailGroupsSheet_(name, headers, true);
  const start = Math.max(lastContentRow_(sheet), 1) + 1;
  ensureSheetRowsFor_(sheet, start + objects.length - 1);
  sheet.getRange(start, 1, objects.length, headers.length)
    .setValues(objects.map(o => objectToRow_(o, headers)));
  if (name === SHEET_NAMES.GROUP_REQUESTS) styleGroupRequestsTab_(sheet);
  else styleEmailGroupsTab_(sheet);
  return objects.length;
}

function ensureSheetRowsFor_(sheet, lastRow) {
  try {
    const max = sheet.getMaxRows();
    if (lastRow > max) sheet.insertRowsAfter(max, lastRow - max);
  } catch (err) { /* a test double, or a sheet that grows on its own */ }
}

function newGroupRequest_(fields) {
  return Object.assign({
    Name: '', Email: '', Group: '', Source: GROUP_REQUEST_SOURCES.STAFF, Status: 'Pending',
    Approved_By: '', Approve: false, Requested_On: formatDateKey(new Date()),
    Applied_On: '', In_Group: false, Notes: '', Request_ID: Utilities.getUuid()
  }, fields || {});
}

/** Draws both tabs and adds the three interest lists, once. Returns how many were seeded. */
function ensureEmailGroupsTabs_() {
  const groupsSheet = emailGroupsSheet_(SHEET_NAMES.EMAIL_GROUPS, HEADERS.Email_Groups, true);
  const requestsSheet = emailGroupsSheet_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, true);
  [groupsSheet, requestsSheet].forEach(packEmailGroupsTab_);
  styleEmailGroupsTab_(groupsSheet);
  styleGroupRequestsTab_(requestsSheet);
  const domain = emailGroupsDomain_();
  const existing = readEmailGroups_();
  const haveScope = {};
  existing.forEach(g => { haveScope[String(g.Scope_Key || '').trim()] = true; });
  const seed = EMAIL_GROUPS_SEED_INTERESTS.filter(label => !haveScope[`interest:${groupSlug_(label)}`])
    .map(label => ({
      Group_Email: domain ? `interest-${groupSlug_(label)}@${domain}` : '',
      Name: label, Kind: EMAIL_GROUP_KINDS.INTEREST, Scope_Key: `interest:${groupSlug_(label)}`,
      Active: true, Created_On: '', Notes: 'Interest list — people ask for it at the door or on the lists page.'
    }));
  return appendRowsToTab_(SHEET_NAMES.EMAIL_GROUPS, HEADERS.Email_Groups, seed);
}

// --- reading the workbook ---------------------------------------------------

/** { normalizedTitle: true } for every Program_Settings title with Email_Group ticked. */
function emailGroupEnabledTitles_() {
  const out = {};
  try {
    const rows = readNotificationPolicyRows();
    const map = getIndexMap(HEADERS.Program_Settings);
    if (map['Email_Group'] === undefined) return out;
    Object.keys(rows).forEach(key => {
      const row = rows[key];
      if (!isTruthyCheckbox(row[map['Email_Group']])) return;
      const title = String(row[map['Event']] || '').trim();
      if (title) out[normalizeNameKey(canonicalProgramTitle(title, row[map['Location']]) || title)] = true;
    });
  } catch (err) {
    log(`ℹ️ Could not read the Email_Group ticks (${err}).`);
  }
  return out;
}

/** The session table as { eventId: session } plus, per Form_ID, its earliest date. */
function readEmailGroupSessions_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss ? ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD) : null;
  const byEvent = {};
  const formStart = {};
  if (!dash) return { byEvent, formStart };
  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  getSectionedRowValues(dash, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const date = coerceDate(row[map['Event_Date']]);
    if (!eventId || !date) return;
    const session = {
      eventId: eventId,
      title: String(row[map['Clean_Title']] || '').trim(),
      location: String(row[map['Location']] || '').trim(),
      typeTag: row[map['Type_Tag']],
      club: isTruthyCheckbox(row[map['Club']]),
      assistance: map['Personalized_Assistance'] !== undefined &&
        typeof isAssistanceColumnValue === 'function' && isAssistanceColumnValue(row[map['Personalized_Assistance']]),
      formId: String(row[map['Form_ID']] || '').trim(),
      dateKey: formatDateKey(date)
    };
    byEvent[eventId] = session;
    if (session.formId && (!formStart[session.formId] || session.dateKey < formStart[session.formId])) {
      formStart[session.formId] = session.dateKey;
    }
  });
  return { byEvent, formStart };
}

/** Registrant rows as { email, name, eventId, dateKey, status }. Status blank reads Active. */
function readEmailGroupRegistrants_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
  if (!sheet) return [];
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const out = [];
  getSectionedRowValues(sheet, headers, 'Event_ID').forEach(row => {
    const date = coerceDate(row[map['Event_Date']]);
    out.push({
      email: normalizeGroupEmail_(row[map['Email']]),
      name: String(row[map['Name']] || '').trim(),
      eventId: String(row[map['Event_ID']] || '').trim(),
      dateKey: date ? formatDateKey(date) : '',
      status: String(row[map['Program_Status']] || '').trim() || 'Active'
    });
  });
  return out;
}

/** Active Club_Members places as [{ email, programKey }]. */
function readEmailGroupClubPlaces_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.CLUB_MEMBERS) : null;
  if (!sheet) return [];
  const headers = HEADERS.Club_Members;
  return readHeaderTable_(sheet, headers)
    .filter(r => isTruthyCheckbox(r.Active) && normalizeGroupEmail_(r.Email))
    .map(r => ({
      email: normalizeGroupEmail_(r.Email),
      programKey: normalizeNameKey(canonicalProgramTitle(String(r.Club || '').trim(), r.Location) || r.Club)
    }));
}

// --- deciding: proposals and removals (pure) --------------------------------

const GROUP_LIVE_STATUSES = ['Active', 'Waitlisted'];

/**
 * WHO SHOULD BE PROPOSED, AND WHO HAS LEFT. Pure: everything it needs is
 * handed in, which is what the tests drive.
 *
 *   input = { registrants, sessions: {byEvent, formStart}, enabled, clubPlaces,
 *             groups, requests, todayKey, domain }
 *
 * Returns { newGroups, proposals, removals } where
 *   newGroups  Email_Groups rows to append (a class scope seen for the first time)
 *   proposals  { email, name, group } — an Active registrant on a ticked
 *              program with no open or declined request for that group
 *   removals   { requestId, row, email, group, reason } — Added rows the
 *              roster now says have left
 */
function planEmailGroupChanges(input) {
  const today = input.todayKey;
  const groups = input.groups || [];
  const byScope = {};
  const takenEmails = {};
  groups.forEach(g => {
    byScope[String(g.Scope_Key || '').trim()] = g;
    if (g.Group_Email) takenEmails[g.Group_Email] = true;
  });

  // Each registrant row, resolved to its scope.
  const scoped = [];
  (input.registrants || []).forEach(r => {
    const session = input.sessions.byEvent[r.eventId];
    if (!session) return;
    const scope = emailGroupScopeForSession(session, input.enabled, input.aliasIndex);
    if (!scope) return;
    scoped.push({ reg: r, scope: scope, session: session });
  });

  // The class groups the roster needs, created as rows the first time.
  const newGroups = [];
  scoped.forEach(item => {
    const key = item.scope.scopeKey;
    if (byScope[key] || !input.domain) return;
    const start = item.scope.course ? input.sessions.formStart[item.session.formId] : '';
    const identity = proposeEmailGroupIdentity(item.scope, start, input.domain, takenEmails);
    takenEmails[identity.email] = true;
    const row = {
      Group_Email: identity.email, Name: identity.name, Kind: EMAIL_GROUP_KINDS.CLASS,
      Scope_Key: key, Active: true, Created_On: '',
      Notes: item.scope.course ? 'One run of a series.' : 'Standing group for the program.'
    };
    byScope[key] = row;
    newGroups.push(row);
  });

  // What is already asked for, per email per group.
  const open = {};
  (input.requests || []).forEach(q => {
    if (!q.Email || !q.Group) return;
    if (['Pending', 'Approved', 'Added', 'Failed', 'Declined'].indexOf(q.Status) === -1) return;
    open[`${q.Email}|${q.Group}`] = true;
  });

  const proposals = [];
  scoped.forEach(item => {
    const r = item.reg;
    const group = byScope[item.scope.scopeKey];
    if (!group || group.active === false) return;
    if (!r.email || !isPlausibleEmail(r.email) || r.status !== 'Active') return;
    if (item.scope.course === false && r.dateKey && r.dateKey < today) return; // a standing group proposes on upcoming dates only
    const k = `${r.email}|${group.Group_Email}`;
    if (open[k]) return;
    open[k] = true;
    proposals.push({ email: r.email, name: r.name, group: group.Group_Email });
  });

  // Removals — Added rows from the roster only, judged per kind.
  const groupByEmail = {};
  Object.keys(byScope).forEach(k => { groupByEmail[byScope[k].Group_Email] = byScope[k]; });
  const removals = [];
  (input.requests || []).forEach(q => {
    if (q.Status !== 'Added' || !isTruthyCheckbox(q.In_Group)) return;
    if (GROUP_ROSTER_SOURCES.indexOf(String(q.Source || '').trim()) === -1) return;
    const group = groupByEmail[q.Group];
    if (!group || group.Kind !== EMAIL_GROUP_KINDS.CLASS) return;
    const scopeKey = String(group.Scope_Key || '');
    const mine = scoped.filter(s => s.scope.scopeKey === scopeKey && s.reg.email === q.Email &&
      s.reg.status !== 'Superseded');
    let reason = '';
    if (scopeKey.indexOf('course:') === 0) {
      const live = mine.filter(s => s.reg.status !== 'Cancelled');
      if (live.length === 0) reason = 'every date of the run they were on was cancelled or removed';
    } else {
      const programKey = scopeKey.slice('program:'.length);
      const upcomingLive = mine.some(s => s.reg.dateKey >= today && GROUP_LIVE_STATUSES.indexOf(s.reg.status) !== -1);
      const clubPlace = (input.clubPlaces || []).some(c => c.email === q.Email && c.programKey === programKey);
      const latest = mine.slice().sort((a, b) => (a.reg.dateKey < b.reg.dateKey ? 1 : -1))[0];
      if (!upcomingLive && !clubPlace && latest && latest.reg.status === 'Cancelled') {
        reason = 'no upcoming registration, no club place, and their last date was cancelled';
      }
    }
    if (reason) removals.push({ requestId: q.Request_ID, row: q._row, email: q.Email, group: q.Group, reason });
  });

  return { newGroups, proposals, removals };
}

/** Reads everything planEmailGroupChanges() needs. */
function gatherEmailGroupInput_() {
  return {
    registrants: readEmailGroupRegistrants_(),
    sessions: readEmailGroupSessions_(),
    enabled: emailGroupEnabledTitles_(),
    clubPlaces: readEmailGroupClubPlaces_(),
    groups: readEmailGroups_(),
    requests: readGroupRequests_(),
    todayKey: formatDateKey(new Date()),
    domain: emailGroupsDomain_()
  };
}

/**
 * THE PROPOSAL PASS. Appends new class groups and Pending requests; with
 * `autoApprove` (the one-time setup) they are born Approved instead.
 * Returns { groups, proposed }.
 */
function proposeClassGroupRequests(options) {
  const opts = options || {};
  const input = gatherEmailGroupInput_();
  const plan = planEmailGroupChanges(input);
  appendRowsToTab_(SHEET_NAMES.EMAIL_GROUPS, HEADERS.Email_Groups, plan.newGroups);
  const by = opts.autoApprove ? `setup (${getCurrentUserEmail() || 'owner'})` : '';
  const rows = plan.proposals.map(p => newGroupRequest_({
    Name: p.name, Email: p.email, Group: p.group,
    Source: opts.autoApprove ? GROUP_REQUEST_SOURCES.SETUP : GROUP_REQUEST_SOURCES.REGISTRATION,
    Status: opts.autoApprove ? 'Approved' : 'Pending',
    Approved_By: by, Approve: !!opts.autoApprove
  }));
  appendRowsToTab_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, rows);
  return { groups: plan.newGroups.length, proposed: rows.length, plan: plan, input: input };
}

// --- approving --------------------------------------------------------------

/**
 * onEdit on Group_Requests (18). An Approve tick — one cell or a fill-down —
 * turns every Pending row it touches Approved and signs it; an untick on a row
 * not yet applied puts it back to Pending. A Status typed as Approved is
 * signed too. Never throws.
 */
function handleGroupRequestsEdit(e, sheet) {
  try {
    if (!e || !e.range) return;
    const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
    const col = h => head.indexOf(h) + 1;
    const approveCol = col('Approve');
    const statusCol = col('Status');
    const byCol = col('Approved_By');
    if (!approveCol || !statusCol || !byCol) return;
    const r0 = e.range.getRow();
    const c0 = e.range.getColumn();
    const n = e.range.getNumRows();
    const touchesApprove = approveCol >= c0 && approveCol < c0 + e.range.getNumColumns();
    const touchesStatus = statusCol >= c0 && statusCol < c0 + e.range.getNumColumns();
    if (!touchesApprove && !touchesStatus) return;
    const first = Math.max(r0, 2);
    const count = r0 + n - first;
    if (count <= 0) return;
    const width = Math.max(approveCol, statusCol, byCol);
    const block = sheet.getRange(first, 1, count, width).getValues();
    const who = getActiveUserEmail() || getCurrentUserEmail() || 'staff';
    let changed = false;
    block.forEach(row => {
      const status = String(row[statusCol - 1] || '').trim() || 'Pending';
      const ticked = isTruthyCheckbox(row[approveCol - 1]);
      if (touchesApprove && ticked && status === 'Pending') {
        row[statusCol - 1] = 'Approved';
        if (!row[byCol - 1]) row[byCol - 1] = who;
        changed = true;
      } else if (touchesApprove && !ticked && status === 'Approved') {
        row[statusCol - 1] = 'Pending';
        row[byCol - 1] = '';
        changed = true;
      } else if (touchesStatus && status === 'Approved' && !row[byCol - 1]) {
        row[byCol - 1] = who;
        row[approveCol - 1] = true;
        changed = true;
      }
    });
    if (!changed) return;
    sheet.getRange(first, statusCol, count, 1).setValues(block.map(r => [r[statusCol - 1]]));
    sheet.getRange(first, byCol, count, 1).setValues(block.map(r => [r[byCol - 1]]));
    sheet.getRange(first, approveCol, count, 1).setValues(block.map(r => [r[approveCol - 1]]));
  } catch (err) {
    log(`ℹ️ Group_Requests edit not handled (${err}).`);
  }
}

/** Approves every Pending row for `groupEmail`. Returns how many. */
function approvePendingGroupRequests(groupEmail, approvedBy) {
  const sheet = emailGroupsSheet_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, false);
  if (!sheet) return 0;
  const target = normalizeGroupEmail_(groupEmail);
  const pending = readGroupRequests_().filter(q => q.Group === target && q.Status === 'Pending');
  if (!pending.length) return 0;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const at = h => head.indexOf(h) + 1;
  pending.forEach(q => {
    sheet.getRange(q._row, at('Status')).setValue('Approved');
    sheet.getRange(q._row, at('Approved_By')).setValue(approvedBy || getCurrentUserEmail() || 'staff');
    sheet.getRange(q._row, at('Approve')).setValue(true);
  });
  return pending.length;
}

/** Menu: pick a class group and approve everybody waiting on it. */
function approveGroupRequestsForProgram() {
  const ui = SpreadsheetApp.getUi();
  const pending = {};
  readGroupRequests_().forEach(q => {
    if (q.Status === 'Pending' && q.Group) pending[q.Group] = (pending[q.Group] || 0) + 1;
  });
  const names = {};
  readEmailGroups_().forEach(g => { names[g.Group_Email] = g.Name; });
  const list = Object.keys(pending).sort();
  if (!list.length) {
    ui.alert('Nobody is waiting', 'There are no Pending requests on Group_Requests.', ui.ButtonSet.OK);
    return 0;
  }
  const lines = list.map((g, i) => `${i + 1}. ${names[g] || g} — ${pending[g]} waiting`);
  const answer = ui.prompt('Approve a program’s requests',
    `${lines.join('\n')}\n\nType the number of the group to approve everyone waiting on it:`, ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return 0;
  const pick = list[parseInt(String(answer.getResponseText() || '').trim(), 10) - 1];
  if (!pick) {
    ui.alert('That number is not on the list. Nothing was approved.');
    return 0;
  }
  const done = approvePendingGroupRequests(pick, getActiveUserEmail() || getCurrentUserEmail());
  toastIfPossible(`Approved ${done} for ${names[pick] || pick}. They are added at the next Apply Group Changes.`);
  return done;
}

/** Menu: draw the request tab if needed, propose from the roster, and open it. */
function openGroupRequestsTab() {
  ensureEmailGroupsTabs_();
  const res = proposeClassGroupRequests();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.GROUP_REQUESTS);
  if (sheet) ss.setActiveSheet(sheet);
  toastIfPossible(res.proposed
    ? `${res.proposed} new request(s) to look at. Tick Approve (or fill it down) to approve.`
    : 'No new requests. Tick Approve on a Pending row to approve it.');
  return res.proposed;
}

// --- the door's question and the interest lists ---------------------------

/** Active interest groups as [{ group, label }]. */
function activeInterestGroups_() {
  return readEmailGroups_()
    .filter(g => g.Kind === EMAIL_GROUP_KINDS.INTEREST && g.active && g.Group_Email)
    .map(g => ({ group: g.Group_Email, label: String(g.Name || g.Group_Email).trim() }));
}

/** name key and email of everybody the door has asked (any interest row, or a declined one). */
function interestAskedIndex_() {
  const interest = {};
  readEmailGroups_().forEach(g => { if (g.Kind === EMAIL_GROUP_KINDS.INTEREST) interest[g.Group_Email] = true; });
  const asked = { names: {}, emails: {} };
  readGroupRequests_().forEach(q => {
    const counts = interest[q.Group] || (!q.Group && q.Status === 'Declined');
    if (!counts) return;
    if (q.Name) asked.names[normalizeNameKey(q.Name)] = true;
    if (q.Email) asked.emails[q.Email] = true;
  });
  return asked;
}

/** { nameKey: email } off Member_Roll (Display_Name and Name both). */
function memberRollEmailIndex_() {
  const out = {};
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.MEMBER_ROLL) : null;
    if (!sheet) return out;
    readHeaderTable_(sheet, HEADERS.Member_Roll).forEach(r => {
      const email = normalizeGroupEmail_(r.Email);
      if (!email || !isPlausibleEmail(email)) return;
      [r.Display_Name, r.Name].forEach(n => {
        const k = normalizeNameKey(n);
        if (k && !out[k]) out[k] = email;
      });
    });
  } catch (err) {
    log(`ℹ️ Could not read Member_Roll emails (${err}).`);
  }
  return out;
}

/**
 * What the door's day payload carries for the question (74): the lists, and
 * for every member NOT yet asked their masked address ('' when there is none).
 * Null when there are no interest lists, so the door never asks. Never throws.
 */
function emailGroupsDoorInfo(members) {
  try {
    const lists = activeInterestGroups_();
    if (!lists.length) return null;
    const asked = interestAskedIndex_();
    const emails = memberRollEmailIndex_();
    const ask = {};
    (members || []).forEach(m => {
      const key = m.key || normalizeNameKey(m.name);
      if (!key || asked.names[key]) return;
      const email = emails[key] || '';
      if (email && asked.emails[email]) return;
      ask[key] = email ? maskEmailForDisplay(email) : '';
    });
    return { lists: lists.map(l => ({ group: l.group, label: l.label })), ask: ask };
  } catch (err) {
    log(`ℹ️ The door's interest question was left out (${err}).`);
    return null;
  }
}

/**
 * The door's answer. Payload { pin, name, email, groups: [groupEmail], skip }.
 * Behind a running sync it is queued on 99b like a sign-in; otherwise written
 * now. Returns { ok, queued?, message }. Never throws.
 */
function doorInterestAnswer(payload) {
  try {
    const args = parseCheckInPayload(payload);
    if (!checkInPinAccepted(args.pin)) return checkInPinRefusal();
    if (workbookHeldElsewhere() &&
      queueOptimisticRetry('groupInterest', args, 'Queued behind a sync that was holding the workbook.')) {
      return { ok: true, queued: true, message: 'Saved — it goes onto the list when the sync finishes.' };
    }
    const done = withScriptLock(DESK_LOCK_WAIT_MS, () => applyInterestAnswer(args), null);
    if (done) return done;
    if (queueOptimisticRetry('groupInterest', args, 'The workbook was busy.')) {
      return { ok: true, queued: true, message: 'Saved — it goes onto the list in a minute.' };
    }
    return { ok: false, message: 'Could not save that just now.' };
  } catch (err) {
    log(`⚠️ doorInterestAnswer failed (${err}).`);
    return { ok: false, message: 'Something went wrong.' };
  }
}

/**
 * Writes one interest answer: Approved rows for each ticked list, or one
 * Declined row with no Group for a "no thanks". Idempotent per email per list.
 * Called with the lock held (directly, or from 99b's held batch).
 */
function applyInterestAnswer(args) {
  const a = args || {};
  const name = String(a.name || '').trim();
  if (!name) return { ok: false, message: 'No name.' };
  const typed = normalizeGroupEmail_(a.email);
  const email = typed && isPlausibleEmail(typed) ? typed : (memberRollEmailIndex_()[normalizeNameKey(name)] || '');
  const source = String(a.source || GROUP_REQUEST_SOURCES.DOOR);
  if (a.skip || !Array.isArray(a.groups) || !a.groups.length) {
    appendRowsToTab_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, [newGroupRequest_({
      Name: name, Email: email, Group: '', Source: source, Status: 'Declined',
      Notes: 'Said no thanks to the interest lists.'
    })]);
    return { ok: true, message: 'Noted.' };
  }
  if (!email) return { ok: false, message: 'There is no email address to add.' };
  const valid = {};
  activeInterestGroups_().forEach(l => { valid[l.group] = l.label; });
  const have = {};
  readGroupRequests_().forEach(q => {
    if (q.Email === email && ['Approved', 'Added', 'Pending'].indexOf(q.Status) !== -1) have[q.Group] = true;
  });
  const rows = a.groups.map(normalizeGroupEmail_).filter(g => valid[g] && !have[g]).map(g => newGroupRequest_({
    Name: name, Email: email, Group: g, Source: source, Status: 'Approved',
    Approved_By: source === GROUP_REQUEST_SOURCES.SELF_SERVE ? 'self-serve (confirmed by email)' : 'asked at the door',
    Approve: true, Notes: a.note || ''
  }));
  appendRowsToTab_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, rows);
  if (rows.length) {
    spoolOfficeNote('Email groups', `${name} joined ${rows.map(r => valid[r.Group]).join(', ')} (${source}).`);
  }
  return { ok: true, message: `Added to ${rows.length} list(s).` };
}

// --- applying: the sliced job ---------------------------------------------

/** The Directory calls, in one place so tests can stand in for Google. */
function emailGroupsApi_() {
  const already = err => /already exists|duplicate|409/i.test(String(err));
  const missing = err => /not found|does not exist|404/i.test(String(err));
  return {
    createGroup: (email, name, description) => {
      try {
        AdminDirectory.Groups.insert({ email: email, name: name, description: description || '' });
      } catch (err) {
        if (!already(err)) throw err;
      }
      const settings = {
        // ANNOUNCEMENT-ONLY: managers post, members read. A class group that
        // anybody can reply-all to is the thread this exists to prevent.
        whoCanPostMessage: 'ALL_MANAGERS_CAN_POST',
        whoCanViewMembership: 'ALL_MANAGERS_CAN_VIEW',
        whoCanJoin: 'INVITED_CAN_JOIN',
        whoCanViewGroup: 'ALL_MEMBERS_CAN_VIEW',
        allowExternalMembers: 'true',
        includeInGlobalAddressList: 'false',
        messageModerationLevel: 'MODERATE_NONE'
      };
      // A group Directory has just made is often not yet visible to the Groups
      // Settings service: the first patch answers "not found" for a few
      // seconds. Retried with a growing pause; if it still fails the create
      // fails, nobody is added to a group with default (open) settings, and
      // the next run's insert finds the group and tries the settings again.
      let lastErr = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          AdminGroupsSettings.Groups.patch(settings, email);
          return;
        } catch (err) {
          lastErr = err;
          if (!missing(err)) break;
          Utilities.sleep(3000 * (attempt + 1));
        }
      }
      throw lastErr;
    },
    addMember: (group, email, role) => {
      try {
        AdminDirectory.Members.insert({ email: email, role: role || 'MEMBER' }, group);
      } catch (err) {
        if (!already(err)) throw err;
        if (role && role !== 'MEMBER') AdminDirectory.Members.patch({ role: role }, group, email);
      }
    },
    removeMember: (group, email) => {
      try {
        AdminDirectory.Members.remove(group, email);
      } catch (err) {
        if (!missing(err)) throw err;
      }
    }
  };
}

function readManagersDone_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(EMAIL_GROUPS_MANAGERS_PROP_KEY) || '{}') || {};
  } catch (err) {
    return {};
  }
}

/** Leader addresses for a class group, across every building its program runs in. */
function leaderEmailsForGroupScope_(scopeKey, sessions) {
  const index = buildProgramLeaderIndex();
  const out = {};
  Object.keys(sessions.byEvent).forEach(id => {
    const s = sessions.byEvent[id];
    const key = scopeKey.indexOf('course:') === 0
      ? (s.formId === scopeKey.slice('course:'.length))
      : (normalizeNameKey(canonicalProgramTitle(s.title, s.location) || s.title) === scopeKey.slice('program:'.length));
    if (!key) return;
    (index[leaderProgramKey(s.title, s.location)] || []).forEach(l => {
      (l.emails || []).forEach(e => { const n = normalizeGroupEmail_(e); if (isPlausibleEmail(n)) out[n] = true; });
    });
  });
  return Object.keys(out).sort();
}

/**
 * THE PLAN, fixed at the start. Pure apart from what it is handed.
 * `removals` are already decided; `managersDone` is { group: [email] }.
 * Returns the ordered item list: create, manager, add, remove.
 */
function buildEmailGroupApplyItems(groups, requests, removals, leadersFor, managersDone) {
  const items = [];
  const removing = {};
  (removals || []).forEach(r => { removing[r.requestId] = r; });
  const toAdd = (requests || []).filter(q => q.Group && q.Email && q.Status === 'Approved' &&
    !isTruthyCheckbox(q.In_Group));
  const toRemove = (requests || []).filter(q => q.Group && q.Email && isTruthyCheckbox(q.In_Group) &&
    (q.Status === 'Removed' || removing[q.Request_ID]));
  const groupBy = {};
  (groups || []).forEach(g => { groupBy[g.Group_Email] = g; });
  const needed = {};
  toAdd.forEach(q => { needed[q.Group] = true; });
  Object.keys(needed).sort().forEach(email => {
    const g = groupBy[email];
    if (!g || !g.active) return;
    if (!g.Created_On) items.push({ type: 'create', group: email, name: String(g.Name || email), kind: g.Kind });
  });
  (groups || []).forEach(g => {
    if (!g.active || g.Kind !== EMAIL_GROUP_KINDS.CLASS) return;
    if (!g.Created_On && !needed[g.Group_Email]) return;
    const done = (managersDone && managersDone[g.Group_Email]) || [];
    (leadersFor(g) || []).forEach(email => {
      if (done.indexOf(email) === -1) items.push({ type: 'manager', group: g.Group_Email, email: email });
    });
  });
  toAdd.forEach(q => {
    const g = groupBy[q.Group];
    if (!g || !g.active) return;
    items.push({ type: 'add', group: q.Group, email: q.Email, requestId: q.Request_ID });
  });
  toRemove.forEach(q => {
    items.push({ type: 'remove', group: q.Group, email: q.Email, requestId: q.Request_ID,
      reason: removing[q.Request_ID] ? removing[q.Request_ID].reason : 'removed by staff' });
  });
  return items;
}

/** Marks the automatic removals on the tab and files one digest line each. */
function recordAutomaticGroupRemovals_(removals, names) {
  if (!removals.length) return;
  const sheet = emailGroupsSheet_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, false);
  if (!sheet) return;
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const at = h => head.indexOf(h) + 1;
  removals.forEach(r => {
    sheet.getRange(r.row, at('Status')).setValue('Removed');
    sheet.getRange(r.row, at('Notes')).setValue(`Removed automatically ${formatDateKey(new Date())}: ${r.reason}.`);
    spoolOfficeNote('Email groups', `Removed ${r.email} from ${names[r.group] || r.group} — ${r.reason}.`);
  });
}

/** Menu: Apply Group Changes. Starts a sweep (or says one is running). */
function applyGroupChanges() {
  return startApplyGroupChanges_({ interactive: true });
}

/** THE DAILY TRIGGER (1am). Never hourly — see the banner. */
function applyGroupChangesDaily() {
  if (!automationGateAllows('Apply Group Changes', true)) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss || !ss.getSheetByName(SHEET_NAMES.GROUP_REQUESTS)) return null;
  try { resendHeldGroupListConfirmations_(); } catch (err) { log(`ℹ️ ${err}`); }
  try { proposeClassGroupRequests(); } catch (err) { log(`⚠️ Group proposals failed (${err}).`); }
  return startApplyGroupChanges_({ interactive: false });
}

function resumeApplyGroupChanges() {
  return runApplyGroupChangesSlice_();
}

function isApplyGroupChangesActive_() {
  return isSlicedJobActive(EMAIL_GROUPS_APPLY_STATE_PROP_KEY, EMAIL_GROUPS_STALE_MS, minutes =>
    `ℹ️ An email-group apply has been idle for ${minutes} minute(s) — treating it as finished.`);
}

function startApplyGroupChanges_(opts) {
  if (isApplyGroupChangesActive_()) {
    if (opts.interactive) toastIfPossible('Group changes are already being applied — it carries itself on.');
    return null;
  }
  if (typeof AdminDirectory === 'undefined' || typeof AdminGroupsSettings === 'undefined') {
    const msg = 'The Admin Directory and Groups Settings services are not enabled on this project, ' +
      'so no group can be changed. Enable them in the Apps Script editor (Services).';
    log(`⚠️ ${msg}`);
    if (opts.interactive) explainRefusal(msg);
    return null;
  }
  ensureEmailGroupsTabs_();
  const input = gatherEmailGroupInput_();
  const plan = planEmailGroupChanges(input);
  const names = {};
  input.groups.forEach(g => { names[g.Group_Email] = g.Name; });
  plan.newGroups.forEach(g => { names[g.Group_Email] = g.Name; });
  appendRowsToTab_(SHEET_NAMES.EMAIL_GROUPS, HEADERS.Email_Groups, plan.newGroups);
  recordAutomaticGroupRemovals_(plan.removals, names);

  const groups = readEmailGroups_();
  const items = buildEmailGroupApplyItems(groups, readGroupRequests_(), plan.removals,
    g => leaderEmailsForGroupScope_(String(g.Scope_Key || ''), input.sessions), readManagersDone_());
  if (!items.length) {
    if (opts.interactive) toastIfPossible('Nothing to apply — every group already matches the Group_Requests tab.');
    log('applyGroupChanges: nothing to do.');
    return 0;
  }
  if (opts.interactive && !confirmConsequentialAction('Apply group changes?',
    `${items.filter(i => i.type === 'create').length} group(s) to create, ` +
    `${items.filter(i => i.type === 'add').length} member(s) to add, ` +
    `${items.filter(i => i.type === 'remove').length} to remove, ` +
    `${items.filter(i => i.type === 'manager').length} leader(s) to make managers.\n\n` +
    'These are real Google Groups: people added will start receiving what is sent to them.', true)) {
    return 0;
  }
  saveSlicedJobState(EMAIL_GROUPS_APPLY_STATE_PROP_KEY, {
    startedAt: Date.now(), lastSliceAt: Date.now(), slices: 0, stalledSlices: 0, errorSlices: 0,
    items: items, next: 0, outcomes: {}, created: {}, managers: {}, counts: { create: 0, add: 0, remove: 0, manager: 0, failed: 0 },
    names: names
  });
  log(`applyGroupChanges: starting on ${items.length} change(s).`);
  return runApplyGroupChangesSlice_();
}

function runApplyGroupChangesSlice_() {
  const api = emailGroupsApi_();
  return runSlicedJob({
    label: 'Apply group changes',
    propKey: EMAIL_GROUPS_APPLY_STATE_PROP_KEY,
    resumeHandler: EMAIL_GROUPS_APPLY_HANDLER,
    budgetMs: EMAIL_GROUPS_BUDGET_MS,
    resumeDelayMs: EMAIL_GROUPS_RESUME_DELAY_MS,
    watchdogDelayMs: EMAIL_GROUPS_WATCHDOG_MS,
    maxSlices: EMAIL_GROUPS_MAX_SLICES,
    maxStalledSlices: 2,
    maxErrorSlices: 3,
    work: ctx => {
      const state = ctx.state;
      const failedCreate = {};
      let processed = 0;
      while (state.next < state.items.length) {
        if (Date.now() >= ctx.deadline) break;
        const item = state.items[state.next];
        try {
          if (failedCreate[item.group] || state.outcomes[`create:${item.group}`] === 'failed') {
            throw new Error('the group could not be created');
          }
          if (item.type === 'create') {
            api.createGroup(item.group, item.name,
              item.kind === EMAIL_GROUP_KINDS.INTEREST ? `People interested in ${item.name}.` : `News for ${item.name}.`);
            state.created[item.group] = formatDateKey(new Date());
          } else if (item.type === 'manager') {
            api.addMember(item.group, item.email, 'MANAGER');
            (state.managers[item.group] = state.managers[item.group] || []).push(item.email);
          } else if (item.type === 'add') {
            api.addMember(item.group, item.email, 'MEMBER');
            state.outcomes[item.requestId] = { status: 'Added', inGroup: true, note: '' };
          } else if (item.type === 'remove') {
            api.removeMember(item.group, item.email);
            state.outcomes[item.requestId] = { status: 'Removed', inGroup: false, note: '' };
          }
          state.counts[item.type]++;
        } catch (err) {
          state.counts.failed++;
          if (item.type === 'create') {
            failedCreate[item.group] = true;
            state.outcomes[`create:${item.group}`] = 'failed';
          }
          if (item.requestId) {
            state.outcomes[item.requestId] = { status: 'Failed', inGroup: item.type === 'remove', note: `${item.type}: ${err}` };
          }
          log(`⚠️ Email groups: ${item.type} ${item.email || ''} ${item.group} failed — ${err}`);
          spoolOfficeNote('Email groups', `Could not ${item.type === 'create' ? 'create' : item.type} ` +
            `${item.email ? item.email + ' in ' : ''}${state.names[item.group] || item.group}: ${err}`);
        }
        state.next++;
        processed++;
        ctx.save();
      }
      writeEmailGroupOutcomes_(state);
      ctx.save();
      if (state.next >= state.items.length) return { finished: true };
      state.errorSlices = 0;
      return { processed: processed, remaining: state.items.length - state.next };
    },
    onHandOff: (state, result) => toastIfPossible(
      `Applying group changes: ${state.next} done, ${result.remaining} to go. It carries on by itself.`),
    overrunProblem: () => `stopped after ${EMAIL_GROUPS_MAX_SLICES} runs without finishing`,
    stalledProblem: result => `stopped early — ${result.remaining} change(s) could not be reached`,
    onError: (err, n) => log(`⚠️ A group-apply run failed (${err}) — ${n} in a row.`),
    errorProblem: (err, n) => `stopped after ${n} failed run(s), the last: ${err}`,
    onDone: (state, problem) => finishApplyGroupChanges_(state, problem)
  });
}

/**
 * WRITES WHAT HAPPENED back onto the two tabs and forgets it from the state,
 * so a slice killed after this costs nothing twice. Four column writes on the
 * request tab, never a redraw.
 */
function writeEmailGroupOutcomes_(state) {
  const ids = Object.keys(state.outcomes).filter(k => k.indexOf('create:') !== 0);
  if (ids.length) {
    const sheet = emailGroupsSheet_(SHEET_NAMES.GROUP_REQUESTS, HEADERS.Group_Requests, false);
    if (sheet && sheet.getLastRow() >= 2) {
      const width = sheet.getLastColumn();
      const all = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
      const head = all[0].map(h => String(h || '').trim());
      const c = h => head.indexOf(h);
      const cols = ['Status', 'Applied_On', 'In_Group', 'Notes'].map(c);
      if (cols.every(i => i >= 0) && c('Request_ID') >= 0) {
        const today = formatDateKey(new Date());
        for (let i = 1; i < all.length; i++) {
          const out = state.outcomes[String(all[i][c('Request_ID')] || '')];
          if (!out) continue;
          all[i][c('Status')] = out.status;
          all[i][c('Applied_On')] = today;
          all[i][c('In_Group')] = out.inGroup;
          if (out.note) all[i][c('Notes')] = out.note;
        }
        cols.forEach(ci => sheet.getRange(2, ci + 1, all.length - 1, 1).setValues(all.slice(1).map(r => [r[ci]])));
      }
    }
    ids.forEach(id => { delete state.outcomes[id]; });
  }
  const created = Object.keys(state.created);
  if (created.length) {
    const sheet = emailGroupsSheet_(SHEET_NAMES.EMAIL_GROUPS, HEADERS.Email_Groups, false);
    if (sheet) {
      const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
      readEmailGroups_().forEach(g => {
        if (state.created[g.Group_Email] && !g.Created_On) {
          sheet.getRange(g._row, head.indexOf('Created_On') + 1).setValue(state.created[g.Group_Email]);
          spoolOfficeNote('Email groups', `Created the group ${g.Name || g.Group_Email} (${g.Group_Email}).`);
        }
      });
    }
    state.created = {};
  }
  const mgr = Object.keys(state.managers);
  if (mgr.length) {
    const done = readManagersDone_();
    mgr.forEach(g => { done[g] = (done[g] || []).concat(state.managers[g]).filter(uniqueStrings); });
    PropertiesService.getScriptProperties().setProperty(EMAIL_GROUPS_MANAGERS_PROP_KEY, JSON.stringify(done));
    state.managers = {};
  }
}

function finishApplyGroupChanges_(state, problem) {
  try { writeEmailGroupOutcomes_(state); } catch (err) { log(`⚠️ Could not write group outcomes (${err}).`); }
  clearSlicedJobState(EMAIL_GROUPS_APPLY_STATE_PROP_KEY);
  deleteSlicedJobResumeTriggers(EMAIL_GROUPS_APPLY_HANDLER);
  const c = state.counts || {};
  const headline = `${problem ? `⚠️ Applying group changes ${problem}.` : '✅ Group changes applied.'} ` +
    `${c.create || 0} created, ${c.add || 0} added, ${c.remove || 0} removed, ${c.manager || 0} manager(s), ` +
    `${c.failed || 0} failed.`;
  log(`applyGroupChanges: ${headline}`);
  if (problem) spoolOfficeNote('Email groups', headline);
  toastIfPossible(headline);
  return c;
}

/** Escape hatch: stops a sweep. What is done stays done. */
function cancelApplyGroupChanges() {
  clearSlicedJobState(EMAIL_GROUPS_APPLY_STATE_PROP_KEY);
  deleteSlicedJobResumeTriggers(EMAIL_GROUPS_APPLY_HANDLER);
  toastIfPossible('Group changes stopped. Whatever was already applied stays applied.');
}

/** Admin ▸ One-Time Jobs: the tabs, the three interest lists, and everyone registered approved. */
function setUpEmailGroups() {
  if (!requireAuthorizedAdmin('Set Up Email Groups')) return 0;
  if (!confirmConsequentialAction('Set up email groups?',
    'This draws the Email_Groups and Group_Requests tabs, adds the Art, Exercise and Movies interest ' +
    'lists, and APPROVES everybody currently registered for a program whose Email_Group box is ticked on ' +
    'Program_Settings. Nothing is sent to Google until Apply Group Changes runs (from the menu, or ' +
    'tonight at 1am).', true)) return 0;
  const seeded = ensureEmailGroupsTabs_();
  const res = withScriptLock(DESK_LOCK_WAIT_MS, () => proposeClassGroupRequests({ autoApprove: true }), null);
  if (!res) {
    explainRefusal('The workbook is mid-update, so nobody was approved yet. Run Set Up Email Groups again in a minute.');
    return 0;
  }
  const msg = `Email groups set up: ${seeded} interest list(s) added, ${res.groups} class group(s) named, ` +
    `${res.proposed} registrant(s) approved. Run Apply Group Changes to create them.`;
  log(msg);
  toastIfPossible(msg);
  return res.proposed;
}

// --- the self-serve lists page ---------------------------------------------

function groupListSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty(EMAIL_GROUPS_SECRET_PROP_KEY);
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(EMAIL_GROUPS_SECRET_PROP_KEY, s);
  }
  return s;
}

function groupListToken_(id) {
  try {
    const bytes = Utilities.computeHmacSha256Signature(String(id || ''), groupListSecret_());
    return bytes.map(b => ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0')).join('').slice(0, 40);
  } catch (err) {
    return '';
  }
}

function groupListTokenValid_(id, token) {
  const want = groupListToken_(id);
  const got = String(token || '').trim().toLowerCase();
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

/** Pending confirmations live in Document Properties (99zj's rule: a store that grows). */
function readGroupListPending_() {
  try {
    const raw = PropertiesService.getDocumentProperties().getProperty(GROUP_LIST_CONFIRM_PROP_KEY);
    const all = raw ? JSON.parse(raw) : {};
    const now = Date.now();
    Object.keys(all).forEach(id => { if (now - (all[id].at || 0) > GROUP_LIST_CONFIRM_TTL_MS) delete all[id]; });
    return all;
  } catch (err) {
    return {};
  }
}

function writeGroupListPending_(all) {
  PropertiesService.getDocumentProperties().setProperty(GROUP_LIST_CONFIRM_PROP_KEY, JSON.stringify(all));
}

/** Who on Member_Roll this is — by email, then by name. Never leaves the server. */
function matchMemberForLists_(name, email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.MEMBER_ROLL) : null;
    if (!sheet) return '';
    const rows = readHeaderTable_(sheet, HEADERS.Member_Roll);
    const byEmail = rows.filter(r => normalizeGroupEmail_(r.Email) === email);
    const byName = rows.filter(r => [r.Display_Name, r.Name].some(n => normalizeNameKey(n) === normalizeNameKey(name)));
    const hit = byEmail[0] || (byName.length === 1 ? byName[0] : null);
    return hit ? String(hit.Display_Name || hit.Name || '').trim() : '';
  } catch (err) {
    return '';
  }
}

/** What the page is drawn from — the lists, and a confirmation when the link carries one. */
function groupListsPageContext(params) {
  const p = params || {};
  const id = String(p.c || '').trim();
  const confirming = !!id;
  const pending = confirming ? readGroupListPending_()[id] : null;
  const valid = confirming && !!pending && groupListTokenValid_(id, p.t);
  let lists = [];
  try { lists = activeInterestGroups_().map(l => ({ group: l.group, label: l.label })); } catch (err) { lists = []; }
  const labels = {};
  lists.forEach(l => { labels[l.group] = l.label; });
  return {
    mode: confirming ? 'confirm' : 'ask',
    valid: valid,
    id: valid ? id : '',
    token: valid ? String(p.t || '') : '',
    chosen: valid ? (pending.g || []).map(g => labels[g] || g) : [],
    lists: lists,
    centerName: typeof CENTER_NAME === 'string' ? CENTER_NAME : ''
  };
}

function groupListsDailyCount_(bump) {
  const props = PropertiesService.getScriptProperties();
  const today = formatDateKey(new Date());
  let rec = {};
  try { rec = JSON.parse(props.getProperty(GROUP_LIST_DAILY_COUNT_PROP_KEY) || '{}') || {}; } catch (err) { rec = {}; }
  if (rec.day !== today) rec = { day: today, n: 0 };
  if (bump) {
    rec.n++;
    props.setProperty(GROUP_LIST_DAILY_COUNT_PROP_KEY, JSON.stringify(rec));
  }
  return rec.n;
}

function sendGroupListConfirmation_(id, entry) {
  const url = checkInPageUrl({ mode: 'lists', params: { c: id, t: groupListToken_(id) } });
  const labels = {};
  activeInterestGroups_().forEach(l => { labels[l.group] = l.label; });
  const body = [
    `Hello ${entry.n},`, '',
    `Somebody asked for this address to get news about: ${(entry.g || []).map(g => labels[g] || g).join(', ')}.`,
    '', 'To confirm, open this link and press the button:', url, '',
    'If this was not you, ignore this email and nothing will happen.'
  ].join('\n');
  return sendRationedEmail({
    to: entry.e,
    subject: `Please confirm your email lists${typeof CENTER_NAME === 'string' && CENTER_NAME ? ' — ' + CENTER_NAME : ''}`,
    body: body,
    reserve: GROUP_LIST_MAIL_RESERVE
  });
}

/**
 * The page's first call: { name, email, groups }. ALWAYS answers the same
 * thing on success, whoever the person is, so the page cannot be used to learn
 * who is on the roll. Rate-limited per address and per day.
 */
function groupListsRequest(payload) {
  const generic = { ok: true, message: 'Thank you. Check your email and press the link in it to confirm.' };
  try {
    const args = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
    const name = String(args.name || '').trim().slice(0, 80);
    const email = normalizeGroupEmail_(args.email);
    if (!name) return { ok: false, message: 'Please type your name.' };
    if (!isPlausibleEmail(email)) return { ok: false, message: 'Please check your email address.' };
    const valid = {};
    activeInterestGroups_().forEach(l => { valid[l.group] = true; });
    const groups = (Array.isArray(args.groups) ? args.groups : []).map(normalizeGroupEmail_).filter(g => valid[g]);
    if (!groups.length) return { ok: false, message: 'Please tick at least one list.' };

    const pending = readGroupListPending_();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (Object.keys(pending).some(id => pending[id].e === email && pending[id].at > dayAgo)) return generic;
    if (groupListsDailyCount_(false) >= GROUP_LIST_MAX_SENDS_PER_DAY) {
      log('⚠️ The email-lists page hit its daily confirmation limit.');
      return { ok: false, message: 'We cannot take more requests today. Please try again tomorrow.' };
    }
    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    const entry = { n: name, e: email, g: groups, m: matchMemberForLists_(name, email), at: Date.now(), sent: false };
    const sent = sendGroupListConfirmation_(id, entry);
    entry.sent = sent.status === 'sent' || sent.status === 'paused';
    pending[id] = entry;
    writeGroupListPending_(pending);
    if (entry.sent) groupListsDailyCount_(true);
    return generic;
  } catch (err) {
    log(`⚠️ groupListsRequest failed (${err}).`);
    return { ok: false, message: 'Something went wrong. Please try again.' };
  }
}

/** The confirmation page's button. Adds them, born Approved. */
function groupListsConfirm(id, token) {
  try {
    const key = String(id || '').trim();
    if (!groupListTokenValid_(key, token)) return { ok: false, message: 'This link is not valid.' };
    const pending = readGroupListPending_();
    const entry = pending[key];
    if (!entry) return { ok: false, message: 'This link has already been used or has expired.' };
    const res = withScriptLock(DESK_LOCK_WAIT_MS, () => applyInterestAnswer({
      name: entry.m || entry.n, email: entry.e, groups: entry.g, source: GROUP_REQUEST_SOURCES.SELF_SERVE,
      note: entry.m ? 'Matched to Member_Roll.' : 'Not found on Member_Roll.'
    }), null);
    if (!res) return { ok: false, message: 'We are busy for a moment. Please press the button again.' };
    delete pending[key];
    writeGroupListPending_(pending);
    return { ok: true, message: 'Thank you — you are on the list.' };
  } catch (err) {
    log(`⚠️ groupListsConfirm failed (${err}).`);
    return { ok: false, message: 'Something went wrong. Please try again.' };
  }
}

/** A confirmation held by quiet hours or the quota goes out on the next daily pass. */
function resendHeldGroupListConfirmations_() {
  const pending = readGroupListPending_();
  let changed = false;
  Object.keys(pending).forEach(id => {
    if (pending[id].sent) return;
    const res = sendGroupListConfirmation_(id, pending[id]);
    if (res.status === 'sent' || res.status === 'paused') { pending[id].sent = true; changed = true; }
  });
  if (changed) writeGroupListPending_(pending);
}

function buildGroupListsHtml(context) {
  const payload = JSON.stringify(JSON.stringify(context || {})).replace(/</g, '\\u003c');
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         color: #202124; background: #f1f3f4; margin: 0; padding: 16px; font-size: 18px; }
  main { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px;
         box-shadow: 0 1px 3px rgba(60,64,67,.3); }
  h1 { font-size: 22px; margin: 0 0 12px 0; }
  p { line-height: 1.5; margin: 0 0 14px 0; }
  label.box { display: block; margin: 0 0 10px 0; }
  input[type=text], input[type=email] { width: 100%; font-size: 18px; padding: 12px; border: 1px solid #9aa0a6;
         border-radius: 8px; margin-top: 4px; }
  label.tick { display: flex; gap: 12px; align-items: center; padding: 12px; border: 1px solid #dadce0;
         border-radius: 8px; margin: 0 0 8px 0; cursor: pointer; }
  label.tick input { width: 24px; height: 24px; }
  button { width: 100%; background: #1a73e8; color: #fff; border: 0; border-radius: 8px; margin-top: 8px;
           padding: 16px; font-size: 18px; font-weight: 600; cursor: pointer; }
  button[disabled] { background: #9aa0a6; }
  .msg { color: #174EA6; }
</style>
</head>
<body>
<main id="m"></main>
<script>
  const CTX = JSON.parse(${payload});
  const m = document.getElementById('m');
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function done(message) {
    m.textContent = '';
    m.appendChild(el('h1', 'Thank you'));
    m.appendChild(el('p', message));
  }
  function drawConfirm() {
    m.textContent = '';
    if (!CTX.valid) {
      m.appendChild(el('h1', 'This link is not valid'));
      m.appendChild(el('p', 'It may have expired or been used already. You can ask again on the email lists page.'));
      return;
    }
    m.appendChild(el('h1', 'Confirm your email lists'));
    m.appendChild(el('p', 'You asked for news about: ' + CTX.chosen.join(', ') + '.'));
    const b = el('button', 'Yes, add me');
    b.onclick = function () {
      b.disabled = true; b.textContent = 'One moment…';
      google.script.run
        .withSuccessHandler(function (r) { if (r.ok) done(r.message); else { b.disabled = false; b.textContent = 'Yes, add me'; m.appendChild(el('p', r.message, 'msg')); } })
        .withFailureHandler(function () { b.disabled = false; b.textContent = 'Yes, add me'; })
        .groupListsConfirm(CTX.id, CTX.token);
    };
    m.appendChild(b);
  }
  function drawAsk() {
    m.textContent = '';
    m.appendChild(el('h1', 'Get news by email' + (CTX.centerName ? ' from ' + CTX.centerName : '')));
    if (!CTX.lists.length) { m.appendChild(el('p', 'There are no email lists to join right now.')); return; }
    m.appendChild(el('p', 'Choose what you would like to hear about. We will email you a link to confirm.'));
    const nameBox = el('label', 'Your name', 'box'); const name = document.createElement('input'); name.type = 'text';
    name.autocomplete = 'name'; nameBox.appendChild(name); m.appendChild(nameBox);
    const emailBox = el('label', 'Your email', 'box'); const email = document.createElement('input'); email.type = 'email';
    email.autocomplete = 'email'; emailBox.appendChild(email); m.appendChild(emailBox);
    const ticks = [];
    CTX.lists.forEach(function (l) {
      const row = el('label', '', 'tick'); const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.value = l.group; row.appendChild(cb); row.appendChild(el('span', l.label)); m.appendChild(row); ticks.push(cb);
    });
    const msg = el('p', '', 'msg');
    const b = el('button', 'Send me the confirmation');
    b.onclick = function () {
      b.disabled = true; msg.textContent = '';
      google.script.run
        .withSuccessHandler(function (r) { if (r.ok) done(r.message); else { b.disabled = false; msg.textContent = r.message; } })
        .withFailureHandler(function () { b.disabled = false; msg.textContent = 'Something went wrong. Please try again.'; })
        .groupListsRequest(JSON.stringify({ name: name.value, email: email.value,
          groups: ticks.filter(function (t) { return t.checked; }).map(function (t) { return t.value; }) }));
    };
    m.appendChild(b);
    m.appendChild(msg);
  }
  if (CTX.mode === 'confirm') drawConfirm(); else drawAsk();
</script>
</body>
</html>`;
}
