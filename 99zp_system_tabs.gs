// ============================================================================
// 99zp. A FRONT OFFICE AND A BACK ROOM  (hide and protect the machine's tabs)
// ============================================================================
//
// The workbook shows staff some twenty tabs, and several of them are tabs
// nobody should ever type in: the registration ledger (an append-only record a
// hand edit FALSIFIES), the triage parking lot, the monthly metrics record, the
// pending-tag queue, Quick Mark's packed cache, and two retired tabs from older
// layouts. They sat in the tab strip beside the dashboards, and the only thing
// between a stray click and a rewritten history was nothing.
//
// This hides them and puts a WARNING-ONLY protection on each. It moves nothing
// and restricts nobody — see docs/transitions/R7_system_tabs.md for the whole
// reasoning, and in particular why the protection is never an editors list (it
// would lock the trigger owner out of the ledger, silently, inside every
// writer's try).
//
// THE LIST IS OF THE HIDDEN TABS, and the visible set is its complement.
// Declaring the visible set instead would hide every tab this code does not
// know about — the office's own notes tab first. A tab not on this list is
// never touched.
//
// Safe at the end for the usual reason: behavior only, SYSTEM_TAB_NAMES is lazy
// (it reads SHEET_NAMES and three other files' tab-name constants), the other
// constants stand alone, and every caller (13's reorderTabs, 27's sync, 83's
// metrics item, 16's menu) reaches it through a hoisted function declaration.

/**
 * THE BACK ROOM. Every tab here is hidden and warning-protected when it exists;
 * a missing one is skipped silently. 'Ledger_Checkpoint' is spelled out rather
 * than read off SHEET_NAMES because the session that adds that tab may not have
 * landed yet — the string is the contract.
 */
defineLazyGlobal_('SYSTEM_TAB_NAMES', () => [
  SHEET_NAMES.REGISTRATION_LEDGER,
  SHEET_NAMES.LEDGER_CHECKPOINT || 'Ledger_Checkpoint',
  SHEET_NAMES.TRIAGE,
  SHEET_NAMES.METRICS,
  PENDING_FLAG_SHEET_NAME,
  QUICK_MARK_INDEX_SHEET_NAME,
  LEGACY_ACTIVE_PROGRAMS_SHEET_NAME,
  LEGACY_REGISTRANT_NOTIFICATIONS_SHEET_NAME
].filter((name, i, all) => name && all.indexOf(name) === i));

/** How a protection this file added is recognized again — never one somebody else made. */
const SYSTEM_TAB_PROTECTION_DESCRIPTION =
  'System tab — written by the registration system. Edits here are usually a mistake.';

/** The Config dropdown. Blank reads as the default, which is on. */
const SYSTEM_TABS_HIDE_OPTIONS = ['Yes', 'No'];
const DEFAULT_HIDE_SYSTEM_TABS = true;

/** "Show / Hide System Tabs" shows them for this long before the daily pass may hide them again. */
const SYSTEM_TABS_SHOW_WINDOW_MS = 2 * 60 * 60 * 1000;
const SYSTEM_TABS_SHOWN_UNTIL_PROP_KEY = 'SYSTEM_TABS_SHOWN_UNTIL_V1';
/** The yyyy-MM-dd the daily pass last ran on. */
const SYSTEM_TABS_APPLIED_ON_PROP_KEY = 'SYSTEM_TABS_APPLIED_ON_V1';

let __systemTabVisibilityAppliedThisRun = false;

/** The front office by name: TAB_GROUPS minus the back room. For anything that wants the visible set. */
function frontOfficeTabNames() {
  const back = new Set(SYSTEM_TAB_NAMES);
  return builtInTabOrder().filter(name => !back.has(name));
}

function isSystemTabName(name) {
  return SYSTEM_TAB_NAMES.indexOf(String(name || '')) !== -1;
}

/** Config's Hide_System_Tabs. Anything but a literal "No" means hide — fails toward the default. */
function isSystemTabHidingEnabled() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.CONFIG);
    if (!sheet) return DEFAULT_HIDE_SYSTEM_TABS;
    const raw = String(sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.SYSTEM_TABS.startCol)
      .getValue() || '').trim().toLowerCase();
    if (raw === '') return DEFAULT_HIDE_SYSTEM_TABS;
    return raw !== 'no';
  } catch (err) {
    return DEFAULT_HIDE_SYSTEM_TABS;
  }
}

function seedSystemTabsRow(sheet) {
  const cell = sheet.getRange(CONFIG_DATA_START_ROW, CONFIG_LAYOUT.SYSTEM_TABS.startCol);
  if (String(cell.getValue() || '').trim() === '') cell.setValue(SYSTEM_TABS_HIDE_OPTIONS[0]); // 'Yes'
  cell.setNote('"Yes" hides the tabs only this system writes — ' + SYSTEM_TAB_NAMES.join(', ') +
    ' — and puts a warning on each, so a stray edit asks first. Nothing is moved and nobody is locked ' +
    'out: the syncs read and write them exactly as before.\n\n' +
    '"No" shows them all again and takes the warnings off, at the next layout rebuild or the next ' +
    'day\'s sync. To look for a moment instead, use Admin ▸ Appearance ▸ Show / Hide System Tabs.');
}

function systemTabsShownUntil_() {
  try {
    return Number(PropertiesService.getScriptProperties().getProperty(SYSTEM_TABS_SHOWN_UNTIL_PROP_KEY)) || 0;
  } catch (err) {
    return 0;
  }
}

/** Our protection on `sheet`, or null. */
function findSystemTabProtection_(sheet) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) || [];
  for (let i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === SYSTEM_TAB_PROTECTION_DESCRIPTION) return protections[i];
  }
  return null;
}

/**
 * Put every system tab in the state Config asks for. IDEMPOTENT and CHEAP:
 * one getSheets(), then per existing system tab one isSheetHidden() and one
 * getProtections(); a write only where a tab is in the wrong state.
 *
 *   opts.hide        override Config (true hides, false shows)
 *   opts.protect     override "protect when hiding" (defaults to opts.hide)
 *
 * NEVER THROWS — a tab that will not hide must not cost a sync or a setup.
 * Returns { hidden, shown, protected, unprotected, errors }.
 */
function applySystemTabVisibility(opts) {
  const options = opts || {};
  const result = { hidden: [], shown: [], protected: [], unprotected: [], errors: [] };
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (err) {
    result.errors.push(String(err));
    return result;
  }
  if (!ss) return result;

  const hide = options.hide !== undefined ? !!options.hide : isSystemTabHidingEnabled();
  const protect = options.protect !== undefined ? !!options.protect : hide;

  let sheets = [];
  try { sheets = ss.getSheets() || []; } catch (err) { result.errors.push(String(err)); return result; }
  const wanted = new Set(SYSTEM_TAB_NAMES);
  const targets = sheets.filter(sheet => wanted.has(sheet.getName()));
  const visibleOthers = sheets.filter(sheet => !wanted.has(sheet.getName()) && !safeIsHidden_(sheet));

  if (hide && targets.length && visibleOthers.length) {
    // A sheet cannot be hidden while it is the active one in some builds, and
    // hiding the active tab leaves the person looking at nothing. Step off it.
    try {
      const active = ss.getActiveSheet();
      if (active && wanted.has(active.getName())) ss.setActiveSheet(visibleOthers[0]);
    } catch (err) { /* no active sheet in a trigger — nothing to step off */ }
  }

  targets.forEach(sheet => {
    const name = sheet.getName();
    try {
      const isHidden = safeIsHidden_(sheet);
      if (hide && !isHidden) {
        // The last visible tab can never be hidden; leave it be.
        if (visibleOthers.length) { sheet.hideSheet(); result.hidden.push(name); }
      } else if (!hide && isHidden) {
        sheet.showSheet();
        result.shown.push(name);
      }
    } catch (err) {
      result.errors.push(`${name}: ${err}`);
    }
    try {
      const existing = findSystemTabProtection_(sheet);
      if (protect) {
        if (!existing) {
          sheet.protect().setDescription(SYSTEM_TAB_PROTECTION_DESCRIPTION).setWarningOnly(true);
          result.protected.push(name);
        } else if (typeof existing.isWarningOnly === 'function' && !existing.isWarningOnly()) {
          // Somebody hardened it into an editors list. That locks the trigger
          // owner out of the ledger — put it back to a warning.
          existing.setWarningOnly(true);
          result.protected.push(name);
        }
      } else if (existing) {
        existing.remove();
        result.unprotected.push(name);
      }
    } catch (err) {
      result.errors.push(`${name} (protection): ${err}`);
    }
  });

  if (result.hidden.length || result.shown.length || result.protected.length || result.unprotected.length) {
    log(`System tabs: hidden [${result.hidden.join(', ')}], shown [${result.shown.join(', ')}], ` +
      `protected [${result.protected.join(', ')}], unprotected [${result.unprotected.join(', ')}].`);
  }
  if (result.errors.length) log(`ℹ️ System tabs: ${result.errors.join('; ')}`);
  __systemTabVisibilityAppliedThisRun = true;
  return result;
}

function safeIsHidden_(sheet) {
  try { return !!sheet.isSheetHidden(); } catch (err) { return false; }
}

/**
 * The daily pass, from the hourly sync. One property read when it is not due.
 * Due when today's date differs from the last run's, or when an admin's
 * "show for a while" window has just lapsed. Inside that window it does
 * nothing — the admin asked to see them.
 */
function applySystemTabVisibilityIfDue_() {
  if (__systemTabVisibilityAppliedThisRun) return false;
  try {
    const props = PropertiesService.getScriptProperties();
    const shownUntil = systemTabsShownUntil_();
    const now = Date.now();
    if (shownUntil && now < shownUntil) return false;
    const today = Utilities.formatDate(new Date(now), TIMEZONE, 'yyyy-MM-dd');
    if (!shownUntil && props.getProperty(SYSTEM_TABS_APPLIED_ON_PROP_KEY) === today) return false;
    applySystemTabVisibility();
    if (shownUntil) props.deleteProperty(SYSTEM_TABS_SHOWN_UNTIL_PROP_KEY);
    props.setProperty(SYSTEM_TABS_APPLIED_ON_PROP_KEY, today);
    return true;
  } catch (err) {
    log(`ℹ️ Could not check the system tabs' visibility (${err}).`);
    return false;
  }
}

/**
 * MENU ACTION (Admin ▸ Appearance): show the back room for a while, or hide it
 * again now. Ungated — a hidden tab is one View ▸ Hidden sheets away for any
 * editor already; this is a convenience, not access. Protection stays on while
 * the tabs are shown.
 */
function toggleSystemTabVisibility() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const present = SYSTEM_TAB_NAMES.map(name => ss.getSheetByName(name)).filter(Boolean);
  if (!present.length) {
    toastIfPossible('There are no system tabs in this workbook yet.');
    return 'none';
  }
  const anyHidden = present.some(sheet => safeIsHidden_(sheet));
  const props = PropertiesService.getScriptProperties();
  if (anyHidden) {
    applySystemTabVisibility({ hide: false, protect: isSystemTabHidingEnabled() });
    props.setProperty(SYSTEM_TABS_SHOWN_UNTIL_PROP_KEY, String(Date.now() + SYSTEM_TABS_SHOW_WINDOW_MS));
    toastIfPossible(`Showing ${present.length} system tab(s) for the next two hours. ` +
      'Press Show / Hide System Tabs again to tuck them away now.');
    return 'shown';
  }
  props.deleteProperty(SYSTEM_TABS_SHOWN_UNTIL_PROP_KEY);
  const result = applySystemTabVisibility();
  toastIfPossible(result.hidden.length
    ? `Hid ${result.hidden.length} system tab(s).`
    : 'System tabs are set to stay visible (Config ▸ Hide_System_Tabs is "No").');
  return 'hidden';
}

/**
 * Open a system tab for somebody who asked for it by menu: SHOW, then activate.
 * Activating a hidden tab un-hides it anyway, but saying so explicitly is what
 * keeps this working if Google ever stops doing that. The daily pass tucks it
 * away again.
 */
function openSystemTab_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) return null;
  try { if (safeIsHidden_(sheet)) sheet.showSheet(); } catch (err) { /* activate below shows it */ }
  try { ss.setActiveSheet(sheet); } catch (err) { /* no UI */ }
  return sheet;
}

/** EDITOR-ONLY rollback: show every system tab and lift our protections, now. Set Config to "No" to keep it so. */
function showAllSystemTabsPermanently_() {
  return applySystemTabVisibility({ hide: false, protect: false });
}
