import { admin, amount, assertObject, bankName, dueDate, encryptCard, normalizedCard, randomToken, sha256, text, validId } from '../_shared/core.ts';
import { accessible, authenticated, rpc } from '../_shared/workflow.ts';

authenticated(async (user, body) => {
  const action = body.action;
  const payload = assertObject(body.payload || {});
  const client = admin();
  if (action === 'issue-share-code') {
    if (!validId(payload.recordId) || !validId(payload.participantId)) throw new Error('شناسهٔ سهم معتبر نیست.');
    const code = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(16).padStart(2, '0')).join('');
    const result = await rpc('issue_share_code', { p_actor: user.id, p_record: payload.recordId, p_participant: payload.participantId, p_hash: await sha256(code) });
    return { ...result, code: code.match(/.{4}/g)!.join('-') };
  }
  if (action === 'dashboard') return rpc('workflow_dashboard', { p_actor: user.id });
  if (action === 'notifications') {
    const { data, error } = await client.from('notifications').select('id,record_id,request_id,kind,title,body,delivery,read_at,created_at,record_requests(id,kind,status,record_id)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    const { count, error: countError } = await client.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
    if (countError) throw countError;
    return { notifications: data, unreadCount: count };
  }
  if (action === 'mark-notification-read' || action === 'mark-all-notifications-read') {
    let query = client.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null);
    if (action === 'mark-notification-read') {
      if (!validId(payload.notificationId)) throw new Error('شناسهٔ اعلان معتبر نیست.');
      query = query.eq('id', payload.notificationId);
    }
    const { error } = await query;
    if (error) throw error;
    return null;
  }
  if (action === 'preferences' || action === 'save-preferences') {
    if (action === 'save-preferences') {
      const changes: Record<string, unknown> = { user_id: user.id };
      if (typeof payload.remindersEnabled === 'boolean') changes.reminders_enabled = payload.remindersEnabled;
      if (typeof payload.pushEnabled === 'boolean') changes.push_enabled = payload.pushEnabled;
      const { error } = await client.from('notification_preferences').upsert(changes);
      if (error) throw error;
    }
    const { data, error } = await client.from('notification_preferences').select('reminders_enabled,push_enabled').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return { preferences: data || { reminders_enabled: true, push_enabled: false } };
  }
  if (action === 'create-receipt-download') {
    if (!validId(payload.repaymentId)) throw new Error('شناسهٔ رسید معتبر نیست.');
    const { data, error } = await client.from('repayments').select('record_id,receipt_path').eq('id', payload.repaymentId).maybeSingle();
    if (error) throw error;
    if (!data?.receipt_path) throw new Error('رسیدی ثبت نشده است.');
    await accessible(data.record_id, user.id);
    const result = await client.storage.from('receipts').createSignedUrl(data.receipt_path, 60);
    if (result.error) throw result.error;
    return { url: result.data.signedUrl };
  }
  if (action === 'record-repayment') {
    if (!validId(payload.recordId)) throw new Error('شناسهٔ رکورد معتبر نیست.');
    const q = await rpc('create_record_request', { p_actor: user.id, p_record: payload.recordId, p_kind: 'payment', p_payload: payload, p_key: validId(payload.idempotencyKey) ? payload.idempotencyKey : crypto.randomUUID() });
    return { ...q, requestId: q.id };
  }
  if (action === 'confirm-repayment') {
    if (!validId(payload.repaymentId)) throw new Error('شناسهٔ پرداخت معتبر نیست.');
    const { data, error } = await client.from('repayments').select('request_id').eq('id', payload.repaymentId).maybeSingle();
    if (error) throw error;
    if (!data?.request_id) throw new Error('درخواست پرداخت پیدا نشد.');
    return rpc('respond_record_request', { p_actor: user.id, p_request: data.request_id, p_decision: 'approved' });
  }
  if (action === 'create-record') {
    const kind = payload.kind;
    if (!['item','money','expense'].includes(String(kind))) throw new Error('نوع بده‌بستان معتبر نیست.');
    const card = payload.cardNumber ? normalizedCard(payload.cardNumber) : null;
    if (card && kind === 'item') throw new Error('برای امانت کارت ثبت نمی‌شود.');
    if (card && !Deno.env.get('CARD_ENCRYPTION_KEY')) throw new Error('ثبت کارت هنوز در سرور فعال نشده است؛ فعلاً بدون کارت ثبت کنید.');
    const encrypted = card ? { ...await encryptCard(card), last4: card.slice(-4), bank_name: bankName(card) } : null;
    return rpc('workflow_command', { p_actor: user.id, p_action: action, p: {
      kind, title: text(payload.title, 'عنوان', 1, 160), recipientName: text(payload.recipientName, 'نام طرف مقابل', 1, 80),
      amount: kind === 'item' ? null : amount(payload.amount), currency: payload.currency === 'IRT' ? 'IRT' : 'IRR',
      dueAt: dueDate(payload.dueAt), notes: text(payload.notes, 'یادداشت', 0, 2000, true), card: encrypted, shares: payload.shares || null,
    } });
  }
  if (action === 'create-share-link') {
    if (!validId(payload.recordId)) throw new Error('شناسهٔ رکورد معتبر نیست.');
    const token = randomToken();
    const result = await rpc('workflow_command', { p_actor: user.id, p_action: action, p: { ...payload, tokenHash: await sha256(token), expiresAt: dueDate(payload.expiresAt) } });
    return { ...result, token };
  }
  if (['configure-shares','revoke-share-link','change-due-date','mark-returned'].includes(String(action))) {
    if (!validId(action === 'revoke-share-link' ? payload.linkId : payload.recordId)) throw new Error('شناسه معتبر نیست.');
    if (action === 'change-due-date') payload.dueAt = dueDate(payload.dueAt, true);
    return rpc('workflow_command', { p_actor: user.id, p_action: action, p: payload });
  }
  throw new Error('عملیات پشتیبانی نمی‌شود.');
});
