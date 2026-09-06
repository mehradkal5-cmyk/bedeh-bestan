import { json, requiredEnv } from '../_shared/core.ts';
import { deliverPush } from '../_shared/push.ts';
Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST' || request.headers.get('x-cron-secret') !== requiredEnv('REMINDER_CRON_SECRET')) return json({ ok: false }, 401);
    return json({ ok: true, data: await deliverPush() });
  } catch { return json({ ok: false, error: 'ارسال صف انجام نشد.' }, 500); }
});
