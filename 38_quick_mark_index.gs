/**
 * WHAT THE DIALOG ACTUALLY CALLS. The stored index if there is one, a freshly
 * built one if there isn't.
 *
 * The build is the expensive part — it reads five tabs — and it is the same
 * answer for every person who opens the dialog in the next few hours. At a
 * sign-in desk the dialog is opened, closed and reopened all morning, and
 * paying for that read every time is what made "just load the three locations"
 * a twenty-second wait. Now the first open of a shift pays it and every one
 * after that is a cache read.
 */
function getQuickMarkIndex() {
  // Cache, then tab, then build — cheapest first. See
  // QUICK_MARK_INDEX_SHEET_NAME for why the tab is worth having as well as the
  // cache: a cache miss is normal and a rebuild is the thing with a queue
  // behind it.
  const cached = readCachedQuickMarkIndex();
  if (cached) return cached;
  const stored = readSheetQuickMarkIndex();
  if (stored) {
    // Put it back in the cache on the way past, so the NEXT open is the fast
    // read rather than this one again.
    writeCachedQuickMarkIndex(stored);
    return stored;
  }
  return refreshQuickMarkIndex();
}

/**
 * Menu entry: rebuild the stored lists now, so the next dialog open is both
 * instant AND current. Same work the ↻ link inside the dialog does.
 */
function rebuildQuickMarkListsNow() {
  const started = new Date();
  const index = refreshQuickMarkIndex();
  warmCheckInStore(); // the door reads its own store — rebuild both or neither
  const seconds = ((new Date() - started) / 1000).toFixed(1);
  const message = `Quick Mark lists rebuilt: ${index.sessions.length} session(s), ` +
    `${index.members.length} name(s) — took ${seconds}s, and the dialog will now open instantly ✅`;
  log(`rebuildQuickMarkListsNow: ${message}`);
  toastIfPossible(message);
}

/** Builds the index, stores it, and hands it back. The ↻ link, and the warmer. */
function refreshQuickMarkIndex() {
  const index = buildQuickMarkIndex();
  writeCachedQuickMarkIndex(index);
  writeSheetQuickMarkIndex(index);
  return index;
}

/**
 * Rebuilds the stored index off the hot path, so the desk never waits for it.
 *
 * Called at the end of a registrations sync — the moment the lists have just
 * changed and nobody is looking at the dialog. Never allowed to throw: a
 * warmer that breaks a sync would be worse than a cold cache, which costs one
 * slow dialog open and nothing else.
 */
function warmQuickMarkIndexCache() {
  try {
    refreshQuickMarkIndex();
    log('warmQuickMarkIndexCache: Quick Mark lists rebuilt and stored — the next dialog opens instantly.');
  } catch (err) {
    log(`ℹ️ Could not pre-build the Quick Mark lists (${err}) — the dialog will build them when it opens.`);
  }
  // The door's rosters, warmed at the same moment and for the same reason —
  // the registrant rows have just changed and nobody is standing at the desk.
  // Its own try/catch lives inside it; a failure here costs one slow roster
  // load and nothing else. See section 16c.
  warmCheckInStore();
}

/**
 * REBUILDS THE LISTS ONLY IF THERE ARE NONE STORED — the other half of the
 * bargain warmQuickMarkIndexCache() makes.
 *
 * The warm above runs at the end of a registrations sync, which is hourly. In
 * between, everything that adds a name or a session to the lists drops them
 * (invalidateQuickMarkIndexCache) — a desk registration, a walk-in, a form
 * import — and from that moment until the next sync there is nothing stored
 * for showQuickMarkDialog() to inline. The dialog then opens on "Loading the
 * sessions…" and the desk waits out a five-tab build with somebody standing
 * there, which is the one wait this whole cache exists to remove.
 *
 * So it is rebuilt on the five-minute pass the door's queue already runs on
 * (flushCheckInQueueTrigger), where nobody is waiting for it. Cheap when there
 * is nothing to do — a cache read, and a tab read behind it — which is the
 * normal case, and the reason this can afford to run that often.
 */
function warmQuickMarkIndexIfCold() {
  try {
    if (readCachedQuickMarkIndex() || readSheetQuickMarkIndex()) return;
    refreshQuickMarkIndex();
    log('warmQuickMarkIndexIfCold: the Quick Mark lists were cold and have been rebuilt.');
  } catch (err) {
    log(`ℹ️ Could not pre-build the Quick Mark lists on the five-minute pass (${err}).`);
  }
}

/**
 * Drops the stored index. Called by everything that can add a NAME or a
 * SESSION to the lists — a walk-in, a desk registration, a registrations
 * import — so nobody is ever offered a dropdown that has just gone wrong.
 *
 * NOT called by an ordinary attendance or lunch tick: those change a cell on a
 * row that is already in the index, and rebuilding five tabs to record that
 * nothing about the lists changed is the cost this cache exists to avoid.
 */
function invalidateQuickMarkIndexCache() {
  // The door's rosters go with them: they are built from the same rows, by the
  // same events, and a stored roster missing a name somebody just registered
  // is the same bug one screen over. See section 16c.
  clearCheckInStore();
  // The durable copy first, and unconditionally: a workbook with no script
  // cache at all still has the tab, and returning early on a missing cache is
  // how the stale-tab bug survived its own invalidation.
  clearSheetQuickMarkIndex();
  const cache = tryGetScriptCache();
  if (!cache) return;
  try {
    const manifest = cache.get(QUICK_MARK_CACHE_KEY);
    cache.remove(QUICK_MARK_CACHE_KEY);
    const count = manifest ? (JSON.parse(manifest).chunks || 0) : 0;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(`${QUICK_MARK_CACHE_KEY}_${i}`);
    if (keys.length > 0) cache.removeAll(keys);
  } catch (err) { /* a cache is an optimization; never let it decide anything */ }
}

/**
 * Empties the hidden index tab, leaving the tab itself in place — the next
 * refresh rewrites it, and a missing tab and an empty one are read the same
 * way (readSheetQuickMarkIndex() returns null for both).
 */
function clearSheetQuickMarkIndex() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(QUICK_MARK_INDEX_SHEET_NAME);
    if (!sheet) return;
    if (sheet.getLastRow() >= QUICK_MARK_INDEX_FIRST_ROW) {
      sheet.getRange(QUICK_MARK_INDEX_FIRST_ROW, 1,
        sheet.getLastRow() - QUICK_MARK_INDEX_FIRST_ROW + 1, 1).clearContent();
    }
  } catch (err) {
    log(`ℹ️ Could not clear the stored Quick Mark lists on ${QUICK_MARK_INDEX_SHEET_NAME} (${err}).`);
  }
}

/**
 * Is a stored index one THIS version of the script can serve? See
 * QUICK_MARK_INDEX_SCHEMA. A copy with no stamp at all predates the stamp and
 * is therefore certainly stale.
 */
function isCurrentQuickMarkIndex(index) {
  return !!index && index.schema === QUICK_MARK_INDEX_SCHEMA && Array.isArray(index.sessions);
}

/** The stored index, or null for a miss, an unreadable entry, or no cache at all. */
function readCachedQuickMarkIndex() {
  const cache = tryGetScriptCache();
  if (!cache) return null;
  try {
    const manifest = cache.get(QUICK_MARK_CACHE_KEY);
    if (!manifest) return null;
    const { chunks } = JSON.parse(manifest);
    if (!chunks || chunks < 1) return null;
    const keys = [];
    for (let i = 0; i < chunks; i++) keys.push(`${QUICK_MARK_CACHE_KEY}_${i}`);
    const parts = cache.getAll(keys);
    let packed = '';
    for (let i = 0; i < chunks; i++) {
      // A chunk can expire on its own, and half an index is not an index.
      if (parts[keys[i]] === undefined || parts[keys[i]] === null) return null;
      packed += parts[keys[i]];
    }
    const index = JSON.parse(unpackCachedText(packed));
    if (!isCurrentQuickMarkIndex(index)) return null;
    index.fromCache = true;
    return index;
  } catch (err) {
    log(`ℹ️ Could not read the stored Quick Mark lists (${err}) — rebuilding them.`);
    return null;
  }
}

/** Stores `index`, silently doing nothing if it is too big or the cache is unavailable. */
function writeCachedQuickMarkIndex(index) {
  const cache = tryGetScriptCache();
  if (!cache) return;
  try {
    const packed = packCachedText(JSON.stringify(index));
    const chunks = Math.ceil(packed.length / QUICK_MARK_CACHE_CHUNK_CHARS);
    if (chunks > QUICK_MARK_CACHE_MAX_CHUNKS) {
      log(`ℹ️ The Quick Mark lists are too large to store (${packed.length} chars) — ` +
        `the dialog will rebuild them each time it opens.`);
      return;
    }
    const values = {};
    for (let i = 0; i < chunks; i++) {
      values[`${QUICK_MARK_CACHE_KEY}_${i}`] =
        packed.substring(i * QUICK_MARK_CACHE_CHUNK_CHARS, (i + 1) * QUICK_MARK_CACHE_CHUNK_CHARS);
    }
    cache.putAll(values, QUICK_MARK_CACHE_SECONDS);
    // The manifest LAST, so a reader can never find a manifest pointing at
    // chunks that aren't written yet.
    cache.put(QUICK_MARK_CACHE_KEY, JSON.stringify({ chunks }), QUICK_MARK_CACHE_SECONDS);
  } catch (err) {
    log(`ℹ️ Could not store the Quick Mark lists (${err}) — the dialog will rebuild them when it opens.`);
  }
}

/**
 * The hidden tab the built index is kept on.
 *
 * WHY A TAB AND NOT JUST THE CACHE. CacheService is faster but it is a cache:
 * it expires after six hours, it is dropped when the script is redeployed, and
 * it is emptied by things nobody at a sign-in desk can see or predict. Every
 * one of those turns the first Quick Mark of a shift back into the twenty-
 * second wait this work exists to remove — and the first Quick Mark of a shift
 * is the one with a queue behind it.
 *
 * A tab is a durable copy of exactly the same JSON: one getValues() of one
 * small hidden tab, slower than the cache and a hundred times faster than
 * rebuilding from five big ones. So the order is cache, then tab, then build.
 */
const QUICK_MARK_INDEX_SHEET_NAME = 'Quick_Mark_Index';

/**
 * A cell holds 50,000 characters, so the packed index is written down column A
 * in chunks well inside that. Row 1 is a human-readable banner — somebody who
 * unhides this tab should find out what it is without asking.
 */
const QUICK_MARK_INDEX_CHUNK_CHARS = 40000;
const QUICK_MARK_INDEX_FIRST_ROW = 3;

/** The stored index from the tab, or null when there isn't a usable one. */
function readSheetQuickMarkIndex() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(QUICK_MARK_INDEX_SHEET_NAME);
    if (!sheet) return null;
    const lastRow = sheet.getLastRow();
    if (lastRow < QUICK_MARK_INDEX_FIRST_ROW) return null;
    const packed = sheet
      .getRange(QUICK_MARK_INDEX_FIRST_ROW, 1, lastRow - QUICK_MARK_INDEX_FIRST_ROW + 1, 1)
      .getValues()
      .map(row => String(row[0] || ''))
      .join('');
    if (!packed) return null;
    const index = JSON.parse(unpackCachedText(packed));
    if (!isCurrentQuickMarkIndex(index)) {
      log(`ℹ️ The stored Quick Mark lists on ${QUICK_MARK_INDEX_SHEET_NAME} were built by an older ` +
        `version of this script (schema ${index && index.schema ? index.schema : 'none'}, ` +
        `now ${QUICK_MARK_INDEX_SCHEMA}) — rebuilding them.`);
      return null;
    }
    index.fromSheet = true;
    return index;
  } catch (err) {
    log(`ℹ️ Could not read the stored Quick Mark lists from ${QUICK_MARK_INDEX_SHEET_NAME} (${err}) — rebuilding.`);
    return null;
  }
}

/** Writes `index` onto the hidden tab, creating it if this workbook hasn't got one. */
function writeSheetQuickMarkIndex(index) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(QUICK_MARK_INDEX_SHEET_NAME);
    if (!sheet) {
      const wasActive = ss.getActiveSheet();
      sheet = ss.insertSheet(QUICK_MARK_INDEX_SHEET_NAME, ss.getNumSheets());
      try { if (wasActive) ss.setActiveSheet(wasActive); } catch (err) { /* nothing to go back to */ }
    }
    const packed = packCachedText(JSON.stringify(index));
    const chunks = [];
    for (let i = 0; i < packed.length; i += QUICK_MARK_INDEX_CHUNK_CHARS) {
      chunks.push([packed.substring(i, i + QUICK_MARK_INDEX_CHUNK_CHARS)]);
    }

    sheet.clear();
    sheet.getRange(1, 1).setValue(
      `⚙️ Quick Mark's lists, pre-built so the dialog opens without a wait. Do not edit — ` +
      `it is rewritten by every registrations sync. Built ${index.builtAt}.`);
    sheet.getRange(2, 1).setValue(
      `${index.sessions.length} session(s), ${index.members.length} name(s), ` +
      `${(index.needs || []).length} regular need(s).`);
    if (sheet.getMaxRows() < QUICK_MARK_INDEX_FIRST_ROW + chunks.length) {
      sheet.insertRowsAfter(sheet.getMaxRows(),
        QUICK_MARK_INDEX_FIRST_ROW + chunks.length - sheet.getMaxRows());
    }
    if (chunks.length > 0) {
      sheet.getRange(QUICK_MARK_INDEX_FIRST_ROW, 1, chunks.length, 1).setValues(chunks);
    }
    // Hidden LAST, and never fatal: a lone or active tab cannot be hidden, and
    // a visible machine tab is untidy rather than broken.
    try { sheet.hideSheet(); } catch (err) { /* fine */ }
  } catch (err) {
    log(`ℹ️ Could not store the Quick Mark lists on ${QUICK_MARK_INDEX_SHEET_NAME} (${err}).`);
  }
}

/**
 * Gzip + base64, because the index is mostly repeated names and dates and
 * compresses to roughly a tenth of its size — which is the difference between
 * a handful of cache chunks and more than the cache will hold.
 */
function packCachedText(text) {
  return Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(text)).getBytes());
}

function unpackCachedText(packed) {
  const blob = Utilities.newBlob(Utilities.base64Decode(packed), 'application/x-gzip', 'cached.gz');
  return Utilities.ungzip(blob).getDataAsString();
}

/**
 * EVERYTHING THE DIALOG NEEDS, IN ONE PASS: the sessions at every location,
 * the people registered for each one, and the rest of Member_Roll.
 *
 * It used to fetch each list as you got to it — one server round trip when you
 * picked a location, another when you picked a session, and each of those
 * re-reading whole tabs (the registrants tab twice over, the program
 * dashboard, Program_Settings, Lunch_Schedule, Member_Roll). At a sign-in desk
 * that is a wait between every single selection, thirty times in a row, and it
 * is what made the tool "too slow to be useful".
 *
 * So the reads happen ONCE, and every narrowing after that is done in the
 * browser with no server call at all. Only pressing Mark talks to the sheet.
 *
 * THE DIALOG DOES NOT CALL THIS — it calls getQuickMarkIndex(), which serves
 * the stored copy. Building it still means reading five tabs, and even at one
 * read per tab that is seconds, not nothing. Call this directly only to
 * rebuild deliberately.
 *
 * WHAT IT COSTS is a snapshot: someone registering online mid-shift is not in
 * the lists until they are reloaded (the ↻ button, or reopening the dialog).
 * That is a fair trade — marking is still checked against the live sheet, so a
 * stale list can only mean a name is missing from a dropdown, never a mark
 * landing on the wrong row — and a walk-in covers the case anyway.
 */
function buildQuickMarkIndex() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  // The VALUES reader, not the formula-preserving one: nothing here is going
  // back onto a sheet, and one read of the tab instead of three is most of why
  // this now finishes in a second rather than twenty. See
  // readAllSectionedRowValues().
  const registrantRows = sheet ? getSectionedRowValues(sheet, headers, 'Event_ID') : [];

  const sessions = [];
  /** "location \0 title \0 dateKey" -> the bucket of names for that session. */
  const byLookup = {};
  /**
   * sessionKey -> { names, keys, times }, three parallel arrays.
   *
   * `keys` are normalized, so the browser can subtract this session's people
   * from the roll. `times` is each person's BOOKED SLOT on an appointment
   * session ('' on an ordinary one) — see the appointment note in namesFor():
   * a list of bare names is unusable at a Personalized Assistance desk, where
   * the whole shape of the morning is who is at 10:30 and who is at 11:00,
   * and where the same person can legitimately hold two slots.
   */
  const namesBySession = {};

  // Which appointment times are already gone, for the assistance sessions
  // below. Read once from the same rows: the free slots on twelve sessions are
  // twelve subtractions from one map, not twelve reads.
  const bookedTimes = readBookedAppointmentTimes(registrantRows);

  orderQuickMarkChoices(collectKnownProgramChoices('', registrantRows)).forEach(choice => {
    const sessionKey = `${choice.location}${QUICK_MARK_SESSION_KEY_SEPARATOR}${choice.label}`;
    if (namesBySession[sessionKey]) return;
    const bucket = { names: [], keys: [], times: [] };
    namesBySession[sessionKey] = bucket;
    byLookup[`${choice.location}\u0000${quickMarkTitleKey(choice.title)}\u0000${choice.dateKey}`] = bucket;
    sessions.push({
      value: choice.label, label: choice.label, group: choice.group, location: choice.location,
      // The two facts a REGULAR NEED is matched against. Parsing them back out
      // of the label in the browser works until a program's own name
      // contains the separator — see parseQuickMarkProgramChoice(), which is
      // the whole reason that function is careful.
      title: choice.title, dateKey: choice.dateKey,
      // Whether a booking on this session needs a TIME, and which times are
      // left. The two are separate facts because a fully-booked appointment
      // session has no free times and is still an appointment session — the
      // dialog has to say "every slot has gone" rather than quietly letting a
      // desk book somebody into no slot at all.
      byAppointment: !!(choice.appointment && choice.dateKey),
      times: freeAppointmentTimesForChoice(choice, bookedTimes)
    });
  });

  registrantRows.forEach(row => {
    const rowName = String(row[map['Name']] || '').trim();
    if (!rowName) return;
    const location = String(row[map['Location']] || '').trim();
    const title = String(row[map['Event']] || '').trim();
    const d = coerceDate(row[map['Event_Date']]);
    const dateKey = d ? formatDateKey(d) : '';
    const nameKey = normalizeNameKey(rowName);
    // The booked slot, as the START label the row is matched on elsewhere
    // (appointmentStartLabelOf()). Blank on every ordinary session, which is
    // what the dialog keys "does this list show times?" off.
    const slot = map['Event_Time'] === undefined ? '' : appointmentStartLabelOf(row[map['Event_Time']]);

    // This row belongs to its own session, and also to the dateless "program
    // only" entry for the same program — the fallback choice a desk picks
    // when it doesn't matter which date. Same rule the per-session read used.
    // Matched on the canonical title, so a lunch row whose dish was retyped
    // still finds its session — see quickMarkTitleKey().
    const titleKey = quickMarkTitleKey(title);
    const lookups = dateKey
      ? [`${location}\u0000${titleKey}\u0000${dateKey}`, `${location}\u0000${titleKey}\u0000`]
      : [`${location}\u0000${titleKey}\u0000`];
    lookups.forEach(lookup => {
      const bucket = byLookup[lookup];
      if (!bucket) return;
      // DEDUPED ON NAME AND SLOT TOGETHER, not on name alone. One person with
      // two rows for the same session is a duplicate registration on an
      // ordinary program — and two genuine appointments on a Personalized
      // Assistance one, which the desk has to be able to tell apart and mark
      // separately. Name alone hid the second one entirely.
      if (bucket.keys.some((k, i) => k === nameKey && bucket.times[i] === slot)) return;
      if (bucket.names.length >= QUICK_MARK_MAX_DROPDOWN_ITEMS) return;
      bucket.names.push(rowName);
      bucket.keys.push(nameKey);
      bucket.times.push(slot);
    });
  });

  // The roll is sent once for the whole dialog rather than per session: it is
  // the same list every time, and repeating it under each session is what
  // would actually make this payload large.
  const members = [];
  const seen = {};
  // The households travel with the roll, for the same reason the roll itself
  // does: the dialog has to be able to say "and Ray Smith" the instant a name
  // is picked, and there are as many of these as there are couples.
  const households = readHouseholdIndex();
  collectKnownMembers().sort((a, b) => a.localeCompare(b)).forEach(name => {
    const key = normalizeNameKey(name);
    if (seen[key]) return;
    seen[key] = true;
    const found = households.byKey[key];
    members.push({
      name, key,
      // Every spelling this person can be found under, so a desk typing the
      // name they actually use finds the row that says something else — see
      // memberSearchNames() in 77_households_and_names.gs.
      search: memberSearchNames(name, '').join(' ').toLowerCase(),
      // The REST of their household, never themselves.
      household: found ? found.members.filter(m => m.key !== key) : []
    });
  });

  // The standing needs travel with the lists, for the same reason the roll
  // does: the dialog has to be able to say "🔔 no milk" the instant a name is
  // picked, and a server call at that moment is a wait in the middle of the
  // one interaction this tool exists to make fast. There are tens of these,
  // not thousands.
  const needs = readRegularNeedRows().filter(need => need.active !== false).map(needForDialog);

  return {
    // Stamped here, checked by both readers — see QUICK_MARK_INDEX_SCHEMA.
    schema: QUICK_MARK_INDEX_SCHEMA,
    sessions, namesBySession, members, needs,
    builtAt: Utilities.formatDate(new Date(), TIMEZONE, 'h:mm a')
  };
}

/**
 * The appointment times a desk can still book on one Quick Mark session:
 * [{ value: '10:30 AM', label: '10:30 AM – 11:00 AM' }], earliest first.
 *
 * Empty for every session that is not [Personalized Assistance], which is what
 * the dialog keys its time dropdown off — and empty for a past one, since an
 * appointment nobody can keep is not a booking to offer.
 *
 * THE SAME SLOTS THE FORM OFFERS, from the same two functions
 * (buildAppointmentSlots() minus readBookedAppointmentTimes()), so a desk and
 * the public are never offered the same chair. `value` is the START label
 * because that is what a registrant row's Event_Time is matched on
 * (appointmentStartLabelOf()); the range is what a person reads.
 */
function freeAppointmentTimesForChoice(choice, bookedTimes) {
  const appointment = choice && choice.appointment;
  if (!appointment || !choice.dateKey) return [];
  if (choice.dateKey < formatDateKey(new Date())) return [];
  const start = coerceDate(appointment.start);
  if (!start) return [];
  const taken = (bookedTimes && bookedTimes[appointment.eventId]) || new Set();
  return buildAppointmentSlots(start, appointment.end, resolveSlotMinutes(appointment))
    .filter(slot => !taken.has(slot.startLabel))
    .map(slot => ({ value: slot.startLabel, label: slot.rangeLabel }));
}

/**
 * The session choices in the order a desk reads them: upcoming soonest-first,
 * then past most-recent-first, then the dateless "program only" fallbacks —
 * the same order every date-bearing tab in this workbook is sorted in, so "the
 * next one" and "the one that just happened" are both at the top.
 *
 * The cap is applied PER LOCATION, because that is the list a person actually
 * sees: one location's sessions, narrowed from the whole workbook's.
 */
function orderQuickMarkChoices(choices) {
  const todayKey = formatDateKey(new Date());
  const upcoming = [];
  const past = [];
  const undated = [];
  choices.forEach(choice => {
    if (!choice.dateKey) undated.push(choice);
    else if (choice.dateKey >= todayKey) upcoming.push(choice);
    else past.push(choice);
  });
  upcoming.sort((a, b) => (a.dateKey < b.dateKey ? -1 : (a.dateKey > b.dateKey ? 1 : a.label.localeCompare(b.label))));
  past.sort((a, b) => (a.dateKey > b.dateKey ? -1 : (a.dateKey < b.dateKey ? 1 : a.label.localeCompare(b.label))));
  undated.sort((a, b) => a.label.localeCompare(b.label));

  const perLocation = {};
  const out = [];
  const push = (list, group) => list.forEach(choice => {
    const used = perLocation[choice.location] || 0;
    if (used >= QUICK_MARK_MAX_DROPDOWN_ITEMS) return;
    perLocation[choice.location] = used + 1;
    out.push({
      label: choice.label, title: choice.title, dateKey: choice.dateKey,
      location: choice.location, appointment: choice.appointment || null, group
    });
  });
  push(upcoming, 'Upcoming');
  push(past, 'Past');
  push(undated, 'Any date (program only)');
  return out;
}

/**
 * What the Quick Mark session list offers at `location` (or everywhere,
 * if `location` is blank), NEAREST TO TODAY FIRST.
 *
 * ONE ENTRY PER SESSION, NOT PER PROGRAM, and each one carries its date:
 *
 *     Chair Yoga · Wed, Sep 16
 *     Chair Yoga · Wed, Sep 23
 *     Lunch @ Narberth — Chx Parm · Wed, Sep 16
 *
 * The list used to hold bare program names, which left the panel guessing
 * which session a tick meant — it picked the nearest one and said so in the
 * status line, which is fine for "mark Marion in, she's standing here" and
 * wrong for everything else: correcting last Thursday, or marking somebody off
 * for a session two weeks out, was simply not expressible. Naming the date
 * makes the common case identical (today's session sorts first) and the
 * uncommon one possible.
 *
 * A dateless entry is still emitted per program, as the last resort for a
 * program whose sessions have aged off the dashboard entirely — picking it
 * falls back to the old nearest-session behavior.
 *
 * LUNCH ONLY entries exist because a meal is served on days with no
 * programming at all (a drop-in lunch, a holiday meal), and someone eating one
 * has to be recordable. They resolve to a synthetic session — see
 * makeLunchOnlyEventId() — which the lunch dashboard counts like any other.
 *
 * Sources, unioned: the session table (authoritative, past and future),
 * Program_Settings (so an aged-off program is still offered), the registrant
 * rows (anything hand-added), and Lunch_Schedule (the lunch-only days).
 */
function collectKnownProgramChoices(location, registrantRows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const todayKey = formatDateKey(new Date());
  const todayMidnight = parseDateKey(todayKey);
  const choices = {};

  const note = (title, loc, date, options) => {
    const name = String(title || '').trim();
    if (!name) return;
    const rowLocation = String(loc || '').trim();
    if (location && rowLocation !== location) return;
    const d = coerceDate(date);
    const dateKey = d ? formatDateKey(d) : '';
    const label = d ? `${name}${LOCATION_LABEL_SEPARATOR}${formatDateLabel(d)}` : name;
    // Keyed by LOCATION AND LABEL, not label alone. The label is
    // "title · date" with no location in it, so two locations running the same
    // program on the same day collapse into one entry — invisible while this
    // was only ever called with a location to filter by, and wrong the moment
    // buildQuickMarkIndex() asks for every location at once.
    const key = `${rowLocation}${QUICK_MARK_SESSION_KEY_SEPARATOR}${label}`;
    if (choices[key]) return;
    choices[key] = {
      label,
      title: name,
      dateKey,
      location: rowLocation,
      lunchOnly: !!(options && options.lunchOnly),
      // { eventId, end, slotMinutes } for a [Personalized Assistance] session,
      // null for every other one. It is what lets the dialog offer the free
      // APPOINTMENT TIMES on that session — a desk booking one of these has to
      // name a slot, exactly as the form makes the public name one, or the row
      // it writes takes no time out of the provider's afternoon. Only the
      // session table carries the three facts, which is why it is read here
      // and not re-derived later.
      // `start` is the row's own Event_Date, clock time included — the slots
      // are cut forward from it, and a date key alone would put every
      // appointment at midnight.
      appointment: (options && options.appointment)
        ? Object.assign({ start: d }, options.appointment)
        : null,
      // Undated entries sort last; a real session sorts by how far off it is.
      distance: d ? Math.abs(d - todayMidnight) : Infinity,
      future: d ? dateKey >= todayKey : false
    };
  };

  try {
    const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (dash) {
      const headers = HEADERS.All_Program_Sessions;
      const map = getIndexMap(headers);
      getSectionedRowValues(dash, headers, 'Event_ID').forEach(row => {
        const isAssistance = map['Personalized_Assistance'] !== undefined &&
          isAssistanceColumnValue(row[map['Personalized_Assistance']]);
        note(row[map['Clean_Title']], row[map['Location']], row[map['Event_Date']], {
          appointment: isAssistance ? {
            eventId: String(row[map['Event_ID']] || '').trim(),
            end: map['Event_End'] === undefined ? null : coerceDate(row[map['Event_End']]),
            slotMinutes: map['Slot_Minutes'] === undefined ? 0 : (Number(row[map['Slot_Minutes']]) || 0)
          } : null
        });
      });
    }
  } catch (err) {
    log(`ℹ️ Quick Mark could not read the program dashboard for its program list (${err}).`);
  }

  try {
    const options = ss.getSheetByName(SHEET_NAMES.PROGRAM_SETTINGS);
    if (options) {
      const headers = HEADERS.Program_Settings;
      const map = getIndexMap(headers);
      readSimpleTableValues(options, headers).forEach(row => {
        // The dateless fallback entry for every program this workbook has
        // ever run, whether or not its sessions are still on the dashboard.
        note(row[map['Event']], row[map['Location']], '');
      });
    }
  } catch (err) {
    log(`ℹ️ Quick Mark could not read ${SHEET_NAMES.PROGRAM_SETTINGS} for its program list (${err}).`);
  }

  const lrMap = getIndexMap(HEADERS.All_Registrants);
  (registrantRows || []).forEach(row => {
    note(row[lrMap['Event']], row[lrMap['Location']], row[lrMap['Event_Date']]);
  });

  try {
    const menu = ss.getSheetByName(SHEET_NAMES.LUNCH_SCHEDULE);
    if (menu) {
      const map = getIndexMap(HEADERS.Lunch_Schedule);
      readLunchScheduleRows(menu).forEach(row => {
        const type = String(row[map['Type']] || '').trim();
        if (CATERED_LUNCH_TYPES.indexOf(type) === -1) return; // nothing is being served
        const menuDate = coerceDate(row[map['Event_Date']]);
        note(lunchOnlyRowTitle(row[map['Location']], menuDate ? formatDateKey(menuDate) : ''),
          row[map['Location']], row[map['Event_Date']], { lunchOnly: true });
      });
    }
  } catch (err) {
    log(`ℹ️ Quick Mark could not read ${SHEET_NAMES.LUNCH_SCHEDULE} for its lunch-only options (${err}).`);
  }

  return Object.keys(choices)
    .map(k => choices[k])
    .sort((a, b) => {
      if (a.distance !== b.distance) return a.distance - b.distance;
      if (a.future !== b.future) return a.future ? -1 : 1; // a tie goes to the upcoming one
      return a.label.localeCompare(b.label);
    });
}

/**
 * What a meal with no programming behind it is CALLED, wherever a program name
 * is expected: the session table, the Registrants tab's Event column, the Quick
 * Mark dropdown, the printed sign-in sheet.
 *
 * "🥡 Lunch Only (no program)" — what this used to say — was written from the
 * inside out. It names the row by what it ISN'T, which is only meaningful to
 * somebody who already knows the row is generated; to everybody else it is a
 * tab announcing that nothing is on. And thirty of them in a month all read
 * identically, so the one thing a person actually wants from the row — which
 * lunch, where — was the one thing the name did not say.
 *
 * So a lunch is named the way a program is: `Lunch @ Narberth — Chx Parm`.
 * Two forms of it, because the two are used for different things:
 *
 *   lunchOnlyProgramLabel(location)          "Lunch @ Narberth"
 *     Constant per location, so it can name a FORM that covers a whole month
 *     of dates and a group of sessions that share one.
 *
 *   lunchOnlyRowTitle(location, dateKey)     "Lunch @ Narberth — Chx Parm"
 *     Per date, because the dish is the fact a person reads the row for.
 *     Falls back to the plain label when no menu row names a dish.
 *
 * The dish is NOT part of any identity. Every join in this file keys on
 * Event_ID (makeLunchOnlyEventId()), and a title that changes when somebody
 * retypes a menu must never be able to strand a registration — see
 * isLunchOnlyProgramTitle(), which is how a title is recognized rather than
 * compared.
 */
const LUNCH_ONLY_LABEL_PREFIX = 'Lunch @ ';

/** What the label read before it named the location and the dish. Still recognized, never written. */
const LEGACY_LUNCH_ONLY_PROGRAM_LABEL = '🥡 Lunch Only (no program)';

/** "Lunch @ Narberth" — the name of the lunch program at one location. */
function lunchOnlyProgramLabel(location) {
  const loc = String(location || '').trim();
  return loc ? `${LUNCH_ONLY_LABEL_PREFIX}${loc}` : 'Lunch';
}

/**
 * "Lunch @ Narberth — Chx Parm" — one dated lunch row's own name.
 *
 * The dish is read off Lunch_Schedule at render time and is decoration only;
 * a row whose menu has not been typed yet is simply "Lunch @ Narberth", and
 * gains its dish on the next render without anything downstream noticing.
 */
function lunchOnlyRowTitle(location, dateKey) {
  const base = lunchOnlyProgramLabel(location);
  if (!dateKey) return base;
  const meal = getMealInfoForDate(parseDateKey(dateKey), location);
  const dish = meal ? String(meal.shorthand || meal.description || '').trim() : '';
  return dish ? `${base}${MEAL_HINT_SEPARATOR}${dish}` : base;
}

/**
 * Is `title` the name of a lunch-only session? Matched by SHAPE, not equality:
 * the dish is part of the name and changes when a menu is retyped, and the old
 * "🥡 Lunch Only (no program)" is still sitting in registrant rows and
 * Program_Settings entries written before the rename.
 */
function isLunchOnlyProgramTitle(title) {
  const text = String(title || '').trim();
  if (!text) return false;
  return text === LEGACY_LUNCH_ONLY_PROGRAM_LABEL || text.indexOf(LUNCH_ONLY_LABEL_PREFIX) === 0;
}

/**
 * The title a lunch row is MATCHED on, as opposed to the one it displays.
 *
 * The display name now carries the dish, and a dish is the one part of it that
 * changes: somebody retypes Tuesday's menu and the session row is renamed on
 * the next render — while the registrant rows written under the old name keep
 * it, because registrations are not rebuilt. Matching on the displayed string
 * would then hide those people from the desk and, worse, drop them into the
 * walk-in path, which would add a SECOND row for somebody who is already
 * registered.
 *
 * So every lunch title collapses to one key for matching purposes. Identity
 * still ultimately rests on Event_ID; this is what keeps the dropdown honest
 * in between.
 */
const LUNCH_ONLY_TITLE_MATCH_KEY = '\u0000lunch';

function quickMarkTitleKey(title) {
  return isLunchOnlyProgramTitle(title) ? LUNCH_ONLY_TITLE_MATCH_KEY : String(title || '').trim();
}

/**
 * Event_ID prefix for a lunch-only row. Deliberately NOT a computeEventId()
 * hash: there is no calendar event to key one off, and the prefix is what lets
 * buildDashboardRollup() recognize the row as legitimately session-less rather
 * than as an orphan pointing at a deleted event.
 */
const LUNCH_ONLY_EVENT_ID_PREFIX = 'LUNCHONLY:';

function makeLunchOnlyEventId(dateKey, location) {
  return `${LUNCH_ONLY_EVENT_ID_PREFIX}${dateKey}|${String(location || '').trim()}`;
}

function isLunchOnlyEventId(eventId) {
  return String(eventId || '').indexOf(LUNCH_ONLY_EVENT_ID_PREFIX) === 0;
}

/**
 * Splits a Quick Mark program choice back into { title, dateKey, lunchOnly }.
 *
 * Parsed from the RIGHT and validated as a date, so a program whose own name
 * contains the separator ("Coffee · Chat") still resolves correctly: the split
 * is only taken when what follows it actually parses as a date label.
 */
function parseQuickMarkProgramChoice(value) {
  const raw = String(value || '').trim();
  if (!raw) return { title: '', dateKey: '', lunchOnly: false };
  const idx = raw.lastIndexOf(LOCATION_LABEL_SEPARATOR);
  let title = raw;
  let dateKey = '';
  if (idx > 0) {
    const tail = raw.substring(idx + LOCATION_LABEL_SEPARATOR.length).trim();
    const parsed = coerceDate(tail);
    if (parsed) {
      title = raw.substring(0, idx).trim();
      dateKey = formatDateKey(parsed);
    }
  }
  return { title, dateKey, lunchOnly: isLunchOnlyProgramTitle(title) };
}

/** Every ACTIVE name on Member_Roll — the standing directory, registered or not. */
function collectKnownMembers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    const sheet = ss.getSheetByName(SHEET_NAMES.MEMBER_ROLL);
    if (!sheet) return [];
    const headers = HEADERS.Member_Roll;
    const map = getIndexMap(headers);
    return readSimpleTableValues(sheet, headers)
      // A retired member is still ON the roll — that is the point of retiring
      // rather than deleting them — but they are not somebody the desk is
      // offered when it starts typing a name. See memberRollIsRetired().
      .filter(row => !memberRollIsRetired(row, map))
      .map(row => String(row[map['Name']] || '').trim())
      .filter(Boolean);
  } catch (err) {
    log(`ℹ️ Quick Mark could not read Member_Roll for its name list (${err}).`);
    return [];
  }
}
/**
 * A dropdown built from a list this long stops being a dropdown. Cap it — the
 * ordering above guarantees the cut falls on the least relevant end.
 */
const QUICK_MARK_MAX_DROPDOWN_ITEMS = 400;

/**
 * Called from the dialog. Applies one mark to the real registrant row, and
 * says in plain words what it did.
 *
 * WHAT THE TWO TICKS MEAN, in one place:
 *   Attended            they were here. Lunch_Served untouched.
 *   Lunch               they got a meal. Attended is CLEARED — a lunch tick on
 *                       its own is the take-out case, and is also how somebody
 *                       wrongly marked present gets corrected.
 *   Attended + Lunch    here, and fed. Both set.
 *
 * Matches on Location + Event + Name. A name legitimately appears on several
 * rows — the same person registered for several dates of the same program — so
 * a session chosen WITH a date means that session and no other; only the
 * dateless "program only" choice falls back to marking the nearest session,
 * and the message says which date it landed on either way.
 *
 * Returns { ok, message, namesChanged } for the dialog to render. Never
 * throws for an ordinary miss: "nobody by that name is registered" is an
 * answer, not a failure.
 */
function applyQuickMarkFromDialog(args) {
  // UNDER THE LOCK, all of it. This reads the tab to find the row, then writes
  // to that row NUMBER — so a render landing in between (a sync, a rebuild
  // slice, another desk) would send the tick to whichever row had moved into
  // that position. The window is small and the consequence is silent: somebody
  // else marked present.
  //
  // A short wait, and an honest answer when it expires: the person at the desk
  // can press the button again in a moment, which is a far better outcome than
  // either a hang or a mark on the wrong row.
  const result = withScriptLock(DESK_LOCK_WAIT_MS, () => applyQuickMarkLocked(args), {
    ok: false,
    message: '⏳ The workbook is mid-update — nothing was marked. Press the button again in a moment.'
  });
  reportOptimisticQuickMarkFailure(args, result);
  return result;
}

/**
 * A QUICK MARK THE DESK WAS ALREADY TOLD HAD WORKED, AND WHICH THEN DID NOT.
 *
 * The dialog marks optimistically — it draws the mark as done and clears for
 * the next person in the queue rather than holding still through the lock wait
 * and the write (see submit()). Which means a refusal — the lock timed out,
 * the appointment slot went in between, there is no lunch on that date — has
 * nobody looking at it by the time it exists. So it is told to the office
 * instead, the same way the door app reports a sign-in that did not land. The
 * dialog also strikes its own log line through if it is still open; this is
 * the half that survives it being closed.
 *
 * Does nothing unless the caller said `optimistic` — a mark made from anywhere
 * that IS waiting for the answer reports it by returning it, as it always has.
 * needsConfirm is not a failure either: it is the walk-in question, asked
 * because the dialog's copy of the lists disagreed with the sheet, and the
 * dialog asks it and sends the mark again.
 *
 * Never allowed to throw: the mark has already failed, and a mailer that fails
 * on top of it must not turn an answer the dialog can still show into an
 * exception it cannot.
 */
function reportOptimisticQuickMarkFailure(args, result) {
  if (!args || !args.optimistic || !result || result.ok || result.needsConfirm) return;
  try {
    const name = String(args.name || '(no name)').trim();
    const where = [String(args.session || '').trim(), String(args.location || '').trim()]
      .filter(Boolean).join(' · ');
    log(`⚠️ Quick Mark did not save for "${name}"${where ? ` (${where})` : ''}: ${result.message}`);
    notifyAdmin(`Quick Mark did not save: ${name}`,
      'A mark made at the desk was shown as done and then refused, so whoever made it has ' +
      'probably moved on to the next person.\n\n' +
      `Name: ${name}\n` +
      `Session: ${where || '(none chosen)'}\n` +
      `Ticked: ${describeQuickMark(!!args.attended, !!args.lunch, !!args.signup, !!args.register, !!args.waitlist)}\n` +
      (args.appointmentTime ? `Appointment: ${args.appointmentTime}\n` : '') +
      `\nWhat the workbook said:\n${result.message}\n\n` +
      'Nothing was written. Check the row, and mark it again from Quick Mark if it is still needed.');
  } catch (err) {
    log(`ℹ️ Could not report a failed Quick Mark (${err}).`);
  }
}

/**
 * THE WHOLE HOUSEHOLD, ONE PRESS — the same mark, applied to this person and
 * to everybody Member_Roll says arrives with them (77_households_and_names.gs).
 *
 * The couple who come to Tuesday lunch together are two rows and have always
 * been two trips through this dialog: find her, mark her, clear the name, find
 * him, mark him. This is that, done once.
 *
 * ONE LOCK FOR THE WHOLE PARTY rather than one per person, because the reason
 * applyQuickMarkFromDialog() takes it in the first place — a render moving the
 * rows between reading and writing — is exactly as true between the second
 * person and the third. Each mark is otherwise its own ordinary mark: same row
 * matching, same wording, its own answer back, and a miss on one ("nobody by
 * that name is registered for this session") leaves the others alone.
 *
 * The appointment fields are deliberately NOT carried across: a booked slot is
 * one chair at one time, and giving a spouse the same one would double-book
 * it. A household that both hold appointments is two marks, as it should be.
 */
function applyQuickMarkForHousehold(args) {
  const base = args || {};
  const names = [String(base.name || '').trim()].filter(Boolean);
  householdCompanionsOf(base.name).forEach(m => {
    if (names.indexOf(m.name) === -1) names.push(m.name);
  });
  if (names.length < 2) {
    return applyQuickMarkFromDialog(base); // a household of one is just a person
  }

  const result = withScriptLock(DESK_LOCK_WAIT_MS, () => {
    const messages = [];
    let ok = false;
    let namesChanged = false;
    let addedName = '';
    let addedNameKey = '';
    names.forEach((name, i) => {
      const one = Object.assign({}, base, { name });
      if (i > 0) {
        one.appointmentTime = '';
        one.bookedTime = '';
        one.moveTime = false;
        one.earlierAppointment = false;
      }
      const res = applyQuickMarkLocked(one) || {};
      messages.push(res.message || `${name}: nothing came back.`);
      if (res.ok) ok = true;
      if (res.namesChanged) {
        namesChanged = true;
        addedName = res.addedName || addedName;
        addedNameKey = res.addedNameKey || addedNameKey;
      }
    });
    return {
      ok,
      message: `👪 ${messages.join('  ·  ')}`,
      // The dialog rebuilds its list off these; a party that added more than
      // one walk-in row still only needs it told once, and it re-reads the
      // session either way (see sessionChanged()).
      namesChanged, addedName, addedNameKey
    };
  }, {
    ok: false,
    message: '⏳ The workbook is mid-update — nothing was marked. Press the button again in a moment.'
  });
  // The household path holds the lock itself and calls applyQuickMarkLocked()
  // directly, so it never passes through the report above. Same desk, same
  // optimistic hand-back, same office to tell.
  reportOptimisticQuickMarkFailure(base, result);
  return result;
}

/** The body of applyQuickMarkFromDialog(), which holds the lock for it. */
function applyQuickMarkLocked(args) {
  args = args || {};
  const location = String(args.location || '').trim();
  const name = String(args.name || '').trim();
  const attended = !!args.attended;
  const lunch = !!args.lunch;
  // SIGN UP is the third thing a desk does with a lunch, and until now the
  // only one it could not do here. "Lunch" writes Lunch_Served, which means
  // the meal has already been handed over; there was no way to say "Mrs
  // Kaplan came in on Monday and wants a lunch a week Thursday" without
  // asserting she had already eaten it — which lands a served meal on a future
  // date and makes Served_Confirmed disagree with reality on both days.
  // This records the DEMAND instead: Lunch_Status = Needed, nothing served.
  const signup = !!args.signup && !lunch;
  // REGISTER is the fourth thing a desk does, and the one Caroline could not
  // do here at all: put somebody on a session they have not signed up for.
  // People ring up, or stop at the desk on their way out of one appointment to
  // make the next — and until now the only answer was "let me open the form
  // and fill it in as you". It marks nothing: a registration says where
  // somebody is expected, and Attended is a separate fact recorded on the day.
  const register = !!args.register;
  // ADD TO WAITLIST is the fifth thing a desk does, and the one it has never
  // been able to say at all: "we are full, put her down and we will ring her".
  // Until now the only way to record it was to register the person — which
  // takes a seat that is not there, tells the kitchen to cook, and leaves the
  // session reading one over its cap — or to write it on a piece of paper,
  // which is what actually happened. It is a status change and not a mark, so
  // it goes through the one writer in 71_cancellation.gs rather than setting
  // Program_Status here: four cells, not one.
  const waitlist = !!args.waitlist;
  // HOW MANY MEALS, on both sides of the counter. A sign-up carries the size
  // of the ORDER (Joan's four), and a served tick carries what was actually
  // handed over and where it went — eaten here, carried out, left in the
  // fridge. They are different facts about different columns, which is why the
  // desk is asked for them separately and why neither is inferred from the
  // other: ordering four and eating one is an ordinary Tuesday.
  const mealsOrdered = quickMarkCount(args.mealsOrdered);
  const ateHere = quickMarkCount(args.ateHere);
  const tookHome = quickMarkCount(args.tookHome);
  const inFridge = quickMarkCount(args.inFridge);
  // A standing place — every future session of this program, not just this
  // one. It is the Club_Members list, which is exactly this promise already
  // (see CLUB_TAG); the only thing that has changed is that a desk can add
  // somebody to it, for any program, without waiting for them to tick a box
  // on a form they have never once filled in.
  // Never on an appointment program — see applyClubRosterCatchup(), which
  // would otherwise book one person into every slot the program ever runs.
  // Refused below, once the session is known, rather than silently dropped.
  const standing = register && !!args.standing;
  // WHICH KIND OF STANDING PLACE. A place on every future session of a
  // program and a lunch on every one of those dates are two different
  // promises, and the desk was previously only able to make the first: the
  // Club_Members row went in with no Lunch value at all, so
  // applyClubRosterCatchup() booked every future session as "No Lunch" — the
  // program carried forward and the meal did not. This is the second
  // promise, said out loud, for the many people who come to a class they never
  // miss and stay for the lunch every time.
  const standingLunch = standing && !!args.standingLunch;
  const appointmentTime = String(args.appointmentTime || '').trim();
  // WHICH ROW, when the name does not say. On a Personalized Assistance
  // session one person can hold two slots, and the dialog sends back the slot
  // the picked entry came from so the mark lands on that row rather than on
  // whichever of the two sorts first. Blank everywhere else, which matches
  // every row and so changes nothing.
  const bookedTime = appointmentStartLabelOf(args.bookedTime);
  // "She rang to move to 11:30" — a rebooking, which is neither an attendance
  // mark nor a registration and had no way to be expressed here at all.
  const moveTime = !!args.moveTime && !!bookedTime && !!appointmentTime &&
    appointmentTime !== bookedTime;
  // Only ever asked beside an appointment time, because that is the only kind
  // of booking there is anything earlier to move somebody into.
  const earlierAppointment = (appointmentTime && args.earlierAppointment)
    ? EARLIER_APPOINTMENT_VALUES.YES : '';
  const selection = parseQuickMarkProgramChoice(args.session);

  if (!name) return { ok: false, message: '⚠️ Pick a name first — nothing was marked.' };
  if (!attended && !lunch && !signup && !register && !waitlist) {
    return { ok: false, message: '⚠️ Tick Attended, Lunch, Sign up for lunch, Register them, or Add to waitlist.' };
  }
  // WAITLISTING IS NOT A MARK, and every one of these says the opposite of it.
  // Attended is "they were here", Lunch and Sign up both order a meal — and a
  // waitlisted row carries Lunch_Status = 'Waitlisted' precisely so the
  // kitchen does not cook for somebody without a seat. Refused rather than
  // silently resolved: a desk that ticked both meant one of them, and only the
  // person standing there knows which.
  if (waitlist && (attended || lunch || signup)) {
    return {
      ok: false,
      message: '⚠️ Add to waitlist cannot be ticked with Attended, Lunch, or Sign up for lunch — ' +
        'somebody on the waitlist has no seat and no meal ordered. Nothing was changed.'
    };
  }
  if (waitlist && standing) {
    return {
      ok: false,
      message: '⚠️ A standing place is a seat at every future session, which is the opposite of a ' +
        'waitlist. Untick one of them and mark again.'
    };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return { ok: false, message: '⚠️ There is no registrants tab yet — run Sync Registrations once.' };

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const numCols = headers.length;
  const zones = getSectionZones(sheet, 'Event_ID');
  const nameKey = normalizeNameKey(name);
  const todayKey = formatDateKey(new Date());
  const candidates = [];

  zones.forEach(zone => {
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;
    const values = sheet.getRange(zone.dataStart, 1, count, numCols).getValues();
    values.forEach((row, i) => {
      if (normalizeNameKey(row[map['Name']]) !== nameKey) return;
      if (location && String(row[map['Location']] || '').trim() !== location) return;
      if (selection.title &&
        quickMarkTitleKey(row[map['Event']]) !== quickMarkTitleKey(selection.title)) return;
      const d = coerceDate(row[map['Event_Date']]);
      // A dated choice means THAT session and no other — the whole reason the
      // session list names dates. Only an undated choice falls back to the
      // nearest-session guess below.
      if (selection.dateKey && (!d || formatDateKey(d) !== selection.dateKey)) return;
      const rowSlot = map['Event_Time'] === undefined ? '' : appointmentStartLabelOf(row[map['Event_Time']]);
      // A slot named by the dialog means THAT row and no other — the same rule
      // a dated choice follows one line up, one level finer.
      if (bookedTime && rowSlot !== bookedTime) return;
      candidates.push({
        sheetRow: zone.dataStart + i, date: d, dateKey: d ? formatDateKey(d) : '', slot: rowSlot
      });
    });
  });

  if (candidates.length === 0) {
    // Nobody registered under that name for that session. Since the lists
    // offer every known member and not just the registered ones, this is the
    // walk-in case rather than a dead end.
    return addQuickMarkWalkIn(sheet, {
      name, selection, location, attended, lunch, signup, register, waitlist, standing, standingLunch,
      appointmentTime, earlierAppointment, mealsOrdered, ateHere, tookHome, inFridge,
      // HOW TO REACH SOMEBODY THE WORKBOOK IS MEETING FOR THE FIRST TIME. The
      // dialog has never had these to send — a desk registering a walk-in
      // types the name and nothing else — but the door page asks a new member
      // for an email precisely so the office can follow up, and a row written
      // without it would throw that away the moment it was collected.
      phone: String(args.phone || '').trim(),
      email: String(args.email || '').trim(),
      // Blank on every existing caller, so the row reads 'Attendee' / 'Self'
      // exactly as it always has. Only the check-in page's guest registrations
      // send them.
      personType: args.personType, primaryRegistrant: args.primaryRegistrant,
      confirmed: !!args.confirmWalkIn
    });
  }

  // Today, else the soonest future date, else the most recent past one.
  candidates.sort((a, b) => {
    const rank = c => (c.dateKey === todayKey ? 0 : (c.dateKey > todayKey ? 1 : 2));
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 2) return (b.date || 0) - (a.date || 0); // past: newest first
    return (a.date || 0) - (b.date || 0);                    // future: soonest first
  });
  const target = candidates[0];

  if (map['Attended'] === undefined || map['Lunch_Served'] === undefined) {
    return { ok: false, message: '⚠️ This tab has no Attended/Lunch_Served columns yet — run Sync Registrations once.' };
  }

  // A lunch sign-up is REFUSED BEFORE ANYTHING IS WRITTEN when there is no
  // meal on that date to sign up for. Checked here rather than beside the
  // write below so a rejected sign-up leaves the row untouched instead of
  // half-marked — "Attended + Sign up for lunch" must not record the
  // attendance and then bail out of the half the person actually came in for.
  const signupSession = signup
    ? {
      date: target.date,
      location: location ||
        String(sheet.getRange(target.sheetRow, map['Location'] + 1).getValue() || '').trim()
    }
    : null;
  if (signup && (!signupSession.date || !isLunchOfferedOn(signupSession.date, signupSession.location))) {
    return {
      ok: false,
      message: `⚠️ No lunch is scheduled at ${signupSession.location || 'that location'} on ` +
        `${signupSession.date ? formatDateLabel(signupSession.date) : 'that date'} — add a Hot or Cold row on ` +
        `${SHEET_NAMES.LUNCH_SCHEDULE} first, or nothing would be ordered for them. Nothing was marked.`
    };
  }

  // THE MOVE GOES FIRST, and is refused before anything else is written when
  // the slot has gone: half a move — marked attended, still down for the old
  // time — is worse than no move, because the row then disagrees with both the
  // desk and the person standing at it.
  let movedNote = '';
  if (moveTime) {
    const clash = appointmentSlotTaken(sheet, map, target, appointmentTime, target.sheetRow);
    if (clash) {
      return {
        ok: false,
        message: `⚠️ ${appointmentTime} is already booked${clash === true ? '' : ` (${clash})`} — ` +
          `${name} is still down for ${bookedTime}. Nothing was changed.`
      };
    }
    const slots = appointmentSlotsForRow(sheet, map, target);
    const moved = slots.filter(slot => slot.startLabel === appointmentTime)[0];
    if (map['Event_Time'] !== undefined) {
      // Text first, THEN the value: a single "11:30 AM" written into a cell
      // Sheets may interpret comes back as a 1899 time value. See
      // stampTextColumns().
      sheet.getRange(target.sheetRow, map['Event_Time'] + 1)
        .setNumberFormat('@')
        .setValue(moved ? moved.rangeLabel : appointmentTime);
    }
    movedNote = ` Moved from ${bookedTime} to ${appointmentTime}.`;
  }

  // AFTER THE MOVE AND BEFORE EVERYTHING ELSE, which is the only place it can
  // go: this reads the whole row and writes the whole row back (the stamp is
  // four cells that have to agree, and stampRegistrantRowWaitlisted() is the
  // one writer of them), so a read taken before the move would put the old
  // appointment time back. Nothing below this runs — a waitlisting is the
  // whole of what the button did.
  if (waitlist) {
    const rowValues = sheet.getRange(target.sheetRow, 1, 1, numCols).getValues()[0];
    if (!stampRegistrantRowWaitlisted(rowValues, map, {
      source: WAITLIST_SOURCES.DESK,
      by: getCurrentUserEmail() || '',
      reason: String(args.reason || '')
    })) {
      const why = String(rowValues[map['Program_Status']] || '').trim();
      return {
        ok: false,
        message: `⚠️ ${name} is already ${why ? why.toLowerCase() : 'not on the list'} for ` +
          `${selection.title || 'that program'} on ${target.date ? formatDateLabel(target.date) : 'that date'} — ` +
          `nothing was changed.`
      };
    }
    sheet.getRange(target.sheetRow, 1, 1, numCols).setValues([rowValues]);
    invalidateSectionedRowsCache(sheet);
    // The seat and the meal go back NOW, not at the next hourly sync — a desk
    // waitlists somebody because the room is full, and the number it is full
    // against is the one on the dashboard in front of them.
    try {
      const settled = getSectionedRows(sheet, headers, 'Event_ID');
      const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
      if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, settled);
      updateMasterLunchDashboard(settled);
    } catch (err) {
      log(`⚠️ Waitlisted ${name}, but could not recalculate the counts (${err}) — the hourly sync will.`);
    }
    const waitlisted = `✅ ${name} moved to the waitlist for ${selection.title || 'that program'} — ` +
      `${target.date ? formatDateLabel(target.date) : 'that date'}. Their seat and their lunch have gone ` +
      `back.${movedNote}`;
    toastIfPossible(waitlisted);
    log(`applyQuickMarkFromDialog: ${waitlisted}`);
    return Object.assign({ ok: true, message: waitlisted, namesChanged: false }, moveResultFor(moveTime, {
      bookedTime: appointmentTime, freedTime: bookedTime, name
    }));
  }

  if (attended) sheet.getRange(target.sheetRow, map['Attended'] + 1).setValue(true);
  // Signing an existing registration up for lunch changes only the two lunch
  // columns. Attended is deliberately left exactly as it is: whether they were
  // here is a separate fact from whether they want feeding, and a sign-up made
  // days ahead knows nothing about it either way.
  if (signup) {
    if (map['Lunch_Status'] !== undefined) {
      sheet.getRange(target.sheetRow, map['Lunch_Status'] + 1).setValue('Needed');
    }
    if (map['Lunch_Type'] !== undefined) {
      sheet.getRange(target.sheetRow, map['Lunch_Type'] + 1).setValue(resolveWalkInLunchType(signupSession));
    }
    // Only ever WRITTEN UP, never down to a blank: one is the default the
    // dialog sends when nobody touched the box, and a desk signing somebody up
    // for the meal they already have four of must not quietly cancel three.
    if (map['Meals_Ordered'] !== undefined && mealsOrdered > 1) {
      sheet.getRange(target.sheetRow, map['Meals_Ordered'] + 1).setValue(mealsOrdered);
    }
  }
  if (lunch) {
    sheet.getRange(target.sheetRow, map['Lunch_Served'] + 1).setValue(true);
    // Lunch without Attended is the take-out case, and saying so has to be
    // able to UNDO an earlier mistaken attendance mark — otherwise the one
    // correction staff actually need is the one thing they cannot make here.
    if (!attended) sheet.getRange(target.sheetRow, map['Attended'] + 1).setValue(false);
    // The counts are ADDED to whatever the row already holds, not set over it.
    // A person comes back for a second meal an hour later, and the desk marks
    // the second handover the same way it marked the first; overwriting would
    // make the later, smaller number erase the earlier one.
    addQuickMarkMealCounts(sheet, map, target.sheetRow,
      { ateHere, tookHome, inFridge });
  }

  // Hand-marking is a manual edit — say so, the same as any other.
  if (map['Manual_Override'] !== undefined) {
    const overrideCell = sheet.getRange(target.sheetRow, map['Manual_Override'] + 1);
    const current = String(overrideCell.getValue() || '').trim();
    if (current === 'Auto-Synced' || current === '') overrideCell.setValue('Manually Edited');
  }
  // Everything above wrote cells on the Registrants tab, one at a time. Drop
  // the cached read of it before anything below looks at the roster again.
  invalidateSectionedRowsCache(sheet);

  // ALREADY REGISTERED. A tick on Register for somebody who has a row for this
  // session is not an error and not a second registration — it is somebody at
  // the desk who could not tell from the dropdown that the name was already
  // there. Say so, and still honour the standing tick beside it: "put her on
  // this one, and every one after it" is a perfectly ordinary thing to ask on
  // a day she happens to be booked for already.
  const standingNote = standing
    ? addStandingListMember({ title: selection.title, location, date: target.date }, name,
      { standingLunch })
    : '';
  // "She rang back to say she'd take an earlier slot after all" — recorded on
  // the row she already has, which is the whole use of a second call.
  let earlierNote = '';
  if (earlierAppointment && map['Earlier_Appointment'] !== undefined) {
    sheet.getRange(target.sheetRow, map['Earlier_Appointment'] + 1).setValue(earlierAppointment);
    invalidateSectionedRowsCache(sheet);
    earlierNote = ' Marked to be called if an earlier appointment opens up.';
  }
  const moveResult = moveResultFor(moveTime, { bookedTime: appointmentTime, freedTime: bookedTime, name });

  if (register && !attended && !lunch && !signup && !moveTime) {
    const already = `✅ ${name} is already registered for ${selection.title || 'that program'} on ` +
      `${target.date ? formatDateLabel(target.date) : 'that date'} — nothing to add.` +
      `${earlierNote}${standingNote}`;
    toastIfPossible(already);
    return { ok: true, message: already, namesChanged: false };
  }

  // A move ON ITS OWN, with nothing ticked beside it. Said in its own words
  // rather than through describeQuickMark(), which has no vocabulary for it.
  if (moveTime && !attended && !lunch && !signup) {
    const moveOnly = `✅ ${name} — ${bookedTime} → ${appointmentTime}, ` +
      `${target.date ? formatDateLabel(target.date) : 'that date'}.${earlierNote}${standingNote}`;
    toastIfPossible(moveOnly);
    log(`applyQuickMarkFromDialog: ${moveOnly}`);
    return Object.assign({ ok: true, message: moveOnly, namesChanged: false }, moveResult);
  }

  const dateLabel = target.date ? formatDateLabel(target.date) : 'an undated session';
  const extra = candidates.length > 1 ? ` (${candidates.length} sessions matched — marked the nearest)` : '';
  const what = describeQuickMark(attended, lunch, signup);
  // The standing facts about this person land on the row they were marked on,
  // so the roster and the kitchen list carry them without anybody re-typing —
  // see stampRegularNeedsOnRow().
  const needsNote = stampRegularNeedsOnRow(sheet, map, target.sheetRow, regularNeedsFor(readRegularNeedRows(), {
    name, location, title: selection.title, date: target.date
  }));
  // A SIGN-UP CHANGES THE ORDER, so the dashboard is rebuilt straight away —
  // the same rule Lunch_Status edits on the tab itself follow, and for the
  // same reason. Lunch_Served ticks deliberately do NOT (see
  // recalculateCateringCounts()), because they happen dozens of times an hour
  // at a desk and don't move the number anybody orders against. A sign-up is
  // the opposite on both counts: rare, and it is the number.
  if (signup) recalculateCateringCounts(sheet, map, target.sheetRow, 1);

  const message = `✅ ${name} — ${what}, ${dateLabel}${extra}.${movedNote}${needsNote}${earlierNote}${standingNote}`;
  toastIfPossible(message);
  log(`applyQuickMarkFromDialog: ${message}`);
  return Object.assign({ ok: true, message, namesChanged: false }, moveResult);
}

/**
 * What the dialog needs to keep its own copy of the slot list honest without
 * re-fetching it between two people in a queue: the slot now taken, the slot
 * now free, and which row moved. Empty when nothing moved, so a caller can
 * spread it into any result unconditionally.
 */
function moveResultFor(moved, args) {
  if (!moved) return {};
  return {
    movedTime: true,
    bookedTime: args.bookedTime,
    freedTime: args.freedTime,
    addedNameKey: normalizeNameKey(args.name)
  };
}

/**
 * Is `startLabel` already held by somebody else on the session `target` sits
 * on? Returns false, or the name holding it (true when the row has no name).
 *
 * Read straight off the tab rather than out of the Quick Mark index: the index
 * is a snapshot, and double-booking a chair is exactly the mistake a snapshot
 * would let through — two desks moving two people onto the same 11:30 in the
 * same minute. Under the same lock as the write it guards.
 */
function appointmentSlotTaken(sheet, map, target, startLabel, ignoreRow) {
  const wanted = appointmentStartLabelOf(startLabel);
  if (!wanted || !target.dateKey) return false;
  const eventId = String(sheet.getRange(target.sheetRow, map['Event_ID'] + 1).getValue() || '').trim();
  if (!eventId) return false;
  let held = false;
  getSectionZones(sheet, 'Event_ID').forEach(zone => {
    if (held) return;
    const count = zone.dataEnd - zone.dataStart + 1;
    if (count < 1) return;
    const values = sheet.getRange(zone.dataStart, 1, count, Math.max(sheet.getLastColumn(), 1)).getValues();
    values.forEach((row, i) => {
      if (held || zone.dataStart + i === ignoreRow) return;
      if (String(row[map['Event_ID']] || '').trim() !== eventId) return;
      // A cancelled row has released its slot — the whole reason staff cancel
      // one is so somebody else can have that time.
      const status = String(row[map['Program_Status']] || '').trim();
      if (status === 'Cancelled' || status === 'Superseded') return;
      if (appointmentStartLabelOf(row[map['Event_Time']]) !== wanted) return;
      held = String(row[map['Name']] || '').trim() || true;
    });
  });
  return held;
}

/**
 * The slots on the session a registrant row belongs to, so a moved
 * appointment can be written as the RANGE staff read ("11:30 AM – 12:00 PM")
 * rather than as a bare start time.
 *
 * Empty when the session table has nothing to say, and the caller then writes
 * the start label on its own — a move recorded roughly is better than a move
 * refused over its formatting.
 */
function appointmentSlotsForRow(sheet, map, target) {
  try {
    const eventId = String(sheet.getRange(target.sheetRow, map['Event_ID'] + 1).getValue() || '').trim();
    if (!eventId) return [];
    const dash = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (!dash) return [];
    const headers = HEADERS.All_Program_Sessions;
    const dashMap = getIndexMap(headers);
    const session = getSectionedRowValues(dash, headers, 'Event_ID')
      .filter(row => String(row[dashMap['Event_ID']] || '').trim() === eventId)[0];
    if (!session) return [];
    return buildAppointmentSlots(
      coerceDate(session[dashMap['Event_Date']]),
      dashMap['Event_End'] === undefined ? null : coerceDate(session[dashMap['Event_End']]),
      resolveSlotMinutes({ slotMinutes: Number(session[dashMap['Slot_Minutes']]) || 0 }));
  } catch (err) {
    log(`ℹ️ Could not read the slots for a moved appointment (${err}) — wrote the start time on its own.`);
    return [];
  }
}

/** One meal count off the dialog: a whole number, 0 for anything unreadable, capped like the field. */
function quickMarkCount(value) {
  const amount = Math.floor(Number(value) || 0);
  if (!(amount > 0)) return 0;
  return Math.min(amount, QUICK_MARK_MAX_MEAL_COUNT);
}

/**
 * Adds the desk's meal counts onto a registrant row — day-1 dined in, day-1
 * taken out, and meals left in the fridge.
 *
 * ADDED, NOT SET, for the reason the caller gives: a second handover later in
 * the same service is marked exactly like the first, and setting would make it
 * replace rather than extend. It also means a desk that ticks Lunch twice by
 * accident over-counts by one meal rather than silently losing three — the
 * safe direction, and a visible one, since the number is right there on the
 * row to correct.
 *
 * Nothing is written for a zero. A tick with all three boxes left alone still
 * means what it always meant: served, and the count comes off the paper sheet
 * later.
 */
function addQuickMarkMealCounts(sheet, map, sheetRow, counts) {
  const columns = [
    { header: 'Day1_Dined_In', amount: counts.ateHere },
    { header: 'Day1_Taken_Out', amount: counts.tookHome },
    { header: 'Meals_In_Fridge', amount: counts.inFridge }
  ];
  let written = 0;
  columns.forEach(entry => {
    if (!(entry.amount > 0) || map[entry.header] === undefined) return;
    const cell = sheet.getRange(sheetRow, map[entry.header] + 1);
    // A legacy TICKED fridge checkbox is not a count of one — same rule
    // readRegistrantMealCounts() applies, and the same reason: the old column
    // meant something else entirely and must not be added to.
    const current = cell.getValue();
    const existing = isLegacyFridgeCheckbox(current) ? 0 : (Number(current) || 0);
    cell.setValue(existing + entry.amount);
    invalidateSectionedRowsCache(sheet);
    written += entry.amount;
  });
  return written;
}

/**
 * One phrasing for what a Quick Mark did, used in the toast, the log, the
 * walk-in confirmation and the row's own Admin_Notes — so the desk reads the
 * same words in all four places.
 *
 * `signup` and `lunch` are mutually exclusive by the time they get here (see
 * applyQuickMarkFromDialog()): one is a meal expected, the other a meal
 * already handed over.
 */
function describeQuickMark(attended, lunch, signup, register, waitlist) {
  // FIRST, because it is the one state that contradicts every line below it
  // rather than adding to them — and by the time this is called the
  // combinations that would have made it ambiguous have already been refused.
  if (waitlist) return 'added to the waitlist';
  if (attended && lunch) return 'attended + lunch';
  if (attended && signup) return 'attended + signed up for lunch';
  if (lunch) return 'lunch (collected, not attending)';
  if (signup) return 'signed up for lunch (not served yet)';
  if (attended) return 'attended';
  // Register on its own: on the list, nothing marked. Last, because every
  // combination above says something more specific about the same row.
  if (register) return 'registered (nothing marked yet)';
  return 'attended';
}

/**
 * The walk-in path: someone is standing there, they are not on the list for
 * this session, and marking them has to be possible without a form submission.
 *
 * Creates a "Manually Added" registrant row against the chosen session (or,
 * for a dateless choice, the nearest one — today first, then the next
 * upcoming, then the most recent past) and marks it. Manually Added is a
 * protected state: see getProtectedRegistrantKeys(), which is what stops the
 * next registration sync from overwriting or removing the row.
 *
 * Asks first. It writes a person into the record and, if the row is for a
 * lunch-serving date, into the catering count — small, but not something to do
 * because a button was clicked by accident.
 */
function addQuickMarkWalkIn(sheet, args) {
  const { name, selection, location, attended, lunch, signup, register, waitlist, standing, standingLunch } = args;
  const appointmentTime = String(args.appointmentTime || '').trim();
  const earlierAppointment = String(args.earlierAppointment || '').trim();
  const program = selection ? selection.title : '';

  if (!program) {
    return { ok: false, message: `⚠️ "${name}" has no registration yet. Pick a session and mark again to add them as a walk-in.` };
  }

  const session = selection.lunchOnly
    ? buildLunchOnlySession(selection.dateKey, location)
    : findNearestSessionForProgram(program, location, selection.dateKey);
  if (!session) {
    const when = selection.dateKey ? ` on ${formatDateLabel(parseDateKey(selection.dateKey))}` : '';
    return {
      ok: false,
      message: `⚠️ Couldn't find any session of "${program}"${location ? ` at ${location}` : ''}${when} ` +
        `to add "${name}" to. Run Sync Cal if the program is new.`
    };
  }

  const lunchOffered = isLunchOfferedOn(session.date, session.location);
  const dateLabel = formatDateLabel(session.date);
  const what = describeQuickMark(attended, lunch, signup, register, waitlist);

  // AN APPOINTMENT IS A CHAIR AT A TIME, not a place in a room (see
  // ASSISTANCE_TAG), so a desk booking one has to name the slot exactly as the
  // public form makes a registrant name it — and the slot has to still be
  // free, checked HERE under the lock rather than trusted from the dialog's
  // snapshot. Two people in one chair is the failure this whole tag exists to
  // prevent, and the desk is now a second way to cause it.
  let slot = null;
  if (session.isAssistance && standing) {
    return {
      ok: false,
      message: `⚠️ "${program}" is booked by appointment, so nobody can be put on a standing list for it — ` +
        `each appointment is booked one at a time. Untick "every future session" and mark again.`
    };
  }
  // AN APPOINTMENT HAS NO WAITLIST TO JOIN. A place on one is a chair at a
  // named time, and a row holding one IS the booking — writing a waitlisted
  // row against a slot would take the slot out of the form's list for
  // somebody who does not have it. The office keeps an appointment waiting
  // list the way it always has: Earlier_Appointment on a booking they do hold.
  if (session.isAssistance && waitlist) {
    return {
      ok: false,
      message: `⚠️ "${program}" is booked by appointment, so there is no waitlist to add "${name}" to — ` +
        `each time is booked one at a time. Book them a free slot instead, and tick "call if an earlier ` +
        `one opens up".`
    };
  }
  if (session.isAssistance) {
    const taken = readBookedAppointmentTimes(getSectionedRows(sheet, HEADERS.All_Registrants, 'Event_ID'));
    const free = buildAppointmentSlots(session.date, session.end, resolveSlotMinutes(session))
      .filter(s => !(taken[session.eventId] || new Set()).has(s.startLabel));
    if (!appointmentTime) {
      return {
        ok: false,
        message: free.length
          ? `⚠️ "${program}" is booked by appointment — pick a time as well (${free.length} free on ${dateLabel}).`
          : `⚠️ Every appointment for "${program}" on ${dateLabel} is taken. Nothing was added.`
      };
    }
    slot = free.filter(s => s.startLabel === appointmentTime)[0] || null;
    if (!slot) {
      return {
        ok: false,
        message: `⚠️ The ${appointmentTime} appointment on ${dateLabel} has just been taken — reload the ` +
          `lists (↻) and pick another time. Nothing was added.`
      };
    }
  }

  // A sign-up for a date with no meal on it is the one case worth refusing
  // outright rather than warning about. The row would carry Lunch_Status =
  // Needed, the dashboard would raise "lunch needed with no menu set", and the
  // person at the desk would walk away believing a meal was booked. Whoever is
  // standing there can be told now, while it can still be fixed.
  if (signup && !lunchOffered) {
    return {
      ok: false,
      message: `⚠️ No lunch is scheduled at ${session.location} on ${dateLabel}, so "${name}" can't be ` +
        `signed up for one. Add a Hot or Cold row for that date on ${SHEET_NAMES.LUNCH_SCHEDULE} first.`
    };
  }

  // THE CONFIRMATION IS THE DIALOG'S, not a ui.alert(). Apps Script will not
  // put an alert up while a modal dialog is already open, so asking from here
  // — which is exactly where this runs, inside a google.script.run call from
  // Quick Mark — is a question nobody ever sees. Instead the first call
  // returns the question and the dialog asks it, then calls back with
  // confirmed:true. Same guard, somewhere it can actually be answered.
  if (!args.confirmed) {
    return {
      ok: false,
      needsConfirm: true,
      message: `"${name}" has no registration for ${program}.`,
      question: `"${name}" has no registration for ${program}.\n\n` +
        `Add a new row for ${program} — ${dateLabel}${slot ? ` at ${slot.rangeLabel}` : ''} ` +
        `(${session.location}), marked ${what} and flagged "Manually Added"?` +
        (standing ? `\n\nThey will also be kept on the list for every future ${program}` +
          (standingLunch ? ', with a lunch on each of those dates.' : '.') : '') +
        (lunch && !lunchOffered ? '\n\nNote: no lunch is scheduled for that date, so no meal will be counted.' : '')
    };
  }

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const row = new Array(headers.length).fill('');
  row[map['Event_Date']] = session.date;
  // The SLOT's own times on an appointment booking, the session's span on
  // everything else. The registrant row's Event_Time IS the appointment: it is
  // what the provider's list is built from, and what stops the form offering
  // that time to the next person (readBookedAppointmentTimes()).
  row[map['Event_Time']] = slot ? slot.rangeLabel : (session.eventTime || '');
  row[map['Location']] = session.location;
  row[map['Event']] = session.title;
  row[map['Name']] = name;
  // A walk-in takes its marks from the same two ticks an existing row does:
  // Lunch on its own feeds somebody without recording them as present, which
  // is how a take-out pickup can add a person to the record for the first time.
  row[map['Attended']] = attended;
  row[map['Lunch_Served']] = lunch;
  // Whatever the desk was given. Blank on every call that has none, which is
  // exactly what the column held before — never a placeholder, since an empty
  // Email is read as "we have no address" all over this file and a "-" is not.
  if (map['Phone'] !== undefined && args.phone) row[map['Phone']] = String(args.phone).trim();
  if (map['Email'] !== undefined && args.email) row[map['Email']] = String(args.email).trim();
  // USUALLY 'Attendee'. A registration typed at the desk for somebody's GUEST
  // carries 'Guest' and the member's name instead, which is the same shape a
  // form response produces (buildResponsePeople()) — and what keeps the guest
  // folded under the member on the door list rather than printed as a stranger
  // of their own (nestCheckInGuests()).
  const personType = String(args.personType || '').trim() || 'Attendee';
  row[map['Person_Type']] = personType;
  // Wants a meal, whether it has been handed over yet (lunch) or not (signup):
  // both are Lunch_Status = Needed, and Lunch_Served above is the only thing
  // that separates them.
  const wantsLunch = (lunch || signup) && lunchOffered;
  row[map['Lunch_Type']] = wantsLunch ? resolveWalkInLunchType(session) : 'No Lunch';
  row[map['Lunch_Status']] = wantsLunch ? 'Needed' : 'No Lunch';
  // HOW MANY MEALS this new row is for, and what became of them. The order
  // side is the number the desk typed; the consumption side is only written
  // when the desk actually counted something out, so a plain Lunch tick still
  // means what it always meant. Both go on at row-creation time rather than
  // through addQuickMarkMealCounts(), since there is nothing here to add to.
  const walkInMeals = quickMarkCount(args.mealsOrdered);
  writeMealsOrdered(row, map, wantsLunch ? walkInMeals : 0);
  [['Day1_Dined_In', args.ateHere], ['Day1_Taken_Out', args.tookHome],
    ['Meals_In_Fridge', args.inFridge]].forEach(pair => {
    const amount = quickMarkCount(pair[1]);
    if (amount > 0 && map[pair[0]] !== undefined) row[map[pair[0]]] = amount;
  });
  // WAITLISTED FROM BIRTH, when that is what the desk asked for. Written here
  // rather than stamped afterwards because there is nothing to stamp yet: the
  // four cells a waitlisting sets (see stampRegistrantRowWaitlisted()) are four
  // cells this row is being given for the first time, and Lunch_Status /
  // Lunch_Type above are corrected in the same breath — nobody on a waitlist
  // has a meal on order.
  row[map['Program_Status']] = waitlist ? 'Waitlisted' : 'Active';
  if (waitlist) {
    row[map['Lunch_Status']] = 'Waitlisted';
    writeMealsOrdered(row, map, 0);
  }
  // "Ring me if something opens up sooner" — the fact staff used to keep in a
  // note. See EARLIER_APPOINTMENT_CHOICES.
  if (map['Earlier_Appointment'] !== undefined && earlierAppointment) {
    row[map['Earlier_Appointment']] = earlierAppointment;
  }
  row[map['Primary_Registrant']] = String(args.primaryRegistrant || '').trim() || 'Self';
  row[map['Party_Size']] = 1;
  const how = waitlist ? 'Added to the waitlist at the desk'
    : (signup ? 'Lunch sign-up'
      : (lunch && !attended ? 'Take-out walk-in'
        : (register && !attended ? (slot ? 'Appointment booked at the desk' : 'Registered at the desk') : 'Walk-in')));
  // The standing facts about this person, on the row from the moment it
  // exists — a walk-in is exactly the case where nobody has had a chance to
  // read them off anything else. See stampRegularNeedsOnRow(), which does the
  // same for a row that already existed; here the cell is being written for
  // the first time, so it is one string rather than an edit.
  const walkInNeeds = regularNeedsFor(readRegularNeedRows(), {
    name, location: session.location, title: session.title, date: session.date
  }).filter(need => need.autoNote !== false);
  row[map['Admin_Notes']] = [
    `${how} added at the desk on ${formatDateLabel(new Date())}.`,
    ...walkInNeeds.map(need => `🔔 ${describeRegularNeed(need)}`)
  ].join(' · ');
  row[map['Manual_Override']] = 'Manually Added';
  row[map['Form_Source']] = waitlist
    ? 'Front desk waitlist (no form)'
    : (register && !attended && !lunch)
    ? 'Front desk registration (no form)'
    : (signup ? 'Front desk sign-up (no form)' : 'Walk-in (no form)');
  row[map['Event_ID']] = session.eventId;

  // Somebody standing at the desk outranks a past deletion of the same person
  // on the same session — lift the tombstone rather than leave the next sync
  // arguing with the row just typed in. See section 5c.
  clearRegistrantTombstones(registrantTombstoneKey(session.eventId, name, personType));

  const existing = getSectionedRows(sheet, headers, 'Event_ID');
  existing.push(row);
  renderRegistrantsSheet(false, existing);

  // Same rule as the existing-row path above: a sign-up is a meal that now has
  // to be ordered, so the dashboard and the roster are rebuilt now rather than
  // at the next hourly sync. Rebuilt from `existing`, which already carries
  // the row just added, so no re-read is needed.
  if (signup) updateMasterLunchDashboard(existing);

  const standingNote = standing ? addStandingListMember(session, name, { standingLunch }) : '';
  const message = (waitlist
    ? `✅ ${name} added to the waitlist for ${program} — ${dateLabel}, ${session.location}. ` +
      `They hold no seat and no meal is ordered; staff take them off the waitlist on the Registrants tab ` +
      `when one comes free.`
    : (signup
      ? `✅ ${name} signed up for lunch on ${dateLabel} (${program}, ${session.location}) — new row added.`
      : (register && !attended && !lunch
        ? `✅ ${name} registered for ${program} — ${dateLabel}${slot ? ` at ${slot.rangeLabel}` : ''}, ${session.location}.` +
          (earlierAppointment ? ' They will be called if an earlier appointment opens up.' : '')
        : `✅ ${name} added as a walk-in on ${program} — ${dateLabel}, ${what}.`))) + standingNote +
    (walkInNeeds.length ? ` Noted: ${walkInNeeds.map(describeRegularNeed).join('; ')}.` : '');
  toastIfPossible(message);
  log(`addQuickMarkWalkIn: ${message}`);
  // A row that did not exist a moment ago is a name and possibly a whole
  // session that the stored lists do not have. The open dialog patches its own
  // copy (namesChanged, below); the STORED copy is dropped so the next dialog
  // to open — this person's, or the next volunteer's — rebuilds rather than
  // being handed a list with the walk-in missing from it.
  invalidateQuickMarkIndexCache();
  // The name list for this session has a new entry on it now. The normalized
  // key travels with it so the dialog can add the name to the list it is
  // already holding, under the same identity rule this file uses everywhere,
  // instead of re-fetching the list or guessing at the rule in browser JS.
  return {
    ok: true, message, namesChanged: true, addedName: name, addedNameKey: normalizeNameKey(name),
    // So the dialog can take the slot out of its own list without re-fetching
    // it — the next person in the queue must not be offered the chair that was
    // just filled.
    bookedTime: slot ? slot.startLabel : ''
  };
}

/**
 * Puts one person on a program's STANDING LIST from the desk, and says in
 * one short clause what happened — appended to whatever message the mark
 * itself produced, because it is a rider on that action rather than an action
 * of its own.
 *
 * WHY THIS EXISTS. Plenty of people have come to the same class every week
 * since 2015 and have never filled in a registration form in their lives; the
 * instructors who email them need the list to be right anyway. The form's club
 * option (see CLUB_TAG) already promises exactly this — "sign up once and stay
 * on the list" — so the answer is not a second mechanism but the same one,
 * reachable by staff: a Club_Members row, which applyClubRosterCatchup() books
 * into every future session of the program, and which staff take somebody
 * off by unticking Active.
 *
 * IT DOES NOT NEED THE PROGRAM TO BE TAGGED [Club]. That tag decides whether
 * the public FORM offers to join; a standing place added at the desk is a
 * decision staff have already made, and refusing it because a calendar
 * description lacks a word would leave the Zoom classes — the whole reason
 * this was asked for — unable to have one.
 *
 * WITH OR WITHOUT A LUNCH — options.standingLunch, which is the desk's answer
 * to "a place every time, or a place and a meal every time?". It is written to
 * the roster row's own Lunch column, which is where the fact belongs: staff
 * can see it, change it on the tab, and applyClubRosterCatchup() reads it back
 * on every booking it makes. Nothing here books a meal directly.
 *
 * Failure is reported, never thrown: the registration this rides on has
 * already been written, and losing it to a roster problem would be a much
 * worse outcome than a message saying the standing part did not take.
 */
function addStandingListMember(session, name, options) {
  const wantsLunch = !!(options && options.standingLunch);
  // Both are in CLUB_LUNCH_OPTIONS, which is the Lunch column's own validation
  // list — a value outside it would be written and then flagged as invalid on
  // the tab the moment somebody looked at it.
  const lunchType = wantsLunch ? 'Yes - Lunch' : 'No Lunch';
  try {
    const title = String((session && session.title) || '').trim();
    const location = String((session && session.location) || '').trim();
    if (!title) return ' (no program name, so no standing place was added)';

    // An [All Locations] program's roster is one list, not one per room, so
    // the key has to be scoped the same way the form's own club joins scope it
    // — which is decided by the form the sessions share.
    let formId = String((session && session.formId) || '').trim();
    if (!formId) {
      const found = findNearestSessionForProgram(title, location, '');
      // The walk-in path refuses this before it gets here; this is the other
      // caller, where the person already had a registration and the program
      // was never looked up. Same rule, same reason — see
      // applyClubRosterCatchup().
      if (found && found.isAssistance) {
        return ` (${title} is booked by appointment, so there is no standing list for it.)`;
      }
      formId = found ? found.formId : '';
    }
    const clubKey = computeClubKey(title, location, formId ? getSharedFormIdSet().has(formId) : false);
    if (!clubKey) return ' (no standing place was added)';

    const result = upsertClubMembers([{
      clubKey,
      club: title,
      location,
      name,
      personType: 'Attendee',
      primaryRegistrant: 'Self',
      lunchType,
      // SAID AT THE DESK, JUST NOW, by somebody with the person in front of
      // them — so it outranks whatever the row already said, which a form
      // re-submission deliberately does not. See upsertClubMembers().
      lunchTypeFromDesk: true,
      source: 'Added at the front desk'
    }]);
    const meals = wantsLunch ? ', with a lunch each time' : '';
    if (result.added > 0) return ` They are now on the standing list for every future ${title}${meals}.`;
    if (result.reactivated > 0) return ` They are back on the standing list for every future ${title}${meals}.`;
    if (result.lunchChanged > 0) {
      return wantsLunch
        ? ` They were already on the standing list for ${title}, and will now get a lunch each time.`
        : ` They were already on the standing list for ${title}; their standing lunch has been taken off.`;
    }
    return ` They were already on the standing list for ${title}${meals}.`;
  } catch (err) {
    log(`addStandingListMember: could not add "${name}" to a standing list (${err}).`);
    return ` (their registration is saved, but the standing list could not be updated — ${err})`;
  }
}

/**
 * The synthetic "session" a lunch-only walk-in is recorded against: a real
 * date and location, no calendar event, and an Event_ID that says so (see
 * makeLunchOnlyEventId()). Everything downstream keys off date+location
 * anyway, so the meal is counted exactly like a program-day meal.
 */
function buildLunchOnlySession(dateKey, location) {
  const key = dateKey || formatDateKey(new Date());
  const loc = String(location || '').trim();
  if (!loc) return null; // a meal has to belong to a kitchen
  const date = parseDateKey(key);
  return {
    date,
    dateKey: key,
    location: loc,
    title: lunchOnlyRowTitle(loc, key),
    eventId: makeLunchOnlyEventId(key, loc),
    // No calendar event behind it, so no clock time to show.
    eventTime: '',
    lunchType: ''
  };
}

/**
 * A session of `program`: the one on `wantedDateKey` when the Quick Mark
 * choice named a date, else the one nearest to today (today, else the soonest
 * upcoming, else the most recent past). Read from the session table, which is
 * the only place an Event_ID (the key every registrant row is joined on)
 * can come from.
 */
function findNearestSessionForProgram(program, location, wantedDateKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!dash) return null;

  const headers = HEADERS.All_Program_Sessions;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const wanted = normalizeNameKey(program);

  const matches = [];
  getSectionedRows(dash, headers, 'Event_ID').forEach(row => {
    if (normalizeNameKey(row[map['Clean_Title']]) !== wanted) return;
    const rowLocation = String(row[map['Location']] || '').trim();
    if (location && rowLocation !== location) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    if (wantedDateKey && formatDateKey(date) !== wantedDateKey) return;
    matches.push({
      date,
      dateKey: formatDateKey(date),
      location: rowLocation,
      title: String(row[map['Clean_Title']] || '').trim(),
      eventId: String(row[map['Event_ID']] || '').trim(),
      eventTime: formatTimeRange(date, map['Event_End'] === undefined ? '' : row[map['Event_End']]),
      // The four facts a DESK booking needs beyond a walk-in's: where the
      // session ends and how long one slot is (to cut its appointments),
      // whether it is booked by appointment at all, and which form covers it
      // — the last because a standing place is filed under a key that is
      // scoped differently for an [All Locations] program (computeClubKey()).
      end: map['Event_End'] === undefined ? null : coerceDate(row[map['Event_End']]),
      slotMinutes: map['Slot_Minutes'] === undefined ? 0 : (Number(row[map['Slot_Minutes']]) || 0),
      isAssistance: map['Personalized_Assistance'] !== undefined &&
        isAssistanceColumnValue(row[map['Personalized_Assistance']]),
      formId: String(row[map['Form_ID']] || '').trim(),
      lunchType: ''
    });
  });
  if (matches.length === 0) return null;

  matches.sort((a, b) => {
    const rank = c => (c.dateKey === todayKey ? 0 : (c.dateKey > todayKey ? 1 : 2));
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 2) return b.date - a.date; // past: newest first
    return a.date - b.date;                    // future: soonest first
  });
  return matches[0];
}

/**
 * A session's time as staff say it out loud: "10:00 AM – 11:30 AM".
 *
 * Falls back to the start time alone when there is no end — a row written
 * before Event_End existed, or a calendar event with no duration. Returns ''
 * for no start at all, so a blank cell stays blank rather than becoming a
 * confident-looking wrong answer.
 */
function formatTimeRange(start, end) {
  const from = coerceDate(start);
  if (!from) return '';
  const label = formatTimeLabel(from);
  const to = clockTimeOnDayOf(coerceDate(end), from);
  if (!to || to <= from) return label;
  return `${label} – ${formatTimeLabel(to)}`;
}

/**
 * An end time that is a CLOCK TIME rather than a moment — 30 Dec 1899, 11:30 —
 * moved onto the day its session actually runs. Anything else is handed back
 * untouched.
 *
 * A cell holding only a time is how Sheets stores one, so an Event_End that has
 * been retyped by a person (or coerced from text) reads back dated to the 1899
 * epoch. Compared against a real session start it is always EARLIER, so the
 * range collapsed to the start alone — "10:00 AM" — which is precisely the
 * lone time-like string Sheets then ate back into another 1899 value. Reading
 * it as the clock time it plainly is keeps the range, and keeps the column
 * showing a time range rather than a date.
 */
function clockTimeOnDayOf(time, day) {
  if (!time || !day || time.getFullYear() >= 1900) return time;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(),
    time.getHours(), time.getMinutes(), time.getSeconds());
}

/**
 * One clock time, the way this workbook writes clock times everywhere:
 * "10:00 AM". Returns '' for anything that is not a date, so a blank stays
 * blank rather than becoming "Invalid Date".
 *
 * One implementation because there were three, spelled identically and free to
 * drift: the range above, the appointment slot labels, and the time-block
 * merge all say the same thing to the same person on the same screen.
 */
function formatTimeLabel(value) {
  const date = coerceDate(value);
  return date ? Utilities.formatDate(date, TIMEZONE, 'h:mm a') : '';
}

/**
 * An Event_Time cell as the words it is meant to hold — "10:00 AM",
 * "10:00 AM – 11:30 AM" — whatever shape the cell has ended up in.
 *
 * WHY A DATE EVER COMES BACK OUT OF THIS COLUMN. Event_Time is written as
 * text, but a session with no end time (or one whose stored end is not after
 * its start) writes the START ALONE — "10:00 AM" — and Sheets coerces a cell
 * that merely LOOKS like a time into a real time value, whose date part is the
 * epoch Sheets counts from: 30 Dec 1899. The cell then reads back as a Date,
 * and under a date number format it SHOWS as "12/30/1899" beside a perfectly
 * correct Event_Date. It is the same coercion setEventTimeFormulas() exists to
 * dodge on the session table, arriving on the registrant rows by the one route
 * that tab has: a single time with no range around it.
 *
 * Both halves of that are fixed at the source — the column is stamped as plain
 * text before the rows are written (see writeUpcomingPastSections()) — but
 * every workbook that has been running since before this has cells already
 * coerced, and everything that READS a time (the appointment slot match, the
 * provider list, the instructor sheet) has to keep working on those. Turning
 * the Date back into its label is all that takes, and it is what heals the
 * cell: the next render writes the label back as text.
 */
function eventTimeLabelOf(value) {
  // Duck-typed rather than `instanceof Date`: a value that came out of a cell
  // is a date if it behaves like one, and the identity check is the sort of
  // thing that quietly stops being true across a realm boundary.
  if (value && typeof value.getMonth === 'function') return formatTimeLabel(value);
  return String(value === null || value === undefined ? '' : value).trim();
}

/** Hot/Cold for a walk-in's meal, taken from that day's menu; 'Hot' if the menu says nothing. */
function resolveWalkInLunchType(session) {
  const info = getMealInfoForDate(session.date, session.location);
  const type = info ? String(info.type || '').trim() : '';
  return (type === 'Hot' || type === 'Cold') ? type : 'Hot';
}

