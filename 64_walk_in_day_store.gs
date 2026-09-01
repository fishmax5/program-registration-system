// ============================================================================
// 16d. THE SIGN-IN APP'S BOOT SNAPSHOT  (what the tablet draws before it asks)
// ============================================================================
// Section 16b built the door's sign-in page and said, in as many words, that
// NOTHING ON IT IS CACHED — a snapshot of who has already signed in is the one
// thing a door must not show. That is still true of what the page ENDS UP
// showing. It was never true of what it shows FIRST.
//
// WHAT BOOTING COST BEFORE THIS. doGet() served a page with no data in it at
// all, and the page's first act was one round trip to walkInDay(), which is
// two passes over sectioned tabs (the program dashboard and a year of
// registrant rows) plus the whole Member_Roll. Until that answered — seconds,
// on a busy workbook, on a tablet's wifi — the volunteer had a blue header, an
// empty page and the word "Reading...". Every morning, and again every time
// somebody woke the tablet and it reloaded.
//
// WHAT REPLACES IT. The same day, read on a trigger with nobody standing
// there, kept in CacheService with a durable copy in Script Properties, and
// INLINED INTO THE PAGE doGet() serves. The tablet therefore has its locals —
// the programs, the people, the meal, the roll for the search box — in the
// first byte of the document. It draws them before it has asked anything, and
// then calls walkInDay() in the background, silently, and swaps the fresh
// answer in underneath. There is no spinner and no wait on the boot path:
// the round trip still happens, it just is not what the volunteer is watching.
//
// STALENESS IS THE POINT, AND IT IS BOUNDED IN ONE PLACE. What is inlined is
// by definition a few minutes old, so:
//
//   - It is only ever served FOR THE DAY IT WAS BUILT ON. A tablet left awake
//     overnight must not open on yesterday's programs with yesterday's
//     sign-ins ticked, which is a page that quietly records nothing. The date
//     key is checked on the way out and a stale-dated store is dropped.
//   - It is NOT INVALIDATED by the events that clear the roster store
//     (section 16c). That is deliberate. Those fire on every registration
//     change, all morning, and a boot snapshot cleared at 9:04 is a spinner at
//     9:05 — the exact failure this section exists to remove. A snapshot that
//     is one registration behind is corrected a second later by the sync the
//     page always runs; a snapshot that is not there cannot be.
//   - It is REFRESHED BY EVERY LIVE READ. walkInDay() has just paid for the
//     day; handing it to rememberWalkInDay() on the way out keeps the store
//     current all morning for whichever tablet boots next, at the cost of one
//     cache write on a call nobody is waiting on any more.
//
// THE ROLL IS STORED ONCE. Every location's day carries the same Member_Roll
// (readWalkInMembers(), up to WALK_IN_MAX_MEMBERS names), and a workbook with
// four buildings would otherwise keep four copies of it in a store that has to
// fit in chunked properties. It is lifted out on the way in and put back on
// the way out, which is invisible to every caller.
// ============================================================================

/** The shape of a stored day. Bump when readWalkInDay() grows a field the page uses. */
const WALK_IN_DAY_STORE_SCHEMA = 1;
const WALK_IN_DAY_STORE_CACHE_KEY = 'WALK_IN_DAY_STORE_V1';
const WALK_IN_DAY_STORE_PROP_KEY = 'WALK_IN_DAY_STORE_V1';

/**
 * HOW MUCH OF THE SNAPSHOT MAY RIDE INSIDE THE PAGE.
 *
 * Inlining is what makes the boot free, and it is also the one thing that can
 * make it worse: a document a tablet is still downloading is a blank screen
 * just like a spinner is. Past this many characters the roll — much the
 * largest part, and the part the page needs LAST (it is behind a search box on
 * the second half of the first screen) — is left out, and the background sync
 * brings it. The day itself always travels.
 */
const WALK_IN_BOOT_MAX_CHARS = 400000;

// ----------------------------------------------------------------------------
// The store
// ----------------------------------------------------------------------------

/** The lookup one building's day is filed under. */
function walkInDayStoreKey(location) {
  return String(location || '').trim();
}

/** Whether a stored blob is one THIS version of the script can serve. */
function isCurrentWalkInDayStore(store) {
  return !!store && store.schema === WALK_IN_DAY_STORE_SCHEMA && !!store.days;
}

/**
 * TODAY, AT EVERY BUILDING, in one pass per building.
 *
 * The same read the page makes (readWalkInDay()), made here instead — on a
 * trigger, with nobody standing at the door. A building whose read throws is
 * left out rather than taking the others down with it: a store missing one
 * location costs that location one slow boot, and no store at all costs every
 * location one.
 */
function buildWalkInDayStore() {
  const dateKey = formatDateKey(new Date());
  const days = {};
  let members = [];
  checkInLocations().forEach(location => {
    try {
      const day = readWalkInDay(location, dateKey);
      // The roll is the same list for every building — see the section note.
      if (day && day.members && day.members.length > members.length) members = day.members;
      if (day) delete day.members;
      days[walkInDayStoreKey(location)] = day;
    } catch (err) {
      log(`ℹ️ Could not pre-read the sign-in page's day for ${location} (${err}).`);
    }
  });
  return {
    schema: WALK_IN_DAY_STORE_SCHEMA,
    dateKey,
    builtAt: Utilities.formatDate(new Date(), TIMEZONE, 'h:mm a'),
    builtAtMs: new Date().getTime(),
    members,
    days
  };
}

/** Builds the day store and puts it in both places. */
function refreshWalkInDayStore() {
  const store = buildWalkInDayStore();
  writeWalkInDayStore(store);
  return store;
}

/**
 * Rebuilds the sign-in page's boot snapshot off the hot path.
 *
 * Called wherever the door's rosters are warmed, for the same reason and at
 * the same moment. Never allowed to throw: a snapshot that could not be built
 * costs one slow boot — the page still reads the day live — and a warmer that
 * broke a sync would be far worse.
 */
function warmWalkInDayStore() {
  try {
    const store = refreshWalkInDayStore();
    log(`warmWalkInDayStore: ${Object.keys(store.days).length} building(s) stored — ` +
      `the sign-in page draws today before it asks for it.`);
  } catch (err) {
    log(`ℹ️ Could not pre-build the sign-in page's day (${err}) — the page will read it on load.`);
  }
}

/**
 * ONE BUILDING'S FRESH DAY, FOLDED BACK INTO THE STORE.
 *
 * The live read has already happened and somebody has already been answered,
 * so this is pure profit for whichever tablet boots next. Merged rather than
 * written whole: one building being re-read is no reason for the other three
 * to fall out of the store and go back to booting slowly.
 *
 * Never throws — the caller is on its way to returning a page's data.
 */
function rememberWalkInDay(day) {
  try {
    if (!day || !day.location || !day.dateKey) return;
    const today = formatDateKey(new Date());
    // A day read for another date (the tests pass an override) is not what a
    // door boots on, and storing it would poison the date guard below.
    if (day.dateKey !== today) return;
    const existing = readWalkInDayStore();
    const store = (existing && existing.dateKey === today) ? existing : {
      schema: WALK_IN_DAY_STORE_SCHEMA,
      dateKey: today,
      members: [],
      days: {}
    };
    const copy = {};
    Object.keys(day).forEach(field => { copy[field] = day[field]; });
    if (copy.members) {
      if (copy.members.length) store.members = copy.members;
      delete copy.members;
    }
    store.days[walkInDayStoreKey(day.location)] = copy;
    store.builtAt = Utilities.formatDate(new Date(), TIMEZONE, 'h:mm a');
    store.builtAtMs = new Date().getTime();
    writeWalkInDayStore(store);
  } catch (err) {
    log(`ℹ️ Could not store the sign-in page's day (${err}).`);
  }
}

/** Stores the blob in the cache and in Script Properties. */
function writeWalkInDayStore(store) {
  const packed = packCachedText(JSON.stringify(store));
  const cache = tryGetScriptCache();
  if (cache) {
    try {
      const chunks = Math.ceil(packed.length / CHECK_IN_STORE_CACHE_CHUNK_CHARS);
      if (chunks > CHECK_IN_STORE_MAX_CACHE_CHUNKS) {
        log(`ℹ️ The sign-in page's day is too large to cache (${packed.length} chars).`);
      } else {
        const values = {};
        for (let i = 0; i < chunks; i++) {
          values[`${WALK_IN_DAY_STORE_CACHE_KEY}_${i}`] = packed.substring(
            i * CHECK_IN_STORE_CACHE_CHUNK_CHARS, (i + 1) * CHECK_IN_STORE_CACHE_CHUNK_CHARS);
        }
        if (chunks > 0) cache.putAll(values, CHECK_IN_STORE_CACHE_SECONDS);
        // The manifest LAST — see writeChunkedScriptProperty().
        cache.put(WALK_IN_DAY_STORE_CACHE_KEY, JSON.stringify({ chunks }),
          CHECK_IN_STORE_CACHE_SECONDS);
      }
    } catch (err) {
      log(`ℹ️ Could not cache the sign-in page's day (${err}).`);
    }
  }
  // The durable half. A cache entry expires in six hours and is dropped by a
  // redeploy, and the first tablet of the morning is exactly the one that
  // would find it gone — which is the boot this whole section is about.
  writeChunkedScriptProperty(WALK_IN_DAY_STORE_PROP_KEY, packed,
    CHECK_IN_STORE_PROP_CHUNK_CHARS, CHECK_IN_STORE_MAX_PROP_CHUNKS);
}

/**
 * The stored day — cache first, then Script Properties — or null.
 *
 * A store built on another date is dropped here rather than returned and
 * filtered later: it is the one thing that must never reach a door, and one
 * place to enforce that is how it stays enforced.
 */
function readWalkInDayStore() {
  const store = readCachedWalkInDayStore() || readPropertyWalkInDayStore();
  if (!store) return null;
  if (store.dateKey !== formatDateKey(new Date())) {
    // Yesterday's snapshot is not a smaller answer, it is a wrong one — and
    // leaving it in properties means carrying it until something overwrites it.
    clearWalkInDayStore();
    return null;
  }
  return store;
}

function readCachedWalkInDayStore() {
  const cache = tryGetScriptCache();
  if (!cache) return null;
  try {
    const manifest = cache.get(WALK_IN_DAY_STORE_CACHE_KEY);
    if (!manifest) return null;
    const chunks = (JSON.parse(manifest) || {}).chunks || 0;
    if (chunks < 1) return null;
    const keys = [];
    for (let i = 0; i < chunks; i++) keys.push(`${WALK_IN_DAY_STORE_CACHE_KEY}_${i}`);
    const parts = cache.getAll(keys);
    let packed = '';
    for (let i = 0; i < chunks; i++) {
      // A chunk can expire on its own, and half a store is not a store.
      if (parts[keys[i]] === undefined || parts[keys[i]] === null) return null;
      packed += parts[keys[i]];
    }
    const store = JSON.parse(unpackCachedText(packed));
    if (!isCurrentWalkInDayStore(store)) return null;
    store.fromCache = true;
    return store;
  } catch (err) {
    return null;
  }
}

function readPropertyWalkInDayStore() {
  try {
    const packed = readChunkedScriptProperty(WALK_IN_DAY_STORE_PROP_KEY);
    if (!packed) return null;
    const store = JSON.parse(unpackCachedText(packed));
    if (!isCurrentWalkInDayStore(store)) return null;
    store.fromProperties = true;
    return store;
  } catch (err) {
    log(`ℹ️ Could not read the stored sign-in day (${err}) — the page will read it on load.`);
    return null;
  }
}

/** Drops the stored day. Called on a date rollover and on a schema change. */
function clearWalkInDayStore() {
  clearChunkedScriptProperty(WALK_IN_DAY_STORE_PROP_KEY);
  const cache = tryGetScriptCache();
  if (!cache) return;
  try {
    const manifest = cache.get(WALK_IN_DAY_STORE_CACHE_KEY);
    cache.remove(WALK_IN_DAY_STORE_CACHE_KEY);
    const chunks = manifest ? ((JSON.parse(manifest) || {}).chunks || 0) : 0;
    const keys = [];
    for (let i = 0; i < chunks; i++) keys.push(`${WALK_IN_DAY_STORE_CACHE_KEY}_${i}`);
    if (keys.length) cache.removeAll(keys);
  } catch (err) { /* a cache is an optimization; never let it decide anything */ }
}

/**
 * ONE BUILDING'S STORED DAY, in the shape readWalkInDay() returns, with the
 * roll put back and `stale` set — or null when there is nothing stored for
 * today. Never a build and never a fallback: walkInDay() owns what happens
 * when this comes back empty.
 *
 * `stale` is not decoration. It is what the page's footer says out loud, and
 * what stops "Read at 9:02" being printed under a list that was read at 8:40.
 */
function storedWalkInDay(location) {
  const store = readWalkInDayStore();
  if (!store) return null;
  const day = store.days[walkInDayStoreKey(location)];
  if (!day) return null;
  const copy = {};
  Object.keys(day).forEach(field => { copy[field] = day[field]; });
  copy.members = store.members || [];
  copy.stale = true;
  copy.storedAt = store.builtAt || '';
  return copy;
}

/**
 * THE WHOLE SNAPSHOT THE PAGE IS SERVED WITH — every building's day and the
 * roll, or null when there is nothing stored for today.
 *
 * Every building, not just the pinned one, because a tablet with no ?location=
 * on its URL asks the volunteer which building they are in, and the tap that
 * answers that must not be a second wait. It is one cache read either way.
 *
 * Trimmed to WALK_IN_BOOT_MAX_CHARS by dropping the roll — see the constant.
 */
function walkInBootSnapshot() {
  try {
    const store = readWalkInDayStore();
    if (!store || !store.days) return null;
    const boot = {
      dateKey: store.dateKey,
      builtAt: store.builtAt || '',
      members: store.members || [],
      days: store.days
    };
    if (JSON.stringify(boot).length > WALK_IN_BOOT_MAX_CHARS) {
      boot.members = [];
      boot.membersDeferred = true;
    }
    return boot;
  } catch (err) {
    log(`ℹ️ Could not read the sign-in page's boot snapshot (${err}).`);
    return null;
  }
}
