const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function clientWithResponse(payload, status = 200) {
  const calls = [];
  const stored = new Map();
  const context = {
    window: { BEDEH_BESTAN_CONFIG: { supabaseUrl: 'https://project.test', supabaseAnonKey: 'public-test-key' }, dispatchEvent() {} },
    location: { origin: 'http://127.0.0.1:4173', pathname: '/', search: '', hash: '' },
    sessionStorage: { setItem: (key, value) => stored.set(key, value), getItem: (key) => stored.get(key), removeItem: (key) => stored.delete(key) },
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      return { ok: status < 400, status, json: async () => payload };
    },
    URLSearchParams, Event,
  };
  context.history = { replaceState() { context.location.hash = ''; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../backend-client.js'), 'utf8'), context);
  return { client: context.window.BedehBackend, calls, stored, context };
}

test('does not fabricate a session when Supabase omits signup tokens', async () => {
  const { client, calls, stored } = clientWithResponse({ id: 'user-id', email: 'person@example.test' });
  const result = await client.signUp({ displayName: 'User', email: 'Person@example.test', password: 'Example123' });
  assert.equal(result.user.id, 'user-id');
  assert.equal(result.access_token, undefined);
  assert.equal(stored.size, 0);
  assert.equal(new URL(calls[0].url).searchParams.get('redirect_to'), null);
  assert.equal(JSON.parse(calls[0].body).email, 'person@example.test');
});

test('stores a real authenticated signup session only when tokens are returned', async () => {
  const { client, stored } = clientWithResponse({ user: { id: 'user-id' }, access_token: 'test-access', refresh_token: 'test-refresh' });
  const result = await client.signUp({ displayName: 'User', email: 'person@example.test', password: 'Example123' });
  assert.equal(result.user.id, 'user-id');
  assert.equal(stored.get('bedeh-bestan.auth.access-token'), 'test-access');
});

test('ships password auth without confirmation resend or magic-link methods', () => {
  const { client } = clientWithResponse({});
  assert.equal(client.resendConfirmation, undefined);
  assert.equal(client.sendMagicLink, undefined);
});

test('preserves the exact server status and code for an unconfirmed account', async () => {
  const { client } = clientWithResponse({ msg: 'Email not confirmed', error_code: 'email_not_confirmed' }, 400);
  await assert.rejects(client.signIn({ email: 'person@example.test', password: 'Example123' }), (error) => {
    assert.equal(error.code, 'email_not_confirmed');
    assert.equal(error.status, 400);
    assert.equal(error.message, 'ورود این حساب هنوز فعال نشده است.');
    return true;
  });
});

const accessKey = 'bedeh-bestan.auth.access-token';
const refreshKey = 'bedeh-bestan.auth.refresh-token';
const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

test('temporary network failure preserves the session for retry', async () => {
  const { client, context, stored } = clientWithResponse({});
  stored.set(accessKey, 'existing-access');
  stored.set(refreshKey, 'existing-refresh');
  context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(client.session(), /Failed to fetch/);
  assert.equal(stored.get(accessKey), 'existing-access');
  assert.equal(stored.get(refreshKey), 'existing-refresh');
});

test('expired access token is refreshed once across concurrent session reads', async () => {
  const { client, context, stored } = clientWithResponse({});
  stored.set(accessKey, 'expired-access');
  stored.set(refreshKey, 'valid-refresh');
  let refreshes = 0;
  context.fetch = async (url, options) => {
    if (url.includes('/auth/v1/user')) return reply(403, { code: 'bad_jwt', msg: 'token has invalid claims: token is expired' });
    assert.equal(new URL(url).searchParams.get('grant_type'), 'refresh_token');
    assert.deepEqual(JSON.parse(options.body), { refresh_token: 'valid-refresh' });
    refreshes += 1;
    return reply(200, { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'bearer', user: { id: 'user-id' } });
  };
  const users = await Promise.all([client.session(), client.session(), client.session()]);
  assert.ok(users.every((user) => user?.id === 'user-id' && user.access_token === 'new-access'));
  assert.equal(refreshes, 1);
  assert.equal(stored.get(refreshKey), 'new-refresh');
});

test('server failure during refresh preserves tokens instead of signing out', async () => {
  const { client, context, stored } = clientWithResponse({});
  stored.set(accessKey, 'expired-access');
  stored.set(refreshKey, 'valid-refresh');
  context.fetch = async (url) => url.includes('/auth/v1/user') ? reply(403, { msg: 'expired' }) : reply(503, { msg: 'temporary outage' });
  await assert.rejects(client.session(), /temporary outage/);
  assert.equal(stored.get(refreshKey), 'valid-refresh');
});

test('definitively revoked refresh token ends the session', async () => {
  const { client, context, stored } = clientWithResponse({});
  stored.set(accessKey, 'expired-access');
  stored.set(refreshKey, 'revoked-refresh');
  context.fetch = async (url) => url.includes('/auth/v1/user') ? reply(401, { msg: 'expired' }) : reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
  assert.equal(await client.session(), null);
  assert.equal(stored.size, 0);
});

test('an invalid confirmation link reports its own error and removes callback parameters', async () => {
  const { client, context, calls } = clientWithResponse({});
  context.location.hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
  await assert.rejects(client.session(), (error) => error.code === 'confirmation_link_invalid' && /لینک/.test(error.message));
  assert.equal(context.location.hash, '');
  assert.equal(calls.length, 0);
});

test('private record commands validate a session before sending a mutation', async () => {
  const { client, calls } = clientWithResponse({ ok: true, data: {} });
  await assert.rejects(client.command('create-record', {}), /وارد حساب/);
  assert.equal(calls.length, 0);
});

test('logout during a pending refresh cannot restore the old session', async () => {
  const { client, context, stored } = clientWithResponse({});
  stored.set(accessKey, 'expired-access');
  stored.set(refreshKey, 'valid-refresh');
  let resolveRefresh;
  let refreshStarted;
  const started = new Promise((resolve) => { refreshStarted = resolve; });
  context.fetch = async (url) => {
    if (url.includes('/auth/v1/user')) return reply(401, { msg: 'expired' });
    if (url.includes('/auth/v1/logout')) return reply(204, {});
    refreshStarted();
    return new Promise((resolve) => { resolveRefresh = resolve; });
  };
  const pending = client.session();
  // A bounded race avoids hanging the regression suite when refresh is missing.
  await Promise.race([started, pending]);
  assert.equal(typeof resolveRefresh, 'function');
  await client.signOut();
  resolveRefresh(reply(200, { access_token: 'new-access', refresh_token: 'new-refresh', user: { id: 'user-id' } }));
  assert.equal(await pending, null);
  assert.equal(stored.size, 0);
});
