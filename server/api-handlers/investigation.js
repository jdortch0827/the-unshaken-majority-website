import { getSupabaseAdmin, sendJson } from '../shared.js';
import { fetchInvestigationBundle, PUBLIC_WORKFLOWS, toPublicBundle } from '../investigations.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    const slug = String(req.query.slug || '').trim();
    if (!slug) return sendJson(res, 400, { ok: false, error: 'An investigation slug is required.' });
    const supabase = getSupabaseAdmin();
    const { data: investigation, error } = await supabase
      .from('investigations')
      .select('id, workflow_status, public_visible')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    if (!investigation || !investigation.public_visible || !PUBLIC_WORKFLOWS.has(investigation.workflow_status)) {
      return sendJson(res, 404, { ok: false, error: 'This investigation is not publicly available.' });
    }
    const bundle = await fetchInvestigationBundle(supabase, investigation.id);
    const publicBundle = await toPublicBundle(supabase, bundle);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return sendJson(res, 200, { ok: true, ...publicBundle });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { ok: false, error: 'The investigation could not be loaded.' });
  }
}
