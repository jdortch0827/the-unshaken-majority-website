import {
  ValidationError,
  allowedOrigin,
  cleanBoolean,
  cleanEmail,
  cleanText,
  escapeHtml,
  getSupabaseAdmin,
  htmlMultiline,
  makeReference,
  publicError,
  requirePost,
  sendEmail,
  sendJson,
  verifyTurnstile
} from '../server/shared.js';

function adminHtml(message) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#142033;max-width:720px">
      <h1 style="color:#0a1a2f">New website contact message</h1>
      <p><strong>Reference:</strong> ${escapeHtml(message.reference_number)}</p>
      <p><strong>Name:</strong> ${escapeHtml(message.name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(message.email)}</p>
      <p><strong>Category:</strong> ${escapeHtml(message.category)}</p>
      <p><strong>Subject:</strong> ${escapeHtml(message.subject)}</p>
      <h2>Message</h2><p>${htmlMultiline(message.message)}</p>
    </div>`;
}

function confirmationHtml(reference) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#142033;max-width:650px">
      <h1 style="color:#0a1a2f">Your message was received</h1>
      <p>Thank you for contacting The Unshaken Majority.</p>
      <p><strong>Reference number:</strong> ${escapeHtml(reference)}</p>
      <p>We will review your message. Response times depend on the subject and whether additional information is needed.</p>
    </div>`;
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  if (!allowedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });

  try {
    const payload = req.body || {};
    if (cleanText(payload.website, 200)) return sendJson(res, 200, { ok: true, ignored: true });
    const security = await verifyTurnstile({ token: payload.turnstileToken, req, expectedAction: 'contact_submission' });
    if (!security.success) throw new ValidationError(security.reason);
    if (!cleanBoolean(payload.consent)) throw new ValidationError('You must acknowledge the contact and privacy terms.');

    const record = {
      reference_number: makeReference('TUM-C'),
      status: 'received',
      name: cleanText(payload.name, 160, { required: true, label: 'Name' }),
      email: cleanEmail(payload.email, { required: true }),
      category: cleanText(payload.category, 80, { required: true, label: 'Category' }),
      subject: cleanText(payload.subject, 220, { required: true, label: 'Subject' }),
      message: cleanText(payload.message, 10000, { required: true, label: 'Message' }),
      consent_acknowledged: true,
      notification_status: 'pending'
    };
    const supabase = getSupabaseAdmin();
    const { data: saved, error: insertError } = await supabase
      .from('contact_messages')
      .insert(record)
      .select('*')
      .single();
    if (insertError) throw insertError;

    const adminResult = await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[${saved.reference_number}] Website contact: ${saved.subject}`,
      html: adminHtml(saved),
      replyTo: saved.email
    });
    const senderResult = await sendEmail({
      to: saved.email,
      subject: `The Unshaken Majority received ${saved.reference_number}`,
      html: confirmationHtml(saved.reference_number)
    });
    const notificationStatus = adminResult.sent
      ? (senderResult.sent ? 'sent' : 'admin_sent_confirmation_failed')
      : (adminResult.skipped ? 'not_configured' : 'failed');
    const notificationError = [adminResult.error, senderResult.error].filter(Boolean).join(' | ') || null;
    await supabase
      .from('contact_messages')
      .update({ notification_status: notificationStatus, notification_error: notificationError })
      .eq('id', saved.id);

    return sendJson(res, 200, {
      ok: true,
      reference: saved.reference_number,
      confirmationEmailSent: Boolean(senderResult.sent)
    });
  } catch (error) {
    const detail = publicError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
