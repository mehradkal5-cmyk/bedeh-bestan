import { validId } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';
authenticated(async (user, body) => {
  // Never infer the last request from a record ID, including on old clients.
  if (!validId(body.requestId)) throw new Error('برای پاسخ به همان درخواست، نسخهٔ جدید برنامه را باز کنید.');
  return rpc('respond_record_request', { p_actor: user.id, p_request: body.requestId, p_decision: body.decision || 'approved' });
});
