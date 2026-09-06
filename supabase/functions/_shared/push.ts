import webpush from 'npm:web-push@3.6.7';
import { admin } from './core.ts';
import { rpc } from './workflow.ts';

export async function deliverPush() {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return { configured: false, accepted: 0 };
  const client = admin();
  const jobs = await rpc('lease_push_jobs', { p_limit: 10 });
  let accepted = 0;
  for (const job of jobs || []) {
    let success = false;
    let terminal = false;
    let reason = '';
    try {
      const deviceResult = await client.from('push_subscriptions').select('user_id,subscription,enabled').eq('id', job.subscription_id).single();
      if (deviceResult.error) throw deviceResult.error;
      const device = deviceResult.data;
      const preference = await client.from('notification_preferences').select('push_enabled').eq('user_id', device.user_id).single();
      if (preference.error) throw preference.error;
      if (!device.enabled || !preference.data.push_enabled) { terminal = true; reason = 'device_disabled'; }
      else {
        const noteResult = await client.from('notifications').select('id,record_id,user_id,title,body').eq('id', job.notification_id).single();
        if (noteResult.error) throw noteResult.error;
        const note = noteResult.data;
        if (note.user_id !== device.user_id) { terminal = true; reason = 'account_changed'; }
        else {
          const response = await webpush.sendNotification(device.subscription, JSON.stringify({ title: note.title, body: note.body, notificationId: note.id, recordId: note.record_id }), {
            vapidDetails: { subject, publicKey, privateKey }, TTL: 86400, timeout: 10000,
          });
          success = response.statusCode >= 200 && response.statusCode < 300;
          if (!success) throw new Error('provider_not_accepted');
          accepted += 1;
        }
      }
    } catch (error) {
      const status = Number((error as { statusCode?: number }).statusCode || 0);
      terminal = status === 404 || status === 410;
      reason = status ? `provider_${status}` : 'delivery_failed';
      if (terminal) {
        const { error: disableError } = await client.from('push_subscriptions').update({ enabled: false }).eq('id', job.subscription_id);
        if (disableError) throw disableError;
      }
    }
    // A lease prevents stale workers from overwriting newer attempts. Crashes
    // retry after lease expiry; the notification ID deduplicates device display.
    await rpc('finish_push_job', { p_id: job.id, p_lease: job.lease_id, p_success: success, p_terminal: terminal, p_error: reason || null });
  }
  return { configured: true, accepted };
}
