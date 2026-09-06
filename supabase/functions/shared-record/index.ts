import { assertObject, cors, json, limitPublic, publicLink, validToken } from '../_shared/core.ts';
// Public links expose invitation validity only, never private record details.
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'روش درخواست مجاز نیست.' }, 405);
  try {
    const body = assertObject(await request.json());
    if (!validToken(body.token)) throw new Error('لینک معتبر نیست.');
    const { link, tokenHash } = await publicLink(body.token);
    await limitPublic(request, tokenHash);
    if (!link) throw new Error('برای بررسی دسترسی یا وضعیت این دعوت وارد حساب شوید.');
    return json({ ok: true, data: { requiresSignIn: true } });
  } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'خطای سرویس' }, 400); }
});
