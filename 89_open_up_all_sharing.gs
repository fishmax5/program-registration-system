// ============================================================================
// 89. EVERY FILE THIS SYSTEM MADE, OPENED BACK UP  (one menu item)
// ============================================================================
//
// THE FAILURE THIS REPAIRS. Every file this project produces is created by
// whoever pressed the button — a real person, signed in as themselves — and
// read and rewritten every hour by whoever owns the triggers, which is
// routinely a DIFFERENT account. Drive gives a new file to its creator alone,
// so the hourly run opens it, is refused, and the work stops without anything
// looking broken:
//
//   a registration form  → responses stop arriving on All_Registrants
//   a registrant sheet   → a leader's ticks never come back, and the refresh
//                          fails with whatever Drive threw that hour
//   a sign-in Doc        → the desk's link opens a file nobody can rebuild
//   a form image         → a picture that will not load on a public form
//   a folder             → the next generated file cannot be filed into it
//
// `46`'s openUpAllFormSharing() already did this for FORMS. Everything else
// was repaired only by the run that happened to touch it (and a registrant
// sheet, only the first time — see pushProgramLeaderSheets()'s accessOpened
// flag), which is no help at all when the file was made before that code
// existed or by an account that has since left. This is the one sweep over
// every artifact whose id this workbook has written down.
//
// IT IS THE SAME TRADE `46` ALREADY MADE, and the banner on
// openUpFileToAnyoneWithLink() states it: the accounts that run this system
// become named editors, and anyone with the link can edit. A registration form
// is a public sign-up page and a roster is first names and ticks; the
// alternative in practice is a file nobody can open and a feature nobody uses.
// FOLDERS are the one exception — they get the named editors and NOT link
// sharing, because a link-editable folder hands over everything inside it,
// including files this sweep deliberately left alone.
//
// RUN IT AS THE ACCOUNT THAT OWNS THE FILES. An account that cannot reach a
// file cannot change its sharing either, so running this from the account
// being refused REPORTS the problem rather than fixing it — per file, by name,
// so the next run can be made from the right account.
//
// IT RESUMES RATHER THAN RESTARTS. A workbook with three hundred artifacts is
// more Drive calls than one execution has time for, so each pass works to a
// deadline and writes down the ids it finished. Pressing the item again picks
// up where it stopped; a pass that reaches the end clears the note, and the
// one after that starts from the top. Every step is idempotent, so a file done
// twice costs a round trip and nothing else.
//
// LOAD ORDER: numbered last, and it may stay there. Behavior only, its own
// three constants stand alone, and everything it reaches for — the registries
// (`06`, `46`, `69`), the folders (`82`), the Config reads (`15`) and
// openUpFileToAnyoneWithLink() (`46`) — it reads at CALL time or through a
// hoisted function declaration.
// ============================================================================

/** Ids already done in the pass that is in flight. See the banner. */
const SHARING_SWEEP_STATE_PROP_KEY = 'OPEN_UP_SHARING_SWEEP_V1';

/**
 * How long one pass works before it stops and says so. Short of the six-minute
 * kill by enough to write its progress down and draw a dialog — the two things
 * that make the next press cost nothing.
 */
const SHARING_SWEEP_BUDGET_MS = 4 * 60 * 1000;

/**
 * A pass older than this is not "in flight" any more, it is abandoned — the
 * execution died, or somebody walked away. Starting fresh is the right answer:
 * the list of artifacts has moved on since, and re-doing a file is a round
 * trip rather than a risk.
 */
const SHARING_SWEEP_STALE_MS = 60 * 60 * 1000;

/**
 * EVERY GOOGLE FILE THIS WORKBOOK HAS AN ID FOR, as `{ id, what, folder }`,
 * in the order they are worth repairing.
 *
 * Read from the SAME registries organizeGeneratedFiles() (`82`) files things
 * by, deliberately: two lists of "what this system made" would drift, and the
 * one that drifts is the one that silently stops repairing something.
 *
 * The registration forms come from the session table's Form_ID column AS WELL
 * AS the persistent registry, because those disagree in both directions — a
 * group whose key changed leaves a form in the registry that no row names, and
 * a form repointed by hand (`47`) is named by rows the registry never heard of.
 * Both are live forms somebody can still submit.
 *
 * Never throws: a registry that cannot be read costs its own entries and
 * nothing else.
 */
function collectGeneratedArtifactTargets() {
  const targets = [];
  const seen = {};
  const add = (id, what, isFolder) => {
    const fileId = String(id || '').trim();
    if (!fileId || seen[fileId]) return;
    seen[fileId] = true;
    targets.push({ id: fileId, what: what, folder: !!isFolder });
  };
  const guarded = (label, fn) => {
    try {
      fn();
    } catch (err) {
      log(`ℹ️ Could not list ${label} for the sharing sweep (${err}) — carrying on with the rest.`);
    }
  };

  // --- forms ---------------------------------------------------------------
  guarded('the registration forms on the session table', () => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD);
    const map = getIndexMap(HEADERS.All_Program_Sessions);
    getSectionedRows(sheet, HEADERS.All_Program_Sessions, 'Event_ID').forEach(row => {
      add(row[map['Form_ID']], 'a registration form');
    });
  });

  guarded('the stored form registry', () => {
    const registry = getPersistentFormRegistry();
    Object.keys(registry).forEach(groupKey => {
      add(registry[groupKey], `the registration form for ${groupKey}`);
    });
  });

  guarded('the lunch sign-up forms', () => {
    const links = getLunchOnlyFormLinks();
    Object.keys(links).forEach(groupKey => {
      add((links[groupKey] || {}).formId, `the lunch sign-up form for ${groupKey}`);
    });
  });

  // The template every form is copied from: one the syncing account cannot
  // open is a workbook that can never build another form.
  guarded('the form template', () => {
    add(getOrCreateTemplateForm().getId(), 'the form template');
  });

  // The door's membership application. Its id is TYPED on Config rather than
  // made here, so this is the one target the workbook may not own at all — and
  // the one where a refusal is an ordinary answer rather than a fault.
  guarded('the membership application form', () => {
    add(getMembershipFormId(), 'the membership application form');
  });

  // --- spreadsheets and documents ------------------------------------------
  guarded('the program registrant sheets', () => {
    const registry = getProgramLeaderSheetRegistry();
    Object.keys(registry).forEach(programKey => {
      const entry = registry[programKey] || {};
      add(entry.fileId, `the registrant sheet for "${entry.title || programKey}"`);
    });
  });

  guarded('the sign-in sheets', () => {
    const registry = getSignInSheetRegistry();
    Object.keys(registry).forEach(key => {
      const entry = registry[key] || {};
      add(entry.fileId, `the sign-in sheet for ${key.replace('|', ' at ')}`);
    });
  });

  // --- the pictures on the forms -------------------------------------------
  // An image is served INTO a form that anyone can open, so a picture only its
  // uploader can read is a form with a broken tile on it. Listed from the
  // folder rather than a registry because there is no registry: `55` uploads
  // them and the form holds the only reference.
  guarded('the form images', () => {
    const files = getOrCreateFormImageFolder().getFiles();
    while (files.hasNext()) {
      const file = files.next();
      add(file.getId(), `the form image "${file.getName()}"`);
    }
  });

  // --- the folders they live in --------------------------------------------
  // Named editors only. A folder open to anyone with the link hands over
  // everything inside it, now and in the future, which is a bigger promise
  // than any single file here makes.
  guarded('this system\'s folders', () => {
    [getSystemRootFolder(),
      getOrCreateFormsFolder(),
      getOrCreateSignInSheetDocFolder(),
      getOrCreateSignInSheetFolder(),
      getOrCreateProgramLeaderSheetFolder(),
      getOrCreateFormImageFolder()
    ].forEach(folder => {
      if (folder) add(folder.getId(), `the "${folder.getName()}" folder`, true);
    });
  });

  return targets;
}

/** The ids finished by the pass in flight, or {} when there is no live pass. */
function getSharingSweepDone_() {
  const raw = PropertiesService.getScriptProperties().getProperty(SHARING_SWEEP_STATE_PROP_KEY);
  if (!raw) return {};
  let state = null;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    // Unreadable progress is no progress. Starting over costs round trips, not
    // correctness — every step here is idempotent.
    log(`ℹ️ The sharing sweep's progress could not be read (${err}) — starting a fresh pass.`);
    return {};
  }
  const startedAt = (state && state.startedAt) || 0;
  if (!startedAt || Date.now() - startedAt > SHARING_SWEEP_STALE_MS) return {};
  return (state && state.done) || {};
}

function saveSharingSweepDone_(done, startedAt) {
  PropertiesService.getScriptProperties().setProperty(SHARING_SWEEP_STATE_PROP_KEY,
    JSON.stringify({ startedAt: startedAt, done: done }));
}

function clearSharingSweepState_() {
  PropertiesService.getScriptProperties().deleteProperty(SHARING_SWEEP_STATE_PROP_KEY);
}

/**
 * MENU ACTION: open up every file this system has made — forms, registrant
 * sheets, sign-in documents, form images — and add the accounts that run it as
 * editors of those and of the folders they sit in.
 *
 * Reports per file rather than summarizing, because "eleven refused this
 * account" and "eleven were already fine" are the two answers somebody is
 * actually asking about, and the refusals name the fix (sign in as the account
 * that made them).
 */
function openUpAllGeneratedFileSharing() {
  if (!requireAuthorizedAdmin('Open Up All File Sharing')) return 0;
  if (!confirmConsequentialAction('Open up every file this system made?',
    'Registration forms, program registrant sheets, sign-in documents and form images are all set to ' +
    '"anyone with the link can edit", and the accounts that run this system are added as editors of ' +
    'them and of the folders they live in.\n\nThis is what lets an hourly sync run by one account read ' +
    'files created by another — which is what most "it stopped updating" faults turn out to be. ' +
    'Nothing is moved, renamed or deleted, and no link changes.', true)) {
    return 0;
  }

  const previouslyDone = getSharingSweepDone_();
  const resuming = Object.keys(previouslyDone).length > 0;
  const startedAt = resuming ? Date.now() - 1 : Date.now(); // a resumed pass keeps its own clock honest
  const done = previouslyDone;

  const targets = collectGeneratedArtifactTargets();
  const deadline = Date.now() + SHARING_SWEEP_BUDGET_MS;

  let opened = 0;
  let skipped = 0;
  let remaining = 0;
  const refused = [];

  targets.forEach(target => {
    if (done[target.id]) { skipped++; return; }
    if (Date.now() >= deadline) { remaining++; return; }

    const outcome = openUpFileToAnyoneWithLink(target.id, target.what,
      { folder: target.folder });
    done[target.id] = true;

    // A folder never asks for link sharing, so "did anything happen" is the
    // editors for those and the link for everything else.
    const worked = target.folder ? outcome.problems.length === 0 : outcome.openedUp;
    if (worked) opened++;
    else refused.push(`${target.what} (${target.id}) — ${outcome.problems.join('; ') || 'Drive refused'}`);
  });

  if (remaining > 0) {
    saveSharingSweepDone_(done, startedAt);
  } else {
    clearSharingSweepState_();
  }

  refused.forEach(line => {
    noteForAdmin('Files whose sharing could not be changed',
      `${line}. This account cannot change its sharing, which almost always means it does not own the ` +
      `file. Sign in as the account that created it and run Open Up All File Sharing again.`);
  });
  flushAdminDigest('File sharing');

  const parts = [`Opened up ${opened} file${opened === 1 ? '' : 's'}.`];
  if (skipped > 0) parts.push(`${skipped} were already done earlier in this pass.`);
  if (refused.length > 0) {
    parts.push(`${refused.length} refused this account — run it again signed in as whoever created them ` +
      `(they are named in the log and in the office digest).`);
  }
  if (remaining > 0) {
    parts.push(`${remaining} left: this pass ran out of time. Press the item again to carry on where it stopped.`);
  }
  const message = parts.join(' ');

  log(`openUpAllGeneratedFileSharing: ${message}`);
  const ui = tryGetUi_();
  if (ui) ui.alert('Open Up File Sharing', message, ui.ButtonSet.OK);
  else toastIfPossible(message);
  return opened;
}

/** The UI, or null where there is none (a trigger, a web app). Never throws. */
function tryGetUi_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (err) {
    return null;
  }
}
