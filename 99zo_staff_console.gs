// ============================================================================
// 99zo. THE STAFF CONSOLE  (one window, tabbed, instead of a dialog per job)
// ============================================================================
//
// Item #6 of docs/RESTRUCTURING_PROPOSALS.md; the plan, the per-dialog
// inventory and the manual checklist are docs/transitions/R6_staff_console.md.
//
// Every job on the menu was its own modal: a cold server round trip and a
// whole HTML document per open, one dialog at a time, and a modal that cannot
// stay up while somebody scrolls the sheet behind it. Worse, a modal whose
// markup grew too big did not fail — it simply never appeared (99g), which is
// why Quick Mark has QUICK_MARK_INLINE_INDEX_MAX_CHARS at all.
//
// The console is ONE MODELESS DIALOG with five tabs — Desk, People, Programs,
// Health, Settings. Its own document is small: chrome, a tab bar, one escaping
// helper and the bridge below. A job's page is fetched the first time it is
// opened (staffConsolePanel()), as a google.script.run RETURN VALUE — so a
// page that is too big fails into a visible "could not open" rather than into
// nothing at all.
//
// WHY MODELESS, NOT A SIDEBAR OR THE WEB APP. A sidebar is 300px, and Quick
// Mark is laid out for 560 and the bulk-add review for 920. The web app (60)
// executes as the OWNER, so getCurrentUserEmail() would sign every desk write —
// Admin_Notes, the ledger's actor, a volunteer row's Logged_By — with the
// office account; 99f already had to work round exactly that for one page. A
// modeless dialog runs as the person, behind the same gates as the menu.
//
// THE PAGES ARE NOT REWRITTEN. Each panel is the very HTML its menu item's
// builder produces today, run unchanged in an <iframe srcdoc>. A child frame
// has no google.script.run of its own, so STAFF_CONSOLE_BRIDGE_SHIM is
// prepended to the page: there google.script.run is a chainable proxy that
// posts {fn, args} to the console, which makes the real call and posts the
// answer back. Nothing about a page's ordering changes — each call is still
// its own google.script.run, issued when the page issues it — which is what
// keeps Quick Mark's optimistic marks, 99b's queueing and 99q's polling exactly
// as they were.
//
// ADDITIVE. Every menu item and dialog this hosts still works on its own;
// removing the console is deleting this file, its menu line and its 99r
// wrapper. It stores nothing.
// ============================================================================

/**
 * The panels the console can open. `build` and `gate` are called at REQUEST
 * time, never at load, so this constant reads nothing from another file.
 * `gate` answers a refusal sentence or '' — the same refusal the menu item
 * would have put in an alert, shown in the panel instead (the console is
 * already in front of the person; an alert on top of it is a second window).
 */
const STAFF_CONSOLE_PANELS = {
  quickMark: {
    tab: 'desk',
    title: 'Quick Mark',
    blurb: 'Attendance, lunch, walk-ins, the waiting list — and Change this registration.',
    gate: () => (isDeskWorkBlocked() ? deskBusyMessage() : ''),
    // readyQuickMarkIndex() and the 400K inline ceiling exactly as
    // showQuickMarkDialog() uses them, including its fall back to fetching.
    build: () => {
      try {
        return buildQuickMarkHtml(readyQuickMarkIndex());
      } catch (err) {
        log(`⚠️ Staff Console: could not inline the Quick Mark lists (${err}) — the page will fetch them.`);
        return buildQuickMarkHtml(null);
      }
    }
  },
  bulkRegistrants: {
    tab: 'people',
    title: 'Add Registrants in Bulk',
    blurb: 'Paste a list or open a CSV / Excel file onto one program.',
    gate: () => '',
    build: () => buildBulkRegistrantsHtml()
  },
  volunteer: {
    tab: 'people',
    title: 'Log Volunteer Hours',
    blurb: 'One visit: who, what, when, how long.',
    gate: () => '',
    build: () => buildVolunteerHoursHtml(volunteerDialogContext())
  },
  privateSession: {
    tab: 'people',
    title: 'Log a Private Session',
    blurb: 'Counselling or help that is never on the calendar — counted, published nowhere.',
    gate: () => '',
    build: () => buildPrivateSessionHtml(privateSessionDialogContext())
  },
  closeSessions: {
    tab: 'programs',
    title: 'Close Sessions to New Registrations',
    blurb: 'Tick Waitlist Only on a run of dates of one program.',
    gate: () => {
      if (isBootstrapActive()) return bootstrapBusyMessage();
      return '';
    },
    build: () => {
      const programs = listWaitlistProgramSessions();
      if (programs.length === 0) {
        return { refusal: `There are no upcoming sessions from a calendar in the next ` +
          `${BULK_WAITLIST_WINDOW_FORWARD_DAYS} days to close — run Sync Cal first.` };
      }
      return buildBulkWaitlistOnlyHtml(programs);
    }
  },
  health: {
    tab: 'health',
    title: 'Health',
    blurb: 'Everything that is blocking, failing or growing, in one place.',
    // R4's panel. Embedded only when it ships a builder; a show function alone
    // opens its own dialog (staffConsoleOpenHealthPanel), which replaces this one.
    gate: () => (typeof buildHealthPanelHtml === 'function' ? '' :
      'The Health panel is not part of this version yet.'),
    build: () => buildHealthPanelHtml()
  }
};

/** The tabs, in order. */
const STAFF_CONSOLE_TABS = [
  { id: 'desk', label: 'Desk' },
  { id: 'people', label: 'People' },
  { id: 'programs', label: 'Programs' },
  { id: 'health', label: 'Health' },
  { id: 'settings', label: 'Settings' }
];

/**
 * A page calling one of these opens the matching panel IN the console.
 * Without it, Quick Mark's "Log volunteer hours" link (and any other page
 * opening a sibling) would open a modal that REPLACES the console.
 */
const STAFF_CONSOLE_SHOW_INTERCEPTS = {
  showQuickMarkDialog: 'quickMark',
  showBulkRegistrantsDialog: 'bulkRegistrants',
  showVolunteerHoursDialog: 'volunteer',
  showPrivateSessionDialog: 'privateSession',
  showBulkWaitlistOnlyDialog: 'closeSessions'
};

const STAFF_CONSOLE_WIDTH = 1000;
const STAFF_CONSOLE_HEIGHT = 760;

/**
 * Prepended to every panel's page. Plain JS in a template literal with no
 * interpolation and NO BACKSLASHES (a template literal eats them; see
 * tests/inline_pages_parse.test.js). Kept deliberately small: it is the only
 * code that runs in someone else's page.
 */
const STAFF_CONSOLE_BRIDGE_SHIM = `
(function () {
  if (!window.parent || window.parent === window) return;
  var seq = 0;
  var pending = {};
  function post(msg) { window.parent.postMessage(msg, '*'); }
  function call(fn, args, ok, fail, user) {
    var id = 'c' + (++seq) + '_' + Date.now();
    pending[id] = { ok: ok, fail: fail, user: user };
    try {
      post({ staffConsole: 'call', id: id, fn: fn, args: args });
    } catch (err) {
      delete pending[id];
      var e = new Error('Could not send to the workbook: ' + (err && err.message));
      setTimeout(function () { if (fail) fail(e, user); else console.error(e); }, 0);
    }
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var d = e.data;
    if (!d || d.staffConsole !== 'result') return;
    var p = pending[d.id];
    if (!p) return;
    delete pending[d.id];
    if (d.ok) {
      if (p.ok) p.ok(d.value, p.user);
      return;
    }
    var err = new Error((d.error && d.error.message) || 'The workbook did not answer.');
    if (d.error && d.error.name) err.name = d.error.name;
    if (p.fail) p.fail(err, p.user); else console.error(err);
  });
  function runner(ok, fail, user) {
    return new Proxy({}, {
      get: function (target, name) {
        if (name === 'withSuccessHandler') return function (f) { return runner(f, fail, user); };
        if (name === 'withFailureHandler') return function (f) { return runner(ok, f, user); };
        if (name === 'withUserObject') return function (u) { return runner(ok, fail, u); };
        if (typeof name !== 'string' || name === 'then') return undefined;
        return function () { call(name, Array.prototype.slice.call(arguments), ok, fail, user); };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = {
    run: runner(null, null, undefined),
    host: {
      origin: '',
      close: function () { post({ staffConsole: 'close' }); },
      setHeight: function () {},
      setWidth: function () {},
      editor: { focus: function () { post({ staffConsole: 'editorFocus' }); } }
    }
  };
})();
`;

/** MENU ENTRY: the console. */
function openStaffConsole() {
  const html = HtmlService.createHtmlOutput(buildStaffConsoleHtml())
    .setWidth(STAFF_CONSOLE_WIDTH)
    .setHeight(STAFF_CONSOLE_HEIGHT);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Staff Console');
}

/**
 * One panel's page, wrapped for its iframe — or why it cannot open. Never
 * throws: a throw here is a red line in the console the person can retry,
 * and an answer is better than that.
 */
function staffConsolePanel(id) {
  const panel = Object.prototype.hasOwnProperty.call(STAFF_CONSOLE_PANELS, id) ?
    STAFF_CONSOLE_PANELS[id] : null;
  if (!panel) return { ok: false, id: String(id), message: `There is no console panel called "${id}".` };
  try {
    const refusal = panel.gate();
    if (refusal) {
      log(`ℹ️ Staff Console: ${panel.title} declined — ${refusal}`);
      return { ok: false, id, title: panel.title, message: refusal };
    }
    const built = panel.build();
    if (built && typeof built === 'object' && built.refusal) {
      log(`ℹ️ Staff Console: ${panel.title} declined — ${built.refusal}`);
      return { ok: false, id, title: panel.title, message: built.refusal };
    }
    return { ok: true, id, title: panel.title, html: staffConsoleWrapPanelHtml_(String(built || '')) };
  } catch (err) {
    log(`⚠️ Staff Console: ${panel.title} could not be built (${err}).`);
    return { ok: false, id, title: panel.title,
      message: `${panel.title} could not be opened: ${(err && err.message) || err}` };
  }
}

/**
 * The page as its iframe gets it: a doctype (HtmlService serves its own pages
 * in standards mode, and a srcdoc without one is quirks mode), then the
 * bridge, then the page exactly as its builder wrote it.
 */
function staffConsoleWrapPanelHtml_(pageHtml) {
  const head = '<!DOCTYPE html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<script>' + STAFF_CONSOLE_BRIDGE_SHIM + '</script>';
  const trimmed = String(pageHtml || '').replace(/^\s*<!doctype html>/i, '');
  return head + trimmed;
}

/** What the Health tab can offer. Read at request time: R4's functions may or may not exist. */
function staffConsoleHealthInfo() {
  return {
    embeddable: typeof buildHealthPanelHtml === 'function',
    dialog: typeof showHealthPanel === 'function'
  };
}

/** The Health tab's fallback: R4's own dialog, which replaces the console. */
function staffConsoleOpenHealthPanel() {
  if (typeof showHealthPanel !== 'function') {
    return { ok: false, message: 'The Health panel is not part of this version yet.' };
  }
  showHealthPanel();
  return { ok: true };
}

/** Settings tab: bring the Config tab forward. */
function staffConsoleOpenConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss && ss.getSheetByName(SHEET_NAMES.CONFIG);
  if (!sheet) return { ok: false, message: 'There is no Config tab in this workbook yet.' };
  ss.setActiveSheet(sheet);
  return { ok: true, message: 'The Config tab is open behind this window.' };
}

/** A value for an inline <script>: JSON text inside a JS string, '<' escaped. */
function staffConsoleScriptJson_(value) {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c');
}

/** The console's own document. Small on purpose: no workbook data at all. */
function buildStaffConsoleHtml() {
  const panels = {};
  Object.keys(STAFF_CONSOLE_PANELS).forEach(id => {
    const p = STAFF_CONSOLE_PANELS[id];
    panels[id] = { tab: p.tab, title: p.title, blurb: p.blurb };
  });
  const tabs = staffConsoleScriptJson_(STAFF_CONSOLE_TABS);
  const panelJson = staffConsoleScriptJson_(panels);
  const intercepts = staffConsoleScriptJson_(STAFF_CONSOLE_SHOW_INTERCEPTS);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  html, body { height: 100%; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #222; background: #fff;
         display: flex; flex-direction: column; }
  nav { display: flex; gap: 2px; border-bottom: 1px solid #ddd; padding: 6px 8px 0 8px; flex: 0 0 auto; }
  nav button { border: 1px solid #ddd; border-bottom: none; background: #f1f3f4; color: #222;
               padding: 7px 14px; font-size: 13px; border-radius: 6px 6px 0 0; cursor: pointer; }
  nav button[aria-selected=true] { background: #fff; font-weight: bold; position: relative; top: 1px; }
  nav button:focus-visible { outline: 2px solid #1155CC; }
  main { flex: 1 1 auto; position: relative; min-height: 0; }
  .view { position: absolute; inset: 0; overflow: auto; padding: 14px 16px; box-sizing: border-box; }
  .view[hidden], .panel[hidden] { display: none; }
  .card { display: block; width: 100%; text-align: left; border: 1px solid #ddd; border-radius: 6px;
          background: #fff; padding: 10px 12px; margin: 0 0 8px 0; cursor: pointer; font-size: 13px; }
  .card:hover, .card:focus-visible { border-color: #1155CC; outline: none; }
  .card b { display: block; font-size: 14px; margin-bottom: 2px; }
  .card span { color: #666; }
  .panel { position: absolute; inset: 0; display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-bottom: 1px solid #eee;
         flex: 0 0 auto; }
  .bar .title { font-weight: bold; flex: 1 1 auto; }
  .bar button { background: #fff; color: #1155CC; border: 1px solid #1155CC; border-radius: 4px;
                padding: 3px 9px; cursor: pointer; font-size: 12px; }
  .panel iframe { border: 0; width: 100%; flex: 1 1 auto; min-height: 0; }
  .msg { padding: 16px; line-height: 1.5; white-space: pre-wrap; }
  .msg.err { color: #B3261E; }
  .msg.busy { color: #666; }
  h3 { margin: 0 0 10px 0; font-size: 15px; }
  p.hint { color: #666; margin: 0 0 12px 0; line-height: 1.4; }
</style></head>
<body>
<nav id="tabs" role="tablist"></nav>
<main id="main"></main>
<script>
  var TABS = JSON.parse(${tabs});
  var PANELS = JSON.parse(${panelJson});
  var INTERCEPTS = JSON.parse(${intercepts});
  // Which panel each tab is showing (null = its launcher) and every panel
  // ever opened. A panel is HIDDEN on a tab switch, never destroyed, so a
  // half-typed form, Quick Mark's log or a running poll survives the switch.
  var OPEN = {};
  var LOADED = {};
  var CURRENT_TAB = null;
  var HEALTH = null;

  // THE ONE ESCAPING HELPER. Everything the console itself draws from the
  // workbook goes through textContent; this is for the rare string of markup.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function $(id) { return document.getElementById(id); }

  function drawTabs() {
    var nav = $('tabs');
    TABS.forEach(function (t) {
      var b = el('button', '', t.label);
      b.id = 'tab-' + t.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', 'false');
      b.onclick = function () { showTab(t.id); };
      nav.appendChild(b);
      var v = el('section', 'view');
      v.id = 'view-' + t.id;
      v.hidden = true;
      $('main').appendChild(v);
    });
    nav.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var i = TABS.findIndex(function (t) { return t.id === CURRENT_TAB; });
      i = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      showTab(TABS[i].id);
      $('tab-' + TABS[i].id).focus();
    });
  }

  function panelsOf(tabId) {
    return Object.keys(PANELS).filter(function (id) { return PANELS[id].tab === tabId; });
  }

  function drawLauncher(tabId) {
    var v = $('view-' + tabId);
    if (v.getAttribute('data-drawn')) return;
    v.setAttribute('data-drawn', '1');
    if (tabId === 'health') return drawHealth(v);
    if (tabId === 'settings') return drawSettings(v);
    panelsOf(tabId).forEach(function (id) {
      var c = el('button', 'card');
      c.appendChild(el('b', '', PANELS[id].title));
      c.appendChild(el('span', '', PANELS[id].blurb));
      c.onclick = function () { openPanel(id); };
      v.appendChild(c);
    });
  }

  function drawHealth(v) {
    var m = el('div', 'msg busy', 'Checking what the Health tab can show…');
    v.appendChild(m);
    google.script.run
      .withSuccessHandler(function (info) {
        HEALTH = info || {};
        v.removeChild(m);
        if (HEALTH.embeddable) { openPanel('health'); return; }
        if (HEALTH.dialog) {
          v.appendChild(el('p', 'hint', 'The Health panel opens in its own window, which closes this one.'));
          var b = el('button', 'card');
          b.appendChild(el('b', '', 'Open the Health panel'));
          b.appendChild(el('span', '', 'Everything that is blocking, failing or growing.'));
          b.onclick = function () {
            google.script.run.withFailureHandler(function (err) {
              v.appendChild(el('div', 'msg err', 'Could not open it: ' + err.message));
            }).staffConsoleOpenHealthPanel();
          };
          v.appendChild(b);
          return;
        }
        v.appendChild(el('div', 'msg', 'The Health panel is not part of this version yet. ' +
          'Until it is, the reports are under 🔧 Admin ▸ 📄 Reports, and ❓ Why did nothing happen? is on the menu.'));
      })
      .withFailureHandler(function (err) {
        m.className = 'msg err';
        m.textContent = 'Could not ask the workbook: ' + err.message;
      })
      .staffConsoleHealthInfo();
  }

  function drawSettings(v) {
    v.appendChild(el('h3', '', 'Settings'));
    v.appendChild(el('p', 'hint', 'Every setting still lives on the Config tab. ' +
      'Moving them into this window is a later step; nothing here changes how they work.'));
    var b = el('button', 'card');
    b.appendChild(el('b', '', 'Open the Config tab'));
    b.appendChild(el('span', '', 'Brings the Config tab forward behind this window.'));
    var out = el('div', 'msg');
    b.onclick = function () {
      out.className = 'msg busy'; out.textContent = 'Opening…';
      google.script.run
        .withSuccessHandler(function (r) {
          out.className = r && r.ok ? 'msg' : 'msg err';
          out.textContent = (r && r.message) || '';
        })
        .withFailureHandler(function (err) { out.className = 'msg err'; out.textContent = err.message; })
        .staffConsoleOpenConfig();
    };
    v.appendChild(b);
    v.appendChild(out);
  }

  function showTab(tabId) {
    CURRENT_TAB = tabId;
    TABS.forEach(function (t) {
      $('tab-' + t.id).setAttribute('aria-selected', t.id === tabId ? 'true' : 'false');
    });
    drawLauncher(tabId);
    render();
  }

  // Exactly one thing is visible: the current tab's open panel, or its launcher.
  function render() {
    var openId = OPEN[CURRENT_TAB] || null;
    TABS.forEach(function (t) { $('view-' + t.id).hidden = !(t.id === CURRENT_TAB && !openId); });
    Object.keys(LOADED).forEach(function (id) { LOADED[id].box.hidden = id !== openId; });
    if (openId && LOADED[openId] && LOADED[openId].frame) {
      try { LOADED[openId].frame.focus(); } catch (e) {}
    }
  }

  function openPanel(id) {
    var p = PANELS[id];
    if (!p) return;
    if (CURRENT_TAB !== p.tab) {
      CURRENT_TAB = p.tab;
      TABS.forEach(function (t) {
        $('tab-' + t.id).setAttribute('aria-selected', t.id === p.tab ? 'true' : 'false');
      });
      drawLauncher(p.tab);
    }
    OPEN[p.tab] = id;
    if (!LOADED[id]) loadPanel(id);
    render();
  }

  function backToLauncher(tabId) {
    OPEN[tabId] = null;
    render();
  }

  function makeBox(id) {
    var p = PANELS[id];
    var box = el('div', 'panel');
    var bar = el('div', 'bar');
    var back = el('button', '', '← ' + (TABS.filter(function (t) { return t.id === p.tab; })[0] || {}).label);
    back.onclick = function () { backToLauncher(p.tab); };
    var reload = el('button', '', '↻ Reload');
    reload.title = 'Open this page afresh. Anything typed and not yet saved is lost.';
    reload.onclick = function () { unloadPanel(id); OPEN[p.tab] = id; loadPanel(id); render(); };
    if (panelsOf(p.tab).length > 1) bar.appendChild(back);
    bar.appendChild(el('span', 'title', p.title));
    bar.appendChild(reload);
    box.appendChild(bar);
    var body = el('div', 'msg busy', 'Opening ' + p.title + '…');
    box.appendChild(body);
    $('main').appendChild(box);
    return { box: box, body: body, frame: null };
  }

  function loadPanel(id) {
    var slot = LOADED[id] = makeBox(id);
    google.script.run
      .withSuccessHandler(function (res) {
        if (LOADED[id] !== slot) return;   // reloaded or closed meanwhile
        if (!res || !res.ok) {
          slot.body.className = 'msg err';
          slot.body.textContent = (res && res.message) || 'It could not be opened.';
          return;
        }
        var f = document.createElement('iframe');
        f.title = PANELS[id].title;
        slot.box.removeChild(slot.body);
        slot.body = null;
        slot.frame = f;
        slot.box.appendChild(f);
        f.srcdoc = res.html;
        f.addEventListener('load', function () { if (OPEN[PANELS[id].tab] === id && !slot.box.hidden) f.focus(); });
      })
      .withFailureHandler(function (err) {
        if (LOADED[id] !== slot) return;
        slot.body.className = 'msg err';
        slot.body.textContent = 'Could not open ' + PANELS[id].title + ': ' + (err && err.message) +
          '\\nPress ↻ Reload to try again.';
      })
      .staffConsolePanel(id);
  }

  function unloadPanel(id) {
    var slot = LOADED[id];
    if (!slot) return;
    if (slot.box.parentNode) slot.box.parentNode.removeChild(slot.box);
    delete LOADED[id];
  }

  function panelForWindow(win) {
    var ids = Object.keys(LOADED);
    for (var i = 0; i < ids.length; i++) {
      var f = LOADED[ids[i]].frame;
      if (f && f.contentWindow === win) return ids[i];
    }
    return null;
  }

  function reply(win, id, ok, value) {
    try {
      win.postMessage(ok ? { staffConsole: 'result', id: id, ok: true, value: value }
                         : { staffConsole: 'result', id: id, ok: false, error: value }, '*');
    } catch (err) {
      try {
        win.postMessage({ staffConsole: 'result', id: id, ok: false,
          error: { message: 'The answer could not be passed back: ' + err.message } }, '*');
      } catch (e) {}
    }
  }

  // THE BRIDGE, CONSOLE SIDE. Only messages from a frame this console made
  // are honoured, and each becomes one real google.script.run — same
  // function, same arguments, same order — answered back to that frame.
  function relay(win, d) {
    var fn = String(d.fn || '');
    if (Object.prototype.hasOwnProperty.call(INTERCEPTS, fn)) {
      openPanel(INTERCEPTS[fn]);
      reply(win, d.id, true, null);
      return;
    }
    if (fn === 'openStaffConsole') { reply(win, d.id, true, null); return; }
    var r = google.script.run
      .withSuccessHandler(function (value) { reply(win, d.id, true, value); })
      .withFailureHandler(function (err) {
        reply(win, d.id, false, { message: (err && err.message) || String(err), name: err && err.name });
      });
    if (typeof r[fn] !== 'function') {
      reply(win, d.id, false, { message: 'The workbook has no function called ' + fn + '.' });
      return;
    }
    r[fn].apply(r, Array.isArray(d.args) ? d.args : []);
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || !d.staffConsole) return;
    var id = panelForWindow(e.source);
    if (!id) return;
    if (d.staffConsole === 'call') relay(e.source, d);
    else if (d.staffConsole === 'close') { unloadPanel(id); if (OPEN[PANELS[id].tab] === id) OPEN[PANELS[id].tab] = null; render(); }
    else if (d.staffConsole === 'editorFocus') { try { google.script.host.editor.focus(); } catch (err) {} }
  });

  drawTabs();
  // The desk is what this window is for, so its one page opens at once —
  // AFTER the console has painted, as a fetch of its own.
  showTab('desk');
  openPanel('quickMark');
</script>
</body></html>`;
}
