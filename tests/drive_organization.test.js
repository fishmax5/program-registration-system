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
    const born = next;
    const self = {
      id, name, parentId, isFolder: true,
      getId: () => id,
      getName: () => self.name,
      // Creation order is the id order — what pickSystemFolder_() sorts on.
      getDateCreated: () => new Date(2026, 0, 1, 0, 0, born),
      getFolders: () => iter(Object.keys(byId).map(k => byId[k])
        .filter(f => f.isFolder && f.parentId === self.id)),
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
      GOOGLE_DOCS: 'application/vnd.google-apps.document',
      CSV: 'text/csv'
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
this.getSystemOnlyFolder = getSystemOnlyFolder;
this.SYSTEM_SUBFOLDER_NAME = SYSTEM_SUBFOLDER_NAME;
this.TEMPLATE_FORM_PROP_KEY = TEMPLATE_FORM_PROP_KEY;
this.PUBLIC_SNAPSHOT_FILE_PROP_KEY = PUBLIC_SNAPSHOT_FILE_PROP_KEY;
`, sandbox, { filename: 'program.gs' });
  sandbox.__props = props;
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
    return hit ? hit.folder : null;
  };

  check('the template form is recognized, and buried in System',
    match('TEMPLATE — Registration Form Base (do not edit or delete)', FORMS), 'System');
  check('a leader sheet under its old name is recognized',
    match('Sign-Up Sheet — Chair Yoga (Narberth)', SHEETS), s.LEADER_SHEET_FOLDER_NAME);
  check('a leader sheet under its current name is recognized',
    match('Registrant Sheet — Chair Yoga (Narberth)', SHEETS), s.LEADER_SHEET_FOLDER_NAME);
  check("somebody's own COPY of a registrant sheet is left alone",
    match('Copy of Registrant Sheet — Advanced Stitch Club (Ashbridge)', SHEETS), null);
  check('a registrant snapshot CSV is recognized',
    match('All_Registrants 2026-10-01_0355 (daily).csv', 'text/csv'), 'Registrant Snapshots');
  check('a ledger archive CSV is recognized',
    match('Registration_Ledger compacted 2026-09-30_1112 (42 entries).csv', 'text/csv'), 'Ledger Archive');
  check('the public schedule JSON is recognized',
    match('public-schedule-snapshot.json', 'application/json'), 'Public Schedule Snapshot');
  check('a CSV somebody exported by hand is left alone',
    match('All_Registrants export for Jane.csv', 'text/csv'), null);
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

// ---------------------------------------------------------------------------
// 7. TWO SHELVES (82b). A system-only folder lives in <anchor>/System; a
//    staff-facing one stays at the anchor's top level; and a lookup never
//    drags a folder from one shelf to the other except the one way the
//    upgrade needs (top level → System, for a system-only folder).
// ---------------------------------------------------------------------------
const SYS = { systemOnly: true };
{
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const s = load(drive, home.getId());

  const staff = s.getOrCreateSystemFolder('Sign-In Sheets');
  check('a staff folder is created at the top level', staff.parentId, home.getId());
  check('...and a staff lookup does not create an empty System folder',
    s.getSystemOnlyFolder(false), null);

  const made = s.getOrCreateSystemFolder('Registrant Snapshots', null, SYS);
  const sys = s.getSystemOnlyFolder(false);
  check('a system-only lookup creates System inside the anchor',
    !!sys && sys.parentId, home.getId());
  check('...named System', sys.getName(), 'System');
  check('...and creates the folder inside System', made.parentId, sys.getId());

  s.clearSystemFolderCache();
  check('a second system-only lookup finds the same folder',
    s.getOrCreateSystemFolder('Registrant Snapshots', null, SYS).getId(), made.getId());
}

{
  // The upgrade path: a system-only folder at the anchor's top level, full of
  // files with live links, is MOVED into System — same id, not a new one.
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const old = drive.folder('Program Registration Forms', home.getId());
  const form = drive.file('Chair Yoga - October 2026', old.getId(), 'application/vnd.google-apps.form');
  const s = load(drive, home.getId());

  const got = s.getOrCreateSystemFolder('Program Registration Forms', null, SYS);
  const sys = s.getSystemOnlyFolder(false);
  check('a top-level system-only folder is adopted, not duplicated', got.getId(), old.getId());
  check('...moved into System', got.parentId, sys.getId());
  check('...with its files still inside it', form.parentId, old.getId());
  check('...and no second folder of that name anywhere',
    Object.keys(drive.byId).filter(k => drive.byId[k].isFolder &&
      drive.byId[k].name === 'Program Registration Forms').length, 1);
}

{
  // NEVER FIGHT: a staff folder somebody has put inside System is used where
  // it is. The Drive-wide fallback would otherwise find it and drag it out.
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const sys = drive.folder('System', home.getId());
  const tucked = drive.folder('Sign-In Sheets', sys.getId());
  const s = load(drive, home.getId());

  const got = s.getOrCreateSystemFolder('Sign-In Sheets');
  check('a staff folder found in System is the one returned', got.getId(), tucked.getId());
  check('...and it is left in System, not moved back', got.parentId, sys.getId());
}

{
  // NEVER FIGHT, the other half: a legacy-named folder already on a shelf is
  // renamed in place and not moved between the anchor and System.
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const sys = drive.folder('System', home.getId());
  const s = load(drive, home.getId());
  const old = drive.folder(s.LEGACY_LEADER_SHEET_FOLDER_NAMES[1], sys.getId());

  const got = s.getOrCreateSystemFolder(s.LEADER_SHEET_FOLDER_NAME, s.LEGACY_LEADER_SHEET_FOLDER_NAMES);
  check('a legacy folder already in System is adopted', got.getId(), old.getId());
  check('...renamed', got.getName(), s.LEADER_SHEET_FOLDER_NAME);
  check('...and left where it is', got.parentId, sys.getId());
}

{
  // A system-only folder loose elsewhere in Drive goes into System.
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const stray = drive.folder('Ledger Archive', drive.root.getId());
  const s = load(drive, home.getId());
  const got = s.getOrCreateSystemFolder('Ledger Archive', null, SYS);
  check('a stray system-only folder is adopted', got.getId(), stray.getId());
  check('...into System', got.parentId, s.getSystemOnlyFolder(false).getId());
}

{
  // "System" is far too generic to adopt Drive-wide.
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const theirs = drive.folder('System', drive.root.getId());
  const s = load(drive, home.getId());
  const sys = s.getSystemOnlyFolder();
  check("somebody else's System folder is never adopted", sys.getId() !== theirs.getId(), true);
  check('...ours is made inside the anchor', sys.parentId, home.getId());
  check('...and theirs is not moved', theirs.parentId, drive.root.getId());
}

{
  // Twins from racing executions: every run picks the EARLIEST, so they stop
  // diverging.
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const first = drive.folder('Public Schedule Snapshot', home.getId());
  drive.folder('Public Schedule Snapshot', home.getId());
  const s = load(drive, home.getId());
  check('of two twins, the earlier-created is chosen',
    s.getOrCreateSystemFolder('Public Schedule Snapshot').getId(), first.getId());
}

{
  // No anchor: a system-only lookup still returns a working folder.
  const drive = makeDrive();
  const s = load(drive, null);
  check('no anchor means no System', s.getSystemOnlyFolder(), null);
  const made = s.getOrCreateSystemFolder('Ledger Archive', null, SYS);
  check('...and a system-only folder is still returned', !!made && made.getName(), 'Ledger Archive');
}

// ---------------------------------------------------------------------------
// 8. THE SWEEP. Folders onto their shelves, twins buried beside them, the
//    registered and the loose files filed — and nothing a person made moved.
// ---------------------------------------------------------------------------
{
  const drive = makeDrive();
  const home = drive.folder('Event Drive', drive.root.getId());
  const s = load(drive, home.getId());
  const FORMS = 'application/vnd.google-apps.form';
  const SHEETS = 'application/vnd.google-apps.spreadsheet';

  const formsFolder = drive.folder('Program Registration Forms', home.getId());
  const snaps = drive.folder('Registrant Snapshots', home.getId());
  const pubA = drive.folder('Public Schedule Snapshot', home.getId());
  const pubB = drive.folder('Public Schedule Snapshot', home.getId());
  const rosters = drive.folder('Program Registrant Sheets', home.getId());
  const signIns = drive.folder('Sign-In Sheets', home.getId());
  const mine = drive.folder('Notes', home.getId());

  const liveTemplate = drive.file('TEMPLATE — Registration Form Base (do not edit or delete)', home.getId(), FORMS);
  const spareTemplate = drive.file('TEMPLATE — Registration Form Base (do not edit or delete)', home.getId(), FORMS);
  const json = drive.file('public-schedule-snapshot.json', pubA.getId(), 'application/json');
  const looseRoster = drive.file('Registrant Sheet — Chair Yoga (Narberth)', drive.root.getId(), SHEETS);
  const copy = drive.file('Copy of Registrant Sheet — Chair Yoga (Narberth)', drive.root.getId(), SHEETS);
  const looseCsv = drive.file('All_Registrants 2026-10-01_0355 (daily).csv', home.getId(), 'text/csv');
  const workbookTwin = drive.file('Budget 2026', home.getId(), SHEETS);

  s.__props[s.TEMPLATE_FORM_PROP_KEY] = liveTemplate.getId();
  s.__props[s.PUBLIC_SNAPSHOT_FILE_PROP_KEY] = json.getId();
  let alerted = '';
  s.requireAuthorizedAdmin = () => true;
  s.getPersistentFormRegistry = () => ({});
  s.getProgramLeaderSheetRegistry = () => ({});
  s.getSignInSheetRegistry = () => ({});
  s.SpreadsheetApp.getUi = () => ({ alert: (t, m) => { alerted = m; }, ButtonSet: { OK: 'OK' } });

  s.organizeGeneratedFiles();
  const sys = s.getSystemOnlyFolder(false);

  check('the sweep makes System inside the anchor', !!sys && sys.parentId, home.getId());
  check('the forms folder is buried', formsFolder.parentId, sys.getId());
  check('the snapshots folder is buried', snaps.parentId, sys.getId());
  check('the public snapshot folder in use is buried', pubA.parentId, sys.getId());
  check('...and its twin is buried beside it, not left at the top', pubB.parentId, sys.getId());
  check('...with the live JSON still inside the one it was in', json.parentId, pubA.getId());
  check('the registrant sheets folder stays at the top level', rosters.parentId, home.getId());
  check('the sign-in sheets folder stays at the top level', signIns.parentId, home.getId());
  check("a staff member's own folder is untouched", mine.parentId, home.getId());
  check('the live template is filed in System', liveTemplate.parentId, sys.getId());
  check('a spare template at the top level is filed in System too', spareTemplate.parentId, sys.getId());
  check('a loose roster in My Drive goes to the registrant sheets folder', looseRoster.parentId, rosters.getId());
  check("somebody's copy of a roster stays where they put it", copy.parentId, drive.root.getId());
  check('a loose snapshot CSV at the top level goes to the snapshots folder', looseCsv.parentId, snaps.getId());
  check('an unrelated spreadsheet is not moved', workbookTwin.parentId, home.getId());
  check('the summary says something was moved', /^Moved \d+ item/.test(alerted), true);

  // Idempotent: a second run moves nothing.
  s.organizeGeneratedFiles();
  check('a second sweep has nothing to move', /^Nothing to move/.test(alerted), true);
}

console.log(failures ? `\n${failures} failure(s)` : '\nAll drive organization checks passed.');
process.exit(failures ? 1 : 0);
