import { admin, assertObject, cors, decryptCard, json, limitPublic, publicLink, requireUser, validId, validToken } from '../_shared/core.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);
  try {
    const body = assertObject(await request.json());
    if (!validId(body.recordId)) throw new Error('شناسهٔ رکورد معتبر نیست.');
    let allowed = false;
    const bearer = request.headers.get('Authorization');
    if (bearer?.startsWith('Bearer ')) {
      try {
        const user = await requireUser(request);
        const { data } = await admin().from('payment_cards').select('id').eq('record_id', body.recordId).eq('owner_id', user.id).maybeSingle();
        allowed = Boolean(data);
      } catch { /* an anonymous function invocation may still carry a share token */ }
    }
    if (!allowed && validToken(body.token)) {
      const { link, tokenHash } = await publicLink(body.token);
      if (link) await limitPublic(request, tokenHash);
      allowed = Boolean(link && link.record_id === body.recordId);
    }
    if (!allowed) return json({ ok: false, error: 'دسترسی غیرمجاز است.' }, 403);
    const { data: card, error } = await admin().from('payment_cards').select('encrypted_number,encryption_iv,last4,bank_name').eq('record_id', body.recordId).maybeSingle();
    if (error || !card) throw error ?? new Error('کارت ثبت نشده است.');
    return json({ ok: true, data: { number: await decryptCard(card.encrypted_number, card.encryption_iv), last4: card.last4, bankName: card.bank_name } });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'خطای سرویس' }, 400); }
});
