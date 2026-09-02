import { admin } from '../_shared/core.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'http://127.0.0.1:4173',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};

type Action = 'confirm-return' | 'approve-extension';

function reply(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: cors });
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('درخواست معتبر نیست.');
  return value as Record<string, unknown>;
}

function id(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
    throw new Error('شناسهٔ رکورد معتبر نیست.');
  }
  return candidate;
}

function futureDate(value: unknown) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const parsed = Date.parse(candidate);
  if (!candidate || Number.isNaN(parsed) || parsed <= Date.now()) throw new Error('موعد جدید باید در آینده باشد.');
  return new Date(parsed).toISOString();
}

async function currentUserId(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    const error = new Error('ورود لازم است.');
    (error as Error & { status?: number }).status = 401;
    throw error;
  }

  const { data, error } = await admin().auth.getUser(match[1]);
  if (error || !data.user) {
    const authError = new Error('نشست شما معتبر نیست.');
    (authError as Error & { status?: number }).status = 401;
    throw authError;
  }
  return data.user.id;
}

async function ownedRecord(recordId: string, userId: string) {
  const { data, error } = await admin()
    .from('records')
    .select('id,kind,status,due_at,creator_id')
    .eq('id', recordId)
    .eq('creator_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const accessError = new Error('به این رکورد دسترسی ندارید.');
    (accessError as Error & { status?: number }).status = 403;
    throw accessError;
  }
  return data;
}

async function lastRecipientEvent(recordId: string, eventType: string) {
  const { data, error } = await admin()
    .from('record_events')
    .select('id,created_at,metadata')
    .eq('record_id', recordId)
    .eq('event_type', eventType)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('درخواست طرف مقابل برای این عملیات وجود ندارد.');
  return data;
}

async function addEvent(recordId: string, eventType: string, actorId: string, metadata: Record<string, unknown> = {}) {
  const { error } = await admin().from('record_events').insert({
    record_id: recordId,
    event_type: eventType,
    actor_id: actorId,
    metadata,
  });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);

  try {
    const payload = bodyObject(await request.json());
    const action = String(payload.action ?? '') as Action;
    if (action !== 'confirm-return' && action !== 'approve-extension') throw new Error('عملیات معتبر نیست.');

    const userId = await currentUserId(request);
    const record = await ownedRecord(id(payload.recordId), userId);

    if (action === 'confirm-return') {
      if (record.kind !== 'item') throw new Error('تأیید بازگشت فقط برای امانت است.');
      if (record.status === 'completed') return reply({ ok: true, status: 'completed', idempotent: true });

      const requestEvent = await lastRecipientEvent(record.id, 'return_requested');
      const now = new Date().toISOString();
      const { error } = await admin().from('records').update({ status: 'completed', completed_at: now }).eq('id', record.id).eq('creator_id', userId);
      if (error) throw error;
      await addEvent(record.id, 'return_confirmed', userId, { request_event_id: requestEvent.id });
      await addEvent(record.id, 'item_returned', userId, { request_event_id: requestEvent.id, confirmed: true });
      return reply({ ok: true, status: 'completed', completedAt: now });
    }

    const requested = await lastRecipientEvent(record.id, 'extension_requested');
    const requestedDueAt = (requested.metadata as Record<string, unknown> | null)?.requested_due_at;
    const dueAt = futureDate(payload.dueAt ?? requestedDueAt);
    const { error } = await admin().from('records').update({ due_at: dueAt }).eq('id', record.id).eq('creator_id', userId);
    if (error) throw error;
    await addEvent(record.id, 'due_date_changed', userId, {
      source: 'recipient_extension_request',
      request_event_id: requested.id,
      previous_due_at: record.due_at,
      due_at: dueAt,
    });
    return reply({ ok: true, dueAt });
  } catch (error) {
    const detail = error as Error & { status?: number };
    return reply({ ok: false, error: detail.message || 'خطای غیرمنتظره رخ داد.' }, detail.status ?? 400);
  }
});
