import { assertObject, dueDate, sha256, validId, validToken } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';
authenticated(async (user, body) => {
  if (!validToken(body.token)) throw new Error('لینک معتبر نیست.');
  const claim = await rpc('claim_share_link', { p_actor: user.id, p_hash: await sha256(body.token), p_participant: null });
  if (claim.status !== 'accepted' || body.action === 'confirm-receipt') return claim;
  const kind = ({ 'request-extension': 'extension', 'request-return': 'return', 'record-repayment': 'payment' } as Record<string,string>)[String(body.action)];
  if (!kind) throw new Error('برای ادامه، نسخهٔ جدید برنامه را باز کنید.');
  const payload = assertObject(body.payload || {});
  if (kind === 'extension') payload.dueAt = dueDate(payload.dueAt || payload.requestedDueAt, true);
  return rpc('create_record_request', { p_actor: user.id, p_record: claim.recordId, p_kind: kind, p_payload: payload, p_key: validId(payload.idempotencyKey) ? payload.idempotencyKey : crypto.randomUUID() });
});
