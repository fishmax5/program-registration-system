// ============================================================================
// 99h. WHY IS A ROSTER SHEET EMPTY?  (the read-only answer for one screen)
// ============================================================================
//
// Numbered after `99g` for the usual reason — never renumber, and this landed
// last. Safe there: behavior only, it declares one constant nothing derives
// from, its schema is `HEADERS` in `03` like every other tab's, and everything
// it reaches for — `getProgramLeaderSheetRegistry` / `buildLeaderSheetRowsByProgram`
// / `computeLeaderSheetFingerprint` / `countStrandedRegistrantRows_` (`46`),
// `getSectionedRows` (`34`) — it reads at CALL time or through a hoisted
// function declaration.
//
// THE SENTENCE THIS FILE EXISTS FOR IS "Nobody has signed up yet."
//
// A program registrant sheet says exactly that when the roster handed to it is
// empty — and that sentence is TRUE of a class nobody has booked and FALSE, in
// the same words, of a class with a dozen people on the Registrants tab whose
// rows never reached it. From the sheet the two are identical. From the
// workbook they are three or four different faults with three or four
// different fixes, and until now the only way to tell them apart was to read
// `pushProgramLeaderSheets()` and work out which branch a particular program
// took on a run nobody watched.
//
// So this walks the same path the push walks, on the same inputs, and REPORTS
// each step instead of writing anything:
//
//   • is this program in the sheet registry at all, and under which key;
//   • how many SESSION rows that key has inside the sheet's own window (a
//     program whose dates are all past or all beyond the window is an empty
//     sheet that is telling the truth);
//   • how many REGISTRANT rows joined onto it — and how many name the program
//     but joined to nothing, which is the Event_ID-drift fault `46`'s fallback
//     now heals and this is how you see it happened;
//   • whether the stored fingerprint MATCHES what the rows would produce,
//     because that is the one state in which the push looks at a sheet and
//     deliberately writes nothing;
//   • and whether the file can still be opened at all.
//
// IT WRITES NOTHING, TAKES NO LOCK AND IS UNGATED — the person staring at an
// empty roster is the person who should be able to press it, and every answer
// it gives is a read. That is also why it opens each sheet: "the syncing
// account cannot open this file any more" is one of the answers, and it is not
// knowable from the workbook alone.
// ============================================================================

/** How many programs one report will look at. A centre has dozens, not
 * hundreds, and a report nobody can read to the end is a report that hides
 * the line that mattered. */
const LEADER_SHEET_DOCTOR_MAX_PROGRAMS = 60;

/**
 * One finding per registered program sheet — the whole state of the push, as
 * data, so the wording below and any future caller cannot disagree about what
 * was measured.
 */
function diagnoseLeaderSheetRosters() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registry = getProgramLeaderSheetRegistry();
  const keys = Object.keys(registry).slice(0, LEADER_SHEET_DOCTOR_MAX_PROGRAMS);

  const sessionRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.All_Program_Sessions, 'Event_ID');
  const registrantRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.All_Registrants, 'Event_ID');
  // The same call the push makes, on the same two reads — not a second
  // implementation of the join, because a diagnostic that computes the answer
  // its own way can only tell you about itself.
  const byProgram = buildLeaderSheetRowsByProgram(sessionRows, registrantRows);

  const sessionMap = getIndexMap(HEADERS.All_Program_Sessions);
  const today = parseDateKey(formatDateKey(new Date()));
  const from = formatDateKey(new Date(today.getTime() - LEADER_SHEET_BACK_DAYS * 86400000));
  const to = formatDateKey(new Date(today.getTime() + LEADER_SHEET_FORWARD_DAYS * 86400000));

  return {
    totals: {
      programs: keys.length,
      sessionRows: sessionRows.length,
      registrantRows: registrantRows.length,
      windowFrom: from,
      windowTo: to
    },
    findings: keys.map(programKey => {
      const entry = registry[programKey] || {};
      const rows = byProgram[programKey] || [];
      const finding = {
        programKey,
        title: entry.title || '',
        location: entry.location || '',
        fileId: entry.fileId || '',
        rosterRows: rows.length,
        sessionsInWindow: 0,
        stranded: 0,
        fingerprintMatches: false,
        accessOpened: !!entry.accessOpened,
        openError: ''
      };

      sessionRows.forEach(row => {
        const date = coerceDate(row[sessionMap['Event_Date']]);
        if (!date) return;
        const dateKey = formatDateKey(date);
        if (dateKey < from || dateKey > to) return;
        if (leaderProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]) !== programKey) return;
        finding.sessionsInWindow++;
      });

      // Only asked when the roster is empty, exactly as the push asks it: the
      // count is the difference between "nobody booked" and "they are on the
      // tab and did not arrive".
      if (rows.length === 0) finding.stranded = countStrandedRegistrantRows_(entry, registrantRows);

      try {
        finding.fingerprintMatches = entry.pushedFingerprint === computeLeaderSheetFingerprint(entry, rows);
      } catch (err) {
        finding.openError = `fingerprint could not be computed (${err})`;
      }

      // THE ONE THING NOT KNOWABLE FROM THE WORKBOOK. A file the syncing
      // account can no longer open is a roster that stopped updating months
      // ago with nothing on any tab to say so.
      if (entry.fileId) {
        try {
          openSpreadsheetCached(entry.fileId);
        } catch (err) {
          finding.openError = String(err);
        }
      } else {
        finding.openError = 'the registry entry has no file id';
      }

      return finding;
    })
  };
}

/**
 * The report in words — the empty ones first, because they are the only reason
 * anybody opens this, and each with the sentence that says WHICH empty it is.
 */
function describeLeaderSheetRosters(diagnosis) {
  const data = diagnosis || diagnoseLeaderSheetRosters();
  const t = data.totals;
  const lines = [
    `${t.programs} program registrant sheet(s) registered. Read from ${t.sessionRows} session row(s) ` +
    `and ${t.registrantRows} registrant row(s), over ${t.windowFrom} → ${t.windowTo}.`,
    ''
  ];

  const empty = data.findings.filter(f => f.rosterRows === 0);
  const filled = data.findings.filter(f => f.rosterRows > 0);

  if (empty.length === 0) {
    lines.push('Every registered sheet has a roster to write. None of them is empty.');
  } else {
    lines.push(`EMPTY ROSTERS (${empty.length}) — what each one means:`);
    empty.forEach(f => {
      lines.push(`• ${f.title || f.programKey}${f.location ? ` — ${f.location}` : ''}`);
      if (f.openError) {
        lines.push(`    ⚠️ The sheet itself could not be opened: ${f.openError}`);
        lines.push('    → Nothing has been written to it since that started. Run ' +
          '🔧 Admin ▸ 🔓 Open Up File Sharing, or re-create the sheet from Rosters & Sharing.');
        return;
      }
      if (f.stranded > 0) {
        lines.push(`    ⚠️ ${f.stranded} registrant row(s) name this program in the window, and none of ` +
          'them matches a session — their Event_ID has come apart from the session table.');
        lines.push('    → Run 🔧 Admin ▸ 🔗 Repair Dashboard Links, then 🔄 Update Everything Now.');
        return;
      }
      if (f.sessionsInWindow === 0) {
        lines.push('    No sessions of this program are running in the window at all, so an empty sheet ' +
          'is the true answer.');
        lines.push('    → Nothing to fix here. If the program IS running, its sessions are missing from ' +
          'the dashboard — run 🔄 Update Everything Now.');
        return;
      }
      lines.push(`    ${f.sessionsInWindow} session(s) in the window and nobody registered for any of ` +
        'them. An empty sheet is the true answer.');
      if (f.fingerprintMatches) {
        lines.push('    (The push agrees: it has already written this state and skips the sheet until ' +
          'somebody registers.)');
      }
    });
  }

  if (filled.length > 0) {
    lines.push('');
    lines.push(`ROSTERS WITH PEOPLE ON THEM (${filled.length}):`);
    filled.forEach(f => {
      lines.push(`• ${f.title || f.programKey}${f.location ? ` — ${f.location}` : ''}: ` +
        `${f.rosterRows} row(s) across ${f.sessionsInWindow} session(s)` +
        (f.fingerprintMatches ? ' — already written, the next push will skip it.' : ' — due to be written.') +
        (f.openError ? ` ⚠️ but the sheet could not be opened: ${f.openError}` : ''));
    });
  }

  return lines.join('\n');
}

/** MENU ACTION — 🔧 Admin ▸ 📄 Reports ▸ "Why is a roster sheet empty?". Read-only. */
function reportLeaderSheetRosters() {
  let text;
  try {
    text = describeLeaderSheetRosters();
  } catch (err) {
    text = `The roster check could not run: ${err}`;
  }
  log(`reportLeaderSheetRosters:\n${text}`);
  try {
    const ui = SpreadsheetApp.getUi();
    ui.alert('Program registrant sheets', text, ui.ButtonSet.OK);
  } catch (err) {
    toastIfPossible('See the log — the roster check wrote its answer there.');
  }
}
