import crypto from 'node:crypto';
import {
  CASE_BUCKET,
  ValidationError,
  allowedOrigin,
  cleanBoolean,
  cleanDate,
  cleanEmail,
  cleanSourceLinks,
  cleanText,
  getSupabaseAdmin,
  makeReference,
  publicError,
  requirePost,
  sendJson,
  signSession,
  validateFiles,
  verifyTurnstile
} from '../server/shared.js';

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  if (!allowedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });

  try {
    const payload = req.body || {};
    if (cleanText(payload.website, 200)) return sendJson(res, 200, { ok: true, ignored: true });

    const security = await verifyTurnstile({ token: payload.turnstileToken, req, expectedAction: 'case_submission' });
    if (!security.success) throw new ValidationError(security.reason);

    const email = cleanEmail(payload.email);
    const consent = cleanBoolean(payload.consent);
    if (!consent) throw new ValidationError('You must acknowledge the submission and privacy terms.');

    const record = {
      reference_number: makeReference('TUM'),
      status: 'awaiting_uploads',
      name_or_alias: cleanText(payload.name, 160, { label: 'Name or alias' }) || null,
      email: email || null,
      title: cleanText(payload.title, 220, { required: true, label: 'Short case title' }),
      organization: cleanText(payload.organization, 220, { label: 'Organization or issue' }) || null,
      observed_date: cleanDate(payload.date),
      summary: cleanText(payload.summary, 12000, { required: true, label: 'What happened' }),
      comparison: cleanText(payload.comparison, 12000, { required: true, label: 'Comparable case' }),
      source_links: cleanSourceLinks(payload.sources) || null,
      permission_to_contact: cleanBoolean(payload.permission),
      consent_acknowledged: true,
      attachment_count: 0,
      notification_status: 'pending'
    };
    const files = validateFiles(payload.files);
    const supabase = getSupabaseAdmin();

    const { data: submission, error: insertError } = await supabase
      .from('case_submissions')
      .insert(record)
      .select('id, reference_number')
      .single();
    if (insertError) throw insertError;

    const uploads = [];
    for (const file of files) {
      const path = `${record.reference_number}/${crypto.randomUUID()}-${file.originalName}`;
      const { data, error } = await supabase.storage.from(CASE_BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      uploads.push({
        clientIndex: file.clientIndex,
        path,
        token: data.token,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes
      });
    }

    const sessionToken = signSession({
      type: 'case',
      submissionId: submission.id,
      reference: submission.reference_number,
      uploads: uploads.map(({ path, originalName, contentType, sizeBytes }) => ({ path, originalName, contentType, sizeBytes })),
      exp: Date.now() + 90 * 60 * 1000
    });

    return sendJson(res, 200, {
      ok: true,
      submissionId: submission.id,
      reference: submission.reference_number,
      uploads,
      sessionToken
    });
  } catch (error) {
    const detail = publicError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
