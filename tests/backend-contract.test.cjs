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
  assert.match(source, /receiptPath\.startsWith\(`\$\{user\.id\}\/\$\{record\.id\}\//);
  assert.match(source, /createSignedUrl\(repayment\.receipt_path, 60/);
});

test('every deployed Edge Function source handles OPTIONS with shared CORS headers', () => {
  const functionsRoot = path.join(root, 'supabase', 'functions');
  const directories = fs.readdirSync(functionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== '_shared');
  for (const directory of directories) {
    const file = path.join(functionsRoot, directory.name, 'index.ts');
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /request\.method\s*===\s*['"]OPTIONS['"]/, `${directory.name} misses OPTIONS`);
    assert.match(source, /headers:\s*cors|\.\.\.cors/, `${directory.name} misses CORS headers`);
  }
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
