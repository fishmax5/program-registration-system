// ============================================================================
// LAZY GLOBALS — why a derived constant is not a `const`
// ============================================================================
//
// Every `.gs` file at the root is ONE Apps Script project sharing ONE global
// scope, and the project evaluates them in whatever order it has them stored.
// The numeric prefixes ask for filename order; they do not enforce it. A
// GitHub-sync extension that writes files back most-recently-edited-first, or
// anyone reordering things in the web editor, and suddenly
// `03_sheets_and_headers` is evaluated before `02_palette_and_tags`.
//
// That used to be fatal. A top-level
//
//     const LOCATION_COLOR_MAP = { 'Narberth': PALETTE.LOC_PEACH, ... };
//
// reads PALETTE AT LOAD TIME, so with the two files swapped it threw
// `ReferenceError: PALETTE is not defined` — on open, for every user, before
// any menu was drawn, with a dialog nobody could dismiss their way out of.
// There were 34 such cross-file reads across 12 constants: the whole class of
// bug was one stray reorder away at all times.
//
// The fix is to stop reading anything at load time. `defineLazyGlobal_` binds
// the NAME immediately and defers the VALUE until something actually asks for
// it — which is always after every file has finished evaluating. Function
// declarations are hoisted across the entire project, so this helper is
// callable from a file that sorts before it just as well as after.
//
// Call sites do not change: `HEADERS.Registrants` and `PALETTE.LOC_PEACH` read
// exactly as they did. The value is built once and memoized.
//
// USE THIS whenever a top-level constant's initializer mentions a constant
// declared in a different file. A constant whose initializer is self-contained
// (PALETTE, SHEET_NAMES, EVENT_TYPES) can stay an ordinary `const` — nothing it
// needs can be missing.

/**
 * Define `name` on the global scope, computing it on first read.
 *
 * @param {string} name    The global's name — the same identifier call sites use.
 * @param {function(): *}  factory Builds the value. Runs at most once, on the
 *                         first read, by which point every file has loaded.
 */
function defineLazyGlobal_(name, factory) {
  let value;
  let built = false;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get: function () {
      if (!built) {
        value = factory();
        built = true;
      }
      return value;
    },
    // Present so that `this.HEADERS = HEADERS` — the shape the tests use to
    // lift a global out of the vm sandbox — is a no-op rather than a throw.
    set: function (next) {
      value = next;
      built = true;
    }
  });
}
