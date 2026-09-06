import { admin, assertObject, cors, json, requireUser } from './core.ts';

export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await admin().rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export function authenticated(handler: (user: { id: string }, body: Record<string, unknown>, request: Request) => Promise<unknown>) {
  Deno.serve(async (request) => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);
    try {
      const user = await requireUser(request);
      const body = assertObject(await request.json());
      return json({ ok: true, data: await handler(user, body, request) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'خطای سرویس';
      return json({ ok: false, error: message }, /دسترسی|ورود|فقط سازنده/.test(message) ? 403 : 400);
    }
  });
}

export async function accessible(recordId: string, userId: string) {
  const client = admin();
  const { data: record, error } = await client.from('records').select('id,creator_id').eq('id', recordId).maybeSingle();
  if (error) throw error;
  if (!record) throw new Error('بده‌بستان پیدا نشد.');
  if (record.creator_id === userId) return record;
  const { data: member, error: memberError } = await client.from('record_participants').select('id').eq('record_id', recordId).eq('user_id', userId).eq('membership_status', 'accepted').maybeSingle();
  if (memberError) throw memberError;
  if (!member) throw new Error('دسترسی غیرمجاز است.');
  return record;
}
