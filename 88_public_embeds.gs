// ============================================================================
// 18. THE PUBLIC EMBEDS  (the pages that live on somebody else's website)
// ============================================================================
//
// Two of the pages this deployment serves are not opened by staff, not opened
// at the door, and not opened from a calendar invitation. They are opened by
// a stranger, on a phone, usually INSIDE AN IFRAME on the organization's own
// website — the block on the "Register for Programs" page. That audience is a
// different thing from the door, and this file is where the difference is
// declared once instead of being remembered in four places:
//
//   1. THEY MAY BE FRAMED, AND NOTHING ELSE HERE MAY BE. doGet() deliberately
//      does not allow framing (see its comment): every other page in this
//      deployment WRITES to the workbook, and letting any site frame one of
//      those is how a tap on somebody else's page becomes a check-in on this
//      one. The public pages write nothing at all, so they — and only they —
//      are served with XFrameOptionsMode.ALLOWALL. Serving them the ordinary
//      way is why the embed on the website was a blank block: the browser
//      refused the frame and there was nothing to see.
//   2. THEY ARE UNGATED. No PIN, no location pin, no identity. A page that
//      asks a stranger for a staff code is a page that becomes a phone call.
//   3. THEY ARE READ-ONLY. Every endpoint they call takes no arguments that
//      change anything, so there is nothing in them to get wrong.
//
// WHY THEY LEFT 60_check_in_page_server.gs. That file is the DOOR's router,
// and the public pages were two rows in the middle of it that had to be read
// past by anybody working on the tablet. Worse, the one property they need —
// being frameable — is a property of the RESPONSE, which DOOR_ROUTES has no
// way to say. So the public pages have their own table here, doGet() asks
// this table first, and 60 keeps one delegating entry (see doorRouteUrlMode_)
// so a printed ?mode= and this router still cannot drift apart.
//
// Behavior and vocabulary only. Numbered last for the usual reason — never
// renumber — and safely: PUBLIC_EMBED_ROUTES is lazy (01a), the two mode lists
// are self-contained consts, and every page it names is a hoisted function.
// ============================================================================

/**
 * What ?mode= has to say to get the PUBLIC CALENDAR (section 17).
 *
 * Spelled several ways for the same reason the roster's list is: this one is
 * printed on paper and typed into a newsletter by somebody who is not looking
 * at this file, and 'calendar' and 'events' are what a person writing about it
 * reaches for. A spelling missing from here is not an error page — it falls
 * through to the door app, which is the wrong page in front of the wrong
 * audience. (It lived in 60 until the public pages moved here.)
 */
const PUBLIC_CALENDAR_MODES = ['public', 'calendar', 'programs', 'events', 'signup', 'sign-up', 'signups'];

/**
 * And what gets the WEEKLY page — the same programs, asked about the other
 * way round. 'What is on this Thursday' is the calendar; 'what runs every
 * Thursday' is this, and a person planning a term wants the second one.
 */
const PUBLIC_WEEKLY_MODES = ['weekly', 'regular', 'ongoing', 'recurring', 'classes', 'weekly-programs'];

/**
 * EVERY PUBLIC PAGE, IN THE ORDER THEY ARE TRIED — same shape as DOOR_ROUTES
 * and read by both the router and the link builder:
 *
 *   id     what the page is called; checkInPageUrl({ mode: 'weekly' }) etc.
 *   mode   the ?mode= this page's own URLs carry
 *   modes  every spelling that reaches it (see the two lists above)
 *   title  the browser tab
 *   build  the page, from the request
 *
 * BUILT LAZILY (see 01a_lazy_globals.gs): the entries name functions and
 * constants from other files, in a project that is one global scope evaluated
 * in whatever order it happens to be stored in.
 */
defineLazyGlobal_('PUBLIC_EMBED_ROUTES', () => [
  {
    id: 'public',
    mode: 'public',
    modes: PUBLIC_CALENDAR_MODES,
    title: 'Programs & Sign-Ups',
    // WHAT IS ON, DAY BY DAY. Everything between now and the end of next
    // month, with the CURRENT sign-up form behind each session — which for a
    // Regular program is the thing an emailed link is always wrong about a
    // month later.
    build: () => buildPublicCalendarHtml(publicProgramCalendar({}))
  },
  {
    id: 'weekly',
    mode: 'weekly',
    modes: PUBLIC_WEEKLY_MODES,
    title: 'Weekly Programs',
    // WHAT RUNS EVERY WEEK, weekday by weekday. Built from the same snapshot
    // the calendar page is built from — one read, one cache, two pages.
    build: () => buildPublicWeeklyHtml(publicWeeklyPrograms({}))
  }
]);

/** The public page this request is asking for, or null for anything else. */
function publicEmbedRoute(params) {
  const mode = String((params && (params.mode || params.view)) || '').trim().toLowerCase();
  if (!mode) return null;
  for (let i = 0; i < PUBLIC_EMBED_ROUTES.length; i++) {
    if (PUBLIC_EMBED_ROUTES[i].modes.indexOf(mode) !== -1) return PUBLIC_EMBED_ROUTES[i];
  }
  return null;
}

/**
 * The ?mode= a caller's name for a public page is spelled as in a URL, or ''
 * when no public page answers to that name. The link builder in 60 asks this
 * first — which is what keeps a printed link and this table together.
 */
function publicEmbedUrlMode(requested) {
  const asked = String(requested || '').trim().toLowerCase();
  if (!asked) return '';
  for (let i = 0; i < PUBLIC_EMBED_ROUTES.length; i++) {
    const route = PUBLIC_EMBED_ROUTES[i];
    if (route.id === asked || route.modes.indexOf(asked) !== -1) return route.mode;
  }
  return '';
}

/**
 * THE ONE PLACE A FRAMEABLE PAGE IS SERVED FROM. See point 1 in the banner:
 * ALLOWALL belongs to these pages and to nothing else in this deployment, so
 * it is written once, here, rather than being an option a future route could
 * pick up by copying its neighbour.
 */
function servePublicEmbed(route, params) {
  const out = HtmlService.createHtmlOutput(route.build(params || {}))
    .setTitle(route.title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // Older Apps Script stubs (and the tests') do not carry this method; a page
  // that cannot say ALLOWALL is still a correct page, just not an embeddable
  // one, and that is not worth a stack trace in front of a stranger.
  if (typeof out.setXFrameOptionsMode === 'function' && typeof HtmlService.XFrameOptionsMode !== 'undefined') {
    out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return out;
}

/**
 * THE SHARED LOOK OF BOTH EMBEDS — one stylesheet, because they sit in the
 * same colored block on the same website and two pages that nearly match is
 * worse than either.
 *
 * THE PAGE HAS NO BACKGROUND OF ITS OWN. It is drawn on whatever color the
 * website's section is (a soft green on the sign-up page, a yellow further
 * down), so `body` is transparent and every surface that has to be readable
 * — the sticky control bar, a card — paints itself white and says so. A page
 * that painted its own gray ground would be a gray rectangle pasted onto a
 * green section, which is exactly what an embed must not look like.
 *
 * AND IT DOES NOT FOLLOW THE VIEWER'S DARK MODE. The section behind it is one
 * fixed color on the website whatever the phone is set to; light text on it
 * would be text on green, unreadable, and unfixable from here.
 */
function publicEmbedStyles() {
  return `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
  :root {
    --ink: #16181A; --muted: #5A6360; --line: #D7DED6;
    --card: #FFFFFF; --surface: rgba(255,255,255,.92);
    --pill: #101010; --pill-ink: #FFFFFF;
    --green: #2F7A46; --green-bg: #E4F1E1;
    --amber: #7A5300; --amber-bg: #FBEBC6;
    --quiet: #4A5250; --quiet-bg: #EFF2ED;
    --shadow: 0 1px 2px rgba(20,30,20,.06), 0 2px 8px rgba(20,30,20,.06);
    --radius: 18px;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  /* TRANSPARENT ON PURPOSE — see the banner above. */
  body { margin: 0; background: transparent; color: var(--ink);
         font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         font-size: 16px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 0 14px 56px 14px; }

  header { padding: 18px 2px 10px 2px; }
  header h1 { margin: 0; font-size: 30px; line-height: 1.12; letter-spacing: -.02em; font-weight: 700; }
  header p { margin: 8px 0 0 0; color: var(--muted); font-size: 15px; max-width: 46em; }

  /* THE CONTROL BAR IS A CARD, NOT A LINE. It was transparent text on a
     transparent page, which on the website's green block came out as a row
     nobody could see — the reason this redesign exists. It paints itself
     white, keeps a border, and stays put while the list scrolls under it. */
  .controls { position: sticky; top: 0; z-index: 4; background: var(--surface);
              -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
              border: 1px solid var(--line); border-radius: var(--radius);
              padding: 10px; margin: 4px 0 6px 0; box-shadow: var(--shadow); }
  .seg { display: flex; gap: 6px; background: var(--quiet-bg); border-radius: 999px; padding: 4px; }
  .seg button { flex: 1; border: 0; background: transparent; color: var(--quiet); font-size: 14px;
                font-weight: 600; padding: 10px 8px; border-radius: 999px; cursor: pointer;
                font-family: inherit; transition: background .12s ease, color .12s ease; }
  .seg button[aria-pressed="true"] { background: var(--pill); color: var(--pill-ink); }

  /* THE BUILDING IS A ROW OF PILLS, NOT A DROPDOWN. Which building a program
     is in is the second question every caller asks, and a <select> hides the
     answer until it is opened. Pills say both things at once: which buildings
     have anything on, and which one is being shown. */
  .locbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .locbar button { border: 1px solid var(--line); background: var(--card); color: var(--ink);
                   font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px;
                   border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .locbar button[aria-pressed="true"] { background: var(--pill); color: var(--pill-ink); border-color: var(--pill); }
  .locbar button .pin { font-size: 12px; opacity: .8; }

  .searchrow { display: flex; gap: 8px; margin-top: 8px; }
  .searchrow input { flex: 1; min-width: 0; font-family: inherit; font-size: 15px;
        padding: 11px 14px; border: 1px solid var(--line); border-radius: 999px;
        background: var(--card); color: var(--ink); }
  .count { color: var(--muted); font-size: 13px; margin-top: 9px; display: flex; gap: 8px;
           align-items: center; justify-content: space-between; }
  .count button { border: 1px solid var(--line); background: var(--card); color: var(--ink);
                  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
                  padding: 6px 13px; border-radius: 999px; }

  h2.day { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
           color: var(--ink); margin: 22px 0 8px 2px; }
  h2.day span.rel { background: var(--pill); color: var(--pill-ink); border-radius: 999px;
                    padding: 3px 10px; margin-right: 8px; letter-spacing: .06em; }

  .card { display: block; width: 100%; text-align: left; font: inherit; color: inherit;
          background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
          padding: 14px 16px; margin-bottom: 10px; box-shadow: var(--shadow);
          text-decoration: none; transition: transform .08s ease, border-color .12s ease; }
  a.card { cursor: pointer; }
  a.card:hover { border-color: var(--pill); }
  a.card:active { transform: scale(.988); }
  .card .top { display: flex; gap: 12px; align-items: baseline; }
  .card .time { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 14px;
                color: var(--muted); flex: 0 0 auto; min-width: 86px; }
  .card .title { font-size: 18px; font-weight: 600; letter-spacing: -.01em; flex: 1; min-width: 0; }
  .card .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 9px 0 0 98px; }
  /* The dates line on a weekly card: a fact, quietly, under the row of
     chips — never competing with the title or the button. */
  .card .when { margin: 8px 0 0 98px; color: var(--muted); font-size: 13px; }
  @media (max-width: 520px) {
    header h1 { font-size: 25px; }
    .card .top { display: block; }
    .card .time { min-width: 0; margin-bottom: 2px; }
    .card .meta, .card .when { margin-left: 0; }
  }
  .tag { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
         background: var(--quiet-bg); color: var(--quiet); }
  /* THE BUILDING, ON EVERY CARD, AS THE ONE OUTLINED CHIP. It used to be gray
     text with no box, indistinguishable from the tags beside it; a person
     scanning for "which one is at Narberth" was reading, not scanning. */
  .tag.where { background: var(--card); color: var(--ink); border: 1px solid var(--pill);
               font-weight: 600; }
  .tag.open { background: var(--green-bg); color: var(--green); }
  .tag.warn { background: var(--amber-bg); color: var(--amber); }
  .cta { margin-left: auto; font-size: 14px; font-weight: 600; color: var(--ink);
         background: var(--pill); color: var(--pill-ink); border-radius: 999px; padding: 7px 16px; }
  .cta.quiet { background: transparent; color: var(--muted); padding-left: 0; padding-right: 0; }
  .card.opening { opacity: .6; }

  .empty { text-align: center; color: var(--muted); padding: 44px 20px; background: var(--card);
           border: 1px solid var(--line); border-radius: var(--radius); }
  .empty b { display: block; color: var(--ink); font-size: 17px; margin-bottom: 6px; }
  .notice { background: var(--amber-bg); color: var(--amber); border-radius: var(--radius);
            padding: 14px 16px; margin: 18px 0; font-size: 15px; }
  footer { color: var(--muted); font-size: 13px; text-align: center; margin-top: 26px; line-height: 1.6; }
  </style>`;
}
