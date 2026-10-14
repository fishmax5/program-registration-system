// ============================================================================
// GOOGLE GROUPS PRIVILEGE PROBE — a throwaway, NOT part of the project
// ============================================================================
//
// Does this account have enough standing to run the Groups feature described
// in docs/GOOGLE_GROUPS_INVESTIGATION.md? Every call the feature would make,
// made once, in order, each reported on its own.
//
// *** DO NOT PUT THIS FILE IN THE WORKBOOK'S APPS SCRIPT PROJECT. ***
//
// Adding the Admin SDK scope to the bound project changes the consent screen
// for EVERY person who opens the workbook — front-desk staff included — to
// one that says the script may "view and manage the provisioning of groups on
// your domain", and a staff member who declines or lacks the privilege then
// hits a 403 on whichever path touches Groups. That is §6.7 of the
// investigation, and it is not worth paying before the feature is decided on.
//
// So: script.google.com -> New project -> paste this in -> run it there.
//
// SETUP
//   1. Run it as the account that will OWN THE TRIGGERS, not merely as an
//      admin. The workbook runs as whoever created the triggers (17_trigger_
//      attribution.gs is a whole file about that fact); a probe that passes as
//      you and a sync that fails as the trigger owner is the likely outcome
//      otherwise. The workbook's 🔧 Admin -> Trigger Status says who that is
//      today.
//   2. Extensions/Services (the + beside "Services") -> add BOTH:
//        Admin SDK API            -> identifier AdminDirectory
//        Admin SDK Groups Settings -> identifier GroupsSettings
//      Two separate services. Membership is the first; every setting that
//      matters for privacy is the second.
//   3. Fill in the three constants below.
//   4. Run probeGoogleGroups(). Read the log. Then run cleanUpProbeGroup() —
//      the probe tries to clean up after itself, but a failure part way
//      through can leave the test group standing.
//
// It creates ONE group whose address begins with the prefix below, puts two
// addresses in it, sends it one message, and deletes it. It touches nothing
// else and reads no part of the production workbook.

/** A gmail.com (or other outside) address YOU control. The external-member
 *  test is the one most likely to fail, and it fails on a tenant setting
 *  rather than on your role — which is exactly why it is worth knowing now:
 *  club members are on gmail.com. */
const PROBE_EXTERNAL_ADDRESS = 'put-a-gmail-address-you-own-here@gmail.com';

/** An address inside your Workspace domain, other than your own. */
const PROBE_INTERNAL_ADDRESS = 'someone@yourdomain.org';

/** Your Workspace domain, as it appears after the @ in a staff address. */
const PROBE_DOMAIN = 'yourdomain.org';

const PROBE_GROUP_PREFIX = 'zz-groups-probe-';

function probeGoogleGroups() {
  const results = [];
  const say = (step, ok, detail) => {
    results.push({ step: step, ok: ok, detail: detail });
    Logger.log((ok === true ? 'PASS  ' : ok === null ? 'SKIP  ' : 'FAIL  ') + step +
               (detail ? ' — ' + detail : ''));
  };
  // Every step is guarded on its own: the interesting answer is WHICH call
  // refuses, and a probe that stops at the first refusal cannot tell you that.
  const attempt = (step, fn) => {
    try {
      const detail = fn();
      say(step, true, detail || '');
      return true;
    } catch (err) {
      say(step, false, String(err && err.message || err));
      return false;
    }
  };

  const groupEmail = PROBE_GROUP_PREFIX + Date.now() + '@' + PROBE_DOMAIN;
  Logger.log('Probe group will be: ' + groupEmail);
  Logger.log('');

  // 0 — WHO. Not a privilege check; the check that the privilege checks below
  // are about the right account.
  attempt('0. Running as', () => {
    const eff = Session.getEffectiveUser().getEmail();
    let active = '';
    try { active = Session.getActiveUser().getEmail(); } catch (e) { active = '(unavailable)'; }
    return 'effective=' + eff + ', active=' + active +
           ' — this must be the account that owns the workbook triggers';
  });

  // 1 — Is the Directory API reachable AND am I an admin? These fail
  // differently and the message is the diagnosis:
  //   "AdminDirectory is not defined"  -> the advanced service is not added
  //   "Admin SDK API has not been used ... disabled" -> enable it in the Cloud project
  //   403 "Not Authorized to access this resource/api" -> signed in, not an admin
  const canList = attempt('1. Directory API + admin role (Groups.list)', () => {
    const res = AdminDirectory.Groups.list({ customer: 'my_customer', maxResults: 1 });
    const n = (res.groups || []).length;
    return 'listed ok, tenant has at least ' + n + ' group' + (n === 1 ? '' : 's');
  });

  // 2 — Create. Listing is a read; this is the first write, and a custom admin
  // role granted "read" only will pass step 1 and fail here. That distinction
  // is the whole of §1's "read-only version" option.
  let created = false;
  if (canList) {
    created = attempt('2. Create a group (Groups.insert)', () => {
      AdminDirectory.Groups.insert({
        email: groupEmail,
        name: 'ZZ Groups Probe (delete me)',
        description: 'Created by google_groups_probe.gs. Safe to delete.'
      });
      return groupEmail;
    });
  } else {
    say('2. Create a group (Groups.insert)', null, 'skipped — step 1 failed');
  }

  if (!created) {
    Logger.log('');
    Logger.log('Stopping: without create, nothing below can be tested.');
    return probeVerdict_(results);
  }

  // Group creation is not instant everywhere. A few seconds saves a confusing
  // 404 on the next call.
  Utilities.sleep(4000);

  // 3 — The settings API. Separate service, separate privilege, and the home
  // of every setting in §4.4 of the investigation. whoCanViewMembership is the
  // one that is a disclosure rather than a preference: its default lets forty
  // club members read each other's email addresses.
  attempt('3. Groups Settings API (get)', () => {
    const s = GroupsSettings.Groups.get(groupEmail);
    return 'whoCanViewMembership=' + s.whoCanViewMembership +
           ', whoCanPostMessage=' + s.whoCanPostMessage +
           ', allowExternalMembers=' + s.allowExternalMembers +
           ', isArchived=' + s.isArchived +
           '  <- these are the DEFAULTS a new group gets';
  });

  attempt('4. Groups Settings API (patch the four that matter)', () => {
    GroupsSettings.Groups.patch({
      whoCanViewMembership: 'ALL_MANAGERS_CAN_VIEW',
      whoCanPostMessage: 'ALL_MANAGERS_CAN_POST',
      allowExternalMembers: 'true',
      isArchived: 'false',
      whoCanJoin: 'INVITED_CAN_JOIN',
      replyTo: 'REPLY_TO_MANAGERS'
    }, groupEmail);
    const s = GroupsSettings.Groups.get(groupEmail);
    // Read it BACK rather than trusting the patch: a tenant policy can refuse
    // a value without refusing the call.
    return 'read back: whoCanViewMembership=' + s.whoCanViewMembership +
           ', allowExternalMembers=' + s.allowExternalMembers +
           ', replyTo=' + s.replyTo;
  });

  // 5 — An inside member. Straightforward; if this fails the role is the
  // problem, not a sharing policy.
  attempt('5. Add an internal member', () => {
    AdminDirectory.Members.insert(
      { email: PROBE_INTERNAL_ADDRESS, role: 'MEMBER', delivery_settings: 'ALL_MAIL' },
      groupEmail);
    return PROBE_INTERNAL_ADDRESS;
  });

  // 6 — THE ONE TO WATCH. Club members are on gmail.com. This can refuse even
  // when everything above passed, because it is governed by the tenant's
  // Groups-for-Business sharing setting ("Allow members outside your
  // organization") and not by your admin role at all. A 403 here with a
  // "conditionNotMet" or policy message means: Admin console -> Apps ->
  // Google Workspace -> Groups for Business -> Sharing settings.
  attempt('6. Add an EXTERNAL (gmail.com) member', () => {
    AdminDirectory.Members.insert(
      { email: PROBE_EXTERNAL_ADDRESS, role: 'MEMBER', delivery_settings: 'ALL_MAIL' },
      groupEmail);
    return PROBE_EXTERNAL_ADDRESS + ' accepted — clubs are possible';
  });

  // 7 — Read membership back. The reconcile in §4.3 is a diff, so it needs
  // this as much as it needs the writes. The `status` field is also the
  // closest thing to §5.1's bounce visibility, and it is not very close.
  attempt('7. List members back (the reconcile\'s read half)', () => {
    const res = AdminDirectory.Members.list(groupEmail, { maxResults: 50 });
    const members = res.members || [];
    return members.length + ' member(s): ' +
           members.map(m => m.email + '[' + m.role + '/' + m.status + ']').join(', ');
  });

  // 8 — Remove, which the reconcile also needs, and which §6.1 says must be
  // distinguishable from a member removing themselves.
  attempt('8. Remove a member', () => {
    AdminDirectory.Members.remove(groupEmail, PROBE_INTERNAL_ADDRESS);
    return 'removed ' + PROBE_INTERNAL_ADDRESS;
  });

  // 9 — Delivery. The quota reading is the other half of the point: a message
  // to a group costs ONE, which is what 76_rationed_mailer.gs's whole
  // apparatus is about. Script cannot confirm delivery — check the inbox.
  attempt('9. Send one message to the group (MailApp)', () => {
    const before = MailApp.getRemainingDailyQuota();
    MailApp.sendEmail({
      to: groupEmail,
      subject: 'Groups probe — ignore',
      body: 'If this arrives at ' + PROBE_EXTERNAL_ADDRESS + ', posting and ' +
            'external delivery both work.'
    });
    const after = MailApp.getRemainingDailyQuota();
    return 'quota ' + before + ' -> ' + after + ' (a drop of 1 for the whole group' +
           '; ~1500 means Workspace, ~100 means a consumer account) — NOW CHECK ' +
           PROBE_EXTERNAL_ADDRESS + ' and the group\'s own archive';
  });

  // 10 — Delete. Never done to a real group; done here because the probe made
  // this one.
  attempt('10. Delete the probe group', () => {
    AdminDirectory.Groups.remove(groupEmail);
    return 'deleted ' + groupEmail;
  });

  return probeVerdict_(results);
}

/** Says what the run means, rather than leaving a column of PASS/FAIL to be
 *  interpreted. The three outcomes point at three different decisions. */
function probeVerdict_(results) {
  const failed = results.filter(r => r.ok === false).map(r => r.step);
  Logger.log('');
  Logger.log('================ VERDICT ================');
  if (!failed.length) {
    Logger.log('Everything the feature needs is available to this account.');
    Logger.log('Remaining question is organizational, not technical: whether the');
    Logger.log('trigger owner should PERMANENTLY hold this role (§1, §6.5).');
  } else {
    Logger.log('Refused: ' + failed.join(' | '));
    Logger.log('');
    Logger.log('Step 1 only          -> not an admin, or the Admin SDK is not enabled');
    Logger.log('                        in the Cloud project behind this script.');
    Logger.log('Step 2 but not 1     -> a read-only admin role. §1\'s report-only');
    Logger.log('                        version is still possible; syncing is not.');
    Logger.log('Steps 3/4 only       -> Groups Settings service missing or refused.');
    Logger.log('                        Do NOT ship clubs without it: the default');
    Logger.log('                        membership visibility is a disclosure.');
    Logger.log('Step 6 only          -> your role is fine; the TENANT forbids');
    Logger.log('                        external members. Clubs are blocked until');
    Logger.log('                        Groups for Business sharing is changed.');
    Logger.log('Step 9 only          -> posting permission, not privilege.');
  }
  Logger.log('=========================================');
  return results;
}

/** Run this if the probe died part way and left its group behind. Matches on
 *  the prefix only, so it can never touch a real group. */
function cleanUpProbeGroup() {
  const res = AdminDirectory.Groups.list({ customer: 'my_customer', maxResults: 200 });
  const stale = (res.groups || []).filter(g =>
    String(g.email || '').indexOf(PROBE_GROUP_PREFIX) === 0);
  if (!stale.length) { Logger.log('Nothing to clean up.'); return; }
  stale.forEach(g => {
    try {
      AdminDirectory.Groups.remove(g.email);
      Logger.log('Deleted ' + g.email);
    } catch (err) {
      Logger.log('Could not delete ' + g.email + ': ' + err);
    }
  });
}
