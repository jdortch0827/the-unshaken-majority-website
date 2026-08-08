import { sendJson } from '../server/shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  const checks = {
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
    supabaseServiceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    turnstileSiteKey: Boolean(process.env.TURNSTILE_SITE_KEY),
    turnstileSecret: Boolean(process.env.TURNSTILE_SECRET_KEY),
    signingSecret: Boolean(process.env.SUBMISSION_SIGNING_SECRET && process.env.SUBMISSION_SIGNING_SECRET.length >= 32),
    resend: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM),
    adminEmail: Boolean(process.env.ADMIN_EMAIL)
  };
  return sendJson(res, 200, { ok: true, ready: Object.values(checks).every(Boolean), checks });
}
