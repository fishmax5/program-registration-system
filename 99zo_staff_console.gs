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
//
// ---------------------------------------------------------------------------
// WHAT OPENING IT USED TO COST, AND THE THREE THINGS THAT PAY IT
// ---------------------------------------------------------------------------
//
// A google.script.run is not a function call: it is a whole Apps Script
// EXECUTION, spun up, authorized and torn down, and on this workbook that is
// a second or two before the server has read anything. Opening the console
// spent two of them end to end — one for the document, then one for the desk's
// page — and the person watched the second one with "Opening Quick Mark…" on
// screen. Every other panel then cost one more, every time it was first
// opened, from a cold start, with somebody waiting at a desk. The console was
// built to remove the per-job dialog and kept the per-job round trip.
//
//   1. THE DESK'S PAGE TRAVELS WITH THE DOCUMENT (staffConsoleInlinePanels_()).
//      The console already runs on the server to build its own chrome, and the
//      page it is certain to need is the one it opens with — so that page is
//      built in the SAME execution and handed over inside the document, which
//      is the bargain 36 already makes with Quick Mark's lists and 87 with the
//      public calendar's. The console then paints with Quick Mark already
//      interactive and asks the server nothing at all.
//
//      A PAGE WITH NO WORKBOOK DATA IN IT IS FREE TO CARRY, and two of the six
//      are exactly that: Add Registrants in Bulk fetches everything it draws
//      (99q's own banner), and the Health panel's check list is a constant
//      (99zm). They are marked `static`, carried beside the desk's page, and
//      cannot go stale because there is nothing in them to be stale. They are
//      also given the room FIRST, which reads backwards and is not: a static
//      page that will not fit has no smaller version and costs a whole round
//      trip, while the desk's page has one and costs a round trip for data it
//      already knows how to ask for. See staffConsoleInlinePanels_().
//
//      AND THE CEILING IS THE SAME ONE 99g IS ABOUT. A document too big does
//      not fail loudly: the execution completes, the banner clears and NO
//      DIALOG APPEARS. So the inlined pages are measured as they will be
//      encoded and stop at STAFF_CONSOLE_INLINE_MAX_CHARS; a page that will
//      not fit falls back to its `buildLite` (Quick Mark's own "fetch your own
//      lists" page, 86K against a stored index that can be 400K) and, failing
//      that, is not carried at all — and the client fetches it exactly as it
//      does today. Which is also why the whole step is guarded WHOLE: this
//      runs before the dialog exists, and nothing that runs there may be able
//      to stop it appearing (showQuickMarkDialog()'s banner, on the same risk).
//
//   2. THE REST ARE PREFETCHED WHILE NOBODY IS WAITING (staffConsolePanels()).
//      The three pages left — volunteer hours, a private session, closing a
//      run of dates — read staff tabs, so they cannot ride along for free. But
//      the console is up, the desk is reading its first screen, and the server
//      is idle: one batched execution builds all three and the client keeps
//      them, so the first open of each is a paint rather than a round trip.
//      Batched because the cost being removed is the EXECUTION, not the work:
//      three panels in one execution is one spin-up, and the member roll is
//      read once for the two pages that want it (collectKnownMembers()'s memo).
//
//      THE DESK COMES FIRST, ALWAYS. The prefetch waits out
//      STAFF_CONSOLE_PREFETCH_IDLE_MS of quiet, stands down whenever a panel
//      has a call in flight, and never retries more than
//      STAFF_CONSOLE_PREFETCH_MAX_ROUNDS times — a mark pressed at the desk
//      must not queue behind a page nobody has asked for. It is also budgeted
//      server-side and hands back what it did not reach, like every other
//      sliced thing here.
//
//      A PREFETCHED PAGE IS KEPT FOR STAFF_CONSOLE_PREFETCH_TTL_MS and no
//      longer. These pages carry a roll of names and a list of recent visits,
//      and showing a twenty-minute-old copy of either without saying so is the
//      one thing a cache here must not do; past the TTL the panel is fetched
//      live. ↻ Reload always fetches live and throws the carried copy away.
//
//   3. WHAT THE CONSOLE CAN ANSWER ITSELF, IT DOES. The Health tab used to
//      spend a round trip asking whether R4's panel exists in this version
//      before it could draw anything. That is a `typeof` on the server, so it
//      is resolved while the document is built and travels with it.
//
// The net: opening the console is ONE execution and no waiting page, and the
// first open of any panel after it is free. Nothing about a panel's own calls
// changed — a Mark is still one google.script.run, issued when the page
// issues it.
// ============================================================================

/**
 * The panels the console can open. `build` and `gate` are called at REQUEST
 * time, never at load, so this constant reads nothing from another file.
 * `gate` answers a refusal sentence or '' — the same refusal the menu item
 * would have put in an alert, shown in the panel instead (the console is
 * already in front of the person; an alert on top of it is a second window).
 *
 * Three optional fields, all about what may be carried rather than fetched:
 *   `static`    the page holds NO workbook data, so it is cheap to build and
 *               can never be stale — inlined with the document, kept for the
 *               life of the window.
 *   `buildLite` a smaller page with the same behavior, for when the full one
 *               will not fit the inline ceiling. Quick Mark's is its own
 *               fetch-your-own-lists page, which is what a workbook with no
 *               stored index has always been handed.
 *   `prefetch`  false for a panel that must never be built except on request.
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
    },
    // The page as a workbook with no stored lists has always been handed it:
    // every dropdown drawn from CALENDAR_MAP at once, the lists fetched on
    // load. 86K rather than up to half a megabyte, and the paint is immediate.
    buildLite: () => buildQuickMarkHtml(null)
  },
  bulkRegistrants: {
    tab: 'people',
    title: 'Add Registrants in Bulk',
    blurb: 'Paste a list or open a CSV / Excel file onto one program.',
    // "Nothing from the workbook is interpolated here" — 99q's own banner.
    static: true,
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
    // Static because nothing in it runs on open — the check list is a constant
    // and every answer arrives on a button press (99zm's own rule).
    static: true,
    gate: () => (typeof buildHealthPanelHtml === 'function' ? '' :
      'The Health panel is not part of this version yet.'),
    // R4's builder takes the check list; without it the panel draws no checks.
    build: () => buildHealthPanelHtml(typeof healthPanelChecks_ === 'function' ? healthPanelChecks_() : [])
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
 * The panel the console opens with — named once, so the page that travels
 * with the document and the page the script opens cannot come apart. Inlining
 * one and opening another would be a round trip nobody could see the reason
 * for.
 */
const STAFF_CONSOLE_OPENS_WITH = 'quickMark';

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
 * How many characters of ENCODED page may travel inside the console's own
 * document, across every panel inlined.
 *
 * Not a Google-documented limit, and the same kind of working ceiling as
 * QUICK_MARK_INLINE_INDEX_MAX_CHARS (36): a dialog whose document grows too
 * big does not fail — the execution completes and no dialog appears, which
 * from the desk is indistinguishable from the menu item being broken.
 *
 * SET BELOW WHAT IS KNOWN TO WORK RATHER THAN AT IT. Quick Mark's own modal
 * ships up to its 400K of lists inside a page of its own, so a document of
 * roughly half a megabyte is proven on this workbook — and that is the
 * argument for stopping short of it here, not for matching it: what is bought
 * by going higher is ONE round trip on the workbooks with the biggest lists,
 * and what is risked is the one failure in this project that says nothing at
 * all. Under the ceiling, Quick Mark's lists ride along and the console asks
 * the server nothing; over it, the desk still paints at once and the page
 * fetches its own lists, which is one round trip — the same one the console
 * spent on every open before any of this, and spent while the screen was
 * empty rather than while somebody was already reaching for a dropdown.
 *
 * Measured on the page AS ENCODED (staffConsoleInlineJson_()), because that
 * is what the document actually carries.
 */
const STAFF_CONSOLE_INLINE_MAX_CHARS = 450000;

/** How long one batched prefetch execution may build for before it stops tidily. */
const STAFF_CONSOLE_PREFETCH_BUDGET_MS = 20000;

/** And how much it may hand back, so a prefetch cannot become a megabyte nobody asked for. */
const STAFF_CONSOLE_PREFETCH_MAX_CHARS = 600000;

/** Quiet, in the console, before a prefetch is allowed to spend an execution. */
const STAFF_CONSOLE_PREFETCH_IDLE_MS = 2500;

/**
 * How long a prefetched page may be kept. These pages carry a roll of names
 * and a list of recent visits; past this they are fetched live instead. A
 * `static` page has nothing in it to go stale and is exempt.
 */
const STAFF_CONSOLE_PREFETCH_TTL_MS = 10 * 60 * 1000;

/** Batched prefetch rounds, at most — the budget hands work back, and it must not loop. */
const STAFF_CONSOLE_PREFETCH_MAX_ROUNDS = 3;

/** A build slower than this is worth a line in the log: it is what somebody waited for. */
const STAFF_CONSOLE_SLOW_BUILD_MS = 3000;

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

// ---------------------------------------------------------------------------
// 99zo-a. Building one panel
// ---------------------------------------------------------------------------

/**
 * One panel's page, wrapped for its iframe — or why it cannot open. Never
 * throws: a throw here is a red line in the console the person can retry,
 * and an answer is better than that.
 */
function staffConsolePanel(id) {
  return staffConsoleBuildPanel_(id, {});
}

/**
 * The one builder every route into a panel goes through — the client's fetch,
 * the batched prefetch and the pages carried with the document — so a refusal
 * reads the same and is logged the same however the page was asked for.
 *
 * `opts.lite` asks for the panel's smaller page instead, and answers a refusal
 * when it has none: the inline step wants to know whether a page will fit, not
 * to be handed the big one again.
 */
function staffConsoleBuildPanel_(id, opts) {
  const options = opts || {};
  const panel = Object.prototype.hasOwnProperty.call(STAFF_CONSOLE_PANELS, id) ?
    STAFF_CONSOLE_PANELS[id] : null;
  if (!panel) return { ok: false, id: String(id), message: `There is no console panel called "${id}".` };
  try {
    const refusal = panel.gate();
    if (refusal) {
      log(`ℹ️ Staff Console: ${panel.title} declined — ${refusal}`);
      return { ok: false, id, title: panel.title, message: refusal };
    }
    if (options.lite && typeof panel.buildLite !== 'function') {
      return { ok: false, id, title: panel.title, message: `${panel.title} has no smaller page.` };
    }
    const started = Date.now();
    const built = options.lite ? panel.buildLite() : panel.build();
    const took = Date.now() - started;
    if (took >= STAFF_CONSOLE_SLOW_BUILD_MS) {
      log(`ℹ️ Staff Console: ${panel.title} took ${(took / 1000).toFixed(1)}s to build.`);
    }
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
 * Several panels in ONE execution, for the client's idle prefetch.
 *
 * Batched because the cost being removed is the EXECUTION rather than the work:
 * three pages built together is one spin-up instead of three, and the two that
 * want the member roll read it once between them (collectKnownMembers()). It
 * is budgeted and hands back what it did not reach, like every other sliced
 * thing in this project, and a panel that REFUSES is simply left out — a
 * refusal has a reason that may not hold ten minutes from now, and the client
 * asking live is how the person is told the live one.
 */
function staffConsolePanels(ids) {
  const wanted = Array.isArray(ids) ? ids : [];
  const deadline = Date.now() + STAFF_CONSOLE_PREFETCH_BUDGET_MS;
  const panels = {};
  const notBuilt = [];
  let chars = 0;
  wanted.forEach(id => {
    // Judged BEFORE the budget: a name no panel answers to must not come back
    // as work left over, or the client would ask for it again for ever.
    if (!Object.prototype.hasOwnProperty.call(STAFF_CONSOLE_PANELS, id)) return;
    if (STAFF_CONSOLE_PANELS[id].prefetch === false) return;
    if (Date.now() >= deadline || chars >= STAFF_CONSOLE_PREFETCH_MAX_CHARS) {
      notBuilt.push(String(id));
      return;
    }
    const res = staffConsoleBuildPanel_(id, {});
    if (!res.ok) return;
    panels[res.id] = res.html;
    chars += res.html.length;
  });
  return { panels, notBuilt };
}

/**
 * The pages that travel INSIDE the console's document, while the ENCODED total
 * stays inside STAFF_CONSOLE_INLINE_MAX_CHARS: every `static` page (no
 * workbook data in it, so free to build and unable to go stale), then the one
 * the console opens with.
 *
 * THAT ORDER, AND IT IS NOT THE OBVIOUS ONE. The page somebody is about to
 * look at is the opening one, so it reads as the thing to carry first — but it
 * is also the only one with somewhere to fall back to. A `static` page that
 * does not fit costs a whole round trip the first time its tab is opened and
 * has no smaller version to offer; the opening page, over the ceiling, hands
 * over its `buildLite` and fetches the rest of itself, which is one round trip
 * for data the page already knows how to ask for. So the pages with no
 * fallback are given the room first, and the one with a fallback takes what is
 * left. The statics are a few tens of thousands of characters between them, so
 * this only ever decides the boundary case.
 *
 * Returns { id: wrappedHtml }. A panel left out is one the client fetches
 * exactly as it did before any of this existed, which is what makes every
 * refusal and every ceiling here a slower open rather than a broken one.
 */
function staffConsoleInlinePanels_() {
  const out = {};
  let budget = STAFF_CONSOLE_INLINE_MAX_CHARS;
  const order = Object.keys(STAFF_CONSOLE_PANELS)
    .filter(id => id !== STAFF_CONSOLE_OPENS_WITH && STAFF_CONSOLE_PANELS[id].static)
    .concat([STAFF_CONSOLE_OPENS_WITH]);

  order.forEach(id => {
    if (budget <= 0) return;
    // Measured as it will be WRITTEN — the page crosses into the document's
    // one script block as JSON (staffConsoleInlineJson_()), and a page of
    // quotes encodes bigger than a page of prose.
    let res = staffConsoleBuildPanel_(id, {});
    let encoded = res.ok ? staffConsoleInlineJson_(res.html).length : 0;
    if (res.ok && encoded > budget && typeof STAFF_CONSOLE_PANELS[id].buildLite === 'function') {
      log(`ℹ️ Staff Console: ${res.title}'s page is ${encoded} characters — over the ${budget} left ` +
        `to carry it, so its smaller page goes instead and the page fetches the rest for itself.`);
      res = staffConsoleBuildPanel_(id, { lite: true });
      encoded = res.ok ? staffConsoleInlineJson_(res.html).length : 0;
    }
    if (!res.ok || encoded > budget) {
      if (res.ok) {
        log(`ℹ️ Staff Console: ${res.title}'s page is too big to carry (${encoded} characters) — ` +
          `the console will fetch it on open.`);
      }
      return;
    }
    out[id] = res.html;
    budget -= encoded;
  });
  return out;
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

// ---------------------------------------------------------------------------
// 99zo-b. The tabs that are not a panel
// ---------------------------------------------------------------------------

/**
 * What the Health tab can offer. Read at request time: R4's functions may or
 * may not exist. Resolved into the document as well (it is a `typeof`, not a
 * read), so the Health tab costs no round trip to draw; this stays for the
 * fallback path and because one answer with one definition is one answer.
 */
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

// ---------------------------------------------------------------------------
// 99zo-c. The console's own document
// ---------------------------------------------------------------------------

/** A value for an inline <script>: JSON text inside a JS string, '<' escaped. */
function staffConsoleScriptJson_(value) {
  return JSON.stringify(JSON.stringify(value)).replace(/</g, '\\u003c');
}

/**
 * The same job for the one value where the SIZE of the encoding matters: the
 * pages carried with the document.
 *
 * Every other value in this project crosses into a page as
 * `JSON.parse("<json text>")` — stringified twice, once to make the data and
 * once to make a string literal that cannot break out of the script block.
 * That is right for a context or a roster, and wrong for a page: the inner
 * encoding is already full of escaped quotes and the outer one escapes every
 * one of them again, so an 86K page costs 93K and a 286K page costs 492K. It
 * is the DOUBLING that decides whether Quick Mark's lists can ride along or
 * have to be fetched, which is the round trip this file exists to remove.
 *
 * So this emits the JSON ONCE, as the object literal it already is — valid
 * JavaScript by construction, since JSON is a subset of it — and makes it safe
 * in the two ways a script block demands:
 *   • every '<' becomes \u003c, so no '</script>' and no '<!--' can appear in
 *     it however a program is titled (the same guard, for the same reason, as
 *     every other page here);
 *   • U+2028 and U+2029 are escaped, because they are legal inside a JSON
 *     string and were illegal inside a JavaScript one until ES2019 — a
 *     character a browser could reject is not worth the bytes it saves.
 * Nothing else in a JSON string can end a string literal or a script block.
 */
function staffConsoleInlineJson_(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The console's own document: its chrome, and the pages it is certain to need. */
function buildStaffConsoleHtml() {
  const panels = {};
  Object.keys(STAFF_CONSOLE_PANELS).forEach(id => {
    const p = STAFF_CONSOLE_PANELS[id];
    panels[id] = { tab: p.tab, title: p.title, blurb: p.blurb,
      static: !!p.static, prefetch: p.prefetch !== false };
  });
  // GUARDED WHOLE, because this runs BEFORE the dialog exists. A throw in here
  // — or an execution that dies in here at the account's ceiling, which comes
  // with no warning and no exception — is a menu item that does nothing and
  // says nothing (99g). Carrying no pages costs a round trip per panel, which
  // is what the console cost before any of this; that is the right failure.
  let inline = {};
  let health = { embeddable: false, dialog: false };
  try {
    inline = staffConsoleInlinePanels_();
  } catch (err) {
    inline = {};
    log(`⚠️ Staff Console: no page could be carried with the window (${err}) — each will be fetched.`);
  }
  try {
    health = staffConsoleHealthInfo();
  } catch (err) {
    health = { embeddable: false, dialog: false };
  }
  const tabs = staffConsoleScriptJson_(STAFF_CONSOLE_TABS);
  const panelJson = staffConsoleScriptJson_(panels);
  const intercepts = staffConsoleScriptJson_(STAFF_CONSOLE_SHOW_INTERCEPTS);
  const inlineJson = staffConsoleInlineJson_(inline);
  const healthJson = staffConsoleScriptJson_(health);
  const opensWith = staffConsoleScriptJson_(STAFF_CONSOLE_OPENS_WITH);
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
  // THE PAGES THAT CAME WITH THIS DOCUMENT. { id: html } — the panel the
  // console opens with and every page that holds no workbook data. Opening one
  // of these is a paint, not a round trip. A panel missing from here is one
  // the server could not carry (its gate refused, or it would not fit the
  // ceiling) and is fetched exactly as it always was.
  var INLINE = ${inlineJson};
  // Whether R4's Health panel exists in this version — a typeof on the server,
  // answered while this document was built rather than in a round trip of its own.
  var HEALTH = JSON.parse(${healthJson});
  var OPENS_WITH = JSON.parse(${opensWith});
  var PREFETCH_TTL = ${STAFF_CONSOLE_PREFETCH_TTL_MS};
  var PREFETCH_IDLE = ${STAFF_CONSOLE_PREFETCH_IDLE_MS};
  var PREFETCH_MAX_ROUNDS = ${STAFF_CONSOLE_PREFETCH_MAX_ROUNDS};

  // Which panel each tab is showing (null = its launcher) and every panel
  // ever opened. A panel is HIDDEN on a tab switch, never destroyed, so a
  // half-typed form, Quick Mark's log or a running poll survives the switch.
  var OPEN = {};
  var LOADED = {};
  var CURRENT_TAB = null;
  // Pages built ahead of being asked for: { id: { html: ..., at: ms } }.
  var PREFETCH = {};
  var PREFETCH_ROUNDS = 0;
  var PREFETCH_TIMER = null;
  // How many of a panel's own calls are in flight. The prefetch stands down
  // while this is anything but zero: a mark pressed at the desk must never
  // queue behind a page nobody has asked for.
  var INFLIGHT = 0;

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

  // No round trip: what this needs to know came with the document.
  function drawHealth(v) {
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
    markTab(tabId);
    drawLauncher(tabId);
    render();
  }

  function markTab(tabId) {
    TABS.forEach(function (t) {
      $('tab-' + t.id).setAttribute('aria-selected', t.id === tabId ? 'true' : 'false');
    });
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
      markTab(p.tab);
      drawLauncher(p.tab);
    }
    OPEN[p.tab] = id;
    if (!LOADED[id]) loadPanel(id, false);
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
    reload.title = 'Open this page afresh from the workbook. Anything typed and not yet saved is lost.';
    // FRESH means fresh: a reload throws away the copy that came with the
    // window or was built ahead, because the whole reason for pressing it is
    // to pick up something that has changed since.
    reload.onclick = function () { unloadPanel(id); OPEN[p.tab] = id; loadPanel(id, true); render(); };
    if (panelsOf(p.tab).length > 1) bar.appendChild(back);
    bar.appendChild(el('span', 'title', p.title));
    bar.appendChild(reload);
    box.appendChild(bar);
    var body = el('div', 'msg busy', 'Opening ' + p.title + '…');
    box.appendChild(body);
    $('main').appendChild(box);
    return { box: box, body: body, frame: null };
  }

  /** A page already in hand for this panel, or null — and never a stale one. */
  function carriedPage(id) {
    if (INLINE[id]) return INLINE[id];
    var held = PREFETCH[id];
    if (!held) return null;
    // A static page has nothing in it to go stale (no workbook data at all);
    // anything else is kept for PREFETCH_TTL and then asked for again.
    if (!PANELS[id].static && Date.now() - held.at > PREFETCH_TTL) {
      delete PREFETCH[id];
      return null;
    }
    return held.html;
  }

  function loadPanel(id, fresh) {
    var slot = LOADED[id] = makeBox(id);
    if (fresh) { delete INLINE[id]; delete PREFETCH[id]; }
    var ready = fresh ? null : carriedPage(id);
    if (ready) { mountPanel(id, slot, ready); return; }
    google.script.run
      .withSuccessHandler(function (res) {
        if (LOADED[id] !== slot) return;   // reloaded or closed meanwhile
        if (!res || !res.ok) {
          slot.body.className = 'msg err';
          slot.body.textContent = (res && res.message) || 'It could not be opened.';
          return;
        }
        mountPanel(id, slot, res.html);
      })
      .withFailureHandler(function (err) {
        if (LOADED[id] !== slot) return;
        slot.body.className = 'msg err';
        slot.body.textContent = 'Could not open ' + PANELS[id].title + ': ' + (err && err.message) +
          '\\nPress ↻ Reload to try again.';
      })
      .staffConsolePanel(id);
  }

  function mountPanel(id, slot, html) {
    var f = document.createElement('iframe');
    f.title = PANELS[id].title;
    if (slot.body) { slot.box.removeChild(slot.body); slot.body = null; }
    slot.frame = f;
    slot.box.appendChild(f);
    f.srcdoc = html;
    f.addEventListener('load', function () {
      if (OPEN[PANELS[id].tab] === id && !slot.box.hidden) f.focus();
    });
  }

  function unloadPanel(id) {
    var slot = LOADED[id];
    if (!slot) return;
    if (slot.box.parentNode) slot.box.parentNode.removeChild(slot.box);
    delete LOADED[id];
  }

  // --- building the rest ahead, while nobody is waiting ---------------------

  function prefetchWanted() {
    return Object.keys(PANELS).filter(function (id) {
      return PANELS[id].prefetch && !INLINE[id] && !PREFETCH[id] && !LOADED[id];
    });
  }

  function schedulePrefetch() {
    if (PREFETCH_TIMER || PREFETCH_ROUNDS >= PREFETCH_MAX_ROUNDS) return;
    if (!prefetchWanted().length) return;
    PREFETCH_TIMER = setTimeout(runPrefetch, PREFETCH_IDLE);
  }

  function runPrefetch() {
    PREFETCH_TIMER = null;
    // THE DESK COMES FIRST. A panel with a call in flight is somebody waiting
    // on an answer, and an execution spent on a page nobody has opened is an
    // execution that answer is behind. Come back when it is quiet.
    if (INFLIGHT > 0) { schedulePrefetch(); return; }
    var want = prefetchWanted();
    if (!want.length) return;
    PREFETCH_ROUNDS++;
    google.script.run
      .withSuccessHandler(function (res) {
        var got = (res && res.panels) || {};
        var now = Date.now();
        Object.keys(got).forEach(function (id) {
          if (!LOADED[id]) PREFETCH[id] = { html: got[id], at: now };
        });
        // Only what the budget could not reach is asked for again; a panel
        // that REFUSED is deliberately not reported and not retried — the
        // person opening it is told the live refusal, which may differ.
        if (res && res.notBuilt && res.notBuilt.length) schedulePrefetch();
      })
      // One silent failure and no more: every panel still opens on request,
      // which is all a workbook without any of this ever did.
      .withFailureHandler(function () { PREFETCH_ROUNDS = PREFETCH_MAX_ROUNDS; })
      .staffConsolePanels(want);
  }

  // --- the bridge, console side --------------------------------------------

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

  // Only messages from a frame this console made are honoured, and each
  // becomes one real google.script.run — same function, same arguments, same
  // order — answered back to that frame.
  function relay(win, d) {
    var fn = String(d.fn || '');
    if (Object.prototype.hasOwnProperty.call(INTERCEPTS, fn)) {
      openPanel(INTERCEPTS[fn]);
      reply(win, d.id, true, null);
      return;
    }
    if (fn === 'openStaffConsole') { reply(win, d.id, true, null); return; }
    INFLIGHT++;
    function done() { INFLIGHT--; schedulePrefetch(); }
    var r = google.script.run
      .withSuccessHandler(function (value) { done(); reply(win, d.id, true, value); })
      .withFailureHandler(function (err) {
        done();
        reply(win, d.id, false, { message: (err && err.message) || String(err), name: err && err.name });
      });
    if (typeof r[fn] !== 'function') {
      done();
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
  // The desk is what this window is for, and its page came with the document,
  // so it is on screen in this paint rather than after a round trip. Only a
  // page the server could not carry costs a fetch here.
  showTab('desk');
  openPanel(OPENS_WITH);
  // Then, once it is quiet, the pages that could not ride along are built in
  // one execution, so the first open of each is a paint too.
  schedulePrefetch();
</script>
</body></html>`;
}
