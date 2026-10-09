// THE LEDGER CHECKPOINT (section 99zq).
//
//   CHECKPOINT + TAIL IS THE FULL FOLD. A randomized property test: random
//   ledger histories — every kind, ties in Entry_At, entries against unknown
//   and dead ids, a bad Payload key, an unreadable Payload — folded whole, and
//   folded from a checkpoint taken at EVERY cut point (written to rows and read
//   back, as the tab would) carried on with the rest. Identical, every cell,
//   every problem, every dead registration. Across a compaction too.
//
//   THE ORDER GUARD. A tail entry dated before the checkpoint's last entry, or
//   undated, is REFUSED rather than folded — the one case where carrying on
//   would not be the full fold.
//
//   THE INVALIDATIONS. Meta and tab out of step (a build killed half way), the
//   tab deleted, the ledger's covered rows moved (compaction), a hand edit at
//   or above the covered row — every one falls back to the full fold.
//
//   THE GATE. Closed, ledgerFoldNow() reads the whole ledger exactly as
//   before. A clean comparison counts a day; a difference empties the count,
//   sets the checkpoint aside and files a digest line. Open, ledgerFoldNow()
//   reads only the anchor row and the tail.
const vm = require('vm');
const src = require('./helpers/source').readSource();

let uuidN = 0;
const store = {};
const spooled = [];
const sandbox = {
  console: { log: () => {} },
  Utilities: {
    formatDate: (d, tz, fmt) => {
      const pad = n => String(n).padStart(2, '0');
      if (fmt === 'yyyy-MM-dd') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      return d.toISOString().slice(0, 10);
    },
    getUuid: () => `uuid-${++uuidN}`,
    sleep: () => {}
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setProperty: (k, v) => { store[k] = String(v); },
      deleteProperty: k => { delete store[k]; }
    })
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => sandbox.__ss || null, getActive: () => sandbox.__ss || null },
  FormApp: { ItemType: {} }, CalendarApp: {}, DriveApp: {}, HtmlService: {}, LockService: {},
  Session: { getScriptTimeZone: () => 'America/New_York', getEffectiveUser: () => ({ getEmail: () => 'desk@centre.org' }) },
  ScriptApp: {}, MailApp: {}, DocumentApp: {}, UrlFetchApp: {}, Calendar: {}
};
vm.createContext(sandbox);
vm.runInContext(src + `
;this.HEADERS = HEADERS;
this.SHEET_NAMES = SHEET_NAMES;
this.LEDGER_KINDS = LEDGER_KINDS;
this.LEDGER_SOURCES = LEDGER_SOURCES;
this.ledgerEntryToRow = ledgerEntryToRow;
this.foldRegistrationLedger = foldRegistrationLedger;
this.ledgerItemsFromValues_ = ledgerItemsFromValues_;
this.buildLedgerCheckpointFromItems_ = buildLedgerCheckpointFromItems_;
this.ledgerCheckpointRowsFromContext_ = ledgerCheckpointRowsFromContext_;
this.ledgerCheckpointContextFromRows_ = ledgerCheckpointContextFromRows_;
this.ledgerCheckpointTailRefusal_ = ledgerCheckpointTailRefusal_;
this.foldLedgerFromCheckpointContext_ = foldLedgerFromCheckpointContext_;
this.compareLedgerFoldResults_ = compareLedgerFoldResults_;
this.analyzeLedgerRedundancy = analyzeLedgerRedundancy;
this.compareLedgerFolds_ = compareLedgerFolds_;
this.refreshLedgerCheckpointNightly = refreshLedgerCheckpointNightly;
this.foldLedgerFromCheckpointIfAllowed_ = foldLedgerFromCheckpointIfAllowed_;
this.validateLedgerCheckpoint = validateLedgerCheckpoint;
this.noteLedgerTabEditForCheckpoint_ = noteLedgerTabEditForCheckpoint_;
this.invalidateLedgerCheckpoint = invalidateLedgerCheckpoint;
this.setLedgerCheckpointFastPath = setLedgerCheckpointFastPath;
this.ledgerCheckpointGateOpen_ = ledgerCheckpointGateOpen_;
this.ledgerFoldNow = ledgerFoldNow;
this.invalidateLedgerFold = invalidateLedgerFold;
this.LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED = LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED;
this.LEDGER_CHECKPOINT_META_PROP_KEY = LEDGER_CHECKPOINT_META_PROP_KEY;
this.LEDGER_CHECKPOINT_GATE_PROP_KEY = LEDGER_CHECKPOINT_GATE_PROP_KEY;
this.stubSideEffects = function (spool) {
  workbookLock = function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; };
  spoolOfficeNote = function (section, line) { spool.push(line); };
  log = function () {};
};
`, sandbox, { filename: 'program.gs' });

const S = sandbox;
S.stubSideEffects(spooled);
const LH = S.HEADERS.Registration_Ledger;

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`ok   ${name}`); return; }
  failures++;
  console.log(`FAIL ${name}\n     got      ${a}\n     expected ${e}`);
}

// --- a seeded generator of ledger histories ----------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = Object.values(S.LEDGER_KINDS);
const SOURCES = Object.values(S.LEDGER_SOURCES);
const EVENTS = ['cal|Chair Yoga|2026-10-06', 'cal|Chair Yoga|2026-10-13', 'cal|Bingo|2026-10-07'];
const NAMES = ['Joan Meier', 'Bob Kaplan', "Mary O'Brien", 'Ann Lee'];

/** One random history as tab rows (HEADERS.Registration_Ledger order). */
function randomHistory(r, opts) {
  const o = opts || {};
  const n = 5 + Math.floor(r() * 55);
  const ids = [];
  const pick = list => list[Math.floor(r() * list.length)];
  let t = Date.UTC(2026, 8, 1, 12);
  const rows = [];
  for (let i = 0; i < n; i++) {
    t += pick([0, 0, 1000, 60000, 3600000]);
    let at = new Date(t);
    if (o.backdate && r() < 0.1) at = new Date(t - 7200000);
    if (o.undated && r() < 0.05) at = '';
    let kind = (!ids.length || r() < 0.3) ? S.LEDGER_KINDS.REGISTERED : pick(KINDS);
    let id;
    if (kind === S.LEDGER_KINDS.REGISTERED && (r() < 0.75 || !ids.length)) {
      id = `reg-${ids.length + 1}`;
      ids.push(id);
    } else {
      id = r() < 0.07 ? 'reg-nobody' : pick(ids);
    }
    const payload = {};
    if (kind === S.LEDGER_KINDS.REGISTERED || kind === S.LEDGER_KINDS.CORRECTED) {
      if (r() < 0.6) payload.Meals_Ordered = Math.floor(r() * 3);
      if (r() < 0.4) payload.Phone = `610-555-${1000 + Math.floor(r() * 9000)}`;
      if (r() < 0.3) payload.Attended = r() < 0.5;
      if (r() < 0.3) payload.Lunch_Type = pick(['Hot', 'Cold', 'No Lunch']);
      if (r() < 0.05) payload.Attending = true;   // not a column: a problem
    }
    if (kind === S.LEDGER_KINDS.MOVED) {
      payload.from = pick(EVENTS);
      payload.Event_Date = '2026-10-13';
    }
    if (kind === S.LEDGER_KINDS.MERGED) {
      payload.absorbed = r() < 0.85 ? pick(ids) : 'reg-ghost';
      payload.Meals_Ordered = 2;
    }
    const entry = {
      entryId: `e-${i + 1}`, entryAt: at, occurredAt: null, kind: kind, registrationId: id,
      eventId: kind === S.LEDGER_KINDS.MOVED ? (r() < 0.9 ? pick(EVENTS) : '') : pick(EVENTS),
      name: pick(NAMES), personType: r() < 0.8 ? 'Registrant' : 'Guest', partyId: '',
      source: pick(SOURCES), actor: 'desk@centre.org', payload: payload, note: r() < 0.3 ? 'rang' : ''
    };
    const row = S.ledgerEntryToRow(entry, LH);
    if (r() < 0.03) row[LH.indexOf('Payload')] = '{not json';
    rows.push(row);
  }
  return rows;
}

/** The same thing a sheet would give back: JSON in, JSON out. */
function throughTheTab(rows) {
  return JSON.parse(JSON.stringify(rows));
}

/** A fresh copy of every entry — the fold edits what it is handed (an unreadable Payload is deleted). */
function fresh(entries) {
  return entries.map(e => Object.assign({}, e, { payload: JSON.parse(JSON.stringify(e.payload || {})) }));
}

/** Every observable of a fold, Admin_Notes INCLUDED — both sides run in the same instant. */
function strict(fold) {
  const states = {};
  Object.keys(fold.states).sort().forEach(id => {
    const s = fold.states[id];
    states[id] = [!!s.dead, s.deadBy || '', s.row];
  });
  return JSON.stringify({ states: states, rows: fold.rows, problems: fold.problems });
}

function fromCheckpoint(items, cut) {
  const built = S.buildLedgerCheckpointFromItems_(items.slice(0, cut), 'gen-1');
  if (!built.ok) return { refused: built.reason };
  const rows = throughTheTab(S.ledgerCheckpointRowsFromContext_(built.ctx, 'gen-1'));
  const meta = Object.assign({}, built.meta, {
    stateRows: rows.filter(r => r[1] === 'state').length,
    problemRows: rows.filter(r => r[1] === 'problem').length
  });
  const loaded = S.ledgerCheckpointContextFromRows_(rows, meta);
  if (loaded.error) return { refused: loaded.error };
  const tail = items.filter(it => it.row > meta.coveredThroughRow && it.entry).map(it => it.entry);
  const why = S.ledgerCheckpointTailRefusal_(meta, tail);
  if (why) return { refused: why };
  return { fold: S.foldLedgerFromCheckpointContext_(loaded.ctx, tail) };
}

// --- 1. the property ---------------------------------------------------------

{
  let cuts = 0;
  let mismatches = 0;
  let firstMismatch = '';
  let deadSeen = 0;
  let problemsSeen = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const r = rng(seed);
    const items = S.ledgerItemsFromValues_(throughTheTab(randomHistory(r)), LH, 2);
    const full = S.foldRegistrationLedger(fresh(items.filter(it => it.entry).map(it => it.entry)));
    const want = strict(full);
    deadSeen += Object.keys(full.states).filter(id => full.states[id].dead).length;
    problemsSeen += full.problems.length;
    for (let cut = 1; cut <= items.length; cut++) {
      const got = fromCheckpoint(items, cut);
      cuts++;
      if (got.refused || strict(got.fold) !== want) {
        mismatches++;
        if (!firstMismatch) firstMismatch = `seed ${seed} cut ${cut}: ${got.refused || 'differs'}`;
      }
      // And the comparison 99n runs agrees with the strict one.
      if (!got.refused && S.compareLedgerFoldResults_(full, got.fold) !== '') {
        mismatches++;
        if (!firstMismatch) firstMismatch = `seed ${seed} cut ${cut}: compareLedgerFoldResults_ disagrees`;
      }
    }
  }
  check(`checkpoint + tail === full fold at every cut point (${cuts} cuts, 150 histories)`, firstMismatch, '');
  check('the histories exercised dead registrations', deadSeen > 50, true);
  check('the histories exercised the problems list', problemsSeen > 50, true);
}

// --- 2. backdated and undated tails are refused, never folded wrong ----------

{
  let refusals = 0;
  let wrong = '';
  for (let seed = 500; seed < 600; seed++) {
    const r = rng(seed);
    const items = S.ledgerItemsFromValues_(throughTheTab(randomHistory(r, { backdate: true, undated: true })), LH, 2);
    const live = items.filter(it => it.entry).map(it => it.entry);
    const want = strict(S.foldRegistrationLedger(fresh(live)));
    for (let cut = 1; cut <= items.length; cut++) {
      const got = fromCheckpoint(items, cut);
      if (got.refused) { refusals++; continue; }
      if (strict(got.fold) !== want && !wrong) wrong = `seed ${seed} cut ${cut}`;
    }
  }
  check('a checkpoint carried on is never wrong, even with backdated and undated entries', wrong, '');
  check('and backdated/undated entries are refused rather than folded', refusals > 100, true);
}

{
  const meta = { maxEntryAtMs: Date.UTC(2026, 8, 2) };
  check('a tail entry dated before the checkpoint is refused',
    /dated before/.test(S.ledgerCheckpointTailRefusal_(meta, [{ entryId: 'x', entryAt: new Date(Date.UTC(2026, 8, 1)) }])), true);
  check('an undated tail entry is refused',
    /no Entry_At/.test(S.ledgerCheckpointTailRefusal_(meta, [{ entryId: 'x', entryAt: null }])), true);
  check('a tie with the checkpoint is fine (sheet order breaks it)',
    S.ledgerCheckpointTailRefusal_(meta, [{ entryId: 'x', entryAt: new Date(Date.UTC(2026, 8, 2)) }]), '');
}

// --- 3. across a compaction --------------------------------------------------

{
  let compared = 0;
  let wrong = '';
  for (let seed = 900; seed < 960; seed++) {
    const r = rng(seed);
    const items = S.ledgerItemsFromValues_(throughTheTab(randomHistory(r)), LH, 2);
    const entries = items.filter(it => it.entry).map(it => it.entry);
    const analysis = S.analyzeLedgerRedundancy(entries);
    const keptRows = items.filter(it => it.entry && !analysis.redundant.has(it.entry))
      .map(it => S.ledgerEntryToRow(it.entry, LH));
    const keptItems = S.ledgerItemsFromValues_(throughTheTab(keptRows), LH, 2);
    const keptEntries = keptItems.map(it => it.entry);
    if (S.compareLedgerFolds_(entries, keptEntries)) continue;   // compaction itself would refuse
    const want = S.foldRegistrationLedger(fresh(keptEntries));
    for (let cut = 1; cut <= keptItems.length; cut++) {
      const got = fromCheckpoint(keptItems, cut);
      compared++;
      if ((got.refused || strict(got.fold) !== strict(want)) && !wrong) wrong = `seed ${seed} cut ${cut}`;
    }
  }
  check(`a checkpoint of a compacted ledger is the full fold of it (${compared} cuts)`, wrong, '');
}

// --- 4. a checkpoint that does not match its meta is refused -----------------

{
  const items = S.ledgerItemsFromValues_(throughTheTab(randomHistory(rng(7))), LH, 2);
  const built = S.buildLedgerCheckpointFromItems_(items, 'gen-new');
  const rows = throughTheTab(S.ledgerCheckpointRowsFromContext_(built.ctx, 'gen-new'));
  const meta = Object.assign({}, built.meta, {
    stateRows: rows.filter(x => x[1] === 'state').length,
    problemRows: rows.filter(x => x[1] === 'problem').length
  });
  check('a whole checkpoint loads', !!S.ledgerCheckpointContextFromRows_(rows, meta).ctx, true);
  const killed = rows.map((row, i) => (i < rows.length / 2 ? row : ['gen-old'].concat(row.slice(1))));
  check('half new and half old (a build killed mid-write) is refused',
    !!S.ledgerCheckpointContextFromRows_(killed, meta).error, true);
  check('a row short is refused', !!S.ledgerCheckpointContextFromRows_(rows.slice(1), meta).error, true);
  check('no meta is refused', !!S.ledgerCheckpointContextFromRows_(rows, null).error, true);
  const meta2 = Object.assign({}, meta, { headers: meta.headers.filter(h => h !== 'Phone') });
  const fewer = rows.map(row => {
    if (row[1] !== 'state') return row;
    const d = JSON.parse(row[3]);
    d.r = d.r.filter((_, i) => i !== meta.headers.indexOf('Phone'));
    return [row[0], row[1], row[2], JSON.stringify(d)];
  });
  const loaded = S.ledgerCheckpointContextFromRows_(fewer, meta2);
  const someId = Object.keys(loaded.ctx.states)[0];
  check('a column added since the build reads back blank, by name',
    loaded.ctx.states[someId].row.length === S.HEADERS.All_Registrants.length &&
    loaded.ctx.states[someId].row[S.HEADERS.All_Registrants.indexOf('Phone')], '');
}

// --- 5. the tabs, the gate and ledgerFoldNow ---------------------------------

function fakeSheet(name, data) {
  const calls = { dataRange: 0, ranged: [] };
  const sheet = {
    name: name, data: data, calls: calls, hidden: false,
    getName: () => name,
    getLastRow: () => {
      let last = 0;
      sheet.data.forEach((row, i) => { if (row.some(c => c !== '' && c !== null)) last = i + 1; });
      return last;
    },
    getLastColumn: () => Math.max(0, ...sheet.data.map(row => row.length)),
    getDataRange: () => {
      calls.dataRange++;
      const rows = sheet.getLastRow();
      const cols = sheet.getLastColumn();
      return { getValues: () => sheet.data.slice(0, rows).map(row => { const r = row.slice(0, cols); while (r.length < cols) r.push(''); return r; }) };
    },
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      calls.ranged.push([r, nr]);
      return {
        getValues: () => {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const src = sheet.data[r - 1 + i] || [];
            const row = [];
            for (let j = 0; j < nc; j++) row.push(src[c - 1 + j] === undefined ? '' : src[c - 1 + j]);
            out.push(row);
          }
          return out;
        },
        setValues: values => {
          values.forEach((row, i) => {
            while (sheet.data.length < r + i) sheet.data.push([]);
            row.forEach((cell, j) => { sheet.data[r - 1 + i][c - 1 + j] = cell; });
          });
          return sheet;
        },
        setNumberFormat: () => {},
        setFontWeight: () => {},
        getRow: () => r
      };
    },
    setFrozenRows: () => {},
    hideSheet: () => { sheet.hidden = true; }
  };
  return sheet;
}

{
  const ledgerRows = randomHistory(rng(42));
  const ledger = fakeSheet(S.SHEET_NAMES.REGISTRATION_LEDGER, [LH.slice()].concat(throughTheTab(ledgerRows)));
  const sheets = { [ledger.name]: ledger };
  S.__ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => { sheets[n] = fakeSheet(n, []); return sheets[n]; }
  };

  const fullNow = () => S.foldRegistrationLedger(
    S.ledgerItemsFromValues_(ledger.data.slice(1), LH, 2).filter(it => it.entry).map(it => it.entry));

  check('no checkpoint: validation has nothing to compare', S.validateLedgerCheckpoint().status, 'none');

  const meta = S.refreshLedgerCheckpointNightly();
  const cpSheet = sheets[S.SHEET_NAMES.LEDGER_CHECKPOINT];
  check('the nightly build creates the tab', !!cpSheet, true);
  check('…hidden', cpSheet.hidden, true);
  check('…covering through the last ledger row', meta.coveredThroughRow, ledger.data.length);
  check('…with one row per registration ever seen, dead ones too',
    meta.stateRows, Object.keys(fullNow().states).length);
  check('the ledger itself is untouched by the build', JSON.stringify(ledger.data.slice(1)), JSON.stringify(throughTheTab(ledgerRows)));

  // Gate closed: ledgerFoldNow reads the whole ledger, as before.
  S.invalidateLedgerFold();
  ledger.calls.dataRange = 0;
  S.ledgerFoldNow();
  check('gate closed: ledgerFoldNow reads the whole ledger', ledger.calls.dataRange, 1);
  check('gate closed: the fast path answers null', S.foldLedgerFromCheckpointIfAllowed_(), null);

  // A clean comparison counts a day — once per day however often it runs.
  check('validation: clean', S.validateLedgerCheckpoint().status, 'clean');
  S.validateLedgerCheckpoint();
  check('…counted once for the day', JSON.parse(store[S.LEDGER_CHECKPOINT_GATE_PROP_KEY]).cleanDays.length, 1);

  // Open the gate as 30 clean days would.
  const days = [];
  for (let i = 0; i < S.LEDGER_CHECKPOINT_CLEAN_DAYS_REQUIRED; i++) days.push(`2026-09-${String(i + 1).padStart(2, '0')}`);
  store[S.LEDGER_CHECKPOINT_GATE_PROP_KEY] = JSON.stringify({ cleanDays: days });
  check('the gate opens at the required count', S.ledgerCheckpointGateOpen_(), true);

  // A tail entry, appended after the checkpoint.
  const lastTime = Math.max(...ledger.data.slice(1).map(row => new Date(row[LH.indexOf('Entry_At')]).getTime()));
  const tailEntry = {
    entryId: 'e-tail', entryAt: new Date(lastTime + 1000), kind: 'registered', registrationId: 'reg-tail',
    eventId: EVENTS[0], name: 'Tess Tail', personType: 'Registrant', partyId: '', source: 'quick-mark',
    actor: '', payload: { Meals_Ordered: 1 }, note: ''
  };
  ledger.data.push(throughTheTab([S.ledgerEntryToRow(tailEntry, LH)])[0]);

  S.invalidateLedgerFold();
  ledger.calls.dataRange = 0;
  ledger.calls.ranged = [];
  const fast = S.ledgerFoldNow();
  check('gate open: ledgerFoldNow does NOT read the whole ledger', ledger.calls.dataRange, 0);
  check('…it reads from the anchor row down', ledger.calls.ranged.some(([r, n]) => r === meta.coveredThroughRow && n === 2), true);
  check('…and gives the full fold, tail included', strict(fast), strict(fullNow()));
  check('…the tail registration is there', !!fast.states['reg-tail'], true);

  // A backdated tail entry (composed before the checkpoint, flushed after).
  const late = Object.assign({}, tailEntry, { entryId: 'e-late', entryAt: new Date(lastTime - 3600000), registrationId: 'reg-late' });
  ledger.data.push(throughTheTab([S.ledgerEntryToRow(late, LH)])[0]);
  S.invalidateLedgerFold();
  ledger.calls.dataRange = 0;
  const fallback = S.ledgerFoldNow();
  check('a backdated tail entry: the full ledger is read instead', ledger.calls.dataRange, 1);
  check('…and the answer is the full fold', strict(fallback), strict(fullNow()));
  ledger.data.pop();

  // The covered prefix moves (a compaction deleting row 2).
  const removed = ledger.data.splice(1, 1)[0];
  check('rows moved under the anchor: the fast path refuses', S.foldLedgerFromCheckpointIfAllowed_(), null);
  check('…and validation says so and sets the checkpoint aside', S.validateLedgerCheckpoint().status, 'skipped');
  check('…the meta is gone', store[S.LEDGER_CHECKPOINT_META_PROP_KEY], undefined);
  ledger.data.splice(1, 0, removed);

  // Rebuild; then a hand edit above the covered row.
  const meta2 = S.refreshLedgerCheckpointNightly();
  check('rebuilt after the tail', meta2.coveredThroughRow, ledger.data.length);
  S.noteLedgerTabEditForCheckpoint_({ range: { getRow: () => meta2.coveredThroughRow + 5 } });
  check('an edit below the covered row leaves it alone', !!store[S.LEDGER_CHECKPOINT_META_PROP_KEY], true);
  S.noteLedgerTabEditForCheckpoint_({ range: { getRow: () => 3 } });
  check('an edit at or above the covered row sets it aside', store[S.LEDGER_CHECKPOINT_META_PROP_KEY], undefined);

  // A covered cell changed WITHOUT onEdit (a script, a paste): validation catches it.
  S.refreshLedgerCheckpointNightly();
  store[S.LEDGER_CHECKPOINT_GATE_PROP_KEY] = JSON.stringify({ cleanDays: days });
  const payloadCol = LH.indexOf('Payload');
  const kindCol = LH.indexOf('Kind');
  const target = ledger.data.findIndex((row, i) => i > 0 && row[kindCol] === 'registered');
  const before = ledger.data[target][payloadCol];
  ledger.data[target][payloadCol] = JSON.stringify({ Meals_Ordered: 7, Phone: '000' });
  spooled.length = 0;
  const v = S.validateLedgerCheckpoint();
  check('a covered row changed behind its back: validation reports a difference', v.status, 'different');
  check('…the clean-day count is emptied', JSON.parse(store[S.LEDGER_CHECKPOINT_GATE_PROP_KEY]).cleanDays.length, 0);
  check('…the gate closes', S.ledgerCheckpointGateOpen_(), false);
  check('…the checkpoint is set aside', store[S.LEDGER_CHECKPOINT_META_PROP_KEY], undefined);
  check('…and the office is told', spooled.some(line => /did not match/.test(line)), true);
  ledger.data[target][payloadCol] = before;

  // A build killed after the tab write and before the meta write.
  S.refreshLedgerCheckpointNightly();
  store[S.LEDGER_CHECKPOINT_GATE_PROP_KEY] = JSON.stringify({ cleanDays: days });
  const goodMeta = store[S.LEDGER_CHECKPOINT_META_PROP_KEY];
  const m = JSON.parse(goodMeta);
  m.generation = 'some-older-build';
  store[S.LEDGER_CHECKPOINT_META_PROP_KEY] = JSON.stringify(m);
  check('meta and tab from different builds: refused', S.foldLedgerFromCheckpointIfAllowed_(), null);
  store[S.LEDGER_CHECKPOINT_META_PROP_KEY] = goodMeta;
  check('…and the matching pair is used', !!S.foldLedgerFromCheckpointIfAllowed_(), true);

  // Rollback: delete the tab.
  delete sheets[S.SHEET_NAMES.LEDGER_CHECKPOINT];
  check('the checkpoint tab deleted: refused, full fold', S.foldLedgerFromCheckpointIfAllowed_(), null);
  S.invalidateLedgerFold();
  check('…and ledgerFoldNow still answers', strict(S.ledgerFoldNow()), strict(fullNow()));

  // The off switch.
  S.refreshLedgerCheckpointNightly();
  S.setLedgerCheckpointFastPath(false);
  check('turned off: the gate is closed whatever the count', S.ledgerCheckpointGateOpen_(), false);
  S.setLedgerCheckpointFastPath(true);
  check('turned back on: the count decides', S.ledgerCheckpointGateOpen_(), true);

  // Compaction says so at once.
  check('invalidateLedgerCheckpoint blanks the meta', S.invalidateLedgerCheckpoint('the ledger was compacted'), true);
  check('…and is harmless twice', S.invalidateLedgerCheckpoint('again'), false);
  S.__ss = null;
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nall ledger checkpoint checks passed');
