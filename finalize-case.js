import {
  CASE_BUCKET,
  ValidationError,
  allowedOrigin,
  escapeHtml,
  getSupabaseAdmin,
  htmlMultiline,
  publicError,
  requirePost,
  sendEmail,
  sendJson,
  verifySession
} from '../server/shared.js';

function adminEmailHtml(submission, attachments) {
  const attachmentList = attachments.length
    ? `<ul>${attachments.map((file) => `<li>${escapeHtml(file.original_filename)} (${Math.ceil(file.size_bytes / 1024).toLocaleString()} KB)</li>`).join('')}</ul>`
    : '<p>No files attached.</p>';
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#142033;max-width:760px">
      <h1 style="color:#0a1a2f">New case submission</h1>
      <p><strong>Reference:</strong> ${escapeHtml(submission.reference_number)}</p>
      <p><strong>Title:</strong> ${escapeHtml(submission.title)}</p>
      <p><strong>Name or alias:</strong> ${escapeHtml(submission.name_or_alias || 'Not provided')}</p>
      <p><strong>Reply email:</strong> ${escapeHtml(submission.email || 'Not provided')}</p>
      <p><strong>Organization or issue:</strong> ${escapeHtml(submission.organization || 'Not provided')}</p>
      <p><strong>Related investigation:</strong> ${escapeHtml(submission.related_case_number || 'Not provided')}</p>
      <p><strong>Date observed:</strong> ${escapeHtml(submission.observed_date || 'Not provided')}</p>
      <h2>What happened?</h2><p>${htmlMultiline(submission.summary)}</p>
      <h2>Comparable case</h2><p>${htmlMultiline(submission.comparison)}</p>
      <h2>Source links</h2><p>${htmlMultiline(submission.source_links)}</p>
      <p><strong>Permission to contact:</strong> ${submission.permission_to_contact ? 'Yes' : 'No'}</p>
      <h2>Private attachments</h2>${attachmentList}
      <p>Review the private record and evidence in the Supabase dashboard.</p>
    </div>`;
}

function confirmationHtml(reference) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#142033;max-width:650px">
      <h1 style="color:#0a1a2f">Your case was received</h1>
      <p>Thank you for submitting information to The Unshaken Majority.</p>
      <p><strong>Reference number:</strong> ${escapeHtml(reference)}</p>
      <p>Please save this number. A submission is not a promise that we will publish or investigate the matter, but it will be reviewed under our sourcing and evidence standards.</p>
      <p>Do not reply with confidential, illegally obtained, or highly sensitive personal information.</p>
    </div>`;
}

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  if (!allowedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });

  try {
    const session = verifySession(req.body?.sessionToken);
    if (session.type !== 'case') throw new ValidationError('Submission session type is invalid.');
    const supabase = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from('case_submissions')
      .select('*')
      .eq('id', session.submissionId)
      .eq('reference_number', session.reference)
      .single();
    if (existingError || !existing) throw new ValidationError('The case submission could not be found.');
    if (existing.status === 'received') {
      return sendJson(res, 200, { ok: true, reference: existing.reference_number, alreadyFinalized: true });
    }

    const expectedUploads = Array.isArray(session.uploads) ? session.uploads : [];
    const { data: objects, error: listError } = await supabase.storage
      .from(CASE_BUCKET)
      .list(session.reference, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    if (listError) throw listError;

    const objectMap = new Map((objects || []).map((object) => [`${session.reference}/${object.name}`, object]));
    const attachments = expectedUploads.map((file) => {
      const object = objectMap.get(file.path);
      if (!object) throw new ValidationError(`The upload for ${file.originalName} did not finish. Please try again.`);
      const actualSize = Number(object.metadata?.size ?? file.sizeBytes);
      return {
        submission_id: session.submissionId,
        storage_path: file.path,
        original_filename: file.originalName,
        content_type: file.contentType,
        size_bytes: Number.isFinite(actualSize) ? Math.trunc(actualSize) : file.sizeBytes
      };
    });

    if (attachments.length) {
      const { error: attachmentError } = await supabase.from('case_attachments').insert(attachments);
      if (attachmentError && attachmentError.code !== '23505') throw attachmentError;
    }

    const { data: updated, error: updateError } = await supabase
      .from('case_submissions')
      .update({
        status: 'received',
        received_at: new Date().toISOString(),
        attachment_count: attachments.length
      })
      .eq('id', session.submissionId)
      .select('*')
      .single();
    if (updateError) throw updateError;

    const adminResult = await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[${updated.reference_number}] New case submission: ${updated.title}`,
      html: adminEmailHtml(updated, attachments),
      replyTo: updated.email || undefined
    });
    let submitterResult = { sent: false, skipped: true };
    if (updated.email) {
      submitterResult = await sendEmail({
        to: updated.email,
        subject: `The Unshaken Majority received ${updated.reference_number}`,
        html: confirmationHtml(updated.reference_number)
      });
    }

    const notificationStatus = adminResult.sent
      ? (updated.email && !submitterResult.sent ? 'admin_sent_confirmation_failed' : 'sent')
      : (adminResult.skipped ? 'not_configured' : 'failed');
    const notificationError = [adminResult.error, submitterResult.error].filter(Boolean).join(' | ') || null;
    await supabase
      .from('case_submissions')
      .update({ notification_status: notificationStatus, notification_error: notificationError })
      .eq('id', session.submissionId);

    return sendJson(res, 200, {
      ok: true,
      reference: updated.reference_number,
      confirmationEmailSent: Boolean(submitterResult.sent)
    });
  } catch (error) {
    const detail = publicError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
