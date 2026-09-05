const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('shared workflow uses the configured backend and unwraps the record response', async () => {
  const calls = [];
  const record = { id: 'record-one', kind: 'money', title: 'Shared loan' };
  const context = { window: { BedehBackend: {
    shared: async (token) => { calls.push(token); return { record }; },
    recipient: async (...args) => args,
    command: async (...args) => args,
  } } };
  vm.runInNewContext(fs.readFileSync('workflow-client.js', 'utf8'), context);
  assert.equal((await context.window.BedehWorkflow.shared('new-token')).record, record);
  assert.deepEqual(calls, ['new-token']);
});

test('legacy render delegates shared routes before consulting local records', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const context = { window: {}, location: { hash: '#share=fresh-server-token', search: '' }, URLSearchParams };
  const declarations = source.split('\n').filter((line) => line.startsWith('function renderRecipient('));
  for (const declaration of declarations) vm.runInNewContext(declaration, context);
  let received;
  context.window.BedehShared = { open: (token) => { received = token; } };
  context.renderRecipient('fresh-server-token');
  assert.equal(received, 'fresh-server-token');
});

test('fresh server token opens once without a creator session and survives repeated rendering', async () => {
  const token = 'a'.repeat(43);
  let requests = 0;
  const status = { innerHTML: '' };
  const root = {
    innerHTML: '',
    querySelector(selector) {
      if (selector === '.shared-flow') return this.innerHTML.includes('shared-flow') ? this : null;
      if (selector === '.shared-flow__status') return status;
      return null;
    },
    querySelectorAll: () => [],
  };
  const context = {
    window: { addEventListener() {}, BedehWorkflow: {
      async shared(value) {
        assert.equal(value, token);
        requests += 1;
        return { record: { id: 'r1', kind: 'item', title: 'Fresh record', status: 'open' } };
      },
    } },
    location: { hash: '#share=' + token, search: '' },
    document: { readyState: 'loading', addEventListener() {}, querySelector: () => root },
    URLSearchParams, Intl,
  };
  vm.runInNewContext(fs.readFileSync('shared-workflow.js', 'utf8'), context);
  await Promise.all([context.window.BedehShared.open(token), context.window.BedehShared.open(token)]);
  assert.equal(requests, 1);
  assert.match(root.innerHTML, /Fresh record/);
  assert.doesNotMatch(root.innerHTML, /لینک در دسترس نیست/);
});
