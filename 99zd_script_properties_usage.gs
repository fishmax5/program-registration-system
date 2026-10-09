// ============================================================================
// 99zd. WHAT IS FILLING SCRIPT PROPERTIES?
// ============================================================================
//
// Script Properties is ONE store of about 500KB that this whole project
// shares: the sync clock, the form registry, the tombstones, the fingerprints,
// the retry queue, the office digest's spool and forty-odd others. When it is
// full nothing fails HERE — it fails in whichever writer happens to run next,
// as "Exceeded maximum stored value size" or a quota error on a property that
// is itself four bytes long, and the error names the victim, not the cause.
//
// So this is the one read-only question: which stores are holding the space.
// `summarizeScriptProperties()` is pure — keys grouped into the STORE they
// belong to (a chunked store's `…::2026-10-05::3` and `…_4` keys fold onto one
// line), each group's size in characters of key plus value, largest first,
// plus the single largest keys — and `reportScriptPropertiesUsage()` is the
// menu item that reads the store once (`getProperties()`, one call) and
// shows it. It changes nothing: the fix for a store that has grown is that
// store's own cap, and the first one found was the office digest's spool
// (`88`'s OFFICE_DIGEST_MAX_SPOOL_CHARS), which kept every unsent day while
// the digest had nowhere to go.
//
// ------------------------------------------------------ WHY IT IS NUMBERED 99zd
//
// After `99zc` (the sign-in app's menu took that prefix on main first) for
// the usual reason — never renumber. Behavior only; its two
// constants stand alone, and everything it reaches for (`log`,
// `toastIfPossible`) is a hoisted function.
// ============================================================================

/** Apps Script's total for one property store, in characters. */
const SCRIPT_PROPERTIES_QUOTA_CHARS = 500 * 1024;

/**
 * What a few stores ARE, for the report — the ones that grow with the
 * workbook. A store not listed here is still measured; it is only unnamed.
 */
const SCRIPT_PROPERTY_STORE_NOTES = {
  OFFICE_DIGEST_SPOOL_V1: 'the office’s 10am digest, waiting to be sent (88) — large means it is not going out',
  DELETED_REGISTRANTS_V1: 'tombstones: why a deleted registration stays deleted (28)',
  FORM_LABEL_FINGERPRINTS_V1: 'date-label fingerprints per form (10)',
  FORM_DESCRIPTION_STATE_V1: 'form description fingerprints (99t)',
  FORM_REGISTRY_MAP_V1: 'group → form registry (06)',
  ALL_DATES_REGISTRANTS_V1: 'every-date registrants (06)',
  OPTIMISTIC_RETRY_QUEUE_V1: 'desk writes waiting to be retried (99b)',
  CALENDAR_INVITES_V1: 'calendar invitations already sent (33)',
  REGISTRANT_REMINDERS_V1: 'reminders already sent (70)',
  PROGRAM_LEADER_ROSTER_STATE_V2: 'leader roster snapshots (66)',
  INSTRUCTOR_SHEET_REGISTRY_V1: 'program registrant sheet registry (46)',
  MENU_USAGE_V1: 'menu click counts (99r)'
};

/**
 * The store a key belongs to: everything before the first `::`, then any
 * trailing `_<n>` chunk number taken off — the two ways a chunked store here
 * names its pieces.
 */
function scriptPropertyGroupOf_(key) {
  let group = String(key || '').split('::')[0];
  while (/_\d+$/.test(group) && !/_V\d+$/.test(group)) group = group.replace(/_\d+$/, '');
  return group || String(key || '');
}

/**
 * Pure. `all` is { key: value }. Returns { total, count, quota, groups, largest }
 * with groups and largest sorted biggest first.
 */
function summarizeScriptProperties(all) {
  const byGroup = {};
  const sizes = [];
  let total = 0;
  Object.keys(all || {}).forEach(key => {
    const size = key.length + String(all[key] === null || all[key] === undefined ? '' : all[key]).length;
    total += size;
    sizes.push({ key, chars: size });
    const group = scriptPropertyGroupOf_(key);
    if (!byGroup[group]) byGroup[group] = { group, keys: 0, chars: 0 };
    byGroup[group].keys++;
    byGroup[group].chars += size;
  });
  const groups = Object.keys(byGroup).map(g => byGroup[g]).sort((a, b) => b.chars - a.chars);
  sizes.sort((a, b) => b.chars - a.chars);
  return { total, count: sizes.length, quota: SCRIPT_PROPERTIES_QUOTA_CHARS, groups, largest: sizes.slice(0, 5) };
}

function formatPropertyChars_(chars) {
  return chars >= 1024 ? `${(chars / 1024).toFixed(1)}KB` : `${chars} chars`;
}

/** The report's words, from a summary. */
function describeScriptPropertiesUsage(summary) {
  const pct = Math.round((summary.total / summary.quota) * 100);
  const lines = [
    `Script Properties holds ${formatPropertyChars_(summary.total)} of about ` +
    `${formatPropertyChars_(summary.quota)} (${pct}%), in ${summary.count} key(s).`,
    ''
  ];
  if (summary.count === 0) return lines.concat(['Nothing is stored.']).join('\n');
  lines.push('Largest stores:');
  summary.groups.slice(0, 15).forEach(g => {
    const share = Math.round((g.chars / Math.max(1, summary.total)) * 100);
    const note = SCRIPT_PROPERTY_STORE_NOTES[g.group];
    lines.push(`  ${formatPropertyChars_(g.chars)} (${share}%) — ${g.group}` +
      (g.keys > 1 ? ` [${g.keys} keys]` : '') + (note ? ` — ${note}` : ''));
  });
  if (summary.groups.length > 15) lines.push(`  …and ${summary.groups.length - 15} smaller store(s).`);
  lines.push('', 'Largest single keys:');
  summary.largest.forEach(k => lines.push(`  ${formatPropertyChars_(k.chars)} — ${k.key}`));
  const digest = summary.groups.filter(g => g.group === 'OFFICE_DIGEST_SPOOL_V1')[0];
  if (digest && digest.chars > 60000) {
    lines.push('', 'The office digest spool is large, which means the 10am digest is not being sent. ' +
      'Check Config’s Admin Notification Emails table, then Settings ▸ Send the Office Digest Now. ' +
      'It is capped and drops its oldest unsent days on its own.');
  }
  return lines.join('\n');
}

/** MENU ACTION (Admin ▸ Reports). Read-only, ungated. */
function reportScriptPropertiesUsage() {
  let text;
  try {
    text = describeScriptPropertiesUsage(
      summarizeScriptProperties(PropertiesService.getScriptProperties().getProperties()));
  } catch (err) {
    text = `Script Properties could not be read (${err}).`;
  }
  log(`reportScriptPropertiesUsage:\n${text}`);
  presentReport_('What is filling Script Properties?', text,
    'See the log — the Script Properties report is written there.');
  return text;
}
