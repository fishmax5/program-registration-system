// ============================================================================
// 16b. THE WALK-IN SIGN-IN PAGE — RETIRED (September 2026)
// ============================================================================
//
// This file used to hold the door's own sign-in page: the one a location link
// opened on, which asked "who are you", "what are you here for", and "are you
// coming back", and which was reached at ?mode=walkin once the door app took
// the bare URL. Somebody will come looking for it, so:
//
//   THE PAGE IS NOW 73_door_app_html.gs (section 16g), served by doGet() with
//   no ?mode= at all. It asks the same three questions and one more the old
//   page could not — which building and which day this tablet is standing at,
//   asked once and remembered — so there is one address to hand out instead of
//   a query string a volunteer has to get right.
//
//   THE SERVER HALF DID NOT GO ANYWHERE. readWalkInDay(), walkInDay(),
//   walkInSignIn(), readWalkInMembers() and recordWalkInMember() are live: the
//   door app reads and writes through them, and the boot store (section 16d)
//   builds its snapshot from the same read. They are in
//   74_door_day_and_sign_in.gs (section 16h), which is where they belong now
//   that no page in this project is named after them.
//
//   checkInRosterModeRequested() — which decides whether a URL is asking for
//   the staff roster — moved to 60_check_in_page_server.gs, beside the doGet()
//   that calls it.
//
// WHAT WAS DELETED: buildWalkInHtml() and the page's template literal, and the
// ?mode=walkin / walk-in / legacy branch in doGet(). A bookmark still carrying
// one of those modes is not an error — an unrecognized mode has always fallen
// through to the default, so it opens the door app, which is the page whoever
// is holding that bookmark wanted.
//
// THE FILE IS KEPT, EMPTY, ON PURPOSE. Renumbering or removing a file is the
// one edit this project does not make (see CLAUDE.md): the prefixes are how
// every cross-reference in the codebase and in that document points at things.
// ============================================================================
