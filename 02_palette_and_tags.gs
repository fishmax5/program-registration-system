// ============================================================================
// THE PALETTE  (one place; every color in the workbook comes from here)
// ============================================================================
//
// THREE LAYERS, SEPARATED BY SATURATION RATHER THAN BY HUE ALONE. That is the
// whole idea, and it is what the previous arrangement got wrong.
//
// Colors used to be picked per feature, each one sensible on its own, with a
// comment asserting that the location, month and status families were kept to
// different hue bands. They were not: #D9EAD3 was simultaneously "Ashbridge",
// "Open", "Active" and "Needed", and #FCE5CD was both "Narberth" and
// "Waitlisted". So a green cell meant a place in one column and a state in the
// next, and the peach on a Narberth row was the same peach that means somebody
// did not get a seat. On a tab people scan rather than read, a color that means
// two things is worse than no color: it is a fact that is wrong at a glance.
//
// The fix is not to move locations to new hues — staff know Narberth is the
// peach one, and relearning that costs more than it buys. It is to give each
// layer its own WEIGHT:
//
//   TINT   (locations, months) — very pale washes. A background band saying
//          where and when. Never competes with text.
//   SIGNAL (statuses) — saturated. The alert layer: full, waitlisted,
//          cancelled. Meant to be found from across a desk.
//   INK / SURFACE (banners, headers, stripes) — the structural neutrals.
//
// A pale green location band and a saturated green status chip are now
// obviously different objects even though both are green, which is what lets
// the hue keep its old meaning without the ambiguity.
const PALETTE = {
  // --- Structural neutrals ------------------------------------------------
  // Banners deepened for contrast: white 13px on the old #3C78D8 sat around
  // 3.4:1, which is under the 4.5:1 body-text bar and read as washed out on
  // the projector the lunch dashboard gets shown on.
  BANNER_HERO_BG: '#14448A',
  BANNER_BG: '#2C6BC4',
  HEADER_BG: '#33404D',   // slate, not near-black: a header band, not a rule
  INK_STRONG: '#0B3D6B',
  INK_MUTED: '#5F6B7A',
  PAPER: '#FFFFFF',
  // The zebra stripe. #F6F6F6 against white is a ~2% step — technically a
  // stripe, invisible in practice, which is why rows still had to be traced
  // with a finger. A cool 5% step reads as banding without becoming a block.
  STRIPE: '#F0F4F8',
  RULE: '#B7B7B7',
  DISABLED: '#E4E7EB',    // "not applicable" / superseded — grey, never a hue

  // --- TINT layer: locations (pale washes, hue kept from the old scheme) ---
  LOC_PEACH: '#FDEFE3',
  LOC_GREEN: '#E9F3E4',
  LOC_LILAC: '#ECE8F5',
  LOC_BLUE: '#E4EDF8',    // fallback band for a location not named below

  // --- TINT layer: months (teal / gold / magenta, paler than any signal) ---
  MONTH_TEAL_1: '#DFF1EE', MONTH_TEAL_2: '#CBE8E2', MONTH_TEAL_3: '#B7DFD4',
  MONTH_GOLD_1: '#F8F4DC', MONTH_GOLD_2: '#F2EBC6', MONTH_GOLD_3: '#EBE1AE',
  MONTH_MAGENTA_1: '#F7DEEE', MONTH_MAGENTA_2: '#F0C8E2', MONTH_MAGENTA_3: '#E8B2D6',

  // --- SIGNAL layer: statuses (saturated; black text still clears 4.5:1) ---
  SIGNAL_GREEN: '#A5D68F',
  SIGNAL_GREEN_DEEP: '#7FC96A',
  SIGNAL_AMBER: '#FFD466',
  SIGNAL_ORANGE: '#FBC38A',
  SIGNAL_RED: '#F09A9A',
  SIGNAL_GOLD: '#FFD966',  // the order-ahead flag — a mark, not a state

  // --- The hand-entry wash: the one place yellow means "type here" ---------
  ENTRY_HEADER: '#FFF2CC',
  ENTRY_TINT: '#FFFCF0',

  // --- HANDLING washes: what happens to somebody's MEAL (45_sign_in_sheet) --
  // Two, and only two, because a sign-in sheet with five colours on it has
  // none. Yellow is "this meal leaves the building", purple is "this meal
  // needs doing something with here" (fridge, freezer, collected by somebody
  // else). Both are pale enough that 11pt black over them still clears 4.5:1,
  // because these wash a WHOLE ROW of a document somebody reads standing up.
  // Distinct from ENTRY_HEADER's yellow, which means "type here" on a sheet
  // and never appears on the same page as these.
  HANDLING_TAKEOUT: '#FFF3B0',
  HANDLING_SPECIAL: '#E7DBF3',

  // --- Tab strip. Deliberately a step STRONGER than anything on a sheet ----
  // A tab is read against Sheets' own grey chrome, not against paper, so the
  // tint layer disappears down there. These say TODAY / SET UP / LISTS /
  // ARCHIVE at a glance — see TAB_GROUPS.
  TAB_TODAY: '#93C47D',
  TAB_SETUP: '#6FA8DC',
  TAB_LISTS: '#FFD966',
  TAB_ARCHIVE: '#B7B7B7'
};

/**
 * Hardcoded soft colors per "Month Year" label — used to tint the Event_Date
 * cell itself now (there is no separate Month column anywhere anymore).
 * Deliberately picked from TEAL / GOLD / MAGENTA families — NOT green,
 * peach/orange, or lavender (LOCATION_COLOR_MAP's families), and NOT
 * green/red (status colors). Any month not listed falls back to
 * getMonthColor()'s deterministic generator, which draws from the same three
 * safe hue bands.
 *
 * These are the TINT layer (see PALETTE): they wash one cell behind a date and
 * must never read as loudly as a status does.
 */
const MONTH_COLOR_MAP = {
  'January 2026': PALETTE.MONTH_TEAL_1,
  'February 2026': PALETTE.MONTH_GOLD_1,
  'March 2026': PALETTE.MONTH_MAGENTA_1,
  'April 2026': PALETTE.MONTH_TEAL_2,
  'May 2026': PALETTE.MONTH_GOLD_2,
  'June 2026': PALETTE.MONTH_MAGENTA_2,
  'July 2026': PALETTE.MONTH_TEAL_3,
  'August 2026': PALETTE.MONTH_GOLD_3,
  'September 2026': PALETTE.MONTH_MAGENTA_3,
  'October 2026': PALETTE.MONTH_TEAL_2,
  'November 2026': PALETTE.MONTH_GOLD_3,
  'December 2026': PALETTE.MONTH_MAGENTA_3
};

/**
 * Column sizing. Every column is autofitted and then padded out to this
 * multiple of its fitted width, so text never sits flush against the cell
 * edge and a dropdown arrow never overlaps the value under it.
 *
 * The MAX clamp is load-bearing, not decoration: autofit on a long
 * Admin_Notes or "Programs Today" cell already produces a very wide column,
 * and 130% of "very wide" is unusable. The MIN keeps a column of 0/1 counts
 * from collapsing to a sliver. Both are in pixels; tune here and re-run
 * resizeAllSheets() to apply to existing tabs.
 */
const COLUMN_WIDTH_BUFFER_MULTIPLIER = 1.3;
const MIN_COLUMN_WIDTH_PX = 60;
const MAX_COLUMN_WIDTH_PX = 400;

// Status color palettes — the SIGNAL layer (see PALETTE). Saturated on
// purpose: these are the cells somebody is looking FOR, and they used to be
// the same pale washes as the location bands they sat beside.
const EVENT_STATUS_COLORS = {
  '🟢 Open': PALETTE.SIGNAL_GREEN,
  '🟡 Almost Full': PALETTE.SIGNAL_AMBER,
  '🔴 Waitlist Only': PALETTE.SIGNAL_RED,
  // A step deeper than Open, not a different hue: "unlimited" is "open, more
  // so", and giving it a hue of its own would have implied a third state.
  '🟢 Unlimited': PALETTE.SIGNAL_GREEN_DEEP
};

const REGISTRANT_STATUS_COLORS = {
  'Cancelled': PALETTE.SIGNAL_RED,
  // ORANGE, not the peach it used to be. That peach was Narberth's location
  // color to the pixel, so a Narberth row and a waitlisted person were the
  // same wash sitting two columns apart.
  'Waitlisted': PALETTE.SIGNAL_ORANGE,
  'Active': PALETTE.SIGNAL_GREEN,
  'Needed': PALETTE.SIGNAL_GREEN,
  // A newer submission from the same person/event superseded this row — see
  // buildRegistrantRow()/supersedeRegistrantRow(). Grey (shared with
  // NA_CELL_COLOR) so it reads as "historical," not cancelled/waitlisted.
  'Superseded': PALETTE.DISABLED
};

const MANUAL_OVERRIDE_COLOR = PALETTE.LOC_LILAC;
const ORDER_AHEAD_FLAG_COLOR = PALETTE.SIGNAL_GOLD;
const NA_CELL_COLOR = PALETTE.DISABLED;
/** Grey used on a Lunch_Schedule/Master_Lunch_Dashboard Type cell reading "Not Serving". */
const NOT_SERVING_COLOR = '#D9D9D9';

// Day_1_In-Person / Day_1_Takeaway / Subs_In-Person / Subs_Takeaway / In_Fridge
// used to be hand-typed here too, but are now tallied automatically from the
// Registrants tab's five per-person meal counts (see
// REGISTRANT_MEAL_COUNT_COLUMNS and buildDashboardRollup()) — the same way
// Served_Confirmed already worked — so they're no longer offered as manual
// entry and get the protectDerivedColumns() warning instead (see
// writeMasterLunchDashboardSheet()).
// Standard_Buffer/Tester_Buffer are no longer hand-entry either, for a
// different reason: they are a CONFIG setting, not an observation. Offering
// them as yellow "type here" columns invited staff to change an ordering
// buffer on one row and expect it to mean something, while the value shown was
// whatever happened to be written when the row was first created — which for
// any date with no registrations yet was a hard-coded 0, hence the column of
// zeroes. updateMasterLunchDashboard() now re-reads both from Config on every
// render (see HEADERS.Master_Lunch_Dashboard).
const LUNCH_DASHBOARD_MANUAL_COLUMNS = [
  'Actual_Ordered', 'Total_Consumed', 'Thrown_Away', 'Discrepancy'
];

/**
 * Nothing on the lunch dashboard is a machine-only key, so nothing is hidden
 * today — the buffer/consumption columns were moved to the END of the row
 * instead (see HEADERS.Master_Lunch_Dashboard), which keeps them reachable
 * while getting them out from between the numbers staff actually order
 * against. The constant exists so the decision has one place to live.
 */
const LUNCH_DASHBOARD_HIDDEN_COLUMNS = [];

/**
 * Program_Sessions: the session table is rebuilt from the calendar
 * every render, so the only cells a human can usefully change are the ones
 * handleProgramDashboardEdit() writes back to the calendar — Type_Tag and the
 * two flag checkboxes (Club, No_Registration; see PROGRAM_FLAG_COLUMNS).
 * Location is a dropdown for readability but is equally calendar-derived, so
 * it is NOT advertised as editable.
 *
 * NOT given the yellow manual-entry treatment the other tabs' editable
 * columns get — see writeProgramDashboardSheet(). Kept as the single named
 * list of "what a human may change here", which is what
 * protectDerivedColumns() is defined against.
 */
// Spelled out rather than derived from PROGRAM_FLAG_COLUMNS: that list is
// declared further down this file, and a top-level const cannot read another
// one that has not been evaluated yet.
// Waitlist_Only is on this list and NOT in PROGRAM_FLAG_COLUMNS, which is the
// difference between "a human may change this here" and "this flag describes a
// whole program": it is ticked one session at a time. See WAITLIST_ONLY_TAG.
const PROGRAM_DASHBOARD_EDITABLE_COLUMNS =
  ['Type_Tag', 'Club', 'No_Registration', 'Personalized_Assistance', 'Waitlist_Only'];

/**
 * Internal plumbing on the program dashboard: the raw IDs and the duplicate
 * link column. Form_Response_Link ("View Live Form") stays visible — it is the
 * link staff actually hand out — while Edit_Form_Link and the bare Form_ID are
 * for troubleshooting only.
 */
const PROGRAM_DASHBOARD_HIDDEN_COLUMNS = ['Form_ID', 'Event_ID', 'Calendar_Source', 'Calendar_Synced?', 'Event_End', 'Slot_Minutes', 'Max_Per_Month'];
const MANUAL_ENTRY_HEADER_COLOR = PALETTE.ENTRY_HEADER;
const MANUAL_ENTRY_CELL_TINT = PALETTE.ENTRY_TINT;
/**
 * Prepended to a hand-entry column's HEADER CELL by labelManualEntryColumns().
 * Purely decorative — normalizeHeaderText() strips it back off, which is what
 * keeps 'Standard_Buffer' usable as Master_Lunch_Dashboard's header-row marker.
 */
const MANUAL_ENTRY_PREFIX = '✍️';

const MANUAL_OVERRIDE_OPTIONS = ['Auto-Synced', 'Manually Edited', 'Manually Added'];
// 'Superseded' marks a row from an identity (Event_ID + Name + Person_Type)
// that has since submitted again under a different Party_ID — see
// buildRegistrantRow(). It's deliberately excluded from every active/
// waitlist count (scanRegistrants(), buildEventCountsFromRegistrants(),
// buildDashboardRollup() all key off 'Active'/'Waitlisted' by name) without
// needing any special-casing there.
const PROGRAM_STATUS_OPTIONS = ['Active', 'Waitlisted', 'Cancelled', 'Superseded'];
const LUNCH_STATUS_OPTIONS = ['Needed', 'No Lunch', 'Waitlisted', 'Cancelled', 'Superseded'];
/**
 * What a program's Type_Tag says about how its sessions are grouped onto ONE
 * registration form:
 *
 *   GROUPED  every session of the series shares a single form, however many
 *            months it spans. Was called "Fixed".
 *   REGULAR  the ordinary case: sessions are bundled per calendar month, so a
 *            new month means a new form. Was called "Monthly".
 *
 * WHY "REGULAR" AND NOT "MONTHLY". "Monthly" reads as a statement about how
 * often the program MEETS — and it is not one. A program tagged this way can
 * meet twice a week; what the tag actually says is "nothing special, hand out
 * a fresh form each month", which is the default every program gets unless
 * somebody asks for otherwise. Staff read the column as a schedule and were
 * routinely wrong about it. "Regular" says the same thing about the form
 * without claiming anything about the calendar.
 *
 * EVERY SPELLING IS READ EVERYWHERE, forever: normalizeTypeTag() maps
 * Fixed->Grouped and Monthly->Regular, so session rows written by earlier
 * versions, and `[Fixed]` or `[Monthly]` still sitting in a calendar
 * description, keep working with no migration step. Only what this script
 * WRITES changes.
 */
const EVENT_TYPES = {
  GROUPED: 'Grouped',
  REGULAR: 'Regular'
};
const EVENT_TYPE_OPTIONS = [EVENT_TYPES.GROUPED, EVENT_TYPES.REGULAR];

/** Legacy Type_Tag spellings -> current ones. */
const LEGACY_EVENT_TYPE_ALIASES = {
  fixed: EVENT_TYPES.GROUPED,
  monthly: EVENT_TYPES.REGULAR
};

/**
 * Canonical Type_Tag for a value read from a sheet, a description, or
 * anywhere else. Unrecognized input falls back to REGULAR — the narrower
 * grouping, so a typo can never silently merge unrelated months onto one
 * form.
 */
function normalizeTypeTag(value) {
  const raw = String(value || '').trim();
  if (!raw) return EVENT_TYPES.REGULAR;
  const lower = raw.toLowerCase();
  if (LEGACY_EVENT_TYPE_ALIASES[lower]) return LEGACY_EVENT_TYPE_ALIASES[lower];
  const match = EVENT_TYPE_OPTIONS.filter(t => t.toLowerCase() === lower)[0];
  return match || EVENT_TYPES.REGULAR;
}

/** True when this Type_Tag means "one form for the whole series" (either spelling). */
function isGroupedTypeTag(value) {
  return normalizeTypeTag(value) === EVENT_TYPES.GROUPED;
}

/**
 * CROSS-LOCATION PROGRAMS — the [All Locations] tag.
 *
 * Grouping has always had two dimensions, but only one of them was sayable:
 * WHEN sessions share a form ([Grouped] = the whole series, [Regular] = a
 * month at a time). WHERE was fixed — the group key started with the calendar
 * ID, so the same program running at Narberth and at Ashbridge always got two
 * separate forms, even when it is one program with one roster that simply
 * meets in two rooms.
 *
 * `[All Locations]` in an event's DESCRIPTION opens up the second dimension:
 * that event's sessions pool with the same-titled sessions on EVERY other
 * program calendar, onto one form. It composes with the existing tags rather
 * than replacing them —
 *
 *   [Grouped, All Locations]  one form for the whole series, everywhere
 *   [Regular, All Locations]  one form per calendar month, everywhere
 *   [Cap: 12, All Locations]  ...and the cap still applies PER SESSION
 *
 * — because it only changes the SCOPE half of the group key
 * (SHARED_LOCATION_SCOPE in place of the calendar ID; see buildEventGroups()).
 *
 * The tag is read per EVENT, exactly like [Cap: N] and [Grouped]: an event
 * that carries it joins the shared form, one that doesn't keeps its own
 * per-location form. That makes a half-tagged program a describable state
 * rather than an ambiguous one — and since it is nearly always a mistake,
 * warnAboutPartiallySharedPrograms() says so out loud.
 *
 * WHAT A SHARED FORM HAS TO DO DIFFERENTLY. Its dates are no longer all at
 * one place, so:
 *   - every date label names its location (formatSessionLabel()), which is
 *     also what keeps two locations' sessions on the SAME day from collapsing
 *     into one grid row or one registry-index key;
 *   - lunch is decided per date+location as it always was (isLunchOfferedOn),
 *     so a Never-catering location's dates simply never reach the lunch grid,
 *     and the lunch questions come off only when NO location on the form
 *     caters;
 *   - the footer note and the form description list every location involved.
 * Everything downstream — Event_IDs, registrant rows, counts, the lunch
 * dashboard — is already keyed per session, and a session still knows exactly
 * one location. Nothing there had to learn about sharing.
 */
const SHARED_LOCATION_SCOPE = 'ALL_LOCATIONS';

/** What this system WRITES into a description to mark a program cross-location. */
const SHARED_LOCATION_TAG = 'All Locations';

/**
 * What it READS. Several plain-English spellings are accepted for the same
 * reason [Fixed] is still read as [Grouped]: the tag is typed by hand into a
 * calendar, and "Shared"/"All Sites" are what people reach for.
 */
const SHARED_LOCATION_WORDS_REGEX = /\b(All\s+Locations|All\s+Sites|Shared|Combined|Multi-?Site)\b/i;

/**
 * Separator between the date and the location on a cross-location form's row
 * label ("Mon, Jan 5, 2026 · Narberth"). Deliberately NOT the " — " used for
 * meal hints or the " (FULL - Waitlist)" capacity suffix, so stripMealHint()
 * keeps returning a label that still identifies the SESSION — which is what
 * buildRegistryIndex() matches a grid row back to.
 */
const LOCATION_LABEL_SEPARATOR = ' · ';

/** "Narberth" / "Narberth + Ashbridge" — how a form's locations read in prose. */
function describeLocations(locations) {
  const list = (locations || []).filter(Boolean);
  return list.length > 0 ? list.join(' + ') : 'this location';
}

/**
 * CLUBS — the [Club] tag.
 *
 * A club is a program with a MEMBERSHIP rather than a series of one-off
 * sign-ups: the Thursday Book Club, the Knitting Circle. People join once and
 * are expected at every meeting from then on, indefinitely — including
 * meetings whose calendar events do not exist yet.
 *
 * WHY IT IS A THIRD, SEPARATE TAG. [Grouped]/[Regular] answer "which sessions
 * share ONE FORM", and [All Locations] answers "which locations share it".
 * Neither can express "and the people who signed up stay signed up." Making
 * Club a value of Type_Tag would have forced a choice between them, which is
 * exactly wrong — a club can perfectly well be Regular (a fresh form each
 * month, so the menu and dates stay current) while its roster carries across
 * every one of those forms. So it composes, the same way [All Locations]
 * does:
 *
 *   [Club]                  a club, one form per month (the default span)
 *   [Club, Grouped]         a club, one form for the whole series
 *   [Club, Regular]         spelled out; same as [Club]
 *   [Club, Cap: 12]         a club with a per-session cap
 *   [Club, All Locations]   one club meeting at several sites, one form
 *
 * WHAT THE TAG ACTUALLY CHANGES:
 *   - the registration form grows a THIRD attendance-mode choice, "sign up for
 *     all future <program> meetings", which enrolls the whole party in the club
 *     (see ATTENDANCE_MODE_CHOICES / buildClubModeChoice());
 *   - every member of that club gets a registrant row for every session of it,
 *     on every form, forever — applied on each registration sync by
 *     applyClubRosterCatchup(), which is what makes "sign up once" survive the
 *     month rolling over into a brand new form;
 *   - the roster itself lives on the Club_Members tab, one row per person, with
 *     an Active checkbox staff untick to take someone back off it. That is the
 *     REVERSAL half of "sign up once": membership is a fact staff own, not a
 *     one-way consequence of a form submission nobody can undo.
 *
 * A club's identity is the PROGRAM (title + where it runs), not the form —
 * see computeClubKey(). A Regular club gets a new form every month and must
 * keep the same roster across all of them, so keying membership by form would
 * lose the entire point.
 */
const CLUB_TAG = 'Club';

/** What gets READ as the club tag. Kept as permissive as the shared-location one, and for the same reason: it is typed by hand into a calendar. */
const CLUB_WORDS_REGEX = /\b(Club|Membership|Members\s+Only)\b/i;

/**
 * What gets WRITTEN into Program_Sessions's Club column for a club
 * session: TRUE, because that column is now a real CHECKBOX (see
 * PROGRAM_FLAG_COLUMNS). Earlier versions wrote the word "Club" there and
 * plenty of workbooks still hold it, which is why isClubColumnValue() reads
 * both spellings and only the WRITE side changed.
 */
const CLUB_COLUMN_VALUE = true;

/**
 * NO REGISTRATION — the [No Registration] tag.
 *
 * The other tags all answer "how should this program's registration work".
 * This one answers "it shouldn't". Plenty of what a senior center runs takes
 * no sign-up at all: a drop-in coffee hour, a rolling art room, a lobby
 * concert. Those events belong on the calendar and on the dashboard — staff
 * still want to see what is on today — but they must not get a form, and a
 * "📝 Register for…" link on them is actively wrong: it tells people to sign
 * up for something nobody is keeping a list for.
 *
 * WHAT THE TAG CHANGES:
 *   - no registration form is ever built for the program (processCalendarGroup
 *     writes its session rows with the link columns blank);
 *   - any registration link already sitting in its calendar events is removed,
 *     and a form it already had stops accepting responses — see
 *     applyNoRegistrationEffects(). Both are reversible: untick the box and
 *     the next sync re-opens the form and puts the link back.
 *
 * It composes with the others the same way [Club] does, though most of those
 * combinations are contradictions worth nothing: a club with no registration
 * is just a program. [No Registration] wins wherever they disagree, since it
 * is the one that says "no form", and there is nothing for the rest to
 * describe.
 */
const NO_REGISTRATION_TAG = 'No Registration';

/**
 * What gets READ as the no-registration tag. As permissive as the club and
 * shared-location ones, and for the same reason: staff type it by hand into a
 * calendar description and will spell it however it comes to them.
 */
const NO_REGISTRATION_WORDS_REGEX =
  /\b(No\s*-?\s*Registration|No\s+Sign[\s-]?ups?|No\s+Sign\s*-?\s*Up|Registration\s+Not\s+Required|Drop[\s-]?In)\b/i;

/** Written into the No_Registration checkbox column for a session that takes no sign-ups. */
const NO_REGISTRATION_COLUMN_VALUE = true;

/**
 * What stands in for "View Live Form" on a session that takes no sign-ups.
 * Words rather than a blank cell: an empty link column on one row of a table
 * full of links reads as a form that failed to build, which is the bug this
 * feature would otherwise look exactly like.
 */
const NO_REGISTRATION_LINK_LABEL = '— no registration —';

/**
 * WAITLIST ONLY — the [Waitlist Only] tag, and the one tag on this list that
 * describes ONE DATE rather than a program.
 *
 * Every other flag here answers "what kind of program is this", and the answer
 * is the same in September as in March: a club is a club, a drop-in takes no
 * sign-ups. This one answers a question a program cannot answer for itself —
 * "can this Thursday still take anybody?" — and the honest answer differs from
 * one date of the same program to the next. The room is being repainted, the
 * second van is out, the co-leader is away: the program is unchanged and THIS
 * session cannot seat another person.
 *
 * Until now the only way to say that was to type "[Cap: N]" on the event with N
 * set to whatever the current registration count happened to be — which is a
 * guess that goes stale the moment anybody cancels, is wrong the moment the
 * counts are recomputed, and says something false about the room besides. And
 * on an UNCAPPED session (most of them) there was no way to say it at all: with
 * no capacity to be at, nothing ever waitlists, and every new registration was
 * taken as Active however full the day already was.
 *
 * WHAT THE TAG CHANGES, for the one session carrying it:
 *   - every new registration lands Waitlisted, whatever its capacity says and
 *     whether or not it has one (see processFormResponse());
 *   - the session reads 🔴 Waitlist Only on the dashboard, with 0 seats
 *     remaining, so the desk sees the same answer the form is giving;
 *   - the form's own date label gains CAPACITY_HINT_SUFFIX — "(FULL -
 *     Waitlist)" — so somebody signing up is told before they submit rather
 *     than after.
 *
 * WHAT IT DELIBERATELY DOES NOT CHANGE. Nobody already registered is moved:
 * the people holding places keep them, and a session forced to the waitlist
 * with twelve Active registrants still has twelve Active registrants. Turning
 * it off is one untick, and the next registration is Active again.
 *
 * A PROPERTY OF ONE DATE, NOT OF A PROGRAM — which is why it is not in
 * PROGRAM_FLAG_COLUMNS, is never spread to sibling rows, and is never unified
 * across a program's months (see buildEventGroups() / unifyProgramFlagsAcrossGroups(),
 * where every other flag is). Ticking it on the 14th says nothing whatever
 * about the 21st.
 */
const WAITLIST_ONLY_TAG = 'Waitlist Only';

/**
 * What gets READ as the waitlist-only tag. Permissive in the same way the club
 * and assistance ones are — staff type this into a calendar description by hand
 * — and deliberately narrow in one respect: it matches the WORD "waitlist"
 * only alongside "only"/"all", never on its own. A description that merely
 * mentions a waitlist ("[Waitlist: call the office]") is a note about one, not
 * an instruction to start one, and isTagOnlyBracket() would refuse that bracket
 * anyway.
 */
const WAITLIST_ONLY_WORDS_REGEX =
  /\b(Wait\s*-?\s*list\s+Only|Only\s+Wait\s*-?\s*list|Force\s+Wait\s*-?\s*list|Wait\s*-?\s*list\s+All)\b/i;

/** Written into the Waitlist_Only checkbox column for a session forced to the waitlist. */
const WAITLIST_ONLY_COLUMN_VALUE = true;

/**
 * PERSONALIZED ASSISTANCE — the [Personalized Assistance] tag.
 *
 * Every other program on the calendar is a ROOM full of people at one time:
 * you say you are coming, and the only question is how many chairs. The
 * center also runs a second, entirely different shape of program — Computer
 * Help with Gerry or with Kathy, Low-Cost Wills with Heather, Medicare
 * counseling — where one visitor sits with one provider for twenty or thirty
 * minutes, and the next one sits down when they get up. A "12:30–3:30 Low-Cost
 * Wills" event is not one session for twelve people; it is six appointments.
 *
 * Registering for the DAY is therefore the wrong answer for these, and it was
 * the only answer this system could give. What the visitor has to choose is a
 * TIME, and what the provider has to receive, a week ahead, is a list of names
 * against times.
 *
 * WHAT THE TAG CHANGES:
 *   - THE SESSION BECOMES SLOTS. Each event's start-to-end span is cut into
 *     back-to-back appointments of APPOINTMENT_SLOT_MINUTES (override per
 *     program with "[Slots: 20]"), and the session's capacity, unless [Cap: N]
 *     says otherwise, is simply how many slots fit. Back-to-back is not a
 *     nicety — Heather Turner will not sit through gaps — so the choices are
 *     offered EARLIEST FIRST and a booked one disappears from the form, which
 *     packs the day from the front on its own.
 *   - THE FORM ASKS FOR A TIME, not a date. The roster grids, the "everyone,
 *     every date" branch and the club option all come off (an appointment is
 *     not something a party of four attends every week), and one required
 *     "Which appointment time?" question takes their place — see
 *     syncAssistanceQuestionsOnForm(). The guest questions STAY: "individual
 *     or couple" is a real answer for a will.
 *   - LUNCH IS ASKED AS ONE YES/NO, on the days it is served. The two roster
 *     grids come off with everything else date-based — a person books one time
 *     on one day, so a grid of dates against people is the wrong question —
 *     but the DAY may still come with a meal, and somebody seeing Heather at
 *     12:30 at a site that serves lunch at noon is exactly the person who
 *     would stay for it. So the form asks once, under the time they picked,
 *     and only where a date on the form actually serves lunch. See
 *     TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH and
 *     applyAppointmentLunchQuestion().
 *   - IT ASKS WHETHER THEY WOULD COME SOONER. Under the time question, one
 *     optional question — "if an earlier appointment opens up, may we call
 *     you?" — because these bookings run months ahead and the person who took
 *     the first free November slot and the person who WANTS November are
 *     otherwise indistinguishable on the sheet. The answer lands in
 *     Registrant_Dash's Earlier_Appointment column, which staff can also set
 *     themselves (most people say it on the telephone), and the assistance
 *     schedule turns it into a call list the moment something falls through.
 *     See EARLIER_APPOINTMENT_CHOICES.
 *   - A REQUEST NEEDS NO DATE. The last choice on the time question is always
 *     "None of these work — please contact me", which files the person on the
 *     Assistance_Requests tab instead of booking them onto a date they never
 *     picked. That is how a Medicare counselor who visits "when there is
 *     demand" gets their demand, months before a date exists. See
 *     ASSISTANCE_NO_TIME_CHOICE.
 *   - ONE APPOINTMENT PER MONTH, where a provider asks for it:
 *     "[Max Per Month: 1]" flags a second booking by the same person in the
 *     same calendar month rather than quietly taking it.
 *
 * It composes with the other tags the way [Club] does, and it is the tag that
 * decides the FORM's shape, so where it disagrees with [Club] it wins — except
 * with [No Registration], which still wins over everything by having no form
 * at all.
 */
const ASSISTANCE_TAG = 'Personalized Assistance';

/**
 * What gets READ as the assistance tag — as permissive as the club and
 * shared-location ones, and for the same reason: staff type it by hand into a
 * calendar description and will spell it however it comes to them. "1-on-1",
 * "By Appointment" and "Appointments" are what this office actually writes.
 */
const ASSISTANCE_WORDS_REGEX =
  /\b(Personali[sz]ed\s+Assistance|By\s+Appointment|Appointments?|1\s*[-:]?\s*(?:on|to)\s*[-:]?\s*1|One\s*[-\s]?(?:on|to)[-\s]?\s*One)\b/i;

/** Written into the Personalized_Assistance checkbox column for an appointment-based program. */
const ASSISTANCE_COLUMN_VALUE = true;

/**
 * How long one appointment lasts when the calendar event does not say. Twenty
 * to thirty minutes is what every one of these programs actually runs at; 30
 * is the safer default because it under-books rather than over-books a
 * provider's afternoon. Override per program with "[Slots: 20]".
 */
const APPOINTMENT_SLOT_MINUTES = 30;

/**
 * HOW MANY PEOPLE ONE APPOINTMENT SLOT HOLDS: one. That is what an
 * appointment IS — the provider sees one person (or one party) at 10:30 and
 * the next at 11:00 — and it is the number every other rule here has always
 * assumed without ever writing down: buildAppointmentChoicesForContext()
 * drops a slot from the form the moment it is taken, and
 * existingAppointmentHolder() flags a second booking of the same time.
 *
 * Written down because a session's CAPACITY is derived from it: an appointment
 * session holds one person per slot, so its Max_Capacity is its slot count —
 * see resolveAppointmentCapacity(). A "[Cap: N]" above one on such an event
 * can only ever mean FEWER appointments than the span allows (a provider
 * keeping the last half hour free); it cannot conjure a second chair into a
 * slot, which is why a larger one is clamped rather than honoured. And
 * "[Cap: 1]" is read as this number — one person per appointment, which is
 * what a one-to-one program is — rather than as a session that goes full on
 * its first booking.
 */
const APPOINTMENT_SLOT_CAPACITY = 1;

/** Sanity bounds on "[Slots: N]" — a 2-minute or 7-hour appointment is a typo, not an instruction. */
const MIN_APPOINTMENT_SLOT_MINUTES = 5;
const MAX_APPOINTMENT_SLOT_MINUTES = 240;

/** Between a session's date label and its appointment time on the form's time question. */
const APPOINTMENT_TIME_SEPARATOR = ' @ ';

/**
 * The last choice on every assistance form's time question. It is not a time,
 * and it deliberately books nothing: it files an Assistance_Requests row for
 * staff to schedule by hand. See processAppointmentResponse().
 */
const ASSISTANCE_NO_TIME_CHOICE = 'None of these work — please contact me about another time';

/**
 * WOULD THEY TAKE AN EARLIER APPOINTMENT? — the second question every
 * assistance form asks, and the fact staff have been keeping by hand.
 *
 * Booking a will or a Medicare consultation runs months out, and the two
 * people who book November want opposite things: one is holding out for
 * November because that is when their daughter visits, the other took the
 * first date on the form and would drop everything for a slot next week.
 * Until now they were indistinguishable on the sheet — the difference lived in
 * a note typed into the old form's "Confirmed Date/Time?" column — so when
 * somebody cancelled, filling the hole meant ringing down the list and asking
 * everyone.
 *
 * NOT REQUIRED, and blank means NO. Nobody who skipped the question has agreed
 * to be telephoned, and a cold call moving somebody's appointment is exactly
 * the wrong way to discover you guessed. The question is asked on the form,
 * and the column is staff-editable on Registrant_Dash for the far commoner
 * case: they said it on the phone.
 */
const EARLIER_APPOINTMENT_CHOICES = {
  YES: 'Yes — please call me if an earlier appointment opens up',
  NO: 'No — the time I picked is the one I want'
};

/**
 * What those answers are STORED as, in Registrant_Dash's Earlier_Appointment
 * column. Short, because it is read at a glance down a column beside twenty
 * other columns — and deliberately not "Yes"/"No", which says nothing at all
 * on a sheet where the question is not on screen.
 */
const EARLIER_APPOINTMENT_VALUES = {
  YES: '☎️ Call if earlier',
  NO: 'Keeping this time'
};

/**
 * The two answers to TEMPLATE_ITEM_TITLES.APPOINTMENT_LUNCH. Worded as an
 * offer rather than as a bare Yes/No because that is what it is — the meal is
 * not part of the appointment, and somebody who wants one has to be told they
 * may have one.
 */
const APPOINTMENT_LUNCH_CHOICES = {
  YES: 'Yes — please order me a lunch that day',
  NO: 'No thank you'
};

/**
 * One answer to that question -> the lunch intent buildRegistrantRow() wants
 * ('Yes - Lunch' / 'No Lunch'). Matched on the LEADING WORD, the same way
 * readEarlierAppointmentAnswer() is, so the wording above can be changed
 * without orphaning the answers already collected.
 *
 * A BLANK IS "NO". The question is not required — somebody who booked an
 * appointment and ignored a question about food has not ordered a meal, and
 * ordering one for them puts a portion on the kitchen's list that nobody
 * eats.
 */
function readAppointmentLunchAnswer(value) {
  const text = String(value || '').trim();
  if (!text) return 'No Lunch';
  return /^y/i.test(text) ? 'Yes - Lunch' : 'No Lunch';
}

/** The dropdown offered on the sheet itself: the two answers, plus blank for "not asked". */
const EARLIER_APPOINTMENT_OPTIONS = ['', EARLIER_APPOINTMENT_VALUES.YES, EARLIER_APPOINTMENT_VALUES.NO];

/**
 * One form answer -> what goes in the column. Matched on the LEADING WORD
 * rather than the whole sentence, so re-wording either choice later does not
 * orphan the answers already collected against the old wording.
 */
function readEarlierAppointmentAnswer(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^y/i.test(text)) return EARLIER_APPOINTMENT_VALUES.YES;
  if (/^n/i.test(text)) return EARLIER_APPOINTMENT_VALUES.NO;
  return '';
}

/**
 * True when this row's Earlier_Appointment cell says "ring me". Reads the
 * stored value AND a raw form answer, because staff type into that column by
 * hand and will write "yes" in it.
 */
function wantsEarlierAppointment(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text === EARLIER_APPOINTMENT_VALUES.YES) return true;
  if (text === EARLIER_APPOINTMENT_VALUES.NO) return false;
  return /^(☎️\s*)?(y|call)/i.test(text);
}

/** True when a Program_Sessions row's Personalized_Assistance cell marks it appointment-based. */
function isAssistanceColumnValue(value) {
  return isFlagColumnValue(value, ASSISTANCE_WORDS_REGEX);
}

/**
 * The two TICKABLE tag columns on Program_Sessions, and everything
 * that differs between them, in one place.
 *
 * They are the same mechanism twice over — a calendar-description bracket,
 * shown as a checkbox, ticked or unticked by staff, stamped back onto every
 * calendar event of that program — so the edit handler, the menu-driven
 * reconcile and the sync-time catch-up all walk this list instead of naming
 * either flag. Adding a third flag column is then a matter of adding an entry
 * here plus its header.
 *
 *   column   the dashboard header it appears under
 *   tag      the exact word this script WRITES into a description bracket
 *   regex    every spelling it READS back out of one
 *   groupKey the field buildEventGroups() carries it on
 */
defineLazyGlobal_('PROGRAM_FLAG_COLUMNS', () => ([
  {
    column: 'Club',
    tag: CLUB_TAG,
    regex: CLUB_WORDS_REGEX,
    groupKey: 'isClub',
    describeOn: title => `"${title}" is a club`,
    describeOff: title => `"${title}" is no longer a club`,
    onQuestion: title => `Make "${title}" a club?`,
    onDetail: title =>
      `People who sign up for "${title}" will stay signed up: its registration form grows a ` +
      `"sign up for all future meetings" choice, and everyone on its Club_Members list is booked ` +
      `into every future session automatically.\n\n[${CLUB_TAG}] is written onto its calendar events.`,
    offDetail: title =>
      `"${title}" will stop keeping a standing membership. Nobody is removed from Club_Members and ` +
      `no existing booking is cancelled — the list simply stops being applied to new sessions.\n\n` +
      `[${CLUB_TAG}] is removed from its calendar events.`
  },
  {
    column: 'No_Registration',
    tag: NO_REGISTRATION_TAG,
    regex: NO_REGISTRATION_WORDS_REGEX,
    groupKey: 'noRegistration',
    describeOn: title => `"${title}" takes no registration`,
    describeOff: title => `"${title}" takes registrations again`,
    onQuestion: title => `Turn registration off for "${title}"?`,
    onDetail: title =>
      `"${title}" will stop taking sign-ups. No registration form is built for it, the registration ` +
      `link is removed from its calendar events, and any form it already has stops accepting ` +
      `responses.\n\nRegistrations already collected are kept. Untick the box to turn registration ` +
      `back on.\n\n[${NO_REGISTRATION_TAG}] is written onto its calendar events.`,
    offDetail: title =>
      `"${title}" will take sign-ups again: the next sync builds (or re-opens) its registration form ` +
      `and puts the link back on its calendar events.\n\n[${NO_REGISTRATION_TAG}] is removed from ` +
      `its calendar events.`
  },
  {
    column: 'Personalized_Assistance',
    tag: ASSISTANCE_TAG,
    regex: ASSISTANCE_WORDS_REGEX,
    groupKey: 'isAssistance',
    describeOn: title => `"${title}" is booked by appointment`,
    describeOff: title => `"${title}" is booked by date again`,
    onQuestion: title => `Make "${title}" an appointment program?`,
    onDetail: title =>
      `"${title}" will be registered for by APPOINTMENT rather than by date. Each of its calendar ` +
      `events is cut into back-to-back ${APPOINTMENT_SLOT_MINUTES}-minute slots (say "[Slots: 20]" in the ` +
      `description for a different length), and its form asks for a time instead of showing the ` +
      `attendance and lunch grids.\n\nAnybody who cannot use the times offered is filed on ` +
      `"${SHEET_NAMES.ASSISTANCE_REQUESTS}" for you to schedule by hand.\n\n[${ASSISTANCE_TAG}] is ` +
      `written onto its calendar events.`,
    offDetail: title =>
      `"${title}" goes back to ordinary date-based registration: its form gets the attendance and ` +
      `lunch grids back and stops asking for a time. Appointments already booked keep their times on ` +
      `the Registrants tab.\n\n[${ASSISTANCE_TAG}] is removed from its calendar events.`
  }
]));

/** The flag definition for one dashboard column name, or null. */
function getProgramFlagByColumn(columnName) {
  return PROGRAM_FLAG_COLUMNS.filter(f => f.column === columnName)[0] || null;
}

/**
 * THE SAME TABLE, FOR THE TICKS THAT BELONG TO ONE DATE.
 *
 * Shaped exactly like a PROGRAM_FLAG_COLUMNS entry — column, tag, regex,
 * wording — so everything that only needs to know "which tag, spelled how"
 * (setFlagBracketInDescription(), describeFlagState(), the pending queue) walks
 * either list without caring which it has. What differs is `perSession`, and
 * the whole of the difference is where the tag lands: a program flag is stamped
 * onto every calendar event of the program, and one of these onto exactly the
 * one event whose row was ticked.
 *
 * They are two lists rather than one list with a field, because the mistake
 * this shape prevents is the expensive one. Every existing caller iterating
 * PROGRAM_FLAG_COLUMNS — the reconciler that unticks whatever the calendar does
 * not say, the sibling-row spread, the group-level flag unification — is
 * correct for program flags and WRONG for these, and would quietly apply one
 * date's answer to all of them. Reaching this list is therefore something a
 * caller has to do deliberately.
 *
 *   groupKey  the field on a SESSION (never on a group) that carries it — see
 *             buildEventGroups().
 */
defineLazyGlobal_('SESSION_FLAG_COLUMNS', () => ([
  {
    column: 'Waitlist_Only',
    tag: WAITLIST_ONLY_TAG,
    regex: WAITLIST_ONLY_WORDS_REGEX,
    groupKey: 'waitlistOnly',
    perSession: true,
    describeOn: (title, when) => `${when ? `${when} ` : ''}"${title}" is waitlist-only`,
    describeOff: (title, when) => `${when ? `${when} ` : ''}"${title}" is taking registrations again`,
    onDetail: () =>
      `Everyone who signs up for this ONE session from now on goes on the waitlist, however many ` +
      `seats it says are left and even if it has no capacity at all.\n\nNobody already registered ` +
      `is moved.`,
    offDetail: () =>
      `This session takes registrations normally again — its capacity decides who is waitlisted, ` +
      `the way every other session's does.`
  }
]));

/** The session-flag definition for one dashboard column name, or null. */
function getSessionFlagByColumn(columnName) {
  return SESSION_FLAG_COLUMNS.filter(f => f.column === columnName)[0] || null;
}

/**
 * PENDING FLAG CHANGES — the tab that makes a tick survive long enough to be
 * delivered.
 *
 * A tick has to end up in a calendar description, and the trigger that sees
 * the tick first is the SIMPLE onEdit, which has no authorization to write to
 * a calendar (see onEdit()). Meanwhile anything at all happening on a watched
 * calendar fires onCalendarChange -> a full syncCalendars(), which recomputes
 * these columns FROM the calendar. Between those two facts sat the bug this
 * tab exists to kill: you tick the box, a sync fires seconds later for an
 * unrelated reason, the calendar still knows nothing about your tick, and the
 * box quietly unticks itself — taking with it the only record that you ever
 * asked for anything, so the menu-driven "apply" then has nothing to apply.
 *
 * So the tick is recorded HERE, on a hidden tab, the instant it happens —
 * which a simple onEdit can do, because it is nothing but a spreadsheet write.
 * From then on:
 *
 *   - reconcileProgramFlagColumns() leaves that program's checkboxes ALONE
 *     while an entry is outstanding. The calendar no longer overwrites an
 *     instruction it has not been told about yet.
 *   - every authorized entry point drains the queue by stamping the calendar:
 *     the installable onEdit (seconds later, the normal case), the next
 *     Sync Cal, and the menu item. An entry is cleared only once its calendar
 *     has actually accepted it.
 *
 * One row per program per flag; a later tick on the same program replaces the
 * earlier one, so the queue holds intentions rather than history.
 *
 * DATE_KEY IS THE EXCEPTION, and it is empty on almost every row. A
 * PROGRAM_FLAG_COLUMNS tick is a statement about a program and reaches every
 * one of its calendar events, so it names no date. Waitlist_Only is a statement
 * about ONE SESSION (see WAITLIST_ONLY_TAG) and must reach exactly one event,
 * so its entries carry that event's date key — and two dates of one program can
 * therefore sit in the queue at once saying opposite things, which is the whole
 * point of the column. It was appended rather than inserted so that a queue
 * written by an older version still reads correctly: those rows have four
 * values and a missing fifth, which is the same "no date" every program-wide
 * entry writes deliberately.
 */
const PENDING_FLAG_SHEET_NAME = '_Pending_Tag_Changes';
const PENDING_FLAG_HEADERS =
  ['Column', 'Calendar_Source', 'Clean_Title', 'Turn_On', 'Requested_At', 'Date_Key'];

/**
 * The queue's identity for one flag change: a program's, or — when a date key
 * is given — one session's. The date is part of the key so that ticking the
 * 14th does not replace an outstanding tick of the 21st.
 */
function pendingFlagKey(flagColumn, calendarId, title, dateKey) {
  return `${String(flagColumn || '').trim()}|${String(calendarId || '').trim()}|` +
    `${String(title || '').trim()}|${String(dateKey || '').trim()}`;
}

/**
 * True when a tag-column cell is ON. Reads a real checkbox (a boolean, or the
 * "TRUE" a pasted cell arrives as) AND the words earlier versions wrote there
 * — a workbook that still says "Club" in that column must keep meaning it
 * until the next render turns it into a tick.
 */
function isFlagColumnValue(value, wordsRegex) {
  if (value === true) return true;
  const text = String(value === false ? '' : (value || '')).trim();
  if (!text) return false;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  return wordsRegex.test(text);
}

/**
 * The stable key a club's membership is filed under: its title, plus the
 * location it meets at — or the shared scope when the program is tagged
 * [All Locations], since that is one club that happens to meet in two rooms.
 *
 * Lower-cased for the same reason normalizeNameKey() is: this key is matched
 * against values typed into a calendar and re-typed onto a sheet, and "Book
 * Club" / "book club " must not become two rosters.
 */
function computeClubKey(cleanTitle, location, isShared) {
  // Same whitespace collapsing as normalizeNameKey(), for the same reason: a
  // calendar title that gained a double space is otherwise a DIFFERENT club,
  // and a club whose key changes loses its whole standing roster.
  const norm = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const title = norm(cleanTitle);
  if (!title) return '';
  const scope = isShared ? SHARED_LOCATION_SCOPE : norm(location);
  return `${scope}::${title}`;
}

/** True when a Program_Sessions row's Club cell marks it a club session. */
function isClubColumnValue(value) {
  return isFlagColumnValue(value, CLUB_WORDS_REGEX);
}

/** True when a Program_Sessions row's No_Registration cell says this session takes no sign-ups. */
function isNoRegistrationColumnValue(value) {
  return isFlagColumnValue(value, NO_REGISTRATION_WORDS_REGEX);
}

/**
 * True when a Program_Sessions row's Waitlist_Only cell says THIS
 * SESSION takes no more Active registrations — see WAITLIST_ONLY_TAG. Read
 * through isFlagColumnValue() like the other tag columns, so a cell that
 * arrived as pasted text ("TRUE", "Waitlist Only") still means what it says.
 */
function isWaitlistOnlyColumnValue(value) {
  return isFlagColumnValue(value, WAITLIST_ONLY_WORDS_REGEX);
}

