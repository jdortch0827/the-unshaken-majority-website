import { getSupabaseAdmin } from '../server/shared.js';
import { PUBLIC_WORKFLOWS } from '../server/investigations.js';

function xmlEscape(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }
  const base = (process.env.SITE_URL || 'https://www.theunshakenmajority.com').replace(/\/$/, '');
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('investigations')
      .select('slug, updated_at, workflow_status, public_visible')
      .eq('public_visible', true);
    if (error) throw error;
    const staticPaths = ['', '/investigations', '/standards', '/submit', '/contact', '/privacy'];
    const urls = staticPaths.map((path) => ({ loc: `${base}${path}`, lastmod: null }));
    for (const row of data || []) {
      if (PUBLIC_WORKFLOWS.has(row.workflow_status)) urls.push({ loc: `${base}/investigations/${row.slug}`, lastmod: row.updated_at });
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((item) => `  <url><loc>${xmlEscape(item.loc)}</loc>${item.lastmod ? `<lastmod>${new Date(item.lastmod).toISOString()}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    return res.status(200).send(body);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Sitemap unavailable');
  }
}
