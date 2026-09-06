import { limitPublic, sha256, validId, validToken } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';

authenticated(async (user, body, request) => {
  if (!validToken(body.token)) throw new Error('لینک معتبر نیست.');
  if (body.participantId && !validId(body.participantId)) throw new Error('شناسهٔ سهم معتبر نیست.');
  const hash = await sha256(body.token);
  await limitPublic(request, hash);
  return rpc('claim_share_link', { p_actor: user.id, p_hash: hash, p_participant: body.participantId || null });
});
