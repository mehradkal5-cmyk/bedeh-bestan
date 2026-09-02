import { admin, cors, json, requiredEnv } from '../_shared/core.ts';

const tehranDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const dateAtOffset = (days: number) => {
  const today = tehranDate(new Date());
  const midnight = new Date(`${today}T00:00:00+03:30`);
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return tehranDate(midnight);
};
const kinds: Array<{ kind: 'three_days' | 'tomorrow' | 'today' | 'overdue'; offset?: number; title: string; body: (title: string) => string }> = [
  { kind: 'three_days', offset: 3, title: 'موعد نزدیک است', body: (title) => `تا موعد «${title}» سه روز مانده است.` },
  { kind: 'tomorrow', offset: 1, title: 'موعد فرداست', body: (title) => `موعد «${title}» فرداست.` },
  { kind: 'today', offset: 0, title: 'موعد امروز است', body: (title) => `موعد «${title}» امروز است.` },
  { kind: 'overdue', title: 'موعد گذشته است', body: (title) => `موعد «${title}» گذشته است.` },
];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST' || request.headers.get('x-cron-secret') !== requiredEnv('REMINDER_CRON_SECRET')) return json({ ok: false, error: 'دسترسی غیرمجاز است.' }, 401);
  try {
    const client = admin();
    const { data: records, error } = await client.from('records').select('id,creator_id,title,due_at').in('status', ['active', 'overdue']).not('due_at', 'is', null).gte('due_at', new Date(Date.now() - 2 * 86400000).toISOString()).lte('due_at', new Date(Date.now() + 5 * 86400000).toISOString());
    if (error) throw error;
    let created = 0;
    for (const record of records ?? []) {
      const due = tehranDate(new Date(record.due_at));
      for (const reminder of kinds) {
        const applies = reminder.kind === 'overdue' ? due < dateAtOffset(0) : due === dateAtOffset(reminder.offset!);
        if (!applies) continue;
        const { data: existing, error: existingError } = await client.from('notifications').select('id').eq('user_id', record.creator_id).eq('record_id', record.id).eq('kind', reminder.kind).gte('created_at', new Date(`${tehranDate(new Date())}T00:00:00+03:30`).toISOString()).maybeSingle();
        if (existingError) throw existingError;
        if (existing) continue;
        const { error: insertError } = await client.from('notifications').insert({ user_id: record.creator_id, record_id: record.id, kind: reminder.kind, title: reminder.title, body: reminder.body(record.title), delivery: 'in_app', delivery_attempted_at: new Date().toISOString() });
        if (insertError) throw insertError;
        const { error: eventError } = await client.from('record_events').insert({ record_id: record.id, actor_label: 'سامانه', event_type: 'reminder_sent', metadata: { kind: reminder.kind, delivery: 'in_app' } });
        if (eventError) throw eventError;
        created += 1;
      }
    }
    return json({ ok: true, data: { created } });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'خطای سرویس' }, 500); }
});
