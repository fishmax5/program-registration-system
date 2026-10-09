// ============================================================================
// 99zm. THE HEALTH PANEL  (every read-only check, one sidebar, run on demand)
// ============================================================================
//
// Numbered `99zm` for the usual reason — never renumber, and this landed last.
// Safe there: behavior plus one table whose entries reach every report through
// a closure (`run: () => reportX()`), which names the report at CALL time, so
// nothing here is read from another file at load. `HEALTH_CHECKS` is an
// ordinary `const` for that reason and needs no `defineLazyGlobal_`.
//
// WHY. Fifteen read-only reports sat under 🔧 Admin ▸ 📄 Reports, plus Trigger
// Status under Triggers and "Why did nothing happen?" at the top — seventeen
// menu items that each answered one question in an alert nobody could scroll,
// copy or keep open beside the sheet. They are now sections of one sidebar.
//
// NOTHING RUNS ON OPEN. Several of these read every form the workbook ever
// made, or every row of the ledger, and Apps Script stops an execution at its
// ceiling with no warning and no exception — `51`'s banner is the record of a
// menu item that did nothing at all because it checked everything before it
// drew anything. So the sidebar opens with a list and a Run button per check,
// and each press is its own `google.script.run` call: one slow check costs its
// own execution and nobody else's.
//
// ONE CODE PATH, TWO PRESENTATIONS. A check runs the report's EXISTING menu
// function. What that function would have put in an alert it now hands to
// `presentReport_()`, which alerts as it always did — unless a capture scope is
// open (`withReportCapture_`), in which case the text is recorded and comes
// back to the panel. `toastIfPossible()` (`25`) records into the same scope,
// so a report that answers with a toast ("No session table yet") still says
// something here. No report computes its answer twice, and the menu path and
// the editor path behave exactly as before.
//
// USAGE KEEPS COUNTING. Each Run records a press in `MENU_USAGE_V1` (`99r`)
// under the action name the menu item used, so a report's history did not
// start again when it left the menu.
//
// See docs/transitions/R4_menus_health.md.

// ---------------------------------------------------------------------------
// 99zm-a. Capture: a report's text, handed back instead of alerted
// ---------------------------------------------------------------------------

/** The open capture scope, or null. Per execution, which is per Run press. */
let __reportCapture = null;

/** Is a capture scope open? */
function reportCaptureOpen_() {
  return !!__reportCapture;
}

/**
 * Runs `fn` with a capture scope open. Returns `{ reports, toasts, returned,
 * error }`; never throws, and always closes the scope (a report that throws
 * must not leave the next one talking to a dead panel).
 */
function withReportCapture_(fn) {
  const prev = __reportCapture;
  const scope = { reports: [], toasts: [] };
  __reportCapture = scope;
  let returned;
  let error = null;
  try {
    returned = fn();
  } catch (err) {
    error = err;
  } finally {
    __reportCapture = prev;
  }
  return { reports: scope.reports, toasts: scope.toasts, returned: returned, error: error };
}

/** `toastIfPossible` (`25`) asks this first. True means "captured, do not toast". */
function captureReportToast_(message) {
  if (!__reportCapture) return false;
  __reportCapture.toasts.push(String(message));
  return true;
}

/**
 * How a report shows its answer. With a capture scope open, the text is
 * recorded for the panel. Otherwise exactly what the reports did on their own:
 * an alert (or, with `opts.modal`, a scrollable dialog whose text can be
 * copied), and where there is no UI — the editor, a trigger — the toast
 * `fallbackToast` if there is one; the caller's own `log()` is the answer then.
 */
function presentReport_(title, text, fallbackToast, opts) {
  if (__reportCapture) {
    __reportCapture.reports.push({ title: String(title || ''), text: String(text == null ? '' : text) });
    return;
  }
  try {
    const ui = SpreadsheetApp.getUi();
    if (opts && opts.modal) {
      const html = HtmlService.createHtmlOutput(
        `<div style="font:13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;padding:12px">` +
        `<pre style="white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtmlForDialog(text)}</pre>` +
        `</div>`)
        .setWidth(opts.modal.width || 720).setHeight(opts.modal.height || 560);
      ui.showModalDialog(html, title);
    } else {
      ui.alert(title, text, ui.ButtonSet.OK);
    }
  } catch (err) {
    if (fallbackToast) toastIfPossible(fallbackToast);
  }
}

// ---------------------------------------------------------------------------
// 99zm-b. The checks
// ---------------------------------------------------------------------------

/**
 * Every section of the panel. `action` is the function the menu item used to
 * name — and the MENU_USAGE_V1 key a Run is counted under. `kind: 'report'`
 * runs captured and shows its text; `kind: 'tool'` opens its own dialog over
 * the sheet (those three are ALSO on the Admin menu; they are here so that a
 * viewer the role table keeps Admin from can still reach them). `slow` only
 * changes what the button says while it waits.
 */
const HEALTH_CHECKS = [
  { id: 'why', group: 'Is something stuck?', kind: 'report', action: 'reportWhyNothingHappened',
    title: '❓ Why did nothing happen?',
    blurb: 'Every reason the workbook is currently refusing to run something.',
    run: () => reportWhyNothingHappened() },
  { id: 'triggers', group: 'Is something stuck?', kind: 'report', action: 'showTriggerStatus',
    title: '⏰ Trigger Status',
    blurb: 'Which account owns the hourly triggers, and who has actually been firing them.',
    run: () => showTriggerStatus() },
  { id: 'clearStuck', group: 'Is something stuck?', kind: 'tool', action: 'clearStuckBackgroundJobs',
    title: '🧹 Clear a Stuck Background Job…',
    blurb: 'Stands down a job that died part-way. Asks first, and names what it would stop.',
    run: () => clearStuckBackgroundJobs() },

  { id: 'ledgerVerify', group: 'Registrations', kind: 'report', action: 'showLedgerVerificationReport', slow: true,
    title: '📒 Check the Registration Ledger',
    blurb: 'Folds the ledger and compares it with the Registrants tab: who is missing, and what disagrees.',
    run: () => showLedgerVerificationReport() },
  { id: 'missing', group: 'Registrations', kind: 'report', action: 'reportMissingRegistrations', slow: true,
    title: '🔎 Find Missing Registrations',
    blurb: 'Re-reads every form response and names the ones that never became rows. Can take minutes.',
    run: () => reportMissingRegistrations() },
  { id: 'unimported', group: 'Registrations', kind: 'report', action: 'reportUnimportedForms', slow: true,
    title: '📥 Find Forms Nothing Is Importing',
    blurb: 'Forms holding responses that no session row names, and named forms that will not open.',
    run: () => reportUnimportedForms() },
  { id: 'rosters', group: 'Registrations', kind: 'report', action: 'reportLeaderSheetRosters', slow: true,
    title: '👩‍🏫 Why is a roster sheet empty?',
    blurb: 'Walks the roster push for each program registrant sheet and says which step lost the rows.',
    run: () => reportLeaderSheetRosters() },
  { id: 'ledgerGrowth', group: 'Registrations', kind: 'report', action: 'reportLedgerGrowth', slow: true,
    title: '📈 Is the Ledger Still Growing?',
    blurb: 'Entries appended lately that change nothing, and which writer is appending them.',
    run: () => reportLedgerGrowth() },

  { id: 'doctor', group: 'Forms & sessions', kind: 'tool', action: 'showFormLinkDoctorDialog',
    title: '🩺 Form & Link Doctor…',
    blurb: 'Every way a registration link goes wrong, with a button per finding. Opens over the sheet.',
    run: () => showFormLinkDoctorDialog() },
  { id: 'unopenable', group: 'Forms & sessions', kind: 'tool', action: 'showUnopenableFormsDialog',
    title: '🪦 Review Unopenable Forms…',
    blurb: 'Forms named somewhere that will not open. The review is read-only; swap and purge ask first.',
    run: () => showUnopenableFormsDialog() },
  { id: 'orphanedSessions', group: 'Forms & sessions', kind: 'report', action: 'reportOrphanedSessionRows',
    title: 'Find Leftover Calendar Rows',
    blurb: 'Session rows from a calendar this workbook no longer reads.',
    run: () => reportOrphanedSessionRows() },
  { id: 'duplicateSessions', group: 'Forms & sessions', kind: 'report', action: 'reportDuplicateSessionRows',
    title: 'Find Duplicate Session Rows',
    blurb: 'Dates on the session table more than once under one Event_ID.',
    run: () => reportDuplicateSessionRows() },
  { id: 'orphanedQuestions', group: 'Forms & sessions', kind: 'report', action: 'reportOrphanedProgramQuestions',
    title: 'Find Questions Aimed At Nothing',
    blurb: 'Program_Questions rows naming a program nothing is running, so they are on no form.',
    run: () => reportOrphanedProgramQuestions() },

  { id: 'leftoverTabs', group: 'Housekeeping', kind: 'report', action: 'previewLegacyTabMerge',
    title: 'Find Leftover Tabs',
    blurb: 'Tabs from older layouts that still hold data.',
    run: () => previewLegacyTabMerge() },
  { id: 'archivable', group: 'Housekeeping', kind: 'report', action: 'reportArchivableMonths',
    title: 'Archive Old Months',
    blurb: 'How much history each tab is carrying, by month, and whether it is worth archiving.',
    run: () => reportArchivableMonths() },
  { id: 'scriptProps', group: 'Housekeeping', kind: 'report', action: 'reportScriptPropertiesUsage',
    title: '🗄️ What is filling Script Properties?',
    blurb: 'Which stores hold the ~500KB the whole project shares.',
    run: () => reportScriptPropertiesUsage() },
  { id: 'menuUsage', group: 'Housekeeping', kind: 'report', action: 'showMenuUsageReport',
    title: '📊 Menu Usage',
    blurb: 'Which menu items (and panel checks) anybody presses, and which nobody has.',
    run: () => showMenuUsageReport() },

  { id: 'volunteerHours', group: 'Figures', kind: 'report', action: 'reportVolunteerHours',
    title: '🤝 Volunteer Hours',
    blurb: 'The year’s volunteer hours, by person.',
    run: () => reportVolunteerHours() },
  { id: 'privateSessions', group: 'Figures', kind: 'report', action: 'reportPrivateSessions',
    title: '🔒 Private Sessions',
    blurb: 'Off-calendar appointments by program and month.',
    run: () => reportPrivateSessions() }
];

function findHealthCheck_(id) {
  const key = String(id || '');
  for (let i = 0; i < HEALTH_CHECKS.length; i++) {
    if (HEALTH_CHECKS[i].id === key) return HEALTH_CHECKS[i];
  }
  return null;
}

/** The table as the page needs it: no closures, nothing else. */
function healthPanelChecks_() {
  return HEALTH_CHECKS.map(c => ({
    id: c.id, group: c.group, kind: c.kind, title: c.title, blurb: c.blurb, slow: !!c.slow
  }));
}

/**
 * The text a capture produced, as one string. The reports win over toasts —
 * a report that toasts "this can take a few minutes" and then answers should
 * show its answer — and toasts are the answer only when nothing else was said.
 */
function healthCaptureText_(captured) {
  if (captured.reports.length) {
    return captured.reports.map(r => (captured.reports.length > 1 && r.title ? `${r.title}\n${r.text}` : r.text))
      .join('\n\n');
  }
  if (captured.toasts.length) return captured.toasts.join('\n');
  return 'The check ran and said nothing. Its answer, if it gave one, is in the execution log.';
}

// ---------------------------------------------------------------------------
// 99zm-c. What the page calls
// ---------------------------------------------------------------------------

/**
 * google.script.run — one report, run now, its text returned. Never throws: a
 * report that fails comes back as "could not run", because a panel whose
 * button does nothing is the symptom 99g exists to explain.
 */
function runHealthCheck(id) {
  const check = findHealthCheck_(id);
  if (!check || check.kind !== 'report') {
    return { ok: false, id: String(id || ''), title: '', text: `There is no check called "${id}".` };
  }
  recordMenuUsage_(check.action);
  const started = Date.now();
  const captured = withReportCapture_(check.run);
  const ms = Date.now() - started;
  if (captured.error) {
    log(`runHealthCheck(${check.id}) failed: ${captured.error}`);
    const said = captured.reports.length || captured.toasts.length ? `\n\n${healthCaptureText_(captured)}` : '';
    return { ok: false, id: check.id, title: check.title, ms: ms,
      text: `This check could not run: ${captured.error && captured.error.message ? captured.error.message : captured.error}${said}` };
  }
  return { ok: true, id: check.id, title: check.title, ms: ms, text: healthCaptureText_(captured) };
}

/**
 * google.script.run — one tool: it opens its own dialog (or asks its own
 * question) over the sheet. Not captured, because what it shows IS the tool.
 */
function openHealthTool(id) {
  const check = findHealthCheck_(id);
  if (!check || check.kind !== 'tool') return { ok: false, text: `There is no tool called "${id}".` };
  recordMenuUsage_(check.action);
  try {
    check.run();
    return { ok: true, text: '' };
  } catch (err) {
    log(`openHealthTool(${check.id}) failed: ${err}`);
    return { ok: false, text: `It could not open: ${err && err.message ? err.message : err}` };
  }
}

/**
 * MENU ACTION — 📋 Coordinator ▸ 🩺 Health Panel… (and 🔧 Admin ▸ 📄 Reports).
 * Ungated: everything in it only looks, and the three tools gate themselves.
 * Also the entry point the staff console (R6) calls when it is defined.
 */
function showHealthPanel() {
  const html = HtmlService.createHtmlOutput(buildHealthPanelHtml(healthPanelChecks_()))
    .setTitle('Health');
  SpreadsheetApp.getUi().showSidebar(html);
}

// ---------------------------------------------------------------------------
// 99zm-d. The page
// ---------------------------------------------------------------------------

/**
 * The sidebar. Every string from the server — titles, and above all report
 * text, which carries program titles and people's names — is written with
 * `textContent`; the check list crosses into the script as JSON with `<`
 * escaped, so nothing can end the script block.
 */
function buildHealthPanelHtml(checks) {
  const inline = JSON.stringify(checks || []).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html><head><base target="_top">
<style>
  body { font: 13px/1.45 Arial, Helvetica, sans-serif; color: #222; margin: 0; padding: 10px; }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .lead { color: #555; margin: 0 0 10px; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #666; margin: 16px 0 6px; }
  .check { border: 1px solid #ddd; border-radius: 6px; padding: 8px; margin-bottom: 8px; background: #fff; }
  .row { display: flex; gap: 8px; align-items: flex-start; }
  .name { font-weight: bold; flex: 1; }
  .blurb { color: #555; margin-top: 2px; }
  button { font: inherit; padding: 3px 10px; border: 1px solid #888; border-radius: 4px; background: #f6f6f6; cursor: pointer; white-space: nowrap; }
  button:disabled { opacity: .6; cursor: default; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; padding: 8px; background: #f7f7f7;
        border-radius: 4px; max-height: 360px; overflow: auto; font: 12px/1.4 Menlo, Consolas, monospace; }
  pre.bad { background: #fdecea; }
  .meta { color: #888; font-size: 11px; margin-top: 4px; }
</style></head>
<body>
<h1>Health</h1>
<p class="lead">Every check runs only when you press its button. Nothing here changes the workbook except the three tools, which ask first.</p>
<div id="list"></div>
<script>
  var CHECKS = JSON.parse(${JSON.stringify(inline)});
  var list = document.getElementById('list');
  var lastGroup = null;
  CHECKS.forEach(function (c) {
    if (c.group !== lastGroup) {
      var h = document.createElement('h2');
      h.textContent = c.group;
      list.appendChild(h);
      lastGroup = c.group;
    }
    var box = document.createElement('div'); box.className = 'check';
    var row = document.createElement('div'); row.className = 'row';
    var name = document.createElement('div'); name.className = 'name'; name.textContent = c.title;
    var btn = document.createElement('button'); btn.type = 'button';
    btn.textContent = c.kind === 'tool' ? 'Open' : 'Run';
    row.appendChild(name); row.appendChild(btn); box.appendChild(row);
    var blurb = document.createElement('div'); blurb.className = 'blurb'; blurb.textContent = c.blurb;
    box.appendChild(blurb);
    var out = document.createElement('pre'); out.style.display = 'none'; box.appendChild(out);
    var meta = document.createElement('div'); meta.className = 'meta'; box.appendChild(meta);
    btn.addEventListener('click', function () { run(c, btn, out, meta); });
    list.appendChild(box);
  });

  function show(out, text, bad) {
    out.style.display = 'block';
    out.className = bad ? 'bad' : '';
    out.textContent = text;
  }

  function run(c, btn, out, meta) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = c.kind === 'tool' ? 'Opening\\u2026' : (c.slow ? 'Running (can be slow)\\u2026' : 'Running\\u2026');
    meta.textContent = '';
    var done = function () { btn.disabled = false; btn.textContent = c.kind === 'tool' ? 'Open' : 'Run again'; };
    var failed = function (err) {
      done();
      show(out, 'It did not answer: ' + (err && err.message ? err.message : err) +
        '\\n\\nA check that runs past Google\\u2019s time limit is stopped without a message. Try again, or run it from the Apps Script editor.', true);
    };
    var call = google.script.run.withFailureHandler(failed).withSuccessHandler(function (r) {
      done();
      if (c.kind === 'tool') {
        if (r && !r.ok) show(out, r.text, true);
        return;
      }
      show(out, (r && r.text) || '', !(r && r.ok));
      if (r && r.ms != null) meta.textContent = 'Ran ' + new Date().toLocaleTimeString() + ' \\u00b7 ' + Math.max(1, Math.round(r.ms / 1000)) + 's';
    });
    if (c.kind === 'tool') call.openHealthTool(c.id); else call.runHealthCheck(c.id);
  }
</script>
</body></html>`;
}
