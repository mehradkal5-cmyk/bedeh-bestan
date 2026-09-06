import { assertObject, dueDate, validId } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';

authenticated(async (user, body) => {
  if (!validId(body.recordId) || !validId(body.idempotencyKey)) throw new Error('شناسهٔ درخواست معتبر نیست.');
  const payload = assertObject(body.payload || {});
  if (body.kind === 'extension') payload.dueAt = dueDate(payload.dueAt, true);
  return rpc('create_record_request', { p_actor: user.id, p_record: body.recordId, p_kind: body.kind, p_payload: payload, p_key: body.idempotencyKey });
});
