import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const CASE_BUCKET = 'case-evidence';
export const MAX_FILES = 5;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
export const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
export const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);

export function setJsonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function sendJson(res, status, payload) {
  setJsonHeaders(res);
  return res.status(status).json(payload);
}

export function requirePost(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return false;
  }
  return true;
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('Supabase server environment variables are not configured.');
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'the-unshaken-majority-forms/1.0' } }
  });
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (Array.isArray(forwarded)) return forwarded[0] || '';
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || '';
}

export async function verifyTurnstile({ token, req, expectedAction }) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) throw new Error('Turnstile secret is not configured.');
  if (!token || typeof token !== 'string') {
    return { success: false, reason: 'Please complete the security check.' };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  const ip = getClientIp(req);
  if (ip) body.set('remoteip', ip);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) {
    return { success: false, reason: 'The security check could not be verified. Please try again.' };
  }

  const result = await response.json();
  if (!result.success) {
    return { success: false, reason: 'The security check expired or was unsuccessful. Please try again.' };
  }
  if (expectedAction && result.action && result.action !== expectedAction) {
    return { success: false, reason: 'The security check did not match this form.' };
  }
  const expectedHostname = process.env.TURNSTILE_EXPECTED_HOSTNAME;
  if (expectedHostname && result.hostname && result.hostname !== expectedHostname) {
    return { success: false, reason: 'The security check hostname did not match.' };
  }
  return { success: true, result };
}

export function cleanText(value, maxLength, { required = false, label = 'Field' } = {}) {
  const text = typeof value === 'string' ? value.replace(/\0/g, '').trim() : '';
  if (required && !text) throw new ValidationError(`${label} is required.`);
  if (text.length > maxLength) throw new ValidationError(`${label} must be ${maxLength.toLocaleString()} characters or fewer.`);
  return text;
}

export function cleanEmail(value, { required = false } = {}) {
  const email = cleanText(value, 254, { required, label: 'Email' }).toLowerCase();
  if (!email) return '';
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!pattern.test(email)) throw new ValidationError('Enter a valid email address.');
  return email;
}

export function cleanBoolean(value) {
  return value === true || value === 'true' || value === 'Yes' || value === 'yes' || value === 'on';
}

export function cleanDate(value) {
  const date = cleanText(value, 10);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError('Date observed is not valid.');
  return date;
}

export function cleanSourceLinks(value) {
  return cleanText(value, 8000, { label: 'Source links' });
}

export function sanitizeFilename(name) {
  const raw = typeof name === 'string' ? name : 'evidence-file';
  const normalized = raw.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const collapsed = normalized.replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (collapsed || 'evidence-file').slice(0, 120);
}

export function validateFiles(files) {
  if (!Array.isArray(files)) return [];
  if (files.length > MAX_FILES) throw new ValidationError(`Upload no more than ${MAX_FILES} files.`);
  let total = 0;
  return files.map((file, index) => {
    const name = sanitizeFilename(cleanText(file?.name, 180, { required: true, label: `File ${index + 1} name` }));
    const type = cleanText(file?.type, 100, { required: true, label: `File ${index + 1} type` }).toLowerCase();
    const size = Number(file?.size);
    const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
    if (!Number.isFinite(size) || size <= 0) throw new ValidationError(`File ${index + 1} is empty or invalid.`);
    if (size > MAX_FILE_SIZE) throw new ValidationError(`${name} is larger than 10 MB.`);
    if (!ALLOWED_TYPES.has(type) || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new ValidationError(`${name} is not an accepted PDF, JPG, PNG, or WEBP file.`);
    }
    total += size;
    return { clientIndex: index, originalName: name, contentType: type, sizeBytes: Math.trunc(size) };
  }).map((file) => {
    if (total > MAX_TOTAL_SIZE) throw new ValidationError('The combined attachment size must be 25 MB or less.');
    return file;
  });
}

export function makeReference(prefix = 'TUM') {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${y}${m}${d}-${random}`;
}

function getSigningSecret() {
  const secret = process.env.SUBMISSION_SIGNING_SECRET;
  if (!secret || secret.length < 32) throw new Error('SUBMISSION_SIGNING_SECRET must contain at least 32 characters.');
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signSession(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) throw new ValidationError('Submission session is missing or invalid.');
  const [encoded, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new ValidationError('Submission session is invalid.');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('Submission session could not be read.');
  }
  if (!payload.exp || Date.now() > payload.exp) throw new ValidationError('Submission session expired. Please submit the form again.');
  return payload;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function htmlMultiline(value) {
  return escapeHtml(value || 'Not provided').replace(/\r?\n/g, '<br>');
}

export async function sendEmail({ to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!apiKey || !from || !to) return { sent: false, skipped: true, error: 'Email service is not configured.' };
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { sent: false, skipped: false, error: result?.message || `Resend returned ${response.status}.` };
  }
  return { sent: true, id: result.id || null };
}

export function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const siteUrl = process.env.SITE_URL || 'https://www.theunshakenmajority.com';
  const permitted = new Set([
    siteUrl.replace(/\/$/, ''),
    'https://theunshakenmajority.com',
    'https://www.theunshakenmajority.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ]);
  return permitted.has(origin);
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function publicError(error) {
  if (error instanceof ValidationError) return { status: 400, message: error.message };
  console.error(error);
  return { status: 500, message: 'We could not complete the submission. Please try again.' };
}
