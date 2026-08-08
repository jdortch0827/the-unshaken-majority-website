import { ValidationError, cleanText, sendJson } from '../server/shared.js';
import { APPROVE_ROLES, INVESTIGATION_BUCKET, audit, getAuthenticatedAdmin, investigationError } from '../server/investigations.js';

export default async function handler(req, res) {
  try {
    const { user, profile, supabase } = await getAuthenticatedAdmin(req);
    if (req.method === 'GET') {
      let query = supabase.from('correction_requests').select('*, correction_attachments(*)').order('created_at', { ascending: false }).limit(250);
      if (req.query.investigationId) query = query.eq('investigation_id', String(req.query.investigationId));
      const { data, error } = await query;
      if (error) throw error;
      const items = data || [];
      await Promise.all(items.flatMap((item) => (item.correction_attachments || []).map(async (attachment) => {
        const { data: signed } = await supabase.storage.from(INVESTIGATION_BUCKET).createSignedUrl(attachment.storage_path, 900);
        attachment.admin_url = signed?.signedUrl || null;
      })));
      return sendJson(res, 200, { ok: true, items });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    if (!APPROVE_ROLES.has(profile.role) && profile.role !== 'editor') throw new ValidationError('Your role cannot review correction requests.');
    const id = cleanText(req.body?.id, 80, { required: true, label: 'Correction request ID' });
    const status = cleanText(req.body?.status, 30, { required: true, label: 'Correction status' });
    if (!['received', 'reviewing', 'accepted', 'declined', 'closed'].includes(status)) throw new ValidationError('Correction status is invalid.');
    const internalNotes = cleanText(req.body?.internalNotes, 12000, { label: 'Internal notes' }) || null;
    const { data: item, error: findError } = await supabase.from('correction_requests').select('*').eq('id', id).single();
    if (findError || !item) throw new ValidationError('The correction request was not found.');
    const { data, error } = await supabase.from('correction_requests').update({ status, internal_notes: internalNotes }).eq('id', id).select('*').single();
    if (error) throw error;
    await audit(supabase, { investigationId: item.investigation_id, actorUserId: user.id, action: 'correction_request_reviewed', details: { correction_id: id, from: item.status, to: status } });
    return sendJson(res, 200, { ok: true, item: data });
  } catch (error) {
    const detail = investigationError(error);
    return sendJson(res, detail.status, { ok: false, error: detail.message });
  }
}
