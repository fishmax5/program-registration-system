// ============================================================================
// 4. CALENDAR SYNC & FORM GENERATION  (syncCalendars)
// ============================================================================

function computeSyncDateRange() {
  const today = new Date();
  const target = new Date(today);
  target.setDate(target.getDate() + SYNC_LOOKAHEAD_DAYS);

  const start = new Date(today.getFullYear(), today.getMonth(), 1, 0, 0, 0);
  const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59);
  return { start, end };
}

/** A leading "*" on the title marks an event TENTATIVE — see parseEventTitle(). */
const TENTATIVE_TITLE_PREFIX = '*';

/** Every bracketed group in a string: "[Cap: 12] [Grouped]" and "[Cap: 12, Grouped]" both work. */
const BRACKET_GROUP_REGEX = /\[([^\]]*)\]/g;

/**
 * Every tag/setting this system recognizes, as patterns that can be REMOVED
 * from a bracket's text. Used only by isTagOnlyBracket() — the parser proper
 * still reads each setting with its own regex above.
 *
 * Order matters only in that a longer form must be stripped before a shorter
 * one it contains ("Max Per Month: 1" before "Monthly" would match nothing,
 * but "Cap: 12" must go before a bare number could confuse anything).
 */
defineLazyGlobal_('RECOGNIZED_TAG_PATTERNS', () => ([
  /Cap:\s*\d+/i,
  /Max\s*Per\s*Month:\s*\d+/i,
  /Slots?:\s*\d+/i,
  SHARED_LOCATION_WORDS_REGEX,
  CLUB_WORDS_REGEX,
  NO_REGISTRATION_WORDS_REGEX,
  ASSISTANCE_WORDS_REGEX,
  /\b(Grouped|Fixed)\b/i,
  /\b(Monthly|Regular)\b/i
]));

/**
 * Is this bracket's contents ENTIRELY tags this system understands?
 *
 * WHY THIS EXISTS. Every tag used to be detected by testing its regex against
 * the whole bracket, so a bracket only had to CONTAIN one of these words to
 * switch the setting on. The words are ordinary English — Club, Combined,
 * Shared, Regular, Appointments, Drop-In — and staff are explicitly told to
 * put clarifying notes in the event description. The two instructions
 * collided, silently and in the worst direction:
 *
 *   "[Film Club selection: Casablanca]"   -> gave the program a standing
 *                                            club roster
 *   "[Drop-in welcome]"                   -> deleted its registration form
 *   "[Combined with the JCC]"             -> pooled it onto one form with
 *                                            every other location
 *   "[Call the office for an appointment]"-> turned it into 30-minute
 *                                            appointment slots
 *
 * None of those announced themselves; the file's own comment promised the
 * opposite ("unrecognized bracket contents are ignored"). This is what makes
 * that promise true.
 *
 * THE RULE: strip every recognized tag out of the text. If what is left is
 * nothing but separators, the bracket was a tag list and is honoured. If any
 * real words survive, it was a sentence and the WHOLE bracket is left alone —
 * including the tag-looking word inside it, because "Film Club selection" is
 * not a request for a club roster and honouring half of it is worse than
 * honouring none.
 *
 * Whole-bracket, not per-word: that is what keeps "[Cap: 12, Grouped]" and
 * "[Cap: 12 Grouped]" both working while rejecting the prose above.
 */
/**
 * WHAT THIS SCRIPT WROTE IS NOT WHAT COMES BACK OUT — the same fact the
 * registration-notice patterns are built around (see
 * REGISTRATION_NOTICE_STAMP), applied to the brackets.
 *
 * Google Calendar re-encodes a description whenever anybody edits the event in
 * the web UI. A tag this script wrote as "[Personalized Assistance]" comes back
 * as "[Personalized&nbsp;Assistance]", sometimes wrapped in <div> or with a
 * stray <br> in it. `\s+` does not match "&nbsp;", so the bracket stopped
 * matching ASSISTANCE_WORDS_REGEX, isTagOnlyBracket() read it as prose, and the
 * tag disappeared — from a description that still SAYS the tag when you look at
 * the event. The failure is invisible in the place a person would go to check.
 *
 * So every read of a bracket's contents goes through here first: entities back
 * to the characters they stand for, tags out, whitespace collapsed. Reading
 * only — setFlagBracketInDescription() still writes back whatever shape the
 * description is already in.
 */
function normalizeBracketContent(content) {
  return String(content || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#0*160;|&#x0*a0;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTagOnlyBracket(content) {
  let remaining = normalizeBracketContent(content);
  if (!remaining.trim()) return false;
  RECOGNIZED_TAG_PATTERNS.forEach(pattern => {
    // A fresh non-global copy: several of these constants are shared, and a
    // /g cursor left behind by another caller would skip matches here.
    const scan = new RegExp(pattern.source, 'gi');
    remaining = remaining.replace(scan, ' ');
  });
  // Separators are all that may be left: commas, semicolons, slashes, plus
  // signs, dashes and whitespace are how people join tags together.
  return !/[^\s,;/+&|-]/.test(remaining);
}

/**
 * Pulls the settings this system understands out of any bracketed groups
 * in a blob of text:
 *   [Cap: 12]            -> capacity 12
 *   [Grouped]            -> one form for the whole series (see EVENT_TYPES)
 *   [Regular]            -> one form per calendar month (the default anyway)
 *   [Cap: 12, Grouped]   -> both, one bracket
 *   [All Locations]      -> this event's sessions pool with the same-titled
 *                           sessions on every other calendar, onto ONE form
 *                           (see SHARED_LOCATION_SCOPE). Also spelled
 *                           [Shared] / [All Sites] / [Combined] / [Multi-Site].
 *   [Club]               -> this program keeps a standing membership; people
 *                           sign up once and stay signed up (see CLUB_TAG).
 *                           Composes with all of the above:
 *                           [Club, Grouped], [Club, Cap: 12, All Locations]…
 *
 * [Fixed] is still read as [Grouped] and [Monthly] as [Regular], so
 * descriptions written before the rename keep working untouched — there is
 * nothing to go back and edit.
 *
 * Unrecognized bracket contents are ignored, so people can bracket other
 * notes in a description without confusing anything.
 */
function parseSettingsBrackets(text) {
  const raw = String(text || '');
  let capacity = 0;
  let isFixed = false;
  let isShared = false;
  let isClub = false;
  let noRegistration = false;
  let isAssistance = false;
  // 0 = "not stated"; the caller falls back to APPOINTMENT_SLOT_MINUTES.
  let slotMinutes = 0;
  // 0 = "no limit". See ASSISTANCE_TAG — Gerry will not see the same person
  // twice in a month, and that is a fact about the program, not about a form.
  let maxPerMonth = 0;
  let sawAny = false;
  // '' | 'Grouped' | 'Regular' — what the text SAYS about grouping, as opposed
  // to what isFixed resolves to. The difference matters only to
  // resolveEventSettings(), and only for the one setting that has a spelling
  // for "off": an explicit [Regular] has to be able to override a legacy
  // [Grouped] left behind in the title, and `isFixed === false` cannot tell
  // "it says Regular" apart from "it says nothing".
  let explicitGrouping = '';

  BRACKET_GROUP_REGEX.lastIndex = 0; // the /g regex is module-level; never trust its cursor
  let match;
  while ((match = BRACKET_GROUP_REGEX.exec(raw)) !== null) {
    const rawContent = match[1] || '';
    // A BRACKET IS EITHER ALL TAGS OR ALL PROSE — see isTagOnlyBracket(). Staff
    // are told to put clarifying notes in the description, and a note that
    // happens to contain one of these words ("[Film Club selection:
    // Casablanca]", "[Drop-in welcome]", "[Combined with the JCC]") must not
    // reconfigure the program behind their back.
    if (!isTagOnlyBracket(rawContent)) {
      log(`ℹ️ Ignoring "[${rawContent}]" — it reads as a note, not a tag. A bracket only sets something ` +
        `when the WHOLE bracket is tags (e.g. "[Club]", "[Cap: 12, Grouped]"); anything else is left alone.`);
      continue;
    }
    // Read from the NORMALIZED text, matching the test just made of it: a
    // description that has been edited in the Calendar web UI comes back with
    // "&nbsp;" where this script wrote a space, and every regex below wants
    // \s — see normalizeBracketContent().
    const content = normalizeBracketContent(rawContent);
    const capMatch = /Cap:\s*(\d+)/i.exec(content);
    if (capMatch) { capacity = parseInt(capMatch[1], 10); sawAny = true; }
    // The WHERE half of grouping, orthogonal to Grouped/Regular above — see
    // SHARED_LOCATION_SCOPE.
    if (SHARED_LOCATION_WORDS_REGEX.test(content)) { isShared = true; sawAny = true; }
    // Orthogonal to BOTH of the above — see CLUB_TAG. Read from the same
    // bracket or its own, so [Club, Grouped] and [Club] [Grouped] both work.
    if (CLUB_WORDS_REGEX.test(content)) { isClub = true; sawAny = true; }
    // Orthogonal to everything above, and the one that overrides them all —
    // see NO_REGISTRATION_TAG. There is no form to group, cap or share.
    if (NO_REGISTRATION_WORDS_REGEX.test(content)) { noRegistration = true; sawAny = true; }
    // Orthogonal to everything above except [No Registration] — see
    // ASSISTANCE_TAG. Read BEFORE the slot length, because "[Slots: 20]" on
    // its own is a statement about appointments and therefore says the
    // program is one, whether or not the word was typed.
    if (ASSISTANCE_WORDS_REGEX.test(content)) { isAssistance = true; sawAny = true; }
    const slotMatch = /Slots?:\s*(\d+)/i.exec(content);
    if (slotMatch) {
      const minutes = parseInt(slotMatch[1], 10);
      sawAny = true;
      isAssistance = true;
      // Out-of-range is a typo ("[Slots: 3]" for a three-o-clock start), and
      // silently honoring it would cut an afternoon into a hundred pieces.
      if (minutes >= MIN_APPOINTMENT_SLOT_MINUTES && minutes <= MAX_APPOINTMENT_SLOT_MINUTES) {
        slotMinutes = minutes;
      } else {
        log(`⚠️ Ignoring "[Slots: ${minutes}]" — an appointment must be between ` +
          `${MIN_APPOINTMENT_SLOT_MINUTES} and ${MAX_APPOINTMENT_SLOT_MINUTES} minutes. ` +
          `Using ${APPOINTMENT_SLOT_MINUTES}.`);
      }
    }
    const perMonthMatch = /Max\s*Per\s*Month:\s*(\d+)/i.exec(content);
    if (perMonthMatch) { maxPerMonth = parseInt(perMonthMatch[1], 10); sawAny = true; }
    // "Grouped" is the current word, "Fixed" the one it replaced — both mean
    // "one form for the whole series." An explicit [Regular]/[Monthly] is
    // recognized too, purely so it counts as sawAny (a deliberate statement
    // of the default) rather than reading as an unrecognized note.
    if (/\b(Grouped|Fixed)\b/i.test(content)) { isFixed = true; sawAny = true; explicitGrouping = EVENT_TYPES.GROUPED; }
    if (/\b(Monthly|Regular)\b/i.test(content)) {
      sawAny = true;
      // Only when nothing has already said Grouped: "[Grouped] [Regular]" on
      // one event is a contradiction, and the more specific instruction
      // (share one form) is the safer reading of it.
      if (!explicitGrouping) explicitGrouping = EVENT_TYPES.REGULAR;
    }
  }
  return { capacity, isFixed, isShared, isClub, noRegistration, isAssistance, slotMinutes,
    maxPerMonth, sawAny, explicitGrouping };
}

/**
 * Parses event titles. The title is now just the program name, optionally
 * prefixed with "*":
 *   "Yoga Basics"    -> a program
 *   "*Yoga Basics"   -> the same program, TENTATIVE (see below)
 *
 * BOTH capacity and Grouped-vs-Regular now live in the event DESCRIPTION —
 * see parseSettingsBrackets() / resolveEventSettings(). The title is what
 * attendees read on a shared calendar, and "[Cap: 12, Fixed]" there is
 * internal scheduling jargon. Brackets left in a title are still read as a
 * legacy fallback (and logged) so existing calendars don't silently lose
 * their capacity, but they're stripped from cleanTitle either way.
 *
 * A title beginning with "*" marks the event TENTATIVE: it is skipped
 * entirely by the form/registry pipeline until the asterisk is removed
 * (see syncCalendarsInternal()). The asterisk is stripped from cleanTitle,
 * which matters a lot — computeEventId() keys off cleanTitle, so an event's
 * ID is IDENTICAL before and after it is confirmed. Un-asterisking is
 * therefore just "a new event appears," with no ID churn.
 */
function parseEventTitle(title) {
  let raw = String(title || '').trim();
  if (!raw) return null;

  let isTentative = false;
  while (raw.charAt(0) === TENTATIVE_TITLE_PREFIX) {
    isTentative = true;
    raw = raw.substring(1).trim();
  }
  if (!raw) return null;

  const legacy = parseSettingsBrackets(raw);
  // Strip every bracketed group, wherever it sits, so the clean title is
  // stable no matter how someone spaced things out.
  const cleanTitle = raw.replace(BRACKET_GROUP_REGEX, ' ').replace(/\s+/g, ' ').trim();
  if (!cleanTitle) return null;

  return {
    cleanTitle,
    isTentative,
    legacyCapacity: legacy.capacity,
    legacyIsFixed: legacy.isFixed,
    legacyIsShared: legacy.isShared,
    legacyIsClub: legacy.isClub,
    legacyNoRegistration: legacy.noRegistration,
    legacyIsAssistance: legacy.isAssistance,
    legacySlotMinutes: legacy.slotMinutes,
    legacyMaxPerMonth: legacy.maxPerMonth,
    hasLegacyBrackets: legacy.sawAny
  };
}

/**
 * Resolves { capacity, isFixed, isShared, isClub, noRegistration } for one event: the
 * DESCRIPTION's brackets win, and anything the description doesn't specify
 * falls back to legacy brackets left in the title (with a one-time nudge in
 * the log).
 */
function resolveEventSettings(event, parsedTitle) {
  const description = (event && typeof event.getDescription === 'function')
    ? (event.getDescription() || '')
    : '';
  const fromDescription = parseSettingsBrackets(description);

  const capacity = fromDescription.capacity || parsedTitle.legacyCapacity || 0;
  // Grouping is the ONE setting with a spelling for "off", so it is the one
  // the description can actively contradict rather than merely not mention:
  // an explicit [Regular] here beats a [Grouped] still sitting in the title.
  // Without this, moving a program to Regular in the description does nothing
  // at all until someone also finds and deletes the legacy title bracket —
  // the "I changed it and it changed itself back" failure, one layer down.
  const isFixed = fromDescription.explicitGrouping
    ? fromDescription.explicitGrouping === EVENT_TYPES.GROUPED
    : (parsedTitle.legacyIsFixed || false);
  const isShared = fromDescription.isShared || parsedTitle.legacyIsShared || false;
  const isClub = fromDescription.isClub || parsedTitle.legacyIsClub || false;
  const noRegistration = fromDescription.noRegistration || parsedTitle.legacyNoRegistration || false;
  const isAssistance = fromDescription.isAssistance || parsedTitle.legacyIsAssistance || false;
  const slotMinutes = fromDescription.slotMinutes || parsedTitle.legacySlotMinutes || 0;
  const maxPerMonth = fromDescription.maxPerMonth || parsedTitle.legacyMaxPerMonth || 0;

  if (parsedTitle.hasLegacyBrackets && !fromDescription.sawAny) {
    log(`ℹ️ "${parsedTitle.cleanTitle}" still carries its settings in the TITLE. That still works, but the supported ` +
      `place is now the event DESCRIPTION — move "[Cap: N]" / "[Grouped]" / "[Club]" there and drop them from the title.`);
  }
  return { capacity, isFixed, isShared, isClub, noRegistration, isAssistance, slotMinutes, maxPerMonth };
}

/**
 * Every field resolveEventSettings() answers, named once so that nothing has
 * to re-list them — see assignEventSettings() for what re-listing them cost.
 */
const EVENT_SETTING_KEYS =
  ['capacity', 'isFixed', 'isShared', 'isClub', 'noRegistration', 'isAssistance', 'slotMinutes', 'maxPerMonth'];

/**
 * Copies a resolveEventSettings() answer onto a parseEventTitle() result, and
 * returns it.
 *
 * Exists because the copy used to be written out field by field in
 * buildGroupsForWindow(), and three fields were missing from that list. A
 * setting the description states, the parser reads and the group never sees is
 * indistinguishable from a setting nobody typed — and worse than that, because
 * the flag reconciler treats "the calendar does not say so" as an instruction
 * to untick the box. See the comment at the call site.
 */
function assignEventSettings(target, settings) {
  EVENT_SETTING_KEYS.forEach(key => { target[key] = settings[key]; });
  return target;
}

