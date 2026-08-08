import { ValidationError, cleanText, sendJson } from '../server/shared.js';
import {
  EDIT_ROLES, audit, fetchInvestigationBundle, getAuthenticatedAdmin,
  investigationError, slugify, uniqueSlug
} from '../server/investigations.js';

async function createInvestigation(supabase, user, payload) {
  const title = cleanText(payload.title, 300, { required: true, label: 'Title' });
  const subject = cleanText(payload.subject, 300, { label: 'Subject' }) || null;
  const { data: caseNumber, error: numberError } = await supabase.rpc('next_investigation_case_number', {
    p_year: new Date().getUTCFullYear()
  });
  if (numberError) throw numberError;
  const slug = await uniqueSlug(supabase, payload.slug || title || caseNumber);
  const record = {
    case_number: caseNumber,
    slug,
    title,
    subject,
    short_summary: cleanText(payload.shortSummary, 1000, { label: 'Short summary' }) || null,
    category_id: payload.categoryId || null,
    status: 'Open Investigation',
    response_status: 'Not Yet Contacted',
    workflow_status: 'draft',
    public_visible: false,
    public_status_visible: true,
    date_opened: new Date().toISOString().slice(0, 10),
    created_by: user.id,
    updated_by: user.id,
    assigned_editor_id: user.id
  };
  const { data, error } = await supabase.from('investigations').insert(record).select('*').single();
  if (error) throw error;
  const { error: assignmentError } = await supabase.from('investigation_assignments').insert({
    investigation_id: data.id,
    user_id: user.id,
    assignment_role: 'editor'
  });
  if (assignmentError) throw assignmentError;
  await audit(supabase, { investigationId: data.id, actorUserId: user.id, action: 'investigation_created', details: { case_number: caseNumber, title } });
  return data;
}

async function duplicateInvestigation(supabase, user, sourceId) {
  const source = await fetchInvestigationBundle(supabase, sourceId);
  if (!source) throw new ValidationError('The source investigation was not found.');
  const { data: caseNumber, error: numberError } = await supabase.rpc('next_investigation_case_number', {
    p_year: new Date().getUTCFullYear()
  });
  if (numberError) throw numberError;
  const slug = await uniqueSlug(supabase, `${source.investigation.slug}-copy`);
  const parent = { ...source.investigation };
  delete parent.id;
  delete parent.created_at;
  delete parent.updated_at;
  delete parent.featured_evidence_id;
  parent.case_number = caseNumber;
  parent.slug = slug;
  parent.title = `${parent.title} — Copy`;
  parent.workflow_status = 'draft';
  parent.public_visible = false;
  parent.published_at = null;
  parent.scheduled_publish_at = null;
  parent.withdrawn_at = null;
  parent.archived_at = null;
  parent.created_by = user.id;
  parent.updated_by = user.id;
  parent.assigned_editor_id = user.id;
  const { data: created, error } = await supabase.from('investigations').insert(parent).select('*').single();
  if (error) throw error;

  const copyRows = async (table, rows, transform = (row) => row) => {
    if (!rows?.length) return;
    const records = rows.map((row) => {
      const next = transform({ ...row });
      delete next.id;
      delete next.created_at;
      delete next.updated_at;
      next.investigation_id = created.id;
      return next;
    });
    const { error: insertError } = await supabase.from(table).insert(records);
    if (insertError) throw insertError;
  };

  await copyRows('investigation_comparisons', source.comparisons);
  await copyRows('investigation_assertions', source.assertions);
  await copyRows('investigation_sources', source.sources);
  await copyRows('investigation_questions', source.questions);
  await copyRows('investigation_responses', source.responses, (row) => ({ ...row, contacted: false, contacted_at: null, response_status: 'Not Yet Contacted', response_received_at: null, response_html: null, response_document_url: null, editorial_note_html: null }));
  await copyRows('investigation_findings', source.findings, (row) => ({ ...row, issued_at: null, approving_editor_name: null }));
  await copyRows('investigation_evidence', source.evidence, (row) => ({
    ...row,
    storage_path: null,
    public_preview_path: null,
    original_filename: null,
    content_type: null,
    size_bytes: null,
    visibility: 'Private',
    allow_download: false,
    featured: false,
    placeholder: true,
    upload_status: 'ready',
    created_by: user.id
  }));
  if (source.tags?.length) {
    const { error: tagLinkError } = await supabase.from('investigation_tag_links').insert(source.tags.map((tag) => ({ investigation_id: created.id, tag_id: tag.id })));
    if (tagLinkError) throw tagLinkError;
  }
  const { error: assignmentError } = await supabase.from('investigation_assignments').insert({ investigation_id: created.id, user_id: user.id, assignment_role: 'editor' });
  if (assignmentError) throw assignmentError;
  await audit(supabase, { investigationId: created.id, actorUserId: user.id, action: 'investigation_duplicated', details: { source_id: sourceId, source_case_number: source.investigation.case_number } });
  return created;
}

export default async function handler(req, res) {
  try {
    const { user, profile, supabase } = await getAuthenticatedAdmin(req, req.method === 'GET' ? undefined : EDIT_ROLES);
    if (req.method === 'GET') {
      const [investigationsResult, evidenceResult, responseResult, categoriesResult, profilesResult, correctionsResult] = await Promise.all([
        supabase.from('investigations').select('*').order('updated_at', { ascending: false }),
        supabase.from('investigation_evidence').select('investigation_id, placeholder, storage_path, source_url'),
        supabase.from('investigation_responses').select('investigation_id, response_status'),
        supabase.from('investigation_categories').select('*').eq('active', true).order('name'),
        supabase.from('admin_profiles').select('user_id, display_name, role, active').eq('active', true).order('display_name'),
        supabase.from('correction_requests').select('id, reference_number, investigation_id, case_number, name, email, status, challenged_statement, requested_correction, created_at').order('created_at', { ascending: false }).limit(100)
      ]);
      for (const result of [investigationsResult, evidenceResult, responseResult, categoriesResult, profilesResult, correctionsResult]) {
        if (result.error) throw result.error;
      }
      const evidenceCounts = new Map();
      for (const row of evidenceResult.data || []) {
        if (!row.placeholder && (row.storage_path || row.source_url)) evidenceCounts.set(row.investigation_id, (evidenceCounts.get(row.investigation_id) || 0) + 1);
      }
      const responseMap = new Map((responseResult.data || []).map((row) => [row.investigation_id, row.response_status]));
      const items = (investigationsResult.data || []).map((row) => ({
        ...row,
        evidence_count: evidenceCounts.get(row.id) || 0,
        response_status: responseMap.get(row.id) || row.response_status
      }));
      return sendJson(res, 200, {
        ok: true,
        profile,
        items,
        categories: categoriesResult.data || [],
        editors: profilesResult.data || [],
        corrections: correctionsResult.data || []
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    const action = cleanText(req.body?.action, 40, { required: true, label: 'Action' });
    if (action === 'create') {
      const created = await createInvestigation(supabase, user, req.body || {});
      return sendJson(res, 201, { ok: true, investigation: created });
    }
    if (action === 'duplicate') {
      const sourceId = cleanText(req.body?.id, 80, { required: true, label: 'Investigation ID' });
      const created = await duplicateInvestigation(supabase, user, sourceId);
      return sendJson(res, 201, { ok: true, investigation: created });
    }
    throw new ValidationError('The requested dashboard action is not supported.');
  } catch (error) {
    const detail = investigationError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
