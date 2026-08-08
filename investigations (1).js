import crypto from 'node:crypto';
import { getSupabaseAdmin, ValidationError, cleanText, sanitizeFilename } from './shared.js';

export const INVESTIGATION_BUCKET = 'investigation-evidence';
export const PUBLIC_WORKFLOWS = new Set(['published', 'withdrawn', 'archived']);
export const ADMIN_ROLES = new Set(['admin', 'editor', 'reviewer']);
export const EDIT_ROLES = new Set(['admin', 'editor']);
export const APPROVE_ROLES = new Set(['admin', 'reviewer']);
export const PUBLIC_STATUSES = [
  'Open Investigation', 'Awaiting Response', 'Under Review', 'Preliminary Finding',
  'Final Finding', 'Inconclusive', 'Corrected', 'Withdrawn', 'Archived'
];
export const FINDING_TYPES = [
  'Supported', 'Partially Supported', 'Unsupported', 'Misleading',
  'Inconsistent Enforcement', 'Insufficient Evidence', 'Inconclusive',
  'Corrected', 'Withdrawn', 'Custom'
];
export const RESPONSE_STATUSES = [
  'Not Yet Contacted', 'Contacted', 'Awaiting Response', 'Response Received',
  'Declined to Respond', 'No Response Received', 'Response Published'
];
export const WORKFLOW_STATUSES = ['draft', 'internal_review', 'approved', 'published', 'archived', 'withdrawn'];
export const EVIDENCE_VISIBILITIES = [
  'Public', 'Private', 'Internal Review Only', 'Withheld for Privacy',
  'Withheld for Legal or Safety Reasons'
];
export const EVIDENCE_TYPES = [
  'Screenshot', 'Screen Recording', 'Video', 'Audio', 'PDF', 'Document',
  'Webpage', 'Email', 'Public Statement', 'Data Table', 'Other'
];
export const UPDATE_TYPES = [
  'Evidence Added', 'Company Response Added', 'Clarification', 'Correction',
  'Finding Updated', 'Status Updated', 'Source Added', 'Investigation Withdrawn', 'Other'
];
export const SOURCE_TYPES = [
  'Primary Record', 'Official Policy', 'Webpage', 'News Report', 'Academic Research',
  'Public Statement', 'Court Record', 'Government Record', 'Data', 'Other'
];

const ADMIN_FILE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/x-m4a',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'text/csv'
]);
const ADMIN_FILE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mp3', 'wav', 'm4a',
  'pdf', 'doc', 'docx', 'txt', 'csv'
]);
export const ADMIN_MAX_FILE_SIZE = 50 * 1024 * 1024;

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `investigation-${Date.now()}`;
}

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeHref(raw) {
  const href = String(raw || '').trim();
  if (!href) return '';
  if (/^(https?:\/\/|mailto:|\/)/i.test(href)) return href;
  return '';
}

/**
 * Small allow-list sanitizer for administrator-authored rich text. The editor only
 * offers these tags, and the server removes every attribute except a safe link href.
 */
export function sanitizeRichText(input, maxLength = 50000) {
  const html = String(input || '').replace(/\0/g, '').slice(0, maxLength);
  if (!html.trim()) return '';
  const withoutDangerous = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:script|style|iframe|object|embed|form|input|button|svg|math)[^>]*>/gi, '');
  const allowed = new Set(['p', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'ol', 'ul', 'li', 'blockquote', 'a', 'br']);
  let output = '';
  let lastIndex = 0;
  const tagPattern = /<\/?[a-zA-Z0-9]+\b[^>]*>/g;
  for (const match of withoutDangerous.matchAll(tagPattern)) {
    output += escapeText(withoutDangerous.slice(lastIndex, match.index));
    const tagText = match[0];
    const closing = /^<\//.test(tagText);
    const nameMatch = tagText.match(/^<\/?\s*([a-zA-Z0-9]+)/);
    const name = nameMatch?.[1]?.toLowerCase();
    if (name && allowed.has(name)) {
      if (closing) {
        if (name !== 'br') output += `</${name}>`;
      } else if (name === 'a') {
        const hrefMatch = tagText.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        const href = safeHref(hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3]);
        output += href ? `<a href="${escapeText(href)}" target="_blank" rel="noopener noreferrer">` : '<a>';
      } else if (name === 'br') {
        output += '<br>';
      } else {
        output += `<${name}>`;
      }
    }
    lastIndex = (match.index || 0) + tagText.length;
  }
  output += escapeText(withoutDangerous.slice(lastIndex));
  return output.trim();
}

export function cleanOptionalDateTime(value) {
  const text = cleanText(value, 40);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new ValidationError('A date or time value is invalid.');
  return date.toISOString();
}

export function cleanOptionalDate(value) {
  const text = cleanText(value, 10);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ValidationError('A date value is invalid.');
  return text;
}

export function cleanUrl(value, { required = false, label = 'URL' } = {}) {
  const text = cleanText(value, 2048, { required, label });
  if (!text) return null;
  let url;
  try { url = new URL(text); } catch { throw new ValidationError(`${label} must be a valid web address.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError(`${label} must begin with http:// or https://.`);
  return url.toString();
}

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

export async function getAuthenticatedAdmin(req, allowedRoles = ADMIN_ROLES) {
  const token = bearerToken(req);
  if (!token) throw new AuthError('Sign in is required.', 401);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) throw new AuthError('Your administrator session is invalid or expired.', 401);
  const { data: profile, error: profileError } = await supabase
    .from('admin_profiles')
    .select('user_id, display_name, role, active')
    .eq('user_id', user.id)
    .single();
  if (profileError || !profile || !profile.active || !allowedRoles.has(profile.role)) {
    throw new AuthError('This account is not authorized for the investigation workspace.', 403);
  }
  return { user, profile, token, supabase };
}

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export function investigationError(error) {
  if (error instanceof ValidationError) return { status: 400, message: error.message };
  if (error instanceof AuthError) return { status: error.status, message: error.message };
  console.error(error);
  return { status: 500, message: 'The investigation operation could not be completed.' };
}

export async function audit(supabase, { investigationId = null, actorUserId = null, action, details = {} }) {
  const { error } = await supabase.from('investigation_audit_logs').insert({
    investigation_id: investigationId,
    actor_user_id: actorUserId,
    action,
    details
  });
  if (error) console.error('Audit log error:', error);
}

async function signedUrl(supabase, path, expiresIn = 900) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(INVESTIGATION_BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data?.signedUrl || null;
}

export async function fetchInvestigationBundle(supabase, id, { includeAdmin = false, includeSignedUrls = false } = {}) {
  const { data: investigation, error } = await supabase
    .from('investigations')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !investigation) return null;

  const [categoryResult, comparisonsResult, assertionsResult, evidenceResult, sourcesResult,
    questionsResult, responsesResult, findingsResult, updatesResult, tagLinksResult,
    assignmentsResult, auditResult, revisionsResult] = await Promise.all([
    investigation.category_id
      ? supabase.from('investigation_categories').select('id, name, slug, description').eq('id', investigation.category_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('investigation_comparisons').select('*').eq('investigation_id', id).order('sort_order'),
    supabase.from('investigation_assertions').select('*').eq('investigation_id', id).order('sort_order'),
    supabase.from('investigation_evidence').select('*').eq('investigation_id', id).order('sort_order'),
    supabase.from('investigation_sources').select('*').eq('investigation_id', id).order('sort_order'),
    supabase.from('investigation_questions').select('*').eq('investigation_id', id).order('sort_order'),
    supabase.from('investigation_responses').select('*').eq('investigation_id', id).order('created_at'),
    supabase.from('investigation_findings').select('*').eq('investigation_id', id).order('created_at'),
    supabase.from('investigation_updates').select('*').eq('investigation_id', id).order('occurred_at', { ascending: false }),
    supabase.from('investigation_tag_links').select('tag_id').eq('investigation_id', id),
    includeAdmin ? supabase.from('investigation_assignments').select('*').eq('investigation_id', id) : Promise.resolve({ data: [] }),
    includeAdmin ? supabase.from('investigation_audit_logs').select('*').eq('investigation_id', id).order('created_at', { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
    includeAdmin ? supabase.from('investigation_revisions').select('id, revision_number, change_summary, created_by, created_at').eq('investigation_id', id).order('revision_number', { ascending: false }).limit(100) : Promise.resolve({ data: [] })
  ]);

  const tagIds = (tagLinksResult.data || []).map((row) => row.tag_id);
  let tags = [];
  if (tagIds.length) {
    const { data } = await supabase.from('investigation_tags').select('*').in('id', tagIds).order('name');
    tags = data || [];
  }

  const evidence = evidenceResult.data || [];
  if (includeSignedUrls) {
    await Promise.all(evidence.map(async (item) => {
      item.admin_original_url = await signedUrl(supabase, item.storage_path, 900);
      item.admin_preview_url = await signedUrl(supabase, item.public_preview_path, 900);
    }));
  }

  return {
    investigation,
    category: categoryResult.data || null,
    comparisons: comparisonsResult.data || [],
    assertions: assertionsResult.data || [],
    evidence,
    sources: sourcesResult.data || [],
    questions: questionsResult.data || [],
    responses: responsesResult.data || [],
    findings: findingsResult.data || [],
    updates: updatesResult.data || [],
    tags,
    assignments: assignmentsResult.data || [],
    audit: auditResult.data || [],
    revisions: revisionsResult.data || []
  };
}

export async function createRevision(supabase, investigationId, actorUserId, changeSummary) {
  const bundle = await fetchInvestigationBundle(supabase, investigationId, { includeAdmin: false, includeSignedUrls: false });
  if (!bundle) return;
  const { data: latest } = await supabase
    .from('investigation_revisions')
    .select('revision_number')
    .eq('investigation_id', investigationId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const revisionNumber = (latest?.revision_number || 0) + 1;
  const { error } = await supabase.from('investigation_revisions').insert({
    investigation_id: investigationId,
    revision_number: revisionNumber,
    snapshot: bundle,
    change_summary: cleanText(changeSummary, 500) || null,
    created_by: actorUserId
  });
  if (error) throw error;
}

export function validateAdminFile(file) {
  const original = sanitizeFilename(cleanText(file?.name, 180, { required: true, label: 'File name' }));
  const contentType = cleanText(file?.type, 120, { required: true, label: 'File type' }).toLowerCase();
  const sizeBytes = Number(file?.size);
  const extension = original.includes('.') ? original.split('.').pop().toLowerCase() : '';
  if (!ADMIN_FILE_TYPES.has(contentType) || !ADMIN_FILE_EXTENSIONS.has(extension)) {
    throw new ValidationError('The evidence file type is not supported.');
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > ADMIN_MAX_FILE_SIZE) {
    throw new ValidationError('Evidence files must be larger than 0 bytes and no larger than 50 MB.');
  }
  return { originalName: original, contentType, sizeBytes: Math.trunc(sizeBytes), extension };
}

export function makeEvidencePaths(caseNumber, evidenceId, file) {
  const token = crypto.randomUUID();
  const originalPath = `investigations/${caseNumber}/${evidenceId}/original-${token}-${file.originalName}`;
  const previewPath = file.contentType.startsWith('image/')
    ? `investigations/${caseNumber}/${evidenceId}/preview-${token}.webp`
    : null;
  return { originalPath, previewPath };
}

export function currentFinding(bundle) {
  return (bundle?.findings || []).find((item) => item.is_current) || null;
}

export function findingChanged(oldFinding, nextFinding) {
  if (!oldFinding && !nextFinding) return false;
  if (!oldFinding || !nextFinding) return true;
  return ['finding_type', 'custom_label', 'headline', 'explanation_html', 'stage']
    .some((field) => String(oldFinding[field] || '') !== String(nextFinding[field] || ''));
}

export function validatePublishable(bundle) {
  const inv = bundle.investigation;
  const missing = [];
  if (!inv.title?.trim()) missing.push('title');
  if (!inv.short_summary?.trim()) missing.push('short summary');
  if (!inv.case_summary_html?.trim()) missing.push('case summary');
  if (!inv.claim_html?.trim()) missing.push('claim being examined');
  if (!inv.standard_html?.trim()) missing.push('standard being applied');
  if (!inv.methodology_html?.trim()) missing.push('methodology');
  if (!(bundle.assertions || []).some((item) => item.assertion_type === 'limitation')) missing.push('what the evidence does not establish');
  if (!currentFinding(bundle)) missing.push('current finding');
  if (!(bundle.evidence || []).some((item) => item.visibility === 'Public' && (item.storage_path || item.source_url))) missing.push('at least one public evidence exhibit or source link');
  if (!(bundle.sources || []).length) missing.push('at least one structured source');
  if (missing.length) throw new ValidationError(`Before publishing, complete: ${missing.join(', ')}.`);
}

export async function uniqueSlug(supabase, desired, excludeId = null) {
  const base = slugify(desired);
  let candidate = base;
  let suffix = 2;
  while (true) {
    let query = supabase.from('investigations').select('id').eq('slug', candidate).limit(1);
    if (excludeId) query = query.neq('id', excludeId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return candidate;
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export function publicEvidenceType(item) {
  if (item.content_type?.startsWith('image/')) return 'image';
  if (item.content_type?.startsWith('video/')) return 'video';
  if (item.content_type?.startsWith('audio/')) return 'audio';
  if (item.content_type === 'application/pdf') return 'pdf';
  if (item.content_type) return 'document';
  if (item.source_url) return 'webpage';
  return 'other';
}

export async function toPublicBundle(supabase, bundle) {
  const inv = bundle.investigation;
  const evidence = [];
  for (const item of bundle.evidence || []) {
    const withheld = item.visibility.startsWith('Withheld');
    if (item.visibility !== 'Public' && !withheld) continue;
    let mediaUrl = null;
    let originalUrl = null;
    if (item.visibility === 'Public') {
      mediaUrl = await signedUrl(supabase, item.public_preview_path || item.storage_path, 3600);
      if (item.allow_download) originalUrl = await signedUrl(supabase, item.storage_path, 3600);
    }
    evidence.push({
      id: item.id,
      exhibit_label: item.exhibit_label,
      title: item.title,
      description: item.description,
      evidence_type: item.evidence_type,
      captured_at: item.captured_at,
      source_name: item.source_name,
      source_url: item.source_url,
      visibility: item.visibility,
      withheld_reason: item.withheld_reason,
      allow_download: item.allow_download,
      authenticity_note: item.authenticity_note,
      alt_text: item.alt_text,
      transcript: item.transcript,
      featured: item.featured,
      media_kind: publicEvidenceType(item),
      media_url: mediaUrl,
      original_url: originalUrl
    });
  }
  const featured = evidence.find((item) => item.featured && item.media_url) || evidence.find((item) => item.media_kind === 'image' && item.media_url) || null;
  return {
    investigation: { ...inv, status: inv.public_status_visible ? inv.status : null },
    category: bundle.category,
    comparisons: bundle.comparisons,
    assertions: bundle.assertions,
    evidence,
    sources: bundle.sources,
    questions: bundle.questions,
    responses: (bundle.responses || []).filter((item) => item.public_visible),
    findings: bundle.findings,
    updates: (bundle.updates || []).filter((item) => item.public_visible),
    tags: bundle.tags,
    featured_image_url: featured?.media_url || null
  };
}
