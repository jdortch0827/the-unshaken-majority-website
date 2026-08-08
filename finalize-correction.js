import {
  ValidationError, allowedOrigin, escapeHtml, getSupabaseAdmin, htmlMultiline,
  publicError, requirePost, sendEmail, sendJson, verifySession
} from '../server/shared.js';
import { INVESTIGATION_BUCKET } from '../server/investigations.js';

function adminHtml(correction, title, attachment) {
  return `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#142033;max-width:760px">
    <h1 style="color:#0a1a2f">New correction request</h1>
    <p><strong>Reference:</strong> ${escapeHtml(correction.reference_number)}</p>
    <p><strong>Investigation:</strong> ${escapeHtml(correction.case_number)} — ${escapeHtml(title)}</p>
    <p><strong>Name:</strong> ${escapeHtml(correction.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(correction.email)}</p>
    <p><strong>Organization:</strong> ${escapeHtml(correction.organization || 'Not provided')}</p>
    <h2>Statement challenged</h2><p>${htmlMultiline(correction.challenged_statement)}</p>
    <h2>Explanation</h2><p>${htmlMultiline(correction.explanation)}</p>
    <h2>Requested correction</h2><p>${htmlMultiline(correction.requested_correction)}</p>
    <p><strong>Supporting source:</strong> ${escapeHtml(correction.source_url || 'Not provided')}</p>
    <p><strong>Permission to contact:</strong> ${correction.permission_to_contact ? 'Yes' : 'No'}</p>
    <p><strong>Private attachment:</strong> ${attachment ? escapeHtml(attachment.original_filename) : 'None'}</p>
    <p>Review this request in the protected investigation workspace. Public content is not changed automatically.</p>
  </div>`;
}

function confirmationHtml(reference, caseNumber) {
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#142033;max-width:650px">
    <h1 style="color:#0a1a2f">Your correction request was received</h1>
    <p><strong>Reference number:</strong> ${escapeHtml(reference)}</p>
    <p><strong>Investigation:</strong> ${escapeHtml(caseNumber)}</p>
    <p>The request will be reviewed. Submission does not automatically change the public investigation.</p>
  </div>`;
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  if (!allowedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
  try {
    const session = verifySession(req.body?.sessionToken);
    if (session.type !== 'correction') throw new ValidationError('Correction session type is invalid.');
    const supabase = getSupabaseAdmin();
    const { data: correction, error } = await supabase.from('correction_requests').select('*').eq('id', session.correctionId).single();
    if (error || !correction) throw new ValidationError('The correction request could not be found.');

    let attachment = null;
    if (session.upload) {
      const { data: info, error: infoError } = await supabase.storage.from(INVESTIGATION_BUCKET).info(session.upload.path);
      if (infoError || !info) throw new ValidationError('The correction attachment did not finish uploading.');
      const record = {
        correction_request_id: correction.id,
        storage_path: session.upload.path,
        original_filename: session.upload.originalName,
        content_type: session.upload.contentType,
        size_bytes: Number(info.size || session.upload.sizeBytes)
      };
      const { data, error: insertError } = await supabase.from('correction_attachments').upsert(record, { onConflict: 'storage_path' }).select('*').single();
      if (insertError) throw insertError;
      attachment = data;
    }

    const adminResult = await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Correction request ${correction.reference_number} for ${correction.case_number}`,
      html: adminHtml(correction, session.title, attachment),
      replyTo: correction.email
    });
    const senderResult = await sendEmail({
      to: correction.email,
      subject: `Correction request received — ${correction.reference_number}`,
      html: confirmationHtml(correction.reference_number, correction.case_number)
    });
    await supabase.from('correction_requests').update({
      notification_status: adminResult.sent ? 'sent' : 'failed',
      notification_error: adminResult.sent ? null : adminResult.error
    }).eq('id', correction.id);

    return sendJson(res, 200, { ok: true, reference: correction.reference_number, confirmationEmailSent: Boolean(senderResult.sent) });
  } catch (error) {
    const detail = publicError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
