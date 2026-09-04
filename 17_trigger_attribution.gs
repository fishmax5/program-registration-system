// ============================================================================
// 3a. RUNTIME TRIGGER ATTRIBUTION  ("who is actually firing this handler?")
// ============================================================================
//
// Every other defence here depends on bookkeeping staying honest: the owner
// claim can be bypassed by running writeTriggers() straight from the script
// editor, and a trigger deleted from the editor's Triggers page updates
// nothing at all. This does not depend on any of that.
//
// An installable trigger runs AS THE ACCOUNT THAT CREATED IT, and
// Session.getEffectiveUser() inside the handler therefore reports exactly
// who owns the trigger that just fired (see getCurrentUserEmail()). So each
// handler stamps its own runs, and if two different accounts are seen
// firing the SAME handler inside one window, duplicate trigger sets exist —
// observed, not inferred. That is the detector that would have caught the
// original bug with no discipline required from anyone.
//
// Stored in Script Properties (shared across accounts, unlike the triggers
// themselves) as { email: lastRunIso } per handler.
// ============================================================================

function getHandlerAttributionPropKey(handlerName) {
  return `${HANDLER_ATTRIBUTION_PROP_PREFIX}${handlerName}`;
}

/**
 * Reads one handler's attribution map, dropping anything older than
 * HANDLER_ATTRIBUTION_WINDOW_MS. Unreadable JSON reads as empty — this is a
 * diagnostic, and it must never be able to break a sync it is only watching.
 */
function getHandlerAttribution(handlerName) {
  let raw;
  try {
    raw = PropertiesService.getScriptProperties().getProperty(getHandlerAttributionPropKey(handlerName));
  } catch (err) {
    return {};
  }
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {};
  }
  const cutoff = Date.now() - HANDLER_ATTRIBUTION_WINDOW_MS;
  const fresh = {};
  Object.keys(parsed || {}).forEach(email => {
    const at = Date.parse(parsed[email]);
    if (!isNaN(at) && at >= cutoff) fresh[email] = parsed[email];
  });
  return fresh;
}

/**
 * Stamps "this handler just ran as me" and returns the distinct accounts
 * seen firing it inside the window — length > 1 means duplicate sets. A
 * throttled or failed call returns [] (i.e. "nothing measured this run",
 * never "no duplicates"); detectDuplicateTriggerAccounts() is the read-only
 * question to ask when you want a real answer.
 *
 * Wrapped so it can never throw into a caller: this runs at the top of the
 * sync handlers, and a failed diagnostic write must not stop a real sync.
 *
 * Read-modify-write on a Script Property is not atomic, so two firings
 * landing in the same instant can lose one of the two stamps. That only
 * delays detection to the next run — the duplicate account will stamp again
 * within a day — and the alternative (taking the script lock the syncs
 * themselves use) would make a diagnostic capable of blocking real work.
 */
function recordHandlerRun(handlerName) {
  try {
    const email = getCurrentUserEmail() || 'unidentified';

    // Throttled per handler PER ACCOUNT, which matters: a throttle keyed on
    // the handler alone would let the first account's stamp suppress the
    // second account's, hiding the very duplication this is here to find.
    // Keyed this way, each account still stamps, and onCalendarChange —
    // which can fire many times a minute — stops paying a property write
    // on every one of them. The throttle is minutes against a window of
    // hours, so nothing ages out un-refreshed.
    const cache = tryGetScriptCache();
    const throttleKey = `ATTR_${handlerName}_${email}`;
    if (cache) {
      try {
        // Returns [] rather than reading the property to report accounts:
        // paying a read on the throttled path would give back most of what
        // the throttle is here to save. No caller uses the return value for
        // anything but logging, and the un-throttled call a few minutes
        // later reports the same thing.
        if (cache.get(throttleKey)) return [];
      } catch (err) { /* cache is an optimization only */ }
    }

    const attribution = getHandlerAttribution(handlerName);
    attribution[email] = new Date().toISOString();
    PropertiesService.getScriptProperties()
      .setProperty(getHandlerAttributionPropKey(handlerName), JSON.stringify(attribution));
    if (cache) {
      try { cache.put(throttleKey, '1', HANDLER_ATTRIBUTION_THROTTLE_SECONDS); } catch (err) { /* non-fatal */ }
    }

    const accounts = Object.keys(attribution);
    if (accounts.length > 1) {
      log(`⚠️ DUPLICATE TRIGGERS: "${handlerName}" has fired under ${accounts.length} different accounts in the ` +
        `last ${Math.round(HANDLER_ATTRIBUTION_WINDOW_MS / 3600000)}h (${accounts.join(', ')}). Each account's ` +
        `triggers are invisible to the others, so "Check Triggers" cannot remove them — open the Apps Script ` +
        `editor's Triggers page (clock icon), sort by "Created by", and delete the set that shouldn't be there.`);
    }
    return accounts;
  } catch (err) {
    log(`⚠️ Could not record trigger attribution for "${handlerName}" (${err}) — continuing.`);
    return [];
  }
}

/** Drops the current account's stamps — used by releaseMyTriggers(), so a released set stops being reported as a duplicate. */
function clearHandlerAttributionForCurrentUser() {
  const me = getCurrentUserEmail() || 'unidentified';
  try {
    const props = PropertiesService.getScriptProperties();
    MANAGED_AUTOMATION_HANDLERS.forEach(handler => {
      const attribution = getHandlerAttribution(handler);
      if (attribution[me] === undefined) return;
      delete attribution[me];
      props.setProperty(getHandlerAttributionPropKey(handler), JSON.stringify(attribution));
    });
  } catch (err) {
    log(`⚠️ Could not clear trigger attribution for ${me} (${err}) — harmless, it ages out on its own.`);
  }
}

/** Handlers currently seen firing under more than one account: { handler: [emails] }. */
function detectDuplicateTriggerAccounts() {
  const found = {};
  MANAGED_AUTOMATION_HANDLERS.forEach(handler => {
    const accounts = Object.keys(getHandlerAttribution(handler));
    if (accounts.length > 1) found[handler] = accounts;
  });
  return found;
}

/**
 * The combined picture, in one dialog — deliberately showing all three
 * views side by side, because it is the DISAGREEMENT between them that
 * identifies the problem:
 *
 *   • what this account can see   (authoritative, but only for this account)
 *   • who Config says owns them   (a claim, which can be stale or bypassed)
 *   • who has actually been firing (observed, and the one that can't lie)
 *
 * An account showing in the third list but holding nothing in the first is
 * precisely the invisible duplicate set that no amount of "Check Triggers"
 * will clear.
 */
function showTriggerStatus() {
  if (!requireAuthorizedAdmin('Trigger Status')) return;

  const me = getCurrentUserEmail() || 'unidentified';
  const owner = getTriggerOwner();
  const verifiedAt = getTriggersVerifiedAt();
  const visible = ScriptApp.getProjectTriggers();
  const managed = visible.filter(t => EXPECTED_TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1);

  const counts = {};
  managed.forEach(t => {
    const handler = t.getHandlerFunction();
    counts[handler] = (counts[handler] || 0) + 1;
  });

  const lines = [];
  lines.push(`Signed in as: ${me}`);
  lines.push(`Automation: ${isAutomationEnabled() ? 'ENABLED' : '⏸️ PAUSED (Config → Automation_Enabled = No)'}`);
  lines.push(`Recorded owner: ${owner || '(unclaimed)'}${verifiedAt ? ` — last rebuilt ${verifiedAt}` : ''}`);
  if (owner && owner !== me) {
    lines.push(`  ⚠️ You are NOT the owner. "Check Triggers" will refuse to run from this account.`);
  }
  lines.push('');

  lines.push(`Triggers visible to THIS account (${managed.length}):`);
  if (managed.length === 0) {
    lines.push('  (none — either you never created any, or you released them)');
  } else {
    EXPECTED_TRIGGER_HANDLERS.forEach(handler => {
      if (counts[handler]) lines.push(`  ${handler}: ${counts[handler]}`);
    });
    lines.push(`  Expected for the owner: syncCalendars 1, autoCreateTodaysSignInSheets 1, syncRegistrations 1, ` +
      `onCalendarChange ${Object.keys(CALENDAR_MAP).length}, onProgramFlagEditInstallable 1`);
    if (!counts['onProgramFlagEditInstallable']) {
      lines.push(`  ⚠️ No onProgramFlagEditInstallable trigger. Ticking Club / No_Registration still works,`);
      lines.push(`     but the calendar is only updated on the next Sync Cal. "Check Triggers" installs it.`);
    }
  }
  lines.push('');

  lines.push(`Accounts actually seen firing (last ${Math.round(HANDLER_ATTRIBUTION_WINDOW_MS / 3600000)}h):`);
  let sawAny = false;
  MANAGED_AUTOMATION_HANDLERS.forEach(handler => {
    const accounts = Object.keys(getHandlerAttribution(handler));
    if (accounts.length === 0) return;
    sawAny = true;
    lines.push(`  ${handler}: ${accounts.join(', ')}${accounts.length > 1 ? '  ⚠️ DUPLICATES' : ''}`);
  });
  if (!sawAny) lines.push('  (nothing has fired yet — this fills in as the triggers run)');

  const duplicates = detectDuplicateTriggerAccounts();
  if (Object.keys(duplicates).length > 0) {
    lines.push('');
    lines.push('⚠️ DUPLICATE TRIGGER SETS EXIST. More than one account is firing the same handler.');
    lines.push('Nothing in this script can delete another account\'s triggers. To fix it:');
    lines.push('  1. Open the Apps Script editor → Triggers (clock icon in the left sidebar).');
    lines.push('  2. That page lists EVERY trigger with a "Created by" column — unlike this script, which');
    lines.push('     only ever sees its own account\'s.');
    lines.push('  3. Delete the sets belonging to any account other than ' + (owner || 'the intended owner') + '.');
    lines.push('  4. That account can also run Admin → Release My Triggers from its own login.');
    lines.push('');
    lines.push('In the meantime, setting Automation_Enabled to "No" on Config stops ALL of them,');
    lines.push('including the ones you cannot see.');
  }

  const report = lines.join('\n');
  log(`Trigger status:\n${report}`);
  try {
    SpreadsheetApp.getUi().alert('Trigger Status', report, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    // No UI (editor run) — the log above is the output.
  }
}

/**
 * Deletes every trigger for `handlerName` visible to this account, then
 * calls `create` to install the replacement.
 *
 * Returns the number of EXCESS triggers found — existing.length minus the
 * one this handler is meant to have, floored at 0. Every normal run removes
 * exactly one (the trigger being replaced) and that's not worth reporting;
 * this return value is what lets writeTriggers() tell "routine rebuild" from
 * "there were actually duplicates" apart in its summary.
 */
function resetTriggersForHandler(handlerName, create) {
  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === handlerName);
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  const excess = Math.max(existing.length - 1, 0);
  if (excess > 0) {
    log(`⚠️ Found ${existing.length} "${handlerName}" triggers (expected at most 1) — removed all of them before rebuilding.`);
  }
  create();
  return excess;
}

/**
 * Same reset as resetTriggersForHandler(), but for the one handler with
 * MULTIPLE expected triggers (one per calendar) — so "how many did we
 * expect" has to be compared after creating, not before. `removed` in the
 * result is the EXCESS over that expected count (see resetTriggersForHandler()
 * for why routine replacement doesn't count).
 */
function writeCalendarChangeTriggers(force) {
  if (!force && isBootstrapActive()) {
    log('writeCalendarChangeTriggers: skipped — a large-setup import or forms-rebuild sweep has these paused on purpose.');
    return { removed: 0, created: 0 };
  }

  const existing = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onCalendarChange');
  existing.forEach(t => ScriptApp.deleteTrigger(t));
  const expected = Object.keys(CALENDAR_MAP).length;
  const excess = Math.max(existing.length - expected, 0);
  if (excess > 0) {
    log(`⚠️ Found ${existing.length} calendar-edit triggers (expected ${expected}, one per location) — removed all of them before rebuilding.`);
  }

  Object.keys(CALENDAR_MAP).forEach(calendarId => {
    ScriptApp.newTrigger('onCalendarChange').forUserCalendar(calendarId).onEventUpdated().create();
    log(`Created calendar-edit trigger for "${CALENDAR_MAP[calendarId]}".`);
  });
  return { removed: excess, created: expected };
}

/**
 * Removes every onCalendarChange trigger. The FULL syncCalendarsInternal()
 * still calls this before it edits calendar descriptions
 * (backInjectCalendarDescriptions), and rebuilds the triggers again in a
 * `finally` block regardless of success/failure — so a full sync's own
 * description edits can never re-fire these triggers and loop. The cheap
 * incremental delta-check in section 3b does NOT edit calendar events, so
 * it's safe to run even while these triggers are active.
 */
function removeCalendarChangeTriggers() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'onCalendarChange');
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  if (triggers.length > 0) {
    log(`Removed ${triggers.length} calendar-edit trigger(s) for the duration of this sync.`);
  }
  return triggers.length;
}

/**
 * THE QUIET WINDOW. Everything in this project that edits calendar
 * descriptions has to run inside one of these, and this is the one place that
 * knows how.
 *
 * WHY. A calendar edit is a calendar edit whoever made it, so the
 * onCalendarChange triggers cannot tell "somebody moved Tai Chi" from "this
 * script just wrote [Club] into forty descriptions." Left running, every
 * description this script writes fires a trigger, and each firing whose delta
 * contains a tracked event runs a FULL syncCalendars() — so one menu click, or
 * one ticked checkbox, becomes a storm of syncs reacting to nothing but their
 * own predecessor's edits.
 *
 * THE THREE STEPS, in this order and for these reasons:
 *   1. remove the triggers, so nothing fires while we write;
 *   2. do the work;
 *   3. advance each calendar's sync token PAST our own edits
 *      (primeCalendarSyncTokens) and only THEN put the triggers back — a
 *      trigger restored before the token moved would immediately deliver the
 *      changes we just made as news.
 *
 * RESTORE-ONLY, NEVER CREATE. An account that held no calendar triggers before
 * the work ends with none. This rule is not a detail: syncCalendars() and
 * several menu items are reachable by any editor, and unconditionally
 * rebuilding here is what used to hand every one of them a complete, private,
 * invisible-to-the-owner second set of triggers (see writeTriggers()). The
 * recorded trigger owner rebuilds normally, because an owner holding none is
 * a workbook that has simply not been set up yet.
 *
 * Re-entrant: nested calls (the pending-flag drain inside a sync, say) run
 * their work directly rather than restoring the triggers halfway through the
 * outer job.
 */
let calendarQuietWindowDepth = 0;

function withCalendarChangeTriggersPaused(reason, work) {
  if (calendarQuietWindowDepth > 0) return work(); // already inside one

  const held = removeCalendarChangeTriggers();
  if (held === 0) {
    // Either there genuinely are none, or they belong to ANOTHER Google
    // account — this one cannot see or delete those, and they will fire on
    // every description written below. Worth saying, since it is exactly the
    // case where a storm happens despite the precaution.
    log(`ℹ️ ${reason}: no calendar-edit triggers to pause under this account. If another account holds ` +
      `them, its triggers will still fire on the edits this makes.`);
  }

  calendarQuietWindowDepth++;
  try {
    return work();
  } finally {
    calendarQuietWindowDepth--;
    try {
      primeCalendarSyncTokens(reason);
    } catch (err) {
      log(`ℹ️ ${reason}: could not prime the calendar sync tokens (${err}).`);
    }
    try {
      // No force: writeCalendarChangeTriggers() declines during a bootstrap
      // import or a forms-rebuild sweep, which pause these on purpose and
      // restore them themselves.
      if (held > 0 || isTriggerOwnerAccount()) writeCalendarChangeTriggers();
      else {
        log(`${reason}: calendar-edit triggers not restored — this account held none beforehand and is not ` +
          `the recorded trigger owner. Creating them here would add a second, invisible set.`);
      }
    } catch (err) {
      // The loudest failure available: silent automation is how "the calendar
      // stopped syncing" becomes a mystery a fortnight later.
      log(`⚠️ ${reason}: FAILED to restore the calendar-edit triggers (${err}). Run Admin → Check Triggers.`);
      toastIfPossible(`⚠️ Calendar-edit triggers could not be restored — run 🔧 Admin ▸ Check Triggers.`);
    }
  }
}

