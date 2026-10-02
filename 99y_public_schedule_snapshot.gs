// ============================================================================
// 99y. THE PUBLIC SCHEDULE, BUILT AHEAD  (so a stranger's page never waits)
// ============================================================================
//
// The two public pages (86/87 the calendar, 92/93 the weekly programs) are
// embedded on the centre's website, and every view of them used to pay for a
// read of the session tab whenever the five-minute cache had gone cold —
// which, on a site visited a few times an hour, was most views. A visitor on
// a phone waiting several seconds for a calendar is a visitor who leaves.
//
// So the snapshot is built AHEAD of anybody asking, and a page view only
// ever reads what was built:
//
//   1. buildScheduleSnapshot_() builds the one snapshot both pages are made
//      from (86's buildPublicProgramCalendar(), plus `builtAt`), and stores
//      it twice — in the script cache for PUBLIC_SNAPSHOT_CACHE_SECONDS, and
//      in a Drive file as the fallback a cold or evicted cache falls back to.
//   2. A time-driven trigger (refreshPublicScheduleSnapshot, every
//      PUBLIC_SNAPSHOT_TRIGGER_MINUTES) rebuilds it, and so does the end of
//      every calendar sync (90). writeTriggers() (16) installs the trigger
//      through resetTriggersForHandler(), which removes every copy before
//      creating one, so re-running it never doubles it; the hourly sync
//      re-installs it if it has gone missing (ensurePublicSnapshotTrigger_).
//   3. doGet inlines whatever getScheduleSnapshot_() returns; the page draws
//      that at once and asks getScheduleSnapshot() once in the background,
//      redrawing only if `builtAt` moved.
//
// WHY A DRIVE FILE AND NOT SCRIPT PROPERTIES for the fallback: two months of
// sessions at two buildings is well past 100KB of JSON, and Script Properties
// has 500KB for the WHOLE project — the ledger, the registries and the
// digest spool all live there. One file, overwritten in place, costs nothing
// against that quota.
//
// WHY THE CACHE IS CHUNKED: CacheService refuses a value over 100KB, which is
// the "Public calendar snapshot was not cached" note 86 used to log on every
// busy workbook — meaning that workbook was never cached at all.
//
// WHAT STALENESS COSTS. Seats. A session that fills is shown as open for at
// most one trigger interval, and the FORM is what refuses the booking — the
// page has never been the authority on a seat (86's banner). A snapshot from
// a previous DAY is never served: its first date is yesterday, so a stored
// one whose todayKey is not today is treated as missing and rebuilt live.
//
// Nothing here writes to the workbook, and the snapshot carries exactly the
// field list 86 pins — this file changes when it is built, not what is in it.
// ============================================================================

/** How long a built snapshot sits in the script cache (CacheService's max). */
const PUBLIC_SNAPSHOT_CACHE_SECONDS = 21600;

/** How often the trigger rebuilds it. Must be 1, 5, 10, 15 or 30 (everyMinutes). */
const PUBLIC_SNAPSHOT_TRIGGER_MINUTES = 10;

/** The trigger's handler — named here so writeTriggers() and the ensure share one spelling. */
const PUBLIC_SNAPSHOT_TRIGGER_HANDLER = 'refreshPublicScheduleSnapshot';

/** Cache chunk size, in characters. CacheService's per-value ceiling is 100KB. */
const PUBLIC_SNAPSHOT_CACHE_CHUNK_CHARS = 90000;

/** Script Property holding the Drive file id of the fallback copy. */
const PUBLIC_SNAPSHOT_FILE_PROP_KEY = 'PUBLIC_SCHEDULE_SNAPSHOT_FILE_V1';

/** The folder and file name of the fallback copy. */
const PUBLIC_SNAPSHOT_FOLDER_NAME = 'Public Schedule Snapshot';
const PUBLIC_SNAPSHOT_FILE_NAME = 'public-schedule-snapshot.json';

/**
 * `<anchor>/System/Public Schedule Snapshot` (`82`'s 82b). System-only: the
 * file is a cache the pages read by id, and nobody opens it by hand.
 */
function getOrCreatePublicScheduleSnapshotFolder() {
  return getOrCreateSystemFolder(PUBLIC_SNAPSHOT_FOLDER_NAME, null, { systemOnly: true });
}

/**
 * A Refresh press rebuilds live only if what is stored is older than this.
 * The page is anonymous and on a public website: without a floor, Refresh is
 * a button anybody can hold down to make the workbook read its session tab.
 */
const PUBLIC_SNAPSHOT_FRESH_MIN_AGE_MS = 60 * 1000;

/**
 * The cache key. TODAY'S DATE IS IN IT: the snapshot's first day is "today",
 * so one built at 11pm is wrong at midnight in a way no TTL catches.
 */
function publicSnapshotCacheKey_() {
  return `PUBLIC_SCHEDULE_V2|${formatDateKey(new Date())}`;
}

/**
 * BUILDS THE SNAPSHOT AND STORES IT. Returns the snapshot (with `builtAt`,
 * milliseconds since the epoch — the value the page compares), or the
 * { ok: false, message } answer 86 has always given for a workbook that
 * cannot be read. A failed build stores nothing, so the last good snapshot
 * goes on being served.
 */
function buildScheduleSnapshot_() {
  let snapshot;
  try {
    snapshot = buildPublicProgramCalendar();
  } catch (err) {
    log(`buildScheduleSnapshot_: could not read the sessions (${err}).`);
    return {
      ok: false,
      message: 'We could not read the program calendar just now. Please try again in a ' +
        'few minutes, or call the office.'
    };
  }
  snapshot.builtAt = Date.now();
  storeScheduleSnapshot_(snapshot);
  return snapshot;
}

/** Writes the snapshot to the cache (chunked) and the Drive fallback. Never throws. */
function storeScheduleSnapshot_(snapshot) {
  const json = JSON.stringify(snapshot);
  writeSnapshotToCache_(json);
  writeSnapshotToDrive_(json);
}

function writeSnapshotToCache_(json) {
  const cache = tryGetScriptCache();
  if (!cache) return false;
  try {
    const key = publicSnapshotCacheKey_();
    const values = {};
    let n = 0;
    for (let i = 0; i < json.length; i += PUBLIC_SNAPSHOT_CACHE_CHUNK_CHARS) {
      values[`${key}#${n}`] = json.slice(i, i + PUBLIC_SNAPSHOT_CACHE_CHUNK_CHARS);
      n++;
    }
    // The manifest goes in the same putAll as its chunks; a reader that finds
    // it and then misses a chunk (evicted separately) treats the whole entry
    // as missing rather than parsing half a snapshot.
    values[key] = String(n);
    cache.putAll(values, PUBLIC_SNAPSHOT_CACHE_SECONDS);
    return true;
  } catch (err) {
    log(`Public schedule snapshot was not cached (${err}).`);
    return false;
  }
}

function readSnapshotFromCache_() {
  const cache = tryGetScriptCache();
  if (!cache) return null;
  try {
    const key = publicSnapshotCacheKey_();
    const count = Number(cache.get(key));
    if (!count) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(`${key}#${i}`);
    const got = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < keys.length; i++) {
      if (typeof got[keys[i]] !== 'string') return null;
      json += got[keys[i]];
    }
    return JSON.parse(json);
  } catch (err) {
    log(`Public schedule cache read failed (${err}).`);
    return null;
  }
}

function writeSnapshotToDrive_(json) {
  try {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty(PUBLIC_SNAPSHOT_FILE_PROP_KEY);
    if (id) {
      try {
        DriveApp.getFileById(id).setContent(json);
        return true;
      } catch (err) {
        // Trashed or unreachable — make a new one below.
      }
    }
    const folder = getOrCreatePublicScheduleSnapshotFolder();
    const file = folder
      ? folder.createFile(PUBLIC_SNAPSHOT_FILE_NAME, json, 'application/json')
      : DriveApp.createFile(PUBLIC_SNAPSHOT_FILE_NAME, json, 'application/json');
    props.setProperty(PUBLIC_SNAPSHOT_FILE_PROP_KEY, file.getId());
    return true;
  } catch (err) {
    log(`Public schedule snapshot fallback was not saved to Drive (${err}).`);
    return false;
  }
}

function readSnapshotFromDrive_() {
  try {
    const id = PropertiesService.getScriptProperties().getProperty(PUBLIC_SNAPSHOT_FILE_PROP_KEY);
    if (!id) return null;
    return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString());
  } catch (err) {
    log(`Public schedule Drive fallback could not be read (${err}).`);
    return null;
  }
}

/** A stored snapshot is usable only if it was built for TODAY. */
function isUsableScheduleSnapshot_(snapshot) {
  return !!(snapshot && snapshot.ok !== false && snapshot.todayKey === formatDateKey(new Date()));
}

/**
 * THE READ EVERY PAGE VIEW MAKES: cache → Drive → build live once
 * (and store). `fresh` rebuilds, but only when what is stored is older than
 * PUBLIC_SNAPSHOT_FRESH_MIN_AGE_MS.
 */
function getScheduleSnapshot_(fresh) {
  let snapshot = readSnapshotFromCache_();
  if (!isUsableScheduleSnapshot_(snapshot)) {
    snapshot = readSnapshotFromDrive_();
    // Warm the cache from the fallback so the next view skips Drive.
    if (isUsableScheduleSnapshot_(snapshot)) writeSnapshotToCache_(JSON.stringify(snapshot));
  }
  if (!isUsableScheduleSnapshot_(snapshot)) return buildScheduleSnapshot_();
  if (fresh && !(Date.now() - Number(snapshot.builtAt || 0) < PUBLIC_SNAPSHOT_FRESH_MIN_AGE_MS)) {
    const rebuilt = buildScheduleSnapshot_();
    if (rebuilt && rebuilt.ok !== false) return rebuilt;
  }
  return snapshot;
}

/**
 * THE CALL BOTH PUBLIC PAGES MAKE after their first paint (google.script.run).
 * Payload: { mode: 'public' | 'regular', fresh }. Everything else is ignored —
 * this is reachable by anyone holding the link. Returns the page's own shape:
 * the calendar snapshot, or the weekly-programs fold of it.
 */
function getScheduleSnapshot(payload) {
  const args = (payload && typeof payload === 'string') ? safeParsePublicPayload_(payload)
    : (payload || {});
  return String(args.mode || '').toLowerCase() === 'regular'
    ? publicRegularPrograms({ fresh: !!args.fresh })
    : publicProgramCalendar({ fresh: !!args.fresh });
}

/**
 * THE TRIGGER. Rebuilds the snapshot, except while another run holds the
 * workbook (99w): a sync mid-redraw is the one moment the session tab may be
 * half-written, and the sync rebuilds the snapshot itself when it finishes.
 * Never throws — a failed rebuild leaves the last good snapshot being served.
 */
function refreshPublicScheduleSnapshot() {
  try {
    if (workbookHeldElsewhere()) {
      log('Public schedule snapshot: a sync holds the workbook — keeping the last one.');
      return false;
    }
    const snapshot = buildScheduleSnapshot_();
    return !!(snapshot && snapshot.ok !== false);
  } catch (err) {
    log(`⚠️ Public schedule snapshot rebuild failed (${err}).`);
    return false;
  }
}

/** The calendar sync's call (90) — same rebuild, no lease check: the sync IS the holder. Never throws. */
function refreshPublicScheduleSnapshotAfterSync_() {
  try {
    buildScheduleSnapshot_();
  } catch (err) {
    log(`⚠️ Public schedule snapshot was not rebuilt after the sync (${err}).`);
  }
}

/**
 * Installs the rebuild trigger if the running account has none — the same
 * belt ensureRegistrantSnapshotTrigger_() (99j) is, and under the same
 * ownership rule. Never throws.
 */
function ensurePublicSnapshotTrigger_() {
  try {
    const exists = ScriptApp.getProjectTriggers()
      .some(t => t.getHandlerFunction() === PUBLIC_SNAPSHOT_TRIGGER_HANDLER);
    if (exists) return false;
    const owner = getTriggerOwner();
    if (owner && owner !== getCurrentUserEmail()) return false;
    createPublicSnapshotTrigger_();
    log('Installed the missing public schedule snapshot trigger.');
    return true;
  } catch (err) {
    log(`⚠️ Could not install the public schedule snapshot trigger (${err}).`);
    return false;
  }
}

function createPublicSnapshotTrigger_() {
  return ScriptApp.newTrigger(PUBLIC_SNAPSHOT_TRIGGER_HANDLER)
    .timeBased().everyMinutes(PUBLIC_SNAPSHOT_TRIGGER_MINUTES).create();
}
