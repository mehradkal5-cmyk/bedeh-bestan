import { admin, assertObject, validId } from '../_shared/core.ts';
import { authenticated, rpc } from '../_shared/workflow.ts';

authenticated(async (user, body) => {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const configured = Boolean(publicKey && Deno.env.get('VAPID_PRIVATE_KEY') && Deno.env.get('VAPID_SUBJECT'));
  if (body.action === 'config') return { configured, publicKey: configured ? publicKey : null };
  if (!validId(body.deviceId)) throw new Error('شناسهٔ دستگاه معتبر نیست.');
  if (body.action === 'disable') {
    const { error } = await admin().from('push_subscriptions').update({ enabled: false }).eq('user_id', user.id).eq('device_id', body.deviceId);
    if (error) throw error;
    return { enabled: false };
  }
  if (body.action !== 'subscribe' || !configured) throw new Error('ارسال اعلان هنوز در سرور تنظیم نشده است.');
  const subscription = assertObject(body.subscription);
  const keys = assertObject(subscription.keys);
  const endpoint = new URL(String(subscription.endpoint));
  // Only browser push providers are allowed; a subscription must never become SSRF.
  const hosts = ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','notify.windows.com'];
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password ||
      !hosts.some((host) => endpoint.hostname === host || endpoint.hostname.endsWith('.' + host))) throw new Error('سرویس اعلان دستگاه پشتیبانی نمی‌شود.');
  if (!/^[A-Za-z0-9_-]{87}$/.test(String(keys.p256dh)) || !/^[A-Za-z0-9_-]{22}$/.test(String(keys.auth))) throw new Error('کلید اشتراک معتبر نیست.');
  await rpc('register_push_device', { p_actor: user.id, p_device: body.deviceId, p_subscription: { endpoint: endpoint.href, keys: { p256dh: keys.p256dh, auth: keys.auth } } });
  return { enabled: true };
});
