import { getSupabaseAdmin, sendJson } from '../server/shared.js';
import { PUBLIC_WORKFLOWS } from '../server/investigations.js';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data: rows, error } = await supabase
      .from('investigations')
      .select('id, case_number, slug, title, subtitle, subject, short_summary, status, finding_classification, custom_finding_label, finding_stage, date_opened, published_at, updated_at, category_id, featured_evidence_id, workflow_status, public_visible, public_status_visible')
      .eq('public_visible', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const publicRows = (rows || []).filter((row) => PUBLIC_WORKFLOWS.has(row.workflow_status));
    const categoryIds = [...new Set(publicRows.map((row) => row.category_id).filter(Boolean))];
    let categories = [];
    if (categoryIds.length) {
      const { data, error: categoryError } = await supabase.from('investigation_categories').select('id, name, slug').in('id', categoryIds);
      if (categoryError) throw categoryError;
      categories = data || [];
    }
    const categoryMap = new Map(categories.map((item) => [item.id, item]));

    const keyword = normalize(req.query.keyword);
    const subject = normalize(req.query.subject);
    const status = normalize(req.query.status);
    const finding = normalize(req.query.finding);
    const year = Number(req.query.year) || null;
    const category = normalize(req.query.category);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(24, Math.max(1, Number(req.query.pageSize) || 9));

    const filtered = publicRows.filter((row) => {
      const rowCategory = categoryMap.get(row.category_id);
      const haystack = normalize([row.case_number, row.title, row.subtitle, row.subject, row.short_summary, row.public_status_visible ? row.status : '', row.finding_classification, rowCategory?.name].filter(Boolean).join(' '));
      if (keyword && !haystack.includes(keyword)) return false;
      if (subject && !normalize(row.subject).includes(subject)) return false;
      if (status && (!row.public_status_visible || normalize(row.status) !== status)) return false;
      if (finding && normalize(row.finding_classification === 'Custom' ? row.custom_finding_label : row.finding_classification) !== finding) return false;
      if (year && new Date(row.date_opened || row.published_at || row.updated_at).getUTCFullYear() !== year) return false;
      if (category && normalize(rowCategory?.slug) !== category && normalize(rowCategory?.name) !== category) return false;
      return true;
    });

    const start = (page - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);
    const featuredIds = pageRows.map((row) => row.featured_evidence_id).filter(Boolean);
    const featuredMap = new Map();
    if (featuredIds.length) {
      const { data: featuredRows, error: featuredError } = await supabase
        .from('investigation_evidence')
        .select('id, storage_path, public_preview_path, visibility, alt_text')
        .in('id', featuredIds)
        .eq('visibility', 'Public');
      if (featuredError) throw featuredError;
      await Promise.all((featuredRows || []).map(async (evidence) => {
        const path = evidence.public_preview_path || evidence.storage_path;
        if (!path) return;
        const { data } = await supabase.storage.from('investigation-evidence').createSignedUrl(path, 3600);
        if (data?.signedUrl) featuredMap.set(evidence.id, { url: data.signedUrl, alt: evidence.alt_text || '' });
      }));
    }
    const items = pageRows.map((row) => ({
      ...row,
      status: row.public_status_visible ? row.status : null,
      category: categoryMap.get(row.category_id) || null,
      finding_label: row.finding_classification === 'Custom' ? row.custom_finding_label : row.finding_classification,
      featured_image: featuredMap.get(row.featured_evidence_id) || null
    }));

    const years = [...new Set(publicRows.map((row) => new Date(row.date_opened || row.published_at || row.updated_at).getUTCFullYear()))].sort((a, b) => b - a);
    const subjects = [...new Set(publicRows.map((row) => row.subject).filter(Boolean))].sort();
    const statuses = [...new Set(publicRows.filter((row) => row.public_status_visible).map((row) => row.status).filter(Boolean))].sort();
    const findings = [...new Set(publicRows.map((row) => row.finding_classification === 'Custom' ? row.custom_finding_label : row.finding_classification).filter(Boolean))].sort();

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return sendJson(res, 200, {
      ok: true,
      items,
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
        hasMore: start + pageSize < filtered.length
      },
      filters: { years, subjects, statuses, findings, categories }
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: 'The investigation archive could not be loaded.' });
  }
}
