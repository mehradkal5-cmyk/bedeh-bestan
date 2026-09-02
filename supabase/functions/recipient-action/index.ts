import { admin, amount, assertObject, cors, dueDate, json, limitPublic, publicLink, text, validToken } from '../_shared/core.ts';

const allowed = new Set(['confirm-receipt', 'request-extension', 'request-return', 'record-repayment']);

async function notifyCreator(recordId: string, kind: 'receipt_confirmed' | 'extension_requested' | 'return_requested' | 'repayment_recorded', title: string, body: string) {
  const client = admin();
  const { data: record, error } = await client.from('records').select('creator_id').eq('id', recordId).single();
  if (error || !record) throw error ?? new Error('رکورد پیدا نشد.');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: existing, error: existingError } = await client.from('notifications').select('id').eq('user_id', record.creator_id).eq('record_id', recordId).eq('kind', kind).gte('created_at', since).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return;
  const { error: notificationError } = await client.from('notifications').insert({ user_id: record.creator_id, record_id: recordId, kind, title, body, delivery: 'in_app', delivery_attempted_at: new Date().toISOString() });
  if (notificationError) throw notificationError;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);
  try {
    const body = assertObject(await request.json());
    if (!validToken(body.token) || !allowed.has(String(body.action))) throw new Error('درخواست معتبر نیست.');
    const { link, tokenHash, reason } = await publicLink(body.token);
    if (!link) return json({ ok: false, code: reason ?? 'invalid', error: reason === 'expired' ? 'این لینک منقضی شده است.' : 'این لینک غیرفعال است.' }, 404);
    await limitPublic(request, tokenHash);
    const client = admin();
    const { data: record, error: recordError } = await client.from('records').select('id,kind,title,amount').eq('id', link.record_id).single();
    if (recordError || !record) throw recordError ?? new Error('رکورد پیدا نشد.');
    const { data: participant, error: participantError } = await client.from('record_participants').select('id,display_name,confirmed_at').eq('record_id', link.record_id).eq('role', 'recipient').maybeSingle();
    if (participantError || !participant) throw participantError ?? new Error('طرف مقابل پیدا نشد.');

    if (body.action === 'confirm-receipt') {
      if (participant.confirmed_at) return json({ ok: true, data: { alreadyConfirmed: true } });
      const now = new Date().toISOString();
      const update = await client.from('record_participants').update({ confirmed_at: now }).eq('id', participant.id).is('confirmed_at', null);
      if (update.error) throw update.error;
      const event = await client.from('record_events').insert({ record_id: link.record_id, actor_label: participant.display_name, event_type: 'receipt_confirmed' });
      if (event.error) throw event.error;
      await notifyCreator(link.record_id, 'receipt_confirmed', 'دریافت تأیید شد', `${participant.display_name} دریافت «${record.title}» را تأیید کرد.`);
      return json({ ok: true, data: { confirmedAt: now } });
    }

    if (body.action === 'request-extension') {
      const payload = assertObject(body.payload ?? {});
      const requestedDueAt = dueDate(payload.dueAt, true)!;
      const note = text(payload.note, 'توضیح', 0, 500, true);
      const event = await client.from('record_events').insert({ record_id: link.record_id, actor_label: participant.display_name, event_type: 'extension_requested', metadata: { requestedDueAt, note } });
      if (event.error) throw event.error;
      await notifyCreator(link.record_id, 'extension_requested', 'درخواست تمدید', `${participant.display_name} برای «${record.title}» درخواست تمدید ثبت کرد.`);
      return json({ ok: true, data: { requestedDueAt } }, 201);
    }

    if (body.action === 'request-return') {
      if (record.kind !== 'item') throw new Error('این عملیات فقط برای امانت است.');
      const event = await client.from('record_events').insert({ record_id: link.record_id, actor_label: participant.display_name, event_type: 'return_requested' });
      if (event.error) throw event.error;
      await notifyCreator(link.record_id, 'return_requested', 'بازگشت آمادهٔ تأیید است', `${participant.display_name} اعلام کرد «${record.title}» را بازگردانده است.`);
      return json({ ok: true, data: null }, 201);
    }

    const payload = assertObject(body.payload ?? {});
    if (record.kind !== 'money' || !record.amount) throw new Error('پرداخت برای این تعهد مجاز نیست.');
    const value = amount(payload.amount);
    const { data: confirmed, error: sumError } = await client.from('repayments').select('amount').eq('record_id', link.record_id).eq('status', 'confirmed');
    if (sumError) throw sumError;
    const used = (confirmed ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0);
    if (value > Number(record.amount) - used) throw new Error('مبلغ بازپرداخت بیشتر از مانده است.');
    const { data: repayment, error } = await client.from('repayments').insert({ record_id: link.record_id, amount: value, payer_name: text(payload.payerName, 'پرداخت‌کننده', 1, 80)!, note: text(payload.note, 'یادداشت', 0, 500, true) }).select('id').single();
    if (error || !repayment) throw error ?? new Error('پرداخت ثبت نشد.');
    const event = await client.from('record_events').insert({ record_id: link.record_id, actor_label: participant.display_name, event_type: 'repayment_recorded', metadata: { repaymentId: repayment.id, amount: value } });
    if (event.error) throw event.error;
    await notifyCreator(link.record_id, 'repayment_recorded', 'پرداخت ثبت شد', `${participant.display_name} یک پرداخت برای «${record.title}» ثبت کرد.`);
    return json({ ok: true, data: { id: repayment.id } }, 201);
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'خطای سرویس' }, 400); }
});
