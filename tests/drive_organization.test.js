// WHERE THE FILES THIS SYSTEM MAKES END UP (section 82).
//
// The bug: every folder lookup was a Drive-WIDE getFoldersByName() plus a
// root-level createFolder(), so a folder nobody had dragged anywhere was
// created in My Drive root beside a year of unrelated personal files — and
// because the search was Drive-wide, nothing ever looked broken afterwards.
//
// So what is pinned here is not "a folder is returned" — the old code did
// that too. It is WHERE the folder is created, and that an existing one is
// adopted rather than duplicated:
//
//   * a folder that does not exist yet is created INSIDE the workbook's own
//     folder, never at the Drive root;
//   * a folder of that name already under the anchor is used as it is, with
//     no Drive-wide search at all;
//   * a folder of that name loose somewhere else is MOVED home — never
//     duplicated, because the files in it have live links out in the world;
//   * a legacy name is renamed and adopted on the same path (`46`);
//   * no anchor (a workbook sitting in Drive root) still returns a working
//     folder — the organization scheme is never worth a throw on the sync
//     path.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures++; console.log(`FAIL ${name}\n  got      ${a}\n  expected ${e}`); }
  else console.log(`ok   ${name}`);
}

// --- A Drive small enough to read, and honest about parents. ---------------
function makeDrive() {
  const byId = {};
  let next = 0;
  const iter = list => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };

  function folder(name, parentId) {
    const id = `f${++next}`;
    const self = {
      id, name, parentId, isFolder: true,
      getId: () => id,
      getName: () => self.name,
      setName: n => { self.name = n; return self; },
      getParents: () => iter(self.parentId ? [byId[self.parentId]] : []),
      getFoldersByName: n => iter(Object.keys(byId)
        .map(k => byId[k])
        .filter(f => f.isFolder && f.parentId === self.id && f.name === n)),
      getFiles: () => iter(Object.keys(byId).map(k => byId[k]).filter(f => !f.isFolder && f.parentId === self.id)),
      createFolder: n => folder(n, self.id),
      moveTo: t => { self.parentId = t.getId(); return self; },
      addFile: f => { f.parentId = self.id; },
      removeFile: () => {}
    };
    byId[id] = self;
    return self;
  }

  function file(name, parentId, mime) {
    const id = `x${++next}`;
    const self = {
      id, name, parentId, isFolder: false, mime: mime || 'application/vnd.google-apps.document',
      getId: () => id, getName: () => self.name, getMimeType: () => self.mime,
      getParents: () => iter(self.parentId ? [byId[self.parentId]] : []),
      moveTo: t => { self.parentId = t.getId(); return self; }
    };
    byId[id] = self;
    return self;
  }

  const root = folder('My Drive', null);
  return {
    byId, root, folder, file,
    app: {
      getRootFolder: () => root,
      // The no-anchor path: a bare createFolder() lands in Drive root, which
      // is exactly what section 82 stopped doing everywhere else.
      createFolder: n => folder(n, root.getId()),
      getFolderById: id => { if (!byId[id]) throw new Error('no such folder'); return byId[id]; },
      getFileById: id => { if (!byId[id]) throw new Error('no such file'); return byId[id]; },
      // The Drive-WIDE search the old code leaned on. Kept, because the
      // adoption path is the one thing that still legitimately needs it.
      getFoldersByName: n => iter(Object.keys(byId).map(k => byId[k]).filter(f => f.isFolder && f.name === n))
    }
  };
}

/**
 * Load the project against one fake Drive. `workbookParentId` is the folder
 * the spreadsheet sits in — null means it is loose in Drive root, which is
 * the "no anchor" case every caller has to survive.
 */
function load(drive, workbookParentId) {
  const props = {};
  const wb = drive.file('Program Registration System', workbookParentId,
    'application/vnd.google-apps.spreadsheet');
  const sandbox = {
    console: { log: () => {} },
    Utilities: { formatDate: () => '', sleep: () => {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        setProperties: o => { Object.assign(props, o); },
        deleteProperty: k => { delete props[k]; }
      })
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getId: () => wb.getId(),
        getSpreadsheetTimeZone: () => 'America/New_York'
      }),
      getActive: () => null
    },
    Session: {
      getScriptTimeZone: () => 'America/New_York',
      getEffectiveUser: () => ({ getEmail: () => 't@e.com' })
    },
    FormApp: { ItemType: {} },
    DriveApp: drive.app,
    MimeType: {
      GOOGLE_FORMS: 'application/vnd.google-apps.form',
      GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet',
      GOOGLE_DOCS: 'application/vnd.google-apps.document'
    },
    CalendarApp: {}, HtmlService: {}, LockService: {}, ScriptApp: {},
    MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}, CacheService: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(src + `
;this.getSystemRootFolder = getSystemRootFolder;
this.getOrCreateSystemFolder = getOrCreateSystemFolder;
this.clearSystemFolderCache = clearSystemFolderCache;
this.moveDriveFileInto = moveDriveFileInto;
this.driveFileIsIn = driveFileIsIn;
this.STRAY_FILE_PATTERNS = STRAY_FILE_PATTERNS;
this.LEADER_SHEET_FOLDER_NAME = LEADER_SHEET_FOLDER_NAME;
this.LEGACY_LEADER_SHEET_FOLDER_NAMES = LEGACY_LEADER_SHEET_FOLDER_NAMES;
`, sandbox, { filename: 'program.gs' });
  return sandbox;
}

// ---------------------------------------------------------------------------
// 1. The anchor is the workbook's own folder, and a new folder goes INSIDE it.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const home = drive.folder('Program Registration System', drive.root.getId());
  const s = load(drive, home.getId());

  check('the anchor is the folder the workbook lives in',
    s.getSystemRootFolder().getId(), home.getId());

  const made = s.getOrCreateSystemFolder('Form Images');
  check('a new folder is created inside the anchor, not at the Drive root',
    made.parentId, home.getId());
  check('...and it is the folder that was asked for', made.getName(), 'Form Images');

  // Twice is once: the memo, and then the by-name read inside the anchor.
  s.clearSystemFolderCache();
  check('a second lookup finds the same folder rather than making another',
    s.getOrCreateSystemFolder('Form Images').getId(), made.getId());
}

// ---------------------------------------------------------------------------
// 2. ADOPTION. A folder loose elsewhere is moved home — never duplicated. The
//    files in it have live links, so a second folder beside it would strand a
//    year of them somewhere nobody looks.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const home = drive.folder('Program Registration System', drive.root.getId());
  const stray = drive.folder('Program Registration Forms', drive.root.getId());
  const s = load(drive, home.getId());

  const got = s.getOrCreateSystemFolder('Program Registration Forms');
  check('the stray folder is adopted, not duplicated', got.getId(), stray.getId());
  check('...and it is moved under the anchor', got.parentId, home.getId());
}

// ---------------------------------------------------------------------------
// 3. A LEGACY NAME is renamed on the same path (`46`'s "Instructor Sign-Up
//    Sheets"), so nothing has to be moved by hand after a rename ships.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const home = drive.folder('Program Registration System', drive.root.getId());
  const s = load(drive, home.getId());
  const old = drive.folder(s.LEGACY_LEADER_SHEET_FOLDER_NAMES[0], drive.root.getId());

  const got = s.getOrCreateSystemFolder(s.LEADER_SHEET_FOLDER_NAME,
    s.LEGACY_LEADER_SHEET_FOLDER_NAMES);
  check('the legacy folder is the one returned', got.getId(), old.getId());
  check('...renamed to the current name', got.getName(), s.LEADER_SHEET_FOLDER_NAME);
  check('...and filed under the anchor', got.parentId, home.getId());
}

// ---------------------------------------------------------------------------
// 4. NO ANCHOR is not an error. A workbook sitting loose in Drive root still
//    gets a working folder — it just gets it where the old code put it.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const s = load(drive, null);
  check('a workbook with no parent has no anchor', s.getSystemRootFolder(), null);
  const made = s.getOrCreateSystemFolder('Sign-In Sheets');
  check('...and a folder is still returned', !!made && made.getName(), 'Sign-In Sheets');
}

// ---------------------------------------------------------------------------
// 5. The by-name sweep patterns. Each is anchored and MIME-checked, because
//    this is the pass that can be wrong: a note somebody typed themselves must
//    not be swept up by the pattern for a file this system generated.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const home = drive.folder('Program Registration System', drive.root.getId());
  const s = load(drive, home.getId());
  const SHEETS = 'application/vnd.google-apps.spreadsheet';
  const DOCS = 'application/vnd.google-apps.document';
  const FORMS = 'application/vnd.google-apps.form';

  const match = (name, mime) => {
    const hit = s.STRAY_FILE_PATTERNS.filter(p => p.mime === mime && p.re.test(name))[0];
    return hit ? (hit.folder || '(the system folder)') : null;
  };

  check('the template form is recognized',
    match('TEMPLATE — Registration Form Base (do not edit or delete)', FORMS),
    '(the system folder)');
  check('a leader sheet is recognized',
    match('Sign-Up Sheet — Chair Yoga (Narberth)', SHEETS), s.LEADER_SHEET_FOLDER_NAME);
  check('a live sign-in document is recognized',
    match('Sign-In 2026-03-04 Narberth', DOCS), 'Sign-In Sheets');
  check('a retired sign-in PDF is recognized',
    match('Sign-In 2026-03-04 Narberth.pdf', 'application/pdf'), 'Printed Sign-In Sheets');

  // The refusals, which are the point of the MIME check and the anchoring.
  check('a DOCUMENT named like a leader sheet is left alone',
    match('Sign-Up Sheet — Chair Yoga (Narberth)', DOCS), null);
  check("somebody's own note that merely mentions a sign-up sheet is left alone",
    match('Notes about the Sign-Up Sheet — Chair Yoga (Narberth)', SHEETS), null);
  check('an unrelated spreadsheet is left alone', match('Budget 2026', SHEETS), null);
}

// ---------------------------------------------------------------------------
// 6. moveDriveFileInto() never throws, and says so when it could not move.
//    Which folder a file sits in is the least important true thing about it:
//    a sync that died because Drive would not reparent a document would be a
//    far worse bug than the mess section 82 exists to clean up.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const home = drive.folder('Program Registration System', drive.root.getId());
  const s = load(drive, home.getId());
  const target = drive.folder('Form Images', home.getId());
  const doc = drive.file('a picture', drive.root.getId());

  check('a file is filed, and says it was', s.moveDriveFileInto(doc, target, 'a picture'), true);
  check('...and it really moved', doc.parentId, target.getId());
  check('driveFileIsIn agrees', s.driveFileIsIn(doc, target), true);

  // moveTo() refused, addFile() carries it — the Drive-v2 fallback `50`
  // worked out, still doing its job.
  const awkward = drive.file('awkward', drive.root.getId());
  awkward.moveTo = () => { throw new Error('not today'); };
  check('a refused moveTo() falls back to addFile()',
    s.moveDriveFileInto(awkward, target, 'an awkward file'), true);
  check('...and the file is home anyway', awkward.parentId, target.getId());

  // Both refused — the shared-drive case. Reported, never thrown.
  const stubborn = drive.file('stuck', drive.root.getId());
  stubborn.moveTo = () => { throw new Error('shared drive says no'); };
  const walled = drive.folder('Walled', home.getId());
  walled.addFile = () => { throw new Error('shared drive says no'); };
  let threw = false;
  let moved;
  try { moved = s.moveDriveFileInto(stubborn, walled, 'a stuck file'); }
  catch (err) { threw = true; }
  check('a Drive that refuses both calls does not throw', threw, false);
  check('...it reports the failure instead', moved, false);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll drive organization checks passed.');
process.exit(failures ? 1 : 0);
