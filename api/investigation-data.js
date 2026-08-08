import investigation from '../server/api-handlers/investigation.js';
import investigations from '../server/api-handlers/investigations.js';
import latestInvestigation from '../server/api-handlers/latest-investigation.js';
import sitemap from '../server/api-handlers/sitemap.js';
import { sendJson } from '../server/shared.js';

const handlers = Object.freeze({
  detail: investigation,
  list: investigations,
  latest: latestInvestigation,
  sitemap
});

export default async function handler(req, res) {
  const route = String(req.query?.route || '').trim().toLowerCase();
  const selected = handlers[route];
  if (!selected) return sendJson(res, 404, { ok: false, error: 'Investigation API route not found.' });
  return selected(req, res);
}
