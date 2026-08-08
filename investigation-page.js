import fs from 'node:fs/promises';
import { getSupabaseAdmin } from '../server/shared.js';
import { PUBLIC_WORKFLOWS } from '../server/investigations.js';

const templateUrl = new URL('../investigation.html', import.meta.url);

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function replaceOnce(source, search, replacement) {
  return source.includes(search) ? source.replace(search, replacement) : source;
}

async function socialImageUrl(supabase, investigation) {
  let path = investigation.social_image_path || null;
  if (!path && investigation.featured_evidence_id) {
    const { data: evidence } = await supabase
      .from('investigation_evidence')
      .select('storage_path, public_preview_path, visibility')
      .eq('id', investigation.featured_evidence_id)
      .eq('visibility', 'Public')
      .maybeSingle();
    path = evidence?.public_preview_path || evidence?.storage_path || null;
  }
  if (!path) return 'https://www.theunshakenmajority.com/assets/social-preview.jpg';
  const { data } = await supabase.storage.from('investigation-evidence').createSignedUrl(path, 86400);
  return data?.signedUrl || 'https://www.theunshakenmajority.com/assets/social-preview.jpg';
}

function unavailablePage(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Investigation unavailable | The Unshaken Majority</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/assets/favicon.png"></head><body><main class="section"><div class="container"><div class="notice error-notice"><h1>Investigation unavailable</h1><p>${escapeHtml(message)}</p><a class="btn btn-primary" href="/investigations">Return to Investigations</a></div></div></main></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }
  try {
    const slug = String(req.query.slug || '').trim().slice(0, 160);
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) return res.status(404).send(unavailablePage('The requested case could not be found.'));
    const supabase = getSupabaseAdmin();
    const { data: investigation, error } = await supabase
      .from('investigations')
      .select('id, case_number, slug, title, subtitle, subject, short_summary, seo_title, seo_description, published_at, updated_at, workflow_status, public_visible, featured_evidence_id, social_image_path')
      .eq('slug', slug)
      .maybeSingle();
    if (error) throw error;
    if (!investigation || !investigation.public_visible || !PUBLIC_WORKFLOWS.has(investigation.workflow_status)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).send(unavailablePage('This investigation is not publicly available.'));
    }

    const [template, image] = await Promise.all([
      fs.readFile(templateUrl, 'utf8'),
      socialImageUrl(supabase, investigation)
    ]);
    const base = (process.env.SITE_URL || 'https://www.theunshakenmajority.com').replace(/\/$/, '');
    const canonical = `${base}/investigations/${investigation.slug}`;
    const pageTitle = investigation.seo_title || `${investigation.case_number}: ${investigation.title}`;
    const fullTitle = `${pageTitle} | The Unshaken Majority`;
    const description = investigation.seo_description || investigation.short_summary || 'Evidence, methodology, response, findings, sources, and corrections.';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Report',
      headline: investigation.title,
      alternativeHeadline: investigation.subtitle || undefined,
      description,
      datePublished: investigation.published_at || undefined,
      dateModified: investigation.updated_at,
      url: canonical,
      image,
      identifier: investigation.case_number,
      about: investigation.subject || undefined,
      publisher: { '@type': 'Organization', name: 'The Unshaken Majority', url: base }
    };

    let html = template;
    html = replaceOnce(html, '<title>Investigation | The Unshaken Majority</title>', `<title>${escapeHtml(fullTitle)}</title>`);
    html = replaceOnce(html, '<meta name="description" content="A structured investigation from The Unshaken Majority.">', `<meta name="description" content="${escapeHtml(description)}">`);
    html = replaceOnce(html, '<link rel="canonical" id="canonical-url" href="https://www.theunshakenmajority.com/investigations">', `<link rel="canonical" id="canonical-url" href="${escapeHtml(canonical)}">`);
    html = replaceOnce(html, '<meta property="og:title" id="og-title" content="Investigation | The Unshaken Majority">', `<meta property="og:title" id="og-title" content="${escapeHtml(pageTitle)}">`);
    html = replaceOnce(html, '<meta property="og:description" id="og-description" content="Evidence, context, response, findings, and corrections.">', `<meta property="og:description" id="og-description" content="${escapeHtml(description)}">`);
    html = replaceOnce(html, '<meta property="og:image" id="og-image" content="https://www.theunshakenmajority.com/assets/social-preview.jpg">', `<meta property="og:image" id="og-image" content="${escapeHtml(image)}">`);
    html = replaceOnce(html, '<meta property="og:url" id="og-url" content="https://www.theunshakenmajority.com/investigations">', `<meta property="og:url" id="og-url" content="${escapeHtml(canonical)}">`);
    html = replaceOnce(html, '<meta name="twitter:title" id="twitter-title" content="Investigation | The Unshaken Majority">', `<meta name="twitter:title" id="twitter-title" content="${escapeHtml(pageTitle)}">`);
    html = replaceOnce(html, '<meta name="twitter:description" id="twitter-description" content="Evidence, context, response, findings, and corrections.">', `<meta name="twitter:description" id="twitter-description" content="${escapeHtml(description)}">`);
    html = replaceOnce(html, '<meta name="twitter:image" id="twitter-image" content="https://www.theunshakenmajority.com/assets/social-preview.jpg">', `<meta name="twitter:image" id="twitter-image" content="${escapeHtml(image)}">`);
    html = replaceOnce(html, '<link rel="icon" href="/assets/favicon.png">', `<script type="application/ld+json" id="investigation-jsonld">${safeJson(jsonLd)}</script>\n  <link rel="icon" href="/assets/favicon.png">`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).send(html);
  } catch (error) {
    console.error(error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).send(unavailablePage('The investigation page could not be generated. Please try again.'));
  }
}
