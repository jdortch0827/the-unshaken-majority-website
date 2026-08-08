import adminCorrections from '../server/api-handlers/admin-corrections.js';
import adminEvidence from '../server/api-handlers/admin-evidence.js';
import adminInvestigation from '../server/api-handlers/admin-investigation.js';
import adminInvestigations from '../server/api-handlers/admin-investigations.js';
import adminSession from '../server/api-handlers/admin-session.js';
import { sendJson } from '../server/shared.js';

const handlers = Object.freeze({
  corrections: adminCorrections,
  evidence: adminEvidence,
  investigation: adminInvestigation,
  investigations: adminInvestigations,
  session: adminSession
});

export default async function handler(req, res) {
  const route = String(req.query?.route || '').trim().toLowerCase();
  const selected = handlers[route];
  if (!selected) return sendJson(res, 404, { ok: false, error: 'Administrator API route not found.' });
  return selected(req, res);
}
