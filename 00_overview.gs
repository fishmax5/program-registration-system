/**
 * ============================================================================
 *  🗓️  CALENDAR & FORM MANAGER  —  Program Registration + Lunch Ordering
 * ============================================================================
 *  Sheets:
 *    - Master_Program_Dashboard : "Today at Each Location" + the full
 *      per-session table, now split into an "Upcoming Sessions" sub-table
 *      and a "Past Sessions" sub-table (see section 7). The participation
 *      metrics used to sit here and now live on Program_Month, below.
 *    - Program_Month            : the same sessions, one row per program ×
 *      location × month instead of one row per date — the unit a form is
 *      made for. Derived and read-only: nothing is stored on it and nothing
 *      reads it back, so it can be deleted and is rebuilt on the next
 *      render. Carries the metrics block (see section 17).
 *      The session table no longer carries a Manual_Override column — it's
 *      fully calendar-derived every render (Location/Type_Tag stay
 *      editable dropdowns, but nothing on this table is protected from a
 *      deleted-event triage sweep or a counts recompute anymore). Event_Date
 *      is the first column, and the old separate Month column has been
 *      replaced everywhere by simply color-tinting the Event_Date cell
 *      itself (see getMonthColor()/applyMonthColorTint()).
 *    - Master_Lunch_Dashboard   : "Today's Lunch Needs" (unchanged, always
 *      at the very top) + the full catering schedule, now likewise split
 *      into "Upcoming Lunch Schedule" / "Past Lunch Schedule" sub-tables.
 *      Every row is one date PER LOCATION, so the row itself is tinted by
 *      location (LOCATION_COLOR_MAP / buildLocationRowTintRules()) — except
 *      the month-tinted Event_Date cell and the yellow hand-entry columns,
 *      which keep their own meaning.
 *    - Registrant_Dash          : one row per person per session, split
 *      into "Upcoming Registrants" / "Past Registrants" sub-tables. Leads
 *      with Event_Date (like every other date-bearing tab), then Location,
 *      Event and Event_Time so staff never scroll to see which session a row
 *      belongs to or when it runs, keeps Manual_Override and
 *      Order_Ahead_Flag, and trails with
 *      Party_ID (an internal grouping key — see Party_ID/Party_Size below)
 *      as the very last column. Re-ordering a HEADERS array no longer
 *      scrambles data already on the tab: readAllSectionedRows() re-aligns
 *      each row by header NAME (see buildHeaderProjection()).
 *    - Lunch_Schedule           : the day-by-day catering menu, now broken
 *      down PER LOCATION (one row per Event_Date x Location), with a
 *      "Not Serving" Type option — when a form covers a date that's marked
 *      Not Serving for its location, that date is dropped from the lunch
 *      grid entirely (no lunch choice offered) and its label is annotated
 *      "No Lunch Served" wherever it's shown. Also split into
 *      Upcoming/Past sub-tables like every other date-bearing tab.
 *    - Config                   : Meal Buffer Amounts (Location x Hot/Cold
 *      only — "Not Serving" never gets a buffer row) + Order Ahead Time +
 *      an Admin Notification Emails table (up to five people in the office,
 *      each ticked for what they are copied on: the sync digest, leader
 *      roster alerts, registrant reminders, calendar invitations — it
 *      replaced the single Admin Notification Email and Archive Copy
 *      Address cells) + Lunch Service by Location +
 *      Automation & Trigger Ownership (the kill switch and the trigger
 *      owner — see the multi-account note below). Unaffected by the
 *      Upcoming/Past split (it's a settings tab, not a per-date log).
 *    - Deleted_Event_Triage     : same Upcoming/Past split + Event_Date
 *      first-column/month-tint treatment as Registrant_Dash.
 *
 *  Notable behaviors:
 *    - All-day calendar events are skipped entirely.
 *    - Calendar-edit triggers are still torn down for the duration of every
 *      FULL syncCalendars() run and rebuilt immediately after (that sync
 *      itself edits calendar descriptions and would otherwise risk
 *      re-triggering itself). The trigger handler itself, onCalendarChange(),
 *      no longer always runs a full syncCalendars() though — see below.
 *    - CALENDAR INCREMENTAL SYNC: onCalendarChange() now uses the Calendar
 *      API's incremental-sync-token pattern (Calendar.Events.list with a
 *      saved syncToken) to fetch ONLY what changed since the last check,
 *      and only escalates to a full syncCalendars() reconciliation pass
 *      when that cheap delta actually contains something relevant (a new/
 *      modified/cancelled timed event in our tracked window). This requires
 *      the "Calendar" Advanced Service to be enabled on this Apps Script
 *      project (Editor -> Services -> + Calendar API) — see SETUP below.
 *    - EVENT GRAMMAR — the TITLE is just the program name; every SETTING
 *      lives in the event DESCRIPTION, in brackets:
 *        Title "Yoga Basics"           + description "[Cap: 12]"  -> capped at 12
 *        Title "Yoga Basics"           + description "[Grouped]"  -> one continuous
 *          series with ONE form, instead of a separate form per month
 *        Title "Yoga Basics"           + description "[Regular]"  -> a form per
 *          calendar month (the default, so this is only ever explicit intent)
 *        description "[Cap: 12, Grouped]" or "[Cap: 12] [Grouped]" -> both
 *        description "[All Locations]"  -> this event's sessions share ONE
 *          form with the same-titled sessions on EVERY other calendar,
 *          instead of one form per location. Composes with the above:
 *          "[Grouped, All Locations]" is one form for the whole series
 *          everywhere; "[Regular, All Locations]" is one form per month
 *          everywhere. Also spelled [Shared] / [All Sites] / [Combined] /
 *          [Multi-Site]. See SHARED_LOCATION_SCOPE, and the menu action
 *          "🔗 Link Program Across Locations…" which tags every location's
 *          events and moves the sessions already on the dashboard onto one
 *          form in a single step.
 *      [Fixed] and [Monthly] are still read as [Grouped] / [Regular], so no
 *      existing calendar description needs editing — see EVENT_TYPES.
 *      A title is what attendees read on a shared calendar, so scheduling
 *      jargon does not belong there. Brackets left in a TITLE are still
 *      honored as a legacy fallback (and logged) so existing calendars keep
 *      their capacity; see parseSettingsBrackets()/resolveEventSettings().
 *        Title "*Yoga Basics"          -> TENTATIVE. A leading "*" means the
 *          session isn't confirmed: no form is generated and no registry
 *          row is written, until the asterisk comes off. parseEventTitle()
 *          strips the asterisk from cleanTitle, and since computeEventId()
 *          keys off cleanTitle, confirming an event later produces the
 *          SAME Event_ID — it just flows through as a new session with no
 *          reconciliation. (Re-adding an asterisk to an already-confirmed
 *          event does NOT triage it; existing registrations are kept.)
 *          The asterisk is also how a CANCELLED occurrence is marked: an
 *          event named "*NO Tai Chi" stays visible on the calendar for
 *          staff and attendees while generating no form and no dashboard
 *          row.
 *        description "[Personalized Assistance]" -> this program is booked by
 *          TIME, not by date: each event is cut into back-to-back appointment
 *          slots ("[Slots: 20]" for a length other than the default), its form
 *          asks which slot rather than showing the roster grids, and a booked
 *          slot disappears from the form. "[Max Per Month: 1]" flags a repeat
 *          booking by the same person in one month. Also spelled
 *          [By Appointment] / [Appointments] / [1-on-1]. See ASSISTANCE_TAG,
 *          section 6g, and the Assistance_Requests tab — where somebody who
 *          can use none of the offered times is filed instead of being booked
 *          onto a date they did not choose.
 *    - A PROGRAM CAN ASK ITS OWN QUESTIONS. Program_Questions (section 6g) is
 *      one row per extra question — zip code, membership, which document —
 *      applied to the forms it names and RE-APPLIED after every template
 *      rebuild, which is what a question typed onto a live form by hand never
 *      survived. Three rules keep it additive: a custom question may not take a
 *      title the template reads by name (refused, with a note), its answers go
 *      into ONE Registrant_Dash column (Form_Answers) so the table's shape
 *      never depends on another tab, and it is added to both branch pages
 *      before "Anything Else?" without touching a page break or a template
 *      item. getAdminNotesResponse() reads "Anything Else?" BY TITLE for the
 *      same reason — it used to take the first paragraph item with an answer,
 *      which a custom paragraph question would have hijacked.
 *      A row is aimed at forms by Program, by Location, and by MATCH_KEYWORDS
 *      — words matched against the program titles, locations and bracket tags
 *      a form covers ("wills", "zoom", "club"), which is the aim that survives
 *      a program being renamed on the calendar. Besides questions, a row can
 *      be a NOTICE, an IMAGE, or a FORM DESCRIPTION injected above the first
 *      question; and a HEADER IMAGE row puts a picture at the very top of the
 *      form, above everything. "➕ Build a Form Question…" writes a row from a
 *      dialog — uploading the picture for you — and says which forms it would
 *      reach BEFORE it writes it.
 *    - THE REGISTRATION LINK injected into each event description is an
 *      HTML ANCHOR, not a raw URL, and carries no visible Form ID. The ID
 *      rides in the href's #fragment — invisible to the reader, ignored by
 *      Forms, still machine-recoverable so a lost form registry can be
 *      rebuilt instead of spawning duplicate forms. See
 *      buildRegistrationLinkLine()/findRegistrationLineInDescription().
 *    - REGISTRATION LINKS ARE PLAIN published form URLs, with nothing
 *      pre-ticked. They used to be prefilled with every box checked, on the
 *      theory that "all of us, all dates" is the common case — but a
 *      pre-ticked box asserts an answer on the respondent's behalf, and
 *      somebody who skims and submits has told us they are coming to
 *      sessions they never read. The "sign up for every date" option covers
 *      that case as an answer somebody actually gives. See
 *      buildRegistrationUrl().
 *    - THE REGISTRATION HORIZON (Config -> "🚧 Registration Open Through")
 *      is one date deciding how far ahead the public may sign up, for the
 *      ordinary case of a season built months before it opens. Sessions
 *      after that date are still imported, still get rows, still get a form
 *      and still appear on the calendar — but their event descriptions read
 *      "🚧 Registration Not Yet Open" instead of carrying a link, and a form
 *      whose remaining sessions are ALL past the date is built (or held)
 *      closed, with a closed-form message saying the same thing. Blank means
 *      no horizon, which is what every workbook had before it existed and
 *      what an unreadable cell falls back to. Moving the date forward is the
 *      whole act of opening registration: the next sync writes the links
 *      back and re-opens the forms. See REGISTRATION_NOT_OPEN_TEXT,
 *      shouldMarkNotYetOpen() for the per-event decision,
 *      applyRegistrationHorizonToNewForm() for the per-form one at build
 *      time, and applyRegistrationHorizonEffects() for the reconciler that
 *      makes a moved date take effect on programs with no new dates.
 *    - PER-LOCATION CATERING POLICY (Config -> "🍽️ Lunch Service by
 *      Location") is what keeps the lunch dashboard from filling with blank
 *      rows. Before it existed the only way to say "Zoom never serves lunch"
 *      was a per-date "Not Serving" row for every Zoom date forever, so in
 *      practice those dates read as merely unconfigured — seeded onto the
 *      dashboard AND asked about on forms. The three postures:
 *        Always        lunch unless a date says otherwise (a catering site)
 *        By exception  only dates with a real Hot/Cold row on Lunch_Schedule
 *        Never         no lunch at all — the location never reaches the
 *                      lunch dashboard, and createRegistrationForm() strips
 *                      both lunch questions off its forms entirely
 *      See isLunchOfferedOn(), which is the single place policy and the
 *      per-date override are reconciled.
 *    - THE LUNCH DASHBOARD LISTS EVERY UPCOMING date x location where lunch
 *      is on the table, even at zero registrants, so staff can plan against
 *      (and hand-enter buffers on) dates nobody has signed up for yet. Past
 *      dates are never back-seeded.
 *    - DEMAND ALWAYS WINS over policy. Policy only decides what gets SEEDED;
 *      a date somebody is actually registered to eat on always appears, and
 *      if no Hot/Cold menu backs it, the admin digest says so. That is the
 *      safety net for "By exception" — forgetting a menu row can leave a
 *      date off the plan, but never off the plan once a real person is
 *      expecting to be fed.
 *    - ADMIN NOTIFICATIONS: set an address in Config to get ONE digest per
 *      sync covering only things needing a human — waitlisted registrants,
 *      forms that couldn't be opened, events sent to triage. A sync with
 *      nothing to report sends nothing. Blank address = disabled.
 *    - PROGRAM LEADERS (Program_Leaders, sections 9c/9d): who leads each
 *      program, where to write to them, and whether they want to hear about
 *      it. One row per leader per program-at-a-location — the same privacy
 *      grain as the shared sign-up sheets, so the two can never disagree
 *      about who may read what. Tick Notify_Roster_Changes and that leader
 *      gets ONE email per sync naming what actually moved on their rosters:
 *      who signed up, who is gone, who came off the waitlist, whose party
 *      grew. A sync where nothing changed sends nothing at all. Rides the
 *      same hourly registration sync as everything else here — no new
 *      trigger. Replaces Program_Options' old Instructor_Email column, whose
 *      addresses are carried onto the new tab automatically the first time
 *      a sync runs (migrateProgramLeaderAddresses()).
 *    - REGISTRANT NOTIFICATIONS (Program_Options' Notify_Mode and
 *      Reminder_Days, section 9e): how often each PROGRAM writes to the
 *      people signed up for it. Two channels under one dropdown — the
 *      calendar invite that puts them on the real event's guest list, and a
 *      reminder email this workbook sends N days before, comma-separated,
 *      0 meaning the morning of. Left blank a program keeps its kind's usual
 *      behavior: everything ordinary is invited and nothing more, exactly as
 *      before these columns existed, while a Personalized Assistance program
 *      also emails the person their OWN appointment time — when they book,
 *      and again the day before. That time can only be said in mail: a
 *      calendar event has one description shared by every guest. Every send
 *      is ledgered per person per offset, so an hourly sync never repeats
 *      one. Config's "Calendar Invitations" switch still wins over any row.
 *    - ONE FORM TEMPLATE, ONE BRANCH POINT. Every group — Grouped or Regular
 *      — is built from the same template, and "Attendance Mode" is now on
 *      every form:
 *        "Everyone, every date"          -> one number, the TOTAL meals that
 *          party wants (0 to MAX_MEALS_PER_SUBMISSION), applied to every
 *          session date, including dates added to a Grouped series afterward
 *          (see the ALL_DATES registry + applyAllDatesCatchup()).
 *        "Let me pick specific dates/people" -> two grids, both with dates as
 *          ROWS: "Who is Attending Each Date?" with PERSON_COLUMN_LABELS as
 *          columns, and "How Many Meals Each Date?" with 0-4 as columns.
 *          Full per-person, per-date attendance: any guest can attend or skip
 *          independently of any other. MEALS, though, are one number per date
 *          — see TEMPLATE_VERSION's v9 note — and land on the registrant's own
 *          row, because a total is not divisible into people the form never
 *          asked about. Ordering a meal on a date nobody ticked is not
 *          silently dropped: processFormResponse() reconciles it as attending
 *          and flags it in Admin_Notes.
 *      There is NO "how many guests?" question: page 1 has three optional
 *      guest-name fields and the headcount is simply how many were filled
 *      in. That kills two bugs by construction — the old "said 3, named 2,
 *      catered for 2" mismatch, and mis-routing between guest-count branch
 *      pages (Forms silently falls through to the NEXT section when an
 *      explicit after-section jump isn't applied, which is how picking 2
 *      guests could land you on the 3-guest page). The whole form now has
 *      exactly two page breaks and two navigation rules, both to SUBMIT.
 *      A grid column whose guest name was left blank is ignored at parse
 *      time, so the pre-checked columns for guests you didn't bring cost
 *      nothing.
 *    - OUR OWN CALENDAR EDITS MUST NOT COME BACK AS WORK. Removing the
 *      calendar-edit triggers during a sync stops them FIRING, not the
 *      changes accumulating — so re-creating them afterwards handed
 *      onCalendarChange() one queued description write per event, each of
 *      which escalated to a full syncCalendars(). An import of 272 events
 *      became a queue of full syncs. primeCalendarSyncTokens() now advances
 *      each calendar's sync token past our own edits immediately before the
 *      triggers go back on (in syncCalendarsInternal()'s finally, and at the
 *      end of a bootstrap).
 *    - TRIGGERS ARE RESET, NOT PATCHED. writeTriggers() used to add a
 *      trigger only if none existed, which cannot clean up a duplicate once
 *      one is there. The real-world case: Apps Script installable triggers
 *      are private to the Google account that created them, so a second
 *      person running "Check Triggers"/initSheet() from their own login
 *      creates a SECOND, mutually invisible set of calendar-edit triggers —
 *      both then fire on every edit, forever. writeTriggers()/
 *      writeCalendarChangeTriggers() now delete every trigger for a managed
 *      handler THIS ACCOUNT can see and recreate exactly the intended set,
 *      every time — see resetTriggersForHandler(). That fixes same-account
 *      duplication outright; cross-account duplication needs a human to
 *      open the Apps Script editor's Triggers page (which — unlike the
 *      API — lists every trigger regardless of creator) and delete the
 *      other account's copies, and to agree only one account manages
 *      triggers going forward.
 *    - MULTI-ACCOUNT TRIGGER COORDINATION. "Agree only one account manages
 *      triggers" is not something an agreement can enforce, so it is now
 *      enforced in code. Three parts, in Config's "⚙️ Automation & Trigger
 *      Ownership" section and in section 3a:
 *        1. WHERE THE SECOND SET ACTUALLY CAME FROM. It was mostly not
 *           "Check Triggers" — that's admin-gated and rarely pressed.
 *           syncCalendarsInternal() tears the calendar-edit triggers down
 *           and rebuilt them in its `finally`, and syncCalendars() is
 *           deliberately UNGATED (top menu item, used daily by anyone with
 *           edit access). So every "Sync Cal" click by a non-owner removed
 *           nothing and then created a whole set under that account. That
 *           finally is now RESTORE-ONLY: an account that held none before
 *           the sync ends with none.
 *        2. Trigger_Owner records the one account allowed to build
 *           triggers. writeTriggers() and bootstrapCalendars() refuse from
 *           anyone else and name the owner, so an account that cannot see
 *           the triggers at least learns who to ask. Moving it is a
 *           deliberate act (takeOverTriggerOwnership()) that says plainly
 *           it cannot delete the old owner's copies.
 *        3. Automation_Enabled is a kill switch every managed handler reads
 *           first. Script-level state is shared across accounts even though
 *           triggers are not — so this is the only lever that reaches a
 *           trigger you have no power to delete. It cannot remove the
 *           duplicate, but it stops it firing, from any account, without
 *           editor access.
 *      And because all of that is still bookkeeping that can be bypassed by
 *      running a function straight from the script editor, recordHandlerRun()
 *      stamps who each handler ACTUALLY ran as (an installable trigger runs
 *      as its creator). Two accounts seen firing one handler is duplicate
 *      sets, observed rather than inferred — "Admin → Trigger Status" shows
 *      that next to what this account can see and what Config claims, and it
 *      is the disagreement between the three that identifies the problem.
 *    - TRIAGE DISTRUSTS ITSELF. triageDeletedSessions() is the only thing
 *      that removes sessions, and "the calendar didn't come back" used to
 *      read identically to "every session was deleted." It now ignores
 *      calendars it could not READ, ignores rows it cannot attribute to one
 *      it did read, refuses any sweep that would take out most of the table
 *      (TRIAGE_MAX_SESSIONS_PER_RUN / TRIAGE_MAX_FRACTION_PER_RUN, overridden
 *      once by confirmLargeTriage()), and stands down entirely while a
 *      bootstrap import is writing the table. restoreTriagedRegistrants()
 *      puts rows back if a sweep did fire wrongly — necessary because the
 *      import only reads responses newer than the last sync, so a triaged
 *      registrant exists nowhere else.
 *    - THE FIRST IMPORT IS A SLICED JOB, NOT A SYNC. syncCalendars() is cheap
 *      only because it normally has nothing to do. Importing a real calendar
 *      from scratch — a form per program, a description write per event —
 *      does not fit in one six-minute execution, and a timeout there is
 *      destructive: no `finally` runs, so the calendar triggers stay removed
 *      and the persistent form registry never gets flushed (which duplicates
 *      forms on the next attempt). bootstrapCalendars() (section 4b) pauses
 *      every trigger, imports in budgeted slices that hand off to each other
 *      via one-off triggers, and rebuilds the triggers only when it's done.
 *      syncCalendars()/syncRegistrations() stand down while it runs, and
 *      writeTriggers() refuses to put the paused ones back until it
 *      finishes — a pause is only as good as the paths that can undo it, and
 *      an import that spans half an hour gives "Check Triggers" plenty of
 *      chances. Each slice re-asserts the pause as well.
 *    - LIVE FORMS ARE MIGRATED, NOT JUST THE TEMPLATE. A group's form is
 *      created once and reused for as long as the group runs, so bumping
 *      TEMPLATE_VERSION only ever fixed forms created afterward — everyone
 *      filling in an existing form still met the old questions (and the old
 *      mis-routing). migrateFormsToCurrentTemplate(), which runs at the end
 *      of every syncRegistrations() import, rebuilds any form still on an
 *      older template IN PLACE, keeping its Form ID so every link, registry
 *      entry and calendar description stays valid. Forms already on the
 *      current template are stamped and thereafter skipped without an API
 *      call. Run recheckAllRegistrationForms() from the editor to force a
 *      re-check (e.g. after hand-editing a form).
 *    - AND REPAIRED IN PLACE BEFORE THEY ARE REBUILT. A rebuild is the
 *      sledgehammer: every question replaced, every pre-checked box
 *      regenerated, five forms an execution. Most template changes move far
 *      less than that — v8 moved page-navigation settings and nothing else,
 *      v9 swapped three lunch questions for two — so
 *      runFormStateMigrations() (68_form_state_migrations.gs) runs first,
 *      writing only what is wrong on each live form and stamping the form
 *      current when its migrations cover the whole of that version. What is
 *      left for the rebuild pass is the forms a migration could not recognize.
 *      A migration also says WHICH forms it is for, from the dashboard rows
 *      alone: the v8 routing repair is aimed at the single-session and
 *      appointment forms, the only two shapes whose respondents could ever
 *      meet the misplaced setting, so no other form is opened at all. (The
 *      v9 meal swap is for every form, and does its own cheap check on the
 *      titles once the form is open.)
 *      Admin -> "Fix Forms In Place (no rebuild)" forces the same sweep,
 *      and hands itself on until every form has been looked at.
 *    - NO LUNCH MEANS NO LUNCH QUESTION. The meal grid only ever lists
 *      dates that actually serve lunch (buildDateLabelSets()), and when NO
 *      date on a form does — or the location never caters —
 *      syncLunchQuestionsOnForm() takes both meal questions off the form
 *      entirely and says so in the description. They come back on their own
 *      if a catered date later appears. On the data side buildRegistrantRow()
 *      gates lunch demand on isLunchOfferedOn(), so the "everyone, every
 *      date" branch's single meal total can't book a meal on a
 *      Not-Serving date.
 *    - The template calls setCollectEmail(true) and
 *      setAllowResponseEdits(true) — a submitter's email becomes a real
 *      identity key, Google auto-sends a receipt with an edit link, and
 *      Form_Source on Registrant_Dash links straight to that
 *      person's own submission (response.getEditResponseUrl()) instead of
 *      to the shared form editor.
 *    - Allergies / dietary needs is its own required-free text field,
 *      separate from the free-text "Anything Else?" catch-all — previously
 *      a single "Footer Note" paragraph item did double duty as both
 *      display text and the admin-notes scan target. The per-location
 *      note itself is now a non-input SectionHeaderItem.
 *    - Party_ID (= the Google Form response ID) and Party_Size (headcount
 *      including the registrant) are stamped on every row from the same
 *      submission, so staff can see "party of 3, one no-show" at a glance
 *      on Registrant_Dash.
 *    - Name-based identity (dedup / manual-edit protection / the "sign up
 *      for all dates" registry) is matched case/whitespace-insensitively
 *      via normalizeNameKey() — "Jane Smith" and "jane smith " are the same
 *      person. The Name column itself still displays exactly as typed.
 *    - RESUBMISSIONS ARE APPLIED, NOT DROPPED: buildRegistrantRow() keys
 *      identity on Event_ID+Name+Person_Type, same as before, but now also
 *      tracks each row's Party_ID (the originating Response ID). A response
 *      re-seen under the SAME Party_ID (an edit via the "edit response"
 *      link — see setAllowResponseEdits(true) above) patches that one row
 *      in place. A DIFFERENT Party_ID for the same identity — a genuinely
 *      new submission — marks the old row Program_Status/Lunch_Status =
 *      'Superseded' (kept, not deleted, with a note in Admin_Notes) and
 *      inserts the new row as the live truth. 'Superseded' rows are
 *      excluded from every active/waitlist count automatically, the same
 *      way 'Cancelled' already was.
 *    - CANCELLATION HAS THREE DOORS AND ONE WRITER (section 67). Setting
 *      Program_Status = 'Cancelled' has always been how a seat comes back,
 *      and for a long time the only way to say it was to type it into the
 *      dropdown on the Registrants tab — which meant the people who actually
 *      LEARN that somebody is not coming had no way to record it. Now:
 *        * the check-in page has a cancel button beside each unticked name;
 *        * a program leader's "Dropped" tick on their shared sheet becomes a
 *          cancellation on the next sync (applyLeaderDropsAsCancellations(),
 *          run inside syncRegistrations() right after the leader merge);
 *        * the member cancels their own place from the link this system now
 *          writes into the calendar event description beside the register
 *          link — ?mode=cancel&form=<formId> on the web app, identified by
 *          their name plus the phone or email already on their row.
 *      All three end at cancelRegistrantRows(), which writes FOUR cells:
 *      Program_Status, Lunch_Status, Manual_Override (without which the next
 *      hourly import re-derives the row from its form response and reverses
 *      the cancellation), and an Admin_Notes stamp naming the door, the date
 *      and any reason given. A member's guests are cancelled with them.
 *    - CAPACITY IS VISIBLE ON THE FORM: whenever a capped session hits 0
 *      Remaining_Seats, its date label on both roster grids gets a
 *      CAPACITY_HINT_SUFFIX ("(FULL - Waitlist)") appended — see
 *      buildCapacityHintsFromRegistryRows() / refreshFormShapeForAllForms(),
 *      called at the end of every syncRegistrations() once Remaining_Seats
 *      is fresh. Converts silent waitlisting into something a respondent
 *      actually sees before submitting. A plain hyphen is used (not the em
 *      dash meal-hint separator) so stripMealHint() can strip both
 *      unambiguously when matching a grid row back to its Event_ID.
 *    - Template forms are cached forever in Script Properties, keyed by
 *      TEMPLATE_VERSION — bump that constant whenever the template
 *      structure changes so existing cached forms don't silently drift out
 *      of sync with the parser.
 *    - Form descriptions list dates one-per-line.
 *
 *    - A DELETED REGISTRATION STAYS DELETED. Three separate paths used to put
 *      one back — the all-dates registry, the club roster, and a re-imported
 *      form response — so deleting rows looked like it simply did not work.
 *      Deleting now records a TOMBSTONE per person per session, and
 *      buildRegistrantRow() (the single funnel all three paths build rows
 *      through) refuses a tombstoned key. A genuinely new submission lifts it;
 *      re-reading the response the deletion was aimed at does not. See section
 *      5c.
 *    - QUICK MARK IS A DIALOG, not a band of cells above the tables. See
 *      section 6d for what that fixed. Registrant_Dash's tables start at row 1.
 *    - RENAMING A PROGRAM MOVES IT, RATHER THAN REPLACING IT. cleanTitle is an
 *      input to computeEventId(), the group key, computeClubKey() and
 *      Program_Options' key, so a title change used to re-key a program's
 *      sessions (triaging every one of them and their registrants), detach a
 *      club's standing roster, and orphan the staff's own notes — three of
 *      those four silently. detectRenamedPrograms() now recognizes the pattern
 *      before anything acts on it and applyProgramRenames() moves all seven
 *      stores onto the new name. The form is kept and retitled to match
 *      (renameFormForGroup()), so links already handed out keep working and
 *      stop advertising the old name. Event_ID itself was deliberately NOT
 *      re-keyed onto the calendar's event UID: the current hash is identical
 *      across an event being deleted and re-created, which staff here do
 *      often. See section 4e.
 *
 *  PERFORMANCE / CACHING CONTRACT (see section 1c):
 *    Everything expensive in a sync is a REMOTE call — a Sheets read, a
 *    FormApp call, a CalendarApp fetch, a Script Properties round trip — so
 *    the optimization work is all about not making the same one twice.
 *      - Per-EXECUTION caches (Apps Script globals, which die with the run,
 *        so there is no cross-run staleness to reason about): the
 *        Lunch_Schedule meal index, Config's meal buffers + order-ahead
 *        days, open form handles (openFormCached()), per-form item lookups,
 *        and the calendar event fetch. Each is
 *        dropped by whatever rewrites its source — invalidateMealInfoIndex()
 *        from renderLunchScheduleSheet(), invalidateConfigCaches() from
 *        buildConfigSheet(), invalidateFormItemIndex() from
 *        applyFormDateLabels(), invalidateCalendarEventsCache() from the
 *        calendar-delta handler. ADD A NEW CACHE ONLY WITH ITS INVALIDATOR.
 *      - Batched Script Properties: the form registry, the all-dates
 *        registry, and the form-label fingerprints are read once and written
 *        at most once per run via flushPersistentRegistries(), called as
 *        soon as each dirtying loop finishes rather than at the very end.
 *      - Fingerprinted form writes: applyFormDateLabels() hashes the labels
 *        it is about to write and skips the entire FormApp round trip when
 *        they match what this script last wrote to that form. Since the
 *        hourly capacity-label refresh normally has nothing to change, the
 *        common case costs zero Forms calls. The fingerprint only tracks
 *        THIS script's writes — a hand-edited form is not detected until
 *        the labels legitimately change again (pass { force: true }).
 *      - Rows already in memory are threaded, not re-read: syncRegistrations()
 *        reads each tab once and hands the rows to the count recompute, the
 *        dashboard render, and the lunch rollup. renderProgramDashboard()
 *        reports registrantsMoved back so a caller knows when its copy went
 *        stale under a triage sweep.
 *    Bulk sheet WRITES were already batched (one setValues/setBackgrounds/
 *    setFormulas per block, never a per-cell loop) — keep it that way.
 *
 *  SETUP:
 *    1. Update CALENDAR_MAP below with your real Calendar IDs -> locations.
 *    2. In the Apps Script editor: Services (+) -> add "Google Calendar API"
 *       (the Advanced Service — this is required for the incremental
 *       calendar-edit sync in section 3b; without it, onCalendarChange()
 *       will fail with "Calendar is not defined").
 *    3. Run initSheet() once (from the editor) to build all tabs, formatting,
 *       AND the triggers.
 *    4. Fill in the Lunch_Schedule tab (now one row per date PER LOCATION)
 *       and Config's Meal Buffer Amounts + Order Ahead Time.
 *    5. Reload the sheet to see the "🗓️ Calendar & Form Manager" menu.
 *    6. FIRST IMPORT: use "Import Everything (First Run)" in that menu
 *       (bootstrapCalendars()), NOT "Sync Cal". The first import has to
 *       build a form for every program on every calendar, which is far more
 *       than one Apps Script execution can do — the bootstrap slices it
 *       across as many runs as it takes and pauses every trigger until it's
 *       finished. See section 4b. initializeAndSyncAll() does steps 3 and 6
 *       in one go.
 * ============================================================================
 */

