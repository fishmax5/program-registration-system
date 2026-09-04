// ============================================================================
// 6h. HOUSEHOLDS AND THE NAMES PEOPLE ARE ACTUALLY CALLED
// ============================================================================
//
// Two problems the desk has always solved in its head, written down here.
//
// THE HOUSEHOLD. A married couple arrive together, sit together, eat
// together, and are two rows on Registrant_Dash that know nothing about each
// other. The volunteer at the door finds him, signs him in, scrolls back up
// the alphabet and finds her. A daughter who books for both her parents is the
// same shape again. Nothing in this workbook has ever said "these people come
// as one" — but the forms have been quietly recording it all along, because
// the people who come together give the SAME EMAIL OR THE SAME PHONE NUMBER.
// buildHouseholdAssignments() is that reading, and it is a guess: which is why
// it is a guess staff can overrule (Household_Override) and why a contact
// detail shared by more than a handful of people is thrown out rather than
// welding a building's worth of members into one family — see
// HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN.
//
// THE NAME. "Bob (Robert) Kaplan" is what somebody types into a form when
// they have been called Bob for sixty years and the office's letters say
// Robert. So is 'Robert "Bob" Kaplan'. Both arrive as one string, become one
// Member_Roll row and one Quick Mark entry, and neither is findable by typing
// "Kaplan, Bob". parseMemberName() takes the two apart: the name on the row
// stays exactly as typed (it is the join key — see below), and the nickname
// becomes its own column that the door's search box and Quick Mark both look
// in.
//
// WHY A CORRECTION IS NOT JUST RETYPING THE CELL. Name is the key: it is what
// normalizeNameKey() is taken of, what a form response arrives under, and what
// Registrant_Dash, Club_Members and Regular_Needs all match on. Retyping it in
// place would orphan every one of those rows and the next sync would rebuild
// the OLD row beside the new one. So staff write the right spelling in
// Display_Name, and applyMemberNameCorrection() does the whole job: rewrites
// the name across every tab that carries it, and remembers the old spelling in
// a correction map so the response that arrives next week under the wrong one
// is canonicalized on the way in (canonicalMemberName()).
// ============================================================================

/**
 * HOW MANY PEOPLE SHARING ONE CONTACT DETAIL MEANS IT IS NOT A HOUSEHOLD.
 *
 * Four generations at one phone number is a family. Eleven members at
 * frontdesk@ is the office's own address typed in by whoever helped them fill
 * the form in, and grouping on it would put a third of the roll in one
 * "household" — every door screen then offering to sign in thirty people at
 * once. Six is chosen to be past the biggest real family anyone here has and
 * well short of the shared addresses that actually turn up.
 *
 * A detail at or above this count is dropped for GROUPING only. It stays on
 * the member's row, because it is still how you reach them.
 */
const HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN = 6;

/**
 * What a staff member can write in Household_Override to say "this person is
 * their own household" — the answer when the guess above put two unrelated
 * members together. Anything else written there is taken as the NAME OF A
 * HOUSEHOLD: type the same word on two rows and those two are a household,
 * whatever their contact details say.
 */
const HOUSEHOLD_OVERRIDE_SOLO_WORDS = ['none', 'no', 'own', 'solo', 'single', '-', 'x'];

/** Where the old-spelling → corrected-spelling map lives. */
const MEMBER_NAME_CORRECTIONS_PROP_KEY = 'MEMBER_NAME_CORRECTIONS_V1';

// ---------------------------------------------------------------- names

/**
 * One typed name, taken apart: { name, nickname }.
 *
 *   'Bob (Robert) Kaplan'     -> { name: 'Bob Kaplan',    nickname: 'Robert' }
 *   'Robert "Bob" Kaplan'     -> { name: 'Robert Kaplan', nickname: 'Bob' }
 *   'Kaplan, Robert (Bob)'    -> { name: 'Kaplan, Robert', nickname: 'Bob' }
 *   'Jane Smith'              -> { name: 'Jane Smith',    nickname: '' }
 *
 * `name` is the string with the parenthetical or the quoted part lifted out
 * and the spacing tidied; `nickname` is what was lifted. Neither is ever
 * written over the Name column — see the banner. A parenthetical holding
 * something that is plainly not a name ('(cancelled)', '(2 guests)') is left
 * alone: more than two words, or any digit, and this is not a nickname.
 */
function parseMemberName(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return { name: '', nickname: '' };

  let nickname = '';
  let name = text;

  const quoted = /["“‘']([^"”’']{1,40})["”’']/.exec(name);
  if (quoted && isPlausibleNicknameText_(quoted[1])) {
    nickname = quoted[1].trim();
    name = (name.slice(0, quoted.index) + ' ' + name.slice(quoted.index + quoted[0].length));
  } else {
    const bracketed = /\(([^)]{1,40})\)/.exec(name);
    if (bracketed && isPlausibleNicknameText_(bracketed[1])) {
      nickname = bracketed[1].trim();
      name = (name.slice(0, bracketed.index) + ' ' + name.slice(bracketed.index + bracketed[0].length));
    }
  }

  name = name.replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  // Everything the parenthetical was holding up: a name that is now empty
  // ('(Bob)' and nothing else) keeps what was inside it instead.
  if (!name) { name = nickname; nickname = ''; }
  return { name, nickname };
}

/** A parenthetical is a nickname only if it reads like one. See parseMemberName(). */
function isPlausibleNicknameText_(text) {
  const t = String(text || '').trim();
  if (!t || /\d/.test(t)) return false;
  return t.split(/\s+/).length <= 2;
}

/**
 * Every spelling a person can be found under: what is on the row, what the
 * parenthetical held, and the two combined. Used by the door's search box and
 * Quick Mark's roll so typing "Bob" finds the row that says "Robert".
 */
function memberSearchNames(name, nickname) {
  const parsed = parseMemberName(name);
  const out = [];
  const push = value => {
    const v = String(value || '').trim();
    if (v && out.indexOf(v) === -1) out.push(v);
  };
  push(name);
  push(parsed.name);
  push(parsed.nickname);
  push(nickname);
  if (nickname && parsed.name) push(`${nickname} ${parsed.name}`);
  return out;
}

// ------------------------------------------------------------- corrections

/**
 * FOR THE LENGTH OF ONE EXECUTION — the same contract as the memo caches in
 * section 5a. canonicalMemberName() is called once per form response per sync,
 * and a Script Properties read per registrant is a round trip nobody needs for
 * an answer that cannot change mid-run except through the one function below,
 * which clears this.
 */
let memberNameCorrectionsMemo = null;

function invalidateMemberNameCorrectionsMemo() {
  memberNameCorrectionsMemo = null;
}

/** The stored old-key → corrected-name map. Never throws; a lost map is no map. */
function readMemberNameCorrections() {
  if (memberNameCorrectionsMemo) return memberNameCorrectionsMemo;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(MEMBER_NAME_CORRECTIONS_PROP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    memberNameCorrectionsMemo = (parsed && typeof parsed === 'object') ? parsed : {};
    return memberNameCorrectionsMemo;
  } catch (err) {
    log(`ℹ️ Could not read the member name corrections (${err}) — names are used as typed.`);
    return {};
  }
}

/** Remembers one correction, and forgets any that pointed AT the old spelling. */
function rememberMemberNameCorrection(oldName, newName) {
  const oldKey = normalizeNameKey(oldName);
  const fixed = String(newName || '').trim();
  if (!oldKey || !fixed || oldKey === normalizeNameKey(fixed)) return;
  const map = readMemberNameCorrections();
  map[oldKey] = fixed;
  // A name corrected twice (Bob → Robert → Robert Kaplan) must not leave the
  // first correction pointing at a spelling that no longer exists, or the
  // next form response lands back on the middle one.
  Object.keys(map).forEach(key => {
    if (normalizeNameKey(map[key]) === oldKey) map[key] = fixed;
  });
  PropertiesService.getScriptProperties()
    .setProperty(MEMBER_NAME_CORRECTIONS_PROP_KEY, JSON.stringify(map));
  memberNameCorrectionsMemo = map;
}

/**
 * The spelling this workbook has settled on for a name, or the name itself.
 *
 * Applied where a name ARRIVES — a form response being turned into rows, a
 * member roll being rebuilt — so a correction made once keeps holding as the
 * public goes on typing the old spelling into the same form for months.
 */
function canonicalMemberName(name, corrections) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const map = corrections || readMemberNameCorrections();
  const fixed = map[normalizeNameKey(raw)];
  return fixed ? String(fixed) : raw;
}

/**
 * ONE CORRECTION, CARRIED EVERYWHERE. Rewrites the name on every tab that
 * carries it, remembers it for the responses still to come, and returns how
 * many cells changed.
 *
 * The tabs are listed rather than discovered because the column that holds a
 * person's name is not the same one on each: Registrant_Dash also carries a
 * host's name in Primary_Registrant, and a correction that fixed the guest and
 * not the host would break the guest-folding that reads them against each
 * other (see readWalkInDay()).
 */
function applyMemberNameCorrection(oldName, newName) {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  const fromKey = normalizeNameKey(from);
  if (!fromKey || !to || fromKey === normalizeNameKey(to)) return 0;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let changed = 0;
  const rewriteColumns = (sheetName, columns) => {
    const sheet = ss ? ss.getSheetByName(sheetName) : null;
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 1 || lastCol < 1) return;
    const grid = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    // THE COLUMNS ARE FOUND, NOT ASSUMED, and the header rows found with
    // them: these tabs put their headers in different places (row 2 on a
    // memory tab, once per section on a sectioned one) and a column can have
    // drifted sideways since HEADERS was written. Any row carrying one of the
    // wanted header names IS a header row — it is skipped, and its positions
    // are what the rows under it are read through.
    const wanted = {};
    columns.forEach(h => { wanted[normalizeHeaderText(h)] = true; });
    const headerRows = {};
    const nameCols = {};
    grid.forEach((row, i) => {
      let isHeader = false;
      row.forEach((cell, c) => {
        if (!wanted[normalizeHeaderText(cell)]) return;
        isHeader = true;
        nameCols[c] = true;
      });
      if (isHeader) headerRows[i] = true;
    });
    const cols = Object.keys(nameCols).map(Number);
    if (!cols.length) return;
    grid.forEach((row, i) => {
      if (headerRows[i]) return;
      cols.forEach(c => {
        if (normalizeNameKey(row[c]) !== fromKey) return;
        sheet.getRange(i + 1, c + 1).setValue(to);
        changed++;
      });
    });
  };

  rewriteColumns(SHEET_NAMES.REGISTRANT_DASH, ['Name', 'Primary_Registrant']);
  rewriteColumns(SHEET_NAMES.CLUB_MEMBERS, ['Name', 'Primary_Registrant']);
  rewriteColumns(SHEET_NAMES.REGULAR_NEEDS, ['Name']);
  rewriteColumns(SHEET_NAMES.MEMBER_ROLL, ['Name']);

  rememberMemberNameCorrection(from, to);
  // Every list built off these tabs is now a spelling out of date.
  invalidateQuickMarkIndexCache();
  invalidateWalkInMembersMemo();
  invalidateHouseholdIndexMemo();
  log(`✏️ "${from}" is now "${to}" — ${changed} cell(s) rewritten.`);
  return changed;
}

// -------------------------------------------------------------- households

/** A phone number as an identity: the last ten digits, or nothing. */
function householdPhoneKey(phone) {
  const digits = String(phone || '').replace(/\D+/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

/** An email address as an identity: trimmed and lowercased, or nothing. */
function householdEmailKey(email) {
  const text = String(email || '').trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text : '';
}

/**
 * What a staff member wrote in Household_Override, read as an intention:
 * { solo } to stand alone, { group } to be named into one, or {} for "no
 * answer, use the guess".
 */
function householdOverrideIntent(value) {
  const text = String(value || '').trim();
  if (!text) return {};
  if (HOUSEHOLD_OVERRIDE_SOLO_WORDS.indexOf(text.toLowerCase()) !== -1) return { solo: true };
  return { group: text.toLowerCase().replace(/\s+/g, ' ') };
}

/**
 * THE GUESS ITSELF. Takes [{ key, name, phone, email, override }] and returns
 * { byKey: { key: { id, members: [{ name, key }] } } }.
 *
 * People are joined through the contact details they share — union-find over
 * "this email" and "this phone" — with the institutional details dropped first
 * (HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN) and a staff override beating both: a
 * solo answer leaves somebody out of every group, and a named one is its own
 * joining key, so two people who share nothing can still be declared a
 * household by typing the same word twice.
 *
 * The id is derived from the alphabetically first member's key rather than
 * counted out, so it is the same string on the next refresh and on another
 * site's workbook — an id that renumbered itself every sync would be no use to
 * anything that stored it.
 */
function buildHouseholdAssignments(entries) {
  const list = (entries || []).filter(e => e && e.key);

  // How many people gave each detail — the institutional filter's whole input.
  const contactCounts = {};
  list.forEach(entry => {
    householdContactKeysOf_(entry).forEach(contact => {
      contactCounts[contact] = (contactCounts[contact] || 0) + 1;
    });
  });

  const parent = {};
  const find = key => {
    let k = key;
    while (parent[k] !== undefined && parent[k] !== k) k = parent[k];
    return k;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    parent[rb] = ra;
  };

  list.forEach(entry => {
    parent[entry.key] = parent[entry.key] === undefined ? entry.key : parent[entry.key];
    const intent = householdOverrideIntent(entry.override);
    if (intent.solo) return; // joined to nothing, on purpose
    const joiners = intent.group
      ? [`named:${intent.group}`]
      : householdContactKeysOf_(entry)
        .filter(contact => contactCounts[contact] < HOUSEHOLD_INSTITUTIONAL_CONTACT_MIN);
    joiners.forEach(joiner => {
      if (parent[joiner] === undefined) parent[joiner] = joiner;
      union(joiner, entry.key);
    });
  });

  const groups = {};
  list.forEach(entry => {
    const intent = householdOverrideIntent(entry.override);
    const root = intent.solo ? entry.key : find(entry.key);
    (groups[root] = groups[root] || []).push(entry);
  });

  const byKey = {};
  Object.keys(groups).forEach(root => {
    const members = groups[root].slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    // A household of one is not a household — it is just a person, and saying
    // so on their row would put "Household: Jane Smith" under Jane Smith.
    if (members.length < 2) return;
    const id = householdIdFromKey(members[0].key);
    const listed = members.map(m => ({ name: m.name, key: m.key }));
    members.forEach(m => { byKey[m.key] = { id, members: listed }; });
  });
  return { byKey };
}

/** Every contact detail one entry can be joined through. */
function householdContactKeysOf_(entry) {
  const out = [];
  const email = householdEmailKey(entry.email);
  const phone = householdPhoneKey(entry.phone);
  if (email) out.push(`email:${email}`);
  if (phone) out.push(`phone:${phone}`);
  return out;
}

/** 'jane smith' -> 'H-JANE-SMITH'. Stable, readable, and its own sort order. */
function householdIdFromKey(key) {
  const slug = String(key || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40);
  return slug ? `H-${slug}` : '';
}

/**
 * FOR THE LENGTH OF ONE EXECUTION, and no longer — the same contract as the
 * memo caches in section 5a. A sync refreshes the roll, the door reads a day
 * per building and Quick Mark builds its index, and all three want the same
 * answer computed from the same tab.
 */
let householdIndexMemo = null;

function invalidateHouseholdIndexMemo() {
  householdIndexMemo = null;
}

/**
 * The households as Member_Roll currently records them:
 * { byKey: { nameKey: { id, members: [{ name, key }] } } }.
 *
 * READ OFF THE TAB rather than recomputed, because the tab is where the staff
 * overrides are and where the refresh has already done this work. A workbook
 * whose roll predates these columns comes back empty, which every caller
 * treats as "this person has no household" — the correct answer until the next
 * refresh writes one.
 */
function readHouseholdIndex() {
  if (householdIndexMemo) return householdIndexMemo;
  const empty = { byKey: {} };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss ? ss.getSheetByName(SHEET_NAMES.MEMBER_ROLL) : null;
    if (!sheet) return empty;
    const headers = HEADERS.Member_Roll;
    const map = getIndexMap(headers);
    const rows = readSimpleTableValues(sheet, headers);
    const byId = {};
    const idOfKey = {};
    rows.forEach(row => {
      const name = String(row[map['Name']] || '').trim();
      const key = normalizeNameKey(name);
      const id = String(row[map['Household_ID']] || '').trim();
      if (!key || !id) return;
      idOfKey[key] = id;
      (byId[id] = byId[id] || []).push({ name, key });
    });
    const byKey = {};
    Object.keys(idOfKey).forEach(key => {
      const members = byId[idOfKey[key]];
      if (!members || members.length < 2) return;
      byKey[key] = { id: idOfKey[key], members };
    });
    householdIndexMemo = { byKey };
    return householdIndexMemo;
  } catch (err) {
    log(`ℹ️ Could not read the households off Member_Roll (${err}).`);
    return empty;
  }
}

/**
 * Everybody in one person's household EXCEPT that person, as [{ name, key }].
 * Empty for somebody who lives alone as far as this workbook can tell, which
 * is the answer every caller wants: nothing extra to show.
 */
function householdCompanionsOf(name, index) {
  const key = normalizeNameKey(name);
  if (!key) return [];
  const found = (index || readHouseholdIndex()).byKey[key];
  if (!found) return [];
  return found.members.filter(m => m.key !== key);
}
