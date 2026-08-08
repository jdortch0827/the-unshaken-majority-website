import crypto from 'node:crypto';
import { ValidationError, cleanBoolean, cleanText, sendJson } from '../server/shared.js';
import {
  EDIT_ROLES, EVIDENCE_TYPES, EVIDENCE_VISIBILITIES, INVESTIGATION_BUCKET,
  audit, getAuthenticatedAdmin, investigationError, makeEvidencePaths,
  validateAdminFile, cleanOptionalDateTime, cleanUrl
} from '../server/investigations.js';

function ensureChoice(value, allowed, label) {
  const text = cleanText(value, 120, { required: true, label });
  if (!allowed.includes(text)) throw new ValidationError(`${label} is invalid.`);
  return text;
}

async function prepareUpload(supabase, user, body) {
  const investigationId = cleanText(body.investigationId, 80, { required: true, label: 'Investigation ID' });
  const { data: investigation, error } = await supabase.from('investigations').select('id, case_number').eq('id', investigationId).single();
  if (error || !investigation) throw new ValidationError('The investigation was not found.');
  const file = validateAdminFile(body.file);
  const evidenceId = body.evidenceId ? cleanText(body.evidenceId, 80) : crypto.randomUUID();
  const paths = makeEvidencePaths(investigation.case_number, evidenceId, file);
  const metadata = {
    id: evidenceId,
    investigation_id: investigationId,
    exhibit_label: cleanText(body.exhibitLabel, 120, { required: true, label: 'Exhibit label' }),
    title: cleanText(body.title, 500, { required: true, label: 'Evidence title' }),
    description: cleanText(body.description, 8000, { label: 'Evidence description' }) || null,
    evidence_type: ensureChoice(body.evidenceType || 'Other', EVIDENCE_TYPES, 'Evidence type'),
    captured_at: cleanOptionalDateTime(body.capturedAt),
    source_name: cleanText(body.sourceName, 500, { label: 'Evidence source' }) || null,
    source_url: body.sourceUrl ? cleanUrl(body.sourceUrl, { label: 'Original source URL' }) : null,
    storage_path: paths.originalPath,
    public_preview_path: paths.previewPath,
    original_filename: file.originalName,
    content_type: file.contentType,
    size_bytes: file.sizeBytes,
    visibility: ensureChoice(body.visibility || 'Private', EVIDENCE_VISIBILITIES, 'Evidence visibility'),
    withheld_reason: cleanText(body.withheldReason, 5000, { label: 'Withheld evidence explanation' }) || null,
    allow_download: cleanBoolean(body.allowDownload),
    authenticity_note: cleanText(body.authenticityNote, 5000, { label: 'Authenticity note' }) || null,
    alt_text: cleanText(body.altText, 1000, { label: 'Alt text' }) || null,
    transcript: cleanText(body.transcript, 40000, { label: 'Transcript' }) || null,
    featured: cleanBoolean(body.featured),
    placeholder: false,
    upload_status: 'pending',
    created_by: user.id
  };
  const { data: existing } = await supabase.from('investigation_evidence').select('storage_path, public_preview_path').eq('id', evidenceId).maybeSingle();
  if (existing) {
    if (existing.storage_path) throw new ValidationError('Uploaded originals are preserved. Remove the existing exhibit through the audited removal action, then upload a new exhibit.');
    const { error: updateError } = await supabase.from('investigation_evidence').update(metadata).eq('id', evidenceId).eq('investigation_id', investigationId);
    if (updateError) throw updateError;
  } else {
    const { error: insertError } = await supabase.from('investigation_evidence').insert(metadata);
    if (insertError) throw insertError;
  }
  const { data: originalSigned, error: originalError } = await supabase.storage.from(INVESTIGATION_BUCKET).createSignedUploadUrl(paths.originalPath);
  if (originalError) throw originalError;
  let previewSigned = null;
  if (paths.previewPath) {
    const { data, error: previewError } = await supabase.storage.from(INVESTIGATION_BUCKET).createSignedUploadUrl(paths.previewPath);
    if (previewError) throw previewError;
    previewSigned = data;
  }
  await audit(supabase, { investigationId, actorUserId: user.id, action: 'evidence_upload_prepared', details: { evidence_id: evidenceId, exhibit_label: metadata.exhibit_label, filename: file.originalName } });
  return {
    evidenceId,
    bucket: INVESTIGATION_BUCKET,
    original: { path: paths.originalPath, token: originalSigned.token },
    preview: previewSigned ? { path: paths.previewPath, token: previewSigned.token } : null,
    file
  };
}

async function finalizeUpload(supabase, user, body) {
  const investigationId = cleanText(body.investigationId, 80, { required: true, label: 'Investigation ID' });
  const evidenceId = cleanText(body.evidenceId, 80, { required: true, label: 'Evidence ID' });
  const { data: evidence, error } = await supabase.from('investigation_evidence').select('*').eq('id', evidenceId).eq('investigation_id', investigationId).single();
  if (error || !evidence) throw new ValidationError('The evidence record was not found.');
  const { data: originalInfo, error: originalError } = await supabase.storage.from(INVESTIGATION_BUCKET).info(evidence.storage_path);
  if (originalError || !originalInfo) throw new ValidationError('The original evidence file did not finish uploading.');
  let previewReady = false;
  if (evidence.public_preview_path && cleanBoolean(body.previewUploaded)) {
    const { data: previewInfo } = await supabase.storage.from(INVESTIGATION_BUCKET).info(evidence.public_preview_path);
    previewReady = Boolean(previewInfo);
  }
  const update = {
    upload_status: 'ready',
    placeholder: false,
    size_bytes: Number(originalInfo.size || evidence.size_bytes),
    public_preview_path: previewReady ? evidence.public_preview_path : null
  };
  const { data: saved, error: updateError } = await supabase.from('investigation_evidence').update(update).eq('id', evidenceId).select('*').single();
  if (updateError) throw updateError;
  if (saved.featured) {
    const { error: clearFeaturedError } = await supabase.from('investigation_evidence').update({ featured: false }).eq('investigation_id', investigationId).neq('id', evidenceId);
    if (clearFeaturedError) throw clearFeaturedError;
    const { error: parentFeaturedError } = await supabase.from('investigations').update({ featured_evidence_id: evidenceId, updated_by: user.id }).eq('id', investigationId);
    if (parentFeaturedError) throw parentFeaturedError;
  }
  const { data: parent, error: parentError } = await supabase.from('investigations').select('published_at').eq('id', investigationId).single();
  if (parentError) throw parentError;
  if (parent?.published_at && saved.visibility === 'Public') {
    const { error: updateLogError } = await supabase.from('investigation_updates').insert({
      investigation_id: investigationId,
      update_type: 'Evidence Added',
      description: `${saved.exhibit_label} — ${saved.title} was added to the public evidence record.`,
      finding_changed: false,
      new_wording: `${saved.exhibit_label}: ${saved.title}`,
      public_visible: true,
      occurred_at: new Date().toISOString(),
      created_by: user.id
    });
    if (updateLogError) throw updateLogError;
  }
  await audit(supabase, { investigationId, actorUserId: user.id, action: 'evidence_uploaded', details: { evidence_id: evidenceId, exhibit_label: saved.exhibit_label, filename: saved.original_filename, visibility: saved.visibility } });
  return saved;
}

async function deleteEvidence(supabase, user, body) {
  const investigationId = cleanText(body.investigationId, 80, { required: true, label: 'Investigation ID' });
  const evidenceId = cleanText(body.evidenceId, 80, { required: true, label: 'Evidence ID' });
  if (!cleanBoolean(body.confirm)) throw new ValidationError('Evidence removal requires confirmation.');
  const { data: evidence, error } = await supabase.from('investigation_evidence').select('*').eq('id', evidenceId).eq('investigation_id', investigationId).single();
  if (error || !evidence) throw new ValidationError('The evidence record was not found.');
  const { data: parent, error: parentError } = await supabase.from('investigations').select('published_at').eq('id', investigationId).single();
  if (parentError) throw parentError;
  const removalReason = cleanText(body.reason, 12000, { label: 'Evidence removal reason' }) || null;
  if (parent?.published_at && evidence.visibility === 'Public' && !removalReason) throw new ValidationError('Removing public evidence from a previously published investigation requires a public explanation.');
  const paths = [evidence.storage_path, evidence.public_preview_path].filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await supabase.storage.from(INVESTIGATION_BUCKET).remove(paths);
    if (storageError) throw storageError;
  }
  const { error: deleteError } = await supabase.from('investigation_evidence').delete().eq('id', evidenceId);
  if (deleteError) throw deleteError;
  if (parent?.published_at && evidence.visibility === 'Public') {
    const { error: updateLogError } = await supabase.from('investigation_updates').insert({
      investigation_id: investigationId,
      update_type: 'Other',
      description: removalReason,
      finding_changed: false,
      previous_wording: `${evidence.exhibit_label}: ${evidence.title}`,
      new_wording: 'Public evidence removed',
      public_visible: true,
      occurred_at: new Date().toISOString(),
      created_by: user.id
    });
    if (updateLogError) throw updateLogError;
  }
  await audit(supabase, { investigationId, actorUserId: user.id, action: 'evidence_removed', details: { evidence_id: evidenceId, exhibit_label: evidence.exhibit_label, filename: evidence.original_filename, visibility: evidence.visibility, reason: removalReason } });
  return { deleted: true };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const { user, supabase } = await getAuthenticatedAdmin(req, EDIT_ROLES);
    const action = cleanText(req.body?.action, 40, { required: true, label: 'Action' });
    if (action === 'prepare') return sendJson(res, 200, { ok: true, upload: await prepareUpload(supabase, user, req.body || {}) });
    if (action === 'finalize') return sendJson(res, 200, { ok: true, evidence: await finalizeUpload(supabase, user, req.body || {}) });
    if (action === 'delete') return sendJson(res, 200, { ok: true, ...(await deleteEvidence(supabase, user, req.body || {})) });
    throw new ValidationError('The evidence action is not supported.');
  } catch (error) {
    const detail = investigationError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
