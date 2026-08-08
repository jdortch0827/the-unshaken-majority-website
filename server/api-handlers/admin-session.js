import { sendJson } from '../shared.js';
import { getAuthenticatedAdmin, investigationError } from '../investigations.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }
  try {
    const { user, profile } = await getAuthenticatedAdmin(req);
    return sendJson(res, 200, {
      ok: true,
      user: { id: user.id, email: user.email },
      profile
    });
  } catch (error) {
    const detail = investigationError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
