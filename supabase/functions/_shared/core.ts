import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

export const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? 'http://127.0.0.1:4173',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export const admin = () => createClient(
  requiredEnv('SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('بدنهٔ درخواست معتبر نیست.');
  return value as Record<string, unknown>;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function text(value: unknown, field: string, min: number, max: number, optional = false) {
  if ((value === undefined || value === null || value === '') && optional) return null;
  if (typeof value !== 'string') throw new Error(`${field} معتبر نیست.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) throw new Error(`${field} معتبر نیست.`);
  return normalized;
}

export function amount(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(String(value).replaceAll(',', ''));
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 99999999999999) throw new Error('مبلغ معتبر نیست.');
  return parsed;
}

export function dueDate(value: unknown, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value !== 'string') throw new Error('تاریخ موعد معتبر نیست.');
  // A date-only control represents the end of that calendar day in Tehran,
  // rather than midnight UTC (which would expire several hours too early).
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59+03:30` : value);
  if (Number.isNaN(date.valueOf()) || date.valueOf() < Date.now() - 5 * 60 * 1000 || date.valueOf() > Date.now() + 10 * 365 * 86400000) {
    throw new Error('تاریخ موعد معتبر نیست.');
  }
  return date.toISOString();
}

export function normalizedCard(value: unknown) {
  const card = String(value ?? '').replace(/[\s-]/g, '');
  if (!/^\d{16}$/.test(card)) throw new Error('شماره کارت باید ۱۶ رقم باشد.');
  let sum = 0;
  for (let index = 0; index < 16; index += 1) {
    let digit = Number(card[index]);
    if (index % 2 === 0) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  if (sum % 10 !== 0) throw new Error('شماره کارت معتبر نیست.');
  return card;
}

function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

async function encryptionKey() {
  const raw = fromBase64(requiredEnv('CARD_ENCRYPTION_KEY'));
  if (raw.byteLength !== 32) throw new Error('CARD_ENCRYPTION_KEY must be a base64 32-byte key.');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptCard(card: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(card));
  return { encrypted_number: base64(new Uint8Array(encrypted)), encryption_iv: base64(iv), key_version: 1 };
}

export async function decryptCard(ciphertext: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, await encryptionKey(), fromBase64(ciphertext));
  return new TextDecoder().decode(decrypted);
}

export async function requireUser(request: Request) {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) throw new Error('ورود لازم است.');
  const { data, error } = await admin().auth.getUser(header.slice(7));
  if (error || !data.user) throw new Error('دسترسی غیرمجاز است.');
  return data.user;
}

export async function publicLink(token: string) {
  const client = admin();
  const tokenHash = await sha256(token);
  const { data, error } = await client.from('share_links').select('id,record_id,expires_at,revoked_at').eq('token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!data) return { link: null, tokenHash };
  if (data.revoked_at) return { link: null, tokenHash, reason: 'revoked' };
  if (data.expires_at && new Date(data.expires_at).valueOf() <= Date.now()) return { link: null, tokenHash, reason: 'expired' };
  return { link: data, tokenHash };
}

export async function limitPublic(request: Request, tokenHash: string) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const bucket = await sha256(`${tokenHash}:${ip}`);
  const { data, error } = await admin().rpc('claim_public_rate_limit', { target_bucket_hash: bucket, max_requests: 30 });
  if (error || !data) throw new Error('درخواست‌های این لینک موقتاً محدود شده است.');
}

export function bankName(card: string) {
  const prefix = card.slice(0, 6);
  return ({ '603799': 'بانک ملی ایران', '589210': 'بانک سپه', '627648': 'بانک توسعه صادرات', '627961': 'بانک صنعت و معدن', '603770': 'بانک کشاورزی', '628023': 'بانک مسکن', '627760': 'پست بانک ایران', '502908': 'بانک توسعه تعاون', '627412': 'بانک اقتصاد نوین', '622106': 'بانک پارسیان', '502229': 'بانک پاسارگاد', '639346': 'بانک سینا', '621986': 'بانک سامان', '639607': 'بانک سرمایه', '502806': 'بانک شهر', '502938': 'بانک دی', '603769': 'بانک صادرات ایران', '610433': 'بانک ملت', '627353': 'بانک تجارت', '589463': 'بانک رفاه کارگران', '627381': 'بانک انصار', '639370': 'بانک مهر اقتصاد' } as Record<string, string>)[prefix] ?? null;
}
