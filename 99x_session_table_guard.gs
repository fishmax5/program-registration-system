// ============================================================================
// SECTION 99x: THE SESSION TABLE IS NEVER REDRAWN FROM NOTHING
// ============================================================================
//
// `renderProgramDashboard()` (43) rebuilds All_Program_Sessions the way `34`
// rebuilds All_Registrants: read the tab, work on the rows in memory, write
// them all back. `99j` guards the registrant tab against a short read; nothing
// guarded this one, and on 2026-09-25 at 19:09 a registration sync slice
// (REl-Dw) read the session table while another run's redraw had it empty,
// logged "renderProgramDashboard complete: 0 upcoming / 0 past", and wrote the
// table back with nothing in it. Every slice after it then read an empty
// session table and pushed ~33 program registrant sheets with no sessions to
// match against. The overlap itself is fixed in `99w`; this is the second
// line, because a render that is about to write a fraction of what the table
// last held is wrong whatever made it so.
//
// `guardSessionTableShrink()` is asked immediately before the write, with the
// rows about to be written, and compares them with the count the last
// successful render left (`SESSION_TAB_LAST_COUNT_PROP_KEY`). It REFUSES —
// throws, so the sync records the step as failed and carries on, and a menu
// run says so — when the table would go to zero from at least
// `SESSION_GUARD_EMPTY_MIN_ROWS`, or lose more than
// `SESSION_GUARD_REFUSE_FRACTION` of itself AND at least
// `SESSION_GUARD_REFUSE_MIN_ROWS` rows. Nothing ordinary does either: triage
// has its own cap, and the two removals that legitimately take a large share
// (`84`'s leftover-calendar rows, `99l`'s duplicates) are confirmed by a
// person and pass `allowShrink`. A table genuinely lost is rebuilt by Sync
// Calendars, which re-adds every date it finds missing before it renders, so
// the guard never stands in the way of the repair.
// ============================================================================

const SESSION_TAB_LAST_COUNT_PROP_KEY = 'SESSION_TAB_LAST_COUNT_V1';
const SESSION_GUARD_EMPTY_MIN_ROWS = 20;
const SESSION_GUARD_REFUSE_FRACTION = 0.5;
const SESSION_GUARD_REFUSE_MIN_ROWS = 50;

/** The count the last successful render wrote, or null. Never throws. */
function readLastSessionTableCount() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(SESSION_TAB_LAST_COUNT_PROP_KEY);
    const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    return isFinite(n) && n >= 0 ? n : null;
  } catch (err) {
    return null;
  }
}

function recordSessionTableCount(count) {
  try {
    PropertiesService.getScriptProperties().setProperty(SESSION_TAB_LAST_COUNT_PROP_KEY, String(count));
  } catch (err) {
    // The next render records it.
  }
}

/** The refusal sentence, or '' when `next` rows may replace `last`. Pure. */
function sessionTableShrinkRefusal(last, next) {
  if (last === null || last === undefined || !(last > 0)) return '';
  if (next === 0 && last >= SESSION_GUARD_EMPTY_MIN_ROWS) {
    return `the session table was about to be written EMPTY, when the last redraw left ${last} row(s) on it`;
  }
  const lost = last - next;
  if (lost >= SESSION_GUARD_REFUSE_MIN_ROWS && next < last * (1 - SESSION_GUARD_REFUSE_FRACTION)) {
    return `the session table was about to go from ${last} row(s) to ${next}`;
  }
  return '';
}

/**
 * Throws when writing `rowCount` session rows would be a loss no ordinary path
 * produces. `options.allowShrink` is for a removal a person confirmed.
 */
function guardSessionTableShrink(rowCount, options) {
  if (options && options.allowShrink) return;
  const last = readLastSessionTableCount();
  const why = sessionTableShrinkRefusal(last, rowCount);
  if (!why) return;
  const message = `Refused to redraw All_Program_Sessions: ${why}. Nothing was written. This is what an ` +
    `overlapping run, or a read of the tab while another run was rewriting it, looks like — the tab is ` +
    `left exactly as it was. If sessions really are missing from it, run Sync Calendars (it puts back every ` +
    `date it finds missing) or restore the tab from File ▸ Version history.`;
  log(`⛔ ${message}`);
  try { noteForAdmin('The session table was protected from an empty redraw', message); } catch (err) { /* logged */ }
  throw new Error(message);
}
