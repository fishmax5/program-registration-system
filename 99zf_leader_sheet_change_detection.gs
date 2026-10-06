// ============================================================================
// 99zf. OPEN A PROGRAM REGISTRANT SHEET ONLY WHEN SOMEBODY HAS TOUCHED IT
// ============================================================================
//
// Every hour the registration sync opened every program registrant sheet
// TWICE in effect — `pullProgramLeaderSheetEdits()` (46) at the head, to read
// the leaders' ticks back in, and the push at the tail, to restamp the
// banner's "Refreshed …" note on a roster that had not moved. About ninety
// foreign spreadsheets, a second or two each to open, to learn on almost
// every one of them that nothing had happened.
//
// Drive already knows. ONE `Drive.Files.list` over the sheets' folder returns
// every file's `modifiedDate`, and a file whose date has not moved since the
// last time the pull READ it cannot hold an edit the pull has not seen. So:
//
//   THE PULL skips a sheet whose modified date is no later than the one it
//   recorded when it last read it (`LEADER_SHEET_PULL_BASELINE_V1`), and says
//   so to the push (`leaderSheetUntouchedThisRun_`).
//
//   THE PUSH, for a sheet the pull skipped whose roster fingerprint still
//   agrees, does nothing at all — no open, no in-flight marker, and no
//   restamp. The restamp had to go: it was itself a modification, so every
//   sheet would have read as touched every hour and nothing would ever be
//   skipped. The banner now says when the roster was last UPDATED, which
//   stays true without being rewritten.
//
// The baseline is DRIVE'S OWN date, never the clock: Drive can report an edit
// a little late, and a baseline that only ever moves to a date Drive has
// reported cannot get ahead of an edit it has not reported yet. A sheet the
// push rewrites moves its own date, so it is read once more on the next run —
// one extra read per rewrite, which is the price of never guessing.
//
// ONCE A DAY NOTHING IS SKIPPED. The push's fingerprint check (`46`) caught a
// sheet whose stored fingerprint claimed a roster its tab did not show — a
// write that was recorded and then lost, which leaves the file's date
// unmoved. That check only runs on a sheet that is opened, so the first sync
// of each day opens every one.
//
// Anything this cannot answer reads as "touched": no Drive service, a listing
// that throws, a sheet outside the folder, a sheet with no baseline yet. The
// cost of being wrong in that direction is the old behavior.
//
// Numbered after `99ze` for the usual reason. Behavior plus self-contained
// constants; everything it reaches for it reads at CALL time.
// ============================================================================

/** { fileId: modifiedDate ms } — Drive's date for each sheet when the pull last read it. */
const LEADER_SHEET_PULL_BASELINE_PROP_KEY = 'LEADER_SHEET_PULL_BASELINE_V1';

/** fileIds the pull left unread this execution because Drive said nothing had changed. */
let __leaderSheetsUntouched = null;

/**
 * { fileId: modifiedDate ms } for every file in the program registrant sheets'
 * folder, or null when that cannot be known.
 */
function leaderSheetModifiedTimes_() {
  try {
    if (typeof Drive === 'undefined' || !Drive.Files || typeof Drive.Files.list !== 'function') return null;
    const folderId = getOrCreateProgramLeaderSheetFolder().getId();
    const times = {};
    let pageToken = null;
    do {
      const page = Drive.Files.list({
        q: `'${folderId}' in parents and trashed = false`,
        maxResults: 1000,
        pageToken: pageToken || undefined,
        fields: 'nextPageToken,items(id,modifiedDate)'
      }) || {};
      (page.items || []).forEach(item => {
        const ms = new Date(item.modifiedDate).getTime();
        if (item.id && isFinite(ms)) times[item.id] = ms;
      });
      pageToken = page.nextPageToken || null;
    } while (pageToken);
    return times;
  } catch (err) {
    log(`ℹ️ Could not ask Drive which program registrant sheets changed (${err}) — reading them all.`);
    return null;
  }
}

/**
 * The pull's plan for this execution: which sheets to leave unread, and what
 * to record for the ones it did read. `save()` once at the end.
 */
function planLeaderSheetPull_() {
  const fullCheck = dailyStepDue_('leader_sheet_full_check');
  // Listed on the full check too: that pass is also what records every baseline.
  const times = leaderSheetModifiedTimes_();
  const baseline = readJsonProperty_(LEADER_SHEET_PULL_BASELINE_PROP_KEY);
  __leaderSheetsUntouched = {};
  let changed = false;
  let skipped = 0;

  return {
    /** True when this sheet cannot hold an edit the pull has not read. */
    untouched(fileId) {
      if (fullCheck || !times || !fileId) return false;
      const now = times[fileId];
      const seen = Number(baseline[fileId]);
      if (!isFinite(now) || !isFinite(seen) || now > seen) return false;
      __leaderSheetsUntouched[fileId] = true;
      skipped++;
      return true;
    },
    /** The pull read this sheet: everything up to Drive's date for it is in. */
    read(fileId) {
      if (!times || !fileId || !isFinite(times[fileId])) return;
      if (baseline[fileId] !== times[fileId]) { baseline[fileId] = times[fileId]; changed = true; }
    },
    save() {
      if (changed) writeJsonProperty_(LEADER_SHEET_PULL_BASELINE_PROP_KEY, baseline);
      if (fullCheck && times) recordDailyStepRun_('leader_sheet_full_check');
      if (skipped > 0) {
        log(`Program registrant sheets: ${skipped} unchanged since they were last read — not opened.`);
      }
    }
  };
}

/** True when the pull this execution left this sheet unread because nothing on it had changed. */
function leaderSheetUntouchedThisRun_(fileId) {
  return !!(__leaderSheetsUntouched && fileId && __leaderSheetsUntouched[fileId]);
}
