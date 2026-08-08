import { ValidationError, cleanBoolean, cleanText, sendJson } from '../server/shared.js';
import {
  ADMIN_ROLES, APPROVE_ROLES, EDIT_ROLES, EVIDENCE_TYPES, EVIDENCE_VISIBILITIES,
  FINDING_TYPES, PUBLIC_STATUSES, RESPONSE_STATUSES, SOURCE_TYPES, UPDATE_TYPES,
  WORKFLOW_STATUSES, audit, createRevision, currentFinding, fetchInvestigationBundle,
  findingChanged, getAuthenticatedAdmin, investigationError, sanitizeRichText,
  cleanOptionalDate, cleanOptionalDateTime, cleanUrl, uniqueSlug, validatePublishable
} from '../server/investigations.js';

function ensureChoice(value, allowed, label, { nullable = false } = {}) {
  const text = cleanText(value, 120, { required: !nullable, label });
  if (!text && nullable) return null;
  if (!allowed.includes(text)) throw new ValidationError(`${label} is invalid.`);
  return text;
}

async function replaceRows(supabase, table, investigationId, rows, cleaner) {
  const { error: deleteError } = await supabase.from(table).delete().eq('investigation_id', investigationId);
  if (deleteError) throw deleteError;
  const cleaned = (Array.isArray(rows) ? rows : []).map((row, index) => cleaner(row || {}, index)).filter(Boolean);
  if (!cleaned.length) return [];
  const records = cleaned.map((row) => ({ ...row, investigation_id: investigationId }));
  const { data, error } = await supabase.from(table).insert(records).select('*');
  if (error) throw error;
  return data || [];
}

function cleanComparison(row, index) {
  const testedItem = cleanText(row.tested_item, 500, { label: 'Comparison item' });
  const result = cleanText(row.result, 500, { label: 'Comparison result' });
  if (!testedItem && !result) return null;
  if (!testedItem || !result) throw new ValidationError('Every comparison row needs both an item and a result.');
  return {
    comparison_group: cleanText(row.comparison_group, 250, { label: 'Comparison group' }) || null,
    tested_item: testedItem,
    result,
    tested_at: cleanOptionalDateTime(row.tested_at),
    evidence_label: cleanText(row.evidence_label, 120, { label: 'Evidence exhibit label' }) || null,
    notes: cleanText(row.notes, 4000, { label: 'Comparison notes' }) || null,
    sort_order: index * 10 + 10
  };
}

function cleanAssertion(type) {
  return (row, index) => {
    const statement = cleanText(row.statement, 5000, { label: type === 'supported' ? 'Supported finding statement' : 'Limitation' });
    if (!statement) return null;
    return { assertion_type: type, statement, sort_order: index * 10 + 10 };
  };
}

function cleanQuestion(type) {
  return (row, index) => {
    const question = cleanText(row.question, 5000, { label: 'Question' });
    if (!question) return null;
    return { question_type: type, question, sort_order: index * 10 + 10 };
  };
}

function cleanSource(row, index) {
  const title = cleanText(row.title, 500, { label: 'Source title' });
  const url = cleanText(row.url, 2048, { label: 'Source URL' });
  if (!title && !url) return null;
  if (!title || !url) throw new ValidationError('Every source needs a title and URL.');
  return {
    title,
    publisher: cleanText(row.publisher, 300, { label: 'Source publisher' }) || null,
    url: cleanUrl(url, { required: true, label: 'Source URL' }),
    publication_date: cleanOptionalDate(row.publication_date),
    accessed_date: cleanOptionalDate(row.accessed_date),
    source_type: ensureChoice(row.source_type || 'Other', SOURCE_TYPES, 'Source type'),
    description: cleanText(row.description, 4000, { label: 'Source description' }) || null,
    archived_url: row.archived_url ? cleanUrl(row.archived_url, { label: 'Archived URL' }) : null,
    sort_order: index * 10 + 10
  };
}

function cleanResponse(row) {
  if (!row || !Object.keys(row).length) return null;
  const contacted = cleanBoolean(row.contacted);
  const responseStatus = ensureChoice(row.response_status || 'Not Yet Contacted', RESPONSE_STATUSES, 'Response status');
  if (!contacted && responseStatus !== 'Not Yet Contacted') {
    throw new ValidationError(`Response status “${responseStatus}” requires a documented contact attempt.`);
  }
  const responseReceivedAt = cleanOptionalDateTime(row.response_received_at);
  if (['Response Received', 'Response Published'].includes(responseStatus) && !responseReceivedAt) {
    throw new ValidationError('A received or published response requires the date it was received.');
  }
  return {
    contacted,
    contacted_at: cleanOptionalDateTime(row.contacted_at),
    contact_method: cleanText(row.contact_method, 300, { label: 'Contact method' }) || null,
    response_deadline: cleanOptionalDateTime(row.response_deadline),
    response_status: responseStatus,
    response_received_at: responseReceivedAt,
    response_html: sanitizeRichText(row.response_html, 50000) || null,
    response_document_url: row.response_document_url ? cleanUrl(row.response_document_url, { label: 'Response document URL' }) : null,
    editorial_note_html: sanitizeRichText(row.editorial_note_html, 30000) || null,
    public_visible: row.public_visible !== false
  };
}

function cleanFinding(row) {
  if (!row) return null;
  const headline = cleanText(row.headline, 500, { label: 'Finding headline' });
  const explanation = sanitizeRichText(row.explanation_html, 60000);
  if (!headline && !explanation) return null;
  if (!headline || !explanation) throw new ValidationError('The finding needs both a headline and explanation.');
  const findingType = ensureChoice(row.finding_type || 'Inconclusive', FINDING_TYPES, 'Finding classification');
  const customLabel = findingType === 'Custom' ? cleanText(row.custom_label, 200, { required: true, label: 'Custom finding label' }) : null;
  return {
    finding_type: findingType,
    custom_label: customLabel,
    headline,
    explanation_html: explanation,
    issued_at: cleanOptionalDateTime(row.issued_at),
    stage: ensureChoice(row.stage || 'Preliminary', ['Preliminary', 'Final'], 'Finding stage'),
    approving_editor_name: cleanText(row.approving_editor_name, 200, { label: 'Approving editor' }) || null,
    is_current: true
  };
}

function cleanUpdate(row) {
  const description = cleanText(row.description, 12000, { label: 'Update description' });
  if (!description) return null;
  return {
    id: cleanText(row.id, 80) || null,
    update_type: ensureChoice(row.update_type || 'Other', UPDATE_TYPES, 'Update type'),
    description,
    finding_changed: cleanBoolean(row.finding_changed),
    previous_wording: cleanText(row.previous_wording, 12000, { label: 'Previous wording' }) || null,
    new_wording: cleanText(row.new_wording, 12000, { label: 'New wording' }) || null,
    public_visible: row.public_visible !== false,
    occurred_at: cleanOptionalDateTime(row.occurred_at) || new Date().toISOString()
  };
}

async function saveUpdates(supabase, investigationId, rows, userId, { preserveHistory = false, existingRows = [] } = {}) {
  const supplied = Array.isArray(rows) ? rows : [];
  const existingById = new Map((existingRows || []).map((row) => [row.id, row]));
  const suppliedIds = new Set(supplied.map((row) => cleanText(row?.id, 80)).filter(Boolean));

  if (!preserveHistory) {
    for (const existing of existingRows || []) {
      if (!suppliedIds.has(existing.id)) {
        const { error } = await supabase.from('investigation_updates').delete().eq('id', existing.id).eq('investigation_id', investigationId);
        if (error) throw error;
      }
    }
  }

  for (const raw of supplied) {
    const row = cleanUpdate(raw);
    if (!row) continue;
    if (row.id) {
      const id = row.id;
      delete row.id;
      if (preserveHistory) {
        if (!existingById.has(id)) throw new ValidationError('A published update-log entry could not be verified. Reload the editor and try again.');
        continue;
      }
      const { error } = await supabase.from('investigation_updates').update(row).eq('id', id).eq('investigation_id', investigationId);
      if (error) throw error;
    } else {
      delete row.id;
      const { error } = await supabase.from('investigation_updates').insert({ ...row, investigation_id: investigationId, created_by: userId });
      if (error) throw error;
    }
  }
}

async function saveTags(supabase, investigationId, tags) {
  const names = [...new Set((Array.isArray(tags) ? tags : []).map((tag) => cleanText(tag.name || tag, 100)).filter(Boolean))];
  const { error: deleteError } = await supabase.from('investigation_tag_links').delete().eq('investigation_id', investigationId);
  if (deleteError) throw deleteError;
  if (!names.length) return;
  const tagRows = [];
  for (const name of names) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const { data, error } = await supabase.from('investigation_tags').upsert({ name, slug }, { onConflict: 'slug' }).select('id').single();
    if (error) throw error;
    tagRows.push({ investigation_id: investigationId, tag_id: data.id });
  }
  const { error } = await supabase.from('investigation_tag_links').insert(tagRows);
  if (error) throw error;
}

async function saveEvidenceMetadata(supabase, investigationId, evidenceRows, userId) {
  for (let index = 0; index < (Array.isArray(evidenceRows) ? evidenceRows : []).length; index += 1) {
    const row = evidenceRows[index] || {};
    const id = cleanText(row.id, 80);
    if (!id) continue;
    const record = {
      exhibit_label: cleanText(row.exhibit_label, 120, { required: true, label: 'Exhibit label' }),
      title: cleanText(row.title, 500, { required: true, label: 'Evidence title' }),
      description: cleanText(row.description, 8000, { label: 'Evidence description' }) || null,
      evidence_type: ensureChoice(row.evidence_type || 'Other', EVIDENCE_TYPES, 'Evidence type'),
      captured_at: cleanOptionalDateTime(row.captured_at),
      source_name: cleanText(row.source_name, 500, { label: 'Evidence source' }) || null,
      source_url: row.source_url ? cleanUrl(row.source_url, { label: 'Original source URL' }) : null,
      visibility: ensureChoice(row.visibility || 'Private', EVIDENCE_VISIBILITIES, 'Evidence visibility'),
      withheld_reason: cleanText(row.withheld_reason, 5000, { label: 'Withheld evidence explanation' }) || null,
      allow_download: cleanBoolean(row.allow_download),
      authenticity_note: cleanText(row.authenticity_note, 5000, { label: 'Authenticity or editing note' }) || null,
      alt_text: cleanText(row.alt_text, 1000, { label: 'Image alt text' }) || null,
      transcript: cleanText(row.transcript, 40000, { label: 'Transcript or captions' }) || null,
      featured: cleanBoolean(row.featured),
      placeholder: cleanBoolean(row.placeholder),
      sort_order: index * 10 + 10,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase.from('investigation_evidence').update(record).eq('id', id).eq('investigation_id', investigationId);
    if (error) throw error;
    if (record.featured) {
      const { error: clearFeaturedError } = await supabase.from('investigation_evidence').update({ featured: false }).eq('investigation_id', investigationId).neq('id', id);
      if (clearFeaturedError) throw clearFeaturedError;
      const { error: parentFeaturedError } = await supabase.from('investigations').update({ featured_evidence_id: id, updated_by: userId }).eq('id', investigationId);
      if (parentFeaturedError) throw parentFeaturedError;
    }
  }
}

function normalizeDateTimeForComparison(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function stableRows(rows, fields) {
  return (rows || []).map((row) => Object.fromEntries(fields.map((field) => [field, field.endsWith('_at') ? normalizeDateTimeForComparison(row[field]) : (row[field] ?? null)])));
}

function cleanEvidenceForComparison(row, index) {
  const id = cleanText(row?.id, 80);
  if (!id) return null;
  return {
    id,
    exhibit_label: cleanText(row.exhibit_label, 120, { required: true, label: 'Exhibit label' }),
    title: cleanText(row.title, 500, { required: true, label: 'Evidence title' }),
    description: cleanText(row.description, 8000, { label: 'Evidence description' }) || null,
    evidence_type: ensureChoice(row.evidence_type || 'Other', EVIDENCE_TYPES, 'Evidence type'),
    captured_at: cleanOptionalDateTime(row.captured_at),
    source_name: cleanText(row.source_name, 500, { label: 'Evidence source' }) || null,
    source_url: row.source_url ? cleanUrl(row.source_url, { label: 'Original source URL' }) : null,
    visibility: ensureChoice(row.visibility || 'Private', EVIDENCE_VISIBILITIES, 'Evidence visibility'),
    withheld_reason: cleanText(row.withheld_reason, 5000, { label: 'Withheld evidence explanation' }) || null,
    allow_download: cleanBoolean(row.allow_download),
    authenticity_note: cleanText(row.authenticity_note, 5000, { label: 'Authenticity or editing note' }) || null,
    alt_text: cleanText(row.alt_text, 1000, { label: 'Image alt text' }) || null,
    transcript: cleanText(row.transcript, 40000, { label: 'Transcript or captions' }) || null,
    featured: cleanBoolean(row.featured),
    placeholder: cleanBoolean(row.placeholder),
    sort_order: index * 10 + 10
  };
}

function structuredContentChanged(existing, record, payload) {
  const parentFields = ['title', 'subtitle', 'subject', 'short_summary', 'case_summary_html', 'claim_html', 'standard_html', 'methodology_html', 'bottom_line_html', 'evidence_type', 'category_id', 'date_opened'];
  const oldParent = Object.fromEntries(parentFields.map((field) => [field, existing.investigation[field] ?? null]));
  const nextParent = Object.fromEntries(parentFields.map((field) => [field, record[field] ?? null]));

  const nextComparisons = (Array.isArray(payload.comparisons) ? payload.comparisons : []).map(cleanComparison).filter(Boolean);
  const nextSupported = (payload.assertions || []).filter((row) => row.assertion_type === 'supported').map(cleanAssertion('supported')).filter(Boolean);
  const nextLimitations = (payload.assertions || []).filter((row) => row.assertion_type === 'limitation').map(cleanAssertion('limitation')).filter(Boolean);
  const nextResponseQuestions = (payload.questions || []).filter((row) => row.question_type === 'right_of_response').map(cleanQuestion('right_of_response')).filter(Boolean);
  const nextRemainingQuestions = (payload.questions || []).filter((row) => row.question_type === 'remaining').map(cleanQuestion('remaining')).filter(Boolean);
  const nextSources = (Array.isArray(payload.sources) ? payload.sources : []).map(cleanSource).filter(Boolean);
  const nextEvidence = (Array.isArray(payload.evidence) ? payload.evidence : []).map(cleanEvidenceForComparison).filter(Boolean);

  const comparisonFields = ['comparison_group', 'tested_item', 'result', 'tested_at', 'evidence_label', 'notes', 'sort_order'];
  const assertionFields = ['assertion_type', 'statement', 'sort_order'];
  const questionFields = ['question_type', 'question', 'sort_order'];
  const sourceFields = ['title', 'publisher', 'url', 'publication_date', 'accessed_date', 'source_type', 'description', 'archived_url', 'sort_order'];
  const evidenceFields = ['id', 'exhibit_label', 'title', 'description', 'evidence_type', 'captured_at', 'source_name', 'source_url', 'visibility', 'withheld_reason', 'allow_download', 'authenticity_note', 'alt_text', 'transcript', 'featured', 'placeholder', 'sort_order'];
  const oldStructured = {
    parent: oldParent,
    comparisons: stableRows(existing.comparisons, comparisonFields),
    supported: stableRows((existing.assertions || []).filter((row) => row.assertion_type === 'supported'), assertionFields),
    limitations: stableRows((existing.assertions || []).filter((row) => row.assertion_type === 'limitation'), assertionFields),
    responseQuestions: stableRows((existing.questions || []).filter((row) => row.question_type === 'right_of_response'), questionFields),
    remainingQuestions: stableRows((existing.questions || []).filter((row) => row.question_type === 'remaining'), questionFields),
    sources: stableRows(existing.sources, sourceFields),
    evidence: stableRows((existing.evidence || []).map(cleanEvidenceForComparison).filter(Boolean), evidenceFields)
  };
  const nextStructured = {
    parent: nextParent,
    comparisons: stableRows(nextComparisons, comparisonFields),
    supported: stableRows(nextSupported, assertionFields),
    limitations: stableRows(nextLimitations, assertionFields),
    responseQuestions: stableRows(nextResponseQuestions, questionFields),
    remainingQuestions: stableRows(nextRemainingQuestions, questionFields),
    sources: stableRows(nextSources, sourceFields),
    evidence: stableRows(nextEvidence, evidenceFields)
  };
  return JSON.stringify(oldStructured) !== JSON.stringify(nextStructured);
}

async function saveBundle(supabase, user, profile, id, payload) {
  const existing = await fetchInvestigationBundle(supabase, id, { includeAdmin: true });
  if (!existing) throw new ValidationError('The investigation was not found.');
  const nextSlug = await uniqueSlug(supabase, payload.investigation?.slug || payload.investigation?.title, id);
  const nextResponse = cleanResponse((payload.responses || [])[0] || {});
  const nextFinding = cleanFinding((payload.findings || []).find((row) => row.is_current !== false) || payload.finding);
  const oldFinding = currentFinding(existing);
  const oldResponse = existing.responses?.[0] || null;
  const materialFindingChange = findingChanged(oldFinding, nextFinding);
  const responseSnapshot = (row) => row ? {
    contacted: Boolean(row.contacted), response_status: row.response_status || null,
    contacted_at: normalizeDateTimeForComparison(row.contacted_at), response_received_at: normalizeDateTimeForComparison(row.response_received_at),
    response_html: row.response_html || null, editorial_note_html: row.editorial_note_html || null
  } : null;
  const materialResponseChange = JSON.stringify(responseSnapshot(oldResponse)) !== JSON.stringify(responseSnapshot(nextResponse));
  const wasEverPublished = Boolean(existing.investigation.published_at);

  const inv = payload.investigation || {};
  const record = {
    slug: nextSlug,
    title: cleanText(inv.title, 300, { required: true, label: 'Title' }),
    subtitle: cleanText(inv.subtitle, 300, { label: 'Subtitle' }) || null,
    subject: cleanText(inv.subject, 400, { label: 'Subject or organization' }) || null,
    short_summary: cleanText(inv.short_summary, 1200, { label: 'Short summary' }) || null,
    case_summary_html: sanitizeRichText(inv.case_summary_html, 60000) || null,
    claim_html: sanitizeRichText(inv.claim_html, 40000) || null,
    standard_html: sanitizeRichText(inv.standard_html, 40000) || null,
    methodology_html: sanitizeRichText(inv.methodology_html, 60000) || null,
    bottom_line_html: sanitizeRichText(inv.bottom_line_html, 30000) || null,
    status: ensureChoice(inv.status || existing.investigation.status, PUBLIC_STATUSES, 'Public case status'),
    finding_classification: nextFinding?.finding_type || null,
    custom_finding_label: nextFinding?.custom_label || null,
    finding_stage: nextFinding?.stage || null,
    evidence_type: cleanText(inv.evidence_type, 500, { label: 'Evidence type' }) || null,
    response_status: nextResponse?.response_status || ensureChoice(inv.response_status || 'Not Yet Contacted', RESPONSE_STATUSES, 'Company response status'),
    category_id: inv.category_id || null,
    public_status_visible: inv.public_status_visible !== false,
    date_opened: cleanOptionalDate(inv.date_opened),
    seo_title: cleanText(inv.seo_title, 180, { label: 'SEO title' }) || null,
    seo_description: cleanText(inv.seo_description, 320, { label: 'SEO description' }) || null,
    social_image_path: cleanText(inv.social_image_path, 500, { label: 'Social image path' }) || null,
    assigned_editor_id: inv.assigned_editor_id || user.id,
    approving_editor_name: cleanText(inv.approving_editor_name, 200, { label: 'Approving editor' }) || null,
    updated_by: user.id
  };
  const materialStatusChange = String(existing.investigation.status || '') !== String(record.status || '');
  const materialStructuredChange = structuredContentChanged(existing, record, payload);
  const materialPublishedChange = wasEverPublished && (materialFindingChange || materialResponseChange || materialStatusChange || materialStructuredChange);
  const publicChangeDescription = cleanText(payload.findingChangeDescription, 12000, { label: 'Public material-change explanation' }) || null;
  if (materialPublishedChange && (!cleanBoolean(payload.confirmMaterialChange) || !publicChangeDescription)) {
    throw new ValidationError('Changing previously published case content, status, response, or finding requires confirmation and a public explanation.');
  }
  if (!payload.autosave || materialPublishedChange) {
    await createRevision(supabase, id, user.id, cleanText(payload.changeSummary, 500) || (materialPublishedChange ? 'Snapshot before published material change' : 'Manual save'));
  }
  const { error: updateError } = await supabase.from('investigations').update(record).eq('id', id);
  if (updateError) throw updateError;
  const { error: assignmentDeleteError } = await supabase.from('investigation_assignments').delete().eq('investigation_id', id).eq('assignment_role', 'editor');
  if (assignmentDeleteError) throw assignmentDeleteError;
  if (record.assigned_editor_id) {
    const { error: assignmentInsertError } = await supabase.from('investigation_assignments').insert({ investigation_id: id, user_id: record.assigned_editor_id, assignment_role: 'editor' });
    if (assignmentInsertError) throw assignmentInsertError;
  }

  await replaceRows(supabase, 'investigation_comparisons', id, payload.comparisons, cleanComparison);
  const supported = (payload.assertions || []).filter((row) => row.assertion_type === 'supported');
  const limitations = (payload.assertions || []).filter((row) => row.assertion_type === 'limitation');
  const assertions = [
    ...supported.map(cleanAssertion('supported')).filter(Boolean),
    ...limitations.map(cleanAssertion('limitation')).filter(Boolean)
  ].map((row, index) => ({ ...row, sort_order: index * 10 + 10 }));
  const { error: assertionDeleteError } = await supabase.from('investigation_assertions').delete().eq('investigation_id', id);
  if (assertionDeleteError) throw assertionDeleteError;
  if (assertions.length) {
    const { error } = await supabase.from('investigation_assertions').insert(assertions.map((row) => ({ ...row, investigation_id: id })));
    if (error) throw error;
  }
  const responseQuestions = (payload.questions || []).filter((row) => row.question_type === 'right_of_response');
  const remainingQuestions = (payload.questions || []).filter((row) => row.question_type === 'remaining');
  const questions = [
    ...responseQuestions.map(cleanQuestion('right_of_response')).filter(Boolean),
    ...remainingQuestions.map(cleanQuestion('remaining')).filter(Boolean)
  ].map((row, index) => ({ ...row, sort_order: index * 10 + 10 }));
  const { error: questionDeleteError } = await supabase.from('investigation_questions').delete().eq('investigation_id', id);
  if (questionDeleteError) throw questionDeleteError;
  if (questions.length) {
    const { error } = await supabase.from('investigation_questions').insert(questions.map((row) => ({ ...row, investigation_id: id })));
    if (error) throw error;
  }
  await replaceRows(supabase, 'investigation_sources', id, payload.sources, cleanSource);
  await replaceRows(supabase, 'investigation_responses', id, nextResponse ? [nextResponse] : [], (row) => row);
  await saveEvidenceMetadata(supabase, id, payload.evidence, user.id);
  await saveTags(supabase, id, payload.tags);
  await saveUpdates(supabase, id, payload.updates, user.id, { preserveHistory: wasEverPublished, existingRows: existing.updates });

  if (nextFinding) {
    if (!oldFinding) {
      const { error } = await supabase.from('investigation_findings').insert({ ...nextFinding, investigation_id: id });
      if (error) throw error;
    } else if (materialFindingChange && wasEverPublished) {
      const { error: retireFindingError } = await supabase.from('investigation_findings').update({ is_current: false }).eq('investigation_id', id).eq('is_current', true);
      if (retireFindingError) throw retireFindingError;
      const { error } = await supabase.from('investigation_findings').insert({ ...nextFinding, investigation_id: id });
      if (error) throw error;
      const oldText = `${oldFinding.finding_type}: ${oldFinding.headline}`;
      const newText = `${nextFinding.finding_type}: ${nextFinding.headline}`;
      const { error: findingUpdateError } = await supabase.from('investigation_updates').insert({
        investigation_id: id,
        update_type: 'Finding Updated',
        description: publicChangeDescription,
        finding_changed: true,
        previous_wording: oldText,
        new_wording: newText,
        public_visible: true,
        occurred_at: new Date().toISOString(),
        created_by: user.id
      });
      if (findingUpdateError) throw findingUpdateError;
    } else {
      const { error } = await supabase.from('investigation_findings').update(nextFinding).eq('id', oldFinding.id);
      if (error) throw error;
    }
  } else if (oldFinding && !wasEverPublished) {
    const { error } = await supabase.from('investigation_findings').delete().eq('id', oldFinding.id);
    if (error) throw error;
  }

  if (materialFindingChange) {
    await audit(supabase, {
      investigationId: id,
      actorUserId: user.id,
      action: 'finding_changed',
      details: {
        previous: oldFinding ? { type: oldFinding.finding_type, headline: oldFinding.headline, stage: oldFinding.stage } : null,
        current: nextFinding ? { type: nextFinding.finding_type, headline: nextFinding.headline, stage: nextFinding.stage } : null
      }
    });
  }
  if (materialResponseChange) {
    await audit(supabase, { investigationId: id, actorUserId: user.id, action: 'response_record_changed', details: { previous_status: oldResponse?.response_status || null, current_status: nextResponse?.response_status || null } });
  }
  const automaticUpdates = [];
  if (wasEverPublished && materialStatusChange) automaticUpdates.push({
    update_type: 'Status Updated', description: publicChangeDescription, finding_changed: false,
    previous_wording: existing.investigation.status, new_wording: record.status
  });
  if (wasEverPublished && materialResponseChange) automaticUpdates.push({
    update_type: 'Company Response Added', description: publicChangeDescription, finding_changed: false,
    previous_wording: oldResponse?.response_status || 'No response record', new_wording: nextResponse?.response_status || 'Response removed'
  });
  if (wasEverPublished && materialStructuredChange) automaticUpdates.push({
    update_type: 'Clarification', description: publicChangeDescription, finding_changed: false,
    previous_wording: 'Previous published case content preserved in revision history.',
    new_wording: 'Revised case content published with this explanation.'
  });
  if (automaticUpdates.length) {
    const { error: automaticUpdateError } = await supabase.from('investigation_updates').insert(automaticUpdates.map((row) => ({
      ...row, investigation_id: id, public_visible: true, occurred_at: new Date().toISOString(), created_by: user.id
    })));
    if (automaticUpdateError) throw automaticUpdateError;
  }
  await audit(supabase, {
    investigationId: id,
    actorUserId: user.id,
    action: payload.autosave ? 'investigation_autosaved' : 'investigation_edited',
    details: { role: profile.role, change_summary: cleanText(payload.changeSummary, 500) || null }
  });
  return fetchInvestigationBundle(supabase, id, { includeAdmin: true, includeSignedUrls: true });
}

async function performAction(supabase, user, profile, id, body) {
  const bundle = await fetchInvestigationBundle(supabase, id, { includeAdmin: true });
  if (!bundle) throw new ValidationError('The investigation was not found.');
  const action = cleanText(body.action, 50, { required: true, label: 'Action' });
  const confirm = cleanBoolean(body.confirm);
  const current = bundle.investigation.workflow_status;
  const update = { updated_by: user.id };
  let auditAction = action;
  let publicUpdate = null;
  let workflowFinding = null;
  let actionDetails = {};

  if (action === 'submit_review') {
    if (!EDIT_ROLES.has(profile.role) || current !== 'draft') throw new ValidationError('Only a draft can be submitted for internal review.');
    update.workflow_status = 'internal_review';
    update.status = 'Under Review';
  } else if (action === 'approve') {
    if (!APPROVE_ROLES.has(profile.role) || current !== 'internal_review') throw new ValidationError('Only an investigation in internal review can be approved.');
    update.workflow_status = 'approved';
    update.approving_editor_name = profile.display_name;
  } else if (action === 'publish') {
    if (!APPROVE_ROLES.has(profile.role) || current !== 'approved') throw new ValidationError('Only an approved investigation can be published.');
    validatePublishable(bundle);
    update.workflow_status = 'published';
    update.public_visible = true;
    update.published_at = bundle.investigation.published_at || new Date().toISOString();
    const finding = currentFinding(bundle);
    if (finding && !finding.issued_at) {
      const { error: issueFindingError } = await supabase.from('investigation_findings').update({ issued_at: new Date().toISOString(), approving_editor_name: profile.display_name }).eq('id', finding.id);
      if (issueFindingError) throw issueFindingError;
    }
  } else if (action === 'return_draft') {
    if (!ADMIN_ROLES.has(profile.role) || !['internal_review', 'approved'].includes(current)) throw new ValidationError('This investigation cannot be returned to draft.');
    update.workflow_status = 'draft';
    update.public_visible = false;
  } else if (action === 'unpublish') {
    if (!APPROVE_ROLES.has(profile.role) || current !== 'published' || !confirm) throw new ValidationError('Unpublishing requires an authorized confirmation.');
    update.workflow_status = 'approved';
    update.public_visible = false;
    publicUpdate = { update_type: 'Status Updated', description: cleanText(body.reason, 12000, { required: true, label: 'Unpublish reason' }), finding_changed: false };
  } else if (action === 'archive') {
    if (!APPROVE_ROLES.has(profile.role) || !confirm) throw new ValidationError('Archiving requires an authorized confirmation.');
    update.workflow_status = 'archived';
    update.status = 'Archived';
    update.archived_at = new Date().toISOString();
    update.public_visible = Boolean(bundle.investigation.published_at);
    publicUpdate = { update_type: 'Status Updated', description: cleanText(body.reason, 12000, { required: true, label: 'Archive explanation' }), finding_changed: false };
  } else if (action === 'withdraw') {
    if (!APPROVE_ROLES.has(profile.role) || !confirm) throw new ValidationError('Withdrawing requires an authorized confirmation.');
    update.workflow_status = 'withdrawn';
    update.status = 'Withdrawn';
    update.finding_classification = 'Withdrawn';
    update.withdrawn_at = new Date().toISOString();
    update.public_visible = Boolean(bundle.investigation.published_at);
    const withdrawalExplanation = cleanText(body.reason, 12000, { required: true, label: 'Withdrawal explanation' });
    publicUpdate = { update_type: 'Investigation Withdrawn', description: withdrawalExplanation, finding_changed: true };
    workflowFinding = {
      finding_type: 'Withdrawn', custom_label: null, headline: 'Investigation withdrawn',
      explanation_html: sanitizeRichText(`<p>${withdrawalExplanation}</p>`, 15000),
      issued_at: new Date().toISOString(), stage: 'Final', approving_editor_name: profile.display_name,
      is_current: true, investigation_id: id
    };
  } else if (action === 'override_case_number') {
    if (profile.role !== 'admin' || !confirm) throw new ValidationError('Only a system administrator may override a case number with confirmation.');
    const nextCaseNumber = cleanText(body.caseNumber, 30, { required: true, label: 'Case number' }).toUpperCase();
    if (!/^UM-\d{4}-\d{3,}$/.test(nextCaseNumber)) throw new ValidationError('Case numbers must use the UM-YYYY-### format.');
    const { data: conflict, error: conflictError } = await supabase.from('investigations').select('id').eq('case_number', nextCaseNumber).neq('id', id).maybeSingle();
    if (conflictError) throw conflictError;
    if (conflict) throw new ValidationError('That case number is already in use.');
    update.case_number = nextCaseNumber;
    const [, yearText, numberText] = nextCaseNumber.match(/^UM-(\d{4})-(\d{3,})$/);
    const caseYear = Number(yearText);
    const caseSequence = Number(numberText);
    const { data: counter } = await supabase.from('investigation_case_counters').select('last_number').eq('case_year', caseYear).maybeSingle();
    const { error: counterError } = await supabase.from('investigation_case_counters').upsert({ case_year: caseYear, last_number: Math.max(Number(counter?.last_number || 0), caseSequence), updated_at: new Date().toISOString() });
    if (counterError) throw counterError;
    auditAction = 'case_number_overridden';
    actionDetails = { previous_case_number: bundle.investigation.case_number, new_case_number: nextCaseNumber };
  } else if (action === 'delete') {
    if (profile.role !== 'admin' || current !== 'draft' || bundle.investigation.published_at || !confirm) throw new ValidationError('Only an unpublished draft may be permanently deleted by an administrator.');
    await createRevision(supabase, id, user.id, 'Final snapshot before draft deletion');
    await audit(supabase, { investigationId: id, actorUserId: user.id, action: 'draft_deleted', details: { case_number: bundle.investigation.case_number } });
    const paths = (bundle.evidence || []).flatMap((item) => [item.storage_path, item.public_preview_path]).filter(Boolean);
    if (paths.length) await supabase.storage.from('investigation-evidence').remove(paths);
    const { error } = await supabase.from('investigations').delete().eq('id', id);
    if (error) throw error;
    return { deleted: true };
  } else {
    throw new ValidationError('The requested workflow action is not supported.');
  }

  await createRevision(supabase, id, user.id, `Before workflow action: ${action}`);
  const { error } = await supabase.from('investigations').update(update).eq('id', id);
  if (error) throw error;
  if (publicUpdate) {
    const { error: publicUpdateError } = await supabase.from('investigation_updates').insert({
      investigation_id: id,
      ...publicUpdate,
      previous_wording: current,
      new_wording: update.workflow_status,
      public_visible: true,
      occurred_at: new Date().toISOString(),
      created_by: user.id
    });
    if (publicUpdateError) throw publicUpdateError;
  }
  if (workflowFinding) {
    const { error: retireFindingError } = await supabase.from('investigation_findings').update({ is_current: false }).eq('investigation_id', id).eq('is_current', true);
    if (retireFindingError) throw retireFindingError;
    const { error: workflowFindingError } = await supabase.from('investigation_findings').insert(workflowFinding);
    if (workflowFindingError) throw workflowFindingError;
  }
  await audit(supabase, { investigationId: id, actorUserId: user.id, action: auditAction, details: { from: current, to: update.workflow_status || current, reason: cleanText(body.reason, 12000) || null, ...actionDetails } });
  return fetchInvestigationBundle(supabase, id, { includeAdmin: true, includeSignedUrls: true });
}

export default async function handler(req, res) {
  try {
    const allowedRoles = req.method === 'GET' ? ADMIN_ROLES : ADMIN_ROLES;
    const { user, profile, supabase } = await getAuthenticatedAdmin(req, allowedRoles);
    const id = cleanText(req.query.id || req.body?.id, 80, { required: true, label: 'Investigation ID' });
    if (req.method === 'GET') {
      const bundle = await fetchInvestigationBundle(supabase, id, { includeAdmin: true, includeSignedUrls: true });
      if (!bundle) return sendJson(res, 404, { ok: false, error: 'Investigation not found.' });
      const [categories, editors] = await Promise.all([
        supabase.from('investigation_categories').select('*').eq('active', true).order('name'),
        supabase.from('admin_profiles').select('user_id, display_name, role, active').eq('active', true).order('display_name')
      ]);
      return sendJson(res, 200, { ok: true, profile, bundle, categories: categories.data || [], editors: editors.data || [] });
    }
    if (req.method === 'PUT') {
      if (!EDIT_ROLES.has(profile.role)) throw new ValidationError('Your role cannot edit investigations.');
      const bundle = await saveBundle(supabase, user, profile, id, req.body || {});
      return sendJson(res, 200, { ok: true, bundle });
    }
    if (req.method === 'POST') {
      const result = await performAction(supabase, user, profile, id, req.body || {});
      return sendJson(res, 200, { ok: true, ...result });
    }
    res.setHeader('Allow', 'GET, PUT, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  } catch (error) {
    const detail = investigationError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
