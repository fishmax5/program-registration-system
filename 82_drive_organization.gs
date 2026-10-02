// ============================================================================
// 82. WHERE THE FILES THIS SYSTEM MAKES ACTUALLY LIVE
//
// Numbered last for the usual reason: it is behavior plus its own handful of
// self-contained constants (STRAY_FILE_PATTERNS, the one that reads other
// files' names, is lazy), nothing else derives from them, and everything it
// calls is a hoisted function declaration — so whatever order the project's
// files come in, it is there when `04`, `05`, `45`, `46`, `55`, `89`, `99j`,
// `99y` and `99za` call into it.
//
// Two shelves under the anchor — what staff open, and a buried `System`
// folder for everything only this code reads — are section 82b, below the
// anchor itself.
//
// THE BUG THIS FILE EXISTS TO FIX. Every folder this project keeps things in
// was found the same way:
//
//     const folders = DriveApp.getFoldersByName(NAME);
//     if (folders.hasNext()) return folders.next();
//     return DriveApp.createFolder(NAME);          // ← My Drive root
//
// Both halves are wrong in the same direction. getFoldersByName() searches
// the WHOLE Drive, so a folder somebody had dragged somewhere sensible kept
// being found and nothing ever looked broken; and createFolder() with no
// parent drops the new one in My Drive ROOT, beside a year of unrelated
// personal files. Which folders were tidy and which were loose came down to
// whether anyone had happened to drag that one yet — the forms folder and the
// printed-sheets folder had been dragged, and the leader sheets, the form
// images and the live sign-in documents had not.
//
// Two files were never filed at all: the form TEMPLATE (`05`) is created and
// left wherever FormApp.create() puts it, and a program leader's sheet (`46`)
// was moved with the Drive-v2 addFile()/removeFile(getRootFolder()) pair,
// which throws outright on a shared drive — see moveDriveFileInto()'s banner,
// and `50`'s, which worked this out first for the forms folder.
//
// THE FIX IS AN ANCHOR. getSystemRootFolder() is the folder the WORKBOOK
// itself sits in — "Program Registration System" in the setup this was
// written for. Every folder below is found and created INSIDE it, and every
// file this system makes is moved into one of those. Nothing is named by a
// hardcoded id, so a center that renames or moves the whole folder keeps
// working; nothing is searched Drive-wide any more either, so two centers
// sharing an account stop finding each other's folders.
//
// ADOPTION, NOT DUPLICATION. A workbook upgrading to this has its folders in
// the old places, full of live files whose links are out in the world. So the
// first lookup for a name still falls back to the Drive-wide search, and when
// it finds the old folder it MOVES it under the anchor rather than starting a
// second one beside it. Moving a folder does not change any id or any link.
// ============================================================================

/**
 * The anchor, cached in Script Properties.
 *
 * Stored rather than re-derived every run because getParents() is a Drive
 * round trip on the hot path of every sync, and because the stored id keeps
 * working if somebody later moves the WORKBOOK on its own — the folder full
 * of forms is the thing that must not be orphaned, not the sheet.
 *
 * _V1: an id, and it has always been an id. See the Script Properties note in
 * CLAUDE.md for why the key is versioned anyway.
 */
const SYSTEM_ROOT_FOLDER_PROP_KEY = 'SYSTEM_ROOT_FOLDER_ID_V1';

/** Per-execution memo, keyed by folder name. Cleared with the other caches. */
let __systemFolderCache = {};

/**
 * The folder the workbook lives in, or null if it cannot be worked out.
 *
 * NULL IS A REAL ANSWER, not an error: a workbook in My Drive root has no
 * meaningful parent, and so does one whose only parent this account cannot
 * read. Every caller below treats null as "carry on the old way" — folders
 * are found Drive-wide and created at root, exactly as they were before this
 * file. An organization scheme is not worth a throw on the sync path.
 */
function getSystemRootFolder() {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty(SYSTEM_ROOT_FOLDER_PROP_KEY);
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (err) {
      log(`⚠️ Stored system folder ${storedId} could not be opened (${err}) — looking it up from the workbook again.`);
      props.deleteProperty(SYSTEM_ROOT_FOLDER_PROP_KEY);
    }
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    const parents = DriveApp.getFileById(ss.getId()).getParents();
    if (!parents.hasNext()) return null;
    const folder = parents.next();
    // Only ONE parent is remembered. A file can sit in several folders in
    // Drive, and picking the first is arbitrary — but any of them is a better
    // home than My Drive root, and remembering the choice means the answer
    // stops changing between runs, which is what actually matters here.
    props.setProperty(SYSTEM_ROOT_FOLDER_PROP_KEY, folder.getId());
    log(`Filed this system's generated files under "${folder.getName()}".`);
    return folder;
  } catch (err) {
    log(`ℹ️ Could not work out which folder this workbook is in (${err}) — new files will go to My Drive.`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// 82b. TWO SHELVES UNDER THE ANCHOR: WHAT STAFF OPEN, AND `System`
//
// The anchor fixed WHERE this system's folders live. It did not fix how many
// of them a person sees: on the setup this was written for, the anchor is a
// shared drive's ROOT (the workbook sits at the top of the drive), so every
// folder below — the rosters leaders open and the sign-in Docs printed at the
// desk, but also a hundred-odd generated forms, nightly CSV snapshots, a
// ledger archive, a JSON cache and five copies of the form template — sat side
// by side at the top of the drive everybody in the office browses.
//
// So there are two shelves now:
//
//   <anchor>/                        what staff open: the workbook, the
//     Program Registrant Sheets      program registrant sheets (`46`) and
//     Sign-In Sheets                 the live sign-in Docs (`45`)
//     System/                        everything only this code reads —
//       Program Registration Forms   the forms (`04`), the retired PDFs
//       Printed Sign-In Sheets       (`45`), the form images (`55`), the
//       Form Images                  registrant snapshots (`99j`), the
//       Registrant Snapshots         public schedule's JSON (`99y`), the
//       Public Schedule Snapshot     ledger archive (`99za`) and the form
//       Ledger Archive               template (`05`)
//
// A caller picks the shelf by passing `{ systemOnly: true }`; nothing else
// about a lookup changes. Which shelf a folder belongs on is a property of the
// folder's PURPOSE, so it is stated by the file that owns the folder, in the
// getter beside its own name constant, rather than in a list here that would
// have to be kept in step with eight other files.
//
// `System` IS ONLY EVER LOOKED FOR INSIDE THE ANCHOR — never Drive-wide.
// Every other folder name here is specific enough to adopt on sight; "System"
// is about the most generic folder name there is, and adopting somebody's own
// "System" folder from elsewhere in Drive would bury this project's files in
// a stranger's folder.
//
// NEVER FIGHT A FOLDER THAT HAS BEEN PUT AWAY. The adoption path finds a
// folder Drive-wide and MOVES it home. Before `System` existed, home was
// always the anchor and anything found elsewhere was by definition stray. Now
// a folder can legitimately sit in either of two places, and a lookup that
// dragged it from one to the other whenever its first read missed would be
// two callers (or two versions of this code) playing tug of war with a folder
// full of live links, once an hour. So:
//
//   * a system-only folder found at the anchor's top level is moved INTO
//     `System` — the upgrade path, one move, once;
//   * a staff-facing folder found inside `System` is USED WHERE IT IS —
//     somebody put it there, and every link in it works either way;
//   * a Drive-wide hit already sitting in the anchor or in `System` is used
//     where it is, never moved between the two.
//
// What this cannot stop is OLDER deployed code, which knows nothing of
// `System`: its first lookup misses a folder moved in there and its Drive-wide
// fallback moves it straight back to the anchor. That is why nothing is moved
// into `System` by hand before this version is deployed — after which the
// Admin sweep below (organizeGeneratedFiles) does it.
// ----------------------------------------------------------------------------

/** The buried subfolder's name. Looked up inside the anchor only — see above. */
const SYSTEM_SUBFOLDER_NAME = 'System';

/**
 * The memo key `System` is kept under. Not the bare name: a caller asking
 * getOrCreateSystemFolder() for a folder that happened to be called "System"
 * must not be handed this one out of the memo.
 */
const SYSTEM_SUBFOLDER_CACHE_KEY = '\u0000system-subfolder';

/**
 * The one folder out of an iterator, chosen the same way by every execution.
 *
 * Two executions that both miss a folder and both create it leave TWO of them
 * — which has happened here: two "Public Schedule Snapshot" folders made 0.7s
 * apart. Taking whichever Drive happens to list first then lets different runs
 * file into different twins. The EARLIEST created is a choice every run makes
 * identically, so the twins stop diverging the moment they exist. A folder
 * that cannot say when it was made sorts last rather than throwing.
 */
function pickSystemFolder_(iterator) {
  let best = null;
  let bestTime = Infinity;
  while (iterator && iterator.hasNext()) {
    const folder = iterator.next();
    let time = Infinity;
    try {
      const created = typeof folder.getDateCreated === 'function' ? folder.getDateCreated() : null;
      if (created && typeof created.getTime === 'function') time = created.getTime();
    } catch (err) {
      time = Infinity;
    }
    if (!best || time < bestTime) { best = folder; bestTime = time; }
  }
  return best;
}

/** The id of `item`'s first parent, or '' — one read, never throws. */
function driveParentIdOf_(item) {
  try {
    const parents = item.getParents();
    return parents.hasNext() ? parents.next().getId() : '';
  } catch (err) {
    return '';
  }
}

/**
 * `<anchor>/System`, found — or, unless `create` is false, created.
 *
 * Null when there is no anchor (the old behaviour then applies everywhere,
 * exactly as getSystemRootFolder() promises), and null rather than a throw
 * when Drive refuses: a folder that cannot be buried is filed at the anchor's
 * top level instead, which is untidy and nothing worse.
 */
function getSystemOnlyFolder(create) {
  if (__systemFolderCache[SYSTEM_SUBFOLDER_CACHE_KEY]) {
    return __systemFolderCache[SYSTEM_SUBFOLDER_CACHE_KEY];
  }
  try {
    const root = getSystemRootFolder();
    if (!root) return null;
    let folder = pickSystemFolder_(root.getFoldersByName(SYSTEM_SUBFOLDER_NAME));
    if (!folder) {
      if (create === false) return null;
      folder = root.createFolder(SYSTEM_SUBFOLDER_NAME);
      log(`Created Drive folder "${SYSTEM_SUBFOLDER_NAME}" in "${root.getName()}" for the files only this system reads.`);
    }
    __systemFolderCache[SYSTEM_SUBFOLDER_CACHE_KEY] = folder;
    return folder;
  } catch (err) {
    log(`ℹ️ The "${SYSTEM_SUBFOLDER_NAME}" folder could not be found or made (${err}) — filing at the top level instead.`);
    return null;
  }
}

/**
 * Find-or-create one of this system's folders, under the anchor.
 *
 * `legacyNames` are earlier names for the SAME folder (`46`'s "Instructor
 * Sign-Up Sheets"): found anywhere, they are renamed and adopted rather than
 * left behind full of live files.
 *
 * `options.systemOnly` files the folder in `<anchor>/System` instead of at the
 * anchor's top level — see 82b above for which folders say so and why.
 *
 * Order matters and is the whole point:
 *   1. on its own shelf, by name — the steady state, one Drive call;
 *   2. on the OTHER shelf, by name — a system-only folder still at the top
 *      level is moved into System, once; a staff folder somebody put into
 *      System is left where it is;
 *   3. anywhere in Drive, by name or a legacy name — the upgrade path, moved
 *      home unless it is already on one of the two shelves;
 *   4. created, on its own shelf.
 */
function getOrCreateSystemFolder(name, legacyNames, options) {
  if (__systemFolderCache[name]) return __systemFolderCache[name];
  const systemOnly = !!(options && options.systemOnly);

  const root = getSystemRootFolder();
  // Only a system-only lookup may CREATE System; a staff lookup only peeks, so
  // a workbook that never makes a system-only file never grows an empty
  // folder called System.
  const sys = root ? getSystemOnlyFolder(systemOnly) : null;
  const home = (systemOnly && sys) ? sys : root;
  const remember = folder => { __systemFolderCache[name] = folder; return folder; };

  if (home) {
    const found = pickSystemFolder_(home.getFoldersByName(name));
    if (found) return remember(found);
  }

  const other = (home && sys) ? (home === sys ? root : sys) : null;
  if (other) {
    const found = pickSystemFolder_(other.getFoldersByName(name));
    if (found) {
      if (systemOnly) moveDriveFileInto(found, sys, `the "${name}" folder`);
      return remember(found);
    }
  }

  const shelves = [root, sys].filter(Boolean).map(folder => folder.getId());
  const candidates = [name].concat(legacyNames || []);
  for (let i = 0; i < candidates.length; i++) {
    const folder = pickSystemFolder_(DriveApp.getFoldersByName(candidates[i]));
    if (!folder) continue;
    if (candidates[i] !== name) {
      try {
        folder.setName(name);
        log(`Renamed Drive folder "${candidates[i]}" to "${name}".`);
      } catch (err) {
        // Somebody else's folder, or a Drive that said no. The files in it are
        // still reachable by id, so this is cosmetic — use it as it is rather
        // than starting a second folder over a failed rename.
        log(`ℹ️ Could not rename "${candidates[i]}" (${err}) — filing new files there anyway.`);
      }
    }
    // Already on a shelf: used where it is. Moving it between the anchor and
    // System from here is exactly the tug of war 82b rules out.
    if (home && shelves.indexOf(driveParentIdOf_(folder)) < 0) {
      moveDriveFileInto(folder, home, `the "${name}" folder`);
    }
    return remember(folder);
  }

  const created = home ? home.createFolder(name) : DriveApp.createFolder(name);
  log(`Created Drive folder "${name}"${home ? ` in "${home.getName()}"` : ' in My Drive'}.`);
  return remember(created);
}

/**
 * Drops the per-execution folder memo.
 *
 * Nothing on the sync path calls this — the memo dies with the execution, and
 * a folder does not change identity mid-run. It exists for the sweep below,
 * which adopts folders as it goes and would otherwise keep handing back the
 * one it found before it moved anything, and for tests.
 */
function clearSystemFolderCache() {
  __systemFolderCache = {};
}

/**
 * Move a file OR a folder into `folder`, saying so if it cannot.
 *
 * Generalized from fileFormIntoFormsFolder() (`50`), whose banner worked this
 * out first and still applies word for word: moveTo() FIRST, addFile() only
 * as the fallback. addFile()/removeFile() are the old Drive-v2 shape and they
 * throw "Cannot use this operation on a shared drive item" outright — not an
 * exotic case here, because a center with a Google Workspace account keeps
 * its forms on a shared drive, so on those setups every filing attempt
 * reported a failure it had no way to avoid. A shared drive also has no "My
 * Drive root" to take the file out of, which is why the root cleanup lives
 * with the fallback that needs it and not before the move.
 *
 * NEVER THROWS. Which folder a file sits in is the least important true thing
 * about it: the link works either way, and a sync that died because Drive
 * would not reparent a document would be a far worse bug than the mess this
 * file was written to clean up.
 */
function moveDriveFileInto(file, folder, describe) {
  if (!file || !folder) return false;
  const what = describe || `Drive item ${file.getId()}`;
  try {
    file.moveTo(folder);
    return true;
  } catch (err) {
    log(`ℹ️ ${what} could not be moved into "${folder.getName()}" (${err}) — trying the older Drive call.`);
  }
  try {
    folder.addFile(file);
    const root = DriveApp.getRootFolder();
    const parents = file.getParents();
    let inRoot = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === root.getId()) { inRoot = true; break; }
    }
    if (inRoot) root.removeFile(file);
    return true;
  } catch (err) {
    log(`ℹ️ ${what} could not be filed into "${folder.getName()}" (${err}) — it is otherwise fine. ` +
      `Only which folder it sits in is unsettled.`);
    return false;
  }
}

/** True when `file` already has `folder` among its parents — one read, no write. */
function driveFileIsIn(file, folder) {
  if (!file || !folder) return false;
  try {
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) return true;
    }
  } catch (err) {
    // An unreadable parent list is not a reason to move anything. Say it is
    // already home; the sweep's whole job is optional tidying.
    return true;
  }
  return false;
}

// ----------------------------------------------------------------------------
// 79a. THE ONE-TIME SWEEP
//
// Everything above fixes where the NEXT file goes. This fixes where the ones
// already made went, and it is the reason this file was written rather than a
// five-line change to five lookups.
//
// FOUR PASSES, deliberately in this order:
//
//   0. THE FOLDERS. Every folder this system keeps is looked up through its
//      own getter, which adopts it onto the right shelf on the way past (82b):
//      a system-only folder still at the anchor's top level goes into
//      `System`. Then any TWIN of a system-only folder left at the top level —
//      the same name, made by two executions racing — is moved into `System`
//      too, beside the one in use. Twins are never merged and never trashed:
//      which of the two a stored id points into is not something a sweep can
//      safely decide, and a folder moved is a folder whose links still work.
//
//   1. BY REGISTRY. Every file this system tracks by id — the forms in the
//      form registry (`06`), the leader sheets (`46`), the sign-in documents
//      (`69`), the template form (`05`), the public schedule's JSON (`99y`) —
//      is opened and filed. This pass cannot pick up a file the system did
//      not make, because it only ever looks at ids the system wrote down.
//
//   2. BY NAME, ACROSS TWO FOLDERS ONLY: My Drive root and the anchor's own
//      top level. A workbook that has been running since before a registry
//      existed has files nothing has a record of, and the only thing left
//      that identifies them is the name this system gave them — four spare
//      copies of the form template at the top of a shared drive, for one.
//      So those two folders are walked once and anything matching one of the
//      patterns below is filed. Nothing deeper is walked: a file somebody has
//      already put inside a folder of their own was put there on purpose.
//
//      THIS PASS CAN BE WRONG, and the shape of the patterns is the defense:
//      each is anchored, carries the em-dash, the date or the exact file name
//      this system writes, and is checked against the file's MIME TYPE as
//      well — a text note called "Sign-Up Sheet — Chair Yoga (Main)" is not
//      moved, because the pattern that would match it only applies to Sheets,
//      and "Copy of Registrant Sheet — …" is not moved because the pattern is
//      anchored at the start. It is still a judgment call, which is why the
//      sweep LOGS every move by name and why moving a file changes no link: an
//      over-eager match costs somebody one drag back, not a lost file.
//
// It never trashes, renames (beyond the legacy folder rename the getters have
// always done) or reshares anything. It is idempotent and cheap to re-run: a
// file already in the right folder is one parent read and no write. It lives
// on the Admin menu rather than the hourly sync because it walks the whole of
// My Drive root, which is a big read to do every hour for an answer that
// stops changing after the first run.
// ----------------------------------------------------------------------------

/**
 * The by-name patterns, each with the folder it files into and the MIME type
 * it insists on. Order does not matter — the first match wins and no name
 * this system writes matches two of these. `folder` is a folder NAME, looked
 * up in the map organizeGeneratedFiles() builds; SYSTEM_SUBFOLDER_NAME there
 * means `<anchor>/System` itself.
 *
 * A lazy global: every one of these folder names is another file's constant,
 * and this array reads them at what would otherwise be load time. See
 * `01a_lazy_globals.gs`.
 */
defineLazyGlobal_('STRAY_FILE_PATTERNS', () => [
  {
    // The form template (`05`). Named once, never renamed — but this setup has
    // made five of them over its life, and only one is the live template.
    // All of them are system-only; the spares are filed beside the live one
    // rather than judged, because which is live is a Script Property, not a
    // name.
    re: /^TEMPLATE — Registration Form Base/i,
    mime: MimeType.GOOGLE_FORMS,
    folder: SYSTEM_SUBFOLDER_NAME,
    what: 'a form template'
  },
  {
    // A program leader's shared roster (`46`), under its current name …
    re: /^Registrant Sheet — .+ \(.+\)$/,
    mime: MimeType.GOOGLE_SHEETS,
    folder: LEADER_SHEET_FOLDER_NAME,
    what: 'a program registrant sheet'
  },
  {
    // … and under the name it had before `46` renamed them, which a sheet
    // nobody has pushed since still carries.
    re: /^Sign-Up Sheet — .+ \(.+\)$/,
    mime: MimeType.GOOGLE_SHEETS,
    folder: LEADER_SHEET_FOLDER_NAME,
    what: 'a program registrant sheet'
  },
  {
    // A live sign-in document (`45`) — same name shape the retired PDFs used,
    // which is why SIGN_IN_SHEET_FILENAME_RE in `69` reads both.
    re: /^Sign-In \d{4}-\d{2}-\d{2} /,
    mime: MimeType.GOOGLE_DOCS,
    folder: SIGN_IN_DOC_FOLDER_NAME,
    what: 'a sign-in sheet'
  },
  {
    // The retired PDF export of the same (`45`, `69`). Still worth filing:
    // the registry backfill reads that folder and its links are live.
    re: /^Sign-In \d{4}-\d{2}-\d{2} .+\.pdf$/i,
    mime: 'application/pdf',
    folder: SIGN_IN_SHEET_FOLDER_NAME,
    what: 'a printed sign-in sheet'
  },
  {
    // A registrant snapshot (`99j`): "All_Registrants 2026-10-01_0355 (daily).csv".
    re: new RegExp(`^${escapeDriveNameForRegExp_(SHEET_NAMES.REGISTRANT_DASH)} \\d{4}-\\d{2}-\\d{2}_\\d{4} \\(.+\\)\\.csv$`),
    mime: MimeType.CSV,
    folder: REGISTRANT_SNAPSHOT_FOLDER_NAME,
    what: 'a registrant snapshot'
  },
  {
    // A ledger compaction archive (`99za`):
    // "Registration_Ledger compacted 2026-09-30_1112 (42 entries).csv".
    re: new RegExp(`^${escapeDriveNameForRegExp_(SHEET_NAMES.REGISTRATION_LEDGER)} compacted \\d{4}-\\d{2}-\\d{2}_\\d{4} \\(.+\\)\\.csv$`),
    mime: MimeType.CSV,
    folder: LEDGER_ARCHIVE_FOLDER_NAME,
    what: 'a ledger archive'
  },
  {
    // The public schedule's Drive fallback (`99y`) — one fixed file name.
    re: new RegExp(`^${escapeDriveNameForRegExp_(PUBLIC_SNAPSHOT_FILE_NAME)}$`),
    mime: 'application/json',
    folder: PUBLIC_SNAPSHOT_FOLDER_NAME,
    what: 'the public schedule snapshot'
  }
]);

/** A file or folder name, made safe to drop into a RegExp literally. */
function escapeDriveNameForRegExp_(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How many loose files the sweep will look at before it stops and says so. */
const STRAY_SWEEP_MAX_FILES = 3000;

/**
 * Every folder this system keeps, keyed by name, each fetched through its
 * owner's getter — so each is adopted onto the shelf its owner declared on the
 * way past — plus `System` itself under SYSTEM_SUBFOLDER_NAME.
 *
 * One list, read by the sweep. A folder added to this project without a line
 * here is still created on the right shelf by its own getter; it is only the
 * one-time tidy that would not visit it.
 */
function collectSystemFolders_() {
  const folders = {};
  const add = getter => {
    const folder = getter();
    if (folder) folders[folder.getName()] = folder;
  };
  // Staff-facing first, so their lookups only PEEK at System (82b).
  add(getOrCreateProgramLeaderSheetFolder);
  add(getOrCreateSignInSheetDocFolder);
  // System-only.
  add(getOrCreateFormsFolder);
  add(getOrCreateSignInSheetFolder);
  add(getOrCreateFormImageFolder);
  add(getOrCreateRegistrantSnapshotFolder);
  add(getOrCreatePublicScheduleSnapshotFolder);
  add(getOrCreateLedgerArchiveFolder);
  const sys = getSystemOnlyFolder(true);
  if (sys) folders[SYSTEM_SUBFOLDER_NAME] = sys;
  return folders;
}

/**
 * Pass 0's second half: a folder left at the anchor's top level with the same
 * name as a system-only folder now in System is a twin from two racing
 * executions. Moved into System beside its sibling — not merged, not trashed
 * (see the banner). Returns the lines to report.
 */
function buryTwinSystemFolders_(root, sys, folders) {
  const moved = [];
  if (!root || !sys) return moved;
  Object.keys(folders).forEach(name => {
    const folder = folders[name];
    if (name === SYSTEM_SUBFOLDER_NAME) return;
    if (driveParentIdOf_(folder) !== sys.getId()) return;   // a staff folder
    const twins = root.getFoldersByName(name);
    while (twins.hasNext()) {
      const twin = twins.next();
      if (twin.getId() === folder.getId()) continue;
      if (moveDriveFileInto(twin, sys, `a second "${name}" folder`)) {
        moved.push(`${name} (a second copy) → ${SYSTEM_SUBFOLDER_NAME}`);
      }
    }
  });
  return moved;
}

/**
 * Admin menu: file every generated document where it now belongs.
 *
 * Reports what it moved rather than doing it silently, because "it moved
 * eleven things" and "it moved four hundred things" are different enough
 * answers that somebody would want to know which they got.
 */
function organizeGeneratedFiles() {
  if (!requireAuthorizedAdmin('Organize Generated Files')) return;

  const ui = SpreadsheetApp.getUi();
  const root = getSystemRootFolder();
  if (!root) {
    ui.alert('Organize Generated Files',
      'This workbook does not sit in a folder this script can read, so there is nowhere to file ' +
      'anything into. Move the spreadsheet into a folder of its own and run this again.',
      ui.ButtonSet.OK);
    return;
  }

  const moved = [];
  const notes = [];

  // Pass 0: the folders onto their shelves, then the twins. The memo is
  // dropped first so every getter really looks, rather than handing back a
  // folder found earlier in this execution before anything was moved.
  clearSystemFolderCache();
  const before = {};
  const sysBefore = getSystemOnlyFolder(false);
  [root, sysBefore].filter(Boolean).forEach(shelf => {
    const it = shelf.getFolders();
    while (it.hasNext()) { const f = it.next(); before[f.getId()] = driveParentIdOf_(f); }
  });
  const folders = collectSystemFolders_();
  const sys = folders[SYSTEM_SUBFOLDER_NAME] || null;
  Object.keys(folders).forEach(name => {
    const folder = folders[name];
    const was = before[folder.getId()];
    if (was && was !== driveParentIdOf_(folder)) moved.push(`${name} (folder) → ${SYSTEM_SUBFOLDER_NAME}`);
  });
  buryTwinSystemFolders_(root, sys, folders).forEach(line => moved.push(line));

  const fileInto = (fileId, folder, what) => {
    if (!fileId || !folder) return;
    let file;
    try {
      file = DriveApp.getFileById(fileId);
    } catch (err) {
      // Trashed, or made by an account this one cannot see. Both are ordinary
      // on a workbook this old, and neither is worth stopping for.
      return;
    }
    if (driveFileIsIn(file, folder)) return;
    if (moveDriveFileInto(file, folder, what)) {
      moved.push(`${file.getName()} → ${folder.getName()}`);
    }
  };

  // Pass 1: everything with an id written down somewhere.
  const registry = getPersistentFormRegistry();
  // groupKey → formId, a bare string. See savePersistentFormRegistryEntry().
  Object.keys(registry).forEach(key => {
    fileInto(registry[key], folders[FORMS_FOLDER_NAME], `registration form for ${key}`);
  });

  const props = PropertiesService.getScriptProperties();
  fileInto(props.getProperty(TEMPLATE_FORM_PROP_KEY), sys || root, 'the form template');
  fileInto(props.getProperty(PUBLIC_SNAPSHOT_FILE_PROP_KEY),
    folders[PUBLIC_SNAPSHOT_FOLDER_NAME], 'the public schedule snapshot');

  const leaderRegistry = getProgramLeaderSheetRegistry();
  Object.keys(leaderRegistry).forEach(key => {
    const entry = leaderRegistry[key];
    fileInto(entry && entry.fileId, folders[LEADER_SHEET_FOLDER_NAME], `leader sheet for ${key}`);
  });

  const signInRegistry = getSignInSheetRegistry();
  Object.keys(signInRegistry).forEach(key => {
    const entry = signInRegistry[key];
    // The registry holds both live Docs and the retired PDFs. A PDF belongs
    // in the printed folder; anything else is the live document.
    const isPdf = /\.pdf$/i.test(String((entry && entry.name) || ''));
    const target = isPdf ? folders[SIGN_IN_SHEET_FOLDER_NAME] : folders[SIGN_IN_DOC_FOLDER_NAME];
    fileInto(entry && entry.fileId, target, `sign-in sheet for ${key}`);
  });

  // Pass 2: My Drive root and the anchor's top level, by name and MIME type.
  // See the banner above for why this pass is bounded, anchored and logged.
  const loose = [{ label: 'My Drive', get: () => DriveApp.getRootFolder() }];
  loose.push({ label: `"${root.getName()}"`, get: () => root });
  const walked = {};
  let looked = 0;
  let hitCap = false;
  loose.forEach(place => {
    if (hitCap) return;
    try {
      const folder = place.get();
      if (!folder || walked[folder.getId()]) return;
      walked[folder.getId()] = true;
      const files = folder.getFiles();
      while (files.hasNext()) {
        if (looked++ >= STRAY_SWEEP_MAX_FILES) { hitCap = true; break; }
        const file = files.next();
        const name = String(file.getName() || '').trim();
        let mime = '';
        try { mime = file.getMimeType(); } catch (err) { mime = ''; }

        for (let i = 0; i < STRAY_FILE_PATTERNS.length; i++) {
          const spec = STRAY_FILE_PATTERNS[i];
          if (spec.mime !== mime) continue;
          if (!spec.re.test(name)) continue;
          const target = folders[spec.folder] || root;
          if (!driveFileIsIn(file, target) && moveDriveFileInto(file, target, `${spec.what} "${name}"`)) {
            moved.push(`${name} → ${target.getName()}`);
          }
          break;
        }
      }
    } catch (err) {
      notes.push(`${place.label} could not be searched for loose files (${err}). Everything with a link in the workbook was still filed.`);
    }
  });
  if (hitCap) {
    notes.push(`Stopped after looking at ${STRAY_SWEEP_MAX_FILES} loose files. Run this again to carry on.`);
  }

  moved.forEach(line => log(`Organize: ${line}`));

  const summary = moved.length
    ? `Moved ${moved.length} item${moved.length === 1 ? '' : 's'} under "${root.getName()}":\n\n` +
      moved.slice(0, 40).join('\n') +
      (moved.length > 40 ? `\n\n…and ${moved.length - 40} more (all of them are in the log).` : '')
    : `Nothing to move — every file this system has made is already filed under "${root.getName()}".`;

  ui.alert('Organize Generated Files',
    summary + (notes.length ? `\n\n${notes.join('\n')}` : ''),
    ui.ButtonSet.OK);
}
