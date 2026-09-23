// ============================================================================
// 99q. BULK MANUAL REGISTRANTS  (one program, a pasted list, reviewed first)
// ============================================================================
//
// Quick Mark's Register tick puts ONE person on ONE session, and that is the
// right shape for the desk. It is the wrong shape for the list a leader hands
// the office on the first day of term — twenty names on a sheet of paper or in
// an email, "these are all coming every Tuesday" — which until now was twenty
// trips through the dialog, or twenty form submissions typed in by staff.
//
// So: pick the PROGRAM first (the same reason 99m picks it first — every date
// offered is then that one program's, and a name can never land on the class
// beside it in date order), paste the list, and REVIEW what the workbook made
// of it before anything is written.
//
// THE REVIEW IS THE POINT. A pasted name is a string; a registration belongs
// to a person, and the roll (79) is where the office keeps who the people are.
// Each pasted row is matched against Member_Roll and the dialog SHOWS the
// match rather than applying it:
//
//   exact     the name, after any remembered correction (77), is a name on the
//             roll — used as-is, because it already is that person.
//   contact   the phone or email is on the roll under a DIFFERENT name —
//             offered, pre-selected, because "Bob Kaplan" with Robert Kaplan's
//             number is nearly always Robert Kaplan.
//   similar   same surname and first initial — offered and NOT pre-selected,
//             because that is also a description of a married couple (see the
//             correction in 79's banner, which is why the roll stopped folding
//             on it).
//   new       nobody — written as typed; the ordinary walk-in path adds them to
//             the roll (recordWalkInMember, 74) exactly as the desk would.
//
// HOW OFTEN is chosen once for the list and may be changed per row:
//   next      the next date only.
//   picked    the dates ticked in the dialog.
//   all       every date offered (today through the end of next month —
//             deskMonthHorizonKey, the same horizon the door registers into).
//   club      a standing place: a Club_Members row, which catches up every
//             future session by itself (applyClubRosterCatchup). Never on an
//             appointment program, which is why those are not offered at all —
//             an appointment is a chair at a time, and a list has no times.
//
// EVERY WRITE IS QUICK MARK'S REGISTER. Nothing here builds a registrant row:
// each (person, date) goes through applyQuickMarkLocked() with `register`, so
// the duplicate check, the capacity waitlisting, the walk-in roll entry and
// the wording are the desk's own and cannot drift from it. The lock is taken
// PER PERSON rather than for the whole list, so a forty-name paste does not
// shut the desk out of Quick Mark for the length of it; and the run stops at
// BULK_REGISTRANTS_BUDGET_MS and names who is left, rather than being killed
// half way through somebody's dates with nothing said.
// ============================================================================

/** Stop starting new people after this long; Apps Script's ceiling is later. */
const BULK_REGISTRANTS_BUDGET_MS = 4 * 60 * 1000;

/** The four answers to "how often", in the order the dialog offers them. */
const BULK_REGISTRANT_RECURRENCES = ['next', 'picked', 'all', 'club'];

/** Column headings the paste recognizes, lower-cased, → field. */
const BULK_REGISTRANT_HEADER_FIELDS = {
  'name': 'name', 'full name': 'name', 'registrant': 'name', 'member': 'name',
  'first': 'first', 'first name': 'first', 'first_name': 'first', 'firstname': 'first',
  'last': 'last', 'last name': 'last', 'last_name': 'last', 'lastname': 'last', 'surname': 'last',
  'phone': 'phone', 'telephone': 'phone', 'phone number': 'phone', 'cell': 'phone', 'mobile': 'phone',
  'email': 'email', 'e-mail': 'email', 'email address': 'email'
};

/**
 * The pasted text as people: [{ name, phone, email }]. A header line is used
 * when it names at least one known column; otherwise the columns are read as
 * Name, Phone, Email. An email or a phone in the wrong column is recognized
 * by its shape, because a list typed by hand has them in whatever order.
 */
function parseBulkRegistrantPaste(text) {
  const records = parseCsvText(text)
    .filter(r => r.some(cell => String(cell || '').trim() !== ''));
  if (!records.length) return [];

  const headerFields = records[0].map(cell =>
    BULK_REGISTRANT_HEADER_FIELDS[String(cell || '').trim().toLowerCase()] || '');
  const hasHeader = headerFields.some(Boolean);
  const fields = hasHeader ? headerFields : ['name', 'phone', 'email'];
  const body = hasHeader ? records.slice(1) : records;

  const people = [];
  body.forEach(record => {
    const p = { name: '', first: '', last: '', phone: '', email: '' };
    record.forEach((raw, i) => {
      const value = String(raw || '').trim();
      if (!value) return;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { p.email = p.email || value; return; }
      const field = fields[i] || '';
      if (field === 'phone' || (!field && bulkPhoneDigits_(value).length >= 7 && !/[a-z]/i.test(value))) {
        p.phone = p.phone || value;
        return;
      }
      if (field && !p[field]) p[field] = value;
    });
    // "Smith, Jane" in a single cell is a name, read the way the roll reads it.
    const name = p.name || composeMemberName(p.first, p.last);
    const parts = splitPersonName(name);
    const full = composeMemberName(parts.first, parts.last) || name;
    if (!String(full || '').trim()) return;
    people.push({ name: full, phone: p.phone, email: p.email });
  });
  return people;
}

/** The last ten digits — enough to match "610-555-0100" to "(610) 555 0100". */
function bulkPhoneDigits_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Each pasted person against the roll. Pure: `rollRows` / `map` are
 * Member_Roll rows and its index map, `corrections` the remembered spellings.
 *
 * Returns the people with { match: 'exact'|'contact'|'similar'|'new',
 * candidates: [roll names], suggested: the name the dialog pre-selects }.
 * Retired rows still match — a returning member is the same person — but are
 * listed after the active ones.
 */
function matchBulkRegistrantsToRoll(people, rollRows, map, corrections) {
  const byName = {};
  const byPhone = {};
  const byEmail = {};
  const bySurname = {};
  const ordered = (rollRows || []).slice().sort((a, b) =>
    (memberRollIsRetired(a, map) ? 1 : 0) - (memberRollIsRetired(b, map) ? 1 : 0));
  const push = (index, key, name) => {
    if (!key) return;
    (index[key] = index[key] || []);
    if (index[key].indexOf(name) === -1) index[key].push(name);
  };
  ordered.forEach(row => {
    const name = String(row[map['Name']] || '').trim();
    if (!name) return;
    push(byName, normalizeNameKey(name), name);
    push(byName, normalizeNameKey(row[map['Display_Name']]), name);
    const phone = bulkPhoneDigits_(row[map['Phone']]);
    if (phone.length >= 7) push(byPhone, phone, name);
    push(byEmail, String(row[map['Email']] || '').trim().toLowerCase(), name);
    push(bySurname, bulkSurnameKey_(name), name);
  });

  return (people || []).map(person => {
    const typed = canonicalMemberName(person.name, corrections || {});
    const exact = byName[normalizeNameKey(typed)] || [];
    if (exact.length) {
      return Object.assign({}, person, { name: typed, match: 'exact', candidates: exact, suggested: exact[0] });
    }
    const contact = [];
    const phone = bulkPhoneDigits_(person.phone);
    (phone.length >= 7 ? byPhone[phone] || [] : []).forEach(n => { if (contact.indexOf(n) === -1) contact.push(n); });
    (byEmail[String(person.email || '').trim().toLowerCase()] || [])
      .forEach(n => { if (contact.indexOf(n) === -1) contact.push(n); });
    if (contact.length) {
      // One candidate is a suggestion; several people on one number is the
      // household or the office's own line, and a person has to choose.
      return Object.assign({}, person, { name: typed,
        match: 'contact', candidates: contact, suggested: contact.length === 1 ? contact[0] : typed
      });
    }
    const similar = (bySurname[bulkSurnameKey_(typed)] || []);
    if (similar.length) {
      return Object.assign({}, person, { name: typed, match: 'similar', candidates: similar, suggested: typed });
    }
    return Object.assign({}, person, { name: typed, match: 'new', candidates: [], suggested: typed });
  });
}

/** "jane smith" → "smith|j". Empty for a one-word name, which matches nothing. */
function bulkSurnameKey_(name) {
  const parts = splitPersonName(String(name || ''));
  const first = normalizeNameKey(parts.first);
  const last = normalizeNameKey(parts.last);
  return first && last ? `${last}|${first.charAt(0)}` : '';
}

/**
 * Every program the list can be pasted against: one entry per building ×
 * title, with its upcoming dated sessions through the end of next month.
 * Appointment programs and lunch-only rows are left out (see the banner).
 */
function listBulkRegistrantPrograms() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss ? ss.getSheetByName(SHEET_NAMES.REGISTRANT_DASH) : null;
  const registrantRows = sheet
    ? getSectionedRowValues(sheet, HEADERS.All_Registrants, 'Event_ID')
    : [];
  return groupBulkRegistrantPrograms_(collectKnownProgramChoices(null, registrantRows));
}

/** Pure half of listBulkRegistrantPrograms(), so the grouping is testable. */
function groupBulkRegistrantPrograms_(choices) {
  const todayKey = formatDateKey(new Date());
  const horizonKey = deskMonthHorizonKey(new Date());
  const byKey = {};
  (choices || []).forEach(choice => {
    if (!choice.dateKey || choice.lunchOnly || choice.appointment) return;
    if (choice.dateKey < todayKey || choice.dateKey > horizonKey) return;
    const key = `${choice.location}${QUICK_MARK_SESSION_KEY_SEPARATOR}${choice.title}`;
    if (!byKey[key]) {
      byKey[key] = { key, title: choice.title, location: choice.location, sessions: [] };
    }
    if (byKey[key].sessions.some(s => s.value === choice.label)) return;
    byKey[key].sessions.push({
      value: choice.label,
      dateKey: choice.dateKey,
      dateLabel: formatDateLabel(parseDateKey(choice.dateKey))
    });
  });
  return Object.keys(byKey).map(k => byKey[k])
    .map(p => {
      p.sessions.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
      p.label = `${p.title} — ${p.location || 'no location'} (${p.sessions.length} upcoming)`;
      return p;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Which session values one person is registered for. Pure. A `picked` list
 * is re-checked against the program's own sessions — a date that has gone
 * past, or a value the dialog did not draw, is not a date anybody chose.
 */
function bulkRegistrantSessionsFor(program, recurrence, pickedDateKeys) {
  const sessions = (program && program.sessions) || [];
  if (!sessions.length) return [];
  if (recurrence === 'next' || recurrence === 'club') return [sessions[0]];
  if (recurrence === 'all') return sessions.slice();
  if (recurrence === 'picked') {
    const wanted = {};
    (pickedDateKeys || []).forEach(k => { wanted[String(k)] = true; });
    return sessions.filter(s => wanted[s.dateKey]);
  }
  return [];
}

/** Called from the dialog: the pasted list, matched, for review. Writes nothing. */
function previewBulkRegistrants(text) {
  const people = parseBulkRegistrantPaste(text);
  if (!people.length) {
    return { ok: false, message: '⚠️ No names found in that text — at least one column has to be a name.' };
  }
  let rows = [];
  let map = getIndexMap(HEADERS.Member_Roll);
  let corrections = {};
  try {
    rows = readMemberRollRows().rows;
    corrections = readMemberNameCorrections();
  } catch (err) {
    log(`ℹ️ Bulk registrants could not read the roll (${err}) — everyone will show as new.`);
  }
  const matched = matchBulkRegistrantsToRoll(people, rows, map, corrections);
  return {
    ok: true,
    people: matched,
    counts: ['exact', 'contact', 'similar', 'new'].reduce((acc, k) => {
      acc[k] = matched.filter(p => p.match === k).length;
      return acc;
    }, {})
  };
}

/**
 * Called from the dialog: writes the reviewed list. `args` is
 * { programKey, picked: [dateKey], people: [{ name, phone, email, recurrence, lunch }] }.
 * Returns { ok, lines, remaining } — one line per person, in the words the
 * desk's own write used, and the names not reached if the budget ran out.
 */
function commitBulkRegistrants(args) {
  args = args || {};
  const started = Date.now();
  const program = listBulkRegistrantPrograms().filter(p => p.key === args.programKey)[0];
  if (!program) {
    return { ok: false, lines: ['⚠️ That program has no upcoming dates any more — nothing was written. ' +
      'Close this and open it again.'], remaining: [] };
  }
  const people = (args.people || []).filter(p => String((p && p.name) || '').trim());
  const lines = [];
  const remaining = [];
  let written = 0;

  people.forEach(person => {
    const name = String(person.name).trim();
    if (Date.now() - started > BULK_REGISTRANTS_BUDGET_MS) { remaining.push(name); return; }
    const recurrence = BULK_REGISTRANT_RECURRENCES.indexOf(person.recurrence) !== -1
      ? person.recurrence : 'next';
    const sessions = bulkRegistrantSessionsFor(program, recurrence, args.picked);
    if (!sessions.length) {
      lines.push(`⚠️ ${name} — no dates chosen, so nothing was written.`);
      return;
    }
    const result = withScriptLock(DESK_LOCK_WAIT_MS * 5, () => {
      let done = 0;
      let refused = '';
      sessions.forEach(session => {
        const res = applyQuickMarkLocked({
          location: program.location,
          session: session.value,
          name,
          register: true,
          standing: recurrence === 'club',
          standingLunch: recurrence === 'club' && !!person.lunch,
          signup: !!person.lunch && recurrence !== 'club',
          confirmWalkIn: true,
          phone: String(person.phone || ''),
          email: String(person.email || '')
        }) || {};
        if (res.ok) done++;
        else if (!refused) refused = res.message || '';
      });
      // Inside the lock, per person: the desk write buffers its ledger entries
      // (99k), and an entry buffered and never flushed is the loss the ledger
      // exists to prevent. One flush per person, not per date.
      flushPersistentRegistries();
      return { done, refused };
    }, null);

    if (!result) { remaining.push(name); return; }
    written += result.done;
    if (recurrence === 'club') {
      lines.push(result.done
        ? `🔁 ${name} — standing place on ${program.title}; every future date will follow.`
        : `⚠️ ${name} — no standing place was made. ${result.refused}`);
    } else {
      lines.push(result.done
        ? `✅ ${name} — ${result.done} of ${sessions.length} date(s).` +
          (result.refused ? ` Not the rest: ${result.refused}` : '')
        : `⚠️ ${name} — nothing written. ${result.refused}`);
    }
  });

  log(`commitBulkRegistrants: ${program.label} — ${written} registration(s) for ` +
    `${people.length - remaining.length} of ${people.length} people.`);
  return { ok: true, lines, remaining };
}

/** The menu item. Open to everyone, like Quick Mark's Register: it deletes nothing. */
function showBulkRegistrantsDialog() {
  const html = HtmlService.createHtmlOutput(buildBulkRegistrantsHtml())
    .setWidth(860)
    .setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add Registrants in Bulk');
}

/**
 * The dialog's markup. Nothing from the workbook is interpolated here: the
 * programs and the preview are fetched at runtime and written with
 * textContent, so a member called O'Brien or a program titled `</script>`
 * cannot end the page.
 */
function buildBulkRegistrantsHtml() {
  return `
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; margin: 12px; }
  h3 { margin: 12px 0 6px 0; font-size: 14px; }
  p.hint { color: #666; margin: 0 0 8px 0; line-height: 1.4; }
  select, textarea { font-size: 13px; }
  textarea { width: 100%; height: 110px; font-family: Consolas, Menlo, monospace; font-size: 12px;
             box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
  button { background: #1155CC; color: #fff; border: 0; border-radius: 4px; padding: 8px 16px;
           font-size: 13px; cursor: pointer; margin-right: 6px; }
  button[disabled] { background: #9aa0a6; cursor: default; }
  #dates label { display: inline-block; margin: 2px 10px 2px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: middle; }
  th { background: #f1f3f4; }
  .exact { color: #188038; } .contact { color: #b06000; } .similar { color: #b06000; } .new { color: #1155CC; }
  #review { max-height: 260px; overflow: auto; }
  #status { margin-top: 10px; white-space: pre-wrap; }
  .err { color: #C5221F; font-weight: bold; }
</style>
<h3>1. Program</h3>
<select id="program" style="width:100%"><option value="">Loading…</option></select>
<div id="recurrenceRow" style="margin-top:8px">
  How often, for everyone (change any row below):
  <select id="recurrence">
    <option value="next">Next date only</option>
    <option value="picked">The dates ticked below</option>
    <option value="all">Every date through next month</option>
    <option value="club">Standing place (every future date)</option>
  </select>
  <label style="margin-left:12px"><input type="checkbox" id="lunch"> with lunch</label>
</div>
<div id="dates" style="margin-top:6px"></div>
<h3>2. Paste the list</h3>
<p class="hint">One person per line — <code>Name, Phone, Email</code>, or a header line such as
<code>First, Last, Phone, Email</code>. A paste out of a spreadsheet works as it is.</p>
<textarea id="csv"></textarea>
<div style="margin-top:8px"><button id="check" onclick="check()">Check against the member roll</button></div>
<h3>3. Review</h3>
<p class="hint"><span class="exact">On the roll</span> is used as-is.
<span class="contact">Same phone/email</span> is pre-selected — check it.
<span class="similar">Similar name</span> is offered but not chosen.
<span class="new">New</span> is added to the roll as typed. Untick anybody to leave them out.</p>
<div id="review"></div>
<div style="margin-top:8px"><button id="commit" onclick="commit()" disabled>Register them</button></div>
<div id="status"></div>
<script>
  var PROGRAMS = [];
  var PEOPLE = [];
  var LABELS = { exact: 'On the roll', contact: 'Same phone/email', similar: 'Similar name', 'new': 'New' };
  var RECURRENCES = [['next','Next date'],['picked','Ticked dates'],['all','Every date'],['club','Standing']];

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text !== undefined && text !== null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function say(text, cls) { var s = document.getElementById('status'); s.textContent = text; s.className = cls || ''; }
  function program() {
    var key = document.getElementById('program').value;
    for (var i = 0; i < PROGRAMS.length; i++) if (PROGRAMS[i].key === key) return PROGRAMS[i];
    return null;
  }

  google.script.run.withSuccessHandler(function (list) {
    PROGRAMS = list || [];
    var sel = document.getElementById('program');
    sel.textContent = '';
    sel.appendChild(el('option', PROGRAMS.length ? 'Choose a program…' : 'No upcoming programs found'));
    sel.options[0].value = '';
    PROGRAMS.forEach(function (p) { var o = el('option', p.label); o.value = p.key; sel.appendChild(o); });
  }).withFailureHandler(function (err) { say('Could not read the programs: ' + err.message, 'err'); })
    .listBulkRegistrantPrograms();

  document.getElementById('program').addEventListener('change', drawDates);
  function drawDates() {
    var box = document.getElementById('dates');
    box.textContent = '';
    var p = program();
    if (!p) return;
    p.sessions.forEach(function (s) {
      var l = el('label');
      var c = document.createElement('input');
      c.type = 'checkbox'; c.value = s.dateKey; c.className = 'date'; c.checked = true;
      l.appendChild(c); l.appendChild(document.createTextNode(' ' + s.dateLabel));
      box.appendChild(l);
    });
    updateCommit();
  }

  document.getElementById('recurrence').addEventListener('change', function () {
    var v = this.value;
    Array.prototype.forEach.call(document.querySelectorAll('select.rec'), function (s) { s.value = v; });
  });

  function check() {
    var text = document.getElementById('csv').value;
    if (!text.trim()) { say('Paste some names first.', 'err'); return; }
    document.getElementById('check').disabled = true;
    say('Reading…');
    google.script.run.withSuccessHandler(function (res) {
      document.getElementById('check').disabled = false;
      if (!res || !res.ok) { say((res && res.message) || 'Nothing came back.', 'err'); return; }
      PEOPLE = res.people;
      drawReview();
      var c = res.counts;
      say(PEOPLE.length + ' people: ' + c.exact + ' on the roll, ' + c.contact + ' by phone/email, ' +
        c.similar + ' similar, ' + c['new'] + ' new.');
    }).withFailureHandler(function (err) {
      document.getElementById('check').disabled = false;
      say('Failed: ' + err.message, 'err');
    }).previewBulkRegistrants(text);
  }

  function drawReview() {
    var box = document.getElementById('review');
    box.textContent = '';
    var table = el('table');
    var head = el('tr');
    ['', 'Pasted', 'Match', 'Register as', 'Phone', 'Email', 'How often'].forEach(function (h) { head.appendChild(el('th', h)); });
    table.appendChild(head);
    var defaultRec = document.getElementById('recurrence').value;
    PEOPLE.forEach(function (p, i) {
      var tr = el('tr');
      var tdOn = el('td'); var on = document.createElement('input');
      on.type = 'checkbox'; on.checked = true; on.className = 'on'; on.dataset.i = i;
      on.addEventListener('change', updateCommit);
      tdOn.appendChild(on); tr.appendChild(tdOn);
      tr.appendChild(el('td', p.name));
      tr.appendChild(el('td', LABELS[p.match] || p.match, p.match));
      var tdAs = el('td'); var as = document.createElement('select'); as.className = 'as';
      var names = [];
      (p.candidates || []).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
      if (p.match !== 'exact' && names.indexOf(p.name) === -1) names.push(p.name);
      names.forEach(function (n) {
        var o = el('option', n === p.name && p.match !== 'exact' ? n + ' (as typed — new)' : n);
        o.value = n; as.appendChild(o);
      });
      as.value = p.suggested;
      tdAs.appendChild(as); tr.appendChild(tdAs);
      tr.appendChild(el('td', p.phone || ''));
      tr.appendChild(el('td', p.email || ''));
      var tdRec = el('td'); var rec = document.createElement('select'); rec.className = 'rec';
      RECURRENCES.forEach(function (r) { var o = el('option', r[1]); o.value = r[0]; rec.appendChild(o); });
      rec.value = defaultRec;
      tdRec.appendChild(rec); tr.appendChild(tdRec);
      table.appendChild(tr);
    });
    box.appendChild(table);
    updateCommit();
  }

  function updateCommit() {
    var any = document.querySelectorAll('input.on:checked').length > 0;
    document.getElementById('commit').disabled = !(any && program());
  }

  function commit() {
    var p = program();
    if (!p) { say('Choose a program first.', 'err'); return; }
    var picked = Array.prototype.map.call(document.querySelectorAll('input.date:checked'), function (c) { return c.value; });
    var rows = document.querySelectorAll('#review tr');
    var people = [];
    var lunch = document.getElementById('lunch').checked;
    for (var r = 1; r < rows.length; r++) {
      var on = rows[r].querySelector('input.on');
      if (!on || !on.checked) continue;
      var src = PEOPLE[Number(on.dataset.i)];
      people.push({ name: rows[r].querySelector('select.as').value, phone: src.phone, email: src.email,
        recurrence: rows[r].querySelector('select.rec').value, lunch: lunch });
    }
    if (!confirm('Register ' + people.length + ' people on ' + p.label + '?')) return;
    document.getElementById('commit').disabled = true;
    say('Registering… this takes a few seconds a person.');
    google.script.run.withSuccessHandler(function (res) {
      var text = (res.lines || []).join('\\n');
      if (res.remaining && res.remaining.length) {
        text += '\\n\\n⏳ Ran out of time before: ' + res.remaining.join(', ') +
          '. Paste just those and run again.';
      }
      say(text || 'Done.', res.ok ? '' : 'err');
    }).withFailureHandler(function (err) {
      updateCommit();
      say('Failed: ' + err.message, 'err');
    }).commitBulkRegistrants({ programKey: p.key, picked: picked, people: people });
  }
</script>`;
}
