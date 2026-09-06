// ============================================================================
// 85. DUPLICATE REGISTRATIONS  (review them, then collapse them)
// ============================================================================
//
// ONE PERSON, ONE SESSION, TWO ROWS. It happens every week and never for one
// reason:
//
//   • somebody registers on the form and is then signed in at the door as a
//     walk-in, because the desk could not find them in the list;
//   • a form is submitted twice — the confirmation page did not load, so they
//     pressed the button again;
//   • a family member fills it in under a slightly different spelling, and
//     "Bob Smith" and "Bob (Robert) Smith" are two people to a workbook and
//     one person to everybody else;
//   • a club catch-up books a place the person had already booked by hand.
//
// The cost is not tidiness. Two rows are two seats against a capacity, two
// meals against a catering count, and two lines on the sign-in sheet with the
// marks split across them — so the desk ticks one, the kitchen counts the
// other, and the roster says the class is full when it is not.
//
// WHY THIS IS A REVIEW AND NOT A SWEEP. Two rows for one person on one session
// are USUALLY a duplicate and not always: a name common enough to be shared
// ("Mary Kelly") is two people, and a person who cancelled and signed up again
// is one person with two decisions. Nothing in this workbook can tell those
// apart, and quietly merging either is worse than leaving both. So this lists
// what it found, says what each group looks like, and merges only what
// somebody ticks. Section 79's Member_Roll dedupe folds duplicates on every
// write because a roll of PEOPLE has an answer that is safe by default; a
// registration is a record of something that happened, and it does not.
//
// WHAT COUNTS AS ONE PERSON. Same session (Event_ID), and the same name once
// the spelling is normalized: case and spacing (normalizeNameKey), the
// correction map an earlier merge left behind (canonicalMemberName), and the
// PARENTHETICAL — "Bob (Robert) Smith", 'Robert "Bob" Smith' and "Bob Smith"
// are all filed under the same person, which is exactly what parseMemberName()
// is for (section 77). Person_Type is part of the key: a registrant and their
// guest are two people who share a session and often a surname.
//
// WHAT IS LEFT ALONE. A CANCELLED or superseded row is never grouped with a
// live one. "They cancelled and then signed up again" is the history the
// cancellation writer (section 71) exists to keep, and folding the two
// together would erase the cancellation and keep the seat count right by
// accident.
//
// WHAT COLLAPSING DOES, exactly, and it is additive in every column — the same
// rule mergeMemberRollRows() follows, for the same reason: everything on
// either row was put there by somebody, and a merge that drops an answer is a
// merge nobody can undo.
//
//   • the marks (Attended, Lunch_Served, Contacted, Confirmed) are OR-ed — a
//     tick on either row is a tick;
//   • the meal counts take the MAXIMUM per column, never the sum: the two rows
//     are two records of ONE person's meal, and adding them is how a duplicate
//     becomes a double order (see dedupeSignInEntries() in 45, which reads the
//     same way);
//   • Party_Size takes the maximum, for the same reason;
//   • text columns keep what the surviving row has, and take the other row's
//     where the survivor's cell is empty; the two notes columns are JOINED
//     when they differ, because choosing between two typed sentences on
//     somebody's behalf is how a note about a wheelchair ramp disappears;
//   • the status is the most ACTIVE of the group (Active beats Waitlisted),
//     since the person is coming either way and a stale waitlist row must not
//     take the seat back off them.
//
// AND WHAT MAKES IT STICK. Dropping a row is not enough on its own where the
// two rows were spelled differently: the next import reads the response under
// the old spelling, finds no row with that key, and writes it straight back.
// So a merge across two spellings ALSO remembers the correction
// (rememberMemberNameCorrection, section 77) — which is what makes every
// future response arrive under the surviving name — and tombstones the dropped
// key (section 28). Where the two rows had the SAME key, neither is needed and
// neither is done: the import matches existing rows by that key and appends
// nothing, and a tombstone on it would suppress the row that was KEPT.
// ============================================================================

/** How far back the review looks. Older than this is archive, not a duplicate to fix. */
const DUPLICATE_REGISTRATIONS_WINDOW_BACK_DAYS = 120;
/** And how far forward — wide enough to cover anything with a form open. */
const DUPLICATE_REGISTRATIONS_WINDOW_FORWARD_DAYS = 180;

/** Statuses that mean this row is not a live registration and never groups with one. */
const DUPLICATE_REGISTRATIONS_DEAD_STATUSES = ['Cancelled', 'Superseded'];

/** Program_Status values in order of how ACTIVE they are — the survivor takes the first one present. */
const DUPLICATE_REGISTRATIONS_STATUS_RANK = ['Active', 'Waitlisted', ''];

/** MENU ENTRY: show what looks like a duplicate, and collapse what is ticked. */
function showDuplicateRegistrationsDialog() {
  // Gated in both places, like the deletion dialog beside it: the dialog calls
  // collapseDuplicateRegistrationGroups() directly, and a menu function is
  // callable by name whether or not the menu drew it.
  if (!requireAuthorizedAdmin('Collapse Duplicate Registrations')) return;
  if (isBootstrapActive()) {
    toastIfPossible(bootstrapBusyMessage());
    return;
  }
  const groups = findDuplicateRegistrationGroups();
  if (groups.length === 0) {
    toastIfPossible('No duplicate registrations found in the last few months.');
    return;
  }
  const html = HtmlService.createHtmlOutput(buildDuplicateRegistrationsHtml(groups))
    .setWidth(720)
    .setHeight(660);
  SpreadsheetApp.getUi().showModalDialog(html, 'Review Duplicate Registrations');
}

/**
 * The identity a duplicate is judged on: one session, one person, one kind of
 * person. Returns '' for a row that cannot be judged at all.
 *
 * The name goes through canonicalMemberName() FIRST (so a correction somebody
 * already made is applied) and parseMemberName() second (so the parenthetical
 * or the quoted nickname is lifted off rather than making a second person).
 */
function duplicateRegistrationKey(row, map) {
  const eventId = String(row[map['Event_ID']] || '').trim();
  const rawName = String(row[map['Name']] || '').trim();
  if (!eventId || !rawName) return '';
  const parsed = parseMemberName(canonicalMemberName(rawName));
  const nameKey = normalizeNameKey(parsed.name || rawName);
  if (!nameKey) return '';
  const personType = normalizeNameKey(row[map['Person_Type']]);
  return `${eventId}|${nameKey}|${personType}`;
}

/** True for a row whose registration has already ended — see the banner. */
function isDeadRegistrationRow(row, map) {
  const status = String(row[map['Program_Status']] || '').trim();
  return DUPLICATE_REGISTRATIONS_DEAD_STATUSES.indexOf(status) !== -1;
}

/**
 * Every group of two or more live rows inside the window that name the same
 * person on the same session.
 *
 * Returns [{ key, label, detail, count, spellings }], newest session first —
 * the shape the dialog draws and the shape collapseDuplicateRegistrationGroups()
 * is handed back.
 */
function findDuplicateRegistrationGroups() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return [];

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const backKey = formatDateKey(new Date(Date.now() - DUPLICATE_REGISTRATIONS_WINDOW_BACK_DAYS * 86400000));
  const forwardKey = formatDateKey(new Date(Date.now() + DUPLICATE_REGISTRATIONS_WINDOW_FORWARD_DAYS * 86400000));

  const byKey = {};
  getSectionedRows(sheet, headers, 'Event_ID').forEach(row => {
    if (isDeadRegistrationRow(row, map)) return;
    const key = duplicateRegistrationKey(row, map);
    if (!key) return;
    const date = coerceDate(row[map['Event_Date']]);
    if (!date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < backKey || dateKey > forwardKey) return;
    if (!byKey[key]) byKey[key] = { key, dateKey, date, rows: [], spellings: [] };
    byKey[key].rows.push(row);
    const spelling = String(row[map['Name']] || '').trim();
    if (spelling && byKey[key].spellings.indexOf(spelling) === -1) byKey[key].spellings.push(spelling);
  });

  return Object.keys(byKey)
    .map(k => byKey[k])
    .filter(group => group.rows.length > 1)
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : (a.dateKey > b.dateKey ? -1 : 0)))
    .map(group => {
      const first = group.rows[0];
      const name = group.spellings.join('  /  ');
      return {
        key: group.key,
        count: group.rows.length,
        // BOTH SPELLINGS IN THE LABEL, where there are two: it is the one
        // thing that tells somebody at a glance whether this is a duplicate or
        // two people who happen to share a name.
        label: `${name} — ${formatDateLabel(group.date)} · ` +
          `${String(first[map['Event']] || '').trim() || '(untitled)'} ` +
          `(${String(first[map['Location']] || '').trim()}) — ${group.rows.length} rows`,
        detail: describeDuplicateRegistrationGroup(group.rows, map)
      };
    });
}

/** One line per row in a group, so somebody can see what would be folded together. */
function describeDuplicateRegistrationGroup(rows, map) {
  return rows.map(row => {
    const bits = [];
    const source = String(row[map['Form_Source']] || '').trim();
    bits.push(source ? source.replace(/^=HYPERLINK\(.*?,\s*"?|"?\)$/g, '') : 'typed in');
    const status = String(row[map['Program_Status']] || '').trim();
    if (status) bits.push(status);
    if (isTruthyCheckbox(row[map['Attended']])) bits.push('marked attended');
    const meals = Number(row[map['Meals_Ordered']]) || 0;
    if (meals > 0) bits.push(`${meals} meal(s)`);
    const notes = String(row[map['Admin_Notes']] || '').trim();
    if (notes) bits.push('has notes');
    return `${String(row[map['Name']] || '').trim()} — ${bits.join(' · ')}`;
  });
}

/**
 * Which row of a group survives: the one with the most to lose.
 *
 * A row that came from a FORM RESPONSE first (it has a Party_ID, so it is the
 * one the import will go on updating), then whichever row has the most cells
 * filled in. The merge is additive either way, so this decides whose Name
 * spelling and whose Event_ID row the group keeps, not which answers survive.
 */
function pickSurvivingRegistrantRow(rows, map) {
  let best = rows[0];
  let bestScore = -1;
  rows.forEach(row => {
    const filled = row.filter(cell => String(cell === null || cell === undefined ? '' : cell).trim() !== '').length;
    const score = (String(row[map['Party_ID']] || '').trim() ? 1000 : 0) + filled;
    if (score > bestScore) { best = row; bestScore = score; }
  });
  return best;
}

/** Joins two typed notes rather than picking one. Identical notes are one note. */
function joinRegistrantNotes(kept, absorbed) {
  const a = String(kept || '').trim();
  const b = String(absorbed || '').trim();
  if (!b || a === b) return a;
  return a ? `${a}\n${b}` : b;
}

/**
 * Folds `absorbed` into `kept` in place, by the rules in this file's banner.
 * Additive in every column.
 */
function mergeRegistrantRow(kept, absorbed, map) {
  REGISTRANT_DAYOF_COLUMNS.concat(LEADER_FLAG_COLUMNS).forEach(h => {
    if (map[h] === undefined) return;
    if (isTruthyCheckbox(absorbed[map[h]])) kept[map[h]] = true;
  });
  REGISTRANT_MEAL_COUNT_COLUMNS.concat(['Meals_Ordered', 'Party_Size']).forEach(h => {
    if (map[h] === undefined) return;
    const mine = Number(kept[map[h]]) || 0;
    const theirs = Number(absorbed[map[h]]) || 0;
    if (theirs > mine) kept[map[h]] = theirs;
  });
  ['Admin_Notes', 'Leader_Notes'].forEach(h => {
    if (map[h] === undefined) return;
    kept[map[h]] = joinRegistrantNotes(kept[map[h]], absorbed[map[h]]);
  });
  // THE MOST ACTIVE STATUS IN THE GROUP. A person with one Active row and one
  // Waitlisted row has a seat; keeping the waitlist row's word for it would
  // take it away on a merge nobody asked to be a demotion.
  ['Program_Status', 'Lunch_Status'].forEach(h => {
    if (map[h] === undefined) return;
    const mine = DUPLICATE_REGISTRATIONS_STATUS_RANK.indexOf(String(kept[map[h]] || '').trim());
    const theirs = DUPLICATE_REGISTRATIONS_STATUS_RANK.indexOf(String(absorbed[map[h]] || '').trim());
    if (theirs !== -1 && (mine === -1 || theirs < mine)) kept[map[h]] = absorbed[map[h]];
  });
  // Everything else: keep what the survivor has, take the other row's where
  // the survivor's cell is empty. A blank is not an answer, so filling it in
  // from the row about to go is never a loss.
  Object.keys(map).forEach(h => {
    if (map[h] === undefined) return;
    if (String(kept[map[h]] === null || kept[map[h]] === undefined ? '' : kept[map[h]]).trim() !== '') return;
    kept[map[h]] = absorbed[map[h]];
  });
}

/**
 * Called from the dialog. Collapses each ticked group into one row.
 *
 * UNDER THE SYNC LOCK, for the reason deleteRegistrationsForSections() takes
 * it: this reads the whole tab, folds rows together and writes it back, and a
 * sync running alongside would write its own copy over the result — restoring
 * every row this just merged away.
 *
 * Returns a human-readable summary for the dialog to show.
 */
function collapseDuplicateRegistrationGroups(groupKeys) {
  if (!isAuthorizedAdmin()) {
    return '⚠️ Collapsing duplicate registrations is an admin action — ask an admin to run it.';
  }
  const wanted = new Set((groupKeys || []).map(k => String(k || '').trim()).filter(Boolean));
  if (wanted.size === 0) return '⚠️ No duplicates were selected.';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    return '⚠️ A sync is running right now — try again in a moment.';
  }
  try {
    return collapseDuplicateRegistrationGroupsInternal(wanted);
  } finally {
    lock.releaseLock();
  }
}

function collapseDuplicateRegistrationGroupsInternal(wanted) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH);
  if (!sheet) return '⚠️ There is no registrants tab yet.';

  const headers = HEADERS.All_Registrants;
  const map = getIndexMap(headers);
  const allRows = getSectionedRows(sheet, headers, 'Event_ID');

  // Group again from the sheet as it stands rather than trusting what the
  // dialog was drawn from: the rows may have moved since it opened, and a key
  // that no longer names two rows is simply nothing to do.
  const groups = {};
  allRows.forEach(row => {
    if (isDeadRegistrationRow(row, map)) return;
    const key = duplicateRegistrationKey(row, map);
    if (!key || !wanted.has(key)) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  });

  const dropped = [];
  const droppedNeedingTombstone = [];
  const renames = [];
  let collapsed = 0;
  Object.keys(groups).forEach(key => {
    const rows = groups[key];
    if (rows.length < 2) return;
    const kept = pickSurvivingRegistrantRow(rows, map);
    const keptName = String(kept[map['Name']] || '').trim();
    rows.forEach(row => {
      if (row === kept) return;
      mergeRegistrantRow(kept, row, map);
      dropped.push(row);
      const goneName = String(row[map['Name']] || '').trim();
      // ONLY WHERE THE SPELLING DIFFERS — see the banner. Same spelling, same
      // import key: nothing would re-create the row, and a tombstone on that
      // key would suppress the row that was kept.
      if (goneName && normalizeNameKey(goneName) !== normalizeNameKey(keptName)) {
        droppedNeedingTombstone.push(row);
        renames.push({ absorbed: goneName, kept: keptName });
      }
    });
    collapsed++;
  });

  if (dropped.length === 0) {
    return '⚠️ Nothing to collapse — those rows are no longer duplicates.';
  }

  const keepRows = allRows.filter(row => dropped.indexOf(row) === -1);

  // Before the write, like the deletion path: a row removed on purpose that is
  // not remembered comes straight back on the next import.
  if (droppedNeedingTombstone.length > 0) recordRegistrantTombstones(droppedNeedingTombstone, map);
  // And the durable half of the same problem: from here on, a response under
  // the absorbed spelling arrives as the name that was kept. Same reasoning as
  // writeMemberRollTab() (section 79).
  renames.forEach(r => rememberMemberNameCorrection(r.absorbed, r.kept));

  renderRegistrantsSheet(false, keepRows);
  try {
    const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
    if (registrySheet) recomputeEventRegistryCounts(registrySheet, sheet, keepRows);
    updateMasterLunchDashboard(keepRows);
  } catch (err) {
    log(`⚠️ Collapsed ${dropped.length} duplicate row(s), but could not recalculate the counts (${err}).`);
    return `Collapsed ${dropped.length} duplicate row(s) — but the seat and meal counts could not be ` +
      `recalculated (${err}). Run Update Everything Now to bring them back in line.`;
  }

  const message = `Collapsed ${collapsed} duplicate registration(s), removing ${dropped.length} extra row(s). ` +
    `Every mark, meal and note from the removed rows was kept on the row that stayed.` +
    (renames.length > 0
      ? ` ${renames.length} row(s) were spelled differently — those spellings now file under the name that ` +
        `was kept, so the next sync will not write them back.`
      : '');
  log(`collapseDuplicateRegistrationGroups: ${message}`);
  return message;
}

/** The dialog's markup. Inline, so this project stays a single .gs file. */
function buildDuplicateRegistrationsHtml(groups) {
  const groupTags = groups.map(g =>
    `<div class="group">
       <label class="row"><input type="checkbox" name="group" value="${escapeHtmlForDialog(g.key)}" checked>
       <b>${escapeHtmlForDialog(g.label)}</b></label>
       <ul>${g.detail.map(d => `<li>${escapeHtmlForDialog(d)}</li>`).join('')}</ul>
     </div>`).join('\n');

  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 0 0 6px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 10px 0; line-height: 1.4; }
  #groups { border: 1px solid #ccc; border-radius: 4px; padding: 8px; height: 340px; overflow-y: auto; }
  .group { padding: 6px 0; border-bottom: 1px solid #eee; }
  .group ul { margin: 4px 0 0 24px; padding: 0; color: #555; }
  label.row { display: block; padding: 2px 0; }
  button { background: #1A73E8; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-top: 14px; }
  button.plain { background: #5F6368; margin-left: 8px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #status { margin-top: 12px; min-height: 18px; font-weight: bold; line-height: 1.5; }
  .ok { color: #188038; } .err { color: #C5221F; }
</style>
<h3>Duplicate registrations</h3>
<p class="hint">
  Each group below is <b>one person on one session with more than one row</b> — usually somebody who
  registered on the form and was then signed in at the door, or a form submitted twice. Collapsing a group
  keeps <b>one</b> row and moves every mark, meal count and note onto it; meals take the highest number
  on any row in the group, never the total.
</p>
<p class="hint">
  Untick anything that is really two people with the same name. Cancelled rows are never listed:
  somebody who cancelled and signed up again has two rows on purpose.
</p>
<div id="groups">${groupTags}</div>

<button id="go" onclick="submit()">Collapse the ticked groups</button>
<button class="plain" onclick="none()">Untick all</button>
<div id="status"></div>
<script>
  function none() {
    [].slice.call(document.querySelectorAll('input[name=group]')).forEach(function (el) { el.checked = false; });
  }
  function submit() {
    var picked = [].slice.call(document.querySelectorAll('input[name=group]:checked')).map(function (el) { return el.value; });
    if (picked.length === 0) { say('Tick at least one group first.', 'err'); return; }
    document.getElementById('go').disabled = true;
    say('Working… this can take a moment.', '');
    google.script.run
      .withSuccessHandler(function (msg) {
        document.getElementById('go').disabled = false;
        say(msg, msg.indexOf('\\u26a0') === 0 ? 'err' : 'ok');
      })
      .withFailureHandler(function (err) {
        document.getElementById('go').disabled = false;
        say('Failed: ' + err.message, 'err');
      })
      .collapseDuplicateRegistrationGroups(picked);
  }
  function say(msg, cls) {
    var el = document.getElementById('status');
    el.textContent = msg;
    el.className = cls;
  }
</script>`;
}
