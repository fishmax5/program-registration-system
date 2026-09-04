// ============================================================================
// 9d. ROSTER-CHANGE ALERTS  (telling a program leader what moved)
// ============================================================================
//
// THE PROBLEM. A leader has a live sign-up sheet (section 9b) and it is always
// right, which is exactly why nobody opens it. Somebody cancels on Tuesday for
// Thursday's class and the sheet quietly stops listing them; the leader finds
// out by setting out one chair too many. The sheet answers "who is coming?"
// perfectly and cannot answer "what changed since I last looked?" at all —
// and that second question is the only one worth interrupting somebody for.
//
// So this pass diffs each program's roster against the last one it saw and
// mails the difference. Nothing else. A sync where nobody signed up and nobody
// cancelled sends no mail, which is the only way an alert like this stays
// worth reading.
//
// IT COSTS NO NEW TRIGGER, for the same reason section 9b does not: it rides
// the hourly registration sync, at the very end, on a settled picture.
//
// ------------------------------------------------------------------ THE DIFF
//
// The snapshot is a map per program of "who was on this roster, and how" —
// keyed by DATE AND NAME, valued by a status letter and a party size. Three
// things fall out of that shape, and all three are the reason for it:
//
//   1. A REMOVED PERSON IS STILL NAMED. The key is the name, so a leader is
//      told "Mary Ray cancelled" rather than "one registration disappeared".
//      A snapshot keyed by an opaque row id could not say who left.
//
//   2. AGEING OUT IS NOT LEAVING, and this is the failure the whole design is
//      arranged around. The roster only covers a window; every day, the
//      sessions that fall off the back of it stop being in the snapshot. Keyed
//      by date, a vanished entry can be checked against the window before it
//      is reported, so last month's class rolling out of range is silence
//      rather than "nine people dropped out".
//
//   3. IT STAYS SMALL. Names and dates compress to about thirty characters an
//      entry, and only programs with a leader who ASKED for alerts are tracked
//      at all — usually a handful, never the whole workbook.
//
// The one thing this shape gives up is telling two people with the same name
// in one class on one day apart. That merges two lines of an email into one.
// It is the right trade against every alternative that made removals anonymous.
//
// ------------------------------------------------------------ THE FIRST RUN
//
// A program with NO stored snapshot sends nothing, and records one. Every
// other reading of "no previous state" is wrong in the same expensive way: the
// first sync after this feature ships, or after a leader ticks the box, would
// mail them their entire roster as forty new registrations. A baseline is not
// news.
//
// ------------------------------------------------------ AND IF THE MAIL FAILS
//
// The snapshot for a program advances only once its email is actually away.
// A send that fails leaves the old snapshot in place, so the next run reports
// those changes again along with anything newer — late, but not lost. The
// alternative loses the one thing this feature exists to deliver, silently.
// ============================================================================

/** Where the per-program roster snapshots live. Chunked: see writeChunkedScriptProperty(). */
const LEADER_ALERT_STATE_PROP_KEY = 'PROGRAM_LEADER_ROSTER_STATE_V1';
const LEADER_ALERT_STATE_CHUNK_CHARS = 8000;

/**
 * How many chunks the snapshot may occupy — about 320KB, against a 500KB
 * Script Properties budget shared with every other registry in this project.
 * Reaching it means something has gone wrong upstream (a window that stopped
 * bounding, a program with thousands of rows), and the store refusing an
 * oversized blob is better than it evicting somebody else's.
 */
const LEADER_ALERT_STATE_MAX_CHUNKS = 40;

/**
 * The window a roster change is worth an email about.
 *
 * FORWARD ONLY, unlike the sheet's own 14-day look-back. The sheet exists to
 * be marked up after the fact; an alert exists to change what somebody does
 * next, and nobody can act on a cancellation for a class that has already
 * happened. Today is included because a cancellation for this afternoon is the
 * single most useful message this feature sends.
 */
const LEADER_ALERT_BACK_DAYS = 0;
const LEADER_ALERT_FORWARD_DAYS = 60;

/**
 * The most alerts one run will send.
 *
 * MailApp allows 100 messages a day on a consumer account and 1500 on
 * Workspace, and this pass runs hourly. A quiet sync sends nothing at all, so
 * the realistic load is far below either — but "realistic" is not a guarantee,
 * and the day a bulk import touches every roster at once is the day this
 * would spend the whole quota in one execution and take the workbook's other
 * mail down with it. Whatever is skipped keeps its old snapshot and goes out
 * on the next pass.
 */
const LEADER_ALERT_MAX_EMAILS_PER_RUN = 25;

/**
 * The floor this pass will not dig the day's mail quota below — the `reserve`
 * sendRationedEmail() is given (section 9f).
 *
 * HALF THE CONSUMER ALLOWANCE, and deliberately not the same number as
 * REMINDER_QUOTA_RESERVE, because THIS PASS RUNS FIRST: the registration
 * import calls it and then, twenty lines later, calls the reminder pass in
 * the same execution off the same hundred messages. A roster alert says
 * something changed and is worth reading tomorrow if it has to wait; a
 * reminder names the time somebody is expected somewhere and is worth
 * nothing at all the day after. So the pass that goes first stops well short
 * and leaves the rest for the one that follows — whatever is held back here
 * keeps its old snapshot and goes out on the next sync.
 *
 * On a Workspace account (1500 a day) neither number is ever reached.
 */
const LEADER_ALERT_QUOTA_RESERVE = 50;

/** How many changed lines one program contributes before the email summarizes instead. */
const LEADER_ALERT_MAX_LINES_PER_PROGRAM = 40;

/** Program_Status, as one character. Anything else — including blank — reads as Active. */
const LEADER_ALERT_STATUS_CODES = { Active: 'A', Waitlisted: 'W', Cancelled: 'C' };

/** ...and back to the words a person reads. */
const LEADER_ALERT_STATUS_WORDS = { A: 'Active', W: 'Waitlisted', C: 'Cancelled' };


// --- the stored snapshot -----------------------------------------------------

let __leaderAlertStateCache = null;

/**
 * { programs: { programKey: { at: iso, roster: { "dateKey|name": "A2" } } } }
 *
 * `at` is when an alert last went out for that program, and it is what the
 * Program_Leaders tab's Last_Notified column renders — kept here rather than
 * written onto the tab so that the tab stays a thing staff type into and this
 * stays the only writer of the state it reports.
 */
function readProgramLeaderNotifyState() {
  if (__leaderAlertStateCache) return __leaderAlertStateCache;
  const raw = readChunkedScriptProperty(LEADER_ALERT_STATE_PROP_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Unreadable is treated as ABSENT, which makes every program look like a
    // first run: one quiet pass that re-baselines instead of one mail-out
    // claiming the whole roster just arrived.
    log(`⚠️ The program leader alert state could not be parsed (${err}) — starting a fresh baseline.`);
  }
  __leaderAlertStateCache = (parsed && parsed.programs) ? parsed : { programs: {} };
  return __leaderAlertStateCache;
}

function writeProgramLeaderNotifyState(state) {
  __leaderAlertStateCache = state;
  return writeChunkedScriptProperty(LEADER_ALERT_STATE_PROP_KEY, JSON.stringify(state),
    LEADER_ALERT_STATE_CHUNK_CHARS, LEADER_ALERT_STATE_MAX_CHUNKS);
}

/** One roster line's identity within its program: the date it is for, and who. See THE DIFF. */
function leaderAlertEntryKey(dateKey, name) {
  return `${dateKey}|${normalizeNameKey(name)}`;
}

/** Program_Status as the one character the snapshot stores. */
function leaderAlertStatusCode(status) {
  const text = String(status === null || status === undefined ? '' : status).trim();
  return LEADER_ALERT_STATUS_CODES[text] || 'A';
}

/**
 * One roster line's stored value: status code, then party size.
 *
 * The party size is in here because "Jane is now bringing three" is a change a
 * leader sets out chairs for, and a diff that only watched arrivals and
 * statuses would call that no change at all.
 */
function leaderAlertEntryValue(statusCode, partySize) {
  const size = Number(partySize);
  return `${statusCode}${size > 1 ? size : ''}`;
}

function leaderAlertValueParts(value) {
  const text = String(value || '');
  const size = Number(text.substring(1));
  return { code: text.substring(0, 1) || 'A', partySize: size > 1 ? size : 1 };
}


// --- building the current picture --------------------------------------------

/**
 * { programKey: { dateKey|name: value } } for the programs named, over the
 * alert window.
 *
 * Built from the rows the sync already has in hand — the same two tables
 * section 9b's push reads — so this costs no extra read of anything.
 *
 * Superseded rows are left out, exactly as they are left off the shared sheet:
 * a registration a later submission replaced is bookkeeping, and reporting one
 * as an arrival and its replacement as another would double every correction.
 */
function buildLeaderAlertRosters(sessionRows, registrantRows, programKeys) {
  const wanted = {};
  (programKeys || []).forEach(key => { wanted[key] = true; });
  const rosters = {};
  Object.keys(wanted).forEach(key => { rosters[key] = {}; });
  if (Object.keys(wanted).length === 0) return rosters;

  const sessionMap = getIndexMap(HEADERS.Master_Program_Dashboard);
  const window = leaderAlertWindow();

  // Event_ID -> the program it belongs to, and the date it is on. By ID rather
  // than by the Event text on a registrant row, for the same reason the push
  // does it: a renamed program's older registrant rows still carry the old
  // title, and the session table is what knows the current one.
  const sessionByEventId = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessionMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessionMap['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = formatDateKey(date);
    if (dateKey < window.from || dateKey > window.to) return;
    const programKey = leaderProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]);
    if (!wanted[programKey]) return;
    sessionByEventId[eventId] = { programKey, dateKey };
  });

  const map = getIndexMap(HEADERS.Registrant_Dash);
  (registrantRows || []).forEach(row => {
    const session = sessionByEventId[String(row[map['Event_ID']] || '').trim()];
    if (!session) return;
    const status = String(row[map['Program_Status']] || '').trim();
    if (status === 'Superseded') return;
    const name = String(row[map['Name']] || '').trim();
    if (!name) return;
    rosters[session.programKey][leaderAlertEntryKey(session.dateKey, name)] =
      leaderAlertEntryValue(leaderAlertStatusCode(status), row[map['Party_Size']]);
  });

  return rosters;
}

/** The date range an alert is worth sending about. See LEADER_ALERT_FORWARD_DAYS. */
function leaderAlertWindow() {
  const today = parseDateKey(formatDateKey(new Date()));
  return {
    from: formatDateKey(new Date(today.getTime() - LEADER_ALERT_BACK_DAYS * 86400000)),
    to: formatDateKey(new Date(today.getTime() + LEADER_ALERT_FORWARD_DAYS * 86400000))
  };
}


// --- the diff ----------------------------------------------------------------

/**
 * What moved between two rosters, as a list of changes ready to be written into
 * an email.
 *
 * Each change is { kind, dateKey, name, from, to, partySize, wasPartySize }
 * where kind is 'joined' | 'left' | 'status' | 'party'.
 *
 * A vanished entry whose date is OUTSIDE the window is dropped rather than
 * reported: it aged out of the roster, it did not leave it. This is the
 * failure the snapshot's key shape exists to make checkable — see THE DIFF in
 * the section header.
 */
function diffLeaderAlertRosters(previous, current, window) {
  const changes = [];
  const before = previous || {};
  const after = current || {};

  Object.keys(after).forEach(entryKey => {
    const now = leaderAlertValueParts(after[entryKey]);
    const name = entryKey.substring(entryKey.indexOf('|') + 1);
    const dateKey = entryKey.substring(0, entryKey.indexOf('|'));

    if (before[entryKey] === undefined) {
      changes.push({ kind: 'joined', dateKey, name, to: now.code, partySize: now.partySize });
      return;
    }
    const was = leaderAlertValueParts(before[entryKey]);
    if (was.code !== now.code) {
      changes.push({ kind: 'status', dateKey, name, from: was.code, to: now.code, partySize: now.partySize });
    } else if (was.partySize !== now.partySize) {
      changes.push({ kind: 'party', dateKey, name, to: now.code, partySize: now.partySize, wasPartySize: was.partySize });
    }
  });

  Object.keys(before).forEach(entryKey => {
    if (after[entryKey] !== undefined) return;
    const dateKey = entryKey.substring(0, entryKey.indexOf('|'));
    // Aged out of the window, not gone from the roster.
    if (dateKey < window.from || dateKey > window.to) return;
    const was = leaderAlertValueParts(before[entryKey]);
    changes.push({
      kind: 'left', dateKey,
      name: entryKey.substring(entryKey.indexOf('|') + 1),
      from: was.code, partySize: was.partySize
    });
  });

  // By date, then by what happened, then by name: a leader reads this class by
  // class, and within a class the arrivals and the departures are two different
  // things to do something about.
  const order = { joined: 0, left: 1, status: 2, party: 3 };
  changes.sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey) ||
    (order[a.kind] - order[b.kind]) ||
    a.name.localeCompare(b.name));
  return changes;
}


// --- what the email says -----------------------------------------------------

/** One change, as the line a person reads. */
function describeLeaderAlertChange(change) {
  const party = change.partySize > 1 ? ` (party of ${change.partySize})` : '';
  const name = titleCaseLeaderAlertName(change.name);
  switch (change.kind) {
    case 'joined':
      return change.to === 'W'
        ? `+ ${name}${party} — signed up, on the waitlist`
        : `+ ${name}${party} — signed up`;
    case 'left':
      return `- ${name}${party} — no longer on the roster`;
    case 'status':
      return `~ ${name}${party} — ${LEADER_ALERT_STATUS_WORDS[change.from] || change.from} → ` +
        `${LEADER_ALERT_STATUS_WORDS[change.to] || change.to}`;
    case 'party':
      return `~ ${name} — party of ${change.wasPartySize} → party of ${change.partySize}`;
    default:
      return `~ ${name}`;
  }
}

/**
 * The snapshot key holds a NORMALIZED name (lowercased, spacing collapsed) so
 * that a retyped name still matches its old entry. That is the right key and
 * the wrong thing to put in an email addressed to somebody who knows these
 * people by name, so it is cased back up on the way out.
 *
 * Deliberately simple: this is a display nicety over a key, not a name
 * formatter. "o'brien" comes out "O'brien", which is a small wrongness in a
 * line that also carries the date and what happened — and every rule that
 * fixes it breaks a different name.
 */
function titleCaseLeaderAlertName(name) {
  return String(name || '')
    .split(' ')
    .map(part => (part ? part.charAt(0).toUpperCase() + part.substring(1) : part))
    .join(' ');
}

/**
 * The body of one leader's email: their programs, each session that moved, and
 * what moved on it.
 *
 * `programs` is [{ title, location, changes, url }, ...].
 */
function buildLeaderAlertBody(leader, programs) {
  const lines = [];
  lines.push(leader.name ? `Hello ${leader.name},` : 'Hello,');
  lines.push('');
  lines.push('Here is what has changed on your roster since the last time this ran.');
  lines.push('');

  programs.forEach(program => {
    lines.push(`${program.title} — ${program.location}`);
    lines.push('');

    let shown = 0;
    let lastDateKey = '';
    program.changes.forEach(change => {
      if (shown >= LEADER_ALERT_MAX_LINES_PER_PROGRAM) return;
      if (change.dateKey !== lastDateKey) {
        lastDateKey = change.dateKey;
        const date = parseDateKey(change.dateKey);
        lines.push(`  ${date ? formatDateLabel(date) : change.dateKey}`);
      }
      lines.push(`    ${describeLeaderAlertChange(change)}`);
      shown++;
    });
    if (program.changes.length > shown) {
      // The full picture is one click away and always right; an email that
      // pages through two hundred changes is neither.
      lines.push(`    …and ${program.changes.length - shown} more change(s).`);
    }

    lines.push('');
    if (program.url) {
      lines.push(`  Your sign-up sheet: ${program.url}`);
      lines.push('');
    }
  });

  lines.push('This is sent only when something actually changed, so a quiet week means a quiet inbox.');
  lines.push('To stop these, untick Notify_Roster_Changes on the Program_Leaders tab, or ask the office to.');
  return lines.join('\n');
}

/** The subject line: what moved, and where, without opening the mail. */
function buildLeaderAlertSubject(programs) {
  const total = programs.reduce((sum, p) => sum + p.changes.length, 0);
  const what = `${total} roster change${total === 1 ? '' : 's'}`;
  return programs.length === 1
    ? `${programs[0].title} (${programs[0].location}) — ${what}`
    : `${what} across ${programs.length} of your programs`;
}


// --- the pass itself ---------------------------------------------------------

/**
 * Mails every leader on the "At each registration" channel (see Notify_Timing,
 * 65_program_leaders.gs) whatever moved on their rosters, and records the new
 * baseline for the programs actually told about.
 *
 * A leader on the OTHER channel — "N days before each date" — is left alone
 * here entirely; sendProgramLeaderDaySnapshotDigests() below is their pass,
 * and a program on that channel never gets a snapshot started in
 * state.programs by this function, so switching a leader between the two
 * costs nothing more than the next sync noticing the change.
 *
 * Called at the end of syncRegistrationsInternal(), after the shared sheets
 * have been pushed, on a settled picture. Never throws: this is the last thing
 * a registration import does and it reaches outside the workbook, so a mail
 * problem must not be able to fail a run that imported every registration
 * correctly.
 *
 * Returns how many emails went out.
 */
function notifyProgramLeadersOfRosterChanges(sessionRows, registrantRows) {
  // Keep only the programs each leader wants the DIFF pass for — a leader
  // whose only program is on the day-count channel has nothing for this
  // function to do, and a leader with a foot in both channels is filtered
  // down to just the "each registration" half here.
  const leaders = getProgramLeadersWantingAlerts()
    .map(leader => Object.assign({}, leader,
      { programs: leader.programs.filter(p => !p.timing || p.timing.mode === 'each_change') }))
    .filter(leader => leader.programs.length > 0);
  if (leaders.length === 0) return 0;

  const state = readProgramLeaderNotifyState();
  const programKeys = [];
  leaders.forEach(leader => leader.programs.forEach(program => {
    if (programKeys.indexOf(program.key) === -1) programKeys.push(program.key);
  }));

  const rosters = buildLeaderAlertRosters(sessionRows, registrantRows, programKeys);
  const window = leaderAlertWindow();
  const registry = getProgramLeaderSheetRegistry();

  // Every program's diff, once — a program with two leaders is diffed once and
  // reported to both, and the snapshot it advances to is the same one either
  // way.
  const diffs = {};
  const baselined = [];
  programKeys.forEach(key => {
    const stored = state.programs[key];
    if (!stored || !stored.roster) {
      // FIRST SIGHT OF THIS PROGRAM. Record it and say nothing — see THE FIRST
      // RUN. Written immediately rather than with the sends below, because
      // there is no email whose success it should wait on.
      state.programs[key] = { at: (stored && stored.at) || '', roster: rosters[key] || {} };
      baselined.push(key);
      return;
    }
    diffs[key] = diffLeaderAlertRosters(stored.roster, rosters[key] || {}, window);
  });

  let sent = 0;
  // A program is re-baselined only once NOBODY is still owed its current
  // changes. Any leader who was skipped or whose mail bounced puts every
  // program they were owed in here, and those keep their old snapshot.
  const stillOwed = {};
  const told = {};
  const skipped = [];

  leaders.forEach(leader => {
    const programs = [];
    leader.programs.forEach(program => {
      const changes = diffs[program.key];
      if (!changes || changes.length === 0) return;
      // The registry's spelling wins where there IS a shared sheet — that is
      // the title the leader sees on the file the email links to, and the two
      // disagreeing would read as two different classes.
      const entry = registry[program.key] || {};
      programs.push({
        key: program.key,
        title: entry.title || program.title,
        location: entry.location || program.location,
        url: entry.fileId ? `https://docs.google.com/spreadsheets/d/${entry.fileId}/edit` : '',
        changes
      });
    });
    if (programs.length === 0) return;

    if (sent >= LEADER_ALERT_MAX_EMAILS_PER_RUN) {
      programs.forEach(program => { stillOwed[program.key] = true; });
      skipped.push(leader.email);
      return;
    }

    // The quota, the send itself and the refused-address rule are section
    // 9f's — this pass decides only WHO is written to, who in the office is
    // copied (Config's Leader_Roster_Alerts tick, and nobody by default), what
    // the message says, and how much of a scarce quota it may spend
    // (`reserve`).
    const outcome = sendRationedEmail({
      to: leader.email,
      subject: buildLeaderAlertSubject(programs),
      body: buildLeaderAlertBody(leader, programs),
      reserve: LEADER_ALERT_QUOTA_RESERVE,
      bcc: adminEmailsForCategory('leaderRosterAlerts')
    });

    if (outcome.status === 'sent') {
      sent++;
      programs.forEach(program => { told[program.key] = true; });
      log(`Roster alert sent to ${leader.email} — ${programs.length} program(s), ` +
        `${programs.reduce((sum, p) => sum + p.changes.length, 0)} change(s).`);
      return;
    }

    // Nothing went out, whatever the reason: the snapshot stays put, so these
    // changes are reported again next hour rather than lost.
    programs.forEach(program => { stillOwed[program.key] = true; });
    if (outcome.status === 'held') {
      skipped.push(leader.email);
      return;
    }
    log(`⚠️ Could not send the roster alert to ${leader.email} (${outcome.error}).`);
    if (outcome.status === 'failed') {
      // Told to the admin because an address that bounces off MailApp will keep
      // bouncing until somebody corrects the row. Only on the refusal itself:
      // a message suppressed because that address was already refused this run
      // has been reported once already, and twice is noise.
      noteForAdmin('Roster alerts that could not be sent',
        `${leader.email} could not be emailed (${outcome.error}). The changes are not lost — they will be ` +
        `reported again on the next sync. Check the address on the ${SHEET_NAMES.PROGRAM_LEADERS} tab.`);
    }
  });

  // A program whose two leaders both had changes, one of whom bounced, keeps
  // its old snapshot: the cost is one duplicate email to the leader who did
  // get it, and the alternative is the other one never hearing about this
  // hour's cancellations at all. Duplicates are cheap; silence is not.
  //
  // A program with changes that NOBODY is owed any more cannot happen — a
  // change only exists here because some leader asked to be told about it.
  const stamp = new Date().toISOString();
  Object.keys(told).forEach(key => {
    if (stillOwed[key]) return;
    state.programs[key] = { at: stamp, roster: rosters[key] || {} };
  });

  // A program whose diff came back EMPTY is re-baselined too, and has to be:
  // its roster is unchanged by definition, but writing it keeps the stored
  // snapshot in the current shape and stops a program that never changes from
  // looking stale for ever.
  Object.keys(diffs).forEach(key => {
    if (diffs[key].length > 0) return;
    const stored = state.programs[key] || {};
    state.programs[key] = { at: stored.at || '', roster: rosters[key] || {} };
  });

  // Programs nobody is watching any more would otherwise sit in the state for
  // ever, growing it by a roster apiece. Dropped here rather than on the read,
  // so a leader unticking the box for an afternoon and ticking it back gets a
  // clean baseline instead of a diff against a stale one.
  Object.keys(state.programs).forEach(key => {
    if (programKeys.indexOf(key) === -1) delete state.programs[key];
  });

  writeProgramLeaderNotifyState(state);

  if (baselined.length > 0) {
    log(`Roster alerts: recorded a first baseline for ${baselined.length} program(s) — nothing sent for those.`);
  }
  if (skipped.length > 0) {
    log(`⚠️ Roster alerts: ${skipped.length} leader(s) not emailed this run (per-run cap or daily mail quota).`);
    noteForAdmin('Roster alerts held back',
      `${skipped.length} leader(s) were not emailed this run because the per-run cap or the daily mail ` +
      `quota was reached: ${skipped.join(', ')}. Their changes were NOT discarded — they go out on the ` +
      `next sync.`);
  }
  return sent;
}


// ============================================================================
// 9d-ii. DAY-BEFORE ROSTER DIGESTS (telling a leader who is coming, ahead of the date)
// ============================================================================
//
// THE OTHER HALF OF Notify_Timing (see 65_program_leaders.gs). A leader whose
// row still reads "At each registration" gets the diff pass above, mid-hour,
// the moment something on the roster moves. A leader who picked "N days
// before each date" instead does not want to watch an inbox for changes —
// they want, once, a plain answer to "who is coming to Thursday's class" a
// few days ahead of it, so they can set out chairs and go. This is a
// SNAPSHOT, not a diff: it says who is on the roster that morning, not what
// changed to get there.
//
// ONE EMAIL PER LEADER PER RUN, covering every session of theirs that is due
// — but each session is judged against ITS OWN date and ITS OWN leader's day
// count, never merged across programs the way the diff pass merges CHANGES.
// "3 days before Tuesday's class" and "3 days before Thursday's class" are
// two different mornings; a leader who happens to have both due in the same
// hourly run gets one email naming both, not two.
//
// A LEDGER, THE SAME SHAPE OF IDEA AS THE REGISTRANT REMINDERS BESIDE IT
// (section 9e), but keyed by SESSION AND LEADER rather than by event and
// day-offset: there is only one countdown per leader-program row, so there is
// nothing to distinguish beyond "has this leader already had this session's
// digest". Once sent, an hourly re-run must not send it again just because
// today is still within the window — see pruneLeaderDigestLedger() for why
// it does not simply grow forever instead.
// ============================================================================

/** Where the digest ledger lives. Chunked: see writeChunkedScriptProperty(). */
const LEADER_DIGEST_LEDGER_PROP_KEY = 'PROGRAM_LEADER_DIGEST_SENT_V1';
const LEADER_DIGEST_LEDGER_CHUNK_CHARS = 8000;
const LEADER_DIGEST_LEDGER_MAX_CHUNKS = 40;

/** The most digest emails one run will send. Same reasoning as LEADER_ALERT_MAX_EMAILS_PER_RUN beside it. */
const LEADER_DIGEST_MAX_EMAILS_PER_RUN = 25;

/**
 * The floor this pass will not dig the day's mail quota below.
 *
 * BETWEEN THE TWO RESERVES EITHER SIDE OF IT, on purpose, because all three
 * passes spend from the same hundred-message allowance in ONE execution, in
 * this order: the diff alerts above (reserve 50), this pass (reserve 25),
 * then the registrant reminders in section 9e (reserve 10). Whatever this
 * pass cannot afford keeps its ledger entry unwritten and is sent on the next
 * sync, exactly like its neighbors either side.
 */
const LEADER_DIGEST_QUOTA_RESERVE = 25;

let __leaderDigestLedgerCache = null;
let __leaderDigestLedgerDirty = false;

/** { eventId: { emailLowercased: true } } — who has already had THIS session's digest. */
function getLeaderDigestLedger() {
  if (__leaderDigestLedgerCache) return __leaderDigestLedgerCache;
  const raw = readChunkedScriptProperty(LEADER_DIGEST_LEDGER_PROP_KEY);
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    // Unreadable is treated as EMPTY — a duplicate digest is a mild
    // annoyance, and the alternative direction is a leader never told at all.
    log(`⚠️ The program leader digest ledger could not be parsed (${err}) — starting fresh.`);
  }
  __leaderDigestLedgerCache = parsed && typeof parsed === 'object' ? parsed : {};
  return __leaderDigestLedgerCache;
}

function saveLeaderDigestLedger() {
  if (!__leaderDigestLedgerDirty || !__leaderDigestLedgerCache) return;
  writeChunkedScriptProperty(LEADER_DIGEST_LEDGER_PROP_KEY, JSON.stringify(__leaderDigestLedgerCache),
    LEADER_DIGEST_LEDGER_CHUNK_CHARS, LEADER_DIGEST_LEDGER_MAX_CHUNKS);
  __leaderDigestLedgerDirty = false;
}

/**
 * Drops ledger entries for sessions that have happened or that the calendar
 * no longer mentions — the same reasoning, and nearly the same code, as
 * pruneRegistrantReminderLedger() beside it. Without it the ledger grows by
 * one entry per session forever, against a Script Properties budget shared
 * with every other registry in this project.
 */
function pruneLeaderDigestLedger(liveEventDateKeys, todayKey) {
  const ledger = getLeaderDigestLedger();
  Object.keys(ledger).forEach(eventId => {
    const dateKey = liveEventDateKeys[eventId];
    if (dateKey && dateKey >= todayKey) return;
    delete ledger[eventId];
    __leaderDigestLedgerDirty = true;
  });
}

/** One session's roster, as the digest states it: name, party size, and whether it is the waitlist. */
function describeLeaderDigestPerson(person) {
  const party = person.partySize > 1 ? ` (party of ${person.partySize})` : '';
  return `${person.name}${party}${person.waitlisted ? ' — waitlisted' : ''}`;
}

/** The body of one leader's digest: each due session, and who is on it right now. */
function buildLeaderDigestBody(leader, sessions) {
  const lines = [];
  lines.push(leader.name ? `Hello ${leader.name},` : 'Hello,');
  lines.push('');
  lines.push(sessions.length === 1
    ? 'Here is who is on your roster ahead of your upcoming session.'
    : 'Here is who is on your roster ahead of your upcoming sessions.');
  lines.push('');

  sessions.forEach(session => {
    lines.push(`${session.title} — ${session.location} — ${formatDateLabel(session.date)}`);
    if (session.roster.length === 0) {
      lines.push('  Nobody is registered yet.');
    } else {
      let shown = 0;
      session.roster.forEach(person => {
        if (shown >= LEADER_ALERT_MAX_LINES_PER_PROGRAM) return;
        lines.push(`  ${describeLeaderDigestPerson(person)}`);
        shown++;
      });
      if (session.roster.length > shown) {
        lines.push(`  …and ${session.roster.length - shown} more.`);
      }
    }
    lines.push('');
    if (session.url) {
      lines.push(`  Your sign-up sheet: ${session.url}`);
      lines.push('');
    }
  });

  lines.push('This lists who is registered as of right now — later changes are not reported here.');
  lines.push('To change when or whether you hear from us, edit Notify_Timing and Notify_Roster_Changes ' +
    `on the ${SHEET_NAMES.PROGRAM_LEADERS} tab.`);
  return lines.join('\n');
}

/** "Chair Yoga (Narberth) — Thu, Mar 5 — 12 on the roster" / "3 upcoming sessions on your roster". */
function buildLeaderDigestSubject(sessions) {
  if (sessions.length === 1) {
    const session = sessions[0];
    const count = session.roster.length;
    return `${session.title} (${session.location}) — ${formatDateLabel(session.date)} — ` +
      `${count} ${count === 1 ? 'person' : 'people'} on the roster`;
  }
  return `${sessions.length} upcoming sessions on your roster`;
}

/**
 * Mails every leader on the "N days before each date" channel a snapshot of
 * who is on each of their due sessions, and records that they have had it.
 *
 * Called at the end of syncRegistrationsInternal(), after the diff pass above
 * — see LEADER_DIGEST_QUOTA_RESERVE for why the order matters — on the same
 * settled picture. Never throws, for the same reason its neighbors do not:
 * this reaches outside the workbook and must not be able to fail a run that
 * already imported every registration correctly.
 *
 * Returns how many emails went out.
 */
function sendProgramLeaderDaySnapshotDigests(sessionRows, registrantRows) {
  // Keep only the programs each leader wants a COUNTDOWN for. A leader on the
  // "each registration" channel — or with no notify tick at all — has nothing
  // for this function to do.
  const leaders = getProgramLeadersWantingAlerts()
    .map(leader => Object.assign({}, leader,
      { programs: leader.programs.filter(p => p.timing &&
        (p.timing.mode === 'days_before' || p.timing.mode === 'weekday')) }))
    .filter(leader => leader.programs.length > 0);

  const sessionMap = getIndexMap(HEADERS.Master_Program_Dashboard);
  const todayKey = formatDateKey(new Date());

  // Live dates for EVERY session, not just the ones somebody is watching —
  // pruning needs to know a ledgered session's date whether or not it is
  // still inside anybody's current window.
  const liveEventDateKeys = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessionMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessionMap['Event_Date']]);
    if (!eventId || !date) return;
    liveEventDateKeys[eventId] = formatDateKey(date);
  });

  if (leaders.length === 0) {
    pruneLeaderDigestLedger(liveEventDateKeys, todayKey);
    saveLeaderDigestLedger();
    return 0;
  }

  // The widest day count anybody asked for, per program — bounds the session
  // scan below to a handful of dates instead of the whole calendar, the same
  // way the reminder pass bounds itself with REMINDER_FORWARD_DAYS.
  const programMaxDays = {};
  leaders.forEach(leader => leader.programs.forEach(program => {
    programMaxDays[program.key] = Math.max(
      programMaxDays[program.key] || 0, leaderNotifyTimingMaxDays(program.timing));
  }));

  const sessionsByProgram = {};
  (sessionRows || []).forEach(row => {
    const eventId = String(row[sessionMap['Event_ID']] || '').trim();
    const date = coerceDate(row[sessionMap['Event_Date']]);
    if (!eventId || !date) return;
    const dateKey = liveEventDateKeys[eventId];
    if (dateKey < todayKey) return; // a session that already happened is never "before" any more
    const programKey = leaderProgramKey(row[sessionMap['Clean_Title']], row[sessionMap['Location']]);
    const maxDays = programMaxDays[programKey];
    if (maxDays === undefined) return;
    const daysAway = Math.round(
      (parseDateKey(dateKey).getTime() - parseDateKey(todayKey).getTime()) / 86400000);
    if (daysAway > maxDays) return; // outside even the longest countdown asked for on this program
    if (!sessionsByProgram[programKey]) sessionsByProgram[programKey] = [];
    sessionsByProgram[programKey].push({ eventId, date, dateKey, daysAway });
  });

  if (Object.keys(sessionsByProgram).length === 0) {
    pruneLeaderDigestLedger(liveEventDateKeys, todayKey);
    saveLeaderDigestLedger();
    return 0;
  }

  // Who is actually on each candidate session, read off the registrant rows
  // ONCE rather than once per session — the same shape of saving
  // buildLeaderAlertRosters() makes for the diff pass.
  const wantedEventIds = {};
  Object.keys(sessionsByProgram).forEach(key =>
    sessionsByProgram[key].forEach(s => { wantedEventIds[s.eventId] = true; }));

  const regMap = getIndexMap(HEADERS.Registrant_Dash);
  const rosterByEvent = {};
  (registrantRows || []).forEach(row => {
    const eventId = String(row[regMap['Event_ID']] || '').trim();
    if (!wantedEventIds[eventId]) return;
    const status = String(row[regMap['Program_Status']] || '').trim();
    // A snapshot of who is COMING, not who used to be on the list — the same
    // exclusion buildLeaderSheetRowsByProgram() applies to the shared sheet.
    if (status === 'Superseded' || status === 'Cancelled') return;
    const name = String(row[regMap['Name']] || '').trim();
    if (!name) return;
    if (!rosterByEvent[eventId]) rosterByEvent[eventId] = [];
    rosterByEvent[eventId].push({
      name, partySize: Number(row[regMap['Party_Size']]) || 1, waitlisted: status === 'Waitlisted'
    });
  });
  Object.keys(rosterByEvent).forEach(eventId => rosterByEvent[eventId].sort(
    (a, b) => normalizeNameKey(a.name).localeCompare(normalizeNameKey(b.name))));

  const ledger = getLeaderDigestLedger();
  const registry = getProgramLeaderSheetRegistry();

  let sent = 0;
  const skipped = [];

  leaders.forEach(leader => {
    const sessions = [];
    leader.programs.forEach(program => {
      (sessionsByProgram[program.key] || []).forEach(s => {
        // This LEADER's own countdown, not the widest one asked for on the
        // program — a program with two leaders on "7 days before" and
        // "2 days before" tells each of them on their own morning.
        // A weekday row works its count out from THIS session's own date, so
        // the same "Thursday before" answer is 5 days ahead of a Tuesday class
        // and 7 ahead of a Thursday one. See leaderNotifyTimingDaysBefore().
        const dueDays = leaderNotifyTimingDaysBefore(program.timing, s.date);
        if (dueDays <= 0 || s.daysAway > dueDays) return;
        const sentFor = ledger[s.eventId] || {};
        if (sentFor[leader.email.toLowerCase()]) return;
        const entry = registry[program.key] || {};
        sessions.push({
          eventId: s.eventId, date: s.date, dateKey: s.dateKey,
          title: entry.title || program.title, location: entry.location || program.location,
          url: entry.fileId ? `https://docs.google.com/spreadsheets/d/${entry.fileId}/edit` : '',
          roster: rosterByEvent[s.eventId] || []
        });
      });
    });
    if (sessions.length === 0) return;
    sessions.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

    if (sent >= LEADER_DIGEST_MAX_EMAILS_PER_RUN) {
      skipped.push(leader.email);
      return;
    }

    // The quota, the archive BCC, the send itself and the refused-address
    // rule are section 9f's — this pass decides only who is due, what the
    // message says, and how much of a scarce quota it may spend (`reserve`).
    const outcome = sendRationedEmail({
      to: leader.email,
      subject: buildLeaderDigestSubject(sessions),
      body: buildLeaderDigestBody(leader, sessions),
      reserve: LEADER_DIGEST_QUOTA_RESERVE
    });

    if (outcome.status === 'sent') {
      sent++;
      sessions.forEach(s => {
        if (!ledger[s.eventId]) ledger[s.eventId] = {};
        ledger[s.eventId][leader.email.toLowerCase()] = true;
        __leaderDigestLedgerDirty = true;
      });
      log(`Roster digest sent to ${leader.email} — ${sessions.length} upcoming session(s).`);
      return;
    }

    // NOT recorded, whatever the reason: the next sync tries again rather
    // than the leader simply never hearing about this session.
    if (outcome.status === 'held') {
      skipped.push(leader.email);
      return;
    }
    log(`⚠️ Could not send the roster digest to ${leader.email} (${outcome.error}).`);
    if (outcome.status === 'failed') {
      noteForAdmin('Roster digests that could not be sent',
        `${leader.email} could not be emailed (${outcome.error}). The digest is not lost — it will be ` +
        `tried again on the next sync. Check the address on the ${SHEET_NAMES.PROGRAM_LEADERS} tab.`);
    }
  });

  pruneLeaderDigestLedger(liveEventDateKeys, todayKey);
  saveLeaderDigestLedger();

  if (skipped.length > 0) {
    log(`⚠️ Roster digests: ${skipped.length} leader(s) not emailed this run (per-run cap or daily mail quota).`);
    noteForAdmin('Roster digests held back',
      `${skipped.length} leader(s) were not sent their roster digest this run because the per-run cap or ` +
      `the daily mail quota was reached: ${skipped.join(', ')}. Not discarded — they go out on the next sync.`);
  }
  return sent;
}


// --- the menu ----------------------------------------------------------------

/**
 * MENU ENTRY: run the alert pass now rather than waiting for the next sync.
 *
 * Reads the two tables fresh, because whoever pressed this did so having just
 * changed something and expects it counted. The alert pass itself is the same
 * one the sync runs — there is no second implementation to drift.
 */
function sendProgramLeaderRosterAlertsNow() {
  const leaders = getProgramLeadersWantingAlerts();
  if (leaders.length === 0) {
    toastIfPossible(`Nobody has asked for roster alerts — tick Notify_Roster_Changes on ` +
      `${SHEET_NAMES.PROGRAM_LEADERS}.`);
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registrantRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.Registrant_Dash, 'Event_ID');

  let sent = 0;
  try {
    sent = notifyProgramLeadersOfRosterChanges(sessionRows, registrantRows);
  } catch (err) {
    log(`⚠️ Could not send the roster alerts (${err}).`);
    toastIfPossible(`Could not send the roster alerts ⚠️ — ${err}`);
    return;
  }
  flushAdminDigest('Roster alerts');

  toastIfPossible(sent > 0
    ? `Roster alerts sent ✅ — ${sent} email(s).`
    : 'Nothing has changed since the last check — no alerts sent.');
}

/**
 * MENU ENTRY: run the day-before digest pass now rather than waiting for the
 * next sync — the countdown-channel twin of sendProgramLeaderRosterAlertsNow()
 * above. Same reasoning throughout: read both tables fresh, and run the exact
 * pass the hourly sync runs so there is no second implementation to drift.
 */
function sendProgramLeaderDayDigestsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sessionRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD), HEADERS.Master_Program_Dashboard, 'Event_ID');
  const registrantRows = getSectionedRows(
    getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH), HEADERS.Registrant_Dash, 'Event_ID');

  let sent = 0;
  try {
    sent = sendProgramLeaderDaySnapshotDigests(sessionRows, registrantRows);
  } catch (err) {
    log(`⚠️ Could not send the roster digests (${err}).`);
    toastIfPossible(`Could not send the roster digests ⚠️ — ${err}`);
    return;
  }
  flushAdminDigest('Roster digests');

  toastIfPossible(sent > 0
    ? `Roster digests sent ✅ — ${sent} email(s).`
    : `Nobody is due a digest right now — set Notify_Timing to a day count on ${SHEET_NAMES.PROGRAM_LEADERS}.`);
}
