// ============================================================================
// 99zz. WHICH FINDINGS ARE THESE?  (reportLedgerTriage — read-only)
// ============================================================================
//
// WHY THIS FILE EXISTS. docs/META_ANALYSIS_2026-11.md, P2. The ledger verifier
// (99n) answers "do the tab and the ledger agree?" and, when they do not, hands
// a person a flat list: 1148 registrations in the ledger and not on the tab,
// 70 that disagree, "…and 1123 more". A flat list is a count, not a diagnosis.
// The finding that matters inside it — a FUTURE session whose registrant is on
// the record and not on the roster — looks exactly like September history.
//
// This sorts the same buckets, and writes nothing:
//
//   DATE        past / future (today counts as future: the desk is still open).
//   KIND        lunch-only, standing/club, form, desk — what sort of
//               registration it is, so that "all of the club ones" is one
//               cause and not four hundred.
//   SOURCE      the last writer the LEDGER recorded for the registration
//               (99k's `Source`), and the kinds it has seen. Rows that are on
//               the tab and have no ledger entry at all say so.
//   COLUMN      for the disagreeing bucket, which column, and the VALUE PAIR
//               ("tab Cancelled / ledger Active"), because a pair is a
//               pattern and a column alone is not.
//
// And the one check the meta-analysis says to run before anything else: for
// every FUTURE-dated registration that is in the ledger and not on the tab,
// ask the 3am Registrant Snapshots (99j) whether the tab ever held it.
//
//   lost-from-tab   some snapshot has it and the tab no longer does — a
//                   candidate for 🔧 Restore Registrants from the Ledger
//                   (99v). THIS REPORT RESTORES NOTHING; it says who, which
//                   snapshot saw them last, and what status they had there.
//   never-on-tab    snapshots taken after the registration was recorded
//                   exist, and none of them has it — a writer appending what
//                   it does not write, not a loss.
//   unknown         no snapshot covers it (none kept that far back, or the
//                   folder could not be read). Said as unknown, never as clean:
//                   "nothing found" and "nothing looked at" are different
//                   answers (99n's rule, 32's, 51's).
//
// READ-ONLY, AND IT CHANGES NO WRITER. It does not touch 99n — the verifier's
// buckets, its digest lines and its tests are exactly what they were. This
// file repeats 99n's matching (registrantTombstoneKey, the same columns, the
// same value wear-down) rather than editing it, because the verifier needs
// per-finding detail (keys, dates, columns as names) that its own result
// deliberately does not carry. Where the two could drift, tests/ledger_triage
// asserts the bucket SIZES equal verifyLedgerAgainstTab()'s on the same input.
//
// NEVER THROWS, bounded in time. Every stage is guarded and a stage that could
// not run is named. The snapshot read is capped (LEDGER_TRIAGE_SNAPSHOT_MAX_FILES
// newest files, LEDGER_TRIAGE_SNAPSHOT_BUDGET_MS) and says how far it got.
//
// WHERE. 🩺 Health panel ▸ Registrations ▸ "Triage the ledger findings"
// (`HEALTH_CHECKS`, 99zm), which is where the other ledger reports live; the
// menu wrapper is in 99r like every other action.
//
// LOAD ORDER. Numbered after 99zy for the usual reason — never renumber, and
// this landed last. Safe there: behavior only, its own constants stand alone,
// and everything it reaches for (99k's reader and fold, 99n's columns and
// value helpers, 34's reader, 28's key, 99j's folder) it reads at CALL time or
// through a hoisted function declaration.

/** Snapshots read, newest first. 30 nightly files is a month of evidence. */
const LEDGER_TRIAGE_SNAPSHOT_MAX_FILES = 30;

/** Stop opening snapshots after this long, and say so. */
const LEDGER_TRIAGE_SNAPSHOT_BUDGET_MS = 150 * 1000;

/** Names printed per list before "and N more". */
const LEDGER_TRIAGE_MAX_LISTED = 40;

/** Ledger sources that mean a person at a desk or a door did it. */
const LEDGER_TRIAGE_DESK_SOURCES = [
  'door', 'quick-mark', 'change-panel', 'bulk-list', 'cancel-page', 'sheet-edit', 'relocate', 'dedupe', 'remove-sweep'
];

/** What a row reads as when nothing is known about it. */
const LEDGER_TRIAGE_NO_ENTRY = '(no ledger entry)';

// --- date and kind ----------------------------------------------------------

/** A cell or a folded 'yyyy-MM-dd' string as a date key, or '' when it is neither. */
function ledgerTriageDateKey_(raw) {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  const date = coerceDate(raw);
  return date ? formatDateKey(date) : '';
}

/** 'future' (today included), 'past', or 'undated'. Date keys compare as text. */
function ledgerTriageWhen_(dateKey, todayKey) {
  if (!dateKey) return 'undated';
  return dateKey >= todayKey ? 'future' : 'past';
}

/**
 * What sort of registration this is. The session's own id says lunch-only and
 * always-open (38, 99zv); after that the LEDGER'S sources say how it arrived
 * (a club catch-up, a form import, a desk), and only for a row the ledger has
 * never heard of — or one a backfill recorded without saying how it arrived —
 * does the row's own Form_Source speak.
 */
function ledgerTriageOrigin_(eventId, sources, formSource) {
  const id = String(eventId || '');
  if (id.indexOf('LUNCHONLY:') === 0) return 'lunch-only';
  if (id.indexOf('STANDING:') === 0) return 'standing event';
  const seen = sources || [];
  if (seen.indexOf('club') !== -1) return 'club / standing list';
  if (seen.indexOf('import') !== -1 || seen.indexOf('all-dates') !== -1) return 'form';
  if (seen.some(s => LEDGER_TRIAGE_DESK_SOURCES.indexOf(s) !== -1)) return 'desk / door';
  const text = String(formSource || '').toLowerCase();
  if (/standing list/.test(text)) return 'club / standing list';
  if (text.trim()) return 'form';
  return seen.length ? 'backfill (unknown origin)' : 'unknown';
}

// --- the comparison, with detail --------------------------------------------

/**
 * THE PURE HALF. Same matching as verifyLedgerAgainstTab() (99n), keeping what
 * that one drops.
 *
 *   analyzeLedgerDivergence_(entries, tabRows, todayKey, now?)
 *     -> { checked, folded, missingFromTab[], missingFromFold[], disagreeing[], problems }
 *
 * Every finding: { bucket, key, name, event, location, personType, dateKey, when,
 *   origin, lastSource, lastKind, kinds[], sources[], firstEntryAt, status,
 *   columns[] (disagreeing only: { column, tab, ledger }) }.
 *
 * The ledger's side is read per registration from the SORTED entries, because
 * the last entry is the last word and the fold's own order is what "last" means.
 */
function analyzeLedgerDivergence_(entries, tabRows, todayKey) {
  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const sorted = sortLedgerEntries_(entries);
  const folded = foldRegistrationLedger(sorted);

  const history = {};
  sorted.forEach(entry => {
    const h = history[entry.registrationId] || (history[entry.registrationId] = {
      kinds: [], sources: [], lastKind: '', lastSource: '', firstEntryAt: null, firstSource: ''
    });
    if (h.kinds.indexOf(entry.kind) === -1) h.kinds.push(entry.kind);
    if (entry.source && h.sources.indexOf(entry.source) === -1) h.sources.push(entry.source);
    h.lastKind = entry.kind;
    h.lastSource = entry.source || '(blank)';
    if (!h.firstEntryAt) { h.firstEntryAt = coerceDate(entry.entryAt); h.firstSource = entry.source || ''; }
  });

  const keyOf = row => registrantTombstoneKey(row[map['Event_ID']], row[map['Name']], row[map['Person_Type']]);

  const onTab = {};
  (tabRows || []).forEach(row => {
    if (isSupersededRegistrantRow(row, map)) return;
    const key = keyOf(row);
    if (key && onTab[key] === undefined) onTab[key] = row;
  });
  const inFold = {};
  folded.rows.forEach(row => {
    const key = keyOf(row);
    if (key && inFold[key] === undefined) inFold[key] = row;
  });

  function finding(bucket, key, row, registrationId) {
    const h = registrationId ? history[registrationId] : null;
    const dateKey = ledgerTriageDateKey_(row[map['Event_Date']]);
    return {
      bucket: bucket,
      key: key,
      registrationId: registrationId || '',
      name: String(row[map['Name']] || '').trim() || '(unnamed)',
      event: String(row[map['Event']] || '').trim() || 'an untitled session',
      location: String(row[map['Location']] || '').trim(),
      personType: String(row[map['Person_Type']] || '').trim() || 'Registrant',
      eventId: String(row[map['Event_ID']] || '').trim(),
      dateKey: dateKey,
      when: ledgerTriageWhen_(dateKey, todayKey),
      origin: ledgerTriageOrigin_(row[map['Event_ID']], h ? h.sources : [],
        map['Form_Source'] !== undefined ? row[map['Form_Source']] : ''),
      lastSource: h ? h.lastSource : LEDGER_TRIAGE_NO_ENTRY,
      lastKind: h ? h.lastKind : '',
      kinds: h ? h.kinds.slice() : [],
      sources: h ? h.sources.slice() : [],
      firstEntryAt: h ? h.firstEntryAt : null,
      firstSource: h ? h.firstSource : '',
      status: String(row[map['Program_Status']] || '').trim(),
      columns: []
    };
  }

  const missingFromTab = [];
  const missingFromFold = [];
  const disagreeing = [];

  Object.keys(inFold).forEach(key => {
    if (onTab[key] !== undefined) return;
    const row = inFold[key];
    missingFromTab.push(finding('missingFromTab', key, row, folded.index[key]));
  });
  Object.keys(onTab).forEach(key => {
    const tabRow = onTab[key];
    const foldRow = inFold[key];
    if (!foldRow) {
      missingFromFold.push(finding('missingFromFold', key, tabRow, ''));
      return;
    }
    const columns = [];
    LEDGER_VERIFY_COLUMNS.forEach(header => {
      if (map[header] === undefined) return;
      const mine = ledgerVerifyValue_(tabRow[map[header]]);
      const theirs = ledgerVerifyValue_(foldRow[map[header]]);
      if (mine === theirs) return;
      if (LEDGER_VERIFY_CHECKBOX_COLUMNS.indexOf(header) !== -1 &&
          (mine === '' || mine === 'false') && (theirs === '' || theirs === 'false')) return;
      columns.push({ column: header, tab: mine, ledger: theirs });
    });
    if (columns.length) {
      const f = finding('disagreeing', key, tabRow, folded.index[key]);
      f.columns = columns;
      disagreeing.push(f);
    }
  });

  return {
    checked: Object.keys(onTab).length,
    folded: Object.keys(inFold).length,
    missingFromTab: missingFromTab,
    missingFromFold: missingFromFold,
    disagreeing: disagreeing,
    problems: folded.problems || []
  };
}

/** { label: count } for a list, keyed by whatever `pick` says. */
function ledgerTriageTally_(items, pick) {
  const out = {};
  items.forEach(item => {
    const label = pick(item);
    out[label] = (out[label] || 0) + 1;
  });
  return out;
}

/** A tally as lines, biggest first: "   212  club / standing list". */
function ledgerTriageTallyLines_(tally, indent) {
  const pad = indent || '   ';
  return Object.keys(tally)
    .sort((a, b) => tally[b] - tally[a] || (a < b ? -1 : 1))
    .map(label => `${pad}${String(tally[label]).padStart(5)}  ${label}`);
}

// --- the snapshot half ------------------------------------------------------

/** One RFC-4180 CSV (comma only; 99j writes every cell quoted) into rows of strings. */
function parseSnapshotCsv_(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** 'All_Registrants 2026-11-09_0300 (snapshot).csv' -> { dateKey, name }, else null. */
function parseSnapshotFileName_(name) {
  const m = /^All_Registrants (\d{4}-\d{2}-\d{2})_(\d{4}) \((.*)\)\.csv$/.exec(String(name || ''));
  return m ? { dateKey: m[1], stamp: `${m[1]}_${m[2]}`, reason: m[3], name: String(name) } : null;
}

/**
 * Reads the newest snapshots, keeping ONLY the rows whose key is wanted — a
 * snapshot is the whole tab and there are thirty of them.
 *
 * Returns { snapshots: [{ dateKey, stamp, rows: { key: status } }], found, read,
 * skipped: [reasons] }. `read` is how many were opened; `found` how many exist.
 * `listFiles` and `readText` are injected so this is testable without Drive.
 */
function readRegistrantSnapshots_(wantedKeys, listFiles, readText, now) {
  const wanted = {};
  wantedKeys.forEach(k => { wanted[k] = true; });
  const skipped = [];
  let files = [];
  try {
    files = (listFiles() || []).map(f => Object.assign({ file: f }, parseSnapshotFileName_(f.name))).filter(f => f.stamp);
  } catch (err) {
    return { snapshots: [], found: 0, read: 0, skipped: [`the Registrant Snapshots folder could not be read (${err})`] };
  }
  files.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
  const found = files.length;
  const started = (now || Date.now)();
  const snapshots = [];
  for (let i = 0; i < files.length && i < LEDGER_TRIAGE_SNAPSHOT_MAX_FILES; i++) {
    if ((now || Date.now)() - started > LEDGER_TRIAGE_SNAPSHOT_BUDGET_MS) {
      skipped.push(`stopped after ${snapshots.length} snapshot(s) to stay inside the time budget`);
      break;
    }
    try {
      const rows = parseSnapshotCsv_(readText(files[i].file));
      if (!rows.length) continue;
      const hmap = getIndexMap(rows[0].map(h => normalizeHeaderText(h)));
      if (hmap['Event_ID'] === undefined || hmap['Name'] === undefined) {
        skipped.push(`${files[i].name} has no Event_ID / Name columns`);
        continue;
      }
      const kept = {};
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const key = registrantTombstoneKey(row[hmap['Event_ID']], row[hmap['Name']],
          hmap['Person_Type'] !== undefined ? row[hmap['Person_Type']] : '');
        if (wanted[key]) kept[key] = hmap['Program_Status'] !== undefined ? String(row[hmap['Program_Status']] || '').trim() : '';
      }
      snapshots.push({ dateKey: files[i].dateKey, stamp: files[i].stamp, rows: kept });
    } catch (err) {
      skipped.push(`${files[i].name} could not be read (${err})`);
    }
  }
  if (found > LEDGER_TRIAGE_SNAPSHOT_MAX_FILES) {
    skipped.push(`${found - LEDGER_TRIAGE_SNAPSHOT_MAX_FILES} older snapshot(s) were not opened`);
  }
  return { snapshots: snapshots, found: found, read: snapshots.length, skipped: skipped };
}

/**
 * THE VERDICT for each future-dated "in the ledger, not on the tab" finding.
 * Pure. Each finding gains `verdict` ('lost-from-tab' | 'never-on-tab' |
 * 'unknown'), `lastSeen` / `lastSeenStatus` (the newest snapshot that held it)
 * and `firstSeen`.
 *
 * A snapshot COVERS a registration if it was taken on or after the day the
 * ledger first recorded it. A registration whose first entry is a migration
 * (the backfill) predates the ledger, so every snapshot covers it.
 */
function judgeAgainstSnapshots_(findings, snapshotRead) {
  const snaps = snapshotRead.snapshots; // newest first
  findings.forEach(f => {
    const firstDay = f.firstEntryAt && f.firstSource !== 'migration'
      ? formatDateKey(f.firstEntryAt) : '';
    const covering = snaps.filter(s => !firstDay || s.dateKey >= firstDay);
    const hits = covering.filter(s => s.rows[f.key] !== undefined);
    f.lastSeen = hits.length ? hits[0].stamp : '';
    f.lastSeenStatus = hits.length ? hits[0].rows[f.key] : '';
    f.firstSeen = hits.length ? hits[hits.length - 1].stamp : '';
    f.snapshotsCovering = covering.length;
    f.verdict = hits.length ? 'lost-from-tab' : (covering.length ? 'never-on-tab' : 'unknown');
  });
  return findings;
}

// --- the report -------------------------------------------------------------

/**
 * The whole analysis, run: reads the ledger, the tab and (for future-dated
 * missing rows) the snapshots. Never throws; returns { ok, ... , skipped }.
 */
function triageLedgerFindings() {
  const skipped = [];
  let entries = null;
  let tabRows = null;
  try { entries = readLedgerEntries(); } catch (err) { skipped.push(`the ledger could not be read (${err})`); }
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
    tabRows = sheet ? getSectionedRows(sheet, HEADERS.All_Registrants, 'Event_ID') : [];
  } catch (err) { skipped.push(`${SHEET_NAMES.REGISTRANT_DASH} could not be read (${err})`); }
  if (!entries || !tabRows) return { ok: false, skipped: skipped };

  let analysis;
  try {
    analysis = analyzeLedgerDivergence_(entries, tabRows, formatDateKey(new Date()));
  } catch (err) {
    return { ok: false, skipped: skipped.concat([`the comparison failed (${err})`]) };
  }

  const futureMissing = analysis.missingFromTab.filter(f => f.when === 'future');
  let snapshotRead = { snapshots: [], found: 0, read: 0, skipped: [] };
  if (futureMissing.length) {
    try {
      snapshotRead = readRegistrantSnapshots_(
        futureMissing.map(f => f.key),
        () => {
          const folder = getOrCreateRegistrantSnapshotFolder();
          const out = [];
          const it = folder ? folder.getFiles() : null;
          while (it && it.hasNext()) out.push(it.next());
          return out;
        },
        file => file.getBlob().getDataAsString()
      );
    } catch (err) {
      snapshotRead = { snapshots: [], found: 0, read: 0, skipped: [`the snapshots could not be compared (${err})`] };
    }
    judgeAgainstSnapshots_(futureMissing, snapshotRead);
  }
  return { ok: true, skipped: skipped, analysis: analysis, snapshotRead: snapshotRead, futureMissing: futureMissing };
}

function ledgerTriageCap_(lines) {
  const shown = lines.slice(0, LEDGER_TRIAGE_MAX_LISTED);
  if (lines.length > shown.length) shown.push(`   …and ${lines.length - shown.length} more`);
  return shown;
}

/** One finding as a line a person can act on. */
function ledgerTriageLine_(f) {
  const when = f.dateKey ? f.dateKey : 'no date';
  return `   • ${f.name} (${f.personType}) — ${f.event}, ${when}${f.location ? ` (${f.location})` : ''}`;
}

/** The result as report text. Pure. */
function describeLedgerTriage(result) {
  if (!result || !result.ok) {
    const why = result && result.skipped && result.skipped.length ? result.skipped.join('; ') : 'unknown reason';
    return `The ledger findings could not be triaged: ${why}. Nothing was looked at, which is not the same as nothing being wrong.`;
  }
  const a = result.analysis;
  const lines = [];
  lines.push(`${a.checked} row(s) on the Registrants tab, ${a.folded} live registration(s) in the ledger.`);
  lines.push('Read-only: nothing was written, restored or changed.');
  result.skipped.forEach(s => lines.push(`⚠️ ${s}.`));

  const split = list => {
    const future = list.filter(f => f.when === 'future').length;
    const past = list.filter(f => f.when === 'past').length;
    return `${future} future-dated, ${past} past, ${list.length - future - past} undated`;
  };

  const sections = [
    ['IN THE LEDGER, NOT ON THE TAB', a.missingFromTab],
    ['ON THE TAB, NOT IN THE LEDGER', a.missingFromFold]
  ];
  sections.forEach(([title, list]) => {
    lines.push('', `=== ${title}: ${list.length} (${split(list)}) ===`);
    if (!list.length) return;
    ['future', 'past'].forEach(when => {
      const part = list.filter(f => f.when === when);
      if (!part.length) return;
      lines.push(`-- ${when} --`);
      lines.push('  by kind:');
      lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(part, f => f.origin)));
      lines.push('  by the ledger\'s last writer (Source) and last entry kind:');
      lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(part, f => `${f.lastSource} / ${f.lastKind || '—'}`)));
    });
  });

  lines.push('', `=== BOTH, DISAGREEING: ${a.disagreeing.length} (${split(a.disagreeing)}) ===`);
  if (a.disagreeing.length) {
    const flat = [];
    a.disagreeing.forEach(f => f.columns.forEach(c => flat.push(Object.assign({ f: f }, c))));
    lines.push('  by column and the ledger\'s last writer of that registration:');
    lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(flat, c => `${c.column}  ←  ${c.f.lastSource}`)));
    lines.push('  by value pair (tab / ledger):');
    lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(flat,
      c => `${c.column}: tab ${ledgerVerifySay_(c.tab)} / ledger ${ledgerVerifySay_(c.ledger)}`)).slice(0, 12));
    lines.push('  by kind:');
    lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(a.disagreeing, f => f.origin)));
    const programs = ledgerTriageTally_(a.disagreeing, f => `${f.event}${f.location ? ` (${f.location})` : ''}`);
    lines.push('  most affected programs:');
    lines.push(...ledgerTriageTallyLines_(programs).slice(0, 8));
  }

  if (a.problems.length) {
    lines.push('', `=== COULD NOT BE REPLAYED: ${a.problems.length} ===`);
    lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(a.problems, p => `${p.kind || 'entry'}: ${p.reason}`)).slice(0, 8));
  }

  // The check that may affect real people on real dates.
  const fm = result.futureMissing || [];
  lines.push('', `=== FUTURE-DATED, IN THE LEDGER BUT NOT ON THE TAB: ${fm.length} — against the 3am snapshots ===`);
  if (!fm.length) {
    lines.push('None. Every registration the ledger holds for today onward is on the tab.');
  } else {
    const sr = result.snapshotRead;
    lines.push(`Snapshots: ${sr.found} in the folder, ${sr.read} opened` +
      `${sr.snapshots.length ? ` (${sr.snapshots[sr.snapshots.length - 1].stamp} to ${sr.snapshots[0].stamp})` : ''}.`);
    sr.skipped.forEach(s => lines.push(`⚠️ ${s}.`));
    const verdicts = ledgerTriageTally_(fm, f => f.verdict);
    lines.push(...ledgerTriageTallyLines_(verdicts).map(l => l
      .replace('lost-from-tab', 'LOST FROM THE TAB — a snapshot had them, the tab does not')
      .replace('never-on-tab', 'never on the tab — snapshots taken since they registered do not have them')
      .replace(/unknown$/, 'unknown — no snapshot covers them')));
    lines.push('  by the ledger\'s last writer:');
    lines.push(...ledgerTriageTallyLines_(ledgerTriageTally_(fm, f => `${f.verdict}: ${f.lastSource}`)));

    const lost = fm.filter(f => f.verdict === 'lost-from-tab')
      .sort((x, y) => (x.dateKey < y.dateKey ? -1 : x.dateKey > y.dateKey ? 1 : 0));
    if (lost.length) {
      lines.push('', `Lost from the tab — ${lost.length}. These are the candidates for 🔧 Restore Registrants from the Ledger (this report did not restore them):`);
      lines.push(...ledgerTriageCap_(lost.map(f =>
        `${ledgerTriageLine_(f)} — last on the tab in the ${f.lastSeen} snapshot` +
        `${f.lastSeenStatus ? ` as ${f.lastSeenStatus}` : ''}; ledger last wrote it via ${f.lastSource}`)));
    }
    const never = fm.filter(f => f.verdict === 'never-on-tab');
    if (never.length) {
      lines.push('', `Never on the tab — ${never.length}. Not lost: the ledger records something the tab never held, which points at a writer, not at missing people. Sample:`);
      lines.push(...ledgerTriageCap_(never.slice(0, 15).map(f =>
        `${ledgerTriageLine_(f)} — ${f.origin}; ledger last wrote it via ${f.lastSource}`)));
    }
  }
  return lines.join('\n');
}

/**
 * The menu / Health panel entry. READ-ONLY and UNGATED, like the reports beside
 * it: it writes nothing.
 */
function reportLedgerTriage() {
  let result;
  try {
    result = triageLedgerFindings();
  } catch (err) {
    result = { ok: false, skipped: [String(err)] };
  }
  const text = describeLedgerTriage(result);
  log(`Ledger triage: ${text.split('\n').slice(0, 3).join(' | ')}`);
  presentReport_('Ledger findings, triaged', text, null, { modal: { width: 820, height: 640 } });
  return result;
}
