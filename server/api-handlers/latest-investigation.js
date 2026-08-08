import { getSupabaseAdmin, sendJson } from '../shared.js';
import { PUBLIC_WORKFLOWS } from '../investigations.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('investigations')
      .select('case_number, slug, title, short_summary, status, finding_classification, custom_finding_label, finding_stage, published_at, updated_at, workflow_status, public_visible, public_status_visible, featured_evidence_id')
      .eq('public_visible', true)
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    const item = (data || []).find((row) => PUBLIC_WORKFLOWS.has(row.workflow_status)) || null;
    let featuredImage = null;
    if (item?.featured_evidence_id) {
      const { data: evidence } = await supabase.from('investigation_evidence').select('storage_path, public_preview_path, visibility, alt_text').eq('id', item.featured_evidence_id).eq('visibility', 'Public').maybeSingle();
      const path = evidence?.public_preview_path || evidence?.storage_path;
      if (path) {
        const { data: signed } = await supabase.storage.from('investigation-evidence').createSignedUrl(path, 3600);
        if (signed?.signedUrl) featuredImage = { url: signed.signedUrl, alt: evidence.alt_text || item.title };
      }
    }
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return sendJson(res, 200, {
      ok: true,
      item: item ? {
        ...item,
        status: item.public_status_visible ? item.status : null,
        featured_image: featuredImage,
        finding_label: item.finding_classification === 'Custom' ? item.custom_finding_label : item.finding_classification
      } : null
    });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: 'The latest investigation could not be loaded.' });
  }
}
