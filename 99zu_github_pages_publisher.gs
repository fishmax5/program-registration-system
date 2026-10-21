// ============================================================================
// 99zu. THE PUBLIC PAGES, PUBLISHED AS FILES  (GitHub Pages in front of Apps Script)
// ============================================================================
//
// The two public pages (86/87 the calendar, 92/93 the weekly programs) were
// only ever served by this deployment's web app — and a web app is the slow way
// to hand a stranger a page: a redirect, Google's wrapper, a sandboxed iframe
// and a script execution before the first byte of the page, then 99y's snapshot
// inlined into it. The snapshot is already built ahead (99y); what remained was
// the road it travels. So the same snapshot is also PUBLISHED, as plain files,
// to a public GitHub repository served by GitHub Pages:
//
//   schedule.json   the calendar snapshot 86 builds, as it is
//   regular.json    the weekly fold of that same snapshot (92)
//   index.html      the calendar page  (87's template, `static` form)
//   regular.html    the weekly page    (93's template, `static` form)
//
// The pages fetch their JSON at boot (91's banner 18c has the whole contract)
// and hand the visitor to the Apps Script page whenever anything is wrong, so
// publishing can only ever add a faster road: the printed `?mode=public` links
// keep working, unchanged, and a publisher that has stopped is covered by the
// pages' own staleness check.
//
// WHAT LEAVES THE WORKBOOK IS EXACTLY WHAT 99y ALREADY STORES. These files are
// the snapshot, serialized — no names, no counts of who, no registrant read —
// and tests/github_pages_publish.test.js pins that against the field list
// tests/public_calendar.test.js holds. Publishing does not add a field.
//
// WHEN IT RUNS. After 99y builds the snapshot, from the rebuild trigger and the
// end of every calendar sync (`publishPublicPagesAfterBuild_`) — and NOT from a
// page view, which must never wait on GitHub. Each file is pushed only when it
// changed: the digest is taken over the content with `builtAt` and
// `generatedAt` removed, because those change on every build and would turn
// "skip the push if unchanged" into "push every ten minutes". The one exception
// is the heartbeat — an unchanged JSON file is re-pushed every
// PUBLIC_PAGES_HEARTBEAT_MS so the pages' 12-hour staleness check can tell a
// quiet calendar from a dead publisher. The HTML pages are static and are
// pushed when the template (or the Apps Script address they fall back to)
// changes.
//
// THE TOKEN lives in Script Properties and nowhere else (never a cell, never a
// log line, never the Door Pages dialog). It is a fine-grained personal access
// token limited to the one repository with Contents: read and write, entered
// through Admin ▸ Sign-In & Door ▸ Public Pages on GitHub Pages… The state of
// what was last pushed (digest, blob sha, time) is `PUBLIC_PAGES_PUBLISH_STATE_V1`,
// small enough to sit in Script Properties beside it.
//
// IT NEVER THROWS AND NEVER BLOCKS THE SYNC: a refused push is logged, counted,
// and — after PUBLIC_PAGES_FAILURES_BEFORE_NOTE runs in a row — filed once a day
// for the office digest (88). Pages go on serving the last good files, and the
// staleness check sends visitors to Apps Script if that goes on long enough.
//
// Behavior plus self-contained constants, numbered last for the usual reason:
// everything it reaches for (99y's snapshot, 91's static builders, 86/87/93's
// page builders, `checkInPageUrl`, `spoolOfficeNote`) it reads at CALL time or
// through a hoisted function declaration. 86 and 99y call into it the same way.
// ============================================================================

const PUBLIC_PAGES_SETTINGS_PROP_KEY = 'PUBLIC_PAGES_SETTINGS_V1';
const PUBLIC_PAGES_TOKEN_PROP_KEY = 'PUBLIC_PAGES_GITHUB_TOKEN_V1';
const PUBLIC_PAGES_STATE_PROP_KEY = 'PUBLIC_PAGES_PUBLISH_STATE_V1';
const PUBLIC_PAGES_NOTE_DAY_PROP_KEY = 'PUBLIC_PAGES_NOTE_DAY_V1';

/** An unchanged JSON file is pushed again this often — the staleness check's proof of life. */
const PUBLIC_PAGES_HEARTBEAT_MS = 3 * 60 * 60 * 1000;

/** Consecutive runs with a refused push before the office is told (once a day). */
const PUBLIC_PAGES_FAILURES_BEFORE_NOTE = 3;

const PUBLIC_PAGES_API_ROOT = 'https://api.github.com';

/** Commit message for an automatic push; says nothing about who is on the calendar. */
const PUBLIC_PAGES_COMMIT_MESSAGE = 'Update public schedule (automatic)';

// ----------------------------------------------------------------------------
// Settings
// ----------------------------------------------------------------------------

/**
 * Validates and normalizes the settings object. Returns null for anything that
 * is not a usable repository: the values reach a URL path and a request body,
 * so nothing unchecked is ever interpolated into either.
 *
 * { repo: 'owner/name', branch: 'main', folder: '' | 'docs', baseUrl: 'https://…/' }
 */
function normalizePublicPagesSettings_(input) {
  const src = input || {};
  const repo = String(src.repo || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null;

  const branch = String(src.branch || 'main').trim() || 'main';
  if (!/^[A-Za-z0-9._\/-]+$/.test(branch) || branch.indexOf('..') !== -1) return null;

  const folder = String(src.folder || '').trim().replace(/^\/+|\/+$/g, '');
  if (folder && (!/^[A-Za-z0-9._\/-]+$/.test(folder) || folder.indexOf('..') !== -1)) return null;

  let baseUrl = String(src.baseUrl || '').trim();
  if (baseUrl) {
    if (!/^https:\/\/[^\s]+$/.test(baseUrl)) return null;
    if (baseUrl.charAt(baseUrl.length - 1) !== '/') baseUrl += '/';
  }
  return { repo, branch, folder, baseUrl };
}

function readPublicPagesSettings_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(PUBLIC_PAGES_SETTINGS_PROP_KEY);
    if (!raw) return null;
    return normalizePublicPagesSettings_(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

function readPublicPagesToken_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty(PUBLIC_PAGES_TOKEN_PROP_KEY) || '').trim();
  } catch (err) {
    return '';
  }
}

/**
 * Where Pages serves the repository from: what staff typed (a custom domain),
 * else the address GitHub gives it — `owner.github.io/name/`, or the bare
 * `owner.github.io/` for the user-site repository of that name.
 */
function publicPagesBaseUrl_(settings) {
  if (settings.baseUrl) return settings.baseUrl;
  const parts = settings.repo.split('/');
  const owner = parts[0].toLowerCase();
  if (parts[1].toLowerCase() === `${owner}.github.io`) return `https://${owner}.github.io/`;
  return `https://${owner}.github.io/${parts[1]}/`;
}

/** 'https://owner.github.io' — what the embed snippet's listener must accept. */
function publicPagesOrigin_(settings) {
  const match = /^(https:\/\/[^\/]+)/.exec(publicPagesBaseUrl_(settings));
  return match ? match[1] : '';
}

// ----------------------------------------------------------------------------
// State: what was last pushed
// ----------------------------------------------------------------------------

function publicPagesStateKey_(settings) {
  return `${settings.repo}|${settings.branch}|${settings.folder}`;
}

function readPublicPagesState_(settings) {
  const fresh = { key: publicPagesStateKey_(settings), files: {}, failures: 0 };
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(PUBLIC_PAGES_STATE_PROP_KEY);
    if (!raw) return fresh;
    const state = JSON.parse(raw);
    // A different repository, branch or folder is a different set of files:
    // the stored blob shas belong to the old place and would be refused.
    if (!state || state.key !== fresh.key || typeof state.files !== 'object') return fresh;
    state.files = state.files || {};
    state.failures = Number(state.failures) || 0;
    return state;
  } catch (err) {
    return fresh;
  }
}

function writePublicPagesState_(state) {
  try {
    PropertiesService.getScriptProperties().setProperty(PUBLIC_PAGES_STATE_PROP_KEY, JSON.stringify(state));
  } catch (err) {
    log(`Public pages: could not save the publish state (${err}).`);
  }
}

/** Have all four files been pushed at least once? The embed snippet waits for this. */
function publicPagesFilesLive_(settings) {
  const state = readPublicPagesState_(settings);
  const names = [];
  Object.keys(PUBLIC_STATIC_FILES).forEach(kind => {
    names.push(PUBLIC_STATIC_FILES[kind].page, PUBLIC_STATIC_FILES[kind].data);
  });
  return names.every(name => state.files[name] && state.files[name].at);
}

// ----------------------------------------------------------------------------
// The files
// ----------------------------------------------------------------------------

/** SHA-256 as hex. */
function publicPagesDigest_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('');
}

/** JSON with the two fields that change on EVERY build removed — what "unchanged" means. */
function publicPagesStableJson_(value) {
  const copy = Object.assign({}, value);
  delete copy.builtAt;
  delete copy.generatedAt;
  return JSON.stringify(copy);
}

/** The Apps Script address a static page falls back to — only ever script.google.com. */
function publicPagesFallbackUrl_(mode) {
  try {
    const url = String(checkInPageUrl({ mode }) || '');
    return /^https:\/\/script\.google\.com\//.test(url) ? url : '';
  } catch (err) {
    return '';
  }
}

/**
 * The four files for this snapshot, JSON first: on the very first publish a
 * page must never be live before the data it fetches.
 *
 * { name, content, hashSource, heartbeat }
 */
function buildPublicStaticFiles_(snapshot) {
  const calendar = PUBLIC_STATIC_FILES.public;
  const regular = PUBLIC_STATIC_FILES.regular;
  const regularFold = regularProgramsFromSnapshot_(snapshot);
  const calendarPage = publicStaticDocument('Programs & Sign-Ups',
    buildPublicCalendarHtml(null, { static: { dataUrl: calendar.data, execUrl: publicPagesFallbackUrl_('public') } }),
    calendar.data);
  const regularPage = publicStaticDocument('Regular Programs',
    buildPublicRegularHtml(null, { static: { dataUrl: regular.data, execUrl: publicPagesFallbackUrl_('regular') } }),
    regular.data);
  return [
    { name: calendar.data, content: JSON.stringify(snapshot),
      hashSource: publicPagesStableJson_(snapshot), heartbeat: true },
    { name: regular.data, content: JSON.stringify(regularFold),
      hashSource: publicPagesStableJson_(regularFold), heartbeat: true },
    { name: calendar.page, content: calendarPage, hashSource: calendarPage, heartbeat: false },
    { name: regular.page, content: regularPage, hashSource: regularPage, heartbeat: false }
  ];
}

// ----------------------------------------------------------------------------
// GitHub
// ----------------------------------------------------------------------------

function publicPagesContentsPath_(settings, name) {
  const full = settings.folder ? `${settings.folder}/${name}` : name;
  const owner = settings.repo.split('/');
  return `/repos/${encodeURIComponent(owner[0])}/${encodeURIComponent(owner[1])}/contents/` +
    full.split('/').map(encodeURIComponent).join('/');
}

/** One request. The token goes in the header and is never logged. */
function publicPagesRequest_(token, method, path, payload) {
  const options = {
    method,
    muteHttpExceptions: true,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(PUBLIC_PAGES_API_ROOT + path, options);
  let body = null;
  try { body = JSON.parse(res.getContentText()); } catch (err) { body = null; }
  return { status: res.getResponseCode(), body };
}

function publicPagesErrorText_(res) {
  const message = res && res.body && res.body.message ? String(res.body.message) : '';
  return `HTTP ${res ? res.status : '?'}${message ? ` — ${message.slice(0, 160)}` : ''}`;
}

/** The file as it is on GitHub now: { found, sha, contentB64 }, or { error }. */
function publicPagesGetRemote_(settings, token, name) {
  const res = publicPagesRequest_(token, 'get',
    `${publicPagesContentsPath_(settings, name)}?ref=${encodeURIComponent(settings.branch)}`);
  if (res.status === 404) return { found: false };
  if (res.status !== 200 || !res.body) return { error: publicPagesErrorText_(res) };
  return {
    found: true,
    sha: String(res.body.sha || ''),
    contentB64: res.body.encoding === 'base64' ? String(res.body.content || '').replace(/\s+/g, '') : ''
  };
}

/**
 * Puts one file. Optimistic with the sha it remembers; a 409/422 (the file
 * moved, was never there, or the state was lost) asks GitHub what is there and
 * tries ONCE more — and if what is there already equals what we hold, that is
 * success without a commit.
 *
 * Returns { ok, sha, unchanged } or { ok: false, error }.
 */
function publicPagesPutFile_(settings, token, name, content, knownSha) {
  const encoded = Utilities.base64Encode(content, Utilities.Charset.UTF_8);
  let sha = knownSha || '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = { message: PUBLIC_PAGES_COMMIT_MESSAGE, content: encoded, branch: settings.branch };
    if (sha) body.sha = sha;
    const res = publicPagesRequest_(token, 'put', publicPagesContentsPath_(settings, name), body);
    if (res.status === 200 || res.status === 201) {
      return { ok: true, sha: String((res.body && res.body.content && res.body.content.sha) || '') };
    }
    if (attempt === 0 && (res.status === 409 || res.status === 422)) {
      const remote = publicPagesGetRemote_(settings, token, name);
      if (remote.error) return { ok: false, error: remote.error };
      if (remote.found && remote.contentB64 && remote.contentB64 === encoded) {
        return { ok: true, sha: remote.sha, unchanged: true };
      }
      sha = remote.found ? remote.sha : '';
      continue;
    }
    return { ok: false, error: publicPagesErrorText_(res) };
  }
  return { ok: false, error: 'the file kept changing underneath this push' };
}

// ----------------------------------------------------------------------------
// Publishing
// ----------------------------------------------------------------------------

/**
 * PUSHES WHAT CHANGED. Returns { ok, reason, pushed, skipped, failed } and never
 * throws. `options.force` pushes every file regardless of its digest (the setup
 * flow's first publish).
 */
function publishPublicPagesToGitHub_(snapshot, options) {
  const opts = options || {};
  const result = { ok: false, reason: '', pushed: [], skipped: [], failed: [] };
  try {
    const settings = readPublicPagesSettings_();
    const token = readPublicPagesToken_();
    if (!settings || !token) { result.reason = 'not configured'; return result; }
    if (!snapshot || snapshot.ok === false) { result.reason = 'no usable snapshot'; return result; }

    const state = readPublicPagesState_(settings);
    const now = Date.now();
    const files = buildPublicStaticFiles_(snapshot);
    let touched = false;

    files.forEach(file => {
      try {
        const digest = publicPagesDigest_(file.hashSource);
        const entry = state.files[file.name];
        const current = entry && entry.hash === digest;
        const beating = file.heartbeat && entry && (now - Number(entry.at || 0)) >= PUBLIC_PAGES_HEARTBEAT_MS;
        if (current && !beating && !opts.force) { result.skipped.push(file.name); return; }

        const put = publicPagesPutFile_(settings, token, file.name, file.content, entry && entry.sha);
        if (!put.ok) {
          result.failed.push({ name: file.name, error: put.error });
          log(`Public pages: ${file.name} was not pushed (${put.error}).`);
          return;
        }
        state.files[file.name] = { hash: digest, sha: put.sha, at: now };
        result.pushed.push(file.name);
        touched = true;
      } catch (err) {
        result.failed.push({ name: file.name, error: String(err).slice(0, 160) });
        log(`Public pages: ${file.name} was not pushed (${String(err).slice(0, 160)}).`);
      }
    });

    const failuresBefore = state.failures || 0;
    state.failures = result.failed.length ? failuresBefore + 1 : 0;
    // An hour in which nothing changed writes nothing: this runs every ten minutes.
    if (touched || state.failures !== failuresBefore) writePublicPagesState_(state);
    if (result.failed.length) notePublicPagesFailure_(state, result.failed[0]);
    result.ok = result.failed.length === 0;
    return result;
  } catch (err) {
    result.reason = String(err).slice(0, 160);
    log(`Public pages: publishing failed (${result.reason}).`);
    return result;
  }
}

/** Files one line for the office digest, once a day, after repeated refusals. */
function notePublicPagesFailure_(state, failure) {
  try {
    if ((state.failures || 0) < PUBLIC_PAGES_FAILURES_BEFORE_NOTE) return;
    const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty(PUBLIC_PAGES_NOTE_DAY_PROP_KEY) === today) return;
    props.setProperty(PUBLIC_PAGES_NOTE_DAY_PROP_KEY, today);
    spoolOfficeNote('Public schedule',
      `GitHub Pages has not been updated for ${state.failures} runs in a row (${failure.name}: ` +
      `${failure.error}). Visitors are still served the last published files, and are sent to the ` +
      'Apps Script page once those are 12 hours old. Check the token under Admin ▸ Sign-In & Door ▸ ' +
      'Public Pages on GitHub Pages.');
  } catch (err) {
    log(`Public pages: could not file the failure note (${err}).`);
  }
}

/**
 * 99y's call, after it has built the snapshot (the trigger, and the end of a
 * calendar sync). Never throws, and does nothing at all unless set up.
 */
function publishPublicPagesAfterBuild_(snapshot) {
  try {
    return publishPublicPagesToGitHub_(snapshot, {});
  } catch (err) {
    log(`Public pages: publish after build failed (${err}).`);
    return null;
  }
}

// ----------------------------------------------------------------------------
// The snippet
// ----------------------------------------------------------------------------

/**
 * The GitHub Pages address a website should frame, or '' while publishing is
 * not set up or the files are not all there yet — so the snippet never points
 * at a 404 in the window between saving the settings and the first push.
 */
function publicPagesEmbedUrl_(kind, options) {
  const settings = readPublicPagesSettings_();
  if (!settings || !PUBLIC_STATIC_FILES[kind] || !publicPagesFilesLive_(settings)) return '';
  const opts = options || {};
  const parts = [];
  if (kind === 'public') {
    const span = publicCalendarSpanRequested_({ span: opts.span });
    if (span) parts.push(`span=${encodeURIComponent(span)}`);
  }
  parts.push('embed=1');
  if (opts.location) parts.push(`building=${encodeURIComponent(String(opts.location).trim())}`);
  return `${publicPagesBaseUrl_(settings)}${PUBLIC_STATIC_FILES[kind].page}?${parts.join('&')}`;
}

/** The origin of a Pages embed URL (for the snippet's listener), or ''. */
function publicPagesOriginForUrl_(url) {
  const settings = readPublicPagesSettings_();
  if (!settings || !url) return '';
  return String(url).indexOf(publicPagesBaseUrl_(settings)) === 0 ? publicPagesOrigin_(settings) : '';
}

// ----------------------------------------------------------------------------
// Setup (Admin ▸ Sign-In & Door ▸ Public Pages on GitHub Pages…)
// ----------------------------------------------------------------------------

/** One line saying where things stand, for the setup prompt. */
function describePublicPagesStatus_() {
  const settings = readPublicPagesSettings_();
  if (!settings) return 'Publishing is OFF.';
  const state = readPublicPagesState_(settings);
  const times = Object.keys(state.files).map(name => Number(state.files[name].at) || 0);
  const last = times.length ? Math.max.apply(null, times) : 0;
  return `Publishing to ${settings.repo} (${settings.branch}${settings.folder ? ` /${settings.folder}` : ''}) — ` +
    `${readPublicPagesToken_() ? 'token stored' : 'NO TOKEN'}; ` +
    (last ? `last push ${Utilities.formatDate(new Date(last), TIMEZONE, 'MMM d, h:mm a')}.` : 'nothing pushed yet.');
}

/**
 * Asks GitHub whether the token can do the job: the repository must be
 * reachable and writable. Returns { ok, message, isPrivate }.
 */
function verifyPublicPagesAccess_(settings, token) {
  try {
    const owner = settings.repo.split('/');
    const res = publicPagesRequest_(token, 'get',
      `/repos/${encodeURIComponent(owner[0])}/${encodeURIComponent(owner[1])}`);
    if (res.status === 401) return { ok: false, message: 'GitHub refused the token (401). Check it was copied whole and has not expired.' };
    if (res.status === 404) {
      return { ok: false, message: 'GitHub cannot see that repository with this token (404). Check the name, and that the token was created for THIS repository.' };
    }
    if (res.status !== 200 || !res.body) return { ok: false, message: `GitHub answered ${publicPagesErrorText_(res)}.` };
    if (res.body.permissions && res.body.permissions.push === false) {
      return { ok: false, message: 'The token can read this repository but not write to it. It needs Contents: Read and write.' };
    }
    return { ok: true, message: '', isPrivate: res.body.private === true };
  } catch (err) {
    return { ok: false, message: `Could not reach GitHub (${String(err).slice(0, 160)}).` };
  }
}

/**
 * The testable core of the setup: store (or, with `off`, forget) the settings
 * and token, check them, and publish once. `input.token` blank keeps the stored
 * one. Returns { ok, message, url }.
 */
function savePublicPagesSetup_(input) {
  const props = PropertiesService.getScriptProperties();
  if (input && input.off) {
    [PUBLIC_PAGES_SETTINGS_PROP_KEY, PUBLIC_PAGES_TOKEN_PROP_KEY, PUBLIC_PAGES_STATE_PROP_KEY,
      PUBLIC_PAGES_NOTE_DAY_PROP_KEY].forEach(key => props.deleteProperty(key));
    return { ok: true, message: 'Publishing is off, and the token has been forgotten. The files already in the repository ' +
      'are left as they are; the embed snippet is back to the Apps Script address.', url: '' };
  }
  const settings = normalizePublicPagesSettings_(input);
  if (!settings) {
    return { ok: false, message: 'That is not a usable repository. Use owner/name (for example my-org/public-schedule), ' +
      'a branch name, and optionally a folder such as docs.' };
  }
  const token = String((input && input.token) || '').trim() || readPublicPagesToken_();
  if (!token) return { ok: false, message: 'No token was entered, and none is stored.' };

  const access = verifyPublicPagesAccess_(settings, token);
  if (!access.ok) return { ok: false, message: access.message };

  props.setProperty(PUBLIC_PAGES_TOKEN_PROP_KEY, token);
  props.setProperty(PUBLIC_PAGES_SETTINGS_PROP_KEY, JSON.stringify(settings));

  const snapshot = buildScheduleSnapshot_();
  const published = publishPublicPagesToGitHub_(snapshot, { force: true });
  const url = `${publicPagesBaseUrl_(settings)}${PUBLIC_STATIC_FILES.public.page}`;
  const lines = [];
  if (published.ok) {
    lines.push(`Pushed ${published.pushed.length} files to ${settings.repo}.`);
  } else {
    lines.push(`Saved, but the first push did not complete: ${published.failed.length ?
      published.failed.map(f => `${f.name} (${f.error})`).join('; ') : published.reason}.`);
    lines.push('It will retry on the next snapshot rebuild (every 10 minutes).');
  }
  lines.push('', 'If this is the first time: in the repository, Settings ▸ Pages, set the source to ' +
    `"Deploy from a branch", branch ${settings.branch}, folder ${settings.folder ? `/${settings.folder}` : '/ (root)'}. ` +
    'GitHub takes a minute or two to publish.', '', `The calendar will be at:\n${url}`,
  '', 'The embed snippet in Door Pages switches to this address by itself once all four files are live. ' +
    'Printed ?mode=public links are unchanged.');
  if (access.isPrivate) {
    lines.push('', '⚠️ This repository is PRIVATE. GitHub Pages serves a private repository only on some paid plans, ' +
      'and then only to people signed in to GitHub. For a public website it needs to be a public repository.');
  }
  return { ok: published.ok, message: lines.join('\n'), url };
}

/** Admin ▸ Sign-In & Door ▸ Public Pages on GitHub Pages… — four prompts, then one publish. */
function setUpPublicPagesPublishing() {
  if (!requireAuthorizedAdmin('Set Up GitHub Pages Schedule')) return;
  const ui = SpreadsheetApp.getUi();
  const title = 'Public pages on GitHub Pages';
  const ask = (step, text) => {
    const answer = ui.prompt(`${title} (${step} of 4)`, text, ui.ButtonSet.OK_CANCEL);
    return answer.getSelectedButton() === ui.Button.OK ? String(answer.getResponseText() || '').trim() : null;
  };

  const repo = ask(1,
    `${describePublicPagesStatus_()}\n\nThe PUBLIC GitHub repository the pages are published to, as owner/name. ` +
    'It must exist already, and GitHub Pages must be able to serve it.\n\nType OFF to stop publishing and forget the token.');
  if (repo === null) return;
  if (/^off$/i.test(repo)) {
    const done = savePublicPagesSetup_({ off: true });
    ui.alert(title, done.message, ui.ButtonSet.OK);
    return;
  }

  const where = ask(2, 'The branch Pages serves, and the folder if it is not the root — for example:\n  main\n  main docs');
  if (where === null) return;
  const bits = where.split(/\s+/).filter(Boolean);

  const token = ask(3,
    'A fine-grained personal access token for THIS repository only, with Contents: Read and write. ' +
    'It is stored in Script Properties and never shown again. Leave blank to keep the one already stored.');
  if (token === null) return;

  const baseUrl = ask(4, 'The address Pages serves from, ONLY if you use a custom domain (https://schedule.example.org/). ' +
    'Leave blank for the github.io address.');
  if (baseUrl === null) return;

  const done = savePublicPagesSetup_({
    repo, branch: bits[0] || 'main', folder: bits[1] || '', token, baseUrl
  });
  ui.alert(title, done.message, ui.ButtonSet.OK);
}
