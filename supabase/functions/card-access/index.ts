import { admin, decryptCard, validId } from '../_shared/core.ts';
import { accessible, authenticated } from '../_shared/workflow.ts';
authenticated(async (user, body) => {
  if (!validId(body.recordId)) throw new Error('شناسهٔ رکورد معتبر نیست.');
  await accessible(body.recordId, user.id);
  const { data: card, error } = await admin().from('payment_cards').select('encrypted_number,encryption_iv,last4,bank_name').eq('record_id', body.recordId).maybeSingle();
  if (error) throw error;
  if (!card) throw new Error('کارت ثبت نشده است.');
  return { number: await decryptCard(card.encrypted_number, card.encryption_iv), last4: card.last4, bankName: card.bank_name };
});
