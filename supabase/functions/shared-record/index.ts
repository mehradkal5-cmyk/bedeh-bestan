import { admin, assertObject, cors, decryptCard, json, limitPublic, publicLink, validToken } from '../_shared/core.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);
  try {
    const { token } = assertObject(await request.json());
    if (!validToken(token)) return json({ ok: false, code: 'invalid', error: 'لینک معتبر نیست.' }, 400);
    const { link, tokenHash, reason } = await publicLink(token);
    if (!link) return json({ ok: false, code: reason ?? 'invalid', error: reason === 'expired' ? 'این لینک منقضی شده است.' : 'این لینک غیرفعال است.' }, 404);
    await limitPublic(request, tokenHash);
    const client = admin();
    const { data: record, error } = await client.from('records').select('id,kind,title,amount,currency,due_at,status,notes,photo_paths,record_participants(display_name,role,confirmed_at),repayments(id,amount,payer_name,status,recorded_at),payment_cards(encrypted_number,encryption_iv,last4,bank_name)').eq('id', link.record_id).single();
    if (error || !record) throw error ?? new Error('رکورد پیدا نشد.');
    const card = Array.isArray(record.payment_cards) ? record.payment_cards[0] : record.payment_cards;
    const cardNumber = card ? await decryptCard(card.encrypted_number, card.encryption_iv) : null;
    await client.from('share_links').update({ last_opened_at: new Date().toISOString() }).eq('id', link.id);
    return json({ ok: true, data: { record: { ...record, payment_cards: undefined, card: card ? { number: cardNumber, last4: card.last4, bankName: card.bank_name } : null } } });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'خطای سرویس' }, 400); }
});
