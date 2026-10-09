// ============================================================================
// 99zma. WHO SEES WHICH MENU  (the role table)
// ============================================================================
//
// Numbered after `99zm` (the Health panel, which landed in the same change)
// for the usual reason — never renumber. Safe there: behavior plus constants
// that stand alone (the menu names are spelled HERE, so the table below reads
// nothing from another file at load), and everything it reaches for —
// `listAuthorizedAdminEmails` / `getCurrentUserEmail` (`01`),
// `getAllAdminNotificationEmails` (`15`) — it reads at CALL time.
//
// WHY. One 99-item menu for everybody meant the desk scrolled past "Destroy &
// Rebuild Forms" to find the sign-in sheet. The menu is now three — Desk,
// Coordinator, Admin — and which of them a viewer gets is decided by ONE table
// rather than by `if`s scattered through `16`. Change who sees what here.
//
// THE FAILURE THIS MUST NEVER REPRODUCE. A simple `onOpen` trigger frequently
// cannot see the account (consumer Gmail; a viewer from another domain), and
// the last time a menu was hidden from an account onOpen could not identify, a
// genuine admin opened the workbook to find no Admin menu at all. So a blank
// account is its own role, `unknown`, and `unknown` gets EVERYTHING. That
// costs nothing: a hidden menu was never a permission (see `16`'s banner), and
// every irreversible item still asks `requireAuthorizedAdmin()` itself. Any
// failure in resolving the role is also `unknown` — never `staff`.
//
// ADMIN, FOR MENU PURPOSES, is `listAuthorizedAdminEmails()` (`01`) PLUS every
// address on Config's Admin Notification Emails table. The Config half lets the
// office decide who SEES Admin without editing source; it does not widen who
// may RUN a gated action, because `ADMIN_GATED_ACTIONS` is untouched.
//
// See docs/transitions/R4_menus_health.md for every item's new home.

const DESK_MENU_NAME = '🛎️ Desk';
const COORDINATOR_MENU_NAME = '📋 Coordinator';
const ADMIN_MENU_NAME = '🔧 Admin';

/**
 * The menu messages elsewhere point people at ("… on the ${APP_MENU_NAME}
 * menu"). It was the one menu; it is now the Coordinator menu, which is where
 * Settings & Fixes and everything those messages name live.
 */
const APP_MENU_NAME = COORDINATOR_MENU_NAME;

/** The three roles. `unknown` is a blank account, and is treated as admin. */
const MENU_ROLES = { ADMIN: 'admin', STAFF: 'staff', UNKNOWN: 'unknown' };

/**
 * THE TABLE. One row per top-level menu, in the order they appear on the
 * toolbar, naming the roles that get it. `builder` is the `16` function that
 * fills it. A role missing from the Admin row is what earns the "🔧 Admin
 * Tools (sign-in check)…" item on Coordinator instead (`menuRoleSees`).
 *
 * Rollback in one edit: add 'staff' to the admin row.
 */
const MENU_ROLE_TABLE = [
  { menu: 'desk', title: DESK_MENU_NAME, builder: 'buildDeskMenu_', roles: ['admin', 'staff', 'unknown'] },
  { menu: 'coordinator', title: COORDINATOR_MENU_NAME, builder: 'buildCoordinatorMenu_', roles: ['admin', 'staff', 'unknown'] },
  { menu: 'admin', title: ADMIN_MENU_NAME, builder: 'buildAdminMenu_', roles: ['admin', 'unknown'] }
];

/** The rows of MENU_ROLE_TABLE a role gets, in toolbar order. */
function menusForRole(role) {
  const r = String(role || MENU_ROLES.UNKNOWN);
  return MENU_ROLE_TABLE.filter(row => row.roles.indexOf(r) !== -1);
}

/** Does `role` get the menu called `menu` ('desk' | 'coordinator' | 'admin')? */
function menuRoleSees(role, menu) {
  return menusForRole(role).some(row => row.menu === menu);
}

/**
 * The pure decision: an address and the admin list in, a role out. Blank is
 * `unknown`, never `staff` — see the banner.
 */
function menuRoleForEmail(email, adminEmails) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return MENU_ROLES.UNKNOWN;
  const admins = (adminEmails || []).map(a => String(a || '').trim().toLowerCase());
  return admins.indexOf(e) !== -1 ? MENU_ROLES.ADMIN : MENU_ROLES.STAFF;
}

/**
 * Who is looking at the workbook. getActiveUser() is the person at the
 * keyboard where Google will say; getCurrentUserEmail() (effective user) is
 * the fallback. Either throwing reads as blank. Never throws.
 */
function menuViewerEmail_() {
  let email = '';
  try {
    email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  } catch (err) { email = ''; }
  if (email) return email;
  try { return getCurrentUserEmail() || ''; } catch (err) { return ''; }
}

/** Every address that SEES the Admin menu. Config failing costs only its half. */
function menuAdminEmails_() {
  let list = [];
  try { list = list.concat(listAuthorizedAdminEmails()); } catch (err) { /* owner unreadable */ }
  try { list = list.concat(getAllAdminNotificationEmails()); } catch (err) { /* Config mid-rebuild */ }
  return list.map(e => String(e || '').trim().toLowerCase()).filter(Boolean);
}

/** The viewer's role. Any failure is `unknown` — the full menu. Never throws. */
function resolveMenuRole() {
  try {
    const email = menuViewerEmail_();
    if (!email) return MENU_ROLES.UNKNOWN;
    return menuRoleForEmail(email, menuAdminEmails_());
  } catch (err) {
    return MENU_ROLES.UNKNOWN;
  }
}
