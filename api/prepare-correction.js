import crypto from 'node:crypto';
import {
  ValidationError, allowedOrigin, cleanBoolean, cleanEmail, cleanText, getSupabaseAdmin,
  makeReference, publicError, requirePost, sendJson, signSession, verifyTurnstile
} from '../server/shared.js';
import { INVESTIGATION_BUCKET, cleanUrl, validateAdminFile } from '../server/investigations.js';

export default async function handler(req, res) {
  if (!requirePost(req, res)) return;
  if (!allowedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Origin not allowed.' });
  try {
    const payload = req.body || {};
    if (cleanText(payload.website, 200)) return sendJson(res, 200, { ok: true, ignored: true });
    const security = await verifyTurnstile({ token: payload.turnstileToken, req, expectedAction: 'correction_submission' });
    if (!security.success) throw new ValidationError(security.reason);
    if (!cleanBoolean(payload.certification)) throw new ValidationError('You must certify that the submission is truthful to the best of your knowledge.');

    const supabase = getSupabaseAdmin();
    const caseNumber = cleanText(payload.caseNumber, 40, { required: true, label: 'Investigation case number' }).toUpperCase();
    const { data: investigation, error: investigationError } = await supabase
      .from('investigations')
      .select('id, case_number, title, public_visible')
      .eq('case_number', caseNumber)
      .maybeSingle();
    if (investigationError) throw investigationError;
    if (!investigation || !investigation.public_visible) throw new ValidationError('The investigation case number could not be found.');

    const fileMetadata = payload.file ? validateAdminFile(payload.file) : null;
    if (fileMetadata && fileMetadata.sizeBytes > 10 * 1024 * 1024) throw new ValidationError('Correction attachments must be 10 MB or smaller.');
    const reference = makeReference('COR');
    const record = {
      reference_number: reference,
      investigation_id: investigation.id,
      case_number: investigation.case_number,
      name: cleanText(payload.name, 160, { required: true, label: 'Name' }),
      email: cleanEmail(payload.email, { required: true }),
      organization: cleanText(payload.organization, 220, { label: 'Organization' }) || null,
      challenged_statement: cleanText(payload.challengedStatement, 8000, { required: true, label: 'Specific statement being challenged' }),
      explanation: cleanText(payload.explanation, 12000, { required: true, label: 'Explanation' }),
      source_url: payload.sourceUrl ? cleanUrl(payload.sourceUrl, { label: 'Supporting source URL' }) : null,
      requested_correction: cleanText(payload.requestedCorrection, 8000, { required: true, label: 'Requested correction' }),
      permission_to_contact: cleanBoolean(payload.permission),
      certification_acknowledged: true,
      status: 'received',
      notification_status: 'pending'
    };
    const { data: correction, error } = await supabase.from('correction_requests').insert(record).select('id, reference_number').single();
    if (error) throw error;

    let upload = null;
    if (fileMetadata) {
      const path = `corrections/${investigation.case_number}/${correction.id}/${crypto.randomUUID()}-${fileMetadata.originalName}`;
      const { data, error: uploadError } = await supabase.storage.from(INVESTIGATION_BUCKET).createSignedUploadUrl(path);
      if (uploadError) throw uploadError;
      upload = { path, token: data.token, file: fileMetadata };
    }

    const sessionToken = signSession({
      type: 'correction',
      correctionId: correction.id,
      reference,
      investigationId: investigation.id,
      caseNumber: investigation.case_number,
      title: investigation.title,
      upload: upload ? { path: upload.path, ...fileMetadata } : null,
      exp: Date.now() + 60 * 60 * 1000
    });

    return sendJson(res, 200, { ok: true, reference, upload, sessionToken });
  } catch (error) {
    const detail = publicError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
