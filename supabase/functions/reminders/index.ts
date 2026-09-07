import { cors, json, requiredEnv } from '../_shared/core.ts';
import { rpc } from '../_shared/workflow.ts';
import { deliverPush } from '../_shared/push.ts';
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (request.method !== 'POST' || request.headers.get('x-cron-secret') !== requiredEnv('REMINDER_CRON_SECRET')) return json({ ok: false }, 401);
    const created = await rpc('create_due_reminders', {});
    return json({ ok: true, data: { created, push: await deliverPush() } });
  } catch { return json({ ok: false, error: 'ساخت یادآوری انجام نشد.' }, 500); }
});
