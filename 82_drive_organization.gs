// ============================================================================
// 82. WHERE THE FILES THIS SYSTEM MAKES ACTUALLY LIVE
//
// Numbered last for the usual reason: it is behavior plus its own two
// constants, nothing else derives from them, and everything it calls is a
// hoisted function declaration — so whatever order the project's files come
// in, it is there when `04`, `05`, `45`, `46` and `55` call into it.
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

/**
 * Find-or-create one of this system's folders, under the anchor.
 *
 * `legacyNames` are earlier names for the SAME folder (`46`'s "Instructor
 * Sign-Up Sheets"): found anywhere, they are renamed and adopted rather than
 * left behind full of live files.
 *
 * Order matters and is the whole point:
 *   1. inside the anchor, by name — the steady state, one Drive call;
 *   2. anywhere in Drive, by name or a legacy name — the upgrade path, moved
 *      home;
 *   3. created, inside the anchor.
 */
function getOrCreateSystemFolder(name, legacyNames) {
  if (__systemFolderCache[name]) return __systemFolderCache[name];

  const root = getSystemRootFolder();

  if (root) {
    const inside = root.getFoldersByName(name);
    if (inside.hasNext()) {
      const found = inside.next();
      __systemFolderCache[name] = found;
      return found;
    }
  }

  const candidates = [name].concat(legacyNames || []);
  for (let i = 0; i < candidates.length; i++) {
    const stray = DriveApp.getFoldersByName(candidates[i]);
    if (!stray.hasNext()) continue;
    const folder = stray.next();
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
    if (root) moveDriveFileInto(folder, root, `the "${name}" folder`);
    __systemFolderCache[name] = folder;
    return folder;
  }

  const created = root ? root.createFolder(name) : DriveApp.createFolder(name);
  log(`Created Drive folder "${name}"${root ? ` in "${root.getName()}"` : ' in My Drive'}.`);
  __systemFolderCache[name] = created;
  return created;
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
// TWO PASSES, deliberately in this order:
//
//   1. BY REGISTRY. Every file this system tracks by id — the forms in the
//      form registry (`06`), the leader sheets (`46`), the sign-in documents
//      (`69`), the template form (`05`) — is opened and filed. This pass
//      cannot pick up a file the system did not make, because it only ever
//      looks at ids the system wrote down itself.
//
//   2. BY NAME, ACROSS MY DRIVE ROOT ONLY. A workbook that has been running
//      since before a registry existed has files nothing has a record of, and
//      the only thing left that identifies them is the name this system gave
//      them. So the root is walked once and anything matching one of the
//      patterns below is filed.
//
//      THIS PASS CAN BE WRONG, and the shape of the patterns is the defense:
//      each is anchored, carries the em-dash or the date this system writes,
//      and is checked against the file's MIME TYPE as well — a text note
//      called "Sign-Up Sheet — Chair Yoga (Main)" is not moved, because the
//      pattern that would match it only applies to Sheets. It is still a
//      judgment call, which is why the sweep LOGS every move by name and why
//      moving a file changes no link: an over-eager match costs somebody one
//      drag back, not a lost file.
//
// It is idempotent and cheap to re-run: a file already in the right folder is
// one parent read and no write. It lives on the Admin menu rather than the
// hourly sync because it walks the whole of My Drive root, which is a big
// read to do every hour for an answer that stops changing after the first
// run.
// ----------------------------------------------------------------------------

/**
 * The by-name patterns, each with the folder it files into and the MIME type
 * it insists on. Order does not matter — the first match wins and no name
 * this system writes matches two of these.
 *
 * A lazy global: every one of these folder names is another file's constant,
 * and this array reads them at what would otherwise be load time. See
 * `01a_lazy_globals.gs`.
 */
defineLazyGlobal_('STRAY_FILE_PATTERNS', () => [
  {
    // The form template (`05`). Named once, never renamed, one of a kind.
    re: /^TEMPLATE — Registration Form Base/i,
    mime: MimeType.GOOGLE_FORMS,
    folder: null,          // null = the anchor itself, not a subfolder
    what: 'the form template'
  },
  {
    // A program leader's shared roster (`46`).
    re: /^Sign-Up Sheet — .+ \(.+\)$/,
    mime: MimeType.GOOGLE_SHEETS,
    folder: LEADER_SHEET_FOLDER_NAME,
    what: 'a program leader sheet'
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
  }
]);

/** How many root files the sweep will look at before it stops and says so. */
const STRAY_SWEEP_MAX_FILES = 3000;

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

  // Pass 0: make sure every folder exists and is under the anchor. Each
  // lookup adopts a stray folder of that name on its way past, so this is
  // most of the tidying on a typical workbook.
  const folders = {};
  folders[FORMS_FOLDER_NAME] = getOrCreateFormsFolder();
  folders[SIGN_IN_DOC_FOLDER_NAME] = getOrCreateSignInSheetDocFolder();
  folders[SIGN_IN_SHEET_FOLDER_NAME] = getOrCreateSignInSheetFolder();
  folders[LEADER_SHEET_FOLDER_NAME] = getOrCreateProgramLeaderSheetFolder();
  folders[FORM_IMAGE_FOLDER_NAME] = getOrCreateFormImageFolder();

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

  const templateId = PropertiesService.getScriptProperties().getProperty(TEMPLATE_FORM_PROP_KEY);
  fileInto(templateId, root, 'the form template');

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

  // Pass 2: My Drive root, by name and MIME type. See the banner above for
  // why this pass is bounded, anchored and logged.
  let looked = 0;
  let hitCap = false;
  try {
    const files = DriveApp.getRootFolder().getFiles();
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
        const target = spec.folder ? folders[spec.folder] : root;
        if (!driveFileIsIn(file, target) && moveDriveFileInto(file, target, `${spec.what} "${name}"`)) {
          moved.push(`${name} → ${target.getName()}`);
        }
        break;
      }
    }
  } catch (err) {
    notes.push(`My Drive could not be searched for loose files (${err}). Everything with a link in the workbook was still filed.`);
  }
  if (hitCap) {
    notes.push(`Stopped after looking at ${STRAY_SWEEP_MAX_FILES} files in My Drive. Run this again to carry on.`);
  }

  moved.forEach(line => log(`Organize: ${line}`));

  const summary = moved.length
    ? `Moved ${moved.length} file${moved.length === 1 ? '' : 's'} into "${root.getName()}":\n\n` +
      moved.slice(0, 40).join('\n') +
      (moved.length > 40 ? `\n\n…and ${moved.length - 40} more (all of them are in the log).` : '')
    : `Nothing to move — every file this system has made is already filed under "${root.getName()}".`;

  ui.alert('Organize Generated Files',
    summary + (notes.length ? `\n\n${notes.join('\n')}` : ''),
    ui.ButtonSet.OK);
}
