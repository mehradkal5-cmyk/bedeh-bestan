const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const helpers = import('../scripts/production-assets.mjs');

test('public config stays untouched without a complete deployment override', async () => {
  const { publicConfigSource } = await helpers;
  const original = 'window.BEDEH_BESTAN_CONFIG = {};';
  assert.equal(publicConfigSource(original, {}), original);
  assert.throws(() => publicConfigSource(original, { VITE_SUPABASE_URL: 'https://example.supabase.co' }), /both/);
});

test('public config emits only explicitly allowed browser values', async () => {
  const { publicConfigSource } = await helpers;
  const context = { window: {} };
  vm.runInNewContext(publicConfigSource('', {
    VITE_SUPABASE_URL: 'https://example.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_test_only',
    UNRELATED_INTERNAL_VALUE: 'must-not-be-emitted',
  }), context);
  assert.deepEqual(Object.keys(context.window.BEDEH_BESTAN_CONFIG).sort(), ['supabaseAnonKey', 'supabaseUrl']);
  assert.equal(context.window.BEDEH_BESTAN_CONFIG.supabaseAnonKey, 'sb_publishable_test_only');
});

test('service-role JWTs and server keys cannot enter a public build', async () => {
  const { publicConfigSource, assertPublicSource } = await helpers;
  const serviceToken = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.not-a-real-signature`;
  assert.throws(() => assertPublicSource(serviceToken, 'runtime-config.js'), /Non-anon JWT/);
  for (const key of [serviceToken, 'sb_secret_test_only']) {
    assert.throws(() => publicConfigSource('', { VITE_SUPABASE_URL: 'https://example.supabase.co', VITE_SUPABASE_ANON_KEY: key }), /browser key/);
  }
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'CARD_ENCRYPTION_KEY', 'REMINDER_CRON_SECRET', 'SUPABASE_DB_PASSWORD']) {
    assert.throws(() => assertPublicSource(`${name} = 'test-only'`, 'runtime-config.js'), /Server-only/);
  }
});

test('non-whitelisted files fail closed even when they exist in the project', async () => {
  const { readPublicFile } = await helpers;
  await assert.rejects(readPublicFile(path.resolve(__dirname, '..'), 'package.json'), /not allowlisted/);
  await assert.rejects(readPublicFile(path.resolve(__dirname, '..'), 'supabase/.temp/project-ref'), /not allowlisted/);
});

test('dist audit rejects unexpected files and missing runtime assets', async () => {
  const { verifyDist } = await helpers;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bedeh-safety-test-'));
  try {
    await fs.writeFile(path.join(directory, '.env'), 'test-only-fixture');
    await assert.rejects(verifyDist(directory), /Extra: \.env; missing:/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
