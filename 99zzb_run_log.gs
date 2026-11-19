// ============================================================================
// 99zzb. THE RUN LOG  (every log() line, on a tab anybody can read — Nov 2026)
// ============================================================================
//
// THE LOG EXISTED; NOBODY COULD READ IT WITHOUT THE EDITOR. Every log() line
// goes to console.log, which lands in Cloud Logging under the Apps Script
// project. Reading it takes the Apps Script editor's Executions page or a
// clasp login on one particular laptop (tools/fetch_logs.py). So "what did the
// 05:00 sync actually do?" could only be answered by the one person with that
// login, and only by hand. The office digest (88) says what NEEDS doing; it
// was never meant to say what HAPPENED.
//
// SO log() NOW ALSO WRITES HERE. One hidden tab, Run_Log, in this workbook,
// one row per line: when, which execution, which run (the workbook lock's
// label, when one is held), a level, and the line. Anyone who can open the
// workbook — or anything that reads it, such as a Sheets connector — can read
// it. It adds nothing to who can see what: every line on it was written by
// this script about rows already in this workbook.
//
// HOW IT STAYS CHEAP. log() is called thousands of times in a long sync, so a
// sheet write per line is out of the question. Lines are BUFFERED in memory
// and written in ONE setValues() at:
//   - the points every execution already flushes at — flushPersistentRegistries()
//     (06) and withScriptLock()'s finally (06), the same two the ledger rides;
//   - from log() itself, at most once a minute (RUN_LOG_FLUSH_EVERY_MS), so a
//     run killed at the six- or thirty-minute ceiling (no `finally`) still
//     leaves everything up to its last minute;
//   - at once for an ERROR line, a few times per run at most, because the line
//     you most need is the one written just before the execution died.
// A run keeps at most RUN_LOG_MAX_LINES_PER_RUN lines, info lines capped
// lower than warnings and errors, and says how many it dropped. The tab keeps
// the newest RUN_LOG_MAX_ROWS rows and trims the oldest in one deleteRows()
// once it is RUN_LOG_TRIM_SLACK past that.
//
// WHAT IT IS NOT. Not a record anything reads back — nothing in this project
// reads Run_Log, so a lost or doubled line costs a reader a line and nothing
// else. That is why the append takes no lock and two overlapping executions
// may, rarely, write over each other's last batch: a lock here would be a lock
// taken inside log(), which is called from inside every other lock. Nor does it
// catch an exception nobody caught: those still go only to Cloud Logging and
// the trigger owner's failure mail.
//
// NEVER THROWS, NEVER RECURSES. log() is called from everywhere, including
// from inside writes that must not be interrupted. Every step here is guarded,
// its own failures go to console.log only, and a line logged while a flush is
// in progress (getOrCreateSheet's "Created missing tab") is buffered, not
// flushed from inside the flush.
//
// LOAD ORDER. Behavior plus self-contained constants. SHEET_NAMES.RUN_LOG and
// HEADERS.Run_Log are in 03 and read at call time; the per-execution state is
// a `var` with no initializer, so a log() call that comes before this file has
// evaluated finds it undefined (and starts it) rather than hitting a
// temporal-dead-zone error the way a `let` would.
// ============================================================================

/** The switch. False makes log() exactly what it was: console only. */
const RUN_LOG_ENABLED = true;

/** Rows the tab keeps (newest), and how far past that it may grow before one trim. */
const RUN_LOG_MAX_ROWS = 5000;
const RUN_LOG_TRIM_SLACK = 500;

/** Per execution: lines kept in all, and the lower cap for plain info lines. */
const RUN_LOG_MAX_LINES_PER_RUN = 400;
const RUN_LOG_MAX_INFO_LINES_PER_RUN = 200;

/** A buffered line waits at most this long for a write, from log() itself. */
const RUN_LOG_FLUSH_EVERY_MS = 60 * 1000;

/** How many times one execution may flush at once for an ERROR line. */
const RUN_LOG_MAX_ERROR_FLUSHES = 5;

/** One cell's worth of a line — far under Sheets' 50,000, and enough for a stack. */
const RUN_LOG_MAX_MESSAGE_CHARS = 2000;

const RUN_LOG_LEVELS = Object.freeze({ INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' });

// Per EXECUTION (Apps Script gives each one a fresh global scope). Deliberately
// `var` without an initializer: see LOAD ORDER above.
var __runLogState;

function runLogState_() {
  if (!__runLogState) {
    __runLogState = {
      buffer: [],          // rows not yet written
      kept: 0,             // lines this execution has kept
      keptInfo: 0,
      dropped: 0,          // lines past the caps
      droppedReported: 0,  // how many of those a "not kept" line already said
      firstPendingAt: 0,   // when the oldest buffered line was logged
      errorFlushes: 0,
      flushing: false
    };
  }
  return __runLogState;
}

/**
 * The level of a line, read off the way this codebase already writes them:
 * ⚠️ and 🚨 open a warning, ❌ or an exception's name marks an error. A
 * heuristic, and a deliberate one — the alternative is changing a thousand
 * log() calls to say their own level.
 */
function runLogLevel_(msg) {
  const text = String(msg);
  if (/❌/.test(text) || /\b(Exception|TypeError|ReferenceError|RangeError|SyntaxError)\b/.test(text) ||
      /\bthrew\b/i.test(text)) {
    return RUN_LOG_LEVELS.ERROR;
  }
  if (/⚠️|⚠|🚨/.test(text)) return RUN_LOG_LEVELS.WARN;
  return RUN_LOG_LEVELS.INFO;
}

/**
 * What goes in the Message cell. Capped, and a line that starts like a formula
 * (`=`, `+`, `-`, `@`) is quoted so setValues() stores it as text: a log line
 * such as "-3 rows" or "=== section ===" would otherwise be parsed, and a
 * title typed onto a calendar would be a formula on this tab.
 */
function runLogMessageCell_(msg) {
  let text = msg instanceof Error ? (msg.stack || String(msg)) : String(msg);
  if (text.length > RUN_LOG_MAX_MESSAGE_CHARS) {
    text = text.substring(0, RUN_LOG_MAX_MESSAGE_CHARS - 1) + '…';
  }
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/** This execution's short id, and the label of the workbook lock it holds ('' when none). */
function runLogExecution_() {
  let id = '';
  let label = '';
  try { id = String(workbookLockExecId_get_() || '').substring(0, 8); } catch (err) { /* no id */ }
  try { label = workbookLockDepth_ > 0 ? String(workbookLockLabel_ || '') : ''; } catch (err) { /* no lock */ }
  return { id, label };
}

/** Called by log(). Buffers one line and flushes when it is time. Never throws. */
function recordRunLogLine(msg) {
  if (!RUN_LOG_ENABLED) return;
  try {
    const state = runLogState_();
    const level = runLogLevel_(msg);
    const isInfo = level === RUN_LOG_LEVELS.INFO;
    if (state.kept >= RUN_LOG_MAX_LINES_PER_RUN ||
        (isInfo && state.keptInfo >= RUN_LOG_MAX_INFO_LINES_PER_RUN)) {
      state.dropped++;
      return;
    }
    const exec = runLogExecution_();
    state.buffer.push([new Date(), exec.id, exec.label, level, runLogMessageCell_(msg)]);
    state.kept++;
    if (isInfo) state.keptInfo++;
    const now = Date.now();
    if (!state.firstPendingAt) state.firstPendingAt = now;

    if (state.flushing) return;
    if (level === RUN_LOG_LEVELS.ERROR && state.errorFlushes < RUN_LOG_MAX_ERROR_FLUSHES) {
      state.errorFlushes++;
      flushRunLog();
    } else if (now - state.firstPendingAt >= RUN_LOG_FLUSH_EVERY_MS) {
      flushRunLog();
    }
  } catch (err) {
    try { console.log(`Run_Log: could not record a line (${err}).`); } catch (e) { /* nothing left */ }
  }
}

/** The tab, created hidden with its header row the first time a line needs it. */
function runLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  const existing = ss.getSheetByName(SHEET_NAMES.RUN_LOG);
  if (existing) return existing;
  const sheet = getOrCreateSheet(ss, SHEET_NAMES.RUN_LOG);
  const headers = HEADERS.Run_Log;
  sheet.getRange(1, 1, 1, headers.length).setValues([headers.slice()]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  try { sheet.hideSheet(); } catch (err) { /* 99zp hides it on its daily pass anyway */ }
  return sheet;
}

/**
 * Writes everything buffered in one setValues() past the last row, then trims
 * the oldest rows when the tab has grown RUN_LOG_TRIM_SLACK past its cap.
 * Returns the rows written. Never throws; a refused write keeps the lines for
 * the next flush.
 */
function flushRunLog() {
  if (!RUN_LOG_ENABLED) return 0;
  let state;
  try { state = runLogState_(); } catch (err) { return 0; }
  if (state.flushing) return 0;
  if (state.dropped > state.droppedReported) {
    const exec = runLogExecution_();
    state.buffer.push([new Date(), exec.id, exec.label, RUN_LOG_LEVELS.INFO,
      `(${state.dropped - state.droppedReported} more line(s) from this run were not kept — ` +
      `a run keeps ${RUN_LOG_MAX_LINES_PER_RUN}, at most ${RUN_LOG_MAX_INFO_LINES_PER_RUN} of them plain info.)`]);
    state.droppedReported = state.dropped;
  }
  if (!state.buffer.length) return 0;

  state.flushing = true;
  try {
    const sheet = runLogSheet_();
    if (!sheet) return 0;
    const rows = state.buffer.slice();
    const width = HEADERS.Run_Log.length;
    const start = Math.max(sheet.getLastRow(), 1) + 1;   // never row 1: the header
    sheet.getRange(start, 1, rows.length, width).setValues(rows);
    state.buffer = state.buffer.slice(rows.length);
    state.firstPendingAt = state.buffer.length ? Date.now() : 0;

    const dataRows = start + rows.length - 2;
    if (dataRows > RUN_LOG_MAX_ROWS + RUN_LOG_TRIM_SLACK) {
      try { sheet.deleteRows(2, dataRows - RUN_LOG_MAX_ROWS); } catch (err) {
        console.log(`Run_Log: could not trim old rows (${err}).`);
      }
    }
    return rows.length;
  } catch (err) {
    try { console.log(`Run_Log: could not write ${state.buffer.length} line(s) (${err}); kept for the next flush.`); } catch (e) { /* nothing left */ }
    return 0;
  } finally {
    state.flushing = false;
  }
}
