// ============================================================================
// 4a. THE CONFIG TAB'S SETTINGS  (meal buffers, catering, automation, addresses)
// ============================================================================

const MEAL_BUFFER_LOCATIONS = ['Narberth', 'Ashbridge'];
const CONFIG_LAYOUT = {
  MEAL_BUFFERS: {
    title: '🍱 Meal Buffer Amounts (Location x Hot/Cold)',
    startCol: 1,
    headers: ['Location', 'Lunch_Type', 'Standard_Buffer_Amount', 'Tester_Buffer_Amount']
  },
  ORDER_AHEAD: {
    title: '⏰ Order Ahead Time',
    startCol: 6,
    headers: ['Order_Ahead_Days']
  },
  CATERING_POLICY: {
    title: '🍽️ Lunch Service by Location',
    startCol: 10,
    headers: ['Location', 'Catering_Policy']
  },
  LINK_DISPLAY: {
    title: '🔗 Registration Link in Events',
    startCol: 13,
    headers: ['Link_Display']
  },
  AUTOMATION: {
    title: '⚙️ Automation & Trigger Ownership',
    startCol: 15,
    headers: ['Automation_Enabled', 'Trigger_Owner', 'Triggers_Verified_At']
  },
  CALENDAR_INVITES: {
    title: '📧 Calendar Invitations',
    startCol: 19,
    headers: ['Invite_Registrants']
  },
  REGISTRATION_HORIZON: {
    title: '🚧 Registration Open Through',
    startCol: 21,
    headers: ['Registration_Open_Through']
  },
  MEMBERSHIP_FORM: {
    title: '🪪 Membership Application Form',
    startCol: 25,
    headers: ['Membership_Form_Id']
  },
  // Deliberately last and off on its own past MEMBERSHIP_FORM rather than
  // widened in place at its old column 8: every section between there and
  // MEMBERSHIP_FORM (Catering Policy, Link Display, Automation, Calendar
  // Invitations, Registration Horizon) is a LIVE setting on every workbook
  // already running this project, keyed by column. Reflowing them to make
  // room for four new checkbox columns would silently move
  // Automation_Enabled, Trigger_Owner and the rest to columns nothing has
  // written data into yet — which reads as blank, and a blank
  // Automation_Enabled reads as "on" (see DEFAULT_AUTOMATION_ENABLED). That
  // is a live-system safety hazard for one column count problem, so this
  // table gets fresh columns instead and the two retired single-cell
  // sections (see RETIRED_ADMIN_NOTIFICATION_COL / RETIRED_ARCHIVE_COPY_COL
  // below) are read where they stand and then cleared, never shifted.
  ADMIN_NOTIFICATIONS: {
    title: '📧 Admin Notification Emails',
    startCol: 27,
    headers: ['Email', 'Sync_Digest', 'Leader_Roster_Alerts', 'Registrant_Reminders', 'Calendar_Invite_Guest',
      'Appointment_Requests']
  }
};
// The blank columns between the blocks above. Columns 8 and 23 are blank too,
// but they are not spacers — they are where the two retired sections stood
// until the migration cleared them (RETIRED_ADMIN_NOTIFICATION_COL /
// RETIRED_ARCHIVE_COPY_COL), and naming them here would invite somebody to
// close the gap by moving a live section into one.
const CONFIG_SPACER_COLS = [5, 7, 9, 12, 14, 18, 20, 22, 24, 26];

/**
 * WHO IN THE OFFICE HEARS WHAT. Everything this system sends leaves the
 * organization: a roster alert goes to a program leader who is not on staff, a
 * reminder goes to a member, a calendar invitation goes to whoever typed an
 * address into a registration form. None of it lands anywhere the office can
 * look at later — the trigger owner's Sent folder is one particular person's
 * mailbox, and routinely not the person who has to answer for what was sent.
 *
 * This was two single-address Config cells: Admin_Notification_Email (the
 * per-sync digest) and Archive_Copy_Email (copied on everything else). One
 * address each, the same address on all of it, and no way to say "the lunch
 * coordinator wants the leader alerts but not the sync digest". The table
 * replacing them (CONFIG_LAYOUT.ADMIN_NOTIFICATIONS) is that sentence: one row
 * per person, one checkbox per category they are copied on.
 *
 * NOTHING IS SEEDED INTO IT. An address nobody typed is an address nobody
 * asked to hear from, so a fresh table means "tell nobody" — every category
 * reads an empty list as "copy nobody", exactly as a blank cell always did.
 * The two old cells are the one exception: a workbook that already had them
 * filled in gets them carried across, ticked for the categories they used to
 * cover (see migrateLegacyAdminNotificationColumns()).
 */
const ADMIN_NOTIFICATION_MAX_ROWS = 5;

/**
 * The categories a row in that table can be ticked for, and where each
 * checkbox sits relative to CONFIG_LAYOUT.ADMIN_NOTIFICATIONS.startCol (the
 * Email column is offset 0). `key` is what the row object reads back as —
 * see getAdminNotificationRows() and adminEmailsForCategory().
 *
 *   SYNC_DIGEST            The per-sync digest notifyAdmin() sends: waitlisted
 *                          registrants, forms that failed to open, triaged
 *                          events, a door sign-in that did not complete. Was
 *                          Admin_Notification_Email.
 *   LEADER_ROSTER_ALERTS   BCC on the roster-change email a program leader
 *                          gets (section 9d). Was Archive_Copy_Email.
 *   REGISTRANT_REMINDERS   BCC on the reminder a registrant gets (section 9e).
 *                          Was Archive_Copy_Email.
 *   CALENDAR_INVITE_GUEST  Added as a GUEST on any event a registrant is
 *                          invited to (section 5b). Was Archive_Copy_Email.
 *                          A guest, not a CC — Google mails them the invitation
 *                          itself — so it is a tick per person, not a BCC line.
 *   APPOINTMENT_REQUESTS   Emailed when a sync files somebody onto
 *                          Assistance_Requests: a person who wanted a
 *                          personalized-assistance appointment and could not
 *                          be offered a time (see ASSISTANCE_NO_TIME_CHOICE).
 *                          Its own tick rather than a line in the sync digest
 *                          because it is not a fault report — it is a person
 *                          waiting for a phone call, and whoever makes that
 *                          call is rarely whoever reads the digest.
 *
 * BEING AN EDITOR of the leader sheets and forms this system shares is
 * deliberately NOT a category. It is not mail at all, it is standing access to
 * a file, and a checkbox of its own for one Drive grant would suggest
 * otherwise.
 * Every address in the table gets it, ticked or not, which is what
 * Archive_Copy_Email always did — see openUpFileToAnyoneWithLink().
 */
const ADMIN_NOTIFICATION_CATEGORIES = [
  { key: 'syncDigest', header: 'Sync_Digest', offset: 1 },
  { key: 'leaderRosterAlerts', header: 'Leader_Roster_Alerts', offset: 2 },
  { key: 'registrantReminders', header: 'Registrant_Reminders', offset: 3 },
  { key: 'calendarInviteGuest', header: 'Calendar_Invite_Guest', offset: 4 },
  { key: 'appointmentRequests', header: 'Appointment_Requests', offset: 5 }
];

/**
 * RETIRED (September 2026), and named here only so the one-time migration can
 * find them: the two single-address cells the table above replaced, at the
 * columns they have always occupied. Nothing else reads these positions any
 * more, and migrateLegacyAdminNotificationColumns() clears them once it has
 * carried their values across — but only when the banner above the column
 * still says what it said, so a column somebody has since repurposed by hand
 * is left alone.
 */
const RETIRED_ADMIN_NOTIFICATION_COL = { title: '📧 Admin Notifications', col: 8 };
const RETIRED_ARCHIVE_COPY_COL = { title: '🗄️ Archive Copy Address', col: 23 };

/**
 * THE MEMBERSHIP APPLICATION THE DOOR HANDS OUT.
 *
 * A Google Form that belongs to the OFFICE, not to this script: it is not one
 * of the forms this system generates, nothing here decides its questions, and
 * whoever processes memberships reads its answers in its own response sheet.
 * The door app reads its items live and draws them as native fields (see
 * membershipFormShape()), so editing the form is how the door's membership
 * screen changes — there is no code edit and no redeploy in that loop.
 *
 * A CONFIG CELL RATHER THAN A CONSTANT for the usual reason: the office
 * replaces this form eventually — a new season, a new fee table, a form
 * somebody rebuilt because the old one filled up — and the replacement is a
 * new file with a new id. Pasting an id (or the form's whole edit URL, which
 * is what a browser hands you) into one cell must be the whole operation.
 *
 * BLANK MEANS NO APPLICATION AT THE DOOR. The membership screen is not
 * offered, and a walk-in who says they are not a member yet is recorded for
 * the office exactly as they were before this existed — which is the behavior
 * every workbook had, and therefore the only safe reading of an empty cell.
 *
 * The default below is seeded onto a fresh Config tab only; a workbook whose
 * cell has been cleared or repointed by hand stays as staff left it.
 */
const DEFAULT_MEMBERSHIP_FORM_ID = '1WCL32W4h3bgbgv4KrKEpnEXKO219lezypNAZ1XXGusk';

/**
 * A form id out of whatever is actually in that cell.
 *
 * Staff paste what their browser gave them, which is an edit URL
 * ("https://docs.google.com/forms/d/<id>/edit") rather than a bare id — and a
 * cell holding a URL that reads as "not configured" is a membership screen
 * that silently never appears. Both shapes are accepted; anything with no
 * id-shaped run of characters in it returns '' and is treated as blank.
 */
function parseFormIdFromConfigValue(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const fromUrl = text.match(/\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([A-Za-z0-9_-]{10,})/);
  if (fromUrl) return fromUrl[1];
  const bare = text.match(/^[A-Za-z0-9_-]{10,}$/);
  return bare ? bare[0] : '';
}

const DEFAULT_MEAL_BUFFERS = { standardBufferAmount: 1, testerBufferAmount: 2 };
const DEFAULT_ORDER_AHEAD_DAYS = 7;

/**
 * Whether the registration link appears in the calendar event's description.
 *
 * "Show link" is the normal setting: attendees open the event and there is a
 * "📝 Register for X" link at the top of it.
 *
 * "Hide link" leaves the description with no registration link at all — for
 * programs where sign-up is handled at the desk and a self-serve link in a
 * shared calendar would be wrong. It has ONE real cost, and it is worth
 * understanding before choosing it: findExistingFormIdFromEvents() recovers a
 * lost form by reading its ID back out of an event description, and with no
 * link there is nothing to read. Form ownership then rests entirely on the
 * Script Properties registry and the Form_ID column of the dashboard, so a
 * workbook rebuilt from scratch under this setting will build new forms
 * rather than adopting the existing ones.
 */
const LINK_DISPLAY_OPTIONS = { SHOW: 'Show link', HIDE: 'Hide link' };
const LINK_DISPLAY_OPTION_LIST = Object.values(LINK_DISPLAY_OPTIONS);
const DEFAULT_LINK_DISPLAY = LINK_DISPLAY_OPTIONS.SHOW;

/**
 * Whether registrants are added as GUESTS to the Google Calendar event they
 * signed up for — so the program lands in their own calendar, with Google's
 * reminders attached, instead of only in this workbook.
 *
 * THIS ONE SENDS MAIL TO REAL PEOPLE, which is why it gets a switch of its own
 * rather than riding along with the rest of the sync. Adding a guest to an
 * event makes Google email them an invitation, and removing one emails a
 * cancellation. That is the intended behavior — an invitation nobody receives
 * is not an invitation — but it means the blast radius of a mistake here is
 * other people's inboxes, so "off" has to be reachable in one cell by anyone
 * with the workbook open, exactly like the automation kill switch.
 *
 * ONLY UPCOMING SESSIONS are ever touched, and only rows whose Program_Status
 * is Active. A cancelled or superseded registrant is REMOVED from the event's
 * guest list (see inviteRegistrantsToCalendarEvents()), which is what keeps a
 * cancellation from leaving somebody holding an invitation to a thing they
 * have withdrawn from.
 */
const CALENDAR_INVITE_OPTIONS = { INVITE: 'Invite registrants', NONE: 'Do not invite' };
const CALENDAR_INVITE_OPTION_LIST = Object.values(CALENDAR_INVITE_OPTIONS);
const DEFAULT_CALENDAR_INVITE = CALENDAR_INVITE_OPTIONS.INVITE;

/**
 * REGISTRATION HORIZON — the date registration is currently open THROUGH.
 *
 * A season's calendar is usually built months ahead of the day sign-ups are
 * meant to open. Without this, the moment an event lands on a calendar its
 * form is live and its description is advertising a link, so anybody browsing
 * the shared calendar can register for a session nobody has announced yet.
 *
 * One date cell on Config fixes that. Sessions dated ON OR BEFORE it are open
 * for registration exactly as they always have been. Sessions dated AFTER it
 * are NOT YET OPEN, which means three things, all of them reversible by
 * changing the one cell:
 *
 *   1. their calendar event descriptions say "🚧 Registration Not Yet Open"
 *      instead of carrying a "📝 Register for ..." link;
 *   2. a form whose remaining sessions are ALL beyond the horizon stops
 *      accepting responses, and anybody holding its link is told, in those
 *      same words, that registration is not yet open;
 *   3. neither is permanent — move the date forward (or clear the cell) and
 *      the next sync writes the links back and re-opens the forms.
 *
 * The rows, the forms, and the calendar events themselves are all still BUILT
 * ahead of time; this only decides whether the public is invited into them
 * yet. That is what makes moving the date a one-cell operation rather than a
 * rebuild.
 *
 * BLANK MEANS NO HORIZON — every session is open, which is the behavior every
 * workbook had before this setting existed and therefore the only safe
 * default. An unparseable cell reads the same way and says so in the log: the
 * cost of wrongly having no horizon is that a link goes out early, and the
 * cost of wrongly having one is that EVERY form in the workbook goes dark on
 * the strength of a typo.
 *
 * Only ever compared date-to-date (never date-to-time): the horizon means "the
 * end of that day", so a session on the horizon date itself is open.
 */
const REGISTRATION_NOT_OPEN_TEXT = 'Registration Not Yet Open';
/** The line written at the top of a not-yet-open event's description. */
const REGISTRATION_NOT_OPEN_LINE = `🚧 ${REGISTRATION_NOT_OPEN_TEXT}`;
/** What somebody holding the link to a not-yet-open form is shown by Google. */
const REGISTRATION_NOT_OPEN_FORM_MESSAGE =
  `${REGISTRATION_NOT_OPEN_TEXT} — this program is not taking sign-ups yet. ` +
  'Please check back closer to the session date.';
const CONFIG_HEADER_ROW = 2;
const CONFIG_DATA_START_ROW = 3;
/** Types that actually need a Meal Buffer Amounts row in Config (a "Not Serving" day never does). */
const CATERED_LUNCH_TYPES = ['Hot', 'Cold'];

/**
 * How far either side of today the Meal_Source dropdown looks for batches, and
 * how many it will offer at most. See getRecentMealIdOptions().
 *
 * Two weeks back is generous for food — well past anything anyone should still
 * be serving — and deliberately so: the list is there to be scanned, and a
 * batch too old to hand out is a batch someone might still be RECORDING, days
 * later, from a sign-in sheet nobody has typed up yet.
 */
const MEAL_SOURCE_LOOKBACK_DAYS = 14;
const MEAL_SOURCE_LOOKAHEAD_DAYS = 7;
const MEAL_SOURCE_MAX_OPTIONS = 40;
/** Full set of Type choices offered on Lunch_Schedule / Master_Lunch_Dashboard. */
const LUNCH_TYPE_OPTIONS = ['Hot', 'Cold', 'Not Serving'];
/** Registrant_Dash' own Lunch_Type domain — a PERSON'S lunch is Hot, Cold, or none, never "Not Serving" (that's a day-level fact). */
const REGISTRANT_LUNCH_TYPE_OPTIONS = ['Hot', 'Cold', 'No Lunch'];

/**
 * A location's STANDING catering posture. Until this existed the only way
 * to say "Zoom never serves lunch" was to hand-add a "Not Serving" row to
 * Lunch_Schedule for every Zoom date forever — so in practice those dates
 * read as merely unconfigured, which meant they were seeded onto the lunch
 * dashboard AND asked about lunch on their registration forms.
 *
 *   ALWAYS       Lunch unless told otherwise. Every upcoming date is seeded
 *                onto the dashboard; a per-date "Not Serving" row suppresses
 *                individual days. (A normal catering site.)
 *   BY_EXCEPTION Nothing is assumed. A date shows up only once someone adds
 *                a real Hot/Cold row for it on Lunch_Schedule. (A site that
 *                caters occasionally.)
 *   NEVER        No lunch, ever. The location never appears on the lunch
 *                dashboard, and its forms don't ask about lunch at all.
 *
 * Policy governs what gets SEEDED. Actual registered demand always wins —
 * see buildDashboardRollup(): if someone is down for lunch on a date, that
 * date appears no matter the policy, and gets flagged to the admin when
 * there's no menu behind it.
 */
const CATERING_POLICIES = {
  ALWAYS: 'Always',
  BY_EXCEPTION: 'By exception',
  NEVER: 'Never'
};
const CATERING_POLICY_OPTIONS = Object.values(CATERING_POLICIES);

/**
 * Seeded into Config on setup; edit there afterward, not here. An unknown
 * location falls back to ALWAYS — the safe direction, since a location that
 * wrongly shows up is a visible nuisance while one that wrongly hides is a
 * missed lunch order.
 */
const DEFAULT_CATERING_POLICY_BY_LOCATION = {
  Narberth: CATERING_POLICIES.ALWAYS,
  Ashbridge: CATERING_POLICIES.BY_EXCEPTION,
  Zoom: CATERING_POLICIES.NEVER
};
const FALLBACK_CATERING_POLICY = CATERING_POLICIES.ALWAYS;

// ---------------------------------------------------------------------------
// AUTOMATION KILL SWITCH + TRIGGER OWNERSHIP  (Config -> "⚙️ Automation & Trigger Ownership")
// ---------------------------------------------------------------------------
//
// THE PROBLEM THESE EXIST FOR. Apps Script installable triggers are private
// to the Google account that created them. ScriptApp.getProjectTriggers()
// returns only what the CURRENTLY RUNNING account can see, and
// ScriptApp.deleteTrigger() can only delete those. So when two accounts have
// each run "Check Triggers", both own a full set, both sets fire, and
// NEITHER account can see or remove the other's from code. writeTriggers()
// documents this at length; resetTriggersForHandler() fixes it only within
// one account.
//
// What IS shared across every account on this project: Script Properties,
// and this spreadsheet. That asymmetry is the whole design here — no account
// can DELETE another's trigger, but every account can write state that the
// other account's trigger will read and obey when it fires.
//
//   Automation_Enabled    A kill switch any account can flip. Every managed
//                         handler reads it as its first act and returns
//                         immediately when it's "No". You still cannot delete
//                         a trigger you can't see — but you can make it a
//                         no-op from your own login, without editor access.
//   Trigger_Owner         The one account that is supposed to hold the
//                         triggers. writeTriggers() refuses to run from any
//                         other account, which is what stops a SECOND
//                         invisible set from ever being created. The admin
//                         list (AUTHORIZED_ADMIN_EMAILS) holds more than one
//                         account on purpose; this narrows trigger creation
//                         to exactly one at a time without shrinking it.
//   Triggers_Verified_At  When that owner last rebuilt them, so "is this
//                         claim stale?" is answerable.
//
// See also recordHandlerRun() — the runtime detector that catches duplicate
// sets even when nobody has kept any of this bookkeeping honest.
// ---------------------------------------------------------------------------

const AUTOMATION_ENABLED_OPTIONS = ['Yes', 'No'];

/**
 * FAILS OPEN, and that is the opposite of requireAuthorizedAdmin() on
 * purpose. A blank/unreadable cell reads as ENABLED.
 *
 * The two failure costs are not symmetric. Wrongly enabled means one extra
 * sync, which is idempotent and self-correcting. Wrongly disabled means
 * every calendar sync and registration import silently stops — and because
 * nothing visibly breaks (the sheet just quietly goes stale), that can run
 * for weeks before anyone notices a registration never arrived. So a Config
 * tab that is missing, mid-rebuild, or throwing must never be able to
 * switch automation off by accident. Only the literal string "No" does.
 */
const DEFAULT_AUTOMATION_ENABLED = true;

/**
 * The handlers the kill switch governs, and that recordHandlerRun() attributes.
 *
 * onProgramFlagEditInstallable is DELIBERATELY NOT HERE, though writeTriggers()
 * installs it alongside these. The kill switch exists to stop AUTOMATION —
 * things that run on their own, at their own times, while nobody is watching.
 * That handler runs because somebody just clicked a checkbox, and it writes
 * exactly what they asked for. Pausing automation should not mean a tick
 * silently fails to save; the queue behind it would fill up instead, and the
 * next unpause would deliver a pile of changes nobody remembers making. It is
 * still listed by showTriggerStatus() as a trigger the workbook expects.
 */
const MANAGED_AUTOMATION_HANDLERS = ['syncCalendars', 'syncRegistrations', 'onCalendarChange', 'autoCreateTodaysSignInSheets'];

/** Every trigger writeTriggers() maintains — the automation ones plus the edit handler. */
const EXPECTED_TRIGGER_HANDLERS = MANAGED_AUTOMATION_HANDLERS.concat(['onProgramFlagEditInstallable']);

/**
 * Cross-execution cache TTL for the kill-switch read. onCalendarChange can
 * fire many times a minute during a busy calendar edit; without this, each
 * firing pays a spreadsheet open just to learn it should stop. A minute of
 * staleness on a pause is a fine trade — the point of the switch is stopping
 * a runaway within minutes, not within milliseconds.
 */
const AUTOMATION_FLAG_CACHE_SECONDS = 60;
const AUTOMATION_FLAG_CACHE_KEY = 'AUTOMATION_ENABLED_FLAG';

/** Script Property prefix for the per-handler "which accounts actually ran this" record. */
const HANDLER_ATTRIBUTION_PROP_PREFIX = 'HANDLER_RUN_BY_';

/**
 * How far back recordHandlerRun() looks when deciding whether more than one
 * account is firing the same handler. Wide enough that the once-daily
 * syncCalendars trigger is caught (two accounts' daily triggers can be up to
 * ~24h apart), which is the slowest handler and therefore what sets the floor.
 */
const HANDLER_ATTRIBUTION_WINDOW_MS = 26 * 60 * 60 * 1000;

/** How long an account's stamp for a handler suppresses re-stamping — see recordHandlerRun(). */
const HANDLER_ATTRIBUTION_THROTTLE_SECONDS = 10 * 60;

const FORM_FOOTER_BY_LOCATION = {
  Narberth: 'Additional notes or dietary needs? Let us know here.',
  Ashbridge: 'Additional notes or dietary needs? Let us know here.',
  Zoom: 'Additional notes? Let us know here.'
};
const DEFAULT_FORM_FOOTER = 'Additional notes or dietary needs?';

/**
 * WHERE EACH LOCATION ACTUALLY IS, as it goes at the top of every form.
 *
 * A form said "Location: Narberth" and stopped, which is the whole address to
 * somebody who has been coming for years and no address at all to the person
 * the form was built to reach. The centre runs at two buildings a fifteen
 * minute drive apart and a new registrant has no way to tell from the form
 * which one they are signing up for.
 *
 * A location with no entry here — Zoom, and anything typed onto the calendar
 * that is not one of the two buildings — simply reads as its own name, exactly
 * as it did before. Nothing invents an address.
 */
const LOCATION_ADDRESSES = {
  Narberth: '100 Conway Avenue, 2nd Floor, Narberth, PA',
  Ashbridge: 'Ashbridge House, Ashbridge Park, Bryn Mawr, PA'
};

/** "Narberth — 100 Conway Avenue, 2nd Floor, Narberth, PA" — a location as a form names it. */
function describeLocationWithAddress(locationName) {
  const name = String(locationName || '').trim();
  const address = LOCATION_ADDRESSES[name];
  return address ? `${name} — ${address}` : name;
}

/**
 * THE ONE PLACE THE CENTER'S CONTACT DETAILS LIVE.
 *
 * They appear in three registrant-facing places that must never disagree with
 * each other: the sign-off at the bottom of every form description
 * (buildFormDescription()), the "more than three guests" note on the guest
 * count question (see getOrCreateTemplateForm()), and the printed sign-in
 * sheet's header. Change them here and all three follow.
 */
const CENTER_PHONE = '(610) 664-2366';
const CENTER_EMAIL = 'info@newhorizonsseniorcenter.org';

/** The standing sign-off appended to every form description. */
const FORM_ASSISTANCE_TAGLINE =
  `If you need additional assistance, please call ${CENTER_PHONE} or email ${CENTER_EMAIL}`;

const SYNC_LOOKAHEAD_DAYS = 60;
const LAST_SYNC_PROP_KEY = 'LAST_FORM_SYNC_TIME';

const FORMS_FOLDER_ID = '';
const FORMS_FOLDER_NAME = 'Program Registration Forms';

/** Returns the dedicated forms folder — by hardcoded ID if set, else find-or-create by name. */
function getOrCreateFormsFolder() {
  if (FORMS_FOLDER_ID) {
    try {
      return DriveApp.getFolderById(FORMS_FOLDER_ID);
    } catch (err) {
      log(`⚠️ FORMS_FOLDER_ID "${FORMS_FOLDER_ID}" could not be opened (${err}) — falling back to a by-name lookup.`);
    }
  }
  const folders = DriveApp.getFoldersByName(FORMS_FOLDER_NAME);
  if (folders.hasNext()) {
    const folder = folders.next();
    log(`📋 Using existing "${FORMS_FOLDER_NAME}" folder — copy this ID into FORMS_FOLDER_ID to skip this lookup next time: ${folder.getId()}`);
    return folder;
  }
  const folder = DriveApp.createFolder(FORMS_FOLDER_NAME);
  log(`Created Drive folder "${FORMS_FOLDER_NAME}" for generated registration forms. 📋 Copy this ID into FORMS_FOLDER_ID: ${folder.getId()}`);
  return folder;
}

