import { MAX_FILES, MAX_FILE_SIZE, MAX_TOTAL_SIZE, sendJson } from '../server/shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY || '';
  const configured = Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    turnstileSiteKey &&
    process.env.TURNSTILE_SECRET_KEY &&
    process.env.SUBMISSION_SIGNING_SECRET
  );

  return sendJson(res, 200, {
    ok: true,
    configured,
    supabaseUrl,
    supabaseAnonKey,
    turnstileSiteKey,
    emailNotificationsConfigured: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM && process.env.ADMIN_EMAIL),
    limits: {
      maxFiles: MAX_FILES,
      maxFileSizeBytes: MAX_FILE_SIZE,
      maxTotalSizeBytes: MAX_TOTAL_SIZE,
      acceptedTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    }
  });
}
