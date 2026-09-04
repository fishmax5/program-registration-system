// ============================================================================
// 4f. EVENT DESCRIPTIONS — stripping every registration link, then writing one
// ============================================================================
//
// findRegistrationLineInDescription() above finds the FIRST link in a
// description, which is all a normal sync needs. It is not enough for cleanup.
//
// Descriptions accumulate registration links. Google Calendar rewrites HTML in
// a description whenever the event is edited in the web UI, and an anchor that
// goes through that can come back out as a bare URL sitting next to the
// original — so one event ends up advertising the same form twice, in two
// formats. Older versions of this script wrote a different format again, and
// pasting an event to duplicate it copies whatever was there. A find-the-first
// -one-and-replace-it pass leaves every extra copy exactly where it was.
//
// So this section takes the other approach: remove EVERY registration link in
// a description, whatever shape it is in, then write back at most one. What it
// removes is deliberately limited to registration links and their orphaned
// labels — every other line, tag and bracket in the description is preserved
// byte for byte, because a description is also where staff keep room numbers,
// notes to volunteers, and the [Cap: N] / [Grouped] settings this system reads.
// ============================================================================

/** Every occurrence of our anchor format, not just the first. */
defineLazyGlobal_('REGISTRATION_ANCHOR_REGEX_GLOBAL', () => new RegExp(`<a[^>]*href="[^"]*#${REGISTRATION_LINK_FRAGMENT_KEY}=[a-zA-Z0-9_-]+"[^>]*>[\\s\\S]*?</a>`, 'gi'));
/** Every occurrence of the pre-anchor "Registration Link: ... [Form ID: ...]" line. */
const LEGACY_REGISTRATION_LINE_REGEX_GLOBAL =
  /^.*Registration Link:\s*\S+\s*\[Form ID:\s*[a-zA-Z0-9_-]+\].*$/gim;
/** Any anchor pointing at a Google Form — the shape a mangled/duplicated link usually survives as. */
const ANY_FORMS_ANCHOR_REGEX = /<a[^>]*href="[^"]*docs\.google\.com\/forms\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi;

/** A bare Google Forms URL with no anchor around it — what Calendar leaves behind when it flattens one. */
const BARE_FORMS_URL_REGEX = /https?:\/\/docs\.google\.com\/forms\/\S*/gi;
/**
 * WHAT THIS SCRIPT WROTE IS NOT WHAT COMES BACK OUT.
 *
 * Google Calendar re-encodes a description whenever the event is edited in the
 * web UI, and the two characters this system stamps its own lines with are
 * exactly what it re-encodes: the "🚧" written here can be read back as
 * "&#128679;" (or "&#x1F6A7;"), and the plain space after it as "&nbsp;". A
 * pattern that only knows the literal characters stops recognizing this
 * system's own line the moment somebody edits the event by hand — and a notice
 * that is not recognized is a notice that is not removed, so the event ends up
 * carrying BOTH a register link and a stale "not open yet" line under it.
 *
 * So every pattern below matches the stamp and its spacing in all three
 * encodings. The `i` flag on each pattern covers "&#X1f6A7;" and friends.
 */
const DESCRIPTION_HTML_SPACE = '(?:\\s|&nbsp;|&#0*160;|&#x0*a0;)';
const REGISTRATION_NOTICE_STAMP = '(?:🚧|&#0*128679;|&#x0*1f6a7;)';
const REGISTER_LABEL_STAMP = '(?:📝|&#0*128221;|&#x0*1f4dd;)';

/** An orphaned "📝 Register for ..." label, left when the anchor around it was flattened away. */
const ORPHAN_REGISTER_LABEL_REGEX =
  new RegExp(`^${DESCRIPTION_HTML_SPACE}*${REGISTER_LABEL_STAMP}${DESCRIPTION_HTML_SPACE}*Register for .*$`, 'gim');

/**
 * OUR CANCEL LINK, and the separator that carries it.
 *
 * IT MUST BE STRIPPABLE OR IT MULTIPLIES. Every pattern above matches a
 * docs.google.com/forms URL, and the cancel link is a script.google.com one —
 * so without this it would survive stripAllRegistrationLines() and the next
 * rewrite would prepend a second copy beside it, then a third. An event
 * description with four identical "Cancel here" links is how a member
 * concludes the system is broken and rings instead.
 *
 * Matched by the LABEL rather than by the URL, because a deployment that has
 * been re-published has a different /exec address and the links written before
 * it must still come off. Matched with and without the emoji and with the
 * separator either side of it, for the reason DESCRIPTION_HTML_SPACE exists:
 * what Google Calendar hands back is not what this script wrote.
 *
 * NOT COUNTED as a registration link found — see stripAllRegistrationLines().
 * It is debris that rides on a link, like the orphan label patterns, and
 * counting it would make a single-link event report two.
 */
const CANCEL_LINK_LABEL_STAMP = '(?:\ud83d\udeab|&#0*128683;|&#x0*1f6ab;)';
const CANCEL_ANCHOR_REGEX_GLOBAL = new RegExp(
  `(?:${DESCRIPTION_HTML_SPACE}|&middot;|·)*` +
  // DOUBLED BACKSLASHES, and they are not a typo. This is a template literal:
  // `[\s\S]` reaches the RegExp constructor as `[sS]`, which matches the
  // letters s and S and nothing else. See tests/inline_pages_parse.test.js for
  // the same bug with a browser on the other end of it.
  `<a[^>]*href="[^"]*[?&]mode=cancel[^"]*"[^>]*>[\\s\\S]*?<\\/a>`, 'gi');
/** The same anchor found by its wording, for links whose deployment URL has since changed. */
const CANCEL_ANCHOR_BY_LABEL_REGEX_GLOBAL = new RegExp(
  `(?:${DESCRIPTION_HTML_SPACE}|&middot;|·)*` +
  `<a[^>]*>${CANCEL_LINK_LABEL_STAMP}?${DESCRIPTION_HTML_SPACE}*Cannot make it\\?[\\s\\S]*?<\\/a>`, 'gi');

/**
 * THE LINE AN EARLIER SYSTEM WROTE WHILE THE LINK WAS HIDDEN.
 *
 *   📝 Registration for Chair Yoga is available on our dashboard/website. [Form: 1xUAo...]
 *
 * It is a registration line like any other — this system's stamp, this
 * system's form ID — but it carries no URL, so none of the patterns above see
 * it: not the anchor, not the "Registration Link: … [Form ID: …]" line, not a
 * bare forms URL. It outlived every cleanup, and the day the link display was
 * switched from "Hide link" back to "Show link" the new link went in ABOVE it,
 * leaving the event advertising registration twice — a live link, and a
 * sentence pointing at a form that had since been replaced.
 *
 * Matched by its "[Form: …]" marker, and separately by its wording, so a
 * hand-edited copy that lost one of the two still comes off. Bounded to text
 * with no tag or line break inside it (`[^<\\n]`) rather than to a whole line:
 * an edited description arrives re-flowed into one long line of <div>s, and
 * "the rest of the line" there is the rest of the description.
 *
 * The form ID in that sentence is deliberately NOT read back as this event's
 * form — it names whatever form was current when the line was written, which
 * is exactly what makes it stale. Form ownership comes from the session table.
 */
const LEGACY_HIDDEN_REGISTRATION_LINE_PATTERNS = [
  // The whole sentence, ending at its [Form: …] marker.
  new RegExp(`(?:${REGISTER_LABEL_STAMP}${DESCRIPTION_HTML_SPACE}*)?Registration for [^<\\n]*?` +
    `\\[Form:${DESCRIPTION_HTML_SPACE}*[a-zA-Z0-9_-]+\\]`, 'gi'),
  // The same sentence with the marker edited away — recognized by the wording,
  // which no person types into a program description by hand.
  new RegExp(`(?:${REGISTER_LABEL_STAMP}${DESCRIPTION_HTML_SPACE}*)?Registration for [^<\\n]*?` +
    `is available on our dashboard\\/website\\.?`, 'gi')
];
/** A "[Form: …]" marker left on its own — debris from the line above, never a link in its own right. */
const ORPHAN_FORM_MARKER_REGEX =
  new RegExp(`\\[Form:${DESCRIPTION_HTML_SPACE}*[a-zA-Z0-9_-]+\\]`, 'gi');
/**
 * The "🚧 Registration Not Yet Open" notice, in every shape it survives as.
 *
 * Matched with and without the emoji, and tolerant of a `<br>`/`</div>`
 * trailing it, because a description edited by hand in the Calendar web UI
 * comes back wrapped in HTML that was never there when we wrote it. A notice
 * we cannot recognize is a notice that outlives the horizon that caused it —
 * which is how an event ends up saying registration is not open on the day it
 * opens.
 */
defineLazyGlobal_('REGISTRATION_NOT_OPEN_NOTICE_PATTERNS', () => ([
  // Alone on its line — how this script writes it — however it ends up
  // indented, quoted, or wrapped in tags by a later edit.
  new RegExp(`^(?:[\\s>]|&nbsp;|&#0*160;|&#x0*a0;)*(?:<[^>]+>\\s*)*(?:${REGISTRATION_NOTICE_STAMP}${DESCRIPTION_HTML_SPACE}*)?` +
    `${REGISTRATION_NOT_OPEN_TEXT}${DESCRIPTION_HTML_SPACE}*(?:<[^>]+>\\s*)*$`, 'gim'),
  // Wrapped in one element on a line it now shares with other content: the
  // Calendar web UI re-flows a whole description into <div>s when somebody
  // edits any part of it, and our line stops being a line.
  new RegExp(`<(div|p|span)[^>]*>${DESCRIPTION_HTML_SPACE}*(?:${REGISTRATION_NOTICE_STAMP}${DESCRIPTION_HTML_SPACE}*)?` +
    `${REGISTRATION_NOT_OPEN_TEXT}${DESCRIPTION_HTML_SPACE}*</\\1>`, 'gi'),
  // Bare and mid-line, with nothing around it. Requires the stamp: the words
  // on their own could plausibly be something a person typed, but "🚧 " in
  // front of them is this script's stamp.
  new RegExp(`${REGISTRATION_NOTICE_STAMP}${DESCRIPTION_HTML_SPACE}*${REGISTRATION_NOT_OPEN_TEXT}`, 'gi')
]));

/**
 * Removes every registration link from a description and reports how many
 * distinct ones it found.
 *
 * Order matters: the specific patterns run first so the count reflects real
 * registration links rather than the debris they leave behind, and the
 * catch-all forms-link patterns clean up whatever survived in a shape we no
 * longer recognize.
 *
 * WHAT IT WILL NOT TOUCH: anything that isn't a Google Forms link or one of
 * our own labels. Room numbers, volunteer notes, [Cap: 12], [Grouped], other
 * hyperlinks, blank lines between real paragraphs — all preserved. The one
 * thing it can over-reach on is a link to some OTHER Google Form that a person
 * put in a program event description by hand; on these calendars a forms link
 * is this system's link, and the confirmation dialog says so before anything
 * is written.
 */
function stripAllRegistrationLines(description) {
  const original = String(description || '');
  if (!original) return { text: '', removed: 0, noticesRemoved: 0 };

  let removed = 0;
  const countAndClear = (text, regex) => text.replace(regex, () => { removed++; return ''; });

  let text = original;
  text = countAndClear(text, REGISTRATION_ANCHOR_REGEX_GLOBAL);
  text = countAndClear(text, LEGACY_REGISTRATION_LINE_REGEX_GLOBAL);
  text = countAndClear(text, ANY_FORMS_ANCHOR_REGEX);
  text = countAndClear(text, BARE_FORMS_URL_REGEX);
  // Counted as links: a "Registration for … [Form: …]" sentence is a
  // registration line, and callers that only act when they found one (the
  // "Hide link" sweep, the sync's already-correct fast path) must act on it.
  LEGACY_HIDDEN_REGISTRATION_LINE_PATTERNS.forEach(pattern => {
    text = countAndClear(text, pattern);
  });
  // Labels and markers are debris, not links — cleared, but never counted as a
  // link found, or an event with a flattened anchor would report two.
  // BEFORE the orphan sweeps and never counted: the cancel link is part of the
  // registration line rather than a link of its own (see buildCancelLinkLine).
  text = text.replace(CANCEL_ANCHOR_REGEX_GLOBAL, '');
  text = text.replace(CANCEL_ANCHOR_BY_LABEL_REGEX_GLOBAL, '');
  text = text.replace(ORPHAN_REGISTER_LABEL_REGEX, '');
  text = text.replace(ORPHAN_FORM_MARKER_REGEX, '');

  // The horizon notice is this system's line too, and comes off with
  // everything else so the caller can write back whichever ONE line is right
  // now. Counted SEPARATELY from links: callers that only act when a link was
  // found (the "Hide link" sweep, [No Registration]) must still notice a stale
  // notice sitting on an event, and callers that report "N old links removed"
  // must not count notices among them.
  let noticesRemoved = 0;
  REGISTRATION_NOT_OPEN_NOTICE_PATTERNS.forEach(pattern => {
    text = text.replace(pattern, () => { noticesRemoved++; return ''; });
  });

  return { text: tidyDescriptionWhitespace(text), removed, noticesRemoved };
}

/**
 * Closes up the hole left by removing a link, in both the formats a Google
 * Calendar description actually arrives in.
 *
 * Descriptions written by a person through the Calendar UI are HTML with
 * `<br>` as the line break; descriptions written by this script use real
 * newlines; and an event that has been through both has a mix. Removing a link
 * from either leaves a run of separators around the gap, so both are
 * collapsed: 3+ blank lines become one blank line, 3+ `<br>` become two, and
 * separators at the very start or end go entirely.
 *
 * Deliberately conservative — ONE blank line (or a `<br><br>`) between two
 * paragraphs is meaningful formatting somebody typed on purpose, and is kept.
 */
function tidyDescriptionWhitespace(text) {
  const BR_RUN = /(?:\s*<br\s*\/?>\s*){3,}/gi;
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // A line holding nothing but separators is blank — including one whose
    // only content is the &nbsp; a Calendar edit left where a space had been,
    // which would otherwise sit on the page as a stubborn empty line.
    .map(line => (line.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ').trim() === '' ? '' : line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(BR_RUN, '<br><br>')
    .replace(/^(?:\s*<br\s*\/?>\s*)+/i, '')
    .replace(/(?:\s*<br\s*\/?>\s*)+$/i, '')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

/** Puts the registration link at the very top, above whatever else is there. */
function prependRegistrationLine(description, linkLine) {
  const body = tidyDescriptionWhitespace(description);
  return body ? `${linkLine}\n\n${body}` : linkLine;
}

/**
 * ADMIN ACTION — "🔗 Rewrite Event Links".
 *
 * Walks every UPCOMING event on every calendar, strips out every registration
 * link it can find (all formats, all duplicates), and then writes back exactly
 * one — or none — according to Config's "Registration Link in Events" setting.
 * The link always goes at the TOP of the description; everything else in the
 * description keeps its content and its order.
 *
 * ONLY UPCOMING EVENTS. A past event's description is a record of what people
 * were sent, and rewriting it changes nothing anyone will act on while
 * spending quota and — worse — generating a calendar notification for an event
 * that has already happened.
 *
 * The form for each event comes from the SESSION TABLE (Event_ID -> Form_ID),
 * not from the description being replaced. That's the point: the description
 * is the thing that is wrong, so it can't also be the source of truth for
 * what should replace it.
 *
 * CALENDAR-EDIT TRIGGERS ARE TAKEN DOWN FOR THE DURATION, exactly as
 * syncCalendarsInternal() does, and rebuilt in a `finally` so they come back
 * whether this succeeds or throws. This function's entire job is editing the
 * description of every upcoming event, and every one of those edits is a
 * calendar update — with the triggers live, a run over a few hundred events
 * queues a few hundred onCalendarChange executions, each of which can decide a
 * full syncCalendars() is warranted. That is the trigger storm this codebase
 * has been bitten by before; a cleanup pass is the single most efficient way
 * to cause it.
 *
 * primeCalendarSyncTokens() then swallows this run's own edits BEFORE the
 * triggers go back on, so the first delta check after the restore doesn't see
 * every event we just touched and start a sync anyway.
 */
function rewriteEventRegistrationLinks() {
  if (!requireAuthorizedAdmin('Rewrite Event Links')) return null;

  // A bootstrap has deliberately paused these triggers and will restore them
  // itself. Taking them down and putting them back underneath it would both
  // fight that and re-arm automation mid-import.
  if (isBootstrapActive()) {
    const message = 'A large-setup import or forms-rebuild sweep is running — try "Rewrite Event Links" once it finishes.';
    log(`rewriteEventRegistrationLinks: ${message}`);
    toastIfPossible(message);
    return null;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!registrySheet) {
    toastIfPossible('No program dashboard yet — run Sync Cal first.');
    return null;
  }

  const showLinks = shouldShowLinkInDescription();
  const mode = getLinkDisplayMode();

  // Asked BEFORE the lock is taken: holding a script lock open while a modal
  // waits for a human is how a scheduled sync gets skipped for ten minutes
  // because somebody walked away from the dialog.
  const horizonNote = hasRegistrationHorizon()
    ? `\n\nRegistration is open through ${describeRegistrationHorizon()}. Events AFTER that date get ` +
      `"${REGISTRATION_NOT_OPEN_LINE}" instead of a link.`
    : '';
  if (!confirmConsequentialAction('Rewrite the registration link on every upcoming event?',
    `Config says "${mode}".${horizonNote}\n\n` +
    'Every UPCOMING event on all program calendars will have every registration link removed — ' +
    'including duplicates and older formats — and then ' +
    (showLinks
      ? 'exactly one fresh link written at the top of its description.'
      : 'NO link written back, because the setting is "Hide link".') +
    '\n\nEverything else in each description (room notes, [Cap: N], [Grouped], other text) is kept ' +
    'exactly as it is. Past events are not touched.\n\n' +
    'Note: any link to a Google Form in these descriptions is treated as a registration link and removed.',
    false)) {
    return null;
  }

  // The same lock syncCalendars() takes. Both edit calendar descriptions and
  // both manage the calendar-edit triggers; overlapping them would have one
  // restore the triggers while the other is still writing.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    log('rewriteEventRegistrationLinks: a sync is already running — skipping this run.');
    toastIfPossible('A sync is already running — try again in a moment.');
    return null;
  }
  try {
    return rewriteEventRegistrationLinksInternal(registrySheet, showLinks);
  } finally {
    lock.releaseLock();
  }
}

/** The rewrite itself, inside the lock. See rewriteEventRegistrationLinks(). */
function rewriteEventRegistrationLinksInternal(registrySheet, showLinks) {
  // Event_ID -> what the session table says this event's form is.
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  const todayKey = formatDateKey(new Date());
  const sessionByEventId = {};
  getSectionedRows(registrySheet, headers, 'Event_ID').forEach(row => {
    const eventId = String(row[map['Event_ID']] || '').trim();
    const d = coerceDate(row[map['Event_Date']]);
    if (!eventId || !d || formatDateKey(d) < todayKey) return;
    sessionByEventId[eventId] = {
      formId: String(row[map['Form_ID']] || '').trim(),
      cleanTitle: String(row[map['Clean_Title']] || '').trim(),
      isGrouped: isGroupedTypeTag(row[map['Type_Tag']]),
      date: d
    };
  });

  // computeSyncDateRange() starts at the 1st of the current month, so its
  // window includes events that have already happened. Fetch that window (it
  // is the one getCalendarEventsForWindow() caches, shared with every other
  // caller in the run) but only rewrite from today forward.
  const { start, end } = computeSyncDateRange();
  const windowStart = parseDateKey(todayKey);
  const eventsByCalendar = getCalendarEventsForWindow(start, end);

  const formInfoCache = {};
  const stats = {
    scanned: 0, linksRemoved: 0, rewritten: 0, cleared: 0, unchanged: 0,
    noForm: 0, notYetOpen: 0, calendarsSkipped: 0, triggersRemoved: 0, triggersRestored: 0
  };

  // EVERY description write below is a calendar update. Take the watchers down
  // first — see this function's header comment — and put them back in the
  // `finally`, so an exception halfway through can't leave the project with no
  // calendar-edit triggers at all.
  //
  // UNLESS SOMEBODY ELSE ALREADY DID. This function is also reached from
  // inside larger jobs that hold their own quiet window (Link Program Across
  // Locations, Move Sessions to Another Form). Restoring the triggers in the
  // middle of one of those would re-arm them for the rest of its work, which
  // is precisely the storm both are avoiding — so when nested, the outer
  // window owns the removal and the restore.
  const nestedInQuietWindow = calendarQuietWindowDepth > 0;
  stats.triggersRemoved = nestedInQuietWindow ? 0 : removeCalendarChangeTriggers();
  if (stats.triggersRemoved === 0 && !nestedInQuietWindow) {
    // Either there genuinely were none — normal on a workbook where "Check
    // Triggers" hasn't been run — or they belong to a DIFFERENT Google
    // account, in which case this account cannot see or delete them (see
    // writeTriggers()) and they will fire on every description written below.
    // Not fatal, and not worth refusing over, but it is exactly the situation
    // where a storm still happens after taking the precaution.
    log('ℹ️ Rewrite Event Links: no calendar-edit triggers to pause under this account. If another ' +
      'account created them, they are still live and will react to these edits — see the Triggers ' +
      'page in the Apps Script editor.');
  }
  try {
    Object.keys(CALENDAR_MAP).forEach(calendarId => {
      const events = eventsByCalendar[calendarId];
      if (!events) {
        log(`⚠️ Rewrite Event Links: "${CALENDAR_MAP[calendarId]}" could not be read — skipped.`);
        stats.calendarsSkipped++;
        return;
      }

      events.forEach(ev => {
        if (ev.isAllDayEvent()) return;
        const startTime = ev.getStartTime();
        if (startTime < windowStart) return; // past — left as the record it is
        const parsed = parseEventTitle(ev.getTitle());
        if (!parsed) return;

        stats.scanned++;
        const existing = ev.getDescription() || '';
        const stripped = stripAllRegistrationLines(existing);
        stats.linksRemoved += stripped.removed;

        let updated = stripped.text;
        if (showLinks && shouldMarkNotYetOpen(startTime)) {
          // Past the horizon: the notice replaces the link, and no form has to
          // be opened to write it. Not counted against noForm — there being no
          // form yet is irrelevant when nothing would be linked either way.
          updated = prependRegistrationLine(stripped.text, REGISTRATION_NOT_OPEN_LINE);
          stats.notYetOpen++;
        } else if (showLinks) {
          const eventId = computeEventId(calendarId, parsed.cleanTitle, formatDateKey(startTime));
          const session = sessionByEventId[eventId];
          const formInfo = session && session.formId ? getFormInfoForLink(session.formId, formInfoCache) : null;
          if (!formInfo) {
            // No form on the session table (or it wouldn't open). The old links
            // still come off — a stale link to a form nobody is reading is worse
            // than none — but there is nothing correct to put back.
            stats.noForm++;
          } else {
            updated = prependRegistrationLine(stripped.text, buildRegistrationLinkLine({
              isFixed: session.isGrouped,
              cleanTitle: session.cleanTitle || parsed.cleanTitle,
              monthLabel: getMonthLabel(startTime)
            }, formInfo));
          }
        }

        if (updated === existing) { stats.unchanged++; return; }
        ev.setDescription(updated);
        if (showLinks && updated !== stripped.text) stats.rewritten++; else stats.cleared++;
      });
    });
  } finally {
    invalidateCalendarEventsCache(); // descriptions just changed under the cache
    try {
      // Order matters, same as syncCalendarsInternal(): swallow this run's own
      // edits BEFORE the watchers come back on, or the first delta check after
      // the restore sees every event we just touched and starts a sync anyway.
      //
      // Skipped wholesale when nested: the outer quiet window primes and
      // restores once, around everything. (An `if`, not an early `return` —
      // returning from a `finally` would swallow whatever exception put us
      // here and discard this function's result.)
      if (!nestedInQuietWindow) {
        primeCalendarSyncTokens('link rewrite');
        // RESTORE ONLY, for the same reason syncCalendarsInternal() is —
        // rebuilding unconditionally here would CREATE a full set of
        // calendar-edit triggers under whichever admin ran this, and an admin
        // is not necessarily the trigger owner. That is how an invisible second
        // set gets made by someone doing nothing more suspicious than fixing
        // duplicate links. An account that held none a moment ago ends with
        // none; the log line above already told them why they might hold none.
        //
        // force: the bootstrap check happened at the top of the public entry
        // point, and automation staying off is the one outcome worth avoiding
        // more than a redundant rebuild.
        if (stats.triggersRemoved > 0 || isTriggerOwnerAccount()) {
          stats.triggersRestored = writeCalendarChangeTriggers(true).created;
        } else {
          log('Rewrite Event Links: calendar-edit triggers not restored — this account held none before the ' +
            'run and is not the recorded trigger owner. Creating them here would add a second, invisible set.');
        }
      }
    } catch (err) {
      // The loudest failure this function has. Silent automation is how "the
      // calendar stopped syncing" becomes a mystery two weeks later.
      log(`⚠️ Rewrite Event Links: could not restore the calendar-edit triggers (${err}) — run "Check Triggers".`);
      noteForAdmin('Calendar triggers not restored',
        `"Rewrite Event Links" finished but could not rebuild the calendar-edit triggers (${err}). ` +
        `Run "Check Triggers" from the Admin menu — until then, edits made directly on a calendar ` +
        `will not be picked up until the next daily sync.`);
      toastIfPossible('⚠️ Links rewritten, but the calendar-edit triggers could not be restored — run "Check Triggers".');
    }
  }

  const summary = `Event links rewritten ✅ — ${stats.scanned} upcoming event(s) scanned, ` +
    `${stats.linksRemoved} old link(s) removed, ${stats.rewritten} rewritten, ${stats.cleared} left with no link, ` +
    `${stats.unchanged} already correct; ${stats.triggersRestored} calendar-edit trigger(s) rebuilt` +
    (stats.notYetOpen > 0 ? `, ${stats.notYetOpen} marked "${REGISTRATION_NOT_OPEN_TEXT}"` : '') +
    (stats.noForm > 0 ? `, ⚠️ ${stats.noForm} with no form on the dashboard` : '') +
    (stats.calendarsSkipped > 0 ? `, ⚠️ ${stats.calendarsSkipped} calendar(s) unreadable` : '') + '.';
  log(`rewriteEventRegistrationLinks: ${summary}`);
  toastIfPossible(summary);

  if (stats.noForm > 0) {
    noteForAdmin('Events with no registration form',
      `${stats.noForm} upcoming event(s) had their old link(s) removed but no form on the session table to link to. ` +
      `Run Sync Cal to build their forms, then run "🔗 Rewrite Event Links" again.`);
  }
  flushAdminDigest('Rewrite event links');
  return stats;
}

/**
 * { formId, publishedUrl } for a form, memoized per run — the same form covers
 * a whole series, and opening it once per event would be the expensive part of
 * this by an order of magnitude. A form that won't open is cached as null so
 * it isn't retried on every one of its events either.
 */
function getFormInfoForLink(formId, cache) {
  if (Object.prototype.hasOwnProperty.call(cache, formId)) return cache[formId];
  let info = null;
  try {
    const form = openFormCached(formId);
    info = { formId, publishedUrl: buildRegistrationUrl(form) };
  } catch (err) {
    log(`⚠️ Could not open form ${formId} to rebuild its event link (${err}).`);
  }
  cache[formId] = info;
  return info;
}

/**
 * Reopens an already-existing form for a series/month and refreshes its
 * date-dependent items. Not-serving dates are excluded from the lunch grid
 * rows (see buildDateLabelSets()) but still appear on the Dates checkbox.
 */
function refreshFormForNewDates(formId, group, configInfo) {
  const form = openFormCached(formId);
  // FIRST, before anything else this function refreshes: a program renamed on
  // the calendar keeps its form (recovered from the event descriptions — see
  // renameFormForGroup()), and the form has to stop advertising the old name.
  renameFormForGroup(form, group);

  const sessions = sessionsOfGroup(group);
  const { allDateLabels, lunchDateLabels, allDateLines } =
    buildDateLabelSets(sessions, { showLocation: group.isShared });

  form.setDescription(buildFormDescription(group.locations, allDateLabels, group.isFixed, lunchDateLabels.length > 0,
    { isClub: group.isClub, programTitle: group.cleanTitle, isLunchOnly: group.isLunchOnly,
      isAssistance: group.isAssistance, dateLines: allDateLines }));
  // Re-asserted on every refresh, not only at creation: [Club] can be added to
  // (or taken off) a program's calendar events at any time, and the sign-up
  // options are the only place a respondent can act on that.
  applyAttendanceModeChoices(form,
    { isFixed: group.isFixed, isClub: group.isClub, programTitle: group.cleanTitle,
      isLunchOnly: group.isLunchOnly, isAssistance: group.isAssistance });

  // Catches a form that predates this location's policy being set to Never,
  // or predates the policy feature entirely, and re-checks whether the dates
  // now on the form serve lunch at all. Both directions are handled and both
  // are no-ops once the form already matches, so this is cheap on every
  // subsequent call.
  const questionsChanged = syncLunchQuestionsOnForm(form, group.locations, lunchDateLabels.length > 0, group);

  // Only ROWS are refreshed here — grid COLUMNS (the person labels) are the
  // same on every form and are set once at template-build time.
  applyFormDateLabels(formId, allDateLabels, lunchDateLabels,
    { form, force: questionsChanged > 0, context: 'new dates on an existing form',
      shape: formLunchShapeKey(group, lunchDateLabels.length > 0) });

  // LAST, after the dates and the lunch questions have settled: the
  // appointment shaping deletes the very grids the call above just filled in
  // (on an assistance form those grids are the wrong question), and the extra
  // questions are positioned relative to items that must already exist. See
  // applyProgramFormExtensions().
  applyProgramFormExtensions(form, formContextFromGroup(group, formId));

  return {
    formId: form.getId(),
    // Rebuilt here rather than reused: the grid rows just changed, and a
    // prefill URL encodes the exact rows it was generated against.
    publishedUrl: buildRegistrationUrl(form),
    editUrl: form.getEditUrl(),
    dateLabels: allDateLabels
  };
}

/**
 * What a group's registration form is CALLED. One function, because the name
 * is now asserted on every refresh as well as at creation — see
 * renameFormForGroup().
 */
function buildFormTitleForGroup(group) {
  // The lunch-only form is named for what it does and for the whole span it
  // covers, not for any one of its sessions: its rows are named per DATE now
  // ("Lunch @ Narberth — Chx Parm"), and a form covering a month of dates must
  // not be named after one Tuesday's chicken.
  if (group.isLunchOnly) {
    return `Lunch Sign-Up — ${group.locations[0] || ''}, ${group.monthLabel}`;
  }
  const baseTitle = group.isFixed
    ? `${group.cleanTitle} — Registration`
    : `${group.cleanTitle} - ${group.monthLabel}`;
  // A cross-location form sits in the same Drive folder as the per-location
  // ones and would otherwise be indistinguishable from them by name.
  return group.isShared ? `${baseTitle} (${SHARED_LOCATION_TAG})` : baseTitle;
}

/**
 * Renames `form` to match what its group is now called, if it doesn't already.
 *
 * WHY A RENAME AND NOT A NEW FORM. Renaming a program on the calendar changes
 * its group key (`<scope>::<title>::<span>`), so nothing in the persistent
 * registry points at its form any more. What saves it is the registration link
 * this system injects into every one of the program's calendar event
 * descriptions: findExistingFormIdFromEvents() recovers the Form ID from there
 * and processCalendarGroup() reuses that form — which is right, and is what
 * keeps every link already handed out working.
 *
 * What did NOT happen was the rename. The form kept the old program's name in
 * its title forever: respondents opened "Chair Yoga - September" to sign up
 * for a program the calendar, the dashboard and the printed sheets all called
 * something else, and the only way to fix it was by hand in Drive. The date
 * labels, description and questions were all being refreshed; the one thing a
 * person actually reads first was not.
 *
 * The Drive FILE is renamed alongside the form: they are the same object, but
 * a form's title and its file name are separate fields and Drive's is what
 * every folder listing and search result shows.
 */
function renameFormForGroup(form, group) {
  const wanted = buildFormTitleForGroup(group);
  let current;
  try {
    current = form.getTitle();
  } catch (err) {
    log(`ℹ️ Could not read the title of form ${form.getId()} to check it (${err}).`);
    return false;
  }
  if (current === wanted) return false;

  try {
    form.setTitle(wanted);
  } catch (err) {
    log(`⚠️ Could not rename form ${form.getId()} from "${current}" to "${wanted}" (${err}).`);
    return false;
  }
  try {
    DriveApp.getFileById(form.getId()).setName(wanted);
  } catch (err) {
    // The form itself is renamed, which is what respondents see; a stale Drive
    // file name is untidy rather than wrong.
    log(`ℹ️ Renamed form ${form.getId()} but could not rename its Drive file (${err}).`);
  }
  log(`Renamed form ${form.getId()} from "${current}" to "${wanted}" — the program was renamed on the calendar.`);
  return true;
}

/** Creates a new per-group registration form by COPYING the one shared template. */
function createRegistrationForm(group, configInfo) {
  const formTitle = buildFormTitleForGroup(group);

  // One template for everything now — the Attendance Mode fast path is on
  // every form, so Grouped and Regular groups no longer need separate bases.
  const templateForm = getOrCreateTemplateForm();
  const copiedFile = DriveApp.getFileById(templateForm.getId()).makeCopy(formTitle, getOrCreateFormsFolder());
  // NOT openFormCached(): a file id that came into existence one line ago can
  // never be in the memo, so routing it through would buy nothing and would
  // leave a handle behind for a form the failure path below is about to trash.
  const form = FormApp.openById(copiedFile.getId());

  // OPENED UP AT BIRTH, so the account that syncs this workbook can read the
  // form the account that created it just made. Drive gives a new file to its
  // creator alone, and an hourly sync run by anybody else is then refused —
  // silently, since a form that cannot be opened simply imports nothing. Never
  // fatal: an unshared form still works for the people filling it in. See
  // openUpFileToAnyoneWithLink().
  openUpFileToAnyoneWithLink(form.getId(), `registration form "${formTitle}"`);

  // EVERYTHING PAST THE COPY IS GUARDED, and the copy is thrown away if any of
  // it fails. A half-configured form is not a usable registration form, and
  // leaving it in Drive means the folder fills with one abandoned copy per
  // failed attempt — an hourly sync against a fault that does not fix itself
  // produces a drift of identically-named forms, and the first job of whoever
  // finds them is working out which (if any) is the real one. createFormFromSpec()
  // has cleaned up after itself for this exact reason; this path did not, and
  // the createChoice() fault above ran it every sync for as long as it stood.
  try {
    return configureCopiedRegistrationForm(form, group, configInfo, formTitle);
  } catch (err) {
    try { DriveApp.getFileById(form.getId()).setTrashed(true); } catch (trashErr) { /* best effort */ }
    throw err;
  }
}

/**
 * The re-runnable half of createRegistrationForm(): everything done to the
 * copy once it exists. Split out so the caller can trash the copy if any of it
 * throws — see the comment there.
 */
function configureCopiedRegistrationForm(form, group, configInfo, formTitle) {
  form.setTitle(formTitle);

  // PUBLISHED FIRST, THEN OPENED OR CLOSED — and the order is the whole point.
  //
  // Google split "is this form published" from "is it accepting responses",
  // and a copy of a form now arrives UNPUBLISHED. setAcceptingResponses() on
  // an unpublished form does not quietly do nothing; it throws "Operation not
  // supported on unpublished form", which is what every newly copied form was
  // logging. It was only ever a warning, so the form still got built — but it
  // was built with whatever liveness the copy came with rather than the one
  // the registration horizon asked for, which means a form meant to stay shut
  // until registration opens could be taking responses, and vice versa.
  try {
    if (typeof form.setPublished === 'function') form.setPublished(true);
  } catch (err) {
    log(`⚠️ Could not explicitly publish copied form "${formTitle}" (${err}) — copies are published by default in most accounts.`);
  }

  // Live now, or built closed until registration opens — see
  // applyRegistrationHorizonToNewForm().
  applyRegistrationHorizonToNewForm(form, sessionsOfGroup(group), formTitle);

  const sessions = sessionsOfGroup(group);
  const { allDateLabels, lunchDateLabels, allDateLines } =
    buildDateLabelSets(sessions, { showLocation: group.isShared });

  form.setDescription(buildFormDescription(group.locations, allDateLabels, group.isFixed, lunchDateLabels.length > 0,
    { isClub: group.isClub, programTitle: group.cleanTitle, isLunchOnly: group.isLunchOnly,
      isAssistance: group.isAssistance, dateLines: allDateLines }));
  applyAttendanceModeChoices(form,
    { isFixed: group.isFixed, isClub: group.isClub, programTitle: group.cleanTitle,
      isLunchOnly: group.isLunchOnly, isAssistance: group.isAssistance });

  // A form whose locations never cater — or none of whose dates serve lunch —
  // shouldn't be asking about lunch at all.
  syncLunchQuestionsOnForm(form, group.locations, lunchDateLabels.length > 0, group);

  // Only ROWS are set here — grid COLUMNS (the person labels) were already
  // baked into the template. force:true because a fresh copy still carries
  // the template's placeholder rows even though this brand-new form ID has
  // no fingerprint on file yet.
  applyFormDateLabels(form.getId(), allDateLabels, lunchDateLabels, { form, force: true, context: 'new form',
    shape: formLunchShapeKey(group, lunchDateLabels.length > 0) });
  applyFormFooterNote(form, configInfo.footerNote);
  // A COPY OF THE TEMPLATE CARRIES NO CUSTOM QUESTIONS AND NO SHAPE OF ITS
  // OWN — both are re-applied here, with force so the brand-new form ID (which
  // has no record on file yet, but may inherit the template's) is written
  // rather than skipped as unchanged.
  applyProgramFormExtensions(form, formContextFromGroup(group, form.getId()), { force: true });
  setFormTemplateVersion(form.getId(), TEMPLATE_VERSION);

  return {
    formId: form.getId(),
    publishedUrl: buildRegistrationUrl(form), // prefilled all-checked when possible
    editUrl: form.getEditUrl(),
    dateLabels: allDateLabels
  };
}

/**
 * Attaches the per-location note to the "Anything Else?" question — as its
 * HELP TEXT, which is the line under the question title telling you what to
 * put in the box.
 *
 * Also removes any leftover standalone "Footer Note" section header from forms
 * built before v4, where the note lived as a bold heading of its own floating
 * above the last question with nothing under it (see addClosingQuestions()).
 * A form that has already been rebuilt has none, so the sweep costs nothing.
 */
function applyFormFooterNote(form, footerNote) {
  const removed = deleteFormItems(form,
    form.getItems().filter(it => it.getTitle() === LEGACY_FOOTER_ITEM_TITLE),
    `form ${form.getId()}`);
  if (removed > 0) invalidateFormItemIndex(form.getId());

  if (!footerNote) return;
  // Re-read: the deletions above shifted every item index on the form.
  form.getItems().filter(it => it.getTitle() === TEMPLATE_ITEM_TITLES.ADDITIONAL_NOTES)
    .forEach(it => {
      try {
        it.asParagraphTextItem().setHelpText(footerNote);
      } catch (err) {
        log(`ℹ️ Could not set the footer note on form ${form.getId()} (${err}).`);
      }
    });
}

/**
 * Writes one session table row per session in `group`. Each row takes its
 * Location and Calendar_Source from the SESSION, not from the group — on a
 * cross-location group those differ from row to row, and everything
 * downstream (Event_IDs, lunch policy, the lunch dashboard, triage) keys off
 * the row rather than the form.
 */
function writeEventRegistryRows(registrySheet, group, formInfo) {
  const headers = HEADERS.Master_Program_Dashboard;
  const map = getIndexMap(headers);
  // An appointment program's capacity is arithmetic, not a decision: however
  // many slots fit between the event's start and end IS how many people can be
  // seen. An explicit [Cap: N] still wins — a provider who wants to keep the
  // last half hour free says so — which is why this is resolved per session
  // rather than folded into group.capacity.
  const slotMinutes = resolveSlotMinutes(group);

  const rows = group.sessions.map(session => {
    const ev = session.event;
    const startTime = ev.getStartTime();
    const dateKey = formatDateKey(startTime);
    const eventId = computeEventId(session.calendarId, group.cleanTitle, dateKey);
    const row = new Array(headers.length).fill('');

    const endTime = ev.getEndTime();

    row[map['Event_Date']] = startTime;
    row[map['Location']] = session.locationName;
    row[map['Clean_Title']] = group.cleanTitle;
    // The end time is stored so Event_Time can show a RANGE — see
    // HEADERS.Master_Program_Dashboard and setEventTimeFormulas().
    row[map['Event_End']] = endTime || '';
    // Fallback only — renderProgramDashboard() always overwrites this with
    // a =TEXT(...) formula (see that function for why a formula is required
    // rather than a written time-like string).
    row[map['Event_Time']] = formatTimeRange(startTime, endTime);
    row[map['Type_Tag']] = group.typeTag;
    // Real checkbox columns: a boolean either way, never a blank. A blank cell
    // under a checkbox reads as "this row has no box", which is not what an
    // untagged program means — it means the box is there and unticked.
    row[map['Club']] = group.isClub ? CLUB_COLUMN_VALUE : false;
    row[map['No_Registration']] = group.noRegistration ? NO_REGISTRATION_COLUMN_VALUE : false;
    row[map['Personalized_Assistance']] = group.isAssistance ? ASSISTANCE_COLUMN_VALUE : false;
    row[map['Slot_Minutes']] = group.isAssistance ? slotMinutes : '';
    row[map['Max_Per_Month']] = group.maxPerMonth || '';

    // Capacity, per session. An appointment program's is arithmetic — one
    // person per slot (APPOINTMENT_SLOT_CAPACITY), so however many slots fit
    // between this event's start and end IS how many people can be seen.
    // Everything else takes the group's stated cap, or none.
    const slotCount = group.isAssistance
      ? buildAppointmentSlots(startTime, endTime, slotMinutes).length
      : 0;
    const capacity = group.isAssistance
      ? resolveAppointmentCapacity(group.capacity, slotCount, group.cleanTitle)
      : group.capacity;
    const isUncapped = !capacity || capacity <= 0;

    // ONE DATE'S OWN ANSWER, not the group's — see WAITLIST_ONLY_TAG. This is
    // the only column on the row read from `session` rather than from `group`,
    // because it is the only thing a calendar event can say about itself that
    // its siblings on the same form do not also say.
    row[map['Waitlist_Only']] = session.waitlistOnly ? WAITLIST_ONLY_COLUMN_VALUE : false;

    row[map['Max_Capacity']] = isUncapped ? '' : capacity;
    row[map['Active_Count']] = 0;
    // A session forced to the waitlist reads FULL from the moment it is
    // written, cap or no cap: nobody can take a place on it, so "🟢 Unlimited"
    // beside a form that waitlists everybody would be the sheet contradicting
    // itself. See recomputeCountsForZone(), which keeps saying so as the counts
    // move.
    row[map['Waitlist_Count']] = (isUncapped && !session.waitlistOnly) ? '' : 0;
    row[map['Remaining_Seats']] = session.waitlistOnly ? 0 : (isUncapped ? '' : capacity);
    row[map['Status']] = session.waitlistOnly
      ? WAITLIST_ONLY_STATUS
      : (isUncapped ? '🟢 Unlimited' : computeStatus(0, capacity));

    // formInfo is null for a [No Registration] group — there is no form to
    // link to, and the link columns say so in words rather than sitting empty.
    //
    // A formInfo carrying an ID but NO URLs is the third case: the group has a
    // form and we know which one, but this run could not open it to ask for
    // its address (see handleUnreachableGroupForm()). The link cells are left
    // EMPTY rather than filled with the [No Registration] words — that label
    // is a statement that the program takes no registration, which would be a
    // lie here, and "Repair Dashboard Links" deliberately skips every row
    // carrying it. Empty is the honest shape: a row with a form and no link
    // yet, which the repair will fill in the moment the form is reachable.
    row[map['Form_Response_Link']] = formInfo
      ? (formInfo.publishedUrl ? makeHyperlinkFormula(formInfo.publishedUrl, 'View Live Form') : '')
      : NO_REGISTRATION_LINK_LABEL;
    row[map['Edit_Form_Link']] = formInfo && formInfo.editUrl
      ? makeHyperlinkFormula(formInfo.editUrl, 'Edit Form Settings') : '';
    row[map['Form_ID']] = formInfo ? formInfo.formId : '';
    row[map['Calendar_Synced?']] = true;
    row[map['Event_ID']] = eventId;
    row[map['Calendar_Source']] = session.calendarId;
    return row;
  });

  if (rows.length > 0) {
    registrySheet.getRange(registrySheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    invalidateSectionedRowsCache(registrySheet); // rows the cached read has never seen
    invalidateEventTimeIndex(); // new sessions, and therefore new times to look up
  }
}

/** Moves any Registrant_Dash rows tied to a deleted event into the Triage tab. */
function moveRegistrantsToTriage(registrantsSheet, deletedEventInfo) {
  const headers = HEADERS.Registrant_Dash;
  const allRows = getSectionedRows(registrantsSheet, headers, 'Event_ID');
  const map = getIndexMap(headers);
  const tMap = getIndexMap(HEADERS.Deleted_Event_Triage);
  const flaggedNow = new Date();

  const keepRows = [];
  const newTriageRows = [];

  allRows.forEach(row => {
    const eventId = row[map['Event_ID']];
    const info = deletedEventInfo[eventId];
    if (!info) { keepRows.push(row); return; }

    const triageRow = new Array(HEADERS.Deleted_Event_Triage.length).fill('');
    headers.forEach(h => { if (tMap[h] !== undefined) triageRow[tMap[h]] = row[map[h]]; });
    triageRow[tMap['Deleted_Event_Title']] = info.cleanTitle;
    triageRow[tMap['Deleted_Event_Location']] = info.location;
    triageRow[tMap['Flagged_Date']] = flaggedNow;
    triageRow[tMap['Triage_Notes']] = 'Original calendar event no longer found during sync — please confirm with the registrant.';
    newTriageRows.push(triageRow);
  });

  if (newTriageRows.length === 0) return;

  renderRegistrantsSheet(false, keepRows);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triageSheet = getOrCreateSheet(ss, SHEET_NAMES.TRIAGE);
  const existingTriageRows = getSectionedRows(triageSheet, HEADERS.Deleted_Event_Triage, 'Event_ID');
  renderTriageSheet(false, existingTriageRows.concat(newTriageRows));

  log(`Moved ${newTriageRows.length} registrant row(s) to "${SHEET_NAMES.TRIAGE}".`);
  Object.keys(deletedEventInfo).forEach(eventId => {
    const info = deletedEventInfo[eventId];
    noteForAdmin('Deleted events sent to triage',
      `${info.cleanTitle} (${info.location}) — its calendar event is gone; registrants need confirming.`);
  });
}

/**
 * The inverse of moveRegistrantsToTriage(): puts triaged rows back on
 * Registrant_Dash for every session that is on the dashboard
 * again.
 *
 * Needed because a triage sweep is not recoverable from the forms. The import
 * only ever reads responses newer than the last sync, so a registration that
 * was already imported and then triaged exists nowhere else — moving the row
 * back IS the recovery. Rows for sessions that are still gone are left in
 * triage, and an identity already present on the Registrants tab is dropped
 * rather than duplicated.
 *
 * Run from the Apps Script editor. Returns the number of rows restored.
 */
function restoreTriagedRegistrants() {
  if (!requireAuthorizedAdmin('Restore Triaged Registrants')) return 0;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const triageSheet = ss.getSheetByName(SHEET_NAMES.TRIAGE);
  const registrySheet = ss.getSheetByName(SHEET_NAMES.PROGRAM_DASHBOARD);
  if (!triageSheet || !registrySheet) {
    log('restoreTriagedRegistrants: no triage tab or no dashboard — nothing to do.');
    return 0;
  }

  const triageHeaders = HEADERS.Deleted_Event_Triage;
  const regHeaders = HEADERS.Registrant_Dash;
  const tMap = getIndexMap(triageHeaders);
  const rMap = getIndexMap(regHeaders);

  const sessionRows = getSectionedRows(registrySheet, HEADERS.Master_Program_Dashboard, 'Event_ID');
  const sessionMap = getIndexMap(HEADERS.Master_Program_Dashboard);
  const liveEventIds = new Set(sessionRows.map(row => row[sessionMap['Event_ID']]).filter(Boolean));
  if (liveEventIds.size === 0) {
    log('restoreTriagedRegistrants: the session table is empty — import the calendar first, then run this again.');
    return 0;
  }

  const registrantsSheet = getOrCreateSheet(ss, SHEET_NAMES.REGISTRANT_DASH);
  const registrantRows = getSectionedRows(registrantsSheet, regHeaders, 'Event_ID');
  const present = new Set(registrantRows.map(row =>
    `${row[rMap['Event_ID']]}|${normalizeNameKey(row[rMap['Name']])}|${row[rMap['Person_Type']]}`));

  const triageRows = getSectionedRows(triageSheet, triageHeaders, 'Event_ID');
  const stayInTriage = [];
  const restored = [];

  triageRows.forEach(row => {
    const eventId = row[tMap['Event_ID']];
    if (!eventId || !liveEventIds.has(eventId)) { stayInTriage.push(row); return; }

    const key = `${eventId}|${normalizeNameKey(row[tMap['Name']])}|${row[tMap['Person_Type']]}`;
    if (present.has(key)) {
      log(`restoreTriagedRegistrants: ${row[tMap['Name']]} is already on the Registrants tab for this session — dropping the triaged copy.`);
      return;
    }

    // Triage is a superset of the registrant layout, so this copies by name.
    const restoredRow = new Array(regHeaders.length).fill('');
    regHeaders.forEach(h => { if (tMap[h] !== undefined) restoredRow[rMap[h]] = row[tMap[h]]; });
    const notes = String(restoredRow[rMap['Admin_Notes']] || '').trim();
    const stamp = `Restored from ${SHEET_NAMES.TRIAGE} on ${Utilities.formatDate(new Date(), TIMEZONE, 'M/d/yyyy')}.`;
    restoredRow[rMap['Admin_Notes']] = notes ? `${notes} | ${stamp}` : stamp;
    present.add(key);
    restored.push(restoredRow);
  });

  // A restore is somebody deliberately putting a row back. If that same
  // person-on-that-session had been deleted at some point, the tombstone would
  // silently block every later re-import of them — so lift it here, where the
  // intent is unambiguous. See section 5c.
  clearRegistrantTombstones(restored.map(row =>
    registrantTombstoneKey(row[rMap['Event_ID']], row[rMap['Name']], row[rMap['Person_Type']])));

  if (restored.length === 0) {
    log('restoreTriagedRegistrants: nothing in triage belongs to a session that is back.');
    return 0;
  }

  renderRegistrantsSheet(false, registrantRows.concat(restored));
  renderTriageSheet(false, stayInTriage);
  log(`restoreTriagedRegistrants: put ${restored.length} row(s) back on "${SHEET_NAMES.REGISTRANT_DASH}"; ` +
    `${stayInTriage.length} row(s) stay in triage (their session is still missing).`);
  toastIfPossible(`Restored ${restored.length} registrant row(s) from triage ✅`);
  return restored.length;
}

function backInjectCalendarDescriptions(group, formInfo) {
  // Config decides whether a link belongs in a description at all. Checked
  // here as well as in rewriteEventRegistrationLinks(), or the next sync would
  // simply put back every link that cleanup just removed.
  if (!shouldShowLinkInDescription()) {
    let cleared = 0;
    group.events.forEach(ev => {
      const existing = ev.getDescription() || '';
      const stripped = stripAllRegistrationLines(existing);
      // A notice counts as something to clear just as much as a link does:
      // "Hide link" means these descriptions carry nothing of ours at all.
      if ((stripped.removed === 0 && stripped.noticesRemoved === 0) || stripped.text === existing) return;
      ev.setDescription(stripped.text);
      cleared++;
    });
    if (cleared > 0) {
      log(`Link display is "${LINK_DISPLAY_OPTIONS.HIDE}" — removed the registration link from ${cleared} event(s) of "${group.cleanTitle}".`);
    }
    return;
  }

  const linkLine = buildRegistrationLinkLine(group, formInfo);
  let notYetOpenCount = 0;

  group.events.forEach(ev => {
    const existing = ev.getDescription() || '';

    // BEYOND THE HORIZON: the event exists, the form exists, but registration
    // has not opened for this date yet — so the description says so in words
    // instead of handing out a link. Decided per EVENT, not per group: a
    // [Grouped] series can straddle the horizon, and the sessions on the near
    // side of it stay open.
    if (shouldMarkNotYetOpen(ev.getStartTime())) {
      notYetOpenCount++;
      const stripped = stripAllRegistrationLines(existing);
      // Already exactly right — one notice, at the top, and no link anywhere
      // in the description. Same reasoning as the link fast path below: don't
      // burn a write (and the calendar notification that follows it) on every
      // sync of a season that was built months ago.
      if (existing.indexOf(REGISTRATION_NOT_OPEN_LINE) === 0 &&
        stripped.removed === 0 && stripped.noticesRemoved === 1) {
        return;
      }
      const updated = prependRegistrationLine(stripped.text, REGISTRATION_NOT_OPEN_LINE);
      if (updated !== existing) ev.setDescription(updated);
      return;
    }

    const found = findRegistrationLineInDescription(existing);
    const stripped = stripAllRegistrationLines(existing);

    // Already current, in the current format, already at the top — AND THE
    // ONLY ONE. Leave the event alone rather than burning a write (and a
    // calendar notification) on every sync.
    //
    // The last clause is what the first version of this check was missing.
    // "The first link in the description is the right one" says nothing about
    // what is UNDER it, so an event that also carried an older registration
    // line — the "Registration for … [Form: …]" sentence left over from when
    // links were hidden, or a stale horizon notice — took this fast path on
    // every sync and kept both forever. One strip (pure string work, and the
    // rebuild below needs it anyway) settles it: exactly one registration line
    // in the whole description, no notice, and nothing to do.
    if (found && !found.isLegacy && found.url === formInfo.publishedUrl &&
      found.formId === formInfo.formId && existing.indexOf(linkLine) === 0 &&
      stripped.removed === 1 && stripped.noticesRemoved === 0) {
      return;
    }

    // Otherwise rebuild: every link out (duplicates included — see
    // stripAllRegistrationLines), one back in AT THE TOP. Replacing in place
    // was what let a second, mangled copy sit in a description untouched
    // forever, since the first match was always the one that got corrected.
    // A stale notice from a horizon that has since moved comes off here too.
    const updated = prependRegistrationLine(stripped.text, linkLine);
    if (updated !== existing) ev.setDescription(updated);
  });

  if (notYetOpenCount > 0) {
    log(`"${group.cleanTitle}": ${notYetOpenCount} event(s) are past the registration horizon ` +
      `(${describeRegistrationHorizon()}) — they read "${REGISTRATION_NOT_OPEN_TEXT}" instead of a link.`);
  }
}


