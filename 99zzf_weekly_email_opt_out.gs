// ============================================================================
// 99zzf. OPTING OUT OF THE WEEKLY REGISTRANT EMAIL
// ============================================================================
//
// The weekly email (`70`) goes to everybody with a program in the coming week,
// and until now there was no way to take one person off it. This is that way:
//
//   * a footer link in every weekly / "added to your week" email, which opens
//     a small page (`?mode=unsubscribe`) where the person confirms;
//   * a staff-owned tab, `Weekly_Email_Opt_Outs`, one row per ADDRESS. Staff
//     add a row when somebody replies "please stop" (replies reach the office,
//     `MAIL_REPLY_TO`) and delete a row to put somebody back.
//
// WHAT IT COVERS: the weekly email and its "added to your week" notes, and
// nothing else. Calendar invitations, an Assistance appointment's day-before
// alert and the leaders' mail are about a booking, not a newsletter, and are
// untouched.
//
// KEYED ON THE ADDRESS, not the name: the email is what is sent to, a couple
// shares one, and `Member_Roll` merges and retirements must not un-opt-out
// anybody.
//
// THE LINK CARRIES A TOKEN, an HMAC of the lower-cased address under a secret
// kept in Script Properties, so the page can only be used for an address whose
// owner was actually sent the link. THE LINK DOES NOT OPT ANYBODY OUT BY BEING
// OPENED: mail scanners and link previewers fetch every URL in a message, and a
// GET that unsubscribed would take the whole list off at once. The page is
// served first and its button makes the write (`google.script.run`, which a
// scanner does not run).
//
// Numbered after `99zze` for the usual reason — never renumber. Behavior plus
// self-contained constants; its schema (`SHEET_NAMES.WEEKLY_EMAIL_OPT_OUTS`,
// `HEADERS.Weekly_Email_Opt_Outs`) lives in `03`, and everything it reaches for
// it reads at CALL time. `70` and `60` reach it through hoisted declarations.
// ============================================================================

const WEEKLY_OPT_OUT_SECRET_PROP_KEY = 'WEEKLY_EMAIL_OPT_OUT_SECRET_V1';
const WEEKLY_OPT_OUT_MODES = ['unsubscribe', 'opt-out', 'optout'];

/** Memo for one execution; dropped by every writer here. */
let __weeklyOptOutSetCache = null;

function normalizeOptOutEmail_(email) {
  return String(email || '').trim().toLowerCase();
}

// --- the token ------------------------------------------------------------

function weeklyOptOutSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty(WEEKLY_OPT_OUT_SECRET_PROP_KEY);
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(WEEKLY_OPT_OUT_SECRET_PROP_KEY, secret);
  }
  return secret;
}

/** Hex HMAC-SHA256 of the lower-cased address, or '' if it cannot be computed. */
function weeklyOptOutToken_(email) {
  const key = normalizeOptOutEmail_(email);
  if (!key) return '';
  try {
    const bytes = Utilities.computeHmacSha256Signature(key, weeklyOptOutSecret_());
    return bytes.map(b => ((b < 0 ? b + 256 : b)).toString(16).padStart(2, '0')).join('').slice(0, 40);
  } catch (err) {
    return '';
  }
}

function weeklyOptOutTokenValid_(email, token) {
  const expected = weeklyOptOutToken_(email);
  const given = String(token || '').trim().toLowerCase();
  if (!expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** The address's own opt-out link, or '' when the web app has no address yet. */
function weeklyOptOutUrl(email) {
  const token = weeklyOptOutToken_(email);
  if (!token) return '';
  try {
    return checkInPageUrl({ mode: 'unsubscribe', params: { e: normalizeOptOutEmail_(email), t: token } });
  } catch (err) {
    return '';
  }
}

/** The footer both weekly emails end with. Always says how, link or not. */
function weeklyOptOutFooterLines(email) {
  const url = weeklyOptOutUrl(email);
  const lines = [''];
  if (url) {
    lines.push('Do not want these weekly emails? Stop them here:');
    lines.push(url);
    lines.push('(Or just reply to this message and we will take you off.)');
  } else {
    lines.push('Do not want these weekly emails? Reply to this message and we will take you off.');
  }
  return lines;
}

// --- the tab --------------------------------------------------------------

function weeklyOptOutSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = create
    ? getOrCreateSheet(ss, SHEET_NAMES.WEEKLY_EMAIL_OPT_OUTS)
    : ss.getSheetByName(SHEET_NAMES.WEEKLY_EMAIL_OPT_OUTS);
  if (!sheet) return null;
  const headers = HEADERS.Weekly_Email_Opt_Outs;
  if (create && sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    try { sheet.setFrozenRows(1); sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold'); } catch (err) { /* cosmetic */ }
  }
  return sheet;
}

/** Rows as [{ row, email }], row being the 1-based sheet row. Never throws. */
function readWeeklyOptOutRows_() {
  try {
    const sheet = weeklyOptOutSheet_(false);
    if (!sheet) return [];
    const last = sheet.getLastRow();
    if (last < 2) return [];
    const values = sheet.getRange(2, 1, last - 1, 1).getValues();
    const out = [];
    values.forEach((row, i) => {
      const email = normalizeOptOutEmail_(row[0]);
      if (email) out.push({ row: i + 2, email });
    });
    return out;
  } catch (err) {
    log(`⚠️ Could not read "${SHEET_NAMES.WEEKLY_EMAIL_OPT_OUTS}" (${err}) — treating it as empty.`);
    return [];
  }
}

/** { 'a@b.com': true } for every opted-out address. One read per execution. */
function weeklyEmailOptOutSet() {
  if (__weeklyOptOutSetCache) return __weeklyOptOutSetCache;
  const set = {};
  readWeeklyOptOutRows_().forEach(entry => { set[entry.email] = true; });
  __weeklyOptOutSetCache = set;
  return set;
}

function isWeeklyEmailOptedOut(email) {
  return !!weeklyEmailOptOutSet()[normalizeOptOutEmail_(email)];
}

/** Opt an address out (idempotent). Returns true when a row was added. */
function recordWeeklyEmailOptOut(email, source) {
  const key = normalizeOptOutEmail_(email);
  if (!key || !isPlausibleEmail(key)) return false;
  __weeklyOptOutSetCache = null;
  if (weeklyEmailOptOutSet()[key]) return false;
  const sheet = weeklyOptOutSheet_(true);
  sheet.appendRow([key, formatDateKey(new Date()), source || 'staff', '']);
  __weeklyOptOutSetCache = null;
  return true;
}

/** Put an address back (idempotent). Returns true when a row was removed. */
function clearWeeklyEmailOptOut(email) {
  const key = normalizeOptOutEmail_(email);
  if (!key) return false;
  __weeklyOptOutSetCache = null;
  const rows = readWeeklyOptOutRows_().filter(entry => entry.email === key);
  if (rows.length === 0) return false;
  const sheet = weeklyOptOutSheet_(false);
  // Bottom-up so the row numbers still read are still right.
  rows.map(entry => entry.row).sort((a, b) => b - a).forEach(row => sheet.deleteRow(row));
  __weeklyOptOutSetCache = null;
  return true;
}

// --- the page -------------------------------------------------------------

/** What the page is drawn from — and the whole of what leaves the workbook. */
function weeklyOptOutPageContext(params) {
  const email = normalizeOptOutEmail_(params && params.e);
  const token = String((params && params.t) || '').trim();
  const valid = !!email && weeklyOptOutTokenValid_(email, token);
  return {
    valid: valid,
    email: valid ? email : '',
    token: valid ? token : '',
    optedOut: valid ? isWeeklyEmailOptedOut(email) : false,
    centerName: typeof CENTER_NAME === 'string' ? CENTER_NAME : '',
    contact: [typeof CENTER_PHONE === 'string' ? CENTER_PHONE : '',
      typeof CENTER_EMAIL === 'string' ? CENTER_EMAIL : ''].filter(Boolean).join(' · ')
  };
}

/**
 * The page's one call. `optOut` true stops the email, false starts it again.
 * Returns { ok, optedOut, message }; never throws.
 */
function weeklyOptOutSet(email, token, optOut) {
  try {
    if (!weeklyOptOutTokenValid_(email, token)) {
      return { ok: false, optedOut: false, message: 'This link is not valid. Please reply to the email and we will take you off.' };
    }
    if (optOut) {
      const added = recordWeeklyEmailOptOut(email, 'link');
      if (added) spoolOfficeNote('Registrant emails', `${normalizeOptOutEmail_(email)} opted out of the weekly email.`);
      return { ok: true, optedOut: true, message: 'You are unsubscribed. You will not get the weekly email any more.' };
    }
    const removed = clearWeeklyEmailOptOut(email);
    if (removed) spoolOfficeNote('Registrant emails', `${normalizeOptOutEmail_(email)} turned the weekly email back on.`);
    return { ok: true, optedOut: false, message: 'Welcome back. You will get the weekly email again.' };
  } catch (err) {
    log(`⚠️ Weekly email opt-out failed (${err}).`);
    return { ok: false, optedOut: false, message: 'Something went wrong. Please reply to the email and we will take you off.' };
  }
}

function buildWeeklyOptOutHtml(context) {
  const payload = JSON.stringify(JSON.stringify(context || {})).replace(/</g, '\\u003c');
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
         color: #202124; background: #f1f3f4; margin: 0; padding: 16px; font-size: 18px; }
  main { max-width: 520px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 24px;
         box-shadow: 0 1px 3px rgba(60,64,67,.3); }
  h1 { font-size: 22px; margin: 0 0 12px 0; }
  p { line-height: 1.5; margin: 0 0 14px 0; }
  .who { color: #5f6368; word-break: break-all; }
  button { width: 100%; background: #1a73e8; color: #fff; border: 0; border-radius: 8px;
           padding: 16px; font-size: 18px; font-weight: 600; cursor: pointer; }
  button.quiet { background: #fff; color: #1a73e8; border: 1px solid #dadce0; }
  button[disabled] { background: #9aa0a6; color: #fff; cursor: default; }
</style>
</head>
<body>
<main id="m"></main>
<script>
  const CTX = JSON.parse(${payload});
  const m = document.getElementById('m');
  function el(tag, text, cls) {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function draw(optedOut, message) {
    m.textContent = '';
    if (!CTX.valid) {
      m.appendChild(el('h1', 'This link is not valid'));
      m.appendChild(el('p', 'Please reply to the weekly email and we will take you off the list.'
        + (CTX.contact ? ' You can also reach us at ' + CTX.contact + '.' : '')));
      return;
    }
    m.appendChild(el('h1', optedOut ? 'You are unsubscribed' : 'Stop the weekly email?'));
    m.appendChild(el('p', CTX.email, 'who'));
    if (message) m.appendChild(el('p', message));
    else m.appendChild(el('p', optedOut
      ? 'You will not get the weekly email any more.'
      : 'This stops the weekly email listing your programs. Reminders for a booking you made, such as an appointment, are not affected.'));
    const b = el('button', optedOut ? 'Turn the weekly email back on' : 'Stop the weekly email', optedOut ? 'quiet' : '');
    b.onclick = function () {
      b.disabled = true;
      b.textContent = 'One moment…';
      google.script.run
        .withSuccessHandler(function (r) { draw(!!r.optedOut, r.message); })
        .withFailureHandler(function () { b.disabled = false; draw(optedOut, 'Something went wrong. Please try again, or reply to the email.'); })
        .weeklyOptOutSet(CTX.email, CTX.token, !optedOut);
    };
    m.appendChild(b);
  }
  draw(!!CTX.optedOut, '');
</script>
</body>
</html>`;
}
