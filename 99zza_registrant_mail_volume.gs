// ============================================================================
// 99zza. HOW MUCH MAIL DOES ONE PERSON GET?  (read-only audit, Nov 2026)
// ============================================================================
//
// The office was told members are deleting mail unread: too many messages, at
// bad hours, each naming a single program. The Sunday announcement (Givebutter)
// is outside this workbook; THIS report answers the half that is inside it —
// for the coming week, how many messages would each address on All_Registrants
// get from the workbook's own reminders, calendar invites and booking
// confirmations, under the policies currently ticked on Program_Settings.
//
// It sends and writes nothing, takes no lock, and counts through the same
// notificationPolicyForSession() the reminder pass (70) and invitation pass
// (33) read, so it cannot drift from what they would do. Only ACTIVE rows with
// a plausible address are counted, as in 70.
//
// What is counted:
//   - REMINDERS: for each policy day d, a session on date S sends on S-d; it is
//     counted when that send date falls inside the window.
//   - INVITES: one Google calendar-invite email per session the person is on
//     (when Add_Guest_To_Calendar is ticked) for sessions inside the window.
//   - CONFIRMATIONS: one per session in the window when Confirm_On_Booking is
//     ticked (an upper bound: it is sent when they book, not on the session day).
//
// Numbered last, behavior only; everything it reaches for is read at CALL time.
// ============================================================================

const MAIL_VOLUME_WINDOW_DAYS = 7;
const MAIL_VOLUME_TOP_ADDRESSES = 10;

/**
 * Pure. `sessions`: [{eventId, dateKey, title, location, isAssistance}] and
 * `registrants`: [{eventId, email, status}]; `policyFor(session)` → policy.
 * Returns { addresses, perAddress, byProgram, histogram }.
 */
function analyzeRegistrantMailVolume_(sessions, registrants, policyFor, todayKey, windowDays) {
  const dayMs = 86400000;
  const today = parseDateKey(todayKey).getTime();
  const windowEnd = today + (windowDays - 1) * dayMs;
  const bySession = {};
  sessions.forEach(s => {
    if (!s.eventId || !s.dateKey) return;
    const policy = policyFor(s);
    const sessionTime = parseDateKey(s.dateKey).getTime();
    let reminders = 0;
    if (policy.remind) {
      (policy.days || []).forEach(d => {
        const sendAt = sessionTime - d * dayMs;
        if (sendAt >= today && sendAt <= windowEnd) reminders++;
      });
    }
    const inWindow = sessionTime >= today && sessionTime <= windowEnd;
    const invite = inWindow && policy.invite ? 1 : 0;
    const confirm = inWindow && policy.confirmTime ? 1 : 0;
    if (reminders + invite + confirm === 0) return;
    bySession[s.eventId] = { session: s, reminders, invite, confirm };
  });

  const perAddress = {};
  const byProgram = {};
  registrants.forEach(r => {
    if (String(r.status || '').trim() !== 'Active') return;
    const item = bySession[r.eventId];
    const email = String(r.email || '').trim().toLowerCase();
    if (!item || !isPlausibleEmail(email)) return;
    const total = item.reminders + item.invite + item.confirm;
    perAddress[email] = (perAddress[email] || 0) + total;
    const key = `${item.session.title} — ${item.session.location}`;
    if (!byProgram[key]) byProgram[key] = { messages: 0, people: {}, assistance: !!item.session.isAssistance };
    byProgram[key].messages += total;
    byProgram[key].people[email] = true;
  });

  const histogram = {};
  Object.keys(perAddress).forEach(e => {
    const n = perAddress[e];
    histogram[n] = (histogram[n] || 0) + 1;
  });
  return { addresses: Object.keys(perAddress).length, perAddress, byProgram, histogram };
}

/** Pure. The words. */
function describeRegistrantMailVolume_(a, windowDays) {
  const lines = [`Registrant mail the workbook would send in the next ${windowDays} days, per address ` +
    `(reminders + calendar invites + booking confirmations; the Givebutter Sunday announcement is not counted):`, ''];
  if (a.addresses === 0) {
    lines.push('No registrant address is due any workbook mail in this window. Nothing to consolidate.');
    return lines.join('\n');
  }
  const counts = Object.keys(a.histogram).map(Number).sort((x, y) => x - y);
  const total = Object.keys(a.perAddress).reduce((sum, e) => sum + a.perAddress[e], 0);
  lines.push(`${a.addresses} address(es) would get ${total} message(s) — ` +
    `${(total / a.addresses).toFixed(1)} each on average, most for one person: ${counts[counts.length - 1]}.`, '');
  lines.push('Messages per address:');
  counts.forEach(n => lines.push(`  ${n} message(s): ${a.histogram[n]} address(es)`));
  lines.push('', 'Busiest addresses:');
  Object.keys(a.perAddress).sort((x, y) => a.perAddress[y] - a.perAddress[x] || x.localeCompare(y))
    .slice(0, MAIL_VOLUME_TOP_ADDRESSES).forEach(e => lines.push(`  ${a.perAddress[e]}  ${e}`));
  lines.push('', 'By program (messages, people) — anything that is not a personal assistance program is ' +
    'meant to send nothing:');
  Object.keys(a.byProgram).sort((x, y) => a.byProgram[y].messages - a.byProgram[x].messages)
    .forEach(k => {
      const p = a.byProgram[k];
      lines.push(`  ${p.messages}  ${k} (${Object.keys(p.people).length} people)${p.assistance ? '' : '  ← not assistance'}`);
    });
  return lines.join('\n');
}

/** Reads the two tabs and runs the analysis. Read-only; never throws past its caller's try. */
function analyzeRegistrantMailVolume(windowDays) {
  const days = windowDays || MAIL_VOLUME_WINDOW_DAYS;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sMap = getIndexMap(HEADERS.All_Program_Sessions);
  const rMap = getIndexMap(HEADERS.All_Registrants);
  const sRows = getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.PROGRAM_DASHBOARD),
    HEADERS.All_Program_Sessions, 'Event_ID');
  const rRows = getSectionedRows(getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH),
    HEADERS.All_Registrants, 'Event_ID');
  const sessions = [];
  sRows.forEach(row => {
    const date = coerceDate(row[sMap['Event_Date']]);
    if (!date) return;
    sessions.push({
      eventId: String(row[sMap['Event_ID']] || '').trim(),
      dateKey: formatDateKey(date),
      title: String(row[sMap['Clean_Title']] || '').trim(),
      location: String(row[sMap['Location']] || '').trim(),
      isAssistance: isAssistanceColumnValue(row[sMap['Personalized_Assistance']])
    });
  });
  const registrants = rRows.map(row => ({
    eventId: String(row[rMap['Event_ID']] || '').trim(),
    email: row[rMap['Email']],
    status: row[rMap['Program_Status']]
  }));
  const analysis = analyzeRegistrantMailVolume_(sessions, registrants, notificationPolicyForSession,
    formatDateKey(new Date()), days);
  analysis.days = days;
  return analysis;
}

/** The Health-panel check. Read-only, ungated. */
function reportRegistrantMailVolume() {
  const analysis = analyzeRegistrantMailVolume();
  const text = describeRegistrantMailVolume_(analysis, analysis.days);
  log(text);
  presentReport_('Registrant Mail Volume', text, `${analysis.addresses} address(es) due workbook mail this week.`);
  return analysis;
}
