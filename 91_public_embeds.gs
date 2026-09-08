// ============================================================================
// 18. THE PUBLIC EMBEDS  (the pages that live on somebody else's website)
// ============================================================================
//
// Two of the pages this deployment serves are not opened by staff, not opened
// at the door, and not opened from a calendar invitation. They are opened by a
// stranger, on a phone, and increasingly INSIDE AN IFRAME on the
// organization's own website. That audience is a different thing from the
// door, and this file is where the difference is declared once:
//
//   1. THEY MAY BE FRAMED, AND NOTHING ELSE HERE MAY BE. Every page in
//      DOOR_ROUTES (60) WRITES to the workbook, and letting any site frame one
//      of those is how a tap on somebody else's page becomes a check-in on
//      this one. The public pages write nothing at all, so servePublicEmbed()
//      is the ONE place XFrameOptionsMode.ALLOWALL is written, and it serves
//      only the pages declared here. A page that one day grows a write leaves
//      this table in the same edit.
//   2. THEY ARE UNGATED. No PIN, no location pin, no identity — a page that
//      asks a stranger for a staff code is a page that becomes a phone call.
//   3. THEY SHARE ONE LOOK. Both sit in the same colored block on the same
//      website, and two pages that NEARLY match is worse than either, so the
//      stylesheet is publicEmbedStyles() below rather than a copy apiece.
//
// WHY THEY LEFT 60. That file is the DOOR's router; the public pages were rows
// in the middle of it that anybody working on the tablet had to read past, and
// their one distinguishing property — being frameable — was a flag on a row
// describing a property of the RESPONSE. doGet() now asks this table first and
// doorRouteUrlMode_() asks publicEmbedUrlMode() first, so a printed ?mode= and
// this router still cannot drift apart.
//
// Behavior and vocabulary only. Numbered last for the usual reason — never
// renumber — and safely: PUBLIC_EMBED_ROUTES is lazy (01a), the mode and span
// lists are self-contained consts, and every page it names is a hoisted
// function.
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
 * And what gets the REGULAR PROGRAMS page (section 18a) — the same programs
 * asked about the other way round: not "what is on this Thursday" but "what
 * runs every Thursday".
 *
 * DELIBERATELY NOT 'weekly'. `?span=weekly` already means something else on
 * the calendar page — the next seven days — and one word meaning two things
 * across two links that are printed side by side is how somebody puts the
 * wrong address in a newsletter. This page is the one about programs that
 * RECUR; the span is about how much of the diary you are shown.
 */
const PUBLIC_REGULAR_MODES = ['regular', 'recurring', 'ongoing', 'classes',
  'every-week', 'regular-programs', 'weekly-programs'];

/**
 * WHICH RANGE A PUBLIC LINK OPENS ON: 'week', 'month', 'all', or '' for the
 * page's own default.
 *
 * Spelled several ways for the same reason the modes are: these URLs are
 * typed by hand, printed, and pasted into a newsletter, and "weekly" not
 * working when "week" does is the sort of thing nobody ever reports — the
 * link simply looks like it does not do what it was described as doing.
 */
const PUBLIC_CALENDAR_SPANS = {
  week: 'week', weekly: 'week', 'this-week': 'week', '7': 'week',
  month: 'month', monthly: 'month', 'this-month': 'month', '31': 'month',
  all: 'all', everything: 'all', full: 'all', '0': 'all'
};

function publicCalendarSpanRequested_(params) {
  const asked = String((params && (params.span || params.range)) || '').trim().toLowerCase();
  return PUBLIC_CALENDAR_SPANS[asked] || '';
}

/**
 * EVERY PUBLIC PAGE, IN THE ORDER THEY ARE TRIED — the same shape DOOR_ROUTES
 * uses, and read by both the router and the link builder:
 *
 *   id     what the page is called; checkInPageUrl({ mode: 'regular' }) etc.
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
    // WHAT IS ON. Everything between now and the end of next month, one tile
    // per program, with the CURRENT sign-up form behind each date — which for
    // a Regular program is the thing an emailed link is always wrong about a
    // month later. ?span= and ?building= only decide how it OPENS; every
    // filter is still one tap away (see publicCalendarViewOptions in 86).
    build: params => buildPublicCalendarHtml(
      publicProgramCalendar({}), publicCalendarViewOptions(params))
  },
  {
    id: 'regular',
    mode: 'regular',
    modes: PUBLIC_REGULAR_MODES,
    title: 'Regular Programs',
    // WHAT RUNS EVERY WEEK, weekday by weekday — the standing invitations,
    // for somebody deciding whether to JOIN something rather than whether to
    // come on Thursday. Built by folding the same snapshot the calendar page
    // is built from: one tab read, one cache, two pages.
    build: params => buildPublicRegularHtml(
      publicRegularPrograms({}), publicCalendarViewOptions(params))
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
 * when no public page answers to that name. checkInPageUrl() asks this before
 * it asks DOOR_ROUTES — which is what keeps a printed link and this table
 * together now that the pages are declared here.
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
 * it is written once, here, rather than being a flag a future route could
 * pick up by copying its neighbour.
 */
function servePublicEmbed(route, params) {
  const out = HtmlService.createHtmlOutput(route.build(params || {}))
    .setTitle(route.title)
    // These are read on a phone as often as on a desk, and inside a frame
    // whose width is somebody else's column.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return out;
}

/**
 * THE LOOK BOTH PUBLIC PAGES ARE DRAWN IN — one stylesheet, shared.
 *
 * IT HAS NO BACKGROUND OF ITS OWN, AND NO DARK MODE. This is pasted into a
 * block on the organization's website whose color the website chooses — a
 * soft green on the sign-up page, a yellow further down — so `body` is
 * transparent and every surface that has to be readable paints itself white
 * and says so. The dark-mode block this stylesheet used to carry was worse
 * than useless in that setting: it turned the text pale on a phone set to
 * dark while the block behind it stayed green, which is the whole of why the
 * "3 programs · 12 dates · Refresh" line could not be seen.
 *
 * The vocabulary is the website's own: black pill buttons, generous rounding,
 * a single geometric typeface, green for "there is room" and amber for "this
 * one is full".
 */
function publicEmbedStyles() {
  return `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  /* A stranger on a phone, in a hurry, possibly at arm's length: everything
     here is sized for reading standing up, and every tap target is a thumb. */
  :root {
    --ink: #16181A; --muted: #56605C; --line: #D5DDD3; --card: #FFFFFF;
    --page: #F4F7F2; --brand: #101010; --brand-ink: #FFFFFF;
    --open: #2F7A46; --open-bg: #E4F1E1; --warn: #7A5300; --warn-bg: #FBEBC6;
    --quiet: #4A5250; --quiet-bg: #EFF2ED;
    --shadow: 0 1px 2px rgba(20,30,20,.05), 0 2px 8px rgba(20,30,20,.06);
    --radius: 18px;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  /* TRANSPARENT ON PURPOSE — the website's own section color is the page. */
  body { margin: 0; background: transparent; color: var(--ink);
         font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
         font-size: 16px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
  /* Wide enough for two tiles a row, and no wider: a third column would put
     the far edge of the page outside a comfortable reading width. */
  .wrap { max-width: 980px; margin: 0 auto; padding: 0 16px 64px 16px; }

  /* WHO THIS IS. Sized like a masthead rather than a page title, because for
     somebody who followed a forwarded link it is the first question. */
  header { padding: 26px 0 14px 0; }
  header .eyebrow { margin: 0 0 4px 0; color: var(--muted); font-size: 13px;
                    font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
  header h1 { margin: 0; font-size: 32px; line-height: 1.1; letter-spacing: -.022em; font-weight: 700; }
  header p.blurb { margin: 8px 0 0 0; color: var(--ink); font-size: 16px; max-width: 62ch; }
  header p.lines { margin: 10px 0 0 0; color: var(--ink); font-size: 14px; }
  header p.lines a { color: var(--ink); text-decoration: underline; font-weight: 600; }
  header p.places { margin: 4px 0 0 0; color: var(--muted); font-size: 13px; }

  /* THE CONTROL BAR IS A CARD, NOT A LINE. It was transparent controls on a
     transparent page, which on a colored website block came out as a row
     nobody could see. It paints itself, keeps a border, and stays put while
     the list scrolls under it. */
  .controls { position: sticky; top: 0; z-index: 4; background: var(--card);
              border: 1px solid var(--line); border-radius: var(--radius);
              padding: 10px; margin: 4px 0 2px 0; box-shadow: var(--shadow); }
  .seg { display: flex; gap: 6px; background: var(--quiet-bg); border-radius: 999px; padding: 4px; }
  .seg button { flex: 1; border: 0; background: transparent; color: var(--quiet); font-size: 14px;
                font-weight: 600; padding: 10px 8px; border-radius: 999px; cursor: pointer;
                font-family: inherit; transition: background .12s ease, color .12s ease; }
  .seg button[aria-pressed="true"] { background: var(--brand); color: var(--brand-ink); }

  /* THE BUILDING IS A ROW OF PILLS, NOT A DROPDOWN. Which building a program
     is in is the second question every caller asks, and a <select> hides the
     answer until it is opened. Pills say both things at once: which buildings
     have anything on, and which one is being shown. */
  .locbar { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .locbar button { border: 1px solid var(--line); background: var(--card); color: var(--ink);
                   font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px;
                   border-radius: 999px; cursor: pointer; display: inline-flex;
                   align-items: center; gap: 6px; }
  .locbar button[aria-pressed="true"] { background: var(--brand); color: var(--brand-ink);
                                        border-color: var(--brand); }
  .locbar button .pin { font-size: 10px; opacity: .75; }

  .row2 { display: flex; gap: 8px; margin-top: 8px; }
  .row2 input { flex: 1; min-width: 0; font-family: inherit; font-size: 15px;
        padding: 11px 14px; border: 1px solid var(--line); border-radius: 999px;
        background: var(--card); color: var(--ink); }
  /* THE LINE THAT SAYS HOW MUCH YOU ARE LOOKING AT, and it is readable now:
     the count is ink rather than a grey that only worked on a white page, and
     Refresh is an outlined pill rather than blue text on nothing. */
  .count { color: var(--ink); font-size: 13px; font-weight: 500; margin-top: 10px;
           display: flex; gap: 8px; align-items: center; justify-content: space-between; }
  .count button { border: 1px solid var(--line); background: var(--card); color: var(--ink);
                  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
                  padding: 6px 14px; border-radius: 999px; }

  /* TWO TILES A ROW, one on a phone — and anything that is not a tile (the
     lunch pin, an empty state, a failed read) spans the whole width.
     Stretched, not top-aligned: two tiles side by side with different
     numbers of dates on them read as a ragged edge otherwise. */
  #list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px; margin-top: 16px; }
  #list > .full { grid-column: 1 / -1; }
  @media (max-width: 640px) { #list { grid-template-columns: 1fr; } }

  /* THE WEEKDAY HEADINGS on the regular-programs page: a black pill, so the
     week reads as a week rather than as grey type on a colored block. */
  h2.day { grid-column: 1 / -1; margin: 14px 0 0 0; font-size: 13px; font-weight: 700;
           letter-spacing: .08em; text-transform: uppercase; }
  h2.day span { background: var(--brand); color: var(--brand-ink); border-radius: 999px;
                padding: 6px 14px; display: inline-block; }

  /* ONE PROGRAM, ONE TILE, AND THE WHOLE TILE IS THE BUTTON. */
  .prog { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
          padding: 14px 16px 13px 16px; box-shadow: var(--shadow); cursor: pointer;
          transition: transform .08s ease, border-color .12s ease, box-shadow .12s ease; }
  .prog:hover { border-color: var(--brand); }
  .prog:active { transform: scale(.992); }
  .prog:focus-visible { outline: 3px solid var(--brand); outline-offset: 2px; }
  .prog.flat { cursor: default; }
  .prog.flat:hover { border-color: var(--line); }
  .prog.flat:active { transform: none; }
  .prog.opening { opacity: .6; }
  .prog .head { display: flex; gap: 10px; align-items: center; }
  .prog .name { font-size: 18px; font-weight: 600; letter-spacing: -.01em; flex: 1; min-width: 0; }
  /* The site's own button shape, on the tile that opens something. A tile
     that opens nothing gets a sentence instead — the two must not look
     alike, or somebody taps four times and then phones the office. */
  .prog .cta { flex: 0 0 auto; font-size: 13px; font-weight: 600; white-space: nowrap;
               background: var(--brand); color: var(--brand-ink);
               border-radius: 999px; padding: 8px 16px; }
  .prog .cta.quiet { background: transparent; color: var(--muted); padding: 0; font-weight: 500; }
  .prog .cta.warn { background: var(--warn-bg); color: var(--warn); }
  .prog .when { color: var(--muted); font-size: 14px; margin-top: 5px; }
  .prog .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 9px; }
  .tag { font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 999px;
         background: var(--quiet-bg); color: var(--quiet); }
  /* THE BUILDING, ON EVERY TILE, AS THE ONE OUTLINED CHIP. It was flat grey
     text with no box, indistinguishable from the tags beside it: a person
     scanning for "which one is at Narberth" was reading, not scanning. */
  .tag.where { background: var(--card); color: var(--ink); border: 1px solid var(--brand);
               font-weight: 600; }
  .tag.open { background: var(--open-bg); color: var(--open); }
  .tag.warn { background: var(--warn-bg); color: var(--warn); }

  /* THE DATES ARE TAP TARGETS OF THEIR OWN. Each carries its own session's
     form, which for a Regular program is a different form each month — the
     whole reason a printed link goes stale and this page does not. */
  .dates { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
  .chip { font-size: 13px; font-weight: 600; padding: 7px 12px; border-radius: 999px;
          border: 1px solid var(--line); background: var(--page); color: var(--ink);
          text-decoration: none; font-variant-numeric: tabular-nums; display: inline-block;
          transition: transform .08s ease, border-color .12s ease; }
  a.chip:hover { border-color: var(--brand); }
  a.chip:active { transform: scale(.97); }
  .chip.today { border-color: var(--brand); color: var(--brand); font-weight: 700; }
  /* A FULL DATE IS AMBER, NOT ABSENT. It is still a date somebody may want —
     the form behind it is the waiting list — so it is coloured rather than
     hidden, and the tile says what the colour means when it has both. */
  .chip.full { background: var(--warn-bg); border-color: var(--warn-bg); color: var(--warn); }
  .chip.quiet { color: var(--muted); }
  .chip.opening { opacity: .55; }
  .chip.more { border-style: dashed; color: var(--muted); cursor: pointer; font-family: inherit; }
  .legend { margin-top: 8px; font-size: 12px; color: var(--muted); }
  .legend b { color: var(--warn); font-weight: 700; }

  .empty { text-align: center; color: var(--muted); padding: 44px 20px; background: var(--card);
           border: 1px solid var(--line); border-radius: var(--radius); }
  .empty b { display: block; color: var(--ink); font-size: 17px; margin-bottom: 6px; }
  .notice { background: var(--warn-bg); color: var(--warn); border-radius: var(--radius);
            padding: 14px 16px; margin: 18px 0; font-size: 15px; }
  footer { color: var(--muted); font-size: 13px; text-align: center; margin-top: 30px;
           line-height: 1.6; }
</style>`;
}

/**
 * THE EMBED SKIN, or '' — what changes when the page is inside a frame.
 *
 * Written SERVER-side rather than switched on by a class the page's own
 * script adds, because a class added by script is a class added after the
 * first paint: the heading would be drawn, seen, and then removed, inside
 * somebody else's website. There is no frame in which this page looks like a
 * page that got dressed.
 *
 * What it does is take things AWAY. The introduction is the host site's job —
 * it has already said whose calendar this is, and said it in its own typeface
 * — the sticky bar unsticks (the frame is resized to the content, so there is
 * nothing here to scroll past), and the bottom padding goes, because in a
 * frame it is empty space nobody can explain rather than room for a thumb.
 */
function publicEmbedSkinStyles(embed) {
  if (!embed) return '';
  return `
<style>
  .wrap { padding: 0 2px 2px 2px; max-width: none; }
  .controls { position: static; margin-top: 0; }
  footer { margin-top: 18px; font-size: 12px; }
</style>`;
}

/**
 * THE REGULAR-PROGRAMS PAGE'S OWN EMBED ADDRESS AND SNIPPET — the calendar's,
 * with this page's mode on it and its own frame id, so a website that embeds
 * both grows two frames rather than one.
 */
function publicRegularEmbedUrl(options) {
  const opts = options || {};
  return checkInPageUrl({
    mode: 'regular',
    params: { embed: '1', building: opts.location || '' }
  });
}

function publicRegularEmbedSnippet(options) {
  return publicEmbedSnippetFor_(publicRegularEmbedUrl(options), {
    id: 'regular-programs',
    title: 'Weekly programs'
  });
}
