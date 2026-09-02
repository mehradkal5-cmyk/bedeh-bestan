import { admin, amount, assertObject, bankName, cors, dueDate, encryptCard, json, normalizedCard, randomToken, requireUser, sha256, text, validId } from '../_shared/core.ts';

type Command = 'dashboard' | 'create-record' | 'create-share-link' | 'revoke-share-link' | 'record-repayment' | 'confirm-repayment' | 'create-receipt-download' | 'change-due-date' | 'mark-returned' | 'notifications' | 'mark-notification-read';
const commands = new Set<Command>(['dashboard','create-record','create-share-link','revoke-share-link','record-repayment','confirm-repayment','create-receipt-download','change-due-date','mark-returned','notifications','mark-notification-read']);
const event = async (recordId: string, eventType: string, actorId: string, metadata: Record<string, unknown> = {}) => {
  const { error } = await admin().from('record_events').insert({ record_id: recordId, event_type: eventType, actor_id: actorId, metadata });
  if (error) throw error;
};
const owned = async (recordId: unknown, userId: string) => {
  if (!validId(recordId)) throw new Error('شناسهٔ رکورد معتبر نیست.');
  const { data, error } = await admin().from('records').select('id,kind,amount,status').eq('id', recordId).eq('creator_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('دسترسی غیرمجاز است.');
  return data;
};

async function dashboard(userId: string) {
  const client = admin();
  const { data: records, error } = await client.from('records').select('id,kind,title,amount,currency,due_at,status,notes,created_at,record_participants(display_name,role,confirmed_at),payment_cards(last4,network,bank_name),repayments(id,amount,payer_name,status,recorded_at,receipt_path,receipt_name,receipt_mime),share_links(id,revoked_at,expires_at),record_events(event_type,created_at,metadata)').eq('creator_id', userId).order('created_at', { ascending: false });
  if (error) throw error;
  return { records: records ?? [] };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);
  try {
    const user = await requireUser(request);
    const body = assertObject(await request.json());
    if (!commands.has(body.action as Command)) throw new Error('عملیات معتبر نیست.');
    const action = body.action as Command;
    const payload = assertObject(body.payload ?? {});
    const client = admin();

    if (action === 'dashboard') return json({ ok: true, data: await dashboard(user.id) });
    if (action === 'notifications') {
      const { data, error } = await client.from('notifications').select('id,record_id,kind,title,body,delivery,delivery_attempted_at,read_at,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return json({ ok: true, data: { notifications: data ?? [] } });
    }
    if (action === 'mark-notification-read') {
      if (!validId(payload.notificationId)) throw new Error('شناسهٔ اعلان معتبر نیست.');
      const { error } = await client.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', payload.notificationId).eq('user_id', user.id);
      if (error) throw error;
      return json({ ok: true, data: null });
    }
    if (action === 'create-record') {
      const kind = payload.kind;
      if (kind !== 'item' && kind !== 'money' && kind !== 'expense') throw new Error('نوع تعهد معتبر نیست.');
      const title = text(payload.title, 'عنوان', 1, 160)!;
      const recipientName = text(payload.recipientName, 'نام طرف مقابل', 1, 80)!;
      const recordAmount = kind === 'money' || payload.amount ? amount(payload.amount) : null;
      const card = payload.cardNumber ? normalizedCard(payload.cardNumber) : null;
      if (card && kind !== 'money') throw new Error('شماره کارت فقط برای قرض پول ثبت می‌شود.');
      const { data: record, error } = await client.from('records').insert({ creator_id: user.id, kind, title, amount: recordAmount, currency: payload.currency === 'IRT' ? 'IRT' : 'IRR', due_at: dueDate(payload.dueAt), notes: text(payload.notes, 'یادداشت', 0, 2000, true) }).select('id').single();
      if (error || !record) throw error ?? new Error('ذخیره نشد.');
      const participant = await client.from('record_participants').insert({ record_id: record.id, display_name: recipientName, role: kind === 'expense' ? 'contributor' : 'recipient' });
      if (participant.error) throw participant.error;
      if (card) {
        const encrypted = await encryptCard(card);
        const cardInsert = await client.from('payment_cards').insert({ record_id: record.id, owner_id: user.id, ...encrypted, last4: card.slice(-4), bank_name: bankName(card) });
        if (cardInsert.error) throw cardInsert.error;
      }
      await event(record.id, 'record_created', user.id);
      return json({ ok: true, data: { id: record.id } }, 201);
    }
    if (action === 'create-share-link') {
      const record = await owned(payload.recordId, user.id);
      const expiresAt = dueDate(payload.expiresAt);
      const token = randomToken();
      const { data: link, error } = await client.from('share_links').insert({ record_id: record.id, created_by: user.id, token_hash: await sha256(token), expires_at: expiresAt }).select('id,expires_at').single();
      if (error || !link) throw error ?? new Error('لینک ساخته نشد.');
      await event(record.id, 'share_link_created', user.id, { linkId: link.id, expiresAt: link.expires_at });
      return json({ ok: true, data: { token, expiresAt: link.expires_at } }, 201);
    }
    if (action === 'revoke-share-link') {
      if (!validId(payload.linkId)) throw new Error('شناسهٔ لینک معتبر نیست.');
      const { data: link, error } = await client.from('share_links').select('id,record_id').eq('id', payload.linkId).eq('created_by', user.id).is('revoked_at', null).maybeSingle();
      if (error || !link) throw new Error('لینک فعال پیدا نشد.');
      const update = await client.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', link.id).is('revoked_at', null);
      if (update.error) throw update.error;
      await event(link.record_id, 'link_revoked', user.id, { linkId: link.id });
      return json({ ok: true, data: null });
    }
    if (action === 'record-repayment') {
      const record = await owned(payload.recordId, user.id);
      if ((record.kind !== 'money' && record.kind !== 'expense') || !record.amount) throw new Error('پرداخت فقط برای قرض یا دنگ ثبت می‌شود.');
      const value = amount(payload.amount);
      const receiptPath = text(payload.receiptPath, 'مسیر رسید', 1, 500, true);
      const receiptName = text(payload.receiptName, 'نام رسید', 1, 180, true);
      const receiptMime = text(payload.receiptMime, 'نوع رسید', 1, 80, true);
      if (receiptPath && !receiptPath.startsWith(`${user.id}/${record.id}/`)) throw new Error('مسیر رسید معتبر نیست.');
      if (receiptMime && !['image/jpeg','image/png','image/webp','application/pdf'].includes(receiptMime)) throw new Error('فرمت رسید معتبر نیست.');
      if (Boolean(receiptPath) !== Boolean(receiptName) || Boolean(receiptPath) !== Boolean(receiptMime)) throw new Error('اطلاعات رسید کامل نیست.');
      const { data: confirmed, error: sumError } = await client.from('repayments').select('amount').eq('record_id', record.id).eq('status', 'confirmed');
      if (sumError) throw sumError;
      const used = (confirmed ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
      if (value > Number(record.amount) - used) throw new Error('مبلغ بازپرداخت بیشتر از مانده است.');
      const { data: repayment, error } = await client.from('repayments').insert({ record_id: record.id, amount: value, payer_name: text(payload.payerName, 'پرداخت‌کننده', 1, 80)!, note: text(payload.note, 'یادداشت', 0, 500, true), receipt_path: receiptPath, receipt_name: receiptName, receipt_mime: receiptMime }).select('id').single();
      if (error || !repayment) throw error ?? new Error('پرداخت ثبت نشد.');
      await event(record.id, 'repayment_recorded', user.id, { repaymentId: repayment.id, amount: value });
      return json({ ok: true, data: { id: repayment.id } }, 201);
    }
    if (action === 'create-receipt-download') {
      if (!validId(payload.repaymentId)) throw new Error('شناسهٔ پرداخت معتبر نیست.');
      const { data: repayment, error } = await client.from('repayments').select('record_id,receipt_path,receipt_name').eq('id', payload.repaymentId).maybeSingle();
      if (error || !repayment?.receipt_path) throw new Error('رسید پیدا نشد.');
      await owned(repayment.record_id, user.id);
      const { data, error: signedError } = await client.storage.from('receipts').createSignedUrl(repayment.receipt_path, 60, { download: repayment.receipt_name ?? 'receipt' });
      if (signedError || !data?.signedUrl) throw signedError ?? new Error('لینک رسید ساخته نشد.');
      return json({ ok: true, data: { url: data.signedUrl, expiresIn: 60 } });
    }
    if (action === 'confirm-repayment') {
      if (!validId(payload.repaymentId)) throw new Error('شناسهٔ پرداخت معتبر نیست.');
      const { data: repayment, error } = await client.from('repayments').select('id,record_id,status,amount').eq('id', payload.repaymentId).maybeSingle();
      if (error || !repayment) throw new Error('پرداخت پیدا نشد.');
      const record = await owned(repayment.record_id, user.id);
      if (repayment.status !== 'recorded') throw new Error('این پرداخت پیش‌تر رسیدگی شده است.');
      const update = await client.from('repayments').update({ status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: user.id }).eq('id', repayment.id).eq('status', 'recorded');
      if (update.error) throw update.error;
      const { data: confirmed, error: balanceError } = await client.from('repayments').select('amount').eq('record_id', record.id).eq('status', 'confirmed');
      if (balanceError) throw balanceError;
      const balance = Number(record.amount) - (confirmed ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
      if (balance === 0) await client.from('records').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', record.id);
      await event(record.id, 'repayment_confirmed', user.id, { repaymentId: repayment.id, amount: repayment.amount });
      return json({ ok: true, data: { balance } });
    }
    if (action === 'change-due-date') {
      const record = await owned(payload.recordId, user.id);
      const nextDueAt = dueDate(payload.dueAt, true)!;
      const update = await client.from('records').update({ due_at: nextDueAt }).eq('id', record.id);
      if (update.error) throw update.error;
      await event(record.id, 'due_date_changed', user.id, { dueAt: nextDueAt });
      return json({ ok: true, data: { dueAt: nextDueAt } });
    }
    if (action === 'mark-returned') {
      const record = await owned(payload.recordId, user.id);
      if (record.kind !== 'item') throw new Error('این عملیات برای امانت است.');
      const update = await client.from('records').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', record.id);
      if (update.error) throw update.error;
      await event(record.id, 'item_returned', user.id);
      return json({ ok: true, data: null });
    }
    throw new Error('عملیات پشتیبانی نمی‌شود.');
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'خطای سرویس' }, /دسترسی|ورود/.test(String(error)) ? 401 : 400); }
});
