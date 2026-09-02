const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function accountHarness({ user = null, onboarded = false, pendingEmail = '', hash = '', failure = null } = {}) {
  const local = new Map(onboarded ? [['bedeh-bestan.auth.onboarded', 'true']] : []);
  const session = new Map(pendingEmail ? [['bedeh-bestan.auth.pending-email', pendingEmail]] : []);
  const storage = (map) => ({ getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) });
  const sheets = [];
  const calls = [];
  const handlers = new Map();
  const context = {
    window: {},
    document: { readyState: 'loading', addEventListener(type, handler) { handlers.set(type, handler); }, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: storage(local), sessionStorage: storage(session),
    location: { hash, search: '' }, URLSearchParams, Intl,
    MutationObserver: class { observe() {} },
    showSheet: (title, html) => sheets.push({ title, html }),
    render() { calls.push('render'); },
    state: { records: [], notifications: [] }, active: 'home',
  };
  context.globalThis = context.window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../product-core.js'), 'utf8'), context);
  context.window.BedehBackend = {
    configured: true,
    async session() { calls.push('session'); if (failure) throw failure; return user; },
    async command(action) { calls.push(action); return { records: [], notifications: [] }; },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../product-enhancements.js'), 'utf8'), context);
  return { context, local, session, sheets, calls, handlers, run: () => context.window.BedehEnhancements.routeAccountEntry() };
}

test('first-time account entry opens registration before the dashboard workflow', async () => {
  const harness = accountHarness();
  await harness.run();
  assert.equal(harness.sheets.length, 1);
  assert.match(harness.sheets[0].html, /data-mode="register"/);
  assert.equal(harness.calls.includes('dashboard'), false);
});

test('registered signed-out users are not shown automatic signup again', async () => {
  const harness = accountHarness({ onboarded: true });
  await harness.run();
  assert.equal(harness.sheets.length, 0);
  assert.equal(harness.calls.includes('dashboard'), false);
});

test('pending confirmation is managed in Settings without reopening signup', async () => {
  const harness = accountHarness({ onboarded: true, pendingEmail: 'person@example.test' });
  await harness.run();
  assert.equal(harness.context.active, 'settings');
  assert.equal(harness.sheets.length, 0);
});

test('confirmation return clears pending state and loads authenticated data', async () => {
  const harness = accountHarness({ user: { id: 'test-user', email: 'person@example.test' }, pendingEmail: 'person@example.test' });
  await harness.run();
  assert.equal(harness.context.active, 'settings');
  assert.equal(harness.local.get('bedeh-bestan.auth.onboarded'), 'true');
  assert.equal(harness.session.has('bedeh-bestan.auth.pending-email'), false);
  assert.equal(harness.sheets.length, 0);
  assert.equal(harness.calls.includes('dashboard'), true);
});

test('recipient share access never forces signup', async () => {
  const harness = accountHarness({ hash: '#share=test-token' });
  await harness.run();
  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.sheets, []);
});

test('invalid confirmation callback opens email recovery instead of signup', async () => {
  const failure = Object.assign(new Error('لینک تأیید نامعتبر یا منقضی شده است.'), { code: 'confirmation_link_invalid' });
  const harness = accountHarness({ failure });
  await harness.run();
  assert.equal(harness.sheets.length, 1);
  assert.match(harness.sheets[0].html, /id="confirmation-resend-form"/);
  assert.match(harness.sheets[0].html, /لینک تأیید نامعتبر/);
  assert.doesNotMatch(harness.sheets[0].html, /name="password"/);
  assert.equal(harness.calls.includes('dashboard'), false);
});

test('network failure does not reopen registration or mark onboarding complete', async () => {
  const harness = accountHarness({ failure: new Error('network unavailable') });
  await assert.rejects(harness.run(), /network unavailable/);
  assert.equal(harness.sheets.length, 0);
  assert.equal(harness.local.size, 0);
});

test('session failure during record submission appears inline without an unhandled rejection', async () => {
  const harness = accountHarness({ failure: new Error('network unavailable') });
  const inlineError = { textContent: '' };
  const form = { matches: (selector) => selector === '#record-form', querySelector: () => inlineError };
  await harness.handlers.get('submit')({ target: form, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(inlineError.textContent, 'network unavailable');
  assert.equal(harness.calls.includes('create-record'), false);
});
