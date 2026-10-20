// ============================================================================
// 99zt. MEMBERSHIP APPLICATION ALERT
//
// Someone fills in the membership application (the form whose id is on Config)
// and Caroline gets one email: every question and answer laid out as a table,
// and a link to the spreadsheet the form's responses land in.
//
// An installable form-submit trigger on THAT form, made by
// installMembershipApplicationAlert() (Admin menu). It is deliberately not in
// writeTriggers(): the form is not one of ours, and "Check Triggers" should not
// be able to quietly remove it — resetTriggersForHandler() only touches the
// handlers it is told about. Not pausable and not rationed, like notifyAdmin:
// one message per application is the whole volume.
// ============================================================================

const MEMBERSHIP_ALERT_HANDLER = 'onMembershipApplicationSubmit';
const MEMBERSHIP_ALERT_RECIPIENT = 'carolinemeiers@newhorizonsseniorcenter.org';

/** Admin menu: (re)install the submit trigger on the membership form. Idempotent. */
function installMembershipApplicationAlert() {
  if (!requireAuthorizedAdmin('Install Membership Application Alert')) return;
  const ui = SpreadsheetApp.getUi();
  const formId = getMembershipFormId();
  if (!formId) {
    ui.alert('Membership Application Alert',
      'No Membership Application form is set on Config, so there is nothing to watch.', ui.ButtonSet.OK);
    return;
  }
  let form;
  try {
    form = FormApp.openById(formId);
  } catch (err) {
    ui.alert('Membership Application Alert',
      `This account cannot open the membership form (${err}).`, ui.ButtonSet.OK);
    return;
  }
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === MEMBERSHIP_ALERT_HANDLER) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(MEMBERSHIP_ALERT_HANDLER).forForm(form).onFormSubmit().create();
  log(`Membership application alert installed on "${form.getTitle()}" → ${MEMBERSHIP_ALERT_RECIPIENT}.`);
  ui.alert('Membership Application Alert',
    `Done. ${MEMBERSHIP_ALERT_RECIPIENT} will be emailed each time "${form.getTitle()}" is submitted.`,
    ui.ButtonSet.OK);
}

/** The trigger handler. Never throws: a failed email goes to the office digest. */
function onMembershipApplicationSubmit(e) {
  try {
    const response = e && e.response;
    if (!response) return;
    const formId = getMembershipFormId();
    const form = e.source || (formId ? FormApp.openById(formId) : null);
    const message = buildMembershipApplicationEmail_(response, membershipResponsesUrl_(form));
    MailApp.sendEmail({
      to: MEMBERSHIP_ALERT_RECIPIENT,
      subject: message.subject,
      body: message.text,
      htmlBody: message.html,
      name: 'New Horizons registration system'
    });
  } catch (err) {
    log(`⚠️ Membership application alert failed: ${err}`);
    spoolOfficeNote('Membership applications',
      `A new membership application came in but the email to ${MEMBERSHIP_ALERT_RECIPIENT} failed (${err}). ` +
      `Check the form's responses.`);
  }
}

/** The responses spreadsheet's link, falling back to the form's own summary. */
function membershipResponsesUrl_(form) {
  if (!form) return '';
  try {
    if (form.getDestinationType() === FormApp.DestinationType.SPREADSHEET) {
      return SpreadsheetApp.openById(form.getDestinationId()).getUrl();
    }
  } catch (err) {
    log(`ℹ️ Could not open the membership responses spreadsheet (${err}).`);
  }
  try { return form.getEditUrl(); } catch (err) { return ''; }
}

function membershipHtmlEscape_(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}

/** One answer as readable text: arrays (checkboxes, grids) are flattened. */
function membershipAnswerText_(answer) {
  if (Array.isArray(answer)) {
    return answer.map(membershipAnswerText_).filter(Boolean).join(', ');
  }
  return answer === null || answer === undefined ? '' : String(answer);
}

/** Pure: {subject, text, html} for one FormResponse and the sheet link. */
function buildMembershipApplicationEmail_(response, sheetUrl) {
  const rows = response.getItemResponses().map(ir => ({
    question: String(ir.getItem().getTitle() || '(untitled question)'),
    answer: membershipAnswerText_(ir.getResponse()) || '—'
  }));
  const nameRow = rows.filter(r => /name/i.test(r.question) && r.answer !== '—')[0];
  const subject = `New membership application${nameRow ? ` — ${nameRow.answer}` : ''}`;

  const text = [subject, '']
    .concat(rows.map(r => `${r.question}\n  ${r.answer}`))
    .concat(sheetUrl ? ['', `All applications: ${sheetUrl}`] : [])
    .join('\n');

  const tableRows = rows.map(r =>
    `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;color:#555;font-weight:bold">` +
    `${membershipHtmlEscape_(r.question)}</td>` +
    `<td style="padding:6px 0;vertical-align:top">${membershipHtmlEscape_(r.answer)}</td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px">` +
    `<h2 style="margin:0 0 12px">${membershipHtmlEscape_(subject)}</h2>` +
    `<table style="border-collapse:collapse">${tableRows}</table>` +
    (sheetUrl
      ? `<p style="margin-top:16px"><a href="${membershipHtmlEscape_(sheetUrl)}">Open the membership applications sheet</a></p>`
      : '') +
    `</div>`;
  return { subject, text, html };
}
