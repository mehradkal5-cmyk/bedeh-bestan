import { limitPublic, sha256, validId, validToken } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';

authenticated(async (user, body, request) => {
  if (!validToken(body.token)) throw new Error('لینک معتبر نیست.');
  if (body.participantId && !validId(body.participantId)) throw new Error('شناسهٔ سهم معتبر نیست.');
  const hash = await sha256(body.token);
  await limitPublic(request, hash);
  const code = typeof body.code === 'string' ? body.code.replace(/[\s-]/g, '').toLowerCase() : '';
  if (code && !/^[a-f0-9]{20}$/.test(code)) throw new Error('کد اختصاصی سهم را کامل وارد کن.');
  return rpc('claim_share_link', { p_actor: user.id, p_hash: hash, p_participant: body.participantId || null, p_code_hash: code ? await sha256(code) : null });
});
