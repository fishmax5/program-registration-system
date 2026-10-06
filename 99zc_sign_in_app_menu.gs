// ============================================================================
// 99zc. THE SIGN-IN APP, ONE CLICK FROM THE TOOLBAR
// ============================================================================
//
// A menu of its own beside the main one, holding one thing: the door app
// (`72`/`73`). Its link used to be two clicks deep (Sign-In & Door ▸ Door
// Pages) inside a dialog built for SETTING UP the door — links per building,
// the PIN, the public calendar — which is the wrong screen for somebody who
// just wants the sign-in app open on the laptop in front of them.
//
// A spreadsheet menu cannot navigate anywhere itself, so the item opens a
// small dialog whose script calls window.open() and closes itself. When the
// browser blocks that (a pop-up blocker usually does the first time), the
// dialog stays up with the link as a button to press, plus one link per
// building for a tablet that should open pinned to its own.
//
// A workbook that has never been deployed as a web app has no address to
// open, so that case falls through to the Door Pages dialog (`61`), which
// already explains the four steps — rather than a blank window.
//
// Behavior only, numbered last for the usual reason: its one constant stands
// alone, and everything it reaches for (`checkInPageUrl`, `checkInLocations`
// in `60`, `showCheckInPageDialog` in `61`, `menuFn_` in `99r`) is a hoisted
// function declaration. `16`'s `onOpen` attaches it after the main menu.

const SIGN_IN_APP_MENU_NAME = '📱 Sign-In App';

/**
 * Attaches the separate Sign-In App menu. Called from onOpen() AFTER the main
 * menu, and guarded there, so nothing here can cost anybody the main menu.
 */
function buildSignInAppMenu(ui) {
  ui.createMenu(SIGN_IN_APP_MENU_NAME)
    .addItem('🚪 Open the Sign-In App', menuFn_('openSignInApp'))
    .addToUi();
}

/** Opens the door app in a new browser tab (or offers the link to press). */
function openSignInApp() {
  const url = checkInPageUrl({});
  if (!url) {
    // Never deployed (or the address could not be read): the Door Pages
    // dialog is the screen that says how to fix that.
    showCheckInPageDialog();
    return;
  }
  let buildings = [];
  try {
    buildings = checkInLocations()
      .map(location => ({ location, url: checkInPageUrl({ location }) }))
      .filter(b => b.location && b.url);
  } catch (err) {
    log(`openSignInApp: could not list buildings (${err}); offering the main link only.`);
  }
  const html = HtmlService.createHtmlOutput(buildSignInAppLauncherHtml(url, buildings))
    .setWidth(380)
    .setHeight(buildings.length ? 220 + buildings.length * 44 : 200);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Sign-In App');
}

/**
 * The launcher dialog. Pure, so a test can read it. Every value is escaped
 * for markup, and the URL reaches the script through JSON.stringify with `<`
 * escaped, so nothing in an address can end the script block.
 */
function buildSignInAppLauncherHtml(url, buildings) {
  const esc = escapeHtmlForDialog;
  const jsUrl = JSON.stringify(String(url)).replace(/</g, '\\u003c');
  const buildingLinks = (buildings || []).map(b =>
    `<a class="alt" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.location)} only</a>`
  ).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; font-size: 14px; margin: 12px; color: #222; }
  #status { margin: 0 0 12px; }
  a.btn { display: block; text-align: center; background: #1a73e8; color: #fff;
          padding: 10px; border-radius: 6px; text-decoration: none; font-weight: bold; }
  a.alt { display: block; text-align: center; border: 1px solid #1a73e8; color: #1a73e8;
          padding: 8px; border-radius: 6px; text-decoration: none; margin-top: 8px; }
  .hint { color: #666; font-size: 12px; margin-top: 12px; }
</style></head><body>
  <p id="status">Opening the sign-in app in a new tab…</p>
  <a class="btn" href="${esc(url)}" target="_blank" rel="noopener" onclick="setTimeout(function(){google.script.host.close();},300)">Open the Sign-In App</a>
  ${buildingLinks}
  ${buildingLinks ? '<p class="hint">A building link opens with that building already chosen.</p>' : ''}
<script>
  (function () {
    var opened = null;
    try { opened = window.open(${jsUrl}, '_blank'); } catch (e) { opened = null; }
    if (opened) {
      google.script.host.close();
    } else {
      document.getElementById('status').textContent =
        'Your browser blocked the new tab. Press the button below instead.';
    }
  })();
</script>
</body></html>`;
}
