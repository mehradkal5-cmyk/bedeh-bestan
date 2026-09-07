const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('receipt migration keeps files private and scoped to the authenticated owner', () => {
  const sql = read('supabase/migrations/20260902150000_auth_receipts.sql');
  assert.match(sql, /public\s*=\s*false/i);
  assert.match(sql, /false,\s*5242880,/i);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\]\s*=\s*\(select auth\.uid\(\)::text\)/i);
  assert.match(sql, /image\/jpeg/);
  assert.match(sql, /application\/pdf/);
});

test('record command validates receipt ownership and creates short-lived downloads', () => {
  const source = read('supabase/functions/record-command/index.ts');
  assert.match(source, /create-receipt-download/);
  assert.match(source, /record\.kind !== 'money' && record\.kind !== 'expense'/);
  assert.match(source, /receiptPath\.startsWith\(`\$\{ownerId\}\/\$\{record\.id\}\//);
  assert.match(source, /createSignedUrl\(repayment\.receipt_path, 60/);
});

test('every deployed Edge Function handles OPTIONS directly or through the authenticated wrapper', () => {
  const functionsRoot = path.join(root, 'supabase', 'functions');
  const shared = read('supabase/functions/_shared/workflow.ts');
  assert.match(shared, /request\.method\s*===\s*['"]OPTIONS['"]/);
  assert.match(shared, /headers:\s*cors/);
  const directories = fs.readdirSync(functionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== '_shared');
  for (const directory of directories) {
    const file = path.join(functionsRoot, directory.name, 'index.ts');
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.ok(/request\.method\s*===\s*['"]OPTIONS['"]/.test(source) || /authenticated\s*\(/.test(source), `${directory.name} misses OPTIONS handling`);
    if (/request\.method\s*===\s*['"]OPTIONS['"]/.test(source)) assert.match(source, /headers:\s*cors|\.\.\.cors/, `${directory.name} misses CORS headers`);
  }
});

test('personal expense codes expire, lock during claim, and are consumed once', () => {
  const sql = read('supabase/migrations/20260907070000_single_use_share_codes.sql');
  assert.match(sql, /expires_at\s+timestamptz/i);
  assert.match(sql, /expires_at\s*<=\s*now\(\)/i);
  assert.match(sql, /share_invite_codes[\s\S]*for update/i);
  assert.match(sql, /delete from share_invite_codes\s+where participant_id=p\.id/i);
});

test('frontend bundles never contain a service-role credential', () => {
  for (const file of ['index.html', 'runtime-config.js', 'backend-client.js', 'product-enhancements.js']) {
    assert.doesNotMatch(read(file), /service_role|SUPABASE_SERVICE_ROLE_KEY/i, file);
  }
});

test('signup uses direct password auth without email-link recovery methods', () => {
  const source = read('backend-client.js');
  assert.match(source, /auth\/v1\/signup/);
  assert.match(source, /grant_type=password/);
  assert.doesNotMatch(source, /auth\/v1\/resend|async resendConfirmation|auth\/v1\/otp|async sendMagicLink/);
});
