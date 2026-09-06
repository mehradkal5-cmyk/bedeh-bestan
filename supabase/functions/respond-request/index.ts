import { validId } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';

authenticated(async (user, body) => {
  if (!validId(body.requestId)) throw new Error('شناسهٔ درخواست معتبر نیست.');
  return rpc('respond_record_request', { p_actor: user.id, p_request: body.requestId, p_decision: body.decision });
});
